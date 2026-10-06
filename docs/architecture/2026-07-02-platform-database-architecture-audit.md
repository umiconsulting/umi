# Umi Platform — Database Architecture Audit

**Date:** 2026-07-02
**Auditor role:** Principal Database Architect / Enterprise Data Modeler / PostgreSQL + Systems Architect
**Method:** Discovery-first. Five independent read-only lenses (business, schema, runtime, tenancy/identity/RLS, adversarial critique) run against the **live canonical database only**. Stale pre-migration snapshots (`supabase-prod-schema.sql`, the legacy `conversaflow`/`kds`/`platform`/`umi_cash`/`public` schemas) were treated as out of scope and not considered.
**Ground truth read:** `docs/migration/build/10_core.sql … 17_grow.sql` (the canonical DDL), `docs/architecture/platform-database-architecture.md` (design intent), `docs/migration/build/90_rls.sql` + `00_foundation.sql` (RLS + helpers), and the sole backend `apps/umi-api/src/**` (the binding contract). Every claim below cites an observed fact.

**Scope caveat (honest limit):** this is a read of the build DDL — the design-time source that was deployed on 2026-06-20 — and the running `apps/umi-api` code, **not** a live `pg_catalog` introspection of Supabase project `xbudknbimkgjjgohnjgp`. Findings that require live confirmation are marked **⟨verify-live⟩**. See §14.

---

## 1. Executive Summary

**Verdict: the database models Umi as a platform correctly.** The schema is domain-named (not product-named), tenancy is a coherent 3-tier model with structural (not just policy-level) isolation, human roles are edges rather than columns, and — the single most important business question — **Umi's own sales/billing world (`grow`) and each tenant's Customer Data Platform (`core.people` + `comms` + `loyalty`) are disjoint at the schema, tenancy, and connection-role layers.** The three distinct "customer" perspectives (Umi's prospect, Umi's paying tenant, the tenant's end-consumer) never share a table or a foreign key. This is a genuinely well-architected system; the design principles in `platform-database-architecture.md` are real, enforced, and self-verifying (the migration fails closed if RLS, FORCE, or grant seals regress — `90_rls.sql:352-467`).

**No redesign is warranted.** The residual issues are localized and fall into two buckets:

1. **Duplicated derived state inside `loyalty` and `ops`** — the same fact is materialized in two or three places (card balance in `cards.balance_cents` _and_ `balances.balance`; money movements in `points_ledger` _and_ `wallet_transactions`; hours in `business_hours` _and_ `businesses.open_times`; order items in `order_items` _and_ `orders.details`; branding on `ops.businesses` _and_ `loyalty.programs`). None is a structural defect; each is a cleanup that reduces a drift surface. One (`wallet_transactions` vs `points_ledger`) has **already drifted by 101 centavos** on live data (`11_loyalty.sql:703-706`).

2. **Deployment-fidelity gaps** where the running system does not yet fully realize the canonical design — the prod worker pool runs as the broad Supabase `postgres` role instead of a narrow `umi_worker`; observability writes are still config-bound to a legacy `conversaflow` schema name; there is no application-level tenant-provisioning path (tenants are seeded out-of-band); and a `core.people.normalized_phone` population gap may be a latent runtime bug for brand-new WhatsApp-only customers.

**The platform's stated evolution goal — "grow by adding business data, not by redesigning schema" — is already achievable.** Onboarding tenant #2 is zero-DDL. The recommended work in this audit is subtractive (remove redundant caches) and additive (a real tenant-billing money model; a neutral config-change audit actor), never a rewrite.

**Highest-value next actions:** (a) verify the four **⟨verify-live⟩** items against the running DB; (b) collapse the double balance cache; (c) generalize `observability.audit_log`'s actor so owner-console (`core.users`) config changes are auditable, not just ConversaFlow/Slack ones; (d) decide whether `grow.subscriptions` becomes a real billing ledger or defers to an external biller. None blocks current operation.

---

## 2. Business Domains

Umi is an AI-first, multi-tenant platform for local businesses (restaurants today; gyms/salons/retail are the stated future). **Products are disposable interfaces; the nine domain schemas are the permanent assets.** Domains partition into three ownership tiers.

| #   | Domain (schema)   | The business fact it owns                                                                                                                                                                     | Ownership tier                     |
| --- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | **core**          | Who is this human, and what tenant do they belong to? Identity, tenancy, RBAC, sessions, entitlements. The shared kernel every product depends on and that depends on nothing above it.       | Tenant-scoped (kernel)             |
| 2   | **ops**           | What does the business sell, what did it sell, who paid? Catalog, orders, order lifecycle, payments, hours, channels.                                                                         | Tenant-scoped                      |
| 3   | **comms**         | What was said, what does the AI remember, what does it know? Conversations, messages, turns, durable memory, RAG knowledge. The **knowledge half** of the tenant CDP.                         | Tenant-scoped                      |
| 4   | **loyalty**       | How many points/how much stored value, what rewards, what passes, when did they visit? Append-only value ledgers, cards, gift cards, wallet passes. The **financial half** of the tenant CDP. | Tenant-scoped                      |
| 5   | **device**        | What hardware is connected, is it online, what may it do? Product-agnostic pairing/session/registry (KDS is just one device type).                                                            | Tenant-scoped                      |
| 6   | **kitchen**       | Where are the stations, how do products route? Layout/config only — tickets live in `ops`.                                                                                                    | Tenant-scoped                      |
| 7   | **queue**         | What work is pending, what events must publish, what webhooks arrived? Jobs, transactional outbox, idempotency, dead letters.                                                                 | Platform-infra (service-role only) |
| 8   | **observability** | What did the AI do, what happened in prod, who changed what? Traces, spans, audit, security events, data-quality.                                                                             | Platform-infra (service-role only) |
| 9   | **grow**          | Who is in _Umi's_ sales pipeline, and what are tenants billed? Leads, funnel events, subscriptions, control-plane flags. **Umi-the-company's data.**                                          | Umi-internal (service-role only)   |

**The three customer perspectives (never conflate):**

- **Umi's prospect** → `grow.leads` (tenant-less; not a tenant yet).
- **Umi's paying customer = the tenant** → `core.tenants`, billed via `grow.subscriptions`, whose humans log in through `core.users`.
- **The tenant's own customer = the end-consumer/diner** → `core.people` + `core.contact_methods` + the `comms`/`loyalty` CDP.

These are three entities in three ownership tiers. The audit confirms they are structurally isolated (§4, §7).

---

## 3. Platform Capabilities (product vs domain vs capability vs subsystem)

The prompt's core discipline: do not confuse a _product_, a _business domain_, a _platform capability_, and a _technical subsystem_.

| Thing                                                                                      | Classification          | Why                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ConversaFlow, Cash, KDS, Dashboard, Landing                                                | **Product**             | An interface users touch, over one or more domains. Disposable; the domain outlives it. (`platform-database-architecture.md:14`, product→schema matrix `:310-322`.)                                                        |
| core, ops, comms, loyalty, device, kitchen, grow                                           | **Business domain**     | A permanent fact family named for what the data _is_.                                                                                                                                                                      |
| queue, observability                                                                       | **Technical subsystem** | Plumbing/exhaust, not a business fact. Criticality-defined: truncate `queue` → system stops; truncate `observability` → system runs, you lose sight. (`:290-293`.)                                                         |
| Unified auth (JWT httpOnly cookies + scrypt + AuthGuard/EntitlementGuard/@Roles)           | **Platform capability** | Cross-cutting authentication over `core`; not a domain, not a product. (`apps/umi-api/src/modules/auth/`, `shared/auth/`.)                                                                                                 |
| RLS tenant isolation (`tenant_isolation` policy + non-BYPASSRLS `umi_app`)                 | **Platform capability** | DB-enforced safety spanning every tenant-scoped domain. (`90_rls.sql`.)                                                                                                                                                    |
| Transactional outbox + BullMQ engine                                                       | **Technical subsystem** | The single sanctioned cross-product side-effect channel. (`apps/umi-api/src/jobs/outbox-relay.service.ts`.)                                                                                                                |
| **Customer Data Platform (CDP)**                                                           | **Platform capability** | The tenant's unified, product-agnostic knowledge of its consumer, aggregated across `core+comms+loyalty+ops` by the Customer-360 read model (`apps/umi-api/src/modules/customers/`). **Not** a product, **not** Umi's CRM. |
| Entitlements (`core.product_instances`)                                                    | **Platform capability** | The per-tenant product-access control plane that gates every Dashboard module (`module-registry.js:94-95`).                                                                                                                |
| Identity resolution (`core.resolve_contact`/`normalize_phone`, `contact_merge_candidates`) | **Platform capability** | Unifies a person from phone/WhatsApp/email within a tenant.                                                                                                                                                                |
| Integration tokens (`core.integration_tokens`)                                             | **Platform capability** | The home for previously-homeless per-tenant OAuth/Zettle secrets.                                                                                                                                                          |

**Crucial distinction the prompt demanded — Internal CRM vs CDP:** Umi's internal CRM (`grow.leads/lead_events/subscriptions`) manages _Umi's_ sales pipeline and tenant billing. The CDP (`core.people` + `comms` + `loyalty`) is _tenant-owned_ customer knowledge, product-agnostic, fed by ConversaFlow/Cash/future producers. **They are correctly two separate worlds** and must never merge (§4).

---

## 4. Bounded Contexts & Context Map

Ten contexts, derived from the runtime code (`apps/umi-api/src/modules/**`), not from assumptions.

| Context                                        | Owns (writes)                                                                                         | Depends on                                    | Notes                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Identity, Tenancy & Access** (shared kernel) | `core.users/tenants/memberships/roles/permissions/sessions/staff_members/locations/product_instances` | — (bottom of the graph)                       | Provides `rls_tenant_check`/`can_access_tenant` + `PgService.withTenant/workerTx` to everyone. |
| **Customer Identity / CDP spine**              | `core.people/contact_methods/contact_merge_candidates`                                                | Kernel                                        | One person per (tenant, normalized key) via `core.resolve_contact`.                            |
| **ConversaFlow / Conversations**               | `comms.conversations/messages/conversation_turns/customer_preferences`                                | CDP spine, ops, queue, kernel                 | Turn engine + CDP enrichment (embeddings, summaries, extracted facts).                         |
| **Orders / Commerce & Business Config**        | `ops.orders/order_items/order_events/products/categories/businesses/business_hours/channels`          | CDP spine, kernel                             | Operational truth; multi-writer (see leaks).                                                   |
| **Kitchen Display (KDS)**                      | `device.*`, `kitchen.stations`, **and** `ops.orders/order_items/order_events` (kitchen_status)        | ops, CDP spine, queue, kernel                 | No `kds.*` schema by design — KDS is a projection over `ops` + `device/kitchen`.               |
| **Loyalty / Cash**                             | `loyalty.*` (17 tables)                                                                               | CDP spine, kernel, queue                      | Staff-driven POS; **decoupled from the WhatsApp order path**.                                  |
| **Messaging Outbox & Queue** (infra kernel)    | `queue.outbox_events/inbound_events/idempotency_keys/dead_letters`                                    | Kernel                                        | The single cross-product side-effect channel.                                                  |
| **Growth / Umi Sales CRM**                     | `grow.leads/lead_events/subscriptions`                                                                | Kernel                                        | **Deliberately isolated** — worker pool only, no `core.people`, no shared identity.            |
| **Observability**                              | `observability.*` via shared TraceService                                                             | Kernel                                        | Write-mostly sink; Customer-360 reads only `data_quality_findings`.                            |
| **Customer 360** (query-side aggregator)       | — (read-only)                                                                                         | CDP spine, comms, ops, loyalty, observability | Joins five domains on `core.people`; a consumer, not an owner.                                 |

**Connection Law is respected:** FKs point **down into `core` only**; cross-product links are **soft** (bare uuid, no FK) — `points_ledger.source_id`, `comms.conversations.order_id`, `queue.jobs.order_id`, all of `observability.*`. The one sanctioned cross-product write channel is `queue.outbox_events`.

**Leaking abstractions observed (cross-domain writes).** Most are _by design_; two are worth tightening:

| Cross-domain write                                             | Evidence                                                                | Verdict                                                                                                                          |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| ConversaFlow writes `ops.orders/order_items` on checkout       | `conversations/tools/checkout.tools.ts` → `orders.repository.ts:82-135` | **By design** — order is operational truth; comms shouldn't own it.                                                              |
| KDS mutates `ops.orders/order_items/order_events`              | `kds.repository.ts:898-947`                                             | **By design** — no `kds.*` schema; but it is a genuine write into another aggregate.                                             |
| Multiple contexts INSERT `queue.outbox_events`                 | `turn-commit.repository.ts:50`, `kds.repository.ts:957`                 | **By design** — the outbox pattern.                                                                                              |
| **Cash writes `core.people`** (`display_name/birth_date`)      | `cash-register.repository.ts:97`                                        | **Tighten** — a `loyalty` module overwriting the shared identity profile directly rather than through an owned identity service. |
| **Cash writes `core.tenants.name`**                            | `cash.repository.ts:59` (also written by `tenants.repository.ts:199`)   | **Tighten** — `core.tenants.name` now has two writers in two contexts.                                                           |
| **Voice _and_ Hours both write `ops.businesses.config` jsonb** | `voice-settings.repository.ts`, `ordering-settings.repository.ts`       | **Tighten** — two modules sharing one jsonb column invites lost updates.                                                         |

---

## 5. Domain Glossary

For each concept: **what / owner / why / created / destroyed.**

- **Tenant** (`core.tenants`) — a business that pays Umi; the RLS isolation root. Owner: Umi (provisioned). Created: onboarding (out-of-band SQL today, §8-D4). Destroyed: never hard-deleted; `status` → `archived`.
- **Location** (`core.locations`) — a physical site of a tenant. Owner: tenant. Created: onboarding. Destroyed: cascade with tenant.
- **Person** (`core.people`) — one human as known to **one** tenant (diner, staff, or owner-who-dines — all one row; roles are edges). Owner: tenant (the CDP atom). Created: `core.resolve_contact` on first contact. Destroyed: GDPR anonymize (never deleted while ledgers reference it).
- **Contact method** (`core.contact_methods`) — a normalized reachability edge (phone/whatsapp/email). Owner: tenant. Created/destroyed: with resolution / GDPR.
- **User** (`core.users`) — a login principal (tenant-less; may span tenants; may optionally link to a `person`). Owner: platform. Holds the only password hash. Created: staff invite/seed. Destroyed: `status` → disabled.
- **Membership** (`core.tenant_memberships` + `membership_roles`) — which user belongs to which tenant with what role (the role _edge_). Created: invite. Destroyed: revoke.
- **Lead** (`grow.leads`) — a prospective restaurant, **tenant-less**, in Umi's funnel. Owner: Umi. Created: landing form. Destroyed: lifecycle exit (partial-unique on active email frees the slot).
- **Subscription** (`grow.subscriptions`) — a tenant's billing record (plan/status/trial). Owner: Umi. One per tenant. Created: tenant onboarding. Destroyed: cascade with tenant.
- **Account** (`loyalty.accounts`) — a person's membership in one loyalty program (`UNIQUE(tenant,person,program)`). Owner: tenant. Created: registration.
- **Card** (`loyalty.cards`) — a person's physical/digital loyalty+wallet card; carries the derived `balance_cents`. Owner: tenant.
- **Value movement** (`loyalty.points_ledger`) — one immutable signed centavo movement on a card (append-only; balance = `SUM(delta)`). Note the name is a misnomer — it holds **cents of stored value**, not points. Created: top-up/purchase/gift/adjust. Never destroyed (financial audit trail).
- **Order** (`ops.orders`) — a canonical customer order via any channel; also co-locates the KDS kitchen-ticket state. Owner: tenant. Created: checkout/POS.
- **Order event** (`ops.order_events`) — one immutable lifecycle transition (append-only, per-tenant kitchen_sequence).
- **Conversation / Message** (`comms.*`) — a customer AI thread and its utterances. Owner: tenant.
- **Memory item / Customer preference** (`comms.memory_items`, `customer_preferences`) — durable AI-remembered facts and the aggregated per-person profile (usuals, avg spend, allergies). The knowledge half of the CDP.
- **Device / Session / Pairing** (`device.*`) — connected hardware, its authenticated session (heartbeat), and the PIN handshake. Product-agnostic.
- **Station** (`kitchen.stations`) — a named kitchen station + routing; layout only.
- **Outbox event** (`queue.outbox_events`) — a transactional side-effect written in the same txn as the state change; the cross-product connective tissue.
- **Product instance** (`core.product_instances`) — a product enabled for a tenant (the entitlement control plane). Distinct from **feature flag** (`grow.feature_flags`, Umi control-plane toggles).

---

## 6. Current Database Assessment

**Shape:** 82 base tables across 9 schemas (`core` 17, `loyalty` 17, `ops` 14, `comms` 9, `observability` 8, `queue` 6, `device` 4, `kitchen` 3, `grow` 4) + 1 view (`ops.v_kds_tickets`).

**What is done right (do not "fix" these):**

- **Roles-as-edges** genuinely honored — `core.people` has no role/type/password column (`10_core.sql:87-99`); the app reads roles only by joining `membership → membership_roles → roles` (`auth.repository.ts:97,124`).
- **Append-only financial ledgers** (`points_ledger`, `gift_card_ledger`, `wallet_transactions`) enforced by `block_append_only_mutation` triggers + `UNIQUE(idempotency_key)` — sound financial integrity.
- **Structural tenant isolation** — every tenant-scoped table declares `UNIQUE(tenant_id, id)` and children carry composite `FK(tenant_id, ref_id) → parent(tenant_id, id)`, making cross-tenant references _physically impossible_ even with an app bug (`10_core.sql:97-99`, `12_ops.sql:300-308`).
- **Soft cross-domain refs** so exhaust and ledgers survive parent deletion (Connection Law §3.3).
- **Service-role seal** on `queue`/`observability`/`grow` — `umi_app` has no `USAGE`; `tenant_id` is a filter column, not an isolation key; migration gate fails if `umi_app` ever holds a grant there (`90_rls.sql:430-445`).
- **Secret-column surgery** — table-level `REVOKE` + column-level re-`GRANT` on `core.users.password_*`, `core.integration_tokens`, `device.sessions.token_hash`, `device.pairing_requests.pin_*`.
- **Money typing** — `*_cents integer` everywhere; sub-cent AI cost kept as `numeric(10,6)` verbatim, never scaled.
- **KDS tickets are a view** over `ops`, not a duplicate ticket tree — avoids the multi-writer kitchen-schema problem.
- **`product_instances` (tenant entitlement) vs `grow.feature_flags` (Umi control-plane)** correctly separated.

**Naming & constraints:** clean and consistent per the doc's §7 — domain schemas, plural snake_case, `*_id` FKs, `status text + CHECK` (no native enums), `v_` view prefix, idempotency keys on all durable write paths, NULL-safe partial-unique splits wherever a nullable discriminator would otherwise collapse rows, PII typed (not buried in jsonb).

**Three tables a modeler should eye (from the schema lens):**

1. **`ops.orders`** — overloaded aggregate (order truth + full KDS ticket projection; ~40 columns spanning two status machines, six cancellation columns, triple provenance). By design, but blended. → §8-B1.
2. **`loyalty.balances`** — a second cache of a value already cached on `loyalty.cards.balance_cents`. → §8-A1.
3. **`core.membership_roles`** — encodes tenant-scoped role assignments but has **no `tenant_id` column**, so it is excluded from the `tenant_isolation` RLS sweep; isolation rests solely on the membership FK/cascade. Low risk (role edges aren't tenant data a cross-tenant read would leak meaningfully), but worth confirming no read path exposes cross-tenant role edges.

**Doc-vs-DDL drift:** `platform-database-architecture.md` §observability lists a `tool_calls` table there, but the live DDL defines `tool_calls` only in `comms`. The doc's §1 "all tables in ops/comms/loyalty/device/kitchen are tenant-scoped" summary also doesn't enumerate that several `core` catalog/RBAC tables (`roles`, `permissions`, `role_permissions`, `membership_roles`, `external_refs`, `password_reset_tokens`) sit _outside_ the tenant_isolation loop, protected by grants + FK cascades instead. Cosmetic; the DDL is authoritative.

---

## 7. Ownership Map

| Tier                                                            | Domain               | Primary writer(s)                                                                                       | Read by                 |
| --------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------- |
| **Tenant-scoped (RLS-enforced)**                                | `core` (kernel)      | Dashboard (identity/RBAC), Cash (people, tenant.name — _dual writer_)                                   | Every product           |
|                                                                 | `ops`                | ConversaFlow (orders), KDS (kitchen_status), Dashboard (catalog/hours), Voice+Hours (businesses.config) | All                     |
|                                                                 | `comms`              | ConversaFlow                                                                                            | Customer 360            |
|                                                                 | `loyalty`            | Cash (**still dual-writes prod alongside umi-cash**)                                                    | Customer 360, Dashboard |
|                                                                 | `device` + `kitchen` | KDS                                                                                                     | KDS                     |
| **Platform-infra (service-role only, no `umi_app` USAGE)**      | `queue`              | umi-api worker (BullMQ + outbox relay)                                                                  | Worker only             |
|                                                                 | `observability`      | All products via TraceService (`umi_worker`/`umi_readonly`)                                             | Internal only           |
| **Umi-internal (service-role only, `REVOKE ALL FROM umi_app`)** | `grow`               | Landing (leads), Platform (subscriptions/flags)                                                         | Umi only                |

**Connection roles are fixed at three and never grow per-tenant:** `umi_app` (NOSUPERUSER, **NOBYPASSRLS** — hard-asserted with a `RAISE`), `umi_worker` (BYPASSRLS, unauthenticated/public paths), `umi_readonly`. ⟨verify-live⟩ On prod the worker pool connects as the Supabase `postgres` role (which _is_ BYPASSRLS) because the Supabase SQL editor cannot mint a BYPASSRLS role — so the deployed bypass pool is **broader** than the narrow `umi_worker` the DDL grants target (confirmed by this session's deployment records; see §12-R2).

**CRM ↔ CDP boundary (the headline ownership finding):** `grow.*` is accessed in code **only** inside `modules/leads/` (the sole other `grow.` match repo-wide is a doc comment in `jobs/lifecycle.processor.ts:18` referencing `grow.leads.emails_sent` — not a query; zero joins exist between `grow` and `core.people`/`comms`/`loyalty`). `umi_app` has no `USAGE` on `grow`; `17_grow.sql:306` `REVOKE`s all; migration gate `6d` fails if `umi_app` holds any `grow` grant. The two customer worlds are disjoint in code and in the DB.

---

## 8. Architectural Problems

Ranked within group. **Confidence:** _Confirmed_ = cross-validated by ≥2 lenses and/or session deployment records; _Verify-live_ = depends on the running DB.

### A. Duplicated derived state (the main cleanup theme)

**A1 — Card balance cached in two base tables.** `loyalty.cards.balance_cents` _and_ `loyalty.balances.balance` both hold `SUM(points_ledger.delta)`; the write path updates both to the identical value in the same block, and the purchase guard reads only `cards.balance_cents` — so `balances` is a write-only duplicate with a second drift obligation and zero new information. _Severity: medium. Confidence: Confirmed (schema + critique lenses)._ Evidence: `11_loyalty.sql:124, 193-202`; `cash-write.repository.ts:163-171, 188-191`.

**A2 — Two parallel money ledgers.** Every top-up/purchase is INSERTed into **both** `loyalty.points_ledger` (as `delta`) and `loyalty.wallet_transactions` (as `amount_cents`), with overlapping `reason`/`type` enums and no fact in one absent from the other. **They have already diverged**: the migration conservation gate (`11_loyalty.sql:703-706`) reconciles the card balances (`= SUM(points_ledger.delta) = SUM(balances.balance)`) at `95,000c` but records the `wallet_transactions` history at `94,899c` — a 101c gap — and explicitly excludes `wallet_transactions` from conservation, i.e. the second ledger is already known to disagree. _Severity: high (it's the money domain and it already drifts). Confidence: Confirmed._ **Nuance:** the design _intent_ is that `points_ledger` is authoritative (drives balance) and `wallet_transactions` is a human-readable statement/history; the fix must preserve any display metadata (§9, §13-Q5).

**A3 — Business hours representable three ways.** `ops.business_hours` (canonical weekly rows the app actually reads), `ops.businesses.open_times` jsonb (a CF carry-over with no reader), and `ops.service_windows` (dated overrides). The team's own hours-unification already declared `business_hours` canonical. `open_times` is dead duplication that invites drift. _Severity: medium. Confidence: Confirmed._ Evidence: `12_ops.sql:67, 507-523, 532-550`; `business-hours.service.ts:8`.

**A4 — Order line items in two shapes.** Normalized `ops.order_items` rows **and** an `items[]` array inside `ops.orders.details` jsonb (a CF `transactions.details` carry-over; the backfill even re-scales prices inside it). _Severity: medium. Confidence: Confirmed by schema/critique; but verify whether umi-api's `createOrder` still writes `details.items[]` at runtime — it may be a dormant migration column_ ⟨verify-live⟩. Evidence: `12_ops.sql:278, 331-358`.

**A5 — Contact identity cached on `core.people` with no sync guard.** `core.people.normalized_phone/normalized_email` duplicate the authoritative `core.contact_methods` rows, with no trigger tying them together. **This is also a potential live bug:** `core.resolve_contact` populates `contact_methods.normalized_value` but **not** `people.normalized_phone` (no sync trigger in `10_core.sql`; it's documented as migration-backfill-only), yet `turn.service.ts:96` hard-requires `person.phone` and _throws_ if null, and Customer-360 reads `c.normalized_phone`. A brand-new WhatsApp-only person created at runtime would have `NULL people.normalized_phone`. The live pipeline reportedly works, so either the prod RPC is a hotfixed variant that sets it, or live rows were backfilled. _Severity: medium (latent correctness). Confidence: Confirmed duplication; runtime break_ ⟨verify-live⟩. Evidence: `10_core.sql:92-93`; `00_foundation.sql:260-340`; `turn.service.ts:96`; `customers.repository.ts:45`.

**A6 — Tenant brand identity scattered.** `branding` jsonb on both `ops.businesses` and `loyalty.programs`; display name on both `core.tenants.name` and `ops.businesses.name`. A rebrand touches multiple tables; wallet-pass vs dashboard vs bot can render inconsistently. _Severity: low. Confidence: Confirmed._ Evidence: `12_ops.sql:61, 68`; `11_loyalty.sql:67`.

### B. Overloaded entities

**B1 — `ops.orders` is order + full KDS ticket + notification state.** Two status machines (`status` + `kitchen_status`), six cancellation columns (`cancellation_reason/_code/_note` + `partial_*`) that only apply to the kitchen view, station soft-refs, `slack_message_ts`, and **triple provenance** (`source` enum + `channel` free-text + `channel_id` FK — the same fact three ways). The "tickets live in ops" rule justifies co-locating `kitchen_status`; the six denormalized cancellation columns and triple provenance are the overload. _Severity: medium. Confidence: Confirmed._ Evidence: `12_ops.sql:264-308`. Fix: move cancellation detail into `order_events` payloads (or one jsonb); collapse provenance to `channel_id` + derived `source`.

**B2 — `product_instances.status` and `grow.subscriptions.status` share an enum, including a migration artifact.** Both use the identical five-value CHECK `active|trialing|disabled|missing|archived` — blurring "is this product enabled" (entitlement) vs "is this tenant paying" (billing) — and both bake in `'missing'`, which is a backfill placeholder, not a real live state. _Severity: low. Confidence: Confirmed._ Evidence: `10_core.sql:353-354`; `17_grow.sql:213-214`. Fix: drop `'missing'` (represent absence by row non-existence); give the two tables deliberately different value sets.

### C. Infrastructure/business leaks

**C1 — `observability.audit_log` hardcodes a Slack/ConversaFlow actor.** The actor field is `actor_slack_id` with no `actor_user_id` FK to `core.users` — a product concept leaking into the neutral audit domain. Consequence: **owner-console (Dashboard) config changes have no "who changed this" record.** Mutations of `loyalty.reward_configs`, `ops.business_hours`, `core.staff_members`, `product_instances`, program branding, etc. are unaudited; the one audit table only covers CF config changes. _Severity: medium (governance gap). Confidence: Confirmed._ Evidence: `14_observability.sql:156-164`.

### D. Deployment-fidelity gaps (running system ≠ full canonical design)

**D1 — Observability writes bound to a legacy schema name.** `OBSERVABILITY_SCHEMA` defaults to `'conversaflow'` and is interpolated into trace INSERTs (`config.schema.ts:40-43`), so the live app writes traces to a non-canonical schema even though canonical `observability.*` is defined. Out of RLS/tenant scope, so no isolation risk, but it means canonical `observability.*` may be **unwritten** by the live app. This is a known-pending "TraceService → observability rebind." _Severity: low-medium. Confidence: Confirmed (config + session memory)._ ⟨verify-live: is prod writing to `observability.*` or `conversaflow.*`?⟩

**D2 — Prod worker pool is over-privileged.** `DATABASE_URL_WORKER` uses the Supabase `postgres` role (BYPASSRLS, broadly privileged) rather than a narrow `umi_worker`, because the SQL editor can't create a BYPASSRLS role. Tier-2/3 access on prod is therefore broader than the DDL grants design. _Severity: medium. Confidence: Confirmed (deployment records)._ Fix path is Supabase-support / direct-connection role creation, not a schema change.

**D3 — Worker-pool predicate discipline is the only backstop for some queries.** On the BYPASSRLS pool there is no RLS, so tenant safety = "every query carries `tenant_id`." The Cash public paths are disciplined, but `turn-commit.repository.ts:70-84` CAS-updates `comms.conversations WHERE id=$1 AND state_version=$4` with **no `tenant_id` predicate** (low real risk — `conversationId` is server-derived, not client-supplied — but it deviates from belt-and-braces). _Severity: low. Confidence: Confirmed._

**D4 — No application-level tenant provisioning.** A repo-wide grep for `INSERT INTO core.tenants|tenant_memberships|users|product_instances|locations` returns zero hits; `TenantsRepository` only reads/updates. Tenants, owner logins (with scrypt hashes), memberships, entitlements, and channel routing are all seeded **out-of-band** (SQL editor / migration). _Severity: low (works today; a scaling/onboarding gap, not a defect). Confidence: Confirmed._ Evidence: `tenants.repository.ts:38-233`.

**D5 — `app.person_id` RLS branch is inert.** The `core.sessions` self-access policy keys on `current_person_id()` (`90_rls.sql:261-264`), but no umi-api code ever sets `app.person_id`; customer sessions are written on the worker pool. Not an isolation hole (default-deny), but a dead policy branch that could mask a future assumption. _Severity: low. Confidence: Confirmed._

**D6 — PostgREST side-channel unverified.** The design asserts `grow`/`queue`/`observability` are "never in `exposed_schemas`," but this is a Supabase project; if PostgREST is enabled and `anon`/`authenticated` retain grants, that is a data path independent of umi-api's role model. _Severity: medium if true. Confidence: Verify-live._

### E. Missing concepts (facts the schema cannot represent today)

- **E1 — Umi tenant billing money.** `grow.subscriptions` has plan/status/trial but **no price, invoice, amount, currency, payment method, or billing-event history**. The platform cannot represent what a tenant is charged or whether it was collected. _(Deliberate if billing is external/Stripe — see §13-Q6.)_
- **E2 — Payment settlement / payout / platform fee.** `ops.payments` records a capture but there is no settlement, provider fee, or payout-to-tenant concept (no Stripe-Connect-style money split).
- **E3 — Owner-console config audit** keyed to `core.users` (see C1).
- **E4 — Typed wallet refund.** Neither `wallet_transactions.type` nor `points_ledger.reason` has a `refund` value, though the design doc promises "top-up, purchase, refund." A refund cannot be typed today.
- **E5 — `ops.staff_shifts`.** The product→schema matrix references it for KDS/Time-Clock, but no such table exists.

---

## 9. Recommended Relational Model

**Principle: evolve by adding data, not redesigning.** The nine-schema domain model is correct and stays. Recommendations are targeted deltas, each reversible.

**Consolidate redundant caches (subtractive):**

- **Balance:** keep exactly one derived cache. Prefer deleting `loyalty.balances` and keeping `loyalty.cards.balance_cents` (the column the guard already reads), reconciled nightly to `SUM(points_ledger.delta)`. (A2/A1.)
- **Value ledger:** make `loyalty.wallet_transactions` a **projection/view** over the single append-only `points_ledger` (optionally add a `description`/`display_reason` column to the ledger), or keep it as a materialized statement rebuilt from the ledger — but stop double-inserting the same economic event. Rename `points_ledger` → `value_ledger`/`wallet_ledger` to end the "points" misnomer. **Gate on the umi-cash dual-writer decommission (§12-R1).**
- **Hours:** drop `ops.businesses.open_times` (or make it a generated read-model); `business_hours` is canonical, `service_windows` are overrides.
- **Order items:** treat `ops.order_items` as the sole itemization; reduce `orders.details` to non-item context.
- **Branding/name:** pick one brand home (`ops.businesses`); make `loyalty.programs.branding` an override delta; document `core.tenants.name` = legal/system name vs `ops.businesses.name` = display.
- **Contact cache:** derive `core.people.normalized_phone/email` from the primary `contact_method` via trigger/generated read-model, **or** drop them and resolve through `contact_methods` only (this also closes the A5 latent bug).

**Add missing business facts (additive, non-breaking):**

- A neutral **audit actor** on `observability.audit_log`: `actor_type` + `actor_user_id` (soft-ref `core.users`) + `actor_external_id` (Slack), and route owner-console mutations through it. (C1/E3.)
- A real **tenant-billing money model** _if_ billing is in-house: `grow.invoices` / `grow.billing_events` (amount, currency, status, provider_ref) referencing `grow.subscriptions`. _Decide first_ whether an external biller owns this (§13-Q6).
- A `refund` value in the wallet/ledger CHECK enums (E4), and — if kitchen/time-clock ships — `ops.staff_shifts` (E5).

**De-overload `ops.orders`:** move cancellation detail to `order_events` payloads or a single jsonb; collapse `source`/`channel`/`channel_id` to `channel_id` + derived `source`; keep only `kitchen_status` + station refs inline. Reserve `v_kds_tickets` for the ticket shape.

**Do not touch:** roles-as-edges, append-only ledgers, composite tenant FKs, soft cross-domain refs, tenant-scoped `people` grain, the `grow` seal, service-role isolation, KDS-as-view, `product_instances` vs `feature_flags`.

---

## 10. PostgreSQL-Level Improvements

- **`loyalty.balances`:** if kept instead of dropped, make `balance` a view or a `GENERATED`/trigger-maintained value reconciled to the ledger; never hand-update two caches.
- **`core.people.normalized_phone/email`:** replace the manual cache with a `BEFORE INSERT/UPDATE` sync trigger from the primary `contact_method`, or a generated read-model — eliminating A5's drift and the latent NULL-throw.
- **CHECK hygiene:** drop `'missing'` from `product_instances.status` and `grow.subscriptions.status`; add `'refund'` where the domain needs it. Keep `status text + CHECK` (correct choice over native enums for online evolution).
- **RLS verification (self-verifying build is good — confirm it on live):** run `\du` to confirm `umi_app` is `NOBYPASSRLS` and identify the actual worker role (D2); confirm every tenant-scoped table shows `rowsecurity = true` **and** `forcerowsecurity = true` in `pg_class`; confirm the `tenant_isolation` policy exists on each. The migration gates already assert this at build time — re-run the `99_verify.sql` gate against prod.
- **`exposed_schemas`:** confirm PostgREST exposes only intended schemas and that `anon`/`authenticated` hold no grant on `grow`/`queue`/`observability` (D6).
- **Config rename:** set `OBSERVABILITY_SCHEMA=observability` and repoint TraceService (D1); then verify traces land in canonical `observability.*`.
- **Reconciliation job:** a nightly `data_quality_findings` check that `SUM(points_ledger.delta)` matches `cards.balance_cents` and (until A2 is resolved) surfaces the `wallet_transactions` vs `points_ledger` delta rather than letting it silently grow past 101c.
- **`membership_roles`:** either add `tenant_id` (denormalized) so it joins the RLS sweep, or add an explicit test proving no read path returns cross-tenant role edges (B/§6).

---

## 11. Migration Plan (incremental, backward-compatible, prioritized)

No rewrites. Each phase is independently shippable and reversible.

**P0 — Verify live (no schema change; do first).** Confirm the four ⟨verify-live⟩ items: (a) prod worker role + BYPASSRLS (D2); (b) `exposed_schemas` + anon/authenticated grants (D6); (c) whether prod `resolve_contact` populates `people.normalized_phone` or rows are backfilled (A5); (d) whether traces write to `observability.*` or `conversaflow.*` (D1). _Risk: none. Output: promotes several findings from "verify" to "confirmed/closed."_

**P1 — Low-risk cleanups (additive/dead-column).** Rename `OBSERVABILITY_SCHEMA` + repoint TraceService (D1); drop `'missing'` from the two status CHECKs and add `'refund'` (B2/E4); generalize `audit_log` actor _additively_ (add `actor_user_id`/`actor_type`, keep `actor_slack_id`) and start routing Dashboard mutations through it (C1); add the `people.normalized_phone` sync trigger (closes A5's runtime risk without dropping the column). _Risk: low. Rollback: revert config / drop added columns._

**P2 — Drop dead duplication (after confirming no readers).** Drop `ops.businesses.open_times` (A3); reduce `orders.details.items[]` once P0 confirms it's not written at runtime (A4); collapse the balance cache — delete `loyalty.balances`, keep `cards.balance_cents` reconciled (A1). _Risk: low-medium (read-path audit required). Rollback: recreate column/table from ledger._

**P3 — Financial-model consolidation (gated, highest care).** Only after the **umi-cash dual-writer is decommissioned** (§12-R1): demote `wallet_transactions` to a projection over a renamed single `value_ledger`, run the reconciliation to resolve the 101c drift, then de-overload `ops.orders` (cancellation → events, provenance → `channel_id`). _Risk: high (live money + append-only). Rollback: keep the old tables shadow-written for one release; feature-flag readers._

**P4 — New capabilities (additive only).** Tenant-billing money model (`grow.invoices`/`billing_events`) _if_ in-house (E1/E2); `ops.staff_shifts` if kitchen/time-clock ships (E5). _Risk: low (new tables). No rollback needed._

---

## 12. Risks

- **R1 — umi-cash is still a live dual-writer on `loyalty.*`.** Any `loyalty` schema change (A1/A2/P3) must wait for the cash front-end cutover/decommission or coordinate both writers. This is the single biggest sequencing constraint. _(Session memory + ownership map.)_
- **R2 — Prod RLS role substitution (D2).** The bypass pool runs as `postgres`; a query that should have been RLS-scoped but accidentally runs on the worker pool has no backstop. Mitigated today by predicate discipline, but the design's narrow-`umi_worker` intent is not realized on prod.
- **R3 — Latent `normalized_phone` NULL-throw (A5).** If the prod RPC does _not_ set `people.normalized_phone`, a brand-new WhatsApp-only customer could throw in `turn.service`. Must be settled in P0 before it bites an untested tenant.
- **R4 — Silent financial drift (A2).** The 101c `wallet_transactions` vs `points_ledger` gap will grow until one is made a projection; add the reconciliation finding (P1) so it's visible even before P3.
- **R5 — Append-only immutability.** Any consolidation touching `points_ledger`/`wallet_transactions` fights the `block_append_only_mutation` triggers by design — corrections are new rows, never updates. Plan migrations as append + view, not rewrite.
- **R6 — Governance blind spot (C1).** Until the audit actor is generalized, there is no record of who changed owner-console config — a compliance and incident-forensics gap.

---

## 13. Open Questions (must be verified, not invented)

- **Q1 (A5/D1):** Does the **live** `core.resolve_contact` populate `people.normalized_phone`, or are live people rows backfilled? (Determines whether A5 is a latent bug or closed.) ⟨verify-live⟩
- **Q2 (D2):** What role does the prod worker pool actually connect as, and is `umi_app` confirmed `NOBYPASSRLS` on the running DB? ⟨verify-live⟩
- **Q3 (D6):** Is PostgREST enabled on `xbudknbimkgjjgohnjgp`, and do `anon`/`authenticated` hold any grant on `grow`/`queue`/`observability`?
- **Q4 (D1):** Are observability traces currently landing in canonical `observability.*` or legacy `conversaflow.*`?
- **Q5 (A2):** Is `loyalty.wallet_transactions` _intended_ as a distinct human-facing statement (justifying a projection), or is it pure duplication to delete? (Owner intent needed before P3.)
- **Q6 (E1/E2):** Will Umi bill tenants **in-house** (needs a real `grow` billing money model) or via an **external** biller (Stripe/Chargebee — then `grow.subscriptions` is correctly a thin mirror and E1/E2 are non-issues)?
- **Q7 (R1):** What is the decommission date for umi-cash's direct `loyalty.*` writes? P3 depends on it.
- **Q8:** Should a converted `grow.lead` retain a soft link to the resulting `core.tenants`/owner `core.users` for funnel→revenue continuity, or is the current zero-linkage isolation the deliberate final state?

---

## 14. Self-Critique (attempting to prove this audit wrong)

- **Biggest limitation — no live introspection.** Findings rest on the build DDL (the design-time source deployed 2026-06-20) and the `apps/umi-api` code, not a live `pg_catalog` read. I cannot confirm the deployed catalog matches these files byte-for-byte, nor directly observe policies, `exposed_schemas`, or role config. Every deployment-fidelity finding (D1–D6) is therefore correctly marked ⟨verify-live⟩ rather than asserted. This is the audit's weakest edge; P0 exists precisely to close it.
- **Tension I did not paper over (A2).** The schema lens reads `wallet_transactions` as a _deliberate_ history projection; the critique lens calls it duplication. Both are partly right — the intent is a statement view, but the _implementation_ double-inserts and has drifted. I presented it as a real issue **and** flagged that the fix hinges on owner intent (Q5), rather than asserting a delete.
- **Where I resisted false alarms.** Tenant-scoped `people` (a human = one row per tenant) _looks_ like under-normalization but is a documented privacy decision — not flagged. Multi-writer `queue.outbox_events` _looks_ like a leak but is the intended outbox pattern — not flagged. KDS mutating `ops` _looks_ like a boundary violation but is the deliberate "no `kds.*` schema" choice — flagged only as a coupling to watch, not a defect. The `thingsDoneRight` list (§6) exists so these aren't "fixed" into regressions.
- **What could still be wrong.** A4 (order `details.items[]`) may already be a dead column at runtime (P0 confirms). A5's runtime break may be masked by a hotfixed prod RPC. The 101c drift figure is the migration author's, not independently re-counted. Some RLS claims lean on `90_rls.sql`/`00_foundation.sql` excerpts rather than a full read of every policy.
- **Net.** After trying to invalidate it, the core verdict holds: **the database correctly models Umi as a platform.** Every entity I examined has one business meaning, one owner, one lifecycle, one purpose — with the localized exceptions in §8, none of which is structural. The right posture is incremental cleanup + live verification, not redesign.

---

_Provenance: synthesized from a five-lens read-only discovery fan-out (business/glossary, schema inventory, runtime flow trace, tenancy/identity/RLS, adversarial critique) over the live canonical schema, cross-checked against the build DDL and umi-api. Legacy/stale schemas were excluded from scope per directive._
