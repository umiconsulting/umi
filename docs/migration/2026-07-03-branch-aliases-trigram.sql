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

-- unaccent() is STABLE (default-dictionary lookup depends on search_path) and is
-- therefore rejected in a generated column / index expression. The two-arg form
-- with an explicit dictionary is IMMUTABLE; wrap it so the generated column and
-- the query normalize identically.
create or replace function core.f_unaccent(text)
  returns text
  language sql
  immutable
  strict
  parallel safe
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, $1)
$$;

-- search_text = accent-stripped, lowercased "name + aliases", so a trigram match
-- covers both the branch name and its owner-curated nicknames ("chapu").
alter table core.locations
  add column if not exists search_text text
  generated always as (
    lower(core.f_unaccent(name || ' ' || coalesce(array_to_string(aliases, ' '), '')))
  ) stored;

create index if not exists locations_search_text_trgm
  on core.locations using gin (search_text extensions.gin_trgm_ops);
