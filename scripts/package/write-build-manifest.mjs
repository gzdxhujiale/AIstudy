import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const releaseRoot = path.join(projectRoot, "release");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

function runGit(args) {
  try {
    return execFileSync("git", args, {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function describeArtifact(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  return {
    path: path.relative(projectRoot, filePath).split(path.sep).join("/"),
    bytes: stat.size,
    sha256: hashFile(filePath)
  };
}

const version = String(packageJson.version || "");
const setupExe = path.join(releaseRoot, `AIstudy-Setup-${version}.exe`);
const runtimeExe = path.join(releaseRoot, "win-unpacked", "AIstudy.exe");
const latestYml = path.join(releaseRoot, "latest.yml");
const manifest = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  app: {
    name: packageJson.name,
    productName: packageJson.build?.productName || "AIstudy",
    version
  },
  git: {
    branch: runGit(["branch", "--show-current"]),
    commit: runGit(["rev-parse", "--short", "HEAD"]),
    dirty: Boolean(runGit(["status", "--porcelain"]))
  },
  cleanInstallerSourceGuard: {
    runtimeDataForbidden: true,
    checkedBy: "scripts/package/close-and-dist.ps1"
  },
  artifacts: {
    setupExe: describeArtifact(setupExe),
    runtimeExe: describeArtifact(runtimeExe),
    latestYml: describeArtifact(latestYml)
  }
};

fs.mkdirSync(releaseRoot, { recursive: true });
const manifestPath = path.join(releaseRoot, "build-manifest.json");
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`[AIstudy] Build manifest written: ${path.relative(projectRoot, manifestPath)}`);
