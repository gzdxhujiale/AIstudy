export type KnowledgeDocumentElement = unknown;

export type KnowledgeDocumentContent = {
  header?: KnowledgeDocumentElement[];
  main: KnowledgeDocumentElement[];
  footer?: KnowledgeDocumentElement[];
  graffiti?: unknown[];
};

export type KnowledgeDocumentSnapshot = {
  schemaVersion: 1;
  editor: "aistudy-word";
  editorVersion: string;
  content: KnowledgeDocumentContent;
  updatedAt: string;
};

export type KnowledgeDocumentRecord = {
  courseId: string;
  mindMapId: string;
  nodeId: string;
  documentId: string;
  title: string;
  snapshot: KnowledgeDocumentSnapshot;
  updatedAt: string | null;
  byteSize: number;
  hasContent: boolean;
};

export type KnowledgeDocumentStatus = {
  courseId: string;
  mindMapId: string;
  nodeId: string;
  documentId: string;
  title: string;
  updatedAt: string | null;
  byteSize: number;
  hasContent: boolean;
};

export type KnowledgeDocumentSaveInput = {
  courseId: string;
  mindMapId: string;
  nodeId: string;
  title: string;
  snapshot: KnowledgeDocumentSnapshot;
};

export type KnowledgeDocumentCommand =
  | "undo"
  | "redo"
  | "bold"
  | "italic"
  | "underline"
  | "strikeout"
  | "superscript"
  | "subscript"
  | "pageBreak"
  | "separator"
  | "save";

export type KnowledgeDocumentAlignment = "left" | "center" | "right" | "alignment" | "justify";
export type KnowledgeDocumentTitleLevel = "paragraph" | "first" | "second" | "third" | "fourth" | "fifth" | "sixth";
export type KnowledgeDocumentListType = "none" | "ul" | "ol";

export type KnowledgeDocumentFormatState = {
  fontFamily: string;
  fontSize: number;
  color: string;
  highlight: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeout: boolean;
  alignment: KnowledgeDocumentAlignment | null;
  titleLevel: KnowledgeDocumentTitleLevel;
  listType: KnowledgeDocumentListType;
};

export type KnowledgeDocumentEditorHandle = {
  getSnapshot: () => KnowledgeDocumentSnapshot;
  getSelectedText: () => string;
  hasSelection: () => boolean;
  exec: (command: KnowledgeDocumentCommand) => void;
  setFontFamily: (fontFamily: string) => void;
  setFontSize: (size: number) => void;
  setColor: (color: string) => void;
  setHighlight: (color: string | null) => void;
  setTitleLevel: (level: KnowledgeDocumentTitleLevel) => void;
  setAlignment: (alignment: KnowledgeDocumentAlignment) => void;
  setList: (type: KnowledgeDocumentListType) => void;
  insertTable: (rows: number, cols: number) => void;
  startFormatPainter: (reusable: boolean) => boolean;
  clearFormatPainter: () => void;
  focus: () => void;
  destroy: () => void;
};
