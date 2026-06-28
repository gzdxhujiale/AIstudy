import React from "react";
import { BookOpen, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { loadTextbookStore } from "./textbookService";
import type { TextbookAsset } from "./textbookTypes";

const PdfDocumentViewer = React.lazy(() => import("./PdfDocumentViewer").then((module) => ({ default: module.PdfDocumentViewer })));

const DEFAULT_ZOOM = 100;

function clampPage(value: number, asset: TextbookAsset | null) {
  const maxPage = asset?.pageCount && asset.pageCount > 0 ? asset.pageCount : 100000;
  return Math.max(1, Math.min(maxPage, Math.round(Number.isFinite(value) ? value : 1)));
}

function readNumberParam(params: URLSearchParams, key: string, fallback: number) {
  const value = Number(params.get(key));
  return Number.isFinite(value) ? value : fallback;
}

export function TextbookPdfWindow() {
  const params = React.useMemo(() => new URLSearchParams(window.location.search), []);
  const courseId = params.get("courseId") || "";
  const mindMapId = params.get("mindMapId") || courseId;
  const assetId = params.get("assetId") || "";
  const [asset, setAsset] = React.useState<TextbookAsset | null>(null);
  const [pageNumber, setPageNumber] = React.useState(() => Math.max(1, readNumberParam(params, "pageNumber", 1)));
  const [zoom, setZoom] = React.useState(() => Math.max(60, Math.min(180, readNumberParam(params, "zoom", DEFAULT_ZOOM))));
  const [message, setMessage] = React.useState("打开中");

  React.useEffect(() => {
    let cancelled = false;
    if (!courseId || !mindMapId || !assetId) {
      setMessage("PDF 没有打开");
      return;
    }

    loadTextbookStore({ courseId, mindMapId })
      .then((store) => {
        if (cancelled) return;
        const nextAsset = store.assets.find((item) => item.id === assetId) ?? null;
        setAsset(nextAsset);
        setMessage(nextAsset ? "" : "PDF 没有打开");
      })
      .catch(() => {
        if (!cancelled) setMessage("PDF 没有打开");
      });

    return () => {
      cancelled = true;
    };
  }, [courseId, mindMapId, assetId]);

  function applyPage(nextPage: number) {
    setPageNumber(clampPage(nextPage, asset));
  }

  return (
    <div className="textbook-window">
      <div className="textbook-window-toolbar">
        <div className="textbook-window-title">
          <BookOpen size={16} />
          <span>{asset?.title || "教材"}</span>
        </div>
        <button type="button" title="上一页" onClick={() => applyPage(pageNumber - 1)} disabled={!asset || pageNumber <= 1}>
          <ChevronLeft size={15} />
        </button>
        <label className="textbook-page-input">
          <input
            type="number"
            min={1}
            max={asset?.pageCount || undefined}
            value={pageNumber}
            onChange={(event) => applyPage(Number(event.target.value))}
            disabled={!asset}
            aria-label="页码"
          />
          <span>{asset?.pageCount ? `/ ${asset.pageCount}` : "页"}</span>
        </label>
        <button type="button" title="下一页" onClick={() => applyPage(pageNumber + 1)} disabled={!asset || Boolean(asset.pageCount && pageNumber >= asset.pageCount)}>
          <ChevronRight size={15} />
        </button>
        <span className="textbook-toolbar-separator" />
        <button type="button" title="缩小" onClick={() => setZoom((value) => Math.max(60, value - 10))} disabled={!asset || zoom <= 60}>
          <ZoomOut size={15} />
        </button>
        <span className="textbook-zoom-label">{zoom}%</span>
        <button type="button" title="放大" onClick={() => setZoom((value) => Math.min(180, value + 10))} disabled={!asset || zoom >= 180}>
          <ZoomIn size={15} />
        </button>
      </div>
      <main className="textbook-window-body">
        {asset ? (
          <React.Suspense fallback={<div className="textbook-pdf-status">打开中</div>}>
            <PdfDocumentViewer
              asset={asset}
              pageNumber={pageNumber}
              zoom={zoom}
              onPageChange={setPageNumber}
              onPageCountChange={(pageCount) => {
                setAsset((current) => current ? { ...current, pageCount } : current);
              }}
            />
          </React.Suspense>
        ) : (
          <div className="textbook-pdf-status">{message}</div>
        )}
      </main>
    </div>
  );
}
