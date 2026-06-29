# AIstudy 更新索引

> 本文件由 `scripts/update/record-update.mjs` 维护，用于记录版本号、更新时间和功能更新摘要。更新内容不在应用 UI 中展示。

## 最新版本

- 版本号：0.1.76
- 更新时间：2026-06-29 22:41:14
- 功能更新：收口知识库 DB-first 数据边界、教材批注服务、数学粘贴和打包数据守卫；主安装包拆分 MySQL/VC++ 运行依赖并瘦身到轻量包；新增数据边界检查、数学粘贴回归、教材回归验证和打包产物清单记录
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：43f9343

## 更新记录

### 0.1.76 - 2026-06-29 22:41:14

- 收口知识库 DB-first 数据边界、教材批注服务、数学粘贴和打包数据守卫
- 主安装包拆分 MySQL/VC++ 运行依赖并瘦身到轻量包
- 新增数据边界检查、数学粘贴回归、教材回归验证和打包产物清单记录
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：43f9343

### 0.1.75 - 2026-06-28 22:40:06

- 纯净公开版默认隔离本机数据目录，并在未显式配置 MySQL 时避免读取本机旧数据库内容
- 打包时排除本机运行数据目录
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：1209a84

### 0.1.74 - 2026-06-28 21:56:25

- 修复教材节点页段绑定状态隔离、已绑定锁定/取消重设，并清理教材 PDF 独立窗口残留
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：152e1fb

### 0.1.73 - 2026-06-28 21:05:08

- 修复教材资产与节点笔记按课程和导图作用域读取保存、教材页段绑定切换和持久化问题，并优化文档内 AI 小窗拖动体验。
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：152e1fb

### 0.1.72 - 2026-06-28 18:53:20

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：abb69bf

### 0.1.71 - 2026-06-27 16:51:48

- Word 导出按 AIstudy 文档快照格式生成
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：b68e131


### 0.1.70 - 2026-06-27 02:25:30

- 标准化信息采集页 Bilibili 视频定位链路
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：5347788


### 0.1.69 - 2026-06-27 01:54:11

- Fix Chrome port saved login state persistence
- accept Bilibili API success code
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：559d0d3


### 0.1.68 - 2026-06-26 16:41:19

- 新增 GitHub 仓库同步检查并同步 MCP 与配置契约
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：77c9fa5

### 0.1.67 - 2026-06-24 23:55:58

- 优化主思维导图打开和切换速度：减少快照重复规范化、目录生成不再复制整树，并在文档/导图切换时保留导图画布实例
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.66 - 2026-06-24 23:44:47

- 信息采集板块调整为空白页面，仅保留导航入口
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.65 - 2026-06-24 22:45:24

- 左侧导航新增信息采集板块，提供采集箱与来源区域入口，为后续网页和平台内容采集接入预留正式页面
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.64 - 2026-06-24 22:34:53

- 端口管理新增 Bilibili 和知乎固定端口，沿用已有 Chrome 独立 profile、登录检测和状态保存逻辑
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.63 - 2026-06-22 16:26:29

- 新增导图右侧排版面板：参考 XMind 的结构、主题、文本、分支、画布分区，右侧目录收起后自动打开，支持布局、颜色、边框、字号、宽度、边界概要和画布拖拽
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.62 - 2026-06-22 15:55:43

- 修复设置弹窗层级：打开设置时左右侧栏折叠按钮不再浮到遮罩上方
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.61 - 2026-06-22 15:26:28

- 修复 AI 助手 ChatGPT 桥接：写入输入框后使用 CDP Enter 键发送，再按网页回合顺序读取回复
- 保留导图 _e is not a function 修复
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.60 - 2026-06-22 15:18:15

- 修复 AI 助手 ChatGPT 发送链路：准备输入后使用 CDP 真实鼠标点击发送，再按网页回合顺序读取回复
- 保留导图 _e is not a function 修复
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.59 - 2026-06-22 15:10:50

- 增强 AI 助手 ChatGPT 桥接：发送按钮等待延长到 30 秒，适配 ChatGPT 页面慢切换
- 保留 CDP Buffer 解码与导图修复
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.58 - 2026-06-22 15:06:51

- 修复 AI 助手 CDP 返回值解析：Node ws Buffer 安全解码，确保应用内 ChatGPT Runtime.evaluate 返回值可读取
- 保留导图 _e is not a function 修复
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.57 - 2026-06-22 15:02:39

- 修复 AI 助手主进程 CDP 通讯：改用 Node ws 客户端，确保应用内 ChatGPT Runtime.evaluate 能拿到网页脚本返回
- 保留导图 _e is not a function 修复
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.56 - 2026-06-22 14:55:40

- 修复导图 _e is not a function：导图运行时改回核心包加必要插件白名单
- 重做 ChatGPT 桥接读取逻辑，按本次发送后的网页回合顺序获取回复
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.55 - 2026-06-22 14:36:12

- 修复 AI 聊天助手桥接：自动识别 chrome.cmd 指向的真实 Chrome
- ChatGPT 写入后等待发送按钮就绪，减少 send-button-not-found
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.54 - 2026-06-22 14:19:04

- 修复打包版导图初始化 is not a constructor
- 导图运行时改用 simple-mind-map/full
- 继续清理旧导图自由坐标避免分支穿线
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.53 - 2026-06-21 20:29:50

- 修复导图右向逻辑布局穿线和跨组错位
- 关闭自由节点定位
- 打开旧导图时自动清理 customLeft/customTop 自由坐标
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.52 - 2026-06-21 20:07:51

- 修正文档编辑器右侧并排空白页，文档宽纸张改为纵向阅读流
- 窗口或侧栏尺寸变化后自动重建文档编辑器
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.51 - 2026-06-21 19:53:20

- 修正文档编辑器横向页面尺寸，减少右侧无效空白，让文档页面按工作区宽度展开。
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.50 - 2026-06-21 19:14:34

- 修复左侧知识库栏折叠后导图画布被挤到零宽的问题，折叠时只隐藏侧栏内容并保留画布显示。
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.49 - 2026-06-21 19:09:29

- 知识库界面去掉重复标题，并为左侧知识库栏和右侧目录栏新增折叠隐藏按钮。
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.48 - 2026-06-21 18:59:54

- 修复导图画布右键文字排版菜单不弹出的问题，改为捕获画布右键事件后打开排版浮层。
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.47 - 2026-06-21 18:56:04

- 知识库思维导图工具栏瘦身：文字排版改为选中主题后右键浮层，分支排版改为可配置快捷键并加入设置页。
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.46 - 2026-06-21 18:42:51

- 知识库思维导图补齐 Xmind 常用主题元素工具：备注、标签、链接、图片、优先级、进度与折叠展开，并接入选中节点快照保存。
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.45 - 2026-06-21 18:24:13

- 修复 MCP 内网访问重启后自动关闭的问题
- 内网访问开关状态持久保存，AIstudy 下次启动会自动恢复本机 HTTP 服务和 Tailscale Serve
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.44 - 2026-06-21 18:18:07

- MCP 内网访问新增远程编辑权限细分
- 远程编辑默认关闭，可按知识库管理、导图编辑、文档写入、删除操作分别授权
- 设置页同步显示权限开关
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.43 - 2026-06-21 18:03:28

- MCP 内网访问新增调用监控开关，开启后显示外部设备最近调用的工具、来源、状态、耗时和时间。
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.42 - 2026-06-21 17:28:42

- MCP 内网访问复制内容改为只包含 MCP URL、API URL 和 Authorization 三行，方便直接发送给另一台设备。
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.41 - 2026-06-21 17:23:12

- MCP 内网访问开启后在设置页直接显示 MCP URL、API URL 和 Authorization 三行连接信息，并保持一键复制。
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.40 - 2026-06-21 16:28:22

- MCP 设置页新增内网访问开关，自动检测 Tailscale、启动只读 HTTP MCP 服务并通过 Tailscale Serve 暴露给同一 tailnet 设备。
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.39 - 2026-06-21 15:33:08

- MCP 新增初始化说明、向导工具、目标解析、任务规划、Resources 与 Prompts，让 Codex/Claude Code 接入后能按流程自动操作。
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.38 - 2026-06-21 15:03:34

- MCP 新增知识库/分区管理、导图节点增删改移、导图样式布局、节点文档读写追加与样式工具，并统一编辑许可保护
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.37 - 2026-06-21 14:43:53

- MCP 读取、搜索和定位改为全库管理；编辑必须显式指定目标知识库，避免依赖客户端当前选中项
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.36 - 2026-06-21 14:25:14

- MCP 控制台新增调试输出开关，执行工具后可在底部查看 PowerShell 风格调用记录
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.35 - 2026-06-21 13:54:39

- MCP 控制台移入设置页，改为 Windows 设置风格纵向功能列表，并移除主导航入口
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.34 - 2026-06-19 22:02:38

- MCP 对接能力补强：工具安全标注、知识库定位文件生成、外部服务版本同步
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.33 - 2026-06-19 21:52:28

- MCP 与诊断链路加固：新增一键复制运行诊断报告，外部 MCP 服务改为懒连接健康检测
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.32 - 2026-06-19 21:31:45

- MCP 抽成独立主进程管理模块：统一工具定义、调用状态、JSON-RPC、接入引导和 stdio 队列
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.31 - 2026-06-19 21:13:49

- MCP 接入流程改为新手引导式：复制完整配置指南、工具说明按健康检测到读取再编辑排序
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.30 - 2026-06-19 19:19:32

- MCP 工具卡片对齐开关功能卡布局：状态灯加名称、开关、执行调试入口
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.29 - 2026-06-19 19:08:15

- MCP 控制台改为简约导向卡片：名称、开关、状态灯和最小执行入口
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.28 - 2026-06-19 18:39:08

- 优化 MCP 控制台 UI 密度、顶部工具指标、紧凑卡片和结果侧栏层级
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.27 - 2026-06-19 18:23:04

- 新增 MCP 控制台独立导航、读取/编辑/管控工具状态灯、Node MCP stdio server、编辑权限收紧、F盘 userData 默认目录
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/mcp-control-panel
- 提交：3f05062

### 0.1.26 - 2026-06-19 16:59:55

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/public-handoff-runtime-alignment
- 提交：84d842e

### 0.1.25 - 2026-06-19 16:40:47

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/public-handoff-runtime-alignment
- 提交：7234fdf


### 0.1.24 - 2026-06-19 15:23:10

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/public-handoff-runtime-alignment
- 提交：868616e


### 0.1.23 - 2026-06-19 15:17:21

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/public-handoff-runtime-alignment
- 提交：868616e


### 0.1.22 - 2026-06-19 15:14:53

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：codex/public-handoff-runtime-alignment
- 提交：868616e

### 0.1.21 - 2026-06-19 01:03:20

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：3122d38

### 0.1.20 - 2026-06-18 23:40:29

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：2a42fe5

### 0.1.19 - 2026-06-18 23:22:36

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：cd5cdb8

### 0.1.18 - 2026-06-18 23:15:00

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：4e4caf8

### 0.1.17 - 2026-06-18 22:56:49

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：8bac05c

### 0.1.16 - 2026-06-18 22:35:29

- 纠正用户端更新架构
- 公开仓库发布单一 AIstudy 用户端安装包
- 更新保留用户本机数据库连接和 AIstudyData
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：e91eda9

### 0.1.15 - 2026-06-18 22:07:37

- 发布纯净公开版测试更新
- 公开版数据库已清空
- 提供自用版安装包用于更新验证
- 兼容 GitHub 公开版资产名规范化
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：23eaf7b

### 0.1.14 - 2026-06-18 21:40:23

- 对齐公开版更新源并隔离安装包匹配
- 打包时关闭运行数据绑定的浏览器进程
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：6b71e23

### 0.1.13 - 2026-06-18 03:35:01

- 优化左侧分区和课程列表字体
- 分区与课程标题改用微软雅黑并放大显示
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：feature/core-logic-freeze-20260616
- 提交：fb508600


### 0.1.12 - 2026-06-18 03:31:27

- 新增课程保存状态提示
- 断网或数据库不可用时显示已在本机保存
- 同步失败时提供再试一次
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：feature/core-logic-freeze-20260616
- 提交：fb508600


### 0.1.11 - 2026-06-18 03:23:45

- 补课程分区本地镜像原子写入
- 损坏 courses/pending 文件自动隔离
- 完成 MySQL 断连恢复模拟验证
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：feature/core-logic-freeze-20260616
- 提交：fb508600


### 0.1.10 - 2026-06-18 03:10:21

- 补课程分区离线操作队列
- MySQL 恢复后自动重放本地课程/分区变更
- 完善课程分区可靠性文档
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：feature/core-logic-freeze-20260616
- 提交：fb508600


### 0.1.9 - 2026-06-18 02:38:53

- 改为 Notion 式左侧树状分区
- 课程移动改为更多菜单
- 未分区支持折叠
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：feature/core-logic-freeze-20260616
- 提交：fb508600


### 0.1.8 - 2026-06-18 02:03:04

- 新增知识库分区管理
- 支持课程移入分区与未分区
- 补充分区 MySQL 配置、建表和迁移文档
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：feature/core-logic-freeze-20260616
- 提交：fb508600


### 0.1.7 - 2026-06-16 23:47:02

- 修复课程读取失败时的空白列表
- 课程数据改为 MySQL 与本地 courses.json 双保险
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：feature/core-logic-freeze-20260616
- 提交：63304a8f


### 0.1.6 - 2026-06-16 22:13:48

- 优化思维导图文本编辑体验
- 去除编辑态双底框
- 输入时节点外框零延迟适应文本宽高
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：feature/core-logic-freeze-20260616
- 提交：339eb5d5


### 0.1.5 - 2026-06-16 22:05:51

- 去除思维导图编辑态双底框
- 编辑时复用原节点外框并隐藏原文字防止叠影
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：feature/core-logic-freeze-20260616
- 提交：339eb5d5


### 0.1.4 - 2026-06-16 21:58:16

- 修复思维导图节点输入抖动与卡顿
- 改为稳定编辑框和延迟节点预览
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：feature/core-logic-freeze-20260616
- 提交：e62ffe46


### 0.1.3 - 2026-06-16 19:57:20

- 修复生产包导图模块构造函数兼容
- 恢复打包版思维导图加载
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：feature/core-logic-freeze-20260616
- 提交：1613e1a3


### 0.1.2 - 2026-06-16 19:47:57

- 收尾需求文档五项问题
- 修复文档 AI 入口响应
- 稳定导图文本编辑实时重排与目录默认折叠
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：feature/core-logic-freeze-20260616
- 提交：aee6dd20


### 0.1.2 - 2026-06-16 17:46:48

- 收尾需求文档五项问题
- 修复文档 AI 入口响应
- 稳定导图文本编辑实时重排与目录默认折叠
- 为思维导图文本格式新增删除线能力
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：feature/core-logic-freeze-20260616
- 提交：aee6dd20


### 0.1.1 - 2026-06-16 16:32:01

- 修复更新管理仓库源与版本号同步
- 应用启动时预热 MySQL 连接
- AI 助手消息改为原文透传并优化发送按钮识别
- 思维导图目录默认折叠子级
- 稳定导图节点编辑框样式与换行表现
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：feature/core-logic-freeze-20260616
- 提交：aee6dd20


### 0.1.0 - 2026-06-16 03:57:20

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：feature/core-logic-freeze-20260616
- 提交：0d4aa773


### 0.1.0 - 2026-06-16 03:57:06

- 文档模式新增上一页/下一页快速翻页
- 新增跳过空白页模式，按钮翻页时可只跳转有内容的文档页
- 保留右侧目录直接点击切换能力，并在翻页前自动保存当前文档。
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：feature/core-logic-freeze-20260616
- 提交：0d4aa773


### 0.1.0 - 2026-06-16 03:31:34

- 调整思维导图初始显示大小为可读缩放
- 关闭启动时全图强制适配
- 初次进入时居中当前根节点
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-16 03:31:21

- 调整思维导图初始显示大小为可读缩放
- 关闭启动时全图强制适配
- 初次进入时居中当前根节点
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-16 03:26:12

- 修复思维导图滑动控件在导图切换和重渲染后失踪
- 订阅滚动条插件状态并强制刷新视口滑块
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-16 03:25:59

- 修复思维导图滑动控件在导图切换和重渲染后失踪
- 订阅滚动条插件状态并强制刷新视口滑块
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-16 03:21:10

- 思维导图目录点击改为子树导图视图
- 子级编辑自动合并回总导图
- 点击根节点返回完整导图
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-16 03:20:56

- 思维导图目录点击改为子树导图视图
- 子级编辑自动合并回总导图
- 点击根节点返回完整导图
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-16 03:04:07

- 当前修复和优化整合打包
- 思维导图分支间距与节点宽度优化
- 包含文档、AI助手、更新管理等现有改动
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-16 03:01:15

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-16 02:34:08

- 思维导图优化分支间距
- 提高默认节点换行宽度
- 新增节点宽度调节控件
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-16 00:59:59

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-16 00:51:23

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-16 00:48:36

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-16 00:40:50

- Word文档AI助手改为并入右键菜单流程
- 原生右键菜单新增问AI项
- 点击问AI后聊天框在右键位置展开不再独立遮挡
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-16 00:32:59

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-16 00:26:50

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-16 00:20:47

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-16 00:08:24

- AI聊天改为用户原文转发
- Word文档新增AI小窗入口
- 支持选中文档内容右键问AI并载入输入栏
- 清理AI桥接旧模板逻辑
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-16 00:05:04

- AI聊天改为用户原文转发
- Word文档新增AI小窗入口
- 支持选中文档内容右键问AI并载入输入栏
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-15 23:35:10

- 新增 AI 聊天助手模块，接入豆包与 ChatGPT 已登录端口桥接问答
- 新增助手导航页与独立聊天 UI
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-15 23:03:16

- 端口管理新增打开登录后自动识别豆包登录状态并保存固定端口
- 加固一键打包脚本的半成品清理与预打包重试
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-15 22:58:43

- 端口管理新增打开登录后自动识别豆包登录状态并保存固定端口
- 端口卡片展示已登录、等待登录和已保存状态
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-15 22:58:40

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-15 22:56:40

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-15 22:52:12

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-15 22:30:02

- 调整 Word 文档编辑页为横向页面
- 按编辑区宽度生成横向纸张并填满右侧空白区域
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-15 22:25:18

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-15 22:18:05

- 一键打包生成安装包
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-15 22:10:29

- 修复思维导图新增同级节点后选中项回弹父级的问题
- 新增渲染结束后按实际激活节点同步目录选中状态
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-15 17:19:14

- 去除更新管理页应用更新小标题
- 调整更新管理标题纵向居中并略微放大字号
- 增强一键打包脚本的预打包兜底能力
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-15 17:12:32

- 去除更新管理页应用更新小标题
- 调整更新管理标题纵向居中并略微放大字号
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-15 17:05:37

- 按 Windows 11 更新页风格优化更新管理界面
- 重构更新状态主视觉和更多选项列表
- 保留更新内容序号展示与最新版本提示
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-15 16:57:23

- 修复更新文档生成脚本，完善功能更新记录规范
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：961f0a35


### 0.1.0 - 2026-06-15 16:22:30

- 优化更新管理界面，改为版本状态横幅、版本对比条和轻量状态提示。
- 检测到线上版本与当前版本一致时，明确提示“当前已是最新版本”。
- 保留新版本更新内容的序号展示，避免暴露底层仓库、分支、索引路径等信息。
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：261f0a35

### 0.1.0 - 2026-06-15 16:12:13

- 接入标准更新检测、更新内容展示、下载安装流程。
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：261f0a35

### 0.1.0 - 2026-06-15 16:02:40

- 优化模块分隔线重叠和顶部边角协调性。
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：261f0a35

### 0.1.0 - 2026-06-15 15:58:19

- 细化各模块 UI 框线并提高边框透明度。
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：261f0a35

### 0.1.0 - 2026-06-15 15:54:51

- 填满主界面四边空隙并让 UI 板块无缝衔接。
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：261f0a35

### 0.1.0 - 2026-06-15 15:49:22

- 接入设置页更新管理。
- GitHub：https://github.com/SnowLove0303/AIstudy-Public.git
- 分支：main
- 提交：261f0a35

### 0.1.0 - 2026-06-15 15:35:00

- 初始化更新管理索引。
