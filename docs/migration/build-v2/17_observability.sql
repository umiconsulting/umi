-- =============================================================================
-- 17_observability.sql  (canonical rebuild v2 — schema `observability`, SEALED)
--
-- The passive-exhaust domain, trimmed to the two surfaces the platform actually
-- reads back: the config-change audit trail (now with a REAL login actor, not a
-- Slack-only handle) and the analytical conversation outcome. All the
-- OpenTelemetry-shaped span/trace/log/cost sinks are DROPPED — that telemetry
-- moves to an external OTel collector, not the platform DB.
--
-- Sources -> canonical:
--   build/14_observability.sql observability.audit_log
--       -> observability.config_change        (+ login_id actor FK; fixes the
--                                               Slack-only actor defect)
--   build/14_observability.sql observability.conversation_outcomes
--       -> observability.conversation_outcome  (analytical conversion only; the
--                                               token/cost telemetry is dropped)
--   DROPPED -> OTel (not authored): ai_runs, edge_logs, security_events,
--       pipeline_spans, evaluation_traces, data_quality_findings, tool_calls.
--
-- Depends on: 00_foundation.sql (schemas, roles, `observability` USAGE granted to
--   umi_worker/umi_readonly ONLY), 11_tenant_core.sql (tenant.login — the actor
--   FK target).
--
-- POSTURE: SERVICE-ROLE ONLY. observability.* is never request-reachable; umi_app
--   has neither USAGE nor table privileges. NOT enrolled by 90_rls (only BYPASSRLS
--   workers reach the rows). tenant_id is a NULLABLE filter column, not an
--   isolation key. Soft refs are plain nullable uuids with no FK (exhaust must
--   survive parent deletion) — the ONE exception is login_id, an ON DELETE SET
--   NULL FK so the audit trail survives the login being removed while still
--   carrying a real actor reference.
--
-- Idempotent: create ... if not exists. No append-only trigger is attached here
--   (only the two financial ledgers get it); config_change immutability is
--   enforced purely by the UPDATE/DELETE grant revoke below.
-- =============================================================================

begin;

set search_path = observability, tenant, public, extensions;

-- ===========================================================================
-- observability.config_change  <- observability.audit_log. Who changed what.
--   The Slack-only-actor defect is fixed: a real `login_id` -> tenant.login(id)
--   actor FK (ON DELETE SET NULL so the trail outlives the login). The legacy
--   `actor_slack_id` handle is KEPT (not silent-dropped) for historical rows.
--   `entity` names the config subject that changed (soft descriptor).
--   before/after config carried as jsonb. APPEND-ONLY via grant revoke (no
--   trigger — trigger reserved for the two financial ledgers).
-- ===========================================================================
create table if not exists observability.config_change (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid,                              -- soft, nullable filter column
  login_id        uuid references tenant.login(id) on delete set null,  -- REAL actor
  actor_slack_id  text,                              -- legacy Slack actor (kept)
  entity          text,                              -- what changed (soft descriptor)
  previous_config jsonb,                             -- before
  new_config      jsonb,                             -- after
  metadata        jsonb not null default '{}'::jsonb,
  changed_at      timestamptz not null default now()
);

create index if not exists observability_config_change_tenant_time_idx
  on observability.config_change (tenant_id, changed_at desc);
create index if not exists observability_config_change_login_time_idx
  on observability.config_change (login_id, changed_at desc) where login_id is not null;
create index if not exists observability_config_change_actor_time_idx
  on observability.config_change (actor_slack_id, changed_at desc) where actor_slack_id is not null;
create index if not exists observability_config_change_entity_idx
  on observability.config_change (entity) where entity is not null;

-- ===========================================================================
-- observability.conversation_outcome  <- observability.conversation_outcomes.
--   ANALYTICAL CONVERSION ONLY. The token/cost telemetry columns (total_tokens,
--   total_cost_usd) are DROPPED -> OTel. What remains is the business outcome of
--   a conversation: outcome, turn_count, duration, products discussed, notes.
--   tenant_id / customer_id / conversation_id are soft nullable refs (no FK).
--   (customer_id <- source person_id / CF customer_id — the entity is now
--   tenant.customer; still a soft ref, no FK.)
-- ===========================================================================
create table if not exists observability.conversation_outcome (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid,                           -- soft, nullable filter
  customer_id        uuid,                           -- soft ref (no FK)
  conversation_id    uuid,                           -- soft ref (no FK)
  outcome            text not null,
  turn_count         integer,
  duration_seconds   integer,
  products_discussed jsonb not null default '[]'::jsonb,
  notes              text,
  created_at         timestamptz not null default now()
);

create index if not exists observability_conversation_outcome_tenant_time_idx
  on observability.conversation_outcome (tenant_id, created_at desc) where tenant_id is not null;
create index if not exists observability_conversation_outcome_conversation_idx
  on observability.conversation_outcome (conversation_id) where conversation_id is not null;
create index if not exists observability_conversation_outcome_outcome_idx
  on observability.conversation_outcome (outcome, created_at desc);

-- ===========================================================================
-- GRANTS — SEALED SCHEMA: umi_worker ONLY (never umi_app). 00_foundation already
--   withheld umi_app USAGE on `observability`; we do not re-grant it. Full SELECT
--   to worker + readonly; DML to worker. config_change is APPEND-ONLY — worker
--   may INSERT + SELECT but never UPDATE/DELETE. Then a hard REVOKE from umi_app +
--   public.
-- ===========================================================================
grant select on all tables in schema observability to umi_worker, umi_readonly;

-- conversation_outcome: full worker DML.
grant insert, update, delete on observability.conversation_outcome to umi_worker;

-- config_change: append-only — worker may INSERT + SELECT, never UPDATE/DELETE.
revoke update, delete on observability.config_change from umi_worker, umi_readonly, public;
grant insert on observability.config_change to umi_worker;

-- Future tables default to the same worker-only posture.
alter default privileges in schema observability
  grant select on tables to umi_worker, umi_readonly;
alter default privileges in schema observability
  grant insert, update, delete on tables to umi_worker;

-- Hard seal: umi_app + public must never touch observability (service-role only).
revoke all on all tables in schema observability from umi_app, public;

commit;
