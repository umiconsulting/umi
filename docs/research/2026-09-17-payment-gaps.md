# Payment gaps — the two rails, the merchant-of-record question, and what Conekta unlocks

- Date: 2026-09-17 (local, America/Mazatlan). Server responses carry the 2026-09-17 UTC date.
- Scope: what the platform can take money with today, what it cannot, and the decisions that have
  to be made before the second rail is built.
- Builds on: `docs/research/2026-09-16-mexico-payments-and-fiscal.md` (provider capabilities,
  primary-sourced), `docs/architecture/2026-09-16-tender-path-adr.md` (the attempt model),
  `docs/plans/2026-09-17-mercadopago-point-integration-plan.md` (the card-present plan of record).
- Method: the code read from the worktree as it stands today, plus primary sources fetched live
  from Conekta's documentation on 2026-09-17. Every claim below is labelled **Documented** (a
  source owns it), **Field observation** (read from this repository today), **Inference**, or
  **UNVERIFIED**.

## 0. The framing, and why it decides the design

Two rails, answering different questions. The owner's framing is the right one:

| Rail                                  | What the customer sees      | What it can sell                                                         |
| ------------------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| **Card present** — Mercado Pago Point | the terminal on the counter | anything bought in the room, at the till                                 |
| **Online / remote** — Conekta         | a payment page, or a link   | **our own products**: packages, clubs, pre-orders, stored value, tickets |

The second rail is not a replacement for the first, and it is not "the same thing over HTTP". It is
the only rail that works when **nobody is standing at the counter** — which is exactly the set of
products a café wants to sell ahead of the visit. Field observation: the code today has no Conekta
client of any kind, so that whole column is a plan, not a gap in an implementation.

## 1. What the code can take money with today

**Documented by reading the worktree, 2026-09-17.**

- **The attempt model exists and is provider-agnostic.** `merchant.pos_payment_attempt` carries an
  attempt keyed by cart and tender, with `unknown`/`timeout` as first-class outcomes and the command
  identity, provider, provider order/payment ids, proof source, tender draft and capture claim added
  by `70_tender.sql`.
- **The registry has four providers and none of them is Conekta.**
  `apps/umi-api/src/modules/tender/providers/` holds `cash`, `manual-terminal`,
  `mercado-pago-point` and a scripted fake. `conekta` appears **only as an example string in two
  comments** (`packages/contract/src/tender.ts`, `tender-provider.port.ts`) and as an
  unknown-provider rejection in `tender.integration.ts`. There is no Conekta adapter, no key in
  `config.schema.ts`, and no `CONEKTA*` variable in `.env.example`.
- **The till takes cards now.** `apps/umi-pos/lib/features/checkout/checkout_controller.dart` calls
  `captureTender`, and the payment sheet drives the card line: the earlier claim in the plan that
  "nothing in `apps/umi-pos` calls `pos.tenderCapture` yet" is **stale**.
- **The fiscal record exists and is online-shaped enough to reuse.** `merchant.fiscal_document`
  carries `payment_form`, `payment_method`, `receptor_rfc`, `receptor_name`, `receptor_postal_code`,
  `regimen_fiscal`, `uso_cfdi`, a stamped/cancelled state machine and a deadline, backed by a
  Facturapi PAC port and a scripted PAC.
- **Stored value and gift cards exist in the ledger**, with top-ups recorded as a drawer concept
  (`cash-read.service` reports `topups`). There is no online top-up path.
- **The channel receiving end exists.** `pos-cart` lists incoming orders and binds one to a cart
  (`bindOrigin`), and `writeOrder` projects the kitchen ticket, so a channel order already reaches
  the POS and the board.

## 2. The card-present rail is far along, and what is left on it

**Field observation.** `apps/umi-api/src/modules/mercado-pago/` now holds the OAuth client and its
spec, a per-merchant credential repository and service with a 180-day renewal job, a webhook
controller with signature verification, a terminal client/service/repository/controller, refunds and
notifications, across three integration suites and three unit suites. Migrations `72_mp_point.sql`
and `73_mp_refund.sql` are in the chain.

**What that rail's own plan still lists as open** (read from the plan, §11.4–§17.4):

1. **A real charge against a production order** — the one row that needs the physical terminal and
   the owner's hands. Everything else is measured against fakes and a virtual terminal.
2. **The wall-clock numbers** — capture p95, webhook acknowledgement, and "resolution visible in the
   till under 2 s" are mechanisms without a measurement until (1) happens.
3. **The refund status mapping** (Phase 4 step 2): `partially_refunded` and `refunded` fall to the
   default branch of `classifyTerminalStatus` and read as `unknown`.
4. **The Redis realtime adapter** — the gate on running a second API replica, named in three
   gateways' own comments.
5. **The vendor/panel questions** the plan records as open by design.

None of those is an online-payment question. The rest of this document is about the rail that does
not exist.

## 3. What Conekta documents that we have not designed against

All **Documented**, fetched 2026-09-17. These are the capabilities that decide whether "Conekta for
our own products" is a small job or a platform decision.

### 3.1 Hosted payment surfaces — and the PCI consequence

- **Checkout** is an all-in-one payment surface, embeddable or redirected, mobile-optimised and
  customisable, with its own interface reference.
  ([componente-de-pago](https://developers.conekta.com/docs/componente-de-pago),
  [referencia-del-checkout-component](https://developers.conekta.com/docs/referencia-del-checkout-component))
- **Payment links** can be generated from the API — a URL we can send over WhatsApp.
  ([generar-link-de-pago-vía-api](https://developers.conekta.com/docs/generar-link-de-pago-vía-api))
- **Checkout API + QR**: our backend calls `POST /checkouts`, takes the returned `url`, renders it as
  a QR on any screen, and the guest pays on Conekta's hosted page; `charge.paid` arrives by webhook.
  The document also states each transaction needs its own checkout, "esto hace que cada QR sea de un
  solo uso".
  ([pagos-qr](https://developers.conekta.com/docs/pagos-qr))
- **Apple Pay and Google Pay** work across the link, the redirected checkout and the embedded
  checkout. ([apple-pay](https://developers.conekta.com/docs/apple-pay),
  [google-pay](https://developers.conekta.com/docs/google-pay))

**Inference, and it is the important one here:** every one of those paths keeps the card number on
Conekta's page. That is the difference between an integration we can ship and one we cannot — a
hand-built card form puts the café inside PCI scope for no product gain. **The decision to make
explicit: we do not build a card form.**

### 3.2 Recurring revenue — the upselling mechanism

- **Subscriptions** are `Plan` + `Customer` + `Payment Source`, with an API to create plans and
  subscriptions, an embedded/redirected component, links de pago with subscriptions, and a
  **customer self-service portal** for managing them.
  ([resumen-suscripciones](https://developers.conekta.com/docs/resumen-suscripciones),
  [crea-un-plan](https://developers.conekta.com/docs/crea-un-plan),
  [portal-de-suscripciones-para-clientes](https://developers.conekta.com/docs/portal-de-suscripciones-para-clientes))
- **Documented limitation:** "Nuestro producto de suscripciones sólo acepta el método de pago de
  tarjetas por el momento" — card only. A coffee club cannot be billed by SPEI or cash.

### 3.3 Getting paid by people who do not have a card

- Cash at 19,000+ payment points, SPEI CLABE (reusable for recurring), **meses sin intereses**,
  BNPL ("pago en plazos", with Aplazo named as the in-person BNPL brand on Conekta Go), Puntos BBVA,
  and combined payments ("multipagos"). These are in the existing research note §1.1 and its
  sources; two of them — MSI and BNPL — are **upsell levers** rather than conveniences, because they
  are how a $2,400 package becomes a $200/month conversation.

### 3.4 Identity across merchants — the second-order hook

- **Cuenta Conekta**: a customer-level identity where the buyer stores a card once and carries it to
  any merchant in Conekta's network, with an email OTP to verify them; documented as compatible with
  Payment Link and Checkout and requiring **no integration change** on the merchant's side.
  **Status: Early Access.**
  ([conekta-accounts](https://developers.conekta.com/docs/conekta-accounts))

**Inference:** for a café group this is a direct conversion lever — a returning customer pays in one
tap — and it is the same primitive that makes a "club" subscription painless. Its Early Access
status is a dependency risk to record, not a reason to design around it.

### 3.5 Onboarding other businesses — the platform model exists

- **Onboarding API**: "La integración con la plataforma de Conekta permite dar de alta nuevas
  compañías mediante un flujo automatizado de onboarding vía API" — register a company
  (`POST /companies`), upload the documents the response names (`POST /companies/:id/document`),
  receive the result by webhook, and correct and resubmit a failed document.
  ([resumen-onboarding-api](https://developers.conekta.com/docs/resumen-onboarding-api),
  [paso-a-paso](https://developers.conekta.com/docs/paso-a-paso-para-integrar-el-onboarding-vía-api))
- **Multiple businesses per login** exist, and the documented way to get each business's keys is
  **manual**: sign in, "Mis negocios", pick the company, read the keys.
  ([api-keys-otros-negocios](https://developers.conekta.com/docs/api-keys-otros-negocios))
- **KYC** is the identity and ownership verification of the account holder.
  ([kyc](https://developers.conekta.com/docs/kyc))

### 3.6 Moving money to third parties

- **Dispersiones a terceros vía SPEI**: register a _payee_ by CLABE (Conekta validates the account
  with a symbolic deposit), then create `payout_rules` — one-off, dated, or recurring —
  evaluated nightly against your available balance, with webhooks for the result.
  **Documented precondition:** it must be enabled for the business and "requiere la firma de un
  acuerdo con las condiciones y tarifas del servicio", checked with the account executive.
  ([resumen-dispersiones-a-terceros-spei](https://developers.conekta.com/docs/resumen-dispersiones-a-terceros-spei),
  [gestion-de-beneficiarios](https://developers.conekta.com/docs/gestion-de-beneficiarios),
  [tipos-de-dispersion](https://developers.conekta.com/docs/tipos-de-dispersion))
- Balance and payout/cashout endpoints exist for the account that holds the money.

## 4. The decision nobody has made: who is the merchant of record

This is the gap that gates the most code, and it is a decision rather than a build. Three models,
each with a different fiscal and financial shape:

| Model                                | Flow                                                                                                                                      | Who issues the CFDI                                    | What it costs us                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **A. Platform / connected accounts** | each café is onboarded as its own Conekta company (Onboarding API); Umi holds per-merchant credentials and calls with that merchant's key | the café (through our Facturapi integration, as today) | build + operate onboarding, KYC state and per-merchant keys                                                      |
| **B. Umi as merchant of record**     | one Umi account collects, and cafés are paid by dispersions                                                                               | **Umi** — to the guest, plus the payout side           | a signed Conekta agreement, per-payout fees, Umi as the seller, and the chargeback and tax exposure that follows |
| **C. Manual per-business keys**      | each café is registered by hand in the panel and its keys pasted into our configuration                                                   | the café                                               | nothing to build, and a per-merchant manual step that does not scale past a handful                              |

**Inference.** Model A is the one that matches what Umi already is: the platform already models many
merchants with forced RLS, and the fiscal record is already built to be issued per merchant. Model B
turns Umi into a seller, which changes the money story in the plan's own §3 and needs a lawyer's
opinion rather than an engineer's. Model C is how the first café should be switched on regardless,
because it needs no code.

**UNVERIFIED:** whether the Onboarding API is available to our Conekta plan, and what it requires per
company type. That is a question for the account executive, and it is the first one to ask.

## 5. The gaps, in the order they block work

| #      | Gap                                                                                                                                                             | Why it matters                                                                                                          | Shape of the work                                                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1** | **No Conekta client at all.** No provider in the tender registry, no key in config, no webhook receiver, no idempotency, no attempt linkage                     | nothing on the online rail can be charged                                                                               | a provider behind the existing port, a webhook with signature verification, a config block — the same shape `mercado-pago-point` already has    |
| **P2** | **The attempt model is POS-shaped.** `pos_payment_attempt` is keyed by cart and tender with an operator session and a device behind it; a web order has neither | an online sale cannot reuse the attempt model unchanged                                                                 | extend the identity to a channel-shaped one rather than a second table (the `70_tender.sql` reasoning applies again)                            |
| **P3** | **The merchant-of-record decision** (§4)                                                                                                                        | it decides keys, the fiscal issuer, refunds and chargebacks                                                             | a written decision, then either onboarding code or a per-merchant key                                                                           |
| **P4** | **No online fiscal path.** The stamping module exists, but nothing maps a web payment to `payment_form` (04/28), `PUE`, and a receptor                          | an invoice for an online sale cannot be issued                                                                          | reuse `fiscal.service`; the missing piece is the mapping and the receptor capture at checkout                                                   |
| **P5** | **No subscription or package model**, and no online stored-value top-up                                                                                         | the actual upsell products cannot be sold                                                                               | a plan/subscription model of our own that maps to Conekta's `Plan`, plus a top-up route                                                         |
| **P6** | **No settlement or reconciliation for the online rail**                                                                                                         | nobody can prove the money arrived                                                                                      | a settlement read per provider, the way `point-refund` reads the terminal's own status                                                          |
| **P7** | **No chargeback/dispute workflow**                                                                                                                              | Conekta exposes chargebacks; the product has no concept of a dispute, so a dispute is invisible until the money is gone | a read model plus an operator surface; the plan's `sale_exception` is the nearest home                                                          |
| **P8** | **The channel has no payment leg.** `writeOrder` receives orders; nothing collects for them                                                                     | a WhatsApp or table order still has to be paid at the counter                                                           | a payment link or QR hung off the channel order — the natural first Conekta product, because it needs no terminal and no page we have to design |
| **P9** | **PCI scope is unstated.** No document says whether we ever touch a card number                                                                                 | it is the difference between a two-week integration and a compliance programme                                          | a one-line rule: hosted surfaces only                                                                                                           |

**Field observation for P8.** §8I's table-order intake has just landed
(`apps/umi-api/src/modules/table-order/`) with `paymentAtCounter: true` in the guest menu — that flag
is where this rail plugs in, and the QR + Checkout API path in §3.1 is the documented way to flip it
without a terminal.

## 6. What the online rail unlocks, specifically

Stated as products, because that is how the decision will be made:

1. **A coffee club / package** — a subscription plan (`Plan` + `Customer`), card only, with Conekta's
   own customer portal so the merchant does not become a billing helpdesk.
2. **Pre-orders and takeaway ahead of the visit** — a payment link or the table-order page with
   pay-on-page, so the drink is ready when the guest arrives.
3. **Stored value and gift card top-ups from home** — the ledger already models the balance; what
   is missing is the online payment that funds it.
4. **Higher-ticket bundles** — MSI and BNPL turn a $2,400 package into an affordable monthly
   number, which a terminal cannot offer.
5. **WhatsApp as a sales channel, not only a conversation** — the channel order exists and the
   payment link is one API call.
6. **Repeat customers in one tap** — Cuenta Conekta's saved card across merchants (Early Access).

## 7. Open questions for the vendor and the panel

1. Is the **Onboarding API** available on our plan, and what does each company type have to submit?
2. Are **dispersions** enabled, and what does the agreement's fee schedule look like?
3. Which **Conekta products** are live for our account today: Checkout, Payment Links, Checkout API,
   subscriptions, Apple/Google Pay, MSI?
4. Is there a **sandbox** for each of them (the existing research note records a sandbox for the
   base API)?
5. What is the **settlement cadence** and the fee per method, for reconciliation (P6)?
6. Is **Cuenta Conekta** available to us, and when does Early Access end?

## 8. Sources

Fetched 2026-09-17 from `developers.conekta.com` (the documentation index is
[`llms.txt`](https://developers.conekta.com/llms.txt)):

- Onboarding: [`resumen-onboarding-api`](https://developers.conekta.com/docs/resumen-onboarding-api),
  [`paso-a-paso-para-integrar-el-onboarding-vía-api`](https://developers.conekta.com/docs/paso-a-paso-para-integrar-el-onboarding-vía-api)
- Accounts and identity: [`conekta-accounts`](https://developers.conekta.com/docs/conekta-accounts),
  [`api-keys-otros-negocios`](https://developers.conekta.com/docs/api-keys-otros-negocios),
  [`kyc`](https://developers.conekta.com/docs/kyc)
- Payment surfaces: [`componente-de-pago`](https://developers.conekta.com/docs/componente-de-pago),
  [`generar-link-de-pago-vía-api`](https://developers.conekta.com/docs/generar-link-de-pago-vía-api),
  [`pagos-qr`](https://developers.conekta.com/docs/pagos-qr)
- Recurring:
  [`resumen-suscripciones`](https://developers.conekta.com/docs/resumen-suscripciones),
  [`crea-un-plan`](https://developers.conekta.com/docs/crea-un-plan)
- Payouts:
  [`resumen-dispersiones-a-terceros-spei`](https://developers.conekta.com/docs/resumen-dispersiones-a-terceros-spei),
  [`gestion-de-beneficiarios`](https://developers.conekta.com/docs/gestion-de-beneficiarios),
  [`tipos-de-dispersion`](https://developers.conekta.com/docs/tipos-de-dispersion)

Provider capabilities, methods, 3DS, idempotency, refunds, chargebacks, settlement, rate limits and
the CFDI verdict are already primary-sourced in
`docs/research/2026-09-16-mexico-payments-and-fiscal.md` and are not repeated here.
