# A sale with a customer attached can be charged

Date: 11 October 2026, 05:15–05:19 MST. Device: iMin D3-504 (`192.168.1.10:5555`), Estación
build from this tree (`co.umiconsulting.umi_pos.estacion`, `--profile`, API on `:4013` through a
transparent proxy so the bodies are readable). Demo merchant, demo customer _Cliente Piloto_.

This closes the defect in `2026-10-11-imin-customer-sale-refused.md`: **`Pagado · MXN 710.00`**, the
commit answered `201 committed`, and the loyalty side of the sale reached the ledger
(`points_earn_pending` 710 on a `loyalty_sale_policy_snapshot` of 71 000 eligible minor units).

## The path had three defects, not one

All three sat between the loyalty panel and the money, and each one hid the next.

1. **The commit raced the preview.** The sheet charges in one action, so the command left seven
   milliseconds after the panel asked for its preview and arrived with `"customerValue": null`; the
   database refuses that as `LOYALTY_PREVIEW_STALE`. The charge now WAITS for the panel's own request
   (the same future, so the server is asked once).
2. **The commit quoted a confirmation that could not contain the value.** The fingerprint the commit
   names is hashed over the command INCLUDING its `customerValue`
   (`checkout-calculator.ts` — source fingerprint, discounts, `customerValue`, reward, tip, tenders,
   receipt, policy, amountDue), while the database pairs the preview with the command's fingerprint
   computed WITHOUT any value (`customerValueBasisFingerprint`). A charge with a customer therefore
   needs THREE steps, in order: the review with no value (its fingerprint is the basis the preview is
   asked against), the awaited preview, and a second review that carries the selection (its
   fingerprint is the one the commit names). The API's own test states this flow
   (`pos-checkout.service.spec.ts`, _"binds customer value to the stable checkout basis
   fingerprint"_). Measured before the fix: `edf9273d…` at review, `26f3e80b…` at the commit, same
   totals, answered `CHECKOUT_CART_CHANGED`.
3. **The command carried a null the contract never offered.** The generated `toJson()` writes every
   key, so the absent optionals travelled as `null`, and the contract declares the arrays
   `z.array(…).optional()`: the sale that had just earned its preview was answered
   `400 VALIDATION_FAILED … fieldErrors: {"customerValue.fundedGiftCards":["Expected array, received null"]}`.
   The checkout now drops the null-valued keys before the command travels.

Two smaller pieces came with them: the preview is asked **once per checkout version**, keyed the way
the server keys it (the earn-preview table holds one row per merchant, cart and checkout version),
and the selection picks up the `storedValueFingerprint` the fresh confirmation publishes, which is
the other half the API insists on (`storedValueSelectionInvalid`).

## The verified walk, with the bodies

Cart `fbab20bd…` version 13 (Cliente Piloto attached, MXN 710.00), `Efectivo`, `Importe exacto`,
`Cobrar`:

| #   | Request                         | Body that matters                                                                                                   | Answer                                                 |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1   | `POST …/checkout`               | `expectedCartVersion: 13`, `totalsFingerprint: null`, `customerValue: null`                                         | `201`, confirmation `a7f8cb6f…` (the basis)            |
| 2   | `POST …/customer-value/preview` | `checkoutVersion: 13`, `checkoutFingerprint: a7f8cb6f…`                                                             | `201`, preview `09f6897c…`                             |
| 3   | `POST …/checkout`               | `totalsFingerprint: null`, `customerValue: {previewFingerprint: 09f6897c…, storedValueAuthorizationIds: []}`        | `201`, confirmation whose fingerprint covers the value |
| 4   | `POST …/checkout`               | `totalsFingerprint: eca9e893…`, `customerValue: {previewFingerprint: 09f6897c…, storedValueFingerprint: 895cbf04…}` | `201 committed`, sale `fcfb138e…`                      |

The database agrees at every point:

```
merchant.loyalty_earn_preview      checkout_version 13 · checkout_fingerprint a7f8cb6f… · preview_fingerprint 09f6897c…
merchant.loyalty_sale_policy_snapshot  earned_points 710 · final_eligible_minor_units 71000
merchant.loyalty_points_ledger     points_earn_pending · 710 · hold
merchant.pos_committed_sale        fcfb138e-af9a-4791-88c0-634f962fe606
```

The preview row's `checkout_fingerprint` is the **basis** (the review that carried no value) and its
`preview_fingerprint` is what the commit carried: the two halves match exactly as the contract
describes.

Evidence: `docs/reports/evidence/2026-10-11-imin-customer-sale-fixed/` — the cart with the customer,
the charge sheet with the value panel, `Pagado · MXN 710.00`, and the receipt.

## The guard

`apps/umi-pos/test/checkout_test.dart` → _"the one-tap charge waits for the loyalty preview the
command has to carry"_ parks the preview in a `Completer` and asserts the order: no commit while the
preview is unanswered, two reviews (one without the value, one with it), the commit naming the
value-carrying confirmation, both fingerprints on the selection, no null fields, and ONE preview
request. It fails on each of the three defects when they are put back. POS suite: 687 tests.

A second guard measures the money screen at the till's own canvas — 1396x737 — with the value panel
in its tallest form (points, the earn preview, a reward row with its `Use` action, and a wallet row
with `Apply`): _"the money screen keeps its methods and its charge action on the till canvas"_. It
passes, so the earlier reading that the method tiles leave the screen when a customer is attached did
not reproduce in the layout itself; the guard is what holds that line from now on.

## What this walk also found, and did not fix

1. **An expired preview can never be renewed for the same cart version.** The earn-preview row
   expires after the location's TTL (300 s here) and the table is append-only, with one row per
   (merchant, cart, checkout version) and a deterministic preview fingerprint; the preview insert is
   `ON CONFLICT (merchant_id, preview_fingerprint) DO NOTHING`, so asking again after the expiry
   keeps the expired row and the commit is refused with `LOYALTY_PREVIEW_STALE` **forever** for that
   version — measured here, on cart version 12, whose preview expired at `12:14:33`: the retry at
   `12:17:04` re-previewed, the panel filled, and the commit was still refused. A cashier who sits on
   the failure screen for five minutes cannot charge that cart; they must abandon the sale. The
   honest fixes are all server-side (a named refusal the till can act on, or a way to renew).
2. **A second preview request for one checkout version answers 500.** `POST
…/customer-value/preview` twice for the same cart version raises
   `duplicate key value violates unique constraint
"loyalty_earn_preview_merchant_id_cart_id_checkout_version_c_key"` and the filter turns it into
   `500 INTERNAL_ERROR`. The till now avoids it, but the endpoint itself is one bad retry away from
   a 500 (`docs/reports/2026-10-08-bug-hunt.md`, §121 is the wider census of this class).
3. **The value panel promises a lookup that is not running.** Before the first `Cobrar` the panel
   reads `Valor del cliente / Consulta en curso.` although no request exists yet — the preview needs
   the checkout fingerprint the first review returns. It is a claim about the till's own state, and
   it is false for as long as the operator waits.
