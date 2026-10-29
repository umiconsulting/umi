# UmiPOS root-cause pass and final device verification

Date: 2026-10-19

Status: `PASS ON EVERY EXERCISED FLOW`

Device: iMin D3-504, package `co.umiconsulting.umi_pos.clean`.

Build under test: **217** for the flows below. Build **218** carries the startup
restore follow-up.

Current APK: `apps/umi-pos/build/app/outputs/flutter-apk/app-staging-profile.apk`

Current SHA-256:
`e2f0d912e17b8f8a186ae14548cda746d5d75a0f8fad8efdc5e1aa86b0a06ce8`

The flow table below ran on build 217, SHA-256
`f9b30d2647141ba6d0e49dce2e6da3e6c1ddc92074fe19a4601bcc97812e9e72`.

## Result

The intermittent checkmarks, false waiting states, blocked edits and generic
cash failure had one shared origin: the till treated a durable local backlog as
if it were a write currently on the wire. The local queue also retried a stream
whose first command had already been refused for a cart that no longer existed.
Every later command remained `stream_blocked`, and the visible account stayed
disabled even though its current cart was valid.

That chain is now resolved at the state owner:

- local synchronization is status, not a global edit lock;
- a definitely refused cart command is closed without human review when the
  server says the target account does not exist;
- the following commands are replayed under the advanced cursor;
- blocked recovery is no longer re-submitted on every connectivity heartbeat;
- account switching journals painted work before clearing the local lane;
- KDS keeps optimistic work and includes station-less tickets on the
  all-stations view;
- split payment can open before the location policy has loaded, so its first
  use is not disabled;
- a void finishes with void-specific receipt language instead of refund text.

## Device flows completed

| Flow                                                   | Result                 | Evidence                                                                                       |
| ------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------- |
| Stale local queue cleared automatically after restart  | Pass                   | Queue advanced from 5 conflicts to accepted/resolved without manual approval                   |
| Edit and increase quantity while local work is painted | Pass                   | Five rapid taps produced quantity 6; edit, repeat, remove, split and charge stayed interactive |
| Cash checkout                                          | Pass                   | `POST /checkout` 201; paid screen and receipt shown                                            |
| Partial cash refund with manager PIN                   | Pass                   | `EX-0001`, MXN 60.00                                                                           | `09-partial-refund-done.png`     |
| Sale void with manager PIN                             | Pass                   | `EX-0002`, server row `exception_type=void`                                                    | `10-void-done.png`               |
| KDS item ready persists across reads                   | Pass                   | Ready state remained after refresh                                                             |
| KDS start, recall with reason, re-prepare and complete | Pass                   | Ticket returned to preparation and later left the board                                        |
| Move party from Mesa 4 to Mesa 3                       | Pass                   | Timer preserved; Mesa 4 became dirty                                                           | `11-table-moved.png`             |
| Open a temporary tableless account                     | Pass                   | Resumable account with no synthetic floor-table UUID                                           | `07-temporary-table-account.png` |
| KDS all-stations view with queued and cancelled work   | Pass                   | Assigned, cancelled and newly fired tickets visible together                                   | `12-kds-all.png`                 |
| Station-less KDS ticket rendered inline                | Pass                   | Automated widget fixture                                                                       |
| Samsung A9 opens the staged tablet build               | Pass to authentication | `13-a9-login.png`; supplied PIN was not valid for that package/branch                          |

## Verification

- `flutter analyze`: no issues.
- Full Flutter suite: **1109 passed, 0 failed**.
- Targeted suites include cart queue, recovery orchestration, checkout, sale
  exceptions, KDS, table state, open accounts and order-entry flow.
- The temporary staging kitchen/manager permissions used for device verification
  were removed afterwards. The cashier role is back to its original 48 grants.
- The staging exception policy was created so refund and void could be exercised.

## Evidence limits

- The A11 did not accept an ADB connection on `192.168.0.101:41011`.
- The A9 connected and opened the installed tablet build, but the supplied PIN
  was rejected for `co.umiconsulting.umi_pos.estacion` on that device.
- The device KDS board had no live station-less ticket during this continuation.
  Inline display of that projection is covered by the widget test; assigned,
  ready, recalled and completed work was exercised on the device.
- Table merge/split and split payment on the final source are covered by the
  complete automated suite; this continuation exercised table move rather than
  repeating the earlier real split-payment run.

## Startup account restore follow-up (build 218)

Observed on the iMin after sign-in: the order panel showed an empty `Comanda`
with `Nueva venta`. The same panel changed to `Cuenta 018` a short time later.
The visible empty state was not a new account. It was the frame before
`sales.open()` returned the account that was already open.

The race had two layers:

- the surface treated `CartState.idle` as ready while the current-account read
  was still pending;
- `SaleLifecycleController.open()` did not block `newSale()` while it read the
  current account.

Build 218 makes the restore state explicit:

- the panel shows `Recuperando tu cuenta…` and does not offer `Nueva venta`;
- product, account, and table actions explain that the account is still loading;
- `newSale()` returns false while the current-account read is in flight;
- the current-account read and the catalogue load independently, so a slow sale
  answer cannot leave the menu empty.

Verification:

- `flutter analyze`: no issues.
- Full Flutter suite: **1111 passed, 0 failed**.
- New widget test: the startup panel does not offer a new sale while the current
  account is pending, and the two-item account appears after the read completes.
- New controller test: `newSale()` cannot start while `open()` reads the current
  sale.
- iMin cold restart: the empty `Nueva venta` panel no longer appears before
  `Cuenta 018`.
- iMin account list: the `Cuenta 018` row opens the two-item account and shows
  `Guardar y salir`.
- SHA-256 of build 218:
  `e2f0d912e17b8f8a186ae14548cda746d5d75a0f8fad8efdc5e1aa86b0a06ce8`.

Evidence:

- [before](evidence/2026-10-19-pos-total-pass/14-startup-empty-before.png)
- [after](evidence/2026-10-19-pos-total-pass/15-startup-account-018-after.png)
