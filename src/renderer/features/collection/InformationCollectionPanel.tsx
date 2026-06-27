import React from "react";
import { CheckCircle2, ExternalLink, FileText, Loader2, Play, RefreshCw, Search, XCircle } from "lucide-react";
import { AISTUDY_CORE_CONTRACT } from "../../domain/coreContracts";
import type { Course } from "../course/courseTypes";
import type { KnowledgeDocumentSnapshot } from "../documents/knowledgeDocumentTypes";
import { buildMindMapOutline } from "../mindmap/mindMapSnapshot";
import type { MindMapDocument, MindMapOutlineItem } from "../mindmap/mindMapTypes";

type ToolStatus = {
  id: "yt-dlp" | "ffmpeg" | "whisper";
  name: string;
  available: boolean;
  version: string;
  message: string;
};

type BilibiliUp = {
  mid: number;
  name: string;
  face: string;
  spaceUrl: string;
};

type BilibiliVideo = {
  bvid: string;
  aid: number;
  cid: number;
  title: string;
  url: string;
  author: string;
  mid: number;
  publishedAt: string;
  durationSeconds: number;
  description: string;
  coverUrl: string;
  stats: {
    view: number;
    like: number;
    favorite: number;
    coin: number;
    reply: number;
    share: number;
  };
  transcript: {
    status: "available" | "missing" | "blocked";
    text: string;
    message: string;
  };
};

type CollectionStep = {
  id: "locate" | "read-video" | "read-up" | "list-videos" | "prepare-document";
  name: string;
  status: "pending" | "running" | "done" | "blocked" | "skipped";
  message: string;
};

type BilibiliCollectResult = {
  status: "ready" | "partial" | "blocked";
  message: string;
  up: BilibiliUp | null;
  videos: BilibiliVideo[];
  blockers: string[];
  steps: CollectionStep[];
  primaryBvid: string;
  collectedAt: string;
};

type ProcessStep = {
  id: "metadata" | "subtitle" | "official-text" | "download" | "transcribe";
  name: string;
  status: "pending" | "running" | "done" | "blocked" | "skipped";
  message: string;
};

type BilibiliProcessResult = {
  status: "ready" | "blocked";
  message: string;
  video: BilibiliVideo | null;
  steps: ProcessStep[];
  workDir: string;
};

type TranscriptBlock = {
  kind: "heading" | "item" | "paragraph";
  text: string;
};

type InformationCollectionPanelProps = {
  courses: Course[];
  activeCourseId: string | null;
};

declare global {
  interface Window {
    aistudyInformationCollection?: {
      collectBilibili: (input: { upName: string; bvid: string; mid?: number; pageSize?: number }) => Promise<BilibiliCollectResult>;
      processBilibili: (input: { bvid: string }) => Promise<BilibiliProcessResult>;
      toolStatus: () => Promise<ToolStatus[]>;
      openBilibili: (input: { upName?: string; bvid?: string; mid?: number }) => Promise<unknown>;
    };
  }
}

const DOCUMENT_EDITOR_VERSION = "canvas-editor@0.9.135";
const TRANSCRIPT_EMPTY_TEXT = "当前视频没有检测到公开字幕。后续完成音频下载和语音转写后，正文会写入这里。";
const TRANSCRIPT_MAX_PARAGRAPH_LENGTH = 180;
const TRANSCRIPT_HEADING_MAX_LENGTH = 86;

function formatDateTime(value: string) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return String(Math.round(value));
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function flattenOutline(items: MindMapOutlineItem[]) {
  const result: MindMapOutlineItem[] = [];
  const walk = (item: MindMapOutlineItem) => {
    result.push(item);
    item.children.forEach(walk);
  };
  items.forEach(walk);
  return result;
}

function createTextElement(value: string, options: Record<string, unknown> = {}) {
  return {
    value,
    size: 18,
    color: "#111827",
    ...options
  };
}

function createLine(value = "") {
  return { value: `${value}\n` };
}

function addHeading(main: unknown[], text: string, level = 1) {
  const size = level === 1 ? 28 : level === 2 ? 22 : 19;
  main.push(createTextElement(text, {
    size,
    bold: true,
    color: level === 1 ? "#111827" : "#1f6fd1"
  }));
  main.push(createLine());
}

function addParagraph(main: unknown[], text: string, options: Record<string, unknown> = {}) {
  for (const line of text.split(/\n+/).map((item) => item.trim()).filter(Boolean)) {
    main.push(createTextElement(line, options));
    main.push(createLine());
  }
}

function normalizeTranscriptFragment(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([，。！？；：、,.!?;:])/g, "$1")
    .replace(/([（(【[])\s+/g, "$1")
    .replace(/\s+([）)】\]])/g, "$1")
    .trim();
}

function isNumberedTranscriptItem(value: string) {
  return /^\d{1,3}[.、]\s*\S/.test(value);
}

function isStandaloneTranscriptNumber(value: string) {
  return /^\d{1,3}[.、]\s*$/.test(value);
}

function getTranscriptHeadingCandidate(value: string) {
  return normalizeTranscriptFragment(value).replace(/^\d{1,3}[.、]\s*/, "");
}

function isTranscriptSectionHeading(value: string) {
  const text = getTranscriptHeadingCandidate(value);
  if (!text || text.length > TRANSCRIPT_HEADING_MAX_LENGTH) return false;
  if (/^(概览|要闻|正文|转录正文|视频转录|官方文字稿|相关链接|相关阅读|总结|转录状态|模型发布|开发生态|产品应用|技术与洞察|行业动态)$/i.test(text)) return true;
  if (/^AI\s*早报\s*\d{4}-\d{2}-\d{2}$/i.test(text)) return true;
  if (isNumberedTranscriptItem(text)) return true;
  if (/[。！？!?；;]$/.test(text)) return false;
  return /^(第[一二三四五六七八九十百\d]+[章节部分]|[一二三四五六七八九十]+[、.．])/.test(text);
}

function isTranscriptNumberedSectionHeading(value: string) {
  return isNumberedTranscriptItem(value) && isTranscriptSectionHeading(value);
}

function normalizeTranscriptStructure(value: string) {
  return value
    .replace(/\r/g, "\n")
    .replace(/[ \t]+(?=#\d{1,3}\s+)/g, "\n")
    .replace(/(^|\n)\s*#(\d{1,3})(?=\s|$)/g, "$1$2. ")
    .replace(/([。！？!?；;])\s+(?=\d{1,3}[.、]\s+\S)/g, "$1\n")
    .replace(/[ \t]+(?=\d{1,3}[.、]\s+\S)/g, "\n")
    .replace(/[ \t]+(?=(?:概览|要闻|正文|总结|相关链接|相关阅读)(?:\s|[:：]))/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function mergeStandaloneTranscriptNumbers(lines: string[]) {
  const result: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isStandaloneTranscriptNumber(line)) {
      result.push(line);
      continue;
    }
    const number = line.match(/^(\d{1,3})/)?.[1];
    const nextLine = lines[index + 1];
    if (number && nextLine && !isStandaloneTranscriptNumber(nextLine)) {
      result.push(`${number}. ${nextLine}`);
      index += 1;
    } else {
      result.push(line);
    }
  }
  return result;
}

function coalesceTranscriptLines(lines: string[]) {
  const result: string[] = [];
  let buffer = "";
  const flush = () => {
    const text = normalizeTranscriptFragment(buffer);
    if (text) result.push(text);
    buffer = "";
  };

  for (const line of lines) {
    const text = normalizeTranscriptFragment(line);
    if (!text) continue;
    if (isNumberedTranscriptItem(text)) {
      flush();
      result.push(text);
      continue;
    }
    if (isTranscriptSectionHeading(text)) {
      flush();
      result.push(text);
      continue;
    }
    buffer = buffer ? `${buffer} ${text}` : text;
    if (/[。！？!?；;]$/.test(text) || buffer.length >= TRANSCRIPT_MAX_PARAGRAPH_LENGTH) {
      flush();
    }
  }
  flush();
  return result;
}

function splitTranscriptParagraph(value: string) {
  const text = normalizeTranscriptFragment(value);
  if (!text) return [];
  if (text.length <= TRANSCRIPT_MAX_PARAGRAPH_LENGTH || isNumberedTranscriptItem(text)) return [text];

  const parts = text.match(/[^。！？!?；;]+[。！？!?；;]?/g)?.map(normalizeTranscriptFragment).filter(Boolean) ?? [text];
  const result: string[] = [];
  let buffer = "";
  const flush = () => {
    const next = normalizeTranscriptFragment(buffer);
    if (next) result.push(next);
    buffer = "";
  };

  for (const part of parts) {
    if (!buffer) {
      buffer = part;
      continue;
    }
    if (buffer.length + part.length > TRANSCRIPT_MAX_PARAGRAPH_LENGTH) {
      flush();
      buffer = part;
    } else {
      buffer = `${buffer}${part}`;
    }
  }
  flush();
  return result;
}

function buildReadableTranscriptParagraphs(value: string) {
  const structured = normalizeTranscriptStructure(value);
  if (!structured) return [];
  const rawLines = structured
    .split(/\n+/)
    .map(normalizeTranscriptFragment)
    .filter(Boolean);
  const dedupedLines = rawLines.filter((line, index) => index === 0 || line !== rawLines[index - 1]);
  return coalesceTranscriptLines(mergeStandaloneTranscriptNumbers(dedupedLines))
    .flatMap(splitTranscriptParagraph)
    .filter((line, index, lines) => index === 0 || line !== lines[index - 1]);
}

function buildReadableTranscriptBlocks(value: string): TranscriptBlock[] {
  const paragraphs = buildReadableTranscriptParagraphs(value);
  const blocks: TranscriptBlock[] = [];

  for (const paragraph of paragraphs) {
    const text = normalizeTranscriptFragment(paragraph);
    if (!text) continue;
    const isNumberedItem = isNumberedTranscriptItem(text);
    const kind: TranscriptBlock["kind"] = isNumberedItem
      ? isTranscriptNumberedSectionHeading(text)
        ? "heading"
        : "item"
      : isTranscriptSectionHeading(text)
        ? "heading"
        : "paragraph";
    const previous = blocks[blocks.length - 1];
    if (previous?.kind === kind && previous.text === text) continue;
    blocks.push({ kind, text });
  }

  return blocks;
}

function getTranscriptHeading(video: BilibiliVideo) {
  if (video.transcript.status !== "available") return "待转录内容";
  return /文字稿/.test(video.transcript.message) ? "官方文字稿" : "视频转录";
}

function getVideoTranscriptBlocks(video: BilibiliVideo): TranscriptBlock[] {
  const blocks = buildReadableTranscriptBlocks(video.transcript.text);
  return blocks.length ? blocks : [{ kind: "paragraph", text: TRANSCRIPT_EMPTY_TEXT }];
}

function addTranscriptBlock(main: unknown[], block: TranscriptBlock) {
  if (block.kind === "heading") {
    main.push(createLine());
    addHeading(main, block.text, 3);
    return;
  }
  if (block.kind === "item") {
    main.push(createLine());
    addParagraph(main, block.text, { bold: true, color: "#1f6fd1" });
    return;
  }
  addParagraph(main, block.text);
}

function createVideoDocumentSnapshot(video: BilibiliVideo): KnowledgeDocumentSnapshot {
  const main: unknown[] = [];
  addHeading(main, video.title, 1);
  addParagraph(main, `来源：${video.author} / ${video.bvid}`);
  addParagraph(main, `发布时间：${formatDateTime(video.publishedAt)}    时长：${formatDuration(video.durationSeconds) || "未知"}`);
  addParagraph(main, `链接：${video.url}`, { color: "#2563eb" });
  main.push(createLine());

  addHeading(main, "基础信息", 2);
  addParagraph(main, `播放 ${formatNumber(video.stats.view)} · 点赞 ${formatNumber(video.stats.like)} · 收藏 ${formatNumber(video.stats.favorite)} · 评论 ${formatNumber(video.stats.reply)}`);
  if (video.description) {
    addParagraph(main, video.description);
  }
  main.push(createLine());

  addHeading(main, "转录状态", 2);
  addParagraph(main, video.transcript.message, {
    color: video.transcript.status === "available" ? "#047857" : "#b45309"
  });
  main.push(createLine());

  addHeading(main, getTranscriptHeading(video), 2);
  for (const block of getVideoTranscriptBlocks(video)) {
    addTranscriptBlock(main, block);
  }

  return {
    schemaVersion: AISTUDY_CORE_CONTRACT.schemaVersion,
    editor: AISTUDY_CORE_CONTRACT.editors.knowledgeDocument,
    editorVersion: DOCUMENT_EDITOR_VERSION,
    content: {
      main
    },
    updatedAt: new Date().toISOString()
  };
}

function getCollectionStepClass(status: CollectionStep["status"]) {
  if (status === "done") return "collection-step done";
  if (status === "running") return "collection-step active";
  if (status === "blocked") return "collection-step blocked";
  if (status === "skipped") return "collection-step skipped";
  return "collection-step";
}

export function InformationCollectionPanel({ courses, activeCourseId }: InformationCollectionPanelProps) {
  const [upName, setUpName] = React.useState("");
  const [bvid, setBvid] = React.useState("");
  const [result, setResult] = React.useState<BilibiliCollectResult | null>(null);
  const [selectedBvid, setSelectedBvid] = React.useState("");
  const [tools, setTools] = React.useState<ToolStatus[]>([]);
  const [isCollecting, setIsCollecting] = React.useState(false);
  const [isCheckingTools, setIsCheckingTools] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const [targetCourseId, setTargetCourseId] = React.useState(activeCourseId ?? "");
  const [targetMindMap, setTargetMindMap] = React.useState<MindMapDocument | null>(null);
  const [targetNodes, setTargetNodes] = React.useState<MindMapOutlineItem[]>([]);
  const [targetNodeId, setTargetNodeId] = React.useState("");
  const [isLoadingTarget, setIsLoadingTarget] = React.useState(false);
  const [isSavingDocument, setIsSavingDocument] = React.useState(false);
  const [isProcessingVideo, setIsProcessingVideo] = React.useState(false);
  const [processSteps, setProcessSteps] = React.useState<ProcessStep[]>([]);

  const selectedVideo = React.useMemo(
    () => result?.videos.find((video) => video.bvid === selectedBvid) ?? result?.videos[0] ?? null,
    [result, selectedBvid]
  );

  const documentSnapshot = React.useMemo(
    () => (selectedVideo ? createVideoDocumentSnapshot(selectedVideo) : null),
    [selectedVideo]
  );
  const selectedTranscriptBlocks = React.useMemo(
    () => (selectedVideo ? getVideoTranscriptBlocks(selectedVideo) : []),
    [selectedVideo]
  );
  const collectionSteps = React.useMemo<CollectionStep[]>(() => result?.steps?.length
    ? result.steps
    : [
        { id: "locate", name: "定位视频", status: isCollecting ? "running" : "pending", message: "" },
        { id: "read-up", name: "确认 UP", status: "pending", message: "" },
        { id: "list-videos", name: "读取候选", status: "pending", message: "" },
        { id: "read-video", name: "读取内容", status: "pending", message: "" },
        { id: "prepare-document", name: "生成 Word", status: "pending", message: "" }
      ], [isCollecting, result]);

  React.useEffect(() => {
    if (!targetCourseId && activeCourseId) setTargetCourseId(activeCourseId);
  }, [activeCourseId, targetCourseId]);

  const refreshTools = React.useCallback(async () => {
    setIsCheckingTools(true);
    try {
      setTools(await window.aistudyInformationCollection?.toolStatus?.() ?? []);
    } finally {
      setIsCheckingTools(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshTools();
  }, [refreshTools]);

  React.useEffect(() => {
    if (!targetCourseId) {
      setTargetMindMap(null);
      setTargetNodes([]);
      setTargetNodeId("");
      return undefined;
    }

    let disposed = false;
    setIsLoadingTarget(true);
    window.aistudyMindMaps?.load(targetCourseId)
      .then((document) => {
        if (disposed) return;
        setTargetMindMap(document);
        const nodes = flattenOutline(buildMindMapOutline(document?.snapshot?.root ?? null)).filter((node) => node.nodeId);
        setTargetNodes(nodes);
        setTargetNodeId((current) => current && nodes.some((node) => node.nodeId === current) ? current : "");
      })
      .catch(() => {
        if (disposed) return;
        setTargetMindMap(null);
        setTargetNodes([]);
        setTargetNodeId("");
      })
      .finally(() => {
        if (!disposed) setIsLoadingTarget(false);
      });

    return () => {
      disposed = true;
    };
  }, [targetCourseId]);

  async function collect() {
    setIsCollecting(true);
    setError("");
    setMessage("");
    try {
      const nextResult = await window.aistudyInformationCollection?.collectBilibili?.({
        upName,
        bvid,
        pageSize: 30
      });
      if (!nextResult) throw new Error("信息采集服务未就绪");
      setResult(nextResult);
      setSelectedBvid(nextResult.primaryBvid || nextResult.videos[0]?.bvid || "");
      setMessage(nextResult.message);
      if (nextResult.up?.name && !upName.trim()) setUpName(nextResult.up.name);
      if (nextResult.videos[0]?.bvid && !bvid.trim()) setBvid(nextResult.videos[0].bvid);
    } catch (collectError) {
      setError(collectError instanceof Error ? collectError.message : "采集没有完成");
    } finally {
      setIsCollecting(false);
    }
  }

  async function openBilibili() {
    setError("");
    try {
      await window.aistudyInformationCollection?.openBilibili?.({
        upName,
        bvid: selectedVideo?.bvid || bvid,
        mid: result?.up?.mid
      });
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "B站页面没有打开");
    }
  }

  async function processVideo() {
    if (!selectedVideo) return;
    setIsProcessingVideo(true);
    setError("");
    setMessage("");
    setProcessSteps([
      { id: "metadata", name: "读取视频", status: "running", message: "正在准备。" },
      { id: "subtitle", name: "读取字幕", status: "pending", message: "等待。" },
      { id: "official-text", name: "读取文字稿", status: "pending", message: "等待。" },
      { id: "download", name: "下载音频", status: "pending", message: "等待。" },
      { id: "transcribe", name: "语音转写", status: "pending", message: "等待。" }
    ]);
    try {
      const processResult = await window.aistudyInformationCollection?.processBilibili?.({ bvid: selectedVideo.bvid });
      if (!processResult) throw new Error("视频处理服务未就绪");
      setProcessSteps(processResult.steps);
      setMessage(processResult.message);
      if (processResult.video) {
        setResult((current) => current
          ? {
              ...current,
              videos: current.videos.map((video) => video.bvid === processResult.video?.bvid ? processResult.video : video)
            }
          : current
        );
      }
      if (processResult.status === "blocked") {
        setError(processResult.message);
      }
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : "视频处理没有完成");
    } finally {
      setIsProcessingVideo(false);
    }
  }

  async function saveDocument() {
    if (!documentSnapshot || !targetCourseId || !targetMindMap?.mapId || !targetNodeId || !selectedVideo) return;
    setIsSavingDocument(true);
    setError("");
    setMessage("");
    try {
      const existing = await window.aistudyKnowledgeDocuments?.load?.({
        courseId: targetCourseId,
        mindMapId: targetMindMap.mapId,
        nodeId: targetNodeId
      });
      if (existing?.hasContent && !window.confirm("所选分支已有文档内容，确定用本次采集稿覆盖吗？")) {
        return;
      }
      await window.aistudyKnowledgeDocuments?.save?.({
        courseId: targetCourseId,
        mindMapId: targetMindMap.mapId,
        nodeId: targetNodeId,
        title: selectedVideo.title,
        snapshot: documentSnapshot
      });
      setMessage("已写入所选分支文档。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "文档写入没有完成");
    } finally {
      setIsSavingDocument(false);
    }
  }

  const toolReadyCount = tools.filter((tool) => tool.available).length;
  const canSaveDocument = Boolean(documentSnapshot && targetCourseId && targetMindMap?.mapId && targetNodeId);

  return (
    <main className="collection-layout" aria-label="信息采集">
      <section className="collection-page">
        <header className="collection-header">
          <div>
            <p className="section-kicker">信息采集</p>
            <h1>视频资料采集</h1>
          </div>
          <button className="secondary-button" type="button" onClick={() => void refreshTools()} disabled={isCheckingTools}>
            {isCheckingTools ? <Loader2 className="spin-icon" size={16} /> : <RefreshCw size={16} />}
            检查工具
          </button>
        </header>

        <div className="collection-steps" aria-label="采集流程">
          {collectionSteps.map((step) => (
            <span className={getCollectionStepClass(step.status)} key={step.id} title={step.message}>
              {step.name}
            </span>
          ))}
        </div>

        {message ? <p className="status-message success">{message}</p> : null}
        {error ? <p className="status-message error">{error}</p> : null}

        <section className="collection-task-panel" aria-label="采集任务">
          <label className="collection-field">
            <span>UP 主</span>
            <input value={upName} onChange={(event) => setUpName(event.target.value)} placeholder="输入 UP 主名称" />
          </label>
          <label className="collection-field">
            <span>视频</span>
            <input value={bvid} onChange={(event) => setBvid(event.target.value)} placeholder="BV / 链接 / 标题关键词" />
          </label>
          <button className="primary-button" type="button" onClick={() => void collect()} disabled={isCollecting || (!upName.trim() && !bvid.trim())}>
            {isCollecting ? <Loader2 className="spin-icon" size={16} /> : <Search size={16} />}
            开始采集
          </button>
          <button className="secondary-button" type="button" onClick={() => void openBilibili()}>
            <ExternalLink size={16} />
            打开 B站
          </button>
        </section>

        <div className="collection-content">
          <section className="collection-panel">
            <div className="collection-panel-heading">
              <div>
                <h2>{result?.up?.name ?? "采集结果"}</h2>
                <p>{result?.up ? `UID ${result.up.mid}` : "输入 UP 主或 BV 后开始"}</p>
              </div>
              <span className={`collection-status-chip ${result?.status ?? "idle"}`}>
                {result ? result.message : "等待"}
              </span>
            </div>

            {result?.blockers.length ? (
              <div className="collection-blockers">
                {result.blockers.map((blocker) => (
                  <span key={blocker}>{blocker}</span>
                ))}
              </div>
            ) : null}

            {result?.videos.length ? (
              <div className="collection-video-list" aria-label="视频记录">
                {result.videos.map((video) => (
                  <button
                    key={video.bvid}
                    className={selectedVideo?.bvid === video.bvid ? "collection-video-row active" : "collection-video-row"}
                    type="button"
                    onClick={() => setSelectedBvid(video.bvid)}
                  >
                    <span className="collection-video-title">{video.title}</span>
                    <span>{formatDateTime(video.publishedAt)}</span>
                    <span>{video.bvid}</span>
                    <span>播放 {formatNumber(video.stats.view)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="collection-empty-state">
                <strong>暂无视频记录</strong>
                <span>采集成功后会按发布时间从新到旧显示。</span>
              </div>
            )}
          </section>

          <aside className="collection-side-panel">
            <section className="collection-mini-panel">
              <div className="collection-mini-heading">
                <h2>转录工具</h2>
                <span>{toolReadyCount}/{tools.length || 3}</span>
              </div>
              <div className="collection-tool-list">
                {tools.map((tool) => (
                  <div className="collection-tool-row" key={tool.id}>
                    {tool.available ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                    <span>{tool.name}</span>
                    <small>{tool.message}</small>
                  </div>
                ))}
              </div>
            </section>

            <section className="collection-mini-panel">
              <div className="collection-mini-heading">
                <h2>入库目标</h2>
                {isLoadingTarget ? <Loader2 className="spin-icon" size={15} /> : null}
              </div>
              <label className="collection-field compact">
                <span>知识库</span>
                <select value={targetCourseId} onChange={(event) => setTargetCourseId(event.target.value)}>
                  <option value="">选择知识库</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>{course.name}</option>
                  ))}
                </select>
              </label>
              <label className="collection-field compact">
                <span>分支文档</span>
                <select value={targetNodeId} onChange={(event) => setTargetNodeId(event.target.value)} disabled={!targetNodes.length}>
                  <option value="">选择导图分支</option>
                  {targetNodes.map((node) => (
                    <option key={node.nodeId ?? node.id} value={node.nodeId ?? ""}>
                      {"　".repeat(Math.max(0, node.level))}{node.title}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary-button collection-save-button" type="button" onClick={() => void saveDocument()} disabled={!canSaveDocument || isSavingDocument}>
                {isSavingDocument ? <Loader2 className="spin-icon" size={16} /> : <FileText size={16} />}
                写入 Word
              </button>
            </section>
          </aside>
        </div>

        <section className="collection-document-panel" aria-label="Word 文档预览">
          <div className="collection-document-header">
            <div>
              <h2>Word 文档</h2>
              <p>{selectedVideo ? selectedVideo.title : "选择视频后生成"}</p>
            </div>
            <button className="secondary-button compact-button" type="button" onClick={() => selectedVideo && void openBilibili()} disabled={!selectedVideo}>
              <Play size={15} />
              查看来源
            </button>
            <button className="primary-button compact-button" type="button" onClick={() => void processVideo()} disabled={!selectedVideo || isProcessingVideo}>
              {isProcessingVideo ? <Loader2 className="spin-icon" size={15} /> : <RefreshCw size={15} />}
              下载转录
            </button>
          </div>

          {processSteps.length ? (
            <div className="collection-process-steps" aria-label="视频处理步骤">
              {processSteps.map((step) => (
                <div className={`collection-process-step ${step.status}`} key={step.id}>
                  <strong>{step.name}</strong>
                  <span>{step.message}</span>
                </div>
              ))}
            </div>
          ) : null}

          <article className="collection-word-page">
            {selectedVideo ? (
              <>
                <h1>{selectedVideo.title}</h1>
                <p className="collection-word-meta">{selectedVideo.author} · {selectedVideo.bvid} · {formatDateTime(selectedVideo.publishedAt)}</p>
                <p>播放 {formatNumber(selectedVideo.stats.view)} · 点赞 {formatNumber(selectedVideo.stats.like)} · 收藏 {formatNumber(selectedVideo.stats.favorite)}</p>
                {selectedVideo.description ? <p>{selectedVideo.description}</p> : null}
                <h2>转录状态</h2>
                <p>{selectedVideo.transcript.message}</p>
                <h2>{getTranscriptHeading(selectedVideo)}</h2>
                <div className="collection-word-transcript">
                  {selectedTranscriptBlocks.map((block, index) => (
                    block.kind === "heading" ? (
                      <h3 key={`${index}-${block.text.slice(0, 16)}`}>{block.text}</h3>
                    ) : (
                      <p className={block.kind === "item" ? "collection-transcript-item" : undefined} key={`${index}-${block.text.slice(0, 16)}`}>
                        {block.text}
                      </p>
                    )
                  ))}
                </div>
              </>
            ) : (
              <div className="collection-word-empty">暂无文档</div>
            )}
          </article>
        </section>
      </section>
    </main>
  );
}
