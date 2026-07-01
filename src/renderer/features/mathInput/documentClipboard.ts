import {
  type MathInlineElement,
  normalizeMathText,
  parseDomMathElements,
  parseMathInlineElements
} from "./mathClipboard";

export type ClipboardDocumentBlock =
  | {
      kind: "paragraph";
      elements: MathInlineElement[];
      align?: "center";
    }
  | {
      kind: "heading";
      level: 1 | 2 | 3 | 4 | 5 | 6;
      elements: MathInlineElement[];
    }
  | {
      kind: "listItem";
      listType: "ul" | "ol";
      elements: MathInlineElement[];
    }
  | {
      kind: "separator";
    }
  | {
      kind: "math";
      latex: string;
    };

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "dl",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul"
]);
const IGNORED_TAGS = new Set(["button", "canvas", "noscript", "script", "style", "svg", "template"]);
const MARKDOWN_HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
const BULLET_PATTERN = /^\s*(?:[-*+•·])\s+(.+)$/;
const ORDERED_PATTERN = /^\s*(\d+)[\.．、)\）]\s+(.+)$/;
const CHINESE_HEADING_PATTERN = /^\s*[一二三四五六七八九十]+[、.．]\s*(.{2,48})$/;
const HORIZONTAL_RULE_PATTERN = /^\s*(?:-{3,}|_{3,}|={3,}|—{3,})\s*$/;
const CHINESE_TEXT_PATTERN = /[\u3400-\u9fff]/u;
const MATH_LINE_SIGNAL_PATTERN = /(?:\\[A-Za-z]+|[_^]|[=<>]|[→↦←⇒⇔⊂⊆∈∉ℝℕℤℚ∞≠≤≥≈√∪∩∀∃πθαγβΔλ])/u;
const DOCUMENT_HTML_SIGNAL_PATTERN = /(?:data-message-author-role|class=["'][^"']*(?:markdown|katex|math)[^"']*["']|<(?:h[1-6]|ol|ul|li|hr|math|sup|sub)\b|application\/x-tex)/i;

function appendInline(elements: MathInlineElement[], element: MathInlineElement) {
  if (!element.value) return;
  const normalizedType = element.type && element.type !== "text" ? element.type : undefined;
  const last = elements[elements.length - 1];
  if (last && (last.type ?? undefined) === normalizedType) {
    last.value += element.value;
    return;
  }
  elements.push({ value: element.value, ...(normalizedType ? { type: normalizedType } : {}) });
}

function appendInlineList(elements: MathInlineElement[], next: MathInlineElement[]) {
  for (const element of next) {
    appendInline(elements, element);
  }
}

function trimInlineElements(elements: MathInlineElement[]) {
  const compacted = elements.filter((element) => element.value.length > 0).map((element) => ({ ...element }));
  while (compacted.length > 0 && compacted[0].value.trim().length === 0) compacted.shift();
  while (compacted.length > 0 && compacted[compacted.length - 1].value.trim().length === 0) compacted.pop();
  if (compacted.length === 0) return [];

  compacted[0].value = compacted[0].value.replace(/^\s+/, "");
  const last = compacted[compacted.length - 1];
  last.value = last.value.replace(/\s+$/, "");
  return compacted.filter((element) => element.value.length > 0);
}

function normalizeInlineText(value: string) {
  return value.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").replace(/[ \t\f\v]+/g, " ");
}

function parseInlineText(value: string) {
  return parseMathInlineElements(normalizeInlineText(value));
}

function getTagName(node: Element) {
  return node.tagName.toLowerCase();
}

function shouldIgnoreElement(node: Element) {
  const tagName = getTagName(node);
  if (IGNORED_TAGS.has(tagName)) return true;
  if (node.getAttribute("aria-hidden") === "true") return true;
  const style = node.getAttribute("style") ?? "";
  return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style);
}

function isDisplayMathElement(node: Element) {
  const tagName = getTagName(node);
  if (node.classList.contains("katex-display")) return true;
  if (node.classList.contains("math-display")) return true;
  return tagName === "math" && node.getAttribute("display") === "block";
}

function stripMathDelimiters(value: string) {
  return value
    .trim()
    .replace(/^\s*(?:\$\$|\\\[|\\\()\s*/u, "")
    .replace(/\s*(?:\$\$|\\\]|\\\))\s*$/u, "")
    .trim();
}

function latexEscapeText(value: string) {
  return value
    .replace(/\\/g, "")
    .replace(/([#$%&])/g, "\\$1")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/ℝ/g, "\\mathbb{R}")
    .replace(/ℕ/g, "\\mathbb{N}")
    .replace(/ℤ/g, "\\mathbb{Z}")
    .replace(/ℚ/g, "\\mathbb{Q}")
    .replace(/→/g, "\\to ")
    .replace(/↦/g, "\\mapsto ")
    .replace(/⊆/g, "\\subseteq ")
    .replace(/⊂/g, "\\subset ")
    .replace(/∉/g, "\\notin ")
    .replace(/∈/g, "\\in ")
    .replace(/∞/g, "\\infty ")
    .replace(/≠/g, "\\ne ")
    .replace(/≥/g, "\\ge ")
    .replace(/≤/g, "\\le ")
    .replace(/√/g, "\\sqrt{}");
}

function inlineElementsToLatex(elements: MathInlineElement[]) {
  return elements.map((element) => {
    const value = latexEscapeText(element.value);
    if (element.type === "superscript") return `^{${value}}`;
    if (element.type === "subscript") return `_{${value}}`;
    return value;
  }).join("");
}

export function normalizeDisplayMathLatex(value: string) {
  const stripped = stripMathDelimiters(value).replace(/\r\n?/g, "\n").trim();
  if (!stripped) return "";
  if (/\\[A-Za-z]+/u.test(stripped)) return stripped.replace(/\u2212/g, "-");
  return inlineElementsToLatex(parseMathInlineElements(stripped));
}

function readLatexAnnotation(node: Element) {
  const annotation = node.matches('annotation[encoding="application/x-tex"]')
    ? node
    : node.querySelector('annotation[encoding="application/x-tex"]');
  return annotation?.textContent?.trim() ?? "";
}

function readDataLatex(node: Element) {
  return node.getAttribute("data-latex")
    || node.getAttribute("data-tex")
    || node.getAttribute("data-math")
    || "";
}

function readScriptLatex(node: Element) {
  const script = node.matches('script[type^="math/tex"]')
    ? node
    : node.querySelector('script[type^="math/tex"]');
  return script?.textContent?.trim() ?? "";
}

function extractLatexFromElement(node: Element) {
  return normalizeDisplayMathLatex(
    readLatexAnnotation(node)
      || readDataLatex(node)
      || readScriptLatex(node)
  );
}

function hasBlockChild(node: Element) {
  return Array.from(node.children).some((child) => BLOCK_TAGS.has(getTagName(child)));
}

function parseInlineNode(node: Node | undefined): MathInlineElement[] {
  if (!node) return [];
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.textContent ?? "";
    return value ? parseInlineText(value) : [];
  }
  if (!(node instanceof Element) || shouldIgnoreElement(node)) return [];

  const tagName = getTagName(node);
  if (tagName === "br") return [{ value: "\n" }];
  if (tagName === "ol" || tagName === "ul") return [];
  if (tagName === "math" || tagName === "sup" || tagName === "sub" || node.classList.contains("katex")) {
    return parseDomMathElements(node);
  }

  const elements: MathInlineElement[] = [];
  for (const child of Array.from(node.childNodes)) {
    appendInlineList(elements, parseInlineNode(child));
  }
  return elements;
}

function parseInlineChildren(node: Element) {
  const elements: MathInlineElement[] = [];
  for (const child of Array.from(node.childNodes)) {
    appendInlineList(elements, parseInlineNode(child));
  }
  return trimInlineElements(elements);
}

function createTextBlock(kind: "paragraph" | "heading" | "listItem", elements: MathInlineElement[], extra: Partial<ClipboardDocumentBlock>) {
  const trimmed = trimInlineElements(elements);
  if (trimmed.length === 0) return null;
  return { kind, elements: trimmed, ...extra } as ClipboardDocumentBlock;
}

function parseElementAsBlocks(node: Element, parentListType?: "ul" | "ol"): ClipboardDocumentBlock[] {
  if (shouldIgnoreElement(node)) return [];

  const tagName = getTagName(node);
  if (tagName === "hr") return [{ kind: "separator" }];
  if (isDisplayMathElement(node)) {
    const latex = extractLatexFromElement(node);
    if (latex) return [{ kind: "math", latex }];
    const block = createTextBlock("paragraph", parseDomMathElements(node), { align: "center" });
    return block ? [block] : [];
  }
  if (/^h[1-6]$/.test(tagName)) {
    const level = Math.min(Number(tagName.slice(1)), 6) as 1 | 2 | 3 | 4 | 5 | 6;
    const block = createTextBlock("heading", parseInlineChildren(node), { level });
    return block ? [block] : [];
  }
  if (tagName === "ol" || tagName === "ul") {
    const listType = tagName === "ol" ? "ol" : "ul";
    return Array.from(node.children).flatMap((child) => parseElementAsBlocks(child, listType));
  }
  if (tagName === "li") {
    const block = createTextBlock("listItem", parseInlineChildren(node), { listType: parentListType ?? "ul" });
    const nested = Array.from(node.children)
      .filter((child) => getTagName(child) === "ol" || getTagName(child) === "ul")
      .flatMap((child) => parseElementAsBlocks(child));
    return block ? [block, ...nested] : nested;
  }
  if (hasBlockChild(node)) {
    return Array.from(node.childNodes).flatMap((child) => parseNodeAsBlocks(child, parentListType));
  }

  const block = createTextBlock("paragraph", parseInlineChildren(node), {});
  return block ? [block] : [];
}

function parseTextNodeAsBlocks(node: Text): ClipboardDocumentBlock[] {
  const text = node.textContent ?? "";
  if (!text.trim()) return [];
  return parsePlainTextDocumentBlocks(text);
}

function parseNodeAsBlocks(node: Node, parentListType?: "ul" | "ol"): ClipboardDocumentBlock[] {
  if (node.nodeType === Node.TEXT_NODE) return parseTextNodeAsBlocks(node as Text);
  if (!(node instanceof Element)) return [];
  return parseElementAsBlocks(node, parentListType);
}

function htmlHasDocumentSignal(html: string, text: string) {
  return DOCUMENT_HTML_SIGNAL_PATTERN.test(html) || plainTextHasDocumentSignal(text);
}

function normalizeBlocks(blocks: ClipboardDocumentBlock[]) {
  const normalized: ClipboardDocumentBlock[] = [];
  for (const block of blocks) {
    if (block.kind === "separator" || block.kind === "math") {
      const previous = normalized[normalized.length - 1];
      if (block.kind === "separator" && previous?.kind === "separator") continue;
      if (block.kind === "math" && block.latex.trim()) normalized.push({ ...block, latex: normalizeDisplayMathLatex(block.latex) });
      if (block.kind === "separator") normalized.push(block);
      continue;
    }

    const elements = trimInlineElements(block.elements);
    if (elements.length === 0) continue;
    normalized.push({ ...block, elements } as ClipboardDocumentBlock);
  }
  return normalized;
}

function parseHtmlDocumentBlocks(html: string) {
  if (typeof DOMParser === "undefined") return [];
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const root =
    parsed.body.querySelector('[data-message-author-role="assistant"] .markdown')
    ?? parsed.body.querySelector(".markdown")
    ?? parsed.body;
  return normalizeBlocks(Array.from(root.childNodes).flatMap((child) => parseNodeAsBlocks(child)));
}

function lineHasMathSignal(line: string) {
  const normalized = normalizeMathText(line);
  return normalized !== line || MATH_LINE_SIGNAL_PATTERN.test(normalized);
}

function isDisplayMathLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || CHINESE_TEXT_PATTERN.test(trimmed)) return false;
  if (!lineHasMathSignal(trimmed)) return false;
  return /^[A-Za-z0-9\\_^\-+=*/<>()\[\]{}.,，;:|'"’\sℝℕℤℚ∞≠≤≥≈√∪∩∀∃πθαγβΔλ→↦←⇒⇔⊂⊆∈∉]+$/u.test(trimmed);
}

function isLikelySectionHeading(value: string) {
  const trimmed = value.trim();
  if (trimmed.length > 54) return false;
  if (/[。！？!?；;：:]$/.test(trimmed)) return false;
  const ordered = trimmed.match(ORDERED_PATTERN);
  if (ordered) return CHINESE_TEXT_PATTERN.test(ordered[2]);
  return CHINESE_HEADING_PATTERN.test(trimmed);
}

function isLikelyMathTopicHeading(value: string) {
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 18) return false;
  if (!CHINESE_TEXT_PATTERN.test(trimmed)) return false;
  if (/[，,。.!！？?：:；;]/u.test(trimmed)) return false;
  return /(?:函数|数列|极限|导数|微分|积分|矩阵|向量|行列式|概率|分布|统计|方程|不等式|定理|定义|性质|公式|图像|图象|曲线|级数|特征值|特征向量)/u.test(trimmed);
}

function plainTextHasDocumentSignal(text: string) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  return lines.some((line) => {
    return MARKDOWN_HEADING_PATTERN.test(line)
      || BULLET_PATTERN.test(line)
      || ORDERED_PATTERN.test(line)
      || HORIZONTAL_RULE_PATTERN.test(line)
      || isDisplayMathLine(line)
      || lineHasMathSignal(line);
  });
}

export function parsePlainTextDocumentBlocks(text: string): ClipboardDocumentBlock[] {
  const blocks: ClipboardDocumentBlock[] = [];
  let mathFence: { end: RegExp; lines: string[] } | null = null;
  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (mathFence) {
      if (mathFence.end.test(line)) {
        const latex = normalizeDisplayMathLatex(mathFence.lines.join("\n"));
        if (latex) blocks.push({ kind: "math", latex });
        mathFence = null;
      } else {
        mathFence.lines.push(line);
      }
      continue;
    }
    if (!line) continue;
    if (/^\\\[\s*$/u.test(line)) {
      mathFence = { end: /^\\\]\s*$/u, lines: [] };
      continue;
    }
    if (/^\$\$\s*$/u.test(line)) {
      mathFence = { end: /^\$\$\s*$/u, lines: [] };
      continue;
    }
    const inlineFence = line.match(/^(?:\$\$|\\\[)\s*([\s\S]+?)\s*(?:\$\$|\\\])$/u);
    if (inlineFence) {
      const latex = normalizeDisplayMathLatex(inlineFence[1]);
      if (latex) blocks.push({ kind: "math", latex });
      continue;
    }
    if (HORIZONTAL_RULE_PATTERN.test(line)) {
      blocks.push({ kind: "separator" });
      continue;
    }

    const markdownHeading = line.match(MARKDOWN_HEADING_PATTERN);
    if (markdownHeading) {
      blocks.push({
        kind: "heading",
        level: Math.min(markdownHeading[1].length, 6) as 1 | 2 | 3 | 4 | 5 | 6,
        elements: parseMathInlineElements(markdownHeading[2])
      });
      continue;
    }

    const bullet = line.match(BULLET_PATTERN);
    if (bullet) {
      blocks.push({ kind: "listItem", listType: "ul", elements: parseMathInlineElements(bullet[1]) });
      continue;
    }

    const ordered = line.match(ORDERED_PATTERN);
    if (ordered && !isLikelySectionHeading(line)) {
      blocks.push({ kind: "listItem", listType: "ol", elements: parseMathInlineElements(ordered[2]) });
      continue;
    }

    if (isLikelySectionHeading(line)) {
      blocks.push({ kind: "heading", level: 3, elements: parseMathInlineElements(line) });
      continue;
    }

    if (isLikelyMathTopicHeading(line)) {
      blocks.push({ kind: "heading", level: 3, elements: parseMathInlineElements(line) });
      continue;
    }

    if (isDisplayMathLine(line)) {
      const latex = normalizeDisplayMathLatex(line);
      blocks.push(latex
        ? { kind: "math", latex }
        : { kind: "paragraph", align: "center", elements: parseMathInlineElements(line) }
      );
      continue;
    }

    blocks.push({
      kind: "paragraph",
      elements: parseMathInlineElements(line)
    });
  }
  if (mathFence) {
    const latex = normalizeDisplayMathLatex(mathFence.lines.join("\n"));
    if (latex) blocks.push({ kind: "math", latex });
  }
  return normalizeBlocks(blocks);
}

export function parseClipboardDocumentBlocks(data: DataTransfer | null): ClipboardDocumentBlock[] | null {
  if (!data) return null;

  const html = data.getData("text/html");
  const text = data.getData("text/plain");
  if (html && htmlHasDocumentSignal(html, text)) {
    const blocks = parseHtmlDocumentBlocks(html);
    if (blocks.length > 0) return blocks;
  }

  if (!text || !plainTextHasDocumentSignal(text)) return null;
  const blocks = parsePlainTextDocumentBlocks(text);
  return blocks.length > 0 ? blocks : null;
}
