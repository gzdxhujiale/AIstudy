# MCP 控制台

MCP 控制台负责把外部助手可调用的能力按读取、编辑、管控三类集中展示，并同步每次调用状态。

- 读取：全库知识库列表、导图读取、导图节点搜索、节点文档读取。
- 编辑：受编辑许可保护的知识库、分区、导图节点、导图样式布局和节点文档写入动作。
- 管控：半自动使用向导、任务规划、目标解析、健康检测、知识库定位文件生成、接入配置复制、工具级启停。
- Chrome 端口：外部助手可读取 AIstudy 端口管理信息，并要求 AIstudy 打开指定平台页面；页面内点击、输入和读取由外部助手自行接管。
- 状态：后端在调用开始时置为 running，调用结束后短暂停留 success/error，再自动回到 idle。
- 同步：HTTP/Tailscale MCP 每次调用结束都会推送远程状态；编辑类工具成功后会额外通知前端刷新知识库、导图或文档。独立 stdio MCP 进程会把编辑事件写入 `runtime/mcp-events`，桌面端监听后走同一套刷新逻辑，避免外部 Codex/Claude Code 已执行但界面仍停留在旧数据。

## 当前 MCP 工具

接入与规划：

- `mcp_get_started`
- `mcp_plan_task`
- `mcp_resolve_target`
- `health_check`
- `copy_config`

知识库和分区：

- `read_courses`
- `create_course`
- `rename_course`
- `move_course`
- `delete_course`
- `create_course_section`
- `rename_course_section`
- `move_course_section`
- `delete_course_section`

导图：

- `read_current_mindmap`
- `search_nodes`
- `append_mindmap_node`
- `create_mindmap_node`
- `update_mindmap_node_text`
- `move_mindmap_node`
- `delete_mindmap_node`
- `update_mindmap_node_style`
- `update_mindmap_layout`

节点文档：

- `list_node_documents`
- `read_node_document`
- `write_node_document`
- `append_node_document`
- `update_node_document_style`

定位和外部交接：

- `resolve_course_locator`

Chrome 端口：

- `chrome_ports_status`
- `chrome_port_open_page`

外部助手第一次接入时，不应该直接编辑。推荐流程是：

1. 点击 MCP 控制台里的“复制接入配置”，拿到完整新手接入引导。
2. 先把配置接入 Codex/Claude/Cursor。
3. 先跑 `mcp_get_started`，让服务返回健康状态、全库概览、安全规则和下一步工具顺序。
4. 再跑 `read_courses`，确认能看到全库知识库，并取到后续定向操作所需的 courseId。
5. 再跑 `mcp_resolve_target`，按知识库名、courseId 或节点关键词解析目标。
6. 再跑 `read_current_mindmap` 或 `search_nodes`。不传 courseId 是全库，传 courseId 是单库。
7. 最后才考虑编辑工具；编辑前先跑 `mcp_plan_task`，导图编辑必须传 courseId，节点文档编辑必须传 courseId 和 nodeId。

外部 MCP 客户端使用 `scripts/mcp/aistudy-mcp-server.mjs`。复制配置会默认写入 `AISTUDY_MCP_ALLOW_EDIT=0`，因此外部调用默认只读；需要开放编辑时必须显式改成 `1`，并传入明确的 courseId。MCP 不依赖客户端当前选中的知识库。支持 MCP resources/prompts 的客户端还能读取 `aistudy://guide/start`、`aistudy://guide/workflows`、`aistudy://guide/safety` 和 `aistudy://schema/tools`。

文档写入统一走 AIstudy 标准排版模板。`write_node_document` 和 `append_node_document` 传入 `text` 时，外部助手只需要给干净文本或 Markdown 标题；系统会自动按内置 Word 文档风格生成快照：章节标题橙色加粗，小节标题紫色加粗，条款标题蓝色加粗，正文深色常规文本。只有在先通过 `read_node_document` 读到现有 snapshot、且用户明确要求整篇替换时，才允许把 snapshot 传回 `write_node_document`；该高级路径会保留 canvas-editor 表格、带内部竖线的分栏块和单元格内容。外部助手不应该手工拼散乱样式块或空文本块。

Chrome 端口只暴露两个工具：`chrome_ports_status` 和 `chrome_port_open_page`。前者返回平台、端口、默认地址、登录/连接状态和当前检测页面；后者按 `platformId` 和可选 `url` 启动或复用固定端口 Chrome。当前平台包含 `doubao`、`chatgpt`、`bilibili`、`zhihu`、`zhaopin`、`zhipin` 和 `xiaohongshu`。AIstudy 不在 MCP 里执行网页脚本。

内网访问使用 Tailscale Serve，不使用 Funnel，不开放公网。远程 MCP 默认只读；需要外部设备编辑时，在设置页打开远程编辑总开关，并按知识库管理、导图编辑、文档写入、删除操作分别授权。完整流程见 `docs/mcp/AIstudy-MCP-tailscale-access.md`。

更完整的新人接入文档见 `docs/mcp/AIstudy-MCP-quickstart.md`。
