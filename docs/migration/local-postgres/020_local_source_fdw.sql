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

create server if not exists umi_cash_production_local_20260515_srv
  foreign data wrapper postgres_fdw
  options (host 'localhost', port '5432', dbname 'umi_cash_production_local_20260515');

create server if not exists umi_platform_production_local_20260515_srv
  foreign data wrapper postgres_fdw
  options (host 'localhost', port '5432', dbname 'umi_platform_production_local_20260515');

create user mapping if not exists for current_user
  server umi_cash_production_local_20260515_srv
  options (user 'juanlopez1');

create user mapping if not exists for current_user
  server umi_platform_production_local_20260515_srv
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
  from server umi_cash_production_local_20260515_srv
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
  from server umi_platform_production_local_20260515_srv
  into src_platform_conversaflow;

import foreign schema kds
  limit to (
    tickets,
    ticket_items,
    ticket_events,
    device_sessions
  )
  from server umi_platform_production_local_20260515_srv
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
  from server umi_platform_production_local_20260515_srv
  into src_platform_public;
