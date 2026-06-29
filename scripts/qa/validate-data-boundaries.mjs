import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

const requiredStorageModuleIds = [
  "courses",
  "mindmaps",
  "documents",
  "exams",
  "textbooks",
  "textbook-annotations",
  "chrome-port-states",
  "error-logs",
  "ui-preferences"
];

const allowedLocalStorageFiles = new Set([
  "src/renderer/features/assistant/AiAssistantPanel.tsx",
  "src/renderer/features/documents/KnowledgeDocumentWorkspace.tsx",
  "src/renderer/features/mindmap/MindMapWorkspace.tsx",
  "src/renderer/features/mindmap/mindMapShortcutSettings.ts"
]);

const forbiddenPackageEntries = [
  "AIstudyPublicData",
  "AIstudyUserData",
  "courses.json",
  "course-pending-operations.json",
  "textbook-pending-scopes.json",
  "textbook-database-backed-scopes.json",
  "chrome-ports.json",
  "mysql.config.json"
];

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function walk(dir) {
  const entries = fs.readdirSync(path.join(projectRoot, dir), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(dir.split(path.sep).join("/"), entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "dist-electron", "release"].includes(entry.name)) continue;
      files.push(...walk(relativePath));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

function fail(message) {
  console.error(`data boundary policy: ${message}`);
  process.exitCode = 1;
}

const packageJson = JSON.parse(read("package.json"));
const packagedFiles = JSON.stringify(packageJson.build?.files ?? []);
for (const forbidden of forbiddenPackageEntries) {
  if (packagedFiles.includes(forbidden)) {
    fail(`package.json build.files must not include runtime data: ${forbidden}`);
  }
}

const closeAndDist = read("scripts/package/close-and-dist.ps1");
for (const forbidden of forbiddenPackageEntries) {
  if (!closeAndDist.includes(forbidden)) {
    fail(`dist:oneclick clean source guard is missing ${forbidden}`);
  }
}

const storageBoundary = read("electron/storageBoundary.ts");
for (const id of requiredStorageModuleIds) {
  if (!storageBoundary.includes(`id: "${id}"`)) {
    fail(`storage boundary registry is missing module ${id}`);
  }
}

const sourceFiles = [
  ...walk("src/renderer"),
  ...walk("electron")
].filter((file) => /\.(ts|tsx|cts)$/.test(file));

for (const file of sourceFiles) {
  const source = read(file);
  if (source.includes("localStorage") && !allowedLocalStorageFiles.has(file)) {
    fail(`localStorage is only allowed for whitelisted local preferences or legacy recovery: ${file}`);
  }
}

const preload = read("electron/preload.cts");
if (/mysql|fs\.|node:fs/i.test(preload)) {
  fail("preload must not expose raw MySQL or filesystem capabilities");
}

const main = read("electron/main.ts");
for (const directAnnotationImport of [
  "readTextbookAnnotationsFromMysql",
  "writeTextbookAnnotationToMysql",
  "deleteTextbookAnnotationFromMysql"
]) {
  if (main.includes(directAnnotationImport)) {
    fail(`main.ts should route PDF annotation persistence through textbookAnnotationService: ${directAnnotationImport}`);
  }
}

if (!process.exitCode) {
  console.log("data boundary policy: ok");
}
