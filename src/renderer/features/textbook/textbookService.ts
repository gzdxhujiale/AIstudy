import type { TextbookAsset, TextbookScope, TextbookStore } from "./textbookTypes";
import { normalizeTextbookNoteSnapshot } from "./textbookNoteDocument";

declare global {
  interface Window {
    aistudyTextbooks?: {
      load: (scope: TextbookScope) => Promise<unknown>;
      save: (request: TextbookScope & { store: TextbookStore; deletedNoteKeys?: Array<{ textbookId: string; nodeId: string }> }) => Promise<unknown>;
      choosePdf: (scope: TextbookScope) => Promise<unknown>;
      readPdf: (request: TextbookScope & { assetId: string }) => Promise<ArrayBuffer | Uint8Array>;
      openPdfWindow: (request: TextbookScope & { assetId: string; pageNumber: number; zoom: number }) => Promise<unknown>;
    };
  }
}

const STORE_VERSION = 1 as const;

function createEmptyTextbookStore(): TextbookStore {
  return { version: STORE_VERSION, assets: [], notes: [] };
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numberValue)));
}

function normalizeAsset(value: unknown, scope: TextbookScope): TextbookAsset | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<TextbookAsset>;
  const id = normalizeString(candidate.id);
  const courseId = normalizeString(candidate.courseId) || scope.courseId;
  const mindMapId = normalizeString(candidate.mindMapId) || scope.mindMapId;
  const filePath = normalizeString(candidate.filePath);
  if (!id || !filePath || courseId !== scope.courseId || mindMapId !== scope.mindMapId) return null;
  const pageCount = normalizeNumber(candidate.pageCount, 0, 0, 100000);
  return {
    id,
    courseId,
    mindMapId,
    title: normalizeString(candidate.title) || normalizeString(candidate.fileName) || "教材",
    filePath,
    fileName: normalizeString(candidate.fileName) || normalizeString(candidate.title) || "教材.pdf",
    byteSize: normalizeNumber(candidate.byteSize, 0, 0, Number.MAX_SAFE_INTEGER),
    pageCount,
    lastPage: normalizeNumber(candidate.lastPage, 1, 1, pageCount || 100000),
    createdAt: normalizeString(candidate.createdAt) || new Date().toISOString(),
    updatedAt: normalizeString(candidate.updatedAt) || new Date().toISOString()
  };
}

export function normalizeTextbookStore(value: unknown, scope: TextbookScope): TextbookStore {
  if (!value || typeof value !== "object") return createEmptyTextbookStore();
  const candidate = value as Partial<TextbookStore>;
  const assets = Array.isArray(candidate.assets)
    ? candidate.assets.map((asset) => normalizeAsset(asset, scope)).filter((asset): asset is TextbookAsset => Boolean(asset))
    : [];
  const assetIds = new Set(assets.map((asset) => asset.id));
  const notes = Array.isArray(candidate.notes)
    ? candidate.notes
        .filter((note) => note && typeof note === "object")
        .map((note): TextbookStore["notes"][number] | null => {
          const candidateNote = note as Partial<TextbookStore["notes"][number]>;
          const id = normalizeString(candidateNote.id);
          const textbookId = normalizeString(candidateNote.textbookId);
          const courseId = normalizeString(candidateNote.courseId) || scope.courseId;
          const mindMapId = normalizeString(candidateNote.mindMapId) || scope.mindMapId;
          const nodeId = normalizeString(candidateNote.nodeId);
          if (
            !id
            || !textbookId
            || !assetIds.has(textbookId)
            || courseId !== scope.courseId
            || mindMapId !== scope.mindMapId
            || !nodeId
          ) return null;
          const pageNumber = normalizeNumber(candidateNote.pageNumber, 1, 1, 100000);
          const pageStart = normalizeNumber(candidateNote.pageStart, pageNumber, 1, 100000);
          const pageEnd = normalizeNumber(candidateNote.pageEnd, pageStart, 1, 100000);
          return {
            id,
            textbookId,
            courseId,
            mindMapId,
            nodeId,
            nodeTitle: normalizeString(candidateNote.nodeTitle),
            pageNumber,
            pageStart: Math.min(pageStart, pageEnd),
            pageEnd: Math.max(pageStart, pageEnd),
            content: normalizeText(candidateNote.content),
            snapshot: normalizeTextbookNoteSnapshot(candidateNote.snapshot, normalizeText(candidateNote.content)),
            createdAt: normalizeString(candidateNote.createdAt) || new Date().toISOString(),
            updatedAt: normalizeString(candidateNote.updatedAt) || new Date().toISOString()
          };
        })
        .filter((note): note is TextbookStore["notes"][number] => Boolean(note))
    : [];
  return {
    version: STORE_VERSION,
    assets: Array.from(new Map(assets.map((asset) => [asset.id, asset])).values()),
    notes: Array.from(new Map(notes.map((note) => [`${note.textbookId}\u0000${note.nodeId}`, note])).values())
  };
}

function requireTextbookApi() {
  if (!window.aistudyTextbooks) {
    throw new Error("教材服务不可用。");
  }
  return window.aistudyTextbooks;
}

export async function loadTextbookStore(scope: TextbookScope) {
  return normalizeTextbookStore(await requireTextbookApi().load(scope), scope);
}

export async function saveTextbookStore(
  scope: TextbookScope,
  store: TextbookStore,
  options: { deletedNoteKeys?: Array<{ textbookId: string; nodeId: string }> } = {}
) {
  return normalizeTextbookStore(await requireTextbookApi().save({ ...scope, store, ...options }), scope);
}

export async function chooseTextbookPdf(scope: TextbookScope) {
  const result = await requireTextbookApi().choosePdf(scope);
  return normalizeAsset(result, scope);
}

export async function readTextbookPdfData(asset: TextbookAsset) {
  const data = await requireTextbookApi().readPdf({
    courseId: asset.courseId,
    mindMapId: asset.mindMapId,
    assetId: asset.id
  });
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

export async function openTextbookPdfWindow(asset: TextbookAsset, pageNumber: number, zoom: number) {
  await requireTextbookApi().openPdfWindow({
    courseId: asset.courseId,
    mindMapId: asset.mindMapId,
    assetId: asset.id,
    pageNumber,
    zoom
  });
}
