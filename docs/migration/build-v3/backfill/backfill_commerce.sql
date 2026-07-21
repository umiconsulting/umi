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
--      branding.{strip_image_url,pass_style,promo_message},  -- secondary_color now folded to a typed column
--      config.{payment_methods,order_cutoff_time,slack_channel_id,
--      slack_channel_name,accepts_whatsapp_orders,bypass_phones,special_notice},
--      config.hours/open_times (redundant with business_hours below).
--    FLAGGED to OTHER domains:
--      config.whatsapp -> tenant.integration(provider='twilio')  [FOLDED BELOW, 3b]
--      config.address  -> tenant.branch.address
-- ----------------------------------------------------------------------------
update tenant.business b set
  city        = coalesce(nullif(btrim(o.city), ''), b.city),
  logo_url        = coalesce(o.branding->>'logo_url', b.logo_url),
  brand_color     = coalesce(o.branding->>'primary_color', b.brand_color),
  secondary_color = coalesce(o.branding->>'secondary_color', b.secondary_color),
  bot_voice   = coalesce(o.config->'voice'->>'assistant_name', b.bot_voice),
  bot_tone    = coalesce(o.config->'voice'->>'tone_preset', b.bot_tone),
  updated_at  = now()
from ops.businesses o
where b.id = o.tenant_id;

-- 3b. ops.businesses.config->>'whatsapp'  ->  tenant.integration(provider='twilio')
--     The INBOUND-ROUTING number: "a WhatsApp message arrived at N — which café owns
--     it?" Without this the bot resolves nothing after cutover and fails CLOSED, so it
--     looks like silence rather than an error. Only Kalala has a number today.
--     ⚠️ The old ops.channel_accounts / ops.channels pair is EMPTY in prod — the live
--     number lives in the business config blob, which is why this fold is the only
--     source. provider='twilio' (NOT 'whatsapp' — that value violates the CHECK).
--     Stored as BARE E.164: Twilio delivers 'whatsapp:+52…' and the backend strips the
--     prefix before matching, so normalizing here keeps one canonical form and lets
--     unique(provider, external_account_id) actually bite.
insert into tenant.integration (business_id, provider, external_account_id, status)
select o.tenant_id,
       'twilio',
       regexp_replace(btrim(o.config->>'whatsapp'), '^whatsapp:', ''),
       'connected'
from ops.businesses o
where nullif(btrim(coalesce(o.config->>'whatsapp', '')), '') is not null;

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
--    notes -> notes and pickup_person -> pickup_person: now CARRIED, not dropped.
--      Both are named columns (see 20_tenant.sql) because both ends exist today —
--      the WhatsApp checkout writes them and the frozen iPad KDS ticket renders
--      them. The 7 populated notes are per-line drink specs plus one customer
--      preference; they carry as-is rather than being re-routed, because these
--      orders are known TEST data (the tenant never used ordering) and inventing a
--      line-attribution for a test string would be fabrication, not fidelity.
--    DROPPED: metadata (source_*/kds_* = telemetry), details.items (denormalized
--      cache of order_items), channel (dup of source), details.customer_note
--      (the blob copy — the typed column is carried instead), kitchen_status
--      (derived from latest order_event), station_id/name (KDS routing scratch),
--      cancellation_reason* (contaminated free text; canceled fact is in status).
--    total_cents: NOT carried as a stored column. build-v3 DERIVES the order total
--      (Σ live lines, tenant.order_total). PROVEN lossless on this snapshot:
--      total_cents = Σ(unit_price*qty WHERE NOT is_cancelled) for all 51 orders
--      (590300 = 590300); the stored total already excluded the 3 voided lines.
--      cancel_reason left NULL (source free-text is contaminated — see above).
-- ----------------------------------------------------------------------------
insert into tenant.customer_order
  (id, business_id, branch_id, customer_id, conversation_id, source,
   fulfillment_type, status, notes, pickup_person, external_ref,
   placed_at, created_at, updated_at)
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
       nullif(btrim(o.notes), ''),                 -- 7 populated; '' would be a fake note
       nullif(btrim(o.pickup_person), ''),         -- 0 populated in this snapshot
       o.source_transaction_id,
       o.placed_at,
       o.created_at,
       o.updated_at
from ops.orders o;

-- ----------------------------------------------------------------------------
-- 5. ops.order_items  ->  tenant.order_item   (MAP)
--    68 non-null product_id all resolve. variant_name (63) folded into notes.
--    name = order-time snapshot.
--    is_cancelled (3 lines / 2 orders) -> voided_at (the void tombstone). The
--      source carries only the boolean, so updated_at stands in for the unknown
--      exact void time — what matters is non-null, so the line leaves the
--      derived total (this is what makes tenant.order_total reconcile to 590300).
--    void_reason left NULL — the source has no reason (and these are known tests),
--      so we do not fabricate one; same rule as customer_order.cancel_reason.
--    DROPPED: display_order (cosmetic), kitchen_status (derived), metadata.
--    station_id DEFERRED (source has no per-line station; column not built — see
--      20_tenant.sql / ORDER_MODEL.md §5).
-- ----------------------------------------------------------------------------
insert into tenant.order_item
  (id, order_id, product_id, name, quantity, unit_price, voided_at, notes, created_at)
select oi.id,
       oi.order_id,
       oi.product_id,
       oi.name,
       oi.quantity,
       oi.unit_price_cents::bigint,
       case when oi.is_cancelled then oi.updated_at end,
       nullif(btrim(concat_ws(' · ',
              nullif(btrim(oi.variant_name), ''),
              nullif(btrim(oi.notes), ''))), ''),
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
--    sequence is NOT carried: it is `generated always as identity`, so the database
--      assigns it. The source kitchen_sequence is not reproduced on purpose — its
--      values only have to ORDER events, and carrying them would leave the identity
--      counter behind the highest carried value, so the first live event after
--      cutover would collide. The ORDER BY below makes the generated sequence agree
--      with source time order; kitchen_sequence itself is a cursor, not a fact.
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
where e.event_kind = 'status_changed'
-- Deterministic: 63 occurred_at values are tied in the source, so time alone does
-- not order them. kitchen_sequence breaks the tie, id breaks the remaining one.
order by e.occurred_at, e.kitchen_sequence nulls last, e.id;

commit;

-- ============================================================================
-- RECONCILE
-- The authoritative, automated commerce checks live in reconcile_v3.sql (run by
-- 00_run_backfill.sh). It asserts counts (customer_order=51, order_item=73,
-- order_event=78), the two money invariants (all-lines Σ=612600, derived live
-- total Σ=590300), and — stronger than any aggregate — PER-ORDER (derived vs
-- source total) and PER-ITEM (is_cancelled <-> voided_at, by id) equality, so a
-- compensating +X/-X cannot hide. Do not re-add weaker aggregate-only hints here.
-- ============================================================================
