package co.umiconsulting.umi_support;

import org.junit.Test;
import static org.junit.Assert.assertEquals;
import static co.umiconsulting.umi_support.TrustedDialog.Action.*;

public final class TrustedDialogTest {
    private final TrustedDialog policy = DialogFixture.policy();
    @Test public void checksOnlyTheTrustedNetworkBeforeAllowing() {
        assertEquals(CHECK_ALWAYS, policy.nextAction(new DialogFixture().build(), true));
    }
    @Test public void allowsOnlyAfterTheCheckboxIsChecked() {
        DialogFixture f = new DialogFixture(); f.checked = true;
        assertEquals(ALLOW, policy.nextAction(f.build(), true));
    }
    @Test public void pausePreventsAllActions() {
        assertEquals(NONE, policy.nextAction(new DialogFixture().build(), false));
    }
    @Test public void missingWindowPreventsActions() {
        assertEquals(NONE, policy.nextAction(null, true));
    }
    @Test public void otherPackageCannotImitateTheDialog() {
        DialogFixture f = new DialogFixture(); f.pkg = "example.fake";
        assertEquals(NONE, policy.nextAction(f.build(), true));
    }
    @Test public void unverifiedPlatformSignaturePreventsActions() {
        DialogFixture f = new DialogFixture(); f.signed = false;
        assertEquals(NONE, policy.nextAction(f.build(), true));
    }
    @Test public void similarSsidCannotMatch() {
        DialogFixture f = new DialogFixture(); f.message = f.message.replace("UmiPOS", "UmiPOS-Guest");
        assertEquals(NONE, policy.nextAction(f.build(), true));
    }
    @Test public void anotherAccessPointCannotMatchEvenWithTheSameSsid() {
        DialogFixture f = new DialogFixture(); f.message = f.message.replace("ae:61", "ae:62");
        assertEquals(NONE, policy.nextAction(f.build(), true));
    }
    @Test public void messageSuffixCannotMatch() {
        DialogFixture f = new DialogFixture(); f.message += " another network";
        assertEquals(NONE, policy.nextAction(f.build(), true));
    }
    @Test public void usbDebuggingTitleCannotMatch() {
        DialogFixture f = new DialogFixture(); f.title = "Allow USB debugging?";
        assertEquals(NONE, policy.nextAction(f.build(), true));
    }
    @Test public void duplicateOrTruncatedNodesPreventActions() {
        DialogFixture f = new DialogFixture(); f.complete = false;
        assertEquals(NONE, policy.nextAction(f.build(), true));
    }
    @Test public void hiddenControlsPreventActions() {
        DialogFixture f = new DialogFixture(); f.visible = false;
        assertEquals(NONE, policy.nextAction(f.build(), true));
    }
    @Test public void disabledControlsPreventActions() {
        DialogFixture f = new DialogFixture(); f.enabled = false;
        assertEquals(NONE, policy.nextAction(f.build(), true));
    }
    @Test public void unexpectedCheckboxPreventsActions() {
        DialogFixture f = new DialogFixture(); f.checkboxValid = false;
        assertEquals(NONE, policy.nextAction(f.build(), true));
    }
    @Test public void unexpectedButtonPreventsActions() {
        DialogFixture f = new DialogFixture(); f.buttonValid = false;
        assertEquals(NONE, policy.nextAction(f.build(), true));
    }
    @Test public void wrongCheckboxLabelPreventsActions() {
        DialogFixture f = new DialogFixture(); f.checkbox = "Always trust this computer";
        assertEquals(NONE, policy.nextAction(f.build(), true));
    }
    @Test public void wrongButtonLabelPreventsActions() {
        DialogFixture f = new DialogFixture(); f.allow = "Install";
        assertEquals(NONE, policy.nextAction(f.build(), true));
    }
    @Test public void missingWindowIdPreventsActions() {
        DialogFixture f = new DialogFixture(); f.window = -1;
        assertEquals(NONE, policy.nextAction(f.build(), true));
    }
    @Test public void whitespaceChangesCannotAlterTheTrustedMessage() {
        DialogFixture f = new DialogFixture(); f.message = f.message.replace('\n', ' ');
        assertEquals(NONE, policy.nextAction(f.build(), true));
    }
    @Test public void ssidWithExtraSpacesCannotImitateTheUnquotedVariant() {
        String unquoted = DialogFixture.MESSAGE.replace("\"", "");
        TrustedDialog local = new TrustedDialog(DialogFixture.TITLE, DialogFixture.CHECKBOX,
                DialogFixture.ALLOW, java.util.Set.of(unquoted));
        DialogFixture f = new DialogFixture();
        f.message = unquoted.replace("UmiPOS", " UmiPOS ");
        assertEquals(NONE, local.nextAction(f.build(), true));
    }
    @Test public void materialButtonUppercasePreservesTheTrustedDialog() {
        DialogFixture f = new DialogFixture(); f.allow = "ALLOW";
        assertEquals(CHECK_ALWAYS, policy.nextAction(f.build(), true));
    }
    @Test public void handlesTheActualIminSpanishDialogWithMaterialUppercase() {
        String title = "¿Quieres permitir la depuración inalámbrica en esta red?";
        String message = "Nombre de red (SSID)\n\"UmiPOS\"\n\nDirección Wi‑Fi (BSSID)\nbc:07:1d:ca:ae:61";
        TrustedDialog actual = new TrustedDialog(title, "Permitir siempre en esta red", "Permitir", java.util.Set.of(message));
        DialogSnapshot unchecked = new DialogSnapshot("com.android.systemui", 7, true,
                title, message, "Permitir siempre en esta red", "PERMITIR", true, true, true, true, false, true);
        assertEquals(CHECK_ALWAYS, actual.nextAction(unchecked, true));
        DialogSnapshot checked = new DialogSnapshot("com.android.systemui", 7, true,
                title, message, "Permitir siempre en esta red", "PERMITIR", true, true, true, true, true, true);
        assertEquals(ALLOW, actual.nextAction(checked, true));
    }
    @Test public void arbitraryMixedCaseIsNotAnExpectedMaterialTransformation() {
        DialogFixture f = new DialogFixture(); f.allow = "aLLoW";
        assertEquals(NONE, policy.nextAction(f.build(), true));
    }
    @Test public void materialUppercaseCannotAuthorizeAnotherNetwork() {
        DialogFixture f = new DialogFixture(); f.allow = "ALLOW";
        f.message = f.message.replace("ae:61", "ae:62");
        assertEquals(NONE, policy.nextAction(f.build(), true));
    }
}
