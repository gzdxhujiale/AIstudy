# AIstudy Architecture Baseline

## Decision

Use an Electron application with a React renderer and TypeScript domain layer.

The previous WinUI/WebView2 experiment is removed. The new baseline follows the existing implementation direction already present in the remote project history:

- `simple-mind-map` owns mind-map rendering and editing.
- `@hufe921/canvas-editor` owns Word-like WYSIWYG knowledge documents.
- Electron main process owns OS integration, file access, MySQL access, backup, export, and update flow.
- React renderer owns UI composition and editor mounting.
- Domain modules own all course, node, branch, document, and persistence rules.

## Non-Negotiable Boundaries

Do not hand-roll a mind-map canvas.

Do not copy editor behavior into native code.

Do not store large Word/editor content directly inside mind-map node records.

Do not let renderer components directly write MySQL.

Do not make one large course JSON blob the only source of truth once MySQL persistence is enabled.

## Process Layout

```text
Electron main
  - window lifecycle
  - app paths
  - reusable data root
  - MySQL connection
  - local asset storage
  - import/export
  - backup/restore
  - IPC command handlers

React renderer
  - left navigation
  - course list
  - course section feature UI
  - mind-map workspace
  - document workspace
  - toolbar UI
  - no direct database access

Domain layer
  - course normalization
  - course command contracts
  - mind-map node indexing
  - branch-map reconciliation
  - document-node linking
  - snapshot compaction policy

Editor libraries
  - simple-mind-map for xmind-like canvas
  - canvas-editor for Word-like documents
```

## Core Data Ownership

Course is the top-level personal knowledge container.

Mind-map node id is the stable key that connects all future features:

- outline entry
- branch mind map
- Word-like detail document
- assets
- review cards
- AI summaries
- export sections

Changing a node title must not change its id.

Deleting a node must soft-delete related projections first, then let cleanup jobs remove orphan snapshots and assets later.

## MySQL Tables

```text
courses
  id
  name
  sort_order
  created_at
  updated_at
  deleted_at

mind_maps
  id
  course_id
  root_node_id
  current_snapshot_id
  created_at
  updated_at
  deleted_at

mind_map_snapshots
  id
  mind_map_id
  sequence_no
  payload_json
  byte_size
  created_at

mind_map_nodes
  id
  course_id
  mind_map_id
  parent_node_id
  title
  depth
  position_index
  is_collapsed
  updated_at
  deleted_at

knowledge_documents
  id
  course_id
  mind_map_id
  node_id
  current_snapshot_id
  current_byte_size
  title
  created_at
  updated_at
  deleted_at

knowledge_document_snapshots
  id
  document_id
  sequence_no
  payload_json
  byte_size
  created_at

assets
  id
  sha256
  local_path
  mime_type
  byte_size
  created_at
  updated_at
  deleted_at

knowledge_asset_links
  id
  asset_id
  course_id
  mind_map_id
  node_id
  document_id
  relation_type
  created_at
  deleted_at

exam_questions
exam_papers
exam_paper_sections
exam_paper_questions
exam_attempts
```

## Snapshot Policy

Mind map:

- Store full `simple-mind-map` snapshots.
- Store flat `mind_map_nodes` projection for search, tree navigation, and document binding.
- Keep recent snapshots.
- Compact old snapshots by time and count.

Word-like documents:

- Store full `canvas-editor` document snapshots separately from mind-map data.
- Keep one current pointer per node document.
- Use `(course_id, mind_map_id, node_id)` as the only binding key between Word detail documents and mind-map nodes.
- Load the active node document on demand only; never load all documents for a course when opening the course.
- Track snapshot byte sizes and prevent growth through hash reuse, snapshot retention, and asset extraction rather than renderer memory limits.
- Store images and attachments in `assets`, not inside JSON payloads.
- Hash assets by SHA-256 to avoid duplicates.
- Store asset references in `knowledge_asset_links`; `document_id` uses an empty string for non-document scoped references so uniqueness stays enforceable in MySQL.

## Memory Policy

Memory is allowed when it directly improves the two core work surfaces:
mind-map editing and Word-style document editing. The constraint is not the
absolute module size; the constraint is avoiding duplicated ownership,
unbounded payload caches, and scattered one-off code paths.

Keep active runtime state narrow:

- mount only active editor instances
- cache core editor modules once loaded
- prewarm core editor modules during idle time when it improves first-use smoothness
- do not preload all course snapshots, document snapshots, or binary assets
- keep optional tooling and exports on demand unless repeated use proves otherwise

When switching courses:

- dispose current mind-map instance
- dispose current document editor instance
- keep only current course metadata and selected document in renderer memory
- reload large snapshots on demand through IPC

When switching nodes:

- save pending document changes
- unload previous document editor state
- load target node document snapshot only when opened

## Feature Isolation

Mind-map editing must produce only:

- full mind-map snapshot
- node projection update
- node lifecycle events

Document editing must produce only:

- document snapshot
- asset link updates
- document metadata update

Course management must not know editor internals.

Export must read domain models through services, not scrape UI state.

Renderer feature code must keep application shell state, feature UI state, editor adapters, domain model rules, and persistence services separated. The detailed implementation constraint is maintained in `docs/功能规划/底层架构分层约束.md`.

Course and section management has its own implementation constraint in `docs/功能规划/课程分区架构收口.md`. New course/sidebar work must use command-style IPC and the `src/renderer/features/course/` boundary instead of adding more state and full-store writes to `main.tsx`.

Course MySQL failures must degrade to the light local mirror and pending operation replay, not to a second independent course database. The pending queue is limited to course and section index commands so it cannot grow through editor snapshots or assets.

Course and section drag sorting must use `courses:reorder` and `course-sections:reorder`; renderer code must not rewrite the full course store to express ordering changes.

Local mirror files that support this recovery path must be written atomically and quarantined when unreadable. A broken mirror or pending file must not block startup or turn into a hidden source of truth.

Raw implementation errors must stay out of product pages. IPC handlers return user-facing messages, while the main process stores technical details in the MySQL-backed error log service. Settings owns the user-readable error log page.

Word detail storage has its own implementation constraint in `docs/功能规划/Word详细内容存储约束.md`. That contract is stricter than the early architecture sketch: Word content belongs to `knowledge_document_snapshots`, while `knowledge_documents` is only the node-level current pointer and strong index.

Reusable deployment rules are tracked in `docs/功能规划/开箱即用与外部接入规划.md`. Public-version runtime files should converge under `AIstudyPublicData`; external integrations such as MySQL, Chrome ports, AI web sessions, and GitHub updates must degrade without blocking the core workspace.

## First Implementation Milestone

1. Scaffold Electron + React + TypeScript + Vite.
2. Add empty shell UI with narrow left navigation.
3. Add MySQL connection and migrations.
4. Add course CRUD.
5. Embed `simple-mind-map` exactly as the mind-map canvas.
6. Persist `simple-mind-map` snapshots and `mind_map_nodes`.
7. Verify create child, edit title, save, close, reopen, restore.

Word editor comes after the mind-map persistence contract is stable.

## Current Implemented Surfaces - 0.1.76

The public version has moved beyond the first milestone. Current shipped surfaces are:

- Course and section management with MySQL persistence, local mirror fallback, pending operation replay, drag sorting, and section collapse.
- Mind-map workspace backed by `simple-mind-map`, full snapshot persistence, node projection, right-side catalog, topic element editing, export, layout switching, canvas viewport controls, and focused node views.
- Mind-map free node positioning is disabled for the default knowledge workspace. Saved `customLeft/customTop` coordinates are stripped during snapshot normalization so structured layouts do not reopen with crossing branches.
- Mind-map runtime loads the `simple-mind-map` core package and registers only the required plugin whitelist, avoiding packaged runtime failures from the full plugin bundle.
- Mind-map text formatting is intentionally removed from the top toolbar. It opens from a selected topic through a canvas right-click floating panel.
- Mind-map topic bubble right-edge resizing is handled inside the simple-mind-map adapter. The stored bubble width must move the rendered shape and text together; it is not a separate text-box resize feature.
- Mind-map branch/layout operations are controlled by configurable shortcuts in Settings.
- Word-style node documents backed by `@hufe921/canvas-editor`, stored as node-bound snapshots through `(course_id, mind_map_id, node_id)`.
- Document editor uses a wide page size in a vertical reading flow. Do not use `PaperDirection.HORIZONTAL` for the normal document workspace; it creates a side-by-side blank page area.
- Current node documents can be exported to `.docx` through Electron main. Export is a projection of the active document snapshot and does not change MySQL content.
- Importer supports `.txt`, `.md`, `.markdown`, and `.docx` into node documents.
- Textbook workspace supports course/mind-map scoped PDF assets, node page-range binding, node textbook notes, shared math paste normalization, detached PDF windows, and MySQL-backed PDF annotations.
- Textbook assets and notes use DB-first storage with local JSON only as disconnected fallback. PDF annotations are DB-owned and pause when the database is unavailable, avoiding a second local annotation source.
- Chrome fixed-port management currently covers 豆包、ChatGPT、Bilibili、知乎、智联招聘、BOSS 直聘 and 小红书.
- Settings contains runtime diagnostics, MCP control, shortcut settings, update management, and user-facing error logs.
- AI assistant sends prompts through fixed Chrome debugging ports. Chrome discovery accepts registered executables, common install paths, and PATH launchers such as `chrome.cmd` when they point to a real `chrome.exe`; ChatGPT submission prepares the web input, sends through a trusted CDP Enter key event, then reads the reply by conversation order after the current send. Electron main uses Node `ws` with safe Buffer decoding for CDP calls.
- MCP is a first-class module with renderer UI, Electron controller, external stdio server, HTTP remote access, Tailscale LAN exposure, read/edit tool boundaries, permissions, and call monitoring.
- Tailscale LAN access is not public internet access. It uses Tailscale Serve for same-tailnet devices and must keep remote edit permissions off by default.
- App updates preserve runtime data and database configuration. Version updates must not overwrite user courses, mind maps, documents, MCP remote state, or MySQL config.
- The Windows installer is a slim app package. MySQL and VC++ runtime setup is handled by `build/installer/install-aistudy-mysql-runtime.ps1` during install and may download runtime dependencies on the target machine; dependency setup failure must not block opening the app.
- The main knowledge workspace has collapsible left knowledge-base pane and right catalog pane. Collapsing side panes must not collapse or zero-width the central mind-map/document canvas.
- Storage boundaries are declared in `electron/storageBoundary.ts` and checked by `npm run qa:data-boundaries` during build.
- ChatGPT/KaTeX/MathML/plain-text math paste normalization lives in `src/renderer/features/mathInput/` and is checked by `npm run qa:math-clipboard` during build.
- `dist:oneclick` removes runtime data from the installer source and writes `release/build-manifest.json` with version, commit, dirty state, and artifact hashes.
- Do not re-embed `mysql-8.4.7-winx64.zip` or `vc_redist.x64.exe` into the main NSIS package unless explicitly building a separate offline dependency package.

## Current Module Map

```text
electron/main.ts
  Window lifecycle, MySQL, course/mindmap/document IPC, updates, diagnostics, errors, MCP bridge.

electron/storageBoundary.ts
  DB-first and local-preference module ownership registry used by diagnostics and QA guards.

electron/textbookAnnotationService.ts
  Main-side service for DB-owned textbook PDF annotations.

electron/preload.cts
  ContextBridge surface for renderer APIs. Renderer must not bypass this layer.

electron/mcp/
  MCP controller, remote access server, Tailscale Serve integration, permissions, call monitor.

scripts/mcp/aistudy-mcp-server.mjs
  External stdio MCP entry for Codex/Claude/Cursor style clients.

src/renderer/main.tsx
  Shell, settings dialog, side-pane collapse state, shortcut settings page.

src/renderer/features/course/
  Left knowledge-base list, sections, reorder, copy local locator path.

src/renderer/features/mindmap/
  Mind-map workspace, simple-mind-map adapter, topic elements, shortcut settings, catalog.

src/renderer/features/documents/
  Node document workspace, canvas-editor adapter, document snapshot and toolbar logic.

src/renderer/features/textbook/
  Textbook PDF viewer, node page-range binding, note editor, PDF annotation layer, and textbook service wrappers.

src/renderer/features/mcp/
  MCP settings UI, tool toggles, debugging output, LAN access state, permissions and monitor controls.
```

## Current Feature Rules

- Do not reintroduce large engineering-style MCP cards. MCP stays in Settings as a compact Windows-settings-style vertical list.
- Do not show raw paths, SQL, stack traces, or internal IDs in product pages unless the user explicitly requests an integration handoff such as MCP URL/API URL/Authorization or local knowledge-base path copy.
- Knowledge-base path copy must provide a local locator path that other Codex instances can use, not a breadcrumb like `知识库 / AI Study / 开发需求`.
- Remote MCP access copy output must contain exactly the connection lines needed by another device. Product UI may mask the authorization value, but the copy action must preserve the full token:

```text
MCP URL: ...
API URL: ...
Authorization: Bearer ...
```

- External MCP calls must be observable when monitoring is enabled.
- Remote edit access must be permission-gated by capability: course management, mind-map editing, document writing, destructive operations.
- Build verification is `npm run build`. Data-boundary verification is `npm run qa:data-boundaries`. Math paste verification is `npm run qa:math-clipboard`. Textbook data-contract verification is `npm run qa:textbook`. Installer verification is `npm run dist:oneclick`.
- `npm run dist:oneclick` rewrites `docs/updates/INDEX.md`; restore the real release summary after packaging.

