# The fired order — sending to the kitchen before the money

_ADR · build-v3 · `merchant` schema · POS cart + checkout + kitchen cluster · 2026-10-07_

**Status:** ACCEPTED (2026-10-07). The open decision in §7 is resolved: **option 2**, an
explicit column. The checkout reads a fact the row states, not a convention it has to
remember.
**Extends:** `ORDER_MODEL.md` §1 (the order and its event spine) and §5 (config vs data)
**Relates to:** [`2026-09-13-pos-channel-attribution-adr.md`](2026-09-13-pos-channel-attribution-adr.md)
— this reuses its `origin_order_id` seam and must not break its link-don't-merge rule.

---

## 1. Context — what a café does that UmiPOS cannot

A waiter takes an order at a table and sends it to the kitchen. Payment happens later, at
the counter. That is the whole job of a handheld, and **UmiPOS cannot do it**.

The reason is structural, not a missing button. `writeOrder`
(`apps/umi-api/src/shared/orders/order-writer.ts`) is the one function that writes
`customer_order` + `order_item` + the opening `order_event` and projects the kitchen
ticket, and its only caller from the POS is `PosCheckoutRepository`, **inside the checkout
transaction**. An order that has no payment therefore has no ticket, and a ticket is what
the kitchen reads.

### 1.1 Every vendor in our market does it, and none of them treats it as a permission

| Vendor                               | What they call it                                                                                     | Source                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Parrot (the system this client left) | order type **"Comer aquí"** → `Enviar a cocina`                                                       | [Comandar orden de mesa](https://soporte.parrotsoftware.com.mx/es_MX/tipo-de-orden-pos/comandar-orden-de-mesa-) |
| SoftRestaurant                       | **Comandero Móvil** → "levantar las comandas desde la mesa y enviarlas a producción"                  | [Comandero Móvil](https://softrestaurant.com/addons/movil)                                                      |
| Square                               | **open tickets** — "create and add to a ticket then process payment later", enabled **through modes** | [Create and edit open tickets](https://squareup.com/help/us/en/article/5337-use-open-tickets-with-square)       |
| Toast                                | **Table Service / Quick Order mode**, gated by the mode permission                                    | [Start a Tab](https://support.toasttab.com/en/article/Starting-a-Tab-1492811100378)                             |

Two readings of that table decide this ADR:

1. **It is a mode or an order type, not a permission.** Square turns it on per device
   profile ("modes, which apply settings across a group of devices"); Toast gates it with
   `1.1 Table Service Mode`; Parrot makes it the first choice of the flow. A permission
   alone would let a device offer the action while the operation that needs it does not
   exist.
2. **The handheld is not a cash register.** Our own cash-centre research records that
   Toast's drawers exist on the Flex and not on its handhelds
   (`docs/research/2026-09-29-cash-center-vendor-docs-forums-and-screenshots.md`). The
   fired order is the design, not a workaround.

## 2. The decision this ADR makes

**The fired order IS the order. The checkout settles it; it does not mint a second one.**

Everything else follows from that sentence.

## 3. Why that is the hard part (and why it is not obvious)

`merchant.pos_cart.origin_order_id` already points at "the upstream commercial order this
cart settles", and the checkout already acts on it — it closes that order with a
`completed` status row and an `order_event`. So the seam exists.

But it exists for **someone else's** order. The channel attribution ADR chose _link, don't
merge_ for a WhatsApp order that arrives from outside and is settled at the counter. In
that flow the checkout **writes its own order** (`pos-cart:<cartId>`) and _closes_ the
linked one. Two orders, one sale, and exactly one kitchen ticket — the upstream order's
ticket was already made when it was placed.

Applying that same seam to a fired order would produce **two tickets for one order**: the
fired order projects its ticket, the checkout mints a second order and projects another,
and the bar makes the drinks twice. The distinction is not cosmetic:

|                                       | Link-don't-merge (today)            | Fire (this ADR)                        |
| ------------------------------------- | ----------------------------------- | -------------------------------------- |
| Who created the linked order          | someone else (WhatsApp, aggregator) | this POS, at fire time                 |
| Does it already have a kitchen ticket | yes, made when it was placed        | yes, made when it was fired            |
| What the checkout writes              | its own new order                   | **nothing** — it settles the fired one |
| What the checkout closes              | the linked order                    | n/a — it is the order being settled    |

### 3.2 The finding that shrank this: the checkout already settles in place

This ADR originally planned a branch in the checkout — "if the linked order was created by
this cart, do not write a second one". Writing it found that **no branch is needed**:
`writeOrder` is already idempotent by `(merchant_id, external_ref)`. On a duplicate
`external_ref` it returns the existing order with `created: false` and deliberately does not
rewrite its lines (`order-writer.ts`, "a duplicate delivery of the same source record").

The fire writes its order with the SAME `pos-cart:<cartId>` the checkout uses. So when the
checkout runs it gets the fired order back and hangs the payment, the receipt and the
committed sale on it. One order, one kitchen ticket, and the money attached to both.

Two consequences worth stating plainly:

1. **The mechanism was already there.** The fired order is the first thing that made the
   `external_ref` idempotency load-bearing rather than a delivery-dedup nicety.
2. **What it does NOT protect is a line added after the fire.** The checkout's `writeOrder`
   returns early, so a dessert rung on a fired cart would be charged and never reach the
   kitchen — silently, which is the worst way. So v1 **freezes the cart on firing**, and
   lifting that freeze is the "second round" work of §8.

## 4. The model

```
cart (draft, no money)
  │
  ├─ POST …/orders/fire        permission: order.fire
  │     writes customer_order (source 'pos', the cart's fulfilment)
  │       + order_item + opening order_event
  │       + the kitchen projection
  │     sets cart.origin_order_id = that order
  │     leaves the cart open and mutable
  │
  ├─ items added later  → append to the SAME order and its ticket
  │
  └─ POST …/pos/checkout       permission: checkout.commit
        sees origin_order_id → settles THIS order
        payment + receipt + pos_committed_sale
        NO second order, NO second ticket
```

The identity rule is what makes it safe: a cart may settle an order **it created** in
place, and may only _link and close_ an order **it did not create**. The two cases are
distinguishable without a new column because `customer_order.source` is `'pos'` for the
first and `whatsapp`/`web`/`aggregator` for the second — but see §7, because relying on
that alone is the weak point of this shape.

## 5. What changes, file by file

| Layer                   | Change                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Permission catalogue    | one new primitive, `order.fire`, grouped under `pos`, risk `medium`                                                                          |
| Contract                | a `FireOrderRequest`/`FireOrderResult` pair in `pos-cart` or a new `pos-order`; the cart view gains whether it is fired and at what order id |
| Route                   | `POST /api/v1/pos/merchants/:merchantId/orders/fire`, guarded by `order.fire` + the operator session, idempotent on a client-supplied key    |
| Repository              | a `writeOrder` call **outside** the checkout transaction, plus the cart update, in one transaction of its own                                |
| Checkout                | **nothing** — §3.2. The existing `writeOrder` call returns the fired order by `external_ref` and hangs the money on it                       |
| Cart edits after firing | **frozen**: `bump` refuses while `fired_order_id` is set, so a line added later cannot be charged without reaching the kitchen               |
| POS app                 | the button that does not exist today — "Enviar a cocina" — and a fired/not-fired marker on the cart                                          |

**Nothing in the schema has to change for the first version**, which is the sign the model
was already half-built.

## 6. Alternatives considered

**A permission alone, with no order type.** Rejected by the evidence in §1.1: every vendor
models it as the shape of the order, and a permission that unlocks an action nothing
implements is a lie in the role editor.

**A second order for the sale, linked to the fired one (link-don't-merge).** Rejected in
§3: two kitchen tickets for one order.

**Do nothing; the waiter uses the till.** Rejected by the client's own operation: their
staff come from Parrot, where this is one tap, and the inventory records their handheld as
sending "name, quantity and drink category, with no prices and no payment".

## 7. The open decision

**How does the checkout know an order is "ours to settle in place" rather than "someone
else's to link and close"?**

1. **Derive it from `customer_order.source = 'pos'`.** No schema change, uses a fact that
   already exists. The weakness: `source` records who placed the order, not who owns the
   settlement, and a future `pos`-sourced order that arrives from another device would be
   mistaken for this cart's own.
2. **Record it explicitly** — a `pos_cart.fired_order_id` (or a boolean beside
   `origin_order_id`). One guarded column, unambiguous, and the intent is readable in the
   data rather than inferred from a convention.

**DECIDED 2026-10-07: option (2).** The cost is one column in a migration we control, and it
turns a rule the checkout has to remember into a fact the row states. Option (1) was the
choice only if we wanted zero schema churn in the first version, and we do not: this is the
seam the whole feature hangs on, and it is worth one column to not have to re-derive it.

The column is `merchant.pos_cart.fired_order_id` — separate from `origin_order_id` on
purpose. They answer different questions and a cart may legitimately carry both: a fired
order that this cart created, settling nothing upstream; or an upstream order it links and
closes, having been fired nowhere. Merging them into one column would make the checkout
guess which rule applies, which is the failure this decision exists to prevent.

## 8. What this ADR does not decide

- **Splitting a fired order** (Parrot's _Separar Mesa_, Square's split checks). The order
  exists after the fire, so this becomes possible — and it is a second feature.
- **Firing a second round to the same order.** The model above says "items added later
  append to the same order and its ticket"; whether that is one ticket that grows or a
  second ticket on the same order is a kitchen-UX decision, and the KDS contract already
  carries the vocabulary for it (`course_number`, `fired_through_course`).
- **Who may fire.** `order.fire` is the primitive; whether the mesero role also keeps
  `cart.write` is a role-catalogue question, not this one.
