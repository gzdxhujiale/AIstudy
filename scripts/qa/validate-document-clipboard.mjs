import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const mathSourcePath = path.join(projectRoot, "src/renderer/features/mathInput/mathClipboard.ts");
const documentSourcePath = path.join(projectRoot, "src/renderer/features/mathInput/documentClipboard.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function transpileSource(sourcePath) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing clipboard module: ${path.relative(projectRoot, sourcePath)}`);
  }
  return ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true
    },
    fileName: sourcePath
  }).outputText;
}

const tempRoot = process.env.TMP || process.env.TEMP || os.tmpdir();
const tempDir = path.join(tempRoot, "aistudy-document-clipboard-qa");
fs.mkdirSync(tempDir, { recursive: true });

fs.writeFileSync(path.join(tempDir, "mathClipboard.mjs"), transpileSource(mathSourcePath), "utf8");
fs.writeFileSync(
  path.join(tempDir, "documentClipboard.mjs"),
  transpileSource(documentSourcePath).replace('from "./mathClipboard"', 'from "./mathClipboard.mjs"'),
  "utf8"
);

const mathClipboard = await import(pathToFileURL(path.join(tempDir, "mathClipboard.mjs")).href);
const documentClipboard = await import(pathToFileURL(path.join(tempDir, "documentClipboard.mjs")).href);

function flatten(elements) {
  return elements.map((element) => element.value).join("");
}

function hasTyped(elements, value, type) {
  return elements.some((element) => element.value === value && element.type === type);
}

const chatGptMathNote = [
  "### 三、初等函数体系（你笔记第二块）",
  "",
  "1. 幂函数",
  "",
  "y = x^a",
  "",
  "补充:",
  "",
  "• a>0: 定义在 x>0 或全体（整数情况）",
  "• a<0: 需要 x≠0",
  "",
  "---",
  "",
  "2. 指数函数",
  "",
  "y = a^x \\quad (a>0, a\\ne1)",
  "",
  "性质补充:",
  "",
  "• 单调性由 a 决定",
  "• a>1: 增函数",
  "• 0<a<1: 减函数",
  "",
  "3. 对数函数",
  "",
  "y = \\log_a x"
].join("\n");

const blocks = documentClipboard.parsePlainTextDocumentBlocks(chatGptMathNote);
assert(blocks.length >= 12, "ChatGPT math note should parse into multiple semantic blocks");
assert(blocks.some((block) => block.kind === "heading" && flatten(block.elements).includes("初等函数体系")), "markdown heading should become a heading block");
assert(blocks.some((block) => block.kind === "heading" && flatten(block.elements).includes("1. 幂函数")), "numbered Chinese section title should become a heading block");
assert(blocks.some((block) => block.kind === "separator"), "markdown horizontal rule should become a separator block");

const listBlocks = blocks.filter((block) => block.kind === "listItem");
assert(listBlocks.length >= 5, "bullet items should stay list items");
assert(listBlocks.every((block) => block.listType === "ul"), "bullet items should be unordered list items");

const formulaBlocks = blocks.filter((block) => block.kind === "paragraph" && block.align === "center");
const mathBlocks = blocks.filter((block) => block.kind === "math");
assert(mathBlocks.length >= 3, "standalone formula lines should become native math blocks");
assert(formulaBlocks.length === 0, "standalone formula lines should not fall back to centered plain paragraphs");
const latexText = mathBlocks.map((block) => block.latex).join("\n");
assert(latexText.includes("x^{a}") || latexText.includes("x^a"), "power formula should be preserved as latex");
assert(latexText.includes("a^{x}") || latexText.includes("a^x"), "exponential formula should be preserved as latex");
assert(latexText.includes("log_{a}") || latexText.includes("\\log_a"), "log formula should preserve subscript structure");
assert(latexText.includes("\\quad") || !latexText.includes("quad"), "TeX spacing should stay inside a native latex block");
assert(latexText.includes("a>0") && (latexText.includes("a\\ne1") || latexText.includes("a≠1")), "formula conditions should preserve comparison symbols");

const inlineMathBlocks = documentClipboard.parsePlainTextDocumentBlocks([
  "偶函数",
  "如果:",
  "f(-x)=f(x)",
  "例如:",
  "f(x)=x²",
  "因为:",
  "$$",
  "f(-x)=(-x)^2=x^2=f(x)",
  "$$"
].join("\n"));
const inlineMathLatex = inlineMathBlocks.filter((block) => block.kind === "math").map((block) => block.latex).join("\n");
assert(inlineMathBlocks.some((block) => block.kind === "heading" && flatten(block.elements).includes("偶函数")), "short Chinese math title should stay a heading");
assert(inlineMathLatex.includes("f(-x)=f(x)"), "even function identity should become a math block");
assert(inlineMathLatex.includes("x^{2}") || inlineMathLatex.includes("x^2"), "unicode superscript should normalize into latex exponent");
assert(inlineMathLatex.includes("(-x)^2") || inlineMathLatex.includes("(-x)^{2}"), "fenced formula should stay a math block");

const normalized = mathClipboard.normalizeMathText("y = a^x \\quad (a>0, a\\ne1)");
assert(!normalized.includes("quad") && normalized.includes("a≠1"), "math normalization should remove quad and normalize ne");

console.log("document clipboard regression policy: ok");
