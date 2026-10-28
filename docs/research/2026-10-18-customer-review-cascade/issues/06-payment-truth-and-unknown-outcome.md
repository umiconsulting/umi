# Issue 06: payment truth and unknown outcome

Status: repeated independent complaint.

## Operator scenario

The provider shows success. The sale does not. Or the provider shows an unknown state. The cashier cannot tell whether the guest paid. A second attempt can charge twice.

## Independent evidence

| Product | Language | Evidence | Source |
| --- | --- | --- | --- |
| Square | Spanish MX | A user reports a successful payment that later returned to the guest. | App Store MX, 2025-01-21 |
| Square | Spanish MX | A user reports that a charged ticket disappears from the system. | App Store MX, 2019-02-07 |
| Square | Spanish MX | A user reports that hardware stopped after an update. | App Store MX, 2025-02-25 |
| Toast | English | A user reports duplicate holds on tap-to-pay. | Software Advice review, 2026-06 |
| Clover | English | A user reports a charge when the order never went through. | Clover App Store, US |
| Clover | English | A user reports a card charge on a restaurant that was closed. | Clover App Store, US |
| Square | English | Fifteen offline payments showed zero after reconnect; support resolved one. | [Square Community](https://community.squareup.com/t5/Payments-Troubleshooting/Offline-Payment-Issue/m-p/847771) |
| Toast | English | A reviewer reported settlement totals that did not match the prior night. | [Trustpilot](https://www.trustpilot.com/reviews/6ab46964d685ccf2a0eaddf7) |
| Odoo | English | A saved-payment path was not idempotent and could duplicate a payment. | [Odoo PR 273504](https://mergebot.odoo.com/odoo/odoo/pull/273504) |
| Square | English | A tap sounded successful, then the app later said the payment failed. | [App Store](https://apps.apple.com/ca/app/square-point-of-sale-pos/id335393788) |

## Vendor behavior

**HD:** Square, Toast and Clover document payment capture and refund paths.

The public docs do not make an unknown provider outcome easy to see in one sentence. The reviews show the operational need: staff need one truth for the sale and one safe next action.

## Cascade across languages

The Square Spanish reports match the English Toast and Clover reports. Payment reversal, duplicate hold and missing order all create the same question: “Did the guest pay?”

The expanded sample adds a stronger rule. Do not render an unknown amount as
zero. Do not replace a provider fact with a screen fact. Keep retry identity
stable until the provider or a person resolves the outcome.

## Umi current flow

**HL:** Umi records an unknown terminal result and blocks settlement. The recovery screen names the unknown state. The cancel action does not clear an unknown payment.

Evidence:

- `apps/umi-pos/test/checkout_test.dart`
  - `unknown external-terminal payment remains query-only`
  - `restart recovery restores tender drafts and unknown state`
  - `checkout cancellation clears drafts but never cancels an unknown payment`
  - `an unknown terminal outcome is captured and NOT settled`
- `apps/umi-pos/test/partial_checkout_test.dart`
  - `closing a collected manual tender does not capture it again`
- `apps/umi-api/src/modules/pos-checkout/pos-checkout.service.ts`
- `apps/umi-api/src/modules/tender/tender.service.ts`

## Gap

**I:** Umi has a safe system path. Staff still need a plain-language recovery screen that says three facts:

1. What the terminal said.
2. What the sale recorded.
3. What the cashier can do now.

The screen must not ask the cashier to understand provider state names.

## Acceptance scenario

1. Start a card payment.
2. Drop the response after the provider accepts.
3. Show `Check the terminal` with the attempt time and amount.
4. Confirm the charge button is disabled.
5. Restart the app.
6. Confirm the same attempt and amount.
7. Confirm a second tap cannot capture the same tender.

## Priority

Frequency: 3

User cost: 5

Money risk: 5

Recovery difficulty: 5

Umi fit: 5

Total: 23
