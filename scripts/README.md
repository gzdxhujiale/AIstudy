# Scripts Index

这个目录存放开发和维护脚本。优先通过 `package.json` 中的 npm scripts 调用，避免直接绕过项目约定。

## 目录分布

- `dev/`：本地开发启动脚本。
- `build/`：构建后资源准备脚本。
- `package/`：关闭旧进程并打包发布的脚本。
- `setup/`：新机器环境检查、依赖安装和本地缓存规则。
- `qa/`：依赖、错误码和 MCP 文档读取等验证脚本。
- `importers/`：DOCX 批量导入和导入审计脚本。
- `mcp/`：外部 stdio MCP server，随安装包作为额外资源分发。
- `architecture-knowledge/`：开发侧架构知识库同步脚本。
- `github/`：GitHub 同步和 Release 资产检查脚本。
- `update/`：发布更新记录脚本。
- `npm-stubs/`：项目本地 npm stub 包。

## 使用边界

- 需要安装依赖时使用 `npm run setup:install`。
- 新机器或打包前使用 `npm run setup:doctor`。
- 日常开发使用 `npm run dev:app`。
- 发布前使用 `npm run dist:oneclick`。
- 同步 GitHub 前使用 `npm run github:sync:doctor`。
- 批量导入先 dry-run，再通过审计脚本确认后提交。
- 构建缓存必须放在项目本地忽略目录，不能写入系统盘缓存。
