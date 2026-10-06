# Centro de caja — the till cash centre: behaviour, market, and architecture

- Date: 2026-09-29
- Status: Design review. No code change in this increment.
- Scope: the operator-facing cash surface of `apps/umi-pos`
  (`lib/features/cash/*`), the `pos-cash` module of `apps/umi-api`, the
  `merchant.cash_*` schema in `docs/migration/build-v3/33_pos_cash.sql`, and the
  owner view in `apps/umi-dashboard/src/screens/caja-turnos.jsx`.
- Out of scope: card settlement, the exception/refund path, the accounting
  posting, and the loyalty wallet.
- Method: read the code and the schema, then compare with vendor primary
  sources. A second pass read the vendor help pages and independent forums, and
  inspected more than twenty product images. See the companion research
  [Cash centre — vendor documentation, independent forums, and screen
  evidence](../research/2026-09-29-cash-center-vendor-docs-forums-and-screenshots.md).
  Every best element from that research now sits in one screen in
  [superset v1](2026-09-29-centro-de-caja-superset-v1.md) and its
  [rendered artifact](2026-09-29-centro-de-caja-superset.html). The working
  reference implementation is
  [centro-de-caja/](centro-de-caja/index.html); it runs the self-check in
  [its README](centro-de-caja/README.md).
  The split of each element between the till and the back office is decided in
  [Till or back office](2026-09-29-till-vs-backoffice-cash-boundary.md) and
  recorded element by element in [the board](centro-de-caja/split.html).
  Section 8 lists every source.
- Label legend, per the workspace research standard:
  - **FACT** — the repository or a vendor document states it.
  - **TRADEOFF** — a source-backed choice between options.
  - **INFERENCE** — a conclusion of this review.

## 1. The short answer

**What it does today (FACT).** The Centro de caja is one full-screen surface. It
opens a drawer, holds the custody of that drawer, records cash movements outside
a sale, performs a blind count, records a variance reason, reconciles, and
closes. The backend is an append-only cash ledger with immutable facts and
server-side guards. The screen is strong on correctness and weak on day-to-day
readability.

**What the market does (FACT).** Every leader (Square, Toast, Lightspeed,
Clover, Shopify) models the drawer as its own object, separate from the sales
day. Every leader keeps the cash report separate from the sales report. Three of
five let the owner act on a stranded drawer from the back office.

**Where Umi already leads (INFERENCE).** Four properties are ahead of the
reference set: a denial-by-default policy object, a server-side blind count, an
approval bound to a fingerprint of the exact money action, and a custody chain
that survives a lost terminal identity.

**The market asks for what Umi has (USER-PRIMARY).** A Square seller posted a
public feature request in September 2026 for a denomination counter, a blind
close, a variance breakdown, a guided close, and a PIN at close. Square does not
have them. A second Square seller with two drawers in rotation describes the
exact race that Umi's ledger trigger already prevents. The evidence is in the
companion research file.

**What to change (INFERENCE).** The close-approval rule compares the wrong
number. Nothing in production creates the merchant policy, so a real merchant
starts in default-deny. The count has no exit. The till shows no drawer history.
No cash operation works offline, although the policy advertises it. Section 5
ranks the findings and section 6 gives the fixes.

## 2. What the Centro de caja does today

### 2.1 Where it lives

`showCashCenter()` opens a `Dialog.fullscreen` from the till top bar
([cash_surface.dart](../../apps/umi-pos/lib/features/cash/cash_surface.dart)).
The entry point is gated by the permission `cash.shift.read`
([operator_permissions.dart](../../apps/umi-pos/lib/core/security/operator_permissions.dart)).
The user says "tab". In the code it is a surface, not a tab: it covers the whole
screen and returns to the catalogue on close.

### 2.2 The screen states

The surface is a function of one snapshot, `CashCenterSnapshot`. The snapshot is
server-composed. The client does not assemble money.

| State       | Trigger in the snapshot                  | What the screen shows                                        | Primary action                   |
| ----------- | ---------------------------------------- | ------------------------------------------------------------ | -------------------------------- |
| Load failed | no snapshot                              | typed error and a retry button                               | `Reintentar`                     |
| Adopt       | `adoptableShift != null`                 | "Tu turno sigue abierto en otra terminal"                    | `Traer el turno a esta terminal` |
| Reclaim     | a register with `hold.reclaimable`       | "Esta caja quedó retenida por una terminal que ya no existe" | `Liberar la caja`                |
| No shift    | `currentShift == null`                   | register picker and the opening float counter                | `Abrir turno de caja`            |
| Active      | `currentShift.status` in the open family | status strip, movements, shift actions, close path           | depends on `allowedActions`      |
| Closed      | `summary != null`                        | the last close summary                                       | none                             |

The client repeats the same triggers from `allowedActions`. The server owns the
list of legal actions. The client only shows and hides buttons.

### 2.3 The operator actions

Fifteen permission keys exist for cash
([33_pos_cash.sql](../../docs/migration/build-v3/33_pos_cash.sql)). The table
below maps each action to its key, its route, and its ledger effect.

| Action (ES label)             | Permission                | Route                                  | Ledger effect                 |
| ----------------------------- | ------------------------- | -------------------------------------- | ----------------------------- |
| `Abrir turno de caja`         | `cash.shift.open`         | `POST /cash/shifts`                    | `opening_float` at sequence 1 |
| `Entrada de efectivo`         | `cash.movement.paid_in`   | `POST /cash/shifts/:id/movements`      | `paid_in`                     |
| `Salida de efectivo`          | `cash.movement.paid_out`  | same                                   | `paid_out`                    |
| `Retiro a caja fuerte`        | `cash.movement.safe_drop` | same                                   | `safe_drop`                   |
| `Solicitar apertura de cajón` | `cash.drawer.no_sale`     | `POST /cash/shifts/:id/no-sale`        | none                          |
| `Suspender turno`             | `cash.shift.suspend`      | `POST /cash/shifts/:id/suspend`        | none                          |
| `Entregar turno`              | `cash.shift.handoff`      | `POST /cash/shifts/:id/handoff`        | none                          |
| `Iniciar conteo ciego`        | `cash.count.submit`       | `POST /cash/shifts/:id/counts`         | none                          |
| `Volver a contar`             | `cash.count.recount`      | `POST /cash/shifts/:id/counts/recount` | none                          |
| `Motivo de la diferencia`     | `cash.reconcile`          | `POST /cash/shifts/:id/variance`       | none                          |
| `Conciliar turno`             | `cash.reconcile`          | `POST /cash/shifts/:id/reconcile`      | none                          |
| `Cerrar turno`                | `cash.shift.close`        | `POST /cash/shifts/:id/close`          | none                          |
| adopt                         | `cash.shift.resume`       | `POST /cash/shifts/:id/adopt`          | none                          |
| reclaim                       | `cash.shift.open`         | `POST /cash/registers/:id/reclaim`     | none                          |
| recover a stranded shift      | `cash.variance.approve`   | `POST /cash/shifts/:id/recover`        | none                          |

The close and the money movements are the only paths that matter on a busy day.
The rest are the exception paths.

### 2.4 The close path

The surface shows a numbered path
([cash_surface.dart](../../apps/umi-pos/lib/features/cash/cash_surface.dart)):

1. **Contar la caja.** A denomination counter in a 660-pixel dialog. The
   counter shows one row per bill and coin and a live total.
2. **Registrar la diferencia.** A reason list: `Sin diferencia`,
   `Error de conteo`, `Error de cambio`, `Error de manejo de efectivo`,
   `Diferencia operativa`. A manager PIN is required above tolerance.
3. **Conciliar el turno.** The server binds the count to a reconciliation row.
4. **Cerrar turno.** The server writes the immutable close row and frees the
   register.

Step 2 is skipped when the count equals the expectation.

### 2.5 The money equation

`calculateExpectedCash` in
[cash-domain.ts](../../apps/umi-api/src/modules/pos-cash/cash-domain.ts) is the
only place that computes the expectation:

```
expected = opening_float
         + (cash_received - change_given)     for each cash_sale
         + paid_in
         - paid_out
         - cash_refund
         - safe_drop
         + drawer_correction
         + close_adjustment
```

`handoff_transfer`, `count_observation`, and `variance_resolution` do not move
money (**FACT**). The function walks the ledger in sequence order and refuses a
gap or a repeat (**FACT**).

### 2.6 The shift state machine

Ten states exist (**FACT**,
[cash-domain.ts](../../apps/umi-api/src/modules/pos-cash/cash-domain.ts)):

```
opening -> open | blocked
open -> suspended | handoff_pending | counting | blocked
suspended -> open | handoff_pending | blocked
handoff_pending -> open | blocked
counting -> reconciliation_required | blocked
reconciliation_required -> counting | closing | blocked
closing -> closed | blocked
closed -> (terminal)
blocked -> (terminal)
recovered -> open | suspended | counting | reconciliation_required | closed
```

Three states are terminal: `closed`, `blocked`, and `recovered`. A register is
free only when its holding shift is terminal (**FACT**, the partial unique index
`cash_shift_one_unresolved_register`).

### 2.7 The server guarantees

This is the strong half of the design. Each item below is a **FACT** in the
schema or the repository.

1. **Append only.** Triggers raise on every `UPDATE` and `DELETE` of the ledger,
   the movements, the counts, the resolutions, the reconciliations, the closes,
   and the custody events.
2. **Identity is frozen.** A shift cannot change its merchant, location,
   register, opening device, opening operator, currency, or business date. A
   closed shift refuses every update.
3. **One sequence.** `cash_ledger_entry` has `unique(shift_id, sequence)`. The
   insert trigger requires `sequence = shift.ledger_sequence + 1` and
   `status = 'open'`. The shift row is locked `FOR UPDATE` first.
4. **One command.** `unique(merchant_id, command_id, entry_type)` on the ledger,
   and a `command_id` unique key on every other fact table. A retry cannot write
   twice.
5. **Optimistic version.** Every command carries `expectedShiftVersion`. A
   stale caller is refused, not merged.
6. **Blind count by construction.** The snapshot returns `expectedCash` as
   `null` until a count exists. The till cannot show the expectation, because
   the API does not send it.
7. **Bound approval.** A manager approval carries a SHA-256 fingerprint of the
   exact action. The consumer checks the fingerprint before it spends the
   grant. A reused or edited action fails with `APPROVAL_FINGERPRINT_MISMATCH`.
8. **Proven custody.** `merchant.device_is_usable` decides whether a hold is
   orphaned. The client never asserts that a terminal is gone.
9. **Server business date.** The API derives `business_date` from the merchant
   timezone and `business_day_start`. The client never supplies the date.
10. **Row-level security.** Every cash table forces a policy on
    `merchant_id` and `location_id`.

### 2.8 Who may do what

The migration grants eleven keys to `cashier` and `staff`, and four more keys to
`owner`, `admin`, `manager`, and `supervisor` (**FACT**):

| Capability                    | cashier / staff | manager and above |
| ----------------------------- | --------------- | ----------------- |
| Open, suspend, resume, read   | yes             | yes               |
| Paid in, paid out, safe drop  | yes             | yes               |
| Blind count, reconcile, close | yes             | yes               |
| Handoff, no-sale, recount     | no              | yes               |
| Approve a variance or a close | no              | yes               |

The separation of duties is real: the person who counts is not always the person
who approves. The two roles meet at the manager PIN dialog.

### 2.9 The owner view

The dashboard reads the same tables read-only
([caja-turnos.jsx](../../apps/umi-dashboard/src/screens/caja-turnos.jsx)). It
shows a pulse (open drawers, expected cash, shifts that need attention, net
variance), a triage list, and a drill-down with the cash math, the
denominations, the ledger, the separation of duties, and a synthetic trace. The
owner cannot move cash from the dashboard. That matches Square and Lightspeed
(**TRADEOFF**).

### 2.10 What the till does not do today

1. No drawer history on the till. The operator sees the expected total but not
   the list of movements that produced it.
2. No print or Z-style drawer summary at close.
3. No offline cash path. `offlineCashShiftAllowed` exists in the policy and is
   never read.
4. The count ends the drawer's ability to take cash, and no path returns to
   `open`.
5. `countMethod` is never read. The till always counts by denomination.
6. `blindCountRequired` is never read. The API always withholds the
   expectation.
7. `cashShiftRequired`, `registerAssignmentRequired`, `oneShiftPerOperator`, and
   `oneShiftPerRegister` are never read. The database enforces the last two
   unconditionally.
8. The ledger is not visible as a list anywhere on the till.
9. No opening-discrepancy check exists, so an overnight float difference is
   invisible.
10. The handoff fingerprint is computed on the client and never checked on the
    server.
11. No float or deposit tracking exists. Toast has `Create deposit`. A Square
    seller asks for "keep $150 in the drawer, deposit $412".
12. No way exists to defer a count. Toast pauses a drawer and opens a numbered
    replacement, so the operator can keep selling.
13. No variance trend exists over days or by employee.

## 3. How the market handles it

### 3.1 The reference set

Five international leaders (Square, Toast, Lightspeed K-Series, Clover, Shopify
POS) and the Mexican and Latin set (Fudo, Soft Restaurant, Odoo POS, PoloTab).
This review re-read the operator-facing instructions for Square, Toast, and
Lightspeed in 2026, and reuses the two prior Umi research files for the owner
view and for the reporting-day question.

### 3.2 The comparison

| Dimension                            | Square                  | Toast                  | Lightspeed K         | Clover           | Shopify POS          | Umi today            |
| ------------------------------------ | ----------------------- | ---------------------- | -------------------- | ---------------- | -------------------- | -------------------- |
| Drawer is a first-class object       | yes (`CashDrawerShift`) | yes                    | yes                  | no, an event log | yes (session)        | yes                  |
| States                               | `OPEN`/`ENDED`/`CLOSED` | Active/Open/Closed     | open/closed period   | event log        | open/closed          | 10 states            |
| Opening float                        | yes                     | yes                    | yes, by denomination | in the log       | yes                  | yes, by denomination |
| Blind count by denomination          | yes                     | yes, by permission     | yes                  | partial          | yes                  | yes, forced          |
| Close needs a reason above tolerance | yes                     | yes, with approval     | report only          | no               | yes                  | yes, with approval   |
| Owner can act on a stranded drawer   | yes (end remotely)      | yes (reopen, complete) | print only           | no               | yes (close remotely) | yes (`recovered`)    |
| Movement journal on the terminal     | yes                     | yes                    | yes                  | yes              | yes                  | no                   |
| Print or Z summary at close          | yes                     | yes                    | yes                  | yes              | yes                  | no                   |
| Offline cash                         | no                      | limited                | no                   | no               | no                   | no, flag only        |

Sources: section 8.

### 3.3 The operator flow per leader

**Square.** `More → Reports → Current Drawer`. The cashier sets the starting
cash, taps `Start Drawer`, and adds `Pay In/Out`. The cashier may end the drawer
from the terminal or the owner may end it from the dashboard. Square names the
two operations apart: "End a drawer" records the actual cash, and "close" is the
audit (**FACT**, Square help).

**Toast.** Cash Drawers are `Active`, `Open`, or `Closed`. Toast grants
`Cash Drawer Access`, `Cash Drawers (Blind)`, and `Cash Drawers (Full)` as
separate permissions. `Shift Review` walks the cashier through close checks,
tips, reconcile, and the count. A difference above a threshold needs a manager
approval and a short comment (**FACT**, Toast help and the Umi feature matrix).

**Lightspeed K-Series.** The cashier opens the drawer after a new sales period
and counts by denomination. The counter asks for the count of each note and coin
and computes the total. Mid-shift the cashier uses `Add cash` and `Remove cash`
with a reason. The close prints a Drawer report (**FACT**, Lightspeed help).

**Clover.** The Cash Log lists the events: paid in, paid out, no sale, and the
reason and the employee. Clover has no reconciled shift object (**FACT**,
Clover help and the Umi matrix).

**Shopify POS.** A register session records the starting float, the cash added
and removed, and the final count. Shopify tracks two discrepancies: one at the
start and one at the end. Sessions cannot be reopened after close (**FACT**,
Shopify help).

**Fudo and Soft Restaurant.** Both assign cash drawers to users. Fudo documents
a blind count that the owner configures, and names the cashier role as an
example. Soft Restaurant documents a "corte por mesero" and multiple drawers
(**FACT**, Umi feature matrix).

### 3.4 The rules the market shares

1. The drawer is a durable, time-bounded object with an opening float.
2. The drawer reconciles against an expected value from an event ledger.
3. The count is by denomination, and the system computes the total.
4. The variance is the hero number.
5. Cash reconciliation and sales reporting are separate reports.
6. Many drawers fit inside one business day.
7. A manager approves a difference above a threshold.
8. A cashier action and a manager action use different permissions.
9. A stranded drawer has an owner-side escape.
10. A movement carries a reason code.

### 3.5 Where the leaders disagree

| Question                              | The market split                                                | Umi today                     | Verdict              |
| ------------------------------------- | --------------------------------------------------------------- | ----------------------------- | -------------------- |
| Is the shift editable after close?    | Toast reopens; Shopify forbids; Square audits once              | append-only, with `recovered` | keep (**INFERENCE**) |
| Blind for everyone, or by permission? | Toast splits Blind and Full; Square and Lightspeed configure it | forced for everyone           | revisit              |
| One discrepancy or two?               | Shopify tracks start and end; the rest track the end            | end only                      | add the start check  |
| Can the owner move cash?              | Square read-only; Shopify closes remotely; Toast adjusts        | read-only, with `recovered`   | keep                 |
| One drawer per shift, or several?     | all: one drawer per shift                                       | one                           | keep                 |

## 4. The engineering design

### 4.1 The entities

| Entity          | Table                      | Owner    | The one invariant                       |
| --------------- | -------------------------- | -------- | --------------------------------------- |
| Physical drawer | `physical_register`        | merchant | one unresolved shift per register       |
| Policy          | `cash_shift_policy`        | merchant | one row per merchant and location       |
| Shift           | `cash_shift`               | API      | identity is frozen after insert         |
| Ledger          | `cash_ledger_entry`        | API      | one ordered append-only sequence        |
| Movement        | `cash_movement`            | API      | one ledger entry, one reason code       |
| Count           | `cash_count_attempt`       | API      | one count per shift and attempt number  |
| Resolution      | `cash_variance_resolution` | API      | one resolution per count                |
| Reconciliation  | `cash_reconciliation`      | API      | one per shift, bound to the fixed count |
| Close           | `cash_shift_close`         | API      | one per shift, after the reconciliation |
| Handoff         | `cash_shift_handoff`       | API      | one per command, with a cash snapshot   |
| Custody event   | `cash_shift_custody_event` | API      | every rebinding of the holding device   |
| No-sale         | `no_sale_drawer_event`     | API      | at most three per operator per minute   |

### 4.2 The money model

All money is an integer in minor units. The currency travels with the amount
(**FACT**). The database stores `bigint` and checks the range
`0 .. 9007199254740991`. TypeScript checks `Number.isSafeInteger`. The Dart
parser refuses an ambiguous separator instead of guessing
([money_input.dart](../../apps/umi-pos/lib/features/cash/money_input.dart)).
This is the correct model for a till (**INFERENCE**).

Two rules deserve a name:

- **No negative drawer.** The schema forbids a negative amount. A cash refund
  and a pay-out are recorded as positive amounts with a negative effect.
- **No float in the sum.** Every running total uses integers. The display
  divides by 100 exactly once.

### 4.3 The ledger

The ledger is the cash authority. The expected cash is a projection of the
ledger, never a stored balance (**FACT**, the table comment). This choice gives
three properties for free: the expected value replays from the facts, the audit
is the same list, and a gap is impossible (**INFERENCE**).

The ledger is also the coupling to sales: `cash_ledger_entry.sale_id` and
`tender_fact_id` link a cash row to the sale that caused it, and
`unique(tender_fact_id)` makes a double posting impossible (**FACT**).

### 4.4 The count model

The count is an observation, not a correction. It never replaces the expected
value (**FACT**, the table comment). Up to ten attempts are allowed. Each
attempt records the operator, the denominations, the ledger sequence, and a
note.

The denomination validator exists in two places: `cash_denominations_valid` in
SQL and `validateDenominations` in the contract. Both check that each line
multiplies, that the lines are unique, and that the sum equals the declared
total (**FACT**). The duplication is deliberate defense in depth. It is also a
maintenance cost: a change must land twice (**INFERENCE**).

### 4.5 The custody model

Custody is the hardest part of a real till, and this design is unusually
complete. Three separate identities exist on the shift:

- `device_id` — the terminal that opened the shift. It never changes.
- `holding_device_id` — the terminal that holds the drawer now.
- `operator_session_id` — the live session that speaks for the shift.

Three operations rebind the terminal that holds the drawer. A fourth moves
responsibility to another operator without moving the drawer:

| Operation | Who may run it                               | Money effect                      | Why it exists                                           |
| --------- | -------------------------------------------- | --------------------------------- | ------------------------------------------------------- |
| `adopt`   | the same operator                            | none                              | a browser lost its stored identity                      |
| `recover` | a manager (key `cash.variance.approve`)      | a count and a variance            | the operator cannot return                              |
| `reclaim` | the opener permission                        | none, and no count                | the holding terminal is gone                            |
| `handoff` | the outgoing operator, with the incoming PIN | none, but a count may be required | a shift change; it moves responsibility, not the drawer |

`reclaim` and `recover` are the two that matter. `reclaim` frees the register
and blocks the shift. It never counts, because the cash is still in the drawer
(**FACT**). `recover` counts the drawer under the manager's name and lands on
`recovered`, so a report can always tell a counted drawer from an abandoned one
(**FACT**).

### 4.6 Concurrency and idempotency

Every write follows one shape:

1. `integrity.execute` opens a transaction and records the command.
2. The repository locks the shift row `FOR UPDATE` and matches the version.
3. The repository writes the fact and bumps the version.
4. The audit append and the commit follow.

A retry with the same `commandId` and `idempotencyKey` returns the stored
result. A retry with a new key and a stale version is refused. The client keeps
one pending command per merchant and location in the platform key store, and
asks `GET /cash/commands/:commandId` on the next start
([cash_recovery_store.dart](../../apps/umi-pos/lib/features/cash/cash_recovery_store.dart)).

**The limit of this design (INFERENCE).** The recovery slot is crash recovery,
not offline mode. It answers "did my last command land". It cannot queue a
second command, and it cannot open a drawer without the network.

### 4.7 Security and separation of duties

The strong pattern is the fingerprint-bound elevation. A manager PIN produces a
short-lived grant. The grant names the permission, the command, and a hash of
the exact action. The consuming command recomputes the hash and spends the
grant once. This defeats a replay of a stale approval after the drawer changed.

Three controls wrap this pattern (**FACT**):

- Five wrong PINs lock the device for fifteen minutes.
- A fourth no-sale request by one operator inside one minute is refused.
- A no-sale request always reports `verifiedHardwareResult: false`. The product
  does not claim that the drawer opened.

### 4.8 The policy object

The policy is the merchant's contract with the till. It carries a version, an
issue time, an expiry, and a fingerprint. A missing or expired policy denies
every action, and the surface reports `policy_expired` (**FACT**).

The read side and the write side disagree about the policy, and that is a real
finding. Section 5.12 lists the unused fields.

### 4.9 The API surface

Sixteen routes exist under
`/api/v1/pos/merchants/:merchantId/cash`
([pos-cash.controller.ts](../../apps/umi-api/src/modules/pos-cash/pos-cash.controller.ts)).
The shape is consistent: a command carries `locationId`, `operatorSessionId`,
`commandId`, `idempotencyKey`, and `expectedShiftVersion`. The `reclaim` route
is the one exception: it is addressed by register, because an operator at a
stuck drawer knows the register and cannot read the shift.

### 4.10 The client architecture

`CashController` holds one `CashState` and one `CashCenterSnapshot`. Every
command follows the same order: load the pending command, post, clear the
pending command, reload the snapshot. The surface redraws from the snapshot.
The client never derives money, and it never decides the legal actions
(**FACT**).

One client rule is worth naming: `_perform` catches every error, not only
`AppException`. A decode fault used to leave `busy` true and trap the operator
behind a progress bar (**FACT**, the code comment).

## 5. Findings

Ranked by risk. Each item names the evidence and the cost. The order of risk is:
5.13 (policy provisioning), 5.1 (close approval), 5.2 (count exit), 5.3
(offline), 5.4 (history), 5.5 (print), 5.6 (opening discrepancy), 5.14
(denominations), then 5.7 to 5.12.

### 5.1 The close approval compares the wrong number (High)

**Evidence.** `pos-cash.repository.ts` computes
`closeApprovalRequired = expected.expectedDrawerCash.minorUnits > policy.closeApprovalThreshold.minorUnits`
in two places (the reconcile path and the snapshot path). The migration spec
pins the same expression.

**Effect.** A drawer with a large float needs a manager to close, even when the
count is exact. A drawer with a large variance closes with no approval, as long
as the float is small. The control is inverted.

**The market.** Toast and Square gate the approval on the _over/short_, not on
the drawer size (**FACT**, section 3.3).

**The seed proves the intent.** `scripts/umi-pos-demo-seed.sh` sets
`variance_tolerance` to 100 minor units (MX$1.00) and
`close_approval_threshold` to 500 minor units (MX$5.00). With the current
comparison, every close above MX$5.00 in the drawer needs a manager. That is the
intent of a variance rule, not of a drawer-size rule.

**Fix.** Use `abs(counted - expected) > closeApprovalThreshold`. Rename the
field if the intent was a drawer-size limit, and add the variance rule as a
second field.

### 5.2 The count has no exit (High)

**Evidence.** `submitCount` sets the shift to `reconciliation_required`
immediately. The transition map has no edge back to `open`. The ledger insert
trigger accepts only `status = 'open'`.

**Effect.** One accidental tap on `Iniciar conteo ciego` freezes the drawer for
cash sales. The operator must resolve, reconcile, and close the shift, then open
a new one.

**The freeze is correct; the exit is missing.** A Square seller with two drawers
in rotation names the opposite failure: "While the AM employee is counting their
drawer, any sales done during that period would count against the AM drawer
because it's still technically active in the POS"
(**USER-PRIMARY**, the companion research file §7.2). Umi must not accept a sale
into a drawer under count. Keep the block, and add the exit.

**Fix.** Add a guarded `resume` from `reconciliation_required` to `open` with
one condition: no ledger entry exists after the last count's sequence. The
ledger already proves the condition. Alternatively rename the action
`Comenzar el cierre` and move it into the close panel.

### 5.3 No cash operation works offline (Medium)

**Evidence.** `offlineCashShiftAllowed` is read into the policy and never used.
The recovery store holds one command.

**Effect.** A café with a weak network cannot open a drawer, record a pay-out,
or count. The sale path has an offline queue; the cash path does not.

**Fix.** Either implement a small offline journal with a hard cap and a
reconciliation-on-reconnect step, or remove the flag and document that cash
requires the network. Do not ship a flag that promises a feature.

### 5.4 The till never shows the drawer history (Medium)

**Evidence.** `cash_surface.dart` renders the expected total and the latest
count. It renders no ledger list.

**Effect.** The operator cannot answer "who took the 500 for the tortillas"
without the owner's dashboard.

**Fix.** Add a compact journal panel to the active surface. Square, Toast, and
Lightspeed all show it (**FACT**).

### 5.5 The close produces no document (Medium)

**Evidence.** `close` returns a `ShiftCloseResult` with the summary and the
reconciliation. The surface shows three lines. Nothing prints.

**Effect.** The cafe keeps no physical cash record, and the manager cannot
attach a counted drawer to the bank deposit.

**Fix.** Add a print action on the closed summary. Lightspeed prompts to print
the drawer report at close (**FACT**).

### 5.6 No opening discrepancy (Medium)

**Evidence.** The opening float is a single number. The design never compares
the new float to the previous close.

**Effect.** An overnight difference is invisible. Shopify catches it with a
second discrepancy (**FACT**).

**Fix.** Compare the opening float with the previous shift's counted cash on the
same register. Store the signed difference as an observation.

### 5.7 The handoff fingerprint is dead (Low)

**Evidence.** The client sends `_fingerprintSeed(shift)`, a 64-character string
built from a byte XOR of the shift id. The server never reads `dto.fingerprint`.

**Effect.** No security hole, because the server ignores the field. The code is
misleading, and a reviewer may trust a control that does not exist.

**Fix.** Delete the field, or compute and check a real fingerprint.

### 5.8 The denomination rules live twice (Low)

**Evidence.** `cash_denominations_valid` in SQL and `validateDenominations` in
the contract check the same four rules.

**Effect.** A future change can land in one place only.

**Fix.** Keep both, and add a shared fixture test that feeds the same matrix to
both. Name the coupling in each file.

### 5.9 A stale comment on the count state (Low)

**Evidence.** The contract `CashCountState` has seven values. The database check
has five. `not_started` and `counting` can never be stored.

**Effect.** The client can model states the server never sends.

**Fix.** Align the two enums, or document the two client-only values.

### 5.10 No count-method support (Low)

**Evidence.** `countMethod` is `total_only` by default and is never read. The
till always shows the denomination counter.

**Effect.** A merchant who wants a fast total count cannot get one.

**Fix.** Read the policy in the count dialog and offer a total field when the
policy allows it.

### 5.11 Blindness is not configurable (Low)

**Evidence.** `blindCountRequired` is never read. The API withholds the
expectation in every case.

**Effect.** A merchant who wants a visible count cannot get one. Toast sells
this as two permissions, `Cash Drawers (Blind)` and `Cash Drawers (Full)`
(**FACT**).

**Fix.** Gate the expectation on the policy and the permission together.

### 5.12 Four policy fields are decorative (Low)

**Evidence.** `cashShiftRequired`, `registerAssignmentRequired`,
`oneShiftPerOperator`, and `oneShiftPerRegister` are read into the snapshot and
never used in a decision. The last two are enforced unconditionally by partial
unique indexes.

**Effect.** The owner can set a policy that does nothing. A support call will
find this.

**Fix.** Enforce each field, or remove it from the contract and the settings
screen.

### 5.13 Nothing in production creates the policy (High)

**Evidence.** `merchant.cash_shift_policy` has one writer in the whole
repository: the demo seed `scripts/umi-pos-demo-seed.sh`. No migration, no API
module, no dashboard form inserts it. The readiness script
`scripts/umipos-pilot-readiness.mjs` only checks that a row exists.

**Effect.** A real merchant with no policy row gets `version = 'default-deny'`.
The snapshot then reports `recoveryState = 'policy_expired'` and
`allowedActions = []`. The Centro de caja opens with no action at all, and the
till cannot accept cash. The failure is correct and safe, but the product cannot
start.

**Fix.** Add a default policy at merchant or location provisioning, with a
versioned fingerprint and an expiry. Add the owner-facing settings for the
thresholds in the same increment.

### 5.14 The policy denominations do not match the contract (Medium)

**Evidence.** The seed writes `[{"denominationMinorUnits":50}, …]`. The
contract types the field as `array(Money)`, which is
`[{minorUnits, currency}]`. The Dart reader `denominationsFromPolicy` looks for
`minorUnits` and finds nothing, so it falls back to the hardcoded MXN list
without a warning.

**Effect.** The merchant's denomination set is ignored. A merchant with a
different currency or a different coin set counts against the wrong rows, and
nobody is told.

**Fix.** Write the contract shape, validate the policy on read, and refuse a
snapshot whose denominations do not parse. A silent fallback on money is a
defect, not a default.

## 6. Recommendations

Ordered by value per unit of work.

1. **Fix the close approval.** One comparison, two call sites, one test. It
   restores a control the market requires.
2. **Create the policy in provisioning.** Without it, no merchant can use cash.
3. **Add the guarded exit from the count.** One transition, one condition, one
   permission. It removes the worst daily friction on the surface.
4. **Add the ledger panel to the active surface.** Read-only. It answers the
   common operator question in place.
5. **Add a print action on the close.** It closes the loop with the physical
   deposit.
6. **Decide the offline question.** Implement or delete. Do not leave the flag.
7. **Enforce or delete the four decorative policy fields.**
8. **Write and validate the policy denominations.**
9. **Add the opening discrepancy.**
10. **Read `countMethod` and `blindCountRequired`.**
11. **Delete the dead handoff fingerprint.**
12. **Add a shared denomination fixture test.**

The operator-experience list below comes from the screenshots and the user
posts in the companion research file. Rank it after correctness.

13. **Make blindness a permission.** Toast uses `Cash Drawers (Blind)` versus
    `Cash Drawers (Full)`. Fudo removes the `Ver 'Según Sistema'` permissions
    from a role. Umi withholds the expectation from everyone.
14. **Put the drawer journal on the active surface.** Toast shows the journal
    beside the actions, with the amount, the timestamp, and the employee.
15. **Name the action groups.** Lightspeed uses `Quick actions` and `End of day
actions`. Toast uses `Change drawer balance` and `No sale`.
16. **Print the running total on the confirm button.** Lightspeed shows
    `Confirm - US$ 100.00`. This removes one mental sum.
17. **Add float and deposit tracking.** A standard float, a calculated deposit,
    and a deposit history that matches the bank.
18. **Require an identity at close.** Record who counted and who closed, and
    gate the close with a PIN above the policy threshold.
19. **Add a variance trend to the dashboard.** Variance over days, by employee
    and by location, exportable.
20. **Print or e-mail the close summary.** Fudo prints and mails the arqueo.
    Toast prints the report and creates a deposit.
21. **Consider a deferred count.** A paused drawer plus a numbered replacement
    drawer is the cleanest answer to a busy shift change.

## 7. Open questions

1. Does one till serve one operator, or many in a shift? The current model
   allows one active shift per operator and one per register. A shared till with
   one drawer and two cashiers needs a decision.
2. Is a cash sale allowed with no open shift when `cashShiftRequired` is false?
   The API refuses today, and the policy field suggests otherwise.
3. Should the till show the expected cash during service? The current answer is
   no. A "drawer health" indicator is a different, safer idea.
4. Does the merchant want a Z-report at close, or only a deposit slip?
5. Which cash movements need a second person in a cafe of this size? The
   default `movementApprovalThreshold` of zero would gate every movement.

## 8. Sources

### Vendor primary sources read for this review

- Toast, "Cash drawers" (Platform guide) —
  https://doc.toasttab.com/doc/platformguide/adminCashDrawers.html
  (read 2026-09-29; the `Open`/`Closed`/`Paused` states, the
  `Cash Drawers (Blind)` versus `Cash Drawers (Full)` permission, the drawer
  journal, `Add cash`/`Cash out`/`Payout`/`Tip out`/`Cash drop`/`No sale`,
  `Create deposit`, and the 4 a.m. auto-close. Six screenshots).
- Fudo, "3. Arqueos de caja" and "¿Cómo configurar un 'Arqueo de caja ciego'?" —
  https://soporte.fu.do/es/articles/11730865-3-arqueos-de-caja and
  https://soporte.fu.do/es/articles/11730856-como-configurar-un-arqueo-de-caja-ciego
  (read 2026-09-29; the open float, the `Según sistema` versus `Según usuario`
  close, the blind arqueo as a role permission, print and e-mail).
- Square, "Start and end a cash drawer session" —
  https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session
  (read 2026-09-29; "Ending a cash drawer is different than closing a cash
  drawer"; `More → Reports → Current Drawer`).
- Square, "CashDrawerShift" API object —
  https://developer.squareup.com/reference/square/objects/CashDrawerShift
  (via the Umi cash-shift research file; `OPEN`/`ENDED`/`CLOSED`, three
  team-member roles, read-only).
- Toast, "Cash Management" (Get Started guide) —
  https://support.toasttab.com/en/article/Cash-Management-Overview
  (read 2026-09-29; permission list includes `Cash Drawer Access`, `No Sale`,
  `Shift Review`, `Cash Drawers (Full)`, `Cash Drawer Lockdown (Override)`,
  `Adjust Cash Drawer Start Balance`, `Pay Out`).
- Toast, "Shift Review Overview" —
  https://support.toasttab.com/en/article/Shift-Review-Overview
  (via the Umi cash-shift research file; guided close, over/short above a
  threshold needs approval).
- Lightspeed Restaurant (K-Series), "Managing cash drawer operations" —
  https://k-series-support.lightspeedhq.com/hc/en-us/articles/360050436394-Managing-cash-drawer-operations
  (read 2026-09-29; open by denomination, `Add cash` and `Remove cash` with a
  reason, `Close drawer` with a printed Drawer report).
- Clover, "Run a cash log report" —
  https://www.clover.com/en-US/help/run-cash-log-report
  (indexed description; Event/Amount/Reason/Employee).
- Shopify, "Cash tracking" and "Register sessions in Shopify admin" —
  https://help.shopify.com/en/manual/sell-in-person/shopify-pos/cash-register-management/cash-tracking
  and
  https://help.shopify.com/en/manual/sell-in-person/shopify-pos/cash-register-management/register-sessions-in-shopify-admin
  (via the Umi cash-shift research file; two discrepancies, remote close,
  immutable after close).

### Prior Umi research reused

- [Cash centre — vendor documentation, independent forums, and screen evidence](../research/2026-09-29-cash-center-vendor-docs-forums-and-screenshots.md)
- [Cash-shift management — the owner/manager UX in enterprise POS](../research/2026-09-06-cash-shift-management-owner-ux.md)
- [Shift-close vs the reporting day](../research/2026-09-07-shift-close-vs-reporting-day-research.md)
- [Competitor feature matrix: Fudo, Soft Restaurant, Clover](../research/2026-09-15-competitor-feature-matrix-fudo-softrestaurant-clover.md)
- [POS navigation and cashier-vs-manager IA](../research/2026-09-05-pos-navigation-and-cashier-vs-manager-ia.md)
- [Barista POS UX audit, section 6](../design/2026-09-05-barista-pos-ux-audit.md)
- [POS top-bar redesign, D6](../design/2026-09-05-pos-top-bar-redesign.md)
- [ADR: separate sales from cash and shifts](../architecture/2026-09-07-ventas-vs-caja-y-turnos-frontera-de-modulo-adr.md)

### Repository sources

- Schema: `docs/migration/build-v3/33_pos_cash.sql` (666 lines),
  `34_pos_exception.sql` (the `cash_refund` entry type),
  `68_cash_shift_orphan_reclaim.sql` (the `orphan_reclaim` custody event),
  `60_triggers.sql` (`tg_business_date`).
- Contract: `packages/contract/src/pos-cash.ts` (917 lines).
- API: `apps/umi-api/src/modules/pos-cash/` — `cash-domain.ts`,
  `pos-cash.service.ts`, `pos-cash.repository.ts`, `pos-cash.controller.ts`,
  `cash-shift-hold.ts` (in `pos-checkout`).
- POS: `apps/umi-pos/lib/features/cash/` — `cash_surface.dart`,
  `cash_controller.dart`, `cash_repository.dart`, `cash_recovery_store.dart`,
  `denomination_counter.dart`, `money_input.dart`; tests in
  `apps/umi-pos/test/cash_*_test.dart`.
- Owner view: `apps/umi-dashboard/src/screens/caja-turnos.jsx`.

### Tooling

`curl` 8.x with a desktop user agent, and a local HTML text extractor, to read
the Square, Toast, and Lightspeed pages. Chromium through Playwright
1.63.0-alpha (the workspace `node_modules`) to render the JavaScript pages and
to download the product screenshots. G2, Capterra, Trustpilot, TrustRadius,
SiteJabber, and Reddit blocked this environment; the companion research file
records each failure and names the sources that did load.
