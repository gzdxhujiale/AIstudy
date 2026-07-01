import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const snapshotSourcePath = path.join(projectRoot, "src/renderer/features/mindmap/mindMapSnapshot.ts");
const coreContractSourcePath = path.join(projectRoot, "src/renderer/domain/coreContracts.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function transpileTypeScript(sourcePath) {
  const source = fs.readFileSync(sourcePath, "utf8");
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true
    },
    fileName: sourcePath
  }).outputText;
}

function flattenOutlineTitles(items) {
  const titles = [];
  const stack = [...items];
  while (stack.length > 0) {
    const item = stack.shift();
    if (!item) continue;
    titles.push(item.title);
    stack.unshift(...item.children);
  }
  return titles;
}

if (!fs.existsSync(snapshotSourcePath)) {
  throw new Error("Missing mind map snapshot module.");
}
if (!fs.existsSync(coreContractSourcePath)) {
  throw new Error("Missing core contract module.");
}

const tempRoot = process.env.TMP || process.env.TEMP || os.tmpdir();
const tempDir = path.join(tempRoot, "aistudy-mindmap-catalog-boundary-qa");
fs.mkdirSync(tempDir, { recursive: true });

const coreContractModulePath = path.join(tempDir, "coreContracts.mjs");
const snapshotModulePath = path.join(tempDir, "mindMapSnapshot.mjs");

fs.writeFileSync(coreContractModulePath, transpileTypeScript(coreContractSourcePath), "utf8");
fs.writeFileSync(
  snapshotModulePath,
  transpileTypeScript(snapshotSourcePath).replace(
    /from\s+["']\.\.\/\.\.\/domain\/coreContracts["'];/g,
    'from "./coreContracts.mjs";'
  ),
  "utf8"
);

const {
  MIND_MAP_CATALOG_BOUNDARY_KEY,
  buildMindMapOutline,
  countNodes,
  normalizeMindMapTree
} = await import(`${pathToFileURL(snapshotModulePath).href}?qa=${Date.now()}`);

const root = normalizeMindMapTree({
  data: { uid: "root", text: "数学", expand: true },
  children: [
    {
      data: { uid: "chapter", text: "函数", expand: true },
      children: [
        {
          data: {
            uid: "feature",
            text: "特性",
            expand: true,
            [MIND_MAP_CATALOG_BOUNDARY_KEY]: true
          },
          children: [
            { data: { uid: "bounded", text: "有界性", expand: true }, children: [] },
            { data: { uid: "monotone", text: "单调性", expand: true }, children: [] }
          ]
        },
        {
          data: {
            uid: "leaf-boundary",
            text: "函数类型",
            expand: true,
            [MIND_MAP_CATALOG_BOUNDARY_KEY]: true
          },
          children: []
        }
      ]
    }
  ]
});

assert(root.children[0].children[0].data[MIND_MAP_CATALOG_BOUNDARY_KEY] === true, "catalog boundary flag should survive normalization");
assert(countNodes(root) === 6, "catalog boundary must not remove real mind map nodes");

const outline = buildMindMapOutline(root);
const rootItem = outline[0];
const chapterItem = rootItem.children[0];
const featureItem = chapterItem.children[0];
const leafBoundaryItem = chapterItem.children[1];
const titles = flattenOutlineTitles(outline);

assert(rootItem.title === "数学", "root should remain in catalog");
assert(chapterItem.title === "函数", "parent should remain in catalog");
assert(featureItem.title === "特性", "boundary node should remain in catalog");
assert(featureItem.catalogBoundary === true, "boundary outline item should expose catalogBoundary=true");
assert(featureItem.childCount === 0, "visible childCount should stop at boundary");
assert(featureItem.hiddenChildCount === 2, "hiddenChildCount should report suppressed children");
assert(featureItem.children.length === 0, "boundary node should not expose descendants in catalog");
assert(leafBoundaryItem.catalogBoundary === true, "leaf nodes can be prepared as future catalog boundaries");
assert(leafBoundaryItem.hiddenChildCount === 0, "empty boundary nodes should not invent hidden children");
assert(!titles.includes("有界性") && !titles.includes("单调性"), "boundary descendants should not appear in catalog");
assert(titles.includes("函数类型"), "sibling boundary node should remain selectable");

console.log("mind map catalog boundary policy: ok");
