# 05 - Standards and practice: the rules a purchase order must obey

- Date: 2026-09-18
- Lane: 5 of 5. Owns the **standards** and the **practitioner writing**.
- Question: what behaviour does a purchase order have to have, and what breaks in
  practice?
- This lane does not answer "what does vendor X ship". Lane 2 and lane 3 own that.

## Label key

- **Documented fact** - the source says it, with the URL.
- **Source-backed tradeoff** - a source gives the reason for a choice, and the
  choice has a cost.
- **Inference** - this lane draws the conclusion. The source does not say it.
- **UNVERIFIED** - not read, or read incompletely.

All pages were read on 2026-09-18. All pages came from the live web unless the
log says the Wayback Machine served them.

---

## Part A - the standards

### A1. The three-way match: order, goods receipt, supplier invoice

**Documented fact.** Microsoft, "Accounts payable invoice matching overview"
(Microsoft Learn, read 2026-09-18,
https://learn.microsoft.com/en-us/dynamics365/finance/accounts-payable/accounts-payable-invoice-matching):

> "Accounts payable invoice matching is the process of matching vendor invoice,
> purchase order, and product receipt information."

> "Three-way matching - Match the price information on the invoice to the price
> information on the purchase order. Also match the quantity information on the
> invoice to the quantity information on the product receipts that are selected
> for the invoice."

**Documented fact.** Odoo 17.0, "Bill control policies" (read 2026-09-18,
https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/purchase/manage_deals/control_bills.html):

> "The 3-way matching feature ensures vendor bills are only paid once some (or
> all) of the products included in the PO have been received."

> "The 3-way matching feature only works with the Bill Control policy set to
> Received quantities."

**Documented fact.** Gruvero, "What Is GRNI (Goods Received Not Invoiced)?"
(22 August 2026, read 2026-09-18,
https://www.gruvero.com/blog/goods-received-not-invoiced-grni):

> "That separation is also the foundation of three-way matching, where the
> purchase order, goods receipt and supplier invoice are compared before an
> invoice exception is approved."

**Documented fact.** Supy, "2-Way vs 3-Way Invoice Matching: What Restaurants
Need to Know" (read 2026-09-18,
https://supy.io/blog/2-way-vs-3-way-invoice-matching-what-restaurants-need-to-know):

> "The main documents are purchase orders, receiving reports, and invoices."

**Inference.** The market treats three documents as the standard set. The
purchase order alone is not the control. The goods receipt is the evidence that
makes the match real. A screen that lets an operator commit an invoice without a
receipt is not a three-way match. It is a two-way match with a gap.

### A2. Segregation of duties over purchasing

**Documented fact.** US GAO, _Standards for Internal Control in the Federal
Government_, GAO-14-704G (September 2014; read 2026-09-18 from the Wayback
Machine capture of 2021-03-24,
https://www.gao.gov/assets/gao-14-704g.pdf):

> "10.13 Segregation of duties helps prevent fraud, waste, and abuse in the
> internal control system. Management considers the need to separate control
> activities related to authority, custody, and accounting of operations to
> achieve adequate segregation of duties."

The glossary of the same document defines the term:

> "Segregation of duties - The separation of the authority, custody, and
> accounting of an operation (paragraph 10.13)"

The control-activity description of the same document names the four duties:

> "This includes separating the responsibilities for authorizing transactions,
> processing and recording them, reviewing the transactions, and handling any
> related assets so that no one individual controls all key aspects of a
> transaction or event."

**Documented fact.** The framework gives the small-team escape hatch. Paragraph
10.14 says:

> "If segregation of duties is not practical within an operational process
> because of limited personnel or other factors, management designs alternative
> control activities to address the risk of fraud, waste, or abuse in the
> operational process."

**Documented fact.** Accounting Scholar, "Functions in the Purchasing Process and
how to Segregate Purchasing Duties" (read 2026-09-18,
https://www.accountingscholar.com/purchasing-process-functions.html). This source
maps the rule onto purchasing. It names the functions as requisition, purchasing,
receiving, invoice processing, disbursement, and general ledger. It states the
rule as:

> "Segregation - need to separate custody of assets, authorization and
> recordkeeping of assets (C.A.R. principle)"

The same source gives the pairings:

> "i) Purchasing function should be segregated from requisition and receiving
> functions"

> "iv) AP function should be segregated from the GL function"

**Inference for Umi.** `merchant.manage` is one permission. It gives one person
the whole purchasing chain. Umi's own gap file already records this: every
procurement route is gated on `merchant.manage`
(`docs/research/2026-09-18-purchase-orders-gap.md`). The standard asks for at
least two roles: the person who creates and sends the order, and the person who
receives and pays. Paragraph 10.14 gives the one-person shop a path. Umi must
still design it on purpose. A one-person shop can receive against its own order.
Umi should show the conflict, and it should record it.

### A3. Approval thresholds and price-variance tolerance

**Documented fact.** Accounting Scholar (read 2026-09-18, URL above):

> "Each company should have a policy, which requires different levels of
> authorization for different dollar values of purchases (higher dollar purchases
> should require higher level of approval)."

**Documented fact.** The University of Texas at El Paso, _Purchasing and General
Services Operating Procedures Manual_ (PDF, July 2020, read 2026-09-18,
https://www.utep.edu/purchasing-and-general-services/pgs-departments/purchasing/purchasing-manual_2020-07.pdf).
The manual publishes a real threshold ladder:

> "Certain purchases with a cost of more than $1,000,000 require approval of the
> Board of Regents."

> "Contracts of $100,000 or Less: Delegation of authority to execute and deliver
> contracts of any kind or nature, but not including contract for consulting
> services, of $100,000 or less."

**Documented fact.** Microsoft gives the price-variance rule for the invoice
(read 2026-09-18, URL above):

> "If a matching discrepancy exceeds the tolerance percentage or amount, match
> variance icons are displayed on the Vendor invoice page and on the Invoice
> history and matching details page."

> "Your legal entity policy allows a 5 percent net unit price tolerance for this
> category of item. A price of 1.05 would be acceptable, but 1.10 is not."

**Documented fact.** Odoo gives the softer variant (read 2026-09-18, URL above).
A draft bill can be edited. When the operator edits it, Odoo sets the control
field to `Exception`:

> "This means that Odoo notices the discrepancy, but does not block the changes
> or display an error message, since there might be a valid reason for making
> changes to the draft bill."

**Source-backed tradeoff.** Two designs exist. Microsoft blocks the line above
tolerance. Odoo marks the bill `Exception` and lets the operator continue. The
block prevents payment for an unagreed price. The block also stops a real
delivery when the supplier raised the price and the operator agreed by phone.
Odoo's design accepts that risk, and it keeps the operator unblocked. **Inference
for Umi:** mark the variance, keep the operator unblocked, and put the variance
and the reason on the record. This matches Odoo, and it matches the Umi rule that
the operator keeps agency.

### A4. Inventory valuation and the receipt: why stock moves on the RECEIPT

**Documented fact.** IFRS Foundation, "IAS 2 Inventories" (read 2026-09-18,
https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/):

> "Inventories are measured at the lower of cost and net realisable value."

> "The cost of inventories includes all costs of purchase, costs of conversion
> (direct labour and production overhead) and other costs incurred in bringing
> the inventories to their present location and condition."

**Documented fact.** Microsoft states the receipt as the valuation event (read
2026-09-18, URL above):

> "The vendor ships 1,000 batteries, and you enter a product receipt for 1,000
> batteries at a price of 1.00 each. The inventory cost for the batteries is
> updated with this price."

**Documented fact.** Odoo states the same event from the bill side (read
2026-09-18, URL above):

> "Received quantities: a bill is created only after part of the total order has
> been received. The products and quantities received are used to generate a
> draft bill."

**Documented fact.** Gruvero gives the accounting entry and the reason (read
2026-09-18, URL above):

> "The goods receipt debits inventory and credits a GRNI clearing account, so
> both the received value and the obligation for it are recorded before the
> supplier invoice exists."

The same source labels the event:

> "Created by the receipt - not by the PO"

**Documented fact.** Procurement Tactics, "Goods Received Not Invoiced (GRNI)"
(read 2026-09-18, https://procurementtactics.com/goods-received-not-invoiced/):

> "Goods Received Not Invoiced (GRNI) means that goods have been received, but
> the supplier invoice has not yet been issued or recorded. The company has the
> goods and a real obligation, which is temporarily recorded on a GRNI account."

**Inference for Umi.** The order is a promise. The receipt is the event that
creates stock and a liability. A purchase-order screen must show the two as
different states. A `sent` order holds no stock. Only a receipt holds stock. The
Umi schema already carries this: `merchant.purchase_order_receipt` and
`merchant.purchase_order_receipt_line` sit beside the order tables
(`docs/research/2026-09-18-purchase-orders-gap.md`).

### A5. Mexico: the CFDI 4.0 invoice, and the payment complement

**Documented fact.** SAT, _Anexo 20 - Guía de llenado de los comprobantes
fiscales digitales por Internet_ (read 2026-09-18,
http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Anexo_20_Guia_de_llenado_CFDI.pdf).
The version field is fixed:

> `Version` - "Debe tener el valor “4.0”."

The same guide makes the receiver data mandatory. `RegimenFiscalReceptor` and
`DomicilioFiscalReceptor` are required fields on the receiver node. The guide
states:

> "Se debe registrar el código postal del domicilio fiscal del receptor del
> comprobante."

> "UsoCFDI ... La clave que solicite el receptor (física o moral) se registre en
> este campo, debe corresponder con los valores indicados en el catálogo
> c_UsoCFDI y el valor registrado en el campo RegimenFiscalReceptor, debe
> corresponder a un valor de la columna Régimen Fiscal Receptor de dicho
> catálogo."

**Documented fact.** SAT, _Guía de llenado del comprobante al que se le incorpore
el complemento para recepción de pagos_ (read 2026-09-18,
http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Guia_llenado_pagos.pdf).
The obligation starts when the payment is deferred or split:

> "Cuando se emita un comprobante fiscal en el que la contraprestación se pague
> en parcialidades, o de forma diferida se deberá incorporar el “Complemento
> para recepción de Pagos”"

The guide sets the deadline:

> "El CFDI con “Complemento para recepción de pagos”, también denominado “Recibo
> Electrónico de Pago”, deberá emitirse a más tardar al quinto día natural del
> mes inmediato siguiente al que corresponda el o los pagos recibidos."

The guide names the penalty, from the CFF:

> "...podría incurrir en la infracción contenida en el artículo 83, fracción VII
> y generar una multa en terminos del artículo 84, fracción IV del Código Fiscal
> de la Federación."

The guide states the version rule:

> "El “Complemento para recepción de pagos”, también denominado “Recibo
> Electrónico de Pago” solo puede ser incorporado en un CFDI emitido usando la
> versión 4.0 del Anexo 20."

**Documented fact.** SAT, _Estándar del Complemento para recepción de Pagos_
(read 2026-09-18,
http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Pagos20.pdf).
This is the document known as **Pagos 2.0**. The version attribute is fixed:

> "Valor Prefijado 2.0"

The same standard defines the payment-to-invoice link. The node
`DoctoRelacionado` carries `IdDocumento`, and the standard says:

> "IdDocumento ... Este dato puede ser un Folio Fiscal de la Factura Electrónica
> o bien el número de operación de un documento digital."

The same standard defines `NumParcialidad`, `ImpSaldoAnt`, `ImpPagado`, and
`ImpSaldoInsoluto`, and it defines `NumOperacion` as:

> "el número de cheque, número de autorización, número de referencia, clave de
> rastreo en caso de ser SPEI, línea de captura o algún número de referencia
> análogo que identifique la operación que ampara el pago efectuado."

**Documented fact (absence).** The phrase "orden de compra" does not occur in
either SAT document. A direct text search of the two PDFs returned no match. The
SAT standards define the invoice (`CFDI`) and the payment receipt (`REP`, Pagos
2.0). They do not define a purchase order.

**Inference.** The `orden de compra` is a commercial control. It has no fiscal
effect. The SAT does not ask for it. The supplier's CFDI is the fiscal document.
The Pagos 2.0 complement is the fiscal proof of payment. The purchase order is
the Umi-side control that makes the match possible. Umi should keep the PO, and
it should not present the PO as a fiscal document.

**Inference for Umi's fiscal profile.** A CFDI 4.0 needs the receiver's RFC,
legal name, tax regime, and postal code. The supplier fills those fields. So Umi
must hold the shop's fiscal profile in one place, and the supplier must be able
to read it. A missing `RegimenFiscalReceptor` stops the supplier's own invoice.

### A6. ISO 9001 clause 8.4, control of externally provided processes, products and services

**Documented fact.** ISO Online Browsing Platform, entry for ISO 9001:2015
(read 2026-09-18, https://www.iso.org/obp/ui/en/#iso:std:iso:9001:ed-5:v1:en).
The entry carries this banner:

> "This standard has been withdrawn"

**Documented fact.** ISO, "ISO 9001:2026: What businesses need to know" (read
2026-09-18, https://www.iso.org/quality-management/iso-9001-2026):

> "ISO 9001:2026, which now replaces ISO 9001:2015, marks the next step in that
> evolution."

**Documented fact.** The ISO Online Browsing Platform does not show the clause
body in the free preview. This lane read the clause from a training deck that
reproduces it: _ISO 9001:2015 Transition, Lecture 060 Clause 8_ (PDF, read
2026-09-18,
https://archive.org/download/iso-9001-2015-transition/Lecture%20060%20Clause%208.pdf).
The deck reproduces the clause under three headings. Clause 8.4.1 General:

> "The organization shall ensure that externally provided processes, products
> and services conform to requirements."

> "The organization shall determine and apply criteria for the evaluation,
> selection, monitoring of performance, and re-evaluation of external providers,
> based on their ability to provide processes or products and services in
> accordance with requirements."

Clause 8.4.2 Type and extent of control:

> "The organization shall ensure that externally provided processes, products
> and services do not adversely affect the organization's ability to consistently
> deliver conforming products and services to its customers."

> "determine the verification, or other activities, necessary to ensure that the
> externally provided processes, products and services meet requirements."

Clause 8.4.3 Information for external providers:

> "The organization shall ensure the adequacy of requirements prior to their
> communication to the external provider."

> "Communicate requirements for: a) products/services to be provided; ..."

**Source-backed tradeoff.** A restaurant is not obliged to certify to ISO 9001.
The clause is still useful. It gives a supplier-control rule that a food business
already follows. The rule asks for supplier evaluation, for a defined control
level, and for verified requirements. **Inference for Umi:** the supplier record
is the place for that. The supplier record should hold the criteria, the
verification, and the agreed requirements. The purchase order is where the
requirements travel to the supplier.

**Caution.** The quoted clause is the 2015 text, from a training reproduction.
ISO 9001:2026 replaced it. This lane did not read the 2026 clause text.
**UNVERIFIED** - the 2026 clause number for supplier control.

---

## Part B - practitioner writing: what breaks in a real kitchen

### B1. The receiving step is the weak point, and the invoice is the wrong sheet

**Documented fact.** Restaurant365, "Restaurant Food: Purchasing, Receiving and
Storing Tips" (read 2026-09-18,
https://www.restaurant365.com/blog/restaurant-food-purchasing-purchasing-receiving-and-storing-food/):

> "Print the order. The person receiving the order should have a printed copy of
> the order with them when checking it in. Going off the invoice reflects what
> the order contains, not necessarily what you ordered. If your order is shorted,
> you will want to know immediately so that you can contact a backup vendor."

The same source gives the correction path:

> "Return unacceptable items. It's ok to send poor quality items back with the
> driver. ... Be sure to mark these changes on the invoice, and have the driver
> initial it to head off any possible discrepancies."

**The trap.** The receiver checks against the invoice, not against the order. The
invoice shows what the supplier says it delivered. A short delivery passes
unseen. The printed order is the countermeasure.

### B2. Price creep and the unaudited delivery

**Documented fact.** Genius Food Purchasing, "7 Restaurant Procurement Mistakes
Killing Your Profit (2026)" (16 September 2026, read 2026-09-18,
https://geniusfoodpurchasing.com/restaurant-procurement-mistakes/):

> "Invoice creep is sneaky. A case of chicken thighs goes up 2%. Then 3% the next
> month. Nobody notices because nobody's comparing this month's invoice against
> last month's, line by line."

> "Here's an uncomfortable question: does anyone actually check deliveries
> against the invoice before signing off? In a lot of restaurants, the honest
> answer is 'not really.'"

The same source names the lost money:

> "Credits and adjustments that never get requested, let alone collected."

**The trap.** A price rise of 2% per month is invisible on one invoice. A credit
for a short or spoiled case is never claimed. The order-to-invoice price delta is
the control that catches both. Umi holds the ordered price on the line. The
receipt holds the received quantity. The delta is computable.

### B3. The Mexican distributor portal: no goods entry, no invoice

**Documented fact.** La Costeña, _Manual de Usuario Portal de Proveedores VIM_
(PDF, read 2026-09-18,
https://www.lacostena.com.mx/media/uploads/PDFFiles/manual-de-usuario-_portal-de-proveedores.pdf).
The supplier portal menu is grouped as:

> "Orden de compra ... Planes de entrega ... Cuentas por pagar ... Recepción de
> factura ... Recepción de complemento de pago."

The portal states the precondition for an invoice:

> "...es necesario que cuentes con tu orden de compra y el ingreso de las
> mercancías o la aceptación de servicios."

The portal states the match rule, and it blocks:

> "NOTA. Los montos de las Entradas de Mercancía contra la factura deben
> coincidir, si no es así no se permitirá enviar la factura."

**Documented fact.** The same manual lists a bypass path. It has a menu item
"Recepción de factura sin orden de compra", and a section "10.1 Nota de crédito
financiera (sin orden de compra)".

**The trap.** Two traps. First, a delivered item without a goods entry blocks the
invoice. Second, the portal itself admits invoices without a purchase order. So
the order is the exception path, not the rule, for part of the supply base.

### B4. Hospitality back-office writing: the delivery-to-invoice gap

**Documented fact.** The Access Group, "Restaurant Invoice Management"
hospitality purchase-to-pay page (read 2026-09-18,
https://www.theaccessgroup.com/en-gb/hospitality/software/purchase-to-pay/restaurant-invoice-management/):

> "...making sure deliveries align with invoices is a time-consuming process
> that leaves plenty of room for error. Any slip-up can throw off your whole
> inventory and going back and forth with suppliers to resolve discrepancies
> adds to the admin pile and strains relationships."

The same page advises regular checks:

> "Make it a habit to carry out regular audits of your inventory and invoices.
> Checking in regularly lets you catch discrepancies before they become bigger
> problems..."

**The trap.** The mismatch cost is not only money. It is the supplier argument,
and the inventory count that is now wrong.

### B5. The supplier-side order guide, and the "apply date"

**Documented fact.** US Foods, "US Foods Electronic Ordering" (PDF, distributed
by a restaurant accounting training site, read 2026-09-18,
http://restaurant365training.com/wp-content/uploads/2026/06/US-Foods-Electronic-Ordering.pdf):

> "You will need to have your vendor verify that the items on your electronic
> order guide are setup accurately and represent the products you receive."

The document then converts the order to an invoice:

> "Select the 'convert order' option and select the PO that you created the
> previous day"

> "Fill in the apply date (date the products arrived), invoice number, invoice
> date (printed on the invoice)"

**The trap.** The supplier's item codes decide whether the order is correct. The
supplier owns that data, and it changes. The "apply date" is the arrival date.
The receipt date is the valuation date, per A4.

### B6. The operator's own words

**Documented fact.** Hacker News, comment 32837487 by `aqme28`, on the story
"It's been a little over 3 weeks since Google randomly sent me $249,999" (read
2026-09-18, https://news.ycombinator.com/item?id=32837487):

> "Ah yes, the 'three-way match' problem. You have purchase orders going out,
> invoices coming in, and products coming in. It's not always easy to associate
> all three with eachother in the real world."

**Documented fact.** Hacker News, "Ask HN: How do you handle invoices and
purchase orders?" (story 19591327, read 2026-09-18 via the Algolia API,
https://hn.algolia.com/api/v1/items/19591327). The top answer sends the asker to
an ERP:

> "Well I guess they are sending you purchase orders and requesting invoices
> because they cannot use credit card because of corporate rules(accounting,
> policies etc). Its possible to automate this. You should use some ERP system
> or even accounting system."

**The trap.** The association of the three documents is the hard part, in the
words of the operators themselves. The order, the receipt, and the invoice
arrive at different times, in different systems, with different identifiers.

**Documented fact.** Supy's operator FAQ names the failure in money terms (read
2026-09-18, URL above):

> "If invoices aren't matched, restaurants might pay for things they never got,
> pay the wrong price, or even pay the same invoice twice."

---

## Route-failure log

| Host                                                                                                        | Route                                                        | Result                                                                                   |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `gao.gov`                                                                                                   | `curl` the GAO-14-704G PDF                                   | HTTP 403, "Access Denied" (Akamai)                                                       |
| `gao.gov`                                                                                                   | Wayback CDX index, then `web.archive.org/.../id_/` replay    | HTTP 200, 2.4 MB PDF. **Used**                                                           |
| `www.sat.gob.mx`                                                                                            | `curl` the CFDI 4.0 requirements page                        | HTTP 403, "Access Gateway"                                                               |
| `www.sat.gob.mx`                                                                                            | `r.jina.ai`                                                  | HTTP 403, Cloudflare "Just a moment..."                                                  |
| `www.sat.gob.mx`                                                                                            | headless Chromium, `www.sat.gob.mx/consultas/23197/...`      | HTTP 200, page reads "Acceso prohibido!"                                                 |
| `omawww.sat.gob.mx`                                                                                         | `curl` the Anexo 20 guide PDF and the Pagos PDFs             | HTTP 200. **Used**                                                                       |
| `iso.org`                                                                                                   | `curl` `/obp/ui/...` and `/standard/62085.html`              | HTTP 403, Cloudflare                                                                     |
| `iso.org`                                                                                                   | headless Chromium, `/obp/ui/en/#iso:std:iso:9001:ed-5:v1:en` | HTTP 200, but the free preview shows only the table of contents. Clause body not present |
| `iso.org`                                                                                                   | `curl` `/quality-management/iso-9001-2026`                   | HTTP 403                                                                                 |
| `iso.org`                                                                                                   | headless Chromium, `/quality-management/iso-9001-2026`       | HTTP 200. **Used**                                                                       |
| `www.nerldc.in`                                                                                             | `curl` the ISO 9001:2015 PDF                                 | connection failed, code 000                                                              |
| `www.nerldc.in`                                                                                             | `r.jina.ai`                                                  | HTTP 403                                                                                 |
| `www.nerldc.in`                                                                                             | Wayback CDX index                                            | Internet Archive answered "Temporarily Offline" (503)                                    |
| `archive.org`                                                                                               | `curl` "Lecture 060 Clause 8" PDF                            | HTTP 200. **Used**                                                                       |
| `preteshbiswas.com`                                                                                         | `curl` the clause 8.4 page                                   | HTTP 429, rate-limited                                                                   |
| `asq.org`                                                                                                   | `curl` the ISO 9001 resource page                            | HTTP 403                                                                                 |
| `www.netsuite.com`                                                                                          | `curl` the three-way matching article                        | HTTP 403                                                                                 |
| `www.accountingtools.com`                                                                                   | `curl` the GRNI and three-way articles                       | HTTP 404, slugs retired                                                                  |
| `www.double-entry-bookkeeping.com`                                                                          | `curl` the GRNI article                                      | HTTP 403                                                                                 |
| `pos.toasttab.com`                                                                                          | `curl` the inventory article                                 | HTTP 403 (needs real Chromium; not retried)                                              |
| `www.theopenpantry.com`                                                                                     | `curl` the purchase-order mistakes article                   | HTTP 500                                                                                 |
| `universitypolicies.columbia.edu`                                                                           | `curl` the purchase-order policy                             | HTTP 403                                                                                 |
| `www.facturama.mx`, `www.sw.com.mx`, `solucionfactible.com`                                                 | `curl` guessed guide URLs                                    | HTTP 404, guesses were wrong                                                             |
| `ramp.com`, `highradius.com`, `stampli.com`, `accountingscholar.com`                                        | `curl`                                                       | HTTP 200. **Used**                                                                       |
| `www.gruvero.com`, `procurementtactics.com`, `supy.io`, `geniusfoodpurchasing.com`, `www.restaurant365.com` | `curl`                                                       | HTTP 200. **Used**                                                                       |
| `www.lacostena.com.mx`                                                                                      | `curl` the supplier-portal PDF                               | HTTP 200. **Used**                                                                       |
| `html.duckduckgo.com`                                                                                       | headless Chromium                                            | HTTP 200. Discovery route. **Used**                                                      |
| Hacker News Algolia API                                                                                     | `curl`                                                       | HTTP 200. **Used**                                                                       |

## Part C - the standards, translated into one rule each

| Source                                                     | The rule                                                                                  | What it means for Umi                                                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Microsoft D365, invoice matching (read 2026-09-18)         | Match the invoice to the order **and** to the receipt                                     | The commit action needs a receipt. A `no_order` state is not enough. The screen also needs a `no_receipt` state    |
| Odoo 17.0, bill control policies (read 2026-09-18)         | Bill on received quantities. Mark an edited bill `Exception`                              | Compute the bill from the receipt. Show the variance. Do not block the operator                                    |
| GAO-14-704G, para 10.13-10.14 (2014)                       | Separate authority, custody, and accounting. If the team is small, design another control | Split `merchant.manage` into create/send and receive/pay. For a one-person shop, show and record the self-approval |
| Accounting Scholar, purchasing functions (read 2026-09-18) | Higher-value purchases need higher approval                                               | The order needs an approval step and a threshold                                                                   |
| UTEP purchasing manual (2020)                              | Publish the threshold ladder                                                              | Keep the threshold in config, and show who must approve on the order                                               |
| Microsoft D365, tolerances (read 2026-09-18)               | Compare the variance to a percentage or an amount tolerance                               | Store a tolerance per item or per supplier. Show the variance against it                                           |
| IAS 2 Inventories (read 2026-09-18)                        | Inventory is the cost of purchase, at lower of cost and net realisable value              | The received price sets the item cost. The order price does not                                                    |
| Gruvero GRNI (2026-08-22)                                  | The receipt creates the inventory and the liability. The invoice clears it                | Post stock on the receipt. Show "received, not invoiced" as a real state                                           |
| SAT Anexo 20 CFDI 4.0 (read 2026-09-18)                    | The receiver supplies RFC, legal name, tax regime, and postal code                        | Hold the shop fiscal profile in one place. Expose it to the supplier                                               |
| SAT Pagos 2.0 (read 2026-09-18)                            | A deferred or split payment needs a REP, by the 5th natural day of the next month         | Hold the supplier CFDI and the REP. Link the REP to the invoice UUID. Flag a missing REP                           |
| La Costeña supplier portal (read 2026-09-18)               | No goods entry, no invoice. Amounts must match                                            | The received quantity is the gate. A credit note is a first-class document                                         |
| ISO 9001:2015 clause 8.4 (read 2026-09-18)                 | Evaluate suppliers. Define the control. Verify the requirements                           | The supplier record holds the criteria and the verification                                                        |

## What this lane does not own

- The vendor screens. Lane 2 and lane 3 own them.
- The Umi repository audit. Lane 6 and the gap file own it.
- The 2026 text of ISO 9001. This lane read the withdrawn 2015 text only.
- The review sites. G2, Capterra, Trustpilot, GetApp, and Software Advice answer
  403 from this workstation. The channel playbook records them as blocked.
