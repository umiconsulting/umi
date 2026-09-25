# Purchase orders in the inventory specialists

- Date: 2026-09-18
- Lane: 2 of 5 in the purchase-order pass
- Question: in the products whose core feature is restaurant inventory, how does a
  purchase order start, travel, arrive, and reach the ledger?
- Decision this informs: the purchase-order surface that Umi builds in the
  dashboard.
- Evidence window: vendor help centres, vendor product pages, and vendor API
  endpoints read on 2026-09-18.
- Captures: eight, in `../assets/`. The index is
  [assets/INDEX-02-specialists.md](../assets/INDEX-02-specialists.md).

## Method, and what it is worth

One route carries most of this file: the vendor's own help centre. WISK, Supy and
Apicbase publish it on Intercom, so `https://r.jina.ai/<article url>` returns the
article body. MarginEdge and Crunchtime publish it on Zendesk, so
`/api/v2/help_center/articles/search.json` returns the article list. Restaurant365
is Document360 and publishes an `llms.txt` index of 498 KB. Craftable, MarketMan
and Toast have no readable help centre from this workstation, so their evidence is
a product page and it is labelled as vendor marketing.

Every claim below carries one of three labels:

- **Documented fact** - the vendor wrote it, and the URL is given.
- **Source-backed tradeoff** - the vendor wrote it, and it trades one thing for another.
- **Inference** - my reading, with the evidence that supports it.
- A question the evidence does not settle reads **not verified**.

## The comparison grid

Rows are the ten products in priority order. "PO" means the product's own word for
the document.

| #   | Product          | The object                                                                    | Order starts from                                                                  | Suggested quantity                                                          | Supplier catalogue and price alert                                                                                                     | Sent how                                                         | Approval step                                                              |
| --- | ---------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | MarketMan        | "Purchase order"                                                              | Par level, low stock, one click "fill to par", or hand                             | Yes: par minus stock; vendor says it also uses POS sales                    | Yes, per-supplier catalogues and price comparison. Price alert: **not verified** as an alert                                           | Automatic submission from web or app                             | One-click approve before send; budgets, price limits and permissions       |
| 2   | WISK             | "Purchase order"                                                              | Cart Builder, par levels, order guide items, or automatic after an inventory count | Yes: par minus stock minus pending POs                                      | Yes, distributor item and price. Price alert: **not verified**                                                                         | Email, SMS, spreadsheet export, or a supplier-portal integration | **Not verified**                                                           |
| 3   | Craftable        | "Purchase order"                                                              | One multi-vendor cart                                                              | **Not verified**                                                            | Yes, contract pricing and SKU-level contract match; overcharge and price-creep flags                                                   | EDI, punchout, or enhanced catalogues                            | Yes: limits by location, department and amount, multi-step                 |
| 4   | xtraCHEF (Toast) | **Not verified** - the product sells invoice automation                       | **Not verified**                                                                   | **Not verified**                                                            | **Not verified**                                                                                                                       | **Not verified**                                                 | **Not verified**                                                           |
| 5   | Apicbase         | "Purchase order"                                                              | Ingredient list by supplier, order lists, "To Par", or a sales-based suggestion    | Yes: par minus stock; and forecast minus stock minus scheduled deliveries   | Yes, supplier item and price; integration catalogues. Price alert: **not verified**                                                    | E-mail Order to the supplier, with a copy to the buyer           | **Not verified**; minimum purchase amounts exist                           |
| 6   | Supy             | "Supplier order", with a separate "Requisition"                               | Supplier, then tap items and quantities; templates and standing orders             | Yes: AI sales forecast minus stock minus scheduled deliveries               | Yes, supplier item codes and a scheduled price with an effective date                                                                  | Submit sends to the supplier; approval is by email               | Yes: a Policy holds an order over a spend limit for email approval         |
| 7   | KitchenCut       | "Purchase order", emailed                                                     | Order, then email to the supplier                                                  | **Not verified**                                                            | Yes, supplier code and price; bulk price-only import                                                                                   | Email, with an outbound-email status panel                       | Order approval: **not verified**. Invoice approval: yes                    |
| 8   | Crunchtime       | "Vendor order", "Master order", "Commissary order"                            | Schedule and Auto-Order, or a manual vendor order                                  | Yes: a Recommended Order formula over forecast, on-hand and on-order        | Yes, order guide and vendor units. Order minimums and alert thresholds                                                                 | E-mail PO, EDI over FTP/SFTP, or the vendor site                 | Permission-gated configuration; **not verified** as a spend gate           |
| 9   | MarginEdge       | "Purchase order" inside "Orders"; the ordering surface is the "Order guide"   | Vendor, then the order guide                                                       | Yes: par minus a hand-entered on-hand; last count shown as a reference only | Yes: item code and last purchase price, with a price-fluctuation graphic                                                               | Email from `no-reply@marginedge.com`; EDI only for Profish       | Invoice approval; order editing can be switched off                        |
| 10  | Restaurant365    | "Purchase order"; the starter is an "Order suggestion" from a "Shopping list" | Shopping list, then an Order Suggestion form, split by vendor                      | Yes: the Order Suggestion form; templates carry consumption and buffer days | Yes: order-guide integrations update availability and pricing automatically; cost resolves from contract, then guide, then vendor item | Email to the vendor contact, or EDI/API                          | Yes: a reviewer submits; vendor order minimums with an override permission |

| #   | Product          | Receiving                                            | Partial delivery and substitution                                                                  | Invoice match                                                                                  | Accounting hand-off                                                          |
| --- | ---------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | MarketMan        | Phone, on the purchase order, item by item           | Discrepancies and missing items flagged at once; partial: **not verified** in those words          | Invoice processing at scale, shorts, subs and billing irregularities flagged                   | Accounting integrations; accounts-payable automation                         |
| 2   | WISK             | Phone and web; the invoice is built from the open PO | Quantity and cost adjustments per line; partial: implied, not stated                               | PO converts to an invoice, then quantity and cost are corrected per line                       | Accounting-software integrations                                             |
| 3   | Craftable        | Yes: a delivery receipt is a named input             | Not verified                                                                                       | **Three-way**: "Match invoices to orders and receipts line by line"                            | AP automation and GL coding                                                  |
| 4   | xtraCHEF (Toast) | **Not verified**                                     | **Not verified**                                                                                   | **Not verified**                                                                               | Invoice data "directly into your accounting system"                          |
| 5   | Apicbase         | Sent Orders; per item: all, part or none             | **Yes**: delivered quantity, price paid, and a remark code for wrongly delivered or over-delivered | Invoice attached to the PO; invoice reconciliation is a named article                          | Procurement report and exports                                               |
| 6   | Supy             | GRN (goods received note), mobile requests           | Yes: invoice quantity beside received quantity                                                     | Received Items compares invoice quantity, received quantity and expected PO price              | Xero: the GRN becomes a draft bill                                           |
| 7   | KitchenCut       | A "Confirmed Record of Stock Received" screen        | Not verified                                                                                       | Multi-line invoice links to the PO by the PO number in the upload template                     | Approve notifies Accounts Payable; Sage 50, Xero and QuickBooks integrations |
| 8   | Crunchtime       | Yes, and "Receive Without Invoice"                   | Not verified                                                                                       | E-invoice carries the PO number; the booking journal is compared to the invoice extended value | Booking journal and enterprise GL                                            |
| 9   | MarginEdge       | Commissary receive; phone ordering                   | Not verified                                                                                       | The invoice is processed against the order; a sent PO auto-deletes when the invoice arrives    | NetSuite, Bill Pay, invoice approval, Purchasing Export                      |
| 10  | Restaurant365    | "Receiving by Purchased Item"                        | Not verified                                                                                       | Automatch on vendor, location, total variance and date window; discrepancies on the Alerts tab | AP Center with a documents queue, approval, and payment runs                 |

## What the specialists agree on

**Inference, from the grid, and it is the strongest result in this pass.** Across
six of the ten products the workflow is the same five steps, and the words differ
but the shape does not:

1. A **predefined list** is the ordering surface. WISK calls it the Cart Builder
   over distributor items. MarginEdge calls it the Order guide. Restaurant365
   calls it a Shopping list. Supy calls it a template. Crunchtime calls it the
   order guide. Nobody drops the user into a blank document.
2. A **suggested quantity** is computed and shown beside the order field. The
   inputs are always par and stock, and the stronger products add pending orders
   and a sales forecast.
3. The operator **adjusts and submits**. The product does not send on its own
   except where the operator asked for a schedule.
4. A **receipt** is a separate record from the invoice, on a phone.
5. The **invoice is matched** to the order and to the receipt, and the difference
   is a flag, not a silent write.

**Documented fact, two products, and it is the split that matters most for Umi.**
WISK separates "the order" from "the invoice that closes it", and says why:
"When you generate an order in WISK, you have to add the invoice when the order
arrives in your venue."
<https://help.wisk.ai/en/articles/3286750-adding-an-invoice-from-a-purchase-order-web>.
Restaurant365 separates the "Order Suggestion" from the purchase order: "Completed
Order Suggestion forms are then broken out into Purchase Orders by Vendor".
<https://docs.restaurant365.com/docs/purchase-orders-use-shopping-lists>. So the
market does **not** treat the order and the invoice as one object on one screen.

## Per-product findings

### 1. MarketMan

- **Documented fact.** The object is a purchase order. "Chefs and managers can
  submit purchase orders, check statuses, and manage vendors from one unified
  platform". Source:
  <https://www.marketman.com/platform/restaurant-purchasing-software-and-order-management>
  (vendor marketing).
- **Documented fact.** Creation is by hand or from par, and the vendor names both:
  "Simply click on the suppliers, categories, or items that you want to purchase
  or simply fill to par with one click of a button."
- **Documented fact.** The suggested order is automatic. "MarketMan monitors your
  inventory levels against par levels you set for each item. When stock drops
  below the par threshold, the system automatically generates a suggested purchase
  order for the relevant supplier. You review and approve the order with one
  click, then it's sent directly to the supplier."
- **Documented fact.** The catalogue holds the supplier's price and history. "You
  can manage catalogs, pricing, and order history for every supplier, compare
  prices across vendors".
- **Documented fact.** A spend gate exists. "Set up par levels, purchasing budgets,
  price limits, and manage user permissions."
- **Documented fact.** Receiving is on the phone. "your team opens the purchase
  order in the MarketMan mobile app and checks off items as they're received. Any
  quantity discrepancies or missing items are flagged immediately."
- **Documented fact.** The invoice is a product of its own: "10M+ Invoices
  Processed", and the alert list is "shorts, subs, credits, & billing
  irregularities".
- **Not verified.** The price-change alert, the partial-delivery wording, and the
  approval threshold. The help centre at `mealticket.my.site.com/helpcenter` is a
  Salesforce page whose body needs a browser session, and no article body could be
  read from this workstation.

### 2. WISK

- **Documented fact.** The object is a "purchase order", and its home is a list
  called "Orders". "To generate an order in the WISK Web Portal, click 'Orders',
  then 'Prepare Orders' on the side menu bar. This takes you to the 'Cart
  Builder'." <https://help.wisk.ai/en/articles/3286748-generating-a-purchase-order-web>
- **Documented fact.** The suggested quantity subtracts what is already on order.
  "If you have anything in the 'Pending Purchase Orders' column, this modifies the
  suggested amount to order." The worked example in the same article: "there are
  4.1 units of Grey Goose, and the par level is 6 units. It recommends that you
  should order 2 units."
- **Documented fact.** A count in progress blocks the suggestion. "If you're
  viewing the Cart Builder while an inventory count is in progress, you'll see a
  message about not being able to suggest amounts to order."
- **Documented fact.** An order can build itself. "For each distributor, you can
  generate purchase orders automatically after completing an inventory count."
  <https://help.wisk.ai/en/articles/6048143-automatic-purchase-orders>
- **Documented fact.** Sending is the operator's choice of channel. "you can
  quickly generate orders to your suppliers and send them via email, SMS, or
  export a spreadsheet and place however you prefer (phone, in person, the
  supplier's web portal, etc)".
- **Documented fact.** Price comes from the last received invoice, unless the
  operator overrides it. "the dollar value of the order is an estimate based on
  the cost of each item/item variation from the last received invoice", and the
  "Current distributor price" field sets a price with a validity period.
  <https://help.wisk.ai/en/articles/11133148-setting-the-current-distributor-price>
  The article adds that only Support or a Customer Success representative can
  switch the field on.
- **Documented fact.** Real supplier portals are integrated, by name: Sysco
  (United States and Canada), Gordon Food Service, US Foods, SAQ, BCLDB and
  Fintech. <https://help.wisk.ai/en/articles/5389845-supplier-vendor-integrations>
- **Documented fact.** Receiving is the invoice step, and it accepts a different
  quantity or a different cost per line.
  <https://help.wisk.ai/en/articles/3286750-adding-an-invoice-from-a-purchase-order-web>
- **Not verified.** An approval step or a spend threshold; a price-change alert;
  the words "partial delivery" and "substitution".

### 3. Craftable

- **Documented fact.** The three-way match is the product's own headline, and it
  is the only product in this lane that says it in one sentence: "Every invoice
  line verified against your purchase order and delivery receipt - before you pay
  a cent." <https://craftable.com/intelligent-ordering> (vendor marketing).
- **Documented fact.** Approval is configurable and enforced before the order
  leaves: "Customize approval limits by location, department, and amount", "Build
  multi-step approvals for full accountability", "Block unauthorized or duplicate
  orders before they're placed". Approval is available on a phone.
- **Documented fact.** Sending runs over machine channels, not only email: "Order
  via EDI, Punchout, or Enhanced Catalogs".
- **Documented fact.** Price control is a named feature with its own verb:
  "Craftable auto-flags overcharges, substitutions, and price creep", and it
  "Auto-match[es] invoices to contracts at the SKU level".
- **Documented fact.** Catalogues are standardised to stop substitution: the
  product claims "Standardized item descriptions prevent substitution errors".
- **Not verified.** The suggested-quantity formula, the receiving screen, and the
  name of the order object inside the app. Craftable publishes no readable help
  centre from this workstation, and the help hosts do not resolve.
- **Inference.** Craftable is the reference for the **spend-control** reading of
  purchasing, and WISK is the reference for the **stock-replenishment** reading.
  They are the two poles of this lane.

### 4. xtraCHEF (Toast)

- **Documented fact.** Toast positions xtraCHEF as invoice software first.
  "xtraCHEF by Toast is a restaurant back-office software for invoice automation,
  recipe costing, inventory management, and cost reporting."
  <https://pos.toasttab.com/products/xtrachef> (vendor marketing). The inventory
  module appears under the heading "Master inventory management".
- **Documented fact.** The Toast help centre holds an `xtraCHEF` topic with 559
  articles. <https://support.toasttab.com/en/search?q=xtraCHEF>.
- **Not verified.** The purchase order as an object, its creation path, the
  suggested quantity, the catalogue, the send channel, approval, receiving,
  invoice matching, and the accounting hand-off. The Toast help centre renders its
  results on the client, and the article links were not present in the DOM after
  nine seconds; `curl`, `r.jina.ai`, the sitemap and three guessed API paths all
  failed. The routes are in the route-failure log.
- **Inference.** This is a real block and it is a finding. A buyer who wants a
  purchase-order screen cannot read, from the outside, that xtraCHEF has one. The
  prior pass reached the same place: xtraCHEF is where "real inventory" lives, and
  the POS keeps only a quick edit
  ([2026-09-18-inventory-ui-ux-surfaces.md](../../2026-09-18-inventory-ui-ux-surfaces.md),
  section 3).

### 5. Apicbase

- **Documented fact.** The object is a purchase order, and the module is
  "Procurement". "Go to the 'Procurement' module and click on 'Create Orders'."
  <https://support.apicbase.com/help/purchase-order>
- **Documented fact.** Par drives the quantity in one button: "If you have set a
  par level for (some) ingredients, you can also click on the 'To Par' button.
  Then the quantity will be automatically calculated based on the difference of
  the par level and the remaining quantity in stock."
- **Documented fact.** A sales-based suggestion is a second, separate engine. "The
  system analyses historic sales patterns, often per day of the week (for example:
  comparing the last four Mondays to forecast the next Monday)", and it asks for
  "at least 4 weeks of sales data".
  <https://support.apicbase.com/help/demand-forecasting>
- **Documented fact.** Sending is email, and the copy is explicit: "Click on
  'E-mail Order' to generate the finished purchase order", and "Your supplier will
  receive the order per mail (and a copy goes to you)." The supplier may export the
  order to Excel or CSV.
- **Documented fact.** A supplier integration exists as a catalogue, not a link:
  Hanos, Bidfood (Netherlands and United Kingdom), Sligro, Brakes, Transgourmet,
  US Foods, Gordon Food Service, Metro Belgium and more.
  <https://support.apicbase.com/help/supplier-integrations>
- **Documented fact.** Receiving is per item and it names the partial case:
  "**Delivery state**: select if **all**, **part** or **none** of this stock item
  was delivered", with "Delivered Qt.", "Price paid", and a remark code list that
  includes "Wrongly delivered (accepted)", "Delivered too much (accepted)", and
  "Pricing issue (accepted)".
  <https://support.apicbase.com/help/receive_order>
- **Documented fact.** The invoice is attached to the purchase order, and invoice
  reconciliation is a named article:
  <https://support.apicbase.com/help/attach-supplier-invoice-to-a-purchase-order>,
  <https://support.apicbase.com/help/invoice-reconciliation>.
- **Documented fact.** The invoice status is a four-state field on the order:
  "Not yet received", "Received", "Payable", "Paid".
- **Not verified.** An approval step or a spend threshold; a price-change alert.
  Minimum purchase amounts are documented
  (<https://support.apicbase.com/help/minimum-purchase-amounts>) but no approver
  is named.

### 6. Supy

- **Documented fact.** Supy names **two** objects, and it explains the difference:
  a requisition and a supplier order.
  <https://help.supy.io/en/articles/11643167-what-s-the-difference-between-a-requisition-and-a-supplier-order>.
  The operational screen is "Procurement > Place Order".
  <https://help.supy.io/en/articles/11122708-ordering-to-your-supplier>
- **Documented fact.** Draft and submit are different states: "If you draft an
  order, it will not be submitted to the supplier, it will be saved onto the system
  until someone submits the order to the supplier."
- **Documented fact.** The spend gate is a policy on a role, and it holds the order:
  "A Policy sets a spending limit over a period; any order that would exceed it is
  held and routed for approval by email". The worked example: "a 500 SAR/month
  limit per location lets managers order routine stock themselves, but a large
  one-off order pauses for owner approval before the PO goes out."
  <https://help.supy.io/en/articles/11643227-how-do-i-set-order-spending-limits-and-approval-flows>
- **Documented fact.** The suggested quantity is a forecast chain, and Supy states
  the inputs: "accounting for current stock, scheduled deliveries, and your coverage
  period", over a "14-day demand prediction", and "Nothing is sent to a supplier
  automatically."
  <https://help.supy.io/en/articles/11643222-sales-forecasting-and-predictive-ordering>
- **Documented fact.** Receiving is a GRN, and there is an explicit path with no
  order at all: "Receive without order".
  <https://help.supy.io/en/articles/11121486-receive-without-order>
- **Documented fact.** The match is per-line and it is named: the Received Items
  page shows "**Invoice Quantity** - the documented quantity as per the supplier
  Invoice", "**Received Quantity** - the actual physically-received quantity on the
  ground", and "**Expected Price** ... the price of the package as per the
  requested PO, or the current configured supplier price".
  <https://help.supy.io/en/articles/11643140-received-items>
- **Documented fact.** The accounting hand-off is a draft bill: "Manager creates GRN
  in Supy -> attaches invoice PDF. Supy auto-creates Draft Bill in Xero ... Finance
  reviews in Xero -> posts to ledger."
  <https://help.supy.io/en/articles/11643170-what-s-the-grn-xero-workflow>
- **Documented fact.** The catalogue carries the supplier's code and a dated price:
  "Supplier Item code" is a column on the Received Items page, and a "scheduled
  item price with effective date" is its own article.
  <https://help.supy.io/en/articles/11643152-scheduled-item-price-with-effective-date>
- **Not verified.** The physical send channel from Supy to the supplier.

### 7. KitchenCut

- **Documented fact.** The object is a purchase order, and the supplier is the
  counterparty, not only the receiver: a supplier can accept, adjust or decline an
  order. "You have three options: Accept ... Accept with Adjustments ... Decline".
  <https://support.kitchencut.com/how-to-accept-email-orders>
- **Documented fact.** Email is the channel, and its delivery is on the screen:
  "You will see the **Outbound Email Status** section. This will update to show:
  Sent confirmation, Email address the order was sent to, Timestamp."
  <https://support.kitchencut.com/email-order-status>
- **Documented fact.** The supplier's price import is keyed on the supplier code:
  "Do not change the **supplier name** or **supplier code** fields. These are used
  to match the update to the existing product. Changing these values will result in
  a **new product being created** instead of updating the existing one."
  <https://support.kitchencut.com/how-to-bulk-update-pricing>
- **Documented fact.** The invoice is generated by the receipt, not by the seller:
  "Once stock has been received, Kitchen CUT will automatically generate an invoice
  record based on the delivery." Then "Check each line item against your paper or
  emailed supplier invoice", "Attach a photo or file of the original invoice", and
  "click **Approve**". "Approving will send a notification to your **Accounts
  Payable** team."
  <https://support.kitchencut.com/how-to-approve-an-invoice>
- **Documented fact.** A multi-line invoice links to the PO two ways: "by linking
  it within the Gateway interface, or including the corresponding PO number within
  the invoice upload template".
  <https://support.kitchencut.com/supplier-invoice-matching>
- **Documented fact.** The accounting hand-off is a named list: Sage 50, Xero and
  QuickBooks integrations.
  <https://support.kitchencut.com/export-for-sage-50>,
  <https://support.kitchencut.com/xero-integration>,
  <https://support.kitchencut.com/quick-books-integration>
- **Not verified.** The suggested-quantity formula, a substitution step, and an
  order-level approval or spend threshold.

### 8. Crunchtime

- **Documented fact.** The object is a "Vendor Order", and there are three more
  order objects beside it: "Master Order", "Commissary Order" and "Customer
  Order". <https://support.crunchtime.com/hc/en-us/articles/17265888173843>
- **Documented fact.** An order can place itself on a schedule, and the schedule is
  the vendor record: "if the Auto-Order Vendor's Order/Delivery schedule is Order
  Day = Monday for Tuesday delivery ... the auto-order process will not place an
  order on Monday". <https://support.crunchtime.com/hc/en-us/articles/29676459567507>
- **Documented fact.** The suggested quantity has named inputs, and the vendor
  lists them as failure causes: "Missing Sales Forecast", "On Hand, On Vendor Order
  quantities (if included in the Recommended Order formula) are high enough to
  offset projected consumption". The job "runs on a timer every 10 minutes".
  <https://support.crunchtime.com/hc/en-us/articles/29642491024915>
- **Documented fact.** The order has an alert threshold and a minimum: "The order
  violates the Order Alert threshold, Auto-Order High/Low threshold, and/or Order
  minimum settings."
- **Documented fact.** Sending has three routes: a customisable e-mail purchase
  order (<https://support.crunchtime.com/hc/en-us/articles/27842637496211>), an
  FTP/SFTP transmit with a resubmit path
  (<https://support.crunchtime.com/hc/en-us/articles/360053015654>), and a vendor
  site for US Foods.
- **Documented fact.** The invoice carries the order's identity: "Why can't I find
  the Purchase Order Number on my E-Invoice?"
  <https://support.crunchtime.com/hc/en-us/articles/17117165611923>
- **Documented fact.** A receipt without an invoice is an expected case: "FAQ -
  Receive Without Invoice".
  <https://support.crunchtime.com/hc/en-us/articles/41426496132755>
- **Documented fact.** The ledger entry is checked against the invoice: "Why doesn't
  the Booking Journal's Transaction Value match the Vendor Order Invoice Extended
  Value". <https://support.crunchtime.com/hc/en-us/articles/23723470532115>
- **Not verified.** A spend-threshold approval.

### 9. MarginEdge

- **Documented fact.** "Orders" is one page that holds invoices, credits and
  purchase orders, with four sub-sections: "Place New Order, Invoice Approval,
  Transfers, and Setup".
  <https://help.marginedge.com/hc/en-us/articles/360047926074-Orders-Page-Navigation-Overview>
- **Documented fact.** Ordering starts at the vendor, and the order guide is the
  screen: "Go to **Orders** > **Place New Order** in the navigation bar. Select the
  **Vendor** from the drop down menu."
  <https://help.marginedge.com/hc/en-us/articles/217888378-How-to-Place-an-Order-with-a-Vendor-through-MarginEdge>
- **Documented fact.** The line shows the code, the last price and a price trend:
  "You will see the order guide populate with **Vendor Item** name, the **Product**
  it's associated with, the **Item Code**, your most recent purchase **Price** as
  well as a little visual representation of any recent price fluctuations."
- **Source-backed tradeoff.** The suggested quantity needs a human count, and the
  product says so: "Manually entering an '**On-hand**' count will prompt the
  software to calculate your needed Quantity for you ... _Note this is not
  connected to any potential inventory counts._" A separate article repeats it:
  "On hand amounts are NOT automatically populated from your inventory."
  <https://help.marginedge.com/hc/en-us/articles/360049496713-Setting-Pars-and-On-Hand-Counts-for-Online-Ordering>
- **Documented fact.** The last count is a reference column with a staleness
  warning: "you'll see a yellow warning box to give you a heads up if this date is
  anything beyond 3 days old."
- **Documented fact.** Sending is email, and the limit is stated plainly: "Anyone
  who will accept orders via email can be setup in MarginEdge", and "Currently we
  only support EDI ordering for Profish."
  <https://help.marginedge.com/hc/en-us/articles/5335162355091-Intro-to-Placing-Orders-through-MarginEdge>
- **Documented fact.** The order and the invoice are one loop with an operator
  switch: "You will see the PO now displayed on your Orders screen in 'sent'
  status. _If you want these to be automatically deleted after the invoice arrives,
  please email help@marginedge.com to request this feature be enabled._"
- **Documented fact.** Approval is on the invoice, not the order: the Invoice
  Approval feature lets a user "review and edit invoices before closing them and
  sending them to accounting".
- **Documented fact.** The accounting hand-off is NetSuite, Bill Pay, and a
  Purchasing Export of line items that includes "Count-by Price, Count-by Unit,
  Miscellaneous Charges".
  <https://help.marginedge.com/hc/en-us/articles/1500002499061-How-to-use-the-Purchasing-Export>
- **Not verified.** A partial delivery, a substitution, and an order-level spend
  threshold.

### 10. Restaurant365

- **Documented fact.** The purchase order is a form with a lifecycle, and the
  starter is one step earlier: a Shopping List opens an "Order Suggestion form
  where item quantities can be entered. Completed Order Suggestion forms are then
  broken out into Purchase Orders by Vendor".
  <https://docs.restaurant365.com/docs/purchase-orders-use-shopping-lists>
- **Documented fact.** A template carries the cadence, not only the items: a
  purchase order template holds "vendor, schedule, ordering day, consumption days,
  buffer days".
  <https://docs.restaurant365.com/docs/purchase-orders-create-and-edit-a-purchase-order-template>
- **Documented fact.** Price resolves through a stated priority list: "the each
  amount (cost per unit) on a purchase order is determined from vendor item cost
  sources in priority order: integrated order guide pricing, contract pricing, then
  vendor item price."
  <https://docs.restaurant365.com/docs/purchase-orders-order-guide-sync>
- **Documented fact.** The catalogue updates itself: "Vendor order guide
  integrations update item availability and pricing automatically in R365."
  <https://docs.restaurant365.com/docs/order-guides-vendor-integrations>
- **Documented fact.** Sending has three behaviours, and they are separated in the
  product: submit-and-send by email, "Mark as Submitted" without sending, and EDI
  or API where "Vendors connected via EDI will receive the order directly to their
  system".
  <https://docs.restaurant365.com/docs/purchase-orders-review-and-submit-a-purchase-order>
- **Documented fact.** A spend gate exists at the vendor level, with an override
  permission: "the minimum dollar amount or item quantity must be met in order to
  submit the order ... Only users with the **Override Vendor Order Minimums**
  permission will be able to submit despite not meeting vendor minimums."
- **Documented fact.** The match is automatic and its rules are published: "A
  submitted PO will automap to an AP Invoice when: the PO and AP invoice have the
  **same** vendor; ... the **same** location; the PO total and AP invoice total are
  within a certain % variance, **and** the PO delivery date and invoice date are
  within a certain number of days." Issues appear on the Alerts tab.
  <https://docs.restaurant365.com/docs/ap-invoices-link-purchase-order>
- **Documented fact.** Receiving is a report in its own right: "Receiving by
  Purchased Item", and a discrepancy flag between PO and received quantities.
  <https://docs.restaurant365.com/docs/receiving-by-purchased-item>,
  <https://docs.restaurant365.com/docs/purchase-orders-match-po-to-ap-invoice>
- **Not verified.** A partial delivery and a substitution.

## The route-failure log

| Host                                                           | Route                                                                              | Result                                                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `support.marketman.com`                                        | help centre root                                                                   | No DNS record                                                                                  |
| `help.marketman.com`                                           | help centre root                                                                   | No DNS record                                                                                  |
| `marketman.com/help`                                           | help centre                                                                        | HTTP 404                                                                                       |
| `intercom.help/marketman`                                      | Intercom help centre                                                               | HTTP 404                                                                                       |
| `mealticket.my.site.com`                                       | `/helpcenter`, `/helpcenter/s/search?searchTerm=...`, `/helpcenter/s/article/<id>` | HTTP 200 shell, HTTP 404 or a Salesforce "CSS Error"; the article body needs a browser session |
| `help.wisk.ai`                                                 | `/api/v2/help_center/articles/search.json`                                         | HTTP 404 - Intercom, not Zendesk                                                               |
| `help.wisk.ai`                                                 | `/api/search?q=order`                                                              | HTTP 404                                                                                       |
| `support.craftable.com`                                        | help centre root                                                                   | No DNS record                                                                                  |
| `help.craftable.com`                                           | help centre root                                                                   | HTTP 404                                                                                       |
| `support.toasttab.com`                                         | `/api/v2/help_center/articles/search.json`                                         | HTTP 404 - not a Zendesk host                                                                  |
| `support.toasttab.com`                                         | `/api/search`, `/api/v1/search`                                                    | HTTP 404                                                                                       |
| `support.toasttab.com`                                         | `/sitemap.xml`, xtraCHEF filter                                                    | HTTP 200, 778 URLs, no xtraCHEF article                                                        |
| `support.toasttab.com`                                         | `/en/search?q=xtraCHEF purchase order`, rendered 9 s                               | HTTP 200, and the article links were not in the DOM                                            |
| `pos.toasttab.com`                                             | `/products/xtrachef` over `curl`                                                   | HTTP 403, "Just a moment"                                                                      |
| `help.xtrachef.com`, `support.xtrachef.com`                    | help centre root                                                                   | No DNS record                                                                                  |
| `help.marginedge.com`                                          | `/api/v2/help_center/articles/<id>.json`                                           | HTTP 301 then a Cloudflare challenge                                                           |
| `help.marginedge.com`                                          | `/hc/en-us` over `curl`                                                            | HTTP 403, "Just a moment"                                                                      |
| `support.kitchencut.com`                                       | `/api/v2/help_center/...`, `/support/home`, `/support/tickets/new`                 | HTTP 404 - not Zendesk                                                                         |
| `docs.supy.io`, `support.supy.io`                              | help centre root                                                                   | No DNS record                                                                                  |
| `docs.restaurant365.com`                                       | `/sitemap.xml`                                                                     | HTTP 404; `/llms.txt` answers and is better                                                    |
| G2, Capterra, Trustpilot, GetApp, Software Advice, TrustRadius | product review pages                                                               | HTTP 403 from this workstation                                                                 |

## Headline findings for the Umi decision

1. **Every product in this lane that has an order gives the operator a list, not a
   blank form.** The list is a per-supplier order guide or catalogue. Umi has no
   per-supplier ordering list; `merchant.supplier` holds 102 rows in the rehearsal
   database and no screen shows one.
2. **The suggested quantity is table stakes, and two products subtract what is
   already on order** (WISK, Crunchtime). Par minus stock is the floor; par minus
   stock minus on-order is the expectation.
3. **The order and the invoice are separate objects, and the receipt sits between
   them.** Craftable states the three-way match; Supy and Restaurant365 implement
   it; KitchenCut and WISK generate the invoice from the receipt. Umi today has
   `purchase_order`, `purchase_order_receipt` and a supplier-invoice path that
   cannot commit without an order
   ([2026-09-18-purchase-orders-gap.md](../../2026-09-18-purchase-orders-gap.md)).
   The models agree with the market; the missing piece is the screen.
4. **Approval splits two ways, and the split is a real choice.** WISK, Apicbase and
   KitchenCut publish no spend gate. Supy, Craftable, Restaurant365 and MarketMan
   do, and they gate differently: Supy holds the order and emails an approver;
   Restaurant365 blocks submission on a vendor minimum; Craftable enforces limits
   by location, department and amount. Umi's own RBAC already has the vocabulary
   for this, and no product in this lane puts the approval inside the POS.
5. **The phone is for the receipt, not the order.** Apicbase, MarketMan, WISK,
   Crunchtime and MarginEdge put ordering on the web and the delivery check on the
   phone. No product in this lane puts purchase-order authoring in the till.
6. **A supplier code is the join key everywhere.** KitchenCut warns that a changed
   supplier code creates a duplicate product. Supy lists the supplier item code as
   a core column. Umi's `supplier` and inventory item records need that key before
   the ordering screen is useful.

## What changed since the prior pass

Read with the pass in
[2026-09-17-inventory-kitchen-systems-deep-dive.md](../../2026-09-17-inventory-kitchen-systems-deep-dive.md)
and [2026-09-18-purchase-orders-gap.md](../../2026-09-18-purchase-orders-gap.md).

Unchanged: the repository finding that the procurement API is complete and
unreachable; the SoftRestaurant min/max result; and the Lightspeed purchase-order
list with its status chips.

Changed by this pass:

- The specialist lane now has a per-product answer for the order object, the
  suggested quantity, the send channel and the match, with URLs.
- **New: the send channel is email for almost everyone.** MarginEdge states the
  limit, Apicbase and KitchenCut build the email into the screen, and Crunchtime
  adds FTP. EDI exists, and it is a per-vendor exception rather than the rule.
- **New: the suggested quantity has a third term.** WISK subtracts pending
  purchase orders, and Crunchtime lists "On Vendor Order" as a formula input.
- **New: two lanes of the market exist.** Craftable sells spend control; WISK,
  Apicbase and MarginEdge sell stock replenishment. Umi's gap file names this as
  the open decision and this pass gives the tradeoff a name.

## Open questions this lane could not settle

1. The xtraCHEF purchase-order screen. Every route from this workstation is in the
   log. A signed-in Toast tenant or a support session is the only remaining route.
2. A substitution step in the receipt. Only Apicbase gives substitution a recorded
   state ("Wrongly delivered"), and it is a remark, not a swap of the ordered item.
3. A price-change **alert**, as opposed to a price-change view. MarginEdge draws
   the fluctuation and no vendor in this lane names an alert. KitchenCut prevents
   the duplicate product instead, through the supplier code.
