import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const forbiddenMindMapImports = [
  "simple-mind-map/full",
  "simple-mind-map/src/plugins/RichText",
  "simple-mind-map/src/plugins/RichText.js",
  "simple-mind-map/src/plugins/Formula",
  "simple-mind-map/src/plugins/Formula.js"
];

const sourceRoots = ["src", "electron", "scripts"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cts", ".mts", ".d.ts"]);
const ignoredRelativePrefixes = [
  path.join("scripts", "npm-stubs"),
  path.join("scripts", "qa", "validate-safe-dependencies.mjs")
];

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), "utf8"));
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function hasIgnoredPrefix(relativePath) {
  return ignoredRelativePrefixes.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}${path.sep}`));
}

async function* walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = path.relative(repoRoot, absolutePath);
    if (hasIgnoredPrefix(relativePath)) continue;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "dist-electron") continue;
      yield* walkFiles(absolutePath);
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      yield absolutePath;
    }
  }
}

async function validateMindMapImports() {
  for (const root of sourceRoots) {
    const absoluteRoot = path.join(repoRoot, root);
    try {
      await fs.access(absoluteRoot);
    } catch {
      continue;
    }
    for await (const absolutePath of walkFiles(absoluteRoot)) {
      const text = await fs.readFile(absolutePath, "utf8");
      for (const forbiddenImport of forbiddenMindMapImports) {
        if (text.includes(forbiddenImport)) {
          fail(`禁止引入 Quill 相关导图入口：${toPosix(path.relative(repoRoot, absolutePath))} -> ${forbiddenImport}`);
        }
      }
    }
  }
}

async function validatePackagePolicy() {
  const packageJson = await readJson("package.json");
  const lockText = await fs.readFile(path.join(repoRoot, "pnpm-lock.yaml"), "utf8");
  const dependencies = packageJson.dependencies ?? {};
  const devDependencies = packageJson.devDependencies ?? {};
  const overrides = packageJson.overrides ?? {};

  if (devDependencies.quill !== "file:./scripts/npm-stubs/quill") {
    fail("quill 必须指向本地安全 stub：devDependencies.quill = file:./scripts/npm-stubs/quill");
  }
  if (overrides.undici !== "6.27.0") {
    fail("undici override 必须保持在已修复版本 6.27.0。");
  }
  if (overrides.uuid !== "11.1.1") {
    fail("uuid override 必须保持在已修复版本 11.1.1。");
  }
  if (dependencies.quill) {
    fail("quill 不能作为生产依赖安装。");
  }

  if (!lockText.includes("file:scripts/npm-stubs/quill")) {
    fail("pnpm-lock 必须包含 scripts/npm-stubs/quill 的 link。");
  }

  for (const forbiddenPackage of ["quill-delta", "parchment", "lodash-es", "fast-diff"]) {
    if (lockText.includes(`${forbiddenPackage}@`) || lockText.includes(`${forbiddenPackage}:`)) {
      fail(`pnpm-lock 不能包含真实 Quill 依赖：${forbiddenPackage}`);
    }
  }
}

await validateMindMapImports();
await validatePackagePolicy();

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("safe dependency policy: ok");
