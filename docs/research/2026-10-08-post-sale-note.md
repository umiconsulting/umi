# A note on a completed sale: is it justified?

Date: 2026-10-08. Scope: the request to stop renaming a sale, to show every sale as
"Venta" with a timestamp, and to replace the rename control with a note on a sale that is
already complete. The note must be visible to an admin in the dashboard.

Labels: **documented fact**, **source-backed tradeoff**, **inference**, **UNVERIFIED**.

## Method

Step 0 answers:

| Question                              | Answer                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Does a proven tool do this?           | Vendor help centres and public API references answer the product question. The repository answers the Umi question. No new tool is necessary. |
| Is it installed here?                 | `ripgrep` 15.2.0, `sqlite3` 3.53.4, `psql` 18.6, `python3` 3.14.7, `curl` 8.22.0. All installed.                                              |
| Can an agent drive it with no prompt? | Yes. Every read is a `curl` or a `SELECT`.                                                                                                    |
| What does adoption cost?              | One research document. No schema change in this task.                                                                                         |
| What is the fallback?                 | The Zendesk Help Center JSON API and the Jina reader proxy.                                                                                   |

Ladder rungs used: **rung 1** (vendor documentation), **rung 3** (this repository and the
recovered database of the site's previous till), **rung 5** (community pages, for the
search only).

Channels that failed, in order:

| Channel                                      | Result                                                         |
| -------------------------------------------- | -------------------------------------------------------------- |
| `bing.com/search?format=rss`                 | 200, ten items, navigational only. The feed ignored the query. |
| `mojeek.com/search`                          | 200, no results for the query.                                 |
| `duckduckgo.com/html` direct from `curl`     | 200, anomaly page, no results.                                 |
| `help.shopify.com` direct from `curl`        | 200 once, then 403.                                            |
| `web.archive.org`                            | 429 on every call.                                             |
| `doc.toasttab.com` reopen-closed-checks page | 403 from the reader.                                           |

Channels that worked:

| Channel                                                                             | Use                                                                                                                   |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `https://r.jina.ai/<url>`                                                           | Text extraction for a vendor page and for a DuckDuckGo result page. This is the search route of record for this task. |
| `https://k-series-support.lightspeedhq.com/api/v2/help_center/articles/search.json` | Zendesk Help Center search and full article bodies.                                                                   |
| `sqlite3` on the recovered ONCA database                                            | The site's own previous till.                                                                                         |
| `psql` and `rg` in this repository                                                  | The Umi facts.                                                                                                        |

## 1. The two questions

**inference** The request contains two different changes. One is a label change. The other
is a new kind of record. Each needs its own answer.

1. Does a completed sale carry a name that a person types?
2. Does a note on a completed sale have a use case, and does the industry support it?

## 2. What the repository does today

Five note-like lanes already exist. None of them is a note on a completed POS sale.

| Lane                         | Column and limit                                                                                                       | Written by                         | Reach of the text                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------- |
| Sale display name            | `merchant.pos_cart.display_label`, 120 characters, no `<` or `>` (`docs/migration/build-v3/31_pos_sale.sql:31`)        | The till, for a suspended sale     | The sale list, the search box, and the receipt |
| Customer order note          | `merchant.customer_order.notes` (`docs/migration/build-v3/CONVERSATION_MODEL.md:151`)                                  | The WhatsApp checkout lane         | The frozen iPad KDS ticket                     |
| Item preparation note        | The cart line note, 500 characters (`docs/research/2026-09-06-competitive-scan-and-gap-audit/sources/pos-kds.md:42`)   | The till, during the order         | The kitchen                                    |
| Cancellation reason and note | `cancellationReasonCode` and `cancellationReason`, 160 characters (`packages/contract/src/pos-sale.ts:63`)             | The till, when a sale is cancelled | The sale record                                |
| Sale exception note          | `merchant.pos_sale_exception.note`, 160 characters, no `<` or `>` (`docs/migration/build-v3/34_pos_exception.sql:115`) | The till, on a void or a refund    | See section 3                                  |

**documented fact** The sale exception lane requires money. The table forces
`total_minor_units >= 1` and a reference to a preview row (`docs/migration/build-v3/34_pos_exception.sql:129`).
A note that carries no money cannot use this table.

**documented fact** A completed sale is identified by other means than a typed name. The
sale list shows `sale.label` when it exists, and the fallback is the word "Venta" plus the
first eight characters of the id (`apps/umi-pos/lib/features/sale/sale_surface.dart:418`).
The label lives on the cart, which is the preparation record, not on the committed sale.

**inference** The label is therefore a name for an open ticket. The request to show "Venta"
plus a timestamp on a completed sale follows the existing data model.

**documented fact** The till already states that the order type goes onto the sale note
(`apps/umi-pos/lib/features/catalog/catalog_surface.dart:124`), and the earlier audit found
that this text is display-only (`docs/research/2026-09-06-competitive-scan-and-gap-audit/sources/pos-kds.md:51`).
The product already promises a sale note that it does not keep.

## 3. The gap that the dashboard already has

**documented fact** The till collects a note on a void or a refund
(`apps/umi-pos/lib/features/exception/exception_surface.dart:426`).

**documented fact** The API stores the note, and the dashboard endpoint returns it.
The query selects `x.note` and maps it into the exception object
(`apps/umi-api/src/modules/dashboard-operations/dashboard-operations.repository.ts:320` and `:341`).

**documented fact** The dashboard does not show it. The exception row renders the type, the
operator, the approval mark, the reason code, the timestamp, and the amount
(`apps/umi-dashboard/src/screens/recibos.jsx:366-410`). No field of that row uses `note`.

**inference** The cheapest real improvement is one line in the dashboard. The text exists,
the API sends it, and the admin cannot see it. This is not a new feature. It is a broken
promise.

## 4. The site's previous till

**documented fact** The recovered database of the ONCA system holds the previous till of
this café. File:
`/home/juan/umi-parrot-backup/2026-10-05/app-privada-onca-pos-14/com.bryajam.panpilot.trial6/db/pan-pilot.db`.
The `orders` table has these columns: `id, created, lines, total, status, payment_method,
received, change_due, paid_at, cancelled_at, cancel_reason, drink_note, destination,
pizza_note`.

**inference** The incumbent kept two notes on an order, one per preparation station. It had
a cancellation reason and a reason on every drawer event. It had no free note for the admin
on a sale that was already paid.

## 5. Vendor evidence

| Vendor                    | Capability                                                                                                                                                                                                                                                         | Evidence                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Shopify POS               | **documented fact** A person can add a note to a completed order from the POS Orders screen at a later time. The note shows on the order details screen. The help page names three uses: a refund or cancellation, an exchange, and an extra customer requirement. | `help.shopify.com/en/manual/sell-in-person/shopify-pos/order-management/order-notes` and `.../update-orders` |
| Shopify POS               | **documented fact** A note is "generally for internal use". A merchant can choose to print it on the receipt.                                                                                                                                                      | same page                                                                                                    |
| Square                    | **documented fact** "Descriptions and notes cannot be added to a payment after it's been processed." Notes are item-level and happen during checkout.                                                                                                              | `squareup.com/help/us/en/article/5150-notes-on-payments-and-item-descriptions`                               |
| Lightspeed Restaurant (K) | **documented fact** Notes attach to an order, a course, or a seat during service. All notes print on the KDS and the order dockets. The Back Office pre-creates them.                                                                                              | `k-series-support.lightspeedhq.com/hc/en-us/articles/48669341062043`                                         |
| Odoo Point of Sale        | **documented fact** Customer notes attach to a product from an open session. The cash count window keeps money details in a "Notes" field.                                                                                                                         | `odoo.com/documentation/18.0/applications/sales/point_of_sale.html`                                          |
| Toast                     | **documented fact** Orders Hub lists orders by order number, guest name, tab name, and dining option. It does not document a name that an operator types onto a closed check.                                                                                      | `doc.toasttab.com/doc/platformguide/platformUsingOrdersHub.html`                                             |
| Clover                    | **UNVERIFIED** No vendor page for a post-sale note was reachable. The search returned third-party videos only.                                                                                                                                                     | n/a                                                                                                          |

**source-backed tradeoff** Two vendors disagree on the same question. Shopify lets a person
note a completed sale, and gives the reasons. Square forbids it, and keeps the payment
record closed. Both are deliberate.

## 6. Options

| Option                                          | Work                                                                                         | Cost and risk                                                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| A. Show the note that the till already collects | One render in the dashboard                                                                  | None. The data already travels.                                                                                      |
| B. Add a note to any committed sale             | A column, a migration, a contract field, an API write, a till dialog, and a dashboard render | The sale record is an audit fact. A note is metadata. The write needs its own permission and its own operator trail. |
| C. Put the note in the exception lane           | No new table                                                                                 | The table forces a money amount. A note-only row would lie about money. Rejected.                                    |
| D. Do nothing beyond the label change           | One render                                                                                   | The admin still cannot read the text the till already collects.                                                      |

**inference** Option A is correct at once, and it is cheap. It closes the gap between the
till and the dashboard for the two cases that already exist.

**inference** Option B has a real precedent (Shopify POS) and a real counter-example
(Square). The decision belongs to the owner of the product, not to this document. If the
answer is yes, the note needs a reason code and an operator on the record, in the same way
that a void needs both.

## 7. Recommendation

1. **documented fact** Change the sale list to show "Venta" and a timestamp. This follows
   the existing schema, where the typed name belongs to the open cart.
2. **source-backed tradeoff** Ship option A in the same change. The note reaches the
   dashboard today, and the admin cannot see it.
3. **inference** Decide option B after the owner reads section 5. The need is real for a
   café that takes cash, because a completed sale can need an explanation that no void
   covers. The cost is a new column and a new write path on an audit record.

## 8. Why Square forbids the note

Square answers this question in three layers. Each layer agrees with the others.

**documented fact — the merchant help centre.** "Descriptions and notes cannot be added to
a payment after it's been processed." The same article keeps the whole note during
checkout, at the item level, and points a person to **Review sale** before the payment.

**documented fact — the developer documentation.** The page "Update Payment and Tip
Amounts" gives the rule:

- "Only authorized payments can be updated. Payments with the `status` of `APPROVED` can be
  updated. Completed payments (`status` is `COMPLETED`) cannot be updated."
- "You can update only the `delay_action`, `amount_money`, `app_fee_money`,
  `app_fee_allocations`, and `tip_money` fields."
- "You cannot update a payment after the capture/cancel time threshold."

**documented fact — the public API specification.** Two facts in
`square/connect-api-specification/api.json` show that the rule is structural, and not only
a missing button:

| Schema                 | Field          | What the specification says                                                                                                                                    |
| ---------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Payment`              | `note`         | "An optional note to include when creating a payment." The field is `readOnly: true`.                                                                          |
| `CreatePaymentRequest` | `note`         | "An optional note to be entered by the developer when creating a payment."                                                                                     |
| `Payment`              | `capabilities` | The permitted actions are `EDIT_AMOUNT_UP`, `EDIT_AMOUNT_DOWN`, `EDIT_TIP_AMOUNT_UP`, `EDIT_TIP_AMOUNT_DOWN`, and `EDIT_DELAY_ACTION`. No action edits a note. |

**source-backed tradeoff — what replaces the edit.** Square staff answer the merchant
question in the Seller Community. A merchant asks to change a completed sale after a
customer swapped a size. The Community Program Manager answers: "Once the transaction is
completed, there isn't a way to edit it. If a customer is looking to swap an item, the best
thing to do is to refund the original transaction." A second merchant asks about a tax
error, and calls Square "our audit Journal in case of a CRA audit". The moderator answers:
"there is no way to modify completed transactions... The best way to rectify this matter
would be to refund the customer and charge them again."

**inference — the reason.** Square keeps a completed payment as a closed record. The only
post-payment changes are money fields, and the payment itself declares which of them it
allows. Every other correction becomes a **refund**, which is a separate object. The
original record stays intact, and the correction carries its own operator, time, and
reason. A note is descriptive text, so it cannot enter that model after the fact. The
merchant who uses Square as an audit journal is told to refund and re-charge, and that is
the design working as intended.

**inference — what a standing request proves.** The Seller Community holds a feature
request named "Add note to or amend completed transaction". The request exists and stays
open. The restriction is therefore known and deliberate, not an oversight.

**inference — what this means for Umi.** Umi already follows the Square shape for the
money: a void or a refund is a separate append-only row in `merchant.pos_sale_exception`,
and the receipt snapshot never changes (`dashboard-operations.repository.ts:303`). Umi also
already collects a reason and a note on that row. The gap is only that the dashboard does
not show the note. If Umi adds a note to any completed sale, that note must follow the same
shape as an exception: its own operator, its own time, and its own trail. A field that any
operator can rewrite later would break the property that makes the sale record usable as
evidence.

## 9. Can a post-sale note be used badly?

Answer: yes. The risk has a name in the fraud literature, and the note is one of its tools.
A note is an explanation. The schemes that need an explanation are the schemes a bad actor
wants to close before anybody asks.

**documented fact — the category exists.** The ACFE Fraud Tree defines a **register
disbursement scheme** as "a fraudulent disbursement scheme in which an employee makes false
entries on a cash register to conceal the fraudulent removal of cash (e.g., employee
fraudulently voids a sale on a cash register and steals the cash)." The same page reports a
median loss of about USD 14,000 for the category. Source:
`acfe.com/acfe-insights-blog/-/media/f7c3fc57fa5c46009eda18414bed130f.ashx` (Fraud Tree).

**documented fact — what loss prevention watches.** Agilence, a loss-prevention analytics
vendor, lists the POS exceptions its customers review: void and post-void abuse ("voids tied
to cash transactions"), refund and return fraud, discount and comp misuse, **no-sale
transactions** ("sometimes legitimate, often a cover for cash skims"), cash drawer skims and
shortages, manager override abuse, and suspicious timing. A note is not on that list. That is
the finding: a note is not a signal. It is a story.

**inference — the four ways a note serves the scheme.**

| Vector                 | How it works                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| The pre-emptive excuse | The operator writes the explanation before the owner asks. "Cliente pagará mañana." The drawer is short and the story is already in the system.  |
| The self-explanation   | The person who caused the exception writes the text that describes it. No second person sees it at the time.                                     |
| The edited record      | An editable note lets a person change the story after the money is counted and after the first question. The record loses its value as evidence. |
| The noise floor        | Many notes train the reader to accept a note as a closing argument. The note becomes a rubber stamp.                                             |

**documented fact — Square closes the record.** Section 8 records the rule: a completed
payment cannot be updated, and the note is creation-only. Square staff tell a merchant to
refund and re-charge rather than to explain.

**documented fact — the fiscal rule of Mexico agrees.** The SAT states how a stamped CFDI
with an error is corrected: the merchant cancels it with a motive ("01 Comprobante emitido
con errores con relación" and the folio of the substitute, or "02 Comprobante emitido con
errores sin relación"), and issues the correct document. The original is never edited.
Source: `sat.gob.mx/minisitio/Factura` (Preguntas frecuentes y escenarios de cancelación).
**inference** A sale that a café reports to the tax authority carries the same rule. A free
note cannot outrank the fiscal document.

**documented fact — a free field collects data the law forbids.** The PCI Security
Standards Council states: "Do not store sensitive authentication data contained in the
payment card's storage chip or full magnetic stripe, including the printed 3-4 digit card
validation code ... after authorization." Source:
`pcisecuritystandards.org/pdfs/pci_fs_data_storage.pdf`. **inference** A 160-character text
field on a till accepts any digits. Nothing in the Umi note forbids a card number or a
security code. The same field can hold a phone number or an address, and the LFPDPPP
requires proportionality in personal data (article 6).

**inference — a note about a person.** A free field also accepts blame. "Juan se equivocó"
becomes a permanent record that an admin reads, with no process for the named person to
answer it. This is a labour risk, not a money risk, and it belongs in the decision.

**documented fact — Umi already answers this for money.** The approval boundaries forbid
self-approval: `defaultSelfApproval` is `false`, and every boundary sets
`actorSeparation: true` and `selfApproval: false`
(`config/umipos-pilot-approval-boundaries.json`). A person cannot approve their own refund.

**inference — the shape that keeps a note useful.** If Umi adds the note, these properties
are the ones that keep it honest:

| Property                 | Rule                                                                          | Why                                                                    |
| ------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Append-only              | A correction is a new note with its own time. No edit and no delete.          | The record keeps its value as evidence, as Square and the SAT require. |
| Attributed               | Every note carries the operator, the device, and the time.                    | The reader knows who wrote the story, and when.                        |
| No power over money      | A note never changes an amount, a stock count, or a receipt.                  | A note is metadata. The money path keeps its own approvals.            |
| It cannot clear an alert | The exception report fires on the transaction, not on the presence of a note. | The note is context. The pattern is the control.                       |
| Owner-visible            | The dashboard shows the note beside the sale.                                 | A hidden lane between the operator and the owner is the risk.          |
| Bounded text             | Keep the length limit and refuse card-like digit runs.                        | PCI DSS and the LFPDPPP both apply to a free field.                    |

**inference — recommendation.** Show the note that the till already collects (section 3).
That row is already append-only and already carries the operator, so the risk does not
change. For a note on any completed sale, build it as an annotation row with its own
operator and time, and never as an editable field on the sale. If a note accompanies money,
it needs the same actor separation that a refund already has.

## Sources

| Source                                                                                                                                 | Rung |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `https://developer.squareup.com/docs/payments-api/update-payments`                                                                     | 1    |
| `https://raw.githubusercontent.com/square/connect-api-specification/master/api.json`                                                   | 3    |
| `https://community.squareup.com/t5/Payments-Troubleshooting/Is-there-a-way-to-change-a-transaction-once-it-s-complete-When/m-p/325105` | 5    |
| `https://help.shopify.com/en/manual/sell-in-person/shopify-pos/order-management/order-notes`                                           | 1    |
| `https://help.shopify.com/en/manual/sell-in-person/shopify-pos/order-management/update-orders`                                         | 1    |
| `https://squareup.com/help/us/en/article/5150-notes-on-payments-and-item-descriptions`                                                 | 1    |
| `https://k-series-support.lightspeedhq.com/hc/en-us/articles/48669341062043-Adding-notes-to-an-order-course-and-seat`                  | 1    |
| `https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale.html`                                                        | 1    |
| `https://doc.toasttab.com/doc/platformguide/platformUsingOrdersHub.html`                                                               | 1    |
| `docs/migration/build-v3/31_pos_sale.sql`, `34_pos_exception.sql`, `20_merchant.sql`                                                   | 3    |
| `/home/juan/umi-parrot-backup/2026-10-05/app-privada-onca-pos-14/com.bryajam.panpilot.trial6/db/pan-pilot.db`                          | 3    |
| `https://www.acfe.com/acfe-insights-blog/-/media/f7c3fc57fa5c46009eda18414bed130f.ashx` (ACFE Fraud Tree)                              | 1    |
| `https://blog.agilenceinc.com/pos-exception-reporting-how-lp-teams-use-transaction-data-to-detect-fraud`                               | 4    |
| `https://www.pcisecuritystandards.org/pdfs/pci_fs_data_storage.pdf`                                                                    | 1    |
| `https://www.sat.gob.mx/minisitio/Factura/documentos/PreguntasFrecuentes_CancelacionFactura25082026.pdf`                               | 1    |
| `sdv.com.mx/compendio/ley-proteccion-datos-personales/articulo-6/` (article 6 of the LFPDPPP)                                          | 1    |
| `config/umipos-pilot-approval-boundaries.json`                                                                                         | 3    |
