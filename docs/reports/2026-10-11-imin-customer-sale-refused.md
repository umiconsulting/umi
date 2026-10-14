# A sale with a customer attached cannot be charged

Date: 11 October 2026, 04:30–04:45 MST. Device: iMin D3-504, Estación build from this tree, demo
merchant and API on `:4013`.

The plan's coverage table lists the customer-value walk as pending (_"Recorrido nativo completo de
valor pendiente"_). This is that walk, and it stops at the money: **attaching a customer makes the
sale un-chargeable.**

> **RESOLVED 11 October 2026, 05:19 MST.** The path needed three fixes, not one — the preview race,
> the confirmation fingerprint the commit has to quote, and a null the contract never offered. The
> walk below was repeated on the till and reached `Pagado`. See
> `2026-10-11-imin-customer-sale-fixed.md` for the fix, the captured bodies and the two server-side
> defects this walk also found.

## What was walked, with real taps

1. `Comanda` → **`Asignar cliente`** → the picker lists _Cliente Piloto_ → tap it. The cart's row
   reads `Cliente Piloto` (was `Asignar cliente`).
2. A product (`Americano`, MXN 45.00) → `Cobrar`. The sheet shows a **`Lealtad y saldo`** panel:
   `Puntos disponibles: 0 · pendientes: 0`, **`Puntos previstos: 45`**, `Reward piloto: No disponible`,
   `Cartera: MXN 500.00` with `Usar` and `Aplicar`. The value preview is real and on screen.
3. `Efectivo` → `Importe exacto` → `Cobrar · MXN 45.00` → **`No fue posible completar el cobro de
forma segura.`** with `Reintentar` and `Cerrar`.
4. `Reintentar` → the sheet reopens with a fresh preview → `Efectivo` → `Importe exacto` → `Cobrar` →
   **the same refusal.**

The API says the same thing both times:

```
500 request_failed POST …/checkout  type=DatabaseError  detail=LOYALTY_PREVIEW_STALE
```

## The captured requests, and what the database was looking for

A transparent proxy in front of the demo API captured the sequence (the recipe that also found the
`fiscalMotive` defect):

```json
POST …/checkout
{"commandId":"8a13db85-…","customerValueFingerprintCommandId":"05800dc0-…",
 "cartId":"6a36b126-…","expectedCartVersion":5,"paymentMethod":"cash",
 "totalsFingerprint":null,…,"customerValue":null}

POST …/customer-value/preview
{"saleId":"6a36b126-…","checkoutVersion":5,"customerId":"71000000-…-101",
 "checkoutFingerprint":"50acf482e5b27b1b42d98ccb9e69cbc1cf7bd2d1b450ee9a056dcb464a0f7a81"}

POST …/checkout
{"commandId":"872c60d8-…","customerValueFingerprintCommandId":"05800dc0-…",
 "cartId":"6a36b126-…","expectedCartVersion":5,"paymentMethod":"cash",
 "totalsFingerprint":"50acf482…","customerValue":null}
```

**`"customerValue": null` in both commits.** The database is asked to assert the loyalty earn preview
for a customer with an active account and an enabled programme
(`merchant.assert_loyalty_earn_preview`, `38_pos_customer_value_closeout.sql`), and the preview it
needs is looked up **by the fingerprint the command carries** — which is not there. The row the till
created a moment earlier exists and matches the cart
(`merchant.loyalty_earn_preview`: cart `6a36b126`, `checkout_version 3`, not expired), so the refusal
is not an expiry and not a version drift: it is the command arriving without its half of the pair.

On the client side the chain is short and visible:

- `customer_value_controller.dart` — `selection()` returns **null when `state.preview == null`**.
- `checkout_controller.dart:772` — the command carries `customerValue: _customerValueSelection?.toJson()`,
  so a null selection travels as `"customerValue": null`.
- `checkout_surface.dart` — `_applyCustomerValue(totals)` reads that selection at four call sites, and
  only some of them run after `await widget.customerValue!.loadPreview(...)` (line 1779).

The panel on screen proves a preview _was_ fetched, so the question the next instrument has to answer
is narrow: **what clears or fails to fill `state.preview` between the panel rendering and the commit**.
Logging `selection()` and the customer-value state at commit time — the same temporary print that
found the keyboard defect — answers it in one run.

## The second finding: the payment methods leave the screen

With the `Lealtad y saldo` panel in place, the sheet's **payment selection starts below the fold** on
the till's 1920x1014 window: the cashier sees `Selección de pago` at the bottom edge and no methods,
and reaches `Efectivo` only by scrolling the sheet (measured: `Efectivo` at y≈600 without a customer,
y≈693 after a swipe with one). The `Cobrar` button stays visible and enabled while no method is
chosen. The playbook's own check — "money screens fit one screen" — fails here when a customer is
attached.

## What this means for the pilot

The customer-value surface, the wallet, the rewards and the points preview all exist and render. What
does not work is the last step: **a café that attaches a customer cannot take the money.** Until that
is fixed, the customer-value feature is unusable at the till, and the failure message
(`No fue posible completar el cobro de forma segura.`) names neither the customer nor the loyalty
preview, so an operator has nothing to act on.

Evidence: `docs/reports/evidence/2026-10-11-imin-customer-sale/` — the cart with the customer
attached, the sheet with the `Lealtad y saldo` panel, and the refusal.
