import * as electron from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document as DocxDocument,
  ExternalHyperlink,
  FileChild,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Tab,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  UnderlineType,
  WidthType,
  type IRunOptions
} from "docx";

type KnowledgeDocumentSnapshot = {
  schemaVersion: 1;
  editor: "aistudy-word";
  editorVersion: string;
  content: unknown;
  updatedAt: string;
};

type KnowledgeDocumentDocxExportRequest = {
  title?: unknown;
  snapshot?: unknown;
};

type KnowledgeDocumentDocxExportResult = {
  canceled: boolean;
  filePath: string;
};

type DocxTextStyle = {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  size?: number;
  font?: string;
  highlight?: IRunOptions["highlight"];
  link?: string;
  subScript?: boolean;
  superScript?: boolean;
};

type DocxParagraphStyle = {
  rowFlex?: unknown;
  listType?: string;
  level?: unknown;
  indent?: unknown;
};

type DocxParagraphBlock = {
  runs: Array<{ text: string; style: DocxTextStyle }>;
  style: DocxParagraphStyle;
};

const { dialog } = electron;
type BrowserWindow = electron.BrowserWindow;

const DEFAULT_DOCX_TITLE = "AIstudy Document";
const DEFAULT_FONT = "Microsoft YaHei";
const DOCX_PAGE_WIDTH = 11906;
const DOCX_PAGE_HEIGHT = 16838;
const DOCX_TEXT_COLOR = "1F2937";
const DOCX_TABLE_BORDER_COLOR = "CBD5E1";
const AISTUDY_COLUMN_BLOCK_KIND = "columns";
const DOCX_TWIP_PER_PT = 20;
const DOCX_PX_TO_PT = 0.75;
const DOCX_EDITOR_MARGIN_TWIP = 960;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function sanitizeKnowledgeDocumentDocxFileName(value: string) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || DEFAULT_DOCX_TITLE;
}

function normalizeDocxTitle(value: unknown) {
  return (typeof value === "string" && value.trim() ? value.trim() : DEFAULT_DOCX_TITLE).slice(0, 120);
}

function normalizeKnowledgeDocumentSnapshot(value: unknown): KnowledgeDocumentSnapshot {
  if (!isRecord(value)) {
    throw new Error("文档快照格式无效");
  }
  if (value.schemaVersion !== 1 || value.editor !== "aistudy-word") {
    throw new Error("文档快照协议不支持");
  }
  return {
    schemaVersion: 1,
    editor: "aistudy-word",
    editorVersion: typeof value.editorVersion === "string" ? value.editorVersion : "unknown",
    content: value.content ?? { main: [] },
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString()
  };
}

function normalizeHexColor(value: unknown, fallback = DOCX_TEXT_COLOR) {
  if (typeof value !== "string") return fallback;
  const hex = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) return hex.toUpperCase();
  const rgb = value.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (!rgb) return fallback;
  return rgb
    .slice(1, 4)
    .map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function normalizeHighlight(value: unknown): IRunOptions["highlight"] | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const color = normalizeHexColor(value, "");
  if (!color) return undefined;
  const known: Record<string, IRunOptions["highlight"]> = {
    FEF3C7: "yellow",
    FDE68A: "yellow",
    FEF08A: "yellow",
    DCFCE7: "green",
    DBEAFE: "cyan",
    EDE9FE: "magenta",
    FCE7F3: "magenta"
  };
  return known[color];
}

function toHalfPointSize(value: unknown, fallbackPt = 12) {
  const numeric = Number(value);
  const pointSize = Number.isFinite(numeric) && numeric > 0
    ? Math.max(8, Math.min(36, Math.round(numeric * DOCX_PX_TO_PT)))
    : fallbackPt;
  return pointSize * 2;
}

function detectHeadingLevel(text: string, element: Record<string, unknown>) {
  const level = typeof element.level === "string" ? element.level : "";
  if (level === "first") return 1;
  if (level === "second") return 2;
  if (level === "third") return 3;
  if (level === "fourth") return 4;
  return 0;
}

function readElementText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(readElementText).join("");
  if (!isRecord(value)) return "";
  let text = typeof value.value === "string" ? value.value : "";
  for (const [key, child] of Object.entries(value)) {
    if (key === "value") continue;
    if (["content", "main", "header", "footer", "children", "items", "paragraphs", "rows", "cells", "trList", "tdList", "valueList", "listWrap"].includes(key) || Array.isArray(child)) {
      text += readElementText(child);
    }
  }
  return text;
}

function readElementTextStyle(element: Record<string, unknown>, inherited: DocxTextStyle = {}): DocxTextStyle {
  return {
    ...inherited,
    bold: typeof element.bold === "boolean" ? element.bold : inherited.bold,
    italics: typeof element.italic === "boolean" ? element.italic : inherited.italics,
    underline: element.underline === true ? true : inherited.underline,
    strike: typeof element.strikeout === "boolean" ? element.strikeout : inherited.strike,
    color: element.color ? normalizeHexColor(element.color, inherited.color ?? DOCX_TEXT_COLOR) : inherited.color,
    size: element.size ? toHalfPointSize(element.size) : inherited.size,
    font: typeof element.font === "string" && element.font.trim() ? element.font.trim() : inherited.font,
    highlight: element.highlight ? normalizeHighlight(element.highlight) : inherited.highlight,
    link: typeof element.href === "string" ? element.href : typeof element.url === "string" ? element.url : inherited.link,
    subScript: element.type === "subscript" ? true : inherited.subScript,
    superScript: element.type === "superscript" ? true : inherited.superScript
  };
}

function readElementParagraphStyle(element: Record<string, unknown>, inherited: DocxParagraphStyle = {}): DocxParagraphStyle {
  return {
    ...inherited,
    rowFlex: element.rowFlex ?? inherited.rowFlex,
    listType: typeof element.listType === "string" ? element.listType : inherited.listType,
    level: element.level ?? inherited.level,
    indent: element.indent ?? inherited.indent
  };
}

function createTextRun(text: string, style: DocxTextStyle, headingLevel = 0) {
  return new TextRun({
    text,
    bold: headingLevel > 0 ? true : style.bold,
    italics: style.italics,
    underline: style.underline ? { type: UnderlineType.SINGLE } : undefined,
    strike: style.strike,
    color: style.color ?? DOCX_TEXT_COLOR,
    size: style.size ?? (headingLevel === 1 ? 32 : headingLevel === 2 ? 28 : headingLevel === 3 ? 24 : 24),
    font: style.font || DEFAULT_FONT,
    highlight: style.highlight,
    subScript: style.subScript,
    superScript: style.superScript
  });
}

function createTabRun(style: DocxTextStyle, headingLevel = 0) {
  return new TextRun({
    children: [new Tab()],
    bold: headingLevel > 0 ? true : style.bold,
    italics: style.italics,
    underline: style.underline ? { type: UnderlineType.SINGLE } : undefined,
    strike: style.strike,
    color: style.color ?? DOCX_TEXT_COLOR,
    size: style.size ?? (headingLevel === 1 ? 32 : headingLevel === 2 ? 28 : headingLevel === 3 ? 24 : 24),
    font: style.font || DEFAULT_FONT,
    highlight: style.highlight,
    subScript: style.subScript,
    superScript: style.superScript
  });
}

function createRunChildren(runs: Array<{ text: string; style: DocxTextStyle }>, headingLevel = 0) {
  const children: Array<TextRun | ExternalHyperlink> = [];
  for (const run of runs.length > 0 ? runs : [{ text: "", style: {} }]) {
    const parts = String(run.text ?? "").split(/(\t|\n)/);
    for (const part of parts) {
      if (part === "") continue;
      if (part === "\n") {
        children.push(new TextRun({ break: 1 }));
        continue;
      }
      if (part === "\t") {
        children.push(createTabRun(run.style, headingLevel));
        continue;
      }
      const textRun = createTextRun(part, run.style, headingLevel);
      if (run.style.link && /^https?:\/\//i.test(run.style.link)) {
        children.push(new ExternalHyperlink({ link: run.style.link, children: [textRun] }));
      } else {
        children.push(textRun);
      }
    }
  }
  return children;
}

function getAlignment(rowFlex: unknown) {
  if (rowFlex === "center") return AlignmentType.CENTER;
  if (rowFlex === "right") return AlignmentType.RIGHT;
  if (rowFlex === "alignment" || rowFlex === "justify") return AlignmentType.JUSTIFIED;
  return AlignmentType.LEFT;
}

function getParagraphSpacing(headingLevel: number) {
  if (headingLevel === 1) return { before: 180, after: 80 };
  if (headingLevel === 2) return { before: 140, after: 60 };
  if (headingLevel === 3) return { before: 100, after: 40 };
  return { before: 0, after: 0, line: 300 };
}

function appendTextToParagraphBlocks(
  text: string,
  style: DocxTextStyle,
  paragraphStyle: DocxParagraphStyle,
  blocks: DocxParagraphBlock[],
  current: { block: DocxParagraphBlock }
) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n");
  parts.forEach((part, index) => {
    if (index > 0) {
      blocks.push(current.block);
      current.block = { runs: [], style: paragraphStyle };
    }
    if (part) {
      current.block.style = { ...current.block.style, ...paragraphStyle };
      current.block.runs.push({ text: part, style });
    }
  });
}

function flattenElementToParagraphBlocks(
  element: unknown,
  blocks: DocxParagraphBlock[],
  current: { block: DocxParagraphBlock },
  inheritedTextStyle: DocxTextStyle = {},
  inheritedParagraphStyle: DocxParagraphStyle = {}
) {
  if (typeof element === "string") {
    appendTextToParagraphBlocks(element, inheritedTextStyle, inheritedParagraphStyle, blocks, current);
    return;
  }
  if (Array.isArray(element)) {
    element.forEach((item) => flattenElementToParagraphBlocks(item, blocks, current, inheritedTextStyle, inheritedParagraphStyle));
    return;
  }
  if (!isRecord(element)) return;

  const textStyle = readElementTextStyle(element, inheritedTextStyle);
  const paragraphStyle = readElementParagraphStyle(element, inheritedParagraphStyle);
  if (element.type === "tab") {
    appendTextToParagraphBlocks("\t", textStyle, paragraphStyle, blocks, current);
  } else if (typeof element.value === "string") {
    appendTextToParagraphBlocks(element.value, textStyle, paragraphStyle, blocks, current);
  }

  for (const [key, child] of Object.entries(element)) {
    if (key === "value") continue;
    if (["valueList", "listWrap", "children", "items", "paragraphs"].includes(key) || Array.isArray(child)) {
      flattenElementToParagraphBlocks(child, blocks, current, textStyle, paragraphStyle);
    }
  }
}

function createParagraphFromBlock(block: DocxParagraphBlock): Paragraph {
  const text = block.runs.map((run) => run.text).join("");
  const headingLevel = detectHeadingLevel(text, { level: block.style.level });
  const hasText = text.trim().length > 0;
  const listType = hasText && typeof block.style.listType === "string" ? block.style.listType : "";
  return new Paragraph({
    children: createRunChildren(block.runs, headingLevel),
    heading: headingLevel === 1
      ? HeadingLevel.HEADING_1
      : headingLevel === 2
        ? HeadingLevel.HEADING_2
        : headingLevel === 3
          ? HeadingLevel.HEADING_3
          : undefined,
    alignment: getAlignment(block.style.rowFlex),
    spacing: hasText ? getParagraphSpacing(headingLevel) : { before: 0, after: 0 },
    numbering: listType === "ul"
      ? { reference: "aistudy-bullets", level: 0 }
      : listType === "ol"
        ? { reference: "aistudy-numbering", level: 0 }
        : undefined,
    keepNext: headingLevel > 0
  });
}

function getCellText(cell: unknown) {
  if (!isRecord(cell)) return "";
  return readElementText(cell.value ?? cell.valueList ?? cell.children ?? cell);
}

function getCellElements(cell: unknown) {
  if (!isRecord(cell)) return [];
  if (Array.isArray(cell.value)) return cell.value;
  if (Array.isArray(cell.valueList)) return cell.valueList;
  if (Array.isArray(cell.children)) return cell.children;
  return [];
}

function isColumnBlockElement(element: Record<string, unknown>) {
  return element.aistudyBlockKind === AISTUDY_COLUMN_BLOCK_KIND;
}

function isColumnBlockGapCell(cell: unknown) {
  return isRecord(cell) && cell.disabled === true && !getCellText(cell).trim();
}

function isBorderlessTableElement(element: Record<string, unknown>) {
  return element.borderType === "empty";
}

function createTableBorder(style: (typeof BorderStyle)[keyof typeof BorderStyle], size: number, color: string) {
  return { style, size, color };
}

function createParagraphsFromCell(cell: unknown) {
  const elements = getCellElements(cell);
  const blocks: DocxParagraphBlock[] = [];
  const current = { block: { runs: [], style: {} } as DocxParagraphBlock };
  for (const element of elements) {
    flattenElementToParagraphBlocks(element, blocks, current);
  }
  if (current.block.runs.length > 0 || blocks.length > 0) {
    blocks.push(current.block);
  }
  while (blocks.length > 1 && blocks[blocks.length - 1].runs.length === 0) {
    blocks.pop();
  }
  if (blocks.length === 0) {
    return [
      new Paragraph({
        children: [new TextRun({ text: getCellText(cell) || " ", font: DEFAULT_FONT, size: 22, color: DOCX_TEXT_COLOR })],
        spacing: { before: 0, after: 0, line: 300 }
      })
    ];
  }
  return blocks.map(createParagraphFromBlock);
}

function createTableFromElement(element: Record<string, unknown>) {
  const rawRows = Array.isArray(element.trList) ? element.trList : [];
  const columnBlock = isColumnBlockElement(element);
  const borderless = isBorderlessTableElement(element);
  const columnCount = Math.max(0, Math.min(3, Number(element.aistudyColumnCount) || 0));
  const subtleBorder = createTableBorder(BorderStyle.SINGLE, 1, DOCX_TABLE_BORDER_COLOR);
  const emptyBorder = createTableBorder(BorderStyle.NONE, 0, "FFFFFF");
  const rows = rawRows.map((row) => {
    const rawCells = isRecord(row) && Array.isArray(row.tdList) ? row.tdList : [];
    const exportCells = columnBlock
      ? rawCells.filter((cell) => !isColumnBlockGapCell(cell)).slice(0, columnCount || undefined)
      : rawCells;
    return new TableRow({
      children: exportCells.map((cell, index) => new TableCell({
        shading: columnBlock || borderless || index !== 0 ? undefined : { type: ShadingType.CLEAR, fill: "F8FAFC", color: "auto" },
        margins: columnBlock ? { top: 80, bottom: 80, left: 260, right: 260 } : borderless ? { top: 80, bottom: 80, left: 140, right: 140 } : { top: 120, bottom: 120, left: 160, right: 160 },
        width: columnBlock && exportCells.length > 0 ? { size: Math.floor(100 / exportCells.length), type: WidthType.PERCENTAGE } : undefined,
        children: createParagraphsFromCell(cell)
      }))
    });
  });
  if (rows.length === 0) return null;
  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: columnBlock ? TableLayoutType.FIXED : TableLayoutType.AUTOFIT,
    borders: {
      top: columnBlock || borderless ? emptyBorder : subtleBorder,
      bottom: columnBlock || borderless ? emptyBorder : subtleBorder,
      left: columnBlock || borderless ? emptyBorder : subtleBorder,
      right: columnBlock || borderless ? emptyBorder : subtleBorder,
      insideHorizontal: columnBlock || borderless ? emptyBorder : subtleBorder,
      insideVertical: columnBlock ? subtleBorder : borderless ? emptyBorder : subtleBorder
    },
    margins: columnBlock || borderless ? { top: 80, bottom: 80, left: 80, right: 80 } : { top: 120, bottom: 120, left: 120, right: 120 }
  });
}

function parseDataUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/^data:([^;,]+)(?:;[^,]+)*;base64,([\s\S]+)$/i);
  if (!match) return null;
  return { mimeType: match[1], data: Buffer.from(match[2], "base64") };
}

function createImageFromElement(element: Record<string, unknown>) {
  const image = parseDataUrl(element.value ?? element.url ?? element.src);
  if (!image) return null;
  const width = Math.max(120, Math.min(520, Number(element.width) || 420));
  const height = Math.max(80, Math.min(720, Number(element.height) || Math.round(width * 0.62)));
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 160, after: 160 },
    children: [
      new ImageRun({
        data: image.data,
        type: image.mimeType.includes("png") ? "png" : image.mimeType.includes("gif") ? "gif" : "jpg",
        transformation: { width, height }
      })
    ]
  });
}

function buildDocxChildren(snapshot: KnowledgeDocumentSnapshot): FileChild[] {
  const content = isRecord(snapshot.content) ? snapshot.content : {};
  const main = Array.isArray(content.main) ? content.main : [];
  const children: FileChild[] = [];
  const blocks: DocxParagraphBlock[] = [];
  const current = { block: { runs: [], style: {} } as DocxParagraphBlock };
  const flushParagraphBlocks = () => {
    if (current.block.runs.length > 0 || blocks.length > 0) {
      blocks.push(current.block);
      current.block = { runs: [], style: {} };
      while (blocks.length > 0) {
        children.push(createParagraphFromBlock(blocks.shift() as DocxParagraphBlock));
      }
    }
  };
  for (const element of main) {
    if (isRecord(element) && element.type === "pageBreak") {
      flushParagraphBlocks();
      children.push(new Paragraph({ children: [new PageBreak()] }));
      continue;
    }
    if (isRecord(element) && Array.isArray(element.trList)) {
      flushParagraphBlocks();
      const table = createTableFromElement(element);
      if (table) children.push(table);
      continue;
    }
    if (isRecord(element)) {
      const image = createImageFromElement(element);
      if (image) {
        flushParagraphBlocks();
        children.push(image);
        continue;
      }
    }
    flattenElementToParagraphBlocks(element, blocks, current);
  }
  flushParagraphBlocks();
  return children.length > 0 ? children : [new Paragraph({ text: "" })];
}

function createDocxDocument(title: string, snapshot: KnowledgeDocumentSnapshot) {
  return new DocxDocument({
    title,
    creator: "AIstudy",
    description: "Exported from AIstudy knowledge document.",
    styles: {
      default: {
        document: {
          run: { font: DEFAULT_FONT, size: 24, color: DOCX_TEXT_COLOR },
          paragraph: { spacing: { line: 300, after: 0 } }
        },
        heading1: {
          run: { font: DEFAULT_FONT, size: 32, bold: true, color: DOCX_TEXT_COLOR },
          paragraph: { spacing: { before: 180, after: 80 }, keepNext: true }
        },
        heading2: {
          run: { font: DEFAULT_FONT, size: 28, bold: true, color: DOCX_TEXT_COLOR },
          paragraph: { spacing: { before: 140, after: 60 }, keepNext: true }
        },
        heading3: {
          run: { font: DEFAULT_FONT, size: 24, bold: true, color: DOCX_TEXT_COLOR },
          paragraph: { spacing: { before: 100, after: 40 }, keepNext: true }
        }
      }
    },
    numbering: {
      config: [
        {
          reference: "aistudy-bullets",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "·", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }]
        },
        {
          reference: "aistudy-numbering",
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }]
        }
      ]
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: DOCX_PAGE_WIDTH, height: DOCX_PAGE_HEIGHT },
            margin: {
              top: DOCX_EDITOR_MARGIN_TWIP,
              right: DOCX_EDITOR_MARGIN_TWIP,
              bottom: DOCX_EDITOR_MARGIN_TWIP,
              left: DOCX_EDITOR_MARGIN_TWIP
            }
          }
        },
        children: buildDocxChildren(snapshot)
      }
    ]
  });
}

export async function exportKnowledgeDocumentDocx(
  parentWindow: BrowserWindow | null,
  input: unknown
): Promise<KnowledgeDocumentDocxExportResult> {
  const request = isRecord(input) ? input as KnowledgeDocumentDocxExportRequest : {};
  const title = normalizeDocxTitle(request.title);
  const snapshot = normalizeKnowledgeDocumentSnapshot(request.snapshot);
  const defaultPath = path.join(process.env.USERPROFILE || process.cwd(), "Desktop", `${sanitizeKnowledgeDocumentDocxFileName(title)}.docx`);
  const options = {
    title: "导出 Word 文档",
    defaultPath,
    filters: [{ name: "Word 文档", extensions: ["docx"] }]
  };
  const result = parentWindow
    ? await dialog.showSaveDialog(parentWindow, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) {
    return { canceled: true, filePath: "" };
  }

  const buffer = await createKnowledgeDocumentDocxBuffer({ title, snapshot });
  await fs.writeFile(result.filePath, buffer);
  return { canceled: false, filePath: result.filePath };
}

export async function createKnowledgeDocumentDocxBuffer(input: unknown): Promise<Buffer> {
  const request = isRecord(input) ? input as KnowledgeDocumentDocxExportRequest : {};
  const title = normalizeDocxTitle(request.title);
  const snapshot = normalizeKnowledgeDocumentSnapshot(request.snapshot);
  const document = createDocxDocument(title, snapshot);
  return Packer.toBuffer(document);
}
