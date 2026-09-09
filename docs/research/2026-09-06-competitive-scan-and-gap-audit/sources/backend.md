# Umi Backend & Cross-cutting — Audit

Scope: `apps/umi-api` (NestJS), `packages/contract`, `docs/migration/build-v3` (canonical schema; branch `chore/build-v3-checkpoint`).
Method: CodeGraph index (1140 files / 21,993 nodes), file reads, SQL grep. Evidence cited file:line / migration.

Legend: ✅ finished · 🟡 partial · 🔴 missing/unfinished

## Architecture at a glance

- **Two-process runtime**: API (`app.module.ts`) + BullMQ **worker** (`apps/umi-api/src/worker.module.ts`), 6 queues (`jobs/queues.ts:10-17`: system, turns, enrichment, outbound, integrations, lifecycle).
- **Single canonical DB = build-v3** — schemas `umi` (tenancy/plans/users), `merchant` (all tenant commerce incl. customers/loyalty/gift-cards), `runtime` (device trust, operator sessions, reminder claims), `kds` (`00_foundation.sql:18-20`, `42_pos_kitchen.sql:51`). CRM identity lives in a **flat `merchant.customer`+`merchant.contact` model** here.
- **`platform.*` / `core.*` schemas are legacy/abandoned**: the `platform.contacts`/`contact_identities`/`merge_candidates` spine (and `core.product_instances` referenced by `entitlements.ts`) exist only in the older `docs/migration/local-postgres/001_platform_core.sql:162-223`, **not in build-v3**. The cross-product-contacts design was explicitly dropped for the flat model (owner decision 2026-07-09, `identity.resolver.ts:11-26`) — the `customer-identity-resolution` skill doc still describes the abandoned spine and is stale.
- **Contract**: `@umi/contract` v0.1.0 pkg; `CONTRACT_VERSION = '2.18.0'` (`packages/contract/src/catalog.ts:37`); ~10.3K lines, 23 files.
- **Modules registered**: all 40+ modules wired in `app.module.ts` imports; none commented out. `LifecycleModule`/`LeadsModule` schedulers live in the worker (`worker.module.ts:48`).
- **Test discipline**: only 1 skipped test in the whole API, and it is environmental (`kds.repository.integration.spec.ts:8` — `describe.skip` when no `DATABASE_URL`). No `NotImplemented`/`throw 'not implemented'` stubs in production module code.

---

## 1. Loyalty — 🟡 (real dual-model backend, fully wired; missing tiers, points-reward CRUD, enablement surface, issuance crons; ships pilot-OFF)

The brief's premise ("no loyalty in build-v3") is **false** — v3 kept loyalty and reorganized it by owning schema (`merchant.loyalty_*` split across `20_merchant.sql` config + `37/38/39_pos_customer_value*.sql` engine). There is no file literally named `*loyalty.sql`. Loyalty is one of the **most complete** domains. **Two parallel models, both wired:**

- **Points (event-sourced, POS)**: append-only double-entry `loyalty_points_ledger` (`37_pos_customer_value.sql:211`, trigger `:249`), `loyalty_points_account` (`:189`), `loyalty_points_balance` projection with pending/available/authorized/redeemed/reversed/expired/adjusted (`:255`). `entry_type` covers earn pending/committed/cancelled/reversed, authorize/release/redeem/reverse, `points_expired_foundation`, `manual_points_adjustment` (`37:216-224`); idempotency + command binding + fingerprint; balance rebuildable from facts.
- **Stamps/visits + saldo (legacy umi-cash)**: `loyalty_card` (`20:635`), `loyalty_visit` (`20:688`, `stamps` 1-50), `loyalty_reward` (`20:753`), `loyalty_redemption` (`20:770`), `loyalty_birthday_grant` (`20:792`), `loyalty_stored_value_ledger` (`20:659`). This is the path the dashboard reads today.
- **Earn/redeem wired end-to-end**: POS checkout → `merchant.commit_customer_value_closeout` (`pos-checkout.repository.ts:1238` → `38:381`) writes earn pending/committed via `append_loyalty_points` (`38:433`). Two-phase reward redeem: authorize hold `points_authorized` (`pos-customer-value.repository.ts:1101`) + reservation (`:1055`) → closeout `points_redeemed` (`38:463`) → release `points_released` (`:1294`). Manual adjustment via `commit_points_adjustment` (`38:323`) with approval gate >500 pts. Stamps credited by `cash-scan.service.ts:313`.
- **Contract is real points**, not an estimate: `pos-customer-value.ts` (1025 L) `PointsBalance` (`:312`), `PointsEarnPreview/Commit` (`:328/348`), `RewardType` incl `points_to_value` (`:356`). Endpoints: `customer-value/preview`, `rewards/authorize+release`, `stored-value/authorize+release`, `points/adjustments/preview+commit` (`pos-customer-value.controller.ts:70-134`).

**Gaps**: 🔴 **membership tiers do not exist** (no tier table/column anywhere — new schema + logic needed). 🟡 **program ships OFF by default** — `loyalty_program.enabled` default false, `policy_version='pilot-deny-v1'` (`37:177,184`); earn only fires `if v_policy.enabled` (`38:408`); **nothing in the API sets `enabled=true`** — no program-enablement/policy surface. 🟡 **no CRUD for the points reward catalog** (points rewards are read-only in the POS path; only the stamp reward config is writable, `cash.repository.ts:408`). 🟡 **birthday-issuance + points-expiry crons not ported** — birthday grants are read/redeemed but never *created* by a daily job (`20:790` comment); `points_expired_foundation` has no expiry job. (No cron infra for these in umi-api yet.)

---

## 2. Online ordering / order channels — 🟡 (POS + WhatsApp real; web/dashboard channels reserved-only)

- **Single write path**: `apps/umi-api/src/shared/orders/order-writer.ts:116` `writeOrder()` — writes `customer_order` + `order_item` (+ modifiers/discounts) + opening `order_event` + kitchen projection atomically inside the caller's transaction. Well-designed seam (docstring `:4-35`).
- **Producers = exactly two**: WhatsApp conversational checkout (`conversations/orders.repository.ts:127`) and POS checkout (`pos-checkout/pos-checkout.repository.ts:1098`). CodeGraph/grep find no others.
- **Channel enum** allows `whatsapp|pos|web|dashboard` (`20_merchant.sql:1066`; `order-writer.ts:37`) but **`web` and `dashboard` have no writer** — reserved for "an aggregator later" (`order-writer.ts:6`). No online-ordering storefront app exists (`apps/`: api, cash, dashboard, kds, landing-page, pos). → **Online/web ordering = 🔴 not built.**
- **Lifecycle**: linear status flow `placed→preparing→ready→completed` (+ `canceled`) enforced in `orders.service.ts:14-27`; dashboard order surface is **list + manual transition only** (`orders.controller.ts:26-44`), gated `dashboard` product + `kitchen.read`. No dashboard order creation.
- **Fulfillment types**: `pickup|dine_in|delivery` (`20_merchant.sql:1067`) — delivery is a type flag, no delivery dispatch/driver integration.
- Idempotency on `external_ref` (unique per merchant) for duplicate source deliveries (`order-writer.ts:127`).

**What's needed**: a real web/online-ordering channel (storefront + `web` writer); delivery orchestration if delivery is to be more than a label.

---

## 3. Payments — 🟡 (manual/attested recording; NO real gateway integration)

- **Tender types = `cash` | `manual_terminal` only** (`32_pos_checkout.sql:109`). There is no card-present capture, no gateway authorization.
- POS commit writes the full money spine transactionally: `pos_tender_fact` (`pos-checkout.repository.ts:834`), `pos_payment_attempt` (`:890`), `merchant.payment` (`:1117`), `receipt_snapshot` (`:1141`), `pos_committed_sale` (`:1166`) + order via `writeOrder`.
- `merchant.payment.method in ('cash','card','stored_value','gift_card')` (`20_merchant.sql:1338`) but the checkout **maps `external_terminal`→`'card'`, hardcodes `status='captured'`, and sets `external_ref` = the attempt id** (not a gateway payment id) (`pos-checkout.repository.ts:1124,1118`). So "card" = an operator attestation that the standalone terminal completed, not an electronic capture. Mixed tender supported (`:1127`).
- **Tips**: modeled — config (presets/custom %/fixed/max/permission) `32_pos_checkout.sql:54`, `tip_draft` on draft (`pos-checkout.repository.ts:378-427`), tip in receipt snapshot; folded through cash/manual_terminal checkout. ✅ within the manual model.
- **Surcharge/service charge**: 🔴 none in schema.
- **Settlement / payout / reconciliation to a processor**: 🔴 none.
- **Zettle**: exists only as a **catalog product-sync** job (`shared/adapters/zettle.adapter.ts` → `jobs/integrations.processor.ts` `zettle.sync`), single static `ZETTLE_API_KEY`, per-merchant OAuth deferred (`zettle.adapter.ts:11-14`); not a payment path. No scheduler enqueues `zettle.sync` (comment-only in `queues.ts:7`).
- **Refund at payment level**: `merchant.refund` table exists (`20_merchant.sql:1345`); POS refund/void flow runs through `pos_sale_exception` (see §10).

**What's needed**: real payment-provider integration (authorization/capture/webhooks/settlement), `pending→captured→failed` actually driven by a gateway, surcharges, payout reconciliation.

---

## 4. Gift cards — ✅ (two complete issue/redeem/balance systems, end-to-end)

- **Tables**: `merchant.loyalty_gift_card` (bearer `code_hash`+`masked_code`, face `amount_cents`, `20:808`), append-only `loyalty_gift_card_ledger` (`20:849`, trigger `20:871`), balance projection `loyalty_gift_card_balance` (`37:651`), `gift_card_secret_delivery` (`38:167`), `gift_card_lookup_attempt` (`38:252`), `gift_card_funding_assignment` (`39:125`). Issuance source `legacy|sale|promotion|development` (`38:238`).
- **POS customer-value path — full lifecycle**: `issueGiftCard` → INSERT card (`pos-customer-value.repository.ts:1628`) + ledger `append_gift_card_fact` (`:1665`) + secret delivery (`:1692`) + deliveryToken (`:1623`); `revealGiftCardSecret` (`:1755`), `activateGiftCard` (`:1862`), `giftCardLookup` by hash (`:1401`); balance = `SUM(delta)` (`:671`); redeem via stored-value authorize (`:1143`) → closeout `append_gift_card_fact('redeemed')`.
- **umi-cash path (what the dashboard reads today)**: issue `POST /cash/gift-cards` (`cash-write.controller.ts:41`), public redeem/lookup rate-limited (`cash-customer.controller.ts:66,73`); dashboard `gift-cards.jsx` (470 L) real issue + redeem-by-code + list, wired via `data.jsx:451`.
- **Seam (not a defect)**: one data model, two entry surfaces — POS issues into the same tables the cash list reads. No stubs/skips found.

## 4b. Wallet / passes — ✅ code / 🟡 config (real Apple + Google, blocked only by unset secrets + un-ported crons)

- **Apple — real**: `.pkpass` signing via `passkit-generator` with real signer/WWDR certs (`wallet/apple-pass.builder.ts:96-119`, throws if unconfigured `:83`); **APNs HTTP/2** push with ES256 provider-token JWT (`apple-push.service.ts:146-213`); full **PassKit web service** (register/unregister/serialsUpdatedSince/download/log, `apple-web-service.controller.ts:89-174`), tokens in `loyalty_wallet_pass.web_service_token` (`20:875`), device regs in `runtime.pass_device` (`30_runtime.sql:344`).
- **Google — real**: `walletobjects.googleapis.com` PATCH + OAuth JWT-bearer (`google-pass.service.ts:101,167-200`), signed Save-to-Wallet URL (`:71`), notify (`:130`).
- **stamp-strip.ts**: renders the punch-card image with `sharp` (`:71-133`) for both Apple and Google (counts come from `loyalty_visit`).
- **Push wiring live**: `WalletPassAdapter` fires Apple push + Google refresh after every visit/money write (`cash-scan.service.ts:175,358`, `cash-write.service.ts:100,144,231`); manual `POST /platform/wallet/push` (`platform-wallet.controller.ts:69`), health at `:42`.
- **Gaps**: 🟡 all wallet secrets are `.optional()` and services no-op when unset (`config.schema.ts:47-78`) — provision Apple/Google creds + `WALLET_PUBLIC_ORIGIN` in the deploy env. 🟡 same un-ported birthday-issuance / lifecycle-push crons as loyalty. Brand stamp assets still fetched over HTTP from umi-cash `public/` (`stamp-strip.ts:11-16`).

---

## 5. Devices & identity — ✅ (proof-of-possession real; true HW attestation is the honest gap)

(From dedicated device audit.)

- **Pairing state machine complete**: begin→claim→poll→approve/deny→acknowledge + rotate/revoke/replacement (`devices/devices.service.ts:44-366`; routes `devices.controller.ts:44-227`). Tables `runtime.device_enrollment_request` + `device_pairing_session`, hashed setup/polling/installation/credential values, attempt caps, TTL 5 min (`30_device_pairing.sql:5-83`; `devices.service.ts:58-113`).
- **Credentials**: HMAC-derived device credential + `credential_version` rotation, lifecycle `enrollment_pending|active|rotation_required|rotated|revoked|replaced|retired`, `device_revocation_ck`, one live install per tablet (`20_merchant.sql:1544-1605`). Auth matches `(public_id, installation_hash, credential_hash)` (`devices.service.ts:267-282`).
- **Roles = 2**: `DeviceType = ['pos_terminal','kds']` (`packages/contract/src/device.ts:14`; DB checks `20_merchant.sql:1550`, `30_device_pairing.sql:10`). **customer-display is a hardware peripheral, not an enrolled device role** (`40_pos_hardware_runtime.sql:36,84`); KDS is delivered as a **mode of the POS device** (`kds-pos.controller.ts:28-36`).
- **Hardware-backed identity 🟡**: `verifyDeviceProof` verifies ed25519 (software) **and** es256/P-256 (Secure Enclave/Keystore/TPM format) signatures over `installationId|timestamp` (`devices/device-proof.ts:57-115`); enforced in `pinLogin`/refresh (`auth.service.ts:222-245,277,349`). **Gap A**: server proves key *possession*, not that the key is hardware-backed — no Apple App Attest/DeviceCheck, no Android Play Integrity/key-attestation chain (acceptance path pre-wired, `device-proof.ts:15-20`). **Gap B**: proof is skipped when no key registered (`auth.service.ts:231`) — keyless device falls back to bearer only.
- **Revocation ✅**: `revoke()`/`rotate()` via integrity command bus with audit events (`devices.service.ts:284-366`); DB enforces revoked state.

**What's needed**: real attestation to prove the es256 key is hardware-backed; require a registered key at enrollment so proof is unconditional.

---

## 6. Automations / workflows — ✅ (real BullMQ engine; two lifecycle families flag-OFF by design)

(From dedicated audit.)

- **Real engine, not request-driven**: BullMQ (`@nestjs/bullmq`) worker process (`worker.ts:15-37`, `worker.module.ts:33-71`), repeatable job schedulers via `upsertJobScheduler`.
- **Schedulers**: `LifecycleScheduler` (reward_expiring/welcome_no_visit/winback/streak crons, `jobs/lifecycle.scheduler.ts:15-52`, flag `LIFECYCLE_CRONS_ENABLED` **default false** `config.schema.ts:154`); `LeadsScheduler` (email sequence daily, `jobs/leads.scheduler.ts:18-45`, `LEADS_SEQUENCE_ENABLED` **default false** `:169`); `CustomerValueExpiryScheduler` (every 60s, `jobs/customer-value-expiry.scheduler.ts:16-30`, `CUSTOMER_VALUE_EXPIRY_ENABLED` **default true / live** `:171`).
- Flags OFF for the two customer-facing families to avoid double-send during umi-cash/landing dual-writer cutover; code is complete and idempotently tears down jobs when flag off (`lifecycle.scheduler.ts:35-42`).
- **Lifecycle journeys** (streak/winback/welcome/reward-expiring) with per-merchant copy + durable dedup via `runtime.reminder_sent` claim (`lifecycle.service.ts:50-175`). **Lead nurture**: 5-step diagnostic_followup sequence, race-safe reserve→send→finalize (`leads/sequences.service.ts:38-243`).
- **Notification dispatch real**: `outbound.processor.ts:31-83` via `TwilioAdapter` (WhatsApp), retry=5→dead-letter. KDS customer notify gated `KDS_STATUS_NOTIFY_ENABLED` default false (`config.schema.ts:163`).
- **Conversation tool-loop**: `StubToolsService` is now DEAD — `conversations.module.ts:81` binds the **RealToolsService** (`tools.service.ts:20-91`, dispatches search_menu/add_to_cart/edit_cart/confirm_order/reorder/cancel). Stale docstring `conversations.module.ts:37-44` still says "stub for now".

**What's needed**: operationally flip the two flags at cutover; remove stale docstring.

---

## 7. Customers / CRM identity — 🟡 (flat model finished; the `platform.*` spine was abandoned by design; auto merge-candidate detection missing)

**Key correction to the skill's intent**: `platform.contacts`/`contact_identities`/`contact_merge_candidates` (and `cash.loyalty_accounts`, `conversaflow.conversations`) described by `.agents/skills/customer-identity-resolution/` were **deliberately abandoned** (owner decision 2026-07-09, cited `identity.resolver.ts:11-26`). build-v3 replaced them with a **flat `merchant.customer` + `merchant.contact` model**. Zero DDL for `platform.contact*` across all 32 build-v3 files. **The skill doc is stale relative to the schema.** Judge against the flat model → largely finished.

- **Canonical tables**: `merchant.customer` (`20:487`, soft-dedup target `merged_into_id` `:494`), `merchant.contact` (`20:522`, one reachability row per channel, dedup `contact_dedup_uq unique(merchant_id,channel_id,normalized_value)` `:558`), `merchant.customer_fact` (`20:567`, the CDP memory atom), channel catalog `umi.channel_type` (`10:277`).
- **Phone normalization (E.164) — ✅**: DB function `umi.e164()` (`00_foundation.sql:111`), per-channel `merchant.normalize_identity()` (`:145`); correctly preserves `+1`/existing-`+` numbers (decides on `had_plus` before stripping, `:97-125`). App never normalizes itself — resolver calls the DB fn (`identity.resolver.ts:249-260`) and `api` is REVOKE'd on writing `normalized_value`. Registration validation is a separate layer (`packages/contract/src/phone.ts:63-94`).
- **WhatsApp / cross-channel matching — ✅ (deterministic)**: phone/whatsapp/sms all normalize to one E.164 and match on `(merchant_id, normalized_value)` → one customer (`identity.resolver.ts:42-59,116-134`). Single `resolveIdentity()` (`:107-158`) serialized under `pg_advisory_xact_lock`. WhatsApp reply-address stored as-received `+521…` to avoid Twilio 63015 (`:197-244`). Only two callers (WhatsApp ingress + Cash self-registration), confirmed via CodeGraph.
- **Customer 360 — ✅ (read side)**: `customers.repository.ts:38 listCustomers` lateral-join rollup across identities, loyalty (visits/wallet), conversations, orders, memory; detail + UNION timeline (`:226-249`); endpoints list/detail/timeline/conversations/orders/cash/identity/insights (`customers.controller.ts:21-67`), gated `dashboard` product.
- **Merge / dedupe — 🟡**: **operator-driven merge IS implemented** (`pos-customer-value.repository.ts:1974` writes `merged_into_id` + `customer_merge_mapping` `:1985`, with elevation approval + value/consent conflict handling); recursive survivor-walk `merchant.customer_survivor()` (`20:507`). **MISSING (intentional)**: automatic merge-**candidate detection** — Customer 360 hardcodes `merge_candidate_count=0` and empty candidates (`customers.repository.ts:148,210,412`); nothing surfaces "these two look like the same person." **MISSING (deferred)**: `data_quality_findings` hardcoded 0 ("deferred to OTel", `:30,65,412`); per-customer gift-card count 0 (no customer FK on `loyalty_gift_card`, `:112-118`).
- **Stale comments (drift, not bugs)**: `identity.resolver.ts:350,124-127` claim "no unique constraint" on `merchant.contact` (now false, `20:558`); `20:504-505` says "nothing writes merged_into_id yet" (false since the POS merge shipped).

**What's needed**: a merge-candidate **detector** (the skill's core value — nothing writes candidates today); data-quality findings surface (or remove dead DTO fields); gift-card→customer attribution; reconcile the stale comments; **update the skill doc** (it points at a non-existent `platform.*` schema and will mislead agents that follow it literally).

---

## 8. Realtime — 🟡 (real WS transport, only 2 nudge channels; POS/KDS are poll-based; single-replica)

(From dedicated audit.)

- **Transport**: Socket.IO gateways (`@nestjs/websockets`), API-process only (`realtime.module.ts:7-15`); in-process rxjs `Subject` bus. Not Supabase realtime, not SSE.
- **Only 2 namespaces** (`packages/contract/src/realtime-channels.ts`): `/rt` `device.pairing.changed` room `pairing:<id>` (`pairing-realtime.gateway.ts:30-118`); `/rt/dashboard` `dashboard.devices.changed` room `dashboard:<merchantId>` (`dashboard-realtime.gateway.ts:24-99`). Both **nudge-only** ("re-read via REST"); payload never on socket (`realtime-channels.ts:16-38`).
- **POS: no realtime channel.** **KDS: poll-based** — `POST /api/kds/board` on demand (`kds.controller.ts:50-67`), `x-kds-device-token` auth; only emits a dashboard devices-changed nudge (`kds.service.ts:478`). Kitchen display polls; no push.
- **One-way confirmed** (matches memory): dashboard gateway emit-only, no client→server handlers (`dashboard-realtime.gateway.ts:42-46`); KDS→commercial is one-way, forward advance device-token-only via `POST /api/kds/command` (`kds.controller.ts:76-93`).
- **Contract shape confirmed (memory)**: `realtime-channels.ts` is zero-dep plain constants (no zod) so the dashboard browser build doesn't pull zod; `realtime.ts:7-14` re-exports names + adds zod payload schemas.
- **Scaling gap**: in-process `Subject` → single API replica; needs `@socket.io/redis-adapter` for >1 replica (documented `device-pairing.events.ts:9-13`, `dashboard-realtime.events.ts:11-14`).

**What's needed**: POS/KDS push channels if poll is insufficient; Redis Socket.IO adapter before horizontal scale.

---

## 9. Contract / versioning layer — ✅ (comprehensive on POS; thin on reporting)

- `@umi/contract` v0.1.0, `CONTRACT_VERSION='2.18.0'` (`catalog.ts:37`). ~10,298 lines / 23 files (`packages/contract/src`).
- **Single path authority**: `route-table.ts` (2,581 lines, zero-dep) → `routes.ts`. `platform.ts` holds shared money/id/pagination/error/tenancy vocab.
- **Zod coverage**: heavy on POS surfaces — `pos-customer-value.ts` (1025 L / 206 zod), `pos-inventory` (130), `pos-hardware` (127), `pos-offline` (103), `pos-cash` (91), `platform` (91), `pos-exception` (80), `schemas.ts` (79), `pos-checkout` (65). **Zero-dep (no zod) on purpose**: `route-table`, `routes`, `realtime-channels`, `entitlements`, `phone`, `catalog` (for the zod-free dashboard bundle).
- **realtime-channels.ts is zod-free** (0 schema calls; "zod" only in comments) — memory item verified; a test guards it (`realtime-channels.ts:1-11`).
- **Thin/weak**: `dashboard-operations.ts` only 167 L / 22 zod — reporting contract is thin. No dedicated loyalty or gift-card contract file (folded into `pos-customer-value.ts`). No standalone commercial-order contract (order surface lives in route-table + POS surfaces).
- **Known drift**: `entitlements.ts` admits api guard and dashboard registry hand-maintain duplicate `PRODUCT_ACTIVE_STATUSES` — "re-wiring lands in a follow-up PR" (`entitlements.ts:5-8`).

---

## 10. Multi-tenant / RLS — ✅ (strong, fail-closed; the two known owner-blindness bugs are FIXED)

- **Tenancy helpers**: `umi.current_merchant()/current_location()/current_device()` from GUCs (`00_foundation.sql:23-40`; redefined `90_rls.sql:12-45`). POS repos run as role `api` (RLS-enforced); worker uses BYPASSRLS pool.
- **Layered RLS**: PERMISSIVE `merchant_isolation` (which merchant) + RESTRICTIVE `location_narrowing` (NULL location = all, safe for owner reports) + RESTRICTIVE `device_scoping` (fail-closed: no proven device = 0 rows on the replay/journal tables). Applied by **catalog sweeps** over `pg_class` (opt-OUT lists), so a new table is scoped by default (`90_rls.sql:461-567`).
- **Fail-closed build guard**: `90_rls.sql:648-682` aborts the build if any `merchant` table with a `device_id` has no `device_scoping` decision (scoped or explicitly named in `not_device_scoped`). Strong invariant.
- **Products/entitlements**: 5 products `cash|conversaflow|kds|dashboard|pos` (`entitlements.ts:21`), `EntitlementGuard`+`@RequireProduct`, `umi.plan`/`umi.subscription` (`10_umi.sql:311,333`), active statuses `active|trialing`.

### Verified known items
- **cash_shift device_scoping (owner "Turnos de caja" empty)** — **FIXED** in build-v3: policy rewritten to `using(true)` with the device predicate moved to `WITH CHECK` (writes only); reads fall through to merchant_isolation + location_narrowing (`90_rls.sql:573-611`). Owner (device-less) sessions can now read shifts.
- **pos_sale_exception device_scoping (owner "Reembolsos" empty)** — **FIXED** identically: `using(true)`, `WITH CHECK` pins writes to acting device or authorized dashboard `refund.preview|commit` administrative_command; append-only (`90_rls.sql:613-646`). Owner can now read refunds/voids.
- **pos_sale_exception RLS for refunds/voids** — present and correct (append-only, device-or-command write auth) (`34_pos_exception.sql:105-234,464-472`; `90_rls.sql:631-646`).
- **Category colors server-assigned (contract 2.18.0)** — **confirmed/complete**: `merchant.product_category.color` NOT NULL, `#RRGGBB` check, default random of 16-colour palette (`20_merchant.sql:913`); server assigns the **least-used** palette entry on create (random tiebreak) (`dashboard-catalog.repository.ts:48-66`); owner recolours in dashboard (`dashboard-catalog.controller.ts`). No "automatic" state.

### RLS risks / notes
- `location_narrowing` opt-outs (`staff`, `loyalty_visit`) and `not_device_scoped` (stock/loyalty ledgers, kitchen_command/device_station) are deliberate — each documented (`90_rls.sql:474-483,654-665`). Worth a periodic re-review that ledger tables truly need no device scoping.
- `platform`/`core` schemas (CRM identity, `core.product_instances` referenced by entitlements) are absent from build-v3 → cross-DB coupling; entitlement guard's source-of-truth spans a DB build-v3 doesn't create.

---

## 11. Reporting / analytics data model — 🟡 (no analytics model; live ad-hoc aggregation, loyalty/Cash-scoped)

- **No analytics/rollup model — confirmed absent**: zero materialized views, zero rollup/summary/daily tables in build-v3. Only plain `security_invoker` views (`merchant.order_total` `20:1442`, `order_ticket` `:1504`, `conversation_analytics` `:1662` per-conversation, `customer_history_event`, `kds.station_*`). No scheduled aggregation (only `setInterval` for outbox-relay + rate-limit; no `@Cron`, no `REFRESH MATERIALIZED`).
- **`dashboard-operations` is a row browser, not analytics**: a `QUERIES` map of 21 live per-domain SELECTs (organization, locations, sales, receipts, refunds_voids, cash_shifts, customers, loyalty, rewards, gift_cards, kitchen, audit, …), cursor-paginated, RLS-scoped (`dashboard-operations.repository.ts:22-249`). **No `GROUP BY`, no totals, no time-bucketing** — the `sales` domain lists individual committed sales with per-row `grand_total` but never sums them. Migrations `43/44` are the write-side (admin command provenance/elevation), not analytics. `dashboard-catalog.*` is category CRUD + palette.
- **Real owner metrics live in the Cash module — computed in JS per request**: `cash-read.service.ts:108 getStats` + `:120 getAnalytics` build 30-day visits sparkline, top customers, 8-week new-customer cohorts, retention rate, avg ticket, loyalty-cycle profitability — all via JS date-bucketing over raw rows (`:132-194`); underlying live SELECTs over `loyalty_visit`/`loyalty_stored_value_ledger`/`loyalty_redemption` (`cash.repository.ts:154,199`). No caching, no rollup.
- **Critical gaps**: metrics are **loyalty/Cash-scoped, not sales-scoped** — "revenue"/"avgTicket" derive from the **stored-value top-up ledger** (`SUM(abs(delta))`, `cash.repository.ts:265`), **not** from `pos_committed_sale`/`receipt_snapshot.grand_total`. **No POS-sales report anywhere** (no `SUM(grand_total)`/`GROUP BY business_date`). No product-mix analytics (nothing aggregates `order_item` lines). No true LTV; "retention"/"cohorts" are loyalty-card proxies. JS bucketing won't scale past pilot.

**What's needed**: a real **sales analytics model** over `pos_committed_sale`/`receipt_snapshot` (daily/location revenue, ticket count, avg ticket); product-mix aggregation over order lines; a rollup/materialized (or at least date-bucketed SQL) layer to replace JS bucketing; consolidate the split between `cash-read.service` (real metrics) and `dashboard-operations` (row lists).

---

## Domain status summary

| # | Domain | Status | One-line |
|---|---|---|---|
| 1 | Loyalty | 🟡 | Real dual-model backend (event-sourced points + legacy stamps/saldo), fully wired at checkout; missing tiers (🔴), points-reward CRUD, enablement surface, issuance/expiry crons; ships pilot-OFF. |
| 2 | Ordering / channels | 🟡 | POS + WhatsApp real via one `writeOrder` seam; `web`/`dashboard` channels reserved-only → online ordering 🔴 not built. Linear lifecycle, manual dashboard transition. |
| 3 | Payments | 🟡→🔴 | Manual/attested recording only (cash + manual_terminal); no gateway auth/capture/settlement; tips ✅, surcharge/settlement 🔴. Zettle = catalog sync only. |
| 4 | Gift cards | ✅ | Two complete issue/redeem/balance systems (POS + cash) over one ledger; dashboard UI wired. |
| 4b | Wallet / passes | ✅ code / 🟡 config | Genuine Apple pkpass+APNs+PassKit web service and Google Wallet; blocked only by unset optional secrets + un-ported crons. |
| 5 | Devices & identity | ✅ | Full pairing/rotate/revoke; ed25519+es256 proof-of-possession enforced; true HW attestation is the honest gap; 2 roles. |
| 6 | Automations | ✅ | Real BullMQ worker + repeatable schedulers; 2 lifecycle families flag-OFF by design; RealToolsService live. |
| 7 | CRM identity | 🟡 | Flat `merchant.customer`+`contact` model finished (E.164, WhatsApp match, Customer 360, operator merge); `platform.*` spine abandoned by design; auto merge-candidate detection missing. |
| 8 | Realtime | 🟡 | Socket.IO nudge channels for pairing + dashboard only; POS/KDS poll-based; single-replica (needs Redis adapter). |
| 9 | Contract | ✅ | 10.3K L, v2.18.0, heavy zod on POS; thin on reporting; minor entitlement drift. |
| 10 | Multi-tenant / RLS | ✅ | Layered fail-closed RLS with build-time guard; both known owner-blindness bugs FIXED; category colors done. |
| 11 | Reporting | 🟡 | No analytics model; live ad-hoc JS aggregation, loyalty/Cash-scoped; no POS-sales report, product mix, or true LTV/cohort. |

## Prioritized unfinished list (backend)

1. **Payments: no real gateway** (🟡→🔴 for card) — cash/manual_terminal attestation only; no auth/capture/settlement/webhooks; `status` hardcoded `captured`; no surcharge/payout. Biggest commerce gap. (`32_pos_checkout.sql:109`, `pos-checkout.repository.ts:1117-1138`)
2. **Reporting: no sales analytics model** (🟡) — owner "revenue" is a loyalty top-up proxy, not POS sales; no rollups, no product mix, JS bucketing. (`cash-read.service.ts:120-194`, `dashboard-operations.repository.ts:22-249`)
3. **Online/web ordering channel not built** (🔴) — `web`/`dashboard` sources reserved, no storefront, no writer. (`order-writer.ts:6,37`)
4. **Loyalty finishing** (🟡) — no membership tiers (🔴, new schema); no points-reward catalog CRUD; no program-enablement/policy surface (ships `enabled=false`/`pilot-deny-v1`); birthday-issuance + points-expiry crons not ported. (`37:177,184`; `20:790`)
5. **CRM merge-candidate detector** (🟡) — operator merge works, but nothing auto-surfaces duplicates (`merge_candidate_count` hardcoded 0); skill doc points at abandoned `platform.*` schema and must be updated. (`customers.repository.ts:148,412`; `identity.resolver.ts:11-26`)
6. **Hardware attestation** (🟡) — possession proven, hardware-backing not verified; keyless devices skip proof. (`device-proof.ts:15-20`, `auth.service.ts:231`)
7. **Realtime for POS/KDS + multi-replica** (🟡) — poll-based board, single-replica socket bus (needs `@socket.io/redis-adapter`). (`kds.controller.ts:50-67`, `dashboard-realtime.events.ts:11-14`)
8. **Wallet config** (🟡) — provision Apple/Google secrets + `WALLET_PUBLIC_ORIGIN`; port birthday-push crons. (`config.schema.ts:47-78`)
9. **Automations cutover** (operational) — flip `LIFECYCLE_CRONS_ENABLED`/`LEADS_SEQUENCE_ENABLED`; retire legacy dual-writers. (`config.schema.ts:150-169`)
10. **Contract drift + Zettle** — entitlement `PRODUCT_ACTIVE_STATUSES` duplicated api/dashboard (`entitlements.ts:5-8`); reporting contract thin; `zettle.sync` consumer exists but nothing enqueues it (`queues.ts:7`).
