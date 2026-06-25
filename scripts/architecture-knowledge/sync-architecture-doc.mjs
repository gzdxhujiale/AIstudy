import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

const DEFAULT_COURSE_NAME = "AIstudy 全量功能架构";
const DEFAULT_EDITOR_VERSION = "canvas-editor@0.9.135";
const SNAPSHOT_KEEP_LIMIT = 30;
const MAX_SNAPSHOT_BYTES = 1024 * 1024;

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function usage() {
  return `AIstudy architecture knowledge sync

Usage:
  npm run arch:knowledge:index
  npm run arch:knowledge:sync -- --file="docs/architecture-knowledge/templates/feature-doc.md" --node-id="arch_11_updates" --commit

Options:
  --course="AIstudy 全量功能架构"     Target course name.
  --node-id="..."                    Exact mind-map node id.
  --node-title="..."                 Exact or unique fuzzy node title.
  --file="path/to/doc.md"            Markdown source to sync.
  --title="..."                      Document title. Defaults to the target node title.
  --append                           Append to the current node document instead of replacing it.
  --commit                           Write to MySQL. Omit for dry-run.
  --list                             Print all target nodes.
  --search="keyword"                 Print matching target nodes.
  --write-index="path.md"            Generate a markdown node index.
  --mysql-config="path.json"         Optional MySQL config file.
`;
}

function createId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

async function loadMysqlConfig() {
  const configPath = readArg("mysql-config", "");
  let fileConfig = {};
  if (configPath) {
    fileConfig = JSON.parse(await fs.readFile(configPath, "utf8"));
  }
  return {
    host: process.env.AISTUDY_ARCH_MYSQL_HOST || process.env.AISTUDY_MYSQL_HOST || fileConfig.host || "127.0.0.1",
    port: Number(process.env.AISTUDY_ARCH_MYSQL_PORT || process.env.AISTUDY_MYSQL_PORT || fileConfig.port || 3306),
    user: process.env.AISTUDY_ARCH_MYSQL_USER || process.env.AISTUDY_MYSQL_USER || fileConfig.user || "root",
    password: process.env.AISTUDY_ARCH_MYSQL_PASSWORD ?? process.env.AISTUDY_MYSQL_PASSWORD ?? fileConfig.password ?? "",
    database: "aistudy_public"
  };
}

async function loadTargetGraph(connection, courseName) {
  const [courses] = await connection.execute(
    `SELECT id, name, description
     FROM course_management_courses
     WHERE name = ? AND deleted_at IS NULL
     LIMIT 1`,
    [courseName]
  );
  const course = courses[0];
  if (!course) throw new Error(`Architecture knowledge course not found: ${courseName}`);

  const [maps] = await connection.execute(
    `SELECT id, title
     FROM mind_maps
     WHERE course_id = ? AND deleted_at IS NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
    [course.id]
  );
  const map = maps[0];
  if (!map) throw new Error(`Mind map not found for course: ${courseName}`);

  const [nodes] = await connection.execute(
    `SELECT node_id AS nodeId, parent_node_id AS parentNodeId, title, depth, position_index AS positionIndex, path_text AS pathText
     FROM mind_map_nodes
     WHERE course_id = ? AND mind_map_id = ? AND deleted_at IS NULL
     ORDER BY depth ASC, COALESCE(parent_node_id, ''), position_index ASC, title ASC`,
    [course.id, map.id]
  );
  return { course, map, nodes };
}

function findTargetNode(nodes) {
  const nodeId = readArg("node-id", "");
  const nodeTitle = readArg("node-title", "");
  if (nodeId) {
    const node = nodes.find((item) => item.nodeId === nodeId);
    if (!node) throw new Error(`Target node id not found: ${nodeId}`);
    return node;
  }
  if (nodeTitle) {
    const exact = nodes.filter((item) => item.title === nodeTitle);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) throw new Error(`Node title is not unique: ${nodeTitle}`);
    const fuzzy = nodes.filter((item) => item.title.includes(nodeTitle) || item.pathText?.includes(nodeTitle));
    if (fuzzy.length === 1) return fuzzy[0];
    if (fuzzy.length > 1) {
      const candidates = fuzzy.slice(0, 20).map((item) => `- ${item.title} (${item.nodeId})`).join("\n");
      throw new Error(`Node title matched multiple nodes: ${nodeTitle}\n${candidates}`);
    }
    throw new Error(`Target node title not found: ${nodeTitle}`);
  }
  throw new Error("Missing --node-id or --node-title.");
}

function markdownLineToElements(line) {
  if (!line.trim()) return [{ value: "\n" }];

  const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const palette = {
      1: { size: 28, color: "#0f172a" },
      2: { size: 26, color: "#2563eb" },
      3: { size: 24, color: "#7c3aed" },
      4: { size: 22, color: "#0f766e" }
    };
    return [
      { value: `${headingMatch[2]}\n`, size: palette[level].size, bold: true, color: palette[level].color }
    ];
  }

  const bulletMatch = line.match(/^[-*]\s+(.+)$/);
  if (bulletMatch) {
    return [
      { value: `- ${bulletMatch[1]}\n`, size: 22, color: "#1f2937" }
    ];
  }

  const orderedMatch = line.match(/^(\d+[.)])\s+(.+)$/);
  if (orderedMatch) {
    return [
      { value: `${orderedMatch[1]} ${orderedMatch[2]}\n`, size: 22, color: "#1f2937" }
    ];
  }

  return [{ value: `${line}\n`, size: 22, color: "#111827" }];
}

function markdownToSnapshot(markdown, title) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const main = [
    { value: "" },
    { value: `${title}\n\n`, size: 28, bold: true, color: "#111827" },
    ...lines.flatMap(markdownLineToElements)
  ];
  return {
    schemaVersion: 1,
    editor: "aistudy-word",
    editorVersion: DEFAULT_EDITOR_VERSION,
    content: {
      header: [],
      main,
      footer: [],
      graffiti: []
    },
    updatedAt: new Date().toISOString()
  };
}

function snapshotPayload(snapshot, updatedAt) {
  return JSON.stringify({ ...snapshot, updatedAt });
}

function snapshotHash(snapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

async function loadCurrentSnapshot(connection, documentId, snapshotId) {
  if (!documentId || !snapshotId) return null;
  const [rows] = await connection.execute(
    `SELECT payload_json AS payloadJson
     FROM knowledge_document_snapshots
     WHERE id = ? AND document_id = ?
     LIMIT 1`,
    [snapshotId, documentId]
  );
  if (!rows[0]?.payloadJson) return null;
  return JSON.parse(rows[0].payloadJson);
}

async function createSnapshotForWrite(connection, document, sourceMarkdown, title) {
  const nextSnapshot = markdownToSnapshot(sourceMarkdown, title);
  if (!hasFlag("append") || !document?.id || !document?.currentSnapshotId) {
    return nextSnapshot;
  }

  const current = await loadCurrentSnapshot(connection, document.id, document.currentSnapshotId);
  if (!current?.content?.main || !Array.isArray(current.content.main)) {
    return nextSnapshot;
  }

  return {
    ...nextSnapshot,
    content: {
      header: [],
      main: [
        ...current.content.main,
        { value: "\n\n" },
        { value: `追加记录 - ${new Date().toISOString()}\n`, size: 22, bold: true, color: "#64748b" },
        ...nextSnapshot.content.main.slice(2)
      ],
      footer: [],
      graffiti: []
    }
  };
}

async function writeDocument(connection, target, sourceMarkdown, title) {
  const now = new Date();
  const [nodeRows] = await connection.execute(
    `SELECT node_id
     FROM mind_map_nodes
     WHERE course_id = ? AND mind_map_id = ? AND node_id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [target.courseId, target.mindMapId, target.node.nodeId]
  );
  if (!nodeRows[0]) throw new Error(`Target node missing: ${target.node.nodeId}`);

  await connection.beginTransaction();
  try {
    const [existingRows] = await connection.execute(
      `SELECT id, current_snapshot_id AS currentSnapshotId
       FROM knowledge_documents
       WHERE course_id = ? AND mind_map_id = ? AND node_id = ?
       LIMIT 1 FOR UPDATE`,
      [target.courseId, target.mindMapId, target.node.nodeId]
    );
    const existing = existingRows[0] ?? null;
    const snapshot = await createSnapshotForWrite(connection, existing, sourceMarkdown, title);
    const updatedAt = now.toISOString();
    const payloadJson = snapshotPayload(snapshot, updatedAt);
    const payloadHash = snapshotHash(snapshot);
    const byteSize = Buffer.byteLength(payloadJson, "utf8");
    if (byteSize > MAX_SNAPSHOT_BYTES) throw new Error(`Snapshot too large: ${byteSize} bytes`);

    const documentId = existing?.id ?? createId("kdoc");
    let shouldReuse = false;
    if (existing?.currentSnapshotId) {
      const [metaRows] = await connection.execute(
        "SELECT payload_hash AS payloadHash FROM knowledge_document_snapshots WHERE id = ? AND document_id = ? LIMIT 1",
        [existing.currentSnapshotId, documentId]
      );
      shouldReuse = metaRows[0]?.payloadHash === payloadHash;
    }
    const snapshotId = shouldReuse && existing?.currentSnapshotId ? existing.currentSnapshotId : createId("kdocsnap");

    await connection.execute(
      `INSERT INTO knowledge_documents
        (id, course_id, mind_map_id, node_id, title, current_snapshot_id, current_byte_size, has_content, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        current_snapshot_id = VALUES(current_snapshot_id),
        current_byte_size = VALUES(current_byte_size),
        has_content = VALUES(has_content),
        updated_at = VALUES(updated_at),
        deleted_at = NULL`,
      [documentId, target.courseId, target.mindMapId, target.node.nodeId, title, snapshotId, byteSize, now, now]
    );

    if (!shouldReuse) {
      const [seqRows] = await connection.execute(
        "SELECT COALESCE(MAX(sequence_no), 0) + 1 AS nextSequence FROM knowledge_document_snapshots WHERE document_id = ? FOR UPDATE",
        [documentId]
      );
      await connection.execute(
        `INSERT INTO knowledge_document_snapshots
          (id, document_id, sequence_no, schema_version, editor, editor_version, payload_json, payload_hash, byte_size, created_at)
         VALUES (?, ?, ?, 1, 'aistudy-word', ?, ?, ?, ?, ?)`,
        [snapshotId, documentId, Number(seqRows[0]?.nextSequence ?? 1), DEFAULT_EDITOR_VERSION, payloadJson, payloadHash, byteSize, now]
      );
      await connection.execute(
        `DELETE FROM knowledge_document_snapshots
         WHERE document_id = ?
           AND id NOT IN (
             SELECT id FROM (
               SELECT id FROM knowledge_document_snapshots
               WHERE document_id = ?
               ORDER BY sequence_no DESC
               LIMIT ${SNAPSHOT_KEEP_LIMIT}
             ) retained
           )`,
        [documentId, documentId]
      );
    }

    await connection.commit();
    return { documentId, snapshotId, byteSize, reused: shouldReuse };
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

function formatNodeLine(node) {
  return `${"  ".repeat(Number(node.depth) || 0)}- ${node.title} [${node.nodeId}]`;
}

async function writeIndexFile(indexPath, graph) {
  const lines = [
    "# AIstudy 全量功能架构节点索引",
    "",
    `- course_id: \`${graph.course.id}\``,
    `- mind_map_id: \`${graph.map.id}\``,
    `- generated_at: \`${new Date().toISOString()}\``,
    "",
    "## Nodes",
    "",
    ...graph.nodes.map((node) => formatNodeLine(node))
  ];
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  if (hasFlag("help")) {
    console.log(usage());
    return;
  }

  const config = await loadMysqlConfig();
  const connection = await mysql.createConnection(config);
  try {
    const courseName = readArg("course", DEFAULT_COURSE_NAME);
    const graph = await loadTargetGraph(connection, courseName);

    const search = readArg("search", "");
    if (hasFlag("list") || search) {
      const nodes = search
        ? graph.nodes.filter((node) => node.title.includes(search) || node.pathText?.includes(search) || node.nodeId.includes(search))
        : graph.nodes;
      console.log(`Course: ${graph.course.name} (${graph.course.id})`);
      console.log(`Mind map: ${graph.map.title} (${graph.map.id})`);
      console.log(`Nodes: ${nodes.length}`);
      for (const node of nodes) console.log(formatNodeLine(node));
      return;
    }

    const writeIndex = readArg("write-index", "");
    if (writeIndex) {
      await writeIndexFile(path.resolve(writeIndex), graph);
      console.log(`Architecture node index written: ${path.resolve(writeIndex)}`);
      return;
    }

    const filePath = readArg("file", "");
    if (!filePath) throw new Error("Missing --file. Use --help for examples.");
    const sourceMarkdown = await fs.readFile(filePath, "utf8");
    const node = findTargetNode(graph.nodes);
    const title = readArg("title", node.title);
    const target = {
      courseId: graph.course.id,
      mindMapId: graph.map.id,
      node
    };

    const dryRunSnapshot = markdownToSnapshot(sourceMarkdown, title);
    const dryRunPayload = snapshotPayload(dryRunSnapshot, new Date().toISOString());
    console.log(JSON.stringify({
      mode: hasFlag("commit") ? "commit" : "dry-run",
      course: { id: graph.course.id, name: graph.course.name },
      mindMap: { id: graph.map.id, title: graph.map.title },
      node: { id: node.nodeId, title: node.title, path: node.pathText },
      title,
      append: hasFlag("append"),
      sourceFile: path.resolve(filePath),
      estimatedByteSize: Buffer.byteLength(dryRunPayload, "utf8")
    }, null, 2));

    if (!hasFlag("commit")) {
      console.log("Dry-run only. Re-run with --commit to write the document snapshot.");
      return;
    }

    const result = await writeDocument(connection, target, sourceMarkdown, title);
    console.log(JSON.stringify({ written: true, ...result }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
