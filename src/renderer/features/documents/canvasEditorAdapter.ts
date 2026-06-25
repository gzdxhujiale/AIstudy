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

type CanvasEditorModule = typeof import("@hufe921/canvas-editor");
type CanvasEditorInstance = InstanceType<CanvasEditorModule["default"]>;
type CanvasRange = ReturnType<CanvasEditorInstance["command"]["getRange"]>;
type InlineStyleKey = "font" | "size" | "bold" | "color" | "highlight" | "italic" | "underline" | "strikeout" | "textDecoration";

type CanvasDocumentEvents = {
  onSnapshotChanged?: (snapshot: KnowledgeDocumentSnapshot) => void;
  onFormatChanged?: (state: KnowledgeDocumentFormatState) => void;
  onAskAi?: (selectedText: string) => void;
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

    const previous = compacted[compacted.length - 1];
    if (previous && isTextElement(previous) && getTextRunSignature(previous) === getTextRunSignature(next)) {
      previous.value = `${previous.value}${next.value}`;
      continue;
    }

    compacted.push(next);
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

function toSnapshot(editor: CanvasEditorInstance): KnowledgeDocumentSnapshot {
  const value = editor.command.getValue();
  return {
    schemaVersion: AISTUDY_CORE_CONTRACT.schemaVersion,
    editor: DOCUMENT_EDITOR,
    editorVersion: DOCUMENT_EDITOR_VERSION,
    content: normalizeEditorData(value.data) as KnowledgeDocumentContent,
    updatedAt: new Date().toISOString()
  };
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

function getLandscapePageSize(container: HTMLDivElement) {
  const availableWidth = container.parentElement?.clientWidth ?? container.clientWidth;
  const width = Math.max(MIN_LANDSCAPE_PAGE_WIDTH, Math.floor(availableWidth - DOCUMENT_PAGE_GUTTER));
  return {
    width,
    height: Math.round(width * LANDSCAPE_PAGE_RATIO)
  };
}

export async function createCanvasDocumentEditor(
  container: HTMLDivElement,
  snapshot: KnowledgeDocumentSnapshot,
  events: CanvasDocumentEvents
): Promise<KnowledgeDocumentEditorHandle> {
  const { default: Editor, EditorMode, PageMode, PaperDirection, RenderMode, RowFlex, ListType, ListStyle, TitleLevel } = await loadCanvasEditor();
  const pageSize = getLandscapePageSize(container);
  const editor = new Editor(container, normalizeEditorData(normalizeSnapshot(snapshot).content), {
    mode: EditorMode.EDIT,
    pageMode: PageMode.CONTINUITY,
    paperDirection: PaperDirection.HORIZONTAL,
    renderMode: RenderMode.SPEED,
    defaultFont: "Microsoft YaHei",
    defaultSize: DEFAULT_FONT_SIZE,
    defaultColor: DEFAULT_COLOR,
    minSize: 10,
    maxSize: 72,
    historyMaxRecordCount: 60,
    pageGap: 16,
    width: pageSize.height,
    height: pageSize.width,
    margins: [64, 64, 64, 64],
    list: {
      inheritStyle: true
    }
  });

  let lastSelectedText = "";
  let isNormalizingInputStyle = false;
  let isPointerSelecting = false;
  let hasUserEdited = false;
  let lastRange: CanvasRange | null = null;
  let pendingSnapshotTimer: number | null = null;
  let pendingSnapshotIdle: number | null = null;
  let pendingFormatFrame: number | null = null;
  let pendingFormatState: KnowledgeDocumentFormatState | null = null;
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
  const emitSnapshotNow = () => {
    clearPendingSnapshotTask();
    const nextSnapshot = toSnapshot(editor);
    events.onSnapshotChanged?.(nextSnapshot);
    return nextSnapshot;
  };
  const scheduleSnapshot = () => {
    clearPendingSnapshotTask();
    pendingSnapshotTimer = window.setTimeout(() => {
      pendingSnapshotTimer = null;
      const flush = () => {
        pendingSnapshotTimer = null;
        pendingSnapshotIdle = null;
        events.onSnapshotChanged?.(toSnapshot(editor));
      };
      if (window.requestIdleCallback) {
        pendingSnapshotIdle = window.requestIdleCallback(flush, { timeout: 1500 });
        return;
      }
      pendingSnapshotTimer = window.setTimeout(flush, 0);
    }, 650);
  };
  const runFormatCommand = (action: () => void) => {
    hasUserEdited = true;
    restoreRememberedRange();
    action();
    rememberRange();
    emitSnapshotNow();
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
  const finishPointerSelection = () => {
    if (!isPointerSelecting) return;
    isPointerSelecting = false;
    if (!pendingFormatState || pendingFormatFrame !== null) return;
    pendingFormatFrame = window.requestAnimationFrame(flushFormatState);
  };
  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    isPointerSelecting = true;
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

    const range = editor.command.getRange();
    const currentValue = editor.command.getValue();
    let nextContent = normalizeLiveEditorData(currentValue.data);
    const normalizedInputStyle = inheritDocumentInputStyle(nextContent, range);
    nextContent = normalizedInputStyle.content;
    const normalizedLists = normalizeOrderedLists(nextContent);
    nextContent = normalizedLists.content;

    if (normalizedInputStyle.changed || normalizedLists.changed) {
      isNormalizingInputStyle = true;
      try {
        editor.command.executeSetValue(nextContent, { isSetCursor: false });
        restoreRange(editor, range, nextContent.main.length);
      } finally {
        isNormalizingInputStyle = false;
      }
    }

    scheduleSnapshot();
  };
  editor.listener.rangeStyleChange = (payload) => {
    scheduleFormatState(toFormatState(payload));
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
      return toSnapshot(editor);
    },
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
      if (command === "save") emitSnapshotNow();
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
      if (pendingFormatFrame !== null) {
        window.cancelAnimationFrame(pendingFormatFrame);
        pendingFormatFrame = null;
      }
      container.removeEventListener("pointerdown", handlePointerDown, true);
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
    }
  };
}
