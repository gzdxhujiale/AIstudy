import type { BrowserWindow } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import type { Pool } from "mysql2/promise";

const DEFAULT_CAPTURE_PORT = 38673;
const CONNECTION_TTL_MS = 45000;
const COMPANION_LAUNCH_INTERVAL_MS = 15000;
const HEARTBEAT_LOCAL_WRITE_INTERVAL_MS = 15000;
const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_CAPTURE_TEXT_CHARS = 30000;
const MAX_DOCUMENT_TEXT_CHARS = 1_000_000;
const DOCUMENT_ID = "default";

type VocabularyCaptureMysqlRuntime = {
  pool: Pool;
};

type VocabularyCapturePayload = {
  source?: unknown;
  appName?: unknown;
  packageName?: unknown;
  foregroundPackageName?: unknown;
  targetActive?: unknown;
  targetLastActiveAt?: unknown;
  serviceStatus?: unknown;
  text?: unknown;
  nodes?: unknown;
  word?: unknown;
  capturedAt?: unknown;
};

type VocabularyCaptureEvent = {
  id: string;
  source: string;
  appName: string;
  packageName: string;
  word: string;
  text: string;
  textHash: string;
  capturedAt: string;
  receivedAt: string;
  payload: Record<string, unknown>;
};

type VocabularyCaptureMirror = {
  documentText: string;
  eventCount: number;
  lastTextHash: string;
  lastSeenAt: string | null;
  lastEventAt: string | null;
  source: string;
  appName: string;
  packageName: string;
  foregroundPackageName: string;
  targetActive: boolean;
  lastTargetActiveAt: string | null;
  serviceStatus: string;
  updatedAt: string | null;
};

export type VocabularyCaptureState = {
  receiver: {
    status: "listening" | "error";
    port: number;
    error: string;
  };
  connection: {
    status: "connected" | "waiting";
    targetStatus: "capturing" | "watching" | "permission_required" | "waiting";
    targetActive: boolean;
    lastSeenAt: string | null;
    lastTargetActiveAt: string | null;
    source: string;
    appName: string;
    packageName: string;
    foregroundPackageName: string;
    serviceStatus: string;
  };
  document: {
    text: string;
    eventCount: number;
    updatedAt: string | null;
    lastEventAt: string | null;
  };
};

type VocabularyCaptureServiceOptions = {
  getDataPath: (...segments: string[]) => string;
  getMysqlRuntime: () => Promise<VocabularyCaptureMysqlRuntime>;
  getWindows: () => BrowserWindow[];
  launchCompanionApp?: () => Promise<void> | void;
  port?: number;
};

function nowIso() {
  return new Date().toISOString();
}

function hashText(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBoolean(value: unknown) {
  if (value === true || value === 1) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function isBaicizhanPackageName(value: string) {
  const lower = value.toLowerCase();
  return lower.includes("jiongji") || lower.includes("baicizhan");
}

function normalizeEpochMillisToIso(value: unknown) {
  const millis = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(millis) || millis <= 0) return null;
  const date = new Date(millis);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizePayloadTargetActive(
  payload: VocabularyCapturePayload,
  packageName: string,
  foregroundPackageName: string,
  appName: string,
  text: string
) {
  if (typeof payload.targetActive === "boolean" || typeof payload.targetActive === "number" || typeof payload.targetActive === "string") {
    return normalizeBoolean(payload.targetActive);
  }
  return Boolean(text)
    || isBaicizhanPackageName(packageName)
    || isBaicizhanPackageName(foregroundPackageName)
    || appName.includes("\u767e\u8bcd\u65a9");
}

function normalizeTextBlock(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_CAPTURE_TEXT_CHARS);
}

const CAPTURE_UI_LINES = new Set([
  "\u4e0b\u4e00\u9898",
  "\u63d0\u4ea4",
  "\u5168\u5c4f",
  "\u7f6e\u9876",
  "\u952e\u4f4d",
  "\u97f3\u91cf",
  "\u5438\u8fb9",
  "\u9690\u8eab",
  "\u53cd\u9988",
  "\u5168\u90e8"
]);

const BLOCKED_WORD_CANDIDATES = new Set([
  "ai",
  "app",
  "back",
  "fullscreen",
  "settings",
  "volume",
  "share",
  "feedback",
  "submit"
]);

function isBase64LikeLine(line: string) {
  if (line.length < 40) return false;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(line)) return false;
  return /[A-Za-z]/.test(line) && /\d/.test(line);
}

function isResourceLikeLine(line: string) {
  const lower = line.toLowerCase();
  return lower.includes("base64")
    || lower.includes("svg+xml")
    || /\.(mp4|png|jpg|jpeg|webp|gif)(?:_|$|\?)/i.test(line)
    || /^intro\d[\w.-]*$/i.test(line);
}

function isCaptureNoiseLine(line: string) {
  if (!line) return true;
  if (/^[A-Za-z]$/.test(line)) return true;
  if (/^\u9700\u5b66\u4e60\s*\d+/.test(line)) return true;
  if (CAPTURE_UI_LINES.has(line)) return true;
  if (isResourceLikeLine(line)) return true;
  if (isBase64LikeLine(line)) return true;
  return false;
}

function isWordCandidate(value: string) {
  return /^[A-Za-z][A-Za-z'-]{2,48}$/.test(value);
}

function isPhoneticLine(line: string) {
  return /^\/.+\/$/.test(line) || /^(\u82f1|\u7f8e)\s+\/.+\/$/.test(line);
}

function isVocabularyHeadLine(lines: string[], index: number) {
  const candidate = lines[index]?.trim() ?? "";
  if (!isWordCandidate(candidate)) return false;
  if (BLOCKED_WORD_CANDIDATES.has(candidate.toLowerCase())) return false;
  const window = lines.slice(index + 1, index + 6);
  return window.some((line) => isPhoneticLine(line));
}

function findWordLineIndex(lines: string[], explicitWord: unknown) {
  const headIndexes = lines
    .map((_, index) => index)
    .filter((index) => isVocabularyHeadLine(lines, index));
  if (headIndexes.length > 0) return headIndexes[headIndexes.length - 1];

  const fromPayload = normalizeString(explicitWord);
  if (isWordCandidate(fromPayload) && lines.some((line) => isPhoneticLine(line))) {
    const normalizedWord = fromPayload.toLowerCase();
    const exactIndex = lines.findIndex((line) => line.toLowerCase() === normalizedWord);
    if (exactIndex >= 0) return exactIndex;
  }

  return -1;
}

function normalizeVocabularyCaptureText(rawText: string, explicitWord: unknown) {
  const normalizedText = normalizeTextBlock(rawText);
  if (!normalizedText) return "";

  const cleanedLines = normalizedText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !isCaptureNoiseLine(line));

  const wordIndex = findWordLineIndex(cleanedLines, explicitWord);
  if (wordIndex < 0) return "";
  return cleanedLines[wordIndex].trim().toLowerCase().slice(0, MAX_CAPTURE_TEXT_CHARS);
}

function normalizeTextFromPayload(payload: VocabularyCapturePayload) {
  const directText = normalizeString(payload.text);
  if (directText) return normalizeVocabularyCaptureText(directText, payload.word);

  if (!Array.isArray(payload.nodes)) return "";
  const lines = payload.nodes
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return normalizeVocabularyCaptureText(lines.join("\n"), payload.word);
}

function normalizePayloadObject(value: unknown): VocabularyCapturePayload {
  return value && typeof value === "object" ? value as VocabularyCapturePayload : {};
}

function readPayloadJson(payload: VocabularyCapturePayload) {
  const output: Record<string, unknown> = {};
  for (const key of ["source", "appName", "packageName", "foregroundPackageName", "targetActive", "targetLastActiveAt", "serviceStatus", "word", "capturedAt"]) {
    const value = payload[key as keyof VocabularyCapturePayload];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      output[key] = value;
    }
  }
  if (Array.isArray(payload.nodes)) {
    output.nodes = payload.nodes
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.slice(0, 300))
      .slice(0, 160);
  }
  return output;
}

function createEmptyMirror(): VocabularyCaptureMirror {
  return {
    documentText: "",
    eventCount: 0,
    lastTextHash: "",
    lastSeenAt: null,
    lastEventAt: null,
    source: "",
    appName: "",
    packageName: "",
    foregroundPackageName: "",
    targetActive: false,
    lastTargetActiveAt: null,
    serviceStatus: "",
    updatedAt: null
  };
}

function trimDocumentText(text: string) {
  if (text.length <= MAX_DOCUMENT_TEXT_CHARS) return text;
  const slice = text.slice(text.length - MAX_DOCUMENT_TEXT_CHARS);
  const firstBreak = slice.indexOf("\n\n");
  return firstBreak >= 0 ? slice.slice(firstBreak + 2).trimStart() : slice.trimStart();
}

function appendDocumentBlock(currentText: string, nextBlock: string) {
  const merged = currentText ? `${currentText.trimEnd()}\n${nextBlock}` : nextBlock;
  return trimDocumentText(merged);
}

function readVocabularyDocumentWords(text: string) {
  return text
    .split(/\n{2,}/)
    .flatMap((block) => {
      const normalizedBlock = normalizeTextBlock(block);
      if (!normalizedBlock) return [];
      const lines = normalizedBlock.split("\n");
      if (lines.every((line) => isWordCandidate(line) && !BLOCKED_WORD_CANDIDATES.has(line.toLowerCase()))) {
        return lines.map((line) => line.toLowerCase());
      }
      const word = normalizeVocabularyCaptureText(normalizedBlock, "");
      return word ? [word] : [];
    });
}

function normalizeVocabularyDocumentForState(text: string) {
  const seen = new Set<string>();
  const words = readVocabularyDocumentWords(text)
    .filter((word) => {
      const key = word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return words.join("\n");
}

function normalizeEditableVocabularyDocument(text: string) {
  const seen = new Set<string>();
  const normalizedWords = readVocabularyDocumentWords(text)
    .filter((word) => {
      const key = word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (normalizedWords.length > 0) return normalizedWords.join("\n");

  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => isWordCandidate(line) && !BLOCKED_WORD_CANDIDATES.has(line))
    .filter((word) => {
      if (seen.has(word)) return false;
      seen.add(word);
      return true;
    })
    .join("\n");
}

function hasVocabularyWord(text: string, word: string) {
  const normalizedWord = word.trim().toLowerCase();
  if (!normalizedWord) return false;
  return readVocabularyDocumentWords(text).some((item) => item.toLowerCase() === normalizedWord);
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BYTES) {
      throw new Error("payload too large");
    }
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

async function ensureVocabularyCaptureTables(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vocabulary_capture_documents (
      id VARCHAR(64) NOT NULL,
      document_text LONGTEXT NOT NULL,
      event_count INT NOT NULL DEFAULT 0,
      last_text_hash CHAR(64) NOT NULL DEFAULT '',
      last_seen_at DATETIME(3) NULL,
      last_event_at DATETIME(3) NULL,
      source VARCHAR(120) NOT NULL DEFAULT '',
      app_name VARCHAR(120) NOT NULL DEFAULT '',
      package_name VARCHAR(180) NOT NULL DEFAULT '',
      updated_at DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      KEY idx_vocabulary_capture_updated (updated_at),
      KEY idx_vocabulary_capture_last_seen (last_seen_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vocabulary_capture_events (
      id VARCHAR(64) NOT NULL,
      document_id VARCHAR(64) NOT NULL,
      source VARCHAR(120) NOT NULL DEFAULT '',
      app_name VARCHAR(120) NOT NULL DEFAULT '',
      package_name VARCHAR(180) NOT NULL DEFAULT '',
      word VARCHAR(80) NOT NULL DEFAULT '',
      text_hash CHAR(64) NOT NULL,
      captured_text TEXT NOT NULL,
      payload_json LONGTEXT NOT NULL,
      captured_at DATETIME(3) NOT NULL,
      received_at DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      KEY idx_vocabulary_capture_document_time (document_id, received_at),
      KEY idx_vocabulary_capture_word_time (word, received_at),
      KEY idx_vocabulary_capture_hash (text_hash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function isoToMysqlDateTime(value: string | null) {
  if (!value) return null;
  return value.replace("T", " ").replace("Z", "").slice(0, 23);
}

export function createVocabularyCaptureService(options: VocabularyCaptureServiceOptions) {
  const configuredPort = options.port ?? Number(process.env.AISTUDY_VOCABULARY_CAPTURE_PORT);
  const port = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : DEFAULT_CAPTURE_PORT;
  let server: Server | null = null;
  let started = false;
  let mirror = createEmptyMirror();
  let pendingEvents: VocabularyCaptureEvent[] = [];
  let receiverError = "";
  let flushPromise: Promise<void> | null = null;
  let tickTimer: NodeJS.Timeout | null = null;
  let lastCompanionLaunchAt = 0;
  let lastHeartbeatLocalWriteAt = 0;

  const mirrorPath = () => options.getDataPath("state", "vocabulary-capture.json");
  const pendingPath = () => options.getDataPath("state", "vocabulary-capture-pending-events.json");

  function getState(): VocabularyCaptureState {
    const now = Date.now();
    const connected = mirror.lastSeenAt
      ? now - new Date(mirror.lastSeenAt).getTime() <= CONNECTION_TTL_MS
      : false;
    const targetActive = connected && mirror.targetActive && mirror.lastTargetActiveAt
      ? now - new Date(mirror.lastTargetActiveAt).getTime() <= CONNECTION_TTL_MS
      : false;
    const serviceStatus = mirror.serviceStatus.trim().toLowerCase();
    const targetStatus = !connected
      ? "waiting"
      : serviceStatus === "permission_required"
        ? "permission_required"
        : targetActive
          ? "capturing"
          : "watching";
    return {
      receiver: {
        status: receiverError ? "error" : "listening",
        port,
        error: receiverError
      },
      connection: {
        status: connected ? "connected" : "waiting",
        targetStatus,
        targetActive,
        lastSeenAt: mirror.lastSeenAt,
        lastTargetActiveAt: mirror.lastTargetActiveAt,
        source: mirror.source,
        appName: mirror.appName,
        packageName: mirror.packageName,
        foregroundPackageName: mirror.foregroundPackageName,
        serviceStatus: mirror.serviceStatus
      },
      document: {
        text: normalizeVocabularyDocumentForState(mirror.documentText),
        eventCount: mirror.eventCount,
        updatedAt: mirror.updatedAt,
        lastEventAt: mirror.lastEventAt
      }
    };
  }

  function broadcastState() {
    const state = getState();
    for (const window of options.getWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("vocabulary-capture:state-changed", state);
      }
    }
  }

  async function writeLocalState() {
    await fs.mkdir(path.dirname(mirrorPath()), { recursive: true });
    await fs.writeFile(mirrorPath(), JSON.stringify(mirror, null, 2), "utf8");
    await fs.writeFile(pendingPath(), JSON.stringify(pendingEvents, null, 2), "utf8");
  }

  async function writeHeartbeatStateIfDue(receivedAt: string) {
    const receivedAtTime = new Date(receivedAt).getTime();
    const now = Number.isFinite(receivedAtTime) ? receivedAtTime : Date.now();
    if (now - lastHeartbeatLocalWriteAt < HEARTBEAT_LOCAL_WRITE_INTERVAL_MS) return;
    lastHeartbeatLocalWriteAt = now;
    await writeLocalState();
  }

  async function loadLocalState() {
    try {
      const content = JSON.parse(await fs.readFile(mirrorPath(), "utf8")) as Partial<VocabularyCaptureMirror>;
      mirror = { ...createEmptyMirror(), ...content };
      mirror.documentText = typeof mirror.documentText === "string" ? mirror.documentText : "";
      mirror.eventCount = Number.isFinite(mirror.eventCount) ? mirror.eventCount : 0;
      mirror.foregroundPackageName = typeof mirror.foregroundPackageName === "string" ? mirror.foregroundPackageName : "";
      mirror.targetActive = mirror.targetActive === true;
      mirror.lastTargetActiveAt = typeof mirror.lastTargetActiveAt === "string" ? mirror.lastTargetActiveAt : null;
      mirror.serviceStatus = typeof mirror.serviceStatus === "string" ? mirror.serviceStatus : "";
    } catch {
      mirror = createEmptyMirror();
    }

    try {
      const content = JSON.parse(await fs.readFile(pendingPath(), "utf8"));
      pendingEvents = Array.isArray(content) ? content.filter((item): item is VocabularyCaptureEvent => (
        item
        && typeof item.id === "string"
        && typeof item.text === "string"
        && typeof item.textHash === "string"
      )) : [];
    } catch {
      pendingEvents = [];
    }
  }

  async function persistMirrorToMysql(pool: Pool) {
    const updatedAt = mirror.updatedAt ?? nowIso();
    await pool.execute(
      `INSERT INTO vocabulary_capture_documents
       (id, document_text, event_count, last_text_hash, last_seen_at, last_event_at, source, app_name, package_name, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         document_text = VALUES(document_text),
         event_count = VALUES(event_count),
         last_text_hash = VALUES(last_text_hash),
         last_seen_at = VALUES(last_seen_at),
         last_event_at = VALUES(last_event_at),
         source = VALUES(source),
         app_name = VALUES(app_name),
         package_name = VALUES(package_name),
         updated_at = VALUES(updated_at)`,
      [
        DOCUMENT_ID,
        mirror.documentText,
        mirror.eventCount,
        mirror.lastTextHash,
        isoToMysqlDateTime(mirror.lastSeenAt),
        isoToMysqlDateTime(mirror.lastEventAt),
        mirror.source,
        mirror.appName,
        mirror.packageName,
        isoToMysqlDateTime(updatedAt)
      ]
    );
  }

  async function persistEventToMysql(pool: Pool, event: VocabularyCaptureEvent) {
    await pool.execute(
      `INSERT INTO vocabulary_capture_events
       (id, document_id, source, app_name, package_name, word, text_hash, captured_text, payload_json, captured_at, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        DOCUMENT_ID,
        event.source,
        event.appName,
        event.packageName,
        event.word,
        event.textHash,
        event.text,
        JSON.stringify(event.payload),
        isoToMysqlDateTime(event.capturedAt),
        isoToMysqlDateTime(event.receivedAt)
      ]
    );
  }

  async function flushPendingToMysql() {
    if (flushPromise) return flushPromise;
    flushPromise = (async () => {
      if (pendingEvents.length === 0) return;
      const runtime = await options.getMysqlRuntime();
      await ensureVocabularyCaptureTables(runtime.pool);
      const remaining: VocabularyCaptureEvent[] = [];
      for (const event of pendingEvents) {
        try {
          await persistEventToMysql(runtime.pool, event);
        } catch {
          remaining.push(event);
        }
      }
      pendingEvents = remaining;
      await persistMirrorToMysql(runtime.pool);
      await writeLocalState();
    })().catch(() => undefined).finally(() => {
      flushPromise = null;
    });
    return flushPromise;
  }

  async function persistAcceptedEvent(event: VocabularyCaptureEvent) {
    try {
      const runtime = await options.getMysqlRuntime();
      await ensureVocabularyCaptureTables(runtime.pool);
      await flushPendingToMysql();
      await persistEventToMysql(runtime.pool, event);
      await persistMirrorToMysql(runtime.pool);
    } catch {
      pendingEvents.push(event);
    } finally {
      await writeLocalState();
    }
  }

  async function acceptPayload(rawPayload: unknown) {
    const payload = normalizePayloadObject(rawPayload);
    const text = normalizeTextFromPayload(payload);
    const receivedAt = nowIso();
    const source = normalizeString(payload.source) || "aistudy-vocabulary-apk";
    const appName = normalizeString(payload.appName);
    const packageName = normalizeString(payload.packageName);
    const foregroundPackageName = normalizeString(payload.foregroundPackageName) || packageName;
    const targetActive = normalizePayloadTargetActive(payload, packageName, foregroundPackageName, appName, text);
    const targetLastActiveAt = normalizeEpochMillisToIso(payload.targetLastActiveAt) ?? receivedAt;
    const serviceStatus = normalizeString(payload.serviceStatus) || (targetActive ? "capturing" : "watching");

    mirror.lastSeenAt = receivedAt;
    mirror.source = source;
    mirror.appName = appName;
    mirror.packageName = packageName;
    mirror.foregroundPackageName = foregroundPackageName;
    mirror.targetActive = targetActive;
    if (targetActive) mirror.lastTargetActiveAt = targetLastActiveAt;
    mirror.serviceStatus = serviceStatus;
    mirror.updatedAt = receivedAt;

    if (!text) {
      await writeHeartbeatStateIfDue(receivedAt);
      broadcastState();
      return { accepted: false, duplicate: false };
    }

    if (hasVocabularyWord(mirror.documentText, text)) {
      await writeLocalState();
      broadcastState();
      void flushPendingToMysql();
      return { accepted: false, duplicate: true };
    }

    const textHash = hashText(text);
    if (textHash === mirror.lastTextHash) {
      await writeLocalState();
      broadcastState();
      void flushPendingToMysql();
      return { accepted: false, duplicate: true };
    }

    const capturedAt = normalizeString(payload.capturedAt) || receivedAt;
    const event: VocabularyCaptureEvent = {
      id: randomUUID(),
      source,
      appName,
      packageName,
      word: text,
      text,
      textHash,
      capturedAt,
      receivedAt,
      payload: readPayloadJson(payload)
    };

    mirror.documentText = appendDocumentBlock(mirror.documentText, text);
    mirror.eventCount += 1;
    mirror.lastTextHash = textHash;
    mirror.lastEventAt = receivedAt;
    mirror.updatedAt = receivedAt;

    await persistAcceptedEvent(event);
    broadcastState();
    return { accepted: true, duplicate: false };
  }

  async function saveDocumentText(rawText: unknown) {
    const nextText = normalizeEditableVocabularyDocument(normalizeString(rawText));
    const words = readVocabularyDocumentWords(nextText);
    const updatedAt = nowIso();
    mirror.documentText = trimDocumentText(nextText);
    mirror.eventCount = words.length;
    mirror.lastTextHash = words.length > 0 ? hashText(words[words.length - 1]) : "";
    mirror.updatedAt = updatedAt;

    try {
      const runtime = await options.getMysqlRuntime();
      await ensureVocabularyCaptureTables(runtime.pool);
      await persistMirrorToMysql(runtime.pool);
    } catch {
      // The local mirror remains the fallback source until MySQL is available again.
    } finally {
      await writeLocalState();
      broadcastState();
    }

    return getState();
  }

  function shouldLaunchCompanionApp() {
    if (!options.launchCompanionApp || receiverError) return false;
    if (mirror.lastSeenAt && Date.now() - new Date(mirror.lastSeenAt).getTime() <= CONNECTION_TTL_MS) return false;
    return Date.now() - lastCompanionLaunchAt >= COMPANION_LAUNCH_INTERVAL_MS;
  }

  function maybeLaunchCompanionApp() {
    if (!shouldLaunchCompanionApp()) return;
    lastCompanionLaunchAt = Date.now();
    void Promise.resolve(options.launchCompanionApp?.()).catch(() => undefined);
  }

  async function handleRequest(request: IncomingMessage, response: ServerResponse) {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
      if (request.method === "GET" && url.pathname === "/vocabulary-capture/state") {
        sendJson(response, 200, { ok: true, state: getState() });
        return;
      }

      if (request.method === "POST" && (url.pathname === "/vocabulary-capture/events" || url.pathname === "/vocabulary-capture/heartbeat")) {
        const payload = await readJsonBody(request);
        const result = await acceptPayload(payload);
        sendJson(response, 200, { ok: true, ...result });
        return;
      }

      sendJson(response, 404, { ok: false });
    } catch {
      sendJson(response, 400, { ok: false });
    }
  }

  return {
    async start() {
      if (started) return;
      started = true;
      await loadLocalState();
      receiverError = "";
      server = createServer((request, response) => {
        void handleRequest(request, response);
      });
      server.on("error", (error) => {
        receiverError = error instanceof Error ? error.message : "receiver error";
        broadcastState();
      });
      server.listen(port, "0.0.0.0", () => {
        receiverError = "";
        broadcastState();
        maybeLaunchCompanionApp();
      });
      tickTimer = setInterval(() => {
        broadcastState();
        void flushPendingToMysql();
        maybeLaunchCompanionApp();
      }, 5000);
      void flushPendingToMysql();
    },
    async stop() {
      if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      if (server) {
        await new Promise<void>((resolve) => server?.close(() => resolve()));
        server = null;
      }
      started = false;
    },
    getState,
    saveDocumentText
  };
}
