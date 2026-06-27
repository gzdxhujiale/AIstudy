# 公开版与本机 AI Study 对齐记录

记录日期：2026-06-27

## 对照源

- 公开版当前分支：`codex/mcp-control-panel`
- 公开版远端：`origin https://github.com/SnowLove0303/AIstudy-Public.git`
- 自用版远端：`selfuse https://github.com/SnowLove0303/AI-Study.git`
- 本机旧自用目录：`F:\XIANGMU\_AIstudy-old-removed\20260626-000401\AIstudy`

## 对齐结论

公开版当前代码是本机 AI Study 自用版能力的公开隔离版本，并且已经在多个方向上继续扩展。文件级检查结果是：自用版代码目录没有公开版缺失的功能源码文件；本机旧目录额外存在的主要是历史安装包产物和旧交接文档路径。

已确认公开版覆盖的自用版功能链路：

- 课程与分区管理：创建、重命名、移动、排序、折叠、删除、MySQL 持久化、本地兜底和 pending 重放。
- 思维导图：`simple-mind-map` 编辑、自动保存、节点投影、目录同步、主题元素、右键文字排版、快捷键分支操作、导出。
- 文档编辑：`@hufe921/canvas-editor` 节点文档、快照保存、导入、AI 小窗、格式刷、DOCX 导出。
- AI/浏览器端口：豆包、ChatGPT、Bilibili、知乎、智联招聘、BOSS 直聘、小红书固定端口管理。
- 系统能力：错误日志、运行诊断、更新检测、下载、安装包打包、GitHub 同步检查。
- MCP：设置页控制台、外部 stdio server、HTTP/Tailscale 内网访问、权限细分、远程调用监控、导图/文档读写工具。

## 必须保留的公开版差异

这些差异不是漏同步，不能为了“对齐自用版”回滚：

- 数据目录使用 `AIstudyPublicData`，自用版历史目录 `AIstudyData` 只作为旧资料参考。
- 默认数据库固定为 `aistudy_public`，公开版表名固定，不允许通过环境变量覆盖 database/table。
- `package.json` 保持公开仓库、公开更新源、公开安装包发布规则。
- `.claude/skills/aistudy-mcp-access`、`docs/mcp`、`electron/mcp` 和 `scripts/mcp` 是公开版新增的外部接入能力。
- `electron/documentExport.ts` 和 `docx` 依赖是公开版新增的 Word 导出能力。
- `.codex-tmp`、`.tmp`、`release*`、打包产物和本地运行数据必须继续被 git 忽略。

## 本次补齐

- 增加 `docs/CODEX接管方法.md`，兼容旧自用版文档路径，指向公开版正式接手文档。
- 补充模块 README：课程侧栏、思维导图、文档编辑、Chrome 端口的当前实现边界。
- 补充架构和功能规划里已经落地的 DOCX 导出、导图气泡右边框拉伸、目录/侧栏展开收起和招聘平台端口说明。

## 后续检查规则

- 每次从自用版同步或对照时，先确认是否是公开版必须隔离的路径、数据库、仓库或更新配置。
- 自用版历史 release 目录只用于定位旧安装包，不进入公开源码仓库。
- 如果旧文档路径仍被架构知识库引用，优先增加兼容跳转文档，而不是移动当前公开版文档。
- 功能说明落点优先级：模块 README -> `docs/功能规划` -> `docs/ARCHITECTURE.md` -> `docs/codex/CODEX_HANDOFF.md`。
