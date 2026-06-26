# AIstudy Public

公开版单机个人知识库工具。该版本从 `AIstudy` 私有工作目录复制而来，但运行时目录、Electron 应用身份、MySQL 默认库名和本地缓存 key 已全部隔离。

## Quick Start

```bash
npm run setup:doctor
npm run setup:install
npm run dev:app
```

日常改功能时用 `npm run dev:app` 验证；渲染器 UI 改动会热更新，主进程或 preload 改动后重新运行即可。发布前再运行 `npm run dist:oneclick`。

新机器开发或打包前先运行 `npm run setup:doctor`。弱网或离线打包流程见 `docs/deployment-new-machine.md`。

同步 GitHub 前运行 `npm run github:sync:doctor`，检查本机 Git、远端分支、未提交改动、GitHub CLI 和 Release 安装包资产；详见 `docs/github-sync.md`。

## Repository Map

- `src/renderer/features/`：React 渲染器功能模块，每个模块维护自己的边界和 README。
- `electron/`：Electron 主进程、preload、IPC、MySQL、导出、备份、更新和系统能力。
- `scripts/`：开发、打包、QA、导入器、MCP server、架构知识同步等维护脚本。
- `docs/`：架构基线、功能契约、MCP 接入、部署和仓库协作说明。
- `assets/`、`build/`：静态资源和打包资源。

## Documentation

- `docs/README.md`：完整文档导航，第一次接手项目从这里继续读。
- `docs/ARCHITECTURE.md`：当前架构基线和不可破坏的边界。
- `docs/功能规划/README.md`：功能规划、存储契约、UI 约束和模块规则索引。
- `docs/mcp/INDEX.md`：MCP 接入、权限、远程访问和运行时代码入口。
- `docs/codex/CODEX_HANDOFF.md`：Codex 接手项目、构建、验证和交付指引。
- `scripts/README.md`：维护脚本分布和使用边界。

## Runtime Rules

- 默认 MySQL 数据库固定为 `aistudy_public`，公开版表名固定为公开版专用表。
- 应用启动时会自动创建数据库和基础表；如果本机没有 MySQL，核心编辑会降级到本地副本，不阻塞界面使用。
- 可选连接配置见 `.env.example` 或运行时 `AIstudyPublicData/config/mysql.config.json`。
- 公开版运行时只读取 MySQL 的 `host`、`port`、`user`、`password`；不支持覆盖数据库名和表名。
- 升级安装包只更新程序文件，不会重置本机连接配置或清空已有 MySQL 数据。

## Development Boundaries

- 新功能必须进入 feature module，不继续堆进一个大组件。
- Renderer 不直接写 MySQL，持久化通过 Electron 主进程 IPC 命令收口。
- 思维导图由 `simple-mind-map` 承担，Word 类文档由 `@hufe921/canvas-editor` 承担。
- 大图片、附件和未来导入资产必须走 `knowledge_assets` 与 `knowledge_asset_links`，不要塞进长 JSON。
- 新增失败路径或错误码后运行 `npm run qa:error-codes`。
- 用户界面不显示原始堆栈、数据库细节、文件路径或技术错误；技术细节进入主进程错误日志。
- 改动架构边界、构建流程、发布流程或接手规则时，同步更新 `docs/codex/CODEX_HANDOFF.md`。
