import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmpRoot = path.join(projectRoot, ".tmp", "build-cache");

function run(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch {
    return "";
  }
}

function runShell(command) {
  try {
    if (process.platform === "win32") {
      return execFileSync("cmd.exe", ["/d", "/s", "/c", command], {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }).trim();
    }

    return execFileSync("sh", ["-c", command], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch {
    return "";
  }
}

function exists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function ensureWritableDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
  const probe = path.join(directoryPath, `.write-check-${Date.now()}.tmp`);
  fs.writeFileSync(probe, "ok");
  fs.unlinkSync(probe);
}

function parseVersion(value) {
  return String(value).replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function supportsCurrentVite(nodeVersion) {
  const normalized = String(nodeVersion).replace(/^v/, "");
  const major = parseVersion(normalized)[0] ?? 0;
  if (major === 20) return compareVersions(normalized, "20.19.0") >= 0;
  return compareVersions(normalized, "22.12.0") >= 0;
}

function readPackageLockVersion(packageName) {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, "package-lock.json"), "utf8"));
    return lock.packages?.[`node_modules/${packageName}`]?.version ?? "";
  } catch {
    return "";
  }
}

function item(id, name, status, message, action) {
  return { id, name, status, message, action };
}

const checks = [];

checks.push(item(
  "os",
  "Windows 系统",
  process.platform === "win32" ? "ok" : "warning",
  process.platform === "win32" ? "当前系统可生成 Windows 安装包。" : "当前不是 Windows，不能直接生成 NSIS 安装包。",
  process.platform === "win32" ? "无需处理。" : "请在 Windows 机器上执行打包。"
));

checks.push(item(
  "node",
  "Node.js",
  supportsCurrentVite(process.version) ? "ok" : "error",
  supportsCurrentVite(process.version) ? `Node ${process.version} 满足构建要求。` : `Node ${process.version} 版本过低，Vite 需要 Node 20.19+ 或 22.12+。`,
  supportsCurrentVite(process.version) ? "无需处理。" : "请升级 Node.js 后重新运行 npm run setup:doctor。"
));

const npmVersion = runShell("npm --version");
checks.push(item(
  "npm",
  "npm",
  npmVersion ? "ok" : "error",
  npmVersion ? `npm ${npmVersion} 可用。` : "没有找到 npm，无法安装依赖。",
  npmVersion ? "无需处理。" : "请安装 Node.js 自带的 npm。"
));

checks.push(item(
  "lockfile",
  "依赖锁定文件",
  exists("package-lock.json") ? "ok" : "error",
  exists("package-lock.json") ? "已找到 package-lock.json，依赖版本可复现。" : "缺少 package-lock.json，无法稳定复现依赖版本。",
  exists("package-lock.json") ? "无需处理。" : "请从仓库重新拉取完整项目。"
));

const nodeModulesReady = exists("node_modules");
checks.push(item(
  "node_modules",
  "依赖目录",
  nodeModulesReady ? "ok" : "warning",
  nodeModulesReady ? "node_modules 已存在。" : "依赖还没有安装，无法构建或启动开发模式。",
  nodeModulesReady ? "无需处理。" : "运行 npm run setup:install。"
));

const electronVersion = readPackageLockVersion("electron") || "unknown";
const electronDistReady = exists("node_modules/electron/dist/electron.exe") || exists("node_modules/electron/dist/Electron.app");
checks.push(item(
  "electron-binary",
  "Electron 二进制",
  electronDistReady ? "ok" : "warning",
  electronDistReady ? `Electron ${electronVersion} 二进制已就绪。` : `Electron ${electronVersion} 二进制还没有下载完成。`,
  electronDistReady ? "无需处理。" : "运行 npm run setup:install；离线机器需先把 .tmp/build-cache 和 node_modules 从已成功安装的机器复制过来。"
));

const builderVersion = readPackageLockVersion("electron-builder") || "unknown";
checks.push(item(
  "electron-builder",
  "electron-builder",
  exists("node_modules/electron-builder") ? "ok" : "warning",
  exists("node_modules/electron-builder") ? `electron-builder ${builderVersion} 已安装。` : "electron-builder 还没有安装。",
  exists("node_modules/electron-builder") ? "无需处理。" : "运行 npm run setup:install。"
));

for (const [id, name, directory] of [
  ["npm-cache", "npm 本地缓存", path.join(tmpRoot, "npm")],
  ["electron-cache", "Electron 本地缓存", path.join(tmpRoot, "electron")],
  ["builder-cache", "打包工具本地缓存", path.join(tmpRoot, "electron-builder")]
]) {
  try {
    ensureWritableDirectory(directory);
    checks.push(item(id, name, "ok", "项目本地缓存目录可写。", "无需处理。"));
  } catch {
    checks.push(item(id, name, "error", "项目本地缓存目录不可写。", "请检查项目目录权限。"));
  }
}

const mysqlConfigReady = exists(".env.example");
checks.push(item(
  "mysql-config-template",
  "MySQL 配置模板",
  mysqlConfigReady ? "ok" : "warning",
  mysqlConfigReady ? "已提供公开版数据库配置模板。" : "没有找到数据库配置模板。",
  mysqlConfigReady ? "安装包可先以本机副本模式运行；需要同步时再配置 MySQL。" : "请恢复 .env.example。"
));

const summary = checks.reduce((acc, current) => {
  acc[current.status] = (acc[current.status] ?? 0) + 1;
  return acc;
}, { ok: 0, warning: 0, error: 0 });

console.log("AIstudy Public 新机器检查");
console.log(`正常 ${summary.ok ?? 0}，需关注 ${summary.warning ?? 0}，不可用 ${summary.error ?? 0}`);
console.log("");

for (const check of checks) {
  const label = check.status === "ok" ? "OK" : check.status === "warning" ? "WARN" : "ERROR";
  console.log(`[${label}] ${check.name}`);
  console.log(`  ${check.message}`);
  console.log(`  处理：${check.action}`);
}

if ((summary.error ?? 0) > 0) {
  process.exit(1);
}
