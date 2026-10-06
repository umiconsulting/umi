-- Branch resolution Phase 2 — owner-curated aliases + descriptor + a pg_trgm
-- fuzzy "second vote" for branch matching.
--
-- ADDITIVE + DORMANT: only the branch-selection path (set_branch, invoked for a
-- multi-branch tenant while a customer is choosing) reads these columns. The
-- per-turn hot path (OrderLocationResolver → listActiveLocationsWorker) does NOT.
-- Apply BEFORE deploying the Phase 2 matching code (owner-gated). Extensions live
-- in the `extensions` schema on this platform.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

alter table core.locations
  add column if not exists aliases text[] not null default '{}',
  add column if not exists descriptor text;

-- IMMUTABILITY / INLINING NOTE (verified against prod PG17 on apply):
-- On this platform BOTH extensions.unaccent(regdictionary, text) AND
-- array_to_string(anyarray, text) are STABLE, not immutable. A LANGUAGE sql
-- function is INLINED into the generated-column / index expression below, which
-- exposes that stability and makes the expression non-immutable (ERROR 42P17:
-- "generation expression is not immutable"). A LANGUAGE plpgsql function is never
-- inlined, so its DECLARED immutability is trusted. Bodies stay fully
-- schema-qualified — do NOT add `SET search_path`, which would itself defeat
-- immutability for a generated column.

-- Accent-stripping wrapper. Also used at query time by matchBranchCandidates
-- (word_similarity(core.f_unaccent(lower($1)), search_text)).
create or replace function core.f_unaccent(text)
  returns text
  language plpgsql
  immutable
  strict
  parallel safe
as $$
begin
  return extensions.unaccent('extensions.unaccent'::regdictionary, $1);
end;
$$;

-- The whole search_text normalization in ONE immutable boundary (see note above):
-- accent-stripped, lowercased "name + aliases", so a trigram match covers both the
-- branch name and its owner-curated nicknames ("chapu").
create or replace function core.f_location_search_text(p_name text, p_aliases text[])
  returns text
  language plpgsql
  immutable
  parallel safe
as $$
begin
  return lower(core.f_unaccent(
    coalesce(p_name, '') || ' ' || coalesce(array_to_string(p_aliases, ' '), '')
  ));
end;
$$;

alter table core.locations
  add column if not exists search_text text
  generated always as (core.f_location_search_text(name, aliases)) stored;

-- CONCURRENTLY avoids a write-blocking ACCESS EXCLUSIVE lock on core.locations
-- (read on the per-turn hot path). It must run OUTSIDE a transaction block, so
-- apply this file via psql/direct connection in autocommit, not a wrapped txn.
create index concurrently if not exists locations_search_text_trgm
  on core.locations using gin (search_text extensions.gin_trgm_ops);
