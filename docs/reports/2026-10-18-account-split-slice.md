# Account split-check slice

Date: 2026-10-18

## Result

Build 172 adds `Split check` to the open account.

The action opens the existing partial-payment ledger. The operator does not
enter the tender screen first. The action keeps one account and does not create
another check.

## Behavior

- The action is visible when the selected checkout repository supports partial
  payments.
- The action is disabled when the account has no items.
- The action is disabled while a local command is pending.
- The action is disabled when the operator cannot commit checkout.
- A normal `Checkout` action still opens the tender screen.
- A found partial ledger opens on its own.
- A new split from the account opens the partial ledger after the policy and
  recovery reads finish.

## Preserved invariants

- One account ledger remains the financial record.
- A financial split does not send kitchen work again.
- The server owns the partial-payment ledger.
- The existing tender, card, cash, tip, discount, and recovery rules remain.

## Verification

- Flutter suite: **1,072 passed**.
- `flutter analyze`: no issues.
- Focused checkout and cart layout tests passed.
- The tests cover direct split entry, normal checkout, and account action
  reachability at the iMin text size.

## Device proof

The iMin D3 ran the split flow on build 170 at `192.168.0.10`. Build 172 keeps
the same split code and adds line repeat.

1. The account showed `Split check` beside `Checkout`.
2. The action opened `Split payment` directly.
3. The ledger showed `Order total`, `Paid`, `This portion`, `Tip`,
   `Charge now`, and `Remaining`.
4. The ledger showed `MXN 50.00` due and `MXN 50.00` remaining.
5. `Split 2 ways` changed the current portion to `MXN 25.00`.
6. The first cash payment recorded `MXN 25.00`.
7. The ledger showed `MXN 25.00` paid and `MXN 25.00` remaining.
8. The account stayed open after the first payment.
9. The second cash payment closed the account.
10. The receipt screen showed `MXN 50.00` paid and received.

Evidence:

- [Split check on the account](evidence/2026-10-18-account-first-interaction/05-split-check-action.png)
- [Split-payment ledger](evidence/2026-10-18-account-first-interaction/06-split-ledger.png)
- [Two-way split](evidence/2026-10-18-account-first-interaction/07-split-2-ways.png)
- [First payment recorded](evidence/2026-10-18-account-first-interaction/08-partial-payment-recorded.png)
- [Account closed](evidence/2026-10-18-account-first-interaction/09-full-payment-complete.png)

## Staging recovery reset

The device held an old local validation conflict. The server also held a
sequence gap. The action `Confirm reconciliation` did not record an
acknowledgement.

The reset kept evidence and removed only the staging replay lane:

- The database dump is on the VPS at
  `/home/juan/umi-backups/umipos-staging-offline-before-reset-20261018T2108Z.sql`.
- The device copy of the preferences is at
  `shared_prefs/FlutterSharedPreferences.before-journal-reset-20261018.xml`.
- The reset removed the device journal from the app preferences.
- The reset removed the staging replay commands and conflicts for device
  `143e6ca9-631c-4f4e-acc4-fa7d416a9605`.

The iMin returned to `Online` with no unsynced badge.

## Artifact

`apps/umi-pos/build/app/outputs/flutter-apk/app-staging-lan-host-b172.apk`

SHA-256:
`391256b5f0c076dda9ee58f986f387b9cc03e576b8b8990e8bdff067ba3b47e0`

## Residual risk

- The staging location offered no tip input in this path. The zero-tip path is
  verified. A tip entry on this device remains unverified.
- The Recovery Center acknowledgement defect needs a focused fix and test.
