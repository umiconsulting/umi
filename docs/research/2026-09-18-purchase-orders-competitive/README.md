# Purchase orders: how the market does it, and where Umi stands

- Date: 2026-09-18
- Question: how does the market run a purchase order end to end, from the first
  shortage to the paid supplier invoice?
- This informs: the purchase-order surface and workflow that Umi builds in the
  dashboard.
- Evidence window: vendor documentation, help centres, user-generated content,
  standards, and rendered screens read between 2026-09-16 and 2026-09-18.
- Evidence: 43 captures in [`assets/`](assets/INDEX.md), and five lane files in
  [`sections/`](sections/).

## 1. The answer

**Inference, with the evidence in section 3.** The market does not treat the
purchase order as a form. It treats the order as one of three documents. The
order is the agreement, the receipt is the fact, and the invoice is the price.
The strong products separate the three, and the weak products collapse them.

Umi already holds all three documents, the split between them, a CFDI reader for
the supplier's invoice, and a receipt path that writes the item cost. Umi exposes
none of it as a workflow. A merchant can upload a supplier invoice and cannot
raise the order it belongs to. That is the gap, and it is a screen gap, not a
model gap.

## 2. Method, and what it is worth

Five lanes ran in parallel. Each lane owned one file, one comparison grid, and one
route-failure log.

| Lane | File                                                                  | Owns                                             |
| ---- | --------------------------------------------------------------------- | ------------------------------------------------ |
| 1    | [01-anglo-pos.md](sections/01-anglo-pos.md)                           | the English-language POS incumbents, 8 products  |
| 2    | [02-inventory-specialists.md](sections/02-inventory-specialists.md)   | the inventory specialists, 10 products           |
| 3    | [03-mexico-latam.md](sections/03-mexico-latam.md)                     | Mexico and Latin America, 8 product groups       |
| 4    | [04-ugc-and-reviews.md](sections/04-ugc-and-reviews.md)               | the operator's own words, 58 items               |
| 5    | [05-standards-and-practice.md](sections/05-standards-and-practice.md) | the standards, and what breaks in a kitchen      |
| 6    | [06-our-current-state.md](sections/06-our-current-state.md)           | the Umi repository, with a line number per claim |

**Documented fact, and it is the limit of this pass.** The review sites are
blocked from this workstation. G2, Capterra, Trustpilot, GetApp, Software Advice
and TrustRadius answer HTTP 403. No lane cites them. The operator voice comes from
the App Store, Google Play, Reddit, the Shopify community, the Square community,
and Hacker News.

## 3. The market, in one grid

The full grids are in the lane files. This one keeps the rows that decide the
build. "Not verified" is a real cell, not a blank.

| Product                     | PO object                                            | Surface                                  | Starts from                                      | Suggested quantity                           | Supplier catalogue and price                           | Order and receipt split                    | Receiving device                 | Cost written at receipt                    | Invoice matched to order and receipt                         | Approval step                                      | Order sent to the supplier         | Supplier CFDI read           |
| --------------------------- | ---------------------------------------------------- | ---------------------------------------- | ------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------ | ------------------------------------------ | -------------------------------- | ------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------- | ---------------------------------- | ---------------------------- |
| **SoftRestaurant** (MX)     | yes, "Órdenes de compra"                             | desktop back office                      | min/max, and email generation                    | not verified                                 | yes, supplier catalogue                                | yes                                        | not verified                     | XML price fields imported                  | not verified                                                 | not verified                                       | email generation documented        | **yes — the only one found** |
| **Loyverse**                | yes, "Órdenes de compra"                             | Back Office, paid tier                   | hand, or autofill from low stock                 | yes: optimal − in stock − incoming           | item codes; price comparison not verified              | no                                         | phone and web                    | yes: average cost from the supply price    | no                                                           | not verified                                       | no                                 | no                           |
| **Fudo** (AR/MX)            | **no** — a purchase is a _gasto_                     | web back office                          | hand                                             | no                                           | not verified                                           | no                                         | photo or PDF via Recepción IA    | not verified                               | no                                                           | no                                                 | no                                 | no                           |
| **PoloTab** (MX)            | yes                                                  | admin portal                             | automatic                                        | not verified                                 | not verified                                           | not verified                               | not verified                     | not verified                               | not verified                                                 | not verified                                       | not verified                       | not verified                 |
| **Revo XEF**                | yes                                                  | back office or Revo STOCK                | not verified                                     | not verified                                 | cost prices                                            | yes, partial and total                     | not verified                     | not verified                               | not verified                                                 | not verified                                       | not verified                       | not verified                 |
| **Square**                  | yes                                                  | Dashboard, plus retail POS               | vendor, then scan                                | no                                           | vendor-associated item and cost                        | no                                         | POS and dashboard                | cost associated with the vendor            | no                                                           | permission, plus a separate cost gate              | not verified                       | no                           |
| **Shopify**                 | yes                                                  | Admin; the POS never creates it          | supplier, then manual, CSV, or scanner           | "Recently purchased" narrows the list        | last PO with that supplier fills cost and SKU          | **yes — separate inventory transfer**      | dashboard, on the transfer       | yes, on the transfer                       | no; payment is outside the product                           | not verified                                       | no                                 | no                           |
| **Revel**                   | yes                                                  | Management Console, and the POS app      | vendor item list; items created inline           | `Reorder To PAR` on the product              | vendor item list                                       | yes, with a separate `Invoice Status`      | console and POS                  | yes                                        | reference only, not a block                                  | not verified                                       | not verified                       | no                           |
| **Lightspeed** (prior pass) | yes                                                  | Back Office                              | supplier                                         | not verified                                 | supplier column                                        | yes                                        | not verified                     | not verified                               | supplier invoice is a column, not a match                    | not verified                                       | not verified                       | no                           |
| **WISK**                    | yes                                                  | web console                              | Cart Builder, par, order guide, or after a count | **yes: par − stock − pending POs**           | distributor item and price                             | yes                                        | phone and web                    | yes, then corrected per line               | PO becomes the invoice; quantity and cost corrected          | not verified                                       | email, SMS, spreadsheet, or portal | no                           |
| **MarketMan**               | yes                                                  | web and phone                            | par, low stock, "fill to par"                    | yes: par − stock, plus sales                 | per-supplier catalogues, price comparison              | yes                                        | **phone, item by item**          | yes                                        | invoice processing flags shorts, subs and billing faults     | one-click approve, plus budgets and price limits   | automatic submission               | not verified                 |
| **Restaurant365**           | yes                                                  | web; shopping list then order suggestion | shopping list, then order suggestion             | yes: consumption and buffer days             | order-guide integrations refresh price                 | yes                                        | web; receiving by purchased item | yes                                        | **automatch** on vendor, location, variance and date window  | reviewer submits; vendor minimums with an override | email, EDI or API                  | no                           |
| **Supy**                    | yes: "Supplier order", plus a separate "Requisition" | web and phone                            | supplier, then items; templates                  | yes: forecast − stock − scheduled deliveries | supplier codes, scheduled price with an effective date | yes                                        | **GRN on a phone**               | yes, and the GRN becomes a Xero draft bill | Received Items compares invoice, received and expected price | a Policy holds the order for email approval        | submit sends it to the supplier    | no                           |
| **Craftable**               | yes                                                  | web                                      | one multi-vendor cart                            | not verified                                 | contract pricing and SKU-level contract match          | yes: the delivery receipt is a named input | not verified                     | not verified                               | **three-way, in its own words**                              | limits by location, department and amount          | EDI or punchout                    | no                           |

## 4. What the market agrees on

1. **The order lives in a web back office.** **Documented fact.** Five of the
   eight incumbents put the list in a browser console, and Shopify never puts the
   order on the till. Every product in the Mexico lane keeps it in the back
   office. No product in any lane puts purchase-order approval inside the POS.
   This answers the placement question directly: the POS is the wrong home for
   this object.
2. **The order starts from a suggestion.** **Documented fact.** Ten products
   pre-fill the quantity, the cost, or both. WISK states the strongest formula:
   `par − stock − pending POs`. Loyverse states the same rule in Spanish:
   `Cantidad = Stock óptimo − En stock − Stock entrante`. A blank "new order" form
   is below the market.
3. **The order and the receipt are two documents.** **Documented fact.** Shopify
   says the reason in its own words: "One record captures the agreement, and the
   other tracks the physical movement of goods." Revel separates them with a
   second status column. Umi already splits them in the schema.
4. **The receipt is where the goods are.** **Documented fact.** MarketMan receives
   item by item on a phone. Supy uses a goods-received note on a phone. Square and
   Revel receive on the till. The desktop authors the order; the floor receives it.
5. **The receipt writes the cost.** **Documented fact.** Loyverse writes the
   average cost from the supply price at receipt. IAS 2 puts inventory at the cost
   of purchase. A goods-received-not-invoiced source states that the receipt
   creates the inventory and the liability, and the invoice clears it.
6. **The invoice match is a specialist behaviour, not an incumbent one.**
   **Documented fact.** No incumbent in lane 1 blocks a receipt on an invoice.
   Craftable, Supy, Apicbase, Restaurant365 and MarginEdge do match, and
   Restaurant365 publishes the rules.
7. **Approval and segregation of duties appear above a threshold.**
   **Documented fact.** Craftable holds limits by location, department and amount.
   Supy holds an order over a spend limit for email approval. MarketMan holds
   budgets and price limits. GAO-14-704G states the control: separate authority,
   custody and accounting, and design another control when the team is small.
8. **In Mexico, the purchase order is not a fiscal document.** **Documented
   fact.** The SAT Anexo 20 CFDI 4.0 guide and the Pagos 2.0 guide do not use the
   phrase "orden de compra". The La Costeña supplier portal publishes a flow named
   "Recepción de factura **sin orden de compra**". The order is an internal
   control, and the CFDI is the fiscal fact.

## 5. Where the sources disagree

1. **Shopify against the rest, on the object count.** Shopify splits the agreement
   from the movement in the product's own documentation. Loyverse and Square
   receive against the order. **Documented fact** on both sides. The disagreement
   is the design decision, and this file takes the Shopify position in section 8.
2. **SoftRestaurant against itself.** The marketing page sells a full procurement
   chain. Its own ERP article says the shop with an ERP should buy in the ERP and
   leave SoftRestaurant as the till: _"la idea general de la integración es que
   SoftRestaurant® utilice solo las funciones de punto de venta y las funciones
   administrativas sean realizadas en el ERP"_. **Documented fact.**
3. **PoloTab against the prior Umi pass.** The prior matrix recorded PoloTab
   procurement as partial. The vendor now advertises automatic purchase-order
   generation. The vendor page is newer. **Documented fact** on both sides.
4. **Alegra against Bind ERP, on the meaning of the words.** Both are
   invoicing-first. Alegra states that its order moves no inventory and no payable.
   Bind ships a receipt-verification screen. The same Spanish phrase names two
   different objects. **Source-backed tradeoff.**
5. **Toast against the field, on the object.** Toast publishes no purchase-order
   object; `Bill Pay` moves an invoice to a payment. Its sister product xtraCHEF
   owns the goods side and publishes no readable article. **Documented fact, and a
   recorded block.**

## 6. What did not change since the prior files

| Prior file                                                                                                                                  | Still owns                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [2026-09-18-purchase-orders-gap.md](../2026-09-18-purchase-orders-gap.md)                                                                   | the repository audit: the API is complete, the screen is absent |
| [2026-09-17-inventory-kitchen-systems-deep-dive.md](../2026-09-17-inventory-kitchen-systems-deep-dive.md)                                   | the inventory matrix, and the SoftRestaurant min/max claim      |
| [2026-09-15-competitor-feature-matrix-fudo-softrestaurant-clover.md](../2026-09-15-competitor-feature-matrix-fudo-softrestaurant-clover.md) | the POS feature matrix                                          |
| [2026-09-18-inventory-surface-placement/README.md](../2026-09-18-inventory-surface-placement/README.md)                                     | where each vendor puts the inventory surface                    |
| [2026-09-18-catalog-vs-inventory-ia.md](../2026-09-18-catalog-vs-inventory-ia.md)                                                           | the Catalog-versus-Inventory grouping question                  |

The finding that the procurement API is complete and unused **did not change**.
Section 7 restates it with a line number and adds the parts the prior file did not
cover. The Lightspeed purchase-order screenshot from the surface-placement pass is
still the single best capture of a PO list, and this pass adds twelve more vendor
screens.

## 7. The gap analysis

Every Umi cell in this table carries a line number in
[06-our-current-state.md](sections/06-our-current-state.md).

| #   | The capability                               | The market                                               | Umi today                                                                                                        | The gap                                                                 |
| --- | -------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | Create a purchase order                      | the norm; Fudo, Toast and Parrot publish no such object  | no caller for `purchaseOrderCreate` anywhere in `apps/` or `packages/`                                           | **Blocking.** The invoice inbox cannot finish its job.                  |
| 2   | Start from a shortage                        | 10 products pre-fill                                     | `parQuantity`, `lowStockThreshold` and an `inventoryCosting.lowStock` route exist; no screen reads them to order | **High.** The input is already computed, and unused.                    |
| 3   | A per-supplier item list with the last price | standard, and it narrows the picker                      | `merchant.supplier` exists, and `supplierSku` is on the line; no screen creates or edits a supplier              | **High.** The supplier is a table with no door.                         |
| 4   | Order and receipt as two documents           | the strong products split them                           | already split: `purchase_order` and `purchase_order_receipt`                                                     | **Low.** No migration is needed. The screen must show the split.        |
| 5   | Receive where the goods are                  | phone or till                                            | all nine routes are `auth: 'session'` and `dart: null`, so the native POS cannot receive at all                  | **High.** UmiPOS cannot take part in receiving.                         |
| 6   | The receipt writes the item cost             | standard                                                 | `PurchaseOrderReceiptLine.actualUnitCostMinor` exists, and the invoice commit writes through the receipt         | **Low.** The mechanism is built.                                        |
| 7   | The invoice wins when it disagrees           | specialists match, incumbents record                     | the invoice commit path exists; the receipt carries no invoice reference                                         | **Medium.** Revel records an invoice number on the receipt. Umi cannot. |
| 8   | Read the supplier CFDI into stock and cost   | **only SoftRestaurant** does it                          | `cfdi-parser.ts` reads a received CFDI 4.0 file, and `supplier_invoice.cfdi_uuid` is unique per merchant         | **This is Umi's differentiator, and it is unreachable.**                |
| 9   | On-order quantity on the decision screen     | WISK subtracts pending orders; Loyverse shows `Incoming` | `purchaseOrderList` is read and filtered to open statuses, and only the invoice dialog uses it                   | **High.** Nothing shows "already on order".                             |
| 10  | Approval and segregation of duties           | specialists, above a threshold                           | all nine routes carry one gate, `merchant.manage`                                                                | **Medium.** A manager who is not an owner cannot raise an order.        |
| 11  | Send the order to the supplier               | email, EDI, SMS or a portal                              | `purchaseOrderSend` moves stock to `in_transit` and produces no document for the supplier                        | **Medium, and it is a naming question.** "Send" means "commit" today.   |
| 12  | An empty state that teaches                  | xtraCHEF ships a setup wizard                            | the Compras tab shows the invoice inbox only                                                                     | **Medium.**                                                             |

### 7.1 The four gaps that block a real workflow

1. **Nothing creates an order.** **Documented fact.** The write routes have no
   caller. A shop with 102 suppliers and 688 historical orders, as the rehearsal
   branch holds, still cannot raise the 689th.
2. **The invoice inbox is a dead end.** **Documented fact.**
   `invoice-model.js:190` returns `no_order`, and `invoice-inbox.jsx:312` needs
   `order.id`. On a new shop, an uploaded invoice matches its lines and stops.
3. **The shortage signal has no destination.** **Documented fact.** The low-stock
   route returns `belowThreshold`, `dailyRateQuantity` and `daysOfCover`. No
   screen offers the order action beside it.
4. **The POS cannot receive.** **Documented fact.** Every procurement route
   carries `dart: null`. The market receives on a phone or the till, and Umi's
   till has no route to receive on.

### 7.2 The two defects that are naming and placement, not missing code

1. **The `Compras` tab holds no purchase order.** **Documented fact.** The tab is
   `{ id: 'purchases', route: 'compras' }` and the body is `<InvoiceInbox />`.
   The label promises a screen that is absent.
2. **`send` does not send.** **Documented fact.** The route is named
   `purchaseOrderSend`, and its effect is a status change and an `in_transit`
   ledger entry. It produces no email, no PDF and no portal submission. The
   market's `Sent`, `Placed` and `Ordered` mean a commitment; Umi's means the
   same thing internally. The name is honest about the internal commitment and
   silent about the missing transmission.

### 7.3 What Umi holds that most of the market does not

**Documented fact.** Three capabilities are already in the repository and absent
from almost every competitor in this pass:

1. A hardened CFDI 4.0 reader for the **received** supplier invoice
   (`cfdi-parser.ts`), with entity expansion off and integer minor units.
2. A unique index on the CFDI UUID per merchant
   (`76_recipes_inventory.sql:572`), so one invoice cannot price the stock twice.
3. An over-receipt refusal that is a SQL constraint **and** a typed API error
   (`69_procurement.sql:37`, `procurement-domain.ts:116`).

**Inference.** The differentiator is not "we also have purchase orders". It is
"the order, the delivery and the CFDI become one chain, and the ingredient price
stays current." Only SoftRestaurant does part of this in Mexico, and it does not
carry the other two guarantees.

## 8. The recommendation, and the runner-up

**The recommendation.** Build the purchase order as three connected documents in
the dashboard, and take the Shopify split.

1. **The order.** It starts from a shortage or a supplier, never from a blank
   form. The item picker narrows to the chosen supplier and shows the last price.
   The suggested quantity is `par − on hand − on order`. One primary action moves
   a draft to a commitment.
2. **The receipt.** It is the fact. It records the delivered quantity, the real
   unit cost, and the supplier's invoice number and CFDI. It writes the item cost.
   It must be reachable from a phone, because the market receives on the floor.
3. **The invoice.** It confirms or corrects the receipt. The variance shows. It
   does not block the operator, and it does not block the stock.
4. **The placement.** The dashboard is the authoring surface. The POS is the
   receiving surface, and that needs a Dart-bound route.

**The runner-up, and why this file rejects it.** The runner-up is the invoicing-first
model that Alegra ships: an informational order that moves no stock and no payable.
It is the smaller build. Reject it, because the item cost is the number the recipe
and margin modules depend on, and an informational order leaves that number stale.
SoftRestaurant's receipt path and Loyverse's cost-on-receipt rule are the models to
take instead.

**The smaller runner-up, for the first slice.** A read-only order list, with no
create action, is the tempting first step. Reject it for the same reason: the
repository already holds 688 orders in rehearsal, so a read-only list would be
populated and still would not let a shop raise the next one.

## 9. What remains uncertain

1. **SoftRestaurant's order statuses and min/max wording** are not verified in
   this pass. The min/max rule comes from the prior matrix.
2. **xtraCHEF's purchasing flow** is not verified. Every route failed, and the
   block is recorded in lane 2.
3. **Clover, SpotOn, TouchBistro and Parrot** publish no readable purchase-order
   content. The absence is recorded, and it is not proof that the feature is
   absent from the product.
4. **The Square community dates are relative.** Lane 4 records them as UNVERIFIED.
5. **A Spanish operator review about a purchase order** was not reached, because
   the review sites answer 403.

## 10. Before you close this file

1. Every claim carries a label. **Yes** — 295 labelled claims across the six
   section files.
2. Every named screen has a capture or a recorded block. **Yes** — 43 captures,
   and five route-failure tables.
3. Every blocked host has two routes tried and a status. **Yes** — see the lane
   route-failure logs.
4. The comparison grid holds a value, a "no", or "not verified" in every cell.
   **Yes** — section 3, and the three lane grids.
5. The recommendation names the runner-up and the reason to reject it. **Yes** —
   section 8, two runner-ups.
6. The file says what changed since the prior pass, and names that pass. **Yes** —
   section 6, and section 5 item 3.
