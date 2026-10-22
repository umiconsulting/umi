# Local-first fast path

Status: implemented, deployed and verified with a production cash sale
Date: 2026-10-22

## Result

UmiPOS now has one opt-in fast path:

1. The first product opens a local account and appends the account and line
   commands without waiting for `POST /sales`.
2. A simple cash checkout appends one encrypted checkout command and paints the
   paid result without waiting for the remote commit.

The remote API remains authoritative. The encrypted journal drains in the
background. A completed replay changes the receipt to official. A refusal stays
visible as a conflict in the Recovery Center.

## Activation

The build flag is `UMIPOS_LOCAL_FIRST_FAST_PATH=true`. The default is `false`.
The native launcher, pilot build script, Android release procedure and delivered
APK enable it.

## Financial boundaries

- The fast path accepts one cash tender only.
- Tips, discounts, customer value, approvals and mixed or card tenders keep the
  existing online path.
- Every cart command must reach the encrypted journal before the checkout is
  appended.
- If that journal barrier fails, checkout stops before money.
- A missing or invalid local policy falls back to the existing online checkout.
- One checkout identity and one idempotency key prevent a second payment.
- Card authorization remains an online boundary.
- The paid screen keeps the receipt layout. Pending synchronization appears in
  the Sales list, where the operator can retry it.

## Verification

Static verification:

- `flutter analyze --no-fatal-infos`: no issues.
- Full Flutter suite: **1,142 tests passed**.

Focused cases prove that:

- a blocked remote cart creation does not block local account startup;
- two checkout confirmations create one journal command and one payment;
- an unavailable local policy falls back to online checkout;
- a failed journal barrier stops checkout before the repository call;
- policy age starts at the latest server refresh;
- a resumed operator session refreshes its product entitlements;
- a role without hardware permissions does not start the hardware relay;
- a replaced terminal adopts or resumes its cash shift before checkout;
- a missing shift stops local cash before the online partial-payment fallback;
- the paid screen uses the normal receipt layout for a local sale;
- a pending local sale appears in Sales with a retry action;
- the existing path remains unchanged when the flag is disabled.

The complete suite also covers the existing offline replay, duplicate response,
restart, tender, split-check, receipt and role surfaces.

## Production verification

The iMin D3 completed a cash sale for one Americano at MXN 50.00 on
2026-10-22:

- The first product was painted in **224 ms**.
- The final `Cobrar · MXN 50.00` action recorded **122 ms** of tap latency.
- The normal paid receipt appeared immediately after one final tap.
- No second final `Cobrar` button appeared.
- The server accepted the single encrypted checkout command and assigned
  official sale `76979f26-2c5f-4f0a-8cdd-95f688d49cc6`.
- The sale had one payment of MXN 50.00, payment
  `fc3f8409-67cc-437c-adec-2ff219c7f3cd`.
- The same paid screen stayed visible while synchronization completed.
- A sale that had not yet synchronized appeared in Sales as
  `Venta pendiente de sincronización` with a `Reintentar` action.
- After replay, that row changed to `Completada` without a manual refresh.
- The committed sale had zero price divergence.
- No API error or refused request appeared during more than one minute after
  the KDS and counter terminal restarted on build `313`.

The API release is `f0908e1` and reports contract `2.44.0` with schema
`build-v3-79`. Both API containers are healthy. Pull request #225 passed every
required CI check, and the production deployment workflow completed.

Evidence:

- [Single cash action](evidence/2026-10-22-local-first-checkout/01-single-cash-action.png)
- [Restored paid receipt](evidence/2026-10-22-local-first-checkout/03-paid-receipt-restored.png)

## Device state

The production APK was built with contract `2.44.0` and installed on:

| Device         | Result                                                            |
| -------------- | ----------------------------------------------------------------- |
| iMin D3        | Build `319`, signed in as Admin ONCA and online                   |
| Galaxy Tab A9  | Build `319`, signed in as Barista and showing the KDS             |
| Galaxy Tab A11 | Build `309`; ADB is offline and the device needs a new connection |

The iMin credential was replaced through the official dashboard replacement
flow during environment testing. The old device is `replaced` and points to the
new active `Caja principal`. ONCA has one active counter device.

The interrupted verification accounts were cancelled with no confirmed
payment. The completed MXN 50.00 sales are the only production financial
results from this verification.

## Artifact

`/home/juan/Projects/umiconsulting/umi/apps/umi-pos/build/app/outputs/flutter-apk/app-production-profile.apk`

SHA-256:

```text
5d1fb5e605c70396abac9642bb86e02bccabe43f8a30b91a602e65882c3a877e
```

Package: `co.umiconsulting.umi_pos.estacion`

Version: `1.0.0` (`319`)

Signer SHA-256:

```text
8146b847a358a9cd54eddecbe8921a998287d3f59e1e52bdca5e121d21da3346
```

## Remaining device action

The Galaxy Tab A11 is reachable at `192.168.0.101`, but its ADB transport is
offline. Reconnect wireless debugging and install build `319` when the tablet is
available.
