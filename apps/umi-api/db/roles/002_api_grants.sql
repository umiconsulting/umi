-- ───────────────────────────────────────────────────────────────────────────
-- umi-api Phase 2 — role grants (spec §11.2, §9.1 product→schema matrix)
-- Run ONCE in the platform DB as `postgres`, AFTER 001_api_roles.sql.
--
-- These grants are exactly what was verified end-to-end against a canonical
-- schema replica (dumped from prod) with 36/36 integration checks + a passing
-- cross-tenant RLS isolation test. The RLS POLICIES already exist on the
-- platform DB (every core/ops/comms/loyalty table has a `tenant_isolation`
-- policy `USING core.rls_tenant_check(tenant_id)`) — do NOT recreate them; this
-- file only adds the role privileges the policies sit on top of.
--
-- This file contains ONLY grants — no credentials. It is safe to keep in git.
--
-- Role LOGIN + passwords are NOT set here (a migration must never ship literal
-- placeholder passwords — applied unchanged that would make BYPASSRLS roles
-- connectable with predictable credentials). Set them out-of-band with
-- secret-managed values, e.g. from a shell where the secrets live in env:
--   psql "$ADMIN_URL" -c "ALTER ROLE umi_app LOGIN PASSWORD '$UMI_APP_PW' NOSUPERUSER NOBYPASSRLS;"
-- (On Supabase, run that in the SQL Editor with a freshly-generated value —
-- never reuse the historically-leaked platform password.)
--
-- ⚠️ Realized deployment (2026-06-25): the request pool connects as `umi_app`
-- (NOBYPASSRLS, RLS-enforced) via the dotted Supavisor username
-- `umi_app.<project_ref>`; the worker/bypass pool connects as the existing
-- Supabase `postgres` role (which already has rolbypassrls), because Supabase
-- won't let a non-superuser grant BYPASSRLS to a custom role from SQL. So
-- `umi_worker` is currently UNUSED — but the grants below keep it ready.
-- ───────────────────────────────────────────────────────────────────────────

-- 1. Schema usage.
grant usage on schema core, ops, comms, loyalty, observability, queue to umi_worker;
grant usage on schema core, ops, comms, loyalty, observability         to umi_app;
grant usage on schema core, ops, comms, loyalty, observability         to umi_readonly;

-- 2. umi_app — the RLS-enforced web request role. Full DML on the tenant-scoped
--    schemas (RLS still filters every row to the request's tenant + member), and
--    SELECT on observability (Customer-360 reads observability.data_quality_findings).
--    Ledger integrity does NOT depend on withholding INSERT here: points_ledger /
--    wallet_transactions / gift_card_ledger have append-only triggers
--    (core.block_append_only_mutation) that block UPDATE/DELETE on the ledgers.
grant select, insert, update, delete on all tables in schema core, ops, comms, loyalty to umi_app;
grant select on all tables in schema observability to umi_app;

-- 3. umi_worker — BYPASSRLS service/background + public-customer (no-member)
--    self-service path. Full DML across tenant + service schemas; isolation on
--    this pool is the explicit `tenant_id = $1` predicate in every query.
grant select, insert, update, delete on all tables in schema core, ops, comms, loyalty, observability, queue to umi_worker;

-- 4. umi_readonly — analytics.
grant select on all tables in schema core, ops, comms, loyalty, observability to umi_readonly;

-- 5. Sequences + functions (resolve_contact / normalize_phone / rls_tenant_check …).
grant usage, select on all sequences in schema core, ops, comms, loyalty, observability, queue to umi_app, umi_worker;
grant execute on all functions in schema core, loyalty, ops, comms to umi_app, umi_worker, umi_readonly;

-- 6. Future-proof: same grants auto-apply to tables/sequences created later
--    (so a new migration doesn't silently lock umi-api out).
alter default privileges in schema core, ops, comms, loyalty
  grant select, insert, update, delete on tables to umi_app;
alter default privileges in schema observability grant select on tables to umi_app;
alter default privileges in schema core, ops, comms, loyalty, observability, queue
  grant select, insert, update, delete on tables to umi_worker;
alter default privileges in schema core, ops, comms, loyalty, observability, queue
  grant usage, select on sequences to umi_app, umi_worker;

-- The landing-page leads (Phase 5) grant `grow` to umi_worker — see the
-- companion 003_grow_grants.sql (grow is service-role-only; worker pool only).
