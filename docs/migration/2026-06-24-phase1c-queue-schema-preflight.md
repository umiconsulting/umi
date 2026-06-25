# Phase 1c Queue/Durability Schema Preflight — Confirmed Map

**Date:** 2026-06-24
**Status:** Confirmed against the live platform DB. Unblocks Phase 1c (the durable work engine) and supersedes the uncertainty in `2026-06-24-conversaflow-edge-port-analysis.md` §4/§10.1/§10.2.
**Method:** Read-only introspection (`information_schema`/`pg_catalog`, `default_transaction_read_only=on`) against `xbudknbimkgjjgohnjgp` via the session pooler (`PLATFORM_PROD_DATABASE_URL`). No DDL/DML.
**Source of the §3.0 requirement:** spec §3.0 ("Schema preflight (blocking)") + port analysis §4 ("the #1 blocker") + §10.1/§10.2 owner decisions.

---

## 0. Bottom line

The port analysis §4 claimed four naming generations coexist and "no port SQL can be written until the live schema is confirmed." **Confirmed: on the platform DB the canonical schema is already live and is exactly what the spec §9.1 specifies.** The ambiguity in the analysis came from reading the ConversaFlow *application's own* DB (`DB_SCHEMA=conversaflow`, a separate Supabase project), which is not the DB `umi-api` connects to. The queue/durability engine binds cleanly to `queue.*`. No rename, no in-flight-row migration between two queues.

---

## 1. Schemas present (non-system)

`core, ops, comms, loyalty, device, kitchen, queue, observability, grow` (the spec §9.1 canonical set), plus `legacy`, `_migration`, `public`, and Supabase-managed (`auth, cron, net, vault, realtime, storage, extensions, graphql, …`).

**Absent (settles §10.1):** no `conversaflow`, `kds`, `platform`, `commerce`, `cash`, `umi_cash`. The migration-landed `platform/commerce/cash` names in `docs/migration/audit-output/supabase-prod-schema.sql` are **not** on this DB — that snapshot is a different/older capture. **The spec's `core/ops/comms/loyalty/device/kitchen/queue/observability/grow` wins. It is live, not aspirational.**

---

## 2. §10.2 — Authoritative queue (RESOLVED)

There are **not** two parallel queue tables. A single **`queue.jobs`** carries a `job_class` column:

- `CHECK (job_class IN ('standard','workflow'))` — `standard` = conversation/turn/enrichment jobs; `workflow` = cash-cron jobs. The "two queues" of the analysis (`conversaflow.jobs` vs `workflow_jobs`) are unified here.
- Live evidence it was the real runtime: `standard|completed` 2758 (newest `turn.*`/`*.embed` = 2026-06-08), `workflow|completed` 21 + `workflow|failed` 81 (cash crons through 2026-06-17). The 81 failed workflow rows confirm the analysis §3 note "cash workflow_jobs have NO retry" — a bug to fix in the port, not copy.
- `job_type` values seen: `message.embed, customer.extract_facts, turn.integrity, conversation.summarize, turn.process, conversation.process, goal_proximity, reward_expiring, welcome_no_visit, birthday_rewards, expire_birthday_rewards, winback_inactive, streak_recognition, product.embed, slack.refresh_pinned`.

**Under BullMQ, `queue.jobs`/`queue.job_attempts` are superseded for execution** (spec §10.5). The engine does not poll or claim them; Redis owns execution state. They remain as an optional Postgres-visible audit.

---

## 3. Confirmed `queue.*` binding surface (column-exact)

`umi_app` is non-`BYPASSRLS` and these are service-only schemas; all engine access is via the **worker pool**. `tenant_id` is `NOT NULL` and FKs `core.tenants(id)` on every table below.

### queue.outbox_events — transactional outbox (relay binds here)
`id uuid pk · tenant_id uuid NN · job_id uuid (fk jobs, SET NULL) · event_type text NN · aggregate_id uuid · idempotency_key text NN · payload jsonb NN '{}' · status text NN 'pending' · attempts smallint NN 0 · max_attempts smallint NN 5 · run_at timestamptz NN now() · published_at timestamptz · error text · created_at timestamptz NN now()`
- `CHECK status IN ('pending','delivering','delivered','failed','dead')`
- `UNIQUE(idempotency_key)` → `queue_outbox_events_idempotency_uq`
- Drain index `queue_outbox_events_deliverable_idx ON (run_at) WHERE status='pending'` → **relay query = `WHERE status='pending' AND run_at <= now()`**, transition `pending→delivering→delivered` + stamp `published_at`; on enqueue failure `attempts++`, `→dead` at `max_attempts`.
- Live: 390 `delivered`, 2 `dead`, **0 `pending`** (relay idles until Phase 3 producers write rows).

### queue.dead_letters — exhausted-job sink
`id uuid pk · tenant_id uuid NN · source_schema text · source_table text · source_id uuid · event_type text · payload jsonb NN '{}' · error text · attempts smallint NN 0 · resolved_at timestamptz · created_at timestamptz NN now()`
- **`tenant_id NOT NULL` (FK core.tenants)** → only tenant-scoped jobs can be persisted here. Infra/system jobs (no tenant) are **log-only** in `DeadLetterService`.
- Index `queue_dead_letters_tenant_unresolved_idx ON (tenant_id, created_at DESC) WHERE resolved_at IS NULL`.
- Live: 0 rows.

### queue.inbound_events — idempotent ingress gate
`id · tenant_id NN · provider text NN · provider_event_id text · event_type text NN · payload_hash text · payload jsonb NN · status text NN 'accepted' · request_id uuid NN · received_at NN now() · completed_at · error`
- `CHECK status IN ('accepted','processing','completed','failed','duplicate')`
- **`UNIQUE(provider, provider_event_id)`** → `queue_inbound_events_provider_event_uq` = the Twilio `MessageSid` dedup gate. Webhook inserts here first (`ON CONFLICT … DO NOTHING`), duplicates dropped before enqueue. (Wired in Phase 3d ingress; repo method lives in the engine now.)

### queue.idempotency_keys — generic dedup
`id · tenant_id NN · scope text NN · key text NN · result jsonb · locked_at · expires_at · created_at NN now()`
- **`UNIQUE(tenant_id, scope, key)`** → `queue_idempotency_keys_scope_key_uq`. The §11.5 lifecycle-send carve-out and other non-event dedup.

### queue.jobs / queue.job_attempts — audit only (not used for execution)
`queue.jobs`: `…priority smallint NN 0 · max_attempts smallint NN 3 · attempt_count smallint NN 0 · conversation_id uuid (indexed) · UNIQUE(inbound_event_id, job_type)…`. The claimable index `queue_jobs_claimable_idx ON (priority DESC, run_at) WHERE status='pending'` proves **higher priority number = higher precedence** → BullMQ (lower=higher) **must invert**. `conversation_id` is the per-conversation single-flight key (Phase 3b).

---

## 4. Queue RPCs

- **No routines in schema `queue`.** There is no canonical `claim_next_job`/`enqueue` stored proc — execution was always meant to move to the application layer (BullMQ), confirming spec §10.5.
- The only queue-ish functions are legacy: `public.reclaim_stale_jobs()` / `public.reclaim_stale_outbox()`. **They operate on `public.jobs`/`public.outbox` using a `state` column** (the pre-migration copies) — *not* the canonical `queue.*` (which use `status`). They are dead relative to the canonical model. Their 2-minute reclaim window is the historical stale-lock value; under BullMQ this becomes `lockDuration`/`stalledInterval`, and the analysis §3 warning applies: **size it for >2-min LLM turns** (the legacy 2 min was too tight).

---

## 5. Roles (Phase 2 follow-up — not a 1c blocker)

`umi_app`, `umi_worker`, `umi_readonly` exist but are **NOLOGIN**, `umi_worker` is **not BYPASSRLS**, and they hold **zero grants on `queue.*`**. The committed `db/roles/001_api_roles.sql` (LOGIN + BYPASSRLS) does not match live — it was not applied, or the migration created these as canonical NOLOGIN group roles (Supabase pattern: granted to a login role / `SET ROLE`).
- **1c impact: none.** Both pools currently connect via the `postgres.<ref>` pooler role (owner of `queue.*`), so worker writes to `queue.*` succeed today.
- **Phase 2 must:** grant `umi_worker` `USAGE` on `queue/observability/grow` + table DML, decide BYPASSRLS-vs-explicit-WHERE, and reconcile the connection model (connect-as vs `SET ROLE`) with `pg.service.ts`.

---

## 6. Observability mismatch (Phase 1b reconciliation — flagged)

Live `observability` schema = **canonical**: `ai_runs, pipeline_spans, security_events, audit_log, edge_logs, conversation_outcomes, data_quality_findings, evaluation_traces`.
The committed Phase 1b `TraceService` writes `conversaflow.ai_turn_logs / edge_function_logs / security_logs / pipeline_traces` (default `OBSERVABILITY_SCHEMA='conversaflow'`) — **none of these exist on the platform DB**; inserts would silently no-op (best-effort swallow). Spec §8.3's "confirmed binding" reflected the old ConversaFlow project DB, not this one.
- **Open decision (Phase 1b):** either repoint `umi-logs` to read platform `observability.*` (canonical names) and rebind `TraceService` to `ai_runs/pipeline_spans/security_events`, or confirm `umi-logs` still reads the old conversaflow DB and treat platform `observability.*` as the new canonical sink.
- **1c choice:** the dead-letter sink writes `queue.dead_letters` only; the optional observability span mirror (§10.3) is deferred until this binding is settled, so 1c does not compound the mismatch.

---

## 7. What this unblocks

Phase 1c (the durable work engine) can be built **bound to confirmed `queue.*`** now:
- centralized enqueue with **priority inversion** (confirmed needed) + retry/backoff defaults (jobs=3, outbox=5) + deterministic `jobId`;
- worker **stalled-lock sizing** for >2-min turns;
- **`DeadLetterService`** → `queue.dead_letters` (tenant-scoped; log-only for infra jobs);
- **`OutboxRelayService`** → drains `queue.outbox_events`, built + tested but **inert behind `OUTBOX_RELAY_ENABLED=false`** until Phase 3 registers `event_type→queue` routes;
- engine repo methods for the **inbound-events gate** and **idempotency-keys** dedup (consumed by Phase 3d ingress / lifecycle).

Deferred to Phase 3b (domain-coupled, not generic): the per-conversation single-flight wired to `turn.process` (mechanism = Redis `SET NX PX` mutex keyed on `conversation_id` + delayed re-enqueue), and the `event_type→queue` route registrations.
