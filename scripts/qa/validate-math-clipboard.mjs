import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "src/renderer/features/mathInput/mathClipboard.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

if (!fs.existsSync(sourcePath)) {
  throw new Error("Missing math clipboard module: src/renderer/features/mathInput/mathClipboard.ts");
}

const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
    strict: true
  },
  fileName: sourcePath
});

const tempRoot = process.env.TMP || process.env.TEMP || os.tmpdir();
const tempDir = path.join(tempRoot, "aistudy-math-clipboard-qa");
fs.mkdirSync(tempDir, { recursive: true });
const modulePath = path.join(tempDir, "mathClipboard.mjs");
fs.writeFileSync(modulePath, transpiled.outputText, "utf8");

const mathClipboard = await import(pathToFileURL(modulePath).href);

function flatten(elements) {
  return elements.map((element) => element.value).join("");
}

function hasTyped(elements, value, type) {
  return elements.some((element) => element.value === value && element.type === type);
}

const chatGptPlainText = [
  "假设",
  "f:Xarrow Y",
  "其中：",
  "X：定义域（所有允许输入的数）",
  "Y：陪域（目标集合）",
  "R_f subset Y",
  "例如： f(x)=x^2, X=\\mathbb{R}, Y=\\mathbb{R}",
  "因此 R_f = [0,+\\infty)"
].join("\n");

const normalized = mathClipboard.normalizeMathText(chatGptPlainText);
assert(normalized.includes("f:X → Y"), "degraded ChatGPT arrow text should normalize to →");
assert(normalized.includes("R_f ⊂ Y"), "plain subset token should normalize to ⊂");
assert(normalized.includes("X=ℝ") && normalized.includes("Y=ℝ"), "mathbb R should normalize to ℝ");
assert(normalized.includes("[0,+∞)"), "infinity token should normalize to ∞");

const elements = mathClipboard.parseMathInlineElements(chatGptPlainText);
const flattened = flatten(elements);
assert(flattened.includes("f:X → Y"), "parsed elements should preserve normalized arrow");
assert(flattened.includes("R") && flattened.includes(" ⊂ Y"), "parsed elements should preserve subset relationship");
assert(flattened.includes("x2"), "parsed elements should keep x^2 value text");
assert(hasTyped(elements, "f", "subscript"), "R_f should produce a subscript element");
assert(hasTyped(elements, "2", "superscript"), "x^2 should produce a superscript element");

const texElements = mathClipboard.parseMathInlineElements("D_f = \\{x \\mid x \\ne 0\\}");
assert(flatten(texElements).includes("D") && flatten(texElements).includes(" | x ≠ 0"), "TeX set notation should normalize common symbols");
assert(hasTyped(texElements, "f", "subscript"), "D_f should produce a subscript element");

console.log("math clipboard regression policy: ok");
