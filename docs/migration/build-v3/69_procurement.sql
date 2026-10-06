\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- build-v3 · 69_procurement — workstream E, step 3: "Add purchase orders,
-- suppliers, and receiving."
--
-- WHAT THIS ADDS AND WHY EACH PART EXISTS.
--
--   1. A supplier is a merchant-scoped party the business buys from. It is a
--      STANDING record (a name, a contact, an active flag), not a document, so a
--      purchase order points at it and never copies its text.
--   2. A purchase order is the DOCUMENT: what we intend to buy, from whom, for
--      which stock location, at what price. It is edited while it is a draft and
--      becomes a commitment the moment it is SENT.
--   3. A receipt is the FACT: what actually turned up, in what quantity, at what
--      real cost. Receiving is what moves stock.
--
-- THE STOCK MECHANISM IS THE ONE THAT ALREADY EXISTS. `stock_balance` has carried
-- `in_transit` and `stock_ledger_entry` has carried `effect_in_transit` since
-- 36_pos_inventory.sql, together with the placeholder types
-- `transfer_in_foundation` / `transfer_out_foundation`. This file does NOT add a
-- parallel stock model: goods on order are the `in_transit` state of the SAME
-- balance row the sale path decrements, and every movement is the SAME
-- `merchant.append_stock_ledger` the rest of the platform posts through.
--
--   send    → `purchase_ordered`           in_transit +ordered
--   receive → `purchase_received`          on_hand +received, in_transit -received
--   cancel  → `purchase_order_cancelled`   in_transit -outstanding
--
-- WHY THREE ENTRY TYPES AND NOT ONLY `purchase_received`. The increment's brief
-- says a receipt that is not in the ledger is not real, and it is right. But it
-- also says sending is "the moment stock becomes in_transit" and that cancelling
-- "releases its in_transit", and neither of those facts can be recorded with a
-- receipt type alone: an append-only ledger that mentions only the arrival cannot
-- explain where the transit balance came from. So the ledger gets the whole story
-- — order, receive, cancel — and the balance projection stays rebuildable from it,
-- which is the property 36_pos_inventory.sql states for `stock_balance` ("the
-- balance projection is rebuildable from this table").
--
-- THE INVARIANTS ARE IN SQL, NOT IN THE API, because the same reason
-- 67_table_state.sql gives: an application check is a promise, a CHECK constraint
-- is enforced for every writer including a future one, a backfill, and psql.
--
--   purchase_order_line_not_over_received
--       received_quantity <= ordered_quantity. THE headline invariant: a purchase
--       order cannot be over-received. The API refuses an over-receipt with a
--       typed error naming the line BEFORE it posts anything, so an operator gets
--       a sentence rather than a SQLSTATE; this constraint is the backstop that
--       makes the refusal true even for a writer that never asked the API.
--   purchase_order_sent_shape
--       an order that is neither a draft nor cancelled has a `sent_at`. "draft" is
--       the only status in which the lines are still editable, and it is therefore
--       the only status in which no stock is reserved in transit. A cancelled order
--       may or may not have been sent: abandoning an unused draft is legitimate, and
--       so is stopping a delivery that is already in transit.
--   purchase_order_cancelled_shape
--       `cancelled_at` is set exactly when the status is `cancelled`.
--   purchase_order_completed_shape
--       `completed_at` is set exactly when the status is `received`.
--   receipt line scope
--       every composite foreign key carries `merchant_id`, so a receipt line
--       cannot reference another merchant's order, line or item. UUID uniqueness
--       is not a scope check (the lesson 36_pos_inventory.sql records at length),
--       so the references are all (merchant_id, id) pairs.
--
-- WHAT IS NOT ENFORCED HERE, STATED PLAINLY.
--
--   · The relation between `unit_cost_minor` and `line_total_minor` is NOT a
--     CHECK. `unit_cost_minor` is the price of one whole base unit and
--     `line_total_minor` is the extended amount, and the two are related by a
--     rounding step when the quantity is scaled (a 250 g line at $120.50/kg).
--     A constraint would have to encode that rounding, and an unreadable
--     expression is not a stronger guarantee than a tested function. The rule
--     lives in ONE place — `procurement-domain.ts`, integer arithmetic only — and
--     `procurement.integration.ts` asserts the stored pair. Money is integer
--     minor units and quantities are scaled integers everywhere in this file; no
--     float is stored, and none is used to compute one.
--   · "Nothing moves when a receipt is refused" is a TRANSACTION property, not a
--     constraint: the receipt, its lines and every ledger entry are written in one
--     transaction, so a refusal on the second line of a two-line receipt rolls
--     back the first. The integration suite asserts exactly that shape, because a
--     partial posting would be invisible in a single-line test.
--   · A line may not be added to a sent order — enforced by the API (a sent order
--     has already put its lines in transit, and editing them would desynchronise
--     the ledger). The schema cannot express "this document is closed to edits"
--     beyond the status it already carries.
--   · The MONEY totals are not constrained at the header. `ordered_total_minor` is
--     the sum of the line totals and `received_total_minor` the sum of what was
--     invoiced, and a supplier's invoice is allowed to cost MORE than the order —
--     that is what a price rise looks like, and a `received <= ordered` money check
--     would refuse a real delivery. The quantity constraint carries the invariant;
--     both sums are maintained in the same transaction that writes their lines, and
--     the integration suite asserts each one against its lines.
--   · `expires_at` is deliberately ABSENT from these tables. The neighbours that
--     carry it either issue a short-lived policy snapshot (`inventory_policy`) or
--     a replayable command result (`inventory_command_result`); neither has an
--     analogue here. A purchase order is a standing document with an explicit
--     status, not a lease, and inventing an expiry would make an old order
--     silently unreadable. VERSION stamps ARE carried where a row is mutable, as
--     the neighbours do.
--
-- SCOPE, RLS AND GRANTS. These tables are created after 90_rls swept the catalog,
-- so — like 65_table_reservation and 67_table_state record — each one carries its
-- own forced RLS policy here. The console writes them, so `api` gets
-- select/insert/update; the receipt and its lines are immutable facts and get no
-- update or delete grant at all. The stock consequences never touch
-- `stock_ledger_entry` or `stock_balance` directly: both are read-only to the
-- application roles and the ledger function is the only door, exactly as before.
--
-- Idempotent and re-runnable: guarded tables, guarded constraints, guarded
-- triggers, guarded policies, and a `create or replace` on the ledger function.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Suppliers
--
-- `public_reference` is the merchant's own code for the supplier, and it is the
-- namespace a supplier's item codes live in: `purchase_order_line.supplier_sku`
-- is meaningless without the supplier it belongs to, which is why the SKU is on
-- the line and the reference is on the party.
-- ---------------------------------------------------------------------------
create table if not exists merchant.supplier (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  public_reference text not null check (public_reference ~ '^[A-Za-z0-9._:-]{1,80}$'),
  display_name text not null check (length(display_name) between 1 and 160),
  contact_name text check (contact_name is null or length(contact_name) between 1 and 160),
  contact_email text
    check (contact_email is null or (length(contact_email) between 3 and 254 and contact_email like '%@%')),
  contact_phone text check (contact_phone is null or length(contact_phone) between 1 and 40),
  -- Free text an operator may type, so it is bounded and it may not carry markup.
  note text check (note is null or (length(note) <= 240 and note !~ '[<>]')),
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  -- Mutable, so it carries the same `updated_at` the neighbours' mutable tables do
  -- — and it is not decoration: `public.tg_touch_updated_at()` refuses to attach to
  -- a table without it, which is how a missing column here would surface as a
  -- runtime error on the first edit rather than at build time.
  updated_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  unique (merchant_id, public_reference),
  unique (merchant_id, id),
  check ((archived_at is null) = active)
);

comment on table merchant.supplier is
  'A merchant-scoped party the business buys from. A standing record, not a document: purchase orders point at it.';
comment on column merchant.supplier.public_reference is
  'The merchant''s own code for this supplier, and the namespace its item codes live in (see purchase_order_line.supplier_sku).';

-- ---------------------------------------------------------------------------
-- 2 · The purchase order
--
-- `inventory_location_id` is where the goods will land, and it is the same
-- location the ledger will post the transit and the on-hand to. It is chosen when
-- the order is raised rather than when it arrives, because stock that is expected
-- somewhere is a fact the kitchen can act on.
-- ---------------------------------------------------------------------------
create table if not exists merchant.purchase_order (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  inventory_location_id uuid not null,
  supplier_id uuid not null,
  public_reference text not null check (public_reference ~ '^[A-Za-z0-9._:-]{1,80}$'),
  status text not null default 'draft'
    check (status in ('draft','sent','partially_received','received','cancelled')),
  currency text not null default 'MXN' check (currency ~ '^[A-Z]{3}$'),
  expected_on date,
  -- Minor currency units (centavos). Integers, like every money column on this
  -- platform: 31_pos_sale.sql and 20_merchant.sql both store money as bigint.
  ordered_total_minor bigint not null default 0 check (ordered_total_minor >= 0),
  received_total_minor bigint not null default 0 check (received_total_minor >= 0),
  version integer not null default 1 check (version > 0),
  raised_by uuid not null references umi.user(id) on delete restrict,
  note text check (note is null or (length(note) <= 240 and note !~ '[<>]')),
  -- Derived by merchant.tg_business_date from created_at, the merchant timezone
  -- and business_day_start, exactly as pos_cart and customer_order are — and for a
  -- sharper reason here: sending an order posts a stock ledger entry, and every
  -- ledger entry carries the trading day it belongs to. Deriving it means a retried
  -- send posts the same day the first attempt would have, whatever the clock says.
  business_date date not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  foreign key (merchant_id, location_id, inventory_location_id)
    references merchant.inventory_location(merchant_id, location_id, id) on delete restrict,
  foreign key (merchant_id, supplier_id)
    references merchant.supplier(merchant_id, id) on delete restrict,
  unique (merchant_id, public_reference),
  unique (merchant_id, id),
  constraint purchase_order_sent_shape
    check (sent_at is not null or status in ('draft','cancelled')),
  constraint purchase_order_completed_shape check ((status = 'received') = (completed_at is not null)),
  constraint purchase_order_cancelled_shape check ((status = 'cancelled') = (cancelled_at is not null))
);

comment on table merchant.purchase_order is
  'A purchase order: what the business intends to buy, from which supplier, for which stock location. Sending it is what puts the goods in transit.';
comment on column merchant.purchase_order.status is
  'draft (editable, nothing in transit) → sent → partially_received → received, or cancelled from draft/sent/partially_received.';
comment on column merchant.purchase_order.received_total_minor is
  'Money actually invoiced, in minor units. It may legitimately differ from ordered_total_minor, because a supplier raises a price; the invariant with teeth is the per-line quantity one.';

create index if not exists purchase_order_open_idx
  on merchant.purchase_order (merchant_id, location_id, status)
  where status in ('sent','partially_received');
create index if not exists purchase_order_supplier_idx
  on merchant.purchase_order (merchant_id, supplier_id);

-- ---------------------------------------------------------------------------
-- 3 · The lines
--
-- `quantity_scale` and `unit` are copied from `inventory_item` at the moment the
-- line is written and are NOT re-read later: an item whose base unit is changed
-- tomorrow must not silently reinterpret an order raised today, which is the same
-- snapshot discipline (and the same reason) `pos_cart_line` records for product
-- names and prices.
-- ---------------------------------------------------------------------------
create table if not exists merchant.purchase_order_line (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  purchase_order_id uuid not null,
  line_number integer not null check (line_number between 1 and 1000),
  inventory_item_id uuid not null,
  -- The supplier's own code for this item, inside this supplier's SKU space.
  supplier_sku text check (supplier_sku is null or length(supplier_sku) between 1 and 80),
  description text check (description is null or length(description) between 1 and 160),
  ordered_quantity bigint not null check (ordered_quantity between 1 and 9007199254740991),
  quantity_scale smallint not null check (quantity_scale between 0 and 6),
  unit text not null check (unit in (
    'unit','gram','kilogram','milliliter','liter','portion','package','box'
  )),
  received_quantity bigint not null default 0 check (received_quantity >= 0),
  -- Minor currency units per ONE whole base unit (per kilogram, per piece), as
  -- typed from the supplier's document.
  unit_cost_minor bigint not null check (unit_cost_minor >= 0),
  line_total_minor bigint not null check (line_total_minor >= 0),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id, purchase_order_id)
    references merchant.purchase_order(merchant_id, id) on delete restrict,
  foreign key (merchant_id, inventory_item_id)
    references merchant.inventory_item(merchant_id, id) on delete restrict,
  unique (merchant_id, id),
  unique (purchase_order_id, line_number),
  -- THE headline invariant. Refused for every writer, including one that never
  -- asked the API: a purchase order cannot be over-received.
  constraint purchase_order_line_not_over_received check (received_quantity <= ordered_quantity)
);

comment on table merchant.purchase_order_line is
  'One ordered item. received_quantity accumulates across receipts and may never exceed ordered_quantity.';
comment on column merchant.purchase_order_line.quantity_scale is
  'Snapshot of the item''s scale at the time the line was written. Not re-read: changing an item''s base unit must not reinterpret an existing order.';

create index if not exists purchase_order_line_order_idx
  on merchant.purchase_order_line (merchant_id, purchase_order_id, line_number);

-- ---------------------------------------------------------------------------
-- 4 · Receipts — what actually arrived
--
-- `business_date` is DERIVED by merchant.tg_business_date from `created_at`, the
-- merchant timezone and the merchant's business-day start, exactly as
-- `pos_cart.business_date` and `customer_order.business_date` are: a column a
-- caller could write is a column a caller can get wrong, and this one decides
-- which day's cost lands in the books. It is attached below because 60_triggers
-- swept the catalog before this table existed.
--
-- `command_id` / `idempotency_key` / `command_fingerprint` are carried because a
-- receipt IS a command: a send or a receive that loses its response must be
-- replayable without posting stock twice, and the unique keys here are the second
-- half of the guarantee that `merchant.business_command`'s claim provides.
-- ---------------------------------------------------------------------------
create table if not exists merchant.purchase_order_receipt (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  inventory_location_id uuid not null,
  purchase_order_id uuid not null,
  command_id uuid not null,
  idempotency_key uuid not null,
  command_fingerprint text not null check (command_fingerprint ~ '^[a-f0-9]{64}$'),
  received_by uuid not null references umi.user(id) on delete restrict,
  business_date date not null,
  correlation_id text not null check (length(correlation_id) between 1 and 128),
  total_minor bigint not null default 0 check (total_minor >= 0),
  note text check (note is null or (length(note) <= 240 and note !~ '[<>]')),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id, purchase_order_id)
    references merchant.purchase_order(merchant_id, id) on delete restrict,
  foreign key (merchant_id, location_id, inventory_location_id)
    references merchant.inventory_location(merchant_id, location_id, id) on delete restrict,
  unique (merchant_id, command_id),
  unique (merchant_id, idempotency_key),
  unique (merchant_id, id)
);

comment on table merchant.purchase_order_receipt is
  'Goods actually received against a purchase order. Immutable: this is what moved stock.';
comment on column merchant.purchase_order_receipt.business_date is
  'Derived by merchant.tg_business_date from created_at, the merchant timezone and business_day_start. Never supplied by a client.';

create index if not exists purchase_order_receipt_order_idx
  on merchant.purchase_order_receipt (merchant_id, purchase_order_id, created_at desc);

create table if not exists merchant.purchase_order_receipt_line (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  receipt_id uuid not null,
  purchase_order_id uuid not null,
  purchase_order_line_id uuid not null,
  inventory_item_id uuid not null,
  -- The ledger row this line posted. Every received line has exactly one, and the
  -- unique key below is what makes that one-to-one. There is deliberately NO
  -- foreign key: `stock_ledger_entry` is append-only and carries no
  -- `unique (merchant_id, id)`, and a row in it can never be deleted, so a
  -- reference would buy nothing the ledger's own immutability does not already
  -- give. The ledger row — not this column — is the authority on WHERE the stock
  -- landed, which is why this table carries no inventory location of its own.
  stock_ledger_entry_id uuid,
  received_quantity bigint not null check (received_quantity between 1 and 9007199254740991),
  quantity_scale smallint not null check (quantity_scale between 0 and 6),
  unit text not null check (unit in (
    'unit','gram','kilogram','milliliter','liter','portion','package','box'
  )),
  -- The cost actually invoiced, which is not always the ordered one.
  actual_unit_cost_minor bigint not null check (actual_unit_cost_minor >= 0),
  line_total_minor bigint not null check (line_total_minor >= 0),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id, receipt_id)
    references merchant.purchase_order_receipt(merchant_id, id) on delete restrict,
  foreign key (merchant_id, purchase_order_id)
    references merchant.purchase_order(merchant_id, id) on delete restrict,
  foreign key (merchant_id, purchase_order_line_id)
    references merchant.purchase_order_line(merchant_id, id) on delete restrict,
  foreign key (merchant_id, inventory_item_id)
    references merchant.inventory_item(merchant_id, id) on delete restrict,
  unique (merchant_id, id),
  -- One line per ordered line per receipt: a partial receipt is a NEW receipt, not
  -- a second row here. This is also what makes the ledger's idempotency key
  -- (source_aggregate_id = this row's id) unique per line.
  unique (receipt_id, purchase_order_line_id),
  unique (merchant_id, stock_ledger_entry_id)
);

comment on table merchant.purchase_order_receipt_line is
  'One arrived item. `stock_ledger_entry_id` points at the immutable ledger fact that moved the stock.';

-- ---------------------------------------------------------------------------
-- 5 · `purchase_received`, and the two facts that make it readable
--
-- 36_pos_inventory.sql declared the entry_type CHECK inline, so the constraint has
-- an auto-generated name (`stock_ledger_entry_entry_type_check`). It is dropped and
-- re-created here rather than edited there, because a numbered file that has been
-- applied is frozen (freeze.sh, and D3 in the PR gate).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname='merchant' and cl.relname='stock_ledger_entry'
       and c.conname='stock_ledger_entry_entry_type_check'
       and pg_get_constraintdef(c.oid) not like '%purchase_received%'
  ) then
    alter table merchant.stock_ledger_entry drop constraint stock_ledger_entry_entry_type_check;
  end if;

  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname='merchant' and cl.relname='stock_ledger_entry'
       and c.conname='stock_ledger_entry_entry_type_check'
  ) then
    alter table merchant.stock_ledger_entry add constraint stock_ledger_entry_entry_type_check
      check (entry_type in (
        'opening_balance','reservation_created','reservation_released','reservation_expired',
        'sale_committed','refund_restocked','refund_not_restocked','inspection_queued',
        'adjustment_increase','adjustment_decrease','waste_recorded','damage_recorded',
        'quarantine_entered','quarantine_released','count_correction',
        'transfer_out_foundation','transfer_in_foundation',
        'purchase_ordered','purchase_received','purchase_order_cancelled'
      ));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6 · The ledger function, restated with the three procurement branches
--
-- `create or replace` with the SAME argument list, so the existing
-- `grant execute ... to api,worker` from 36_pos_inventory.sql still applies to
-- this definition. The body below is 36_pos_inventory.sql's, verbatim, with two
-- changes, both marked:
--
--   (a) three `when` branches for the procurement types;
--   (b) `in_transit` joins the insufficient-state guard. `stock_balance.in_transit`
--       has no `check (in_transit >= 0)` — it was added for transfers and never
--       had a writer — so receiving more than is in transit would have driven it
--       negative silently. The guard is added here rather than as a column
--       constraint so that the refusal is a typed SQLSTATE from the same place as
--       its reserved/damaged/quarantine siblings.
-- ---------------------------------------------------------------------------
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
  v_in_transit bigint := 0;
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
    -- (a) Procurement. Ordering puts the goods in transit; receiving converts
    -- transit into an on-hand balance at the receiving location; cancelling
    -- releases what never arrived.
    when 'purchase_ordered' then v_in_transit := p_quantity;
    when 'purchase_received' then
      v_on_hand := p_quantity; v_in_transit := -p_quantity;
    when 'purchase_order_cancelled' then v_in_transit := -p_quantity;
    else raise exception 'INVENTORY_ENTRY_TYPE_INVALID';
  end case;

  if v_balance.reserved+v_reserved < 0 or v_balance.damaged+v_damaged < 0
     or v_balance.quarantine+v_quarantine < 0
     -- (b) in_transit. See the header: the column has no CHECK, so this guard is
     -- what refuses a receipt of more than was ordered into transit.
     or v_balance.in_transit+v_in_transit < 0 then
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
    effect_damaged,effect_quarantine,effect_waste,effect_in_transit,command_id,idempotency_key,
    command_fingerprint,source_aggregate_type,source_aggregate_id,sale_id,sale_line_id,
    refund_id,count_id,operator_id,device_id,credential_version,business_date,correlation_id,
    public_data
  ) values (
    p_merchant_id,p_location_id,p_inventory_location_id,p_inventory_item_id,
    v_balance.ledger_sequence+1,p_entry_type,p_quantity,v_item.quantity_scale,v_item.base_unit,
    v_on_hand,v_reserved,v_committed,v_damaged,v_quarantine,v_waste,v_in_transit,p_command_id,
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
      in_transit=in_transit+v_in_transit,
      ledger_sequence=v_entry.sequence,version=version+1,calculated_at=clock_timestamp()
    where inventory_location_id=p_inventory_location_id and inventory_item_id=p_inventory_item_id;
  end if;
  return v_entry;
end $$;

-- ---------------------------------------------------------------------------
-- 7 · Triggers
--
-- 60_triggers swept the catalog before these tables existed, so both are attached
-- by hand, for the reason 65_table_reservation and 67_table_state record.
-- ---------------------------------------------------------------------------
drop trigger if exists touch_updated_at on merchant.supplier;
create trigger touch_updated_at before update on merchant.supplier
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists touch_updated_at on merchant.purchase_order;
create trigger touch_updated_at before update on merchant.purchase_order
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists purchase_order_receipt_business_date on merchant.purchase_order_receipt;
create trigger purchase_order_receipt_business_date
  before insert or update on merchant.purchase_order_receipt
  for each row execute function merchant.tg_business_date('created_at');

-- The order carries the day it was RAISED, which is the day its transit belongs
-- to. The receipt above carries the day the goods arrived, which is the day the
-- cost lands: the two are deliberately different columns on different tables.
drop trigger if exists purchase_order_business_date on merchant.purchase_order;
create trigger purchase_order_business_date
  before insert or update on merchant.purchase_order
  for each row execute function merchant.tg_business_date('created_at');

-- A receipt is what moved stock, and the ledger is append-only for the same
-- reason: rewriting either would make the balance projection a lie.
drop trigger if exists purchase_order_receipt_append_only on merchant.purchase_order_receipt;
create trigger purchase_order_receipt_append_only
  before update or delete on merchant.purchase_order_receipt
  for each row execute function merchant.tg_append_only();

drop trigger if exists purchase_order_receipt_line_append_only
  on merchant.purchase_order_receipt_line;
create trigger purchase_order_receipt_line_append_only
  before update or delete on merchant.purchase_order_receipt_line
  for each row execute function merchant.tg_append_only();

-- ---------------------------------------------------------------------------
-- 8 · Grants and RLS
--
-- The console is the only writer. `api` may create and amend an order (a draft is
-- edited, a sent order gets its status moved) but may never rewrite a receipt, and
-- may never write a ledger row or a balance: the ledger function is the only door.
-- ---------------------------------------------------------------------------
grant select,insert,update on merchant.supplier,merchant.purchase_order,
  merchant.purchase_order_line to api,worker;
grant select,insert on merchant.purchase_order_receipt,
  merchant.purchase_order_receipt_line to api,worker;
revoke update,delete on merchant.purchase_order_receipt,
  merchant.purchase_order_receipt_line from api,worker;
grant select on merchant.supplier,merchant.purchase_order,merchant.purchase_order_line,
  merchant.purchase_order_receipt,merchant.purchase_order_receipt_line to readonly;

-- Same argument list as 36_pos_inventory.sql, so this re-grant is belt and braces
-- after the replace above: a grant survives `create or replace`, and re-stating it
-- means a future reader of this file can see the door is open.
revoke all on function merchant.append_stock_ledger(uuid,uuid,uuid,uuid,text,bigint,uuid,uuid,text,text,uuid,uuid,uuid,integer,date,text,uuid,uuid,uuid,uuid,jsonb)
  from public,readonly;
grant execute on function merchant.append_stock_ledger(uuid,uuid,uuid,uuid,text,bigint,uuid,uuid,text,text,uuid,uuid,uuid,integer,date,text,uuid,uuid,uuid,uuid,jsonb)
  to api,worker;

do $$
declare t text;
begin
  foreach t in array array[
    'supplier','purchase_order','purchase_order_line','purchase_order_receipt',
    'purchase_order_receipt_line'
  ] loop
    execute format('alter table merchant.%I enable row level security',t);
    execute format('alter table merchant.%I force row level security',t);
    -- `supplier` is merchant-level and has no location column; the rest carry the
    -- location and take the same narrowing 67_table_state.sql uses, so a
    -- location-scoped session cannot read another branch's deliveries.
    if exists (
      select 1 from information_schema.columns
       where table_schema='merchant' and table_name=t and column_name='location_id'
    ) then
      execute format('drop policy if exists %I on merchant.%I', t||'_scope', t);
      execute format(
        'create policy %I on merchant.%I using (merchant_id=(select umi.current_merchant()) and ((select umi.current_location()) is null or location_id=(select umi.current_location()))) with check (merchant_id=(select umi.current_merchant()) and ((select umi.current_location()) is null or location_id=(select umi.current_location())))',
        t||'_scope',t
      );
    else
      execute format('drop policy if exists %I on merchant.%I', t||'_scope', t);
      execute format(
        'create policy %I on merchant.%I using (merchant_id=(select umi.current_merchant())) with check (merchant_id=(select umi.current_merchant()))',
        t||'_scope',t
      );
    end if;
  end loop;
end $$;

comment on column merchant.stock_balance.in_transit is
  'Goods ordered from a supplier and not yet received. Raised by purchase_ordered, lowered by purchase_received and purchase_order_cancelled; it is never part of `available`.';

insert into runtime.schema_migration(version,status)
values('build-v3-69','applied') on conflict(version) do nothing;

commit;
