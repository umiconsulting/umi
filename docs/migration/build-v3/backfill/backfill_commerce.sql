-- ============================================================================
-- build-v3 backfill · DOMAIN: Commerce & ops   (ADVERSARIALLY REVIEWED / APPROVED)
-- Source DB: umi_backfill_v3 (PGPORT=5233).  Target schemas: tenant / umi.
-- Money is bigint centavos (source stored *_cents integers → widen 1:1).
-- tenant.business rows already exist (from core.tenants); ops.businesses +
-- business_hours facts are folded via UPDATE, not INSERT.
--
-- REVIEW CORRECTIONS vs draft:
--  (1) order_event: keep ONLY the canonical `status_changed` stream. The draft
--      also kept `order_upserted` (flattened to 'placed') and `status_change`.
--      PROVEN redundant/telemetry:
--        - order_upserted fires at the SAME timestamps as the real transitions,
--          mirroring their status → sync-ingestion DUPLICATE, not a transition.
--          (draft additionally FABRICATED 'placed' for 23 rows whose real
--           new_status was completed/cancelled/ready/preparing.)
--        - status_change is fully subsumed by status_changed at order level
--          (0 orders have status_change without status_changed); it is a legacy
--          parallel emitter of the same transitions.
--        - snapshot_reconciled = sync reconciliation (already dropped).
--      status_changed covers ALL 26 orders that have real transitions. The 24
--      ingestion-only orders keep zero order_event rows — placement is preserved
--      by customer_order.placed_at.  Kept rows: 78 (was 182).
--  (2) ops.orders.cancellation_reason: NO gap column. Downgraded to DROP. The
--      free text is contaminated operational scribble (contains slurs/garbage),
--      the "was canceled" fact is already carried by status='canceled', and it is
--      the same class as the dropped order-level `notes`. If the owner ever wants
--      cancel analytics, add a CODES-ONLY column later — never the free text.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. ops.product_categories  ->  tenant.product_category   (MAP)
--    key (slug) dropped (name is the human label); sort_order -> display_order.
-- ----------------------------------------------------------------------------
insert into tenant.product_category (id, business_id, name, display_order, created_at)
select pc.id,
       pc.tenant_id,                       -- = tenant.business.id
       pc.name,
       pc.sort_order,
       pc.created_at
from ops.product_categories pc;

-- ----------------------------------------------------------------------------
-- 2. ops.products  ->  tenant.product   (MAP)
--    price_cents -> price (bigint centavos). external_ref <- metadata.zettle_uuid.
--    DROPPED: name_embedding/embedding_model (-> runtime.product_embedding),
--    synced_at (sync cursor -> runtime.integration_sync), metadata (source_*
--    provenance = telemetry), variants (exploded below). description '' -> null.
-- ----------------------------------------------------------------------------
insert into tenant.product
  (id, business_id, category_id, name, description, price, active, external_ref,
   created_at, updated_at)
select p.id,
       p.tenant_id,
       p.category_id,
       p.name,
       nullif(btrim(p.description), ''),
       p.price_cents::bigint,
       p.is_available,
       p.metadata->>'zettle_uuid',
       p.created_at,
       p.updated_at
from ops.products p;

-- 2b. products.variants (flat [{name,price}]) -> ONE option group per product
--     + one modifier per variant. price is ABSOLUTE pesos in source; stored as a
--     delta from the product base (centavos) so base+delta = variant price.
--     Verified: 1256 variant rows across 66 products, 0 null prices, 0 empty names.
with og as (
  insert into tenant.product_option_group (id, product_id, name, min_select, max_select)
  select gen_random_uuid(), p.id, 'Opciones', 0, null
  from ops.products p
  where jsonb_typeof(p.variants) = 'array' and jsonb_array_length(p.variants) > 0
  returning id, product_id
)
insert into tenant.product_modifier (option_group_id, name, price_delta)
select og.id,
       btrim(v->>'name'),
       round((v->>'price')::numeric * 100)::bigint - p.price_cents::bigint
from og
join ops.products p on p.id = og.product_id
cross join lateral jsonb_array_elements(p.variants) v
where coalesce(btrim(v->>'name'), '') <> '';

-- ----------------------------------------------------------------------------
-- 3. ops.businesses + ops.business_hours  ->  tenant.business COLUMNS  (MAP/fold)
--    ops.businesses is REDUNDANT with core.tenants (1:1, unique tenant_id) — its
--    only NEW facts are folded as columns (owner rule: no rescue table).
--    open_hours COLUMN built from the typed ops.business_hours rows (Kalala only).
--    DROPPED (no build-v3 home, deliberately not modeled): id, business_type,
--      branding.{secondary_color,strip_image_url,pass_style,promo_message},
--      config.{payment_methods,order_cutoff_time,slack_channel_id,
--      slack_channel_name,accepts_whatsapp_orders,bypass_phones,special_notice},
--      config.hours/open_times (redundant with business_hours below).
--    FLAGGED to OTHER domains (not folded here):
--      config.whatsapp -> tenant.integration(provider='twilio').external_account_id
--      config.address  -> tenant.branch.address
-- ----------------------------------------------------------------------------
update tenant.business b set
  city        = coalesce(nullif(btrim(o.city), ''), b.city),
  logo_url    = coalesce(o.branding->>'logo_url', b.logo_url),
  brand_color = coalesce(o.branding->>'primary_color', b.brand_color),
  bot_voice   = coalesce(o.config->'voice'->>'assistant_name', b.bot_voice),
  bot_tone    = coalesce(o.config->'voice'->>'tone_preset', b.bot_tone),
  updated_at  = now()
from ops.businesses o
where b.id = o.tenant_id;

with oh as (
  select tenant_id,
         jsonb_object_agg(
           case day_of_week
             when 0 then 'sun' when 1 then 'mon' when 2 then 'tue' when 3 then 'wed'
             when 4 then 'thu' when 5 then 'fri' when 6 then 'sat' end,
           case when is_closed or opens_at is null then '[]'::jsonb
                else jsonb_build_array(jsonb_build_object(
                       'open',  to_char(opens_at,  'HH24:MI'),
                       'close', to_char(closes_at, 'HH24:MI'))) end
         ) as hours
  from ops.business_hours
  group by tenant_id
)
update tenant.business b
   set open_hours = oh.hours, updated_at = now()
from oh
where b.id = oh.tenant_id;

-- ----------------------------------------------------------------------------
-- 4. ops.orders  ->  tenant.customer_order   (MAP)
--    person_id -> customer_id (48 non-null all resolve to tenant.customer, 3 null).
--    source_transaction_id -> external_ref. status remapped to target vocab.
--    location_id all null -> branch_id null. no conversation link -> null.
--    fulfillment_type NULL: source order_type ∈ {'order',''} is NOT a
--      pickup/dine_in/delivery value.
--    DROPPED: metadata (source_*/kds_* = telemetry), details.items (denormalized
--      cache of order_items), channel (dup of source), notes / details.customer_note
--      (order-level free text, unmodeled), kitchen_status (derived from latest
--      order_event), station_id/name/pickup_person (KDS routing scratch),
--      cancellation_reason* (contaminated free text; canceled fact is in status).
-- ----------------------------------------------------------------------------
insert into tenant.customer_order
  (id, business_id, branch_id, customer_id, conversation_id, source,
   fulfillment_type, status, total, external_ref, placed_at, created_at, updated_at)
select o.id,
       o.tenant_id,
       null::uuid,
       o.person_id,
       null::uuid,
       o.source,                                   -- 'whatsapp' ∈ target CHECK
       null::text,
       case o.status
         when 'pending'   then 'placed'
         when 'completed' then 'completed'
         when 'cancelled' then 'canceled'
       end,
       o.total_cents::bigint,
       o.source_transaction_id,
       o.placed_at,
       o.created_at,
       o.updated_at
from ops.orders o;

-- ----------------------------------------------------------------------------
-- 5. ops.order_items  ->  tenant.order_item   (MAP)
--    68 non-null product_id all resolve. variant_name (63) + is_cancelled (3)
--    folded into notes (target has neither column). name = order-time snapshot.
--    DROPPED: display_order (cosmetic), kitchen_status (derived), metadata.
--    station_id null (source has no per-line station).
-- ----------------------------------------------------------------------------
insert into tenant.order_item
  (id, order_id, product_id, station_id, name, quantity, unit_price, notes, created_at)
select oi.id,
       oi.order_id,
       oi.product_id,
       null::uuid,
       oi.name,
       oi.quantity,
       oi.unit_price_cents::bigint,
       nullif(btrim(concat_ws(' · ',
              nullif(btrim(oi.variant_name), ''),
              nullif(btrim(oi.notes), ''),
              case when oi.is_cancelled then '[cancelado]' end)), ''),
       oi.created_at
from ops.order_items oi;

-- ----------------------------------------------------------------------------
-- 6. ops.order_events  ->  tenant.order_event   (MAP, filtered to REAL transitions)
--    Keep ONLY event_kind='status_changed' (the canonical, complete transition
--    stream: 78 rows, all 26 orders that have real transitions).
--    DROPPED: order_upserted (sync-ingestion duplicate — same timestamps/status
--      as the real transitions), status_change (legacy duplicate emitter, fully
--      subsumed by status_changed), snapshot_reconciled (sync reconciliation).
--    payload/metadata dropped (source_event_id / acted_by_slack_user='Kitchen
--      iPad' is NOT a staff FK → staff_id null).
--    status_changed new_status ∈ {accepted,preparing,ready,completed,cancelled}
--      (no 'new'/'in_progress'/'partial_cancelled' in this stream).
-- ----------------------------------------------------------------------------
insert into tenant.order_event (id, order_id, status, staff_id, occurred_at)
select e.id,
       e.order_id,
       case e.new_status
         when 'accepted'  then 'preparing'
         when 'preparing' then 'preparing'
         when 'ready'     then 'ready'
         when 'completed' then 'completed'
         when 'cancelled' then 'canceled'
       end,
       null::uuid,
       e.occurred_at
from ops.order_events e
where e.event_kind = 'status_changed';

commit;

-- ============================================================================
-- RECONCILE  (run after backfill)
-- ============================================================================
-- select 'product_category', count(*) from tenant.product_category            -- expect 12
-- union all select 'product', count(*) from tenant.product                    -- expect 136
-- union all select 'option_group', count(*) from tenant.product_option_group  -- expect 66
-- union all select 'modifier', count(*) from tenant.product_modifier          -- expect 1256
-- union all select 'customer_order', count(*) from tenant.customer_order       -- expect 51
-- union all select 'order_item', count(*) from tenant.order_item               -- expect 73
-- union all select 'order_event', count(*) from tenant.order_event;            -- expect 78 (status_changed only)
-- -- money preserved
-- select (select sum(total_cents) from ops.orders) src,
--        (select sum(total) from tenant.customer_order) dst;                   -- must match
-- select (select sum(unit_price_cents*quantity) from ops.order_items) src,
--        (select sum(unit_price*quantity) from tenant.order_item) dst;         -- must match
-- -- no NULL status leaked
-- select count(*) from tenant.customer_order where status is null;             -- expect 0
-- select count(*) from tenant.order_event where status is null;                -- expect 0
