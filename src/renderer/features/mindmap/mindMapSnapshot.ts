import { AISTUDY_CORE_CONTRACT } from "../../domain/coreContracts";
import type { MindMapLayoutType, MindMapOutlineItem, MindMapSnapshot, SimpleMindMapNode } from "./mindMapTypes";

export const MIND_MAP_EDITOR_VERSION = "0.14.0-fix.2";
export const RIGHT_BRANCH_LAYOUT: MindMapLayoutType = AISTUDY_CORE_CONTRACT.mindMap.defaultLayout;
export const MIND_MAP_DEFAULT_FONT_SIZE = AISTUDY_CORE_CONTRACT.mindMap.defaultFontSize;
const DEFAULT_THEME = "default";
const MIND_MAP_FONT_FAMILY = '"Microsoft YaHei", "微软雅黑", Arial, sans-serif';
const UNTITLED_NODE_TITLE = "未命名";
const NODE_ID_PREFIX = AISTUDY_CORE_CONTRACT.mindMap.nodeIdPrefix;

export const MIND_MAP_CATALOG_RELATION = Object.freeze({
  source: "mindmap",
  childField: "children",
  rootLevel: 0,
  rootPath: "1",
  pathSeparator: ".",
  firstOrder: 1
});
export const MIND_MAP_CATALOG_BOUNDARY_KEY = "aistudyCatalogBoundary";

export const MIND_MAP_LAYOUT_OPTIONS: Array<{ value: MindMapLayoutType; label: string }> = [
  { value: "logicalStructure", label: "右向逻辑" },
  { value: "logicalStructureLeft", label: "左向逻辑" },
  { value: "mindMap", label: "思维导图" },
  { value: "organizationStructure", label: "组织结构" },
  { value: "catalogOrganization", label: "目录组织" },
  { value: "timeline", label: "时间轴" },
  { value: "verticalTimeline", label: "竖向时间轴" },
  { value: "fishbone", label: "鱼骨图" },
  { value: "rightFishbone", label: "右向鱼骨" }
];

export function normalizeLayout(value: unknown): MindMapLayoutType {
  return typeof value === "string" && MIND_MAP_LAYOUT_OPTIONS.some((option) => option.value === value)
    ? (value as MindMapLayoutType)
    : RIGHT_BRANCH_LAYOUT;
}

export function createXMindStyleThemeConfig() {
  return {
    paddingX: 20,
    paddingY: 9,
    lineWidth: 2,
    lineColor: "#72a9d8",
    lineDasharray: "none",
    lineStyle: "curve",
    lineRadius: 14,
    rootLineKeepSameInCurve: true,
    rootLineStartPositionKeepSameInCurve: true,
    backgroundColor: "#fbfcfd",
    backgroundImage: "none",
    hoverRectColor: "#2f80c0",
    hoverRectRadius: 8,
    generalizationLineWidth: 2,
    generalizationLineColor: "#72a9d8",
    generalizationNodeMargin: 22,
    associativeLineWidth: 2,
    associativeLineColor: "#7b8ea6",
    associativeLineActiveWidth: 5,
    associativeLineActiveColor: "#2f80c0",
    associativeLineDasharray: "6,4",
    root: {
      shape: "roundedRectangle",
      fillColor: "#ffffff",
      color: "#17466f",
      fontFamily: MIND_MAP_FONT_FAMILY,
      fontSize: MIND_MAP_DEFAULT_FONT_SIZE,
      fontWeight: "bold",
      borderColor: "#2f80c0",
      borderWidth: 2,
      borderRadius: 10,
      hoverRectRadius: 10,
      textAlign: "center"
    },
    second: {
      shape: "roundedRectangle",
      marginX: 112,
      marginY: 48,
      fillColor: "#eaf6ff",
      color: "#17466f",
      fontFamily: MIND_MAP_FONT_FAMILY,
      fontSize: MIND_MAP_DEFAULT_FONT_SIZE,
      fontWeight: "bold",
      borderColor: "#91c8ef",
      borderWidth: 1,
      borderRadius: 9,
      hoverRectRadius: 9,
      textAlign: "center"
    },
    node: {
      shape: "roundedRectangle",
      marginX: 96,
      marginY: 42,
      fillColor: "#fff8ee",
      color: "#425466",
      fontFamily: MIND_MAP_FONT_FAMILY,
      fontSize: MIND_MAP_DEFAULT_FONT_SIZE,
      fontWeight: "normal",
      borderColor: "#f0c37c",
      borderWidth: 1,
      borderRadius: 9,
      hoverRectRadius: 9,
      textAlign: "center"
    },
    generalization: {
      shape: "roundedRectangle",
      marginX: 104,
      marginY: 44,
      fillColor: "#ffffff",
      color: "#334155",
      fontFamily: MIND_MAP_FONT_FAMILY,
      fontSize: MIND_MAP_DEFAULT_FONT_SIZE,
      fontWeight: "normal",
      borderColor: "#72a9d8",
      borderWidth: 1,
      borderRadius: 8,
      hoverRectRadius: 8,
      textAlign: "center"
    }
  };
}

function createDefaultTheme() {
  return {
    template: DEFAULT_THEME,
    config: createXMindStyleThemeConfig()
  };
}

export function createRootNode(title: string): SimpleMindMapNode {
  return {
    data: {
      uid: createCatalogNodeId(MIND_MAP_CATALOG_RELATION.rootPath),
      text: title || "未命名导图",
      expand: true
    },
    children: []
  };
}

export function createInitialSnapshot(title: string): MindMapSnapshot {
  return {
    schemaVersion: AISTUDY_CORE_CONTRACT.schemaVersion,
    editor: AISTUDY_CORE_CONTRACT.editors.mindMap,
    editorVersion: MIND_MAP_EDITOR_VERSION,
    root: createRootNode(title),
    layout: RIGHT_BRANCH_LAYOUT,
    theme: createDefaultTheme(),
    updatedAt: new Date().toISOString()
  };
}

export function normalizeSnapshot(value: unknown, fallbackTitle: string): MindMapSnapshot {
  if (!value || typeof value !== "object") {
    return createInitialSnapshot(fallbackTitle);
  }

  const candidate = value as Partial<MindMapSnapshot>;
  if (
    candidate.schemaVersion !== AISTUDY_CORE_CONTRACT.schemaVersion ||
    candidate.editor !== AISTUDY_CORE_CONTRACT.editors.mindMap ||
    !candidate.root
  ) {
    return createInitialSnapshot(fallbackTitle);
  }
  const sourceLayout = normalizeLayout(candidate.layout);

  return {
    schemaVersion: AISTUDY_CORE_CONTRACT.schemaVersion,
    editor: AISTUDY_CORE_CONTRACT.editors.mindMap,
    editorVersion: typeof candidate.editorVersion === "string" ? candidate.editorVersion : MIND_MAP_EDITOR_VERSION,
    root: normalizeMindMapTree(candidate.root, fallbackTitle),
    layout: sourceLayout,
    theme: createDefaultTheme(),
    view: sourceLayout === candidate.layout ? candidate.view : undefined,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString()
  };
}

function createCatalogNodeId(path: string) {
  return `${NODE_ID_PREFIX}${path.replaceAll(MIND_MAP_CATALOG_RELATION.pathSeparator, "-")}`;
}

function createStableNodeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${NODE_ID_PREFIX}${crypto.randomUUID().replaceAll("-", "")}`;
  }
  return `${NODE_ID_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function normalizeNodeId(value: unknown, usedIds: Set<string>, fallbackPath: string) {
  const candidate = typeof value === "string" && value.trim() ? value.trim() : "";
  const fallback = createCatalogNodeId(fallbackPath);
  const next = candidate || fallback;
  if (next && !usedIds.has(next)) {
    usedIds.add(next);
    return next;
  }

  let generated = createStableNodeId();
  while (usedIds.has(generated)) {
    generated = createStableNodeId();
  }
  usedIds.add(generated);
  return generated;
}

function getMindMapChildren(node: SimpleMindMapNode | null | undefined) {
  return Array.isArray(node?.children) ? node.children : [];
}

function readNodeTitle(node: SimpleMindMapNode, fallbackTitle = UNTITLED_NODE_TITLE) {
  return typeof node.data?.text === "string" && node.data.text.trim() ? node.data.text.trim() : fallbackTitle;
}

export function isMindMapCatalogBoundary(node: SimpleMindMapNode | null | undefined) {
  return node?.data?.[MIND_MAP_CATALOG_BOUNDARY_KEY] === true;
}

export function normalizeMindMapTree(root: SimpleMindMapNode | null | undefined, fallbackTitle = "未命名导图"): SimpleMindMapNode {
  const source = root ?? createRootNode(fallbackTitle);
  const usedIds = new Set<string>();

  const walk = (node: SimpleMindMapNode, path: string, titleFallback: string): SimpleMindMapNode => {
    const data = node.data && typeof node.data === "object" ? node.data : { text: titleFallback };
    const { customLeft: _customLeft, customTop: _customTop, ...stableData } = data;
    const uid = normalizeNodeId(data.uid, usedIds, path);
    const text = typeof data.text === "string" && data.text.trim() ? data.text : titleFallback;

    return {
      ...node,
      data: {
        ...stableData,
        uid,
        text
      },
      children: getMindMapChildren(node).map((child, index) =>
        walk(child, `${path}${MIND_MAP_CATALOG_RELATION.pathSeparator}${index + MIND_MAP_CATALOG_RELATION.firstOrder}`, UNTITLED_NODE_TITLE)
      )
    };
  };

  return walk(source, MIND_MAP_CATALOG_RELATION.rootPath, fallbackTitle || "未命名导图");
}

export function countNodes(root: SimpleMindMapNode | null | undefined): number {
  if (!root) return 0;
  let count = 0;
  const stack: SimpleMindMapNode[] = [root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    count += 1;
    const children = getMindMapChildren(node);
    for (let index = 0; index < children.length; index += 1) {
      stack.push(children[index]);
    }
  }

  return count;
}

export function createMindMapStructureSignature(root: SimpleMindMapNode | null | undefined): string {
  if (!root) return "";
  const parts: string[] = [];
  const stack: Array<{ node: SimpleMindMapNode; depth: number }> = [{ node: root, depth: 0 }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const { node, depth } = current;
    const children = getMindMapChildren(node);
    const uid = typeof node.data?.uid === "string" ? node.data.uid : "";
    const text = readNodeTitle(node, "");
    const catalogBoundary = isMindMapCatalogBoundary(node) ? "1" : "0";
    parts.push(`${depth}:${uid.length}:${uid}:${text.length}:${text}:${catalogBoundary}:${children.length}`);

    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], depth: depth + 1 });
    }
  }

  return parts.join("|");
}

export function buildMindMapOutline(root: SimpleMindMapNode | null | undefined): MindMapOutlineItem[] {
  if (!root) return [];

  const walk = (
    node: SimpleMindMapNode,
    level: number,
    path: string,
    parentPath: string | null,
    parentNodeId: string | null,
    order: number
  ): MindMapOutlineItem => {
    const children = getMindMapChildren(node);
    const title = readNodeTitle(node);
    const nodeId = typeof node.data?.uid === "string" && node.data.uid ? node.data.uid : createCatalogNodeId(path);
    const catalogBoundary = isMindMapCatalogBoundary(node);
    const outlineChildren = catalogBoundary
      ? []
      : children.map((child, index) => {
          const childOrder = index + MIND_MAP_CATALOG_RELATION.firstOrder;
          return walk(
            child,
            level + 1,
            `${path}${MIND_MAP_CATALOG_RELATION.pathSeparator}${childOrder}`,
            path,
            nodeId,
            childOrder
          );
        });

    return {
      id: path,
      nodeId,
      parentNodeId,
      title,
      level,
      path,
      parentPath,
      order,
      source: MIND_MAP_CATALOG_RELATION.source,
      childCount: outlineChildren.length,
      hiddenChildCount: catalogBoundary ? children.length : 0,
      catalogBoundary,
      children: outlineChildren
    };
  };

  return [
    walk(
      root,
      MIND_MAP_CATALOG_RELATION.rootLevel,
      MIND_MAP_CATALOG_RELATION.rootPath,
      null,
      null,
      MIND_MAP_CATALOG_RELATION.firstOrder
    )
  ];
}

export function extractNodeTitle(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const value = node as { getData?: (key?: string) => unknown; data?: { text?: unknown } };
  if (typeof value.getData === "function") {
    const text = value.getData("text");
    return typeof text === "string" ? text : "";
  }
  return typeof value.data?.text === "string" ? value.data.text : "";
}

export function extractNodeId(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const value = node as { getData?: (key?: string) => unknown; data?: { uid?: unknown } };
  if (typeof value.getData === "function") {
    const id = value.getData("uid");
    return typeof id === "string" ? id : null;
  }
  return typeof value.data?.uid === "string" ? value.data.uid : null;
}
