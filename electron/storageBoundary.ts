export type StorageBoundaryMode = "db-first" | "db-owned" | "local-preference";

export type StorageBoundaryModule = {
  id: string;
  name: string;
  mode: StorageBoundaryMode;
  owner: "main" | "renderer";
  mysqlTables: string[];
  cacheFiles: string[];
  pendingFiles: string[];
  notes: string;
};

export const STORAGE_BOUNDARY_MODULES: StorageBoundaryModule[] = [
  {
    id: "courses",
    name: "课程与分区",
    mode: "db-first",
    owner: "main",
    mysqlTables: ["course_management_courses", "knowledge_sections"],
    cacheFiles: ["AIstudyPublicData/state/courses.json"],
    pendingFiles: ["AIstudyPublicData/state/course-pending-operations.json"],
    notes: "数据库成功读取后必须刷新本地镜像，包括空数据库结果。"
  },
  {
    id: "mindmaps",
    name: "思维导图",
    mode: "db-first",
    owner: "main",
    mysqlTables: ["mind_maps", "mind_map_snapshots", "mind_map_nodes"],
    cacheFiles: ["IndexedDB:aistudy-local-snapshots"],
    pendingFiles: [],
    notes: "导图快照和节点投影归数据库；本地快照只用于断连兜底。"
  },
  {
    id: "documents",
    name: "节点文档",
    mode: "db-first",
    owner: "main",
    mysqlTables: ["knowledge_documents", "knowledge_document_snapshots", "knowledge_assets", "knowledge_asset_links"],
    cacheFiles: ["IndexedDB:aistudy-local-snapshots"],
    pendingFiles: [],
    notes: "文档正文归快照表；renderer 本地快照只用于恢复。"
  },
  {
    id: "exams",
    name: "题库考试",
    mode: "db-first",
    owner: "main",
    mysqlTables: ["exam_questions", "exam_papers", "exam_paper_sections", "exam_paper_questions", "exam_attempts"],
    cacheFiles: ["IndexedDB:aistudy-local-snapshots"],
    pendingFiles: [],
    notes: "考试数据优先写固定表；本地快照不能作为发布初始数据。"
  },
  {
    id: "textbooks",
    name: "教材资产与笔记",
    mode: "db-first",
    owner: "main",
    mysqlTables: ["textbook_assets", "textbook_notes"],
    cacheFiles: ["AIstudyPublicData/state/textbooks/{courseId}__{mindMapId}.json"],
    pendingFiles: ["AIstudyPublicData/state/textbook-pending-scopes.json", "AIstudyPublicData/state/textbook-database-backed-scopes.json"],
    notes: "教材资产和节点笔记以数据库为准；本地 JSON 只标记断连和升级提拔。"
  },
  {
    id: "textbook-annotations",
    name: "教材 PDF 批注",
    mode: "db-owned",
    owner: "main",
    mysqlTables: ["textbook_annotations"],
    cacheFiles: [],
    pendingFiles: [],
    notes: "PDF 批注不落本地缓存，数据库不可用时暂停写入，避免批注和教材资产脱节。"
  },
  {
    id: "chrome-port-states",
    name: "Chrome 端口状态",
    mode: "db-first",
    owner: "main",
    mysqlTables: ["chrome_port_states"],
    cacheFiles: ["AIstudyPublicCleanData/runtime/chrome-ports.json", "AIstudyPublicCleanData/runtime/chrome-profiles/{platform}-{port}"],
    pendingFiles: [],
    notes: "JSON/MySQL 只保存端口状态元数据；浏览器登录态由稳定 Chrome profile 目录持有，不能打进安装包。"
  },
  {
    id: "error-logs",
    name: "错误日志",
    mode: "db-owned",
    owner: "main",
    mysqlTables: ["app_error_logs"],
    cacheFiles: [],
    pendingFiles: [],
    notes: "用户可读错误归数据库日志；技术细节不进入产品页面。"
  },
  {
    id: "vocabulary-capture",
    name: "词汇实时采集",
    mode: "db-first",
    owner: "main",
    mysqlTables: ["vocabulary_capture_documents", "vocabulary_capture_events"],
    cacheFiles: ["AIstudyPublicData/state/vocabulary-capture.json"],
    pendingFiles: ["AIstudyPublicData/state/vocabulary-capture-pending-events.json"],
    notes: "词汇采集文档和事件优先写入数据库；本地 JSON 只用于断连兜底和恢复后重放。"
  },
  {
    id: "ui-preferences",
    name: "界面偏好",
    mode: "local-preference",
    owner: "renderer",
    mysqlTables: [],
    cacheFiles: ["browser-preference-storage", "IndexedDB:aistudy-local-snapshots"],
    pendingFiles: [],
    notes: "仅保存非权威 UI 偏好；不得保存课程、分区、正文、资产或凭据。"
  }
];

export function summarizeStorageBoundaries() {
  const dbFirst = STORAGE_BOUNDARY_MODULES.filter((item) => item.mode === "db-first").length;
  const dbOwned = STORAGE_BOUNDARY_MODULES.filter((item) => item.mode === "db-owned").length;
  const localPreference = STORAGE_BOUNDARY_MODULES.filter((item) => item.mode === "local-preference").length;
  const missingMysqlOwner = STORAGE_BOUNDARY_MODULES.filter((item) => item.mode !== "local-preference" && item.mysqlTables.length === 0);
  return {
    total: STORAGE_BOUNDARY_MODULES.length,
    dbFirst,
    dbOwned,
    localPreference,
    valid: missingMysqlOwner.length === 0,
    missingMysqlOwnerIds: missingMysqlOwner.map((item) => item.id)
  };
}
