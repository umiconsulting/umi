-- Gate 3E: one merchant/location inventory authority for UmiPOS.
-- Quantities are integer values with an explicit decimal scale and unit.

begin;

-- Catalog references use merchant-aware keys. A global UUID is not an authorization scope.
alter table merchant.product
  add constraint product_merchant_id_uk unique (merchant_id,id);
alter table merchant.product_variant
  add constraint product_variant_merchant_id_uk unique (merchant_id,id),
  add constraint product_variant_product_id_uk unique (product_id,id);

-- Inventory facts use merchant-aware foreign keys. UUID uniqueness is not a scope check.
alter table merchant.pos_cart_line
  add constraint pos_cart_line_merchant_id_uk unique (merchant_id,id);
alter table merchant.pos_committed_sale
  add constraint pos_committed_sale_merchant_id_uk unique (merchant_id,id);
alter table merchant.pos_sale_exception
  add constraint pos_sale_exception_merchant_id_uk unique (merchant_id,id);
alter table merchant.pos_restock_intent
  add constraint pos_restock_intent_merchant_id_uk unique (merchant_id,id);
alter table merchant.inventory_reservation
  add constraint inventory_reservation_merchant_id_uk unique (merchant_id,id);

create table merchant.inventory_location (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  public_reference text not null check (public_reference ~ '^[A-Za-z0-9._:-]{1,80}$'),
  display_name text not null check (length(display_name) between 1 and 160),
  location_type text not null check (location_type in (
    'business_location','stock_room','kitchen_storage','bar_storage','quarantine',
    'operational_sub_location'
  )),
  active boolean not null default true,
  sale_fulfillment_eligible boolean not null default true,
  reservation_eligible boolean not null default true,
  count_eligible boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  unique (merchant_id, public_reference),
  unique (merchant_id, location_id, id),
  check ((archived_at is null) = active)
);

create table merchant.inventory_item (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  public_reference text not null check (public_reference ~ '^[A-Za-z0-9._:-]{1,80}$'),
  display_name text not null check (length(display_name) between 1 and 160),
  item_type text not null check (item_type in (
    'physical_product','variant_stock','ingredient','packaging','composite_component',
    'bundle_component','operational_supply'
  )),
  base_unit text not null check (base_unit in (
    'unit','gram','kilogram','milliliter','liter','portion','package','box'
  )),
  quantity_scale smallint not null default 0 check (quantity_scale between 0 and 6),
  tracking_policy text not null default 'tracked'
    check (tracking_policy in ('not_tracked','tracked','reservation_required')),
  negative_stock_policy text not null default 'block'
    check (negative_stock_policy in (
      'block','manager_override','allow_and_flag','backorder','not_applicable'
    )),
  reservation_required boolean not null default true,
  low_stock_threshold bigint check (low_stock_threshold is null or low_stock_threshold >= 0),
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  unique (merchant_id, public_reference),
  unique (merchant_id, id),
  check ((archived_at is null) = active),
  check (tracking_policy <> 'not_tracked' or reservation_required = false)
);

create table merchant.inventory_unit_conversion (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  inventory_item_id uuid not null,
  from_unit text not null check (from_unit in (
    'unit','gram','kilogram','milliliter','liter','portion','package','box'
  )),
  to_unit text not null check (to_unit in (
    'unit','gram','kilogram','milliliter','liter','portion','package','box'
  )),
  numerator bigint not null check (numerator between 1 and 9007199254740991),
  denominator bigint not null check (denominator between 1 and 9007199254740991),
  target_scale smallint not null check (target_scale between 0 and 6),
  rounding_policy text not null default 'exact'
    check (rounding_policy in ('exact','floor','ceiling','half_up')),
  version integer not null default 1 check (version > 0),
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id, inventory_item_id)
    references merchant.inventory_item(merchant_id, id) on delete restrict,
  unique (merchant_id, inventory_item_id, from_unit, to_unit, version)
);

create table merchant.inventory_recipe (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  product_id uuid not null,
  variant_id uuid,
  version integer not null check (version > 0),
  yield_quantity bigint not null check (yield_quantity between 1 and 9007199254740991),
  yield_scale smallint not null check (yield_scale between 0 and 6),
  yield_unit text not null check (yield_unit in (
    'unit','gram','kilogram','milliliter','liter','portion','package','box'
  )),
  active boolean not null default true,
  effective_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id,product_id)
    references merchant.product(merchant_id,id) on delete restrict,
  foreign key (merchant_id,variant_id)
    references merchant.product_variant(merchant_id,id) on delete restrict,
  foreign key (product_id,variant_id)
    references merchant.product_variant(product_id,id) on delete restrict,
  unique (merchant_id, id),
  unique (merchant_id, product_id, variant_id, version),
  check ((retired_at is null) = active)
);
create unique index inventory_recipe_active_uidx
  on merchant.inventory_recipe(
    merchant_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where active;

create table merchant.inventory_recipe_component (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  recipe_id uuid not null,
  inventory_item_id uuid not null,
  modifier_id uuid references merchant.product_modifier(id) on delete restrict,
  quantity bigint not null check (quantity between 1 and 9007199254740991),
  unit text not null check (unit in (
    'unit','gram','kilogram','milliliter','liter','portion','package','box'
  )),
  quantity_scale smallint not null check (quantity_scale between 0 and 6),
  conversion_numerator bigint not null default 1 check (conversion_numerator > 0),
  conversion_denominator bigint not null default 1 check (conversion_denominator > 0),
  rounding_policy text not null default 'exact'
    check (rounding_policy in ('exact','floor','ceiling','half_up')),
  required boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id, recipe_id)
    references merchant.inventory_recipe(merchant_id, id) on delete restrict,
  foreign key (merchant_id, inventory_item_id)
    references merchant.inventory_item(merchant_id, id) on delete restrict,
  unique (recipe_id, inventory_item_id, modifier_id)
);

create or replace function merchant.validate_inventory_recipe_modifier_scope()
returns trigger language plpgsql set search_path=pg_catalog,merchant as $$
begin
  if new.modifier_id is not null and not exists (
    select 1
      from merchant.inventory_recipe r
      join merchant.product_modifier pm on pm.id=new.modifier_id
      join merchant.product_option_group pog on pog.id=pm.option_group_id
     where r.id=new.recipe_id and r.merchant_id=new.merchant_id
       and pog.product_id=r.product_id
  ) then
    raise exception 'INVENTORY_MODIFIER_SCOPE';
  end if;
  return new;
end $$;
create trigger inventory_recipe_component_modifier_scope
  before insert or update on merchant.inventory_recipe_component
  for each row execute function merchant.validate_inventory_recipe_modifier_scope();

create table merchant.inventory_catalog_mapping (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  product_id uuid not null,
  variant_id uuid,
  mapping_type text not null check (mapping_type in ('direct','recipe','bundle','non_stock')),
  inventory_item_id uuid,
  recipe_id uuid,
  conversion_numerator bigint not null default 1 check (conversion_numerator > 0),
  conversion_denominator bigint not null default 1 check (conversion_denominator > 0),
  version integer not null check (version > 0),
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  foreign key (merchant_id,product_id)
    references merchant.product(merchant_id,id) on delete restrict,
  foreign key (merchant_id,variant_id)
    references merchant.product_variant(merchant_id,id) on delete restrict,
  foreign key (product_id,variant_id)
    references merchant.product_variant(product_id,id) on delete restrict,
  foreign key (merchant_id, inventory_item_id)
    references merchant.inventory_item(merchant_id, id) on delete restrict,
  foreign key (merchant_id, recipe_id)
    references merchant.inventory_recipe(merchant_id, id) on delete restrict,
  unique (merchant_id, id),
  unique (merchant_id, product_id, variant_id, version),
  check ((retired_at is null) = active),
  check (
    (mapping_type = 'direct' and inventory_item_id is not null and recipe_id is null) or
    (mapping_type in ('recipe','bundle') and inventory_item_id is null and recipe_id is not null) or
    (mapping_type = 'non_stock' and inventory_item_id is null and recipe_id is null)
  )
);
create unique index inventory_mapping_active_uidx
  on merchant.inventory_catalog_mapping(
    merchant_id, product_id,
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where active;

create table merchant.inventory_policy (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  inventory_location_id uuid not null,
  version text not null check (length(version) between 1 and 80),
  tracking_enabled boolean not null default true,
  default_reservation_required boolean not null default true,
  default_negative_stock_policy text not null default 'block'
    check (default_negative_stock_policy in (
      'block','manager_override','allow_and_flag','backorder','not_applicable'
    )),
  adjustment_approval_threshold bigint not null default 0 check (adjustment_approval_threshold >= 0),
  waste_approval_threshold bigint not null default 0 check (waste_approval_threshold >= 0),
  count_variance_tolerance bigint not null default 0 check (count_variance_tolerance >= 0),
  blind_count boolean not null default true,
  offline_mutations_allowed boolean not null default false,
  maximum_reservation_lines integer not null default 250 check (maximum_reservation_lines between 1 and 250),
  maximum_count_lines integer not null default 1000 check (maximum_count_lines between 1 and 1000),
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '1 day'),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  foreign key (merchant_id, location_id, inventory_location_id)
    references merchant.inventory_location(merchant_id, location_id, id) on delete restrict,
  unique (merchant_id, location_id),
  unique (merchant_id, id),
  check (expires_at > issued_at)
);

create table merchant.stock_balance (
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  inventory_location_id uuid not null,
  inventory_item_id uuid not null,
  quantity_scale smallint not null check (quantity_scale between 0 and 6),
  unit text not null check (unit in (
    'unit','gram','kilogram','milliliter','liter','portion','package','box'
  )),
  on_hand bigint not null default 0,
  reserved bigint not null default 0 check (reserved >= 0),
  committed bigint not null default 0 check (committed >= 0),
  damaged bigint not null default 0 check (damaged >= 0),
  quarantine bigint not null default 0 check (quarantine >= 0),
  waste bigint not null default 0 check (waste >= 0),
  in_transit bigint not null default 0,
  available bigint generated always as (on_hand-reserved-quarantine-damaged) stored,
  ledger_sequence bigint not null default 0 check (ledger_sequence >= 0),
  version bigint not null default 1 check (version > 0),
  calculated_at timestamptz not null default clock_timestamp(),
  primary key (inventory_location_id, inventory_item_id),
  foreign key (merchant_id, location_id, inventory_location_id)
    references merchant.inventory_location(merchant_id, location_id, id) on delete restrict,
  foreign key (merchant_id, inventory_item_id)
    references merchant.inventory_item(merchant_id, id) on delete restrict
);
create index stock_balance_scope_idx
  on merchant.stock_balance(merchant_id, location_id, inventory_location_id);

create table merchant.stock_ledger_entry (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  inventory_location_id uuid not null,
  inventory_item_id uuid not null,
  sequence bigint not null check (sequence > 0),
  entry_type text not null check (entry_type in (
    'opening_balance','reservation_created','reservation_released','reservation_expired',
    'sale_committed','refund_restocked','refund_not_restocked','inspection_queued',
    'adjustment_increase','adjustment_decrease','waste_recorded','damage_recorded',
    'quarantine_entered','quarantine_released','count_correction',
    'transfer_out_foundation','transfer_in_foundation'
  )),
  quantity bigint not null check (quantity between 1 and 9007199254740991),
  quantity_scale smallint not null check (quantity_scale between 0 and 6),
  unit text not null check (unit in (
    'unit','gram','kilogram','milliliter','liter','portion','package','box'
  )),
  effect_on_hand bigint not null default 0,
  effect_reserved bigint not null default 0,
  effect_committed bigint not null default 0,
  effect_damaged bigint not null default 0,
  effect_quarantine bigint not null default 0,
  effect_waste bigint not null default 0,
  effect_in_transit bigint not null default 0,
  command_id uuid not null,
  idempotency_key uuid not null,
  command_fingerprint text not null check (command_fingerprint ~ '^[a-f0-9]{64}$'),
  source_aggregate_type text not null check (length(source_aggregate_type) between 1 and 80),
  source_aggregate_id uuid not null,
  sale_id uuid,
  sale_line_id uuid,
  refund_id uuid,
  count_id uuid,
  operator_id uuid not null references umi.user(id) on delete restrict,
  device_id uuid not null references merchant.device(id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  business_date date not null,
  correlation_id text not null check (length(correlation_id) between 1 and 128),
  public_data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id, location_id, inventory_location_id)
    references merchant.inventory_location(merchant_id, location_id, id) on delete restrict,
  foreign key (merchant_id, inventory_item_id)
    references merchant.inventory_item(merchant_id, id) on delete restrict,
  foreign key (merchant_id, sale_id)
    references merchant.pos_committed_sale(merchant_id, id) on delete restrict,
  foreign key (merchant_id, sale_line_id)
    references merchant.pos_cart_line(merchant_id, id) on delete restrict,
  foreign key (merchant_id, refund_id)
    references merchant.pos_sale_exception(merchant_id, id) on delete restrict,
  unique (inventory_location_id, inventory_item_id, sequence),
  unique nulls not distinct
    (merchant_id, command_id, inventory_item_id, entry_type, source_aggregate_id, sale_line_id),
  unique (merchant_id, idempotency_key, inventory_item_id, entry_type, source_aggregate_id, sale_line_id),
  check (jsonb_typeof(public_data) = 'object')
);
create index stock_ledger_history_idx
  on merchant.stock_ledger_entry(merchant_id, location_id, inventory_item_id, occurred_at desc, id desc);
create index stock_ledger_sale_idx on merchant.stock_ledger_entry(sale_id, sale_line_id)
  where sale_id is not null;
create index stock_ledger_refund_idx on merchant.stock_ledger_entry(refund_id)
  where refund_id is not null;
create trigger stock_ledger_append_only
  before update or delete on merchant.stock_ledger_entry
  for each row execute function merchant.tg_append_only();

-- Adapt the Gate 3B preparation reservation. It remains the single sale reservation.
alter table merchant.inventory_reservation
  drop constraint inventory_reservation_status_check;
alter table merchant.inventory_reservation
  add constraint inventory_reservation_status_check check (status in (
    'draft','active','partially_available','committed','released','expired','conflict',
    'reserved','commit_prepared'
  )),
  add column inventory_location_id uuid,
  add column command_id uuid,
  add column command_fingerprint text,
  add column ledger_sequence_basis bigint not null default 0,
  add column committed_at timestamptz,
  add constraint inventory_reservation_inventory_location_fk
    foreign key (merchant_id, location_id, inventory_location_id)
    references merchant.inventory_location(merchant_id, location_id, id) on delete restrict,
  add constraint inventory_reservation_fingerprint_ck
    check (command_fingerprint is null or command_fingerprint ~ '^[a-f0-9]{64}$');
comment on table merchant.inventory_reservation is
  'Authoritative, time-bounded stock reservation. Stock consumption occurs only at sale commit.';

create table merchant.inventory_reservation_line (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  reservation_id uuid not null,
  inventory_location_id uuid not null,
  inventory_item_id uuid not null,
  sale_line_id uuid not null,
  required_quantity bigint not null check (required_quantity between 1 and 9007199254740991),
  quantity_scale smallint not null check (quantity_scale between 0 and 6),
  unit text not null check (unit in (
    'unit','gram','kilogram','milliliter','liter','portion','package','box'
  )),
  mapping_id uuid not null,
  mapping_version integer not null check (mapping_version > 0),
  recipe_id uuid,
  recipe_version integer check (recipe_version is null or recipe_version > 0),
  availability_sequence bigint not null check (availability_sequence >= 0),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id, location_id, inventory_location_id)
    references merchant.inventory_location(merchant_id, location_id, id) on delete restrict,
  foreign key (merchant_id, inventory_item_id)
    references merchant.inventory_item(merchant_id, id) on delete restrict,
  foreign key (merchant_id, reservation_id)
    references merchant.inventory_reservation(merchant_id, id) on delete restrict,
  foreign key (merchant_id, sale_line_id)
    references merchant.pos_cart_line(merchant_id, id) on delete restrict,
  foreign key (merchant_id, mapping_id)
    references merchant.inventory_catalog_mapping(merchant_id, id) on delete restrict,
  foreign key (merchant_id, recipe_id)
    references merchant.inventory_recipe(merchant_id, id) on delete restrict,
  unique (reservation_id, inventory_item_id, sale_line_id, mapping_id)
);
create index inventory_reservation_line_item_idx
  on merchant.inventory_reservation_line(inventory_location_id, inventory_item_id);

create table merchant.inventory_restock_outcome (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  restock_intent_id uuid not null,
  outcome text not null check (outcome in (
    'restocked','not_restocked','inspection_queued','component_resolved','not_applicable','review_required'
  )),
  command_id uuid not null,
  command_fingerprint text not null check (command_fingerprint ~ '^[a-f0-9]{64}$'),
  inventory_location_id uuid,
  resolved_by uuid not null references umi.user(id) on delete restrict,
  resolved_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id, restock_intent_id)
    references merchant.pos_restock_intent(merchant_id, id) on delete restrict,
  foreign key (merchant_id, location_id, inventory_location_id)
    references merchant.inventory_location(merchant_id, location_id, id) on delete restrict,
  unique (merchant_id, command_id, restock_intent_id)
);
create unique index inventory_restock_final_outcome_uidx
  on merchant.inventory_restock_outcome(restock_intent_id)
  where outcome<>'review_required';
create trigger inventory_restock_outcome_append_only
  before update or delete on merchant.inventory_restock_outcome
  for each row execute function merchant.tg_append_only();

alter table merchant.pos_restock_intent
  drop constraint pos_restock_intent_inventory_status_check;
alter table merchant.pos_restock_intent
  add constraint pos_restock_intent_inventory_status_check check (inventory_status in (
    'intent_only','resolved','review_required'
  ));
alter table merchant.pos_restock_intent
  add column version integer not null default 1 check (version > 0);

create table merchant.inventory_count (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  inventory_location_id uuid not null,
  public_reference text not null check (public_reference ~ '^[A-Za-z0-9._:-]{1,80}$'),
  count_scope text not null check (count_scope in ('full_location','selected_items','cycle_count')),
  status text not null check (status in (
    'draft','counting','submitted','variance_calculated','reconciliation_required',
    'approved','committed','cancelled','recovered'
  )),
  blind boolean not null default true,
  snapshot_ledger_sequence bigint not null check (snapshot_ledger_sequence >= 0),
  snapshot_item_sequences jsonb not null check (jsonb_typeof(snapshot_item_sequences)='object'),
  item_scope uuid[] not null check (cardinality(item_scope) between 1 and 1000),
  attempt integer not null default 1 check (attempt > 0),
  operator_id uuid not null references umi.user(id) on delete restrict,
  operator_session_id uuid not null references runtime.operator_session(id) on delete restrict,
  device_id uuid not null references merchant.device(id) on delete restrict,
  command_id uuid not null,
  command_fingerprint text not null check (command_fingerprint ~ '^[a-f0-9]{64}$'),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  submitted_at timestamptz,
  committed_at timestamptz,
  foreign key (merchant_id, location_id, inventory_location_id)
    references merchant.inventory_location(merchant_id, location_id, id) on delete restrict,
  unique (merchant_id, public_reference),
  unique (merchant_id, command_id),
  unique (merchant_id, id)
);
create unique index inventory_count_active_scope_uidx
  on merchant.inventory_count(inventory_location_id)
  where status in ('draft','counting','submitted','variance_calculated','reconciliation_required','approved');

alter table merchant.stock_ledger_entry
  add constraint stock_ledger_entry_count_scope_fk
  foreign key (merchant_id, count_id)
  references merchant.inventory_count(merchant_id, id) on delete restrict;

create table merchant.inventory_count_line (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  count_id uuid not null,
  inventory_item_id uuid not null,
  expected_quantity bigint not null,
  counted_quantity bigint not null check (counted_quantity >= 0),
  quantity_scale smallint not null check (quantity_scale between 0 and 6),
  unit text not null check (unit in (
    'unit','gram','kilogram','milliliter','liter','portion','package','box'
  )),
  signed_variance bigint generated always as (counted_quantity-expected_quantity) stored,
  absolute_variance bigint generated always as (abs(counted_quantity-expected_quantity)) stored,
  reason_code text,
  note text check (note is null or (length(note) <= 240 and note !~ '[<>]')),
  submitted_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id, count_id)
    references merchant.inventory_count(merchant_id, id) on delete restrict,
  foreign key (merchant_id, inventory_item_id)
    references merchant.inventory_item(merchant_id, id) on delete restrict,
  unique (count_id, inventory_item_id)
);
create trigger inventory_count_line_append_only
  before update or delete on merchant.inventory_count_line
  for each row execute function merchant.tg_append_only();

create table merchant.inventory_reconciliation (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  count_id uuid not null unique,
  count_attempt integer not null check (count_attempt > 0),
  snapshot_ledger_sequence bigint not null check (snapshot_ledger_sequence >= 0),
  command_id uuid not null,
  command_fingerprint text not null check (command_fingerprint ~ '^[a-f0-9]{64}$'),
  approval_id uuid references runtime.elevation_grant(id) on delete restrict,
  operator_id uuid not null references umi.user(id) on delete restrict,
  summary jsonb not null check (jsonb_typeof(summary) = 'object'),
  committed_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id, count_id)
    references merchant.inventory_count(merchant_id, id) on delete restrict,
  unique (merchant_id, command_id)
);
create trigger inventory_reconciliation_append_only
  before update or delete on merchant.inventory_reconciliation
  for each row execute function merchant.tg_append_only();

create table merchant.inventory_command_result (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  command_id uuid not null,
  idempotency_key uuid not null,
  command_fingerprint text not null check (command_fingerprint ~ '^[a-f0-9]{64}$'),
  command_type text not null check (length(command_type) between 1 and 80),
  status text not null check (status in ('committed','conflict','outcome_unknown','recovered')),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  correlation_id text not null check (length(correlation_id) between 1 and 128),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '72 hours'),
  unique (merchant_id, command_id),
  unique (merchant_id, idempotency_key),
  check (expires_at > created_at)
);
create index inventory_command_result_lookup_idx
  on merchant.inventory_command_result(merchant_id, location_id, command_id);
create trigger inventory_command_result_append_only
  before update or delete on merchant.inventory_command_result
  for each row execute function merchant.tg_append_only();

create or replace function merchant.append_stock_ledger(
  p_merchant_id uuid,
  p_location_id uuid,
  p_inventory_location_id uuid,
  p_inventory_item_id uuid,
  p_entry_type text,
  p_quantity bigint,
  p_command_id uuid,
  p_idempotency_key uuid,
  p_fingerprint text,
  p_source_type text,
  p_source_id uuid,
  p_operator_id uuid,
  p_device_id uuid,
  p_credential_version integer,
  p_business_date date,
  p_correlation_id text,
  p_sale_id uuid default null,
  p_sale_line_id uuid default null,
  p_refund_id uuid default null,
  p_count_id uuid default null,
  p_public_data jsonb default '{}'::jsonb
) returns merchant.stock_ledger_entry
language plpgsql
security definer
set search_path = pg_catalog, merchant, runtime, umi
as $$
declare
  v_item merchant.inventory_item%rowtype;
  v_balance merchant.stock_balance%rowtype;
  v_entry merchant.stock_ledger_entry%rowtype;
  v_on_hand bigint := 0;
  v_reserved bigint := 0;
  v_committed bigint := 0;
  v_damaged bigint := 0;
  v_quarantine bigint := 0;
  v_waste bigint := 0;
begin
  if (current_setting('role',true) in ('api','worker') or (
        not coalesce((select rolsuper from pg_roles where rolname=session_user),false)
        and (pg_has_role(session_user,'api','USAGE')
          or pg_has_role(session_user,'worker','USAGE'))
      ))
     and (nullif(current_setting('app.current_merchant',true),'') is null
       or nullif(current_setting('app.current_location',true),'') is null) then
    raise exception 'INVENTORY_CONTEXT_REQUIRED';
  end if;
  if nullif(current_setting('app.current_merchant',true),'') is not null
     and current_setting('app.current_merchant',true)::uuid<>p_merchant_id then
    raise exception 'INVENTORY_MERCHANT_SCOPE';
  end if;
  if nullif(current_setting('app.current_location',true),'') is not null
     and current_setting('app.current_location',true)::uuid<>p_location_id then
    raise exception 'INVENTORY_LOCATION_SCOPE';
  end if;
  if p_quantity <= 0 or p_quantity > 9007199254740991 then
    raise exception 'INVENTORY_QUANTITY_INVALID';
  end if;
  select * into v_item from merchant.inventory_item
   where id=p_inventory_item_id and merchant_id=p_merchant_id and active for share;
  if not found then raise exception 'STOCK_ITEM_ARCHIVED'; end if;

  insert into merchant.stock_balance(
    merchant_id,location_id,inventory_location_id,inventory_item_id,quantity_scale,unit
  ) values (
    p_merchant_id,p_location_id,p_inventory_location_id,p_inventory_item_id,
    v_item.quantity_scale,v_item.base_unit
  ) on conflict (inventory_location_id,inventory_item_id) do nothing;
  select * into v_balance from merchant.stock_balance
   where inventory_location_id=p_inventory_location_id and inventory_item_id=p_inventory_item_id
     and merchant_id=p_merchant_id and location_id=p_location_id
   for update;
  if not found then raise exception 'INVENTORY_LOCATION_SCOPE'; end if;

  case p_entry_type
    when 'opening_balance','refund_restocked','adjustment_increase'
      then v_on_hand := p_quantity;
    when 'reservation_created' then v_reserved := p_quantity;
    when 'reservation_released','reservation_expired' then v_reserved := -p_quantity;
    when 'sale_committed' then
      v_on_hand := -p_quantity; v_reserved := -p_quantity; v_committed := p_quantity;
    when 'adjustment_decrease' then v_on_hand := -p_quantity;
    when 'waste_recorded' then
      v_on_hand := -p_quantity; v_waste := p_quantity;
      if coalesce(p_public_data->>'action','')='dispose_from_quarantine' then
        v_quarantine := -p_quantity;
      end if;
    when 'damage_recorded' then v_damaged := p_quantity;
    when 'quarantine_entered' then v_quarantine := p_quantity;
    when 'inspection_queued' then v_on_hand := p_quantity; v_quarantine := p_quantity;
    when 'quarantine_released' then v_quarantine := -p_quantity;
    when 'refund_not_restocked' then null;
    when 'count_correction' then
      if coalesce((p_public_data->>'direction'),'')='increase' then v_on_hand:=p_quantity;
      elsif coalesce((p_public_data->>'direction'),'')='decrease' then v_on_hand:=-p_quantity;
      else raise exception 'COUNT_CORRECTION_DIRECTION_REQUIRED'; end if;
    else raise exception 'INVENTORY_ENTRY_TYPE_INVALID';
  end case;

  if v_balance.reserved+v_reserved < 0 or v_balance.damaged+v_damaged < 0
     or v_balance.quarantine+v_quarantine < 0 then
    raise exception 'INVENTORY_SOURCE_STATE_INSUFFICIENT';
  end if;
  if v_balance.on_hand+v_on_hand-v_balance.reserved-v_reserved
       -v_balance.quarantine-v_quarantine-v_balance.damaged-v_damaged < 0 then
    if v_item.negative_stock_policy in ('block','not_applicable') then
      raise exception 'NEGATIVE_STOCK_BLOCKED';
    elsif v_item.negative_stock_policy='manager_override' and not exists (
      select 1 from runtime.elevation_grant g
       where g.id=nullif(p_public_data->>'negativeStockApprovalId','')::uuid
         and g.merchant_id=p_merchant_id and g.location_id=p_location_id
         and g.permission_key='inventory.negative_stock.override'
         and g.command_fingerprint=p_fingerprint
         and g.consumed_by_command_id=p_command_id and g.consumed_at is not null
    ) then
      raise exception 'NEGATIVE_STOCK_APPROVAL_REQUIRED';
    end if;
  end if;

  insert into merchant.stock_ledger_entry(
    merchant_id,location_id,inventory_location_id,inventory_item_id,sequence,entry_type,
    quantity,quantity_scale,unit,effect_on_hand,effect_reserved,effect_committed,
    effect_damaged,effect_quarantine,effect_waste,command_id,idempotency_key,
    command_fingerprint,source_aggregate_type,source_aggregate_id,sale_id,sale_line_id,
    refund_id,count_id,operator_id,device_id,credential_version,business_date,correlation_id,
    public_data
  ) values (
    p_merchant_id,p_location_id,p_inventory_location_id,p_inventory_item_id,
    v_balance.ledger_sequence+1,p_entry_type,p_quantity,v_item.quantity_scale,v_item.base_unit,
    v_on_hand,v_reserved,v_committed,v_damaged,v_quarantine,v_waste,p_command_id,
    p_idempotency_key,p_fingerprint,p_source_type,p_source_id,p_sale_id,p_sale_line_id,
    p_refund_id,p_count_id,p_operator_id,p_device_id,p_credential_version,p_business_date,
    p_correlation_id,p_public_data
  )
  on conflict (merchant_id,command_id,inventory_item_id,entry_type,source_aggregate_id,sale_line_id)
  do nothing
  returning * into v_entry;
  if not found then
    select * into v_entry from merchant.stock_ledger_entry
     where merchant_id=p_merchant_id and command_id=p_command_id
       and inventory_item_id=p_inventory_item_id and entry_type=p_entry_type
       and source_aggregate_id=p_source_id
       and sale_line_id is not distinct from p_sale_line_id;
    if not found or v_entry.command_fingerprint<>p_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return v_entry;
  end if;

  if v_entry.sequence=v_balance.ledger_sequence+1 then
    update merchant.stock_balance set
      on_hand=on_hand+v_on_hand,reserved=reserved+v_reserved,
      committed=committed+v_committed,damaged=damaged+v_damaged,
      quarantine=quarantine+v_quarantine,waste=waste+v_waste,
      ledger_sequence=v_entry.sequence,version=version+1,calculated_at=clock_timestamp()
    where inventory_location_id=p_inventory_location_id and inventory_item_id=p_inventory_item_id;
  end if;
  return v_entry;
end $$;

create or replace function merchant.release_inventory_reservation(
  p_reservation_id uuid,
  p_entry_type text default 'reservation_released'
) returns integer
language plpgsql security invoker set search_path=pg_catalog,merchant,runtime as $$
declare r record; v_res merchant.inventory_reservation%rowtype; v_actor record; v_count integer:=0;
begin
  if p_entry_type not in ('reservation_released','reservation_expired') then
    raise exception 'RESERVATION_RELEASE_TYPE_INVALID';
  end if;
  select * into v_res from merchant.inventory_reservation
   where id=p_reservation_id and status in ('active','reserved') for update;
  if not found then return 0; end if;
  select os.user_id,os.device_id,d.credential_version,c.business_date
    into v_actor from runtime.operator_session os
    join merchant.device d on d.id=os.device_id
    join merchant.pos_cart c on c.operator_session_id=os.id and c.id=v_res.cart_id
   where os.id=c.operator_session_id;
  for r in select * from merchant.inventory_reservation_line
    where reservation_id=p_reservation_id order by inventory_item_id,sale_line_id
  loop
    perform merchant.append_stock_ledger(
      r.merchant_id,r.location_id,r.inventory_location_id,r.inventory_item_id,p_entry_type,
      r.required_quantity,v_res.command_id,v_res.command_id,v_res.command_fingerprint,
      'inventory_reservation',v_res.id,v_actor.user_id,v_actor.device_id,
      v_actor.credential_version,v_actor.business_date,'reservation-release',
      null,r.sale_line_id,null,null,jsonb_build_object('reservationId',v_res.id)
    );
    v_count:=v_count+1;
  end loop;
  update merchant.inventory_reservation set
    status=case when p_entry_type='reservation_expired' then 'expired' else 'released' end,
    updated_at=clock_timestamp() where id=p_reservation_id;
  return v_count;
end $$;

create or replace function merchant.expire_inventory_reservations(
  p_merchant_id uuid,
  p_location_id uuid
) returns integer
language plpgsql security invoker set search_path=pg_catalog,merchant as $$
declare r record; v_count integer:=0;
begin
  for r in
    select id from merchant.inventory_reservation
     where merchant_id=p_merchant_id and location_id=p_location_id
       and status in ('active','reserved') and expires_at<=clock_timestamp()
     order by id for update skip locked
  loop
    v_count:=v_count+merchant.release_inventory_reservation(r.id,'reservation_expired');
  end loop;
  return v_count;
end $$;

create or replace function merchant.release_cart_inventory_on_cancel() returns trigger
language plpgsql security invoker set search_path=pg_catalog,merchant as $$
declare v_reservation uuid;
begin
  if new.lifecycle_state='cancelled' and old.lifecycle_state is distinct from 'cancelled' then
    select id into v_reservation from merchant.inventory_reservation
     where cart_id=new.id and status in ('active','reserved') for update;
    if v_reservation is not null then
      perform merchant.release_inventory_reservation(v_reservation,'reservation_released');
    end if;
  end if;
  return new;
end $$;
create trigger pos_cart_inventory_cancel_release
  after update of lifecycle_state on merchant.pos_cart
  for each row execute function merchant.release_cart_inventory_on_cancel();

create or replace function merchant.release_cart_inventory_on_edit() returns trigger
language plpgsql security invoker set search_path=pg_catalog,merchant as $$
declare v_cart_id uuid; v_reservation uuid;
begin
  if tg_op='DELETE' then v_cart_id:=old.cart_id; else v_cart_id:=new.cart_id; end if;
  select id into v_reservation from merchant.inventory_reservation
   where cart_id=v_cart_id and status in ('active','reserved') for update;
  if v_reservation is not null then
    perform merchant.release_inventory_reservation(v_reservation,'reservation_released');
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger pos_cart_line_inventory_edit_release
  before insert or update or delete on merchant.pos_cart_line
  for each row execute function merchant.release_cart_inventory_on_edit();

create or replace function merchant.release_modifier_inventory_on_edit() returns trigger
language plpgsql security invoker set search_path=pg_catalog,merchant as $$
declare v_cart_id uuid; v_line_id uuid; v_reservation uuid;
begin
  if tg_op='DELETE' then v_line_id:=old.line_id; else v_line_id:=new.line_id; end if;
  select cart_id into v_cart_id from merchant.pos_cart_line where id=v_line_id;
  select id into v_reservation from merchant.inventory_reservation
   where cart_id=v_cart_id and status in ('active','reserved') for update;
  if v_reservation is not null then
    perform merchant.release_inventory_reservation(v_reservation,'reservation_released');
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger pos_cart_modifier_inventory_edit_release
  before insert or update or delete on merchant.pos_cart_line_modifier
  for each row execute function merchant.release_modifier_inventory_on_edit();

create or replace function merchant.rebuild_stock_balance(
  p_inventory_location_id uuid,
  p_inventory_item_id uuid
) returns merchant.stock_balance
language plpgsql security definer set search_path=pg_catalog,merchant as $$
declare v merchant.stock_balance%rowtype;
begin
  select b.merchant_id,b.location_id,b.inventory_location_id,b.inventory_item_id,
         b.quantity_scale,b.unit,
         coalesce(sum(e.effect_on_hand),0),coalesce(sum(e.effect_reserved),0),
         coalesce(sum(e.effect_committed),0),coalesce(sum(e.effect_damaged),0),
         coalesce(sum(e.effect_quarantine),0),coalesce(sum(e.effect_waste),0),
         coalesce(sum(e.effect_in_transit),0),0,coalesce(max(e.sequence),0),b.version+1,
         clock_timestamp()
    into v
    from merchant.stock_balance b
    left join merchant.stock_ledger_entry e
      on e.inventory_location_id=b.inventory_location_id and e.inventory_item_id=b.inventory_item_id
   where b.inventory_location_id=p_inventory_location_id and b.inventory_item_id=p_inventory_item_id
   group by b.merchant_id,b.location_id,b.inventory_location_id,b.inventory_item_id,
            b.quantity_scale,b.unit,b.version;
  if not found then raise exception 'INVENTORY_BALANCE_NOT_FOUND'; end if;
  if (current_setting('role',true) in ('api','worker') or (
        not coalesce((select rolsuper from pg_roles where rolname=session_user),false)
        and (pg_has_role(session_user,'api','USAGE')
          or pg_has_role(session_user,'worker','USAGE'))
      ))
     and (nullif(current_setting('app.current_merchant',true),'') is null
       or nullif(current_setting('app.current_location',true),'') is null) then
    raise exception 'INVENTORY_CONTEXT_REQUIRED';
  end if;
  if nullif(current_setting('app.current_merchant',true),'') is not null
     and current_setting('app.current_merchant',true)::uuid<>v.merchant_id then
    raise exception 'INVENTORY_MERCHANT_SCOPE';
  end if;
  if nullif(current_setting('app.current_location',true),'') is not null
     and current_setting('app.current_location',true)::uuid<>v.location_id then
    raise exception 'INVENTORY_LOCATION_SCOPE';
  end if;
  update merchant.stock_balance set on_hand=v.on_hand,reserved=v.reserved,committed=v.committed,
    damaged=v.damaged,quarantine=v.quarantine,waste=v.waste,in_transit=v.in_transit,
    ledger_sequence=v.ledger_sequence,version=v.version,calculated_at=v.calculated_at
  where inventory_location_id=p_inventory_location_id and inventory_item_id=p_inventory_item_id
  returning * into v;
  return v;
end $$;

create or replace function merchant.commit_sale_inventory(
  p_reservation_id uuid,
  p_sale_id uuid,
  p_command_id uuid,
  p_operator_id uuid,
  p_device_id uuid,
  p_credential_version integer,
  p_business_date date,
  p_correlation_id text
) returns integer
language plpgsql security invoker set search_path=pg_catalog,merchant as $$
declare r record; v_count integer:=0;
begin
  perform 1 from merchant.inventory_reservation
   where id=p_reservation_id and status in ('active','reserved') and expires_at>clock_timestamp()
   for update;
  if not found then raise exception 'RESERVATION_EXPIRED'; end if;
  for r in select * from merchant.inventory_reservation_line
    where reservation_id=p_reservation_id order by inventory_item_id,sale_line_id
  loop
    perform merchant.append_stock_ledger(
      r.merchant_id,r.location_id,r.inventory_location_id,r.inventory_item_id,
      'sale_committed',r.required_quantity,p_command_id,p_command_id,
      encode(extensions.digest(p_command_id::text||':'||r.inventory_item_id::text||':'||r.sale_line_id::text,'sha256'),'hex'),
      'pos_sale',p_sale_id,p_operator_id,p_device_id,p_credential_version,p_business_date,
      p_correlation_id,p_sale_id,r.sale_line_id,null,null,
      jsonb_build_object('mappingId',r.mapping_id,'mappingVersion',r.mapping_version,
        'recipeId',r.recipe_id,'recipeVersion',r.recipe_version)
    );
    v_count:=v_count+1;
  end loop;
  update merchant.inventory_reservation set status='committed',committed_at=clock_timestamp(),updated_at=clock_timestamp()
   where id=p_reservation_id;
  return v_count;
end $$;

-- No UPDATE or DELETE grant exists for the immutable facts.
revoke update, delete on merchant.stock_ledger_entry, merchant.inventory_count_line,
  merchant.inventory_reconciliation, merchant.inventory_restock_outcome,
  merchant.inventory_command_result from api, worker;
revoke insert on merchant.stock_ledger_entry from api,worker;
grant select on merchant.stock_ledger_entry to api,worker;
grant select,insert on merchant.inventory_count_line,
  merchant.inventory_reconciliation,merchant.inventory_restock_outcome,
  merchant.inventory_command_result to api,worker;
grant select,insert,update on merchant.inventory_location,merchant.inventory_item,
  merchant.inventory_unit_conversion,merchant.inventory_recipe,
  merchant.inventory_recipe_component,merchant.inventory_catalog_mapping,
  merchant.inventory_policy,merchant.inventory_reservation_line,
  merchant.inventory_count to api,worker;
revoke insert,update,delete on merchant.stock_balance from api,worker;
grant select on merchant.stock_balance to api,worker;
revoke all on function merchant.append_stock_ledger(uuid,uuid,uuid,uuid,text,bigint,uuid,uuid,text,text,uuid,uuid,uuid,integer,date,text,uuid,uuid,uuid,uuid,jsonb),
  merchant.rebuild_stock_balance(uuid,uuid)
  from public,readonly;
grant execute on function merchant.append_stock_ledger(uuid,uuid,uuid,uuid,text,bigint,uuid,uuid,text,text,uuid,uuid,uuid,integer,date,text,uuid,uuid,uuid,uuid,jsonb),
  merchant.rebuild_stock_balance(uuid,uuid),
  merchant.commit_sale_inventory(uuid,uuid,uuid,uuid,uuid,integer,date,text),
  merchant.release_inventory_reservation(uuid,text),
  merchant.expire_inventory_reservations(uuid,uuid)
  to api,worker;

-- Inventory tables use the same fail-closed merchant and location context as UmiPOS.
do $$
declare t text;
begin
  foreach t in array array[
    'inventory_location','inventory_item','inventory_unit_conversion','inventory_recipe',
    'inventory_recipe_component','inventory_catalog_mapping','inventory_policy','stock_balance',
    'stock_ledger_entry','inventory_reservation_line','inventory_restock_outcome',
    'inventory_count','inventory_count_line','inventory_reconciliation','inventory_command_result'
  ] loop
    execute format('alter table merchant.%I enable row level security',t);
    execute format('alter table merchant.%I force row level security',t);
    execute format(
      'create policy %I on merchant.%I using (merchant_id=umi.current_merchant()) with check (merchant_id=umi.current_merchant())',
      t||'_scope',t
    );
  end loop;
end $$;

comment on table merchant.stock_ledger_entry is
  'Append-only physical stock facts. The balance projection is rebuildable from this table.';
comment on table merchant.stock_balance is
  'Validated stock projection. It is never the sole mutation authority.';
comment on table merchant.inventory_restock_outcome is
  'Inventory consumption of an immutable Gate 3D restock intent.';

commit;
