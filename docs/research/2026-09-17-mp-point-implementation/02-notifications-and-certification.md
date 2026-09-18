# Mercado Pago Point: notifications, signature, and production readiness

- Date: 2026-09-17.
- Scope: the notification (webhook) mechanism for the Point Orders API, the signature
  recipe, the delivery contract, the `order.action_required` meaning, and the
  production-readiness path.
- Method: official Mercado Pago documentation only. Two routes were used: the `.md` twin
  of each documentation page, and the live Mercado Pago MCP server at
  `https://mcp.mercadopago.com/mcp` with the test Access Token from
  `apps/umi-api/.env`.
- Prior art read first and not repeated: `README.md` and
  `08-serving-many-merchants.md` in `docs/research/2026-09-16-mercadopago-point-usb/`.

Labels used below:

- **Documented fact**: the vendor states it.
- **Source-backed tradeoff**: the vendor states a rule, and the rule has a cost.
- **Inference**: a conclusion that follows from documented facts. It is not in the docs.
- **UNVERIFIED**: not confirmed. Do not build on it.

---

## 1. Notification topics

### 1.1 The primary topic for Point

**Documented fact.** The Point notification page tells the reader to select one event in
the panel:

> "Select the **Order (Mercado Pago)** event to receive notifications, which will be sent
> in `JSON` format via an `HTTPS POST` to the URL specified above."

Source:
[Configure notifications (mp-point)](https://www.mercadopago.com.mx/developers/en/docs/mp-point/notifications.md)

**Documented fact.** The general notification page maps the panel name to the topic
string in a table. The row is:

| Events                          | Name in Your Integrations | Topic    | Associated products              |
| ------------------------------- | ------------------------- | -------- | -------------------------------- |
| Creation and update of payments | Order (Mercado Pago)      | `orders` | Checkout API, Mercado Pago Point |

Source:
[Webhooks (your-integrations)](https://www.mercadopago.com.mx/developers/en/docs/your-integrations/notifications/webhooks.md)

**Documented fact, inconsistent.** The live MCP tool `save_webhook` lists the same panel
name with a different topic string:

> `"order": Order (Mercado Pago) - Notifications for Mercado Pago order events. Users can
also refer to this as "Order (Mercado Pago)".`

The documentation table writes `orders` (plural). The MCP writes `order` (singular).
**Record this as a conflict.** Resolve it against the panel, because the panel is the
system that stores the configuration.

### 1.2 Every `action` value for the order topic

**Documented fact.** The Point notification page lists six alerts:

> "Once completed, your Webhooks notifications for Mercado Pago Point will be configured
> and you will be able to receive the following alerts about the order:
>
> - **Processed** (`order.processed`)
> - **Canceled** (`order.canceled`)
> - **Refunded** (`order.refunded`)
> - **Requires confirmation on the terminal** (`order.action_required`)
> - **Failed** (`order.failed`)
> - **Expired** (`order.expired`)"

These six values are the complete set. No seventh `action` value appears in the
documentation for the `order` topic.

**Documented fact.** The test page confirms that the same six values are reproducible in
the sandbox. Each simulation sends the matching notification:

| Simulated `status` | Notification `action`   | Notification `status_detail`       |
| ------------------ | ----------------------- | ---------------------------------- |
| `processed`        | `order.processed`       | `accredited`                       |
| `canceled`         | `order.canceled`        | `canceled_on_terminal`             |
| `refunded`         | `order.refunded`        | `refunded`                         |
| `action_required`  | `order.action_required` | `check_on_terminal`                |
| `failed`           | `order.failed`          | `failed` or `bad_filled_card_data` |
| `expired`          | `order.expired`         | `expired`                          |

Source:
[Test the integration (mp-point)](https://www.mercadopago.com.mx/developers/en/docs/mp-point/integration-test.md)

### 1.3 The `order.processed` body

**Documented fact.** The page gives this example. It is reproduced verbatim.

```json
{
  "action": "order.processed",
  "api_version": "v1",
  "application_id": "123456",
  "data": {
    "external_reference": "ext_ref_1235",
    "id": "ORD01JYH1Z1YJN4HZ8J3Q0RB3YP6D",
    "status": "processed",
    "status_detail": "accredited",
    "total_paid_amount": "120",
    "transactions": {
      "payments": [
        {
          "amount": "120",
          "id": "PAY01K22Y503EJ8JHGF64KGY1PZ2B",
          "paid_amount": "120",
          "payment_method": {
            "id": "debvisa",
            "installments": 1,
            "type": "debit_card"
          },
          "reference": {
            "id": "123456789980"
          },
          "status": "processed",
          "status_detail": "accredited"
        }
      ]
    },
    "type": "point",
    "version": 3
  },
  "date_created": "2025-08-07T18:54:40.851374414Z",
  "live_mode": true,
  "type": "order",
  "user_id": "123456"
}
```

### 1.4 Field-by-field meaning

**Documented fact.** The page describes the three parts of a notification:

> "This example includes the complete notification, which contains the query params, the
> body, and the header of the notification.
>
> - **Query params**: These are query parameters that accompany the URL. In the example,
>   we have `data.id=ORD01JQ4S4KY8HWQ6NA5PXB65B3D3` and `type=order`.
> - **Body**: The body of the notification contains detailed information about the event,
>   such as `action`, `api_version`, `application_id`, `date_created`, `id`, `live_mode`,
>   `type`, `user_id`, and `data`.
> - **Header**: The header contains important metadata, including the secret signature of
>   the notification `x-signature`."

**Documented fact.** The general page defines the shared attributes:

| Attribute      | Description                                                             | Example in JSON                 |
| -------------- | ----------------------------------------------------------------------- | ------------------------------- |
| `id`           | Notification ID                                                         | `12345`                         |
| `live_mode`    | Indicates if the URL provided is valid                                  | `true`                          |
| `type`         | Type of notification received according to the selected topic           | `payment`                       |
| `date_created` | Date the notified resource was created                                  | `2015-03-25T10:04:58.396-04:00` |
| `user_id`      | Seller identifier                                                       | `44444`                         |
| `api_version`  | Value indicating the API version sending the notification               | `v1`                            |
| `action`       | Notified event, indicating if it is a resource update or a new creation | `payment.created`               |
| `data.id`      | ID of the payment, `merchant_order`, or claim                           | `999999999`                     |

**Documented fact, inconsistent.** The field table above lists `id` as a body attribute.
The six Point example bodies in the Point page do **not** contain a top-level `id`. The
raw HTTP example on the same page **does** contain `"id":"123456"` in the body.

**Record this as a conflict.** Do not make deduplication depend on a field that the six
example bodies do not show. Read `data.id` and `X-Request-Id` instead, and treat any
top-level `id` as a bonus.

### 1.5 Attribute semantics for the Point body

**Documented fact.** These meanings come from the Point page and from the order status
page.

| Field                          | Meaning                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `action`                       | The event. One of the six values in section 1.2.                                                                                |
| `api_version`                  | Always `v1`.                                                                                                                    |
| `application_id`               | Identifier of the application that is notified.                                                                                 |
| `data.id`                      | The order identifier, for example `ORD01JQ4S4KY8HWQ6NA5PXB65B3D3`.                                                              |
| `data.external_reference`      | The value that our system sent at order creation.                                                                               |
| `data.status`                  | The order status. See section 4.                                                                                                |
| `data.status_detail`           | The order status detail. See section 4.                                                                                         |
| `data.type`                    | Always `point` for this product.                                                                                                |
| `data.version`                 | The order version. The examples show `3`.                                                                                       |
| `data.total_paid_amount`       | The paid amount, as a string. Present in the `processed` example.                                                               |
| `data.transactions.payments[]` | The payment list. Each entry holds `id`, `amount`, `paid_amount`, `status`, `status_detail`, `payment_method`, and `reference`. |
| `date_created`                 | Notification creation date.                                                                                                     |
| `live_mode`                    | `true` in production, `false` in test mode.                                                                                     |
| `type`                         | Always `order` for this topic.                                                                                                  |
| `user_id`                      | The seller identifier.                                                                                                          |

### 1.6 A rule that helps multi-seller routing

**Documented fact.** The general page gives this instruction:

> "If you need to identify multiple accounts, you can add the parameter
> `?cliente=(sellersname)` to the endpoint URL to identify the sellers."

**Inference.** This is the only documented way to route one webhook URL to many sellers.
Umi must not rely on it as the primary key. The body carries `user_id`, and the signature
check needs the per-application secret. Use `user_id` to select the merchant, and use one
application per seller only if the vendor mandates it.

### 1.7 Optional topics

**Documented fact.** The optional topic page names three extra topics, and states that
none is mandatory and none replaces the order topic:

| Topic                         | Panel name          | Description                                                             |
| ----------------------------- | ------------------- | ----------------------------------------------------------------------- |
| `mp-connect`                  | Application linking | Notifies when an account is linked or unlinked via OAuth.               |
| `topic_claims_integration_wh` | Claims              | Notifies when a buyer files a claim or when a status change occurs.     |
| `topic_chargebacks_wh`        | Chargebacks         | Notifies when a buyer initiates a chargeback or a status change occurs. |

Source:
[Configure optional notifications](https://www.mercadopago.com.mx/developers/en/docs/mp-point/optional-notifications.md)

**Documented fact.** `mp-connect` has exactly two `action` values:
`application.authorized` (linking) and `application.deauthorized` (unlinking).

**Documented fact.** The optional topic page states the panel name for claims as
**Claims** and the body `type` as `claim`. The optional page writes the topic name as
`topic_claims_integration_wh` in its table, while the body example shows
`"type":"claim"`. **Record the naming variance.**

**Source-backed tradeoff.** `mp-connect` is the only documented signal that a seller
revoked Umi's access. Without it, Umi learns about a revocation on the next failed API
call. Activate it when the OAuth path starts.

### 1.8 A topic the vendor recommends but that is not in the panel list

**Documented fact.** The MCP `quality_checklist` contains a best practice named
`alert_device_system`, with the description "Device alerts". Its recommendation reads:

> "It allows you to receive notifications of reset of devices, disconnections and changes
> in the mode of operation."

**UNVERIFIED.** No topic string for device alerts appears in any documentation page read,
and it is absent from the `save_webhook` topic enum. Treat the device alert as
unavailable until the panel shows it.

---

## 2. Signature validation, exact steps

### 2.1 The two headers

**Documented fact.** The notification carries two relevant headers:

| Header         | Meaning                                                    |
| -------------- | ---------------------------------------------------------- |
| `x-signature`  | The secret signature. Format `ts=<value>,v1=<value>`.      |
| `x-request-id` | The request identifier. It is part of the signed manifest. |

**Documented fact.** The Point page gives this header example:

```
X-Signature: ts=1742505638683,v1=ced36ab6d33566bb1e16c125819b8d840d6b8ef136b0b9127c76064466f5229b
X-Request-Id: 2066ca19-c6f1-498a-be75-1923005edd06
```

**Documented fact.** The page explains the two parts:

> "To extract the _timestamp_ (`ts`) and key (`v1`) from the `x-signature` _header_,
> divide the _header_ content by the `,` character, which will result in a list of
> elements. The value for the `ts` prefix is the notification _timestamp_ (in
> milliseconds) and `v1` is the encrypted key."

**Documented fact.** The `ts` value is a timestamp **in milliseconds**. The Point page
example confirms this: `1742505638683` has 13 digits.

**Documented fact, inconsistent.** The general webhook page shows
`ts=1704908010,v1=618c...`, which has 10 digits and is a timestamp in **seconds**.
**Record this as a conflict.** Parse the value as an integer and do not assume a unit
from the digit count. If a freshness window is enforced, accept a window wide enough for
both units, or derive the unit from the digit count and state the rule in code.

### 2.2 The manifest string

**Documented fact.** The template is given verbatim as:

```
id:[data.id_url];request-id:[x-request-id_header];ts:[ts_header];
```

This is the exact order and the exact separators. The separators are a semicolon between
parts, and the string ends with a semicolon.

Substitutions, verbatim from the page:

- `[data.id_url]` is "replaced by the value of the `data.id` parameter received in the URL
  _query params_".
- `[x-request-id_header]` "must be replaced by the value received in the `x-request-id`
  _header_".
- `[ts_header]` "will be the `ts` value extracted from the `x-signature` _header_".

### 2.3 The lowercase rule

**Documented fact.** The page gives this note:

> "If `data.id` is returned with uppercase alphanumeric characters, convert it to
> lowercase before using it in the manifest. For example,
> `ORD01JQ4S4KY8HWQ6NA5PXB65B3D3` should be used as `ord01jq4s4ky8hwq6na5pxb65b3d3`."

The `ts` value and the `x-request-id` value are used as received. The rule applies to
`data.id` only.

### 2.4 The absence rule

**Documented fact.** The page gives this note:

> "If any of the values (`data.id`, `x-request-id`) are not present in the received
> notification, you must remove them from the manifest before computing the `HMAC`."

**Inference.** This rule means the manifest can be one of three shapes. The `ts` part is
always present.

1. Both present: `id:{id};request-id:{rid};ts:{ts};`
2. Request id absent: `id:{id};ts:{ts};`
3. Data id absent: `request-id:{rid};ts:{ts};`

The vendor's own official examples implement exactly this. Every code sample builds a
list and pushes each part only when the value is non-empty.

### 2.5 The hash algorithm and the key

**Documented fact.** The page states the algorithm and the key:

> "compute an HMAC with the `SHA256` hash function in hexadecimal base, using the secret
> key as the key and the _template_ with the values as the message."

So: `HMAC-SHA256`, hex-encoded, lowercase, with the secret as the key.

**Documented fact.** The secret is the "secret key" that the panel generates:

> "In **Your integrations**, select the integrated application, click **Webhooks >
> Configure notification** and reveal the generated secret key."

**Documented fact.** The secret has no expiry date, and rotation is optional:

> "Keep in mind that this generated key does not have an expiration date and its periodic
> renewal is not mandatory, although it is recommended. To do this, simply click the
> **Reset** button."

### 2.6 The comparison

**Documented fact.** The page states:

> "Finally, compare the generated key with the key extracted from the _header_, ensuring
> they match exactly."

**Documented fact.** The page also permits an optional freshness check:

> "Additionally, you can use the _timestamp_ extracted from the _header_ to compare it
> with a _timestamp_ generated at the time of receipt, in order to establish a delay
> tolerance in receiving the message."

**Source-backed tradeoff.** The vendor calls the freshness check optional. The vendor does
not document a replay window. A timestamp check is the only documented defense against a
replay of a captured body, because the body itself is not part of the hash. **Inference:**
add a freshness window, and record the chosen width in the code, because the digit-count
conflict in section 2.1 makes the unit ambiguous.

### 2.7 The official SDK helper

**Documented fact.** An official helper exists. The page names it
`WebhookSignatureValidator::validate` for PHP, and `WebhookSignatureValidator.validate`
for JavaScript, Python, Go, C#, Java, and Ruby. The arguments are, in order:
the `x-signature` value, the `x-request-id` value, the `data.id` value, and the secret.

**Documented fact.** The page states:

> "The official SDK implements HMAC-based Webhook Signature Verification to authenticate
> the origin of each received notification."

**Documented fact.** The SDK helper reads the `data.id` value from the query parameters,
not from the body. The samples pass `$_GET['data_id']`, `req.query['data.id']`,
`request.args.get("data.id")`, and equivalents.

**Inference.** The Umi API is not one of the languages of the samples read here. The
documented "Without SDKs" recipe in section 2.2 to section 2.6 is the contract to
implement. The recipe is complete and needs no guess.

### 2.8 Precision summary for the implementer

**The recipe, in the documented order:**

1. Read the `x-signature` header. Split on `,`. For each part, split on the first `=`.
   Take `ts` and `v1`.
2. Read the `x-request-id` header.
3. Read the `data.id` query parameter. Convert it to lowercase.
4. Build the manifest: `id:{data_id_lower};request-id:{x_request_id};ts:{ts};`. Omit the
   `id:` part when `data.id` is absent. Omit the `request-id:` part when `x-request-id` is
   absent. Keep the trailing `;`.
5. Compute `HMAC-SHA256` with the panel secret as the key and the manifest as the message.
   Encode the result as lowercase hexadecimal.
6. Compare with `v1`. The comparison must be constant-time.
7. Optionally compare `ts` with the receive time, inside a documented tolerance.

**Documented fact.** A failed validation must not return 200. Every official sample
returns `401` on failure and `200` on success.

---

## 3. Delivery behaviour

### 3.1 The response contract

**Documented fact.** The Point page states:

> "To do this, you must return an `HTTP STATUS 200 (OK)` or `201 (CREATED)`. The waiting
> time for this confirmation will be 22 seconds."

**Documented fact.** The general page states the same numbers:

> "you need to return an `HTTP STATUS 200 (OK)` or `201 (CREATED)` status. The **waiting
> time** for confirmation of receipt of notifications is **22 seconds**."

So the endpoint must answer within 22 seconds, with 200 or 201.

### 3.2 Retries

**Documented fact.** The Point page states:

> "If this response is not sent, the system will understand that the notification was not
> received and will make a new attempt to send it every 15 minutes until it receives the
> response. After the third attempt, the deadline will be extended, but the deliveries
> will continue to happen."

**Documented fact.** The general page states the same rule with the same words:

> "If this confirmation is not sent, the system will understand that the notification was
> not received and will **retry sending every 15 minutes** until a response is received.
> After the third attempt, the interval will be extended, but the attempts will continue."

**Documented fact.** The vendor documents no maximum retry count and no stop condition.
The deliveries continue until the endpoint answers.

**Documented fact.** The endpoint carries a retry counter. The raw example on the Point
page shows the header `X-Retry: 0`.

**UNVERIFIED.** The documentation does not define the meaning of `X-Retry`, and it does
not define the extended interval after the third attempt. Do not use `X-Retry` for
control flow.

### 3.3 Delivery semantics

**Documented fact.** The vendor documents a retry, and it documents no deduplication.
**Inference:** the contract is at-least-once. The endpoint must be idempotent.

**Documented fact.** Every official sample performs the write inside the HTTP request,
with no queue. **Source-backed tradeoff:** the 22-second budget is generous for a
signature check and a small write. A network call to a third party inside that window is
a risk.

**Documented fact.** The vendor removes the retry guarantee for one topic:

> "Please note that this type of notification does not adhere to the usual retry logic. If
> you do not respond with an `HTTP STATUS 200 (OK)` or `201 (CREATED)` upon receipt, the
> notification will be lost and will not be resent."

That statement is attached to the fraud-alert topic `stop_delivery_op_wh`, not to the
order topic.

### 3.4 Deduplication duties

**Documented fact.** The optional topic page states the purpose of the notification `id`:

> "`id` | long | Unique notification identifier. Use it for idempotency control."

and, for claims:

> "`id` | string | Unique notification identifier (UUID). Use it for idempotency control."

**Documented fact.** The order topic examples do not show a stable notification `id` in
the body, as recorded in section 1.4.

**Inference, and the recommended rule for Umi.** Deduplicate on the triple
`(data.id, action, data.version)`, and keep `X-Request-Id` as evidence.
`data.version` is present in the order body and increases per change, so it orders the
state transitions. This rule survives duplicates and out-of-order retries.

### 3.5 Ordering

**Documented fact.** The status page states a documented intermediate step:

> during this process, the order will automatically change to the `at_terminal` status
> before reaching the requested final status, **except** in the case of the `refunded`
> status, which transitions directly.

**Documented fact.** The vendor documents no ordering guarantee for notification arrival.
It documents retries. **Inference:** a client that applies notifications in arrival order
can move the state backwards. Apply by `version`, and ignore a notification with a version
lower than the stored version.

### 3.6 Origin restrictions

**Documented fact.** The webhook URL must be HTTPS and publicly reachable.

**Documented fact.** The URL must not point to internal MercadoLibre or MercadoPago
domains, and must not point to a private IP address. The live MCP `save_webhook` schema
states:

> "Must use HTTPS, be publicly accessible, and not point to internal MercadoLibre/\
> MercadoPago domains or private IP addresses. Max 400 characters."

**UNVERIFIED.** No documentation page read publishes an IP allowlist, a source CIDR
range, or an origin requirement for inbound notifications. The signature header is the
only documented authentication. Do not build an IP filter on an invented range.

### 3.7 Test-mode delivery

**Documented fact, contradictory.** The general webhook page states:

> "Test payments, created with test credentials, will not send notifications. The only way
> to test notification reception is through the [Configuration through Your
> integrations]."

**Documented fact.** The Point test page states the opposite for the order topic:

> "You will receive a Webhook notification from Mercado Pago with the `action` field set
> to `order.canceled` ..."

and, for the `action_required` case:

> "You will receive a Webhook notification from Mercado Pago with the `action` field set to
> `order.action_required`."

**Documented fact.** The Point page also gives this instruction for test credentials:

> "If you are developing using test credentials, go to **Your integrations > Integration
> data > Test credentials > Test credentials data**, log in to Mercado Pago Developers with
> the username and password from that test account, and configure Webhooks in production
> mode for that account. This way, you will be able to test the notifications correctly."

**Resolution, source-backed.** The `llms.txt` of the developer portal states the
precedence rule:

> "Product-specific instructions always take precedence over general guidance."

The Point page is the product page. **Inference:** simulated orders do send
notifications, and the general statement describes the legacy `payment` topic. The
earlier note `07-test-credentials-scope.md` reached the same conclusion from live calls.

**Source-backed tradeoff.** The test-mode instruction says to configure the webhook in
**production mode** while logged in as the test account. Umi must therefore keep two
callback URLs and two secrets during development, and must not share one secret between
the demo account and a real seller account.

---

## 4. The `order.action_required` meaning

### 4.1 The order status

**Documented fact.** The status page defines the order status:

| `status`          | `status_detail`   | Description                                                                                                                                                                                       |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `action_required` | `action_required` | "The transaction associated with the order needs to be confirmed. Check the terminal to verify the final status and make sure to update your system accordingly, as this status will not change." |

**Documented fact.** This is the operator instruction, in the vendor's words: check the
terminal. The page states that the status will not change.

### 4.2 The transaction status

**Documented fact.** The same page defines two transaction status details under
`action_required`:

| `status`          | `status_detail`     | Description                                                                                                                                                            |
| ----------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `action_required` | `waiting_payment`   | "The transaction requires an additional action and is waiting for payment. This means the transaction has been initiated, but the payment has not yet been completed." |
| `action_required` | `check_on_terminal` | "The transaction requires confirmation on the terminal to check whether the payment was approved or rejected."                                                         |

**Documented fact.** The state diagram on the same page shows the transition:
`at_terminal --> action_required: After 40s of processing start`.

### 4.3 The notification

**Documented fact.** The `order.action_required` body is:

```json
{
  "action": "order.action_required",
  "api_version": "v1",
  "application_id": "123456",
  "data": {
    "external_reference": "ext_ref_1234",
    "id": "ORD01JYH1Z1YJN4HZ8J3Q0RB3YP6D",
    "status": "action_required",
    "status_detail": "check_on_terminal",
    "type": "point",
    "version": 3
  },
  "date_created": "2025-06-24T13:28:36.44747706Z",
  "live_mode": false,
  "type": "order",
  "user_id": "123456"
}
```

**Documented fact.** This body has no `transactions` object. It carries
`data.status`, `data.status_detail`, and `data.version` only. **Inference:** a handler
must tolerate a missing `transactions` key on this action.

### 4.4 The simulation

**Documented fact.** The test page gives the simulation steps and states:

> "The simulation of this status may take up to 40 seconds to be processed."

The request body is `{"status": "action_required"}`. The endpoint is
`POST /v1/orders/{order_id}/events`. The response is `204 No Content`.

**Documented fact.** The page adds:

> "Additionally, you can query the Get order by ID endpoint to check the order status."

### 4.5 What this means for the Umi cashier screen

**Documented fact.** The vendor documents no timeout after `action_required`, and it
states that the status will not change. It documents a poll or a get.

**Source-backed tradeoff.** A payment that stalls at the terminal leaves an order in
`action_required`. If Umi shows "waiting" with no limit and no instruction, the cashier
has no defined next step.

**Inference, and the recommended rule for Umi.** Treat `order.action_required` as a
state that needs an operator, not as a failure. Show the vendor's instruction, which is
to check the terminal. Then poll `GET /v1/orders/{id}` on a bounded schedule, and close
the attempt when the poll resolves or the bound expires.

---

## 5. Production readiness

### 5.1 The Integrator ID

**Documented fact.** The certifications page defines the Integrator ID:

> "Unique number that identifies you as a member of the **<dev>program** automatically
> generated after your first successful certification. It is located next to your Mercado
> Pago ID (user ID) and only appears after it has been generated."

Source:
[Your certifications](https://www.mercadopago.com.mx/developers/en/docs/mp-point-legacy/additional-content/certifications.md)

**Documented fact.** The obtaining process is a certification exam:

> "Simply take the test for one of our certifications, which is 100% free and online, and
> if approved, you gain access to exclusive advantages."

and:

> "Please note that in order to obtain the Integrator ID, you must complete at least one
> certification test."

**Documented fact.** The page warns that the usage differs per product:

> "Please be aware that the process of using the Integrator ID in integration may vary
> depending on the product you are seeking certification for."

The page then links four product guides: Checkout Pro, WooCommerce,
Adobe Commerce (Magento), and WooCommerce Configuration.

**UNVERIFIED, and it matters.** The page gives **no Point-specific instruction** for the
Integrator ID, and the page read is in the `mp-point-legacy` path. Whether a Point
integration must send an `integrator_id`, and in which field, is not confirmed here.

**Documented fact.** The MCP `quality_checklist` lists the Integrator ID as a **Good
Practice**, not an implementation requirement:

> "Integrator ID - If you are part of the <dev> program, include your Integrator ID."

and, separately:

> "Platfrom ID - If you are part of the <dev> program, include your Platform ID."

**Inference.** The Integrator ID is optional for a working integration and affects the
quality score. Confirm the correct field with the vendor before the third-party launch.

### 5.2 What the go-to-production page adds

**Documented fact.** The Point go-to-production page lists six checkbox items. Five were
already recorded in `08-serving-many-merchants.md`. The sixth is the missing item:

**Reports.** The page states:

> "Mercado Pago reports provide information to track account transactions, such as
> available balance, movements, and liquidity. This facilitates reconciliation of sales
> and other operations with internal management systems. While they are optional, we
> recommend using reports to improve business financial management once you go to
> production."

Source:
[Go to production](https://www.mercadopago.com.mx/developers/en/docs/mp-point/go-to-production.md)

The documented report types are the **Released money** report and the **Account balance**
report.

**Documented fact.** For the third-party case, the page adds this rule about
notifications:

> "In the case of third-party integrations, Webhook notifications must be configured in
> the application of the main account."

**Documented fact.** The page records the credential shape of the OAuth response, and
confirms the 180-day risk:

> "This Access Token is valid for 180 days. You must renew it using the Renew Access Token
> flow before expiration or you will not be able to operate with our APIs. Also save the
> `code` (TG-XXXXXX-XXXX) from this response and the new `refresh_token` on each renewal:
> if you lose them, you will need to repeat the OAuth process."

### 5.3 The quality evaluation

**Documented fact.** The quality page defines the process and the scoring:

> "The **minimum score** for your application to meet the requirements is **73**, but **we
> recommend achieving 100 points**."

The five evaluated aspects are: Buyer Experience, Financial Reconciliation, Payment
Approval, Scalability, and Security.

Source:
[How to measure the your integration quality](https://www.mercadopago.com.mx/developers/en/docs/integration-quality.md)

**Documented fact.** Two measurement paths exist:

- Manual: the operator supplies a `payment ID` from a production payment.
- Automatic: Mercado Pago measures every month, from the 1st to the 7th, for
  "Checkout Pro, Checkout API, Checkout Bricks, and Mercado Pago Point" that have a
  production payment.

**Documented fact.** The page states a mandatory condition:

> "having a `payment ID` (payment identifier) made with **production credentials** is a
> mandatory requirement, and will enable the correct evaluation of the integration's
> functionality."

**Documented fact, contradictory.** The live MCP tool `quality_evaluation` states the
opposite:

> "Requires a recent payment or order made with TEST credentials (last 7 days) —
> production credentials are NOT required."

**Documented fact.** The Point test page resolves the terminal question and states:

> "The standard virtual device is not valid for integration quality measurement."

**Inference.** The `quality_evaluation` tool is a development aid that runs against
simulated orders. The published quality score, the one that counts, needs a payment with
production credentials. The virtual terminal cannot produce it.

### 5.4 The checklist the MCP returns

**Documented fact.** The live MCP tool `quality_checklist` returned the following. The
list has two groups. These are the vendor's exact names.

**Implementation requirements (7):**

| #   | Name                            | Vendor requirement                                                                                                                                                     |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Collection on Point device      | "You must create a collection by means of a dipositive point."                                                                                                         |
| 2   | Collection with PDV integration | "Create a payment_intent through our API"                                                                                                                              |
| 3   | Branch administration           | "Make sure you create your branches via API."                                                                                                                          |
| 4   | POS administration              | "Having an interface that allows you to create, edit and eliminate POS via API helps customize the user experience."                                                   |
| 5   | Referencia externa              | "Envíanos en el campo `external_reference` del request ... un código único que te permita correlacionar el payment_id de MercadoPago con el id interno de tu sistema." |
| 6   | Webhooks notifications          | "Configure an Endpoint to receive the webhooks notifications..."                                                                                                       |
| 7   | Centralized credentials         | "Make sure merchant's credentials are stored in a central server and not in every PoS"                                                                                 |

**Good practices (18):** Use case 2 (rejected payment), cancellation of the payment
intent, returns, Search API after notification, implementation manual, use of logs,
operations manual, search terminals by API, device manager (PDV/standalone switch),
device alerts, Access Token as header, fetch the notified payment, Integrator ID,
Platform ID, refunds API, settlement report, transactions report, and configurable
credentials.

**Documented fact, stale wording.** Items 1 and 2 of the implementation list name
`point_payment` and `payment_intent_id`, and describe a "payment_intent". The current
product API is the Orders API with `POST /v1/orders`. The checklist still uses the
Payment Intents vocabulary. **Record this.** It does not change the requirement, but it
means the checklist is not a specification for the body shape.

**Source-backed tradeoff.** Three of the seven implementation requirements map directly
to the Umi `/devices` plan: branch administration (item 3), POS administration (item 4),
and centralized credentials (item 7). Two best practices also map to it: search
terminals by API and device manager. The `/devices` menu is therefore a graded surface,
not an optional one.

### 5.5 What a real order is needed for

**Inference from the documented facts above.** A real, physical-terminal order is needed
for exactly three things:

1. The published quality score, which requires a production payment ID.
2. The `processed` path with a real card, because the virtual device is excluded from
   measurement.
3. The `order.action_required` operator flow, which is documented as a terminal-side
   action.

Everything else, including the full signature check, the six `action` values, the
retry behaviour, and the state machine, is reachable in the sandbox.

---

## 6. Homologation

### 6.1 The tool

**Documented fact.** The live MCP server exposes one tool for homologation:

> `form_homologation`: "Guided form to collect homologation information (product,
> platform, etc.). If any required field is missing, the tool will tell you exactly what
> to provide and which options are valid. Once all fields are complete, the tool will save
> the form via an API request."

**Documented fact.** The tool accepts two actions: `get_form` and `submit`. It requires
`product_id`.

**Documented fact.** The declared valid `product_id` values are:

| `product_id` | Product         |
| ------------ | --------------- |
| 21           | Checkout Pro    |
| 24           | Checkout API    |
| 26           | Checkout Bricks |
| 28           | Subscription    |
| 33           | QR Code         |
| 36           | Point           |
| 45           | Smart App       |

**Documented fact.** The tool also accepts `product` with the values `checkout`,
`in_person_payments`, and `qr_orders`; `platform` with the values `platform` and
`not_platform`; `site_id`; `lang`; `is_ca`; `form_values`; and `notes`.

### 6.2 The observed result

**Observed, 2026-09-17.** A live call with `action=get_form`, `product_id=36` (Point),
`site_id=MLM`, and `lang=en` returned:

```json
{
  "product_id": 36,
  "lang": "en",
  "site_id": "MLM",
  "is_ca": false,
  "steps": [],
  "warning": "No form steps found for the given product_id. Valid values: 21 (Checkout Pro), 24 (Checkout API), 26 (Checkout Bricks), 28 (Subscription), 33 (QR Code), 36 (Point), 45 (Smart App)."
}
```

**Observed.** A call without `product_id` returned an input validation error, and the
error confirms that `product_id` is required.

**UNVERIFIED.** The reason for the empty `steps` array is not known. Two candidate
reasons exist, and neither is confirmed: the Point product has no homologation form
behind this tool, or the current bearer token has no permission for it. The token in
`apps/umi-api/.env` belongs to a test user. **Do not conclude that Point needs no
homologation.** Re-run the call with an OAuth token of the real account.

**UNVERIFIED.** No documentation page read describes the homologation form contents, the
submission target, or the outcome of a submission.

---

## 7. Claims that need a decision

| #   | Claim                                              | Status                                                  | Action                                                            |
| --- | -------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | The order topic string is `orders`                 | Conflicts with the MCP value `order`                    | Read the stored value in the panel                                |
| 2   | The order notification body has a top-level `id`   | Conflicts with the six example bodies                   | Do not depend on it; dedupe on `data.id`, `action`, and `version` |
| 3   | `ts` is in milliseconds                            | Conflicts with the 10-digit example on the general page | Parse as an integer; state the freshness rule in code             |
| 4   | Test orders send notifications                     | Conflicts with the general page                         | Trust the Point page, per the vendor's precedence rule            |
| 5   | The Integrator ID is required for Point            | UNVERIFIED; no Point-specific instruction found         | Confirm with the vendor before the third-party launch             |
| 6   | Point has a homologation form                      | UNVERIFIED; the tool returned no steps                  | Re-run with a production OAuth token                              |
| 7   | The published quality score accepts a test payment | Conflicts with the quality page                         | Treat a production payment ID as mandatory                        |
| 8   | An IP allowlist protects the endpoint              | UNVERIFIED; not documented                              | Do not implement an invented range                                |
| 9   | `X-Retry` has a defined meaning                    | UNVERIFIED                                              | Do not use it for control flow                                    |
| 10  | Device alerts are available for Point              | UNVERIFIED; the topic is not in the panel list          | Skip until the panel shows it                                     |

---

## 8. URLs read

All documentation URLs are under `https://www.mercadopago.com.mx`. The `md` suffix was
appended to each path.

| URL                                                                | Result |
| ------------------------------------------------------------------ | ------ |
| `https://www.mercadopago.com.mx/developers/es/llms.txt`            | 200    |
| `https://www.mercadopago.com.mx/developers/es/docs/llms.txt`       | 200    |
| `.../en/docs/mp-point/notifications.md`                            | 200    |
| `.../en/docs/mp-point/go-to-production.md`                         | 200    |
| `.../en/docs/mp-point/integration-test.md`                         | 200    |
| `.../en/docs/mp-point/optional-notifications.md`                   | 200    |
| `.../en/docs/mp-point/resources/application-details.md`            | 200    |
| `.../en/docs/mp-point/resources/status-order-transaction.md`       | 200    |
| `.../en/docs/mp-point/resources/troubleshooting.md`                | 200    |
| `.../en/docs/mp-point/resources/security/landing-hub.md`           | 200    |
| `.../en/docs/mp-point-legacy/additional-content/certifications.md` | 200    |
| `.../en/docs/your-integrations/notifications/webhooks.md`          | 200    |
| `.../en/docs/your-integrations/notifications/additional-info.md`   | 200    |
| `.../en/docs/integration-quality.md`                               | 200    |
| `.../en/docs/checkout-api-orders/integration-quality.md`           | 200    |

Live MCP calls, all against `https://mcp.mercadopago.com/mcp` with the test Access Token
from `apps/umi-api/.env`:

| Call                                                          | Result                                               |
| ------------------------------------------------------------- | ---------------------------------------------------- |
| `initialize`                                                  | 200; server `mercadopago-mcp-server` version `1.0.0` |
| `tools/list`                                                  | 12 tools                                             |
| `quality_checklist`                                           | 7 implementation items, 18 good practices            |
| `form_homologation` `get_form` `product_id=36`                | Empty `steps` array with a warning                   |
| `form_homologation` `get_form` without `product_id`           | Input validation error                               |
| `notifications_history`                                       | "No Notifications Found" for this application        |
| `search_documentation` `order.action_required`                | 3 results, all already read                          |
| `search_documentation` `device alerts terminal notifications` | Results about SmartApps, not device alerts           |

**URLs that failed:** none. Every documentation request returned HTTP 200.

---

## 9. Open questions

1. **Which topic string does the panel store for the order topic, `order` or `orders`?**
   The two vendor sources disagree. Read the stored value, or call `save_webhook` and
   inspect the result.
2. **Does a Point integration need an Integrator ID, and in which field?** The
   certifications page gives no Point instruction, and the page read is the legacy path.
3. **Does the homologation form exist for Point?** The MCP returned no steps. Re-run the
   call with a production OAuth token.
4. **What is the documented replay window for the signature timestamp?** The page calls
   the check optional and gives no number.
5. **What is the extended retry interval after the third attempt?** The page states only
   that the interval grows.
6. **Is there a source CIDR range for notifications?** No page read publishes one.
7. **Which secret does a third-party integration use for the signature?** The vendor
   states that notifications are configured in the application of the main account, which
   implies one secret. That implies one shared secret across sellers, and it is not
   confirmed.
8. **Does the quality score accept a simulated order?** The published page and the MCP
   tool disagree.
