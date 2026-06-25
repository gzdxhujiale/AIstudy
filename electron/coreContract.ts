export const AISTUDY_CORE_CONTRACT = Object.freeze({
  schemaVersion: 1,
  editors: {
    mindMap: "simple-mind-map",
    knowledgeDocument: "aistudy-word"
  },
  mindMap: {
    defaultLayout: "logicalStructure",
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
