# Mind Map Module

## Scope

Mind map owns the `simple-mind-map` editor, mind-map snapshot normalization, right-side catalog data, focused-node views, text formatting, layout switching, and export commands.

Current files:

- `MindMapWorkspace.tsx`: workspace state, load/save flow, editor-mode switching, and document workspace handoff.
- `MindMapCanvas.tsx`: React mount boundary for the editor adapter.
- `simpleMindMapAdapter.ts`: the only place that touches the third-party editor instance.
- `mindMapSnapshot.ts`: snapshot protocol, tree normalization, stable node ids, and catalog generation.
- `MindMapCatalog.tsx`: derived catalog UI.
- `MindMapTextFormatToolbar.tsx`: selected-node text formatting controls.

## Boundaries

- Do not hand-roll a mind-map canvas.
- Do not access `simple-mind-map` private APIs outside `simpleMindMapAdapter.ts`.
- The mind-map tree is the only source for catalog hierarchy.
- Node titles can repeat; `data.uid` is the stable node key.
- Renderer code must save through `window.aistudyMindMaps` or the local snapshot fallback.

## User Flow

1. Selecting a course loads its current mind-map document.
2. If MySQL is unavailable, the workspace opens the local IndexedDB fallback.
3. Editor changes queue a debounced save.
4. Saving writes a full snapshot and lets the main process project nodes into `mind_map_nodes`.
5. Switching to Word mode flushes pending mind-map changes first.

## Extension Rules

- Update `mindMapSnapshot.ts` before changing node identity, catalog hierarchy, or snapshot fields.
- Add third-party editor behavior through the adapter handle, not through workspace components.
- Catalog state such as expanded/collapsed UI is local UI state and must not become stored domain data.
- New exports should use adapter commands and avoid scraping DOM state.
