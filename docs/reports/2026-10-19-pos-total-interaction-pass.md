# UmiPOS total interaction pass — 19 October 2026

Status: `PARTIAL PASS — CRITICAL BLOCKERS FIXED; REMAINING BLOCKERS LISTED`

Device: iMin D3-504, staging package `co.umiconsulting.umi_pos.clean`.
Build under test: 210 for the interaction pass; 211 for the checkout-clear and
refund-message fixes.

## Result

The happy path is fast and the main tender screen is clear. A real split payment
completed with MXN 55.00 on an external terminal and MXN 55.00 by bank transfer.
The receipt and completed sale were visible and consistent.

The till is not yet free of blockers. A local command can remain queued while the
screen looks idle, and the queue then disables every write control. Cash checkout
also failed with a generic message after the register and shift were corrected.
The full random combination pass therefore remains incomplete.

## Passed flows

| Flow | Evidence | Result |
| --- | --- | --- |
| Add two products to a fresh account | `06-two-items.png` | Pass |
| Fire the account to the kitchen | Server kitchen order `queued` | Pass |
| Open split payment | `01-split-start.png` | Pass |
| Charge MXN 55.00 on external terminal | Terminal confirmation | Pass |
| Charge remaining MXN 55.00 by transfer | `02-split-paid.png` | Pass |
| Show receipt and completed sale | `03-receipt.png` | Pass |
| Select the active account while local work is pending | Previous account-020 regression | Pass |
| Preserve KDS checkmarks across server reads and rapid taps | Previous KDS regression | Pass |

## Fixed in this pass

1. A completed checkout now clears the local cart even if the sale lifecycle
   controller missed the `checkingOut -> committed` transition. Before this
   change, a paid account remained editable and offered `Cobrar` again.
2. Bank-transfer refunds now name the required support route instead of using
   the generic “does not meet a refund rule” message.

## Remaining blockers

| Severity | Finding | User consequence | Evidence |
| --- | --- | --- | --- |
| Critical | A queued local command can leave `isWriting` true indefinitely. Save, split, charge, edit, repeat and remove are all disabled. Restarting the app settled the queue. | The operator sees a frozen account and cannot continue or charge. | Rapid quantity and fire tests |
| Critical | Cash checkout returned “No fue posible completar el cobro de forma segura” after a register was assigned and a MXN 200 shift was opened. | The final cash step cannot complete and the message does not identify the cause. | `05-cash-checkout-failed.png` |
| High | The KDS board showed no ticket although the server reported the Cuenta 021 kitchen order as `queued`. The screen was not assigned to a station. | A cook can believe the kitchen has no work while an order is waiting. | KDS device-state test |
| High | A paid account was still painted locally as `draft` after the server committed the sale. | Recharge risk and repeated red errors on later edits. | Fixed in code; automated test passes; device verification awaits the queue fix |
| Medium | After the first split leg, payment-method controls move below the fold with no visible scroll cue. | The operator appears to lose the remaining payment methods. | Split flow |
| Medium | Refunds and voids combine permission, tender and support rules. The generic blocked screen did not explain the rule that failed. | Staff do not know whether to refresh, ask a manager or contact support. | `04-refund-blocked.png` |
| Medium | Double clicking a product with options is safe because it opens the options sheet, but repeated writes can still enter the transient “Revisión necesaria” state. | The screen briefly disables work and can lose local edits after restart. | Rapid quantity test |
| Unverified | Table move/merge/split and post-sale refund completion were not completed because the branch room was fully occupied and the transfer sale requires support. | These flows still need a clean fixture and a second operator for approval. | Manual pass log |

## Required next actions

1. Make the local command queue self-heal while the operator stays on the
   screen. A retry must not wait for app restart, and a transient retry must not
   disable line-level work.
2. Identify and surface the exact cash-checkout refusal code. Do not leave the
   operator with only “No fue posible”.
3. Prove the KDS station scope on a device assigned to the ticket’s station.
4. Re-run the full pass on a clean fixture with two operators so manager
   approval, refund, void, table move, merge and split can complete.
5. Keep the paid-cart clear assertion in the release gate. It is covered by
   `sale_lifecycle_test.dart`.

## Verification run

- `flutter analyze`: no issues.
- `checkout_test.dart`: 41 passed.
- `sale_exception_test.dart`: 22 passed.
- `sale_lifecycle_test.dart`: 65 passed.
- `cart_command_queue_test.dart`: 12 passed.
- `open_accounts_test.dart`: 24 passed.

