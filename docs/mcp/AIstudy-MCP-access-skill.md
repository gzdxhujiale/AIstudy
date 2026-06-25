# AIstudy MCP 接入技能与使用说明

这一个文件同时给人和 Codex/Claude Code 看。另一台设备拿到这份文档，再拿到 AIstudy 复制出来的三行连接信息，就能按顺序接入 MCP、读取知识库、搜索导图节点、读取节点文档、打开固定端口 Chrome 页面，并在明确授权后编辑。

## 给 Codex/Claude Code 的 Skill 提示

```text
Skill name: aistudy-mcp-access

Use this skill when connecting Codex, Claude Code, Cursor, or another AI assistant to an AIstudy MCP endpoint over local stdio, HTTP, or Tailscale LAN access.

Core rule:
Treat AIstudy MCP as a full-library knowledge system, not as the user's currently selected UI page. Always discover the target first, then read, then edit only with explicit permission.

Workflow:
1. Collect the connection shape.
   - HTTP/Tailscale: MCP URL, optional API URL, Authorization: Bearer ...
   - Local stdio: server script path, data root, app root, and edit flag.
2. Verify reachability before doing useful work.
   - HTTP: confirm the host is reachable and the token is present.
   - stdio: confirm Node.js can run the server script and the AIstudy data root exists.
3. Start read-only.
   - Call mcp_get_started.
   - Call read_courses.
   - Resolve a target with mcp_resolve_target before reading a specific knowledge base.
4. Read in this order.
   - read_current_mindmap with courseId for the target knowledge base.
   - search_nodes with courseId and the user's keyword.
   - list_node_documents, then read_node_document for node-bound documents.
5. Open browser ports only through AIstudy port management.
   - Call chrome_ports_status first.
   - Call chrome_port_open_page with platformId and optional url.
   - AIstudy only opens the page; the external assistant handles page actions.
6. Edit only when the user has clearly allowed it.
   - Confirm the remote edit permission group is enabled in AIstudy settings.
   - Use exact courseId and, for document edits, exact nodeId.
   - Prefer append/update tools over destructive tools.
   - After editing, re-read the affected course/node/document.

Safety defaults:
- Do not invent courseId, nodeId, or local paths.
- Do not rely on the AIstudy UI selected course.
- Do not use destructive tools unless the user explicitly asks.
- If the endpoint is remote, assume read-only until settings say otherwise.
- If a request lacks a target, call mcp_resolve_target or ask for the knowledge base name.
```

## 需要从 AIstudy 复制的三行

在 AIstudy 打开：

```text
设置 -> MCP 控制台 -> 内网访问
```

开启后复制：

```text
MCP URL: ...
API URL: ...
Authorization: Bearer ...
```

另一台设备必须先登录同一个 Tailscale 网络。AIstudy 所在机器要保持应用打开，内网访问也要保持开启。

## 给另一台 Codex 的推荐提示词

```text
请按下面这份 AIstudy MCP 接入说明操作。先只读，不要编辑，除非我明确允许。

MCP URL: ...
API URL: ...
Authorization: Bearer ...

第一步调用 mcp_get_started，然后 read_courses，再用 mcp_resolve_target 确认目标知识库。需要打开网页时先调用 chrome_ports_status，再调用 chrome_port_open_page。
```

## HTTP MCP 配置示例

```json
{
  "mcpServers": {
    "aistudy": {
      "type": "http",
      "url": "http://<tailscale-name-or-ip>:6188/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

## 本机 stdio 配置示例

同一台机器上使用时可以走本地脚本：

```json
{
  "mcpServers": {
    "aistudy": {
      "command": "node",
      "args": [
        "F:\\XIANGMU\\AIstudy-public\\scripts\\mcp\\aistudy-mcp-server.mjs"
      ],
      "env": {
        "AISTUDY_PUBLIC_DATA_ROOT": "F:\\XIANGMU\\AIstudy-public\\.runtime",
        "AISTUDY_APP_ROOT": "F:\\XIANGMU\\AIstudy-public",
        "AISTUDY_MCP_ALLOW_EDIT": "0"
      }
    }
  }
}
```

`AISTUDY_MCP_ALLOW_EDIT=1` 只在明确要编辑时开启。

## 第一次使用顺序

1. `mcp_get_started`：确认服务、权限、数据状态。
2. `read_courses`：读取全库列表。
3. `mcp_resolve_target`：用知识库名称、课程 ID 或关键词解析目标。
4. `read_current_mindmap`：读取指定知识库导图。
5. `search_nodes`：搜索节点。
6. `list_node_documents`：查看节点文档。
7. `read_node_document`：读取节点文档。
8. `chrome_ports_status`：需要网页端口时，先读取 AIstudy 端口管理信息。
9. `chrome_port_open_page`：按平台打开固定端口 Chrome 页面。

编辑前额外调用 `mcp_plan_task`，让 AIstudy 返回建议工具顺序；编辑完成后重新读取目标内容确认结果。

## MCP 功能总览

### 接入、规划、健康检测

- `mcp_get_started`：新客户端第一步调用，返回健康状态、全库概览、安全规则、推荐下一步、resources 和 prompts。
- `mcp_plan_task`：把用户意图整理成 MCP 工具调用顺序，适合编辑前使用。
- `mcp_resolve_target`：按知识库名、`courseId`、节点关键词解析真实目标，避免猜 ID。
- `health_check`：检查数据目录、MySQL、数据库和核心表状态。
- `copy_config`：应用内置 MCP 控制器工具，用于复制接入引导；通常通过 AIstudy 设置页按钮使用。独立 `scripts/mcp/aistudy-mcp-server.mjs` 不依赖它。

只读：

- `read_courses`
- `read_current_mindmap`
- `search_nodes`
- `list_node_documents`
- `read_node_document`

### 知识库和分区管理

- `read_courses`：读取全库分区和知识库清单。
- `create_course`：创建知识库。
- `rename_course`：修改知识库名称、描述或所属分区。
- `move_course`：移动知识库到指定分区或排序位置。
- `delete_course`：删除知识库，属于破坏性操作。
- `create_course_section`：创建分区。
- `rename_course_section`：修改分区名称。
- `move_course_section`：调整分区顺序。
- `delete_course_section`：删除分区，属于破坏性操作。

### 思维导图读取和编辑

- `read_current_mindmap`：不传 `courseId` 时读取全库导图摘要；传 `courseId` 时读取目标导图。
- `search_nodes`：不传 `courseId` 时全库搜索；传 `courseId` 时只搜目标知识库。
- `append_mindmap_node`：在指定知识库导图根节点追加节点。
- `create_mindmap_node`：在指定父节点下新增节点。
- `update_mindmap_node_text`：修改节点标题。
- `move_mindmap_node`：移动节点到新父节点和排序位置。
- `delete_mindmap_node`：删除节点及其子节点，属于破坏性操作。
- `update_mindmap_node_style`：设置节点颜色、字号、粗斜体、删除线、自动换行宽度等。
- `update_mindmap_layout`：切换导图布局。

### 节点文档

- `list_node_documents`：列出全库或指定知识库里已有节点文档。
- `read_node_document`：读取指定节点绑定的文档。
- `write_node_document`：创建节点文档或在明确授权时覆盖整篇。节点已有内容时，必须显式传 `replaceExisting: true` 才允许覆盖；不要把它当作“排版工具”使用。
- `append_node_document`：在节点文档末尾追加干净文本或 Markdown 标题。
- `format_node_document`：只做已有节点文档的样式清理。它必须逐字保留每一个编辑器元素的 `value`，不得改写文字、修剪空白、删除空行、插入空行、缩进、拆段或合段。
- `update_node_document_style`：只做全文字号、颜色、粗体、斜体、下划线等简单样式调整；不得拆段、加空行或重写内容。

文档写入规则：

- 不要手写 canvas-editor 内部元素来拼排版。
- 不要在 `value` 中塞大量 `\n\n` 来制造间距。
- 不要为了“改排版”调用 `write_node_document` 覆盖整篇文档。
- 节点已有文档时，`write_node_document` 默认会拒绝覆盖；只有用户明确要求“整篇重写/覆盖”时才传 `replaceExisting: true`。
- 新内容写入用 `write_node_document`，补内容用 `append_node_document`，不改内容的样式清理用 `format_node_document`，简单全文样式用 `update_node_document_style`。
- `format_node_document` 写入前必须校验元素数量一致、所有 `value` 逐字一致；校验失败必须中断，不得写入。
- MCP 不再把“清理空行、缩进正文、重排段落”当作安全排版。需要改变正文结构时，必须先读全文、让用户确认，再用 `write_node_document` 重建整篇。

### 本地定位和交接

- `resolve_course_locator`：生成本地定位文件，给另一个 Codex/Claude 快速找到知识库数据边界。不要用 UI 面包屑代替它。

### Chrome 端口管理

- `chrome_ports_status`：读取 AIstudy 端口管理信息，包含豆包、ChatGPT、Bilibili、知乎的平台 ID、固定端口、默认地址、连接状态和当前检测页面。
- `chrome_port_open_page`：按 `platformId` 和可选 `url` 启动或复用固定端口 Chrome 页面。AIstudy 只负责打开页面，不执行网页脚本。

可用 `platformId`：

- `doubao`
- `chatgpt`
- `bilibili`
- `zhihu`

示例：

```json
{
  "platformId": "zhihu",
  "url": "https://www.zhihu.com/"
}
```

### MCP resources 和 prompts

支持 resources 的客户端可以读取：

- `aistudy://guide/start`
- `aistudy://guide/workflows`
- `aistudy://guide/safety`
- `aistudy://schema/tools`

支持 prompts 的客户端可以使用：

- `aistudy_start`
- `aistudy_read_knowledge`
- `aistudy_edit_mindmap`
- `aistudy_edit_document`

### 普通 HTTP 只读 API

开启内网访问后，除 `/mcp` 外还提供普通只读 API：

- `GET /api/courses`
- `GET /api/courses/:courseId/mindmap`
- `GET /api/courses/:courseId/search?q=关键词`
- `GET /api/courses/:courseId/nodes/:nodeId/document`

## 编辑权限

远程 MCP 默认只读。需要编辑时，在 AIstudy 设置页打开对应权限：

- 远程编辑
- 知识库管理
- 导图编辑
- 文档写入
- 删除操作

编辑必须明确目标知识库 `courseId`。文档编辑还必须明确 `nodeId`。删除操作需要单独确认。

## 常见问题

- TCP 超时：AIstudy 没开、内网访问没开、Tailscale 没在线，或 `6188` 没暴露成功。
- 401/403：token 错了，或请求头没有带 `Authorization`。
- 能读不能写：远程编辑权限没开，这是默认安全状态。
- `dataRootExists=false`：本地数据目录路径错了。
- `MCP requires an explicit knowledge base`：编辑调用没有传 `courseId`。
- 找不到目标知识库：先用 `read_courses` 和 `mcp_resolve_target`，不要猜 ID。
- `Unknown tool: copy_config`：当前连接的是独立 `scripts/mcp` 服务，复制配置请在 AIstudy 设置页完成。
- `Chrome executable is missing`：端口管理 MCP 找不到 Chrome，可设置 `AISTUDY_CHROME_PATH`。

## 回复用户时的口径

优先说知识库名称和节点标题。只有需要继续调用工具时，才把 `courseId`、`nodeId` 放在括号里。
