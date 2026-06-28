# AIstudy MCP 新手接入引导

这份文档给完全不了解 MCP 的 Codex、Claude、Cursor 使用者看。目标是先接通、先验证、再读取，最后才考虑编辑。

如果是给另一台 Codex 直接接入，优先把单文件说明发给它：`docs/mcp/AIstudy-MCP-access-skill.md`。

项目内标准 MCP 接入 skill 位于 `.claude/skills/aistudy-mcp-access/SKILL.md`；后续 MCP 功能更新时，同步清单见 `.claude/skills/aistudy-mcp-access/references/sync-checklist.md`。

## 先理解一句话

AIstudy MCP 是一个本地工具入口，让外部 AI 助手可以读取和管理 AIstudy 的全库知识库、思维导图、节点搜索结果、节点文档，也可以通过 AIstudy 的端口管理打开固定端口 Chrome 页面。

默认是只读模式，不会修改导图。编辑能力必须显式开启 `AISTUDY_MCP_ALLOW_EDIT=1`，并传入明确的 `courseId` 和目标节点。

Chrome 端口能力只负责打开页面，不负责网页内点击、输入或读取。页面内动作由外部 Codex、Claude 或 Cursor 自己接管。

客户端连接后会收到 `instructions`，也可以通过 MCP `resources` 和 `prompts` 读取固定流程。最省心的办法是让外部智能体第一步调用 `mcp_get_started`。

## 接入前检查

先确认三件事：

- Node.js 能运行。
- `scripts/mcp/aistudy-mcp-server.mjs` 存在。
- AIstudy 数据目录存在，开发态通常是 `F:\XIANGMU\AIstudy-public\.runtime`，打包态通常在 `release\win-unpacked\AIstudyPublicData` 或应用生成的数据目录。

## 客户端配置

支持 `mcpServers` JSON 的客户端可以使用这个结构：

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

如果你的客户端使用 TOML，把字段按同样含义映射：

```toml
[mcp_servers.aistudy]
command = "node"
args = ["F:\\XIANGMU\\AIstudy-public\\scripts\\mcp\\aistudy-mcp-server.mjs"]

[mcp_servers.aistudy.env]
AISTUDY_PUBLIC_DATA_ROOT = "F:\\XIANGMU\\AIstudy-public\\.runtime"
AISTUDY_APP_ROOT = "F:\\XIANGMU\\AIstudy-public"
AISTUDY_MCP_ALLOW_EDIT = "0"
```

## 第一次运行顺序

1. 调用 `mcp_get_started`，读取健康状态、全库概览、安全规则和下一步建议。
2. 调用 `read_courses`，确认能看到全库分区和知识库清单，并记住目标知识库的 `courseId`。
3. 调用 `mcp_resolve_target`。按知识库名、`courseId` 或节点关键词解析真实目标，减少猜参数。
4. 调用 `read_current_mindmap`。不传 `courseId` 时读取全库导图摘要，传 `courseId` 时读取指定知识库的完整导图。
5. 调用 `search_nodes`。不传 `courseId` 时全库搜索，传 `courseId` 时只搜索目标知识库。
6. 需要看文档时，先用 `list_node_documents` 找已有文档，再用 `read_node_document` 按 `courseId + nodeId` 读取。
7. 需要打开网页端口时，先用 `chrome_ports_status` 读取平台和端口，再用 `chrome_port_open_page` 打开页面。
8. 需要编辑时，先调用 `mcp_plan_task` 规划工具顺序；写入必须传 `courseId`，节点文档写入还必须传 `nodeId`。

## 工具范围

### 半自动向导和健康检查

- `mcp_get_started`
- `mcp_plan_task`
- `mcp_resolve_target`
- `health_check`
- `copy_config`：应用内置 MCP 控制器可用，通常通过设置页“复制接入配置”使用；独立 `scripts/mcp` 服务不依赖它。

### 知识库管理

- `read_courses`
- `create_course`
- `rename_course`
- `move_course`
- `delete_course`
- `create_course_section`
- `rename_course_section`
- `move_course_section`
- `delete_course_section`

### 导图管理

- `read_current_mindmap`
- `search_nodes`
- `create_mindmap_node`
- `append_mindmap_node`
- `update_mindmap_node_text`
- `move_mindmap_node`
- `delete_mindmap_node`
- `update_mindmap_node_style`
- `update_mindmap_layout`

### 节点文档

- `list_node_documents`
- `read_node_document`
- `write_node_document`
- `append_node_document`
- `format_node_document`
- `update_node_document_style`

文档工具分工：

- 写新内容：`write_node_document`
- 追加内容：`append_node_document`
- 不改内容的样式清理：`format_node_document`
- 简单全文样式：`update_node_document_style`

不要为了排版调用 `write_node_document` 重写整篇文档；节点已有内容时，`write_node_document` 默认拒绝覆盖，只有用户明确要求整篇覆盖时才传 `replaceExisting: true`。不要手写编辑器内部元素或用大量空行制造间距。`format_node_document` 只允许改样式，必须保证元素数量一致、所有 `value` 逐字不变；它不能清理空行、缩进正文、拆段或合段。

### 本地定位

- `resolve_course_locator`

### Chrome 端口管理

- `chrome_ports_status`
- `chrome_port_open_page`

平台 ID：

- `doubao`：豆包，默认端口 `9224`
- `chatgpt`：ChatGPT，默认端口 `9230`
- `bilibili`：Bilibili，默认端口 `9231`
- `zhihu`：知乎，默认端口 `9232`
- `zhaopin`：智联招聘，默认端口 `9233`
- `zhipin`：BOSS直聘，默认端口 `9234`
- `xiaohongshu`：小红书，默认端口 `9235`

示例：

```json
{
  "name": "chrome_port_open_page",
  "arguments": {
    "platformId": "bilibili",
    "url": "https://www.bilibili.com/"
  }
}
```

### 普通 HTTP 只读 API

开启内网访问后，还可以用这些普通 API 做只读访问：

- `GET /api/courses`
- `GET /api/courses/:courseId/mindmap`
- `GET /api/courses/:courseId/search?q=关键词`
- `GET /api/courses/:courseId/nodes/:nodeId/document`

## 推荐给 Codex 的第一句提示

```text
你已经接入 AIstudy MCP。请先调用 aistudy.mcp_get_started，再按返回的 nextSteps 做只读探测；除非我明确允许，不要进行编辑。
```

## 可读资源和提示词

支持 MCP resources/prompts 的客户端可以直接读取：

- `aistudy://guide/start`
- `aistudy://guide/workflows`
- `aistudy://guide/safety`
- `aistudy://schema/tools`

可用提示词：

- `aistudy_start`
- `aistudy_read_knowledge`
- `aistudy_edit_mindmap`
- `aistudy_edit_document`

## 常见任务怎么走

### 读取全库

`mcp_get_started` -> `read_courses` -> `read_current_mindmap`

### 读取指定知识库

`read_courses` -> `mcp_resolve_target` -> `read_current_mindmap({ courseId })`

### 搜索节点并读文档

`mcp_resolve_target({ courseName, nodeQuery })` -> `search_nodes` -> `list_node_documents` -> `read_node_document`

### 编辑导图

`mcp_plan_task({ intent, allowEdit: true })` -> `mcp_resolve_target` -> 具体导图编辑工具 -> 重新读取导图确认结果

### 编辑文档

`mcp_resolve_target({ courseName, nodeQuery })` -> `read_node_document` -> 按任务选择 `write_node_document` / `append_node_document` / `format_node_document` / `update_node_document_style` -> 重新读取文档确认结果

### 打开网页端口

`chrome_ports_status` -> `chrome_port_open_page({ platformId, url? })`

## 编辑开关

编辑默认关闭：

```text
AISTUDY_MCP_ALLOW_EDIT=0
```

只有明确要写入时才改成：

```text
AISTUDY_MCP_ALLOW_EDIT=1
```

编辑工具覆盖知识库、分区、导图节点、导图样式布局和节点文档。调用前要说明目标知识库、`courseId`、节点 ID 和具体动作；调用后应立刻恢复只读模式。

## 排障

- `dataRootExists=false`：数据目录路径填错了。
- `dataRootExists=false` 但 `mysql=true`：MCP 服务已启动，数据库能连上，但当前配置的数据目录不是 AIstudy 正在使用的目录。
- `mysql=false` 或启动报连接错误：MySQL 没启动，或配置指向了错误数据库。
- `MCP requires an explicit knowledge base.`：写入没有传入 `courseId`。MCP 不依赖客户端当前选中项，编辑必须明确目标知识库。
- `MCP edit calls are disabled by configuration.`：编辑权限没有打开，这是默认安全行为。
- `resolve_course_locator` 返回的 `locatorPath`：这是给外部 Codex 使用的本地定位文件路径，里面包含数据目录、固定数据库名、固定表名和知识库 ID；其中数据库名和表名只是边界元数据，不代表公开版运行时支持覆盖库名或表名。
- `Unknown tool: copy_config`：当前连接的是独立 `scripts/mcp` 服务，复制接入配置请在 AIstudy 设置页里点按钮。
- `Chrome executable is missing`：Chrome 路径没找到，可配置 `AISTUDY_CHROME_PATH`。

## read_node_document text fields

Use `text` or `textClean` as the readable node-document body. Use `textRaw` only when auditing extraction behavior. `document.snapshot` is editor JSON and may contain style or structure metadata such as `title`, `list`, `ol`, `separator`, or `rgb(...)`; do not treat it as prose.
