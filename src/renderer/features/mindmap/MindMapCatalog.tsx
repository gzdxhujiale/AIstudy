import React from "react";
import { ChevronRight, Copy, Trash2 } from "lucide-react";
import type { MindMapOutlineItem } from "./mindMapTypes";

type MindMapCatalogProps = {
  items: MindMapOutlineItem[];
  selectedNodeId: string | null;
  resetKey: string;
  collapseRequest?: MindMapCatalogCollapseRequest | null;
  onNodeSelect?: (item: MindMapOutlineItem) => void;
  onNodeDelete?: (item: MindMapOutlineItem) => void;
  onNodeCopyDocumentPath?: (item: MindMapOutlineItem) => Promise<void> | void;
};

export type MindMapCatalogCollapseRequest = {
  mode: "collapse-all" | "expand-all" | "expand-branches";
  nonce: number;
};

type CatalogContextMenuState = {
  item: MindMapOutlineItem;
  x: number;
  y: number;
  copied: boolean;
};

type CatalogRenderOptions = {
  selectedNodeId: string | null;
  collapsedPaths: ReadonlySet<string>;
  branchesOnly: boolean;
  showLeafItems?: boolean;
  onToggle: (path: string) => void;
  onNodeSelect?: (item: MindMapOutlineItem) => void;
  onNodeContextMenu?: (event: React.MouseEvent<HTMLDivElement>, item: MindMapOutlineItem) => void;
};

function collectCollapsiblePaths(items: MindMapOutlineItem[], paths = new Set<string>()) {
  items.forEach((item) => {
    if (item.children.length > 0) {
      paths.add(item.path);
      collectCollapsiblePaths(item.children, paths);
    }
  });
  return paths;
}

function collectDefaultCollapsedPaths(items: MindMapOutlineItem[]) {
  const paths = new Set<string>();
  items.forEach((item) => {
    collectCollapsiblePaths(item.children, paths);
  });
  return paths;
}

function collectLeafParentCollapsedPaths(items: MindMapOutlineItem[], paths = new Set<string>()) {
  items.forEach((item) => {
    const hasChildren = item.children.length > 0;
    if (!hasChildren) return;
    const hasBranchChild = item.children.some((child) => child.children.length > 0);
    if (!hasBranchChild) {
      paths.add(item.path);
      return;
    }
    collectLeafParentCollapsedPaths(item.children, paths);
  });
  return paths;
}

function getCatalogDepthClass(level: number) {
  return `catalog-node level-${Math.min(Math.max(level, 0), 5)}`;
}

function isLeafParent(item: MindMapOutlineItem) {
  return item.children.length > 0 && !item.children.some((child) => child.children.length > 0);
}

function renderCatalogItems(items: MindMapOutlineItem[], options: CatalogRenderOptions) {
  const visibleItems = options.branchesOnly && !options.showLeafItems ? items.filter((item) => item.children.length > 0) : items;

  return (
    <ol className="catalog-tree">
      {visibleItems.map((item) => {
        const hasChildren = item.children.length > 0;
        const isCollapsed = hasChildren && options.collapsedPaths.has(item.path);
        const isSelected = Boolean(options.selectedNodeId && item.nodeId === options.selectedNodeId);
        const showLeafChildren = options.branchesOnly && isLeafParent(item) && !isCollapsed;

        return (
          <li key={item.path} className="catalog-tree-item">
            <div
              className={`${getCatalogDepthClass(item.level)}${hasChildren ? " has-children" : " is-leaf"}${isSelected ? " selected" : ""}`}
              style={{ paddingLeft: 8 + item.level * 14 }}
              data-catalog-source={item.source}
              data-catalog-path={item.path}
              data-catalog-parent-path={item.parentPath ?? ""}
              data-catalog-order={item.order}
              aria-level={item.level + 1}
              aria-expanded={hasChildren ? !isCollapsed : undefined}
              aria-current={isSelected ? "true" : undefined}
              role="treeitem"
              tabIndex={0}
              onClick={() => options.onNodeSelect?.(item)}
              onContextMenu={(event) => options.onNodeContextMenu?.(event, item)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                options.onNodeSelect?.(item);
              }}
            >
              {hasChildren ? (
                <button
                  className={isCollapsed ? "catalog-toggle collapsed" : "catalog-toggle"}
                  type="button"
                  title={isCollapsed ? "展开" : "折叠"}
                  aria-label={`${isCollapsed ? "展开" : "折叠"} ${item.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    options.onToggle(item.path);
                  }}
                >
                  <ChevronRight size={14} />
                </button>
              ) : (
                <span className="catalog-toggle-placeholder" />
              )}
              <span className="catalog-node-mark" />
              <span className="catalog-node-title">{item.title}</span>
              {item.childCount > 0 ? <span className="catalog-node-count">{item.childCount}</span> : null}
            </div>
            {hasChildren && !isCollapsed ? renderCatalogItems(item.children, { ...options, showLeafItems: showLeafChildren }) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function MindMapCatalog({ items, selectedNodeId, resetKey, collapseRequest, onNodeSelect, onNodeDelete, onNodeCopyDocumentPath }: MindMapCatalogProps) {
  const [collapsedPaths, setCollapsedPaths] = React.useState<Set<string>>(() => collectDefaultCollapsedPaths(items));
  const [branchesOnly, setBranchesOnly] = React.useState(false);
  const [contextMenu, setContextMenu] = React.useState<CatalogContextMenuState | null>(null);
  const knownCollapsiblePathsRef = React.useRef<Set<string>>(collectCollapsiblePaths(items));
  const collapseRequestNonceRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const validPaths = collectCollapsiblePaths(items);
    knownCollapsiblePathsRef.current = validPaths;
    setCollapsedPaths(collectDefaultCollapsedPaths(items));
    setBranchesOnly(false);
    setContextMenu(null);
  }, [resetKey]);

  React.useEffect(() => {
    if (!contextMenu) return undefined;

    const closeMenu = () => setContextMenu(null);
    const closeMenuFromPointer = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(".catalog-context-menu")) return;
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    document.addEventListener("mousedown", closeMenuFromPointer, true);
    document.addEventListener("contextmenu", closeMenu, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);

    return () => {
      document.removeEventListener("mousedown", closeMenuFromPointer, true);
      document.removeEventListener("contextmenu", closeMenu, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [contextMenu]);

  React.useEffect(() => {
    if (!collapseRequest || collapseRequest.nonce === collapseRequestNonceRef.current) return;
    collapseRequestNonceRef.current = collapseRequest.nonce;
    if (collapseRequest.mode === "collapse-all") {
      setCollapsedPaths(collectCollapsiblePaths(items));
      setBranchesOnly(false);
    } else if (collapseRequest.mode === "expand-branches") {
      setCollapsedPaths(collectLeafParentCollapsedPaths(items));
      setBranchesOnly(true);
    } else {
      setCollapsedPaths(new Set());
      setBranchesOnly(false);
    }
    setContextMenu(null);
  }, [collapseRequest, items]);

  React.useEffect(() => {
    const validPaths = collectCollapsiblePaths(items);
    const knownPaths = knownCollapsiblePathsRef.current;
    setCollapsedPaths((current) => {
      const next = new Set([...current].filter((path) => validPaths.has(path)));
      validPaths.forEach((path) => {
        if (!knownPaths.has(path)) {
          next.add(path);
        }
      });
      if (
        next.size === current.size &&
        [...next].every((path) => current.has(path))
      ) {
        return current;
      }
      return next;
    });
    knownCollapsiblePathsRef.current = validPaths;
  }, [items]);

  const togglePath = React.useCallback((path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const openContextMenu = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>, item: MindMapOutlineItem) => {
      const canCopy = Boolean(onNodeCopyDocumentPath && item.nodeId);
      const canDelete = Boolean(onNodeDelete && item.nodeId && item.parentNodeId);
      if (!canCopy && !canDelete) return;
      event.preventDefault();
      event.stopPropagation();
      onNodeSelect?.(item);
      const width = 178;
      const height = 12 + (canCopy ? 30 : 0) + (canDelete ? 30 : 0);
      setContextMenu({
        item,
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
        copied: false
      });
    },
    [onNodeCopyDocumentPath, onNodeDelete, onNodeSelect]
  );

  const runCopyDocumentPath = React.useCallback(async () => {
    if (!contextMenu || !onNodeCopyDocumentPath) return;
    const item = contextMenu.item;
    try {
      await onNodeCopyDocumentPath(item);
      setContextMenu((current) => current && current.item.path === item.path ? { ...current, copied: true } : current);
      window.setTimeout(() => {
        setContextMenu((current) => current && current.item.path === item.path ? null : current);
      }, 700);
    } catch {
      setContextMenu(null);
      window.alert("文档路径复制没有完成，请稍后再试。");
    }
  }, [contextMenu, onNodeCopyDocumentPath]);

  const runDelete = React.useCallback(() => {
    if (!contextMenu) return;
    const item = contextMenu.item;
    setContextMenu(null);
    onNodeDelete?.(item);
  }, [contextMenu, onNodeDelete]);

  return (
    <>
      {renderCatalogItems(items, {
        selectedNodeId,
        collapsedPaths,
        branchesOnly,
        onToggle: togglePath,
        onNodeSelect,
        onNodeContextMenu: openContextMenu
      })}
      {contextMenu ? (
        <div
          className="catalog-context-menu"
          role="menu"
          aria-label={`${contextMenu.item.title} 操作`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {contextMenu.item.nodeId && onNodeCopyDocumentPath ? (
            <button type="button" role="menuitem" onClick={() => void runCopyDocumentPath()}>
              <Copy size={14} />
              <span>{contextMenu.copied ? "已复制文档路径" : "复制文档路径"}</span>
            </button>
          ) : null}
          {contextMenu.item.nodeId && contextMenu.item.parentNodeId && onNodeDelete ? (
            <button type="button" role="menuitem" onClick={runDelete}>
              <Trash2 size={14} />
              <span>删除</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
