# AIstudy Public Codex 接手说明书

本文档给接手本公开版项目的 Codex 使用。它是开发侧资料，不进入安装包；打包配置只包含 `dist/**/*`、`dist-electron/**/*`、`build/icon.ico` 和 `package.json`。

## 1. 项目身份

- 公开版本地仓库：`F:\XIANGMU\AIstudy-public`
- GitHub 仓库：`https://github.com/SnowLove0303/AIstudy-Public.git`
- 应用名：`AIstudy`
- 当前包名：`aistudy`
- 当前版本号：见 `package.json` 的 `version`
- 公开版定位：开发端、发布端、纯净版基线
- 自用版仓库：`F:\XIANGMU\AIstudy`

后续常规开发只改公开版。不要为了同步功能直接修改自用版代码；自用版应该通过公开版发布的新安装包更新，且保留用户自己的数据库和运行数据。

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
npm run dev
```

如果要验证构建：

```powershell
npm run build
```

如果要正式打包：

```powershell
npm run dist:oneclick
```

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

文档：

- `knowledge_documents` 只存节点文档当前指针和元信息。
- `knowledge_document_snapshots` 存 canvas-editor JSON 快照。
- 文档和导图通过 `(course_id, mind_map_id, node_id)` 绑定。

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

思维导图：

- 顶部切换到“导图”。
- 使用 `simple-mind-map` 编辑节点、样式和导出。
- 导图保存后主进程写快照与节点投影。

Word 文档：

- 顶部切换到“文档”。
- 右侧目录节点绑定当前节点的详细文档。
- 文档内容按 canvas-editor 快照保存。

导入器：

- 当前 UI 入口是文档区导入弹窗。
- 支持拖拽 `.txt`、`.md`、`.markdown`、`.docx`。
- 批量重文档导入走脚本 `scripts/importers/import-docx-to-node-documents.mjs`。
- 导入后用 `scripts/importers/audit-docx-import.mjs` 审计内容和排版。

更新：

- GitHub 仓库仍是版本管理来源。
- `package.json` 的 `aistudy.updateDownloadMirrors` 可配置更快的安装包分发镜像。
- 下载更新需要支持进度、暂停、恢复、取消。
- 用户更新后不能丢自己的数据库和运行数据。

## 8. 常用命令

```powershell
npm run setup:doctor        # 检查开发环境
npm run setup:install       # 安装/补齐依赖
npm run dev                 # 本地 Electron + Vite 调试
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

