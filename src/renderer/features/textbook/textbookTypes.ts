import type { KnowledgeDocumentSnapshot } from "../documents/knowledgeDocumentTypes";

export type TextbookAsset = {
  id: string;
  courseId: string;
  mindMapId: string;
  title: string;
  filePath: string;
  fileName: string;
  byteSize: number;
  pageCount: number;
  lastPage: number;
  createdAt: string;
  updatedAt: string;
};

export type TextbookNote = {
  id: string;
  textbookId: string;
  courseId: string;
  mindMapId: string;
  nodeId: string;
  nodeTitle: string;
  pageNumber: number;
  pageStart: number;
  pageEnd: number;
  content: string;
  snapshot?: KnowledgeDocumentSnapshot;
  createdAt: string;
  updatedAt: string;
};

export type TextbookStore = {
  version: 1;
  assets: TextbookAsset[];
  notes: TextbookNote[];
};

export type TextbookScope = {
  courseId: string;
  mindMapId: string;
};

export type TextbookPdfAnnotationKind = "highlight" | "text";

export type TextbookPdfAnnotation = {
  id: string;
  textbookId: string;
  courseId: string;
  mindMapId: string;
  nodeId: string;
  nodeTitle: string;
  pageNumber: number;
  kind: TextbookPdfAnnotationKind;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

export type TextbookPdfAnnotationLoadResult = {
  databaseAvailable: boolean;
  annotations: TextbookPdfAnnotation[];
};
