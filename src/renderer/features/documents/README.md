# Documents Module

## Scope

Documents owns node-bound Word-like detail documents powered by `@hufe921/canvas-editor`.

Current files:

- `KnowledgeDocumentWorkspace.tsx`: selected-node document loading, saving, toolbar, page navigation, importer entry, DOCX export, and inline AI panel.
- `canvasEditorAdapter.ts`: the only place that creates and controls the canvas editor instance.
- `knowledgeDocumentTypes.ts`: document snapshot, status, save input, command, and format-state types.
- `../mathInput/mathClipboard.ts`: shared ChatGPT/KaTeX/MathML/plain-text math paste normalization used before inserting into canvas-editor.

## Boundaries

- Word documents bind only by `courseId + mindMapId + nodeId`.
- The workspace must not bind documents by title, path, or UI selection text.
- Renderer code must save through `window.aistudyKnowledgeDocuments` or the local snapshot fallback.
- `knowledge_documents` stores the current pointer and metadata only; actual content belongs to snapshots.
- Large images and attachments must not be stored as long inline base64 in document JSON.
- DOCX export is a read-only projection of the current node document snapshot; it must not mutate the editor snapshot or document binding.
- Column layout is currently block-level: the editor converts simple text documents into a 1-row canvas-editor table marked as `aistudyBlockKind: "columns"`. Content columns are split by full page inner width, with disabled spacer cells on both sides of each center divider so text does not touch the divider. Complex documents fall back to inserting an empty column block instead of rewriting tables or images. It is saved in the normal snapshot, reopens through the existing document loader, and exports to DOCX as content columns with only the internal divider. It is not a page/section-level flowing Word columns implementation.

## User Flow

1. User switches from the mind map to Word mode.
2. Mind-map changes flush first so the selected node exists in `mind_map_nodes`.
3. The document workspace loads the selected node document or creates an empty local snapshot.
4. Editor changes queue a debounced save.
5. Node switching, mode switching, and app close all flush pending document changes.
6. User can export the current node document as `.docx`; the main process owns file dialog and file writing.

## Extension Rules

- Add canvas-editor commands to the adapter handle before exposing them in UI.
- Keep document status loading lightweight; do not load every document snapshot for a course.
- Importers must produce a document snapshot and commit through the existing save path.
- Exporters must read from the active document snapshot and keep generated files outside MySQL.
- New asset handling must write to asset storage/link tables instead of embedding binaries.
- Math paste behavior must stay shared with textbook notes through `features/mathInput`; do not add document-only symbol replacements in this adapter.
