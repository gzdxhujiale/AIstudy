# Mind Map Module

## Scope

Mind map owns the `simple-mind-map` editor, mind-map snapshot normalization, right-side catalog data, focused-node views, text formatting, bubble resizing, layout switching, and export commands.

Current files:

- `MindMapWorkspace.tsx`: workspace state, load/save flow, editor-mode switching, and document workspace handoff.
- `MindMapCanvas.tsx`: React mount boundary for the editor adapter.
- `simpleMindMapAdapter.ts`: the only place that touches the third-party editor instance, including topic bubble right-edge resizing.
- `mindMapSnapshot.ts`: snapshot protocol, tree normalization, stable node ids, and catalog generation.
- `MindMapCatalog.tsx`: derived catalog UI, local collapse state, and hierarchy readability rules.
- `MindMapTextFormatToolbar.tsx`: selected-node text formatting controls.

## Boundaries

- Do not hand-roll a mind-map canvas.
- Do not access `simple-mind-map` private APIs outside `simpleMindMapAdapter.ts`.
- The mind-map tree is the only source for catalog hierarchy.
- Node titles can repeat; `data.uid` is the stable node key.
- Renderer code must save through `window.aistudyMindMaps` or the local snapshot fallback.
- Topic bubble sizing must be stored in node data and rendered through the adapter so text, shape, snapshot, undo, export, and reopen stay aligned.
- Catalog boundary uses `data.aistudyCatalogBoundary` to stop only the right-side catalog projection at that node; the real mind-map children remain editable and persisted.

## User Flow

1. Selecting a course loads its current mind-map document.
2. If MySQL is unavailable, the workspace opens the local IndexedDB fallback.
3. Editor changes queue a debounced save.
4. Saving writes a full snapshot and lets the main process project nodes into `mind_map_nodes`.
5. Switching to Word mode flushes pending mind-map changes first.
6. Right-side catalog deletion removes the selected branch, its descendants, the matching master mind-map branch, and bound local node-document snapshots.
7. The right-side catalog toolbar supports expand all, collapse all, and a right-click expand mode that shows only branch headings while keeping leaf items hidden.

## Extension Rules

- Update `mindMapSnapshot.ts` before changing node identity, catalog hierarchy, or snapshot fields.
- Add third-party editor behavior through the adapter handle, not through workspace components.
- Catalog state such as expanded/collapsed UI is local UI state and must not become stored domain data.
- Catalog boundary is not collapse state. It is stored node data because it changes the saved catalog projection after reopen.
- Catalog hierarchy styling is a reading aid only. It must derive from `MindMapOutlineItem.level` and must not mutate node text format or mind-map snapshot data.
- New exports should use adapter commands and avoid scraping DOM state.
- Resize handles belong to topic bubbles, not editor text boxes. Dragging the right edge should resize the bubble while the text layout moves with it.
