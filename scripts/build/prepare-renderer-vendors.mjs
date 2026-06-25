import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "rolldown";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourceInput = path.join(rootDir, "node_modules", "@hufe921", "canvas-editor", "dist", "canvas-editor.js");
const tempDir = path.join(rootDir, ".codex-tmp", "vendor");
const patchedInput = path.join(tempDir, "canvas-editor.aistudy.js");
const outputDir = path.join(rootDir, "dist", "vendor");
const outputFile = path.join(outputDir, "canvas-editor.js");

await mkdir(outputDir, { recursive: true });
await mkdir(tempDir, { recursive: true });

const canvasEditorSource = await readFile(sourceInput, "utf8");
const fastSelectionNeedle = `\tn.render({
\t\tisSubmitHistory: !1,
\t\tisSetCursor: !1,
\t\tisCompute: !1
\t});`;
const fastSelectionPatch = `\tif (n.getOptions().aistudyFastSelection) {
\t\tn.getPageContainer().dispatchEvent(new CustomEvent("aistudy:selection-range-change", { bubbles: true }));
\t\treturn;
\t}
${fastSelectionNeedle}`;
if (!canvasEditorSource.includes(fastSelectionNeedle)) {
  throw new Error("canvas-editor fast selection patch point was not found");
}
await writeFile(patchedInput, canvasEditorSource.replace(fastSelectionNeedle, fastSelectionPatch));

await build({
  input: patchedInput,
  output: {
    file: outputFile,
    format: "esm",
    minify: true,
    comments: false
  }
});

const vendorSource = await readFile(outputFile, "utf8");
if (!vendorSource.includes("aistudy:selection-range-change")) {
  throw new Error("canvas-editor fast selection patch was not emitted");
}
const listColorNeedle = "e.save(),e.font=this.getListFontStyle(r,u),e.fillText(t,p,m),e.restore()";
const listColorPatch =
  "e.save(),e.font=this.getListFontStyle(r,u),e.fillStyle=this.findStyledElement(r).color||this.options.defaultColor,e.fillText(t,p,m),e.restore()";
if (!vendorSource.includes(listColorNeedle)) {
  throw new Error("canvas-editor list color patch point was not found");
}
await writeFile(outputFile, vendorSource.replace(listColorNeedle, listColorPatch));

const { size } = await stat(outputFile);
console.log(`renderer vendor: canvas-editor ${(size / 1024).toFixed(1)} KB`);
