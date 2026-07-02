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
const androidActivity = read("android/vocabulary-capture/app/src/main/java/com/aistudy/vocabularycapture/MainActivity.java");
const androidBridge = read("android/vocabulary-capture/app/src/main/java/com/aistudy/vocabularycapture/DesktopBridge.java");
const accessibilityConfig = read("android/vocabulary-capture/app/src/main/res/xml/accessibility_service_config.xml");
const desktopService = read("electron/vocabularyCaptureService.ts");
const companionLauncher = read("electron/vocabularyCaptureCompanionLauncher.ts");
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
assertContains(androidService, "DesktopBridge.postPayloadAsync", "Vocabulary APK service must reuse the shared desktop bridge.");
assertContains(androidBridge, "172.20.176.1", "Vocabulary APK bridge must include the MyApps vSwitch host gateway.");
assertContains(androidBridge, "192.168.1.3", "Vocabulary APK bridge must include the current LAN host gateway.");
assertContains(androidActivity, "permission_required", "Vocabulary APK activity must report permission-required status to AIstudy.");
assertContains(androidActivity, "openAccessibilitySettings", "Vocabulary APK activity must open Android accessibility settings for authorization.");
assertContains(accessibilityConfig, "typeWindowsChanged", "Accessibility config must listen to window changes.");

assertContains(desktopService, "targetStatus: \"capturing\" | \"watching\" | \"permission_required\" | \"waiting\"", "Desktop state must separate APK connection, permission, and target app activity.");
assertContains(desktopService, "CONNECTION_TTL_MS = 45000", "Desktop service must keep short Android foreground transitions from dropping the connection state.");
assertContains(desktopService, "HEARTBEAT_LOCAL_WRITE_INTERVAL_MS = 15000", "Desktop service must persist heartbeat state with a throttle instead of writing every tick.");
assertContains(desktopService, "normalizePayloadTargetActive", "Desktop service must normalize target activity from APK payloads.");
assertContains(desktopService, "launchCompanionApp", "Desktop service must be able to launch the Android companion when heartbeat is stale.");
assertContains(desktopService, "saveDocumentText", "Desktop service must expose editable vocabulary document persistence.");
assertContains(companionLauncher, "androws://app/launch?pkgname=", "Companion launcher must use the Androws package launch protocol.");
assertContains(companionLauncher, "com.aistudy.vocabularycapture", "Companion launcher must target the real vocabulary capture APK.");
assertMatches(
  desktopService,
  /if \(!text\) \{\s*await writeHeartbeatStateIfDue\(receivedAt\);\s*broadcastState\(\);\s*return \{ accepted: false, duplicate: false \};\s*\}/,
  "Heartbeat-only updates must persist connection state through the throttled heartbeat writer."
);

assertContains(panel, "采集中", "Vocabulary panel must expose active capture state.");
assertContains(panel, "等待百词斩", "Vocabulary panel must expose connected-but-watching state.");
assertContains(panel, "等待授权", "Vocabulary panel must expose permission-required state.");

assertContains(panel, "saveDocument", "Vocabulary panel must save user edits to the vocabulary document.");
assertContains(panel, "onChange={handleDocumentChange}", "Vocabulary panel document must be editable.");
if (panel.includes("readOnly")) {
  throw new Error("Vocabulary document textarea must not be read-only.");
}

console.log("vocabulary capture policy: ok");
