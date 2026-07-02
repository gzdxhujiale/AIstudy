package com.aistudy.vocabularycapture;

import android.accessibilityservice.AccessibilityService;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.security.MessageDigest;
import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public class VocabularyAccessibilityService extends AccessibilityService {
    private static final int MAX_NODE_TEXTS = 180;
    private static final int MAX_TEXT_LENGTH = 30000;
    private static final long HEARTBEAT_MS = 2000L;
    private static final String EVENT_PATH = "/vocabulary-capture/events";
    private static final String HEARTBEAT_PATH = "/vocabulary-capture/heartbeat";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable captureRunnable = new Runnable() {
        @Override
        public void run() {
            captureCurrentWindow();
            sendHeartbeat();
        }
    };
    private final Runnable heartbeatRunnable = new Runnable() {
        @Override
        public void run() {
            captureCurrentWindow();
            sendHeartbeat();
            handler.postDelayed(this, HEARTBEAT_MS);
        }
    };

    private String lastHash = "";
    private String lastPackageName = "";
    private String lastForegroundPackageName = "";
    private boolean lastTargetActive = false;
    private long lastTargetActiveAt = 0L;
    private long lastPostAt = 0L;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        handler.removeCallbacks(heartbeatRunnable);
        handler.post(heartbeatRunnable);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) return;
        CharSequence packageName = event.getPackageName();
        lastPackageName = packageName == null ? lastPackageName : packageName.toString();
        lastForegroundPackageName = lastPackageName;
        handler.removeCallbacks(captureRunnable);
        handler.postDelayed(captureRunnable, 80L);
    }

    @Override
    public void onInterrupt() {
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(captureRunnable);
        handler.removeCallbacks(heartbeatRunnable);
        super.onDestroy();
    }

    private void captureCurrentWindow() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            lastTargetActive = false;
            return;
        }

        CharSequence rootPackageName = root.getPackageName();
        String currentPackageName = rootPackageName == null ? lastPackageName : rootPackageName.toString();
        lastPackageName = currentPackageName;
        lastForegroundPackageName = currentPackageName;

        List<String> texts = new ArrayList<>();
        collectText(root, texts, new LinkedHashSet<>());
        root.recycle();

        String text = normalizeText(texts);
        lastTargetActive = isVocabularyWindow(currentPackageName, text);
        if (lastTargetActive) lastTargetActiveAt = System.currentTimeMillis();
        if (text.isEmpty()) return;
        if (!lastTargetActive) return;

        String hash = sha256(text);
        long now = System.currentTimeMillis();
        if (hash.equals(lastHash) && now - lastPostAt < HEARTBEAT_MS) return;
        lastHash = hash;
        lastPostAt = now;

        String word = extractWord(text);
        if (word.isEmpty()) return;
        String payload = buildPayload(currentPackageName, word, text);
        DesktopBridge.postPayloadAsync(EVENT_PATH, payload);
    }

    private void collectText(AccessibilityNodeInfo node, List<String> output, Set<String> seen) {
        if (node == null || output.size() >= MAX_NODE_TEXTS) return;
        addNodeText(node.getText(), output, seen);
        addNodeText(node.getContentDescription(), output, seen);
        for (int index = 0; index < node.getChildCount() && output.size() < MAX_NODE_TEXTS; index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child != null) {
                collectText(child, output, seen);
                child.recycle();
            }
        }
    }

    private void addNodeText(CharSequence value, List<String> output, Set<String> seen) {
        if (value == null) return;
        String text = value.toString().replaceAll("\\s+", " ").trim();
        if (text.isEmpty()) return;
        if (isNoiseText(text)) return;
        if (seen.add(text)) output.add(text);
    }

    private boolean isNoiseText(String text) {
        String lower = text.toLowerCase(Locale.ROOT);
        if (text.matches("^[A-Za-z]$")) return true;
        if (text.matches("^\u9700\u5b66\u4e60\\s*\\d+.*$")) return true;
        if ("\u4e0b\u4e00\u9898".equals(text) || "\u63d0\u4ea4".equals(text)) return true;
        if (lower.matches("^(n|v|vi|vt|adj|adv|pron|prep|conj|interj|int|num|art|abbr)\\.\\s*.+$")) return true;
        if (lower.contains("base64") || lower.contains("svg+xml")) return true;
        if (lower.contains(".mp4") || lower.contains(".png") || lower.contains(".jpg") || lower.contains(".webp")) return true;
        if (lower.matches("^intro\\d[\\w.-]*$")) return true;
        return text.length() >= 40
            && text.matches("^[A-Za-z0-9+/=_-]+$")
            && text.matches(".*[A-Za-z].*")
            && text.matches(".*\\d.*");
    }

    private String normalizeText(List<String> texts) {
        StringBuilder builder = new StringBuilder();
        for (String text : texts) {
            if (builder.length() > 0) builder.append('\n');
            builder.append(text);
            if (builder.length() >= MAX_TEXT_LENGTH) break;
        }
        if (builder.length() > MAX_TEXT_LENGTH) {
            return builder.substring(0, MAX_TEXT_LENGTH);
        }
        return builder.toString();
    }

    private boolean isVocabularyWindow(String packageName, String text) {
        String lowerPackage = packageName == null ? "" : packageName.toLowerCase(Locale.ROOT);
        if (lowerPackage.contains("jiongji") || lowerPackage.contains("baicizhan")) return true;
        return text.contains("\u767e\u8bcd\u65a9") || text.contains("\u9700\u5b66\u4e60");
    }

    private String extractWord(String text) {
        String[] blocked = new String[] {
            "ai",
            "app",
            "back",
            "fullscreen",
            "settings",
            "volume",
            "share",
            "feedback"
        };
        String[] lines = text.split("\\n");
        String latestHead = "";
        for (int index = 0; index < lines.length; index += 1) {
            String line = lines[index];
            String candidate = line.trim();
            if (!candidate.matches("^[A-Za-z][A-Za-z'-]{2,48}$")) continue;
            String lower = candidate.toLowerCase(Locale.ROOT);
            boolean isBlocked = false;
            for (String item : blocked) {
                if (item.equals(lower)) {
                    isBlocked = true;
                    break;
                }
            }
            if (isBlocked) continue;
            for (int lookahead = index + 1; lookahead < lines.length && lookahead <= index + 5; lookahead += 1) {
                if (lines[lookahead].trim().matches("^/.+/$")) {
                    latestHead = lower;
                    break;
                }
            }
        }
        return latestHead;
    }

    private String buildPayload(String packageName, String word, String text) {
        return "{"
            + "\"source\":\"aistudy-vocabulary-apk\","
            + "\"appName\":\"\u767e\u8bcd\u65a9\","
            + "\"packageName\":\"" + DesktopBridge.jsonEscape(packageName == null ? "" : packageName) + "\","
            + "\"foregroundPackageName\":\"" + DesktopBridge.jsonEscape(lastForegroundPackageName) + "\","
            + "\"targetActive\":" + (lastTargetActive ? "true" : "false") + ","
            + "\"targetLastActiveAt\":" + Long.toString(lastTargetActiveAt) + ","
            + "\"serviceStatus\":\"capturing\","
            + "\"word\":\"" + DesktopBridge.jsonEscape(word) + "\","
            + "\"capturedAt\":\"" + DesktopBridge.jsonEscape(Instant.now().toString()) + "\","
            + "\"text\":\"" + DesktopBridge.jsonEscape(text) + "\""
            + "}";
    }

    private void sendHeartbeat() {
        String payload = "{"
            + "\"source\":\"aistudy-vocabulary-apk\","
            + "\"appName\":\"\u767e\u8bcd\u65a9\","
            + "\"packageName\":\"" + DesktopBridge.jsonEscape(lastPackageName) + "\","
            + "\"foregroundPackageName\":\"" + DesktopBridge.jsonEscape(lastForegroundPackageName) + "\","
            + "\"targetActive\":" + (lastTargetActive ? "true" : "false") + ","
            + "\"targetLastActiveAt\":" + Long.toString(lastTargetActiveAt) + ","
            + "\"serviceStatus\":\"" + (lastTargetActive ? "capturing" : "watching") + "\","
            + "\"capturedAt\":\"" + DesktopBridge.jsonEscape(Instant.now().toString()) + "\""
            + "}";
        DesktopBridge.postPayloadAsync(HEARTBEAT_PATH, payload);
    }

    private String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder();
            for (byte item : bytes) {
                builder.append(String.format(Locale.ROOT, "%02x", item));
            }
            return builder.toString();
        } catch (Exception error) {
            return Integer.toString(value.hashCode());
        }
    }

}
