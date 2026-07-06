-- =============================================================================
-- 90_rls.sql  (canonical rebuild v2 — RUN AFTER all DDL, BEFORE 99_verify)
--
-- Tenant-isolation RLS for the single `tenant` schema, plus the sealed-schema
-- verification. Retargets the proven build/90_rls.sql from six tenant schemas to
-- one, and adds the red-team XOR-allowlist gate: every `tenant.*` base table must
-- be EITHER (tenant_id-bearing + tenant_isolation FORCE) OR in an explicit
-- allowlist — else FAIL (a table that silently lost its tenant_id can't slip
-- through with neither RLS nor an exception).
--
-- Sealed schemas: umi / runtime / observability get NO tenant_isolation and NO
-- umi_app grant (00_foundation granted USAGE to worker/readonly only; domain
-- files grant DML to umi_worker only). §6c re-verifies umi_app holds ZERO there.
--
-- Idempotent + re-runnable. Consumes the kernel helpers from 00_foundation.
-- =============================================================================

begin;

-- The explicit special-handling allowlist (mirrors the §3/§4 handlers below).
-- Any tenant.* base table NOT here must be a generic tenant_id-scoped table.
--   tenant                 — keys on id (it IS the tenant)
--   tenant_access          — own-membership read + tenant-confined writes
--   login                  — cross-tenant principal, no tenant_id, self_access
--   password_reset_token   — login-keyed, no tenant_id, self_access
--   channel                — GLOBAL reference catalog, no tenant_id

-- ---------------------------------------------------------------------------
-- 1. Role hardening — re-assert the hard invariants every run.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname='umi_app') then
    if exists (select 1 from pg_roles where rolname='umi_app' and (rolsuper or rolbypassrls)) then
      raise exception 'umi_app must NOT be SUPERUSER or BYPASSRLS';
    end if;
  else
    raise exception 'role umi_app not found — 00_foundation must run first';
  end if;
  if exists (select 1 from pg_roles where rolname='umi_worker') then
    alter role umi_worker bypassrls;
  else
    raise exception 'role umi_worker not found — 00_foundation must run first';
  end if;
end $$;

do $$
declare rname text;
begin
  revoke all on function tenant.rls_tenant_check(uuid)  from public;
  revoke all on function tenant.can_access_tenant(uuid) from public;
  foreach rname in array array['umi_app','umi_worker','umi_readonly'] loop
    if exists (select 1 from pg_roles where rolname=rname) then
      execute format(
        'grant execute on function tenant.current_user_id(), tenant.current_tenant_id(), '
        || 'tenant.current_person_id(), tenant.can_access_tenant(uuid), tenant.rls_tenant_check(uuid) to %I',
        rname);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Generic tenant-scoped tables: one canonical `tenant_isolation` FOR ALL
--    policy per tenant_id-bearing table, FORCEd. Excludes the allowlist tables
--    (handled in §3/§4). Nullable tenant_id (none expected today) would read as
--    global — the manifest keeps tenant_id NOT NULL, so this is strict.
-- ---------------------------------------------------------------------------
do $$
declare
  r record; p record; tenant_nullable boolean; using_expr text; check_expr text;
begin
  for r in
    select c.relname as table_name, c.oid as reloid
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname='tenant'
      and c.relname not in ('tenant','tenant_access','login','password_reset_token','channel')
      and exists (select 1 from pg_attribute a
                  where a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped)
  loop
    select not a.attnotnull into tenant_nullable
      from pg_attribute a where a.attrelid=r.reloid and a.attname='tenant_id';
    if tenant_nullable then
      using_expr := '(tenant.rls_tenant_check(tenant_id) or tenant_id is null)';
      check_expr := 'tenant.rls_tenant_check(tenant_id)';
    else
      using_expr := 'tenant.rls_tenant_check(tenant_id)';
      check_expr := 'tenant.rls_tenant_check(tenant_id)';
    end if;
    execute format('alter table tenant.%I enable row level security', r.table_name);
    execute format('alter table tenant.%I force  row level security', r.table_name);
    for p in select polname from pg_policy where polrelid=r.reloid loop
      execute format('drop policy if exists %I on tenant.%I', p.polname, r.table_name);
    end loop;
    execute format('create policy tenant_isolation on tenant.%I for all using (%s) with check (%s)',
                   r.table_name, using_expr, check_expr);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. tenant.channel — GLOBAL reference (no tenant_id). Readable by all (the
--    request path reads it for identity resolution), never writable from the
--    request path. Worker (BYPASSRLS) seeds it.
-- ---------------------------------------------------------------------------
do $$
declare p record;
begin
  if to_regclass('tenant.channel') is not null then
    alter table tenant.channel enable row level security;
    alter table tenant.channel force  row level security;
    for p in select polname from pg_policy where polrelid='tenant.channel'::regclass loop
      execute format('drop policy if exists %I on tenant.channel', p.polname);
    end loop;
    -- read-only for the request path. `for all using(true)` would let umi_app DELETE
    -- the whole global catalog (DELETE is USING-gated, not WITH CHECK). SELECT-only +
    -- an explicit write REVOKE in §5 closes that. Worker (BYPASSRLS) seeds it.
    create policy global_catalog_read on tenant.channel for select using (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Identity / special-access tables.
-- ---------------------------------------------------------------------------
-- 4a. tenant.tenant — keys on id.
alter table tenant.tenant enable row level security;
alter table tenant.tenant force  row level security;
do $$ declare p record; begin
  for p in select polname from pg_policy where polrelid='tenant.tenant'::regclass loop
    execute format('drop policy if exists %I on tenant.tenant', p.polname); end loop;
end $$;
create policy tenant_isolation on tenant.tenant for all
  using  (id = tenant.current_tenant_id() and tenant.can_access_tenant(id))
  with check (id = tenant.current_tenant_id() and tenant.can_access_tenant(id));

-- 4b. tenant.tenant_access — a principal reads their OWN memberships (tenant
--     discovery) even before an active tenant is chosen; writes tenant-confined.
alter table tenant.tenant_access enable row level security;
alter table tenant.tenant_access force  row level security;
do $$ declare p record; begin
  for p in select polname from pg_policy where polrelid='tenant.tenant_access'::regclass loop
    execute format('drop policy if exists %I on tenant.tenant_access', p.polname); end loop;
end $$;
create policy tenant_isolation on tenant.tenant_access for all
  using  (login_id = tenant.current_user_id() or tenant.rls_tenant_check(tenant_id))
  with check (tenant.rls_tenant_check(tenant_id));

-- 4c. tenant.login — cross-tenant principal, no tenant_id. Self-access only;
--     password_* re-REVOKEd in §5.
alter table tenant.login enable row level security;
alter table tenant.login force  row level security;
do $$ declare p record; begin
  for p in select polname from pg_policy where polrelid='tenant.login'::regclass loop
    execute format('drop policy if exists %I on tenant.login', p.polname); end loop;
end $$;
create policy self_access on tenant.login for all
  using  (id = tenant.current_user_id()) with check (id = tenant.current_user_id());

-- 4d. tenant.password_reset_token — login-keyed, no tenant_id, secret token_hash.
do $$ declare p record; begin
  if to_regclass('tenant.password_reset_token') is not null then
    alter table tenant.password_reset_token enable row level security;
    alter table tenant.password_reset_token force  row level security;
    for p in select polname from pg_policy where polrelid='tenant.password_reset_token'::regclass loop
      execute format('drop policy if exists %I on tenant.password_reset_token', p.polname); end loop;
    create policy self_access on tenant.password_reset_token for all
      using  (login_id = tenant.current_user_id()) with check (login_id = tenant.current_user_id());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Request-role base privileges on `tenant`, then RE-ASSERT secret seals.
-- ---------------------------------------------------------------------------
grant usage on schema tenant to umi_app;
grant select, insert, update, delete on all tables in schema tenant to umi_app;
alter default privileges in schema tenant grant select, insert, update, delete on tables to umi_app;

-- channel is a GLOBAL read-only catalog for the request path — strip the write
-- grants the blanket grant just handed umi_app (the SELECT-only policy blocks
-- INSERT/UPDATE, but DELETE is USING-gated). Worker seeds/maintains it.
revoke insert, update, delete on tenant.channel from umi_app, public;

-- 5a. login password columns — never readable/writable by umi_app.
revoke all on tenant.login from umi_app, public;
revoke all (password_salt, password_hash, password_algorithm) on tenant.login from umi_app, public;
grant select (id, auth_subject, email, phone, display_name, contact_id, status, created_at, updated_at)
  on tenant.login to umi_app;
grant update (email, phone, display_name, status, updated_at) on tenant.login to umi_app;

-- 5b. integration_token — OAuth secrets, worker only.
do $$ begin
  if to_regclass('tenant.integration_token') is not null then
    revoke all on tenant.integration_token from umi_app, public;
    grant select, insert, update, delete on tenant.integration_token to umi_worker;
  end if;
end $$;

-- 5c. password_reset_token — token_hash sensitive, worker mints/consumes.
do $$ begin
  if to_regclass('tenant.password_reset_token') is not null then
    revoke all on tenant.password_reset_token from umi_app, public;
    grant select, insert, update, delete on tenant.password_reset_token to umi_worker;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- 6. Self-verifying gate (fails closed).
-- ---------------------------------------------------------------------------

-- 6a. Check #2 — every tenant.* base table has RLS + FORCE.
do $$
declare missing int; detail text;
begin
  select count(*), string_agg(c.relname, ', ' order by c.relname) into missing, detail
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and n.nspname='tenant'
    and (not c.relrowsecurity or not c.relforcerowsecurity);
  if missing>0 then
    raise exception 'RLS gate #2 FAILED: % tenant.* table(s) lack ENABLE+FORCE: %', missing, detail;
  end if;
  raise notice 'RLS gate #2 passed: every tenant.* base table has RLS+FORCE.';
end $$;

-- 6b. Check #3 — every RLS-enabled tenant.* table has a policy.
do $$
declare missing int; detail text;
begin
  select count(*), string_agg(c.relname, ', ' order by c.relname) into missing, detail
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and n.nspname='tenant' and c.relrowsecurity
    and not exists (select 1 from pg_policy p where p.polrelid=c.oid);
  if missing>0 then
    raise exception 'RLS gate #3 FAILED: % tenant.* RLS table(s) have no policy: %', missing, detail;
  end if;
  raise notice 'RLS gate #3 passed: every RLS tenant.* table has a policy.';
end $$;

-- 6c. RED-TEAM XOR-ALLOWLIST — every tenant.* base table is EITHER
--     (tenant_id-bearing AND carries tenant_isolation) OR in the explicit
--     allowlist. A table that silently lost its tenant_id (and is not allowlisted)
--     FAILS here rather than slipping through with neither RLS nor an exception.
do $$
declare bad int; detail text;
begin
  select count(*), string_agg(c.relname, ', ' order by c.relname) into bad, detail
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and n.nspname='tenant'
    and c.relname not in ('tenant','tenant_access','login','password_reset_token','channel')
    and not (
      exists (select 1 from pg_attribute a
              where a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped)
      and exists (select 1 from pg_policy p where p.polrelid=c.oid and p.polname='tenant_isolation')
    );
  if bad>0 then
    raise exception
      'RLS gate XOR FAILED: % tenant.* table(s) are neither (tenant_id+tenant_isolation) nor allowlisted: %',
      bad, detail;
  end if;
  raise notice 'RLS gate XOR passed: every tenant.* table is tenant-isolated or explicitly allowlisted.';
end $$;

-- 6d. Sealed schemas: umi_app must hold ZERO privileges on umi/runtime/observability.
do $$
declare leaked int; detail text;
begin
  select count(*), string_agg(format('%s.%s [%s]', table_schema, table_name, privilege_type), ', ')
    into leaked, detail
  from information_schema.role_table_grants
  where grantee='umi_app' and table_schema in ('umi','runtime','observability');
  if leaked>0 then
    raise exception 'RLS gate FAILED: umi_app must have NO grants on sealed schemas, found: %', detail;
  end if;
  raise notice 'RLS gate passed: umi_app holds no privileges on umi/runtime/observability.';
end $$;

-- 6e. Secret seal: umi_app holds no privilege on secret columns/tables.
do $$
declare leaked int; detail text;
begin
  select count(*), string_agg(format('%s.%s.%s', table_schema, table_name, column_name), ', ')
    into leaked, detail
  from information_schema.column_privileges
  where grantee='umi_app' and table_schema='tenant'
    and ( (table_name='login' and column_name in ('password_salt','password_hash','password_algorithm'))
       or table_name in ('integration_token','password_reset_token') );
  if leaked>0 then
    raise exception 'RLS gate FAILED: umi_app retains privilege on secret column(s): %', detail;
  end if;
  raise notice 'RLS gate passed: secret columns/tables sealed from umi_app.';
end $$;
