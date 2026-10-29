package co.umiconsulting.umi_support;

/** Mantiene la autorización cerrada cuando el almacenamiento falla. */
final class OwnerConsent {
    interface Store {
        boolean enabled();
        boolean write(boolean enabled);
    }
    private final Store store;
    OwnerConsent(Store store) { this.store = store; }
    boolean enabled() { return store.enabled(); }
    boolean setEnabled(boolean value) {
        if (store.write(value)) return true;
        // commit puede cambiar la memoria aunque falle la escritura al disco.
        store.write(false);
        return false;
    }
}
