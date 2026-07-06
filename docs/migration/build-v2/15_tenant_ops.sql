-- =============================================================================
-- 15_tenant_ops.sql  (canonical rebuild v2 — schema `tenant`, RLS domain)
--
-- Operational tenant config that isn't menu/orders/loyalty: opening hours,
-- dated overrides, KDS devices, kitchen stations, and the tenant's leased
-- messaging number. Transformed from the old `ops.*` (hours/channels half,
-- build/12_ops.sql) and `device.*`/`kitchen.*` (build/16_device_kitchen.sql).
--
-- Key transforms per manifest FILE 15:
--   * open_hours (from ops.business_hours) + hours_override (from
--     ops.service_windows) — location_id -> branch_id (composite FK -> tenant.branch).
--   * device (from device.devices) — DROP the 8-value device_type CHECK down to a
--     small CHECK ('kds','pos'); registry detail cols kept (faithful transform).
--   * station (from kitchen.stations) — FOLD kitchen.station_groups +
--     kitchen.station_assignments in as columns (grouping + product routing);
--     the two satellite tables are NOT authored as separate relations.
--   * whatsapp_number — COLLAPSES ops.channels + ops.channel_accounts into one
--     "the tenant's leased number" relation (distinct from the GLOBAL
--     tenant.channel catalog authored in 11_tenant_core.sql).
--
-- Composite tenant isolation (kernel): PK (tenant_id, id); FKs into sibling
-- tenant tables are inline composite. RLS policies NOT authored here (90_rls).
--
-- Depends on: 00_foundation.sql, 11_tenant_core.sql (tenant.tenant, tenant.branch).
-- Target: PostgreSQL 18. Idempotent + re-runnable.
-- =============================================================================

begin;

set search_path = tenant, public, extensions;

-- ===========================================================================
-- tenant.open_hours  <- ops.business_hours
--   Weekly recurring schedule (day_of_week 0..6, 0 = Sunday). location_id ->
--   branch_id (composite FK -> tenant.branch; nullable = tenant-wide hours).
--   null opens_at + null closes_at (or is_closed) = closed that day.
-- ===========================================================================
create table if not exists tenant.open_hours (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null references tenant.tenant(id) on delete cascade,
  branch_id   uuid,
  day_of_week smallint not null
    check (day_of_week between 0 and 6),
  opens_at    time,
  closes_at   time,
  is_closed   boolean not null default false,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, branch_id)
    references tenant.branch (tenant_id, id) on delete cascade
);

create index if not exists tenant_open_hours_branch_idx
  on tenant.open_hours (tenant_id, branch_id, day_of_week);

-- ===========================================================================
-- tenant.hours_override  <- ops.service_windows
--   A dated override window (holiday closure, special-hours event). branch_id
--   composite FK -> tenant.branch (nullable = tenant-wide override).
-- ===========================================================================
create table if not exists tenant.hours_override (
  id         uuid not null default gen_random_uuid(),
  tenant_id  uuid not null references tenant.tenant(id) on delete cascade,
  branch_id  uuid,
  label      text,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  is_closed  boolean not null default false,
  opens_at   time,
  closes_at  time,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  check (ends_at >= starts_at),
  foreign key (tenant_id, branch_id)
    references tenant.branch (tenant_id, id) on delete cascade
);

create index if not exists tenant_hours_override_range_idx
  on tenant.hours_override (tenant_id, starts_at, ends_at);

-- ===========================================================================
-- tenant.station  <- kitchen.stations  (FOLDS station_groups + station_assignments)
--   Named kitchen station orders route to. location_id -> branch_id (composite FK).
--   FOLDED IN as columns (the two satellite relations are gone):
--     from kitchen.station_groups        -> group_key, group_name
--     from kitchen.station_assignments   -> product_refs uuid[] (SOFT ops-product
--                                            refs, NO FK) + product_keys text[]
--   NULL-safe unique split on station_key preserved (branch-scoped vs tenant-wide).
-- ===========================================================================
create table if not exists tenant.station (
  id           uuid not null default gen_random_uuid(),
  tenant_id    uuid not null references tenant.tenant(id) on delete cascade,
  branch_id    uuid,
  station_key  text not null,
  name         text not null,
  status       text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  sort_order   integer not null default 0,
  group_key    text,                                      -- folded from station_groups
  group_name   text,                                      -- folded from station_groups
  product_refs uuid[] not null default array[]::uuid[],   -- folded: SOFT ops.product refs (NO FK)
  product_keys text[] not null default array[]::text[],   -- folded: routing keys
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, branch_id)
    references tenant.branch (tenant_id, id) on delete set null
);

-- source UNIQUE(tenant_id, location_id, station_key), NULL-safe split:
create unique index if not exists tenant_station_branch_key_uidx
  on tenant.station (tenant_id, branch_id, station_key)
  where branch_id is not null;
create unique index if not exists tenant_station_key_uidx
  on tenant.station (tenant_id, station_key)
  where branch_id is null;
create index if not exists tenant_station_status_idx
  on tenant.station (tenant_id, status, sort_order);

-- ===========================================================================
-- tenant.device  <- device.devices
--   KDS hardware registry. location_id -> branch_id (composite FK). The 8-value
--   device_type generality is DROPPED to a small CHECK ('kds','pos'). Durable
--   registry-detail cols (subtype/manufacturer/model/connection_type) kept as a
--   faithful transform. station_id is a SOFT ref to tenant.station (NO FK —
--   device↔kitchen cross-product boundary preserved from the source).
-- ===========================================================================
create table if not exists tenant.device (
  id              uuid not null default gen_random_uuid(),
  tenant_id       uuid not null references tenant.tenant(id) on delete cascade,
  branch_id       uuid,
  station_id      uuid,                                   -- SOFT ref -> tenant.station; NO FK
  name            text not null,
  device_type     text not null default 'kds'
    check (device_type in ('kds', 'pos')),
  device_subtype  text,
  manufacturer    text,
  model           text,
  connection_type text,
  status          text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, branch_id)
    references tenant.branch (tenant_id, id) on delete set null
);

create index if not exists tenant_device_status_idx
  on tenant.device (tenant_id, status);
create index if not exists tenant_device_station_idx
  on tenant.device (tenant_id, station_id) where station_id is not null;

-- ===========================================================================
-- tenant.whatsapp_number  <- COLLAPSE ops.channels + ops.channel_accounts
--   The tenant's leased messaging number / provider account. From ops.channels:
--   channel_key (was key) + name + status. From ops.channel_accounts: provider,
--   provider_account_id, phone_number (was address), config, location_id ->
--   branch_id (composite FK). (provider, provider_account_id) stays globally
--   unique (source precedent). Distinct from the GLOBAL tenant.channel catalog
--   (11_tenant_core) — that is the channel type reference; this is the lease.
-- ===========================================================================
create table if not exists tenant.whatsapp_number (
  id                  uuid not null default gen_random_uuid(),
  tenant_id           uuid not null references tenant.tenant(id) on delete cascade,
  branch_id           uuid,
  channel_key         text not null default 'whatsapp',   -- was ops.channels.key
  name                text,                                -- was ops.channels.name
  provider            text not null,                       -- ops.channel_accounts.provider
  provider_account_id text not null,                       -- ops.channel_accounts.provider_account_id
  phone_number        text,                                -- was ops.channel_accounts.address
  config              jsonb not null default '{}'::jsonb,
  status              text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (provider, provider_account_id),
  foreign key (tenant_id, branch_id)
    references tenant.branch (tenant_id, id) on delete set null
);

create index if not exists tenant_whatsapp_number_tenant_idx
  on tenant.whatsapp_number (tenant_id, status);
create index if not exists tenant_whatsapp_number_channel_idx
  on tenant.whatsapp_number (tenant_id, channel_key);

-- ===========================================================================
-- GRANTS
--   tenant is the RLS domain. Grant DML to umi_worker (+ readonly select);
--   umi_app row-scoped DML is granted by 90_rls.sql. No secret columns here.
-- ===========================================================================
grant select on
    tenant.open_hours, tenant.hours_override, tenant.station,
    tenant.device, tenant.whatsapp_number
  to umi_worker, umi_readonly;
grant insert, update, delete on
    tenant.open_hours, tenant.hours_override, tenant.station,
    tenant.device, tenant.whatsapp_number
  to umi_worker;

commit;

-- =============================================================================
-- TENANT-OPS CONTRACT (for 90_rls + backfill authors)
--   RLS tenant tables (tenant_id NOT NULL, PK (tenant_id,id) -> 90_rls loop):
--     open_hours, hours_override, station, device, whatsapp_number.
--   FK topology (composite, within tenant):
--     open_hours.(tenant_id, branch_id)      -> tenant.branch  [cascade]
--     hours_override.(tenant_id, branch_id)  -> tenant.branch  [cascade]
--     station.(tenant_id, branch_id)         -> tenant.branch  [set null]
--     device.(tenant_id, branch_id)          -> tenant.branch  [set null]
--     whatsapp_number.(tenant_id, branch_id) -> tenant.branch  [set null]
--   SOFT refs (uuid, no FK): device.station_id + station.product_refs[] (-> ops).
--   FOLDS (no separate relation): kitchen.station_groups (-> station.group_key/
--     group_name) + kitchen.station_assignments (-> station.product_refs/product_keys).
--   COLLAPSE: ops.channels + ops.channel_accounts -> tenant.whatsapp_number.
--   device_type CHECK narrowed 8-value -> ('kds','pos').
-- =============================================================================
