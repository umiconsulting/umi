-- =============================================================================
-- 00_foundation.sql  (canonical rebuild v2 — RUN ORDER POSITION 1, runs FIRST)
--
-- The kernel every domain author builds on. Rebuilds the platform DB to the
-- 4-schema authorship model (docs/architecture/2026-07-05-platform-domain-model-
-- synthesis.md): `umi` (Umi's business, sealed), `tenant` (the restaurant's
-- business, RLS), `runtime` (machinery, sealed), `observability` (telemetry,
-- sealed). Plus support: legacy, _migration, extensions.
--
-- Changes vs the current build/00_foundation.sql (red-team fixes baked in):
--   * 4 schemas, not 9 (six tenant schemas collapse into `tenant`).
--   * per-CHANNEL normalizer `tenant.normalize_identity(channel, value)` replaces
--     the single `normalize_phone` (email/phone/... normalize differently).
--   * NO `resolve_contact` SECURITY DEFINER RPC (bypass-RLS hole; a TS resolver
--     writes tenant.contact/contact_identity deterministically instead).
--   * helpers live in `tenant.*`.
--
-- Target: PostgreSQL 18, local smoke build, port 5233. Idempotent + re-runnable.
-- =============================================================================

begin;

-- Kernel defines a SECURITY DEFINER helper (can_access_tenant) that forward-
-- references tenant.tenant_access created later in 11_tenant_core.sql. Defer body
-- validation so the kernel installs without a chicken-and-egg failure.
set local check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 0. Decisive teardown of the OLD 9-schema layout (no-op on a fresh smoke DB;
--    the hard reset for a live rebuild). `legacy`/`_migration`/`extensions` stay.
-- ---------------------------------------------------------------------------
drop schema if exists core, loyalty, ops, comms, device, kitchen, queue, grow cascade;

-- ---------------------------------------------------------------------------
-- 1. Extensions. pgcrypto + uuid-ossp default; vector + pg_trgm in `extensions`.
-- ---------------------------------------------------------------------------
create schema if not exists extensions;
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create extension if not exists vector  with schema extensions;
create extension if not exists pg_trgm with schema extensions;
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 2. Canonical + support schemas (the 4-schema authorship model).
-- ---------------------------------------------------------------------------
create schema if not exists umi;            -- Umi's own business (sealed from app)
create schema if not exists tenant;         -- the restaurant's business (RLS)
create schema if not exists runtime;        -- machinery (sealed)
create schema if not exists observability;  -- telemetry (sealed, until OTel)
create schema if not exists legacy;         -- stable_uuid + provenance
create schema if not exists _migration;     -- run logs + id maps

-- ---------------------------------------------------------------------------
-- 3. Roles (unchanged model): umi_app (RLS request role, NEVER bypassrls),
--    umi_worker (BYPASSRLS service), umi_readonly (analytics).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'umi_app') then
    create role umi_app noinherit nosuperuser nobypassrls nologin;
  end if;
  alter role umi_app nosuperuser nobypassrls;

  if not exists (select 1 from pg_roles where rolname = 'umi_worker') then
    create role umi_worker noinherit nologin;
  end if;
  alter role umi_worker bypassrls;

  if not exists (select 1 from pg_roles where rolname = 'umi_readonly') then
    create role umi_readonly noinherit nologin;
  end if;
end $$;

do $$
begin
  execute format('grant umi_app to %I',      current_user);
  execute format('grant umi_worker to %I',   current_user);
  execute format('grant umi_readonly to %I', current_user);
end $$;

-- Baseline schema usage. `tenant` + `extensions` are request-reachable (all three
-- roles). `umi`/`runtime`/`observability`/legacy/_migration are SEALED: worker +
-- readonly only — NEVER umi_app (this is the load-bearing seal 90_rls re-verifies).
grant usage on schema tenant, extensions
  to umi_app, umi_worker, umi_readonly;
grant usage on schema umi, runtime, observability, legacy, _migration
  to umi_worker, umi_readonly;

-- ---------------------------------------------------------------------------
-- 4. legacy.stable_uuid(text) -> uuid. Deterministic PK minting for migrated rows.
-- ---------------------------------------------------------------------------
create or replace function legacy.stable_uuid(p_seed text)
returns uuid language sql immutable as $$
  select (
    substr(md5(p_seed), 1, 8)  || '-' || substr(md5(p_seed), 9, 4)  || '-' ||
    substr(md5(p_seed), 13, 4) || '-' || substr(md5(p_seed), 17, 4) || '-' ||
    substr(md5(p_seed), 21, 12)
  )::uuid;
$$;

-- ---------------------------------------------------------------------------
-- 5. Per-CHANNEL normalizer (red-team fix). Different issuers normalize
--    differently: phone/whatsapp -> E.164 (Mexico-aware), email -> lowercased,
--    everything else -> trimmed. Returns NULL when a phone can't be parsed (so a
--    NULL never collides into one dedup bucket). Called by the TS identity
--    resolver and by any optional backfill so both derive identical keys.
-- ---------------------------------------------------------------------------
create or replace function tenant.normalize_phone(p_phone text)
returns text language sql immutable as $$
  with digits as (
    select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d
  )
  select case
    when d = '' then null
    when length(d) = 10                        then '+52' || d
    when length(d) = 11 and left(d, 1) = '1'   then '+52' || right(d, 10)
    when length(d) = 12 and left(d, 2) = '52'  then '+52' || right(d, 10)
    when length(d) = 13 and left(d, 3) = '521' then '+52' || right(d, 10)
    when left(d, 1) = '0' and length(d) > 10   then '+52' || right(d, 10)
    when length(d) between 11 and 15           then '+' || d
    else null
  end
  from digits;
$$;

create or replace function tenant.normalize_identity(p_channel text, p_value text)
returns text language sql immutable as $$
  select case
    when p_value is null then null
    when p_channel in ('phone', 'whatsapp', 'sms')
      then tenant.normalize_phone(p_value)
    when p_channel = 'email'
      then nullif(lower(btrim(p_value)), '')
    else nullif(btrim(p_value), '')
  end;
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS tenant-context helpers + canonical predicate (in `tenant`).
--    Per request the app sets: app.user_id (login), app.tenant_id (active tenant),
--    app.person_id (customer flows).
-- ---------------------------------------------------------------------------
create or replace function tenant.current_user_id()
returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;
create or replace function tenant.current_tenant_id()
returns uuid language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;
create or replace function tenant.current_person_id()
returns uuid language sql stable as $$
  select nullif(current_setting('app.person_id', true), '')::uuid
$$;

-- Active member of the target tenant? SECURITY DEFINER (owned by umi_worker) so it
-- can read tenant_access under the caller's own RLS.
create or replace function tenant.can_access_tenant(target_tenant_id uuid)
returns boolean language sql stable security definer
set search_path = tenant, pg_temp as $$
  select target_tenant_id is not null and exists (
    select 1 from tenant.tenant_access ta
    where ta.login_id = tenant.current_user_id()
      and ta.status   = 'active'
      and (
        ta.tenant_id = target_tenant_id     -- explicit edge in this tenant
        or ta.role   = 'super_admin'         -- global super_admin: any tenant (hola@)
      )
  )
$$;

-- The single canonical RLS predicate (both layers, default-deny).
create or replace function tenant.rls_tenant_check(row_tenant_id uuid)
returns boolean language sql stable as $$
  select row_tenant_id is not null
     and row_tenant_id = tenant.current_tenant_id()
     and tenant.can_access_tenant(tenant.current_tenant_id())
$$;

revoke all on function tenant.rls_tenant_check(uuid)  from public;
revoke all on function tenant.can_access_tenant(uuid) from public;

-- ---------------------------------------------------------------------------
-- 7. Append-only trigger fn. Attached (by the loyalty author) to EXACTLY two
--    ledgers: tenant.card_ledger, tenant.gift_card_ledger. Trigger names MUST
--    contain 'append_only' (gate check #4 expects 2).
-- ---------------------------------------------------------------------------
create or replace function tenant.block_append_only_mutation()
returns trigger language plpgsql as $$
begin
  -- Controlled bypass for maintenance / erasure / tenant-teardown — and for the
  -- FK delete actions (ON DELETE CASCADE from card/gift_card, ON DELETE SET NULL
  -- of staff_id) that would otherwise be blocked, making staff/card/tenant
  -- deletes fail once ledger rows exist. A caller that legitimately needs to
  -- remove or rewrite ledger rows opts in inside its transaction with:
  --     set local app.ledger_maintenance = 'on';
  -- Normal application writes never set it, so the ledgers stay insert-only
  -- (the RLS/verify smoke test injects a mutation without the flag and still
  -- gets blocked). missing_ok = true so an unset GUC reads as NULL, not error.
  if current_setting('app.ledger_maintenance', true) = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  raise exception
    'append-only violation: % on %.% is forbidden (financial ledger is insert-only)',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. _migration: phase run log + id-map surface (for the optional P2 backfill).
-- ---------------------------------------------------------------------------
create table if not exists _migration.phase_runs (
  id          uuid primary key default gen_random_uuid(),
  phase       text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  metadata    jsonb not null default '{}'::jsonb
);
create index if not exists migration_phase_runs_phase_idx
  on _migration.phase_runs (phase, started_at desc);

do $$
declare
  m text;
  maps text[] := array[
    'tenant_map','contact_map','customer_map','login_map','card_map',
    'session_map','message_map','order_map','conversation_map'
  ];
begin
  foreach m in array maps loop
    execute format($f$
      create table if not exists _migration.%I (
        old_id        text not null,
        new_id        uuid not null,
        source_system text not null,
        created_at    timestamptz not null default now(),
        primary key (source_system, old_id)
      )
    $f$, m);
    execute format(
      'create index if not exists migration_%1$s_new_id_idx on _migration.%1$s (new_id)', m);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Ownership + execute grants. The cross-tenant SECURITY DEFINER fn MUST be
--    owned by a BYPASSRLS role (umi_worker) or FORCE RLS starves it of rows.
-- ---------------------------------------------------------------------------
alter function tenant.can_access_tenant(uuid) owner to umi_worker;

grant execute on function
    tenant.current_user_id(), tenant.current_tenant_id(), tenant.current_person_id(),
    tenant.can_access_tenant(uuid), tenant.rls_tenant_check(uuid),
    tenant.normalize_phone(text), tenant.normalize_identity(text, text)
  to umi_app, umi_worker, umi_readonly;

grant select on all tables in schema _migration to umi_worker, umi_readonly;
grant insert, update, delete on all tables in schema _migration to umi_worker;
alter default privileges in schema _migration grant select on tables to umi_worker, umi_readonly;
alter default privileges in schema _migration grant insert, update, delete on tables to umi_worker;

commit;

-- =============================================================================
-- KERNEL CONTRACT (consumed by all domain authors)
--   legacy.stable_uuid(text) -> uuid
--   tenant.normalize_phone(text) -> text
--   tenant.normalize_identity(channel text, value text) -> text   -- per-channel (G4)
--   tenant.current_user_id()/current_tenant_id()/current_person_id() -> uuid
--   tenant.can_access_tenant(uuid) -> bool   -- SECURITY DEFINER (umi_worker)
--   tenant.rls_tenant_check(uuid)  -> bool   -- canonical RLS predicate
--   tenant.block_append_only_mutation() -> trigger  -- attach to the 2 ledgers
-- Composite tenant isolation: PK (tenant_id, id); FKs inline
--   `foreign key (tenant_id, <fk>) references tenant.<parent> (tenant_id, id)`.
-- NO resolve_contact RPC — the TS identity resolver writes contact/contact_identity.
-- Schemas: umi/runtime/observability are SEALED (worker only); tenant is RLS.
-- =============================================================================
