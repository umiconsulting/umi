# Umi Competitive Scan and Gap Audit

Date: 2026-09-06
Branch: `chore/build-v3-checkpoint`

## Purpose

This report compares five restaurant-commerce ecosystems with Umi. It then audits
Umi at source level. It states what Umi has built, what is partial, and what is
not built yet. The scope is the dashboard, the POS, the KDS and kitchen, loyalty,
ordering, automations, devices, payments, and reporting.

## How to read this folder

- `report.html` — the full visual report. It embeds the screenshots. Open it in a browser.
- `sources/` — the raw research notes. One file per competitor and one file per audit area.
- `assets/` — the flagship screenshots, as web-sized JPEG files.

## Method

- The agent scraped the official help centers and product pages with WebFetch.
- The agent captured full-page screenshots with Playwright on 2026-09-06.
- The agent audited Umi with the CodeGraph index (1,140 files, 21,993 nodes), file reads, and SQL over the build-v3 schema.
- Eight research agents ran in parallel: five competitor scrapes and three code audits.

### Caveats

- Toast `pos.toasttab.com` returned HTTP 403. The agent recovered the content from `support.toasttab.com`, `doc.toasttab.com`, and web search.
- PoloTab's developer/API pages are JavaScript-gated. Its G2 reviews were bot-blocked. The gap matrix grades PoloTab unknowns in a conservative way.
- Third-party facts are labeled as third-party in the notes files.

---

## Part 1 — The five ecosystems

All five competitors sell the same shape. One connected data graph (item, category,
order, customer) feeds a register, a kitchen display, online ordering, loyalty, and
reporting. First-party payments and hardware complete the system. Category is the
shared key for kitchen routing and reports. Payments and lending are the money engine.

### Lightspeed (K-Series, iPad)

- Positioning: a modular cloud platform. A thin, low-priced core POS. Revenue comes from attach modules and tier upgrades.
- Packaging: $69 Starter, $189 Essential, $399 Premium. KDS costs $30 per screen per month. Order Anywhere, Inventory, and Reservations are extra. Processing rates are not published.
- Strengths:
  - KDS 2.0 with per-station routing, wait-time SLA pulses, and a POS-to-KDS status mirror that pushes "Ready" back to online-ordering partners.
  - Delivery with own-fleet self-delivery plus Uber Direct white-label at 0% commission.
  - Inventory with ingredient recipes, production batches, purchase orders, and par levels.
  - Advanced Insights benchmarks a venue against anonymized peers.
- Seam for Umi: payments and hardware lock-in with hidden rates, add-on TCO, an Apple/iPad-only stack, and weak native loyalty (real loyalty is outsourced to Marsello).

### Toast (vertical restaurant OS)

- Positioning: proprietary hardware, POS, processing, and a full SaaS suite on one back office ("Toast Web").
- Packaging: $0 Starter (higher processing), $69 Point of Sale, and custom "Build Your Own". Money comes from processing spread, add-ons, hardware, and lending.
- Strengths:
  - Enterprise KDS: assembly lines, load balancing, partial fulfillment, food-runner mode, and on-screen recipes.
  - Local Hub offline that relays orders across the LAN with no internet.
  - Toast IQ (AI) that answers business questions and takes permission-scoped actions across the stack.
  - A documented public API across 18+ domains, webhooks, partner certification, and a marketplace.
- Seam for Umi: soft marketing/CRM depth, weak scheduling-to-payroll link, cost pushed onto processing rates, and a kiosk without upsell.

### Square (connected cloud graph)

- Positioning: one cloud graph across POS, online, kiosk, KDS, and delivery. Category is the routing and reporting key.
- Packaging: Free, Plus ($49), Premium ($149) per location. KDS and Kiosk are per-device add-ons on top.
- Strengths:
  - Menu ingestion by photo/PDF upload, AI generation, or import from Toast/DoorDash.
  - Loyalty, Marketing, and CRM as one native loop on a free Customer Directory.
  - A genuinely open platform: 20+ APIs, SDKs, webhooks, and a marketplace.
- Seam for Umi: cloud-dependent offline (one-hour card window, 24-hour reconnect, seller risk), compounding per-device pricing, Premium-gated coursing/seat tracking, no native recipe inventory, and an iPad POS with an Android-only KDS.

### Odoo (all-in-one ERP)

- Positioning: an open-source ERP of about 50 apps that share one database. POS is one module.
- Packaging: per user for all apps. Community is free; Enterprise is paid and gates key POS features.
- Strengths:
  - Breadth: one database unifies POS, the online store, loyalty, inventory, HR, and native accounting.
  - Cross-channel loyalty and promotions shared by Sales, eCommerce, and POS.
  - Studio no-code customization with automation rules and Python server actions.
- Seam for Umi: generic hospitality UX, a browser-only prep display, generic IoT hardware with no attested device identity, delivery through a third-party connector, and ERP operational overhead.

### PoloTab (Mexico, direct comparable, design north-star)

- Positioning: a Mexico-only POS for cafés and restaurants, sold as bundled hardware plus software. It claims 900+ venues and 22.8M orders per year. The wedge is human 24/7 Spanish support.
- Packaging: MXN token plans — Esencial $990, Avanzado $1,490, Pro $2,490. Hardware and processing are separate.
- Strengths:
  - Design language: near-black operational apps with one vivid blue (~#0066FF), a three-pane POS, a colored-bar category rail, and bottom tabs (Comanda / Mesas / Ventas / Ajustes).
  - KDS ticket header ramps by elapsed time (gray to yellow to orange to red).
  - Native delivery aggregation of Uber Eats, Rappi, and DiDi Food into one screen.
  - A light back office with a custom report builder ("Playground"), saved reports, and an audit log ("Trazabilidad").
- Seam for Umi: no loyalty, no gift cards, no promotions engine, no own-brand web storefront, and no self-order kiosk. Mexico only.

---

## Part 2 — Market synthesis

- The market standard is an ecosystem, not a register. Umi must add the missing ecosystem parts.
- Payments is the money engine. Every competitor except Odoo owns the processor.
- Offline is Umi's clearest opening. Square is time-boxed and cloud-dependent. Toast needs a Local Hub. Odoo and Lightspeed are register-centric.
- AI is the next front. Toast IQ takes actions across the stack. This is the newest threat.
- PoloTab is the only direct comparable. Umi can match its design and beat its value with loyalty, gift cards, and WhatsApp identity.

---

## Part 3 — Umi source audit

Status is graded from the code and the build-v3 schema, not from the roadmap claims.

| Domain                       | Status  | Evidence and gap                                                                                                                                                                               |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sale and order entry         | Done    | 3-pane cart/rail/products, suspend/resume/history (`catalog_surface.dart:796`). Gap: order-type pills are UI-only, never saved to the sale.                                                    |
| Catalog                      | Done    | Colour-bar rail, photo/placeholder tiles, search, modifiers/variants. Category colors server-assigned (`20_merchant.sql:913`).                                                                 |
| Checkout / tender            | Partial | Cash, manual terminal, stored-value, keypad, one-tap confirm. No integrated card. Hardcoded quick-cash denominations.                                                                          |
| Cash management              | Done    | Open/close pipeline, movements, denomination counter, idempotent crash recovery.                                                                                                               |
| Refunds / voids / exceptions | Done    | All 4 known blockers fixed. `pos_sale_exception` RLS present (`90_rls.sql:631`).                                                                                                               |
| KDS backend and routing      | Done    | Authoritative kitchen projection, deterministic station routing, ordered events (`kds.service.ts:241`). Advance is device-token only.                                                          |
| KDS client (Flutter)         | Missing | Read-only flat board (~5%). No columns, no per-item state/timers, no commands, 8s poll. Real KDS is still SwiftUI `umi-kds` (2,617 lines, not retired).                                        |
| Device roles and identity    | Partial | Pair/rotate/revoke with ed25519/es256 proof-of-possession (`auth.service.ts:222`). Gap: no device-role attribute; no hardware attestation.                                                     |
| Customer display             | Missing | Exists only as a simulator peripheral. No app render mode.                                                                                                                                     |
| Printing                     | Partial | Receipts done (hardware deferred to Gate 13). No kitchen-ticket printing.                                                                                                                      |
| Offline journal and replay   | Partial | Durable encrypted journal, idempotent replay, recovery center. Gap: no OS connectivity source; no auto-replay on reconnect (`platform_adapters.dart:27`).                                      |
| Realtime                     | Partial | Socket.IO nudge channels for pairing and dashboard. POS/KDS are poll-based. Single-replica (needs a Redis adapter).                                                                            |
| Loyalty program              | Partial | Real event-sourced points ledger, wired at checkout (`37_pos_customer_value.sql:211`). Missing: tiers, reward catalog CRUD, enable switch (ships `enabled=false`), birthday/expiry crons.      |
| Gift cards and stored value  | Done    | Two complete issue/redeem/balance systems over `merchant.loyalty_gift_card` plus an append-only ledger.                                                                                        |
| Wallet passes                | Partial | Apple pkpass signing, APNs, and Google Wallet in code. Blocked by unset secrets and un-ported crons.                                                                                           |
| Customers / CRM identity     | Partial | Flat `merchant.customer`+`contact` model with E.164 and deterministic WhatsApp/phone match. Missing: automatic merge-candidate detection. The `platform.contacts` spine was retired by design. |
| Payments gateway             | Missing | Manual/attested recording only. Tenders are cash / manual_terminal. Status hardcoded `captured`. No auth/capture/settlement/surcharge.                                                         |
| Ordering channels            | Partial | One `writeOrder` seam. Producers: WhatsApp and POS. `web`/`dashboard` are reserved enums with no writer. Online ordering not built.                                                            |
| Automations                  | Done    | BullMQ worker and repeatable schedulers. Two lifecycle families flag-off for cutover. No owner-facing automations builder.                                                                     |
| Dashboard (owner web)        | Done    | Every hook hits a real `/api/merchants/...` route. No mock layer. i18n (Lingui) complete: 1 untranslated of 975.                                                                               |
| Reporting / analytics        | Missing | No POS-sales rollups or product-mix model. Owner "revenue" is a loyalty top-up proxy.                                                                                                          |
| Contract / versioning        | Done    | 10.3K-line contract, `CONTRACT_VERSION=2.18.0`, heavy zod on POS surfaces. Thin reporting contract.                                                                                            |
| Multi-tenant / RLS           | Done    | Layered fail-closed RLS with a build-time guard (`90_rls.sql:648`). Cash-shift and refund device-scoping bugs fixed.                                                                           |

Two notes:

- The roadmap marks Gates 2A–12 complete. That grade is fair for the pilot transaction system. It does not mean the competitor ecosystem breadth is present.
- The audit found no `NotImplemented` and no "not implemented" throws in production code, and one environmental skipped test. Incompleteness is missing features and unset config, not half-written code.

---

## Part 4 — Capability gap matrix

Legend: ● strong/native, ◐ partial/add-on/third-party, ○ absent.

| Capability                             | Umi | Lightspeed | Toast | Square | Odoo | PoloTab |
| -------------------------------------- | :-: | :--------: | :---: | :----: | :--: | :-----: |
| POS and table service                  |  ◐  |     ●      |   ●   |   ●    |  ●   |    ●    |
| Full KDS client                        |  ○  |     ●      |   ●   |   ◐    |  ◐   |    ●    |
| Online / web ordering                  |  ○  |     ●      |   ●   |   ●    |  ●   |    ◐    |
| QR order and pay                       |  ○  |     ●      |   ●   |   ●    |  ●   |    ●    |
| Delivery integration                   |  ○  |     ●      |   ●   |   ●    |  ◐   |    ●    |
| Loyalty program                        |  ◐  |     ◐      |   ●   |   ●    |  ●   |    ○    |
| Gift cards / stored value              |  ●  |     ●      |   ●   |   ●    |  ●   |    ○    |
| Email / SMS marketing                  |  ○  |     ◐      |   ●   |   ●    |  ●   |    ○    |
| WhatsApp identity / CRM                |  ◐  |     ○      |   ○   |   ○    |  ◐   |    ◐    |
| Integrated payments gateway            |  ○  |     ●      |   ●   |   ●    |  ◐   |    ●    |
| Ingredient inventory / recipes         |  ◐  |     ●      |   ●   |   ◐    |  ●   |    ●    |
| Sales analytics / reporting            |  ○  |     ●      |   ●   |   ●    |  ●   |    ●    |
| Owner dashboard                        |  ●  |     ●      |   ●   |   ●    |  ●   |    ●    |
| Public API / marketplace               |  ○  |     ◐      |   ●   |   ●    |  ●   |    ○    |
| Self-order kiosk                       |  ○  |     ◐      |   ●   |   ●    |  ●   |    ○    |
| Native-first offline + device identity |  ●  |     ◐      |   ◐   |   ○    |  ◐   |    ●    |

---

## Part 5 — Prioritized build backlog

### P0 — Blocks a real ecosystem

1. Integrated payment gateway. Add card auth, capture, settlement, surcharge, and payment-level refund. Why: every competitor monetizes on processing. Where: `pos-checkout.repository.ts`, `32_pos_checkout.sql`, contract tenders.
2. Real KDS station. Add a device-role attribute, an unattended KDS session, a multi-column board with per-item state and timers, ticket commands, and an event stream. Then retire `umi-kds` at parity. Where: `kitchen_board_surface.dart`, `credential_vault.dart`, `umi_contract.dart`.
3. Sales analytics rollup. Build a POS-sales read model: net sales, product mix, daypart, employee, and per-café plus chain rollups with PoP/YoY. Where: a new API read model plus dashboard `overview.jsx`.

### P1 — Closes the biggest competitive gaps

4. Online and QR ordering channel. Add a `web` order writer and a QR order-and-pay flow that lands orders in the POS and KDS. Where: `shared/orders/order-writer.ts`.
5. Loyalty tiers, reward catalog, and enable switch. Add tiers, reward CRUD, an enablement surface, and birthday plus expiry crons. Where: `merchant.loyalty_*`, dashboard loyalty hub.
6. Offline auto-replay plus a real connectivity source. Add an OS connectivity source and automatic replay on reconnect. Where: `platform_adapters.dart`.
7. POS/KDS realtime plus a Redis adapter. Move POS and KDS from polling to event streams and add a Redis adapter for multi-replica scale. Where: realtime gateway, `realtime-channels.ts`.
8. Persist order type and add delivery aggregation. Save the order-type pill to the sale. Add Uber Eats / Rappi / DiDi aggregation into POS and KDS. Where: `catalog_surface.dart`, orders module.

### P2 — Depth, polish, and platform

9. Marketing (email / SMS / WhatsApp campaigns) on the customer model, using WhatsApp as the channel edge.
10. Merge-candidate detector and a fix for the stale `customer-identity-resolution` skill doc. Where: `identity.resolver.ts`.
11. Customer-display app mode and a decision on kitchen-ticket printing.
12. Self-order kiosk, hardware attestation, wallet secret provisioning, and the dashboard redesign tail (retire the `operations.jsx` bridge, deepen the Overview cockpit, add screen-level tests, add an automations surface).

---

## Part 6 — Positioning

1. Own reliability. Native-first, hardware-backed, offline-complete. Make "it keeps selling with no internet and no operator action" the promise.
2. Own the LatAm café. Spanish-first, WhatsApp-native, transparent pricing. Match PoloTab's design and beat its value.
3. Turn identity into loyalty. Umi resolves customers by phone and WhatsApp. Ship tiers, rewards, and campaigns on that spine.
4. Close the money loop. A payment gateway plus a sales-analytics rollup turns the certified core into a business the owner can run and Umi can monetize.

---

## Appendix — primary sources

- Lightspeed: `k-series-support.lightspeedhq.com` (Configuring Lightspeed Payments and related), `lightspeedhq.com/pos/restaurant`.
- Toast: `central.toasttab.com`, `doc.toasttab.com` (Platform and Developer Guide).
- Square: `squareup.com/help/us/en`, `squareup.com` (Square for Restaurants).
- Odoo: `odoo.com/documentation/19.0` (Point of Sale), `odoo.com/app/point-of-sale`.
- PoloTab: `polotab.com` and `/planes`; `admin.polotab.com` (described).

Full per-source detail with article URLs is in `sources/`.
