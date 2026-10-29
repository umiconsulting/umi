package co.umiconsulting.umi_support;

import java.util.Set;

final class DialogFixture {
    static final String TITLE = "Allow wireless debugging on this network?";
    static final String CHECKBOX = "Always allow on this network";
    static final String ALLOW = "Allow";
    static final String MESSAGE = "Network Name (SSID)\n\"UmiPOS\"\n\nWi-Fi Address (BSSID)\nbc:07:1d:ca:ae:61";
    static TrustedDialog policy() {
        return new TrustedDialog(TITLE, CHECKBOX, ALLOW, Set.of(MESSAGE));
    }
    String pkg = "com.android.systemui", title = TITLE, message = MESSAGE;
    String checkbox = CHECKBOX, allow = ALLOW;
    int window = 7;
    boolean signed = true, complete = true, visible = true, enabled = true;
    boolean checkboxValid = true, checked = false, buttonValid = true;
    DialogSnapshot build() {
        return new DialogSnapshot(pkg, window, signed, title, message, checkbox, allow,
                complete, visible, enabled, checkboxValid, checked, buttonValid);
    }
}
