import type { IEditorData, IElement, IRangeStyle } from "@hufe921/canvas-editor";
import type {
  KnowledgeDocumentAlignment,
  KnowledgeDocumentContent,
  KnowledgeDocumentEditorHandle,
  KnowledgeDocumentFormatState,
  KnowledgeDocumentListType,
  KnowledgeDocumentSnapshot
} from "./knowledgeDocumentTypes";
import { AISTUDY_CORE_CONTRACT } from "../../domain/coreContracts";

const DOCUMENT_EDITOR_VERSION = "canvas-editor@0.9.135";
const DEFAULT_FONT_SIZE = 16;
const DEFAULT_COLOR = "#1f2937";
const DOCUMENT_EDITOR = AISTUDY_CORE_CONTRACT.editors.knowledgeDocument;
const LANDSCAPE_PAGE_RATIO = 794 / 1123;
const DOCUMENT_PAGE_GUTTER = 32;
const MIN_LANDSCAPE_PAGE_WIDTH = 960;
const ZERO_WIDTH_BREAK = "\u200B";
const MAX_TEXT_RUN_LENGTH = 360;
const FORCE_TEXT_RUN_SPLIT_LENGTH = MAX_TEXT_RUN_LENGTH * 2;
const DOCUMENT_SCROLL_CONTAINER_ATTRIBUTE = "data-aistudy-document-scroll-id";
const FAST_SELECTION_CHANGE_EVENT = "aistudy:selection-range-change";
const FAST_SELECTION_VIEWPORT_BUFFER = 96;

type CanvasEditorModule = typeof import("@hufe921/canvas-editor");
type CanvasEditorInstance = InstanceType<CanvasEditorModule["default"]>;
type CanvasEditorOptions = NonNullable<ConstructorParameters<CanvasEditorModule["default"]>[2]> & {
  aistudyFastSelection?: boolean;
};
type CanvasRange = ReturnType<CanvasEditorInstance["command"]["getRange"]>;
type CanvasRangeRect = { x: number; y: number; width: number; height: number };
type CanvasRangeContext = {
  isCollapsed?: boolean;
  rangeRects?: CanvasRangeRect[];
} | null;
type InlineStyleKey = "font" | "size" | "bold" | "color" | "highlight" | "italic" | "underline" | "strikeout" | "textDecoration";

type CanvasDocumentEvents = {
  onSnapshotChanged?: (snapshot: KnowledgeDocumentSnapshot) => void;
  onFormatChanged?: (state: KnowledgeDocumentFormatState) => void;
  onAskAi?: (selectedText: string) => void;
};

type CanvasDocumentEditorOptions = {
  compact?: boolean;
};

let canvasEditorModulePromise: Promise<CanvasEditorModule> | null = null;

const INLINE_STYLE_KEYS: InlineStyleKey[] = [
  "font",
  "size",
  "bold",
  "color",
  "highlight",
  "italic",
  "underline",
  "strikeout",
  "textDecoration"
];
const MANUAL_ORDERED_PREFIX_PATTERN = /^\s*(?:\d+|[一二三四五六七八九十百千]+)[\.．、)\）]\s*/;

function loadCanvasEditor() {
  if (canvasEditorModulePromise) return canvasEditorModulePromise;

  canvasEditorModulePromise = (import.meta.env.DEV
    ? import("@hufe921/canvas-editor")
    : (() => {
        const moduleUrl = import.meta.url;
        const assetsIndex = moduleUrl.lastIndexOf("/assets/");
        const vendorUrl = assetsIndex >= 0 ? `${moduleUrl.slice(0, assetsIndex)}/vendor/canvas-editor.js` : "./vendor/canvas-editor.js";
        return import(/* @vite-ignore */ vendorUrl) as Promise<CanvasEditorModule>;
      })()
  ).catch((error) => {
    canvasEditorModulePromise = null;
    throw error;
  });

  return canvasEditorModulePromise;
}

export async function preloadCanvasDocumentEditor() {
  await loadCanvasEditor();
}

function toElementText(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function getTextRunSignature(element: IElement) {
  return JSON.stringify(
    Object.entries(element)
      .filter(([key]) => key !== "value")
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function shouldSplitTextRunAt(value: string, index: number) {
  if (index < MAX_TEXT_RUN_LENGTH) return false;
  const char = value[index] ?? "";
  return char === "\n" || /[\s,，、;；。.!！?？:：]/.test(char);
}

function splitTextRunValue(value: string) {
  if (value.length <= MAX_TEXT_RUN_LENGTH) return [value];

  const parts: string[] = [];
  let buffer = "";
  for (let index = 0; index < value.length; index += 1) {
    buffer += value[index];
    if (shouldSplitTextRunAt(buffer, buffer.length - 1) || buffer.length >= FORCE_TEXT_RUN_SPLIT_LENGTH) {
      parts.push(buffer);
      buffer = "";
    }
  }
  if (buffer) parts.push(buffer);
  return parts.length > 0 ? parts : [value];
}

function canMergeTextRuns(left: IElement | undefined, right: IElement) {
  if (!left || !isTextElement(left)) return false;
  if (getTextRunSignature(left) !== getTextRunSignature(right)) return false;
  const leftValue = toElementText(left.value);
  const rightValue = toElementText(right.value);
  if (leftValue.length + rightValue.length > MAX_TEXT_RUN_LENGTH) return false;
  if (leftValue.includes("\n") || rightValue.includes("\n")) return false;
  return true;
}

function compactElementList(value: unknown, fallbackToBlank: boolean): IElement[] {
  if (!Array.isArray(value)) return [{ value: "" } as IElement];
  const list = value.filter((item): item is IElement => Boolean(item && typeof item === "object"));
  const compacted: IElement[] = [];

  for (const element of list) {
    if (!isTextElement(element)) {
      compacted.push(element);
      continue;
    }

    const next = { ...element, value: toElementText(element.value) } as IElement;
    if (next.rowFlex === "justify") {
      next.rowFlex = "alignment" as IElement["rowFlex"];
    }
    if (next.value.length === 0) {
      continue;
    }

    for (const part of splitTextRunValue(next.value)) {
      if (!part) continue;
      const segment = { ...next, value: part } as IElement;
      const previous = compacted[compacted.length - 1];
      if (canMergeTextRuns(previous, segment)) {
        previous.value = `${toElementText(previous.value)}${segment.value}`;
        continue;
      }
      compacted.push(segment);
    }
  }

  if (compacted.length > 0) return compacted;
  return fallbackToBlank ? [{ value: "" } as IElement] : [];
}

function normalizeElementList(value: unknown): IElement[] {
  return compactElementList(value, true);
}

function normalizeOptionalElementList(value: unknown): IElement[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = compactElementList(value, false);
  return list.length > 0 ? list : undefined;
}

function normalizeEditorData(content: KnowledgeDocumentContent | null | undefined): IEditorData {
  return {
    header: normalizeOptionalElementList(content?.header),
    main: normalizeElementList(content?.main),
    footer: normalizeOptionalElementList(content?.footer),
    graffiti: Array.isArray(content?.graffiti) ? (content?.graffiti as IEditorData["graffiti"]) : undefined
  };
}

function normalizeLiveElement(element: IElement): IElement {
  const next = { ...element, value: toElementText(element.value) } as IElement;
  if (next.rowFlex === "justify") {
    next.rowFlex = "alignment" as IElement["rowFlex"];
  }
  return next;
}

function normalizeLiveElementList(value: unknown): IElement[] {
  if (!Array.isArray(value)) return [{ value: "" } as IElement];
  const list = value.filter((item): item is IElement => Boolean(item && typeof item === "object")).map(normalizeLiveElement);
  return list.length > 0 ? list : [{ value: "" } as IElement];
}

function normalizeLiveOptionalElementList(value: unknown): IElement[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((item): item is IElement => Boolean(item && typeof item === "object")).map(normalizeLiveElement);
  return list.length > 0 ? list : undefined;
}

function normalizeLiveEditorData(content: KnowledgeDocumentContent | null | undefined): IEditorData {
  return {
    header: normalizeLiveOptionalElementList(content?.header),
    main: normalizeLiveElementList(content?.main),
    footer: normalizeLiveOptionalElementList(content?.footer),
    graffiti: Array.isArray(content?.graffiti) ? (content?.graffiti as IEditorData["graffiti"]) : undefined
  };
}

function hasExplicitInlineStyle(element: IElement) {
  return INLINE_STYLE_KEYS.some((key) => element[key] !== undefined && element[key] !== null);
}

function copyInlineStyle(target: IElement, source: IElement): IElement {
  const next = { ...target };
  for (const key of INLINE_STYLE_KEYS) {
    if (source[key] !== undefined && source[key] !== null) {
      next[key] = source[key] as never;
    }
  }
  return next;
}

function isParagraphBoundary(element: IElement) {
  return element.type === "pageBreak" || element.value.includes("\n") || element.value.includes(ZERO_WIDTH_BREAK);
}

function isTextElement(element: IElement) {
  return !element.type || element.type === "text";
}

function hasVisibleText(element: IElement) {
  return isTextElement(element) && element.value.replace(/\s/g, "").length > 0;
}

function createSmartListId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `smart-ol-${crypto.randomUUID()}`;
  }
  return `smart-ol-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getVisibleElementText(element: IElement) {
  return toElementText(element.value).replace(new RegExp(ZERO_WIDTH_BREAK, "g"), "").trim();
}

function isBlankTextElement(element: IElement) {
  return isTextElement(element) && getVisibleElementText(element).length === 0;
}

function findParagraphBounds(elementList: IElement[], index: number) {
  let start = 0;
  let end = elementList.length - 1;

  for (let i = Math.min(index, elementList.length - 1); i >= 0; i -= 1) {
    if (isParagraphBoundary(elementList[i])) {
      start = i + 1;
      break;
    }
  }

  for (let i = Math.max(index, 0); i < elementList.length; i += 1) {
    if (isParagraphBoundary(elementList[i])) {
      end = i - 1;
      break;
    }
  }

  return { start, end };
}

function inheritLeadingTextStyle(elementList: IElement[], range: CanvasRange) {
  if (range.startIndex !== range.endIndex || elementList.length === 0) {
    return { elementList, changed: false };
  }

  const cursorIndex = Math.min(Math.max(range.startIndex, 0), elementList.length - 1);
  const { start, end } = findParagraphBounds(elementList, cursorIndex);
  if (start > end) {
    return { elementList, changed: false };
  }

  let firstStyledIndex = -1;
  for (let i = start; i <= end; i += 1) {
    const element = elementList[i];
    if (!hasVisibleText(element)) continue;
    if (hasExplicitInlineStyle(element)) {
      firstStyledIndex = i;
      break;
    }
  }

  if (firstStyledIndex <= start || cursorIndex > firstStyledIndex) {
    return { elementList, changed: false };
  }

  const leadingIndexes: number[] = [];
  for (let i = start; i < firstStyledIndex; i += 1) {
    const element = elementList[i];
    if (!hasVisibleText(element)) continue;
    if (hasExplicitInlineStyle(element)) {
      return { elementList, changed: false };
    }
    leadingIndexes.push(i);
  }

  if (leadingIndexes.length === 0) {
    return { elementList, changed: false };
  }

  const styleSource = elementList[firstStyledIndex];
  const next = elementList.slice();
  for (const index of leadingIndexes) {
    next[index] = copyInlineStyle(next[index], styleSource);
  }

  return { elementList: next, changed: true };
}

function inheritDocumentInputStyle(content: IEditorData, range: CanvasRange) {
  if (range.isCrossRowCol || range.tableId || (range.zone && range.zone !== "main")) {
    return { content, changed: false };
  }

  const normalizedMain = inheritLeadingTextStyle(content.main, range);
  if (!normalizedMain.changed) {
    return { content, changed: false };
  }

  return {
    content: {
      ...content,
      main: normalizedMain.elementList
    },
    changed: true
  };
}

function restoreRange(editor: CanvasEditorInstance, range: CanvasRange, mainLength: number) {
  const maxIndex = Math.max(0, mainLength - 1);
  editor.command.executeSetRange(
    Math.min(range.startIndex, maxIndex),
    Math.min(range.endIndex, maxIndex),
    range.tableId,
    range.startTdIndex,
    range.endTdIndex,
    range.startTrIndex,
    range.endTrIndex
  );
}

function normalizeSnapshot(value: unknown): KnowledgeDocumentSnapshot {
  if (value && typeof value === "object") {
    const candidate = value as Partial<KnowledgeDocumentSnapshot>;
    return {
      schemaVersion: AISTUDY_CORE_CONTRACT.schemaVersion,
      editor: DOCUMENT_EDITOR,
      editorVersion: typeof candidate.editorVersion === "string" ? candidate.editorVersion : DOCUMENT_EDITOR_VERSION,
      content: normalizeEditorData(candidate.content as KnowledgeDocumentContent | undefined) as KnowledgeDocumentContent,
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString()
    };
  }

  return createEmptyKnowledgeDocumentSnapshot();
}

export function createEmptyKnowledgeDocumentSnapshot(): KnowledgeDocumentSnapshot {
  return {
    schemaVersion: AISTUDY_CORE_CONTRACT.schemaVersion,
    editor: DOCUMENT_EDITOR,
    editorVersion: DOCUMENT_EDITOR_VERSION,
    content: {
      main: [{ value: "" }]
    },
    updatedAt: new Date().toISOString()
  };
}

function createSnapshotFromEditorData(data: unknown): KnowledgeDocumentSnapshot {
  return {
    schemaVersion: AISTUDY_CORE_CONTRACT.schemaVersion,
    editor: DOCUMENT_EDITOR,
    editorVersion: DOCUMENT_EDITOR_VERSION,
    content: normalizeEditorData(data as KnowledgeDocumentContent) as KnowledgeDocumentContent,
    updatedAt: new Date().toISOString()
  };
}

function toSnapshot(editor: CanvasEditorInstance): KnowledgeDocumentSnapshot {
  const value = editor.command.getValue();
  return createSnapshotFromEditorData(value.data);
}

async function toSnapshotAsync(editor: CanvasEditorInstance): Promise<KnowledgeDocumentSnapshot> {
  try {
    const value = await editor.command.getValueAsync();
    return createSnapshotFromEditorData(value.data);
  } catch {
    return toSnapshot(editor);
  }
}

function toFormatState(payload: IRangeStyle): KnowledgeDocumentFormatState {
  return {
    fontFamily: payload.font || "Microsoft YaHei",
    fontSize: Number.isFinite(payload.size) ? payload.size : DEFAULT_FONT_SIZE,
    color: payload.color || DEFAULT_COLOR,
    highlight: payload.highlight ?? null,
    bold: Boolean(payload.bold),
    italic: Boolean(payload.italic),
    underline: Boolean(payload.underline),
    strikeout: Boolean(payload.strikeout),
    alignment: payload.rowFlex === "alignment" ? "justify" : payload.rowFlex ?? null,
    titleLevel: payload.level ?? "paragraph",
    listType: payload.listType ?? "none"
  };
}

function areFormatStatesEqual(left: KnowledgeDocumentFormatState, right: KnowledgeDocumentFormatState) {
  return (
    left.fontFamily === right.fontFamily &&
    left.fontSize === right.fontSize &&
    left.color === right.color &&
    left.highlight === right.highlight &&
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.underline === right.underline &&
    left.strikeout === right.strikeout &&
    left.alignment === right.alignment &&
    left.titleLevel === right.titleLevel &&
    left.listType === right.listType
  );
}

function toFormatStateFromElement(element: IElement | IRangeStyle | null | undefined, fallback: KnowledgeDocumentFormatState): KnowledgeDocumentFormatState {
  return {
    fontFamily: typeof element?.font === "string" && element.font ? element.font : fallback.fontFamily,
    fontSize: Number.isFinite(element?.size) ? Number(element?.size) : fallback.fontSize,
    color: element?.color || fallback.color,
    highlight: element?.highlight ?? fallback.highlight,
    bold: element?.bold ?? fallback.bold,
    italic: element?.italic ?? fallback.italic,
    underline: element?.underline ?? fallback.underline,
    strikeout: element?.strikeout ?? fallback.strikeout,
    alignment: element?.rowFlex === "alignment" ? "justify" : element?.rowFlex ?? fallback.alignment,
    titleLevel: element?.level ?? fallback.titleLevel,
    listType: element?.listType ?? fallback.listType
  };
}

function readEditorRangeText(editor: CanvasEditorInstance) {
  try {
    return editor.command.getRangeText().trim();
  } catch {
    return "";
  }
}

function getDocumentPageSize(container: HTMLDivElement, options: CanvasDocumentEditorOptions) {
  const availableWidth = container.parentElement?.clientWidth ?? container.clientWidth;
  if (options.compact) {
    const width = Math.max(360, Math.floor(availableWidth - 24));
    return {
      width,
      height: Math.round(width * 1.35)
    };
  }

  const width = Math.max(MIN_LANDSCAPE_PAGE_WIDTH, Math.floor(availableWidth - DOCUMENT_PAGE_GUTTER));
  return {
    width,
    height: Math.round(width * LANDSCAPE_PAGE_RATIO)
  };
}

function createDocumentScrollContainerSelector(container: HTMLDivElement): { selector: string; element: HTMLElement | null; cleanup: () => void } {
  const scrollContainer = container.parentElement instanceof HTMLElement ? container.parentElement : null;
  if (!scrollContainer) return { selector: "", element: null, cleanup: () => undefined };

  const existingId = scrollContainer.getAttribute(DOCUMENT_SCROLL_CONTAINER_ATTRIBUTE);
  if (existingId) {
    return {
      selector: `[${DOCUMENT_SCROLL_CONTAINER_ATTRIBUTE}="${existingId}"]`,
      element: scrollContainer,
      cleanup: () => undefined
    };
  }

  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `doc-scroll-${crypto.randomUUID()}`
    : `doc-scroll-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  scrollContainer.setAttribute(DOCUMENT_SCROLL_CONTAINER_ATTRIBUTE, id);

  return {
    selector: `[${DOCUMENT_SCROLL_CONTAINER_ATTRIBUTE}="${id}"]`,
    element: scrollContainer,
    cleanup: () => {
      if (scrollContainer.getAttribute(DOCUMENT_SCROLL_CONTAINER_ATTRIBUTE) === id) {
        scrollContainer.removeAttribute(DOCUMENT_SCROLL_CONTAINER_ATTRIBUTE);
      }
    }
  };
}

export async function createCanvasDocumentEditor(
  container: HTMLDivElement,
  snapshot: KnowledgeDocumentSnapshot,
  events: CanvasDocumentEvents,
  options: CanvasDocumentEditorOptions = {}
): Promise<KnowledgeDocumentEditorHandle> {
  const { default: Editor, EditorMode, PageMode, PaperDirection, RenderMode, RowFlex, ListType, ListStyle, TitleLevel } = await loadCanvasEditor();
  const pageSize = getDocumentPageSize(container, options);
  const scrollContainer = createDocumentScrollContainerSelector(container);
  const editorOptions: CanvasEditorOptions = {
    mode: EditorMode.EDIT,
    pageMode: PageMode.CONTINUITY,
    paperDirection: PaperDirection.VERTICAL,
    renderMode: RenderMode.SPEED,
    defaultFont: "Microsoft YaHei",
    defaultSize: DEFAULT_FONT_SIZE,
    defaultColor: DEFAULT_COLOR,
    minSize: 10,
    maxSize: 72,
    historyMaxRecordCount: 60,
    pageGap: options.compact ? 10 : 16,
    width: pageSize.width,
    height: pageSize.height,
    margins: options.compact ? [32, 36, 32, 36] : [64, 64, 64, 64],
    scrollContainerSelector: scrollContainer.selector,
    pageOuterSelectionDisable: true,
    aistudyFastSelection: true,
    list: {
      inheritStyle: true
    }
  };
  const editor = new Editor(container, normalizeEditorData(normalizeSnapshot(snapshot).content), editorOptions);
  const editorContainer = editor.command.getContainer();
  const selectionOverlay = document.createElement("div");
  selectionOverlay.style.position = "absolute";
  selectionOverlay.style.inset = "0";
  selectionOverlay.style.zIndex = "4";
  selectionOverlay.style.pointerEvents = "none";
  selectionOverlay.style.overflow = "visible";
  selectionOverlay.style.display = "none";
  editorContainer.append(selectionOverlay);

  let lastSelectedText = "";
  let isNormalizingInputStyle = false;
  let isPointerSelecting = false;
  let hasUserEdited = false;
  let lastRange: CanvasRange | null = null;
  let pendingSnapshotTimer: number | null = null;
  let pendingSnapshotIdle: number | null = null;
  let pendingNormalizeTimer: number | null = null;
  let pendingNormalizeIdle: number | null = null;
  let snapshotRequestId = 0;
  let normalizationRequestId = 0;
  let pendingFormatFrame: number | null = null;
  let pendingFormatState: KnowledgeDocumentFormatState | null = null;
  let pendingSelectionOverlayFrame: number | null = null;
  let lastFormatState: KnowledgeDocumentFormatState = {
    fontFamily: "Microsoft YaHei",
    fontSize: DEFAULT_FONT_SIZE,
    color: DEFAULT_COLOR,
    highlight: null,
    bold: false,
    italic: false,
    underline: false,
    strikeout: false,
    alignment: null,
    titleLevel: "paragraph",
    listType: "none"
  };
  const isSelectedRange = (range: CanvasRange | null) => {
    return Boolean(range && (range.startIndex !== range.endIndex || range.isCrossRowCol || range.tableId));
  };
  const rememberRange = () => {
    try {
      const range = editor.command.getRange();
      if (isSelectedRange(range)) {
        lastRange = range;
      }
      return range;
    } catch {
      return lastRange;
    }
  };
  const restoreRememberedRange = () => {
    const currentRange = rememberRange();
    if (isSelectedRange(currentRange)) return true;
    if (!lastRange) return false;

    try {
      editor.command.executeSetRange(
        lastRange.startIndex,
        lastRange.endIndex,
        lastRange.tableId,
        lastRange.startTdIndex,
        lastRange.endTdIndex,
        lastRange.startTrIndex,
        lastRange.endTrIndex
      );
      return true;
    } catch {
      return false;
    }
  };
  const clearPendingSnapshotTask = () => {
    if (pendingSnapshotTimer !== null) {
      window.clearTimeout(pendingSnapshotTimer);
      pendingSnapshotTimer = null;
    }
    if (pendingSnapshotIdle !== null) {
      window.cancelIdleCallback?.(pendingSnapshotIdle);
      pendingSnapshotIdle = null;
    }
  };
  const clearPendingNormalizeTask = () => {
    if (pendingNormalizeTimer !== null) {
      window.clearTimeout(pendingNormalizeTimer);
      pendingNormalizeTimer = null;
    }
    if (pendingNormalizeIdle !== null) {
      window.cancelIdleCallback?.(pendingNormalizeIdle);
      pendingNormalizeIdle = null;
    }
  };
  const emitSnapshotNow = () => {
    clearPendingSnapshotTask();
    snapshotRequestId += 1;
    const nextSnapshot = toSnapshot(editor);
    events.onSnapshotChanged?.(nextSnapshot);
    return nextSnapshot;
  };
  const emitSnapshotNowAsync = async () => {
    clearPendingSnapshotTask();
    const requestId = snapshotRequestId + 1;
    snapshotRequestId = requestId;
    const nextSnapshot = await toSnapshotAsync(editor);
    if (requestId === snapshotRequestId) {
      events.onSnapshotChanged?.(nextSnapshot);
    }
    return nextSnapshot;
  };
  const scheduleSnapshot = () => {
    clearPendingSnapshotTask();
    pendingSnapshotTimer = window.setTimeout(() => {
      pendingSnapshotTimer = null;
      const flush = () => {
        pendingSnapshotTimer = null;
        pendingSnapshotIdle = null;
        const requestId = snapshotRequestId + 1;
        snapshotRequestId = requestId;
        void toSnapshotAsync(editor).then((nextSnapshot) => {
          if (requestId === snapshotRequestId) {
            events.onSnapshotChanged?.(nextSnapshot);
          }
        });
      };
      if (window.requestIdleCallback) {
        pendingSnapshotIdle = window.requestIdleCallback(flush, { timeout: 1500 });
        return;
      }
      pendingSnapshotTimer = window.setTimeout(flush, 0);
    }, 650);
  };
  const normalizeCurrentContentAsync = async (requestId: number) => {
    if (isNormalizingInputStyle) return;
    const range = editor.command.getRange();
    const currentValue = await editor.command.getValueAsync();
    if (requestId !== normalizationRequestId || isNormalizingInputStyle) return;

    let nextContent = normalizeLiveEditorData(currentValue.data);
    const normalizedInputStyle = inheritDocumentInputStyle(nextContent, range);
    nextContent = normalizedInputStyle.content;
    const normalizedLists = normalizeOrderedLists(nextContent);
    nextContent = normalizedLists.content;

    if (!normalizedInputStyle.changed && !normalizedLists.changed) return;
    isNormalizingInputStyle = true;
    try {
      editor.command.executeSetValue(nextContent, { isSetCursor: false });
      restoreRange(editor, range, nextContent.main.length);
    } finally {
      isNormalizingInputStyle = false;
    }
  };
  const scheduleContentNormalization = () => {
    normalizationRequestId += 1;
    const requestId = normalizationRequestId;
    clearPendingNormalizeTask();
    pendingNormalizeTimer = window.setTimeout(() => {
      pendingNormalizeTimer = null;
      const flush = () => {
        pendingNormalizeTimer = null;
        pendingNormalizeIdle = null;
        void normalizeCurrentContentAsync(requestId).catch(() => undefined);
      };
      if (window.requestIdleCallback) {
        pendingNormalizeIdle = window.requestIdleCallback(flush, { timeout: 1200 });
        return;
      }
      pendingNormalizeTimer = window.setTimeout(flush, 0);
    }, 280);
  };
  const runFormatCommand = (action: () => void) => {
    hasUserEdited = true;
    restoreRememberedRange();
    action();
    rememberRange();
    scheduleSnapshot();
  };
  const normalizeOrderedLists = (content: IEditorData) => {
    let changed = false;
    let activeListId: string | null = null;

    const nextMain = content.main.map((element) => {
      if (!isTextElement(element)) {
        activeListId = null;
        return element;
      }

      const rawValue = toElementText(element.value);
      const isOrderedElement = element.listType === ListType.OL;

      if (!isOrderedElement) {
        if (rawValue.trim() || isParagraphBoundary(element)) activeListId = null;
        return element;
      }

      if (!activeListId) {
        activeListId = typeof element.listId === "string" && element.listId ? element.listId : createSmartListId();
      }

      if (isBlankTextElement(element)) {
        const nextElement = {
          ...element,
          value: rawValue || ZERO_WIDTH_BREAK
        } as IElement;
        delete nextElement.listType;
        delete nextElement.listStyle;
        delete nextElement.listId;

        if (
          nextElement.value !== element.value ||
          nextElement.listType !== element.listType ||
          nextElement.listStyle !== element.listStyle ||
          nextElement.listId !== element.listId
        ) {
          changed = true;
        }

        return nextElement;
      }

      const nextValue = rawValue.replace(MANUAL_ORDERED_PREFIX_PATTERN, "");
      const nextElement = {
        ...element,
        value: nextValue,
        listType: ListType.OL,
        listStyle: ListStyle.DECIMAL,
        listId: activeListId
      } as IElement;

      if (
        nextElement.value !== element.value ||
        nextElement.listType !== element.listType ||
        nextElement.listStyle !== element.listStyle ||
        nextElement.listId !== element.listId
      ) {
        changed = true;
      }

      return nextElement;
    });

    return {
      content: changed ? { ...content, main: nextMain } : content,
      changed
    };
  };
  const cancelBlankListOnEnter = () => {
    const range = rememberRange();
    if (!range || range.tableId || (range.zone && range.zone !== "main")) return false;

    let rowElements: IElement[] = [];
    try {
      rowElements = editor.command.getRangeRow()?.filter(isTextElement) ?? [];
    } catch {
      rowElements = [];
    }

    if (rowElements.length === 0) {
      const elementList = normalizeEditorData(editor.command.getValue().data).main;
      if (elementList.length === 0) return false;
      const startIndex = Math.max(0, Math.min(range.startIndex, elementList.length - 1));
      const endIndex = Math.max(startIndex, Math.min(range.endIndex, elementList.length - 1));
      rowElements = elementList.slice(startIndex, endIndex + 1).filter(isTextElement);
    }

    const hasOrderedBlankLine = rowElements.some((element) => element.listType === ListType.OL);
    const hasVisibleTextInRow = rowElements.some((element) => getVisibleElementText(element).length > 0);
    if (!hasOrderedBlankLine || hasVisibleTextInRow) return false;

    runFormatCommand(() => editor.command.executeList(null));
    return true;
  };
  const cancelBlankListKeyboardAction = (event: KeyboardEvent | InputEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    const isKeyboardCancel =
      event instanceof KeyboardEvent &&
      (event.key === "Enter" || event.key === "Backspace" || event.key === "Delete");
    const isBeforeInputCancel =
      event instanceof InputEvent &&
      (event.inputType === "insertParagraph" || event.inputType === "deleteContentBackward" || event.inputType === "deleteContentForward");

    if (!isKeyboardCancel && !isBeforeInputCancel) return;
    if (!cancelBlankListOnEnter()) return;

    event.preventDefault();
    event.stopPropagation();
  };
  const readCurrentSelectionElementList = () => {
    try {
      return editor.command.getRangeContext()?.selectionElementList ?? [];
    } catch {
      return [];
    }
  };
  const rememberSelectedText = () => {
    const selectedText = readEditorRangeText(editor);
    if (selectedText) {
      lastSelectedText = selectedText;
    }
    return selectedText;
  };
  const flushFormatState = () => {
    pendingFormatFrame = null;
    const nextState = pendingFormatState;
    pendingFormatState = null;
    if (!nextState || areFormatStatesEqual(nextState, lastFormatState)) return;
    lastFormatState = nextState;
    events.onFormatChanged?.(nextState);
  };
  const scheduleFormatState = (nextState: KnowledgeDocumentFormatState) => {
    pendingFormatState = nextState;
    if (isPointerSelecting) return;
    if (pendingFormatFrame !== null) return;
    pendingFormatFrame = window.requestAnimationFrame(flushFormatState);
  };
  const getSelectionViewportBounds = () => {
    const editorRect = editorContainer.getBoundingClientRect();
    const viewportRect = scrollContainer.element?.getBoundingClientRect() ?? {
      top: 0,
      bottom: window.innerHeight
    };
    return {
      top: viewportRect.top - editorRect.top - FAST_SELECTION_VIEWPORT_BUFFER,
      bottom: viewportRect.bottom - editorRect.top + FAST_SELECTION_VIEWPORT_BUFFER
    };
  };
  const readSelectionRangeRects = () => {
    try {
      const context = editor.command.getRangeContext() as CanvasRangeContext;
      if (!context || context.isCollapsed || !Array.isArray(context.rangeRects)) return [];
      return context.rangeRects.filter((rect) => {
        return Number.isFinite(rect.x) && Number.isFinite(rect.y) && Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.height > 0;
      });
    } catch {
      return [];
    }
  };
  const renderSelectionOverlay = () => {
    pendingSelectionOverlayFrame = null;
    if (!isPointerSelecting) {
      selectionOverlay.replaceChildren();
      selectionOverlay.style.display = "none";
      return;
    }

    const { top, bottom } = getSelectionViewportBounds();
    const fragment = document.createDocumentFragment();
    let visibleRectCount = 0;

    for (const rect of readSelectionRangeRects()) {
      if (rect.y + rect.height < top || rect.y > bottom) continue;
      const item = document.createElement("div");
      item.style.position = "absolute";
      item.style.left = `${rect.x}px`;
      item.style.top = `${rect.y}px`;
      item.style.width = `${Math.max(rect.width, 2)}px`;
      item.style.height = `${rect.height}px`;
      item.style.background = "rgba(174, 203, 250, 0.6)";
      item.style.borderRadius = "1px";
      fragment.append(item);
      visibleRectCount += 1;
    }

    selectionOverlay.replaceChildren(fragment);
    selectionOverlay.style.display = visibleRectCount > 0 ? "block" : "none";
  };
  const scheduleSelectionOverlay = () => {
    if (!isPointerSelecting || pendingSelectionOverlayFrame !== null) return;
    pendingSelectionOverlayFrame = window.requestAnimationFrame(renderSelectionOverlay);
  };
  const clearSelectionOverlay = () => {
    if (pendingSelectionOverlayFrame !== null) {
      window.cancelAnimationFrame(pendingSelectionOverlayFrame);
      pendingSelectionOverlayFrame = null;
    }
    selectionOverlay.replaceChildren();
    selectionOverlay.style.display = "none";
  };
  const handleFastSelectionRangeChange = () => {
    scheduleSelectionOverlay();
  };
  const commitFastSelectionRange = () => {
    const range = rememberRange();
    if (!range || !isSelectedRange(range)) return;
    editor.command.executeSetRange(
      range.startIndex,
      range.endIndex,
      range.tableId,
      range.startTdIndex,
      range.endTdIndex,
      range.startTrIndex,
      range.endTrIndex
    );
  };
  const finishPointerSelection = () => {
    if (!isPointerSelecting) return;
    isPointerSelecting = false;
    commitFastSelectionRange();
    clearSelectionOverlay();
    if (!pendingFormatState || pendingFormatFrame !== null) return;
    pendingFormatFrame = window.requestAnimationFrame(flushFormatState);
  };
  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    isPointerSelecting = true;
    clearSelectionOverlay();
  };
  const markUserEdited = () => {
    hasUserEdited = true;
  };
  const handleBeforeInput = (event: InputEvent) => {
    markUserEdited();
    cancelBlankListKeyboardAction(event);
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    markUserEdited();
    cancelBlankListKeyboardAction(event);
  };
  container.addEventListener("pointerdown", handlePointerDown, true);
  container.addEventListener(FAST_SELECTION_CHANGE_EVENT, handleFastSelectionRangeChange);
  container.addEventListener("beforeinput", handleBeforeInput, true);
  container.addEventListener("keydown", handleKeyDown, true);
  container.addEventListener("paste", markUserEdited, true);
  container.addEventListener("cut", markUserEdited, true);
  container.addEventListener("drop", markUserEdited, true);
  container.addEventListener("compositionstart", markUserEdited, true);
  window.addEventListener("pointerup", finishPointerSelection);
  window.addEventListener("pointercancel", finishPointerSelection);

  editor.listener.contentChange = () => {
    if (!hasUserEdited && !isNormalizingInputStyle) return;
    if (isNormalizingInputStyle) {
      scheduleSnapshot();
      return;
    }

    scheduleContentNormalization();
    scheduleSnapshot();
  };
  editor.listener.rangeStyleChange = (payload) => {
    const nextState = toFormatState(payload);
    if (isPointerSelecting) {
      pendingFormatState = nextState;
      return;
    }
    scheduleFormatState(nextState);
    rememberRange();
  };
  editor.register.contextMenuList([
    {
      key: "aistudy-ask-ai",
      name: "问 AI",
      when: (context) => context.editorHasSelection,
      callback: () => {
        events.onAskAi?.(rememberSelectedText() || lastSelectedText);
      }
    }
  ]);

  return {
    getSnapshot: () => {
      clearPendingSnapshotTask();
      snapshotRequestId += 1;
      return toSnapshot(editor);
    },
    getSnapshotAsync: emitSnapshotNowAsync,
    getSelectedText: () => rememberSelectedText() || lastSelectedText,
    hasSelection: () => {
      if (!restoreRememberedRange()) return false;
      return Boolean(readEditorRangeText(editor) || readCurrentSelectionElementList().length > 0);
    },
    exec: (command) => {
      if (command !== "save") markUserEdited();
      if (command === "undo") editor.command.executeUndo();
      if (command === "redo") editor.command.executeRedo();
      if (command === "bold") runFormatCommand(() => editor.command.executeBold());
      if (command === "italic") runFormatCommand(() => editor.command.executeItalic());
      if (command === "underline") runFormatCommand(() => editor.command.executeUnderline());
      if (command === "strikeout") runFormatCommand(() => editor.command.executeStrikeout());
      if (command === "superscript") runFormatCommand(() => editor.command.executeSuperscript());
      if (command === "subscript") runFormatCommand(() => editor.command.executeSubscript());
      if (command === "pageBreak") runFormatCommand(() => editor.command.executePageBreak());
      if (command === "separator") runFormatCommand(() => editor.command.executeSeparator([4, 2], { lineWidth: 1, color: "#94a3b8" }));
      if (command === "save") void emitSnapshotNowAsync();
    },
    setFontFamily: (fontFamily) => {
      runFormatCommand(() => editor.command.executeFont(fontFamily));
    },
    setFontSize: (size) => {
      runFormatCommand(() => editor.command.executeSize(size));
    },
    setColor: (color) => {
      runFormatCommand(() => editor.command.executeColor(color));
    },
    setHighlight: (color) => {
      runFormatCommand(() => editor.command.executeHighlight(color));
    },
    setTitleLevel: (level) => {
      const levelMap = {
        paragraph: null,
        first: TitleLevel.FIRST,
        second: TitleLevel.SECOND,
        third: TitleLevel.THIRD,
        fourth: TitleLevel.FOURTH,
        fifth: TitleLevel.FIFTH,
        sixth: TitleLevel.SIXTH
      } as const;
      runFormatCommand(() => editor.command.executeTitle(levelMap[level] ?? null));
    },
    setAlignment: (alignment: KnowledgeDocumentAlignment) => {
      const alignmentMap = {
        left: RowFlex.LEFT,
        center: RowFlex.CENTER,
        right: RowFlex.RIGHT,
        alignment: RowFlex.ALIGNMENT,
        justify: RowFlex.ALIGNMENT
      } as const;
      runFormatCommand(() => editor.command.executeRowFlex(alignmentMap[alignment]));
    },
    setList: (type: KnowledgeDocumentListType) => {
      if (type === "none") {
        runFormatCommand(() => editor.command.executeList(null));
        return;
      }
      runFormatCommand(() => editor.command.executeList(type === "ul" ? ListType.UL : ListType.OL, type === "ul" ? ListStyle.DISC : ListStyle.DECIMAL));
    },
    cancelBlankListOnEnter,
    insertTable: (rows, cols) => {
      runFormatCommand(() => editor.command.executeInsertTable(rows, cols));
    },
    startFormatPainter: (reusable) => {
      if (!restoreRememberedRange()) return false;
      const selectedElements = readCurrentSelectionElementList();
      if (selectedElements.length === 0) return false;

      editor.command.executePainter({ isDblclick: reusable });
      lastRange = null;
      return true;
    },
    clearFormatPainter: () => {
      editor.command.executePainter({ isDblclick: false });
      lastRange = null;
    },
    focus: () => {
      editor.command.executeFocus();
    },
    destroy: () => {
      if (hasUserEdited && (pendingSnapshotTimer !== null || pendingSnapshotIdle !== null)) {
        clearPendingSnapshotTask();
        events.onSnapshotChanged?.(toSnapshot(editor));
      }
      normalizationRequestId += 1;
      clearPendingNormalizeTask();
      if (pendingFormatFrame !== null) {
        window.cancelAnimationFrame(pendingFormatFrame);
        pendingFormatFrame = null;
      }
      clearSelectionOverlay();
      container.removeEventListener("pointerdown", handlePointerDown, true);
      container.removeEventListener(FAST_SELECTION_CHANGE_EVENT, handleFastSelectionRangeChange);
      container.removeEventListener("beforeinput", handleBeforeInput, true);
      container.removeEventListener("keydown", handleKeyDown, true);
      container.removeEventListener("paste", markUserEdited, true);
      container.removeEventListener("cut", markUserEdited, true);
      container.removeEventListener("drop", markUserEdited, true);
      container.removeEventListener("compositionstart", markUserEdited, true);
      window.removeEventListener("pointerup", finishPointerSelection);
      window.removeEventListener("pointercancel", finishPointerSelection);
      try {
        editor.destroy();
      } catch {
        // canvas-editor removes its own container during destroy. During rapid
        // mode/node switches that container may already be detached by React.
      }
      scrollContainer.cleanup();
    }
  };
}
