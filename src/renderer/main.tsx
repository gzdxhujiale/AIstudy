import React from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsDown,
  ChevronsRight,
  ClipboardList,
  Download,
  ExternalLink,
  FileText,
  Folder,
  GitBranch,
  Globe2,
  GraduationCap,
  Keyboard,
  Pause,
  Play,
  PlugZap,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  X
} from "lucide-react";
import { AiAssistantPanel } from "./features/assistant/AiAssistantPanel";
import { ChromePortManager } from "./features/chromePorts/ChromePortManager";
import { InformationCollectionPanel } from "./features/collection/InformationCollectionPanel";
import { CourseSidebar } from "./features/course/CourseSidebar";
import { courseApi } from "./features/course/courseService";
import type { Course, CourseSection, CourseStore, CourseSyncStatus } from "./features/course/courseTypes";
import { ExamWorkspace } from "./features/exam/ExamWorkspace";
import { McpControlPanel } from "./features/mcp/McpControlPanel";
import { MindMapCatalog, type MindMapCatalogCollapseRequest } from "./features/mindmap/MindMapCatalog";
import {
  formatMindMapShortcutFromEvent,
  MIND_MAP_BRANCH_SHORTCUTS,
  readMindMapShortcutSettings,
  resetMindMapShortcutSettings,
  writeMindMapShortcutSettings,
  type MindMapBranchShortcutCommand,
  type MindMapShortcutSettings
} from "./features/mindmap/mindMapShortcutSettings";
import {
  MindMapWorkspace,
  type WorkspaceCatalogBoundaryRequest,
  type WorkspaceEditorMode,
  type WorkspaceModeChangeRequest,
  type WorkspaceNodeDeletionRequest,
  type WorkspaceNodeSelectionRequest
} from "./features/mindmap/MindMapWorkspace";
import type { MindMapOutlineItem, MindMapSelectedNode } from "./features/mindmap/mindMapTypes";
import { TextbookPdfWindow } from "./features/textbook/TextbookPdfWindow";
import { VocabularyCapturePanel } from "./features/vocabulary/VocabularyCapturePanel";
import { startCoreFeatureWarmup } from "./lib/performanceWarmup";
import { drainBeforeCloseSaves } from "./lib/saveDrain";
import "./styles.css";

declare global {
  interface Window {
    aistudyLifecycle?: {
      onBeforeClose: (callback: () => Promise<unknown> | unknown) => () => void;
    };
    aistudyClipboard?: {
      writeText: (text: string) => Promise<boolean>;
    };
    aistudyCourseLocators?: {
      createPath: (input: {
        courseId: string;
        courseName: string;
        courseDescription: string;
        sectionId: string | null;
        sectionName: string;
      }) => Promise<string>;
    };
  }
}

type McpDataChange = {
  id: string;
  tool: string;
  kind: "course" | "mindmap" | "document" | "chrome" | "unknown";
  courseId: string | null;
  nodeId: string | null;
  changedAt: string;
  message: string;
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

type ErrorLogEntry = {
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

type AppErrorBoundaryState = {
  error: Error | null;
};

class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-error-fallback" role="alert">
          <strong>应用运行异常</strong>
          <span>页面暂时没有正常打开，可以先重新载入；详细信息会记录到报错日志。</span>
          <button type="button" onClick={() => window.location.reload()}>
            重新载入
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

type CourseDialogMode = "create" | "edit";
type AppSection = "knowledge" | "collection" | "exam" | "assistant" | "chromePorts" | "vocabulary";
type DetailPaneMode = "catalog" | "format";
type SettingsPage = "runtime" | "mcp" | "shortcuts" | "updates" | "errorLogs";

function normalizeWorkspaceEditorMode(value: unknown): WorkspaceEditorMode {
  return value === "word" || value === "textbook" ? value : "mindmap";
}

function getCourseWorkspaceMode(store: CourseStore) {
  const activeCourse = store.courses.find((course) => course.id === store.activeCourseId) ?? null;
  return normalizeWorkspaceEditorMode(activeCourse?.lastWorkspaceMode);
}

declare global {
  interface Window {
    aistudyUpdates?: {
      loadInfo: () => Promise<UpdateManagerInfo>;
      check: () => Promise<UpdateCheckResult>;
      download: (downloadUrl: string, expectedSize?: number) => Promise<UpdateDownloadResult>;
      pauseDownload: () => Promise<boolean>;
      resumeDownload: () => Promise<boolean>;
      cancelDownload: () => Promise<boolean>;
      install: (filePath: string) => Promise<boolean>;
      openReleasePage: (releaseUrl: string) => Promise<boolean>;
      onDownloadProgress: (callback: (progress: UpdateDownloadProgress) => void) => () => void;
    };
    aistudyErrorLogs?: {
      list: (limit?: number) => Promise<ErrorLogEntry[]>;
    };
    aistudyRuntime?: {
      diagnose: () => Promise<RuntimeDiagnosticResult>;
      copyDiagnosticReport: () => Promise<RuntimeDiagnosticReportCopyResult>;
      openDataRoot: () => Promise<boolean>;
    };
  }
}

function formatFileSize(size: number) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString();
}

function formatDateTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function getDiagnosticStatusText(status: RuntimeDiagnosticStatus) {
  if (status === "ok") return "正常";
  if (status === "warning") return "需关注";
  if (status === "error") return "不可用";
  return "未启用";
}

async function loadUpdateInfo() {
  if (!window.aistudyUpdates) {
    throw new Error("更新服务不可用。");
  }
  return window.aistudyUpdates.loadInfo();
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [activePage, setActivePage] = React.useState<SettingsPage>("runtime");
  const [updateInfo, setUpdateInfo] = React.useState<UpdateManagerInfo | null>(null);
  const [checkResult, setCheckResult] = React.useState<UpdateCheckResult | null>(null);
  const [downloadResult, setDownloadResult] = React.useState<UpdateDownloadResult | null>(null);
  const [downloadProgress, setDownloadProgress] = React.useState<UpdateDownloadProgress | null>(null);
  const [diagnosticResult, setDiagnosticResult] = React.useState<RuntimeDiagnosticResult | null>(null);
  const [isCheckingRuntime, setIsCheckingRuntime] = React.useState(false);
  const [runtimeMessage, setRuntimeMessage] = React.useState("");
  const [errorLogs, setErrorLogs] = React.useState<ErrorLogEntry[]>([]);
  const [isLoadingErrorLogs, setIsLoadingErrorLogs] = React.useState(false);
  const [errorLogMessage, setErrorLogMessage] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [error, setError] = React.useState("");
  const [isChecking, setIsChecking] = React.useState(false);
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [lastCheckedAt, setLastCheckedAt] = React.useState("");
  const [shortcutSettings, setShortcutSettings] = React.useState<MindMapShortcutSettings>(() => readMindMapShortcutSettings());

  React.useEffect(() => {
    loadUpdateInfo()
      .then((info) => {
        setUpdateInfo(info);
        setError("");
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "更新服务初始化失败。");
      });
  }, []);

  React.useEffect(() => {
    if (!window.aistudyUpdates?.onDownloadProgress) return undefined;
    return window.aistudyUpdates.onDownloadProgress((progress) => {
      setDownloadProgress(progress);
      if (progress.status === "complete") {
        setStatus("安装包下载完成，可以开始安装。");
        return;
      }
      if (progress.status === "paused") {
        setStatus("下载已暂停。");
        return;
      }
      if (progress.status === "cancelled") {
        setStatus("下载已取消。");
        return;
      }
      if (progress.totalBytes > 0) {
        setStatus(`正在下载更新：${progress.percent}%`);
      } else {
        setStatus("正在下载更新...");
      }
    });
  }, []);

  const runRuntimeDiagnostics = React.useCallback(() => {
    if (!window.aistudyRuntime) {
      setRuntimeMessage("环境检查暂时不可用。");
      return;
    }

    setIsCheckingRuntime(true);
    setRuntimeMessage("");
    window.aistudyRuntime.diagnose()
      .then((result) => {
        setDiagnosticResult(result);
        const issueCount = result.summary.warning + result.summary.error;
        setRuntimeMessage(issueCount > 0 ? `检查完成，有 ${issueCount} 项需要关注。` : "检查完成，关键环境正常。");
      })
      .catch(() => {
        setDiagnosticResult(null);
        setRuntimeMessage("环境检查没有完成，请稍后再试。");
      })
      .finally(() => setIsCheckingRuntime(false));
  }, []);

  const copyRuntimeDiagnosticReport = React.useCallback(() => {
    if (!window.aistudyRuntime) {
      setRuntimeMessage("诊断报告暂时不可用。");
      return;
    }

    setRuntimeMessage("正在生成诊断报告...");
    window.aistudyRuntime.copyDiagnosticReport()
      .then((result) => {
        setRuntimeMessage("诊断报告已复制，可以直接发给协助排查的人。");
        setDiagnosticResult(result.diagnostic);
      })
      .catch(() => {
        setRuntimeMessage("诊断报告暂时无法复制，请稍后再试。");
      });
  }, []);

  React.useEffect(() => {
    if (activePage === "runtime" && !diagnosticResult && !isCheckingRuntime) {
      runRuntimeDiagnostics();
    }
  }, [activePage, diagnosticResult, isCheckingRuntime, runRuntimeDiagnostics]);

  const loadErrorLogs = React.useCallback(() => {
    if (!window.aistudyErrorLogs) {
      setErrorLogMessage("报错日志暂时不可用。");
      return;
    }

    setIsLoadingErrorLogs(true);
    setErrorLogMessage("");
    window.aistudyErrorLogs.list(50)
      .then((logs) => {
        setErrorLogs(logs);
        setErrorLogMessage(logs.length ? "" : "暂无报错记录。");
      })
      .catch(() => {
        setErrorLogs([]);
        setErrorLogMessage("报错日志暂时无法读取，请稍后再试。");
      })
      .finally(() => setIsLoadingErrorLogs(false));
  }, []);

  React.useEffect(() => {
    if (activePage === "errorLogs") {
      loadErrorLogs();
    }
  }, [activePage, loadErrorLogs]);

  const checkUpdate = React.useCallback(() => {
    if (!window.aistudyUpdates) return;
    setIsChecking(true);
    setStatus("正在检测更新...");
    setError("");
    setDownloadResult(null);
    setDownloadProgress(null);

    window.aistudyUpdates.check()
      .then((result) => {
        setCheckResult(result);
        setLastCheckedAt(new Date().toLocaleString());
        setStatus(result.hasUpdate ? `检测到新版本 ${result.latestVersion}` : "当前已是最新版本。");
      })
      .catch((checkError: unknown) => {
        setCheckResult(null);
        setStatus("");
        setError(checkError instanceof Error ? checkError.message : "检测更新失败。");
      })
      .finally(() => setIsChecking(false));
  }, []);

  const downloadUpdate = React.useCallback(() => {
    if (!window.aistudyUpdates || !checkResult?.downloadUrl) return;
    setIsDownloading(true);
    setStatus("正在下载安装包...");
    setError("");
    setDownloadResult(null);
    setDownloadProgress({
      fileName: checkResult.assetName || "AIstudy 安装包",
      downloadedBytes: 0,
      totalBytes: checkResult.assetSize || 0,
      percent: 0,
      status: "starting"
    });

    window.aistudyUpdates.download(checkResult.downloadUrl, checkResult.assetSize)
      .then((result) => {
        setDownloadResult(result);
        setDownloadProgress({
          fileName: result.fileName,
          downloadedBytes: result.fileSize,
          totalBytes: result.fileSize,
          percent: 100,
          status: "complete"
        });
        setStatus("下载完成，正在启动安装程序...");
        return window.aistudyUpdates?.install(result.filePath);
      })
      .then(() => {
        setStatus("安装程序已启动，当前应用将自动关闭。");
      })
      .catch((downloadError: unknown) => {
        const message = downloadError instanceof Error ? downloadError.message : "下载更新失败。";
        if (message.includes("取消")) {
          setStatus("下载已取消。");
          setDownloadProgress(null);
          return;
        }
        setError(message);
      })
      .finally(() => setIsDownloading(false));
  }, [checkResult]);

  const pauseDownload = React.useCallback(() => {
    if (!window.aistudyUpdates) return;
    void window.aistudyUpdates.pauseDownload()
      .then((paused) => {
        if (!paused) return;
        setStatus("下载已暂停。");
        setDownloadProgress((current) => current ? { ...current, status: "paused" } : current);
      })
      .catch((pauseError: unknown) => {
        setError(pauseError instanceof Error ? pauseError.message : "下载暂时无法暂停。");
      });
  }, []);

  const resumeDownload = React.useCallback(() => {
    if (!window.aistudyUpdates) return;
    void window.aistudyUpdates.resumeDownload()
      .then((resumed) => {
        if (!resumed) return;
        setStatus("继续下载更新...");
        setDownloadProgress((current) => current ? { ...current, status: "downloading" } : current);
      })
      .catch((resumeError: unknown) => {
        setError(resumeError instanceof Error ? resumeError.message : "下载暂时无法继续。");
      });
  }, []);

  const cancelDownload = React.useCallback(() => {
    if (!window.aistudyUpdates) return;
    void window.aistudyUpdates.cancelDownload()
      .then((cancelled) => {
        if (!cancelled) return;
        setIsDownloading(false);
        setDownloadProgress(null);
        setDownloadResult(null);
        setStatus("下载已取消。");
      })
      .catch((cancelError: unknown) => {
        setError(cancelError instanceof Error ? cancelError.message : "下载暂时无法取消。");
      });
  }, []);

  const installUpdate = React.useCallback(() => {
    if (!window.aistudyUpdates || !downloadResult?.filePath) return;
    setStatus("正在启动安装程序...");
    setError("");
    window.aistudyUpdates.install(downloadResult.filePath)
      .then(() => setStatus("安装程序已启动，当前应用将自动关闭。"))
      .catch((installError: unknown) => {
        setError(installError instanceof Error ? installError.message : "安装程序没有启动。");
        setStatus("");
      });
  }, [downloadResult]);

  const updateShortcut = React.useCallback((command: MindMapBranchShortcutCommand, shortcut: string) => {
    setShortcutSettings((current) => {
      const next = { ...current, [command]: shortcut };
      writeMindMapShortcutSettings(next);
      return next;
    });
  }, []);

  const captureShortcut = React.useCallback((command: MindMapBranchShortcutCommand, event: React.KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Backspace" || event.key === "Delete") {
      updateShortcut(command, "");
      return;
    }
    const shortcut = formatMindMapShortcutFromEvent(event);
    if (shortcut) {
      updateShortcut(command, shortcut);
    }
  }, [updateShortcut]);

  const resetAllShortcuts = React.useCallback(() => {
    setShortcutSettings(resetMindMapShortcutSettings());
  }, []);

  const updateStateLabel = checkResult ? (checkResult.hasUpdate ? "发现新版本" : "已是最新") : "待检测";
  const updateStateClass = checkResult ? (checkResult.hasUpdate ? "available" : "latest") : "idle";
  const updateHeadline = checkResult
    ? (checkResult.hasUpdate ? `发现可更新版本 ${checkResult.latestVersion}` : "当前已是最新版本")
    : "检查是否有可用更新";
  const updateDescription = checkResult
    ? (checkResult.hasUpdate
      ? "新版本已准备好，你可以下载安装包并启动安装。"
      : `当前版本 ${updateInfo?.appVersion ?? checkResult.currentVersion} 已与线上版本一致。`)
    : "点击检测更新后，将自动对比线上发布版本。";
  const onlineVersion = checkResult?.latestVersion ?? "未检测";
  const downloadDescription = downloadResult
    ? `已下载 ${downloadResult.fileName}${downloadResult.fileSize ? `（${formatFileSize(downloadResult.fileSize)}）` : ""}`
    : (checkResult?.hasUpdate ? "下载完成后自动启动安装程序。" : "检测到可更新版本后可用。");
  const installDescription = downloadResult ? "启动安装程序并退出当前应用。" : "安装包下载完成后可用。";
  const isDownloadPaused = downloadProgress?.status === "paused";
  const visibleDownloadProgress = downloadProgress && (isDownloading || downloadProgress.status === "complete" || isDownloadPaused) ? downloadProgress : null;
  const progressPercent = visibleDownloadProgress ? Math.max(0, Math.min(100, visibleDownloadProgress.percent)) : 0;
  const progressSizeText = visibleDownloadProgress
    ? (visibleDownloadProgress.totalBytes > 0
      ? `${formatFileSize(visibleDownloadProgress.downloadedBytes)} / ${formatFileSize(visibleDownloadProgress.totalBytes)}`
      : formatFileSize(visibleDownloadProgress.downloadedBytes))
    : "";
  const settingsPageTitle = activePage === "runtime"
    ? "环境检查"
    : activePage === "mcp"
      ? "MCP 控制台"
      : activePage === "shortcuts"
        ? "快捷键"
        : activePage === "updates"
          ? "更新管理"
          : "报错日志";

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-label="设置">
        <aside className="settings-nav">
          <div className="settings-title">
            <Settings size={18} />
            <span>设置</span>
          </div>
          <button className={activePage === "runtime" ? "settings-nav-item active" : "settings-nav-item"} type="button" onClick={() => setActivePage("runtime")}>
            <CheckCircle2 size={16} />
            <span>环境检查</span>
          </button>
          <button className={activePage === "mcp" ? "settings-nav-item active" : "settings-nav-item"} type="button" onClick={() => setActivePage("mcp")}>
            <PlugZap size={16} />
            <span>MCP 控制台</span>
          </button>
          <button className={activePage === "shortcuts" ? "settings-nav-item active" : "settings-nav-item"} type="button" onClick={() => setActivePage("shortcuts")}>
            <Keyboard size={16} />
            <span>快捷键</span>
          </button>
          <button className={activePage === "updates" ? "settings-nav-item active" : "settings-nav-item"} type="button" onClick={() => setActivePage("updates")}>
            <GitBranch size={16} />
            <span>更新管理</span>
          </button>
          <button className={activePage === "errorLogs" ? "settings-nav-item active" : "settings-nav-item"} type="button" onClick={() => setActivePage("errorLogs")}>
            <AlertCircle size={16} />
            <span>报错日志</span>
          </button>
        </aside>

        <main className="settings-content">
          <header className="settings-header">
            <div>
              <h2 className="settings-page-title">{settingsPageTitle}</h2>
            </div>
            <button className="icon-button" title="关闭" aria-label="关闭设置" type="button" onClick={onClose}>
              <X size={17} />
            </button>
          </header>

          {activePage === "runtime" ? (
            <div className="runtime-check-panel">
              <section className="settings-section runtime-check-intro">
                <div className="settings-section-heading">
                  <div>
                    <h3>一键检查新机器运行环境</h3>
                    <p>检查数据目录、数据库、Chrome、端口、信息采集工具和更新服务。缺少的能力只会提示处理方式，不影响核心编辑区打开。</p>
                  </div>
                  <div className="runtime-check-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={copyRuntimeDiagnosticReport}
                      disabled={isCheckingRuntime}
                    >
                      <FileText size={15} />
                      复制报告
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void window.aistudyRuntime?.openDataRoot?.()}
                    >
                      <Folder size={15} />
                      数据目录
                    </button>
                    <button className="primary-button" type="button" onClick={runRuntimeDiagnostics} disabled={isCheckingRuntime}>
                      <RefreshCw size={15} />
                      {isCheckingRuntime ? "检查中" : "一键检查"}
                    </button>
                  </div>
                </div>
              </section>

              {runtimeMessage ? <p className="update-status">{runtimeMessage}</p> : null}

              {diagnosticResult ? (
                <>
                  <section className="runtime-summary" aria-label="环境检查汇总">
                    <span><strong>{diagnosticResult.summary.ok}</strong> 正常</span>
                    <span><strong>{diagnosticResult.summary.warning}</strong> 需关注</span>
                    <span><strong>{diagnosticResult.summary.error}</strong> 不可用</span>
                    <span><strong>{diagnosticResult.summary.disabled}</strong> 未启用</span>
                  </section>

                  <div className="runtime-check-list" aria-label="环境检查结果">
                    {diagnosticResult.items.map((item) => (
                      <article className={`runtime-check-item ${item.status}`} key={item.id}>
                        <div className="runtime-check-state" aria-hidden="true">
                          {item.status === "ok" ? <CheckCircle2 size={18} /> : item.status === "error" ? <AlertCircle size={18} /> : <RefreshCw size={18} />}
                        </div>
                        <div className="runtime-check-copy">
                          <div className="runtime-check-title">
                            <strong>{item.name}</strong>
                            <span>{getDiagnosticStatusText(item.status)}</span>
                          </div>
                          <p>{item.message}</p>
                          <em>{item.action}</em>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <div className="pane-empty-state runtime-empty-state">
                  <strong>{isCheckingRuntime ? "正在检查环境" : "点击一键检查"}</strong>
                </div>
              )}
            </div>
          ) : activePage === "mcp" ? (
            <McpControlPanel />
          ) : activePage === "shortcuts" ? (
            <div className="shortcut-settings-panel">
              <section className="shortcut-settings-list" aria-label="导图快捷键">
                {MIND_MAP_BRANCH_SHORTCUTS.map((item) => (
                  <article className="shortcut-settings-row" key={item.command}>
                    <div className="shortcut-settings-main">
                      <strong>{item.label}</strong>
                    </div>
                    <input
                      value={shortcutSettings[item.command] || "未设置"}
                      readOnly
                      onKeyDown={(event) => captureShortcut(item.command, event)}
                      onFocus={(event) => event.currentTarget.select()}
                      aria-label={`${item.label}快捷键`}
                    />
                    <button type="button" onClick={() => updateShortcut(item.command, item.defaultShortcut)}>
                      恢复
                    </button>
                  </article>
                ))}
              </section>
              <div className="shortcut-settings-actions">
                <button type="button" onClick={resetAllShortcuts}>全部恢复</button>
              </div>
            </div>
          ) : activePage === "updates" ? (
          <div className="update-panel">
            <section className={`windows-update-hero ${updateStateClass}`}>
              <div className="windows-update-main">
                <div className="windows-update-mark" aria-hidden="true">
                  <RefreshCw size={56} strokeWidth={1.9} />
                  <span>
                    <CheckCircle2 size={18} />
                  </span>
                </div>
                <div className="windows-update-copy">
                  <p className="section-kicker">版本状态</p>
                  <h3>{updateHeadline}</h3>
                  <p>{updateDescription}</p>
                  <p className="update-check-time">
                    {lastCheckedAt ? `上次检查时间：${lastCheckedAt}` : `当前版本：${updateInfo?.appVersion ?? "-"}`}
                  </p>
                </div>
              </div>
              <button className="primary-button update-check-button" type="button" onClick={checkUpdate} disabled={isChecking || isDownloading}>
                <RefreshCw size={15} />
                {isChecking ? "检测中" : "检测更新"}
              </button>
            </section>

            {status ? <p className="update-status">{status}</p> : null}
            {error ? <p className="status-message error">{error}</p> : null}

            {checkResult?.hasUpdate ? (
              <section className="release-card" aria-label="新版本更新内容">
                <div className="release-card-heading">
                  <div>
                    <p className="section-kicker">更新内容</p>
                    <h3>版本 {checkResult.latestVersion}</h3>
                  </div>
                  {checkResult.publishedAt ? <span>{formatDate(checkResult.publishedAt)}</span> : null}
                </div>

                <ol className="release-notes">
                  {checkResult.notes.map((note, index) => (
                    <li key={`${note}-${index}`}>{note}</li>
                  ))}
                </ol>

                {checkResult.assetName ? (
                  <p className="release-asset">
                    安装包：{checkResult.assetName}
                    {checkResult.assetSize ? `（${formatFileSize(checkResult.assetSize)}）` : ""}
                  </p>
                ) : (
                  <p className="release-asset warning">该版本未找到 Windows 安装包。</p>
                )}
              </section>
            ) : null}

            <section className="update-options" aria-label="更新选项">
              <p className="settings-section-label">更多选项</p>
              <button
                className="update-option-row"
                type="button"
                onClick={downloadUpdate}
                disabled={!checkResult?.hasUpdate || !checkResult.downloadUrl || isDownloading}
              >
                <span className="update-option-icon"><Download size={18} /></span>
                <span className="update-option-copy">
                  <strong>{isDownloading ? "正在下载更新" : "下载并安装更新"}</strong>
                  <span>{downloadDescription}</span>
                </span>
                <span className="update-option-meta">{onlineVersion}</span>
              </button>
              {visibleDownloadProgress ? (
                <div className="update-download-progress" aria-label="下载进度">
                  <div className="update-progress-heading">
                    <span>
                      {visibleDownloadProgress.status === "complete"
                        ? "下载完成"
                        : visibleDownloadProgress.status === "paused"
                          ? "已暂停"
                          : "正在下载"}
                    </span>
                    <strong>{progressPercent}%</strong>
                  </div>
                  <div className="update-progress-track" aria-hidden="true">
                    <span style={{ width: `${progressPercent}%` }} />
                  </div>
                  <div className="update-progress-meta">
                    <span>{visibleDownloadProgress.fileName}</span>
                    <span>{progressSizeText}</span>
                  </div>
                  {visibleDownloadProgress.status !== "complete" ? (
                    <div className="update-progress-actions" aria-label="下载控制">
                      <button type="button" onClick={isDownloadPaused ? resumeDownload : pauseDownload}>
                        {isDownloadPaused ? <Play size={14} /> : <Pause size={14} />}
                        <span>{isDownloadPaused ? "继续" : "暂停"}</span>
                      </button>
                      <button type="button" onClick={cancelDownload}>
                        <X size={14} />
                        <span>取消</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <button className="update-option-row" type="button" onClick={installUpdate} disabled={!downloadResult}>
                <span className="update-option-icon"><CheckCircle2 size={18} /></span>
                <span className="update-option-copy">
                  <strong>安装更新</strong>
                  <span>{installDescription}</span>
                </span>
                <span className="update-option-meta">{downloadResult ? "可安装" : updateStateLabel}</span>
              </button>
              <button
                className="update-option-row"
                type="button"
                disabled={!checkResult?.releaseUrl}
                onClick={() => checkResult?.releaseUrl && void window.aistudyUpdates?.openReleasePage(checkResult.releaseUrl)}
              >
                <span className="update-option-icon"><ExternalLink size={18} /></span>
                <span className="update-option-copy">
                  <strong>查看发布页</strong>
                  <span>打开线上版本页面，查看完整发布说明。</span>
                </span>
                <span className="update-option-meta">{checkResult?.publishedAt ? formatDate(checkResult.publishedAt) : ""}</span>
              </button>
            </section>
          </div>
          ) : (
          <div className="error-log-panel">
            <section className="settings-section error-log-intro">
              <div className="settings-section-heading">
                <div>
                  <h3>最近的报错记录</h3>
                  <p>这里会记录操作失败的时间和位置，方便后续排查；页面不会展示代码细节。</p>
                </div>
                <button className="secondary-button" type="button" onClick={loadErrorLogs} disabled={isLoadingErrorLogs}>
                  <RefreshCw size={15} />
                  {isLoadingErrorLogs ? "读取中" : "刷新"}
                </button>
              </div>
            </section>

            {errorLogMessage ? <p className="update-status">{errorLogMessage}</p> : null}

            {errorLogs.length ? (
              <div className="error-log-list" aria-label="报错日志列表">
                {errorLogs.map((log) => (
                  <article className="error-log-item" key={log.id}>
                    <div className="error-log-main">
                      <strong>{log.userMessage || "有一个操作没有完成"}</strong>
                      <span>{formatDateTime(log.createdAt)}</span>
                    </div>
                    <div className="error-log-meta">
                      <span>{log.source}</span>
                      <span>编号 {log.errorCode || log.id.slice(0, 8)}</span>
                      {log.retryable ? <span>可重试</span> : <span>需处理</span>}
                    </div>
                    {log.reason || log.action ? (
                      <p className="error-log-detail">
                        {log.reason ? `原因：${log.reason}` : ""}
                        {log.reason && log.action ? " " : ""}
                        {log.action ? `建议：${log.action}` : ""}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : null}
          </div>
          )}
        </main>
      </section>
    </div>
  );
}

function App() {
  const [courses, setCourses] = React.useState<Course[]>([]);
  const [courseSections, setCourseSections] = React.useState<CourseSection[]>([]);
  const [activeCourseId, setActiveCourseId] = React.useState<string | null>(null);
  const [isHydrated, setIsHydrated] = React.useState(false);
  const [hasLoadedCourseStore, setHasLoadedCourseStore] = React.useState(false);
  const [courseSyncStatus, setCourseSyncStatus] = React.useState<CourseSyncStatus>({ state: "saved", pendingCount: 0 });
  const [dialogMode, setDialogMode] = React.useState<CourseDialogMode | null>(null);
  const [editingCourseId, setEditingCourseId] = React.useState<string | null>(null);
  const [creatingCourseSectionId, setCreatingCourseSectionId] = React.useState<string | null>(null);
  const [draftName, setDraftName] = React.useState("");
  const [draftDescription, setDraftDescription] = React.useState("");
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [mindMapOutline, setMindMapOutline] = React.useState<MindMapOutlineItem[]>([]);
  const [activeMindMapId, setActiveMindMapId] = React.useState<string | null>(null);
  const [selectedMindMapNode, setSelectedMindMapNode] = React.useState<MindMapSelectedNode>({ id: null, title: "" });
  const [workspaceEditorMode, setWorkspaceEditorMode] = React.useState<WorkspaceEditorMode>("mindmap");
  const [modeChangeRequest, setModeChangeRequest] = React.useState<WorkspaceModeChangeRequest | null>(null);
  const [nodeSelectionRequest, setNodeSelectionRequest] = React.useState<WorkspaceNodeSelectionRequest | null>(null);
  const [nodeDeletionRequest, setNodeDeletionRequest] = React.useState<WorkspaceNodeDeletionRequest | null>(null);
  const [catalogBoundaryRequest, setCatalogBoundaryRequest] = React.useState<WorkspaceCatalogBoundaryRequest | null>(null);
  const [catalogCollapseRequest, setCatalogCollapseRequest] = React.useState<MindMapCatalogCollapseRequest | null>(null);
  const [activeSection, setActiveSection] = React.useState<AppSection>("knowledge");
  const [isLibraryPaneCollapsed, setIsLibraryPaneCollapsed] = React.useState(false);
  const [isCatalogPaneCollapsed, setIsCatalogPaneCollapsed] = React.useState(false);
  const [detailPaneMode, setDetailPaneMode] = React.useState<DetailPaneMode>("catalog");
  const [externalContentRevision, setExternalContentRevision] = React.useState(0);
  const catalogCollapseNonceRef = React.useRef(0);
  const catalogBoundaryNonceRef = React.useRef(0);
  const workspaceModePersistRef = React.useRef("");

  const openDocumentFormatPane = React.useCallback(() => {
    setDetailPaneMode("format");
    setIsCatalogPaneCollapsed(false);
  }, []);

  const closeDocumentFormatPane = React.useCallback(() => {
    setDetailPaneMode("catalog");
  }, []);

  React.useEffect(() => {
    return window.aistudyLifecycle?.onBeforeClose(() => drainBeforeCloseSaves());
  }, []);

  React.useEffect(() => startCoreFeatureWarmup(), []);

  React.useEffect(() => {
    if (workspaceEditorMode === "mindmap" && detailPaneMode === "format") {
      setDetailPaneMode("catalog");
    }
  }, [detailPaneMode, workspaceEditorMode]);

  function applyCourseStore(store: CourseStore) {
    setCourseSections(store.sections ?? []);
    setCourses(store.courses);
    setActiveCourseId(store.activeCourseId);
    setWorkspaceEditorMode(getCourseWorkspaceMode(store));
    setHasLoadedCourseStore(true);
  }

  React.useEffect(() => {
    if (!window.aistudyMcp?.onDataChanged) return undefined;
    return window.aistudyMcp.onDataChanged((change) => {
      if (change.kind === "course") {
        setCourseSyncStatus((current) => ({ ...current, state: "saving" }));
        courseApi.load()
          .then((store) => {
            applyCourseStore(store);
            void refreshCourseSyncStatus();
          })
          .catch(() => {
            setCourseSyncStatus({ state: "attention", pendingCount: 1 });
          });
      }

      if (change.kind === "course" || change.kind === "mindmap" || change.kind === "document") {
        setExternalContentRevision(Date.now());
      }
    });
  }, []);

  async function refreshCourseSyncStatus() {
    try {
      setCourseSyncStatus(await courseApi.syncStatus());
    } catch {
      setCourseSyncStatus({ state: "attention", pendingCount: 1 });
    }
  }

  async function runCourseStoreCommand(command: () => Promise<CourseStore>) {
    setCourseSyncStatus((current) => ({ ...current, state: "saving" }));
    try {
      const store = await command();
      applyCourseStore(store);
      await refreshCourseSyncStatus();
      return store;
    } catch (error) {
      await refreshCourseSyncStatus();
      throw error;
    }
  }

  React.useEffect(() => {
    let isCancelled = false;

    courseApi.load()
      .then((store) => {
        if (isCancelled) return;
        applyCourseStore(store);
        void refreshCourseSyncStatus();
      })
      .catch(() => {
        if (isCancelled) return;
        setCourseSyncStatus({ state: "attention", pendingCount: 1 });
      })
      .finally(() => {
        if (!isCancelled) {
          setIsHydrated(true);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  async function retryCourseSync() {
    setCourseSyncStatus((current) => ({ ...current, state: "saving" }));
    try {
      const store = await courseApi.load();
      applyCourseStore(store);
      await refreshCourseSyncStatus();
    } catch {
      setCourseSyncStatus((current) => ({ state: "attention", pendingCount: Math.max(current.pendingCount, 1) }));
    }
  }

  React.useEffect(() => {
    if (activeCourseId && !courses.some((course) => course.id === activeCourseId)) {
      setActiveCourseId(courses[0]?.id ?? null);
    }
  }, [activeCourseId, courses]);

  const activeCourse = courses.find((course) => course.id === activeCourseId) ?? null;
  const sectionIds = React.useMemo(() => new Set(courseSections.map((section) => section.id)), [courseSections]);
  const sectionNameById = React.useMemo(() => new Map(courseSections.map((section) => [section.id, section.name])), [courseSections]);

  React.useEffect(() => {
    setMindMapOutline([]);
    setActiveMindMapId(null);
    setSelectedMindMapNode({ id: null, title: "" });
    setWorkspaceEditorMode(normalizeWorkspaceEditorMode(activeCourse?.lastWorkspaceMode));
    setModeChangeRequest(null);
    setNodeSelectionRequest(null);
    setNodeDeletionRequest(null);
    setCatalogBoundaryRequest(null);
  }, [activeCourseId]);

  function openCreateDialog(sectionId: string | null = activeCourse?.sectionId ?? null) {
    const validSectionId = sectionId && sectionIds.has(sectionId) ? sectionId : null;
    setDialogMode("create");
    setEditingCourseId(null);
    setCreatingCourseSectionId(validSectionId);
    setDraftName("");
    setDraftDescription("");
  }

  function openEditDialog(course: Course) {
    setDialogMode("edit");
    setEditingCourseId(course.id);
    setDraftName(course.name);
    setDraftDescription(course.description);
  }

  function closeDialog() {
    setDialogMode(null);
    setEditingCourseId(null);
    setCreatingCourseSectionId(null);
    setDraftName("");
    setDraftDescription("");
  }

  async function createCourseSection(name: string) {
    await runCourseStoreCommand(() => courseApi.createSection(name));
  }

  async function renameCourseSection(sectionId: string, name: string) {
    await runCourseStoreCommand(() => courseApi.renameSection(sectionId, name));
  }

  function toggleCourseSection(sectionId: string, collapsed: boolean) {
    void runCourseStoreCommand(() => courseApi.toggleSection(sectionId, collapsed));
  }

  function toggleAllCourseSections(collapsed: boolean) {
    void runCourseStoreCommand(() => courseApi.toggleAllSections(collapsed));
  }

  function requestCatalogTree(mode: MindMapCatalogCollapseRequest["mode"]) {
    catalogCollapseNonceRef.current += 1;
    setCatalogCollapseRequest({ mode, nonce: catalogCollapseNonceRef.current });
  }

  function deleteCourseSection(section: CourseSection) {
    const affectedCount = courses.filter((course) => course.sectionId === section.id).length;
    const confirmed = window.confirm(
      affectedCount > 0
        ? `确定删除分区「${section.name}」吗？其中 ${affectedCount} 个知识库会移回「未分区」，知识库内容不会删除。`
        : `确定删除分区「${section.name}」吗？`
    );
    if (!confirmed) return;
    void runCourseStoreCommand(() => courseApi.deleteSection(section.id));
  }

  function moveCourseToSection(course: Course, sectionId: string | null) {
    void runCourseStoreCommand(() => courseApi.moveCourse({ id: course.id, sectionId }));
  }

  function reorderCourse(courseId: string, sectionId: string | null, beforeCourseId: string | null) {
    void runCourseStoreCommand(() => courseApi.reorderCourse({ id: courseId, sectionId, beforeCourseId }));
  }

  function reorderCourseSection(sectionId: string, beforeSectionId: string | null) {
    void runCourseStoreCommand(() => courseApi.reorderSection(sectionId, beforeSectionId));
  }

  const saveCourse: React.ComponentProps<"form">["onSubmit"] = (event) => {
    event.preventDefault();
    const name = draftName.trim();
    const description = draftDescription.trim();
    if (!name) return;

    if (dialogMode === "create") {
      const targetSectionId = creatingCourseSectionId && sectionIds.has(creatingCourseSectionId) ? creatingCourseSectionId : null;
      void runCourseStoreCommand(() => courseApi.createCourse({ name, description, sectionId: targetSectionId })).then(closeDialog);
      return;
    }

    if (dialogMode === "edit" && editingCourseId) {
      void runCourseStoreCommand(() => courseApi.renameCourse({ id: editingCourseId, name, description })).then(closeDialog);
    }
  };

  function deleteCourse(course: Course) {
    const confirmed = window.confirm(`确定删除课程「${course.name}」吗？删除后该课程会从列表中移除。`);
    if (!confirmed) return;
    void runCourseStoreCommand(() => courseApi.deleteCourse(course.id));
  }

  function selectCourse(courseId: string) {
    void runCourseStoreCommand(() => courseApi.selectCourse(courseId));
  }

  function requestWorkspaceMode(mode: WorkspaceEditorMode) {
    if (mode === workspaceEditorMode) return;
    if (mode === "mindmap") setDetailPaneMode("catalog");
    setModeChangeRequest({ mode, nonce: Date.now() });
  }

  function handleWorkspaceEditorModeChanged(mode: WorkspaceEditorMode) {
    const nextMode = normalizeWorkspaceEditorMode(mode);
    setWorkspaceEditorMode(nextMode);

    if (!hasLoadedCourseStore || !activeCourseId || activeCourse?.lastWorkspaceMode === nextMode) return;
    const signature = `${activeCourseId}:${nextMode}`;
    if (workspaceModePersistRef.current === signature) return;
    workspaceModePersistRef.current = signature;

    const updatedAt = new Date().toISOString();
    const nextCourses = courses.map((course) =>
      course.id === activeCourseId
        ? { ...course, lastWorkspaceMode: nextMode, updatedAt }
        : course
    );
    setCourses(nextCourses);
    void runCourseStoreCommand(() => courseApi.saveStore({
      sections: courseSections,
      courses: nextCourses,
      activeCourseId
    })).catch(() => {
      workspaceModePersistRef.current = "";
    });
  }

  function selectCatalogNode(item: MindMapOutlineItem) {
    if (!item.nodeId) return;
    setNodeSelectionRequest({ nodeId: item.nodeId, nonce: Date.now() });
  }

  function deleteCatalogNode(item: MindMapOutlineItem) {
    if (!item.nodeId || !item.parentNodeId) return;
    const confirmed = window.confirm(`确定删除“${item.title}”及其分支和文档内容吗？`);
    if (!confirmed) return;
    setNodeDeletionRequest({ nodeId: item.nodeId, nonce: Date.now() });
  }

  function toggleCatalogBoundary(item: MindMapOutlineItem, enabled: boolean) {
    if (!item.nodeId || !item.parentNodeId) return;
    catalogBoundaryNonceRef.current += 1;
    setCatalogBoundaryRequest({
      nodeId: item.nodeId,
      enabled,
      nonce: catalogBoundaryNonceRef.current
    });
  }

  async function copyCatalogNodeDocumentPath(item: MindMapOutlineItem) {
    if (!activeCourse || !item.nodeId) return;
    const sectionName = activeCourse.sectionId ? sectionNameById.get(activeCourse.sectionId) ?? "" : "";
    const locatorPath = await window.aistudyCourseLocators?.createPath?.({
      courseId: activeCourse.id,
      courseName: activeCourse.name,
      courseDescription: activeCourse.description,
      sectionId: activeCourse.sectionId,
      sectionName
    });
    if (!locatorPath) {
      throw new Error("文档路径生成没有完成。");
    }

    const readArgs = activeMindMapId
      ? { courseId: activeCourse.id, mindMapId: activeMindMapId, nodeId: item.nodeId }
      : { courseId: activeCourse.id, nodeId: item.nodeId };
    const pathText = [
      "AIstudy MCP 文档路径",
      `locatorPath: ${locatorPath}`,
      `courseId: ${activeCourse.id}`,
      activeMindMapId ? `mindMapId: ${activeMindMapId}` : "",
      `nodeId: ${item.nodeId}`,
      `nodeTitle: ${item.title.replace(/\s+/g, " ").trim()}`,
      "tool: read_node_document",
      `arguments: ${JSON.stringify(readArgs)}`
    ].filter(Boolean).join("\n");

    if (window.aistudyClipboard?.writeText) {
      await window.aistudyClipboard.writeText(pathText);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(pathText);
    } else {
      throw new Error("文档路径复制没有完成。");
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand" aria-label="AIstudy">
          <span>AI</span>
        </div>
        <nav className="nav-list" aria-label="主导航">
          <button
            className={activeSection === "knowledge" ? "nav-button active" : "nav-button"}
            title="知识库"
            aria-label="知识库"
            aria-current={activeSection === "knowledge" ? "page" : undefined}
            type="button"
            onClick={() => setActiveSection("knowledge")}
          >
            <Folder size={19} strokeWidth={1.9} />
          </button>
          <button
            className={activeSection === "collection" ? "nav-button active" : "nav-button"}
            title="信息采集"
            aria-label="信息采集"
            aria-current={activeSection === "collection" ? "page" : undefined}
            type="button"
            onClick={() => setActiveSection("collection")}
          >
            <ClipboardList size={19} strokeWidth={1.9} />
          </button>
          <button
            className={activeSection === "vocabulary" ? "nav-button active" : "nav-button"}
            title="词汇采集"
            aria-label="词汇采集"
            aria-current={activeSection === "vocabulary" ? "page" : undefined}
            type="button"
            onClick={() => setActiveSection("vocabulary")}
          >
            <BookOpen size={19} strokeWidth={1.9} />
          </button>
          <button
            className={activeSection === "exam" ? "nav-button active" : "nav-button"}
            title="考试"
            aria-label="考试"
            aria-current={activeSection === "exam" ? "page" : undefined}
            type="button"
            onClick={() => setActiveSection("exam")}
          >
            <GraduationCap size={19} strokeWidth={1.9} />
          </button>
          <button
            className={activeSection === "chromePorts" ? "nav-button active" : "nav-button"}
            title="Chrome 端口管理"
            aria-label="Chrome 端口管理"
            aria-current={activeSection === "chromePorts" ? "page" : undefined}
            type="button"
            onClick={() => setActiveSection("chromePorts")}
          >
            <Globe2 size={19} strokeWidth={1.9} />
          </button>
          <button
            className={activeSection === "assistant" ? "nav-button active" : "nav-button"}
            title="AI 聊天助手"
            aria-label="AI 聊天助手"
            aria-current={activeSection === "assistant" ? "page" : undefined}
            type="button"
            onClick={() => setActiveSection("assistant")}
          >
            <Bot size={19} strokeWidth={1.9} />
          </button>
        </nav>
        <button className="nav-button settings-button" title="设置" aria-label="设置" type="button" onClick={() => setIsSettingsOpen(true)}>
          <Settings size={18} strokeWidth={1.9} />
        </button>
      </aside>

      {activeSection === "knowledge" ? (
      <main className={`study-layout${isLibraryPaneCollapsed ? " library-collapsed" : ""}${isCatalogPaneCollapsed ? " catalog-collapsed" : ""}`}>
        <button
          className="pane-collapse-button library-toggle"
          title={isLibraryPaneCollapsed ? "展开知识库" : "收起知识库"}
          aria-label={isLibraryPaneCollapsed ? "展开知识库" : "收起知识库"}
          type="button"
          onClick={() => setIsLibraryPaneCollapsed((value) => !value)}
        >
          {isLibraryPaneCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
        <button
          className="pane-collapse-button catalog-toggle-button"
          title={isCatalogPaneCollapsed ? "展开目录" : "收起目录"}
          aria-label={isCatalogPaneCollapsed ? "展开目录" : "收起目录"}
          type="button"
          onClick={() => setIsCatalogPaneCollapsed((value) => !value)}
        >
          {isCatalogPaneCollapsed ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
        </button>
        <CourseSidebar
          sections={courseSections}
          courses={courses}
          activeCourseId={activeCourseId}
          isHydrated={isHydrated}
          syncStatus={courseSyncStatus}
          onRetrySync={() => void retryCourseSync()}
          onSelectCourse={selectCourse}
          onCreateCourse={openCreateDialog}
          onEditCourse={openEditDialog}
          onDeleteCourse={deleteCourse}
          onCreateSection={createCourseSection}
          onRenameSection={renameCourseSection}
          onToggleSection={toggleCourseSection}
          onToggleAllSections={toggleAllCourseSections}
          onDeleteSection={deleteCourseSection}
          onMoveCourse={moveCourseToSection}
          onReorderCourse={reorderCourse}
          onReorderSection={reorderCourseSection}
        />

        <section className="canvas-pane" aria-label="学习工作台">
          <div className="canvas-toolbar">
            <div>
              <h2>{activeCourse ? activeCourse.name : "未选择课程"}</h2>
            </div>
            <div className="workspace-mode-switch" aria-label="编辑器切换">
              <button
                type="button"
                className={workspaceEditorMode === "mindmap" ? "active" : ""}
                onClick={() => requestWorkspaceMode("mindmap")}
                disabled={!activeCourse}
              >
                <GitBranch size={15} />
                <span>导图</span>
              </button>
              <button
                type="button"
                className={workspaceEditorMode === "word" ? "active" : ""}
                onClick={() => requestWorkspaceMode("word")}
                disabled={!activeCourse}
              >
                <FileText size={15} />
                <span>文档</span>
              </button>
              <button
                type="button"
                className={workspaceEditorMode === "textbook" ? "active" : ""}
                onClick={() => requestWorkspaceMode("textbook")}
                disabled={!activeCourse}
              >
                <BookOpen size={15} />
                <span>教材</span>
              </button>
            </div>
          </div>

          <div className="editor-mount">
            <MindMapWorkspace
              courseId={activeCourse?.id ?? null}
              courseName={activeCourse?.name ?? "New mind map"}
              editorMode={workspaceEditorMode}
              externalChangeRevision={externalContentRevision}
              modeChangeRequest={modeChangeRequest}
              nodeSelectionRequest={nodeSelectionRequest}
              nodeDeletionRequest={nodeDeletionRequest}
              catalogBoundaryRequest={catalogBoundaryRequest}
              onEditorModeChange={handleWorkspaceEditorModeChanged}
              onOutlineChanged={setMindMapOutline}
              onMindMapIdChanged={setActiveMindMapId}
              onNodeSelectedChanged={setSelectedMindMapNode}
              isCatalogPaneCollapsed={isCatalogPaneCollapsed}
              documentDetailPaneMode={detailPaneMode}
              onOpenDocumentFormatPane={openDocumentFormatPane}
              onCloseDocumentFormatPane={closeDocumentFormatPane}
            />
          </div>
        </section>

        <aside className="detail-pane" aria-label={workspaceEditorMode === "word" && detailPaneMode === "format" ? "排版" : "目录"}>
          <div className="detail-heading">
            <div>
              <h2>{workspaceEditorMode === "word" && detailPaneMode === "format" ? "排版" : "目录"}</h2>
            </div>
            {!(workspaceEditorMode === "word" && detailPaneMode === "format") && mindMapOutline.length > 0 ? (
              <div className="catalog-tree-toolbar" aria-label="目录视图">
                <button
                  type="button"
                  title="展开全部；右键只展开父级"
                  onClick={() => requestCatalogTree("expand-all")}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    requestCatalogTree("expand-branches");
                  }}
                >
                  <ChevronsDown size={14} />
                  <span>展开</span>
                </button>
                <button type="button" onClick={() => requestCatalogTree("collapse-all")}>
                  <ChevronsRight size={14} />
                  <span>收叠</span>
                </button>
              </div>
            ) : null}
            {workspaceEditorMode === "word" ? (
              <div className="detail-mode-switch" aria-label="右侧面板切换">
                <button
                  type="button"
                  className={detailPaneMode === "catalog" ? "active" : ""}
                  onClick={() => setDetailPaneMode("catalog")}
                >
                  <FileText size={14} />
                  <span>目录</span>
                </button>
                <button
                  type="button"
                  className={detailPaneMode === "format" ? "active" : ""}
                  onClick={openDocumentFormatPane}
                >
                  <SlidersHorizontal size={14} />
                  <span>排版</span>
                </button>
              </div>
            ) : null}
          </div>

          {workspaceEditorMode === "word" && detailPaneMode === "format" ? (
            <div id="document-format-panel-slot" className="document-format-panel-slot" />
          ) : activeCourse && mindMapOutline.length > 0 ? (
            <nav className="catalog-panel" aria-label="导图目录">
              <MindMapCatalog
                items={mindMapOutline}
                selectedNodeId={selectedMindMapNode.id}
                resetKey={activeCourseId ?? ""}
                collapseRequest={catalogCollapseRequest}
                onNodeSelect={selectCatalogNode}
                onNodeCopyDocumentPath={copyCatalogNodeDocumentPath}
                onNodeDelete={deleteCatalogNode}
                onNodeToggleCatalogBoundary={toggleCatalogBoundary}
              />
            </nav>
          ) : (
            <div className="detail-empty-state">
              <strong>{activeCourse ? "暂无目录" : "未选择课程"}</strong>
            </div>
          )}
        </aside>
      </main>
      ) : activeSection === "assistant" ? (
        <AiAssistantPanel
          storageKey="workspace-assistant"
          courseTitle={activeCourse?.name ?? ""}
          nodeTitle={selectedMindMapNode.title}
          contextText={mindMapOutline.slice(0, 80).map((item) => `${"  ".repeat(Math.max(0, item.level))}${item.title}`).join("\n")}
        />
      ) : activeSection === "collection" ? (
        <InformationCollectionPanel courses={courses} activeCourseId={activeCourseId} />
      ) : activeSection === "vocabulary" ? (
        <VocabularyCapturePanel />
      ) : activeSection === "exam" ? (
        <ExamWorkspace
          activeCourseId={activeCourseId}
          activeCourseName={activeCourse?.name ?? ""}
          activeMindMapId={activeMindMapId}
          selectedNodeId={selectedMindMapNode.id}
          selectedNodeTitle={selectedMindMapNode.title}
        />
      ) : (
        <ChromePortManager />
      )}

      {dialogMode ? (
        <div className="modal-backdrop" role="presentation">
          <form className="course-dialog" onSubmit={saveCourse} aria-label={dialogMode === "create" ? "新建课程" : "编辑课程"}>
            <div className="dialog-heading">
              <div>
                <p className="section-kicker">课程管理</p>
                <h2>{dialogMode === "create" ? "新建课程" : "编辑课程"}</h2>
              </div>
              <button className="icon-button" title="关闭" aria-label="关闭" type="button" onClick={closeDialog}>
                <X size={17} />
              </button>
            </div>

            <label className="form-field">
              <span>课程名称</span>
              <input value={draftName} onChange={(event) => setDraftName(event.target.value)} autoFocus maxLength={40} placeholder="课程名称" />
            </label>

            <label className="form-field">
              <span>课程描述</span>
              <textarea
                value={draftDescription}
                onChange={(event) => setDraftDescription(event.target.value)}
                maxLength={120}
                placeholder="课程描述"
              />
            </label>

            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={closeDialog}>
                取消
              </button>
              <button className="primary-button" type="submit" disabled={!draftName.trim()}>
                <Check size={16} />
                保存
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isSettingsOpen ? <SettingsDialog onClose={() => setIsSettingsOpen(false)} /> : null}
    </div>
  );
}

const routeParams = new URLSearchParams(window.location.search);
const rootContent = routeParams.get("view") === "textbook-pdf" ? <TextbookPdfWindow /> : <App />;

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    {rootContent}
  </AppErrorBoundary>
);
