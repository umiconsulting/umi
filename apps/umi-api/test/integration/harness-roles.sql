-- ============================================================================
-- Local integration-harness login roles (one-time, cluster-global).
--
-- build-v3 ships `api` / `worker` / `readonly` as NOLOGIN GROUP roles
-- (docs/migration/build-v3/00_foundation.sql). Nothing can *connect* as them.
-- The live-DB harness (src/shared/database/rls.integration.ts) needs real LOGIN
-- roles that carry the group privileges, mirroring how prod provisions them
-- (SECURITY_GATE.md D5). Run ONCE as a superuser against the local cluster:
--
--     psql -p 5233 -d umi_backfill_v3 -f apps/umi-api/test/integration/harness-roles.sql
--
-- Roles are cluster-global, so rebuilding umi_backfill_v3 does NOT drop them.
-- ⚠️ BUT schema/table GRANTS live inside the database, so 00_run_backfill.sh
--    (which drops and recreates it) DOES drop them. Re-run this file after
--    every rebuild, or identity-normalization.integration.ts will refuse to run.
--
-- ⚠️ CRITICAL Postgres semantics, load-bearing for prod too (D5):
--    BYPASSRLS / SUPERUSER / LOGIN are ROLE ATTRIBUTES and are NEVER inherited
--    through membership. A login role that is only a MEMBER of `worker` inherits
--    its table GRANTS but is still RLS-confined. The worker login role must carry
--    BYPASSRLS *itself*. (api needs no special attribute — grants inherit fine.)
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'api_login') then
    create role api_login login password 'harness_api' in role api;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'worker_login') then
    create role worker_login login password 'harness_worker' bypassrls in role worker;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Migration-verification reads (identity-normalization.integration.ts).
-- That suite pins the build-v3 target against the COEXISTING legacy snapshot
-- (core.*), so the harness worker needs read access to the source schemas.
-- Local coexist DB only — prod has no core.* — and READ ONLY, so this cannot
-- become a write path. Skipped automatically on a pristine build.
-- ----------------------------------------------------------------------------
do $$ begin
  if to_regclass('core.contact_methods') is not null then
    grant usage on schema core to worker;
    grant select on all tables in schema core to worker;
  end if;
end $$;
