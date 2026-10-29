# Account-first interaction slice

Date: 2026-10-18

## Result

Build 169 implements the first account-first interaction slice on the iMin.

The new flow has one start action. The action asks where the order is served.
Dine in chooses the table before the first product. Takeaway stays tableless.
Occupied tables show their account folio. The table panel shows one primary
action for the current state.

## Implemented

- Replaced `New account` with `Start order`.
- Replaced `New account without table` in Accounts with `Start order`.
- Added a service-context dialog with `Dine in` and `Takeaway`.
- Added table selection before a dine-in account opens.
- Added the open account folio to occupied table cards.
- Added the open account folio to the table detail and selected summary.
- Added state-ranked primary table actions:
  - account open: `Resume account`;
  - guests present without an account: `Open account`;
  - free table: `Seat`;
  - dirty table: `Mark ready`.
- Kept secondary table actions with lower visual weight.
- Kept the existing server-owned `dine_in` and `takeout` fulfillment values.
- Kept one account ledger and the existing table-state rules.

## Verification

- Flutter suite: **1,064 passed**.
- `flutter analyze`: no issues.
- Focused table, account, order-entry and role-surface tests passed.
- API not changed.

## Device proof

The iMin ran build 169 at `192.168.0.10`.

1. The Order screen showed `Start order`.
2. The action opened `Where is this order served?`.
3. `Dine in` opened the table picker.
4. The test cancelled the picker and returned to the clean Order screen.

Evidence:

- [Start order action](evidence/2026-10-18-account-first-interaction/01-start-order-action.png)
- [Service context](evidence/2026-10-18-account-first-interaction/02-service-context.png)
- [Table choice](evidence/2026-10-18-account-first-interaction/03-table-choice.png)
- [Clean order screen](evidence/2026-10-18-account-first-interaction/04-clean-order-screen.png)

## Artifact

`apps/umi-pos/build/app/outputs/flutter-apk/app-staging-lan-host-b169.apk`

SHA-256:
`03583222c4cad997872525834f0e425c0b25ee11bc401809bc911b4568d6042f`

## Still open

- Add the line action sheet.
- Add line-level move where the contract supports it.
- Add account totals to the table map.
- Continue Stage 1 with the line-edit slice.
- Continue the cascading competitor review pass in Stage 2.

The account split action is now implemented. See
[the split slice](2026-10-18-account-split-slice.md). The review pass started
in [customer review cascade](../research/2026-10-18-customer-review-cascade/README.md).
