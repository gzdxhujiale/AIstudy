# AIstudy Architecture Knowledge Sync

This folder tracks the development-side workflow for syncing feature requirements and architecture notes into the private `AIstudy 全量功能架构` knowledge base.

The sync script is intentionally outside the packaged app. Electron Builder only packages `dist/**/*`, `dist-electron/**/*`, `build/icon.ico`, and `package.json`, so files under `scripts/architecture-knowledge` and `docs/architecture-knowledge` are not shipped in the exe.

## Target Knowledge Base

- Course: `AIstudy 全量功能架构`
- Default database: `aistudy`
- Default MySQL: `127.0.0.1:3306`, user `root`, empty password
- Runtime tables:
  - `course_management_courses`
  - `mind_maps`
  - `mind_map_nodes`
  - `knowledge_documents`
  - `knowledge_document_snapshots`

## Workflow

1. Change public-version code and regular repo docs.
2. Write a short feature document using `templates/feature-doc.md`.
3. Find the target node:

```bash
npm run arch:knowledge:sync -- --search="更新"
```

4. Dry-run the sync:

```bash
npm run arch:knowledge:sync -- --file="docs/architecture-knowledge/work/current-feature.md" --node-id="arch_11_updates"
```

5. Commit to the private knowledge base only after the dry-run target is correct:

```bash
npm run arch:knowledge:sync -- --file="docs/architecture-knowledge/work/current-feature.md" --node-id="arch_11_updates" --commit
```

Use `--append` when the node already has a useful document and the new feature should be added below it instead of replacing it.

## Codex Handoff Document

The project takeover guide for future Codex sessions lives at:

```text
docs/codex/CODEX_HANDOFF.md
```

It maps to the dedicated architecture node:

```text
arch_14_scripts_docs_09
```

Dry-run the sync:

```bash
npm run codex:handoff:sync
```

Write the updated handoff guide to the private knowledge base:

```bash
npm run codex:handoff:commit
```

## Rules

- Public-version feature work should update public code first.
- Self-use code should not be edited for ordinary feature development.
- This knowledge sync writes to the private MySQL knowledge base, not to the public packaged app.
- The script defaults to dry-run and writes only with `--commit`.
- Target by `node_id` whenever possible. Titles can be duplicated.
- Store product-facing requirements, architecture decisions, data rules, error/diagnostic behavior, and validation records.
- Do not paste raw stack traces, secrets, cookies, SQL passwords, or machine-only temporary paths.

## MySQL Overrides

The script reads these environment variables first:

- `AISTUDY_ARCH_MYSQL_HOST`
- `AISTUDY_ARCH_MYSQL_PORT`
- `AISTUDY_ARCH_MYSQL_USER`
- `AISTUDY_ARCH_MYSQL_PASSWORD`
- `AISTUDY_ARCH_MYSQL_DATABASE`

Then it falls back to `AISTUDY_MYSQL_*`, then to the local default `aistudy` database.

You can also pass:

```bash
npm run arch:knowledge:sync -- --mysql-config="F:/path/mysql.config.json" --search="导入器"
```

## Node Index

Regenerate the local node index from MySQL:

```bash
npm run arch:knowledge:index
```

The generated file is a developer reference only. It is not packaged into the app.
