# Curated Column Mapping — Source → Canonical Schema

**Date:** 2026-06-18
**Status:** Reviewed by the final adversarial sweep (2026-06-18, 34 confirmed findings).
All confirmed fixes folded in below, tagged `[id]`. **All 3 owner decisions resolved
(2026-06-18): M1=two distinct logins · M3=drop 2 orphan OTP · M10=preserve links live.**
✅ Ready for Phase 3.
**Driver:** `~/.claude/plans/cozy-wishing-clarke.md`. Ground truth: `docs/migration/catalog/`.
**Rule:** every source column is either mapped (with canonical naming + the relationship
it preserves) or dropped with a reason + count. Nothing silently left behind.

Legend: **→** maps to · **⤳** transformed · **⊘** dropped (reason) · **⊕** merged.

---

## Infra / Secret Continuity Precondition (cutover-BLOCKING) [B3]

**Data byte-identity is necessary but NOT sufficient.** Carrying the rows below unchanged
is useless if the secrets that validate them change. These are hard-stop preconditions,
verified at Phase A preflight and re-checked at Phase H (auth) and immediately pre-cutover.
Mirror this block into `2026-06-16-execution-runbook.md`.

| #   | Carry UNCHANGED                                                          | Breaks if changed                              |
| --- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| 1   | `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET` (HS256)                       | all 154 live sessions invalidate → mass logout |
| 2   | `APP_QR_SECRET` (wallet-barcode HMAC key)                                | all 348 wallet barcodes un-scannable at POS    |
| 3   | Apple APN auth-key/cert + `passTypeIdentifier` + PassKit `webServiceURL` | 310 pass devices stop updating; passes orphan  |
| 4   | Google Wallet SA key + issuer/class IDs                                  | google passes break                            |

Cross-referenced from the continuity rows below (`core.sessions`, `loyalty.cards.card_number`,
`qr_token`, `loyalty.passes`, `loyalty.pass_devices`). Password-hash continuity (Phase H) is
**separate** from JWT signing-key continuity.

---

## Locked decisions

- **D-T1 (tenant correspondence):** ConversaFlow business **"Café Kalala Chapule"**
  (`ef9005a2-…`, `caf-kalala-chapule`, 11 WhatsApp customers) **IS** Cash **"Kalala Café"**
  (`kalalacafe`). WhatsApp is its messaging channel. → both source-tenant ids collapse to
  **one** `core.tenant`. (Owner-confirmed 2026-06-18.)
- The `platform.*` schema (people/contact_identities/tenants/users/memberships/…) is a
  **derived 2026-06-13 backfill** → discarded and re-derived from the authoritative
  sources (Cash + ConversaFlow), per canonical note. Not copied.
- **Person grain is per-tenant** (architecture §"Why tenant-scoped people"): the same
  phone in two tenants = two `core.people`. Verified: phone `…2296855` is a separate
  `User` in all 4 real Cash tenants.

## Tenant map (authoritative sources → `core.tenants`)

Target id = `legacy.stable_uuid('tenant:'||<canonical_key>)` (deterministic).
`_migration.tenant_map` records **every** source id → core id (both Cash + CF ids for kalalacafe).

| core.tenant (slug) | Cash `Tenant.id` | CF `businesses.id` | customers               | sub.status    | notes                                                                                   |
| ------------------ | ---------------- | ------------------ | ----------------------- | ------------- | --------------------------------------------------------------------------------------- |
| elgranribera       | `cmn9hv6qe…2oq`  | —                  | 325                     | ACTIVE        | Cash-only                                                                               |
| kalalacafe         | `cmn9hv9z3…5p3`  | `ef9005a2-…` ⊕     | 2 loyalty + 11 WhatsApp | ACTIVE        | **merged (D-T1)**                                                                       |
| nectarcafe         | `cmp7m8ybf…yx1`  | —                  | 20                      | ACTIVE        | Cash-only                                                                               |
| northwestcafe      | `cmnbui341…qhn`  | —                  | 1                       | **SUSPENDED** | Cash-only                                                                               |
| umicafe            | `cmo7pvmur…2aq`  | —                  | 0                       | **SUSPENDED** | internal shell — **1 real ADMIN login** (`hola@umiconsulting.co`) → `core.users` [ID-6] |

---

## Domain: `core` (identity & tenancy)

Source tables consumed: Cash `Tenant`, `User`, `Location`, `Session`; CF `businesses`,
`customers`, `dashboard_users`. (Each non-identity column of Cash `Tenant` **fans out**
to its real domain — flagged below and detailed in that domain's pass, so nothing is lost.)

### `core.tenants` ← Cash `Tenant` (26 cols) ⊕ CF `businesses`

Canonical `core.tenants` is intentionally minimal (id, slug, name, status, timezone, ts).
Cash `Tenant`'s branding/loyalty/billing columns **do not belong here** — they fan out:

| Cash `Tenant` col                                                                                        | Disposition                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                                                                                                       | ⤳ `core.tenants.id` via stable_uuid; raw id kept in `_migration.tenant_map`                                                                                                                                                                                                  |
| slug, name                                                                                               | → `core.tenants.slug`, `.name`                                                                                                                                                                                                                                               |
| subscriptionStatus                                                                                       | ⤳ **total value map [M2]:** `core.tenants.status` (`ACTIVE`→`active`, `SUSPENDED`→`disabled`); **separately** → `grow.subscriptions.status` (billing CHECK `active/trialing/disabled/missing/archived`; `SUSPENDED`→`disabled`). Lifecycle ≠ billing — two distinct columns. |
| timezone                                                                                                 | → `core.tenants.timezone`                                                                                                                                                                                                                                                    |
| createdAt, updatedAt                                                                                     | → `core.tenants.created_at`, `.updated_at`                                                                                                                                                                                                                                   |
| city                                                                                                     | → `ops.businesses.city` (brand profile)                                                                                                                                                                                                                                      |
| cardPrefix                                                                                               | → `loyalty.programs.card_prefix`                                                                                                                                                                                                                                             |
| primaryColor, secondaryColor, logoUrl, stripImageUrl, passStyle, promoMessage, promoDays/StartsAt/EndsAt | → `ops.businesses` brand config / `loyalty.programs` pass styling                                                                                                                                                                                                            |
| businessHours (jsonb)                                                                                    | → `ops.business_hours` (parsed) — detailed in ops pass                                                                                                                                                                                                                       |
| topupEnabled, selfRegistration                                                                           | → `loyalty.programs` flags                                                                                                                                                                                                                                                   |
| birthdayRewardEnabled, birthdayRewardName                                                                | → `loyalty.programs` / `loyalty.automation_rules`                                                                                                                                                                                                                            |
| lifecycleCopy (jsonb)                                                                                    | → `loyalty.automation_rules` copy (lifecycle pass)                                                                                                                                                                                                                           |
| suspendedAt, trialEndsAt                                                                                 | → `grow.subscriptions`                                                                                                                                                                                                                                                       |

CF `businesses` (id, name, business_type, config, open_times) for the kalalacafe tenant:
`business_type`/`config`/`open_times` → `ops.businesses` (brand/config); `id` ⊕ into the
kalalacafe `core.tenant`. **No column dropped.**

### `core.people` ← Cash `User` (CUSTOMER) ⊕ CF `customers`, deduped per tenant

| Source col                 | → target                                                                                   | notes        |
| -------------------------- | ------------------------------------------------------------------------------------------ | ------------ |
| Cash `User.id` (CUSTOMER)  | ⤳ stable_uuid → `core.people.id`; raw in `_migration.person_map`                           |              |
| `User.tenantId`            | ⤳ `core.people.tenant_id` (via tenant_map)                                                 |              |
| `User.name`                | → `core.people.display_name`                                                               |              |
| `User.phone`               | ⤳ `core.contact_methods` (kind=phone, `normalize_phone()`); also `people.normalized_phone` | dedup key    |
| `User.email`               | ⤳ `core.contact_methods` (kind=email)                                                      |              |
| `User.birthDate`           | → `core.people.birth_date` (add col; drives birthday reward)                               |              |
| `User.phoneVerifiedAt`     | → `core.contact_methods.verified_at`                                                       |              |
| `User.device`, `User.os`   | → `core.people.metadata` (non-sensitive provenance)                                        |              |
| `User.role`                | ⊘ as a column (roles are edges); routes the row (CUSTOMER→people only)                     |              |
| `User.passwordHash`        | ⊘ for CUSTOMER (none); for STAFF/ADMIN → `core.users` (below)                              |              |
| `User.createdAt/updatedAt` | → `core.people.created_at/updated_at`                                                      |              |
| CF `customers.id`          | ⤳ → `core.people.id` (under kalalacafe), `_migration.person_map`                           |              |
| CF `customers.phone`       | ⤳ `core.contact_methods` (kind=whatsapp + phone) — **dedup vs Cash phone**                 | merges Lucio |
| CF `customers.name`        | → `core.people.display_name` (coalesce w/ Cash if merged)                                  |              |
| CF `customers.business_id` | ⤳ `core.people.tenant_id` = kalalacafe                                                     |              |
| CF `customers.created_at`  | → `core.people.created_at` (earliest if merged)                                            |              |

**Dedup key [ID-5]:** `COALESCE(normalize_phone(phone) → E.164, 'last10:'||right(digits,10),
'src:'||source_system||':'||old_id)` — a ladder, **never `e164` alone**. So CF customer
`16315551181` (no valid E.164 → NULL) becomes its **own** row, not a NULL-collision bucket;
tag it + `+15005550006` `metadata.synthetic=true`. One `core.people` per `(tenant_id, key)`;
`resolve_contact()`. Idempotent via `_migration.person_map(source_system, old_id) → person_id`.

### `core.users` + memberships ← Cash `User` (ADMIN/STAFF) ⊕ CF `dashboard_users`

| Source col                                          | → target                                                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Cash `User` (role ADMIN/STAFF): id,name,email,phone | → `core.people` **+** `core.users` (login)                                                                                                |
| `User.passwordHash`                                 | → `core.users.password_hash` (algorithm `scrypt-sha256-v1`; `password_salt` split if `salt:hash`) — **REVOKE password cols FROM umi_app** |
| `User.role` ADMIN/STAFF                             | ⤳ `core.tenant_memberships` + `core.membership_roles` (role edge) + `core.staff_members`                                                  |
| CF `dashboard_users.auth_user_id`                   | → `core.users.auth_subject`                                                                                                               |
| CF `dashboard_users.role`                           | ⤳ `core.tenant_memberships` + `core.membership_roles`                                                                                     |
| CF `dashboard_users.business_id`                    | ⤳ membership tenant = kalalacafe                                                                                                          |

**Staff dedup key = normalized email** (all staff phones are blank, so G4/phone can't dedup) [M1].
RBAC catalog (`roles`/`permissions`/`role_permissions`) — **seeded** in DDL (source rows = 0), not migrated.

✅ **M1 resolved (owner, 2026-06-18) — two distinct `core.users`:** CF
`dashboard_users.auth_user_id` (`ffac2255…`) and Cash kalalacafe ADMIN
(`admin@kalalacafe.mx`) become **two separate `core.users`** (both existing logins keep
working; continuity-safe), optionally linked to one `core.people`. G4-companion check
asserts the merged tenant has exactly 2 owner principals.

### `core.locations` ← Cash `Location` (7 cols)

id⤳stable_uuid · tenantId⤳tenant_id · name→name · address→`core.locations.address` (add) ·
isActive⤳status (`true`→active) · latitude/longitude → `core.locations.{lat,lng}` (add). No drop.

### `core.sessions` ← Cash `Session` (5 cols) — **continuity, new canonical table** [B2]

Principal is **not** polymorphic. Columns: `(id, person_id NULL→core.people, user_id
NULL→core.users, tenant_id NOT NULL, token, expires_at, created_at)` with
`CHECK ((person_id IS NOT NULL) <> (user_id IS NOT NULL))` (exactly one).

| Cash `Session` col | → `core.sessions`                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| id                 | ⤳ stable_uuid → id (raw in `_migration.session_map`)                                                            |
| userId             | ⤳ **routed by owner role:** CUSTOMER (139) → `person_id` (person_map); ADMIN/STAFF (15) → `user_id` (users map) |
| —                  | `tenant_id` = denormalized from the owner's tenant (NOT NULL)                                                   |
| token              | → `token` **byte-identical** (refresh JWT) — see token-`sub` note ↓                                             |
| expiresAt          | → `expires_at` **unchanged** (all 154 live, expire 06-19→07-18)                                                 |
| createdAt          | → `created_at`                                                                                                  |

**Token `sub` remap [B2]:** each refresh JWT's `sub` claim is the **old** Cash `User.id`,
which won't resolve to the new `stable_uuid`. Either re-issue all 154 tokens at cutover,
**or** the verifier translates `sub`(old id)→new id via `_migration.person_map`/`user_map`.
Requires the HS256 secret carried unchanged (precondition #1).
**RLS [B2]:** `core.sessions` has no tenant-loop coverage by `050` (identity table) — add an
**explicit `050` block**: ENABLE+FORCE + dual self-access policy (`person_id = app.person_id`
OR `user_id = app.user_id`); extend `050` §6 self-check to assert RLS on tenant_id-bearing
identity tables. `umi_app` must not hold blanket DML on this table.
**Gate:** 154/154 present, token+expires_at unchanged, 139 resolve person-only + 15 user-only.

### `_prisma_migrations` (Cash, 18) — ⊘ documented drop

Prisma tool metadata; not business data. Recorded in the per-table reconciliation as
`dropped: tooling-metadata (18)`. The new platform is not Prisma-managed for this schema.

> **Owner-confirmed 2026-06-18:** fan-out of `Tenant` config to ops/loyalty/grow ✅;
> typed column additions to `core.*` ✅. `umicafe` kept (now noting its 1 ADMIN login) ✅.

---

## Domain: `loyalty` (points, wallet, rewards, passes)

Source: Cash `LoyaltyCard`, `Visit`, `Transaction`, `GiftCard`, `RewardConfig`,
`RewardRedemption`, `ApplePushToken`, `OtpVerification`, `LifecycleEvent`, `BirthdayReward`, plus
loyalty config fanned out from `Tenant`.

**Money model (reconciles DDL `003` to the integrity spec — G3 + conservation):** the
mutable `LoyaltyCard.balanceCentavos` becomes an **append-only value ledger**
`loyalty.points_ledger` (one `migration_initial_balance` entry per card,
`idempotency_key='migrate_cash_card_'||id`) with `loyalty.balances` as the derived cache
(`= SUM(delta)`). **`loyalty.cards.balance_cents` and `loyalty.balances` reconcile ONLY
against `points_ledger` SUM(delta) — never `wallet_transactions` [M5].** `Transaction`
history → `wallet_transactions` (not re-posted to the ledger → no double-count). Conservation
gate: `SUM(balanceCentavos)=95,000¢ == SUM(ledger migration entries) == SUM(balances)`.
**Append-only triggers on ALL THREE ledgers** — `points_ledger`, `gift_card_ledger`,
`wallet_transactions` (integrity gate check #4 expects 3) [M4].

> **Known data-quality finding [M5]:** `wallet_transactions` history sums to 94,899¢ vs the
> authoritative 95,000¢ — a pre-existing Cash bug on card `cmn9i7ewc…` (a `-101 'Pago con
saldo'` purchase never debited from balance). Authoritative value = 95,000¢; log a
> `data_quality_finding`; do **not** reconcile balances against history.

### `loyalty.programs` ← fan-out from Cash `Tenant` (one program per tenant)

`cardPrefix`→card_prefix · `topupEnabled`→topup_enabled · `passStyle`→pass_style ·
branding (colors/logo/promo)→`branding` jsonb · `selfRegistration`→flag. status='active'.

### `loyalty.accounts` ← derived (one per person per program; D5)

`id` stable_uuid · `tenant_id` · `person_id` (from person_map) · `program_id` ·
UNIQUE(tenant_id, person_id, program_id). Cards attach here (group by person, dedupe if a
person holds >1 card). No source columns dropped — grain change only.

### `loyalty.cards` ← Cash `LoyaltyCard` (17 cols) **[continuity-critical]**

| col                                          | →                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| id                                           | ⤳ stable_uuid → `cards.id`; raw in `_migration.card_map`                                                                                         |
| tenantId, userId                             | ⤳ `tenant_id`, `account_id` (via person→account)                                                                                                 |
| cardNumber                                   | → `card_number` **byte-identical** (wallet barcode = `cardNumber.hmac(APP_QR_SECRET)`; precond #2)                                               |
| balanceCentavos                              | ⤳ seed `points_ledger` migration entry (`*Centavos` = already cents, copied 1:1, **no ×100** [M9]); `balance_cents` = cache reconciled to ledger |
| totalVisits, visitsThisCycle, pendingRewards | → cache cols, reconciled to `visit_events`/redemptions                                                                                           |
| applePassSerial, applePassAuthToken          | ⤳ `loyalty.passes` (provider=apple) **byte-identical** (precond #3)                                                                              |
| googlePassObjectId                           | ⤳ `loyalty.passes` (provider=google) **byte-identical** (precond #4)                                                                             |
| qrToken, qrIssuedAt                          | → `cards.qr_token`, `.qr_issued_at` **byte-identical**                                                                                           |
| lifecycleMessage, lifecycleMessageUpdatedAt  | → `cards.metadata` (last nudge cache)                                                                                                            |
| createdAt, updatedAt                         | → `created_at`, `updated_at`                                                                                                                     |

### `loyalty.passes` + `loyalty.pass_devices` **[continuity-critical]**

- `passes` ← LoyaltyCard pass cols (serial/authToken/googleObjectId) — preserve exactly.
- `pass_devices` ← **`ApplePushToken` (310, all 5 cols)**: id⤳, cardId⤳pass_id (apple pass
  of the card), deviceToken→device_token, pushToken→push_token, createdAt→created_at.
  `tenant_id` derived via card [PN-07]. **Carry every row** — APNs tokens are the only path
  for pass updates. Backfill uses `ON CONFLICT (pass_id, device_token)` (idempotent re-run).

### `loyalty.points_ledger` (append-only) + `loyalty.balances` (derived)

Seeded from `balanceCentavos`. `Visit` stamps stay in `visit_events`; the value ledger is
wallet money only. Append-only trigger (G3).

### `loyalty.wallet_transactions` ← Cash `Transaction` (7) — history **(append-only; trigger required, G3) [M4]**

id⤳ · cardId⤳loyalty_card_id · staffId⤳staff_member_id · type (`TOPUP`→topup,
`PURCHASE`→purchase) · amountCentavos→amount_cents (signed, already cents) · description ·
createdAt→created_at. No drop.

### `loyalty.visit_events` ← Cash `Visit` (5)

id⤳ · cardId⤳loyalty_card_id · staffId⤳staff_member_id (required FK — keep) ·
scannedAt→occurred_at · note→note. 385 rows. (`staffId` NOT NULL — confirm all staff
resolve, else stage a `system` staff member.)

### `loyalty.reward_configs` ← Cash `RewardConfig` (9) — 16 rows

visitsRequired→visits_required · rewardName→reward_name · rewardDescription→reward_description ·
rewardCostCentavos→reward_cost_cents (already cents) · isActive→is_active · activatedAt/createdAt→ts. No drop.

### `loyalty.reward_redemptions` ← Cash `RewardRedemption` (6) — **16 rows (NOT empty)**

id⤳ · cardId⤳loyalty_card_id · configId⤳reward_config_id · staffId⤳staff_member_id ·
redeemedAt→redeemed_at · note→note. (Old §10.1 mislabeled "empty" — carry all 16.)

### `loyalty.gift_cards` + `loyalty.gift_card_ledger` ← Cash `GiftCard` (15 cols) — 1 row [M6/C5]

All 15 cols enumerated (no silent drop): `id`⤳ · `tenantId`⤳tenant_id · **`code`→code
byte-identical** (redemption token) · `amountCentavos`→`gift_card_ledger` append-only entry +
`gift_cards.amount_cents` (already cents) · `createdByStaffId`⤳staff_member_id ·
`senderName`/`message`/`recipientName`→typed cols · **`recipientPhone`/`recipientEmail`→typed
cols** (GDPR-reachable, G6) · **`isRedeemed`→ DERIVED, not stored** (`redeemed_at IS NOT NULL`;
backfill asserts `isRedeemed == (redeemedAt IS NOT NULL)`) · `redeemedAt`→redeemed_at ·
`redeemedCardId`⤳redeemed_loyalty_card_id · `expiresAt`→expires_at · `createdAt`→created_at.

### `loyalty.otp_verifications` ← Cash `OtpVerification` (8 cols) — 167 source rows [M3/m1]

**All 8 cols:** `id`⤳ stable_uuid (`_migration.otp_map`) · **`tenantId`⤳tenant_id (via
tenant_map; NOT NULL + RLS-scoped)** · `phone`⤳ identity (kind=phone, normalized, scoped by
resolved tenant) · `codeHash`→code_hash · `expiresAt`→expires_at · `attempts`→attempts ·
**`verified`⤳`verified_at` = `createdAt` WHEN verified=true ELSE NULL** (lossy boolean→ts) ·
`createdAt`→created_at.
✅ **M3 resolved (owner, 2026-06-18) — drop the orphan:** 2 rows carry `tenantId='cmo7pk6ap…'`
(absent from the 5-tenant table). `⊘ dropped: 2 orphan-tenant OTP rows (expired ephemeral
codes)`. **165 carried / 167 source.**

### `loyalty.automation_rules` + lifecycle sends ← `BirthdayReward` (0) + `LifecycleEvent` (170)

- `BirthdayReward` (0 rows) → **`loyalty.birthday_rewards`** (dedicated table, owner-confirmed
  2026-06-18): id⤳ · tenantId⤳tenant_id · loyaltyCardId⤳loyalty_card_id (composite FK) · year ·
  issuedAt→issued_at · expiresAt→expires_at · redeemedAt→redeemed_at · status (lowercased:
  active/redeemed/expired) · `UNIQUE(tenant_id, loyalty_card_id, year)`. 0 source rows → runtime
  table (no backfill); RLS-enrolled.
- **`LifecycleEvent` (170) → new `loyalty.lifecycle_sends`** [B1]: cols
  **`(id, tenant_id NOT NULL, card_id, journey, sent_at, body)`**, `tenant_id` derived from
  `LoyaltyCard.tenantId` via `_migration.card_map`, composite FK `(tenant_id, card_id) →
loyalty.cards(tenant_id, id)`, at-most-once guard `UNIQUE(tenant_id, card_id, journey)`.
  The `tenant_id` makes `050`'s loop auto-enable RLS + policy. Carry all 170 + body; the
  lifecycle cron **is** coming (owner-confirmed), so this dedup guard must survive or
  campaigns re-spam.

- Open check (mechanical): `visit_events.staff_member_id` / redemption `staff_member_id` are
  NOT NULL in source — verify every `staffId` resolves, else stage a `system` staff member.

---

## Curation rule for ConversaFlow/KDS domains (replaces the old `production_verified` filter)

The old backfills silently dropped non-`production_verified` rows. **Replaced with: carry
every row into its canonical home; drop nothing silently.** `pipeline_traces` has no class
column, so that filter was a derived guess. The one unambiguous Twilio test row
(`+15005550006` "Trace Test") is **carried** but tagged `metadata.synthetic=true` — present,
not deleted.

**Money scaling [M9]:** CF/KDS `numeric(10,2)/(12,2)` money is in **whole pesos** →
`round(value*100)::int` for `*_cents` targets. Cash `*Centavos` columns are **already
centavos → copied 1:1 (no ×100)**. AI **cost** columns (`cost_usd`, `total_cost_usd`,
`numeric(10,6)`, sub-cent) → **keep numeric / micro-dollars; NEVER `*_cents`** (would round
to 0) [C6]. `*_cents` applies to ops/loyalty money only.

## Domain: `ops` (orders, catalog, channels) ← ConversaFlow + KDS

Common transform: `business_id`→`tenant_id` (tenant_map), `customer_id`→`person_id` (person_map).

| Source (rows)                              | → target                                       | notes                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CF `transactions` (49)                     | `ops.orders`                                   | `total_amount → total_cents = round(total_amount*100)::int` [M9]; `transaction_type`/`status`; `details` jsonb (incl `items[].unit_price → *100`); `service_id` **⊘ dropped: FK→products 0/49 non-null** [C3]; `slack_message_ts`→metadata; `source='whatsapp'`                                                                                                                                                                         |
| CF `transaction_status_events` (52)        | `ops.order_events`                             | `transaction_id`→`order_id`; old/new_status; `acted_by_slack_user`/`acted_in_channel`→metadata                                                                                                                                                                                                                                                                                                                                          |
| CF `products` (136)                        | `ops.products`                                 | `price → price_cents = round(price*100)::int` [M9]; `zettle_uuid`→`external_refs`; **`name_embedding` vector(1024) preserved**                                                                                                                                                                                                                                                                                                          |
| CF `businesses` (1)                        | `ops.businesses`                               | brand/config/open_times (core fan-out)                                                                                                                                                                                                                                                                                                                                                                                                  |
| CF `channels` (0) / `channel_accounts` (0) | `ops.channels` / `ops.channel_accounts`        | 1:1; zero-row                                                                                                                                                                                                                                                                                                                                                                                                                           |
| KDS `tickets` (49)                         | **enrich `ops.orders`** (NOT a separate table) | projection via `source_transaction_id`. **All 24 cols dispositioned [SC-7]:** `customer_name`/`customer_phone` ⊘ drop (denormalized PII; live data is on resolved `person_id`); `source_channel`→`orders.channel`; `customer_note`→`notes`; `total_amount → *100`; cancellation_reason* → order fields; `raw_details_hash`/`last_event_sequence`/`last_projected_at` ⊘ drop (re-derivable projection cache). KDS reads `v_kds_tickets`. |
| KDS `ticket_items` (71)                    | `ops.order_items`                              | join via ticket→order; `unit_price → unit_price_cents = round(*100)` [M9]; `is_cancelled`                                                                                                                                                                                                                                                                                                                                               |
| KDS `ticket_events` (155)                  | `ops.order_events`                             | kitchen lifecycle; `kind`/`status` enums; `payload`                                                                                                                                                                                                                                                                                                                                                                                     |

## Domain: `comms` (conversations & memory) ← ConversaFlow

| Source (rows)                  | → target                                                                         | notes                                                                                                                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CF `conversations` (11)        | `comms.conversations`                                                            | business→tenant, customer→person; `conversation_history`/`state_data`/`draft_cart` jsonb + versions preserved                                                                                                                       |
| CF `messages` (1322)           | `comms.messages`                                                                 | **`embedding` vector(1024) + `embedding_model` preserved**; `twilio_message_sid`; `intent`/`entities`. IDs re-minted via `_migration.message_map` (`stable_uuid('conversaflow:message:'                                             |     | id)`)                                                                                                                                          |
| CF `conversation_turns` (278)  | `comms.conversation_turns`                                                       | full turn reasoning. ✅ **M10 resolved (owner): preserve links live (A).** `source_message_ids (uuid[])` remapped element-wise + `assistant_message_id` remapped via `_migration.message_map` (`stable_uuid('conversaflow:message:' |     | old)`); import `comms.messages` **before** turns; add turn↔message integrity gate (today 297/297 array refs + 276 assistant ids resolve live). |
| CF `tool_calls` (0)            | `comms.tool_calls`                                                               | tenant_id, conversation/turn, tool_name, input/output                                                                                                                                                                               |
| CF `memory_items` (0)          | `comms.memory_items`                                                             | **person_id-keyed** (cross-product memory); embedding_model                                                                                                                                                                         |
| CF `customer_preferences` (9)  | `comms.customer_preferences`                                                     | `customer_id`→`person_id` (tenant via person); all 8 cols; `avg_transaction_value → *_cents` [C4]                                                                                                                                   |
| CF `daily_summaries` (5)       | `comms.daily_summaries`                                                          | AI daily digest; `business_id` **text→uuid cast** →tenant [PN-07]; slack refs                                                                                                                                                       |
| CF `conversation_outcomes` (0) | **`observability.conversation_outcomes`** (service_role-only, NOT comms) [PN-05] | token/cost telemetry — out of `exposed_schemas`                                                                                                                                                                                     |

## Domain: `observability` (traces & audit) ← ConversaFlow **[DDL tables missing — create]**

`tenant_id` nullable by design (unmatched phone → NULL; do NOT force NOT NULL) [PN-07].

| Source (rows)                     | → target (**new in DDL**)         | notes                                                                                        |
| --------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------- |
| CF `ai_turn_logs` (521)           | `observability.ai_runs`           | model, tokens, **`cost_usd` numeric(10,6) KEEP — not cents** [C6], latency, customer_context |
| CF `edge_function_logs` (3022)    | `observability.edge_logs`         | function_name, status, error_stack                                                           |
| CF `security_logs` (818)          | `observability.security_events`   | `phone` (PII, retain), event_type, input_text; tenant_id **nullable**                        |
| CF `business_config_changes` (20) | `observability.audit_log`         | prev/new config jsonb, slack_user_id; `business_id` text→uuid cast                           |
| CF `pipeline_traces` (5279)       | `observability.pipeline_spans`    | trace_id, stage, event, detail; `business_id` **text→uuid cast** [PN-07]                     |
| CF `eval_traces` (17)             | `observability.evaluation_traces` | authoritative vs harness decision, agreement                                                 |

## Domain: `queue` (async infra) ← ConversaFlow

| Source (rows)                | → target                                       | notes                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CF `jobs` (2758)             | `queue.jobs`                                   | `state`→`status`, `next_run_at`→`run_at`, locked_by/at; payload                                                                                             |
| CF `job_attempts` (2763)     | `queue.job_attempts`                           | attempt, outcome, error                                                                                                                                     |
| CF `workflow_jobs` (102)     | `queue.jobs` (unified, `job_class='workflow'`) | extra cols `conversation_id`/`order_id`→columns (column-add)                                                                                                |
| CF `outbox` (392)            | `queue.outbox_events`                          | `kind`→`event_type`, `delivered_at`→`published_at`, idempotency_key                                                                                         |
| CF `inbound_events` (366)    | `queue.inbound_events`                         | `source`→`provider`, `source_event_id`→`provider_event_id`; UNIQUE(provider, provider_event_id)                                                             |
| CF `zettle_oauth_tokens` (0) | **`core.integration_tokens`**                  | OAuth secrets; **after CREATE `REVOKE ALL FROM umi_app, public`; re-assert after 050's grant loop every run** (050 §5 re-grants) [M7]; 0 rows but DDL added |

## Domain: `device` + `kitchen` (KDS hardware) ← KDS (all 0 rows — DDL exists, zero copy)

KDS `stations`→`kitchen.stations`; `device_sessions`→`device.sessions`;
`device_events`→`device.events`; `device_pairing_requests`→`device.pairing_requests`
(`approved_by`→core.users). `business_id`→`tenant_id`. **`station_id` carried as a soft-ref
`uuid` with NO FK** (Connection Law §3.1: FKs only into `core`; cross-product `device→kitchen`
FK forbidden) [PN-06].

## Domain: `grow` (Umi business) ← platform (0 rows) + Tenant fan-out

`platform.leads` (28 cols, 0 rows)→`grow.leads`; `lead_events`→`grow.lead_events`;
**`grow.subscriptions`** ← Cash `Tenant` (`subscriptionStatus`/`trialEndsAt`/`suspendedAt`);
`grow.feature_flags` seeded. **`product_instances` → `core.product_instances` (tenant-scoped,
NOT grow)** [M8]: tenant_id NOT NULL + RLS, `location_id`→core.locations, all 10 cols,
`UNIQUE(tenant_id, product_key)`. (grow is service_role-only/tenant-less — a tenant-scoped
table cannot live there. Control-plane flags ≠ tenant-facing enablement.)

## Misc platform tables (derived/infra)

`platform.external_refs` (0)→`core.external_refs` (soft-ref registry, used by backfills);
`platform.contact_merge_candidates` (0)→`core.contact_merge_candidates` (identity merge queue);
`platform.password_reset_tokens` (0)→`core.password_reset_tokens`. RBAC catalog
(`roles`/`permissions`/`role_permissions`/`membership_roles`, all 0)→**seeded** in DDL.

---

## DDL gaps Phase 3 must close (target tables that don't exist yet)

1. `observability.{ai_runs, edge_logs, security_events, audit_log, pipeline_spans,
conversation_outcomes}` — the logs/telemetry have no home today (§10.1 aspirational).
   `cost_usd`/`total_cost_usd` typed `numeric(10,6)` (NOT cents).
2. `core.sessions` (B2: person_id/user_id + CHECK + tenant_id + explicit 050 RLS),
   `core.integration_tokens` (REVOKE from umi_app), `core.product_instances`;
   `loyalty.lifecycle_sends` (B1: tenant_id + composite FK + RLS),
   `loyalty.points_ledger` + `loyalty.balances` + **append-only triggers on all 3 ledgers**
   (points_ledger, gift_card_ledger, wallet_transactions — integrity G3/check #4).
3. Column additions: `core.people.birth_date`/`metadata`, `core.locations.address`/`lat`/`lng`,
   `queue.jobs.conversation_id`/`order_id` (workflow merge), kitchen fields on
   `ops.orders`/`order_items`, `device.*.station_id` as no-FK soft-ref.
4. `_migration.message_map` (M10) if option A; id-maps for sessions/otp.
5. Canonical rename (D1) physical→`core`/`loyalty`/`ops`/`comms`/`device`/`kitchen` and
   `contact_identities`→`contact_methods` (D3 reshape).

## Owner decisions — ✅ all resolved 2026-06-18

- **M1** — merged kalalacafe owner → **two distinct `core.users`** (both logins keep working).
- **M3** — orphan OTP tenant `cmo7pk6ap…` (2 rows) → **dropped** (165/167 carried).
- **M10** — `conversation_turns` message refs → **preserve live** via `_migration.message_map` (option A).

**→ Mapping is complete and unblocked. Ready for Phase 3 (DDL + backfill authoring).**
