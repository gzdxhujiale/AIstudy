import React from "react";
import { Bot, CheckCircle2, Loader2, Send, Sparkles, Trash2, X } from "lucide-react";

type AiChatProvider = "doubao" | "chatgpt";

type AiChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  provider?: AiChatProvider;
};

type AiChatResult = {
  ok: boolean;
  provider: AiChatProvider;
  reply: string;
  error?: string;
};

type AiAssistantPanelProps = {
  courseTitle?: string;
  nodeTitle?: string;
  contextText?: string;
  compact?: boolean;
  initialInput?: string;
  storageKey?: string;
  onDragHandlePointerDown?: (event: React.PointerEvent<HTMLElement>) => void;
  onInitialInputConsumed?: () => void;
  onClose?: () => void;
  title?: string;
  showContext?: boolean;
};

declare global {
  interface Window {
    aistudyAssistant?: {
      send: (request: {
        provider: AiChatProvider;
        message: string;
      }) => Promise<AiChatResult>;
    };
  }
}

function createMessageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getProviderName(provider: AiChatProvider) {
  return provider === "chatgpt" ? "ChatGPT" : "豆包";
}

const DEFAULT_ASSISTANT_MESSAGES: AiChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content: "我会复用端口管理中已登录的豆包或 ChatGPT 页面来回答问题。"
  }
];
const ASSISTANT_STORAGE_PREFIX = "aistudy:assistant-chat:v1:";
const MAX_PERSISTED_MESSAGES = 80;
const MAX_PERSISTED_MESSAGE_CHARS = 8000;
const ASSISTANT_HEADER_DRAG_IGNORE_SELECTOR = "button,input,textarea,select,a,[role='button'],.assistant-header-actions";

type StoredAssistantSession = {
  version: 1;
  provider?: AiChatProvider;
  input?: string;
  messages?: AiChatMessage[];
};

function trimStoredMessage(message: AiChatMessage): AiChatMessage {
  return {
    ...message,
    content: message.content.slice(0, MAX_PERSISTED_MESSAGE_CHARS)
  };
}

function shouldIgnoreAssistantHeaderDrag(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(ASSISTANT_HEADER_DRAG_IGNORE_SELECTOR));
}

function readStoredSession(storageKey: string): StoredAssistantSession | null {
  try {
    const raw = localStorage.getItem(`${ASSISTANT_STORAGE_PREFIX}${storageKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAssistantSession;
    if (parsed?.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredSession(storageKey: string, session: StoredAssistantSession) {
  try {
    localStorage.setItem(`${ASSISTANT_STORAGE_PREFIX}${storageKey}`, JSON.stringify(session));
  } catch {
    // Chat persistence is a convenience layer; storage pressure should not block asking AI.
  }
}

function clearStoredSession(storageKey: string) {
  try {
    localStorage.removeItem(`${ASSISTANT_STORAGE_PREFIX}${storageKey}`);
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function AiAssistantPanel({
  courseTitle = "",
  nodeTitle = "",
  compact = false,
  initialInput = "",
  storageKey = "global",
  onDragHandlePointerDown,
  onInitialInputConsumed,
  onClose,
  title,
  showContext
}: AiAssistantPanelProps) {
  const resolvedStorageKey = storageKey || "global";
  const initialSession = React.useMemo(() => readStoredSession(resolvedStorageKey), [resolvedStorageKey]);
  const [provider, setProvider] = React.useState<AiChatProvider>(
    initialSession?.provider === "chatgpt" ? "chatgpt" : "doubao"
  );
  const [messages, setMessages] = React.useState<AiChatMessage[]>(
    initialSession?.messages?.length ? initialSession.messages.map(trimStoredMessage) : DEFAULT_ASSISTANT_MESSAGES
  );
  const [input, setInput] = React.useState(initialSession?.input ?? "");
  const [isPending, setIsPending] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const messagesRef = React.useRef<HTMLDivElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const contextVisible = showContext ?? !compact;

  React.useEffect(() => {
    const nextSession = readStoredSession(resolvedStorageKey);
    setProvider(nextSession?.provider === "chatgpt" ? "chatgpt" : "doubao");
    setMessages(nextSession?.messages?.length ? nextSession.messages.map(trimStoredMessage) : DEFAULT_ASSISTANT_MESSAGES);
    setInput(nextSession?.input ?? "");
    setStatus("");
  }, [resolvedStorageKey]);

  React.useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isPending]);

  React.useEffect(() => {
    const nextMessages = messages.slice(-MAX_PERSISTED_MESSAGES).map(trimStoredMessage);
    writeStoredSession(resolvedStorageKey, {
      version: 1,
      provider,
      input,
      messages: nextMessages
    });
  }, [input, messages, provider, resolvedStorageKey]);

  const clearChat = React.useCallback(() => {
    setMessages(DEFAULT_ASSISTANT_MESSAGES);
    setInput("");
    setStatus("");
    clearStoredSession(resolvedStorageKey);
  }, [resolvedStorageKey]);

  const sendPrompt = React.useCallback(async (message: string) => {
    if (!message || isPending) return;

    const userMessage: AiChatMessage = {
      id: createMessageId(),
      role: "user",
      content: message,
      provider
    };
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setIsPending(true);
    setStatus(`正在通过 ${getProviderName(provider)} 发送...`);

    try {
      const result = await window.aistudyAssistant?.send({
        provider,
        message
      });
      const reply = result?.ok && result.reply ? result.reply : result?.error || "AI 助手没有返回内容。";
      setMessages((current) => [
        ...current,
        {
          id: createMessageId(),
          role: "assistant",
          content: reply,
          provider
        }
      ]);
      setStatus(result?.ok ? `${getProviderName(provider)} 已返回` : "");
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: createMessageId(),
          role: "assistant",
          content: error instanceof Error ? error.message : "AI 聊天请求失败。",
          provider
        }
      ]);
      setStatus("");
    } finally {
      setIsPending(false);
    }
  }, [isPending, provider]);

  React.useEffect(() => {
    const selectedText = initialInput.trim();
    if (!selectedText) return;

    onInitialInputConsumed?.();
    setInput((current) => {
      const currentText = current.trim();
      if (currentText === selectedText || currentText.includes(selectedText)) return current;
      return currentText ? `${selectedText}\n\n${currentText}` : selectedText;
    });
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [initialInput, onInitialInputConsumed]);

  const sendMessage = React.useCallback(async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const message = input.trim();
    await sendPrompt(message);
  }, [input, sendPrompt]);

  const handleAssistantHeaderPointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!onDragHandlePointerDown || shouldIgnoreAssistantHeaderDrag(event.target)) return;
    onDragHandlePointerDown(event);
  }, [onDragHandlePointerDown]);

  return (
    <main className={compact ? "assistant-layout compact" : "assistant-layout"} aria-label="AI 聊天助手">
      <section className={compact ? "assistant-page compact" : "assistant-page"}>
        <header className="assistant-header" onPointerDown={onDragHandlePointerDown ? handleAssistantHeaderPointerDown : undefined}>
          <div
            className={onDragHandlePointerDown ? "assistant-title-block draggable" : "assistant-title-block"}
            title={onDragHandlePointerDown ? "拖动 AI 小窗" : undefined}
          >
            <div className="assistant-mark" aria-hidden="true">
              <Bot size={compact ? 18 : 24} />
            </div>
            <div>
              {!compact ? <p className="section-kicker">AI 助手</p> : null}
              <h1>{title ?? (compact ? "问 AI" : "学习聊天助手")}</h1>
            </div>
          </div>

          <div className="assistant-header-actions">
            <div className="assistant-provider-switch" role="group" aria-label="AI 平台">
              <button type="button" className={provider === "doubao" ? "active" : ""} onClick={() => setProvider("doubao")} disabled={isPending}>
                豆包
              </button>
              <button type="button" className={provider === "chatgpt" ? "active" : ""} onClick={() => setProvider("chatgpt")} disabled={isPending}>
                ChatGPT
              </button>
            </div>
            <button className="icon-button assistant-close-button" type="button" title="清空聊天记录" aria-label="清空聊天记录" onClick={clearChat} disabled={isPending}>
              <Trash2 size={15} />
            </button>
            {onClose ? (
              <button className="icon-button assistant-close-button" type="button" title="关闭" aria-label="关闭 AI 小窗" onClick={onClose}>
                <X size={15} />
              </button>
            ) : null}
          </div>
        </header>

        {contextVisible ? (
          <section className="assistant-context" aria-label="当前上下文">
            <span>{courseTitle || "未选择课程"}</span>
            <span>{nodeTitle || "未选择节点"}</span>
            <span>
              <CheckCircle2 size={14} />
              复用已登录端口
            </span>
          </section>
        ) : null}

        <div className="assistant-messages" ref={messagesRef} aria-label="聊天记录">
          {messages.map((message) => (
            <article className={`assistant-message ${message.role}`} key={message.id}>
              <div className="assistant-message-meta">
                {message.role === "assistant" ? getProviderName(message.provider ?? provider) : "你"}
              </div>
              <p>{message.content}</p>
            </article>
          ))}
          {isPending ? (
            <article className="assistant-message assistant pending">
              <div className="assistant-message-meta">{getProviderName(provider)}</div>
              <p><Loader2 className="spin-icon" size={16} /> 正在等待回答...</p>
            </article>
          ) : null}
        </div>

        {!compact ? (
          <div className="assistant-quick-actions">
            <button type="button" disabled={isPending} onClick={() => setInput("用简洁语言解释当前节点的核心概念")}>
              <Sparkles size={15} />
              解释概念
            </button>
            <button type="button" disabled={isPending} onClick={() => setInput("围绕当前节点生成 3 个考试易错点")}>
              <Sparkles size={15} />
              易错点
            </button>
            <button type="button" disabled={isPending} onClick={() => setInput("根据当前课程和节点，帮我设计一组复习提问")}>
              <Sparkles size={15} />
              复习提问
            </button>
          </div>
        ) : null}

        <form className="assistant-input-row" onSubmit={sendMessage}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="输入问题，Enter 发送，Shift+Enter 换行"
            rows={compact ? 4 : 2}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            disabled={isPending}
          />
          <button className="primary-button" type="submit" disabled={!input.trim() || isPending}>
            {isPending ? <Loader2 className="spin-icon" size={16} /> : <Send size={16} />}
            发送
          </button>
        </form>

        {status ? <p className="assistant-status">{status}</p> : null}
      </section>
    </main>
  );
}
