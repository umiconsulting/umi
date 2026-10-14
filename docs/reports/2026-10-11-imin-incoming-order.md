# An incoming web order, worked end to end on the till

Date: 11 October 2026, 03:25–03:40 MST. Device: iMin D3-504 (Android 11, 1920x1080), signed in as
`Propietaria UmiPOS` with the demo PIN, against the demo API on `:4013` and the database
`umi_pos_estacion_design_20261008`.

This is the plan's pending row **"adopción de pedido entrante"** (G39 in
`docs/plans/2026-10-09-pos-estacion-complete.md`), and the first time the whole channel journey has
been walked on the hardware: a customer orders on the web, the till picks it up, rings it, fires
it, charges it, and the committed sale carries the channel.

## The order

One row in `merchant.customer_order` (source `web`, status `placed`, fulfilment `pickup`,
`external_ref WEB-2481`, customer _Cliente Piloto_) with two lines — `Latte` × 2 (variant `Chico`)
and `Cheesecake` × 1 — for a total of **MXN 215.00**. `merchant.order_total` is a view, so the
total is derived from the lines; nothing was written to it.

## What the till did, with real taps

| Step                                                | What the surface showed                                                                                                                                                          | Evidence                 |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Open `Pedidos`                                      | `Cliente Piloto · Web · 2 · $215.00` with an `Atender` action, above the older `N26 · Terraza · pedido 0042 · Web · 3 · $330.00`                                                 | `…/01-listed.png`        |
| `Atender`                                           | the till returns to `Comanda` with an **empty** cart; `merchant.pos_cart` `6c5eb0b7-…` is now bound to the order (`origin_order_id = aa000000-…-024810`, `origin_channel = web`) | `…/02-after-atender.png` |
| Ring the items                                      | `Latte` → `Chico` → `Leche entera` → `Agregar`, then `Aumentar cantidad` for the second one, then `Cheesecake`: `Subtotal MXN 215.00` — the same total the list advertised       | —                        |
| `Enviar`                                            | both lines read `Enviada`; `merchant.kitchen_order` `6332d284-…` is created `queued`                                                                                             | `…/03-fired.png`         |
| `Cobrar` → `Efectivo` → `Importe exacto` → `Cobrar` | `Pagado · MXN 215.00`, `Recibiste: 215.00 · Consumo: 215.00`                                                                                                                     | `…/04-paid.png`          |
| Back to `Pedidos`                                   | the order is **gone** from the incoming list; only the older `pedido 0042` remains                                                                                               | `…/05-settled-gone.png`  |

The database agrees, and this is the part the ADR cares about:

| Check                                    | Result                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `merchant.pos_committed_sale`            | `34bc0092-fef7-4810-a5db-4fb1f767aa53`, `origin_channel = web`, `origin_order_id = aa000000-…-024810`                                             |
| `merchant.customer_order` for that order | `status = completed`, source `web`, still **2 lines** — the till settled the customer's own order rather than creating a second one               |
| Orders for the merchant today            | 4 — the same count as before the sale, so no duplicate order was written                                                                          |
| `merchant.kitchen_order`                 | `6332d284-…` worked from `queued` to `ready` with the board's own controls (`Empezar`, `Marcar Latte como listo`, `Marcar Cheesecake como listo`) |

## Two things the owner should know

1. **`Atender` binds the cart; it does not copy the order's lines into it.** That is deliberate —
   the controller's own words are "the operator still rings the items, so the POS ring-up stays the
   receipt money-truth" (`incoming_orders_controller.dart`, and ADR 2026-09-13-pos-channel-
   attribution). The list gives the operator the item count and the total to ring against
   (`2 · $215.00`, and the cart reached exactly `MXN 215.00`), which is what makes the re-ring
   verifiable. It is still a re-key: a cashier can ring a different drink from the one the customer
   ordered, and nothing compares the two lists. Whether that is acceptable is a product decision,
   not a bug.
2. **`Atender` does nothing at all when there is no active cart.** `_take` returns early on a null
   cart with no message (`incoming_orders_surface.dart`). On this till a cart always exists by the
   time the surface opens, so it was not reachable in this walk — but a press that does nothing and
   says nothing is worth a guard.

## A third: the surface does not announce an order that arrives while it is open

Measured with the surface open on the till: a `placed` web order created **33 seconds** before the
check did not appear (`…/06-live-not-updated.png`). Pressing `Actualizar` brought it immediately
(`…/07-after-refresh.png`). The reason is in the code, on both sides:

- the backend runs realtime listeners for the **kitchen board**, **tender attempts** and
  **conversation messages** (`apps/umi-api/src/modules/realtime/`), and none for customer orders;
- the till's `IncomingOrdersController` subscribes to nothing and polls nothing — it loads when the
  surface opens and when the operator presses `Actualizar`.

So a pickup order waits silently. A cashier standing on `Comanda` has no way to know it arrived
until they open `Pedidos`. Whether the till should announce it — a badge on the rail, a sound, or a
channel of its own — is a product decision with a real cost (a poll on a till that may be on a
phone hotspot), which is why it is written here rather than decided in code.

## What this closes

The plan listed "adopción de pedido entrante" as an empirical gap: _"La presencia de `PosPage`
demuestra adopción técnica. Por sí sola no demuestra un flujo completo."_ The journey above is the
flow, measured on the counter till, with the channel attribution visible in the committed sale.

Evidence: `docs/reports/evidence/2026-10-11-imin-incoming-order/`.
