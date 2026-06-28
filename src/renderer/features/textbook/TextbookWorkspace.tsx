import React from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  FileUp,
  Link2,
  Loader2,
  Save,
  Unlink,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { registerBeforeCloseSave } from "../../lib/saveDrain";
import type { KnowledgeDocumentSnapshot } from "../documents/knowledgeDocumentTypes";
import type { MindMapOutlineItem, MindMapSelectedNode } from "../mindmap/mindMapTypes";
import {
  chooseTextbookPdf,
  loadTextbookStore,
  normalizeTextbookStore,
  openTextbookPdfWindow,
  saveTextbookStore
} from "./textbookService";
import { TextbookNoteEditor, type TextbookNoteEditorHandle } from "./TextbookNoteEditor";
import type { TextbookAsset, TextbookNote, TextbookStore } from "./textbookTypes";
import {
  createTextbookNoteSnapshotFromText,
  extractTextFromSnapshot,
  mergeNoteSnapshotIntoDocument,
  normalizeTextbookNoteSnapshot
} from "./textbookNoteDocument";

const PdfDocumentViewer = React.lazy(() => import("./PdfDocumentViewer").then((module) => ({ default: module.PdfDocumentViewer })));

type TextbookWorkspaceProps = {
  courseId: string | null;
  mindMapId: string | null;
  selectedNode: MindMapSelectedNode;
  nodeSelectionRequest?: { nodeId: string | null; nonce: number } | null;
  outline: MindMapOutlineItem[];
  onNodeSelect?: (nodeId: string) => void;
};

type SaveState = "idle" | "loading" | "saving" | "saved" | "error";
type DeletedTextbookNoteKey = { textbookId: string; nodeId: string };

const SAVE_DEBOUNCE_MS = 700;
const DEFAULT_ZOOM = 100;
const ZOOM_STEP = 10;

function createId(prefix: string) {
  const randomId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replaceAll("-", "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${randomId}`;
}

function nowIso() {
  return new Date().toISOString();
}

function formatFileSize(size: number) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function clampPage(value: number, asset: TextbookAsset | null) {
  const maxPage = asset?.pageCount && asset.pageCount > 0 ? asset.pageCount : 100000;
  return Math.max(1, Math.min(maxPage, Math.round(Number.isFinite(value) ? value : 1)));
}

function getNoteKey(textbookId: string, nodeId: string) {
  return `${textbookId}\u0000${nodeId}`;
}

function getBindingContextKey(scopeKey: string, textbookId: string | null, nodeId: string | null) {
  return `${scopeKey}\u0000${textbookId ?? ""}\u0000${nodeId ?? ""}`;
}

function normalizePageRange(start: number, end: number, asset: TextbookAsset | null) {
  const pageStart = clampPage(start, asset);
  const pageEnd = clampPage(end, asset);
  return {
    pageStart: Math.min(pageStart, pageEnd),
    pageEnd: Math.max(pageStart, pageEnd)
  };
}

function findNote(store: TextbookStore, textbookId: string | null, nodeId: string | null) {
  if (!textbookId || !nodeId) return null;
  return store.notes.find((note) => note.textbookId === textbookId && note.nodeId === nodeId) ?? null;
}

function getUpdatedAtTime(value: string | undefined) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function shouldUseIncomingRecord<T extends { updatedAt: string }>(existing: T | undefined, incoming: T) {
  return !existing || getUpdatedAtTime(incoming.updatedAt) >= getUpdatedAtTime(existing.updatedAt);
}

function mergeTextbookStores(base: TextbookStore, incoming: TextbookStore, scope: { courseId: string; mindMapId: string }) {
  const assets = new Map<string, TextbookAsset>();
  for (const asset of base.assets) assets.set(asset.id, asset);
  for (const asset of incoming.assets) {
    const existing = assets.get(asset.id);
    if (shouldUseIncomingRecord(existing, asset)) assets.set(asset.id, asset);
  }

  const notes = new Map<string, TextbookNote>();
  for (const note of base.notes) notes.set(getNoteKey(note.textbookId, note.nodeId), note);
  for (const note of incoming.notes) {
    const key = getNoteKey(note.textbookId, note.nodeId);
    const existing = notes.get(key);
    if (shouldUseIncomingRecord(existing, note)) notes.set(key, note);
  }

  return normalizeTextbookStore({
    version: 1,
    assets: Array.from(assets.values()),
    notes: Array.from(notes.values())
  }, scope);
}

function removeDeletedNotes(store: TextbookStore, deletedNoteKeys: DeletedTextbookNoteKey[], scope: { courseId: string; mindMapId: string }) {
  if (!deletedNoteKeys.length) return store;
  const keys = new Set(deletedNoteKeys.map((item) => getNoteKey(item.textbookId, item.nodeId)));
  return normalizeTextbookStore({
    ...store,
    notes: store.notes.filter((note) => !keys.has(getNoteKey(note.textbookId, note.nodeId)))
  }, scope);
}

function flattenOutlineItems(items: MindMapOutlineItem[]) {
  const nodes: Array<{ nodeId: string; title: string; level: number }> = [];
  const visit = (nextItems: MindMapOutlineItem[]) => {
    for (const item of nextItems) {
      if (item.nodeId) nodes.push({ nodeId: item.nodeId, title: item.title, level: item.level });
      visit(item.children);
    }
  };
  visit(items);
  return nodes;
}

function updateAssetLastPage(store: TextbookStore, assetId: string, pageNumber: number) {
  const updatedAt = nowIso();
  let changed = false;
  const assets = store.assets.map((asset) => {
    if (asset.id !== assetId) return asset;
    const nextPage = clampPage(pageNumber, asset);
    if (asset.lastPage === nextPage) return asset;
    changed = true;
    return { ...asset, lastPage: nextPage, updatedAt };
  });
  if (!changed) return store;
  return {
    ...store,
    assets
  };
}

function createEmptyNoteSnapshot() {
  return createTextbookNoteSnapshotFromText("");
}

function createNoteSnapshotSignature(snapshot: KnowledgeDocumentSnapshot, pageStart: number, pageEnd: number) {
  const main = Array.isArray(snapshot.content?.main) ? snapshot.content.main : [];
  try {
    return JSON.stringify({ pageStart, pageEnd, main });
  } catch {
    return JSON.stringify({
      pageStart,
      pageEnd,
      text: extractTextFromSnapshot(main)
    });
  }
}

export function TextbookWorkspace({
  courseId,
  mindMapId,
  selectedNode,
  nodeSelectionRequest,
  outline,
  onNodeSelect
}: TextbookWorkspaceProps) {
  const [store, setStore] = React.useState<TextbookStore>(() => normalizeTextbookStore(null, { courseId: "", mindMapId: "" }));
  const [activeAssetId, setActiveAssetId] = React.useState<string | null>(null);
  const [bindingNodeId, setBindingNodeId] = React.useState<string | null>(selectedNode.id);
  const [pageNumber, setPageNumber] = React.useState(1);
  const [pageStartDraft, setPageStartDraft] = React.useState(Number.NaN);
  const [pageEndDraft, setPageEndDraft] = React.useState(Number.NaN);
  const [isRangeEdited, setIsRangeEdited] = React.useState(false);
  const [zoom, setZoom] = React.useState(DEFAULT_ZOOM);
  const [noteSnapshot, setNoteSnapshot] = React.useState<KnowledgeDocumentSnapshot>(() => createEmptyNoteSnapshot());
  const [noteEditorKey, setNoteEditorKey] = React.useState("empty");
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [message, setMessage] = React.useState("");
  const [isChoosingPdf, setIsChoosingPdf] = React.useState(false);
  const [isLoadingIntoDocument, setIsLoadingIntoDocument] = React.useState(false);
  const [isBindingReady, setIsBindingReady] = React.useState(true);
  const saveTimerRef = React.useRef<number | null>(null);
  const pendingStoreRef = React.useRef<TextbookStore | null>(null);
  const pendingStoreScopeKeyRef = React.useRef("");
  const storeRef = React.useRef(store);
  const activeScopeKeyRef = React.useRef("");
  const bindingNodeIdRef = React.useRef<string | null>(selectedNode.id);
  const loadedBindingNodeIdRef = React.useRef<string | null>(selectedNode.id);
  const loadedBindingContextKeyRef = React.useRef("");
  const loadedScopeKeyRef = React.useRef("");
  const pageNumberRef = React.useRef(pageNumber);
  const noteEditorRef = React.useRef<TextbookNoteEditorHandle | null>(null);
  const lastSavedNoteSignatureRef = React.useRef("");
  const pendingNoteSignatureRef = React.useRef<string | null>(null);
  const flushPendingSaveRef = React.useRef<() => Promise<void>>(async () => undefined);

  const scope = React.useMemo(() => (
    courseId ? { courseId, mindMapId: mindMapId || courseId } : null
  ), [courseId, mindMapId]);
  const scopeKey = scope ? `${scope.courseId}:${scope.mindMapId}` : "";
  const commitStore = React.useCallback((nextStore: TextbookStore) => {
    storeRef.current = nextStore;
    setStore(nextStore);
  }, []);
  const getLatestStore = React.useCallback(() => (
    pendingStoreScopeKeyRef.current === activeScopeKeyRef.current
      ? pendingStoreRef.current ?? storeRef.current
      : storeRef.current
  ), []);
  const activeAsset = store.assets.find((asset) => asset.id === activeAssetId) ?? store.assets[0] ?? null;
  const activeBindingContextKey = getBindingContextKey(scopeKey, activeAsset?.id ?? null, bindingNodeId);
  const isActiveBindingLoaded = isBindingReady
    && loadedBindingNodeIdRef.current === bindingNodeId
    && loadedBindingContextKeyRef.current === activeBindingContextKey;
  const outlineNodes = React.useMemo(() => flattenOutlineItems(outline), [outline]);
  const bindingOutlineNode = bindingNodeId ? outlineNodes.find((node) => node.nodeId === bindingNodeId) ?? null : null;
  const bindingNodeTitle = selectedNode.id === bindingNodeId
    ? selectedNode.title
    : bindingOutlineNode?.title ?? "";
  const activeNote = findNote(store, activeAsset?.id ?? null, bindingNodeId);
  const currentNavigationIndex = React.useMemo(
    () => outlineNodes.findIndex((node) => node.nodeId === bindingNodeId),
    [outlineNodes, bindingNodeId]
  );
  const canNavigatePrevious = currentNavigationIndex > 0;
  const canNavigateNext = currentNavigationIndex >= 0 && currentNavigationIndex < outlineNodes.length - 1;
  const outlineNodeCount = React.useMemo(() => {
    const countItems = (items: MindMapOutlineItem[]): number => items.reduce((sum, item) => sum + (item.nodeId ? 1 : 0) + countItems(item.children), 0);
    return countItems(outline);
  }, [outline]);

  React.useEffect(() => {
    pageNumberRef.current = pageNumber;
  }, [pageNumber]);

  const hydrateBindingNodeState = React.useCallback((nodeId: string | null) => {
    const isCurrentBindingRequest = () => (
      activeScopeKeyRef.current === scopeKey && bindingNodeIdRef.current === nodeId
    );
    if (!isCurrentBindingRequest()) return;

    const sourceStore = getLatestStore();
    const targetAsset = activeAssetId
      ? sourceStore.assets.find((asset) => asset.id === activeAssetId) ?? null
      : sourceStore.assets[0] ?? null;
    const contextKey = getBindingContextKey(scopeKey, targetAsset?.id ?? null, nodeId);

    if (!targetAsset) {
      if (!isCurrentBindingRequest()) return;
      setNoteSnapshot(createEmptyNoteSnapshot());
      setNoteEditorKey(`empty:${scopeKey}:${nodeId ?? "none"}`);
      setPageStartDraft(Number.NaN);
      setPageEndDraft(Number.NaN);
      setIsRangeEdited(false);
      loadedBindingNodeIdRef.current = nodeId;
      loadedBindingContextKeyRef.current = contextKey;
      setIsBindingReady(true);
      lastSavedNoteSignatureRef.current = "";
      pendingNoteSignatureRef.current = null;
      return;
    }

    const nextNote = findNote(sourceStore, targetAsset.id, nodeId);
    const nextSnapshot = normalizeTextbookNoteSnapshot(nextNote?.snapshot, nextNote?.content ?? "");
    let nextPageStart = clampPage(pageNumberRef.current, targetAsset);
    let nextPageEnd = nextPageStart;
    if (nextNote) {
      const range = normalizePageRange(nextNote.pageStart || nextNote.pageNumber, nextNote.pageEnd || nextNote.pageNumber, targetAsset);
      nextPageStart = range.pageStart;
      nextPageEnd = range.pageEnd;
      setPageStartDraft(range.pageStart);
      setPageEndDraft(range.pageEnd);
      setPageNumber(range.pageStart);
    } else {
      setPageStartDraft(Number.NaN);
      setPageEndDraft(Number.NaN);
    }
    if (!isCurrentBindingRequest()) return;
    setIsRangeEdited(false);
    lastSavedNoteSignatureRef.current = nextNote ? createNoteSnapshotSignature(nextSnapshot, nextPageStart, nextPageEnd) : "";
    pendingNoteSignatureRef.current = null;
    loadedBindingNodeIdRef.current = nodeId;
    loadedBindingContextKeyRef.current = contextKey;
    setIsBindingReady(true);
    setNoteSnapshot(nextSnapshot);
    setNoteEditorKey(`${targetAsset.id}:${nodeId ?? "none"}:${nextNote?.updatedAt ?? "new"}`);
  }, [activeAssetId, getLatestStore, scopeKey]);

  const requestBindingNode = React.useCallback((nodeId: string | null, syncOutline = true) => {
    if (bindingNodeIdRef.current === nodeId) {
      const latestStore = getLatestStore();
      const targetAsset = activeAssetId
        ? latestStore.assets.find((asset) => asset.id === activeAssetId) ?? null
        : latestStore.assets[0] ?? null;
      const expectedContextKey = getBindingContextKey(scopeKey, targetAsset?.id ?? null, nodeId);
      if (loadedBindingNodeIdRef.current !== nodeId || loadedBindingContextKeyRef.current !== expectedContextKey) {
        hydrateBindingNodeState(nodeId);
      }
      if (syncOutline && nodeId) onNodeSelect?.(nodeId);
      return;
    }
    bindingNodeIdRef.current = nodeId;
    loadedBindingNodeIdRef.current = null;
    loadedBindingContextKeyRef.current = "";
    setIsBindingReady(false);
    setPageStartDraft(Number.NaN);
    setPageEndDraft(Number.NaN);
    setIsRangeEdited(false);
    setNoteSnapshot(createEmptyNoteSnapshot());
    setNoteEditorKey(`loading:${scopeKey}:${nodeId ?? "none"}`);
    lastSavedNoteSignatureRef.current = "";
    pendingNoteSignatureRef.current = null;
    setBindingNodeId(nodeId);
    hydrateBindingNodeState(nodeId);
    if (syncOutline && nodeId) onNodeSelect?.(nodeId);
  }, [activeAssetId, getLatestStore, hydrateBindingNodeState, onNodeSelect, scopeKey]);

  const selectBindingNode = React.useCallback((nodeId: string | null) => {
    requestBindingNode(nodeId, true);
  }, [requestBindingNode]);

  React.useEffect(() => {
    if (selectedNode.id) requestBindingNode(selectedNode.id, false);
  }, [requestBindingNode, selectedNode.id]);

  React.useEffect(() => {
    if (nodeSelectionRequest?.nodeId) requestBindingNode(nodeSelectionRequest.nodeId, false);
  }, [nodeSelectionRequest?.nodeId, nodeSelectionRequest?.nonce, requestBindingNode]);

  React.useEffect(() => {
    activeScopeKeyRef.current = scopeKey;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingStoreRef.current = null;
    pendingStoreScopeKeyRef.current = "";
    if (!scope) {
      commitStore(normalizeTextbookStore(null, { courseId: "", mindMapId: "" }));
      setActiveAssetId(null);
      setPageNumber(1);
      setPageStartDraft(Number.NaN);
      setPageEndDraft(Number.NaN);
      setIsRangeEdited(false);
      setNoteSnapshot(createEmptyNoteSnapshot());
      setNoteEditorKey("empty");
      setSaveState("idle");
      setMessage("");
      bindingNodeIdRef.current = null;
      loadedBindingNodeIdRef.current = null;
      loadedBindingContextKeyRef.current = "";
      setIsBindingReady(true);
      lastSavedNoteSignatureRef.current = "";
      pendingNoteSignatureRef.current = null;
      return;
    }

    let cancelled = false;
    setSaveState("loading");
    setMessage("");
    commitStore(normalizeTextbookStore(null, scope));
    setActiveAssetId(null);
    setPageNumber(1);
    setPageStartDraft(Number.NaN);
    setPageEndDraft(Number.NaN);
    setIsRangeEdited(false);
    setNoteSnapshot(createEmptyNoteSnapshot());
    setNoteEditorKey(`empty:${scopeKey}`);
    loadedBindingNodeIdRef.current = null;
    loadedBindingContextKeyRef.current = "";
    setIsBindingReady(false);
    lastSavedNoteSignatureRef.current = "";
    pendingNoteSignatureRef.current = null;
    loadedScopeKeyRef.current = scopeKey;
    loadTextbookStore(scope)
      .then((nextStore) => {
        if (cancelled || loadedScopeKeyRef.current !== scopeKey) return;
        commitStore(nextStore);
        const firstAsset = nextStore.assets[0] ?? null;
        const firstPage = firstAsset ? clampPage(firstAsset.lastPage, firstAsset) : 1;
      setActiveAssetId(firstAsset?.id ?? null);
      setPageNumber(firstPage);
      setPageStartDraft(Number.NaN);
      setPageEndDraft(Number.NaN);
        setIsRangeEdited(false);
        setSaveState("idle");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        commitStore(normalizeTextbookStore(null, scope));
        setActiveAssetId(null);
        setPageNumber(1);
        setSaveState("error");
        setMessage(error instanceof Error ? error.message : "教材没有打开。");
      });

    return () => {
      cancelled = true;
    };
  }, [scopeKey]);

  const persistStore = React.useCallback(async (nextStore: TextbookStore, deletedNoteKeys: DeletedTextbookNoteKey[] = []) => {
    if (!scope) return nextStore;
    const requestScopeKey = scopeKey;
    if (activeScopeKeyRef.current !== requestScopeKey) return nextStore;
    const storeToSave = removeDeletedNotes(mergeTextbookStores(getLatestStore(), nextStore, scope), deletedNoteKeys, scope);
    commitStore(storeToSave);
    setSaveState("saving");
    try {
      const savedStore = await saveTextbookStore(scope, storeToSave, { deletedNoteKeys });
      if (activeScopeKeyRef.current !== requestScopeKey) return savedStore;
      if (pendingStoreRef.current === nextStore || pendingStoreRef.current === storeToSave) {
        pendingStoreRef.current = null;
        pendingStoreScopeKeyRef.current = "";
      }
      if (pendingNoteSignatureRef.current) {
        lastSavedNoteSignatureRef.current = pendingNoteSignatureRef.current;
        pendingNoteSignatureRef.current = null;
      }
      commitStore(removeDeletedNotes(mergeTextbookStores(getLatestStore(), savedStore, scope), deletedNoteKeys, scope));
      setSaveState("saved");
      setMessage("");
      return savedStore;
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "教材保存没有完成。");
      throw error;
    }
  }, [commitStore, getLatestStore, scopeKey]);

  const schedulePersist = React.useCallback((nextStore: TextbookStore, immediate = false, deletedNoteKeys: DeletedTextbookNoteKey[] = []) => {
    const requestScopeKey = scopeKey;
    const mergedStore = scope ? removeDeletedNotes(mergeTextbookStores(getLatestStore(), nextStore, scope), deletedNoteKeys, scope) : nextStore;
    commitStore(mergedStore);
    pendingStoreRef.current = mergedStore;
    pendingStoreScopeKeyRef.current = requestScopeKey;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (immediate) {
      return persistStore(mergedStore, deletedNoteKeys);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const pending = pendingStoreRef.current;
      if (pending && pendingStoreScopeKeyRef.current === activeScopeKeyRef.current) void persistStore(pending);
    }, SAVE_DEBOUNCE_MS);
    return Promise.resolve(mergedStore);
  }, [commitStore, getLatestStore, persistStore, scopeKey]);

  const persistNoteSnapshot = React.useCallback(async (snapshot: KnowledgeDocumentSnapshot, immediate = false, targetPage = pageNumber) => {
    if (!scope || !activeAsset || !bindingNodeId) return;
    if (loadedBindingNodeIdRef.current !== bindingNodeId) return;
    const bindingContextKey = getBindingContextKey(scopeKey, activeAsset.id, bindingNodeId);
    if (loadedBindingContextKeyRef.current !== bindingContextKey) return;
    const content = extractTextFromSnapshot(snapshot.content.main);
    if (!activeNote && !content.trim() && !immediate) return;

    const timestamp = nowIso();
    const baseStore = getLatestStore();
    const existing = findNote(baseStore, activeAsset.id, bindingNodeId);
    const anchorPage = clampPage(targetPage, activeAsset);
    const fallbackStart = Number.isFinite(pageStartDraft) ? pageStartDraft : anchorPage;
    const fallbackEnd = Number.isFinite(pageEndDraft) ? pageEndDraft : fallbackStart;
    const range = !existing && !isRangeEdited
      ? normalizePageRange(anchorPage, anchorPage, activeAsset)
      : normalizePageRange(fallbackStart, fallbackEnd, activeAsset);
    const nextSignature = createNoteSnapshotSignature(snapshot, range.pageStart, range.pageEnd);
    if (!immediate && (nextSignature === lastSavedNoteSignatureRef.current || nextSignature === pendingNoteSignatureRef.current)) return;
    if (immediate && nextSignature === lastSavedNoteSignatureRef.current && !pendingStoreRef.current) {
      setSaveState("saved");
      setMessage("");
      return;
    }
    const nextNote: TextbookNote = {
      id: existing?.id ?? createId("note"),
      textbookId: activeAsset.id,
      courseId: scope.courseId,
      mindMapId: scope.mindMapId,
      nodeId: bindingNodeId,
      nodeTitle: bindingNodeTitle,
      pageNumber: Math.max(range.pageStart, Math.min(anchorPage, range.pageEnd)),
      pageStart: range.pageStart,
      pageEnd: range.pageEnd,
      content,
      snapshot,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    const noteKey = getNoteKey(nextNote.textbookId, nextNote.nodeId);
    const nextStore = normalizeTextbookStore({
      ...updateAssetLastPage(baseStore, activeAsset.id, nextNote.pageNumber),
      notes: [
        nextNote,
        ...baseStore.notes.filter((note) => getNoteKey(note.textbookId, note.nodeId) !== noteKey)
      ]
    }, scope);
    setPageNumber(nextNote.pageNumber);
    setPageStartDraft(nextNote.pageStart);
    setPageEndDraft(nextNote.pageEnd);
    setIsRangeEdited(false);
    pendingNoteSignatureRef.current = nextSignature;
    await schedulePersist(nextStore, immediate);
  }, [activeAsset?.id, activeNote?.id, bindingNodeId, bindingNodeTitle, getLatestStore, isRangeEdited, pageEndDraft, pageNumber, pageStartDraft, schedulePersist, scopeKey]);

  const saveNoteNow = React.useCallback(async () => {
    if (!isActiveBindingLoaded || !activeNote) return noteSnapshot;
    const latestSnapshot = await noteEditorRef.current?.getSnapshot() ?? noteSnapshot;
    setNoteSnapshot(latestSnapshot);
    await persistNoteSnapshot(latestSnapshot, true);
    return latestSnapshot;
  }, [activeNote?.id, isActiveBindingLoaded, noteSnapshot, persistNoteSnapshot]);

  const bindPageRangeNow = React.useCallback(async () => {
    if (!isActiveBindingLoaded) return noteSnapshot;
    const latestSnapshot = await noteEditorRef.current?.getSnapshot() ?? noteSnapshot;
    setNoteSnapshot(latestSnapshot);
    await persistNoteSnapshot(latestSnapshot, true);
    return latestSnapshot;
  }, [isActiveBindingLoaded, noteSnapshot, persistNoteSnapshot]);

  const cancelBindingNow = React.useCallback(async () => {
    if (!scope || !activeAsset || !bindingNodeId || !isActiveBindingLoaded || !activeNote) return;
    const latestSnapshot = await noteEditorRef.current?.getSnapshot() ?? noteSnapshot;
    const range = normalizePageRange(activeNote.pageStart || activeNote.pageNumber, activeNote.pageEnd || activeNote.pageNumber, activeAsset);
    const baseStore = getLatestStore();
    const noteKey = getNoteKey(activeAsset.id, bindingNodeId);
    const nextStore = normalizeTextbookStore({
      ...baseStore,
      notes: baseStore.notes.filter((note) => getNoteKey(note.textbookId, note.nodeId) !== noteKey)
    }, scope);
    setNoteSnapshot(latestSnapshot);
    setPageStartDraft(range.pageStart);
    setPageEndDraft(range.pageEnd);
    setIsRangeEdited(true);
    lastSavedNoteSignatureRef.current = "";
    pendingNoteSignatureRef.current = null;
    await schedulePersist(nextStore, true, [{ textbookId: activeAsset.id, nodeId: bindingNodeId }]);
    setSaveState("saved");
    setMessage("已取消绑定。");
  }, [activeAsset?.id, activeNote?.id, bindingNodeId, getLatestStore, isActiveBindingLoaded, noteSnapshot, schedulePersist, scopeKey]);

  const flushPendingSave = React.useCallback(async () => {
    if (activeAsset && bindingNodeId) {
      await saveNoteNow();
    }
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (pendingStoreRef.current) {
      await persistStore(pendingStoreRef.current);
    }
  }, [activeAsset?.id, bindingNodeId, persistStore, saveNoteNow]);

  React.useEffect(() => {
    flushPendingSaveRef.current = flushPendingSave;
  }, [flushPendingSave]);

  React.useEffect(() => registerBeforeCloseSave(() => flushPendingSaveRef.current()), []);

  React.useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      void flushPendingSaveRef.current();
    };
  }, []);

  React.useEffect(() => {
    hydrateBindingNodeState(bindingNodeId);
  }, [activeAsset?.id, bindingNodeId, hydrateBindingNodeState]);

  React.useEffect(() => {
    if (!activeAsset || !bindingNodeId || !activeNote || !isActiveBindingLoaded) return;
    persistNoteSnapshot(noteSnapshot, false);
  }, [activeAsset?.id, activeNote?.id, bindingNodeId, isActiveBindingLoaded, noteSnapshot, persistNoteSnapshot]);

  function applyPage(nextPage: number) {
    if (!activeAsset) return;
    const page = clampPage(nextPage, activeAsset);
    setPageNumber(page);
    const baseStore = getLatestStore();
    const nextStore = updateAssetLastPage(baseStore, activeAsset.id, page);
    if (nextStore !== baseStore) schedulePersist(nextStore);
  }

  const handleViewerPageChange = React.useCallback((nextPage: number) => {
    if (!activeAsset) return;
    const page = clampPage(nextPage, activeAsset);
    setPageNumber((current) => (current === page ? current : page));
    const baseStore = getLatestStore();
    const nextStore = updateAssetLastPage(baseStore, activeAsset.id, page);
    if (nextStore !== baseStore) schedulePersist(nextStore);
  }, [activeAsset?.id, getLatestStore, schedulePersist]);

  const handleViewerPageCountChange = React.useCallback((pageCount: number) => {
    if (!scope || !activeAsset || pageCount <= 0 || activeAsset.pageCount === pageCount) return;
    const updatedAt = nowIso();
    const baseStore = getLatestStore();
    const nextStore = normalizeTextbookStore({
      ...baseStore,
      assets: baseStore.assets.map((asset) => (
        asset.id === activeAsset.id
          ? { ...asset, pageCount, lastPage: clampPage(asset.lastPage, { ...asset, pageCount }), updatedAt }
          : asset
      ))
    }, scope);
    schedulePersist(nextStore);
  }, [activeAsset?.id, activeAsset?.pageCount, getLatestStore, scopeKey, schedulePersist]);

  async function choosePdf() {
    if (!scope || isChoosingPdf) return;
    setIsChoosingPdf(true);
    setMessage("");
    try {
      const asset = await chooseTextbookPdf(scope);
      if (!asset) return;
      const baseStore = getLatestStore();
      const nextStore = normalizeTextbookStore({
        ...baseStore,
        assets: [asset, ...baseStore.assets.filter((item) => item.id !== asset.id)]
      }, scope);
      setActiveAssetId(asset.id);
      loadedBindingNodeIdRef.current = null;
      loadedBindingContextKeyRef.current = "";
      setIsBindingReady(false);
      setPageNumber(1);
      setPageStartDraft(Number.NaN);
      setPageEndDraft(Number.NaN);
      setIsRangeEdited(false);
      schedulePersist(nextStore, true);
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "教材文件没有打开。");
    } finally {
      setIsChoosingPdf(false);
    }
  }

  async function navigateCatalog(direction: "previous" | "next") {
    const step = direction === "next" ? 1 : -1;
    if (currentNavigationIndex < 0) return;
    const nextItem = outlineNodes[currentNavigationIndex + step];
    if (!nextItem?.nodeId) return;
    await saveNoteNow();
    selectBindingNode(nextItem.nodeId);
  }

  async function loadNoteIntoDocument() {
    if (!scope || !activeAsset || !bindingNodeId || isLoadingIntoDocument) return;
    const api = window.aistudyKnowledgeDocuments;
    if (!api) {
      setSaveState("error");
      setMessage("文档服务不可用。");
      return;
    }

    setIsLoadingIntoDocument(true);
    setMessage("");
    try {
      const latestSnapshot = await saveNoteNow();
      const current = await api.load({
        courseId: scope.courseId,
        mindMapId: scope.mindMapId,
        nodeId: bindingNodeId
      });
      const heading = `${activeAsset.title} P${pageStartDraft}-${pageEndDraft}`;
      const snapshot = mergeNoteSnapshotIntoDocument(current?.snapshot, latestSnapshot, heading);
      await api.save({
        courseId: scope.courseId,
        mindMapId: scope.mindMapId,
        nodeId: bindingNodeId,
        title: bindingNodeTitle || "教材笔记",
        snapshot
      });
      setSaveState("saved");
      setMessage("已载入文档。");
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "笔记没有载入文档。");
    } finally {
      setIsLoadingIntoDocument(false);
    }
  }

  async function openDetachedPdf() {
    if (!activeAsset) return;
    try {
      await openTextbookPdfWindow(activeAsset, pageNumber, zoom);
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "PDF 窗口没有打开。");
    }
  }

  const canUseTextbook = Boolean(scope);
  const noteCount = activeAsset ? store.notes.filter((note) => note.textbookId === activeAsset.id && note.content.trim()).length : 0;
  const pageStartValue = Number.isFinite(pageStartDraft) ? clampPage(pageStartDraft, activeAsset) : "";
  const pageEndValue = Number.isFinite(pageEndDraft) ? clampPage(pageEndDraft, activeAsset) : "";
  const hasActiveBinding = Boolean(activeNote && isActiveBindingLoaded);
  const canEditPageRange = Boolean(activeAsset && bindingNodeId && isActiveBindingLoaded && !hasActiveBinding);
  const canBindPageRange = canEditPageRange;
  const canCancelBinding = Boolean(activeAsset && bindingNodeId && hasActiveBinding);
  const canUseBoundNote = Boolean(activeAsset && bindingNodeId && hasActiveBinding);
  const noteEditorDisabled = !activeAsset || !bindingNodeId || !isActiveBindingLoaded;
  const bindingStatusText = !activeAsset || !bindingNodeId
    ? "未选中"
    : !isActiveBindingLoaded
      ? "检查中"
      : hasActiveBinding
        ? "已绑定"
        : "未绑定";

  return (
    <div className="textbook-workspace">
      <div className="textbook-toolbar" aria-label="教材工具栏">
        <div className="textbook-source">
          <BookOpen size={15} />
          <select
            value={activeAsset?.id ?? ""}
            onChange={(event) => {
              const asset = store.assets.find((item) => item.id === event.target.value) ?? null;
              const nextPage = asset ? clampPage(asset.lastPage, asset) : 1;
              setActiveAssetId(asset?.id ?? null);
              loadedBindingNodeIdRef.current = null;
              loadedBindingContextKeyRef.current = "";
              setIsBindingReady(false);
              setPageNumber(nextPage);
              setPageStartDraft(Number.NaN);
              setPageEndDraft(Number.NaN);
              setIsRangeEdited(false);
            }}
            disabled={!canUseTextbook || !store.assets.length}
            title="教材"
            aria-label="教材"
          >
            {store.assets.length ? store.assets.map((asset) => (
              <option key={asset.id} value={asset.id}>{asset.title}</option>
            )) : <option value="">教材</option>}
          </select>
        </div>
        <button type="button" title="选择 PDF" onClick={() => void choosePdf()} disabled={!canUseTextbook || isChoosingPdf}>
          {isChoosingPdf ? <Loader2 className="spin-icon" size={15} /> : <FileUp size={15} />}
          <span>PDF</span>
        </button>
        <button type="button" title="独立窗口" onClick={() => void openDetachedPdf()} disabled={!activeAsset}>
          <ExternalLink size={15} />
        </button>
        <span className="textbook-toolbar-separator" />
        <button type="button" title="上一页" onClick={() => applyPage(pageNumber - 1)} disabled={!activeAsset || pageNumber <= 1}>
          <ChevronLeft size={15} />
        </button>
        <label className="textbook-page-input">
          <input
            type="number"
            min={1}
            max={activeAsset?.pageCount || undefined}
            value={pageNumber}
            onChange={(event) => applyPage(Number(event.target.value))}
            disabled={!activeAsset}
            aria-label="页码"
          />
          <span>{activeAsset?.pageCount ? `/ ${activeAsset.pageCount}` : "页"}</span>
        </label>
        <button type="button" title="下一页" onClick={() => applyPage(pageNumber + 1)} disabled={!activeAsset || Boolean(activeAsset.pageCount && pageNumber >= activeAsset.pageCount)}>
          <ChevronRight size={15} />
        </button>
        <span className="textbook-toolbar-separator" />
        <button type="button" title="上一节点" onClick={() => void navigateCatalog("previous")} disabled={!canNavigatePrevious}>
          <ChevronLeft size={15} />
          <span>上一页</span>
        </button>
        <button type="button" title="下一节点" onClick={() => void navigateCatalog("next")} disabled={!canNavigateNext}>
          <span>下一页</span>
          <ChevronRight size={15} />
        </button>
        <span className="textbook-toolbar-separator" />
        <button type="button" title="缩小" onClick={() => setZoom((value) => Math.max(60, value - ZOOM_STEP))} disabled={!activeAsset || zoom <= 60}>
          <ZoomOut size={15} />
        </button>
        <span className="textbook-zoom-label">{zoom}%</span>
        <button type="button" title="放大" onClick={() => setZoom((value) => Math.min(180, value + ZOOM_STEP))} disabled={!activeAsset || zoom >= 180}>
          <ZoomIn size={15} />
        </button>
        <span className="mindmap-toolbar-spacer" />
        <span className={saveState === "error" ? "textbook-save-state error" : "textbook-save-state"}>
          {saveState === "loading" ? "打开中" : saveState === "saving" ? "保存中" : saveState === "saved" ? message || "已保存" : message}
        </span>
      </div>

      <div className="textbook-split">
        <section className="textbook-reader" aria-label="PDF">
          {activeAsset ? (
            <React.Suspense fallback={<div className="textbook-pdf-status">打开中</div>}>
              <PdfDocumentViewer
                asset={activeAsset}
                pageNumber={pageNumber}
                zoom={zoom}
                onPageChange={handleViewerPageChange}
                onPageCountChange={handleViewerPageCountChange}
              />
            </React.Suspense>
          ) : (
            <div className="textbook-empty">
              <BookOpen size={28} />
              <button type="button" onClick={() => void choosePdf()} disabled={!canUseTextbook || isChoosingPdf}>
                选择 PDF
              </button>
            </div>
          )}
        </section>

        <aside className="textbook-note-panel" aria-label="教材笔记">
          <header>
            <div>
              <span>目录节点</span>
              <select
                value={bindingNodeId ?? ""}
                onChange={(event) => selectBindingNode(event.target.value || null)}
                disabled={!outlineNodes.length}
                aria-label="目录节点"
              >
                <option value="">未选中</option>
                {outlineNodes.map((node) => (
                  <option key={node.nodeId} value={node.nodeId}>
                    {"　".repeat(Math.max(0, node.level))}{node.title || "未命名"}
                  </option>
                ))}
              </select>
            </div>
            <div className="textbook-binding-actions">
              <span className={hasActiveBinding ? "textbook-binding-badge bound" : "textbook-binding-badge"}>{bindingStatusText}</span>
              {hasActiveBinding ? (
                <button type="button" title="取消绑定" onClick={() => void cancelBindingNow()} disabled={!canCancelBinding}>
                  <Unlink size={15} />
                  <span>取消</span>
                </button>
              ) : (
                <button type="button" title="绑定页段" onClick={() => void bindPageRangeNow()} disabled={!canBindPageRange}>
                  <Link2 size={15} />
                  <span>绑定</span>
                </button>
              )}
            </div>
          </header>
          <div className="textbook-range-row">
            <span>页段</span>
            <input
              type="number"
              min={1}
              max={activeAsset?.pageCount || undefined}
              value={pageStartValue}
              onChange={(event) => {
                setIsRangeEdited(true);
                setPageStartDraft(event.target.value === "" ? Number.NaN : Number(event.target.value));
              }}
              disabled={!canEditPageRange}
              aria-label="起始页"
            />
            <span>-</span>
            <input
              type="number"
              min={1}
              max={activeAsset?.pageCount || undefined}
              value={pageEndValue}
              onChange={(event) => {
                setIsRangeEdited(true);
                setPageEndDraft(event.target.value === "" ? Number.NaN : Number(event.target.value));
              }}
              disabled={!canEditPageRange}
              aria-label="结束页"
            />
          </div>
          {noteEditorDisabled ? (
            <div className="textbook-note-placeholder">笔记</div>
          ) : (
            <TextbookNoteEditor
              ref={noteEditorRef}
              editorKey={noteEditorKey}
              snapshot={noteSnapshot}
              onSnapshotChange={setNoteSnapshot}
              onSave={() => void saveNoteNow()}
            />
          )}
          <footer>
            <span>{activeAsset ? `${formatFileSize(activeAsset.byteSize)}${noteCount ? ` · ${noteCount} 条笔记` : ""}` : `${outlineNodeCount} 个目录节点`}</span>
            <div className="textbook-note-actions">
              <button type="button" title="载入文档" onClick={() => void loadNoteIntoDocument()} disabled={!canUseBoundNote || isLoadingIntoDocument}>
                {isLoadingIntoDocument ? <Loader2 className="spin-icon" size={15} /> : <FileText size={15} />}
                <span>载入文档</span>
              </button>
              <button type="button" onClick={() => void saveNoteNow()} disabled={!canUseBoundNote}>
                <Save size={15} />
                <span>保存</span>
              </button>
            </div>
          </footer>
        </aside>
      </div>
    </div>
  );
}
