import React from "react";
import "./pdfjsCompat";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "./pdfjsWorker.ts?worker&url";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import type { TextbookAsset, TextbookPdfAnnotation, TextbookPdfAnnotationKind } from "./textbookTypes";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PAGE_GAP = 12;
const DEFAULT_RENDER_WINDOW = 2;
const HIGH_ZOOM_RENDER_WINDOW = 1;
const PAGE_PREFETCH_RADIUS = 3;
const PAGE_CACHE_LIMIT = 12;
const DEFAULT_PAGE_RATIO = 1.414;

const PDF_LOAD_OPTIONS = {
  isOffscreenCanvasSupported: false,
  isImageDecoderSupported: false,
  useWorkerFetch: false
} as const;

type PdfDocumentViewerProps = {
  asset: TextbookAsset;
  pageNumber: number;
  zoom: number;
  annotations?: TextbookPdfAnnotation[];
  annotationMode?: "none" | TextbookPdfAnnotationKind;
  annotationText?: string;
  selectedAnnotationId?: string | null;
  onPageChange: (pageNumber: number) => void;
  onPageCountChange: (pageCount: number) => void;
  onCreateAnnotation?: (draft: {
    pageNumber: number;
    kind: TextbookPdfAnnotationKind;
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
  }) => void;
  onSelectAnnotation?: (annotationId: string | null) => void;
};

type PdfPageCanvasProps = {
  pageNumber: number;
  width: number;
  height: number;
  shouldRender: boolean;
  getPage: (pageNumber: number) => Promise<PDFPageProxy>;
  onMeasure: (pageNumber: number, width: number, height: number) => void;
};

type PdfAnnotationLayerProps = {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  annotations: TextbookPdfAnnotation[];
  mode: "none" | TextbookPdfAnnotationKind;
  annotationText: string;
  selectedAnnotationId: string | null;
  onCreateAnnotation?: PdfDocumentViewerProps["onCreateAnnotation"];
  onSelectAnnotation?: (annotationId: string | null) => void;
};

function clampPage(value: number, pageCount: number) {
  return Math.max(1, Math.min(pageCount || 1, Math.round(Number.isFinite(value) ? value : 1)));
}

function createPdfSourceUrl(asset: TextbookAsset) {
  return `aistudy-pdf://asset/${encodeURIComponent(asset.id)}.pdf`;
}

function clampRatio(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeDraftRect(start: { x: number; y: number }, end: { x: number; y: number }, width: number, height: number) {
  const left = clampRatio(Math.min(start.x, end.x) / width);
  const top = clampRatio(Math.min(start.y, end.y) / height);
  const right = clampRatio(Math.max(start.x, end.x) / width);
  const bottom = clampRatio(Math.max(start.y, end.y) / height);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
}

function trimPageCache(cache: Map<number, { page: PDFPageProxy; touchedAt: number }>) {
  if (cache.size <= PAGE_CACHE_LIMIT) return;
  const staleEntries = Array.from(cache.entries()).sort((left, right) => left[1].touchedAt - right[1].touchedAt);
  for (const [pageNumber] of staleEntries.slice(0, Math.max(0, cache.size - PAGE_CACHE_LIMIT))) {
    cache.delete(pageNumber);
  }
}

function PdfPageCanvas({ pageNumber, width, height, shouldRender, getPage, onMeasure }: PdfPageCanvasProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [renderState, setRenderState] = React.useState<"idle" | "rendering" | "ready" | "error">("idle");

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !shouldRender || width <= 0) {
      setRenderState("idle");
      return;
    }

    let cancelled = false;
    let renderTask: RenderTask | null = null;
    setRenderState("rendering");

    getPage(pageNumber)
      .then((page) => {
        if (cancelled) return null;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = width / baseViewport.width;
        const viewport = page.getViewport({ scale });
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const canvasContext = canvas.getContext("2d", { alpha: false });
        if (!canvasContext) throw new Error("Canvas context unavailable.");
        canvasContext.fillStyle = "#ffffff";
        canvasContext.fillRect(0, 0, canvas.width, canvas.height);
        renderTask = page.render({ canvas: null, canvasContext, viewport, background: "#ffffff" });
        return renderTask.promise.then(() => {
          onMeasure(pageNumber, viewport.width, viewport.height);
        });
      })
      .then(() => {
        if (!cancelled) setRenderState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
        if (name === "RenderingCancelledException") {
          setRenderState("idle");
          return;
        }
        setRenderState("error");
      });

    return () => {
      cancelled = true;
      if (renderTask) renderTask.cancel();
    };
  }, [getPage, pageNumber, width, shouldRender, onMeasure]);

  return (
    <div className="textbook-pdf-page-content">
      <canvas ref={canvasRef} aria-label={`第 ${pageNumber} 页`} />
      {renderState === "rendering" ? <span className="textbook-pdf-page-state">{pageNumber}</span> : null}
      {renderState === "error" ? <span className="textbook-pdf-page-state">重试</span> : null}
    </div>
  );
}

function PdfAnnotationLayer({
  pageNumber,
  pageWidth,
  pageHeight,
  annotations,
  mode,
  annotationText,
  selectedAnnotationId,
  onCreateAnnotation,
  onSelectAnnotation
}: PdfAnnotationLayerProps) {
  const layerRef = React.useRef<HTMLDivElement | null>(null);
  const [draftRect, setDraftRect] = React.useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const dragStartRef = React.useRef<{ x: number; y: number } | null>(null);

  const getPointerPoint = React.useCallback((event: React.PointerEvent) => {
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
    };
  }, []);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (mode === "none" || !onCreateAnnotation || pageWidth <= 0 || pageHeight <= 0) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getPointerPoint(event);
    dragStartRef.current = point;
    setDraftRect({ x: point.x / pageWidth, y: point.y / pageHeight, width: 0, height: 0 });
    onSelectAnnotation?.(null);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current || mode === "none") return;
    const point = getPointerPoint(event);
    setDraftRect(normalizeDraftRect(dragStartRef.current, point, pageWidth, pageHeight));
  }

  function finishDraft(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current || mode === "none") return;
    const point = getPointerPoint(event);
    const rect = normalizeDraftRect(dragStartRef.current, point, pageWidth, pageHeight);
    dragStartRef.current = null;
    setDraftRect(null);
    if (rect.width < 0.008 || rect.height < 0.008) return;
    onCreateAnnotation?.({
      pageNumber,
      kind: mode,
      ...rect,
      text: mode === "text" ? annotationText.trim() : ""
    });
  }

  return (
    <div
      ref={layerRef}
      className={mode === "none" ? "textbook-pdf-annotation-layer" : "textbook-pdf-annotation-layer editing"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDraft}
      onPointerCancel={() => {
        dragStartRef.current = null;
        setDraftRect(null);
      }}
    >
      {annotations.map((annotation) => (
        <button
          key={annotation.id}
          type="button"
          className={annotation.id === selectedAnnotationId ? `textbook-pdf-annotation ${annotation.kind} selected` : `textbook-pdf-annotation ${annotation.kind}`}
          style={{
            left: `${annotation.x * 100}%`,
            top: `${annotation.y * 100}%`,
            width: `${annotation.width * 100}%`,
            height: `${annotation.height * 100}%`,
            ["--annotation-color" as string]: annotation.color
          }}
          title={annotation.nodeTitle || annotation.text || "PDF annotation"}
          aria-label={annotation.kind === "text" ? "PDF text annotation" : "PDF highlight annotation"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onSelectAnnotation?.(annotation.id);
          }}
        >
          {annotation.kind === "text" ? <span>{annotation.text}</span> : null}
        </button>
      ))}
      {draftRect ? (
        <span
          className={mode === "text" ? "textbook-pdf-annotation-draft text" : "textbook-pdf-annotation-draft"}
          style={{
            left: `${draftRect.x * 100}%`,
            top: `${draftRect.y * 100}%`,
            width: `${draftRect.width * 100}%`,
            height: `${draftRect.height * 100}%`
          }}
        />
      ) : null}
    </div>
  );
}

export function PdfDocumentViewer({
  asset,
  pageNumber,
  zoom,
  annotations = [],
  annotationMode = "none",
  annotationText = "",
  selectedAnnotationId = null,
  onPageChange,
  onPageCountChange,
  onCreateAnnotation,
  onSelectAnnotation
}: PdfDocumentViewerProps) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const pageRefs = React.useRef(new Map<number, HTMLDivElement>());
  const visiblePagesRef = React.useRef(new Map<number, { ratio: number; top: number }>());
  const pageCacheRef = React.useRef(new Map<number, { page: PDFPageProxy; touchedAt: number }>());
  const internalPageChangeRef = React.useRef<number | null>(null);
  const [pdf, setPdf] = React.useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = React.useState(asset.pageCount || 0);
  const [readerWidth, setReaderWidth] = React.useState(0);
  const [pageSizes, setPageSizes] = React.useState<Record<number, { width: number; height: number }>>({});
  const [loadState, setLoadState] = React.useState<"loading" | "ready" | "error">("loading");

  React.useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setReaderWidth(Math.max(240, width - 56));
    });
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjs.getDocument> | null = null;
    let openedDocument: PDFDocumentProxy | null = null;
    setLoadState("loading");
    setPdf(null);
    setPageSizes({});
    setPageCount(asset.pageCount || 0);
    visiblePagesRef.current.clear();
    pageCacheRef.current.clear();

    async function openDocument() {
      try {
        loadingTask = pdfjs.getDocument({
          ...PDF_LOAD_OPTIONS,
          url: createPdfSourceUrl(asset),
          rangeChunkSize: 1024 * 1024
        });
        const document = await loadingTask.promise;

        if (cancelled) {
          void loadingTask.destroy().catch(() => undefined);
          document.cleanup();
          return;
        }
        openedDocument = document;
        setPdf(document);
        setPageCount(document.numPages);
        onPageCountChange(document.numPages);
        setLoadState("ready");
      } catch {
        if (!cancelled) setLoadState("error");
      }
    }

    void openDocument();

    return () => {
      cancelled = true;
      visiblePagesRef.current.clear();
      pageCacheRef.current.clear();
      if (openedDocument) {
        openedDocument.cleanup();
      }
      if (loadingTask) {
        void loadingTask.destroy().catch(() => undefined);
      }
    };
  }, [asset.id]);

  const measuredPage = pageSizes[pageNumber] ?? pageSizes[1] ?? null;
  const displayWidth = readerWidth > 0
    ? Math.max(220, Math.floor(readerWidth * (zoom / 100)))
    : 640;
  const displayHeight = measuredPage
    ? Math.max(220, Math.floor(displayWidth * (measuredPage.height / measuredPage.width)))
    : Math.floor(displayWidth * DEFAULT_PAGE_RATIO);
  const effectivePageCount = pageCount || asset.pageCount || 1;
  const currentPage = clampPage(pageNumber, effectivePageCount);
  const renderWindow = zoom > 140 ? HIGH_ZOOM_RENDER_WINDOW : DEFAULT_RENDER_WINDOW;

  const handleMeasure = React.useCallback((measuredPageNumber: number, width: number, height: number) => {
    setPageSizes((current) => {
      const previous = current[measuredPageNumber];
      if (previous && Math.abs(previous.width - width) < 1 && Math.abs(previous.height - height) < 1) return current;
      return { ...current, [measuredPageNumber]: { width, height } };
    });
  }, []);

  const getCachedPage = React.useCallback(async (requestedPageNumber: number) => {
    if (!pdf) throw new Error("PDF is not ready.");
    const nextPageNumber = clampPage(requestedPageNumber, effectivePageCount);
    const cached = pageCacheRef.current.get(nextPageNumber);
    if (cached) {
      cached.touchedAt = Date.now();
      return cached.page;
    }
    const page = await pdf.getPage(nextPageNumber);
    pageCacheRef.current.set(nextPageNumber, { page, touchedAt: Date.now() });
    trimPageCache(pageCacheRef.current);
    return page;
  }, [pdf, effectivePageCount]);

  React.useEffect(() => {
    if (!pdf || loadState !== "ready" || !effectivePageCount) return undefined;

    let cancelled = false;
    const warmPages: number[] = [];
    for (let offset = 0; offset <= PAGE_PREFETCH_RADIUS; offset += 1) {
      const previous = currentPage - offset;
      const next = currentPage + offset;
      if (previous >= 1) warmPages.push(previous);
      if (offset > 0 && next <= effectivePageCount) warmPages.push(next);
    }

    const warmTimer = window.setTimeout(() => {
      let index = 0;
      const warmNext = () => {
        if (cancelled || index >= warmPages.length) return;
        const nextPage = warmPages[index];
        index += 1;
        void getCachedPage(nextPage)
          .then((page) => {
            if (cancelled) return;
            const viewport = page.getViewport({ scale: 1 });
            handleMeasure(nextPage, viewport.width, viewport.height);
          })
          .finally(() => {
            if (!cancelled) window.setTimeout(warmNext, 48);
          });
      };
      warmNext();
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(warmTimer);
    };
  }, [currentPage, effectivePageCount, getCachedPage, handleMeasure, loadState, pdf]);

  React.useEffect(() => {
    const container = scrollRef.current;
    if (!container || !effectivePageCount) return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const value = Number((entry.target as HTMLElement).dataset.pageNumber);
        if (!Number.isFinite(value)) continue;
        if (entry.isIntersecting && entry.intersectionRatio > 0) {
          visiblePagesRef.current.set(value, {
            ratio: entry.intersectionRatio,
            top: entry.boundingClientRect.top
          });
        } else {
          visiblePagesRef.current.delete(value);
        }
      }

      if (!visiblePagesRef.current.size) return;
      const rootTop = container.getBoundingClientRect().top;
      const best = Array.from(visiblePagesRef.current.entries()).sort((a, b) => {
        const distanceA = Math.abs(a[1].top - rootTop - 12);
        const distanceB = Math.abs(b[1].top - rootTop - 12);
        if (Math.abs(distanceA - distanceB) > 4) return distanceA - distanceB;
        return b[1].ratio - a[1].ratio;
      })[0];
      if (!best) return;
      const nextPage = clampPage(best[0], effectivePageCount);
      if (nextPage !== pageNumber) {
        internalPageChangeRef.current = nextPage;
        onPageChange(nextPage);
      }
    }, {
      root: container,
      threshold: [0, 0.08, 0.25, 0.5, 0.75, 1]
    });

    for (const element of pageRefs.current.values()) {
      observer.observe(element);
    }

    return () => observer.disconnect();
  }, [effectivePageCount, pageNumber, displayHeight, onPageChange]);

  React.useEffect(() => {
    if (!pdf || !effectivePageCount) return;
    if (internalPageChangeRef.current === pageNumber) {
      internalPageChangeRef.current = null;
      return;
    }
    const target = pageRefs.current.get(clampPage(pageNumber, effectivePageCount));
    target?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [pdf, pageNumber, effectivePageCount]);

  const pages = React.useMemo(() => Array.from({ length: effectivePageCount }, (_, index) => index + 1), [effectivePageCount]);
  const annotationsByPage = React.useMemo(() => {
    const map = new Map<number, TextbookPdfAnnotation[]>();
    for (const annotation of annotations) {
      const list = map.get(annotation.pageNumber) ?? [];
      list.push(annotation);
      map.set(annotation.pageNumber, list);
    }
    return map;
  }, [annotations]);

  if (loadState === "error") {
    return <div className="textbook-pdf-status">PDF 没有打开</div>;
  }

  return (
    <div ref={scrollRef} className="textbook-pdf-scroll">
      {loadState === "loading" ? <div className="textbook-pdf-status">打开中</div> : null}
      <div className="textbook-pdf-pages" style={{ gap: PAGE_GAP }}>
        {pages.map((page) => {
          const pageSize = pageSizes[page] ?? measuredPage;
          const pageHeight = pageSize
            ? Math.max(220, Math.floor(displayWidth * (pageSize.height / pageSize.width)))
            : displayHeight;
          const shouldRender = Boolean(pdf && Math.abs(page - currentPage) <= renderWindow);
          const shouldMountAnnotations = Math.abs(page - currentPage) <= renderWindow;
          return (
            <div
              key={page}
              ref={(element) => {
                if (element) pageRefs.current.set(page, element);
                else pageRefs.current.delete(page);
              }}
              className={page === currentPage ? "textbook-pdf-page active" : "textbook-pdf-page"}
              data-page-number={page}
              style={{ width: displayWidth, minHeight: pageHeight }}
            >
              {pdf && shouldRender ? (
                <PdfPageCanvas
                  pageNumber={page}
                  width={displayWidth}
                  height={pageHeight}
                  shouldRender={shouldRender}
                  getPage={getCachedPage}
                  onMeasure={handleMeasure}
                />
              ) : null}
              {shouldMountAnnotations ? (
                <PdfAnnotationLayer
                  pageNumber={page}
                  pageWidth={displayWidth}
                  pageHeight={pageHeight}
                  annotations={annotationsByPage.get(page) ?? []}
                  mode={annotationMode}
                  annotationText={annotationText}
                  selectedAnnotationId={selectedAnnotationId}
                  onCreateAnnotation={onCreateAnnotation}
                  onSelectAnnotation={onSelectAnnotation}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
