import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

export type TextbookMysqlRuntime = {
  pool: Pool;
  textbookAssetTable: string;
  textbookNoteTable: string;
};

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
  snapshot?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type TextbookStore = {
  version: 1;
  assets: TextbookAsset[];
  notes: TextbookNote[];
};

type TextbookAssetRow = RowDataPacket & {
  id: string;
  courseId: string;
  mindMapId: string;
  title: string;
  filePath: string;
  fileName: string;
  byteSize: number | string;
  pageCount: number | string;
  lastPage: number | string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type TextbookNoteRow = RowDataPacket & {
  id: string;
  textbookId: string;
  courseId: string;
  mindMapId: string;
  nodeId: string;
  nodeTitle: string;
  pageNumber: number | string;
  pageStart: number | string;
  pageEnd: number | string;
  content: string;
  snapshotJson: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const TEXTBOOK_STORE_VERSION = 1 as const;
const protocolAssetPaths = new Map<string, string>();

function createId(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function nowIso() {
  return new Date().toISOString();
}

function toIsoTimestamp(value: Date | string) {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? nowIso() : parsed.toISOString();
}

function toMysqlDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeJsonValue(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  return value;
}

function parseJsonValue(value: string | null | undefined) {
  if (!value) return undefined;
  try {
    return normalizeJsonValue(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numberValue)));
}

function createEmptyTextbookStore(): TextbookStore {
  return { version: TEXTBOOK_STORE_VERSION, assets: [], notes: [] };
}

function normalizeAsset(value: unknown, scope?: { courseId: string; mindMapId: string }): TextbookAsset | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<TextbookAsset>;
  const id = normalizeString(candidate.id);
  const courseId = normalizeString(candidate.courseId);
  const mindMapId = normalizeString(candidate.mindMapId);
  const filePath = normalizeString(candidate.filePath);
  if (!id || !courseId || !mindMapId || !filePath) return null;
  if (scope && (courseId !== scope.courseId || mindMapId !== scope.mindMapId)) return null;

  const fileName = normalizeString(candidate.fileName) || path.basename(filePath);
  const title = normalizeString(candidate.title) || path.basename(fileName, path.extname(fileName)) || "教材";
  const pageCount = normalizeInteger(candidate.pageCount, 0, 0, 100000);
  const lastPage = normalizeInteger(candidate.lastPage, 1, 1, pageCount || 100000);
  const createdAt = normalizeString(candidate.createdAt) || nowIso();
  return {
    id,
    courseId,
    mindMapId,
    title,
    filePath,
    fileName,
    byteSize: normalizeInteger(candidate.byteSize, 0, 0, Number.MAX_SAFE_INTEGER),
    pageCount,
    lastPage,
    createdAt,
    updatedAt: normalizeString(candidate.updatedAt) || createdAt
  };
}

function normalizeNote(value: unknown, assetIds: Set<string>, scope?: { courseId: string; mindMapId: string }): TextbookNote | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<TextbookNote>;
  const id = normalizeString(candidate.id);
  const textbookId = normalizeString(candidate.textbookId);
  const courseId = normalizeString(candidate.courseId);
  const mindMapId = normalizeString(candidate.mindMapId);
  const nodeId = normalizeString(candidate.nodeId);
  if (!id || !textbookId || !assetIds.has(textbookId) || !courseId || !mindMapId || !nodeId) return null;
  if (scope && (courseId !== scope.courseId || mindMapId !== scope.mindMapId)) return null;

  const createdAt = normalizeString(candidate.createdAt) || nowIso();
  const pageNumber = normalizeInteger(candidate.pageNumber, 1, 1, 100000);
  const pageStart = normalizeInteger(candidate.pageStart, pageNumber, 1, 100000);
  const pageEnd = normalizeInteger(candidate.pageEnd, pageStart, 1, 100000);
  return {
    id,
    textbookId,
    courseId,
    mindMapId,
    nodeId,
    nodeTitle: normalizeString(candidate.nodeTitle),
    pageNumber,
    pageStart: Math.min(pageStart, pageEnd),
    pageEnd: Math.max(pageStart, pageEnd),
    content: normalizeText(candidate.content),
    snapshot: normalizeJsonValue(candidate.snapshot),
    createdAt,
    updatedAt: normalizeString(candidate.updatedAt) || createdAt
  };
}

export function normalizeTextbookStore(value: unknown, scope?: { courseId: string; mindMapId: string }): TextbookStore {
  if (!value || typeof value !== "object") return createEmptyTextbookStore();
  const candidate = value as Partial<TextbookStore>;
  const assets = Array.isArray(candidate.assets)
    ? candidate.assets.map((asset) => normalizeAsset(asset, scope)).filter((asset): asset is TextbookAsset => Boolean(asset))
    : [];
  const uniqueAssets = Array.from(new Map(assets.map((asset) => [asset.id, asset])).values());
  const assetIds = new Set(uniqueAssets.map((asset) => asset.id));
  const notes = Array.isArray(candidate.notes)
    ? candidate.notes.map((note) => normalizeNote(note, assetIds, scope)).filter((note): note is TextbookNote => Boolean(note))
    : [];
  const uniqueNotes = Array.from(new Map(notes.map((note) => [`${note.textbookId}\u0000${note.nodeId}`, note])).values());
  return { version: TEXTBOOK_STORE_VERSION, assets: uniqueAssets, notes: uniqueNotes };
}

export function textbookStoreHasContent(store: TextbookStore) {
  return store.assets.length > 0 || store.notes.length > 0;
}

export function rememberTextbookAssetPaths(assets: TextbookAsset[]) {
  for (const asset of assets) {
    if (asset.id && asset.filePath) {
      protocolAssetPaths.set(asset.id, asset.filePath);
    }
  }
}

export function resolveTextbookAssetPath(assetId: string) {
  return protocolAssetPaths.get(assetId) ?? null;
}

async function estimatePdfPageCount(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension !== ".pdf") return 0;

  return new Promise<number>((resolve) => {
    let count = 0;
    let carry = "";
    let hasCompressedObjectStreams = false;
    const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk: string | Buffer) => {
      const text = carry + (typeof chunk === "string" ? chunk : chunk.toString("latin1"));
      const matches = text.match(/\/Type\s*\/Page\b/g);
      if (matches) count += matches.length;
      if (!hasCompressedObjectStreams && /\/ObjStm\b/.test(text)) {
        hasCompressedObjectStreams = true;
      }
      carry = text.slice(-32);
    });
    stream.on("error", () => resolve(0));
    stream.on("end", () => resolve(hasCompressedObjectStreams && count <= 4 ? 0 : count));
  });
}

export async function createTextbookAssetFromFile(input: {
  courseId: string;
  mindMapId: string;
  filePath: string;
  title?: string;
}): Promise<TextbookAsset> {
  const filePath = normalizeString(input.filePath);
  if (!filePath || path.extname(filePath).toLowerCase() !== ".pdf") {
    throw new Error("请选择 PDF 文件。");
  }

  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error("请选择 PDF 文件。");
  }

  const timestamp = nowIso();
  const fileName = path.basename(filePath);
  const asset = {
    id: createId("textbook"),
    courseId: normalizeString(input.courseId),
    mindMapId: normalizeString(input.mindMapId),
    title: normalizeString(input.title) || path.basename(fileName, path.extname(fileName)) || "教材",
    filePath,
    fileName,
    byteSize: stat.size,
    pageCount: await estimatePdfPageCount(filePath),
    lastPage: 1,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  rememberTextbookAssetPaths([asset]);
  return asset;
}

async function markMissingRowsDeleted(
  connection: PoolConnection,
  table: string,
  idColumn: string,
  ids: string[],
  scope: { courseId: string; mindMapId: string },
  deletedAt: Date
) {
  if (!ids.length) {
    await connection.execute(
      `UPDATE ${table} SET deleted_at = ? WHERE course_id = ? AND mind_map_id = ? AND deleted_at IS NULL`,
      [deletedAt, scope.courseId, scope.mindMapId]
    );
    return;
  }

  const placeholders = ids.map(() => "?").join(", ");
  await connection.execute(
    `UPDATE ${table} SET deleted_at = ? WHERE course_id = ? AND mind_map_id = ? AND ${idColumn} NOT IN (${placeholders}) AND deleted_at IS NULL`,
    [deletedAt, scope.courseId, scope.mindMapId, ...ids]
  );
}

function rawMysqlIdentifier(escapedIdentifier: string) {
  if (escapedIdentifier.startsWith("`") && escapedIdentifier.endsWith("`")) {
    return escapedIdentifier.slice(1, -1).replaceAll("``", "`");
  }
  return escapedIdentifier;
}

async function hasMysqlColumn(pool: Pool, tableName: string, columnName: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function hasMysqlIndex(pool: Pool, tableName: string, indexName: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );
  return rows.length > 0;
}

async function addMysqlColumnIfMissing(pool: Pool, table: string, tableName: string, columnName: string, definition: string) {
  const existed = await hasMysqlColumn(pool, tableName, columnName);
  if (!existed) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
  return existed;
}

async function addMysqlIndexIfMissing(pool: Pool, table: string, tableName: string, indexName: string, definition: string) {
  if (await hasMysqlIndex(pool, tableName, indexName)) return;
  await pool.query(`ALTER TABLE ${table} ADD ${definition}`);
}

export async function ensureTextbookTables(pool: Pool, assetTable: string, noteTable: string) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${assetTable} (
      id VARCHAR(64) NOT NULL,
      course_id VARCHAR(64) NOT NULL,
      mind_map_id VARCHAR(64) NOT NULL,
      title VARCHAR(255) NOT NULL,
      file_path VARCHAR(2048) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      byte_size BIGINT NOT NULL DEFAULT 0,
      page_count INT NOT NULL DEFAULT 0,
      last_page INT NOT NULL DEFAULT 1,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (id),
      KEY idx_textbook_asset_scope (course_id, mind_map_id, updated_at),
      KEY idx_textbook_asset_deleted (deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${noteTable} (
      id VARCHAR(64) NOT NULL,
      textbook_id VARCHAR(64) NOT NULL,
      course_id VARCHAR(64) NOT NULL,
      mind_map_id VARCHAR(64) NOT NULL,
      node_id VARCHAR(96) NOT NULL,
      node_title VARCHAR(255) NOT NULL,
      page_number INT NOT NULL DEFAULT 1,
      page_start INT NOT NULL DEFAULT 1,
      page_end INT NOT NULL DEFAULT 1,
      content LONGTEXT NOT NULL,
      snapshot_json LONGTEXT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_textbook_note_node (textbook_id, node_id),
      KEY idx_textbook_note_scope (course_id, mind_map_id, node_id, updated_at),
      KEY idx_textbook_note_asset (textbook_id, page_number),
      KEY idx_textbook_note_range (textbook_id, page_start, page_end),
      KEY idx_textbook_note_deleted (deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const noteTableName = rawMysqlIdentifier(noteTable);
  const hadPageStart = await addMysqlColumnIfMissing(pool, noteTable, noteTableName, "page_start", "`page_start` INT NOT NULL DEFAULT 1 AFTER `page_number`");
  const hadPageEnd = await addMysqlColumnIfMissing(pool, noteTable, noteTableName, "page_end", "`page_end` INT NOT NULL DEFAULT 1 AFTER `page_start`");
  await addMysqlColumnIfMissing(pool, noteTable, noteTableName, "snapshot_json", "`snapshot_json` LONGTEXT NULL AFTER `content`");
  if (!hadPageStart || !hadPageEnd) {
    await pool.query(`UPDATE ${noteTable} SET page_start = page_number, page_end = page_number WHERE page_number > 0`);
  }
  await addMysqlIndexIfMissing(pool, noteTable, noteTableName, "idx_textbook_note_range", "KEY idx_textbook_note_range (textbook_id, page_start, page_end)");
}

export async function readTextbookStoreFromMysql(
  runtime: TextbookMysqlRuntime,
  scope: { courseId: string; mindMapId: string }
): Promise<TextbookStore> {
  const [assetRows] = await runtime.pool.execute<TextbookAssetRow[]>(
    `SELECT id, course_id AS courseId, mind_map_id AS mindMapId, title, file_path AS filePath, file_name AS fileName,
            byte_size AS byteSize, page_count AS pageCount, last_page AS lastPage, created_at AS createdAt, updated_at AS updatedAt
     FROM ${runtime.textbookAssetTable}
     WHERE course_id = ? AND mind_map_id = ? AND deleted_at IS NULL
     ORDER BY updated_at DESC`,
    [scope.courseId, scope.mindMapId]
  );
  const assets = assetRows.map((row) => normalizeAsset({
    id: row.id,
    courseId: row.courseId,
    mindMapId: row.mindMapId,
    title: row.title,
    filePath: row.filePath,
    fileName: row.fileName,
    byteSize: row.byteSize,
    pageCount: row.pageCount,
    lastPage: row.lastPage,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt)
  }, scope)).filter((asset): asset is TextbookAsset => Boolean(asset));

  const [noteRows] = await runtime.pool.execute<TextbookNoteRow[]>(
    `SELECT id, textbook_id AS textbookId, course_id AS courseId, mind_map_id AS mindMapId, node_id AS nodeId,
            node_title AS nodeTitle, page_number AS pageNumber, page_start AS pageStart, page_end AS pageEnd,
            content, snapshot_json AS snapshotJson, created_at AS createdAt, updated_at AS updatedAt
     FROM ${runtime.textbookNoteTable}
     WHERE course_id = ? AND mind_map_id = ? AND deleted_at IS NULL
     ORDER BY updated_at DESC`,
    [scope.courseId, scope.mindMapId]
  );
  const assetIds = new Set(assets.map((asset) => asset.id));
  const notes = noteRows.map((row) => normalizeNote({
    id: row.id,
    textbookId: row.textbookId,
    courseId: row.courseId,
    mindMapId: row.mindMapId,
    nodeId: row.nodeId,
    nodeTitle: row.nodeTitle,
    pageNumber: row.pageNumber,
    pageStart: row.pageStart,
    pageEnd: row.pageEnd,
    content: row.content,
    snapshot: parseJsonValue(row.snapshotJson),
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt)
  }, assetIds, scope)).filter((note): note is TextbookNote => Boolean(note));

  const store = normalizeTextbookStore({ version: TEXTBOOK_STORE_VERSION, assets, notes }, scope);
  rememberTextbookAssetPaths(store.assets);
  return store;
}

export async function writeTextbookStoreToMysql(
  runtime: TextbookMysqlRuntime,
  value: unknown,
  scope: { courseId: string; mindMapId: string }
): Promise<TextbookStore> {
  const store = normalizeTextbookStore(value, scope);
  const now = new Date();
  const connection = await runtime.pool.getConnection();
  try {
    await connection.beginTransaction();
    await markMissingRowsDeleted(connection, runtime.textbookAssetTable, "id", store.assets.map((asset) => asset.id), scope, now);
    await markMissingRowsDeleted(connection, runtime.textbookNoteTable, "id", store.notes.map((note) => note.id), scope, now);

    for (const asset of store.assets) {
      await connection.execute(
        `INSERT INTO ${runtime.textbookAssetTable}
          (id, course_id, mind_map_id, title, file_path, file_name, byte_size, page_count, last_page, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON DUPLICATE KEY UPDATE
          course_id = VALUES(course_id), mind_map_id = VALUES(mind_map_id),
          title = VALUES(title), file_path = VALUES(file_path), file_name = VALUES(file_name),
          byte_size = VALUES(byte_size), page_count = VALUES(page_count), last_page = VALUES(last_page),
          updated_at = VALUES(updated_at), deleted_at = NULL`,
        [
          asset.id,
          asset.courseId,
          asset.mindMapId,
          asset.title,
          asset.filePath,
          asset.fileName,
          asset.byteSize,
          asset.pageCount,
          asset.lastPage,
          toMysqlDate(asset.createdAt),
          toMysqlDate(asset.updatedAt)
        ]
      );
    }

    for (const note of store.notes) {
      await connection.execute(
        `INSERT INTO ${runtime.textbookNoteTable}
          (id, textbook_id, course_id, mind_map_id, node_id, node_title, page_number, page_start, page_end, content, snapshot_json, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON DUPLICATE KEY UPDATE
          textbook_id = VALUES(textbook_id), course_id = VALUES(course_id), mind_map_id = VALUES(mind_map_id),
          node_title = VALUES(node_title), page_number = VALUES(page_number),
          page_start = VALUES(page_start), page_end = VALUES(page_end), content = VALUES(content), snapshot_json = VALUES(snapshot_json),
          updated_at = VALUES(updated_at), deleted_at = NULL`,
        [
          note.id,
          note.textbookId,
          note.courseId,
          note.mindMapId,
          note.nodeId,
          note.nodeTitle,
          note.pageNumber,
          note.pageStart,
          note.pageEnd,
          note.content,
          note.snapshot ? JSON.stringify(note.snapshot) : null,
          toMysqlDate(note.createdAt),
          toMysqlDate(note.updatedAt)
        ]
      );
    }

    await connection.commit();
    rememberTextbookAssetPaths(store.assets);
    return store;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
