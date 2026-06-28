import { app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, watch, type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import mysql, { type Connection, type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import { Socket } from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { AISTUDY_CORE_CONTRACT } from "./coreContract.js";
import { classifyAppError, createAppError, getAppErrorDefinition } from "./appErrors.js";
import { exportKnowledgeDocumentDocx } from "./documentExport.js";
import { ensureExamTables, readExamStoreFromMysql, writeExamStoreToMysql, type ExamMysqlRuntime } from "./examStore.js";
import {
  createTextbookAssetFromFile,
  ensureTextbookTables,
  normalizeTextbookStore,
  readTextbookStoreFromMysql,
  rememberTextbookAssetPaths,
  resolveTextbookAssetPath,
  textbookStoreHasContent,
  writeTextbookStoreToMysql,
  type TextbookAsset,
  type TextbookMysqlRuntime,
  type TextbookStore
} from "./textbookStore.js";
import { createMcpController } from "./mcp/controller.js";
import { createMcpRemoteAccessController } from "./mcp/remoteAccess.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const PUBLIC_CLEAN_DATA_ROOT_NAME = "AIstudyPublicCleanData";
const execFileAsync = promisify(execFile);
const MIND_MAP_SNAPSHOT_RETENTION_LIMIT = AISTUDY_CORE_CONTRACT.mindMap.snapshotRetentionLimit;
const KNOWLEDGE_DOCUMENT_SNAPSHOT_RETENTION_LIMIT = AISTUDY_CORE_CONTRACT.knowledgeDocument.snapshotRetentionLimit;
const BEFORE_CLOSE_DRAIN_TIMEOUT_MS = 2500;
const INLINE_DATA_URL_PATTERN = /^data:[^;,]+(?:;[^,]+)*;base64,/i;
const UPDATE_DOWNLOAD_CHUNK_SIZE_BYTES = 4 * 1024 * 1024;
const UPDATE_DOWNLOAD_RETRY_LIMIT = 4;
const UPDATE_DOWNLOAD_NET_TIMEOUT_MS = 120000;
const TEXTBOOK_PDF_PROTOCOL = "aistudy-pdf";
const MANAGED_MYSQL_SERVICE_NAME = "AIstudyMySQL";
const MANAGED_MYSQL_START_TIMEOUT_MS = 3500;

protocol.registerSchemesAsPrivileged([
  {
    scheme: TEXTBOOK_PDF_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      corsEnabled: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);

function resolveAistudyUserDataRoot() {
  const configuredRoot = process.env.AISTUDY_PUBLIC_USER_DATA_ROOT?.trim() || process.env.AISTUDY_USER_DATA_ROOT?.trim();
  if (configuredRoot) return configuredRoot;
  if (isDev) return path.join(app.getAppPath(), ".runtime", "user-data");

  const exeDir = path.dirname(app.getPath("exe"));
  const exeDirRoot = path.parse(exeDir).root;
  if (exeDirRoot && !exeDirRoot.toLowerCase().startsWith("c:")) {
    return path.join(exeDir, "AIstudyUserData");
  }

  const fDriveRoot = "F:\\";
  if (existsSync(fDriveRoot)) {
    return path.join(fDriveRoot, PUBLIC_CLEAN_DATA_ROOT_NAME, "user-data");
  }

  return path.join(app.getAppPath(), ".runtime", "user-data");
}

const aistudyUserDataRoot = resolveAistudyUserDataRoot();
mkdirSync(aistudyUserDataRoot, { recursive: true });
app.setPath("userData", aistudyUserDataRoot);

type CourseRecord = {
  id: string;
  name: string;
  description: string;
  sectionId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type CourseSectionRecord = {
  id: string;
  name: string;
  sortOrder: number;
  collapsed: boolean;
  createdAt: string;
  updatedAt: string;
};

type CourseStore = {
  sections: CourseSectionRecord[];
  courses: CourseRecord[];
  activeCourseId: string | null;
};

type CourseSyncStatus = {
  state: "saved" | "waiting" | "attention";
  pendingCount: number;
};

type AppErrorLogEntry = {
  id: string;
  source: string;
  userMessage: string;
  errorCode: string;
  domain: string;
  reason: string;
  action: string;
  retryable: boolean;
  createdAt: string;
};

type CourseCreateRequest = {
  name?: unknown;
  description?: unknown;
  sectionId?: unknown;
};

type CourseLocatorRequest = {
  courseId?: unknown;
  courseName?: unknown;
  courseDescription?: unknown;
  sectionId?: unknown;
  sectionName?: unknown;
};

type CourseRenameRequest = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
};

type CourseMoveRequest = {
  id?: unknown;
  sectionId?: unknown;
};

type CourseReorderRequest = {
  id?: unknown;
  sectionId?: unknown;
  beforeCourseId?: unknown;
};

type CourseSectionNameRequest = {
  name?: unknown;
};

type CourseSectionRenameRequest = {
  id?: unknown;
  name?: unknown;
};

type CourseSectionReorderRequest = {
  id?: unknown;
  beforeSectionId?: unknown;
};

type CourseSectionToggleRequest = {
  id?: unknown;
  collapsed?: unknown;
};

type CourseSectionToggleAllRequest = {
  collapsed?: unknown;
};

type PendingCourseOperation = {
  id: string;
  action:
    | "course:create"
    | "course:rename"
    | "course:move"
    | "course:reorder"
    | "course:delete"
    | "section:create"
    | "section:rename"
    | "section:reorder"
    | "section:toggle"
    | "section:toggle-all"
    | "section:delete";
  payload: Record<string, unknown>;
  createdAt: string;
  retryCount: number;
  lastError?: string;
};

const PENDING_COURSE_OPERATION_ACTIONS = new Set<PendingCourseOperation["action"]>([
  "course:create",
  "course:rename",
  "course:move",
  "course:reorder",
  "course:delete",
  "section:create",
  "section:rename",
  "section:reorder",
  "section:toggle",
  "section:toggle-all",
  "section:delete"
]);

type SimpleMindMapNodeData = {
  uid?: string;
  text?: unknown;
  expand?: unknown;
  [key: string]: unknown;
};

type SimpleMindMapNode = {
  data?: SimpleMindMapNodeData;
  children?: unknown;
  [key: string]: unknown;
};

type MindMapSnapshot = {
  schemaVersion: 1;
  editor: "simple-mind-map";
  editorVersion: string;
  root: SimpleMindMapNode;
  layout: string;
  theme?: unknown;
  view?: unknown;
  updatedAt: string;
};

type MindMapDocument = {
  courseId: string;
  mapId: string;
  title: string;
  snapshot: MindMapSnapshot | null;
  updatedAt: string | null;
  nodeCount: number;
};

type MindMapSaveRequest = {
  courseId: string;
  mapId?: string;
  title?: string;
  snapshot: unknown;
};

type KnowledgeDocumentSnapshot = {
  schemaVersion: 1;
  editor: "aistudy-word";
  editorVersion: string;
  content: unknown;
  updatedAt: string;
};

type KnowledgeDocument = {
  courseId: string;
  mindMapId: string;
  nodeId: string;
  documentId: string;
  title: string;
  snapshot: KnowledgeDocumentSnapshot | null;
  updatedAt: string | null;
  byteSize: number;
  hasContent: boolean;
};

type KnowledgeDocumentStatus = {
  courseId: string;
  mindMapId: string;
  nodeId: string;
  documentId: string;
  title: string;
  updatedAt: string | null;
  byteSize: number;
  hasContent: boolean;
};

type KnowledgeDocumentNodeRequest = {
  courseId: string;
  mindMapId: string;
  nodeId: string;
};

type KnowledgeDocumentStatusRequest = {
  courseId: string;
  mindMapId: string;
};

type KnowledgeDocumentSaveRequest = KnowledgeDocumentNodeRequest & {
  title?: string;
  snapshot: unknown;
};

type MysqlConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  explicitlyConfigured: boolean;
  database: string;
  courseTable: string;
  courseSectionTable: string;
  mindMapTable: string;
  mindMapSnapshotTable: string;
  mindMapNodeTable: string;
  knowledgeDocumentTable: string;
  knowledgeDocumentSnapshotTable: string;
  assetTable: string;
  knowledgeAssetLinkTable: string;
  chromePortStateTable: string;
  errorLogTable: string;
  examQuestionTable: string;
  examPaperTable: string;
  examPaperSectionTable: string;
  examPaperQuestionTable: string;
  examAttemptTable: string;
  textbookAssetTable: string;
  textbookNoteTable: string;
};

type CourseRow = RowDataPacket & {
  id: string;
  name: string;
  description: string;
  sectionId: string | null;
  sortOrder: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type CourseSectionRow = RowDataPacket & {
  id: string;
  name: string;
  sortOrder: number;
  collapsed: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type MysqlRuntime = ExamMysqlRuntime & TextbookMysqlRuntime & {
  courseTable: string;
  courseSectionTable: string;
  mindMapTable: string;
  mindMapSnapshotTable: string;
  mindMapNodeTable: string;
  knowledgeDocumentTable: string;
  knowledgeDocumentSnapshotTable: string;
  assetTable: string;
  knowledgeAssetLinkTable: string;
  chromePortStateTable: string;
  errorLogTable: string;
  textbookAssetTable: string;
  textbookNoteTable: string;
};

const PUBLIC_MYSQL_DATABASE = "aistudy_public";
const PUBLIC_MYSQL_TABLES = {
  courses: "course_management_courses",
  sections: "knowledge_sections",
  mindMaps: "mind_maps",
  mindMapSnapshots: "mind_map_snapshots",
  mindMapNodes: "mind_map_nodes",
  documents: "knowledge_documents",
  documentSnapshots: "knowledge_document_snapshots",
  assets: "knowledge_assets",
  assetLinks: "knowledge_asset_links",
  chromePortStates: "chrome_port_states",
  errorLogs: "app_error_logs",
  examQuestions: "exam_questions",
  examPapers: "exam_papers",
  examPaperSections: "exam_paper_sections",
  examPaperQuestions: "exam_paper_questions",
  examAttempts: "exam_attempts",
  textbookAssets: "textbook_assets",
  textbookNotes: "textbook_notes"
} as const;

type AppErrorLogRow = RowDataPacket & {
  id: string;
  source: string;
  userMessage: string;
  errorCode: string;
  createdAt: Date | string;
};

type ChromePortSavedRow = RowDataPacket & {
  platformId: string;
  port: number;
  profileDir: string;
  savedAt: Date | string;
  authenticatedAt: Date | string;
  detectedUrl: string;
};

type MindMapRow = RowDataPacket & {
  id: string;
  courseId: string;
  title: string;
  currentSnapshotId: string | null;
  nodeCount: number;
  updatedAt: Date | string;
};

type MindMapSnapshotRow = RowDataPacket & {
  payloadJson: string;
};

type CourseNameRow = RowDataPacket & {
  name: string;
};

type SnapshotMetaRow = RowDataPacket & {
  id: string;
  payloadHash: string;
  payloadJson?: string;
  byteSize?: number | string;
};

type MindMapSequenceRow = RowDataPacket & {
  nextSequence: number | string | null;
};

type KnowledgeDocumentRow = RowDataPacket & {
  id: string;
  courseId: string;
  mindMapId: string;
  nodeId: string;
  title: string;
  currentSnapshotId: string | null;
  currentByteSize: number | string;
  hasContent: number | string | boolean;
  updatedAt: Date | string;
};

type KnowledgeDocumentStatusRow = RowDataPacket & {
  id: string;
  courseId: string;
  mindMapId: string;
  nodeId: string;
  title: string;
  currentByteSize: number | string;
  hasContent: number | string | boolean;
  updatedAt: Date | string;
};

type KnowledgeDocumentSnapshotRow = RowDataPacket & {
  payloadJson: string;
  byteSize: number | string;
};

type KnowledgeDocumentContentBackfillRow = RowDataPacket & {
  documentId: string;
  payloadJson: string | null;
};

type KnowledgeDocumentSequenceRow = RowDataPacket & {
  nextSequence: number | string | null;
};

type MysqlSchemaRow = RowDataPacket & {
  COLUMN_NAME?: string;
  INDEX_NAME?: string;
};

type McpNodeSearchRow = RowDataPacket & {
  courseId: string;
  courseName?: string;
  mindMapId: string;
  nodeId: string;
  title: string;
  pathText: string | null;
  depth: number | string;
  updatedAt: Date | string;
};

type MindMapProjectionNode = {
  nodeId: string;
  parentNodeId: string | null;
  title: string;
  depth: number;
  positionIndex: number;
  pathText: string;
  isCollapsed: boolean;
};

type UpdateManagerInfo = {
  appVersion: string;
  repositoryUrl: string;
  repositoryWebUrl: string;
  branch: string;
  commit: string;
  dirty: boolean;
  canUseGit: boolean;
  updateIndexPath: string;
  releaseDir: string;
  installerPath: string;
};

type GitHubReleaseAsset = {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
};

type GitHubRelease = {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  assets?: unknown;
};

type UpdateCheckResult = {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseName: string;
  publishedAt: string;
  releaseUrl: string;
  notes: string[];
  assetName: string;
  assetSize: number;
  downloadUrl: string;
};

type UpdateDownloadResult = {
  filePath: string;
  fileName: string;
  fileSize: number;
};

type UpdateDownloadStatus = "starting" | "downloading" | "paused" | "complete" | "cancelled";

type UpdateDownloadProgress = {
  fileName: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  status: UpdateDownloadStatus;
};

type UpdateDownloadTask = {
  id: string;
  fileName: string;
  tempFilePath: string;
  downloadedBytes: number;
  totalBytes: number;
  status: UpdateDownloadStatus;
  controller: AbortController | null;
};

type RuntimeDiagnosticStatus = "ok" | "warning" | "error" | "disabled";

type RuntimeDiagnosticItem = {
  id: string;
  name: string;
  status: RuntimeDiagnosticStatus;
  message: string;
  action: string;
  retryable: boolean;
};

type RuntimeDiagnosticResult = {
  checkedAt: string;
  summary: {
    ok: number;
    warning: number;
    error: number;
    disabled: number;
  };
  items: RuntimeDiagnosticItem[];
};

type RuntimeDiagnosticReportCopyResult = {
  copied: boolean;
  diagnostic: RuntimeDiagnosticResult;
};

type ChromePortPlatformId = "doubao" | "chatgpt" | "bilibili" | "zhihu" | "zhaopin" | "zhipin" | "xiaohongshu";

type ChromePortDefinition = {
  id: ChromePortPlatformId;
  name: string;
  port: number;
  loginUrl: string;
  hostKeyword: string;
  authCookieDomains: string[];
  authCookieNames: string[];
  authDomKeywords: string[];
};

type ChromePortStatus = ChromePortDefinition & {
  connected: boolean;
  pageDetected: boolean;
  authenticated: boolean;
  saved: boolean;
  profileDir: string;
  statusText: string;
  lastCheckedAt: string;
  savedAt: string;
  authenticatedAt: string;
  detectedUrl: string;
};

type ChromePortOpenResult = {
  status: ChromePortStatus;
  message: string;
  openedUrl?: string;
};

type ChromeDebugTarget = {
  id?: string;
  type?: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

type ChromeCookie = {
  name?: string;
  domain?: string;
  value?: string;
  path?: string;
  expires?: number;
  expirationDate?: number;
  httpOnly?: boolean;
  secure?: boolean;
};

type ChromePortSavedEntry = {
  platformId: ChromePortPlatformId;
  port: number;
  profileDir: string;
  savedAt: string;
  authenticatedAt: string;
  detectedUrl: string;
};

type ChromePortSavedStore = {
  version: 1;
  ports: Partial<Record<ChromePortPlatformId, ChromePortSavedEntry>>;
};

type ChromePortLoginProbe = {
  pageDetected: boolean;
  authenticated: boolean;
  authenticatedAt: string;
  detectedUrl: string;
};

type AiChatProvider = Extract<ChromePortPlatformId, "doubao" | "chatgpt">;

type AiChatRequest = {
  provider?: AiChatProvider;
  message?: string;
  courseTitle?: string;
  nodeTitle?: string;
  contextText?: string;
};

type AiChatResult = {
  ok: boolean;
  provider: AiChatProvider;
  reply: string;
  error?: string;
};

type InformationToolStatus = {
  id: "yt-dlp" | "ffmpeg" | "whisper";
  name: string;
  available: boolean;
  version: string;
  message: string;
};

type InformationBilibiliCollectRequest = {
  upName?: string;
  bvid?: string;
  mid?: string | number;
  pageSize?: number;
};

type InformationBilibiliUp = {
  mid: number;
  name: string;
  face: string;
  spaceUrl: string;
};

type InformationBilibiliVideo = {
  bvid: string;
  aid: number;
  cid: number;
  title: string;
  url: string;
  author: string;
  mid: number;
  publishedAt: string;
  durationSeconds: number;
  description: string;
  coverUrl: string;
  stats: {
    view: number;
    like: number;
    favorite: number;
    coin: number;
    reply: number;
    share: number;
  };
  transcript: {
    status: "available" | "missing" | "blocked";
    text: string;
    message: string;
  };
};

type InformationWorkflowStep = {
  id: "locate" | "read-video" | "read-up" | "list-videos" | "prepare-document";
  name: string;
  status: "pending" | "running" | "done" | "blocked" | "skipped";
  message: string;
};

type InformationBilibiliCollectResult = {
  status: "ready" | "partial" | "blocked";
  message: string;
  up: InformationBilibiliUp | null;
  videos: InformationBilibiliVideo[];
  blockers: string[];
  steps: InformationWorkflowStep[];
  primaryBvid: string;
  collectedAt: string;
};

type InformationProcessStep = {
  id: "metadata" | "subtitle" | "official-text" | "download" | "transcribe";
  name: string;
  status: "pending" | "running" | "done" | "blocked" | "skipped";
  message: string;
};

type InformationBilibiliProcessResult = {
  status: "ready" | "blocked";
  message: string;
  video: InformationBilibiliVideo | null;
  steps: InformationProcessStep[];
  workDir: string;
};

let mainWindow: BrowserWindow | null = null;
let mysqlRuntime: MysqlRuntime | null = null;
let mysqlRuntimePromise: Promise<MysqlRuntime> | null = null;
const beforeCloseResolvers = new Map<string, () => void>();
const CHROME_PORT_MYSQL_STATE_TIMEOUT_MS = 1500;
const chromePortDefinitions: ChromePortDefinition[] = [
  {
    id: "doubao",
    name: "豆包",
    port: 9224,
    loginUrl: "https://www.doubao.com/chat/",
    hostKeyword: "doubao.com/chat",
    authCookieDomains: ["doubao.com"],
    authCookieNames: ["sessionid", "sessionid_ss", "sid_guard", "sid_tt", "uid_tt", "uid_tt_ss", "oauth_token", "oauth_token_v2", "multi_sids"],
    authDomKeywords: ["新对话", "历史对话"]
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    port: 9230,
    loginUrl: "https://chatgpt.com/",
    hostKeyword: "chatgpt.com",
    authCookieDomains: ["chatgpt.com", "openai.com"],
    authCookieNames: ["__Secure-next-auth.session-token", "__Secure-authjs.session-token"],
    authDomKeywords: []
  },
  {
    id: "bilibili",
    name: "Bilibili",
    port: 9231,
    loginUrl: "https://www.bilibili.com/",
    hostKeyword: "bilibili.com",
    authCookieDomains: ["bilibili.com"],
    authCookieNames: ["SESSDATA", "bili_jct", "DedeUserID", "DedeUserID__ckMd5"],
    authDomKeywords: ["动态", "投稿", "消息"]
  },
  {
    id: "zhihu",
    name: "知乎",
    port: 9232,
    loginUrl: "https://www.zhihu.com/",
    hostKeyword: "zhihu.com",
    authCookieDomains: ["zhihu.com"],
    authCookieNames: ["z_c0", "q_c1"],
    authDomKeywords: ["创作中心", "私信", "消息"]
  },
  {
    id: "zhaopin",
    name: "智联招聘",
    port: 9233,
    loginUrl: "https://www.zhaopin.com/",
    hostKeyword: "zhaopin.com",
    authCookieDomains: ["zhaopin.com"],
    authCookieNames: ["zp_at", "zp_token", "at", "rt", "sts_sg", "sts_sid"],
    authDomKeywords: ["我的简历"]
  },
  {
    id: "zhipin",
    name: "BOSS直聘",
    port: 9234,
    loginUrl: "https://www.zhipin.com/",
    hostKeyword: "zhipin.com",
    authCookieDomains: ["zhipin.com"],
    authCookieNames: ["wt2", "wbg", "zp_at", "__zp_stoken__"],
    authDomKeywords: ["我的简历"]
  },
  {
    id: "xiaohongshu",
    name: "小红书",
    port: 9235,
    loginUrl: "https://www.xiaohongshu.com/explore",
    hostKeyword: "xiaohongshu.com",
    authCookieDomains: ["xiaohongshu.com"],
    authCookieNames: ["web_session"],
    authDomKeywords: ["创作中心", "消息"]
  }
];

async function requestRendererBeforeCloseDrain(window: BrowserWindow) {
  if (window.webContents.isDestroyed()) return;

  const token = randomUUID();
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      beforeCloseResolvers.delete(token);
      resolve();
    }, BEFORE_CLOSE_DRAIN_TIMEOUT_MS);

    beforeCloseResolvers.set(token, () => {
      clearTimeout(timeout);
      resolve();
    });

    window.webContents.send("app:before-close", token);
  });
}

function getEventWindow(event: IpcMainInvokeEvent) {
  return BrowserWindow.fromWebContents(event.sender);
}

function getChromePortDefinition(platformId: unknown) {
  return chromePortDefinitions.find((platform) => platform.id === platformId);
}

function getRequiredChromePortDefinition(platformId: unknown) {
  const platform = getChromePortDefinition(platformId);
  if (!platform) {
    throw new Error("未知的 Chrome 端口平台");
  }
  return platform;
}

function normalizeChromePortOpenUrl(platform: ChromePortDefinition, value: unknown) {
  const rawUrl = typeof value === "string" ? value.trim() : "";
  if (!rawUrl) return platform.loginUrl;
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Chrome 端口只能打开网页地址");
    }
    return url.toString();
  } catch {
    throw new Error("Chrome 页面地址无效");
  }
}

function getAistudyDataRoot() {
  const configuredDataRoot = process.env.AISTUDY_PUBLIC_DATA_ROOT?.trim() || process.env.AISTUDY_DATA_ROOT?.trim();
  if (configuredDataRoot) return configuredDataRoot;
  if (isDev) return path.join(app.getAppPath(), ".runtime");

  const exeDir = path.dirname(app.getPath("exe"));
  const exeDirRoot = path.parse(exeDir).root;
  if (exeDirRoot && !exeDirRoot.toLowerCase().startsWith("c:")) {
    return path.join(exeDir, "AIstudyPublicData");
  }

  const fDriveRoot = "F:\\";
  if (existsSync(fDriveRoot)) {
    return path.join(fDriveRoot, PUBLIC_CLEAN_DATA_ROOT_NAME);
  }

  return path.join(app.getPath("userData"), "AIstudyPublicData");
}

function getAistudyDataPath(...segments: string[]) {
  return path.join(getAistudyDataRoot(), ...segments);
}

function getChromePortRuntimeRoot() {
  const configuredRoot = process.env.AISTUDY_PUBLIC_RUNTIME_ROOT?.trim() || process.env.AISTUDY_RUNTIME_ROOT?.trim();
  if (configuredRoot) return configuredRoot;
  return getAistudyDataPath("runtime");
}

function getChromePortProfileDir(platform: ChromePortDefinition) {
  return path.join(getChromePortRuntimeRoot(), "chrome-profiles", `${platform.id}-${platform.port}`);
}

function getChromePortStatePath() {
  return path.join(getChromePortRuntimeRoot(), "chrome-ports.json");
}

function normalizeChromePortSavedStore(value: unknown): ChromePortSavedStore {
  if (!value || typeof value !== "object") {
    return { version: 1, ports: {} };
  }

  const candidate = value as Partial<ChromePortSavedStore>;
  const ports: ChromePortSavedStore["ports"] = {};
  if (candidate.ports && typeof candidate.ports === "object") {
    for (const platform of chromePortDefinitions) {
      const entry = candidate.ports[platform.id] as Partial<ChromePortSavedEntry> | undefined;
      if (!entry || typeof entry !== "object") continue;
      if (entry.platformId !== platform.id || entry.port !== platform.port) continue;
      ports[platform.id] = {
        platformId: platform.id,
        port: platform.port,
        profileDir: typeof entry.profileDir === "string" ? entry.profileDir : getChromePortProfileDir(platform),
        savedAt: typeof entry.savedAt === "string" ? entry.savedAt : "",
        authenticatedAt: typeof entry.authenticatedAt === "string" ? entry.authenticatedAt : "",
        detectedUrl: typeof entry.detectedUrl === "string" ? entry.detectedUrl : ""
      };
    }
  }

  return { version: 1, ports };
}

function getChromePortSavedEntryTime(entry: ChromePortSavedEntry | undefined) {
  if (!entry) return 0;
  return Math.max(
    Date.parse(entry.authenticatedAt || ""),
    Date.parse(entry.savedAt || ""),
    0
  );
}

function mergeChromePortSavedStores(...stores: ChromePortSavedStore[]) {
  const merged: ChromePortSavedStore = { version: 1, ports: {} };
  for (const store of stores) {
    for (const platform of chromePortDefinitions) {
      const next = store.ports[platform.id];
      if (!next) continue;
      const current = merged.ports[platform.id];
      merged.ports[platform.id] = getChromePortSavedEntryTime(next) >= getChromePortSavedEntryTime(current)
        ? next
        : current;
    }
  }
  return merged;
}

async function readLocalChromePortSavedStore() {
  try {
    const raw = await fs.readFile(getChromePortStatePath(), "utf8");
    return normalizeChromePortSavedStore(parseJsonText(raw));
  } catch {
    return { version: 1, ports: {} } satisfies ChromePortSavedStore;
  }
}

async function getMysqlRuntimeForChromePortState(): Promise<MysqlRuntime | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), CHROME_PORT_MYSQL_STATE_TIMEOUT_MS);
    });
    return await Promise.race([getMysqlRuntime(), timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function readMysqlChromePortSavedStore(): Promise<ChromePortSavedStore> {
  try {
    const runtime = await getMysqlRuntimeForChromePortState();
    if (!runtime) {
      return { version: 1, ports: {} };
    }
    const [rows] = await runtime.pool.execute<ChromePortSavedRow[]>(
      `SELECT platform_id AS platformId,
              port,
              profile_dir AS profileDir,
              saved_at AS savedAt,
              authenticated_at AS authenticatedAt,
              detected_url AS detectedUrl
       FROM ${runtime.chromePortStateTable}`
    );
    const ports: ChromePortSavedStore["ports"] = {};
    for (const row of rows) {
      const platform = getChromePortDefinition(row.platformId);
      if (!platform || Number(row.port) !== platform.port) continue;
      ports[platform.id] = {
        platformId: platform.id,
        port: platform.port,
        profileDir: typeof row.profileDir === "string" && row.profileDir ? row.profileDir : getChromePortProfileDir(platform),
        savedAt: toIsoTimestamp(row.savedAt),
        authenticatedAt: toIsoTimestamp(row.authenticatedAt),
        detectedUrl: typeof row.detectedUrl === "string" ? row.detectedUrl : ""
      };
    }
    return { version: 1, ports };
  } catch (error) {
    console.warn("Chrome port MySQL state read failed. Falling back to local state.", error);
    return { version: 1, ports: {} };
  }
}

async function readChromePortSavedStore() {
  const localStore = await readLocalChromePortSavedStore();
  const mysqlStore = await readMysqlChromePortSavedStore();
  const mergedStore = mergeChromePortSavedStores(localStore, mysqlStore);
  if (JSON.stringify(mergedStore) !== JSON.stringify(localStore)) {
    await writeLocalChromePortSavedStore(mergedStore).catch((error) => {
      console.warn("Chrome port local state restore failed.", error);
    });
  }
  return mergedStore;
}

async function writeLocalChromePortSavedStore(store: ChromePortSavedStore) {
  const filePath = getChromePortStatePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function writeMysqlChromePortSavedStore(store: ChromePortSavedStore) {
  try {
    const runtime = await getMysqlRuntimeForChromePortState();
    if (!runtime) {
      return;
    }
    const now = new Date();
    for (const platform of chromePortDefinitions) {
      const entry = store.ports[platform.id];
      if (!entry) continue;
      await runtime.pool.execute(
        `INSERT INTO ${runtime.chromePortStateTable}
          (platform_id, port, profile_dir, saved_at, authenticated_at, detected_url, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          port = VALUES(port),
          profile_dir = VALUES(profile_dir),
          saved_at = VALUES(saved_at),
          authenticated_at = VALUES(authenticated_at),
          detected_url = VALUES(detected_url),
          updated_at = VALUES(updated_at)`,
        [
          entry.platformId,
          entry.port,
          entry.profileDir,
          toMysqlDate(entry.savedAt || new Date().toISOString()),
          toMysqlDate(entry.authenticatedAt || entry.savedAt || new Date().toISOString()),
          entry.detectedUrl,
          now
        ]
      );
    }
  } catch (error) {
    console.warn("Chrome port MySQL state write failed. Local state was kept.", error);
  }
}

async function writeChromePortSavedStore(store: ChromePortSavedStore) {
  await writeLocalChromePortSavedStore(store);
  await writeMysqlChromePortSavedStore(store);
}

async function saveAuthenticatedChromePort(platform: ChromePortDefinition, probe: ChromePortLoginProbe) {
  if (!probe.authenticated) return null;

  const store = await readChromePortSavedStore();
  const now = new Date().toISOString();
  const entry: ChromePortSavedEntry = {
    platformId: platform.id,
    port: platform.port,
    profileDir: getChromePortProfileDir(platform),
    savedAt: store.ports[platform.id]?.savedAt || now,
    authenticatedAt: probe.authenticatedAt || now,
    detectedUrl: probe.detectedUrl
  };
  store.ports[platform.id] = entry;
  await writeChromePortSavedStore(store);
  return entry;
}

function canConnectToLocalPort(port: number, timeoutMs = 800) {
  return new Promise<boolean>((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (connected: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(connected);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, "127.0.0.1");
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForChromePort(port: number, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnectToLocalPort(port, 500)) return true;
    await delay(250);
  }
  return false;
}

async function openUrlInChromePort(port: number, loginUrl: string) {
  const endpoint = `http://127.0.0.1:${port}/json/new?${encodeURIComponent(loginUrl)}`;
  try {
    const response = await fetch(endpoint, { method: "PUT" });
    if (response.ok) return true;
  } catch {
    // Some Chromium builds still accept GET for /json/new; keep this fallback narrow.
  }

  try {
    const response = await fetch(endpoint);
    return response.ok;
  } catch {
    return false;
  }
}

async function fetchChromeJson<T>(url: string, timeoutMs = 1600): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function readChromeDebugTargets(port: number) {
  return await fetchChromeJson<ChromeDebugTarget[]>(`http://127.0.0.1:${port}/json/list`) ?? [];
}

function findPlatformTarget(platform: ChromePortDefinition, targets: ChromeDebugTarget[]) {
  return targets.find((target) => {
    if (target.type !== "page" || typeof target.url !== "string") return false;
    return target.url.includes(platform.hostKeyword) || target.url.includes(new URL(platform.loginUrl).hostname);
  }) ?? null;
}

function cdpStringifyData(value: unknown) {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString("utf8");
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("utf8");
  return "";
}

function sendChromeCdpCommand(wsUrl: string, method: string, params: Record<string, unknown> = {}, timeoutMs = 2200) {
  return new Promise<Record<string, unknown> | null>((resolve) => {
    const commandId = 1;
    const socket = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      try {
        socket.close();
      } catch {
        // The probe is best-effort; a closed socket is fine.
      }
      resolve(null);
    }, timeoutMs);

    const finish = (value: Record<string, unknown> | null) => {
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {
        // The probe is best-effort; a closed socket is fine.
      }
      resolve(value);
    };

    socket.on("open", () => {
      socket.send(JSON.stringify({ id: commandId, method, params }));
    });
    socket.on("error", () => finish(null));
    socket.on("message", (data) => {
      try {
        const message = JSON.parse(cdpStringifyData(data)) as { id?: number; result?: Record<string, unknown> };
        if (message.id === commandId) {
          finish(message.result ?? null);
        }
      } catch {
        finish(null);
      }
    });
  });
}

async function readChromeCookies(target: ChromeDebugTarget) {
  if (!target.webSocketDebuggerUrl) return [];
  const result = await sendChromeCdpCommand(target.webSocketDebuggerUrl, "Network.getAllCookies");
  return Array.isArray(result?.cookies) ? result.cookies.filter((cookie): cookie is ChromeCookie => Boolean(cookie && typeof cookie === "object")) : [];
}

async function readChromePageText(target: ChromeDebugTarget) {
  if (!target.webSocketDebuggerUrl) return "";
  const expression = "document.body ? document.body.innerText.slice(0, 1200) : ''";
  const result = await sendChromeCdpCommand(target.webSocketDebuggerUrl, "Runtime.evaluate", { expression, returnByValue: true });
  const remoteObject = result?.result as { value?: unknown } | undefined;
  return typeof remoteObject?.value === "string" ? remoteObject.value : "";
}

function stripHtmlText(value: unknown) {
  return (typeof value === "string" ? value : "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

const BILIBILI_WBI_MIXIN_KEY_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
] as const;

let bilibiliWbiMixinKeyCache: { key: string; expiresAt: number } | null = null;

function normalizeBilibiliBvid(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  const match = text.match(/BV[0-9A-Za-z]{8,16}/);
  return match?.[0] ?? "";
}

function normalizeBilibiliShortLinkCandidates(value: string) {
  const text = value.trim();
  if (!text || normalizeBilibiliBvid(text)) return [];
  if (/^https?:\/\//i.test(text)) return [text];
  if (/^[0-9A-Za-z_-]{6,40}$/.test(text)) {
    return [`https://b23.tv/${encodeURIComponent(text)}`, `https://bili2233.cn/${encodeURIComponent(text)}`];
  }
  return [];
}

async function resolveBilibiliBvidFromShortLink(value: string, cookieHeader: string) {
  for (const url of normalizeBilibiliShortLinkCandidates(value)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          ...(cookieHeader ? { "cookie": cookieHeader } : {})
        }
      });
      const redirectedBvid = normalizeBilibiliBvid(response.url);
      if (redirectedBvid) return redirectedBvid;
      const body = await response.text().catch(() => "");
      const bodyBvid = normalizeBilibiliBvid(body);
      if (bodyBvid) return bodyBvid;
    } catch {
      // Short-link resolution is opportunistic; unresolved values continue as search clues.
    } finally {
      clearTimeout(timeout);
    }
  }
  return "";
}

function normalizeBilibiliApiMessage(value: unknown, fallback: string) {
  const message = getNonEmptyString(value, fallback);
  if (/request was banned|请求过于频繁|访问频繁|412|Precondition Failed/i.test(message)) {
    return "B站限制了本次访问，请在端口管理打开 B站并保持登录后重试。";
  }
  if (/账号未登录|not login|-101/i.test(message)) {
    return "B站登录态没有带上，请先在端口管理打开 B站并保持登录。";
  }
  return message;
}

function createInformationWorkflowStep(
  id: InformationWorkflowStep["id"],
  name: string,
  status: InformationWorkflowStep["status"],
  message: string
): InformationWorkflowStep {
  return { id, name, status, message };
}

function normalizePositiveNumber(value: unknown, fallback = 0) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeNumber(value: unknown, fallback = 0) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeBilibiliTimestamp(value: unknown) {
  const seconds = normalizePositiveNumber(value, 0);
  if (!seconds) return "";
  return new Date(seconds * 1000).toISOString();
}

function normalizeBilibiliUrl(value: string) {
  if (!value) return "";
  if (value.startsWith("//")) return `https:${value}`;
  if (/^https?:\/\//i.test(value)) return value;
  return value;
}

function readNestedRecord(value: unknown, key: string) {
  if (!value || typeof value !== "object") return null;
  const next = (value as Record<string, unknown>)[key];
  return next && typeof next === "object" ? next as Record<string, unknown> : null;
}

function buildBilibiliCookieHeader(cookies: ChromeCookie[]) {
  return cookies
    .filter((cookie) => cookie.domain?.includes("bilibili.com") && cookie.name && cookie.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

async function getBilibiliCookieHeader() {
  const platform = getRequiredChromePortDefinition("bilibili");
  if (!(await canConnectToLocalPort(platform.port, 500))) return "";
  const targets = await readChromeDebugTargets(platform.port);
  const target = findPlatformTarget(platform, targets);
  if (!target) return "";
  return buildBilibiliCookieHeader(await readChromeCookies(target));
}

async function getBilibiliCookies() {
  const platform = getRequiredChromePortDefinition("bilibili");
  if (!(await canConnectToLocalPort(platform.port, 500))) return [];
  const targets = await readChromeDebugTargets(platform.port);
  const target = findPlatformTarget(platform, targets);
  if (!target) return [];
  return (await readChromeCookies(target)).filter((cookie) => cookie.domain?.includes("bilibili.com") && cookie.name && cookie.value);
}

function toNetscapeCookieLine(cookie: ChromeCookie) {
  const domain = cookie.domain || ".bilibili.com";
  const includeSubdomains = domain.startsWith(".") ? "TRUE" : "FALSE";
  const pathValue = cookie.path || "/";
  const secure = cookie.secure ? "TRUE" : "FALSE";
  const expires = Math.max(0, Math.floor(Number(cookie.expires ?? cookie.expirationDate ?? 0)));
  return [domain, includeSubdomains, pathValue, secure, String(expires), cookie.name ?? "", cookie.value ?? ""].join("\t");
}

async function writeBilibiliCookiesFile(workDir: string) {
  const cookies = await getBilibiliCookies();
  if (cookies.length === 0) return "";
  const cookiePath = path.join(workDir, "bilibili-cookies.txt");
  const lines = [
    "# Netscape HTTP Cookie File",
    "# Generated by AIstudy information collection.",
    ...cookies.map(toNetscapeCookieLine)
  ];
  await fs.writeFile(cookiePath, `${lines.join("\n")}\n`, "utf8");
  return cookiePath;
}

async function fetchBilibiliJson<T>(url: string, referer: string, cookieHeader = "", timeoutMs = 10000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        "accept": "application/json,text/plain,*/*",
        "referer": referer,
        ...(cookieHeader ? { "cookie": cookieHeader } : {})
      }
    });
    if (!response.ok) {
      let message = `B站返回 ${response.status}`;
      try {
        const body = await response.json() as Record<string, unknown>;
        message = normalizeBilibiliApiMessage(body.message, message);
      } catch {
        message = normalizeBilibiliApiMessage(message, message);
      }
      throw new Error(message);
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

function getBilibiliWbiImageKey(value: unknown) {
  const url = typeof value === "string" ? value : "";
  const fileName = url.split("/").pop() ?? "";
  return fileName.split(".")[0] ?? "";
}

function createBilibiliWbiMixinKey(imgKey: string, subKey: string) {
  const source = `${imgKey}${subKey}`;
  return BILIBILI_WBI_MIXIN_KEY_TABLE.map((index) => source[index] ?? "").join("").slice(0, 32);
}

async function getBilibiliWbiMixinKey(cookieHeader: string) {
  const now = Date.now();
  if (bilibiliWbiMixinKeyCache && bilibiliWbiMixinKeyCache.expiresAt > now) {
    return bilibiliWbiMixinKeyCache.key;
  }

  const nav = await fetchBilibiliJson<Record<string, unknown>>("https://api.bilibili.com/x/web-interface/nav", "https://www.bilibili.com/", cookieHeader);
  const data = readNestedRecord(nav, "data");
  const wbiImage = data ? readNestedRecord(data, "wbi_img") : null;
  const imgKey = getBilibiliWbiImageKey(wbiImage?.img_url);
  const subKey = getBilibiliWbiImageKey(wbiImage?.sub_url);
  const mixinKey = createBilibiliWbiMixinKey(imgKey, subKey);
  if (!mixinKey) {
    throw new Error("B站列表签名没有准备好。");
  }
  bilibiliWbiMixinKeyCache = { key: mixinKey, expiresAt: now + 10 * 60 * 1000 };
  return mixinKey;
}

function createBilibiliWbiSignedQuery(params: Record<string, string | number | boolean>, mixinKey: string) {
  const signedParams = {
    ...params,
    wts: Math.floor(Date.now() / 1000)
  };
  const query = Object.entries(signedParams)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value).replace(/[!'()*]/g, ""))}`)
    .join("&");
  const wRid = createHash("md5").update(`${query}${mixinKey}`).digest("hex");
  return `${query}&w_rid=${wRid}`;
}

async function fetchBilibiliWbiJson<T>(
  baseUrl: string,
  params: Record<string, string | number | boolean>,
  referer: string,
  cookieHeader: string,
  timeoutMs = 10000
) {
  const mixinKey = await getBilibiliWbiMixinKey(cookieHeader);
  const query = createBilibiliWbiSignedQuery(params, mixinKey);
  return fetchBilibiliJson<T>(`${baseUrl}?${query}`, referer, cookieHeader, timeoutMs);
}

function normalizeBilibiliVideoFromView(data: Record<string, unknown>): InformationBilibiliVideo {
  const owner = readNestedRecord(data, "owner") ?? {};
  const stat = readNestedRecord(data, "stat") ?? {};
  const bvid = getNonEmptyString(data.bvid);
  return {
    bvid,
    aid: normalizePositiveNumber(data.aid, 0),
    cid: normalizePositiveNumber(data.cid, 0),
    title: getNonEmptyString(data.title, "未命名视频"),
    url: `https://www.bilibili.com/video/${bvid}/`,
    author: getNonEmptyString(owner.name, "未知 UP"),
    mid: normalizePositiveNumber(owner.mid, 0),
    publishedAt: normalizeBilibiliTimestamp(data.pubdate),
    durationSeconds: normalizePositiveNumber(data.duration, 0),
    description: getNonEmptyString(data.desc, ""),
    coverUrl: normalizeBilibiliUrl(getNonEmptyString(data.pic, "")),
    stats: {
      view: normalizePositiveNumber(stat.view, 0),
      like: normalizePositiveNumber(stat.like, 0),
      favorite: normalizePositiveNumber(stat.favorite, 0),
      coin: normalizePositiveNumber(stat.coin, 0),
      reply: normalizePositiveNumber(stat.reply, 0),
      share: normalizePositiveNumber(stat.share, 0)
    },
    transcript: {
      status: "missing",
      text: "",
      message: "该视频没有检测到公开字幕，需要下载音频后转录。"
    }
  };
}

function normalizeBilibiliVideoFromSpace(item: Record<string, unknown>, up: InformationBilibiliUp): InformationBilibiliVideo {
  const bvid = getNonEmptyString(item.bvid);
  return {
    bvid,
    aid: normalizePositiveNumber(item.aid, 0),
    cid: 0,
    title: stripHtmlText(item.title) || "未命名视频",
    url: `https://www.bilibili.com/video/${bvid}/`,
    author: up.name,
    mid: up.mid,
    publishedAt: normalizeBilibiliTimestamp(item.created),
    durationSeconds: 0,
    description: getNonEmptyString(item.description, ""),
    coverUrl: normalizeBilibiliUrl(getNonEmptyString(item.pic, "")),
    stats: {
      view: normalizePositiveNumber(item.play, 0),
      like: 0,
      favorite: 0,
      coin: 0,
      reply: normalizePositiveNumber(item.comment, 0),
      share: 0
    },
    transcript: {
      status: "missing",
      text: "",
      message: "列表记录未包含字幕，需要选择视频后再检测。"
    }
  };
}

function normalizeBilibiliVideoFromSearch(item: Record<string, unknown>): InformationBilibiliVideo {
  const bvid = getNonEmptyString(item.bvid);
  const author = stripHtmlText(item.author) || stripHtmlText(item.author_name) || "未知 UP";
  return {
    bvid,
    aid: normalizePositiveNumber(item.aid, 0),
    cid: 0,
    title: stripHtmlText(item.title) || "未命名视频",
    url: normalizeBilibiliUrl(getNonEmptyString(item.arcurl, "")) || `https://www.bilibili.com/video/${bvid}/`,
    author,
    mid: normalizePositiveNumber(item.mid, 0),
    publishedAt: normalizeBilibiliTimestamp(item.pubdate),
    durationSeconds: 0,
    description: stripHtmlText(item.description) || "",
    coverUrl: normalizeBilibiliUrl(getNonEmptyString(item.pic, "")),
    stats: {
      view: normalizePositiveNumber(item.play, 0),
      like: 0,
      favorite: 0,
      coin: 0,
      reply: normalizePositiveNumber(item.review, 0),
      share: 0
    },
    transcript: {
      status: "missing",
      text: "",
      message: "搜索候选未包含字幕，需要选择视频后再检测。"
    }
  };
}

async function fetchBilibiliVideoTranscript(video: InformationBilibiliVideo, cookieHeader: string) {
  if (!video.cid) return video;
  try {
    const playerUrl = `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(video.bvid)}&cid=${video.cid}`;
    const player = await fetchBilibiliJson<Record<string, unknown>>(playerUrl, video.url, cookieHeader);
    const data = readNestedRecord(player, "data");
    const subtitle = data ? readNestedRecord(data, "subtitle") : null;
    const subtitles = Array.isArray(subtitle?.subtitles) ? subtitle.subtitles : [];
    const firstSubtitle = subtitles.find((item) => item && typeof item === "object") as Record<string, unknown> | undefined;
    const rawSubtitleUrl = getNonEmptyString(firstSubtitle?.subtitle_url, "");
    if (!rawSubtitleUrl) return video;
    const subtitleUrl = normalizeBilibiliUrl(rawSubtitleUrl);
    const subtitleJson = await fetchBilibiliJson<Record<string, unknown>>(subtitleUrl, video.url, cookieHeader);
    const body = Array.isArray(subtitleJson.body) ? subtitleJson.body : [];
    const text = body
      .map((item) => (item && typeof item === "object" ? getNonEmptyString((item as Record<string, unknown>).content, "") : ""))
      .filter(Boolean)
      .join("\n");
    if (!text.trim()) return video;
    return {
      ...video,
      transcript: {
        status: "available" as const,
        text,
        message: "已读取公开字幕。"
      }
    };
  } catch {
    return {
      ...video,
      transcript: {
        status: "blocked" as const,
        text: "",
        message: "字幕检测没有完成，需要稍后重试或走音频转录。"
      }
    };
  }
}

async function resolveBilibiliUpByName(upName: string, cookieHeader: string): Promise<InformationBilibiliUp | null> {
  const keyword = upName.trim();
  if (!keyword) return null;
  const searchUrl = `https://api.bilibili.com/x/web-interface/search/type?search_type=bili_user&keyword=${encodeURIComponent(keyword)}`;
  const result = await fetchBilibiliJson<Record<string, unknown>>(searchUrl, "https://search.bilibili.com/", cookieHeader);
  if (normalizeNumber(result.code, -1) !== 0) return null;
  const data = readNestedRecord(result, "data");
  const users = Array.isArray(data?.result) ? data.result : [];
  const exact = users.find((item) => {
    if (!item || typeof item !== "object") return false;
    return stripHtmlText((item as Record<string, unknown>).uname) === keyword;
  }) ?? users[0];
  if (!exact || typeof exact !== "object") return null;
  const record = exact as Record<string, unknown>;
  const mid = normalizePositiveNumber(record.mid, 0);
  if (!mid) return null;
  const name = stripHtmlText(record.uname) || keyword;
  return {
    mid,
    name,
    face: normalizeBilibiliUrl(getNonEmptyString(record.upic, "")),
    spaceUrl: `https://space.bilibili.com/${mid}/video`
  };
}

async function searchBilibiliVideosByKeyword(keyword: string, upName: string, cookieHeader: string) {
  const cleanKeyword = keyword.trim();
  if (!cleanKeyword) return [];
  const searchKeyword = upName.trim() ? `${upName.trim()} ${cleanKeyword}` : cleanKeyword;
  const searchUrl = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(searchKeyword)}`;
  const result = await fetchBilibiliJson<Record<string, unknown>>(searchUrl, "https://search.bilibili.com/", cookieHeader);
  if (normalizeNumber(result.code, -1) !== 0) {
    throw new Error(normalizeBilibiliApiMessage(result.message, "视频搜索暂时没有读取到"));
  }
  const data = readNestedRecord(result, "data");
  const items = Array.isArray(data?.result) ? data.result : [];
  const videos = items
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map(normalizeBilibiliVideoFromSearch)
    .filter((video) => video.bvid);
  if (!upName.trim()) return videos;
  return videos.filter((video) => video.author === upName.trim());
}

async function fetchBilibiliVideoByBvid(bvid: string, cookieHeader: string): Promise<InformationBilibiliVideo> {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  const result = await fetchBilibiliJson<Record<string, unknown>>(url, `https://www.bilibili.com/video/${bvid}/`, cookieHeader);
  if (normalizeNumber(result.code, -1) !== 0) {
    throw new Error(normalizeBilibiliApiMessage(result.message, "视频信息没有读取到"));
  }
  const data = readNestedRecord(result, "data");
  if (!data) throw new Error("视频信息没有读取到");
  return fetchBilibiliVideoTranscript(normalizeBilibiliVideoFromView(data), cookieHeader);
}

function normalizeBilibiliVideosFromUpResult(result: Record<string, unknown>, up: InformationBilibiliUp) {
  const code = normalizeNumber(result.code, -1);
  if (code !== 0) {
    throw new Error(normalizeBilibiliApiMessage(result.message, "UP 视频列表暂时没有读取到"));
  }
  const data = readNestedRecord(result, "data");
  const list = data ? readNestedRecord(data, "list") : null;
  const vlist = Array.isArray(list?.vlist) ? list.vlist : [];
  return vlist
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => normalizeBilibiliVideoFromSpace(item, up));
}

async function fetchBilibiliUpVideos(up: InformationBilibiliUp, cookieHeader: string, pageSize: number) {
  const wbiParams = {
    mid: up.mid,
    ps: pageSize,
    tid: 0,
    pn: 1,
    keyword: "",
    order: "pubdate",
    platform: "web",
    web_location: 1550101,
    order_avoided: true
  };
  try {
    const result = await fetchBilibiliWbiJson<Record<string, unknown>>("https://api.bilibili.com/x/space/wbi/arc/search", wbiParams, up.spaceUrl, cookieHeader);
    return normalizeBilibiliVideosFromUpResult(result, up);
  } catch (wbiError) {
    const url = `https://api.bilibili.com/x/space/arc/search?mid=${up.mid}&ps=${pageSize}&pn=1&order=pubdate`;
    try {
      const result = await fetchBilibiliJson<Record<string, unknown>>(url, up.spaceUrl, cookieHeader);
      return normalizeBilibiliVideosFromUpResult(result, up);
    } catch (legacyError) {
      const error = legacyError instanceof Error ? legacyError : wbiError;
      throw error instanceof Error ? error : new Error("UP 视频列表暂时没有读取到");
    }
  }
}

function matchesBilibiliVideoClue(video: InformationBilibiliVideo, clue: string) {
  const normalizedClue = clue.trim().toLowerCase();
  if (!normalizedClue) return true;
  return [video.bvid, video.title, video.description, video.author]
    .some((value) => value.toLowerCase().includes(normalizedClue));
}

function dedupeBilibiliVideos(videos: InformationBilibiliVideo[]) {
  const seen = new Set<string>();
  const result: InformationBilibiliVideo[] = [];
  for (const video of videos) {
    if (!video.bvid || seen.has(video.bvid)) continue;
    seen.add(video.bvid);
    result.push(video);
  }
  return result;
}

async function hydratePrimaryBilibiliVideo(videos: InformationBilibiliVideo[], cookieHeader: string) {
  const primary = videos[0];
  if (!primary?.bvid) return videos;
  try {
    const fullVideo = await fetchBilibiliVideoByBvid(primary.bvid, cookieHeader);
    return dedupeBilibiliVideos([fullVideo, ...videos.slice(1)]);
  } catch {
    return videos;
  }
}

async function collectBilibiliInformation(input: unknown): Promise<InformationBilibiliCollectResult> {
  const request = input && typeof input === "object" ? input as InformationBilibiliCollectRequest : {};
  const upName = typeof request.upName === "string" ? request.upName.trim().slice(0, 80) : "";
  const rawVideoInput = typeof request.bvid === "string" ? request.bvid.trim() : "";
  let requestedBvid = normalizeBilibiliBvid(request.bvid);
  const requestedMid = normalizePositiveNumber(request.mid, 0);
  const pageSize = Math.min(50, Math.max(5, normalizePositiveNumber(request.pageSize, 20)));
  const blockers: string[] = [];
  const steps: InformationWorkflowStep[] = [
    createInformationWorkflowStep("locate", "定位视频", "pending", "等待输入。"),
    createInformationWorkflowStep("read-up", "确认 UP", "pending", "等待定位。"),
    createInformationWorkflowStep("list-videos", "读取候选", "pending", "等待 UP。"),
    createInformationWorkflowStep("read-video", "读取内容", "pending", "等待视频。"),
    createInformationWorkflowStep("prepare-document", "生成 Word", "pending", "等待内容。")
  ];
  const updateStep = (
    id: InformationWorkflowStep["id"],
    status: InformationWorkflowStep["status"],
    message: string
  ) => {
    const index = steps.findIndex((step) => step.id === id);
    if (index >= 0) steps[index] = { ...steps[index], status, message };
  };
  let up: InformationBilibiliUp | null = requestedMid
    ? { mid: requestedMid, name: upName || `UID ${requestedMid}`, face: "", spaceUrl: `https://space.bilibili.com/${requestedMid}/video` }
    : null;
  let selectedVideo: InformationBilibiliVideo | null = null;
  let videos: InformationBilibiliVideo[] = [];
  const createResult = (status: InformationBilibiliCollectResult["status"], message: string) => ({
    status,
    message,
    up,
    videos,
    blockers,
    steps,
    primaryBvid: videos[0]?.bvid ?? "",
    collectedAt: new Date().toISOString()
  });

  if (!upName && !rawVideoInput && !requestedMid) {
    updateStep("locate", "blocked", "需要输入 UP、BV、链接或视频线索。");
    updateStep("prepare-document", "blocked", "没有可用内容。");
    blockers.push("需要输入 UP、BV、链接或视频线索。");
    return createResult("blocked", "视频没有定位到。");
  }

  const cookieHeader = await getBilibiliCookieHeader();
  updateStep("locate", "running", "正在解析输入。");
  if (rawVideoInput && !requestedBvid) {
    const shortLinkBvid = await resolveBilibiliBvidFromShortLink(rawVideoInput, cookieHeader);
    if (shortLinkBvid) {
      requestedBvid = shortLinkBvid;
      updateStep("locate", "done", `已解析短链：${shortLinkBvid}`);
    }
  }
  if (requestedBvid) {
    updateStep("locate", "done", `已识别 BV：${requestedBvid}`);
    updateStep("read-up", "skipped", "精准视频会从视频信息里确认 UP。");
    updateStep("list-videos", "skipped", "精准视频采集不读取 UP 列表。");
    updateStep("read-video", "running", "正在读取视频信息和字幕。");
    try {
      selectedVideo = await fetchBilibiliVideoByBvid(requestedBvid, cookieHeader);
      videos = [selectedVideo];
      up = {
        mid: selectedVideo.mid,
        name: selectedVideo.author,
        face: "",
        spaceUrl: `https://space.bilibili.com/${selectedVideo.mid}/video`
      };
      updateStep("read-up", "done", `已确认 UP：${selectedVideo.author}`);
      updateStep("read-video", "done", "已读取视频信息。");
      updateStep("prepare-document", "done", "Word 预览已生成。");
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : "指定视频没有读取到。");
      updateStep("read-video", "blocked", blockers[blockers.length - 1]);
      updateStep("prepare-document", "blocked", "没有可用内容。");
    }
    const status: InformationBilibiliCollectResult["status"] = selectedVideo
      ? blockers.length > 0 ? "partial" : "ready"
      : "blocked";
    return createResult(
      status,
      status === "ready"
        ? "已完成精准视频采集。"
        : status === "partial"
          ? "已拿到视频，部分信息需要后续处理。"
          : "视频没有读取到。"
    );
  }

  updateStep("locate", rawVideoInput ? "done" : "skipped", rawVideoInput ? "已作为视频线索处理。" : "未提供视频线索，按 UP 最新视频处理。");

  if (!up && upName) {
    updateStep("read-up", "running", "正在确认 UP。");
    try {
      up = await resolveBilibiliUpByName(upName, cookieHeader);
      if (up) {
        updateStep("read-up", "done", `已确认 UP：${up.name}`);
      } else {
        blockers.push("没有确认到这个 UP 主，可以先打开 B站端口完成登录后再试。");
        updateStep("read-up", "blocked", blockers[blockers.length - 1]);
      }
    } catch {
      blockers.push("UP 主搜索受到 B站访问限制，可以先打开 B站端口完成登录后再试。");
      updateStep("read-up", "blocked", blockers[blockers.length - 1]);
    }
  } else if (up) {
    updateStep("read-up", "done", `已确认 UP：${up.name}`);
  } else {
    updateStep("read-up", "skipped", "未提供 UP。");
  }

  if (up) {
    updateStep("list-videos", "running", "正在读取 UP 视频候选。");
    try {
      videos = await fetchBilibiliUpVideos(up, cookieHeader, pageSize);
      updateStep("list-videos", videos.length ? "done" : "blocked", videos.length ? `已读取 ${videos.length} 条候选。` : "UP 暂无可用视频候选。");
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : "UP 视频列表暂时没有读取到。");
      updateStep("list-videos", "blocked", blockers[blockers.length - 1]);
    }
  }

  if (rawVideoInput) {
    const listMatches = videos.filter((video) => matchesBilibiliVideoClue(video, rawVideoInput));
    if (listMatches.length > 0) {
      videos = dedupeBilibiliVideos([...listMatches, ...videos]);
      updateStep("locate", "done", `已按线索定位到 ${listMatches.length} 个候选。`);
    } else {
      try {
        const searchMatches = (await searchBilibiliVideosByKeyword(rawVideoInput, up?.name ?? upName, cookieHeader))
          .filter((video) => matchesBilibiliVideoClue(video, rawVideoInput));
        if (searchMatches.length > 0) {
          videos = dedupeBilibiliVideos([...searchMatches, ...videos]);
          updateStep("locate", "done", `已通过搜索定位到 ${searchMatches.length} 个候选。`);
        } else if (videos.length > 0) {
          blockers.push("没有按该视频线索定位到唯一视频，已返回该 UP 最新视频候选。");
          updateStep("locate", "skipped", "线索没有唯一命中，已保留 UP 候选列表。");
        } else {
          blockers.push("没有按该视频线索定位到视频。");
          updateStep("locate", "blocked", blockers[blockers.length - 1]);
        }
      } catch (error) {
        blockers.push(error instanceof Error ? error.message : "视频线索搜索没有完成。");
        updateStep("locate", videos.length ? "skipped" : "blocked", videos.length ? "线索搜索失败，已保留 UP 候选列表。" : blockers[blockers.length - 1]);
      }
    }
  }

  if (videos.length > 0) {
    updateStep("read-video", "running", "正在读取首个候选的完整内容。");
    videos = await hydratePrimaryBilibiliVideo(videos, cookieHeader);
    updateStep("read-video", "done", "已读取首个候选内容。");
    updateStep("prepare-document", "done", "Word 预览已生成。");
  } else {
    updateStep("read-video", "blocked", "没有可读取的视频。");
    updateStep("prepare-document", "blocked", "没有可用内容。");
  }

  const status: InformationBilibiliCollectResult["status"] = videos.length > 0
    ? blockers.length > 0 ? "partial" : "ready"
    : "blocked";

  return {
    status,
    message: status === "ready"
      ? "已完成采集。"
      : status === "partial"
        ? "已拿到部分结果，还有部分步骤需要处理。"
        : "暂时没有拿到可用结果。",
    up,
    videos,
    blockers,
    steps,
    primaryBvid: videos[0]?.bvid ?? "",
    collectedAt: new Date().toISOString()
  };
}

async function readInformationToolStatus(): Promise<InformationToolStatus[]> {
  const tools: Array<{ id: InformationToolStatus["id"]; name: string; command: string; args: string[]; missingMessage: string }> = [
    { id: "yt-dlp", name: "视频下载", command: "yt-dlp", args: ["--version"], missingMessage: "未检测到视频下载工具。" },
    { id: "ffmpeg", name: "音频处理", command: "ffmpeg", args: ["-version"], missingMessage: "未检测到音频处理工具。" },
    { id: "whisper", name: "语音转写", command: "whisper", args: ["--help"], missingMessage: "未检测到本地转写工具。" }
  ];

  return Promise.all(tools.map(async (tool) => {
    try {
      const result = await execFileAsync(tool.command, tool.args, { timeout: 5000, windowsHide: true });
      const version = `${result.stdout || result.stderr}`.split(/\r?\n/)[0]?.trim() ?? "";
      return {
        id: tool.id,
        name: tool.name,
        available: true,
        version,
        message: "已就绪"
      };
    } catch {
      return {
        id: tool.id,
        name: tool.name,
        available: false,
        version: "",
        message: tool.missingMessage
      };
    }
  }));
}

function createInformationStep(
  id: InformationProcessStep["id"],
  name: string,
  status: InformationProcessStep["status"],
  message: string
): InformationProcessStep {
  return { id, name, status, message };
}

function getInformationCollectionRuntimeRoot() {
  return getAistudyDataPath("runtime", "information-collection");
}

function sanitizeFileSegment(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "untitled";
}

async function readTextFilesFromDirectory(dirPath: string, extensions: string[]) {
  const collected: string[] = [];
  const files = await fs.readdir(dirPath).catch(() => []);
  for (const fileName of files) {
    const lowerName = fileName.toLowerCase();
    if (!extensions.some((extension) => lowerName.endsWith(extension))) continue;
    const rawText = await fs.readFile(path.join(dirPath, fileName), "utf8").catch(() => "");
    if (!rawText.trim()) continue;
    collected.push(rawText);
  }
  return collected;
}

function normalizeSubtitleText(rawText: string) {
  return rawText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line !== "WEBVTT" && !/^\d+$/.test(line) && !/^\d\d:\d\d[:.]/.test(line))
    .join("\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function describeBilibiliToolFailure(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/412|Precondition Failed/i.test(message)) {
    return "B站限制了本次访问。请在端口管理打开 B站、确认已登录后重试。";
  }
  if (/cookies?/i.test(message)) {
    return "B站登录态没有带上。请先通过端口管理打开 B站并保持登录。";
  }
  if (/ffmpeg/i.test(message)) {
    return "ffmpeg 没有准备好，音频无法处理。";
  }
  if (/timed? out|timeout/i.test(message)) {
    return "该步骤执行超时，请稍后重试或先打开 B站端口确认视频可播放。";
  }
  return fallback;
}

function extractFirstUrl(value: string) {
  return value.match(/https?:\/\/[^\s"'<>]+/i)?.[0] ?? "";
}

function decodeHtmlText(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function stripHtmlToText(html: string) {
  return decodeHtmlText(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/section>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractWeixinArticleText(html: string) {
  if (/环境异常|captcha|继续访问/.test(html) && !/js_content|rich_media_content/.test(html)) {
    return { blocked: true, text: "", title: "" };
  }

  const title = decodeHtmlText(
    html.match(/var msg_title = "([\s\S]*?)";/)?.[1]
    || html.match(/<meta property="og:title" content="([\s\S]*?)"/)?.[1]
    || html.match(/<title>([\s\S]*?)<\/title>/)?.[1]
    || ""
  ).trim();

  const contentMatch =
    html.match(/<div[^>]+id="js_content"[\s\S]*?<\/div>\s*<\/div>/i)
    || html.match(/<div[^>]+class="[^"]*rich_media_content[^"]*"[\s\S]*?<\/div>/i);
  const text = contentMatch ? stripHtmlToText(contentMatch[0]) : "";
  return { blocked: false, text, title };
}

async function fetchOfficialArticleText(url: string, workDir: string) {
  if (!url) return { status: "missing" as const, text: "", message: "视频简介没有发现文字稿链接。" };
  try {
    const html = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    }).then((response) => response.text());
    await fs.writeFile(path.join(workDir, "official-article.html"), html, "utf8").catch(() => undefined);
    if (url.includes("mp.weixin.qq.com")) {
      const article = extractWeixinArticleText(html);
      if (article.blocked) {
        return { status: "blocked" as const, text: "", message: "文字稿页面需要在浏览器里完成访问验证。" };
      }
      if (article.text.length > 80) {
        await fs.writeFile(path.join(workDir, "official-article.txt"), article.text, "utf8").catch(() => undefined);
        return { status: "available" as const, text: article.text, message: "已读取视频简介中的官方文字稿。" };
      }
    }
    const text = stripHtmlToText(html);
    if (text.length > 80) {
      await fs.writeFile(path.join(workDir, "official-article.txt"), text, "utf8").catch(() => undefined);
      return { status: "available" as const, text, message: "已读取视频简介中的文字稿。" };
    }
    return { status: "missing" as const, text: "", message: "文字稿页面没有读到可用正文。" };
  } catch {
    return { status: "blocked" as const, text: "", message: "文字稿链接暂时无法读取。" };
  }
}

async function runExecFile(command: string, args: string[], cwd: string, timeoutMs: number) {
  return execFileAsync(command, args, {
    cwd,
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
}

async function processBilibiliVideo(input: unknown): Promise<InformationBilibiliProcessResult> {
  const request = input && typeof input === "object" ? input as InformationBilibiliCollectRequest : {};
  const bvid = normalizeBilibiliBvid(request.bvid);
  const cookieHeader = await getBilibiliCookieHeader();
  const workDir = bvid ? path.join(getInformationCollectionRuntimeRoot(), "bilibili", bvid) : getInformationCollectionRuntimeRoot();
  const steps: InformationProcessStep[] = [];
  await fs.mkdir(workDir, { recursive: true });

  if (!bvid) {
    return {
      status: "blocked",
      message: "需要先选择一个视频。",
      video: null,
      steps: [createInformationStep("metadata", "读取视频", "blocked", "缺少 BV 号。")],
      workDir
    };
  }

  steps.push(createInformationStep("metadata", "读取视频", "running", "正在读取视频信息。"));
  let video: InformationBilibiliVideo;
  try {
    video = await fetchBilibiliVideoByBvid(bvid, cookieHeader);
    steps[0] = createInformationStep("metadata", "读取视频", "done", "已读取视频信息。");
  } catch (error) {
    steps[0] = createInformationStep("metadata", "读取视频", "blocked", error instanceof Error ? error.message : "视频信息没有读取到。");
    return {
      status: "blocked",
      message: "视频处理没有开始。",
      video: null,
      steps,
      workDir
    };
  }

  if (video.transcript.status === "available") {
    steps.push(createInformationStep("subtitle", "读取字幕", "done", "已读取公开字幕。"));
    return {
      status: "ready",
      message: "已完成转录读取。",
      video,
      steps,
      workDir
    };
  }

  steps.push(createInformationStep("subtitle", "读取字幕", "skipped", video.transcript.message));
  steps.push(createInformationStep("official-text", "读取文字稿", "running", "正在检查视频简介里的文字稿。"));
  const officialArticle = await fetchOfficialArticleText(extractFirstUrl(video.description), workDir);
  if (officialArticle.status === "available") {
    const nextVideo = {
      ...video,
      transcript: {
        status: "available" as const,
        text: officialArticle.text,
        message: officialArticle.message
      }
    };
    steps[2] = createInformationStep("official-text", "读取文字稿", "done", officialArticle.message);
    return {
      status: "ready",
      message: "已读取官方文字稿。",
      video: nextVideo,
      steps,
      workDir
    };
  }
  steps[2] = createInformationStep(
    "official-text",
    "读取文字稿",
    "skipped",
    officialArticle.status === "blocked" ? `${officialArticle.message}，继续尝试下载字幕。` : officialArticle.message
  );

  const tools = await readInformationToolStatus();
  const toolMap = new Map(tools.map((tool) => [tool.id, tool]));
  const ytDlpReady = Boolean(toolMap.get("yt-dlp")?.available);
  const ffmpegReady = Boolean(toolMap.get("ffmpeg")?.available);
  const whisperReady = Boolean(toolMap.get("whisper")?.available);

  steps.push(createInformationStep("download", "下载字幕", "running", "正在尝试下载字幕文件。"));
  if (!ytDlpReady) {
    steps[3] = createInformationStep("download", "下载字幕", "blocked", "缺少 yt-dlp，无法下载字幕或音频。");
    steps.push(createInformationStep("transcribe", "语音转写", "skipped", "前置步骤未完成。"));
    return {
      status: "blocked",
      message: "转录工具还没有准备好。",
      video,
      steps,
      workDir
    };
  }

  const outputBase = path.join(workDir, `${sanitizeFileSegment(video.bvid)}-%(title).50s`);
  const cookiePath = await writeBilibiliCookiesFile(workDir);
  try {
    await runExecFile(
      "yt-dlp",
      [
        ...(cookiePath ? ["--cookies", cookiePath] : []),
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        "zh-CN,zh-Hans,zh,all",
        "--sub-format",
        "vtt/srt/best",
        "--output",
        outputBase,
        video.url
      ],
      workDir,
      120000
    );
    const subtitleTexts = await readTextFilesFromDirectory(workDir, [".vtt", ".srt"]);
    const transcript = subtitleTexts.map(normalizeSubtitleText).filter(Boolean).join("\n\n");
    if (transcript) {
      const nextVideo = {
        ...video,
        transcript: {
          status: "available" as const,
          text: transcript,
          message: "已通过字幕文件生成转录。"
        }
      };
      steps[3] = createInformationStep("download", "下载字幕", "done", "已通过字幕文件生成转录。");
      return {
        status: "ready",
        message: "已完成转录。",
        video: nextVideo,
        steps,
        workDir
      };
    }
    steps[3] = createInformationStep("download", "下载字幕", "skipped", "没有可用字幕，进入音频转写。");
  } catch (error) {
    steps[3] = createInformationStep("download", "下载字幕", "skipped", describeBilibiliToolFailure(error, "字幕没有拿到，进入音频转写。"));
  }

  steps.push(createInformationStep("download", "下载音频", "pending", "等待下载音频。"));
  steps.push(createInformationStep("transcribe", "语音转写", "pending", "等待语音转写。"));

  if (!ffmpegReady || !whisperReady) {
    steps[4] = createInformationStep("download", "下载音频", ffmpegReady ? "pending" : "blocked", ffmpegReady ? "等待语音转写工具。" : "缺少 ffmpeg，无法抽取音频。");
    steps[5] = createInformationStep("transcribe", "语音转写", whisperReady ? "pending" : "blocked", whisperReady ? "等待音频文件。" : "缺少 Whisper，无法本地转写。");
    return {
      status: "blocked",
      message: "视频没有公开字幕，音频转写依赖还没有准备好。",
      video,
      steps,
      workDir
    };
  }

  try {
    steps[4] = createInformationStep("download", "下载音频", "running", "正在下载音频。");
    const audioBase = path.join(workDir, `${sanitizeFileSegment(video.bvid)}-audio.%(ext)s`);
    await runExecFile(
      "yt-dlp",
      [
        ...(cookiePath ? ["--cookies", cookiePath] : []),
        "-f",
        "ba/bestaudio",
        "--output",
        audioBase,
        video.url
      ],
      workDir,
      10 * 60 * 1000
    );
    steps[4] = createInformationStep("download", "下载音频", "done", "音频已下载。");
    const audioFiles = (await fs.readdir(workDir)).filter((fileName) => /\.(mp3|m4a|wav|webm)$/i.test(fileName));
    const audioPath = audioFiles.length ? path.join(workDir, audioFiles[0]) : "";
    if (!audioPath) throw new Error("音频文件没有生成。");

    steps[5] = createInformationStep("transcribe", "语音转写", "running", "正在语音转写。");
    await runExecFile("whisper", [audioPath, "--language", "Chinese", "--output_dir", workDir, "--output_format", "txt"], workDir, 30 * 60 * 1000);
    const transcript = (await readTextFilesFromDirectory(workDir, [".txt"])).join("\n\n").trim();
    if (!transcript) throw new Error("转写文本没有生成。");
    const nextVideo = {
      ...video,
      transcript: {
        status: "available" as const,
        text: transcript,
        message: "已完成本地语音转写。"
      }
    };
    steps[5] = createInformationStep("transcribe", "语音转写", "done", "已完成本地语音转写。");
    return {
      status: "ready",
      message: "已完成转录。",
      video: nextVideo,
      steps,
      workDir
    };
  } catch (error) {
    const currentIndex = steps.findIndex((step) => step.status === "running");
    if (currentIndex >= 0) {
      steps[currentIndex] = {
        ...steps[currentIndex],
        status: "blocked",
        message: describeBilibiliToolFailure(error, error instanceof Error ? error.message : "该步骤没有完成。")
      };
    }
    return {
      status: "blocked",
      message: "视频转录没有完成。",
      video,
      steps,
      workDir
    };
  }
}

async function openBilibiliCollectionTarget(input: unknown) {
  const request = input && typeof input === "object" ? input as InformationBilibiliCollectRequest : {};
  const bvid = normalizeBilibiliBvid(request.bvid);
  const mid = normalizePositiveNumber(request.mid, 0);
  const upName = typeof request.upName === "string" ? request.upName.trim() : "";
  const url = bvid
    ? `https://www.bilibili.com/video/${bvid}/`
    : mid
      ? `https://space.bilibili.com/${mid}/video`
      : upName
        ? `https://search.bilibili.com/upuser?keyword=${encodeURIComponent(upName)}`
        : "https://www.bilibili.com/";
  return openChromePortPage("bilibili", url);
}

function cookieMatchesPlatformAuth(platform: ChromePortDefinition, cookie: ChromeCookie) {
  const domain = cookie.domain ?? "";
  const name = cookie.name ?? "";
  const value = cookie.value ?? "";
  if (!value) return false;
  const domainMatched = platform.authCookieDomains.some((keyword) => domain.includes(keyword));
  const normalizedName = name.toLowerCase();
  const nameMatched = platform.authCookieNames.some((cookieName) => {
    const normalizedCookieName = cookieName.toLowerCase();
    return normalizedName === normalizedCookieName || normalizedName.startsWith(`${normalizedCookieName}.`);
  });
  return domainMatched && nameMatched;
}

async function probeChromePortLogin(platform: ChromePortDefinition, connected: boolean): Promise<ChromePortLoginProbe> {
  if (!connected) {
    return { pageDetected: false, authenticated: false, authenticatedAt: "", detectedUrl: "" };
  }

  const targets = await readChromeDebugTargets(platform.port);
  const target = findPlatformTarget(platform, targets);
  if (!target) {
    return { pageDetected: false, authenticated: false, authenticatedAt: "", detectedUrl: "" };
  }

  const cookies = await readChromeCookies(target);
  let authenticated = cookies.some((cookie) => cookieMatchesPlatformAuth(platform, cookie));
  if (!authenticated && platform.authDomKeywords.length > 0) {
    const pageText = await readChromePageText(target);
    authenticated = platform.authDomKeywords.every((keyword) => pageText.includes(keyword));
  }

  return {
    pageDetected: true,
    authenticated,
    authenticatedAt: authenticated ? new Date().toISOString() : "",
    detectedUrl: target.url ?? ""
  };
}

function sanitizeAiChatRequest(value: unknown): Required<AiChatRequest> {
  const request = value && typeof value === "object" ? value as AiChatRequest : {};
  const provider = request.provider === "chatgpt" ? "chatgpt" : "doubao";
  const message = typeof request.message === "string" ? request.message.trim() : "";
  if (!message) {
    throw new Error("请输入要发送给 AI 助手的问题");
  }

  return {
    provider,
    message: message.slice(0, 4000),
    courseTitle: typeof request.courseTitle === "string" ? request.courseTitle.slice(0, 120) : "",
    nodeTitle: typeof request.nodeTitle === "string" ? request.nodeTitle.slice(0, 120) : "",
    contextText: typeof request.contextText === "string" ? request.contextText.slice(0, 4000) : ""
  };
}

function buildAiChatPrompt(request: Required<AiChatRequest>) {
  return request.message;
}

function getAiChatPlatform(provider: AiChatProvider) {
  const platform = getChromePortDefinition(provider);
  if (!platform) {
    throw new Error(`未配置 ${provider} 端口`);
  }
  return platform;
}

async function getAiChatPageTarget(platform: ChromePortDefinition) {
  const connected = await canConnectToLocalPort(platform.port);
  if (!connected) {
    await openChromePortLogin(platform.id);
    await delay(1200);
  }

  let targets = await readChromeDebugTargets(platform.port);
  let target = findPlatformTarget(platform, targets);

  if (!target) {
    await openUrlInChromePort(platform.port, platform.loginUrl);
    await delay(1200);
    targets = await readChromeDebugTargets(platform.port);
    target = findPlatformTarget(platform, targets);
  }

  if (!target?.webSocketDebuggerUrl) {
    throw new Error(`${platform.name} 端口 ${platform.port} 未就绪，请先在端口管理打开并确认登录`);
  }

  let status = await getChromePortStatus(platform);
  for (let attempt = 0; attempt < 6 && !status.authenticated; attempt += 1) {
    await delay(1000);
    status = await getChromePortStatus(platform);
  }
  if (!status.authenticated) {
    throw new Error(`${platform.name} 尚未识别到登录状态，请先在端口管理完成登录`);
  }

  return target;
}

function getAiChatAutomationExpression(provider: AiChatProvider, prompt: string, requestId: string) {
  const inputSelectors = provider === "chatgpt"
    ? ["#prompt-textarea", "[contenteditable='true'][id='prompt-textarea']", "[contenteditable='true']", "textarea", "[role='textbox']"]
    : ["textarea", "[contenteditable='true']", "[role='textbox']"];
  const gateWords = provider === "chatgpt"
    ? ["Log in", "Sign up", "登录", "注册", "验证", "captcha", "Cloudflare", "Checking your browser"]
    : ["扫码登录", "手机号登录", "请先登录", "立即登录", "验证码", "滑块验证", "安全验证", "操作频繁"];
  const chromeNoise = provider === "chatgpt"
    ? ["New chat", "新聊天", "发送", "停止生成", "重新生成", "Search", "Reason", "Canvas", "来源"]
    : ["新对话", "历史对话", "发送", "停止生成", "重新生成", "复制", "分享", "点赞", "点踩", "快速", "图像生成", "帮我写作", "编程"];

  return `
(async () => {
  const provider = ${JSON.stringify(provider)};
  const prompt = ${JSON.stringify(prompt)};
  const requestId = ${JSON.stringify(requestId)};
  const inputSelectors = ${JSON.stringify(inputSelectors)};
  const gateWords = ${JSON.stringify(gateWords)};
  const chromeNoise = ${JSON.stringify(chromeNoise)};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const bodyText = () => document.body?.innerText || "";
  const normalizeLines = (text) => String(text || "")
    .replaceAll("\\r\\n", "\\n")
    .replaceAll("\\r", "\\n")
    .split("\\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const normalizeCompact = (text) => String(text || "").replace(/\\s+/g, "");
  const promptCompact = normalizeCompact(prompt);
  const uniqueVisibleElements = (selectors) => {
    const seen = new Set();
    const elements = [];
    for (const selector of selectors) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        if (seen.has(element) || !visible(element)) continue;
        seen.add(element);
        elements.push(element);
      }
    }
    return elements;
  };
  const sortByDocumentOrder = (elements) => elements.slice().sort((left, right) => {
    if (left === right) return 0;
    const position = left.compareDocumentPosition(right);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  const isPromptEchoLine = (line) => {
    const compactLine = normalizeCompact(line);
    return Boolean(promptCompact) && (
      compactLine === promptCompact ||
      promptCompact.includes(compactLine) ||
      compactLine.includes(promptCompact)
    );
  };
  const cleanReply = (text, options = {}) => {
    const stripPromptEcho = options.stripPromptEcho !== false;
    const lines = [];
    for (const rawLine of String(text || "").replaceAll("\\r\\n", "\\n").replaceAll("\\r", "\\n").split("\\n")) {
      const line = rawLine
        .replace(/^ChatGPT\\s*说[:：]?\\s*/i, "")
        .replace(/^ChatGPT\\s*[:：]?\\s*/i, "")
        .replace(/^Doubao\\s*[:：]?\\s*/i, "")
        .replace(/^豆包\\s*[:：]?\\s*/i, "")
        .replace(/^说[:：]?\\s*/i, "")
        .trim();
      if (!line) {
        if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
        continue;
      }
      if (/^(说|你|ChatGPT|豆包|Doubao)[:：]?$/.test(line)) continue;
      if (stripPromptEcho && isPromptEchoLine(line)) continue;
      if (chromeNoise.some((noise) => line === noise)) continue;
      if (/^搜索\\s*\\d+\\s*个关键词/.test(line) || /^参考\\s*\\d+\\s*篇资料/.test(line)) continue;
      if (/^(展开|收起|重新回答|换一换|继续生成|已停止生成)$/.test(line)) continue;
      if (line.includes("AIstudy 内嵌学习助手") || line.startsWith("当前课程：") || line.startsWith("当前节点：") || line.startsWith("参考上下文：") || line.startsWith("用户问题：")) continue;
      if (line.includes("ChatGPT can make mistakes") || line.includes("ChatGPT 也可能会犯错")) {
        continue;
      }
      lines.push(line);
    }
    return lines.join("\\n").replace(/\\n{3,}/g, "\\n\\n").trim();
  };
  const hasGate = () => gateWords.some((word) => bodyText().includes(word));
  const getDoubaoMessageRows = () => {
    const rows = uniqueVisibleElements(["[aria-label='doc_editor'] .v_list_row"]);
    if (rows.length > 0) return sortByDocumentOrder(rows);
    return sortByDocumentOrder(uniqueVisibleElements([
      "[aria-label='doc_editor'] [class*='message']",
      "[aria-label='doc_editor'] [class*='bubble']"
    ]));
  };
  const isElementTaggedForRequest = (element) => element?.getAttribute("data-aistudy-request-id") === requestId;
  const getElementText = (element) => element?.innerText || element?.textContent || "";
  const rowLooksLikeCurrentPrompt = (row) => {
    const rowText = normalizeCompact(getElementText(row));
    if (!promptCompact || !rowText) return false;
    if (rowText === promptCompact) return true;
    if (promptCompact.includes(rowText) && rowText.length >= Math.min(4, promptCompact.length)) return true;
    return rowText.includes(promptCompact) && rowText.length <= promptCompact.length + 24;
  };
  const getDoubaoUserRows = () => {
    const rows = getDoubaoMessageRows();
    const bubbleRows = rows.filter(isDoubaoUserRow);
    return bubbleRows.length > 0 ? bubbleRows : rows.filter(rowLooksLikeCurrentPrompt);
  };
  const getDoubaoCurrentUserRow = () => {
    const tagged = getDoubaoUserRows().find(isElementTaggedForRequest);
    if (tagged) return tagged;
    const userRows = getDoubaoUserRows();
    const newUserRows = userRows.filter((row) => getDoubaoMessageRows().indexOf(row) >= beforeDoubaoRowCount);
    const candidates = newUserRows.length ? newUserRows : userRows.filter(rowLooksLikeCurrentPrompt);
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const row = candidates[index];
      if (!isDoubaoUserRow(row) && !rowLooksLikeCurrentPrompt(row)) continue;
      row.setAttribute("data-aistudy-request-id", requestId);
      return row;
    }
    return null;
  };
  const getChatGptRoleBlocks = () => sortByDocumentOrder(uniqueVisibleElements(["[data-message-author-role]"]));
  const getChatGptUserBlocks = () => getChatGptRoleBlocks()
    .filter((element) => element.getAttribute("data-message-author-role") === "user");
  const getChatGptCurrentUserBlock = () => {
    const tagged = getChatGptUserBlocks().find(isElementTaggedForRequest);
    if (tagged) return tagged;
    const userBlocks = getChatGptUserBlocks();
    const newUserBlocks = userBlocks.slice(Math.max(0, beforeChatGptUserCount));
    const candidates = newUserBlocks.length ? newUserBlocks : userBlocks;
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const element = candidates[index];
      const text = normalizeCompact(getElementText(element));
      if (!text) continue;
      if (text.includes(promptCompact) || promptCompact.includes(text)) {
        element.setAttribute("data-aistudy-request-id", requestId);
        return element;
      }
    }
    return null;
  };
  const isDoubaoUserRow = (row) => Boolean(row.querySelector("[class*='bg-g-send-msg-bubble-bg']"));
  const isDoubaoResearchText = (text) => /^搜索\\s*\\d+\\s*个关键词/.test(text)
    || /^参考\\s*\\d+\\s*篇资料/.test(text)
    || text.includes("篇资料")
    || text.includes("个关键词");
  const scoreDoubaoReplyRoot = (text) => {
    const cleaned = cleanReply(text);
    if (!cleaned) return -1000;
    let score = Math.min(cleaned.length, 1200);
    if (isDoubaoResearchText(text)) score -= 900;
    if (text.includes(prompt)) score -= 600;
    if (/^[\\s\\S]{0,80}$/.test(cleaned)) score -= 20;
    return score;
  };
  const getDoubaoReplyText = (row) => {
    const contentRoots = Array.from(row.querySelectorAll(".md-box-root,[class*='md-box-root'],[class*='markdown'],[class*='answer']"))
      .filter(visible)
      .map((element) => element.innerText || element.textContent || "")
      .map((text) => text.trim())
      .filter(Boolean);
    if (contentRoots.length > 0) {
      return contentRoots.sort((left, right) => scoreDoubaoReplyRoot(right) - scoreDoubaoReplyRoot(left))[0];
    }
    return row.innerText || row.textContent || "";
  };
  const getDoubaoCandidateRows = () => {
    const currentUserRow = getDoubaoCurrentUserRow();
    if (!currentUserRow) return [];
    const rows = getDoubaoMessageRows();
    const latestPromptUserIndex = rows.indexOf(currentUserRow);
    if (latestPromptUserIndex < 0) return [];
    const candidates = [];
    for (let index = latestPromptUserIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      if (isDoubaoUserRow(row)) break;
      candidates.push(row);
    }
    return candidates;
  };
  const getChatGptAssistantAfterPrompt = () => {
    const currentUserBlock = getChatGptCurrentUserBlock();
    if (!currentUserBlock) return "";
    const roleBlocks = getChatGptRoleBlocks();
    const latestUserIndex = roleBlocks.indexOf(currentUserBlock);
    if (latestUserIndex >= 0) {
      const replies = [];
      for (let index = latestUserIndex + 1; index < roleBlocks.length; index += 1) {
        const element = roleBlocks[index];
        const role = element.getAttribute("data-message-author-role");
        if (role === "user") break;
        if (role !== "assistant") continue;
        const reply = cleanReply(getElementText(element), { stripPromptEcho: false });
        if (reply) replies.push(reply);
      }
      if (replies.length > 0) return replies.join("\\n\\n").trim();
    }

    const turnBlocks = sortByDocumentOrder(uniqueVisibleElements([
      "article[data-testid^='conversation-turn-']",
      "section[data-testid^='conversation-turn-']",
      "[data-testid^='conversation-turn-']"
    ]));
    const latestPromptTurnIndex = turnBlocks.findIndex((turn) => turn === currentUserBlock || turn.contains(currentUserBlock));
    if (latestPromptTurnIndex < 0) return "";
    const replies = [];
    for (let index = latestPromptTurnIndex + 1; index < turnBlocks.length; index += 1) {
      const turn = turnBlocks[index];
      if (turn.querySelector("[data-message-author-role='user']") || /user/i.test(turn.getAttribute("data-turn") || "")) break;
      if (!turn.querySelector("[data-message-author-role='assistant']") && !/assistant/i.test(turn.getAttribute("data-turn") || "")) continue;
      const assistantRoot = turn.querySelector("[data-message-author-role='assistant']") || turn;
      const reply = cleanReply(getElementText(assistantRoot), { stripPromptEcho: false });
      if (reply) replies.push(reply);
    }
    return replies.join("\\n\\n").trim();
  };
  const beforeDoubaoRowCount = provider === "doubao" ? getDoubaoMessageRows().length : 0;
  const beforeChatGptUserCount = provider === "chatgpt" ? getChatGptUserBlocks().length : 0;
  const composerRoot = provider === "doubao"
    ? document.querySelector("#input-engine-container") || document.querySelector("[class*='input-engine']") || document
    : document;
  const usableInput = (element) => visible(element)
    && !element.disabled
    && element.getAttribute("aria-disabled") !== "true"
    && !element.readOnly;
  const queryInput = (root) => inputSelectors
    .flatMap((selector) => Array.from(root.querySelectorAll?.(selector) || []))
    .find(usableInput);
  let input = queryInput(composerRoot) || queryInput(document);
  for (let attempt = 0; provider === "doubao" && !input && attempt < 16; attempt += 1) {
    await sleep(250);
    input = queryInput(composerRoot) || queryInput(document);
  }
  if (!input) {
    return { ok: false, blocker: hasGate() ? "login-or-verification" : "input-not-found", reply: "" };
  }

  const beforeText = bodyText();
  const writePromptToInput = () => {
    input.focus({ preventScroll: true });
    if ("value" in input) {
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")
        || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      if (descriptor?.set) descriptor.set.call(input, "");
      else input.value = "";
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: null, inputType: "deleteContentBackward" }));
      input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, data: prompt, inputType: "insertText" }));
      if (descriptor?.set) descriptor.set.call(input, prompt);
      else input.value = prompt;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: prompt, inputType: "insertText" }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      range.deleteContents();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand("insertText", false, prompt);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: prompt, inputType: "insertText" }));
    }
  };
  writePromptToInput();
  await sleep(120);
  const writtenText = String(input.innerText || input.value || "").trim();
  if (provider === "doubao" && writtenText !== prompt.trim()) {
    writePromptToInput();
    await sleep(180);
  }

  await sleep(300);
  const buttonLabel = (element) => [element.id, element.getAttribute("data-testid"), element.innerText, element.getAttribute("aria-label"), element.getAttribute("title")]
    .filter(Boolean).join(" ").toLowerCase();
  const isSendButton = (element) => {
    const label = buttonLabel(element);
    return label.includes("send") ||
      label.includes("发送") ||
      label.includes("submit") ||
      label.includes("composer-submit-button") ||
      label.includes("send-button");
  };
  const form = input.closest("form");
  const getRect = (element) => element.getBoundingClientRect();
  const composerElement = provider === "doubao"
    ? document.querySelector("#input-engine-container") || input.closest("[class*='input']") || input.parentElement || input
    : form || input.closest("[class*='composer']") || input.parentElement || input;
  const scanButtons = () => Array.from(document.querySelectorAll("button,[role='button']"))
    .filter((element) => visible(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true");
  const findDoubaoSpatialSendButton = (buttonList) => provider === "doubao"
    ? buttonList
        .map((element) => {
          const inputRect = getRect(input);
          const rootRect = getRect(composerElement);
          const rect = getRect(element);
          const label = buttonLabel(element);
          const text = String(element.innerText || "").trim();
          const nearInputVertically = rect.top >= inputRect.top - 96 && rect.bottom <= inputRect.bottom + 132;
          const nearComposerRight = rect.left >= Math.max(inputRect.left, rootRect.right - 120) && rect.right <= rootRect.right + 24;
          const compactIconButton = rect.width <= 64 && rect.height <= 64 && element.querySelector("svg");
          const forbidden = ["快速", "图像生成", "帮我写作", "编程", "更多", "语音", "麦克风", "voice", "microphone", "more"].some((word) => label.includes(word.toLowerCase()) || text.includes(word));
          const explicitSend = isSendButton(element);
          const score = (explicitSend ? 100 : 0)
            + (nearInputVertically ? 20 : -80)
            + (nearComposerRight ? 35 : -120)
            + (compactIconButton ? 20 : -40)
            + rect.left / 10000
            - (forbidden ? 200 : 0)
            - (text && !explicitSend ? 80 : 0);
          return { element, score };
        })
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score)[0]?.element
    : null;
  const findSendButton = () => {
    const buttonList = scanButtons();
    const doubaoSpatialSendButton = findDoubaoSpatialSendButton(buttonList);
    return Array.from(form?.querySelectorAll("button,[role='button']") || [])
      .filter((element) => visible(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true")
      .find(isSendButton) ||
      buttonList.find(isSendButton) ||
      doubaoSpatialSendButton ||
      document.querySelector("button[data-testid='send-button'],button[data-testid='composer-submit-button'],button[aria-label*='Send'],button[aria-label*='发送']");
  };
  let sendButton = null;
  for (let attempt = 0; attempt < (provider === "doubao" ? 14 : 4); attempt += 1) {
    sendButton = findSendButton();
    if (sendButton && visible(sendButton) && !sendButton.disabled && sendButton.getAttribute("aria-disabled") !== "true") break;
    await sleep(250);
  }

  if (sendButton && visible(sendButton) && !sendButton.disabled && sendButton.getAttribute("aria-disabled") !== "true") {
    sendButton.click();
  } else {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
  }
  await sleep(500);
  if (provider === "chatgpt") getChatGptCurrentUserBlock();
  if (provider === "doubao") getDoubaoCurrentUserRow();

  let afterSubmitText = bodyText();
  if (afterSubmitText === beforeText && !bodyText().includes(prompt)) {
    await sleep(provider === "doubao" ? 900 : 300);
    sendButton = findSendButton();
    if (sendButton && visible(sendButton) && !sendButton.disabled && sendButton.getAttribute("aria-disabled") !== "true") {
      sendButton.click();
    } else {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    }
    await sleep(700);
    afterSubmitText = bodyText();
  }
  if (afterSubmitText === beforeText && !bodyText().includes(prompt)) {
    return { ok: false, blocker: "send-not-triggered", reply: "" };
  }
  const staleInputText = input.innerText || input.value || "";
  if (String(staleInputText).trim() === prompt.trim()) {
    const retryButton = findSendButton();
    if (retryButton && retryButton !== sendButton && visible(retryButton)) retryButton.click();
  }

  const getLatestAssistantReply = () => {
    if (provider === "doubao") {
      const candidates = getDoubaoCandidateRows();
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const reply = cleanReply(getDoubaoReplyText(candidates[index]), { stripPromptEcho: false });
        if (reply) return reply;
      }
      return "";
    }
    return getChatGptAssistantAfterPrompt();
  };
  const hasCurrentEmptyAssistantShell = () => {
    if (provider === "doubao") {
      const candidates = getDoubaoCandidateRows();
      return candidates.length > 0 && candidates.every((row) => !cleanReply(getDoubaoReplyText(row), { stripPromptEcho: false }));
    }
    const currentUserBlock = getChatGptCurrentUserBlock();
    if (!currentUserBlock) return false;
    const roleBlocks = getChatGptRoleBlocks();
    const latestUserIndex = roleBlocks.indexOf(currentUserBlock);
    if (latestUserIndex < 0) return false;
    let assistantCount = 0;
    for (let index = latestUserIndex + 1; index < roleBlocks.length; index += 1) {
      const element = roleBlocks[index];
      const role = element.getAttribute("data-message-author-role");
      if (role === "user") break;
      if (role !== "assistant") continue;
      assistantCount += 1;
      if (cleanReply(getElementText(element), { stripPromptEcho: false })) return false;
    }
    return assistantCount > 0;
  };

  let stableText = "";
  let stableCount = 0;
  const startedAt = Date.now();
  let firstReplyAt = 0;
  const maxWaitMs = provider === "doubao" ? 45000 : 150000;
  while (Date.now() - startedAt < maxWaitMs) {
    await sleep(800);
    const reply = getLatestAssistantReply();
    if (reply && !firstReplyAt) firstReplyAt = Date.now();
    if (reply && reply === stableText) stableCount += 1;
    else {
      stableText = reply;
      stableCount = reply ? 1 : 0;
    }
    const generating = bodyText().includes("停止生成") ||
      bodyText().includes("正在生成") ||
      bodyText().includes("生成中") ||
      Boolean(document.querySelector("button[data-testid='stop-button'],button[aria-label*='Stop'],button[aria-label*='停止'],button[aria-label*='正在']"));
    const waitedAfterFirstReply = firstReplyAt > 0 && Date.now() - firstReplyAt >= 2600;
    if (stableText && stableCount >= 3 && waitedAfterFirstReply && !generating) {
      await sleep(1800);
      const verifiedReply = getLatestAssistantReply();
      const verifiedGenerating = bodyText().includes("停止生成") ||
        bodyText().includes("正在生成") ||
        bodyText().includes("生成中") ||
        Boolean(document.querySelector("button[data-testid='stop-button'],button[aria-label*='Stop'],button[aria-label*='停止'],button[aria-label*='正在']"));
      if (verifiedReply && verifiedReply.length >= stableText.length) {
        stableText = verifiedReply;
      }
      if (!verifiedGenerating) break;
      stableCount = 1;
    }
    if (provider === "doubao" && !stableText && !generating && Date.now() - startedAt >= 12000 && hasCurrentEmptyAssistantShell()) break;
  }

  if (hasGate() && !stableText) {
    return { ok: false, blocker: "login-or-verification", reply: "" };
  }
  return { ok: Boolean(stableText), blocker: stableText ? "" : "reply-timeout", reply: stableText };
})()
`;
}

function getChatGptSubmitExpression(prompt: string, requestId: string) {
  return `
(async () => {
  const prompt = ${JSON.stringify(prompt)};
  const requestId = ${JSON.stringify(requestId)};
  const promptCompact = String(prompt || "").replace(/\\s+/g, "");
  const inputSelectors = ["#prompt-textarea", "[contenteditable='true'][id='prompt-textarea']", "[contenteditable='true']", "textarea", "[role='textbox']"];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const gateWords = ["Log in", "Sign up", "登录", "注册", "验证", "captcha", "Cloudflare", "Checking your browser"];
  const hasGate = () => gateWords.some((word) => (document.body?.innerText || "").includes(word));
  const usableInput = (element) => visible(element)
    && !element.disabled
    && element.getAttribute("aria-disabled") !== "true"
    && !element.readOnly;
  const input = inputSelectors
    .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
    .find(usableInput);
  if (!input) return { ok: false, blocker: hasGate() ? "login-or-verification" : "input-not-found" };

  const writePrompt = () => {
    input.focus({ preventScroll: true });
    if ("value" in input) {
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")
        || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      if (descriptor?.set) descriptor.set.call(input, "");
      else input.value = "";
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: null, inputType: "deleteContentBackward" }));
      if (descriptor?.set) descriptor.set.call(input, prompt);
      else input.value = prompt;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: prompt, inputType: "insertText" }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    range.deleteContents();
    selection?.removeAllRanges();
    selection?.addRange(range);
    input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, data: prompt, inputType: "insertText" }));
    document.execCommand("insertText", false, prompt);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: prompt, inputType: "insertText" }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  writePrompt();

  const buttonLabel = (element) => [element.id, element.getAttribute("data-testid"), element.innerText, element.getAttribute("aria-label"), element.getAttribute("title")]
    .filter(Boolean).join(" ").toLowerCase();
  const isSendButton = (element) => {
    const label = buttonLabel(element);
    return label.includes("send")
      || label.includes("发送")
      || label.includes("submit")
      || label.includes("composer-submit-button")
      || label.includes("send-button");
  };
  const form = input.closest("form");
  const scanButtons = () => Array.from(document.querySelectorAll("button,[role='button']"))
    .filter((element) => visible(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true");
  const findSendButton = () => Array.from(form?.querySelectorAll("button,[role='button']") || [])
    .filter((element) => visible(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true")
    .find(isSendButton)
    || scanButtons().find(isSendButton)
    || document.querySelector("#composer-submit-button,button[data-testid='send-button'],button[data-testid='composer-submit-button'],button[aria-label*='Send'],button[aria-label*='发送'],button[aria-label*='发送提示'],button.composer-submit-btn");
  let sendButton = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    sendButton = findSendButton();
    if (sendButton && visible(sendButton) && !sendButton.disabled && sendButton.getAttribute("aria-disabled") !== "true") break;
    await sleep(150);
  }
  if (!sendButton || !visible(sendButton) || sendButton.disabled || sendButton.getAttribute("aria-disabled") === "true") {
    return { ok: false, blocker: "send-button-not-found" };
  }
  const sendRect = sendButton.getBoundingClientRect();
  return {
    ok: true,
    blocker: "",
    sendPoint: {
      x: sendRect.left + sendRect.width / 2,
      y: sendRect.top + sendRect.height / 2
    }
  };
})()
`;
}

function getChatGptTagLatestUserExpression(prompt: string, requestId: string) {
  return `
(() => {
  const prompt = ${JSON.stringify(prompt)};
  const requestId = ${JSON.stringify(requestId)};
  const promptCompact = String(prompt || "").replace(/\\s+/g, "");
  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const sortByDocumentOrder = (elements) => elements.slice().sort((left, right) => {
    if (left === right) return 0;
    const position = left.compareDocumentPosition(right);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  const getText = (element) => element?.innerText || element?.textContent || "";
  const userBlocks = sortByDocumentOrder(Array.from(document.querySelectorAll("[data-message-author-role='user']")).filter(visible));
  for (let index = userBlocks.length - 1; index >= 0; index -= 1) {
    const block = userBlocks[index];
    const text = String(getText(block) || "").replace(/\\s+/g, "");
    if (text && (text.includes(promptCompact) || promptCompact.includes(text))) {
      block.setAttribute("data-aistudy-request-id", requestId);
      return { ok: true, blocker: "", taggedText: getText(block) };
    }
  }
  return { ok: false, blocker: (document.body?.innerText || "").includes(prompt) ? "request-not-tagged" : "send-not-triggered" };
})()
`;
}

function getChatGptReplyProbeExpression(requestId: string) {
  return `
(() => {
  const requestId = ${JSON.stringify(requestId)};
  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const sortByDocumentOrder = (elements) => elements.slice().sort((left, right) => {
    if (left === right) return 0;
    const position = left.compareDocumentPosition(right);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  const cleanReply = (text) => {
    const lines = [];
    for (const rawLine of String(text || "").replaceAll("\\r\\n", "\\n").replaceAll("\\r", "\\n").split("\\n")) {
      const line = rawLine
        .replace(/^ChatGPT\\s*说[:：]?\\s*/i, "")
        .replace(/^ChatGPT\\s*[:：]?\\s*/i, "")
        .replace(/^说[:：]?\\s*/i, "")
        .trim();
      if (!line) {
        if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
        continue;
      }
      if (/^(说|你|ChatGPT)[:：]?$/.test(line)) continue;
      if (line === "New chat" || line === "新聊天" || line === "发送" || line === "停止生成" || line === "重新生成" || line === "Search" || line === "Reason" || line === "Canvas" || line === "来源") continue;
      if (/^(展开|收起|重新回答|换一换|继续生成|已停止生成)$/.test(line)) continue;
      if (line.includes("ChatGPT can make mistakes") || line.includes("ChatGPT 也可能会犯错")) continue;
      lines.push(line);
    }
    return lines.join("\\n").replace(/\\n{3,}/g, "\\n\\n").trim();
  };
  const getText = (element) => element?.innerText || element?.textContent || "";
  const readAssistantText = (element) => {
    const contentRoots = Array.from(element.querySelectorAll(".markdown,.prose,[class*='markdown'],[class*='prose']"))
      .filter(visible)
      .map((node) => getText(node).trim())
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
    return contentRoots[0] || getText(element);
  };
  const blocks = sortByDocumentOrder(Array.from(document.querySelectorAll("[data-message-author-role]")).filter(visible));
  const taggedUser = blocks.find((element) => element.getAttribute("data-aistudy-request-id") === requestId);
  const userIndex = blocks.indexOf(taggedUser);
  const replies = [];
  let assistantCount = 0;
  if (userIndex >= 0) {
    for (let index = userIndex + 1; index < blocks.length; index += 1) {
      const block = blocks[index];
      const role = block.getAttribute("data-message-author-role");
      if (role === "user") break;
      if (role !== "assistant") continue;
      assistantCount += 1;
      const reply = cleanReply(readAssistantText(block));
      if (reply) replies.push(reply);
    }
  }
  const bodyText = document.body?.innerText || "";
  const generating = bodyText.includes("停止生成")
    || bodyText.includes("正在生成")
    || bodyText.includes("生成中")
    || Boolean(document.querySelector("button[data-testid='stop-button'],button[aria-label*='Stop'],button[aria-label*='停止'],button[aria-label*='正在']"));
  const gateWords = ["Log in", "Sign up", "登录", "注册", "验证", "captcha", "Cloudflare", "Checking your browser"];
  const hasGate = gateWords.some((word) => bodyText.includes(word));
  return {
    ok: replies.length > 0,
    blocker: hasGate ? "login-or-verification" : (userIndex < 0 ? "request-not-found" : ""),
    reply: replies.join("\\n\\n").trim(),
    generating,
    assistantCount
  };
})()
`;
}

function unwrapRuntimeEvaluationValue(result: Record<string, unknown> | null, pageName: string) {
  const evaluation = result as { result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } } | null;
  if (evaluation?.exceptionDetails) {
    throw new Error(evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text || `${pageName} 页面执行失败`);
  }
  return evaluation?.result?.value;
}

async function resetChatGptConversation(target: ChromeDebugTarget) {
  await sendChromeCdpCommand(
    target.webSocketDebuggerUrl!,
    "Page.navigate",
    { url: "https://chatgpt.com/" },
    5000
  );
  await delay(2800);
}

async function dispatchChatGptMouseClick(target: ChromeDebugTarget, point: { x?: unknown; y?: unknown }) {
  const x = typeof point.x === "number" ? point.x : 0;
  const y = typeof point.y === "number" ? point.y : 0;
  if (!x || !y) {
    throw new Error("ChatGPT 发送按钮坐标无效");
  }
  await sendChromeCdpCommand(
    target.webSocketDebuggerUrl!,
    "Input.dispatchMouseEvent",
    { type: "mouseMoved", x, y, button: "none" },
    700
  );
  await sendChromeCdpCommand(
    target.webSocketDebuggerUrl!,
    "Input.dispatchMouseEvent",
    { type: "mousePressed", x, y, button: "left", clickCount: 1 },
    700
  );
  await sendChromeCdpCommand(
    target.webSocketDebuggerUrl!,
    "Input.dispatchMouseEvent",
    { type: "mouseReleased", x, y, button: "left", clickCount: 1 },
    700
  );
}

async function dispatchChatGptEnter(target: ChromeDebugTarget) {
  const keyParams = {
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13
  };
  await sendChromeCdpCommand(
    target.webSocketDebuggerUrl!,
    "Input.dispatchKeyEvent",
    { ...keyParams, type: "keyDown" },
    700
  );
  await sendChromeCdpCommand(
    target.webSocketDebuggerUrl!,
    "Input.dispatchKeyEvent",
    { ...keyParams, type: "keyUp" },
    700
  );
}

type ChatGptReplyProbePayload = {
  reply?: string;
  blocker?: string;
  generating?: boolean;
  assistantCount?: number;
};

type ChatGptPreparePayload = {
  ok?: boolean;
  blocker?: string;
  sendPoint?: { x?: unknown; y?: unknown };
  beforeLength?: number;
  beforeAssistantText?: string;
};

function getChatGptPrepareExpression(prompt: string) {
  return `
(async () => {
  const prompt = ${JSON.stringify(prompt)};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const roleBlocks = () => Array.from(document.querySelectorAll("[data-message-author-role]")).filter(visible);
  const textOf = (element) => element?.innerText || element?.textContent || "";
  const cleanReply = (text) => String(text || "")
    .split("\\n")
    .map((line) => line.trim())
    .filter((line) => line && !["发送", "停止生成", "重新生成", "Search", "Reason", "Canvas", "来源"].includes(line))
    .filter((line) => !line.includes("ChatGPT can make mistakes") && !line.includes("ChatGPT 也可能会犯错"))
    .join("\\n")
    .trim();
  const gateWords = ["Log in", "Sign up", "登录", "注册", "验证", "captcha", "Cloudflare", "Checking your browser"];
  const hasGate = () => gateWords.some((word) => (document.body?.innerText || "").includes(word));
  const beforeBlocks = roleBlocks();
  const beforeLength = beforeBlocks.length;
  const beforeAssistantText = cleanReply(textOf([...beforeBlocks].reverse().find((block) => block.getAttribute("data-message-author-role") === "assistant")));
  const findInput = () => ["#prompt-textarea", "[contenteditable='true'][id='prompt-textarea']", "[contenteditable='true']", "textarea", "[role='textbox']"]
    .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
    .find((element) => visible(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true" && !element.readOnly);
  let input = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    input = findInput();
    if (input) break;
    await sleep(150);
  }
  if (!input) return { ok: false, blocker: hasGate() ? "login-or-verification" : "input-not-found" };

  input.focus({ preventScroll: true });
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(input);
  range.deleteContents();
  selection?.removeAllRanges();
  selection?.addRange(range);
  input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, data: prompt, inputType: "insertText" }));
  document.execCommand("insertText", false, prompt);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: prompt, inputType: "insertText" }));
  input.dispatchEvent(new Event("change", { bubbles: true }));

  const buttonLabel = (element) => [element.id, element.getAttribute("data-testid"), element.innerText, element.getAttribute("aria-label"), element.getAttribute("title")]
    .filter(Boolean).join(" ").toLowerCase();
  const isSendButton = (element) => {
    const label = buttonLabel(element);
    return label.includes("send") || label.includes("发送") || label.includes("submit") || label.includes("composer-submit-button") || label.includes("send-button");
  };
  const findSendButton = () => Array.from(document.querySelectorAll("button,[role='button']"))
    .filter((element) => visible(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true")
    .find(isSendButton)
    || document.querySelector("#composer-submit-button,button[data-testid='send-button'],button[data-testid='composer-submit-button'],button[aria-label*='Send'],button[aria-label*='发送'],button[aria-label*='发送提示'],button.composer-submit-btn");
  let sendButton = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    sendButton = findSendButton();
    if (sendButton && visible(sendButton) && !sendButton.disabled && sendButton.getAttribute("aria-disabled") !== "true") break;
    await sleep(150);
  }
  if (!sendButton || !visible(sendButton) || sendButton.disabled || sendButton.getAttribute("aria-disabled") === "true") {
    return { ok: false, blocker: "send-button-not-found" };
  }
  const rect = sendButton.getBoundingClientRect();
  return {
    ok: true,
    blocker: "",
    beforeLength,
    beforeAssistantText,
    sendPoint: {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    }
  };
})()
`;
}

function getChatGptReplyAfterSendExpression(beforeLength: number, beforeAssistantText: string) {
  return `
(async () => {
  const beforeLength = ${JSON.stringify(beforeLength)};
  const beforeAssistantText = ${JSON.stringify(beforeAssistantText)};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const roleBlocks = () => Array.from(document.querySelectorAll("[data-message-author-role]")).filter(visible);
  const textOf = (element) => element?.innerText || element?.textContent || "";
  const cleanReply = (text) => String(text || "")
    .split("\\n")
    .map((line) => line.trim())
    .filter((line) => line && !["发送", "停止生成", "重新生成", "Search", "Reason", "Canvas", "来源"].includes(line))
    .filter((line) => !line.includes("ChatGPT can make mistakes") && !line.includes("ChatGPT 也可能会犯错"))
    .join("\\n")
    .trim();
  let userIndex = -1;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const blocks = roleBlocks();
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      if (blocks[index].getAttribute("data-message-author-role") === "user" && index >= beforeLength) {
        userIndex = index;
        break;
      }
    }
    if (userIndex >= 0) break;
    await sleep(250);
  }
  if (userIndex < 0) return { ok: false, blocker: "user-block-not-created", reply: "" };

  let stableText = "";
  let stableCount = 0;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 150000) {
    await sleep(1000);
    const blocks = roleBlocks();
    const replies = [];
    for (let index = userIndex + 1; index < blocks.length; index += 1) {
      const role = blocks[index].getAttribute("data-message-author-role");
      if (role === "user") break;
      if (role === "assistant") {
        const reply = cleanReply(textOf(blocks[index]));
        if (reply && reply !== beforeAssistantText) replies.push(reply);
      }
    }
    const reply = replies.join("\\n\\n").trim();
    const generating = (document.body?.innerText || "").includes("停止生成")
      || (document.body?.innerText || "").includes("正在生成")
      || (document.body?.innerText || "").includes("生成中")
      || Boolean(document.querySelector("button[data-testid='stop-button'],button[aria-label*='Stop'],button[aria-label*='停止'],button[aria-label*='正在']"));
    if (reply && reply === stableText) stableCount += 1;
    else {
      stableText = reply;
      stableCount = reply ? 1 : 0;
    }
    if (stableText && stableCount >= 2 && !generating) {
      return { ok: true, blocker: "", reply: stableText };
    }
  }
  return { ok: false, blocker: stableText ? "reply-not-settled" : "reply-timeout", reply: stableText };
})()
`;
}

function getChatGptBridgeExpression(prompt: string) {
  return `
(async () => {
  const prompt = ${JSON.stringify(prompt)};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const roleBlocks = () => Array.from(document.querySelectorAll("[data-message-author-role]")).filter(visible);
  const textOf = (element) => element?.innerText || element?.textContent || "";
  const cleanReply = (text) => String(text || "")
    .split("\\n")
    .map((line) => line.trim())
    .filter((line) => line && !["发送", "停止生成", "重新生成", "Search", "Reason", "Canvas", "来源"].includes(line))
    .filter((line) => !line.includes("ChatGPT can make mistakes") && !line.includes("ChatGPT 也可能会犯错"))
    .join("\\n")
    .trim();
  const gateWords = ["Log in", "Sign up", "登录", "注册", "验证", "captcha", "Cloudflare", "Checking your browser"];
  const hasGate = () => gateWords.some((word) => (document.body?.innerText || "").includes(word));
  const beforeBlocks = roleBlocks();
  const beforeLength = beforeBlocks.length;
  const beforeAssistantText = cleanReply(textOf([...beforeBlocks].reverse().find((block) => block.getAttribute("data-message-author-role") === "assistant")));

  const findInput = () => ["#prompt-textarea", "[contenteditable='true'][id='prompt-textarea']", "[contenteditable='true']", "textarea", "[role='textbox']"]
    .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
    .find((element) => visible(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true" && !element.readOnly);
  let input = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    input = findInput();
    if (input) break;
    await sleep(150);
  }
  if (!input) return { ok: false, blocker: hasGate() ? "login-or-verification" : "input-not-found", reply: "" };

  input.focus({ preventScroll: true });
  if ("value" in input) {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")
      || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    if (descriptor?.set) descriptor.set.call(input, "");
    else input.value = "";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: null, inputType: "deleteContentBackward" }));
    input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, data: prompt, inputType: "insertText" }));
    if (descriptor?.set) descriptor.set.call(input, prompt);
    else input.value = prompt;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: prompt, inputType: "insertText" }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    range.deleteContents();
    selection?.removeAllRanges();
    selection?.addRange(range);
    input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, data: prompt, inputType: "insertText" }));
    document.execCommand("insertText", false, prompt);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: prompt, inputType: "insertText" }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const buttonLabel = (element) => [element.id, element.getAttribute("data-testid"), element.innerText, element.getAttribute("aria-label"), element.getAttribute("title")]
    .filter(Boolean).join(" ").toLowerCase();
  const isSendButton = (element) => {
    const label = buttonLabel(element);
    return label.includes("send") || label.includes("发送") || label.includes("submit") || label.includes("composer-submit-button") || label.includes("send-button");
  };
  const findSendButton = () => Array.from(document.querySelectorAll("button,[role='button']"))
    .filter((element) => visible(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true")
    .find(isSendButton)
    || document.querySelector("#composer-submit-button,button[data-testid='send-button'],button[data-testid='composer-submit-button'],button[aria-label*='Send'],button[aria-label*='发送'],button[aria-label*='发送提示'],button.composer-submit-btn");
  let sendButton = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    sendButton = findSendButton();
    if (sendButton && visible(sendButton) && !sendButton.disabled && sendButton.getAttribute("aria-disabled") !== "true") break;
    await sleep(150);
  }
  if (!sendButton || !visible(sendButton) || sendButton.disabled || sendButton.getAttribute("aria-disabled") === "true") {
    return { ok: false, blocker: "send-button-not-found", reply: "" };
  }
  sendButton.click();

  let userIndex = -1;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const blocks = roleBlocks();
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      if (blocks[index].getAttribute("data-message-author-role") === "user" && index >= beforeLength) {
        userIndex = index;
        break;
      }
    }
    if (userIndex >= 0) break;
    await sleep(250);
  }
  if (userIndex < 0) {
    return { ok: false, blocker: hasGate() ? "login-or-verification" : "user-block-not-created", reply: "" };
  }

  let stableText = "";
  let stableCount = 0;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 150000) {
    await sleep(1000);
    const blocks = roleBlocks();
    const replies = [];
    for (let index = userIndex + 1; index < blocks.length; index += 1) {
      const role = blocks[index].getAttribute("data-message-author-role");
      if (role === "user") break;
      if (role === "assistant") {
        const reply = cleanReply(textOf(blocks[index]));
        if (reply && reply !== beforeAssistantText) replies.push(reply);
      }
    }
    const reply = replies.join("\\n\\n").trim();
    const generating = (document.body?.innerText || "").includes("停止生成")
      || (document.body?.innerText || "").includes("正在生成")
      || (document.body?.innerText || "").includes("生成中")
      || Boolean(document.querySelector("button[data-testid='stop-button'],button[aria-label*='Stop'],button[aria-label*='停止'],button[aria-label*='正在']"));
    if (reply && reply === stableText) stableCount += 1;
    else {
      stableText = reply;
      stableCount = reply ? 1 : 0;
    }
    if (hasGate() && !stableText) {
      return { ok: false, blocker: "login-or-verification", reply: "" };
    }
    if (stableText && stableCount >= 2 && !generating) {
      return { ok: true, blocker: "", reply: stableText };
    }
  }

  return { ok: false, blocker: stableText ? "reply-not-settled" : "reply-timeout", reply: stableText };
})()
`;
}

async function probeChatGptReply(target: ChromeDebugTarget, requestId: string): Promise<ChatGptReplyProbePayload> {
  const probeResult = await sendChromeCdpCommand(
    target.webSocketDebuggerUrl!,
    "Runtime.evaluate",
    {
      expression: getChatGptReplyProbeExpression(requestId),
      returnByValue: true,
      timeout: 6000
    },
    8000
  );
  return (unwrapRuntimeEvaluationValue(probeResult, "ChatGPT") as ChatGptReplyProbePayload | undefined) ?? {};
}

async function verifySettledChatGptReply(target: ChromeDebugTarget, requestId: string, currentReply: string) {
  let bestReply = currentReply;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await delay(2000);
    const probePayload = await probeChatGptReply(target, requestId);
    const nextReply = probePayload.reply?.trim() ?? "";
    if (nextReply.length >= bestReply.length) {
      bestReply = nextReply;
    }
    if (probePayload.generating) {
      return { settled: false, reply: bestReply };
    }
  }
  return { settled: true, reply: bestReply };
}

async function submitAndPollChatGpt(target: ChromeDebugTarget, prompt: string, requestId: string) {
  const submitResult = await sendChromeCdpCommand(
    target.webSocketDebuggerUrl!,
    "Runtime.evaluate",
    {
      expression: getChatGptSubmitExpression(prompt, requestId),
      awaitPromise: true,
      returnByValue: true,
      timeout: 12000
    },
    15000
  );
  const submitPayload = unwrapRuntimeEvaluationValue(submitResult, "ChatGPT") as { ok?: boolean; blocker?: string; sendPoint?: { x?: unknown; y?: unknown } } | undefined;
  if (!submitPayload?.ok) {
    if (submitPayload?.blocker === "login-or-verification") {
      throw new Error("ChatGPT 需要登录或验证，请先在端口管理确认登录状态");
    }
    return { ok: false, blocker: submitPayload?.blocker || "send-failed", reply: "", deadShell: false };
  }
  await dispatchChatGptMouseClick(target, submitPayload.sendPoint ?? {});
  await delay(1400);
  const tagResult = await sendChromeCdpCommand(
    target.webSocketDebuggerUrl!,
    "Runtime.evaluate",
    {
      expression: getChatGptTagLatestUserExpression(prompt, requestId),
      returnByValue: true,
      timeout: 6000
    },
    8000
  );
  const tagPayload = unwrapRuntimeEvaluationValue(tagResult, "ChatGPT") as { ok?: boolean; blocker?: string } | undefined;
  if (!tagPayload?.ok) {
    return { ok: false, blocker: tagPayload?.blocker || "request-not-tagged", reply: "", deadShell: false };
  }

  let stableText = "";
  let stableCount = 0;
  let firstReplyAt = 0;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 150000) {
    await delay(1000);
    const probePayload = await probeChatGptReply(target, requestId);
    const reply = probePayload?.reply?.trim() ?? "";
    if (reply && !firstReplyAt) firstReplyAt = Date.now();
    if (reply && reply === stableText) stableCount += 1;
    else {
      stableText = reply;
      stableCount = reply ? 1 : 0;
    }
    if (probePayload?.blocker === "login-or-verification" && !stableText) {
      throw new Error("ChatGPT 需要登录或验证，请先在端口管理确认登录状态");
    }
    if (!stableText && !probePayload?.generating && (probePayload?.assistantCount ?? 0) > 0 && Date.now() - startedAt >= 25000) {
      return { ok: false, blocker: "empty-assistant-shell", reply: "", deadShell: true };
    }
    const waitedAfterFirstReply = firstReplyAt > 0 && Date.now() - firstReplyAt >= 3200;
    if (stableText && stableCount >= 3 && waitedAfterFirstReply && !probePayload?.generating) {
      const verified = await verifySettledChatGptReply(target, requestId, stableText);
      if (verified.reply.length > stableText.length) {
        stableText = verified.reply;
      }
      if (!verified.settled) {
        stableCount = 1;
        continue;
      }
      return { ok: true, blocker: "", reply: stableText, deadShell: false };
    }
  }

  return { ok: false, blocker: "reply-timeout", reply: "", deadShell: false };
}

async function sendChatGptAiChat(target: ChromeDebugTarget, prompt: string, _requestId: string): Promise<AiChatResult> {
  const prepareResult = await sendChromeCdpCommand(
    target.webSocketDebuggerUrl!,
    "Runtime.evaluate",
    {
      expression: getChatGptPrepareExpression(prompt),
      awaitPromise: true,
      returnByValue: true,
      timeout: 45000
    },
    50000
  );
  const preparePayload = unwrapRuntimeEvaluationValue(prepareResult, "ChatGPT") as ChatGptPreparePayload | undefined;
  if (!preparePayload?.ok) {
    if (preparePayload?.blocker === "login-or-verification") {
      throw new Error("ChatGPT 需要登录或验证，请先在端口管理确认登录状态");
    }
    throw new Error(preparePayload?.blocker ? `ChatGPT 未返回结果：${preparePayload.blocker}` : "ChatGPT 未返回结果");
  }

  await dispatchChatGptEnter(target);

  const replyResult = await sendChromeCdpCommand(
    target.webSocketDebuggerUrl!,
    "Runtime.evaluate",
    {
      expression: getChatGptReplyAfterSendExpression(
        typeof preparePayload.beforeLength === "number" ? preparePayload.beforeLength : 0,
        typeof preparePayload.beforeAssistantText === "string" ? preparePayload.beforeAssistantText : ""
      ),
      awaitPromise: true,
      returnByValue: true,
      timeout: 170000
    },
    180000
  );
  const payload = unwrapRuntimeEvaluationValue(replyResult, "ChatGPT") as { ok?: boolean; blocker?: string; reply?: string } | undefined;
  const reply = payload?.reply?.trim() ?? "";
  if (payload?.ok && reply) {
    return { ok: true, provider: "chatgpt", reply };
  }
  if (payload?.blocker === "login-or-verification") {
    throw new Error("ChatGPT 需要登录或验证，请先在端口管理确认登录状态");
  }
  throw new Error(payload?.blocker ? `ChatGPT 未返回结果：${payload.blocker}` : "ChatGPT 未返回结果");
}

async function sendAiChat(rawRequest: unknown): Promise<AiChatResult> {
  const request = sanitizeAiChatRequest(rawRequest);
  const platform = getAiChatPlatform(request.provider);
  const target = await getAiChatPageTarget(platform);
  const prompt = buildAiChatPrompt(request);
  const requestId = randomUUID();
  if (request.provider === "chatgpt") {
    return await sendChatGptAiChat(target, prompt, requestId);
  }
  const result = await sendChromeCdpCommand(
    target.webSocketDebuggerUrl!,
    "Runtime.evaluate",
    {
      expression: getAiChatAutomationExpression(request.provider, prompt, requestId),
      awaitPromise: true,
      returnByValue: true,
      timeout: 90000
    },
    95000
  );
  const evaluation = result as { result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } } | null;
  if (evaluation?.exceptionDetails) {
    throw new Error(evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text || `${platform.name} 页面执行失败`);
  }

  const payload = evaluation?.result?.value as { ok?: boolean; blocker?: string; reply?: string } | undefined;
  if (payload?.reply?.trim()) {
    return {
      ok: true,
      provider: request.provider,
      reply: payload.reply.trim()
    };
  }

  if (payload?.blocker === "login-or-verification") {
    throw new Error(`${platform.name} 需要登录或验证，请先在端口管理确认登录状态`);
  }

  throw new Error(payload?.blocker ? `${platform.name} 未返回结果：${payload.blocker}` : `${platform.name} 未返回结果`);
}

async function resolveChromeExecutableCandidate(candidate: string | undefined | null) {
  const trimmed = candidate?.trim();
  if (!trimmed) return null;

  try {
    await fs.access(trimmed);
  } catch {
    return null;
  }

  if (trimmed.toLowerCase().endsWith(".exe")) {
    return trimmed;
  }

  if (!/\.(?:cmd|bat)$/i.test(trimmed)) {
    return null;
  }

  try {
    const launcher = await fs.readFile(trimmed, "utf8");
    const match = launcher.match(/set\s+"?CHROME_EXE=([^"\r\n]+chrome\.exe)"?/i);
    const executablePath = match?.[1]?.trim();
    if (!executablePath) return null;
    await fs.access(executablePath);
    return executablePath;
  } catch {
    return null;
  }
}

async function findChromeExecutable() {
  const registryCandidates = await getChromeRegistryCandidates();
  const candidates = [
    process.env.AISTUDY_CHROME_PATH,
    ...registryCandidates,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe") : "",
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"]!, "Google", "Chrome", "Application", "chrome.exe") : "",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : ""
  ].filter((candidate, index, all): candidate is string => Boolean(candidate && candidate.trim()) && all.indexOf(candidate) === index);

  for (const candidate of candidates) {
    const chromePath = await resolveChromeExecutableCandidate(candidate);
    if (chromePath) return chromePath;
  }

  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("where.exe", ["chrome"], { windowsHide: true });
      for (const line of stdout.split(/\r?\n/)) {
        const chromePath = await resolveChromeExecutableCandidate(line);
        if (chromePath) return chromePath;
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function readWindowsRegistryString(key: string, valueName?: string) {
  if (process.platform !== "win32") return null;

  const args = valueName ? ["query", key, "/v", valueName] : ["query", key, "/ve"];
  try {
    const { stdout } = await execFileAsync("reg.exe", args, { windowsHide: true });
    for (const line of stdout.split(/\r?\n/)) {
      const match = line.match(/\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/i);
      if (match?.[1]?.trim()) {
        return match[1].trim();
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function getChromeRegistryCandidates() {
  const keys = [
    "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe",
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe",
    "HKCU\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe",
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe"
  ];
  const candidates: string[] = [];

  for (const key of keys) {
    const executablePath = await readWindowsRegistryString(key);
    if (executablePath) {
      candidates.push(executablePath);
    }

    const installDir = await readWindowsRegistryString(key, "Path");
    if (installDir) {
      candidates.push(path.join(installDir, "chrome.exe"));
    }
  }

  return candidates;
}

async function getChromePortStatus(platform: ChromePortDefinition, savedStoreInput?: ChromePortSavedStore): Promise<ChromePortStatus> {
  const connected = await canConnectToLocalPort(platform.port);
  const savedStore = savedStoreInput ?? await readChromePortSavedStore();
  const probe = await probeChromePortLogin(platform, connected);
  const savedEntry = probe.authenticated
    ? (await saveAuthenticatedChromePort(platform, probe)) ?? savedStore.ports[platform.id]
    : savedStore.ports[platform.id];
  const saved = Boolean(savedEntry);
  const statusText = probe.authenticated
    ? "已登录并保存"
    : connected
      ? probe.pageDetected
        ? saved
          ? "已保存，待重新确认"
          : "待登录确认"
        : "端口已连接"
      : saved
        ? "已保存，未启动"
        : "未启动";

  return {
    ...platform,
    connected,
    pageDetected: probe.pageDetected,
    authenticated: probe.authenticated,
    saved,
    profileDir: getChromePortProfileDir(platform),
    statusText,
    lastCheckedAt: new Date().toISOString(),
    savedAt: savedEntry?.savedAt ?? "",
    authenticatedAt: probe.authenticatedAt || savedEntry?.authenticatedAt || "",
    detectedUrl: probe.detectedUrl || savedEntry?.detectedUrl || ""
  };
}

async function getChromePortStatuses() {
  const savedStore = await readChromePortSavedStore();
  return Promise.all(chromePortDefinitions.map((platform) => getChromePortStatus(platform, savedStore)));
}

async function openChromePortPage(platformId: unknown, url?: unknown): Promise<ChromePortOpenResult> {
  const platform = getRequiredChromePortDefinition(platformId);
  const targetUrl = normalizeChromePortOpenUrl(platform, url);
  if (await canConnectToLocalPort(platform.port)) {
    const opened = await openUrlInChromePort(platform.port, targetUrl);
    await delay(700);
    const status = await getChromePortStatus(platform);
    return {
      status,
      openedUrl: targetUrl,
      message: opened
        ? `${platform.name} 页面已在固定端口 ${platform.port} 打开`
        : `${platform.name} 固定端口 ${platform.port} 已连接，请在对应 Chrome 窗口确认页面`
    };
  }

  const chromePath = await findChromeExecutable();
  if (!chromePath) {
    throw new Error("未找到 Chrome，可通过 AISTUDY_CHROME_PATH 指定 chrome.exe 路径");
  }

  const profileDir = getChromePortProfileDir(platform);
  await fs.mkdir(profileDir, { recursive: true });
  const child = spawn(
    chromePath,
    [
      `--remote-debugging-port=${platform.port}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--new-window",
      targetUrl
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    }
  );
  child.unref();

  const ready = await waitForChromePort(platform.port);
  await delay(700);
  const status = await getChromePortStatus(platform);
  return {
    status,
    openedUrl: targetUrl,
    message: ready
      ? `${platform.name} 页面已启动，端口 ${platform.port} 已连接`
      : `${platform.name} 页面已尝试启动，端口 ${platform.port} 暂未就绪`
  };
}

async function openChromePortLogin(platformId: unknown): Promise<ChromePortOpenResult> {
  const platform = getRequiredChromePortDefinition(platformId);
  const result = await openChromePortPage(platform.id, platform.loginUrl);
  return {
    ...result,
    message: result.status.authenticated
      ? `${platform.name} 已识别登录状态，端口 ${platform.port} 已保存`
      : result.status.connected
        ? `${platform.name} 登录窗口已启动，端口 ${platform.port} 已连接；登录完成后会自动识别并保存`
        : `${platform.name} 登录窗口已尝试启动，端口 ${platform.port} 暂未就绪`
  };
}

function normalizeCourseStore(value: unknown): CourseStore {
  if (!value || typeof value !== "object") {
    return { sections: [], courses: [], activeCourseId: null };
  }

  const candidate = value as Partial<CourseStore>;
  const sectionIds = new Set<string>();
  const sections = Array.isArray(candidate.sections)
    ? candidate.sections
        .filter(
          (section): section is CourseSectionRecord =>
            Boolean(section) &&
            typeof section.id === "string" &&
            typeof section.name === "string" &&
            typeof section.createdAt === "string" &&
            typeof section.updatedAt === "string"
        )
        .map((section, index) => {
          sectionIds.add(section.id);
          return {
            id: section.id,
            name: section.name,
            sortOrder: Number.isFinite(section.sortOrder) ? section.sortOrder : index,
            collapsed: Boolean(section.collapsed),
            createdAt: section.createdAt,
            updatedAt: section.updatedAt
          };
        })
    : [];
  const courses = Array.isArray(candidate.courses)
    ? candidate.courses
        .filter(
          (course): course is CourseRecord =>
            Boolean(course) &&
            typeof course.id === "string" &&
            typeof course.name === "string" &&
            typeof course.description === "string" &&
            typeof course.createdAt === "string" &&
            typeof course.updatedAt === "string"
        )
        .map((course, index) => ({
          ...course,
          sectionId: typeof course.sectionId === "string" && sectionIds.has(course.sectionId) ? course.sectionId : null,
          sortOrder: Number.isFinite(course.sortOrder) ? course.sortOrder : index
        }))
    : [];
  const activeCourseId = typeof candidate.activeCourseId === "string" && courses.some((course) => course.id === candidate.activeCourseId)
    ? candidate.activeCourseId
    : null;

  return { sections, courses, activeCourseId };
}

function validateMysqlIdentifier(value: string, label: string) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`${label} can only contain letters, numbers, and underscores.`);
  }
}

function escapeMysqlIdentifier(value: string, label: string) {
  validateMysqlIdentifier(value, label);
  return `\`${value}\``;
}

function parsePort(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
      return parsed;
    }
  }

  return fallback;
}

function getStringSetting(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readSetting(source: unknown, key: keyof MysqlConfig) {
  if (!source || typeof source !== "object") return undefined;
  return (source as Partial<Record<keyof MysqlConfig, unknown>>)[key];
}

async function readMysqlConfigFile(filePath: string) {
  try {
    return parseJsonText(await fs.readFile(filePath, "utf8")) as Partial<MysqlConfig>;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function readPublicRuntimeEnv(name: string) {
  return process.env[`AISTUDY_PUBLIC_${name}`] ?? process.env[`AISTUDY_${name}`];
}

function readPublicMysqlEnv(name: string) {
  return readPublicRuntimeEnv(`MYSQL_${name}`);
}

function parseJsonText<T = unknown>(text: string): T {
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as T;
}

function getProgramDataAistudyRoot() {
  const programData = process.env.ProgramData?.trim() || "C:\\ProgramData";
  return path.join(programData, "AIstudy");
}

function isLocalMysqlHost(host: string) {
  const normalized = host.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

function parseManagedMysqlIniPort(text: string) {
  const match = text.match(/^\s*port\s*=\s*(\d+)\s*$/im);
  return match ? parsePort(match[1], 3306) : 3306;
}

async function readManagedMysqlRuntimeConfig() {
  try {
    const iniPath = path.join(getProgramDataAistudyRoot(), "mysql", "my.ini");
    const iniText = await fs.readFile(iniPath, "utf8");
    return {
      host: "127.0.0.1",
      port: parseManagedMysqlIniPort(iniText),
      user: "root",
      password: ""
    } satisfies Partial<MysqlConfig>;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function waitForLocalPort(port: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnectToLocalPort(port, 450)) return true;
    await delay(250);
  }
  return false;
}

async function tryStartManagedMysqlRuntime(config: MysqlConfig) {
  if (process.platform !== "win32" || !isLocalMysqlHost(config.host)) return;

  const managedConfig = await readManagedMysqlRuntimeConfig();
  if (!hasMysqlConnectionSetting(managedConfig) || Number(managedConfig.port) !== config.port) return;
  if (await canConnectToLocalPort(config.port, 600)) return;

  try {
    await execFileAsync("sc.exe", ["start", MANAGED_MYSQL_SERVICE_NAME], {
      windowsHide: true,
      timeout: 2500
    });
  } catch {
    // The service may already be starting or require elevation; the actual MySQL connection check remains authoritative.
  }

  await waitForLocalPort(config.port, MANAGED_MYSQL_START_TIMEOUT_MS);
}

function hasPublicMysqlEnvSetting() {
  return ["HOST", "PORT", "USER", "PASSWORD"].some((name) => readPublicMysqlEnv(name) !== undefined);
}

function hasMysqlConnectionSetting(source: unknown) {
  if (!source || typeof source !== "object") return false;
  return ["host", "port", "user", "password"].some((key) => Object.prototype.hasOwnProperty.call(source, key));
}

function sanitizeLocatorFileName(value: string) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "course";
}

async function createCourseLocatorFile(input: CourseLocatorRequest) {
  const courseId = normalizeId(input?.courseId, "Course id");
  const courseName = getNonEmptyString(input?.courseName, "未命名知识库").slice(0, 120);
  const courseDescription = getNonEmptyString(input?.courseDescription, "").slice(0, 500);
  const sectionId = getNonEmptyString(input?.sectionId, "");
  const sectionName = getNonEmptyString(input?.sectionName, "");
  const mysqlConfig = await readMysqlConfig();
  const locatorDir = getAistudyDataPath("locators", "courses");
  const locatorPath = path.join(locatorDir, `${sanitizeLocatorFileName(courseName)}__${courseId}.aistudy-course.json`);
  const locator = {
    version: 1,
    kind: "aistudy-course-locator",
    createdAt: new Date().toISOString(),
    app: {
      name: "AIstudy",
      version: app.getVersion()
    },
    local: {
      dataRoot: getAistudyDataRoot(),
      locatorPath
    },
    mysql: {
      host: mysqlConfig.host,
      port: mysqlConfig.port,
      database: mysqlConfig.database,
      tables: {
        courses: mysqlConfig.courseTable,
        sections: mysqlConfig.courseSectionTable,
        mindMaps: mysqlConfig.mindMapTable,
        mindMapNodes: mysqlConfig.mindMapNodeTable,
        documents: mysqlConfig.knowledgeDocumentTable,
        documentSnapshots: mysqlConfig.knowledgeDocumentSnapshotTable,
        examQuestions: mysqlConfig.examQuestionTable,
        examPapers: mysqlConfig.examPaperTable,
        examPaperSections: mysqlConfig.examPaperSectionTable,
        examPaperQuestions: mysqlConfig.examPaperQuestionTable,
        examAttempts: mysqlConfig.examAttemptTable,
        textbookAssets: mysqlConfig.textbookAssetTable,
        textbookNotes: mysqlConfig.textbookNoteTable
      }
    },
    course: {
      id: courseId,
      name: courseName,
      description: courseDescription,
      sectionId: sectionId || null,
      sectionName: sectionName || null
    }
  };
  await fs.mkdir(locatorDir, { recursive: true });
  await fs.writeFile(locatorPath, `${JSON.stringify(locator, null, 2)}\n`, "utf8");
  return locatorPath;
}

async function readMysqlConfig(): Promise<MysqlConfig> {
  const managedMysqlConfig = await readManagedMysqlRuntimeConfig();
  const executableConfig = await readMysqlConfigFile(path.join(path.dirname(process.execPath), "mysql.config.json"));
  const programDataConfig = await readMysqlConfigFile(path.join(getProgramDataAistudyRoot(), "mysql.config.json"));
  const programDataPublicConfig = await readMysqlConfigFile(path.join(getProgramDataAistudyRoot(), "AIstudyPublicData", "config", "mysql.config.json"));
  const programDataUserConfig = await readMysqlConfigFile(path.join(getProgramDataAistudyRoot(), "AIstudyUserData", "mysql.config.json"));
  const dataRootConfig = await readMysqlConfigFile(getAistudyDataPath("config", "mysql.config.json"));
  const userConfig = await readMysqlConfigFile(path.join(app.getPath("userData"), "mysql.config.json"));
  const mergedConfig = { ...managedMysqlConfig, ...programDataConfig, ...programDataPublicConfig, ...programDataUserConfig, ...executableConfig, ...dataRootConfig, ...userConfig };
  const explicitlyConfigured = hasPublicMysqlEnvSetting()
    || hasMysqlConnectionSetting(managedMysqlConfig)
    || hasMysqlConnectionSetting(programDataConfig)
    || hasMysqlConnectionSetting(programDataPublicConfig)
    || hasMysqlConnectionSetting(programDataUserConfig)
    || hasMysqlConnectionSetting(executableConfig)
    || hasMysqlConnectionSetting(dataRootConfig)
    || hasMysqlConnectionSetting(userConfig);

  const config = {
    host: getStringSetting(readPublicMysqlEnv("HOST"), getStringSetting(readSetting(mergedConfig, "host"), "127.0.0.1")),
    port: parsePort(readPublicMysqlEnv("PORT"), parsePort(readSetting(mergedConfig, "port"), 3306)),
    user: getStringSetting(readPublicMysqlEnv("USER"), getStringSetting(readSetting(mergedConfig, "user"), "root")),
    password: typeof readPublicMysqlEnv("PASSWORD") === "string"
      ? readPublicMysqlEnv("PASSWORD") ?? ""
        : getStringSetting(readSetting(mergedConfig, "password"), ""),
    explicitlyConfigured,
    database: PUBLIC_MYSQL_DATABASE,
    courseTable: PUBLIC_MYSQL_TABLES.courses,
    courseSectionTable: PUBLIC_MYSQL_TABLES.sections,
    mindMapTable: PUBLIC_MYSQL_TABLES.mindMaps,
    mindMapSnapshotTable: PUBLIC_MYSQL_TABLES.mindMapSnapshots,
    mindMapNodeTable: PUBLIC_MYSQL_TABLES.mindMapNodes,
    knowledgeDocumentTable: PUBLIC_MYSQL_TABLES.documents,
    knowledgeDocumentSnapshotTable: PUBLIC_MYSQL_TABLES.documentSnapshots,
    assetTable: PUBLIC_MYSQL_TABLES.assets,
    knowledgeAssetLinkTable: PUBLIC_MYSQL_TABLES.assetLinks,
    chromePortStateTable: PUBLIC_MYSQL_TABLES.chromePortStates,
    errorLogTable: PUBLIC_MYSQL_TABLES.errorLogs,
    examQuestionTable: PUBLIC_MYSQL_TABLES.examQuestions,
    examPaperTable: PUBLIC_MYSQL_TABLES.examPapers,
    examPaperSectionTable: PUBLIC_MYSQL_TABLES.examPaperSections,
    examPaperQuestionTable: PUBLIC_MYSQL_TABLES.examPaperQuestions,
    examAttemptTable: PUBLIC_MYSQL_TABLES.examAttempts,
    textbookAssetTable: PUBLIC_MYSQL_TABLES.textbookAssets,
    textbookNoteTable: PUBLIC_MYSQL_TABLES.textbookNotes
  };

  validateMysqlIdentifier(config.database, "MySQL database");
  validateMysqlIdentifier(config.courseTable, "MySQL course table");
  validateMysqlIdentifier(config.courseSectionTable, "MySQL course section table");
  validateMysqlIdentifier(config.mindMapTable, "MySQL mind map table");
  validateMysqlIdentifier(config.mindMapSnapshotTable, "MySQL mind map snapshot table");
  validateMysqlIdentifier(config.mindMapNodeTable, "MySQL mind map node table");
  validateMysqlIdentifier(config.knowledgeDocumentTable, "MySQL knowledge document table");
  validateMysqlIdentifier(config.knowledgeDocumentSnapshotTable, "MySQL knowledge document snapshot table");
  validateMysqlIdentifier(config.assetTable, "MySQL asset table");
  validateMysqlIdentifier(config.knowledgeAssetLinkTable, "MySQL knowledge asset link table");
  validateMysqlIdentifier(config.chromePortStateTable, "MySQL Chrome port state table");
  validateMysqlIdentifier(config.errorLogTable, "MySQL error log table");
  validateMysqlIdentifier(config.examQuestionTable, "MySQL exam question table");
  validateMysqlIdentifier(config.examPaperTable, "MySQL exam paper table");
  validateMysqlIdentifier(config.examPaperSectionTable, "MySQL exam paper section table");
  validateMysqlIdentifier(config.examPaperQuestionTable, "MySQL exam paper question table");
  validateMysqlIdentifier(config.examAttemptTable, "MySQL exam attempt table");
  validateMysqlIdentifier(config.textbookAssetTable, "MySQL textbook asset table");
  validateMysqlIdentifier(config.textbookNoteTable, "MySQL textbook note table");
  return config;
}

async function ensureDatabase(config: MysqlConfig) {
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password
  });

  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS ${escapeMysqlIdentifier(config.database, "MySQL database")} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await connection.end();
  }
}

async function ensureCourseTable(pool: Pool, courseTable: string) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${courseTable} (
      id VARCHAR(64) NOT NULL,
      name VARCHAR(120) NOT NULL,
      description TEXT NOT NULL,
      section_id VARCHAR(64) NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (id),
      KEY idx_section_order (section_id, sort_order),
      KEY idx_updated_at (updated_at),
      KEY idx_name (name),
      KEY idx_course_live_order (deleted_at, section_id, sort_order, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureCourseSectionTable(pool: Pool, sectionTable: string) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${sectionTable} (
      id VARCHAR(64) NOT NULL,
      name VARCHAR(120) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      collapsed TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (id),
      KEY idx_section_order (sort_order),
      KEY idx_section_name (name),
      KEY idx_section_live_order (deleted_at, sort_order, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function rawMysqlIdentifier(escapedIdentifier: string) {
  return escapedIdentifier.replace(/^`|`$/g, "");
}

async function hasMysqlColumn(pool: Pool, tableName: string, columnName: string) {
  const [rows] = await pool.execute<MysqlSchemaRow[]>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function hasMysqlIndex(pool: Pool, tableName: string, indexName: string) {
  const [rows] = await pool.execute<MysqlSchemaRow[]>(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );
  return rows.length > 0;
}

async function addMysqlColumnIfMissing(pool: Pool, table: string, tableName: string, columnName: string, definition: string) {
  if (await hasMysqlColumn(pool, tableName, columnName)) return;
  await pool.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

async function addMysqlIndexIfMissing(pool: Pool, table: string, tableName: string, indexName: string, definition: string) {
  if (await hasMysqlIndex(pool, tableName, indexName)) return;
  await pool.query(`ALTER TABLE ${table} ADD ${definition}`);
}

async function migrateCourseTable(pool: Pool, courseTable: string) {
  const courseTableName = rawMysqlIdentifier(courseTable);
  await addMysqlColumnIfMissing(pool, courseTable, courseTableName, "section_id", "`section_id` VARCHAR(64) NULL AFTER `description`");
  await addMysqlColumnIfMissing(pool, courseTable, courseTableName, "sort_order", "`sort_order` INT NOT NULL DEFAULT 0 AFTER `section_id`");
  await addMysqlColumnIfMissing(pool, courseTable, courseTableName, "deleted_at", "`deleted_at` DATETIME(3) NULL AFTER `updated_at`");
  await addMysqlIndexIfMissing(pool, courseTable, courseTableName, "idx_section_order", "KEY idx_section_order (section_id, sort_order)");
  await addMysqlIndexIfMissing(pool, courseTable, courseTableName, "idx_course_live_order", "KEY idx_course_live_order (deleted_at, section_id, sort_order, updated_at)");
}

async function migrateCourseSectionTable(pool: Pool, sectionTable: string) {
  const sectionTableName = rawMysqlIdentifier(sectionTable);
  await addMysqlColumnIfMissing(pool, sectionTable, sectionTableName, "deleted_at", "`deleted_at` DATETIME(3) NULL AFTER `updated_at`");
  await addMysqlIndexIfMissing(pool, sectionTable, sectionTableName, "idx_section_live_order", "KEY idx_section_live_order (deleted_at, sort_order, updated_at)");
}

async function migrateMindMapTables(pool: Pool, mindMapTable: string, snapshotTable: string, nodeTable: string) {
  const mindMapTableName = rawMysqlIdentifier(mindMapTable);
  const snapshotTableName = rawMysqlIdentifier(snapshotTable);
  const nodeTableName = rawMysqlIdentifier(nodeTable);

  await addMysqlColumnIfMissing(pool, mindMapTable, mindMapTableName, "node_count", "`node_count` INT NOT NULL DEFAULT 0 AFTER `current_snapshot_id`");
  if (await hasMysqlColumn(pool, mindMapTableName, "schema_version")) {
    await pool.query(`UPDATE ${mindMapTable} SET schema_version = 1 WHERE schema_version IS NULL`);
    await pool.query(`ALTER TABLE ${mindMapTable} MODIFY COLUMN schema_version INT NOT NULL DEFAULT 1`);
  }
  await pool.query(`ALTER TABLE ${mindMapTable} MODIFY COLUMN id VARCHAR(64) NOT NULL`);
  await pool.query(`ALTER TABLE ${mindMapTable} MODIFY COLUMN root_node_id VARCHAR(96) NOT NULL`);
  await pool.query(`ALTER TABLE ${mindMapTable} MODIFY COLUMN current_snapshot_id VARCHAR(64) NULL`);
  await addMysqlIndexIfMissing(pool, mindMapTable, mindMapTableName, "idx_course_updated", "KEY idx_course_updated (course_id, updated_at)");
  await addMysqlIndexIfMissing(pool, mindMapTable, mindMapTableName, "idx_deleted_at", "KEY idx_deleted_at (deleted_at)");

  await pool.query(`ALTER TABLE ${snapshotTable} MODIFY COLUMN id VARCHAR(64) NOT NULL`);
  await pool.query(`ALTER TABLE ${snapshotTable} MODIFY COLUMN mind_map_id VARCHAR(64) NOT NULL`);
  await addMysqlIndexIfMissing(pool, snapshotTable, snapshotTableName, "uk_map_sequence", "UNIQUE KEY uk_map_sequence (mind_map_id, sequence_no)");
  await addMysqlIndexIfMissing(pool, snapshotTable, snapshotTableName, "idx_map_created", "KEY idx_map_created (mind_map_id, created_at)");

  await addMysqlColumnIfMissing(pool, nodeTable, nodeTableName, "node_id", "`node_id` VARCHAR(96) NULL AFTER `id`");
  await addMysqlColumnIfMissing(pool, nodeTable, nodeTableName, "path_text", "`path_text` TEXT NULL AFTER `position_index`");
  await pool.query(`UPDATE ${nodeTable} SET node_id = id WHERE node_id IS NULL OR node_id = ''`);
  await pool.query(`ALTER TABLE ${nodeTable} MODIFY COLUMN id VARCHAR(180) NOT NULL`);
  await pool.query(`ALTER TABLE ${nodeTable} MODIFY COLUMN node_id VARCHAR(96) NOT NULL`);
  await pool.query(`ALTER TABLE ${nodeTable} MODIFY COLUMN mind_map_id VARCHAR(64) NOT NULL`);
  await pool.query(`ALTER TABLE ${nodeTable} MODIFY COLUMN parent_node_id VARCHAR(96) NULL`);
  await addMysqlIndexIfMissing(pool, nodeTable, nodeTableName, "uk_map_node", "UNIQUE KEY uk_map_node (mind_map_id, node_id)");
  await addMysqlIndexIfMissing(pool, nodeTable, nodeTableName, "idx_nodes_map_parent", "KEY idx_nodes_map_parent (mind_map_id, parent_node_id)");
  await addMysqlIndexIfMissing(pool, nodeTable, nodeTableName, "idx_nodes_course_title", "KEY idx_nodes_course_title (course_id, title(120))");
  await addMysqlIndexIfMissing(pool, nodeTable, nodeTableName, "idx_nodes_map_depth", "KEY idx_nodes_map_depth (mind_map_id, depth)");
}

async function ensureMindMapTables(pool: Pool, mindMapTable: string, snapshotTable: string, nodeTable: string) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${mindMapTable} (
      id VARCHAR(64) NOT NULL,
      course_id VARCHAR(64) NOT NULL,
      title VARCHAR(255) NOT NULL,
      root_node_id VARCHAR(96) NOT NULL,
      current_snapshot_id VARCHAR(64) NULL,
      node_count INT NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_course_map (course_id, id),
      KEY idx_course_updated (course_id, updated_at),
      KEY idx_deleted_at (deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${snapshotTable} (
      id VARCHAR(64) NOT NULL,
      mind_map_id VARCHAR(64) NOT NULL,
      sequence_no BIGINT NOT NULL,
      schema_version INT NOT NULL,
      editor VARCHAR(64) NOT NULL,
      editor_version VARCHAR(64) NULL,
      payload_json LONGTEXT NOT NULL,
      payload_hash CHAR(64) NOT NULL,
      byte_size INT NOT NULL,
      created_at DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_map_sequence (mind_map_id, sequence_no),
      KEY idx_map_created (mind_map_id, created_at),
      KEY idx_payload_hash (payload_hash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${nodeTable} (
      id VARCHAR(180) NOT NULL,
      node_id VARCHAR(96) NOT NULL,
      mind_map_id VARCHAR(64) NOT NULL,
      course_id VARCHAR(64) NOT NULL,
      parent_node_id VARCHAR(96) NULL,
      title VARCHAR(512) NOT NULL,
      depth INT NOT NULL,
      position_index INT NOT NULL,
      path_text TEXT NULL,
      is_collapsed TINYINT(1) NOT NULL DEFAULT 0,
      updated_at DATETIME(3) NOT NULL,
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_map_node (mind_map_id, node_id),
      KEY idx_nodes_map_parent (mind_map_id, parent_node_id),
      KEY idx_nodes_course_title (course_id, title(120)),
      KEY idx_nodes_map_depth (mind_map_id, depth),
      KEY idx_nodes_deleted_at (deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await migrateMindMapTables(pool, mindMapTable, snapshotTable, nodeTable);
}

async function backfillKnowledgeDocumentHasContent(pool: Pool, documentTable: string, snapshotTable: string) {
  const [rows] = await pool.execute<KnowledgeDocumentContentBackfillRow[]>(
    `SELECT d.id AS documentId, s.payload_json AS payloadJson
     FROM ${documentTable} d
     LEFT JOIN ${snapshotTable} s ON s.id = d.current_snapshot_id AND s.document_id = d.id
     WHERE d.deleted_at IS NULL`
  );

  for (const row of rows) {
    let hasContent = false;
    if (row.payloadJson) {
      try {
        hasContent = knowledgeDocumentSnapshotHasContent(normalizeKnowledgeDocumentSnapshot(parseJsonText(row.payloadJson)));
      } catch {
        hasContent = false;
      }
    }
    await pool.execute(`UPDATE ${documentTable} SET has_content = ? WHERE id = ?`, [hasContent ? 1 : 0, row.documentId]);
  }
}

async function migrateKnowledgeDocumentTables(pool: Pool, documentTable: string, snapshotTable: string) {
  const documentTableName = rawMysqlIdentifier(documentTable);
  const snapshotTableName = rawMysqlIdentifier(snapshotTable);
  const hadHasContentColumn = await hasMysqlColumn(pool, documentTableName, "has_content");

  await addMysqlColumnIfMissing(pool, documentTable, documentTableName, "mind_map_id", "`mind_map_id` VARCHAR(64) NULL AFTER `course_id`");
  await addMysqlColumnIfMissing(pool, documentTable, documentTableName, "current_byte_size", "`current_byte_size` INT NOT NULL DEFAULT 0 AFTER `current_snapshot_id`");
  await addMysqlColumnIfMissing(pool, documentTable, documentTableName, "has_content", "`has_content` TINYINT(1) NOT NULL DEFAULT 0 AFTER `current_byte_size`");
  await pool.query(`UPDATE ${documentTable} SET mind_map_id = 'legacy' WHERE mind_map_id IS NULL OR mind_map_id = ''`);
  await pool.query(`ALTER TABLE ${documentTable} MODIFY COLUMN id VARCHAR(64) NOT NULL`);
  await pool.query(`ALTER TABLE ${documentTable} MODIFY COLUMN course_id VARCHAR(64) NOT NULL`);
  await pool.query(`ALTER TABLE ${documentTable} MODIFY COLUMN mind_map_id VARCHAR(64) NOT NULL`);
  await pool.query(`ALTER TABLE ${documentTable} MODIFY COLUMN node_id VARCHAR(96) NOT NULL`);
  await pool.query(`ALTER TABLE ${documentTable} MODIFY COLUMN current_snapshot_id VARCHAR(64) NULL`);
  await pool.query(`ALTER TABLE ${documentTable} MODIFY COLUMN has_content TINYINT(1) NOT NULL DEFAULT 0`);
  await addMysqlIndexIfMissing(
    pool,
    documentTable,
    documentTableName,
    "uk_doc_node",
    "UNIQUE KEY uk_doc_node (course_id, mind_map_id, node_id)"
  );
  await addMysqlIndexIfMissing(
    pool,
    documentTable,
    documentTableName,
    "idx_doc_node_lookup",
    "KEY idx_doc_node_lookup (mind_map_id, node_id, deleted_at)"
  );
  await addMysqlIndexIfMissing(
    pool,
    documentTable,
    documentTableName,
    "idx_doc_course_updated",
    "KEY idx_doc_course_updated (course_id, updated_at)"
  );
  await addMysqlIndexIfMissing(
    pool,
    documentTable,
    documentTableName,
    "idx_doc_current_snapshot",
    "KEY idx_doc_current_snapshot (current_snapshot_id)"
  );
  await addMysqlIndexIfMissing(
    pool,
    documentTable,
    documentTableName,
    "idx_doc_content_lookup",
    "KEY idx_doc_content_lookup (course_id, mind_map_id, has_content, deleted_at)"
  );
  await addMysqlIndexIfMissing(pool, documentTable, documentTableName, "idx_doc_deleted_at", "KEY idx_doc_deleted_at (deleted_at)");
  if (!hadHasContentColumn) {
    await backfillKnowledgeDocumentHasContent(pool, documentTable, snapshotTable);
  }

  await pool.query(`ALTER TABLE ${snapshotTable} MODIFY COLUMN id VARCHAR(64) NOT NULL`);
  await pool.query(`ALTER TABLE ${snapshotTable} MODIFY COLUMN document_id VARCHAR(64) NOT NULL`);
  await addMysqlColumnIfMissing(pool, snapshotTable, snapshotTableName, "schema_version", "`schema_version` INT NOT NULL DEFAULT 1 AFTER `sequence_no`");
  await addMysqlColumnIfMissing(pool, snapshotTable, snapshotTableName, "editor", "`editor` VARCHAR(64) NOT NULL DEFAULT 'aistudy-word' AFTER `schema_version`");
  await addMysqlColumnIfMissing(pool, snapshotTable, snapshotTableName, "editor_version", "`editor_version` VARCHAR(64) NULL AFTER `editor`");
  await addMysqlColumnIfMissing(pool, snapshotTable, snapshotTableName, "payload_hash", "`payload_hash` CHAR(64) NULL AFTER `payload_json`");
  await pool.query(`UPDATE ${snapshotTable} SET payload_hash = COALESCE(SHA2(payload_json, 256), REPEAT('0', 64)) WHERE payload_hash IS NULL OR payload_hash = ''`);
  await pool.query(`ALTER TABLE ${snapshotTable} MODIFY COLUMN payload_hash CHAR(64) NOT NULL`);
  await addMysqlIndexIfMissing(
    pool,
    snapshotTable,
    snapshotTableName,
    "uk_doc_sequence",
    "UNIQUE KEY uk_doc_sequence (document_id, sequence_no)"
  );
  await addMysqlIndexIfMissing(
    pool,
    snapshotTable,
    snapshotTableName,
    "idx_doc_created",
    "KEY idx_doc_created (document_id, created_at)"
  );
  await addMysqlIndexIfMissing(pool, snapshotTable, snapshotTableName, "idx_doc_hash", "KEY idx_doc_hash (payload_hash)");
  await addMysqlIndexIfMissing(pool, snapshotTable, snapshotTableName, "idx_doc_size", "KEY idx_doc_size (byte_size)");
}

async function ensureKnowledgeDocumentTables(pool: Pool, documentTable: string, snapshotTable: string) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${documentTable} (
      id VARCHAR(64) NOT NULL,
      course_id VARCHAR(64) NOT NULL,
      mind_map_id VARCHAR(64) NOT NULL,
      node_id VARCHAR(96) NOT NULL,
      title VARCHAR(255) NOT NULL,
      current_snapshot_id VARCHAR(64) NULL,
      current_byte_size INT NOT NULL DEFAULT 0,
      has_content TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_doc_node (course_id, mind_map_id, node_id),
      KEY idx_doc_node_lookup (mind_map_id, node_id, deleted_at),
      KEY idx_doc_course_updated (course_id, updated_at),
      KEY idx_doc_current_snapshot (current_snapshot_id),
      KEY idx_doc_content_lookup (course_id, mind_map_id, has_content, deleted_at),
      KEY idx_doc_deleted_at (deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${snapshotTable} (
      id VARCHAR(64) NOT NULL,
      document_id VARCHAR(64) NOT NULL,
      sequence_no BIGINT NOT NULL,
      schema_version INT NOT NULL,
      editor VARCHAR(64) NOT NULL,
      editor_version VARCHAR(64) NULL,
      payload_json LONGTEXT NOT NULL,
      payload_hash CHAR(64) NOT NULL,
      byte_size INT NOT NULL,
      created_at DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_doc_sequence (document_id, sequence_no),
      KEY idx_doc_created (document_id, created_at),
      KEY idx_doc_hash (payload_hash),
      KEY idx_doc_size (byte_size)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await migrateKnowledgeDocumentTables(pool, documentTable, snapshotTable);
}

async function migrateKnowledgeAssetTables(pool: Pool, assetTable: string, assetLinkTable: string) {
  const assetTableName = rawMysqlIdentifier(assetTable);
  const assetLinkTableName = rawMysqlIdentifier(assetLinkTable);

  await addMysqlColumnIfMissing(pool, assetTable, assetTableName, "deleted_at", "`deleted_at` DATETIME(3) NULL AFTER `updated_at`");
  await addMysqlIndexIfMissing(pool, assetTable, assetTableName, "uk_asset_sha256", "UNIQUE KEY uk_asset_sha256 (sha256)");
  await addMysqlIndexIfMissing(pool, assetTable, assetTableName, "idx_asset_created", "KEY idx_asset_created (created_at)");
  await addMysqlIndexIfMissing(pool, assetTable, assetTableName, "idx_asset_deleted_at", "KEY idx_asset_deleted_at (deleted_at)");

  await addMysqlColumnIfMissing(pool, assetLinkTable, assetLinkTableName, "deleted_at", "`deleted_at` DATETIME(3) NULL AFTER `created_at`");
  await pool.query(`UPDATE ${assetLinkTable} SET document_id = '' WHERE document_id IS NULL`);
  await pool.query(`ALTER TABLE ${assetLinkTable} MODIFY COLUMN document_id VARCHAR(64) NOT NULL DEFAULT ''`);
  await addMysqlIndexIfMissing(
    pool,
    assetLinkTable,
    assetLinkTableName,
    "idx_asset_link_asset",
    "KEY idx_asset_link_asset (asset_id, deleted_at)"
  );
  await addMysqlIndexIfMissing(
    pool,
    assetLinkTable,
    assetLinkTableName,
    "idx_asset_link_document",
    "KEY idx_asset_link_document (document_id, relation_type, deleted_at)"
  );
  await addMysqlIndexIfMissing(
    pool,
    assetLinkTable,
    assetLinkTableName,
    "idx_asset_link_node",
    "KEY idx_asset_link_node (course_id, mind_map_id, node_id, relation_type, deleted_at)"
  );
  await addMysqlIndexIfMissing(
    pool,
    assetLinkTable,
    assetLinkTableName,
    "uk_asset_link_scope",
    "UNIQUE KEY uk_asset_link_scope (asset_id, course_id, mind_map_id, node_id, document_id, relation_type)"
  );
}

async function ensureKnowledgeAssetTables(pool: Pool, assetTable: string, assetLinkTable: string) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${assetTable} (
      id VARCHAR(64) NOT NULL,
      sha256 CHAR(64) NOT NULL,
      local_path VARCHAR(1024) NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      byte_size BIGINT NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_asset_sha256 (sha256),
      KEY idx_asset_created (created_at),
      KEY idx_asset_deleted_at (deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${assetLinkTable} (
      id VARCHAR(64) NOT NULL,
      asset_id VARCHAR(64) NOT NULL,
      course_id VARCHAR(64) NOT NULL,
      mind_map_id VARCHAR(64) NOT NULL,
      node_id VARCHAR(96) NOT NULL,
      document_id VARCHAR(64) NOT NULL DEFAULT '',
      relation_type VARCHAR(40) NOT NULL,
      created_at DATETIME(3) NOT NULL,
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_asset_link_scope (asset_id, course_id, mind_map_id, node_id, document_id, relation_type),
      KEY idx_asset_link_asset (asset_id, deleted_at),
      KEY idx_asset_link_document (document_id, relation_type, deleted_at),
      KEY idx_asset_link_node (course_id, mind_map_id, node_id, relation_type, deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await migrateKnowledgeAssetTables(pool, assetTable, assetLinkTable);
}

async function ensureChromePortStateTable(pool: Pool, chromePortStateTable: string) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${chromePortStateTable} (
      platform_id VARCHAR(40) NOT NULL,
      port INT NOT NULL,
      profile_dir VARCHAR(1024) NOT NULL,
      saved_at DATETIME(3) NOT NULL,
      authenticated_at DATETIME(3) NOT NULL,
      detected_url VARCHAR(2048) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      PRIMARY KEY (platform_id),
      KEY idx_chrome_port_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureErrorLogTable(pool: Pool, errorLogTable: string) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${errorLogTable} (
      id VARCHAR(64) NOT NULL,
      source VARCHAR(120) NOT NULL,
      user_message VARCHAR(255) NOT NULL,
      technical_message LONGTEXT NOT NULL,
      error_code VARCHAR(120) NOT NULL,
      context_json TEXT NOT NULL,
      created_at DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      KEY idx_error_created (created_at),
      KEY idx_error_source (source, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function recordAppError(input: {
  source: string;
  userMessage: string;
  error: unknown;
  context?: Record<string, unknown>;
}) {
  try {
    const runtime = await getMysqlRuntime();
    const classified = classifyAppError(input.source, input.error, input.userMessage);
    await runtime.pool.execute(
      `INSERT INTO ${runtime.errorLogTable} (id, source, user_message, technical_message, error_code, context_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.source.slice(0, 120),
        classified.userMessage.slice(0, 255),
        classified.technicalMessage,
        classified.code,
        JSON.stringify({ ...classified.context, ...input.context, domain: classified.domain, reason: classified.reason, action: classified.action, retryable: classified.retryable }),
        new Date()
      ]
    );
  } catch (logError) {
    console.warn("App error log write failed.", logError);
  }
}

async function listAppErrorLogs(limitValue: unknown): Promise<AppErrorLogEntry[]> {
  const limit = Math.min(Math.max(Number.isFinite(Number(limitValue)) ? Number(limitValue) : 50, 1), 100);
  const runtime = await getMysqlRuntime();
  const [rows] = await runtime.pool.execute<AppErrorLogRow[]>(
    `SELECT id, source, user_message AS userMessage, error_code AS errorCode, created_at AS createdAt
     FROM ${runtime.errorLogTable}
     ORDER BY created_at DESC
     LIMIT ${limit}`
  );
  return rows.map((row) => ({
    ...getAppErrorDefinition(row.errorCode),
    id: row.id,
    source: row.source,
    userMessage: row.userMessage,
    errorCode: row.errorCode,
    createdAt: toIsoTimestamp(row.createdAt)
  }));
}

async function createMysqlRuntime(): Promise<MysqlRuntime> {
  const config = await readMysqlConfig();
  if (app.isPackaged && !config.explicitlyConfigured) {
    throw new Error("MySQL is not configured. The public clean package will use the local empty data store until MySQL is configured.");
  }
  await tryStartManagedMysqlRuntime(config);
  try {
    await ensureDatabase(config);
  } catch (error) {
    console.warn("MySQL database check did not complete. Continuing with configured database.", error);
  }

  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 10,
    charset: "utf8mb4"
  });
  const courseTable = escapeMysqlIdentifier(config.courseTable, "MySQL course table");
  const courseSectionTable = escapeMysqlIdentifier(config.courseSectionTable, "MySQL course section table");
  const mindMapTable = escapeMysqlIdentifier(config.mindMapTable, "MySQL mind map table");
  const mindMapSnapshotTable = escapeMysqlIdentifier(config.mindMapSnapshotTable, "MySQL mind map snapshot table");
  const mindMapNodeTable = escapeMysqlIdentifier(config.mindMapNodeTable, "MySQL mind map node table");
  const knowledgeDocumentTable = escapeMysqlIdentifier(config.knowledgeDocumentTable, "MySQL knowledge document table");
  const knowledgeDocumentSnapshotTable = escapeMysqlIdentifier(
    config.knowledgeDocumentSnapshotTable,
    "MySQL knowledge document snapshot table"
  );
  const assetTable = escapeMysqlIdentifier(config.assetTable, "MySQL asset table");
  const knowledgeAssetLinkTable = escapeMysqlIdentifier(config.knowledgeAssetLinkTable, "MySQL knowledge asset link table");
  const chromePortStateTable = escapeMysqlIdentifier(config.chromePortStateTable, "MySQL Chrome port state table");
  const errorLogTable = escapeMysqlIdentifier(config.errorLogTable, "MySQL error log table");
  const examQuestionTable = escapeMysqlIdentifier(config.examQuestionTable, "MySQL exam question table");
  const examPaperTable = escapeMysqlIdentifier(config.examPaperTable, "MySQL exam paper table");
  const examPaperSectionTable = escapeMysqlIdentifier(config.examPaperSectionTable, "MySQL exam paper section table");
  const examPaperQuestionTable = escapeMysqlIdentifier(config.examPaperQuestionTable, "MySQL exam paper question table");
  const examAttemptTable = escapeMysqlIdentifier(config.examAttemptTable, "MySQL exam attempt table");
  const textbookAssetTable = escapeMysqlIdentifier(config.textbookAssetTable, "MySQL textbook asset table");
  const textbookNoteTable = escapeMysqlIdentifier(config.textbookNoteTable, "MySQL textbook note table");
  await ensureCourseTable(pool, courseTable);
  await migrateCourseTable(pool, courseTable);
  await ensureCourseSectionTable(pool, courseSectionTable);
  await migrateCourseSectionTable(pool, courseSectionTable);
  await ensureMindMapTables(pool, mindMapTable, mindMapSnapshotTable, mindMapNodeTable);
  await ensureKnowledgeDocumentTables(pool, knowledgeDocumentTable, knowledgeDocumentSnapshotTable);
  await ensureKnowledgeAssetTables(pool, assetTable, knowledgeAssetLinkTable);
  await ensureChromePortStateTable(pool, chromePortStateTable);
  await ensureErrorLogTable(pool, errorLogTable);
  await ensureExamTables(pool, examQuestionTable, examPaperTable, examPaperSectionTable, examPaperQuestionTable, examAttemptTable);
  await ensureTextbookTables(pool, textbookAssetTable, textbookNoteTable);

  mysqlRuntime = {
    pool,
    courseTable,
    courseSectionTable,
    mindMapTable,
    mindMapSnapshotTable,
    mindMapNodeTable,
    knowledgeDocumentTable,
    knowledgeDocumentSnapshotTable,
    assetTable,
    knowledgeAssetLinkTable,
    chromePortStateTable,
    errorLogTable,
    examQuestionTable,
    examPaperTable,
    examPaperSectionTable,
    examPaperQuestionTable,
    examAttemptTable,
    textbookAssetTable,
    textbookNoteTable
  };
  return mysqlRuntime;
}

function getMysqlRuntime() {
  if (!mysqlRuntimePromise) {
    mysqlRuntimePromise = createMysqlRuntime().catch((error) => {
      mysqlRuntimePromise = null;
      throw error;
    });
  }

  return mysqlRuntimePromise;
}

function warmMysqlRuntime() {
  void getMysqlRuntime().catch((error) => {
    console.warn("MySQL startup warm-up failed. The app will fall back when data is requested.", error);
  });
}

function toIsoTimestamp(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return new Date().toISOString();
}

function toMysqlDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function getCourseStoreFilePath() {
  return getAistudyDataPath("state", "courses.json");
}

function getPendingCourseOperationsFilePath() {
  return getAistudyDataPath("state", "course-pending-operations.json");
}

function getLegacyCourseStoreFilePath() {
  return path.join(app.getPath("userData"), "courses.json");
}

function getLegacyPendingCourseOperationsFilePath() {
  return path.join(app.getPath("userData"), "course-pending-operations.json");
}

async function readLocalCourseStore(): Promise<CourseStore> {
  const filePath = await pathExists(getCourseStoreFilePath()) ? getCourseStoreFilePath() : getLegacyCourseStoreFilePath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return normalizeCourseStore(parseJsonText(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { sections: [], courses: [], activeCourseId: null };
    }
    await quarantineUnreadableFile(filePath, error);
    return { sections: [], courses: [], activeCourseId: null };
  }
}

async function writeLocalCourseStore(store: CourseStore) {
  const normalized = normalizeCourseStore(store);
  await writeJsonAtomic(getCourseStoreFilePath(), normalized);
  return normalized;
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  const dirPath = path.dirname(filePath);
  await fs.mkdir(dirPath, { recursive: true });
  const tempPath = path.join(dirPath, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  const content = JSON.stringify(value, null, 2);
  try {
    await fs.writeFile(tempPath, content, "utf8");
    await fs.rm(filePath, { force: true });
    await fs.rename(tempPath, filePath);
  } catch (error) {
    try {
      await fs.copyFile(tempPath, filePath);
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
    console.warn("Atomic JSON replace fell back to direct overwrite.", error);
  }
}

async function quarantineUnreadableFile(filePath: string, reason: unknown) {
  try {
    await fs.access(filePath);
  } catch {
    return;
  }

  const quarantinePath = path.join(
    path.dirname(filePath),
    `${path.basename(filePath)}.corrupt-${Date.now()}.json`
  );
  try {
    await fs.rename(filePath, quarantinePath);
    console.warn(`Unreadable file was quarantined: ${quarantinePath}`, reason);
  } catch (error) {
    console.warn(`Unreadable file could not be quarantined: ${filePath}`, error);
  }
}

function normalizePendingCourseOperations(value: unknown): PendingCourseOperation[] {
  if (!Array.isArray(value)) {
    throw new Error("Pending course operations must be an array.");
  }

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => {
      const action = item.action;
      if (typeof action !== "string" || !PENDING_COURSE_OPERATION_ACTIONS.has(action as PendingCourseOperation["action"])) {
        throw new Error("Pending course operation action is invalid.");
      }

      const payload = item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
        ? item.payload as Record<string, unknown>
        : {};

      return {
        id: normalizeId(item.id, "Pending course operation id", randomUUID()),
        action: action as PendingCourseOperation["action"],
        payload,
        createdAt: toIsoTimestamp(typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString()),
        retryCount: Number.isFinite(Number(item.retryCount)) ? Number(item.retryCount) : 0,
        lastError: typeof item.lastError === "string" ? item.lastError.slice(0, 500) : undefined
      };
    });
}

async function readPendingCourseOperations() {
  const filePath = await pathExists(getPendingCourseOperationsFilePath()) ? getPendingCourseOperationsFilePath() : getLegacyPendingCourseOperationsFilePath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return normalizePendingCourseOperations(parseJsonText(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    await quarantineUnreadableFile(filePath, error);
    return [];
  }
}

async function writePendingCourseOperations(operations: PendingCourseOperation[]) {
  await writeJsonAtomic(getPendingCourseOperationsFilePath(), operations);
}

async function appendPendingCourseOperation(action: PendingCourseOperation["action"], payload: Record<string, unknown>) {
  const operations = await readPendingCourseOperations();
  operations.push({
    id: randomUUID(),
    action,
    payload,
    createdAt: new Date().toISOString(),
    retryCount: 0
  });
  await writePendingCourseOperations(operations);
}

async function canUseCourseMysqlRuntime() {
  try {
    const runtime = await getMysqlRuntime();
    await runtime.pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

async function getCourseSyncStatus(): Promise<CourseSyncStatus> {
  const operations = await readPendingCourseOperations();
  const hasReplayFailure = operations.some((operation) => operation.retryCount > 0 || Boolean(operation.lastError));
  const mysqlReady = await canUseCourseMysqlRuntime();
  return {
    state: mysqlReady && operations.length === 0 ? "saved" : hasReplayFailure || !mysqlReady ? "attention" : "waiting",
    pendingCount: mysqlReady ? operations.length : Math.max(operations.length, 1)
  };
}

function readPendingPayloadString(operation: PendingCourseOperation, key: string) {
  const value = operation.payload[key];
  if (typeof value !== "string") {
    throw new Error(`Pending course operation ${operation.action} is missing ${key}.`);
  }
  return value;
}

function readPendingPayloadOptionalString(operation: PendingCourseOperation, key: string) {
  const value = operation.payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function readPendingPayloadNumber(operation: PendingCourseOperation, key: string) {
  const value = Number(operation.payload[key]);
  if (!Number.isFinite(value)) {
    throw new Error(`Pending course operation ${operation.action} has invalid ${key}.`);
  }
  return value;
}

function readPendingPayloadBoolean(operation: PendingCourseOperation, key: string) {
  const value = operation.payload[key];
  if (typeof value !== "boolean") {
    throw new Error(`Pending course operation ${operation.action} has invalid ${key}.`);
  }
  return value;
}

function readPendingPayloadRecord(operation: PendingCourseOperation, key: string) {
  const value = operation.payload[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Pending course operation ${operation.action} is missing ${key}.`);
  }
  return value as Record<string, unknown>;
}

function readPendingPayloadRecordArray(operation: PendingCourseOperation, key: string) {
  const value = operation.payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function numberFromRecord(record: Record<string, unknown>, key: string, fallback = 0) {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : fallback;
}

function stringFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Pending course payload is missing ${key}.`);
  }
  return value;
}

function nullableStringFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function createDiagnosticItem(
  id: string,
  name: string,
  status: RuntimeDiagnosticStatus,
  message: string,
  action: string,
  retryable = true
): RuntimeDiagnosticItem {
  return { id, name, status, message, action, retryable };
}

function formatRuntimeDiagnosticStatus(status: RuntimeDiagnosticStatus) {
  if (status === "ok") return "正常";
  if (status === "warning") return "需关注";
  if (status === "error") return "不可用";
  return "未启用";
}

async function checkRuntimeDataRoot(): Promise<RuntimeDiagnosticItem> {
  try {
    const requiredDirectories = [
      getAistudyDataPath("config"),
      getAistudyDataPath("state"),
      getAistudyDataPath("runtime"),
      getAistudyDataPath("runtime", "chrome-profiles"),
      getAistudyDataPath("assets"),
      getAistudyDataPath("updates"),
      getAistudyDataPath("backups"),
      getAistudyDataPath("logs")
    ];
    for (const dirPath of requiredDirectories) {
      await fs.mkdir(dirPath, { recursive: true });
    }
    const probePath = getAistudyDataPath("state", `.write-test-${process.pid}-${randomUUID()}.tmp`);
    await fs.writeFile(probePath, "ok", "utf8");
    await fs.rm(probePath, { force: true });
    return createDiagnosticItem("data-root", "核心数据目录", "ok", "数据目录可以正常读写。", "无需处理。", false);
  } catch {
    return createDiagnosticItem("data-root", "核心数据目录", "error", "数据目录暂时不可写，保存和迁移可能受影响。", "请检查磁盘权限，或用 AISTUDY_PUBLIC_DATA_ROOT 指定可写目录。");
  }
}

async function checkLocalRecoveryFiles(): Promise<RuntimeDiagnosticItem> {
  try {
    await readLocalCourseStore();
    await readPendingCourseOperations();
    return createDiagnosticItem("local-recovery", "本机恢复文件", "ok", "本机镜像和待同步记录可读取。", "无需处理。", false);
  } catch {
    return createDiagnosticItem("local-recovery", "本机恢复文件", "warning", "本机恢复文件需要重新整理。", "系统会优先隔离损坏文件，后续可重新同步。");
  }
}

async function checkMysqlRuntime(): Promise<RuntimeDiagnosticItem> {
  try {
    const runtime = await getMysqlRuntime();
    await runtime.pool.query("SELECT 1");
    return createDiagnosticItem("mysql", "MySQL 数据库", "ok", "数据库连接和基础表可用。", "无需处理。", false);
  } catch {
    return createDiagnosticItem("mysql", "MySQL 数据库", "warning", "数据库暂时连接不上，知识库会先保存在本机。", "请检查 MySQL 是否启动，以及账号、密码和权限是否正确。");
  }
}

async function checkErrorLogRuntime(): Promise<RuntimeDiagnosticItem> {
  try {
    const runtime = await getMysqlRuntime();
    await runtime.pool.query(`SELECT id FROM ${runtime.errorLogTable} LIMIT 1`);
    return createDiagnosticItem("error-log", "报错日志", "ok", "报错日志可以写入和读取。", "无需处理。", false);
  } catch {
    return createDiagnosticItem("error-log", "报错日志", "warning", "报错日志暂时不可用。", "数据库恢复后，错误记录会重新可用。");
  }
}

async function checkChromeRuntime(): Promise<RuntimeDiagnosticItem> {
  const chromePath = await findChromeExecutable();
  if (!chromePath) {
    return createDiagnosticItem("chrome", "Chrome 浏览器", "warning", "没有找到 Chrome，AI 网页助手暂时不能启动。", "请安装 Chrome，或用 AISTUDY_CHROME_PATH 指定浏览器位置。");
  }
  return createDiagnosticItem("chrome", "Chrome 浏览器", "ok", "已找到可启动的 Chrome。", "无需处理。", false);
}

async function checkChromePortRuntime(platform: ChromePortDefinition): Promise<RuntimeDiagnosticItem> {
  try {
    const status = await getChromePortStatus(platform);
    if (status.authenticated) {
      return createDiagnosticItem(`chrome-port-${platform.id}`, `${platform.name} 端口`, "ok", `${platform.name} 已识别登录状态。`, "无需处理。", false);
    }
    if (status.connected) {
      return createDiagnosticItem(`chrome-port-${platform.id}`, `${platform.name} 端口`, "warning", `${platform.name} 已打开，但还没有确认登录状态。`, "请在端口管理完成登录后重新检查。");
    }
    return createDiagnosticItem(`chrome-port-${platform.id}`, `${platform.name} 端口`, "warning", `${platform.name} 固定端口暂未启动。`, "需要使用 AI 时，请到端口管理打开登录窗口。");
  } catch {
    return createDiagnosticItem(`chrome-port-${platform.id}`, `${platform.name} 端口`, "warning", `${platform.name} 端口状态暂时无法读取。`, "请稍后重新检查，或在端口管理手动打开。");
  }
}

async function checkInformationCollectionRuntime(): Promise<RuntimeDiagnosticItem> {
  try {
    const runtimeRoot = getInformationCollectionRuntimeRoot();
    await fs.mkdir(runtimeRoot, { recursive: true });
    const probePath = path.join(runtimeRoot, `.write-test-${process.pid}-${randomUUID()}.tmp`);
    await fs.writeFile(probePath, "ok", "utf8");
    await fs.rm(probePath, { force: true });
    return createDiagnosticItem("information-collection-runtime", "信息采集目录", "ok", "采集运行目录可以正常读写。", "无需处理。", false);
  } catch {
    return createDiagnosticItem("information-collection-runtime", "信息采集目录", "error", "采集运行目录不可写。", "请检查数据目录权限或磁盘空间。");
  }
}

async function checkInformationToolRuntime(toolId: InformationToolStatus["id"]): Promise<RuntimeDiagnosticItem> {
  const tools = await readInformationToolStatus();
  const tool = tools.find((item) => item.id === toolId);
  const name = tool?.name ?? toolId;
  if (tool?.available) {
    return createDiagnosticItem(`information-tool-${toolId}`, name, "ok", `${name} 已就绪。`, "无需处理。", false);
  }
  const action = toolId === "yt-dlp"
    ? "请安装 yt-dlp，或把 yt-dlp 所在目录加入 PATH。"
    : toolId === "ffmpeg"
      ? "请安装 ffmpeg，或把 ffmpeg 所在目录加入 PATH。"
      : "请安装 Whisper 或后续配置可用的本地转写程序。";
  return createDiagnosticItem(`information-tool-${toolId}`, name, "warning", `${name} 未就绪，视频转录链路会停在对应步骤。`, action);
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await net.fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "AIstudy-Diagnostics"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function checkUpdateRuntime(): Promise<RuntimeDiagnosticItem> {
  try {
    const repositoryUrl = await getConfiguredRepositoryUrl();
    const repository = parseGitHubRepository(repositoryUrl);
    if (!repository) {
      return createDiagnosticItem("updates", "更新服务", "disabled", "还没有配置可用的线上发布仓库。", "不影响本机使用；需要自动更新时再配置发布仓库。", false);
    }
    const response = await fetchJsonWithTimeout(`https://api.github.com/repos/${repository.owner}/${repository.repo}/releases/latest`, 5000);
    if (response.ok) {
      return createDiagnosticItem("updates", "更新服务", "ok", "可以访问线上更新源。", "无需处理。", false);
    }
    if (response.status === 404) {
      return createDiagnosticItem("updates", "更新服务", "warning", "线上仓库还没有可用发布版本。", "发布安装包后再重新检查。");
    }
    return createDiagnosticItem("updates", "更新服务", "warning", "当前网络暂时无法完成更新检测。", "稍后重试，或在网络可用时再检测更新。");
  } catch {
    return createDiagnosticItem("updates", "更新服务", "warning", "当前网络暂时无法访问更新源。", "这不影响本机使用；需要更新时再检查网络。");
  }
}

function summarizeRuntimeDiagnostics(items: RuntimeDiagnosticItem[]): RuntimeDiagnosticResult["summary"] {
  return items.reduce<RuntimeDiagnosticResult["summary"]>(
    (summary, item) => {
      summary[item.status] += 1;
      return summary;
    },
    { ok: 0, warning: 0, error: 0, disabled: 0 }
  );
}

async function diagnoseRuntime(): Promise<RuntimeDiagnosticResult> {
  const dataRootItem = await checkRuntimeDataRoot();
  const items = [
    dataRootItem,
    await checkLocalRecoveryFiles(),
    await checkMysqlRuntime(),
    await checkErrorLogRuntime(),
    await checkChromeRuntime(),
    ...(await Promise.all(chromePortDefinitions.map((platform) => checkChromePortRuntime(platform)))),
    await checkInformationCollectionRuntime(),
    ...(await Promise.all((["yt-dlp", "ffmpeg", "whisper"] as const).map((toolId) => checkInformationToolRuntime(toolId)))),
    await checkUpdateRuntime()
  ];
  return {
    checkedAt: new Date().toISOString(),
    summary: summarizeRuntimeDiagnostics(items),
    items
  };
}

function buildRuntimeDiagnosticReport(diagnostic: RuntimeDiagnosticResult) {
  const summary = diagnostic.summary;
  const lines = [
    "AIstudy 诊断报告",
    "",
    `生成时间：${new Date(diagnostic.checkedAt).toLocaleString("zh-CN")}`,
    `应用版本：${app.getVersion()}`,
    `数据目录：${getAistudyDataRoot()}`,
    `用户目录：${app.getPath("userData")}`,
    "",
    `汇总：${summary.ok} 正常，${summary.warning} 需关注，${summary.error} 不可用，${summary.disabled} 未启用`,
    "",
    "检查项：",
    ...diagnostic.items.map((item) => {
      const retryText = item.retryable ? "可重试" : "无需重试";
      return `- [${formatRuntimeDiagnosticStatus(item.status)}] ${item.name}：${item.message} 处理建议：${item.action} (${retryText})`;
    }),
    "",
    "说明：这份报告用于协助定位本机运行环境、数据目录、数据库、浏览器端口和更新服务状态。"
  ];
  return lines.join("\n");
}

async function copyRuntimeDiagnosticReport(): Promise<RuntimeDiagnosticReportCopyResult> {
  const diagnostic = await diagnoseRuntime();
  clipboard.writeText(buildRuntimeDiagnosticReport(diagnostic));
  return {
    copied: true,
    diagnostic
  };
}

async function openAistudyDataRoot() {
  await fs.mkdir(getAistudyDataRoot(), { recursive: true });
  const result = await shell.openPath(getAistudyDataRoot());
  if (result) throw new Error(result);
  return true;
}

async function findProjectRoot() {
  const candidates = [
    process.cwd(),
    path.resolve(__dirname, ".."),
    app.isPackaged ? path.resolve(process.resourcesPath, "app.asar") : app.getAppPath()
  ];

  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate, ".git"))) {
      return candidate;
    }
  }

  return path.resolve(__dirname, "..");
}

async function runGit(args: string[], cwd: string) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function readPackageRepositoryUrl() {
  const packageJson = await readPackageMetadata();
  if (typeof packageJson.repository === "string") {
    return packageJson.repository;
  }
  return packageJson.repository?.url ?? "";
}

async function readPackageMetadata() {
  try {
    const packageJson = parseJsonText(await fs.readFile(path.join(app.getAppPath(), "package.json"), "utf8")) as {
      repository?: string | { url?: string };
      aistudy?: {
        updateRepository?: string;
        updateAssetPattern?: string;
        updateDownloadMirrors?: unknown;
      };
    };
    return packageJson;
  } catch {
    return {};
  }
}

async function getConfiguredRepositoryUrl(projectRoot?: string) {
  const packageRepositoryUrl = await readPackageRepositoryUrl();
  if (packageRepositoryUrl) return packageRepositoryUrl;
  const root = projectRoot ?? await findProjectRoot();
  return await runGit(["remote", "get-url", "origin"], root);
}

async function getConfiguredUpdateRepositoryUrl(projectRoot?: string) {
  const packageJson = await readPackageMetadata();
  const configured = process.env.AISTUDY_UPDATE_REPOSITORY_URL?.trim()
    || packageJson.aistudy?.updateRepository?.trim();
  if (configured) return configured;
  return await getConfiguredRepositoryUrl(projectRoot);
}

async function getConfiguredUpdateAssetPattern() {
  const packageJson = await readPackageMetadata();
  return process.env.AISTUDY_UPDATE_ASSET_PATTERN?.trim()
    || packageJson.aistudy?.updateAssetPattern?.trim()
    || "";
}

async function getConfiguredUpdateDownloadMirrors() {
  const packageJson = await readPackageMetadata();
  const envMirrors = process.env.AISTUDY_UPDATE_DOWNLOAD_MIRRORS?.split(/[;,]/)
    .map((mirror) => mirror.trim())
    .filter(Boolean) ?? [];
  const packageMirrors = Array.isArray(packageJson.aistudy?.updateDownloadMirrors)
    ? packageJson.aistudy.updateDownloadMirrors
      .filter((mirror): mirror is string => typeof mirror === "string")
      .map((mirror) => mirror.trim())
      .filter(Boolean)
    : [];
  return [...envMirrors, ...packageMirrors];
}

function toRepositoryWebUrl(remoteUrl: string) {
  if (!remoteUrl) return "";
  if (remoteUrl.startsWith("git@github.com:")) {
    return `https://github.com/${remoteUrl.slice("git@github.com:".length).replace(/\.git$/, "")}`;
  }
  return remoteUrl.replace(/\.git$/, "");
}

function parseGitHubRepository(remoteUrl: string) {
  const webUrl = toRepositoryWebUrl(remoteUrl);
  const match = webUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2]
  };
}

function wildcardPatternToRegExp(pattern: string) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function normalizeVersion(value: string) {
  return value.trim().replace(/^v/i, "");
}

function compareVersions(a: string, b: string) {
  const left = normalizeVersion(a).split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const right = normalizeVersion(b).split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = Number.isFinite(left[index]) ? left[index] : 0;
    const rightPart = Number.isFinite(right[index]) ? right[index] : 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  return 0;
}

function parseReleaseNotes(body: unknown, releaseName: string) {
  const lines = typeof body === "string" ? body.split(/\r?\n/) : [];
  const notes = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, ""))
    .filter(Boolean)
    .slice(0, 20);

  if (notes.length > 0) {
    return notes;
  }

  return releaseName ? [`发布版本 ${releaseName}`] : ["发布新版本。"];
}

async function selectInstallerAsset(release: GitHubRelease) {
  const assets = Array.isArray(release.assets) ? (release.assets as GitHubReleaseAsset[]) : [];
  const assetPattern = await getConfiguredUpdateAssetPattern();
  if (assetPattern) {
    const assetMatcher = wildcardPatternToRegExp(assetPattern);
    return assets.find((asset) => typeof asset.name === "string" && assetMatcher.test(asset.name)) ?? null;
  }

  return (
    assets.find((asset) => typeof asset.name === "string" && /setup.*\.exe$/i.test(asset.name)) ??
    assets.find((asset) => typeof asset.name === "string" && /\.exe$/i.test(asset.name)) ??
    null
  );
}

function buildMirrorAssetUrl(mirrorBase: string, releaseTag: string, assetName: string) {
  try {
    const base = new URL(mirrorBase.endsWith("/") ? mirrorBase : `${mirrorBase}/`);
    return new URL(`releases/${encodeURIComponent(releaseTag)}/${encodeURIComponent(assetName)}`, base).toString();
  } catch {
    return "";
  }
}

async function probeUpdateDownloadUrl(url: string, expectedSize: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await net.fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: {
        "User-Agent": "AIstudy-Updater"
      }
    });
    if (!response.ok) return false;
    if (expectedSize <= 0) return true;
    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    return !Number.isFinite(contentLength) || contentLength === expectedSize;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveUpdateDownloadUrl(releaseTag: string, asset: GitHubReleaseAsset | null) {
  const githubUrl = typeof asset?.browser_download_url === "string" ? asset.browser_download_url : "";
  const assetName = typeof asset?.name === "string" ? asset.name : "";
  const assetSize = typeof asset?.size === "number" ? asset.size : 0;
  if (!assetName) return githubUrl;

  const mirrors = await getConfiguredUpdateDownloadMirrors();
  for (const mirror of mirrors) {
    const mirrorUrl = buildMirrorAssetUrl(mirror, releaseTag, assetName);
    if (mirrorUrl && await probeUpdateDownloadUrl(mirrorUrl, assetSize)) {
      return mirrorUrl;
    }
  }

  return githubUrl;
}

async function isConfiguredUpdateMirrorUrl(downloadUrlValue: string) {
  let downloadUrl: URL;
  try {
    downloadUrl = new URL(downloadUrlValue);
  } catch {
    return false;
  }

  const mirrors = await getConfiguredUpdateDownloadMirrors();
  return mirrors.some((mirror) => {
    try {
      const mirrorUrl = new URL(mirror.endsWith("/") ? mirror : `${mirror}/`);
      return downloadUrl.protocol === mirrorUrl.protocol
        && downloadUrl.hostname === mirrorUrl.hostname
        && downloadUrl.port === mirrorUrl.port
        && downloadUrl.pathname.startsWith("/releases/");
    } catch {
      return false;
    }
  });
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const repositoryUrl = await getConfiguredUpdateRepositoryUrl();
  const repository = parseGitHubRepository(repositoryUrl);
  if (!repository) {
    throw new Error("未配置有效的 GitHub 仓库地址。");
  }

  const response = await net.fetch(`https://api.github.com/repos/${repository.owner}/${repository.repo}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "AIstudy-Updater"
    }
  });

  if (response.status === 404) {
    throw new Error("GitHub 仓库还没有可用的 Release。");
  }

  if (!response.ok) {
    throw new Error(`GitHub 更新检测失败：${response.status}`);
  }

  return await response.json() as GitHubRelease;
}

async function checkForUpdates(): Promise<UpdateCheckResult> {
  const release = await fetchLatestRelease();
  const releaseTag = typeof release.tag_name === "string" ? release.tag_name : "";
  const latestVersion = normalizeVersion(releaseTag);
  if (!latestVersion) {
    throw new Error("最新版本号读取失败。");
  }

  const asset = await selectInstallerAsset(release);
  const currentVersion = app.getVersion();
  const releaseName = typeof release.name === "string" ? release.name : `v${latestVersion}`;
  const downloadUrl = await resolveUpdateDownloadUrl(releaseTag, asset);

  return {
    currentVersion,
    latestVersion,
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
    releaseName,
    publishedAt: typeof release.published_at === "string" ? release.published_at : "",
    releaseUrl: typeof release.html_url === "string" ? release.html_url : "",
    notes: parseReleaseNotes(release.body, releaseName),
    assetName: typeof asset?.name === "string" ? asset.name : "",
    assetSize: typeof asset?.size === "number" ? asset.size : 0,
    downloadUrl
  };
}

function sendUpdateDownloadProgress(event: IpcMainInvokeEvent, progress: UpdateDownloadProgress) {
  if (!event.sender.isDestroyed()) {
    event.sender.send("updates:download-progress", progress);
  }
}

let activeUpdateDownloadTask: UpdateDownloadTask | null = null;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createUpdateDownloadProgress(task: UpdateDownloadTask): UpdateDownloadProgress {
  return {
    fileName: task.fileName,
    downloadedBytes: task.downloadedBytes,
    totalBytes: task.totalBytes,
    percent: task.totalBytes > 0 ? Math.min(100, Math.round((task.downloadedBytes / task.totalBytes) * 100)) : 0,
    status: task.status
  };
}

function ensureDownloadTaskActive(task: UpdateDownloadTask) {
  if (task.status === "cancelled") {
    throw new Error("下载已取消。");
  }
  if (activeUpdateDownloadTask !== task) {
    throw new Error("已有新的下载任务，请重新开始。");
  }
}

function isDownloadTaskPaused(task: UpdateDownloadTask) {
  return task.status === "paused";
}

async function waitForDownloadTask(event: IpcMainInvokeEvent, task: UpdateDownloadTask) {
  while (task.status === "paused") {
    sendUpdateDownloadProgress(event, createUpdateDownloadProgress(task));
    await wait(250);
    ensureDownloadTaskActive(task);
  }
  ensureDownloadTaskActive(task);
}

function getContentRangeTotal(contentRange: string | null) {
  const match = contentRange?.match(/\/(\d+)\s*$/);
  return match ? Number(match[1]) : 0;
}

async function fetchUpdateDownloadRange(
  event: IpcMainInvokeEvent,
  task: UpdateDownloadTask,
  downloadUrlValue: string,
  startByte: number,
  endByte?: number
) {
  const rangeValue = typeof endByte === "number" ? `bytes=${startByte}-${endByte}` : `bytes=${startByte}-`;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= UPDATE_DOWNLOAD_RETRY_LIMIT; attempt += 1) {
    await waitForDownloadTask(event, task);
    const controller = new AbortController();
    task.controller = controller;
    const timeout = setTimeout(() => controller.abort(), UPDATE_DOWNLOAD_NET_TIMEOUT_MS);
    try {
      const response = await net.fetch(downloadUrlValue, {
        signal: controller.signal,
        headers: {
          "User-Agent": "AIstudy-Updater",
          Range: rangeValue
        }
      });

      if (response.status === 206 || (startByte === 0 && response.ok)) {
        return response;
      }

      lastError = new Error(`下载安装包失败：${response.status}`);
    } catch (error) {
      if (task.status === "paused") {
        attempt -= 1;
        continue;
      }
      ensureDownloadTaskActive(task);
      lastError = error;
    } finally {
      clearTimeout(timeout);
      if (task.controller === controller) {
        task.controller = null;
      }
    }

    await wait(600 * attempt);
  }

  throw lastError instanceof Error ? lastError : new Error("下载安装包失败。");
}

async function downloadUpdate(event: IpcMainInvokeEvent, downloadUrlValue: unknown, expectedSizeValue: unknown): Promise<UpdateDownloadResult> {
  if (typeof downloadUrlValue !== "string") {
    throw new Error("下载地址不可用。");
  }
  let parsedDownloadUrl: URL;
  try {
    parsedDownloadUrl = new URL(downloadUrlValue);
  } catch {
    throw new Error("下载地址不可用。");
  }
  const downloadProtocol = parsedDownloadUrl.protocol;
  if (downloadProtocol !== "https:" && !(downloadProtocol === "http:" && await isConfiguredUpdateMirrorUrl(downloadUrlValue))) {
    throw new Error("下载地址不可用。");
  }
  if (activeUpdateDownloadTask && activeUpdateDownloadTask.status !== "complete" && activeUpdateDownloadTask.status !== "cancelled") {
    throw new Error("已有更新正在下载。");
  }

  const url = parsedDownloadUrl;
  const fileName = decodeURIComponent(path.basename(url.pathname)) || `AIstudy-Setup-${app.getVersion()}.exe`;
  const updateDir = getAistudyDataPath("updates");
  const filePath = path.join(updateDir, fileName);
  const tempFilePath = path.join(updateDir, `${fileName}.${randomUUID()}.download`);
  const expectedTotalBytes = typeof expectedSizeValue === "number" && Number.isFinite(expectedSizeValue) ? Math.max(0, expectedSizeValue) : 0;
  const task: UpdateDownloadTask = {
    id: randomUUID(),
    fileName,
    tempFilePath,
    downloadedBytes: 0,
    totalBytes: expectedTotalBytes,
    status: "starting",
    controller: null
  };
  activeUpdateDownloadTask = task;
  await fs.mkdir(updateDir, { recursive: true });

  sendUpdateDownloadProgress(event, createUpdateDownloadProgress(task));

  let downloadedBytes = 0;
  let totalBytes = expectedTotalBytes;
  let lastProgressAt = 0;
  const fileHandle = await fs.open(tempFilePath, "w");
  try {
    task.status = "downloading";
    while (totalBytes === 0 || downloadedBytes < totalBytes) {
      await waitForDownloadTask(event, task);
      const rangeEnd = totalBytes > 0
        ? Math.min(downloadedBytes + UPDATE_DOWNLOAD_CHUNK_SIZE_BYTES - 1, totalBytes - 1)
        : downloadedBytes + UPDATE_DOWNLOAD_CHUNK_SIZE_BYTES - 1;
      const response = await fetchUpdateDownloadRange(event, task, downloadUrlValue, downloadedBytes, rangeEnd);
      const contentRangeTotal = getContentRangeTotal(response.headers.get("content-range"));
      if (contentRangeTotal > 0) {
        totalBytes = contentRangeTotal;
        task.totalBytes = totalBytes;
      } else if (response.status === 206) {
        throw new Error("下载安装包失败：下载源没有返回完整文件大小。");
      } else if (totalBytes === 0) {
        totalBytes = Number(response.headers.get("content-length")) || 0;
        task.totalBytes = totalBytes;
      }

      const bodyReader = response.body?.getReader();
      if (!bodyReader) {
        throw new Error("下载安装包失败：没有收到文件内容。");
      }

      while (true) {
        await waitForDownloadTask(event, task);
        let readResult: ReadableStreamReadResult<Uint8Array>;
        try {
          readResult = await bodyReader.read();
        } catch (error) {
          if (isDownloadTaskPaused(task)) {
            break;
          }
          ensureDownloadTaskActive(task);
          throw error;
        }
        const { done, value } = readResult;
        if (done) break;
        if (!value) continue;

        const chunk = Buffer.from(value);
        await fileHandle.write(chunk);
        downloadedBytes += chunk.byteLength;
        task.downloadedBytes = downloadedBytes;

        const now = Date.now();
        if (now - lastProgressAt > 160 || (totalBytes > 0 && downloadedBytes >= totalBytes)) {
          lastProgressAt = now;
          sendUpdateDownloadProgress(event, createUpdateDownloadProgress(task));
        }
      }

      if (totalBytes === 0) {
        totalBytes = downloadedBytes;
        task.totalBytes = totalBytes;
      }
    }
  } catch (error) {
    if (task.status === "cancelled") {
      sendUpdateDownloadProgress(event, createUpdateDownloadProgress(task));
    }
    await fs.rm(tempFilePath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await fileHandle.close();
    if (activeUpdateDownloadTask === task && task.status !== "paused") {
      activeUpdateDownloadTask = null;
    }
  }

  await fs.rm(filePath, { force: true }).catch(() => undefined);
  await fs.rename(tempFilePath, filePath);
  const downloadedFile = await fs.stat(filePath);
  task.downloadedBytes = downloadedFile.size;
  task.totalBytes = totalBytes || downloadedFile.size;
  task.status = "complete";
  sendUpdateDownloadProgress(event, createUpdateDownloadProgress(task));
  if (activeUpdateDownloadTask === task) {
    activeUpdateDownloadTask = null;
  }

  return {
    filePath,
    fileName,
    fileSize: downloadedFile.size
  };
}

async function pauseUpdateDownload() {
  const task = activeUpdateDownloadTask;
  if (!task || task.status !== "downloading") return false;
  task.status = "paused";
  task.controller?.abort();
  return true;
}

async function resumeUpdateDownload() {
  const task = activeUpdateDownloadTask;
  if (!task || task.status !== "paused") return false;
  task.status = "downloading";
  return true;
}

async function cancelUpdateDownload() {
  const task = activeUpdateDownloadTask;
  if (!task || task.status === "complete" || task.status === "cancelled") return false;
  task.status = "cancelled";
  task.controller?.abort();
  await fs.rm(task.tempFilePath, { force: true }).catch(() => undefined);
  activeUpdateDownloadTask = null;
  return true;
}

function isExpectedUpdateDownloadCancel(source: string, error: unknown) {
  return source === "updates:download" && error instanceof Error && error.message === "下载已取消。";
}

async function installUpdate(filePathValue: unknown) {
  if (typeof filePathValue !== "string" || !filePathValue.toLowerCase().endsWith(".exe")) {
    throw new Error("安装包路径不可用。");
  }

  if (!await pathExists(filePathValue)) {
    throw new Error("安装包不存在，请重新下载。");
  }

  const result = await shell.openPath(filePathValue);
  if (result) {
    throw new Error(result);
  }

  setTimeout(() => app.quit(), 500);
  return true;
}

async function getUpdateManagerInfo(): Promise<UpdateManagerInfo> {
  const projectRoot = await findProjectRoot();
  const repositoryUrl = await getConfiguredUpdateRepositoryUrl(projectRoot);
  const branch = await runGit(["branch", "--show-current"], projectRoot);
  const commit = await runGit(["rev-parse", "--short", "HEAD"], projectRoot);
  const status = await runGit(["status", "--porcelain"], projectRoot);
  const releaseDir = path.join(projectRoot, "release");
  const installerPath = path.join(releaseDir, `AIstudy-Setup-${app.getVersion()}.exe`);

  return {
    appVersion: app.getVersion(),
    repositoryUrl,
    repositoryWebUrl: toRepositoryWebUrl(repositoryUrl),
    branch,
    commit,
    dirty: Boolean(status),
    canUseGit: Boolean(repositoryUrl),
    updateIndexPath: path.join(projectRoot, "docs", "updates", "INDEX.md"),
    releaseDir,
    installerPath
  };
}

async function readCourseStore(): Promise<CourseStore> {
  try {
    const runtime = await getMysqlRuntime();
    await replayPendingCourseOperations(runtime);
    const { pool, courseTable, courseSectionTable } = runtime;
    const [sectionRows] = await pool.execute<CourseSectionRow[]>(
      `SELECT id, name, sort_order AS sortOrder, collapsed, created_at AS createdAt, updated_at AS updatedAt
       FROM ${courseSectionTable}
       WHERE deleted_at IS NULL
       ORDER BY sort_order ASC, updated_at DESC`
    );
    const [rows] = await pool.execute<CourseRow[]>(
      `SELECT id, name, description, section_id AS sectionId, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
       FROM ${courseTable}
       WHERE deleted_at IS NULL
       ORDER BY COALESCE(section_id, ''), sort_order ASC, updated_at DESC`
    );
    const sections = sectionRows.map((row) => ({
      id: row.id,
      name: row.name,
      sortOrder: Number(row.sortOrder) || 0,
      collapsed: Boolean(Number(row.collapsed)),
      createdAt: toIsoTimestamp(row.createdAt),
      updatedAt: toIsoTimestamp(row.updatedAt)
    }));
    const sectionIds = new Set(sections.map((section) => section.id));
    const courses = rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      sectionId: row.sectionId && sectionIds.has(row.sectionId) ? row.sectionId : null,
      sortOrder: Number(row.sortOrder) || 0,
      createdAt: toIsoTimestamp(row.createdAt),
      updatedAt: toIsoTimestamp(row.updatedAt)
    }));
    let mirroredActiveCourseId: string | null = null;
    try {
      const localMirror = await readLocalCourseStore();
      if (localMirror.activeCourseId && courses.some((course) => course.id === localMirror.activeCourseId)) {
        mirroredActiveCourseId = localMirror.activeCourseId;
      }
    } catch (error) {
      console.warn("Course local mirror read failed.", error);
    }
    const store = { sections, courses, activeCourseId: mirroredActiveCourseId ?? courses[0]?.id ?? null };
    if (courses.length > 0) {
      void writeLocalCourseStore(store).catch((error) => {
        console.warn("Course local mirror write failed.", error);
      });
    }

    return store;
  } catch (error) {
    console.warn("Course MySQL read failed. Falling back to local course store.", error);
    return await readLocalCourseStore();
  }
}

async function replaceCourseSectionRows(connection: PoolConnection, sectionTable: string, sections: CourseSectionRecord[]) {
  if (sections.length === 0) {
    await connection.execute(`UPDATE ${sectionTable} SET deleted_at = COALESCE(deleted_at, ?) WHERE deleted_at IS NULL`, [new Date()]);
    return;
  }

  const ids = sections.map((section) => section.id);
  await connection.execute(
    `UPDATE ${sectionTable} SET deleted_at = COALESCE(deleted_at, ?) WHERE deleted_at IS NULL AND id NOT IN (${ids.map(() => "?").join(", ")})`,
    [new Date(), ...ids]
  );

  const sql = `
    INSERT INTO ${sectionTable} (id, name, sort_order, collapsed, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      sort_order = VALUES(sort_order),
      collapsed = VALUES(collapsed),
      created_at = VALUES(created_at),
      updated_at = VALUES(updated_at),
      deleted_at = NULL
  `;

  for (const section of sections) {
    await connection.execute(sql, [
      section.id,
      section.name,
      section.sortOrder,
      section.collapsed ? 1 : 0,
      toMysqlDate(section.createdAt),
      toMysqlDate(section.updatedAt)
    ]);
  }
}

async function replaceCourseRows(connection: PoolConnection, courseTable: string, courses: CourseRecord[]) {
  if (courses.length === 0) {
    await connection.execute(`UPDATE ${courseTable} SET deleted_at = COALESCE(deleted_at, ?) WHERE deleted_at IS NULL`, [new Date()]);
    return;
  }

  const ids = courses.map((course) => course.id);
  await connection.execute(
    `UPDATE ${courseTable} SET deleted_at = COALESCE(deleted_at, ?) WHERE deleted_at IS NULL AND id NOT IN (${ids.map(() => "?").join(", ")})`,
    [new Date(), ...ids]
  );

  const sql = `
    INSERT INTO ${courseTable} (id, name, description, section_id, sort_order, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      description = VALUES(description),
      section_id = VALUES(section_id),
      sort_order = VALUES(sort_order),
      created_at = VALUES(created_at),
      updated_at = VALUES(updated_at),
      deleted_at = NULL
  `;

  for (const course of courses) {
    await connection.execute(sql, [
      course.id,
      course.name,
      course.description,
      course.sectionId,
      course.sortOrder,
      toMysqlDate(course.createdAt),
      toMysqlDate(course.updatedAt)
    ]);
  }
}

async function writeCourseStore(store: CourseStore) {
  const normalized = normalizeCourseStore(store);
  try {
    const { pool, courseTable, courseSectionTable } = await getMysqlRuntime();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      await replaceCourseSectionRows(connection, courseSectionTable, normalized.sections);
      await replaceCourseRows(connection, courseTable, normalized.courses);
      await connection.commit();
      void writeLocalCourseStore(normalized).catch((error) => {
        console.warn("Course local mirror write failed after MySQL save.", error);
      });
      return normalized;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.warn("Course MySQL write failed. Saving to local course store.", error);
    return await writeLocalCourseStore(normalized);
  }
}

function errorToMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function pendingCourseFromPayload(operation: PendingCourseOperation) {
  const record = readPendingPayloadRecord(operation, "course");
  const createdAt = typeof record.createdAt === "string" ? toIsoTimestamp(record.createdAt) : new Date().toISOString();
  const updatedAt = typeof record.updatedAt === "string" ? toIsoTimestamp(record.updatedAt) : createdAt;
  const sectionId = nullableStringFromRecord(record, "sectionId");
  return {
    id: normalizeId(record.id, "Course id"),
    name: normalizeCourseName(record.name),
    description: normalizeCourseDescription(record.description),
    sectionId: sectionId ? normalizeId(sectionId, "Course section id") : null,
    sortOrder: numberFromRecord(record, "sortOrder"),
    createdAt,
    updatedAt
  };
}

function pendingSectionFromPayload(operation: PendingCourseOperation) {
  const record = readPendingPayloadRecord(operation, "section");
  const createdAt = typeof record.createdAt === "string" ? toIsoTimestamp(record.createdAt) : new Date().toISOString();
  const updatedAt = typeof record.updatedAt === "string" ? toIsoTimestamp(record.updatedAt) : createdAt;
  return {
    id: normalizeId(record.id, "Course section id"),
    name: normalizeCourseSectionNameInput(record.name),
    sortOrder: numberFromRecord(record, "sortOrder"),
    collapsed: Boolean(record.collapsed),
    createdAt,
    updatedAt
  };
}

async function applyPendingCourseOperation(connection: PoolConnection, runtime: MysqlRuntime, operation: PendingCourseOperation) {
  switch (operation.action) {
    case "course:create": {
      const course = pendingCourseFromPayload(operation);
      await connection.execute(
        `INSERT INTO ${runtime.courseTable} (id, name, description, section_id, sort_order, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           description = VALUES(description),
           section_id = VALUES(section_id),
           sort_order = VALUES(sort_order),
           created_at = VALUES(created_at),
           updated_at = VALUES(updated_at),
           deleted_at = NULL`,
        [course.id, course.name, course.description, course.sectionId, course.sortOrder, toMysqlDate(course.createdAt), toMysqlDate(course.updatedAt)]
      );
      return;
    }
    case "course:rename": {
      const courseId = normalizeId(operation.payload.courseId, "Course id");
      const name = normalizeCourseName(operation.payload.name);
      const description = normalizeCourseDescription(operation.payload.description);
      const updatedAt = readPendingPayloadString(operation, "updatedAt");
      await connection.execute(
        `UPDATE ${runtime.courseTable}
         SET name = ?, description = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [name, description, toMysqlDate(updatedAt), courseId]
      );
      return;
    }
    case "course:move": {
      const courseId = normalizeId(operation.payload.courseId, "Course id");
      const pendingSectionId = readPendingPayloadOptionalString(operation, "sectionId");
      const sectionId = pendingSectionId ? normalizeId(pendingSectionId, "Course section id") : null;
      const sortOrder = readPendingPayloadNumber(operation, "sortOrder");
      const updatedAt = readPendingPayloadString(operation, "updatedAt");
      await connection.execute(
        `UPDATE ${runtime.courseTable}
         SET section_id = ?, sort_order = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [sectionId, sortOrder, toMysqlDate(updatedAt), courseId]
      );
      return;
    }
    case "course:reorder": {
      for (const movedCourse of readPendingPayloadRecordArray(operation, "courses")) {
        const sectionId = nullableStringFromRecord(movedCourse, "sectionId");
        await connection.execute(
          `UPDATE ${runtime.courseTable}
           SET section_id = ?, sort_order = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
          [
            sectionId,
            numberFromRecord(movedCourse, "sortOrder"),
            toMysqlDate(stringFromRecord(movedCourse, "updatedAt")),
            normalizeId(movedCourse.id, "Course id")
          ]
        );
      }
      return;
    }
    case "course:delete": {
      const courseId = normalizeId(operation.payload.courseId, "Course id");
      const updatedAt = readPendingPayloadString(operation, "updatedAt");
      await connection.execute(
        `UPDATE ${runtime.courseTable}
         SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [toMysqlDate(updatedAt), toMysqlDate(updatedAt), courseId]
      );
      return;
    }
    case "section:create": {
      const section = pendingSectionFromPayload(operation);
      await connection.execute(
        `INSERT INTO ${runtime.courseSectionTable} (id, name, sort_order, collapsed, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           sort_order = VALUES(sort_order),
           collapsed = VALUES(collapsed),
           created_at = VALUES(created_at),
           updated_at = VALUES(updated_at),
           deleted_at = NULL`,
        [section.id, section.name, section.sortOrder, section.collapsed ? 1 : 0, toMysqlDate(section.createdAt), toMysqlDate(section.updatedAt)]
      );
      return;
    }
    case "section:rename": {
      const sectionId = normalizeId(operation.payload.sectionId, "Course section id");
      const name = normalizeCourseSectionNameInput(operation.payload.name);
      const updatedAt = readPendingPayloadString(operation, "updatedAt");
      await connection.execute(
        `UPDATE ${runtime.courseSectionTable}
         SET name = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [name, toMysqlDate(updatedAt), sectionId]
      );
      return;
    }
    case "section:reorder": {
      for (const movedSection of readPendingPayloadRecordArray(operation, "sections")) {
        await connection.execute(
          `UPDATE ${runtime.courseSectionTable}
           SET sort_order = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
          [
            numberFromRecord(movedSection, "sortOrder"),
            toMysqlDate(stringFromRecord(movedSection, "updatedAt")),
            normalizeId(movedSection.id, "Course section id")
          ]
        );
      }
      return;
    }
    case "section:toggle": {
      const sectionId = normalizeId(operation.payload.sectionId, "Course section id");
      const collapsed = readPendingPayloadBoolean(operation, "collapsed");
      const updatedAt = readPendingPayloadString(operation, "updatedAt");
      await connection.execute(
        `UPDATE ${runtime.courseSectionTable}
         SET collapsed = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [collapsed ? 1 : 0, toMysqlDate(updatedAt), sectionId]
      );
      return;
    }
    case "section:toggle-all": {
      const collapsed = readPendingPayloadBoolean(operation, "collapsed");
      const updatedAt = readPendingPayloadString(operation, "updatedAt");
      for (const sectionIdValue of readPendingPayloadRecordArray(operation, "sections")) {
        const sectionId = normalizeId(sectionIdValue.id, "Course section id");
        await connection.execute(
          `UPDATE ${runtime.courseSectionTable}
           SET collapsed = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
          [collapsed ? 1 : 0, toMysqlDate(updatedAt), sectionId]
        );
      }
      return;
    }
    case "section:delete": {
      const sectionId = normalizeId(operation.payload.sectionId, "Course section id");
      const updatedAt = readPendingPayloadString(operation, "updatedAt");
      await connection.execute(
        `UPDATE ${runtime.courseSectionTable}
         SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [toMysqlDate(updatedAt), toMysqlDate(updatedAt), sectionId]
      );

      for (const movedCourse of readPendingPayloadRecordArray(operation, "movedCourses")) {
        await connection.execute(
          `UPDATE ${runtime.courseTable}
           SET section_id = NULL, sort_order = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
          [
            numberFromRecord(movedCourse, "sortOrder"),
            toMysqlDate(stringFromRecord(movedCourse, "updatedAt")),
            normalizeId(movedCourse.id, "Course id")
          ]
        );
      }
      return;
    }
    default:
      throw new Error(`Unsupported pending course operation: ${operation.action}`);
  }
}

async function replayPendingCourseOperations(runtime: MysqlRuntime) {
  const operations = await readPendingCourseOperations();
  if (operations.length === 0) return;

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    const connection = await runtime.pool.getConnection();
    try {
      await connection.beginTransaction();
      await applyPendingCourseOperation(connection, runtime, operation);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      await writePendingCourseOperations([
        {
          ...operation,
          retryCount: operation.retryCount + 1,
          lastError: errorToMessage(error).slice(0, 500)
        },
        ...operations.slice(index + 1)
      ]);
      throw error;
    } finally {
      connection.release();
    }
  }

  await writePendingCourseOperations([]);
}

function normalizeCourseName(value: unknown) {
  const name = typeof value === "string" ? value.trim().slice(0, 40) : "";
  if (!name) {
    throw new Error("课程名称不能为空。");
  }
  return name;
}

function normalizeCourseDescription(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function normalizeCourseSectionNameInput(value: unknown) {
  const name = typeof value === "string" ? value.trim().slice(0, 40) : "";
  if (!name) {
    throw new Error("分区名称不能为空。");
  }
  return name;
}

function assertUniqueCourseSectionName(store: CourseStore, name: string, ignoreId?: string) {
  if (store.sections.some((section) => section.id !== ignoreId && section.name === name)) {
    throw new Error("分区名称已存在。");
  }
}

function getNextCourseSortOrder(courses: CourseRecord[], sectionId: string | null) {
  const siblings = courses.filter((course) => (course.sectionId ?? null) === sectionId);
  if (siblings.length === 0) return 0;
  return Math.max(...siblings.map((course) => Number.isFinite(course.sortOrder) ? course.sortOrder : 0)) + 1;
}

function getNextCourseSectionSortOrder(sections: CourseSectionRecord[]) {
  if (sections.length === 0) return 0;
  return Math.max(...sections.map((section) => Number.isFinite(section.sortOrder) ? section.sortOrder : 0)) + 1;
}

function insertBeforeId<T extends { id: string }>(items: T[], movingId: string, beforeId: string | null) {
  const moving = items.find((item) => item.id === movingId);
  if (!moving) return null;
  const withoutMoving = items.filter((item) => item.id !== movingId);
  const insertIndex = beforeId ? withoutMoving.findIndex((item) => item.id === beforeId) : -1;
  const next = [...withoutMoving];
  next.splice(insertIndex >= 0 ? insertIndex : next.length, 0, moving);
  return next;
}

function sortByCourseOrder<T extends { sortOrder: number; updatedAt: string }>(items: T[]) {
  return [...items].sort((first, second) => {
    const orderDelta = (Number.isFinite(first.sortOrder) ? first.sortOrder : 0) - (Number.isFinite(second.sortOrder) ? second.sortOrder : 0);
    if (orderDelta !== 0) return orderDelta;
    return new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime();
  });
}

function normalizeTargetSectionId(store: CourseStore, value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const sectionId = normalizeId(value, "Course section id");
  return store.sections.some((section) => section.id === sectionId) ? sectionId : null;
}

async function writeAndNormalizeLocalCourseStore(store: CourseStore) {
  return await writeLocalCourseStore(normalizeCourseStore(store));
}

async function writeLocalCourseStoreWithPending(
  store: CourseStore,
  action: PendingCourseOperation["action"],
  payload: Record<string, unknown>
) {
  const normalized = await writeAndNormalizeLocalCourseStore(store);
  try {
    await appendPendingCourseOperation(action, payload);
  } catch (error) {
    console.warn("Course pending operation write failed. Local store was preserved.", error);
  }
  return normalized;
}

async function createCourseSectionCommand(input: CourseSectionNameRequest): Promise<CourseStore> {
  const current = await readCourseStore();
  const name = normalizeCourseSectionNameInput(input?.name);
  assertUniqueCourseSectionName(current, name);
  const now = new Date().toISOString();
  const section: CourseSectionRecord = {
    id: randomUUID(),
    name,
    sortOrder: getNextCourseSectionSortOrder(current.sections),
    collapsed: false,
    createdAt: now,
    updatedAt: now
  };

  try {
    const { pool, courseSectionTable } = await getMysqlRuntime();
    await pool.execute(
      `INSERT INTO ${courseSectionTable} (id, name, sort_order, collapsed, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      [section.id, section.name, section.sortOrder, 0, toMysqlDate(section.createdAt), toMysqlDate(section.updatedAt)]
    );
    return await readCourseStore();
  } catch (error) {
    console.warn("Course section create fell back to local store.", error);
    return await writeLocalCourseStoreWithPending(
      { ...current, sections: [...current.sections, section] },
      "section:create",
      { section }
    );
  }
}

async function renameCourseSectionCommand(input: CourseSectionRenameRequest): Promise<CourseStore> {
  const current = await readCourseStore();
  const sectionId = normalizeId(input?.id, "Course section id");
  const name = normalizeCourseSectionNameInput(input?.name);
  if (!current.sections.some((section) => section.id === sectionId)) {
    throw new Error("分区不存在。");
  }
  assertUniqueCourseSectionName(current, name, sectionId);
  const updatedAt = new Date().toISOString();

  try {
    const { pool, courseSectionTable } = await getMysqlRuntime();
    await pool.execute(
      `UPDATE ${courseSectionTable}
       SET name = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [name, toMysqlDate(updatedAt), sectionId]
    );
    return await readCourseStore();
  } catch (error) {
    console.warn("Course section rename fell back to local store.", error);
    return await writeLocalCourseStoreWithPending(
      {
        ...current,
        sections: current.sections.map((section) => section.id === sectionId ? { ...section, name, updatedAt } : section)
      },
      "section:rename",
      { sectionId, name, updatedAt }
    );
  }
}

async function toggleCourseSectionCommand(input: CourseSectionToggleRequest): Promise<CourseStore> {
  const current = await readCourseStore();
  const sectionId = normalizeId(input?.id, "Course section id");
  const section = current.sections.find((item) => item.id === sectionId);
  if (!section) {
    throw new Error("分区不存在。");
  }
  const collapsed = typeof input?.collapsed === "boolean" ? input.collapsed : !section.collapsed;
  const updatedAt = new Date().toISOString();

  try {
    const { pool, courseSectionTable } = await getMysqlRuntime();
    await pool.execute(
      `UPDATE ${courseSectionTable}
       SET collapsed = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [collapsed ? 1 : 0, toMysqlDate(updatedAt), sectionId]
    );
    return await readCourseStore();
  } catch (error) {
    console.warn("Course section toggle fell back to local store.", error);
    return await writeLocalCourseStoreWithPending(
      {
        ...current,
        sections: current.sections.map((item) => item.id === sectionId ? { ...item, collapsed, updatedAt } : item)
      },
      "section:toggle",
      { sectionId, collapsed, updatedAt }
    );
  }
}

async function toggleAllCourseSectionsCommand(input: CourseSectionToggleAllRequest): Promise<CourseStore> {
  const current = await readCourseStore();
  const collapsed = input?.collapsed === true;
  if (current.sections.length === 0) return current;

  const changedSections = current.sections.filter((section) => section.collapsed !== collapsed);
  if (changedSections.length === 0) return current;

  const updatedAt = new Date().toISOString();
  const nextStore = {
    ...current,
    sections: current.sections.map((section) =>
      section.collapsed === collapsed ? section : { ...section, collapsed, updatedAt }
    )
  };

  try {
    const { pool, courseSectionTable } = await getMysqlRuntime();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `UPDATE ${courseSectionTable}
         SET collapsed = ?, updated_at = ?
         WHERE deleted_at IS NULL AND collapsed <> ?`,
        [collapsed ? 1 : 0, toMysqlDate(updatedAt), collapsed ? 1 : 0]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return await readCourseStore();
  } catch (error) {
    console.warn("Course sections toggle all fell back to local store.", error);
    return await writeLocalCourseStoreWithPending(
      nextStore,
      "section:toggle-all",
      {
        collapsed,
        updatedAt,
        sections: changedSections.map((section) => ({ id: section.id }))
      }
    );
  }
}

async function reorderCourseSectionCommand(input: CourseSectionReorderRequest): Promise<CourseStore> {
  const current = await readCourseStore();
  const sectionId = normalizeId(input?.id, "Course section id");
  const beforeSectionId = input?.beforeSectionId === null || input?.beforeSectionId === undefined || input?.beforeSectionId === ""
    ? null
    : normalizeId(input.beforeSectionId, "Before course section id");
  if (!current.sections.some((section) => section.id === sectionId)) {
    throw new Error("分区不存在。");
  }
  if (beforeSectionId && !current.sections.some((section) => section.id === beforeSectionId)) {
    throw new Error("分区不存在。");
  }
  if (sectionId === beforeSectionId) return current;

  const now = new Date().toISOString();
  const ordered = insertBeforeId(sortByCourseOrder(current.sections), sectionId, beforeSectionId);
  if (!ordered) throw new Error("分区不存在。");
  const nextSections = ordered.map((section, index) => ({
    ...section,
    sortOrder: index,
    updatedAt: section.id === sectionId || section.sortOrder !== index ? now : section.updatedAt
  }));
  const changedSections = nextSections.filter((section) => {
    const previous = current.sections.find((item) => item.id === section.id);
    return previous && (previous.sortOrder !== section.sortOrder || previous.updatedAt !== section.updatedAt);
  });
  const nextStore = normalizeCourseStore({ ...current, sections: nextSections });

  try {
    const { pool, courseSectionTable } = await getMysqlRuntime();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const section of changedSections) {
        await connection.execute(
          `UPDATE ${courseSectionTable}
           SET sort_order = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
          [section.sortOrder, toMysqlDate(section.updatedAt), section.id]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return await readCourseStore();
  } catch (error) {
    console.warn("Course section reorder fell back to local store.", error);
    return await writeLocalCourseStoreWithPending(
      nextStore,
      "section:reorder",
      {
        sections: changedSections.map((section) => ({ id: section.id, sortOrder: section.sortOrder, updatedAt: section.updatedAt }))
      }
    );
  }
}

async function deleteCourseSectionCommand(sectionIdValue: unknown): Promise<CourseStore> {
  const current = await readCourseStore();
  const sectionId = normalizeId(sectionIdValue, "Course section id");
  if (!current.sections.some((section) => section.id === sectionId)) {
    throw new Error("分区不存在。");
  }
  const now = new Date().toISOString();
  let nextUnsectionedOrder = getNextCourseSortOrder(current.courses, null);
  const nextStore = normalizeCourseStore({
    ...current,
    sections: current.sections.filter((section) => section.id !== sectionId),
    courses: current.courses.map((course) => {
      if (course.sectionId !== sectionId) return course;
      const movedCourse = { ...course, sectionId: null, sortOrder: nextUnsectionedOrder, updatedAt: now };
      nextUnsectionedOrder += 1;
      return movedCourse;
    })
  });

  try {
    const { pool, courseTable, courseSectionTable } = await getMysqlRuntime();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(`UPDATE ${courseSectionTable} SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`, [
        toMysqlDate(now),
        toMysqlDate(now),
        sectionId
      ]);
      for (const course of nextStore.courses.filter((course) => current.courses.some((item) => item.id === course.id && item.sectionId === sectionId))) {
        await connection.execute(
          `UPDATE ${courseTable}
           SET section_id = NULL, sort_order = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
          [course.sortOrder, toMysqlDate(course.updatedAt), course.id]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return await readCourseStore();
  } catch (error) {
    console.warn("Course section delete fell back to local store.", error);
    return await writeLocalCourseStoreWithPending(
      nextStore,
      "section:delete",
      {
        sectionId,
        updatedAt: now,
        movedCourses: nextStore.courses
          .filter((course) => current.courses.some((item) => item.id === course.id && item.sectionId === sectionId))
          .map((course) => ({ id: course.id, sortOrder: course.sortOrder, updatedAt: course.updatedAt }))
      }
    );
  }
}

async function createCourseCommand(input: CourseCreateRequest): Promise<CourseStore> {
  const current = await readCourseStore();
  const name = normalizeCourseName(input?.name);
  const description = normalizeCourseDescription(input?.description);
  const sectionId = normalizeTargetSectionId(current, input?.sectionId);
  const now = new Date().toISOString();
  const course: CourseRecord = {
    id: randomUUID(),
    name,
    description,
    sectionId,
    sortOrder: getNextCourseSortOrder(current.courses, sectionId),
    createdAt: now,
    updatedAt: now
  };

  try {
    const { pool, courseTable, mindMapTable, mindMapSnapshotTable, mindMapNodeTable } = await getMysqlRuntime();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO ${courseTable} (id, name, description, section_id, sort_order, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
        [course.id, course.name, course.description, course.sectionId, course.sortOrder, toMysqlDate(course.createdAt), toMysqlDate(course.updatedAt)]
      );
      await createInitialMindMapForCourse(connection, {
        courseId: course.id,
        title: course.name,
        mindMapTable,
        mindMapSnapshotTable,
        mindMapNodeTable,
        createdAt: new Date(course.createdAt)
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    const refreshed = await readCourseStore();
    const nextStore = normalizeCourseStore({ ...refreshed, activeCourseId: course.id });
    void writeLocalCourseStore(nextStore).catch((error) => {
      console.warn("Course local active selection write failed after MySQL create.", error);
    });
    return nextStore;
  } catch (error) {
    console.warn("Course create fell back to local store.", error);
    return await writeLocalCourseStoreWithPending(
      { ...current, courses: [course, ...current.courses], activeCourseId: course.id },
      "course:create",
      { course }
    );
  }
}

async function renameCourseCommand(input: CourseRenameRequest): Promise<CourseStore> {
  const current = await readCourseStore();
  const courseId = normalizeId(input?.id, "Course id");
  const name = normalizeCourseName(input?.name);
  const description = normalizeCourseDescription(input?.description);
  if (!current.courses.some((course) => course.id === courseId)) {
    throw new Error("课程不存在。");
  }
  const updatedAt = new Date().toISOString();

  try {
    const { pool, courseTable } = await getMysqlRuntime();
    await pool.execute(
      `UPDATE ${courseTable}
       SET name = ?, description = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [name, description, toMysqlDate(updatedAt), courseId]
    );
    return await readCourseStore();
  } catch (error) {
    console.warn("Course rename fell back to local store.", error);
    return await writeLocalCourseStoreWithPending(
      {
        ...current,
        courses: current.courses.map((course) => course.id === courseId ? { ...course, name, description, updatedAt } : course)
      },
      "course:rename",
      { courseId, name, description, updatedAt }
    );
  }
}

async function moveCourseCommand(input: CourseMoveRequest): Promise<CourseStore> {
  const current = await readCourseStore();
  const courseId = normalizeId(input?.id, "Course id");
  const sectionId = normalizeTargetSectionId(current, input?.sectionId);
  const course = current.courses.find((item) => item.id === courseId);
  if (!course) {
    throw new Error("课程不存在。");
  }
  if ((course.sectionId ?? null) === sectionId) {
    return current;
  }
  const updatedAt = new Date().toISOString();
  const sortOrder = getNextCourseSortOrder(current.courses.filter((item) => item.id !== courseId), sectionId);

  try {
    const { pool, courseTable } = await getMysqlRuntime();
    await pool.execute(
      `UPDATE ${courseTable}
       SET section_id = ?, sort_order = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [sectionId, sortOrder, toMysqlDate(updatedAt), courseId]
    );
    return await readCourseStore();
  } catch (error) {
    console.warn("Course move fell back to local store.", error);
    return await writeLocalCourseStoreWithPending(
      {
        ...current,
        courses: current.courses.map((item) => item.id === courseId ? { ...item, sectionId, sortOrder, updatedAt } : item)
      },
      "course:move",
      { courseId, sectionId, sortOrder, updatedAt }
    );
  }
}

async function reorderCourseCommand(input: CourseReorderRequest): Promise<CourseStore> {
  const current = await readCourseStore();
  const courseId = normalizeId(input?.id, "Course id");
  const sectionId = normalizeTargetSectionId(current, input?.sectionId);
  const beforeCourseId = input?.beforeCourseId === null || input?.beforeCourseId === undefined || input?.beforeCourseId === ""
    ? null
    : normalizeId(input.beforeCourseId, "Before course id");
  const course = current.courses.find((item) => item.id === courseId);
  if (!course) {
    throw new Error("课程不存在。");
  }
  if (beforeCourseId && !current.courses.some((item) => item.id === beforeCourseId)) {
    throw new Error("课程不存在。");
  }
  if (courseId === beforeCourseId) return current;

  const now = new Date().toISOString();
  const sourceSectionId = course.sectionId ?? null;
  const targetSectionId = beforeCourseId
    ? current.courses.find((item) => item.id === beforeCourseId)?.sectionId ?? sectionId
    : sectionId;
  const movedCourse = { ...course, sectionId: targetSectionId, updatedAt: now };
  const unchangedCourses = current.courses.filter((item) => item.id !== courseId);
  const targetSiblings = sortByCourseOrder(
    [...unchangedCourses.filter((item) => (item.sectionId ?? null) === targetSectionId), movedCourse]
  );
  const orderedTargetSiblings = insertBeforeId(targetSiblings, courseId, beforeCourseId) ?? targetSiblings;
  const changedIds = new Set<string>([courseId]);
  const reorderedTarget = orderedTargetSiblings.map((item, index) => {
    if (item.sortOrder !== index || (item.sectionId ?? null) !== targetSectionId) changedIds.add(item.id);
    return { ...item, sectionId: targetSectionId, sortOrder: index, updatedAt: changedIds.has(item.id) ? now : item.updatedAt };
  });
  const sourceReordered = sourceSectionId === targetSectionId
    ? []
    : sortByCourseOrder(unchangedCourses.filter((item) => (item.sectionId ?? null) === sourceSectionId)).map((item, index) => {
        if (item.sortOrder !== index) changedIds.add(item.id);
        return { ...item, sortOrder: index, updatedAt: item.sortOrder !== index ? now : item.updatedAt };
      });
  const replacement = new Map([...reorderedTarget, ...sourceReordered].map((item) => [item.id, item]));
  const nextCourses = current.courses.map((item) => replacement.get(item.id) ?? item);
  const changedCourses = nextCourses.filter((item) => changedIds.has(item.id));
  const nextStore = normalizeCourseStore({ ...current, courses: nextCourses });

  try {
    const { pool, courseTable } = await getMysqlRuntime();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const item of changedCourses) {
        await connection.execute(
          `UPDATE ${courseTable}
           SET section_id = ?, sort_order = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
          [item.sectionId, item.sortOrder, toMysqlDate(item.updatedAt), item.id]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return await readCourseStore();
  } catch (error) {
    console.warn("Course reorder fell back to local store.", error);
    return await writeLocalCourseStoreWithPending(
      nextStore,
      "course:reorder",
      {
        courses: changedCourses.map((item) => ({
          id: item.id,
          sectionId: item.sectionId,
          sortOrder: item.sortOrder,
          updatedAt: item.updatedAt
        }))
      }
    );
  }
}

async function deleteCourseCommand(courseIdValue: unknown): Promise<CourseStore> {
  const current = await readCourseStore();
  const courseId = normalizeId(courseIdValue, "Course id");
  if (!current.courses.some((course) => course.id === courseId)) {
    throw new Error("课程不存在。");
  }
  const now = new Date().toISOString();
  const nextActiveCourseId = current.activeCourseId === courseId
    ? current.courses.find((course) => course.id !== courseId)?.id ?? null
    : current.activeCourseId;

  try {
    const { pool, courseTable } = await getMysqlRuntime();
    await pool.execute(`UPDATE ${courseTable} SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`, [
      toMysqlDate(now),
      toMysqlDate(now),
      courseId
    ]);
    const refreshed = await readCourseStore();
    const nextStore = normalizeCourseStore({ ...refreshed, activeCourseId: nextActiveCourseId });
    void writeLocalCourseStore(nextStore).catch((error) => {
      console.warn("Course local active selection write failed after MySQL delete.", error);
    });
    return nextStore;
  } catch (error) {
    console.warn("Course delete fell back to local store.", error);
    return await writeLocalCourseStoreWithPending(
      {
        ...current,
        courses: current.courses.filter((course) => course.id !== courseId),
        activeCourseId: nextActiveCourseId
      },
      "course:delete",
      { courseId, updatedAt: now }
    );
  }
}

async function selectCourseCommand(courseIdValue: unknown): Promise<CourseStore> {
  const current = await readCourseStore();
  const courseId = courseIdValue === null || courseIdValue === undefined || courseIdValue === ""
    ? null
    : normalizeId(courseIdValue, "Course id");
  const activeCourseId = courseId && current.courses.some((course) => course.id === courseId) ? courseId : null;
  return await writeAndNormalizeLocalCourseStore({ ...current, activeCourseId });
}

function getNonEmptyString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeId(value: unknown, label: string, fallback?: string) {
  const text = getNonEmptyString(value, fallback);
  if (
    !text ||
    text.length > AISTUDY_CORE_CONTRACT.identity.entityIdMaxLength ||
    !AISTUDY_CORE_CONTRACT.identity.pattern.test(text)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return text;
}

function normalizeNodeScopedId(value: unknown, label: string) {
  const text = getNonEmptyString(value);
  if (
    !text ||
    text.length > AISTUDY_CORE_CONTRACT.identity.nodeIdMaxLength ||
    !AISTUDY_CORE_CONTRACT.identity.pattern.test(text)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return text;
}

function createEntityId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function createSnapshotPayloadJson<T extends { updatedAt: string }>(snapshot: T, updatedAt: string) {
  return JSON.stringify({ ...snapshot, updatedAt });
}

function createSnapshotContentHash<T extends { updatedAt: string }>(snapshot: T) {
  return createHash("sha256").update(JSON.stringify({ ...snapshot, updatedAt: "" })).digest("hex");
}

function createDefaultMindMapTheme() {
  const fontFamily = "\"Microsoft YaHei\", \"微软雅黑\", Arial, sans-serif";
  const fontSize = 20;
  return {
    template: "default",
    config: {
      paddingX: 20,
      paddingY: 9,
      lineWidth: 2,
      lineColor: "#72a9d8",
      lineDasharray: "none",
      lineStyle: "curve",
      lineRadius: 14,
      rootLineKeepSameInCurve: true,
      rootLineStartPositionKeepSameInCurve: true,
      backgroundColor: "#fbfcfd",
      backgroundImage: "none",
      hoverRectColor: "#2f80c0",
      hoverRectRadius: 8,
      root: {
        shape: "roundedRectangle",
        fillColor: "#ffffff",
        color: "#17466f",
        fontFamily,
        fontSize,
        fontWeight: "bold",
        borderColor: "#2f80c0",
        borderWidth: 2,
        borderRadius: 10,
        hoverRectRadius: 10,
        textAlign: "center"
      },
      second: {
        shape: "roundedRectangle",
        marginX: 112,
        marginY: 48,
        fillColor: "#eaf6ff",
        color: "#17466f",
        fontFamily,
        fontSize,
        fontWeight: "bold",
        borderColor: "#91c8ef",
        borderWidth: 1,
        borderRadius: 9,
        hoverRectRadius: 9,
        textAlign: "center"
      },
      node: {
        shape: "roundedRectangle",
        marginX: 96,
        marginY: 42,
        fillColor: "#fff8ee",
        color: "#425466",
        fontFamily,
        fontSize,
        fontWeight: "normal",
        borderColor: "#f0c37c",
        borderWidth: 1,
        borderRadius: 9,
        hoverRectRadius: 9,
        textAlign: "center"
      }
    }
  };
}

function createInitialMindMapSnapshot(title: string, updatedAt: string): MindMapSnapshot {
  return {
    schemaVersion: AISTUDY_CORE_CONTRACT.schemaVersion,
    editor: AISTUDY_CORE_CONTRACT.editors.mindMap,
    editorVersion: "0.14.0-fix.2",
    root: {
      data: {
        uid: "aistudy-node-1",
        text: title || "未命名导图",
        expand: true
      },
      children: []
    },
    layout: AISTUDY_CORE_CONTRACT.mindMap.defaultLayout,
    theme: createDefaultMindMapTheme(),
    updatedAt
  };
}

function assertSnapshotRetentionLimit(value: number, label: string) {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw createAppError("APP_CONFIG_INVALID", `${label} snapshot retention limit is invalid.`);
  }
}

function findOversizedInlineDataUrl(value: unknown): string | null {
  if (typeof value === "string") {
    return INLINE_DATA_URL_PATTERN.test(value) && Buffer.byteLength(value, "utf8") > AISTUDY_CORE_CONTRACT.storage.maxInlineDataUrlBytes
      ? value.slice(0, 48)
      : null;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findOversizedInlineDataUrl(child);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const child of Object.values(value)) {
    const found = findOversizedInlineDataUrl(child);
    if (found) return found;
  }
  return null;
}

function assertSnapshotStorageContract(
  label: "Mind map" | "Knowledge document",
  snapshot: unknown,
  byteSize: number,
  maxByteSize: number
) {
  if (byteSize > maxByteSize) {
    throw createAppError(
      label === "Mind map" ? "MINDMAP_SNAPSHOT_TOO_LARGE" : "DOCUMENT_SNAPSHOT_TOO_LARGE",
      `${label} snapshot exceeds ${maxByteSize} bytes.`,
      { byteSize, maxByteSize }
    );
  }
  const inlineDataUrl = findOversizedInlineDataUrl(snapshot);
  if (inlineDataUrl) {
    throw createAppError(
      label === "Mind map" ? "MINDMAP_INLINE_ASSET_BLOCKED" : "DOCUMENT_INLINE_ASSET_BLOCKED",
      `${label} snapshot contains oversized inline base64 asset: ${inlineDataUrl}`,
      { inlineDataUrlPrefix: inlineDataUrl }
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeMindMapSnapshot(value: unknown): MindMapSnapshot {
  if (!isRecord(value)) {
    throw createAppError("MINDMAP_SNAPSHOT_INVALID", "Mind map snapshot must be an object.");
  }

  const root = value.root;
  if (!isRecord(root)) {
    throw createAppError("MINDMAP_SNAPSHOT_INVALID", "Mind map snapshot root is missing.");
  }

  if (value.schemaVersion !== AISTUDY_CORE_CONTRACT.schemaVersion || value.editor !== AISTUDY_CORE_CONTRACT.editors.mindMap) {
    throw createAppError("MINDMAP_SNAPSHOT_INVALID", "Unsupported mind map snapshot format.");
  }

  return {
    schemaVersion: AISTUDY_CORE_CONTRACT.schemaVersion,
    editor: AISTUDY_CORE_CONTRACT.editors.mindMap,
    editorVersion: getNonEmptyString(value.editorVersion, "unknown"),
    root,
    layout: getNonEmptyString(value.layout, AISTUDY_CORE_CONTRACT.mindMap.defaultLayout),
    theme: value.theme,
    view: value.view,
    updatedAt: getNonEmptyString(value.updatedAt, new Date().toISOString())
  };
}

function normalizeMindMapSaveRequest(value: unknown): MindMapSaveRequest & { courseId: string; snapshot: MindMapSnapshot } {
  if (!isRecord(value)) {
    throw createAppError("MINDMAP_REQUEST_INVALID", "Mind map save request must be an object.");
  }

  return {
    courseId: normalizeId(value.courseId, "Course id"),
    mapId: value.mapId === undefined || value.mapId === null || value.mapId === "" ? undefined : normalizeId(value.mapId, "Mind map id"),
    title: getNonEmptyString(value.title).slice(0, 255) || undefined,
    snapshot: normalizeMindMapSnapshot(value.snapshot)
  };
}

function readNodeData(node: SimpleMindMapNode) {
  return isRecord(node.data) ? node.data : {};
}

function readNodeChildren(node: SimpleMindMapNode) {
  return Array.isArray(node.children) ? node.children.filter(isRecord) as SimpleMindMapNode[] : [];
}

function getNodeTitle(node: SimpleMindMapNode, fallback: string) {
  const text = readNodeData(node).text;
  return getNonEmptyString(text, fallback).slice(0, 512);
}

function getMindMapRootTitleFromPayloadJson(payloadJson: string | null | undefined) {
  if (!payloadJson) return "";
  try {
    const snapshot = normalizeMindMapSnapshot(parseJsonText(payloadJson));
    return getNodeTitle(snapshot.root, "");
  } catch {
    return "";
  }
}

function getNodeId(node: SimpleMindMapNode, pathKey: string) {
  const uid = getNonEmptyString(readNodeData(node).uid);
  if (uid && uid.length <= 96 && /^[A-Za-z0-9:_-]+$/.test(uid)) {
    return uid;
  }

  if (uid) {
    return createHash("sha256").update(uid).digest("hex").slice(0, 32);
  }

  return pathKey.slice(0, 96);
}

function flattenMindMapNodes(
  node: SimpleMindMapNode,
  parentNodeId: string | null,
  depth: number,
  positionIndex: number,
  pathKey: string,
  titlePath: string[]
): MindMapProjectionNode[] {
  const title = getNodeTitle(node, depth === 0 ? "Central topic" : "Untitled");
  const nodeId = getNodeId(node, pathKey || "root");
  const nextTitlePath = [...titlePath, title];
  const current: MindMapProjectionNode = {
    nodeId,
    parentNodeId,
    title,
    depth,
    positionIndex,
    pathText: nextTitlePath.join(" / "),
    isCollapsed: readNodeData(node).expand === false
  };

  const children = readNodeChildren(node);
  return [
    current,
    ...children.flatMap((child, index) =>
      flattenMindMapNodes(child, nodeId, depth + 1, index, `${pathKey || "root"}.${index}`, nextTitlePath)
    )
  ];
}

async function findMindMapByCourse(
  connection: PoolConnection | Pool,
  mindMapTable: string,
  courseId: string,
  forUpdate = false
) {
  const [rows] = await connection.execute<MindMapRow[]>(
    `SELECT id, course_id AS courseId, title, current_snapshot_id AS currentSnapshotId,
            node_count AS nodeCount, updated_at AS updatedAt
     FROM ${mindMapTable}
     WHERE course_id = ? AND deleted_at IS NULL
     ORDER BY updated_at DESC
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [courseId]
  );
  return rows[0] ?? null;
}

async function findMindMapById(
  connection: PoolConnection | Pool,
  mindMapTable: string,
  courseId: string,
  mapId: string,
  forUpdate = false
) {
  const [rows] = await connection.execute<MindMapRow[]>(
    `SELECT id, course_id AS courseId, title, current_snapshot_id AS currentSnapshotId,
            node_count AS nodeCount, updated_at AS updatedAt
     FROM ${mindMapTable}
     WHERE course_id = ? AND id = ? AND deleted_at IS NULL
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [courseId, mapId]
  );
  return rows[0] ?? null;
}

async function readSnapshotMeta(
  connection: PoolConnection | Pool,
  snapshotTable: string,
  snapshotId: string,
  ownerColumn: "mind_map_id" | "document_id",
  ownerId: string
) {
  const [rows] = await connection.execute<SnapshotMetaRow[]>(
    `SELECT id, payload_hash AS payloadHash, payload_json AS payloadJson, byte_size AS byteSize
     FROM ${snapshotTable}
     WHERE id = ? AND ${ownerColumn} = ?
     LIMIT 1`,
    [snapshotId, ownerId]
  );
  return rows[0] ?? null;
}

async function pruneOldSnapshots(
  connection: PoolConnection,
  snapshotTable: string,
  ownerColumn: "mind_map_id" | "document_id",
  ownerId: string,
  keepLimit: number
) {
  assertSnapshotRetentionLimit(keepLimit, ownerColumn);
  await connection.execute(
    `DELETE FROM ${snapshotTable}
     WHERE ${ownerColumn} = ?
       AND id NOT IN (
         SELECT id FROM (
           SELECT id
           FROM ${snapshotTable}
           WHERE ${ownerColumn} = ?
           ORDER BY sequence_no DESC
           LIMIT ${keepLimit}
         ) AS retained_snapshots
       )`,
    [ownerId, ownerId]
  );
}

async function readMindMapDocument(courseIdValue: unknown): Promise<MindMapDocument | null> {
  const courseId = normalizeId(courseIdValue, "Course id");
  const { pool, mindMapTable, mindMapSnapshotTable } = await getMysqlRuntime();
  const map = await findMindMapByCourse(pool, mindMapTable, courseId);
  if (!map) return null;

  let snapshot: MindMapSnapshot | null = null;
  if (map.currentSnapshotId) {
    const [rows] = await pool.execute<MindMapSnapshotRow[]>(
      `SELECT payload_json AS payloadJson
       FROM ${mindMapSnapshotTable}
       WHERE id = ? AND mind_map_id = ?
       LIMIT 1`,
      [map.currentSnapshotId, map.id]
    );
    if (rows[0]?.payloadJson) {
      snapshot = normalizeMindMapSnapshot(parseJsonText(rows[0].payloadJson));
    }
  }

  return {
    courseId,
    mapId: map.id,
    title: map.title,
    snapshot,
    updatedAt: toIsoTimestamp(map.updatedAt),
    nodeCount: Number(map.nodeCount) || 0
  };
}

async function getNextMindMapSequence(connection: PoolConnection, snapshotTable: string, mindMapId: string) {
  const [rows] = await connection.execute<MindMapSequenceRow[]>(
    `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS nextSequence
     FROM ${snapshotTable}
     WHERE mind_map_id = ?
     FOR UPDATE`,
    [mindMapId]
  );
  const nextSequence = Number(rows[0]?.nextSequence ?? 1);
  return Number.isFinite(nextSequence) && nextSequence > 0 ? nextSequence : 1;
}

async function upsertMindMapNodes(
  connection: PoolConnection,
  nodeTable: string,
  courseId: string,
  mindMapId: string,
  nodes: MindMapProjectionNode[],
  updatedAt: Date
) {
  await connection.execute(`UPDATE ${nodeTable} SET deleted_at = ? WHERE mind_map_id = ? AND deleted_at IS NULL`, [updatedAt, mindMapId]);

  const sql = `
    INSERT INTO ${nodeTable}
      (id, node_id, mind_map_id, course_id, parent_node_id, title, depth, position_index, path_text, is_collapsed, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON DUPLICATE KEY UPDATE
      parent_node_id = VALUES(parent_node_id),
      title = VALUES(title),
      depth = VALUES(depth),
      position_index = VALUES(position_index),
      path_text = VALUES(path_text),
      is_collapsed = VALUES(is_collapsed),
      updated_at = VALUES(updated_at),
      deleted_at = NULL
  `;

  for (const node of nodes) {
    await connection.execute(sql, [
      `${mindMapId}:${node.nodeId}`,
      node.nodeId,
      mindMapId,
      courseId,
      node.parentNodeId,
      node.title,
      node.depth,
      node.positionIndex,
      node.pathText,
      node.isCollapsed ? 1 : 0,
      updatedAt
    ]);
  }
}

async function createInitialMindMapForCourse(
  connection: PoolConnection,
  input: {
    courseId: string;
    title: string;
    mindMapTable: string;
    mindMapSnapshotTable: string;
    mindMapNodeTable: string;
    createdAt: Date;
  }
) {
  const updatedAt = input.createdAt.toISOString();
  const mapId = createEntityId("mindmap");
  const snapshotId = createEntityId("mmsnap");
  const snapshot = createInitialMindMapSnapshot(input.title, updatedAt);
  const nodes = flattenMindMapNodes(snapshot.root, null, 0, 0, "root", []);
  const rootNodeId = nodes[0]?.nodeId ?? "root";
  const payloadJson = createSnapshotPayloadJson(snapshot, updatedAt);
  const payloadHash = createSnapshotContentHash(snapshot);
  const byteSize = Buffer.byteLength(payloadJson, "utf8");
  assertSnapshotStorageContract("Mind map", snapshot, byteSize, AISTUDY_CORE_CONTRACT.mindMap.maxSnapshotBytes);

  await connection.execute(
    `INSERT INTO ${input.mindMapTable}
      (id, course_id, title, root_node_id, current_snapshot_id, node_count, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [mapId, input.courseId, input.title, rootNodeId, snapshotId, nodes.length, input.createdAt, input.createdAt]
  );
  await connection.execute(
    `INSERT INTO ${input.mindMapSnapshotTable}
      (id, mind_map_id, sequence_no, schema_version, editor, editor_version, payload_json, payload_hash, byte_size, created_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
    [
      snapshotId,
      mapId,
      AISTUDY_CORE_CONTRACT.schemaVersion,
      AISTUDY_CORE_CONTRACT.editors.mindMap,
      snapshot.editorVersion,
      payloadJson,
      payloadHash,
      byteSize,
      input.createdAt
    ]
  );
  await upsertMindMapNodes(connection, input.mindMapNodeTable, input.courseId, mapId, nodes, input.createdAt);
}

async function softDeleteKnowledgeDocumentsForMissingNodes(
  connection: PoolConnection,
  documentTable: string,
  courseId: string,
  mindMapId: string,
  nodeIds: string[],
  updatedAt: Date
) {
  if (nodeIds.length === 0) return;
  const placeholders = nodeIds.map(() => "?").join(", ");
  await connection.execute(
    `UPDATE ${documentTable}
     SET deleted_at = ?, updated_at = ?
     WHERE course_id = ?
       AND mind_map_id = ?
       AND deleted_at IS NULL
       AND node_id NOT IN (${placeholders})`,
    [updatedAt, updatedAt, courseId, mindMapId, ...nodeIds]
  );
}

async function writeMindMapDocument(input: unknown): Promise<MindMapDocument> {
  const request = normalizeMindMapSaveRequest(input);
  const { pool, courseTable, mindMapTable, mindMapSnapshotTable, mindMapNodeTable, knowledgeDocumentTable } = await getMysqlRuntime();
  const connection = await pool.getConnection();
  const now = new Date();
  const updatedAt = now.toISOString();

  try {
    await connection.beginTransaction();

    const existing = request.mapId
      ? await findMindMapById(connection, mindMapTable, request.courseId, request.mapId, true)
      : await findMindMapByCourse(connection, mindMapTable, request.courseId, true);
    const mapId = request.mapId ?? existing?.id ?? createEntityId("mindmap");
    const rootTitle = getNodeTitle(request.snapshot.root, "Mind map").slice(0, 255);
    const title = (request.title || rootTitle).slice(0, 255);
    const nodes = flattenMindMapNodes(request.snapshot.root, null, 0, 0, "root", []);
    const rootNodeId = nodes[0]?.nodeId ?? "root";
    const payloadJson = createSnapshotPayloadJson(request.snapshot, updatedAt);
    const payloadHash = createSnapshotContentHash(request.snapshot);
    const byteSize = Buffer.byteLength(payloadJson, "utf8");
    assertSnapshotStorageContract("Mind map", request.snapshot, byteSize, AISTUDY_CORE_CONTRACT.mindMap.maxSnapshotBytes);

    const currentSnapshotMeta = existing?.currentSnapshotId
      ? await readSnapshotMeta(connection, mindMapSnapshotTable, existing.currentSnapshotId, "mind_map_id", mapId)
      : null;

    if (existing) {
      const [courseRows] = await connection.execute<CourseNameRow[]>(
        `SELECT name FROM ${courseTable} WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
        [request.courseId]
      );
      const currentRootTitle = getMindMapRootTitleFromPayloadJson(currentSnapshotMeta?.payloadJson);
      const expectedTitles = new Set(
        [existing.title, currentRootTitle, courseRows[0]?.name]
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .map((value) => value.trim())
      );
      const matchedTitle = typeof rootTitle === "string" && expectedTitles.has(rootTitle.trim());
      if (expectedTitles.size > 0 && !matchedTitle) {
        throw createAppError(
          "APP_INVALID_ARGUMENT",
          "导图保存目标不一致，已阻止覆盖其他知识库内容。请重新打开当前知识库后再保存。"
        );
      }
    }

    const shouldReuseSnapshot = currentSnapshotMeta?.payloadHash === payloadHash;
    const snapshotId = shouldReuseSnapshot && existing?.currentSnapshotId ? existing.currentSnapshotId : createEntityId("mmsnap");

    await connection.execute(
      `INSERT INTO ${mindMapTable}
        (id, course_id, title, root_node_id, current_snapshot_id, node_count, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE
        course_id = VALUES(course_id),
        title = VALUES(title),
        root_node_id = VALUES(root_node_id),
        current_snapshot_id = VALUES(current_snapshot_id),
        node_count = VALUES(node_count),
        updated_at = VALUES(updated_at),
        deleted_at = NULL`,
      [mapId, request.courseId, title, rootNodeId, snapshotId, nodes.length, now, now]
    );

    if (!shouldReuseSnapshot) {
      const sequenceNo = await getNextMindMapSequence(connection, mindMapSnapshotTable, mapId);
      await connection.execute(
        `INSERT INTO ${mindMapSnapshotTable}
          (id, mind_map_id, sequence_no, schema_version, editor, editor_version, payload_json, payload_hash, byte_size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshotId,
          mapId,
          sequenceNo,
          AISTUDY_CORE_CONTRACT.schemaVersion,
          AISTUDY_CORE_CONTRACT.editors.mindMap,
          request.snapshot.editorVersion,
          payloadJson,
          payloadHash,
          byteSize,
          now
        ]
      );
      await pruneOldSnapshots(connection, mindMapSnapshotTable, "mind_map_id", mapId, MIND_MAP_SNAPSHOT_RETENTION_LIMIT);
    }

    await upsertMindMapNodes(connection, mindMapNodeTable, request.courseId, mapId, nodes, now);
    await softDeleteKnowledgeDocumentsForMissingNodes(
      connection,
      knowledgeDocumentTable,
      request.courseId,
      mapId,
      nodes.map((node) => node.nodeId),
      now
    );
    await connection.commit();

    return {
      courseId: request.courseId,
      mapId,
      title,
      snapshot: parseJsonText(payloadJson) as MindMapSnapshot,
      updatedAt,
      nodeCount: nodes.length
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function normalizeKnowledgeDocumentSnapshot(value: unknown): KnowledgeDocumentSnapshot {
  if (!isRecord(value)) {
    throw createAppError("DOCUMENT_SNAPSHOT_INVALID", "Knowledge document snapshot must be an object.");
  }

  if (
    value.schemaVersion !== AISTUDY_CORE_CONTRACT.schemaVersion ||
    value.editor !== AISTUDY_CORE_CONTRACT.editors.knowledgeDocument
  ) {
    throw createAppError("DOCUMENT_SNAPSHOT_INVALID", "Unsupported knowledge document snapshot format.");
  }

  return {
    schemaVersion: AISTUDY_CORE_CONTRACT.schemaVersion,
    editor: AISTUDY_CORE_CONTRACT.editors.knowledgeDocument,
    editorVersion: getNonEmptyString(value.editorVersion, "unknown"),
    content: value.content ?? null,
    updatedAt: getNonEmptyString(value.updatedAt, new Date().toISOString())
  };
}

const DOCUMENT_CONTENT_STRUCTURAL_KEYS = new Set([
  "id",
  "type",
  "mode",
  "name",
  "style",
  "styles",
  "attrs",
  "schemaVersion",
  "editor",
  "editorVersion",
  "updatedAt"
]);

const MCP_DOCUMENT_TEXT_CONTAINER_KEYS = new Set([
  "content",
  "main",
  "header",
  "footer",
  "children",
  "items",
  "paragraphs",
  "rows",
  "cells",
  "trList",
  "tdList",
  "valueList",
  "listWrap"
]);

const MCP_DOCUMENT_TEXT_SKIP_KEYS = new Set([
  ...DOCUMENT_CONTENT_STRUCTURAL_KEYS,
  "value",
  "font",
  "size",
  "bold",
  "italic",
  "underline",
  "strikeout",
  "color",
  "highlight",
  "rowFlex",
  "listType",
  "listStyle",
  "listId",
  "level",
  "href",
  "url",
  "colgroup",
  "title",
  "separator",
  "width",
  "height",
  "attributes",
  "props",
  "format",
  "formats",
  "marks",
  "decorations",
  "metadata",
  "meta",
  "options",
  "config",
  "configs",
  "settings",
  "theme",
  "selection",
  "cursor",
  "layout",
  "uuid",
  "graffiti"
]);

const MCP_DOCUMENT_TEXT_NOISE_LINE_PATTERN = /^(?:title|list|ol|ul|separator|paragraph|text|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\)|#[0-9a-f]{3,8})$/i;

function isMcpDocumentTextNoiseLine(value: string) {
  const text = value.trim();
  if (!text) return false;
  if (MCP_DOCUMENT_TEXT_NOISE_LINE_PATTERN.test(text)) return true;
  return /^(?:type|style|listStyle|color|backgroundColor|borderColor)\s*[:=]\s*(?:title|list|ol|ul|separator|rgb\(|rgba\(|#[0-9a-f])/i.test(text);
}

function cleanMcpDocumentText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => !isMcpDocumentTextNoiseLine(line))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasKnowledgeDocumentText(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.some(hasKnowledgeDocumentText);
  }
  if (!isRecord(value)) {
    return false;
  }

  return Object.entries(value).some(([key, child]) => {
    if (DOCUMENT_CONTENT_STRUCTURAL_KEYS.has(key)) return false;
    return hasKnowledgeDocumentText(child);
  });
}

function knowledgeDocumentSnapshotHasContent(snapshot: KnowledgeDocumentSnapshot | null | undefined) {
  if (!snapshot?.content) return false;
  return hasKnowledgeDocumentText(snapshot.content);
}

function normalizeKnowledgeDocumentNodeRequest(value: unknown): KnowledgeDocumentNodeRequest {
  if (!isRecord(value)) {
    throw createAppError("DOCUMENT_REQUEST_INVALID", "Knowledge document request must be an object.");
  }

  return {
    courseId: normalizeId(value.courseId, "Course id"),
    mindMapId: normalizeId(value.mindMapId, "Mind map id"),
    nodeId: normalizeNodeScopedId(value.nodeId, "Mind map node id")
  };
}

function normalizeKnowledgeDocumentStatusRequest(value: unknown): KnowledgeDocumentStatusRequest {
  if (!isRecord(value)) {
    throw createAppError("DOCUMENT_REQUEST_INVALID", "Knowledge document status request must be an object.");
  }

  return {
    courseId: normalizeId(value.courseId, "Course id"),
    mindMapId: normalizeId(value.mindMapId, "Mind map id")
  };
}

function normalizeKnowledgeDocumentSaveRequest(
  value: unknown
): KnowledgeDocumentSaveRequest & { snapshot: KnowledgeDocumentSnapshot } {
  const request = normalizeKnowledgeDocumentNodeRequest(value);
  const record = value as Record<string, unknown>;
  return {
    ...request,
    title: getNonEmptyString(record.title).slice(0, 255) || undefined,
    snapshot: normalizeKnowledgeDocumentSnapshot(record.snapshot)
  };
}

async function findKnowledgeDocumentByNode(
  connection: PoolConnection | Pool,
  documentTable: string,
  request: KnowledgeDocumentNodeRequest,
  forUpdate = false,
  includeDeleted = false
) {
  const [rows] = await connection.execute<KnowledgeDocumentRow[]>(
    `SELECT id, course_id AS courseId, mind_map_id AS mindMapId, node_id AS nodeId, title,
            current_snapshot_id AS currentSnapshotId, current_byte_size AS currentByteSize,
            has_content AS hasContent, updated_at AS updatedAt
     FROM ${documentTable}
     WHERE course_id = ? AND mind_map_id = ? AND node_id = ?${includeDeleted ? "" : " AND deleted_at IS NULL"}
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [request.courseId, request.mindMapId, request.nodeId]
  );
  return rows[0] ?? null;
}

async function listKnowledgeDocumentStatuses(input: unknown): Promise<KnowledgeDocumentStatus[]> {
  const request = normalizeKnowledgeDocumentStatusRequest(input);
  const { pool, knowledgeDocumentTable } = await getMysqlRuntime();
  const [rows] = await pool.execute<KnowledgeDocumentStatusRow[]>(
    `SELECT id, course_id AS courseId, mind_map_id AS mindMapId, node_id AS nodeId, title,
            current_byte_size AS currentByteSize, has_content AS hasContent, updated_at AS updatedAt
     FROM ${knowledgeDocumentTable}
     WHERE course_id = ? AND mind_map_id = ? AND deleted_at IS NULL`,
    [request.courseId, request.mindMapId]
  );

  return rows.map((row) => ({
    courseId: row.courseId,
    mindMapId: row.mindMapId,
    nodeId: row.nodeId,
    documentId: row.id,
    title: row.title,
    updatedAt: toIsoTimestamp(row.updatedAt),
    byteSize: Number(row.currentByteSize) || 0,
    hasContent: Boolean(Number(row.hasContent))
  }));
}

async function assertMindMapNodeExists(
  connection: PoolConnection,
  nodeTable: string,
  request: KnowledgeDocumentNodeRequest
) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT node_id
     FROM ${nodeTable}
     WHERE course_id = ? AND mind_map_id = ? AND node_id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [request.courseId, request.mindMapId, request.nodeId]
  );
  if (!rows[0]) {
    throw createAppError("DOCUMENT_NODE_MISSING", "Mind map node is missing. Save the mind map before writing node details.");
  }
}

async function getNextKnowledgeDocumentSequence(connection: PoolConnection, snapshotTable: string, documentId: string) {
  const [rows] = await connection.execute<KnowledgeDocumentSequenceRow[]>(
    `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS nextSequence
     FROM ${snapshotTable}
     WHERE document_id = ?
     FOR UPDATE`,
    [documentId]
  );
  const nextSequence = Number(rows[0]?.nextSequence ?? 1);
  return Number.isFinite(nextSequence) && nextSequence > 0 ? nextSequence : 1;
}

async function readKnowledgeDocument(input: unknown): Promise<KnowledgeDocument | null> {
  const request = normalizeKnowledgeDocumentNodeRequest(input);
  const { pool, knowledgeDocumentTable, knowledgeDocumentSnapshotTable } = await getMysqlRuntime();
  const document = await findKnowledgeDocumentByNode(pool, knowledgeDocumentTable, request);
  if (!document) return null;

  let snapshot: KnowledgeDocumentSnapshot | null = null;
  if (document.currentSnapshotId) {
    const [rows] = await pool.execute<KnowledgeDocumentSnapshotRow[]>(
      `SELECT payload_json AS payloadJson, byte_size AS byteSize
       FROM ${knowledgeDocumentSnapshotTable}
       WHERE id = ? AND document_id = ?
       LIMIT 1`,
      [document.currentSnapshotId, document.id]
    );
    if (rows[0]?.payloadJson) {
      snapshot = normalizeKnowledgeDocumentSnapshot(parseJsonText(rows[0].payloadJson));
    }
  }

  return {
    courseId: request.courseId,
    mindMapId: request.mindMapId,
    nodeId: request.nodeId,
    documentId: document.id,
    title: document.title,
    snapshot,
    updatedAt: toIsoTimestamp(document.updatedAt),
    byteSize: Number(document.currentByteSize) || 0,
    hasContent: Boolean(Number(document.hasContent))
  };
}

async function writeKnowledgeDocument(input: unknown): Promise<KnowledgeDocument> {
  const request = normalizeKnowledgeDocumentSaveRequest(input);
  const { pool, mindMapNodeTable, knowledgeDocumentTable, knowledgeDocumentSnapshotTable } = await getMysqlRuntime();
  const connection = await pool.getConnection();
  const now = new Date();
  const updatedAt = now.toISOString();

  try {
    await connection.beginTransaction();
    await assertMindMapNodeExists(connection, mindMapNodeTable, request);

    const existing = await findKnowledgeDocumentByNode(connection, knowledgeDocumentTable, request, true, true);
    const documentId = existing?.id ?? createEntityId("kdoc");
    const title = (request.title || existing?.title || "未命名文档").slice(0, 255);
    const payloadJson = createSnapshotPayloadJson(request.snapshot, updatedAt);
    const payloadHash = createSnapshotContentHash(request.snapshot);
    const byteSize = Buffer.byteLength(payloadJson, "utf8");
    assertSnapshotStorageContract(
      "Knowledge document",
      request.snapshot,
      byteSize,
      AISTUDY_CORE_CONTRACT.knowledgeDocument.maxSnapshotBytes
    );
    const hasContent = knowledgeDocumentSnapshotHasContent(request.snapshot);

    const currentSnapshotMeta = existing?.currentSnapshotId
      ? await readSnapshotMeta(connection, knowledgeDocumentSnapshotTable, existing.currentSnapshotId, "document_id", documentId)
      : null;
    const shouldReuseSnapshot = currentSnapshotMeta?.payloadHash === payloadHash;
    const snapshotId = shouldReuseSnapshot && existing?.currentSnapshotId ? existing.currentSnapshotId : createEntityId("kdocsnap");

    await connection.execute(
      `INSERT INTO ${knowledgeDocumentTable}
        (id, course_id, mind_map_id, node_id, title, current_snapshot_id, current_byte_size, has_content, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        current_snapshot_id = VALUES(current_snapshot_id),
        current_byte_size = VALUES(current_byte_size),
        has_content = VALUES(has_content),
        updated_at = VALUES(updated_at),
        deleted_at = NULL`,
      [
        documentId,
        request.courseId,
        request.mindMapId,
        request.nodeId,
        title,
        snapshotId,
        byteSize,
        hasContent ? 1 : 0,
        now,
        now
      ]
    );

    if (!shouldReuseSnapshot) {
      const sequenceNo = await getNextKnowledgeDocumentSequence(connection, knowledgeDocumentSnapshotTable, documentId);
      await connection.execute(
        `INSERT INTO ${knowledgeDocumentSnapshotTable}
          (id, document_id, sequence_no, schema_version, editor, editor_version, payload_json, payload_hash, byte_size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshotId,
          documentId,
          sequenceNo,
          AISTUDY_CORE_CONTRACT.schemaVersion,
          AISTUDY_CORE_CONTRACT.editors.knowledgeDocument,
          request.snapshot.editorVersion,
          payloadJson,
          payloadHash,
          byteSize,
          now
        ]
      );
      await pruneOldSnapshots(
        connection,
        knowledgeDocumentSnapshotTable,
        "document_id",
        documentId,
        KNOWLEDGE_DOCUMENT_SNAPSHOT_RETENTION_LIMIT
      );
    }

    await connection.commit();

    return {
      courseId: request.courseId,
      mindMapId: request.mindMapId,
      nodeId: request.nodeId,
      documentId,
      title,
      snapshot: parseJsonText(payloadJson) as KnowledgeDocumentSnapshot,
      updatedAt,
      byteSize,
      hasContent
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function normalizeMcpText(value: unknown, fallback = "") {
  return (typeof value === "string" ? value : fallback).trim().slice(0, 120);
}

async function resolveCourseForMcp(courseIdValue: unknown, required = false) {
  const store = await readCourseStore();
  const courseId = normalizeMcpText(courseIdValue, "");
  const course = courseId ? store.courses.find((item) => item.id === courseId) ?? null : null;
  if (courseId && !course) {
    throw createAppError("APP_INVALID_ARGUMENT", "MCP course id is invalid.");
  }
  if (required && !course) {
    throw createAppError("APP_INVALID_ARGUMENT", "MCP requires an explicit knowledge base.");
  }
  return { store, course };
}

async function summarizeMindMapForCourse(course: CourseRecord) {
  const document = await readMindMapDocument(course.id);
  return {
    course,
    mapId: document?.mapId ?? null,
    title: document?.title ?? course.name,
    nodeCount: document?.nodeCount ?? 0,
    rootChildren: countMindMapChildren(document?.snapshot ?? null),
    updatedAt: document?.updatedAt ?? null
  };
}

async function getRequiredCourseForMcp(courseIdValue: unknown) {
  const { course } = await resolveCourseForMcp(courseIdValue, true);
  if (!course) {
    throw createAppError("APP_INVALID_ARGUMENT", "MCP requires an explicit knowledge base.");
  }
  return course;
}

function countMindMapChildren(snapshot: MindMapSnapshot | null) {
  if (!snapshot?.root || !Array.isArray(snapshot.root.children)) return 0;
  return snapshot.root.children.length;
}

async function searchCurrentMindMapNodes(queryValue: unknown, courseIdValue: unknown) {
  const query = normalizeMcpText(queryValue, "MCP") || "MCP";
  const { course } = await resolveCourseForMcp(courseIdValue, false);
  const runtime = await getMysqlRuntime();
  if (!course) {
    const [rows] = await runtime.pool.execute<McpNodeSearchRow[]>(
      `SELECT n.course_id AS courseId, c.name AS courseName, n.mind_map_id AS mindMapId,
              n.node_id AS nodeId, n.title, n.path_text AS pathText, n.depth, n.updated_at AS updatedAt
       FROM ${runtime.mindMapNodeTable} n
       LEFT JOIN ${runtime.courseTable} c ON c.id = n.course_id AND c.deleted_at IS NULL
       WHERE n.deleted_at IS NULL
         AND (n.title LIKE ? OR n.path_text LIKE ?)
       ORDER BY n.updated_at DESC, n.depth ASC, n.position_index ASC
       LIMIT 50`,
      [`%${query}%`, `%${query}%`]
    );
    return {
      scope: "all",
      query,
      nodes: rows.map((row) => ({
        courseId: row.courseId,
        courseName: row.courseName ?? "",
        mapId: row.mindMapId,
        nodeId: row.nodeId,
        title: row.title,
        path: row.pathText ?? row.title,
        depth: Number(row.depth) || 0,
        updatedAt: toIsoTimestamp(row.updatedAt)
      }))
    };
  }

  const map = await findMindMapByCourse(runtime.pool, runtime.mindMapTable, course.id);
  if (!map) {
    return { scope: "course", course, query, mapId: null, nodes: [] };
  }

  const [rows] = await runtime.pool.execute<McpNodeSearchRow[]>(
    `SELECT course_id AS courseId, mind_map_id AS mindMapId, node_id AS nodeId, title, path_text AS pathText, depth, updated_at AS updatedAt
     FROM ${runtime.mindMapNodeTable}
     WHERE course_id = ?
       AND mind_map_id = ?
       AND deleted_at IS NULL
       AND (title LIKE ? OR path_text LIKE ?)
     ORDER BY depth ASC, position_index ASC
     LIMIT 20`,
    [course.id, map.id, `%${query}%`, `%${query}%`]
  );

  return {
    scope: "course",
    course,
    query,
    mapId: map.id,
    nodes: rows.map((row) => ({
      courseId: row.courseId,
      courseName: course.name,
      mapId: row.mindMapId,
      nodeId: row.nodeId,
      title: row.title,
      path: row.pathText ?? row.title,
      depth: Number(row.depth) || 0,
      updatedAt: toIsoTimestamp(row.updatedAt)
    }))
  };
}

function createMcpMindMapNode(text: string): SimpleMindMapNode {
  return {
    data: {
      uid: createEntityId("mcpnode"),
      text,
      expand: true,
      richText: false,
      isActive: false
    },
    children: []
  };
}

function cloneMcpMindMapSnapshot(snapshot: MindMapSnapshot): MindMapSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as MindMapSnapshot;
}

function readMcpNodeId(node: SimpleMindMapNode | null | undefined) {
  const value = node?.data?.uid;
  return typeof value === "string" && value ? value : null;
}

function findMcpNode(
  root: SimpleMindMapNode,
  nodeId: string,
  parent: SimpleMindMapNode | null = null
): { node: SimpleMindMapNode; parent: SimpleMindMapNode | null; index: number } | null {
  if (readMcpNodeId(root) === nodeId) return { node: root, parent, index: 0 };
  const children = Array.isArray(root.children) ? root.children : [];
  for (let index = 0; index < children.length; index += 1) {
    const found = findMcpNode(children[index], nodeId, root);
    if (found) return { ...found, index: found.parent === root ? index : found.index };
  }
  return null;
}

function mcpNodeContains(root: SimpleMindMapNode, nodeId: string): boolean {
  if (readMcpNodeId(root) === nodeId) return true;
  return (Array.isArray(root.children) ? root.children : []).some((child) => mcpNodeContains(child, nodeId));
}

async function getMcpMindMapTarget(courseIdValue: unknown) {
  const course = await getRequiredCourseForMcp(courseIdValue);
  const document = await readMindMapDocument(course.id);
  if (!document?.snapshot) {
    throw createAppError("MINDMAP_REQUEST_INVALID", "Active course mind map is missing.");
  }
  return { course, document, snapshot: cloneMcpMindMapSnapshot(document.snapshot) };
}

async function saveMcpMindMapTarget(course: CourseRecord, document: MindMapDocument, snapshot: MindMapSnapshot) {
  return writeMindMapDocument({
    courseId: course.id,
    mapId: document.mapId,
    title: document.title,
    snapshot: {
      ...snapshot,
      updatedAt: new Date().toISOString()
    }
  });
}

async function appendMcpMindMapNode(titleValue: unknown, courseIdValue: unknown) {
  const course = await getRequiredCourseForMcp(courseIdValue);
  const document = await readMindMapDocument(course.id);
  if (!document?.snapshot) {
    throw createAppError("MINDMAP_REQUEST_INVALID", "Active course mind map is missing.");
  }

  const title = normalizeMcpText(titleValue, "") || `MCP编辑调用记录 ${new Date().toLocaleString("zh-CN")}`;
  const nextSnapshot = normalizeMindMapSnapshot(JSON.parse(JSON.stringify(document.snapshot)));
  const root = nextSnapshot.root;
  const children = Array.isArray(root.children) ? root.children : [];
  root.children = children;
  const node = createMcpMindMapNode(title);
  children.push(node);
  nextSnapshot.updatedAt = new Date().toISOString();

  const saved = await writeMindMapDocument({
    courseId: course.id,
    mapId: document.mapId,
    title: document.title,
    snapshot: nextSnapshot
  });

  return {
    course,
    mapId: saved.mapId,
    nodeId: readMcpNodeId(node),
    nodeTitle: title,
    nodeCount: saved.nodeCount,
    updatedAt: saved.updatedAt
  };
}

async function createMcpMindMapNodeCommand(args: Record<string, unknown>) {
  const { course, document, snapshot } = await getMcpMindMapTarget(args.courseId);
  const title = normalizeMcpText(args.title, "") || "新主题";
  const parentNodeId = normalizeMcpText(args.parentNodeId, "");
  const parent = parentNodeId ? findMcpNode(snapshot.root, parentNodeId)?.node : snapshot.root;
  if (!parent) throw createAppError("APP_INVALID_ARGUMENT", "MCP parent node id is invalid.");
  const parentChildren = Array.isArray(parent.children) ? parent.children as SimpleMindMapNode[] : [];
  parent.children = parentChildren;
  const node = createMcpMindMapNode(title);
  const position = Number(args.position);
  const insertAt = Number.isInteger(position) ? Math.min(Math.max(position, 0), parentChildren.length) : parentChildren.length;
  parentChildren.splice(insertAt, 0, node);
  const saved = await saveMcpMindMapTarget(course, document, snapshot);
  return { course, mapId: saved.mapId, nodeId: readMcpNodeId(node), nodeTitle: title, nodeCount: saved.nodeCount, updatedAt: saved.updatedAt };
}

async function updateMcpMindMapNodeText(args: Record<string, unknown>) {
  const { course, document, snapshot } = await getMcpMindMapTarget(args.courseId);
  const nodeId = normalizeMcpText(args.nodeId, "");
  const title = normalizeMcpText(args.title, "");
  if (!nodeId || !title) throw createAppError("APP_INVALID_ARGUMENT", "MCP node id and title are required.");
  const found = findMcpNode(snapshot.root, nodeId);
  if (!found) throw createAppError("APP_INVALID_ARGUMENT", "MCP node id is invalid.");
  found.node.data = { ...(found.node.data ?? {}), text: title };
  const saved = await saveMcpMindMapTarget(course, document, snapshot);
  return { course, mapId: saved.mapId, nodeId, nodeTitle: title, nodeCount: saved.nodeCount, updatedAt: saved.updatedAt };
}

async function moveMcpMindMapNode(args: Record<string, unknown>) {
  const { course, document, snapshot } = await getMcpMindMapTarget(args.courseId);
  const nodeId = normalizeMcpText(args.nodeId, "");
  const targetParentNodeId = normalizeMcpText(args.targetParentNodeId, "");
  if (!nodeId || !targetParentNodeId) throw createAppError("APP_INVALID_ARGUMENT", "MCP node id and target parent id are required.");
  if (readMcpNodeId(snapshot.root) === nodeId) throw createAppError("APP_INVALID_ARGUMENT", "Root node cannot be moved.");
  const found = findMcpNode(snapshot.root, nodeId);
  const target = findMcpNode(snapshot.root, targetParentNodeId)?.node ?? null;
  if (!found?.parent || !target) throw createAppError("APP_INVALID_ARGUMENT", "MCP node id is invalid.");
  if (mcpNodeContains(found.node, targetParentNodeId)) throw createAppError("APP_INVALID_ARGUMENT", "Cannot move a node into its own child.");
  const sourceChildren = Array.isArray(found.parent.children) ? found.parent.children : [];
  sourceChildren.splice(found.index, 1);
  const targetChildren = Array.isArray(target.children) ? target.children as SimpleMindMapNode[] : [];
  target.children = targetChildren;
  const position = Number(args.position);
  const insertAt = Number.isInteger(position) ? Math.min(Math.max(position, 0), targetChildren.length) : targetChildren.length;
  targetChildren.splice(insertAt, 0, found.node);
  const saved = await saveMcpMindMapTarget(course, document, snapshot);
  return { course, mapId: saved.mapId, nodeId, targetParentNodeId, nodeCount: saved.nodeCount, updatedAt: saved.updatedAt };
}

async function deleteMcpMindMapNode(args: Record<string, unknown>) {
  const { course, document, snapshot } = await getMcpMindMapTarget(args.courseId);
  const nodeId = normalizeMcpText(args.nodeId, "");
  if (!nodeId) throw createAppError("APP_INVALID_ARGUMENT", "MCP node id is required.");
  if (readMcpNodeId(snapshot.root) === nodeId) throw createAppError("APP_INVALID_ARGUMENT", "Root node cannot be deleted.");
  const found = findMcpNode(snapshot.root, nodeId);
  if (!found?.parent) throw createAppError("APP_INVALID_ARGUMENT", "MCP node id is invalid.");
  const parentChildren = Array.isArray(found.parent.children) ? found.parent.children as SimpleMindMapNode[] : [];
  found.parent.children = parentChildren.filter((child) => readMcpNodeId(child) !== nodeId);
  const saved = await saveMcpMindMapTarget(course, document, snapshot);
  return { course, mapId: saved.mapId, deletedNodeId: nodeId, nodeCount: saved.nodeCount, updatedAt: saved.updatedAt };
}

async function updateMcpMindMapNodeStyle(args: Record<string, unknown>) {
  const { course, document, snapshot } = await getMcpMindMapTarget(args.courseId);
  const nodeId = normalizeMcpText(args.nodeId, "");
  if (!nodeId) throw createAppError("APP_INVALID_ARGUMENT", "MCP node id is required.");
  const found = findMcpNode(snapshot.root, nodeId);
  if (!found) throw createAppError("APP_INVALID_ARGUMENT", "MCP node id is invalid.");
  const patch: Record<string, unknown> = {};
  const color = normalizeMcpText(args.color, "");
  if (color && /^#[0-9a-f]{6}$/i.test(color)) patch.color = color;
  const fontSize = Number(args.fontSize);
  if (Number.isInteger(fontSize) && fontSize >= 10 && fontSize <= 72) patch.fontSize = fontSize;
  for (const key of ["fontWeight", "fontStyle", "textDecoration"] as const) {
    if (typeof args[key] === "string") patch[key] = args[key];
  }
  const width = Number(args.textAutoWrapWidth);
  if (Number.isInteger(width) && width >= 80 && width <= 1200) patch.textAutoWrapWidth = width;
  found.node.data = { ...(found.node.data ?? {}), ...patch };
  const saved = await saveMcpMindMapTarget(course, document, snapshot);
  return { course, mapId: saved.mapId, nodeId, style: patch, nodeCount: saved.nodeCount, updatedAt: saved.updatedAt };
}

async function updateMcpMindMapLayout(args: Record<string, unknown>) {
  const { course, document, snapshot } = await getMcpMindMapTarget(args.courseId);
  const layout = normalizeMcpText(args.layout, "");
  const allowed = new Set(["logicalStructure", "logicalStructureLeft", "mindMap", "organizationStructure", "catalogOrganization", "timeline", "verticalTimeline", "fishbone", "rightFishbone"]);
  if (!allowed.has(layout)) throw createAppError("APP_INVALID_ARGUMENT", "MCP mind map layout is invalid.");
  snapshot.layout = layout;
  snapshot.view = undefined;
  const saved = await saveMcpMindMapTarget(course, document, snapshot);
  return { course, mapId: saved.mapId, layout, nodeCount: saved.nodeCount, updatedAt: saved.updatedAt };
}

async function readCurrentMindMapSummaryForMcp(courseIdValue: unknown) {
  const { store, course } = await resolveCourseForMcp(courseIdValue, false);
  if (course) {
    return {
      scope: "course",
      ...(await summarizeMindMapForCourse(course))
    };
  }
  const mindMaps = await Promise.all(store.courses.map((item) => summarizeMindMapForCourse(item)));
  return {
    scope: "all",
    courseCount: store.courses.length,
    mindMaps
  };
}

async function resolveCourseLocatorForMcp(courseIdValue: unknown) {
  const store = await readCourseStore();
  const requestedCourseId = normalizeMcpText(courseIdValue, "");
  if (!requestedCourseId) {
    const locators = await Promise.all(store.courses.map(async (course) => {
      const section = course.sectionId
        ? store.sections.find((item) => item.id === course.sectionId) ?? null
        : null;
      const locatorPath = await createCourseLocatorFile({
        courseId: course.id,
        courseName: course.name,
        courseDescription: course.description,
        sectionId: course.sectionId,
        sectionName: section?.name ?? ""
      });
      return { course, section, locatorPath };
    }));
    return {
      scope: "all",
      dataRoot: getAistudyDataRoot(),
      locators,
      usage: "未传 courseId 时会为全库生成定位文件；需要单库定位时传入 courseId。"
    };
  }
  const course = store.courses.find((item) => item.id === requestedCourseId) ?? null;
  if (!course) {
    throw createAppError("APP_INVALID_ARGUMENT", "MCP course id is invalid.");
  }

  const section = course.sectionId
    ? store.sections.find((item) => item.id === course.sectionId) ?? null
    : null;
  const locatorPath = await createCourseLocatorFile({
    courseId: course.id,
    courseName: course.name,
    courseDescription: course.description,
    sectionId: course.sectionId,
    sectionName: section?.name ?? ""
  });
  return {
    course,
    section,
    locatorPath,
    dataRoot: getAistudyDataRoot(),
    usage: "把 locatorPath 提供给 Codex/Claude/Cursor，即可快速定位 AIstudy 本地知识库边界。"
  };
}

const MCP_DOCUMENT_STYLE = {
  section: { size: 26, color: "#ea580c", bold: true },
  subsection: { size: 26, color: "#7c3aed", bold: true },
  article: { size: 24, color: "#2563eb", bold: true },
  body: { size: 24, color: "#111827", bold: false }
} as const;
const MCP_DOCUMENT_MAX_TEXT_RUN_LENGTH = 360;
const MCP_DOCUMENT_FORCE_TEXT_RUN_SPLIT_LENGTH = MCP_DOCUMENT_MAX_TEXT_RUN_LENGTH * 2;

function stripMcpMarkdownHeading(line: string) {
  return line.replace(/^#{1,6}\s+/, "").replace(/\*\*/g, "").trim();
}

function classifyMcpDocumentLine(line: string) {
  const plain = stripMcpMarkdownHeading(line);
  if (!plain) return null;
  if (/^#{1,2}\s+/.test(line) || /^[一二三四五六七八九十]+[、.．]/.test(plain)) return "section";
  if (/^#{3,6}\s+/.test(line) || /^[（(][一二三四五六七八九十\d]+[）)]、?/.test(plain)) return "subsection";
  if (/^第[一二三四五六七八九十百千万\d]+条/.test(plain)) return "article";
  if (plain.length <= 28 && /[:：]$/.test(plain)) return "subsection";
  return "body";
}

function createMcpDocumentElement(value: string, kind: keyof typeof MCP_DOCUMENT_STYLE) {
  return {
    value,
    ...MCP_DOCUMENT_STYLE[kind]
  } as Record<string, unknown>;
}

function shouldSplitMcpDocumentTextRunAt(value: string, index: number) {
  if (index < MCP_DOCUMENT_MAX_TEXT_RUN_LENGTH) return false;
  const char = value[index] || "";
  return char === "\n" || /[\s,，、;；。.!！?？:：]/.test(char);
}

function splitMcpDocumentTextRunValue(value: string) {
  if (value.length <= MCP_DOCUMENT_MAX_TEXT_RUN_LENGTH) return [value];
  const parts: string[] = [];
  let buffer = "";
  for (let index = 0; index < value.length; index += 1) {
    buffer += value[index];
    if (shouldSplitMcpDocumentTextRunAt(buffer, buffer.length - 1) || buffer.length >= MCP_DOCUMENT_FORCE_TEXT_RUN_SPLIT_LENGTH) {
      parts.push(buffer);
      buffer = "";
    }
  }
  if (buffer) parts.push(buffer);
  return parts.length > 0 ? parts : [value];
}

function createMcpDocumentElements(value: string, kind: keyof typeof MCP_DOCUMENT_STYLE) {
  return splitMcpDocumentTextRunValue(value)
    .filter(Boolean)
    .map((part) => createMcpDocumentElement(part, kind));
}

function buildMcpDocumentElements(text: string): Record<string, unknown>[] {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const elements: Record<string, unknown>[] = [];
  let bodyLines: string[] = [];
  const flushBody = () => {
    const body = bodyLines.join("\n").trim();
    bodyLines = [];
    if (!body) return;
    elements.push(...createMcpDocumentElements(`${body}\n\n`, "body"));
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushBody();
      continue;
    }
    const kind = classifyMcpDocumentLine(rawLine);
    if (kind && kind !== "body") {
      flushBody();
      elements.push(createMcpDocumentElement(`${stripMcpMarkdownHeading(rawLine)}\n\n`, kind));
      continue;
    }
    bodyLines.push(line);
  }
  flushBody();
  return elements.length > 0 ? elements : [createMcpDocumentElement("", "body")];
}

function createMcpTextDocumentSnapshot(text: string): KnowledgeDocumentSnapshot {
  return {
    schemaVersion: AISTUDY_CORE_CONTRACT.schemaVersion,
    editor: AISTUDY_CORE_CONTRACT.editors.knowledgeDocument,
    editorVersion: "mcp-text",
    content: { main: buildMcpDocumentElements(text) },
    updatedAt: new Date().toISOString()
  };
}

function extractMcpDocumentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractMcpDocumentText).join("");
  if (!isRecord(value)) return "";
  const own = typeof value.value === "string" ? value.value : "";
  return own + Object.entries(value)
    .filter(([key, child]) => (
      !MCP_DOCUMENT_TEXT_SKIP_KEYS.has(key)
      && (MCP_DOCUMENT_TEXT_CONTAINER_KEYS.has(key) || Array.isArray(child) || (isRecord(child) && ("content" in child || "main" in child)))
    ))
    .map(([, child]) => extractMcpDocumentText(child))
    .join("");
}

function createMcpDocumentTextFields(value: unknown) {
  const textRaw = extractMcpDocumentText(value);
  const textClean = cleanMcpDocumentText(textRaw);
  return {
    text: textClean,
    textClean,
    textRaw,
    textNoiseRemovedLength: Math.max(0, textRaw.length - textClean.length),
    readingGuidance: "Use text/textClean for human-readable content. document.snapshot is editor JSON for advanced tooling."
  };
}

function appendMcpDocumentText(snapshot: KnowledgeDocumentSnapshot, text: string): KnowledgeDocumentSnapshot {
  const next = JSON.parse(JSON.stringify(snapshot)) as KnowledgeDocumentSnapshot;
  const content = isRecord(next.content) ? next.content as { main?: unknown[] } : {};
  const main = Array.isArray(content.main) ? content.main.slice() : [];
  const appended = buildMcpDocumentElements(text);
  const last = main[main.length - 1];
  const lastValue = isRecord(last) && typeof last.value === "string" ? last.value : "";
  if (main.length > 0 && !lastValue.endsWith("\n\n")) {
    main.push(createMcpDocumentElement("\n\n", "body"));
  }
  main.push(...appended);
  return {
    ...next,
    content: { ...content, main },
    updatedAt: new Date().toISOString()
  } as KnowledgeDocumentSnapshot;
}

function applyMcpDocumentStyle(value: unknown, style: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((item) => applyMcpDocumentStyle(item, style));
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = { ...value };
  if (typeof next.value === "string") {
    Object.assign(next, style);
  }
  for (const [key, child] of Object.entries(next)) {
    if (key === "value") continue;
    next[key] = applyMcpDocumentStyle(child, style);
  }
  return next;
}

const MCP_DOCUMENT_FORMAT_TEXT_COLOR = "#1f2937";
const MCP_DOCUMENT_FORMAT_PRIMARY_COLOR = "#2563eb";

function mcpDocumentElementText(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .map((item) => (isRecord(item) && typeof item.value === "string" ? item.value : ""))
    .join("");
}

function getMcpDocumentCoreText(value: unknown) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function isMcpDocumentMainHeadingText(value: unknown) {
  return /^[一二三四五六七八九十]+[、.．]/.test(getMcpDocumentCoreText(value));
}

function isMcpDocumentNumberHeadingText(value: unknown) {
  return /^\d+[.．]\s*\S/.test(getMcpDocumentCoreText(value));
}

function isMcpDocumentLabelText(value: unknown) {
  const text = getMcpDocumentCoreText(value);
  return text.length > 0 && text.length <= 40 && /[:：]$/.test(text) && !isMcpDocumentMainHeadingText(text);
}

function isMcpDocumentUrlText(value: unknown) {
  return /^https?:\/\//i.test(getMcpDocumentCoreText(value));
}

function formatMcpDocumentElementPreservingValue(element: unknown): unknown {
  if (!isRecord(element)) return element;
  const next: Record<string, unknown> = { ...element };
  delete next.rowFlex;
  if (typeof next.value !== "string") return next;

  const value = next.value;
  const text = getMcpDocumentCoreText(value);
  if (!text) {
    next.size = Number.isFinite(Number(next.size)) ? Number(next.size) : 20;
    next.bold = false;
    next.color = MCP_DOCUMENT_FORMAT_TEXT_COLOR;
    delete next.underline;
    return next;
  }
  if (isMcpDocumentMainHeadingText(value)) {
    next.size = 28;
    next.bold = true;
    next.color = MCP_DOCUMENT_FORMAT_PRIMARY_COLOR;
    next.underline = true;
    return next;
  }
  if (isMcpDocumentNumberHeadingText(value)) {
    next.size = 22;
    next.bold = true;
    next.color = MCP_DOCUMENT_FORMAT_TEXT_COLOR;
    delete next.underline;
    return next;
  }
  if (isMcpDocumentLabelText(value)) {
    next.size = 20;
    next.bold = true;
    next.color = MCP_DOCUMENT_FORMAT_TEXT_COLOR;
    delete next.underline;
    return next;
  }
  if (isMcpDocumentUrlText(value)) {
    next.size = 20;
    next.bold = false;
    next.color = MCP_DOCUMENT_FORMAT_PRIMARY_COLOR;
    next.underline = true;
    return next;
  }

  next.size = 20;
  next.bold = false;
  next.color = MCP_DOCUMENT_FORMAT_TEXT_COLOR;
  delete next.underline;
  return next;
}

function formatMcpDocumentSnapshotPreservingText(snapshot: KnowledgeDocumentSnapshot): KnowledgeDocumentSnapshot {
  const content = isRecord(snapshot.content) ? snapshot.content as Record<string, unknown> : {};
  const originalMain = Array.isArray(content.main) ? content.main : [];
  const formattedMain = originalMain.map(formatMcpDocumentElementPreservingValue);
  if (formattedMain.length !== originalMain.length || mcpDocumentElementText(formattedMain) !== mcpDocumentElementText(originalMain)) {
    throw createAppError("APP_INVALID_ARGUMENT", "MCP document format would change text.");
  }
  return {
    ...snapshot,
    schemaVersion: AISTUDY_CORE_CONTRACT.schemaVersion,
    editor: AISTUDY_CORE_CONTRACT.editors.knowledgeDocument,
    content: { ...content, main: formattedMain } as KnowledgeDocumentSnapshot["content"],
    updatedAt: new Date().toISOString()
  };
}

async function resolveMcpDocumentTarget(args: Record<string, unknown>) {
  const course = await getRequiredCourseForMcp(args.courseId);
  const mapId = normalizeMcpText(args.mindMapId, "") || (await readMindMapDocument(course.id))?.mapId || "";
  const nodeId = normalizeMcpText(args.nodeId, "");
  if (!mapId || !nodeId) throw createAppError("APP_INVALID_ARGUMENT", "MCP document target requires courseId and nodeId.");
  return { course, mindMapId: mapId, nodeId };
}

async function listMcpNodeDocuments(args: Record<string, unknown>) {
  const { store, course } = await resolveCourseForMcp(args.courseId, false);
  const runtime = await getMysqlRuntime();
  const courseIds = course ? [course.id] : store.courses.map((item) => item.id);
  if (courseIds.length === 0) return { scope: "all", documents: [] };
  const placeholders = courseIds.map(() => "?").join(", ");
  const [rows] = await runtime.pool.execute<KnowledgeDocumentStatusRow[]>(
    `SELECT id, course_id AS courseId, mind_map_id AS mindMapId, node_id AS nodeId, title,
            current_byte_size AS currentByteSize, has_content AS hasContent, updated_at AS updatedAt
     FROM ${runtime.knowledgeDocumentTable}
     WHERE course_id IN (${placeholders}) AND deleted_at IS NULL
     ORDER BY updated_at DESC
     LIMIT 200`,
    courseIds
  );
  return {
    scope: course ? "course" : "all",
    course: course ?? null,
    documents: rows.map((row) => ({
      courseId: row.courseId,
      mindMapId: row.mindMapId,
      nodeId: row.nodeId,
      documentId: row.id,
      title: row.title,
      updatedAt: toIsoTimestamp(row.updatedAt),
      byteSize: Number(row.currentByteSize) || 0,
      hasContent: Boolean(Number(row.hasContent))
    }))
  };
}

async function readMcpNodeDocument(args: Record<string, unknown>) {
  const target = await resolveMcpDocumentTarget(args);
  const document = await readKnowledgeDocument({
    courseId: target.course.id,
    mindMapId: target.mindMapId,
    nodeId: target.nodeId
  });
  return {
    course: target.course,
    mindMapId: target.mindMapId,
    nodeId: target.nodeId,
    document,
    ...createMcpDocumentTextFields(document?.snapshot?.content ?? "")
  };
}

async function writeMcpNodeDocument(args: Record<string, unknown>) {
  const target = await resolveMcpDocumentTarget(args);
  const title = normalizeMcpText(args.title, "") || "节点文档";
  const existing = await readKnowledgeDocument({
    courseId: target.course.id,
    mindMapId: target.mindMapId,
    nodeId: target.nodeId
  });
  if (existing?.hasContent && args.replaceExisting !== true) {
    throw createAppError(
      "APP_INVALID_ARGUMENT",
      "Node document already has content. Use append_node_document for additions, format_node_document for style-only cleanup, or pass replaceExisting=true only when the user explicitly wants to overwrite the whole document."
    );
  }
  const snapshot = isRecord(args.snapshot)
    ? normalizeKnowledgeDocumentSnapshot(args.snapshot)
    : createMcpTextDocumentSnapshot(typeof args.text === "string" ? args.text : "");
  const document = await writeKnowledgeDocument({
    courseId: target.course.id,
    mindMapId: target.mindMapId,
    nodeId: target.nodeId,
    title,
    snapshot
  });
  return { course: target.course, document, ...createMcpDocumentTextFields(document.snapshot?.content ?? "") };
}

async function appendMcpNodeDocument(args: Record<string, unknown>) {
  const target = await resolveMcpDocumentTarget(args);
  const existing = await readKnowledgeDocument({
    courseId: target.course.id,
    mindMapId: target.mindMapId,
    nodeId: target.nodeId
  });
  const text = typeof args.text === "string" ? args.text : "";
  const snapshot = existing?.snapshot
    ? appendMcpDocumentText(existing.snapshot, text)
    : createMcpTextDocumentSnapshot(text);
  const document = await writeKnowledgeDocument({
    courseId: target.course.id,
    mindMapId: target.mindMapId,
    nodeId: target.nodeId,
    title: normalizeMcpText(args.title, "") || existing?.title || "节点文档",
    snapshot
  });
  return { course: target.course, document, ...createMcpDocumentTextFields(document.snapshot?.content ?? "") };
}

async function formatMcpNodeDocument(args: Record<string, unknown>) {
  const target = await resolveMcpDocumentTarget(args);
  const existing = await readKnowledgeDocument({
    courseId: target.course.id,
    mindMapId: target.mindMapId,
    nodeId: target.nodeId
  });
  if (!existing?.snapshot) throw createAppError("APP_INVALID_ARGUMENT", "Node document is missing.");
  const snapshot = formatMcpDocumentSnapshotPreservingText(existing.snapshot);
  const document = await writeKnowledgeDocument({
    courseId: target.course.id,
    mindMapId: target.mindMapId,
    nodeId: target.nodeId,
    title: normalizeMcpText(args.title, "") || existing.title,
    snapshot
  });
  return { course: target.course, document, preservedText: true };
}

async function updateMcpNodeDocumentStyle(args: Record<string, unknown>) {
  const target = await resolveMcpDocumentTarget(args);
  const existing = await readKnowledgeDocument({
    courseId: target.course.id,
    mindMapId: target.mindMapId,
    nodeId: target.nodeId
  });
  if (!existing?.snapshot) throw createAppError("APP_INVALID_ARGUMENT", "Node document is missing.");
  const style: Record<string, unknown> = {};
  const fontSize = Number(args.fontSize);
  if (Number.isInteger(fontSize) && fontSize >= 10 && fontSize <= 72) style.size = fontSize;
  const color = normalizeMcpText(args.color, "");
  if (color && /^#[0-9a-f]{6}$/i.test(color)) style.color = color;
  if (typeof args.bold === "boolean") style.bold = args.bold;
  if (typeof args.italic === "boolean") style.italic = args.italic;
  if (typeof args.underline === "boolean") style.underline = args.underline;
  const snapshot = {
    ...existing.snapshot,
    content: applyMcpDocumentStyle(existing.snapshot.content, style),
    updatedAt: new Date().toISOString()
  } as KnowledgeDocumentSnapshot;
  const document = await writeKnowledgeDocument({
    courseId: target.course.id,
    mindMapId: target.mindMapId,
    nodeId: target.nodeId,
    title: existing.title,
    snapshot
  });
  return { course: target.course, document, style };
}

function toMcpChromePortInfo(status: ChromePortStatus) {
  return {
    platformId: status.id,
    name: status.name,
    port: status.port,
    defaultUrl: status.loginUrl,
    hostKeyword: status.hostKeyword,
    connected: status.connected,
    pageDetected: status.pageDetected,
    authenticated: status.authenticated,
    saved: status.saved,
    statusText: status.statusText,
    detectedUrl: status.detectedUrl,
    lastCheckedAt: status.lastCheckedAt,
    devtoolsListUrl: `http://127.0.0.1:${status.port}/json/list`,
    openTool: "chrome_port_open_page",
    openArgs: { platformId: status.id }
  };
}

async function runChromePortMcpTool(toolId: string, args: Record<string, unknown>) {
  if (toolId === "chrome_ports_status") {
    const statuses = await getChromePortStatuses();
    return {
      ports: statuses.map(toMcpChromePortInfo),
      usage: {
        first: "chrome_ports_status",
        open: "chrome_port_open_page({ platformId, url? })",
        platformIds: chromePortDefinitions.map((platform) => platform.id)
      }
    };
  }
  if (toolId === "chrome_port_open_page") {
    const result = await openChromePortPage(args.platformId, args.url);
    return {
      opened: result.status.connected,
      openedUrl: result.openedUrl || "",
      message: result.message,
      port: toMcpChromePortInfo(result.status)
    };
  }
  throw createAppError("APP_INVALID_ARGUMENT", "Unknown Chrome port MCP tool.");
}

async function runAdvancedMcpTool(toolId: string, args: Record<string, unknown>) {
  if (toolId === "create_course") return createCourseCommand(args as CourseCreateRequest);
  if (toolId === "rename_course") return renameCourseCommand({ id: args.courseId, name: args.name, description: args.description });
  if (toolId === "move_course") {
    if (args.beforeCourseId !== undefined) return reorderCourseCommand({ id: args.courseId, sectionId: args.sectionId, beforeCourseId: args.beforeCourseId });
    return moveCourseCommand({ id: args.courseId, sectionId: args.sectionId });
  }
  if (toolId === "delete_course") return deleteCourseCommand(args.courseId);
  if (toolId === "create_course_section") return createCourseSectionCommand({ name: args.name });
  if (toolId === "rename_course_section") return renameCourseSectionCommand({ id: args.sectionId, name: args.name });
  if (toolId === "move_course_section") return reorderCourseSectionCommand({ id: args.sectionId, beforeSectionId: args.beforeSectionId });
  if (toolId === "delete_course_section") return deleteCourseSectionCommand(args.sectionId);
  if (toolId === "create_mindmap_node") return createMcpMindMapNodeCommand(args);
  if (toolId === "update_mindmap_node_text") return updateMcpMindMapNodeText(args);
  if (toolId === "move_mindmap_node") return moveMcpMindMapNode(args);
  if (toolId === "delete_mindmap_node") return deleteMcpMindMapNode(args);
  if (toolId === "update_mindmap_node_style") return updateMcpMindMapNodeStyle(args);
  if (toolId === "update_mindmap_layout") return updateMcpMindMapLayout(args);
  if (toolId === "list_node_documents") return listMcpNodeDocuments(args);
  if (toolId === "read_node_document") return readMcpNodeDocument(args);
  if (toolId === "write_node_document") return writeMcpNodeDocument(args);
  if (toolId === "append_node_document") return appendMcpNodeDocument(args);
  if (toolId === "format_node_document") return formatMcpNodeDocument(args);
  if (toolId === "update_node_document_style") return updateMcpNodeDocumentStyle(args);
  throw createAppError("APP_INVALID_ARGUMENT", "Unknown MCP tool.");
}

const mcpController = createMcpController({
  app,
  clipboard,
  getMainWindow: () => mainWindow,
  createAppError,
  getAistudyDataRoot,
  readCourseStore,
  readCurrentMindMapSummary: readCurrentMindMapSummaryForMcp,
  searchCurrentMindMapNodes,
  appendMindMapNode: appendMcpMindMapNode,
  runAdvancedTool: (toolId, args) => runAdvancedMcpTool(toolId, args),
  runChromePortTool: (toolId, args) => runChromePortMcpTool(toolId, args),
  diagnoseRuntime,
  resolveCourseLocator: resolveCourseLocatorForMcp
});

const mcpRemoteAccessController = createMcpRemoteAccessController({
  clipboard,
  userDataRoot: aistudyUserDataRoot,
  handleJsonRpcRequest: (request) => mcpController.handleJsonRpcRequest(request),
  runTrustedTool: (name, args) => mcpController.runTrustedTool(name, args),
  onStateChanged: (state) => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send("mcp:remote-state-changed", state);
  },
  onDataChanged: (change) => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send("mcp:data-changed", change);
  }
});

type McpDataChangeEvent = {
  id: string;
  source?: string;
  tool: string;
  kind: "course" | "mindmap" | "document" | "chrome" | "unknown";
  courseId: string | null;
  nodeId: string | null;
  changedAt: string;
  message: string;
};

let mcpEventWatcher: FSWatcher | null = null;
const handledMcpEventIds = new Set<string>();

function getMcpEventDir() {
  return getAistudyDataPath("runtime", "mcp-events");
}

function normalizeMcpDataChangeEvent(value: unknown): McpDataChangeEvent | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<McpDataChangeEvent>;
  const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : "";
  const tool = typeof candidate.tool === "string" && candidate.tool.trim() ? candidate.tool.trim() : "";
  const allowedKinds: McpDataChangeEvent["kind"][] = ["course", "mindmap", "document", "chrome", "unknown"];
  const kind = allowedKinds.includes(candidate.kind as McpDataChangeEvent["kind"]) ? candidate.kind as McpDataChangeEvent["kind"] : "unknown";
  if (!id || !tool) return null;
  return {
    id,
    source: typeof candidate.source === "string" ? candidate.source : "stdio",
    tool,
    kind,
    courseId: typeof candidate.courseId === "string" && candidate.courseId.trim() ? candidate.courseId.trim() : null,
    nodeId: typeof candidate.nodeId === "string" && candidate.nodeId.trim() ? candidate.nodeId.trim() : null,
    changedAt: typeof candidate.changedAt === "string" && candidate.changedAt.trim() ? candidate.changedAt.trim() : new Date().toISOString(),
    message: typeof candidate.message === "string" ? candidate.message : "MCP 外部调用已完成"
  };
}

function emitMcpDataChange(change: McpDataChangeEvent) {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send("mcp:data-changed", change);
}

async function consumeMcpEventFile(filePath: string) {
  if (!filePath.toLowerCase().endsWith(".json")) return;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const change = normalizeMcpDataChangeEvent(parseJsonText(raw));
    if (!change || handledMcpEventIds.has(change.id)) return;
    handledMcpEventIds.add(change.id);
    if (handledMcpEventIds.size > 500) {
      const first = handledMcpEventIds.values().next().value;
      if (first) handledMcpEventIds.delete(first);
    }
    emitMcpDataChange(change);
    await fs.unlink(filePath).catch(() => undefined);
  } catch {
    // The file may still be moving into place; fs.watch will fire again or the next launch will recover it.
  }
}

function startMcpEventBridge() {
  const eventDir = getMcpEventDir();
  mkdirSync(eventDir, { recursive: true });
  void fs.readdir(eventDir)
    .then((files) => Promise.all(files.filter((fileName) => fileName.toLowerCase().endsWith(".json")).map((fileName) => consumeMcpEventFile(path.join(eventDir, fileName)))))
    .catch(() => undefined);

  mcpEventWatcher?.close();
  mcpEventWatcher = watch(eventDir, (_eventType, fileName) => {
    if (!fileName || !String(fileName).toLowerCase().endsWith(".json")) return;
    const eventPath = path.join(eventDir, String(fileName));
    setTimeout(() => {
      void consumeMcpEventFile(eventPath);
    }, 60);
  });
}

function stopMcpEventBridge() {
  mcpEventWatcher?.close();
  mcpEventWatcher = null;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 820,
    minWidth: 1080,
    minHeight: 680,
    frame: true,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#f4f6f8",
    title: "AIstudy",
    icon: path.join(__dirname, "../build/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  let canCloseAfterDrain = false;
  let isDrainingBeforeClose = false;

  mainWindow.on("close", (event) => {
    const window = mainWindow;
    if (canCloseAfterDrain || !window || window.webContents.isDestroyed()) return;

    event.preventDefault();
    if (isDrainingBeforeClose) return;

    isDrainingBeforeClose = true;
    requestRendererBeforeCloseDrain(window).finally(() => {
      canCloseAfterDrain = true;
      if (!window.isDestroyed()) {
        window.close();
      }
    });
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    closeTextbookPdfWindows();
  });

  if (isDev) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

let isTextbookProtocolHandlerRegistered = false;
const textbookPdfWindows = new Map<string, BrowserWindow>();

function closeTextbookPdfWindows() {
  for (const window of textbookPdfWindows.values()) {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  }
  textbookPdfWindows.clear();
}

function createTextbookPdfResponse(filePath: string, request: Request, fileSize: number) {
  const baseHeaders = {
    "Content-Type": "application/pdf",
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  };
  const rangeHeader = request.headers.get("range")?.trim() ?? "";
  const rangeMatch = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader);

  if (rangeMatch) {
    const suffixLength = rangeMatch[1] ? 0 : Number(rangeMatch[2]);
    const start = rangeMatch[1]
      ? Number(rangeMatch[1])
      : Math.max(0, fileSize - (Number.isFinite(suffixLength) ? suffixLength : 0));
    const end = rangeMatch[2] && rangeMatch[1]
      ? Number(rangeMatch[2])
      : fileSize - 1;

    if (
      !Number.isSafeInteger(start)
      || !Number.isSafeInteger(end)
      || start < 0
      || end < start
      || start >= fileSize
    ) {
      return new Response(null, {
        status: 416,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes */${fileSize}`
        }
      });
    }

    const safeEnd = Math.min(end, fileSize - 1);
    const chunkSize = safeEnd - start + 1;
    const body = Readable.toWeb(createReadStream(filePath, { start, end: safeEnd })) as unknown as BodyInit;
    return new Response(body, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Length": String(chunkSize),
        "Content-Range": `bytes ${start}-${safeEnd}/${fileSize}`
      }
    });
  }

  const body = Readable.toWeb(createReadStream(filePath)) as unknown as BodyInit;
  return new Response(body, {
    status: 200,
    headers: {
      ...baseHeaders,
      "Content-Length": String(fileSize)
    }
  });
}

function registerTextbookProtocolHandler() {
  if (isTextbookProtocolHandlerRegistered) return;
  isTextbookProtocolHandlerRegistered = true;
  protocol.handle(TEXTBOOK_PDF_PROTOCOL, async (request) => {
    const url = new URL(request.url);
    const assetId = decodeURIComponent(path.basename(url.pathname, ".pdf"));
    const filePath = resolveTextbookAssetPath(assetId);
    if (!filePath || path.extname(filePath).toLowerCase() !== ".pdf") {
      return new Response("PDF not found", { status: 404 });
    }

    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) return new Response("PDF not found", { status: 404 });
      return createTextbookPdfResponse(filePath, request, stat.size);
    } catch {
      return new Response("PDF not found", { status: 404 });
    }
  });
}

function normalizeTextbookScope(input: unknown) {
  const request = input && typeof input === "object" ? input as { courseId?: unknown; mindMapId?: unknown } : {};
  return {
    courseId: normalizeId(request.courseId, "Course id"),
    mindMapId: normalizeId(request.mindMapId, "Mind map id")
  };
}

function getTextbookStoreFilePath(courseId: string, mindMapId: string) {
  return getAistudyDataPath("state", "textbooks", `${courseId}__${mindMapId}.json`);
}

function getLegacyTextbookScope(scope: { courseId: string; mindMapId: string }) {
  return scope.mindMapId === scope.courseId ? null : { courseId: scope.courseId, mindMapId: scope.courseId };
}

function reScopeTextbookStore(store: TextbookStore, scope: { courseId: string; mindMapId: string }) {
  return normalizeTextbookStore({
    ...store,
    assets: store.assets.map((asset) => ({ ...asset, courseId: scope.courseId, mindMapId: scope.mindMapId })),
    notes: store.notes.map((note) => ({ ...note, courseId: scope.courseId, mindMapId: scope.mindMapId }))
  }, scope);
}

function getUpdatedAtTime(value: string | undefined) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function shouldUseIncomingTextbookRecord<T extends { updatedAt: string }>(existing: T | undefined, incoming: T) {
  return !existing || getUpdatedAtTime(incoming.updatedAt) >= getUpdatedAtTime(existing.updatedAt);
}

function getTextbookNoteKey(note: TextbookStore["notes"][number]) {
  return `${note.textbookId}\u0000${note.nodeId}`;
}

function normalizeDeletedTextbookNoteKeys(value: unknown) {
  if (!Array.isArray(value)) return new Set<string>();
  const keys = new Set<string>();
  for (const item of value) {
    const candidate = item && typeof item === "object" ? item as { textbookId?: unknown; nodeId?: unknown } : {};
    const textbookId = typeof candidate.textbookId === "string" ? candidate.textbookId.trim() : "";
    const nodeId = typeof candidate.nodeId === "string" ? candidate.nodeId.trim() : "";
    if (textbookId && nodeId) keys.add(`${textbookId}\u0000${nodeId}`);
  }
  return keys;
}

function removeDeletedTextbookNotes(store: TextbookStore, deletedNoteKeys: Set<string>, scope: { courseId: string; mindMapId: string }) {
  if (!deletedNoteKeys.size) return store;
  return normalizeTextbookStore({
    ...store,
    notes: store.notes.filter((note) => !deletedNoteKeys.has(getTextbookNoteKey(note)))
  }, scope);
}

function mergeTextbookStores(base: TextbookStore, incoming: TextbookStore, scope: { courseId: string; mindMapId: string }) {
  const assets = new Map<string, TextbookStore["assets"][number]>();
  for (const asset of base.assets) assets.set(asset.id, asset);
  for (const asset of incoming.assets) {
    const existing = assets.get(asset.id);
    if (shouldUseIncomingTextbookRecord(existing, asset)) assets.set(asset.id, asset);
  }

  const notes = new Map<string, TextbookStore["notes"][number]>();
  for (const note of base.notes) notes.set(getTextbookNoteKey(note), note);
  for (const note of incoming.notes) {
    const key = getTextbookNoteKey(note);
    const existing = notes.get(key);
    if (shouldUseIncomingTextbookRecord(existing, note)) notes.set(key, note);
  }

  return normalizeTextbookStore({
    version: 1,
    assets: Array.from(assets.values()),
    notes: Array.from(notes.values())
  }, scope);
}

async function readLocalTextbookStore(courseId: string, mindMapId: string): Promise<TextbookStore> {
  const filePath = getTextbookStoreFilePath(courseId, mindMapId);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const store = normalizeTextbookStore(parseJsonText(raw), { courseId, mindMapId });
    rememberTextbookAssetPaths(store.assets);
    return store;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return normalizeTextbookStore(null);
    }
    await quarantineUnreadableFile(filePath, error);
    return normalizeTextbookStore(null);
  }
}

async function writeLocalTextbookStore(courseId: string, mindMapId: string, store: TextbookStore) {
  const normalized = normalizeTextbookStore(store, { courseId, mindMapId });
  await writeJsonAtomic(getTextbookStoreFilePath(courseId, mindMapId), normalized);
  rememberTextbookAssetPaths(normalized.assets);
  return normalized;
}

async function loadTextbookStore(input: unknown): Promise<TextbookStore> {
  const scope = normalizeTextbookScope(input);
  const localStore = await readLocalTextbookStore(scope.courseId, scope.mindMapId);
  const legacyScope = getLegacyTextbookScope(scope);
  const migrateLegacyStore = async (store: TextbookStore) => {
    const migratedStore = reScopeTextbookStore(store, scope);
    await writeLocalTextbookStore(scope.courseId, scope.mindMapId, migratedStore);
    return migratedStore;
  };
  try {
    const runtime = await getMysqlRuntime();
    const remoteStore = await readTextbookStoreFromMysql(runtime, scope);
    const mergedStore = mergeTextbookStores(remoteStore, localStore, scope);
    if (textbookStoreHasContent(mergedStore)) {
      await writeLocalTextbookStore(scope.courseId, scope.mindMapId, mergedStore);
      if (!textbookStoreHasContent(localStore)) return mergedStore;
      try {
        const syncedStore = await writeTextbookStoreToMysql(runtime, mergedStore, scope);
        await writeLocalTextbookStore(scope.courseId, scope.mindMapId, syncedStore);
        return syncedStore;
      } catch (error) {
        console.warn("Textbook MySQL merge sync unavailable, using merged local snapshot.", error);
        return mergedStore;
      }
    }
    if (legacyScope) {
      const legacyRemoteStore = await readTextbookStoreFromMysql(runtime, legacyScope);
      const legacyLocalStore = await readLocalTextbookStore(legacyScope.courseId, legacyScope.mindMapId);
      const legacyStore = textbookStoreHasContent(legacyRemoteStore) ? legacyRemoteStore : legacyLocalStore;
      if (textbookStoreHasContent(legacyStore)) {
        const migratedStore = reScopeTextbookStore(legacyStore, scope);
        const syncedStore = await writeTextbookStoreToMysql(runtime, migratedStore, scope);
        await writeLocalTextbookStore(scope.courseId, scope.mindMapId, syncedStore);
        return syncedStore;
      }
    }
    return remoteStore;
  } catch (error) {
    console.warn("Textbook MySQL store unavailable, using local snapshot.", error);
    if (!textbookStoreHasContent(localStore) && legacyScope) {
      const legacyLocalStore = await readLocalTextbookStore(legacyScope.courseId, legacyScope.mindMapId);
      if (textbookStoreHasContent(legacyLocalStore)) {
        return migrateLegacyStore(legacyLocalStore);
      }
    }
    return localStore;
  }
}

async function saveTextbookStore(input: unknown): Promise<TextbookStore> {
  const request = input && typeof input === "object"
    ? input as { courseId?: unknown; mindMapId?: unknown; store?: unknown; deletedNoteKeys?: unknown }
    : {};
  const scope = normalizeTextbookScope(request);
  const deletedNoteKeys = normalizeDeletedTextbookNoteKeys(request.deletedNoteKeys);
  const normalized = removeDeletedTextbookNotes(normalizeTextbookStore(request.store, scope), deletedNoteKeys, scope);
  const localStore = await readLocalTextbookStore(scope.courseId, scope.mindMapId);
  const mergedLocalStore = removeDeletedTextbookNotes(mergeTextbookStores(localStore, normalized, scope), deletedNoteKeys, scope);
  await writeLocalTextbookStore(scope.courseId, scope.mindMapId, mergedLocalStore);
  try {
    const runtime = await getMysqlRuntime();
    const remoteCurrentStore = await readTextbookStoreFromMysql(runtime, scope);
    const storeToSync = removeDeletedTextbookNotes(mergeTextbookStores(remoteCurrentStore, mergedLocalStore, scope), deletedNoteKeys, scope);
    const remoteStore = await writeTextbookStoreToMysql(runtime, storeToSync, scope);
    await writeLocalTextbookStore(scope.courseId, scope.mindMapId, remoteStore);
    return remoteStore;
  } catch (error) {
    console.warn("Textbook MySQL save unavailable, local snapshot kept.", error);
    return mergedLocalStore;
  }
}

async function chooseTextbookPdf(event: IpcMainInvokeEvent, input: unknown): Promise<TextbookAsset | null> {
  const scope = normalizeTextbookScope(input);
  const window = BrowserWindow.fromWebContents(event.sender);
  const dialogOptions: OpenDialogOptions = {
    title: "选择教材 PDF",
    properties: ["openFile"],
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  };
  const result = window ? await dialog.showOpenDialog(window, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
  if (result.canceled || !result.filePaths[0]) return null;
  return createTextbookAssetFromFile({
    courseId: scope.courseId,
    mindMapId: scope.mindMapId,
    filePath: result.filePaths[0]
  });
}

async function readTextbookPdfBytes(input: unknown): Promise<ArrayBuffer> {
  const request = input && typeof input === "object" ? input as { assetId?: unknown; courseId?: unknown; mindMapId?: unknown } : {};
  const scope = normalizeTextbookScope(request);
  const assetId = normalizeId(request.assetId, "Textbook asset id");
  const localStore = await readLocalTextbookStore(scope.courseId, scope.mindMapId);
  let asset = localStore.assets.find((item) => item.id === assetId) ?? null;

  if (!asset) {
    try {
      const runtime = await getMysqlRuntime();
      const remoteStore = await readTextbookStoreFromMysql(runtime, scope);
      asset = remoteStore.assets.find((item) => item.id === assetId) ?? null;
      if (asset) {
        await writeLocalTextbookStore(scope.courseId, scope.mindMapId, mergeTextbookStores(remoteStore, localStore, scope));
      }
    } catch {
      asset = null;
    }
  }

  const filePath = asset?.filePath || resolveTextbookAssetPath(assetId);
  if (!asset || !filePath || path.extname(filePath).toLowerCase() !== ".pdf") {
    throw new Error("教材文件没有打开，请重新选择。");
  }

  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error("教材文件没有打开，请重新选择。");
  }

  const buffer = await fs.readFile(filePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function normalizeTextbookPdfWindowRequest(input: unknown) {
  const request = input && typeof input === "object"
    ? input as { assetId?: unknown; courseId?: unknown; mindMapId?: unknown; pageNumber?: unknown; zoom?: unknown }
    : {};
  const scope = normalizeTextbookScope(request);
  const assetId = normalizeId(request.assetId, "Textbook asset id");
  const pageNumber = Math.max(1, Math.round(Number(request.pageNumber) || 1));
  const zoom = Math.max(60, Math.min(180, Math.round(Number(request.zoom) || 100)));
  return { ...scope, assetId, pageNumber, zoom };
}

async function openTextbookPdfWindow(input: unknown) {
  const request = normalizeTextbookPdfWindowRequest(input);
  const key = `${request.courseId}:${request.mindMapId}:${request.assetId}`;
  const existing = textbookPdfWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    if (!existing.isVisible()) existing.show();
    existing.focus();
    return true;
  }

  const pdfWindow = new BrowserWindow({
    width: 980,
    height: 860,
    minWidth: 760,
    minHeight: 640,
    frame: true,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#f4f6f8",
    title: "AIstudy 教材",
    icon: path.join(__dirname, "../build/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  textbookPdfWindows.set(key, pdfWindow);
  const destroyWindow = () => {
    if (!pdfWindow.isDestroyed()) {
      pdfWindow.destroy();
    }
  };
  pdfWindow.once("ready-to-show", () => {
    if (!pdfWindow.isDestroyed()) pdfWindow.show();
  });
  pdfWindow.on("closed", () => {
    textbookPdfWindows.delete(key);
  });
  pdfWindow.on("unresponsive", destroyWindow);
  pdfWindow.webContents.on("render-process-gone", destroyWindow);

  const query = {
    view: "textbook-pdf",
    courseId: request.courseId,
    mindMapId: request.mindMapId,
    assetId: request.assetId,
    pageNumber: String(request.pageNumber),
    zoom: String(request.zoom)
  };

  if (isDev) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL!);
    for (const [name, value] of Object.entries(query)) {
      url.searchParams.set(name, value);
    }
    await pdfWindow.loadURL(url.toString()).catch((error) => {
      destroyWindow();
      throw error;
    });
  } else {
    await pdfWindow.loadFile(path.join(__dirname, "../dist/index.html"), { query }).catch((error) => {
      destroyWindow();
      throw error;
    });
  }
  return true;
}

if (process.argv.includes("--aistudy-mcp")) {
  void mcpController.startStdioServer();
} else {
app.whenReady().then(() => {
  registerTextbookProtocolHandler();
  createMainWindow();
  warmMysqlRuntime();
  startMcpEventBridge();
  void mcpRemoteAccessController.restore();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  closeTextbookPdfWindows();
  stopMcpEventBridge();
  void mcpRemoteAccessController.close();
  void mysqlRuntime?.pool.end();
});

function withUserFacingError<TResult>(
  source: string,
  userMessage: string,
  handler: (...args: unknown[]) => Promise<TResult> | TResult
) {
  return async (...args: unknown[]) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (isExpectedUpdateDownloadCancel(source, error)) {
        throw new Error("下载已取消。");
      }
      const classified = classifyAppError(source, error, userMessage);
      await recordAppError({ source, userMessage: classified.userMessage, error });
      throw new Error(classified.userMessage);
    }
  };
}

ipcMain.handle("window:minimize", (event) => {
  getEventWindow(event)?.minimize();
});

ipcMain.handle("window:toggle-maximize", (event) => {
  const window = getEventWindow(event);
  if (!window) return;
  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }
});

ipcMain.handle("window:close", (event) => {
  getEventWindow(event)?.close();
});

ipcMain.handle("app:before-close-complete", (_event, token: unknown) => {
  if (typeof token !== "string") return false;
  const resolve = beforeCloseResolvers.get(token);
  if (!resolve) return false;
  beforeCloseResolvers.delete(token);
  resolve();
  return true;
});

ipcMain.handle("clipboard:write-text", withUserFacingError("clipboard:write-text", "复制没有完成，请稍后再试。", (_event, text) => {
  if (typeof text !== "string" || !text.trim()) {
    throw createAppError("APP_INVALID_ARGUMENT", "Clipboard text must be a non-empty string.");
  }
  clipboard.writeText(text);
  return true;
}));

ipcMain.handle("course-locators:create", withUserFacingError("course-locators:create", "路径生成没有完成，请稍后再试。", (_event, input) => createCourseLocatorFile(input as CourseLocatorRequest)));

ipcMain.handle("courses:load", withUserFacingError("courses:load", "课程读取没有完成，请稍后再试。", () => readCourseStore()));

ipcMain.handle("courses:save", withUserFacingError("courses:save", "课程保存没有完成，请稍后再试。", (_event, store) => writeCourseStore(store as CourseStore)));

ipcMain.handle("courses:create", withUserFacingError("courses:create", "课程创建没有完成，请稍后再试。", (_event, input) => createCourseCommand(input as CourseCreateRequest)));

ipcMain.handle("courses:rename", withUserFacingError("courses:rename", "课程重命名没有完成，请稍后再试。", (_event, input) => renameCourseCommand(input as CourseRenameRequest)));

ipcMain.handle("courses:move", withUserFacingError("courses:move", "课程移动没有完成，请稍后再试。", (_event, input) => moveCourseCommand(input as CourseMoveRequest)));

ipcMain.handle("courses:reorder", withUserFacingError("courses:reorder", "课程排序没有完成，请稍后再试。", (_event, input) => reorderCourseCommand(input as CourseReorderRequest)));

ipcMain.handle("courses:delete", withUserFacingError("courses:delete", "课程删除没有完成，请稍后再试。", (_event, courseId) => deleteCourseCommand(courseId)));

ipcMain.handle("courses:select", withUserFacingError("courses:select", "课程切换没有完成，请稍后再试。", (_event, courseId) => selectCourseCommand(courseId)));

ipcMain.handle("courses:sync-status", withUserFacingError("courses:sync-status", "保存状态暂时无法读取。", () => getCourseSyncStatus()));

ipcMain.handle("course-sections:create", withUserFacingError("course-sections:create", "分区创建没有完成，请稍后再试。", (_event, input) => createCourseSectionCommand(input as CourseSectionNameRequest)));

ipcMain.handle("course-sections:rename", withUserFacingError("course-sections:rename", "分区重命名没有完成，请稍后再试。", (_event, input) => renameCourseSectionCommand(input as CourseSectionRenameRequest)));

ipcMain.handle("course-sections:toggle", withUserFacingError("course-sections:toggle", "分区折叠状态没有保存，请稍后再试。", (_event, input) => toggleCourseSectionCommand(input as CourseSectionToggleRequest)));

ipcMain.handle("course-sections:toggle-all", withUserFacingError("course-sections:toggle-all", "分区折叠状态没有保存，请稍后再试。", (_event, input) => toggleAllCourseSectionsCommand(input as CourseSectionToggleAllRequest)));

ipcMain.handle("course-sections:reorder", withUserFacingError("course-sections:reorder", "分区排序没有完成，请稍后再试。", (_event, input) => reorderCourseSectionCommand(input as CourseSectionReorderRequest)));

ipcMain.handle("course-sections:delete", withUserFacingError("course-sections:delete", "分区删除没有完成，请稍后再试。", (_event, sectionId) => deleteCourseSectionCommand(sectionId)));

ipcMain.handle("mindmaps:load", withUserFacingError("mindmaps:load", "导图读取没有完成，请稍后再试。", (_event, courseId) => readMindMapDocument(courseId)));

ipcMain.handle("mindmaps:save", withUserFacingError("mindmaps:save", "导图保存没有完成，请稍后再试。", (_event, request) => writeMindMapDocument(request)));

ipcMain.handle("knowledge-documents:load", withUserFacingError("knowledge-documents:load", "文档读取没有完成，请稍后再试。", (_event, request) => readKnowledgeDocument(request)));

ipcMain.handle("knowledge-documents:list-statuses", withUserFacingError("knowledge-documents:list-statuses", "文档状态读取没有完成，请稍后再试。", (_event, request) => listKnowledgeDocumentStatuses(request)));

ipcMain.handle("knowledge-documents:save", withUserFacingError("knowledge-documents:save", "文档保存没有完成，请稍后再试。", (_event, request) => writeKnowledgeDocument(request)));

ipcMain.handle("knowledge-documents:export-docx", withUserFacingError("knowledge-documents:export-docx", "Word 文档导出没有完成，请稍后再试。", (event, request) => {
  const invokeEvent = event as IpcMainInvokeEvent;
  return exportKnowledgeDocumentDocx(BrowserWindow.fromWebContents(invokeEvent.sender), request);
}));

ipcMain.handle("exams:load", withUserFacingError("exams:load", "考试数据读取没有完成，请稍后再试。", async () => {
  const runtime = await getMysqlRuntime();
  return readExamStoreFromMysql(runtime);
}));

ipcMain.handle("exams:save", withUserFacingError("exams:save", "考试数据保存没有完成，请稍后再试。", async (_event, store) => {
  const runtime = await getMysqlRuntime();
  return writeExamStoreToMysql(runtime, store);
}));

ipcMain.handle("textbooks:load", withUserFacingError("textbooks:load", "教材读取没有完成，请稍后再试。", (_event, scope) => loadTextbookStore(scope)));

ipcMain.handle("textbooks:save", withUserFacingError("textbooks:save", "教材保存没有完成，请稍后再试。", (_event, request) => saveTextbookStore(request)));

ipcMain.handle("textbooks:choose-pdf", withUserFacingError("textbooks:choose-pdf", "教材文件没有打开，请稍后再试。", (event, scope) => (
  chooseTextbookPdf(event as IpcMainInvokeEvent, scope)
)));

ipcMain.handle("textbooks:read-pdf", withUserFacingError("textbooks:read-pdf", "教材文件没有打开，请重新选择。", (_event, request) => (
  readTextbookPdfBytes(request)
)));

ipcMain.handle("textbooks:open-pdf-window", withUserFacingError("textbooks:open-pdf-window", "PDF 窗口没有打开。", (_event, request) => (
  openTextbookPdfWindow(request)
)));

ipcMain.handle("mcp:state", withUserFacingError("mcp:state", "MCP 状态暂时无法读取。", () => mcpController.getState()));

ipcMain.handle("mcp:set-enabled", withUserFacingError("mcp:set-enabled", "MCP 管控状态没有保存。", (_event, input) => mcpController.setControl(input)));

ipcMain.handle("mcp:set-tool-enabled", withUserFacingError("mcp:set-tool-enabled", "MCP 工具状态没有保存。", (_event, input) => mcpController.setToolEnabled(input)));

ipcMain.handle("mcp:run-tool", withUserFacingError("mcp:run-tool", "MCP 调用没有完成。", (_event, input) => mcpController.runTool(input)));

ipcMain.handle("mcp:remote-state", withUserFacingError("mcp:remote-state", "内网访问状态暂时无法读取。", () => mcpRemoteAccessController.getState()));

ipcMain.handle("mcp:remote-set-enabled", withUserFacingError("mcp:remote-set-enabled", "内网访问状态没有保存。", (_event, input) => mcpRemoteAccessController.setEnabled(input)));

ipcMain.handle("mcp:remote-set-permissions", withUserFacingError("mcp:remote-set-permissions", "内网访问权限没有保存。", (_event, input) => mcpRemoteAccessController.setPermissions(input)));

ipcMain.handle("mcp:remote-refresh", withUserFacingError("mcp:remote-refresh", "内网访问检测没有完成。", () => mcpRemoteAccessController.refresh()));

ipcMain.handle("mcp:remote-copy", withUserFacingError("mcp:remote-copy", "内网连接信息没有复制。", () => mcpRemoteAccessController.copyConnectionInfo()));

ipcMain.handle("chrome-ports:status", withUserFacingError("chrome-ports:status", "端口状态读取没有完成，请稍后再试。", () => getChromePortStatuses()));

ipcMain.handle("chrome-ports:open-login", withUserFacingError("chrome-ports:open-login", "登录窗口没有打开，请稍后再试。", (_event, platformId) => openChromePortLogin(platformId)));

ipcMain.handle("chrome-ports:open-page", withUserFacingError("chrome-ports:open-page", "页面没有打开，请稍后再试。", (_event, input) => {
  const request = input && typeof input === "object" ? input as { platformId?: unknown; url?: unknown } : {};
  return openChromePortPage(request.platformId, request.url);
}));

ipcMain.handle(
  "information-collection:bilibili-collect",
  withUserFacingError("information-collection:bilibili-collect", "信息采集没有完成，请稍后再试。", (_event, input) => collectBilibiliInformation(input))
);

ipcMain.handle(
  "information-collection:bilibili-process",
  withUserFacingError("information-collection:bilibili-process", "视频处理没有完成，请稍后再试。", (_event, input) => processBilibiliVideo(input))
);

ipcMain.handle(
  "information-collection:tool-status",
  withUserFacingError("information-collection:tool-status", "采集工具状态没有读取到。", () => readInformationToolStatus())
);

ipcMain.handle(
  "information-collection:open-bilibili",
  withUserFacingError("information-collection:open-bilibili", "B站页面没有打开，请稍后再试。", (_event, input) => openBilibiliCollectionTarget(input))
);

ipcMain.handle("error-logs:list", withUserFacingError("error-logs:list", "报错日志暂时无法读取。", (_event, limit) => listAppErrorLogs(limit)));

ipcMain.handle("runtime:diagnose", withUserFacingError("runtime:diagnose", "环境检查没有完成，请稍后再试。", () => diagnoseRuntime()));

ipcMain.handle("runtime:copy-diagnostic-report", withUserFacingError("runtime:copy-diagnostic-report", "诊断报告暂时无法复制。", () => copyRuntimeDiagnosticReport()));

ipcMain.handle("runtime:open-data-root", withUserFacingError("runtime:open-data-root", "数据目录暂时无法打开。", () => openAistudyDataRoot()));

ipcMain.handle("ai-chat:send", async (_event, request: unknown) => {
  try {
    return await sendAiChat(request);
  } catch (error) {
    const provider = request && typeof request === "object" && (request as AiChatRequest).provider === "chatgpt" ? "chatgpt" : "doubao";
    const userMessage = "AI 回复暂时没有完成，请稍后再试。";
    await recordAppError({
      source: "ai-chat:send",
      userMessage,
      error,
      context: { provider }
    });
    return {
      ok: false,
      provider,
      reply: "",
      error: userMessage
    } satisfies AiChatResult;
  }
});

ipcMain.handle("updates:info", withUserFacingError("updates:info", "更新信息暂时无法读取。", () => getUpdateManagerInfo()));

ipcMain.handle("updates:open-repository", withUserFacingError("updates:open-repository", "仓库页面暂时无法打开。", async () => {
  const info = await getUpdateManagerInfo();
  if (!info.repositoryWebUrl) return false;
  await shell.openExternal(info.repositoryWebUrl);
  return true;
}));

ipcMain.handle("updates:open-index", withUserFacingError("updates:open-index", "更新记录暂时无法打开。", async () => {
  const info = await getUpdateManagerInfo();
  await shell.openPath(info.updateIndexPath);
}));

ipcMain.handle("updates:open-release-dir", withUserFacingError("updates:open-release-dir", "安装包目录暂时无法打开。", async () => {
  const info = await getUpdateManagerInfo();
  await shell.openPath(info.releaseDir);
}));

ipcMain.handle("updates:check", withUserFacingError("updates:check", "更新检测没有完成，请稍后再试。", () => checkForUpdates()));

ipcMain.handle("updates:download", withUserFacingError("updates:download", "安装包下载没有完成，请稍后再试。", (event, downloadUrl, expectedSize) => downloadUpdate(event as IpcMainInvokeEvent, downloadUrl, expectedSize)));

ipcMain.handle("updates:pause-download", withUserFacingError("updates:pause-download", "下载暂时无法暂停。", () => pauseUpdateDownload()));

ipcMain.handle("updates:resume-download", withUserFacingError("updates:resume-download", "下载暂时无法继续。", () => resumeUpdateDownload()));

ipcMain.handle("updates:cancel-download", withUserFacingError("updates:cancel-download", "下载暂时无法取消。", () => cancelUpdateDownload()));

ipcMain.handle("updates:install", withUserFacingError("updates:install", "安装程序没有启动，请稍后再试。", (_event, filePath) => installUpdate(filePath)));

ipcMain.handle("updates:open-release-page", withUserFacingError("updates:open-release-page", "发布页面暂时无法打开。", async (_event, releaseUrl) => {
  if (typeof releaseUrl !== "string" || !releaseUrl.startsWith("https://")) return false;
  await shell.openExternal(releaseUrl);
  return true;
}));
