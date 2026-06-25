import React from "react";
import {
  CircleCheck,
  Download,
  GitBranch,
  Image,
  Link2,
  Maximize2,
  Minus,
  Move,
  Plus,
  Redo2,
  Rows3,
  Save,
  SlidersHorizontal,
  StickyNote,
  Tags,
  Trash2,
  Undo2,
  X
} from "lucide-react";
import { MindMapCanvas, type MindMapCanvasHandle } from "./MindMapCanvas";
import { MindMapTextFormatToolbar } from "./MindMapTextFormatToolbar";
import { KnowledgeDocumentWorkspace } from "../documents/KnowledgeDocumentWorkspace";
import { registerBeforeCloseSave } from "../../lib/saveDrain";
import { readLocalSnapshot, writeLocalSnapshot } from "../../lib/localSnapshotStore";
import {
  buildMindMapOutline,
  countNodes,
  createInitialSnapshot,
  MIND_MAP_LAYOUT_OPTIONS,
  normalizeLayout,
  normalizeSnapshot
} from "./mindMapSnapshot";
import {
  isMindMapShortcutEvent,
  MIND_MAP_BRANCH_SHORTCUTS,
  MIND_MAP_SHORTCUTS_CHANGED_EVENT,
  readMindMapShortcutSettings,
  type MindMapBranchShortcutCommand,
  type MindMapShortcutSettings
} from "./mindMapShortcutSettings";
import type {
  MindMapDocument,
  MindMapExportType,
  MindMapLayoutType,
  MindMapOutlineItem,
  MindMapSaveInput,
  MindMapSelectedNode,
  MindMapSnapshot,
  SimpleMindMapNode,
  MindMapCommandPayload,
  MindMapTextFormatPatch
} from "./mindMapTypes";

export type WorkspaceEditorMode = "mindmap" | "word";

export type WorkspaceModeChangeRequest = {
  mode: WorkspaceEditorMode;
  nonce: number;
};

export type WorkspaceNodeSelectionRequest = {
  nodeId: string | null;
  nonce: number;
};

type MindMapWorkspaceProps = {
  courseId: string | null;
  courseName: string;
  editorMode: WorkspaceEditorMode;
  externalChangeRevision?: number;
  modeChangeRequest: WorkspaceModeChangeRequest | null;
  nodeSelectionRequest: WorkspaceNodeSelectionRequest | null;
  onEditorModeChange: (mode: WorkspaceEditorMode) => void;
  onOutlineChanged?: (outline: MindMapOutlineItem[]) => void;
  onNodeSelectedChanged?: (node: MindMapSelectedNode) => void;
  isCatalogPaneCollapsed?: boolean;
  documentDetailPaneMode?: "catalog" | "format";
  onOpenDocumentFormatPane?: () => void;
  onCloseDocumentFormatPane?: () => void;
};

type PendingSave = MindMapSaveInput;

type StorageMode = "mysql" | "local" | "none";
type TopicElementPanel = "note" | "tags" | "link" | "image" | "marker";
type TopicElements = NonNullable<MindMapSelectedNode["topicElements"]>;
type TextFormatMenuPosition = { x: number; y: number };

const EMPTY_TOPIC_ELEMENTS: TopicElements = {
  note: "",
  tags: [],
  hyperlink: "",
  hyperlinkTitle: "",
  imageUrl: "",
  imageTitle: "",
  priority: "",
  progress: "",
  expanded: true
};

const PRIORITY_OPTIONS = ["", "1", "2", "3", "4", "5"];
const PROGRESS_OPTIONS = ["", "1", "2", "3", "4", "5", "6", "7", "8"];
const FORMAT_PANEL_COLORS = ["#17466f", "#1f6fd1", "#0f766e", "#b45309", "#dc2626", "#7c3aed", "#334155", "#ffffff"];
const FORMAT_PANEL_WIDTH_OPTIONS = [
  { value: "", label: "自动" },
  { value: "120", label: "窄" },
  { value: "170", label: "适中" },
  { value: "240", label: "宽" }
];

function isInteractiveKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    target.closest(".settings-dialog") !== null ||
    target.closest(".mindmap-topic-popover") !== null ||
    target.closest(".mindmap-text-context-menu") !== null ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.closest("[contenteditable='true']") !== null
  );
}

declare global {
  interface Window {
    aistudyMindMaps?: {
      load: (courseId: string) => Promise<MindMapDocument | null>;
      save: (document: MindMapSaveInput) => Promise<MindMapDocument>;
    };
  }
}

const SNAPSHOT_KEY_PREFIX = "aistudy:mindmap-document:v1:";
const LEGACY_SNAPSHOT_KEY_PREFIX = "aistudy:mindmap-snapshot:v1:";
const SAVE_DEBOUNCE_MS = 900;
const EXPORT_OPTIONS: Array<{ value: MindMapExportType; label: string }> = [
  { value: "png", label: "PNG" },
  { value: "svg", label: "SVG" },
  { value: "xmind", label: "XMind" },
  { value: "json", label: "JSON" },
  { value: "md", label: "Markdown" }
];

function createMindMapId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `mindmap_${crypto.randomUUID().replaceAll("-", "")}`;
  }
  return `mindmap_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getStorageKey(courseId: string) {
  return `${SNAPSHOT_KEY_PREFIX}${courseId}`;
}

function getLegacyStorageKey(courseId: string) {
  return `${LEGACY_SNAPSHOT_KEY_PREFIX}${courseId}`;
}

function createDocument(courseId: string, courseName: string): MindMapDocument {
  const snapshot = createInitialSnapshot(courseName);
  return {
    courseId,
    mapId: createMindMapId(),
    title: courseName,
    snapshot,
    updatedAt: null,
    nodeCount: countNodes(snapshot.root)
  };
}

function normalizeDocument(value: unknown, courseId: string, courseName: string): MindMapDocument {
  if (!value || typeof value !== "object") {
    return createDocument(courseId, courseName);
  }

  const candidate = value as Partial<MindMapDocument>;
  const snapshot = normalizeSnapshot(candidate.snapshot ?? value, courseName);
  return {
    courseId,
    mapId: typeof candidate.mapId === "string" && candidate.mapId ? candidate.mapId : createMindMapId(),
    title: typeof candidate.title === "string" && candidate.title ? candidate.title : courseName,
    snapshot,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : null,
    nodeCount: countNodes(snapshot.root)
  };
}

async function loadLocalDocument(courseId: string, courseName: string): Promise<MindMapDocument> {
  try {
    const snapshotDocument = await readLocalSnapshot<MindMapDocument>(getStorageKey(courseId));
    if (snapshotDocument) {
      return normalizeDocument(snapshotDocument, courseId, courseName);
    }
  } catch {
    // IndexedDB is a fallback layer; failure should not block legacy recovery.
  }

  try {
    const storageKey = getStorageKey(courseId);
    const rawDocument = localStorage.getItem(storageKey);
    if (rawDocument) {
      const document = normalizeDocument(JSON.parse(rawDocument), courseId, courseName);
      void writeLocalSnapshot(storageKey, "mindmap", document);
      return document;
    }

    const rawLegacySnapshot = localStorage.getItem(getLegacyStorageKey(courseId));
    if (rawLegacySnapshot) {
      const document = normalizeDocument(JSON.parse(rawLegacySnapshot), courseId, courseName);
      void writeLocalSnapshot(storageKey, "mindmap", document);
      return document;
    }
  } catch {
    // A corrupt local cache should never block opening the editor.
  }

  return createDocument(courseId, courseName);
}

async function saveLocalDocument(input: PendingSave): Promise<MindMapDocument> {
  const snapshot = normalizeSnapshot(input.snapshot, input.title);
  const document: MindMapDocument = {
    courseId: input.courseId,
    mapId: input.mapId ?? createMindMapId(),
    title: input.title,
    snapshot,
    updatedAt: new Date().toISOString(),
    nodeCount: countNodes(snapshot.root)
  };
  await writeLocalSnapshot(getStorageKey(input.courseId), "mindmap", document);
  return document;
}

async function loadPersistedDocument(courseId: string, courseName: string) {
  if (!window.aistudyMindMaps) {
    return { document: await loadLocalDocument(courseId, courseName), mode: "local" as StorageMode, error: "" };
  }

  try {
    const remoteDocument = await window.aistudyMindMaps.load(courseId);
    return {
      document: remoteDocument ? normalizeDocument(remoteDocument, courseId, courseName) : createDocument(courseId, courseName),
      mode: "mysql" as StorageMode,
      error: ""
    };
  } catch (error) {
    return {
      document: await loadLocalDocument(courseId, courseName),
      mode: "local" as StorageMode,
      error: getErrorMessage(error, "导图读取失败，已打开本地副本")
    };
  }
}

function formatSavedAt() {
  return new Date().toLocaleTimeString();
}

function sanitizeFileName(value: string) {
  return (value || "AIstudy导图").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "AIstudy导图";
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? `${fallback}: ${error.message}` : fallback;
}

function findOutlineItem(items: MindMapOutlineItem[], nodeId: string): MindMapOutlineItem | null {
  for (const item of items) {
    if (item.nodeId === nodeId) return item;
    const child = findOutlineItem(item.children, nodeId);
    if (child) return child;
  }
  return null;
}

function countOutlineItems(items: MindMapOutlineItem[]) {
  let count = 0;
  const stack = [...items];

  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) continue;
    count += 1;
    for (let index = 0; index < item.children.length; index += 1) {
      stack.push(item.children[index]);
    }
  }

  return count;
}

function cloneMindMapNode(node: SimpleMindMapNode): SimpleMindMapNode {
  return {
    ...node,
    data: {
      ...node.data
    },
    children: Array.isArray(node.children) ? node.children.map(cloneMindMapNode) : []
  };
}

function getNodeId(node: SimpleMindMapNode | null | undefined) {
  return typeof node?.data?.uid === "string" && node.data.uid ? node.data.uid : null;
}

function findNodeInTree(root: SimpleMindMapNode | null | undefined, nodeId: string | null): SimpleMindMapNode | null {
  if (!root || !nodeId) return null;
  if (getNodeId(root) === nodeId) return root;
  const children = Array.isArray(root.children) ? root.children : [];
  for (const child of children) {
    const found = findNodeInTree(child, nodeId);
    if (found) return found;
  }
  return null;
}

function replaceNodeInTree(
  root: SimpleMindMapNode,
  nodeId: string,
  replacement: SimpleMindMapNode
): { root: SimpleMindMapNode; replaced: boolean } {
  if (getNodeId(root) === nodeId) {
    return { root: cloneMindMapNode(replacement), replaced: true };
  }

  let replaced = false;
  const children = Array.isArray(root.children)
    ? root.children.map((child) => {
        const result = replaceNodeInTree(child, nodeId, replacement);
        replaced = replaced || result.replaced;
        return result.root;
      })
    : [];

  return {
    root: {
      ...root,
      data: {
        ...root.data
      },
      children
    },
    replaced
  };
}

function createFocusedSnapshot(masterSnapshot: MindMapSnapshot, focusedNodeId: string | null): MindMapSnapshot {
  if (!focusedNodeId || getNodeId(masterSnapshot.root) === focusedNodeId) {
    return masterSnapshot;
  }

  const focusedNode = findNodeInTree(masterSnapshot.root, focusedNodeId);
  if (!focusedNode) {
    return masterSnapshot;
  }

  return {
    ...masterSnapshot,
    root: cloneMindMapNode(focusedNode),
    view: undefined
  };
}

function mergeFocusedSnapshot(
  masterSnapshot: MindMapSnapshot | null,
  focusedNodeId: string | null,
  focusedSnapshot: MindMapSnapshot
): MindMapSnapshot {
  if (!masterSnapshot || !focusedNodeId || getNodeId(masterSnapshot.root) === focusedNodeId) {
    return focusedSnapshot;
  }

  const result = replaceNodeInTree(masterSnapshot.root, focusedNodeId, focusedSnapshot.root);
  if (!result.replaced) {
    return focusedSnapshot;
  }

  return {
    ...masterSnapshot,
    root: result.root,
    layout: focusedSnapshot.layout,
    theme: focusedSnapshot.theme,
    view: undefined,
    updatedAt: focusedSnapshot.updatedAt
  };
}

function isSameSelectedNode(left: MindMapSelectedNode, right: MindMapSelectedNode) {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.textFormat?.fontWeight === right.textFormat?.fontWeight &&
    left.textFormat?.fontStyle === right.textFormat?.fontStyle &&
    left.textFormat?.textDecoration === right.textFormat?.textDecoration &&
    left.textFormat?.color === right.textFormat?.color &&
    left.textFormat?.fontSize === right.textFormat?.fontSize &&
    left.textFormat?.textAutoWrapWidth === right.textFormat?.textAutoWrapWidth &&
    left.textFormat?.fillColor === right.textFormat?.fillColor &&
    left.textFormat?.borderColor === right.textFormat?.borderColor &&
    left.textFormat?.borderWidth === right.textFormat?.borderWidth &&
    JSON.stringify(left.topicElements ?? EMPTY_TOPIC_ELEMENTS) === JSON.stringify(right.topicElements ?? EMPTY_TOPIC_ELEMENTS)
  );
}

export function MindMapWorkspace({
  courseId,
  courseName,
  editorMode,
  externalChangeRevision = 0,
  modeChangeRequest,
  nodeSelectionRequest,
  onEditorModeChange,
  onOutlineChanged,
  onNodeSelectedChanged,
  isCatalogPaneCollapsed,
  documentDetailPaneMode = "catalog",
  onOpenDocumentFormatPane,
  onCloseDocumentFormatPane
}: MindMapWorkspaceProps) {
  const workspaceRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<MindMapCanvasHandle | null>(null);
  const saveTimerRef = React.useRef<number | null>(null);
  const pendingSaveRef = React.useRef<PendingSave | null>(null);
  const activeSaveRef = React.useRef<Promise<MindMapDocument | null>>(Promise.resolve(null));
  const loadSequenceRef = React.useRef(0);
  const [snapshot, setSnapshot] = React.useState<MindMapSnapshot | null>(null);
  const snapshotRef = React.useRef<MindMapSnapshot | null>(null);
  const [mapId, setMapId] = React.useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = React.useState<string | null>(null);
  const [selectedNode, setSelectedNode] = React.useState<MindMapSelectedNode>({ id: null, title: "" });
  const [isReady, setIsReady] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isExporting, setIsExporting] = React.useState(false);
  const [canvasDragEnabled, setCanvasDragEnabled] = React.useState(false);
  const [exportType, setExportType] = React.useState<MindMapExportType>("png");
  const [storageMode, setStorageMode] = React.useState<StorageMode>("none");
  const [error, setError] = React.useState("");
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [topicPanel, setTopicPanel] = React.useState<TopicElementPanel | null>(null);
  const [textFormatMenu, setTextFormatMenu] = React.useState<TextFormatMenuPosition | null>(null);
  const [shortcutSettings, setShortcutSettings] = React.useState<MindMapShortcutSettings>(() => readMindMapShortcutSettings());
  const [isFormatPanelOpen, setIsFormatPanelOpen] = React.useState(false);
  const canUseEditor = isReady && !isLoading;
  const selectedNodeRef = React.useRef(selectedNode);
  const canUseEditorRef = React.useRef(canUseEditor);
  const editorModeRef = React.useRef(editorMode);
  const shortcutSettingsRef = React.useRef(shortcutSettings);

  React.useEffect(() => {
    selectedNodeRef.current = selectedNode;
  }, [selectedNode]);

  React.useEffect(() => {
    canUseEditorRef.current = canUseEditor;
  }, [canUseEditor]);

  React.useEffect(() => {
    editorModeRef.current = editorMode;
  }, [editorMode]);

  React.useEffect(() => {
    shortcutSettingsRef.current = shortcutSettings;
  }, [shortcutSettings]);

  React.useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  React.useEffect(() => {
    setTextFormatMenu(null);
    setTopicPanel(null);
  }, [courseId, editorMode, selectedNode.id]);

  const publishSelectedNode = React.useCallback(
    (node: MindMapSelectedNode) => {
      if (isSameSelectedNode(selectedNodeRef.current, node)) return;
      selectedNodeRef.current = node;
      setSelectedNode(node);
      onNodeSelectedChanged?.(node);
    },
    [onNodeSelectedChanged]
  );

  const persistDocument = React.useCallback(async (input: PendingSave, silent = false): Promise<MindMapDocument | null> => {
    if (!silent) {
      setIsSaving(true);
    }

    try {
      if (!window.aistudyMindMaps) {
        try {
          const localDocument = await saveLocalDocument(input);
          if (!silent) {
            setMapId(localDocument.mapId);
            setStorageMode("local");
            setSavedAt(formatSavedAt());
            setError("");
          }
          return localDocument;
        } catch (localError) {
          if (!silent) {
            setStorageMode("none");
            setError(getErrorMessage(localError, "导图本地缓存失败"));
          }
          return null;
        }
      }

      const remoteDocument = await window.aistudyMindMaps.save(input);
      if (!silent) {
        setMapId(remoteDocument.mapId);
        setStorageMode("mysql");
          setSavedAt(formatSavedAt());
          setError("");
        }
      return remoteDocument;
    } catch (error) {
      try {
        const localDocument = await saveLocalDocument(input);
        if (!silent) {
          setMapId(localDocument.mapId);
          setStorageMode("local");
          setSavedAt(formatSavedAt());
          setError(getErrorMessage(error, "导图保存失败，已保存到本地副本"));
        }
        return localDocument;
      } catch (localError) {
        if (!silent) {
          setStorageMode("none");
          setError(`${getErrorMessage(error, "导图保存失败")}；${getErrorMessage(localError, "本地副本也保存失败")}`);
        }
        return null;
      }
    } finally {
      if (!silent) {
        setIsSaving(false);
      }
    }
  }, []);

  const flushPendingSave = React.useCallback((silent = false): Promise<MindMapDocument | null> => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (!pending) {
      return activeSaveRef.current;
    }

    const saveTask = activeSaveRef.current
      .catch(() => null)
      .then(() => persistDocument(pending, silent));
    activeSaveRef.current = saveTask.catch(() => null);
    return saveTask;
  }, [persistDocument]);

  React.useEffect(() => {
    void flushPendingSave(true);

    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    publishSelectedNode({ id: null, title: "" });
    setFocusedNodeId(null);
    setIsReady(false);
    setSavedAt(null);
    setSnapshot(null);
    setMapId(null);
    setStorageMode("none");

    if (!courseId) {
      setError("");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    loadPersistedDocument(courseId, courseName)
      .then(({ document, mode, error: loadError }) => {
        if (loadSequenceRef.current !== sequence) return;
        setMapId(document.mapId);
        setSnapshot(document.snapshot);
        setStorageMode(mode);
        setError(loadError);
      })
      .catch(async () => {
        if (loadSequenceRef.current !== sequence) return;
        const document = await loadLocalDocument(courseId, courseName);
        setMapId(document.mapId);
        setSnapshot(document.snapshot);
        setStorageMode("local");
        setError("导图读取失败，已打开本地副本。");
      })
      .finally(() => {
        if (loadSequenceRef.current === sequence) {
          setIsLoading(false);
        }
      });
  }, [courseId, courseName, externalChangeRevision, flushPendingSave, publishSelectedNode]);

  React.useEffect(() => {
    return () => {
      void flushPendingSave(true);
    };
  }, [flushPendingSave]);

  React.useEffect(() => registerBeforeCloseSave(() => flushPendingSave(true)), [flushPendingSave]);

  const queueSnapshotSave = React.useCallback(
    (nextSnapshot: MindMapSnapshot) => {
      if (!courseId) return;

      const nextMapId = mapId ?? createMindMapId();
      if (!mapId) {
        setMapId(nextMapId);
      }

      snapshotRef.current = nextSnapshot;
      React.startTransition(() => {
        setSnapshot(nextSnapshot);
      });
      pendingSaveRef.current = {
        courseId,
        mapId: nextMapId,
        title: courseName,
        snapshot: nextSnapshot
      };

      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => flushPendingSave(false), SAVE_DEBOUNCE_MS);
    },
    [courseId, courseName, flushPendingSave, mapId]
  );

  const queueCanvasSnapshotSave = React.useCallback(
    (nextCanvasSnapshot: MindMapSnapshot) => {
      const nextSnapshot = mergeFocusedSnapshot(snapshotRef.current, focusedNodeId, nextCanvasSnapshot);
      queueSnapshotSave(nextSnapshot);
    },
    [focusedNodeId, queueSnapshotSave]
  );

  const saveNow = React.useCallback((): Promise<MindMapDocument | null> => {
    if (!courseId) return Promise.resolve(null);
    const currentCanvasSnapshot = canvasRef.current?.getSnapshot();
    const currentMasterSnapshot = currentCanvasSnapshot
      ? mergeFocusedSnapshot(snapshotRef.current, focusedNodeId, currentCanvasSnapshot)
      : snapshotRef.current;
    if (!currentMasterSnapshot) return Promise.resolve(null);

    const nextMapId = mapId ?? createMindMapId();
    if (!mapId) {
      setMapId(nextMapId);
    }

    pendingSaveRef.current = {
      courseId,
      mapId: nextMapId,
      title: courseName,
      snapshot: currentMasterSnapshot
    };
    return flushPendingSave(false);
  }, [courseId, courseName, flushPendingSave, focusedNodeId, mapId]);

  const exportMap = React.useCallback(async () => {
    if (!courseId || !isReady || isLoading) return;
    setIsExporting(true);
    setError("");

    try {
      await canvasRef.current?.exportFile(exportType, sanitizeFileName(courseName));
    } catch (error) {
      setError(getErrorMessage(error, "导出失败"));
    } finally {
      setIsExporting(false);
    }
  }, [courseId, courseName, exportType, isLoading, isReady]);

  const changeLayout = React.useCallback(
    (nextLayout: MindMapLayoutType) => {
      if (!courseId || !canUseEditor) return;
      const layout = normalizeLayout(nextLayout);
      const nextSnapshot = canvasRef.current?.setLayout(layout);

      if (nextSnapshot) {
        queueCanvasSnapshotSave(nextSnapshot);
        return;
      }

      const currentSnapshot = snapshotRef.current;
      if (currentSnapshot) {
        const fallbackSnapshot: MindMapSnapshot = {
          ...currentSnapshot,
          layout,
          view: undefined,
          updatedAt: new Date().toISOString()
        };
        queueSnapshotSave(fallbackSnapshot);
      }
    },
    [canUseEditor, courseId, queueCanvasSnapshotSave, queueSnapshotSave]
  );

  const outline = React.useMemo(() => buildMindMapOutline(snapshot?.root), [snapshot]);
  const outlineNodeCount = React.useMemo(() => countOutlineItems(outline), [outline]);
  const focusedSnapshot = React.useMemo(
    () => (snapshot ? createFocusedSnapshot(snapshot, focusedNodeId) : null),
    [focusedNodeId, snapshot]
  );

  React.useEffect(() => {
    onOutlineChanged?.(outline);
  }, [onOutlineChanged, outline]);

  React.useEffect(() => {
    if (editorMode === "mindmap" && isCatalogPaneCollapsed) {
      setIsFormatPanelOpen(true);
    }
  }, [editorMode, isCatalogPaneCollapsed]);

  React.useEffect(() => {
    if (!snapshot || !focusedNodeId) return;
    if (!findNodeInTree(snapshot.root, focusedNodeId)) {
      setFocusedNodeId(null);
    }
  }, [focusedNodeId, snapshot]);

  const handleNodeSelected = React.useCallback(
    (node: MindMapSelectedNode) => {
      publishSelectedNode(node);
    },
    [publishSelectedNode]
  );

  React.useEffect(() => {
    if (!modeChangeRequest || modeChangeRequest.mode === editorMode) return;
    let isCancelled = false;

    async function changeMode() {
      if (modeChangeRequest?.mode === "word") {
        await saveNow();
      }
      if (!isCancelled && modeChangeRequest) {
        onEditorModeChange(modeChangeRequest.mode);
      }
    }

    void changeMode();
    return () => {
      isCancelled = true;
    };
  }, [editorMode, modeChangeRequest, onEditorModeChange, saveNow]);

  React.useEffect(() => {
    const nodeId = nodeSelectionRequest?.nodeId;
    if (!nodeId) return;

    const item = findOutlineItem(outline, nodeId);
    const rootNodeId = outline[0]?.nodeId ?? null;
    const requestedNode: MindMapSelectedNode = {
      id: nodeId,
      title: item?.title ?? ""
    };

    publishSelectedNode(requestedNode);
    setFocusedNodeId(nodeId === rootNodeId ? null : nodeId);
  }, [nodeSelectionRequest, outline, publishSelectedNode]);

  const applyTextFormat = React.useCallback(
    (patch: MindMapTextFormatPatch) => {
      if (!canUseEditor || !selectedNode.id) return;
      const nextSelectedNode = canvasRef.current?.applyTextFormat(patch);
      if (!nextSelectedNode) return;
      publishSelectedNode(nextSelectedNode);
    },
    [canUseEditor, publishSelectedNode, selectedNode.id]
  );

  const executeBranchShortcut = React.useCallback((command: MindMapBranchShortcutCommand) => {
    canvasRef.current?.exec(command);
  }, []);

  React.useEffect(() => {
    const updateShortcuts = () => {
      setShortcutSettings(readMindMapShortcutSettings());
    };
    window.addEventListener(MIND_MAP_SHORTCUTS_CHANGED_EVENT, updateShortcuts);
    window.addEventListener("storage", updateShortcuts);
    return () => {
      window.removeEventListener(MIND_MAP_SHORTCUTS_CHANGED_EVENT, updateShortcuts);
      window.removeEventListener("storage", updateShortcuts);
    };
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || editorModeRef.current !== "mindmap" || !canUseEditorRef.current) return;
      if (isInteractiveKeyboardTarget(event.target)) return;

      const settings = shortcutSettingsRef.current;
      const match = MIND_MAP_BRANCH_SHORTCUTS.find((item) => isMindMapShortcutEvent(event, settings[item.command]));
      if (!match) return;

      event.preventDefault();
      event.stopPropagation();
      executeBranchShortcut(match.command);
      setTextFormatMenu(null);
      setTopicPanel(null);
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [executeBranchShortcut]);

  const openTextFormatMenuAt = React.useCallback(
    (clientX: number, clientY: number) => {
      if (!canUseEditorRef.current || !selectedNodeRef.current.id) return;
      const rect = workspaceRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(8, Math.min(clientX - rect.left, Math.max(8, rect.width - 372)));
      const y = Math.max(48, Math.min(clientY - rect.top, Math.max(48, rect.height - 126)));
      setTopicPanel(null);
      setTextFormatMenu({ x, y });
    },
    []
  );

  React.useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const workspace = workspaceRef.current;
      if (!workspace || !(event.target instanceof Node) || !workspace.contains(event.target)) return;
      if (!(event.target instanceof Element) || !event.target.closest(".mindmap-canvas-frame")) return;
      if (!canUseEditorRef.current || !selectedNodeRef.current.id) return;
      event.preventDefault();
      event.stopPropagation();
      openTextFormatMenuAt(event.clientX, event.clientY);
    };

    document.addEventListener("contextmenu", handleContextMenu, true);
    return () => document.removeEventListener("contextmenu", handleContextMenu, true);
  }, [openTextFormatMenuAt]);

  const openTextFormatMenu = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!canUseEditor || !selectedNode.id) return;
      event.preventDefault();
      event.stopPropagation();
      openTextFormatMenuAt(event.clientX, event.clientY);
    },
    [canUseEditor, openTextFormatMenuAt, selectedNode.id]
  );

  const runTopicElementCommand = React.useCallback(
    (command: MindMapCommandPayload & { type: "set-note" | "set-tags" | "set-hyperlink" | "set-image" | "set-marker" }) => {
      if (!canUseEditor || !selectedNode.id) return;
      const { type, ...payload } = command;
      canvasRef.current?.exec(type, payload);
      setTopicPanel(null);
      setTextFormatMenu(null);
    },
    [canUseEditor, selectedNode.id]
  );

  const selectDocumentNode = React.useCallback(
    (nodeId: string) => {
      const item = findOutlineItem(outline, nodeId);
      const rootNodeId = outline[0]?.nodeId ?? null;
      publishSelectedNode({ id: nodeId, title: item?.title ?? "" });
      setFocusedNodeId(nodeId === rootNodeId ? null : nodeId);
    },
    [outline, publishSelectedNode]
  );

  if (!courseId || !snapshot || !focusedSnapshot) {
    return (
      <div className="mindmap-placeholder">
        <GitBranch size={30} strokeWidth={1.7} />
        <div>
          <strong>{isLoading ? "正在载入导图" : "请选择课程"}</strong>
        </div>
      </div>
    );
  }

  const nodeCount = focusedNodeId ? countNodes(focusedSnapshot.root) : outlineNodeCount;
  const storageText = storageMode === "mysql" ? "已连接" : storageMode === "local" ? "本地副本" : "未连接";
  const currentLayout = normalizeLayout(focusedSnapshot.layout);
  const canvasKey = `${courseId}:${focusedNodeId ?? "full"}`;
  const topicElements = selectedNode.topicElements ?? EMPTY_TOPIC_ELEMENTS;
  const topicElementDisabled = !canUseEditor || !selectedNode.id;

  return (
    <div ref={workspaceRef} className="mindmap-workspace" data-editor-mode={editorMode}>
      {editorMode === "mindmap" ? (
      <div className="mindmap-local-toolbar" aria-label="导图编辑工具栏">
        <button
          className={topicElements.note ? "active" : ""}
          type="button"
          title="备注"
          onClick={() => setTopicPanel((value) => value === "note" ? null : "note")}
          disabled={topicElementDisabled}
        >
          <StickyNote size={15} />
        </button>
        <button
          className={topicElements.tags.length > 0 ? "active" : ""}
          type="button"
          title="标签"
          onClick={() => setTopicPanel((value) => value === "tags" ? null : "tags")}
          disabled={topicElementDisabled}
        >
          <Tags size={15} />
        </button>
        <button
          className={topicElements.hyperlink ? "active" : ""}
          type="button"
          title="链接"
          onClick={() => setTopicPanel((value) => value === "link" ? null : "link")}
          disabled={topicElementDisabled}
        >
          <Link2 size={15} />
        </button>
        <button
          className={topicElements.imageUrl ? "active" : ""}
          type="button"
          title="图片"
          onClick={() => setTopicPanel((value) => value === "image" ? null : "image")}
          disabled={topicElementDisabled}
        >
          <Image size={15} />
        </button>
        <button
          className={topicElements.priority || topicElements.progress ? "active" : ""}
          type="button"
          title="标记"
          onClick={() => setTopicPanel((value) => value === "marker" ? null : "marker")}
          disabled={topicElementDisabled}
        >
          <CircleCheck size={15} />
        </button>
        <button type="button" title={topicElements.expanded ? "折叠主题" : "展开主题"} onClick={() => canvasRef.current?.exec("toggle-expand")} disabled={topicElementDisabled}>
          <Rows3 size={15} />
        </button>
        <button type="button" title="删除选中主题" onClick={() => canvasRef.current?.exec("delete-node")} disabled={!canUseEditor}>
          <Trash2 size={15} />
        </button>
        <span className="mindmap-toolbar-separator" />
        <button type="button" title="撤销" onClick={() => canvasRef.current?.exec("undo")} disabled={!canUseEditor}>
          <Undo2 size={15} />
        </button>
        <button type="button" title="重做" onClick={() => canvasRef.current?.exec("redo")} disabled={!canUseEditor}>
          <Redo2 size={15} />
        </button>
        <span className="mindmap-toolbar-separator" />
        <button type="button" title="缩小" onClick={() => canvasRef.current?.exec("zoom-out")} disabled={!canUseEditor}>
          <Minus size={15} />
        </button>
        <button type="button" title="适应画布" onClick={() => canvasRef.current?.exec("fit")} disabled={!canUseEditor}>
          <Maximize2 size={15} />
        </button>
        <button type="button" title="放大" onClick={() => canvasRef.current?.exec("zoom-in")} disabled={!canUseEditor}>
          <Plus size={15} />
        </button>
        <button
          className={canvasDragEnabled ? "interaction-mode-button active" : "interaction-mode-button"}
          type="button"
          title={canvasDragEnabled ? "关闭空白画布拖拽" : "开启空白画布拖拽"}
          aria-label={canvasDragEnabled ? "关闭空白画布拖拽" : "开启空白画布拖拽"}
          aria-pressed={canvasDragEnabled}
          onClick={() => setCanvasDragEnabled((value) => !value)}
          disabled={!canUseEditor}
        >
          <Move size={15} />
          <span>画布拖拽</span>
        </button>
        <span className="mindmap-toolbar-spacer" />
        <button
          className={isFormatPanelOpen ? "active" : ""}
          type="button"
          title="排版"
          aria-label="排版"
          aria-pressed={isFormatPanelOpen}
          onClick={() => setIsFormatPanelOpen((value) => !value)}
          disabled={!canUseEditor}
        >
          <SlidersHorizontal size={15} />
          <span>排版</span>
        </button>
        <div className="mindmap-select-control">
          <span>布局</span>
          <select
            value={currentLayout}
            title="画布布局"
            aria-label="画布布局"
            onChange={(event) => changeLayout(event.target.value as MindMapLayoutType)}
            disabled={!canUseEditor}
          >
            {MIND_MAP_LAYOUT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="mindmap-export-control">
          <select
            value={exportType}
            title="导出格式"
            aria-label="导出格式"
            onChange={(event) => setExportType(event.target.value as MindMapExportType)}
            disabled={!canUseEditor || isExporting}
          >
            {EXPORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button type="button" title="导出导图" onClick={exportMap} disabled={!canUseEditor || isExporting}>
            <Download size={15} />
            <span>{isExporting ? "导出中" : "导出"}</span>
          </button>
        </div>
        <button type="button" title="立即保存" onClick={saveNow} disabled={!canUseEditor || isSaving}>
          <Save size={15} />
          <span>{isSaving ? "保存中" : "保存"}</span>
        </button>
      </div>
      ) : null}

      {editorMode === "mindmap" && topicPanel ? (
        <TopicElementPopover
          panel={topicPanel}
          value={topicElements}
          onCancel={() => setTopicPanel(null)}
          onApply={runTopicElementCommand}
        />
      ) : null}

      {editorMode === "mindmap" && textFormatMenu ? (
        <div
          className="mindmap-text-context-menu"
          style={{ left: textFormatMenu.x, top: textFormatMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <MindMapTextFormatToolbar
            value={selectedNode.textFormat}
            disabled={!canUseEditor || !selectedNode.id}
            onChange={applyTextFormat}
          />
        </div>
      ) : null}

      {editorMode === "mindmap" && isFormatPanelOpen ? (
        <MindMapFormatPanel
          selectedNode={selectedNode}
          disabled={!canUseEditor}
          currentLayout={currentLayout}
          canvasDragEnabled={canvasDragEnabled}
          onClose={() => setIsFormatPanelOpen(false)}
          onChangeLayout={changeLayout}
          onChangeTextFormat={applyTextFormat}
          onToggleCanvasDrag={() => setCanvasDragEnabled((value) => !value)}
          onRunCommand={(command) => canvasRef.current?.exec(command)}
        />
      ) : null}

      <div className="mindmap-canvas-retained" aria-hidden={editorMode === "word" ? "true" : undefined}>
        <MindMapCanvas
          key={canvasKey}
          ref={canvasRef}
          snapshot={focusedSnapshot}
          canvasDragEnabled={canvasDragEnabled}
          onSnapshotChanged={queueCanvasSnapshotSave}
          onNodeSelected={handleNodeSelected}
          onReadyChange={setIsReady}
          onError={setError}
          onContextMenu={openTextFormatMenu}
        />
      </div>

      {editorMode === "word" ? (
        <KnowledgeDocumentWorkspace
          courseId={courseId}
          mindMapId={mapId}
          selectedNode={selectedNode}
          outline={outline}
          externalChangeRevision={externalChangeRevision}
          onNodeSelect={selectDocumentNode}
          detailPaneMode={documentDetailPaneMode}
          onOpenFormatPane={onOpenDocumentFormatPane}
          onCloseFormatPane={onCloseDocumentFormatPane}
        />
      ) : (
      <div className="mindmap-status-strip">
        <span>{canUseEditor ? "就绪" : "载入中"}</span>
        <span>{nodeCount} 个主题</span>
        <span>{storageText}</span>
        <span>{canvasDragEnabled ? "画布拖拽" : "框选模式"}</span>
        {selectedNode.id ? <span>已选：{selectedNode.title || "未命名"}</span> : <span>未选中主题</span>}
        {savedAt ? <span>已保存 {savedAt}</span> : null}
        {error ? <span className="mindmap-error">{error}</span> : null}
      </div>
      )}
    </div>
  );
}

function normalizeFormatPanelColor(value: string | undefined, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function MindMapFormatPanel({
  selectedNode,
  disabled,
  currentLayout,
  canvasDragEnabled,
  onClose,
  onChangeLayout,
  onChangeTextFormat,
  onToggleCanvasDrag,
  onRunCommand
}: {
  selectedNode: MindMapSelectedNode;
  disabled: boolean;
  currentLayout: MindMapLayoutType;
  canvasDragEnabled: boolean;
  onClose: () => void;
  onChangeLayout: (layout: MindMapLayoutType) => void;
  onChangeTextFormat: (patch: MindMapTextFormatPatch) => void;
  onToggleCanvasDrag: () => void;
  onRunCommand: (command: MindMapBranchShortcutCommand) => void;
}) {
  const nodeDisabled = disabled || !selectedNode.id;
  const format = selectedNode.textFormat ?? {};
  const fontSize = Number.isFinite(Number(format.fontSize)) ? Number(format.fontSize) : 16;
  const textColor = normalizeFormatPanelColor(format.color, "#17466f");
  const fillColor = normalizeFormatPanelColor(format.fillColor, "#ffffff");
  const borderColor = normalizeFormatPanelColor(format.borderColor, "#72a9d8");
  const borderWidth = Number.isFinite(Number(format.borderWidth)) ? String(Number(format.borderWidth)) : "1";
  const textWidth = format.textAutoWrapWidth ? String(format.textAutoWrapWidth) : "";

  return (
    <aside className="mindmap-format-panel" aria-label="排版">
      <header className="mindmap-format-panel-header">
        <strong>排版</strong>
        <button type="button" title="关闭排版" aria-label="关闭排版" onClick={onClose}>
          <X size={15} />
        </button>
      </header>

      <div className="mindmap-format-tabs" role="tablist" aria-label="排版类型">
        <button type="button" className="active">样式</button>
        <button type="button">画布</button>
      </div>

      <section className="mindmap-format-section">
        <div className="mindmap-format-section-title">
          <span>结构</span>
        </div>
        <label className="mindmap-format-field">
          <span>布局</span>
          <select value={currentLayout} disabled={disabled} onChange={(event) => onChangeLayout(event.target.value as MindMapLayoutType)}>
            {MIND_MAP_LAYOUT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <button className="mindmap-format-wide-button" type="button" disabled={disabled} onClick={() => onRunCommand("reset-layout")}>
          整理布局
        </button>
      </section>

      <section className="mindmap-format-section">
        <div className="mindmap-format-section-title">
          <span>主题</span>
        </div>
        <div className="mindmap-format-color-row">
          <label>
            <span>填充</span>
            <input type="color" value={fillColor} disabled={nodeDisabled} onChange={(event) => onChangeTextFormat({ fillColor: event.target.value })} />
          </label>
          <label>
            <span>边框</span>
            <input type="color" value={borderColor} disabled={nodeDisabled} onChange={(event) => onChangeTextFormat({ borderColor: event.target.value })} />
          </label>
        </div>
        <label className="mindmap-format-field">
          <span>边框宽度</span>
          <select value={borderWidth} disabled={nodeDisabled} onChange={(event) => onChangeTextFormat({ borderWidth: Number(event.target.value) })}>
            <option value="0">无</option>
            <option value="1">细</option>
            <option value="2">中</option>
            <option value="3">粗</option>
          </select>
        </label>
      </section>

      <section className="mindmap-format-section">
        <div className="mindmap-format-section-title">
          <span>文本</span>
        </div>
        <div className="mindmap-format-inline">
          <select
            value={fontSize}
            disabled={nodeDisabled}
            aria-label="字号"
            onChange={(event) => onChangeTextFormat({ fontSize: Number(event.target.value) })}
          >
            {[12, 14, 16, 18, 20, 24, 28].map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
          <button
            type="button"
            className={format.fontWeight === "bold" ? "active" : ""}
            disabled={nodeDisabled}
            onClick={() => onChangeTextFormat({ fontWeight: format.fontWeight === "bold" ? "normal" : "bold" })}
          >
            B
          </button>
          <button
            type="button"
            className={format.fontStyle === "italic" ? "active" : ""}
            disabled={nodeDisabled}
            onClick={() => onChangeTextFormat({ fontStyle: format.fontStyle === "italic" ? "normal" : "italic" })}
          >
            I
          </button>
          <input type="color" aria-label="文字颜色" value={textColor} disabled={nodeDisabled} onChange={(event) => onChangeTextFormat({ color: event.target.value })} />
        </div>
        <div className="mindmap-format-swatches" aria-label="常用文字颜色">
          {FORMAT_PANEL_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              title={color}
              disabled={nodeDisabled}
              className={color.toLowerCase() === textColor.toLowerCase() ? "active" : ""}
              style={{ backgroundColor: color }}
              onClick={() => onChangeTextFormat({ color })}
            />
          ))}
        </div>
        <label className="mindmap-format-field">
          <span>宽度</span>
          <select value={textWidth} disabled={nodeDisabled} onChange={(event) => onChangeTextFormat({ textAutoWrapWidth: event.target.value ? Number(event.target.value) : undefined })}>
            {FORMAT_PANEL_WIDTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="mindmap-format-section">
        <div className="mindmap-format-section-title">
          <span>分支</span>
        </div>
        <div className="mindmap-format-actions">
          <button type="button" disabled={nodeDisabled} onClick={() => onRunCommand("add-boundary")}>边界</button>
          <button type="button" disabled={nodeDisabled} onClick={() => onRunCommand("add-summary")}>概要</button>
        </div>
      </section>

      <section className="mindmap-format-section">
        <div className="mindmap-format-section-title">
          <span>画布</span>
        </div>
        <button className={canvasDragEnabled ? "mindmap-format-wide-button active" : "mindmap-format-wide-button"} type="button" disabled={disabled} onClick={onToggleCanvasDrag}>
          {canvasDragEnabled ? "画布拖拽已开" : "画布拖拽"}
        </button>
      </section>
    </aside>
  );
}

function TopicElementPopover({
  panel,
  value,
  onCancel,
  onApply
}: {
  panel: TopicElementPanel;
  value: TopicElements;
  onCancel: () => void;
  onApply: (command: MindMapCommandPayload & { type: "set-note" | "set-tags" | "set-hyperlink" | "set-image" | "set-marker" }) => void;
}) {
  const [note, setNote] = React.useState(value.note);
  const [tags, setTags] = React.useState(value.tags.join("，"));
  const [hyperlink, setHyperlink] = React.useState(value.hyperlink);
  const [hyperlinkTitle, setHyperlinkTitle] = React.useState(value.hyperlinkTitle);
  const [imageUrl, setImageUrl] = React.useState(value.imageUrl);
  const [imageTitle, setImageTitle] = React.useState(value.imageTitle);
  const [priority, setPriority] = React.useState(value.priority);
  const [progress, setProgress] = React.useState(value.progress);

  React.useEffect(() => {
    setNote(value.note);
    setTags(value.tags.join("，"));
    setHyperlink(value.hyperlink);
    setHyperlinkTitle(value.hyperlinkTitle);
    setImageUrl(value.imageUrl);
    setImageTitle(value.imageTitle);
    setPriority(value.priority);
    setProgress(value.progress);
  }, [value]);

  const submit = () => {
    if (panel === "note") {
      onApply({ type: "set-note", note });
    }
    if (panel === "tags") {
      onApply({ type: "set-tags", tags: splitTags(tags) });
    }
    if (panel === "link") {
      onApply({ type: "set-hyperlink", hyperlink, hyperlinkTitle });
    }
    if (panel === "image") {
      onApply({ type: "set-image", imageUrl, imageTitle });
    }
    if (panel === "marker") {
      onApply({ type: "set-marker", markerType: "priority", markerValue: priority || null });
      onApply({ type: "set-marker", markerType: "progress", markerValue: progress || null });
    }
  };

  return (
    <div className="mindmap-topic-popover" role="dialog" aria-label="主题元素">
      {panel === "note" ? (
        <label className="mindmap-topic-field">
          <span>备注</span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      ) : null}
      {panel === "tags" ? (
        <label className="mindmap-topic-field">
          <span>标签</span>
          <input value={tags} onChange={(event) => setTags(event.target.value)} />
        </label>
      ) : null}
      {panel === "link" ? (
        <>
          <label className="mindmap-topic-field">
            <span>链接</span>
            <input value={hyperlink} onChange={(event) => setHyperlink(event.target.value)} />
          </label>
          <label className="mindmap-topic-field">
            <span>标题</span>
            <input value={hyperlinkTitle} onChange={(event) => setHyperlinkTitle(event.target.value)} />
          </label>
        </>
      ) : null}
      {panel === "image" ? (
        <>
          <label className="mindmap-topic-field">
            <span>图片</span>
            <input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} />
          </label>
          <label className="mindmap-topic-field">
            <span>标题</span>
            <input value={imageTitle} onChange={(event) => setImageTitle(event.target.value)} />
          </label>
        </>
      ) : null}
      {panel === "marker" ? (
        <div className="mindmap-topic-marker-grid">
          <label className="mindmap-topic-field">
            <span>优先级</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value)}>
              {PRIORITY_OPTIONS.map((item) => (
                <option value={item} key={item}>{item ? `P${item}` : "无"}</option>
              ))}
            </select>
          </label>
          <label className="mindmap-topic-field">
            <span>进度</span>
            <select value={progress} onChange={(event) => setProgress(event.target.value)}>
              {PROGRESS_OPTIONS.map((item) => (
                <option value={item} key={item}>{item ? `${item}/8` : "无"}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <div className="mindmap-topic-actions">
        <button type="button" onClick={onCancel}>取消</button>
        <button type="button" onClick={submit}>确定</button>
      </div>
    </div>
  );
}

function splitTags(value: string) {
  const unique = new Set<string>();
  value.split(/[，,;\s]+/).forEach((item) => {
    const text = item.trim().slice(0, 24);
    if (text) unique.add(text);
  });
  return Array.from(unique).slice(0, 8);
}
