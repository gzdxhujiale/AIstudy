import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const textbookStorePath = path.join(projectRoot, "dist-electron", "textbookStore.js");
const storageBoundaryPath = path.join(projectRoot, "dist-electron", "storageBoundary.js");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function requireBuiltFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing built file: ${path.relative(projectRoot, filePath)}. Run npm run build first.`);
  }
}

requireBuiltFile(textbookStorePath);
requireBuiltFile(storageBoundaryPath);

const textbookStore = await import(pathToFileURL(textbookStorePath).href);
const storageBoundary = await import(pathToFileURL(storageBoundaryPath).href);

const scope = {
  courseId: "course_contract",
  mindMapId: "map_contract",
  textbookId: "asset_contract"
};

const annotation = textbookStore.normalizeTextbookAnnotation({
  id: "annotation_contract",
  textbookId: scope.textbookId,
  courseId: scope.courseId,
  mindMapId: scope.mindMapId,
  nodeId: "node_contract",
  nodeTitle: "函数",
  pageNumber: 18,
  kind: "highlight",
  x: 0.92,
  y: 0.5,
  width: 0.4,
  height: 0.12,
  color: "not-a-color",
  text: "Df"
}, scope);

assert(annotation, "valid textbook annotation should normalize");
assert(annotation.width <= 0.08 + Number.EPSILON, "annotation width should be clipped inside the page");
assert(annotation.color === "#facc15", "invalid highlight color should fall back to the default");

const rejectedAnnotation = textbookStore.normalizeTextbookAnnotation({
  ...annotation,
  nodeId: "",
  width: 0.1
}, scope);
assert(rejectedAnnotation === null, "annotation without node id must be rejected");

const normalizedStore = textbookStore.normalizeTextbookStore({
  version: 1,
  assets: [
    {
      id: scope.textbookId,
      courseId: scope.courseId,
      mindMapId: scope.mindMapId,
      title: "高等数学",
      filePath: "F:/AIstudyPublicData/assets/math.pdf",
      fileName: "math.pdf",
      byteSize: 100,
      pageCount: 442,
      lastPage: 18,
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:00.000Z"
    }
  ],
  notes: [
    {
      id: "note_contract_old",
      textbookId: scope.textbookId,
      courseId: scope.courseId,
      mindMapId: scope.mindMapId,
      nodeId: "node_contract",
      nodeTitle: "映射",
      pageNumber: 18,
      pageStart: 20,
      pageEnd: 18,
      content: "D_f",
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:00.000Z"
    },
    {
      id: "note_contract_new",
      textbookId: scope.textbookId,
      courseId: scope.courseId,
      mindMapId: scope.mindMapId,
      nodeId: "node_contract",
      nodeTitle: "映射",
      pageNumber: 19,
      pageStart: 19,
      pageEnd: 21,
      content: "R_f",
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:01:00.000Z"
    }
  ]
}, { courseId: scope.courseId, mindMapId: scope.mindMapId });

assert(normalizedStore.assets.length === 1, "textbook assets should normalize");
assert(normalizedStore.notes.length === 1, "duplicate textbook notes should collapse by textbook/node");
assert(normalizedStore.notes[0].pageStart === 19 && normalizedStore.notes[0].pageEnd === 21, "latest textbook note range should win");

const boundarySummary = storageBoundary.summarizeStorageBoundaries();
assert(boundarySummary.valid, "storage boundary registry should be valid");
assert(boundarySummary.dbFirst >= 5, "storage boundary registry should cover DB-first modules");
assert(boundarySummary.dbOwned >= 2, "storage boundary registry should cover DB-owned modules");

console.log("textbook regression policy: ok");
