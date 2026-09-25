\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- build-v3 · 77_ai_usage — the per-call LLM billing fact.
--
-- THE PROBLEM THIS FILE SOLVES. Every LLM call the API makes is priced and
-- forgotten. `turn.service.ts` logs `ai_turn` with `prompt_tokens`,
-- `completion_tokens` and `cost_usd`, and `LoggingService` writes one JSON line
-- to stdout. Stdout is not a ledger: nobody can sum a month of spend, and the
-- four single-shot call sites on the `LLM_COMPLETION` seam record nothing at
-- all. Decision L20 in `BACKFILL_METHODOLOGY.md` deleted the old
-- `observability.*` schema, BANNED its revival, and reserved the name
-- `umi.ai_usage` for this future billing fact. This file is that fact.
--
-- ONE ROW PER LLM CALL GROUP. `kind` names the caller:
--
--   reply     one WhatsApp turn (the tool loop; `llm_call_count` above 1)
--   intent    intent extraction
--   facts     customer-fact extraction
--   summary   rolling conversation summary
--   portrait  the AI customer portrait
--   narrative the AI sales narrative
--
-- A turn row carries the turn's TOTAL tokens across its loop iterations, so
-- `llm_call_count` is the number of model calls behind the row. Every other
-- kind is one call.
--
-- WHY `occurred_at` AND NOT `created_at`. The report reads a time range, and a
-- backfilled row must be able to state when the call happened rather than when
-- the row was written.
--
-- WHY THE KEYS ARE WHAT THEY ARE. `merchant_id` is NOT NULL: every writer knows
-- its merchant, so no row can hide from a spend report. `conversation_id`,
-- `turn_id` and `request_id` are nullable because the single-shot callers have
-- no turn, and a fact that invents an id is worse than a fact with a null.
--
-- WHY THE PARTIAL UNIQUE INDEX. A replayed turn re-runs `process()`, and the
-- outbox key makes the REPLY exactly once. Without a key here the usage row
-- would be written twice and the bill would report spend the café never
-- incurred. `(turn_id, kind)` is that key where a turn exists.
--
-- SCOPE, RLS AND GRANTS. This table carries `merchant_id` and belongs to one
-- café, so it takes the same FORCED merchant policy the other per-café `umi`
-- tables take in 90_rls.sql. The policy lives HERE, not in 90_rls: 90 runs
-- before this file on a fresh build, so a policy there would name a table that
-- does not exist yet. This is the rule 76_recipes_inventory records.
-- The writers run on the BYPASSRLS worker pool, so the policy protects a
-- future app-pool reader rather than the writer.
--
-- Idempotent and re-runnable: guarded table, guarded index, guarded policy,
-- and an `on conflict do nothing` on the version row.
--
-- GROWTH, MEASURED — AND HOW TO BOUND IT.
-- There is no real traffic yet. The legacy `observability.ai_runs` ran 521 rows
-- over four months, and those were test messages too, so nothing in this
-- repository is a production baseline — do not extrapolate from it.
--
-- Measured on THIS table instead: 20,000 synthetic rows occupy 7,296 kB
-- including both indexes, that is 373 bytes/row.
--
-- At 10 cafés x 100 WhatsApp messages/day, about 2.5 rows per message (reply,
-- plus intent/facts/summary amortised; portrait and narrative are
-- dashboard-driven and rare), that is ~2,500 rows/day, ~0.9 MB/day,
-- ~325 MB/year. Worth bounding eventually. Not worth machinery today.
--
-- FOR SCALE: the same traffic writes ~4.7 GB/year into `comms.messages`
-- (12.9 kB/row — vector(1024) plus its index), so this table is roughly 7% of
-- the corpus it measures. If storage becomes the problem, the embeddings are
-- the lever, not this fact.
--
-- TO BOUND IT WHEN IT IS NEEDED. Replay-dedup only matters over minutes — no
-- turn is replayed a month later — so the raw window can be short: keep ~90
-- days raw (a permanent ~80 MB cap), roll the older rows into a daily
-- (merchant_id, day, kind, provider, model) aggregate (~5 MB/year, forever),
-- then drop the raw rows. Either as a monthly range partition on occurred_at,
-- where pruning becomes DROP TABLE, or as a scheduled job in the worker, which
-- already runs the lifecycle and leads schedulers. Deliberately NOT built here:
-- five pilot cafés will not notice, and the shape above is what the next person
-- needs rather than a mechanism nobody maintains.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · The fact table
-- ---------------------------------------------------------------------------

create table if not exists umi.ai_usage (
  id                uuid primary key default gen_random_uuid(),
  merchant_id       uuid not null,
  conversation_id   uuid,
  turn_id           uuid,
  request_id        text,
  occurred_at       timestamptz not null default now(),
  kind              text not null,
  provider          text not null,
  model             text not null,
  prompt_tokens     integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  llm_call_count    integer not null default 1 check (llm_call_count >= 0),
  latency_ms        integer,
  cost_usd          numeric(12, 6) not null default 0 check (cost_usd >= 0)
);

-- The caller vocabulary is closed in the database, not only in the application.
-- A new caller must add its kind here, which is the point: an unlabelled row
-- would be spend nobody can attribute.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'ai_usage_kind_check'
       and conrelid = 'umi.ai_usage'::regclass
  ) then
    alter table umi.ai_usage
      add constraint ai_usage_kind_check
      check (kind in ('reply','intent','facts','summary','portrait','narrative'));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'ai_usage_provider_check'
       and conrelid = 'umi.ai_usage'::regclass
  ) then
    alter table umi.ai_usage
      add constraint ai_usage_provider_check
      check (provider in ('anthropic','deepseek','typesafe'));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'ai_usage_latency_check'
       and conrelid = 'umi.ai_usage'::regclass
  ) then
    alter table umi.ai_usage
      add constraint ai_usage_latency_check
      check (latency_ms is null or latency_ms >= 0);
  end if;
end $$;

comment on table umi.ai_usage is
  'Per-call LLM billing fact. One row per WhatsApp turn (kind=reply, total tokens) or per single-shot call on the LLM_COMPLETION seam. Reserved by decision L20 in BACKFILL_METHODOLOGY.md.';

-- The report index: spend for one café over a time range.
create index if not exists ai_usage_merchant_occurred_idx
  on umi.ai_usage (merchant_id, occurred_at desc);

-- One row per (turn, kind): a replayed turn must not bill twice.
create unique index if not exists ai_usage_turn_kind_uidx
  on umi.ai_usage (turn_id, kind)
  where turn_id is not null;

-- ---------------------------------------------------------------------------
-- 2 · RLS — one café per request, forced
-- ---------------------------------------------------------------------------

alter table umi.ai_usage enable row level security;
alter table umi.ai_usage force  row level security;
drop policy if exists merchant_isolation on umi.ai_usage;
create policy merchant_isolation on umi.ai_usage
  using      (merchant_id = (select umi.current_merchant()))
  with check (merchant_id = (select umi.current_merchant()));

-- ---------------------------------------------------------------------------
-- 3 · Grants
--
-- The writers are background/service code on the BYPASSRLS worker pool, so
-- `worker` needs INSERT. 90_rls grants a later `umi` table only SELECT by
-- default, which is why INSERT is explicit here.
-- `readonly` keeps the diagnostic read that 76_recipes_inventory gives its new
-- tables. The request path gets nothing: 90_rls reserves explicit grants for
-- the request path, and no product route writes or reads this table today.
-- ---------------------------------------------------------------------------

grant select, insert on umi.ai_usage to worker;
grant select on umi.ai_usage to readonly;

insert into runtime.schema_migration(version,status)
values('build-v3-77','applied') on conflict(version) do nothing;

commit;
