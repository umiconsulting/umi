package co.umiconsulting.umi_support;

import android.accessibilityservice.AccessibilityService;
import android.content.res.Configuration;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityEvent;
import java.lang.ref.WeakReference;

public final class SupportAccessibilityService extends AccessibilityService {
    private static WeakReference<SupportAccessibilityService> connected = new WeakReference<>(null);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private SupportPreferences preferences;
    private SystemDialogReader reader;
    private RecoveryEngine engine;
    private long scanUntil;
    private boolean scheduled;
    private final Runnable scan = () -> {
        scheduled = false;
        evaluate();
    };

    @Override protected void onServiceConnected() {
        super.onServiceConnected();
        connected = new WeakReference<>(this);
        preferences = new SupportPreferences(this);
        initialize();
        if (engine != null) preferences.record("connected");
        scanUntil = SystemClock.elapsedRealtime() + 30000;
        schedule();
    }

    private void initialize() {
        handler.removeCallbacks(scan);
        scheduled = false;
        try {
            reader = new SystemDialogReader(this, preferences);
            engine = new RecoveryEngine(reader.policy);
        } catch (RuntimeException | android.content.pm.PackageManager.NameNotFoundException error) {
            reader = null;
            engine = null;
            preferences.record("unsupported");
        }
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        if (preferences == null || !SystemDialogReader.SYSTEM_UI.contentEquals(
                event.getPackageName() == null ? "" : event.getPackageName())) return;
        scanUntil = SystemClock.elapsedRealtime() + 30000;
        schedule();
    }

    private void schedule() {
        if (scheduled || engine == null || preferences == null || !preferences.enabled()) return;
        scheduled = true;
        handler.postDelayed(scan, 650);
    }

    private void evaluate() {
        if (engine == null || !preferences.enabled()) return;
        RecoveryEngine.Result result;
        try {
            result = engine.tick(reader, SystemClock.elapsedRealtime(), preferences.enabled());
        } catch (RuntimeException error) {
            preferences.record("failed");
            return;
        }
        switch (result) {
            case CHECKED -> preferences.record("checked");
            case REQUESTED -> preferences.record("requested");
            case ALREADY_REQUESTED -> { return; }
            case CLICK_FAILED -> preferences.record("failed");
            case STOPPED -> { preferences.record("stopped"); return; }
            default -> { }
        }
        if (result != RecoveryEngine.Result.REQUESTED && SystemClock.elapsedRealtime() < scanUntil) schedule();
    }

    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        if (preferences != null) {
            initialize();
            scanUntil = SystemClock.elapsedRealtime() + 30000;
            schedule();
        }
    }

    @Override public void onInterrupt() {
        handler.removeCallbacks(scan);
        scheduled = false;
    }

    @Override public void onDestroy() {
        if (connected.get() == this) connected.clear();
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    static void disableAfterStorageFailure() {
        SupportAccessibilityService active = connected.get();
        if (active != null) {
            active.handler.removeCallbacksAndMessages(null);
            active.disableSelf();
        }
    }
}
