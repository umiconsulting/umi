# `Cancelar venta`: the last transition of the sale lifecycle

Date: 11 October 2026, 09:39–09:47 MST. Device: iMin D3-504, Estación build from this tree, API from
this tree on `:4013`, demo merchant.

`Cancelar venta` was the only sale transition left unwalked (new, suspend, resume and commit all had
their runs). It works, it records the audit trail the dialog promises — and it used to leave the
operator standing in front of an order the server had already thrown away.

## The dialog

`¿Cancelar esta venta?`, with the body `La comanda se cerrará sin pago ni recibo. La cancelación
permanecerá en el historial de auditoría.`, a **required** `Motivo de cancelación` (`El cliente
cambió de opinión`, `Error del operador`, `Comanda duplicada`, `Otro motivo`), an optional
`Nota (opcional)`, and `Cerrar` / `Cancelar venta` — the confirm button disabled until a reason is
chosen (`00-cancel-dialog-reason-required.png`).

Choosing `Error del operador` and confirming posts `POST …/sales/<id>/cancel` **201**, and the reason
lands where the dialog says it will:

| cart         | status      | lifecycle_state | cancellation_reason_code | cancellation_reason | cancelled_at |
| ------------ | ----------- | --------------- | ------------------------ | ------------------- | ------------ |
| `5f908463-…` | `abandoned` | `cancelled`     | `operator_mistake`       | (none)              | `16:46:57Z`  |
| `1e7486bd-…` | `abandoned` | `cancelled`     | `operator_mistake`       | (none)              | `16:40:17Z`  |

The empty note stays empty — the reason code is the fact (there is a test for exactly that).

## What it used to leave behind

The cancel was the last thing the flow did. The server abandoned the cart, and the till kept showing
the cancelled order: the panel still listed `Chai latte · MXN 72.00` with its total
(`01-cancelled-order-still-on-screen-before.png`), and the API log shows the two reads the screen
never reconciled — `GET /cart` **404** and `GET /checkout/carts/<id>` **404**, both at 16:40:49.

From there the operator can open `Cobrar` on what they have just cancelled
(`02-checkout-sheet-on-a-cancelled-sale-before.png`) and press it: the commit answers
`409 OPTIMISTIC_VERSION_CONFLICT`, and the failure **takes over the whole till** with
`No fue posible completar el cobro de forma segura.` and only `Reintentar` / `Cerrar`
(`03-full-screen-refusal-before.png`). No sidebar, no catalogue, no way back to work but closing it.

## The fix

`showCancelSaleDialog` now does what the commit path already does: after the cancel lands, it starts
the next sale. The API log for one cancel reads `POST /sales` 201 → `POST …/cancel` 201 →
`POST /sales` 201, and the till is left on an **empty comanda** (`Total MXN 0.00`, `Vaciar` and
`Cobrar` greyed, `Elige un producto de la carta para empezar`) — `04-empty-comanda-after.png`.

Pinned by the existing dialog test, extended: after the cancel it asserts the phase is
`buildingCart` and the repository saw exactly one start. Checked both ways — neutering the
`newSale()` follow-up fails it.

## Still open on this path

1. **A refused commit takes the whole screen.** `No fue posible completar el cobro de forma segura.`
   with `Reintentar` / `Cerrar` is the app's existing failure surface; it hides the till and says
   nothing about what went wrong (here: a cart that no longer exists). It is the same shape reported
   in `2026-10-11-imin-customer-sale-refused.md`, now with a second, reachable trigger.
2. **`Ventas` does not show the cancellation reason.** The row renders `Cancelada` and a timestamp;
   the reason code lives in the database and in the dialog's promise, but the operator reconciling a
   shift cannot read it on the till.

Evidence: `docs/reports/evidence/2026-10-11-imin-cancel-sale/`. POS suite **697**,
`flutter analyze` clean.
