package co.umiconsulting.umi_support;

import org.junit.Test;
import java.util.ArrayList;
import java.util.List;
import static org.junit.Assert.*;
import static co.umiconsulting.umi_support.TrustedDialog.Action.*;
import static co.umiconsulting.umi_support.RecoveryEngine.Result.*;

public final class RecoveryEngineTest {
    static final class Screen implements RecoveryEngine.Ui {
        DialogFixture view = new DialogFixture();
        DialogFixture replacement;
        int reads;
        boolean clickWorks = true;
        final List<TrustedDialog.Action> clicks = new ArrayList<>();
        @Override public DialogSnapshot snapshot() {
            reads++;
            return replacement != null && reads % 2 == 0 ? replacement.build() : view.build();
        }
        @Override public boolean perform(TrustedDialog.Action action, DialogSnapshot expected) {
            assertEquals(view.window, expected.windowId);
            clicks.add(action);
            if (clickWorks && action == CHECK_ALWAYS) view.checked = true;
            return clickWorks;
        }
    }
    @Test public void checksThenAllowsOnASeparateFreshRead() {
        Screen s = new Screen(); RecoveryEngine e = new RecoveryEngine(DialogFixture.policy());
        assertEquals(CHECKED, e.tick(s, 1000, true));
        assertEquals(List.of(CHECK_ALWAYS), s.clicks);
        assertEquals(REQUESTED, e.tick(s, 1700, true));
        assertEquals(List.of(CHECK_ALWAYS, ALLOW), s.clicks);
        assertTrue(s.reads >= 4);
    }
    @Test public void alreadyCheckedDoesNotToggleTheCheckbox() {
        Screen s = new Screen(); s.view.checked = true;
        assertEquals(REQUESTED, new RecoveryEngine(DialogFixture.policy()).tick(s, 1000, true));
        assertEquals(List.of(ALLOW), s.clicks);
    }
    @Test public void repeatedEventsCannotApproveTwice() {
        Screen s = new Screen(); s.view.checked = true;
        RecoveryEngine e = new RecoveryEngine(DialogFixture.policy());
        e.tick(s, 1000, true); e.tick(s, 1001, true); e.tick(s, 1800, true);
        assertEquals(List.of(ALLOW), s.clicks);
    }
    @Test public void duplicateEventDoesNotReportThatSuccessfulApprovalExhaustedItsBudget() {
        Screen s = new Screen(); s.view.checked = true;
        RecoveryEngine e = new RecoveryEngine(DialogFixture.policy());
        assertEquals(REQUESTED, e.tick(s, 1000, true));
        assertEquals(ALREADY_REQUESTED, e.tick(s, 1800, true));
    }
    @Test public void pauseBetweenCheckboxAndAllowPreventsApproval() {
        Screen s = new Screen(); RecoveryEngine e = new RecoveryEngine(DialogFixture.policy());
        e.tick(s, 1000, true); e.tick(s, 2000, false);
        assertEquals(List.of(CHECK_ALWAYS), s.clicks);
    }
    @Test public void changedNetworkBeforeClickPreventsAllActions() {
        Screen s = new Screen(); s.replacement = new DialogFixture();
        s.replacement.message = s.replacement.message.replace("ae:61", "ae:62");
        new RecoveryEngine(DialogFixture.policy()).tick(s, 1000, true);
        assertTrue(s.clicks.isEmpty());
    }
    @Test public void changedWindowBeforeClickPreventsAllActions() {
        Screen s = new Screen(); s.replacement = new DialogFixture(); s.replacement.window = 8;
        new RecoveryEngine(DialogFixture.policy()).tick(s, 1000, true);
        assertTrue(s.clicks.isEmpty());
    }
    @Test public void uncheckedBoxCannotLeadToAllowAfterFailedClick() {
        Screen s = new Screen(); s.clickWorks = false;
        RecoveryEngine e = new RecoveryEngine(DialogFixture.policy());
        assertEquals(CLICK_FAILED, e.tick(s, 1000, true));
        e.tick(s, 2000, true);
        assertFalse(s.clicks.contains(ALLOW));
    }
    @Test public void eventsInsideTheCooldownDoNotClick() {
        Screen s = new Screen(); RecoveryEngine e = new RecoveryEngine(DialogFixture.policy());
        e.tick(s, 1000, true); e.tick(s, 1001, true);
        assertEquals(List.of(CHECK_ALWAYS), s.clicks);
    }
    @Test public void failedClicksHaveAFiniteLimitPerWindow() {
        Screen s = new Screen(); s.clickWorks = false;
        RecoveryEngine e = new RecoveryEngine(DialogFixture.policy());
        for (int i = 0; i < 30; i++) e.tick(s, 1000 + i * 700, true);
        assertEquals(6, s.clicks.size());
    }
    @Test public void expiredWindowDoesNotRetryForever() {
        Screen s = new Screen(); s.clickWorks = false;
        RecoveryEngine e = new RecoveryEngine(DialogFixture.policy());
        e.tick(s, 1000, true); e.tick(s, 32000, true);
        assertEquals(1, s.clicks.size());
    }
    @Test public void newlyOpenedTrustedWindowHasItsOwnBudget() {
        Screen s = new Screen(); s.view.checked = true;
        RecoveryEngine e = new RecoveryEngine(DialogFixture.policy());
        e.tick(s, 1000, true); s.view.window = 9; e.tick(s, 2000, true);
        assertEquals(List.of(ALLOW, ALLOW), s.clicks);
    }
}
