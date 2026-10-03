# Centro de caja — superset v1: every best element in one place

- Date: 2026-09-29
- Status: Inventory. This is the input to the real design pass, not the design.
- Artifacts, in order of maturity:
  - [centro-de-caja/](centro-de-caja/index.html) — the working reference. Real
    state, real flows, a self-check (`node qa.mjs`) that reports 0 errors and 0
    warnings, and a [README](centro-de-caja/README.md) with the port map.
  - [2026-09-29-centro-de-caja-superset.html](2026-09-29-centro-de-caja-superset.html)
    — the first cram: one screen, 1280 × 720, no scroll, every block tagged by
    source. Its rendered PNG is a generated screenshot and stays out of git.
- Parents: [the till deep design](2026-09-29-centro-de-caja-till-deep-design.md)
  and [the vendor and forum research](../research/2026-09-29-cash-center-vendor-docs-forums-and-screenshots.md).
- Goal: put the best cash-centre element of Toast, Square, Lightspeed, Clover,
  Shopify, Fudo, and Umi on one screen. Then remove, in the design pass, with a
  reason for each removal.
- Rule for this file: no element is dropped for taste. An element leaves only
  with a named reason.

**Source tags.** `[UM]` Umi today · `[T]` Toast · `[SQ]` Square · `[LS]`
Lightspeed · `[CL]` Clover · `[SH]` Shopify · `[FU]` Fudo · `[MKT]` more than
one vendor.

## 1. The screen map

The artifact is a fixed 1280 × 720 grid. It has four zones.

| Zone         | Rows / columns        | Purpose                                                                                                                                                        |
| ------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity bar | full width, 60 px     | Where am I, which drawer, which shift, which operator, which terminal, which policy, which connection.                                                         |
| Money strip  | full width, 54 px     | The whole cash equation in nine cells, then the two answers: expected and counted, then the variance.                                                          |
| Work area    | four columns, ~559 px | Left: drawers, shifts, deposit, other tenders. Centre: the ledger and the reconciliation. Right-1: actions and custody. Right-2: the close path and approvals. |
| Legend       | full width, 11 px     | The source tag key.                                                                                                                                            |

### 1.1 Column detail

**Left column (200 px).**

| Panel                         | Source       | Content                                                                                                           |
| ----------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| Drawers of the location       | `[T]`        | One row per drawer: name, expected, state (in use, paused `POR CONTAR`, free), terminal, open time.               |
| Shifts today                  | `[T]` `[SQ]` | Every shift inside one business day, with its variance and its outcome.                                           |
| Previous shift on this drawer | `[SH]`       | Last close, today's opening, and the opening discrepancy.                                                         |
| Cash to deposit               | `[T]` `[SQ]` | The deposit, the float to keep, today's deposits, and a seven-day net-variance line.                              |
| Other tenders                 | `[FU]`       | Card, wallet, and gift-card totals, read-only, so the operator can close by payment method if the merchant wants. |

**Centre column (fluid).**

| Panel                     | Source       | Content                                                                                                            |
| ------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| Shift ledger              | `[T]` `[LS]` | Every entry in sequence: type, detail, sale link, operator, terminal, time, amount. Filter chips and a CSV export. |
| Counts and reconciliation | `[UM]`       | Count attempts, the denominations of the last count, and the separation of duties.                                 |

**Right-1 column (236 px).**

| Panel         | Source       | Content                                                                       |
| ------------- | ------------ | ----------------------------------------------------------------------------- |
| Quick actions | `[T]` `[LS]` | The frequent money moves, with `Open drawer` and its reasons.                 |
| Shift custody | `[UM]`       | Suspend, resume, hand off, adopt, recover, reclaim.                           |
| Traceability  | `[UM]`       | The custody timeline. Adoptions, recoveries, and reclaims are shown as facts. |
| Diagnostics   | `[UM]`       | Recovery state, pending command, correlation id.                              |

**Right-2 column (244 px).**

| Panel         | Source        | Content                                                                             |
| ------------- | ------------- | ----------------------------------------------------------------------------------- |
| Shift close   | `[T]`         | The numbered path: count, variance, reconcile, close, deposit.                      |
| Count (blind) | `[LS]` `[FU]` | The denomination counter. The confirm button carries the running total.             |
| Approvals     | `[UM]`        | The thresholds, the used approval, the required approval, the print and the e-mail. |

## 2. The best element of each system, and where it sits

| System         | Its best idea                                                                                                                  | Where it lives in the artifact                                         | Status                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Toast**      | The drawer is a first-class object with a visible journal, and the expectation is gated by a `Blind` versus `Full` permission. | The drawer list, the shift ledger, the `Conteo ciego` chip.            | The journal is new. Blindness as a permission is new.           |
| **Toast**      | The **paused drawer** plus a numbered replacement drawer.                                                                      | The `Caja barra (2)` row with the `POR CONTAR` chip.                   | New.                                                            |
| **Toast**      | `Create deposit`, `Tip out`, `Payout`, `Cash collected from server`, `Cash drop`.                                              | The quick actions and the deposit panel.                               | New.                                                            |
| **Square**     | The drawer session is separate from the sales day, and "end" is separate from "close".                                         | The identity bar and the close path.                                   | Umi already separates them.                                     |
| **Square**     | A remote end from the back office, with no later cash edits.                                                                   | The dashboard owner view.                                              | Exists, read-only.                                              |
| **Shopify**    | **Two** discrepancies: one at the opening and one at the closing.                                                              | The "Previous shift on this drawer" panel.                             | New.                                                            |
| **Shopify**    | A remote close and a note for a session the device could not close.                                                            | `Recuperar (gerente)`.                                                 | Exists.                                                         |
| **Lightspeed** | The counter asks for the quantity per denomination and the confirm button shows the running total.                             | The count (blind) panel and the `Confirmar conteo · $3,428.50` button. | The counter exists. The running total on the button is new.     |
| **Lightspeed** | `Quick actions` separated from `End of day actions`.                                                                           | The two action groups.                                                 | Grouping exists; the names change.                              |
| **Lightspeed** | Counting can be optional, allowed, or mandatory per drawer and user group.                                                     | The policy chips.                                                      | New: `blindCountRequired` and `countMethod` are not read today. |
| **Clover**     | The cash log filters by event, employee, device, and order type, and exports.                                                  | The ledger filter chips and the CSV export.                            | Filters are new.                                                |
| **Fudo**       | The close compares **Según sistema** against **Según usuario**, per payment method, and colours the difference.                | The money strip, the "Other tenders" panel, and the variance colour.   | Cash is per denomination in Umi; other tenders are read-only.   |
| **Fudo**       | The blind arqueo is a role permission that removes a column.                                                                   | The `Conteo ciego` chip.                                               | New.                                                            |
| **Fudo**       | Print and e-mail the close.                                                                                                    | The approvals panel.                                                   | New.                                                            |
| **Umi**        | The append-only ledger, the custody chain, the fingerprint-bound approval, and the server-side blind count.                    | The ledger, the traceability panel, the approvals panel.               | Exists. This is the part nobody else has.                       |

## 3. The field inventory

Every value on the screen, and where it comes from.

| Element on screen                        | Source field                                               | Status                                                        |
| ---------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| Business date and day start              | `businessDate`, `merchant.business_day_start`              | Exists.                                                       |
| Policy version, expiry, fingerprint      | `CashShiftPolicy.version/expiresAt/fingerprint`            | Exists. Not shown today.                                      |
| Blind mode                               | `CashShiftPolicy.blindCountRequired`                       | Exists, never read.                                           |
| Count method                             | `CashShiftPolicy.countMethod`                              | Exists, never read.                                           |
| Tolerance                                | `CashShiftPolicy.varianceTolerance`                        | Exists.                                                       |
| Movement approval threshold              | `CashShiftPolicy.movementApprovalThreshold`                | Exists.                                                       |
| Close approval threshold                 | `CashShiftPolicy.closeApprovalThreshold`                   | Exists. The comparison is wrong today (finding 5.1).          |
| Offline permission                       | `CashShiftPolicy.offlineCashShiftAllowed`                  | Exists, never read.                                           |
| Drawer hold state                        | `PhysicalRegister.hold`                                    | Exists.                                                       |
| Terminal and session                     | `CashShift.holdingDeviceId`, `operatorSessionId`           | Exists. Not shown today.                                      |
| Elapsed open time                        | `CashShift.openedAt`                                       | Exists, shown today.                                          |
| Nine equation cells                      | `ExpectedCash`                                             | Exists. Only the total shows today.                           |
| Expected, counted, variance, tolerance   | `ExpectedCash`, `BlindCount`, `CashVariance`               | Exists.                                                       |
| Count attempts and denominations         | `cash_count_attempt`                                       | Exists. Not shown on the till today.                          |
| Separation of duties                     | `openingOperatorId`, count `operatorId`, `elevation_grant` | Exists. Dashboard-only today.                                 |
| Ledger entries                           | `cash_ledger_entry`                                        | Exists. Not shown on the till today.                          |
| Sale link per entry                      | `cash_ledger_entry.sale_id`                                | Exists.                                                       |
| Reason and note per movement             | `cash_movement.reason_code`, `note`                        | Exists.                                                       |
| No-sale events                           | `no_sale_drawer_event`                                     | Exists. Not listed today.                                     |
| Custody events                           | `cash_shift_custody_event`                                 | Exists. Not shown today.                                      |
| Recovery state and pending command       | `CashCenterSnapshot.recoveryState`, `CashRecoveryStore`    | Exists.                                                       |
| Deposit and float                        | —                                                          | **New.** No table and no route.                               |
| Opening discrepancy                      | —                                                          | **New.** Derivable from the previous close and the new float. |
| Variance trend over days and by employee | —                                                          | **New.** Derivable from the ledger.                           |
| Paused drawer and replacement drawer     | —                                                          | **New.** Needs a state or a new shift rule.                   |
| Print and e-mail of the close            | —                                                          | **New.** Needs a document and a mail job.                     |
| Other-tender totals at close             | `pos_tender_fact`, `customer_value_tender_allocation`      | Exists in the dashboard read model.                           |

## 4. The action inventory

Every action on the screen, with its guard.

| Group | Action                              | Guard                                                                       |
| ----- | ----------------------------------- | --------------------------------------------------------------------------- |
| Quick | Add cash (paid in)                  | `cash.movement.paid_in`, policy type allowed, approval above the threshold. |
| Quick | Remove cash (paid out)              | `cash.movement.paid_out`, same rule.                                        |
| Quick | Safe drop                           | `cash.movement.safe_drop`, same rule.                                       |
| Quick | Cash collected from the operator    | New movement type or a `paid_in` with a fixed reason.                       |
| Quick | Payout to a supplier                | `paid_out` with a reason code.                                              |
| Quick | Tip out                             | New movement type, or `paid_out` with a reason code.                        |
| Quick | Open drawer, no sale                | `cash.drawer.no_sale`, policy flag, manager PIN, three per minute.          |
| Shift | Suspend / resume                    | `cash.shift.suspend` / `cash.shift.resume`.                                 |
| Shift | Hand off                            | `cash.shift.handoff`, incoming PIN, optional count.                         |
| Shift | Adopt                               | `cash.shift.resume`, the same operator, another terminal.                   |
| Shift | Recover                             | `cash.variance.approve`, a count, a variance.                               |
| Shift | Reclaim a register                  | `cash.shift.open`, a server-proven orphaned terminal.                       |
| Close | Count (blind)                       | `cash.count.submit`, ten attempts maximum.                                  |
| Close | Recount                             | `cash.count.recount`.                                                       |
| Close | Cancel the count and return to open | `cash.shift.resume`, and no ledger entry after the count. **New.**          |
| Close | Record the variance reason          | `cash.reconcile`, a PIN above tolerance.                                    |
| Close | Reconcile                           | `cash.reconcile`, the count must equal the ledger sequence.                 |
| Close | Close                               | `cash.shift.close`, a PIN above the close threshold.                        |
| Close | Create the deposit                  | `cash.shift.close`, after the close. **New.**                               |
| Close | Print or e-mail the close           | Read of the close. **New.**                                                 |

## 5. The state inventory

The union of the reference states, and how Umi expresses it.

| Concept                                          | Toast         | Square   | Shopify        | Umi today                             | Superset v1        |
| ------------------------------------------------ | ------------- | -------- | -------------- | ------------------------------------- | ------------------ |
| The drawer takes money                           | Open / Active | `OPEN`   | open session   | `open`                                | `open`             |
| The drawer is out of use, not counted            | Paused        | —        | —              | —                                     | `paused` (**new**) |
| The drawer is counted, still open for other work | —             | `ENDED`  | —              | `counting`, `reconciliation_required` | same               |
| The drawer is counted and closed                 | Closed        | `CLOSED` | closed session | `closed`                              | same               |
| Nobody can open the drawer                       | —             | —        | —              | `blocked`                             | same               |
| A manager closed somebody else's drawer          | —             | —        | remote close   | `recovered`                           | same               |

Umi already has the widest machine. The only missing state is **paused**.

## 6. What must be built

| Work                                                                             | Layer                                | Size    |
| -------------------------------------------------------------------------------- | ------------------------------------ | ------- |
| Fix the close-approval comparison (finding 5.1)                                  | API, repository, test                | Small.  |
| Create the policy at provisioning (finding 5.13)                                 | API or migration, dashboard settings | Medium. |
| Add the guarded count exit (finding 5.2)                                         | API transition, client chip          | Small.  |
| Read `blindCountRequired` and `countMethod`                                      | API, contract reader, client         | Small.  |
| Read and enforce the four decorative policy fields                               | API                                  | Small.  |
| Add the ledger panel and the filters to the till                                 | Client, existing route               | Medium. |
| Show the equation, the attempts, the denominations, and the separation of duties | Client, existing snapshot            | Medium. |
| Add deposit, float, and opening discrepancy                                      | Schema, API, client                  | Large.  |
| Add print and e-mail of the close                                                | API, client, mail worker             | Medium. |
| Add the paused drawer and the replacement drawer                                 | Schema, API, client                  | Large.  |
| Add the variance trend                                                           | Dashboard read model                 | Medium. |
| Make the expectation a permission                                                | Permission seed, API, client         | Small.  |

## 7. The cut list (for the design pass)

Nothing is cut yet. The design pass removes elements in this order, and each
removal needs a sentence.

| Tier | Element                    | The question to answer                                                          |
| ---- | -------------------------- | ------------------------------------------------------------------------------- |
| 1    | The nine-cell equation     | Does the operator need all nine terms, or only expected, counted, and variance? |
| 2    | The ledger on the till     | Is the journal a daily need, or a manager need?                                 |
| 3    | The other-tender panel     | Does cash-only reconciliation need the card totals on the same screen?          |
| 4    | The trend line             | Is a seven-day trend useful mid-shift?                                          |
| 5    | The filters and the export | Which filters are used at a counter?                                            |
| 6    | The custody timeline       | Is it an audit view or a daily view?                                            |
| 7    | The diagnostics panel      | Keep behind a debug flag?                                                       |
| 8    | The approvals panel        | Show the rule only when it fires?                                               |
| 9    | The deposit step           | One step or a separate flow?                                                    |
| 10   | The paused drawer          | Is a deferred count a real case in a cafe?                                      |

## 8. The design decisions already fixed

Three decisions come from the High findings and appear on the screen.

1. **The close approval compares the variance.** The identity bar and the
   approvals panel both say "diferencia > $5.00". No element compares the
   expected balance to a threshold.
2. **The count has an exit.** The chip reads
   `Cancelar conteo y volver a abierto`, and the guard is the ledger sequence.
   The screen also keeps the block: a drawer under count takes no new sale.
3. **A missing policy is a visible state.** The identity bar carries the policy
   version and the expiry. A missing or expired policy is a blocking state, not
   an empty screen.

## 9. Verification of the artifact

The artifact was rendered in Chromium through Playwright at 1280 × 720 and
measured:

- document width 1280, height 720, no scroll;
- zero panel with content taller than its box;
- zero element outside the viewport.

The measurement script and the screenshot are session tools, not repo files.

## 10. Open decisions

1. One screen for the cashier, or two: a daily surface and a close surface?
2. Is the drawer journal a cashier right or a manager right?
3. Does a cafe pause a drawer, or does it close and reopen?
4. Does the close create the deposit, or does the owner create it later?
5. Which single number is the hero: expected, counted, or variance?
