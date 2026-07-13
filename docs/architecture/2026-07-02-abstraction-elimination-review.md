# Umi Platform — Abstraction Elimination Review (skeptic's pass)

**Date:** 2026-07-02
**Stance:** Assume over-engineered until proven otherwise. Business facts, not architectural ideas. Every table and every schema must justify its existence or be removed. Companion to `2026-07-02-platform-database-architecture-audit.md` — this pass deliberately argues the *other* side.

---

## 0. The honest headline (read this first)

The skeptic's demolition mostly **fails to land on the tables and mostly lands on the schema names.**

Run the Boring Database Test on the actual table list and it comes back boring: `tenants, locations, people, contact_methods, users, orders, order_items, order_events, payments, refunds, products, product_categories, conversations, messages, cards, gift_cards, points_ledger, visit_events, reward_redemptions, devices, stations, leads, subscriptions`. That is the *first* list (Customers, Orders, Messages, Invoices, Products, Conversations, Tenants, Subscriptions, Payments) — not the second (Identity, Network, Core, Graph, Engine, Hub, Framework). There is **no** `AbstractEntity`, no EAV catalog, no `nodes`/`edges`, no `manager`/`orchestrator` table, no polymorphic `entity_type` column. The single most abstraction-prone move a SaaS makes — a generic `entities` + `attributes` table — is absent. `people` has no `type` column; roles are real join tables.

So this review does **not** recommend a teardown. It recommends: **rename the abstract schema/labels toward business words, fold two weak schemas, and delete ~4 tables that model software instead of business.** And it explicitly **rejects one instruction in the brief** — "move everything back to `public`" — because for three of these schemas the separation is a *real, gate-enforced PostgreSQL permission boundary*, not decoration (§2). A good skeptic concedes when the abstraction pays rent.

---

## 1. Abstract concepts that should be removed or renamed

| Abstract name | Owner/engineer test | Verdict |
|---|---|---|
| **`core`** (schema) | No restaurant owner, salesperson, or support rep ever says "core." It is the textbook architecture word. | **Rename.** It holds two unrelated things: *the businesses Umi sells to* (`tenants`, `subscriptions`-adjacent) and *the people/logins inside them* (`people`, `users`, `contact_methods`, RBAC). There is no single business word for both — which is the tell that it's one schema doing two jobs. Split into `tenants` (the Umi-customer/account concern) and `identity`… but "identity" is *also* on the suspect list. The truly boring answer: schema `accounts` for tenants/locations/subscriptions, and put people/users/contacts as `customers`, `staff`, `logins`. See §7. At minimum, `core` must go. |
| **`grow`** (schema) | A marketing verb. Nobody in the business says "the grow data." | **Rename + split.** It bundles three unrelated facts: sales prospects (`leads`), tenant billing (`subscriptions`), and engineering config (`feature_flags`). Three concepts, three homes: `sales` (leads), `billing` (subscriptions/invoices), and `feature_flags` is not "grow" at all — it's ops config. |
| **`comms`** (schema) | Engineer shorthand for "communications." Owners say "conversations" / "the chatbot." | **Rename → `messaging`** (or `conversations`). Cheap, pure win. |
| **`people`** (table) | Owners say "customers" and "staff," never "people." It introduces vocabulary the business doesn't use. | **Keep — but consciously.** This is the one abstraction that *earns* its non-business name: a human can be customer + staff + owner, and the business genuinely has no single word for "a human we know." Modeling them as one `people` row with roles-as-edges eliminates the 6-way identity duplication the old system had. Deleting it re-introduces a real bug, not just "less elegance." It survives the self-critique test. (Acceptable alt: name it `contacts`.) |
| **`product_instances`** (table) | "Product instance" is SaaS-platform vocabulary. An owner says "the products I pay for." | **Rename/merge.** It answers "what has this restaurant signed up for" — that is a *subscription/entitlement*, and it already overlaps `grow.subscriptions` (identical 5-value status enum, per the main audit §8-B2). Reconcile into `billing.subscriptions` + a boring `tenant_products` (or `subscription_items`). |
| **`external_refs`** (table) | "External ref" is migration plumbing, not a business fact. | **Remove from the domain.** It's a backfill id-mapping registry. Move to a throwaway `_migration` schema and drop after cutover. It should never have been a permanent domain table. |
| **`contact_merge_candidates`** (table) | "Merge candidate" is data-engineering vocabulary. | **Keep, relabel.** It models a real owner workflow ("are these two the same customer?") but in engineer words. If the dedup-review feature ships, name it for the workflow (`duplicate_customer_reviews`); if it doesn't, delete it — a 0-feature table is speculative. |
| **`observability` / `queue`** (schemas) | Pure engineering words. | **Keep as-is — honestly labeled.** These are *not* business data and are never shown to the business. Engineering-named schemas for engineering plumbing is correct; forcing a "business" name on a dead-letter queue would be the dishonest move. |

---

## 2. Schemas: assume unnecessary, prove necessary

The brief says "if no strong justification exists, move everything back to `public`." Applying that test honestly, the schemas split into two groups.

**Group A — the separation is a real PostgreSQL mechanism (do NOT move to public):**

| Schema(s) | The concrete Postgres/permission benefit |
|---|---|
| `queue`, `observability`, `grow` | These are **service-role-only**. `umi_app` (the request role) has **no `USAGE`** on them, and the migration *fails closed* if it ever gains a grant (`90_rls.sql` gate 6d). This is a **schema-level `USAGE` seal** — one `REVOKE USAGE` protects every current and future table at once. Flatten to `public` and you lose that: every table would need its own table-level `REVOKE`, and the next table someone adds leaks by default. **The schema boundary is the security boundary here. It stays.** |

That single fact defeats the "everything to public" recommendation. Would an experienced Postgres developer expect a `service_role`-only schema separated from the API-exposed set? **Yes** — it's a standard Supabase/PostgREST pattern (`exposed_schemas`). This is boring, not clever.

**Group B — the tenant-scoped schemas (`core`, `ops`, `comms`, `loyalty`, `device`, `kitchen`) — the separation is cognitive, not technical:**

These six all get **identical** treatment: `tenant_id NOT NULL`, the same `tenant_isolation` RLS policy, the same grants to `umi_app`. Postgres does **not** care whether `orders` and `points_ledger` live in one schema or six. So the honest verdict: **their split is a folder structure for humans, not a database mechanism.**

Is a folder structure worth it for ~80 tables? **Yes, but not at six.** The alternative — one `public` schema with 80 tables — forces you to reintroduce prefixes (`loyalty_cards`, `ops_orders`, `comms_messages`) to stay navigable, which is exactly the product/domain-prefix noise the design removed. A few domain schemas are the lesser evil. But six is too many:

- **`kitchen`** (3 tables: `stations`, `station_groups`, `station_assignments`) — **fold into `ops`.** It's kitchen *config*; it has no permission or RLS distinction from `ops`, and 3 tables don't earn a schema. `ops.stations` reads fine.
- **`device`** (4 tables) — **weakest survivor; see §4.** Its generality is justified by future devices that don't exist yet. Today there is one device type in production use (KDS). Under the brief's "forget future products" rule, `device` + `kitchen` collapse into the KDS/ops concern.

So Group B should be **4 schemas, not 6**: `accounts`/`identity` (ex-`core`, possibly split), `ops` (absorbing `kitchen` and `device`), `messaging` (ex-`comms`), `loyalty`.

---

## 3. Tables that should probably not exist (as distinct tables)

Honest count: the schema is **not** table-happy. Only a handful fail "could this be a column / is this modeling software?":

| Table | Test it fails | Recommendation |
|---|---|---|
| `core.external_refs` | Models the *migration*, not the business. | Move to `_migration`, drop post-cutover. |
| `grow.feature_flags` | Software config, not a business fact; misfiled under a sales verb. | Move to an ops/config home; it is not domain data. |
| `loyalty.balances` | Not a distinct fact — it's a **second cache** of `cards.balance_cents` (already flagged, main audit §8-A1). | Delete; keep one cache. |
| `core.product_instances` | Overlaps `grow.subscriptions`; "instance" is abstract. | Merge into the billing/subscription concept. |
| `core.contact_merge_candidates` | A work-queue for an unshipped feature. | Keep only if the dedup-review UI is real; else delete. |
| `comms.conversation_turns` + `comms.tool_calls` | Genuinely question these: do they represent a *business* fact ("what the AI reasoned/called") or an *engineering trace*? | **Move to `observability`.** Reasoning steps and tool invocations are AI plumbing/exhaust, not the tenant's conversation record. `messages` is the business fact; turns/tool_calls are trace. This tightens "infra must not live in the business schema." |

Everything else — `orders`, `order_items`, `payments`, `gift_cards`, `points_ledger`, `visit_events`, `reward_redemptions`, `messages`, `conversations`, `products`, `stations`, `devices`, `leads`, `subscriptions` — represents a clean business fact a backend engineer understands without docs. **They stay.**

**Note on the append-only ledgers:** a naive skeptic would say "`points_ledger` + `balances` + `cards.balance_cents` is three things for one number — collapse it." Half-right: kill the redundant *cache* (`balances`), but the **ledger itself is a business fact** (every money movement, immutable, auditable) — an accountant recognizes it instantly. Don't confuse "boring" with "collapse the ledger into a running-total column"; that would delete the audit trail, which is business, not architecture.

---

## 4. False generalization (design smells — "forget the future")

| Generalization | Evidence it's future-driven, not today-driven |
|---|---|
| **`device` schema is device-*type*-agnostic** | `device.devices.device_type` has an 8-value CHECK (`kds, kiosk, printer, scanner, terminal, sensor, clock, signage`). Seven of the eight have **zero rows / no product**. The design doc explicitly justifies it with "printers, kiosks, **future** gym check-in tablets, digital signage." That is textbook "might support / could later." Today it is a KDS pairing/session table. |
| **`kitchen.station_groups` (hot line / cold line)** | Routing groups for a multi-station kitchen; the KDS in use has simple stations. Speculative structure. |
| **`core.external_refs.product_key` includes `'legacy'`** and generic soft-ref shape | Built for "any external system maps to any canonical row" — a migration generality, not a live need. |
| **`grow.feature_flags.rollout` jsonb (`{percent, cohort}`)** | Percentage/cohort rollout for a platform with a handful of tenants. Nobody needs cohort rollout at this scale today. |
| **`ops.channels` / `channel_accounts`** as a general channel abstraction | Today there is effectively one channel (WhatsApp). The `sms`/`web` generality is anticipatory. (Milder — keep, but note it.) |

**Honest ruling:** `device`'s and `kitchen`'s generality is the clearest place the architecture modeled a hypothetical. Under the brief's rules, they collapse into "the KDS reads/writes order kitchen-status; a device is a paired iPad." That's `ops.devices` + `ops.stations`, not two schemas with 8 device types.

---

## 5. Product leakage

**This test the architecture largely passes** — and honesty requires saying so. The design *deliberately* refused product-named schemas: `comms` not `conversaflow`, `loyalty` not `cash`, `device` not `kds`. There is no `wallet` table, no `crm` table, no `cdp` table, no `ai` table. Products consume the schemas; they don't own them (KDS owns no `kds.*` schema — it's a view over `ops`).

The residue:
- `loyalty` and `comms` map 1:1 to exactly one product each today (Cash, ConversaFlow), so the "domain" abstraction is currently indistinguishable from the product. That's fine — the *names* are business words (loyalty, messaging), so if the product is renamed the schema survives. No action.
- The one genuine leak the main audit already caught: `observability.audit_log.actor_slack_id` — a **ConversaFlow/Slack** concept hardcoded into the neutral audit table. That's product leakage into infra. Fix per main audit §8-C1.
- "CDP" and "CRM" exist only as *documentation words*, not tables — good. Keep them out of the schema.

---

## 6. Cognitive-load review — names a new engineer must be told

A new backend engineer, no docs, reading the schema list. Names that **do not** explain themselves:

- `core` — "core of what?" (worst offender)
- `comms` — abbreviation
- `ops` — abbreviation (though "operations" is a word owners use)
- `grow` — "grow what?" and it contains unrelated things
- `observability` — engineer word (acceptable; they're the only audience)
- `queue` — engineer word (acceptable)
- `people` — will ask "why not `customers`?" (answerable in one sentence: roles-as-edges)
- `product_instances` — "instance of what?"
- `external_refs`, `contact_merge_candidates`, `data_quality_findings`, `idempotency_keys`, `outbox_events`, `dead_letters` — all require explanation, **but** all live in service-role/infra schemas an app engineer never touches, so the load is contained to platform engineers who *do* know these terms.

Names that explain themselves with zero help: `tenants, locations, orders, order_items, payments, refunds, products, conversations, messages, cards, gift_cards, visits, rewards, devices, stations, leads, subscriptions`. **That's the majority.** The cognitive load is real but **localized to ~6 schema names and ~4 tables**, not pervasive.

---

## 7. Simpler alternatives & the revised "boring" architecture

The goal: a competent Postgres dev understands it in minutes, no glossary. Changes are **rename + fold + delete**, not restructure — because the table-level model is already sound.

**Schema map — from 9 to 6:**

```
BEFORE (9)                         AFTER (6, boring)
core          ──► split ──►        accounts     (tenants, locations, subscriptions/billing — "the businesses we sell to")
                                   identity     (customers[=people], staff, logins[=users], contact info, roles)
ops           ──► absorb  ──►      operations   (orders, order_items, payments, refunds, products, hours,
kitchen       ──┘                                 channels, stations, devices)      ← kitchen + device folded in
device        ──┘
comms         ──► rename ──►       messaging    (conversations, messages; turns/tool_calls → traces)
loyalty       ──► keep   ──►       loyalty      (programs, cards, points_ledger, gift_cards, visits, rewards, passes)
grow          ──► split ──►        sales        (leads, lead_events)
                                   billing       (subscriptions, invoices)          ← merges product_instances
queue         ──► keep   ──►       platform_jobs (or keep `queue`) — service-role only
observability ──► keep   ──►       traces        (or keep `observability`) — service-role only, + turns/tool_calls
feature_flags ──► relocate ──►     (a config table in operations, not its own domain)
```

If splitting `core` feels like *more* schemas not fewer, the even-more-boring option is a single **`identity`**-free flat naming: `tenants`, `customers`, `staff` as top-level concerns. The point is: **no `core`.**

**Tables deleted or moved:** `balances` (delete — redundant cache), `external_refs` (→ `_migration`, drop), `product_instances` (merge into `billing`), `feature_flags` (→ operations config), `conversation_turns` + `tool_calls` (→ traces/observability), `contact_merge_candidates` (keep only if the feature ships).

**Kept exactly as-is (they passed every test):** the entire order/payment/refund model, the append-only `points_ledger` + `gift_card_ledger` (business audit trail, not architecture), `messages`/`conversations`, `products`/categories/modifiers, `leads`, `subscriptions`, `devices`, `stations`.

**What this review refuses to do** (where the brief is wrong for this DB):
1. **Move service-role schemas to `public`** — that deletes a real, gate-enforced permission boundary (§2). Business consequence of ignoring this: prospect PII, billing, jobs, and traces become reachable by the tenant request role. That's not "lost elegance," that's a data breach.
2. **Collapse the ledgers into a balance column** — deletes the financial audit trail (a business fact an accountant needs), not an abstraction.
3. **Rename `people` to nothing** — the abstraction prevents the 6-way identity duplication the old system actually had.

---

## 8. Self-critique of *this* review (delete-test on each recommendation)

- Delete the `queue`/`observability`/`grow` **schema boundary** → business doesn't stop, but a **security boundary** disappears. Not just elegance → **keep the boundary.**
- Delete `kitchen` schema (fold to ops) → business unaffected, only tidiness lost → **fold it.**
- Delete `device`'s 8-type generality → business unaffected today → **simplify it** (one device type in use).
- Delete `core` the *name* → business unaffected, clarity improves → **rename.**
- Delete `balances`, `external_refs`, `feature_flags`-as-domain → business unaffected → **delete/relocate.**
- Delete `people`-as-one-row → the customer/staff duplication bug returns → **do NOT delete.**
- Delete `points_ledger` immutability → lose the money audit trail → **do NOT delete.**

**Net honest verdict:** the architecture is **~85% business-driven and boring at the table level**, with abstraction concentrated in **6 schema names and ~4 software-modeling tables**. It is *not* over-engineered in the way the brief presumes. Fix it by **renaming `core`/`grow`/`comms`, folding `kitchen`+`device` into `ops`, and deleting/relocating `balances`/`external_refs`/`feature_flags`/`product_instances`/`turns`/`tool_calls`.** After that, the schema list reads like a textbook: *accounts, identity, operations, messaging, loyalty, sales, billing* + two honestly-named infra schemas. Obvious, not clever — and it got there by *subtraction*, which is the sign the bones were already right.
