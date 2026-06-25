export const AISTUDY_CORE_CONTRACT = Object.freeze({
  schemaVersion: 1,
  editors: {
    mindMap: "simple-mind-map",
    knowledgeDocument: "aistudy-word"
  },
  mindMap: {
    defaultLayout: "logicalStructure",
    defaultFontSize: 20,
    nodeIdPrefix: "aistudy-node-",
    snapshotRetentionLimit: 12,
    maxSnapshotBytes: 5 * 1024 * 1024
  },
  knowledgeDocument: {
    snapshotRetentionLimit: 80,
    maxSnapshotBytes: 2 * 1024 * 1024
  },
  storage: {
    maxInlineDataUrlBytes: 2 * 1024
  },
  identity: {
    entityIdMaxLength: 64,
    nodeIdMaxLength: 96,
    pattern: /^[A-Za-z0-9:_-]+$/
  }
} as const);

export type KnowledgeDocumentBinding = {
  courseId: string;
  mindMapId: string;
  nodeId: string;
};

function isCoreId(value: string | null | undefined, maxLength: number): value is string {
  return Boolean(value && value.length <= maxLength && AISTUDY_CORE_CONTRACT.identity.pattern.test(value));
}

export function createKnowledgeDocumentBinding(
  courseId: string | null | undefined,
  mindMapId: string | null | undefined,
  nodeId: string | null | undefined
): KnowledgeDocumentBinding | null {
  if (!isCoreId(courseId, AISTUDY_CORE_CONTRACT.identity.entityIdMaxLength)) return null;
  if (!isCoreId(mindMapId, AISTUDY_CORE_CONTRACT.identity.entityIdMaxLength)) return null;
  if (!isCoreId(nodeId, AISTUDY_CORE_CONTRACT.identity.nodeIdMaxLength)) return null;

  return {
    courseId,
    mindMapId,
    nodeId
  };
}
