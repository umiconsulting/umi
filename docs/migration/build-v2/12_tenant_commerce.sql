-- =============================================================================
-- 12_tenant_commerce.sql  (canonical rebuild v2 — schema `tenant`, RLS domain)
--
-- The restaurant's commerce surface: the menu (products + categories + the SPLIT
-- option-group / modifier pair), orders (DE-OVERLOADED — kitchen lifecycle and
-- cancellation state journaled to tenant.order_event, not smeared across the
-- order row), line items, the order lifecycle event journal, and payments /
-- refunds (currency KEPT on both).
--
-- Source: current build/12_ops.sql (menu/orders half). Transformed per the
-- rebuild manifest FILE 12:
--   * schema ops.* -> tenant.*; PK becomes composite (tenant_id, id); every
--     intra-domain FK is composite (tenant_id, <fk>) -> tenant.<parent>(tenant_id, id).
--   * ops.products              -> tenant.product           (+ source provenance stamp)
--   * ops.product_categories    -> tenant.product_category
--   * ops.product_modifier_groups -> tenant.product_option_group  (choice constraint)
--   * ops.product_modifiers     -> tenant.product_modifier         (name / price_delta)
--       (SPLIT kept distinct — NOT folded into one relation; red-team §8)
--   * ops.orders                -> tenant."order" (de-overloaded: kitchen_status +
--       6 cancellation cols moved OUT to tenant.order_event; slack_message_ts DROPPED;
--       the ops.channels FK + free-form `channel`/`source` collapse onto a single
--       channel_id -> the GLOBAL tenant.channel catalog; location_id -> branch_id)
--   * ops.order_items           -> tenant.order_item        (per-line kitchen_status
--       dropped — kitchen lifecycle is journaled at order level in order_event)
--   * ops.order_events          -> tenant.order_event       (absorbs kitchen_status +
--       cancellation reason; NO append-only trigger — operational journal, not a
--       money ledger, so the source ops_order_events_immutable trigger is removed)
--   * ops.payments / ops.refunds -> tenant.payment / tenant.refund (currency KEPT
--       on both — refund gains a currency column it lacked in source)
--
-- Moved to OTHER files (NOT authored here): ops.businesses/business_hours/
--   service_windows/channels/channel_accounts -> 11_tenant_core / 15_tenant_ops.
--
-- Does NOT author RLS/policies (90_rls does that centrally). Idempotent +
-- re-runnable. Target: PostgreSQL 18, local build, port 5233.
-- =============================================================================

begin;

set search_path = tenant, public, extensions;

-- ===========================================================================
-- tenant.product_category  <- ops.product_categories.
--   Menu sections. Parents tenant.product.category_id.
-- ===========================================================================
create table if not exists tenant.product_category (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null references tenant.tenant(id) on delete cascade,
  key         text not null,
  name        text not null,
  sort_order  integer not null default 0,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, key)
);

create index if not exists tenant_product_category_sort_idx
  on tenant.product_category (tenant_id, sort_order);

-- ===========================================================================
-- tenant.product  <- ops.products.
--   price -> price_cents. name_embedding vector(1024) PRESERVED (derived, kept).
--   NEW: `source` provenance stamp (which system authored this menu item).
--   category_id composite FK -> tenant.product_category.
-- ===========================================================================
create table if not exists tenant.product (
  id              uuid not null default gen_random_uuid(),
  tenant_id       uuid not null references tenant.tenant(id) on delete cascade,
  category_id     uuid,
  source          text not null default 'dashboard'      -- NEW provenance stamp
    check (source in ('dashboard', 'zettle', 'pos')),
  name            text not null,
  description     text,
  price_cents     integer not null default 0
    check (price_cents >= 0),
  is_available    boolean not null default true,
  variants        jsonb not null default '[]'::jsonb,
  name_embedding  extensions.vector(1024),                -- derived, PRESERVED
  embedding_model text,
  synced_at       timestamptz,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, category_id)
    references tenant.product_category (tenant_id, id) on delete set null
);

create index if not exists tenant_product_available_idx
  on tenant.product (tenant_id, is_available);
create index if not exists tenant_product_category_idx
  on tenant.product (tenant_id, category_id) where category_id is not null;
-- Semantic search + fuzzy name lookup (HNSW cosine on 1024-dim + trigram).
create index if not exists tenant_product_name_embedding_idx
  on tenant.product using hnsw (name_embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);
create index if not exists tenant_product_name_trgm_idx
  on tenant.product using gin (lower(name) extensions.gin_trgm_ops);

-- ===========================================================================
-- tenant.product_option_group  <- ops.product_modifier_groups.
--   The CHOICE CONSTRAINT half of the split: min/max_select, is_required.
--   product_id nullable (null = tenant-wide group). Composite FK -> tenant.product.
-- ===========================================================================
create table if not exists tenant.product_option_group (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null references tenant.tenant(id) on delete cascade,
  product_id  uuid,                                       -- null = tenant-wide group
  key         text not null,
  name        text not null,
  min_select  integer not null default 0,
  max_select  integer,
  is_required boolean not null default false,
  sort_order  integer not null default 0,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, product_id)
    references tenant.product (tenant_id, id) on delete cascade
);

create index if not exists tenant_product_option_group_product_idx
  on tenant.product_option_group (tenant_id, product_id);

-- ===========================================================================
-- tenant.product_modifier  <- ops.product_modifiers.
--   The NAME / PRICE-DELTA half of the split. Composite FK -> option_group.
-- ===========================================================================
create table if not exists tenant.product_modifier (
  id                uuid not null default gen_random_uuid(),
  tenant_id         uuid not null references tenant.tenant(id) on delete cascade,
  option_group_id   uuid not null,
  key               text not null,
  name              text not null,
  price_delta_cents integer not null default 0,
  is_available      boolean not null default true,
  sort_order        integer not null default 0,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, option_group_id)
    references tenant.product_option_group (tenant_id, id) on delete cascade
);

create index if not exists tenant_product_modifier_group_idx
  on tenant.product_modifier (tenant_id, option_group_id, sort_order);

-- ===========================================================================
-- tenant."order"  <- ops.orders (DE-OVERLOADED).
--   The canonical order. Kitchen lifecycle (kitchen_status) + the 6 cancellation
--   columns are MOVED OUT to tenant.order_event. slack_message_ts DROPPED. The
--   old ops.channels FK + free-form `channel`/`source` collapse onto a single
--   channel_id -> the GLOBAL tenant.channel catalog (plain FK, catalog has no
--   tenant_id). location_id -> branch_id (composite FK -> tenant.branch).
--   person_id -> customer_id (composite FK -> tenant.customer).
--   station_id/station_name/pickup_person kept as fulfillment soft-refs (no FK).
--   ("order" is a reserved word — quoted throughout.)
-- ===========================================================================
create table if not exists tenant."order" (
  id                    uuid not null default gen_random_uuid(),
  tenant_id             uuid not null references tenant.tenant(id) on delete cascade,
  branch_id             uuid,
  customer_id           uuid,
  channel_id            uuid,                              -- GLOBAL tenant.channel (plain FK)
  order_type            text,                              -- CF transaction_type
  status                text not null default 'pending',
  total_cents           integer not null default 0
    check (total_cents >= 0),
  notes                 text,                              -- customer note
  details               jsonb not null default '{}'::jsonb,
  pickup_person         text,                              -- fulfillment soft-ref
  station_id            text,                              -- soft-ref (no FK)
  station_name          text,                              -- soft-ref (no FK)
  source_transaction_id text,                              -- external linkage / provenance
  metadata              jsonb not null default '{}'::jsonb,
  placed_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, branch_id)
    references tenant.branch (tenant_id, id) on delete set null,
  foreign key (tenant_id, customer_id)
    references tenant.customer (tenant_id, id) on delete set null,
  foreign key (channel_id)
    references tenant.channel (id) on delete set null
);

create index if not exists tenant_order_created_idx
  on tenant."order" (tenant_id, created_at desc);
create index if not exists tenant_order_status_idx
  on tenant."order" (tenant_id, status);
create index if not exists tenant_order_customer_idx
  on tenant."order" (tenant_id, customer_id) where customer_id is not null;
-- External-ref idempotency (KDS/CF projection key), 1:1 where present.
create unique index if not exists tenant_order_source_transaction_uidx
  on tenant."order" (tenant_id, source_transaction_id)
  where source_transaction_id is not null;

-- ===========================================================================
-- tenant.order_item  <- ops.order_items.
--   Line items. Per-line kitchen_status DROPPED (kitchen lifecycle is journaled
--   at order level in order_event). is_cancelled kept as a line flag.
--   Composite FKs -> tenant."order" and tenant.product (nullable — free-text items).
-- ===========================================================================
create table if not exists tenant.order_item (
  id                uuid not null default gen_random_uuid(),
  tenant_id         uuid not null references tenant.tenant(id) on delete cascade,
  order_id          uuid not null,
  product_id        uuid,
  display_order     integer not null default 0,
  name              text not null,                         -- denormalized line label
  variant_name      text,
  quantity          integer not null default 1
    check (quantity >= 0),
  unit_price_cents  integer not null default 0
    check (unit_price_cents >= 0),
  notes             text,
  is_cancelled      boolean not null default false,
  kitchen_status    text,                                  -- per-line KDS lifecycle (restored: KDS tracks per-item progress)
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, order_id)
    references tenant."order" (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id)
    references tenant.product (tenant_id, id) on delete set null
);

create index if not exists tenant_order_item_order_idx
  on tenant.order_item (tenant_id, order_id, display_order);

-- ===========================================================================
-- tenant.order_event  <- ops.order_events (ABSORBS kitchen_status + cancellation).
--   The order lifecycle journal: submitted -> accepted -> preparing -> ready ->
--   completed (+ kitchen events + cancellations). The order's former kitchen_status
--   and the 6 cancellation columns land here: kitchen_status carries the kitchen
--   lifecycle value; the 6 cancellation columns collapse into reason/reason_code/
--   reason_note (event_kind distinguishes full vs partial cancellation).
--   Operationally append-only, but NO trigger — it is an operational journal, not a
--   money ledger (the source ops_order_events_immutable trigger is intentionally
--   NOT reproduced; the only append-only triggers live on the two money ledgers).
--   Composite FK -> tenant."order".
-- ===========================================================================
create table if not exists tenant.order_event (
  id               uuid not null default gen_random_uuid(),
  tenant_id        uuid not null references tenant.tenant(id) on delete cascade,
  order_id         uuid not null,
  event_kind       text                                   -- full/partial cancel distinction rides here
    check (event_kind is null or event_kind in
      ('status_change','kitchen','cancellation','partial_cancellation','note')),
  old_status       text,
  new_status       text,                                  -- the state transitioned into
  kitchen_status   text,                                  -- absorbed from ops.orders.kitchen_status
  reason           text,                                  -- absorbed cancellation reason
  reason_code      text,                                  -- absorbed cancellation reason code
  reason_note      text,                                  -- absorbed cancellation reason note
  kitchen_sequence bigint,
  source           text,                                  -- 'conversaflow' | 'kds' | 'projection'
  idempotency_key  text,                                  -- at-most-once projection guard
  payload          jsonb not null default '{}'::jsonb,
  metadata         jsonb not null default '{}'::jsonb,
  occurred_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, order_id)
    references tenant."order" (tenant_id, id) on delete cascade
);

create index if not exists tenant_order_event_order_idx
  on tenant.order_event (tenant_id, order_id, occurred_at desc);
create index if not exists tenant_order_event_kitchen_seq_idx
  on tenant.order_event (tenant_id, kitchen_sequence)
  where kitchen_sequence is not null;
create unique index if not exists tenant_order_event_idem_uidx
  on tenant.order_event (tenant_id, idempotency_key)
  where idempotency_key is not null;

-- ===========================================================================
-- tenant.payment  <- ops.payments. currency KEPT. Composite FK -> tenant."order".
-- ===========================================================================
create table if not exists tenant.payment (
  id            uuid not null default gen_random_uuid(),
  tenant_id     uuid not null references tenant.tenant(id) on delete cascade,
  order_id      uuid,
  provider      text,
  provider_ref  text,
  method        text,
  status        text not null default 'pending'
    check (status in ('pending', 'authorized', 'captured', 'failed',
                      'voided', 'refunded')),
  amount_cents  integer not null default 0
    check (amount_cents >= 0),
  currency      text not null default 'MXN',
  captured_at   timestamptz,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, order_id)
    references tenant."order" (tenant_id, id) on delete set null
);

create index if not exists tenant_payment_order_idx
  on tenant.payment (tenant_id, order_id);
create index if not exists tenant_payment_status_idx
  on tenant.payment (tenant_id, status, created_at desc);

-- ===========================================================================
-- tenant.refund  <- ops.refunds. currency ADDED (KEEP currency, red-team — the
--   source refunds table had none; payment/refund symmetry). Composite FKs ->
--   tenant.payment and tenant."order".
-- ===========================================================================
create table if not exists tenant.refund (
  id            uuid not null default gen_random_uuid(),
  tenant_id     uuid not null references tenant.tenant(id) on delete cascade,
  payment_id    uuid not null,
  order_id      uuid,
  provider_ref  text,
  reason        text,
  status        text not null default 'pending'
    check (status in ('pending', 'processed', 'failed', 'voided')),
  amount_cents  integer not null default 0
    check (amount_cents >= 0),
  currency      text not null default 'MXN',
  processed_at  timestamptz,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, payment_id)
    references tenant.payment (tenant_id, id) on delete cascade,
  foreign key (tenant_id, order_id)
    references tenant."order" (tenant_id, id) on delete set null
);

create index if not exists tenant_refund_payment_idx
  on tenant.refund (tenant_id, payment_id);

-- ===========================================================================
-- GRANTS. tenant is the RLS request-facing schema. 90_rls grants umi_app the
--   row-scoped DML (after RLS is forced); domain files grant the service role.
--   Sealed-schema rule does NOT apply to tenant — umi_worker only here.
-- ===========================================================================
grant select, insert, update, delete on all tables in schema tenant to umi_worker;
alter default privileges in schema tenant
  grant select, insert, update, delete on tables to umi_worker;

commit;
