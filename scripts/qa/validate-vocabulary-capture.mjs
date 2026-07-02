import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assertContains(source, needle, message) {
  if (!source.includes(needle)) {
    throw new Error(message);
  }
}

function assertMatches(source, pattern, message) {
  if (!pattern.test(source)) {
    throw new Error(message);
  }
}

const androidService = read("android/vocabulary-capture/app/src/main/java/com/aistudy/vocabularycapture/VocabularyAccessibilityService.java");
const accessibilityConfig = read("android/vocabulary-capture/app/src/main/res/xml/accessibility_service_config.xml");
const desktopService = read("electron/vocabularyCaptureService.ts");
const panel = read("src/renderer/features/vocabulary/VocabularyCapturePanel.tsx");

assertContains(androidService, "HEARTBEAT_MS = 2000L", "Vocabulary APK heartbeat must stay near real time.");
assertMatches(
  androidService,
  /captureCurrentWindow\(\);\s*sendHeartbeat\(\);/,
  "Vocabulary APK must refresh foreground target state before sending heartbeat."
);
assertContains(androidService, "foregroundPackageName", "Vocabulary APK heartbeat must report foreground package.");
assertContains(androidService, "targetActive", "Vocabulary APK heartbeat must report whether Baicizhan is active.");
assertContains(androidService, "serviceStatus", "Vocabulary APK heartbeat must report service status.");
assertContains(accessibilityConfig, "typeWindowsChanged", "Accessibility config must listen to window changes.");

assertContains(desktopService, "targetStatus: \"capturing\" | \"watching\" | \"waiting\"", "Desktop state must separate APK connection from target app activity.");
assertContains(desktopService, "normalizePayloadTargetActive", "Desktop service must normalize target activity from APK payloads.");
assertMatches(
  desktopService,
  /if \(!text\) \{\s*broadcastState\(\);\s*return \{ accepted: false, duplicate: false \};\s*\}/,
  "Heartbeat-only updates must broadcast in memory without writing local state every tick."
);

assertContains(panel, "采集中", "Vocabulary panel must expose active capture state.");
assertContains(panel, "等待百词斩", "Vocabulary panel must expose connected-but-watching state.");

console.log("vocabulary capture policy: ok");
