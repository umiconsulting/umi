-- 050_rls_tenant_isolation.sql
-- Umi — Tenant-isolation Row-Level Security. Closes integrity gaps G1 + G2
-- (docs/migration/2026-06-16-database-integrity-spec.md — the source of truth).
--
-- What this fixes vs. the prior state:
--   * 001_platform_core.sql defined FOR SELECT-only membership policies on
--     platform.* and never set FORCE  -> the table owner bypassed RLS and all
--     writes had zero RLS isolation.
--   * migration-plan §5.7 ran ENABLE ROW LEVEL SECURITY on
--     cash/commerce/comms/device/kitchen but defined NO policies at all
--     (deny-all for the request role, or no isolation if a privileged role
--     connects).
--   * platform/core was excluded from §5.7's loop (G2).
--
-- Tenant-context contract (the app MUST set BOTH, per request, with `set local`):
--   app.user_id   = the authenticated principal (platform.users.id)
--   app.tenant_id = the single active tenant for this request
-- The DB derives access from real memberships, so the app cannot scope itself
-- into a tenant the principal does not belong to. Both layers are required:
-- the row's tenant must equal the active tenant AND the principal must be an
-- active member of it.
--
-- Role model (enforced/asserted below):
--   umi_app      = request role. RLS-enforced (FORCE). MUST NOT be SUPERUSER/BYPASSRLS.
--   umi_worker   = background/service jobs. BYPASSRLS (runs cross-tenant by design).
--   umi_readonly = left RLS-subject; grant BYPASSRLS separately only for internal analytics.
--
-- Idempotent and re-runnable. Schema names are physical/pre-Phase-G
-- (platform/cash/commerce/comms/device/kitchen). The Phase G catalog rename
-- (platform->core, cash->loyalty, commerce->ops) carries policies and functions
-- over automatically — policy expressions are stored as parsed nodes bound to
-- the function OID, so they survive ALTER SCHEMA ... RENAME.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tenant-context helper functions
-- ---------------------------------------------------------------------------
create or replace function platform.current_user_id()
returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function platform.current_tenant_id()
returns uuid language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

-- Is the current principal an ACTIVE member of the target tenant?
-- SECURITY DEFINER so the check can read memberships even while the caller's
-- own RLS would otherwise hide them.
create or replace function platform.can_access_tenant(target_tenant_id uuid)
returns boolean language sql stable security definer
set search_path = platform, pg_temp as $$
  select target_tenant_id is not null and exists (
    select 1
    from platform.tenant_memberships tm
    where tm.tenant_id = target_tenant_id
      and tm.user_id = platform.current_user_id()
      and tm.status = 'active'
  )
$$;

-- The single canonical RLS predicate. Written so the membership lookup is
-- evaluated once per query (against the constant active tenant), not per row.
create or replace function platform.rls_tenant_check(row_tenant_id uuid)
returns boolean language sql stable as $$
  select row_tenant_id is not null
     and row_tenant_id = platform.current_tenant_id()
     and platform.can_access_tenant(platform.current_tenant_id())
$$;

revoke all on function platform.rls_tenant_check(uuid) from public;

-- ---------------------------------------------------------------------------
-- 2. Role hardening (directly closes the "service_role bypasses RLS" concern)
-- ---------------------------------------------------------------------------
do $$
declare rname text;
begin
  -- Hard gate: the request role may never be able to bypass RLS.
  if exists (select 1 from pg_roles where rolname = 'umi_app') then
    if exists (select 1 from pg_roles
               where rolname = 'umi_app' and (rolsuper or rolbypassrls)) then
      raise exception
        'umi_app must NOT be SUPERUSER or BYPASSRLS — it is the RLS-enforced request role';
    end if;
  else
    raise notice
      'role umi_app not found; create it (NOINHERIT, non-superuser, non-bypassrls) before serving traffic';
  end if;

  -- Workers intentionally run cross-tenant.
  if exists (select 1 from pg_roles where rolname = 'umi_worker') then
    execute 'alter role umi_worker bypassrls';
  end if;

  -- Function execute grants for the request/worker roles that actually exist.
  foreach rname in array array['umi_app','umi_worker','umi_readonly'] loop
    if exists (select 1 from pg_roles where rolname = rname) then
      execute format(
        'grant execute on function platform.current_user_id(), platform.current_tenant_id(), '
        || 'platform.can_access_tenant(uuid), platform.rls_tenant_check(uuid) to %I', rname);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Generic tenant-scoped tables: one tenant_isolation policy per table,
--    across all six tenant schemas, covering EVERY command (FOR ALL),
--    with FORCE so the owner is subject too.
--    NOT-NULL tenant_id  -> strict on read and write.
--    NULLABLE tenant_id  -> global (NULL) rows readable by all; writes still
--                           confined to the active tenant (matches 001's
--                           external_refs precedent).
--    Explicitly-handled identity tables (users/tenants/tenant_memberships) are
--    excluded here and handled in §4.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  p record;
  tenant_nullable boolean;
  using_expr text;
  check_expr  text;
begin
  for r in
    select n.nspname as schema_name, c.relname as table_name, c.oid as reloid
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r'
      and n.nspname in ('platform','cash','commerce','comms','device','kitchen')
      and not (n.nspname = 'platform'
               and c.relname in ('users','tenants','tenant_memberships'))
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      )
  loop
    select not a.attnotnull into tenant_nullable
    from pg_attribute a where a.attrelid = r.reloid and a.attname = 'tenant_id';

    if tenant_nullable then
      -- NULL tenant = global/shared catalog row: readable by all, but writes
      -- still confined to the active tenant.
      using_expr := '(platform.rls_tenant_check(tenant_id) or tenant_id is null)';
      check_expr := 'platform.rls_tenant_check(tenant_id)';
    else
      using_expr := 'platform.rls_tenant_check(tenant_id)';
      check_expr := 'platform.rls_tenant_check(tenant_id)';
    end if;

    execute format('alter table %I.%I enable row level security', r.schema_name, r.table_name);
    execute format('alter table %I.%I force  row level security', r.schema_name, r.table_name);

    -- Replace ANY pre-existing policy (e.g. 001's tenant_member_select_*) so
    -- tenant_isolation is the single, canonical, all-command policy.
    for p in select polname from pg_policy where polrelid = r.reloid loop
      execute format('drop policy if exists %I on %I.%I', p.polname, r.schema_name, r.table_name);
    end loop;

    execute format(
      'create policy tenant_isolation on %I.%I for all using (%s) with check (%s)',
      r.schema_name, r.table_name, using_expr, check_expr);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Identity tables that are NOT plain tenant-scoped
-- ---------------------------------------------------------------------------

-- 4a. platform.tenants — the tenant row itself keys on id, not tenant_id.
alter table platform.tenants enable row level security;
alter table platform.tenants force  row level security;
do $$
declare p record;
begin
  for p in select polname from pg_policy where polrelid = 'platform.tenants'::regclass loop
    execute format('drop policy if exists %I on platform.tenants', p.polname);
  end loop;
end $$;
create policy tenant_isolation on platform.tenants
  for all
  using  (id = platform.current_tenant_id() and platform.can_access_tenant(id))
  with check (id = platform.current_tenant_id() and platform.can_access_tenant(id));

-- 4b. platform.tenant_memberships — a principal must read their OWN memberships
--     (tenant discovery: "which tenants am I in?") even before an active tenant
--     is chosen; tenant admins additionally see all memberships in the active
--     tenant. Writes confined to the active tenant.
alter table platform.tenant_memberships enable row level security;
alter table platform.tenant_memberships force  row level security;
do $$
declare p record;
begin
  for p in select polname from pg_policy where polrelid = 'platform.tenant_memberships'::regclass loop
    execute format('drop policy if exists %I on platform.tenant_memberships', p.polname);
  end loop;
end $$;
create policy tenant_isolation on platform.tenant_memberships
  for all
  using  (user_id = platform.current_user_id()
          or platform.rls_tenant_check(tenant_id))
  with check (platform.rls_tenant_check(tenant_id));

-- 4c. platform.users — login principals, no tenant_id. A user sees/edits only
--     their own row; everything else is service/worker (BYPASSRLS) territory.
alter table platform.users enable row level security;
alter table platform.users force  row level security;
do $$
declare p record;
begin
  for p in select polname from pg_policy where polrelid = 'platform.users'::regclass loop
    execute format('drop policy if exists %I on platform.users', p.polname);
  end loop;
end $$;
create policy self_access on platform.users
  for all
  using  (id = platform.current_user_id())
  with check (id = platform.current_user_id());

-- ---------------------------------------------------------------------------
-- 5. Table privileges for the request role (RLS scopes the rows; the role
--    still needs base privileges to touch the tables at all).
-- ---------------------------------------------------------------------------
do $$
declare s text;
begin
  if exists (select 1 from pg_roles where rolname = 'umi_app') then
    foreach s in array array['platform','cash','commerce','comms','device','kitchen'] loop
      execute format('grant usage on schema %I to umi_app', s);
      execute format('grant select, insert, update, delete on all tables in schema %I to umi_app', s);
      execute format('alter default privileges in schema %I '
                     || 'grant select, insert, update, delete on tables to umi_app', s);
    end loop;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- 6. Self-verifying gate. Fails the migration if any tenant-scoped table in the
--    six schemas lacks RLS + FORCE + a policy. This IS integrity-gate checks
--    2 and 3 from the integrity spec, asserted in-line.
-- ---------------------------------------------------------------------------
do $$
declare missing int;
begin
  select count(*) into missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r'
    and n.nspname in ('platform','cash','commerce','comms','device','kitchen')
    and exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
    and (not c.relrowsecurity
         or not c.relforcerowsecurity
         or not exists (select 1 from pg_policy p where p.polrelid = c.oid));
  if missing > 0 then
    raise exception
      'RLS gate failed: % tenant-scoped table(s) lack RLS + FORCE + policy', missing;
  end if;
  raise notice 'RLS tenant-isolation gate passed: all tenant-scoped tables protected.';
end $$;

-- ===========================================================================
-- CALLER CONTRACT — read before wiring the backend
-- ===========================================================================
-- 1. The app's request path connects as umi_app (NOINHERIT, non-superuser,
--    non-bypassrls) and runs, inside the request transaction:
--        set local app.user_id   = '<authenticated user uuid>';
--        set local app.tenant_id = '<active tenant uuid>';
--    Omitting either => zero rows (default-deny). This is correct.
--
-- 2. Customer-facing flows with no logged-in dashboard user (e.g. the Cash
--    wallet used by the customer) go through SECURITY DEFINER RPCs executed by
--    a service identity — they do not rely on umi_app RLS.
--
-- 3. SECURITY DEFINER service functions that must operate cross-tenant
--    (resolve_contact, award_points, job workers) MUST be owned by a BYPASSRLS
--    role (e.g. umi_worker) — otherwise FORCE row level security will subject
--    them to the caller-less GUCs and they will see nothing. Verify ownership
--    after creating such functions.
--
-- ROLLBACK (development only — never on production data):
--   do $$ declare r record; begin
--     for r in select schemaname, tablename from pg_policies
--       where policyname in ('tenant_isolation','self_access')
--         and schemaname in ('platform','cash','commerce','comms','device','kitchen')
--     loop
--       execute format('drop policy if exists %I on %I.%I',
--                      'tenant_isolation', r.schemaname, r.tablename);
--       execute format('drop policy if exists %I on %I.%I',
--                      'self_access', r.schemaname, r.tablename);
--       execute format('alter table %I.%I no force row level security',
--                      r.schemaname, r.tablename);
--     end loop;
--   end $$;
