import React from "react";
import { CheckCircle2, ExternalLink, Globe2, Loader2, RefreshCw, XCircle } from "lucide-react";

type ChromePortPlatformId = "doubao" | "chatgpt" | "bilibili" | "zhihu" | "zhaopin" | "zhipin" | "xiaohongshu";

type ChromePortStatus = {
  id: ChromePortPlatformId;
  name: string;
  port: number;
  loginUrl: string;
  hostKeyword: string;
  connected: boolean;
  pageDetected: boolean;
  authenticated: boolean;
  saved: boolean;
  profileDir: string;
  statusText: string;
  lastCheckedAt: string;
  savedAt: string;
  authenticatedAt: string;
  detectedUrl: string;
};

type ChromePortOpenResult = {
  status: ChromePortStatus;
  message: string;
};

declare global {
  interface Window {
    aistudyChromePorts?: {
      status: () => Promise<ChromePortStatus[]>;
      openLogin: (platformId: ChromePortPlatformId) => Promise<ChromePortOpenResult>;
      openPage: (input: { platformId: ChromePortPlatformId; url: string }) => Promise<ChromePortOpenResult>;
    };
  }
}

function formatCheckedTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function mergeStatus(statuses: ChromePortStatus[], next: ChromePortStatus) {
  return statuses.map((status) => (status.id === next.id ? next : status));
}

function getPortStateClass(port: ChromePortStatus) {
  if (port.authenticated) return "chrome-port-state connected";
  if (port.saved) return "chrome-port-state pending";
  if (port.connected) return "chrome-port-state pending";
  return "chrome-port-state disconnected";
}

export function ChromePortManager() {
  const [ports, setPorts] = React.useState<ChromePortStatus[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [activePortId, setActivePortId] = React.useState<ChromePortPlatformId | null>(null);
  const [monitorPortId, setMonitorPortId] = React.useState<ChromePortPlatformId | null>(null);
  const monitorDeadlineRef = React.useRef(0);
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");

  const refreshStatus = React.useCallback(async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    setError("");

    try {
      const nextPorts = await window.aistudyChromePorts?.status?.();
      if (!nextPorts) {
        throw new Error("Chrome 端口服务未就绪");
      }
      setPorts(nextPorts);
      return nextPorts;
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "端口状态读取失败");
      return null;
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const openLogin = React.useCallback(async (platformId: ChromePortPlatformId) => {
    setActivePortId(platformId);
    setError("");
    setMessage("");

    try {
      const result = await window.aistudyChromePorts?.openLogin?.(platformId);
      if (!result) {
        throw new Error("Chrome 登录窗口接口未就绪");
      }
      setPorts((current) => mergeStatus(current, result.status));
      setMessage(result.message);
      if (result.status.authenticated) {
        setMonitorPortId(null);
      } else {
        monitorDeadlineRef.current = Date.now() + 90_000;
        setMonitorPortId(platformId);
      }
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录窗口打开失败");
    } finally {
      setActivePortId(null);
    }
  }, []);

  React.useEffect(() => {
    if (!monitorPortId) return undefined;

    let disposed = false;
    const checkLogin = async () => {
      if (disposed) return;
      const nextPorts = await refreshStatus(false);
      const target = nextPorts?.find((port) => port.id === monitorPortId);
      if (target?.authenticated) {
        setMessage(`${target.name} 已识别登录状态，端口 ${target.port} 已保存`);
        setMonitorPortId(null);
        return;
      }
      if (Date.now() > monitorDeadlineRef.current) {
        setMessage("登录检测仍在等待。完成登录后点击刷新状态即可继续识别并保存。");
        setMonitorPortId(null);
      }
    };

    const firstCheck = window.setTimeout(() => void checkLogin(), 1200);
    const interval = window.setInterval(() => void checkLogin(), 2500);
    return () => {
      disposed = true;
      window.clearTimeout(firstCheck);
      window.clearInterval(interval);
    };
  }, [monitorPortId, refreshStatus]);

  return (
    <main className="chrome-port-layout" aria-label="Chrome 端口管理">
      <section className="chrome-port-page">
        <header className="chrome-port-header">
          <div>
            <p className="section-kicker">Chrome 端口</p>
            <h1>端口管理</h1>
          </div>
          <button className="secondary-button" type="button" onClick={() => void refreshStatus()} disabled={isLoading}>
            {isLoading ? <Loader2 className="spin-icon" size={16} /> : <RefreshCw size={16} />}
            刷新状态
          </button>
        </header>

        {message ? <p className="status-message success">{message}</p> : null}
        {error ? <p className="status-message error">{error}</p> : null}

        <div className="chrome-port-grid" aria-label="固定端口列表">
          {ports.map((port) => (
            <article className="chrome-port-card" key={port.id}>
              <div className="chrome-port-card-main">
                <div className="chrome-port-mark" aria-hidden="true">
                  <Globe2 size={22} />
                </div>
                <div>
                  <h2>{port.name}</h2>
                  <p>{port.hostKeyword}</p>
                </div>
              </div>

              <div className="chrome-port-meta">
                <span>端口 {port.port}</span>
                <span>{formatCheckedTime(port.lastCheckedAt)}</span>
                {port.saved ? <span>已保存 {formatCheckedTime(port.savedAt)}</span> : null}
              </div>

              <div className={getPortStateClass(port)}>
                {port.authenticated || port.saved ? <CheckCircle2 size={16} /> : port.connected ? <Loader2 className="spin-icon" size={16} /> : <XCircle size={16} />}
                <span>{port.statusText}</span>
              </div>

              <button
                className="primary-button chrome-port-login-button"
                type="button"
                onClick={() => void openLogin(port.id)}
                disabled={activePortId === port.id}
              >
                {activePortId === port.id ? <Loader2 className="spin-icon" size={16} /> : <ExternalLink size={16} />}
                {activePortId === port.id || monitorPortId === port.id ? "检测登录" : port.authenticated ? "重新检测登录" : "打开登录"}
              </button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
