# MySQL 课程管理表

## 目标

课程管理功能使用 MySQL 作为正式数据源，课程分区和课程的新增、选择、搜索、重命名、移动、折叠、删除都以专用表为准。前端继续通过 Electron preload 暴露的 `aistudyCourses.load/save` 调用，不直接连接数据库。

## 连接配置

主进程按以下优先级读取连接配置：

1. 环境变量。
2. `mysql.config.json`，可放在应用可执行文件同级目录。
3. `AIstudyPublicData/config/mysql.config.json`，用于可迁移部署。
4. `mysql.config.json`，可放在 Electron `userData` 目录，兼容旧版本。
5. 默认值。

支持的配置项：

| 字段 | 环境变量 | 默认值 |
| --- | --- | --- |
| `host` | `AISTUDY_PUBLIC_MYSQL_HOST` | `127.0.0.1` |
| `port` | `AISTUDY_PUBLIC_MYSQL_PORT` | `3306` |
| `user` | `AISTUDY_PUBLIC_MYSQL_USER` | `root` |
| `password` | `AISTUDY_PUBLIC_MYSQL_PASSWORD` | 空字符串 |
| `database` | `AISTUDY_PUBLIC_MYSQL_DATABASE` | `aistudy_public` |
| `courseTable` | `AISTUDY_PUBLIC_MYSQL_COURSE_TABLE` | `course_management_courses` |
| `courseSectionTable` | `AISTUDY_PUBLIC_MYSQL_COURSE_SECTION_TABLE` | `knowledge_sections` |
| `mindMapTable` | `AISTUDY_PUBLIC_MYSQL_MIND_MAP_TABLE` | `mind_maps` |
| `mindMapSnapshotTable` | `AISTUDY_PUBLIC_MYSQL_MIND_MAP_SNAPSHOT_TABLE` | `mind_map_snapshots` |
| `mindMapNodeTable` | `AISTUDY_PUBLIC_MYSQL_MIND_MAP_NODE_TABLE` | `mind_map_nodes` |
| `knowledgeDocumentTable` | `AISTUDY_PUBLIC_MYSQL_KNOWLEDGE_DOCUMENT_TABLE` | `knowledge_documents` |
| `knowledgeDocumentSnapshotTable` | `AISTUDY_PUBLIC_MYSQL_KNOWLEDGE_DOCUMENT_SNAPSHOT_TABLE` | `knowledge_document_snapshots` |
| `assetTable` | `AISTUDY_PUBLIC_MYSQL_ASSET_TABLE` | `knowledge_assets` |
| `knowledgeAssetLinkTable` | `AISTUDY_PUBLIC_MYSQL_KNOWLEDGE_ASSET_LINK_TABLE` | `knowledge_asset_links` |
| `errorLogTable` | `AISTUDY_PUBLIC_MYSQL_ERROR_LOG_TABLE` | `app_error_logs` |

`mysql.config.json` 示例：

```json
{
  "host": "127.0.0.1",
  "port": 3306,
  "user": "root",
  "password": "",
  "database": "aistudy_public",
  "courseTable": "course_management_courses",
  "courseSectionTable": "knowledge_sections",
  "mindMapTable": "mind_maps",
  "mindMapSnapshotTable": "mind_map_snapshots",
  "mindMapNodeTable": "mind_map_nodes",
  "knowledgeDocumentTable": "knowledge_documents",
  "knowledgeDocumentSnapshotTable": "knowledge_document_snapshots",
  "assetTable": "knowledge_assets",
  "knowledgeAssetLinkTable": "knowledge_asset_links",
  "errorLogTable": "app_error_logs"
}
```

## 建表和迁移规则

应用首次读取或保存课程时，会尝试创建数据库、课程分区表和课程表。若数据库已存在但当前账号无建库权限，应用会继续使用已配置数据库并尝试建表。

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
- 本地 `courses.json` 只作为轻量镜像和 MySQL 失败兜底，不是第二套事实源。

## 故障恢复策略

- MySQL 读取失败时，主进程回退读取本地 `courses.json`，不阻断课程侧栏渲染。
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
