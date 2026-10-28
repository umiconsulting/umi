package co.umiconsulting.umi_support;

import org.junit.Test;
import static org.junit.Assert.*;

public final class OwnerConsentTest {
    static final class PreferenceStore implements OwnerConsent.Store {
        boolean memory, disk, fail;
        @Override public boolean enabled() { return memory; }
        @Override public boolean write(boolean enabled) {
            memory = enabled;
            if (fail) return false;
            disk = enabled;
            return true;
        }
    }
    @Test public void aNewInstallationStartsPaused() {
        assertFalse(new OwnerConsent(new PreferenceStore()).enabled());
    }
    @Test public void aSuccessfulDecisionIsPersisted() {
        PreferenceStore store = new PreferenceStore(); OwnerConsent consent = new OwnerConsent(store);
        assertTrue(consent.setEnabled(true));
        assertTrue(consent.enabled()); assertTrue(store.disk);
    }
    @Test public void failedActivationCannotEnableTheServiceInMemory() {
        PreferenceStore store = new PreferenceStore(); store.fail = true;
        OwnerConsent consent = new OwnerConsent(store);
        assertFalse(consent.setEnabled(true));
        assertFalse(consent.enabled()); assertFalse(store.disk);
    }
    @Test public void failedPauseIsReportedSoTheCallerMustDisableAccessibility() {
        PreferenceStore store = new PreferenceStore(); store.memory = true; store.disk = true; store.fail = true;
        OwnerConsent consent = new OwnerConsent(store);
        assertFalse(consent.setEnabled(false));
        assertFalse(consent.enabled()); assertTrue(store.disk);
    }
}
