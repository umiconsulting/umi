# The cash centre on the iMin: the walk, and the close that was impossible

Date: 11 October 2026, 05:26–06:01 MST. Device: iMin D3-504 (`192.168.1.10:5555`), Estación build from
this tree, demo merchant, API on `:4013` behind the body-logging proxy (`/tmp/umi-proxy-bodies.mjs`)
for the parts that needed the request bodies. Shift `4955b88b-…` on `Caja principal`, opened 03:10 by
an earlier session.

The plan's coverage table lists the cash centre as `cash_surface.dart` with _"la fixture nativa usa su
política"_, and no device walk of it existed. This is that walk: every control was pressed with real
taps, every verdict comes from the API's log and from the demo database.

## What was walked, and what it did

| Step                                             | What the till did                                                                                                                                                                                         | API / database                                                                                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Caja`                                           | `Centro de caja`, `Turno abierto`, `La cuenta del cajón`, `Movimientos de caja`, `Cierre de turno`                                                                                                        | `GET /cash`                                                                                                                                      |
| `Entrada de efectivo` → 50.00 + motivo           | the dialog says a PIN is needed from MXN 50.00; approval asked, then booked                                                                                                                               | `POST /elevation/manager-approval` 201 → `POST /cash/shifts/…/movements` 201; `paid_in` 5000, `reason_code = entrada_de_caja`, `approval_id` set |
| `Salida de efectivo` → 20.00 + motivo            | **no** PIN: under the threshold                                                                                                                                                                           | `POST …/movements` 201; `paid_out` 2000, `compra_de_hielo`, no approval                                                                          |
| `Retiro a caja fuerte` → 100.00                  | approval, then booked                                                                                                                                                                                     | `…/movements` 201; `safe_drop` 10000, `retiro_a_caja_fuerte`, approved                                                                           |
| `Iniciar conteo ciego` → 1×1,000 + 1×200 + 1×100 | denominations, `Total contado MXN 1,300.00`, the expected cash stays hidden until the count is sent                                                                                                       | `POST …/counts` 201; `cash_count_attempt` state `approval_required`, `counted_minor_units 130000`, the three denominations as entered            |
| `Motivo de la diferencia`                        | `Diferencia: −MXN 25.01 · Fuera de tolerancia`, `EFECTIVO CONTADO 1,300.00` beside `EFECTIVO ESPERADO 1,325.01`, a reason list and the manager's PIN                                                      | `POST …/variance` 201; `cash_variance_resolution` reason `counting_error`, approval `29956da4…`                                                  |
| `Conciliar turno`                                | steps 1–3 tick, `Listo para cerrar`                                                                                                                                                                       | the reconciliation row exists (`cash_reconciliation`, unique per shift)                                                                          |
| `Cerrar turno` → PIN → `Cerrar turno`            | `¿Cerrar este turno de caja?` with the three figures and the PIN field                                                                                                                                    | `POST /elevation/manager-approval` 201 → `POST …/close` 201; `cash_shift.status = closed`, `cash_shift_close` 3f697c19… holds the whole summary  |
| the closed screen                                | `Abre un turno de caja antes de aceptar efectivo.`, the previous count as reference, the opening-float denominations, `Abrir turno de caja` **disabled** with `El fondo inicial no puede quedar en cero.` | —                                                                                                                                                |
| `Abrir turno de caja` → 1×100                    | `Turno abierto`, `Abierto hace un momento`                                                                                                                                                                | `POST …/open`; new shift `ab20f1f5-…`, `opening_float` 10000                                                                                     |
| `Solicitar apertura de cajón` → PIN              | `Se requiere aprobación del gerente`, the PIN stated as 4 to 8 digits                                                                                                                                     | `POST /elevation/manager-approval` 201 → `POST …/no_sale` 201; no `hardware_command` row follows                                                 |

The arithmetic is right at every step. The account reads `FONDO INICIAL 100.00 · VENTAS EN EFECTIVO
1,360.00 · INGRESOS 50.00 · RETIROS −84.99 · CAJA FUERTE −100.00`, the expected drawer cash is
`1,325.01` — and the count of `1,300.00` is a shortfall of exactly `25.01`, which is what both the
reconciliation and the close recorded.

## The defect: a shift could not be closed at all

`Cerrar turno` → `Cerrar turno` posted this, and the till said NOTHING (the dialog closed, the screen
looked untouched, the shift stayed in `closing`):

```
POST /api/v1/pos/elevation/manager-approval
{"operatorSessionId":"…","managerPin":"","managerCard":null,
 "permission":"cash.shift.close.approve","merchantId":"…","locationId":"…","commandFingerprint":"…"}
→ 400 {"code":"VALIDATION_FAILED","fieldErrors":{"managerPin":["Invalid"]}}
```

Two defects behind one tap, both of them the same two the refund walk found on its own money path:

1. **The PIN field had no requirement.** `ManagerApprovalRequest.managerPin` is `^\d{4,8}$`, and the
   cash dialogs' PIN fields declared nothing to validate — so an untouched field posted `""` and the
   contract refused it. The refund flow's approval control was fixed this way hours earlier; the
   cash dialogs were not. Fixed with one builder, `cashManagerPinField`, which states
   `Usa de 4 a 8 dígitos.` under the field and keeps the confirm disabled until the value is four to
   eight digits — **no trimming**, because the dialog hands the field's text to the wire unchanged.
2. **The refusal reached no one.** `approveClose`, `approveVariance` and `approveNoSale` awaited the
   repository OUTSIDE the controller's guard, so the API's answer escaped as an unhandled exception:
   nothing on the screen, and a caller that carried on as if the money had been authorised. They now
   run through `_approve`, which is `_perform` (the one place an `AppException` becomes
   `state.errorCode`, the field the cash centre renders as its single notice) plus the state
   hand-back an approval owes, since it has nothing to reload.

Verified on the hardware: with the fix the same tap opens `¿Cerrar este turno de caja?` with the PIN
field **and the confirm disabled**, `3333` enables it, and the close lands —
`POST /elevation/manager-approval 201` → `POST …/close 201` → `cash_shift.status = closed`, with
`merchant.cash_shift_close` holding the full summary (expected/counted/variance, the register's hold,
`reconciliationOutcome: approved_variance`).

Guards, each checked both ways:
`test/cash_center_test.dart` → _"the manager PIN a cash dialog asks for is the shape the contract
accepts"_ (fails with the field's requirement removed) and _"a refused close approval names itself
and does not close the shift"_ (fails when the approval runs outside the guard: the `AppException`
escapes instead of landing on `state.errorCode`). POS suite: **689 tests**.

## What the walk also found, and did not fix

1. **A movement's reason and operator never reach the till's own journal.** `Entrada de efectivo`,
   `Salida de efectivo` and `Retiro a caja fuerte` are booked with their reason and their approval
   (`cash_movement.reason_code`, `approval_id`), and the journal's rows show only the type, the
   amount and the time — `Ingresos +MXN 50.00 / 05:30`, `Retiros −MXN 20.00 / 05:33`. A manager
   reading the till cannot see why the money moved or who authorised it, which is the whole point of
   the reason the dialog insists on.
2. **A no-sale drawer opening is invisible.** The dialog's own sentence promises `Abrir el cajón sin
venta queda en el historial con tu operador y el motivo`, and nothing of it appears on the till:
   the server records the request and an audit event (`cash.no_sale_drawer_requested`,
   `hardwareVerified: false`), no `hardware_command` follows for the till to claim, and the operator
   is told nothing about whether the drawer opened. On a till whose drawer cannot pulse, the
   difference between "requested" and "opened" is the only thing that matters.
3. **The movement dialog clips its own second field.** With the keyboard open, the dialog's scroll
   viewport is `[535,140][1385,430]` — 290 px — and the reason field sits at its edge: the label
   `Motivo del movimiento` is sliced through the middle of the glyphs
   (`08-movement-dialog-clipped-label.png`), while the confirm button is inert until that field is
   filled. Tapping the visible sliver does bring the field up (the focus scrolls it into view), so
   the flow works — but the operator's first sight of a required field is a sliced label.
   `PosAlertDialog` already scrolls its content, so the redundant nested scroll view this dialog
   added was removed; that is a cleanup, not the fix. The room is the problem: two `PosField`s at
   ~101 logical px each, with labels, two stated requirements and a banner, cannot fit the
   ~290 device px a 737 px window has left once the keyboard is up. The fix is a design decision
   about that content (drop the amount field's permanent helper, which repeats its own hint and
   reads as an error, or collapse the banner while the keyboard is up).
4. **A shift whose session has ended offers only `Reanudar turno`** — and that is correct, not a
   defect: after the app restarts (a new operator session), every close-and-count flow around the
   shift is gone until the till resumes it, `POST …/shifts/{id}/resume` binds it to the live session,
   and `Cerrar turno` comes back. Worth writing down because it _looks_ like a missing action.
5. **The close dialog's cancel action is called `Cerrar`** ("close") while the action beside it is
   `Cerrar turno` ("close shift"). Same word, opposite meanings, in a dialog about money that cannot
   be undone.

Evidence: `docs/reports/evidence/2026-10-11-imin-cash-centre/`.
