# AIstudy Public

公开版单机个人知识库工具。该版本从 `AIstudy` 私有工作目录复制而来，但运行时目录、Electron 应用身份、MySQL 默认库名和本地缓存 key 已全部隔离。

## Quick Start

```bash
npm run setup:doctor
npm run setup:install
npm run build
npm run dev
```

默认 MySQL 数据库为 `aistudy_public`。应用启动时会自动创建数据库和基础表；如果本机没有 MySQL，核心编辑会降级到本地副本，不阻塞界面使用。

可选配置见 `.env.example` 或运行时 `AIstudyPublicData/config/mysql.config.json`。升级时不会重置数据库连接；如果新版没有找到公开版配置，会兼容读取旧 `AIstudyData/config/mysql.config.json`，并在未显式指定数据库名时自动选择已有课程、导图或文档数据的 MySQL 库。

新机器开发或打包前先运行 `npm run setup:doctor`。弱网或离线打包时，先在有网络的机器运行 `npm run setup:install` 和 `npm run dist:oneclick`，再复制 `node_modules` 与 `.tmp/build-cache`。详见 `docs/deployment-new-machine.md`。

## Architecture Direction

- Desktop shell: Electron + React + TypeScript + Vite
- Packaging: electron-builder
- Mind map editor: simple-mind-map
- Document editor: @hufe921/canvas-editor
- Database: MySQL
- Large assets: local file storage with hash deduplication

See `docs/ARCHITECTURE.md`.

## Module Rules

- New features must be built as feature modules instead of being folded into one large component.
- Every feature module needs its own `README.md` that records scope, boundaries, user flow, and extension rules.
- The root README records only project-level rules and the main architecture direction.
- Before building a new feature, check whether mature GitHub or open-source projects already solve the same problem. Reuse proven patterns when they fit AIstudy's storage and UI constraints.
- Codex handoff and development takeover rules are tracked in `docs/codex/CODEX_HANDOFF.md`; update it when project location, repository, build flow, architecture boundary, or release flow changes.
- Development-side architecture notes can be synced to the private `AIstudy 全量功能架构` knowledge base with `npm run arch:knowledge:sync`; the Codex handoff document has dedicated commands `npm run codex:handoff:sync` and `npm run codex:handoff:commit`.

## Course Storage Reliability

- Course and section changes use command-style IPC instead of renderer-side full-store writes.
- MySQL is the formal source for course and section indexes.
- Course and section ordering uses dedicated reorder commands, so drag-and-drop does not rewrite the whole store from the renderer.
- Course right-click "copy local path" creates a local locator file under `AIstudyPublicData/locators/courses`, so other Codex sessions can open that file and immediately find the MySQL database, course id, and related tables.
- `courses.json` is only a lightweight local mirror and fallback when MySQL is unavailable.
- If MySQL write fails, course and section commands append a lightweight operation to `course-pending-operations.json`; the next successful `courses:load` replays those operations before reading MySQL.
- `courses.json` and `course-pending-operations.json` are written atomically. If either file is unreadable, the app quarantines it with a `.corrupt-*.json` suffix instead of blocking startup.
- The course sidebar shows a plain-language save status so users know whether content is saved, waiting to sync, or needs another try.

## Storage Boundaries

- Mind map and document snapshots store editor JSON only, with retention limits.
- Large images, attachments, and future importer assets must go through `knowledge_assets` and `knowledge_asset_links`.
- Assets are deduplicated by SHA-256 and linked back to course/map/node/document scope instead of being embedded as long base64 strings.
- Run `npm run qa:error-codes` after adding new failure paths or error codes.

## Importer Direction

- Importer is now a standalone module under `src/renderer/features/importer`.
- The first UI entry is a drag-and-drop modal in the Word document workspace.
- Current controlled import supports `.txt`, `.md`, `.markdown`, and `.docx` into the current node document.
- OCR-heavy batch imports use `scripts/importers/import-docx-to-node-documents.mjs` and must pass repeated dry-run self-checks before writing to MySQL.
- After batch import, run `npm run audit:docx-import` to compare the DOCX source, generated snapshots, MySQL content, noise cleanup, and style profile.
- MCP import is planned as a later entry, but it must use the same importer package and commit flow.

## Reusable Runtime Direction

- Runtime state is consolidated under `AIstudyPublicData` so the public app can move between machines with its data folder.
- `AISTUDY_PUBLIC_DATA_ROOT` can override the data root for portable or managed deployments.
- Course mirrors, pending operations, Chrome profiles, and downloaded updates use the shared data root.
- MySQL, Chrome, AI web sessions, and GitHub updates are external capabilities; they must degrade without blocking the core learning workspace.

## Error Log Policy

- User-facing pages must not show raw code errors, file paths, stack traces, or database details.
- The app shows plain-language messages such as "操作没有完成，请稍后再试。"
- Technical details are recorded by the Electron main process in the MySQL `app_error_logs` table.
- Settings has a dedicated error log page for recent user-readable failures and error identifiers.
