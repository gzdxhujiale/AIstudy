import type { KnowledgeDocumentSnapshot } from "../documents/knowledgeDocumentTypes";
import { createEmptyKnowledgeDocumentSnapshot } from "../documents/canvasEditorAdapter";

type SnapshotLike = Partial<KnowledgeDocumentSnapshot> & {
  content?: {
    main?: unknown;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function createTextbookNoteSnapshotFromText(text: string): KnowledgeDocumentSnapshot {
  const snapshot = createEmptyKnowledgeDocumentSnapshot();
  return {
    ...snapshot,
    content: {
      main: [{ value: text || "" }]
    },
    updatedAt: new Date().toISOString()
  };
}

export function normalizeTextbookNoteSnapshot(value: unknown, fallbackText = ""): KnowledgeDocumentSnapshot {
  if (isRecord(value)) {
    const candidate = value as SnapshotLike;
    const main = Array.isArray(candidate.content?.main) ? candidate.content.main : null;
    if (main) {
      const base = createEmptyKnowledgeDocumentSnapshot();
      return {
        ...base,
        ...candidate,
        schemaVersion: 1,
        editor: "aistudy-word",
        content: {
          ...base.content,
          ...(isRecord(candidate.content) ? candidate.content : {}),
          main
        },
        updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString()
      };
    }
  }

  return createTextbookNoteSnapshotFromText(fallbackText);
}

export function extractTextFromSnapshot(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractTextFromSnapshot).join("");
  if (!isRecord(value)) return "";

  let text = typeof value.value === "string" ? value.value : "";
  for (const [key, child] of Object.entries(value)) {
    if (key === "value") continue;
    if (key === "content" || key === "main" || key === "header" || key === "footer" || key === "children" || key === "valueList" || key === "listWrap") {
      text += extractTextFromSnapshot(child);
    }
  }
  return text;
}

export function isBlankTextbookNoteSnapshot(snapshot: KnowledgeDocumentSnapshot | null | undefined) {
  return !extractTextFromSnapshot(snapshot?.content?.main ?? "").replace(/\s/g, "");
}

export function mergeNoteSnapshotIntoDocument(
  existingSnapshot: KnowledgeDocumentSnapshot | null | undefined,
  noteSnapshot: KnowledgeDocumentSnapshot,
  heading: string
): KnowledgeDocumentSnapshot {
  const base = normalizeTextbookNoteSnapshot(existingSnapshot);
  const note = normalizeTextbookNoteSnapshot(noteSnapshot);
  const existingMain = Array.isArray(base.content.main) ? base.content.main : [];
  const noteMain = Array.isArray(note.content.main) ? note.content.main : [];
  const hasExistingContent = !isBlankTextbookNoteSnapshot(base);

  return {
    ...base,
    content: {
      ...base.content,
      main: hasExistingContent
        ? [
            ...existingMain,
            { value: "\n" },
            { value: `${heading}\n`, bold: true },
            ...noteMain
          ]
        : noteMain
    },
    updatedAt: new Date().toISOString()
  };
}
