import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..", "..");
const args = new Set(process.argv.slice(2));
const fix = args.has("--fix");
const json = args.has("--json");
const noFetch = args.has("--no-fetch");

const statusRank = { ok: 0, warning: 1, error: 2 };
const checks = [];

function addCheck(id, status, message, detail = "") {
  checks.push({ id, status, message, detail });
}

function normalizeRepositoryUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("git@github.com:")) {
    return `https://github.com/${raw.slice("git@github.com:".length).replace(/\.git$/, "")}.git`;
  }
  if (/^https:\/\/github\.com\//i.test(raw)) {
    const withoutSuffix = raw.replace(/\.git$/i, "");
    return `${withoutSuffix}.git`;
  }
  return raw;
}

function repositoryWebUrl(value) {
  return normalizeRepositoryUrl(value).replace(/\.git$/i, "");
}

function parseGitHubRepository(value) {
  const webUrl = repositoryWebUrl(value);
  const match = webUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  return match ? { owner: match[1], repo: match[2], webUrl } : null;
}

function normalizeVersion(value) {
  return String(value || "").trim().replace(/^v/i, "");
}

function compareVersions(leftValue, rightValue) {
  const left = normalizeVersion(leftValue).split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const right = normalizeVersion(rightValue).split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = Number.isFinite(left[index]) ? left[index] : 0;
    const rightPart = Number.isFinite(right[index]) ? right[index] : 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  return 0;
}

async function run(command, commandArgs, options = {}) {
  const result = await execFileAsync(command, commandArgs, {
    cwd: projectRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8,
    ...options
  });
  return String(result.stdout || "").trim();
}

async function tryRun(command, commandArgs, options = {}) {
  try {
    return { ok: true, stdout: await run(command, commandArgs, options), error: "" };
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr || "").trim() : "";
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, stdout: "", error: stderr || message };
  }
}

function quoteCmdArg(value) {
  const text = String(value);
  if (!/[()\[\]{}^=;!'+,`~\s&|<>"]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

async function runGh(commandArgs) {
  if (process.platform === "win32") {
    const whereGh = await tryRun("where.exe", ["gh"]);
    const candidates = whereGh.ok ? whereGh.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
    const candidate = candidates.find((item) => /\.(exe|cmd|bat)$/i.test(item)) || candidates[0];
    if (candidate && /\.(cmd|bat)$/i.test(candidate)) {
      return tryRun("cmd.exe", ["/d", "/s", "/c", [quoteCmdArg(candidate), ...commandArgs.map(quoteCmdArg)].join(" ")]);
    }
    if (candidate) {
      return tryRun(candidate, commandArgs);
    }
  }
  return tryRun("gh", commandArgs);
}

async function readPackageJson() {
  return JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
}

async function getOriginUrl(packageRepositoryUrl) {
  const origin = await tryRun("git", ["remote", "get-url", "origin"]);
  if (origin.ok && origin.stdout) return origin.stdout;
  if (fix && packageRepositoryUrl) {
    await run("git", ["remote", "add", "origin", normalizeRepositoryUrl(packageRepositoryUrl)]);
    addCheck("origin-fix", "ok", "Added missing origin remote.", normalizeRepositoryUrl(packageRepositoryUrl));
    return packageRepositoryUrl;
  }
  addCheck("origin", "error", "Missing origin remote.", "Run npm run github:sync:fix after package.json repository is correct.");
  return "";
}

async function getDefaultBranch(originUrl) {
  const remoteHead = await tryRun("git", ["ls-remote", "--symref", "origin", "HEAD"]);
  if (!remoteHead.ok) {
    addCheck("remote-head", "warning", "Unable to read origin HEAD.", remoteHead.error);
    return "";
  }
  const match = remoteHead.stdout.match(/^ref:\s+refs\/heads\/(.+?)\s+HEAD/m);
  if (!match) {
    addCheck("remote-head", "warning", "Origin HEAD did not expose a default branch.", originUrl);
    return "";
  }
  addCheck("remote-head", "ok", `Origin default branch is ${match[1]}.`, originUrl);
  return match[1];
}

async function getRemoteBranchExists(branch) {
  if (!branch) return false;
  const remoteBranch = await tryRun("git", ["ls-remote", "--heads", "origin", branch]);
  return remoteBranch.ok && remoteBranch.stdout.trim().length > 0;
}

async function ensureUpstream(branch) {
  const upstream = await tryRun("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (upstream.ok && upstream.stdout) {
    addCheck("upstream", "ok", `Current branch tracks ${upstream.stdout}.`);
    return upstream.stdout;
  }

  if (fix && await getRemoteBranchExists(branch)) {
    await run("git", ["branch", "--set-upstream-to", `origin/${branch}`, branch]);
    addCheck("upstream-fix", "ok", `Set upstream to origin/${branch}.`);
    return `origin/${branch}`;
  }

  addCheck("upstream", "warning", "Current branch has no upstream.", "Push with -u or run npm run github:sync:fix if the remote branch exists.");
  return "";
}

async function checkAheadBehind(upstream) {
  if (!upstream) return;
  const result = await tryRun("git", ["rev-list", "--left-right", "--count", `HEAD...${upstream}`]);
  if (!result.ok) {
    addCheck("ahead-behind", "warning", "Unable to compare local branch with upstream.", result.error);
    return;
  }
  const [ahead, behind] = result.stdout.split(/\s+/).map((value) => Number.parseInt(value, 10) || 0);
  if (behind > 0) {
    addCheck("ahead-behind", "error", `Local branch is behind upstream by ${behind} commit(s).`, `ahead=${ahead}`);
    return;
  }
  if (ahead > 0) {
    addCheck("ahead-behind", "warning", `Local branch has ${ahead} unpushed commit(s).`, `behind=${behind}`);
    return;
  }
  addCheck("ahead-behind", "ok", "Local branch commit is aligned with upstream.");
}

async function checkWorktree() {
  const status = await run("git", ["status", "--porcelain=v1"]);
  if (!status) {
    addCheck("worktree", "ok", "Working tree is clean.");
    return;
  }
  const lines = status.split(/\r?\n/).filter(Boolean);
  const untracked = lines.filter((line) => line.startsWith("??")).length;
  addCheck("worktree", "warning", `Working tree has ${lines.length} changed path(s).`, `${untracked} untracked path(s). Commit or intentionally leave local-only files before publishing.`);
}

async function checkGh() {
  const gh = await runGh(["--version"]);
  if (gh.ok) {
    addCheck("gh", "ok", "GitHub CLI is available.", gh.stdout.split(/\r?\n/)[0] || "gh");
    const auth = await runGh(["auth", "status"]);
    addCheck("gh-auth", auth.ok ? "ok" : "warning", auth.ok ? "GitHub CLI authentication is available." : "GitHub CLI authentication is not ready.", auth.ok ? "" : auth.error);
    return;
  }
  const whereGh = await tryRun("where.exe", ["gh"]);
  addCheck("gh", "warning", "GitHub CLI is not runnable.", whereGh.ok ? `where gh: ${whereGh.stdout}` : gh.error);
}

async function checkLatestRelease(repositoryUrl, packageJson) {
  const repository = parseGitHubRepository(packageJson.aistudy?.updateRepository || repositoryUrl);
  if (!repository) {
    addCheck("release", "warning", "No valid GitHub update repository configured.");
    return;
  }
  try {
    const response = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.repo}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "AIstudy-GitHub-Sync-Doctor"
      }
    });
    if (response.status === 404) {
      addCheck("release", "warning", "GitHub repository has no latest release yet.", repository.webUrl);
      return;
    }
    if (!response.ok) {
      addCheck("release", "warning", `GitHub latest release check failed: ${response.status}.`, repository.webUrl);
      return;
    }
    const release = await response.json();
    const releaseVersion = normalizeVersion(release.tag_name || release.name || "");
    const packageVersion = normalizeVersion(packageJson.version || "");
    if (releaseVersion && packageVersion) {
      const versionCompare = compareVersions(releaseVersion, packageVersion);
      if (versionCompare < 0) {
        addCheck("release-version", "warning", `Latest GitHub release ${releaseVersion} is older than package version ${packageVersion}.`, "Create a new release after pushing the current project state.");
      } else if (versionCompare > 0) {
        addCheck("release-version", "warning", `Latest GitHub release ${releaseVersion} is newer than package version ${packageVersion}.`, "Confirm package.json version before publishing.");
      } else {
        addCheck("release-version", "ok", `Latest GitHub release matches package version ${packageVersion}.`);
      }
    }
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const pattern = String(packageJson.aistudy?.updateAssetPattern || "AIstudy-Setup-*.exe");
    const matcher = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");
    const asset = assets.find((item) => typeof item.name === "string" && matcher.test(item.name));
    addCheck(
      "release",
      asset ? "ok" : "warning",
      asset ? `Latest release ${release.tag_name || release.name || ""} has installer asset ${asset.name}.` : `Latest release ${release.tag_name || release.name || ""} has no asset matching ${pattern}.`,
      repository.webUrl
    );
  } catch (error) {
    addCheck("release", "warning", "Unable to reach GitHub latest release API.", error instanceof Error ? error.message : String(error));
  }
}

function printReport(context) {
  if (json) {
    console.log(JSON.stringify({ ...context, checks }, null, 2));
    return;
  }
  console.log("AIstudy GitHub sync doctor");
  console.log(`projectRoot: ${context.projectRoot}`);
  console.log(`branch: ${context.branch || "(unknown)"}`);
  console.log(`origin: ${context.originUrl || "(missing)"}`);
  console.log("");
  for (const item of checks) {
    const prefix = item.status === "ok" ? "[ok]" : item.status === "warning" ? "[warn]" : "[error]";
    console.log(`${prefix} ${item.id}: ${item.message}`);
    if (item.detail) console.log(`       ${item.detail}`);
  }
}

async function main() {
  const packageJson = await readPackageJson();
  const packageRepositoryUrl = typeof packageJson.repository === "string" ? packageJson.repository : packageJson.repository?.url || "";
  const gitRoot = await tryRun("git", ["rev-parse", "--show-toplevel"]);
  if (!gitRoot.ok) {
    addCheck("git", "error", "Current project is not a git repository.", gitRoot.error);
    printReport({ projectRoot, branch: "", originUrl: "" });
    process.exitCode = 1;
    return;
  }
  addCheck("git", "ok", "Git repository detected.", gitRoot.stdout);

  const originUrl = await getOriginUrl(packageRepositoryUrl);
  const normalizedOrigin = normalizeRepositoryUrl(originUrl);
  const normalizedPackageRepo = normalizeRepositoryUrl(packageRepositoryUrl);
  if (normalizedOrigin && normalizedPackageRepo && normalizedOrigin.toLowerCase() !== normalizedPackageRepo.toLowerCase()) {
    addCheck("repository-url", "warning", "Origin remote differs from package.json repository.", `origin=${normalizedOrigin}; package=${normalizedPackageRepo}`);
  } else if (normalizedOrigin) {
    addCheck("repository-url", "ok", "Origin remote matches package.json repository.", normalizedOrigin);
  }

  if (originUrl && !noFetch) {
    const fetchResult = await tryRun("git", ["fetch", "--prune", "origin"], { timeout: 60000 });
    addCheck("fetch", fetchResult.ok ? "ok" : "warning", fetchResult.ok ? "Fetched origin successfully." : "Unable to fetch origin.", fetchResult.error);
  }

  const branch = (await tryRun("git", ["branch", "--show-current"])).stdout;
  if (branch) addCheck("branch", "ok", `Current branch is ${branch}.`);
  await getDefaultBranch(originUrl);
  const upstream = await ensureUpstream(branch);
  await checkAheadBehind(upstream);
  await checkWorktree();
  await checkGh();
  await checkLatestRelease(originUrl, packageJson);

  printReport({ projectRoot, branch, originUrl: normalizedOrigin });
  process.exitCode = checks.some((item) => item.status === "error") ? 1 : 0;
}

main().catch((error) => {
  addCheck("fatal", "error", "GitHub sync doctor failed.", error instanceof Error ? error.stack || error.message : String(error));
  printReport({ projectRoot, branch: "", originUrl: "" });
  process.exitCode = 1;
});
