# AIstudy Public Codex 接手说明书

本文档给接手本公开版项目的 Codex 使用。它是开发侧资料，不进入安装包；打包配置只包含 `dist/**/*`、`dist-electron/**/*`、`build/icon.ico` 和 `package.json`。

## 1. 项目身份

- 公开版本地仓库：`F:\XIANGMU\AIstudy-public`
- GitHub 仓库：`https://github.com/SnowLove0303/AIstudy-Public.git`
- 应用名：`AIstudy`
- 当前包名：`aistudy`
- 当前版本号：`0.1.68`，以 `package.json` 的 `version` 为准
- 公开版定位：开发端、发布端、纯净版基线
- 自用版仓库：`F:\XIANGMU\AIstudy`

后续常规开发只改公开版。不要为了同步功能直接修改自用版代码；自用版应该通过公开版发布的新安装包更新，且保留用户自己的数据库和运行数据。

## 1.1 当前接手状态

最近一轮开发集中在 MCP、知识库主界面、思维导图工具和文档编辑器：

- 最新安装包：`release\AIstudy-Setup-0.1.68.exe`
- 最新免安装运行版：`release\win-unpacked\AIstudy.exe`
- 最新更新摘要见：`docs/updates/INDEX.md`
- 当前主要分支：`codex/mcp-control-panel`
- 当前公开版已经具备 MCP 设置页、Tailscale 内网访问、远程权限细分、远程调用监控、导图/文档 MCP 读写工具、知识库本地路径复制、数据库更新保护、左右侧栏折叠、导图快捷键设置、右键文字排版浮层、右侧文档格式面板、端口管理和信息采集入口。
- 最近一轮更新集中在一键打包、导图打开/切换性能、信息采集入口、右侧格式面板、端口支持和 ChatGPT CDP 发送稳定性。

接手时先注意：以 `git status --short --branch` 为准判断工作区状态；如果已有未提交改动，不要用 `git reset --hard` 或 checkout 回滚用户改动。

## 2. VS Code 接管方式

优先打开公开版目录：

```powershell
code F:\XIANGMU\AIstudy-public
```

推荐在 VS Code 内开一个 PowerShell 终端，工作目录保持为：

```powershell
F:\XIANGMU\AIstudy-public
```

接手后先跑：

```powershell
git status --short --branch
npm run setup:doctor
```

如果要本地开发调试：

```powershell
npm run dev:app
```

日常功能验证不需要打安装包。`npm run dev:app` 会先编译 Electron 主进程和 preload，再启动 Vite + Electron；渲染器 UI 改动热更新，主进程或 preload 改动时停止后重跑该命令即可。

如果要验证构建：

```powershell
npm run build
```

如果要正式打包：

```powershell
npm run dist:oneclick
```

用户当前更偏向直接打包验证安装版。涉及 UI、Electron、MCP 或 preload 变更时，完成后默认执行：

```powershell
npm run build
npm run update:record -- "本次更新说明"
npm run dist:oneclick
npm run update:record -- "本次更新说明"
```

`dist:oneclick` 会重新写一次 `docs/updates/INDEX.md`，所以打包后要再恢复真实更新说明。

## 3. 运行环境与数据边界

公开版默认运行数据目录：

```text
AIstudyPublicData
```

可以用环境变量覆盖：

```text
AISTUDY_PUBLIC_DATA_ROOT
AISTUDY_PUBLIC_RUNTIME_ROOT
```

公开版默认 MySQL：

```text
host: 127.0.0.1
port: 3306
user: root
password: 空
database: aistudy_public
```

公开版数据库名和表名固定，运行时配置只用于 MySQL 连接四项：`host`、`port`、`user`、`password`。不要恢复旧 `aistudy` 库自动检测，也不要把 database/table 环境变量描述为公开版能力。

可参考 `.env.example`，也可用运行时配置：

```text
AIstudyPublicData/config/mysql.config.json
```

用户安装 exe 后接自己的数据库。后续更新公开版安装包时，不应该覆盖用户的数据库连接、课程数据、文档快照、导图快照、错误日志和本地运行目录。

## 4. 核心架构

技术栈：

- Electron main：窗口生命周期、系统能力、文件访问、MySQL、更新、错误日志、IPC
- React renderer：界面组合、课程侧栏、导图区、文档区、设置区
- TypeScript：主进程、预加载脚本、渲染器统一类型约束
- Vite：渲染器构建
- electron-builder：Windows NSIS 安装包
- MySQL：正式结构化数据源
- `simple-mind-map`：思维导图编辑器
- `@hufe921/canvas-editor`：类 Word 文档编辑器

关键入口：

```text
electron/main.ts
electron/preload.cts
electron/appErrors.ts
electron/coreContract.ts
src/renderer/main.tsx
src/renderer/styles.css
src/renderer/domain/coreContracts.ts
```

核心设计基线见：

```text
docs/ARCHITECTURE.md
docs/功能规划/系统核心逻辑冻结契约.md
docs/功能规划/底层架构分层约束.md
```

## 5. 模块边界

主要渲染器模块：

```text
src/renderer/features/course        课程与分区
src/renderer/features/mindmap       思维导图
src/renderer/features/documents     Word 文档
src/renderer/features/importer      导入器 UI 与解析
src/renderer/features/assistant     AI 助手
src/renderer/features/chromePorts   Chrome 端口配置
src/renderer/features/mcp           MCP 设置页与控制台 UI
electron/mcp                        MCP 控制器、外部 stdio server、Tailscale 内网访问
```

模块开发原则：

- 新功能优先放进独立模块。
- 模块有清晰 README，写清范围、用户流程、数据边界和后续扩展点。
- 渲染器不直接访问 MySQL。
- 课程、分区、导图、文档、更新、错误日志都通过 preload 暴露的 IPC 能力访问主进程。
- 不要把新逻辑继续塞进一个大组件里。
- 新功能开发前，先查 GitHub 或成熟开源项目是否有可参考方案。

## 6. 数据与存储逻辑

课程和分区：

- MySQL 是正式索引源。
- 本地 `courses.json` 只是轻量镜像和降级副本。
- MySQL 写失败时，课程/分区命令进入 pending 队列，后续恢复时重放。

思维导图：

- 保存完整 `simple-mind-map` 快照。
- 同步投影到 `mind_map_nodes`，用于目录、搜索、文档绑定。
- 节点 id 是稳定连接键，改标题不能改 id。
- 文字排版工具不放在顶部工具栏，选中主题后在导图画布右键弹出浮层。
- 分支排版类动作走快捷键，设置页提供快捷键配置。
- 主题元素已接入：备注、标签、链接、图片、优先级、进度、折叠/展开。

文档：

- `knowledge_documents` 只存节点文档当前指针和元信息。
- `knowledge_document_snapshots` 存 canvas-editor JSON 快照。
- 文档和导图通过 `(course_id, mind_map_id, node_id)` 绑定。
- 文档编辑器使用宽纸张纵向阅读流，页面尺寸由当前工作区宽度计算；不要再把 page width/height 交换传入 `canvas-editor`，也不要在正常文档工作区使用 `PaperDirection.HORIZONTAL`。

MCP：

- MCP 是独立模块，不依赖用户当前 UI 选中项。
- 读取、搜索、编辑均应显式支持全库/指定知识库目标。
- 远程内网访问使用 Tailscale Serve，只面向同一 tailnet，不做公网 Funnel。
- 远程编辑权限必须细分，默认只读。
- 远程调用监控可开关，开启后记录外部设备调用工具、来源、状态、耗时和时间。
- 内网访问开关状态需要持久化，应用重启后自动恢复 HTTP 服务和 Tailscale Serve。
- 外部 MCP server 要懒加载运行状态，MySQL 不可用时不应导致 MCP 初始化失败；健康检查负责报告数据库和数据目录状态。

资产：

- 大图、附件、后续导入素材必须走资产表和本地文件存储。
- 不要把大 base64 长期塞进导图或文档 JSON。

错误日志：

- 前端只给用户看人话。
- 主进程记录错误码、技术细节和上下文到 `app_error_logs`。
- 设置页负责展示用户可读错误日志。

## 7. 核心功能使用方式

课程/分区：

- 左侧是知识库课程列表。
- 分区按 Notion 风格折叠展示。
- 后续拖拽排序应走专用 reorder IPC，不要全量重写课程 store。
- 左侧知识库栏可折叠，但折叠时不能让中间导图/文档画布消失；CSS Grid 中画布必须固定在中间列。

思维导图：

- 顶部切换到“导图”。
- 使用 `simple-mind-map` 编辑节点、样式和导出。
- 导图保存后主进程写快照与节点投影。
- 顶部工具栏保留主题元素、撤销重做、缩放、画布拖拽、布局、导出和保存。
- 不再把文字排版塞在顶部；右键浮层必须通过画布区域的捕获阶段右键事件打开，避免被 `simple-mind-map` 内部 SVG 事件吞掉。
- 主题气泡支持右边框拖拽伸缩；这是气泡尺寸，不是文本框尺寸，文字布局必须随气泡一起变化。
- 默认分支快捷键：
  - `Tab`：子主题
  - `Enter`：同级主题
  - `Shift+Enter`：父主题
  - `Ctrl+Alt+L`：整理布局
  - `Ctrl+Alt+R`：关系线
  - `Ctrl+Alt+B`：边界
  - `Ctrl+Alt+S`：概要

Word 文档：

- 顶部切换到“文档”。
- 右侧目录节点绑定当前节点的详细文档。
- 文档内容按 canvas-editor 快照保存。
- 当前文档页宽应随编辑区宽度展开，避免右侧大空白和并排空白页。
- 当前节点文档支持导出 `.docx`；导出走 Electron main 的文件选择和写入，不改变文档快照。

主界面布局：

- 左侧知识库栏和右侧目录栏都有折叠按钮。
- 左侧分区支持一键展开和一键收起；分区间保持 Notion 风格留白。
- 左上角只保留大标题“知识库”，不要再加重复小标题。
- 右侧目录只保留“目录”，不要再显示上方“导图”小字。
- 折叠侧栏时，只隐藏侧栏内容并释放宽度，不允许把中间画布排到 0 宽列。

设置：

- 设置页包含环境检查、MCP 控制台、快捷键、更新管理、报错日志。
- MCP 控制台采用纵向 Windows 设置风格；不要回到多列工程卡片样式。
- 快捷键页存储导图分支排版快捷键，使用本地持久化。

导入器：

- 当前 UI 入口是文档区导入弹窗。
- 支持拖拽 `.txt`、`.md`、`.markdown`、`.docx`。
- 批量重文档导入走脚本 `scripts/importers/import-docx-to-node-documents.mjs`。
- 导入后用 `scripts/importers/audit-docx-import.mjs` 审计内容和排版。

端口管理：

- 固定端口平台包含豆包、ChatGPT、Bilibili、知乎、智联招聘、BOSS 直聘、小红书。
- 端口页只负责登录、状态检测和打开目标页面；网页内部点击、输入和读取交给 AI 助手、信息采集或外部 MCP 客户端。

更新：

- GitHub 仓库仍是版本管理来源。
- `package.json` 的 `aistudy.updateDownloadMirrors` 可配置更快的安装包分发镜像。
- 下载更新需要支持进度、暂停、恢复、取消。
- 用户更新后不能丢自己的数据库和运行数据。
- 数据库和运行目录保护是硬要求；版本更新不能覆盖用户的数据库连接、课程、导图、文档、MCP 内网访问状态。

MCP 内网访问：

- 设置页开启“内网访问”后，需要展示并可复制三行：

```text
MCP URL: ...
API URL: ...
Authorization: Bearer ...
```

- 复制内容只保留这三行，避免外部设备粘贴时混入额外说明。
- 若另一台设备反馈 TCP 超时，先检查本机 AIstudy 是否仍打开、Tailscale 是否在线、Serve 是否恢复、端口是否监听。

## 8. 常用命令

```powershell
npm run setup:doctor        # 检查开发环境
npm run setup:install       # 安装/补齐依赖
npm run dev:app             # 日常开发验证，不打安装包
npm run dev                 # 原始 Vite + Electron 调试入口
npm run build               # TypeScript + Vite + Electron 构建
npm run qa:error-codes      # 构建并校验错误码体系
npm run dist:oneclick       # 关闭旧实例并打包 NSIS 安装包
npm run import:docx         # 批量 DOCX 导入
npm run audit:docx-import   # 导入结果审计
npm run arch:knowledge:index # 生成架构知识库节点索引
```

Codex 接手文档同步：

```powershell
npm run codex:handoff:sync
npm run codex:handoff:commit
```

`sync` 只干跑，`commit` 才写入 `AIstudy 全量功能架构` 知识库节点 `arch_14_scripts_docs_09`。

## 9. 架构知识库同步规则

开发公开版功能时，除了改代码和 README，还要把功能需求、架构逻辑、数据边界、错误策略、验证记录补到知识库：

```text
AIstudy 全量功能架构
```

本地脚本：

```text
scripts/architecture-knowledge/sync-architecture-doc.mjs
```

常用流程：

```powershell
npm run arch:knowledge:sync -- --search="关键词"
npm run arch:knowledge:sync -- --file="docs/architecture-knowledge/work/current-feature.md" --node-id="目标节点"
npm run arch:knowledge:sync -- --file="docs/architecture-knowledge/work/current-feature.md" --node-id="目标节点" --commit
```

默认连接自用架构库 `aistudy`，不是公开版运行库 `aistudy_public`。这是刻意设计：公开版代码开发资料同步到私有架构知识库，但不进入用户安装包。

## 10. 交付前检查

普通代码改动至少检查：

```powershell
npm run build
```

涉及错误码：

```powershell
npm run qa:error-codes
```

涉及导入：

```powershell
npm run audit:docx-import
```

涉及安装包：

```powershell
npm run dist:oneclick
```

交付前要确认：

- 只改公开版。
- 没有误动自用版。
- 开发侧 docs/scripts 没进入打包产物。
- 用户数据库和运行数据不会被安装包覆盖。
- 新功能对应模块 README 或主 README 已补。
- 功能开发内容已同步或准备同步到 `AIstudy 全量功能架构`。
- 如果打包发布，确认 `release\AIstudy-Setup-当前版本.exe` 与 `release\win-unpacked\AIstudy.exe` 均已更新。
- 如果使用 `npm run dist:oneclick`，打包后检查并恢复 `docs/updates/INDEX.md` 的真实更新摘要。

## 11. 最近版本记录

- `0.1.68`：一键打包生成安装包。
- `0.1.67`：优化主思维导图打开和切换速度，减少快照重复规范化，并在文档/导图切换时保留导图画布实例。
- `0.1.66`：信息采集板块调整，仅保留导航入口。
- `0.1.65`：将信息采集加入主导航。
- `0.1.64`：新增 Bilibili 与知乎固定 Chrome 调试端口管理。
- `0.1.63`：将文档格式面板移入右侧详情栏。
- `0.1.62`：修复设置弹窗层级，避免被导图画布遮挡。
- `0.1.61`：修复 ChatGPT 桥接发送链路，准备输入后使用 CDP Enter 键发送，避开 ChatGPT 页面对外部鼠标点击不稳定的问题。
- `0.1.60`：修复 ChatGPT 桥接发送链路，准备输入后使用 CDP 真实鼠标点击发送，再按网页回合顺序读取回复，避免 `user-block-not-created`。
- `0.1.59`：增强 AI 助手 ChatGPT 桥接，发送按钮等待延长到 30 秒，适配 ChatGPT 页面慢切换。
- `0.1.58`：修复 Node `ws` 返回 Buffer 时 CDP 消息解码错误，确保应用内 AI 助手能解析 `Runtime.evaluate` 返回值。
- `0.1.57`：主进程 CDP 通讯改用 Node `ws` 客户端，修复应用内 AI 助手调用 ChatGPT 页面时拿不到 `Runtime.evaluate` 返回值的问题。
- `0.1.56`：修复导图 `_e is not a function`，改回导图核心包加必要插件白名单；重做 ChatGPT 桥接读取逻辑，按本次发送后的回合顺序获取回复。

- `0.1.55`：修复 AI 聊天助手桥接，支持从 `chrome.cmd` 解析真实 Chrome 路径，并增强 ChatGPT 输入后发送按钮等待逻辑。
- `0.1.54`：导图运行时改用 `simple-mind-map/full`，修复打包版导图初始化 `is not a constructor`。
- `0.1.53`：关闭导图自由节点定位，清理旧自由坐标，避免右向逻辑布局分支穿线和跨组错位。
- `0.1.52`：修正文档编辑器右侧并排空白页，宽纸张改为纵向阅读流，窗口或侧栏尺寸变化后自动重建编辑器。
- `0.1.51`：修正文档编辑器横向页面尺寸，减少右侧无效空白。
- `0.1.50`：修复左侧知识库栏折叠后导图画布被挤到零宽的问题。
- `0.1.49`：去掉知识库/目录重复标题，新增左右侧栏折叠按钮。
- `0.1.48`：修复导图画布右键文字排版菜单不弹出。
- `0.1.47`：导图工具栏瘦身，文字排版改右键浮层，分支排版改快捷键。
- `0.1.46`：补齐 Xmind 常用主题元素工具。
- `0.1.45`：MCP 内网访问状态持久化，重启后自动恢复。
- `0.1.44`：MCP 内网访问远程编辑权限细分。
- `0.1.43`：MCP 内网访问远程调用监控。
- `0.1.42`：MCP 内网访问复制内容改成三行连接信息。
- `0.1.41`：MCP 设置页展示 MCP URL、API URL、Authorization。
- `0.1.40`：MCP 设置页新增 Tailscale 内网访问开关。

## 12. 关键文件索引

```text
src/renderer/main.tsx
  主界面、设置弹窗、左右侧栏折叠、快捷键设置入口。

src/renderer/styles.css
  全局 UI 样式、三栏布局、文档/导图工作区、MCP 设置页。

src/renderer/features/course/CourseSidebar.tsx
  左侧知识库、分区、课程管理、复制本地路径。

src/renderer/features/mindmap/MindMapWorkspace.tsx
  导图工作区、顶部工具栏、右键文字排版浮层、快捷键执行。

src/renderer/features/mindmap/mindMapShortcutSettings.ts
  导图分支排版快捷键默认值、读取、写入、匹配逻辑。

src/renderer/features/mindmap/simpleMindMapAdapter.ts
  simple-mind-map 命令适配、主题元素、导图快照转换。

src/renderer/features/documents/KnowledgeDocumentWorkspace.tsx
  节点文档加载、保存、工具栏、AI 面板、导入入口。

src/renderer/features/documents/canvasEditorAdapter.ts
  canvas-editor 初始化、页面尺寸、格式命令和快照转换。

src/renderer/features/mcp/McpControlPanel.tsx
  MCP 设置页 UI、工具调试、内网访问、权限、监控。

electron/mcp/
  MCP 控制、远程访问、外部 stdio server。

electron/main.ts
  MySQL、课程/导图/文档 IPC、MCP 工具接入、更新、错误日志。
```

