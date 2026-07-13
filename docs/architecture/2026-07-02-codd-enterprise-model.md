# Umi — Enterprise Data Model, Reconstructed from Observed Facts

**Date:** 2026-07-02
**Method:** Codd/Date. Model the *enterprise*, not the application. Every relation is justified by an **observed** business fact (from the traced runtime flows, the code, and the existing data — not from industry patterns). Every relation states its predicate ("It is true that ___"), its single owner, and the processes that create / change / end it. Industry labels (`core`, `identity`, `loyalty`, `comms`, `grow`, `CDP`, `platform`) are treated as hypotheses and decomposed into concrete facts. Products (`Cash`, `ConversaFlow`, `KDS`) are not entities.

This discards the prior two documents' conclusions and rebuilds from first principles. Where it reverses an earlier call, it says so and explains why the change of *lens* changes the answer (§9).

---

## 0. Two enterprises, one hard boundary

The observed reality contains **two** businesses whose facts must never merge:

- **Umi** sells software to restaurants. Umi's facts: its prospects, the restaurants that pay it, and what they pay.
- **The restaurant (tenant)** serves diners. The restaurant's facts: its customers, conversations, orders, visits, stored value, rewards, staff, menu, places, hardware.

`tenant` is the single object that sits on the seam — it is *Umi's customer* and *the root of the restaurant's data*. It is owned by Umi and referenced by the restaurant's facts. Nothing else crosses.

The methodology's anti-mirroring rule matters here and is confirmed by observation: **tenants subscribe to Umi; customers do not subscribe to anything.** A customer's relationship to the restaurant is "holds a card / placed orders / had conversations" — never a subscription or a membership contract. The observed code has no customer-subscription and no customer-membership process.

---

## 1. Umi's enterprise (owner: Umi)

**U1 — `tenant`** — *It is true that* restaurant «name», identified by «slug», is a tenant of Umi, currently «active/disabled/archived».
Owner: Umi. Created by: onboarding (observed to be out-of-band SQL today — no runtime signup path exists). Changed by: rename, suspend. Ended by: archival (never hard-deleted).

**U2 — `subscription`** — *It is true that* organization «T» subscribes to plan «P», status «trialing/active/disabled», trial ending «date».
Owner: Umi. Created by: onboarding. Changed by: plan change / suspension. Ended by: cancellation.
*Naming is deliberate:* "subscription" is unambiguous in SaaS — one row asserts "Organization X subscribes to Plan Y." (Contrast the rejected word "membership" — see T21.)

**U3 — `subscription_item`** *(new — resolves `product_instances` + `feature_flags`)* — *It is true that* tenant «T»'s subscription includes product «Cash/ConversaFlow/KDS/Dashboard».
Owner: Umi. Justification: Umi observably enables/disables products per tenant (the dashboard gates modules on it). That is a *billing/entitlement line item*, not a generic "product instance" and not a software "feature flag." One fact, correctly named.

**U4 — `invoice`** *(missing today — a real Umi fact)* — *It is true that* Umi charged tenant «T» amount «A» for period [«start»,«end»], status «paid/unpaid».
Owner: Umi. Observed gap: `subscription` records plan/status but **no money** — Umi cannot state what it charged or collected. If Umi bills through an external processor, U4 is a thin mirror of that processor's record; decide which (see §7).

**U5 — `prospect`** *(was `grow.leads`)* — *It is true that* «name/email» from «company» is a sales prospect of Umi, first contacted «date», stage «new/nurturing/qualified».
Owner: Umi. Created by: landing-page submission. Changed by: funnel progression. Ended by: conversion to tenant, or disqualification.

**U6 — `prospect_event`** *(was `grow.lead_events`)* — *It is true that* prospect «L» experienced funnel event «type» at «time».
Owner: Umi. Created by: the drip/outreach process.

> A prospect is **not** linked to a tenant. Observed: a converted prospect and the resulting tenant share no key. That is the correct, faithful state — the two are different lifecycle stages of Umi's own sales, not one continuous entity. (If revenue-attribution ever needs the bridge, it is one nullable `prospect_id` on `tenant`, added when the business actually asks — not before.)

---

## 2. The restaurant's enterprise (owner: the tenant)

### 2a. The people the restaurant knows

**T1 — `customer`** *(was `core.people`)* — *It is true that* «display name» (born «date?») is a customer known to tenant «T».
Owner: tenant. Created by: first WhatsApp contact or register registration (the `resolve_contact` process). Changed by: profile edit. Ended by: GDPR anonymization (row retained, name nulled, because ledgers reference it).
**Reversal, stated plainly:** the earlier docs kept the abstract name `people` to allow one human to be customer + staff + owner. Observed reality does not support that: staff live in their own relation (T-staff) and logins in another (T-login), so the only observed inhabitants of this relation are **the restaurant's customers**. The unification does no observed work → the honest name is `customer`.

**T2 — `customer_contact`** *(was `contact_methods`)* — *It is true that* customer «C» is reachable at «value» of kind «phone/whatsapp/email».
Owner: tenant. Created by: resolution. This is the observed dedup key (`UNIQUE(tenant, kind, normalized_value)`); it earns its separate relation because a customer demonstrably has more than one address.

**T3 — `customer_note`** *(collapses `memory_items` + `customer_preferences`)* — *It is true that* tenant «T» knows fact «N» about customer «C» (usual order, allergy, average spend).
Owner: tenant. Created by: the AI fact-extraction step and staff entry. **Removes `memory_items`** — observed to be *read but never written* by the running backend, so it fails the lifecycle test (no process creates it). One profile of known facts per customer.

### 2b. Conversations

**T4 — `conversation`** — *It is true that* a conversation «X» between tenant «T» and customer «C» started «time» and is «open/closed».
Owner: tenant. Created by: first inbound message. Ended by: closure/expiry.

**T5 — `message`** — *It is true that* message «M» was said in conversation «X» by «customer/assistant/staff» at «time», with text «…».
Owner: tenant. Created by: inbound webhook / outbound send.

> **`conversation_turns` and `tool_calls` are removed from the enterprise model.** "The assistant took reasoning turn 3" and "the assistant called the catalog tool" are facts about the *software's execution*, not about the restaurant's business. They belong to application telemetry (§4). The restaurant's fact is the `message`.

### 2c. Menu and orders

**T6 — `product`** — *It is true that* tenant «T» sells «name» for «price cents» in category «cat».
Owner: tenant.

**T7 — `product_option`** *(collapses `product_modifier_groups` + `product_modifiers`)* — *It is true that* product «P» offers option «name» at «±price», within a choice of «min..max».
Owner: tenant.

**T8 — `order`** — *It is true that* customer «C» placed order «O» at tenant «T» via «whatsapp/register», total «cents», at «time», status «pending/…».
Owner: tenant. Created by: WhatsApp checkout or POS. Changed by: fulfillment. **Simplification:** the observed `orders` row carries a second kitchen status-machine, six cancellation columns, three provenance fields (`source`/`channel`/`channel_id`), and a Slack id. The single order fact keeps `channel` + `total` + `status`; kitchen progress and cancellation move to T10; the triple provenance collapses to one `channel`.

**T9 — `order_item`** — *It is true that* order «O» includes «qty» × «product» at «price».
Owner: tenant.

**T10 — `order_event`** — *It is true that* order «O» reached state «submitted/preparing/ready/completed/cancelled(reason)» at «time».
Owner: tenant. Append-only. This absorbs `kitchen_status` progress **and** the cancellation columns (a cancellation is an event with a reason). The KDS board is a *view* over T8+T9+T10, not a stored thing.

**T11 — `payment`** *(+ `refund`)* — *It is true that* a payment of «amount» against order «O» was «captured/failed» at «time» (and a refund of «amount» was issued).
Owner: tenant.

### 2d. Stored value, visits, rewards (the "loyalty" label, decomposed)

There is no observed "loyalty" *thing*. There are cards, value movements, visits, and rewards. The restaurant configures earn rules — that configuration is one observable fact per tenant.

**T12 — `card`** *(collapses `accounts` + `cards`)* — *It is true that* customer «C» holds card «number» at tenant «T», with stored-value balance «cents» and «n» visits.
Owner: tenant. Created by: registration. **Removes `accounts`:** the observed data shows one account per person per program with cards attached — an "account" separate from the "card" is the industry loyalty pattern, not an observed need. The card *is* the membership.

**T13 — `value_movement`** *(was `points_ledger`; removes `wallet_transactions` + `balances`)* — *It is true that* a value movement of «±cents» occurred on card «K» for reason «topup/purchase/gift/refund/adjustment» at «time», recorded by staff «S».
Owner: tenant. Append-only; balance = `SUM(±cents)`. **Three corrections from observation:** (1) the ledger holds *cents of stored value*, not "points" — name it truthfully; (2) `wallet_transactions` records the identical money events (and already disagrees by 101¢) → it is a duplicate, removed; (3) `balances` is a second cache of `card.balance` → removed. One immutable money ledger, one cached balance on the card.

**T14 — `visit`** — *It is true that* customer «C» visited tenant «T» on «date», recorded by staff «S».
Owner: tenant.

**T15 — `reward_rule`** *(was `reward_configs`)* — *It is true that* tenant «T» offers reward «name» requiring «n visits» or «cost».
Owner: tenant. This is the observed configuration a restaurant owner sets up.

**T16 — `reward_redemption`** *(absorbs `birthday_rewards`)* — *It is true that* customer «C» redeemed reward «W» on «date».
Owner: tenant. A birthday reward is a redemption with reason=birthday, not a separate relation.

**T17 — `gift_card`** *(+ `gift_card_movement`)* — *It is true that* gift card «code» worth «cents» exists at tenant «T», and a load/spend of «±cents» occurred on it.
Owner: tenant. Append-only movement ledger, same shape as T13.

**T18 — `wallet_pass`** *(was `passes`)* — *It is true that* customer «C»'s card «K» has an Apple/Google wallet pass «serial».
Owner: tenant. (`pass_devices` push targets are delivery plumbing — §4.)

> **Observed rule that overturns an industry assumption:** placing an order does **not** earn stored value or a visit. The traced WhatsApp order path never writes any T12–T14 fact; the register (Cash) path is a separate staff-driven process. So "ordering" and "earning" are **disjoint** business processes here. The model must not link them. The common pattern "orders accrue loyalty points" is *not* an Umi fact today.

### 2e. Staff and access

**T19 — `staff`** *(was `staff_members`)* — *It is true that* «name» is staff of tenant «T» at location «L», status «active».
Owner: tenant.

**T20 — `login`** *(was `users`)* — *It is true that* «email» is a login able to sign in to Umi dashboards; its secret is «hash».
Owner: shared (a login is observably cross-tenant). The only relation holding a password.

**T21 — `tenant_access`** *(collapses `tenant_memberships` + `membership_roles` + `roles` + `permissions` + `role_permissions`)* — *It is true that* login «U» may access tenant «T» as «owner/admin/staff/viewer».
Owner: tenant grant. Created by: staff invite. Changed by: role change. Ended by: revocation.
**Why not `membership`:** "membership" is overloaded — gym membership, club membership, rewards/**loyalty** membership. In a system that literally has a loyalty product, `membership` collides head-on with the loyalty concept (which here is the `card`, T12). The word carries no clear predicate. `tenant_access` states exactly one fact: this login may act at this tenant with this role. (It is *not* a `subscription` — a login does not subscribe to a tenant; only an organization subscribes to a plan, U2.)
**Over-abstraction removed:** the observed roles are a **fixed, seeded** set of four with fixed permissions — not tenant-editable data. A `permissions` catalog + `role_permissions` join + `roles` table is an RBAC *framework* modeling software configurability the business does not exercise. Collapse to a `role` enum on `tenant_access`; encode role→permission in application code until the business actually sells custom roles.

### 2f. Places, hours, hardware

**T22 — `location`** — *It is true that* tenant «T» operates location «name».
Owner: tenant.

**T23 — `open_hours`** *(was `business_hours`; removes `businesses.open_times`)* — *It is true that* location «L» is open on «weekday» from «t1» to «t2».
Owner: tenant. The observed duplicate `open_times` jsonb (no reader) is removed. `service_windows` (dated overrides) survives as **T24 `hours_override`**.

**T25 — `device`** — *It is true that* device «name» is paired to tenant «T» at location «L».
Owner: tenant. Created by: PIN pairing (an observable event). **False-generalization removed:** the observed `device_type` enum lists 8 kinds; only the kitchen iPad exists in use. Drop the speculative types — today "a paired kitchen iPad." (Session token/heartbeat are auth plumbing — §4; the *pairing event* is the business fact.)

**T26 — `station`** *(was `kitchen.stations`; `station_groups`/`assignments` fold in as routing columns)* — *It is true that* tenant «T» has kitchen station «Grill», to which product «P» routes.
Owner: tenant.

**T27 — `whatsapp_number`** *(collapses `channels` + `channel_accounts`)* — *It is true that* tenant «T» receives messages at WhatsApp number «N».
Owner: tenant. Two tables for one routing fact (a tenant's inbound number) is generality the single observed channel doesn't need.

---

## 3. Governance — a business fact currently mislabeled as observability (DEFERRED)

**G1 — `config_change` (was `observability.audit_log`)** — *It is true that* «actor» changed «setting» from «old» to «new» at «time» in tenant «T».
Owner: tenant (with Umi visibility). This **is** a genuine enterprise fact (accountability) — but it is one of the "observability" tables that actually stores real operations. **Per owner directive it is DEFERRED:** relocate it later as a proper domain **event** (`business_event` / `config_changed`) with a real `login`/`staff` actor (fixing the observed defect that it records only a Slack id). It is **not** part of the operations locked now (§8). Do not confuse it with the telemetry that leaves the database entirely (§4).

---

## 4. NOT enterprise data — and where each piece actually goes

Codd's rule "model the enterprise, not the application" removes these from the *conceptual enterprise schema*. But "not enterprise data" is not one bucket — three different things are happening, and each has a different destination.

### 4a. Telemetry — LEAVES the database entirely → OpenTelemetry

Logs, traces, and metrics are facts about **the software observing itself**. They should not live in Postgres at all. The agreed target:

```
Application
   │
   ▼  OpenTelemetry SDK
Collector
   ├── Tempo        (distributed traces / spans)
   ├── Prometheus   (metrics)
   └── Loki         (logs)
```

These tables are **deleted from the database**, re-emitted as OTel signals:

| Was (DB table) | Becomes | OTel destination |
|---|---|---|
| `pipeline_spans` | trace spans | **Tempo** |
| `conversation_turns`, `tool_calls` | AI-execution spans within the turn trace | **Tempo** |
| `ai_runs` (latency, tokens) | LLM-call spans + metrics | **Tempo** + **Prometheus** |
| `edge_logs` | structured logs | **Loki** |
| `security_events` | security-event logs | **Loki** (+ alerts) |
| `evaluation_traces` | eval spans/metrics | **Tempo** / **Prometheus** |
| `data_quality_findings` | reconciliation-job metrics/logs | **Prometheus** / **Loki** |

### 4b. Durable operational state — STAYS in Postgres

This is **not** telemetry. It is state the system reads back and that must be **transactionally consistent with business writes** — so it cannot move to a fire-and-forget signal pipeline. It stays in Postgres, but outside the *conceptual* enterprise model (it's the engine, not the business):

- `outbox_events` — must be written in the **same transaction** as the business change it announces (the whole point of the transactional-outbox pattern). Moving it to OTel would break exactly-once side effects.
- `inbound_events`, `idempotency_keys` — durable de-duplication gates that must be strongly consistent, or webhooks/retries double-process.
- `jobs`, `job_attempts`, `dead_letters` — durable work queue state the workers read back.
- `sessions` — durable auth state (token hashes); read on every request.

### 4c. Remove or relocate

- **Deferred business facts (§3):** `audit_log`/`config_change`, and `ai_runs` cost **only if** Umi ever bills on it — relocate later as domain **events**, not now.
- **Migration scaffold:** `external_refs` — drop after cutover.
- **Software config:** `feature_flags` — the *business* fact is U3 `subscription_item`.
- **Redundant caches / duplicates:** `balances`, `wallet_transactions` — carry no fact the ledger lacks.
- **Auth plumbing:** `otp_verifications` — transient OTP mechanics.

---

## 5. Abstractions dissolved (label → the facts behind it)

| Hypothesis (industry/software label) | The concrete observed facts it was hiding |
|---|---|
| `core` / `identity` / "identity platform" | `customer`, `customer_contact`, `login`, `staff`, `location`, `tenant`. No "core" or "identity" thing exists. |
| `loyalty` / "loyalty system" | `card`, `value_movement`, `visit`, `reward_rule`, `reward_redemption`, `gift_card`, `wallet_pass`. A label over seven concrete facts. |
| `comms` / "CDP" / "memory" / "profile" | `conversation`, `message`, `customer_note`. Nothing is a "CDP" or a "memory item." |
| `grow` / "growth" | Three unrelated facts under different… no, under **two** owners: `prospect`/`prospect_event` (Umi sales) and `subscription`/`subscription_item` (Umi billing). `feature_flags` was software config, not "growth." |
| `ops` / "operations" | `product`, `order`, `order_item`, `order_event`, `payment`, `open_hours`, `whatsapp_number`, `station`. |
| `device` / "hardware registry" (8 device types) | One observed fact: `device` = a paired kitchen iPad. |
| `product_instances` / `feature_flags` | `subscription_item` — what the tenant pays Umi for. |
| RBAC framework (`roles`+`permissions`+`role_permissions`+`membership_roles`) | `tenant_access` with a four-value `role` (not "membership" — that word collides with loyalty). |
| Products `Cash` / `ConversaFlow` / `KDS` | Not entities. They are processes that create/read the facts above. |

---

## 6. Facts the observed business has that industry patterns would have gotten wrong

- Orders do **not** accrue loyalty (§2d). Do not link them.
- Customers do **not** have subscriptions or memberships (§0). Only `tenant` subscribes (to Umi).
- The AI's "memory" is **not** a written store today (`memory_items` is dead); the only written customer knowledge is the extracted `customer_note`.
- A "person" is, in observed reality, a **customer** — staff and logins are already separate (§2a).
- A loyalty "account" separate from a "card" is **not** observed — the card is the membership (§2d).
- Roles/permissions are **fixed and seeded**, not tenant-authored data (§2e).

---

## 7. Missing facts (the model cannot currently assert these — and the business needs them)

1. **What Umi charged and collected** — `invoice`/payment against `subscription` (U4). Decide first whether billing is in-house or external; only build the fact Umi actually owns.
2. **Who changed a restaurant's settings** keyed to a real `login`/`staff` (G1 actor fix).
3. **A typed refund of stored value** — `value_movement.reason = 'refund'` (absent from the observed CHECK).
4. Nothing else is missing. Notably, resist adding order→loyalty links, cross-tenant customer identity, or generic "entity/attribute" tables — none is an observed need.

---

## 8. The resulting boring schema

Grouped by the two owners, no invented vocabulary. An experienced engineer reads this without a glossary.

```
UMI (Umi's own business)
  tenant                 restaurants that pay Umi
  subscription           what plan a tenant is on
  subscription_item      which products the tenant pays for
  invoice                what Umi charged / collected            [new]
  prospect               sales leads
  prospect_event         sales-funnel activity

RESTAURANT (each tenant's business)
  customer               a diner the restaurant knows            [was people]
  customer_contact       phone / whatsapp / email
  customer_note          what the restaurant knows about them    [was memory+preferences]
  conversation           a chat thread
  message                what was said
  product                menu item
  product_option         size / milk / add-ons
  order                  an order placed
  order_item             its line items
  order_event            its kitchen/lifecycle events            [absorbs cancellations]
  payment                money for an order (+ refund)
  card                   a customer's loyalty/stored-value card  [was accounts+cards]
  value_movement         immutable money ledger on a card        [was points_ledger; drops wallet_transactions+balances]
  visit                  a recorded visit
  reward_rule            what a reward costs
  reward_redemption      a reward claimed (incl. birthday)
  gift_card / gift_card_movement   stored-value gift cards
  wallet_pass            Apple/Google pass
  staff                  who works there
  login                  who can sign in                         [was users]
  tenant_access          a login's role at a tenant              [was "membership"; collapses 5 RBAC tables]
  location               a physical place
  open_hours / hours_override      when it's open
  device                 a paired kitchen iPad
  station                a kitchen station
  whatsapp_number        the tenant's inbound number             [was channels+channel_accounts]
  config_change          who changed what                        [audit, actor fixed]

DURABLE OPERATIONAL STATE — stays in Postgres, but not the business model (§4b)
  outbox_events, inbound_events, idempotency_keys, jobs, job_attempts, dead_letters, sessions

TELEMETRY — LEAVES Postgres → OpenTelemetry (§4a)
  pipeline_spans, ai_runs, evaluation_traces, edge_logs, security_events,
  data_quality_findings, conversation_turns, tool_calls
      →  OTel SDK → Collector → Tempo (traces) / Prometheus (metrics) / Loki (logs)

REMOVE / RELOCATE (§4c)
  external_refs (migration scaffold), feature_flags (→ subscription_item),
  balances + wallet_transactions (duplicates), otp_verifications (auth plumbing)

DEFERRED — real-operations fact currently mislabeled as observability (§3)
  config_change (audit)  →  later becomes a domain event, NOT locked now
```

Roughly **~30 enterprise relations** across two clearly-owned groups, down from ~82 mixed tables — the reduction is by **removing software from the business model, moving telemetry out of the database, and de-duplicating**, not by cleverness. **Locked now: the real operations (§1–§2). Deferred: telemetry→OTel wiring and the config_change event (§3, §4).**

---

## 9. Self-critique

- **Where I reversed myself, and why.** The audit and elimination docs kept `people`, the 6-schema split, and defended several abstractions on *future-optionality* grounds. This document forbids that lens and admits only observed facts — so `people → customer`, `accounts` folds into `card`, the RBAC framework collapses, and `device`'s generality drops. Both analyses are internally consistent; they differ because the **objective** differs (optionality vs. observed truth). The user asked for observed truth; this is it. The cost, stated honestly: if Umi genuinely ships a second device type or tenant-authored roles next quarter, some collapses here must be re-expanded. That is the deliberate trade Codd's method makes — model what is, not what might be.
- **Where I held a line against the brief.** "Model the enterprise, not the application" cannot literally delete the work-engine and telemetry tables — the software stops without them. I did not pretend otherwise; I moved them to a clearly-separated operational store and excluded them from the *conceptual* model. That is faithful to Codd (the conceptual schema is the enterprise) without dishonestly claiming the plumbing can vanish.
- **What remains genuinely uncertain (needs a business answer, not a pattern).** (a) Is billing in-house (build `invoice`) or external (mirror it)? (b) Is `customer_note` one profile row or many notes — depends on whether the restaurant edits facts or the AI appends them; observed code appends via upsert, so one row. (c) Does `subscription_item` belong to Umi (billing) or is product-enablement an operational toggle? Observed: the dashboard reads it as entitlement → Umi/billing. Each of these is a business question I have flagged rather than resolved by convention.
- **Delete-test on the whole model.** Every relation above, deleted, removes a fact the business can state in plain language ("a customer visited," "Umi charged this tenant," "this card's balance moved"). None exists only to satisfy another abstraction. That is the test the method demands, and the model passes it.
