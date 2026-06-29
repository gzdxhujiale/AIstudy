# AIstudy 新机器部署检查

## 用户视角流程

1. 已有安装包时，直接运行 `release/AIstudy-Setup-当前版本.exe`，具体版本以 `package.json` 和 `release` 目录实际产物为准。
2. 需要在新机器上开发或重新打包时，先运行 `npm run setup:doctor`。
3. 如果提示依赖缺失，运行 `npm run setup:install`。
4. 依赖检查通过后，再运行 `npm run dist:oneclick`。

## 解决的风险

- Node 版本太低导致 Vite 构建失败。
- npm 不存在或依赖没有安装。
- Electron 二进制没有下载完成。
- electron-builder 第一次打包时缺少本地缓存。
- 缓存散落到系统盘，换机器后无法复用。
- MySQL 没有安装时误以为应用无法打开。
- 打包源混入 `AIstudyPublicData`、教材本地兜底、Chrome profile 或 MySQL 配置，导致纯净版带出验证机数据。

## 离线或弱网机器

先在一台有网络的机器上运行：

```bash
npm run setup:install
npm run dist:oneclick
```

然后把这些内容一起复制到离线机器：

- 项目源码。
- `node_modules`。
- `.tmp/build-cache`。

离线机器上先运行：

```bash
npm run setup:doctor
```

检查通过后即可打包。MySQL 不存在时，核心学习区仍会走本机副本模式；需要正式同步时再配置 `AISTUDY_PUBLIC_MYSQL_HOST`、`AISTUDY_PUBLIC_MYSQL_PORT`、`AISTUDY_PUBLIC_MYSQL_USER`、`AISTUDY_PUBLIC_MYSQL_PASSWORD`，或在 `AIstudyPublicData/config/mysql.config.json` 中写入同名连接项。公开版数据库名固定为 `aistudy_public`，表名固定为公开版表名，部署配置不得暗示可覆盖库名或表名。

## 设计依据

- Electron 安装时需要下载平台二进制，官方支持镜像和本地 cache。
- Electron 官方说明网络错误如 `ECONNRESET`、`ETIMEDOUT` 通常是下载网络问题。
- electron-builder 支持 CLI 环境变量文件和构建配置；本项目额外在打包脚本里固定本地 cache。

## 写死规则

- 新机器先跑 `setup:doctor`，不要直接猜缺什么。
- 开发依赖安装统一走 `setup:install`。
- 打包统一走 `dist:oneclick`，不要手工绕过项目本地 cache。
- `dist:oneclick` 会清理安装源运行数据并写出 `release/build-manifest.json`，用于追溯安装包版本、commit、dirty 状态和产物 hash。
- MySQL 是增强同步能力，不是打开应用的前置条件。
