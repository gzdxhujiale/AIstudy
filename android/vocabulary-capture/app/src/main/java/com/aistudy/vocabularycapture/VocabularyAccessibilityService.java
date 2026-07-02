package com.aistudy.vocabularycapture;

import android.accessibilityservice.AccessibilityService;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class VocabularyAccessibilityService extends AccessibilityService {
    private static final int MAX_NODE_TEXTS = 180;
    private static final int MAX_TEXT_LENGTH = 30000;
    private static final long HEARTBEAT_MS = 5000L;
    private static final String EVENT_PATH = "/vocabulary-capture/events";
    private static final String HEARTBEAT_PATH = "/vocabulary-capture/heartbeat";
    private static final String[] HOSTS = new String[] {
        "10.0.2.2",
        "10.0.3.2",
        "172.16.100.2",
        "172.17.100.2",
        "172.30.144.1",
        "192.168.1.84",
        "192.168.100.1",
        "192.168.122.1",
        "127.0.0.1"
    };

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService sender = Executors.newSingleThreadExecutor();
    private final Runnable captureRunnable = this::captureCurrentWindow;
    private final Runnable heartbeatRunnable = new Runnable() {
        @Override
        public void run() {
            sendHeartbeat();
            captureCurrentWindow();
            handler.postDelayed(this, HEARTBEAT_MS);
        }
    };

    private String lastHash = "";
    private String lastPackageName = "";
    private String activeHost = "";
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
        sender.shutdownNow();
        super.onDestroy();
    }

    private void captureCurrentWindow() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;

        List<String> texts = new ArrayList<>();
        collectText(root, texts, new LinkedHashSet<>());
        root.recycle();

        String text = normalizeText(texts);
        if (text.isEmpty()) return;
        if (!isVocabularyWindow(lastPackageName, text)) return;

        String hash = sha256(text);
        long now = System.currentTimeMillis();
        if (hash.equals(lastHash) && now - lastPostAt < HEARTBEAT_MS) return;
        lastHash = hash;
        lastPostAt = now;

        String word = extractWord(text);
        if (word.isEmpty()) return;
        String payload = buildPayload(lastPackageName, word, text);
        sender.execute(() -> postPayload(payload, EVENT_PATH));
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
            + "\"packageName\":\"" + jsonEscape(packageName == null ? "" : packageName) + "\","
            + "\"word\":\"" + jsonEscape(word) + "\","
            + "\"capturedAt\":\"" + jsonEscape(Instant.now().toString()) + "\","
            + "\"text\":\"" + jsonEscape(text) + "\""
            + "}";
    }

    private void sendHeartbeat() {
        String payload = "{"
            + "\"source\":\"aistudy-vocabulary-apk\","
            + "\"appName\":\"\u767e\u8bcd\u65a9\","
            + "\"packageName\":\"" + jsonEscape(lastPackageName) + "\","
            + "\"capturedAt\":\"" + jsonEscape(Instant.now().toString()) + "\""
            + "}";
        sender.execute(() -> postPayload(payload, HEARTBEAT_PATH));
    }

    private void postPayload(String payload, String path) {
        byte[] body = payload.getBytes(StandardCharsets.UTF_8);
        if (!activeHost.isEmpty() && postPayloadToEndpoint(activeHost, path, body)) return;
        for (String host : HOSTS) {
            if (postPayloadToEndpoint(host, path, body)) {
                activeHost = host;
                return;
            }
        }
    }

    private boolean postPayloadToEndpoint(String host, String path, byte[] body) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL("http://" + host + ":38673" + path);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(260);
            connection.setReadTimeout(500);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream stream = connection.getOutputStream()) {
                stream.write(body);
            }
            int code = connection.getResponseCode();
            return code >= 200 && code < 300;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
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

    private String jsonEscape(String value) {
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < value.length(); index += 1) {
            char ch = value.charAt(index);
            switch (ch) {
                case '\\':
                    builder.append("\\\\");
                    break;
                case '"':
                    builder.append("\\\"");
                    break;
                case '\n':
                    builder.append("\\n");
                    break;
                case '\r':
                    builder.append("\\r");
                    break;
                case '\t':
                    builder.append("\\t");
                    break;
                default:
                    if (ch < 0x20) {
                        builder.append(String.format(Locale.ROOT, "\\u%04x", (int) ch));
                    } else {
                        builder.append(ch);
                    }
                    break;
            }
        }
        return builder.toString();
    }
}
