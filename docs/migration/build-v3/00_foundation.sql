-- ============================================================================
-- build-v3 · 00_foundation  — run FIRST
-- Roles, schemas, extensions, shared functions.
-- ============================================================================

-- Roles (cluster-global; no 'umi_' prefix). Load-bearing distinction:
--   api      = request path, RLS-ENFORCED (no bypass)
--   worker   = background jobs, BYPASSRLS (cross-tenant machinery)
--   readonly = reporting / diagnostics
do $$
begin
  if not exists (select 1 from pg_roles where rolname='api')      then create role api      nologin;            end if;
  if not exists (select 1 from pg_roles where rolname='worker')   then create role worker   nologin bypassrls;  end if;
  if not exists (select 1 from pg_roles where rolname='readonly') then create role readonly nologin;            end if;
end $$;

-- Schemas
create schema if not exists umi;
create schema if not exists tenant;
create schema if not exists runtime;

-- Extensions (own schema, matches Supabase layout)
create schema if not exists extensions;
create extension if not exists vector schema extensions;   -- pgvector -> runtime.*_embedding
-- gen_random_uuid() is core in PG13+ (pg_catalog); no extension needed.

-- Shared: touch updated_at (attached to every updated_at table in 60_triggers)
create or replace function public.tg_touch_updated_at() returns trigger
  language plpgsql
  set search_path = pg_catalog as $$   -- pinned: no writable schema on the path
begin
  new.updated_at = now();
  return new;
end $$;

-- Shared: phone / identity normalization. IMMUTABLE, byte-for-byte identical to prod
-- core.normalize_phone so the resolver unifies exactly what the backfill unified.
-- MX-first: treat numbers as Mexican mobile and key on the last 10 local digits (+52).
-- The identity model is FLAT (tenant.contact carries channel_id + normalized_value);
-- per-channel dispatch lives HERE, in the function, not in a umi.channel_type column.
create or replace function tenant.normalize_phone(p_phone text) returns text
  language sql immutable
  set search_path = pg_catalog as $$
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
    -- already-international non-MX (E.164 length 11..15) -> keep as +<digits>
    when length(d) between 11 and 15           then '+' || d
    else null
  end
  from digits;
$$;

-- Per-channel normalization dispatch. phone-family -> E.164; email -> lowercased;
-- everything else -> trimmed raw (NULL when empty). Called by identity.resolver.
create or replace function tenant.normalize_identity(p_channel text, p_value text) returns text
  language sql immutable
  set search_path = pg_catalog as $$
  select case
    when p_value is null or btrim(p_value) = '' then null
    when p_channel in ('phone', 'whatsapp', 'sms')  then tenant.normalize_phone(p_value)
    when p_channel = 'email'                         then lower(btrim(p_value))
    else nullif(btrim(p_value), '')
  end;
$$;
