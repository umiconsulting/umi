# Mercado Pago Point and UmiPOS — stage 1, exploration and research

- Date: 2026-09-16. Scope: how UmiPOS can collect a card payment on a Mercado Pago Point
  terminal, and what a USB connection can prove.
- Status: research complete. No code changed. No terminal was plugged in.
- This file is the index and the stage 1 plan. The evidence is in the four notes below.

## 1. The finding that changes the plan

**The Point terminal is not a USB peripheral.** A USB cable gives us the model and the
serial number. It gives us no payment path.

The supported integration is the Mercado Pago **Orders API** over HTTPS. Our API creates an
order, the terminal in `PDV` mode loads that order from the Mercado Pago servers, and the
result arrives by webhook. Our POS never opens a channel to the device.

Two primary sources fix this conclusion, and both were read in this session:

| Claim                                                                                                                                         | Source                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| The supported path is `POST /v1/orders` with `type: "point"` and `config.point.terminal_id`.                                                  | [Payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing.md) |
| A SmartApp may not use "the USB port for information transmission", and may not hold `USB_PERMISSION`, `USB_SET`, or the `BLUETOOTH*` family. | [SmartApp restrictions](https://www.mercadopago.com.mx/developers/en/docs/smartapps/restrictions.md)   |
| Only a development unit has the USB port enabled. The account's commercial advisor issues it.                                                 | [SmartApps overview](https://www.mercadopago.com.mx/developers/en/docs/smartapps/overview.md)          |

Mercado Pago publishes no USB, serial, or Bluetooth protocol for the Point. The terminal is
a sealed Android payment device, and the payment data stays inside it. This is the normal
PCI PTS shape, not a Mercado Pago limitation.

## 2. The USB question, closed with evidence

**The terminal was connected to this host, and it did not enumerate.** The `lsusb` diff loop
showed no new device, and the kernel journal for the same window showed no enumeration
event. This is the documented behaviour: only a development unit has the USB port enabled.

The identity comes from the label and from the API instead. Our unit is a **Point Smart 2,
Newland N950, serial `NCCB05317715`**. The record is `05-terminal-identity.md`.

| Model                         | Operating system           | USB on a production unit        |
| ----------------------------- | -------------------------- | ------------------------------- |
| Point Smart 1, a PAX A910     | Android 6, minimum API 23  | Not a payment or data interface |
| Point Smart 2, a Newland N950 | Android 12, minimum API 31 | Not a payment or data interface |

Do not plan work that needs a cable. Read `02-usb-observation-procedure.md` for the tools
and the safety limits, and read `04-mercadopago-point-integration-surface.md` section 4 for
the hardware evidence.

## 3. What UmiPOS already has

The tender path is built and tested. Stage 2 adds one transport and one webhook, and touches
no checkout logic.

| Artifact                                    | Path                                                                       | State                |
| ------------------------------------------- | -------------------------------------------------------------------------- | -------------------- |
| The attempt model, with proof provenance    | `packages/contract/src/tender.ts`                                          | Built                |
| The outcome arithmetic, property-tested     | `apps/umi-api/src/modules/tender/tender-domain.ts`                         | Built                |
| The provider port and the registry          | `apps/umi-api/src/modules/tender/tender-provider.port.ts`                  | Built                |
| The Mercado Pago Point provider             | `apps/umi-api/src/modules/tender/providers/mercado-pago-point.provider.ts` | Built, unavailable   |
| The transport seam                          | `apps/umi-api/src/modules/tender/point-transport.port.ts`                  | **Empty on purpose** |
| The attempt table and its CHECK constraints | `merchant.pos_payment_attempt`                                             | Built                |
| The credentials                             | `MERCADO_PAGO_POINT_ACCESS_TOKEN`, `MERCADO_PAGO_POINT_TERMINAL_ID`        | Named, unset         |
| The decision record                         | `docs/architecture/2026-09-16-tender-path-adr.md`                          | Proposed             |

The empty transport is deliberate. `tender.module.ts` registers
`UnconfiguredPointTransport`, which reports the missing credential by name. So
`pos.tenderProviders` tells the till the truth today: the card terminal is unavailable.

## 4. Stage 1 plan

Definition of done: we know the model, we know the account state, and one point of sale is
ready for an API order. No money moves in stage 1.

1. **Identify the terminal.** Plug the cable in, run `lsusb`, and record the vendor id, the
   product id, the serial, and the `usb-devices` output.
2. **Confirm the account.** Name the Mercado Pago seller account that owns the terminal. A
   terminal takes orders only from the account it is paired to.
3. **Create the application.** Create an application in the developer panel of that account,
   and read the Orders API credentials.
4. **List the terminals.** `GET https://api.mercadopago.com/terminals/v1/list` with the
   access token. The response holds the exact `terminal_id`.
5. **Set the mode.** `PATCH https://api.mercadopago.com/terminals/v1/setup` with
   `operating_mode: "PDV"`. A point of sale accepts one terminal in `PDV` mode. Restart the
   terminal after a mode change.
6. **Build the sandbox path.** Create an order against the virtual terminal
   `NEWLAND_N950__SBX0000001`, then move its state with
   `POST /v1/orders/{order_id}/events`. This proves the order shape, the status mapping, and
   the webhook signature without a physical terminal and without a real charge.
7. **Report.** Record the model, the account, the terminal id, the point of sale, the
   sandbox result, and every failed attempt.

Exit criteria for stage 1: a sandbox order reaches `processed` through our own API
credentials, and the webhook signature check rejects a tampered body.

## 5. Stage 2 preview

Stage 2 writes the live transport behind the existing seam, and it stays small.

1. `MercadoPagoPointTransport` implements `PointTransport`: `createOrder` posts to
   `/v1/orders`, and `readOrder` gets `/v1/orders/{order_id}`. Both carry
   `X-Idempotency-Key`.
2. A webhook route receives `order.processed`, `order.canceled`, `order.refunded`,
   `order.action_required`, `order.failed`, and `order.expired`, and it validates the
   `x-signature` HMAC before it writes anything.
3. The till's tender screen reads `pos.tenderProviders` and offers the card method only when
   the provider is available. Today the screen offers cash, and a manual "external terminal"
   toggle that records an operator attestation and no capture.

## 6. Open decisions

| Question                                                                    | Why it blocks                                                                                                  | Owner               |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------- |
| Which Point model do we own, and to which account is it paired?             | It fixes the credentials and the terminal id.                                                                  | Owner               |
| Do we want a card charge inside our POS, or is the cloud order flow enough? | The cloud flow is the only supported path. A local path needs the SmartApp program and a commercial agreement. | Owner               |
| Are we the merchant, or an integrator that sells to many merchants?         | An integrator path needs OAuth, the `integrator_id`, and the certification process.                            | Owner               |
| Which fiscal path follows a card sale?                                      | Facturapi is the PAC. Mercado Pago does not issue the CFDI for a Point sale.                                   | Recorded in the ADR |

## 7. The notes

| File                                          | Answers                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-official-integration-paths.md`            | The Point products, the Orders API, the partner and certification requirements, the sandbox, and the Mexico pricing.                        |
| `02-usb-observation-procedure.md`             | The tool inventory, the read-only capture procedure, and the safety limits.                                                                 |
| `03-prior-art-terminal-integration.md`        | How other vendors expose a local SDK or protocol, the ZVT precedent, and the PCI constraint.                                                |
| `04-mercadopago-point-integration-surface.md` | The public integration surface, the hardware identification, and the USB answer with its sources.                                           |
| `05-terminal-identity.md`                     | Our own terminal: the model, the serial, the candidate terminal id, and the USB attempt result.                                             |
| `06-mercadopago-mcp-and-official-tools.md`    | The MCP server, its two auth models, the live tool list, the Codex connection, the quality checklist, and the catalog of integration forms. |
| `07-test-credentials-scope.md`                | What the test credentials can do, what they cannot, and the API details learned while testing.                                              |
| `08-serving-many-merchants.md`                | One credential or many: the self-integration and third-party models, the OAuth flow, the 180-day renewal, and the cost in code.             |
| `09-terminal-pairing-and-test-plan.md`        | How to pair our N950 to the test account, the two levels of testing, the confirmed terminal id, and the status propagation rule.            |

Companion evidence, written earlier and unchanged: `docs/research/2026-09-16-mexico-payments-and-fiscal.md`.
