import React from "react";
import { Copy, Play, RefreshCw } from "lucide-react";
import type { CourseStore } from "../course/courseTypes";

type McpToolMode = "read" | "edit" | "control";
type McpToolState = "idle" | "running" | "success" | "error" | "disabled";

type McpToolRuntime = {
  id: string;
  mode: McpToolMode;
  title: string;
  description: string;
  enabled: boolean;
  state: McpToolState;
  callCount: number;
  successCount: number;
  errorCount: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastMessage: string;
};

type McpControlState = {
  enabled: boolean;
  editEnabled: boolean;
  status: "stopped" | "ready" | "busy";
  activeToolId: string | null;
  tools: McpToolRuntime[];
  lastResult: {
    toolId: string | null;
    ok: boolean;
    summary: string;
    data: unknown;
    finishedAt: string | null;
  };
};

type McpRunPayload = {
  toolId: string;
  courseId?: string;
  query?: string;
  title?: string;
};

type McpRemoteAccessPermissions = {
  edit: boolean;
  course: boolean;
  mindmap: boolean;
  document: boolean;
  destructive: boolean;
};

type McpRemoteAccessState = {
  enabled: boolean;
  status: "off" | "checking" | "ready" | "needs_tailscale" | "needs_login" | "error";
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
  permissions: McpRemoteAccessPermissions;
  calls: Array<{
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
  }>;
};

type McpDataChange = {
  id: string;
  tool: string;
  kind: "course" | "mindmap" | "document" | "chrome" | "unknown";
  courseId: string | null;
  nodeId: string | null;
  changedAt: string;
  message: string;
};

declare global {
  interface Window {
    aistudyMcp?: {
      state: () => Promise<McpControlState>;
      setEnabled: (input: { enabled?: boolean; editEnabled?: boolean }) => Promise<McpControlState>;
      setToolEnabled: (input: { toolId: string; enabled: boolean }) => Promise<McpControlState>;
      runTool: (input: McpRunPayload) => Promise<{ state: McpControlState; result: McpControlState["lastResult"] }>;
      remoteState: () => Promise<McpRemoteAccessState>;
      setRemoteEnabled: (input: { enabled: boolean }) => Promise<McpRemoteAccessState>;
      setRemotePermissions: (input: Partial<McpRemoteAccessPermissions>) => Promise<McpRemoteAccessState>;
      refreshRemote: () => Promise<McpRemoteAccessState>;
      copyRemote: () => Promise<{ copied: boolean; state: McpRemoteAccessState }>;
      onStateChanged: (callback: (state: McpControlState) => void) => () => void;
      onRemoteStateChanged: (callback: (state: McpRemoteAccessState) => void) => () => void;
      onDataChanged: (callback: (change: McpDataChange) => void) => () => void;
    };
  }
}

function getStateText(state: McpToolState) {
  if (state === "running") return "调用中";
  if (state === "success") return "完成";
  if (state === "error") return "异常";
  if (state === "disabled") return "停用";
  return "待命";
}

function formatDebugValue(value: unknown, maxLength = 4200) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n... output truncated` : text;
}

function createDebugText({
  tool,
  payload,
  result,
  error,
  startedAt,
  finishedAt
}: {
  tool: McpToolRuntime;
  payload: McpRunPayload;
  result?: McpControlState["lastResult"];
  error?: unknown;
  startedAt: string;
  finishedAt: string;
}) {
  const status = error ? "ERROR" : result?.ok ? "OK" : "ERROR";
  const errorMessage = error instanceof Error ? error.message : error ? String(error) : "";
  return [
    `PS AIstudy:\\MCP> Invoke-AIstudyMcpTool -Name ${tool.id}`,
    `StartedAt : ${startedAt}`,
    `FinishedAt: ${finishedAt}`,
    `Tool      : ${tool.title}`,
    `Mode      : ${tool.mode}`,
    `Status    : ${status}`,
    `Arguments : ${formatDebugValue(payload, 900)}`,
    `Summary   : ${errorMessage || result?.summary || "调用完成"}`,
    "",
    "Output:",
    formatDebugValue(result?.data ?? (errorMessage || null))
  ].join("\n");
}

function SwitchControl({
  checked,
  disabled,
  label,
  onChange
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      className={checked ? "mcp-switch on" : "mcp-switch"}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function McpControlPanel() {
  const [state, setState] = React.useState<McpControlState | null>(null);
  const [error, setError] = React.useState("");
  const [query, setQuery] = React.useState("MCP");
  const [nodeTitle, setNodeTitle] = React.useState("MCP编辑调用记录");
  const [courseStore, setCourseStore] = React.useState<CourseStore | null>(null);
  const [targetCourseId, setTargetCourseId] = React.useState("");
  const [debugEnabled, setDebugEnabled] = React.useState(false);
  const [debugText, setDebugText] = React.useState("PS AIstudy:\\MCP> 等待 MCP 执行测试...");
  const [remoteState, setRemoteState] = React.useState<McpRemoteAccessState | null>(null);
  const [remoteBusy, setRemoteBusy] = React.useState(false);
  const [remoteMonitorEnabled, setRemoteMonitorEnabled] = React.useState(false);

  React.useEffect(() => {
    let isCancelled = false;
    window.aistudyMcp?.state()
      .then((nextState) => {
        if (!isCancelled) setState(nextState);
      })
      .catch((loadError: unknown) => {
        if (!isCancelled) setError(loadError instanceof Error ? loadError.message : "MCP 状态读取失败。");
      });

    const dispose = window.aistudyMcp?.onStateChanged((nextState) => {
      setState(nextState);
      setError("");
    });
    const disposeRemote = window.aistudyMcp?.onRemoteStateChanged((nextState) => {
      setRemoteState(nextState);
    });

    return () => {
      isCancelled = true;
      dispose?.();
      disposeRemote?.();
    };
  }, []);

  React.useEffect(() => {
    if (!remoteMonitorEnabled || !window.aistudyMcp) return;
    let isCancelled = false;
    const timer = window.setInterval(() => {
      window.aistudyMcp?.remoteState()
        .then((nextState) => {
          if (!isCancelled) setRemoteState(nextState);
        })
        .catch(() => undefined);
    }, 1800);
    return () => {
      isCancelled = true;
      window.clearInterval(timer);
    };
  }, [remoteMonitorEnabled]);

  React.useEffect(() => {
    let isCancelled = false;
    window.aistudyMcp?.remoteState()
      .then((nextState) => {
        if (!isCancelled) setRemoteState(nextState);
      })
      .catch(() => {
        if (!isCancelled) setRemoteState(null);
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let isCancelled = false;
    window.aistudyCourses?.load()
      .then((store) => {
        if (!isCancelled) setCourseStore(store);
      })
      .catch(() => {
        if (!isCancelled) setCourseStore(null);
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  async function setControl(input: { enabled?: boolean; editEnabled?: boolean }) {
    if (!window.aistudyMcp) return;
    try {
      setState(await window.aistudyMcp.setEnabled(input));
      setError("");
    } catch (controlError) {
      setError(controlError instanceof Error ? controlError.message : "MCP 管控状态没有保存。");
    }
  }

  async function setToolEnabled(toolId: string, enabled: boolean) {
    if (!window.aistudyMcp) return;
    try {
      setState(await window.aistudyMcp.setToolEnabled({ toolId, enabled }));
      setError("");
    } catch (toolError) {
      setError(toolError instanceof Error ? toolError.message : "MCP 工具状态没有保存。");
    }
  }

  async function runTool(tool: McpToolRuntime) {
    if (!window.aistudyMcp) return;
    const startedAt = new Date().toLocaleString();
    const courseId = targetCourseId || undefined;
    const payload: McpRunPayload = tool.id === "search_nodes"
      ? { toolId: tool.id, courseId, query }
      : tool.id === "append_mindmap_node"
        ? { toolId: tool.id, courseId, title: nodeTitle }
        : { toolId: tool.id, courseId };
    setDebugText([
      `PS AIstudy:\\MCP> Invoke-AIstudyMcpTool -Name ${tool.id}`,
      `StartedAt : ${startedAt}`,
      `Tool      : ${tool.title}`,
      "Status    : RUNNING",
      `Arguments : ${formatDebugValue(payload, 900)}`
    ].join("\n"));
    try {
      const response = await window.aistudyMcp.runTool(payload);
      setState(response.state);
      setError("");
      setDebugText(createDebugText({
        tool,
        payload,
        result: response.result,
        startedAt,
        finishedAt: new Date().toLocaleString()
      }));
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "MCP 调用没有完成。");
      setDebugText(createDebugText({
        tool,
        payload,
        error: runError,
        startedAt,
        finishedAt: new Date().toLocaleString()
      }));
    }
  }

  async function setRemoteEnabled(enabled: boolean) {
    if (!window.aistudyMcp) return;
    setRemoteBusy(true);
    try {
      const nextState = await window.aistudyMcp.setRemoteEnabled({ enabled });
      setRemoteState(nextState);
      setError("");
    } catch (remoteError) {
      setError(remoteError instanceof Error ? remoteError.message : "内网访问状态没有保存。");
    } finally {
      setRemoteBusy(false);
    }
  }

  async function setRemotePermissions(input: Partial<McpRemoteAccessPermissions>) {
    if (!window.aistudyMcp) return;
    setRemoteBusy(true);
    try {
      const nextState = await window.aistudyMcp.setRemotePermissions(input);
      setRemoteState(nextState);
      setError("");
    } catch (remoteError) {
      setError(remoteError instanceof Error ? remoteError.message : "内网访问权限没有保存。");
    } finally {
      setRemoteBusy(false);
    }
  }

  async function refreshRemote() {
    if (!window.aistudyMcp) return;
    setRemoteBusy(true);
    try {
      setRemoteState(await window.aistudyMcp.refreshRemote());
      setError("");
    } catch (remoteError) {
      setError(remoteError instanceof Error ? remoteError.message : "内网访问检测没有完成。");
    } finally {
      setRemoteBusy(false);
    }
  }

  async function copyRemote() {
    if (!window.aistudyMcp) return;
    try {
      const response = await window.aistudyMcp.copyRemote();
      setRemoteState(response.state);
      setError("");
    } catch (remoteError) {
      setError(remoteError instanceof Error ? remoteError.message : "内网连接信息没有复制。");
    }
  }

  const tools = state?.tools ?? [];
  const readTools = tools.filter((tool) => tool.mode === "read");
  const editTools = tools.filter((tool) => tool.mode === "edit");
  const controlTools = tools.filter((tool) => tool.mode === "control");
  const targetCourse = targetCourseId ? courseStore?.courses.find((course) => course.id === targetCourseId) ?? null : null;
  const remoteAuthText = remoteState?.token ? `Bearer ${remoteState.token}` : "";
  const remotePermissions = remoteState?.permissions ?? { edit: false, course: false, mindmap: false, document: false, destructive: false };
  const remoteEditDisabled = remoteBusy || !remoteState?.enabled;
  const remoteGroupDisabled = remoteEditDisabled || !remotePermissions.edit;

  return (
    <div className="mcp-settings-panel" aria-label="MCP 控制台">
      <section className="mcp-settings-list" aria-label="MCP 总控">
        <article className="mcp-settings-row">
          <div className="mcp-settings-main">
            <span className={`mcp-lamp ${state?.status === "busy" ? "running" : state?.enabled ? "success" : "disabled"}`} />
            <div>
              <strong>服务</strong>
              <span>{state?.status === "busy" ? "调用中" : state?.enabled ? "已启用" : "已停用"}</span>
            </div>
          </div>
          <SwitchControl checked={Boolean(state?.enabled)} label="MCP 服务" onChange={(enabled) => void setControl({ enabled })} />
        </article>
        <article className="mcp-settings-row">
          <div className="mcp-settings-main">
            <span className={`mcp-lamp ${state?.editEnabled ? "success" : "disabled"}`} />
            <div>
              <strong>编辑许可</strong>
              <span>{state?.editEnabled ? "已允许" : "已关闭"}</span>
            </div>
          </div>
          <SwitchControl
            checked={Boolean(state?.editEnabled)}
            disabled={!state?.enabled}
            label="MCP 编辑许可"
            onChange={(editEnabled) => void setControl({ editEnabled })}
          />
        </article>
        <article className="mcp-settings-row">
          <div className="mcp-settings-main">
            <span className={`mcp-lamp ${targetCourseId ? "success" : "idle"}`} />
            <div>
              <strong>MCP 目标</strong>
              <span>{targetCourse ? targetCourse.name : "全库"}</span>
            </div>
          </div>
          <label className="mcp-settings-field mcp-target-field">
            <span>范围</span>
            <select value={targetCourseId} onChange={(event) => setTargetCourseId(event.target.value)}>
              <option value="">全库</option>
              {(courseStore?.courses ?? []).map((course) => (
                <option value={course.id} key={course.id}>{course.name}</option>
              ))}
            </select>
          </label>
        </article>
      </section>

      <section className="mcp-settings-list" aria-label="MCP 内网访问">
        <article className="mcp-settings-row">
          <div className="mcp-settings-main">
            <span className={`mcp-lamp ${getRemoteLampState(remoteState, remoteBusy)}`} />
            <div>
              <strong>内网访问</strong>
              <span>{getRemoteStatusText(remoteState, remoteBusy)}</span>
            </div>
          </div>
          <SwitchControl
            checked={Boolean(remoteState?.enabled)}
            disabled={remoteBusy}
            label="MCP 内网访问"
            onChange={(enabled) => void setRemoteEnabled(enabled)}
          />
        </article>
        <article className="mcp-settings-row">
          <div className="mcp-settings-main">
            <span className={`mcp-lamp ${remoteState?.mcpUrl ? "success" : "idle"}`} />
            <div>
              <strong>连接信息</strong>
              <span>{remoteState?.mcpUrl ? "可复制给其他设备" : "开启后生成"}</span>
            </div>
          </div>
          <div className="mcp-remote-lines" aria-label="MCP 内网连接信息">
            <code>MCP URL: {remoteState?.mcpUrl || ""}</code>
            <code>API URL: {remoteState?.apiUrl || ""}</code>
            <code>Authorization: {remoteAuthText}</code>
          </div>
          <div className="mcp-settings-actions">
            <button className="mcp-run-button" type="button" disabled={!remoteState?.mcpUrl} onClick={() => void copyRemote()}>
              <Copy size={14} />
              <span>复制</span>
            </button>
            <button className="mcp-run-button" type="button" disabled={remoteBusy} onClick={() => void refreshRemote()}>
              <RefreshCw size={14} />
              <span>刷新</span>
            </button>
          </div>
        </article>
        <article className="mcp-settings-row">
          <div className="mcp-settings-main">
            <span className={`mcp-lamp ${remoteState?.tailscale.online ? "success" : remoteState?.tailscale.installed ? "idle" : "disabled"}`} />
            <div>
              <strong>Tailscale</strong>
              <span>{getTailscaleText(remoteState)}</span>
            </div>
          </div>
          <span className="mcp-settings-fill" />
        </article>
        <article className="mcp-settings-row">
          <div className="mcp-settings-main">
            <span className={`mcp-lamp ${remotePermissions.edit ? "success" : "disabled"}`} />
            <div>
              <strong>远程编辑</strong>
              <span>{remotePermissions.edit ? "已允许" : "已关闭"}</span>
            </div>
          </div>
          <SwitchControl
            checked={remotePermissions.edit}
            disabled={remoteEditDisabled}
            label="MCP 远程编辑"
            onChange={(edit) => void setRemotePermissions({ edit })}
          />
        </article>
        <article className="mcp-settings-row mcp-permission-row">
          <div className="mcp-settings-main">
            <span className={`mcp-lamp ${remotePermissions.course ? "success" : "disabled"}`} />
            <div>
              <strong>知识库管理</strong>
              <span>{remotePermissions.course ? "已允许" : "已关闭"}</span>
            </div>
          </div>
          <SwitchControl checked={remotePermissions.course} disabled={remoteGroupDisabled} label="MCP 远程知识库管理" onChange={(course) => void setRemotePermissions({ course })} />
        </article>
        <article className="mcp-settings-row mcp-permission-row">
          <div className="mcp-settings-main">
            <span className={`mcp-lamp ${remotePermissions.mindmap ? "success" : "disabled"}`} />
            <div>
              <strong>导图编辑</strong>
              <span>{remotePermissions.mindmap ? "已允许" : "已关闭"}</span>
            </div>
          </div>
          <SwitchControl checked={remotePermissions.mindmap} disabled={remoteGroupDisabled} label="MCP 远程导图编辑" onChange={(mindmap) => void setRemotePermissions({ mindmap })} />
        </article>
        <article className="mcp-settings-row mcp-permission-row">
          <div className="mcp-settings-main">
            <span className={`mcp-lamp ${remotePermissions.document ? "success" : "disabled"}`} />
            <div>
              <strong>文档写入</strong>
              <span>{remotePermissions.document ? "已允许" : "已关闭"}</span>
            </div>
          </div>
          <SwitchControl checked={remotePermissions.document} disabled={remoteGroupDisabled} label="MCP 远程文档写入" onChange={(document) => void setRemotePermissions({ document })} />
        </article>
        <article className="mcp-settings-row mcp-permission-row">
          <div className="mcp-settings-main">
            <span className={`mcp-lamp ${remotePermissions.destructive ? "success" : "disabled"}`} />
            <div>
              <strong>删除操作</strong>
              <span>{remotePermissions.destructive ? "已允许" : "已关闭"}</span>
            </div>
          </div>
          <SwitchControl checked={remotePermissions.destructive} disabled={remoteGroupDisabled} label="MCP 远程删除操作" onChange={(destructive) => void setRemotePermissions({ destructive })} />
        </article>
        <article className="mcp-settings-row">
          <div className="mcp-settings-main">
            <span className={`mcp-lamp ${remoteMonitorEnabled ? "success" : "disabled"}`} />
            <div>
              <strong>调用监控</strong>
              <span>{remoteMonitorEnabled ? `最近 ${remoteState?.calls.length ?? 0} 条` : "已隐藏"}</span>
            </div>
          </div>
          <SwitchControl checked={remoteMonitorEnabled} label="MCP 远程调用监控" onChange={setRemoteMonitorEnabled} />
        </article>
        {remoteMonitorEnabled ? (
          <div className="mcp-remote-monitor" aria-label="MCP 远程调用记录">
            {(remoteState?.calls ?? []).slice(0, 8).map((call) => (
              <article className="mcp-remote-call" key={call.id}>
                <span className={`mcp-lamp ${call.status === "ok" ? "success" : "error"}`} />
                <strong>{call.tool}</strong>
                <span>{call.source}</span>
                <span>{call.statusCode}</span>
                <span>{call.durationMs}ms</span>
                <time>{formatCallTime(call.finishedAt)}</time>
              </article>
            ))}
            {(remoteState?.calls.length ?? 0) === 0 ? (
              <div className="mcp-remote-empty">暂无外部调用</div>
            ) : null}
          </div>
        ) : null}
      </section>

      {error ? <strong className="mcp-settings-message error">{error}</strong> : <span className="mcp-settings-message">{state?.lastResult.summary ?? "待命"}</span>}

      <div className="mcp-settings-tools" role="region" aria-label="MCP 工具列表">
        <ToolGroup title="读取" tools={readTools} query={query} setQuery={setQuery} onRun={runTool} onToggle={setToolEnabled} />
        <ToolGroup title="编辑" tools={editTools} nodeTitle={nodeTitle} setNodeTitle={setNodeTitle} onRun={runTool} onToggle={setToolEnabled} />
        <ToolGroup title="管控" tools={controlTools} onRun={runTool} onToggle={setToolEnabled} />
      </div>

      <section className="mcp-debug-section" aria-label="MCP 调试输出">
        <article className="mcp-settings-row mcp-debug-toggle-row">
          <div className="mcp-settings-main">
            <span className={`mcp-lamp ${debugEnabled ? "success" : "disabled"}`} />
            <div>
              <strong>调试输出</strong>
              <span>{debugEnabled ? "已显示" : "已隐藏"}</span>
            </div>
          </div>
          <SwitchControl checked={debugEnabled} label="MCP 调试输出" onChange={setDebugEnabled} />
        </article>
        {debugEnabled ? (
          <pre className="mcp-debug-console" aria-label="MCP PowerShell 调试输出">{debugText}</pre>
        ) : null}
      </section>
    </div>
  );
}

function getRemoteLampState(state: McpRemoteAccessState | null, busy: boolean) {
  if (busy || state?.status === "checking") return "running";
  if (state?.status === "ready") return "success";
  if (state?.status === "error") return "error";
  if (state?.enabled) return "idle";
  return "disabled";
}

function getRemoteStatusText(state: McpRemoteAccessState | null, busy: boolean) {
  if (busy || state?.status === "checking") return "检测中";
  if (!state || state.status === "off") return "未开启";
  if (state.status === "ready") return "已开放给 Tailscale 设备";
  if (state.status === "needs_tailscale") return "需要安装 Tailscale";
  if (state.status === "needs_login") return "需要登录 Tailscale";
  return state.lastMessage || "需要处理";
}

function getTailscaleText(state: McpRemoteAccessState | null) {
  if (!state) return "未检测";
  if (!state.tailscale.installed) return "未安装";
  if (!state.tailscale.online) return state.tailscale.backendState || "未连接";
  return state.tailscale.dnsName || state.tailscale.ip || "已连接";
}

function formatCallTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

function ToolGroup({
  title,
  tools,
  query,
  setQuery,
  nodeTitle,
  setNodeTitle,
  onRun,
  onToggle
}: {
  title: string;
  tools: McpToolRuntime[];
  query?: string;
  setQuery?: (value: string) => void;
  nodeTitle?: string;
  setNodeTitle?: (value: string) => void;
  onRun: (tool: McpToolRuntime) => void;
  onToggle: (toolId: string, enabled: boolean) => void;
}) {
  if (tools.length === 0) return null;

  return (
    <section className={`mcp-tool-group ${tools[0]?.mode ?? ""}`} aria-label={title}>
      <div className="mcp-group-title">
        <h2>{title}</h2>
        <span>{tools.length}</span>
      </div>
      <div className="mcp-settings-list">
        {tools.map((tool) => {
          const disabled = tool.state === "disabled" || tool.state === "running";
          return (
            <article
              aria-label={`${tool.title}：${getStateText(tool.state)}。${tool.description}`}
              className={tool.state === "running" ? "mcp-settings-row active" : "mcp-settings-row"}
              key={tool.id}
            >
              <div className="mcp-settings-main">
                <span className={`mcp-lamp ${tool.state}`} />
                <div>
                  <strong>{tool.title}</strong>
                  <span>{getStateText(tool.state)}</span>
                </div>
              </div>
              {tool.id === "search_nodes" && setQuery ? (
                <label className="mcp-settings-field">
                  <span>关键词</span>
                  <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={40} />
                </label>
              ) : tool.id === "append_mindmap_node" && setNodeTitle ? (
                <label className="mcp-settings-field">
                  <span>节点名</span>
                  <input value={nodeTitle} onChange={(event) => setNodeTitle(event.target.value)} maxLength={40} />
                </label>
              ) : (
                <span className="mcp-settings-fill" />
              )}
              <div className="mcp-settings-actions">
                <SwitchControl checked={tool.enabled} label={`${tool.title} 开关`} onChange={(checked) => onToggle(tool.id, checked)} />
                <button className="mcp-run-button" type="button" disabled={disabled} onClick={() => onRun(tool)}>
                  <Play size={14} />
                  <span>执行</span>
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
