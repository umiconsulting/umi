-- =============================================================================
-- Local source FDW — links the disposable local target to the restored local
-- copies of the two production databases.
--
-- ⚠️ THE SERVER OPTIONS BELOW ARE A SNAPSHOT, AND THEY DRIFT.
--    Last verified 2026-06-29: host `localhost`, port `5233`, databases
--    `umi_cash_production_local_20260618` and
--    `umi_platform_production_local_20260617` — restore evidence in
--    docs/migration/2026-06-17-phase-a-preflight-log.md. They were previously
--    port 5432 and the 2026-05-15 pair, which is what this file said until now.
--
--    `create server if not exists` does NOT correct a server that already exists
--    with stale options. It keeps the old ones silently, and the first
--    `import foreign schema` then fails against a database that is not there.
--    So check the cluster BEFORE running this:
--
--      psql -h localhost -p 5233 -l | grep umi_     -- what is actually restored
--
--      -- and if a server already exists pointing somewhere else:
--      ALTER SERVER umi_cash_production_local_20260618_srv
--        OPTIONS (SET port '5233', SET dbname '<actual database>');
--
--    The target database (README → "Apply Locally") and these source servers
--    must live on the SAME running cluster.
-- =============================================================================

create extension if not exists postgres_fdw;
create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create schema if not exists src_cash_public;
create schema if not exists src_platform_conversaflow;
create schema if not exists src_platform_kds;
create schema if not exists src_platform_public;

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'kds' and t.typname = 'ticket_status') then
    create type kds.ticket_status as enum ('new','accepted','preparing','ready','completed','cancelled','partial_cancelled');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'kds' and t.typname = 'ticket_event_kind') then
    create type kds.ticket_event_kind as enum ('snapshot_reconciled','order_upserted','status_changed','order_removed');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'kds' and t.typname = 'cancel_reason_code') then
    create type kds.cancel_reason_code as enum ('out_of_stock','kitchen_overload','closing_soon','customer_no_show','duplicate_order','other');
  end if;
end $$;

create server if not exists umi_cash_production_local_20260618_srv
  foreign data wrapper postgres_fdw
  options (host 'localhost', port '5233', dbname 'umi_cash_production_local_20260618');

create server if not exists umi_platform_production_local_20260617_srv
  foreign data wrapper postgres_fdw
  options (host 'localhost', port '5233', dbname 'umi_platform_production_local_20260617');

create user mapping if not exists for current_user
  server umi_cash_production_local_20260618_srv
  options (user 'juanlopez1');

create user mapping if not exists for current_user
  server umi_platform_production_local_20260617_srv
  options (user 'juanlopez1');

import foreign schema public
  limit to (
    "Tenant",
    "Location",
    "User",
    "LoyaltyCard",
    "Visit",
    "Transaction",
    "RewardConfig",
    "RewardRedemption",
    "GiftCard",
    "Session",
    "OtpVerification",
    "ApplePushToken",
    "BirthdayReward",
    "_prisma_migrations"
  )
  from server umi_cash_production_local_20260618_srv
  into src_cash_public;

import foreign schema conversaflow
  limit to (
    businesses,
    customers,
    conversations,
    conversation_turns,
    messages,
    transactions,
    transaction_status_events,
    products,
    customer_preferences,
    eval_traces,
    jobs,
    job_attempts,
    outbox,
    pipeline_traces
  )
  from server umi_platform_production_local_20260617_srv
  into src_platform_conversaflow;

import foreign schema kds
  limit to (
    tickets,
    ticket_items,
    ticket_events,
    device_sessions
  )
  from server umi_platform_production_local_20260617_srv
  into src_platform_kds;

import foreign schema public
  limit to (
    businesses,
    customers,
    conversations,
    messages,
    transactions,
    jobs,
    job_attempts,
    outbox
  )
  from server umi_platform_production_local_20260617_srv
  into src_platform_public;
