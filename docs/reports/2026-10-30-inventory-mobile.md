# Inventory editor mobile access

Base: `45c4955c`. Branch: `fix/inventory-mobile-access`.

## Causes and correction

The action bar kept its desktop width on phones. At 390 pixels, only 15.9% of the new-item button was inside the viewport.
The list also clipped the row menus. The action bar now wraps, and row actions use a second line on phones.
View filters keep their own horizontal scroll area.

The detail panel used a portal outside the isolated main content. The editor stayed inside that content, behind the panel.
The editor now uses a portal in the same document layer, above the detail panel.
Cancel returns to the existing detail without a write.
While the editor is open, Ctrl/Cmd+K preserves its focus. It does not open a command search behind the form.

## Evidence

- The browser regression failed before the change because the new-item button was outside the viewport.
- A second failure reproduced the detail panel blocking the editor's Cancel button.
- Real Chromium clicks passed at 320, 390, 720, and 1440 pixels, including a return from desktop to mobile.
- Each size exercised New item, Cancel, the row menu, Edit item, and editing from the detail panel.
- A new item saved from mobile persisted through the real local API. The run sent exactly one write command.
- All cancellation paths sent no write command.
- The controller inspected screenshots at 320, 390, and 1440 pixels.
- The dashboard baseline passed 452 tests before the correction.
- The final dashboard suite passed all 452 tests. Build and lint passed with 68 existing warnings.
- The committed Playwright test passed in 4.8 seconds. `check:pr` passed with no applied migration changes.
- Review found the global command shortcut could focus a hidden search behind the editor portal.
- The new browser assertion reproduced that failure before the shortcut guard was added.
- After the guard, the complete browser test passed in 4.9 seconds. Both Ctrl+K and Cmd+K preserve editor focus.
- The command search still opens after the editor closes. Escape closes the visible layer in one step.
- The final affected build, lint, and 452 tests passed after this correction.

The reusable test is `apps/umi-dashboard/e2e/inventory-mobile.pw.js`.
It requires `UMI_MOBILE_FIXTURE`, a local owner fixture with existing inventory, and Chromium through CDP.
The fixture must contain `email`, `password`, `merchantId`, and `locationId`, with the item `Café ajuste decimal`.
Keep credentials outside Git. Set `UMI_MOBILE_BASE` and `UMI_INVENTORY_CDP` to select the local services.

Tools: Playwright, Chromium 153, pnpm 10.29.3, Node 22.23.3, and the repository verification scripts.
The test uses a separate browser context and preserves the existing preview sessions.

This PR requires approval before merge. It changes no backend or inventory policy.
