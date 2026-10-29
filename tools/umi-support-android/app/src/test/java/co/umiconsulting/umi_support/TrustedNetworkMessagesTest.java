package co.umiconsulting.umi_support;

import org.junit.Test;
import java.util.Locale;
import java.util.Set;
import static org.junit.Assert.*;

public final class TrustedNetworkMessagesTest {
    private static final String TEMPLATE = "Network Name (SSID)\n%1$s\n\nWi-Fi Address (BSSID)\n%2$s";
    @Test public void buildsTheCompleteQuotedNetworkMessage() {
        Set<String> messages = TrustedNetworkMessages.build((s, b) -> String.format(Locale.ROOT, TEMPLATE, s, b));
        assertTrue(messages.contains(DialogFixture.MESSAGE));
        assertTrue(messages.contains("Network Name (SSID)\nUmiPOS\n\nWi-Fi Address (BSSID)\nBC:07:1D:CA:AE:61"));
    }
    @Test public void aTemplateWithoutBssidCannotAuthorizeAnyNetwork() {
        assertThrows(IllegalArgumentException.class,
                () -> TrustedNetworkMessages.build((s, b) -> "Network " + s));
    }
    @Test public void aTemplateWithoutSsidCannotAuthorizeAnyNetwork() {
        assertThrows(IllegalArgumentException.class,
                () -> TrustedNetworkMessages.build((s, b) -> "Address " + b));
    }
    @Test public void hardcodedFieldsCannotImitateAnInterpolatedNetwork() {
        assertThrows(IllegalArgumentException.class,
                () -> TrustedNetworkMessages.build((s, b) -> DialogFixture.MESSAGE));
    }
    @Test public void duplicatedFieldsAreNotRecognized() {
        assertThrows(IllegalArgumentException.class,
                () -> TrustedNetworkMessages.build((s, b) -> s + " " + b + " " + b));
    }
    @Test public void aFormatterThatReplacesTheNetworkIdentityIsRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> TrustedNetworkMessages.build((s, b) -> s.toLowerCase(Locale.ROOT) + " " + b));
    }
    @Test public void aMissingFormattedMessageIsRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> TrustedNetworkMessages.build((s, b) -> null));
    }
    @Test public void paddingCannotMakeDifferentSsidValuesIndistinguishable() {
        assertThrows(IllegalArgumentException.class,
                () -> TrustedNetworkMessages.build((s, b) -> String.format(Locale.ROOT, "%1$20s %2$s", s, b)));
    }
}
