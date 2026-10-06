# Purchase orders: the backend is built, the product is not

- Date: 2026-09-18
- Question: is the purchase-order feature finished?
- Tool: CodeGraph (`codegraph context`, `codegraph query`) plus `rg` over
  `apps/`, `packages/` and `tools/`.

## The answer

**No.** The server side is complete and tested. The user-facing side does not
exist. The one screen that depends on a purchase order cannot finish its job
without one, and nothing in the product creates one.

## What exists

### The schema holds the whole model

`docs/migration/build-v3/69_procurement.sql` creates five tables:

| Table                                  | Holds                           |
| -------------------------------------- | ------------------------------- |
| `merchant.supplier`                    | the vendor                      |
| `merchant.purchase_order`              | the order header and its status |
| `merchant.purchase_order_line`         | one line of the order           |
| `merchant.purchase_order_receipt`      | one delivery against the order  |
| `merchant.purchase_order_receipt_line` | what arrived, per line          |

**Documented fact**, `docs/migration/build-v3/69_procurement.sql:123` and the four
`create table` statements after it.

### The API holds the whole lifecycle

Nine routes exist in `packages/contract/src/route-table.ts`:

| Route                              | Line |
| ---------------------------------- | ---- |
| `procurement.supplierList`         | 353  |
| `procurement.supplierCreate`       | 373  |
| `procurement.supplierUpdate`       | 398  |
| `procurement.purchaseOrderList`    | 424  |
| `procurement.purchaseOrderGet`     | 444  |
| `procurement.purchaseOrderCreate`  | 464  |
| `procurement.purchaseOrderSend`    | 492  |
| `procurement.purchaseOrderReceive` | 519  |
| `procurement.purchaseOrderCancel`  | 549  |

Every one is gated on `merchant.manage`. **Documented fact**, the same file.

The domain rules are real and not a stub. `procurement-domain.ts` refuses an
over-receipt (`overReceivedLine`, line 116) and refuses a line total that does not
match within rounding (`lineTotalWithinRounding`, line 72). **Documented fact**,
`apps/umi-api/src/modules/procurement/procurement-domain.ts`.

The receipt path is shared. Committing a supplier invoice passes a
`purchaseOrderId` and writes through `commitSupplierInvoice`, so the invoice and
the purchase order are one mechanism and not two. **Documented fact**,
`apps/umi-api/src/modules/procurement/procurement.service.ts:529`.

## What does not exist

### No screen creates a purchase order

`procurement.purchaseOrderCreate`, `purchaseOrderSend`, and `purchaseOrderCancel`
have **no caller** in `apps/umi-dashboard` or `apps/umi-pos`. The only caller in
the whole repository is a verification harness:
`tools/ux-sweep/inventory-costing-live.mjs` posts to `purchase-orders`,
`purchase-orders/:id/send`, and `purchase-orders/:id/receipts` at lines 167, 195,
and 210 to seed a fixture. **Documented fact**, a repository-wide search.

### No supplier management either

`procurement.supplierCreate` and `procurement.supplierUpdate` also have no caller.
**Documented fact**, the same search.

### The Compras tab reads orders but cannot make one

The dashboard touches procurement in exactly one place:
`apps/umi-dashboard/src/data.jsx:2489` calls `procurement.purchaseOrderList`, and
it filters the answer to the two statuses that still hold stock in transit,
`sent` and `partially_received`.

That read serves the supplier-invoice inbox. **Documented fact**,
`apps/umi-dashboard/src/data.jsx:2474` and `:2515`.

## The consequence: the invoice inbox has a dead end

The Compras tab can upload a supplier invoice and match its lines to inventory
items. It cannot commit the invoice without an open purchase order:

1. `invoice-model.js:190` returns `state: 'no_order'` when no order is present.
2. `invoice-inbox.jsx:312` builds the command with `purchaseOrderId: order.id`.
3. The commit is disabled while the state is not `ready`.

So on a shop that has never had a purchase order, a supplier invoice uploads,
matches, and stops. Nothing in the product can move it forward.
**Documented fact**, the three lines above, and **Inference** for the operator
consequence.

## Why this is a real gap and not a phased choice

- The invoice capture is the feature the costing workstream depends on. The
  earlier research names it as the reason the ingredient price stays current: the
  specialist products read the invoices and update the price. An invoice that
  cannot be committed cannot update a price.
- The recipe and inventory module plan lists procurement as built. The plan is
  correct about the server and silent about the screen.
- The reorder case has no home. `purchaseOrderList` filters to open orders, so an
  order that should be placed does not appear anywhere.

## What the research says the screen must do

The competitor evidence already covers this, and it does not need a new pass:

- **SoftRestaurant** generates a purchase order from a minimum and a maximum
  stock level, imports the supplier's XML against it, and links items
  automatically. It is the only one of the three regional competitors with a real
  order-to-receipt chain.
- **Fudo** has no purchase order at all. A purchase is an expense with a goods
  detail, so there is no expected-versus-received and no replenishment from
  min/max.
- **Lightspeed** ships a Purchase orders list with a status chip per row
  (`Delivered`, `Cancelled`, `Placed`, `Received`, `Draft`), a supplier column, a
  delivery date, a supplier-invoice column, and a total. The captured screen is in
  `docs/research/2026-09-18-inventory-surface-placement/assets/lightspeed-bo-purchase-orders.png`.
- **The data is already in the database.** Measured in the rehearsal branch
  `umi_transition_rehearsal_20260901` on 2026-09-18:

  | Table                             | Rows |
  | --------------------------------- | ---- |
  | `merchant.supplier`               | 102  |
  | `merchant.purchase_order`         | 688  |
  | `merchant.purchase_order_line`    | 721  |
  | `merchant.purchase_order_receipt` | 477  |

  The orders hold all five statuses: `received` 374, `draft` 114, `sent` 96,
  `cancelled` 65, `partially_received` 39. **Documented fact**, a direct
  `psql` count. So a full procurement history exists and no screen in the product
  shows any of it.

Sources: `docs/research/2026-09-17-inventory-kitchen-systems-deep-dive.md` §7 and
`docs/research/2026-09-18-inventory-ui-ux-surfaces.md`.

## The open decision

The screen needs a design decision before it needs code:

1. **Does a purchase order start from a supplier, or from a shortage?** The market
   does both. SoftRestaurant starts from min/max. Lightspeed starts from a
   supplier. Umi has `lowStockThreshold` and `parQuantity` on the item, so the
   shortage route is available, and the inventory hub already computes a low-stock
   view.
2. **Is the purchase order the same object as the invoice?** Today they are
   separate tables and one receipt path. Merging the screens without merging the
   model would put two objects behind one name, which is the fault the design
   audit found in the old catalog hub.

Both questions belong in a plan, not in this file.
