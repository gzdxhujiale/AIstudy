# AIstudy 文档导航

这个页面是仓库文档总入口。根目录 `README.md` 只保留项目入口、运行命令和关键边界；细节按主题进入下面的文档。

## 项目入口

- `../README.md`：仓库首页、启动命令、目录分布和开发边界。
- `ARCHITECTURE.md`：架构基线、进程分层、数据所有权和不可破坏的边界。
- `codex/CODEX_HANDOFF.md`：Codex 接手项目、验证、打包、提交和交付流程。
- `architecture-knowledge/README.md`：开发侧架构知识库同步流程。

## 功能规划与契约

- `功能规划/README.md`：功能规划目录的分组索引。
- `功能规划/系统核心逻辑冻结契约.md`：核心逻辑冻结规则。
- `功能规划/底层架构分层约束.md`：渲染器、主进程、领域层和持久化边界。
- `功能规划/MySQL课程管理表.md`：公开版课程管理表规则。
- `功能规划/Word详细内容存储约束.md`：Word 文档快照和节点绑定规则。
- `功能规划/错误码体系.md`：错误码、用户提示和日志收口规则。

## MCP 接入

- `mcp/INDEX.md`：MCP 文档总入口。
- `mcp/AIstudy-MCP-quickstart.md`：新手快速接入。
- `mcp/AIstudy-MCP-access-skill.md`：可直接交给另一台 Codex/Claude Code 的接入说明。
- `mcp/AIstudy-MCP-tailscale-access.md`：Tailscale 内网访问说明。
- `mcp/AIstudy-MCP-module-boundary.md`：MCP 模块边界和维护要求。

## 思维导图与编辑器

- `mindmap-canvas-integration-plan.md`：思维导图画布接入规划。
- `mindmap-editor-format-mysql-plan.md`：思维导图格式和 MySQL 持久化规划。
- `simple-mind-map-embedding-vs-binding.md`：simple-mind-map 嵌入和绑定方案对比。
- `xmind-editor-canvas-candidates.md`：XMind 编辑器候选调研。
- `xmind-open-source-embedding-research.md`：XMind 开源嵌入调研。

## 部署、仓库与更新

- `deployment-new-machine.md`：新机器开发、弱网和离线打包流程。
- `github-sync.md`：GitHub 同步检查和 Release 资产规则。
- `updates/INDEX.md`：发布更新摘要。

## 脚本与维护

- `../scripts/README.md`：脚本目录总览。
- `../scripts/setup/README.md`：新机器 setup 检查和安装脚本。
- `../scripts/importers/README.md`：批量导入脚本和审计脚本。

## 推荐阅读路径

新接手项目：`../README.md` -> `ARCHITECTURE.md` -> `功能规划/README.md` -> `codex/CODEX_HANDOFF.md`。

接 MCP：`mcp/INDEX.md` -> `mcp/AIstudy-MCP-quickstart.md` -> `mcp/AIstudy-MCP-module-boundary.md`。

做导入或文档能力：`功能规划/Word详细内容存储约束.md` -> `功能规划/导入器模块化规划.md` -> `../scripts/importers/README.md`。
