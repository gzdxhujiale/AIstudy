# AIstudy Public Codex 接手说明书

本文档给接手本公开版项目的 Codex 使用。它是开发侧资料，不进入安装包；打包配置只包含 `dist/**/*`、`dist-electron/**/*`、`build/icon.ico` 和 `package.json`。

## 1. 项目身份

- 公开版本地仓库：`F:\XIANGMU\AIstudy-public`
- GitHub 仓库：`https://github.com/SnowLove0303/AIstudy-Public.git`
- 应用名：`AIstudy`
- 当前包名：`aistudy`
- 当前版本号：`0.1.76`，以 `package.json` 的 `version` 为准
- 公开版定位：开发端、发布端、纯净版基线
- 自用版仓库：`F:\XIANGMU\AIstudy`

后续常规开发只改公开版。不要为了同步功能直接修改自用版代码；自用版应该通过公开版发布的新安装包更新，且保留用户自己的数据库和运行数据。

## 1.1 当前接手状态

截至 2026-06-29，本公开版已从 MCP/知识库主链路扩展到教材、考试和信息采集的完整应用壳：

- 最新安装包：`release\AIstudy-Setup-0.1.76.exe`
- 最新免安装运行版：`release\win-unpacked\AIstudy.exe`
- 最新更新摘要见：`docs/updates/INDEX.md`
- 当前主要分支：`main`
- 本轮 StorageProvider 收口开始前，本地 HEAD 与远端 `origin/main` 一致，提交为 `ecc9ff3 fix: harden public installer mysql runtime`；`git rev-list --left-right --count "HEAD...@{u}"` 为 `0 0`。
- 当前公开版已经具备课程/分区、思维导图、节点 Word 文档、教材 PDF 与节点笔记、题库考试、信息采集、AI 助手、Chrome 固定端口、MCP 设置页、Tailscale 内网访问、远程权限细分、远程调用监控、导图/文档 MCP 读写工具、更新管理、错误日志、数据库更新保护、左右侧栏折叠、导图快捷键设置、右键文字排版浮层和右侧文档格式面板。
- 最近一轮更新集中在纯净公开版默认隔离本机数据目录、AIstudy 管理 MySQL 自动发现、打包源运行数据排除守卫、重复安装时 MySQL 端口解析幂等修复、未连接数据库时的课程侧栏状态提示，以及课程/分区/教材向 DB-first StorageProvider 的首轮收口。

接手时必须先执行 `git status --short --branch` 判断工作区状态。若已有未提交改动，先确认归属，不要用 `git reset --hard` 或 checkout 回滚用户或其他线程的改动。纯净发行版、数据库自动发现和 StorageProvider 收口都会触碰 `electron/main.ts`、打包脚本和文档，后续接手必须先看真实 diff 再继续。

本轮功能遍历确认的主功能目录为 `assistant`、`chromePorts`、`collection`、`course`、`documents`、`exam`、`importer`、`mcp`、`mindmap`、`textbook`。其中 `textbook` 已真实接入主界面、preload、主进程、MySQL 和本地兜底，并已补齐模块 README。

当前应用壳不是多页面路由，而是 `src/renderer/main.tsx` 的单壳多功能区：左侧主导航切换知识库、采集、考试、Chrome 端口和 AI 助手；知识库内部再切换导图、文档、教材；`?view=textbook-pdf` 是教材 PDF 独立窗口的特殊入口。关闭主窗口前会通过 `aistudyLifecycle.onBeforeClose` 统一 drain 导图、文档和教材笔记保存任务；MCP 外部数据变更会触发课程重读和导图/文档刷新修订号。

接手时先注意：以 `git status --short --branch` 为准判断工作区状态；如果已有未提交改动，不要用 `git reset --hard` 或 checkout 回滚用户改动。

## 2. VS Code 接管方式

优先打开公开版目录。Codex 拉起 VS Code 时必须复用统一且已登录的用户数据与扩展目录：

```powershell
code --user-data-dir F:\AIAPP\Codex\vscode-user-data --extensions-dir F:\AIAPP\Codex\vscode-extensions F:\XIANGMU\AIstudy-public
```

推荐在 VS Code 内开一个 PowerShell 终端，工作目录保持为：

```powershell
F:\XIANGMU\AIstudy-public
```

本次接手验证记录（2026-06-28）：

- VS Code 已用统一 `F:\AIAPP\Codex\vscode-user-data` 和 `F:\AIAPP\Codex\vscode-extensions` 打开 `AIstudy-public`。
- 扩展目录中存在 `yutengjing.vscode-mcp-bridge`，日志显示已注册 `health`、`getDiagnostics`、`getSymbolLSPInfo`、`getReferences`、`executeCommand`、`openFiles`、`renameSymbol`、`listWorkspaces` 等服务，并启动本地 pipe；pipe 名每次启动可能变化。
- 当前 Codex 线程未拿到可直接调用 VS Code MCP Bridge 的工具入口。新线程应先用可用工具搜索 VS Code/MCP Bridge；如果仍未暴露，就用 VS Code 打开项目、读取 VS Code 日志，并配合 `rg`、`git`、`npm` 完成代码盘点。
- 系统 `python`、`node`、`npm` 可用，`npm run setup:doctor` 已通过 11 项检查。VS Code Python 扩展可能会扫描到旧的无效 Python 目标；只要项目脚本和 `setup:doctor` 正常，不要把该扩展扫描噪声误判为项目故障。

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
AISTUDY_PUBLIC_USER_DATA_ROOT
AISTUDY_PUBLIC_DATA_ROOT
AISTUDY_PUBLIC_RUNTIME_ROOT
```

`AISTUDY_PUBLIC_USER_DATA_ROOT` 控制 Electron `userData`。开发模式默认是项目下 `.runtime\user-data`；生产包在非 C 盘运行时优先使用 exe 旁边的 `AIstudyUserData`，否则优先落到 `F:\AIstudyPublicCleanData\user-data`。`AISTUDY_PUBLIC_DATA_ROOT` 控制业务数据根，生产包在非 C 盘运行时优先使用 exe 旁边的 `AIstudyPublicData`，否则优先使用 `F:\AIstudyPublicCleanData`。生产包没有显式 `mysql.config.json` 或 `AISTUDY_PUBLIC_MYSQL_*` 环境变量时，不自动连接任意本机默认 MySQL；只有发现 AIstudy 管理的 `%ProgramData%\AIstudy\mysql\my.ini` 时，才按固定 `aistudy_public` 连接并尝试短启动 `AIstudyMySQL` 服务。

运行目录当前包含：

```text
config                 MySQL 配置
state                  courses.json、pending 队列、教材本地缓存、待同步标记和数据库接管标记等
runtime                Chrome profile、端口状态、信息采集运行目录
assets                 大文件和后续素材
updates                更新安装包下载
backups                备份
logs                   日志
locators\courses       课程 locator 文件
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

MySQL 配置优先级从低到高是 AIstudy 管理服务 `%ProgramData%\AIstudy\mysql\my.ini`、`%ProgramData%\AIstudy\mysql.config.json`、`%ProgramData%\AIstudy\AIstudyPublicData\config\mysql.config.json`、`%ProgramData%\AIstudy\AIstudyUserData\mysql.config.json`、exe 旁边 `mysql.config.json`、数据根 `config/mysql.config.json`、Electron `userData/mysql.config.json`，最后由 `AISTUDY_PUBLIC_MYSQL_*` 环境变量覆盖连接四项。数据库名和表名仍固定，不从配置覆盖。

纯净发行版原则：课程分区属于数据库正式数据，不应依赖打包目录里的本地 `courses.json` 镜像来呈现。`npm run dist:oneclick` 会在最终 NSIS 重打包前移除 `win-unpacked` 中的 `AIstudyPublicData`、`AIstudyUserData` 和运行期状态，并用守卫阻断 `courses.json`、`course-pending-operations.json`、`chrome-ports.json`、`mysql.config.json` 等文件进入安装源。安装后应自动检索本机可用的公开版数据库配置或 AIstudy 管理的本机数据库服务，并建立到固定 `aistudy_public` 的连接；如果数据库不可用，UI 必须明确这是本机镜像/本机模式，而不能让用户误以为数据库仍然连接。

DB-first StorageProvider 基线：知识库相关模块必须以数据库为正式事实源，`electron/storageProvider.ts` 只允许把本地 JSON 作为断连兜底缓存。模块接入时要声明并接入同一套能力：自动发现 MySQL 配置或 AIstudy 管理服务、自动连接固定 `aistudy_public`、自动初始化缺失数据表、数据库读写、缓存回写、断连 pending/dirty 标记、恢复后重放或提拔缓存。数据库读取成功后必须刷新本地缓存，包括空数据库结果，避免旧 JSON 在纯净安装或重连后成为第二套事实源。后续课程、导图、文档、教材、考试和资产继续拆模块时，不要让每个模块私自实现一套连接、建表、兜底和同步逻辑。

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
- `pdfjs-dist`：教材 PDF 阅读

关键入口：

```text
electron/main.ts
electron/preload.cts
electron/appErrors.ts
electron/coreContract.ts
src/renderer/main.tsx
src/renderer/styles.css
src/renderer/domain/coreContracts.ts
electron/documentExport.ts
electron/examStore.ts
electron/textbookStore.ts
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
src/renderer/features/textbook      教材 PDF、节点笔记、教材窗口
src/renderer/features/exam          题库、试卷、考试、成绩
src/renderer/features/collection    信息采集
src/renderer/features/assistant     AI 助手
src/renderer/features/chromePorts   Chrome 端口配置
src/renderer/features/mcp           MCP 设置页与控制台 UI
electron/mcp                        MCP 控制器、HTTP/Tailscale 远程访问
scripts/mcp/aistudy-mcp-server.mjs  外部 stdio MCP server
```

当前代码规模，用于判断改动风险和拆分优先级：

```text
src/renderer/features/mindmap       10 files / 4017 lines
src/renderer/features/exam           6 files / 3384 lines
src/renderer/features/documents      4 files / 2659 lines
src/renderer/features/textbook      10 files / 1657 lines
src/renderer/features/course         4 files / 786 lines
src/renderer/features/collection     2 files / 759 lines
src/renderer/features/mcp            2 files / 719 lines
src/renderer/features/assistant      2 files / 328 lines
src/renderer/features/chromePorts    2 files / 199 lines
electron/main.ts                     8537 lines
scripts/mcp/aistudy-mcp-server.mjs   2714 lines
electron/mcp/controller.ts           1296 lines
electron/mcp/remoteAccess.ts         755 lines
```

模块开发原则：

- 新功能优先放进独立模块。
- 模块有清晰 README，写清范围、用户流程、数据边界和后续扩展点。
- 当前 `src/renderer/features/textbook/` 已接入主界面和主进程，并已补齐模块 README；后续继续开发教材功能时要同步维护该模块说明。
- 渲染器不直接访问 MySQL。
- 课程、分区、导图、文档、考试、教材、MCP、Chrome 端口、信息采集、更新、错误日志都通过 preload 暴露的 IPC 能力访问主进程。
- 不要把新逻辑继续塞进一个大组件里。
- 新功能开发前，先查 GitHub 或成熟开源项目是否有可参考方案。

preload 当前暴露的前端 API：

```text
aistudyWindow
aistudyClipboard
aistudyCourseLocators
aistudyCourses
aistudyCourseSections
aistudyMindMaps
aistudyKnowledgeDocuments
aistudyExams
aistudyTextbooks
aistudyMcp
aistudyChromePorts
aistudyInformationCollection
aistudyAssistant
aistudyLifecycle
aistudyUpdates
aistudyErrorLogs
aistudyRuntime
```

新增前端能力前必须先确认是否应该走现有 API；不要绕过 preload 直接访问主进程、文件系统或 MySQL。

## 6. 数据与存储逻辑

固定 MySQL 表：

```text
course_management_courses
knowledge_sections
mind_maps
mind_map_snapshots
mind_map_nodes
knowledge_documents
knowledge_document_snapshots
knowledge_assets
knowledge_asset_links
chrome_port_states
app_error_logs
exam_questions
exam_papers
exam_paper_sections
exam_paper_questions
exam_attempts
textbook_assets
textbook_notes
```

课程和分区：

- MySQL 是正式索引源。
- 本地 `courses.json` 只是轻量镜像和降级副本，不能作为纯净发行版的初始数据源。
- `courses:load` 走 DB-first StorageProvider：MySQL 读取成功后会把数据库结果写回 `courses.json` 缓存，即使数据库当前为空也不能继续保留旧镜像。
- 分区、课程排序、折叠状态等入口索引原则上都应落在数据库里；纯净安装包里的初始分区/课程状态应为空，由安装后的本机数据库连接或用户真实数据恢复。
- MySQL 写失败时，课程/分区命令进入 pending 队列，后续恢复时重放。
- pending 队列支持 `course:create/rename/move/reorder/delete` 和 `section:create/rename/reorder/toggle/toggle-all/delete`；重放失败会保留剩余队列、递增 `retryCount` 并记录 `lastError`，不能直接丢弃。
- 课程可生成 `locators/courses/{课程名}__{courseId}.aistudy-course.json`，用于外部工具稳定定位数据根、固定 MySQL 表和课程身份。

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

教材：

- 教材模块按 `(course_id, mind_map_id)` 作用域读取和保存。
- 教材资产写入 `textbook_assets`，节点笔记写入 `textbook_notes`，本地兜底文件位于 `state/textbooks/{courseId}__{mindMapId}.json`。
- 教材 PDF 通过 `aistudy-pdf` 特权协议和独立 PDF 窗口打开，阅读器使用 `pdfjs-dist`。
- PDF 阅读器按当前页附近懒渲染并缓存页面，支持页码、缩放、页数回写和独立窗口。
- 教材笔记绑定到节点和页段，可保存 canvas-editor 富文本快照，关闭前会进入统一保存 drain，并可合并进对应节点 Word 文档。
- 教材读取、保存和 PDF 字节读取都走 DB-first StorageProvider。MySQL 可用时以 `textbook_assets`、`textbook_notes` 为准并回写本地缓存；本地 JSON 只在 MySQL 不可用或显式 dirty 时参与恢复。
- 教材断连保存会写入本地缓存并在 `state/textbook-pending-scopes.json` 标记作用域；重连后按 `updatedAt` 提拔到 MySQL，资产按 `asset.id` 合并，笔记按 `textbookId + nodeId` 合并。`state/textbook-database-backed-scopes.json` 记录已经被数据库接管的作用域，避免数据库后续为空时被旧 JSON 反向覆盖。若作用域尚未被数据库接管、数据库为空且旧本地缓存有内容，会先把本地缓存迁入数据库，避免升级时丢旧数据；若数据库已有内容或作用域已被接管且缓存未 dirty，则不让旧 JSON 覆盖数据库。
- 旧版 `mindMapId === courseId` 教材作用域会自动迁移到真实导图作用域。
- 当前教材文件路径仍保存在资产记录中，后续如果做跨机器迁移，要检查路径相对化和资产复制策略。

考试：

- 考试模块通过 `exams:load` / `exams:save` 读写。
- 固定表包括 `exam_questions`、`exam_papers`、`exam_paper_sections`、`exam_paper_questions`、`exam_attempts`。
- 题库、试卷、考试作答、自动评阅和成绩记录均按课程作用域隔离。
- 题库可以从当前知识文档导入结构化题目，也支持 JSON 导入导出。
- 试卷支持分区编排；作答超时会自动交卷，未答题交卷前会确认；评分是确定性规则，单选/多选/判断按答案集合匹配，简答按标准答案或关键词匹配。
- `politics2026Seed.ts` 提供“2026 年考研政治真题”写入入口。维护考试模块时必须把它当真实内容资产处理，核对来源和命名，不能把测试题或示例题混进用户题库。

MCP：

- MCP 是独立模块，不依赖用户当前 UI 选中项。
- 读取、搜索、编辑均应显式支持全库/指定知识库目标。
- 客户端接入第一步必须调用 `mcp_get_started`；需要精确目标时先走 `mcp_resolve_target`，不要猜 `courseId` 或 `nodeId`。
- MCP 暴露 `resources/list`、`resources/read`、`prompts/list`、`prompts/get`，用于外部 Codex/Claude Code 自读流程。
- 远程内网访问使用 Tailscale Serve，只面向同一 tailnet，不做公网 Funnel。
- 远程编辑权限必须细分，默认只读。
- 远程权限组是 `course`、`mindmap`、`document`、`destructive`；未开启总编辑权限时，远程只开放读取和 Chrome 打开页面类工具。
- 远程调用监控可开关，开启后记录外部设备调用工具、来源、状态、耗时和时间。
- 内网访问开关状态需要持久化，应用重启后自动恢复 HTTP 服务和 Tailscale Serve。
- 外部 MCP server 要懒加载运行状态，MySQL 不可用时不应导致 MCP 初始化失败；健康检查负责报告数据库和数据目录状态。
- 文档写入工具有安全分工：`write_node_document` 只用于新文档或显式 `replaceExisting=true` 的全文覆盖；追加用 `append_node_document`；只整理样式用 `format_node_document`；简单全文样式用 `update_node_document_style`。

资产：

- 大图、附件、后续导入素材必须走资产表和本地文件存储。
- 不要把大 base64 长期塞进导图或文档 JSON。

错误日志：

- 前端只给用户看人话。
- 主进程记录错误码、技术细节和上下文到 `app_error_logs`。
- 设置页负责展示用户可读错误日志。

信息采集：

- 信息采集模块当前重点是 Bilibili 视频定位、视频信息、字幕/转写和写入已有知识文档。
- 渲染器只呈现采集流程，实际平台请求、Chrome cookie、字幕下载、转写工具检测和写入由主进程处理。
- 采集流程会先尝试 BV/短链解析、UP 搜索、WBI 签名接口、视频详情、公开字幕、简介文字稿，再根据工具状态进入字幕下载、音频下载和 Whisper 转写。
- 写入 Word 前会把字幕/文字稿整理成标题、条目和段落，生成 `aistudy-word` 快照；目标节点已有内容时，前端会要求确认覆盖。
- 缺少真实字幕、下载工具或转写工具时，不能用虚拟内容代替真实采集结果。
- Bilibili cookie 来自固定端口 Chrome 的 CDP cookie 读取；若遇到 412、访问频繁或未登录，应该引导用户到端口管理打开 B站并保持登录。
- 运行目录是 `runtime/information-collection/bilibili/{BV号}`，会保存 cookie 文件、下载字幕、官方文字稿、音频和转写中间产物；这些是运行缓存，不是知识库正式数据。

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

教材：

- 顶部切换到“教材”。
- 支持选择 PDF 教材、打开独立阅读窗口、记录当前页、为当前节点写教材笔记。
- 教材笔记可以合并到当前节点 Word 文档；合并前要保证当前节点、当前教材和当前笔记都是真实存在的。

考试：

- 左侧主导航进入“考试”。
- 支持题库维护、从当前知识文档提题、题库 JSON 导入导出、试卷编排、考试作答、自动评阅和成绩查看。
- 考试数据必须按当前课程隔离；不得把测试题或示例题伪装成用户真实题库。

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
- 环境检查覆盖核心数据目录、本机恢复文件、MySQL、报错日志、Chrome、各固定端口、信息采集目录、`yt-dlp`、`ffmpeg`、`whisper` 和更新源。
- 更新管理读取 GitHub latest Release，按 `aistudy.updateAssetPattern` 或默认 exe 规则选择安装包，支持镜像 URL、分块 Range 下载、暂停、继续、取消和下载完成后启动安装程序。
- 报错日志页只展示用户可读消息、来源、编号、建议和是否可重试；技术细节留在主进程 `app_error_logs`。

导入器：

- 当前 UI 入口是文档区导入弹窗。
- 支持拖拽 `.txt`、`.md`、`.markdown`、`.docx`。
- 批量重文档导入走脚本 `scripts/importers/import-docx-to-node-documents.mjs`。
- 导入后用 `scripts/importers/audit-docx-import.mjs` 审计内容和排版。

信息采集：

- 当前主导航有“采集”入口。
- Bilibili 采集依赖固定 Chrome 端口登录态和真实视频/字幕/转写链路。
- 采集结果写入已有课程、导图节点和文档链路，不单独制造孤立内容。
- 本机工具检查包括 `yt-dlp`、`ffmpeg`、`whisper`。工具缺失时流程要停在对应步骤并给可读原因，不允许写入假转录。

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

- 设置页开启“内网访问”后，复制内容必须只包含三行；界面可遮罩 Authorization，但复制结果必须保留完整 token：

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
npm run qa:data-boundaries  # 校验 DB-first、本地缓存、preload 和打包数据边界
npm run qa:math-clipboard   # 校验 ChatGPT/KaTeX/MathML/纯文本数学粘贴解析
npm run qa:textbook         # 构建并校验教材资产/笔记/PDF 批注数据合同
npm run qa:error-codes      # 构建并校验错误码体系
npm run dist:oneclick       # 关闭旧实例并打包 NSIS 安装包
npm run shortcuts:refresh   # 刷新桌面、开始菜单或固定栏快捷方式指向
npm run import:docx         # 批量 DOCX 导入
npm run audit:docx-import   # 导入结果审计
npm run arch:knowledge:index # 生成架构知识库节点索引
npm run github:sync:doctor  # 检查 GitHub 发布与版本同步状态
npm run github:sync:fix     # 按脚本规则修复 GitHub 发布同步问题
```

`setup:doctor` 会检查 Node、npm、lockfile、node_modules、Electron 二进制、electron-builder、项目本地构建缓存和公开版 MySQL 模板。`setup:install` 和 `dist:oneclick` 都使用项目内 `.tmp\build-cache\npm`、`.tmp\build-cache\electron`、`.tmp\build-cache\electron-builder`，不要把构建缓存散落到 C 盘。

`dist:oneclick` 当前闭环：

```text
关闭旧 packaged AIstudy 进程
停止占用 release\win-unpacked\AIstudyPublicData 和 AIstudyUserData 的运行进程
保留 win-unpacked 里的便携运行数据和 Electron userData
清理旧 release 产物
写入更新索引
执行 npm run dist
必要时用 prepackaged win-unpacked 重试 NSIS
从 win-unpacked 移除本机运行数据目录，并用清理后的 prepackaged win-unpacked 重建最终 NSIS 安装器
恢复便携运行数据
刷新并校验桌面、开始菜单快捷方式
写出 release\build-manifest.json，记录版本、commit、dirty 状态和产物 hash
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
- 纯净发行版安装包不包含 `AIstudyPublicData/state/courses.json`、`course-pending-operations.json`、`textbook-pending-scopes.json`、`textbook-database-backed-scopes.json`、教材本地兜底、Chrome profile、MySQL 配置或任何验证机运行数据；`dist:oneclick` 的纯净源守卫必须通过；新装应先通过本机数据库配置/服务建立连接，无法连接时再进入明确的本机空镜像模式。
- 打包后确认 `release\build-manifest.json` 已写出，并能追溯安装包版本、commit、dirty 状态和 artifact hash。
- 新功能对应模块 README 或主 README 已补。
- 功能开发内容已同步或准备同步到 `AIstudy 全量功能架构`。
- 如果打包发布，确认 `release\AIstudy-Setup-当前版本.exe` 与 `release\win-unpacked\AIstudy.exe` 均已更新。
- 如果打包发布，先杀死旧实例，打包后打开最新版本实际验证，并确认桌面、开始菜单、固定栏或其他快捷方式指向最新版本。
- 如果使用 `npm run dist:oneclick`，打包后检查并恢复 `docs/updates/INDEX.md` 的真实更新摘要。
- 发布前建议运行 `npm run github:sync:doctor`，确认 origin、upstream、ahead/behind、工作区、GitHub CLI 登录和 latest release 安装包资产状态。

开发线程权限边界：

- 后续开发线程默认拥有开发相关全权限。除 Codex 全局记忆和当次用户/主管明确任务要求外，不再额外限制开发线程能做的开发、验证、文档、脚本、打包、提交、推送或发布准备动作。
- 开发线程做任何动作仍必须遵守全局记忆里的真实测试、GitHub 管理、VS Code 接管、C 盘占用限制、用户数据保护、凭据安全、需求不清先问清和不回滚他人改动等要求。
- 版本管理、主管、审计和发行线程可以提供协作建议、验收或专项支持；除非用户或主管在具体任务中明确要求，否则这些角色不作为开发线程权限限制。

## 11. 最近版本记录

- `0.1.76`：接入 AIstudy 管理 MySQL 自动发现和短启动，安装器 MySQL 配置改为 UTF-8 无 BOM 写入，修复重复安装时 `[mysqld]`/`[client]` 多端口解析导致的参数转换失败，并为 `dist:oneclick` 增加纯净安装源运行数据守卫；后续补充教材 PDF 批注 DB-owned 服务拆分、`storageBoundary` 数据边界清单、数学粘贴共享解析模块、`qa:data-boundaries`、`qa:math-clipboard`、`qa:textbook` 和 `release/build-manifest.json`。
- `0.1.75`：纯净公开版默认隔离本机数据目录，并在未显式配置 MySQL 时避免读取本机旧数据库内容。
- `0.1.74`：修复教材节点页段绑定状态隔离、已绑定锁定/取消重设，并清理教材 PDF 独立窗口残留。
- `0.1.73`：修复教材资产与节点笔记按课程和导图作用域读取保存、教材页段绑定切换和持久化问题，并优化文档内 AI 小窗拖动体验。
- `0.1.72`：一键打包生成安装包。
- `0.1.71`：Word 导出按 AIstudy 文档快照格式生成。
- `0.1.70`：标准化信息采集页 Bilibili 视频定位链路。
- `0.1.69`：修复 Chrome 端口已保存登录状态持久化，并兼容 Bilibili API success code。
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

src/renderer/features/textbook/
  教材 PDF、节点教材笔记、PDF 阅读窗口和笔记合并到 Word 文档。

src/renderer/features/exam/
  题库、试卷、考试作答、自动评阅、成绩记录和 JSON 导入导出。

src/renderer/features/collection/
  信息采集页面，当前重点是 Bilibili 视频定位、字幕/转写和写入知识文档。

src/renderer/features/assistant/
  AI 助手页面和文档内紧凑面板，本地保存最近对话，发送由主进程固定端口自动化完成。

src/renderer/features/chromePorts/
  固定 Chrome 调试端口登录、状态检测、打开页面和短时登录监控。

src/renderer/features/importer/
  文档导入弹窗、DOCX/TXT/Markdown 解析和导入包结构。

src/renderer/features/mcp/McpControlPanel.tsx
  MCP 设置页 UI、工具调试、内网访问、权限、监控。

electron/mcp/
  MCP 控制器和 HTTP/Tailscale 远程访问。

scripts/mcp/aistudy-mcp-server.mjs
  外部 stdio MCP server。

electron/preload.cts
  渲染器安全 API 暴露层，负责把主进程能力包装给前端并清洗错误。

electron/documentExport.ts
  Word 文档快照导出 DOCX。

electron/examStore.ts
  考试模块 MySQL 表结构、读写和软删除同步。

electron/textbookStore.ts
  教材资产、节点教材笔记、PDF 资产记录和 MySQL/本地兜底读写。

electron/main.ts
  MySQL、课程/导图/文档/考试/教材 IPC、MCP 工具接入、Chrome 端口、信息采集、AI 助手、更新、错误日志。
```

## 13. 当前查漏结果

- `src/renderer/features/textbook/` 原本缺 README，本轮已补齐；后续教材功能变化要同步维护该 README。
- `scripts/mcp/aistudy-mcp-server.mjs` 的 Chrome 端口平台列表缺少 `xiaohongshu`，而 `electron/main.ts`、`electron/mcp/controller.ts` 和 MCP 文档已经包含小红书 `9235`；后续改 MCP 端口能力时要先同步这里。
- `docs/deployment-new-machine.md` 已改为当前版本通用安装包示例；具体版本仍必须以 `package.json`、`docs/updates/INDEX.md` 和 `release/AIstudy-Setup-*.exe` 为准。
- `docs/ARCHITECTURE.md` 的 “Current Implemented Surfaces” 已同步到 `0.1.76`，并补充教材、DB-first 边界、QA 和打包 manifest 规则。
- `electron/main.ts` 仍承载大量业务服务逻辑，但教材 PDF 批注已经抽到 `electron/textbookAnnotationService.ts`。继续扩展考试、教材、采集或 MCP 时，优先抽到独立 main-side service 文件，再通过 preload 暴露，不要继续扩大主进程巨文件。
- DB-first 数据边界已新增 `electron/storageBoundary.ts`，`npm run build` 会先跑 `qa:data-boundaries`；后续新增本地缓存、preload 能力或打包运行数据时要同步更新该清单和 QA 守卫。
- ChatGPT/KaTeX/MathML/纯文本数学粘贴已抽到 `src/renderer/features/mathInput/`，`npm run build` 会先跑 `qa:math-clipboard`；后续改教材或节点文档粘贴逻辑时不要在业务组件内另起一套符号替换。
- 教材资产、节点笔记和 PDF 批注新增 `npm run qa:textbook` 回归脚本；涉及教材页段绑定、笔记规范化、批注坐标/颜色/数据库归属时必须运行。
- 本轮检索了 `TODO/FIXME/placeholder/mock/sample/lorem/测试/占位/假/dummy/fake`。新增可疑业务假入口未发现；命中主要是历史研究文档里的 fixture/sample 计划、CSS/输入框 placeholder、导入报告 `sample` 字段，以及考试政治真题种子入口。后续如果改 UI，应继续遵守“不展示未接入真实能力的入口”。
- 当前工作区已有用户/历史改动，交接者在任何提交、打包或发布前必须重新跑 `git status --short --branch` 并确认改动归属。

## 14. 新线程培训与交接规则

本线程的职责是维护交接文档和培训新 Codex 线程，不默认接管所有功能开发。新线程交接提示只负责让线程具备完整项目理解和可开发能力，不再强制要求开发线程每次完成任务后回传固定清单。

当前线程角色基线：

- 原主开发线程 `019f02ed-8ce2-7903-a7fa-ce22cc391c18` 仅作历史参考，不再承接新开发、打包、提交、推送或发布任务。
- 当前主开发线程是 `019f0dbe-a94b-77f0-bfde-ad062f667d03`，负责核心开发、bugfix、架构和数据边界落地。
- 全权限开发线程 `019f0f28-a214-7c32-be2c-a0a4ef71ba8c` 可承担所有开发相关工作；除 Codex 全局记忆和当次任务明确要求外，不额外限制其开发、验证、打包、提交、推送或发布准备动作。
- 版本管理、主管、审计和发行线程保留各自专项职责，但不默认限制开发线程权限；如需限制，以用户或主管当前明确指令为准。

需要开新线程时，交接提示至少包含：

- 项目路径、GitHub 仓库、当前分支和 `git status --short --branch` 摘要。
- 本次任务目标、禁止改动范围、已有未提交改动归属。
- 全量遍历要求：新线程必须先用 VS Code 打开项目，并对 `F:\XIANGMU\AIstudy-public` 整个文件夹做 1-3 轮全量遍历；至少用 `rg --files` 或等效方式扫过 docs、scripts、electron、src/renderer/features、release、配置和关键入口，达到能直接开发和判断风险的程度后再进入具体任务。
- 必读文件：本文件、`README.md`、`docs/README.md`、`docs/ARCHITECTURE.md`、`docs/功能规划/README.md`、目标模块 README、相关主进程/preload/renderer 入口。
- 必跑验证：按任务选择 `npm run setup:doctor`、`npm run build`、`npm run qa:error-codes`、`npm run dist:oneclick`、`npm run github:sync:doctor`。
- 开发权限边界：开发线程除 Codex 全局记忆和当次任务明确要求外，不做额外权限限制；可以根据任务需要完成开发、验证、文档同步、脚本维护、打包、提交、推送或发布准备。

新线程接手前必须先读本文件并完成全项目遍历，不要凭旧记忆或局部 diff 改代码；功能开发完成后，如果架构、数据边界、发布流程、VS Code 接管方式或模块 README 发生变化，要先更新本文件，再交付。

