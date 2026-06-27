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
const MIN_NODE_BUBBLE_WIDTH = 72;
const MIN_NODE_BUBBLE_HEIGHT = 30;
const MAX_NODE_BUBBLE_WIDTH = 960;
const MAX_NODE_BUBBLE_HEIGHT = 520;
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
    root: applyLayoutSafeNodeDimensions(normalizeMindMapTree(snapshot.root)),
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
    root: applyLayoutSafeNodeDimensions(normalizeMindMapTree(root)),
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

function normalizeBubbleDimension(value: unknown, min: number, max: number) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return undefined;
  return Math.min(max, Math.max(min, Math.round(size)));
}

function normalizeBubbleWidth(value: unknown) {
  return normalizeBubbleDimension(value, MIN_NODE_BUBBLE_WIDTH, MAX_NODE_BUBBLE_WIDTH);
}

function normalizeBubbleHeight(value: unknown) {
  return normalizeBubbleDimension(value, MIN_NODE_BUBBLE_HEIGHT, MAX_NODE_BUBBLE_HEIGHT);
}

function readNodeBubbleSize(data: Record<string, unknown>) {
  return {
    width: normalizeBubbleWidth(data.customBubbleWidth),
    height: normalizeBubbleHeight(data.customBubbleHeight)
  };
}

function applyLayoutSafeNodeDimensions(node: MindMapSnapshot["root"]): MindMapSnapshot["root"] {
  const data = { ...node.data } as Record<string, unknown>;
  const customTextWidth = normalizeTextWrapWidth(data.customTextWidth);
  if (customTextWidth === undefined) {
    delete data.customTextWidth;
  } else {
    data.customTextWidth = customTextWidth;
  }
  const customBubbleWidth = normalizeBubbleWidth(data.customBubbleWidth);
  if (customBubbleWidth === undefined) {
    delete data.customBubbleWidth;
  } else {
    data.customBubbleWidth = customBubbleWidth;
  }
  const customBubbleHeight = normalizeBubbleHeight(data.customBubbleHeight);
  if (customBubbleHeight === undefined) {
    delete data.customBubbleHeight;
  } else {
    data.customBubbleHeight = customBubbleHeight;
  }

  return {
    ...node,
    data: data as MindMapSnapshot["root"]["data"],
    children: Array.isArray(node.children) ? node.children.map(applyLayoutSafeNodeDimensions) : []
  };
}

function treeHasCustomNodeLayout(node: MindMapSnapshot["root"] | null | undefined): boolean {
  if (!node) return false;
  const data = node.data as Record<string, unknown> | undefined;
  if (normalizeTextWrapWidth(data?.customTextWidth) !== undefined) return true;
  if (normalizeBubbleWidth(data?.customBubbleWidth) !== undefined) return true;
  if (normalizeBubbleHeight(data?.customBubbleHeight) !== undefined) return true;
  return Array.isArray(node.children) && node.children.some(treeHasCustomNodeLayout);
}

function applyNodeTextWrapWidth(editor: any, node: any, width: number | undefined, options: { renderTree?: boolean } = {}) {
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
  if (options.renderTree !== false && typeof editor.render === "function") {
    editor.render();
  }
}

function applyNodeBubbleWidth(
  editor: any,
  node: any,
  width: number | undefined,
  options: { renderTree?: boolean; persist?: boolean } = {}
) {
  if (!node) return;
  const naturalWidth = normalizeBubbleWidth(node?.__aistudyNaturalNodeRect?.width);
  const normalizedWidth = normalizeBubbleWidth(width);
  const nextWidth =
    normalizedWidth !== undefined && naturalWidth !== undefined && normalizedWidth <= naturalWidth + 1
      ? undefined
      : normalizedWidth;

  const data = readNodeData(node);
  if (nextWidth === undefined) {
    delete data.customBubbleWidth;
  } else {
    data.customBubbleWidth = nextWidth;
  }

  node.customBubbleWidth = nextWidth;

  if (options.persist !== false && typeof node.setData === "function") {
    node.setData({ customBubbleWidth: nextWidth });
  }
  if (typeof node.reRender === "function") {
    node.reRender([], { resetWidth: false });
  } else if (typeof node.layout === "function") {
    node.layout();
  }
  if (options.renderTree !== false && typeof editor.render === "function") {
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

function installPerNodeTextWrapWidthSupport(editor: any) {
  const root = editor.renderer?.root;
  const proto = root && typeof root === "object" ? Object.getPrototypeOf(root) : null;
  if (!proto || proto.__aistudyPerNodeTextWrapWidth) return;
  const originalCreateTextNode = proto.createTextNode;
  if (typeof originalCreateTextNode !== "function") return;

  Object.defineProperty(proto, "__aistudyPerNodeTextWrapWidth", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
  proto.createTextNode = function createTextNodeWithCustomWrapWidth(this: any, specifyText?: unknown) {
    const customTextWidth = normalizeTextWrapWidth(this?.getData?.("customTextWidth"));
    if (customTextWidth === undefined || !this?.mindMap?.opt) {
      return originalCreateTextNode.call(this, specifyText);
    }

    const previousWidth = this.mindMap.opt.textAutoWrapWidth;
    this.mindMap.opt.textAutoWrapWidth = customTextWidth;
    try {
      return originalCreateTextNode.call(this, specifyText);
    } finally {
      this.mindMap.opt.textAutoWrapWidth = previousWidth;
    }
  };
}

function installBubbleSizeSupport(editor: any) {
  const root = editor.renderer?.root;
  const proto = root && typeof root === "object" ? Object.getPrototypeOf(root) : null;
  if (!proto || proto.__aistudyBubbleSizeSupport) return;
  const originalGetNodeRect = proto.getNodeRect;
  if (typeof originalGetNodeRect !== "function") return;

  Object.defineProperty(proto, "__aistudyBubbleSizeSupport", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
  proto.getNodeRect = function getNodeRectWithBubbleSize(this: any) {
    const rect = originalGetNodeRect.call(this);
    const data = readNodeData(this);
    const bubbleSize = readNodeBubbleSize(data);
    const runtimeBubbleWidth = bubbleSize.width ?? normalizeBubbleWidth(this?.customBubbleWidth);
    const naturalWidth = Number(rect?.width);
    const naturalHeight = Number(rect?.height);
    const safeNaturalWidth = Number.isFinite(naturalWidth) && naturalWidth > 0 ? naturalWidth : MIN_NODE_BUBBLE_WIDTH;
    const safeNaturalHeight = Number.isFinite(naturalHeight) && naturalHeight > 0 ? naturalHeight : MIN_NODE_BUBBLE_HEIGHT;
    const width = runtimeBubbleWidth === undefined ? safeNaturalWidth : Math.max(safeNaturalWidth, runtimeBubbleWidth);
    const height = bubbleSize.height === undefined ? safeNaturalHeight : Math.max(safeNaturalHeight, bubbleSize.height);
    const extraX = Math.max(0, width - safeNaturalWidth) / 2;
    const extraY = Math.max(0, height - safeNaturalHeight) / 2;

    this.__aistudyNaturalNodeRect = {
      width: safeNaturalWidth,
      height: safeNaturalHeight
    };
    this.__aistudyBubbleSize = {
      width,
      height
    };

    if (this.shapePadding && typeof this.shapePadding === "object") {
      this.shapePadding.paddingX = Number(this.shapePadding.paddingX || 0) + extraX;
      this.shapePadding.paddingY = Number(this.shapePadding.paddingY || 0) + extraY;
    }

    return {
      ...rect,
      width,
      height
    };
  };
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
    enableDragModifyNodeWidth: false,
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
  const installRuntimeNodeExtensions = () => {
    installPerNodeTextWrapWidthSupport(editor);
    installBubbleSizeSupport(editor);
  };
  installRuntimeNodeExtensions();
  if (treeHasCustomNodeLayout(snapshot.root)) {
    editor.render?.();
  }

  let destroyed = false;
  let acceptSnapshotEvents = false;
  const snapshotEventTimer = window.setTimeout(() => {
    acceptSnapshotEvents = true;
  }, 300);
  let snapshotSyncTimer: number | null = null;
  let snapshotSyncFrame: number | null = null;
  let viewportSyncFrame: number | null = null;
  let textEditPositionSyncFrame: number | null = null;
  const scheduleNodeResizeHandleSync = () => {};
  const viewportControlSize = {
    width: Math.max(1, el.clientWidth),
    height: Math.max(1, el.clientHeight)
  };

  const syncTextEditPositionNow = () => {
    const textEdit = editor.renderer?.textEdit;
    if (!textEdit?.isShowTextEdit?.()) return;
    const editElement = textEdit.textEditNode as HTMLElement | null | undefined;
    const node = textEdit.getCurrentEditNode?.() ?? textEdit.currentNode;
    if (!editElement || !node) return;

    textEdit.updateTextEditNode?.();

    const textElement = node?._textData?.node?.node as Element | null | undefined;
    const textRect = textElement?.getBoundingClientRect?.();
    if (!textRect || textRect.width <= 0 || textRect.height <= 0) return;

    const bubbleRect = getNodeBubbleScreenRect(node);
    const scale = getEditorScale();
    const paddingX = Number(textEdit.textNodePaddingX ?? 5);
    const paddingY = Number(textEdit.textNodePaddingY ?? 3);
    const wrapWidth = Math.max(
      MIN_NODE_TEXT_WRAP_WIDTH * scale,
      Number(editor.opt?.textAutoWrapWidth ?? DEFAULT_NODE_TEXT_WRAP_WIDTH) * scale
    );
    const stableTextWidth = Math.min(
      wrapWidth,
      Math.max(textRect.width, MIN_NODE_TEXT_WRAP_WIDTH * scale)
    );
    const contentWidth = Math.ceil(Math.max(stableTextWidth, bubbleRect?.width ?? 0));
    const textAlign = `${editElement.style.textAlign || node?.style?.merge?.("textAlign") || "center"}`.toLowerCase();
    const anchorRect = bubbleRect ?? textRect;
    const contentLeft =
      textAlign === "left" || textAlign === "start"
        ? anchorRect.left
        : textAlign === "right" || textAlign === "end"
          ? anchorRect.right - contentWidth
          : anchorRect.left + (anchorRect.width - contentWidth) / 2;
    const editWidth = Math.max(1, contentWidth + paddingX * 2);
    const editHeight = Math.max(1, textRect.height + paddingY * 2);

    editElement.style.left = `${Math.floor(contentLeft)}px`;
    editElement.style.top = `${Math.floor(textRect.top)}px`;
    editElement.style.width = `${Math.ceil(editWidth)}px`;
    editElement.style.minWidth = `${Math.ceil(editWidth)}px`;
    editElement.style.maxWidth = `${Math.ceil(editWidth)}px`;
    editElement.style.minHeight = `${Math.ceil(editHeight)}px`;
  };

  const scheduleTextEditPositionSync = () => {
    if (textEditPositionSyncFrame !== null) return;
    textEditPositionSyncFrame = window.requestAnimationFrame(() => {
      textEditPositionSyncFrame = null;
      if (!destroyed) {
        syncTextEditPositionNow();
      }
    });
  };

  const emitViewportState = (state: MindMapViewportState = calculateViewportState(editor)) => {
    if (!destroyed) {
      events.onViewportChanged?.(state);
    }
  };

  const emitPluginViewportState = (data: unknown) => {
    scheduleNodeResizeHandleSync();
    emitViewportState(normalizeViewportState(data));
  };

  const scheduleViewportSync = () => {
    if (viewportSyncFrame !== null) {
      window.cancelAnimationFrame(viewportSyncFrame);
    }
    viewportSyncFrame = window.requestAnimationFrame(() => {
      viewportSyncFrame = null;
      scheduleTextEditPositionSync();
      scheduleNodeResizeHandleSync();
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

  const emitSnapshot = () => {
    scheduleNodeResizeHandleSync();
    scheduleSnapshotSync();
  };

  let selectedRenderNode: any = null;
  let selectedNodeId: string | null = null;
  let editingTextNode: any = null;
  let bubbleResizeEdgeCursorActive = false;
  let nodeResizeDragState: {
    node: any;
    startClientX: number;
    startWidth: number;
    naturalMinWidth: number;
    nextWidth: number;
    lastAppliedWidth: number;
    frame: number | null;
  } | null = null;

  const getEditorScale = () => {
    const transform = editor.draw?.transform?.();
    const scale = Number(transform?.scaleX ?? transform?.scaleY ?? 1);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  };

  const getSingleActiveNodeForResize = () => {
    const activeNodes = Array.isArray(editor.renderer?.activeNodeList) ? editor.renderer.activeNodeList : [];
    if (activeNodes.length > 1) return null;
    return activeNodes[0] ?? selectedRenderNode ?? null;
  };

  const getNodeBubbleScreenRect = (node: any) => {
    const element =
      node?.shapeNode?.node ??
      node?._customNodeContent ??
      node?._textData?.node?.node ??
      node?.group?.node ??
      null;
    const rect = element && typeof element.getBoundingClientRect === "function" ? element.getBoundingClientRect() : null;
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return rect;
  };

  const getNodeNaturalBubbleWidth = (node: any) => {
    return normalizeBubbleWidth(node?.__aistudyNaturalNodeRect?.width) ?? MIN_NODE_BUBBLE_WIDTH;
  };

  const getNodeResizeStartWidth = (node: any) => {
    const customWidth = normalizeBubbleWidth(readNodeData(node).customBubbleWidth);
    if (customWidth !== undefined) return customWidth;
    const screenRect = getNodeBubbleScreenRect(node);
    const measuredWidth = screenRect ? screenRect.width / getEditorScale() : Number(node?.width);
    return normalizeBubbleWidth(measuredWidth) ?? getNodeNaturalBubbleWidth(node);
  };

  const getNodeFromRightBubbleResizeEdge = (event: MouseEvent | PointerEvent) => {
    if (nodeResizeDragState) return nodeResizeDragState.node;
    const textEdit = editor.renderer?.textEdit;
    if (textEdit?.isShowTextEdit?.()) return null;
    const node = getSingleActiveNodeForResize();
    if (!node) return null;
    const rect = getNodeBubbleScreenRect(node);
    if (!rect) return null;
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const isInsideVerticalBand = y >= rect.top - 6 && y <= rect.bottom + 6;
    const isOnRightEdge = x >= rect.right - 8 && x <= rect.right + 4;
    return isInsideVerticalBand && isOnRightEdge ? node : null;
  };

  const setBubbleResizeEdgeCursor = (enabled: boolean) => {
    const target = (editor.svg?.node ?? el) as HTMLElement | SVGSVGElement | null;
    if (!target) return;
    if (enabled) {
      target.style.cursor = "ew-resize";
      bubbleResizeEdgeCursorActive = true;
    } else if (bubbleResizeEdgeCursorActive) {
      target.style.cursor = "";
      bubbleResizeEdgeCursorActive = false;
    }
  };

  const applyPendingNodeResizeWidth = () => {
    const state = nodeResizeDragState;
    if (!state) return;
    state.frame = null;
    if (state.nextWidth === state.lastAppliedWidth) return;
    state.lastAppliedWidth = state.nextWidth;
    applyNodeBubbleWidth(editor, state.node, state.nextWidth, { renderTree: false, persist: false });
    scheduleNodeResizeHandleSync();
  };

  const updateNodeResizeWidthFromClientX = (
    state: NonNullable<typeof nodeResizeDragState>,
    clientX: number
  ) => {
    const deltaX = (clientX - state.startClientX) / getEditorScale();
    const normalizedWidth = normalizeBubbleWidth(state.startWidth + deltaX) ?? state.startWidth;
    const nextWidth = Math.max(state.naturalMinWidth, normalizedWidth);
    if (nextWidth === state.nextWidth) return false;
    state.nextWidth = nextWidth;
    return true;
  };

  const detachNodeResizeDragListeners = () => {
    window.removeEventListener("pointermove", handleNodeResizePointerMove, true);
    window.removeEventListener("pointerup", finishNodeResizeDrag, true);
    window.removeEventListener("pointercancel", finishNodeResizeDrag, true);
    window.removeEventListener("mousemove", handleNodeResizePointerMove, true);
    window.removeEventListener("mouseup", finishNodeResizeDrag, true);
  };

  function finishNodeResizeDrag(event?: PointerEvent | MouseEvent) {
    const state = nodeResizeDragState;
    if (!state) return;
    event?.preventDefault();
    event?.stopPropagation();
    detachNodeResizeDragListeners();
    if (event && Number.isFinite(event.clientX)) {
      updateNodeResizeWidthFromClientX(state, event.clientX);
    }
    if (state.frame !== null) {
      window.cancelAnimationFrame(state.frame);
      state.frame = null;
    }
    if (state.nextWidth !== state.lastAppliedWidth) {
      state.lastAppliedWidth = state.nextWidth;
      applyNodeBubbleWidth(editor, state.node, state.nextWidth, { renderTree: false, persist: false });
    }
    applyNodeBubbleWidth(editor, state.node, state.nextWidth, { renderTree: false });
    nodeResizeDragState = null;
    setBubbleResizeEdgeCursor(false);
    editor.render?.();
    ensureStableRenderTreeNodeIds(editor);
    syncSelectionFromActiveList();
    scheduleViewportSync();
    scheduleSnapshotSync(0);
    scheduleNodeResizeHandleSync();
  }

  function handleNodeResizePointerMove(event: PointerEvent | MouseEvent) {
    const state = nodeResizeDragState;
    if (!state) return;
    event.preventDefault();
    event.stopPropagation();
    if (!updateNodeResizeWidthFromClientX(state, event.clientX)) return;
    if (state.frame !== null) return;
    state.frame = window.requestAnimationFrame(applyPendingNodeResizeWidth);
  }

  const startNodeResizeDrag = (event: PointerEvent | MouseEvent, nodeOverride?: any) => {
    if (nodeResizeDragState) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.button !== 0) return;
    const node = nodeOverride ?? getSingleActiveNodeForResize();
    if (!node) return;
    event.preventDefault();
    event.stopPropagation();
    const startWidth = getNodeResizeStartWidth(node);
    const naturalMinWidth = getNodeNaturalBubbleWidth(node);
    nodeResizeDragState = {
      node,
      startClientX: event.clientX,
      startWidth,
      naturalMinWidth,
      nextWidth: startWidth,
      lastAppliedWidth: startWidth,
      frame: null
    };
    window.addEventListener("pointermove", handleNodeResizePointerMove, true);
    window.addEventListener("pointerup", finishNodeResizeDrag, true);
    window.addEventListener("pointercancel", finishNodeResizeDrag, true);
    window.addEventListener("mousemove", handleNodeResizePointerMove, true);
    window.addEventListener("mouseup", finishNodeResizeDrag, true);
  };

  const handleBubbleResizeEdgeMouseMove = (event: Event) => {
    if (destroyed) return;
    if (!(event instanceof MouseEvent)) return;
    setBubbleResizeEdgeCursor(Boolean(getNodeFromRightBubbleResizeEdge(event)));
  };

  const handleBubbleResizeEdgeMouseLeave = () => {
    if (!nodeResizeDragState) {
      setBubbleResizeEdgeCursor(false);
    }
  };

  const handleBubbleResizeEdgeMouseDown = (event: Event) => {
    if (!(event instanceof MouseEvent)) return;
    const node = getNodeFromRightBubbleResizeEdge(event);
    if (!node) return;
    startNodeResizeDrag(event, node);
  };

  const setNodeTextOpacity = (node: any, opacity: number) => {
    node?._textData?.node?.opacity?.(opacity);
  };

  const hideEditingNodeText = () => {
    setBubbleResizeEdgeCursor(false);
    const currentEditNode = editor.renderer?.textEdit?.getCurrentEditNode?.();
    editingTextNode = currentEditNode ?? editingTextNode;
    setNodeTextOpacity(editingTextNode, 0);
    scheduleTextEditPositionSync();
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

  const emitSelection = (node: unknown) => {
    const selectedNode = toSelectedNode(node);
    selectedNodeId = selectedNode.id;
    events.onNodeSelected?.(selectedNode);
  };

  function syncAfterCanvasTranslate() {
    scheduleTextEditPositionSync();
    scheduleNodeResizeHandleSync();
  }

  editor.on("data_change", emitSnapshot);
  editor.on("layout_change", emitSnapshot);
  editor.on("translate", syncAfterCanvasTranslate);
  editor.on("scrollbar_change", emitPluginViewportState);
  const emitSelectionWithCache = (node: unknown, activeNodeList?: unknown) => {
    installRuntimeNodeExtensions();
    ensureStableRenderTreeNodeIds(editor);
    const activeNode = readActiveNodeFromEvent(editor, node, activeNodeList);
    selectedRenderNode = activeNode && typeof activeNode === "object" ? activeNode : null;
    emitSelection(activeNode);
    scheduleNodeResizeHandleSync();
  };
  const syncSelectionFromActiveList = () => {
    installRuntimeNodeExtensions();
    ensureStableRenderTreeNodeIds(editor);
    const activeNodes = Array.isArray(editor.renderer?.activeNodeList) ? editor.renderer.activeNodeList : [];
    const activeNode = activeNodes[0] ?? null;
    if (!activeNode) {
      selectedRenderNode = null;
      setBubbleResizeEdgeCursor(false);
      return;
    }
    selectedRenderNode = activeNode;
    emitSelection(activeNode);
    scheduleViewportSync();
  };
  const syncAfterNodeDrag = () => {
    scheduleViewportSync();
    scheduleSnapshotSync(0);
  };
  const syncTextEditBeforeImeEvent = (event: Event) => {
    const textEditNode = editor.renderer?.textEdit?.textEditNode;
    const eventTarget = event.target;
    if (!textEditNode || !(eventTarget instanceof Node) || !textEditNode.contains(eventTarget)) return;
    syncTextEditPositionNow();
    scheduleTextEditPositionSync();
  };
  const bubbleResizeEdgeTarget = (editor.svg?.node ?? el) as HTMLElement | SVGSVGElement;
  bubbleResizeEdgeTarget.addEventListener("mousemove", handleBubbleResizeEdgeMouseMove, true);
  bubbleResizeEdgeTarget.addEventListener("mousedown", handleBubbleResizeEdgeMouseDown, true);
  bubbleResizeEdgeTarget.addEventListener("mouseleave", handleBubbleResizeEdgeMouseLeave, true);
  document.addEventListener("compositionstart", syncTextEditBeforeImeEvent, true);
  document.addEventListener("compositionupdate", syncTextEditBeforeImeEvent, true);
  document.addEventListener("compositionend", syncTextEditBeforeImeEvent, true);
  document.addEventListener("input", syncTextEditBeforeImeEvent, true);
  document.addEventListener("keydown", syncTextEditBeforeImeEvent, true);
  editor.on("node_active", emitSelectionWithCache);
  editor.on("node_tree_render_end", syncSelectionFromActiveList);
  editor.on("before_show_text_edit", hideEditingNodeText);
  editor.on("hide_text_edit", syncAfterTextEdit);
  editor.on("node_dragend", syncAfterNodeDrag);
  setScrollbarWrapSize(el.clientWidth, el.clientHeight);
  events.onReady?.();
  ensureStableRenderTreeNodeIds(editor);
  window.setTimeout(() => {
    if (destroyed) return;
    installRuntimeNodeExtensions();
  }, 0);
  if (editor.renderer?.root) {
    selectedRenderNode = editor.renderer.root;
    applyInitialReadableView(editor);
    activateNode(editor, editor.renderer.root);
    emitSelection(editor.renderer.root);
    scheduleNodeResizeHandleSync();
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
      scheduleNodeResizeHandleSync();
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
      const nextNode = applySelectedTextFormat(editor, patch);
      scheduleNodeResizeHandleSync();
      return nextNode;
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
      if (nodeResizeDragState?.frame !== null && nodeResizeDragState?.frame !== undefined) {
        window.cancelAnimationFrame(nodeResizeDragState.frame);
      }
      detachNodeResizeDragListeners();
      bubbleResizeEdgeTarget.removeEventListener("mousemove", handleBubbleResizeEdgeMouseMove, true);
      bubbleResizeEdgeTarget.removeEventListener("mousedown", handleBubbleResizeEdgeMouseDown, true);
      bubbleResizeEdgeTarget.removeEventListener("mouseleave", handleBubbleResizeEdgeMouseLeave, true);
      document.removeEventListener("compositionstart", syncTextEditBeforeImeEvent, true);
      document.removeEventListener("compositionupdate", syncTextEditBeforeImeEvent, true);
      document.removeEventListener("compositionend", syncTextEditBeforeImeEvent, true);
      document.removeEventListener("input", syncTextEditBeforeImeEvent, true);
      document.removeEventListener("keydown", syncTextEditBeforeImeEvent, true);
      setBubbleResizeEdgeCursor(false);
      editor.off("data_change", emitSnapshot);
      editor.off("layout_change", emitSnapshot);
      editor.off("scrollbar_change", emitPluginViewportState);
      editor.off("node_active", emitSelectionWithCache);
      editor.off("node_tree_render_end", syncSelectionFromActiveList);
      if (textEditPositionSyncFrame !== null) {
        window.cancelAnimationFrame(textEditPositionSyncFrame);
        textEditPositionSyncFrame = null;
      }
      editor.off("before_show_text_edit", hideEditingNodeText);
      editor.off("hide_text_edit", syncAfterTextEdit);
      editor.off("translate", syncAfterCanvasTranslate);
      editor.off("node_dragend", syncAfterNodeDrag);
      restoreEditingNodeText();
      editor.destroy();
    }
  };
}
