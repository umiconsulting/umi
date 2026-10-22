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
- The paid receipt remains visibly pending until replay accepts it.

## Verification

Static verification:

- `flutter analyze --no-fatal-infos`: no issues.
- Full Flutter suite: **1,137 tests passed**.

Focused cases prove that:

- a blocked remote cart creation does not block local account startup;
- two checkout confirmations create one journal command and one payment;
- an unavailable local policy falls back to online checkout;
- a failed journal barrier stops checkout before the repository call;
- policy age starts at the latest server refresh;
- a resumed operator session refreshes its product entitlements;
- a role without hardware permissions does not start the hardware relay;
- the existing path remains unchanged when the flag is disabled.

The complete suite also covers the existing offline replay, duplicate response,
restart, tender, split-check, receipt and role surfaces.

## Production verification

The iMin D3 completed a cash sale for one Americano at MXN 50.00 on
2026-10-22:

- The first product was painted in **224 ms**.
- The final `Cobrar · MXN 50.00` action recorded **122 ms** of tap latency.
- The paid state appeared immediately as pending synchronization.
- The server accepted the single encrypted checkout command and assigned
  official sale `76979f26-2c5f-4f0a-8cdd-95f688d49cc6`.
- The sale had one payment of MXN 50.00, payment
  `fc3f8409-67cc-437c-adec-2ff219c7f3cd`.
- The receipt changed from pending to `Venta sincronizada`.
- The committed sale had zero price divergence.
- No API error or refused request appeared during more than one minute after
  the KDS and counter terminal restarted on build `313`.

The API release is `f0908e1` and reports contract `2.44.0` with schema
`build-v3-79`. Both API containers are healthy. Pull request #225 passed every
required CI check, and the production deployment workflow completed.

Evidence:

- [Single cash action](evidence/2026-10-22-local-first-checkout/01-single-cash-action.png)
- [Local paid state](evidence/2026-10-22-local-first-checkout/02-provisional-paid.png)

## Device state

The production APK was built with contract `2.44.0` and installed on:

| Device         | Result                                                            |
| -------------- | ----------------------------------------------------------------- |
| iMin D3        | Build `313`, signed in as Admin ONCA and online                   |
| Galaxy Tab A9  | Build `313`, signed in as Barista and showing the KDS             |
| Galaxy Tab A11 | Build `309`; ADB is offline and the device needs a new connection |

The iMin credential was replaced through the official dashboard replacement
flow during environment testing. The old device is `replaced` and points to the
new active `Caja principal`. ONCA has one active counter device.

The two interrupted test accounts, `007` and `009`, were cancelled with no
confirmed payment. The completed MXN 50.00 sale is the only production
financial result from this verification.

## Artifact

`/home/juan/Projects/umiconsulting/umi/apps/umi-pos/build/app/outputs/flutter-apk/app-production-profile.apk`

SHA-256:

```text
cae14b6e68ea79467f306544eaced9b3e49f2e85beec7fe8cac62abe2885df41
```

Package: `co.umiconsulting.umi_pos.estacion`

Version: `1.0.0` (`313`)

Signer SHA-256:

```text
8146b847a358a9cd54eddecbe8921a998287d3f59e1e52bdca5e121d21da3346
```

## Remaining device action

The Galaxy Tab A11 is reachable at `192.168.0.101`, but its ADB transport is
offline. Reconnect wireless debugging and install build `312` when the tablet is
available.
