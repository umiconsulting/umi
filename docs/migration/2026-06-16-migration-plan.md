# Umi Production Database Migration Plan

> ⚠️ **Superseded on schema names & identity mapping.** Canonical names/identity live in
> [`../architecture/2026-06-16-canonical-schema-and-identity.md`](../architecture/2026-06-16-canonical-schema-and-identity.md);
> execution is orchestrated by [`2026-06-16-execution-runbook.md`](./2026-06-16-execution-runbook.md).
> The "Do not create core" decision below is reconciled as runbook **Decision D1**
> (migrate into physical names `platform`/`cash`/`commerce`, then atomic rename to
> `core`/`loyalty`/`ops`). Also apply: identity per **D2/D3** (roles=edges,
> `password_hash`→`core.users`, `contact_methods` shape) and the **D4** normalizer.
> Use this plan for its SQL, not its names.

**Date:** 2026-06-16  
**Source:** live Supabase production state verified 2026-06-16  
**Target:** platform-domain architecture, adapted to the current production schemas

This plan migrates the live database from the current product-shaped schemas to
the target domain architecture without creating duplicate core or loyalty homes.

Hard physical-schema decisions for this migration:

- `platform` is the target core/identity schema. Do not create `core`.
- `cash` is the target loyalty/wallet schema. Do not create `loyalty`.
- `commerce` is kept as the physical ops/order home for this migration. The
  target architecture's `ops` domain is implemented here unless a later
  DDL-only schema rename is explicitly approved.
- `observability` remains the observability target.
- New schemas created by this plan: `_migration`, `comms`, `queue`, `device`,
  `kitchen`, `grow`.
- No source schema is dropped in Phases 0-4. Cleanup is a later cutover phase
  after code has moved and backups are verified.

DeepSeek review was requested per workspace instructions. The first full review
timed out; a narrower `deepseek-v4-pro` review completed and confirmed the main
risks: tenant slug mapping must be unique, signed `umi_cash."Transaction"`
amounts must not be negated, durable ID maps must drive every FK rewrite, and
each split phase needs orphan checks plus reversible delete markers.

---

## 1. Tenancy Model

### Tenant-scoped data

Tenant-scoped rows have `tenant_id uuid not null` and belong to exactly one
tenant. Target tenant-scoped schemas/tables:

- `platform.tenants`, `platform.locations`, `platform.people`,
  `platform.contact_identities`, `platform.users`,
  `platform.tenant_memberships`, `platform.staff_members`, RBAC tables.
- All `cash.*` loyalty/wallet tables.
- All `commerce.*` ops/order tables.
- All `comms.*`, `device.*`, and `kitchen.*` tables except views.

Tenant resolution rules:

- `umi_cash` tenant mapping is exact:
  `platform.tenants.slug = umi_cash."Tenant".slug`.
- No `limit 1` is allowed in tenant mapping SQL.
- `conversaflow.business_id` and `kds.business_id` require a durable
  `_migration.business_tenant_map` row before Phases 2-4 run.
- Every tenant-scoped target table should have `unique (tenant_id, id)` so
  composite tenant FKs can be added without relying only on RLS.

### Service-only data

`queue.*`, `observability.*`, and `grow.*` are service-only. They may carry a
nullable or denormalized `tenant_id` for filtering and diagnostics, but tenant
applications do not get direct grants.

### Umi-internal data

`grow.*` contains Umi's leads, product rollout metadata, subscriptions, and
feature flags. Tenants never read it. Existing empty `platform.leads`,
`platform.lead_events`, and `platform.product_instances` remain until code
cutover; equivalent `grow.*` tables are created in Phase 0.

---

## 2. Current State Inventory

| Schema | Current tables | Current rows | Plan |
|---|---:|---:|---|
| `platform` | 17 | 33 | Keep as identity/core. Enrich with migrated identities. |
| `cash` | 11 | 0 | Use as loyalty target. Add safe columns/ledgers if missing. |
| `commerce` | 7 | 0 | Keep as ops/order target. Add ops tables if missing. |
| `conversaflow` | 28 | 18,335 | Split in Phases 2-3. Leave source intact. |
| `kds` | 7 | 275 | Split into `device`, `kitchen`, and `commerce` projections. |
| `observability` | 3 | 0 | Keep and expand as observability target. |
| `umi_cash` | 13 | 240 | Migrate to `platform` + `cash` in Phase 1. Leave source intact. |

Authoritative source row counts used for verification:

```text
platform: tenants 4, locations 0, people 15, users 1,
  tenant_memberships 1, staff_members 0, contact_identities 12,
  contact_merge_candidates 0, external_refs 0, leads 0, lead_events 0,
  password_reset_tokens 0, permissions 0, roles 0, role_permissions 0,
  membership_roles 0, product_instances 0

cash: all 11 tables are 0
commerce: all 7 tables are 0
observability: all 3 tables are 0

conversaflow: ai_turn_logs 521, business_config_changes 20, businesses 1,
  channel_accounts 0, channels 0, conversation_outcomes 0,
  conversation_turns 278, conversations 11, customer_preferences 9,
  customers 11, daily_summaries 5, dashboard_users 1,
  edge_function_logs 3022, eval_traces 17, inbound_events 366,
  job_attempts 2763, jobs 2758, memory_items 0, messages 1322,
  outbox 392, pipeline_traces 5279, products 136, security_logs 818,
  tool_calls 0, transaction_status_events 52, transactions 49,
  workflow_jobs 58, zettle_oauth_tokens 0

kds: device_events 0, device_pairing_requests 0, device_sessions 0,
  stations 0, ticket_events 155, ticket_items 71, tickets 49

umi_cash: ApplePushToken 49, BirthdayReward 0, GiftCard 1, Location 3,
  LoyaltyCard 59, OtpVerification 13, RewardConfig 14,
  RewardRedemption 0, Session 0, Tenant 3, Transaction 3, User 64,
  Visit 31
```

---

## 3. Data Movement Summary

### `platform`

| Current table | Destination | Action |
|---|---|---|
| `tenants` | `platform.tenants` | Keep. Phase 1 maps `umi_cash."Tenant"` by slug and enriches metadata. |
| `locations` | `platform.locations` | Keep. Phase 1 inserts 3 `umi_cash."Location"` rows. |
| `people` | `platform.people` | Keep. Phase 1 inserts Cash people; Phase 2 merges ConversaFlow customers. |
| `users` | `platform.users` | Keep. Phase 1/2 only insert dashboard/staff login rows when identity is known. |
| `tenant_memberships` | `platform.tenant_memberships` | Keep. Phase 2 maps `dashboard_users` here. |
| `staff_members` | `platform.staff_members` | Keep. Phase 1 may insert `umi_cash."User"` rows with role `ADMIN`/`STAFF`. |
| `contact_identities` | `platform.contact_identities` | Keep. Phase 1/2 insert phone/email identities. |
| `contact_merge_candidates` | same | Keep; currently empty. Used for ambiguous identity matches. |
| `external_refs` | same | Keep; optional audit references. `_migration` is the durable map source. |
| `leads` | `grow.leads` | Current table empty. Create `grow.leads`; do not drop platform compatibility yet. |
| `lead_events` | `grow.lead_events` | Current table empty. Create `grow.lead_events`; no data to move. |
| `password_reset_tokens` | same | Keep; identity auth support. |
| `permissions` | same | Keep; RBAC. |
| `roles` | same | Keep; RBAC. |
| `role_permissions` | same | Keep; RBAC. |
| `membership_roles` | same | Keep; RBAC. |
| `product_instances` | `grow.product_instances` | Current table empty. Create grow copy; keep compatibility table. |

### `cash`

`cash` is the loyalty target. All 11 existing empty tables stay in place:

| Table | Source data |
|---|---|
| `wallet_programs` | `umi_cash."Tenant"` program/pass/branding settings |
| `loyalty_accounts` | one account per migrated `umi_cash."LoyaltyCard"`/person |
| `loyalty_cards` | `umi_cash."LoyaltyCard"` |
| `points_ledger` | append-only points movements; balance = `sum(delta)` |
| `balances` | derived points cache, maintained by `points_ledger` insert trigger |
| `visit_events` | `umi_cash."Visit"` |
| `wallet_transactions` | non-points money (`umi_cash."Transaction"` plus optional opening-balance adjustments) |
| `reward_configs` | `umi_cash."RewardConfig"` |
| `reward_redemptions` | `umi_cash."RewardRedemption"`; currently 0 |
| `gift_cards` | `umi_cash."GiftCard"` |
| `automation_rules` | empty architecture table for birthday, win-back, streak, and goal-proximity rules |
| `passes` | Apple/Google pass fields from `umi_cash."LoyaltyCard"` |
| `pass_devices` | `umi_cash."ApplePushToken"` |
| `otp_verifications` | `umi_cash."OtpVerification"` |

If missing from live DDL, Phase 0 adds ledger-support columns/tables inside
`cash`; it does not create a separate `loyalty` schema. Do not remove
`cash.wallet_transactions`: `points_ledger` tracks loyalty points, while
`wallet_transactions` tracks non-points money movement.

### `commerce` as ops/order home

The existing empty `commerce` schema remains the physical home for operational
orders/payments. Phase 3 adds or uses:

- `commerce.businesses`
- `commerce.channels`
- `commerce.channel_accounts`
- `commerce.products`
- existing `commerce.orders`
- existing `commerce.order_items`
- existing `commerce.order_events`
- existing `commerce.payments`, `commerce.refunds`,
  `commerce.business_hours`, `commerce.service_windows`

### `conversaflow`

| Current table | Destination | Phase |
|---|---|---:|
| `customers` | `platform.people`, `platform.contact_identities` | 2 |
| `dashboard_users` | `platform.users`, `platform.tenant_memberships` | 2 |
| `businesses` | `commerce.businesses` | 3 |
| `channels` | `commerce.channels` | 3 |
| `channel_accounts` | `commerce.channel_accounts` | 3 |
| `products` | `commerce.products` | 3 |
| `transactions` | `commerce.orders` | 3 |
| `transaction_status_events` | `commerce.order_events` | 3 |
| `conversations` | `comms.conversations` | 3 |
| `messages` | `comms.messages` | 3 |
| `conversation_turns` | `comms.conversation_turns` | 3 |
| `tool_calls` | `comms.tool_calls` | 3 |
| `memory_items` | `comms.memory_items` | 3 |
| `customer_preferences` | `comms.customer_preferences` | 3 |
| `conversation_outcomes` | `comms.conversation_outcomes` | 3 |
| `daily_summaries` | `comms.daily_summaries` | 3 |
| `jobs` | `queue.jobs` with `source_table='jobs'` | 3 |
| `workflow_jobs` | `queue.jobs` with `source_table='workflow_jobs'` | 3 |
| `job_attempts` | `queue.job_attempts` | 3 |
| `outbox` | `queue.outbox_events` | 3 |
| `inbound_events` | `queue.inbound_events` | 3 |
| `business_config_changes` | `observability.audit_log` | 3 |
| `ai_turn_logs` | `observability.ai_runs` | 3 |
| `edge_function_logs` | `observability.edge_logs` | 3 |
| `eval_traces` | `observability.evaluation_traces` | 3 |
| `pipeline_traces` | `observability.pipeline_traces` | 3 |
| `security_logs` | `observability.security_events` | 3 |
| `zettle_oauth_tokens` | no rows; future target `commerce.integration_tokens` or Vault | 3 |

### `kds`

| Current table | Destination | Phase |
|---|---|---:|
| `device_sessions` | `device.devices`, `device.sessions` | 4 |
| `device_pairing_requests` | `device.pairing_requests` | 4 |
| `device_events` | `device.events` | 4 |
| `stations` | `kitchen.stations` | 4 |
| `tickets` | `commerce.orders` only for missing order projections; otherwise map to existing orders | 4 |
| `ticket_items` | `commerce.order_items` | 4 |
| `ticket_events` | `commerce.order_events` | 4 |

Target kitchen stores station configuration only. Ticket data is converted into
operational order state, then KDS reads a view (`kitchen.v_kds_tickets`) rather
than owning a duplicate ticket tree.

---

## 4. Global Execution Rules

1. Take a Supabase physical backup before every phase.
2. Run every phase first against a restored staging copy.
3. Set short lock and statement timeouts for migration sessions.
4. Do not run destructive cleanup in Phases 0-4.
5. Each data phase writes a row to `_migration.phase_runs`.
6. Rollback deletes only rows tagged by `_migration` maps and source metadata.
7. Verification SQL must return zero mismatches before moving to the next phase.

Recommended session preamble:

```sql
set lock_timeout = '5s';
set statement_timeout = '5min';
set idle_in_transaction_session_timeout = '5min';
set check_function_bodies = on;
```

Preflight uniqueness checks:

```sql
-- No duplicate platform tenant slugs.
select slug, count(*)
from platform.tenants
group by slug
having count(*) <> 1;

-- Every umi_cash tenant maps exactly once by slug.
select
  uc.id as old_tenant_id,
  uc.slug,
  count(pt.id) as platform_matches
from umi_cash."Tenant" uc
left join platform.tenants pt on pt.slug = uc.slug
group by uc.id, uc.slug
having count(pt.id) <> 1;

-- No invalid signed transaction types.
select type, count(*), sum("amountCentavos") as amount_centavos
from umi_cash."Transaction"
group by type
having type not in ('TOPUP', 'PURCHASE');
```

Preflight row-count snapshot:

```sql
create schema if not exists _migration;

create table if not exists _migration.preflight_counts (
  captured_at timestamptz not null default now(),
  schema_name text not null,
  table_name text not null,
  row_count bigint not null,
  total_cents bigint,
  primary key (captured_at, schema_name, table_name)
);

insert into _migration.preflight_counts (schema_name, table_name, row_count, total_cents)
values
  ('umi_cash', 'LoyaltyCard', (select count(*) from umi_cash."LoyaltyCard"),
    (select coalesce(sum("balanceCentavos"), 0) from umi_cash."LoyaltyCard")),
  ('umi_cash', 'Transaction', (select count(*) from umi_cash."Transaction"),
    (select coalesce(sum("amountCentavos"), 0) from umi_cash."Transaction")),
  ('umi_cash', 'GiftCard', (select count(*) from umi_cash."GiftCard"),
    (select coalesce(sum("amountCentavos"), 0) from umi_cash."GiftCard")),
  ('conversaflow', 'transactions', (select count(*) from conversaflow.transactions),
    (select coalesce(sum(round(coalesce(total_amount, 0) * 100)::bigint), 0) from conversaflow.transactions)),
  ('kds', 'tickets', (select count(*) from kds.tickets),
    (select coalesce(sum(total_cents), 0) from kds.tickets));
```

---

## 5. Phase 0 - DDL Only

Goal: create schemas, helper tables, target tables/columns, constraints, indexes,
triggers, and grants. No source rows are copied, updated, or deleted.

### 5.1 Schemas and grants

```sql
begin;

create schema if not exists _migration;
create schema if not exists comms;
create schema if not exists queue;
create schema if not exists device;
create schema if not exists kitchen;
create schema if not exists grow;
create schema if not exists observability;

-- D6 (locked 2026-06-17): pg_roles connection model. Roles are created in
-- 001_platform_core.sql. umi_app = RLS-enforced request role; umi_worker =
-- BYPASSRLS service/background; umi_readonly = analytics. No Supabase
-- anon/authenticated/service_role — user authorization lives in data + backend
-- (core.membership_roles/permissions), never in pg_roles.
grant usage on schema platform, cash, commerce, comms, device, kitchen to umi_app;
grant usage on schema platform, cash, commerce, comms, queue, device, kitchen, observability, grow to umi_worker;

revoke all on schema queue from umi_app;
revoke all on schema observability from umi_app;
revoke all on schema grow from umi_app;

commit;
```

### 5.2 Durable migration tables

These are persistent audit tables, not temp tables.

```sql
begin;

create unique index if not exists platform_people_tenant_id_uidx
  on platform.people (tenant_id, id);

create table if not exists _migration.phase_runs (
  id uuid primary key default gen_random_uuid(),
  phase text not null,
  status text not null check (status in ('running', 'verified', 'rolled_back', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  conflicts jsonb not null default '{}'::jsonb
);

alter table _migration.phase_runs
  add column if not exists conflicts jsonb not null default '{}'::jsonb;

create or replace function _migration.record_conflicts(
  p_phase_run_id uuid,
  p_table_name text,
  p_attempted_rows bigint,
  p_inserted_rows bigint
)
returns void
language plpgsql
as $$
declare
  count_of_skipped_rows bigint := greatest(p_attempted_rows - p_inserted_rows, 0);
begin
  update _migration.phase_runs
  set conflicts = conflicts ||
    jsonb_build_object(p_table_name, count_of_skipped_rows)
  where id = p_phase_run_id;
end;
$$;

create table if not exists _migration.tenant_map (
  old_schema text not null default 'umi_cash',
  old_table text not null default 'Tenant',
  old_id text not null,
  old_slug text not null,
  new_tenant_id uuid not null references platform.tenants(id),
  mapping_strategy text not null default 'slug_exact',
  phase_run_id uuid references _migration.phase_runs(id),
  created_at timestamptz not null default now(),
  primary key (old_schema, old_table, old_id),
  unique (old_schema, old_table, old_slug)
);

create table if not exists _migration.user_map (
  old_schema text not null default 'umi_cash',
  old_table text not null default 'User',
  old_id text not null,
  old_tenant_id text not null,
  new_tenant_id uuid not null references platform.tenants(id),
  new_person_id uuid not null,
  new_user_id uuid,
  role text,
  phone text,
  email text,
  mapping_strategy text not null default 'generated_person',
  phase_run_id uuid references _migration.phase_runs(id),
  created_at timestamptz not null default now(),
  primary key (old_schema, old_table, old_id)
);

create table if not exists _migration.location_map (
  old_schema text not null default 'umi_cash',
  old_table text not null default 'Location',
  old_id text not null,
  old_tenant_id text not null,
  new_tenant_id uuid not null references platform.tenants(id),
  new_location_id uuid not null,
  phase_run_id uuid references _migration.phase_runs(id),
  created_at timestamptz not null default now(),
  primary key (old_schema, old_table, old_id)
);

create table if not exists _migration.card_map (
  old_schema text not null default 'umi_cash',
  old_table text not null default 'LoyaltyCard',
  old_id text not null,
  old_tenant_id text not null,
  old_user_id text not null,
  new_tenant_id uuid not null references platform.tenants(id),
  new_person_id uuid not null,
  new_account_id uuid not null,
  new_card_id uuid not null,
  card_number text,
  phase_run_id uuid references _migration.phase_runs(id),
  created_at timestamptz not null default now(),
  primary key (old_schema, old_table, old_id),
  unique (new_card_id),
  unique (new_account_id)
);

create table if not exists _migration.reward_config_map (
  old_schema text not null default 'umi_cash',
  old_table text not null default 'RewardConfig',
  old_id text not null,
  old_tenant_id text not null,
  new_tenant_id uuid not null references platform.tenants(id),
  new_reward_config_id uuid not null,
  phase_run_id uuid references _migration.phase_runs(id),
  created_at timestamptz not null default now(),
  primary key (old_schema, old_table, old_id),
  unique (new_reward_config_id)
);

create table if not exists _migration.gift_card_map (
  old_schema text not null default 'umi_cash',
  old_table text not null default 'GiftCard',
  old_id text not null,
  old_tenant_id text not null,
  new_tenant_id uuid not null references platform.tenants(id),
  new_gift_card_id uuid not null,
  code text not null,
  phase_run_id uuid references _migration.phase_runs(id),
  created_at timestamptz not null default now(),
  primary key (old_schema, old_table, old_id),
  unique (new_gift_card_id)
);

create table if not exists _migration.business_tenant_map (
  source_schema text not null,
  source_table text not null default 'businesses',
  source_business_id uuid not null,
  tenant_id uuid not null references platform.tenants(id),
  tenant_slug text not null,
  mapping_strategy text not null check (mapping_strategy in ('manual', 'slug_exact', 'external_ref')),
  notes text,
  created_at timestamptz not null default now(),
  primary key (source_schema, source_table, source_business_id)
);

create table if not exists _migration.conversaflow_customer_map (
  old_customer_id uuid primary key,
  old_business_id uuid not null,
  tenant_id uuid not null references platform.tenants(id),
  person_id uuid not null,
  match_strategy text not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, person_id) references platform.people(tenant_id, id)
);

create table if not exists _migration.order_map (
  source_schema text not null,
  source_table text not null,
  source_id text not null,
  tenant_id uuid not null references platform.tenants(id),
  order_id uuid not null,
  phase_run_id uuid references _migration.phase_runs(id),
  created_at timestamptz not null default now(),
  primary key (source_schema, source_table, source_id),
  unique (order_id)
);

create table if not exists _migration.kds_ticket_map (
  source_ticket_id uuid primary key,
  source_transaction_id uuid,
  tenant_id uuid not null references platform.tenants(id),
  order_id uuid not null,
  created_at timestamptz not null default now()
);

commit;
```

Every `on conflict do nothing` insert in Phases 1-4 must record skipped rows in
the current `_migration.phase_runs.conflicts` object. Use a materialized source
CTE plus an `inserted_rows as (... returning 1)` CTE, then call:

```sql
select _migration.record_conflicts(
  :phase_run_id,
  'schema.table_name',
  (select count(*) from source_rows),
  (select count(*) from inserted_rows)
);
```

This updates `conflicts = conflicts || jsonb_build_object('schema.table_name',
count_of_skipped_rows)`, preserving prior table entries. For a single insert on
a fresh phase row, this is equivalent to `conflicts =
jsonb_build_object('table_name', count_of_skipped_rows)`. If a block
intentionally has no `:phase_run_id`, create one before the insert rather than
running a silent do-nothing insert.

### 5.3 Add safe target columns

Column names in production must be checked before execution. These additions are
idempotent and preserve existing data.

```sql
begin;

alter table platform.tenants
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table platform.people
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists birthday date,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table platform.locations
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table cash.loyalty_accounts
  add column if not exists person_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table cash.loyalty_cards
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table cash.wallet_transactions
  add column if not exists idempotency_key text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table cash.reward_configs
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table cash.reward_redemptions
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table cash.gift_cards
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists original_amount_cents integer;

alter table cash.otp_verifications
  add column if not exists person_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Compatibility guard for older replay DDL where loyalty_accounts.contact_id
-- was required. The target identity edge is platform.people/person_id.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'cash'
      and table_name = 'loyalty_accounts'
      and column_name = 'contact_id'
      and is_nullable = 'NO'
  ) then
    alter table cash.loyalty_accounts alter column contact_id drop not null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'cash_loyalty_accounts_person_tenant_fkey'
      and conrelid = 'cash.loyalty_accounts'::regclass
  ) then
    alter table cash.loyalty_accounts
      add constraint cash_loyalty_accounts_person_tenant_fkey
      foreign key (tenant_id, person_id) references platform.people(tenant_id, id);
  end if;
end $$;

create unique index if not exists cash_loyalty_accounts_tenant_person_uidx
  on cash.loyalty_accounts (tenant_id, person_id)
  where person_id is not null;

create unique index if not exists platform_people_tenant_id_uidx
  on platform.people (tenant_id, id);

create unique index if not exists platform_locations_tenant_id_uidx
  on platform.locations (tenant_id, id);

create unique index if not exists platform_staff_members_tenant_id_uidx
  on platform.staff_members (tenant_id, id);

create unique index if not exists cash_wallet_programs_tenant_id_uidx
  on cash.wallet_programs (tenant_id, id);

create unique index if not exists cash_loyalty_accounts_tenant_id_uidx
  on cash.loyalty_accounts (tenant_id, id);

create unique index if not exists cash_loyalty_cards_tenant_id_uidx
  on cash.loyalty_cards (tenant_id, id);

create unique index if not exists cash_reward_configs_tenant_id_uidx
  on cash.reward_configs (tenant_id, id);

create unique index if not exists cash_gift_cards_tenant_id_uidx
  on cash.gift_cards (tenant_id, id);

create unique index if not exists cash_passes_tenant_id_uidx
  on cash.passes (tenant_id, id);

create unique index if not exists commerce_orders_tenant_id_uidx
  on commerce.orders (tenant_id, id);

create or replace function _migration.add_composite_fk(
  p_child regclass,
  p_constraint name,
  p_child_columns text,
  p_parent regclass,
  p_parent_columns text,
  p_extra text default ''
)
returns void
language plpgsql
as $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = p_child
      and conname = p_constraint::text
  ) then
    execute format(
      'alter table %s add constraint %I foreign key (%s) references %s (%s) %s',
      p_child,
      p_constraint,
      p_child_columns,
      p_parent,
      p_parent_columns,
      p_extra
    );
  end if;
end;
$$;

-- Tenant root FKs stay single-column. Every child reference to a tenant-scoped
-- table uses the composite tenant FK shape required by the architecture.
select _migration.add_composite_fk(
  'cash.wallet_programs', 'cash_wallet_programs_location_tenant_fkey',
  'tenant_id, location_id', 'platform.locations', 'tenant_id, id'
);
select _migration.add_composite_fk(
  'cash.loyalty_accounts', 'cash_loyalty_accounts_program_tenant_fkey',
  'tenant_id, program_id', 'cash.wallet_programs', 'tenant_id, id'
);
select _migration.add_composite_fk(
  'cash.loyalty_cards', 'cash_loyalty_cards_account_tenant_fkey',
  'tenant_id, loyalty_account_id', 'cash.loyalty_accounts', 'tenant_id, id',
  'on delete cascade'
);
select _migration.add_composite_fk(
  'cash.visit_events', 'cash_visit_events_card_tenant_fkey',
  'tenant_id, loyalty_card_id', 'cash.loyalty_cards', 'tenant_id, id'
);
select _migration.add_composite_fk(
  'cash.visit_events', 'cash_visit_events_staff_member_tenant_fkey',
  'tenant_id, staff_member_id', 'platform.staff_members', 'tenant_id, id'
);
select _migration.add_composite_fk(
  'cash.wallet_transactions', 'cash_wallet_transactions_card_tenant_fkey',
  'tenant_id, loyalty_card_id', 'cash.loyalty_cards', 'tenant_id, id'
);
select _migration.add_composite_fk(
  'cash.wallet_transactions', 'cash_wallet_transactions_staff_member_tenant_fkey',
  'tenant_id, staff_member_id', 'platform.staff_members', 'tenant_id, id'
);
select _migration.add_composite_fk(
  'cash.reward_configs', 'cash_reward_configs_program_tenant_fkey',
  'tenant_id, program_id', 'cash.wallet_programs', 'tenant_id, id'
);
select _migration.add_composite_fk(
  'cash.reward_redemptions', 'cash_reward_redemptions_card_tenant_fkey',
  'tenant_id, loyalty_card_id', 'cash.loyalty_cards', 'tenant_id, id'
);
select _migration.add_composite_fk(
  'cash.reward_redemptions', 'cash_reward_redemptions_config_tenant_fkey',
  'tenant_id, reward_config_id', 'cash.reward_configs', 'tenant_id, id'
);
select _migration.add_composite_fk(
  'cash.reward_redemptions', 'cash_reward_redemptions_staff_member_tenant_fkey',
  'tenant_id, staff_member_id', 'platform.staff_members', 'tenant_id, id'
);
select _migration.add_composite_fk(
  'cash.gift_cards', 'cash_gift_cards_created_by_staff_tenant_fkey',
  'tenant_id, created_by_staff_member_id', 'platform.staff_members', 'tenant_id, id'
);
select _migration.add_composite_fk(
  'cash.gift_cards', 'cash_gift_cards_redeemed_card_tenant_fkey',
  'tenant_id, redeemed_loyalty_card_id', 'cash.loyalty_cards', 'tenant_id, id'
);
select _migration.add_composite_fk(
  'cash.passes', 'cash_passes_card_tenant_fkey',
  'tenant_id, loyalty_card_id', 'cash.loyalty_cards', 'tenant_id, id',
  'on delete cascade'
);
select _migration.add_composite_fk(
  'cash.pass_devices', 'cash_pass_devices_pass_tenant_fkey',
  'tenant_id, pass_id', 'cash.passes', 'tenant_id, id',
  'on delete cascade'
);
select _migration.add_composite_fk(
  'cash.otp_verifications', 'cash_otp_verifications_person_tenant_fkey',
  'tenant_id, person_id', 'platform.people', 'tenant_id, id'
);
select _migration.add_composite_fk(
  'commerce.orders', 'commerce_orders_location_tenant_fkey',
  'tenant_id, location_id', 'platform.locations', 'tenant_id, id'
);
select _migration.add_composite_fk(
  'commerce.order_items', 'commerce_order_items_order_tenant_fkey',
  'tenant_id, order_id', 'commerce.orders', 'tenant_id, id',
  'on delete cascade'
);
select _migration.add_composite_fk(
  'commerce.order_events', 'commerce_order_events_order_tenant_fkey',
  'tenant_id, order_id', 'commerce.orders', 'tenant_id, id',
  'on delete cascade'
);
select _migration.add_composite_fk(
  'commerce.order_events', 'commerce_order_events_actor_staff_tenant_fkey',
  'tenant_id, actor_staff_member_id', 'platform.staff_members', 'tenant_id, id'
);

commit;
```

If `cash.wallet_transactions.type` currently only accepts lower-case values,
keep it that way and normalize source `TOPUP`/`PURCHASE` to `topup`/`purchase`
on insert. Do not store unsupported uppercase values unless the check
constraint is explicitly widened.

### 5.4 Optional cash append-only support

If live `cash` does not already have ledger protections, add them in `cash`
itself:

```sql
begin;

create table if not exists cash.gift_card_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  gift_card_id uuid not null,
  delta_cents integer not null,
  reason text not null,
  source_type text,
  source_id text,
  idempotency_key text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, gift_card_id) references cash.gift_cards(tenant_id, id)
);

create table if not exists cash.points_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  account_id uuid not null,
  delta integer not null,
  reason text not null,
  source_type text,
  source_id text,
  idempotency_key text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, account_id) references cash.loyalty_accounts(tenant_id, id)
);

create table if not exists cash.balances (
  account_id uuid primary key,
  tenant_id uuid not null references platform.tenants(id),
  balance integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (tenant_id, account_id),
  foreign key (tenant_id, account_id) references cash.loyalty_accounts(tenant_id, id)
    on delete cascade
);

create table if not exists cash.automation_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  program_id uuid,
  rule_type text not null,
  name text not null,
  is_active boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, program_id) references cash.wallet_programs(tenant_id, id)
);

create or replace function cash.block_append_only_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'append-only table %.% cannot be %', tg_table_schema, tg_table_name, tg_op;
end;
$$;

create or replace function cash.apply_points_ledger_balance()
returns trigger
language plpgsql
as $$
begin
  insert into cash.balances (tenant_id, account_id, balance, updated_at)
  values (new.tenant_id, new.account_id, new.delta, now())
  on conflict (account_id) do update
  set balance = cash.balances.balance + excluded.balance,
      updated_at = now();

  return new;
end;
$$;

drop trigger if exists cash_wallet_transactions_append_only on cash.wallet_transactions;
create trigger cash_wallet_transactions_append_only
before update or delete on cash.wallet_transactions
for each row execute function cash.block_append_only_mutation();

drop trigger if exists cash_gift_card_ledger_append_only on cash.gift_card_ledger;
create trigger cash_gift_card_ledger_append_only
before update or delete on cash.gift_card_ledger
for each row execute function cash.block_append_only_mutation();

drop trigger if exists cash_points_ledger_append_only on cash.points_ledger;
create trigger cash_points_ledger_append_only
before update or delete on cash.points_ledger
for each row execute function cash.block_append_only_mutation();

drop trigger if exists cash_points_ledger_apply_balance on cash.points_ledger;
create trigger cash_points_ledger_apply_balance
after insert on cash.points_ledger
for each row execute function cash.apply_points_ledger_balance();

commit;
```

### 5.5 Target schemas for split data

Plan-grade DDL. Final migration files should expand these definitions to the
live column set after `information_schema` inspection.

```sql
begin;

create table if not exists commerce.businesses (
  id uuid primary key,
  tenant_id uuid not null references platform.tenants(id),
  name text not null,
  business_type text,
  config jsonb not null default '{}'::jsonb,
  open_times jsonb not null default '{}'::jsonb,
  source_schema text not null default 'conversaflow',
  source_id uuid not null,
  created_at timestamptz not null default now(),
  unique (source_schema, source_id),
  unique (tenant_id, id)
);

create table if not exists commerce.channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  channel_key text not null,
  name text,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, channel_key),
  unique (tenant_id, id)
);

create table if not exists commerce.channel_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  channel_id uuid,
  provider text,
  provider_account_id text,
  address text,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  source_schema text not null default 'conversaflow',
  source_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, channel_id) references commerce.channels(tenant_id, id)
);

create table if not exists commerce.product_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  business_id uuid,
  name text not null,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, business_id, name),
  unique (tenant_id, id),
  foreign key (tenant_id, business_id) references commerce.businesses(tenant_id, id)
);

create table if not exists commerce.products (
  id uuid primary key,
  tenant_id uuid not null references platform.tenants(id),
  business_id uuid,
  name text not null,
  price_cents integer not null default 0,
  category text,
  available boolean not null default true,
  zettle_uuid text,
  description text,
  variants jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  synced_at timestamptz,
  source_schema text not null default 'conversaflow',
  source_id uuid not null,
  created_at timestamptz not null default now(),
  unique (source_schema, source_id),
  unique (tenant_id, id),
  foreign key (tenant_id, business_id) references commerce.businesses(tenant_id, id)
);

create table if not exists commerce.product_modifier_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  product_id uuid,
  name text not null,
  min_selected integer not null default 0,
  max_selected integer,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references commerce.products(tenant_id, id)
);

create table if not exists commerce.product_modifiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  modifier_group_id uuid not null,
  name text not null,
  price_delta_cents integer not null default 0,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, modifier_group_id)
    references commerce.product_modifier_groups(tenant_id, id)
);

create table if not exists comms.conversations (
  id uuid primary key,
  tenant_id uuid not null references platform.tenants(id),
  person_id uuid,
  business_id uuid,
  status text,
  current_state text,
  state_data jsonb not null default '{}'::jsonb,
  conversation_history jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  last_message_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, person_id) references platform.people(tenant_id, id),
  foreign key (tenant_id, business_id) references commerce.businesses(tenant_id, id)
);

create table if not exists comms.messages (
  id uuid primary key,
  tenant_id uuid not null references platform.tenants(id),
  conversation_id uuid not null,
  person_id uuid,
  role text not null,
  content text,
  intent text,
  entities jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, conversation_id) references comms.conversations(tenant_id, id),
  foreign key (tenant_id, person_id) references platform.people(tenant_id, id)
);

create table if not exists comms.conversation_turns (
  id uuid primary key,
  tenant_id uuid not null references platform.tenants(id),
  conversation_id uuid not null,
  person_id uuid,
  status text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, conversation_id) references comms.conversations(tenant_id, id),
  foreign key (tenant_id, person_id) references platform.people(tenant_id, id)
);

create table if not exists comms.tool_calls (
  id uuid primary key,
  tenant_id uuid not null references platform.tenants(id),
  conversation_id uuid,
  turn_id uuid,
  tool_name text,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  status text,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, conversation_id) references comms.conversations(tenant_id, id),
  foreign key (tenant_id, turn_id) references comms.conversation_turns(tenant_id, id)
);

create table if not exists comms.memory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  person_id uuid,
  conversation_id uuid,
  memory_type text,
  content text,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, person_id) references platform.people(tenant_id, id),
  foreign key (tenant_id, conversation_id) references comms.conversations(tenant_id, id)
);

create table if not exists comms.customer_preferences (
  tenant_id uuid not null references platform.tenants(id),
  person_id uuid not null,
  old_customer_id uuid,
  favorite_services uuid[],
  usual_modifications jsonb not null default '[]'::jsonb,
  total_transactions integer,
  avg_transaction_value numeric(10,2),
  last_transaction_at timestamptz,
  facts jsonb not null default '{}'::jsonb,
  updated_at timestamptz,
  primary key (tenant_id, person_id),
  foreign key (tenant_id, person_id) references platform.people(tenant_id, id)
);

create table if not exists comms.conversation_outcomes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  conversation_id uuid,
  person_id uuid,
  outcome text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, conversation_id) references comms.conversations(tenant_id, id),
  foreign key (tenant_id, person_id) references platform.people(tenant_id, id)
);

create table if not exists comms.daily_summaries (
  id uuid primary key,
  tenant_id uuid not null references platform.tenants(id),
  business_id uuid,
  summary_date date not null,
  slack_channel text,
  slack_message_ts text,
  pinned boolean not null default false,
  created_at timestamptz,
  last_updated_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, business_id) references commerce.businesses(tenant_id, id)
);

create table if not exists comms.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  business_id uuid,
  title text not null,
  source_uri text,
  content text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, business_id) references commerce.businesses(tenant_id, id)
);

create table if not exists comms.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  document_id uuid not null,
  chunk_index integer not null,
  content text not null,
  embedding jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (document_id, chunk_index),
  foreign key (tenant_id, document_id) references comms.knowledge_documents(tenant_id, id)
    on delete cascade
);

create table if not exists queue.jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references platform.tenants(id),
  source_schema text not null,
  source_table text not null,
  source_id text not null,
  job_type text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  run_at timestamptz,
  locked_by text,
  locked_at timestamptz,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  error text,
  created_at timestamptz not null default now(),
  unique (source_schema, source_table, source_id)
);

create table if not exists queue.job_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references platform.tenants(id),
  queue_job_id uuid references queue.jobs(id),
  source_schema text not null,
  source_table text not null default 'job_attempts',
  source_id uuid not null,
  attempt integer,
  started_at timestamptz,
  finished_at timestamptz,
  outcome text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  unique (source_schema, source_table, source_id)
);

create table if not exists queue.outbox_events (
  id uuid primary key,
  tenant_id uuid references platform.tenants(id),
  event_type text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  idempotency_key text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table if not exists queue.inbound_events (
  id uuid primary key,
  tenant_id uuid references platform.tenants(id),
  provider text not null,
  provider_event_id text,
  event_type text,
  payload_hash text,
  payload jsonb not null default '{}'::jsonb,
  status text,
  request_id uuid,
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  error text,
  unique (provider, provider_event_id)
);

create table if not exists queue.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references platform.tenants(id),
  scope text not null,
  key text not null,
  result jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (scope, key)
);

create table if not exists queue.dead_letters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references platform.tenants(id),
  source_schema text,
  source_table text,
  source_id text,
  payload jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now()
);

commit;
```

### 5.6 Observability, device, kitchen, grow DDL

```sql
begin;

create table if not exists observability.ai_runs (
  id uuid primary key,
  tenant_id uuid references platform.tenants(id),
  conversation_id uuid,
  person_id uuid,
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  cost_usd numeric(10,6),
  latency_ms integer,
  response_type text,
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default now()
);

create table if not exists observability.edge_logs (
  id uuid primary key,
  tenant_id uuid references platform.tenants(id),
  function_name text,
  status text,
  duration_ms integer,
  error_message text,
  error_stack text,
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default now()
);

create table if not exists observability.audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references platform.tenants(id),
  actor_user_id uuid references platform.users(id),
  action text not null,
  subject_schema text,
  subject_table text,
  subject_id text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table if not exists observability.security_events (
  id uuid primary key,
  tenant_id uuid references platform.tenants(id),
  event_type text not null,
  principal text,
  input_text text,
  details text,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table if not exists device.devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  location_id uuid,
  device_type text not null,
  device_subtype text,
  display_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, location_id) references platform.locations(tenant_id, id)
);

create table if not exists device.sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  device_id uuid not null,
  location_id uuid,
  token_hash text,
  permissions text[] not null default array[]::text[],
  last_seen_at timestamptz,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, device_id) references device.devices(tenant_id, id),
  foreign key (tenant_id, location_id) references platform.locations(tenant_id, id)
);

create table if not exists device.pairing_requests (
  id uuid primary key,
  tenant_id uuid not null references platform.tenants(id),
  location_id uuid,
  device_id uuid,
  device_name text,
  pin_hash text,
  pin_salt text,
  status text not null default 'pending',
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, location_id) references platform.locations(tenant_id, id),
  foreign key (tenant_id, device_id) references device.devices(tenant_id, id)
);

create table if not exists device.events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  device_id uuid,
  session_id uuid,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, device_id) references device.devices(tenant_id, id),
  foreign key (tenant_id, session_id) references device.sessions(tenant_id, id)
);

create table if not exists kitchen.stations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  location_id uuid,
  station_key text not null,
  name text not null,
  sort_order integer not null default 0,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, location_id, station_key),
  unique (tenant_id, id),
  foreign key (tenant_id, location_id) references platform.locations(tenant_id, id)
);

create table if not exists kitchen.station_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  location_id uuid,
  name text not null,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, location_id) references platform.locations(tenant_id, id)
);

create table if not exists kitchen.station_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  station_id uuid not null,
  product_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, station_id) references kitchen.stations(tenant_id, id),
  foreign key (tenant_id, product_id) references commerce.products(tenant_id, id)
);

create or replace view kitchen.v_kds_tickets as
select
  o.tenant_id,
  o.id as order_id,
  o.order_number,
  o.status,
  o.total_cents,
  o.created_at,
  o.updated_at,
  jsonb_agg(
    jsonb_build_object(
      'id', oi.id,
      'name', oi.name,
      'quantity', oi.quantity,
      'notes', oi.notes,
      'metadata', oi.metadata
    )
    order by oi.created_at, oi.id
  ) filter (where oi.id is not null) as items
from commerce.orders o
left join commerce.order_items oi on oi.order_id = o.id
group by o.tenant_id, o.id;

create table if not exists grow.leads (like platform.leads including all);
create table if not exists grow.lead_events (like platform.lead_events including all);
create table if not exists grow.product_instances (like platform.product_instances including all);

create table if not exists grow.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references platform.tenants(id),
  plan_key text not null,
  status text not null default 'active',
  provider text,
  provider_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table if not exists grow.feature_flags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references platform.tenants(id),
  flag_key text not null,
  enabled boolean not null default false,
  rules jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, flag_key)
);

commit;
```

### 5.7 RLS, indexes, and service-only grants

RLS is owned by `local-postgres/050_rls_tenant_isolation.sql` (run **last** in
Phase 0): it enables RLS **plus FORCE plus a `tenant_isolation` policy** on every
tenant-scoped table across all six schemas (incl. `platform`/core), with a
self-access policy on `users`. This block no longer enables RLS itself —
enabling RLS without a policy was the G1 bug. It keeps only the service-only
revokes, the request-role table grants (D6), and indexes.

```sql
begin;

-- RLS enablement, FORCE, and tenant_isolation policies are applied by
-- local-postgres/050_rls_tenant_isolation.sql (run last in Phase 0). Do NOT
-- enable RLS here without a policy — that was the G1 bug.

revoke all on all tables in schema queue from umi_app;
revoke all on all tables in schema observability from umi_app;
revoke all on all tables in schema grow from umi_app;

-- D6: request role gets table privileges; 050 adds RLS row-scoping on top.
grant select, insert, update, delete on all tables in schema comms to umi_app;
grant select, insert, update, delete on all tables in schema cash to umi_app;
grant select, insert, update, delete on all tables in schema commerce to umi_app;
grant select, insert, update, delete on all tables in schema device to umi_app;
grant select, insert, update, delete on all tables in schema kitchen to umi_app;

create index if not exists comms_conversations_tenant_idx on comms.conversations (tenant_id, last_message_at desc);
create index if not exists comms_messages_conversation_idx on comms.messages (conversation_id, created_at);
create index if not exists queue_jobs_claim_idx on queue.jobs (status, run_at) where status in ('pending', 'retry');
create index if not exists queue_outbox_status_idx on queue.outbox_events (status, created_at);
create index if not exists device_sessions_tenant_active_idx on device.sessions (tenant_id, is_active, last_seen_at desc);
create index if not exists kitchen_stations_tenant_idx on kitchen.stations (tenant_id, location_id, station_key);

commit;
```

### 5.8 Phase 0 verification

Phase 0 must not change source row counts or money totals.

```sql
with current_counts as (
  select 'umi_cash.LoyaltyCard' as check_name,
         count(*)::bigint as row_count,
         coalesce(sum("balanceCentavos"), 0)::bigint as total_cents
  from umi_cash."LoyaltyCard"
  union all
  select 'umi_cash.Transaction', count(*), coalesce(sum("amountCentavos"), 0)
  from umi_cash."Transaction"
  union all
  select 'conversaflow.transactions', count(*),
         coalesce(sum(round(coalesce(total_amount, 0) * 100)::bigint), 0)
  from conversaflow.transactions
  union all
  select 'kds.tickets', count(*), coalesce(sum(total_cents), 0)
  from kds.tickets
)
select *
from current_counts
order by check_name;

select schema_name
from (values
  ('_migration'), ('comms'), ('queue'), ('device'), ('kitchen'), ('grow'), ('observability')
) expected(schema_name)
where not exists (
  select 1
  from information_schema.schemata s
  where s.schema_name = expected.schema_name
);
```

Expected: no missing schemas and source totals unchanged from preflight.

### 5.9 Phase 0 rollback

Only DDL created in Phase 0 is removed. Do not use `cascade`.

```sql
begin;

drop view if exists kitchen.v_kds_tickets;

-- Only run these drops if Phase 1 has not started.
drop trigger if exists cash_points_ledger_apply_balance on cash.points_ledger;
drop trigger if exists cash_points_ledger_append_only on cash.points_ledger;
drop trigger if exists cash_gift_card_ledger_append_only on cash.gift_card_ledger;
drop trigger if exists cash_wallet_transactions_append_only on cash.wallet_transactions;

drop table if exists kitchen.station_assignments;
drop table if exists kitchen.station_groups;
drop table if exists kitchen.stations;
drop table if exists device.events;
drop table if exists device.pairing_requests;
drop table if exists device.sessions;
drop table if exists device.devices;
drop table if exists queue.dead_letters;
drop table if exists queue.idempotency_keys;
drop table if exists queue.inbound_events;
drop table if exists queue.outbox_events;
drop table if exists queue.job_attempts;
drop table if exists queue.jobs;
drop table if exists comms.knowledge_chunks;
drop table if exists comms.knowledge_documents;
drop table if exists comms.daily_summaries;
drop table if exists comms.conversation_outcomes;
drop table if exists comms.customer_preferences;
drop table if exists comms.memory_items;
drop table if exists comms.tool_calls;
drop table if exists comms.conversation_turns;
drop table if exists comms.messages;
drop table if exists comms.conversations;
drop table if exists commerce.product_modifiers;
drop table if exists commerce.product_modifier_groups;
drop table if exists commerce.product_categories;
drop table if exists cash.balances;
drop table if exists cash.points_ledger;
drop table if exists cash.automation_rules;
drop table if exists cash.gift_card_ledger;
drop table if exists grow.feature_flags;
drop table if exists grow.subscriptions;
drop table if exists grow.product_instances;
drop table if exists grow.lead_events;
drop table if exists grow.leads;

drop schema if exists kitchen;
drop schema if exists device;
drop schema if exists queue;
drop schema if exists comms;
drop schema if exists grow;

commit;
```

Leave `_migration` if any preflight or audit rows exist.

Rollback warning: Roll back in reverse order only (Phase 4→3→2→1→0).
Cross-phase rollbacks will leave dangling references.

---

## 6. Phase 1 - `umi_cash` to `platform` + `cash`

Goal: migrate every `umi_cash` row to the correct tenant in `platform` and
`cash`. This is the money move.

Phase 1 does not drop or mutate `umi_cash`.

### 6.1 Start phase and create maps

```sql
begin;

insert into _migration.phase_runs (phase, status, notes)
values ('phase_1_umi_cash_to_platform_cash', 'running', 'Migrate umi_cash text PK data to platform/cash')
returning id;

-- Use the returned id as :phase_run_id in the SQL below.

insert into _migration.tenant_map (
  old_id, old_slug, new_tenant_id, phase_run_id
)
select
  uc.id,
  uc.slug,
  pt.id,
  :phase_run_id
from umi_cash."Tenant" uc
join platform.tenants pt on pt.slug = uc.slug
on conflict (old_schema, old_table, old_id) do update
set new_tenant_id = excluded.new_tenant_id,
    old_slug = excluded.old_slug,
    phase_run_id = excluded.phase_run_id;

insert into _migration.user_map (
  old_id, old_tenant_id, new_tenant_id, new_person_id, role, phone, email,
  phase_run_id
)
select
  u.id,
  u."tenantId",
  tm.new_tenant_id,
  gen_random_uuid(),
  u.role,
  u.phone,
  u.email,
  :phase_run_id
from umi_cash."User" u
join _migration.tenant_map tm
  on tm.old_schema = 'umi_cash'
 and tm.old_table = 'Tenant'
 and tm.old_id = u."tenantId"
on conflict (old_schema, old_table, old_id) do nothing;

insert into _migration.location_map (
  old_id, old_tenant_id, new_tenant_id, new_location_id, phase_run_id
)
select
  l.id,
  l."tenantId",
  tm.new_tenant_id,
  gen_random_uuid(),
  :phase_run_id
from umi_cash."Location" l
join _migration.tenant_map tm on tm.old_id = l."tenantId"
on conflict (old_schema, old_table, old_id) do nothing;

insert into _migration.card_map (
  old_id, old_tenant_id, old_user_id, new_tenant_id, new_person_id,
  new_account_id, new_card_id, card_number, phase_run_id
)
select
  lc.id,
  lc."tenantId",
  lc."userId",
  um.new_tenant_id,
  um.new_person_id,
  gen_random_uuid(),
  gen_random_uuid(),
  lc."cardNumber",
  :phase_run_id
from umi_cash."LoyaltyCard" lc
join _migration.user_map um on um.old_id = lc."userId"
on conflict (old_schema, old_table, old_id) do nothing;

insert into _migration.reward_config_map (
  old_id, old_tenant_id, new_tenant_id, new_reward_config_id, phase_run_id
)
select
  rc.id,
  rc."tenantId",
  tm.new_tenant_id,
  gen_random_uuid(),
  :phase_run_id
from umi_cash."RewardConfig" rc
join _migration.tenant_map tm on tm.old_id = rc."tenantId"
on conflict (old_schema, old_table, old_id) do nothing;

insert into _migration.gift_card_map (
  old_id, old_tenant_id, new_tenant_id, new_gift_card_id, code, phase_run_id
)
select
  gc.id,
  gc."tenantId",
  tm.new_tenant_id,
  gen_random_uuid(),
  gc.code,
  :phase_run_id
from umi_cash."GiftCard" gc
join _migration.tenant_map tm on tm.old_id = gc."tenantId"
on conflict (old_schema, old_table, old_id) do nothing;

commit;
```

Map completeness check:

```sql
select 'Tenant' as source_table, count(*) source_rows,
       (select count(*) from _migration.tenant_map where old_schema='umi_cash' and old_table='Tenant') mapped_rows,
       0::bigint source_total_cents, 0::bigint mapped_total_cents
from umi_cash."Tenant"
union all
select 'User', count(*),
       (select count(*) from _migration.user_map where old_schema='umi_cash' and old_table='User'),
       0, 0
from umi_cash."User"
union all
select 'Location', count(*),
       (select count(*) from _migration.location_map),
       0, 0
from umi_cash."Location"
union all
select 'LoyaltyCard', count(*),
       (select count(*) from _migration.card_map),
       coalesce(sum("balanceCentavos"), 0)::bigint,
       (select coalesce(sum(lc."balanceCentavos"), 0)::bigint
        from umi_cash."LoyaltyCard" lc
        join _migration.card_map cm on cm.old_id = lc.id)
from umi_cash."LoyaltyCard"
union all
select 'RewardConfig', count(*),
       (select count(*) from _migration.reward_config_map),
       0, 0
from umi_cash."RewardConfig"
union all
select 'GiftCard', count(*),
       (select count(*) from _migration.gift_card_map),
       coalesce(sum("amountCentavos"), 0)::bigint,
       (select coalesce(sum(gc."amountCentavos"), 0)::bigint
        from umi_cash."GiftCard" gc
        join _migration.gift_card_map gm on gm.old_id = gc.id)
from umi_cash."GiftCard";
```

### 6.2 Tenants, locations, people, contact identities

```sql
begin;

update platform.tenants pt
set metadata = coalesce(pt.metadata, '{}'::jsonb) ||
  jsonb_build_object(
    'umi_cash_legacy', jsonb_build_object(
      'tenant_id', uc.id,
      'city', uc.city,
      'card_prefix', uc."cardPrefix",
      'primary_color', uc."primaryColor",
      'secondary_color', uc."secondaryColor",
      'label_color', uc."labelColor",
      'logo_url', uc."logoUrl",
      'strip_image_url', uc."stripImageUrl",
      'pass_style', uc."passStyle",
      'promo_message', uc."promoMessage",
      'promo_days', uc."promoDays",
      'promo_starts_at', uc."promoStartsAt",
      'promo_ends_at', uc."promoEndsAt",
      'self_registration', uc."selfRegistration",
      'topup_enabled', uc."topupEnabled",
      'business_hours', uc."businessHours",
      'birthday_reward_enabled', uc."birthdayRewardEnabled",
      'birthday_reward_name', uc."birthdayRewardName"
    )
  ),
  updated_at = now()
from umi_cash."Tenant" uc
join _migration.tenant_map tm on tm.old_id = uc.id
where pt.id = tm.new_tenant_id;

insert into platform.locations (
  id, tenant_id, slug, name, status, metadata, created_at, updated_at
)
select
  lm.new_location_id,
  lm.new_tenant_id,
  lower(regexp_replace(l.name, '[^a-zA-Z0-9]+', '-', 'g')),
  l.name,
  case when l."isActive" then 'active' else 'archived' end,
  jsonb_build_object(
    'migration', 'umi_cash',
    'old_id', l.id,
    'address', l.address,
    'latitude', l.latitude,
    'longitude', l.longitude
  ),
  now(),
  now()
from umi_cash."Location" l
join _migration.location_map lm on lm.old_id = l.id
on conflict do nothing;

insert into platform.people (
  id, tenant_id, display_name, phone, email, birthday, metadata, created_at, updated_at
)
select
  um.new_person_id,
  um.new_tenant_id,
  coalesce(u.name, 'Unknown'),
  u.phone,
  u.email,
  u."birthDate",
  jsonb_build_object(
    'migration', 'umi_cash',
    'old_user_id', u.id,
    'role', u.role,
    'device', u.device,
    'os', u.os,
    'has_legacy_password_hash', u."passwordHash" is not null
  ),
  u."createdAt",
  u."updatedAt"
from umi_cash."User" u
join _migration.user_map um on um.old_id = u.id
on conflict do nothing;

insert into platform.contact_identities (
  tenant_id, person_id, identity_type, identity_value, normalized_value,
  provider, verification_status, verified_at, confidence, metadata, created_at
)
select
  um.new_tenant_id,
  um.new_person_id,
  'phone',
  u.phone,
  regexp_replace(u.phone, '[^0-9+]', '', 'g'),
  'umi_cash',
  case when u."phoneVerifiedAt" is not null then 'verified' else 'unverified' end,
  u."phoneVerifiedAt",
  case when u."phoneVerifiedAt" is not null then 'otp_verified' else 'source_asserted' end,
  jsonb_build_object('migration', 'umi_cash', 'old_user_id', u.id),
  u."createdAt"
from umi_cash."User" u
join _migration.user_map um on um.old_id = u.id
where u.phone is not null and btrim(u.phone) <> ''
on conflict do nothing;

insert into platform.contact_identities (
  tenant_id, person_id, identity_type, identity_value, normalized_value,
  provider, verification_status, confidence, metadata, created_at
)
select
  um.new_tenant_id,
  um.new_person_id,
  'email',
  u.email,
  lower(u.email),
  'umi_cash',
  'unverified',
  'source_asserted',
  jsonb_build_object('migration', 'umi_cash', 'old_user_id', u.id),
  u."createdAt"
from umi_cash."User" u
join _migration.user_map um on um.old_id = u.id
where u.email is not null and btrim(u.email) <> ''
on conflict do nothing;

commit;
```

### 6.3 Cash programs, accounts, cards, passes

```sql
begin;

insert into cash.wallet_programs (
  tenant_id, name, card_prefix, topup_enabled, pass_style, branding, status,
  created_at, updated_at
)
select
  tm.new_tenant_id,
  uc.name || ' Wallet',
  uc."cardPrefix",
  uc."topupEnabled",
  uc."passStyle",
  jsonb_build_object(
    'migration', 'umi_cash',
    'old_tenant_id', uc.id,
    'primary_color', uc."primaryColor",
    'secondary_color', uc."secondaryColor",
    'label_color', uc."labelColor",
    'logo_url', uc."logoUrl",
    'strip_image_url', uc."stripImageUrl",
    'promo_message', uc."promoMessage",
    'promo_days', uc."promoDays",
    'birthday_reward_enabled', uc."birthdayRewardEnabled",
    'birthday_reward_name', uc."birthdayRewardName"
  ),
  case when uc."subscriptionStatus" in ('ACTIVE', 'TRIAL') then 'active' else 'disabled' end,
  uc."createdAt",
  uc."updatedAt"
from umi_cash."Tenant" uc
join _migration.tenant_map tm on tm.old_id = uc.id
on conflict do nothing;

insert into cash.loyalty_accounts (
  id, tenant_id, person_id, program_id, status, metadata, created_at, updated_at
)
select
  cm.new_account_id,
  cm.new_tenant_id,
  cm.new_person_id,
  wp.id,
  'active',
  jsonb_build_object('migration', 'umi_cash', 'old_card_id', cm.old_id),
  lc."createdAt",
  lc."updatedAt"
from _migration.card_map cm
join umi_cash."LoyaltyCard" lc on lc.id = cm.old_id
left join lateral (
  select id
  from cash.wallet_programs wp
  where wp.tenant_id = cm.new_tenant_id
  order by wp.created_at asc, wp.id asc
  fetch first 1 row only
) wp on true
on conflict do nothing;

insert into cash.loyalty_cards (
  id, tenant_id, loyalty_account_id, card_number, balance_cents,
  total_visits, visits_this_cycle, pending_rewards, qr_token, qr_issued_at,
  status, metadata, created_at, updated_at
)
select
  cm.new_card_id,
  cm.new_tenant_id,
  cm.new_account_id,
  lc."cardNumber",
  lc."balanceCentavos",
  lc."totalVisits",
  lc."visitsThisCycle",
  lc."pendingRewards",
  lc."qrToken",
  lc."qrIssuedAt",
  'active',
  jsonb_build_object(
    'migration', 'umi_cash',
    'old_card_id', lc.id,
    'old_user_id', lc."userId"
  ),
  lc."createdAt",
  lc."updatedAt"
from umi_cash."LoyaltyCard" lc
join _migration.card_map cm on cm.old_id = lc.id
on conflict do nothing;

insert into cash.passes (
  tenant_id, loyalty_card_id, provider, provider_object_id,
  serial_number, auth_token, status, created_at, updated_at
)
select
  cm.new_tenant_id,
  cm.new_card_id,
  'apple',
  null,
  lc."applePassSerial",
  lc."applePassAuthToken",
  'active',
  lc."createdAt",
  lc."updatedAt"
from umi_cash."LoyaltyCard" lc
join _migration.card_map cm on cm.old_id = lc.id
where lc."applePassSerial" is not null
on conflict do nothing;

insert into cash.passes (
  tenant_id, loyalty_card_id, provider, provider_object_id,
  serial_number, auth_token, status, created_at, updated_at
)
select
  cm.new_tenant_id,
  cm.new_card_id,
  'google',
  lc."googlePassObjectId",
  null,
  null,
  'active',
  lc."createdAt",
  lc."updatedAt"
from umi_cash."LoyaltyCard" lc
join _migration.card_map cm on cm.old_id = lc.id
where lc."googlePassObjectId" is not null
on conflict do nothing;

commit;
```

### 6.4 Visits, transactions, rewards, gift cards, OTP, push tokens

Important transaction rule: source values are `TOPUP` and `PURCHASE`, and
`amountCentavos` is already signed. The insert below normalizes only the type
label and never negates `amountCentavos`.

```sql
begin;

insert into cash.visit_events (
  tenant_id, loyalty_card_id, staff_member_id, note, metadata, occurred_at
)
select
  cm.new_tenant_id,
  cm.new_card_id,
  null,
  v.note,
  jsonb_build_object(
    'migration', 'umi_cash',
    'old_visit_id', v.id,
    'old_staff_id', v."staffId"
  ),
  v."scannedAt"
from umi_cash."Visit" v
join _migration.card_map cm on cm.old_id = v."cardId"
on conflict do nothing;

insert into cash.wallet_transactions (
  tenant_id, loyalty_card_id, staff_member_id, type, amount_cents,
  description, idempotency_key, metadata, created_at
)
select
  cm.new_tenant_id,
  cm.new_card_id,
  null,
  case t.type
    when 'TOPUP' then 'topup'
    when 'PURCHASE' then 'purchase'
  end,
  t."amountCentavos",
  t.description,
  'umi_cash.Transaction:' || t.id,
  jsonb_build_object(
    'migration', 'umi_cash',
    'old_transaction_id', t.id,
    'old_type', t.type,
    'old_staff_id', t."staffId",
    'affects_balance', true
  ),
  t."createdAt"
from umi_cash."Transaction" t
join _migration.card_map cm on cm.old_id = t."cardId"
where t.type in ('TOPUP', 'PURCHASE')
on conflict do nothing;

-- Optional stored-value reconciliation entries. These remain in
-- wallet_transactions because they are non-points money movements; loyalty
-- point movements belong in cash.points_ledger.
insert into cash.wallet_transactions (
  tenant_id, loyalty_card_id, staff_member_id, type, amount_cents,
  description, idempotency_key, metadata, created_at
)
select
  cm.new_tenant_id,
  cm.new_card_id,
  null,
  'adjustment',
  lc."balanceCentavos" - coalesce(tx.sum_amount, 0),
  'Migration opening balance reconciliation',
  'umi_cash.LoyaltyCard:opening_balance:' || lc.id,
  jsonb_build_object(
    'migration', 'umi_cash',
    'old_card_id', lc.id,
    'source_balance_centavos', lc."balanceCentavos",
    'source_transaction_sum_centavos', coalesce(tx.sum_amount, 0),
    'affects_balance', true
  ),
  lc."createdAt"
from umi_cash."LoyaltyCard" lc
join _migration.card_map cm on cm.old_id = lc.id
left join lateral (
  select sum(t."amountCentavos")::integer as sum_amount
  from umi_cash."Transaction" t
  where t."cardId" = lc.id
) tx on true
where lc."balanceCentavos" - coalesce(tx.sum_amount, 0) <> 0
on conflict do nothing;

insert into cash.reward_configs (
  id, tenant_id, program_id, visits_required, reward_name,
  reward_description, reward_cost_cents, is_active, activated_at,
  metadata, created_at
)
select
  rm.new_reward_config_id,
  rm.new_tenant_id,
  wp.id,
  rc."visitsRequired",
  rc."rewardName",
  rc."rewardDescription",
  rc."rewardCostCentavos",
  rc."isActive",
  rc."activatedAt",
  jsonb_build_object('migration', 'umi_cash', 'old_reward_config_id', rc.id),
  rc."createdAt"
from umi_cash."RewardConfig" rc
join _migration.reward_config_map rm on rm.old_id = rc.id
left join lateral (
  select id
  from cash.wallet_programs wp
  where wp.tenant_id = rm.new_tenant_id
  order by wp.created_at asc, wp.id asc
  fetch first 1 row only
) wp on true
on conflict do nothing;

insert into cash.reward_redemptions (
  tenant_id, loyalty_card_id, reward_config_id, staff_member_id,
  note, metadata, redeemed_at
)
select
  cm.new_tenant_id,
  cm.new_card_id,
  rm.new_reward_config_id,
  null,
  rr.note,
  jsonb_build_object(
    'migration', 'umi_cash',
    'old_reward_redemption_id', rr.id,
    'old_staff_id', rr."staffId"
  ),
  rr."redeemedAt"
from umi_cash."RewardRedemption" rr
join _migration.card_map cm on cm.old_id = rr."cardId"
join _migration.reward_config_map rm on rm.old_id = rr."configId"
on conflict do nothing;

insert into cash.gift_cards (
  id, tenant_id, code, amount_cents, original_amount_cents,
  created_by_staff_member_id, sender_name, message, recipient_email,
  recipient_phone, recipient_name, redeemed_at, redeemed_loyalty_card_id,
  expires_at, metadata, created_at
)
select
  gm.new_gift_card_id,
  gm.new_tenant_id,
  gc.code,
  gc."amountCentavos",
  gc."amountCentavos",
  null,
  gc."senderName",
  gc.message,
  gc."recipientEmail",
  gc."recipientPhone",
  gc."recipientName",
  gc."redeemedAt",
  redeemed_cm.new_card_id,
  gc."expiresAt",
  jsonb_build_object(
    'migration', 'umi_cash',
    'old_gift_card_id', gc.id,
    'old_created_by_staff_id', gc."createdByStaffId",
    'old_redeemed_card_id', gc."redeemedCardId",
    'is_redeemed', gc."isRedeemed"
  ),
  gc."createdAt"
from umi_cash."GiftCard" gc
join _migration.gift_card_map gm on gm.old_id = gc.id
left join _migration.card_map redeemed_cm on redeemed_cm.old_id = gc."redeemedCardId"
on conflict do nothing;

insert into cash.gift_card_ledger (
  tenant_id, gift_card_id, delta_cents, reason, source_type, source_id,
  idempotency_key, metadata, created_at
)
select
  gm.new_tenant_id,
  gm.new_gift_card_id,
  gc."amountCentavos",
  'migration_initial_balance',
  'umi_cash.GiftCard',
  gc.id,
  'umi_cash.GiftCard:' || gc.id || ':initial',
  jsonb_build_object('migration', 'umi_cash', 'old_gift_card_id', gc.id),
  gc."createdAt"
from umi_cash."GiftCard" gc
join _migration.gift_card_map gm on gm.old_id = gc.id
on conflict do nothing;

insert into cash.otp_verifications (
  tenant_id, person_id, identity_type, identity_value, code_hash,
  expires_at, attempts, verified_at, metadata, created_at
)
select
  tm.new_tenant_id,
  um.new_person_id,
  'phone',
  ov.phone,
  ov."codeHash",
  ov."expiresAt",
  ov.attempts,
  case when ov.verified then ov."createdAt" else null end,
  jsonb_build_object('migration', 'umi_cash', 'old_otp_id', ov.id),
  ov."createdAt"
from umi_cash."OtpVerification" ov
join _migration.tenant_map tm on tm.old_id = ov."tenantId"
left join _migration.user_map um
  on um.new_tenant_id = tm.new_tenant_id
 and regexp_replace(coalesce(um.phone, ''), '[^0-9+]', '', 'g')
   = regexp_replace(ov.phone, '[^0-9+]', '', 'g')
on conflict do nothing;

insert into cash.pass_devices (
  tenant_id, pass_id, device_token, push_token, created_at
)
select
  cm.new_tenant_id,
  p.id,
  apt."deviceToken",
  apt."pushToken",
  apt."createdAt"
from umi_cash."ApplePushToken" apt
join _migration.card_map cm on cm.old_id = apt."cardId"
join cash.passes p
  on p.loyalty_card_id = cm.new_card_id
 and p.provider = 'apple'
on conflict do nothing;

commit;
```

### 6.5 Empty `umi_cash` tables

- `umi_cash."BirthdayReward"` has 0 rows. No data movement. If rows appear
  before execution, migrate to `cash.reward_redemptions` or
  `cash.automation_rules` before Phase 1 can pass.
- `umi_cash."RewardRedemption"` has 0 rows. SQL above is included and should
  still be run; it inserts nothing today.
- `umi_cash."Session"` has 0 rows and is ephemeral auth state. It is not
  migrated. If rows appear, archive counts in `_migration.phase_runs.metadata`;
  do not import session tokens into the target identity store.

### 6.6 Phase 1 verification

All queries return row counts plus balance totals.

```sql
with checks as (
  select 'tenants' as check_name,
    (select count(*) from umi_cash."Tenant") as source_count,
    (select count(*) from _migration.tenant_map where old_schema='umi_cash' and old_table='Tenant') as target_count,
    0::bigint as source_total_cents,
    0::bigint as target_total_cents
  union all
  select 'locations',
    (select count(*) from umi_cash."Location"),
    (select count(*) from platform.locations where metadata->>'migration' = 'umi_cash'),
    0, 0
  union all
  select 'users_to_people',
    (select count(*) from umi_cash."User"),
    (select count(*) from platform.people where metadata->>'migration' = 'umi_cash'),
    0, 0
  union all
  select 'loyalty_cards',
    (select count(*) from umi_cash."LoyaltyCard"),
    (select count(*) from cash.loyalty_cards where metadata->>'migration' = 'umi_cash'),
    (select coalesce(sum("balanceCentavos"), 0)::bigint from umi_cash."LoyaltyCard"),
    (select coalesce(sum(balance_cents), 0)::bigint from cash.loyalty_cards where metadata->>'migration' = 'umi_cash')
  union all
  select 'legacy_transactions',
    (select count(*) from umi_cash."Transaction"),
    (select count(*) from cash.wallet_transactions where metadata->>'old_transaction_id' is not null),
    (select coalesce(sum("amountCentavos"), 0)::bigint from umi_cash."Transaction"),
    (select coalesce(sum(amount_cents), 0)::bigint from cash.wallet_transactions where metadata->>'old_transaction_id' is not null)
  union all
  select 'wallet_ledger_reconciled_to_card_balance',
    (select count(*) from umi_cash."LoyaltyCard"),
    (select count(distinct loyalty_card_id) from cash.wallet_transactions where metadata->>'migration' = 'umi_cash'),
    (select coalesce(sum("balanceCentavos"), 0)::bigint from umi_cash."LoyaltyCard"),
    (select coalesce(sum(amount_cents), 0)::bigint from cash.wallet_transactions where metadata->>'migration' = 'umi_cash')
  union all
  select 'visits',
    (select count(*) from umi_cash."Visit"),
    (select count(*) from cash.visit_events where metadata->>'migration' = 'umi_cash'),
    0, 0
  union all
  select 'reward_configs',
    (select count(*) from umi_cash."RewardConfig"),
    (select count(*) from cash.reward_configs where metadata->>'migration' = 'umi_cash'),
    0, 0
  union all
  select 'reward_redemptions',
    (select count(*) from umi_cash."RewardRedemption"),
    (select count(*) from cash.reward_redemptions where metadata->>'migration' = 'umi_cash'),
    0, 0
  union all
  select 'gift_cards',
    (select count(*) from umi_cash."GiftCard"),
    (select count(*) from cash.gift_cards where metadata->>'migration' = 'umi_cash'),
    (select coalesce(sum("amountCentavos"), 0)::bigint from umi_cash."GiftCard"),
    (select coalesce(sum(amount_cents), 0)::bigint from cash.gift_cards where metadata->>'migration' = 'umi_cash')
  union all
  select 'gift_card_ledger',
    (select count(*) from umi_cash."GiftCard"),
    (select count(*) from cash.gift_card_ledger where metadata->>'migration' = 'umi_cash'),
    (select coalesce(sum("amountCentavos"), 0)::bigint from umi_cash."GiftCard"),
    (select coalesce(sum(delta_cents), 0)::bigint from cash.gift_card_ledger where metadata->>'migration' = 'umi_cash')
  union all
  select 'otp',
    (select count(*) from umi_cash."OtpVerification"),
    (select count(*) from cash.otp_verifications where metadata->>'migration' = 'umi_cash'),
    0, 0
  union all
  select 'apple_push_tokens',
    (select count(*) from umi_cash."ApplePushToken"),
    (select count(*) from cash.pass_devices pd join cash.passes p on p.id = pd.pass_id where p.provider = 'apple'),
    0, 0
)
select *,
  source_count = target_count as row_count_ok,
  source_total_cents = target_total_cents as balance_ok
from checks
order by check_name;
```

Orphan checks:

```sql
select 'card_without_person' as check_name, count(*) as failures
from _migration.card_map cm
left join platform.people p on p.id = cm.new_person_id
where p.id is null
union all
select 'card_without_account', count(*)
from _migration.card_map cm
left join cash.loyalty_accounts la on la.id = cm.new_account_id
where la.id is null
union all
select 'transaction_bad_type', count(*)
from umi_cash."Transaction"
where type not in ('TOPUP', 'PURCHASE');
```

Expected: all `row_count_ok` and `balance_ok` are true; all orphan failures are
0. Mark phase verified:

```sql
update _migration.phase_runs
set status = 'verified', finished_at = now()
where id = :phase_run_id;
```

### 6.7 Phase 1 rollback

Rollback deletes rows created from `umi_cash` using metadata and mapping tables.
It does not delete existing platform rows.

```sql
begin;

delete from cash.pass_devices pd
using cash.passes p
where pd.pass_id = p.id
  and p.loyalty_card_id in (select new_card_id from _migration.card_map);

delete from cash.passes
where loyalty_card_id in (select new_card_id from _migration.card_map);

delete from cash.gift_card_ledger
where metadata->>'migration' = 'umi_cash';

delete from cash.gift_cards
where id in (select new_gift_card_id from _migration.gift_card_map);

delete from cash.reward_redemptions
where metadata->>'migration' = 'umi_cash';

delete from cash.reward_configs
where id in (select new_reward_config_id from _migration.reward_config_map);

delete from cash.wallet_transactions
where metadata->>'migration' = 'umi_cash';

delete from cash.visit_events
where metadata->>'migration' = 'umi_cash';

delete from cash.loyalty_cards
where id in (select new_card_id from _migration.card_map);

delete from cash.loyalty_accounts
where id in (select new_account_id from _migration.card_map);

delete from cash.wallet_programs
where branding->>'migration' = 'umi_cash';

delete from platform.contact_identities
where metadata->>'migration' = 'umi_cash';

delete from platform.staff_members
where metadata->>'migration' = 'umi_cash';

delete from platform.people
where id in (select new_person_id from _migration.user_map);

delete from platform.locations
where id in (select new_location_id from _migration.location_map);

update platform.tenants
set metadata = metadata - 'umi_cash_legacy',
    updated_at = now()
where id in (select new_tenant_id from _migration.tenant_map);

update _migration.phase_runs
set status = 'rolled_back', finished_at = now()
where id = :phase_run_id;

commit;
```

Keep mapping tables after rollback unless a re-run deliberately starts from a
clean map snapshot.

---

## 7. Phase 2 - Identity Unification

Goal: merge `conversaflow.customers` into `platform.people` and connect
conversation rows to people through `_migration.conversaflow_customer_map`.

Prerequisite: every `conversaflow.businesses.id` has a row in
`_migration.business_tenant_map`.

### 7.1 Business-to-tenant map

Manual mapping is preferred unless a trustworthy external reference exists.
For the current database there is 1 ConversaFlow business.

```sql
-- Operator-reviewed seed example. Replace values from production inspection.
-- No LIMIT 1 is allowed.
insert into _migration.business_tenant_map (
  source_schema, source_table, source_business_id, tenant_id, tenant_slug,
  mapping_strategy, notes
)
select
  'conversaflow',
  'businesses',
  b.id,
  t.id,
  t.slug,
  'manual',
  'Reviewed before Phase 2 execution'
from conversaflow.businesses b
join platform.tenants t on t.slug = :verified_tenant_slug
where b.id = :verified_conversaflow_business_id
on conflict (source_schema, source_table, source_business_id) do update
set tenant_id = excluded.tenant_id,
    tenant_slug = excluded.tenant_slug,
    mapping_strategy = excluded.mapping_strategy,
    notes = excluded.notes;
```

Completeness:

```sql
select b.id, b.name
from conversaflow.businesses b
left join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 and m.source_table = 'businesses'
 and m.source_business_id = b.id
where m.source_business_id is null;
```

Expected: 0 rows.

### 7.2 Merge customers into people

```sql
begin;

insert into _migration.phase_runs (phase, status, notes)
values ('phase_2_identity_unification', 'running', 'Merge conversaflow.customers into platform.people')
returning id;

-- Use returned id as :phase_run_id.

insert into platform.people (
  id, tenant_id, display_name, phone, metadata, created_at, updated_at
)
select
  gen_random_uuid(),
  m.tenant_id,
  coalesce(c.name, 'Unknown'),
  c.phone,
  jsonb_build_object(
    'migration', 'conversaflow',
    'old_customer_id', c.id,
    'old_business_id', c.business_id
  ),
  c.created_at,
  now()
from conversaflow.customers c
join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 and m.source_business_id = c.business_id
where not exists (
  select 1
  from platform.contact_identities ci
  where ci.tenant_id = m.tenant_id
    and ci.identity_type in ('phone', 'whatsapp')
    and ci.normalized_value = regexp_replace(c.phone, '[^0-9+]', '', 'g')
);

insert into _migration.conversaflow_customer_map (
  old_customer_id, old_business_id, tenant_id, person_id, match_strategy
)
select
  c.id,
  c.business_id,
  m.tenant_id,
  coalesce(existing.person_id, created.id),
  case when existing.person_id is not null then 'existing_contact_identity_phone'
       else 'created_from_conversaflow_customer'
  end
from conversaflow.customers c
join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 and m.source_business_id = c.business_id
left join lateral (
  select ci.person_id
  from platform.contact_identities ci
  where ci.tenant_id = m.tenant_id
    and ci.identity_type in ('phone', 'whatsapp')
    and ci.normalized_value = regexp_replace(c.phone, '[^0-9+]', '', 'g')
  order by ci.verification_status = 'verified' desc, ci.created_at asc
  fetch first 1 row only
) existing on true
left join lateral (
  select p.id
  from platform.people p
  where p.tenant_id = m.tenant_id
    and p.metadata->>'old_customer_id' = c.id::text
  fetch first 1 row only
) created on true
on conflict (old_customer_id) do update
set person_id = excluded.person_id,
    match_strategy = excluded.match_strategy;

insert into platform.contact_identities (
  tenant_id, person_id, identity_type, identity_value, normalized_value,
  provider, verification_status, confidence, metadata, created_at
)
select
  cm.tenant_id,
  cm.person_id,
  'whatsapp',
  c.phone,
  regexp_replace(c.phone, '[^0-9+]', '', 'g'),
  'conversaflow',
  'unverified',
  'source_asserted',
  jsonb_build_object('migration', 'conversaflow', 'old_customer_id', c.id),
  c.created_at
from conversaflow.customers c
join _migration.conversaflow_customer_map cm on cm.old_customer_id = c.id
where c.phone is not null and btrim(c.phone) <> ''
on conflict do nothing;

-- dashboard_users are login/membership data, not people.
insert into platform.tenant_memberships (
  tenant_id, user_id, status, created_at, updated_at
)
select
  m.tenant_id,
  du.auth_user_id,
  'active',
  du.created_at,
  now()
from conversaflow.dashboard_users du
join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 and m.source_business_id = du.business_id
where exists (select 1 from platform.users u where u.id = du.auth_user_id)
on conflict do nothing;

commit;
```

If `dashboard_users.auth_user_id` is an `auth.users.id` but not a
`platform.users.id`, insert a `platform.users` row first after confirming the
platform user table's auth-subject column shape.

### 7.3 Phase 2 verification

```sql
with checks as (
  select 'conversaflow_customers_to_people' as check_name,
    (select count(*) from conversaflow.customers) as source_count,
    (select count(*) from _migration.conversaflow_customer_map) as target_count,
    0::bigint as source_total_cents,
    0::bigint as target_total_cents
  union all
  select 'customer_preferences_balance_context',
    (select count(*) from conversaflow.customer_preferences),
    (select count(*) from conversaflow.customer_preferences cp
      join _migration.conversaflow_customer_map cm on cm.old_customer_id = cp.customer_id),
    (select coalesce(sum(round(coalesce(avg_transaction_value, 0) * coalesce(total_transactions, 0) * 100)::bigint), 0)
      from conversaflow.customer_preferences),
    (select coalesce(sum(round(coalesce(cp.avg_transaction_value, 0) * coalesce(cp.total_transactions, 0) * 100)::bigint), 0)
      from conversaflow.customer_preferences cp
      join _migration.conversaflow_customer_map cm on cm.old_customer_id = cp.customer_id)
)
select *,
  source_count = target_count as row_count_ok,
  source_total_cents = target_total_cents as balance_ok
from checks;

select 'unmapped_conversaflow_customer' as check_name, count(*) as failures
from conversaflow.customers c
left join _migration.conversaflow_customer_map cm on cm.old_customer_id = c.id
where cm.old_customer_id is null;
```

Expected: all booleans true; failures = 0.

### 7.4 Phase 2 rollback

```sql
begin;

delete from platform.contact_identities
where metadata->>'migration' = 'conversaflow'
  and metadata ? 'old_customer_id';

delete from platform.tenant_memberships tm
using conversaflow.dashboard_users du, _migration.business_tenant_map m
where m.source_schema = 'conversaflow'
  and m.source_business_id = du.business_id
  and tm.tenant_id = m.tenant_id
  and tm.user_id = du.auth_user_id;

delete from platform.people
where metadata->>'migration' = 'conversaflow'
  and metadata ? 'old_customer_id';

delete from _migration.conversaflow_customer_map;

update _migration.phase_runs
set status = 'rolled_back', finished_at = now()
where id = :phase_run_id;

commit;
```

---

## 8. Phase 3 - Split `conversaflow`

Goal: copy ConversaFlow data into domain targets:

- ops/order data -> `commerce`
- AI conversations/memory -> `comms`
- async infrastructure -> `queue`
- exhaust/audit/logs -> `observability`

The `conversaflow` source schema remains intact for rollback and compatibility.

### 8.1 Ops/order data to `commerce`

```sql
begin;

insert into _migration.phase_runs (phase, status, notes)
values ('phase_3_conversaflow_split', 'running', 'Split conversaflow into commerce/comms/queue/observability')
returning id;

-- Use returned id as :phase_run_id.

insert into commerce.businesses (
  id, tenant_id, name, business_type, config, open_times,
  source_schema, source_id, created_at
)
select
  b.id,
  m.tenant_id,
  b.name,
  b.business_type,
  coalesce(b.config, '{}'::jsonb),
  coalesce(b.open_times, '{}'::jsonb),
  'conversaflow',
  b.id,
  now()
from conversaflow.businesses b
join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 and m.source_business_id = b.id
on conflict (source_schema, source_id) do nothing;

insert into commerce.channels (
  id, tenant_id, channel_key, name, status, metadata
)
select
  c.id,
  m.tenant_id,
  coalesce(c.key, c.id::text),
  c.name,
  coalesce(c.status, 'active'),
  jsonb_build_object('migration', 'conversaflow', 'old_channel_id', c.id)
from conversaflow.channels c
join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 -- If channels do not carry business_id in live DDL, operator must provide tenant mapping.
 and m.source_business_id = coalesce((c.config->>'business_id')::uuid, m.source_business_id)
on conflict do nothing;

insert into commerce.channel_accounts (
  id, tenant_id, channel_id, provider, provider_account_id, address, config,
  status, source_schema, source_id, created_at
)
select
  ca.id,
  m.tenant_id,
  ca.channel_id,
  ca.provider,
  ca.provider_account_id,
  ca.address,
  coalesce(ca.config, '{}'::jsonb),
  coalesce(ca.status, 'active'),
  'conversaflow',
  ca.id,
  ca.created_at
from conversaflow.channel_accounts ca
join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 and m.source_business_id = coalesce(ca.business_id, m.source_business_id)
on conflict do nothing;

insert into commerce.products (
  id, tenant_id, business_id, name, price_cents, category, available,
  zettle_uuid, description, variants, metadata, synced_at, source_schema,
  source_id, created_at
)
select
  p.id,
  m.tenant_id,
  p.business_id,
  p.name,
  round(coalesce(p.price, 0) * 100)::integer,
  p.category,
  coalesce(p.available, true),
  p.zettle_uuid,
  p.description,
  coalesce(p.variants, '[]'::jsonb),
  jsonb_build_object('migration', 'conversaflow', 'old_product_id', p.id),
  p.synced_at,
  'conversaflow',
  p.id,
  coalesce(p.synced_at, now())
from conversaflow.products p
join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 and m.source_business_id = p.business_id
on conflict (source_schema, source_id) do nothing;

insert into commerce.orders (
  id, tenant_id, contact_id, order_number, source_product, source_ref,
  status, channel, currency, subtotal_cents, tax_cents, discount_cents,
  total_cents, notes, metadata, placed_at, created_at, updated_at
)
select
  t.id,
  m.tenant_id,
  null,
  null,
  'conversaflow',
  t.id::text,
  coalesce(t.status, 'pending'),
  'whatsapp',
  'MXN',
  round(coalesce(t.total_amount, 0) * 100)::integer,
  0,
  0,
  round(coalesce(t.total_amount, 0) * 100)::integer,
  null,
  jsonb_build_object(
    'migration', 'conversaflow',
    'old_transaction_id', t.id,
    'old_customer_id', t.customer_id,
    'transaction_type', t.transaction_type,
    'service_id', t.service_id,
    'details', t.details,
    'slack_message_ts', t.slack_message_ts
  ),
  t.created_at,
  t.created_at,
  now()
from conversaflow.transactions t
join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 and m.source_business_id = t.business_id
on conflict do nothing;

insert into _migration.order_map (
  source_schema, source_table, source_id, tenant_id, order_id, phase_run_id
)
select
  'conversaflow',
  'transactions',
  t.id::text,
  m.tenant_id,
  t.id,
  :phase_run_id
from conversaflow.transactions t
join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 and m.source_business_id = t.business_id
on conflict (source_schema, source_table, source_id) do nothing;

insert into commerce.order_events (
  tenant_id, order_id, event_type, previous_status, next_status,
  payload, occurred_at
)
select
  om.tenant_id,
  om.order_id,
  'status_changed',
  e.old_status,
  e.new_status,
  jsonb_build_object(
    'migration', 'conversaflow',
    'old_transaction_status_event_id', e.id,
    'acted_by_slack_user', e.acted_by_slack_user,
    'acted_in_channel', e.acted_in_channel
  ),
  e.acted_at
from conversaflow.transaction_status_events e
join _migration.order_map om
  on om.source_schema = 'conversaflow'
 and om.source_table = 'transactions'
 and om.source_id = e.transaction_id::text
on conflict do nothing;

commit;
```

If live `conversaflow.channels` or `channel_accounts` lack enough tenant data,
do not run those two inserts until `_migration.business_tenant_map` is extended
for each row. Zero-row tables can also be left empty with a verified count of 0.

### 8.2 Conversations and memory to `comms`

```sql
begin;

insert into comms.conversations (
  id, tenant_id, person_id, business_id, status, current_state, state_data,
  conversation_history, metadata, created_at, last_message_at
)
select
  c.id,
  m.tenant_id,
  cm.person_id,
  c.business_id,
  c.status,
  c.current_state,
  coalesce(c.state_data, '{}'::jsonb),
  coalesce(c.conversation_history, '[]'::jsonb),
  jsonb_build_object(
    'migration', 'conversaflow',
    'old_conversation_id', c.id,
    'history_migrated', c.history_migrated,
    'draft_cart', c.draft_cart,
    'state_version', c.state_version,
    'draft_cart_version', c.draft_cart_version,
    'pending_clarification', c.pending_clarification,
    'summary', c.summary
  ),
  c.created_at,
  c.last_message_at
from conversaflow.conversations c
join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 and m.source_business_id = c.business_id
left join _migration.conversaflow_customer_map cm on cm.old_customer_id = c.customer_id
on conflict do nothing;

insert into comms.messages (
  id, tenant_id, conversation_id, person_id, role, content, intent,
  entities, metadata, created_at
)
select
  msg.id,
  conv.tenant_id,
  msg.conversation_id,
  conv.person_id,
  msg.role,
  msg.content,
  msg.intent,
  coalesce(msg.entities, '{}'::jsonb),
  jsonb_build_object(
    'migration', 'conversaflow',
    'old_message_id', msg.id,
    'message_index', msg.message_index,
    'twilio_message_sid', msg.twilio_message_sid,
    'embedding_model', msg.embedding_model,
    'embedding_present', msg.embedding is not null
  ),
  msg.created_at
from conversaflow.messages msg
join comms.conversations conv on conv.id = msg.conversation_id
on conflict do nothing;

insert into comms.conversation_turns (
  id, tenant_id, conversation_id, person_id, status, metadata, created_at
)
select
  ct.id,
  conv.tenant_id,
  ct.conversation_id,
  cm.person_id,
  ct.status,
  jsonb_build_object(
    'migration', 'conversaflow',
    'old_turn_id', ct.id,
    'source_message_ids', ct.source_message_ids,
    'merged_user_text', ct.merged_user_text,
    'integrity_decision', ct.integrity_decision,
    'integrity_reason', ct.integrity_reason,
    'base_state_version', ct.base_state_version,
    'first_message_at', ct.first_message_at,
    'last_message_at', ct.last_message_at,
    'hold_until', ct.hold_until,
    'released_at', ct.released_at,
    'processed_at', ct.processed_at,
    'superseded_at', ct.superseded_at,
    'extracted_intent', ct.extracted_intent,
    'reconciled_action', ct.reconciled_action,
    'assistant_message_id', ct.assistant_message_id
  ),
  ct.created_at
from conversaflow.conversation_turns ct
join comms.conversations conv on conv.id = ct.conversation_id
left join _migration.conversaflow_customer_map cm on cm.old_customer_id = ct.customer_id
on conflict do nothing;

insert into comms.customer_preferences (
  tenant_id, person_id, old_customer_id, favorite_services,
  usual_modifications, total_transactions, avg_transaction_value,
  last_transaction_at, facts, updated_at
)
select
  cm.tenant_id,
  cm.person_id,
  cp.customer_id,
  cp.favorite_services,
  coalesce(cp.usual_modifications, '[]'::jsonb),
  cp.total_transactions,
  cp.avg_transaction_value,
  cp.last_transaction_at,
  coalesce(cp.facts, '{}'::jsonb),
  cp.updated_at
from conversaflow.customer_preferences cp
join _migration.conversaflow_customer_map cm on cm.old_customer_id = cp.customer_id
on conflict (tenant_id, person_id) do update
set favorite_services = excluded.favorite_services,
    usual_modifications = excluded.usual_modifications,
    total_transactions = excluded.total_transactions,
    avg_transaction_value = excluded.avg_transaction_value,
    last_transaction_at = excluded.last_transaction_at,
    facts = excluded.facts,
    updated_at = excluded.updated_at;

insert into comms.conversation_outcomes (
  id, tenant_id, conversation_id, person_id, outcome, payload, created_at
)
select
  co.id,
  m.tenant_id,
  co.conversation_id,
  cm.person_id,
  co.outcome,
  jsonb_build_object(
    'migration', 'conversaflow',
    'turn_count', co.turn_count,
    'duration_seconds', co.duration_seconds,
    'total_tokens', co.total_tokens,
    'total_cost_usd', co.total_cost_usd,
    'products_discussed', co.products_discussed,
    'notes', co.notes
  ),
  co.created_at
from conversaflow.conversation_outcomes co
join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 and m.source_business_id = co.business_id
left join _migration.conversaflow_customer_map cm on cm.old_customer_id = co.customer_id
on conflict do nothing;

insert into comms.daily_summaries (
  id, tenant_id, business_id, summary_date, slack_channel,
  slack_message_ts, pinned, created_at, last_updated_at
)
select
  ds.id,
  m.tenant_id,
  ds.business_id::uuid,
  ds.summary_date,
  ds.slack_channel,
  ds.slack_message_ts,
  ds.pinned,
  ds.created_at,
  ds.last_updated_at
from conversaflow.daily_summaries ds
join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 and m.source_business_id = ds.business_id::uuid
on conflict do nothing;

commit;
```

`conversaflow.memory_items` and `conversaflow.tool_calls` currently have 0 rows.
The target tables exist; verification must show source and target counts both 0.

### 8.3 Jobs/outbox/webhooks to `queue`

```sql
begin;

with resolved_jobs as (
  select
    j.*,
    nullif(j.payload->>'business_id', '')::uuid as resolved_business_id
  from conversaflow.jobs j
)
insert into queue.jobs (
  id, tenant_id, source_schema, source_table, source_id, job_type,
  payload, status, run_at, locked_by, locked_at, attempts, max_attempts,
  error, created_at
)
select
  j.id,
  m.tenant_id,
  'conversaflow',
  'jobs',
  j.id::text,
  j.type,
  coalesce(j.payload, '{}'::jsonb),
  j.status,
  j.run_at,
  j.locked_by,
  j.locked_at,
  coalesce(j.attempts, 0),
  coalesce(j.max_attempts, 3),
  j.error,
  j.created_at
from resolved_jobs j
left join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 and m.source_business_id = j.resolved_business_id
on conflict (source_schema, source_table, source_id) do nothing;

with resolved_workflow_jobs as (
  select
    wj.*,
    nullif(wj.payload->>'business_id', '')::uuid as resolved_business_id
  from conversaflow.workflow_jobs wj
)
insert into queue.jobs (
  id, tenant_id, source_schema, source_table, source_id, job_type,
  payload, status, run_at, locked_by, locked_at, attempts, max_attempts,
  error, created_at
)
select
  wj.id,
  m.tenant_id,
  'conversaflow',
  'workflow_jobs',
  wj.id::text,
  wj.job_type,
  coalesce(wj.payload, '{}'::jsonb),
  wj.state,
  wj.next_run_at,
  wj.locked_by,
  wj.locked_at,
  coalesce(wj.attempt_count, 0),
  coalesce(wj.max_attempts, 3),
  wj.error,
  wj.created_at
from resolved_workflow_jobs wj
left join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 and m.source_business_id = wj.resolved_business_id
on conflict (source_schema, source_table, source_id) do nothing;

insert into queue.job_attempts (
  id, tenant_id, queue_job_id, source_schema, source_table, source_id,
  attempt, started_at, finished_at, outcome, error, metadata
)
select
  ja.id,
  qj.tenant_id,
  qj.id,
  'conversaflow',
  'job_attempts',
  ja.id,
  ja.attempt,
  ja.started_at,
  ja.finished_at,
  ja.outcome,
  ja.error,
  coalesce(ja.metadata, '{}'::jsonb)
from conversaflow.job_attempts ja
join queue.jobs qj
  on qj.source_schema = 'conversaflow'
 and qj.source_table = 'jobs'
 and qj.source_id = ja.job_id::text
on conflict (source_schema, source_table, source_id) do nothing;

insert into queue.outbox_events (
  id, tenant_id, event_type, payload, status, idempotency_key,
  published_at, created_at
)
select
  o.id,
  m.tenant_id,
  o.kind,
  coalesce(o.payload, '{}'::jsonb),
  o.state,
  o.idempotency_key,
  o.delivered_at,
  o.created_at
from conversaflow.outbox o
left join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 and m.source_business_id = coalesce((o.payload->>'business_id')::uuid, m.source_business_id)
on conflict do nothing;

insert into queue.inbound_events (
  id, tenant_id, provider, provider_event_id, event_type, payload_hash,
  payload, status, request_id, received_at, completed_at, error
)
select
  ie.id,
  m.tenant_id,
  ie.source,
  ie.source_event_id,
  ie.event_type,
  ie.payload_hash,
  ie.payload,
  ie.status,
  ie.request_id,
  ie.received_at,
  ie.completed_at,
  ie.error
from conversaflow.inbound_events ie
join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 and m.source_business_id = ie.business_id
on conflict do nothing;

commit;
```

### 8.4 Exhaust to `observability`

```sql
begin;

insert into observability.ai_runs (
  id, tenant_id, conversation_id, person_id, model, prompt_tokens,
  completion_tokens, total_tokens, cost_usd, latency_ms, response_type,
  metadata, request_id, created_at
)
select
  a.id,
  m.tenant_id,
  a.conversation_id,
  cm.person_id,
  a.model,
  a.prompt_tokens,
  a.completion_tokens,
  a.total_tokens,
  a.cost_usd,
  a.latency_ms,
  a.response_type,
  jsonb_build_object(
    'migration', 'conversaflow',
    'prompt_version', a.prompt_version,
    'products_referenced', a.products_referenced,
    'customer_context', a.customer_context,
    'metadata', a.metadata
  ),
  a.request_id,
  a.created_at
from conversaflow.ai_turn_logs a
left join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 and m.source_business_id = a.business_id
left join _migration.conversaflow_customer_map cm on cm.old_customer_id = a.customer_id
on conflict do nothing;

insert into observability.edge_logs (
  id, tenant_id, function_name, status, duration_ms, error_message,
  error_stack, metadata, request_id, created_at
)
select
  e.id,
  null,
  e.function_name,
  e.status,
  e.duration_ms,
  e.error_message,
  e.error_stack,
  coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object('migration', 'conversaflow'),
  e.request_id,
  e.created_at
from conversaflow.edge_function_logs e
on conflict do nothing;

insert into observability.pipeline_traces (
  id, tenant_id, product_key, trace_id, conversation_id, stage, event,
  detail, error, occurred_at
)
select
  p.id,
  m.tenant_id,
  'conversaflow',
  p.trace_id,
  p.conversation_id,
  p.stage,
  p.event,
  coalesce(p.detail, '{}'::jsonb),
  p.error,
  p.ts
from conversaflow.pipeline_traces p
left join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 and m.source_business_id = nullif(p.business_id, '')::uuid
on conflict do nothing;

insert into observability.evaluation_traces (
  id, tenant_id, product_key, source_schema, source_table, source_id,
  source_conversation_id, source_turn_id, conversation_id, turn_id,
  evaluation_kind, agreement, detail, occurred_at
)
select
  e.id,
  m.tenant_id,
  'conversaflow',
  'conversaflow',
  'eval_traces',
  e.id::text,
  e.conversation_id::text,
  e.turn_id::text,
  e.conversation_id,
  e.turn_id,
  'conversation_eval',
  e.agreement,
  jsonb_build_object(
    'authoritative_decision', e.authoritative_decision,
    'harness_decision', e.harness_decision,
    'metadata', e.metadata,
    'turn_sequence', e.turn_sequence
  ),
  e.created_at
from conversaflow.eval_traces e
left join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 and m.source_business_id = e.business_id
on conflict do nothing;

insert into observability.security_events (
  id, tenant_id, event_type, principal, input_text, details,
  request_id, metadata, occurred_at
)
select
  s.id,
  null,
  s.event_type,
  s.phone,
  s.input_text,
  s.details,
  s.request_id,
  jsonb_build_object('migration', 'conversaflow'),
  coalesce(s.timestamp, s.created_at)
from conversaflow.security_logs s
on conflict do nothing;

insert into observability.audit_log (
  tenant_id, action, subject_schema, subject_table, subject_id, payload, occurred_at
)
select
  m.tenant_id,
  'business_config_changed',
  'commerce',
  'businesses',
  bcc.business_id,
  jsonb_build_object(
    'migration', 'conversaflow',
    'slack_user_id', bcc.slack_user_id,
    'previous_config', bcc.previous_config,
    'new_config', bcc.new_config
  ),
  bcc.changed_at
from conversaflow.business_config_changes bcc
join _migration.business_tenant_map m
  on m.source_schema = 'conversaflow'
 and m.source_business_id = bcc.business_id::uuid
on conflict do nothing;

commit;
```

`observability.data_quality_findings`, `observability.evaluation_traces`, and
`observability.pipeline_traces` currently have 0 source rows in the old
`observability` schema. They stay in place; no data movement is required.

### 8.5 Empty and zero-row ConversaFlow tables

- `channel_accounts`, `channels`, `conversation_outcomes`, `memory_items`,
  `tool_calls`, and `zettle_oauth_tokens` currently have 0 rows. Target tables
  exist; verification must show 0 -> 0.
- If `zettle_oauth_tokens` gains rows before execution, do not copy cleartext
  tokens into app-exposed schemas. Move to Vault or a service-only
  `commerce.integration_tokens` table.

### 8.6 Phase 3 verification

```sql
with checks as (
  select 'businesses' check_name,
    (select count(*) from conversaflow.businesses) source_count,
    (select count(*) from commerce.businesses where source_schema='conversaflow') target_count,
    0::bigint source_total_cents, 0::bigint target_total_cents
  union all
  select 'products',
    (select count(*) from conversaflow.products),
    (select count(*) from commerce.products where source_schema='conversaflow'),
    (select coalesce(sum(round(coalesce(price,0)*100)::bigint),0) from conversaflow.products),
    (select coalesce(sum(price_cents),0) from commerce.products where source_schema='conversaflow')
  union all
  select 'orders_from_transactions',
    (select count(*) from conversaflow.transactions),
    (select count(*) from commerce.orders where metadata->>'migration'='conversaflow'),
    (select coalesce(sum(round(coalesce(total_amount,0)*100)::bigint),0) from conversaflow.transactions),
    (select coalesce(sum(total_cents),0) from commerce.orders where metadata->>'migration'='conversaflow')
  union all
  select 'transaction_status_events',
    (select count(*) from conversaflow.transaction_status_events),
    (select count(*) from commerce.order_events where payload->>'migration'='conversaflow'),
    0, 0
  union all
  select 'conversations',
    (select count(*) from conversaflow.conversations),
    (select count(*) from comms.conversations where metadata->>'migration'='conversaflow'),
    0, 0
  union all
  select 'messages',
    (select count(*) from conversaflow.messages),
    (select count(*) from comms.messages where metadata->>'migration'='conversaflow'),
    0, 0
  union all
  select 'conversation_turns',
    (select count(*) from conversaflow.conversation_turns),
    (select count(*) from comms.conversation_turns where metadata->>'migration'='conversaflow'),
    0, 0
  union all
  select 'customer_preferences',
    (select count(*) from conversaflow.customer_preferences),
    (select count(*) from comms.customer_preferences),
    (select coalesce(sum(round(coalesce(avg_transaction_value,0) * coalesce(total_transactions,0) * 100)::bigint),0)
     from conversaflow.customer_preferences),
    (select coalesce(sum(round(coalesce(avg_transaction_value,0) * coalesce(total_transactions,0) * 100)::bigint),0)
     from comms.customer_preferences)
  union all
  select 'jobs',
    (select count(*) from conversaflow.jobs) + (select count(*) from conversaflow.workflow_jobs),
    (select count(*) from queue.jobs where source_schema='conversaflow'),
    0, 0
  union all
  select 'job_attempts',
    (select count(*) from conversaflow.job_attempts),
    (select count(*) from queue.job_attempts where source_schema='conversaflow'),
    0, 0
  union all
  select 'outbox',
    (select count(*) from conversaflow.outbox),
    (select count(*) from queue.outbox_events),
    0, 0
  union all
  select 'inbound_events',
    (select count(*) from conversaflow.inbound_events),
    (select count(*) from queue.inbound_events),
    0, 0
  union all
  select 'ai_turn_logs',
    (select count(*) from conversaflow.ai_turn_logs),
    (select count(*) from observability.ai_runs where metadata->>'migration'='conversaflow'),
    (select coalesce(sum(total_tokens),0) from conversaflow.ai_turn_logs),
    (select coalesce(sum(total_tokens),0) from observability.ai_runs where metadata->>'migration'='conversaflow')
  union all
  select 'edge_function_logs',
    (select count(*) from conversaflow.edge_function_logs),
    (select count(*) from observability.edge_logs where metadata->>'migration'='conversaflow'),
    0, 0
  union all
  select 'pipeline_traces',
    (select count(*) from conversaflow.pipeline_traces),
    (select count(*) from observability.pipeline_traces where product_key='conversaflow'),
    0, 0
  union all
  select 'eval_traces',
    (select count(*) from conversaflow.eval_traces),
    (select count(*) from observability.evaluation_traces where source_schema='conversaflow' and source_table='eval_traces'),
    0, 0
  union all
  select 'security_logs',
    (select count(*) from conversaflow.security_logs),
    (select count(*) from observability.security_events where metadata->>'migration'='conversaflow'),
    0, 0
  union all
  select 'business_config_changes',
    (select count(*) from conversaflow.business_config_changes),
    (select count(*) from observability.audit_log where payload->>'migration'='conversaflow'),
    0, 0
)
select *,
  source_count = target_count as row_count_ok,
  source_total_cents = target_total_cents as balance_ok
from checks
order by check_name;
```

Orphan checks:

```sql
select 'conversation_without_person_map' check_name, count(*) failures
from conversaflow.conversations c
left join _migration.conversaflow_customer_map cm on cm.old_customer_id = c.customer_id
where c.customer_id is not null and cm.old_customer_id is null
union all
select 'message_without_target_conversation', count(*)
from conversaflow.messages m
left join comms.conversations c on c.id = m.conversation_id
where m.conversation_id is not null and c.id is null
union all
select 'order_without_tenant_map', count(*)
from conversaflow.transactions t
left join _migration.business_tenant_map bm on bm.source_business_id = t.business_id
where bm.source_business_id is null;
```

### 8.7 Phase 3 rollback

```sql
begin;

delete from observability.audit_log where payload->>'migration' = 'conversaflow';
delete from observability.security_events where metadata->>'migration' = 'conversaflow';
delete from observability.evaluation_traces where source_schema='conversaflow' and source_table='eval_traces';
delete from observability.pipeline_traces where product_key='conversaflow';
delete from observability.edge_logs where metadata->>'migration' = 'conversaflow';
delete from observability.ai_runs where metadata->>'migration' = 'conversaflow';

delete from queue.inbound_events where provider in (select distinct source from conversaflow.inbound_events);
delete from queue.outbox_events where id in (select id from conversaflow.outbox);
delete from queue.job_attempts where source_schema='conversaflow';
delete from queue.jobs where source_schema='conversaflow';

delete from comms.customer_preferences
where old_customer_id in (select id from conversaflow.customers);
delete from comms.daily_summaries where id in (select id from conversaflow.daily_summaries);
delete from comms.conversation_outcomes where payload->>'migration'='conversaflow';
delete from comms.tool_calls where id in (select id from conversaflow.tool_calls);
delete from comms.conversation_turns where metadata->>'migration'='conversaflow';
delete from comms.messages where metadata->>'migration'='conversaflow';
delete from comms.conversations where metadata->>'migration'='conversaflow';

delete from commerce.order_events where payload->>'migration'='conversaflow';
delete from commerce.orders where metadata->>'migration'='conversaflow';
delete from _migration.order_map where source_schema='conversaflow';
delete from commerce.products where source_schema='conversaflow';
delete from commerce.channel_accounts where source_schema='conversaflow';
delete from commerce.channels where metadata->>'migration'='conversaflow';
delete from commerce.businesses where source_schema='conversaflow';

update _migration.phase_runs
set status = 'rolled_back', finished_at = now()
where id = :phase_run_id;

commit;
```

---

## 9. Phase 4 - `kds` to `device` + `kitchen` + `commerce`

Goal: move KDS hardware/session data into `device`, station config into
`kitchen`, and ticket projection data into `commerce` order state. Do not drop
`kds`.

Prerequisite: `kds.business_id` values map through `_migration.business_tenant_map`.

### 9.1 KDS tenant map

If KDS uses the same business IDs as ConversaFlow, reuse the existing map. If
not, insert rows with `source_schema='kds'`.

```sql
insert into _migration.business_tenant_map (
  source_schema, source_table, source_business_id, tenant_id, tenant_slug,
  mapping_strategy, notes
)
select distinct
  'kds',
  'businesses',
  t.business_id,
  cf.tenant_id,
  cf.tenant_slug,
  'external_ref',
  'Mapped from matching kds/conversaflow business_id'
from kds.tickets t
join _migration.business_tenant_map cf
  on cf.source_schema = 'conversaflow'
 and cf.source_business_id = t.business_id
on conflict (source_schema, source_table, source_business_id) do nothing;
```

### 9.2 Devices and sessions

```sql
begin;

insert into _migration.phase_runs (phase, status, notes)
values ('phase_4_kds_to_device_kitchen', 'running', 'Migrate kds device and ticket projection data')
returning id;

-- Use returned id as :phase_run_id.

insert into device.devices (
  id, tenant_id, device_type, display_name, metadata, created_at
)
select
  ds.device_id,
  m.tenant_id,
  'kds',
  ds.device_name,
  jsonb_build_object(
    'migration', 'kds',
    'old_device_id', ds.device_id,
    'old_station_id', ds.station_id,
    'business_id', ds.business_id
  ),
  ds.created_at
from kds.device_sessions ds
join _migration.business_tenant_map m
  on m.source_schema in ('kds', 'conversaflow')
 and m.source_business_id = ds.business_id
on conflict do nothing;

insert into device.sessions (
  tenant_id, device_id, token_hash, permissions, last_seen_at,
  is_active, metadata, created_at
)
select
  m.tenant_id,
  ds.device_id,
  ds.token_hash,
  array['kds'],
  ds.last_used_at,
  ds.is_active,
  jsonb_build_object('migration', 'kds', 'old_device_id', ds.device_id),
  ds.created_at
from kds.device_sessions ds
join _migration.business_tenant_map m
  on m.source_schema in ('kds', 'conversaflow')
 and m.source_business_id = ds.business_id
on conflict do nothing;

insert into device.pairing_requests (
  id, tenant_id, location_id, device_name, pin_hash, pin_salt,
  status, expires_at, metadata, created_at, updated_at
)
select
  pr.id,
  pr.tenant_id,
  pr.location_id,
  pr.device_name,
  pr.pin_hash,
  pr.pin_salt,
  pr.status,
  pr.expires_at,
  jsonb_build_object(
    'migration', 'kds',
    'old_station_id', pr.station_id,
    'requested_name', pr.requested_name,
    'attempt_count', pr.attempt_count,
    'max_attempts', pr.max_attempts,
    'approved_by', pr.approved_by,
    'approved_at', pr.approved_at,
    'used_at', pr.used_at,
    'denied_at', pr.denied_at
  ),
  pr.created_at,
  pr.updated_at
from kds.device_pairing_requests pr
on conflict do nothing;

insert into device.events (
  id, tenant_id, device_id, event_type, payload, occurred_at
)
select
  de.id,
  de.tenant_id,
  ds.device_id,
  de.event_type,
  coalesce(de.payload, '{}'::jsonb) || jsonb_build_object('migration', 'kds'),
  de.occurred_at
from kds.device_events de
left join kds.device_sessions ds on ds.id = de.device_session_id
on conflict do nothing;

commit;
```

### 9.3 Kitchen stations and ticket projection

```sql
begin;

insert into kitchen.stations (
  id, tenant_id, location_id, station_key, name, status, metadata,
  created_at, updated_at
)
select
  s.id,
  s.tenant_id,
  s.location_id,
  s.station_key,
  s.name,
  s.status,
  coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object('migration', 'kds'),
  s.created_at,
  s.updated_at
from kds.stations s
on conflict do nothing;

-- Link every KDS ticket to an existing commerce order when possible.
insert into _migration.kds_ticket_map (
  source_ticket_id, source_transaction_id, tenant_id, order_id
)
select
  kt.id,
  kt.source_transaction_id,
  m.tenant_id,
  coalesce(om.order_id, kt.id)
from kds.tickets kt
join _migration.business_tenant_map m
  on m.source_schema in ('kds', 'conversaflow')
 and m.source_business_id = kt.business_id
left join _migration.order_map om
  on om.source_schema = 'conversaflow'
 and om.source_table = 'transactions'
 and om.source_id = kt.source_transaction_id::text
on conflict (source_ticket_id) do nothing;

-- Create missing orders only when the ticket was not already represented by
-- a ConversaFlow transaction migrated in Phase 3.
insert into commerce.orders (
  id, tenant_id, location_id, order_number, source_product, source_ref,
  status, channel, currency, subtotal_cents, tax_cents, discount_cents,
  total_cents, notes, metadata, placed_at, created_at, updated_at
)
select
  ktm.order_id,
  ktm.tenant_id,
  kt.location_id,
  null,
  'kds',
  kt.id::text,
  kt.status,
  kt.source_channel,
  'MXN',
  kt.total_cents,
  0,
  0,
  kt.total_cents,
  kt.customer_note,
  jsonb_build_object(
    'migration', 'kds',
    'old_ticket_id', kt.id,
    'source_transaction_id', kt.source_transaction_id,
    'customer_name', kt.customer_name,
    'customer_phone', kt.customer_phone,
    'pickup_person', kt.pickup_person,
    'cancellation_reason', kt.cancellation_reason,
    'partial_cancellation_reason', kt.partial_cancellation_reason,
    'last_event_sequence', kt.last_event_sequence,
    'last_projected_at', kt.last_projected_at
  ),
  kt.created_at,
  kt.created_at,
  kt.updated_at
from kds.tickets kt
join _migration.kds_ticket_map ktm on ktm.source_ticket_id = kt.id
left join commerce.orders existing on existing.id = ktm.order_id
where existing.id is null
on conflict do nothing;

insert into commerce.order_items (
  id, tenant_id, order_id, product_ref, name, quantity, unit_price_cents,
  total_cents, variant_name, notes, metadata, created_at
)
select
  ti.id,
  ktm.tenant_id,
  ktm.order_id,
  ti.order_item_id::text,
  ti.name,
  ti.quantity,
  coalesce(ti.unit_price_cents, 0),
  coalesce(ti.unit_price_cents, 0) * ti.quantity,
  ti.variant_name,
  ti.notes,
  jsonb_build_object(
    'migration', 'kds',
    'old_ticket_item_id', ti.id,
    'old_ticket_id', ti.ticket_id,
    'display_order', ti.display_order,
    'is_cancelled', ti.is_cancelled
  ),
  now()
from kds.ticket_items ti
join _migration.kds_ticket_map ktm on ktm.source_ticket_id = ti.ticket_id
on conflict do nothing;

insert into commerce.order_events (
  tenant_id, order_id, event_type, next_status, payload, occurred_at
)
select
  ktm.tenant_id,
  ktm.order_id,
  te.kind::text,
  te.status::text,
  coalesce(te.payload, '{}'::jsonb) ||
    jsonb_build_object(
      'migration', 'kds',
      'old_ticket_event_sequence', te.sequence,
      'old_ticket_id', te.ticket_id,
      'source', te.source,
      'source_event_key', te.source_event_key
    ),
  te.occurred_at
from kds.ticket_events te
join _migration.kds_ticket_map ktm on ktm.source_ticket_id = te.ticket_id
on conflict do nothing;

commit;
```

### 9.4 Phase 4 verification

```sql
with checks as (
  select 'device_sessions' check_name,
    (select count(*) from kds.device_sessions) source_count,
    (select count(*) from device.sessions where metadata->>'migration'='kds') target_count,
    0::bigint source_total_cents, 0::bigint target_total_cents
  union all
  select 'device_pairing_requests',
    (select count(*) from kds.device_pairing_requests),
    (select count(*) from device.pairing_requests where metadata->>'migration'='kds'),
    0, 0
  union all
  select 'device_events',
    (select count(*) from kds.device_events),
    (select count(*) from device.events where payload->>'migration'='kds'),
    0, 0
  union all
  select 'stations',
    (select count(*) from kds.stations),
    (select count(*) from kitchen.stations where metadata->>'migration'='kds'),
    0, 0
  union all
  select 'tickets',
    (select count(*) from kds.tickets),
    (select count(*) from _migration.kds_ticket_map),
    (select coalesce(sum(total_cents),0)::bigint from kds.tickets),
    (select coalesce(sum(o.total_cents),0)::bigint
     from _migration.kds_ticket_map ktm
     join commerce.orders o on o.id = ktm.order_id)
  union all
  select 'ticket_items',
    (select count(*) from kds.ticket_items),
    (select count(*) from commerce.order_items where metadata->>'migration'='kds'),
    (select coalesce(sum(coalesce(unit_price_cents,0) * quantity),0)::bigint from kds.ticket_items),
    (select coalesce(sum(total_cents),0)::bigint from commerce.order_items where metadata->>'migration'='kds')
  union all
  select 'ticket_events',
    (select count(*) from kds.ticket_events),
    (select count(*) from commerce.order_events where payload->>'migration'='kds'),
    0, 0
)
select *,
  source_count = target_count as row_count_ok,
  source_total_cents = target_total_cents as balance_ok
from checks
order by check_name;

select 'ticket_without_order' check_name, count(*) failures
from _migration.kds_ticket_map ktm
left join commerce.orders o on o.id = ktm.order_id
where o.id is null
union all
select 'ticket_item_without_order', count(*)
from kds.ticket_items ti
left join _migration.kds_ticket_map ktm on ktm.source_ticket_id = ti.ticket_id
where ktm.source_ticket_id is null;
```

Expected: all row-count and balance checks pass; orphan failures = 0.

### 9.5 Phase 4 rollback

```sql
begin;

delete from commerce.order_events where payload->>'migration'='kds';
delete from commerce.order_items where metadata->>'migration'='kds';
delete from commerce.orders where metadata->>'migration'='kds';
delete from _migration.kds_ticket_map;

delete from kitchen.station_assignments where metadata->>'migration'='kds';
delete from kitchen.stations where metadata->>'migration'='kds';

delete from device.events where payload->>'migration'='kds';
delete from device.pairing_requests where metadata->>'migration'='kds';
delete from device.sessions where metadata->>'migration'='kds';
delete from device.devices where metadata->>'migration'='kds';

update _migration.phase_runs
set status = 'rolled_back', finished_at = now()
where id = :phase_run_id;

commit;
```

---

## 10. Cross-Phase Final Verification

Run after Phases 1-4 are verified.

### 10.1 Every current table accounted for

```sql
with accounted(schema_name, table_name, target, disposition) as (
  values
  ('platform','tenants','platform.tenants','kept'),
  ('platform','locations','platform.locations','kept/enriched'),
  ('platform','people','platform.people','kept/enriched'),
  ('platform','users','platform.users','kept'),
  ('platform','tenant_memberships','platform.tenant_memberships','kept'),
  ('platform','staff_members','platform.staff_members','kept'),
  ('platform','contact_identities','platform.contact_identities','kept/enriched'),
  ('platform','contact_merge_candidates','platform.contact_merge_candidates','kept empty'),
  ('platform','external_refs','platform.external_refs','kept'),
  ('platform','leads','grow.leads','empty compatibility remains'),
  ('platform','lead_events','grow.lead_events','empty compatibility remains'),
  ('platform','password_reset_tokens','platform.password_reset_tokens','kept'),
  ('platform','permissions','platform.permissions','kept'),
  ('platform','roles','platform.roles','kept'),
  ('platform','role_permissions','platform.role_permissions','kept'),
  ('platform','membership_roles','platform.membership_roles','kept'),
  ('platform','product_instances','grow.product_instances','empty compatibility remains'),
  ('cash','gift_cards','cash.gift_cards','target'),
  ('cash','automation_rules','cash.automation_rules','target empty'),
  ('cash','balances','cash.balances','derived target'),
  ('cash','loyalty_accounts','cash.loyalty_accounts','target'),
  ('cash','loyalty_cards','cash.loyalty_cards','target'),
  ('cash','otp_verifications','cash.otp_verifications','target'),
  ('cash','pass_devices','cash.pass_devices','target'),
  ('cash','passes','cash.passes','target'),
  ('cash','points_ledger','cash.points_ledger','append-only target'),
  ('cash','reward_configs','cash.reward_configs','target'),
  ('cash','reward_redemptions','cash.reward_redemptions','target'),
  ('cash','visit_events','cash.visit_events','target'),
  ('cash','wallet_programs','cash.wallet_programs','target'),
  ('cash','wallet_transactions','cash.wallet_transactions','target'),
  ('commerce','business_hours','commerce.business_hours','target empty'),
  ('commerce','order_events','commerce.order_events','target'),
  ('commerce','order_items','commerce.order_items','target'),
  ('commerce','orders','commerce.orders','target'),
  ('commerce','payments','commerce.payments','target empty'),
  ('commerce','product_categories','commerce.product_categories','target empty'),
  ('commerce','product_modifier_groups','commerce.product_modifier_groups','target empty'),
  ('commerce','product_modifiers','commerce.product_modifiers','target empty'),
  ('commerce','refunds','commerce.refunds','target empty'),
  ('commerce','service_windows','commerce.service_windows','target empty'),
  ('comms','knowledge_documents','comms.knowledge_documents','target empty'),
  ('comms','knowledge_chunks','comms.knowledge_chunks','target empty'),
  ('conversaflow','ai_turn_logs','observability.ai_runs','copied'),
  ('conversaflow','business_config_changes','observability.audit_log','copied'),
  ('conversaflow','businesses','commerce.businesses','copied'),
  ('conversaflow','channel_accounts','commerce.channel_accounts','zero-row copied'),
  ('conversaflow','channels','commerce.channels','zero-row copied'),
  ('conversaflow','conversation_outcomes','comms.conversation_outcomes','zero-row copied'),
  ('conversaflow','conversation_turns','comms.conversation_turns','copied'),
  ('conversaflow','conversations','comms.conversations','copied'),
  ('conversaflow','customer_preferences','comms.customer_preferences','copied'),
  ('conversaflow','customers','platform.people','merged'),
  ('conversaflow','daily_summaries','comms.daily_summaries','copied'),
  ('conversaflow','dashboard_users','platform.tenant_memberships','merged'),
  ('conversaflow','edge_function_logs','observability.edge_logs','copied'),
  ('conversaflow','eval_traces','observability.evaluation_traces','copied'),
  ('conversaflow','inbound_events','queue.inbound_events','copied'),
  ('conversaflow','job_attempts','queue.job_attempts','copied'),
  ('conversaflow','jobs','queue.jobs','copied'),
  ('conversaflow','memory_items','comms.memory_items','zero-row copied'),
  ('conversaflow','messages','comms.messages','copied'),
  ('conversaflow','outbox','queue.outbox_events','copied'),
  ('conversaflow','pipeline_traces','observability.pipeline_traces','copied'),
  ('conversaflow','products','commerce.products','copied'),
  ('conversaflow','security_logs','observability.security_events','copied'),
  ('conversaflow','tool_calls','comms.tool_calls','zero-row copied'),
  ('conversaflow','transaction_status_events','commerce.order_events','copied'),
  ('conversaflow','transactions','commerce.orders','copied'),
  ('conversaflow','workflow_jobs','queue.jobs','copied'),
  ('conversaflow','zettle_oauth_tokens','commerce.integration_tokens or Vault','zero-row no-op'),
  ('kds','device_events','device.events','zero-row copied'),
  ('kds','device_pairing_requests','device.pairing_requests','zero-row copied'),
  ('kds','device_sessions','device.devices/device.sessions','zero-row copied'),
  ('kds','stations','kitchen.stations','zero-row copied'),
  ('kds','ticket_events','commerce.order_events','copied'),
  ('kds','ticket_items','commerce.order_items','copied'),
  ('kds','tickets','commerce.orders/_migration.kds_ticket_map','mapped'),
  ('observability','data_quality_findings','observability.data_quality_findings','kept empty'),
  ('observability','evaluation_traces','observability.evaluation_traces','kept empty'),
  ('observability','pipeline_traces','observability.pipeline_traces','kept empty'),
  ('grow','subscriptions','grow.subscriptions','target empty'),
  ('grow','feature_flags','grow.feature_flags','target empty'),
  ('umi_cash','ApplePushToken','cash.pass_devices','copied'),
  ('umi_cash','BirthdayReward','cash.reward_redemptions/cash.automation_rules','empty no-op'),
  ('umi_cash','GiftCard','cash.gift_cards/cash.gift_card_ledger','copied'),
  ('umi_cash','Location','platform.locations','copied'),
  ('umi_cash','LoyaltyCard','cash.loyalty_accounts/cash.loyalty_cards','copied'),
  ('umi_cash','OtpVerification','cash.otp_verifications','copied'),
  ('umi_cash','RewardConfig','cash.reward_configs','copied'),
  ('umi_cash','RewardRedemption','cash.reward_redemptions','empty no-op'),
  ('umi_cash','Session','not migrated','empty ephemeral'),
  ('umi_cash','Tenant','platform.tenants/cash.wallet_programs','mapped/enriched'),
  ('umi_cash','Transaction','cash.wallet_transactions','copied signed amounts'),
  ('umi_cash','User','platform.people/platform.contact_identities','copied'),
  ('umi_cash','Visit','cash.visit_events','copied')
)
select *
from accounted
order by schema_name, table_name;
```

### 10.2 Source-to-target financial totals

```sql
select 'cash_card_balances' check_name,
  (select coalesce(sum("balanceCentavos"),0)::bigint from umi_cash."LoyaltyCard") source_total_cents,
  (select coalesce(sum(balance_cents),0)::bigint from cash.loyalty_cards where metadata->>'migration'='umi_cash') target_total_cents
union all
select 'cash_legacy_transactions_signed',
  (select coalesce(sum("amountCentavos"),0)::bigint from umi_cash."Transaction"),
  (select coalesce(sum(amount_cents),0)::bigint from cash.wallet_transactions where metadata->>'old_transaction_id' is not null)
union all
select 'cash_wallet_ledger_reconciled',
  (select coalesce(sum("balanceCentavos"),0)::bigint from umi_cash."LoyaltyCard"),
  (select coalesce(sum(amount_cents),0)::bigint from cash.wallet_transactions where metadata->>'migration'='umi_cash')
union all
select 'gift_cards',
  (select coalesce(sum("amountCentavos"),0)::bigint from umi_cash."GiftCard"),
  (select coalesce(sum(amount_cents),0)::bigint from cash.gift_cards where metadata->>'migration'='umi_cash')
union all
select 'conversaflow_orders',
  (select coalesce(sum(round(coalesce(total_amount,0) * 100)::bigint),0) from conversaflow.transactions),
  (select coalesce(sum(total_cents),0)::bigint from commerce.orders where metadata->>'migration'='conversaflow')
union all
select 'kds_tickets',
  (select coalesce(sum(total_cents),0)::bigint from kds.tickets),
  (select coalesce(sum(o.total_cents),0)::bigint
   from _migration.kds_ticket_map ktm
   join commerce.orders o on o.id = ktm.order_id);
```

### 10.3 Tenant isolation checks

```sql
select table_schema, table_name
from information_schema.columns c
where table_schema in ('cash', 'commerce', 'comms', 'device', 'kitchen')
  and table_name not like 'v_%'
group by table_schema, table_name
having count(*) filter (where column_name = 'tenant_id') = 0
order by table_schema, table_name;

select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r'
  and n.nspname in ('cash', 'commerce', 'comms', 'device', 'kitchen')
  and not c.relrowsecurity
order by n.nspname, c.relname;
```

Expected: no tenant-scoped tables missing `tenant_id`; no tenant-scoped tables
without RLS unless explicitly service-only.

### 10.4 GDPR and data deletion

Follow architecture spec §6 for deletion requests. Anonymize `platform.people`
instead of deleting rows, and erase identifying metadata. Delete
`contact_methods` rows; in this physical plan, that means the corresponding
contact-method table or `platform.contact_identities` compatibility rows. NEVER
delete ledger rows (`cash.points_ledger`, `cash.gift_card_ledger`, or
`cash.wallet_transactions`) because they are financial audit history. Anonymize
messages by setting body/content to null while preserving conversation structure.
Prune `observability` traces on the retention schedule, not on demand.

---

## 11. Cleanup, Cutover, and Non-Goals

No cleanup happens as part of Phases 0-4. After all code paths use
`platform`, `cash`, `commerce`, `comms`, `queue`, `device`, `kitchen`, and
`observability`, run a separate cleanup plan:

1. Freeze writes to `umi_cash`, `conversaflow`, and `kds`.
2. Re-run all verification queries.
3. Take a final backup.
4. Replace old app queries with compatibility views if needed.
5. Keep old schemas read-only for at least 14 days.
6. Only then consider `drop schema ...` commands. Do not use silent
   `cascade`; enumerate every object or keep the schema archived.

Explicit non-goals for this plan:

- It does not create `core`.
- It does not create `loyalty`.
- It does not drop `umi_cash`, `conversaflow`, `kds`, `commerce`, or
  `observability`.
- It does not migrate Supabase-managed `auth` tables.
- It does not import old session tokens from `umi_cash."Session"`.
- It does not copy cleartext integration tokens into tenant-exposed schemas.
