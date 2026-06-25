import { AISTUDY_CORE_CONTRACT } from "../../domain/coreContracts";
import {
  createXMindStyleThemeConfig,
  extractNodeId,
  extractNodeTitle,
  MIND_MAP_DEFAULT_FONT_SIZE,
  MIND_MAP_EDITOR_VERSION,
  normalizeLayout,
  normalizeMindMapTree
} from "./mindMapSnapshot";
import type {
  MindMapCommand,
  MindMapCommandPayload,
  MindMapEditorEvents,
  MindMapEditorHandle,
  MindMapEditorOptions,
  MindMapExportType,
  MindMapLayoutType,
  MindMapSelectedNode,
  MindMapSnapshot,
  MindMapTextFormat,
  MindMapTextFormatPatch,
  MindMapViewportAxis,
  MindMapViewportState
} from "./mindMapTypes";

type SimpleMindMapConstructor = {
  new (options: Record<string, unknown>): any;
  usePlugin?: (plugin: SimpleMindMapPlugin) => SimpleMindMapConstructor;
};
type SimpleMindMapPlugin = {
  new (options: Record<string, unknown>): any;
  instanceName?: string;
};
type UnknownModule = Record<string, unknown> | { default?: unknown } | unknown;

const SVG_NS = "http://www.w3.org/2000/svg";
const DOT_GRID_PATTERN_ID = "aistudy-dot-grid-pattern";
const EMPTY_MIND_MAP_VIEWPORT_STATE: MindMapViewportState = {
  vertical: { position: 0, size: 100, enabled: false },
  horizontal: { position: 0, size: 100, enabled: false }
};
const DEFAULT_NODE_TEXT_WRAP_WIDTH = 300;
const MIN_NODE_TEXT_WRAP_WIDTH = 160;
const MAX_NODE_TEXT_WRAP_WIDTH = 560;
const INITIAL_VIEW_SCALE = 1;

let xmindExportPluginPromise: Promise<SimpleMindMapPlugin> | null = null;
let simpleMindMapConstructorPromise: Promise<SimpleMindMapConstructor> | null = null;

function resolveModuleConstructor<T>(module: UnknownModule, moduleName: string): T {
  let candidate = module;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof candidate === "function") {
      return candidate as T;
    }
    if (!candidate || typeof candidate !== "object" || !("default" in candidate)) break;
    candidate = (candidate as { default?: unknown }).default;
  }

  throw new Error(`${moduleName} 加载失败：模块没有返回可构造的导出`);
}

async function loadSimpleMindMap() {
  if (simpleMindMapConstructorPromise) return simpleMindMapConstructorPromise;

  simpleMindMapConstructorPromise = loadSimpleMindMapModules().catch((error) => {
    simpleMindMapConstructorPromise = null;
    throw error;
  });

  return simpleMindMapConstructorPromise;
}

async function loadSimpleMindMapModules() {
  const [
    mindMapModule,
    dragModule,
    selectModule,
    keyboardNavigationModule,
    associativeLineModule,
    outerFrameModule,
    exportModule,
    scrollbarModule
  ] = await Promise.all([
    import("simple-mind-map"),
    import("simple-mind-map/src/plugins/Drag.js"),
    import("simple-mind-map/src/plugins/Select.js"),
    import("simple-mind-map/src/plugins/KeyboardNavigation.js"),
    import("simple-mind-map/src/plugins/AssociativeLine.js"),
    import("simple-mind-map/src/plugins/OuterFrame.js"),
    import("simple-mind-map/src/plugins/Export.js"),
    import("simple-mind-map/src/plugins/Scrollbar.js")
  ]);
  const MindMap = resolveModuleConstructor<SimpleMindMapConstructor>(mindMapModule, "simple-mind-map");
  const plugins = [
    ["simple-mind-map Drag plugin", dragModule],
    ["simple-mind-map Select plugin", selectModule],
    ["simple-mind-map KeyboardNavigation plugin", keyboardNavigationModule],
    ["simple-mind-map AssociativeLine plugin", associativeLineModule],
    ["simple-mind-map OuterFrame plugin", outerFrameModule],
    ["simple-mind-map Export plugin", exportModule],
    ["simple-mind-map Scrollbar plugin", scrollbarModule]
  ] as const;

  if (typeof MindMap.usePlugin === "function") {
    for (const [name, module] of plugins) {
      MindMap.usePlugin(resolveModuleConstructor<SimpleMindMapPlugin>(module, name));
    }
  }

  return MindMap;
}

export async function preloadSimpleMindMapEditor() {
  await loadSimpleMindMap();
}

async function ensureXMindExportPlugin(editor: any) {
  if (editor.doExportXMind) return;
  if (!xmindExportPluginPromise) {
    xmindExportPluginPromise = import("simple-mind-map/src/plugins/ExportXMind.js").then(
      (module) => resolveModuleConstructor<SimpleMindMapPlugin>(module, "simple-mind-map ExportXMind plugin")
    );
  }
  const ExportXMind = await xmindExportPluginPromise;
  if (editor.doExportXMind) return;

  if (typeof editor.addPlugin === "function") {
    editor.addPlugin(ExportXMind);
    return;
  }

  editor.doExportXMind = new ExportXMind({ mindMap: editor });
}

function toEditorData(snapshot: MindMapSnapshot) {
  const layout = normalizeLayout(snapshot.layout);
  return {
    root: applyLayoutSafeTextWidths(normalizeMindMapTree(snapshot.root)),
    layout,
    theme: {
      template: snapshot.theme?.template ?? "default",
      config: createXMindStyleThemeConfig()
    },
    view: snapshot.view
  };
}

function toSnapshot(editor: any): MindMapSnapshot {
  ensureStableRenderTreeNodeIds(editor);
  const data = editor.getData(true) as {
    root: MindMapSnapshot["root"];
    layout?: MindMapLayoutType;
    theme?: MindMapSnapshot["theme"];
    view?: unknown;
  };
  const root = editor.renderer?.root?.getPureData?.(true, false) ?? data.root;
  const layout = normalizeLayout(data.layout);

  return {
    schemaVersion: AISTUDY_CORE_CONTRACT.schemaVersion,
    editor: AISTUDY_CORE_CONTRACT.editors.mindMap,
    editorVersion: MIND_MAP_EDITOR_VERSION,
    root: normalizeMindMapTree(root),
    layout,
    theme: {
      template: data.theme?.template ?? "default",
      config: createXMindStyleThemeConfig()
    },
    view: data.view,
    updatedAt: new Date().toISOString()
  };
}

function getActiveNode(editor: any, selectedNode: any = null) {
  const activeNodes = Array.isArray(editor.renderer?.activeNodeList) ? editor.renderer.activeNodeList : [];
  return activeNodes[0] ?? selectedNode ?? null;
}

function getActiveNodes(editor: any, fallbackNode: any = null) {
  const activeNodes = Array.isArray(editor.renderer?.activeNodeList) ? editor.renderer.activeNodeList : [];
  if (activeNodes.length > 0) return activeNodes;
  return fallbackNode ? [fallbackNode] : [];
}

function createRuntimeNodeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `aistudy-node-${crypto.randomUUID().replaceAll("-", "")}`;
  }
  return `aistudy-node-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function walkRenderTree(node: any, visitor: (node: any) => void) {
  if (!node || typeof node !== "object") return;
  visitor(node);
  const children = Array.isArray(node.children) ? node.children : [];
  children.forEach((child: unknown) => walkRenderTree(child, visitor));
}

function ensureStableRenderTreeNodeIds(editor: any) {
  const usedIds = new Set<string>();
  let changed = false;
  walkRenderTree(editor.renderer?.renderTree, (node) => {
    if (!node.data || typeof node.data !== "object") {
      node.data = {};
      changed = true;
    }

    const currentId = typeof node.data.uid === "string" && node.data.uid.trim() ? node.data.uid.trim() : "";
    if (currentId && !usedIds.has(currentId)) {
      usedIds.add(currentId);
      if (node.data.uid !== currentId) {
        node.data.uid = currentId;
        changed = true;
      }
      return;
    }

    let nextId = createRuntimeNodeId();
    while (usedIds.has(nextId)) {
      nextId = createRuntimeNodeId();
    }
    usedIds.add(nextId);
    node.data.uid = nextId;
    changed = true;
  });
  return changed;
}

function findCurrentRenderNode(editor: any, node: any = null, nodeId: string | null = null) {
  if (nodeId) {
    const latestNode = editor.renderer?.findNodeByUid?.(nodeId);
    if (latestNode) return latestNode;
  }

  const activeNode = getActiveNode(editor);
  if (activeNode) return activeNode;

  const fallbackId = extractNodeId(node);
  return fallbackId ? editor.renderer?.findNodeByUid?.(fallbackId) ?? node : node;
}

function readActiveNodeFromEvent(editor: any, node: unknown, activeNodeList?: unknown) {
  if (node && typeof node === "object") return node;
  if (Array.isArray(activeNodeList) && activeNodeList[0] && typeof activeNodeList[0] === "object") {
    return activeNodeList[0];
  }
  return getActiveNode(editor);
}

function normalizePanelText(value: unknown, maxLength: number) {
  return (typeof value === "string" ? value : "").trim().slice(0, maxLength);
}

function normalizeTags(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  const unique = new Set<string>();
  source.forEach((item) => {
    const text = normalizePanelText(item, 24);
    if (text) unique.add(text);
  });
  return Array.from(unique).slice(0, 8);
}

function replaceMarker(icons: unknown, markerType: "priority" | "progress", markerValue?: string | null) {
  const source = Array.isArray(icons) ? icons.filter((item): item is string => typeof item === "string") : [];
  const preserved = source.filter((item) => !item.startsWith(`${markerType}_`));
  if (!markerValue) return preserved;
  return [...preserved, `${markerType}_${markerValue}`];
}

function readMarker(icons: unknown, markerType: "priority" | "progress") {
  const source = Array.isArray(icons) ? icons.filter((item): item is string => typeof item === "string") : [];
  const marker = source.find((item) => item.startsWith(`${markerType}_`));
  return marker ? marker.slice(markerType.length + 1) : "";
}

function applyTopicElementCommand(editor: any, activeNode: any, command: MindMapCommand, payload: MindMapCommandPayload = {}) {
  const nodes = getActiveNodes(editor, activeNode);
  if (nodes.length === 0) return;

  nodes.forEach((node: any) => {
    const data = readNodeData(node);
    if (command === "set-note") {
      editor.execCommand("SET_NODE_NOTE", node, normalizePanelText(payload.note, 4000));
    }
    if (command === "set-tags") {
      editor.execCommand("SET_NODE_TAG", node, normalizeTags(payload.tags));
    }
    if (command === "set-hyperlink") {
      editor.execCommand(
        "SET_NODE_HYPERLINK",
        node,
        normalizePanelText(payload.hyperlink, 600),
        normalizePanelText(payload.hyperlinkTitle, 80)
      );
    }
    if (command === "set-image") {
      const imageUrl = normalizePanelText(payload.imageUrl, 1200);
      editor.execCommand("SET_NODE_IMAGE", node, imageUrl ? {
        url: imageUrl,
        title: normalizePanelText(payload.imageTitle, 80),
        width: 220,
        height: 140,
        custom: false
      } : { url: null });
    }
    if (command === "set-marker" && (payload.markerType === "priority" || payload.markerType === "progress")) {
      editor.execCommand("SET_NODE_ICON", node, replaceMarker(data.icon, payload.markerType, payload.markerValue));
    }
    if (command === "toggle-expand") {
      editor.execCommand("SET_NODE_EXPAND", node, data.expand === false);
    }
  });
  editor.render?.();
}

function runCommand(editor: any, command: MindMapCommand, selectedNode: any = null, selectedNodeId: string | null = null, payload: MindMapCommandPayload = {}) {
  ensureStableRenderTreeNodeIds(editor);
  const activeNode = findCurrentRenderNode(editor, selectedNode, selectedNodeId);
  const childTarget = activeNode ?? editor.renderer?.root ?? null;
  const appointNodes = activeNode ? [activeNode] : [];
  const childAppointNodes = childTarget ? [childTarget] : [];
  switch (command) {
    case "insert-child":
      editor.execCommand("INSERT_CHILD_NODE", true, childAppointNodes);
      break;
    case "insert-sibling":
      editor.execCommand("INSERT_NODE", true, appointNodes);
      break;
    case "insert-parent":
      editor.execCommand("INSERT_PARENT_NODE", true, appointNodes);
      break;
    case "add-relationship":
      editor.associativeLine?.createLineFromActiveNode?.();
      break;
    case "add-boundary":
      editor.execCommand("ADD_OUTER_FRAME");
      break;
    case "add-summary":
      editor.execCommand("ADD_GENERALIZATION");
      break;
    case "toggle-expand":
    case "set-note":
    case "set-tags":
    case "set-hyperlink":
    case "set-image":
    case "set-marker":
      applyTopicElementCommand(editor, activeNode, command, payload);
      break;
    case "delete-node":
      editor.execCommand("REMOVE_CURRENT_NODE");
      break;
    case "undo":
      editor.execCommand("BACK");
      break;
    case "redo":
      editor.execCommand("FORWARD");
      break;
    case "fit":
      editor.view?.fit?.();
      break;
    case "reset-layout":
      editor.execCommand("RESET_LAYOUT");
      break;
    case "zoom-in":
      editor.view?.enlarge?.();
      break;
    case "zoom-out":
      editor.view?.narrow?.();
      break;
  }
}

async function exportEditorFile(editor: any, type: MindMapExportType, fileName: string) {
  if (!editor.doExport?.export) {
    throw new Error("导出组件尚未就绪");
  }

  if (type === "xmind") {
    await ensureXMindExportPlugin(editor);
  }

  await editor.doExport.export(type, true, fileName);
}

function applyLayout(editor: any, layout: MindMapLayoutType) {
  const nextLayout = normalizeLayout(layout);
  editor.setLayout(nextLayout);
  window.setTimeout(() => editor.view?.fit?.(), 0);
  return toSnapshot(editor);
}

function readNodeData(node: any) {
  if (node && typeof node.getData === "function") {
    return node.getData() as Record<string, unknown>;
  }
  return (node?.nodeData?.data ?? node?.data ?? {}) as Record<string, unknown>;
}

function readNodeStyleValue(node: any, key: keyof MindMapTextFormat) {
  const data = readNodeData(node);
  if (data[key] !== undefined) return data[key];
  if (node?.effectiveStyles?.[key] !== undefined) return node.effectiveStyles[key];
  if (typeof node?.style?.getStyle === "function") return node.style.getStyle(key);
  return undefined;
}

function normalizeTextFormat(node: any): MindMapTextFormat {
  const data = readNodeData(node);
  const fontWeight = readNodeStyleValue(node, "fontWeight");
  const fontStyle = readNodeStyleValue(node, "fontStyle");
  const textDecoration = readNodeStyleValue(node, "textDecoration");
  const color = readNodeStyleValue(node, "color");
  const fontSize = Number(readNodeStyleValue(node, "fontSize"));
  const fillColor = readNodeStyleValue(node, "fillColor");
  const borderColor = readNodeStyleValue(node, "borderColor");
  const borderWidth = Number(readNodeStyleValue(node, "borderWidth"));
  const customTextWidth = normalizeTextWrapWidth(data.customTextWidth);

  return {
    fontWeight: fontWeight === "bold" ? "bold" : "normal",
    fontStyle: fontStyle === "italic" ? "italic" : "normal",
    textDecoration: textDecoration === "underline" || textDecoration === "line-through" ? textDecoration : "none",
    color: typeof color === "string" && color ? color : "#17466f",
    fontSize: Number.isFinite(fontSize) && fontSize > 0 ? fontSize : MIND_MAP_DEFAULT_FONT_SIZE,
    textAutoWrapWidth: customTextWidth,
    fillColor: typeof fillColor === "string" && fillColor ? fillColor : "#ffffff",
    borderColor: typeof borderColor === "string" && borderColor ? borderColor : "#72a9d8",
    borderWidth: Number.isFinite(borderWidth) && borderWidth >= 0 ? borderWidth : 1
  };
}

function toSelectedNode(node: unknown): MindMapSelectedNode {
  const data = readNodeData(node);
  return {
    id: extractNodeId(node),
    title: extractNodeTitle(node),
    textFormat: normalizeTextFormat(node),
    topicElements: {
      note: typeof data.note === "string" ? data.note : "",
      tags: normalizeTags(data.tag),
      hyperlink: typeof data.hyperlink === "string" ? data.hyperlink : "",
      hyperlinkTitle: typeof data.hyperlinkTitle === "string" ? data.hyperlinkTitle : "",
      imageUrl: typeof data.image === "string" ? data.image : "",
      imageTitle: typeof data.imageTitle === "string" ? data.imageTitle : "",
      priority: readMarker(data.icon, "priority"),
      progress: readMarker(data.icon, "progress"),
      expanded: data.expand !== false
    }
  };
}

function hasPatchKey(patch: MindMapTextFormatPatch, key: keyof MindMapTextFormat) {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

function normalizeTextFormatPatch(patch: MindMapTextFormatPatch) {
  const next: Partial<Record<keyof MindMapTextFormat, string | number | undefined>> = {};

  if (hasPatchKey(patch, "fontWeight")) {
    next.fontWeight = patch.fontWeight === "bold" ? "bold" : "normal";
  }
  if (hasPatchKey(patch, "fontStyle")) {
    next.fontStyle = patch.fontStyle === "italic" ? "italic" : "normal";
  }
  if (hasPatchKey(patch, "textDecoration")) {
    next.textDecoration = patch.textDecoration === "underline" || patch.textDecoration === "line-through" ? patch.textDecoration : "none";
  }
  if (hasPatchKey(patch, "color")) {
    next.color = typeof patch.color === "string" && /^#[0-9a-f]{6}$/i.test(patch.color) ? patch.color : "#17466f";
  }
  if (hasPatchKey(patch, "fontSize")) {
    const fontSize = Number(patch.fontSize);
    next.fontSize = Number.isFinite(fontSize) ? Math.min(32, Math.max(11, Math.round(fontSize))) : MIND_MAP_DEFAULT_FONT_SIZE;
  }
  if (hasPatchKey(patch, "fillColor")) {
    next.fillColor = typeof patch.fillColor === "string" && /^#[0-9a-f]{6}$/i.test(patch.fillColor) ? patch.fillColor : "#ffffff";
  }
  if (hasPatchKey(patch, "borderColor")) {
    next.borderColor = typeof patch.borderColor === "string" && /^#[0-9a-f]{6}$/i.test(patch.borderColor) ? patch.borderColor : "#72a9d8";
  }
  if (hasPatchKey(patch, "borderWidth")) {
    const borderWidth = Number(patch.borderWidth);
    next.borderWidth = Number.isFinite(borderWidth) ? Math.min(6, Math.max(0, Math.round(borderWidth))) : 1;
  }

  return Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined && value !== null)) as Record<string, string | number>;
}

function normalizeTextWrapWidth(value: unknown) {
  const width = Number(value);
  if (!Number.isFinite(width) || width <= 0) return undefined;
  return Math.min(MAX_NODE_TEXT_WRAP_WIDTH, Math.max(MIN_NODE_TEXT_WRAP_WIDTH, Math.round(width)));
}

function applyLayoutSafeTextWidths(node: MindMapSnapshot["root"]): MindMapSnapshot["root"] {
  const data = { ...node.data } as Record<string, unknown>;
  const customTextWidth = normalizeTextWrapWidth(data.customTextWidth);
  if (customTextWidth === undefined) {
    delete data.customTextWidth;
  } else {
    data.customTextWidth = customTextWidth;
  }

  return {
    ...node,
    data: data as MindMapSnapshot["root"]["data"],
    children: Array.isArray(node.children) ? node.children.map(applyLayoutSafeTextWidths) : []
  };
}

function applyNodeTextWrapWidth(editor: any, node: any, width: number | undefined) {
  if (!node) return;
  if (typeof node.setData === "function") {
    node.setData({ customTextWidth: width });
  }

  const data = readNodeData(node);
  if (width === undefined) {
    delete data.customTextWidth;
  } else {
    data.customTextWidth = width;
  }

  node.customTextWidth = width;
  if (typeof node.reRender === "function") {
    node.reRender(["text"], { resetWidth: true });
  }
  if (typeof editor.render === "function") {
    editor.render();
  }
}

function applySelectedTextFormat(editor: any, patch: MindMapTextFormatPatch) {
  const activeNodes = Array.isArray(editor.renderer?.activeNodeList) ? editor.renderer.activeNodeList : [];
  if (activeNodes.length === 0) return null;

  const hasWidthPatch = hasPatchKey(patch, "textAutoWrapWidth");
  const textWrapWidth = hasWidthPatch ? normalizeTextWrapWidth(patch.textAutoWrapWidth) : undefined;
  const stylePatch = normalizeTextFormatPatch(patch);
  if (Object.keys(stylePatch).length === 0 && !hasWidthPatch) return toSelectedNode(activeNodes[0]);

  activeNodes.forEach((node: any) => {
    if (Object.keys(stylePatch).length > 0) {
      editor.execCommand("SET_NODE_STYLES", node, stylePatch);
    }
    if (hasWidthPatch) {
      applyNodeTextWrapWidth(editor, node, textWrapWidth);
    }
  });

  return toSelectedNode(activeNodes[0]);
}

function findNodeByCatalogPath(editor: any, nodeId: string) {
  const match = /^aistudy-node-(\d+(?:-\d+)*)$/.exec(nodeId);
  if (!match) return null;
  const path = match[1].split("-").map((item) => Number(item));
  if (path[0] !== 1) return null;

  let node = editor.renderer?.root ?? null;
  for (const order of path.slice(1)) {
    const children = Array.isArray(node?.children) ? node.children : [];
    node = children[order - 1] ?? null;
    if (!node) return null;
  }
  return node;
}

function activateNode(editor: any, node: any) {
  editor.renderer?.clearActiveNodeList?.();
  editor.renderer?.addNodeToActiveList?.(node, true);
  editor.renderer?.emitNodeActiveEvent?.(node);
  editor.renderer?.moveNodeToCenter?.(node, false);
}

function applyInitialReadableView(editor: any) {
  const root = editor.renderer?.root;
  if (!root) return;
  editor.view?.setScale?.(INITIAL_VIEW_SCALE);
  editor.renderer?.moveNodeToCenter?.(root, false);
  editor.scrollbar?.updateScrollbar?.();
}

function selectNodeById(editor: any, nodeId: string) {
  if (!nodeId) return null;
  const targetNode = editor.renderer?.findNodeByUid?.(nodeId) ?? findNodeByCatalogPath(editor, nodeId);
  if (targetNode) {
    activateNode(editor, targetNode);
    return toSelectedNode(targetNode);
  }

  editor.renderer?.goTargetNode?.(nodeId);
  return null;
}

function shouldSyncAfterCommand(command: MindMapCommand) {
  return !["fit", "zoom-in", "zoom-out"].includes(command);
}

function clampPercent(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function roundViewportPercent(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeViewportState(data: unknown): MindMapViewportState {
  const vertical = (data as { vertical?: { top?: unknown; height?: unknown } } | null)?.vertical;
  const horizontal = (data as { horizontal?: { left?: unknown; width?: unknown } } | null)?.horizontal;
  const verticalSize = roundViewportPercent(clampPercent(Number(vertical?.height ?? 100)));
  const horizontalSize = roundViewportPercent(clampPercent(Number(horizontal?.width ?? 100)));

  return {
    vertical: {
      position: roundViewportPercent(clampPercent(Number(vertical?.top ?? 0), 0, Math.max(0, 100 - verticalSize))),
      size: verticalSize,
      enabled: verticalSize < 99.5
    },
    horizontal: {
      position: roundViewportPercent(clampPercent(Number(horizontal?.left ?? 0), 0, Math.max(0, 100 - horizontalSize))),
      size: horizontalSize,
      enabled: horizontalSize < 99.5
    }
  };
}

function calculateViewportState(editor: any): MindMapViewportState {
  try {
    return normalizeViewportState(editor.scrollbar?.calculationScrollbar?.());
  } catch {
    return EMPTY_MIND_MAP_VIEWPORT_STATE;
  }
}

function installDotGrid(editor: any) {
  const svg = (editor.svg?.node ?? null) as SVGSVGElement | null;
  if (!svg || svg.querySelector(`#${DOT_GRID_PATTERN_ID}`)) return;

  const defs = document.createElementNS(SVG_NS, "defs");
  const pattern = document.createElementNS(SVG_NS, "pattern");
  pattern.setAttribute("id", DOT_GRID_PATTERN_ID);
  pattern.setAttribute("width", "16");
  pattern.setAttribute("height", "16");
  pattern.setAttribute("patternUnits", "userSpaceOnUse");

  const dot = document.createElementNS(SVG_NS, "circle");
  dot.setAttribute("cx", "1");
  dot.setAttribute("cy", "1");
  dot.setAttribute("r", "1.15");
  dot.setAttribute("fill", "#c8d0da");
  pattern.appendChild(dot);
  defs.appendChild(pattern);

  const background = document.createElementNS(SVG_NS, "rect");
  background.setAttribute("class", "aistudy-dot-grid-background");
  background.setAttribute("width", "100%");
  background.setAttribute("height", "100%");
  background.setAttribute("fill", `url(#${DOT_GRID_PATTERN_ID})`);
  background.setAttribute("pointer-events", "none");

  const firstChild = svg.firstChild;
  svg.insertBefore(defs, firstChild);
  svg.insertBefore(background, defs.nextSibling);
}

export async function createSimpleMindMapEditor(
  el: HTMLElement,
  snapshot: MindMapSnapshot,
  events: MindMapEditorEvents,
  options: MindMapEditorOptions = {}
): Promise<MindMapEditorHandle> {
  const MindMap = await loadSimpleMindMap();
  const layout = normalizeLayout(snapshot.layout);
  const isCanvasDragEnabled = options.canvasDragEnabled === true;
  const editor = new MindMap({
    el,
    data: snapshot.root,
    layout,
    theme: snapshot.theme?.template ?? "default",
    themeConfig: createXMindStyleThemeConfig(),
    viewData: snapshot.view,
    fit: false,
    enableShortcutOnlyWhenMouseInSvg: true,
    isDisableDrag: !isCanvasDragEnabled,
    useLeftKeySelectionRightKeyDrag: !isCanvasDragEnabled,
    openPerformance: false,
    performanceConfig: {
      time: 0,
      padding: 0,
      removeNodeWhenOutCanvas: false
    },
    maxHistoryCount: 40,
    textAutoWrapWidth: DEFAULT_NODE_TEXT_WRAP_WIDTH,
    minNodeTextModifyWidth: MIN_NODE_TEXT_WRAP_WIDTH,
    maxNodeTextModifyWidth: MAX_NODE_TEXT_WRAP_WIDTH,
    openRealtimeRenderOnNodeTextEdit: false,
    isLimitMindMapInCanvas: false,
    isLimitMindMapInCanvasWhenHasScrollbar: false,
    enableFreeDrag: false,
    defaultInsertSecondLevelNodeText: "新主题",
    defaultInsertBelowSecondLevelNodeText: "新主题",
    defaultAssociativeLineText: "关系",
    defaultOuterFrameText: "边界",
    errorHandler: (_code: unknown, error: unknown) => {
      events.onError?.(error instanceof Error ? error.message : "导图编辑器异常");
    }
  });
  installDotGrid(editor);

  let destroyed = false;
  let acceptSnapshotEvents = false;
  const snapshotEventTimer = window.setTimeout(() => {
    acceptSnapshotEvents = true;
  }, 300);
  let snapshotSyncTimer: number | null = null;
  let snapshotSyncFrame: number | null = null;
  let viewportSyncFrame: number | null = null;
  const viewportControlSize = {
    width: Math.max(1, el.clientWidth),
    height: Math.max(1, el.clientHeight)
  };

  const emitViewportState = (state: MindMapViewportState = calculateViewportState(editor)) => {
    if (!destroyed) {
      events.onViewportChanged?.(state);
    }
  };

  const emitPluginViewportState = (data: unknown) => {
    emitViewportState(normalizeViewportState(data));
  };

  const scheduleViewportSync = () => {
    if (viewportSyncFrame !== null) {
      window.cancelAnimationFrame(viewportSyncFrame);
    }
    viewportSyncFrame = window.requestAnimationFrame(() => {
      viewportSyncFrame = null;
      emitViewportState();
    });
  };

  const setScrollbarWrapSize = (width: number, height: number) => {
    viewportControlSize.width = Math.max(1, width);
    viewportControlSize.height = Math.max(1, height);
    editor.scrollbar?.setScrollBarWrapSize?.(viewportControlSize.width, viewportControlSize.height);
    editor.scrollbar?.updateScrollbar?.();
    scheduleViewportSync();
  };

  const setCanvasDragEnabled = (enabled: boolean) => {
    editor.opt.isDisableDrag = !enabled;
    // Off: left drag is reserved for rectangle selection. On: left drag pans canvas.
    editor.opt.useLeftKeySelectionRightKeyDrag = !enabled;
    scheduleViewportSync();
  };

  const scheduleSnapshotSync = (delayMs = 180) => {
    if (!acceptSnapshotEvents) return;
    if (snapshotSyncTimer !== null) {
      window.clearTimeout(snapshotSyncTimer);
    }
    snapshotSyncTimer = window.setTimeout(() => {
      snapshotSyncTimer = null;
      if (snapshotSyncFrame !== null) {
        window.cancelAnimationFrame(snapshotSyncFrame);
      }
      snapshotSyncFrame = window.requestAnimationFrame(() => {
        snapshotSyncFrame = null;
        if (!destroyed) {
          events.onSnapshotChanged?.(toSnapshot(editor));
        }
      });
    }, delayMs);
  };

  const emitSnapshot = () => scheduleSnapshotSync();

  let selectedRenderNode: any = null;
  let selectedNodeId: string | null = null;
  let editingTextNode: any = null;

  const setNodeTextOpacity = (node: any, opacity: number) => {
    node?._textData?.node?.opacity?.(opacity);
  };

  const hideEditingNodeText = () => {
    const currentEditNode = editor.renderer?.textEdit?.getCurrentEditNode?.();
    editingTextNode = currentEditNode ?? editingTextNode;
    setNodeTextOpacity(editingTextNode, 0);
  };

  const rerenderEditedNodeText = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.reRender === "function") {
      node.reRender(["text"], { resetWidth: true });
    } else if (typeof node.layout === "function") {
      node.layout();
    }
  };

  const restoreEditingNodeText = (node?: unknown) => {
    const targetNode = node && typeof node === "object" ? node : editingTextNode;
    setNodeTextOpacity(targetNode, 1);
    rerenderEditedNodeText(targetNode);
    editingTextNode = null;
  };

  const syncAfterTextEdit = (_textEditNode?: unknown, _activeNodeList?: unknown, node?: unknown) => {
    restoreEditingNodeText(node);
    if (typeof editor.render === "function") {
      editor.render();
    }
    ensureStableRenderTreeNodeIds(editor);
    syncSelectionFromActiveList();
    scheduleViewportSync();
    scheduleSnapshotSync(0);
  };

  const applyTextEditPreview = ({ node, text }: { node?: unknown; text?: unknown }) => {
    if (destroyed) return;
    if (!node || typeof node !== "object" || typeof text !== "string") return;
    const previewNode = node as any;
    const currentEditNode = editor.renderer?.textEdit?.getCurrentEditNode?.();
    if (currentEditNode && currentEditNode !== previewNode) return;
    if (typeof previewNode.createTextNode !== "function" || typeof previewNode.getNodeRect !== "function") return;

    previewNode._textData = previewNode.createTextNode(text);
    const rect = previewNode.getNodeRect();
    previewNode.width = rect.width;
    previewNode.height = rect.height;
    previewNode.layout?.();
    editingTextNode = previewNode;
    hideEditingNodeText();
    scheduleViewportSync();
  };

  const emitSelection = (node: unknown) => {
    const selectedNode = toSelectedNode(node);
    selectedNodeId = selectedNode.id;
    events.onNodeSelected?.(selectedNode);
  };

  editor.on("data_change", emitSnapshot);
  editor.on("layout_change", emitSnapshot);
  editor.on("scrollbar_change", emitPluginViewportState);
  const emitSelectionWithCache = (node: unknown, activeNodeList?: unknown) => {
    ensureStableRenderTreeNodeIds(editor);
    const activeNode = readActiveNodeFromEvent(editor, node, activeNodeList);
    selectedRenderNode = activeNode && typeof activeNode === "object" ? activeNode : null;
    emitSelection(activeNode);
  };
  const syncSelectionFromActiveList = () => {
    ensureStableRenderTreeNodeIds(editor);
    const activeNodes = Array.isArray(editor.renderer?.activeNodeList) ? editor.renderer.activeNodeList : [];
    const activeNode = activeNodes[0] ?? null;
    if (!activeNode) return;
    selectedRenderNode = activeNode;
    emitSelection(activeNode);
    scheduleViewportSync();
  };
  const syncAfterNodeDrag = () => {
    scheduleViewportSync();
    scheduleSnapshotSync(0);
  };
  editor.on("node_active", emitSelectionWithCache);
  editor.on("node_tree_render_end", syncSelectionFromActiveList);
  editor.on("node_text_edit_change", applyTextEditPreview);
  editor.on("before_show_text_edit", hideEditingNodeText);
  editor.on("hide_text_edit", syncAfterTextEdit);
  editor.on("node_dragend", syncAfterNodeDrag);
  setScrollbarWrapSize(el.clientWidth, el.clientHeight);
  events.onReady?.();
  ensureStableRenderTreeNodeIds(editor);
  if (editor.renderer?.root) {
    selectedRenderNode = editor.renderer.root;
    applyInitialReadableView(editor);
    activateNode(editor, editor.renderer.root);
    emitSelection(editor.renderer.root);
  }

  return {
    getSnapshot: () => (destroyed ? null : toSnapshot(editor)),
    setSnapshot: (nextSnapshot) => {
      if (destroyed) return;
      editor.setFullData(toEditorData(nextSnapshot));
      ensureStableRenderTreeNodeIds(editor);
      editor.scrollbar?.updateScrollbar?.();
      scheduleViewportSync();
    },
    selectNode: (nodeId) => {
      if (destroyed) return null;
      const nextNode = selectNodeById(editor, nodeId);
      const activeNodes = Array.isArray(editor.renderer?.activeNodeList) ? editor.renderer.activeNodeList : [];
      selectedRenderNode = activeNodes[0] ?? selectedRenderNode;
      selectedNodeId = nodeId;
      return nextNode;
    },
    setLayout: (layout) => {
      if (destroyed) return null;
      const nextSnapshot = applyLayout(editor, layout);
      scheduleViewportSync();
      return nextSnapshot;
    },
    applyTextFormat: (patch) => {
      if (destroyed) return null;
      return applySelectedTextFormat(editor, patch);
    },
    exec: (command, payload) => {
      if (destroyed) return;
      runCommand(editor, command, selectedRenderNode, selectedNodeId, payload);
      if (shouldSyncAfterCommand(command)) {
        window.setTimeout(() => {
          if (!destroyed) {
            ensureStableRenderTreeNodeIds(editor);
            syncSelectionFromActiveList();
            scheduleSnapshotSync(0);
          }
        }, 0);
      } else {
        scheduleViewportSync();
      }
    },
    exportFile: async (type, fileName) => {
      if (destroyed) return;
      await exportEditorFile(editor, type, fileName);
    },
    setCanvasDragEnabled: (enabled) => {
      if (destroyed) return;
      setCanvasDragEnabled(enabled);
    },
    resize: () => {
      if (destroyed) return;
      editor.resize();
      setScrollbarWrapSize(el.clientWidth, el.clientHeight);
      editor.scrollbar?.updateScrollbar?.();
    },
    setViewportControlSize: (width, height) => {
      if (destroyed) return;
      setScrollbarWrapSize(width, height);
    },
    scrollViewport: (axis: MindMapViewportAxis, position: number) => {
      if (destroyed) return;
      const state = calculateViewportState(editor);
      const axisState = axis === "vertical" ? state.vertical : state.horizontal;
      const maxPosition = Math.max(0, 100 - axisState.size);
      const wrapSize = axis === "vertical" ? viewportControlSize.height : viewportControlSize.width;
      editor.scrollbar?.updateMindMapView?.(axis, (clampPercent(position, 0, maxPosition) / 100) * wrapSize);
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      window.clearTimeout(snapshotEventTimer);
      if (snapshotSyncTimer !== null) {
        window.clearTimeout(snapshotSyncTimer);
        snapshotSyncTimer = null;
      }
      if (snapshotSyncFrame !== null) {
        window.cancelAnimationFrame(snapshotSyncFrame);
        snapshotSyncFrame = null;
      }
      if (viewportSyncFrame !== null) {
        window.cancelAnimationFrame(viewportSyncFrame);
        viewportSyncFrame = null;
      }
      editor.off("data_change", emitSnapshot);
      editor.off("layout_change", emitSnapshot);
      editor.off("scrollbar_change", emitPluginViewportState);
      editor.off("node_active", emitSelectionWithCache);
      editor.off("node_tree_render_end", syncSelectionFromActiveList);
      editor.off("node_text_edit_change", applyTextEditPreview);
      editor.off("before_show_text_edit", hideEditingNodeText);
      editor.off("hide_text_edit", syncAfterTextEdit);
      editor.off("node_dragend", syncAfterNodeDrag);
      restoreEditingNodeText();
      editor.destroy();
    }
  };
}
