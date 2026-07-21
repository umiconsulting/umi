# Umi — Four Pillars of Data Storage

**Date:** 2026-07-03
**Status:** Organizing principle. Sits above the three analysis docs (audit → elimination review → Codd enterprise model) and decides, for every fact, _which store owns it and why_.

> **⛳ Superseded as the current target (2026-07-05)** by [`2026-07-05-platform-domain-model-synthesis.md`](./2026-07-05-platform-domain-model-synthesis.md). The pillar/store mapping survives as _physical realization_, but the synthesis (following the conceptual-modeling critique) demotes the schema layout **below** the conceptual line — the pillars are not the top-level model. Read the synthesis for the accepted model.

Data is separated by **purpose**, not by product or by software convenience. Four purposes, four stores.

---

## The four pillars

| #   | Pillar                        | Purpose — the question it answers                                                                       | Store                                             | Status                              |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------- |
| 1   | **Enterprise Truth**          | _"What is true about the business?"_ — the business itself.                                             | PostgreSQL schema(s)                              | **Lock now**                        |
| 2   | **Operational Truth**         | _"What does the platform need, read back, to stay correct?"_ — exactly-once, dedup, durable work, auth. | PostgreSQL schema                                 | **Lock now**                        |
| 3   | **Operational Observability** | _"What is the software doing right now?"_ — traces, metrics, logs.                                      | OpenTelemetry backend (Tempo / Prometheus / Loki) | **Future**                          |
| 4   | **Analytical Truth**          | _"What patterns and aggregates matter?"_ — reporting & BI.                                              | Warehouse / read-replica, fed by CDC              | **Future (when analytics matters)** |

**The one-line test — which pillar owns a fact:**

- A business person can say _"it is true that \___"_ about it → **Enterprise (1)**.
- The platform reads it back to behave correctly (a webhook must not double-process; a side-effect must fire exactly once; a session must be valid) → **Operational (2)**.
- It is a trace / metric / log the software emits _about itself_ → **Observability (3)**.
- It is an aggregate / rollup derived from pillar 1 for reporting → **Analytical (4)**.

Pillars 1 and 2 are both PostgreSQL, but they are **different schemas** because they answer different questions and have different lifecycles: pillar 1 is the durable business record (kept forever, migrated carefully); pillar 2 is churny machinery (truncatable, high-write, rebuildable). Mixing them is the mistake that made the old `conversaflow` schema hold six unrelated things.

---

## Concrete mapping — every relation into a pillar

### Pillar 1 — Enterprise Truth (the ~30 business relations)

The full list is in `2026-07-02-codd-enterprise-model.md`. Two owners:

- **Umi's own business:** `tenant`, `subscription`, `subscription_item`, `invoice`, `prospect`, `prospect_event`.
- **The restaurant's business:** `customer`, `customer_contact`, `customer_note`, `conversation`, `message`, `product`, `product_option`, `order`, `order_item`, `order_event`, `payment`, `card`, `value_movement`, `visit`, `reward_rule`, `reward_redemption`, `gift_card`, `gift_card_movement`, `wallet_pass`, `staff`, `login`, `tenant_access`, `location`, `open_hours`, `hours_override`, `device`, `station`, `whatsapp_number`.

### Pillar 2 — Operational Truth (platform correctness — stays in Postgres)

`outbox_events`, `inbound_events`, `idempotency_keys`, `jobs`, `job_attempts`, `dead_letters`, `sessions`.
These cannot leave Postgres: `outbox_events` must be written in the _same transaction_ as the business change it announces; `inbound_events`/`idempotency_keys` are consistency gates; `sessions` is read on every request. Fire-and-forget telemetry would break correctness.

### Pillar 3 — Operational Observability (leaves Postgres → OTel, future)

`pipeline_spans`, `ai_runs`, `conversation_turns`, `tool_calls`, `edge_logs`, `security_events`, `evaluation_traces`, `data_quality_findings` → OTel SDK → Collector → **Tempo** (traces) / **Prometheus** (metrics) / **Loki** (logs). No database tables.

### Pillar 4 — Analytical Truth (future)

No tables today. When it matters, a warehouse / read-replica is fed **from pillar 1 via `outbox_events` + CDC** — never by querying the OLTP primary. This is why pillar 2's outbox is load-bearing: it is also the tap that feeds pillar 4 later.

### Neither pillar — remove / relocate / defer

- **Deferred to a pillar-1 event, later:** `config_change`/`audit_log` (a real "who changed what" business fact, but not locked now).
- **Remove:** `external_refs` (migration scaffold), `feature_flags` (the business fact is `subscription_item`), `balances` + `wallet_transactions` (duplicate the ledger), `otp_verifications` (transient auth mechanic → pillar 2 if kept at all).

---

## Schema layout — the one refinement to the "two schemas" plan

The proposal is "pillars 1 and 2 are schemas on their own." Pillar 2 is one schema, cleanly. **Pillar 1 wants two**, because inside Enterprise Truth there is a hard ownership boundary — _Umi's_ business vs _the tenant's_ business — and that boundary is **the one split PostgreSQL actually rewards with a permission seal** (a single `REVOKE USAGE` on the schema keeps the tenant request role out of Umi's sales pipeline and billing; this is exactly the load-bearing seal the audit verified). Collapsing both owners into one schema forces per-table grants that leak by default the day someone adds a table.

Recommended live layout — **three schemas**, down from nine:

| Schema         | Pillar                                           | Holds                                                                                       | Access                                                     |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **`umi`**      | 1 — Enterprise Truth (Umi's business)            | prospect, prospect_event, subscription, subscription_item, invoice                          | Umi/service-role only; sealed from the tenant request role |
| **`business`** | 1 — Enterprise Truth (the restaurant's business) | the ~24 tenant relations                                                                    | RLS-enforced per tenant (`umi_app` request role)           |
| **`platform`** | 2 — Operational Truth                            | outbox_events, inbound_events, idempotency_keys, jobs, job_attempts, dead_letters, sessions | worker/service-role only                                   |

_(Schema names are yours to set — `umi`/`business`/`platform` are the boring defaults; `platform` could equally be `runtime` or `ops`.)_

- **Observability** → OTel backend, no schema (future).
- **Analytical** → warehouse/read-replica, no live schema (future), fed by CDC off `platform.outbox_events`.

So: **an engineer opening the database sees three folders** — _Umi's business, the customer's business, and the plumbing that keeps them correct_ — with the customer's data separated from Umi's by a real wall, not a convention. That is obvious, not clever.

---

## Locked now vs. future

- **LOCK NOW (pillars 1 + 2):** the `umi`, `business`, and `platform` schemas — the real operations. This is the durable business record; get it right and freeze it.
- **FUTURE (pillar 3):** wire telemetry to OTel; delete the observability tables from Postgres.
- **FUTURE (pillar 4):** stand up the analytics warehouse when reporting/metrics genuinely matter; it consumes pillar-1 changes via the outbox, so no OLTP redesign is needed to add it.
- **LATER (bridge fact):** relocate `config_change` as a pillar-1 domain event.

**Sequencing constraint on locking pillar 1:** the `card`/`value_movement` consolidation (collapsing the duplicate `wallet_transactions`/`balances` and the 101¢ ledger drift) is gated on the **umi-cash dual-writer** still writing loyalty tables on prod — that must be decommissioned before those relations are frozen. Everything else in pillar 1 can lock immediately.

---

## Companion documents

- `2026-07-02-platform-database-architecture-audit.md` — is the current DB sound? (yes, with residual defects)
- `2026-07-02-abstraction-elimination-review.md` — what is over-abstracted? (schema names, a few software tables)
- `2026-07-02-codd-enterprise-model.md` — what does the enterprise actually assert? (the ~30 relations = pillar 1)
- **this doc** — which store owns each fact, and why. (the pillars over all of the above)
