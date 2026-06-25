import type { App, BrowserWindow, Clipboard } from "electron";
import path from "node:path";

export type McpToolMode = "read" | "edit" | "control";
export type McpToolState = "idle" | "running" | "success" | "error" | "disabled";

export type McpToolId =
  | "mcp_get_started"
  | "mcp_plan_task"
  | "mcp_resolve_target"
  | "read_courses"
  | "create_course"
  | "rename_course"
  | "move_course"
  | "delete_course"
  | "create_course_section"
  | "rename_course_section"
  | "move_course_section"
  | "delete_course_section"
  | "read_current_mindmap"
  | "search_nodes"
  | "append_mindmap_node"
  | "create_mindmap_node"
  | "update_mindmap_node_text"
  | "move_mindmap_node"
  | "delete_mindmap_node"
  | "update_mindmap_node_style"
  | "update_mindmap_layout"
  | "list_node_documents"
  | "read_node_document"
  | "write_node_document"
  | "append_node_document"
  | "update_node_document_style"
  | "health_check"
  | "resolve_course_locator"
  | "chrome_ports_status"
  | "chrome_port_open_page"
  | "copy_config";

export type McpToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type McpToolDefinition = {
  id: McpToolId;
  mode: McpToolMode;
  title: string;
  description: string;
  annotations: McpToolAnnotations;
  inputSchema?: Record<string, unknown>;
};

export type McpToolRuntime = McpToolDefinition & {
  enabled: boolean;
  state: McpToolState;
  callCount: number;
  successCount: number;
  errorCount: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastMessage: string;
};

export type McpControlState = {
  enabled: boolean;
  editEnabled: boolean;
  status: "stopped" | "ready" | "busy";
  activeToolId: McpToolId | null;
  tools: McpToolRuntime[];
  lastResult: {
    toolId: McpToolId | null;
    ok: boolean;
    summary: string;
    data: unknown;
    finishedAt: string | null;
  };
};

export type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

type McpConfigDraft = {
  mcpServers: {
    aistudy: {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
  };
};

export type McpControllerDependencies = {
  app: App;
  clipboard: Clipboard;
  getMainWindow: () => BrowserWindow | null;
  createAppError: (code: "APP_INVALID_ARGUMENT", message: string) => Error;
  getAistudyDataRoot: () => string;
  readCourseStore: () => Promise<{ courses: unknown[]; sections: unknown[] }>;
  readCurrentMindMapSummary: (courseId: unknown) => Promise<unknown>;
  searchCurrentMindMapNodes: (query: unknown, courseId: unknown) => Promise<unknown>;
  appendMindMapNode: (title: unknown, courseId: unknown) => Promise<unknown>;
  runAdvancedTool: (toolId: McpToolId, args: Record<string, unknown>) => Promise<unknown>;
  runChromePortTool: (toolId: McpToolId, args: Record<string, unknown>) => Promise<unknown>;
  diagnoseRuntime: () => Promise<unknown>;
  resolveCourseLocator: (courseId: unknown) => Promise<unknown>;
};

const emptySchema = { type: "object", additionalProperties: false, properties: {} };
const courseScopeSchema = {
  type: "object",
  additionalProperties: false,
  properties: { courseId: { type: "string", maxLength: 120 } }
};
const courseNameSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", maxLength: 80 },
    description: { type: "string", maxLength: 500 },
    sectionId: { type: ["string", "null"], maxLength: 120 }
  },
  required: ["name"]
};
const courseEditSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    courseId: { type: "string", maxLength: 120 },
    name: { type: "string", maxLength: 80 },
    description: { type: "string", maxLength: 500 },
    sectionId: { type: ["string", "null"], maxLength: 120 },
    beforeCourseId: { type: ["string", "null"], maxLength: 120 }
  }
};
const sectionEditSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sectionId: { type: "string", maxLength: 120 },
    name: { type: "string", maxLength: 80 },
    beforeSectionId: { type: ["string", "null"], maxLength: 120 }
  }
};
const nodeTargetSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    courseId: { type: "string", maxLength: 120 },
    nodeId: { type: "string", maxLength: 120 },
    title: { type: "string", maxLength: 255 },
    parentNodeId: { type: "string", maxLength: 120 },
    targetParentNodeId: { type: "string", maxLength: 120 },
    position: { type: "integer", minimum: 0, maximum: 10000 }
  }
};
const nodeStyleSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    courseId: { type: "string", maxLength: 120 },
    nodeId: { type: "string", maxLength: 120 },
    color: { type: "string", maxLength: 32 },
    fontSize: { type: "integer", minimum: 10, maximum: 72 },
    fontWeight: { type: "string", enum: ["normal", "bold"] },
    fontStyle: { type: "string", enum: ["normal", "italic"] },
    textDecoration: { type: "string", enum: ["none", "underline", "line-through"] },
    textAutoWrapWidth: { type: "integer", minimum: 80, maximum: 1200 }
  }
};
const documentSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    courseId: { type: "string", maxLength: 120 },
    mindMapId: { type: "string", maxLength: 120 },
    nodeId: { type: "string", maxLength: 120 },
    title: { type: "string", maxLength: 255 },
    text: { type: "string", maxLength: 20000 },
    snapshot: { type: "object" },
    fontSize: { type: "integer", minimum: 10, maximum: 72 },
    color: { type: "string", maxLength: 32 },
    bold: { type: "boolean" },
    italic: { type: "boolean" },
    underline: { type: "boolean" }
  }
};
const mcpPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", maxLength: 500 },
    targetName: { type: "string", maxLength: 120 },
    courseId: { type: "string", maxLength: 120 },
    nodeQuery: { type: "string", maxLength: 120 },
    allowEdit: { type: "boolean" }
  }
};
const mcpResolveTargetSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    courseName: { type: "string", maxLength: 120 },
    courseId: { type: "string", maxLength: 120 },
    nodeQuery: { type: "string", maxLength: 120 },
    includeDocuments: { type: "boolean" }
  }
};
const chromePortSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    platformId: { type: "string", enum: ["doubao", "chatgpt", "bilibili", "zhihu"] },
    url: { type: "string", maxLength: 2000 }
  }
};

const mcpToolDefinitions: McpToolDefinition[] = [
  {
    id: "mcp_get_started",
    mode: "control",
    title: "MCP 使用向导",
    description: "新客户端接入后先调用它：返回健康状态、全库概览、安全规则和下一步工具顺序。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: emptySchema
  },
  {
    id: "mcp_plan_task",
    mode: "control",
    title: "规划 MCP 操作",
    description: "把用户意图转换成可执行的 MCP 工具顺序，告诉外部 Codex/Claude Code 下一步该调用什么。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: mcpPlanSchema
  },
  {
    id: "mcp_resolve_target",
    mode: "read",
    title: "解析操作目标",
    description: "按知识库名、courseId 或节点关键词解析 courseId、mapId、nodeId，减少外部客户端猜参数。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: mcpResolveTargetSchema
  },
  {
    id: "read_courses",
    mode: "read",
    title: "读取知识库列表",
    description: "读取全库分区和知识库清单，后续需要定向处理时使用其中的 courseId。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: emptySchema
  },
  {
    id: "create_course",
    mode: "edit",
    title: "创建知识库",
    description: "创建新的知识库，可指定所属分区。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: courseNameSchema
  },
  {
    id: "rename_course",
    mode: "edit",
    title: "更新知识库",
    description: "修改知识库名称、描述或所属分区。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: courseEditSchema
  },
  {
    id: "move_course",
    mode: "edit",
    title: "移动知识库",
    description: "把知识库移动到指定分区或指定排序位置。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: courseEditSchema
  },
  {
    id: "delete_course",
    mode: "edit",
    title: "删除知识库",
    description: "删除指定知识库。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: courseScopeSchema
  },
  {
    id: "create_course_section",
    mode: "edit",
    title: "创建分区",
    description: "创建新的知识库分区。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { name: { type: "string", maxLength: 80 } },
      required: ["name"]
    }
  },
  {
    id: "rename_course_section",
    mode: "edit",
    title: "更新分区",
    description: "修改知识库分区名称。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: sectionEditSchema
  },
  {
    id: "move_course_section",
    mode: "edit",
    title: "移动分区",
    description: "调整知识库分区顺序。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: sectionEditSchema
  },
  {
    id: "delete_course_section",
    mode: "edit",
    title: "删除分区",
    description: "删除指定分区，分区内知识库会回到未分区。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: sectionEditSchema
  },
  {
    id: "read_current_mindmap",
    mode: "read",
    title: "读取导图",
    description: "全库模式返回各知识库导图摘要；指定 courseId 时读取该知识库导图。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: courseScopeSchema
  },
  {
    id: "search_nodes",
    mode: "read",
    title: "搜索导图节点",
    description: "默认全库搜索导图节点；指定 courseId 时只搜索目标知识库。",
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
    id: "append_mindmap_node",
    mode: "edit",
    title: "编辑导图节点",
    description: "受控写入入口。必须开启编辑许可，并显式选择目标知识库。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: nodeTargetSchema
  },
  {
    id: "create_mindmap_node",
    mode: "edit",
    title: "新增导图节点",
    description: "在指定父节点下新增导图节点。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: nodeTargetSchema
  },
  {
    id: "update_mindmap_node_text",
    mode: "edit",
    title: "修改节点文字",
    description: "修改指定导图节点的文字。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: nodeTargetSchema
  },
  {
    id: "move_mindmap_node",
    mode: "edit",
    title: "移动导图节点",
    description: "移动指定节点到新的父节点和排序位置。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: nodeTargetSchema
  },
  {
    id: "delete_mindmap_node",
    mode: "edit",
    title: "删除导图节点",
    description: "删除指定导图节点及其子节点。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: nodeTargetSchema
  },
  {
    id: "update_mindmap_node_style",
    mode: "edit",
    title: "设置节点样式",
    description: "设置导图节点字体、颜色、宽度等样式。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: nodeStyleSchema
  },
  {
    id: "update_mindmap_layout",
    mode: "edit",
    title: "设置导图布局",
    description: "切换指定知识库导图的布局。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        courseId: { type: "string", maxLength: 120 },
        layout: { type: "string", enum: ["logicalStructure", "logicalStructureLeft", "mindMap", "organizationStructure", "catalogOrganization", "timeline", "verticalTimeline", "fishbone", "rightFishbone"] }
      },
      required: ["courseId", "layout"]
    }
  },
  {
    id: "list_node_documents",
    mode: "read",
    title: "列出节点文档",
    description: "列出指定知识库导图中已保存的节点文档。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: courseScopeSchema
  },
  {
    id: "read_node_document",
    mode: "read",
    title: "读取节点文档",
    description: "读取指定导图节点绑定的文档内容。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: documentSchema
  },
  {
    id: "write_node_document",
    mode: "edit",
    title: "写入节点文档",
    description: "写入或覆盖指定导图节点的文档，可传纯文本或完整文档快照。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: documentSchema
  },
  {
    id: "append_node_document",
    mode: "edit",
    title: "追加节点文档",
    description: "在指定节点文档末尾追加文本。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: documentSchema
  },
  {
    id: "update_node_document_style",
    mode: "edit",
    title: "设置文档样式",
    description: "为指定节点文档全文应用字体大小、颜色、粗斜体和下划线。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: documentSchema
  },
  {
    id: "health_check",
    mode: "control",
    title: "健康检测",
    description: "接入前先跑它，确认数据目录、MySQL、版本和核心表是否正常。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: emptySchema
  },
  {
    id: "resolve_course_locator",
    mode: "control",
    title: "生成知识库定位",
    description: "默认生成全库定位文件；指定 courseId 时生成单个知识库定位。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: courseScopeSchema
  },
  {
    id: "chrome_ports_status",
    mode: "control",
    title: "读取端口管理",
    description: "读取 AIstudy 固定 Chrome 端口、登录状态、当前页面和调试入口，外部 Codex/Claude 先调用它确认可用端口。",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: emptySchema
  },
  {
    id: "chrome_port_open_page",
    mode: "control",
    title: "打开端口页面",
    description: "通过 AIstudy 端口管理启动或复用指定平台 Chrome，并打开默认页或指定 URL。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: chromePortSchema
  },
  {
    id: "copy_config",
    mode: "control",
    title: "复制接入配置",
    description: "复制一份从零开始的接入引导，里面包含配置、验证顺序和安全开关。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: emptySchema
  }
];

function toMcpCourseStore(store: { courses: unknown[]; sections: unknown[] }) {
  return {
    sections: store.sections,
    courses: store.courses
  };
}

function createMcpInstructions() {
  return [
    "AIstudy MCP gives external AI clients controlled access to local AIstudy knowledge bases, mind maps, and node documents.",
    "Start every new session with mcp_get_started. It returns health status, available library scope, safety rules, and the recommended next tool order.",
    "Never guess courseId, mapId, or nodeId. Use read_courses and mcp_resolve_target before reading or editing a specific item.",
    "For read work: use read_courses, read_current_mindmap, search_nodes, list_node_documents, and read_node_document.",
    "For edit work: first resolve the exact target, then call mcp_plan_task with allowEdit=true, then use the specific edit tool. Edit tools require AISTUDY_MCP_ALLOW_EDIT=1.",
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

function createMcpResourceText(uri: string, tools: ReturnType<typeof createStaticToolDescriptors>) {
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
      "`mcp_resolve_target({ courseName, nodeQuery })` -> `read_node_document` -> `write_node_document` 或 `append_node_document`。",
      "",
      "## 交给其他智能体",
      "`resolve_course_locator` 生成本地定位文件，把 locatorPath 交给对方。",
      "",
      "## Chrome 端口自动化",
      "`chrome_ports_status` -> `chrome_port_open_page({ platformId, url? })`。",
      "",
      "AIstudy 只负责把对应端口的 Chrome 页面打开；页面里的点击、输入和读取由外部 Codex/Claude 自己接管。执行前先读端口状态，不要猜端口号。"
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
  if (uri === "aistudy://schema/tools") {
    return JSON.stringify({ tools }, null, 2);
  }
  throw new Error("Unknown MCP resource.");
}

function createMcpPromptList() {
  return [
    {
      name: "aistudy_start",
      description: "让外部客户端完成 AIstudy MCP 首轮探测。",
      arguments: []
    },
    {
      name: "aistudy_read_knowledge",
      description: "读取指定知识库、导图节点和节点文档。",
      arguments: [
        { name: "target", description: "知识库名、节点关键词或用户描述", required: false }
      ]
    },
    {
      name: "aistudy_edit_mindmap",
      description: "在确认权限和目标后编辑思维导图。",
      arguments: [
        { name: "intent", description: "要新增、改名、移动、删除或设置样式的意图", required: true }
      ]
    },
    {
      name: "aistudy_edit_document",
      description: "在确认目标节点后读取并编辑节点文档。",
      arguments: [
        { name: "intent", description: "文档写入、追加或样式调整意图", required: true }
      ]
    }
  ];
}

function createMcpPrompt(name: string, args: Record<string, unknown>) {
  const target = typeof args.target === "string" ? args.target.trim() : "";
  const intent = typeof args.intent === "string" ? args.intent.trim() : "";
  const textByName: Record<string, string> = {
    aistudy_start: "你已经接入 AIstudy MCP。请先调用 mcp_get_started，再按返回的 nextSteps 做只读探测，不要进行编辑。",
    aistudy_read_knowledge: `请用 AIstudy MCP 读取知识库内容。目标：${target || "由用户当前问题决定"}。先 mcp_get_started，再 mcp_resolve_target，不要猜 courseId 或 nodeId。`,
    aistudy_edit_mindmap: `请用 AIstudy MCP 编辑思维导图。需求：${intent || "未提供"}。先 mcp_plan_task，再 mcp_resolve_target，确认 AISTUDY_MCP_ALLOW_EDIT=1 后只调用必要的编辑工具。`,
    aistudy_edit_document: `请用 AIstudy MCP 编辑节点文档。需求：${intent || "未提供"}。先解析 courseId/nodeId，读出现有文档，再写入或追加。`
  };
  const text = textByName[name];
  if (!text) throw new Error("Unknown MCP prompt.");
  return {
    description: createMcpPromptList().find((item) => item.name === name)?.description ?? name,
    messages: [
      {
        role: "user",
        content: { type: "text", text }
      }
    ]
  };
}

function createStaticToolDescriptors() {
  return mcpToolDefinitions.map((tool) => ({
    name: tool.id,
    description: tool.mode === "edit" ? `${tool.description} 需要 AISTUDY_MCP_ALLOW_EDIT=1。` : tool.description,
    annotations: tool.annotations,
    inputSchema: tool.inputSchema ?? emptySchema
  }));
}

function getRecordText(record: unknown, key: string) {
  if (!record || typeof record !== "object") return "";
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function includesNormalized(value: string, query: string) {
  return value.trim().toLowerCase().includes(query.trim().toLowerCase());
}

function createMcpTaskPlan(args: Record<string, unknown>) {
  const intent = typeof args.intent === "string" ? args.intent.trim() : "";
  const targetName = typeof args.targetName === "string" ? args.targetName.trim() : "";
  const courseId = typeof args.courseId === "string" ? args.courseId.trim() : "";
  const nodeQuery = typeof args.nodeQuery === "string" ? args.nodeQuery.trim() : "";
  const allowEdit = args.allowEdit === true;
  const editLike = /编辑|新增|创建|写入|追加|删除|移动|改名|重命名|样式|布局|更新|覆盖|append|write|delete|move|rename|style|layout/i.test(intent);
  const documentLike = /文档|document|正文|内容/i.test(intent);
  const locatorLike = /路径|定位|locator|handoff|本地/i.test(intent);
  const searchLike = /搜索|查找|节点|node|关键词/i.test(intent) || Boolean(nodeQuery);
  const browserLike = /端口|浏览器|chrome|页面|网页|bilibili|知乎|豆包|chatgpt|自动化|点击|输入|browser|port/i.test(intent);

  const steps: Array<Record<string, unknown>> = [
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
    steps.push({ order: order++, tool: "chrome_port_open_page", arguments: { platformId: "<doubao|chatgpt|bilibili|zhihu>", url: "<optionalUrl>" }, purpose: "启动或复用目标平台 Chrome，并打开页面。" });
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
      tool: documentLike ? "write_node_document / append_node_document / update_node_document_style" : "create_mindmap_node / update_mindmap_node_text / move_mindmap_node / update_mindmap_node_style / update_mindmap_layout",
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
    rules: [
      "不要猜 courseId/nodeId。",
      "MCP 按全库管理，不依赖用户当前 UI 选中项。",
      "编辑前先读现状。",
      "需要本地路径时调用 resolve_course_locator。"
    ]
  };
}

export function createMcpController(dependencies: McpControllerDependencies) {
  const mcpToolRuntime = new Map<McpToolId, McpToolRuntime>(
    mcpToolDefinitions.map((tool) => [
      tool.id,
      {
        ...tool,
        enabled: true,
        state: "idle",
        callCount: 0,
        successCount: 0,
        errorCount: 0,
        lastStartedAt: null,
        lastFinishedAt: null,
        lastMessage: "待命"
      }
    ])
  );

  let mcpEnabled = true;
  let mcpEditEnabled = false;
  let activeMcpToolId: McpToolId | null = null;
  let mcpLastResult: McpControlState["lastResult"] = {
    toolId: null,
    ok: true,
    summary: "MCP 控制台待命",
    data: null,
    finishedAt: null
  };

  function getToolRuntime(toolId: McpToolId) {
    const tool = mcpToolRuntime.get(toolId);
    if (!tool) {
      throw dependencies.createAppError("APP_INVALID_ARGUMENT", `Unknown MCP tool: ${toolId}`);
    }
    return tool;
  }

  function getState(): McpControlState {
    return {
      enabled: mcpEnabled,
      editEnabled: mcpEditEnabled,
      status: !mcpEnabled ? "stopped" : activeMcpToolId ? "busy" : "ready",
      activeToolId: activeMcpToolId,
      tools: mcpToolDefinitions.map((definition) => {
        const tool = getToolRuntime(definition.id);
        const isBlocked = !mcpEnabled || !tool.enabled || (tool.mode === "edit" && !mcpEditEnabled);
        return {
          ...tool,
          state: isBlocked ? "disabled" : tool.state
        };
      }),
      lastResult: mcpLastResult
    };
  }

  function emitState() {
    const mainWindow = dependencies.getMainWindow();
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send("mcp:state-changed", getState());
  }

  function normalizeToolId(value: unknown): McpToolId {
    if (typeof value !== "string" || !mcpToolRuntime.has(value as McpToolId)) {
      throw dependencies.createAppError("APP_INVALID_ARGUMENT", "MCP tool id is invalid.");
    }
    return value as McpToolId;
  }

  function setControl(input: unknown) {
    const candidate = input && typeof input === "object" ? input as { enabled?: unknown; editEnabled?: unknown } : {};
    if (typeof candidate.enabled === "boolean") mcpEnabled = candidate.enabled;
    if (candidate.enabled === false) mcpEditEnabled = false;
    if (typeof candidate.editEnabled === "boolean") mcpEditEnabled = candidate.editEnabled;
    emitState();
    return getState();
  }

  function setToolEnabled(input: unknown) {
    const candidate = input && typeof input === "object" ? input as { toolId?: unknown; enabled?: unknown } : {};
    const tool = getToolRuntime(normalizeToolId(candidate.toolId));
    if (typeof candidate.enabled !== "boolean") {
      throw dependencies.createAppError("APP_INVALID_ARGUMENT", "MCP tool enabled value is invalid.");
    }
    tool.enabled = candidate.enabled;
    if (!tool.enabled) tool.state = "idle";
    emitState();
    return getState();
  }

  function createConfigDraft() {
    const nodeCommand = process.env.AISTUDY_NODE_PATH?.trim() || "node";
    const serverScriptPath = dependencies.app.isPackaged
      ? path.join(process.resourcesPath, "scripts", "mcp", "aistudy-mcp-server.mjs")
      : path.join(dependencies.app.getAppPath(), "scripts", "mcp", "aistudy-mcp-server.mjs");
    const config: McpConfigDraft = {
      mcpServers: {
        aistudy: {
          command: nodeCommand,
          args: [serverScriptPath],
          env: {
            AISTUDY_PUBLIC_DATA_ROOT: dependencies.getAistudyDataRoot(),
            AISTUDY_APP_ROOT: dependencies.app.getAppPath(),
            AISTUDY_MCP_ALLOW_EDIT: "0"
          }
        }
      }
    };
    const guide = createOnboardingGuide(config, nodeCommand, serverScriptPath);
    dependencies.clipboard.writeText(guide);
    return {
      copied: true,
      copiedText: "AIstudy MCP 接入引导",
      config,
      guide
    };
  }

  async function createMcpStartedData() {
    const health = await dependencies.diagnoseRuntime().catch((error) => ({
      ok: false,
      message: getMcpErrorMessage(error)
    }));
    const store = await dependencies.readCourseStore().catch(() => ({ courses: [], sections: [] }));
    return {
      status: "ready",
      instructions: createMcpInstructions(),
      health,
      library: {
        sections: store.sections,
        courses: store.courses,
        sectionCount: store.sections.length,
        courseCount: store.courses.length
      },
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

  async function resolveMcpTarget(args: Record<string, unknown>) {
    const store = await dependencies.readCourseStore();
    const courses = Array.isArray(store.courses) ? store.courses : [];
    const courseId = typeof args.courseId === "string" ? args.courseId.trim() : "";
    const courseName = typeof args.courseName === "string" ? args.courseName.trim() : "";
    const nodeQuery = typeof args.nodeQuery === "string" ? args.nodeQuery.trim() : "";
    const matchedCourses = courses
      .map((course) => {
        const id = getRecordText(course, "id");
        const name = getRecordText(course, "name");
        const description = getRecordText(course, "description");
        let score = 0;
        if (courseId && id === courseId) score += 100;
        if (courseName && name === courseName) score += 80;
        if (courseName && includesNormalized(name, courseName)) score += 40;
        if (courseName && includesNormalized(description, courseName)) score += 15;
        return { course, id, name, score };
      })
      .filter((item) => item.score > 0 || (!courseId && !courseName))
      .sort((a, b) => b.score - a.score)
      .slice(0, courseId || courseName ? 8 : 20);
    const primaryCourse = matchedCourses[0]?.course ?? null;
    const primaryCourseId = getRecordText(primaryCourse, "id");
    const nodes = nodeQuery
      ? await dependencies.searchCurrentMindMapNodes(nodeQuery, primaryCourseId || undefined).catch((error) => ({
          error: getMcpErrorMessage(error),
          nodes: []
        }))
      : null;
    const documents = args.includeDocuments === true && primaryCourseId
      ? await dependencies.runAdvancedTool("list_node_documents", { courseId: primaryCourseId }).catch((error) => ({
          error: getMcpErrorMessage(error),
          documents: []
        }))
      : null;

    return {
      query: { courseId: courseId || null, courseName: courseName || null, nodeQuery: nodeQuery || null },
      course: primaryCourse,
      courseCandidates: matchedCourses.map((item) => item.course),
      nodeSearch: nodes,
      documents,
      confidence: primaryCourse ? (matchedCourses[0].score >= 80 ? "high" : "medium") : "low",
      nextTools: [
        primaryCourseId ? { tool: "read_current_mindmap", arguments: { courseId: primaryCourseId } } : { tool: "read_courses", arguments: {} },
        nodeQuery ? { tool: "search_nodes", arguments: { courseId: primaryCourseId || undefined, query: nodeQuery } } : null,
        nodeQuery ? { tool: "read_node_document", arguments: { courseId: primaryCourseId || "<resolvedCourseId>", nodeId: "<resolvedNodeId>" } } : null
      ].filter(Boolean)
    };
  }

  async function runTool(input: unknown) {
    const candidate = input && typeof input === "object"
      ? input as Record<string, unknown> & { toolId?: unknown; courseId?: unknown; query?: unknown; title?: unknown }
      : {};
    const tool = getToolRuntime(normalizeToolId(candidate.toolId));

    if (!mcpEnabled) {
      throw dependencies.createAppError("APP_INVALID_ARGUMENT", "MCP service is disabled.");
    }
    if (!tool.enabled) {
      throw dependencies.createAppError("APP_INVALID_ARGUMENT", "MCP tool is disabled.");
    }
    if (tool.mode === "edit" && !mcpEditEnabled) {
      throw dependencies.createAppError("APP_INVALID_ARGUMENT", "MCP edit permission is disabled.");
    }
    if (activeMcpToolId) {
      throw dependencies.createAppError("APP_INVALID_ARGUMENT", "Another MCP tool is running.");
    }

    activeMcpToolId = tool.id;
    tool.state = "running";
    tool.callCount += 1;
    tool.lastStartedAt = new Date().toISOString();
    tool.lastMessage = "调用中";
    emitState();

    try {
      let data: unknown;
      let summary = "";

      if (tool.id === "mcp_get_started") {
        data = await createMcpStartedData();
        summary = "MCP 使用向导已生成";
      } else if (tool.id === "mcp_plan_task") {
        data = createMcpTaskPlan(candidate);
        summary = "MCP 操作顺序已规划";
      } else if (tool.id === "mcp_resolve_target") {
        data = await resolveMcpTarget(candidate);
        summary = "MCP 目标解析完成";
      } else if (tool.id === "read_courses") {
        const store = await dependencies.readCourseStore();
        data = toMcpCourseStore(store);
        summary = `读取 ${store.courses.length} 个知识库、${store.sections.length} 个分区`;
      } else if (tool.id === "read_current_mindmap") {
        data = await dependencies.readCurrentMindMapSummary(candidate.courseId);
        const nodeCount = typeof data === "object" && data && "nodeCount" in data ? Number((data as { nodeCount?: unknown }).nodeCount) || 0 : 0;
        const mapCount = typeof data === "object" && data && "mindMaps" in data && Array.isArray((data as { mindMaps?: unknown }).mindMaps)
          ? (data as { mindMaps: unknown[] }).mindMaps.length
          : 0;
        summary = mapCount > 0 ? `读取全库导图：${mapCount} 张` : nodeCount > 0 ? `读取目标导图：${nodeCount} 个节点` : "没有可读取的导图";
      } else if (tool.id === "search_nodes") {
        data = await dependencies.searchCurrentMindMapNodes(candidate.query, candidate.courseId);
        const nodes = typeof data === "object" && data && "nodes" in data ? (data as { nodes?: unknown }).nodes : [];
        summary = `搜索完成：${Array.isArray(nodes) ? nodes.length : 0} 条`;
      } else if (tool.id === "append_mindmap_node") {
        data = await dependencies.appendMindMapNode(candidate.title, candidate.courseId);
        const nodeTitle = typeof data === "object" && data && "nodeTitle" in data ? (data as { nodeTitle?: unknown }).nodeTitle : "";
        summary = `已追加节点：${String(nodeTitle || "")}`;
      } else if (tool.mode === "edit" || tool.id === "list_node_documents" || tool.id === "read_node_document") {
        data = await dependencies.runAdvancedTool(tool.id, candidate);
        summary = "调用完成";
      } else if (tool.id === "health_check") {
        data = await dependencies.diagnoseRuntime();
        summary = "健康检测完成";
      } else if (tool.id === "resolve_course_locator") {
        data = await dependencies.resolveCourseLocator(candidate.courseId);
        const locatorPath = typeof data === "object" && data && "locatorPath" in data ? (data as { locatorPath?: unknown }).locatorPath : "";
        summary = `定位文件已生成：${String(locatorPath || "")}`;
      } else if (tool.id === "chrome_ports_status" || tool.id === "chrome_port_open_page") {
        data = await dependencies.runChromePortTool(tool.id, candidate);
        summary = "端口调用完成";
      } else {
        data = createConfigDraft();
        summary = "接入引导已复制";
      }

      const finishedAt = new Date().toISOString();
      tool.state = "success";
      tool.successCount += 1;
      tool.lastFinishedAt = finishedAt;
      tool.lastMessage = summary;
      mcpLastResult = { toolId: tool.id, ok: true, summary, data, finishedAt };
      return { state: getState(), result: mcpLastResult };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const summary = error instanceof Error ? error.message : "MCP 调用失败";
      tool.state = "error";
      tool.errorCount += 1;
      tool.lastFinishedAt = finishedAt;
      tool.lastMessage = summary;
      mcpLastResult = { toolId: tool.id, ok: false, summary, data: null, finishedAt };
      throw error;
    } finally {
      if (tool.mode === "edit") {
        mcpEditEnabled = false;
      }
      activeMcpToolId = null;
      emitState();
      setTimeout(() => {
        if (tool.state !== "running") {
          tool.state = "idle";
          emitState();
        }
      }, 900);
    }
  }

  function createToolDescriptors() {
    return createStaticToolDescriptors();
  }

  function createToolCallInput(name: unknown, args: unknown) {
    const candidate = args && typeof args === "object" ? args as Record<string, unknown> : {};
    return {
      ...candidate,
      toolId: name,
      courseId: candidate.courseId
    };
  }

  async function runTrustedTool(name: unknown, args: unknown) {
    const toolId = normalizeToolId(name);
    const tool = getToolRuntime(toolId);
    if (tool.mode === "edit") mcpEditEnabled = true;
    return runTool(createToolCallInput(toolId, args));
  }

  async function handleJsonRpcRequest(request: JsonRpcRequest) {
    if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
      return {
        jsonrpc: "2.0",
        id: request?.id ?? null,
        error: { code: -32600, message: "Invalid Request" }
      };
    }

    if (request.method.startsWith("notifications/")) return null;

    try {
      if (request.method === "initialize") {
        return {
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {}, resources: {}, prompts: {} },
            instructions: createMcpInstructions(),
            serverInfo: {
              name: "aistudy",
              version: dependencies.app.getVersion()
            }
          }
        };
      }

      if (request.method === "tools/list") {
        return {
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: { tools: createToolDescriptors() }
        };
      }

      if (request.method === "resources/list") {
        return {
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: { resources: createMcpResourceList() }
        };
      }

      if (request.method === "resources/read") {
        const params = request.params && typeof request.params === "object"
          ? request.params as { uri?: unknown }
          : {};
        if (typeof params.uri !== "string") throw new Error("MCP resource uri is required.");
        const mimeType = params.uri === "aistudy://schema/tools" ? "application/json" : "text/markdown";
        return {
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: {
            contents: [
              {
                uri: params.uri,
                mimeType,
                text: createMcpResourceText(params.uri, createToolDescriptors())
              }
            ]
          }
        };
      }

      if (request.method === "prompts/list") {
        return {
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: { prompts: createMcpPromptList() }
        };
      }

      if (request.method === "prompts/get") {
        const params = request.params && typeof request.params === "object"
          ? request.params as { name?: unknown; arguments?: unknown }
          : {};
        if (typeof params.name !== "string") throw new Error("MCP prompt name is required.");
        const promptArgs = params.arguments && typeof params.arguments === "object"
          ? params.arguments as Record<string, unknown>
          : {};
        return {
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: createMcpPrompt(params.name, promptArgs)
        };
      }

      if (request.method === "tools/call") {
        const params = request.params && typeof request.params === "object"
          ? request.params as { name?: unknown; arguments?: unknown }
          : {};
        const name = normalizeToolId(params.name);
        const tool = getToolRuntime(name);
        if (tool.mode === "edit" && process.env.AISTUDY_MCP_ALLOW_EDIT !== "1") {
          throw dependencies.createAppError("APP_INVALID_ARGUMENT", "MCP edit calls are disabled by configuration.");
        }
        if (tool.mode === "edit") mcpEditEnabled = true;
        const response = await runTool(createToolCallInput(name, params.arguments));
        return {
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(response.result.data ?? response.result.summary, null, 2)
              }
            ],
            isError: !response.result.ok
          }
        };
      }

      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: { code: -32601, message: "Method not found" }
      };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: {
          code: -32000,
          message: getMcpErrorMessage(error)
        }
      };
    }
  }

  async function startStdioServer() {
    process.stdin.setEncoding("utf8");
    mcpEnabled = true;
    mcpEditEnabled = process.env.AISTUDY_MCP_ALLOW_EDIT === "1";

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
            const request = JSON.parse(line) as JsonRpcRequest;
            const response = await handleJsonRpcRequest(request);
            if (response) writeJsonRpcMessage(response);
          } catch {
            writeJsonRpcMessage({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32700, message: "Parse error" }
            });
          }
        });
      }
    });

    process.stdin.on("end", async () => {
      await pending;
      dependencies.app.quit();
    });
  }

  return {
    getState,
    setControl,
    setToolEnabled,
    runTool,
    runTrustedTool,
    handleJsonRpcRequest,
    startStdioServer
  };
}

function createOnboardingGuide(config: McpConfigDraft, nodeCommand: string, serverScriptPath: string) {
  const server = config.mcpServers.aistudy;
  const configJson = JSON.stringify(config, null, 2);
  const tomlString = (value: string) => JSON.stringify(value);
  const codexToml = [
    "[mcp_servers.aistudy]",
    `command = ${tomlString(nodeCommand)}`,
    `args = [${server.args.map((arg) => tomlString(arg)).join(", ")}]`,
    "",
    "[mcp_servers.aistudy.env]",
    ...Object.entries(server.env).map(([key, value]) => `${key} = ${tomlString(value)}`)
  ].join("\n");
  const smokeTest = [
    "{",
    "  \"jsonrpc\": \"2.0\",",
    "  \"id\": 1,",
    "  \"method\": \"tools/call\",",
    "  \"params\": {",
    "    \"name\": \"mcp_get_started\",",
    "    \"arguments\": {}",
    "  }",
    "}"
  ].join("\n");

  return [
    "# AIstudy MCP 新手接入引导",
    "",
    "你可以把 AIstudy MCP 理解成：让 Codex/Claude/Cursor 读取和管理 AIstudy 知识库、思维导图、节点文档的本地工具。",
    "默认是只读模式，不会改你的导图；只有把 AISTUDY_MCP_ALLOW_EDIT 改成 1，编辑工具才会允许写入。客户端连接后会收到 instructions，也可以读取 resources/prompts 获取固定流程。",
    "",
    "## 1. 先确认三个路径",
    "",
    `- Node 命令：${nodeCommand}`,
    `- MCP 服务脚本：${serverScriptPath}`,
    `- AIstudy 数据目录：${server.env.AISTUDY_PUBLIC_DATA_ROOT}`,
    "",
    "## 2. 粘贴配置",
    "",
    "如果你的客户端支持 mcpServers JSON，直接使用下面这一段：",
    "",
    "```json",
    configJson,
    "```",
    "",
    "如果你的 Codex 配置使用 TOML，把下面这一段按你的配置文件规则合并进去：",
    "",
    "```toml",
    codexToml,
    "```",
    "",
    "## 3. 重启客户端",
    "",
    "保存配置后，重启 Codex/Claude/Cursor。重启后应该能看到名为 aistudy 的 MCP server。",
    "",
    "## 4. 第一轮只调用向导",
    "",
    "第一次连接不要先编辑，先让助手调用：",
    "",
    "```json",
    smokeTest,
    "```",
    "",
    "`mcp_get_started` 会返回健康状态、全库概览、安全规则、下一步工具顺序、可读 resources 和可用 prompts。",
    "",
    "## 5. 推荐使用顺序",
    "",
    "1. mcp_get_started：连接后第一步，读取总体说明和下一步建议。",
    "2. read_courses：读取全库分区和知识库清单，记住目标知识库的 courseId。",
    "3. mcp_resolve_target：按知识库名、courseId、节点关键词解析真实操作目标。",
    "4. read_current_mindmap / search_nodes：读取全库或指定知识库导图，或搜索节点。",
    "5. list_node_documents / read_node_document：读取节点文档。",
    "6. mcp_plan_task：编辑前规划具体工具顺序。",
    "7. 具体编辑工具：必须传 courseId/nodeId，并先把 AISTUDY_MCP_ALLOW_EDIT 改成 1。",
    "",
    "## 6. 安全规则",
    "",
    "- 默认 AISTUDY_MCP_ALLOW_EDIT=0，只读。",
    "- 不懂时不要打开编辑许可。",
    "- 打开编辑许可前，先明确要写入哪个知识库、哪个节点，并传入 courseId/nodeId。",
    "- 编辑调用完成后，AIstudy 客户端会自动关闭编辑许可。",
    "- MCP 是全库管理接口，不依赖用户当前 UI 选中的导图。",
    "- 需要本地路径交接时调用 resolve_course_locator，不要复制 UI 面包屑路径。",
    "",
    "## 7. 给 Codex 的第一句提示",
    "",
    "你已经接入 AIstudy MCP。请先调用 aistudy.mcp_get_started，再按返回的 nextSteps 做只读探测；除非我明确允许，不要进行编辑。"
  ].join("\n");
}

function writeJsonRpcMessage(message: unknown) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function getMcpErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "MCP 调用失败。";
}
