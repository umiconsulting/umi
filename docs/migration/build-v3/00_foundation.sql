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

-- Shared: E.164 normalization. IMMUTABLE, twelve lines, proven against every row we
-- have (BACKFILL_METHODOLOGY L15).
--
-- ⚠️ This deliberately does NOT reproduce prod `core.normalize_phone`. That function
-- (and customers.service.ts) carry an identical FATAL branch —
--   length(d)=11 AND left(d,1)='1' -> '+52'||right(d,10)
-- — which strips the `+` BEFORE deciding the country, so a real NANP number
-- (+1 480 401 6182) is rewritten into a Mexican number that belongs to nobody.
-- Country code 1 is structurally unreachable there. THE RULE: never prepend a country
-- code to a string that already carries a `+`; decide on had_plus BEFORE stripping.
--
-- Pinned to the DATA, not to prose (L15): over all 458 prod contact rows this leaves
-- 453 unchanged, repairs 4 NANP rows to their true +1 numbers, and NULLs exactly ONE
-- number — Mayela's `+5266748626`, which is +52 plus only EIGHT national digits and is
-- not anyone's number. A stricter prose-following reading would NULL five and strand
-- four customers who each hold a live wallet pass. See O-3 for her by-hand repair and
-- the raw_value registration fallback that keeps her findable meanwhile.
create or replace function umi.e164(p_raw text) returns text
  language sql immutable
  set search_path = pg_catalog as $$
  with s as (select btrim(coalesce(p_raw, '')) as raw),
       d as (select (left(raw, 1) = '+') as had_plus,
                    regexp_replace(raw, '[^0-9]', '', 'g') as dg
               from s)
  select case
    when dg = '' then null
    -- the string already declares a country code: never prepend another one
    when had_plus then case
      when length(dg) = 13 and left(dg, 3) = '521' then '+52' || right(dg, 10)  -- MX mobile legacy 1
      when length(dg) = 12 and left(dg, 2) = '52'  then '+52' || right(dg, 10)
      when length(dg) between 11 and 15            then '+'  || dg              -- foreign (+1 …) KEPT
      else null end                                                             -- '+' with <11 digits = incomplete
    -- no '+': national/local input, Mexican café default
    when length(dg) = 10                         then '+52' || dg
    when length(dg) = 11 and left(dg, 1) = '1'   then '+52' || right(dg, 10)
    when length(dg) = 12 and left(dg, 2) = '52'  then '+52' || right(dg, 10)
    when length(dg) = 13 and left(dg, 3) = '521' then '+52' || right(dg, 10)
    when left(dg, 1) = '0' and length(dg) > 10   then '+52' || right(dg, 10)
    when length(dg) between 11 and 15            then '+'  || dg
    else null
  end
  from d;
$$;

-- Compatibility wrapper: the canonical implementation is umi.e164 (single source).
create or replace function tenant.normalize_phone(p_phone text) returns text
  language sql immutable
  set search_path = pg_catalog as $$ select umi.e164(p_phone) $$;

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
