export type MathInlineElement = {
  value: string;
  type?: "text" | "superscript" | "subscript";
};

type ScriptType = "superscript" | "subscript";

const MATH_SYMBOL_PATTERN = /[→↦←⇒⇔⊂⊆∈∉ℝℕℤℚ∞≠≤≥≈√∪∩∀∃πθαγβΔλ]/;
const SCRIPT_SIGNAL_PATTERN = /[A-Za-z0-9)\]}ℝℕℤℚα-ωΑ-Ω][_^](?:\{[^{}\n]{1,24}\}|[-+]?\d{1,4}|[A-Za-zα-ωΑ-Ω])/u;
const UNICODE_SUPERSCRIPT: Record<string, string> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁺": "+",
  "⁻": "-",
  "⁼": "=",
  "⁽": "(",
  "⁾": ")",
  "ⁿ": "n",
  "ⁱ": "i"
};
const UNICODE_SUBSCRIPT: Record<string, string> = {
  "₀": "0",
  "₁": "1",
  "₂": "2",
  "₃": "3",
  "₄": "4",
  "₅": "5",
  "₆": "6",
  "₇": "7",
  "₈": "8",
  "₉": "9",
  "₊": "+",
  "₋": "-",
  "₌": "=",
  "₍": "(",
  "₎": ")",
  "ₐ": "a",
  "ₑ": "e",
  "ₕ": "h",
  "ᵢ": "i",
  "ⱼ": "j",
  "ₖ": "k",
  "ₗ": "l",
  "ₘ": "m",
  "ₙ": "n",
  "ₒ": "o",
  "ₚ": "p",
  "ᵣ": "r",
  "ₛ": "s",
  "ₜ": "t",
  "ᵤ": "u",
  "ᵥ": "v",
  "ₓ": "x"
};

function appendElement(elements: MathInlineElement[], value: string, type?: ScriptType) {
  if (!value) return;
  const last = elements[elements.length - 1];
  const normalizedType = type ?? undefined;
  if (last && (last.type ?? undefined) === normalizedType) {
    last.value += value;
    return;
  }
  elements.push({ value, ...(normalizedType ? { type: normalizedType } : {}) });
}

function appendTextWithUnicodeScripts(elements: MathInlineElement[], value: string, inheritedType?: ScriptType) {
  if (!value) return;
  if (inheritedType) {
    appendElement(elements, value, inheritedType);
    return;
  }

  let textBuffer = "";
  let scriptBuffer = "";
  let scriptType: ScriptType | null = null;

  const flushScript = () => {
    if (!scriptBuffer || !scriptType) return;
    appendElement(elements, scriptBuffer, scriptType);
    scriptBuffer = "";
    scriptType = null;
  };
  const flushText = () => {
    if (!textBuffer) return;
    appendElement(elements, textBuffer);
    textBuffer = "";
  };

  for (const char of value) {
    const sup = UNICODE_SUPERSCRIPT[char];
    const sub = UNICODE_SUBSCRIPT[char];
    const nextType: ScriptType | null = sup ? "superscript" : sub ? "subscript" : null;
    const nextValue = sup ?? sub;
    if (!nextType || !nextValue) {
      flushScript();
      textBuffer += char;
      continue;
    }
    flushText();
    if (scriptType && scriptType !== nextType) flushScript();
    scriptType = nextType;
    scriptBuffer += nextValue;
  }

  flushScript();
  flushText();
}

export function normalizeMathText(value: string) {
  let text = value
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\u2212/g, "-")
    .replace(/\\qquad(?![A-Za-z])|\\quad(?![A-Za-z])/g, " ")
    .replace(/\\left|\\right/g, "")
    .replace(/\\\{/g, "{")
    .replace(/\\\}/g, "}")
    .replace(/\\mid\b/g, "|")
    .replace(/\\mathbb\s*\{\s*R\s*\}/gi, "ℝ")
    .replace(/\\mathbb\s*\{\s*N\s*\}/gi, "ℕ")
    .replace(/\\mathbb\s*\{\s*Z\s*\}/gi, "ℤ")
    .replace(/\\mathbb\s*\{\s*Q\s*\}/gi, "ℚ")
    .replace(/\\notin(?![A-Za-z])/g, "∉")
    .replace(/\\subseteq(?![A-Za-z])/g, "⊆")
    .replace(/\\subset(?![A-Za-z])/g, "⊂")
    .replace(/\\neq(?![A-Za-z])|\\ne(?![A-Za-z])/g, "≠")
    .replace(/\\geq(?![A-Za-z])|\\ge(?![A-Za-z])/g, "≥")
    .replace(/\\leq(?![A-Za-z])|\\le(?![A-Za-z])/g, "≤")
    .replace(/\\infty(?![A-Za-z])/g, "∞")
    .replace(/\\mapsto(?![A-Za-z])/g, "↦")
    .replace(/\\longrightarrow(?![A-Za-z])|\\rightarrow(?![A-Za-z])|\\to(?![A-Za-z])/g, "→")
    .replace(/\\leftarrow(?![A-Za-z])/g, "←")
    .replace(/\\Rightarrow(?![A-Za-z])|\\implies(?![A-Za-z])/g, "⇒")
    .replace(/\\Leftrightarrow(?![A-Za-z])|\\iff(?![A-Za-z])/g, "⇔")
    .replace(/\\in(?![A-Za-z])/g, "∈")
    .replace(/\\cup(?![A-Za-z])/g, "∪")
    .replace(/\\cap(?![A-Za-z])/g, "∩")
    .replace(/\\forall(?![A-Za-z])/g, "∀")
    .replace(/\\exists(?![A-Za-z])/g, "∃")
    .replace(/\\sqrt\s*\{([^{}\n]+)\}/g, "√$1")
    .replace(/\\pi(?![A-Za-z])/g, "π")
    .replace(/\\theta(?![A-Za-z])/g, "θ")
    .replace(/\\alpha(?![A-Za-z])/g, "α")
    .replace(/\\beta(?![A-Za-z])/g, "β")
    .replace(/\\gamma(?![A-Za-z])/g, "γ")
    .replace(/\\Delta(?![A-Za-z])/g, "Δ")
    .replace(/\\lambda(?![A-Za-z])/g, "λ")
    .replace(/\\R(?![A-Za-z])/g, "ℝ")
    .replace(/\\N(?![A-Za-z])/g, "ℕ")
    .replace(/\\Z(?![A-Za-z])/g, "ℤ")
    .replace(/\\Q(?![A-Za-z])/g, "ℚ")
    .replace(/\\[,;! ]/g, " ");

  text = text
    .replace(/\bmathbb\s*\{\s*R\s*\}/gi, "ℝ")
    .replace(/\bmathbb\s*\{\s*N\s*\}/gi, "ℕ")
    .replace(/\bmathbb\s*\{\s*Z\s*\}/gi, "ℤ")
    .replace(/\bmathbb\s*\{\s*Q\s*\}/gi, "ℚ")
    .replace(/\brightarrow\b/g, "→")
    .replace(/\blongrightarrow\b/g, "→")
    .replace(/\bmapsto\b/g, "↦")
    .replace(/\bleftarrow\b/g, "←")
    .replace(/\bsubseteq\b/g, "⊆")
    .replace(/\bsubset\b/g, "⊂")
    .replace(/\bnotin\b/g, "∉")
    .replace(/\binfty\b/g, "∞")
    .replace(/\bneq\b|\bne\b/g, "≠")
    .replace(/\bgeq\b/g, "≥")
    .replace(/\bleq\b/g, "≤")
    .replace(/\bq?quad\b/g, " ");

  const mathToken = String.raw`[A-Za-z0-9ℝℕℤℚα-ωΑ-Ω)\]}]`;
  const mathTarget = String.raw`[A-Za-z0-9ℝℕℤℚα-ωΑ-Ω([{]`;
  text = text
    .replace(new RegExp(`(${mathToken})\\s*(?:right)?arrow\\s*(${mathTarget})`, "g"), "$1 → $2")
    .replace(new RegExp(`(${mathToken})\\s*mapsto\\s*(${mathTarget})`, "g"), "$1 ↦ $2")
    .replace(new RegExp(`(${mathToken})\\s*subseteq\\s*(${mathTarget})`, "g"), "$1 ⊆ $2")
    .replace(new RegExp(`(${mathToken})\\s*subset\\s*(${mathTarget})`, "g"), "$1 ⊂ $2");

  return text.replace(/\\/g, "");
}

export function parseMathInlineElements(value: string, inheritedType?: ScriptType): MathInlineElement[] {
  const normalized = normalizeMathText(value);
  if (inheritedType) return [{ value: normalized, type: inheritedType }];

  const elements: MathInlineElement[] = [];
  const pattern = /([A-Za-z0-9ℝℕℤℚα-ωΑ-Ω)\]}])([_^])(\{[^{}\n]{1,24}\}|[-+]?\d{1,4}|[A-Za-zα-ωΑ-Ω])/gu;
  let cursor = 0;
  for (const match of normalized.matchAll(pattern)) {
    const index = match.index ?? 0;
    appendTextWithUnicodeScripts(elements, normalized.slice(cursor, index));
    appendElement(elements, match[1]);
    appendElement(elements, match[3].replace(/^\{|\}$/g, ""), match[2] === "_" ? "subscript" : "superscript");
    cursor = index + match[0].length;
  }
  appendTextWithUnicodeScripts(elements, normalized.slice(cursor));
  return elements.length > 0 ? elements : [{ value: normalized }];
}

function parseMathMlNode(node: Element, inheritedType?: ScriptType): MathInlineElement[] {
  const tagName = node.tagName.toLowerCase();
  if (tagName === "annotation") return [];
  if (tagName === "msub" || tagName === "msup") {
    const children = Array.from(node.children);
    return [
      ...parseDomMathElements(children[0], inheritedType),
      ...parseDomMathElements(children[1], tagName === "msub" ? "subscript" : "superscript")
    ];
  }
  if (tagName === "msubsup") {
    const children = Array.from(node.children);
    return [
      ...parseDomMathElements(children[0], inheritedType),
      ...parseDomMathElements(children[1], "subscript"),
      ...parseDomMathElements(children[2], "superscript")
    ];
  }
  if (tagName === "mfrac") {
    const children = Array.from(node.children);
    return [
      { value: "(" },
      ...parseDomMathElements(children[0], inheritedType),
      { value: ")/(" },
      ...parseDomMathElements(children[1], inheritedType),
      { value: ")" }
    ];
  }
  if (tagName === "msqrt") {
    return [{ value: "√" }, ...Array.from(node.childNodes).flatMap((child) => parseDomMathElements(child, inheritedType))];
  }
  return Array.from(node.childNodes).flatMap((child) => parseDomMathElements(child, inheritedType));
}

export function parseDomMathElements(node: Node | undefined, inheritedType?: ScriptType): MathInlineElement[] {
  if (!node) return [];
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.textContent ?? "";
    return value ? parseMathInlineElements(value, inheritedType) : [];
  }
  if (!(node instanceof Element)) return [];

  const tagName = node.tagName.toLowerCase();
  if (tagName === "script" || tagName === "style") return [];
  if (tagName === "br") return [{ value: "\n" }];

  if (node.classList.contains("katex")) {
    const annotation = node.querySelector('annotation[encoding="application/x-tex"]');
    const latex = annotation?.textContent?.trim();
    if (latex) return parseMathInlineElements(latex);
    const math = node.querySelector("math");
    return math ? parseMathMlNode(math) : [];
  }

  if (tagName === "math") return parseMathMlNode(node);
  if (tagName === "sup") return Array.from(node.childNodes).flatMap((child) => parseDomMathElements(child, "superscript"));
  if (tagName === "sub") return Array.from(node.childNodes).flatMap((child) => parseDomMathElements(child, "subscript"));

  const childElements = Array.from(node.childNodes).flatMap((child) => parseDomMathElements(child, inheritedType));
  if (/^(p|div|li|section|article|h[1-6])$/.test(tagName) && childElements.length > 0) {
    const last = childElements[childElements.length - 1];
    if (!last.value.endsWith("\n")) childElements.push({ value: "\n" });
  }
  return childElements;
}

function clipboardHasMathHtml(html: string) {
  return /<(math|sup|sub)\b/i.test(html)
    || /class=["'][^"']*(?:katex|math)[^"']*["']/i.test(html)
    || /application\/x-tex/i.test(html)
    || /data-math/i.test(html);
}

function hasMathSignal(value: string) {
  const normalized = normalizeMathText(value);
  return normalized !== value
    || MATH_SYMBOL_PATTERN.test(normalized)
    || SCRIPT_SIGNAL_PATTERN.test(value)
    || /\\q?quad(?![A-Za-z])|\bq?quad\b/u.test(value)
    || /[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ]/u.test(value)
    || /[A-Za-z0-9ℝℕℤℚα-ωΑ-Ω)\]}]\s*(?:right)?arrow\s*[A-Za-z0-9ℝℕℤℚα-ωΑ-Ω([{]/u.test(value)
    || /[A-Za-z0-9ℝℕℤℚα-ωΑ-Ω)\]}]\s*(?:subseteq|subset|mapsto)\s*[A-Za-z0-9ℝℕℤℚα-ωΑ-Ω([{]/u.test(value);
}

function elementsHaveMathStructure(elements: MathInlineElement[], originalText: string) {
  if (elements.some((element) => element.type === "superscript" || element.type === "subscript")) return true;
  const joined = elements.map((element) => element.value).join("");
  return joined !== originalText || MATH_SYMBOL_PATTERN.test(joined);
}

export function parseClipboardMathElements(data: DataTransfer | null): MathInlineElement[] | null {
  if (!data) return null;

  const html = data.getData("text/html");
  const text = data.getData("text/plain");
  if (html && (clipboardHasMathHtml(html) || hasMathSignal(text || html))) {
    const document = new DOMParser().parseFromString(html, "text/html");
    const elements = parseDomMathElements(document.body).filter((element) => element.value.length > 0);
    if (elements.length > 0 && (clipboardHasMathHtml(html) || elementsHaveMathStructure(elements, text))) return elements;
  }

  if (!text || !hasMathSignal(text)) return null;
  const elements = parseMathInlineElements(text);
  return elementsHaveMathStructure(elements, text) ? elements : null;
}
