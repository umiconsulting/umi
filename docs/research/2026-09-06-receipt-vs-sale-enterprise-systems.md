# Receipt vs. sale: how enterprise commerce, POS, ERP, and accounting systems model the two and relate them

- Date: 2026-09-06
- Question: What is the relationship between a "receipt" and a "sale" (sales transaction)
  across enterprise commerce, POS, ERP, and accounting systems? Is a receipt a separate
  persisted entity or a rendered document/view of the sale? What is the cardinality
  (one sale to many receipts? do refunds and split tender make new receipts?)? Which record
  carries the money/tender and which carries the line items? How do refunds, voids, and
  exchanges show up on each?
- Scope: nine first-party systems and two standards/legal layers — Stripe, Square, Shopify,
  QuickBooks Online, Xero, Oracle NetSuite, SAP S/4HANA Sales (SD), Oracle Retail Xstore POS,
  the ARTS/IXRetail Operational Data Model (POSLog), plus fiscalization / e-receipt / VAT-invoice
  law (OECD, EU). The focus is the data model and the entity relationships, not UI.
- Method: primary sources only — official product/developer documentation, machine-readable API
  specs, standards depositories, and government/standards-body publications. Blogs and secondary
  write-ups are excluded except where flagged. Every claim carries the owning source URL and a
  label:
  - **PRIMARY** — a first-party doc page fetched and quoted directly.
  - **PRIMARY-SPEC** — an official machine-readable spec (OpenAPI/schema) whose `externalDocs`
    map 1:1 to the first-party doc URL cited.
  - **PRIMARY-SNIPPET** — a first-party host whose page is a client-rendered SPA that did not
    render to the fetcher, quoted from the search engine's first-party snippet of that page.
  - **SECONDARY** — a non-first-party source, kept only where no primary was reachable, and named.
  - **INFERENCE** — a conclusion derived here, not a quote.
- Reachability note: paywalled/gated sources that could not be reached are named in
  [§14](#14-reachability-and-unverified-claims), with the open first-party substitute used instead
  (e.g. the OMG Retail Depository copy of the ARTS ODM 7.3 narrative, and Xero's public OpenAPI
  spec for its SPA doc pages).

## 1. Executive summary

Across every system studied, a **"sale/order/transaction"** is the durable commercial record — it
owns the **line items** and it is the thing everything else references. A **"receipt"** is, in the
common case, **not a separate record but a rendered artifact of that sale** (a URL, an email, a PDF,
a printout). The systems that _do_ persist a distinct "receipt" entity fall into two camps that both
differ from the everyday POS meaning of the word:

1. **Payments and e-commerce APIs (Stripe, Square, Shopify)** — the receipt is a **rendered view /
   URL** hung off the money record; it is never a first-class object. Line items live on the
   order/invoice; money/tender lives on the charge/payment/transaction; refunds and voids are their
   own money records that reference the sale.
2. **Accounting APIs (QuickBooks, Xero)** — the word "receipt" is a **terminology trap**. QuickBooks
   `SalesReceipt` means a _paid-in-full sale_ (immediate payment, no receivable), and Xero `Receipts`
   means a _draft expense-claim_ a user files — neither is a customer proof-of-purchase. The real
   axis here is immediate-payment sale vs. sale-on-credit.
3. **ERP / retail (NetSuite, SAP, Oracle Retail) and the retail standard (ARTS)** — there is no
   "receipt" money entity; the sale is a chain of linked documents (order → fulfillment → invoice →
   payment), and the receipt is a print/lookup rendering of the stored transaction. The **ARTS
   Operational Data Model is the one place that models the receipt explicitly**, as a
   `RetailTransactionDocument` that is "separate from, but linked to" the `RetailTransaction`.

The single conceptual distinction that holds everywhere: the **sale is the commercial event that
carries the line items**; the **receipt is the proof-of-transaction / tender-acknowledgment document
that memorializes it**. Cardinality is consistently **one sale → many downstream records** (many
tenders, many payments, many refunds, many rendered receipts). **Refunds, voids, and exchanges are
always new reversing records, never in-place edits to the original sale.** Where money and line items
sit relative to each other is the axis on which systems disagree (see [§13](#13-where-systems-disagree)).

## 2. Cross-system comparison table

| System | Is "receipt" a persisted entity or a rendered view? | Carries LINE ITEMS | Carries MONEY / TENDER | Refunds / voids | Cardinality |
| --- | --- | --- | --- | --- |
| **Stripe** | Rendered view — `receipt_url` on the Charge; no Receipt object | Invoice (`lines`) | PaymentIntent / Charge / Refund | Refund object; partial via `amount_refunded`; no "void" — uncaptured intents are canceled | 1 PaymentIntent → 1 latest Charge → many Refunds; payment + each refund get their own receipt |
| **Square** | Rendered view — `receipt_url`/`receipt_number` on Payment; only a `ReceiptOptions` config object exists | Order (`line_items`) | Payment + Tender | PaymentRefund object; void = CANCELED Payment status | 1 Order → many Tenders, many Payments, many Refunds |
| **Shopify** | No receipt entity at all — the Order is the record | Order (`lineItems`), RefundLineItem | OrderTransaction (`kind` = sale/authorization/capture/refund/void) | Refund object + `kind:REFUND`; void = `kind:VOID` | 1 Order → many OrderTransactions, many Refunds |
| **QuickBooks Online** | Persisted, but `SalesReceipt` = a _paid-in-full sale_, not a proof-of-purchase | SalesReceipt / Invoice / CreditMemo / RefundReceipt | SalesReceipt & RefundReceipt (deposit acct); Payment (settles invoices) | RefundReceipt (cash out now); CreditMemo (credit vs balance) | Invoice → many Payments; Payment → many Invoices/CreditMemos |
| **Xero** | Persisted, but `Receipts` = a _draft expense-claim_ (deprecated), not a sale | Invoice (`ACCREC`) or BankTransaction (`RECEIVE`) | Payment; or the BankTransaction itself | CreditNote (`ACCRECCREDIT`) | Invoice → many Payments; cash sale = one RECEIVE bank txn |
| **Oracle NetSuite** | No receipt entity; Cash Sale/Invoice rendered via PDF/HTML template | Cash Sale (lines + money) / Invoice (lines only) | Cash Sale (immediate) / Customer Payment (deferred) | Cash Refund (reverses Cash Sale); Credit Memo (reverses Invoice) | 1 Sales Order → many Item Fulfillments, many Invoices, many Payments |
| **SAP S/4HANA (SD)** | No receipt entity; the Billing Document (invoice) is the customer document | Sales Order / Billing Document | Billing Document + FI posting | Credit/debit memo; invoice reversal (cancellation) | 1 Sales Order → many Deliveries, many Billing Documents |
| **Oracle Retail Xstore** | Rendered/printed artifact + a lookup barcode into the stored transaction | RetailTransaction (in DB) | RetailTransaction tender step | Return transaction (verified / unverified / blind) references original | 1 transaction → 1 printed receipt; returns are new transactions |
| **ARTS ODM (standard)** | **Persisted and modeled** — `RetailTransactionDocument`, "separate from, but linked to" the transaction | RetailTransaction → SaleReturnLineItem | RetailTransaction → TenderLineItem (sibling subtype) | Sale/Return/Void line-item type codes; new reversing lines | 1 RetailTransaction → 1..n documents; POSLog = transient transport |
| **Fiscalization / VAT law** | **Legally-mandated document** distinct from the internal sale record | (the sale system) | (the sale system) | Fiscal "refund" receipt type; credit note / invoice cancellation | 1 sale → 1 fiscal receipt with mandated content + signature |

## 3. Stripe

Object model: **PaymentIntent → Charge → Refund**, with line items only on the separate **Invoice**.
The receipt is an attribute/URL of the Charge, not its own object.

- A Charge has three receipt fields — `receipt_email`, `receipt_number`, `receipt_url` — all
  attributes of the Charge; there is no separate "Receipt" object in the Charge reference.
  **[PRIMARY]** — <https://docs.stripe.com/api/charges/object>
- `receipt_url` is a rendered document kept in sync with charge state. Verbatim: _"This is the URL to
  view the receipt for this charge. The receipt is kept up-to-date to the latest state of the charge,
  including any refunds. If the charge is for an Invoice, the receipt will be stylized as an Invoice
  receipt."_ **[PRIMARY]** — <https://docs.stripe.com/api/charges/object>
- `receipt_number` verbatim: _"This is the transaction number that appears on email receipts sent for
  this charge. This attribute will be `null` until a receipt has been sent."_ — the receipt "number"
  only exists once a receipt is actually sent. **[PRIMARY]** — <https://docs.stripe.com/api/charges/object>
- A PaymentIntent points to a single latest Charge: `latest_charge` = _"ID of the latest Charge object
  created by this PaymentIntent."_ The PaymentIntent also carries its own `receipt_email`.
  **[PRIMARY]** — <https://docs.stripe.com/api/payment_intents/object>
- The receipt is a rendered artifact, not an API object. Verbatim (the doc localizes to the reader;
  served here in Spanish): _"Cada recibo tiene una URL que el cliente puede ver en un navegador web.
  Para vincular un recibo desde tu aplicación, usa el atributo receipt_url del objeto Charge."_
  (Each receipt has a URL the customer can view in a browser; to link a receipt from your app, use the
  Charge object's `receipt_url` attribute.) **[PRIMARY]** — <https://docs.stripe.com/receipts>
- Stripe generates receipts for both payments **and** refunds. Verbatim: _"Stripe crea recibos para
  todos los pagos y reembolsos correctos"_ (Stripe creates receipts for all successful payments and
  refunds). So one charge that is later refunded can produce more than one receipt.
  **[PRIMARY]** — <https://docs.stripe.com/receipts>
- Refund is its own persisted object linked to a charge and/or PaymentIntent (`charge`, `payment_intent`),
  and the Charge holds a `refunds` list ("A list of refunds that have been applied to the charge") — so
  one charge : many refunds. The Refund object has its own `receipt_number` = _"the transaction number
  that appears on email receipts sent for this refund."_
  **[PRIMARY]** — <https://docs.stripe.com/api/refunds/object>, <https://docs.stripe.com/api/charges/object>
- Money vs. line items: Charge/PaymentIntent/Refund carry money and have **no line items**. Line items
  live only on the **Invoice**, whose `lines` field = _"The individual line items that make up the
  invoice."_ An Invoice has its own `receipt_number`, `hosted_invoice_url`, and `invoice_pdf`.
  **[PRIMARY]** — <https://docs.stripe.com/api/invoices/object>
- Partial vs. full refund state lives on the Charge: `amount_refunded` ("can be less than the amount
  attribute … if a partial refund was issued") and `refunded` ("Whether the charge has been fully
  refunded. If the charge is only partially refunded, this attribute will still be false").
  **[PRIMARY]** — <https://docs.stripe.com/api/charges/object>

**Stripe takeaway:** receipt = rendered document/URL/email, never a first-class object. Money = Charge/
PaymentIntent/Refund; line items = Invoice only. One PaymentIntent : one latest Charge : many Refunds;
payments and refunds each generate their own receipt and receipt number.

## 4. Square

Object model: **Order (line items + tenders) ↔ Payment (money) ↔ PaymentRefund**. The receipt is a
URL on the Payment/Tender, not its own object.

- The Order carries the line items. Verbatim: the Order _"contains all information related to a single
  order to process with Square, including line items that specify the products to purchase."_
  `line_items` = _"The line items included in the order."_ It also holds read-only `tenders`
  (_"The tenders that were used to pay for the order"_), `refunds`, and `returns` — so the Order is the
  aggregate record and can have multiple tenders (split tender) and refunds.
  **[PRIMARY]** — <https://developer.squareup.com/reference/square/objects/Order>
- The Payment carries money/tender, not line items, and links to the Order by id: `order_id` = _"The ID
  of the order associated with the payment."_ It tracks `amount_money`, `total_money`, `refunded_money`,
  `refund_ids`, and `status` (APPROVED, PENDING, COMPLETED, CANCELED, FAILED).
  **[PRIMARY]** — <https://developer.squareup.com/reference/square/objects/Payment>
- The receipt is a rendered URL on the Payment, not a persisted Receipt object. `receipt_url` = _"The URL
  for the payment's receipt. The field is only populated for COMPLETED payments."_ `receipt_number` =
  _"The payment's receipt number. The field is missing if a payment is canceled."_
  **[PRIMARY]** — <https://developer.squareup.com/reference/square/objects/Payment>
- There is no standalone Receipt object; Square exposes only a `ReceiptOptions` object that configures
  receipt print/reprint actions.
  **[PRIMARY]** — <https://developer.squareup.com/reference/square/objects/ReceiptOptions>
- The Tender is the split-tender / money-method unit: _"Represents a tender (i.e., a method of payment)
  used in a Square transaction."_ Each Tender has `amount_money`, a required `type` (CARD, CASH,
  BANK_ACCOUNT, BUY_NOW_PAY_LATER, SQUARE_ACCOUNT), and `payment_id`.
  **[PRIMARY]** — <https://developer.squareup.com/reference/square/objects/Tender>
- Refunds are their own persisted objects: PaymentRefund _"Represents a refund of a payment made using
  Square. Contains information about the original payment and the amount of money refunded."_ It links
  back to both `payment_id` and `order_id`, with its own `id`, `status`, `amount_money`, and timestamps.
  **[PRIMARY]** — <https://developer.squareup.com/reference/square/objects/PaymentRefund>

**Square takeaway:** receipt = rendered URL on the Payment (only a `ReceiptOptions` config object is
persisted). Line items = Order; money/tender = Payment + Tender. Refunds = PaymentRefund; voids = a
CANCELED Payment status. One Order : many Tenders / Payments / Refunds.

## 5. Shopify (Admin GraphQL API)

Object model: **Order (line items) → OrderTransaction (money) + Refund**. There is no "receipt" object.

- The Order is the record of the sale: _"The `Order` object represents a customer's request to purchase
  one or more products from a store."_ It carries `lineItems`, plus connections to `transactions`,
  `refunds`, and money fields `totalPriceSet` ("total price … before returns") and
  `currentTotalPriceSet` ("total price … after returns").
  **[PRIMARY]** — <https://shopify.dev/docs/api/admin-graphql/latest/objects/Order>
- There is no receipt object or receipt field on the Order — the Order itself is the record; receipts/
  confirmations are order-status pages and emails, not a modeled entity.
  **[PRIMARY]** — <https://shopify.dev/docs/api/admin-graphql/latest/objects/Order>
- Money movement lives on OrderTransaction: _"The `OrderTransaction` object represents a payment
  transaction that's associated with an order … such as a customer paying for a purchase or receiving a
  refund …"_ One order has many transactions, linked via `parentTransaction` (authorization → capture).
  **[PRIMARY]** — <https://shopify.dev/docs/api/admin-graphql/latest/objects/OrderTransaction>
- Transaction type is the `kind` enum. Verbatim: SALE = _"An authorization and capture performed together
  in a single step."_; REFUND = _"A partial or full return of captured funds to the cardholder. A refund
  can happen only after a capture is processed."_; VOID = _"A cancelation of an authorization
  transaction."_ (plus AUTHORIZATION, CAPTURE, CHANGE, EMV_AUTHORIZATION, SUGGESTED_REFUND).
  **[PRIMARY]** — <https://shopify.dev/docs/api/admin-graphql/latest/enums/OrderTransactionKind>
- Refund is its own object tied to an Order: _"The `Refund` object represents a financial record of money
  returned to a customer from an order."_ It holds `refundLineItems`, `transactions`, `totalRefundedSet`,
  and a non-null `order`. Key caveat verbatim: _"The existence of a `Refund` object doesn't guarantee
  that the money has been returned to the customer."_ — actual money movement is confirmed on the
  associated OrderTransaction.
  **[PRIMARY]** — <https://shopify.dev/docs/api/admin-graphql/latest/objects/Refund>
- The DraftOrder is the pre-sale record that becomes an Order: _"An order that a merchant creates on
  behalf of a customer."_ The `draftOrderComplete` mutation converts it into a regular Order.
  **[PRIMARY]** — <https://shopify.dev/docs/api/admin-graphql/latest/objects/DraftOrder>

**Shopify takeaway:** no receipt object — the Order is the persisted record and receipts are
order-confirmation pages/emails. Line items = Order (and RefundLineItem for the refunded subset);
money = OrderTransaction (`kind` = sale/authorization/capture/refund/void). One Order : many
transactions and refunds.

## 6. QuickBooks Online (Intuit)

The word "receipt" is persisted here but does **not** mean a proof-of-purchase — the real axis is
immediate-payment sale vs. sale-on-credit.

- `SalesReceipt` = a sale with payment collected at the same moment; it carries **both** the line items
  and the tender and creates **no** Accounts Receivable. Verbatim: _"A SalesReceipt object represents the
  sales receipt that is given to a customer. A sales receipt is similar to an invoice. However, for a
  sales receipt, payment is received as part of the sale of goods and services."_ Money routes straight
  to cash/bank: _"The sales receipt specifies a deposit account where the customer's payment is
  deposited. If the deposit account is not specified, the Undeposited Account is used."_
  **[PRIMARY]** — <https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/salesreceipt>
- `Invoice` = a sale on credit; the customer pays later, which is what creates the receivable. Verbatim:
  _"An Invoice represents a sales form where the customer pays for a product or service later."_ It is
  settled by a linked Payment (_"Links to payments applied to an Invoice object are returned … with
  LinkedTxn.TxnType set to Payment."_).
  **[PRIMARY]** — <https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice>
- `Payment` = the money/tender record for credit sales; it applies cash against invoices and carries no
  sale line items. Verbatim: _"A Payment object records a payment in QuickBooks. The payment can be
  applied for a particular customer against multiple Invoices and Credit Memos. It can also be created
  without any Invoice or Credit Memo, by just specifying an amount."_ An unapplied Payment _"is recorded
  as a credit."_
  **[PRIMARY]** — <https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/payment>
- `RefundReceipt` = an immediate cash refund (the mirror of a SalesReceipt); money leaves a bank/asset
  account now. Verbatim: _"A RefundReceipt object represents a refund to the customer for a product or
  service that was provided."_ Its required `DepositToAccountRef` is the _"Account from which payment
  money is refunded."_
  **[PRIMARY]** — <https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/refundreceipt>
- `CreditMemo` = a credit against what the customer owes; it carries sale line items but returns no cash
  by itself. Verbatim: _"The CreditMemo object is a financial transaction representing a refund or credit
  of payment or part of a payment for goods or services that have been sold."_
  **[PRIMARY]** — <https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/creditmemo>

**QBO takeaway:** sale + line items live on `SalesReceipt` (paid now), `Invoice` (credit),
`CreditMemo`, and `RefundReceipt`. Tender is on `SalesReceipt`/`RefundReceipt` (via their deposit
account) for immediate cash, and on `Payment` for settling credit invoices. Refunds: immediate cash →
`RefundReceipt`; credit against a balance → `CreditMemo`.

## 7. Xero (Accounting API)

Xero also persists a "Receipts" entity — and it means something else again. (Xero doc pages are
client-rendered SPAs; the quotes below are from Xero's official OpenAPI spec, whose `externalDocs` map
1:1 to the cited pages: <https://raw.githubusercontent.com/XeroAPI/Xero-OpenAPI/master/xero_accounting.yaml>)

- `Invoices` holds the sale and its line items; a sales invoice is `Type: ACCREC` (accounts receivable).
  The endpoint summary is _"Retrieves sales invoices or purchase bills"_; the receivable is tracked on
  the invoice itself: `AmountDue` = _"Amount remaining to be paid on invoice"_, `AmountPaid` = _"Sum of
  payments received for invoice."_
  **[PRIMARY-SPEC]** — <https://developer.xero.com/documentation/api/accounting/invoices>
- `Payments` holds the money; a payment only applies to an invoice or credit note (plus pre/overpayments)
  and never carries line items. Summary: _"Creates a single payment for invoice or credit notes."_
  `Amount` = _"The amount of the payment. Must be less than or equal to the outstanding amount owing on
  the invoice …"_; `PaymentType` enum distinguishes `ACCRECPAYMENT` (customer) vs `ACCPAYPAYMENT`
  (supplier).
  **[PRIMARY-SPEC]** — <https://developer.xero.com/documentation/api/accounting/payments>
- `Receipts` is **not** a customer sales receipt — it is a **draft expense-claim receipt** (money a user/
  employee spent), and the endpoint is deprecated. Summaries: _"Retrieves draft expense claim receipts
  for any user"_ / _"Creates draft expense claim receipts for any user."_ The `Receipt` schema has a
  `User` field and a `Status` enum of `DRAFT / SUBMITTED / AUTHORISED / DECLINED / VOIDED` — an
  expense-claim lifecycle, not a sales lifecycle. The page title carries _"(Deprecated)."_
  **[PRIMARY-SPEC]** (title "(Deprecated)" confirmed **[PRIMARY]** from the live page) —
  <https://developer.xero.com/documentation/api/accounting/receipts>
- `CreditNotes` handle refunds/credits; a customer (sales) credit note is `Type: ACCRECCREDIT`, carries
  `LineItems`, and has a status enum including `PAID`.
  **[PRIMARY-SPEC]** — <https://developer.xero.com/documentation/api/accounting/creditnotes>
- `BankTransactions` model money moving through a bank account directly — Xero's "receive money" (cash
  sale without an invoice) and "spend money" mechanism. The `Type` enum is `RECEIVE`, `RECEIVE-OVERPAYMENT`,
  `RECEIVE-PREPAYMENT`, `SPEND`, `SPEND-OVERPAYMENT`, `SPEND-PREPAYMENT`, `RECEIVE-TRANSFER`,
  `SPEND-TRANSFER`; a bank transaction carries `LineItems` and a `BankAccount`.
  **[PRIMARY-SPEC]** — <https://developer.xero.com/documentation/api/accounting/banktransactions>

**Xero takeaway:** sale + line items = `Invoice` (`ACCREC`) or, for a no-invoice cash sale, a
`BankTransaction` (`RECEIVE`). Money = `Payment` (against invoices/credit notes) or the `BankTransaction`
itself. "Receipt" here = a **draft expense-claim** tied to a user (deprecated), not a proof-of-purchase.
Refunds/customer credits = `CreditNotes` of `Type: ACCRECCREDIT`.

## 8. Oracle NetSuite (order-to-cash)

The order-to-cash records are **separate persisted transactions** that cross-reference each other; there
is no distinct "receipt" money entity.

- NetSuite documents them as distinct scriptable transaction records: Sales Order, Invoice, Cash Sale,
  Item Fulfillment, Credit Memo, Cash Refund, Return Authorization, Customer Deposit, Deposit Application.
  **[PRIMARY]** — <https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N3191224.html>
- A **Cash Sale** is the sale record for immediate payment and carries **both** line items and money.
  Verbatim: _"A cash sale is a transaction that records the sale of goods or services for which you
  receive immediate payment …"_ and _"cash sale line-items specify the goods and services sold and their
  sales amounts. The sum of all sales amounts plus any applicable tax equals the total amount paid for
  this sale."_ It _"posts this as money added to the Undeposited Funds account,"_ cleared by a later
  Deposit.
  **[PRIMARY]** — <https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N3192506.html>
- An **Invoice** is the sale record for deferred payment; it carries line items only, and money against
  it lives in a **separate Customer Payment** record: _"The Payment record lists a payment made in
  response to an invoice … Payment is applied to decrease or eliminate the amount due."_
  **[PRIMARY]** — <https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1512507518.html>,
  <https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N3194809.html>
  - The one-sentence Invoice definition (_"An invoice transaction creates a bill for goods, services (or
    both) sold to a customer for which payment is not received at the time of delivery … each invoice
    consists of multiple line items …"_) was only re-quotable from the search snippet of the help page.
    **[PRIMARY-SNIPPET]** — <https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N3678746.html>
- The document flow and the branch that decides Cash Sale vs. Invoice, verbatim: _"Each sales transaction
  starts as a cash sale. For cash-and-carry sales with split payments, the cash sale turns into an
  invoice. For delivery orders, sales orders are created. When delivery orders are processed and shipped,
  item fulfillments are created from the sales order."_ — fulfillment is a separate Item Fulfillment
  record; payment terms decide Cash Sale vs. Invoice.
  **[PRIMARY]** — <https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4290511404.html>
- Refunds/returns are separate reversing records. A **Cash Refund** reverses a Cash Sale: _"A cash refund
  transaction records the return of money to a customer who immediately paid for goods or services …"_;
  a **Credit Memo** is the equivalent reversal on the Invoice side.
  **[PRIMARY]** — <https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N3192213.html>
- The printed "receipt" is a rendering of the persisted record (e.g. the "Standard Cash Sale PDF/HTML
  Template"), not a separate money record.
  **[PRIMARY]** — <https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/SBADVTemplates_1190729318.html>

**NetSuite takeaway:** immediate-payment sale collapses lines + money into one record (Cash Sale);
bill-later splits lines (Invoice) from money (Customer Payment). Both are persisted, cross-referencing
transactions; the "receipt" is a print template of the record.

## 9. SAP S/4HANA Sales (SD)

SAP models the chain as distinct, separately persisted documents joined by a **document flow**; the
customer-facing money document is the **Billing Document** (invoice).

- Verbatim: _"The document flow shows consecutive documents that are directly tied to a business
  transaction. The individual documents form document chains."_ The system displays for each document
  _"all preceding and subsequent documents."_ The SD chain objects named on that page include the
  _"sales order,"_ the _"delivery,"_ and the billing objects _"invoice and invoice reversal,"_ _"credit
  memo,"_ and _"debit memo."_
  **[PRIMARY]** — <https://help.sap.com/doc/b183ce53118d4308e10000000a174cb4/700_SFIN3E%20006/en-US/b4dfb65334e6b54ce10000000a174cb4.html>
- Which document carries what: the Sales Order and its items drive the process (_"the sales order item is
  the root object for the subsequent process steps"_); the Outbound Delivery is the fulfillment/goods
  movement (_"Posting goods issue for the outbound delivery is the last step of the outbound delivery
  process"_); billing then produces the invoice.
  **[PRIMARY]** — <https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/25a41481f62e469ba0e61015a0d39d20/610fb16c6f8341e0a0725eeb3abb00ed.html>
- The Billing Document is the customer-facing money/invoice document, created "with reference to" a
  preceding document. A billing document type _"categorizes different types of billing documents (such
  as invoices, credit memos and debit memos, as well as the associated cancellation documents) … to
  facilitate the correct billing of different preceding documents (such as outbound deliveries or billing
  document requests)."_
  **[PRIMARY-SNIPPET]** (S/4 Help SPA did not render; first-party snippet) —
  <https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/7b24a64d9d0941bda1afa753263d9e39/d96fb6535fe6b74ce10000000a174cb4.html>
- Returns/reversals are their own billing documents: _"A credit memo is a billing document created with
  reference to a credit memo request or invoice that reduces receivables … A debit memo is a billing
  document … that increases receivables."_ Invoice cancellation is a further "invoice reversal" document.
  **[PRIMARY-SNIPPET]** — <https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/7b24a64d9d0941bda1afa753263d9e39/1670b6535fe6b74ce10000000a174cb4.html>

**SAP SD takeaway:** the customer "proof" is the Billing Document (invoice) — a persisted document
distinct from the sales order (demand) and the outbound delivery (fulfillment). Returns and
cancellations are additional documents in the same flow, never edits to the invoice. One sales order →
many deliveries → many billing documents.

## 10. Oracle Retail Xstore POS

The POS persists the **RetailTransaction** in its database and treats the **receipt** as printed output
and a lookup key back into that transaction.

- Capability list, verbatim: _"scanning items, applying price adjustments, tendering, and printing
  receipts as well as processing returns."_ On tendering: _"When ready to tender, select the amount due
  to show a list of tenders and continue payment to complete the transaction."_ — the receipt is output
  of the completed transaction, not its own money record.
  **[PRIMARY]** — <https://docs.oracle.com/en/industries/retail/retail-xstore-point-of-service/25.0/rpxmo/introduction-oracle-retail-xstore-pos.htm>
- The receipt is a lookup key into the stored transaction. Verbatim: _"A return using the customer's
  original sale receipt to locate the transaction information stored in the database is a verified
  return."_ And: _"scan the barcode on the customer's original receipt. The system recognizes that this
  is a sale receipt barcode rather than an item identifier. If the original transaction is found in the
  database … the original transaction information is shown."_
  **[PRIMARY]** — <https://docs.oracle.com/en/industries/retail/retail-xstore-point-of-service/24.0/rpxmo/return-transactions.htm>
- Returns handle receipt-found, receipt-not-found, and no-receipt as distinct return transactions:
  _"A blind return is a return without a receipt. An unverified return is a return where the customer has
  a sale receipt, but it cannot be found in the database."_ A return is a new transaction that may
  reference the original.
  **[PRIMARY]** — <https://docs.oracle.com/en/industries/retail/retail-xstore-point-of-service/24.0/rpxmo/return-transactions.htm>

**Xstore takeaway:** "receipt" = the printed/rendered artifact of a stored RetailTransaction and a
barcode lookup into it, not a separate money entity. (Xstore's underlying model is ARTS-based — see §11.)

## 11. Retail data-model standard: ARTS / IXRetail Operational Data Model (POSLog)

The ARTS Operational Data Model v7.3 "Logical Narrative" is the strongest standards-level statement of
the receipt-vs-transaction distinction, and it is open and first-party at the OMG Retail Depository. ARTS
(Association for Retail Technology Standards) was created by NRF and is now co-managed by NRF and OMG.

- The `RetailTransaction` is one entity spanning both merchandise and money, in tiers. Verbatim:
  _"RetailTransaction entity instances are created at the point where the store's merchandise and
  services are transformed into tender and credited as sales (or the reverse for returns)."_ And: _"The
  retail transaction is organized into three tiers: Transaction level, Line level, and Line modifier
  level."_
  **[PRIMARY]** — <https://www.omg.org/retail-depository/arts-odm-73/retail_transaction.htm>
- Formal definition, verbatim: _"A type of Transaction that records the business conducted between the
  retail enterprise and another party involving the exchange in ownership and/or accountability for
  merchandise and/or tender or involving the exchange of tender for services."_ It "contains"
  `RetailTransactionLineItem` and "has" `RetailTransactionTotal`.
  **[PRIMARY]** — <https://www.omg.org/retail-depository/arts-odm-73/%7B497BD484-D2D2-4DA1-B60B-AF575ADFC2E1%7D+00000000.html>
- **Line items and money are two subtypes of the same base line-item entity** — the load-bearing point.
  The base `RetailTransactionLineItem` is _"A detail line item of a RetailTransaction …"_ whose
  `RetailTransactionLineItemTypeCode` denotes _"the type of retail transaction line item, such as
  Sale/Return, Void, miscellaneous fee, etc."_ It specializes into `SaleReturnLineItem` (merchandise)
  and `TenderLineItem` (money).
  **[PRIMARY]** — <https://www.omg.org/retail-depository/arts-odm-73/%7B7BCA3AF9-F3BF-4C5A-A552-35955F08EDF0%7D+00000000.html>
- The tender subtype, verbatim: _"A line item component of a RetailTransaction that records the
  settlement of that transaction with an offsetting, valid tender type."_ `TenderAmount` = _"The monetary
  value … of the tender submitted by the Customer"_; `AmountAppliedToTransaction` = _"The monetary amount
  being applied to the TransactionTotal."_ Merchandise and tender sit in the SAME transaction as separate
  line-item rows.
  **[PRIMARY]** — <https://www.omg.org/retail-depository/arts-odm-73/%7B2B6FA1B6-5860-42C7-BBC1-A122C059B2CE%7D+00000000.html>
- The **receipt is modeled as a separate, linked document entity** — the exact distinction this note is
  about. Verbatim: a document is _"an artifact that is created and given to a customer (either as a piece
  of paper, or digital image) to memorialize an underlying retail transaction,"_ and _"a document exists
  as an entity that is separate from, but linked to an underlying retail transaction"_ (the
  `RetailTransactionDocument` entity).
  **[PRIMARY]** — <https://www.omg.org/retail-depository/arts-odm-73/logical_02302.htm>
- **POSLog vs. the stored record:** the transaction message on the wire is distinct from the durable
  record. Verbatim: _"POSLOG is a message specification used to contain business information that is moved
  from one point to another. In relative terms it is transient data. The transactions stored in the ARTS
  ODM … are permanent records of retail business activities."_
  **[PRIMARY]** — <https://www.omg.org/retail-depository/arts-odm-73/arts_transaction_concepts.htm>
- Scale, for context: the ARTS ODM is described as "133 subject areas, over 850 entities, over 1,700
  relationships and over 6,800 attributes." **[SECONDARY]** (trade press, not the OMG spec) —
  <https://www.retailcustomerexperience.com/news/arts-announces-major-update-to-data-model-standards/>

**ARTS takeaway:** the standard puts merchandise and tender as sibling line-item subtypes inside ONE
`RetailTransaction`, and treats the receipt as a **separate-but-linked `RetailTransactionDocument`** that
"memorializes" the transaction. POSLog is a transient transport message, not the system of record. This
is the cleanest formal statement that "receipt" ≠ "the sale record."

## 12. Fiscalization / e-receipt / VAT-invoice law

A fiscal or tax receipt is a **legally-defined document**, mandated by content and integrity rules, and
separable from the merchant's internal sale record.

- A fiscal receipt must carry mandated data at the moment of sale. OECD, verbatim: requirements _"state
  the details of what data – usually termed fiscal data – must be recorded and printed on the purchase
  receipt at the time of the transaction. This can include the amount of the sale, the amount of VAT /
  sales tax due, the time, date, and invoice number … and the type of receipt (such as final bill,
  non-final bill or refund)."_
  **[PRIMARY]** — <https://www.oecd.org/content/dam/oecd/en/publications/reports/2019/03/implementing-online-cash-registers_8d53d1a6/bfd36ca2-en.pdf> (para. 22)
- The fiscal receipt is authenticated independently of the sale line data. OECD, verbatim: _"The digital
  signature is stored with the transaction data and also printed on the customer's receipt, e.g. as a
  Quick Response (QR) code."_
  **[PRIMARY]** — same OECD PDF (para. 23)
- A digital (e-)receipt can hold the same legal status as paper. OECD, verbatim: _"Where digital receipts
  are recognised to have the same legal status as a hard copy, this can make it significantly easier for
  consumers to exercise legal rights to return goods."_
  **[PRIMARY]** — same OECD PDF (para. 13)
- The customer-facing tax document in the EU is the VAT invoice — legally mandated, with prescribed
  content, distinct from internal accounting records. EU Taxation and Customs Union: an invoice _"is proof
  that allows the business to deduct VAT,"_ must be issued _"whenever goods or services are supplied,"_
  and must carry a fixed content set (date, unique sequential number, supplier/customer details and VAT
  IDs, description/quantity, unit price, VAT rate and amount). _"Simplified invoices"_ (the retail-receipt
  form) are a recognized lighter variant.
  **[PRIMARY]** — <https://taxation-customs.ec.europa.eu/taxation/vat/vat-businesses/invoicing_en>

**Fiscalization takeaway:** a fiscal/tax receipt (or simplified invoice) is a legally-mandated document
defined by tax-law content and integrity rules, and separable from the merchant's internal sale
transaction record — reinforcing "receipt as a distinct legal artifact of the sale," not the sale record.

## 13. Cross-system synthesis

**The common conceptual model.** Two distinct concepts recur under many names:

- **The sale / order / transaction** — the durable commercial event. It **owns the line items** (what
  was bought, quantities, prices, tax) and is the record everything else points at. Names: Stripe
  `Invoice` (for line items) / `PaymentIntent` (for the payment attempt); Square `Order`; Shopify
  `Order`; QBO `Invoice`/`SalesReceipt`; Xero `Invoice`/`BankTransaction`; NetSuite `Sales Order` /
  `Invoice` / `Cash Sale`; SAP `Sales Order` / `Billing Document`; ARTS `RetailTransaction`.
- **The receipt** — the **proof-of-transaction / tender-acknowledgment document** that memorializes the
  sale for the customer. In most systems it is a **rendered view** (URL, email, PDF, print), not its own
  record. Only ARTS models it as a first-class linked entity (`RetailTransactionDocument`), and only tax
  law elevates it to a mandated legal instrument (fiscal receipt / VAT invoice).

**Where money and line items sit.** Two settlement patterns explain the whole field:

- **Immediate payment (POS / cash-and-carry):** line items and tender are carried together. NetSuite
  `Cash Sale` and QBO `SalesReceipt` fuse them into one record; ARTS keeps them as sibling line-item
  subtypes (`SaleReturnLineItem` + `TenderLineItem`) inside one `RetailTransaction`; Square keeps line
  items on the `Order` and tender on the `Payment`/`Tender` but binds them tightly by `order_id`.
- **Deferred payment (credit / bill-later):** line items and money are split across records — NetSuite
  `Invoice` + `Customer Payment`; SAP `Sales Order`/`Billing Document` + FI posting; QBO `Invoice` +
  `Payment`; Xero `ACCREC Invoice` + `Payment`; Stripe `Invoice` + generated `PaymentIntent`/`Charge`.
  The gap between the two is the receivable (A/R).

**Cardinality (consistent everywhere):** one sale → many downstream records. One order can have many
tenders/payments/transactions/fulfillments/invoices, and each successful payment and each refund can
produce its own rendered receipt or receipt number. Split tender multiplies tender rows and, in
payments systems, receipt URLs.

**Refunds / voids / exchanges (consistent everywhere):** always **new reversing records**, never
in-place edits to the original sale — Stripe `Refund`; Square `PaymentRefund` (void = CANCELED payment);
Shopify `Refund` + `kind:REFUND`/`kind:VOID`; QBO `RefundReceipt`/`CreditMemo`; Xero `CreditNote`
(`ACCRECCREDIT`); NetSuite `Cash Refund`/`Credit Memo`; SAP credit/debit memo + invoice reversal; ARTS
Sale/Return/Void line-item type codes; the fiscal "refund" receipt type. A partial refund is a
lesser-amount reversing record (e.g. Stripe `amount_refunded < amount`, `refunded` stays false), and an
exchange is a return plus a new sale, not a mutation.

### Where systems disagree

1. **Is "receipt" ever a persisted entity?** Payments/e-commerce APIs (Stripe, Square, Shopify) say no —
   it is a rendered URL/email, or absent entirely. ARTS and tax law say yes — a distinct linked document
   (`RetailTransactionDocument`) / mandated legal instrument.
2. **What the word "receipt" even means.** In POS/payments it is a proof-of-purchase. In QuickBooks
   `SalesReceipt` it is a _paid-in-full sale record_. In Xero `Receipts` it is a _draft expense-claim_ a
   user files. Same word, three different meanings — a genuine naming hazard when integrating across
   systems.
3. **Are line items and money in one record or two?** Immediate-payment models fuse them (NetSuite Cash
   Sale, QBO SalesReceipt); credit models and payment APIs split them (Invoice vs. Payment/Charge/
   Transaction). ARTS keeps one transaction but two line-item subtypes.
4. **Where "void" lives.** Shopify makes it a transaction `kind`; Square makes it a Payment _status_
   (CANCELED); Stripe has no explicit void (an uncaptured PaymentIntent is canceled); NetSuite/SAP/ARTS
   express it as a reversing document / line-type.

### Design implications for Umi (INFERENCE)

- Model the **sale/order as the system of record that owns the line items**, and treat the **receipt as a
  rendering** of it (a projection or document), not a second source of truth — this is what every
  payments/e-commerce/ERP system does, and it avoids the QBO/Xero "receipt means something else" trap.
- Keep **tender/payment as its own record(s)** referencing the sale, so split tender and one-sale-to-many
  refunds are natural (Square/Stripe/Shopify cardinality).
- Represent **refunds, voids, and exchanges as new reversing records** that reference the original sale,
  never as edits — universal across all nine systems.
- If Umi ever needs **fiscal/e-receipt** compliance (e.g. Mexican CFDI-style requirements), treat the
  fiscal receipt as a **separate mandated document** with its own content/signature rules, distinct from
  the internal sale — the ARTS `RetailTransactionDocument` and the OECD/EU model support this cleanly.

## 14. Reachability and unverified claims

- **Directly fetched and quoted [PRIMARY]:** all Stripe `/api/*` object pages and the receipts page (the
  receipts page localizes; it served Spanish here); all Square object pages; all Shopify Admin GraphQL
  pages; all five QBO entity pages (rendered via headless browser, since Intuit injects the text
  client-side); all NetSuite help pages except the Invoice one-liner; the SAP `/doc/` Document Flow page;
  all six ARTS ODM 7.3 narrative pages; both Xstore pages; the OECD Online Cash Registers PDF; and the EU
  VAT invoicing page.
- **[PRIMARY-SPEC] (spec quoted in place of SPA page):** all Xero facts come from Xero's official
  `XeroAPI/Xero-OpenAPI` `xero_accounting.yaml`, whose `externalDocs` map 1:1 to the `developer.xero.com`
  URLs cited; the live pages are client-rendered SPAs. The one live-page fact confirmed directly was the
  Receipts page title carrying "(Deprecated)". Live-page prose may word things slightly differently than
  the spec's `summary`/`description` fields quoted.
- **[PRIMARY-SNIPPET] (first-party host, SPA body did not render; first-party search snippet used):** the
  SAP S/4HANA Billing Document Type and Credit/Debit Memo definitions; the one-sentence NetSuite Invoice
  definition.
- **Unverified / could not fully confirm:**
  - _Square split-tender per-Tender `receipt_url`:_ confirmed that `receipt_url` exists on `Payment` and
    that an `Order` holds multiple `tenders`; did **not** read a `receipt_url` field on the `Tender`
    object itself. Treat "each tender has its own receipt URL" as likely-but-unconfirmed.
  - _Stripe refund receipt as a fully separate rendered document:_ the receipts page confirms Stripe
    creates receipts for refunds and the `Refund` object has its own `receipt_number`, but the same page
    says the Charge `receipt_url` is "kept up-to-date … including any refunds" — no single sentence
    reconciles whether the refund receipt is a distinct URL or the updated charge URL.
  - _QBO Invoice → literal "Accounts Receivable":_ the Invoice page says the customer "pays … later" and
    links to `Payment`, which implies A/R, but the exact phrase "Accounts Receivable" was not in the
    fetched entity-page body. The A/R behavior is standard but not verbatim-quoted.
  - _Xero cash-sale "which method to use":_ both mechanisms (`ACCREC` invoice + `Payment`; `RECEIVE` bank
    transaction) are verified to exist; no Xero prose prescribing one over the other for a cash sale was
    fetched — the preference is synthesis, not a quote.
- **Could not reach / paywalled (open first-party substitute used):** Oracle Retail Xstore DB/DTV
  technical data-model reference (My Oracle Support); NRF's gated ARTS/POSLog XML schema downloads (the
  OMG Retail Depository ODM 7.3 narrative was used instead, and is sufficient); GS1 EANCOM/EPOS message
  specs (membership/paywalled) — no first-party GS1 receipt-vs-transaction model was reachable, so GS1 is
  omitted rather than sourced secondarily.
