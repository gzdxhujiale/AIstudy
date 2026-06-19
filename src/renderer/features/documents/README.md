# Documents Module

## Scope

Documents owns node-bound Word-like detail documents powered by `@hufe921/canvas-editor`.

Current files:

- `KnowledgeDocumentWorkspace.tsx`: selected-node document loading, saving, toolbar, page navigation, importer entry, and inline AI panel.
- `canvasEditorAdapter.ts`: the only place that creates and controls the canvas editor instance.
- `knowledgeDocumentTypes.ts`: document snapshot, status, save input, command, and format-state types.

## Boundaries

- Word documents bind only by `courseId + mindMapId + nodeId`.
- The workspace must not bind documents by title, path, or UI selection text.
- Renderer code must save through `window.aistudyKnowledgeDocuments` or the local snapshot fallback.
- `knowledge_documents` stores the current pointer and metadata only; actual content belongs to snapshots.
- Large images and attachments must not be stored as long inline base64 in document JSON.

## User Flow

1. User switches from the mind map to Word mode.
2. Mind-map changes flush first so the selected node exists in `mind_map_nodes`.
3. The document workspace loads the selected node document or creates an empty local snapshot.
4. Editor changes queue a debounced save.
5. Node switching, mode switching, and app close all flush pending document changes.

## Extension Rules

- Add canvas-editor commands to the adapter handle before exposing them in UI.
- Keep document status loading lightweight; do not load every document snapshot for a course.
- Importers must produce a document snapshot and commit through the existing save path.
- New asset handling must write to asset storage/link tables instead of embedding binaries.
