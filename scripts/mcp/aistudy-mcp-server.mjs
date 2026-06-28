#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { Socket } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import mysql from "mysql2/promise";

const SCHEMA_VERSION = 1;
const MINDMAP_EDITOR = "simple-mind-map";
const DEFAULT_LAYOUT = "logicalStructure";
const DOCUMENT_EDITOR = "aistudy-word";
const DOCUMENT_EDITOR_VERSION = "mcp-text";
const PUBLIC_MYSQL_DATABASE = "aistudy_public";
const PUBLIC_MYSQL_TABLES = {
  courses: "course_management_courses",
  sections: "knowledge_sections",
  mindMaps: "mind_maps",
  mindMapSnapshots: "mind_map_snapshots",
  mindMapNodes: "mind_map_nodes",
  documents: "knowledge_documents",
  documentSnapshots: "knowledge_document_snapshots"
};
const MINDMAP_LAYOUTS = new Set([
  "logicalStructure",
  "logicalStructureLeft",
  "mindMap",
  "organizationStructure",
  "catalogOrganization",
  "timeline",
  "verticalTimeline",
  "fishbone",
  "rightFishbone"
]);
const execFileAsync = promisify(execFile);
const chromePortDefinitions = [
  { id: "doubao", name: "豆包", port: 9224, loginUrl: "https://www.doubao.com/chat/", hostKeyword: "doubao.com/chat" },
  { id: "chatgpt", name: "ChatGPT", port: 9230, loginUrl: "https://chatgpt.com/", hostKeyword: "chatgpt.com" },
  { id: "bilibili", name: "Bilibili", port: 9231, loginUrl: "https://www.bilibili.com/", hostKeyword: "bilibili.com" },
  { id: "zhihu", name: "知乎", port: 9232, loginUrl: "https://www.zhihu.com/", hostKeyword: "zhihu.com" },
  { id: "zhaopin", name: "智联招聘", port: 9233, loginUrl: "https://www.zhaopin.com/", hostKeyword: "zhaopin.com" },
  { id: "zhipin", name: "BOSS直聘", port: 9234, loginUrl: "https://www.zhipin.com/", hostKeyword: "zhipin.com" }
];

const toolDefinitions = [
  {
    name: "mcp_get_started",
    mode: "control",
    description: "Start here. Returns health, library scope, safety rules, resources, prompts, and the recommended next MCP calls.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, properties: {} }
  },
  {
    name: "mcp_plan_task",
    mode: "control",
    description: "Turn a user intent into an ordered AIstudy MCP tool plan before reading or editing.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        intent: { type: "string", maxLength: 500 },
        targetName: { type: "string", maxLength: 120 },
        courseId: { type: "string", maxLength: 120 },
        nodeQuery: { type: "string", maxLength: 120 },
        allowEdit: { type: "boolean" }
      }
    }
  },
  {
    name: "mcp_resolve_target",
    mode: "read",
    description: "Resolve a course and optional node candidates from courseName, courseId, or nodeQuery. Use this before scoped reads or edits.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        courseName: { type: "string", maxLength: 120 },
        courseId: { type: "string", maxLength: 120 },
        nodeQuery: { type: "string", maxLength: 120 },
        includeDocuments: { type: "boolean" }
      }
    }
  },
  {
    name: "read_courses",
    mode: "read",
    description: "Step 1: read all AIstudy sections and knowledge bases. Use courseId from this result for scoped operations.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, properties: {} }
  },
  {
    name: "create_course",
    mode: "edit",
    description: "Create a knowledge base. Requires AISTUDY_MCP_ALLOW_EDIT=1.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", maxLength: 80 }, description: { type: "string", maxLength: 500 }, sectionId: { type: ["string", "null"], maxLength: 120 } } }
  },
  {
    name: "rename_course",
    mode: "edit",
    description: "Rename or describe a knowledge base. Requires courseId and AISTUDY_MCP_ALLOW_EDIT=1.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, required: ["courseId", "name"], properties: { courseId: { type: "string", maxLength: 120 }, name: { type: "string", maxLength: 80 }, description: { type: "string", maxLength: 500 } } }
  },
  {
    name: "move_course",
    mode: "edit",
    description: "Move a knowledge base to another section or before another course. Requires AISTUDY_MCP_ALLOW_EDIT=1.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, required: ["courseId"], properties: { courseId: { type: "string", maxLength: 120 }, sectionId: { type: ["string", "null"], maxLength: 120 }, beforeCourseId: { type: ["string", "null"], maxLength: 120 } } }
  },
  {
    name: "delete_course",
    mode: "edit",
    description: "Delete a knowledge base. Requires AISTUDY_MCP_ALLOW_EDIT=1.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, required: ["courseId"], properties: { courseId: { type: "string", maxLength: 120 } } }
  },
  {
    name: "create_course_section",
    mode: "edit",
    description: "Create a knowledge-base section. Requires AISTUDY_MCP_ALLOW_EDIT=1.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", maxLength: 80 } } }
  },
  {
    name: "rename_course_section",
    mode: "edit",
    description: "Rename a knowledge-base section. Requires AISTUDY_MCP_ALLOW_EDIT=1.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, required: ["sectionId", "name"], properties: { sectionId: { type: "string", maxLength: 120 }, name: { type: "string", maxLength: 80 } } }
  },
  {
    name: "move_course_section",
    mode: "edit",
    description: "Move a knowledge-base section before another section. Requires AISTUDY_MCP_ALLOW_EDIT=1.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, required: ["sectionId"], properties: { sectionId: { type: "string", maxLength: 120 }, beforeSectionId: { type: ["string", "null"], maxLength: 120 } } }
  },
  {
    name: "delete_course_section",
    mode: "edit",
    description: "Delete a section and move its courses to unsectioned. Requires AISTUDY_MCP_ALLOW_EDIT=1.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, required: ["sectionId"], properties: { sectionId: { type: "string", maxLength: 120 } } }
  },
  {
    name: "read_current_mindmap",
    mode: "read",
    description: "Read mind maps. Without courseId it returns all knowledge-base map summaries; with courseId it returns that map.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { courseId: { type: "string", maxLength: 120 } }
    }
  },
  {
    name: "search_nodes",
    mode: "read",
    description: "Search mind-map nodes. Without courseId it searches all knowledge bases; with courseId it searches that map.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        courseId: { type: "string", maxLength: 120 },
        query: { type: "string", maxLength: 120 }
      }
    }
  },
  {
    name: "append_mindmap_node",
    mode: "edit",
    description: "Controlled edit tool. Requires courseId and AISTUDY_MCP_ALLOW_EDIT=1, then appends a node to that map root.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        courseId: { type: "string", maxLength: 120 },
        title: { type: "string", maxLength: 120 }
      }
    }
  },
  {
    name: "create_mindmap_node",
    mode: "edit",
    description: "Create a node under parentNodeId, or under the root if parentNodeId is omitted. Requires courseId and AISTUDY_MCP_ALLOW_EDIT=1.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, required: ["courseId", "title"], properties: { courseId: { type: "string", maxLength: 120 }, parentNodeId: { type: "string", maxLength: 120 }, title: { type: "string", maxLength: 255 }, position: { type: "integer", minimum: 0, maximum: 10000 } } }
  },
  {
    name: "update_mindmap_node_text",
    mode: "edit",
    description: "Update a mind-map node title. Requires courseId, nodeId and AISTUDY_MCP_ALLOW_EDIT=1.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, required: ["courseId", "nodeId", "title"], properties: { courseId: { type: "string", maxLength: 120 }, nodeId: { type: "string", maxLength: 120 }, title: { type: "string", maxLength: 255 } } }
  },
  {
    name: "move_mindmap_node",
    mode: "edit",
    description: "Move a node under targetParentNodeId. Requires AISTUDY_MCP_ALLOW_EDIT=1.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, required: ["courseId", "nodeId", "targetParentNodeId"], properties: { courseId: { type: "string", maxLength: 120 }, nodeId: { type: "string", maxLength: 120 }, targetParentNodeId: { type: "string", maxLength: 120 }, position: { type: "integer", minimum: 0, maximum: 10000 } } }
  },
  {
    name: "delete_mindmap_node",
    mode: "edit",
    description: "Delete a node and its children. Requires AISTUDY_MCP_ALLOW_EDIT=1.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, required: ["courseId", "nodeId"], properties: { courseId: { type: "string", maxLength: 120 }, nodeId: { type: "string", maxLength: 120 } } }
  },
  {
    name: "update_mindmap_node_style",
    mode: "edit",
    description: "Apply node text style such as color, fontSize, fontWeight, fontStyle, textDecoration, textAutoWrapWidth.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, required: ["courseId", "nodeId"], properties: { courseId: { type: "string", maxLength: 120 }, nodeId: { type: "string", maxLength: 120 }, color: { type: "string", maxLength: 32 }, fontSize: { type: "integer", minimum: 10, maximum: 72 }, fontWeight: { type: "string" }, fontStyle: { type: "string" }, textDecoration: { type: "string" }, textAutoWrapWidth: { type: "integer", minimum: 80, maximum: 1200 } } }
  },
  {
    name: "update_mindmap_layout",
    mode: "edit",
    description: "Update the mind-map layout for a knowledge base. Requires courseId and AISTUDY_MCP_ALLOW_EDIT=1.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, required: ["courseId", "layout"], properties: { courseId: { type: "string", maxLength: 120 }, layout: { type: "string" } } }
  },
  {
    name: "list_node_documents",
    mode: "read",
    description: "List saved node documents. Without courseId it lists across all knowledge bases.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, properties: { courseId: { type: "string", maxLength: 120 } } }
  },
  {
    name: "read_node_document",
    mode: "read",
    description: "Read a node document by courseId and nodeId. mindMapId is optional and defaults to the latest map in the course.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, required: ["courseId", "nodeId"], properties: { courseId: { type: "string", maxLength: 120 }, mindMapId: { type: "string", maxLength: 120 }, nodeId: { type: "string", maxLength: 120 } } }
  },
  {
    name: "write_node_document",
    mode: "edit",
    description: "Create a node document from clean plain text or Markdown headings. If the node already has content, this refuses to overwrite unless replaceExisting=true is explicitly passed. Do not use this for formatting-only changes. Requires AISTUDY_MCP_ALLOW_EDIT=1.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, required: ["courseId", "nodeId"], properties: { courseId: { type: "string", maxLength: 120 }, mindMapId: { type: "string", maxLength: 120 }, nodeId: { type: "string", maxLength: 120 }, title: { type: "string", maxLength: 255 }, text: { type: "string", maxLength: 20000 }, replaceExisting: { type: "boolean", description: "Required as true to overwrite an existing non-empty document." }, snapshot: { type: "object", description: "Advanced: only pass a snapshot previously returned by read_node_document. Arbitrary handcrafted editor fragments are normalized." } } }
  },
  {
    name: "append_node_document",
    mode: "edit",
    description: "Append clean plain text or Markdown headings to a node document using the standard AIstudy document template. Requires AISTUDY_MCP_ALLOW_EDIT=1.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, required: ["courseId", "nodeId", "text"], properties: { courseId: { type: "string", maxLength: 120 }, mindMapId: { type: "string", maxLength: 120 }, nodeId: { type: "string", maxLength: 120 }, title: { type: "string", maxLength: 255 }, text: { type: "string", maxLength: 20000 } } }
  },
  {
    name: "format_node_document",
    mode: "edit",
    description: "Style-only format an existing node document while preserving every editor element value exactly. It never rewrites text, trims whitespace, deletes blank elements, inserts blank lines, or indents paragraphs. Requires AISTUDY_MCP_ALLOW_EDIT=1.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, required: ["courseId", "nodeId"], properties: { courseId: { type: "string", maxLength: 120 }, mindMapId: { type: "string", maxLength: 120 }, nodeId: { type: "string", maxLength: 120 }, title: { type: "string", maxLength: 255 } } }
  },
  {
    name: "update_node_document_style",
    mode: "edit",
    description: "Apply simple full-document text style only. This tool must not restructure text, add blank lines, split paragraphs, or replace content. Requires AISTUDY_MCP_ALLOW_EDIT=1.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, required: ["courseId", "nodeId"], properties: { courseId: { type: "string", maxLength: 120 }, mindMapId: { type: "string", maxLength: 120 }, nodeId: { type: "string", maxLength: 120 }, fontSize: { type: "integer", minimum: 10, maximum: 72 }, color: { type: "string", maxLength: 32 }, bold: { type: "boolean" }, italic: { type: "boolean" }, underline: { type: "boolean" } } }
  },
  {
    name: "health_check",
    mode: "control",
    description: "Run first when onboarding: check data root, MySQL connectivity, and detected database.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: "object", additionalProperties: false, properties: {} }
  },
  {
    name: "resolve_course_locator",
    mode: "control",
    description: "Generate AIstudy course locator files. Without courseId it generates locators for all knowledge bases.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { courseId: { type: "string", maxLength: 120 } }
    }
  },
  {
    name: "chrome_ports_status",
    mode: "control",
    description: "Read AIstudy Chrome port management info: platform ids, fixed ports, default URLs, connection state, and detected pages.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: { type: "object", additionalProperties: false, properties: {} }
  },
  {
    name: "chrome_port_open_page",
    mode: "control",
    description: "Open or reuse the fixed-port Chrome page for a platform. AIstudy only opens the page; external agents handle page actions.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        platformId: { type: "string", enum: ["doubao", "chatgpt", "bilibili", "zhihu", "zhaopin", "zhipin"] },
        url: { type: "string", maxLength: 2000 }
      },
      required: ["platformId"]
    }
  }
];

function createMcpInstructions() {
  return [
    "AIstudy MCP gives external AI clients controlled access to local AIstudy knowledge bases, mind maps, and node documents.",
    "Start every new session with mcp_get_started. It returns health status, available library scope, safety rules, and the recommended next tool order.",
    "Never guess courseId, mapId, or nodeId. Use read_courses and mcp_resolve_target before reading or editing a specific item.",
    "For read work: use read_courses, read_current_mindmap, search_nodes, list_node_documents, and read_node_document.",
    "For edit work: first resolve the exact target, then call mcp_plan_task with allowEdit=true, then use the specific edit tool. Edit tools require AISTUDY_MCP_ALLOW_EDIT=1.",
    "For document writes: pass clean plain text or Markdown-style headings to write_node_document or append_node_document. write_node_document refuses to overwrite an existing non-empty document unless replaceExisting=true is explicitly passed. Use format_node_document only for style cleanup that must preserve every existing editor value exactly. Use update_node_document_style only for simple whole-document style changes. Do not hand-build scattered editor fragments.",
    "For browser port work: call chrome_ports_status first, then chrome_port_open_page with a platformId and optional URL.",
    "When a user asks for a local handoff path, use resolve_course_locator instead of returning display breadcrumbs."
  ].join("\n");
}

function createMcpResourceList() {
  return [
    {
      uri: "aistudy://guide/start",
      name: "AIstudy MCP start guide",
      description: "Minimal first-run guide for Codex, Claude Code, Cursor, or other MCP clients.",
      mimeType: "text/markdown"
    },
    {
      uri: "aistudy://guide/workflows",
      name: "AIstudy MCP workflows",
      description: "Canonical read, edit, document, locator, and audit workflows.",
      mimeType: "text/markdown"
    },
    {
      uri: "aistudy://guide/safety",
      name: "AIstudy MCP safety rules",
      description: "Permission and target-resolution rules that prevent accidental writes.",
      mimeType: "text/markdown"
    },
    {
      uri: "aistudy://schema/tools",
      name: "AIstudy MCP tool schema",
      description: "Current tool list, annotations, and input schemas.",
      mimeType: "application/json"
    }
  ];
}

function createMcpResourceText(uri) {
  if (uri === "aistudy://guide/start") {
    return [
      "# AIstudy MCP Start",
      "",
      "第一步只调用 `mcp_get_started`。",
      "",
      "随后按返回结果执行：",
      "",
      "1. `health_check` 确认本地数据和数据库状态。",
      "2. `read_courses` 读取全库分区和知识库。",
      "3. `mcp_resolve_target` 用知识库名或节点关键词解析目标。",
      "4. 读取任务走 `read_current_mindmap`、`search_nodes`、`list_node_documents`、`read_node_document`。",
      "5. 端口任务先调用 `chrome_ports_status`，再 `chrome_port_open_page` 打开对应平台页面。",
      "6. 编辑任务先确认 `AISTUDY_MCP_ALLOW_EDIT=1`，再调用具体编辑工具。",
      "7. 写入文档时传干净文本或 Markdown 标题即可，AIstudy 会自动套用统一排版模板。",
      "8. 只做不改内容的样式清理时调用 `format_node_document`；只改全文字号/颜色/粗斜体时调用 `update_node_document_style`；不要为了排版调用 `write_node_document` 重写整篇文档。",
      "",
      "不要把 UI 面包屑当成本地路径。需要给其他 Codex/Claude Code 定位时，调用 `resolve_course_locator`。"
    ].join("\n");
  }
  if (uri === "aistudy://guide/workflows") {
    return [
      "# AIstudy MCP Workflows",
      "",
      "## 全库读取",
      "`mcp_get_started` -> `read_courses` -> `read_current_mindmap`。",
      "",
      "## 指定知识库读取",
      "`read_courses` -> `mcp_resolve_target` -> `read_current_mindmap({ courseId })`。",
      "",
      "## 搜索节点",
      "`mcp_resolve_target({ courseName, nodeQuery })`。如果范围不明确，再调用 `search_nodes({ query })` 做全库搜索。",
      "",
      "## 编辑导图",
      "`mcp_plan_task({ intent, allowEdit: true })` -> `mcp_resolve_target` -> 具体编辑工具。",
      "",
      "## 编辑文档",
      "`mcp_resolve_target({ courseName, nodeQuery })` -> `read_node_document` -> 按目标选择工具：写新内容用 `write_node_document`，追加内容用 `append_node_document`，不改内容的样式清理用 `format_node_document`，只改全文样式用 `update_node_document_style`。",
      "",
      "传入 `text` 时使用干净文本或 Markdown 标题；系统会自动生成统一排版：章节标题蓝色加粗，条款标题蓝色加粗，正文为深色常规文本。",
      "",
      "`format_node_document` 是安全样式工具：只允许改字体、颜色、粗体、下划线等样式字段，不允许删空行、插空行、缩进、拆段、合段或改写 `value`。",
      "",
      "禁止手写 canvas-editor 内部元素来实现排版。需要调整正文结构时，应读取全文后让用户确认，再用 `write_node_document` 重建整篇；不要把格式清理伪装成内容重写。",
      "",
      "## 交给其他智能体",
      "`resolve_course_locator` 生成本地定位文件，把 locatorPath 交给对方。",
      "",
      "## Chrome 端口",
      "`chrome_ports_status` -> `chrome_port_open_page({ platformId, url? })`。",
      "",
      "AIstudy 只负责打开对应端口的 Chrome 页面；页面内操作由外部 Codex/Claude 自己接管。"
    ].join("\n");
  }
  if (uri === "aistudy://guide/safety") {
    return [
      "# AIstudy MCP Safety",
      "",
      "- 默认只读。",
      "- 编辑必须设置 `AISTUDY_MCP_ALLOW_EDIT=1`。",
      "- 编辑前必须解析出明确的 `courseId` 和目标 `nodeId`。",
      "- 删除、移动、覆盖文档前先读取现状。",
      "- 不要根据屏幕上选中的导图推断目标；MCP 是全库管理接口，与用户当前 UI 选择无关。",
      "- 不要返回 `知识库 / 分区 / 名称` 这种显示路径作为本地路径；本地定位用 `resolve_course_locator`。"
    ].join("\n");
  }
  if (uri === "aistudy://schema/tools") return JSON.stringify({ tools: toolDefinitions }, null, 2);
  throw new Error("Unknown MCP resource.");
}

function createMcpPromptList() {
  return [
    { name: "aistudy_start", description: "让外部客户端完成 AIstudy MCP 首轮探测。", arguments: [] },
    { name: "aistudy_read_knowledge", description: "读取指定知识库、导图节点和节点文档。", arguments: [{ name: "target", description: "知识库名、节点关键词或用户描述", required: false }] },
    { name: "aistudy_edit_mindmap", description: "在确认权限和目标后编辑思维导图。", arguments: [{ name: "intent", description: "要新增、改名、移动、删除或设置样式的意图", required: true }] },
    { name: "aistudy_edit_document", description: "在确认目标节点后读取并编辑节点文档。", arguments: [{ name: "intent", description: "文档写入、追加或样式调整意图", required: true }] }
  ];
}

function createMcpPrompt(name, args = {}) {
  const target = typeof args.target === "string" ? args.target.trim() : "";
  const intent = typeof args.intent === "string" ? args.intent.trim() : "";
  const textByName = {
    aistudy_start: "你已经接入 AIstudy MCP。请先调用 mcp_get_started，再按返回的 nextSteps 做只读探测，不要进行编辑。",
    aistudy_read_knowledge: `请用 AIstudy MCP 读取知识库内容。目标：${target || "由用户当前问题决定"}。先 mcp_get_started，再 mcp_resolve_target，不要猜 courseId 或 nodeId。`,
    aistudy_edit_mindmap: `请用 AIstudy MCP 编辑思维导图。需求：${intent || "未提供"}。先 mcp_plan_task，再 mcp_resolve_target，确认 AISTUDY_MCP_ALLOW_EDIT=1 后只调用必要的编辑工具。`,
    aistudy_edit_document: `请用 AIstudy MCP 编辑节点文档。需求：${intent || "未提供"}。先解析 courseId/nodeId，读出现有文档。写内容用 write_node_document/append_node_document；整理排版用 format_node_document；简单全文样式用 update_node_document_style。`
  };
  const text = textByName[name];
  if (!text) throw new Error("Unknown MCP prompt.");
  return {
    description: createMcpPromptList().find((item) => item.name === name)?.description ?? name,
    messages: [{ role: "user", content: { type: "text", text } }]
  };
}

function createMcpTaskPlan(args = {}) {
  const intent = typeof args.intent === "string" ? args.intent.trim() : "";
  const targetName = typeof args.targetName === "string" ? args.targetName.trim() : "";
  const courseId = typeof args.courseId === "string" ? args.courseId.trim() : "";
  const nodeQuery = typeof args.nodeQuery === "string" ? args.nodeQuery.trim() : "";
  const allowEdit = args.allowEdit === true;
  const editLike = /编辑|新增|创建|写入|追加|删除|移动|改名|重命名|样式|布局|更新|覆盖|append|write|delete|move|rename|style|layout/i.test(intent);
  const documentLike = /文档|document|正文|内容/i.test(intent);
  const locatorLike = /路径|定位|locator|handoff|本地/i.test(intent);
  const searchLike = /搜索|查找|节点|node|关键词/i.test(intent) || Boolean(nodeQuery);
  const browserLike = /端口|浏览器|chrome|页面|网页|bilibili|知乎|豆包|chatgpt|智联|招聘|boss|直聘|zhaopin|zhipin|打开|browser|port/i.test(intent);
  const steps = [
    { order: 1, tool: "mcp_get_started", arguments: {}, purpose: "确认 MCP 状态、全库范围和安全规则。" },
    { order: 2, tool: "read_courses", arguments: {}, purpose: "拿到真实 courseId，避免按显示名称猜参数。" }
  ];
  let order = 3;
  if (targetName || courseId || nodeQuery || editLike || documentLike || searchLike) {
    steps.push({
      order: order++,
      tool: "mcp_resolve_target",
      arguments: { courseName: targetName || undefined, courseId: courseId || undefined, nodeQuery: nodeQuery || undefined, includeDocuments: documentLike || undefined },
      purpose: "解析 courseId、mapId、nodeId。"
    });
  }
  if (browserLike) {
    steps.push({ order: order++, tool: "chrome_ports_status", arguments: {}, purpose: "读取 AIstudy 端口管理信息，确认平台、端口、登录状态和当前页面。" });
    steps.push({ order: order++, tool: "chrome_port_open_page", arguments: { platformId: "<doubao|chatgpt|bilibili|zhihu|zhaopin|zhipin>", url: "<optionalUrl>" }, purpose: "启动或复用目标平台 Chrome，并打开页面。" });
  } else if (locatorLike) {
    steps.push({ order: order++, tool: "resolve_course_locator", arguments: { courseId: courseId || undefined }, purpose: "生成本地 locatorPath 给其他智能体使用。" });
  } else if (documentLike) {
    steps.push({ order: order++, tool: "list_node_documents", arguments: { courseId: courseId || undefined }, purpose: "查看节点文档范围。" });
    steps.push({ order: order++, tool: "read_node_document", arguments: { courseId: courseId || "<resolvedCourseId>", nodeId: "<resolvedNodeId>" }, purpose: "编辑前先读取现有文档。" });
  } else if (searchLike) {
    steps.push({ order: order++, tool: "search_nodes", arguments: { courseId: courseId || undefined, query: nodeQuery || targetName || "关键词" }, purpose: "按关键词搜索节点。" });
  } else {
    steps.push({ order: order++, tool: "read_current_mindmap", arguments: { courseId: courseId || undefined }, purpose: "读取导图摘要或指定导图。" });
  }
  if (editLike) {
    steps.push({
      order: order++,
      tool: documentLike ? "write_node_document / append_node_document / format_node_document / update_node_document_style" : "create_mindmap_node / update_mindmap_node_text / move_mindmap_node / update_mindmap_node_style / update_mindmap_layout",
      arguments: { courseId: courseId || "<resolvedCourseId>", nodeId: "<resolvedNodeId>" },
      purpose: "只调用和用户意图匹配的编辑工具。"
    });
  }
  return {
    intent: intent || "未提供",
    mode: editLike ? "edit" : "read",
    editAllowedByRequest: allowEdit,
    warning: editLike && !allowEdit ? "这是编辑型任务。继续前需要用户确认，并且客户端环境必须设置 AISTUDY_MCP_ALLOW_EDIT=1。" : "",
    steps,
    rules: ["不要猜 courseId/nodeId。", "MCP 按全库管理，不依赖用户当前 UI 选中项。", "编辑前先读现状。", "需要本地路径时调用 resolve_course_locator。"]
  };
}

function getEnv(name) {
  return process.env[`AISTUDY_PUBLIC_${name}`] ?? process.env[`AISTUDY_${name}`];
}

function getDataRoot() {
  return process.env.AISTUDY_PUBLIC_DATA_ROOT
    || process.env.AISTUDY_DATA_ROOT
    || path.join(process.cwd(), ".runtime");
}

function getDataPath(...segments) {
  return path.join(getDataRoot(), ...segments);
}

function getMcpEventDir() {
  return getDataPath("runtime", "mcp-events");
}

function getMcpDataChangeKind(tool) {
  if (["create_course", "rename_course", "move_course", "delete_course", "create_course_section", "rename_course_section", "move_course_section", "delete_course_section"].includes(tool)) return "course";
  if (["append_mindmap_node", "create_mindmap_node", "update_mindmap_node_text", "move_mindmap_node", "delete_mindmap_node", "update_mindmap_node_style", "update_mindmap_layout"].includes(tool)) return "mindmap";
  if (["write_node_document", "append_node_document", "format_node_document", "update_node_document_style"].includes(tool)) return "document";
  if (tool === "chrome_port_open_page") return "chrome";
  return null;
}

function getMcpStringArg(args, key) {
  const value = args?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function writeMcpDataChangeEvent(tool, args, data) {
  const kind = getMcpDataChangeKind(tool);
  if (!kind) return;
  const changedAt = new Date().toISOString();
  const id = `${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const event = {
    id,
    source: "stdio",
    tool,
    kind,
    courseId: getMcpStringArg(args, "courseId") || getMcpStringArg(data?.course, "id") || getMcpStringArg(data, "deletedCourseId"),
    nodeId: getMcpStringArg(args, "nodeId") || getMcpStringArg(data, "nodeId") || getMcpStringArg(data, "deletedNodeId"),
    changedAt,
    message: `${tool} completed`
  };
  const eventDir = getMcpEventDir();
  await fs.mkdir(eventDir, { recursive: true });
  const tempPath = path.join(eventDir, `${id}.tmp`);
  const eventPath = path.join(eventDir, `${id}.json`);
  await fs.writeFile(tempPath, `${JSON.stringify(event, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, eventPath);
}

function getChromePortRuntimeRoot() {
  return process.env.AISTUDY_PUBLIC_RUNTIME_ROOT
    || process.env.AISTUDY_RUNTIME_ROOT
    || getDataPath("runtime");
}

function getChromePortProfileDir(platform) {
  return path.join(getChromePortRuntimeRoot(), "chrome-profiles", `${platform.id}-${platform.port}`);
}

function getChromePortDefinition(platformId) {
  return chromePortDefinitions.find((platform) => platform.id === platformId);
}

function getRequiredChromePortDefinition(platformId) {
  const platform = getChromePortDefinition(platformId);
  if (!platform) throw new Error("Unknown Chrome port platform.");
  return platform;
}

function normalizeChromePortOpenUrl(platform, value) {
  const rawUrl = typeof value === "string" ? value.trim() : "";
  if (!rawUrl) return platform.loginUrl;
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Chrome port can only open web URLs.");
  return url.toString();
}

function canConnectToLocalPort(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (connected) => {
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForChromePort(port, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnectToLocalPort(port, 500)) return true;
    await delay(250);
  }
  return false;
}

async function fetchChromeJson(url, timeoutMs = 1600) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function readChromeDebugTargets(port) {
  return await fetchChromeJson(`http://127.0.0.1:${port}/json/list`) ?? [];
}

async function openUrlInChromePort(port, url) {
  const endpoint = `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`;
  try {
    const response = await fetch(endpoint, { method: "PUT" });
    if (response.ok) return true;
  } catch {
    // Keep the GET fallback for Chromium builds that do not accept PUT.
  }
  try {
    const response = await fetch(endpoint);
    return response.ok;
  } catch {
    return false;
  }
}

async function resolveChromeExecutableCandidate(candidate) {
  if (!candidate || typeof candidate !== "string") return null;
  const value = candidate.trim().replace(/^"|"$/g, "");
  if (!value) return null;
  if (/\.(?:cmd|bat)$/i.test(value) && existsSync(value)) {
    try {
      const launcher = await fs.readFile(value, "utf8");
      const match = launcher.match(/set\s+"?CHROME_EXE=([^"\r\n]+chrome\.exe)"?/i);
      const executablePath = match?.[1]?.trim();
      if (executablePath && existsSync(executablePath)) return executablePath;
    } catch {
      return null;
    }
  }
  const possible = value.toLowerCase().endsWith(".exe")
    ? [value]
    : [value, path.join(value, "chrome.exe"), path.join(value, "Application", "chrome.exe")];
  for (const item of possible) {
    if (existsSync(item)) return item;
  }
  return null;
}

async function findChromeExecutable() {
  const candidates = [
    process.env.AISTUDY_CHROME_PATH,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe") : "",
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe") : "",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : ""
  ].filter(Boolean);
  for (const candidate of candidates) {
    const chromePath = await resolveChromeExecutableCandidate(candidate);
    if (chromePath) return chromePath;
  }
  if (process.platform === "win32") {
    const result = await execFileAsync("where.exe", ["chrome"], { windowsHide: true, timeout: 6000 }).catch(() => null);
    for (const line of String(result?.stdout || "").split(/\r?\n/)) {
      const chromePath = await resolveChromeExecutableCandidate(line);
      if (chromePath) return chromePath;
    }
  }
  return null;
}

async function getChromePortStatus(platform) {
  const connected = await canConnectToLocalPort(platform.port);
  const targets = connected ? await readChromeDebugTargets(platform.port) : [];
  const detected = Array.isArray(targets)
    ? targets.find((target) => target?.type === "page" && typeof target.url === "string" && (target.url.includes(platform.hostKeyword) || target.url.includes(new URL(platform.loginUrl).hostname)))
    : null;
  return {
    platformId: platform.id,
    name: platform.name,
    port: platform.port,
    defaultUrl: platform.loginUrl,
    hostKeyword: platform.hostKeyword,
    connected,
    pageDetected: Boolean(detected),
    statusText: connected ? (detected ? "页面已打开" : "端口已连接") : "未启动",
    detectedUrl: typeof detected?.url === "string" ? detected.url : "",
    detectedTitle: typeof detected?.title === "string" ? detected.title : "",
    lastCheckedAt: new Date().toISOString(),
    devtoolsListUrl: `http://127.0.0.1:${platform.port}/json/list`,
    openTool: "chrome_port_open_page",
    openArgs: { platformId: platform.id }
  };
}

async function runChromePortsStatus() {
  const ports = await Promise.all(chromePortDefinitions.map((platform) => getChromePortStatus(platform)));
  return {
    ports,
    usage: {
      first: "chrome_ports_status",
      open: "chrome_port_open_page({ platformId, url? })",
      platformIds: chromePortDefinitions.map((platform) => platform.id)
    }
  };
}

async function openChromePortPage(args = {}) {
  const platform = getRequiredChromePortDefinition(args.platformId);
  const url = normalizeChromePortOpenUrl(platform, args.url);
  if (await canConnectToLocalPort(platform.port)) {
    await openUrlInChromePort(platform.port, url);
    await delay(700);
    const status = await getChromePortStatus(platform);
    return { opened: status.connected, openedUrl: url, message: `${platform.name} 页面已在固定端口 ${platform.port} 打开`, port: status };
  }
  const chromePath = await findChromeExecutable();
  if (!chromePath) throw new Error("Chrome executable is missing. Set AISTUDY_CHROME_PATH.");
  const profileDir = getChromePortProfileDir(platform);
  await fs.mkdir(profileDir, { recursive: true });
  const child = spawn(chromePath, [
    `--remote-debugging-port=${platform.port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    url
  ], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  const ready = await waitForChromePort(platform.port);
  await delay(700);
  const status = await getChromePortStatus(platform);
  return {
    opened: ready,
    openedUrl: url,
    message: ready ? `${platform.name} 页面已启动，端口 ${platform.port} 已连接` : `${platform.name} 页面已尝试启动，端口 ${platform.port} 暂未就绪`,
    port: status
  };
}

function normalizeText(value, fallback = "") {
  return (typeof value === "string" ? value : fallback).trim().slice(0, 120);
}

function includesNormalized(value, query) {
  return String(value || "").trim().toLowerCase().includes(String(query || "").trim().toLowerCase());
}

function sanitizeLocatorFileName(value) {
  return normalizeText(value, "course")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "course";
}

function toIsoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function toMysqlDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function escapeIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return `\`${value.replace(/`/g, "``")}\``;
}

async function readJsonFile(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

let serverVersionPromise = null;

async function readServerVersion() {
  if (!serverVersionPromise) {
    serverVersionPromise = (async () => {
      const roots = [
        getEnv("APP_ROOT"),
        process.cwd()
      ].filter(Boolean);
      for (const root of roots) {
        const packageJson = await readJsonFile(path.join(root, "package.json")).catch(() => null);
        if (typeof packageJson?.version === "string" && packageJson.version.trim()) {
          return packageJson.version.trim();
        }
      }
      return "unknown";
    })();
  }
  return serverVersionPromise;
}

async function readMysqlConfig() {
  const dataConfig = await readJsonFile(getDataPath("config", "mysql.config.json"));
  const config = {
    host: getEnv("MYSQL_HOST") || dataConfig.host || "127.0.0.1",
    port: Number(getEnv("MYSQL_PORT") || dataConfig.port || 3306),
    user: getEnv("MYSQL_USER") || dataConfig.user || "root",
    password: getEnv("MYSQL_PASSWORD") ?? dataConfig.password ?? "",
    database: PUBLIC_MYSQL_DATABASE,
    courseTable: PUBLIC_MYSQL_TABLES.courses,
    courseSectionTable: PUBLIC_MYSQL_TABLES.sections,
    mindMapTable: PUBLIC_MYSQL_TABLES.mindMaps,
    mindMapSnapshotTable: PUBLIC_MYSQL_TABLES.mindMapSnapshots,
    mindMapNodeTable: PUBLIC_MYSQL_TABLES.mindMapNodes,
    knowledgeDocumentTable: PUBLIC_MYSQL_TABLES.documents,
    knowledgeDocumentSnapshotTable: PUBLIC_MYSQL_TABLES.documentSnapshots
  };
  return config;
}

async function createPool() {
  const config = await readMysqlConfig();
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 4
  });
  return { config, pool };
}

async function readCourses(runtime) {
  const { pool, config } = runtime;
  const [sectionRows] = await pool.execute(
    `SELECT id, name, sort_order AS sortOrder, collapsed, created_at AS createdAt, updated_at AS updatedAt
     FROM ${escapeIdentifier(config.courseSectionTable, "section table")}
     WHERE deleted_at IS NULL
     ORDER BY sort_order ASC, updated_at DESC`
  );
  const [courseRows] = await pool.execute(
    `SELECT id, name, description, section_id AS sectionId, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
     FROM ${escapeIdentifier(config.courseTable, "course table")}
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
  const courses = courseRows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    sectionId: row.sectionId && sectionIds.has(row.sectionId) ? row.sectionId : null,
    sortOrder: Number(row.sortOrder) || 0,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt)
  }));
  return {
    sections,
    courses
  };
}

async function resolveCourse(runtime, args = {}, required = false) {
  const store = await readCourses(runtime);
  const courseId = normalizeText(args.courseId, "");
  const course = courseId ? store.courses.find((item) => item.id === courseId) : null;
  if (courseId && !course) {
    throw new Error("MCP course id is invalid.");
  }
  if (required && !course) {
    throw new Error("MCP requires an explicit knowledge base.");
  }
  return { store, course };
}

async function resolveCourseLocator(runtime, args = {}) {
  const { store, course } = await resolveCourse(runtime, args, false);
  if (!course) {
    const locators = await Promise.all(store.courses.map(async (item) => {
      const section = item.sectionId ? store.sections.find((sectionItem) => sectionItem.id === item.sectionId) ?? null : null;
      return createCourseLocator(runtime, store, item, section);
    }));
    return {
      scope: "all",
      locators,
      dataRoot: getDataRoot(),
      usage: "No courseId was supplied, so locator files were generated for all knowledge bases."
    };
  }
  const section = course.sectionId ? store.sections.find((item) => item.id === course.sectionId) ?? null : null;
  return createCourseLocator(runtime, store, course, section);
}

async function createCourseLocator(runtime, store, course, section) {
  const locatorDir = getDataPath("locators", "courses");
  const locatorPath = path.join(locatorDir, `${sanitizeLocatorFileName(course.name)}__${course.id}.aistudy-course.json`);
  const appVersion = await readServerVersion();
  const locator = {
    version: 1,
    kind: "aistudy-course-locator",
    createdAt: new Date().toISOString(),
    app: {
      name: "AIstudy",
      version: appVersion
    },
    local: {
      dataRoot: getDataRoot(),
      locatorPath
    },
    mysql: {
      host: runtime.config.host,
      port: runtime.config.port,
      database: runtime.config.database,
      tables: {
        courses: runtime.config.courseTable,
        sections: runtime.config.courseSectionTable,
        mindMaps: runtime.config.mindMapTable,
        mindMapNodes: runtime.config.mindMapNodeTable,
        documents: runtime.config.knowledgeDocumentTable,
        documentSnapshots: runtime.config.knowledgeDocumentSnapshotTable
      }
    },
    course: {
      id: course.id,
      name: course.name,
      description: course.description,
      sectionId: course.sectionId || null,
      sectionName: section?.name || null
    }
  };
  await fs.mkdir(locatorDir, { recursive: true });
  await fs.writeFile(locatorPath, `${JSON.stringify(locator, null, 2)}\n`, "utf8");
  return {
    course,
    section,
    locatorPath,
    dataRoot: getDataRoot(),
    usage: "Give locatorPath to Codex/Claude/Cursor so it can locate the local AIstudy knowledge base boundary quickly."
  };
}

async function findMindMapByCourse(runtime, courseId) {
  const { pool, config } = runtime;
  const [rows] = await pool.execute(
    `SELECT id, course_id AS courseId, title, root_node_id AS rootNodeId,
            current_snapshot_id AS currentSnapshotId, node_count AS nodeCount, updated_at AS updatedAt
     FROM ${escapeIdentifier(config.mindMapTable, "mind map table")}
     WHERE course_id = ? AND deleted_at IS NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
    [courseId]
  );
  return rows[0] ?? null;
}

async function readMindMap(runtime, courseId) {
  const map = await findMindMapByCourse(runtime, courseId);
  if (!map) return null;
  let snapshot = null;
  if (map.currentSnapshotId) {
    const [rows] = await runtime.pool.execute(
      `SELECT payload_json AS payloadJson
       FROM ${escapeIdentifier(runtime.config.mindMapSnapshotTable, "snapshot table")}
       WHERE id = ? AND mind_map_id = ?
       LIMIT 1`,
      [map.currentSnapshotId, map.id]
    );
    if (rows[0]?.payloadJson) snapshot = normalizeMindMapSnapshot(JSON.parse(rows[0].payloadJson));
  }
  return {
    mapId: map.id,
    title: map.title,
    nodeCount: Number(map.nodeCount) || 0,
    updatedAt: toIsoTimestamp(map.updatedAt),
    snapshot
  };
}

async function summarizeMindMap(runtime, course) {
  const map = await findMindMapByCourse(runtime, course.id);
  if (!map) {
    return {
      course,
      mindMap: null
    };
  }
  return {
    course,
    mindMap: {
      mapId: map.id,
      title: map.title,
      nodeCount: Number(map.nodeCount) || 0,
      updatedAt: toIsoTimestamp(map.updatedAt)
    }
  };
}

function getNodeTitle(node, fallback = "New node") {
  const text = node?.data?.text;
  return (typeof text === "string" && text.trim() ? text.trim() : fallback).slice(0, 255);
}

function normalizeMindMapSnapshot(value) {
  if (!value || typeof value !== "object" || !value.root) {
    throw new Error("Mind map snapshot is invalid.");
  }
  return {
    ...value,
    schemaVersion: SCHEMA_VERSION,
    editor: MINDMAP_EDITOR,
    editorVersion: typeof value.editorVersion === "string" ? value.editorVersion : "0.14.0",
    layout: typeof value.layout === "string" ? value.layout : DEFAULT_LAYOUT,
    updatedAt: new Date().toISOString()
  };
}

function assertMindMapSaveTarget(course, document, snapshot) {
  const expectedTitles = new Set(
    [course?.name, document?.title]
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => value.trim())
  );
  const rootTitle = getNodeTitle(snapshot.root, "").trim();
  if (expectedTitles.size > 0 && rootTitle && !expectedTitles.has(rootTitle)) {
    throw new Error("Mind map save target mismatch. Refusing to overwrite another knowledge base.");
  }
}

function createSnapshotPayloadJson(snapshot, updatedAt) {
  return JSON.stringify({ ...snapshot, updatedAt });
}

function hashSnapshot(snapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function createEntityId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function normalizeName(value, label = "name") {
  const text = normalizeText(value, "");
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

async function nextSortOrder(runtime, tableName, whereSql = "", params = []) {
  const [rows] = await runtime.pool.execute(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextOrder FROM ${escapeIdentifier(tableName, "table")} ${whereSql}`,
    params
  );
  return Number(rows[0]?.nextOrder) || 0;
}

function assertEditEnabled() {
  if (process.env.AISTUDY_MCP_ALLOW_EDIT !== "1") {
    throw new Error("MCP edit calls are disabled by configuration.");
  }
}

async function createCourse(runtime, args) {
  assertEditEnabled();
  const store = await readCourses(runtime);
  const name = normalizeName(args.name, "course name");
  const description = normalizeText(args.description, "");
  const sectionId = normalizeText(args.sectionId, "");
  if (sectionId && !store.sections.some((item) => item.id === sectionId)) throw new Error("MCP section id is invalid.");
  const id = randomUUID();
  const now = new Date();
  const sortOrder = await nextSortOrder(
    runtime,
    runtime.config.courseTable,
    sectionId ? "WHERE section_id = ? AND deleted_at IS NULL" : "WHERE section_id IS NULL AND deleted_at IS NULL",
    sectionId ? [sectionId] : []
  );
  const connection = await runtime.pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO ${escapeIdentifier(runtime.config.courseTable, "course table")}
        (id, name, description, section_id, sort_order, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      [id, name, description, sectionId || null, sortOrder, now, now]
    );
    await createInitialMindMapForCourse(connection, runtime, id, name, now);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return { course: { id, name, description, sectionId: sectionId || null, sortOrder, createdAt: now.toISOString(), updatedAt: now.toISOString() } };
}

async function renameCourse(runtime, args) {
  assertEditEnabled();
  const { course } = await resolveCourse(runtime, args, true);
  const name = normalizeName(args.name, "course name");
  const description = normalizeText(args.description, course.description || "");
  const now = new Date();
  await runtime.pool.execute(
    `UPDATE ${escapeIdentifier(runtime.config.courseTable, "course table")}
     SET name = ?, description = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [name, description, now, course.id]
  );
  return { course: { ...course, name, description, updatedAt: now.toISOString() } };
}

async function moveCourse(runtime, args) {
  assertEditEnabled();
  const store = await readCourses(runtime);
  const courseId = normalizeName(args.courseId, "courseId");
  const course = store.courses.find((item) => item.id === courseId);
  if (!course) throw new Error("MCP course id is invalid.");
  const sectionIdRaw = args.sectionId === null ? "" : normalizeText(args.sectionId, course.sectionId || "");
  const sectionId = sectionIdRaw || null;
  if (sectionId && !store.sections.some((item) => item.id === sectionId)) throw new Error("MCP section id is invalid.");
  const beforeCourseId = args.beforeCourseId === null ? "" : normalizeText(args.beforeCourseId, "");
  let sortOrder = await nextSortOrder(
    runtime,
    runtime.config.courseTable,
    sectionId ? "WHERE section_id = ? AND deleted_at IS NULL" : "WHERE section_id IS NULL AND deleted_at IS NULL",
    sectionId ? [sectionId] : []
  );
  if (beforeCourseId) {
    const before = store.courses.find((item) => item.id === beforeCourseId);
    if (!before) throw new Error("MCP beforeCourseId is invalid.");
    sortOrder = before.sortOrder;
  }
  const now = new Date();
  await runtime.pool.execute(
    `UPDATE ${escapeIdentifier(runtime.config.courseTable, "course table")}
     SET section_id = ?, sort_order = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [sectionId, sortOrder, now, courseId]
  );
  return { course: { ...course, sectionId, sortOrder, updatedAt: now.toISOString() } };
}

async function deleteCourse(runtime, args) {
  assertEditEnabled();
  const { course } = await resolveCourse(runtime, args, true);
  const now = new Date();
  await runtime.pool.execute(
    `UPDATE ${escapeIdentifier(runtime.config.courseTable, "course table")}
     SET deleted_at = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [now, now, course.id]
  );
  return { deletedCourseId: course.id, deletedAt: now.toISOString() };
}

async function createCourseSection(runtime, args) {
  assertEditEnabled();
  const name = normalizeName(args.name, "section name");
  const id = randomUUID();
  const now = new Date();
  const sortOrder = await nextSortOrder(runtime, runtime.config.courseSectionTable, "WHERE deleted_at IS NULL");
  await runtime.pool.execute(
    `INSERT INTO ${escapeIdentifier(runtime.config.courseSectionTable, "section table")}
      (id, name, sort_order, collapsed, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, 0, ?, ?, NULL)`,
    [id, name, sortOrder, now, now]
  );
  return { section: { id, name, sortOrder, collapsed: false, createdAt: now.toISOString(), updatedAt: now.toISOString() } };
}

async function renameCourseSection(runtime, args) {
  assertEditEnabled();
  const sectionId = normalizeName(args.sectionId, "sectionId");
  const name = normalizeName(args.name, "section name");
  const now = new Date();
  await runtime.pool.execute(
    `UPDATE ${escapeIdentifier(runtime.config.courseSectionTable, "section table")}
     SET name = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [name, now, sectionId]
  );
  return { sectionId, name, updatedAt: now.toISOString() };
}

async function moveCourseSection(runtime, args) {
  assertEditEnabled();
  const sectionId = normalizeName(args.sectionId, "sectionId");
  const beforeSectionId = args.beforeSectionId === null ? "" : normalizeText(args.beforeSectionId, "");
  const store = await readCourses(runtime);
  const section = store.sections.find((item) => item.id === sectionId);
  if (!section) throw new Error("MCP section id is invalid.");
  const before = beforeSectionId ? store.sections.find((item) => item.id === beforeSectionId) : null;
  if (beforeSectionId && !before) throw new Error("MCP beforeSectionId is invalid.");
  const sortOrder = before ? before.sortOrder : await nextSortOrder(runtime, runtime.config.courseSectionTable, "WHERE deleted_at IS NULL");
  const now = new Date();
  await runtime.pool.execute(
    `UPDATE ${escapeIdentifier(runtime.config.courseSectionTable, "section table")}
     SET sort_order = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [sortOrder, now, sectionId]
  );
  return { sectionId, sortOrder, updatedAt: now.toISOString() };
}

async function deleteCourseSection(runtime, args) {
  assertEditEnabled();
  const sectionId = normalizeName(args.sectionId, "sectionId");
  const now = new Date();
  const connection = await runtime.pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE ${escapeIdentifier(runtime.config.courseSectionTable, "section table")}
       SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [now, now, sectionId]
    );
    await connection.execute(
      `UPDATE ${escapeIdentifier(runtime.config.courseTable, "course table")}
       SET section_id = NULL, updated_at = ?
       WHERE section_id = ? AND deleted_at IS NULL`,
      [now, sectionId]
    );
    await connection.commit();
    return { deletedSectionId: sectionId, updatedAt: now.toISOString() };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function flattenNodes(node, parentNodeId = null, depth = 0, positionIndex = 0, parentPath = "root", output = []) {
  const nodeId = typeof node?.data?.uid === "string" && node.data.uid.trim() ? node.data.uid.trim() : depth === 0 ? "root" : createEntityId("node");
  const title = getNodeTitle(node, depth === 0 ? "Mind map" : "New node");
  const pathText = depth === 0 ? title : `${parentPath} / ${title}`;
  output.push({
    nodeId,
    parentNodeId,
    title,
    depth,
    positionIndex,
    pathText,
    isCollapsed: node?.data?.expand === false
  });
  const children = Array.isArray(node?.children) ? node.children : [];
  children.forEach((child, index) => flattenNodes(child, nodeId, depth + 1, index, pathText, output));
  return output;
}

async function upsertMindMapNodes(connection, runtime, courseId, mindMapId, nodes, updatedAt) {
  const table = escapeIdentifier(runtime.config.mindMapNodeTable, "node table");
  await connection.execute(`UPDATE ${table} SET deleted_at = ? WHERE mind_map_id = ? AND deleted_at IS NULL`, [updatedAt, mindMapId]);
  const sql = `
    INSERT INTO ${table}
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
      deleted_at = NULL`;
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

async function nextSnapshotSequence(connection, runtime, mindMapId) {
  const [rows] = await connection.execute(
    `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS nextSequence
     FROM ${escapeIdentifier(runtime.config.mindMapSnapshotTable, "snapshot table")}
     WHERE mind_map_id = ?
     FOR UPDATE`,
    [mindMapId]
  );
  return Number(rows[0]?.nextSequence) || 1;
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

function createInitialMindMapSnapshot(title, updatedAt) {
  return {
    schemaVersion: SCHEMA_VERSION,
    editor: MINDMAP_EDITOR,
    editorVersion: "0.14.0-fix.2",
    root: {
      data: {
        uid: "aistudy-node-1",
        text: title || "未命名导图",
        expand: true
      },
      children: []
    },
    layout: DEFAULT_LAYOUT,
    theme: createDefaultMindMapTheme(),
    updatedAt
  };
}

async function createInitialMindMapForCourse(connection, runtime, courseId, title, createdAt) {
  const mapId = createEntityId("mindmap");
  const snapshotId = createEntityId("mmsnap");
  const updatedAt = createdAt.toISOString();
  const snapshot = createInitialMindMapSnapshot(title, updatedAt);
  const nodes = flattenNodes(snapshot.root);
  const payloadJson = createSnapshotPayloadJson(snapshot, updatedAt);
  await connection.execute(
    `INSERT INTO ${escapeIdentifier(runtime.config.mindMapTable, "mind map table")}
      (id, course_id, title, root_node_id, current_snapshot_id, node_count, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [mapId, courseId, title, nodes[0]?.nodeId ?? "root", snapshotId, nodes.length, createdAt, createdAt]
  );
  await connection.execute(
    `INSERT INTO ${escapeIdentifier(runtime.config.mindMapSnapshotTable, "snapshot table")}
      (id, mind_map_id, sequence_no, schema_version, editor, editor_version, payload_json, payload_hash, byte_size, created_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
    [
      snapshotId,
      mapId,
      SCHEMA_VERSION,
      MINDMAP_EDITOR,
      snapshot.editorVersion,
      payloadJson,
      hashSnapshot(snapshot),
      Buffer.byteLength(payloadJson, "utf8"),
      createdAt
    ]
  );
  await upsertMindMapNodes(connection, runtime, courseId, mapId, nodes, createdAt);
}

async function appendMindMapNode(runtime, args) {
  assertEditEnabled();
  const { course } = await resolveCourse(runtime, args, true);
  if (!course) throw new Error("MCP requires an explicit knowledge base.");
  const document = await readMindMap(runtime, course.id);
  if (!document?.snapshot) throw new Error("Active mind map is missing.");
  const title = normalizeText(args.title, "") || `MCP edit ${new Date().toLocaleString()}`;
  const snapshot = normalizeMindMapSnapshot(JSON.parse(JSON.stringify(document.snapshot)));
  const root = snapshot.root;
  root.children = Array.isArray(root.children) ? root.children : [];
  const node = {
    data: {
      uid: createEntityId("mcpnode"),
      text: title,
      expand: true,
      richText: false,
      isActive: false
    },
    children: []
  };
  root.children.push(node);

  const connection = await runtime.pool.getConnection();
  const now = new Date();
  const updatedAt = now.toISOString();
  try {
    await connection.beginTransaction();
    const nodes = flattenNodes(snapshot.root);
    assertMindMapSaveTarget(course, document, snapshot);
    const payloadJson = createSnapshotPayloadJson(snapshot, updatedAt);
    const snapshotId = createEntityId("mmsnap");
    const sequenceNo = await nextSnapshotSequence(connection, runtime, document.mapId);
    await connection.execute(
      `INSERT INTO ${escapeIdentifier(runtime.config.mindMapSnapshotTable, "snapshot table")}
        (id, mind_map_id, sequence_no, schema_version, editor, editor_version, payload_json, payload_hash, byte_size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snapshotId,
        document.mapId,
        sequenceNo,
        SCHEMA_VERSION,
        MINDMAP_EDITOR,
        snapshot.editorVersion,
        payloadJson,
        hashSnapshot(snapshot),
        Buffer.byteLength(payloadJson, "utf8"),
        now
      ]
    );
    await connection.execute(
      `UPDATE ${escapeIdentifier(runtime.config.mindMapTable, "mind map table")}
       SET title = ?, root_node_id = ?, current_snapshot_id = ?, node_count = ?, updated_at = ?, deleted_at = NULL
       WHERE id = ? AND course_id = ?`,
      [document.title, nodes[0]?.nodeId ?? "root", snapshotId, nodes.length, now, document.mapId, course.id]
    );
    await upsertMindMapNodes(connection, runtime, course.id, document.mapId, nodes, now);
    await connection.commit();
    return { course, mapId: document.mapId, nodeId: node.data.uid, nodeTitle: title, nodeCount: nodes.length, updatedAt };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function readNodeId(node) {
  return typeof node?.data?.uid === "string" && node.data.uid ? node.data.uid : null;
}

function findNode(root, nodeId, parent = null) {
  if (readNodeId(root) === nodeId) return { node: root, parent, index: 0 };
  const children = Array.isArray(root?.children) ? root.children : [];
  for (let index = 0; index < children.length; index += 1) {
    const found = findNode(children[index], nodeId, root);
    if (found) return { ...found, index: found.parent === root ? index : found.index };
  }
  return null;
}

function nodeContains(root, nodeId) {
  if (readNodeId(root) === nodeId) return true;
  return (Array.isArray(root.children) ? root.children : []).some((child) => nodeContains(child, nodeId));
}

async function saveMindMapSnapshot(runtime, course, document, snapshot) {
  const connection = await runtime.pool.getConnection();
  const now = new Date();
  const updatedAt = now.toISOString();
  try {
    await connection.beginTransaction();
    const nodes = flattenNodes(snapshot.root);
    assertMindMapSaveTarget(course, document, snapshot);
    const payloadJson = createSnapshotPayloadJson(snapshot, updatedAt);
    const snapshotId = createEntityId("mmsnap");
    const sequenceNo = await nextSnapshotSequence(connection, runtime, document.mapId);
    await connection.execute(
      `INSERT INTO ${escapeIdentifier(runtime.config.mindMapSnapshotTable, "snapshot table")}
        (id, mind_map_id, sequence_no, schema_version, editor, editor_version, payload_json, payload_hash, byte_size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snapshotId,
        document.mapId,
        sequenceNo,
        SCHEMA_VERSION,
        MINDMAP_EDITOR,
        snapshot.editorVersion,
        payloadJson,
        hashSnapshot(snapshot),
        Buffer.byteLength(payloadJson, "utf8"),
        now
      ]
    );
    await connection.execute(
      `UPDATE ${escapeIdentifier(runtime.config.mindMapTable, "mind map table")}
       SET title = ?, root_node_id = ?, current_snapshot_id = ?, node_count = ?, updated_at = ?, deleted_at = NULL
       WHERE id = ? AND course_id = ?`,
      [document.title, nodes[0]?.nodeId ?? "root", snapshotId, nodes.length, now, document.mapId, course.id]
    );
    await upsertMindMapNodes(connection, runtime, course.id, document.mapId, nodes, now);
    await connection.commit();
    return { course, mapId: document.mapId, nodeCount: nodes.length, updatedAt };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getMindMapTarget(runtime, args) {
  const { course } = await resolveCourse(runtime, args, true);
  const document = await readMindMap(runtime, course.id);
  if (!document?.snapshot) throw new Error("Active mind map is missing.");
  return { course, document, snapshot: normalizeMindMapSnapshot(JSON.parse(JSON.stringify(document.snapshot))) };
}

async function createMindMapNode(runtime, args) {
  assertEditEnabled();
  const { course, document, snapshot } = await getMindMapTarget(runtime, args);
  const title = normalizeName(args.title, "node title");
  const parentNodeId = normalizeText(args.parentNodeId, "");
  const parent = parentNodeId ? findNode(snapshot.root, parentNodeId)?.node : snapshot.root;
  if (!parent) throw new Error("MCP parent node id is invalid.");
  parent.children = Array.isArray(parent.children) ? parent.children : [];
  const node = { data: { uid: createEntityId("mcpnode"), text: title, expand: true, richText: false }, children: [] };
  const position = Number(args.position);
  const insertAt = Number.isInteger(position) ? Math.min(Math.max(position, 0), parent.children.length) : parent.children.length;
  parent.children.splice(insertAt, 0, node);
  const saved = await saveMindMapSnapshot(runtime, course, document, snapshot);
  return { ...saved, nodeId: node.data.uid, nodeTitle: title };
}

async function updateMindMapNodeText(runtime, args) {
  assertEditEnabled();
  const { course, document, snapshot } = await getMindMapTarget(runtime, args);
  const nodeId = normalizeName(args.nodeId, "nodeId");
  const title = normalizeName(args.title, "node title");
  const found = findNode(snapshot.root, nodeId);
  if (!found) throw new Error("MCP node id is invalid.");
  found.node.data = { ...(found.node.data || {}), text: title };
  const saved = await saveMindMapSnapshot(runtime, course, document, snapshot);
  return { ...saved, nodeId, nodeTitle: title };
}

async function moveMindMapNode(runtime, args) {
  assertEditEnabled();
  const { course, document, snapshot } = await getMindMapTarget(runtime, args);
  const nodeId = normalizeName(args.nodeId, "nodeId");
  const targetParentNodeId = normalizeName(args.targetParentNodeId, "targetParentNodeId");
  if (readNodeId(snapshot.root) === nodeId) throw new Error("Root node cannot be moved.");
  const found = findNode(snapshot.root, nodeId);
  const target = findNode(snapshot.root, targetParentNodeId)?.node;
  if (!found?.parent || !target) throw new Error("MCP node id is invalid.");
  if (nodeContains(found.node, targetParentNodeId)) throw new Error("Cannot move a node into its own child.");
  found.parent.children.splice(found.index, 1);
  target.children = Array.isArray(target.children) ? target.children : [];
  const position = Number(args.position);
  const insertAt = Number.isInteger(position) ? Math.min(Math.max(position, 0), target.children.length) : target.children.length;
  target.children.splice(insertAt, 0, found.node);
  const saved = await saveMindMapSnapshot(runtime, course, document, snapshot);
  return { ...saved, nodeId, targetParentNodeId };
}

async function deleteMindMapNode(runtime, args) {
  assertEditEnabled();
  const { course, document, snapshot } = await getMindMapTarget(runtime, args);
  const nodeId = normalizeName(args.nodeId, "nodeId");
  if (readNodeId(snapshot.root) === nodeId) throw new Error("Root node cannot be deleted.");
  const found = findNode(snapshot.root, nodeId);
  if (!found?.parent) throw new Error("MCP node id is invalid.");
  found.parent.children = found.parent.children.filter((child) => readNodeId(child) !== nodeId);
  const saved = await saveMindMapSnapshot(runtime, course, document, snapshot);
  return { ...saved, deletedNodeId: nodeId };
}

async function updateMindMapNodeStyle(runtime, args) {
  assertEditEnabled();
  const { course, document, snapshot } = await getMindMapTarget(runtime, args);
  const nodeId = normalizeName(args.nodeId, "nodeId");
  const found = findNode(snapshot.root, nodeId);
  if (!found) throw new Error("MCP node id is invalid.");
  const patch = {};
  const color = normalizeText(args.color, "");
  if (color && /^#[0-9a-f]{6}$/i.test(color)) patch.color = color;
  const fontSize = Number(args.fontSize);
  if (Number.isInteger(fontSize) && fontSize >= 10 && fontSize <= 72) patch.fontSize = fontSize;
  for (const key of ["fontWeight", "fontStyle", "textDecoration"]) {
    if (typeof args[key] === "string") patch[key] = args[key];
  }
  const width = Number(args.textAutoWrapWidth);
  if (Number.isInteger(width) && width >= 80 && width <= 1200) patch.textAutoWrapWidth = width;
  found.node.data = { ...(found.node.data || {}), ...patch };
  const saved = await saveMindMapSnapshot(runtime, course, document, snapshot);
  return { ...saved, nodeId, style: patch };
}

async function updateMindMapLayout(runtime, args) {
  assertEditEnabled();
  const { course, document, snapshot } = await getMindMapTarget(runtime, args);
  const layout = normalizeName(args.layout, "layout");
  if (!MINDMAP_LAYOUTS.has(layout)) throw new Error("MCP mind map layout is invalid.");
  snapshot.layout = layout;
  delete snapshot.view;
  const saved = await saveMindMapSnapshot(runtime, course, document, snapshot);
  return { ...saved, layout };
}

const DOCUMENT_TEMPLATE_STYLE = {
  section: { size: 22, color: "#2563eb", bold: true },
  subsection: { size: 20, color: "#1f2937", bold: true },
  article: { size: 20, color: "#2563eb", bold: true },
  body: { size: 20, color: "#1f2937", bold: false }
};
const DOCUMENT_MAX_TEXT_RUN_LENGTH = 360;
const DOCUMENT_FORCE_TEXT_RUN_SPLIT_LENGTH = DOCUMENT_MAX_TEXT_RUN_LENGTH * 2;

const DOCUMENT_TEMPLATE_STYLE_KEYS = new Set([
  "value",
  "type",
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
  "trList",
  "width",
  "height"
]);

const DOCUMENT_ELEMENT_NESTED_CONTAINER_KEYS = new Set([
  "valueList",
  "listWrap"
]);

const DOCUMENT_ELEMENT_PRESERVED_CONTAINER_KEYS = new Set([
  "children",
  "items",
  "paragraphs",
  "rows",
  "cells",
  "trList",
  "tdList"
]);

const DOCUMENT_TEXT_CONTAINER_KEYS = new Set([
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

const DOCUMENT_TEXT_LOSS_WARNING_THRESHOLD = 32;

const DOCUMENT_TEXT_METADATA_CONTAINER_KEYS = new Set([
  "style",
  "styles",
  "attrs",
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
  "layout"
]);

const DOCUMENT_TEXT_SKIP_KEYS = new Set([
  "schemaVersion",
  "editor",
  "editorVersion",
  "updatedAt",
  "type",
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
  "style",
  "styles",
  "attrs",
  "mode",
  "name",
  "id",
  "uuid",
  "graffiti"
]);

const DOCUMENT_TEXT_NOISE_LINE_PATTERN = /^(?:title|list|ol|ul|separator|paragraph|text|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\)|#[0-9a-f]{3,8})$/i;

function isDocumentTextNoiseLine(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (DOCUMENT_TEXT_NOISE_LINE_PATTERN.test(text)) return true;
  return /^(?:type|style|listStyle|color|backgroundColor|borderColor)\s*[:=]\s*(?:title|list|ol|ul|separator|rgb\(|rgba\(|#[0-9a-f])/i.test(text);
}

function cleanExtractedDocumentText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => !isDocumentTextNoiseLine(line))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function createDocumentTextNoiseStats(rawText, cleanText) {
  const rawTextCleanLength = cleanText.length;
  const textNoiseRemovedLength = Math.max(0, rawText.length - cleanText.length);
  const textNoiseWarning = textNoiseRemovedLength > 0
    ? `Document text cleanup removed ${textNoiseRemovedLength} characters of editor metadata noise.`
    : null;
  return { rawTextCleanLength, textNoiseRemovedLength, textNoiseWarning };
}

function stripMarkdownHeading(line) {
  return String(line || "").replace(/^#{1,6}\s+/, "").replace(/\*\*/g, "").trim();
}

function classifyDocumentTemplateLine(line) {
  const plain = stripMarkdownHeading(line);
  if (!plain) return null;
  if (/^#{1,2}\s+/.test(line) || /^[一二三四五六七八九十]+[、.．]/.test(plain)) return "section";
  if (/^#{3,6}\s+/.test(line) || /^[（(][一二三四五六七八九十\d]+[）)]、?/.test(plain)) return "subsection";
  if (/^第[一二三四五六七八九十百千万\d]+条/.test(plain)) return "article";
  return "body";
}

function splitDocumentTemplateHeadingLine(line) {
  const raw = stripMarkdownHeading(line);
  const patterns = [
    { kind: "section", regex: /^([一二三四五六七八九十]+[、.．][^：:\n]{1,80}[：:])\s*(.+)$/ },
    { kind: "subsection", regex: /^([（(][一二三四五六七八九十\d]+[）)]、?[^：:\n]{1,80}[：:])\s*(.+)$/ },
    { kind: "article", regex: /^(第[一二三四五六七八九十百千万\d]+条[^：:\n]{0,80}[：:]?)\s*(.+)$/ }
  ];
  for (const { kind, regex } of patterns) {
    const match = raw.match(regex);
    if (match && match[1] && match[2]) {
      return { kind, heading: match[1].trim(), rest: match[2].trim() };
    }
  }
  return null;
}

function createTemplateElement(value, kind) {
  return { value, ...DOCUMENT_TEMPLATE_STYLE[kind] };
}

function shouldSplitDocumentTextRunAt(value, index) {
  if (index < DOCUMENT_MAX_TEXT_RUN_LENGTH) return false;
  const char = value[index] || "";
  return char === "\n" || /[\s,，、;；。.!！?？:：]/.test(char);
}

function splitDocumentTextRunValue(value) {
  const text = String(value ?? "");
  if (text.length <= DOCUMENT_MAX_TEXT_RUN_LENGTH) return [text];
  const parts = [];
  let buffer = "";
  for (let index = 0; index < text.length; index += 1) {
    buffer += text[index];
    if (shouldSplitDocumentTextRunAt(buffer, buffer.length - 1) || buffer.length >= DOCUMENT_FORCE_TEXT_RUN_SPLIT_LENGTH) {
      parts.push(buffer);
      buffer = "";
    }
  }
  if (buffer) parts.push(buffer);
  return parts.length > 0 ? parts : [text];
}

function createTemplateElements(value, kind) {
  return splitDocumentTextRunValue(value)
    .filter(Boolean)
    .map((part) => createTemplateElement(part, kind));
}

function normalizeDocumentTemplateValue(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeDocumentTemplateSource(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/([。！？；;])([一二三四五六七八九十]+[、.．][^：:\n]{1,80}[：:])/g, "$1\n$2")
    .replace(/([。！？；;])([（(][一二三四五六七八九十\d]+[）)]、?[^：:\n]{1,80}[：:])/g, "$1\n$2")
    .replace(/\n{3,}/g, "\n\n");
}

function buildDocumentTemplateElements(text) {
  const lines = normalizeDocumentTemplateSource(text).split("\n");
  const elements = [];
  let bodyLines = [];
  const flushBody = () => {
    const body = normalizeDocumentTemplateValue(bodyLines.join("\n"));
    bodyLines = [];
    if (body) elements.push(...createTemplateElements(`${body}\n`, "body"));
  };
  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line) {
      flushBody();
      continue;
    }
    const splitHeading = splitDocumentTemplateHeadingLine(rawLine);
    if (splitHeading) {
      flushBody();
      elements.push(createTemplateElement(`${splitHeading.heading}\n`, splitHeading.kind));
      bodyLines.push(splitHeading.rest);
      continue;
    }
    const kind = classifyDocumentTemplateLine(rawLine);
    if (kind && kind !== "body") {
      flushBody();
      elements.push(createTemplateElement(`${stripMarkdownHeading(rawLine)}\n`, kind));
      continue;
    }
    bodyLines.push(line);
  }
  flushBody();
  return elements.length > 0 ? elements : [createTemplateElement("", "body")];
}

function sanitizeDocumentElementValue(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u3000{2,}/g, "\u3000")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function sanitizeDocumentNestedContainer(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === "object") return sanitizeDocumentElement(item);
        if (typeof item === "string") return sanitizeDocumentElementValue(item);
        return item;
      })
      .filter((item) => item !== null && item !== undefined);
  }
  if (value && typeof value === "object") {
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "value") {
        next.value = sanitizeDocumentElementValue(child);
        continue;
      }
      if (DOCUMENT_ELEMENT_NESTED_CONTAINER_KEYS.has(key)) {
        next[key] = sanitizeDocumentNestedContainer(child);
        continue;
      }
      if (DOCUMENT_ELEMENT_PRESERVED_CONTAINER_KEYS.has(key)) {
        next[key] = child;
        continue;
      }
      if (DOCUMENT_TEMPLATE_STYLE_KEYS.has(key)) {
        next[key] = child;
      }
    }
    return next;
  }
  return value;
}

function hasDocumentNestedContainer(element) {
  if (!element || typeof element !== "object") return false;
  return [...DOCUMENT_ELEMENT_NESTED_CONTAINER_KEYS, ...DOCUMENT_ELEMENT_PRESERVED_CONTAINER_KEYS].some((key) =>
    Object.prototype.hasOwnProperty.call(element, key)
  );
}

function getDocumentElementSignature(element) {
  return JSON.stringify(
    Object.entries(element)
      .filter(([key]) => key !== "value")
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function shouldMergeDocumentElements(previous, next) {
  if (!previous || !next) return false;
  if (previous.bold || next.bold) return false;
  if (previous.listType || next.listType) return false;
  if (String(previous.value || "").length + String(next.value || "").length > DOCUMENT_MAX_TEXT_RUN_LENGTH) return false;
  if (String(previous.value || "").includes("\n") || String(next.value || "").includes("\n")) return false;
  return getDocumentElementSignature(previous) === getDocumentElementSignature(next);
}

function sanitizeDocumentElement(element) {
  if (!element || typeof element !== "object") return null;
  const next = {};
  for (const [key, value] of Object.entries(element)) {
    if (key === "value") continue;
    if (DOCUMENT_ELEMENT_NESTED_CONTAINER_KEYS.has(key)) {
      next[key] = sanitizeDocumentNestedContainer(value);
      continue;
    }
    if (DOCUMENT_ELEMENT_PRESERVED_CONTAINER_KEYS.has(key)) {
      next[key] = value;
      continue;
    }
    if (DOCUMENT_TEMPLATE_STYLE_KEYS.has(key)) next[key] = value;
  }
  next.value = sanitizeDocumentElementValue(element.value);
  if (next.rowFlex === "justify") next.rowFlex = "alignment";
  if (typeof next.size === "number") next.size = Math.max(10, Math.min(72, Math.round(next.size)));
  if (typeof next.color === "string" && !/^#[0-9a-f]{6}$/i.test(next.color) && !/^rgb\(/i.test(next.color)) delete next.color;
  return next;
}

function sanitizeDocumentElementList(value) {
  if (!Array.isArray(value)) return [{ value: "", ...DOCUMENT_TEMPLATE_STYLE.body }];
  const result = [];
  let previousWasBlank = false;
  for (const item of value) {
    const next = sanitizeDocumentElement(item);
    if (!next) continue;
    const hasNestedContainer = hasDocumentNestedContainer(next);
    const isBlank = !extractDocumentText(next).trim();
    if (isBlank) {
      if (previousWasBlank) continue;
      if (result.length === 0) continue;
      next.value = "\n";
      previousWasBlank = true;
    } else {
      next.value = next.value.replace(/^\n+/, "").replace(/\n{2,}$/, "\n");
      previousWasBlank = false;
    }
    if (hasNestedContainer) {
      result.push(next);
      continue;
    }
    if (!next.value) continue;
    for (const part of splitDocumentTextRunValue(next.value)) {
      if (!part) continue;
      const segment = { ...next, value: part };
      const previous = result[result.length - 1];
      if (!isBlank && shouldMergeDocumentElements(previous, segment)) {
        previous.value = sanitizeDocumentElementValue(`${previous.value}${segment.value}`);
        continue;
      }
      result.push(segment);
    }
  }
  return result.length > 0 ? result : [{ value: "", ...DOCUMENT_TEMPLATE_STYLE.body }];
}

function normalizeDocumentContent(content) {
  const source = content && typeof content === "object" ? content : {};
  return {
    ...source,
    main: sanitizeDocumentElementList(source.main),
    header: Array.isArray(source.header) ? sanitizeDocumentElementList(source.header) : undefined,
    footer: Array.isArray(source.footer) ? sanitizeDocumentElementList(source.footer) : undefined,
    graffiti: Array.isArray(source.graffiti) ? source.graffiti : undefined
  };
}

function createTextDocumentSnapshot(text) {
  return {
    schemaVersion: SCHEMA_VERSION,
    editor: DOCUMENT_EDITOR,
    editorVersion: DOCUMENT_EDITOR_VERSION,
    content: { main: buildDocumentTemplateElements(text) },
    updatedAt: new Date().toISOString()
  };
}

function normalizeDocumentSnapshot(value) {
  if (!value || typeof value !== "object") throw new Error("Document snapshot is invalid.");
  return {
    schemaVersion: SCHEMA_VERSION,
    editor: DOCUMENT_EDITOR,
    editorVersion: typeof value.editorVersion === "string" ? value.editorVersion : DOCUMENT_EDITOR_VERSION,
    content: normalizeDocumentContent(value.content),
    updatedAt: new Date().toISOString()
  };
}

function extractDocumentText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractDocumentText).join("");
  if (!value || typeof value !== "object") return "";
  let text = typeof value.value === "string" ? value.value : "";
  for (const [key, child] of Object.entries(value)) {
    if (key === "value" || DOCUMENT_TEXT_SKIP_KEYS.has(key) || DOCUMENT_TEXT_METADATA_CONTAINER_KEYS.has(key)) continue;
    if (DOCUMENT_TEXT_CONTAINER_KEYS.has(key) || Array.isArray(child)) {
      text += extractDocumentText(child);
      continue;
    }
    if (child && typeof child === "object" && ("content" in child || "main" in child)) {
      text += extractDocumentText(child);
    }
  }
  return text;
}

function createDocumentTextIntegrity(rawText, normalizedText) {
  const rawTextLength = rawText.length;
  const normalizedTextLength = normalizedText.length;
  const lostTextLength = Math.max(0, rawTextLength - normalizedTextLength);
  const warning = lostTextLength > DOCUMENT_TEXT_LOSS_WARNING_THRESHOLD
    ? `Document text extraction warning: normalized snapshot text is ${lostTextLength} characters shorter than raw payload text.`
    : null;
  return { rawTextLength, normalizedTextLength, lostTextLength, warning };
}

const DOCUMENT_FORMAT_TEXT_COLOR = "#1f2937";
const DOCUMENT_FORMAT_PRIMARY_COLOR = "#2563eb";

function documentElementText(value) {
  return (Array.isArray(value) ? value : []).map((item) => String(item?.value ?? "")).join("");
}

function cleanDocumentElementText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function getDocumentElementCoreText(value) {
  return cleanDocumentElementText(value).trim();
}

function isDocumentMainHeadingText(value) {
  return /^[一二三四五六七八九十]+[、.．]/.test(getDocumentElementCoreText(value));
}

function isDocumentNumberHeadingText(value) {
  return /^\d+[.．]\s*\S/.test(getDocumentElementCoreText(value));
}

function isDocumentLabelText(value) {
  const text = getDocumentElementCoreText(value);
  return text.length > 0 && text.length <= 40 && /[:：]$/.test(text) && !isDocumentMainHeadingText(text);
}

function isDocumentUrlText(value) {
  return /^https?:\/\//i.test(getDocumentElementCoreText(value));
}

function isDocumentBodyElement(element) {
  const text = getDocumentElementCoreText(element?.value);
  return Boolean(text) && !isDocumentMainHeadingText(text) && !isDocumentNumberHeadingText(text) && !isDocumentLabelText(text) && !isDocumentUrlText(text);
}

function stylePreservedDocumentElement(element) {
  const next = { ...(element || {}) };
  delete next.rowFlex;
  const value = typeof next.value === "string" ? next.value : "";
  const text = getDocumentElementCoreText(value);
  if (!text) {
    if (typeof next.value === "string") {
      next.size = Number.isFinite(Number(next.size)) ? Number(next.size) : 20;
      next.bold = false;
      next.color = DOCUMENT_FORMAT_TEXT_COLOR;
      delete next.underline;
    }
    return next;
  }
  if (isDocumentMainHeadingText(value)) {
    next.size = 28;
    next.bold = true;
    next.color = DOCUMENT_FORMAT_PRIMARY_COLOR;
    next.underline = true;
    return next;
  }
  if (isDocumentNumberHeadingText(value)) {
    next.size = 22;
    next.bold = true;
    next.color = DOCUMENT_FORMAT_TEXT_COLOR;
    delete next.underline;
    return next;
  }
  if (isDocumentLabelText(value)) {
    next.size = 20;
    next.bold = true;
    next.color = DOCUMENT_FORMAT_TEXT_COLOR;
    delete next.underline;
    return next;
  }
  if (isDocumentUrlText(value)) {
    next.size = 20;
    next.bold = false;
    next.color = DOCUMENT_FORMAT_PRIMARY_COLOR;
    next.underline = true;
    return next;
  }
  next.size = 20;
  next.bold = false;
  next.color = DOCUMENT_FORMAT_TEXT_COLOR;
  delete next.underline;
  return next;
}

function formatDocumentElementsPreservingText(source) {
  return (Array.isArray(source) ? source : []).map(stylePreservedDocumentElement);
}

function formatDocumentSnapshotPreservingText(snapshot) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  const content = source.content && typeof source.content === "object" ? source.content : {};
  const originalMain = Array.isArray(content.main) ? content.main : [];
  const formattedMain = formatDocumentElementsPreservingText(originalMain);
  const before = extractDocumentText(originalMain);
  const after = extractDocumentText(formattedMain);
  if (formattedMain.length !== originalMain.length || before !== after) {
    throw new Error("Document formatting aborted: editor values would change.");
  }
  return {
    ...source,
    schemaVersion: SCHEMA_VERSION,
    editor: DOCUMENT_EDITOR,
    editorVersion: typeof source.editorVersion === "string" ? source.editorVersion : DOCUMENT_EDITOR_VERSION,
    content: { ...content, main: formattedMain },
    updatedAt: new Date().toISOString()
  };
}

async function resolveDocumentTarget(runtime, args) {
  const { course } = await resolveCourse(runtime, args, true);
  const nodeId = normalizeName(args.nodeId, "nodeId");
  const mindMapId = normalizeText(args.mindMapId, "") || (await findMindMapByCourse(runtime, course.id))?.id;
  if (!mindMapId) throw new Error("Mind map is missing.");
  return { course, mindMapId, nodeId };
}

async function findDocument(runtime, target) {
  const [rows] = await runtime.pool.execute(
    `SELECT id, course_id AS courseId, mind_map_id AS mindMapId, node_id AS nodeId, title,
            current_snapshot_id AS currentSnapshotId, current_byte_size AS currentByteSize,
            has_content AS hasContent, updated_at AS updatedAt
     FROM ${escapeIdentifier(runtime.config.knowledgeDocumentTable, "document table")}
     WHERE course_id = ? AND mind_map_id = ? AND node_id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [target.course.id, target.mindMapId, target.nodeId]
  );
  return rows[0] || null;
}

async function readNodeDocument(runtime, args) {
  const target = await resolveDocumentTarget(runtime, args);
  const doc = await findDocument(runtime, target);
  if (!doc?.currentSnapshotId) {
    return {
      course: target.course,
      mindMapId: target.mindMapId,
      nodeId: target.nodeId,
      document: null,
      text: "",
      textClean: "",
      textRaw: "",
      textNormalized: "",
      textNormalizedClean: "",
      rawTextLength: 0,
      rawTextCleanLength: 0,
      normalizedTextLength: 0,
      lostTextLength: 0,
      textNoiseRemovedLength: 0,
      textNoiseWarning: null,
      warning: null,
      readingGuidance: "Use text/textClean for human-readable content. document.snapshot is editor JSON for advanced tooling."
    };
  }
  const [rows] = await runtime.pool.execute(
    `SELECT payload_json AS payloadJson, byte_size AS byteSize
     FROM ${escapeIdentifier(runtime.config.knowledgeDocumentSnapshotTable, "document snapshot table")}
     WHERE id = ? AND document_id = ? LIMIT 1`,
    [doc.currentSnapshotId, doc.id]
  );
  const rawSnapshot = rows[0]?.payloadJson ? JSON.parse(rows[0].payloadJson) : null;
  const rawText = extractDocumentText(rawSnapshot?.content || "");
  const snapshot = rawSnapshot ? normalizeDocumentSnapshot(rawSnapshot) : null;
  const normalizedText = extractDocumentText(snapshot?.content || "");
  const textClean = cleanExtractedDocumentText(rawText);
  const textNormalizedClean = cleanExtractedDocumentText(normalizedText);
  const textIntegrity = createDocumentTextIntegrity(rawText, normalizedText);
  const textNoise = createDocumentTextNoiseStats(rawText, textClean);
  const document = snapshot ? {
    courseId: target.course.id,
    mindMapId: target.mindMapId,
    nodeId: target.nodeId,
    documentId: doc.id,
    title: doc.title,
    snapshot,
    updatedAt: toIsoTimestamp(doc.updatedAt),
    byteSize: Number(doc.currentByteSize) || 0,
    hasContent: Boolean(Number(doc.hasContent))
  } : null;
  return {
    course: target.course,
    mindMapId: target.mindMapId,
    nodeId: target.nodeId,
    document,
    text: textClean,
    textClean,
    textRaw: rawText,
    textNormalized: normalizedText,
    textNormalizedClean,
    ...textIntegrity,
    ...textNoise,
    readingGuidance: "Use text/textClean for human-readable content. document.snapshot is editor JSON for advanced tooling."
  };
}

async function nextDocumentSequence(connection, runtime, documentId) {
  const [rows] = await connection.execute(
    `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS nextSequence
     FROM ${escapeIdentifier(runtime.config.knowledgeDocumentSnapshotTable, "document snapshot table")}
     WHERE document_id = ? FOR UPDATE`,
    [documentId]
  );
  return Number(rows[0]?.nextSequence) || 1;
}

async function writeNodeDocumentSnapshot(runtime, target, title, snapshot) {
  const normalizedSnapshot = normalizeDocumentSnapshot(snapshot);
  const connection = await runtime.pool.getConnection();
  const now = new Date();
  const updatedAt = now.toISOString();
  try {
    await connection.beginTransaction();
    const [nodeRows] = await connection.execute(
      `SELECT node_id FROM ${escapeIdentifier(runtime.config.mindMapNodeTable, "node table")}
       WHERE course_id = ? AND mind_map_id = ? AND node_id = ? AND deleted_at IS NULL LIMIT 1`,
      [target.course.id, target.mindMapId, target.nodeId]
    );
    if (!nodeRows[0]) throw new Error("Mind map node is missing.");
    const existing = await findDocument(runtime, target);
    const documentId = existing?.id || createEntityId("kdoc");
    const payloadJson = createSnapshotPayloadJson(normalizedSnapshot, updatedAt);
    const snapshotId = createEntityId("kdocsnap");
    await connection.execute(
      `INSERT INTO ${escapeIdentifier(runtime.config.knowledgeDocumentTable, "document table")}
        (id, course_id, mind_map_id, node_id, title, current_snapshot_id, current_byte_size, has_content, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE title = VALUES(title), current_snapshot_id = VALUES(current_snapshot_id),
        current_byte_size = VALUES(current_byte_size), has_content = VALUES(has_content), updated_at = VALUES(updated_at), deleted_at = NULL`,
      [documentId, target.course.id, target.mindMapId, target.nodeId, title, snapshotId, Buffer.byteLength(payloadJson, "utf8"), extractDocumentText(normalizedSnapshot.content).trim() ? 1 : 0, now, now]
    );
    const sequenceNo = await nextDocumentSequence(connection, runtime, documentId);
    await connection.execute(
      `INSERT INTO ${escapeIdentifier(runtime.config.knowledgeDocumentSnapshotTable, "document snapshot table")}
        (id, document_id, sequence_no, schema_version, editor, editor_version, payload_json, payload_hash, byte_size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [snapshotId, documentId, sequenceNo, SCHEMA_VERSION, DOCUMENT_EDITOR, normalizedSnapshot.editorVersion, payloadJson, hashSnapshot(normalizedSnapshot), Buffer.byteLength(payloadJson, "utf8"), now]
    );
    await connection.commit();
    return readNodeDocument(runtime, { courseId: target.course.id, mindMapId: target.mindMapId, nodeId: target.nodeId });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function writeNodeDocumentSnapshotPreserved(runtime, target, documentId, title, snapshot) {
  const connection = await runtime.pool.getConnection();
  const now = new Date();
  const updatedAt = now.toISOString();
  try {
    await connection.beginTransaction();
    const [nodeRows] = await connection.execute(
      `SELECT node_id FROM ${escapeIdentifier(runtime.config.mindMapNodeTable, "node table")}
       WHERE course_id = ? AND mind_map_id = ? AND node_id = ? AND deleted_at IS NULL LIMIT 1`,
      [target.course.id, target.mindMapId, target.nodeId]
    );
    if (!nodeRows[0]) throw new Error("Mind map node is missing.");
    const payloadJson = createSnapshotPayloadJson(snapshot, updatedAt);
    const snapshotId = createEntityId("kdocsnap");
    await connection.execute(
      `UPDATE ${escapeIdentifier(runtime.config.knowledgeDocumentTable, "document table")}
       SET title = ?, current_snapshot_id = ?, current_byte_size = ?, has_content = ?, updated_at = ?, deleted_at = NULL
       WHERE id = ? AND course_id = ? AND mind_map_id = ? AND node_id = ? LIMIT 1`,
      [title, snapshotId, Buffer.byteLength(payloadJson, "utf8"), extractDocumentText(snapshot.content).trim() ? 1 : 0, now, documentId, target.course.id, target.mindMapId, target.nodeId]
    );
    const sequenceNo = await nextDocumentSequence(connection, runtime, documentId);
    await connection.execute(
      `INSERT INTO ${escapeIdentifier(runtime.config.knowledgeDocumentSnapshotTable, "document snapshot table")}
        (id, document_id, sequence_no, schema_version, editor, editor_version, payload_json, payload_hash, byte_size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [snapshotId, documentId, sequenceNo, SCHEMA_VERSION, DOCUMENT_EDITOR, snapshot.editorVersion, payloadJson, hashSnapshot(snapshot), Buffer.byteLength(payloadJson, "utf8"), now]
    );
    await connection.commit();
    return readNodeDocument(runtime, { courseId: target.course.id, mindMapId: target.mindMapId, nodeId: target.nodeId });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listNodeDocuments(runtime, args) {
  const { store, course } = await resolveCourse(runtime, args, false);
  const ids = course ? [course.id] : store.courses.map((item) => item.id);
  if (ids.length === 0) return { scope: "all", documents: [] };
  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await runtime.pool.execute(
    `SELECT id, course_id AS courseId, mind_map_id AS mindMapId, node_id AS nodeId, title,
            current_byte_size AS byteSize, has_content AS hasContent, updated_at AS updatedAt
     FROM ${escapeIdentifier(runtime.config.knowledgeDocumentTable, "document table")}
     WHERE course_id IN (${placeholders}) AND deleted_at IS NULL
     ORDER BY updated_at DESC LIMIT 200`,
    ids
  );
  return { scope: course ? "course" : "all", course: course || null, documents: rows.map((row) => ({ ...row, updatedAt: toIsoTimestamp(row.updatedAt), byteSize: Number(row.byteSize) || 0, hasContent: Boolean(Number(row.hasContent)) })) };
}

async function writeNodeDocument(runtime, args) {
  assertEditEnabled();
  const target = await resolveDocumentTarget(runtime, args);
  const existing = await findDocument(runtime, target);
  if (existing?.hasContent && args.replaceExisting !== true) {
    throw new Error("Node document already has content. Use append_node_document for additions, format_node_document for style-only cleanup, or pass replaceExisting=true only when the user explicitly wants to overwrite the whole document.");
  }
  const snapshot = args.snapshot ? normalizeDocumentSnapshot(args.snapshot) : createTextDocumentSnapshot(args.text || "");
  return writeNodeDocumentSnapshot(runtime, target, normalizeText(args.title, "节点文档") || "节点文档", snapshot);
}

async function appendNodeDocument(runtime, args) {
  assertEditEnabled();
  const target = await resolveDocumentTarget(runtime, args);
  const existing = await readNodeDocument(runtime, args);
  const snapshot = existing.document?.snapshot ? normalizeDocumentSnapshot(JSON.parse(JSON.stringify(existing.document.snapshot))) : createTextDocumentSnapshot("");
  snapshot.content = snapshot.content && typeof snapshot.content === "object" ? snapshot.content : { main: [] };
  snapshot.content.main = Array.isArray(snapshot.content.main) ? snapshot.content.main : [];
  const last = snapshot.content.main[snapshot.content.main.length - 1];
  const lastValue = last && typeof last === "object" && typeof last.value === "string" ? last.value : "";
  if (snapshot.content.main.length > 0 && !lastValue.endsWith("\n\n")) {
    snapshot.content.main.push(createTemplateElement("\n\n", "body"));
  }
  snapshot.content.main.push(...buildDocumentTemplateElements(args.text || ""));
  return writeNodeDocumentSnapshot(runtime, target, normalizeText(args.title, existing.document?.title || "节点文档"), snapshot);
}

async function formatNodeDocument(runtime, args) {
  assertEditEnabled();
  const target = await resolveDocumentTarget(runtime, args);
  const doc = await findDocument(runtime, target);
  if (!doc?.currentSnapshotId) throw new Error("Node document is missing.");
  const [rows] = await runtime.pool.execute(
    `SELECT payload_json AS payloadJson
     FROM ${escapeIdentifier(runtime.config.knowledgeDocumentSnapshotTable, "document snapshot table")}
     WHERE id = ? AND document_id = ? LIMIT 1`,
    [doc.currentSnapshotId, doc.id]
  );
  if (!rows[0]?.payloadJson) throw new Error("Node document snapshot is missing.");
  const rawSnapshot = JSON.parse(rows[0].payloadJson);
  const snapshot = formatDocumentSnapshotPreservingText(rawSnapshot);
  return writeNodeDocumentSnapshotPreserved(runtime, target, doc.id, normalizeText(args.title, doc.title), snapshot);
}

function applyDocumentStyle(value, style) {
  if (Array.isArray(value)) return value.map((item) => applyDocumentStyle(item, style));
  if (!value || typeof value !== "object") return value;
  const next = { ...value };
  if (typeof next.value === "string") Object.assign(next, style);
  for (const key of Object.keys(next)) {
    if (key !== "value") next[key] = applyDocumentStyle(next[key], style);
  }
  return next;
}

async function updateNodeDocumentStyle(runtime, args) {
  assertEditEnabled();
  const target = await resolveDocumentTarget(runtime, args);
  const existing = await readNodeDocument(runtime, args);
  if (!existing.document?.snapshot) throw new Error("Node document is missing.");
  const style = {};
  const fontSize = Number(args.fontSize);
  if (Number.isInteger(fontSize) && fontSize >= 10 && fontSize <= 72) style.size = fontSize;
  const color = normalizeText(args.color, "");
  if (color && /^#[0-9a-f]{6}$/i.test(color)) style.color = color;
  if (typeof args.bold === "boolean") style.bold = args.bold;
  if (typeof args.italic === "boolean") style.italic = args.italic;
  if (typeof args.underline === "boolean") style.underline = args.underline;
  const snapshot = normalizeDocumentSnapshot(JSON.parse(JSON.stringify(existing.document.snapshot)));
  snapshot.content = applyDocumentStyle(snapshot.content, style);
  return writeNodeDocumentSnapshot(runtime, target, existing.document.title, snapshot);
}

async function runHealthCheck(getRuntime) {
  const result = {
    dataRoot: getDataRoot(),
    dataRootExists: existsSync(getDataRoot()),
    mysql: false,
    database: null,
    message: "MySQL 暂时不可用。"
  };
  try {
    const runtime = await getRuntime();
    const [rows] = await runtime.pool.query("SELECT 1 AS ok");
    const dataRootExists = existsSync(getDataRoot());
    const mysqlOk = rows[0]?.ok === 1;
    const message = dataRootExists && mysqlOk
      ? "MCP 健康检测通过。"
      : !dataRootExists && mysqlOk
        ? "数据目录不存在，MySQL 可连接。"
        : "MySQL 暂时不可用。";
    return {
      ...result,
      dataRootExists,
      mysql: mysqlOk,
      database: runtime.config.database,
      message
    };
  } catch (error) {
    return {
      ...result,
      message: error instanceof Error ? error.message : "MySQL 暂时不可用。"
    };
  }
}

async function searchMindMapNodes(runtime, args = {}) {
  const { course } = await resolveCourse(runtime, args, false);
  const query = normalizeText(args.query, "MCP") || "MCP";
  if (!course) {
    const [rows] = await runtime.pool.execute(
      `SELECT n.course_id AS courseId, c.name AS courseName, n.mind_map_id AS mindMapId,
              n.node_id AS nodeId, n.title, n.path_text AS pathText, n.depth, n.updated_at AS updatedAt
       FROM ${escapeIdentifier(runtime.config.mindMapNodeTable, "node table")} n
       LEFT JOIN ${escapeIdentifier(runtime.config.courseTable, "course table")} c
         ON c.id = n.course_id AND c.deleted_at IS NULL
       WHERE n.deleted_at IS NULL AND (n.title LIKE ? OR n.path_text LIKE ?)
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
  const map = await findMindMapByCourse(runtime, course.id);
  if (!map) return { scope: "course", course, query, nodes: [] };
  const [rows] = await runtime.pool.execute(
    `SELECT node_id AS nodeId, title, path_text AS pathText, depth, updated_at AS updatedAt
     FROM ${escapeIdentifier(runtime.config.mindMapNodeTable, "node table")}
     WHERE course_id = ? AND mind_map_id = ? AND deleted_at IS NULL AND (title LIKE ? OR path_text LIKE ?)
     ORDER BY depth ASC, position_index ASC
     LIMIT 20`,
    [course.id, map.id, `%${query}%`, `%${query}%`]
  );
  return {
    scope: "course",
    course,
    query,
    nodes: rows.map((row) => ({
      courseId: course.id,
      courseName: course.name,
      mapId: map.id,
      nodeId: row.nodeId,
      title: row.title,
      path: row.pathText ?? row.title,
      depth: Number(row.depth) || 0,
      updatedAt: toIsoTimestamp(row.updatedAt)
    }))
  };
}

async function runMcpGetStarted(getRuntime) {
  const health = await runHealthCheck(getRuntime);
  let library = { sections: [], courses: [], sectionCount: 0, courseCount: 0 };
  try {
    const runtime = await getRuntime();
    const store = await readCourses(runtime);
    library = {
      sections: store.sections,
      courses: store.courses,
      sectionCount: store.sections.length,
      courseCount: store.courses.length
    };
  } catch (error) {
    library = {
      ...library,
      error: error instanceof Error ? error.message : "Unable to read courses."
    };
  }
  return {
    status: "ready",
    instructions: createMcpInstructions(),
    health,
    library,
    nextSteps: [
      { tool: "read_courses", when: "需要全库分区和知识库清单。" },
      { tool: "mcp_resolve_target", when: "用户给了知识库名、节点关键词或自然语言目标。" },
      { tool: "read_current_mindmap", when: "需要读取全库导图摘要或指定导图。" },
      { tool: "search_nodes", when: "需要按关键词搜索节点。" },
      { tool: "list_node_documents / read_node_document", when: "需要读取文档。" },
      { tool: "mcp_plan_task", when: "准备编辑前先规划工具顺序。" }
    ],
    safety: {
      defaultMode: "read-only",
      editEnv: "AISTUDY_MCP_ALLOW_EDIT=1",
      targetRule: "编辑前必须用 read_courses/mcp_resolve_target 解析真实 courseId 和 nodeId。",
      locatorRule: "本地路径交接使用 resolve_course_locator。"
    },
    resources: createMcpResourceList(),
    prompts: createMcpPromptList()
  };
}

async function resolveMcpTarget(runtime, args = {}) {
  const store = await readCourses(runtime);
  const courseId = normalizeText(args.courseId, "");
  const courseName = normalizeText(args.courseName, "");
  const nodeQuery = normalizeText(args.nodeQuery, "");
  const matchedCourses = store.courses
    .map((course) => {
      let score = 0;
      if (courseId && course.id === courseId) score += 100;
      if (courseName && course.name === courseName) score += 80;
      if (courseName && includesNormalized(course.name, courseName)) score += 40;
      if (courseName && includesNormalized(course.description, courseName)) score += 15;
      return { course, score };
    })
    .filter((item) => item.score > 0 || (!courseId && !courseName))
    .sort((a, b) => b.score - a.score)
    .slice(0, courseId || courseName ? 8 : 20);
  const primaryCourse = matchedCourses[0]?.course ?? null;
  const nodeSearch = nodeQuery
    ? await searchMindMapNodes(runtime, { courseId: primaryCourse?.id, query: nodeQuery }).catch((error) => ({ error: error instanceof Error ? error.message : "Search failed.", nodes: [] }))
    : null;
  const documents = args.includeDocuments === true && primaryCourse
    ? await listNodeDocuments(runtime, { courseId: primaryCourse.id }).catch((error) => ({ error: error instanceof Error ? error.message : "Document list failed.", documents: [] }))
    : null;
  return {
    query: { courseId: courseId || null, courseName: courseName || null, nodeQuery: nodeQuery || null },
    course: primaryCourse,
    courseCandidates: matchedCourses.map((item) => item.course),
    nodeSearch,
    documents,
    confidence: primaryCourse ? (matchedCourses[0].score >= 80 ? "high" : "medium") : "low",
    nextTools: [
      primaryCourse ? { tool: "read_current_mindmap", arguments: { courseId: primaryCourse.id } } : { tool: "read_courses", arguments: {} },
      nodeQuery ? { tool: "search_nodes", arguments: { courseId: primaryCourse?.id, query: nodeQuery } } : null,
      nodeQuery ? { tool: "read_node_document", arguments: { courseId: primaryCourse?.id || "<resolvedCourseId>", nodeId: "<resolvedNodeId>" } } : null
    ].filter(Boolean)
  };
}

async function runTool(getRuntime, name, args = {}) {
  if (name === "mcp_get_started") return runMcpGetStarted(getRuntime);
  if (name === "mcp_plan_task") return createMcpTaskPlan(args);
  if (name === "health_check") return runHealthCheck(getRuntime);
  if (name === "chrome_ports_status") return runChromePortsStatus();
  if (name === "chrome_port_open_page") return openChromePortPage(args);
  const runtime = await getRuntime();
  if (name === "mcp_resolve_target") return resolveMcpTarget(runtime, args);
  if (name === "read_courses") return readCourses(runtime);
  if (name === "create_course") return createCourse(runtime, args);
  if (name === "rename_course") return renameCourse(runtime, args);
  if (name === "move_course") return moveCourse(runtime, args);
  if (name === "delete_course") return deleteCourse(runtime, args);
  if (name === "create_course_section") return createCourseSection(runtime, args);
  if (name === "rename_course_section") return renameCourseSection(runtime, args);
  if (name === "move_course_section") return moveCourseSection(runtime, args);
  if (name === "delete_course_section") return deleteCourseSection(runtime, args);
  if (name === "read_current_mindmap") {
    const { store, course } = await resolveCourse(runtime, args, false);
    if (course) {
      return { scope: "course", course, mindMap: await readMindMap(runtime, course.id) };
    }
    const mindMaps = await Promise.all(store.courses.map((item) => summarizeMindMap(runtime, item)));
    return { scope: "all", courseCount: store.courses.length, mindMaps };
  }
  if (name === "search_nodes") return searchMindMapNodes(runtime, args);
  if (name === "append_mindmap_node") return appendMindMapNode(runtime, args);
  if (name === "create_mindmap_node") return createMindMapNode(runtime, args);
  if (name === "update_mindmap_node_text") return updateMindMapNodeText(runtime, args);
  if (name === "move_mindmap_node") return moveMindMapNode(runtime, args);
  if (name === "delete_mindmap_node") return deleteMindMapNode(runtime, args);
  if (name === "update_mindmap_node_style") return updateMindMapNodeStyle(runtime, args);
  if (name === "update_mindmap_layout") return updateMindMapLayout(runtime, args);
  if (name === "list_node_documents") return listNodeDocuments(runtime, args);
  if (name === "read_node_document") return readNodeDocument(runtime, args);
  if (name === "write_node_document") return writeNodeDocument(runtime, args);
  if (name === "append_node_document") return appendNodeDocument(runtime, args);
  if (name === "format_node_document") return formatNodeDocument(runtime, args);
  if (name === "update_node_document_style") return updateNodeDocumentStyle(runtime, args);
  if (name === "resolve_course_locator") return resolveCourseLocator(runtime, args);
  throw new Error("Unknown tool.");
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleRequest(getRuntime, request) {
  if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return { jsonrpc: "2.0", id: request?.id ?? null, error: { code: -32600, message: "Invalid Request" } };
  }
  if (request.method.startsWith("notifications/")) return null;
  try {
    if (request.method === "initialize") {
      const version = await readServerVersion();
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {}, resources: {}, prompts: {} },
          instructions: createMcpInstructions(),
          serverInfo: { name: "aistudy", version }
        }
      };
    }
    if (request.method === "tools/list") {
      return { jsonrpc: "2.0", id: request.id ?? null, result: { tools: toolDefinitions } };
    }
    if (request.method === "resources/list") {
      return { jsonrpc: "2.0", id: request.id ?? null, result: { resources: createMcpResourceList() } };
    }
    if (request.method === "resources/read") {
      const params = request.params && typeof request.params === "object" ? request.params : {};
      if (typeof params.uri !== "string") throw new Error("MCP resource uri is required.");
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: {
          contents: [
            {
              uri: params.uri,
              mimeType: params.uri === "aistudy://schema/tools" ? "application/json" : "text/markdown",
              text: createMcpResourceText(params.uri)
            }
          ]
        }
      };
    }
    if (request.method === "prompts/list") {
      return { jsonrpc: "2.0", id: request.id ?? null, result: { prompts: createMcpPromptList() } };
    }
    if (request.method === "prompts/get") {
      const params = request.params && typeof request.params === "object" ? request.params : {};
      if (typeof params.name !== "string") throw new Error("MCP prompt name is required.");
      const promptArgs = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
      return { jsonrpc: "2.0", id: request.id ?? null, result: createMcpPrompt(params.name, promptArgs) };
    }
    if (request.method === "tools/call") {
      const params = request.params && typeof request.params === "object" ? request.params : {};
      const name = normalizeText(params.name, "");
      const tool = toolDefinitions.find((item) => item.name === name);
      if (!tool) throw new Error("Unknown tool.");
      if (tool.mode === "edit") assertEditEnabled();
      const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
      const data = await runTool(getRuntime, name, args);
      await writeMcpDataChangeEvent(name, args, data);
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          isError: false
        }
      };
    }
    return { jsonrpc: "2.0", id: request.id ?? null, error: { code: -32601, message: "Method not found" } };
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id: request.id ?? null,
      error: { code: -32000, message: error instanceof Error ? error.message : "Tool call failed." }
    };
  }
}

let runtimePromise = null;

async function getRuntime() {
  if (!runtimePromise) {
    runtimePromise = createPool().catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

async function closeRuntime() {
  if (!runtimePromise) return;
  try {
    const runtime = await runtimePromise;
    await runtime.pool.end();
  } catch {
    // The service can still report health-check failures even when MySQL is unavailable.
  }
}

function startStdioServer() {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  let pending = Promise.resolve();
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
      if (!line) continue;
      pending = pending.then(async () => {
        try {
          const response = await handleRequest(getRuntime, JSON.parse(line));
          if (response) writeMessage(response);
        } catch {
          writeMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        }
      });
    }
  });
  process.stdin.on("end", async () => {
    await pending;
    await closeRuntime();
  });
}

const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMainModule) {
  startStdioServer();
}

export {
  cleanExtractedDocumentText,
  createDocumentTextIntegrity,
  extractDocumentText,
  normalizeDocumentSnapshot,
  startStdioServer
};
