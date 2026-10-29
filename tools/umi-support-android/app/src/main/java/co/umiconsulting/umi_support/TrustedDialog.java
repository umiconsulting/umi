package co.umiconsulting.umi_support;

import java.util.Set;
import java.util.HashSet;
import java.util.Locale;

public final class TrustedDialog {
    public enum Action { NONE, CHECK_ALWAYS, ALLOW }
    private final String title, checkbox, allow, allowUppercase;
    private final Set<String> messages = new HashSet<>();

    public TrustedDialog(String title, String checkbox, String allow, Set<String> messages) {
        this(title, checkbox, allow, messages, Locale.ROOT);
    }

    public TrustedDialog(String title, String checkbox, String allow, Set<String> messages, Locale locale) {
        this.title = title == null ? "" : title;
        this.checkbox = checkbox == null ? "" : checkbox;
        this.allow = allow == null ? "" : allow;
        this.allowUppercase = this.allow.toUpperCase(locale);
        for (String message : messages) if (message != null && !message.isEmpty()) this.messages.add(message);
    }

    public Action nextAction(DialogSnapshot s, boolean enabled) {
        if (!enabled || s == null || !s.platformSigned || s.windowId < 0
                || !"com.android.systemui".equals(s.packageName)
                || !s.complete || !s.controlsVisible || !s.controlsEnabled
                || !s.checkboxValid || !s.buttonValid
                || title.isEmpty() || checkbox.isEmpty() || allow.isEmpty()
                || !title.equals(s.title)
                || !checkbox.equals(s.checkboxText)
                || !(allow.equals(s.allowText) || allowUppercase.equals(s.allowText))
                || !messages.contains(s.message)) return Action.NONE;
        return s.checkboxChecked ? Action.ALLOW : Action.CHECK_ALWAYS;
    }

}
