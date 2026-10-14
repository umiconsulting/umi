# A takeaway sale could not be written

Date: 12 October 2026. Device: iMin D3-504, Estación build 21. API from this tree on `:4001`,
database `umi_local`.

## What the operator saw

The charge failed with a full-screen refusal:

> No fue posible completar el cobro de forma segura.

The API log gave the cause in one line:

```
500 request_failed POST /checkout
  type=DatabaseError
  detail=new row for relation "customer_order" violates check constraint
         "customer_order_fulfillment_type_check"
```

## The cause: two tables, two words for one fact

| Table                     | Column             | Values the CHECK admits         |
| ------------------------- | ------------------ | ------------------------------- |
| `merchant.pos_cart`       | `fulfillment_type` | `dine_in`, `takeout`            |
| `merchant.customer_order` | `fulfillment_type` | `pickup`, `dine_in`, `delivery` |

The till says "Para llevar". The cart stores `takeout`. The order stores `pickup` for the same fact,
and the web channel already wrote `pickup`. The checkout copied the cart's word into the order
verbatim, so the order table refused the row.

Migration `005_pos_cart_fulfillment.sql` added the cart column and its comment states that the value
"flows to customer_order.fulfillment_type when the order is written at fire or checkout". The
migration never widened the order's CHECK. So the value it introduced could never be written.

The database shows the effect: **52 `dine_in` orders, 3 `pickup` orders from the web channel, and zero
`takeout` orders.** Every takeaway charge failed. Every sale that had ever worked was eaten in the
café.

## Why it looked like a build problem

It was not. The schema and the data live in PostgreSQL, and a rebuild of the app or of the API does not
touch them. The defect fires on **every takeaway sale**, which is a case the demo had never reached
because all 52 earlier sales were dine-in. The first takeaway charge met it.

## The fix

One function in the writer that owns the order's model,
`apps/umi-api/src/shared/orders/order-writer.ts`:

```ts
const orderFulfillmentType = (value: string): string => {
  if (value === 'takeout') return 'pickup';
  if (value === 'dine_in' || value === 'pickup' || value === 'delivery') return value;
  throw new Error('writeOrder: unknown fulfillment_type');
};
```

Reasons for the mapping in the writer, and not a wider CHECK on the order table:

1. `AGENTS.md` puts cross-product normalisation close to the backend that owns the write model, and
   this INSERT is the one path the POS checkout, the fire, the web channel and the conversation all
   use.
2. The order table keeps ONE word per fact. A wider CHECK would put `takeout` and `pickup` in the same
   column, and every report would then count two words for one type.
3. A value this product does not know stops the write. A third word cannot enter by accident.

## The proof

- Two new tests in `order-writer.spec.ts`: a takeaway sale writes `pickup`, and an unknown value is
  refused.
- On the device: the operator retried the charge. The cart `7c2e19d7` (`takeout`) is `committed`, the
  order `3efbb1df` carries `fulfillment_type = pickup` and its two lines, and the till showed the
  receipt.

## What this leaves open

The cart's word and the order's word are still two words. The mapping is one place, and the comment
there says so. A future change that adds "Domicilio" must decide the order's word for it in the same
function.
