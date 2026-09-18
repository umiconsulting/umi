\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- build-v3 · 76_recipes_inventory - workstream E, step 4: "Let an owner build a
-- recipe, produce the prep, and reconcile the stock the kitchen used."
--
-- WHAT THIS FILE ADDS, AND WHY EACH PART EXISTS.
--
--   1. A SUB-RECIPE IS AN ITEM. `inventory_recipe` gains `target_item_id`, and
--      `product_id` becomes nullable. One recipe table serves a plate and a prep.
--      A prepared item carries its own stock and its own rolled-up cost, which is
--      what Lightspeed batches, PoloTab preparados and MarginEdge prep items all
--      do. The component table already points at an item, so nesting needs no new
--      table.
--   2. EXACTLY ONE TARGET. A check constraint refuses a row that names two
--      targets or none.
--   3. A CYCLE GUARD. A trigger walks the item graph on every component write. It
--      refuses a chain that returns to an item it already crossed, and it refuses
--      a chain deeper than 12 levels. The cap is a runaway stop, not a limit on
--      the feature.
--   4. LOTS AND EXPIRY. `stock_lot` carries the production or receipt time, the
--      expiry and the supplier document. `stock_ledger_entry` gains a nullable
--      `lot_id`, so every existing row stays valid and a recall query can name
--      the sales that consumed a lot.
--   5. ALLERGENS ARE A LABEL TABLE AND A MAP. A product's allergen list is
--      DERIVED by exploding its recipe. A stored product list would go stale on
--      the next recipe edit.
--   6. THE SUPPLIER INVOICE. `supplier_invoice` and `supplier_invoice_line` hold
--      what the supplier's document said. A receipt line gains `invoice_line_id`,
--      so a cost names the document that produced it.
--   7. FOUR NEW LEDGER TYPES AND ONE NEW ARGUMENT. `production_consumed`,
--      `production_produced`, `production_yield_loss` and
--      `invoice_variance_adjustment` join the entry-type set, which then holds 24
--      values. `append_stock_ledger` gains a nullable `p_lot_id`.
--
-- A CORRECTION TO THE PLAN, RECORDED HERE. Plan D2 writes the exactly-one-target
-- check as a sum over three columns. That arithmetic refuses every VARIANT
-- recipe, because a variant recipe carries `product_id` AND `variant_id` (36
-- records that with the composite foreign key
-- `(product_id, variant_id) -> product_variant(product_id, id)`). The check below
-- treats "a product, with an optional variant" as ONE target. It is the same
-- rule the plan states, stated so that it holds for the rows that already exist.
--
-- WHAT THIS FILE DOES NOT DO. It stores no cost on `inventory_item`. The cost
-- basis stays the weighted average of receipts, and production rolls cost up from
-- the inputs the server consumed. It stores no second recipe tree.
--
-- SCOPE, RLS AND GRANTS. These tables are created after 90_rls swept the catalog,
-- so each one carries its own forced RLS policy here, as 65, 67 and 69 record.
-- The console writes them. The ledger keeps its one door: the application roles
-- still cannot write `stock_ledger_entry` or `stock_balance` directly.
--
-- Idempotent and re-runnable: guarded columns, guarded constraints, guarded
-- triggers, guarded policies, and a `create or replace` on the ledger function.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · A recipe target is a product or an item
--
-- `shelf_life_days` lives on the item, and a recipe may override it. The recipe
-- version is immutable (D3): an edit retires the old row and writes a new one.
-- `target_item_id` is therefore set once, when the version is written.
-- ---------------------------------------------------------------------------
alter table merchant.inventory_item
  add column if not exists shelf_life_days integer;
alter table merchant.inventory_item
  add column if not exists par_quantity bigint;
alter table merchant.inventory_recipe
  add column if not exists target_item_id uuid,
  add column if not exists shelf_life_days integer;
-- D3: a version keeps the cost it computed when it was written. The cost history read
-- answers "why did my plate cost move" from these columns rather than re-deriving
-- every version against today's basis, which would show every point the same number.
alter table merchant.inventory_recipe
  add column if not exists computed_cost_minor bigint,
  add column if not exists computed_defects text[],
  add column if not exists computed_at timestamptz;
alter table merchant.inventory_recipe
  alter column product_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid='merchant.inventory_item'::regclass
       and conname='inventory_item_shelf_life_days_ck'
  ) then
    alter table merchant.inventory_item add constraint inventory_item_shelf_life_days_ck
      check (shelf_life_days is null or shelf_life_days between 0 and 3650);
  end if;

  -- PAR is the level the kitchen wants on hand before the prep list decides what to
  -- make. It is NOT `low_stock_threshold`: that one is a purchase alarm and it fires
  -- from the supplier side, while par is what the prep list subtracts from. One
  -- number cannot answer both questions, which is why the column is separate.
  if not exists (
    select 1 from pg_constraint
     where conrelid='merchant.inventory_item'::regclass
       and conname='inventory_item_par_quantity_ck'
  ) then
    alter table merchant.inventory_item add constraint inventory_item_par_quantity_ck
      check (par_quantity is null or par_quantity >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid='merchant.inventory_recipe'::regclass
       and conname='inventory_recipe_shelf_life_days_ck'
  ) then
    alter table merchant.inventory_recipe add constraint inventory_recipe_shelf_life_days_ck
      check (shelf_life_days is null or shelf_life_days between 0 and 3650);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid='merchant.inventory_recipe'::regclass
       and conname='inventory_recipe_target_item_fk'
  ) then
    alter table merchant.inventory_recipe add constraint inventory_recipe_target_item_fk
      foreign key (merchant_id, target_item_id)
      references merchant.inventory_item(merchant_id, id) on delete restrict;
  end if;

  -- The headline shape rule. A product target may carry a variant. An item target
  -- carries nothing else. A row with no target and a row with two are both refused.
  if not exists (
    select 1 from pg_constraint
     where conrelid='merchant.inventory_recipe'::regclass
       and conname='inventory_recipe_exactly_one_target_ck'
  ) then
    alter table merchant.inventory_recipe add constraint inventory_recipe_exactly_one_target_ck
      check (
        (target_item_id is not null and product_id is null and variant_id is null)
        or (target_item_id is null and product_id is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid='merchant.inventory_recipe'::regclass
       and conname='inventory_recipe_target_item_version_uk'
  ) then
    alter table merchant.inventory_recipe add constraint inventory_recipe_target_item_version_uk
      unique (merchant_id, target_item_id, version);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid='merchant.inventory_recipe'::regclass
       and conname='inventory_recipe_computed_cost_ck'
  ) then
    alter table merchant.inventory_recipe add constraint inventory_recipe_computed_cost_ck
      check (computed_cost_minor is null or computed_cost_minor >= 0);
  end if;
end $$;

comment on column merchant.inventory_recipe.computed_cost_minor is
  'The cost per one unit of yield, as of computed_at. Null when the version could not be costed.';

-- One active version per target. The old index keyed on (product, variant) alone,
-- which with `product_id` nullable would treat every sub-recipe as the same row.
drop index if exists merchant.inventory_recipe_active_uidx;
create unique index if not exists inventory_recipe_active_target_uidx
  on merchant.inventory_recipe(
    merchant_id,
    coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(target_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where active;
create index if not exists inventory_recipe_target_item_idx
  on merchant.inventory_recipe(merchant_id, target_item_id)
  where target_item_id is not null;

comment on column merchant.inventory_recipe.target_item_id is
  'The prepared item this recipe makes. Non-null marks a sub-recipe. Product and variant targets keep it null.';
comment on column merchant.inventory_recipe.shelf_life_days is
  'Overrides inventory_item.shelf_life_days for the produced lot. Null means use the item.';

-- ---------------------------------------------------------------------------
-- 2 · The cycle and depth guard
--
-- The graph is: a recipe targets an item, and its components are items. A cycle
-- exists when an item is reachable from one of its own components. The trigger
-- walks DOWN from the component that is being written and refuses when it meets
-- the recipe's own target.
--
-- THE WALK IS BOUNDED AT 12 LEVELS, and the bound does two jobs. It makes the
-- runaway stop the plan names, and it stops the recursion itself from looping
-- forever on a chain that a previous writer left behind.
--
-- A plate recipe names a product and no item, so no item chain can ever reach it.
-- The walk still runs for those rows, because a plate may consume a sub-recipe
-- that is already too deep.
-- ---------------------------------------------------------------------------
create or replace function merchant.validate_inventory_recipe_acyclic()
returns trigger
language plpgsql
set search_path = pg_catalog, merchant
as $$
declare
  v_target uuid;
  v_cycle boolean := false;
  v_max_depth integer := 0;
begin
  select r.target_item_id into v_target
    from merchant.inventory_recipe r
   where r.merchant_id = new.merchant_id and r.id = new.recipe_id;
  if not found then
    raise exception 'INVENTORY_RECIPE_NOT_FOUND';
  end if;

  with recursive walk(item_id, depth, path) as (
    select new.inventory_item_id, 1, array[new.inventory_item_id]
    union all
    select c.inventory_item_id, w.depth + 1, w.path || c.inventory_item_id
      from walk w
      join merchant.inventory_recipe r
        on r.merchant_id = new.merchant_id
       and r.target_item_id = w.item_id
       and r.active
      join merchant.inventory_recipe_component c
        on c.merchant_id = r.merchant_id and c.recipe_id = r.id
     where w.depth < 12
       and not (c.inventory_item_id = any (w.path))
  )
  select coalesce(bool_or(item_id = v_target), false), coalesce(max(depth), 0)
    into v_cycle, v_max_depth
    from walk;

  if v_target is not null and v_cycle then
    raise exception 'INVENTORY_RECIPE_CYCLE';
  end if;
  if v_max_depth >= 12 then
    raise exception 'INVENTORY_RECIPE_TOO_DEEP';
  end if;
  return new;
end $$;

drop trigger if exists inventory_recipe_component_acyclic
  on merchant.inventory_recipe_component;
create trigger inventory_recipe_component_acyclic
  before insert or update on merchant.inventory_recipe_component
  for each row execute function merchant.validate_inventory_recipe_acyclic();

-- ---------------------------------------------------------------------------
-- 3 · Allergens
--
-- `inventory_allergen` is the merchant's own label set, so a cafe can name what
-- its market names. `inventory_item_allergen` maps an item to a label. A PRODUCT's
-- list is derived by exploding its recipe, never stored: a stored list goes stale
-- on the next recipe edit.
-- ---------------------------------------------------------------------------
create table if not exists merchant.inventory_allergen (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null check (length(label) between 1 and 80),
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  unique (merchant_id, id),
  unique (merchant_id, code),
  check ((archived_at is null) = active)
);
comment on table merchant.inventory_allergen is
  'A merchant-editable allergen label. A product allergen list is derived by explosion, never stored here.';

create table if not exists merchant.inventory_item_allergen (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  inventory_item_id uuid not null,
  inventory_allergen_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id, inventory_item_id)
    references merchant.inventory_item(merchant_id, id) on delete restrict,
  foreign key (merchant_id, inventory_allergen_id)
    references merchant.inventory_allergen(merchant_id, id) on delete restrict,
  unique (merchant_id, inventory_item_id, inventory_allergen_id)
);
comment on table merchant.inventory_item_allergen is
  'Which allergen labels a raw or prepared item carries. A direct non-stock product uses this table too, because no explosion reaches it.';

-- ---------------------------------------------------------------------------
-- 3b · The allergen explosion
--
-- THE LABELS ARE DERIVED, NEVER STORED A SECOND TIME (D8). A product's allergen
-- list is the union of the labels on everything its recipe consumes, at every
-- level. A stored list would go stale on the next recipe edit.
--
-- ONE WALK SERVES EVERY SURFACE. The kitchen ticket and the guest menu both need
-- this answer, so the recursion lives here once rather than in two repositories
-- that can disagree. Phase 2's cost explosion reuses `inventory_item_subtree`.
--
-- The walk carries the `path` array and the depth bound for the same two reasons
-- the cycle guard does: a row written before the guard existed must not send the
-- read into an infinite loop, and a runaway chain must stop.
--
-- A `non_stock` product yields an EMPTY list. It maps to no item, so no explosion
-- reaches it and no label is stored for it. An empty list says "no ingredients are
-- recorded", which is true, and it is better than a label nobody can correct.
-- ---------------------------------------------------------------------------
create or replace function merchant.inventory_item_subtree(
  p_merchant_id uuid,
  p_item_id uuid,
  p_max_depth integer default 12
) returns table(inventory_item_id uuid, depth integer)
language sql
stable
security invoker
set search_path = pg_catalog, merchant
as $$
  with recursive walk(item_id, depth, path) as (
    select p_item_id, 0, array[p_item_id]
    union all
    select c.inventory_item_id, w.depth + 1, w.path || c.inventory_item_id
      from walk w
      join merchant.inventory_recipe r
        on r.merchant_id = p_merchant_id
       and r.target_item_id = w.item_id
       and r.active
      join merchant.inventory_recipe_component c
        on c.merchant_id = r.merchant_id and c.recipe_id = r.id
     where w.depth < p_max_depth
       and not (c.inventory_item_id = any (w.path))
  )
  select item_id, depth from walk
$$;

create or replace function merchant.inventory_item_allergen_labels(
  p_merchant_id uuid,
  p_item_id uuid
) returns table(code text, label text)
language sql
stable
security invoker
set search_path = pg_catalog, merchant
as $$
  select distinct a.code, a.label
    from merchant.inventory_item_subtree(p_merchant_id, p_item_id) s
    join merchant.inventory_item_allergen ia
      on ia.merchant_id = p_merchant_id and ia.inventory_item_id = s.inventory_item_id
    join merchant.inventory_allergen a
      on a.merchant_id = p_merchant_id
     and a.id = ia.inventory_allergen_id
     and a.active
   order by 1
$$;

create or replace function merchant.product_allergen_labels(
  p_merchant_id uuid,
  p_product_id uuid,
  p_variant_id uuid default null
) returns table(code text, label text)
language sql
stable
security invoker
set search_path = pg_catalog, merchant
as $$
  -- A recipe or bundle mapping: every component, exploded. The recipe must still be
  -- ACTIVE. A retired version is no longer what the product consumes, and its
  -- ingredients' labels must stop being claimed the moment it is retired.
  select distinct a.code, a.label
    from merchant.inventory_catalog_mapping m
    join merchant.inventory_recipe r
      on r.merchant_id = m.merchant_id and r.id = m.recipe_id and r.active
    join merchant.inventory_recipe_component c
      on c.merchant_id = m.merchant_id and c.recipe_id = m.recipe_id
    cross join lateral merchant.inventory_item_subtree(p_merchant_id, c.inventory_item_id) s
    join merchant.inventory_item_allergen ia
      on ia.merchant_id = p_merchant_id and ia.inventory_item_id = s.inventory_item_id
    join merchant.inventory_allergen a
      on a.merchant_id = p_merchant_id
     and a.id = ia.inventory_allergen_id
     and a.active
   where m.merchant_id = p_merchant_id
     and m.product_id = p_product_id
     and m.active
     and m.mapping_type in ('recipe','bundle')
     and (p_variant_id is null or m.variant_id is not distinct from p_variant_id)
  union
  -- A direct mapping: the item the product IS, and everything it consumes.
  select distinct a.code, a.label
    from merchant.inventory_catalog_mapping m
    cross join lateral merchant.inventory_item_subtree(p_merchant_id, m.inventory_item_id) s
    join merchant.inventory_item_allergen ia
      on ia.merchant_id = p_merchant_id and ia.inventory_item_id = s.inventory_item_id
    join merchant.inventory_allergen a
      on a.merchant_id = p_merchant_id
     and a.id = ia.inventory_allergen_id
     and a.active
   where m.merchant_id = p_merchant_id
     and m.product_id = p_product_id
     and m.active
     and m.mapping_type = 'direct'
     and m.inventory_item_id is not null
     and (p_variant_id is null or m.variant_id is not distinct from p_variant_id)
   order by 1
$$;

-- ---------------------------------------------------------------------------
-- 3c · The cost explosion
--
-- One row per item the recipe reaches, at EVERY level, with the quantity as an
-- EXACT RATIONAL: `numerator / denominator` is the amount in the item's own BASE
-- unit. The caller multiplies by the item's cost basis and rounds once, which is
-- the discipline `inventory-costing.repository.ts` already states for a plate.
--
-- WHY A RATIONAL AND NOT A NUMBER. `pos-checkout.repository.ts` resolves a sold line
-- with exactly this expression and refuses a quantity that is not exact
-- (`INVENTORY_QUANTITY_NOT_EXACT`). Dividing into a numeric here would hide that
-- refusal inside the explosion, and a cost built on a rounded quantity is a cost
-- nobody can reconcile.
--
-- THE RECURSION MULTIPLIES EACH LEVEL'S FACTOR. A sub-recipe is an item, so its own
-- recipe is walked the same way and the parent's factor is carried down. `path` and
-- the depth bound do the same two jobs the cycle guard does: a row written before
-- the guard existed cannot loop the read, and a runaway chain stops.
--
-- `has_recipe` is TRUE when the item is itself produced. Those rows are NOT leaves:
-- a plate that consumes a prep costs the prep's ingredients, never the prep twice.
--
-- MODIFIER LINES ARE EXCLUDED, and the exclusion matches the two paths that already
-- resolve a sale: `pos-checkout.repository.ts` and `inventory-costing.repository.ts`
-- both add `rc.modifier_id IS NULL` when they read the BASE recipe. A modifier is an
-- extra portion a particular sale took, and costing records it from the ledger
-- beside the base recipe rather than inside it. An explosion that counted it would
-- price every plate as though every guest added the extra.
-- ---------------------------------------------------------------------------
-- THE ARGUMENT LIST GREW, so the shorter form is DROPPED first. A `create or replace`
-- with a fourth parameter would leave the three-argument function in place, and a
-- three-argument call would then keep resolving to the OLD body.
drop function if exists merchant.explode_inventory_recipe(uuid,uuid,integer);

create or replace function merchant.explode_inventory_recipe(
  p_merchant_id uuid,
  p_recipe_id uuid,
  p_max_depth integer default 12,
  -- A RETIRED ROOT IS ALLOWED ON REQUEST. The cost history exists to explain versions
  -- that are no longer active, so it must be able to walk one. Sub-recipes stay active
  -- either way: a retired prep is not part of what a current recipe consumes.
  p_include_retired_root boolean default false
) returns table (
  inventory_item_id uuid,
  numerator numeric,
  denominator numeric,
  depth integer,
  path uuid[],
  recipe_path uuid[],
  has_recipe boolean
)
language sql
stable
security invoker
set search_path = pg_catalog, merchant
as $$
  with recursive walk(item_id, num, den, depth, path, recipe_path) as (
    select c.inventory_item_id,
           c.quantity::numeric * c.conversion_numerator * power(10::numeric, r.yield_scale),
           r.yield_quantity::numeric * c.conversion_denominator * power(10::numeric, c.quantity_scale),
           1,
           array[c.inventory_item_id],
           array[r.id]
      from merchant.inventory_recipe r
      join merchant.inventory_recipe_component c
        on c.merchant_id = r.merchant_id and c.recipe_id = r.id
     where r.merchant_id = p_merchant_id and r.id = p_recipe_id
       and (r.active or p_include_retired_root)
       and c.modifier_id is null
    union all
    select c.inventory_item_id,
           w.num * c.quantity * c.conversion_numerator * power(10::numeric, sr.yield_scale),
           w.den * sr.yield_quantity * c.conversion_denominator * power(10::numeric, c.quantity_scale),
           w.depth + 1,
           w.path || c.inventory_item_id,
           w.recipe_path || sr.id
      from walk w
      join merchant.inventory_recipe sr
        on sr.merchant_id = p_merchant_id
       and sr.target_item_id = w.item_id
       and sr.active
      join merchant.inventory_recipe_component c
        on c.merchant_id = sr.merchant_id and c.recipe_id = sr.id
     where w.depth < p_max_depth
       and c.modifier_id is null
       and not (c.inventory_item_id = any (w.path))
  )
  select w.item_id, w.num, w.den, w.depth, w.path, w.recipe_path,
         exists (
           select 1 from merchant.inventory_recipe x
            where x.merchant_id = p_merchant_id and x.target_item_id = w.item_id and x.active
         )
    from walk w
$$;

-- ---------------------------------------------------------------------------
-- 4 · The supplier invoice
--
-- A RECEIVED CFDI is not the same object as the CFDI this platform issues. The
-- fiscal module stamps the documents Umi emits; this table holds what a supplier
-- sent. The upload is idempotent on the UUID, and the partial unique index below
-- is what makes that true for a second upload of the same file.
--
-- A photo has no UUID. The index is partial for that reason, and the photo path
-- only proposes lines. Nothing reaches the ledger from an unconfirmed extraction.
-- ---------------------------------------------------------------------------
create table if not exists merchant.supplier_invoice (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  supplier_id uuid,
  public_reference text not null check (public_reference ~ '^[A-Za-z0-9._:-]{1,80}$'),
  folio text check (folio is null or length(folio) between 1 and 80),
  cfdi_uuid uuid,
  issued_on date,
  currency text not null default 'MXN' check (currency ~ '^[A-Z]{3}$'),
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  source text not null check (source in ('cfdi_xml','photo','manual')),
  status text not null default 'uploaded'
    check (status in ('uploaded','extracted','matched','committed','rejected')),
  artifact_path text check (artifact_path is null or length(artifact_path) between 1 and 400),
  -- THE PHOTO ITSELF. The plan stores the image on the fallback path (D11), and this
  -- platform runs with object storage OFF in the environments it has, so a path with
  -- nothing behind it would be a promise the system cannot keep. The bytes live here,
  -- bounded, until an extractor exists to read them.
  artifact_bytes bytea,
  artifact_content_type text
    check (artifact_content_type is null or artifact_content_type in ('image/png','image/jpeg','image/webp')),
  command_id uuid not null,
  idempotency_key uuid not null,
  command_fingerprint text not null check (command_fingerprint ~ '^[a-f0-9]{64}$'),
  captured_by uuid not null references umi.user(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  committed_at timestamptz,
  foreign key (merchant_id, supplier_id)
    references merchant.supplier(merchant_id, id) on delete restrict,
  unique (merchant_id, id),
  unique (merchant_id, public_reference),
  unique (merchant_id, command_id),
  unique (merchant_id, idempotency_key),
  check ((status = 'committed') = (committed_at is not null))
);
comment on table merchant.supplier_invoice is
  'A supplier document. The UUID makes an upload idempotent. A committed invoice names the price each receipt line actually paid.';

-- THE ARTIFACT COLUMNS ARE ADDED SEPARATELY, and this is not decoration. The table
-- above is `create table if not exists`, so a database that already has
-- `supplier_invoice` never receives a column that is only written inside that CREATE.
-- The recipe migration ran before these two columns existed on this workstation, and
-- the working database was silently missing them until a later read asked for one.
alter table merchant.supplier_invoice
  add column if not exists artifact_bytes bytea,
  add column if not exists artifact_content_type text;
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid='merchant.supplier_invoice'::regclass
       and conname='supplier_invoice_artifact_type_ck'
  ) then
    alter table merchant.supplier_invoice add constraint supplier_invoice_artifact_type_ck
      check (artifact_content_type is null
             or artifact_content_type in ('image/png','image/jpeg','image/webp'));
  end if;
end $$;

create unique index if not exists supplier_invoice_cfdi_uuid_uidx
  on merchant.supplier_invoice(merchant_id, cfdi_uuid)
  where cfdi_uuid is not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid='merchant.supplier_invoice'::regclass
       and conname='supplier_invoice_artifact_size_ck'
  ) then
    -- 12 MB of bytes, which is the binary of the contract's 20 MB base64 bound. A café
    -- photographs one invoice page; anything larger is a mistake, and a row that big
    -- would sit in every backup forever.
    alter table merchant.supplier_invoice add constraint supplier_invoice_artifact_size_ck
      check (artifact_bytes is null or octet_length(artifact_bytes) <= 12582912);
  end if;
end $$;
create index if not exists supplier_invoice_supplier_idx
  on merchant.supplier_invoice(merchant_id, supplier_id, issued_on desc);

create table if not exists merchant.supplier_invoice_line (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  supplier_invoice_id uuid not null,
  line_number integer not null check (line_number between 1 and 1000),
  raw_description text not null check (length(raw_description) between 1 and 300),
  supplier_sku text check (supplier_sku is null or length(supplier_sku) between 1 and 80),
  quantity bigint not null check (quantity between 1 and 9007199254740991),
  quantity_scale smallint not null check (quantity_scale between 0 and 6),
  unit text not null check (unit in (
    'unit','gram','kilogram','milliliter','liter','portion','package','box'
  )),
  unit_cost_minor bigint not null check (unit_cost_minor >= 0),
  line_total_minor bigint not null check (line_total_minor >= 0),
  matched_inventory_item_id uuid,
  match_method text not null default 'unmatched'
    check (match_method in ('supplier_sku','remembered','history','fuzzy','manual','unmatched')),
  match_confidence integer not null default 0 check (match_confidence between 0 and 100),
  conflict_note text check (conflict_note is null or length(conflict_note) <= 240),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id, supplier_invoice_id)
    references merchant.supplier_invoice(merchant_id, id) on delete restrict,
  foreign key (merchant_id, matched_inventory_item_id)
    references merchant.inventory_item(merchant_id, id) on delete restrict,
  unique (merchant_id, id),
  unique (supplier_invoice_id, line_number),
  check ((match_method = 'unmatched') = (matched_inventory_item_id is null))
);
comment on table merchant.supplier_invoice_line is
  'One line of a supplier document, with the match state. An unmatched line blocks the commit.';

-- A receipt line names the document that produced its cost. The receipt is
-- append-only, so the value is written when the line is written, never patched in.
alter table merchant.purchase_order_receipt_line
  add column if not exists invoice_line_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid='merchant.purchase_order_receipt_line'::regclass
       and conname='purchase_order_receipt_line_invoice_fk'
  ) then
    alter table merchant.purchase_order_receipt_line
      add constraint purchase_order_receipt_line_invoice_fk
      foreign key (merchant_id, invoice_line_id)
      references merchant.supplier_invoice_line(merchant_id, id) on delete restrict;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Lots, expiry and recall
--
-- A lot is a first-class row. Production and receiving may name one, and the
-- ledger then names the lot on the entry it writes. A recall query joins the
-- ledger to the sale columns it already carries, so the sales that consumed a lot
-- are reachable from the lot alone.
-- ---------------------------------------------------------------------------
create table if not exists merchant.stock_lot (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  inventory_location_id uuid not null,
  inventory_item_id uuid not null,
  public_reference text not null check (public_reference ~ '^[A-Za-z0-9._:-]{1,80}$'),
  origin text not null check (origin in ('production','receipt','opening_balance','transfer')),
  recipe_id uuid,
  supplier_invoice_line_id uuid,
  produced_at timestamptz,
  received_at timestamptz,
  expires_on date,
  shelf_life_days integer check (shelf_life_days is null or shelf_life_days between 0 and 3650),
  command_id uuid not null,
  idempotency_key uuid not null,
  command_fingerprint text not null check (command_fingerprint ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references umi.user(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id, location_id, inventory_location_id)
    references merchant.inventory_location(merchant_id, location_id, id) on delete restrict,
  foreign key (merchant_id, inventory_item_id)
    references merchant.inventory_item(merchant_id, id) on delete restrict,
  foreign key (merchant_id, recipe_id)
    references merchant.inventory_recipe(merchant_id, id) on delete restrict,
  foreign key (merchant_id, supplier_invoice_line_id)
    references merchant.supplier_invoice_line(merchant_id, id) on delete restrict,
  unique (merchant_id, id),
  unique (merchant_id, inventory_item_id, public_reference),
  unique (merchant_id, command_id),
  unique (merchant_id, idempotency_key),
  check (produced_at is not null or received_at is not null),
  check (expires_on is null or expires_on >= coalesce(produced_at, received_at)::date)
);
comment on table merchant.stock_lot is
  'A produced or received batch of one item, with its expiry and its source document. Immutable: a lot that moved stock is not rewritten.';

create index if not exists stock_lot_item_expiry_idx
  on merchant.stock_lot(merchant_id, location_id, inventory_item_id, expires_on);
create index if not exists stock_lot_expiring_idx
  on merchant.stock_lot(merchant_id, location_id, expires_on)
  where expires_on is not null;

alter table merchant.stock_ledger_entry
  add column if not exists lot_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid='merchant.stock_ledger_entry'::regclass
       and conname='stock_ledger_entry_lot_fk'
  ) then
    alter table merchant.stock_ledger_entry
      add constraint stock_ledger_entry_lot_fk
      foreign key (merchant_id, lot_id)
      references merchant.stock_lot(merchant_id, id) on delete restrict;
  end if;
end $$;
create index if not exists stock_ledger_lot_idx
  on merchant.stock_ledger_entry(merchant_id, lot_id)
  where lot_id is not null;
comment on column merchant.stock_ledger_entry.lot_id is
  'The lot this movement belongs to, when the writer named one. Null for every row written before lots existed.';

-- ---------------------------------------------------------------------------
-- 6 · Four new ledger types, and one new argument
--
-- The entry-type check was declared inline in 36 and replaced by 69, so its name
-- is the auto-generated `stock_ledger_entry_entry_type_check`. It is replaced
-- again here, and the new set holds 24 values.
--
-- THE FUNCTION GAINS AN ARGUMENT, so this file must DROP the 21-argument form
-- before it creates the 22-argument one. The new argument is last and it has a
-- default, so every existing caller keeps working. The grant is restated below,
-- because a drop takes the old grant with it.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname='merchant' and cl.relname='stock_ledger_entry'
       and c.conname='stock_ledger_entry_entry_type_check'
       and pg_get_constraintdef(c.oid) not like '%production_produced%'
  ) then
    alter table merchant.stock_ledger_entry
      drop constraint stock_ledger_entry_entry_type_check;
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
        'purchase_ordered','purchase_received','purchase_order_cancelled',
        'production_consumed','production_produced','production_yield_loss',
        'invoice_variance_adjustment'
      ));
  end if;
end $$;

drop function if exists merchant.append_stock_ledger(
  uuid,uuid,uuid,uuid,text,bigint,uuid,uuid,text,text,uuid,uuid,uuid,integer,date,text,
  uuid,uuid,uuid,uuid,jsonb
);

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
  p_public_data jsonb default '{}'::jsonb,
  p_lot_id uuid default null
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

  -- A lot must belong to the same merchant, item and stock location. Without this
  -- check a caller could attach another item's lot to this movement, and a recall
  -- would then name the wrong sales.
  if p_lot_id is not null and not exists (
    select 1 from merchant.stock_lot l
     where l.merchant_id=p_merchant_id and l.id=p_lot_id
       and l.inventory_item_id=p_inventory_item_id
       and l.inventory_location_id=p_inventory_location_id
  ) then
    raise exception 'INVENTORY_LOT_SCOPE';
  end if;

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
    when 'purchase_ordered' then v_in_transit := p_quantity;
    when 'purchase_received' then
      v_on_hand := p_quantity; v_in_transit := -p_quantity;
    when 'purchase_order_cancelled' then v_in_transit := -p_quantity;
    -- Production. The inputs leave stock, the batch's DECLARED output is credited, and
    -- the shortfall between that and what the cook reported is written off as a yield
    -- loss. The two rows are a pair: production credits the batch as the recipe
    -- declares it, then names the part that never arrived. The net is exactly what
    -- came out, and the variance report can decompose the difference (D4 and D7).
    --
    -- The ORDER matters and the repository keeps it: the credit lands first. A
    -- write-off before the credit would drive a fresh prep's balance below zero, and
    -- the ledger would refuse a perfectly ordinary shortfall.
    when 'production_consumed' then v_on_hand := -p_quantity;
    when 'production_produced' then v_on_hand := p_quantity;
    when 'production_yield_loss' then
      v_on_hand := -p_quantity; v_waste := p_quantity;
    -- The invoice named a different quantity from the receipt. The difference is
    -- a stock correction with its own name, so the variance report can show it.
    when 'invoice_variance_adjustment' then
      if coalesce((p_public_data->>'direction'),'')='increase' then v_on_hand:=p_quantity;
      elsif coalesce((p_public_data->>'direction'),'')='decrease' then v_on_hand:=-p_quantity;
      else raise exception 'INVOICE_VARIANCE_DIRECTION_REQUIRED'; end if;
    else raise exception 'INVENTORY_ENTRY_TYPE_INVALID';
  end case;

  if v_balance.reserved+v_reserved < 0 or v_balance.damaged+v_damaged < 0
     or v_balance.quarantine+v_quarantine < 0
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
    public_data,lot_id
  ) values (
    p_merchant_id,p_location_id,p_inventory_location_id,p_inventory_item_id,
    v_balance.ledger_sequence+1,p_entry_type,p_quantity,v_item.quantity_scale,v_item.base_unit,
    v_on_hand,v_reserved,v_committed,v_damaged,v_quarantine,v_waste,v_in_transit,p_command_id,
    p_idempotency_key,p_fingerprint,p_source_type,p_source_id,p_sale_id,p_sale_line_id,
    p_refund_id,p_count_id,p_operator_id,p_device_id,p_credential_version,p_business_date,
    p_correlation_id,p_public_data,p_lot_id
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

revoke all on function merchant.append_stock_ledger(
  uuid,uuid,uuid,uuid,text,bigint,uuid,uuid,text,text,uuid,uuid,uuid,integer,date,text,
  uuid,uuid,uuid,uuid,jsonb,uuid
) from public,readonly;
grant execute on function merchant.append_stock_ledger(
  uuid,uuid,uuid,uuid,text,bigint,uuid,uuid,text,text,uuid,uuid,uuid,integer,date,text,
  uuid,uuid,uuid,uuid,jsonb,uuid
) to api,worker;

-- ---------------------------------------------------------------------------
-- 7 · Triggers
--
-- 60_triggers swept the catalog before these tables existed, so each mutable table
-- attaches its own touch trigger here, for the reason 65, 67 and 69 record.
-- ---------------------------------------------------------------------------
drop trigger if exists touch_updated_at on merchant.inventory_allergen;
create trigger touch_updated_at before update on merchant.inventory_allergen
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists touch_updated_at on merchant.supplier_invoice;
create trigger touch_updated_at before update on merchant.supplier_invoice
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists touch_updated_at on merchant.supplier_invoice_line;
create trigger touch_updated_at before update on merchant.supplier_invoice_line
  for each row execute function public.tg_touch_updated_at();

-- A lot is a fact. Rewriting one would make a recall answer wrong.
drop trigger if exists stock_lot_append_only on merchant.stock_lot;
create trigger stock_lot_append_only
  before update or delete on merchant.stock_lot
  for each row execute function merchant.tg_append_only();

-- ---------------------------------------------------------------------------
-- 8 · Permissions
--
-- The reads stay behind `merchant.manage`, the key the costing and purchasing
-- surfaces already use. The writes take six new keys, and each one is granted to
-- the platform roles, the merchant roles that already exist, and the template
-- revision the role templates are snapshotted from. Without the third grant a
-- cafe provisioned after this migration would hold the permission and a cafe
-- provisioned before would not, which is the defect 75 records.
--
-- APPROVAL IS SEPARATE ON PURPOSE. `inventory.recipe.approve` and
-- `inventory.invoice.approve` go to owner and admin alone, because the person who
-- authors a price is not always the person who accepts it.
-- ---------------------------------------------------------------------------
insert into umi.permission(
  key,description,product_key,group_key,status,delegable,risk_level
) values
  ('inventory.item.manage','Create and amend inventory items',
   'dashboard','inventory','active',true,'medium'),
  ('inventory.conversion.manage','Set unit conversions for inventory items',
   'dashboard','inventory','active',true,'medium'),
  ('inventory.recipe.manage','Author and retire recipes and allergen labels',
   'dashboard','inventory','active',true,'medium'),
  ('inventory.recipe.approve','Approve a recipe version that changes plate cost',
   'dashboard','inventory','active',true,'high'),
  ('inventory.invoice.capture','Upload and match a supplier invoice',
   'dashboard','inventory','active',true,'medium'),
  ('inventory.invoice.approve','Commit a supplier invoice and its cost effects',
   'dashboard','inventory','active',true,'high'),
  -- The kitchen produces a prep (plan §11, phase 3). It is not an authoring key: a
  -- supervisor who may not edit a recipe may still work the prep board.
  ('inventory.production.produce','Produce a prepared item from its active recipe',
   'dashboard','inventory','active',true,'medium')
on conflict(key) do update set
  description=excluded.description,
  product_key=excluded.product_key,
  group_key=excluded.group_key,
  status=excluded.status,
  delegable=excluded.delegable,
  risk_level=excluded.risk_level;

insert into umi.role_permission(role_id,permission_id)
select r.id,p.id
  from umi.role r
  join umi.permission p on p.key in (
    'inventory.item.manage','inventory.conversion.manage','inventory.recipe.manage',
    'inventory.recipe.approve','inventory.invoice.capture','inventory.invoice.approve',
    'inventory.production.produce'
  )
 where (
   r.key in ('owner','admin','manager')
   and p.key <> 'inventory.recipe.approve'
   and p.key <> 'inventory.invoice.approve'
 ) or (
   r.key in ('owner','admin')
   and p.key in ('inventory.recipe.approve','inventory.invoice.approve')
 ) or (
   r.key in ('owner','admin','manager','supervisor')
   and p.key = 'inventory.production.produce'
 ) or r.key = 'super_admin'
on conflict do nothing;

insert into merchant.role_permission(merchant_id,role_id,permission_id)
select mr.merchant_id,mr.id,p.id
  from merchant.role mr
  join umi.permission p on p.key in (
    'inventory.item.manage','inventory.conversion.manage','inventory.recipe.manage',
    'inventory.recipe.approve','inventory.invoice.capture','inventory.invoice.approve',
    'inventory.production.produce'
  )
 where mr.status='active' and (
   (
     mr.key in ('owner','admin','manager')
     and p.key not in ('inventory.recipe.approve','inventory.invoice.approve')
   ) or (
     mr.key in ('owner','admin')
     and p.key in ('inventory.recipe.approve','inventory.invoice.approve')
   ) or (
     mr.key in ('owner','admin','manager','supervisor')
     and p.key = 'inventory.production.produce'
   )
 )
on conflict do nothing;

insert into umi.role_template_revision_permission(template_id,version,permission_id)
select rt.id,rtr.version,p.id
  from umi.role_template rt
  join umi.role_template_revision rtr
    on rtr.template_id=rt.id and rtr.version=rt.current_version
  join umi.permission p on p.key in (
    'inventory.item.manage','inventory.conversion.manage','inventory.recipe.manage',
    'inventory.recipe.approve','inventory.invoice.capture','inventory.invoice.approve',
    'inventory.production.produce'
  )
 where rt.status='active' and (
   (
     rt.key in ('owner','admin','manager')
     and p.key not in ('inventory.recipe.approve','inventory.invoice.approve')
   ) or (
     rt.key in ('owner','admin')
     and p.key in ('inventory.recipe.approve','inventory.invoice.approve')
   ) or (
     rt.key in ('owner','admin','manager','supervisor')
     and p.key = 'inventory.production.produce'
   )
 )
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 9 · Grants and RLS
--
-- The console authors, so `api` may create and amend an item, a conversion, a
-- recipe and an allergen. A recipe VERSION is immutable: the component table gets
-- no update or delete. A lot is a fact and gets insert only. The ledger and the
-- balance stay read-only to the application roles, exactly as before.
-- ---------------------------------------------------------------------------
grant select,insert,update on
  merchant.inventory_item,
  merchant.inventory_unit_conversion,
  merchant.inventory_recipe,
  merchant.inventory_allergen,
  merchant.supplier_invoice,
  merchant.supplier_invoice_line
  to api,worker;
grant select,insert on merchant.inventory_recipe_component to api,worker;
revoke update,delete on merchant.inventory_recipe_component from api,worker;
grant select,insert,delete on merchant.inventory_item_allergen to api,worker;
grant select,insert on merchant.stock_lot to api,worker;
revoke update,delete on merchant.stock_lot from api,worker;

-- The allergen walk is a read, so both application roles and the diagnostic role
-- may run it. It is `security invoker`, so the forced RLS policies still apply and
-- the explicit merchant argument is a second guard rather than the only one.
revoke all on function merchant.inventory_item_subtree(uuid,uuid,integer)
  from public;
revoke all on function merchant.inventory_item_allergen_labels(uuid,uuid)
  from public;
revoke all on function merchant.product_allergen_labels(uuid,uuid,uuid)
  from public;
revoke all on function merchant.explode_inventory_recipe(uuid,uuid,integer,boolean)
  from public;
grant execute on function merchant.inventory_item_subtree(uuid,uuid,integer)
  to api,worker,readonly;
grant execute on function merchant.inventory_item_allergen_labels(uuid,uuid)
  to api,worker,readonly;
grant execute on function merchant.product_allergen_labels(uuid,uuid,uuid)
  to api,worker,readonly;
grant execute on function merchant.explode_inventory_recipe(uuid,uuid,integer,boolean)
  to api,worker,readonly;

grant select on
  merchant.inventory_item,
  merchant.inventory_unit_conversion,
  merchant.inventory_recipe,
  merchant.inventory_recipe_component,
  merchant.inventory_allergen,
  merchant.inventory_item_allergen,
  merchant.supplier_invoice,
  merchant.supplier_invoice_line,
  merchant.stock_lot
  to readonly;

do $$
declare t text;
begin
  foreach t in array array[
    'inventory_allergen','inventory_item_allergen','supplier_invoice',
    'supplier_invoice_line','stock_lot'
  ] loop
    execute format('alter table merchant.%I enable row level security',t);
    execute format('alter table merchant.%I force row level security',t);
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

insert into runtime.schema_migration(version,status)
values('build-v3-76','applied') on conflict(version) do nothing;

commit;
