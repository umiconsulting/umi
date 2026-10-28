package co.umiconsulting.umi_support;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.WindowInsets;
import android.view.accessibility.AccessibilityManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private SupportPreferences preferences;
    private TextView status, last;
    private Button activate;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = new SupportPreferences(this);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(244, 247, 243));
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        int padding = dp(24);
        column.setPadding(padding, padding, padding, padding);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        scroll.addView(column);
        text(column, getString(R.string.app_name), 18);
        text(column, getString(R.string.heading), 32);
        text(column, getString(R.string.intro), 18);
        status = text(column, "", 22);
        text(column, getString(R.string.trusted_network, TrustedNetworkMessages.SSID, TrustedNetworkMessages.BSSID), 16);
        last = text(column, "", 16);
        activate = button(column, R.string.activate, view -> confirmActivation());
        button(column, R.string.pause, view -> {
            if (!preferences.setEnabled(false)) { storageFailure(); refresh(); return; }
            preferences.record("paused");
            refresh();
        });
        button(column, R.string.settings, view -> launch(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        button(column, R.string.keepadb, view -> {
            Intent intent = getPackageManager().getLaunchIntentForPackage("de.hohnepeople.keepadb");
            if (intent == null) unavailable(); else launch(intent);
        });
        text(column, getString(R.string.footnote), 15);
        setContentView(scroll);
    }

    private void confirmActivation() {
        new AlertDialog.Builder(this).setTitle(R.string.consent_title).setMessage(R.string.consent_body)
                .setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.accept, (dialog, which) -> {
                    if (!preferences.setEnabled(true)) { storageFailure(); refresh(); return; }
                    refresh();
                    if (!accessibilityEnabled()) launch(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
                }).show();
    }

    @Override protected void onResume() { super.onResume(); if (preferences != null) refresh(); }

    private void refresh() {
        status.setText(!preferences.enabled() ? R.string.paused
                : accessibilityEnabled() ? R.string.configured : R.string.needs_accessibility);
        activate.setEnabled(!preferences.enabled() || !accessibilityEnabled());
        int result = switch (preferences.lastResult()) {
            case "checked" -> R.string.checked;
            case "requested" -> R.string.requested;
            case "failed" -> R.string.failed;
            case "unsupported" -> R.string.unsupported;
            case "connected" -> R.string.connected;
            case "paused" -> R.string.paused;
            case "stopped" -> R.string.stopped;
            default -> R.string.not_yet;
        };
        last.setText(getString(R.string.last_action, getString(result)));
    }

    private boolean accessibilityEnabled() {
        AccessibilityManager manager = getSystemService(AccessibilityManager.class);
        if (manager == null) return false;
        for (AccessibilityServiceInfo info : manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)) {
            android.content.pm.ServiceInfo service = info.getResolveInfo().serviceInfo;
            if (getPackageName().equals(service.packageName)
                    && SupportAccessibilityService.class.getName().equals(service.name)) return true;
        }
        return false;
    }

    private TextView text(LinearLayout column, String value, int size) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(Color.rgb(25, 55, 42));
        view.setPadding(0, dp(10), 0, dp(10));
        column.addView(view, new LinearLayout.LayoutParams(-1, -2));
        return view;
    }

    private Button button(LinearLayout column, int label, View.OnClickListener listener) {
        Button view = new Button(this);
        view.setText(label);
        view.setAllCaps(false);
        view.setMinHeight(dp(56));
        view.setOnClickListener(listener);
        column.addView(view, new LinearLayout.LayoutParams(-1, -2));
        return view;
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void launch(Intent intent) {
        try { startActivity(intent); } catch (android.content.ActivityNotFoundException error) { unavailable(); }
    }
    private void unavailable() { Toast.makeText(this, R.string.unavailable, Toast.LENGTH_LONG).show(); }
    private void storageFailure() {
        SupportAccessibilityService.disableAfterStorageFailure();
        Toast.makeText(this, R.string.settings_not_saved, Toast.LENGTH_LONG).show();
        launch(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
    }
}
