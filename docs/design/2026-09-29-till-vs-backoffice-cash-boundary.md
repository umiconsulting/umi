# Till or back office — where each cash fact lives

- Date: 2026-09-29
- Status: Recommended split. The board is interactive; the owner's vote wins.
- Board: [centro-de-caja/split.html](centro-de-caja/split.html) — 66 elements,
  each with a recommendation, a rule, and its form on both sides.
- Parents: [the till deep design](2026-09-29-centro-de-caja-till-deep-design.md),
  [superset v1](2026-09-29-centro-de-caja-superset-v1.md), and
  [POS navigation and cashier-vs-manager IA](../research/2026-09-05-pos-navigation-and-cashier-vs-manager-ia.md).

## 1. The decision

**The same fact may appear on both sides. It must not appear in the same form.**

Three buckets exist, and the numbers in this split are:

| Bucket                    | Count | Meaning                                                                                            |
| ------------------------- | ----- | -------------------------------------------------------------------------------------------------- |
| **Till only**             | 19    | The act happens at the drawer, with the customer waiting. Nothing to see later except the record.  |
| **Both, in another form** | 31    | The fact is one. The shape changes: a live number with an action beside it is not a 30-day series. |
| **Back office only**      | 16    | Setup, thresholds, comparison, and control. The till has no business showing it.                   |

**Example of the rule.** The variance exists once. On the till it is a live
number with a colour and a PIN gate. In the back office it is the same number
inside a series, by day, by drawer, and by operator. The fact does not fork. The
form does.

**The two sentences that decide most cases.**

1. If the money moves, the till does it. The back office reads it.
2. If the value changes the behaviour of every till, the back office owns it.

## 2. The rules

Eight rules, each with its source. The board tags every element with one.

| #      | Rule                                                                                               | The source                                                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **R1** | The physical action rules: if the money moves in the drawer, it happens on the till.               | The operation-driven frame reads the physical action as the source of truth. Square and Toast both put the blind count on the POS. |
| **R2** | Frequency: the frequent stays shallow, the rare may move.                                          | NN/g progressive disclosure; Material 3 and Apple HIG action counts.                                                               |
| **R3** | Money: the till moves the cash; the back office observes and audits it.                            | Square's cash report is read-only in the dashboard; the POS does the count.                                                        |
| **R4** | Authority: configuration, thresholds, and permissions live in the back office.                     | All four vendors put drawer setup, device setup, and variance thresholds in the back office.                                       |
| **R5** | Truth: the till writes the facts; the back office reads them and administers.                      | The ledger is append-only and written by the till.                                                                                 |
| **R6** | Latency: if a decision is needed while the customer waits, it is made on the till.                 | Toast's over/short approval happens at the drawer; the threshold is configured in the back office.                                 |
| **R7** | Volume: a list bounded to the shift lives on the till; a list that grows lives in the back office. | Progressive disclosure; the journal and the history are different objects.                                                         |
| **R8** | Dignity: per-person and per-branch performance data belongs to the back office.                    | Square logs per-team-member activity for the owner, not on the cashier's screen.                                                   |

## 3. The 19 that stay on the till

The act happens at the drawer. The till is the only home.

| Element                                | Form on the till                                                     | Rule |
| -------------------------------------- | -------------------------------------------------------------------- | ---- |
| Estado del turno y tiempo abierto      | Estado con acción — the state and the elapsed time in the bar.       | R1   |
| Conexión, cajón e impresora            | Estado con acción — three signals in the identity bar.               | R1   |
| Cajones que esta terminal puede tomar  | Lista corta del turno — the drawers this till can open.              | R1   |
| Libro del turno actual                 | Lista corta del turno — one line per movement, with amount and time. | R1   |
| Entrada de efectivo                    | Acción directa — amount, reason, PIN above the threshold.            | R1   |
| Salida de efectivo                     | Acción directa — amount, reason, approval.                           | R1   |
| Cobro de efectivo al operador          | Acción directa — one button with reason presets.                     | R1   |
| Propinas (tip out)                     | Acción directa — the payout at distribution.                         | R1   |
| Corrección de cajón                    | Acción directa — with reason and approval.                           | R6   |
| Contar el cajón, por denominación      | Paso guiado — the counter, with the running total on the button.     | R1   |
| Volver a contar                        | Paso guiado — inside the same step.                                  | R1   |
| Cancelar el conteo y volver a abierto  | Estado con acción — the exit, guarded by the ledger sequence.        | R1   |
| Motivo de la diferencia                | Paso guiado — the reason list with a note.                           | R1   |
| Conciliar el turno                     | Paso guiado — the step that freezes the count.                       | R1   |
| Cerrar el turno y liberar la caja      | Paso guiado — the close with its confirmation.                       | R1   |
| Aprobación de la diferencia con PIN    | Estado con acción — the PIN at the counter.                          | R6   |
| Suspender y reanudar el turno          | Estado con acción — pause without losing the drawer.                 | R1   |
| Entregar el turno con PIN del entrante | Acción directa — the incoming PIN and the handoff.                   | R1   |
| Traer el turno a esta terminal (adopt) | Estado con acción — one action when the terminal lost its session.   | R1   |

## 4. The 31 that appear on both sides, in another form

This is the table that matters for design. One fact, two treatments.

| Element                                      | Form on the till                                                     | Form in the back office                                              | Rule |
| -------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | ---- |
| Fecha operativa y hora de inicio             | Ficha breve — the operating day in the identity bar.                 | Configuración — the cut-off hour and its effect on every date.       | R4   |
| Sucursal, caja y moneda                      | Ficha breve — branch, drawer, currency beside the state.             | Configuración — create, name, and assign each drawer.                | R5   |
| Quién abrió, quién responde, en qué terminal | Ficha breve — name and terminal beside the state.                    | Tabla filtrable — operator and terminal as columns.                  | R5   |
| Conteo ciego y método de conteo              | Estado con acción — the mode is announced before counting.           | Configuración — per branch, and per role if you want it.             | R4   |
| Tolerancia de la diferencia                  | Semáforo — the threshold appears when the difference crosses it.     | Configuración — the owner's risk appetite.                           | R4   |
| Umbral de aprobación de movimiento           | Semáforo — the PIN is requested at the threshold.                    | Configuración — the threshold per branch.                            | R4   |
| Umbral de aprobación del cierre              | Semáforo — the rule in the bar: "diferencia > $5.00".                | Configuración — the close threshold.                                 | R4   |
| Permiso de operar sin conexión               | Estado con acción — if cash needs the network, it says so first.     | Configuración — the operating policy.                                | R4   |
| Comando pendiente y recuperación             | Estado con acción — the safe action: "revisar el último movimiento". | Expediente de control — the full trace and the correlationId.        | R6   |
| Fondo inicial                                | Cifra viva — the float with its denomination count.                  | Ficha del turno — the first line of the shift's account.             | R1   |
| Ventas en efectivo                           | Cifra viva — one term of the drawer equation.                        | Serie y tendencia — the cash share of the payment mix.               | R3   |
| Ingresos y retiros de efectivo               | Acción directa — amount, reason, PIN above the threshold.            | Tabla filtrable — the shift's movement log.                          | R1   |
| Retiro a caja fuerte                         | Acción directa — one action with reason and approval.                | Tabla filtrable — the destination, the time, and who did it.         | R1   |
| Reembolsos en efectivo                       | Acción directa — the payout with its sale and its approver.          | Tabla filtrable — the refund with its sale and its approver.         | R1   |
| Ajustes y correcciones de cajón              | Acción directa — the correction with reason and approval.            | Expediente de control — who corrected, when, and why.                | R3   |
| Propinas en efectivo por pagar               | Acción directa — the payout at distribution.                         | Ficha del turno — a line of the account and of the cost.             | R1   |
| Esperado, contado y diferencia               | Cifra viva — the three numbers, coloured by the difference.          | Serie y tendencia — the same difference over 7, 30, and 90 days.     | R1   |
| Estado de todos los cajones                  | Lista corta — only the state, to know what is busy.                  | Tabla filtrable — the whole fleet by terminal and branch.            | R7   |
| Caja pausada y cajón de reemplazo            | Acción directa — pause and keep selling on drawer (2).               | Tabla filtrable — the paused drawer as a pending item, with its age. | R1   |
| Turnos de hoy de toda la sucursal            | Lista corta — my shift and the previous one on my drawer.            | Tabla filtrable — every shift of the day, sortable by difference.    | R7   |
| Turno anterior y discrepancia de apertura    | Semáforo — "the close left $1,500 and today you opened $1,500".      | Ficha del turno — the opening discrepancy as evidence.               | R6   |
| Cerrar un turno perdido                      | Paso guiado — the manager counts the drawer in front of them.        | Alerta y triaje — the desk path when nobody is in the store.         | R6   |
| Filtros del libro                            | Lista corta — five filters: all, sales, movements, safe, no-sale.    | Tabla filtrable — the full set, with a date range and type.          | R2   |
| Detalle del movimiento con enlace a la venta | Lista corta — the row expands and shows the trace.                   | Tabla filtrable — the link to the sale and the receipt.              | R5   |
| Comprobantes y recibos del turno             | Acción directa — reprint the last one.                               | Documento — the shift's archive, searchable.                         | R7   |
| Separación de funciones                      | Ficha breve — only the approver, at the moment of the PIN.           | Expediente de control — the four names on one card.                  | R8   |
| Abrir el cajón sin venta                     | Acción directa — three reasons, PIN, rate limit.                     | Alerta y triaje — the no-sale as a shrinkage signal.                 | R6   |
| Depósito: fondo e importe                    | Paso guiado — the calculation with an editable float.                | Cruce externo — the deposit against the bank.                        | R1   |
| Arqueo: imprimir, guardar, enviar            | Documento — the print at the counter.                                | Documento — the e-mail and the archive.                              | R1   |
| Recuperar un turno cuyo operador no vuelve   | Paso guiado — the manager counts the drawer in front of them.        | Alerta y triaje — recovery from the desk.                            | R6   |
| Liberar una caja de una terminal perdida     | Estado con acción — "liberar la caja", with no count.                | Configuración — release it from the drawer list.                     | R6   |

## 5. The 16 that live in the back office

Setup, thresholds, comparison, and control. No cash moves here.

| Element                                               | Form in the back office                                         | Rule |
| ----------------------------------------------------- | --------------------------------------------------------------- | ---- |
| Alta, nombre y asignación de cajas                    | Configuración — name, assignment policy, and terminal.          | R4   |
| Historial de turnos por días                          | Tabla filtrable — date range, branch, cashier, export.          | R7   |
| Libro de todos los turnos, con búsqueda y exportación | Tabla filtrable — every shift, with filters and export.         | R7   |
| Cadena de custodia                                    | Expediente de control — who held the drawer, and when it moved. | R7   |
| Diagnóstico técnico y correlationId                   | Expediente de control — behind the shift card, for support.     | R4   |
| Libro de no-sale y retiros del turno                  | Alerta y triaje — sorted by risk, not by date.                  | R8   |
| Diferencia por turno, caja y persona                  | Serie y tendencia — by day, by drawer, and by person.           | R8   |
| Registro de custodia por turno                        | Expediente de control — the whole chain on a timeline.          | R8   |
| Pulso del día                                         | Alerta y triaje — four figures in the header.                   | R7   |
| Turnos que requieren atención                         | Alerta y triaje — sorted by money at risk.                      | R8   |
| Tendencia de diferencias                              | Serie y tendencia — 7, 30, and 90 days.                         | R8   |
| Diferencia por empleado                               | Serie y tendencia — the owner reads it, nobody else.            | R8   |
| Comparación entre sucursales                          | Serie y tendencia — a multi-branch roll-up.                     | R8   |
| Alertas al dueño                                      | Alerta y triaje — a notice when the rule fires.                 | R8   |
| Exportar CSV o PDF                                    | Documento — export from any table.                              | R4   |
| Permisos de efectivo por rol                          | Configuración — what each role sees and may do.                 | R4   |

## 6. What this changes in the product

| Change                                            | Where          | Note                                                                                                                                       |
| ------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| The till drops the branch-wide lists              | POS            | The drawer list narrows to the drawers this terminal can take. The shift list narrows to this shift and the previous one on this drawer.   |
| The till keeps the current-shift ledger           | POS            | New panel. Bounded to the shift, five filters, expandable rows.                                                                            |
| The till drops the analysis                       | POS            | No trend, no per-employee data, no cross-branch roll-up.                                                                                   |
| The thresholds become back-office settings        | Dashboard      | A cash policy screen: tolerance, both approval thresholds, blind mode, count method, offline permission.                                   |
| The policy provisioning gap closes                | API            | The missing default policy (finding 5.13) belongs to the same screen.                                                                      |
| The back office gains the two-form pairs          | Dashboard      | Every "both" row needs its second treatment: the series, the table, the card, the audit file.                                              |
| The back office gains a desk path for two escapes | API, dashboard | Remote close of a stranded shift, and release of an orphaned drawer. Both already exist in the API.                                        |
| The shift detail already exists                   | Dashboard      | `caja-turnos.jsx` already renders the math, the denominations, the ledger, the duties, and the trace. Reuse it; extend it with the series. |

## 7. What we decided not to move

| Temptation                                    | The decision                                        | Why                                                                                                                        |
| --------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Put the close in the back office              | Keep the close on the till                          | The count happens where the money is. Square, Toast, and Lightspeed all count on the terminal.                             |
| Move the variance approval to the back office | Keep the approval on the till, with a desk fallback | The manager is at the counter during service. A desk-only approval adds a walk and a phone call.                           |
| Put the ledger in the back office only        | Keep both, in two forms                             | The cashier needs to answer "who took the 500" without leaving the counter.                                                |
| Show the branch pulse on the till             | Back office only                                    | It is not actionable at the drawer, and it leaks other operators' numbers.                                                 |
| Hide the thresholds from the till             | Show them as a signal                               | The cashier must understand why a PIN is requested. Show the rule, not the settings screen.                                |
| Give the back office a cash action            | Read-only, plus two named escapes                   | The back office never moves cash. Shopify is the only reference that closes remotely, and it does so as a named exception. |

## 8. Open questions for the owner

1. **Does the till show the branch-wide drawer state at all?** The recommendation
   is a one-line state per drawer, read-only. The alternative is to show nothing
   beyond the drawers this terminal can take.
2. **Does the counter manager get the desk fallbacks?** The recommendation gives
   the back office two escapes: a remote close and a drawer release. Both are
   writes from the dashboard, which is read-only today.
3. **Is the per-employee variance visible to a supervisor, or only to the
   owner?** Rule R8 hides it from the till. The back-office role split is still
   open.
4. **Does the deposit become an object with its own state?** The recommendation
   makes the till create it and the back office track it. That needs a new table
   and a bank-matching view.
5. **Who owns the closing hour of the business day?** The back office, per R4.
   The change must be forward-looking, because it re-stamps every derived date.

## 9. Sources

## 10. Application status (2026-09-29)

What has been built from this split so far, and what proved it.

| Surface                          | Applied                                                                                                                                                                                                                                                                                                            | Evidence                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Back office — "Caja y turnos"    | Pulse with four KPI figures, each stating its window; the difference series by business day with the worst day named; a filterable shift table (bucket chips, search, sortable by variance or expected); the shift card below                                                                                      | `pnpm lint` 0 errors; `pnpm test` 335 pass; `pnpm build` green; `umi-dashboard` i18n `compile --strict` green; verified in the real browser at `/operations/cash-shifts` with real clicks — chips filtered 4/1/0/3, sort put the uncounted drawer last in both directions, the search emptied the table, and a row click updated the card; no console errors           |
| Back office — read model         | `facts.businessDate` added to the `cash_shifts` operations projection, so the back office groups by trading day and never by the calendar day of a timestamp                                                                                                                                                       | live API response carries `businessDate`; `caja-turnos-model.spec.js` covers the late-night case                                                                                                                                                                                                                                                                       |
| Till — read model                | `ledger` added to `CashCenterSnapshot`, bounded to the shift and ordered by sequence                                                                                                                                                                                                                               | `tsc --noEmit` clean; `pos-cash.repository.regression.spec.ts` pins the ordering, the bound, and the unsigned projection; 30 API tests green                                                                                                                                                                                                                           |
| Back office — pure logic         | `caja-turnos-model.js`: variance, buckets, filter, sort, series                                                                                                                                                                                                                                                    | 14 unit tests, including "an uncounted drawer never sorts as zero"                                                                                                                                                                                                                                                                                                     |
| Till — the drawer's account      | `CashEquation` replaces the total-only money card: every term, the sign of an adjustment, the ledger sequence the total came from                                                                                                                                                                                  | `flutter analyze` clean; 9 widget tests in `cash_equation_test.dart`                                                                                                                                                                                                                                                                                                   |
| Till — the policy signals        | `CashPolicyChips` rides inside the state strip: blind or visible count, tolerance, movement threshold, close threshold, offline rule                                                                                                                                                                               | same tests; the strip scrolls sideways so a longer policy never pushes the operator's work down                                                                                                                                                                                                                                                                        |
| Till — the current-shift journal | `CashJournal` renders the ledger the expected cash is computed from: the entry, the received-minus-change detail, the operator, the receipt, the time, and the signed amount. `CashJournalLine` is the till's projection of `cash_ledger_entry`, deliberately separate from the dashboard's `CashLedgerLine`       | `flutter analyze` clean; 3 widget tests; 1 integration test on the whole surface; the SQL ran against the live database for a real shift, and the sale→cart→session→staff join resolves a real sale's operator                                                                                                                                                         |
| Till — the guarded count exit    | `POST /cash/shifts/:id/counts/cancel` puts a counted drawer back to `open`. Two conditions, both proven in the repository: the ledger has not moved since the count (the shift's sequence equals the count's recorded sequence), and nobody has recorded a variance reason. The count attempt stays in the history | `tsc` and `eslint --max-warnings 0` clean; 1670 API tests pass; a service test proves the authority is `cash.count.submit` and that a role without it is refused; a repository regression test pins both guards; a controller test proves the terminal sends the count's sequence, not the one it holds after a reload; the route answers 401 on the live API, not 404 |
| Local review data                | Three closed demo shifts on a second drawer, so the series and the triage table can be judged with real data                                                                                                                                                                                                       | seeded through the worker connection (RLS hides them from the app role without a session); reversible                                                                                                                                                                                                                                                                  |

Not yet applied, in the order the split asks for them:

1. **Till — the deposit step.** Needs the deposit object, the table, and the route.
2. **Back office — the policy screen.** The settings live nowhere today; this is where the missing default policy (finding 5.13) belongs.
3. **Back office — the desk escapes.** Remote close of a stranded shift, and release of an orphaned drawer. Both exist in the API already.

### Toolchain note

The POS was verified against Flutter 3.44.6, the version this repo pins. The SDK
is installed at `~/.local/share/flutter-sdk/3.44.6` and is not on `PATH`.
`flutter test` reports the cash suite green (423 tests) with one failure in
`checkout_point_tender_test.dart` → "the wait bound is the unresolved case". That
test is pre-existing and timing-sensitive: it fails on a clean checkout of `HEAD`
as well, and it has both failed and passed in this worktree without a related
change. It is not a result of this work.

The local `umi-api` dev process was restarted to pick up the new route; its
watcher had compiled the controller but never restarted the child. It now runs
under `pnpm dev` with the log at `/tmp/umi-api-dev.log`.

- Internal, primary: [POS navigation and cashier-vs-manager IA](../research/2026-09-05-pos-navigation-and-cashier-vs-manager-ia.md)
  — Material 3 and Apple HIG action counts, NN/g progressive disclosure, NN/g
  hidden-navigation cost, Square/Toast/Lightspeed/Clover permission and setup
  splits, Toast's `Closeout Over/Short Max` gate.
- Internal, primary: [operation-driven owner observability and POS friction](2026-09-05-operation-driven-owner-observability-and-pos-friction.md)
  — the physical-action frame and the `$` versus `⚡` split.
- Internal: [the till deep design](2026-09-29-centro-de-caja-till-deep-design.md)
  and [superset v1](2026-09-29-centro-de-caja-superset-v1.md).
- Vendor, read this session: Square "Start and end a cash drawer session",
  Square "View cash drawer reports", Toast "Cash drawers" (platform guide),
  Lightspeed "Managing cash drawer operations". See
  [the vendor research](../research/2026-09-29-cash-center-vendor-docs-forums-and-screenshots.md).

## 11. Application status (2026-09-30) — the screen composed

Section 10 built the parts. This session made them one screen, judged on the real
terminal at 1920 x 1080, full screen on an empty workspace, and on the reference
viewport at 1280 x 720.

| Change                                                                                                                                                                                     | Why                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CashDrawerAccount.fromLedger` rebuilds the drawer's terms from the journal, and `CashEquation` now takes that account plus a nullable `expectedCash`                                      | The equations card used to disappear whenever the server withheld the total, which is the normal state before a count. The screen lost its anchor card and read as one that had not finished loading. The terms were never the secret — every one of them is a line in the journal below — so the card stands in every state and masks only the number the count is meant to test |
| The masked total is a redacted figure (`MXN ••••••`, lock, "Se revela al contar") on its own filled panel                                                                                  | A missing number reads as a fault; a covered one reads as a rule. The panel also gives the total the weight of the answer instead of one more column in a row of figures                                                                                                                                                                                                          |
| The terms sit on a fixed grid — six, three, two, or one column by width                                                                                                                    | The old row spread them with `spaceBetween`, so no two shifts put a term in the same place. An equation is read by position                                                                                                                                                                                                                                                       |
| `CashPolicyChips` in the state strip became `CashPolicyTable` in the right rail                                                                                                            | Five chips stated the thresholds as fragments and clipped at 1280 px. As a table, each rule reads as a name and a value, and the state strip keeps only the operative facts                                                                                                                                                                                                       |
| `Cierre de turno` states the work of each step under its name, and a hairline separates the one action                                                                                     | A numbered list of destinations told the operator where they were going but not what the step asked of them. The button also read as the fourth step's own control                                                                                                                                                                                                                |
| `_VarianceCard` rebuilt as "Arqueo del cajón": counted, expected and tolerance as figures, and the variance on a filled panel with words — "Faltante · Fuera de tolerancia"                | This is the card that decides whether the shift can move on, and it was four bare sentences with an ASCII hyphen for a minus                                                                                                                                                                                                                                                      |
| One money formatter. `formatMinorUnits` moved to `money_input.dart` with an optional currency; the second copy in `cash_equation.dart` and the `_money` helper in the surface both call it | The same amount printed as `1458.50` in one card and `MXN 1,458.50` in the next, and a shortage printed with `-` where the journal used `−`                                                                                                                                                                                                                                       |
| Every card has the same padding and card titles share one type scale                                                                                                                       | Card content started at three different left edges in one column                                                                                                                                                                                                                                                                                                                  |
| The two-column layout needs width **and** height. At 1280 x 720 the left rail scrolls and keeps every card at its content height; the journal is no longer squeezed to 40 px               | A layout test caught the journal at a 40 px viewport with one row built: a scrollbar a finger cannot use                                                                                                                                                                                                                                                                          |

Evidence: `flutter analyze` clean; 425 POS tests pass with two known exceptions —
the temporary render harness (moved to `test/render/` so the suite does not
collect it) and the pre-existing `checkout_point_tender_test.dart` timing case.
The screen was launched with `tools/ux-sweep/pos-native-launch.sh` and read at
1920 x 1080 in the running application, not only in a test renderer.

## 12. Application status (2026-09-30) — every state, not just the open one

Section 11 judged the screen in the state a shift spends most of its time in.
This session rendered **every** state the screen can be in, in both themes, and
fixed what the open shift had been hiding.

The renderer is `apps/umi-pos/test/render/cash_centro_render.dart`: ten states
(`open`, `no-shift`, `adopt`, `suspended`, `balanced`, `reconciled`, `closed`,
`busy`, `denied`, `unavailable`) at 1920 x 1080 or 1280 x 720, light or dark.
Run it with `--update-goldens`; the images land in `test/render/shots/`.

| Defect the renders exposed                                                                                                               | Fix                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A **closed** shift still offered "Motivo de la diferencia" as its next action, and showed "Arqueo del cajón" twice with the same figures | Every step now consults `allowedActions` — `resolve_variance` was the one gate that never did — and the count card yields to the closure summary when both would draw the same numbers. The closed path ends with a line saying the drawer no longer takes money |
| The strip said "Se requiere conciliación" while the only action left was "Cerrar turno"                                                  | The headline comes from the flow, not the raw status: a reconciled shift that is not yet closed reads "Listo para cerrar"                                                                                                                                        |
| The strip said "Abre un turno de caja antes de aceptar efectivo" on the **adopt** screen, whose card said the opposite                   | The headline names the real state, and the strip now carries the drawer, the day and the hour of the shift that is open elsewhere                                                                                                                                |
| A closed shift's strip said "Abierto hace 11 h" — a closed drawer is not open for eleven hours                                           | It reads "Cerrado 13:02"                                                                                                                                                                                                                                         |
| The no-shift and adopt screens were a 720 px card floating in a 1920 px void — closer to a dialog that failed to open than to a screen   | Both wear `_ShiftShell`, the same two-column split the running shift uses: the work at the left, the facts and the policy in the rail. The screen no longer changes its shape when the drawer changes hands                                                      |
| The opening float button refused without saying why                                                                                      | The one rule the operator can fix on that screen is stated under it                                                                                                                                                                                              |
| The failure surface was one sentence and a button                                                                                        | It is a card: what could not be read, what happened, what to do next — including telling the manager before taking cash — and the retry                                                                                                                          |
| Three money formatters: this screen used `formatMinorUnits`, the counter had its own, and `_money` printed an ASCII minus                | One formatter, in `money_input.dart`, used by all three                                                                                                                                                                                                          |
| A long journal ended in a row cut off by the card edge                                                                                   | A short fade turns the clipped row into the sentence it is: there is more                                                                                                                                                                                        |

Two motions were added, and only two: the covered expected total cross-fades into
the answer when a count is submitted, and a close step's circle fills as the step
is taken. Both are `UmiMotion` durations, both happen once per shift, and neither
is decoration — they are how the operator learns their press landed.

The same pass also asked a plainer question of every control: does this look like
something you can press? The movement tiles are the till's most-pressed controls
and they were a bare outline on a near-black surface — a shape the eye files as a
panel. They now
carry a filled ground, a hairline and an icon in the one accent colour — filled
means pressable, plain means read-only, and the screen keeps that rule everywhere.
The movement dialog's amount field states its currency inside the field, so "50"
is never a number whose unit the operator has to guess.

Evidence: `flutter analyze` clean; 425 POS tests pass with the same single
pre-existing exception; the ten-state renderer passes in light and dark; the
running application was rebuilt and read at 1920 x 1080 after the changes.

## 13. Application status (2026-09-30) — the dialogs

The tab's other half is its dialogs: movement, blind count, variance reason,
close, handoff and no-sale. They were stock `AlertDialog`s — a title, an
unlabelled field and two buttons — and they are where the operator is asked for
the things the screen has just finished explaining.

Every one of them now states what it is about, in one shape: an icon, a sentence,
and, where the action is taken against money, the same figures the screen shows.

| Dialog          | What it says now                                                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Movement        | The amount from which a manager's PIN will be asked, before the amount is typed — so the second dialog is a rule, not a surprise. The amount field states its currency inside the field |
| Blind count     | What a blind count is ("el esperado se revela cuando envías tu conteo"), or, on a recount, that this count replaces the previous one in the history                                     |
| Variance reason | The variance, the count it came from and the tolerance it broke: "Diferencia: −MXN 1.50 · Fuera de tolerancia"                                                                          |
| Close           | The sentence that says the close cannot be undone, plus the expected, counted and variance figures the close is made of                                                                 |
| Handoff         | "El turno pasa al operador entrante. El cajón no se mueve."                                                                                                                             |
| No-sale drawer  | "Abrir el cajón sin venta queda en el historial con tu operador y el motivo."                                                                                                           |

One defect in this set was not cosmetic. The variance dialog opened with **"Sin
diferencia" already selected** over a shortage — so the fastest path through a
screen about a contradiction was to confirm the contradiction. `CashFieldsDialog`
now takes `requireChoice`: the list starts empty and the confirm button stays
disabled until the operator picks. `cash_center_test.dart` pins it — the reason
list is empty, the button is null, and the reason the repository receives is the
one the operator chose.

The wording of a variance is now computed in one place (`_varianceReading`), used
by both the count card and the dialog that asks the operator to explain it: a
reason is chosen against the sentence on screen, and two sentences for one number
is one sentence too many.

Evidence: `flutter analyze` clean; 427 POS tests pass (two new) with the same
single pre-existing exception; `RENDER_DIALOG=movement|count|resolve|close|handoff|nosale`
captures each dialog over its own state in light and dark; the movement dialog was
read in the running application at 1920 x 1080.

## 14. Application status (2026-09-30) — the drawer counter takes a keyboard

Counting a drawer is the one thing this screen exists for, and it could only be
done with a finger. An operator with a keyboard — a back-office drawer, a
supervisor recounting a shift — pressed `+` twelve times to say twelve.

The quantity is now a field as well as a pair of buttons. Digits only, three of
them at most (twelve thousand of one note is a typo, not a count), the whole value
selected when focus arrives so typing replaces rather than appends, and `Tab` —
or the return key, through `TextInputAction.next` — walks down the denominations
the way the drawer is counted. The buttons stay exactly as they were for the
counter terminal, where there is no keyboard and the finger is already on the
glass. One controller per denomination lives in the counter's own State, the same
lifetime as the field that reads it; a controller created per build is how this
codebase once took the whole till down.

Two layout faults came out of the change and were fixed against the render:

- The line total had been the last child of the row. With the field in place
  there was 32 px left for it, and "MXN 12,000.00" broke over four lines in the
  count dialog. It now sits under the denomination as `= MXN 12,000.00`, which
  reads as the arithmetic it is: 1,000, counted twelve times, is 12,000.
- The name cell stretched to fill its column, leaving a hand's width of nothing
  between "MXN 1,000.00" and its own buttons on a wide card. It is capped, so
  every row's buttons start at the same offset.

Evidence: `flutter analyze` clean; 432 POS tests pass (five new in
`denomination_counter_test.dart`: typing feeds the tally, the field refuses
non-digits and a fourth digit, the buttons write into the field, focus selects
the value, and a changed denomination set keeps one field per row) with the same
single pre-existing exception. Typing `12` into the 1,000 row was driven in the
running application at 1920 x 1080: the row read `= MXN 12,000.00`, the running
total read `MXN 12,000.00`, and the submit button woke up.

## 15. Application status (2026-09-30) — the keyboard's cursor

The repo's own visual principles ask, at item 6, for a focus state that "looks
deliberate" and "never relies on colour alone", and at item 7 for a keyboard path
that follows the reading order. Neither claim had ever been checked on this
screen. `RENDER_TAB=n` walks the keyboard path before a capture, and a pixel diff
against the resting render says whether anything moved at all.

What the diff found: focus **did** move — one Tab per control, in reading order —
and it **did** draw something, but the whole state was a 22 % overlay of the
accent from the theme's `focusColor`. On the near-black ground that moves a tile's
fill by about seven per cent of 255. Side by side it is just visible; taken alone
it is not a state, it is a rumour. And it is colour alone, which is exactly what
the checklist rules out.

The fix is a ring: two pixels of border that appear on focus and drop back to the
resting border when it goes — a change in _shape_, readable without the hue. A
filled button rings in `onSurface` (near-white on the dark till, near-black on
the light one) because a blue ring on the brand-blue call to action is invisible;
an outlined or text control rings in the accent. The Material 3 defaults were
read first, not guessed: `OutlinedButton` already rings in `primary` on focus,
and our own tile styling had been overriding that away by setting `side` flat.

It is applied through one `Theme` around the screen rather than at twelve call
sites, and `showDialog` captures the inherited themes of the context that opens
it, so the count, movement, close, handoff and no-sale dialogs inherit the ring
too. Nothing about the screen changes until a control has focus — the themed
styles are all `BorderSide.none` at rest, which is what Material gives those
buttons anyway.

I also chased a phantom. A probe said this screen's dialogs did not take keyboard
focus at all: every Tab landed on the screen behind the barrier. It was the probe
— on the default 800 x 600 test surface the movement tiles sit below the fold, so
the tap that was supposed to open the dialog missed. At the till's own viewport
the dialog takes focus on open and holds it. The lesson is in the test now:
`cash_keyboard_test.dart` sets 1920 x 1080 and says why.

Evidence: `flutter analyze` clean; 437 POS tests pass (four new in
`cash_keyboard_test.dart`: every button style thickens to a 2 px opaque border on
focus, nothing changes at rest, a dialog opened from this screen keeps the ring
and the focus, and the ring is drawn against the surface rather than the accent)
with the same single pre-existing exception. `cash-open-tab1|2|5-dark` and
`cash-open-tab2-light` are the goldens of the focused states.

## 16. Application status (2026-09-30) — the windows the ticket names, and how old the money is

Two items from the repo's own checklist had never been rendered or built.

**The small-window case.** Item 10 asks that the screen hold at 1024 and at 390
pixels. 1024 was fine: the page's own padding puts the inner width at 976, under
the two-column breakpoint, so the screen takes its single scrolling column and
reads well. **390 was not.** In the drawer's account the total panel and the
figures shared one row; with 342 px to spend the panel took two thirds of it, the
figures were squeezed into a ~110 px column, and `MXN 1,500.00` broke over two
lines — so the card read as two numbers instead of one amount.

`cashFiguresAndTotal` now decides that row: side by side when the card can hold
both — the answer beside its evidence is the whole point — and stacked when it
cannot, with the total becoming the foot of the card and running its full width,
the way a receipt ends in its total. Both the drawer's account and the variance
card use it. The 390 px render is now correct, and 1024, 1280 and 1920 are
unchanged.

**The stale value.** Item 5 asks the screen to handle "a missing balance, a
missing policy, and a stale value". The drawer's figures are a reading, not a
live feed: the till asks, the answer is a moment old, and on a counter where a
second person can put cash in the same drawer, "this number is from eleven
minutes ago" is the fact behind most disagreements about it. Nothing said so.

`CashController.lastReadAt` records the moment the server last answered — set
where a fresh snapshot is committed in `load()` and in `_reload()`, null before
the first answer — and the state strip prints it beside the drawer, the date and
the time the shift opened: `Actualizado 04:42`. It is a time, not a green dot:
the screen can say when it looked, and only the operator can say whether that is
recent enough.

Evidence: `flutter analyze` clean; 438 POS tests pass (one new: the strip names
the moment, and the controller has none before its first read) with the same
single pre-existing exception. Goldens exist at 390 x 844, 1024 x 768, 1280 x 720
and 1920 x 1080 for the running shift, and the live terminal was read at
1920 x 1080 with the strip showing `Actualizado 04:42`.

## 17. Application status (2026-09-30) — what a screen reader is handed

The last axis never inspected was the one nobody can see: the semantics tree. It
was dumped rather than assumed, and it had two faults that the eye cannot catch.

**The whole screen was a live region.** `_ready` wrapped the entire body in
`Semantics(liveRegion: true, label: <state>)`, so any change anywhere — a
spinner appearing, a refresh, a tap — told a screen reader that something worth
interrupting for had happened. A live region should be a sentence, not a screen.
The announcement now rides on the state strip's own title, and only there.

**The drawer's account was one fourteen-line blob.** The figures were wrapped in
a `Semantics` whose label was the total, with `explicitChildNodes` off, so the
whole card merged into a single node: "La cuenta del cajón, Efectivo esperado: Se
revela al contar, FONDO INICIAL, MXN 1,500.00, … EFECTIVO ESPERADO, MXN ••••••,
Se revela al contar, #3". It said the masked placeholder twice, and it ended on a
bare hash and digit. Now the card reads as the card — title and six terms in order
— and the answer is its own node with one sentence, `Efectivo esperado: Se revela
al contar`, which cross-fades into `Efectivo esperado: MXN 1,460.00` when the
count lands. The ledger sequence carries a name (`Secuencia del libro 3`) instead
of being read as punctuation.

The journal already read correctly, one sentence per row — "Ventas en efectivo /
08:04 · MXN 500.00 − MXN 190.00 · Luis M. · A-1042 / +MXN 310.00" — and that is
now pinned too.

Evidence: `flutter analyze` clean; 441 POS tests pass (three new in
`cash_semantics_test.dart`: the live regions are the state and the answer and
nothing else, the account is one card and one answer, and a revealed count is
announced with its figure) with the same single pre-existing exception.

## 18. Application status (2026-09-30) — the role that can only look

One state was still unexplained rather than designed. An operator holding
`cash.shift.read` and nothing else — an owner at the till, an auditor — got the
drawer's account and the journal, no buttons at all, and an entire empty half of
the screen. The checklist's item 2 asks an empty state to "explain the cause and
give one action"; this one explained nothing, and a console that draws fewer
buttons without saying why reads as a console that is broken.

That state now wears the same two-column shell as every other screen in this tab:
the account and the journal at the left, and a rail carrying **Solo consulta** —
`Con tus permisos actuales no hay acciones de caja para este turno. Puedes
consultar la cuenta del cajón y el libro del turno; si necesitas mover efectivo o
cerrar el turno, pídeselo a un encargado.` — with the drawer's policy beneath it,
because the rules still bind the person who cannot act on them.

The wording is deliberately about _this shift_ and not about the role. The screen
cannot know the whole role: a supervisor who may reconcile but may not count sees
the same empty rail until somebody counts, and "your role cannot close a shift"
would be a lie about them. What the screen can see is that there is nothing to do
here yet, and that is what it says.

Evidence: `flutter analyze` clean; 442 POS tests pass (one new in
`cash_center_test.dart`: the note is shown, the policy is still shown, and the
drawer really has nothing to press — no outlined button and no count call to
action) with the same single pre-existing exception. Goldens at 1920 x 1080 and
390 x 844.

## 19. Application status (2026-09-30) — the drawer that does not answer

The hardware doc states the rule this screen was breaking: "The cash ledger action
commits before the drawer command. A drawer failure does not change a financial
fact." Which means a drawer failure is a real, planned-for outcome — and the till
was throwing it away. `CashController._runPostCommit` ran the post-commit
hardware callback with `unawaited(... .catchError((_) {}))`: the operator pressed
_Solicitar apertura de cajón_ or _Salir de efectivo_, the ledger committed, the
drawer stayed shut, and the screen said nothing at all. A person standing at a
closed drawer with a completed movement and no message has no way to tell a
broken kick from a slow one.

Three small changes, in the order they matter:

- The controller's `afterCommit` callback now answers a question — **did the
  hardware take it?** — instead of being fire-and-forget. The controller still
  knows nothing about drawers; the composition root, which does, turns the
  runtime's per-command results into one boolean.
- `CashState.drawerUnanswered` carries that answer, and `_noteDrawerUnanswered`
  records it. It clears on the next command, because the notice is about the last
  thing the operator did, not a state the drawer is stuck in.
- The screen says it in a new tone. `InlineNotice` grew
  `InlineNoticeTone.warning` and `UmiTheme.warning` — amber, because error red
  means a _financial_ fact failed and on this till that is almost never what
  happened. The words are the point: _"El cajón no respondió. La operación quedó
  registrada; ábrelo a mano y avisa al encargado."_

The notice itself was also a latent bug. It was cached in `_changed()` when the
controller notified, so a notice that arrived before the screen was built — or
while it was rebuilding for another reason — was never shown. It is now a pure
function of the state, read on every build, which is the only way a message
cannot be missed.

Evidence: `flutter analyze` clean; 443 POS tests pass (one new: a controller whose
hardware answers `false` records `drawerUnanswered`, the screen shows the warning,
and it does not show the cash-failure message) with the same single pre-existing
exception. `cash-notice-dark.png` and `cash-notice-light.png` are the two tones
side by side, and the running application was rebuilt and read at 1920 x 1080 to
confirm the new wiring boots and shows no spurious warning on a screen where
nothing has committed yet.

One self-inflicted wound this pass, recorded because it is the kind that hides:
running `dart format lib/` to tidy my own files reformatted **sixteen unrelated
files**, and one of those reflows tripped a lint. All sixteen were restored to
`HEAD` and the analyzer is clean again; formatting is now scoped to the files a
change actually touches.

## 20. Application status (2026-09-30) — the count at phone width

The last check on the checklist is the small-window one, and the count dialog had
never been rendered at 390 px — because the harness could not open it there. The
tap that opens it sits below the fold on a narrow window, so the render silently
photographed a screen with no dialog on it. `ensureVisible` fixed the harness; the
first honest picture showed the dialog reporting **a 10 px overflow across its own
steppers**.

The arithmetic was exact. A quantity row is a fixed set of things: two 48 px tap
targets, a field, and the denomination. Material's `AlertDialog` insets 40 px a
side, the dialog pads 24 more, and on a 390 px window that leaves 262 px of
content — 10 px less than the row's 272 px minimum. Four changes, all of them to
the row's minimum or the box it is given:

- the quantity field is 64 px instead of 76 (three digits and their padding),
- the denomination cell clamps to 88 px instead of 96,
- the dialog's own horizontal inset is 16 px instead of Material's 40,
- and the count scrolls inside the content box rather than through
  `AlertDialog.scrollable`, which wraps the actions in an intrinsic-width bar
  that overflows at phone width — tried, measured, reverted.

The total row was made font-proof while I was in there: the label is `Expanded`
with an ellipsis and the figure is not. Money is the one thing on that row that
must never be shortened; a font or a locale with wider glyphs should cost the
label a few characters, not the number its digits.

The harness learned two things. `RENDER_DENOMINATIONS=full` renders the drawer the
app actually has — eleven denominations, not the three that make a screenshot look
comfortable — and at 1280 x 720 all eleven fit in two columns with the note, the
total and the actions, nothing to scroll. And the regression test lives with the
counter rather than the screen: the first version pumped the whole dialog and
failed on the equation card, whose labels have no ellipsis and overflow under the
test font's square glyphs. The counter at 310 px — the box the dialog leaves it —
is the thing that actually broke, and that is what the test now pins.

Evidence: `flutter analyze` clean; 444 POS tests pass (one new, the counter at a
phone-width box) with the same single pre-existing exception. Goldens at
390 x 560, 390 x 844, 1280 x 720 and 1920 x 1080 for the count dialog, and the
running terminal shows all eleven denominations, the note, the total and both
actions on one screen.

## 21. Application status (2026-09-30) — progress with a shape

One item of the repo's checklist was still unmet, and it was the first thing the
operator sees on a slow network. Item 3 asks a loading state to show "progress in
the shape of the coming content. It does not show 'No records'." This screen
answered a pending first load with a centred `CircularProgressIndicator`: progress
without a shape. The operator waited, and then the entire screen arrived at once
and everything they had been looking at moved.

It is now a skeleton of the screen itself — `_CashSkeleton`, built from
placeholders that are grey blocks on the real cards: the state strip, the drawer's
account with its total beside the figures, the movement tiles in their 2 x 2 grid,
the journal's rows, the close path's four steps and its one action, and the policy
table. The account uses the same two helpers the real card uses
(`cashFiguresAndTotal` for the stack, and the same 6/3/2/1 column rule for the
terms), so it lines up term for term at every width instead of approximating.

It is deliberately still. The app bar already carries a progress bar for a load
in flight, and a second animation on the same screen would be decoration. When
the numbers land, nothing moves.

Evidence: `flutter analyze` clean; 446 POS tests pass — one new, which holds the
first load open and asserts the skeleton is on screen, that there is no
`CircularProgressIndicator`, and that the progress bar is still there — and the
pre-existing `checkout_point_tender_test.dart` timing case **passed** in this run,
which is the clearest evidence yet that it is flaky rather than broken: nothing in
this pass touches checkout. Goldens for the waiting screen exist in dark at
1920 x 1080 and 390 x 844 and in light at 1920 x 1080; the running terminal was
rebuilt and read to confirm the loaded screen is untouched.

## 22. Application status (2026-09-30) — a policy that does not say something

Two checklist items were still open: the partial state ("a missing balance, a
missing policy, and a stale value") and the long-string and large-number cases.

**A missing policy value was rendered as a confident zero.** Every threshold in
the policy table fell back to `MXN 0.00` and every switch to its "off" name, so a
payload that omitted a field read as a rule the owner never made: a tolerance of
nothing, a count that is never blind, a drawer that needs no connection. The table
now reads the payload it was given: a threshold that is not there says **Sin
definir**, a switch that is not there says **Sin definir**, and neither claims the
value. The one deliberate exception is the opening-float ceiling, which stays a
conditional row — an absent ceiling means "no ceiling", which is a fact, not a
gap.

**Long names and large amounts, rendered rather than assumed.**
`RENDER_EXTREMES=1` swaps the fixture for what a real shift can hold: a register
called _Caja principal de la sucursal Centro Histórico_, an operator called _María
Fernanda Rodríguez Villaseñor_, a receipt with a reprint suffix, a reason code
with four words in it, and every figure multiplied by a thousand — a café that
took `MXN 1,500,000.00`, not an afternoon's `MXN 1,500.00`. Nothing broke: the
strip holds the long drawer name, the account's two- and three-column grids hold
seven-digit amounts, and the journal's detail line ellipsises rather than pushing
the row. Rendered at 1920 x 1080 and 1280 x 720, no overflow in either.

That render also caught a harness fault worth naming: the extreme fixture wrote
over the ordinary goldens, because the file name did not carry the variant. A
golden that overwrites its own twin proves nothing about either, so the variant is
now part of the name.

Evidence: `flutter analyze` clean; 446 POS tests pass with one new — a policy
missing three fields shows `Sin definir` three times and never shows `MXN 0.00`,
`Conteo visible` or `Requiere conexión` — and the pre-existing
`checkout_point_tender_test.dart` timing case failed again in this run, which
keeps its record honest: it passes and fails without anyone touching checkout.
`cash-open-extreme-dark-1920x1080.png` and `cash-open-extreme-dark-1280x720.png`
are the long-string, large-number renders; the running terminal was rebuilt and
read to confirm the live policy still shows its real values rather than `Sin
definir`, which is the check that the table reads the keys the API actually
sends.

## 23. Application status (2026-09-30) — the last unverified state, and a sweep

Two things closed the checklist out.

**Hover**, the one state on it I had never looked at. `RENDER_HOVER=1` puts a
mouse pointer on the first movement tile and captures the frame; the diff against
the resting render is 20,617 changed pixels across the tiles at up to 108/255 per
channel. Material's hover overlay on a filled tile is a clear fill lift — the
state is deliberate as it stands, and unlike the focus overlay it did not need
help. (The counter terminal has no mouse; the back desk does, and it is the same
build.)

**A sweep of every state at the reference viewport.** 1280 x 720 is the size this
screen was designed against and the one I had only spot-checked. Rendering all
eleven states there found three overflows, all of them the same one: the skeleton
had no height rule. The real screen stops expanding the journal below 640 px of
height and scrolls the whole column instead; the skeleton kept an `Expanded`
journal in a 146 px space and reported its own rows as a 142 px overflow. It now
uses the real screen's rule, and the loading test runs at 800 x 600, 1280 x 720
and 390 x 844 rather than one window — the reference size is the one that was
broken, and a size a test cannot reach does not get covered.

Evidence: `flutter analyze` clean; 446 POS tests pass with the same single
pre-existing flaky case. `cash-open-hover-dark-1920x1080.png` is the hover state,
`cash-loading-dark-1280x720.png` the reference-viewport skeleton, and every state
of the screen now exists as a golden at 1280 x 720, 1920 x 1080 or both.

## 24. Application status (2026-09-30) — the screen's own findings list

The deep-design document ends with a ranked findings list. The screen had never
been audited against it, and two of its items are the screen's problem, not the
API's — one because the screen **printed a rule the server did not follow**, and
one because the screen would have **diagnosed the wrong cause**.

**Finding 5.1: the close approval compared the wrong number.** The API gated
`closeApprovalRequired` on `expectedDrawerCash > closeApprovalThreshold` in three
places — the drawer's _size_, not its over/short. The policy card on this screen
prints that rule as `PIN cierre: diferencia > MXN 5.00`, so the till was stating
a rule the server did not implement: a busy drawer with an exact count asked for a
manager, and a large variance in a small drawer closed without one. The
comparison now runs on `abs(counted − expected)` in all three places, through a
named domain function `closeNeedsApproval` so the rule has one definition and its
own test — the two cases the inverted comparison got wrong are now the two cases
the test names. The approval fingerprint binds the same number it gates on, and
the contract documents the field as a variance rule so the next reader cannot
re-invert it.

**Finding 5.1's sibling, which the screen was about to introduce.** The superset
document's third fixed decision reads: "A missing policy is a visible state… A
missing or expired policy is a blocking state, not an empty screen." The server
sends `recoveryState: 'policy_expired'` and no actions; the screen had no such
state, so an expired policy fell through to the read-only rail I added last week
and would have said _"Con tus permisos actuales no hay acciones de caja"_ — the
wrong diagnosis, sending the operator to ask for a permission that would change
nothing. It is now its own blocking state: the strip headline becomes **La
política de caja venció**, and a warning card says what is blocked, that the money
is not touched, and what to do about it — above the policy table, so the owner can
see which policy lapsed.

**The identity bar carries the policy.** The same decision asks the identity bar
for the policy's version and expiry. Both are now in the state strip beside the
drawer, the business day, the elapsed time and the last read: `Versión pilot-1 ·
Vigente hasta 2027-09-03`. My first attempt put them in the policy card, which
pushed the rail past 1080 and made the operator scroll for the rules; the
specification says the identity bar, and it was right.

That move also caught a formatting bug the fixture had been hiding. The date
render assumed an ISO string; the live repository casts a Postgres timestamp and
sends `2027-09-03 00:13:57.416699+00`, which my `split('T')` left untouched.
Rendering the screen against the real API — not the fixture — is what showed it,
and `_datePart` now takes the leading date from either shape.

Evidence: `flutter analyze` clean; 447 POS tests pass, one new (an expired policy
blocks the screen, says which policy and which day, and never says "Solo
consulta"); the API's own suite is 1671 pass with one new domain test, `tsc`
clean. `cash-policy-expired-dark-1920x1080.png` and `cash-open-dark-1920x1080.png`
are the two states, and the running terminal shows the live policy's version and
expiry in the strip.

## 25. Application status (2026-09-30) — the promise the till could not keep

Deep-design finding 5.3 says `offlineCashShiftAllowed` is read into the policy and
never used, and asks that a flag not "promise a feature". A grep across the
workspace says something sharper: the flag is stored, projected by the API, and
read by **exactly one thing** — this screen's policy card. So the till printed the
promise itself, in the operator's own language, one row under the tolerance.

The row now answers the operator's question instead of the policy's. "Efectivo sin
conexión" — does cash survive a dropped connection? — is answered with what _this
terminal_ can do: **Requiere conexión** when the policy forbids it, and **No
disponible aún** when the policy allows something the build has not built. It
never repeats a promise nothing implements, which is the false promise the
checklist's last item forbids.

The row also stopped being a policy fact, and the test that pinned it changed with
it: a policy that says nothing about offline cash no longer makes the row
"Sin definir", because the row is not about the policy any more. `require
conexión` is true of this till whatever any payload says.

Evidence: `flutter analyze` clean; 447 POS tests pass — the offline test now
asserts that a policy allowing offline cash produces "No disponible aún" and
never "Permitido" — with the same single pre-existing flaky case.
`cash-offline-allowed-dark-1920x1080.png` is the policy that promises it, rendered
to show the row refusing to; the running terminal was rebuilt and read, and shows
`Efectivo sin conexión → Requiere conexión` from the live policy.

Still open from that findings list, and deliberately not taken on here: 5.5 (the
close produces no document, which needs a printer document type), 5.6 (no opening
discrepancy, which needs a previous-close read), 5.7, 5.8, 5.9 (low-severity API
and schema tidy-ups), and 5.3's other half — actually building the offline cash
journal. Those are product scope for the till, not defects in this screen.

## 26. Application status (2026-09-30) — the design language, read at last

I had grepped the product's own design language for focus and keyboard rules and
never read it. Reading it found two things this screen was breaking, both in the
same dialog, and one of them was losing the operator's work.

**The manager was asked for a PIN over nothing.** The language is explicit:
_"Muestra la operación, el alcance y el importe antes de solicitar el PIN."_ The
approval dialog for a movement was a title and a PIN field. A manager had to
decide whether to authorise a payout without being shown that it was a payout, of
what amount, from which drawer, for which reason. It now opens with the sentence
and the figures: _"Vas a aprobar Entrada de efectivo de MXN 120.00."_, then the
reason the operator typed and the drawer it comes from.

**An amount the parser refused was thrown away in silence.** `_movement` read the
two fields, and unless the amount parsed _and_ the reason was non-empty it did
everything the operator would notice as nothing: the dialog closed, no movement
was recorded, and no message appeared. The typing was simply gone. The language
asks that an invalid action be disabled _and_ its requirement stated beside the
field, and calls a dead button without explanation a contradiction.

`CashDialogField` now carries a `validate` and a `helper`, and `CashFieldsDialog`
gates its confirm on the validators while stating the requirement under each
field. A field the operator has not used yet shows its requirement quietly — the
helper line — and only a field they have used, or left a bad value in, turns it
red, so an untouched form explains itself rather than scolding. The same
machinery is available to the other dialogs; only the movement one needed it,
because it is the only one with free-text input the parser can refuse.

Evidence: `flutter analyze` clean; 448 POS tests pass, one new — which drives the
whole path: the empty form refuses and states both requirements, a nonsense amount
keeps it refused, a valid pair wakes it, and the approval dialog that follows says
what it is approving — with the same single pre-existing flaky case.
`cash-open-movement-dark-1920x1080.png` is the form with its requirements and its
quiet confirm, `cash-open-approval-dark-1920x1080.png` is the manager's screen —
the first time that dialog has ever been rendered — and the running terminal was
rebuilt and read to confirm the form.

## 27. Application status (2026-09-30) — the accessibility clauses

The design language has two accessibility clauses this screen had never been
measured against. Both needed work.

**"Admite texto al 200 % en los flujos críticos."** `RENDER_TEXT_SCALE=2` renders
the screen at double text, and the grid of figures is exactly where that breaks.
Two faults came out of it:

- **The equation stopped being an equation.** Its terms are read by position, and
  at 200 % a term whose label wrapped to two lines pushed its own figure down —
  so the figures in a row no longer sat on one line, which is the whole editorial
  reason the grid exists. Every term now reserves its label's lines, so a row's
  figures line up whether the labels wrap or not. At the usual scale one line is
  enough and the card is 2 px different from before; measured.
- **The grid kept its column count while the text doubled.** Three columns of
  `~260 px` hold `−MXN 1,000.00` at 100 % and split it across two lines at 200 %.
  The breakpoints are about how much _text_ a column holds, so they now work on
  the width divided by the scale: at 200 % the account lays out in two columns and
  every figure fits on one line.

**"Respeta la preferencia de movimiento reducido."** The screen's two animations
ignored it. Both now read `MediaQuery.disableAnimationsOf(context)` and take a
zero duration when the platform asks for stillness. The reveal still happens —
the covered figure becomes the answer, the step fills — it just does not travel
to get there, which is exactly what the preference is for.

Everything else in the language checked out on this screen when I went through it
clause by clause: the spacing and radius tokens, one accent per view, tabular
figures on every money value, the 48 px touch floor and the 52 px primary action,
the visible focus (added earlier), the stated requirement beside a disabled
action, a confirmation for the terminal action, native semantics first, and short
Material motion capped at 220 ms.

Evidence: `flutter analyze` clean; 450 POS tests pass — two new, one asserting
that a row's figures share a line at 200 % where one label wraps and its neighbour
does not, and one asserting the reveal's duration is zero when the platform asks
for reduced motion — with the same single pre-existing flaky case. Goldens exist
at 200 % for the running, suspended, busy, closed and expired-policy states, and
the running terminal was rebuilt and read at the normal scale to confirm none of
this moved a pixel.

## 28. Application status (2026-09-30) — the last two typographic clauses

The theme already carries the design language's card radius (20) and the weight
600 it asks for on the large titles. Two clauses were still unmet on this screen,
because the shared theme applies them only to the larger sizes:

- **Weight 600 for titles.** This screen's card titles are `titleMedium`, which
  Material sets at 500. Every section heading — the drawer's account, the
  movements, the journal, the close path, the custody, the policy — now sets 600
  through the screen's own theme override.
- **1.45–1.5 line height for operational text.** The theme sets it on `bodyLarge`
  and `bodyMedium`; the journal's detail lines, the close path's step notes and
  the masked-total hint are `bodySmall`, which Material leaves at 1.33. They now
  sit at 1.45.

Both are one entry each in `_cashControls`, the same screen-scoped override the
focus ring uses, so they travel to the dialogs with it and leave the rest of the
till alone.

Evidence: `flutter analyze` clean; 450 POS tests pass with the same single
pre-existing flaky case; every golden regenerated at the normal scale, in light
and dark, at 1280 x 720, 1920 x 1080 and 390 x 844, and at 200 % text for five
states — 70 images.

## 29. Application status (2026-09-30) — the dialogs at 200 %

Section 27 took the _screen_ to 200 % text. The dialogs are this tab's other
half, and they had not been rendered at that scale. Five of them are clean; the
blind count was not.

**The denomination names were cut to "MXN 1,0…".** The counter's row maths was
fixed: a 170 px name cell, two columns, a 64 px field — every one of those
numbers assumes the text stays the same size. At 200 % `MXN 1,000.00` needs 214 px
and got 158, so it ellipsised — and with `MXN 50.00` and `MXN 0.50` in the same
dialog, two rows read as _the same name_. An operator counting a drawer that way
cannot tell fifty pesos from fifty centavos.

The row now scales with the text where the text lives and stays fixed where the
finger lives: the quantity field grows, the two 48 px tap targets do not, and the
name cell's cap grows with the scale. When a cell can no longer hold the scaled
name, the counter drops to **one column** and the count scrolls — which is what
the dialog's own scroll view was put there for. A name that still will not fit
one line wraps to two rather than being cut: a wrapped amount is still an amount.

At the normal scale the expressions reduce to exactly what they were — the test
asserts two columns at 1× and one column at 2×, and the running terminal's count
dialog is unchanged.

I also repaired a harness fault of my own making: the golden's name did not carry
the denomination count, so a three-denomination render had been overwriting the
eleven-denomination one. A pixel diff between them looked like a regression in
the counter; it was two different dialogs wearing the same filename. The name now
says which drawer it is.

Evidence: `flutter analyze` clean; 451 POS tests pass, one new, with the same
single pre-existing flaky case. `cash-open-count-denoms-dark-1920x1080.png` is the
real drawer at the normal scale, `cash-open-count-text2-denoms-dark-1920x1080.png`
at 200 %, and 77 images are in the set.

## 30. Application status (2026-09-30) — the stranded drawer

One state of this screen had never been rendered: the reclaim panel — a register
whose holding terminal is gone for good. `RENDER_ORPHAN_REGISTER=1` builds the
hold the API sends for it (`held_by_orphaned_till`, `reclaimable: true`) and the
screen drew both of its ways forward at once: **Liberar la caja** in the reclaim
card, and **Abrir turno de caja** in the form below, on the same drawer.

I read the server before calling that a contradiction, and it is not one — the
open path explicitly accepts an orphaned hold (`hold.state !== 'held_by_orphaned_till'`
is the refusal condition) and takes the drawer over as part of opening. Both
actions are real; they are alternatives.

What the screen _was_ doing is presenting one of them as an ordinary action. The
open path marks the stranded shift `blocked`, uncounted, with an `orphan_reclaim`
custody event — a shift abandoned without a count, which is a financially
significant outcome — and the form said nothing about it. The reclaim card says
what its own path costs ("el dinero no se cuenta porque sigue en el cajón"); the
open form said nothing.

It now states it, above the button rather than in the button's refusal: _"Esta
caja quedó retenida por una terminal que ya no existe. Si abres el turno aquí, el
turno anterior queda bloqueado y sin contar: el dinero sigue en el cajón."_ The
warning appears only when the _selected_ register is the stranded one, so a
location with another free drawer is unaffected.

Evidence: `flutter analyze` clean; 452 POS tests pass — one new, which builds the
orphaned hold and asserts the form states the cost while still offering both ways
forward — with the same single pre-existing flaky case.
`cash-orphan-dark-1920x1080.png` is the state, rendered for the first time.

## 31. Application status (2026-09-30) — the two count outcomes left unrendered

Closing the inventory found two more states the harness could build and nobody had
looked at:

- **A variance inside the tolerance** — `MXN 0.50` short against a `MXN 1.00`
  tolerance. It renders correctly: the variance card keeps the figure in the
  surface colour and says `Faltante · Dentro de tolerancia`, and the acceptance
  path stays available.
- **A count explained but not yet reconciled** — steps one and two checked, step
  three current, one action: `Conciliar turno`. Also correct, and the strip still
  says `Se requiere conciliación` because that is still true.

**A correction.** Looking at that first state I read a contradiction into it — the
card says "Dentro de tolerancia" while the only button says "Motivo de la
diferencia" — and described it as the tolerance and the reason requirement
disagreeing. They do not, and the deep-design document says so in its own words:
step two is _"A reason list… A manager PIN is required above tolerance."_ Two
separate rules. `calculateVariance` carries them in two separate fields,
`reasonRequired: signed !== 0` and `approvalRequired: !withinTolerance`, and the
server enforces each where it belongs — a reason before the reconciliation
(`VARIANCE_UNRESOLVED`), a PIN above the tolerance. Any difference is recorded
with its explanation; only a difference the policy calls significant needs a
manager. What looked like a contradiction was me reading one rule as if it were
the other, and it is written down here rather than left as a question.

What the state _does_ show is a smaller, real gap: the operator cannot see whether
a manager will be needed until they press the button and the dialog asks for a
PIN. The screen announces that threshold in the movement dialog, so it should
announce it here too. The variance card's answer now carries the consequence —
`Faltante · Dentro de tolerancia · Sin aprobación`, or `· Pide aprobación` outside
it — from the server's own `approvalRequired`, before anything is pressed.

Evidence: `flutter analyze` clean; 452 POS tests pass with the same single
pre-existing flaky case; 80 goldens, including the two states above.

### 31.1 The approval clause

The variance card's answer now ends with what will happen next:
`Faltante · Dentro de tolerancia · Sin aprobación`, or `· Pide aprobación` when
the over/short is outside it. It comes from the server's own `approvalRequired`,
so the card and the dialog can never disagree, and the rule is visible before the
button is pressed rather than inside the dialog that asks for a PIN — the same
promise the movement dialog keeps with its threshold line.

Evidence: `flutter analyze` clean; 452 POS tests pass with the same single
pre-existing flaky case; the three count outcomes re-rendered,
`cash-within-tolerance-dark-1920x1080.png` among them.
