import React from "react";

type VocabularyCaptureState = {
  receiver: {
    status: "listening" | "error";
    port: number;
    error: string;
  };
  connection: {
    status: "connected" | "waiting";
    lastSeenAt: string | null;
    source: string;
    appName: string;
    packageName: string;
  };
  document: {
    text: string;
    eventCount: number;
    updatedAt: string | null;
    lastEventAt: string | null;
  };
};

declare global {
  interface Window {
    aistudyVocabularyCapture?: {
      state: () => Promise<VocabularyCaptureState>;
      onStateChanged: (callback: (state: VocabularyCaptureState) => void) => () => void;
    };
  }
}

const emptyState: VocabularyCaptureState = {
  receiver: {
    status: "listening",
    port: 38673,
    error: ""
  },
  connection: {
    status: "waiting",
    lastSeenAt: null,
    source: "",
    appName: "",
    packageName: ""
  },
  document: {
    text: "",
    eventCount: 0,
    updatedAt: null,
    lastEventAt: null
  }
};

function normalizeCaptureState(value: unknown): VocabularyCaptureState {
  const state = value && typeof value === "object" ? value as Partial<VocabularyCaptureState> : {};
  return {
    receiver: {
      ...emptyState.receiver,
      ...(state.receiver && typeof state.receiver === "object" ? state.receiver : {})
    },
    connection: {
      ...emptyState.connection,
      ...(state.connection && typeof state.connection === "object" ? state.connection : {})
    },
    document: {
      ...emptyState.document,
      ...(state.document && typeof state.document === "object" ? state.document : {})
    }
  };
}

function getStatusText(state: VocabularyCaptureState) {
  if (state.receiver.status === "error") return "异常";
  return state.connection.status === "connected" ? "已连接" : "等待连接";
}

function getStatusClass(state: VocabularyCaptureState) {
  if (state.receiver.status === "error") return "error";
  return state.connection.status;
}

export function VocabularyCapturePanel() {
  const [state, setState] = React.useState<VocabularyCaptureState>(emptyState);
  const documentRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void window.aistudyVocabularyCapture?.state()
      .then((nextState) => {
        if (!cancelled) setState(normalizeCaptureState(nextState));
      })
      .catch(() => undefined);

    const unsubscribe = window.aistudyVocabularyCapture?.onStateChanged((nextState) => {
      setState(normalizeCaptureState(nextState));
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  React.useEffect(() => {
    const element = documentRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [state.document.text]);

  return (
    <main className="vocabulary-capture-page">
      <header className="vocabulary-capture-header">
        <h1>词汇采集</h1>
        <div className={`vocabulary-capture-status ${getStatusClass(state)}`}>
          <span />
          <strong>{getStatusText(state)}</strong>
        </div>
      </header>
      <section className="vocabulary-capture-document" aria-label="词汇采集文档">
        <textarea ref={documentRef} value={state.document.text} readOnly spellCheck={false} />
      </section>
    </main>
  );
}
