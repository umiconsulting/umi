# Barista POS UX audit — how the UI translates each cashier action

- Date: 2026-09-05
- Scope: the **barista side** of UmiPOS (`apps/umi-pos`), four action areas: order input (catalog → cart), checkout/payment, shift open/close, and exceptions (void, refund, discount, cash movement, no-sale).
- Frame: the barista wants speed with accuracy under time pressure. This audit tests whether the UI translates each physical action into the fewest, clearest gestures. It does not re-plan the owner dashboard.
- Method (fixed): **physical action → UX translation → engineering**, the same method as
  [operation-driven owner observability and POS friction](2026-09-05-operation-driven-owner-observability-and-pos-friction.md).
- Inputs:
  - Design source: [operation-driven design](2026-09-05-operation-driven-owner-observability-and-pos-friction.md) §1 (the action inventory) and §3 (the barista plan).
  - Research, principles: [POS UX design principles](../research/2026-09-05-pos-ux-design-principles.md) — the 20-rule audit checklist in §13 is the test instrument. Each finding cites a rule number `R#`.
  - Research, volume: [POS cashier and kitchen action volume](../research/2026-09-05-pos-cashier-kitchen-action-volume-research.md) — the tap-cost and +71 s inaccuracy figures.
  - Live evidence: the native Linux POS, driven with `flutter_driver`, operator Barista Kalala, branch Chapultepec. Screens captured 2026-09-05.
  - Code map: `catalog_surface.dart`, `checkout_surface.dart`, `cash_surface.dart`, `exception_surface.dart`, `sale_surface.dart`, `entry_surface.dart`.

## 1. How to read this audit

Each finding lists: what the barista sees (live), the physical action it slows, the research rule it fails (`R#`), the code location, a severity, and a fix.

Severity:

- **High** — it slows or breaks a high-frequency (⚡) action, or it blocks a money ($) action with no clear recovery.
- **Medium** — it adds friction or risk but the action still completes.
- **Low** — it is polish; it does not change the outcome.

## 2. What already works (do not redo)

The prior cycle delivered two wins; the live app confirms both. Keep them.

- **Checkout collapsed to one gesture.** The payment sheet shows one primary **"Cobrar"** that authorizes and commits when the recomputed total matches. Cash is the default tender, the exact amount is pre-filled, and quick-tender chips (`Importe exacto`, `MXN 100/200/500`) avoid the keypad. This meets R5 (tap budget) and part of R14 (change path). `checkout_surface.dart`.
- **Single-tap add for plain products.** A product with no variant and no modifier group adds in one tap, with no sheet. This meets R4. `catalog_surface.dart` `_showDetail`.

## 3. Findings summary

| ID  | Area        | Finding                                                                  | Rule        | Severity |
| --- | ----------- | ------------------------------------------------------------------------ | ----------- | -------- |
| F1  | Order input | Modifiers flatten 3 dimensions into 12 cryptic compound chips            | R8, R9, R13 | High     |
| F2  | Order input | Crucial modifiers are optional; an ambiguous drink can be sold           | R13, R6     | High     |
| F3  | Shift close | The blind count is one free-text field; no denomination keypad or total  | R15         | High     |
| F4  | Shift       | The active-shift screen shows no drawer state (float, expected, time)    | R16, R17    | High     |
| F5  | Shift close | The close path hides behind "Iniciar conteo ciego"; no "Cerrar turno"    | R12, R16    | High     |
| F6  | Exceptions  | The refund/void block is a generic, duplicated error with no reason      | R-error     | High     |
| F7  | Order input | Most product tiles are a generic cup icon; hard to recognize at a glance | R8          | Medium   |
| F8  | Order input | The grid and category rail mix non-sellable and admin items              | R9          | Medium   |
| F9  | Order input | No most-sold / favourites set for the top drinks                         | R9, R3      | Medium   |
| F10 | Exceptions  | Sale-history actions are three tiny icon-only buttons, no labels         | R1, R8      | Medium   |
| F11 | Checkout    | The sheet shows the operator UUID, not the operator name                 | R8          | Medium   |
| F12 | Checkout    | A loyalty lookup ("Consulta en curso") runs on every sale, anonymous too | R10         | Medium   |
| F13 | Exceptions  | The sales sheet has no visible close control                             | R-control   | Medium   |
| F14 | Login       | The PIN entry is a text field, not an on-screen number pad               | R1, R3      | Medium   |
| F15 | Shift       | The action row gives cash moves and shift lifecycle equal weight         | R12         | Low      |
| F16 | Checkout    | Two pre-filled cash fields make it unclear which to edit for change      | R14         | Low      |
| F17 | All         | Touch-target sizes are not verified against R1/R2                        | R1, R2      | Verify   |

`R-error` and `R-control` are named rules from the research file (§5 error messages, §9 Clover Cancel/controllability) that sit outside the numbered checklist.

## 4. Order input (catalog → cart)

The most frequent ⚡ action. Two findings are High.

### F1 — Modifiers flatten three dimensions into twelve compound chips (High)

- **Live:** open **Americano**. The sheet titled "Modificadores → Opciones" shows twelve chips: `CH, CALIENTE, 1oz leche`, `CH, CALIENTE, normal`, `CH, FRAPPE, 1oz leche`, `CH, FRAPPE, normal`, `CH, ROCAS, 1oz leche`, `CH, ROCAS, normal`, and the same six for `GDE`. The chips are a full cartesian product of three real choices: size (CH/GDE), temperature (CALIENTE/FRAPPE/ROCAS), and milk (1oz leche/normal).
- **The action it slows:** the barista makes three quick decisions (size, temperature, milk). The UI makes the barista read twelve comma-separated compound labels and find the one row that matches all three. The abbreviations (`CH`, `GDE`) are not self-descriptive.
- **Rules failed:** R9 (chunk the choices — 2 + 3 + 2 = 7 grouped options, not 12 combined), R8 (recognition, not recall — a compound string is parsed, not recognized), R13 (a modifier group is a group, not a flat list). Hick's law: choice time grows with the count of options, so 12 is slower than three small groups. The product also gets worse as dimensions grow — a fourth dimension makes 24 chips.
- **Where:** `catalog_surface.dart` `_Detail`, which renders `detail.optionGroups`/variants as flat `ChoiceChip`s.
- **Fix:** render each option group as its own labelled selector (Size | Temperature | Milk). If the source data pre-combines the dimensions into one variant list, split the compound variant into named groups at the adapter, so the UI shows three short rows. Pre-select the common combination.

### F2 — Crucial modifiers are optional; an ambiguous drink can be sold (High)

- **Live:** in the same sheet, no option is pre-selected, and **"Agregar al carrito" is enabled with nothing chosen**. Tapping it adds "Americano" to the cart with no size, temperature, or milk. The cart line reads only "Americano".
- **The action it slows:** none — but it removes accuracy. The kitchen or the barista then guesses the size and temperature. The volume research puts the cost of an inaccurate order at +71 s.
- **Rules failed:** R13 (force a choice only where the item cannot be made without it — size and temperature qualify), R6 (prevent the error; do not rely on the worker to remember).
- **Where:** `catalog_surface.dart` `_Detail` add-button enable logic; the required flag on the option group.
- **Fix:** mark the crucial groups required in the catalog data and disable "Agregar al carrito" until each required group has a choice. This is error prevention, not an extra tap, because the barista must pick a size anyway.

### F7 — Most product tiles are a generic cup icon (Medium)

- **Live:** on the clean catalog, only a few products (Americano, Americano Limón, one bottle) show a photo. The rest show the same generic cup glyph. A grid of near-identical tiles forces the barista to read each name.
- **Rules failed:** R8 (recognition), glanceability (research §6).
- **Fix:** show product photos. Kalala already has 32 real product photos in `merchant.product_media` (see the catalog-photo note). Where a photo is missing, use a color and a bold initial, not one shared glyph.

### F8 — The grid mixes non-sellable and admin items (Medium)

- **Live:** the grid shows `BADLANDS — RENTA ESPACIOS — MXN 0.00` and `BOLSA DÁTIL 1 KG — Sin categoría — MXN 230.00` next to drinks. The category rail includes `RENTA ESPACIOS`, `MERCH`, `Sin categoría`, `OTROS`. These sit on the barista's fast path but are not café sales.
- **Rules failed:** R9 (keep each choice small and relevant). Extra tiles enlarge the Hick's-law choice for no gain.
- **Fix:** hide zero-price and non-sellable items from the POS grid, or move admin categories behind a filter. Keep the default view to sellable café items.

### F9 — No most-sold / favourites set (Medium)

- **Live:** there is no favourites or most-sold rail; the code map confirms none exists.
- **Rules failed:** R9 and R3 (put the top products first, as the largest, nearest targets).
- **Fix:** add a "most-sold" rail at the top of the grid, built from sales history. This was planned in the design doc §3.2 and is not yet built.

## 5. Checkout / payment

The collapse win holds (see §2). The rest is Medium and Low.

### F11 — The sheet shows the operator UUID, not the name (Medium)

- **Live:** the checkout header reads `Operador: 76f79fb4-db86-e41d-bd44-b68e346b8c81`. A raw GUID means nothing to a barista.
- **Rules failed:** R8 (self-descriptive, recognizable).
- **Where:** `checkout_surface.dart` header.
- **Fix:** show the operator name ("Barista Kalala"), which the session already holds.

### F12 — A loyalty lookup runs on every sale (Medium)

- **Live:** the sheet shows `Valor del cliente — Consulta en curso.` even for an anonymous sale with no customer attached. The lookup sits on the payment path.
- **Rules failed:** R10 (feedback within ~0.1-1 s; do not show a pending state that does not apply). A network call on the critical path risks a stall on a slow link.
- **Fix:** run the loyalty lookup only when a customer is attached. Hide the block for an anonymous sale.

### F16 — Two pre-filled cash fields (Low)

- **Live:** the cash section shows `Importe aplicado` = 55.00 and `Efectivo recibido` = 55.00, both pre-filled. For exact cash this is fine, but when the customer pays with a 100 it is unclear which field to change to show the change.
- **Rules failed:** R14 (the change path must be obvious).
- **Fix:** the quick chips already cover the common case (tap `MXN 100.00` → change shows). Consider one primary "cash received" field, with "applied" derived, and confirm the change-due number is large and stays visible until the next sale (R14).

## 6. Shift open / close (Centro de caja)

Three High findings. This flow is the weakest translation of a physical action.

### F3 — The blind count is one free-text field (High)

- **Live:** tap "Iniciar conteo ciego". The dialog shows a single "Efectivo contado" text field and "Enviar conteo ciego". The opening float uses the same single-field pattern.
- **The action it slows:** the physical action is counting bills and coins across six or more denominations. The UI asks the barista to sum the whole drawer in the head and type one number. This is slow and error-prone.
- **Rules failed:** R15 (a denomination keypad with a live running total; the system computes the total).
- **Where:** `cash_surface.dart` `_count` and `_OpenShiftSection`.
- **Fix:** build a denomination keypad — one row per bill and coin, a live running total, and the total submitted as the count. This was planned in the design doc §3.3 and is not yet built.

### F4 — The active-shift screen shows no drawer state (High)

- **Live:** the active Centro de caja shows a header ("Turno abierto · Caja Linux · 2026-09-05") and a row of five buttons. It shows no opening float, no expected cash, no time open, and no sales count. The screen is mostly empty.
- **The action it slows:** the barista and the owner cannot read the state of the drawer before they act. At close, R17 needs Expected, Actual, and the signed variance on screen.
- **Rules failed:** R16 (show the starting balance at the count step), R17 (show Expected / Actual / variance at close), visibility of status (research §6).
- **Where:** `cash_surface.dart` `_ActiveShiftSection`.
- **Fix:** add a shift status card — opening float, expected cash, time open, sales count — and, at close, the Expected / Actual / signed-variance block. The blind count stays blind (do not show expected before the count), but the other facts are safe to show.

### F5 — The close path hides behind "Iniciar conteo ciego" (High)

- **Live:** to close a shift, the barista must tap "Iniciar conteo ciego" first. There is no "Cerrar turno" control on the active screen. The close only appears after count → resolve variance → reconcile. A barista who wants to close will not read "start blind count" as "close the shift".
- **Rules failed:** R12 (consistent, self-descriptive placement), R16 (a numbered, self-descriptive flow).
- **Where:** `cash_surface.dart` `allowedActions` ordering and labels.
- **Fix:** show a clear "Cerrar turno" primary that starts the numbered flow (count → variance → reconcile → close) with a progress line, so the barista sees the whole path from the start. Keep the blind count as step 1 inside that flow, not as the entry label.

### F15 — The action row gives every action equal weight (Low)

- **Live:** "Entrada de efectivo", "Salida de efectivo", "Retiro a caja fuerte", "Suspender turno", and "Iniciar conteo ciego" are five identical outline buttons in one row. Frequent cash moves and rare lifecycle actions look the same.
- **Rules failed:** R12 (hierarchy and fixed placement).
- **Fix:** group cash movements together and set the shift lifecycle (close, suspend) apart, with the close as the prominent action.

## 7. Exceptions ($ actions)

The refund flow has a good structure (type → reason → scope → one confirm, with manager-PIN gating — this meets R19 and R20). The problems are in the error state and the entry points.

### F6 — The refund/void block is a generic, duplicated error (High)

- **Live:** a blocked post-sale action shows a dialog titled "Reembolso o anulación" with the message **"El servidor bloqueó esta acción posterior a la venta."** — and the body repeats the **identical** sentence. It gives no reason and no next step.
- **The action it slows:** a money action fails and the barista does not learn why or what to do (wrong approver, missing policy, already-cancelled sale).
- **Rules failed:** error-message rule (research §5, NN/g heuristic #9 — help users recognize and recover): state the cause and the remedy; never repeat the title as the body.
- **Where:** `exception_surface.dart` error rendering; the message maps every server rejection to one string.
- **Fix:** map the server reason to a specific message and a next step ("This sale is already cancelled", "A manager PIN different from the operator is required", "Refunds are not enabled for this branch"). Never show the same sentence twice.

### F10 — Sale-history actions are three tiny icon-only buttons (Medium)

- **Live:** in the "Ventas" sheet, each completed sale shows three small icon-only buttons (print, post-sale actions, receipt) with no text. They look alike and are small targets.
- **Rules failed:** R1 (target size), R8 (recognition — an icon alone is not self-descriptive).
- **Where:** `sale_surface.dart` `_SaleCenter` row trailing actions.
- **Fix:** add a text label or a clear, distinct icon plus tooltip, and enlarge the targets. Consider one "Acciones" control that opens a labelled menu.

### F13 — The sales sheet has no visible close control (Medium)

- **Live:** the "Ventas" bottom sheet has no close button. The only exit is a tap on the thin dimmed strip above the sheet. (The refund dialog on top of it does have an X; the sheet under it does not.)
- **Rules failed:** controllability (research §9 — Clover requires a Cancel path out of a flow).
- **Where:** `sale_surface.dart` sheet chrome.
- **Fix:** add an explicit close button to the sheet header, as the checkout sheet already has ("Cerrar").

## 8. Cross-cutting

### F14 — PIN entry is a text field, not a number pad (Medium)

- **Live:** the operator login shows "Ingresa tu PIN de operador" with a single text field and the hint "Usa de 4 a 8 dígitos". On a touch POS this needs the OS keyboard.
- **Rules failed:** R1/R3 (large, touch-first targets). A numeric login on a touch device should be an on-screen pad.
- **Where:** `entry_surface.dart` `_PinLogin`.
- **Fix:** show an on-screen numeric keypad with large digit targets for the PIN.

### F17 — Touch-target sizes are not verified (Verify)

- The modifier chips and the sale-history icons look small, but this audit did not measure pixels. Measure the high-frequency targets against R1 (≥ 48 dp) and R2 (≥ 8 dp spacing). Raise the top-product tiles, the "Cobrar" button, and the tender chips above the floor and give the top products the largest tiles (R3).

## 9. Recommended sequencing

1. **High, order input (⚡, every transaction):** F1 grouped modifiers and F2 required-choice enforcement. These fix the most frequent action and remove the +71 s inaccuracy risk.
2. **High, shift (money, once per shift but error-prone):** F3 denomination keypad, F4 shift status card, F5 clear close flow. These three fix the weakest flow together.
3. **High, exceptions (money):** F6 real error messages — small change, high value when a refund fails.
4. **Medium, order input recognition:** F7 photos, F8 grid cleanup, F9 most-sold rail.
5. **Medium, polish:** F10 sale-history labels, F11 operator name, F12 loyalty lazy-load, F13 sheet close, F14 PIN pad.
6. **Verify:** F17 target-size measurement across the high-frequency screens.

## 10. Checklist result (research §13)

| Rule                               | Result  | Note                                                |
| ---------------------------------- | ------- | --------------------------------------------------- |
| R1 target size ≥ 48 dp             | Verify  | measure chips and sale-history icons (F10, F17)     |
| R2 spacing ≥ 8 dp                  | Verify  | F17                                                 |
| R3 thumb zone, top products larger | Fail    | no most-sold set; tiles uniform (F9)                |
| R4 single-tap add                  | Pass    | delivered                                           |
| R5 tap budget                      | Pass    | checkout collapse delivered                         |
| R6 confirmation discipline         | Partial | checkout good; F2 lets an ambiguous order pass      |
| R7 undo                            | Fail    | no undo window found; hard dialogs used             |
| R8 recognition                     | Fail    | F1, F7, F10, F11 — compound labels, glyphs, UUID    |
| R9 grid chunking                   | Fail    | F8, F9 — admin items, no most-sold                  |
| R10 feedback ≤ 0.1 s               | Partial | F12 loyalty pending on every sale                   |
| R11 contrast                       | Verify  | not measured                                        |
| R12 fixed placement / hierarchy    | Partial | F5, F15 — close hidden, flat action row             |
| R13 forced choice when crucial     | Fail    | F1, F2                                              |
| R14 change display                 | Partial | chips help; verify persistence (F16)                |
| R15 denomination keypad            | Fail    | F3 — single field                                   |
| R16 numbered shift flow            | Fail    | F4, F5                                              |
| R17 variance shown                 | Fail    | F4 — no expected/actual/variance on screen          |
| R18 resume a partial count         | Pass*   | recovery gap fixed in the prior cycle (verify live) |
| R19 exception authorization        | Pass    | manager-PIN gating exists                           |
| R20 reason capture + scope         | Pass    | refund flow captures type, reason, scope            |

`Pass*` = fixed in code (`pos-cash.repository.ts`); confirm on a clean shift.

## 11. Status — implemented 2026-09-05

All 17 findings were implemented and verified against the live Linux POS
(operator Barista Kalala, branch Chapultepec), unless noted. `dart analyze lib`
is clean; the POS test suite passes except two pre-existing failures unrelated
to this work (see below).

| ID  | What shipped                                                                                                                                                                            | File(s)                                                | Verified live                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| F1  | `_Detail` honours `required`/`minSelections`/`maxSelections`: single-select chips when `max==1`, multi capped at `max`, a per-group hint (`Requerido`/`Elige una`/`Hasta N`/`Opcional`) | `catalog_surface.dart`                                 | Renders per metadata (hint shows). Single-select needs the menu SQL below. |
| F2  | "Agregar al carrito" disabled until every required group is satisfied                                                                                                                   | `catalog_surface.dart`                                 | Same — active once a group is `min≥1`                                      |
| F3  | Denomination keypad with a live running total for the blind count **and** the opening float; feeds the `denominations` the API already stores                                           | `denomination_counter.dart` (new), `cash_surface.dart` | Yes — keypad with all MXN denominations + `Total contado`                  |
| F4  | Shift status card shows time-open (`Abierto hace 4 h 4 min`)                                                                                                                            | `cash_surface.dart`                                    | Yes                                                                        |
| F5  | Numbered close flow: `Cierre de turno` card with steps 1 Contar → 2 Registrar diferencia → 3 Conciliar → 4 Cerrar, current step highlighted with its action                             | `cash_surface.dart`                                    | Yes                                                                        |
| F6  | Post-sale block/failure maps each server code to a specific message + next step; title ≠ body                                                                                           | `exception_surface.dart`                               | Code paths mapped (real codes)                                             |
| F7  | Colour + initials placeholder for photo-less products                                                                                                                                   | `catalog_surface.dart`                                 | Yes — distinct tiles (3Q, AG, AM…)                                         |
| F8  | Zero-price (non-sellable) products hidden from the grid                                                                                                                                 | `catalog_surface.dart`                                 | Yes — RENTA ESPACIOS gone                                                  |
| F9  | `Frecuentes` quick-add rail from this register's add history (device-local)                                                                                                             | `frequent_products.dart` (new), `catalog_surface.dart` | Yes — chip appears after an add                                            |
| F10 | Sale-history actions become one labelled `Acciones de la venta` menu                                                                                                                    | `sale_surface.dart`                                    | Compiles; same gating                                                      |
| F11 | Checkout header shows the operator name, not the UUID                                                                                                                                   | `checkout_surface.dart`                                | Yes — `Operador: Barista Kalala`                                           |
| F12 | Loyalty lookup only when a customer is attached                                                                                                                                         | `checkout_surface.dart`                                | Yes — no block on anonymous sale                                           |
| F13 | Close button on the sales-history sheet                                                                                                                                                 | `sale_surface.dart`                                    | Compiles                                                                   |
| F14 | On-screen numeric PIN keypad (large targets, masked dots)                                                                                                                               | `entry_surface.dart`                                   | Yes                                                                        |
| F15 | Actions grouped: `Movimientos de caja` vs `Turno` vs `Cierre de turno`                                                                                                                  | `cash_surface.dart`                                    | Yes                                                                        |
| F16 | `Cambio` shown as a large, prominent number                                                                                                                                             | `checkout_surface.dart`                                | Yes                                                                        |
| F17 | New widgets built at ≥48 dp (PIN keys ≥88 dp)                                                                                                                                           | (new widgets)                                          | Partial — a full measurement pass is still owed on the older chips         |

### Follow-ups (not code in the POS app)

1. **Menu data for F1/F2 (needed for the live single-select).** Kalala's 42
   "Opciones" groups are configured `min_select=0 / max_select=NULL`
   (optional, unbounded multi-select) though each option is a mutually-exclusive
   combination. Set them to required single-select so the metadata-aware UI
   renders single-select required chips. The SQL is
   `scratchpad/fix-combined-option-groups.sql` (a sandboxed DB write blocked the
   inline apply). A fuller fix splits each combined group into real Tamaño /
   Temperatura / Leche groups with per-dimension prices — a menu-editor task.
2. **F9 global "most-sold".** The shipped rail is device-local (this register's
   own add history). A cross-device most-sold from sales history needs a small
   aggregation endpoint (`order_item` by product for the location); none exists
   today.

### Pre-existing test failures (not from this work)

- `checkout_test.dart` "renders authoritative totals and payment methods" — was
  already red at HEAD: it taps a `Review authoritative totals` button removed by
  the prior checkout-collapse cycle (design doc §6), and its later assertions
  depend on a `policy` that only populates after an authorize.
- `realtime_contract_test.dart` "mirrored realtime constants match the contract"
  — from the in-progress realtime contract changes in the session-start working
  tree (`packages/contract/src/realtime*.ts`); no realtime file was touched here.
