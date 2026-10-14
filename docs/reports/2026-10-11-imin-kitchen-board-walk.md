# The kitchen board on the iMin: the second round that never reached a station

Date: 11 October 2026, 14:20–14:37 UTC (07:20–07:37 MST). Device: iMin D3-504, Estación build from
this tree; demo API on `:4013` rebuilt and restarted from this tree; demo database
`umi_pos_estacion_design_20261008`.

The plan's coverage table leaves _"full native adoption in G39: incoming order, authorised kitchen
operation, populated preparation"_ open. This is the till's side of it: firing from `Comanda` and
reading the result on `Cocina`.

## What was walked

| Step                                                   | What the till did                                                                                                                                                                                                                                                                                          | API / database                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Comanda` → `Enviar` on a round of Americano + Galleta | the lines turned `Enviada`, `Enviar` left the pinned row                                                                                                                                                                                                                                                   | `POST /orders/fire` 201 · **no `merchant.kitchen_order` row** — and that is CORRECT: only Cheesecake, Latte and Sándwich de pavo carry `requires_preparation`, and a counter round of a drink and a cookie is not kitchen work (`projectKitchenOrder` writes no ticket when nothing routes) |
| a `Latte` added to the same cart → `Enviar`            | the tile's detail demanded its variant (`Chico`) AND a required option group (`Tipo de leche`) before `Agregar a la comanda` went live; both hints are stated on screen (`Elige una variante…`, and `Completa las opciones obligatorias para continuar.` in the footer)                                    | `POST /cart/lines` 201 → `POST /orders/fire` 201                                                                                                                                                                                                                                            |
| the same fire, after the fix below                     | a NEW ticket lands for that order                                                                                                                                                                                                                                                                          | `merchant.kitchen_order` 3861aea5 (public_reference `pos-cart:6c2bf612…`, `queued`) with **2 items**                                                                                                                                                                                        |
| `Cocina` → `Comandas`                                  | the board lists tickets oldest-first (FIFO — the urgent one first), each with its state chip (`En cola` / `Listo`), course (`Tiempo 1`), lines with their own state and a per-line tick, and two actions (`Recuperar`, `Terminar`); a header banner reads `Conexión inestable` when the live channel drops | `GET …/kitchen/board`                                                                                                                                                                                                                                                                       |

## The defect: a second round whose first round had nothing to prepare

`appendKitchenItems` — the path a fire takes when the order already exists, which is every round after
the first — looked for the order's kitchen ticket and **gave up if there was none**:

```
if (!existing.rows[0]) return null;   // before
```

`projectKitchenOrder` writes no ticket when no line routes to an active station, which is right. So the
combination lost the work: the first round (nothing preparable) created no ticket, and the second
round (a Latte, preparable) found none to append to. Measured on the till: `POST /orders/fire`
answered 201 at 14:30:51, the till marked the line `Enviada`, and `merchant.kitchen_order` held no row
for that order — the barista never saw the drink.

Fixed in `kitchen-projector.ts`: a round that finds no ticket projects one, which is the only way the
preparable lines of a later round ever reach a station:

```
if (!existing.rows[0]) {
  const projected = await projectKitchenOrder(client, merchantId, sourceOrderId);
  return projected?.kitchenOrderId ?? null;
}
```

Verified on the hardware after the API rebuild: a Cheesecake (preparable) added to the same cart and
fired at 14:36:16 created ticket 3861aea5 with **two** items — the Cheesecake and the Latte that the
earlier round had lost. Guard: `kitchen-projector.spec.ts` → _"a second round that finds no ticket
creates the ticket it needs"_, checked both ways (with the old early return it resolves to null and no
`INSERT INTO merchant.kitchen_order` is issued). API suite: **1786 tests**.

## What the walk also found, and did not fix

1. **Every ticket is headed by a machine label.** The reference the API publishes is
   `COALESCE(external_ref, order id)` and a POS cart's `external_ref` is `pos-cart:<cart-uuid>` — so
   the cook's primary line reads `pos-cart:8500e83e-fbbb-4f1a-86d3-b79f93783e06`. A table order
   carries a human label there (the guest and the kitchen read it), a staff fire does not, and the
   till shows the cart's id nowhere a person could match it against. What a cook needs is the table,
   the channel, or a short counter number; that is a product decision about the ticket's identity,
   and it belongs with the same label wherever it is printed.
2. **The demo catalogue carries a typo in an option name**: the Latte's milk choices include
   `Leche de arena` where the reference names are `Leche entera` / `Leche de avena` (oat). It is
   seeded data, so it is the owner's to correct — but it is the kind of thing a kitchen reads all
   day.
3. **The board is ordered oldest-first and its empty space is a long scroll.** With the demo's
   backlog the newest ticket sits below many screens of history; a kitchen that cannot clear its
   board will not find the round it just fired. The order itself is right (FIFO), the length is a
   demo-data artifact, and no filter is offered on this surface.
