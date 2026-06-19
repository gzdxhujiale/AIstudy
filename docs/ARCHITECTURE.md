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
