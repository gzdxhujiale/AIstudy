import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const DEFAULT_USER_ERROR_MESSAGE = "操作没有完成，请稍后再试。";

function isSafeUserMessage(message: string) {
  return message.length > 0
    && message.length <= 80
    && /[\u4e00-\u9fff]/.test(message)
    && !/[\\/]/.test(message)
    && !/(\r|\n|Error:|EPERM|ENOENT|SQL|SELECT|INSERT|UPDATE|DELETE|stack|at\s+)/i.test(message);
}

function normalizeInvokeError(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : String(error ?? "");
  const remoteMatch = rawMessage.match(/^Error invoking remote method '[^']+': Error: ([\s\S]+)$/);
  const candidate = (remoteMatch?.[1] ?? rawMessage).trim();
  return new Error(isSafeUserMessage(candidate) ? candidate : DEFAULT_USER_ERROR_MESSAGE);
}

async function invokeApp(channel: string, ...args: unknown[]) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    throw normalizeInvokeError(error);
  }
}

contextBridge.exposeInMainWorld("aistudyWindow", {
  minimize: () => invokeApp("window:minimize"),
  toggleMaximize: () => invokeApp("window:toggle-maximize"),
  close: () => invokeApp("window:close")
});

contextBridge.exposeInMainWorld("aistudyClipboard", {
  writeText: (text: string) => invokeApp("clipboard:write-text", text)
});

contextBridge.exposeInMainWorld("aistudyCourseLocators", {
  createPath: (input: unknown) => invokeApp("course-locators:create", input)
});

contextBridge.exposeInMainWorld("aistudyCourses", {
  load: () => invokeApp("courses:load"),
  save: (store: unknown) => invokeApp("courses:save", store),
  create: (input: unknown) => invokeApp("courses:create", input),
  rename: (input: unknown) => invokeApp("courses:rename", input),
  move: (input: unknown) => invokeApp("courses:move", input),
  reorder: (input: unknown) => invokeApp("courses:reorder", input),
  delete: (courseId: unknown) => invokeApp("courses:delete", courseId),
  select: (courseId: unknown) => invokeApp("courses:select", courseId),
  syncStatus: () => invokeApp("courses:sync-status")
});

contextBridge.exposeInMainWorld("aistudyCourseSections", {
  create: (input: unknown) => invokeApp("course-sections:create", input),
  rename: (input: unknown) => invokeApp("course-sections:rename", input),
  toggle: (input: unknown) => invokeApp("course-sections:toggle", input),
  reorder: (input: unknown) => invokeApp("course-sections:reorder", input),
  delete: (sectionId: unknown) => invokeApp("course-sections:delete", sectionId)
});

contextBridge.exposeInMainWorld("aistudyMindMaps", {
  load: (courseId: string) => invokeApp("mindmaps:load", courseId),
  save: (document: unknown) => invokeApp("mindmaps:save", document)
});

contextBridge.exposeInMainWorld("aistudyKnowledgeDocuments", {
  load: (request: unknown) => invokeApp("knowledge-documents:load", request),
  listStatuses: (request: unknown) => invokeApp("knowledge-documents:list-statuses", request),
  save: (request: unknown) => invokeApp("knowledge-documents:save", request)
});

contextBridge.exposeInMainWorld("aistudyMcp", {
  state: () => invokeApp("mcp:state"),
  setEnabled: (input: unknown) => invokeApp("mcp:set-enabled", input),
  setToolEnabled: (input: unknown) => invokeApp("mcp:set-tool-enabled", input),
  runTool: (input: unknown) => invokeApp("mcp:run-tool", input),
  remoteState: () => invokeApp("mcp:remote-state"),
  setRemoteEnabled: (input: unknown) => invokeApp("mcp:remote-set-enabled", input),
  setRemotePermissions: (input: unknown) => invokeApp("mcp:remote-set-permissions", input),
  refreshRemote: () => invokeApp("mcp:remote-refresh"),
  copyRemote: () => invokeApp("mcp:remote-copy"),
  onStateChanged: (callback: (state: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on("mcp:state-changed", listener);
    return () => {
      ipcRenderer.off("mcp:state-changed", listener);
    };
  },
  onRemoteStateChanged: (callback: (state: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on("mcp:remote-state-changed", listener);
    return () => {
      ipcRenderer.off("mcp:remote-state-changed", listener);
    };
  },
  onDataChanged: (callback: (change: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, change: unknown) => callback(change);
    ipcRenderer.on("mcp:data-changed", listener);
    return () => {
      ipcRenderer.off("mcp:data-changed", listener);
    };
  }
});

contextBridge.exposeInMainWorld("aistudyChromePorts", {
  status: () => invokeApp("chrome-ports:status"),
  openLogin: (platformId: unknown) => invokeApp("chrome-ports:open-login", platformId),
  openPage: (input: unknown) => invokeApp("chrome-ports:open-page", input)
});

contextBridge.exposeInMainWorld("aistudyInformationCollection", {
  collectBilibili: (input: unknown) => invokeApp("information-collection:bilibili-collect", input),
  processBilibili: (input: unknown) => invokeApp("information-collection:bilibili-process", input),
  toolStatus: () => invokeApp("information-collection:tool-status"),
  openBilibili: (input: unknown) => invokeApp("information-collection:open-bilibili", input)
});

contextBridge.exposeInMainWorld("aistudyAssistant", {
  send: (request: unknown) => invokeApp("ai-chat:send", request)
});

contextBridge.exposeInMainWorld("aistudyLifecycle", {
  onBeforeClose: (callback: () => Promise<unknown> | unknown) => {
    const listener = async (_event: IpcRendererEvent, token: string) => {
      try {
        await callback();
      } finally {
        await ipcRenderer.invoke("app:before-close-complete", token);
      }
    };

    ipcRenderer.on("app:before-close", listener);
    return () => {
      ipcRenderer.off("app:before-close", listener);
    };
  }
});

contextBridge.exposeInMainWorld("aistudyUpdates", {
  loadInfo: () => invokeApp("updates:info"),
  openRepository: () => invokeApp("updates:open-repository"),
  openIndex: () => invokeApp("updates:open-index"),
  openReleaseDir: () => invokeApp("updates:open-release-dir"),
  check: () => invokeApp("updates:check"),
  download: (downloadUrl: string, expectedSize?: number) => invokeApp("updates:download", downloadUrl, expectedSize),
  pauseDownload: () => invokeApp("updates:pause-download"),
  resumeDownload: () => invokeApp("updates:resume-download"),
  cancelDownload: () => invokeApp("updates:cancel-download"),
  install: (filePath: string) => invokeApp("updates:install", filePath),
  openReleasePage: (releaseUrl: string) => invokeApp("updates:open-release-page", releaseUrl),
  onDownloadProgress: (callback: (progress: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, progress: unknown) => callback(progress);
    ipcRenderer.on("updates:download-progress", listener);
    return () => {
      ipcRenderer.off("updates:download-progress", listener);
    };
  }
});

contextBridge.exposeInMainWorld("aistudyErrorLogs", {
  list: (limit?: number) => invokeApp("error-logs:list", limit)
});

contextBridge.exposeInMainWorld("aistudyRuntime", {
  diagnose: () => invokeApp("runtime:diagnose"),
  copyDiagnosticReport: () => invokeApp("runtime:copy-diagnostic-report"),
  openDataRoot: () => invokeApp("runtime:open-data-root")
});
