package co.umiconsulting.umi_support;

public final class RecoveryEngine {
    public interface Ui {
        DialogSnapshot snapshot();
        boolean perform(TrustedDialog.Action action, DialogSnapshot expected);
    }
    public enum Result { IDLE, WAITING, CHECKED, REQUESTED, ALREADY_REQUESTED, CLICK_FAILED, STOPPED }
    private final TrustedDialog policy;
    private int windowId = -1;
    private long startedAt, lastClickAt;
    private int attempts;
    private boolean requested;

    public RecoveryEngine(TrustedDialog policy) { this.policy = policy; }

    public Result tick(Ui ui, long nowMillis, boolean enabled) {
        if (!enabled) return Result.IDLE;
        DialogSnapshot first = ui.snapshot();
        TrustedDialog.Action action = policy.nextAction(first, true);
        if (action == TrustedDialog.Action.NONE) return Result.IDLE;
        if (first.windowId != windowId) {
            windowId = first.windowId;
            startedAt = nowMillis;
            attempts = 0;
            requested = false;
        }
        if (requested) return Result.ALREADY_REQUESTED;
        if (attempts >= 6 || nowMillis - startedAt > 30000) return Result.STOPPED;
        if (attempts > 0 && nowMillis - lastClickAt < 600) return Result.WAITING;
        DialogSnapshot fresh = ui.snapshot();
        if (fresh == null || fresh.windowId != windowId
                || policy.nextAction(fresh, true) != action) return Result.IDLE;
        attempts++;
        lastClickAt = nowMillis;
        if (!ui.perform(action, fresh)) return Result.CLICK_FAILED;
        if (action == TrustedDialog.Action.CHECK_ALWAYS) return Result.CHECKED;
        requested = true;
        return Result.REQUESTED;
    }
}
