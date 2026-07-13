# Umi — Reality-First Database Audit & Redesign

**Date:** 2026-07-03
**Method:** Codd / Date / Gray. Discover the enterprise that already exists; model observable business facts, not software patterns. Criticism first, redesign second. Every table, schema, and name must justify its existence against an observed fact.
**Consolidates and, where they conflict, supersedes:** the audit (`2026-07-02-platform-database-architecture-audit.md`), elimination review (`…abstraction-elimination-review.md`), Codd model (`…codd-enterprise-model.md`), and pillars doc (`2026-07-03-data-storage-pillars.md`). This pass **corrected four real errors in my own prior proposal** — flagged inline as ⚠️ **SELF-CORRECTION**.

Grounded in a code-verified fan-out over the live canonical DDL (`docs/migration/build/*.sql`) and the sole backend `apps/umi-api`. Live prod = canonical schema; stale legacy schemas out of scope.

> **⛳ Superseded as the current target (2026-07-05)** by [`2026-07-05-platform-domain-model-synthesis.md`](./2026-07-05-platform-domain-model-synthesis.md), which resolves this doc against the conceptual-modeling critique. **Its per-relation spec (§4) is carried forward** as the working relational spec, amended by §8 of the synthesis. Read this doc for the evidence; read the synthesis for the accepted model.

---

## 1. The enterprise (discovered, not assumed)

**Two businesses, one seam.**

- **Umi** sells software to restaurants. Umi's facts: prospects it is selling to, the restaurants that pay it (tenants), what they are billed.
- **The restaurant (tenant)** serves diners. Its facts: customers, conversations, orders, stored-value cards, visits, rewards, staff, menu, locations, hardware.

**Actors:** Umi sales/ops; the restaurant owner + staff (logins); the diner (customer, never logs in). **Products** (ConversaFlow, Cash, KDS, Dashboard, Landing) are *interfaces that consume* these facts — not entities.

**What is implementation / temporary / infrastructure (not business truth):** the transactional outbox, webhook-dedup gate, idempotency claims, dead-letter parking, sessions, PIN pairing, OTP — correctness machinery. Traces/metrics/logs — telemetry. Migration id-maps — throwaway. These must be *quarantined* from business facts, not deleted.

**Observed rules that overturn industry assumptions** (verified in code, do not "fix"):
- **Placing an order does NOT earn loyalty/visits.** The WhatsApp/checkout path has zero loyalty references; the register (Cash) path is disjoint. The `points_ledger.reason='earn'` value has **no writer anywhere in the backend**. Do not link orders to loyalty.
- **Customers do not subscribe or hold memberships.** Only the tenant subscribes (to Umi).
- **`memory_items` is read but never written** — it fails the lifecycle test; the real written store is `customer_preferences`.

---

## 2. Criticism first (ruthless — current DB *and* my own proposal)

Grouped by the methodology's seven categories. Severity H/M/L. "SELF-CORRECTION" = a defect in my *previously proposed* model, caught by the adversarial pass.

### 2.1 Hidden abstractions
- **H — `loyalty.automation_rules` is a 0-row rules engine.** A `trigger_type` discriminator (birthday|win_back|streak|goal_proximity|lifecycle|manual) + opaque jsonb "rule body," 5 of 6 types with no product, **duplicating** `loyalty.programs.birthday_reward_enabled`. EAV-flavored software configurability the business never exercises. *(`11_loyalty.sql:524-549`.)* → **Delete.** The one real fact (birthday reward) already lives on `programs`.
- **H — `loyalty.accounts` is a pass-through join.** One program per tenant, one account per (person, program) ⇒ (person, tenant) already determines it. It carries no fact a `card→customer` pair doesn't; it exists only for the loyalty-industry "account holds many cards" pattern, which is **not observed** (one card per person). *(`11_loyalty.sql:80-141`.)* → **Fold into `card`** (gated on the dual-writer).
- **M — RBAC is a 4-table framework for 4 fixed seeded roles.** `roles`+`permissions`+`role_permissions`+`membership_roles` model tenant-authored roles that don't exist (roles are seeded in DDL, 0 source rows; tenants can't edit them). *(`10_core.sql:200-251`.)* → **Collapse to a `role` enum**; encode role→permission in app code until custom roles are actually sold.

### 2.2 Leaky boundaries
- **H — `ops.orders` fuses three facts + leaks a product concept.** Order truth + full KDS ticket (2nd status machine, station, pickup, **six** cancellation columns) + `slack_message_ts` (a ConversaFlow/Slack concept hardcoded on the neutral order table — the *same* leak flagged for `audit_log.actor_slack_id`, previously un-caught here) + **quadruple** provenance (`source` enum + `channel` text + `channel_id` FK + `source_transaction_id`). Two products write it. *(`12_ops.sql:264-308`.)* → De-load into `order_event`; one `channel_id` + derived source; `slack_message_ts` → outbox metadata.
- **M — Cash writes the identity kernel directly.** `cash-register.repository.ts:97` blind-`UPDATE`s `core.people.display_name/birth_date`; `cash.repository.ts:59` writes `core.tenants.name` (a second writer). A loyalty module mutating shared identity with no precedence/merge/audit. → Route profile writes through the identity service (extend `resolve_contact`).
- **M — `ops.businesses.config` is a two-writer jsonb junk-drawer.** Voice and Hours modules both merge into one `config` column (voice/tone + ordering window + branding + dead `open_times`). → Separate concerns; one owner.

### 2.3 Mixed responsibilities
- **M — `loyalty.lifecycle_sends` is an operational dedup gate wearing marketing vocabulary.** Its own DDL says it's "the at-most-once anti-spam guard for the cron"; `lifecycle.repository.ts:219` uses claim + compensating-delete — functionally identical to `idempotency_keys`. Yet it sits in the loyalty **business** schema and is writable by the tenant request role. *(`11_loyalty.sql:551-577`.)* → Reclassify **pillar-2 operational**; move to the runtime schema; rename `nudge_sent`.
- **M — `observability.audit_log` can only name a Slack actor.** No `core.users` FK ⇒ owner-console config changes are unattributable. Product leak + governance gap. → Becomes a pillar-1 `config_change` **event** with a real `login` actor (deferred).
- **L — `observability.conversation_outcomes` mixes a business outcome with cost telemetry.** "Conversation X ended with outcome 'ordered'" is a pillar-1/analytical fact sitting next to `total_cost_usd` telemetry. → Split: outcome → analytical (derived); cost → OTel.

### 2.4 Unclear predicates
- **L — `ops.products` / `product_categories` have no owning module.** ConversaFlow both reads the menu *and* writes it (Zettle sync + AI `name_embedding`). No catalog owner. → Extract catalog ownership; treat `name_embedding` as a derived search index, not a business column.
- **L — `payment`/`refund`/`product_option`/`hours_override`/`whatsapp_number` have no live writer.** Defined but unwritten (payment state lives in `orders.details`; options/overrides/routing seeded out-of-band). → Verify a real writer before "locking" these.

### 2.5 Unjustified schemas & the schema count
- ⚠️ **SELF-CORRECTION — H — "3 schemas, lock now" is wrong; the honest live count is 4.** Six tenant schemas (`core/ops/comms/loyalty/device/kitchen`) share **one identical** Postgres posture (same RLS loop, same `umi_app` grants) — Postgres gains nothing from the split; collapsing them is right. But only `queue/observability/grow` carry a **real** USAGE seal. And **observability is still 8 actively-written tables** (traces even still land in a legacy `conversaflow` schema, audit D1) — it has **not** left for OTel yet. So the true live target is **4 schemas** (`umi`, `tenant`, `runtime`, `observability`), collapsing to **3** only once telemetry actually migrates. Presenting 3-as-locked conflated target with current state.
- ⚠️ **SELF-CORRECTION — M — the `umi`/`platform` seal is not unique.** `grow`(→umi) and `queue`(→platform) have the *same* `umi_app`-sealed posture. So the permission seal does **not** uniquely justify `umi`; its real justification is **lifecycle/crown-jewel-PII** (durable sales/billing, kept forever) vs churny truncatable machinery. Valid, but a different argument than I made.

### 2.6 Incorrect assumptions in my own proposal
- ⚠️ **SELF-CORRECTION — H — `tenant` cannot live in the sealed `umi` schema (unbuildable).** `tenant` (was `core.tenants`) is the RLS **root** every business row FK-references, and `umi_app` reads/writes it on the request pool (auth, capabilities, cash, hours, voice all `JOIN core.tenants`). Sealing `umi` from `umi_app` would break every one of those. **Fix: `tenant` lives in the reachable `tenant` schema** (Umi-owned but request-readable); `umi.subscription/invoice` reference it *across* the seam via the worker role. Umi's *revenue* stays sealed; the tenant identity root does not.
- ⚠️ **SELF-CORRECTION — H — `conversation_turns` is operational state, not telemetry.** I routed it to OTel. But it carries `hold_until/released_at/superseded_at/base_state_version/status` — a **workflow state machine the turn engine reads back for exactly-once** WhatsApp processing (`13_comms.sql:212-233`). Emitting it fire-and-forget to Tempo would break exactly-once. **Re-tag pillar-2 operational; keep in Postgres.** Only the derived span/latency/token *metrics* are telemetry. (`tool_calls`, 0 rows, is trace → OTel.)
- **M — `core`/identity is a third access class the 3-bucket model didn't describe.** `login` (was `core.users`) is **cross-tenant** (one owner, several restaurants), **secret-bearing** (the only password), and **RLS-exempt** (self-access, not `tenant_isolation`). Folding it into "tenant schema, uniformly RLS-per-tenant" over-claims. → Keep it in the tenant schema but **document `login` as the single explicit exception** (self-access RLS, no `tenant_id`, column-sealed secrets).
- ⚠️ **SELF-CORRECTION — M — `feature_flags → subscription_item` was wrong.** The seeded flags are Umi-**global** ops kill-switches (`lifecycle_cron`, `embed_backfill_cron`) with `tenant_id NULL` — not per-tenant billing. Two (`self_registration`, `wallet_passes`) **duplicate** `loyalty.programs` config. → Kill-switches → operational config; de-dup the two against `programs`; only real paid entitlements (`product_instances`) become `subscription_item`.
- **M — `product_instances.product_key` enum leaks internal/Umi concepts.** Includes `observability` (internal subsystem a tenant can't buy) and `landing` (Umi's own site). *(`10_core.sql:350-352`.)* → Restrict to `cash/conversaflow/kds/dashboard`.

### 2.7 Future technical debt (migration placeholders frozen into live constraints)
- **H — Backfill artifacts baked into CHECKs forever:** `status='missing'` (absence should be row non-existence) on both `product_instances` and `subscriptions`; `reason='migration_initial_balance'/'migration_initial_load'` in the ledgers; `reason='earn'` (**no writer** — an order-earns-points assumption the business doesn't exercise). *(`10_core.sql:353`, `17_grow.sql:213`, `11_loyalty.sql:168`.)* → Drop them.
- **M — Speculative generality:** `device_type` (8 values, only `kds` used); `automation_rules` triggers; `kitchen.station_groups/assignments` (0-row multi-station routing); `channels/channel_accounts` (multi-channel for one channel). → Defer until a second instance ships.
- **M — Duplicate sources of truth (one already drifted):** balance cached 3× (`cards.balance_cents` + `balances` + ledger); money ledgered 2× (`points_ledger` + `wallet_transactions`, **already 101¢ apart**); hours 3×; order items 2×; contact identity 2×; brand name 2×. → One cache, one ledger, one source each (loyalty ones gated on the dual-writer).
- **M/L — Migration scaffold in a durable schema:** `core.external_refs` (has a `'legacy'` product_key) → move to throwaway `_migration`, drop post-cutover.

### 2.8 Confirmed sound — do NOT re-litigate
Roles-as-edges (`people` has no type column). Append-only financial ledgers (`block_append_only_mutation` + `UNIQUE(idempotency_key)`) — **keep the ledger; never collapse to a running-total column**. Structural tenant isolation (composite `(tenant_id, id)` FKs make cross-tenant refs physically impossible). The service-role USAGE seal on `grow/queue/observability` (gate fails closed) — **real, load-bearing; the "move to public" instruction is correctly rejected**. Secret-column REVOKE surgery. Soft cross-domain refs (Connection Law). KDS-as-a-view over `ops`. The transactional-outbox multi-writer pattern. `resolve_contact` as the shared identity service (only the *subsequent* profile UPDATE leaks). Orders-don't-earn-loyalty (verified). `memory_items` is dead (verified).

---

## 3. Redesign — the four pillars and three (→ later) schemas

**Pillars:** (1) **Enterprise Truth** — the business; (2) **Operational Truth** — what the runtime reads back to stay correct; (3) **Observability** — telemetry → OTel (Tempo/Prometheus/Loki), leaves Postgres; (4) **Analytical Truth** — reporting/BI, fed by CDC off the outbox, future.

**Schema layout (corrected).** Live target **4 schemas now → 3 after OTel migration**, plus a throwaway `_migration`:

| Schema | Pillar | Owner / access | Justification |
|---|---|---|---|
| **`umi`** | 1 (Enterprise) | Umi; **service-role sealed** (`REVOKE USAGE FROM umi_app`) | Crown-jewel durable sales/billing PII kept forever; the tenant request role must never read Umi's revenue. (Seal shared with `runtime` — the *distinguishing* reason is lifecycle/sensitivity, not the seal alone.) |
| **`tenant`** *(was proposed `business`)* | 1 (Enterprise) | the restaurant; RLS per tenant, **one exception: `login`** | The one boundary Postgres rewards vs `umi`: a single USAGE wall between the two businesses. Collapses the 6 identical tenant schemas into one. |
| **`runtime`** *(was proposed `platform`; or keep `queue`)* | 2 (Operational) | Umi platform; worker/service-role sealed | Churny, truncatable correctness machinery with a different lifecycle from the durable record; co-mingling is the mistake the old 9-schema layout made. |
| **`observability`** | 3 (until OTel) | service-role sealed | Still 8 live tables; **leaves Postgres for OTel**, at which point the layout becomes 3. |
| *(`_migration`)* | — | throwaway | `external_refs` and id-maps; dropped post-cutover. |

**Naming rationale (critics' fixes applied):** `business` was abstract/asymmetric (**both** enterprises are businesses; collides with `ops.businesses`) → **`tenant`** (owner-named, vertical-neutral; `restaurant` is the pure-reality-first alternative). `platform` overloaded "the Umi platform" → **`runtime`** (or keep the honest incumbent `queue`). `points_ledger` (holds cents, not points) → **`card_ledger`** (parallels the kept `gift_card_ledger`). `membership` → **`tenant_access`** (owner-locked; `tenant_role` is a considered synonym).

⚠️ **The `ops.businesses` table itself is deleted:** it's a mis-named 1:1 satellite of the tenant (`UNIQUE(tenant_id)`) whose predicate *is* the tenant's — its brand/config columns fold **up into `tenant.tenant`**. This also removes the `business`-schema name collision at the root.

---

## 4. Redesign spec — every relation

Owner is stated per schema. Each row: **predicate** · **writer → reader** · **pillar/retention** · **why it exists / consolidation**. `⛔` = **gated on the umi-cash dual-writer decommission**. `∅writer` = defined but no live backend writer (verify before locking).

### 4a. Schema `umi` — Umi's own business (sealed from the tenant request role)

| Relation | One row asserts | Writer → Reader | Retention | Why / consolidation |
|---|---|---|---|---|
| `subscription` | Organization T subscribes to plan P, billing status S, trial ends D. | onboarding/billing *(∅ runtime writer today — `grow.subscriptions` is orphaned; live "subscriptionStatus" wrongly derives from `product_instances`)* → billing views | forever | Was `grow.subscriptions`. **Locking `umi` must wire billing to read here**, not from entitlements. Billing status ≠ `tenant.status` (lifecycle). |
| `subscription_item` | Tenant T's subscription includes product K, status S. | Umi ops (seeded) → **hot** product gate (`auth.repository.ts:167`, worker pool) + dashboard capabilities | forever | Was `core.product_instances`; **retires `feature_flags`-as-entitlement**. Restrict `product_key` to `cash/conversaflow/kds/dashboard`. Sealing forces `tenants.repository.ts:73 loadProducts` onto the worker pool. |
| `invoice` **(new)** | Umi charged tenant T amount A for [start,end], status S. | billing *(not built)* → revenue/dunning | forever / append-only | The genuinely-missing Umi money fact. **Decide in-house issuance vs external-processor mirror before building.** Only money column in `umi`. |
| `prospect` | Person/company X is a sales prospect of Umi at stage S. | `leads.repository.ts` (worker pool) → sales drip | funnel + erasure | Was `grow.leads`. No `tenant_id`, no core FK — pre-tenant by nature. |
| `prospect_event` | Prospect P had funnel event E at time T. | `leads.repository.ts:210` → funnel timeline | append-only | Was `grow.lead_events`. `lead_id → prospect_id`. |

**Seam:** `tenant` (the root) lives in the **`tenant`** schema, *not* here (§2.6 fix). `umi.subscription/invoice` reference `tenant.tenant` across the seam via the worker role; `umi_app` keeps **zero** USAGE on `umi` — clean seal, fails safe.

### 4b. Schema `tenant` — the restaurant's business (RLS per tenant; `login` is the one exception)

| Relation | One row asserts | Writer → Reader | Retention | Why / consolidation |
|---|---|---|---|---|
| `tenant` | Restaurant «name/slug» is an Umi tenant, status «active/disabled/archived». | onboarding (∅ runtime INSERT) + name/timezone edits → **everything** | forever | Was `core.tenants`. **Absorbs `ops.businesses`** brand/config columns (that table is a 1:1 satellite — deleted). RLS root; Umi-owned but request-readable. |
| `customer` | «name» (born D?) is a customer known to tenant T. | `resolve_contact` + cash ⛔ → Customer-360, turns, POS | forever (GDPR-anonymize) | Was `core.people`. Staff/logins already separate ⇒ the only inhabitants are customers. |
| `customer_contact` | Customer C is reachable at «value» of kind «phone/whatsapp/email». | `resolve_contact` → identity dedup, 360 | forever | Was `contact_methods`. `UNIQUE(tenant,kind,normalized_value)` dedup spine. |
| `customer_note` | Tenant T knows fact N about customer C. | AI extraction (`memory.repository`) → 360, turns | forever | **Atomic facts only** — was `customer_preferences.facts`. Drops dead `memory_items`. **⚠️ Keep the *derived* profile (spend totals/averages/favorites) separate** — it's a computed rollup (pillar-4 view), not a note. |
| `conversation` | Thread X between T and C, open/closed, holds live AI/cart state. | turn engine (CAS) → turns, 360 | forever | Was `comms.conversations`. |
| `message` | Message M said in X by «customer/assistant/staff» at T. | ingress/outbound → turns (HNSW), 360 | forever (content GDPR-nullable) | Was `comms.messages`. AI-execution detail is **not** here (see runtime/OTel). |
| `product` | Tenant T sells «name» for «cents» in category C, available? | catalog sync (`products.repository`) → turns, KDS, dashboard | forever | Was `ops.products`. **Needs an owning catalog module** (§2.4). `name_embedding` = derived search index. |
| `product_option` | Product P offers option «name» at ±cents, choose min..max. | ∅writer (seeded) → turns | forever | Collapses `product_modifier_groups`+`modifiers`. |
| `order` | Customer C placed order O at T via «whatsapp/pos», total, status. | checkout + KDS → KDS board, 360, dashboard | forever | Was `ops.orders`, **de-overloaded**: kitchen/cancellation → `order_event`; one `channel_id`; `slack_message_ts` → outbox. Does **not** earn loyalty. |
| `order_item` | Order O includes «qty × product» at unit price. | checkout + KDS → board, 360 | forever | Was `ops.order_items`. Absorbs the duplicate `orders.details.items[]`. |
| `order_event` | Order O reached state S (incl. cancelled+reason) at T. | KDS → KDS board reconstruction | append-only | Was `ops.order_events`. Absorbs `kitchen_status` + the six cancellation columns. Lets the KDS board be a view. |
| `payment` / `refund` | Payment/refund of «cents» against order O, status S. | ∅writer *(state in `order.details` today)* | forever | Was `ops.payments/refunds`. **Verify a live writer before locking**; don't invent settlement columns. |
| `card` | Customer C holds card «number» at T, balance «cents», «n» visits. | cash ⛔ → balance guard, 360 | forever | Was `loyalty.cards`. **Folds `accounts` in** (⛔); **drops `balances`** (⛔). One cached balance = `SUM(card_ledger)`. |
| `card_ledger` | A ±cents movement on card K for reason R at T, by staff S. | cash ⛔ → balance = SUM(δ), 360 | append-only | Was `loyalty.points_ledger` (**not "points"** — cents of stored value). **Removes `wallet_transactions`** (dup, 101¢ drift) ⛔. Add `refund` to the CHECK. |
| `visit` | Customer C (card K) visited T on date D, by staff S. | cash ⛔ → reward eligibility, 360 | append-only | Was `loyalty.visit_events`. Disjoint from orders. |
| `reward_rule` | Tenant T offers reward «name» for «n visits»/«cost», active? | cash ⛔ → eligibility | forever | Was `loyalty.reward_configs`. `programs` config folds into tenant-level loyalty settings. |
| `reward_redemption` | Customer C redeemed reward W on D (standard/birthday), by staff S. | cash ⛔ → redemption history | append-only | Was `loyalty.reward_redemptions`. **Absorbs `birthday_rewards`** (redemption with reason=birthday). |
| `gift_card` | Gift card «code» worth «cents» (remaining B) at T, sender→recipient. | cash ⛔ → redeem/lookup, 360 | forever | Was `loyalty.gift_cards`. `isRedeemed` derived. |
| `gift_card_ledger` | A ±cents load/redeem/adjust/expire on gift card G at T. | cash ⛔ → balance = SUM(δ) | append-only | Kept name. |
| `wallet_pass` | Customer C's card K has an Apple/Google pass «serial». | **umi-cash only** (∅ umi-api) → PassKit | forever | Was `loyalty.passes`. **Strongest form of the gate — not yet ported to umi-api.** `pass_devices` = delivery plumbing (runtime). |
| `staff` | «name» is staff of T at location L, active, optionally a login. | `staff` module → cash actor stamp, KDS | forever | Was `core.staff_members`. |
| `login` **(RLS EXCEPTION)** | «email» is a login able to sign in; secret is scrypt hash. | `auth` (∅ INSERT; set out-of-band) → auth, staff link | forever | Was `core.users`. **Cross-tenant, no `tenant_id`, self-access RLS, column-sealed password** — the one relation *not* under `tenant_isolation`. |
| `tenant_access` | Login U may access tenant T as «owner/admin/staff/viewer». | ∅writer (seeded) → auth role resolution | forever | Collapses **five** RBAC tables → this + a `role` enum. Tenant-scoped ⇒ under RLS; the bridge that makes `login` usable per-tenant. |
| `location` | Tenant T operates location «name» at «address». | `tenants` (∅ INSERT) → hours, staff, KDS, orders | forever | Was `core.locations`. |
| `open_hours` | Location L is open on «weekday» «t1»–«t2» (or closed). | `hours` (replace-all) → ordering gate | forever | Was `ops.business_hours` (canonical). **Removes dead `businesses.open_times`.** |
| `hours_override` | Location L has dated override over [start,end]. | ∅writer → hours resolution | until expiry | Was `ops.service_windows`. Verify writer. |
| `device` | Device «name» (a paired iPad) is registered to T at location L. | `kds` → device auth/board scope | forever | Was `device.devices`. Drop 8-value `device_type` generality. Session/PIN secrets → runtime. |
| `station` | Tenant T has kitchen station «name» at L; products route to it. | `kds` → routing/board grouping | forever | Was `kitchen.stations`. `station_groups/assignments` (0-row) fold in as columns. |
| `whatsapp_number` | Tenant T receives messages at number N (provider account A). | ∅writer (seeded) → inbound routing | forever | Collapses `ops.channels`+`channel_accounts`. |

### 4c. Schema `runtime` — Operational Truth (worker/service-role sealed)

| Relation | One row asserts | Writer → Reader | Retention | Why it cannot leave Postgres |
|---|---|---|---|---|
| `outbox_events` | A committed state change of type E for aggregate A is owed exactly-once delivery. | domain services in-txn (`turn-commit:50`, `kds:957`) → relay `claimPendingOutbox` | truncatable (post-deliver) | **Same-txn atomicity** with the business write — a crash between commit and enqueue would drop a customer reply. Also the CDC tap for pillar 4. |
| `inbound_events` | Provider P delivered event E at most once; status S. | ingress `ON CONFLICT DO NOTHING` → dup-check | TTL | `UNIQUE(provider,event_id)` is a transactional dedup gate; a Redis TTL cache would double-process webhooks across restarts. |
| `idempotency_keys` | Operation scope/key was claimed; cached result R. | workers `ON CONFLICT` → claim gate | TTL | Durable exactly-once claim that must survive Redis eviction. |
| `dead_letters` | Work at source S failed terminally after N attempts; parked. | `dead-letter.service:31` → operators | until resolved | No-silent-loss guarantee. **Gap: `tenant_id NOT NULL` ⇒ tenant-less failures are only logged** — coverage hole. |
| `sessions` | Principal «person/user/device» holds a valid session until D. | cash + KDS → **read per request** (device on every poll) | TTL | Auth decision on live data; a stale read trusts a revoked device. **Merge caveats:** hash `core.sessions.token` (stored cleartext today), add `principal_type`; sealing strips `umi_app` self-access ⇒ validate via worker pool. |
| `nudge_sent` | Tenant T sent lifecycle nudge J to card K (once). | `lifecycle.repository:219` claim/compensate → cron | TTL | Was `loyalty.lifecycle_sends` — **reclassified from business** (§2.3); it's an anti-spam dedup gate, not a loyalty fact. |
| `pairing` / `otp` | A PIN pairing handshake / OTP verification (transient). | KDS / cash → auth | short TTL | Was `device.pairing_requests` / `loyalty.otp_verifications`. Transient auth mechanics; secrets column-sealed. |

⚠️ **Dropped from the operational schema: `jobs` and `job_attempts`.** Verified: **zero live writers** — BullMQ/Redis owns execution state (`queue.repository.ts §10.5`: "BullMQ owns execution state; queue.jobs/job_attempts are superseded"). The migrated rows are dead CF artifacts. Reality-first: do **not** carry them as durable-job tables the runtime doesn't use. Re-adopt only if Postgres consciously becomes the job-of-record (it isn't).

### 4d. Leaves Postgres → Observability (OTel), and the one deferral

**To OTel (Tempo/Prometheus/Loki), deleted from the DB:** `ai_runs`, `edge_logs`, `security_events`, `pipeline_spans`, `evaluation_traces`, `data_quality_findings`, `tool_calls`, and the *derived* span/latency/token metrics of turns. ⚠️ **NOT `conversation_turns`** — it's operational state (§2.6), stays in Postgres with the turn engine.

**Deferred (a real business fact, later becomes a pillar-1 event):** `observability.audit_log` → `config_change` ("actor A changed setting X"), **with a real `login` actor** (fixing the Slack-only defect). And `conversation_outcomes` → analytical (conversion), split from its cost telemetry.

---

## 5. Success criteria — checklist

- ✅ Every persisted fact has a purpose and a single-sentence predicate (§4).
- ✅ Every schema has an operational justification: `umi`/`runtime`/`observability` = USAGE seals; `tenant` = per-tenant RLS. The 6 identical tenant schemas correctly collapse.
- ✅ Business truth (`umi`, `tenant`) isolated from operational machinery (`runtime`) — with **corrections**: `conversation_turns` and `lifecycle_sends` re-sorted to their true pillars.
- ✅ Operational isolated from observability: telemetry leaves for OTel; only correctness state stays.
- ✅ Future analytics needs no OLTP redesign: fed by CDC off `outbox_events`.
- ✅ Nothing exists because it sounds sophisticated: `automation_rules`, `accounts`, the RBAC framework, dead `jobs/job_attempts`, `memory_items`, `ops.businesses`, migration-placeholder enum values — all removed.
- ✅ An engineer sees three (→four-until-OTel) folders — *Umi's business, the restaurant's business, the plumbing* — no glossary.

---

## 6. Self-critique & open decisions

- **This pass corrected my own prior model four times** (tenant placement, `conversation_turns`, schema count 3→4, `feature_flags`→billing). That the earlier docs shipped those errors is the argument *for* the adversarial pass — and the reason to treat this doc, not the pillars doc, as current where they conflict. I should propagate the `conversation_turns` and tenant-placement fixes back into the pillars/Codd docs (offered, not yet done).
- **Verification limit:** grounded in the build DDL + `apps/umi-api`, not a live `pg_catalog` read. The four ⟨verify-live⟩ items from the audit still stand (normalized_phone population, prod worker role, `exposed_schemas`, `OBSERVABILITY_SCHEMA='conversaflow'`).
- **Decisions the business must make (not inventable):** (1) in-house billing vs external processor → shapes `invoice`. (2) Is `subscription_item` (product enablement) billing or ops config? Observed: dashboard reads it as entitlement → billing. (3) `tenant` schema name — `tenant` (neutral) vs `restaurant` (pure reality-first). (4) `runtime` vs keeping incumbent `queue`. (5) The umi-cash dual-writer decommission date — **gates every loyalty consolidation** (`card`/`card_ledger`/`gift_card`/`visit`/`reward_*`/`wallet_pass`).
- **What I did not do:** invent settlement/payout, order→loyalty links, cross-tenant customer identity, or custom-role RBAC — none is observed. The model grows by *adding* the one missing fact (`invoice`) and *removing* software, which is the sign the enterprise, not the framework, drove it.
