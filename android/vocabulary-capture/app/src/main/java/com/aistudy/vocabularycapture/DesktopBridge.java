package com.aistudy.vocabularycapture;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class DesktopBridge {
    private static final String HEARTBEAT_PATH = "/vocabulary-capture/heartbeat";
    private static final String[] HOSTS = new String[] {
        "172.20.176.1",
        "192.168.1.3",
        "172.17.192.1",
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

    private static final ExecutorService SENDER = Executors.newSingleThreadExecutor();
    private static String activeHost = "";

    private DesktopBridge() {
    }

    static void sendStatusAsync(String packageName, String foregroundPackageName, String serviceStatus) {
        String payload = "{"
            + "\"source\":\"aistudy-vocabulary-apk\","
            + "\"appName\":\"\u767e\u8bcd\u65a9\","
            + "\"packageName\":\"" + jsonEscape(packageName) + "\","
            + "\"foregroundPackageName\":\"" + jsonEscape(foregroundPackageName) + "\","
            + "\"targetActive\":false,"
            + "\"targetLastActiveAt\":0,"
            + "\"serviceStatus\":\"" + jsonEscape(serviceStatus) + "\","
            + "\"capturedAt\":\"" + jsonEscape(Instant.now().toString()) + "\""
            + "}";
        postPayloadAsync(HEARTBEAT_PATH, payload);
    }

    static void postPayloadAsync(String path, String payload) {
        byte[] body = payload.getBytes(StandardCharsets.UTF_8);
        SENDER.execute(() -> postPayload(path, body));
    }

    private static void postPayload(String path, byte[] body) {
        if (!activeHost.isEmpty() && postPayloadToEndpoint(activeHost, path, body)) return;
        for (String host : HOSTS) {
            if (postPayloadToEndpoint(host, path, body)) {
                activeHost = host;
                return;
            }
        }
    }

    private static boolean postPayloadToEndpoint(String host, String path, byte[] body) {
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

    static String jsonEscape(String value) {
        if (value == null) value = "";
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
