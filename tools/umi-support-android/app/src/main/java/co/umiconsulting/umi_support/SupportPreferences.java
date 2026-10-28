package co.umiconsulting.umi_support;

import android.content.Context;
import android.content.SharedPreferences;
import android.provider.Settings;

final class SupportPreferences {
    private final Context context;
    private final SharedPreferences prefs;
    private final OwnerConsent consent;
    SupportPreferences(Context context) {
        this.context = context.createDeviceProtectedStorageContext();
        prefs = this.context.getSharedPreferences("support", Context.MODE_PRIVATE);
        consent = new OwnerConsent(new OwnerConsent.Store() {
            @Override public boolean enabled() { return prefs.getBoolean("owner_enabled", false); }
            @Override public boolean write(boolean value) {
                return prefs.edit().putBoolean("owner_enabled", value).commit();
            }
        });
    }
    boolean enabled() { return consent.enabled(); }
    // La decisión debe persistir antes de abrir los ajustes de Android.
    boolean setEnabled(boolean value) { return consent.setEnabled(value); }
    String lastResult() { return prefs.getString("last_result", "none"); }
    void record(String result) {
        prefs.edit().putString("last_result", result)
                .putLong("last_time", System.currentTimeMillis())
                .putInt("last_boot", Settings.Global.getInt(context.getContentResolver(), "boot_count", -1))
                .apply();
    }
}
