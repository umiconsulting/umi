# The Mercado Pago Point Orders API: the exact surface UmiPOS must implement

- Date: 2026-09-17 (local, America/Mazatlan). Server responses carry the 2026-09-17 UTC date.
- Scope: the request and response contract of the Orders API, the Terminals API, and the
  Stores and Points-of-Sale API. This file is the implementation reference.
- Method: primary sources only. Every constraint carries the exact quoted text and a URL.
- Related files: `../2026-09-16-mercadopago-point-usb/README.md` (the stage 1 index),
  `01-official-integration-paths.md` (product and partner facts), and
  `09-terminal-pairing-and-test-plan.md` (pairing and the two test levels). This file does
  not repeat their conclusions. It extends them with the field-level contract.

Labels used in this file:

| Label                  | Meaning                                               |
| ---------------------- | ----------------------------------------------------- |
| Documented fact        | A primary source states it. The URL is here.          |
| Source-backed tradeoff | Two sources disagree, or a source states a cost.      |
| Field observation      | I made a live call on 2026-09-17 and read the answer. |
| Inference              | I reason from documented facts.                       |
| UNVERIFIED             | No primary source confirmed it.                       |

## 0. The constraints the implementation must honour

Read this table first. Section numbers point to the evidence.

| #   | Constraint                                                                                                                     | Section  |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | -------- |
| 1   | Every write needs `X-Idempotency-Key`. The key is bound to the request body for 24 hours.                                      | 1.2, 7.4 |
| 2   | One terminal holds one order at a time. A second order gets `409 already_queued_order_for_terminal`.                           | 1.5      |
| 3   | `expiration_time` runs from `PT30S` to `PT3H`. The default is 15 minutes.                                                      | 1.3      |
| 4   | `GET /v1/orders/{order_id}` sees the last 3 months only. Persist the whole order at create time.                               | 2.1      |
| 5   | Cancel works only while `status=created`. After that, the terminal owns the cancellation.                                      | 3.1      |
| 6   | Refund works only while `status=processed`, for 90 days after the payment, and partial refunds need a card payment and no tip. | 4.1      |
| 7   | One point of sale holds one terminal in `PDV` mode. A second terminal gets `412`.                                              | 5.3      |
| 8   | Errors arrive in two different envelopes. Parse both.                                                                          | 7.1      |

## 1. `POST /v1/orders`

**Documented fact.** "This endpoint allows to create an order for Mercado Pago Point for
payment transactions. In case of success, the request will return a response with status
201." Source:
[Create order reference](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/orders/create-order/post.md),
read 2026-09-17.

### 1.1 Headers

| Header              | Type   | Required | Rule, quoted                                                                                                                                                                   |
| ------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Authorization`     | string | Required | `Bearer <ACCESS_TOKEN>`. The guide marks it "Required".                                                                                                                        |
| `Content-Type`      | string | Required | `application/json`, from every example.                                                                                                                                        |
| `X-Idempotency-Key` | string | Required | "This feature allows you to safely retry requests without the risk of accidentally performing the same action more than once." "We suggest using a UUID V4 or random strings." |

**Documented fact.** The missing header has its own error code: `400 empty_required_header`,
described as "The `X-Idempotency-Key` header is required and was not sent."

**Documented fact.** The window is fixed. `409 idempotency_key_already_used` means "The
value sent as the idempotency header has already been used with a different request within
the last 24 hours."

**Inference.** A retry loop must reuse the same key for the same order intent, and must
generate a new key for a new intent. The key is safe to reuse for at most 24 hours.

### 1.2 Body fields

**Source-backed tradeoff.** The reference marks every body field "optional". The
integration guide marks `type`, `transactions.payments.amount`, and
`config.point.terminal_id` as "Required". The reference also publishes the error
`400 required_properties`, "Some required properties are missing." Treat the guide as the
real contract, and send the reference's optional fields only when we need them.

| Field                                | Type   | Rule, quoted                                                                                                                                                                                                                                 | In code                                                                                                 |
| ------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `type`                               | string | "For Mercado Pago Point payments, the only possible value is `point`."                                                                                                                                                                       | Send the constant always.                                                                               |
| `external_reference`                 | string | "The maximum allowed limit is 64 characters, and the allowed characters are: uppercase and lowercase letters, numbers, and the symbols hyphen (-) and underscore (_). It must be a unique value for each order and cannot contain PII data." | Map from our tender attempt id. Strip anything outside `[A-Za-z0-9_-]`. Never put a customer name here. |
| `description`                        | string | "The maximum limit is 150 characters."                                                                                                                                                                                                       | Product or ticket summary.                                                                              |
| `expiration_time`                    | string | "The minimum allowed value is 30 seconds (PT30S) and the maximum is 3 hours (PT3H)." Examples: `PT30S`, `PT10M`, `PT1H15M`.                                                                                                                  | See 1.3.                                                                                                |
| `transactions`                       | object | "When the `type` is `point`, it is only possible to include 1 transaction per order."                                                                                                                                                        | Always exactly one.                                                                                     |
| `transactions.payments`              | array  | "Contains information about the payment order."                                                                                                                                                                                              | See 1.4.                                                                                                |
| `config.point.terminal_id`           | string | "You must send it according to the following format: `type of terminal + "__" + terminal serial`", for example `NEWLAND_N950__SBX0000001`.                                                                                                   | Store the exact string from `GET /terminals/v1/list`. Never rebuild it.                                 |
| `config.point.print_on_terminal`     | string | "Its default value will be `seller_ticket`." Enum: `seller_ticket`, `no_ticket`.                                                                                                                                                             | Our choice. See 1.4.                                                                                    |
| `config.payment_method.default_type` | string | "If not sent, the terminal operates with its default configuration, accepting all available payment methods and allowing the customer to choose." Enum: `debit_card`, `credit_card`.                                                         | Send nothing to let the customer choose. Send a value only to force a type.                             |
| `integration_data.platform_id`       | string | "Identifier of the platform, assigned by Mercado Pago."                                                                                                                                                                                      | UNVERIFIED for our case. We do not have a platform id yet.                                              |
| `integration_data.integrator_id`     | string | "Identifier of the user who develops the integration that creates the order, assigned by Mercado Pago."                                                                                                                                      | Comes from the developer certification. See 1.6.                                                        |
| `integration_data.sponsor.id`        | string | "Mercado Pago's USER_ID of the integrator system."                                                                                                                                                                                           | The integrator's own user id.                                                                           |

**Documented fact.** `type` is an enum of one value: `point`. Source as above.

**Documented fact.** The reference marks the field optional, but its own cURL example sends
`"print_on_terminal": "no_ticket"`. The response example echoes the value back.

### 1.3 `expiration_time`, the one field with a hard window

**Documented fact.** "Indicates the **validity period** of the payment order from its
creation. During this time, the order will be available for processing by the customer; if
it is not processed within the specified period, it will automatically expire and cannot be
used, requiring the generation of a new payment order to continue. The minimum allowed
value is 30 seconds (PT30S) and the maximum is 3 hours (PT3H)."

**Documented fact.** "Keep in mind that if you do not fill in the `expiration_time`
parameter, the payment must be made within 15 minutes of the order's creation; after that
time, the order will expire." Source:
[Payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing.md).

**Inference.** The value is an ISO-8601 duration, and the server compares it against the
create time. A till that keeps an order open longer than the window will read `expired`,
and must create a new order. The `PT3H` ceiling matters for a bar or a table that stays open
for hours.

### 1.4 `transactions.payments`, and the fields that are not there

| Field                            | Type   | Rule, quoted                                                                         |
| -------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| `transactions.payments[].amount` | string | Reference: "Payment total amount. The field can contain two decimal places or none." |

**Source-backed tradeoff, and it matters.** The reference says two decimals or none. The
integration guide says the opposite: `El campo debe llevar obligatoriamente 2 números
decimales, incluso cuando es un número entero (por ejemplo, "10.00")`. Same vendor, two
pages, one session. Send two decimals always. A string with no decimal point risks a
validation error that the reference page would not predict.

**Documented fact, and a trap.** The create-order request does **not** document
`transactions.payments[].payment_method`, and it does **not** document
`transactions.payments[].installments`. The task brief suspected both. They are not in the
request schema. `installments` appears only in three other places:

- the create-order **response**, as `config.payment_method.default_installments`, echoed as
  `"6"` in the guide's example;
- the create-order **response**, as `transactions.payments[].payment_method.installments`,
  an integer;
- the **simulation** body, as the optional `installments` field.

**Documented fact.** The installments plan is account configuration, not a request field.
"If you want the installments set to be with or without interests, before creating an
order, you must **set them up in your Mercado Pago account**." Source:
[Payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing.md).

**Inference.** The customer picks the installment count on the terminal. Our API call sets
the amount, the terminal, the receipt mode, and an optional card-type restriction. Nothing
else about the card. This keeps the payment data inside the device, which is the PCI shape.

**Documented fact.** `print_on_terminal` has exactly two values, and both are quoted above:
`seller_ticket`, "Value that determines the printing of the ticket for the seller", and
`no_ticket`, "Value that determines that the ticket must not be printed."

**Inference.** `seller_ticket` is the default, so a till that wants no paper must send
`no_ticket` explicitly.

### 1.5 The 201 response

**Documented fact.** The response carries `status: "created"` and `status_detail:
"created"`, plus `id`, `type`, `user_id`, `external_reference`, `description`,
`expiration_time`, `processing_mode`, `country_code`, `integration_data`, `created_date`,
`last_updated_date`, `config`, and `transactions`. Source: the same reference page.

| Response field               | Note                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `id`                         | The order id, for example `ORD00001111222233334444555566`. This is the handle for get, cancel, and refund.                     |
| `transactions.payments[].id` | The payment id, for example `PAY01J67CQQH5904WDBVZEM4JMEP3`. **The partial refund needs this exact value.**                    |
| `processing_mode`            | "For Point orders, the only allowed value is `automatic`, that sets the order to be ready to process."                         |
| `country_code`               | The reference example carries `MX`. The guide example carries `MEX`. Source-backed tradeoff on the string. Do not validate it. |

**Documented fact.** The vendor states the storage requirement in its own words: "Since the
order is the basis for payment processing, it's important that you save both its `id` and
the payment `id` (`transactions.payments.id`) obtained when creating it, as they will allow
you to perform other operations and properly query your notifications."

**Inference.** Persist the order id and the payment id in the same transaction that starts
the tender attempt. A lost payment id makes a partial refund impossible.

**Documented fact, the operational constraint.** A terminal serialises orders. The error
`409 already_queued_order_for_terminal` means "The terminal already has an order waiting. It
is necessary to finalize or cancel it to send new orders." Source: the same reference page.

**Inference.** The till must treat one order per terminal as a lock, and must show a clear
state for "the terminal is busy with another order".

### 1.6 `integration_data` and the certification

**Documented fact.** The `<dev>program` issues an Integrator ID after a free certification
test, and the ID goes into `integration_data.integrator_id`. Source:
[Your certifications](https://www.mercadopago.com.mx/developers/en/docs/mp-point-legacy/additional-content/certifications.md).

**UNVERIFIED.** The exact certification steps, the timing, and whether Mercado Pago demands
the pair `platform_id` and `integrator_id` before it accepts production traffic. The fields
are optional in the reference. The MCP server exposes a tool named `form_homologation`,
which suggests a form-based process.

### 1.7 The error set for create

**Documented fact.** Exact code strings and meanings, from the reference page:

| Status | Code                                | What our control flow does                                                                                                                                       |
| ------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `empty_required_header`             | A bug in our client. The idempotency header is missing.                                                                                                          |
| 400    | `required_properties`               | A bug in our payload. Read `errors[].message` for the field.                                                                                                     |
| 400    | `unsupported_properties`            | A field we sent does not exist. A bug in our client.                                                                                                             |
| 400    | `minimum_properties`                | A required group is absent.                                                                                                                                      |
| 400    | `property_type`                     | A wrong type, for example an integer for a string. "For example, an `integer` value for a `string` property."                                                    |
| 400    | `minimum_items`                     | Too few items, for example an empty `transactions.payments`.                                                                                                     |
| 400    | `maximum_items`                     | "A greater number of items were sent than allowed." This is the two-payment case.                                                                                |
| 400    | `property_value`                    | A bad value, for example an unknown `terminal_id`.                                                                                                               |
| 400    | `json_syntax_error`                 | Malformed JSON. A bug in our client.                                                                                                                             |
| 401    | `unauthorized`                      | "The value sent as Access Token is incorrect." Refresh or re-authorize.                                                                                          |
| 403    | `forbidden_checking_terminal_owner` | "The Point terminal does not belong to the user who submitted the request." This is the per-merchant credential error. It is the one to surface to the operator. |
| 409    | `idempotency_key_already_used`      | Same key, different body, inside 24 hours. Generate a new key.                                                                                                   |
| 409    | `already_queued_order_for_terminal` | The terminal is busy. Wait, or cancel the earlier order.                                                                                                         |
| 500    | `idempotency_validation_failed`     | "Validation fail. Please try submitting the request again." Retry is safe with the same key.                                                                     |
| 500    | `500`                               | "Generic error." Retry with backoff.                                                                                                                             |

**Inference.** `403 forbidden_checking_terminal_owner` is the single most likely production
failure for a multi-merchant product, because it fires when the token and the terminal
disagree. The till must map it to a configuration error, never to a payment failure.

## 2. `GET /v1/orders/{order_id}`

**Documented fact.** "This endpoint allows to consult all order information using the ID
obtained in the response to its creation, as long as it was created less than 3 months ago.
In case of success, the request will return a response with status 200." Source:
[Get order by ID](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/orders/get-order/get.md).

### 2.1 The age limit is the reason to persist

**Documented fact.** The documented read window is 3 months. Nothing in the reference
extends it.

**Inference.** Our database is the long-term record. The API is a freshness check and a
reconciliation tool with a 90-day life. A refund at day 89 needs a locally stored payment
id, because that is inside the same window but close to its edge.

### 2.2 The fields we must persist

| Field                                                                 | Why we store it                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `id`                                                                  | The order handle.                                                                          |
| `status`, `status_detail`                                             | The tender outcome.                                                                        |
| `external_reference`                                                  | The link back to our attempt.                                                              |
| `user_id`                                                             | The merchant account that owns the order. It proves the credential context.                |
| `transactions.payments[].id`                                          | The payment handle for a partial refund.                                                   |
| `transactions.payments[].amount`                                      | The requested amount.                                                                      |
| `transactions.payments[].paid_amount`                                 | The real total.                                                                            |
| `transactions.payments[].refunded_amount`                             | The refunded total.                                                                        |
| `transactions.payments[].tip_amount`                                  | **The terminal can add a tip.**                                                            |
| `transactions.payments[].status`, `status_detail`                     | The card outcome, including every refusal reason.                                          |
| `transactions.payments[].reference_id`                                | "ID of the payment associated with the order." The reconciliation key for a report.        |
| `transactions.payments[].payment_method.type`, `.id`, `.installments` | The card type, the brand, and the installment count.                                       |
| `transactions.payments[].card.first_digits`, `.last_digits`           | The card partials. Present only for a card payment.                                        |
| `transactions.payments[].provider`                                    | "This field only applies to payments made with a QR code." Enum `mercadopago`, `external`. |
| `transactions.refunds[]`                                              | Every refund, with `id`, `transaction_id`, `reference_id`, `amount`, `status`.             |
| `created_date`, `last_updated_date`                                   | The ordering key for a webhook that arrives out of order.                                  |

**Documented fact, the tip.** "`transactions.payments[].tip_amount` (string, optional): Tip
amount, sent from the terminal when making the payment." And "`paid_amount` (string,
optional): It is the total paid amount. If the payment was tips, that amount will be
reflected."

**Inference.** The amount we send is not always the amount the customer pays. The
reconciliation must compare `paid_amount`, not `amount`, and must require a tip permission
on the account or a documented explanation if a tip appears.

**Documented fact, the full `status` enum for the order.** `created`, `at_terminal`,
`canceled`, `processed`, `failed`, `refunded`, `action_required`. `action_required` carries
this text: "The transaction associated with the order needs to be confirmed. Check the
terminal to verify the final status and make sure to update your system accordingly, as this
is a status that will not be changed."

**Documented fact, the full `status_detail` enum for the transaction.** `created`,
`at_terminal`, `check_on_terminal`, `canceled`, `canceled_by_api`, `canceled_on_terminal`,
`accredited`, `failed`, `refunded`, `amount_limit_exceeded`, `bad_filled_card_data`,
`required_call_for_authorize`, `card_disabled`, `high_risk`, `insufficient_amount`,
`invalid_installments`, `max_attempts_exceeded`, `processing_error`, `in_review`.

**Documented fact, the order-level detail set.** `created`, `processed`,
`partially_refunded`, `action_required`, `at_terminal`, `failed`, `refunded`, `expired`.
Source:
[Status of an order and a transaction](https://www.mercadopago.com.mx/developers/en/docs/mp-point/resources/status-order-transaction.md).

**Documented fact, the machine.** The same page publishes the state diagram. `created`
leads to `expired`, `canceled`, or `at_terminal`. `at_terminal` leads to `canceled`,
`processed`, `failed`, `action_required`, or `expired`. `processed` leads to `refunded`.
There is no path out of `refunded`, and there is no path out of `action_required`.

**Inference.** `action_required` is terminal. The state machine in our code must have no
transition from it. The operator resolves it at the terminal and the webhook or a poll
carries the truth.

### 2.3 The errors

**Documented fact.** `400 bad_request`, "The order_id provided in the request path is not
correct." `401 unauthorized`. `404 order_not_found`, "Order not found. Please check if you
provided the correct order ID." `500` internal.

**Field observation, 2026-09-17.** A live `GET /v1/orders/not-an-id` answered `400` with
`{"errors":[{"code":"invalid_path_param","message":"path param order id is invalid"}]}`.
The reference page names the code `bad_request` for the same condition. The live code string
is `invalid_path_param`. The refund page uses `invalid_path_param` too, with the rule "It
must start with the prefix `ORD` and be followed by 26 characters."

**Field observation, 2026-09-17.** A live `GET /v1/orders/ORD00000000000000000000000000`
answered `404` with `{"errors":[{"code":"order_not_found","message":"Order not found."}]}`.

## 3. Cancel an order

**Documented fact.** `POST /v1/orders/{order_id}/cancel`, with the required header
`X-Idempotency-Key`. "Only an order in `status=created` can be canceled. In case of success,
the request will return a response with status 200." Source:
[Cancel order by ID](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/orders/cancel-order/post.md).

### 3.1 The precondition, and the two cancellation paths

**Documented fact.** "An order can be cancelled in two ways, depending on its status. If the
order's `status` is `created`, its cancellation must be done via API. If the `status` is
`at_terminal`, it has already been retrieved by the terminal and must be cancelled from
there." Source:
[Payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing.md).

**Documented fact.** The terminal path is manual. "To cancel it you'll need to exit the
screen without completing the charge. To do this, press the **bottom right button** on the
terminal. Then, when asked if you want to exit without finishing, choose the **Yes**
option."

### 3.2 The response, and the deferred cancellation

**Documented fact.** The response `status` enum has two values, `canceled` and
`at_terminal`. The second carries this meaning: "The cancellation request via API was
accepted, but the cancellation will only be effective after receiving a cancellation
notification." The same distinction appears in `status_detail`.

**Inference.** A `200` from cancel does not always mean the order is dead. A till must treat
`status: "at_terminal"` in a cancel response as accepted but pending, and must wait for
`order.canceled` before it frees the terminal.

**Documented fact.** `transactions.payments[].status_detail` gains the value
`canceled_by_api` when the cancellation came through this endpoint.

### 3.3 The errors

**Documented fact.** Exact code strings:

| Status | Code                           | Meaning                                                                                                                                                              |
| ------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `empty_required_header`        | The idempotency header is missing.                                                                                                                                   |
| 400    | `bad_request`                  | The order id in the path is wrong.                                                                                                                                   |
| 401    | `unauthorized`                 | The token is wrong.                                                                                                                                                  |
| 404    | `order_not_found`              | The order id does not exist.                                                                                                                                         |
| 409    | `idempotency_key_already_used` | Same key, different request.                                                                                                                                         |
| 409    | `cannot_cancel_order`          | "orders can only be cancelled via API when `status=created`. If you are trying to cancel an order with `status=at_terminal`, you will need to do from the terminal." |
| 409    | `order_already_canceled`       | "The order has already been canceled."                                                                                                                               |

**Inference.** `409 cannot_cancel_order` is a normal race, not an error. The terminal
grabbed the order between our read and our cancel. The till must re-read the order instead
of showing a failure.

## 4. Refund an order

**Documented fact.** `POST /v1/orders/{order_id}/refund`. Source:
[Refund order](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/orders/refund-order/post.md).

### 4.1 The four preconditions

**Documented fact.** Quoted from the reference page:

1. "only orders with `status=processed` can be refunded"
2. "Both types of refunds can be made up to 90 days after the payment is made."
3. "they are only available for payments that were made with card" (the guide states this
   for partial refunds)
4. "the total amount refunded does not exceed the full value of the transaction"

**Documented fact.** The guide adds a fifth, narrower rule: "Partial refunds are available
for payments made with card." Source:
[Payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing.md).

**Documented fact.** The reference page adds a sixth: `403 partial_refund_forbidden_with_tips`,
"Partial refunds are not allowed when the order has tips."

**Inference.** A tip on an order closes the partial-refund path entirely. An order with a
tip needs a full refund, or a manual path.

### 4.2 Total refund

**Documented fact.** "To make a **total** refund of an order, send a **POST** to the endpoint
`/v1/orders/{order_id}/refund` **without sending a body** in the request."

**Documented fact.** The header `X-Idempotency-Key` is required. The success status is
**201**.

**Documented fact.** The response carries `status=refunded` and `status_detail=refunded`,
plus a `transactions.refunds` array with `id`, `transaction_id`, `reference_id`, `amount`,
and `status`.

**Source-backed tradeoff on the refund status.** The reference lists the refund status enum
as `processing`, described as "The total refund was successfully requested and is being
processed." The guide's total-refund example shows `"status": "processed"`. Treat a refund
as asynchronous, and wait for `order.refunded`.

### 4.3 Partial refund

**Documented fact.** Send the `transactions` array in the body:

```json
{ "transactions": [ { "id": "PAY01J67CQQH5904WDBVZEM4JMEP3", "amount": "24.50" } ] }
```

| Field                   | Type   | Rule, quoted                                                                                                                                        |
| ----------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transactions[].id`     | string | "Identifier of the payment transaction created in the request, obtained in the response to the creation of the order (`transactions.payments.id`)." |
| `transactions[].amount` | string | "Amount to be refunded. Must be less than the original transaction value. The field can contain two decimal places or none."                        |

**Documented fact.** "You can perform multiple partial refunds, as long as the sum does not
exceed the total transaction amount."

**Documented fact.** The success response carries `status=processed` "if there is still
balance in the order", and `status_detail=partially_refunded`.

### 4.4 The error set, which is the widest in the API

**Documented fact.** Exact code strings:

| Status | Code                                       | Meaning for our control flow                                                                 |
| ------ | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 400    | `empty_required_header`                    | The idempotency header is missing.                                                           |
| 400    | `invalid_path_param`                       | "It must start with the prefix `ORD` and be followed by 26 characters."                      |
| 400    | `unsupported_partially_refunds`            | "Due to internal validations, the order does not support partial refunds."                   |
| 400    | `refund_amount_exceeds`                    | "Refund amount exceeds the available amount."                                                |
| 401    | `unauthorized`                             | The token is wrong.                                                                          |
| 401    | `user_not_authorized`                      | "User not authorized to perform this action."                                                |
| 403    | `partial_refund_forbidden_with_tips`       | The order has a tip. Use a total refund.                                                     |
| 404    | `order_not_found`                          | The order id does not exist.                                                                 |
| 404    | `transaction_not_found`                    | The payment id is wrong or belongs to another order.                                         |
| 409    | `idempotency_key_already_used`             | Same key, different request.                                                                 |
| 409    | `order_already_refunded`                   | "The order was already refunded."                                                            |
| 409    | `cannot_refund_order`                      | "The order status does not allow refund."                                                    |
| 409    | `refund_period_exceeded`                   | The 90-day window closed.                                                                    |
| 409    | `action_not_allowed_for_current_state`     | A state conflict.                                                                            |
| 409    | `refund_in_progress`                       | "Refund in progress, please wait a few minutes."                                             |
| 409    | `movement_operations_pending`              | "The order has pending movements, please wait a few minutes."                                |
| 422    | `payment_not_refundable`                   | "It is not possible to refund this payment."                                                 |
| 422    | `amount_not_refundable`                    | "The amount cannot be refunded, try with another amount."                                    |
| 422    | `max_refunds_exceeded`                     | "The maximum number of refunds for this order has been exceeded."                            |
| 425    | `order_payment_not_yet_enabled_for_refund` | "The order is not yet enabled for refund, please try again later."                           |
| 428    | `insufficient_money_for_refund`            | "insufficient money in the account." This is a merchant-balance problem, not a till problem. |

**Inference.** Four of these codes tell the operator the same thing: wait and retry, with no
code change. They are `409 refund_in_progress`, `409 movement_operations_pending`,
`425 order_payment_not_yet_enabled_for_refund`, and `500 idempotency_validation_failed`. The
refund service needs a bounded retry with backoff on exactly that set.

**Inference.** `409 refund_period_exceeded` and `428 insufficient_money_for_refund` need a
distinct message in the dashboard, because the fix is human: a manual refund from the panel,
or a balance top-up.

## 5. Terminals

### 5.1 `GET /terminals/v1/list`

**Documented fact.** "This endpoint allows you to obtain a list of the Point terminals
active in your account, with the information corresponding to their respective point of
sale, store, and operating mode. The only terminals allowed for this request are
NEWLAND_N950 and PAX_A910. In case of success, the request will return a response with
status 200." Source:
[Get list of terminals](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/terminals/get-terminals/get.md).

| Query      | Type    | Rule, quoted                                                                                              |
| ---------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `limit`    | integer | "greater than or equal to 1 and less than or equal to 50. The default value is 50."                       |
| `offset`   | integer | "greater than or equal to zero (0). Its default value is zero (0)."                                       |
| `store_id` | string  | "the store identifier, which corresponds to the `id` parameter obtained in the response to its creation." |
| `pos_id`   | integer | "the device Point of Sale identifier."                                                                    |

**Documented fact, the response:**

| Field                                           | Type    | Note                                                                                  |
| ----------------------------------------------- | ------- | ------------------------------------------------------------------------------------- |
| `data.terminals[].id`                           | string  | "Unique identifier of the terminal." Format `terminal type + "__" + terminal serial`. |
| `data.terminals[].pos_id`                       | integer | The point of sale. The reference types it integer.                                    |
| `data.terminals[].store_id`                     | string  | The store. The reference types it string.                                             |
| `data.terminals[].external_pos_id`              | string  | Our own external id for the point of sale.                                            |
| `data.terminals[].operating_mode`               | string  | `PDV`, `STANDALONE`, or `UNDEFINED`.                                                  |
| `paging.total`, `paging.offset`, `paging.limit` | integer | Pagination.                                                                           |

**Source-backed tradeoff on the types.** `pos_id` is a string in the guide's example
(`"23545678"`) and an integer in the reference's schema and example (`47792476`).
`store_id` is a string in both. Parse both as strings, and never compare them with `===`
against a number.

**Documented fact, the identification rule.** "You can identify the desired Point terminal
by the last characters of this field, which should match the serial number displayed on the
back label of the terminal."

**Field observation, 2026-09-17.** A live call with the test token returned
`{"data":{"terminals":[]},"paging":{"total":0,"limit":50,"offset":0}}` with HTTP 200. The
test account holds no terminal. This matches `../2026-09-16-mercadopago-point-usb/07-test-credentials-scope.md`.

**Field observation, 2026-09-17.** A live call with `limit=99` answered `200` and
`"limit": 50`. The server clamps an out-of-range limit instead of rejecting it. The
documented ceiling holds.

**Documented fact.** The only errors are `401 unauthorized` and `500 internal_error`.

### 5.2 `PATCH /terminals/v1/setup`

**Documented fact.** "This endpoint allows you to change the terminal operating mode. The
only terminals allowed for this request are NEWLAND_N950 and PAX_A910. In case of success,
the request will return a response with status 200." Source:
[Update terminal operation mode](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/terminals/update-operation-mode/patch.md).

**Documented fact.** No `X-Idempotency-Key` header appears in this reference page. It is the
one write endpoint in the Point family without it.

Request body:

```json
{ "terminals": [ { "id": "NEWLAND_N950__N950NCB801293324", "operating_mode": "PDV" } ] }
```

Response body:

```json
{ "terminals": [ { "id": "NEWLAND_N950__N950NCB801293324", "operating_mode": "PDV" } ] }
```

### 5.3 The meaning of every `operating_mode`

**Documented fact.** On the list response, the enum has three values:

| Value        | Meaning, quoted                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PDV`        | "Point of Sale (POS) operating mode. It is the mode in which the terminal operates when integrated via API for traditional operator-assisted service." |
| `STANDALONE` | "Default terminal configuration. It's when the terminal is not integrated with the API."                                                               |
| `UNDEFINED`  | "The configuration that the terminal has is not recognized."                                                                                           |

**Documented fact.** On the `setup` request and response, the enum has two values only:
`PDV` and `STANDALONE`. `UNDEFINED` is read-only. The page adds, for `STANDALONE`: "It's
when the terminal is not integrated with the API and does not allow reconciliations between
integrator systems and Mercado Pago, so its use is not recommended."

**Documented fact.** "Since the only operating mode that allows integrating terminals via
API is PDV, once you have located the desired Point terminal, you must activate it."

**Documented fact, the restart requirement.** "To finish configuring your terminal, you must
restart it and then verify that it has been applied by going to **More options > Settings >
Pairing mode**. If you find that the pairing mode is **Point of Sale (PDV)**, the change in
operating mode was effective."

**Documented fact, the one-terminal rule.** The HTTP `412` error carries the text "Only one
pos-store with PDV mode ON or SUSPENDED is allowed", described as "Operation not allowed
because there is already a terminal associated with the point of sale, and each point of
sale allows only one associated terminal in POS mode."

**Documented fact, the error set.** Exact strings: `400 unsupported_site` ("The only
available locations/sites are Argentina, Brazil, Chile and Mexico"), `400
unsupported_properties`, `400 required_properties`, `400 property_value`, `400
invalid_payload`, `401 unauthorized`, `403 terminal_not_allowed_action` ("The only terminals
allowed for this request are PAX_A910 and NEWLAND_N950"), `403 store_pos_not_found` ("The
terminal used does not have a store associated or, if there is a store, it does not have a
point of sale created"), `404 not_found`, `412`, `500 internal_error`.

**Inference.** `403 store_pos_not_found` is the error a new merchant hits. A terminal with
no store and no point of sale cannot enter `PDV` mode. The dashboard must create the store
and the point of sale first, then set the mode, then ask the operator to restart the device.

**Documented fact, the recovery path.** If the order flow breaks on the vendor's side, the
documented workaround is `STANDALONE`. "This change should be temporary. You will need to
return your terminal to PDV mode when the service is restored." Source:
[Troubleshooting](https://www.mercadopago.com.mx/developers/en/docs/mp-point/resources/troubleshooting.md).

## 6. Stores and points of sale

### 6.1 The endpoints

**Documented fact.** From the reference sitemap and the individual pages:

| Operation             | Method and path                                   | Status                              |
| --------------------- | ------------------------------------------------- | ----------------------------------- |
| Create store          | `POST /users/{user_id}/stores`                    | 200 or 201. See the tradeoff below. |
| Search stores         | `GET /users/{user_id}/stores/search?external_id=` | 200                                 |
| Get store             | `GET /stores/{id}`                                | 200                                 |
| Update store          | `PUT /users/{user_id}/stores/{id}`                | 200                                 |
| Delete store          | `DELETE /users/{user_id}/stores/{id}`             | —                                   |
| Create point of sale  | `POST /v2/pos`                                    | 201                                 |
| Search points of sale | `GET /v2/pos`                                     | 200                                 |
| Get point of sale     | `GET /v2/pos/{pos_id}`                            | 200                                 |
| Update point of sale  | `PATCH /v2/pos/{pos_id}`                          | 200                                 |
| Delete point of sale  | `DELETE /v2/pos/{pos_id}`                         | —                                   |

**Source-backed tradeoff on the create status.** The create-store reference says "A status
200 indicates that the request has been successfully processed." The guide and a live call
both show `201`. Read the resource, not the status code.

**Field observation, 2026-09-17.** A live `201` from `POST /users/{id}/stores` created store
`87482378`, and a live `201` from `POST /v2/pos` created point of sale `138301467`. This
matches `../2026-09-16-mercadopago-point-usb/07-test-credentials-scope.md`.

**Documented fact.** `user_id` "corresponds to the collector_id. It refers to the user_id of
the Mercado Pago account that receives the money from sales, that is, the account
responsible for collecting the funds."

**Inference.** The `user_id` in the path is the merchant's. In a third-party model it comes
from the OAuth token response, not from our own account. It is the same value the order
response returns as `user_id`, so it is a cheap consistency check.

### 6.2 Create store, field constraints

| Field                    | Type   | Rule, quoted                                                                                                                                                                                                          |
| ------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                   | string | "Store name." The error list adds: "Ensure the `name` value is textual without numeric or special characters."                                                                                                        |
| `business_hours`         | object | "They are divided by day of the week and up to four opening and closing times per day are allowed." Keys are day names: `monday`, `tuesday`, and so on. `open` and `close` are "24-hour format", for example `08:00`. |
| `external_id`            | string | "It can contain any alphanumeric value up to 60 characters, and must be unique for each store."                                                                                                                       |
| `location`               | object | "It is essential that this field is filled with the accurate location data of the store, as this can prevent issues related to tax collection."                                                                       |
| `location.street_number` | string | "Street number." A string, not a number.                                                                                                                                                                              |
| `location.street_name`   | string | "Street name."                                                                                                                                                                                                        |
| `location.city_name`     | string | "City."                                                                                                                                                                                                               |
| `location.state_name`    | string | "State."                                                                                                                                                                                                              |
| `location.latitude`      | number | "You must pay particular attention to completing them correctly with the simple decimal standard."                                                                                                                    |
| `location.longitude`     | number | Same rule.                                                                                                                                                                                                            |
| `location.reference`     | string | "Landmark of the provided address."                                                                                                                                                                                   |

**Documented fact.** The vendor states the fiscal stake in its own words: "Incorrect data
can cause errors in tax calculations, directly impacting billing and fiscal compliance of
your company."

**Field observation, 2026-09-17.** `location.city_name` is a closed catalogue with accents.
`Culiacan` is refused, and `Culiacán` is accepted. The error response lists the valid cities
of the state. This is recorded in
`../2026-09-16-mercadopago-point-usb/07-test-credentials-scope.md`.

**Inference.** The dashboard must offer a picker fed by the catalogue, not a free text
field. A free text city field will fail at the store step, and it will fail in Mexican
Spanish, from a server-side validation list.

**Documented fact, the store errors.** Exact strings: `400 UNKNOWN_FIELD`, `400
INVALID_NAME`, `400 BAD_REQUEST`, `400 INVALID_BUSINESS_HOURS`, `400 INVALID_DAY`, `400
INVALID_LOCATION`, `400 INVALID_STREET_NAME`, `400 INVALID_STREET_NUMBER`, `400
INVALID_CITY_NAME`, `400 INVALID_STATE_NAME`, `400 INVALID_REFERENCE`, `400
VALIDATION_ERROR`, `403 Forbidden` ("make sure that the user_id used is the same as your
account").

### 6.3 Create point of sale, field constraints

| Field               | Type   | Rule, quoted                                                                                                                                                                                                                                                    |
| ------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `X-Idempotency-Key` | header | Required. "The header accepts values between 1 and 64 characters."                                                                                                                                                                                              |
| `name`              | string | "Only alphanumeric characters, hyphens, underscores, and internal spaces are allowed. The value cannot start or end with a space. The maximum allowed limit is 45 characters. If not provided, the API automatically sets the `external_id` value as the name." |
| `store_id`          | string | "Only digits are allowed. The maximum allowed limit is 20 characters. Required if `external_store_id` is not provided. If both are sent, they must refer to the same store."                                                                                    |
| `external_store_id` | string | "The maximum allowed limit is 60 characters. Required if `store_id` is not provided."                                                                                                                                                                           |
| `external_id`       | string | "Must contain only alphanumeric characters (letters and numbers). The maximum allowed limit is 40 characters. This value must be unique per point of sale per user."                                                                                            |

**Field observation, 2026-09-17.** The hyphen rule on `external_id` is real and sharp:
`external_id does not meet the expected format`, while `umipos001` is accepted. Also, a
numeric `store_id` is refused with `store_id expected string, but got number`, and a missing
header is refused with `Missing X-Idempotency-Key header`. Recorded in the same file as
above.

**Inference.** Our device ids must avoid hyphens if we plan to use them as `external_id`.
This conflicts with the common UUID shape. Derive the `external_id` from the device id with
the hyphens removed, or use a separate counter.

**Documented fact.** The response carries `id`, `name`, `status` (`active` or `inactive`),
`date_created`, `date_last_updated`, `user_id`, `external_id`, a `qr_response` object, and a
`config` object.

**Documented fact, the `config` object.** `config.qr.operating_mode` has four values:
`pdv`, `unattended`, `self_service`, `standalone`. `config.qr.category` is an MCC code.

**Documented fact.** The reference adds: "It can only be used if you have integrated the QR
Code payment solution." The `qr_response` object is present in every example.

**Documented fact, the errors.** Exact strings: `400 bad_request` ("at least one of
`store_id` or `external_store_id` is provided"), `400 idempotency_key_already_used`, `400
invalid_external_store_id`, `401 unauthorized`, `404 store_not_found`, `409
pos_already_exists` ("A point of sale with the same `external_id` already exists for this
user"), `409 conflict` ("The same request is already being processed by another concurrent
call with the same X-Idempotency-Key"), `422 unprocessable_entity`, `424
internal_error_check_store_owner`, `500 internal_server_error`.

### 6.4 The endpoints that do not exist

**Documented fact.** The Point reference sitemap lists `Create order`, `Get order by ID`,
`Cancel order by ID`, `Refund order`, and `Simulate order status`. There is **no** documented
search or list endpoint for Point orders.

**Inference.** This is why the webhook is not optional. There is no "find my orders" call to
reconcile a batch. Our own database is the only index of our orders, and the API can only
answer by id.

## 7. The error catalogue, and how to read it

### 7.1 Two envelopes, and this is the first thing to implement

**Field observation, 2026-09-17.** The Point API answers with two different JSON shapes.

An authentication failure is flat:

```json
{"code": "unauthorized", "message": "user not found"}
```

```json
{"code": "unauthorized", "message": "authorization value not present"}
```

A resource or validation failure nests an array:

```json
{"errors": [{"code": "order_not_found", "message": "Order not found."}]}
```

```json
{"errors": [{"code": "invalid_path_param", "message": "path param order id is invalid"}]}
```

**Inference.** An error parser that reads only `body.code` will miss every 400, 403, 404,
409, 422, 425, and 428 from the order, terminal, and store endpoints. Read
`errors[0].code` first, then fall back to `code`.

**Documented fact.** The reference pages document the codes in a table with the columns
`Status`, `Error`, and `Description`. They do not publish the envelope. The envelope comes
from the live calls above.

### 7.2 The codes that need a distinct control-flow branch

| Code                                                                                            | Branch                                                                |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `empty_required_header`                                                                         | Programmer error. Fail loudly and never retry.                        |
| `unauthorized`, `user_not_authorized`                                                           | Credential error. Refresh the token, then retry once.                 |
| `forbidden_checking_terminal_owner`                                                             | Configuration error. Show the merchant a setup message. Do not retry. |
| `idempotency_key_already_used`                                                                  | Generate a new key and retry.                                         |
| `already_queued_order_for_terminal`                                                             | Terminal busy. Do not retry blindly. Read the open order first.       |
| `cannot_cancel_order`, `order_already_canceled`                                                 | Race. Re-read the order.                                              |
| `refund_in_progress`, `movement_operations_pending`, `order_payment_not_yet_enabled_for_refund` | Bounded retry with backoff.                                           |
| `insufficient_money_for_refund`                                                                 | Merchant balance. Escalate to a human.                                |
| `refund_period_exceeded`                                                                        | The 90-day window closed. Escalate to a human.                        |
| `store_pos_not_found`, `store_not_found`, `pos_already_exists`                                  | Setup error. Send the merchant to the device screen.                  |
| `500`, `idempotency_validation_failed`, `internal_error`, `internal_server_error`               | Retry with backoff, same idempotency key.                             |

### 7.3 Duplicate codes with different meanings

**Documented fact.** `bad_request` appears on the get-order, cancel, and simulate pages. The
get-order page defines it as a wrong `order_id`. The simulate page defines it three ways: a
non-ULID id, an invalid body, and an invalid state transition. The live get-order call
answered `invalid_path_param` instead.

**Inference.** Read the `message`, not only the code, when `bad_request` appears. The code
alone does not identify the cause.

**Documented fact.** `idempotency_key_already_used` is `409` on the order and refund pages,
and `400` on the point-of-sale page. The status differs between endpoints for the same
logical condition.

### 7.4 The idempotency rules, collected

**Documented fact.** Quoted from the create-order and refund pages:

- "If you use a value already assigned to another request, you will receive information
  corresponding to that created resource in response, not this new request."
- "The value sent as the idempotency header has already been used with a different request
  within the last 24 hours."
- "Use a unique value in the header of your request, such as a UUID V4 or random strings."
- On the point-of-sale page: "The header accepts values between 1 and 64 characters."

**Inference.** The server keeps the key-to-response mapping for 24 hours. A retry with the
same key and the same body returns the original resource, which is the behaviour a till
needs after a network timeout. A retry with the same key and a different body is an error.
So the key must be derived from the intent, not from the attempt counter.

## 8. Rate limits

**Documented fact.** The vendor publishes no numeric rate limit for the Point API. The only
statement in the whole published guidance is one line in the LLM rules: "API rate limits may
apply; follow retry and backoff practices." Sources:
[llms.txt for Mexico](https://www.mercadopago.com.mx/developers/es/llms.txt), line 176, and
[Reference sitemap](https://www.mercadopago.com.mx/developers/es/reference/llms.txt), line 179.

**Documented fact.** No Point reference page lists a `429` status in its error table. The
Point error tables carry `400`, `401`, `403`, `404`, `409`, `412`, `422`, `424`, `425`,
`428`, `500`. The refund page has the widest set, and it stops at `500`.

**UNVERIFIED.** The numeric limit per endpoint, the burst window, the header name that
carries the remaining quota, and whether a `429` is returned at all. No primary source
states any of these.

**Inference.** Because the contract is undocumented, the client must treat a `429` as
possible and must handle it generically: honour `Retry-After` if present, back off, and
reuse the idempotency key. The one place where this matters in normal operation is the
fallback poll after a webhook timeout. Cap that poll, and prefer the webhook.

**Documented fact, a related operational limit.** The webhook is the vendor's recommended
path. The guide says of the query endpoint: "although the recurring use of this API query is
not recommended". Source:
[Payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing.md).

## 9. Open questions

1. **Does a real merchant account accept `5.00` as the minimum amount?** The live test
   account refused `1.00` with `400 Must be greater than or equal to 5.00`. No
   documentation page publishes a minimum. The rule may be a test-account rule.
   UNVERIFIED as a production rule.
2. **Is `platform_id` mandatory in a third-party production deployment?** The reference
   marks it optional. The certification page does not say. UNVERIFIED.
3. **What is the certification process, and how long does it take?** The `form_homologation`
   MCP tool implies a form. The steps, the fee, and the review time are UNVERIFIED.
4. **Does `external_reference` need to be unique forever, or only per account?** The text
   says "It must be a unique value for each order". The scope is UNVERIFIED. Use a value
   that is unique per merchant.
5. **Does `PATCH /terminals/v1/setup` need an idempotency key in production?** It is absent
   from the reference page. Live evidence with a real terminal is missing.
6. **What is the `country_code` string, `MX` or `MEX`?** The reference example says `MX`,
   the guide example says `MEX`. Both are the vendor's own text. Do not validate it.
7. **Does the terminal allow a tip on the N950 by default?** `tip_amount` and `paid_amount`
   exist in the response schema. The enablement path is not on any Point page. UNVERIFIED.
8. **What is the rate limit, if any?** See section 8.
9. **Is there an order-list endpoint outside the documented sitemap?** Section 6.4 says no
   documented one exists. An undocumented one may exist. UNVERIFIED.

## 10. The URL log

### Read successfully, 200

Index and sitemaps:

- `https://www.mercadopago.com.mx/developers/es/llms.txt` (14 101 bytes)
- `https://www.mercadopago.com.mx/developers/es/docs/llms.txt` (the full docs sitemap)
- `https://www.mercadopago.com.mx/developers/es/reference/llms.txt` (67 340 bytes)

Guides, under `/developers/en/docs/mp-point/`:

- `payment-processing.md`
- `configure-terminal.md`
- `resources/status-order-transaction.md`
- `notifications.md`
- `optional-notifications.md`
- `integration-test.md`
- `go-to-production.md`
- `configure-printings.md`
- `resources/troubleshooting.md`
- `resources/credentials.md`
- `resources/test-accounts.md`
- `migrate-payment-intent-to-orders.md`

Reference, under `/developers/en/reference/in-person-payments/point/`:

- `orders/create-order/post.md`
- `orders/get-order/get.md`
- `orders/cancel-order/post.md`
- `orders/refund-order/post.md`
- `orders/simulate-order/post.md`
- `terminals/get-terminals/get.md`
- `terminals/update-operation-mode/patch.md`
- `stores/create-store/post.md`
- `stores/search-store/get.md`
- `stores/get-store/get.md`
- `stores/update-store/put.md`
- `stores/delete-store/delete.md`
- `pos/create-pos/post.md`
- `pos/search-pos/get.md`
- `pos/get-pos/get.md`
- `pos/update-pos/patch.md`
- `pos/delete-pos/delete.md`

Other:

- `https://mcp.mercadopago.com/mcp`, JSON-RPC `tools/call` with `search_documentation`. The
  answer arrives as an SSE line prefixed with `data: `. Three searches ran: "rate limits",
  "límites de velocidad", and "minimum amount order point". None returned a numeric rate
  limit or a documented minimum amount.

### Live API calls, read-only, with the token in `apps/umi-api/.env`

All calls used the test account. No call created, cancelled, or refunded anything.

| Call                                                         | Status | Answer                                                                                                                     |
| ------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /users/me`                                              | 200    | `{"id":3696430142,"nickname":"TESTUSER5545458632263290392",...}` with `tags: ["user_product_seller","test_user","normal"]` |
| `GET /terminals/v1/list?limit=50&offset=0`                   | 200    | `{"data":{"terminals":[]},"paging":{"total":0,"limit":50,"offset":0}}`                                                     |
| `GET /terminals/v1/list?limit=99`                            | 200    | `paging.limit` came back as `50`. The server clamps.                                                                       |
| `GET /v1/orders/not-an-id`                                   | 400    | `{"errors":[{"code":"invalid_path_param","message":"path param order id is invalid"}]}`                                    |
| `GET /v1/orders/ORD00000000000000000000000000`               | 404    | `{"errors":[{"code":"order_not_found","message":"Order not found."}]}`                                                     |
| `GET /v1/orders/ORD...` with a well-formed but unknown token | 401    | `{"code":"unauthorized","message":"user not found"}`                                                                       |
| `GET /terminals/v1/list` with a malformed token              | 401    | `{"code":"unauthorized","message":"authorization value not present"}`                                                      |

### Failed or degraded

| Target                                                                                                                        | Result                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A first batch fetch of five `pos/*` and `stores/update-store` reference pages                                                 | HTTP 200 with a zero-byte body, five times. A retry of the same URLs, one at a time, returned the full Markdown. Treat an empty 200 on this host as transient. |
| `https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing.md` piped through `rg -o` with a large pattern | `curl: (23) Failure writing output to destination`. The download itself succeeded. A local pipe limit, not a source failure.                                   |

No URL returned a `404`. No URL needed authentication except the MCP server, which accepted
the same Access Token as the REST API.

## 11. What this changes for the implementation, in inference

1. **The transport is small and the state machine is the real work.** The calls are five:
   list terminals, set the mode, create the store, create the point of sale, and create the
   order, plus get, cancel, and refund. The order status machine, the idempotency key, and
   the terminal lock are where the defects will live.
2. **Persist the payment id, not only the order id.** The partial refund is impossible
   without it, and the read window is 3 months.
3. **Reconcile on `paid_amount`, not `amount`.** A tip changes the total.
4. **Parse two error envelopes.** This is a one-line fix that prevents a class of silent
   failures.
5. **Map `403 forbidden_checking_terminal_owner` to a setup message.** In a multi-merchant
   product it is a configuration error, and it will happen.
6. **The device screen owns the store and the point of sale.** The `PDV` switch fails with
   `403 store_pos_not_found` until both exist. The `/devices` menu is the right home for
   that sequence, and the vendor's own quality checklist asks for it.
7. **Set a bounded expiry, and expect the `expired` state.** A till that ignores
   `expiration_time` will show a dead order. `PT3H` is the useful value for a long table.
