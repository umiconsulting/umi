# The overflow menu, walked: two dead ends and one hundredfold

Date: 11 October 2026, 08:09–08:47 MST. Device: iMin D3-504 running the Estación build from this
tree (recipe at the end of `2026-10-11-imin-keyboard-stays-open.md`), API from this tree on `:4013`,
demo merchant, normal text size, Spanish.

The `Más` menu in the till's header was the one part of the new design nothing had walked. It holds
five destinations, and three of them cost real work: **the customer centre** (points, gift cards,
history), **inventory operations** (adjust, waste, damage, blind count, produce, refund
disposition), and the **hardware centre** (USB printer, print queue, test page, controlled reprint).
Two of them ended in a wall, and both are fixed and re-measured on the hardware.

## The three walls

| Where                                                           | What the till did                                                                                                               | Cause                                                                                                                                                                                               | State                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Customer centre — a history row, and the gift-card confirmation | printed the _minor units_ with a currency code: a `MXN 20.00` wallet hold read `2000 MXN`, a `MXN 500.00` card read `50000 MXN` | `customer_value_surface.dart` formatted money by hand twice instead of using the app's one formatter                                                                                                | **fixed, verified on the till**  |
| Inventory — the pending refund disposition                      | `409 APPROVAL_REQUIRED`, manager approves, re-send dies, decision stays pending forever under a generic banner                  | `SELECT … FOR UPDATE` on `merchant.pos_restock_intent`, a table Gate 3D makes append-only and `90_rls.sql` revokes `update` from the API on: PostgreSQL answers `500 permission denied for table …` | **fixed, verified on the till**  |
| Inventory — the same approval, one refresh later                | the approval lands and nothing happens at all                                                                                   | `InventoryController.load()` rebuilt the state without `pendingOperation`, so any refresh while the approver typed a PIN discarded the command waiting for it                                       | **fixed, pinned by a unit test** |

## The customer centre

Search, the customer's detail, `Ajustar puntos`, `Emitir tarjeta`, `Adjuntar a la venta` and the
history filter (`Todo / All`, `Ventas / Sales`, `Reembolsos / Refunds`, `Puntos / Points`, `Rewards`,
`Wallet`, `Gift cards`) all work with taps.

1. **Points adjust** — `Ajustar puntos` → `Aumentar`, 10 points, `Corrección de servicio` → `Revisar`
   → `Confirma el ajuste` (`Saldo actual: 0`, `Saldo final: 10`) → `Confirmar`. The API logs
   `POST …/customer-value/points/adjustments` **201**, the card reads `Puntos disponibles 10` and the
   history gains its own row (`02-points-adjustment-landed.png`).
2. **Gift card issue** — `Emitir tarjeta` → `50000` (the dialog asks for `Valor en centavos` and
   says `Ejemplo: 50000 = MXN 500.00`) → `Revisar` → `Confirmar` → the manager's PIN → `Aprobar`.
   The API logs `POST …/customer-value/gift-cards` **201** and
   `merchant.loyalty_gift_card.amount_cents = 50000` — **MXN 500.00, correct**. The card's own
   confirmation said `50000 MXN` (`03-gift-card-confirm-50000-mxn.png`), which is what an operator
   would read as a hundredfold mistake in the last dialog before the money is issued.
3. **The fix** — both places now go through `formatMinorUnits`, the app's single money formatter
   (`apps/umi-pos/lib/features/customer_value/customer_value_surface.dart`). On the rebuild the
   history row reads `MXN 500.00` (`08-history-mxn-after.png`) and the confirmation reads
   `MXN 500.00` with `Límite: MXN 100,000.00` (`09-gift-card-confirm-mxn-after.png`). Pinned by
   `customer_value_test.dart`, _"the customer center words money in pesos, never in raw minor
   units"_, checked both ways: it fails on the old expression and passes on the new one.

## Inventory operations

`Revisar componentes` opens `Destino por componente`, one row per component with `Reingresar` /
`No reingresar` / `Enviar a inspección`. `Aumentar` / `Registrar merma` / `Registrar daño` open a
quantity dialog, and every one of them needs an independent approval, which the till asks for with
the approver's PIN. `Aumentar` on `Agua filtrada` worked end to end — `POST
…/inventory/adjustments` 201 and the tile went **47800 → 47900**.

The refund disposition did not. The first `Confirmar` answers `409 APPROVAL_REQUIRED` with the
permission and the fingerprint, the PIN is accepted (`POST /elevation/manager-approval` 201), the
till re-sends — and the API answers **500**:

```
500 request_failed POST …/inventory/restock type=DatabaseError
    detail=permission denied for table pos_restock_intent
```

`SELECT … FOR UPDATE` needs `update` on the locked table. Gate 3D deliberately denies it: the
post-sale compensation facts are append-only (`tg_pos_exception_append_only`) and
`90_rls.sql` revokes `update` from `api` on all six of them — `gate-3e-inventory-migration.spec.ts`
even asserts the inventory migration never writes that table. The lock the server wanted lives in
the advisory space now, keyed on the intent
(`pos-inventory.repository.ts`, `lockRestockIntent`), exactly as this file already keys its stock
movements. The row read stays, and the resolution's final uniqueness stays with
`inventory_restock_final_outcome_uidx`.

**On the rebuild**: `POST …/inventory/restock` **201** in 33 ms, the `Decisión de devolución
pendiente` banner disappears, `Café en grano` goes **9514 → 9532** (+18 g, the component that was
re-ingresado) and the recipe's `Rollo de canela` appears in the list (`07-restock-resolved-after.png`
against `06-restock-stuck-before.png`).

The second inventory defect was found by reading the state machine rather than on the glass:
`load()` carried `pendingReconciliation`, `approvalPermission` and `approvalFingerprint` forward but
not `pendingOperation`, so the first refresh after the `409` — the till reloads on every visit and
after every recovery attempt — made `approvePendingOperation` return at its own guard. The approval
is granted, nothing is sent, and the screen keeps the stale refusal. `inventory_test.dart`, _"a
restock refused for approval survives a refresh and is re-sent approved"_, fails without the fix.

## Hardware centre

Everything on this surface works with taps, and every failure is stated in words:

| Action                                            | Result                                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `Buscar impresora USB`                            | finds `Impresora · usb-04b8-0e27` (Epson TM-T20III) and says `Impresora USB agregada.`                                 |
| `Ejecutar prueba`                                 | `Prueba enviada a Epson TM-T20III: el dispositivo respondió.`, a new `Página de prueba` job at the head of the queue   |
| `Actualizar hardware`, `Cerrar`, `Volver`         | work                                                                                                                   |
| `Reintentar` on a job with `Reintento disponible` | `El reintento no se imprimió.` — honest, with no printer assigned                                                      |
| `Reimpresión controlada` on a past receipt        | `La copia no se imprimió.` — honest                                                                                    |
| The queue                                         | each job carries its state (`Impreso`, `Reintento disponible`) and its action (`Reimpresión controlada`, `Reintentar`) |

## Smaller things, recorded and not fixed

1. **Entity labels are raw UUIDs, in three places.** Customer history: `Puntos ·
02ee0d68-0000-4211-bb4d-ddb016967bd7`; print queue: `Recibo · 5e419900-e95f-4c28-9183-cbb2fcde396e`;
   gift-card delivery: `GFT-b363d189-5882-43d7-998e-03ed2ea5e761` and a 40-hex-character `UMI-…`
   code. The demo's own card reads `GFT-PILOT-01`, which is what a human can dictate. Same family as
   the kitchen tickets headed by `pos-cart:<uuid>`.
2. **The inventory surface keeps an error banner behind the dialog that resolves it.** `Esta
operación requiere una aprobación vinculada.` with `Reintentar` stays on screen underneath
   `Se requiere una aprobación independiente` (`06-restock-stuck-before.png`).
3. **Two refresh controls, two names.** Caja's is announced `Reintentar`; inventory's is
   `Actualizar`. Both are the same act.
4. **`Emitir tarjeta` asks in centavos** (`Valor en centavos`, example `50000 = MXN 500.00`) while
   every other money field on the till takes pesos (`MXN 100.00` chips, `Cash received`). Consistent
   with the API's `initialValueMinorUnits`, but it is the only place the operator has to multiply by
   100 in their head.
5. **`Leche de arena` is gone** — the demo list now reads `Leche de avena`.

## Also walked: suspending a sale, and finding it again

`Suspender venta` (in the same `Más` menu) asks for a name — `Nombre de la venta suspendida` — and
posts `POST …/sales/<id>/suspend` **201**. The dialog closes; nothing else on `Comanda` changes,
which is where the two surprises are:

1. **The parked sale is in `Ventas`, not in the cart.** `Todas las ventas` lists it as
   `Mesa5 · 11/10/2026 08:52 · Suspendida · Cliente anónimo · MXN 72.00` with a `Reanudar venta`
   button, and `Ventas suspendidas` is its own filter. `Reanudar venta` posts
   `POST …/sales/<id>/resume` **201** and the till returns to `Comanda` with the cart restored
   (`MXN 72.00`, the same line). Nothing in the cart panel says a sale is parked, and nothing offers
   to bring one back — an operator who parks a sale and stays on `Comanda` has no visible next step.
2. **`Pedidos entrantes` prices in dollars.** Its one row reads `Web · 3 · $330.00` while every other
   money figure on the till is `MXN …` (`incoming_orders_surface.dart` formats it by hand with a `\$`).

Also seen on the way, and honest: with the API restarted mid-walk the header chip read
`Conexión inestable` for a few minutes, and the till kept working.

## Evidence

`docs/reports/evidence/2026-10-11-imin-customer-center-and-inventory/`. Test counts after the three
fixes: POS **694**, API **1787** (29 skipped), `flutter analyze` and `tsc --noEmit` clean.
