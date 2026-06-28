# MySQL 课程管理表

## 目标

课程管理功能使用 MySQL 作为正式数据源，课程分区和课程的新增、选择、搜索、重命名、移动、折叠、删除都以专用表为准。前端继续通过 Electron preload 暴露的 `aistudyCourses.load/save` 调用，不直接连接数据库。

## 连接配置

主进程只读取 MySQL 连接四项：`host`、`port`、`user`、`password`。公开版数据库名固定为 `aistudy_public`，表名固定为公开版表名；不得通过环境变量或 `mysql.config.json` 覆盖数据库名、表名，也不会自动检测旧 `aistudy` 数据库。

连接四项按以下优先级读取：

1. 环境变量 `AISTUDY_PUBLIC_MYSQL_HOST`、`AISTUDY_PUBLIC_MYSQL_PORT`、`AISTUDY_PUBLIC_MYSQL_USER`、`AISTUDY_PUBLIC_MYSQL_PASSWORD`。
2. `mysql.config.json`，可放在 Electron `userData` 目录。
3. `AIstudyPublicData/config/mysql.config.json`，用于可迁移部署。
4. `mysql.config.json`，可放在应用可执行文件同级目录。
5. 默认值。

升级安装包只更新程序文件，不允许清空或覆盖已有 MySQL 数据。公开版如果找不到或连不上 MySQL，会走本地副本兜底，而不是切换到旧库或其他库。

支持的配置项：

| 字段 | 环境变量 | 默认值 |
| --- | --- | --- |
| `host` | `AISTUDY_PUBLIC_MYSQL_HOST` | `127.0.0.1` |
| `port` | `AISTUDY_PUBLIC_MYSQL_PORT` | `3306` |
| `user` | `AISTUDY_PUBLIC_MYSQL_USER` | `root` |
| `password` | `AISTUDY_PUBLIC_MYSQL_PASSWORD` | 空字符串 |

固定库表：

| 项 | 固定值 |
| --- | --- |
| 数据库 | `aistudy_public` |
| 课程表 | `course_management_courses` |
| 分区表 | `knowledge_sections` |
| 导图表 | `mind_maps` |
| 导图快照表 | `mind_map_snapshots` |
| 导图节点投影表 | `mind_map_nodes` |
| Word 文档表 | `knowledge_documents` |
| Word 快照表 | `knowledge_document_snapshots` |
| 资产表 | `knowledge_assets` |
| 资产关联表 | `knowledge_asset_links` |
| Chrome 端口状态表 | `chrome_port_states` |
| 错误日志表 | `app_error_logs` |

即使旧配置里还保留 `database` 或 `*Table` 字段，当前公开版运行时也不会读取这些字段。

`mysql.config.json` 示例：

```json
{
  "host": "127.0.0.1",
  "port": 3306,
  "user": "root",
  "password": ""
}
```

## 建表和迁移规则

应用首次读取或保存课程时，会尝试创建固定数据库 `aistudy_public`、课程分区表和课程表。若数据库已存在但当前账号无建库权限，应用会继续使用 `aistudy_public` 并尝试建表。

旧版课程表如果缺少 `section_id`、`sort_order` 或 `idx_section_order`，主进程会在启动数据层时自动补齐，不要求手工迁移。

课程分区表：

```sql
CREATE TABLE IF NOT EXISTS `knowledge_sections` (
  `id` VARCHAR(64) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `collapsed` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  `deleted_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_section_order` (`sort_order`),
  KEY `idx_section_name` (`name`),
  KEY `idx_section_live_order` (`deleted_at`, `sort_order`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

报错日志表：

```sql
CREATE TABLE IF NOT EXISTS `app_error_logs` (
  `id` VARCHAR(64) NOT NULL,
  `source` VARCHAR(120) NOT NULL,
  `user_message` VARCHAR(255) NOT NULL,
  `technical_message` LONGTEXT NOT NULL,
  `error_code` VARCHAR(120) NOT NULL,
  `context_json` TEXT NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_error_created` (`created_at`),
  KEY `idx_error_source` (`source`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

资产主表：

```sql
CREATE TABLE IF NOT EXISTS `knowledge_assets` (
  `id` VARCHAR(64) NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `local_path` VARCHAR(1024) NOT NULL,
  `mime_type` VARCHAR(120) NOT NULL,
  `byte_size` BIGINT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  `deleted_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_asset_sha256` (`sha256`),
  KEY `idx_asset_created` (`created_at`),
  KEY `idx_asset_deleted_at` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

资产关联表：

```sql
CREATE TABLE IF NOT EXISTS `knowledge_asset_links` (
  `id` VARCHAR(64) NOT NULL,
  `asset_id` VARCHAR(64) NOT NULL,
  `course_id` VARCHAR(64) NOT NULL,
  `mind_map_id` VARCHAR(64) NOT NULL,
  `node_id` VARCHAR(96) NOT NULL,
  `document_id` VARCHAR(64) NOT NULL DEFAULT '',
  `relation_type` VARCHAR(40) NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `deleted_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_asset_link_scope` (`asset_id`, `course_id`, `mind_map_id`, `node_id`, `document_id`, `relation_type`),
  KEY `idx_asset_link_asset` (`asset_id`, `deleted_at`),
  KEY `idx_asset_link_document` (`document_id`, `relation_type`, `deleted_at`),
  KEY `idx_asset_link_node` (`course_id`, `mind_map_id`, `node_id`, `relation_type`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

课程表：

```sql
CREATE TABLE IF NOT EXISTS `course_management_courses` (
  `id` VARCHAR(64) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NOT NULL,
  `section_id` VARCHAR(64) NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  `deleted_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_section_order` (`section_id`, `sort_order`),
  KEY `idx_updated_at` (`updated_at`),
  KEY `idx_name` (`name`),
  KEY `idx_course_live_order` (`deleted_at`, `section_id`, `sort_order`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## 写入策略

- Electron 主进程负责所有 MySQL 操作，渲染层不持有数据库凭据。
- `courses:load` 从分区表和课程表读取全部数据，分区按 `sort_order` 升序、`updated_at` 倒序返回；课程按 `section_id`、`sort_order` 升序、`updated_at` 倒序返回。
- 新功能必须优先使用命令式 IPC：`courses:create/rename/move/reorder/delete/select` 和 `course-sections:create/rename/toggle/reorder/delete`。
- `courses:save` 仅作为旧接口兼容保留，不再作为新功能的默认写入方式。
- 课程可以归属某个分区，也可以保持 `section_id = NULL` 作为「未分区」课程。
- 删除分区时软删除分区，并将该分区下课程事务性移入「未分区」，不会删除课程本身。
- 删除课程写入 `deleted_at` 软删除；后续接入节点、边、文档后，需要扩展联动软删除。
- 本地 `courses.json` 只作为轻量镜像和 MySQL 失败兜底，不是第二套事实源，也不是纯净发行版的初始数据源。
- 分区、课程排序、折叠状态等入口索引应以数据库为准；纯净安装包不得携带打包机上的本地分区/课程镜像。

## 故障恢复策略

- MySQL 读取失败时，主进程回退读取本地 `courses.json`，不阻断课程侧栏渲染。
- 纯净新装时，本地回退镜像必须是空状态；安装后应自动发现公开版固定数据库配置或 AIstudy 管理的本机数据库服务并连接固定 `aistudy_public`。
- 如果数据库不可用但本地镜像被使用，UI 必须明确这是本机镜像/本机模式，避免用户误判为数据库仍然连接。
- MySQL 写入失败时，课程/分区命令先落本地 `courses.json`，再追加轻量操作到 `course-pending-operations.json`。
- `course-pending-operations.json` 只记录课程/分区索引操作，不记录思维导图、Word 文档、附件或 AI 生成内容。
- MySQL 恢复后，下一次 `courses:load` 会在读取表数据前按顺序重放 pending 操作；全部成功后清空 pending 文件。
- 重放过程中任一操作失败，会保留该操作和后续操作，更新 `retryCount` 与 `lastError`，继续回退本地镜像，避免把失败后的不完整状态写成事实源。
- `courses.json` 和 `course-pending-operations.json` 使用原子写入；如果历史文件损坏，会隔离成 `.corrupt-*.json` 并继续使用 MySQL 或空本地镜像。
- 当前选中课程 id 是本地偏好，只写入 `courses.json`，不会写入 MySQL，也不会进入 pending 队列。

## UI 约束

- 不在界面展示数据库名、表名、文件路径、环境变量、调试说明。
- 连接失败时只显示面向用户的业务失败提示，技术细节写入 `app_error_logs`。
- 设置页提供独立的「报错日志」入口，只显示人话说明、发生位置、时间和错误编号，不展示堆栈、路径或 SQL。
- 不再把 `userData`、`localStorage`、测试说明、接入说明放到产品界面。
