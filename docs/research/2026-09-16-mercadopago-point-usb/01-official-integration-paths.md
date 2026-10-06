# Mercado Pago Point: the official integration paths for a third-party POS

- Date: 2026-09-16 (local, America/Mazatlan). Server responses carry the 2026-09-17 UTC date.
- Scope: what Mercado Pago officially allows a third-party POS to do with a Point terminal.
  This file answers six questions before we touch hardware.
- Method: primary sources first. Every claim carries a label and a URL. The rung numbers
  follow `docs/agents/tool-and-research-doctrine.md`.
- Related files: `02-usb-observation-procedure.md` (host observation), and the sibling
  notes `03-*` and `04-*`.

Labels used in this file:

| Label                  | Meaning                                          |
| ---------------------- | ------------------------------------------------ |
| Documented fact        | A primary source states it. The URL is here.     |
| Source-backed tradeoff | Two sources disagree, or a source states a cost. |
| Inference              | I reason from documented facts.                  |
| UNVERIFIED             | No primary source confirmed it.                  |

## Verdict

1. The only supported way for a third-party POS to charge a Point terminal is the
   Mercado Pago **Orders API** over HTTPS, with `type: "point"` and `config.point.terminal_id`.
   The doc calls this the recommended integration. Documented fact.
2. The older **Point Integration API** (payment intents) still works, and Mercado Pago
   marks it deprecated. New work must not use it. Documented fact.
3. There is **no documented USB or Bluetooth protocol** for a host operating system to
   drive a Point terminal. Mercado Pago documents the opposite for its own SmartApps:
   the USB port and the Bluetooth permissions are restricted. Documented fact.
4. The terminal must be paired to the correct Mercado Pago account and set to `PDV`
   mode. One point of sale accepts one terminal. Documented fact.
5. A physical terminal cannot take real test payments. Mercado Pago offers a virtual
   terminal (`SBX0000001`) plus a status simulation endpoint instead. Documented fact.
6. Mexico card-present pricing is 3.5 percent plus IVA per sale, with no monthly rent.
   Documented fact (vendor page, read 2026-09-16).

## Step 0. Tool selection

| Question                              | Answer                                                                                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does a proven tool already do this?   | Yes. The Mercado Pago Orders API is the product. No hand-rolled protocol is needed.                                                                                         |
| Is it installed here?                 | Not applicable to an HTTP API. `curl` 8.5.0, `node` v22.23.2, `rg`, and the repo `playwright` 1.62.1 are present.                                                           |
| Can an agent drive it with no prompt? | Yes. Every doc page has a `.md` twin. `curl https://www.mercadopago.com.mx/developers/en/docs/mp-point/overview.md` returns Markdown.                                       |
| What does adoption cost?              | A Mercado Pago seller account, an application in the developer panel, a physical Point terminal, and the Orders API work.                                                   |
| What is the fallback?                 | The official Mercado Pago MCP server (`https://mcp.mercadopago.com/mcp`) and the official plugin repository. Both need authentication. The `.md` route works without a key. |

Two extra tools exist and are worth naming. Mercado Pago publishes an MCP server at
`https://mcp.mercadopago.com/mcp`, and an official plugin repository at
`github.com/mercadopago/mercadopago-claude-marketplace`. The MCP server answers with
`401 Authentication failed` without a token, so it is a KEY route.

Source: [MCP setup](https://www.mercadopago.com.mx/developers/en/docs/mcp-server/overview.md),
[plugin repository](https://github.com/mercadopago/mercadopago-claude-marketplace).

## 1. Which Point products exist, and what each one offers a third-party POS

### 1.1 The Point family

The official Mexico store lists three Point terminals. It also lists two phone-based
products on a separate line.

| Product                         | What the official page states                                       | Point integration through the API        |
| ------------------------------- | ------------------------------------------------------------------- | ---------------------------------------- |
| Point Smart 2                   | Touch screen, integrated receipt printer.                           | Yes. Documented fact.                    |
| Point Air                       | 4G and WiFi, to sell anywhere.                                      | UNVERIFIED. Not in the integration list. |
| Point Mini                      | Connects by Bluetooth to your phone.                                | UNVERIFIED. Not in the integration list. |
| Point Smart 1                   | Listed in the docs as an integration-capable terminal (`PAX_A910`). | Yes. Documented fact.                    |
| Point Tap, Tap to Pay on iPhone | Phone as the reader. Separate product line.                         | Not a Point terminal. Documented fact.   |

Source: [Mexico store, "Terminales Point"](https://www.mercadopago.com.mx/herramientas-para-vender/lectores-point),
read 2026-09-16. Source for the integration list:
[Point overview](https://www.mercadopago.com.mx/developers/en/docs/mp-point/overview.md).

Point Smart 1 and Point Smart 2 map to two hardware identifiers. The terminal list
endpoint says: "The only terminals allowed for this request are NEWLAND_N950 and
PAX_A910." The SmartApp restrictions page states that Point Smart A910 runs Android 6
and Point Smart N950 runs Android 12. Inference: `PAX_A910` is Point Smart 1 and
`NEWLAND_N950` is Point Smart 2.

Source: [Get list of terminals](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/terminals/get-terminals/get.md),
[SmartApp restrictions](https://www.mercadopago.com.mx/developers/en/docs/smartapps/restrictions.md).

Full model list such as Point Plus, Point Pro, or Point Smart (first generation) is
UNVERIFIED for Mexico today. Those names do not appear on the Mexico store page, and
they do not appear in the current Point documentation.

### 1.2 The integration mechanisms

Mercado Pago offers two integration mechanisms to a third party.

| Mechanism                   | Who runs the code                                | What it does                                                                                | Source                                                                                                 |
| --------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Orders API, `type: "point"` | Your POS backend                                 | Creates an order for a named terminal. The terminal shows the amount and captures the card. | [Payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing.md) |
| SmartApps SDK               | Your Android application, on the terminal itself | Your app becomes the terminal interface. The Mercado Pago SDK runs the payment flow.        | [SmartApps overview](https://www.mercadopago.com.mx/developers/en/docs/smartapps/overview.md)          |

The QR Code product is a third mechanism. It is a different product, and it needs no
terminal. Source: [products reference](https://github.com/mercadopago/mercadopago-claude-marketplace/blob/main/plugins/mercadopago/skills/mp-integrate/references/products.md).

### 1.3 Countries

- Point terminals are available in Argentina, Brazil, and Mexico. Documented fact.
  Source: [llms.txt for Mexico](https://www.mercadopago.com.mx/developers/es/llms.txt):
  "Point not available in MCO, MPE, MLU."
- The OpenAPI specification adds Chile for the terminal print actions
  (`PRINT_DTE`, a Chilean tax document). Source-backed tradeoff: the availability table
  above does not list Chile for Point, and the specification does.
  Source: [openapi repository, `spec3.yaml`](https://github.com/mercadopago/openapi/blob/main/spec3.yaml).
- Mexico is in scope. The Point order payload uses the country code `MEX`.
  Source: [Payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing.md).

## 2. The Point APIs: endpoints, auth, lifecycle, notifications

### 2.1 Two API generations

| Generation            | Base path                       | State                         |
| --------------------- | ------------------------------- | ----------------------------- |
| Orders API            | `/v1/orders`, `/terminals/v1/*` | Recommended. Documented fact. |
| Point Integration API | `/point/integration-api/*`      | Deprecated. Documented fact.  |

The legacy page carries this banner: "Mercado Pago is evolving the way we integrate, and
we're now offering a new API for integrations with Mercado Pago Point, which will
replace the current one."

Source: [Legacy payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point-legacy/integration-configuration/integrate-with-pdv/payment-processing.md).

### 2.2 Authentication

- Server-side calls use a private Access Token in the header
  `Authorization: Bearer <ACCESS_TOKEN>`. Documented fact.
  Source: [Point credentials](https://www.mercadopago.com.mx/developers/en/docs/mp-point/resources/credentials.md).
- For your own store, the token comes from the application in Your integrations.
- For a third party, you obtain the token with OAuth, authorization code flow, at
  `POST https://api.mercadopago.com/oauth/token`. The token lasts 180 days. Documented fact.
  Source: [Go to production](https://www.mercadopago.com.mx/developers/en/docs/mp-point/go-to-production.md).
- `X-Idempotency-Key` is a required header on create, cancel, and refund. Documented fact.
  Source: [Create order reference](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/orders/create-order/post.md).
- Credential prefix note. The current Point docs say the test Access Token starts with
  `APP_USR`, and several curl examples in the same page show a `TEST-` token.
  Source-backed tradeoff: the page contradicts itself. Confirm the prefix in the panel
  before you write a test.
- **Field observation, 2026-09-17.** The mobile panel's "Credenciales de prueba" view shows
  an Access Token that starts with `APP_USR-` for the application `2040479802223096`. The
  `TEST-` examples in the docs are therefore legacy or wrong. Observed by the owner, from a
  screenshot of the panel.
- **Field observation, 2026-09-17.** A truncated or malformed token and a missing
  `Authorization` header produce the SAME answer:
  `401 {"code":"unauthorized","message":"authorization value not present"}`. A well-formed
  but unknown token produces a different answer: `401 {"code":"unauthorized","message":"user
not found"}`. Use the second message as the proof that the header arrived intact.

### 2.3 The endpoints the POS needs

| Operation                | Method and path                     | Notes                                                      |
| ------------------------ | ----------------------------------- | ---------------------------------------------------------- |
| List terminals           | `GET /terminals/v1/list`            | Query params `limit`, `offset`, `store_id`, `pos_id`.      |
| Set terminal mode        | `PATCH /terminals/v1/setup`         | Body carries `terminals[].id` and `operating_mode: "PDV"`. |
| Create the store         | `POST /users/{user_id}/stores`      | Required for reconciliation.                               |
| Create the point of sale | `POST /v2/pos`                      | One point of sale per terminal in PDV mode.                |
| Create the payment order | `POST /v1/orders`                   | `type: "point"`, terminal id, amount.                      |
| Read the order           | `GET /v1/orders/{order_id}`         | Orders younger than three months only.                     |
| Cancel the order         | `POST /v1/orders/{order_id}/cancel` | Only while the status is `created`.                        |
| Refund the order         | `POST /v1/orders/{order_id}/refund` | Total or partial. Limit: 90 days.                          |
| Simulate a test status   | `POST /v1/orders/{order_id}/events` | Test credentials only.                                     |

Sources:
[Payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing.md),
[Configure terminal](https://www.mercadopago.com.mx/developers/en/docs/mp-point/configure-terminal.md),
[reference sitemap](https://www.mercadopago.com.mx/developers/es/reference/llms.txt).

### 2.4 Create-order payload

Documented facts. Source:
[Create order reference](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/orders/create-order/post.md).

| Field                                | Rule                                                                                                                                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`                               | The only valid value for Point is `point`.                                                                                                                                                   |
| `external_reference`                 | Unique. Maximum 64 characters. Letters, digits, hyphen, and underscore only. No personal data.                                                                                               |
| `expiration_time`                    | ISO-8601 duration. Minimum `PT30S`, maximum `PT3H`. Default is 15 minutes.                                                                                                                   |
| `transactions`                       | One payment per order.                                                                                                                                                                       |
| `transactions.payments[].amount`     | String with two decimals, for example `"24.00"`. The guide says two decimals are mandatory. The reference page says "two decimal places or none". Source-backed tradeoff; send two decimals. |
| `config.point.terminal_id`           | Format `type + "__" + serial`, for example `NEWLAND_N950__N950NCB801293324`.                                                                                                                 |
| `config.point.print_on_terminal`     | `seller_ticket` (default) or `no_ticket`.                                                                                                                                                    |
| `config.payment_method.default_type` | Optional. `credit_card` or `debit_card`.                                                                                                                                                     |
| `integration_data`                   | Optional. `platform_id`, `integrator_id`, `sponsor.id`.                                                                                                                                      |

Inference: a POS must build the terminal ID from the serial number on the back label.
The `id` from `GET /terminals/v1/list` is the value to store.

### 2.5 Order lifecycle

Statuses, as documented:

```text
created -> at_terminal -> processed
created -> canceled        (cancel via API)
created -> expired         (15 minutes without payment)
at_terminal -> canceled     (cancel on the terminal)
at_terminal -> failed
at_terminal -> action_required   (after 40 seconds)
at_terminal -> expired
processed -> refunded
```

`action_required` is a final status. The docs say: "this status will not change", and the
operator must check the terminal. Documented fact.
Source: [Status of an order and a transaction](https://www.mercadopago.com.mx/developers/en/docs/mp-point/resources/status-order-transaction.md).

### 2.6 Notifications and polling

- The event to select in the panel is **Order (Mercado Pago)**. Documented fact. The
  notification body carries `type: "order"`, and the query string carries `type=order`.
  Documented fact. The plugin guide and the `llms.txt` file call the topic `orders`.
  Sources:
  [Notifications](https://www.mercadopago.com.mx/developers/en/docs/mp-point/notifications.md),
  [plugin guide, Point](https://github.com/mercadopago/mercadopago-claude-marketplace/blob/main/plugins/mercadopago/skills/mp-integrate/references/guides/point.md),
  [llms.txt for Mexico](https://www.mercadopago.com.mx/developers/es/llms.txt).
- Events: `order.processed`, `order.canceled`, `order.refunded`,
  `order.action_required`, `order.failed`, `order.expired`. Documented fact.
- The notification carries the header `x-signature` in the form
  `ts=<epoch>,v1=<hmac>`. Validate it with HMAC-SHA256 before you use the payload.
  Documented fact.
- The legacy topic name is `point_integration_wh`. The official plugin guide states:
  "Use the `orders` webhook topic; `point_integration_wh` is legacy."
  Source: [plugin guide, Point](https://github.com/mercadopago/mercadopago-claude-marketplace/blob/main/plugins/mercadopago/skills/mp-integrate/references/guides/point.md).
- Polling the order is documented, and the docs discourage it: "although the recurring
  use of this API query is not recommended". Use it as a fallback only.
  Documented fact.
  Source: [Payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing.md).

Inference: the POS needs a webhook receiver and a safe fallback poll after a timeout.

### 2.7 The deprecated Payment Intent API, for reference

| Operation               | Method and path                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------ |
| List devices            | `GET /point/integration-api/devices`                                                 |
| Create a payment intent | `POST /point/integration-api/devices/{deviceid}/payment-intents`                     |
| Read an intent          | `GET /point/integration-api/payment-intents/{paymentintentid}`                       |
| Cancel an intent        | `DELETE /point/integration-api/devices/{deviceid}/payment-intents/{paymentintentid}` |
| Set the mode            | `PATCH /point/integration-api/devices/{device-id}`                                   |
| Refund intents          | `POST /point/integration-api/devices/{deviceid}/refund`                              |

Documented facts. Source:
[Legacy payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point-legacy/integration-configuration/integrate-with-pdv/payment-processing.md),
[OpenAPI specification](https://github.com/mercadopago/openapi/blob/main/spec3.yaml).

Legacy intent states include `open`, `on_terminal`, `FINISHED`, and
`Confirmation_required`. The amount has no decimal point: `"15.00"` is sent as `1500`.
Documented fact. The legacy docs also state that notifications are the main mechanism,
and that the query endpoint is "an alternative mechanism".

## 3. Is there a documented local USB or Bluetooth protocol?

**NO.** No Mercado Pago primary source documents a local USB or Bluetooth protocol that
lets a host POS drive a Point terminal.

Evidence:

- The Point integration requires the Orders API over HTTPS. The terminal loads the
  order from Mercado Pago, not from your computer. Documented fact.
  Source: [Payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing.md).
- The SmartApp restrictions page lists forbidden Android permissions. The list includes
  `android.permission.USB_PERMISSION`, `android.permission.USB_SET`, and the whole
  `BLUETOOTH*` family. Documented fact.
- The same page lists "Other restrictions", and one item is: "Use of the _USB_ port for
  information transmission." Documented fact.
  Source: [SmartApp restrictions](https://www.mercadopago.com.mx/developers/en/docs/smartapps/restrictions.md).
- SmartApp capabilities are available only through the Mercado Pago SDK: "card reading
  and processing, receipt printing, _Bluetooth_ usage, and camera access ... must be
  invoked exclusively through the Mercado Pago SDK". Documented fact.

What is documented instead, and what it is not:

| Path                                                     | What it is                                                                                                                          | What it is not                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Orders API                                               | HTTPS API from your backend.                                                                                                        | Not a local protocol.                                                                             |
| SmartApps SDK (Third-Apps Integration Kit)               | A private Android AAR that runs on the terminal. It reaches the camera, the printer, and Bluetooth peripherals.                     | Not a host protocol. It needs a commercial agreement, a development terminal, and an APK review.  |
| Development terminal                                     | The SmartApps page states that development devices "have the USB port enabled by default and debugging configuration activated".    | That USB port is for Android debugging and APK deployment, not for a payment protocol. Inference. |
| Legacy Android intent (`com.mercadopago.PAYMENT_ACTION`) | A 2022 sample app calls the Mercado Pago wallet app through an Android intent and receives a payment result. Last push: 2022-05-12. | Not a host OS protocol, not current documentation, and not on the current doc site.               |

Sources: [SmartApps overview](https://www.mercadopago.com.mx/developers/en/docs/smartapps/overview.md),
[Third-Apps Integration Kit demo](https://github.com/mercadopago/point-smartapp-demo-android),
[legacy Android integration sample](https://github.com/mercadopago/point-android_integration).

Point Mini uses Bluetooth, and the official page states it "connects by Bluetooth to
your phone". The paired device is the Mercado Pago mobile app, not a POS. Inference from
the store page text. The store page does not name a public Bluetooth protocol.

## 4. Partner and certification requirements

### 4.1 For the Orders API

1. A Mercado Pago seller account. Documented fact.
2. An application in Your integrations with **Mercado Pago Point** as the product.
   Documented fact.
3. Test credentials, which the panel creates automatically. Documented fact.
4. For a third-party integration, an OAuth authorization code flow, plus a registered
   static HTTPS redirect URL in Advanced settings. Documented fact.
5. Production credentials activation for your own store. Documented fact.
6. A physical terminal purchased from the official store, paired to the target account
   with the Mercado Pago mobile app, and switched to `PDV` mode. Documented fact.
7. One point of sale per terminal in PDV mode. Documented fact.

Source: [Create application](https://www.mercadopago.com.mx/developers/en/docs/mp-point/create-application.md),
[Configure terminal](https://www.mercadopago.com.mx/developers/en/docs/mp-point/configure-terminal.md),
[Go to production](https://www.mercadopago.com.mx/developers/en/docs/mp-point/go-to-production.md).

There is no device whitelisting step for the Orders API beyond the pairing and `PDV`
mode. Inference: any Point terminal in the account can receive an order when it is in
PDV mode and the ID matches.

### 4.2 Integration quality

Mercado Pago measures integration quality automatically for Point applications that have
a production payment ID. The measurement covers buyer experience, financial
reconciliation, payment approval, scalability, and security. Documented fact.

Source: [How to measure integration quality](https://www.mercadopago.com.mx/developers/en/docs/mp-point-legacy/how-tos/integration-quality.md).

Inference: a pilot with one real payment creates the production payment ID that the
measurement needs.

### 4.3 The developer program and the Integrator ID

The `<dev>program` issues an **Integrator ID** after a free certification test. The ID
goes into `integration_data.integrator_id`. Documented fact.

Source: [Your certifications](https://www.mercadopago.com.mx/developers/en/docs/mp-point-legacy/additional-content/certifications.md),
[Create order reference](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/orders/create-order/post.md).

### 4.4 For SmartApps, the requirements are commercial

- "Contact with the Mercado Pago business team" is a prerequisite. The process "can only
  begin after this formal contact". Documented fact.
- A development version of the Point Smart terminal is required. Only the business
  advisor can supply one. Documented fact.
- The terminal operating system must run the Sandbox version. Documented fact.
- The team reviews the APK, and Mercado Pago distributes the app to the terminals.
  Documented fact.
- The official plugin guide requires "an active SmartApps agreement with the Mercado
  Pago business/integration team". Documented fact.

Source: [SmartApps overview](https://www.mercadopago.com.mx/developers/en/docs/smartapps/overview.md),
[Deploy the SmartApp](https://www.mercadopago.com.mx/developers/en/docs/smartapps/deployment.md),
[plugin guide, SmartApps](https://github.com/mercadopago/mercadopago-claude-marketplace/blob/main/plugins/mercadopago/skills/mp-integrate/references/guides/smartapps.md).

The Partners program exists and pays a commission per integration. The exact terms and
the current application form are UNVERIFIED; the campaign pages sit behind a login.
Source for the program landing reference: [developer portal front page](https://www.mercadopago.com.mx/developers/es).

## 5. Sandbox and test capability

### 5.1 Test without hardware

- Mercado Pago provides a standard virtual device with the serial `SBX0000001`.
  A valid terminal ID is `NEWLAND_N950__SBX0000001`. Documented fact.
- The virtual device is not valid for integration quality measurement. Documented fact.
- `POST /v1/orders/{order_id}/events` simulates a final status. The endpoint "does not
  generate events or interactions with the Point terminal". Documented fact.
- Simulated statuses: `processed`, `failed`, `refunded`, `canceled`, `expired`,
  `action_required`. The change takes up to 10 seconds, or up to 40 seconds for
  `action_required`. Documented fact.
- `refunded` needs an order that is already `processed`. Documented fact.

Source: [Test the integration](https://www.mercadopago.com.mx/developers/en/docs/mp-point/integration-test.md),
[Simulate order status](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/orders/simulate-order/post.md).

### 5.2 Test with hardware

- A physical terminal cannot process a real payment with test credentials. The docs
  state: "It is not possible to process real payments on the physical terminal using
  test accounts." Documented fact.
- Mercado Pago recommends that the terminal is linked to the test credentials anyway,
  so the test user can see the flow. Documented fact.
- To test notifications, use a real test payment plus a public HTTPS URL. The panel also
  offers a "Simulate notification" button with an event type and a data ID.
  Documented fact.

Source: [Test the integration](https://www.mercadopago.com.mx/developers/en/docs/mp-point/integration-test.md),
[Notifications](https://www.mercadopago.com.mx/developers/en/docs/mp-point/notifications.md).

### 5.3 Test cards

Mercado Pago publishes test cards, and the cardholder name selects the result. The
eligibility of these cards for Point terminals is UNVERIFIED. The Point test page
describes status simulation and does not use test cards for the terminal.

Mexico test cards, as published:

| Type   | Brand            | Number              | Security code | Expiry |
| ------ | ---------------- | ------------------- | ------------- | ------ |
| Credit | Mastercard       | 5474 9254 3267 0366 | 123           | 11/30  |
| Credit | Visa             | 4075 5957 1648 3764 | 123           | 11/30  |
| Credit | American Express | 3711 803032 57522   | 1234          | 11/30  |
| Debit  | Mastercard       | 5579 0534 6148 2647 | 123           | 11/30  |
| Debit  | Visa             | 4189 1412 2126 7633 | 123           | 11/30  |

Cardholder names: `APRO` approves, `OTHE` declines with a general error, `CONT` stays
pending, `FUND` declines for insufficient funds, `SECU` declines for an invalid security
code, and others.

Documented fact. Source: [Test cards](https://www.mercadopago.com.mx/developers/en/docs/mp-point-legacy/additional-content/your-integrations/test/cards.md).

### 5.4 The panel simulator

The developer panel offers a webhook "Simulate notification" action. The docs also
mention a "Webhooks Simulator" for development. Documented fact.

Source: [Notifications](https://www.mercadopago.com.mx/developers/en/docs/mp-point/notifications.md),
[llms.txt for Mexico](https://www.mercadopago.com.mx/developers/es/llms.txt).

## 6. Pricing and commission facts for Mexico

All prices below come from the official Mexico store page, read on 2026-09-16. The page
shows a campaign price next to a list price, inside the campaign `point_org`. The store
page is the only public price page I confirmed. The docs page that the Point overview
links for rates, `https://www.mercadopago.com.mx/developers/es/support/37740`, renders
without rate content from this workstation. Treat the store page as the price source.

### 6.1 Commission

- Card-present sale, debit and credit: **3.5 percent plus IVA**. Documented fact.
- "Las terminales Point no tienen renta mensual. Pagas solamente una tasa fija + IVA por
  cada venta que hagas." Documented fact.
- The store page states that the merchant receives the money "al contado" (at once).
- Installments with interest, published rates plus IVA: 3 months 4.69 percent, 6 months
  7.69 percent, 9 months 11.19 percent, 12 months 12.89 percent, 18 months 19.39 percent,
  24 months 27.29 percent. Documented fact.
- Interest-free installments up to 24 months exist. The business absorbs the financing
  commission. Documented fact.

Source: [Terminales Point](https://www.mercadopago.com.mx/herramientas-para-vender/lectores-point), read 2026-09-16.

The exact settlement delay in hours, and the IVA treatment on the commission, are
UNVERIFIED. The page states "al contado" and does not publish a delay.

### 6.2 Terminal prices

| Terminal      | List price (MXN) | Campaign price (MXN) | Campaign terms     |
| ------------- | ---------------- | -------------------- | ------------------ |
| Point Mini    | 499.00           | 89.00                | 3 months of 29.66  |
| Point Air     | 2,999.00         | 349.00               | 12 months of 29.08 |
| Point Smart 2 | 4,499.00         | 499.00               | 6 months of 83.16  |

Documented fact, from the embedded pricing data of the store page, campaign `point_org`.
The headline on the same page says "Terminal de Punto de Venta desde $99". The campaign
value for the Point Mini is $89. Source-backed tradeoff: the headline and the pricing
object disagree by ten pesos. Check the checkout page before you quote a price.

Source: [Terminales Point](https://www.mercadopago.com.mx/herramientas-para-vender/lectores-point), read 2026-09-16.

Prices change with campaigns. Treat all numbers here as a snapshot of 2026-09-16.
Conekta comparison, tax duties, and any other provider fact are out of scope for this
file. See `docs/research/2026-09-16-mexico-payments-and-fiscal.md`.

## 7. What this means for the UmiPOS `external_terminal` tender (inference)

The following points are inference, not documented facts.

1. The POS talks to Mercado Pago, not to the terminal. The tender type
   `external_terminal` maps to a `POST /v1/orders` call with `type: "point"`.
2. UmiPOS needs a per-store mapping of Point terminal ID to point of sale. The store and
   the point of sale must exist in Mercado Pago, and the terminal must sit in `PDV` mode.
3. The deferred "real payment provider" validation resolves with a webhook on the
   `orders` topic, plus a bounded fallback poll of `GET /v1/orders/{order_id}`.
4. The POS must show a distinct state for `action_required`. The docs state that this
   status never changes by itself.
5. The POS must handle `expired`. The default validity window is 15 minutes.
6. The POS should store the order ID before it shows the terminal prompt, because the
   order is the only handle for cancel, refund, and reconciliation.
7. Amount formatting differs per API. The Orders API takes a string with two decimals.
   The legacy Payment Intents API takes an integer in cents. New work uses the string.
8. A USB path does not exist. The exploration work on the USB port stays useful for
   hardware identification and for a future SmartApp, and it cannot produce a payment
   protocol.

## 8. Rungs, routes, and failed attempts

| Source                                                                           | Rung | Result                                                                                              |
| -------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------- |
| `www.mercadopago.com.mx/developers/...` HTML page                                | 1    | BLOCK for text. The page is a JavaScript shell. A plain `curl` returns 2.7 MB with no doc text.     |
| The `.md` twin of a doc page                                                     | 1    | WORK. `curl <doc-url-with-.md>` returns Markdown. This is the main route.                           |
| `llms.txt` for Mexico                                                            | 1    | WORK, 200, 14 KB. It lists the sitemap and the LLM rules.                                           |
| `www.mercadopago.com.mx/developers/es/docs/llms.txt`                             | 1    | WORK, 200, 405 KB, 2823 lines. The full docs sitemap.                                               |
| `www.mercadopago.com.mx/developers/es/reference/llms.txt`                        | 1    | WORK, 200, 67 KB. The API reference sitemap.                                                        |
| `developers.mercadopago.com`                                                     | 1    | BLOCK. The host does not resolve from this workstation.                                             |
| `developers.mercadopago.com.mx`                                                  | 1    | BLOCK. The host does not resolve.                                                                   |
| `https://mcp.mercadopago.com/mcp`                                                | 1    | KEY. `initialize` returns `401 Authentication failed`.                                              |
| `www.mercadopago.com.mx/developers/llms.txt`                                     | 1    | BLOCK, 422 `Invalid values in params object`. The `/es/llms.txt` path works.                        |
| `www.mercadopago.com.mx/developers/sitemap.xml`                                  | 1    | BLOCK, 422.                                                                                         |
| `www.mercadopago.com.mx/robots.txt`                                              | 1    | WORK, 200. It disallows `/point/preference*` and `/point/buyingflow*`.                              |
| Bing RSS search                                                                  | 5    | WORK, 200, but the results were noise.                                                              |
| Wayback Machine CDX API                                                          | 7    | BLOCK. "Internet Archive services are temporarily offline."                                         |
| `github.com/mercadopago` REST API                                                | 3    | WORK, 200.                                                                                          |
| `mercadopago/openapi` raw `spec3.yaml`                                           | 3    | WORK, 200, 261 KB. It confirms the endpoint list.                                                   |
| `mercadopago-claude-marketplace` raw files                                       | 3    | WORK, 200. Official vendor content with dates.                                                      |
| Rendered page through local `playwright` 1.62.1 and Chromium                     | 1    | WORK for `github.io`-style pages; the docs shell still rendered a 404 body for a guessed slug.      |
| `www.mercadopago.com.mx/developers/es/support/37740` ("Consulta nuestras tasas") | 1    | BLOCK for content. The rendered page shows navigation only. Use the store page for rates.           |
| Repo browser MCP (`umi_firefox`)                                                 | 1    | BLOCK. Firefox navigation returned `NS_ERROR_FAILURE`. Replaced with local Playwright and Chromium. |

## 9. Sources

- [Point overview](https://www.mercadopago.com.mx/developers/en/docs/mp-point/overview.md)
- [Create application](https://www.mercadopago.com.mx/developers/en/docs/mp-point/create-application.md)
- [Configure terminal](https://www.mercadopago.com.mx/developers/en/docs/mp-point/configure-terminal.md)
- [Payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing.md)
- [Notifications](https://www.mercadopago.com.mx/developers/en/docs/mp-point/notifications.md)
- [Configure printings](https://www.mercadopago.com.mx/developers/en/docs/mp-point/configure-printings.md)
- [Test the integration](https://www.mercadopago.com.mx/developers/en/docs/mp-point/integration-test.md)
- [Go to production](https://www.mercadopago.com.mx/developers/en/docs/mp-point/go-to-production.md)
- [Status of an order and a transaction](https://www.mercadopago.com.mx/developers/en/docs/mp-point/resources/status-order-transaction.md)
- [Migrate from Payment Intents API to Orders API](https://www.mercadopago.com.mx/developers/en/docs/mp-point/migrate-payment-intent-to-orders.md)
- [Legacy: integrate via API to points of sale](https://www.mercadopago.com.mx/developers/en/docs/mp-point-legacy/integration-configuration/integrate-with-pdv/introduction.md)
- [Legacy: payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point-legacy/integration-configuration/integrate-with-pdv/payment-processing.md)
- [Legacy: test cards](https://www.mercadopago.com.mx/developers/en/docs/mp-point-legacy/additional-content/your-integrations/test/cards.md)
- [SmartApps overview](https://www.mercadopago.com.mx/developers/en/docs/smartapps/overview.md)
- [SmartApp restrictions](https://www.mercadopago.com.mx/developers/en/docs/smartapps/restrictions.md)
- [SmartApp Bluetooth](https://www.mercadopago.com.mx/developers/en/docs/smartapps/terminal-features/configure-bluetooth.md)
- [Reference: create order](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/orders/create-order/post.md)
- [Reference: get terminals](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/terminals/get-terminals/get.md)
- [Reference: simulate order status](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/orders/simulate-order/post.md)
- [llms.txt for Mexico](https://www.mercadopago.com.mx/developers/es/llms.txt)
- [Docs sitemap](https://www.mercadopago.com.mx/developers/es/docs/llms.txt)
- [Reference sitemap](https://www.mercadopago.com.mx/developers/es/reference/llms.txt)
- [Store: Terminales Point](https://www.mercadopago.com.mx/herramientas-para-vender/lectores-point)
- [OpenAPI specification](https://github.com/mercadopago/openapi)
- [Official plugin repository](https://github.com/mercadopago/mercadopago-claude-marketplace)
- [Third-Apps Integration Kit demo](https://github.com/mercadopago/point-smartapp-demo-android)
- [Legacy Android integration sample](https://github.com/mercadopago/point-android_integration)
- [Point MCP server](https://mcp.mercadopago.com/mcp)

## 10. Open questions

1. Does the Orders API accept Point Air or Point Mini? The docs list Point Smart only.
   UNVERIFIED.
2. Is the Point test Access Token prefix `APP_USR` or `TEST-`? **Closed on 2026-09-17.** The
   panel shows `APP_USR-` under "Credenciales de prueba" (see section 2.2). Does that token
   list the terminals of the seller account, or only the terminals of the test user? Still
   open, and it decides whether the first live call needs the test token or the production
   token.
3. Which Point models does the Mexico store deliver today, and does a Point Smart 1
   remain available? The store lists the Point Smart 2.
4. What is the exact settlement delay, and how does the commission handle IVA?
   UNVERIFIED.
5. What are the Partners program terms for an integrator of our size? The pages need a
   login.
6. Does the point of sale create endpoint answer `POST /v2/pos` or `POST /pos`? The
   guide uses `/v2/pos`, and the OpenAPI specification lists `/pos`. Source-backed
   tradeoff.
7. Can a test user see the order on a physical terminal without a real charge? The docs
   say the terminal must be linked to the test credentials, and they also say real
   payments need production credentials.
8. Does Mercado Pago require a commercial agreement for the Orders API at scale, or is
   the panel application sufficient? UNVERIFIED.
