# Issue 02: session and draft continuity

Status: repeated independent complaint and local risk.

## Operator scenario

A server enters a second round or an open account. The app closes, refreshes or returns to login. The server must remember the order and enter it again.

## Independent evidence

| Product    | Language   | Evidence                                                                                   | Source                                                                                                                                |
| ---------- | ---------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Fudo       | Spanish MX | A user reports a session exit during order entry and says the order must be entered again. | App Store MX, 2023-06-01                                                                                                              |
| Fudo       | Spanish MX | A user reports that a refresh or update erases data during entry.                          | App Store MX, 2019-02-09                                                                                                              |
| Fudo       | Spanish MX | A user reports that an Apple update blocks entry and removes some lines.                   | App Store MX, 2022-08-22                                                                                                              |
| Fudo       | Spanish AR | A Capterra review reports an automatic logout on the first order.                          | Capterra MX, 2023-07-19                                                                                                               |
| Odoo       | French     | Users report a logout each time they close the page.                                       | App Store FR, 2026-10-05                                                                                                              |
| Odoo       | French     | Another user reports that login is required each time the app opens.                       | App Store FR, 2026-03-23                                                                                                              |
| Odoo       | Spanish    | A user reports that the session ends often and the app is not usable for long periods.     | App Store MX                                                                                                                          |
| Square     | Spanish MX | A user reports that the session closed and inventory and sales data disappeared.           | App Store MX, 2024-07-11                                                                                                              |
| Clover     | English    | A user reports repeated logout despite a 14-day stay-signed-in setting.                    | Clover Go App Store, US                                                                                                               |
| Square     | English    | A seller lost all open orders after an update to the orders view.                          | [Square Community](https://community.squareup.com/t5/Orders-Menu-Items-Catalog/I-lost-all-open-orders-with-the-new-update/m-p/821799) |
| Clover     | English    | The Orders tab crashed before open orders could be closed.                                 | [Reddit](https://www.reddit.com/r/CloverPOS/comments/1j0paru/orders_app_crashing/)                                                    |
| Lightspeed | English    | A full restaurant lost tabs when the app went black during service.                        | [App Store](https://apps.apple.com/us/app/lightspeed-restaurant-pos-l/id474723658)                                                    |
| Toast      | English    | A handheld lost the KDS and print path at the table.                                       | [Reddit](https://www.reddit.com/r/ToastPOS/comments/1e32cri/handheld_disconnecting_from_internet/)                                    |

## Vendor behavior

**HD:** Fudo and Odoo describe cloud management and mobile access.

The public product pages do not promise draft protection during app restart or update. The reviews show that this promise is necessary for service work.

## Cascade across languages

The Fudo report in Mexico and the Fudo report in Argentina name the same first-order logout. The Odoo French reports repeat the same opening-session failure. The Square and Clover reports add data loss and forced re-login.

The failure crosses product size, market and language. The common condition is a cloud session on a device that staff must use continuously.

The second pass adds a stronger failure mode. The account can disappear after an
**update**, not only after a logout. A durable working copy and a post-update
integrity check are both necessary.

## Umi current flow

**HL:** Umi keeps a local working copy and an encrypted journal.

Evidence:

- `apps/umi-pos/lib/core/storage/local_working_copy.dart`
- `apps/umi-pos/lib/features/offline/offline_journal.dart`
- `apps/umi-pos/test/offline_journal_test.dart`
  - `restart after durable append recovers the same command identity`
- `apps/umi-pos/lib/features/entry/entry_controller.dart`
- `apps/umi-pos/test/entry_controller_offline_test.dart`
  - `offline reopen keeps a valid operator session past the PIN window`

The device report proves an offline cart with four lines and an MXN 415.00 total. A later restart replayed the commands without a second cart.

## Gap

**I:** The journal survives a restart. A queued cart and a split ledger need one explicit restart test together.

**HL:** The first live restart defect is fixed. A queued command whose original
operator session ended now replays under the live session. The original session
stays in the command record for attribution.

The staging queue recovered from two pending commands to three accepted
commands and zero conflicts. See
[Offline replay authority recovery](../../../reports/2026-10-18-offline-replay-authority.md).

The test must prove:

- the same account folio returns;
- each unsent line returns once;
- the current portion and remaining balance return;
- the server answer replaces the local projection;
- a second replay does not duplicate a line or payment.

## Acceptance scenario

1. Open a dine-in account.
2. Add three lines.
3. Set one line to a second seat.
4. Stop the API.
5. Enter a partial payment of MXN 40.
6. Force-stop the app.
7. Start the app with the same trusted device.
8. Confirm the account, three lines, paid amount and remaining balance.
9. Start the API.
10. Confirm one replay and no duplicate.

## Priority

Frequency: 5

User cost: 5

Money risk: 5

Recovery difficulty: 5

Umi fit: 5

Total: 25
