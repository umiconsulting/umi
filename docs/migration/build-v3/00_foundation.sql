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
