-- ───────────────────────────────────────────────────────────────────────────
-- umi-api Phase 5 — grow schema grants (spec §9.3, landing-page leads)
-- Run ONCE in the platform DB as `postgres`, AFTER 002_api_grants.sql.
--
-- `grow` (leads, lead_events, subscriptions, feature_flags) is a SERVICE-ROLE-
-- ONLY schema (§9.1): prospects have no tenant and no authenticated member, so
-- the leads module reaches it exclusively through the BYPASSRLS worker pool —
-- never `umi_app`. These grants make `umi_worker` ready to own `grow`.
--
-- NO table/column migration is needed: `grow.leads` + `grow.lead_events` already
-- exist on the platform DB with every column spec §9.3 lists (confirmed live
-- 2026-06-30; RLS disabled; 0 rows). This file adds ONLY privileges.
--
-- ⚠️ Realized deployment (per 002): on prod the worker/bypass pool connects as
-- the Supabase `postgres` role, which already owns `grow` — so applying this on
-- prod is a harmless no-op. It IS required on the local canonical replica (where
-- the worker connects as the real `umi_worker`). Grants only — no credentials.
-- ───────────────────────────────────────────────────────────────────────────

-- 1. Schema usage — worker only (grow is never exposed to umi_app / tenants).
grant usage on schema grow to umi_worker;

-- 2. Full DML on grow tables (leads upsert + event-sourced lead_events).
grant select, insert, update, delete on all tables in schema grow to umi_worker;

-- 3. Sequences (none today, but future-proof) + any grow functions.
grant usage, select on all sequences in schema grow to umi_worker;
grant execute on all functions in schema grow to umi_worker;

-- 4. Future-proof: same grants auto-apply to tables/sequences added to grow later.
alter default privileges in schema grow
  grant select, insert, update, delete on tables to umi_worker;
alter default privileges in schema grow
  grant usage, select on sequences to umi_worker;
