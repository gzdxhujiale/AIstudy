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
assert(formulaBlocks.length >= 3, "standalone formula lines should become centered paragraphs");
const formulaText = formulaBlocks.map((block) => flatten(block.elements)).join("\n");
assert(!formulaText.includes("quad"), "TeX spacing command must not leak as literal quad");
assert(formulaText.includes("a>0") && formulaText.includes("a≠1"), "formula conditions should preserve comparison symbols");

const formulaElements = formulaBlocks.flatMap((block) => block.elements);
assert(hasTyped(formulaElements, "a", "superscript"), "x^a should preserve superscript structure");
assert(hasTyped(formulaElements, "x", "superscript"), "a^x should preserve superscript structure");
assert(hasTyped(formulaElements, "a", "subscript"), "log_a should preserve subscript structure");

const normalized = mathClipboard.normalizeMathText("y = a^x \\quad (a>0, a\\ne1)");
assert(!normalized.includes("quad") && normalized.includes("a≠1"), "math normalization should remove quad and normalize ne");

console.log("document clipboard regression policy: ok");
