# AIstudy MCP 内网访问设计

目标：让一台新设备打开 AIstudy 后，可以把 MCP 查询能力暴露给同一 Tailscale 网络里的其他设备；远程编辑默认关闭，必须在设置页按权限组显式开启。

## 新设备开启顺序

1. 用户在设置页打开“内网访问”。
2. AIstudy 检测本机是否存在 `tailscale` 命令。
3. 未安装时停在“需要安装 Tailscale”。
4. 已安装时读取 `tailscale status --json`。
5. 未连接时尝试执行 `tailscale up`。
6. 仍未连接时停在“需要登录 Tailscale”，由用户完成登录。
7. 已在线时，AIstudy 在 `127.0.0.1:6188` 启动 MCP HTTP 服务。
8. AIstudy 执行 `tailscale serve --bg --http=6188 http://127.0.0.1:6188`，只开放给 tailnet。
9. 设置页显示 MCP 地址和连接状态。
10. 用户复制连接信息，在另一台已登录同一 tailnet 的设备中配置 MCP HTTP URL 和 Authorization。
11. 用户关闭 AIstudy 后，开关状态保留；下次启动 AIstudy 会自动恢复本机 HTTP 服务和 Tailscale Serve。

## 对外能力

远程访问默认只开放读取白名单：

- `mcp_get_started`
- `mcp_plan_task`
- `mcp_resolve_target`
- `read_courses`
- `read_current_mindmap`
- `search_nodes`
- `list_node_documents`
- `read_node_document`
- `health_check`
- `chrome_ports_status`
- `chrome_port_open_page`

其中 `chrome_port_open_page` 只负责让 AIstudy 主机打开指定平台的固定端口 Chrome 页面，不在网页内执行脚本。

远程编辑由设置页权限组控制：

- `远程编辑`：总开关，关闭时远程只读。
- `知识库管理`：开放知识库和分区的创建、改名、移动。
- `导图编辑`：开放导图节点新增、改名、移动、样式和布局。
- `文档写入`：开放节点文档写入、追加和样式。
- `删除操作`：单独开放删除类工具；仍要求对应的知识库或导图权限已开启。

知识库管理开启后可用：

- `create_course`
- `rename_course`
- `move_course`
- `create_course_section`
- `rename_course_section`
- `move_course_section`

知识库管理 + 删除操作开启后可用：

- `delete_course`
- `delete_course_section`

导图编辑开启后可用：

- `append_mindmap_node`
- `create_mindmap_node`
- `update_mindmap_node_text`
- `move_mindmap_node`
- `update_mindmap_node_style`
- `update_mindmap_layout`

导图编辑 + 删除操作开启后可用：

- `delete_mindmap_node`

文档写入开启后可用：

- `write_node_document`
- `append_node_document`
- `format_node_document`
- `update_node_document_style`

远程访问不开放定位文件生成和复制配置。

默认远程入口不开放：

- `resolve_course_locator`
- `copy_config`

## 访问入口

MCP：

```text
POST http://<tailscale-device>:6188/mcp
Authorization: Bearer <token>
```

普通只读 API：

```text
GET /api/courses
GET /api/courses/:courseId/mindmap
GET /api/courses/:courseId/search?q=关键词
GET /api/courses/:courseId/nodes/:nodeId/document
```

Chrome 端口工具只通过 MCP 调用，不提供单独普通 API。另一台设备需要先调用：

```text
chrome_ports_status
chrome_port_open_page({ platformId, url? })
```

支持平台：

```text
doubao
chatgpt
bilibili
zhihu
```

## 安全边界

- 默认关闭。
- 本机服务只监听 `127.0.0.1`。
- 远程路径只通过 Tailscale Serve 进入。
- 不使用 Tailscale Funnel，不开放公网。
- 所有数据请求必须带 token。
- 校验 Origin，降低 DNS rebinding 风险。
- 远程 MCP 默认只读。
- 远程默认允许读取端口信息和打开固定端口页面，但不允许在网页内执行任意脚本。
- 远程编辑权限按组放行，删除操作独立控制。
