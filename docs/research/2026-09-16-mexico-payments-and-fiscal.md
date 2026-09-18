# Mexico payments and fiscal records for Umi POS

- Date: 2026-09-16.
- Scope: Conekta, Mercado Pago Point, Facturapi, alternative PACs, and the SAT rules for a
  cafe or restaurant in Mexico.
- Method: primary sources only. Each claim carries a source URL. Items that no primary
  source confirmed are marked UNVERIFIED.

## Verdict

1. Conekta does not issue a CFDI for a card payment or an alternative payment.
2. The Conekta documentation mentions CFDI only as a merchant document for account
   activation.
3. Mercado Pago does not issue the CFDI for a Point sale; the seller must issue the invoice.
4. Facturapi can stamp CFDI 4.0, cancel a CFDI, and issue a payment complement.
5. The suspicion of the owner is correct, and this report recommends Facturapi.

## 1. Conekta

### 1.1 Payment methods in Mexico

Conekta lists six methods for one-time charges and three for recurring charges
([payment method table](https://developers.conekta.com/docs/welcome)):

| Method                                     | One-time charge | Recurring charge |
| ------------------------------------------ | --------------- | ---------------- |
| Cards (Visa, Mastercard, American Express) | Yes             | Yes              |
| Cash                                       | Yes             | Yes              |
| SPEI transfer                              | Yes             | Yes              |
| Apple Pay                                  | Yes             | No               |
| Google Pay                                 | Yes             | No               |
| Pago en plazos (BNPL)                      | Yes             | No               |

- **Cards.** Conekta supports three card modes: one-time payment, on-demand charge, and
  subscriptions. The merchant tokenizes the card with the web tokenizer or with a mobile
  SDK, and it sends the returned `token_id` in the `charges` object of the order
  ([cards](https://developers.conekta.com/docs/cargo-bajo-demanda-1),
  [tokenizer](https://developers.conekta.com/docs/tokenizador)).
- **Cash.** Conekta Efectivo uses more than 19,000 payment points. The documented store
  list includes Practicajas BBVA, 7-Eleven, Farmacias del Ahorro, Soriana, Circle K,
  Tiendas Extra, Waldo's, Super Kiosko, and others. The default expiry of the reference
  is 30 days, and the merchant can set the expiry from seconds to 365 days
  ([cash, one-time charge](https://developers.conekta.com/docs/cargo-unico-efectivo-direct-api)).
  The document shows an image with the OXXO name, but the OXXO name is not in the store
  list of that page. This discrepancy is UNVERIFIED.
- **SPEI transfer.** Conekta generates a CLABE reference for one-time and recurring
  charges, and it supports CLABE reuse
  ([one-time](https://developers.conekta.com/docs/cargo-unico-transferencias-direct-api),
  [recurring](https://developers.conekta.com/docs/cargo-recurrente-transferencias-direct-api)).
- **BNPL.** Conekta calls this method "Pago en Plazos". The Conekta Go page names Aplazo
  as the in-person BNPL brand. The BNPL component page does not name the provider
  ([Conekta Go](https://developers.conekta.com/docs/conekta-go),
  [BNPL component](https://developers.conekta.com/docs/cargo-unico-bnpl-component)).
- **Prepaid and other methods.** Conekta also documents Puntos BBVA, debit operations,
  and mixed payments ("multipagos")
  ([index](https://developers.conekta.com/llms.txt)).

### 1.2 API surface

Conekta publishes a REST API with the media type `application/vnd.conekta-v2.3.0+json`. The
authentication reference documents bearer authentication with the private key, and several
API examples use HTTP Basic authentication with the private key as the user name
([authentication](https://developers.conekta.com/reference/autenticaci%C3%B3n),
[cards](https://developers.conekta.com/docs/cargo-bajo-demanda-1)).

| Object    | Endpoint examples                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| Orders    | `POST /orders`, `GET /orders/{id}`, `POST /orders/{id}/capture`, `POST /orders/{id}/cancel`                         |
| Charges   | `POST /orders/{order_id}/charges`, `GET /charges`, `PUT /charges/{id}`                                              |
| Customers | `POST /customers`, `GET /customers`, `POST /customers/{id}/payment_sources`, `POST /customers/{id}/fiscal_entities` |
| Webhooks  | `POST /webhooks`, `GET /webhooks`, `POST /webhook_keys`, `POST /events/{id}/resend`                                 |
| Tokens    | `POST /tokens`                                                                                                      |

Sources: [reference index](https://developers.conekta.com/llms.txt),
[create order](https://developers.conekta.com/reference/createorder),
[refund order](https://developers.conekta.com/reference/orderrefund),
[create customer](https://developers.conekta.com/reference/createcustomer),
[create webhook](https://developers.conekta.com/reference/createwebhook).

Two limits on tokens: the `POST /tokens` endpoint is for PCI-compliant accounts only, and
Conekta recommends the hosted tokenizer or the mobile SDKs for all other merchants
([create token](https://developers.conekta.com/reference/createtoken)).

### 1.3 Idempotency

- Conekta documents idempotency as a **duty of the merchant webhook handler**. The QR page
  states that the handler must store the event `id` and must skip an event that it already
  processed. Conekta retries an event when the handler does not answer with a 2xx code
  ([QR payments](https://developers.conekta.com/docs/pagos-qr)).
- Conekta does **not** document a request idempotency header for order or charge creation.
  A crawl of the 271 pages in the Conekta documentation index found the word "idempotencia"
  only on the QR page
  ([index](https://developers.conekta.com/llms.txt)). UNVERIFIED.
- **Documentation warning.** The published QR page contains an internal review block with
  the text "Security Review Required" and "Do not publish until reviewed". The block also
  asks for confirmation of the `DIGEST` header name. Treat the QR page with caution
  ([QR payments](https://developers.conekta.com/docs/pagos-qr)).

### 1.4 3DS and SCA

Conekta supports 3D Secure 2 for Visa, Mastercard, and American Express. Two modes exist:
Smart mode authenticates only the transactions that the Conekta risk engine marks as
unreliable, and Strict mode authenticates 100 percent of the transactions. The card issuer
decides between the frictionless flow and the challenge flow
([3DS2 summary](https://developers.conekta.com/docs/resumen),
[activate 3DS2](https://developers.conekta.com/docs/activar-3d-secure-2)).

### 1.5 Subscriptions

Conekta documents plans, subscriptions, subscription states, charge retries, webhook
notifications for subscriptions, and a customer self-service portal
([subscriptions index](https://developers.conekta.com/llms.txt),
[create plan](https://developers.conekta.com/reference/createplan),
[subscription list](https://developers.conekta.com/reference/subscriptionlist)).

### 1.6 Refunds and partial refunds

- Full refund: `POST https://api.conekta.io/orders/{order_id}/refunds`. The only required
  parameter is the order ID. The optional parameter `reason` accepts `requested_by_client`,
  `cannot_be_fulfilled`, `duplicated_transaction`, `suspected_fraud`, and `other`.
- Partial refund: the same endpoint with the required `charge_id` and the optional `amount`
  in cents. If the merchant omits `amount`, Conekta refunds the full charge
  ([refund an order](https://developers.conekta.com/docs/reembolsar-orden),
  [refund order reference](https://developers.conekta.com/reference/orderrefund)).
- Events: `order.refunded`, `order.partially_refunded`, and `charge.refunded`
  ([order events](https://developers.conekta.com/docs/order),
  [charge events](https://developers.conekta.com/docs/charge)).

### 1.7 Chargebacks

Conekta classifies chargebacks in three groups: intentional fraud, friendly fraud, and
legitimate disputes. The API allows a merchant to upload evidence files, to read the
accepted evidence types, and to answer a chargeback
([chargebacks](https://developers.conekta.com/docs/qu%C3%A9-son-los-contracargos),
[API representation](https://developers.conekta.com/docs/representacion-de-contracargos-a-traves-de-api),
[upload evidence](https://developers.conekta.com/reference/uploadchargebackfilesbatch)).

### 1.8 Settlement and payout reporting

- `GET /balance` returns `available`, `pending`, and `retention_amount` in MXN
  ([balance](https://developers.conekta.com/docs/consulta-de-balance)).
- Conekta publishes four reports on the report service: payments, invoices, deposits, and
  account status
  ([reports](https://developers.conekta.com/reference/report),
  [payments report](https://developers.conekta.com/reference/payments),
  [deposit report](https://developers.conekta.com/reference/reporte-deposit)).
- Cash withdrawal uses a reference flow, and Conekta cancels and queries a withdrawal
  through the API
  ([cash withdrawals](https://developers.conekta.com/docs/resumen-retiros-efectivo)).
- The "Invoice" report is **not** a fiscal report. The response contains `company_id`,
  `id`, `date`, `amount`, `net`, `commission`, `commission_tax`, `commission_amount`, and
  `status`. The response has no UUID and no receiver RFC
  ([invoice report](https://developers.conekta.com/reference/reporte-invoice)).

### 1.9 Sandbox and test cards

- Conekta separates test keys from production keys. A test key does not process real
  payments ([test API keys](https://developers.conekta.com/docs/api-keys-pruebas)).
- Conekta publishes a sandbox endpoint to simulate an incoming SPEI payment:
  `POST https://api.conekta.io/sandbox/spei/payment_notifications`
  ([sandbox payments](https://developers.conekta.com/docs/realizar-pagos-sandbox)).
- Conekta publishes test card numbers and test token IDs, for example Visa
  `4242424242424242` with token `tok_test_visa_4242`
  ([test cards](https://developers.conekta.com/docs/pruebas-tarjetas)).

### 1.10 Rate limits

Conekta publishes no general API rate limit and no numeric request quota. A crawl of the
271 documentation pages found one documented throttle, and it applies to payout retries
only: one retry for each payout every 60 seconds, and one mass retry for each business
every 5 minutes. That path answers HTTP 429
([payout tracking](https://developers.conekta.com/docs/seguimiento-de-dispersiones)).
The general API rate limit is UNVERIFIED.

### 1.11 Webhook signature verification

- The merchant creates one RSA key pair with `POST https://api.conekta.io/webhook_keys`.
  Conekta keeps the private key and returns the public key.
- Conekta signs a SHA-256 digest of the request body. The signature arrives in the `DIGEST`
  header. The merchant verifies the signature with the public key, for example with
  `openssl dgst -sha256 -verify`.
- The payload encoding is UTF-8.
- A handler must answer with a 2xx code. Otherwise Conekta retries with exponential
  backoff: 13 retries in approximately 24 hours
  ([verify signatures](https://developers.conekta.com/docs/autenticaci%C3%B3n-webhooks),
  [notification retries](https://developers.conekta.com/docs/reintentos-de-notificaci%C3%B3n),
  [HTTP error codes](https://developers.conekta.com/docs/c%C3%B3digos-de-error-http)).

### 1.12 Does Conekta issue a CFDI?

**No.** The primary documentation evidence is as follows.

1. The word "CFDI" appears in the Conekta documentation only as a merchant document type.
   The onboarding page lists the required files for account activation, and one entry is
   `"file_classification": "cfdi"`. The company document reference defines that value as
   "Prueba de situación fiscal" (proof of tax status). Conekta uses the document to verify
   the merchant. It is not a fiscal record of a sale
   ([onboarding API](https://developers.conekta.com/docs/paso-a-paso-para-integrar-el-onboarding-v%C3%ADa-api),
   [upload company document](https://developers.conekta.com/reference/uploadcompanydocument)).
2. The API reference has no stamping endpoint, no UUID field, no CSD upload, and no
   cancellation endpoint
   ([reference index](https://developers.conekta.com/llms.txt)).
3. The Conekta events page names "generar una factura de la compra" as an action that the
   **merchant** can take after the event `charge.paid`. Conekta does not claim that action
   ([events](https://developers.conekta.com/docs/eventos-conekta)).
4. The customer object has a "Fiscal Entity" resource. That resource stores tax data on the
   customer for the merchant
   ([create fiscal entity](https://developers.conekta.com/reference/createcustomerfiscalentities)).
5. The "Reporte Invoice" endpoint returns company-level invoice records. The fields are
   `amount`, `net`, `commission`, `commission_tax`, and `commission_amount`. The response has
   no UUID field and no receiver RFC field
   ([invoice report](https://developers.conekta.com/reference/reporte-invoice)).

Search method: I downloaded all 271 pages of the documentation index
([llms.txt](https://developers.conekta.com/llms.txt)) and searched for "CFDI", "timbre",
and "factura". Result: CFDI appears only in the company document classification and in the
company document reference.

### 1.13 Does Conekta have a terminal or point-of-sale device?

**No card terminal device is documented.** Conekta offers two in-person products, and
neither one is a card terminal.

- **Conekta Go** is a mobile application for alternative payment methods: BNPL, instant
  bank transfer, and digital wallets. The page states that Conekta Go is different from
  traditional point-of-sale solutions, which process cards only. Conekta Go requires manual
  activation by a Customer Success Manager
  ([Conekta Go](https://developers.conekta.com/docs/conekta-go)).
- **QR payments** require the merchant to build the payment screen. The system calls
  `POST /checkouts`, converts the returned payment URL to a QR code, and waits for the
  `order.paid` webhook event ([QR payments](https://developers.conekta.com/docs/pagos-qr)).

Search method: in the 271 downloaded pages, the word "terminal" appears 14 times and only on
the QR page. There, "terminal" means the display device of the merchant, not a Conekta
device.

## 2. Mercado Libre and Mercado Pago Point

### 2.1 Point device models sold in Mexico

The official Mercado Pago store page states that Mercado Pago offers three payment
terminals in Mexico ([store](https://www.mercadopago.com.mx/herramientas-para-vender/lectores-point)):

| Model         | Documented behavior                                          |
| ------------- | ------------------------------------------------------------ |
| Point Smart 2 | Integrated receipt printer, touch screen.                    |
| Point Air     | 4G and Wi-Fi connection, for sales outside a fixed location. |
| Point Mini    | Bluetooth connection to a mobile phone, contactless payment. |

The Point developer documentation lists Point Smart 1 and Point Smart 2 as the terminals
that support the POS integration
([Point overview](https://www.mercadopago.com.mx/developers/en/docs/mp-point/overview)).

### 2.2 The Point integration API

The current integration uses the Orders API. The legacy integration uses the Payment Intents
API, and Mercado Pago publishes a migration guide
([migration guide](https://www.mercadopago.com.mx/developers/en/docs/mp-point/migrate-payment-intent-to-orders),
[legacy documentation](https://www.mercadopago.com.mx/developers/en/docs/mp-point-legacy/overview)).

**Base flow** ([payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing)):

1. `GET https://api.mercadopago.com/terminals/v1/list` returns the terminals of the
   account. The optional query parameters are `store_id` and `pos_id`. The `id` field has
   the format `terminal type + "__" + serial`.
2. `PATCH https://api.mercadopago.com/terminals/v1/setup` sets
   `terminals[].operating_mode` to `PDV`. The other two modes are `STANDALONE` and
   `UNDEFINED`. Only `PDV` accepts API orders and card payments.
3. `POST https://api.mercadopago.com/v1/orders` creates the order.

**Create order request fields** (from the same page and
[create order reference](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/orders/create-order/post)):

| Field                                | Rule                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `type`                               | Required. The value `point` is the only accepted value for Point.                                                       |
| `external_reference`                 | Required. Unique for each order. Maximum 64 characters. Letters, digits, hyphen, and underscore only. No personal data. |
| `transactions.payments[].amount`     | Required. A string with two decimal places, for example `"24.00"`.                                                      |
| `expiration_time`                    | Optional. Minimum `PT30S`, maximum `PT3H`. Default validity is 15 minutes.                                              |
| `config.point.terminal_id`           | Required. The exact value from the terminal list, for example `NEWLAND_N950__N950NCB801293324`.                         |
| `config.point.print_on_terminal`     | Optional. Example value `no_ticket`.                                                                                    |
| `config.payment_method.default_type` | Optional. Example value `credit_card`.                                                                                  |
| `integration_data`                   | Optional. Holds `platform_id`, `integrator_id`, and `sponsor.id`.                                                       |
| `X-Idempotency-Key`                  | **Required header.** A unique value, for example a UUID V4.                                                             |

The created order has the status `created`. The terminal receives the order automatically.
If the terminal does not load the order, the operator presses the Update button or the green
button ([payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing)).

The store and the point of sale are separate objects:
`POST https://api.mercadopago.com/users/{user_id}/stores` and
`POST https://api.mercadopago.com/v2/pos`. Each point of sale accepts one terminal in PDV
mode only
([configure terminal](https://www.mercadopago.com.mx/developers/en/docs/mp-point/configure-terminal)).

**PDV requirements.** The Point documentation states that the store and the point of sale
are necessary for reconciliation, and it warns that incorrect `city_name`, `state_name`,
`latitude`, and `longitude` values can cause errors in tax calculations
([configure terminal](https://www.mercadopago.com.mx/developers/en/docs/mp-point/configure-terminal)).

### 2.3 Card present flow and the integrator model

- Flow: the POS creates the order, the terminal loads the order, the buyer pays on the
  terminal, and the POS receives the status by webhook
  ([Point overview](https://www.mercadopago.com.mx/developers/en/docs/mp-point/overview)).
- Two ownership models exist. In an own integration, the merchant uses its own production
  credentials. In a third-party integration, the integrator acts for a seller and uses
  OAuth credentials
  ([configure terminal](https://www.mercadopago.com.mx/developers/en/docs/mp-point/configure-terminal)).
- The order carries `integration_data.platform_id`, `integration_data.integrator_id`, and
  `integration_data.sponsor.id`. Mercado Pago also documents an Integrator ID and a
  certification process
  ([certifications](https://www.mercadopago.com.mx/developers/en/docs/mp-point-legacy/additional-content/certifications)).

### 2.4 Webhooks and signature

- The merchant selects the **Order (Mercado Pago)** topic in the application panel.
- Events: `order.processed`, `order.canceled`, `order.refunded`, `order.action_required`,
  `order.failed`, and `order.expired`.
- The notification carries the query parameters `data.id` and `type`, a JSON body, and the
  `x-signature` header in the form `ts=<timestamp>,v1=<hash>` plus the `x-request-id`
  header.
- The merchant validates the notification with an HMAC-based signature check. The secret
  key comes from the application panel, and the official SDKs provide a
  `WebhookSignatureValidator`
  ([notifications](https://www.mercadopago.com.mx/developers/en/docs/mp-point/notifications)).

### 2.5 Refunds

- Total refund: `POST https://api.mercadopago.com/v1/orders/{order_id}/refund` with no body.
- Partial refund: the same endpoint with `transactions[].id` and `transactions[].amount`.
  Multiple partial refunds are allowed while the sum does not exceed the total.
- Partial refunds are available for card payments only.
- The refund window is 90 days after the payment
  ([payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing)).

### 2.6 Reconciliation between the terminal and the POS sale

The POS must store these values from the create-order response and from the webhook:

- `id` of the order (format `ORD...`).
- `transactions.payments[].id` (format `PAY...`).
- `external_reference` of the POS sale.
- `transactions.payments[].reference_id` and the `ticket_number` in `config.point`.
- `transactions.payments[].paid_amount`, `refunded_amount`, and `tip_amount`.
- `payment_method.id`, `payment_method.type`, and `installments`.

Source: [payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing),
[notifications](https://www.mercadopago.com.mx/developers/en/docs/mp-point/notifications).

The order query `GET /v1/orders/{order_id}` returns data for orders that are less than three
months old. For older orders, Mercado Pago directs the merchant to customer service
([payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing)).

### 2.7 Known failure modes

The order status flow is
`created -> at_terminal -> processed | failed | action_required | canceled | expired`, and
`processed -> refunded`
([order and transaction status](https://www.mercadopago.com.mx/developers/en/docs/mp-point/resources/status-order-transaction)).

| Status            | Meaning and required action                                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expired`         | The order was not paid inside the validity window. Create a new order.                                                                                                      |
| `action_required` | The terminal did not answer in 40 seconds after the payment start. The status **does not change**. The operator must check the terminal and the POS must update its record. |
| `failed`          | The card issuer declined the payment, or the card data was incorrect, or the risk engine rejected the payment.                                                              |
| `canceled`        | The order was canceled by the API (`canceled_by_api`) or on the terminal (`canceled_on_terminal`).                                                                          |
| `processed`       | The payment was credited.                                                                                                                                                   |

Operational failure modes from the troubleshooting page
([troubleshooting](https://www.mercadopago.com.mx/developers/en/docs/mp-point/resources/troubleshooting)):

- The terminal does not load the order. Cause: a network problem. Action: press Update on the
  terminal, or cancel the order by API.
- The terminal does not change to PDV mode. Action: restart the terminal after each mode
  change.
- The payment API has an interruption. Temporary action: change the terminal to
  `STANDALONE` mode and charge without the API. Then return the terminal to `PDV` mode.
- The refund API fails. Temporary action: refund from the terminal or from the Mercado Pago
  panel.
- A notification topic other than "Order (Mercado Pago)" produces inconsistent alerts.

### 2.8 Does Mercado Pago issue a CFDI for Point sales?

**No. The seller issues the invoice.** Mercado Pago states that the emission of invoices is
not automatic: "La emisión de facturas no es automática, es decir, al realizar una venta,
debes emitir la factura aquí en el emisor de Mercado Pago o en otro sistema" ("The emission
of invoices is not automatic. On a sale, you must issue the invoice here in the Mercado Pago
issuer or in another system").

Source:
[help article: is the invoice tool mandatory?](https://www.mercadolibre.com.mx/ayuda/40282)
(article title: "¿Es obligatorio usar el facturador? ¿Debo facturar todas mis ventas?"),
retrieved through the help search page
[mercadopago.com.mx/ayuda/search?q=facturar mis ventas](https://www.mercadopago.com.mx/ayuda/search?q=facturar%20mis%20ventas).

Two more facts support the answer:

1. A crawl of the Mercado Pago Mexico developer documentation found no CFDI page and no
   stamping endpoint for Point
   ([documentation index](https://www.mercadopago.com.mx/developers/es/docs/llms.txt)).
2. The Point store page describes "facturación" as a benefit of a business account with an
   RFC, not as a per-sale document
   ([store](https://www.mercadopago.com.mx/herramientas-para-vender/lectores-point)).

The exact format of the Mercado Pago invoicing tool is UNVERIFIED because the help article
body did not load through a direct request.

## 3. Facturapi and alternative PACs

### 3.1 CFDI 4.0 stamping API

Facturapi exposes a REST API at `https://www.facturapi.io/v2/` with bearer authentication
([authentication](https://docs.facturapi.io/docs/getting-started/authenticate/)).

Create an income invoice with `POST https://www.facturapi.io/v2/invoices`
([income invoice](https://docs.facturapi.io/docs/guides/invoices/ingreso/)):

| Input                         | Content                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `customer.tax_id`             | RFC of the receiver.                                                              |
| `customer.legal_name`         | Legal name of the receiver.                                                       |
| `customer.tax_system`         | Fiscal regime of the receiver, for example `601`.                                 |
| `customer.address.zip`        | Postal code of the receiver.                                                      |
| `customer.email`              | Email address of the receiver.                                                    |
| `items[].quantity`            | Quantity.                                                                         |
| `items[].product.description` | Description of the good or service.                                               |
| `items[].product.product_key` | SAT ClaveProdServ, for example `60131324`.                                        |
| `items[].product.price`       | Unit price.                                                                       |
| `items[].product.taxes`       | Tax list, for example `{ "type": "IVA", "rate": 0.16 }`.                          |
| `use`                         | SAT Uso CFDI key, for example `G01`.                                              |
| `payment_form`                | SAT Forma de Pago key. The card example uses `"28"`.                              |
| `payment_method`              | `PUE` for one payment or `PPD` for deferred payment.                              |
| `type`                        | `I` income, `E` credit note, or `P` payment.                                      |
| `idempotency_key`             | Optional. Prevents duplicate documents on a retry.                                |
| `external_id`                 | Optional link to a record of the merchant. Facturapi does not enforce uniqueness. |

The unit of measure is optional, and Facturapi supplies SAT catalog lookups for product and
service keys and units
([API reference](https://docs.facturapi.io/api/)).

**The `payment_form` label is inconsistent in the documentation.** The income page marks
`"28"` as "Tarjeta de débito", and the payment page marks `"28"` as "Tarjeta de Crédito".
Confirm the value against the SAT catalog `c_FormaPago` before release. The exact mapping is
UNVERIFIED in this research.

**Date limit.** The invoice `date` cannot be earlier than 72 hours in the past and cannot be
in the future ([API reference](https://docs.facturapi.io/api/)).

### 3.2 Cancellation

- `DELETE https://www.facturapi.io/v2/invoices/{id}?motive=02`
  ([cancellations](https://docs.facturapi.io/docs/guides/invoices/cancelaciones/)).
- Only an invoice with the status `valid` is cancelable. A `draft` invoice is deleted when
  the merchant cancels it.
- SAT motives: `01` errors with a relation (requires `substitution`), `02` errors without a
  relation, `03` the operation did not occur, and `04` a nominative operation in a global
  invoice.
- Cancellation statuses: `canceled` and `cancellation_status: accepted` (finished),
  `valid` and `cancellation_status: pending` (the receiver must accept), and `valid` and
  `cancellation_status: verifying` (the SAT is validating).

### 3.3 Payment complement (REP)

Create a payment complement with `type: "P"` and a `complements` array of type `pago`. Each
entry holds `payment_form` and `related_documents[]` with `uuid`, `amount`, `installment`,
`last_balance`, and `taxes[]` with `base`, `type`, and `rate`. A prior income invoice with
`payment_method: "PPD"` is mandatory
([payment complement](https://docs.facturapi.io/docs/guides/invoices/pago/)).

### 3.4 Sandbox, receipts, and the global invoice

- Test keys start with `sk_test_`. Test webhooks and live webhooks are independent
  ([authentication](https://docs.facturapi.io/docs/getting-started/authenticate/),
  [API reference](https://docs.facturapi.io/api/)).
- The API product has a 14-day free trial with no card
  ([pricing](https://www.facturapi.io/pricing)).
- E-Receipts are non-fiscal sale receipts. Each receipt gives the customer a self-invoice
  page at `https://factura.space/<DOMAIN>/<RECEIPT_KEY>`, and the receipt expires for
  self-invoicing at `expires_at`
  ([receipts](https://docs.facturapi.io/docs/guides/receipts/),
  [self-invoice](https://docs.facturapi.io/docs/guides/self-invoice/)).
- The merchant can create a global invoice from all un-invoiced receipts of a period
  ([receipts](https://docs.facturapi.io/docs/guides/receipts/)).
- Organizations provide multi-RFC operation. One user key creates unlimited issuer
  organizations, and each organization holds its own RFC, series, and CSD
  ([organizations](https://docs.facturapi.io/docs/guides/organizations/)).

### 3.5 Pricing and rate limits

Prices from the official pricing page, retrieved on 2026-09-16
([pricing](https://www.facturapi.io/pricing)), in MXN with IVA included:

| Product                                      | Subscription                        | Consumption                                 |
| -------------------------------------------- | ----------------------------------- | ------------------------------------------- |
| API de facturacion CFDI (multi organization) | $299 MXN per month                  | $0.60 MXN per timbre                        |
| Facturacion web                              | $199 MXN per organization per month | $0.60 MXN per timbre                        |
| E-Receipts and self-invoice                  | $599 MXN per organization per month | $0.40 MXN per receipt, $0.60 MXN per timbre |
| Mass download of CFDI                        | $999 MXN per organization per month | $0.20 MXN per synchronized CFDI             |
| Additional user                              | $99 MXN per user per month          | None                                        |

The pricing page states that the API is multi-RFC without an extra cost for each RFC, that
the merchant pays the consumption in the next monthly invoice, and that the timbres have no
expiration date ("Sin fechas de vencimiento ni folios desperdiciados").

Rate limits: Facturapi applies limits per authenticated identity and answers HTTP 429 with
the error code `rate_limit_exceeded` and a `Retry-After` header. Facturapi does not publish
the numeric thresholds. Test and live environments use the same policy
([rate limits](https://docs.facturapi.io/docs/getting-started/rate-limits/)).

### 3.6 Webhook and status flow

The merchant registers a webhook at
`https://dashboard.facturapi.io/integration/webhooks`
([API reference](https://docs.facturapi.io/api/)).

| Event                                 | Meaning                                                 |
| ------------------------------------- | ------------------------------------------------------- |
| `invoice.status_updated`              | The status of an invoice changed (for example `valid`). |
| `invoice.cancellation_status_updated` | The cancellation status changed.                        |
| `invoice.global_invoice_created`      | A global invoice was created from receipts.             |
| `invoice.created_from_dashboard`      | An operator created an invoice in the dashboard.        |
| `receipt.status_updated`              | The status of a receipt changed.                        |
| `receipt.cancellation_status_updated` | The cancellation status of a receipt changed.           |
| `receipt.self_invoice_complete`       | The customer completed self-invoicing.                  |

Each event carries `id`, `created_at`, `livemode`, `organization`, `type`, and `data`
([API reference](https://docs.facturapi.io/api/)).

Facturapi also publishes a webhook signature validation operation: "Valida la firma de un
evento recibido mediante un Webhook" ("Validates the signature of an event received by a
webhook") ([API reference](https://docs.facturapi.io/api/)).

The invoice status flow for async documents is `pending`, then `valid` after stamping. A
`draft` invoice is not sent to the SAT
([API reference](https://docs.facturapi.io/api/)).

### 3.7 Comparison with two alternative PACs

| Criterion       | Facturapi                                                                                                     | Facturama                                                                                                                                      | SW sapien                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Type            | Layer over an undisclosed PAC                                                                                 | Layer over undisclosed PACs (FreshBooks group)                                                                                                 | Direct PAC                                                                       |
| Multi-RFC model | Organizations, unlimited, no extra cost per RFC ([pricing](https://www.facturapi.io/pricing))                 | API Multiemisor per RFC ([multiemisor](https://apisandbox.facturama.mx/guias/cfdi40/multiemisor))                                              | Distributor model with subaccounts ([developers](https://developers.sw.com.mx/)) |
| API style       | REST and JSON, official Node, .NET, Java, PHP SDKs ([quickstart](https://docs.facturapi.io/docs/quickstart/)) | REST with Basic Auth ([plans](https://facturama.mx/planes-facturacion))                                                                        | REST and SOAP ([developers](https://developers.sw.com.mx/))                      |
| Published price | $299 MXN per month plus $0.60 MXN per timbre ([pricing](https://www.facturapi.io/pricing))                    | API package at $1,650 MXN and $0.50 MXN per additional folio; gift folios expire in 30 days ([plans](https://facturama.mx/planes-facturacion)) | Not published                                                                    |
| Sandbox         | Test keys `sk_test_*`, 14-day trial ([pricing](https://www.facturapi.io/pricing))                             | Sandbox site ([plans](https://facturama.mx/planes-facturacion))                                                                                | Test service `services.test.sw.com.mx` (UNVERIFIED in this research)             |
| CSD custody     | The organization uploads the CSD ([API reference](https://docs.facturapi.io/api/))                            | The merchant uploads the CSD                                                                                                                   | The merchant uploads the CSD                                                     |

Observed reliability issue: the Finkok documentation wiki served an invalid TLS certificate
on 2026-09-16, so the wiki did not open with normal certificate validation
([wiki.finkok.com](https://wiki.finkok.com/home/certificados)).

**Recommendation: Facturapi.** The reasons are as follows.

1. The "Organizations" object matches the Umi tenancy model: one Umi account, one
   organization for each cafe, and no extra cost for each RFC
   ([organizations](https://docs.facturapi.io/docs/guides/organizations/),
   [pricing](https://www.facturapi.io/pricing)).
2. The product set matches the requirement: stamping, cancellation, REP, non-fiscal
   receipts, self-invoice page, and global invoice
   ([receipts](https://docs.facturapi.io/docs/guides/receipts/),
   [self-invoice](https://docs.facturapi.io/docs/guides/self-invoice/),
   [payment complement](https://docs.facturapi.io/docs/guides/invoices/pago/)).
3. The stack is REST and JSON with an official TypeScript SDK, and Umi is a TypeScript
   monorepo ([quickstart](https://docs.facturapi.io/docs/quickstart/)).
4. The price is public and the billing is deferred
   ([pricing](https://www.facturapi.io/pricing)).

**Fallback: SW sapien, then Finkok.** Both are direct PACs. A direct PAC removes the
dependency on one undisclosed stamping provider, and it can hold the CSD custody decision in
the Umi account ([developers.sw.com.mx](https://developers.sw.com.mx/),
[wiki.finkok.com](https://wiki.finkok.com/home/certificados)).

The identity of the PAC behind Facturapi is UNVERIFIED. Facturapi does not name it.

## 4. The money path for a cafe

### 4.1 The SAT rules that matter

**When a CFDI is required.** Article 29 of the Codigo Fiscal de la Federacion (CFF) states
that a taxpayer must issue a fiscal record through the SAT when the tax laws establish the
obligation, and that the receiver of a service must request the CFDI. Article 29-A,
fraccion IV, second paragraph states that when the receiver has no RFC key, the receiver
field uses the generic key and the operation counts as a sale to the public in general
([CFF](https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf), consolidated text with the
last reform of 09-04-2026).

**The deadline.** Article 39 of the Reglamento del CFF states that the taxpayer must send the
CFDI to the SAT or to the authorized certification provider no later than 24 hours after the
operation ([Reglamento del CFF](https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_CFF.pdf)).

**The global invoice for public sales.** Rule 2.7.1.21 of the Resolucion Miscelanea Fiscal
(RMF) 2026 states the following
([RMF 2026, DOF 28 December 2025](https://dof.gob.mx/nota_detalle.php?codigo=5777217),
[PDF](https://dof.gob.mx/2025/SHCP/SHCP_281225_01.pdf), pages 109 and 110):

1. The taxpayer can create one CFDI for a day, a week, or a month. The CFDI holds the amount
   of each operation with the public in general and the folio or operation number of each
   public receipt.
2. The taxpayer must send the global CFDI to the SAT or the certification provider no later
   than 24 hours after the close of the operations of the chosen period.
3. The global CFDI must separate the IVA and the IEPS.
4. A public receipt is not mandatory for an operation below $100.00 MXN when the buyer does
   not request one.
5. The taxpayer uses the generic RFC key of rule 2.7.1.23 for these operations.

The same rule allows a bimonthly period for a physical person in the former RIF regime. The
rule states that a physical person in the RESICO regime must report only the total amount of
the month ([RMF 2026](https://dof.gob.mx/2025/SHCP/SHCP_281225_01.pdf)).

**The generic RFC keys.** Rule 2.7.1.23 states that the generic key is `XAXX010101000` for a
national operation without an RFC, and `XEXX010101000` for a foreign resident without an
RFC. Rule 2.7.1.45 states that the operation counts as a sale to the public in general when
the `Rfc` field of the `Receptor` node holds `XAXX010101000`
([RMF 2026](https://dof.gob.mx/2025/SHCP/SHCP_281225_01.pdf)).

**Excluded taxpayers.** The global invoice is a facility. Some taxpayers cannot use it
(rule 2.6.1.2 of the RMF 2026, referenced by rule 2.7.1.21)
([RMF 2026](https://dof.gob.mx/2025/SHCP/SHCP_281225_01.pdf)).

**Cancellation.** Rule 2.7.1.34 states that the issuer requests the cancellation through the
SAT Portal, that the receiver has three days to accept or refuse, and that silence means
acceptance. Rule 2.7.1.35 states that the issuer can cancel without the receiver acceptance
when the total of the CFDI is up to $1,000.00 MXN, and in a few other cases
([RMF 2026](https://dof.gob.mx/2025/SHCP/SHCP_281225_01.pdf)).

The last rule matters for a cafe, because most single-ticket amounts are below $1,000.00 MXN.

### 4.2 The path, step by step

| Step            | What happens                                                                                             | Who owns the record                    |
| --------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1. Order        | The POS or the API creates the sale with lines, total, tax, and tip.                                     | Umi API (`merchant` schema).           |
| 2. Tender       | The operator picks one tender: card on the Point terminal, Conekta online method, or cash.               | Umi API.                               |
| 3. Capture      | The provider captures the payment. The POS stores the provider order ID and the payment ID.              | The provider, mirrored in the Umi API. |
| 4. Tip          | The Point terminal returns `tip_amount` inside the payment object.                                       | Umi API.                               |
| 5. Fiscal stamp | The Umi API calls Facturapi. The CFDI belongs to the merchant organization, not to Umi.                  | The merchant (issuer) and the SAT.     |
| 6. Refund       | The Umi API calls the provider refund endpoint, then cancels or substitutes the CFDI.                    | The provider and the SAT.              |
| 7. Cancellation | The Umi API cancels the CFDI with a SAT motive, and it substitutes the CFDI when the motive is 01.       | The SAT.                               |
| 8. Shift close  | The operator counts the drawer. The system stores the expected cash, the counted cash, and the variance. | Umi API.                               |
| 9. Period close | The API creates one global CFDI for the public receipts of the period, within 24 hours after the close.  | The merchant and the SAT.              |

**Where the fiscal document is created.** The fiscal document is created at step 5, in the
Facturapi API, for the RFC of the merchant organization. Conekta and Mercado Pago do not
create it (see sections 1.12 and 2.8).

**Who owns the fiscal document.** The merchant owns the CFDI, because the merchant is the
issuer in the `Emisor` node. The SAT owns the folio and the digital seal of the SAT
([CFF article 29](https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf)).

**The order of operations.** The payment capture and the fiscal stamp are separate steps.
A capture can succeed and a stamp can fail. The POS must show the sale as paid, and it must
show the fiscal record as pending, because the money arrived.

### 4.3 What the POS must store

The POS and the API must store these objects:

| Object            | Fields                                                                                                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sale`            | `id`, `external_reference`, `currency`, `subtotal`, `tax_total`, `tip_total`, `total`, `status`, `opened_by`, `shift_id`, `created_at`                                                                                                                            |
| `sale_line`       | `sale_id`, `item_id`, `quantity`, `unit_price`, `tax_rate`, `product_key` (SAT ClaveProdServ), `unit_key` (SAT ClaveUnidad)                                                                                                                                       |
| `tender`          | `sale_id`, `method` (`card_present`, `card_online`, `cash`, `spei`, `cash_store`, `bnpl`), `provider`, `amount`, `tip_amount`, `status`                                                                                                                           |
| `provider_order`  | `provider`, `provider_order_id`, `provider_payment_id`, `idempotency_key`, `terminal_id`, `store_id`, `pos_id`, `status`, `status_detail`, `expires_at`, `raw_response_hash`                                                                                      |
| `webhook_event`   | `provider`, `provider_event_id`, `type`, `received_at`, `signature_valid`, `processed_at`, `payload`                                                                                                                                                              |
| `fiscal_document` | `sale_id`, `provider`, `organization_id`, `invoice_id`, `uuid`, `series`, `folio_number`, `status`, `cancellation_status`, `cancellation_motive`, `substitution_uuid`, `payment_form`, `payment_method`, `use`, `tax_total`, `stamped_at`, `pdf_path`, `xml_path` |
| `fiscal_receipt`  | `sale_id`, `receipt_key`, `self_invoice_url`, `status` (`open`, `invoiced`, `canceled`), `expires_at`                                                                                                                                                             |
| `global_invoice`  | `period_type` (`daily`, `weekly`, `monthly`), `period_start`, `period_end`, `receipt_keys[]`, `invoice_id`, `uuid`, `iva_total`, `ieps_total`, `stamped_at`                                                                                                       |
| `refund`          | `sale_id`, `provider`, `provider_refund_id`, `amount`, `reason`, `status`, `fiscal_action` (`cancel`, `substitute`, `none`)                                                                                                                                       |
| `cash_shift`      | `id`, `opened_at`, `closed_at`, `expected_cash`, `counted_cash`, `variance`, `card_total`, `online_total`, `cash_total`, `tips_total`                                                                                                                             |
| `settlement_line` | `provider`, `report_id`, `provider_payment_id`, `gross`, `fee`, `net`, `currency`, `settlement_date`, `matched_sale_id`                                                                                                                                           |

## 5. Failure model

### 5.1 Three outcomes for one payment attempt

| Outcome | Condition                                                                       | Required action                                                                      |
| ------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Success | The provider confirms the capture.                                              | Mark the tender as paid. Start the fiscal stamp.                                     |
| Failure | The provider refuses the payment, or the order reaches `expired`.               | Mark the tender as failed. Create a new order for a new attempt.                     |
| Unknown | The POS has no confirmation inside the timeout, or the webhook does not arrive. | Mark the tender as pending. Resolve with the provider status query and the terminal. |

### 5.2 Terminal timeout

On Mercado Pago Point, a payment that does not finish inside 40 seconds moves to
`action_required` with the detail `check_on_terminal`. The documentation states that this
status **does not change**
([order and transaction status](https://www.mercadopago.com.mx/developers/en/docs/mp-point/resources/status-order-transaction)).

The resolution procedure is as follows.

1. Read the terminal screen. The terminal shows the real result of the payment.
2. Query `GET https://api.mercadopago.com/v1/orders/{order_id}` and read the order status
   and the payment status.
3. If the payment is `processed` with the detail `accredited`, mark the tender as paid.
   Use the stored `provider_order_id` and `provider_payment_id`. Do not create a new order.
4. If the payment is `failed`, `canceled`, or `expired`, mark the tender as failed and create
   a new order with a **new** `X-Idempotency-Key`.
5. Never create a second order for the same sale while the first order can still be paid.
   The default validity is 15 minutes, and the maximum is 3 hours
   ([payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing)).

### 5.3 Lost webhook

The webhook is a notification, not the source of truth. The resolution procedure is as
follows.

1. The POS keeps the tender in the `pending` state after the create-order call.
2. On webhook receipt, the API stores the event, verifies the signature, and marks the event
   as processed.
3. A background job queries the provider for every tender that stays in `pending` beyond a
   set interval. The job uses the stored provider IDs.
4. When the job reads a final status, the job updates the tender. The later webhook must not
   change the result, because the handler is idempotent.

Mercado Pago retries the notification, and a handler must answer with a 2xx code
([notifications](https://www.mercadopago.com.mx/developers/en/docs/mp-point/notifications)).

Conekta retries 13 times in approximately 24 hours, and a handler must answer with a 2xx code
([notification retries](https://developers.conekta.com/docs/reintentos-de-notificaci%C3%B3n)).

### 5.4 The exact idempotency mechanism of each provider

| Provider           | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mercado Pago Point | `X-Idempotency-Key` header. The create-order table marks the header as Required, and the cancel-order, refund-order, and create-pos examples use the same header with a unique value such as a UUID V4 ([payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing), [configure terminal](https://www.mercadopago.com.mx/developers/en/docs/mp-point/configure-terminal)). |
| Conekta            | No documented request key. The merchant must store the webhook event `id` and must skip an event that it already processed ([QR payments](https://developers.conekta.com/docs/pagos-qr)).                                                                                                                                                                                                                          |
| Facturapi          | The `idempotency_key` field on the invoice request: "Identificador unico que puedes usar para evitar duplicados al reintentar una peticion" ([API reference](https://docs.facturapi.io/api/)).                                                                                                                                                                                                                     |
| Facturapi webhook  | Store the event `id` from the notification body and process each `id` one time ([API reference](https://docs.facturapi.io/api/)).                                                                                                                                                                                                                                                                                  |

### 5.5 The rule that prevents a double charge

One sale has one `idempotency_key` for one provider and one attempt. A new attempt gets a new
key and a new `external_reference`. The database holds a unique index on
`(provider, idempotency_key)` and on `(provider, external_reference)`. A repeated request
returns the stored object, and the API does not create a second order.

For Mercado Pago Point, the terminal also holds the order. Two live orders for one table
give two possible charges. The POS must block a second order while the first order is in
`created`, `at_terminal`, or `action_required`.

## Capability table

| Capability                    | Conekta                                  | Mercado Pago Point                | Facturapi                                                      | Alternative (direct PAC)                       |
| ----------------------------- | ---------------------------------------- | --------------------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| In-person card acceptance     | No device documented                     | Yes, Point terminal in PDV mode   | Not applicable                                                 | Not applicable                                 |
| In-person alternative methods | Yes, Conekta Go and QR                   | Card only in PDV mode             | Not applicable                                                 | Not applicable                                 |
| Online card payments          | Yes, with 3DS2                           | Yes, with Checkout products       | Not applicable                                                 | Not applicable                                 |
| Issues a CFDI                 | No                                       | No                                | Yes, CFDI 4.0                                                  | Yes (SW sapien, Finkok)                        |
| CFDI cancellation             | No                                       | No                                | Yes, motives 01 to 04                                          | Yes                                            |
| Payment complement (REP)      | No                                       | No                                | Yes, `type: "P"`                                               | Yes                                            |
| Non-fiscal sale receipt       | No                                       | Terminal ticket                   | Yes, E-Receipt                                                 | Varies                                         |
| Global invoice from receipts  | No                                       | No                                | Yes                                                            | Varies                                         |
| Full refund                   | Yes                                      | Yes                               | Not applicable (cancellation)                                  | Not applicable                                 |
| Partial refund                | Yes, with `amount`                       | Yes, card only, 90-day window     | Not applicable                                                 | Not applicable                                 |
| Chargebacks                   | Yes, with evidence upload                | Yes, chargeback API               | Not applicable                                                 | Not applicable                                 |
| Provider request idempotency  | Not documented (UNVERIFIED)              | Yes, `X-Idempotency-Key` required | Yes, `idempotency_key`                                         | Varies                                         |
| Webhook signature check       | Yes, RSA SHA-256 in the `DIGEST` header  | Yes, HMAC in `x-signature`        | Yes, validation operation                                      | Varies                                         |
| Webhook retry policy          | 13 retries in about 24 hours             | Retries on non-2xx                | Documented event model, retry count not published (UNVERIFIED) | Varies                                         |
| Published general rate limits | No general limit published               | No general limit published        | Policy published, thresholds not published                     | Varies                                         |
| Sandbox                       | Test keys, sandbox endpoints, test cards | Test accounts, test credentials   | `sk_test_*`, 14-day trial                                      | Varies                                         |
| Published price               | Not verified in this research            | Terminal prices only              | $299 MXN per month plus $0.60 per timbre                       | Facturama $1,650 MXN package; SW not published |
| Multi-RFC model               | Not applicable                           | One seller account                | Organizations, unlimited                                       | Facturama multiemisor, SW subaccounts          |

## Implementation design

### Step 1. Activate the accounts

1. Create one Facturapi account for Umi. Create one Facturapi organization for each cafe.
   Store `organization_id`, the RFC, the fiscal regime, the postal code, the series, and the
   CSD ([organizations](https://docs.facturapi.io/docs/guides/organizations/)).
2. Create the Mercado Pago application, the store, the point of sale, and the terminal
   association. Set the terminal to `PDV`
   ([configure terminal](https://www.mercadopago.com.mx/developers/en/docs/mp-point/configure-terminal)).
3. Register the webhook topics. Use the Order topic for Point, and register the Facturapi
   events ([notifications](https://www.mercadopago.com.mx/developers/en/docs/mp-point/notifications),
   [Facturapi API](https://docs.facturapi.io/api/)).
4. Store the secrets in the secret manager, not in the database: the Conekta private key,
   the Mercado Pago access token, the Facturapi live key, the webhook secret of Mercado
   Pago, and the Facturapi webhook secret.

### Step 2. Create the order in the POS

1. The POS writes the `sale`, the `sale_line` rows, and the `tender` row in the Umi API.
2. The API builds `external_reference` from the Umi sale ID and the attempt number.
3. The API stores `product_key` and `unit_key` for each line, so the fiscal step needs no new
   product mapping.

### Step 3. Capture the payment

1. The API creates one UUID V4 and stores it as `provider_order.provider_idempotency_key`.
2. The API calls `POST https://api.mercadopago.com/v1/orders` with `type: "point"` and the
   stored idempotency key.
3. The API stores `provider_order_id`, `provider_payment_id`, `terminal_id`,
   `external_reference`, `expires_at`, and `status`.
4. The POS shows the pending state and the amount.

### Step 4. Handle the result

1. The webhook handler verifies the signature, stores the `webhook_event`, and answers 200.
2. The handler updates the `tender` and the `provider_order` in one transaction.
3. The handler compares `event.id` with the stored `provider_event_id`. A duplicate event
   stops at the store step.
4. The reconciliation job queries the provider for every tender in `pending` beyond the
   timeout, and it applies the final status.

### Step 5. Stamp the fiscal record

1. The API calls `POST https://www.facturapi.io/v2/invoices` with
   `idempotency_key = <sale_id>-<attempt>`.
2. The API sends `customer.tax_id`, `customer.legal_name`, `customer.tax_system`,
   `customer.address.zip`, `items[]`, `use`, `payment_form`, and `payment_method: "PUE"`.
3. The API stores `fiscal_document.invoice_id`, `uuid`, `status`, `tax_total`, the PDF, and
   the XML.
4. When the customer does not give fiscal data, the API creates an E-Receipt instead, and it
   stores `fiscal_receipt.receipt_key` and `self_invoice_url`.
5. The API listens for `invoice.status_updated` and
   `receipt.self_invoice_complete`.

### Step 6. Close the period

1. The API selects every E-Receipt with the status `open` for the period.
2. The API creates one global CFDI for those receipts, with the generic RFC key.
3. The API sends the global CFDI to the SAT inside 24 hours after the close of operations of
   the period ([RMF 2026 rule 2.7.1.21](https://dof.gob.mx/2025/SHCP/SHCP_281225_01.pdf)).
4. The API stores `global_invoice.invoice_id` and `uuid`, and it marks each receipt as
   `invoiced`.

### Step 7. Handle a refund or a cancellation

1. The API calls the provider refund endpoint with a new idempotency key.
2. The API stores the `refund` row and the provider refund ID.
3. The API cancels the CFDI with `motive=03` when the operation did not occur, or with
   `motive=01` plus `substitution` when the merchant issues a corrected CFDI.
4. The API waits for `invoice.cancellation_status_updated`. The status `pending` means the
   receiver must accept, and `verifying` means the SAT is validating.

### Step 8. Close the cash shift

1. The operator counts the drawer and enters the counted amount.
2. The API sums the tenders by method for the shift: card, online, cash, tips.
3. The API stores `cash_shift.expected_cash`, `counted_cash`, and `variance`.
4. Card settlement arrives later. The API matches each `settlement_line` to a `sale` with
   `provider_payment_id`.

## Open questions

1. Does Conekta offer a request idempotency key that the public documentation does not
   describe? UNVERIFIED. Ask the Conekta integration team.
2. Does the Conekta cash network include OXXO? The page shows an OXXO image and a store list
   without OXXO. UNVERIFIED.
3. What is the general API rate limit of Conekta and of Mercado Pago Point? UNVERIFIED.
4. Which SAT `c_FormaPago` value applies to each payment method? The Facturapi
   documentation labels `"28"` in two different ways. UNVERIFIED.
5. What is the fiscal treatment of a voluntary tip in a restaurant? The CFF, the Reglamento
   del CFF, and the RMF 2026 text that this research retrieved do not use the word "propina".
   UNVERIFIED. Ask a Mexican tax advisor.
6. Does the Mercado Pago invoicing tool issue a CFDI 4.0 for a Point sale, and what is its
   price? The help article body did not load directly. UNVERIFIED.
7. Which PAC stamps the Facturapi documents? Facturapi does not name it. UNVERIFIED.
8. Does Mercado Pago Point support tips in the API for every terminal model? The payment
   object contains `tip_amount`, but the Point overview marks the tip row with a hyphen
   ([overview](https://www.mercadopago.com.mx/developers/en/docs/mp-point/overview)).
   UNVERIFIED.
9. Which Point models accept API orders? The overview lists Point Smart 1 and Point Smart 2.
   The store sells Point Smart 2, Point Air, and Point Mini. UNVERIFIED for Point Air and
   Point Mini.
10. What is the SW sapien price and sandbox address for Mexico? Not published.
    UNVERIFIED.
11. Does the SAT "portal" cancellation path need a FIEL or only the advanced electronic
    signature of the issuer? The RMF text says "a traves del Portal del SAT" without a
    method. UNVERIFIED.

## Pages that blocked this research

- `https://www.sat.gob.mx/consultas/91589/conoce-la-factura-electronica` answered HTTP 403.
- `https://www.sat.gob.mx/consultas/60248/factura-global` answered HTTP 403.
- `https://www.sat.gob.mx/consultas/39938/resolucion-miscelanea-fiscal-2026` answered HTTP 403.
- `https://help.conekta.com/` answered HTTP 403, and `support.conekta.com` did not resolve.
- `https://wiki.finkok.com/home/certificados` served an invalid TLS certificate.

Attempts: direct requests with a desktop browser user agent and full navigation headers,
headless Chromium with a render budget, and the `r.jina.ai` text reader. All SAT attempts
returned the same access gateway error page. The SAT content in this report comes from the
official consolidated CFF and Reglamento del CFF texts of the Camara de Diputados, and from
the DOF publication of the RMF 2026.

## Primary sources

Conekta:

- https://developers.conekta.com/llms.txt
- https://developers.conekta.com/docs/welcome
- https://developers.conekta.com/docs/conekta-go
- https://developers.conekta.com/docs/pagos-qr
- https://developers.conekta.com/docs/cargo-unico-efectivo-direct-api
- https://developers.conekta.com/docs/cargo-unico-bnpl-component
- https://developers.conekta.com/docs/reembolsar-orden
- https://developers.conekta.com/docs/qu%C3%A9-son-los-contracargos
- https://developers.conekta.com/docs/consulta-de-balance
- https://developers.conekta.com/docs/seguimiento-de-dispersiones
- https://developers.conekta.com/docs/pruebas-tarjetas
- https://developers.conekta.com/docs/realizar-pagos-sandbox
- https://developers.conekta.com/docs/autenticaci%C3%B3n-webhooks
- https://developers.conekta.com/docs/reintentos-de-notificaci%C3%B3n
- https://developers.conekta.com/docs/eventos-conekta
- https://developers.conekta.com/docs/paso-a-paso-para-integrar-el-onboarding-v%C3%ADa-api
- https://developers.conekta.com/reference/uploadcompanydocument
- https://developers.conekta.com/reference/reporte-invoice
- https://developers.conekta.com/reference/createorder
- https://developers.conekta.com/reference/orderrefund
- https://developers.conekta.com/reference/subscriptionlist

Mercado Pago:

- https://www.mercadopago.com.mx/developers/es/docs/llms.txt
- https://www.mercadopago.com.mx/developers/en/docs/mp-point/overview
- https://www.mercadopago.com.mx/developers/en/docs/mp-point/configure-terminal
- https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing
- https://www.mercadopago.com.mx/developers/en/docs/mp-point/notifications
- https://www.mercadopago.com.mx/developers/en/docs/mp-point/resources/status-order-transaction
- https://www.mercadopago.com.mx/developers/en/docs/mp-point/resources/troubleshooting
- https://www.mercadopago.com.mx/developers/en/docs/mp-point/migrate-payment-intent-to-orders
- https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/orders/create-order/post
- https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/orders/refund-order/post
- https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/terminals/get-terminals/get
- https://www.mercadopago.com.mx/herramientas-para-vender/lectores-point
- https://www.mercadolibre.com.mx/ayuda/40282
- https://www.mercadopago.com.mx/ayuda/search?q=facturar%20mis%20ventas

Facturapi and alternative PACs:

- https://docs.facturapi.io/api/
- https://docs.facturapi.io/docs/quickstart/
- https://docs.facturapi.io/docs/getting-started/authenticate/
- https://docs.facturapi.io/docs/getting-started/rate-limits/
- https://docs.facturapi.io/docs/guides/organizations/
- https://docs.facturapi.io/docs/guides/invoices/ingreso/
- https://docs.facturapi.io/docs/guides/invoices/pago/
- https://docs.facturapi.io/docs/guides/invoices/cancelaciones/
- https://docs.facturapi.io/docs/guides/receipts/
- https://docs.facturapi.io/docs/guides/self-invoice/
- https://www.facturapi.io/pricing
- https://facturama.mx/planes-facturacion
- https://apisandbox.facturama.mx/guias/cfdi40/multiemisor
- https://developers.sw.com.mx/
- https://wiki.finkok.com/home/certificados

SAT and DOF:

- https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf
- https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_CFF.pdf
- https://dof.gob.mx/nota_detalle.php?codigo=5777217
- https://dof.gob.mx/2025/SHCP/SHCP_281225_01.pdf

Related Umi research:

- [2026-09-08 PAC comparison](./2026-09-08-cfdi-pac-provider-comparison.md)
- [2026-09-07 shift close vs reporting day](./2026-09-07-shift-close-vs-reporting-day-research.md)
