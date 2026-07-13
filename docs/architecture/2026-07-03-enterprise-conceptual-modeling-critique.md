# Umi — Enterprise Conceptual Modeling Critique (Phase 2)

**Date:** 2026-07-03
**Method:** Edgar Codd · C. J. Date · ANSI/SPARC three-schema separation · Terry Halpin Object-Role Modeling · ISO/TR 9007 conceptual-schema principles. No DDD / Clean Architecture / Event Sourcing / CQRS — those are software methodologies and are excluded from a *conceptual* judgement.
**Target of critique:** `docs/architecture/2026-07-03-reality-first-audit-and-redesign.md` (the "reality-first" redesign).
**This is not a redesign.** It is a Phase-F/Phase-G critique: first reconstruct the enterprise that actually exists (independently of Postgres), then judge whether the prior redesign's *logical* model follows from that *conceptual* model. The conceptual model must drive the relational model — never the reverse.

Grounded in a code-verified fan-out over the live canonical DDL (`docs/migration/build/*.sql`) and the sole backend `apps/umi-api` (8 agents: 4 enterprise-discovery slices classifying 127 concepts, 1 primary-source methodology grounding, 3 adversarial conceptual critics). Live prod = canonical schema; stale legacy schemas out of scope. Verification limit: build DDL + `apps/umi-api`, not a live `pg_catalog` read.

> **⛳ Consolidated into the current target (2026-07-05)** by [`2026-07-05-platform-domain-model-synthesis.md`](./2026-07-05-platform-domain-model-synthesis.md). This critique's conceptual ordering (authorship before storage) is **adopted wholesale** there; its §7 corrections become the §8 verdicts. Read the synthesis for the accepted model.

---

## 0. Executive verdict

The prior redesign is a competent **logical/physical** plan, but as an **enterprise conceptual model** it fails the ANSI/SPARC test in one systematic way and misses two large conceptual facts:

1. **The physical layer drove the conceptual model.** The redesign's headline structure — four "pillars," a schema count that changes from 3 to 4 "until OTel migrates," a `tenant` relation relocated because `umi_app` "must reach it," `conversation_turns` reclassified because of "exactly-once" — is defined by storage residency, connection pools, USAGE seals, RLS reachability, and retention. Those are all **internal-schema** facts. A conceptual schema is, by definition (ANSI/SPARC 1975; ISO/TR 9007 Conceptualization Principle), *invariant under storage and access path*. The redesign's own success criteria ("every schema maps to a USAGE seal or RLS") certify the conceptual model *by* the physical mechanism — the exact inversion the method forbids.

2. **Umi's own selling business is barely modeled, and where it is modeled it is inert.** The platform reasons in fine detail about its *customers'* money (loyalty ledgers, gift cards, append-only cents) but has **no representation of its own revenue** — no invoice, no price, no payment, no processor. The nominal agreement (`grow.subscriptions`) has **zero live readers or writers**; the plan is always the literal `'standard'`; the status never advances. The de-facto commercial line-item the platform actually honors is `core.product_instances` (entitlement) — which *also* has no write path. This is a Phase-A enterprise gap, not a schema defect, and the redesign inherits it silently.

3. **Authority is systematically pulled toward Umi/tenant and away from the external systems of record that actually govern the facts.** The menu is authored by **Zettle**; the WhatsApp number identity by **Meta** and its provider account by **Twilio**; the wallet pass by **Apple/Google**; the message SID by **Twilio**; currency by **ISO 4217**. The redesign models several of these as tenant-authored "forever" business facts, and in one case (currency) *drops* the external dimension entirely — silently making Umi the authority over a value ISO owns.

The genuine conceptual boundary is **authorship** — *whose fact is it* — and it yields three universes of discourse: **Umi's own business**, **each restaurant's business**, and **software machinery** (which is *quarantined*, not promoted to a peer "truth"). That boundary holds regardless of how many Postgres schemas, seals, pools, or OTel backends realize it.

---

## Methodological basis (scientific-research-check)

Per the skill, the load-bearing structural claims are separated into *documented fact* / *source-backed tradeoff* / *Umi inference*, with an explicit invalidation criterion. Five primary-source principles ground this critique; the full grounding is in the workflow output — condensed here.

| # | Principle | Documented fact (primary source) | Umi-specific inference | Invalidated if |
|---|---|---|---|---|
| P1 | **Model elementary facts, not tables.** | ORM is fact-oriented and *attribute-free*: an elementary fact "cannot be simplified without loss of meaning"; grouping facts into columns/tables is a downstream `Rmap` step (Halpin & Morgan, *Information Modeling and Relational Databases*, 2e, ch. 3–4). | Author each universe's facts *before* choosing tables/schemas. A derived cache is not an elementary fact, so it can never legitimately appear twice — which is exactly why the double balance cache and 101¢ two-ledger drift are conceptual errors, not just cleanups. | Throwaway/read-only mart, or the fact model won't be kept in sync — then the extra granularity is ceremony. |
| P2 | **Conceptual precedes and is independent of physical.** | ANSI/X3/SPARC (1975) defines external/conceptual/internal levels; the guarantee is *data independence* — change the internal schema without touching the conceptual. Codd 1970: describe data "with its natural structure only … without superimposing any additional structure for machine representation." | A Postgres schema, an RLS policy, a connection pool, a USAGE grant, a retention TTL, an OTel backend are **internal-level** artifacts. *What a Customer or an Order is* must not be reverse-engineered from which schema/pool/seal a table lands in. | A "physical" artifact actually encodes a contractual/regulatory business rule (e.g. per-tenant deletion, data residency) — then that boundary *is* a first-class conceptual fact and must be stated in the conceptual model on its own terms. |
| P3 | **Vocabulary form follows who owns the value set.** | A domain is a named value set / type (Codd 1970 §1.3; Date & Darwen, *Third Manifesto*: domain = type). The same controlled vocabulary can be a value constraint *or* rows in a relation. | Ask *who owns each value set*. Engineer-owned platform invariants (kitchen_status, ledger reasons) → deployment-gated enum. Tenant-owned sets (reward tiers) → data-driven reference relation. Externally-owned sets (currency, weekday, pass provider) → *mirror* of the outside authority's code set. | Ownership is misread — a "fixed enum" tenants actually edit (wrongly deploy-gated), or a "reference table" only engineers change via migration (ceremony). |
| P4 | **Keep entity / identifier / classification / relationship distinct.** | "An entity is a thing which can be distinctly identified"; "a relationship is an association among entities"; an attribute maps an entity/relationship set into a *value set* — attribute ≠ value set (Chen 1976 §2.2). The identifier is a *key* (a value), not the entity (Codd 1970). | A phone number, WhatsApp id, card number, email is an **identifier** of a Customer, not a Customer. An enrollment/access link earns entity status only if it carries its own facts/lifecycle; otherwise it is a relationship. | The reified thing genuinely has independent identity, its own lifecycle, and relationship-attributes (Chen's marriage / percentage-of-time case) — then promotion to entity is correct, not an error. |
| P5 | **The conceptual model is about the business, not the software.** | ISO/TR 9007 Conceptualization Principle: the conceptual schema includes "only conceptually relevant aspects … excluding all aspects of (external or internal) data representation, physical data organization and access." The 100% Principle: *real* business events/rules *do* belong. | Outbox rows, idempotency keys, sessions, pairing PINs, debounce "turns," telemetry are software mechanisms → quarantine at the internal level. The **append-only money ledgers ARE business facts** (they are the financial record of truth) → they stay in the conceptual model. | An artifact acquires independent business/legal obligation (an audit log Umi is *required* to retain, a message kept for dispute resolution) — then it is a business fact under the 100% Principle despite looking like "plumbing." |

---

## 1. Enterprise Conceptual Model (Phase A — ignore the database)

On paper, **two enterprises** meet at one seam, with **external authorities** governing several facts neither enterprise owns.

**Enterprise 1 — Umi (the software vendor).** Umi sells a fixed catalogue of software products (Cash, ConversaFlow, KDS, Dashboard, Landing) to restaurant businesses. Umi's own facts are: *prospects* it is selling to, the *restaurants that pay it* (its customers), the *agreement* under which they pay, and *what they are billed*.
- **Reality-first gap (Phase A):** Umi as a party is an **unmodelled implicit singleton** — there is no vendor/self row anywhere; every subscription/entitlement has a tenant on one side and an *unnamed* Umi on the other (`17_grow.sql:6`). Umi's **revenue is entirely absent** — no invoice/price/payment, and *no external billing processor referenced anywhere* in `apps/umi-api` (`17_grow.sql:56`, grep-negative for Stripe/Paddle/Chargebee). The agreement (`grow.subscriptions`) is **vestigial**: no live reader/writer, plan always `'standard'`, status never advanced (`17_grow.sql:209`; rows exist only from a one-time backfill). What the platform *actually* treats as the commercial line-items is `core.product_instances` (`10_core.sql:346`), read live to gate every module — but it too has **no in-app grant/revoke writer**.

**Enterprise 2 — the restaurant (a tenant).** The restaurant serves diners. Its facts: *customers*, *conversations*, *orders*, *menu*, *stored-value cards and their movements*, *visits*, *rewards*, *gift cards*, *staff*, *locations*, *hours*, *kitchen stations*, *devices*.
- **Key conceptual fact (CRM, not CDP):** the "Customer" is **customer-of-a-restaurant**, not a global person. `core.people` is tenant-scoped (`10_core.sql:87`); the same human patronising two restaurants is **two** customers. There is no cross-tenant person entity. Authority over the *human's* identity is the customer's; authority over the *customer record* is the restaurant's (created by staff registration or `resolve_contact` on first inbound).

**Actors:** Umi sales/ops; the restaurant owner + staff (each a **login** principal, distinct from the operational **staff-member** record); the diner (a customer who *never logs in*). **Products** are *interfaces that consume* these facts — not entities.

**External authorities (Phase C, exist without any Umi deployment):**
- **Zettle** — system of record for the **menu** (products, categories, variants).
- **Meta / WhatsApp** — the **channel identity** (the diner's WhatsApp address, the business's WhatsApp number).
- **Twilio** — message **delivery** and the **provider account** the number lives on.
- **Apple (PassKit) / Google (Wallet)** — the wallet **pass credential/serial** (revocable, secret-bearing).
- **ISO** — **currency** (4217), **weekday**, calendar/date; **E.164** phone format.

**Software-only concepts (exist *only* because of software — quarantine):** the transactional outbox, webhook-dedup gate, idempotency claims, dead-letter parking, sessions, PIN pairing, OTP, the debounce "conversation turn," the KDS ticket view, all telemetry, migration id-maps.

---

## 2. Enterprise vocabulary (Phase B — conceptual inventory, reality-first)

Every concept classified as **entity / relationship / event / identifier / classification / configuration / external-reference / infrastructure(software) / telemetry / ui-term**, with its authority and whether it has a *live writer* in `apps/umi-api`. "∅writer" = defined but unwritten (aspirational DDL — must **not** be treated as enterprise truth until code writes it).

### 2a. Umi's business
| Concept (table) | Kind | Authority | On paper? | Live writer? |
|---|---|---|---|---|
| **Umi the vendor** (no table) | entity | umi | yes | — (unmodelled singleton) |
| **Tenant = paying customer** (`core.tenants`) | entity | umi | yes | name/timezone only |
| **Subscription / agreement** (`grow.subscriptions`) | relationship | umi | yes | **∅ (vestigial, inert)** |
| **Product entitlement** (`core.product_instances`) | relationship | umi | yes | **∅ (read-only gate, no grant path)** |
| **Invoice / price / payment** (Umi revenue) | event | none-observed | yes | **∅ (not modelled at all)** |
| **Prospect** (`grow.leads`) | entity | umi | yes | yes (diagnostic intake) |
| **Prospect event** (`grow.lead_events`) | event | umi | yes (mixed w/ send-telemetry) | yes |
| **Diagnostic result** (`leads.diagnostic_data`) | classification | umi | yes | yes |
| **Feature flags** (`grow.feature_flags`) | configuration | developer | no | **∅ (dead; app uses ENV)** |

### 2b. The restaurant's business (live core)
| Concept (table) | Kind | Authority | Live writer? |
|---|---|---|---|
| **Customer** (`core.people`, tenant-scoped) | entity | tenant (record) / customer (human) | yes |
| **Customer contact** (`core.contact_methods`) | identifier | customer (value) / Meta (whatsapp) / ISO (format) | yes (`resolve_contact`) |
| **Customer note** (`comms.memory_items`) | entity | none-observed | **∅ (read-only; the real note store is unwritten)** |
| **Customer-360 profile** (`comms.customer_preferences`) | entity | umi (AI) | only `facts` jsonb; structured cols ∅ |
| **Conversation** (`comms.conversations`) | entity (objectified relationship) | umi | yes (but most columns are machinery) |
| **Message** (`comms.messages`) | event | customer (inbound) / umi (assistant) | yes |
| **Product / menu item** (`ops.products`) | entity | **zettle** | yes (`upsertFromZettle`) |
| **Product category** (`ops.product_categories`) | classification | **zettle** | yes (sync side-effect) |
| **Product option** (`ops.products.variants` jsonb) | relationship | **zettle** | yes |
| **Product modifier group/modifiers** (`ops.product_modifier_*`) | entity | none-observed | **∅ (dead; duplicated by variants)** |
| **Order** (`ops.orders`) | event | customer | yes (WhatsApp bot) |
| **Order line** (`ops.order_items`) | relationship | customer | yes |
| **Order lifecycle event** (`ops.order_events`) | event | staff | yes (KDS only) |
| **Payment / refund** (`ops.payments/refunds`) | event | none-observed / ISO (currency) | **∅** |
| **Loyalty program** (`loyalty.programs`) | entity | tenant | UPDATE only |
| **Loyalty account / enrollment** (`loyalty.accounts`) | relationship | tenant | yes (find-or-create) |
| **Card** (`loyalty.cards`) | entity | tenant | yes (identity) + machinery caches |
| **Card movement / ledger** (`loyalty.points_ledger`) | event | staff / customer (gift-redeem) | yes (append-only) |
| **Wallet-transaction history** (`loyalty.wallet_transactions`) | event | staff | yes (**duplicate ledger, 101¢ drift**) |
| **Visit** (`loyalty.visit_events`) | event | staff | yes |
| **Reward rule** (`loyalty.reward_configs`) | configuration (business rule) | tenant | yes |
| **Reward redemption** (`loyalty.reward_redemptions`) | event | staff | yes |
| **Birthday-reward entitlement** (`loyalty.birthday_rewards`) | entity | tenant | **redeem only — ∅ issuance** |
| **Gift card** (`loyalty.gift_cards`) | entity | staff | yes |
| **Gift-card ledger** (`loyalty.gift_card_ledger`) | event | staff / customer | yes (append-only) |
| **Wallet pass** (`loyalty.passes`) | external-reference | **apple / google** | **∅ (minted by legacy umi-cash)** |
| **Staff member** (`core.staff_members`) | entity | tenant | yes (dashboard CRUD) |
| **Login principal** (`core.users`) | entity | umi | ∅ INSERT (out-of-band) |
| **Tenant-access** (`core.tenant_memberships`) | relationship | umi | ∅ (seeded) |
| **Location** (`core.locations`) | entity | tenant | rename/status only (∅ INSERT) |
| **Business hours** (`ops.business_hours`) | configuration | tenant | yes |
| **Service window / override** (`ops.service_windows`) | configuration | none-observed | **∅** |
| **Kitchen station** (`kitchen.stations`) | entity | tenant | yes |
| **Station group / assignment** (`kitchen.station_*`) | classification / relationship | none-observed | **∅ (routing unrealised)** |
| **Device / iPad** (`device.devices`) | entity | staff | yes |
| **Channel** (`ops.channels`) | classification | none-observed | read-only |
| **Channel account / WhatsApp number** (`ops.channel_accounts`) | identifier | **twilio / meta** | read-only |
| **Zettle catalogue** (external) | external-reference | **zettle** | sync job |

### 2c. Software machinery (quarantine — *not* enterprise truth)
Outbox (`queue.outbox_events`), inbound-dedup (`queue.inbound_events`), idempotency (`queue.idempotency_keys`), dead-letters, **dead job tables** (`queue.jobs`/`job_attempts` — 0 live writers; BullMQ/Redis owns execution), sessions (`core.sessions`, `device.sessions`), pairing (`device.pairing_requests`), OTP (`loyalty.otp_verifications` — dead), **conversation turn / debounce** (`comms.conversation_turns`), lifecycle-nudge dedup (`loyalty.lifecycle_sends`), KDS ticket **view** (`ops.v_kds_tickets`), all `observability.*` telemetry (and its canonical tables have **no live writer** — the sole telemetry writer targets the *legacy* `conversaflow.*` names), and the `_migration` id-maps.

---

## 3. Authorities (Phase C — who may create / modify / retire; deployment-independent?)

The decisive column. Where the running model or the redesign disagrees with the *true* authority, it is flagged **⚠**.

| Concept | May create / modify / retire | Without a deployment? | Correct modeling form |
|---|---|---|---|
| Tenant, subscription, entitlement, prospect | **Umi** | yes | Umi-owned enterprise facts |
| Umi product catalogue (`product_key`) | **Umi** (as a business), today a **developer** CHECK enum | no (code+DDL change) ⚠ | Umi-owned reference set; today wrongly a fixed engineer enum |
| Customer record, loyalty program, reward rule, hours, station, location, staff | **the restaurant (tenant)** | yes | tenant-owned business facts / data-driven config |
| The human's identity behind a customer | **the customer** | yes | external identity; the record mirrors it |
| **Menu** products / categories / options | **Zettle** ⚠ | yes | **external-reference (mirror)** — *not* tenant-authored (redesign says "Tenant sells… needs an owning catalog module" — that owner would be overwritten on next sync) |
| **WhatsApp number** identity | **Meta** (channel) + **Twilio** (account) ⚠ | yes | external-reference; tenant *leases*, does not author |
| **Wallet pass** serial / auth token | **Apple / Google** ⚠ | no (integration-bound) | external-reference, provider-revocable, secret-sealed — *not* "forever" tenant truth |
| **Message SID** | **Twilio** ⚠ | no | external-reference doubling as a dedup gate → quarantine |
| **Currency**, **weekday**, date, phone format | **ISO / E.164** ⚠ | yes | external code set to *mirror* (redesign *drops* currency → silently hardcodes MXN) |
| Kitchen status, ledger reasons, order source, entity/billing status | **Umi engineers** | no | deployment-gated enums (correct) |
| Outbox/idempotency/session/pairing/turn/telemetry | **the runtime** | no | internal-level machinery (quarantine) |

**The systematic error:** the running model, and the redesign, pull authority *inward* — treating Zettle-, Meta-, Twilio-, Apple-, Google-, and ISO-governed facts as Umi/tenant-authored. Under P3/P5 these are *mirrors* of external systems of record; modeling them as durable local truth invites the exact overwrite/revocation conflicts the code already exhibits (Zettle sync force-marks absent products unavailable; Apple can revoke a pass).

---

## 4. Conceptual relationships (Phase D — fact types, before tables)

Elementary fact types (ORM "object plays role"), with cardinality and the challenge applied. `⟨obj-rel⟩` = an objectified relationship (has its own identity/lifecycle → legitimately an entity per P4).

**Umi's business**
- *Umi* **sells** *Product*; *Product* is-one-of a fixed catalogue. (1:N; catalogue is Umi-owned vocabulary.)
- *Tenant* **subscribes-to** *Umi* **under** *Plan*, in *billing-status*. `⟨obj-rel⟩` — but today inert; the reified subscription carries **no money role** at all.
- *Tenant* **is-entitled-to** *Product*, in *entitlement-status*. (The live commercial line-item; conflated with subscription.)
- *Umi* **charges** *Tenant* *amount* for *period* → **the missing fact** (no invoice event exists).
- *Prospect* **submitted** *form*; *Prospect* **had** *funnel-event*. (Prospect is pre-tenant, tenant-less.)

**The restaurant's business**
- *Customer* **is-known-to** *Tenant*; *Customer* **reachable-at** *contact-value* of *kind*. (Customer is tenant-scoped — *customer-of-a-restaurant*.)
- *Tenant* **holds** *dialogue* **with** *Customer* `⟨obj-rel⟩`; *dialogue* **contains** *Message*; *Message* **spoken-by** *role* at *time*. **Challenge:** the live cart/CAS state riding on the dialogue row is *not* part of "a dialogue occurred" — it is operational machinery (see §6).
- *Tenant* **sells** *Product* (authored by **Zettle**) in *category*; *Product* **offers** *option* within an *option-group* choosing *min..max*. **Challenge:** group-choice-constraint and option-name/price are **different-grain** facts (one-to-many); they cannot be one relation.
- *Customer* **placed** *Order* with *Tenant* via *channel*; *Order* **includes** *Product* at *quantity* and *unit-price*; *Order* **reached** *kitchen-state* at *time* (append-only). **Order does not earn loyalty** (verified: no writer links them).
- *Customer* **holds** *Card* `⟨obj-rel: enrollment⟩`; *Card* **recorded** *movement* of *±cents* for *reason* by *staff* (append-only — this **is** the money fact of truth). **Challenge:** *balance* and *visit-count* are **derived aggregates**, not facts the card asserts.
- *Card* **had** *Visit* on *date* by *staff*; *Program* **requires** *n visits* for *Reward*; *Customer* **redeemed** *Reward* by *staff*. *Card* **was-issued** a *Birthday-reward* for *year*, in *entitlement-status* — **an entity that can expire unredeemed**, distinct from a redemption event.
- *Tenant* **operates** *Location*; *Location* **open-on** *weekday* *t1–t2* (weekday = ISO). *Tenant* **has** *Station*; *Product* **routes-to** *Station* (a many-to-many **relationship**, unrealised).
- *Login* **may-access** *Tenant* as *role* `⟨obj-rel: tenant-access⟩`. **Challenge:** *Login* is **cross-tenant** (one owner, several restaurants) — it belongs to a shared identity space, not to any one restaurant.

---

## 5. Controlled vocabularies (Phase E — by governance)

| Governance | Vocabularies | Correct form |
|---|---|---|
| **Engineer-owned, deployment-gated** (platform invariants) | entity status (active/disabled/archived), principal status (+invited), billing/entitlement status (+trialing/missing), kitchen_status, ledger reasons, order source, gift-card reasons, contact kind, device_type | enum / CHECK (correct) |
| **Tenant-owned, should be data-driven** | reward tiers/rules, loyalty program config | reference relations the tenant edits at runtime (reward_configs already is) |
| **Externally-owned → mirror** | **currency** (ISO 4217), **weekday** (ISO), **pass provider** (Apple/Google), **payment method** (free-text), Umi **product_key** (Umi-the-business, today a developer enum) | mirror the outside authority's code set; do not re-invent or drop |
| **Software-only** | inbound-event status, job/attempt status (dead), outbox status, pairing status, message role, turn/tool status, merge match_type/confidence | internal-level; not enterprise vocabulary |

**Reality-first caveat (P3 invalidation):** many *values* have **no live writer** — `earn`/`redeem`/`adjustment`/`migration_initial_balance` on the ledger, all payment/refund statuses, automation trigger types, 7 of 8 device types, `nurturing`/`qualified` funnel stages. A vocabulary the enterprise never exercises should not be frozen into a durable CHECK as if it were an observed fact.

---

## 6. Critique of the previous redesign (Phase F — falsify it)

21 findings, three methodological axes, severity-ranked. Each cites the redesign section and code evidence.

### 6a. ANSI/SPARC layer confusion — the physical layer driving the conceptual model (P2)

- **[H] The four-pillar framing is a storage plan in conceptual clothing.** Three of four pillars are *defined by a physical mechanism*: pillar 2 = "what the runtime reads back," pillar 3 = "telemetry → OTel, leaves Postgres," pillar 4 = "fed by CDC off the outbox"; §4c's organizing column is literally **"Why it cannot leave Postgres,"** and §5 makes "every schema = a USAGE seal / RLS" an *acceptance test*. Partitioning truth by which connection role holds USAGE and which process consumes a row inverts ANSI/SPARC (`redesign:76,146,169`; `90_rls.sql:101-157`). **→** Partition by *meaning and authority*; seals/RLS/retention are internal-schema realizations stated *below* the conceptual line.
- **[H] Schema count (3 vs 4-until-OTel) promotes a migration event to a conceptual conclusion.** A conceptual model's number of categories cannot change because Tempo/Prometheus has or hasn't been stood up (`redesign:53,78,174`). The "count" is really enumerating *grant postures and live-table counts*. **→** The categories are Umi's business / the restaurant's business / quarantined machinery (telemetry being one kind) — constant whether telemetry lives in Postgres or OTel.
- **[H] `tenant` placement decided by pool reachability.** "Unbuildable / `umi_app` must reach it on the request pool" relocates the entity from Umi's universe into the restaurant's (`redesign:57,114`). This contradicts the redesign's own §1 ("Umi's facts: the restaurants that pay it") and the yardstick (`core.tenants` authority=umi, `10_core.sql:42`). Reachability is an external/internal-schema concern. **→** The tenant is a **shared boundary entity** (Umi's counterparty *and* the restaurant's root); authority = Umi; `umi_app` reads are a grants/view problem, not a reason to change ownership.
- **[M] `conversation_turns` re-tagged by a software property.** Correct *outcome* (it's machinery, keep it in Postgres) but the *criterion* — "exactly-once would break if fire-and-forget," "reads it back" — is software-correctness + storage residency, not meaning (`redesign:58,160`; `conversation-turns.repository.ts:6-9,145-231`, "turn-integrity/debounce machinery"). The yardstick classifies it **authority=runtime infrastructure**. **→** It is *quarantined machinery*, **not** a peer "Operational Truth." Elevating it (and outbox/idempotency/sessions/nudge/pairing) to a "Truth" pillar mislabels plumbing as enterprise truth (P5).
- **[M] The `umi` vs `runtime` seal argument retreats to retention/PII, still physical.** When the USAGE seal is admitted non-unique (§2.5), the redesign falls back to "kept forever vs churny/truncatable" (`redesign:54,82`). Retention and sensitivity are internal-schema attributes. **→** Distinguish by *whose fact it is*: Umi's own business record vs software machinery.
- **[M] Pool routing threaded through the per-relation spec.** "Sealing forces `loadProducts` onto the worker pool," "reference across the seam via the worker role," "validate via worker pool" (`redesign:103,108,152`). Which pool executes a read is an access-path detail contaminating the conceptual catalogue. **→** State only predicate, authority, and enterprise-role reader/writer.
- **[L] `login` "third access class" described through its RLS exception.** "No tenant_id / not under tenant_isolation / self-access" are *symptoms* of a real conceptual fact — the login is a **cross-tenant principal** — not an "exception to footnote" (`redesign:59,135`; `90_rls.sql:177-205`). **→** Name it a distinct principal concept in a shared identity space.
- **[L] Six-schema collapse justified by identical Postgres posture.** Right landing point, physical reason ("Postgres gains nothing," `redesign:53`). **→** They collapse because all six record facts of the *one restaurant enterprise*; identical grants are corroborating evidence, not the justification.
- **[L] `_migration` listed as a peer of "Enterprise Truth"; `runtime`/`queue` named by mechanism.** Transition scaffolding is not a conceptual object; names chosen by "the machinery runs"/"the incumbent queue" are implementation labels (`redesign:86,88,182`). **→** Keep migration scaffolding out of the conceptual model; name the machinery grouping for *meaning*.

### 6b. Authority misassignment — external ownership (P3, Phase C)

- **[H] `product` / `product_category` modeled as tenant-authored; author-of-record is Zettle.** Rows are keyed on `zettle_uuid`, upserted wholesale each sync, and *force-marked unavailable when absent from the latest Zettle pull* (`products.repository.ts:233,274`; `integrations.processor.ts:39-71`). A Umi "catalog module" owner would be overwritten on the next sync. **→** external-reference (authority=zettle); the tenant may curate presentation, not create/retire a synced tuple.
- **[H] `product_option` collapses the *dead* modifier tables and mislabels the writer "∅ seeded."** The **live** option representation is `ops.products.variants` jsonb, **Zettle-written** (`products.repository.ts:245,255`); the modifier tables have no writer (`12_ops.sql:199`). **→** authority=zettle, writer = the catalog sync — not a seeded, writerless tenant table.
- **[M] `whatsapp_number` as a "forever" tenant fact captures a provider-owned identifier.** The number identity is **Meta**-owned; the provider account is **Twilio**-owned (`channel.repository.ts:31-39`). The tenant *leases* it. **→** external-reference (authority=meta/twilio), not durable tenant truth.
- **[M] `wallet_pass` kept as pillar-1, retention "forever."** `serial_number` is Apple's PassKit identity; `auth_token` is secret-adjacent; both are minted and **revocable by Apple/Google**; the row is deployless=false (integration-bound) (`11_loyalty.sql:441-458`; `wallet-pass.adapter.ts:8-14`). **→** external-reference (authority=apple/google), provider-driven lifecycle, secret-sealed.
- **[M] `message` folds `twilio_message_sid` into the forever business row.** That column is a **Twilio**-owned id *and* the exactly-once webhook dedup key (`comms_messages_twilio_sid_uidx`) — software machinery by the redesign's own quarantine rule (`messages.repository.ts:39,68`; `13_comms.sql:156`). **→** the utterance is a business fact; the SID is an external-reference doubling as a dedup gate → quarantine, cross-referenced to `inbound_events`.
- **[L] Every money relation drops the ISO currency dimension.** «cents»/«amount» with no currency, and §4b explicitly discards `ops.payments.currency default 'MXN'` (`12_ops.sql:456`). Erasing it *hardcodes* single-currency MXN and makes Umi the implicit authority over an **ISO 4217** value. **→** carry currency alongside every amount; retaining it is not "inventing a settlement column."

### 6c. ORM elementary-fact integrity — fused / split / mis-classified facts (P1, P4)

- **[H] `tenant` "absorbs `ops.businesses` brand/config columns" — 1:1 cardinality mistaken for fact identity.** `businesses.config` carries *distinct* tenant-authored facts (voice/tone, ordering window, branding, business_type); the tenant identity (slug/name/status) is Umi-authored. Folding them re-creates the two-writer junk-drawer §2.2 said to split, and injects tenant-authored config into the Umi-owned RLS root (`redesign:41,90,114`; `12_ops.sql:60-75`). **→** separate fact types with separate owners; UNIQUE(tenant_id) is cardinality, not predicate identity.
- **[H] `card` fuses identity + two derived caches.** The redesign forbids collapsing *balance* to a running total, yet enshrines **"«n» visits"** — `total_visits/visits_this_cycle/pending_rewards` are running-total caches of `visit_events`, written in the same op as the visit (`redesign:66,126`; `cash-scan.repository.ts:211,221`). **→** card = identity only; balance = SUM(ledger), visit-count = COUNT(visits) — the "one cache" rule applies to visits too.
- **[H] `conversation` left whole in pillar-1, fusing the durable dialogue with live cart/CAS state.** `draft_cart/state_version/current_state/pending_clarification` are the *identical* read-back CAS machinery the redesign used to re-tag `conversation_turns` operational (`redesign:58,118`; `conversations.repository.ts:147-204`). Internal inconsistency by its own criterion. **→** enterprise fact = "a dialogue thread exists, open/closed"; the cart/state is operational machinery (quarantine).
- **[H] `reward_redemption` "absorbs `birthday_rewards`" — entity folded into an event.** A birthday reward is a durable **entitlement** (active→redeemed/expired, one per card/year) that **can expire unredeemed** — producing *no* redemption event (`redesign:130`; `11_loyalty.sql:333-349`; `cash-scan.repository.ts:196,203`). Folding it loses every issued-but-active and issued-but-expired fact. **→** keep the entitlement entity distinct from the redemption event.
- **[M] `product_option` collapses two different-grain facts.** `min/max_select/is_required` are facts about the option **group**; `name/price_delta` about an individual **modifier**; group→modifier is one-to-many (`redesign:121`; `12_ops.sql:199-241`). One relation → update anomaly or loss. **→** option-group (choice constraint) and modifier (name/price) are separate fact types. (See also 6b: the live form is Zettle `variants`.)
- **[M] `station` "folds `station_groups/assignments` as columns."** Product→station routing is a many-to-many **relationship**; grouping is a **classification** — neither is a single-valued station attribute (`redesign:141`; `16_device_kitchen.sql:131-158`). Both are 0-row. **→** routing is an independent relationship fact; defer (don't fold), as §2.7 already says.
- **[M] `whatsapp_number` names a relation after one classification value.** `channels` is a classification (whatsapp/sms/web); `channel_accounts` is a Twilio identifier. Hardcoding `whatsapp` into the *name* is the same leak class the redesign condemns for `slack_message_ts`/`product_key` (`redesign:65,142`; `12_ops.sql:84-128`). **→** "channel" is a classification, "number" a provider identifier; don't name the relation after a value; it's ∅writer — defer.
- **[L] `login` reduced to its email identifier.** `core.users.email` is **nullable** (unique only where present); `auth_subject` is a co-equal key (`redesign:135`; `10_core.sql:157-174`). A principal with a null email still signs in. **→** the entity is the login principal (surrogate/`auth_subject`); email is a nullable contact identifier, not the entity or a guaranteed key.

---

## 7. Recommended conceptual corrections (Phase F→G)

Stated as corrected **conceptual** facts (not table designs). These drive §8.

1. **Draw the boundary by authorship, not by storage.** Three universes: **Umi's business**, **the restaurant's business**, **software machinery** (quarantine — *not* a "truth"). This classification is invariant under schema count, USAGE seals, RLS, connection pools, retention, and whether telemetry lives in Postgres or OTel. Telemetry is one kind of machinery. *(P2, P5; fixes 6a-1,2,4,5.)*
2. **Model Umi as a first-class party and make its revenue a fact.** Umi is an entity, not an implicit singleton. Its agreement with a tenant carries a **money role**; today the platform has *no* representation of its own revenue. Either give the subscription substance or admit `product_instances` **is** the entitlement and derive nothing commercial from a UI module. The genuinely-missing fact is *Umi charged tenant T amount A for period P*. *(Phase A; fixes the §0.2 gap.)*
3. **Re-seat external authorities as mirrors.** Menu = **Zettle**; WhatsApp number = **Meta/Twilio**; wallet pass = **Apple/Google** (revocable, secret); message SID = **Twilio** (also a dedup gate → quarantine); currency & weekday = **ISO** (carry currency, never drop it). None is durable tenant-authored truth; each is a mirror with a provider-driven lifecycle. *(P3, Phase C; fixes 6b.)*
4. **Keep entities elementary — separate identity from derived caches and separate fused facts.** Card = identity; balance and visit-count are derived. Dialogue = "a thread exists"; the live cart/CAS state is machinery. Birthday entitlement (entity, can expire) ≠ redemption (event). Option-group (choice constraint) ≠ modifier (name/price). Product→station routing is a relationship. Tenant identity (Umi) ≠ operations config (tenant). *(P1, P4; fixes 6c.)*
5. **The tenant is a shared boundary entity; the login is a cross-tenant principal.** Tenant authority = Umi; its reachability by the request role is a grants concern. The login belongs to a shared identity space spanning tenants; its lack of `tenant_id` is the *consequence* of being cross-cutting, not an RLS "exception." *(P4; fixes 6a-3,7.)*
6. **A vocabulary the enterprise never exercises is not an observed fact.** Dead ledger reasons, unrealised statuses, 7 unused device types, and the dead job/OTP/automation vocabularies should not be frozen into durable constraints as if the business asserted them. *(P3; supports §5.)*

---

## 8. Relational changes that follow (Phase G — only now)

Each change is justified by a §7 correction, not by aesthetics. Ordered; loyalty items marked **⛔** remain gated on the umi-cash dual-writer decommission (unchanged from prior docs).

| From correction | Relational consequence |
|---|---|
| **§7.1** | Group tables by authorship into three homes; realise the Umi/restaurant boundary with the *existing* USAGE seal and the machinery quarantine with a service-role schema — but document these as **internal-schema realizations**, and drop schema-count / "leaves-Postgres" / seal-presence from the *success criteria*. Telemetry stays wherever until OTel; that move changes nothing conceptual. |
| **§7.2** | Stop deriving `subscriptionStatus` from the dashboard `product_instance` (`tenants.service.ts:85`); name `product_instances` honestly as *entitlement*. Add the Umi money fact (invoice) **only after** the in-house-vs-external-processor decision — until then, record that Umi's revenue is deliberately unmodelled, not "done." |
| **§7.3** | Reclassify `products/categories/variants` as a **Zettle mirror** (no tenant "catalog owner" that fights the sync); drop the dead `product_modifier_*` tables. Keep `whatsapp_number`/pass/`twilio_message_sid` as external-reference with provider lifecycle + secret sealing; move the SID's dedup role next to `inbound_events`. **Retain a `currency` column on every money relation.** |
| **§7.4** ⛔ | `card` → identity only; balance and visit-count become derived (view/cache over the append-only ledger/visits — the "one ledger, one cache" rule extended to visits). Split the durable `conversation` record from the mutable cart/state (cart/state joins the machinery quarantine, like `conversation_turns`). Keep `birthday_reward` as its own entity; do **not** fold into `reward_redemption`. Keep option-group vs modifier distinct (or accept the Zettle `variants` mirror as the live form). Do **not** fold `ops.businesses` config into the tenant identity root — keep tenant-authored config with its writing module. |
| **§7.5** | Keep the tenant entity's authority = Umi and solve `umi_app` reads with grants/views, not by relocating ownership. Model `login` as a cross-tenant principal in a shared identity space (surrogate/`auth_subject` key; email nullable), not an RLS carve-out of a per-tenant schema. |
| **§7.6** | Drop unexercised enum values / dead vocabularies (`earn`/`redeem`/`adjustment` unless a writer appears, unused device types, dead job/OTP/automation sets) rather than freezing them as observed facts. Confirm a live writer before "locking" any ∅writer relation (payment/refund/service_windows/station routing/modifier groups). |

---

## 9. Confirmed sound — do not re-litigate

The append-only money ledgers **are** business facts (P5 100% Principle) — keep them; never collapse to a running-total column. Roles-as-edges (`people` has no type column). `resolve_contact` as the shared identity service. Orders-don't-earn-loyalty (verified). `memory_items` is dead (verified). The software-machinery quarantine set is correctly *identified* (the error was calling part of it a "Truth pillar," not the membership). The service-role USAGE seal is real and load-bearing — "move to public" is correctly rejected. Structural tenant isolation via composite `(tenant_id, id)` FKs.

## 10. Self-critique & limits

- **This critique attacks a redesign that was already reality-grounded** — its factual findings (dead tables, duplicate caches, the Slack-only audit actor) largely stand. The correction is **conceptual ordering**, not fact: the redesign reached several right answers through physical reasoning, and let physical concerns define its top-level structure. Where the redesign and this doc *agree on the fact*, prefer this doc only for the *classification and justification*.
- **Verification limit:** grounded in build DDL + `apps/umi-api`, not a live `pg_catalog` read. The four ⟨verify-live⟩ items (normalized_phone population, prod worker role, `exposed_schemas`, `OBSERVABILITY_SCHEMA='conversaflow'`) still stand.
- **Business decisions this critique cannot make (they are the enterprise's):** in-house vs external billing (shapes the Umi money fact); whether the vestigial `subscription` is revived or retired in favour of `product_instances`; the umi-cash dual-writer decommission date (gates every ⛔ loyalty change). These are Phase-A questions about the enterprise, and no methodology can invent their answers.
