package co.umiconsulting.umi_support;

import java.util.Set;
import java.util.HashSet;
import java.util.Locale;

final class TrustedNetworkMessages {
    interface Formatter { String format(String ssid, String bssid); }
    static final String SSID = "UmiPOS";
    static final String BSSID = "bc:07:1d:ca:ae:61";

    static Set<String> build(Formatter formatter) {
        Set<String> messages = new HashSet<>();
        for (String ssid : new String[]{SSID, "\"" + SSID + "\""}) {
            for (String bssid : new String[]{BSSID, BSSID.toUpperCase(Locale.ROOT)}) {
                String message = formatter.format(ssid, bssid);
                String otherSsid = "UMI_SUPPORT_OTHER_SSID";
                String otherBssid = "00:00:00:00:00:01";
                requireField(message, ssid);
                requireField(message, bssid);
                String ssidProbe = formatter.format(otherSsid, bssid);
                String bssidProbe = formatter.format(ssid, otherBssid);
                requireField(ssidProbe, otherSsid);
                requireField(ssidProbe, bssid);
                requireField(bssidProbe, ssid);
                requireField(bssidProbe, otherBssid);
                if (ssidProbe.contains(ssid) || bssidProbe.contains(bssid)
                        || !ssidProbe.equals(message.replace(ssid, otherSsid))
                        || !bssidProbe.equals(message.replace(bssid, otherBssid))) {
                    throw new IllegalArgumentException("Network fields are not substituted");
                }
                messages.add(message);
            }
        }
        return messages;
    }

    private static void requireField(String text, String field) {
        if (text == null) throw new IllegalArgumentException("Missing network message");
        int at = text.indexOf(field);
        if (at < 0 || text.indexOf(field, at + field.length()) >= 0) {
            throw new IllegalArgumentException("Missing or repeated network field");
        }
    }
}
