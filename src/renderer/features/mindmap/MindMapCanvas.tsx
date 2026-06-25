import React from "react";
import {
  areViewportScrollStatesEqual,
  EMPTY_VIEWPORT_SCROLL_STATE,
  ViewportScrollbars,
  type ViewportScrollAxis,
  type ViewportScrollState
} from "../../lib/ViewportScrollbars";
import { createSimpleMindMapEditor } from "./simpleMindMapAdapter";
import type {
  MindMapCommand,
  MindMapCommandPayload,
  MindMapEditorHandle,
  MindMapExportType,
  MindMapLayoutType,
  MindMapSelectedNode,
  MindMapSnapshot,
  MindMapTextFormatPatch
} from "./mindMapTypes";

export type MindMapCanvasHandle = {
  exec: (command: MindMapCommand, payload?: MindMapCommandPayload) => void;
  selectNode: (nodeId: string) => MindMapSelectedNode | null;
  setLayout: (layout: MindMapLayoutType) => MindMapSnapshot | null;
  applyTextFormat: (patch: MindMapTextFormatPatch) => MindMapSelectedNode | null;
  exportFile: (type: MindMapExportType, fileName: string) => Promise<void>;
  setCanvasDragEnabled: (enabled: boolean) => void;
  getSnapshot: () => MindMapSnapshot | null;
};

type MindMapCanvasProps = {
  snapshot: MindMapSnapshot;
  canvasDragEnabled: boolean;
  onSnapshotChanged: (snapshot: MindMapSnapshot) => void;
  onNodeSelected: (node: MindMapSelectedNode) => void;
  onReadyChange: (ready: boolean) => void;
  onError: (message: string) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
};

export const MindMapCanvas = React.forwardRef<MindMapCanvasHandle, MindMapCanvasProps>(function MindMapCanvas(
  { snapshot, canvasDragEnabled, onSnapshotChanged, onNodeSelected, onReadyChange, onError, onContextMenu },
  ref
) {
  const mountRef = React.useRef<HTMLDivElement | null>(null);
  const editorRef = React.useRef<MindMapEditorHandle | null>(null);
  const latestSnapshotRef = React.useRef(snapshot);
  const canvasDragEnabledRef = React.useRef(canvasDragEnabled);
  const eventsRef = React.useRef({
    onSnapshotChanged,
    onNodeSelected,
    onReadyChange,
    onError
  });
  const [viewportState, setViewportState] = React.useState<ViewportScrollState>(EMPTY_VIEWPORT_SCROLL_STATE);

  const commitViewportState = React.useCallback((nextState: ViewportScrollState) => {
    setViewportState((previousState) =>
      areViewportScrollStatesEqual(previousState, nextState) ? previousState : nextState
    );
  }, []);

  React.useEffect(() => {
    eventsRef.current = {
      onSnapshotChanged,
      onNodeSelected,
      onReadyChange,
      onError
    };
  }, [onError, onNodeSelected, onReadyChange, onSnapshotChanged]);

  React.useEffect(() => {
    latestSnapshotRef.current = snapshot;
  }, [snapshot]);

  React.useEffect(() => {
    canvasDragEnabledRef.current = canvasDragEnabled;
    editorRef.current?.setCanvasDragEnabled(canvasDragEnabled);
  }, [canvasDragEnabled]);

  React.useImperativeHandle(
    ref,
    () => ({
      exec: (command, payload) => editorRef.current?.exec(command, payload),
      selectNode: (nodeId) => editorRef.current?.selectNode(nodeId) ?? null,
      setLayout: (layout) => editorRef.current?.setLayout(layout) ?? null,
      applyTextFormat: (patch) => editorRef.current?.applyTextFormat(patch) ?? null,
      exportFile: async (type, fileName) => {
        await editorRef.current?.exportFile(type, fileName);
      },
      setCanvasDragEnabled: (enabled) => editorRef.current?.setCanvasDragEnabled(enabled),
      getSnapshot: () => editorRef.current?.getSnapshot() ?? null
    }),
    []
  );

  React.useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    let isDisposed = false;
    let isCreating = false;
    let frameId: number | null = null;
    eventsRef.current.onReadyChange(false);

    const hasStableSize = () => {
      const rect = mount.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const createEditor = () => {
      if (isDisposed || isCreating || editorRef.current) return;
      if (!hasStableSize()) return;
      isCreating = true;

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        if (isDisposed || editorRef.current || !hasStableSize()) {
          isCreating = false;
          return;
        }

        mount.replaceChildren();
        const editorSurface = document.createElement("div");
        editorSurface.className = "mindmap-canvas-surface";
        mount.appendChild(editorSurface);

        createSimpleMindMapEditor(editorSurface, latestSnapshotRef.current, {
          onSnapshotChanged: (nextSnapshot) => eventsRef.current.onSnapshotChanged(nextSnapshot),
          onNodeSelected: (node) => eventsRef.current.onNodeSelected(node),
          onViewportChanged: commitViewportState,
          onReady: () => {
            if (!isDisposed) eventsRef.current.onReadyChange(true);
          },
          onError: (message) => eventsRef.current.onError(message)
        }, {
          canvasDragEnabled: canvasDragEnabledRef.current
        })
          .then((editor) => {
            if (isDisposed || editorRef.current || editorSurface.parentElement !== mount) {
              editor.destroy();
              editorSurface.remove();
              return;
            }
            editorRef.current = editor;
            editor.setCanvasDragEnabled(canvasDragEnabledRef.current);
            editor.setViewportControlSize(mount.clientWidth, mount.clientHeight);
          })
          .catch((error: unknown) => {
            if (!isDisposed) {
              editorSurface.remove();
              eventsRef.current.onError(error instanceof Error ? error.message : "导图编辑器载入失败");
              eventsRef.current.onReadyChange(false);
            }
          })
          .finally(() => {
            isCreating = false;
          });
      });
    };

    mount.replaceChildren();
    const resizeObserver = new ResizeObserver(() => {
      createEditor();
      if (hasStableSize()) {
        editorRef.current?.resize();
        editorRef.current?.setViewportControlSize(mount.clientWidth, mount.clientHeight);
      }
    });
    resizeObserver.observe(mount);
    createEditor();

    return () => {
      isDisposed = true;
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
      resizeObserver.disconnect();
      editorRef.current?.destroy();
      editorRef.current = null;
      commitViewportState(EMPTY_VIEWPORT_SCROLL_STATE);
      mount.replaceChildren();
      eventsRef.current.onReadyChange(false);
    };
  }, [commitViewportState]);

  const handleViewportChange = React.useCallback((axis: ViewportScrollAxis, position: number) => {
    editorRef.current?.scrollViewport(axis, position);
  }, []);

  return (
    <div className="mindmap-canvas-frame" onContextMenu={onContextMenu}>
      <div ref={mountRef} className="mindmap-canvas-host" />
      <ViewportScrollbars
        className="mindmap-viewport-scrollbars"
        state={viewportState}
        onChange={handleViewportChange}
      />
    </div>
  );
});
