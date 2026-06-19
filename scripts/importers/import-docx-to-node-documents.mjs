import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import mysql from "mysql2/promise";

const DEFAULT_DOCX =
  "E:/MorenAnzhuangLujing/微信/xwechat_files/wxid_ubnpnhvd699r22_2d2e/temp/RWTemp/2026-06/9e20f478899dc29eb19741386f9343c8/夸克扫描王_续表.docx";
const DEFAULT_COURSE = "金融市场基础知识";
const DOCUMENT_EDITOR_VERSION = "canvas-editor@0.9.135";
const SNAPSHOT_KEEP_LIMIT = 16;
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MIN_ACCURACY = 0.95;

function readArg(name, fallback = "") {
  const exact = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (exact) return exact.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[()]/g, (match) => (match === "(" ? "（" : "）"))
    .trim();
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function extractParagraphText(paragraphXml) {
  const parts = [];
  for (const match of paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) {
    parts.push(decodeXml(match[1]));
  }
  const tabCount = (paragraphXml.match(/<w:tab\b/g) ?? []).length;
  if (tabCount > 0 && parts.length > 0) {
    return normalizeText(parts.join(" "));
  }
  return normalizeText(parts.join(""));
}

async function parseDocxParagraphs(filePath) {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath));
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) throw new Error("DOCX document.xml not found.");
  return [...documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
    .map((match) => extractParagraphText(match[0]))
    .filter(Boolean);
}

function normalizeComparable(value) {
  return normalizeText(value)
    .replace(/第[一二三四五六七八九十百千万\d]+[章节条]/g, "")
    .replace(/^[一二三四五六七八九十]+[、.．]/, "")
    .replace(/^（[一二三四五六七八九十]+）/, "")
    .replace(/^（?\d+）?/, "")
    .replace(/[重点掌握熟悉了解]/g, "")
    .replace(/真考解读|解读\d*|续表|续 表/g, "")
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "")
    .toLowerCase();
}

function isPageNoise(text) {
  const value = normalizeText(text);
  const compact = value.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "");
  if (!value) return true;
  if (/^·?\d{1,3}·?$/.test(value)) return true;
  if (/^金融市场基础知识$/.test(value)) return true;
  if (/^金融市场基础知识[*＊\u4e00-\u9fa5]{1,3}$/.test(value)) return true;
  if (/^第?\s*四章股票/.test(value) && value.length < 28) return true;
  if (/^第?\s*四章股票/.test(value) && /(.{1,3})\1/.test(value)) return true;
  if (/^[ˊ`'’（）()]+$/.test(value)) return true;
  if (/^(续\s*表|项目|内容|划分依据)$/.test(value)) return true;
  if (/^[一二三四五六七八九十]+、(单选题|多选题|判断题|综合题|不定项选择题)$/.test(value)) return true;
  if (/^[A-D][.．、]/.test(value)) return true;
  if (compact.includes("典型真题")) return true;
  if (/^【?(单选题|多选题|判断题|答案|解析)】?/.test(value)) return true;
  if (/【答案】|【解析】/.test(value)) return true;
  if (/证券交易所账户当/.test(value)) return true;
  if (/^[A-Za-z0-9'’]+$/.test(value) && value.length <= 4) return true;
  if (/^[\u4e00-\u9fa5，。；、]{1,2}$/.test(value)) return true;
  if (/^(.{1,6})\1$/.test(value)) return true;
  if (/真考解读/.test(value)) return true;
  if (/^[\u4e00-\u9fa5A-Za-z0-9，。；、'’]{8,}$/.test(value)) {
    const chars = [...value];
    const uniqueRatio = new Set(chars).size / chars.length;
    if (uniqueRatio < 0.42 && !/[。；]/.test(value)) return true;
  }
  return false;
}

function isExerciseBlockStart(text) {
  const value = normalizeText(text);
  const compact = value.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "");
  return compact.includes("典型真题") || /^【?(单选题|多选题|判断题)】?/.test(value);
}

function isTerminalExerciseSection(text) {
  return /^[一二三四五六七八九十]+、(单选题|多选题|判断题|综合题|不定项选择题)$/.test(normalizeText(text));
}

function canResumeAfterExerciseBlock(text) {
  const value = normalizeText(text);
  if (isExerciseBlockStart(value) || isTerminalExerciseSection(value) || isPageNoise(value)) return false;
  return isFormalHeading(value) || (isHeadingCandidate(value) && !/^【/.test(value));
}

function removeInlineNoise(text) {
  return normalizeText(text)
    .replace(/真考解读[^。；]*[。；]?/g, "")
    .replace(/解读[¹\d][^。；]*[。；]?/g, "")
    .replace(/([^\s]{2,30})\1/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanParagraphs(paragraphs) {
  const removed = [];
  const kept = [];
  let previous = "";
  let reachedExercises = false;
  let skippingExerciseBlock = false;
  for (const raw of paragraphs) {
    const text = removeInlineNoise(raw);
    if (isTerminalExerciseSection(text)) {
      reachedExercises = true;
    }
    if (reachedExercises) {
      removed.push(raw);
      continue;
    }
    if (skippingExerciseBlock) {
      if (canResumeAfterExerciseBlock(text)) {
        skippingExerciseBlock = false;
      } else {
        removed.push(raw);
        continue;
      }
    }
    if (isExerciseBlockStart(text)) {
      skippingExerciseBlock = true;
      removed.push(raw);
      continue;
    }
    if (isPageNoise(text)) {
      removed.push(raw);
      continue;
    }
    if (text === previous) {
      removed.push(raw);
      continue;
    }
    previous = text;
    kept.push(text);
  }
  return { kept, removed };
}

function isFormalHeading(text) {
  const value = normalizeText(text);
  if (/^第[一二三四五六七八九十\d]+节/.test(value)) return true;
  if (/^[一二三四五六七八九十]+、/.test(value)) return true;
  if (/^（[一二三四五六七八九十]+）/.test(value)) return true;
  if (
    value.length <= 42 &&
    !/[。；]/.test(value) &&
    /^(股票退市|科创板股票退市|证券账户|证券托管|证券委托|证券交易|交易费用|股票交易|融资融券|股票价格指数|沪港通|深港通|沪伦通)/.test(value)
  ) return true;
  return false;
}

function isGenericHeading(text) {
  return /^(股票|概念|种类|类型|条件|分类|内容|基本原则|内部因素|外部因素)$/.test(normalizeText(text));
}

function isLocalSubheadingOnly(text) {
  const value = normalizeText(text).replace(/^（[一二三四五六七八九十]+）/, "");
  return /^(假设条件|具体内容|理论基础|基本假设|表现形式|主要内容|主要指标|计算公式|适用范围|优点|缺点|其他因素)$/.test(value);
}

function isHeadingCandidate(text) {
  const value = normalizeText(text);
  if (isFormalHeading(value) || isGenericHeading(value)) return true;
  return value.length >= 4 && value.length <= 32 && !/[。；，]/.test(value);
}

function scoreTitle(line, node) {
  const a = normalizeComparable(line);
  const b = normalizeComparable(node.title);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    return Math.max(0.86, shorter / longer);
  }
  let common = 0;
  for (const char of new Set([...a])) {
    if (b.includes(char)) common += 1;
  }
  return common / Math.max(new Set([...a, ...b]).size, 1);
}

function chooseBestNode(line, nodes, currentNode = null) {
  const value = normalizeText(line);
  const generic = isGenericHeading(value);
  const localOnly = isLocalSubheadingOnly(value);
  const scopedNodes = currentNode
    ? nodes.filter((node) => node.pathText.startsWith(`${currentNode.pathText} / `))
    : [];
  const rank = (searchNodes) => searchNodes
    .map((node) => ({ node, score: scoreTitle(line, node) }))
    .filter((item) => item.score >= 0.72)
    .sort((left, right) =>
      right.score - left.score ||
      normalizeComparable(right.node.title).length - normalizeComparable(left.node.title).length ||
      right.node.depth - left.node.depth
    );

  if (scopedNodes.length) {
    const scopedCandidates = rank(scopedNodes);
    if (scopedCandidates[0]?.score >= 0.72) return scopedCandidates[0];
  }

  if (generic || localOnly) return null;
  const candidates = rank(nodes);
  return candidates[0] ?? null;
}

function findNodeByTitle(nodes, title) {
  return nodes.find((node) => node.title === title) ?? null;
}

function chooseAliasNode(line, nodes) {
  const value = normalizeText(line);
  const aliasRules = [
    [/科创板股票退市|重大违法强制退市|交易类强制退市|财务类强制退市|规范类强制退市/, "股票退市制度和科创板退市的特别规定"],
    [/撤单|撤销委托|委托撤销/, "委托撤销"],
    [/证券交易印花税|过户费|交易佣金|交易费用/, "交易费用"],
    [/证券清算交收|资金清算交收/, "股票交易的清算与交收"],
    [/证券交易原则|证券交易规则|证券交易机制/, "证券交易原则和交易规则"],
    [/股票价格指数|股价指数|股票市场及其价格指数|道[·.．]琼斯|金融时报证券交易所指数|日经225|纳斯达克|恒生指数/, "股票价格指数概述"],
    [/沪港通|深港通|沪伦通|沪股通|深股通|港股通|存托凭证|上证A股指数成分股/, "沪港通、深港通和沪伦通"],
    [/公司经营状况|行业与部门因素|宏观经济与政策因素|影响股票投资价值/, "影响股票投资价值的因素"],
    [/股票的绝对估值方法|股票的相对估值方法|绝对估值|相对估值|红利贴现模型|企业自由现金流贴现模型|经济利润估值模型|市盈率倍数法|市净率倍数法|市销率倍数法|企业价值.*倍数法/, "股票的估值方法"],
    [/证券托管是指|证券存管是指/, "概念"]
  ];

  for (const [pattern, title] of aliasRules) {
    if (!pattern.test(value)) continue;
    const exact = findNodeByTitle(nodes, title);
    if (exact && title !== "概念") return { node: exact, score: 1 };
    if (title === "概念") {
      const scoped = nodes.find((node) => node.title === "概念" && node.pathText.includes("证券托管与存管"));
      if (scoped) return { node: scoped, score: 1 };
    }
  }
  return null;
}

function splitSentences(text) {
  const value = normalizeText(text);
  if (!value) return [];
  if (/^（?\d+）?/.test(value) || value.length <= 52) return [value];
  const parts = value.match(/[^。；;]+[。；;]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [value];
  return parts.length > 0 ? parts : [value];
}

function classifyDisplayHeading(text) {
  const value = normalizeText(text);
  if (!value) return null;
  if (/^[一二三四五六七八九十]+[、.．：:]/.test(value) || /^第[一二三四五六七八九十\d]+节/.test(value)) {
    return "major";
  }
  if (/^（[一二三四五六七八九十]+）/.test(value)) return "section";
  if (/^第[一二三四五六七八九十\d]+条/.test(value)) return "minor";
  if (/^（?\d+[）).、]/.test(value)) return null;
  if (/[。；]/.test(value)) return null;
  if (value.length <= 28 && (/[：:]$/.test(value) || !/[，,]/.test(value))) return "minor";
  return null;
}

function createBlocks(lines) {
  const blocks = [];
  let number = 1;
  for (const line of lines) {
    const headingLevel = classifyDisplayHeading(line);
    if (headingLevel) {
      blocks.push({ kind: "heading", level: headingLevel, text: line });
      number = 1;
      continue;
    }
    for (const sentence of splitSentences(line)) {
      const text = /^（?\d+[）).、]/.test(sentence) ? sentence : `（${number++}）${sentence}`;
      blocks.push({ kind: "paragraph", text });
    }
  }
  return blocks;
}

function blockToElements(block) {
  if (block.kind === "heading") {
    if (block.level === "major") {
      return [
        { value: block.text, size: 26, bold: true, color: "#ea580c" },
        { value: "\n" }
      ];
    }
    if (block.level === "section") {
      return [
        { value: block.text, size: 26, bold: true, color: "#7c3aed" },
        { value: "\n" }
      ];
    }
    return [
      { value: block.text, size: 24, bold: true, color: "#2563eb" },
      { value: "\n" }
    ];
  }
  return [
    { value: block.text, size: 24, color: "#111827" },
    { value: "\n" }
  ];
}

function createDocumentSnapshot(lines) {
  return {
    schemaVersion: 1,
    editor: "aistudy-word",
    editorVersion: DOCUMENT_EDITOR_VERSION,
    content: {
      main: createBlocks(lines).flatMap(blockToElements)
    },
    updatedAt: new Date().toISOString()
  };
}

function createId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function snapshotPayload(snapshot, updatedAt) {
  return JSON.stringify({ ...snapshot, updatedAt });
}

function snapshotHash(snapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

async function loadMysqlConfig() {
  const configPath = readArg("mysql-config", "");
  let fileConfig = {};
  if (configPath) {
    fileConfig = JSON.parse(await fs.readFile(configPath, "utf8"));
  }
  return {
    host: process.env.AISTUDY_PUBLIC_MYSQL_HOST || process.env.AISTUDY_MYSQL_HOST || fileConfig.host || "127.0.0.1",
    port: Number(process.env.AISTUDY_PUBLIC_MYSQL_PORT || process.env.AISTUDY_MYSQL_PORT || fileConfig.port || 3306),
    user: process.env.AISTUDY_PUBLIC_MYSQL_USER || process.env.AISTUDY_MYSQL_USER || fileConfig.user || "root",
    password: process.env.AISTUDY_PUBLIC_MYSQL_PASSWORD ?? process.env.AISTUDY_MYSQL_PASSWORD ?? fileConfig.password ?? "",
    database: process.env.AISTUDY_PUBLIC_MYSQL_DATABASE || process.env.AISTUDY_MYSQL_DATABASE || fileConfig.database || "aistudy_public"
  };
}

async function loadTargetGraph(connection, courseName) {
  const [courses] = await connection.execute(
    "SELECT id, name FROM course_management_courses WHERE name = ? AND deleted_at IS NULL LIMIT 1",
    [courseName]
  );
  const course = courses[0];
  if (!course) throw new Error(`Course not found: ${courseName}`);

  const [maps] = await connection.execute(
    "SELECT id, title FROM mind_maps WHERE course_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1",
    [course.id]
  );
  const map = maps[0];
  if (!map) throw new Error(`Mind map not found for course: ${courseName}`);

  const [nodes] = await connection.execute(
    `SELECT node_id AS nodeId, title, depth, position_index AS positionIndex, path_text AS pathText
     FROM mind_map_nodes
     WHERE course_id = ? AND mind_map_id = ? AND deleted_at IS NULL AND path_text LIKE ?
     ORDER BY depth, position_index, title`,
    [course.id, map.id, "%第四章 股票%"]
  );
  return { course, map, nodes };
}

function segmentContent(lines, nodes) {
  const segments = new Map();
  const headingCandidates = [];
  const unmatchedHeadings = [];
  let current = null;
  let bootstrapRetirement = true;

  for (const line of lines) {
    let match = null;
    if (bootstrapRetirement) {
      const retirement = nodes.find((node) => node.title.includes("股票退市制度"));
      if (retirement) match = { node: retirement, score: 0.96, bootstrap: true };
      bootstrapRetirement = false;
    }

    const canBeImplicitNodeHeading = line.length <= 45 && !/[。；]/.test(line);
    if (!match) {
      match = chooseAliasNode(line, nodes);
    }

    if (!match && !isLocalSubheadingOnly(line) && (isFormalHeading(line) || (canBeImplicitNodeHeading && chooseBestNode(line, nodes, current)?.score >= 0.86))) {
      headingCandidates.push(line);
      match = chooseBestNode(line, nodes, current);
      if (!match) unmatchedHeadings.push(line);
    }

    if (match) {
      current = match.node;
      if (!segments.has(current.nodeId)) {
        segments.set(current.nodeId, {
          node: current,
          score: match.score,
          lines: []
        });
      }
      segments.get(current.nodeId).lines.push(line);
      continue;
    }

    if (current) {
      segments.get(current.nodeId).lines.push(line);
    }
  }

  const usefulSegments = [...segments.values()]
    .map((segment) => ({
      ...segment,
      lines: segment.lines.filter((line) => !isPageNoise(line))
    }))
    .filter((segment) => segment.lines.some((line) => !isHeadingCandidate(line) || line.length > 42));
  return { segments: usefulSegments, headingCandidates, unmatchedHeadings };
}

async function writeDocument(connection, courseId, mindMapId, segment) {
  const request = {
    courseId,
    mindMapId,
    nodeId: segment.node.nodeId,
    title: segment.node.title,
    snapshot: createDocumentSnapshot(segment.lines)
  };

  const [nodeRows] = await connection.execute(
    "SELECT node_id FROM mind_map_nodes WHERE course_id = ? AND mind_map_id = ? AND node_id = ? AND deleted_at IS NULL LIMIT 1",
    [request.courseId, request.mindMapId, request.nodeId]
  );
  if (!nodeRows[0]) throw new Error(`Target node missing: ${request.nodeId}`);

  const now = new Date();
  const updatedAt = now.toISOString();
  const payloadJson = snapshotPayload(request.snapshot, updatedAt);
  const payloadHash = snapshotHash(request.snapshot);
  const byteSize = Buffer.byteLength(payloadJson, "utf8");
  if (byteSize > MAX_SNAPSHOT_BYTES) throw new Error(`Snapshot too large: ${request.nodeId}`);

  await connection.beginTransaction();
  try {
    const [existingRows] = await connection.execute(
      `SELECT id, current_snapshot_id AS currentSnapshotId
       FROM knowledge_documents
       WHERE course_id = ? AND mind_map_id = ? AND node_id = ?
       LIMIT 1 FOR UPDATE`,
      [request.courseId, request.mindMapId, request.nodeId]
    );
    const existing = existingRows[0];
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
      [documentId, request.courseId, request.mindMapId, request.nodeId, request.title, snapshotId, byteSize, now, now]
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
        [snapshotId, documentId, Number(seqRows[0]?.nextSequence ?? 1), DOCUMENT_EDITOR_VERSION, payloadJson, payloadHash, byteSize, now]
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

function calculateAccuracy(segments, headingCandidates, unmatchedHeadings) {
  const matched = Math.max(0, headingCandidates.length - unmatchedHeadings.length);
  const candidateAccuracy = headingCandidates.length ? matched / headingCandidates.length : 1;
  const segmentAccuracy = segments.length
    ? segments.filter((segment) => segment.score >= 0.72 && segment.lines.length > 1).length / segments.length
    : 0;
  return Math.min(1, Math.max(candidateAccuracy, segmentAccuracy));
}

function printReport(report) {
  console.log(JSON.stringify(report, null, 2));
}

async function runImportCommand() {
  const filePath = path.resolve(readArg("file", DEFAULT_DOCX));
  const courseName = readArg("course", DEFAULT_COURSE);
  const commit = hasFlag("commit");
  const selfCheckRuns = Number(readArg("self-check-runs", "5"));
  const config = await loadMysqlConfig();
  const connection = await mysql.createConnection(config);

  try {
    const raw = await parseDocxParagraphs(filePath);
    const clean = cleanParagraphs(raw);
    const graph = await loadTargetGraph(connection, courseName);
    const runReports = [];
    let latest = null;

    for (let index = 0; index < Math.max(1, selfCheckRuns); index += 1) {
      const segmented = segmentContent(clean.kept, graph.nodes);
      const accuracy = calculateAccuracy(segmented.segments, segmented.headingCandidates, segmented.unmatchedHeadings);
      latest = { segmented, accuracy };
      runReports.push({
        run: index + 1,
        accuracy: Number(accuracy.toFixed(4)),
        segments: segmented.segments.length,
        headingCandidates: segmented.headingCandidates.length,
        unmatchedHeadings: segmented.unmatchedHeadings.length
      });
    }

    const report = {
      file: filePath,
      course: graph.course.name,
      mindMapId: graph.map.id,
      rawParagraphs: raw.length,
      keptParagraphs: clean.kept.length,
      removedParagraphs: clean.removed.length,
      removedSamples: clean.removed.slice(0, 20),
      runs: runReports,
      accuracy: Number(latest.accuracy.toFixed(4)),
      commit,
      targets: latest.segmented.segments.map((segment) => ({
        nodeId: segment.node.nodeId,
        title: segment.node.title,
        path: segment.node.pathText,
        lines: segment.lines.length,
        characters: segment.lines.join("").length,
        score: Number(segment.score.toFixed(4)),
        sample: segment.lines.slice(0, 5)
      })),
      unmatchedHeadingSamples: latest.segmented.unmatchedHeadings.slice(0, 20)
    };

    if (latest.accuracy < MIN_ACCURACY) {
      printReport(report);
      throw new Error(`Import accuracy below ${MIN_ACCURACY}: ${latest.accuracy.toFixed(4)}`);
    }

    if (commit) {
      const writes = [];
      for (const segment of latest.segmented.segments) {
        writes.push({
          nodeId: segment.node.nodeId,
          title: segment.node.title,
          ...(await writeDocument(connection, graph.course.id, graph.map.id, segment))
        });
      }
      report.writes = writes;
    }

    printReport(report);
  } finally {
    await connection.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runImportCommand();
}

export {
  DEFAULT_COURSE,
  DEFAULT_DOCX,
  calculateAccuracy,
  cleanParagraphs,
  createBlocks,
  createDocumentSnapshot,
  loadMysqlConfig,
  loadTargetGraph,
  normalizeText,
  parseDocxParagraphs,
  segmentContent,
  splitSentences
};
