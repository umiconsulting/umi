package co.umiconsulting.umi_support;

/** Datos mínimos de una ventana. No se conservan textos de otras aplicaciones. */
public final class DialogSnapshot {
    public final String packageName, title, message, checkboxText, allowText;
    public final int windowId;
    public final boolean platformSigned, complete, controlsVisible, controlsEnabled;
    public final boolean checkboxValid, checkboxChecked, buttonValid;

    public DialogSnapshot(String packageName, int windowId, boolean platformSigned,
            String title, String message, String checkboxText, String allowText,
            boolean complete, boolean controlsVisible, boolean controlsEnabled,
            boolean checkboxValid, boolean checkboxChecked, boolean buttonValid) {
        this.packageName = packageName;
        this.windowId = windowId;
        this.platformSigned = platformSigned;
        this.title = title;
        this.message = message;
        this.checkboxText = checkboxText;
        this.allowText = allowText;
        this.complete = complete;
        this.controlsVisible = controlsVisible;
        this.controlsEnabled = controlsEnabled;
        this.checkboxValid = checkboxValid;
        this.checkboxChecked = checkboxChecked;
        this.buttonValid = buttonValid;
    }
}
