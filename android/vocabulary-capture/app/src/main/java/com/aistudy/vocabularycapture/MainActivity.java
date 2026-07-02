package com.aistudy.vocabularycapture;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MainActivity extends Activity {
    private TextView statusView;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean requestedSettings = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(40, 40, 40, 40);
        root.setBackgroundColor(Color.WHITE);

        statusView = new TextView(this);
        statusView.setGravity(Gravity.CENTER);
        statusView.setTextSize(18);
        statusView.setTextColor(Color.rgb(17, 24, 39));

        Button button = new Button(this);
        button.setText("\u5f00\u542f\u91c7\u96c6");
        button.setTextSize(18);
        button.setAllCaps(false);
        button.setOnClickListener(view -> openAccessibilitySettings());

        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        statusParams.setMargins(0, 0, 0, 28);
        root.addView(statusView, statusParams);

        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            112
        );
        root.addView(button, buttonParams);
        setContentView(root);
    }

    @Override
    protected void onResume() {
        super.onResume();
        boolean enabled = isServiceEnabled();
        statusView.setText(enabled ? "\u5df2\u5f00\u542f" : "\u672a\u5f00\u542f");
        DesktopBridge.sendStatusAsync(
            getPackageName(),
            getPackageName(),
            enabled ? "service_enabled" : "permission_required"
        );
        if (!enabled && !requestedSettings) {
            requestedSettings = true;
            handler.postDelayed(() -> {
                if (!isFinishing() && !isServiceEnabled()) openAccessibilitySettings();
            }, 650L);
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    private void openAccessibilitySettings() {
        Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(intent);
    }

    private boolean isServiceEnabled() {
        String enabledServices = Settings.Secure.getString(
            getContentResolver(),
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        );
        if (TextUtils.isEmpty(enabledServices)) return false;

        ComponentName expected = new ComponentName(this, VocabularyAccessibilityService.class);
        TextUtils.SimpleStringSplitter splitter = new TextUtils.SimpleStringSplitter(':');
        splitter.setString(enabledServices);
        while (splitter.hasNext()) {
            ComponentName enabled = ComponentName.unflattenFromString(splitter.next());
            if (expected.equals(enabled)) return true;
        }
        return false;
    }
}
