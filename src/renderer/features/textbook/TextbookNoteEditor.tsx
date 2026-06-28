import React from "react";
import {
  AlignLeft,
  Bold,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Save,
  Underline,
  Undo2
} from "lucide-react";
import { createCanvasDocumentEditor } from "../documents/canvasEditorAdapter";
import type {
  KnowledgeDocumentEditorHandle,
  KnowledgeDocumentFormatState,
  KnowledgeDocumentSnapshot
} from "../documents/knowledgeDocumentTypes";

export type TextbookNoteEditorHandle = {
  getSnapshot: () => Promise<KnowledgeDocumentSnapshot | null>;
  focus: () => void;
};

type TextbookNoteEditorProps = {
  editorKey: string;
  snapshot: KnowledgeDocumentSnapshot;
  disabled?: boolean;
  onSnapshotChange: (snapshot: KnowledgeDocumentSnapshot) => void;
  onSave: () => void;
};

const DEFAULT_FORMAT_STATE: KnowledgeDocumentFormatState = {
  fontFamily: "Microsoft YaHei",
  fontSize: 16,
  color: "#1f2937",
  highlight: null,
  bold: false,
  italic: false,
  underline: false,
  strikeout: false,
  alignment: null,
  titleLevel: "paragraph",
  listType: "none"
};

function areFormatStatesEqual(left: KnowledgeDocumentFormatState, right: KnowledgeDocumentFormatState) {
  return (
    left.fontFamily === right.fontFamily &&
    left.fontSize === right.fontSize &&
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.underline === right.underline &&
    left.titleLevel === right.titleLevel &&
    left.listType === right.listType
  );
}

export const TextbookNoteEditor = React.forwardRef<TextbookNoteEditorHandle, TextbookNoteEditorProps>(function TextbookNoteEditor(
  { editorKey, snapshot, disabled = false, onSnapshotChange, onSave },
  ref
) {
  const mountRef = React.useRef<HTMLDivElement | null>(null);
  const editorRef = React.useRef<KnowledgeDocumentEditorHandle | null>(null);
  const [isReady, setIsReady] = React.useState(false);
  const [formatState, setFormatState] = React.useState<KnowledgeDocumentFormatState>(DEFAULT_FORMAT_STATE);
  const disabledEditor = disabled || !isReady;

  React.useImperativeHandle(ref, () => ({
    getSnapshot: async () => editorRef.current ? editorRef.current.getSnapshotAsync() : null,
    focus: () => editorRef.current?.focus()
  }), []);

  React.useEffect(() => {
    const host = mountRef.current;
    if (!host) return;

    let disposed = false;
    setIsReady(false);
    host.replaceChildren();
    editorRef.current?.destroy();
    editorRef.current = null;

    createCanvasDocumentEditor(host, snapshot, {
      onSnapshotChanged: onSnapshotChange,
      onFormatChanged: (nextState) => {
        setFormatState((current) => areFormatStatesEqual(current, nextState) ? current : nextState);
      }
    }, { compact: true })
      .then((editor) => {
        if (disposed) {
          editor.destroy();
          return;
        }
        editorRef.current = editor;
        setIsReady(true);
      })
      .catch(() => {
        if (!disposed) setIsReady(false);
      });

    return () => {
      disposed = true;
      editorRef.current?.destroy();
      editorRef.current = null;
    };
  }, [editorKey]);

  return (
    <div className="textbook-note-editor">
      <div className="textbook-note-toolbar" aria-label="笔记排版">
        <button type="button" title="撤销" onClick={() => editorRef.current?.exec("undo")} disabled={disabledEditor}>
          <Undo2 size={14} />
        </button>
        <button type="button" title="重做" onClick={() => editorRef.current?.exec("redo")} disabled={disabledEditor}>
          <Redo2 size={14} />
        </button>
        <span />
        <button
          type="button"
          title="标题"
          className={formatState.titleLevel === "second" ? "active" : ""}
          onClick={() => editorRef.current?.setTitleLevel(formatState.titleLevel === "second" ? "paragraph" : "second")}
          disabled={disabledEditor}
        >
          <Heading2 size={14} />
        </button>
        <button type="button" title="正文" onClick={() => editorRef.current?.setTitleLevel("paragraph")} disabled={disabledEditor}>
          <AlignLeft size={14} />
        </button>
        <button type="button" title="加粗" className={formatState.bold ? "active" : ""} onClick={() => editorRef.current?.exec("bold")} disabled={disabledEditor}>
          <Bold size={14} />
        </button>
        <button type="button" title="斜体" className={formatState.italic ? "active" : ""} onClick={() => editorRef.current?.exec("italic")} disabled={disabledEditor}>
          <Italic size={14} />
        </button>
        <button type="button" title="下划线" className={formatState.underline ? "active" : ""} onClick={() => editorRef.current?.exec("underline")} disabled={disabledEditor}>
          <Underline size={14} />
        </button>
        <button type="button" title="项目符号" className={formatState.listType === "ul" ? "active" : ""} onClick={() => editorRef.current?.setList(formatState.listType === "ul" ? "none" : "ul")} disabled={disabledEditor}>
          <List size={14} />
        </button>
        <button type="button" title="编号" className={formatState.listType === "ol" ? "active" : ""} onClick={() => editorRef.current?.setList(formatState.listType === "ol" ? "none" : "ol")} disabled={disabledEditor}>
          <ListOrdered size={14} />
        </button>
        <button type="button" title="保存" onClick={onSave} disabled={disabled}>
          <Save size={14} />
        </button>
      </div>
      <div className="textbook-note-editor-host" ref={mountRef} aria-hidden={disabled ? "true" : undefined} />
    </div>
  );
});
