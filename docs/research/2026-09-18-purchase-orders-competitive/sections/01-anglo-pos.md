# Purchase orders in the English-language POS and retail incumbents

- Date: 2026-09-18
- Lane: 1 of 5 in the purchase-order pass
- Question: in Square, Toast, Shopify, Clover, TouchBistro, SpotOn, Revel and
  Loyverse, how does a purchase order start, move, arrive, and reach the ledger?
- Decision this informs: the purchase-order surface that Umi builds in the
  dashboard.
- Evidence window: vendor help centres, vendor product pages, and vendor image
  attachments read on 2026-09-18.
- Captures: sixteen files, in `../assets/`. The index is
  [assets/INDEX-01-anglo.md](../assets/INDEX-01-anglo.md).

## Method, and what it is worth

The vendors split into three groups, and the group decides the evidence quality.

| Group                              | Products                      | Route that works                                                        | Evidence quality                 |
| ---------------------------------- | ----------------------------- | ----------------------------------------------------------------------- | -------------------------------- |
| Help centre renders                | Shopify, Square, Toast, Revel | Playwright Chromium. `curl` gets the shell only.                        | Strong: the vendor's own steps   |
| Help centre with product images    | Loyverse, Revel               | The article images are public PNG files. Download them and read the UI. | Strong: the vendor's own screens |
| Login-gated help centre            | Clover                        | None found. The public centre shows three articles.                     | Weak: marketing only             |
| No public help centre for the flow | TouchBistro, SpotOn           | The marketing page states the capability. No screen.                    | Weak: vendor marketing           |

Every claim below carries one of three labels.

- **Documented fact** - the vendor wrote it, and the URL is given.
- **Source-backed tradeoff** - the vendor wrote it, and it trades one thing for another.
- **Inference** - my reading, with the evidence that supports it.
- A question the evidence does not settle reads **not verified**.

Routes that failed are in the asset index, section "Capture failures, recorded".

## The comparison grid

Rows are the eight products in priority order. "PO" means the product's own word
for the document.

| #   | Product     | The object and where it lives                                                                                                           | Order starts from                                                                                          | Statuses, and the commitment                                                                                             | Receiving                                                                                                                                   | Three-way match                                                                                                                          | Cost update and price warning                                                                                                                                      | Who may act                                                                                                                 |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | Square      | "Purchase order". Dashboard `Items & services > Inventory management > Purchase orders`, and the retail-mode POS app                    | Vendor, then scan or search items. From the Item Library or the Sell-through view                          | No named status set in the public article. The commitment is **Send**. `Save as Draft` exists                            | Yes: `Receive All`, `Receive None`, or a partial receive per line. POS: `Receive items` then `Receive`                                      | **No.** Square has no received-versus-invoiced step. Each line is received against the order.                                            | The item variation becomes associated with the vendor and its cost. A price-change warning: **not verified**                                                       | Account owner or team member with `Items and inventory` permission. A separate `View unit cost` gate hides cost from a role |
| 2   | Toast       | No purchase-order object in public documentation. Toast Web `Bill Pay` holds "vendors" and "bills". xtraCHEF is a separate paid product | Bill Pay starts from an **uploaded invoice**. The vendor is a field on the bill                            | Payment statuses: scheduled, processing, paid, failed. The commitment is **Submit payment**                              | **No.** Bill Pay does not receive goods. xtraCHEF owns the goods side, and its flow is **not verified**                                     | **No** public three-way match. The invoice is the only document                                                                          | Cost update and price warning: **not verified**. The marketing page claims invoice data flows to the accounting system                                             | Toast Checking plus the `8.1 Financial Accounts` permission                                                                 |
| 3   | Shopify     | "Purchase order". Admin `Products > Purchase orders`. Shopify POS does not create the PO                                                | Supplier, then add products manually, by CSV, or by barcode scanner. "Recently purchased" narrows the list | Two statuses: **Draft** and **Ordered**. `Mark as ordered` "can't be reversed", so the commitment is **Mark as ordered** | **No**, not on the PO. Receiving happens on a linked **inventory transfer**. A standalone transfer can receive without a PO                 | **No.** "Payments to suppliers must be paid outside of your Shopify admin." Shopify tracks the agreement, not the payment                | Cost auto-fills from the previous PO with that supplier, then from the variant cost. A price-change warning: **not verified**. The transfer holds cost adjustments | Admin user. Sidekick can find a supplier. Permission name: **not verified**                                                 |
| 4   | Clover      | **Not verified.** The public help centre documents no purchase order                                                                    | **Not verified**                                                                                           | **Not verified**                                                                                                         | **Not verified**                                                                                                                            | **Not verified**                                                                                                                         | **Not verified**                                                                                                                                                   | **Not verified**                                                                                                            |
| 5   | TouchBistro | "Purchase order". Inside Inventory Management, a separate paid module                                                                   | "Automated order suggestions for each vendor", and a manual order                                          | **Not verified.** No public status list                                                                                  | **Not verified**                                                                                                                            | **Not verified**                                                                                                                         | "Food costs" and recipe costing are named. A supplier price-change warning: **not verified**                                                                       | **Not verified**                                                                                                            |
| 6   | SpotOn      | **Not verified.** No inventory or purchasing article is in the public knowledge base                                                    | **Not verified**                                                                                           | **Not verified**                                                                                                         | **Not verified**                                                                                                                            | **Not verified**                                                                                                                         | **Not verified**                                                                                                                                                   | **Not verified**                                                                                                            |
| 7   | Revel       | "Purchase order". Management Console `Inventory > Purchase Order`, and the POS app                                                      | Vendor, then add items from the vendor's item list, or from all items. New items are created inline        | Five statuses: **New, Sent, Partially Received, Fully Received, Finalized**. The commitment is **Sent**                  | Yes: receive in the console or on the POS. `Create New PO & Receive` handles goods already on hand. An invoice number is entered at receipt | **Partial.** The receipt holds the vendor invoice number, and the header tracks `Invoice Status`. It is a reference, not a blocked match | Inventory quantities update on receipt. `Use inventory cost` and `Use ingredient cost` exist. A price-change warning: **not verified**                             | **Not verified** in the public article                                                                                      |
| 8   | Loyverse    | "Purchase order". Back Office `Inventory Management > Purchase Orders`. Gated on the Advanced Inventory subscription                    | Supplier, then add items by search, or import a CSV. `Incoming` shows the open ordered quantity            | Five statuses: **Draft, Pending, Partially Received, Closed**, and a cancel action. The commitment is **Create**         | Yes: `Receive`, `Mark All Received`, or a per-line quantity                                                                                 | **No.** "the stock levels and average cost of each item will be updated automatically based on the supply price specified in the order"  | The receipt updates stock and **average cost** from the supply price. A price-change warning: **not verified**                                                     | **Not verified**                                                                                                            |

## What the incumbents agree on

**Documented fact, five of eight products.** The order is a **document in a web
back office**, and the till does not own it. Shopify, Square, Revel and Loyverse
put the primary list in a browser console. Shopify never puts the PO on the POS.
Revel and Square add a POS receiving path, and Loyverse and TouchBistro add a
mobile app. So the pattern is: create on the web, receive where the goods are.

**Documented fact, four products, and it is the split that matters most for Umi.**
Shopify separates the commercial agreement from the physical movement in the
product's own words: "The purchase order records the commercial agreement, and the
linked inventory transfer handles shipments, receiving, and cost adjustments in
your Shopify admin."
<https://help.shopify.com/en/manual/products/inventory/purchase-orders/creating-inventory-transfers>.
Revel separates the receipt from the order with a separate `Invoice Status` field.
Loyverse and Square collapse the two and receive against the order. So the market
does **not** agree on one object. The strong products separate the order, the
receipt, and the invoice.

**Documented fact, and the strongest single sentence in this lane.** Shopify states
the reason for the split: "This works in a similar way to how an order and its
fulfillments are tracked separately. One record captures the agreement, and the
other tracks the physical movement of goods."
<https://help.shopify.com/en/manual/products/inventory/purchase-orders/creating-inventory-transfers>.

**Documented fact, four products.** A **suggested or pre-filled quantity** is the
starter, not a blank form. Shopify auto-fills cost and supplier SKU from the last
PO with that supplier. Loyverse shows an `Incoming` quantity. Revel shows
`Reorder To PAR` and `Default Price` on the product. TouchBistro sells "automated
order suggestions for each vendor". So Umi's `parQuantity` and `lowStockThreshold`
columns match the market.

**Inference.** No incumbent in this lane blocks a goods receipt on a purchase
order. Shopify says a standalone transfer can receive inventory with no PO at all.
Revel and Square receive against the order. Only the inventory specialists in lane 2
treat the invoice match as a gate. So a hard three-way-match block is a
**specialist** behavior, not an incumbent behavior.

## Product detail

### 1. Square

**Documented fact.** The object is a "purchase order". The article names both
surfaces: "You can create purchase orders from your Square Retail POS app on iOS
devices or your Square Dashboard."
<https://squareup.com/help/us/en/article/8258-create-purchase-orders-with-square-for-retail>.

**Documented fact.** The dashboard route is
`Items & services > Inventory management > Purchase orders`. The POS route is
`Inventory > Purchase orders > Create purchase order`.

**Documented fact.** The order starts from a vendor and a scan: "To add items, use
the search bar to find items from your library, or select the barcode scanner icon
to scan items." A CSV or Excel import exists, and the template holds item name,
variation, SKU or GTIN, vendor code, notes, quantity, unit cost, vendor, ship-to,
and expected date.
<https://squareup.com/help/us/en/article/7656-import-purchase-orders>.

**Documented fact.** Receiving is on the order. "Click Receive All or Receive None.
To partially receive inventory, click Receive in the product row." A damaged or
unfulfilled line is marked `Won't fulfill` or `Damaged`.

**Documented fact.** Extra cost is a fee on the order, not a line cost: "Adding
additional fees will not affect the unit cost of the individual items in the
purchase order."

**Documented fact.** The permission is explicit: "Account owners or team members
with items and inventory permissions." Cost has a second gate: "If the View unit
cost permission is not enabled for your role, this field will not display cost
data."

**Documented fact.** Square lists the limits. A PO holds at most 500 unique items,
receives whole numbers only, and Square Terminal cannot create or edit a PO.

**Not verified.** A named status set. The public article shows `Save` and `Save as
Draft`, and no status chip. A supplier price-change warning is **not verified**.

### 2. Toast

**Documented fact.** Toast publishes two different purchasing stories, and the
names collide. The vendor article says it: "Bill Pay within Toast Checking is a
separate tool from xtraCHEF's Toast Bill Pay feature."
<https://support.toasttab.com/en/article/Manage-Vendors-in-Bill-Pay>.

**Documented fact.** Bill Pay is accounts payable. The screen holds "bills" and
"vendors", and the workflow starts from a document: "Drop a PDF, JPG, or PNG file
of your invoice into the Upload an invoice box… the system will automatically
extract the invoice details for you."
<https://support.toasttab.com/en/article/Use-Bill-Pay-With-Toast-Checking>.
The payment statuses are shown in a `Status` column.

**Documented fact.** The vendor surface is one screen: `Toast Web > Bill Pay >
Vendors`. The columns are Name, Account #, and Address. The only create action is
`Add vendor`.

**Documented fact.** The permission is `8.1 Financial Accounts`, with Toast Checking.

**Documented fact.** xtraCHEF is a separate paid product to add: "Already a Toast
customer? Add xtraChef." The marketing page sells "invoice automation, recipe
costing, inventory management, and cost reporting", and claims invoice data syncs
"directly into your accounting system".
<https://pos.toasttab.com/products/xtrachef>.

**Not verified.** The xtraCHEF purchase-order object, its statuses, its receiving
screen, and its match rule. The public support sitemap holds 755 English articles
and no xtraCHEF purchase-order article. The community host answers HTTP 403 with a
Cloudflare challenge.

**Inference.** Toast splits the problem differently than every other product in
this lane: the payable document is first-class and free with checking, and the
goods order is a paid add-on with almost no public documentation. For Umi, whose
ordering problem is the goods side, Toast is a weak model to copy.

### 3. Shopify

**Documented fact.** The object is a "purchase order" in the admin:
`Products > Purchase orders`. It "lists the products, quantities, costs, payment
terms, and supplier details".
<https://help.shopify.com/en/manual/products/inventory/purchase-orders>.

**Documented fact.** The order starts from a supplier. Products are added manually,
by CSV, or with a barcode scanner. "Recently purchased" narrows the list to the
products bought from that supplier before.

**Documented fact.** Cost and supplier SKU auto-fill: "If you've ordered the
product from the selected supplier before, then the Supplier SKU, Cost, and Tax
values are auto-filled from your previous purchase orders with that supplier."
If there is no history, the cost falls back to the variant cost.

**Documented fact, and the key status rule.** Two statuses exist: `Draft` and
`Ordered`. "Marking a purchase order as ordered can't be reversed." Receiving,
partial receipt, completion and closure are "tracked on the linked inventory
transfer instead".

**Documented fact.** Receiving is a separate record and a separate route:
`Products > Transfers`. Per item the operator picks `Accept`, `Reject`, or
`Cancel`, or sweeps with `Accept all`. "Rejected inventory is recorded on the
transfer and doesn't add to the available quantity at any location."

**Documented fact.** The transfer holds the landed cost: "Shipping costs, customs
duties, and other fees often aren't known when you create a purchase order. You can
add these as cost adjustments to individual shipments on the linked inventory
transfer."

**Documented fact.** The payment is out of scope: "Payments to suppliers must be
paid outside of your Shopify admin, using a payment method that you organize with
your supplier."

**Not verified.** The permission name. A supplier price-change warning is
**not verified**.

### 4. Clover

**Documented fact.** The public help centre is a login gate. It shows three
articles: "Get ready to use Clover in three steps", "Access your Clover account",
and "Set up your Clover device".
<https://www.clover.com/en-US/help/>.

**Documented fact.** `https://help.clover.com/api/v2/help_center/articles/search.json?query=inventory`
answers HTTP 301 and then the login gate. Clover is not a Zendesk host.

**Not verified.** The purchase-order object, its surface, its start, its statuses,
its receiving, its match rule, its cost behavior, and its permission. No public
vendor source settles these. The assets index records every route that was tried.

**Inference.** The public material suggests Clover has an inventory management
feature. This pass found no source that states a purchase-order flow, so it stays
out of the grid.

### 5. TouchBistro

**Documented fact.** A purchase order is a named feature of Inventory Management, a
separate paid module. The marketing page sells "automated order suggestions for
each vendor based on your restaurant's needs".
<https://www.touchbistro.com/inventory-management/>.

**Documented fact, quoted.** "Manage all your vendors in one place, create purchase
orders in minutes, and email your inventory orders directly to your vendors."

**Documented fact.** A mobile app carries the flow: "venues can complete tasks such
as restaurant inventory tracking, creating recipes, sending purchase orders to
vendors, and keeping tabs on food costs." An FAQ adds: "Yes, you can order online
from select vendors directly through TouchBistro Inventory Management."

**Documented fact.** Cost and recipe costing are named features: "Optimize new and
existing recipes… see the profit margins of every dish."

**Not verified.** The statuses, the receiving screen, the match rule, the cost-write
behavior, and the permission. `https://help.touchbistro.com/hc/en-us` answers HTTP
401, so the help centre is login-gated.

### 6. SpotOn

**Documented fact.** `https://support.sposystems.com/` and
`https://www.sposystems.com/` both fail DNS with `ERR_NAME_NOT_RESOLVED`. The live
host is `https://help.spoton.com/`, a Refined knowledge base.

**Documented fact.** The public Back of House index holds menu, order, payment,
printer and employee articles. It holds no inventory or purchasing article.
<https://help.spoton.com/page/spoton-restaurant-backoffice>.

**Not verified.** The whole purchase-order flow. No public vendor source settles
it in this pass.

**Inference.** SpotOn may run purchasing in the merchant dashboard rather than the
help centre. This pass could not confirm it, so it stays UNVERIFIED.

### 7. Revel Systems

**Documented fact.** The object is a "purchase order" in the Management Console at
`Inventory > Purchase Order`, and on the POS app.
<https://support.revelsystems.com/s/article/Creating-Purchase-Orders-1583149943284>.

**Documented fact.** Two create paths exist. `Create New PO` is for goods not yet
received. `Create New PO & Receive` is "if you already have the inventory on-hand
and need to update your inventory numbers and records". **Inference:** this is a
shortcut for the back-dated receipt, and no other product in this lane shows it.

**Documented fact.** The order starts from a vendor. Items are added from the
vendor's item list, or from all items via `Show All Items`. A new product is created
inline with `Add New Product`, and the product form carries `Reorder Qty`,
`Reorder To PAR`, and `Conversion Factor`.

**Documented fact, the five statuses.** "New: Your purchase order has been created
and saved… Sent: Indicates the purchase order has been sent to the vendor.
Partially Received… Fully Received… Finalized: Indicates the purchase order has
been fully received and closed. Edits can no longer be made."

**Documented fact.** Receiving runs in the console or on the POS. "If your vendor
has provided an invoice, enter the invoice number in the top right corner." The PO
list holds a separate `Invoice Status` column.

**Documented fact.** The product cost model has two modes, set in `Inventory
Settings`: `Use inventory cost`, and `Use ingredient cost to calculate product
cost`. With both on, "the ingredient itself will have a dynamic cost based on the
inventory cost".

**Not verified.** A price-change warning, and the permission names. The public
article states neither.

### 8. Loyverse

**Documented fact.** The object is a "purchase order" in the Back Office at
`Inventory Management > Purchase Orders`. It is part of Advanced Inventory
Management and "require[s] an active subscription".
<https://help.loyverse.com/help/how-purchase-orders-and-suppliers>.

**Documented fact.** The order starts with the supplier and the store, then items
by search of name, SKU or barcode, or a CSV import. The `Incoming` field "shows the
total expected quantity for an item based on all existing purchase orders not yet
received".

**Documented fact, the five statuses.** "Draft: Order saved but not yet submitted.
Pending: Order created and awaiting receipt of items. Partially Received: Some
items in the order have been received… Closed: All items have been received, and
the order is complete."

**Documented fact.** The order actions are `Receive`, `Edit`, `Send`, and a `More`
menu with PDF, CSV, duplicate, print labels, and cancel remaining items.

**Documented fact, and the cost rule.** "Once received, the stock levels and
average cost of each item will be updated automatically based on the supply price
specified in the order." So Loyverse writes the weighted-average cost on receipt.

**Not verified.** A price-change warning, and the permission names.

## The gap for Umi, against this lane

These points come from the grid and the vendor text above. They are the decisions
the synthesis can carry.

1. **The object split is the design decision, not the screen count.** Shopify and
   Revel separate the agreement from the receipt. Loyverse and Square do not. Umi
   already has the split in the schema: `purchase_order` and
   `purchase_order_receipt` are separate tables. **Documented fact**,
   `docs/migration/build-v3/69_procurement.sql`. So Umi can follow the stronger
   model without a migration.
2. **The order should start from a suggestion, not a blank form.** Four products
   pre-fill quantity, cost, or both. Umi has `parQuantity`, `lowStockThreshold` and
   an existing low-stock view. A blank "new order" form would be below the market.
3. **Receiving is mobile and on the goods.** Revel and Square receive on the POS.
   Loyverse and TouchBistro receive on a phone app. Shopify receives on a separate
   transfer record. Umi's till is UmiPOS, so the receive action belongs there or on
   a phone layout, not only in the dashboard.
4. **The invoice is a record, and a gate only in the specialist products.** No
   incumbent in this lane blocks the receipt on the invoice. The three-way match is
   a lane-2 behavior. Umi can record the vendor invoice number on the receipt,
   like Revel, and keep the strict match optional.
5. **Cost writes on receipt, and the invoice is the source of truth when it
   arrives.** Loyverse writes the average cost from the supply price at receipt.
   Revel makes the dynamic cost a setting. Umi already commits a supplier invoice
   through the same path as the receipt, so the invoice can win when it differs.
6. **The supplier is a real object with a per-supplier item list.** Revel, Square
   and Shopify all narrow the item picker to the vendor's items and remember the
   last cost. Umi has `merchant.supplier`, and the screens must use it that way.

## What did not change

This pass extends, and does not repeat, four prior files:

| Prior file                                                                         | Already owns                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `docs/research/2026-09-15-competitor-feature-matrix-fudo-softrestaurant-clover.md` | the POS feature matrix, including the SoftRestaurant PO chain |
| `docs/research/2026-09-17-inventory-kitchen-systems-deep-dive.md`                  | the inventory capability matrix across six systems            |
| `docs/research/2026-09-18-inventory-surface-placement/README.md`                   | where each vendor puts the inventory surface                  |
| `docs/research/2026-09-18-inventory-ui-ux-surfaces.md`                             | the screen inventory, per vendor, per device                  |

The prior pass named Lightspeed as the one help centre with a purchase-order
screenshot. This lane confirms two more: Loyverse and Revel publish real product
screens, and Toast and Clover publish product screens only inside a gated or paid
product. The finding "every vendor hides the back office behind a login" is still
true; the exception list grew.
