package co.umiconsulting.umi_support;

import android.accessibilityservice.AccessibilityService;
import android.annotation.SuppressLint;
import android.content.pm.PackageManager;
import android.content.res.Resources;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/** Adaptador de la ventana activa. Sólo examina los cuatro controles de SystemUI. */
final class SystemDialogReader implements RecoveryEngine.Ui {
    static final String SYSTEM_UI = "com.android.systemui";
    private static final String TITLE_ID = "android:id/alertTitle";
    private static final String MESSAGE_ID = "android:id/message";
    private static final String CHECK_ID = "android:id/alwaysUse";
    private static final String ALLOW_ID = "android:id/button1";
    private final AccessibilityService service;
    private final SupportPreferences preferences;
    final TrustedDialog policy;

    SystemDialogReader(AccessibilityService service, SupportPreferences preferences)
            throws PackageManager.NameNotFoundException {
        this.service = service;
        this.preferences = preferences;
        PackageManager pm = service.getPackageManager();
        if (pm.checkSignatures("android", SYSTEM_UI) != PackageManager.SIGNATURE_MATCH) {
            throw new SecurityException("Unverified SystemUI signer");
        }
        Resources r = pm.getResourcesForApplication(SYSTEM_UI);
        int messageId = id(r, "wifi_debugging_message");
        Set<String> messages = TrustedNetworkMessages.build((ssid, bssid) -> r.getString(messageId, ssid, bssid));
        policy = new TrustedDialog(r.getString(id(r, "wifi_debugging_title")),
                r.getString(id(r, "wifi_debugging_always")),
                r.getString(id(r, "wifi_debugging_allow")), messages,
                r.getConfiguration().getLocales().get(0));
    }

    @SuppressLint("DiscouragedApi") // Los IDs pertenecen al SystemUI instalado, no al R de esta aplicación.
    private static int id(Resources resources, String name) {
        int value = resources.getIdentifier(name, "string", SYSTEM_UI);
        if (value == 0) throw new Resources.NotFoundException(name);
        return value;
    }

    @Override public DialogSnapshot snapshot() {
        try (Nodes nodes = open()) { return nodes == null ? null : nodes.snapshot(); }
    }

    @Override public boolean perform(TrustedDialog.Action action, DialogSnapshot expected) {
        if (action == TrustedDialog.Action.NONE || expected == null) return false;
        try (Nodes nodes = open()) {
            if (nodes == null) return false;
            DialogSnapshot fresh = nodes.snapshot();
            if (fresh.windowId != expected.windowId
                    || policy.nextAction(fresh, preferences.enabled()) != action) return false;
            AccessibilityNodeInfo target = action == TrustedDialog.Action.CHECK_ALWAYS
                    ? nodes.checkbox : nodes.allow;
            return target.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        }
    }

    private Nodes open() {
        AccessibilityNodeInfo root = service.getRootInActiveWindow();
        if (root == null) return null;
        Nodes nodes = new Nodes(root);
        if (!SYSTEM_UI.contentEquals(root.getPackageName() == null ? "" : root.getPackageName())) {
            nodes.close();
            return null;
        }
        try {
            nodes.title = nodes.one(TITLE_ID);
            nodes.message = nodes.one(MESSAGE_ID);
            nodes.checkbox = nodes.one(CHECK_ID);
            nodes.allow = nodes.one(ALLOW_ID);
            if (nodes.title == null || nodes.message == null || nodes.checkbox == null || nodes.allow == null) {
                nodes.close();
                return null;
            }
            return nodes;
        } catch (RuntimeException error) {
            nodes.close();
            throw error;
        }
    }

    @SuppressWarnings("deprecation") // Android 11 requiere liberar estos nodos.
    private static final class Nodes implements AutoCloseable {
        final AccessibilityNodeInfo root;
        final List<AccessibilityNodeInfo> obtained = new ArrayList<>();
        AccessibilityNodeInfo title, message, checkbox, allow;
        Nodes(AccessibilityNodeInfo root) { this.root = root; }
        AccessibilityNodeInfo one(String id) {
            List<AccessibilityNodeInfo> found = root.findAccessibilityNodeInfosByViewId(id);
            if (found == null) return null;
            obtained.addAll(found);
            return found.size() == 1 ? found.get(0) : null;
        }
        DialogSnapshot snapshot() {
            boolean visible = root.isVisibleToUser();
            boolean enabled = true;
            boolean sameWindow = root.getWindowId() >= 0;
            for (AccessibilityNodeInfo node : new AccessibilityNodeInfo[]{title, message, checkbox, allow}) {
                visible &= node.isVisibleToUser();
                enabled &= node.isEnabled();
                sameWindow &= node.getWindowId() == root.getWindowId()
                        && SYSTEM_UI.contentEquals(node.getPackageName() == null ? "" : node.getPackageName());
            }
            return new DialogSnapshot(SYSTEM_UI, root.getWindowId(), true,
                    text(title), text(message), text(checkbox), text(allow), sameWindow, visible, enabled,
                    "android.widget.CheckBox".contentEquals(checkbox.getClassName())
                            && checkbox.isCheckable() && checkbox.isClickable(),
                    checkbox.isChecked(),
                    "android.widget.Button".contentEquals(allow.getClassName()) && allow.isClickable());
        }
        private static String text(AccessibilityNodeInfo node) {
            return node.getText() == null ? "" : node.getText().toString();
        }
        @Override public void close() {
            for (AccessibilityNodeInfo node : obtained) node.recycle();
            root.recycle();
        }
    }
}
