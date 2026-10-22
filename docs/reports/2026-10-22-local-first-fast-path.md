# Local-first fast path

Status: implemented and verified in tests; production transaction not executed
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
- Full Flutter suite: **1,132 tests passed**.

Focused cases prove that:

- a blocked remote cart creation does not block local account startup;
- two checkout confirmations create one journal command and one payment;
- an unavailable local policy falls back to online checkout;
- a failed journal barrier stops checkout before the repository call;
- the existing path remains unchanged when the flag is disabled.

The complete suite also covers the existing offline replay, duplicate response,
restart, tender, split-check, receipt and role surfaces.

## Device state

The production APK was built with contract `2.44.0` and installed on:

| Device | Result |
| --- | --- |
| iMin D3 | Build `303`, launched to operator PIN |
| Galaxy Tab A11 | Build `303`, installed; the tablet is system-locked at 9% battery |
| Galaxy Tab A9 | Build `303`, app started after a retry and reached operator PIN |

The iMin credential was replaced through the official dashboard replacement
flow during environment testing. The old device is `replaced` and points to the
new active `Caja principal`. ONCA has one active counter device.

No production sale, payment, refund or inventory movement was created by this
test.

## Artifact

`/home/juan/Downloads/UmiPOS-1.0.0-production-fastpath-build303.apk`

SHA-256:

```text
bd5e9cda83b90a5e47ee74710f9459c8001794e6aa92f9fd6684f582a9bf6634
```

Package: `co.umiconsulting.umi_pos.estacion`

Version: `1.0.0` (`303`)

Signer SHA-256:

```text
8146b847a358a9cd54eddecbe8921a998287d3f59e1e52bdca5e121d21da3346
```

## Remaining proof

A production sale was not run because it would create real commercial history.
The final tap-to-paint measurement for a cash sale must run in staging or with an
approved test account.
