export type SimpleMindMapNodeData = {
  uid?: string;
  text: string;
  note?: string;
  expand?: boolean;
  [key: string]: unknown;
};

export type SimpleMindMapNode = {
  data: SimpleMindMapNodeData;
  children?: SimpleMindMapNode[];
  [key: string]: unknown;
};

export type MindMapSnapshot = {
  schemaVersion: 1;
  editor: "simple-mind-map";
  editorVersion: string;
  root: SimpleMindMapNode;
  layout: MindMapLayoutType;
  theme?: {
    template?: string;
    config?: unknown;
  };
  view?: unknown;
  updatedAt: string;
};

export type MindMapDocument = {
  courseId: string;
  mapId: string;
  title: string;
  snapshot: MindMapSnapshot | null;
  updatedAt: string | null;
  nodeCount: number;
};

export type MindMapSaveInput = {
  courseId: string;
  mapId?: string;
  title: string;
  snapshot: MindMapSnapshot;
};

export type MindMapCommand =
  | "insert-child"
  | "insert-sibling"
  | "insert-parent"
  | "add-relationship"
  | "add-boundary"
  | "add-summary"
  | "toggle-expand"
  | "set-note"
  | "set-tags"
  | "set-hyperlink"
  | "set-image"
  | "set-marker"
  | "delete-node"
  | "undo"
  | "redo"
  | "fit"
  | "reset-layout"
  | "zoom-in"
  | "zoom-out";

export type MindMapCommandPayload = {
  note?: string;
  tags?: string[];
  hyperlink?: string;
  hyperlinkTitle?: string;
  imageUrl?: string;
  imageTitle?: string;
  markerType?: "priority" | "progress";
  markerValue?: string | null;
};

export type MindMapTextFormat = {
  fontWeight?: "normal" | "bold";
  fontStyle?: "normal" | "italic";
  textDecoration?: "none" | "underline" | "line-through";
  color?: string;
  fontSize?: number;
  textAutoWrapWidth?: number;
  fillColor?: string;
  borderColor?: string;
  borderWidth?: number;
};

export type MindMapTextFormatPatch = Partial<MindMapTextFormat>;

export type MindMapExportType = "png" | "svg" | "xmind" | "json" | "md";

export type MindMapLayoutType =
  | "logicalStructure"
  | "logicalStructureLeft"
  | "mindMap"
  | "organizationStructure"
  | "catalogOrganization"
  | "timeline"
  | "verticalTimeline"
  | "fishbone"
  | "rightFishbone";

export type MindMapSelectedNode = {
  id: string | null;
  title: string;
  textFormat?: MindMapTextFormat;
  topicElements?: {
    note: string;
    tags: string[];
    hyperlink: string;
    hyperlinkTitle: string;
    imageUrl: string;
    imageTitle: string;
    priority: string;
    progress: string;
    expanded: boolean;
  };
};

export type MindMapOutlineItem = {
  id: string;
  nodeId: string | null;
  parentNodeId: string | null;
  title: string;
  level: number;
  path: string;
  parentPath: string | null;
  order: number;
  source: "mindmap";
  childCount: number;
  children: MindMapOutlineItem[];
};

export type MindMapViewportAxisState = {
  position: number;
  size: number;
  enabled: boolean;
};

export type MindMapViewportState = {
  vertical: MindMapViewportAxisState;
  horizontal: MindMapViewportAxisState;
};

export type MindMapViewportAxis = "vertical" | "horizontal";

export type MindMapEditorEvents = {
  onSnapshotChanged?: (snapshot: MindMapSnapshot) => void;
  onNodeSelected?: (node: MindMapSelectedNode) => void;
  onViewportChanged?: (state: MindMapViewportState) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
};

export type MindMapEditorOptions = {
  canvasDragEnabled?: boolean;
};

export type MindMapEditorHandle = {
  getSnapshot: () => MindMapSnapshot | null;
  setSnapshot: (snapshot: MindMapSnapshot) => void;
  selectNode: (nodeId: string) => MindMapSelectedNode | null;
  setLayout: (layout: MindMapLayoutType) => MindMapSnapshot | null;
  applyTextFormat: (patch: MindMapTextFormatPatch) => MindMapSelectedNode | null;
  exec: (command: MindMapCommand, payload?: MindMapCommandPayload) => void;
  exportFile: (type: MindMapExportType, fileName: string) => Promise<void>;
  setCanvasDragEnabled: (enabled: boolean) => void;
  setViewportControlSize: (width: number, height: number) => void;
  scrollViewport: (axis: MindMapViewportAxis, position: number) => void;
  resize: () => void;
  destroy: () => void;
};
