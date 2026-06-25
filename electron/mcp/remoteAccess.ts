import type { Clipboard } from "electron";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { promisify } from "node:util";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

type McpRemoteAccessStatus = "off" | "checking" | "ready" | "needs_tailscale" | "needs_login" | "error";

export type McpRemoteCallRecord = {
  id: string;
  startedAt: string;
  finishedAt: string;
  source: string;
  endpoint: string;
  tool: string;
  status: "ok" | "error";
  statusCode: number;
  durationMs: number;
  message: string;
};

export type McpRemoteAccessPermissions = {
  edit: boolean;
  course: boolean;
  mindmap: boolean;
  document: boolean;
  destructive: boolean;
};

export type McpRemoteAccessState = {
  enabled: boolean;
  status: McpRemoteAccessStatus;
  port: number;
  localUrl: string;
  mcpUrl: string;
  apiUrl: string;
  token: string;
  tailscale: {
    installed: boolean;
    online: boolean;
    exePath: string;
    ip: string;
    dnsName: string;
    backendState: string;
  };
  lastMessage: string;
  lastCheckedAt: string | null;
  calls: McpRemoteCallRecord[];
  permissions: McpRemoteAccessPermissions;
};

export type McpRemoteDataChange = {
  id: string;
  tool: string;
  kind: "course" | "mindmap" | "document" | "chrome" | "unknown";
  courseId: string | null;
  nodeId: string | null;
  changedAt: string;
  message: string;
};

type RemoteAccessConfig = {
  enabled: boolean;
  token: string;
  port: number;
  permissions: McpRemoteAccessPermissions;
};

export type McpRemoteAccessDependencies = {
  clipboard: Clipboard;
  userDataRoot: string;
  handleJsonRpcRequest: (request: JsonRpcRequest) => Promise<unknown>;
  runTrustedTool: (name: unknown, args: unknown) => Promise<{ result?: { ok?: boolean; data?: unknown; summary?: string } }>;
  onStateChanged?: (state: McpRemoteAccessState) => void;
  onDataChanged?: (change: McpRemoteDataChange) => void;
};

const execFileAsync = promisify(execFile);
const DEFAULT_PORT = 6188;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_REMOTE_CALL_RECORDS = 80;
const REMOTE_READ_TOOLS = new Set([
  "mcp_get_started",
  "mcp_plan_task",
  "mcp_resolve_target",
  "read_courses",
  "read_current_mindmap",
  "search_nodes",
  "list_node_documents",
  "read_node_document",
  "health_check",
  "chrome_ports_status",
  "chrome_port_open_page"
]);
const REMOTE_COURSE_EDIT_TOOLS = new Set(["create_course", "rename_course", "move_course", "create_course_section", "rename_course_section", "move_course_section"]);
const REMOTE_COURSE_DELETE_TOOLS = new Set(["delete_course", "delete_course_section"]);
const REMOTE_MINDMAP_EDIT_TOOLS = new Set([
  "append_mindmap_node",
  "create_mindmap_node",
  "update_mindmap_node_text",
  "move_mindmap_node",
  "update_mindmap_node_style",
  "update_mindmap_layout"
]);
const REMOTE_MINDMAP_DELETE_TOOLS = new Set(["delete_mindmap_node"]);
const REMOTE_DOCUMENT_EDIT_TOOLS = new Set(["write_node_document", "append_node_document", "update_node_document_style"]);
const DEFAULT_PERMISSIONS: McpRemoteAccessPermissions = {
  edit: false,
  course: false,
  mindmap: false,
  document: false,
  destructive: false
};

export function createMcpRemoteAccessController(dependencies: McpRemoteAccessDependencies) {
  let server: http.Server | null = null;
  let state: McpRemoteAccessState = createInitialState();
  let configPromise: Promise<RemoteAccessConfig> | null = null;

  function createInitialState(): McpRemoteAccessState {
    return {
      enabled: false,
      status: "off",
      port: DEFAULT_PORT,
      localUrl: `http://127.0.0.1:${DEFAULT_PORT}`,
      mcpUrl: "",
      apiUrl: "",
      token: "",
      tailscale: {
        installed: false,
        online: false,
        exePath: "",
        ip: "",
        dnsName: "",
        backendState: ""
      },
      lastMessage: "未开启",
      lastCheckedAt: null,
      calls: [],
      permissions: { ...DEFAULT_PERMISSIONS }
    };
  }

  async function readConfig() {
    if (!configPromise) {
      configPromise = (async () => {
        const configPath = getConfigPath();
        try {
          const raw = await fs.readFile(configPath, "utf8");
          const parsed = JSON.parse(raw) as Partial<RemoteAccessConfig>;
          const port = normalizePort(parsed.port);
          const token = typeof parsed.token === "string" && parsed.token.length >= 24 ? parsed.token : createToken();
          const permissions = normalizePermissions(parsed.permissions);
          const enabled = parsed.enabled === true;
          return { enabled, port, token, permissions };
        } catch {
          const next = { enabled: false, port: DEFAULT_PORT, token: createToken(), permissions: { ...DEFAULT_PERMISSIONS } };
          await writeConfig(next);
          return next;
        }
      })();
    }
    return configPromise;
  }

  function getConfigPath() {
    return path.join(dependencies.userDataRoot, "mcp-remote-access.json");
  }

  async function writeConfig(config: RemoteAccessConfig) {
    await fs.mkdir(dependencies.userDataRoot, { recursive: true });
    await fs.writeFile(getConfigPath(), JSON.stringify(config, null, 2), "utf8");
  }

  function normalizePort(value: unknown) {
    const port = Number(value);
    return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_PORT;
  }

  function normalizePermissions(value: unknown): McpRemoteAccessPermissions {
    const candidate = value && typeof value === "object" ? value as Partial<Record<keyof McpRemoteAccessPermissions, unknown>> : {};
    return {
      edit: candidate.edit === true,
      course: candidate.course === true,
      mindmap: candidate.mindmap === true,
      document: candidate.document === true,
      destructive: candidate.destructive === true
    };
  }

  function mergePermissions(current: McpRemoteAccessPermissions, patch: unknown): McpRemoteAccessPermissions {
    const candidate = patch && typeof patch === "object" ? patch as Partial<Record<keyof McpRemoteAccessPermissions, unknown>> : {};
    return normalizePermissions({ ...current, ...candidate });
  }

  function createToken() {
    return randomBytes(24).toString("base64url");
  }

  async function getState() {
    const config = await readConfig();
    state = {
      ...state,
      enabled: config.enabled,
      status: config.enabled ? state.status : "off",
      port: config.port,
      localUrl: `http://127.0.0.1:${config.port}`,
      token: config.token,
      permissions: config.permissions,
      ...createRemoteUrls(state.tailscale, config.port)
    };
    return state;
  }

  async function setPermissions(input: unknown) {
    const config = await readConfig();
    const next: RemoteAccessConfig = {
      ...config,
      permissions: mergePermissions(config.permissions, input)
    };
    await writeConfig(next);
    configPromise = Promise.resolve(next);
    state = { ...state, permissions: next.permissions };
    return emitAndReturnState();
  }

  async function setEnabled(input: unknown) {
    const candidate = input && typeof input === "object" ? input as { enabled?: unknown } : {};
    if (candidate.enabled === true) return enable();
    if (candidate.enabled === false) return disable();
    return getState();
  }

  async function enable() {
    const config = await readConfig();
    const nextConfig = { ...config, enabled: true };
    await writeConfig(nextConfig);
    configPromise = Promise.resolve(nextConfig);
    state = {
      ...state,
      enabled: true,
      status: "checking",
      port: config.port,
      localUrl: `http://127.0.0.1:${config.port}`,
      token: config.token,
      permissions: config.permissions,
      lastMessage: "正在检测 Tailscale",
      lastCheckedAt: new Date().toISOString()
    };

    const tailscale = await detectTailscale();
    state = { ...state, tailscale, ...createRemoteUrls(tailscale, config.port) };
    if (!tailscale.installed) {
      state = { ...state, status: "needs_tailscale", lastMessage: "未检测到 Tailscale" };
      return emitAndReturnState();
    }

    const online = tailscale.online ? tailscale : await startTailscale(tailscale.exePath);
    state = { ...state, tailscale: online, ...createRemoteUrls(online, config.port) };
    if (!online.online) {
      state = { ...state, status: "needs_login", lastMessage: "Tailscale 需要登录或连接" };
      return emitAndReturnState();
    }

    await startLocalServer(config.port);
    const served = await exposeWithTailscale(online.exePath, config.port);
    if (!served.ok) {
      state = { ...state, status: "error", lastMessage: served.message || "Tailscale Serve 没有启动" };
      return emitAndReturnState();
    }

    state = {
      ...state,
      enabled: true,
      status: "ready",
      lastMessage: "内网访问已开启",
      lastCheckedAt: new Date().toISOString(),
      ...createRemoteUrls(online, config.port)
    };
    return emitAndReturnState();
  }

  async function disable() {
    const config = await readConfig();
    const nextConfig = { ...config, enabled: false };
    await writeConfig(nextConfig);
    configPromise = Promise.resolve(nextConfig);
    const tailscale = state.tailscale.installed ? state.tailscale : await detectTailscale();
    if (tailscale.installed) {
      await runTailscale(tailscale.exePath, ["serve", `--http=${config.port}`, "off"], 12000).catch(() => null);
    }
    await closeLocalServer();
    state = {
      ...state,
      enabled: false,
      status: "off",
      port: nextConfig.port,
      localUrl: `http://127.0.0.1:${nextConfig.port}`,
      token: nextConfig.token,
      permissions: nextConfig.permissions,
      lastMessage: "内网访问已关闭",
      lastCheckedAt: new Date().toISOString()
    };
    return emitAndReturnState();
  }

  async function restore() {
    const config = await readConfig();
    if (!config.enabled) return getState();
    return enable();
  }

  async function refresh() {
    const config = await readConfig();
    const tailscale = await detectTailscale();
    state = {
      ...state,
      tailscale,
      lastCheckedAt: new Date().toISOString(),
      ...createRemoteUrls(tailscale, config.port)
    };
    if (state.enabled && state.status !== "ready") return enable();
    return emitAndReturnState();
  }

  async function copyConnectionInfo() {
    const current = await getState();
    const text = [
      `MCP URL: ${current.mcpUrl || "未生成"}`,
      `API URL: ${current.apiUrl || "未生成"}`,
      `Authorization: Bearer ${current.token}`
    ].join("\n");
    dependencies.clipboard.writeText(text);
    emitRemoteState(current);
    return { copied: true, text, state: current };
  }

  async function emitAndReturnState() {
    const current = await getState();
    emitRemoteState(current);
    return current;
  }

  function emitRemoteState(nextState = state) {
    dependencies.onStateChanged?.(nextState);
  }

  async function detectTailscale() {
    const exePath = await resolveTailscaleExe();
    if (!exePath) return createTailscaleState({ installed: false });
    const status = await runTailscale(exePath, ["status", "--json"], 10000).catch((error) => ({
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error)
    }));
    try {
      const parsed = JSON.parse(status.stdout || "{}") as {
        BackendState?: string;
        Self?: { TailscaleIPs?: string[]; DNSName?: string; Online?: boolean };
      };
      const ip = parsed.Self?.TailscaleIPs?.find((item) => item.includes(".")) || "";
      const dnsName = (parsed.Self?.DNSName || "").replace(/\.$/, "");
      const backendState = parsed.BackendState || "";
      const online = backendState.toLowerCase() === "running" && Boolean(ip);
      return createTailscaleState({ installed: true, online, exePath, ip, dnsName, backendState });
    } catch {
      return createTailscaleState({ installed: true, online: false, exePath, backendState: status.stderr || "Unknown" });
    }
  }

  async function startTailscale(exePath: string) {
    await runTailscale(exePath, ["up"], 20000).catch(() => null);
    return detectTailscale();
  }

  async function resolveTailscaleExe() {
    const configured = process.env.AISTUDY_TAILSCALE_PATH?.trim();
    if (configured && existsSync(configured)) return configured;
    const whereResult = await execFileAsync("where.exe", ["tailscale"], { windowsHide: true, timeout: 6000 }).catch(() => null);
    const first = whereResult?.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (first && existsSync(first)) return first;
    const common = [
      "C:\\Program Files\\Tailscale\\tailscale.exe",
      "C:\\Program Files (x86)\\Tailscale\\tailscale.exe"
    ];
    return common.find((item) => existsSync(item)) || "";
  }

  async function runTailscale(exePath: string, args: string[], timeout: number) {
    return execFileAsync(exePath, args, {
      windowsHide: true,
      timeout,
      maxBuffer: 1024 * 1024
    });
  }

  async function exposeWithTailscale(exePath: string, port: number) {
    const args = ["serve", "--bg", `--http=${port}`, `http://127.0.0.1:${port}`];
    const first = await runTailscale(exePath, args, 20000).catch((error) => error);
    if (!(first instanceof Error)) return { ok: true, message: first.stdout || "ok" };
    const fallback = await runTailscale(exePath, ["serve", "--bg", `--http=${port}`, `127.0.0.1:${port}`], 20000).catch((error) => error);
    if (!(fallback instanceof Error)) return { ok: true, message: fallback.stdout || "ok" };
    return { ok: false, message: fallback.message || first.message };
  }

  async function startLocalServer(port: number) {
    if (server?.listening) return;
    server = http.createServer((request, response) => {
      void handleHttpRequest(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server?.once("error", reject);
      server?.listen(port, "127.0.0.1", () => {
        server?.off("error", reject);
        resolve();
      });
    });
  }

  async function closeLocalServer() {
    if (!server) return;
    const current = server;
    server = null;
    await new Promise<void>((resolve) => {
      current.close(() => resolve());
    });
  }

  async function handleHttpRequest(request: IncomingMessage, response: ServerResponse) {
    const startedAt = new Date();
    let tool = inferToolNameFromRequest(request);
    let toolArgs: Record<string, unknown> | null = null;
    let statusCode = 500;
    let message = "";
    setSecurityHeaders(response);
    try {
      if (request.method === "OPTIONS") {
        statusCode = 204;
        message = "预检";
        response.writeHead(204);
        response.end();
        return;
      }
      const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
      if (!validateOrigin(request)) {
        statusCode = 403;
        message = "Origin denied";
        sendJson(response, statusCode, { error: "Origin denied." });
        return;
      }
      if (url.pathname === "/health") {
        statusCode = 200;
        message = "健康检查";
        sendJson(response, statusCode, { ok: true, status: state.status, service: "aistudy-mcp" });
        return;
      }
      if (!isAuthorized(request, url)) {
        statusCode = 401;
        message = "Unauthorized";
        response.setHeader("WWW-Authenticate", "Bearer");
        sendJson(response, statusCode, { error: "Unauthorized." });
        return;
      }
      if (url.pathname === "/mcp" && request.method === "POST") {
        const body = await readJsonBody(request);
        tool = inferToolNameFromJsonRpc(body as JsonRpcRequest) || tool;
        toolArgs = getJsonRpcToolArguments(body as JsonRpcRequest);
        const result = await handleRemoteJsonRpc(body as JsonRpcRequest);
        const hasError = Boolean(result && typeof result === "object" && "error" in result);
        statusCode = hasError ? 400 : 200;
        message = hasError ? getJsonRpcErrorMessage(result) : "MCP 调用完成";
        sendJson(response, statusCode, result);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/courses") {
        tool = "read_courses";
        sendJson(response, 200, await callReadOnlyTool("read_courses", {}));
        statusCode = 200;
        message = "读取知识库";
        return;
      }
      const mindMapMatch = url.pathname.match(/^\/api\/courses\/([^/]+)\/mindmap$/);
      if (request.method === "GET" && mindMapMatch) {
        tool = "read_current_mindmap";
        toolArgs = { courseId: decodeURIComponent(mindMapMatch[1]) };
        sendJson(response, 200, await callReadOnlyTool("read_current_mindmap", { courseId: decodeURIComponent(mindMapMatch[1]) }));
        statusCode = 200;
        message = "读取导图";
        return;
      }
      const searchMatch = url.pathname.match(/^\/api\/courses\/([^/]+)\/search$/);
      if (request.method === "GET" && searchMatch) {
        tool = "search_nodes";
        toolArgs = { courseId: decodeURIComponent(searchMatch[1]), query: url.searchParams.get("q") || "" };
        sendJson(response, 200, await callReadOnlyTool("search_nodes", {
          courseId: decodeURIComponent(searchMatch[1]),
          query: url.searchParams.get("q") || ""
        }));
        statusCode = 200;
        message = "搜索节点";
        return;
      }
      const documentMatch = url.pathname.match(/^\/api\/courses\/([^/]+)\/nodes\/([^/]+)\/document$/);
      if (request.method === "GET" && documentMatch) {
        tool = "read_node_document";
        toolArgs = {
          courseId: decodeURIComponent(documentMatch[1]),
          nodeId: decodeURIComponent(documentMatch[2])
        };
        sendJson(response, 200, await callReadOnlyTool("read_node_document", {
          courseId: decodeURIComponent(documentMatch[1]),
          nodeId: decodeURIComponent(documentMatch[2])
        }));
        statusCode = 200;
        message = "读取文档";
        return;
      }
      statusCode = 404;
      message = "Not found";
      sendJson(response, statusCode, { error: "Not found." });
    } catch (error) {
      statusCode = 500;
      message = error instanceof Error ? error.message : "Request failed.";
      sendJson(response, statusCode, { error: message });
    } finally {
      recordRemoteCall({
        startedAt,
        source: getRequestSource(request),
        endpoint: `${request.method || "GET"} ${request.url || "/"}`,
        tool,
        args: toolArgs,
        statusCode,
        message
      });
    }
  }

  async function handleRemoteJsonRpc(request: JsonRpcRequest) {
    if (request?.method === "tools/call") {
      const params = request.params && typeof request.params === "object" ? request.params as { name?: unknown; arguments?: unknown } : {};
      const config = await readConfig();
      if (typeof params.name !== "string" || !isRemoteToolAllowed(params.name, config.permissions)) {
        return {
          jsonrpc: "2.0",
          id: request.id ?? null,
          error: { code: -32000, message: "Remote MCP permission is disabled." }
        };
      }
      if (!REMOTE_READ_TOOLS.has(params.name)) {
        try {
          const response = await dependencies.runTrustedTool(params.name, params.arguments);
          return createToolCallResult(request, response);
        } catch (error) {
          return {
            jsonrpc: "2.0",
            id: request.id ?? null,
            error: { code: -32000, message: getErrorMessage(error) }
          };
        }
      }
    }
    const result = await dependencies.handleJsonRpcRequest(request) as {
      result?: { tools?: Array<{ name?: string }>; instructions?: string };
    };
    const config = await readConfig();
    if (request?.method === "initialize" && result.result) {
      result.result.instructions = [
        result.result.instructions || "",
        createRemoteInstructions(config.permissions)
      ].filter(Boolean).join("\n");
    }
    if (request?.method === "tools/list" && result.result?.tools) {
      result.result.tools = result.result.tools.filter((tool) => typeof tool.name === "string" && isRemoteToolAllowed(tool.name, config.permissions));
    }
    return result;
  }

  function createToolCallResult(request: JsonRpcRequest, response: { result?: { ok?: boolean; data?: unknown; summary?: string } }) {
    const result = response.result ?? { ok: false, summary: "MCP call failed.", data: null };
    return {
      jsonrpc: "2.0",
      id: request.id ?? null,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.data ?? result.summary ?? null, null, 2)
          }
        ],
        isError: result.ok === false
      }
    };
  }

  function createRemoteInstructions(permissions: McpRemoteAccessPermissions) {
    if (!permissions.edit) {
      return "Remote tailnet access is read-only. Edit, delete, write, append, locator, and copy-config tools are intentionally unavailable.";
    }
    const allowed = [
      permissions.course ? "course-management" : "",
      permissions.mindmap ? "mindmap-editing" : "",
      permissions.document ? "document-writing" : "",
      permissions.destructive ? "delete-tools" : ""
    ].filter(Boolean).join(", ");
    return `Remote tailnet edit is enabled only for configured groups: ${allowed || "none"}. Tools outside those groups are unavailable.`;
  }

  function isRemoteToolAllowed(name: string, permissions: McpRemoteAccessPermissions) {
    if (REMOTE_READ_TOOLS.has(name)) return true;
    if (!permissions.edit) return false;
    if (REMOTE_COURSE_EDIT_TOOLS.has(name)) return permissions.course;
    if (REMOTE_COURSE_DELETE_TOOLS.has(name)) return permissions.course && permissions.destructive;
    if (REMOTE_MINDMAP_EDIT_TOOLS.has(name)) return permissions.mindmap;
    if (REMOTE_MINDMAP_DELETE_TOOLS.has(name)) return permissions.mindmap && permissions.destructive;
    if (REMOTE_DOCUMENT_EDIT_TOOLS.has(name)) return permissions.document;
    return false;
  }

  async function callReadOnlyTool(name: string, args: Record<string, unknown>) {
    const response = await handleRemoteJsonRpc({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args }
    }) as { result?: { content?: Array<{ text?: string }> }; error?: { message?: string } };
    if (response.error) throw new Error(response.error.message || "MCP call failed.");
    const text = response.result?.content?.[0]?.text || "null";
    return JSON.parse(text);
  }

  function isAuthorized(request: IncomingMessage, url: URL) {
    const token = state.token;
    const authorization = String(request.headers.authorization || "");
    const headerToken = String(request.headers["x-aistudy-token"] || "");
    return authorization === `Bearer ${token}` || headerToken === token || url.searchParams.get("token") === token;
  }

  function validateOrigin(request: IncomingMessage) {
    const origin = request.headers.origin;
    if (!origin) return true;
    try {
      const originUrl = new URL(origin);
      const host = String(request.headers.host || "").split(":")[0].toLowerCase();
      const allowed = new Set([
        "127.0.0.1",
        "localhost",
        state.tailscale.ip.toLowerCase(),
        state.tailscale.dnsName.toLowerCase()
      ].filter(Boolean));
      return originUrl.hostname.toLowerCase() === host || allowed.has(originUrl.hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  async function readJsonBody(request: IncomingMessage) {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) throw new Error("Request body is too large.");
      chunks.push(buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  }

  function setSecurityHeaders(response: ServerResponse) {
    response.setHeader("Access-Control-Allow-Origin", "null");
    response.setHeader("Access-Control-Allow-Headers", "authorization, content-type, x-aistudy-token");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
  }

  function sendJson(response: ServerResponse, status: number, value: unknown) {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(value));
  }

  function recordRemoteCall(input: {
    startedAt: Date;
    source: string;
    endpoint: string;
    tool: string;
    args: Record<string, unknown> | null;
    statusCode: number;
    message: string;
  }) {
    const finishedAt = new Date();
    const record: McpRemoteCallRecord = {
      id: `${finishedAt.getTime()}-${Math.random().toString(16).slice(2)}`,
      startedAt: input.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      source: input.source,
      endpoint: input.endpoint,
      tool: input.tool || "request",
      status: input.statusCode >= 200 && input.statusCode < 400 ? "ok" : "error",
      statusCode: input.statusCode,
      durationMs: Math.max(0, finishedAt.getTime() - input.startedAt.getTime()),
      message: input.message
    };
    state = {
      ...state,
      calls: [record, ...state.calls].slice(0, MAX_REMOTE_CALL_RECORDS)
    };
    emitRemoteState(state);
    const change = createRemoteDataChange(record, input.args);
    if (change) dependencies.onDataChanged?.(change);
  }

  function getRequestSource(request: IncomingMessage) {
    const forwarded = String(request.headers["x-forwarded-for"] || "").split(",").map((item) => item.trim()).find(Boolean);
    const tailscaleUser = String(request.headers["tailscale-user-login"] || request.headers["x-tailscale-user-login"] || "").trim();
    const socketAddress = request.socket.remoteAddress || "";
    return tailscaleUser || forwarded || socketAddress || "unknown";
  }

  function inferToolNameFromRequest(request: IncomingMessage) {
    const rawUrl = request.url || "/";
    if (rawUrl === "/health") return "health_check";
    if (rawUrl === "/api/courses") return "read_courses";
    if (/^\/api\/courses\/[^/]+\/mindmap/.test(rawUrl)) return "read_current_mindmap";
    if (/^\/api\/courses\/[^/]+\/search/.test(rawUrl)) return "search_nodes";
    if (/^\/api\/courses\/[^/]+\/nodes\/[^/]+\/document/.test(rawUrl)) return "read_node_document";
    if (rawUrl === "/mcp") return "mcp";
    return "request";
  }

  function inferToolNameFromJsonRpc(request: JsonRpcRequest) {
    if (request.method !== "tools/call") return request.method || "";
    const params = request.params && typeof request.params === "object" ? request.params as { name?: unknown } : {};
    return typeof params.name === "string" ? params.name : "tools/call";
  }

  function getJsonRpcToolArguments(request: JsonRpcRequest) {
    if (request.method !== "tools/call") return null;
    const params = request.params && typeof request.params === "object" ? request.params as { arguments?: unknown } : {};
    return params.arguments && typeof params.arguments === "object" ? params.arguments as Record<string, unknown> : {};
  }

  function createRemoteDataChange(record: McpRemoteCallRecord, args: Record<string, unknown> | null): McpRemoteDataChange | null {
    if (record.status !== "ok") return null;
    const kind = getDataChangeKind(record.tool);
    if (!kind) return null;
    return {
      id: record.id,
      tool: record.tool,
      kind,
      courseId: getStringArg(args, "courseId"),
      nodeId: getStringArg(args, "nodeId"),
      changedAt: record.finishedAt,
      message: record.message
    };
  }

  function getDataChangeKind(tool: string): McpRemoteDataChange["kind"] | null {
    if (REMOTE_COURSE_EDIT_TOOLS.has(tool) || REMOTE_COURSE_DELETE_TOOLS.has(tool)) return "course";
    if (REMOTE_MINDMAP_EDIT_TOOLS.has(tool) || REMOTE_MINDMAP_DELETE_TOOLS.has(tool)) return "mindmap";
    if (REMOTE_DOCUMENT_EDIT_TOOLS.has(tool)) return "document";
    if (tool === "chrome_port_open_page") return "chrome";
    return null;
  }

  function getStringArg(args: Record<string, unknown> | null, key: string) {
    const value = args?.[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  function getJsonRpcErrorMessage(value: unknown) {
    if (!value || typeof value !== "object" || !("error" in value)) return "MCP 调用失败";
    const error = (value as { error?: { message?: unknown } }).error;
    return typeof error?.message === "string" ? error.message : "MCP 调用失败";
  }

  function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : "MCP 调用失败";
  }

  function createRemoteUrls(tailscale: McpRemoteAccessState["tailscale"], port: number) {
    const host = tailscale.dnsName || tailscale.ip;
    const base = host ? `http://${host}:${port}` : "";
    return {
      mcpUrl: base ? `${base}/mcp` : "",
      apiUrl: base ? `${base}/api/courses` : ""
    };
  }

  function createTailscaleState(input: Partial<McpRemoteAccessState["tailscale"]>): McpRemoteAccessState["tailscale"] {
    return {
      installed: Boolean(input.installed),
      online: Boolean(input.online),
      exePath: input.exePath || "",
      ip: input.ip || "",
      dnsName: input.dnsName || "",
      backendState: input.backendState || ""
    };
  }

  return {
    getState,
    setEnabled,
    setPermissions,
    restore,
    refresh,
    copyConnectionInfo,
    close: closeLocalServer
  };
}
