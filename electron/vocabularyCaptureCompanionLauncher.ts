import { shell } from "electron";
import { execFile } from "node:child_process";

const VOCABULARY_CAPTURE_PACKAGE = "com.aistudy.vocabularycapture";
const ANDROWS_LAUNCH_URI = `androws://app/launch?pkgname=${VOCABULARY_CAPTURE_PACKAGE}`;
const MIN_LAUNCH_INTERVAL_MS = 30_000;

function isAndrowsRuntimeActive() {
  if (process.platform !== "win32") return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "$p = Get-Process -Name Androws -ErrorAction SilentlyContinue | Select-Object -First 1; if ($p) { exit 0 } exit 1"
      ],
      { timeout: 2500, windowsHide: true },
      (error) => resolve(!error)
    );
  });
}

export function createVocabularyCaptureCompanionLauncher() {
  let lastLaunchAt = 0;
  let inFlight = false;

  return {
    async launchIfRuntimeActive() {
      const now = Date.now();
      if (inFlight || now - lastLaunchAt < MIN_LAUNCH_INTERVAL_MS) return;
      inFlight = true;
      try {
        if (!await isAndrowsRuntimeActive()) return;
        lastLaunchAt = now;
        await shell.openExternal(ANDROWS_LAUNCH_URI);
      } catch {
        // The receiver state remains visible; companion launch is best-effort.
      } finally {
        inFlight = false;
      }
    }
  };
}
