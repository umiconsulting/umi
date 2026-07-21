# Umi Platform — Database Architecture

**Date:** 2026-06-16
**Status:** Original target spec — **superseded (2026-07-05)** by [`2026-07-05-platform-domain-model-synthesis.md`](./2026-07-05-platform-domain-model-synthesis.md).
**Principle:** Designed from first principles, not constrained by current Supabase state.

> **⛳ This is the _original_ (2026-06-16) target.** It kicked off the DB-redesign dialectic (audit → elimination → codd → pillars → reality-first → conceptual-critique → the 2026-07-05 synthesis). Read it for origin/evidence; the accepted model is the synthesis.

---

## 0. Philosophy

Umi is an AI-first platform serving multi-tenant businesses — restaurants today,
gyms, salons, events, and retail tomorrow. Products (ConversaFlow, Cash, KDS,
Dashboard, Landing) are interfaces over shared business domains. Products come
and go. Domains are permanent.

Schema names say what the data IS, not what product owns it.
`loyalty` not `cash`. `comms` not `conversaflow`. `device` not `kds`.
Names survive rebrands. A new developer opens the database and knows
instantly where everything lives.

---

## 1. Tenancy Model

Every table falls into one of three categories.

### Tenant-scoped

Every row belongs to exactly one tenant. `tenant_id uuid NOT NULL`.
RLS enforced. Composite FKs: `(tenant_id, entity_id)` guards against
cross-tenant corruption at the schema level, not just the policy level.

All tables in `ops`, `comms`, `loyalty`, `device`, `kitchen`.

### Global / cross-tenant

Data about Umi the company, or infrastructure spanning tenants.
No `tenant_id`, or `tenant_id` is nullable. Protected by role separation,
not RLS.

Tables: `grow.*` (leads have no tenant — they're prospects).
`queue.*` and `observability.*` carry denormalized `tenant_id` for filtering
but are `service_role` only — never in `exposed_schemas`.

### Umi-internal

Umi's own business data. Tenants can NEVER read these tables.
Protected by `REVOKE ALL FROM authenticated`.

Tables: `grow.*`.

### Tenancy invariants

1. Every tenant-scoped table MUST have `tenant_id uuid NOT NULL`.
2. Every tenant-scoped table MUST have RLS enabled.
3. Composite FKs: `(tenant_id, id)` unique constraint + `(tenant_id, ref_id)`
   foreign key — makes cross-tenant reference bugs structurally impossible.
4. `queue` and `observability` are `service_role` only — never API-exposed.
5. `grow` is `service_role` only — never granted to authenticated.

---

## 2. Schema Map

```
core           Identity & tenancy
ops            Business operations
comms          AI conversations & memory
loyalty        Points, rewards, wallet, passes
device         Hardware pairing, sessions, registry
kitchen        Station config, layouts
queue          Jobs, outbox, webhook events, idempotency
observability  Traces, AI runs, audit, logs, data quality
grow           Umi's leads, subscriptions, feature flags
```

### core — Identity & tenancy

The shared kernel. Every product depends on this. It depends on nothing above it.

Answer: "Who is this person? What tenant do they belong to?"

| Table                | Purpose                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `tenants`            | A business that pays Umi                                                                                                     |
| `locations`          | Physical locations belonging to a tenant                                                                                     |
| `people`             | One human known to a tenant. Customer, staff, owner-who-is-also-a-diner — all one row. Roles are edges, not duplicate rows   |
| `contact_methods`    | How to reach a person: phone, WhatsApp, email. `UNIQUE(tenant_id, kind, normalized_value)`                                   |
| `users`              | Someone who logs into the dashboard. Links to `auth.users`. May optionally link to `people` for staff-who-are-also-customers |
| `tenant_memberships` | Which user belongs to which tenant with what role                                                                            |

### ops — Business operations

The operational truth. Orders, catalog, payments, channels. Orders exist here
whether created by WhatsApp, POS, kiosk, or dashboard.

Answer: "What does this business sell? What did they sell? Who paid?"

| Table                     | Purpose                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| `businesses`              | Tenant brand configuration                                                  |
| `locations`               | (references core.locations)                                                 |
| `channels`                | WhatsApp, SMS, web — how customers reach the business                       |
| `channel_accounts`        | Specific phone numbers / accounts per channel                               |
| `products`                | Menu items, catalog. What the restaurant sells                              |
| `product_categories`      | Menu sections                                                               |
| `product_modifier_groups` | Size, milk, toppings                                                        |
| `product_modifiers`       | Individual options                                                          |
| `orders`                  | Canonical order. `source` column: whatsapp, pos, kiosk, dashboard           |
| `order_items`             | Line items. Kitchen status columns live here                                |
| `order_events`            | Append-only lifecycle: submitted → accepted → preparing → ready → completed |
| `payments`                | Payment attempts and captures                                               |
| `refunds`                 | Refunds against payments                                                    |
| `business_hours`          | When the location operates                                                  |
| `service_windows`         | Overrides for holidays, events                                              |

### comms — AI conversations & memory

What the AI reads and writes. Conversations, messages, durable memory, knowledge base.
Separated from `ops` because the access pattern is fundamentally different:
append-heavy, time-series, AI reads denormalized 360° context.

Answer: "What was said? What does the AI remember? What does it know?"

| Table                  | Purpose                                                       |
| ---------------------- | ------------------------------------------------------------- |
| `conversations`        | A customer thread. Open/closed/waiting                        |
| `messages`             | What was said. Inbound/outbound. Customer/AI/staff            |
| `conversation_turns`   | AI reasoning steps within a conversation                      |
| `tool_calls`           | What tools the AI invoked and their results                   |
| `memory_items`         | Durable facts the AI remembers: preferences, allergies, facts |
| `knowledge_documents`  | Tenant-provided grounding: FAQ, policies, menu notes          |
| `knowledge_chunks`     | Chunked text + pgvector embeddings for RAG                    |
| `customer_preferences` | Explicit customer preferences                                 |

### loyalty — Points, rewards, wallet

Financial integrity domain. Append-only ledgers. Balances are derived.
Writes through gated `SECURITY DEFINER` RPCs. `FOR UPDATE` on account rows.
Idempotency keys prevent double-award.

Answer: "How many points? What rewards? What passes? When did they visit?"

| Table                 | Purpose                                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `programs`            | Loyalty program config: earn rules, cycle length                                                                                                                  |
| `accounts`            | One per person per program. `UNIQUE(tenant_id, person_id, program_id)`                                                                                            |
| `cards`               | Physical/digital card. `balance_cents`, `total_visits`, `visits_this_cycle`                                                                                       |
| `points_ledger`       | **Append-only.** Every point movement. `delta`, `reason`, `source_type`, `source_id`, `idempotency_key`. UPDATE/DELETE blocked by trigger. Balance = `SUM(delta)` |
| `balances`            | **Derived cache.** Maintained by trigger. Reconciled nightly against ledger SUM                                                                                   |
| `reward_configs`      | What you can earn. Cycle-based (`visits_required`) or points-based (`points_cost`)                                                                                |
| `reward_redemptions`  | What was claimed                                                                                                                                                  |
| `gift_cards`          | Stored value. `code`, `balance_cents`                                                                                                                             |
| `gift_card_ledger`    | **Append-only.** Every load/spend                                                                                                                                 |
| `wallet_transactions` | Non-points money: top-up, purchase, refund                                                                                                                        |
| `wallet_passes`       | Apple/Google Wallet passes. `serial_number`, `auth_token`                                                                                                         |
| `pass_devices`        | Push notification targets for passes                                                                                                                              |
| `visit_events`        | Customer visits. Feeds streaks and cycle tracking                                                                                                                 |
| `automation_rules`    | Birthday rewards, win-back, streaks, goal proximity                                                                                                               |
| `otp_verifications`   | Phone verification                                                                                                                                                |

### device — Hardware

Any screen or peripheral in any business. Pairing, authentication, sessions,
heartbeat monitoring. Does not know what a KDS or printer or kiosk IS — it
knows "a device of type X paired to tenant Y at location Z with permissions P."

Answer: "What hardware is connected? Is it online? What can it do?"

| Table              | Purpose                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `devices`          | Registry. `device_type` (kds, kiosk, printer, scanner, terminal, sensor, clock, signage), `device_subtype`, manufacturer, model, connection_type |
| `sessions`         | Authenticated sessions. JWT hash, permissions array, heartbeat                                                                                   |
| `pairing_requests` | PIN-based pairing handshake. 6-digit code, 15-minute expiry                                                                                      |
| `events`           | Device lifecycle: paired, unpaired, offline, online, firmware update                                                                             |

### kitchen — Station config

Kitchen layout only. Tickets live in `ops.order_items` (kitchen_status column).
KDS reads via `v_kds_tickets` — a live view, not a duplicate table.

Answer: "Where is the grill station? What prep areas exist?"

| Table                 | Purpose                                    |
| --------------------- | ------------------------------------------ |
| `stations`            | Named kitchen stations with sort order     |
| `station_groups`      | Grouping for routing (hot line, cold line) |
| `station_assignments` | Which products route to which stations     |

### queue — Async infrastructure

Jobs, outbox, webhook ingress, idempotency. Active infrastructure — if you
truncate this, the system stops working. Different criticality than traces.
`service_role` only.

Answer: "What work is pending? What events need publishing? What webhooks arrived?"

| Table              | Purpose                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `jobs`             | Unified queue. `job_type`, `payload`, `status`, `run_at`, `locked_by`                                                                       |
| `job_attempts`     | Execution history per job                                                                                                                   |
| `outbox_events`    | Transactional outbox. Written in same transaction as state change. `event_type`, `payload`, `published_at`. Cross-product connective tissue |
| `inbound_events`   | Raw webhooks. `UNIQUE(provider, provider_event_id)`. Idempotent gate                                                                        |
| `idempotency_keys` | Generic deduplication. `key`, `scope`, `result`, `expires_at`                                                                               |
| `dead_letters`     | Failed events for manual inspection                                                                                                         |

### observability — Traces & audit

Passive exhaust. If you truncate this, the system runs fine — you just lose
visibility. Different retention, different consumers. `service_role` only.

Answer: "What did the AI do? What happened in production? Who changed what?"

| Table                   | Purpose                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| `ai_runs`               | LLM call trace: model, prompt_tokens, completion_tokens, latency_ms, cost |
| `tool_calls`            | Per-turn tool invocations with args and results                           |
| `pipeline_spans`        | OpenTelemetry-style trace spans across services                           |
| `audit_log`             | Who did what. Append-only. UPDATE/DELETE revoked                          |
| `security_events`       | Auth anomalies, rate-limit hits                                           |
| `edge_logs`             | Edge function stdout/stderr                                               |
| `data_quality_findings` | Reconciliation results, drift detection                                   |

### grow — Umi's business

Umi-the-company data. Sales leads, tenant subscriptions, feature flags.
Different tenancy model: leads have NO tenant (they're prospects).
Tenants never read this. `service_role` only.

Answer: "Who's in our sales pipeline? What are tenants subscribed to?"

| Table           | Purpose                                                                       |
| --------------- | ----------------------------------------------------------------------------- |
| `leads`         | Prospective restaurant clients. `tenant_id` IS NULL — they aren't tenants yet |
| `lead_events`   | Sales funnel activity                                                         |
| `subscriptions` | Tenant billing: plan, status, trial_ends_at                                   |
| `feature_flags` | Per-tenant rollout control                                                    |

---

## 3. Connection Law

1. **FKs point down into `core` only.** `loyalty.* → core.people`. `ops.* → core.tenants`.
   `comms.* → core.people`. No FK may point from one product domain into another
   (`loyalty` must not FK `ops.orders`).

2. **Cross-product effects go through `queue.outbox_events`.**
   `order.completed` → loyalty consumer awards points.
   `order.submitted` → KDS projection refreshes.
   `loyalty.points_awarded` → notify consumer sends push.
   Consumers are idempotent. Events are at-least-once.

3. **Soft references for cross-domain traceability.**
   `loyalty.points_ledger.source_type = 'order'` + `source_id` — no FK,
   survives order deletion. `observability.*` may soft-reference
   any entity. Exhaust must survive parent deletion.

4. **Composite tenant FKs for structural safety.**
   `UNIQUE(tenant_id, id)` on every tenant-scoped table.
   `FK (tenant_id, person_id) REFERENCES core.people(tenant_id, id)` —
   makes cross-tenant references physically impossible, even with a
   service-code bug.

---

## 4. Key Design Decisions

### Why `device` not `kds`

KDS is one application that runs on a device. Printers, scanners, kiosks,
time clocks, gym check-in tablets, digital signage — all share the same
pairing, auth, and session infrastructure. The device schema handles
that shared layer. What each device DOES (display orders, print tickets,
scan barcodes) is the application layer — it reads/writes the domain
schemas it's authorized for.

### Why `comms` not `conversaflow`

ConversaFlow is a product name. Products get renamed. The data is AI
conversations and memory — `comms` says what it IS.

### Why `loyalty` not `cash`

Cash is a product name. Gift cards, passes, rewards, visits are loyalty.

### Why tickets live in `ops` not `kitchen`

WhatsApp, POS, and KDS all write to order state. If tickets were in `kitchen`,
three products would write to the kitchen schema. Orders are operational truth.
KDS reads via a view — it's a projection, not a source of truth.

### Why append-only ledgers

`points_ledger` and `gift_card_ledger` only accept INSERT. UPDATE and DELETE
are blocked by trigger. Balance = `SUM(delta)`. Balances table is a derived
cache, reconciled nightly. This means loyalty points CANNOT be silently
corrupted — every movement is an auditable row with provenance.

### Why `queue` + `observability` (not one `pipe`)

Truncate `queue` → system stops working (orders, messages, events all break).
Truncate `observability` → system keeps running (you lose visibility).
Different criticality. Different retention. Different consumers.

### Why tenant-scoped `people`

The same human at El Gran Ribera and Kalala Cafe is two `people` rows.
My relationship with Cafe A is genuinely separate from my relationship
with Cafe B. A shared row would create a cross-tenant join path and a
privacy hazard. Cross-tenant identity resolution is an analytics-layer
concern, not an operational-store concern.

### Why `grow` is separate

Leads have no `tenant_id` — they're prospects. Subscriptions are Umi's
revenue data. Feature flags are per-tenant entitlements. Mixing these
with restaurant data would break the tenant-scoped invariant on every
other schema. `grow` is Umi-internal, never exposed to tenants.

---

## 5. Product-to-Schema Matrix

| Product          | Reads                           | Writes                           |
| ---------------- | ------------------------------- | -------------------------------- |
| **ConversaFlow** | core, ops, comms, loyalty       | comms, queue.outbox_events       |
| **Cash**         | core, loyalty                   | loyalty, queue.outbox_events     |
| **KDS**          | core, ops (projection), kitchen | ops.order_items (kitchen_status) |
| **Dashboard**    | All schemas (via views)         | ops, loyalty, core, grow         |
| **Landing**      | grow                            | grow                             |
| **Future POS**   | core, ops                       | ops, queue.outbox_events         |
| **Future Gym**   | core, device, loyalty, comms    | gym.*, queue.outbox_events       |
| **Time Clock**   | core, device                    | ops.staff_shifts                 |

---

## 6. Edge Cases

### Onboarding tenant #2

Zero DDL. A single transaction: `INSERT INTO core.tenants`, `core.locations`,
`loyalty.programs`, `ops.channels`, `ops.channel_accounts`, optional
`ops.products` import. RLS isolates them automatically. Every existing query,
view, and RPC works unchanged.

### Customer who is also staff

One `core.people` row. `contact_methods` for phone and email.
`core.users` row for dashboard login. `core.tenant_memberships` with `role='staff'`
and optional `person_id` linking back to their customer identity.
`loyalty.accounts` for their loyalty membership. All connected through
one person, never duplicated.

### Cross-tenant analytics

Operational store is tenant-isolated by RLS. Cross-tenant queries
(benchmarks, peer comparisons) run on a read replica or analytics
warehouse fed by `queue.outbox_events` + CDC. Never on the OLTP primary.

### GDPR / data deletion

Person requests deletion: `core.people` row is archived/anonymized.
`contact_methods` rows are deleted or anonymized. Ledger rows are NEVER
deleted (financial audit trail). `comms.messages` may be anonymized
(body → null) while preserving conversation structure. `observability`
traces are pruned on schedule, not on demand.

---

## 7. Naming Conventions

- **Schemas**: singular, short, lowercase nouns. `core`, `ops`, `comms`, `loyalty`.
- **Tables**: plural snake_case. `people`, `orders`, `loyalty_cards`.
- **Columns**: snake_case. `tenant_id`, `created_at`, `display_name`.
- **PK**: `id uuid primary key default gen_random_uuid()`.
- **Timestamps**: `created_at timestamptz`, `updated_at timestamptz`.
- **Money**: `*_cents integer` (minor units). Never float.
- **Status**: `text` with `CHECK` constraint. Not native enum.
- **Foreign keys**: `<singular>_id`. `person_id`, `order_id`, `account_id`.
- **Views**: `v_` prefix. `v_customer_360`, `v_kds_tickets`.
- **Functions**: `verb_noun`. `award_points`, `place_order`, `resolve_contact`.
- **No**: CamelCase, product prefixes, soft-delete booleans, generic `transactions`.

---

## 8. What This Architecture Eliminates

| Current problem                  | How this fixes it                                          |
| -------------------------------- | ---------------------------------------------------------- |
| 6 identity representations       | One `core.people` + `core.contact_methods`. Roles as edges |
| `cash` + `umi_cash` duplication  | One `loyalty` schema with append-only ledgers              |
| `conversaflow` holding 6 domains | Split into `ops` + `comms` + `queue`                       |
| KDS duplicate ticket tree        | `ops.order_items` as single source; KDS reads projection   |
| Mutable loyalty balances         | Append-only `points_ledger` with `SUM(delta)`              |
| Product-named schemas            | Domain-named schemas survive rebrands                      |
| No tenancy enforcement           | Composite tenant FKs + uniform RLS                         |
| Homeless OAuth tokens            | Future: `integrations` schema or explicit home in platform |
| No analytics path                | `queue.outbox_events` + CDC → warehouse/read replica       |
