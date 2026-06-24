-- ───────────────────────────────────────────────────────────────────────────
-- umi-api Postgres roles (spec §11.2)
-- Run ONCE in the platform DB (Supabase → SQL Editor) as the `postgres` role.
--
-- Phase 0 only needs these roles to exist and be able to connect (the health
-- check runs `SELECT 1`, which needs no table grants). Per-schema privileges
-- and RLS policies are applied per domain in Phase 2+ — NOT here, so we don't
-- disturb the live permission model before we're ready.
-- ───────────────────────────────────────────────────────────────────────────

-- Use strong, freshly-generated passwords. Do NOT reuse the leaked platform
-- password; rotate it. Store these only in the VPS .env (never in git).

-- 1. umi_app — the web request role. Restricted: NOT a superuser, does NOT
--    bypass RLS. In Phase 2 it gets per-schema SELECT/INSERT/... and runs
--    `SET LOCAL app.tenant_id` per request so RLS isolates tenants.
create role umi_app with login password 'CHANGE_ME_APP' nosuperuser nocreatedb nocreaterole noinherit;

-- 2. umi_worker — background/service role. In Phase 2 this becomes the role
--    that touches the service-only schemas (queue, observability, grow) and
--    bypasses RLS. BYPASSRLS may require elevated privileges to GRANT on
--    Supabase; if the next line errors, omit `bypassrls` for now (Phase 0
--    doesn't need it) and we'll wire the service-role mapping in Phase 2.
create role umi_worker with login password 'CHANGE_ME_WORKER' nosuperuser nocreatedb nocreaterole noinherit bypassrls;

-- 3. umi_readonly — analytics / heavy reads.
create role umi_readonly with login password 'CHANGE_ME_READONLY' nosuperuser nocreatedb nocreaterole noinherit;

-- Let all three open a connection.
grant connect on database postgres to umi_app, umi_worker, umi_readonly;

-- ── Phase 2 will add (kept here as a reference, do NOT run yet) ──
-- grant usage on schema core, ops, comms, loyalty, device, kitchen to umi_app;
-- grant usage on schema core, ops, comms, loyalty, device, kitchen, queue, observability, grow to umi_worker;
-- ... plus table/RPC grants per the product→schema matrix and the RLS policies
--     from docs/migration/local-postgres/050_rls_tenant_isolation.sql.
