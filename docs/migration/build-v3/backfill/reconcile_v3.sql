\pset footer off
\echo '========== A. COUNTS: source vs target =========='
select 'merchant'  t, (select count(*) from core.tenants)          src, (select count(*) from merchant.merchant) dst
union all select 'customer', (select count(*) from core.people),            (select count(*) from merchant.customer)
union all select 'contact',  (select count(*) from core.contact_methods),   (select count(*) from merchant.contact)
union all select 'loyalty_card', (select count(*) from loyalty.cards),      (select count(*) from merchant.loyalty_card)
union all select 'stored_value_ledger', (select count(*) from loyalty.points_ledger), (select count(*) from merchant.loyalty_stored_value_ledger)
union all select 'subscription', (select count(*) from grow.subscriptions), (select count(*) from umi.subscription)
union all select 'conversation', (select count(*) from comms.conversations),(select count(*) from merchant.conversation)
union all select 'message',   (select count(*) from comms.messages),        (select count(*) from merchant.message)
union all select 'audit_log(merchant)', (select count(*) from observability.audit_log), (select count(*) from merchant.audit_log)
union all select 'customer_order', (select count(*) from ops.orders),        (select count(*) from merchant.customer_order)
union all select 'order_item', (select count(*) from ops.order_items),       (select count(*) from merchant.order_item)
union all select 'order_event', (select count(*) from ops.order_events where event_kind='status_changed'), (select count(*) from merchant.order_event)
-- Asserted because it was silently ZERO: the backfill comment named
-- runtime.product_embedding as the destination but no statement ever wrote there,
-- so all 136 vectors were dropped while message_embedding carried its 1342 fine.
-- A count nobody asserts is a count nobody notices going to 0.
union all select 'product_embedding', (select count(*) from ops.products where name_embedding is not null), (select count(*) from runtime.product_embedding)
union all select 'message_embedding', (select count(*) from comms.messages where embedding is not null), (select count(*) from runtime.message_embedding)
order by 1;

\echo ''
\echo '========== B. MONEY INVARIANTS (centavos) =========='
select 'stored_value Σdelta' k,
       (select coalesce(sum(delta),0) from loyalty.points_ledger) src,
       (select coalesce(sum(delta),0) from merchant.loyalty_stored_value_ledger) dst
union all
select 'gift_card balance',
       (select coalesce(sum(balance_cents),0) from loyalty.gift_cards),
       (select coalesce(sum(delta),0) from merchant.loyalty_gift_card_ledger)
union all
-- every line carried, voided included (all-lines sum): proves no line was dropped
select 'order lines Σ(all)',
       (select coalesce(sum(unit_price_cents*quantity),0) from ops.order_items),
       (select coalesce(sum(unit_price*quantity),0) from merchant.order_item)
union all
-- DERIVED order total (Σ live lines) reproduces the stored source total: proves
-- dropping the stored column + carrying is_cancelled->cancelled_at is lossless
select 'order total Σ(derived live)',
       (select coalesce(sum(total_cents),0) from ops.orders),
       (select coalesce(sum(total),0) from merchant.order_total);

\echo ''
\echo '-- order voids carried as tombstones (expect src is_cancelled = dst voided_at = 3):'
select (select count(*) from ops.order_items where is_cancelled) src,
       (select count(*) from merchant.order_item where voided_at is not null) dst;
\echo '-- PER-ORDER: derived total = source total for EVERY order (aggregate can hide'
\echo '   a compensating +X/-X; this cannot) — expect 0:'
select count(*) as orders_total_mismatch
from ops.orders o
join merchant.order_total t on t.order_id = o.id
where o.total_cents is distinct from t.total;
\echo '-- PER-ITEM: is_cancelled <-> voided_at agree for EVERY line (by id, NULL-safe) — expect 0:'
select count(*) as items_void_flag_mismatch
from ops.order_items s
join merchant.order_item d on d.id = s.id
where s.is_cancelled is distinct from (d.voided_at is not null);
\echo '-- no NULL status leaked (expect 0, 0):'
select (select count(*) from merchant.customer_order where status is null) customer_order_null_status,
       (select count(*) from merchant.order_event where status is null)    order_event_null_status;

\echo ''
\echo '========== C. GAP CARRIES (new) =========='
\echo '-- password_algorithm carried onto umi.user (expect scrypt=6, legacy=2, null=1):'
select coalesce(password_algorithm,'(null)') scheme, count(*) from umi.user group by 1 order by 1;
\echo '-- location lat/lng carried (expect 4 with coords):'
select count(*) filter (where lat is not null and lng is not null) as locations_with_coords, count(*) total from merchant.location;

\echo ''
\echo '========== D. ENTITLEMENT: effective vs product_instances =========='
\echo '-- NEW model effective access (canceled subs intentionally empty = honor billing status):'
select b.name, s.status,
       coalesce(string_agg(ee.feature_key, ',' order by ee.feature_key),'(none)') as effective_access
from merchant.merchant b
join umi.subscription s on s.merchant_id=b.id
left join umi.effective_entitlement ee on ee.merchant_id=b.id
group by b.name, s.status order by b.name;
\echo '-- SOURCE provisioned modules (product_instances):'
select t.name, string_agg(pi.product_key,',' order by pi.product_key) as provisioned
from core.tenants t join core.product_instances pi on pi.tenant_id=t.id
group by t.name order by t.name;
\echo '-- packaging seed (expect feature=6, plan=3, plan_feature=7 — pos + pos.offline_cash'
\echo '   are catalog-only, in no plan; feature went 5 -> 6 with pos.offline_cash):'
select (select count(*) from umi.feature) feature, (select count(*) from umi.plan) plan, (select count(*) from umi.plan_feature) plan_feature;
\echo '-- pos is catalog-only (expect pos_plan_feature=0; a nonzero means pos got bundled into a plan):'
select count(*) as pos_plan_feature
  from umi.plan_feature pf join umi.feature f on f.id = pf.feature_id
 where f.key = 'pos';

\echo ''
\echo '========== E. ORPHAN FK SWEEP (expect all 0) =========='
select 'staff.merchant' k, count(*) n from merchant.staff s where not exists (select 1 from merchant.merchant b where b.id=s.merchant_id)
union all select 'staff.role', count(*) from merchant.staff s where not exists (select 1 from umi.role r where r.id=s.role_id)
union all select 'subscription.merchant', count(*) from umi.subscription s where not exists (select 1 from merchant.merchant b where b.id=s.merchant_id)
union all select 'location.merchant', count(*) from merchant.location x where not exists (select 1 from merchant.merchant b where b.id=x.merchant_id)
union all select 'contact.channel', count(*) from merchant.contact c where not exists (select 1 from umi.channel_type ct where ct.id=c.channel_id)
union all select 'conversation.channel', count(*) from merchant.conversation cv where not exists (select 1 from umi.channel_type ct where ct.id=cv.channel_id)
union all select 'plan_feature.feature', count(*) from umi.plan_feature pf where not exists (select 1 from umi.feature f where f.id=pf.feature_id)
order by 1;

\echo ''
\echo '========== F. POS CARRIES (2026-07-28) =========='
\echo '-- business_date is DERIVED on every order, never NULL (expect 0):'
select count(*) as orders_missing_business_date
  from merchant.customer_order where business_date is null;
\echo '-- and it agrees with the derivation from placed_at + timezone + business_day_start'
\echo '   for EVERY order (an aggregate would hide a per-row drift) — expect 0:'
select count(*) as business_date_mismatch
  from merchant.customer_order o
  join merchant.merchant b on b.id = o.merchant_id
 where o.business_date
       is distinct from (((o.placed_at at time zone b.timezone) - b.business_day_start::interval)::date);
\echo '-- nothing was FABRICATED: the source has no discounts, comps or structured'
\echo '   modifiers, so these tables must be empty (expect 0, 0):'
select (select count(*) from merchant.order_discount)      as order_discount,
       (select count(*) from merchant.order_item_modifier) as order_item_modifier;
\echo '-- the derived order total is still GROSS while no discounts exist, so section B'
\echo '   compares like with like (expect Σgross = Σtotal):'
select coalesce(sum(gross),0) as gross, coalesce(sum(total),0) as total from merchant.order_total;
\echo '-- session revocation is ONE fact: no active session carries a revoked_at, and no'
\echo '   inactive session lacks one (session_revocation_ck; expect 0):'
select count(*) as session_revocation_inconsistent
  from runtime.session where is_active <> (revoked_at is null);
\echo '-- every location reference belongs to the SAME merchant (the composite FK now'
\echo '   enforces this; a nonzero here means the source carried cross-merchant rows):'
select count(*) as cross_merchant_location_refs
  from merchant.customer_order o
  join merchant.location br on br.id = o.location_id
 where o.location_id is not null and br.merchant_id <> o.merchant_id;
\echo '-- HOURS · every café that had hours in ops.business_hours still has some. The'
\echo '   fold used to group by merchant alone, so a café with hours at two locations'
\echo '   produced duplicate day keys and jsonb_object_agg silently kept ONE of them.'
\echo '   That loss was invisible in a count, so count the CAFES instead (expect 0):'
select count(*) as merchants_that_lost_their_hours
  from (select distinct tenant_id from ops.business_hours) src
  join merchant.merchant b on b.id = src.tenant_id
 where b.open_hours = '{}'::jsonb;

\echo '-- HOURS · a location override MEANS something: it is never equal to the hours it'
\echo '   overrides, because an equal one should be NULL and inherit (expect 0):'
select count(*) as pointless_location_overrides
  from merchant.location br
  join merchant.merchant b on b.id = br.merchant_id
 where br.open_hours is not null and br.open_hours = b.open_hours;

\echo '-- HOURS · every distinct (location, schedule) pair in the source is still'
\echo '   distinguishable after the fold — this is the count the old version lost'
\echo '   (source distinct schedules = target distinct schedules):'
with src as (
  select bh.tenant_id, bh.location_id,
         jsonb_object_agg(bh.day_of_week,
           case when bh.is_closed or bh.opens_at is null or bh.closes_at is null
                     or bh.opens_at = bh.closes_at then 'closed'
                else to_char(bh.opens_at,'HH24:MI')||'-'||to_char(bh.closes_at,'HH24:MI') end) as sched
    from ops.business_hours bh
   where bh.day_of_week between 0 and 6
   group by bh.tenant_id, bh.location_id
)
select (select count(distinct (tenant_id, sched)) from src)                as source_schedules,
       (select count(*) from (
          select merchant_id, open_hours from merchant.location where open_hours is not null
          union
          select id, open_hours from merchant.merchant where open_hours <> '{}'::jsonb) t) as target_schedules;

\echo '-- HOURS · the ordering window came out of the config blob (Kalala: pause flag,'
\echo '   45-minute cutoff, notice, 3 bypass numbers). Every phone is canonical +digits,'
\echo '   or the bot compares it against an inbound number and never matches (expect 0):'
select count(*) as non_canonical_bypass_phones
  from merchant.merchant b, unnest(b.whatsapp_bypass_phone) as p
 where p !~ '^\+?[0-9]+$';

\echo ''
\echo '========== G. HANDLE · the published URL key (2026-08-01) =========='
\echo '-- Every merchant handle equals its source slug, character for character. A pass'
\echo '   already on a phone has /api/{handle}/passes/apple SIGNED into it and cannot be'
\echo '   re-pointed, so a drift here is a café whose wallet passes stop updating and'
\echo '   never report an error (expect 0):'
select count(*) as handle_slug_mismatch
  from core.tenants t
  join merchant.merchant b on b.id = t.id
 where b.handle is distinct from t.slug;
\echo '-- Nobody with an ISSUED pass lost their handle. This is the subset that can still'
\echo '   be hurt — 350 Apple passes across 4 cafes today (expect 0):'
select count(*) as merchants_with_passes_missing_handle
  from (select distinct tenant_id from loyalty.passes) p
  join merchant.merchant b on b.id = p.tenant_id
 where b.handle is null;
\echo '-- Handles are unique. The column carries a UNIQUE constraint, so this can only'
\echo '   fail if the SOURCE had duplicates the insert would have rejected (expect 0):'
select count(*) as duplicate_handles
  from (select handle from merchant.merchant
         where handle is not null group by handle having count(*) > 1) d;
\echo '-- Every Apple pass kept the token SIGNED INTO IT. Apple replays this value on every'
\echo '   callback and the server must match it; a regenerated token matches nothing on a'
\echo '   pass already installed, and the failure is 350 silent 401s, not an error anyone'
\echo '   sees. Handle and token are the TWO halves of the same guarantee — the handle gets'
\echo '   the call to us, the token lets it in (expect src = dst = 350, missing = 0):'
select (select count(auth_token) from loyalty.passes where provider = 'apple')  as src_apple_tokens,
       (select count(web_service_token) from merchant.loyalty_wallet_pass
         where platform = 'apple')                                             as dst_apple_tokens,
       (select count(*) from merchant.loyalty_wallet_pass
         where platform = 'apple' and web_service_token is null)               as apple_missing_token;
\echo '-- The carried token is the SAME STRING, not merely present (expect 0):'
select count(*) as apple_token_mismatch
  from loyalty.passes p
  join merchant.loyalty_wallet_pass w on w.id = p.id
 where p.provider = 'apple'
   and w.web_service_token is distinct from nullif(p.auth_token, '');
\echo '-- LOCATION aliases and descriptor survived the fold. They are empty in prod today,'
\echo '   which is exactly why an unasserted carry would go unnoticed if it broke'
\echo '   (expect source = target on both):'
select (select count(*) from core.locations where coalesce(array_length(aliases,1),0) > 0) as src_with_aliases,
       (select count(*) from merchant.location where coalesce(array_length(aliases,1),0) > 0) as dst_with_aliases,
       (select count(*) from core.locations where descriptor is not null) as src_with_descriptor,
       (select count(*) from merchant.location where descriptor is not null) as dst_with_descriptor;
\echo '-- search_text is DERIVED on every location, never null — the bot fuzzy-matches'
\echo '   against it, and a null would silently score every location 0 (expect 0):'
select count(*) as locations_missing_search_text
  from merchant.location where search_text is null;

\echo '-- PAYMENT METHODS reached the counter. The source held ONE list per cafe in a'
\echo '   config blob; every location of that cafe must now carry it, IN ORDER. Kalala'
\echo '   is the case that matters — 2 locations, 1 list (expect 0 mismatches):'
select count(*) as locations_missing_payment_methods
  from core.locations l
  join ops.businesses b   on b.tenant_id = l.tenant_id
  join merchant.location d on d.id = l.id
 where b.config ? 'payment_methods'
   and d.payment_methods is distinct from (
     select coalesce(array_agg(value::text order by ordinality), '{}')::text[]
       from jsonb_array_elements_text(b.config->'payment_methods')
              with ordinality as e(value, ordinality));
\echo '-- and no location INVENTED methods the source never gave it (expect 0):'
select count(*) as locations_with_fabricated_payment_methods
  from merchant.location d
  left join ops.businesses b on b.tenant_id = d.merchant_id
 where cardinality(d.payment_methods) > 0
   and coalesce(b.config ? 'payment_methods', false) is not true;

\echo ''
\echo '-- POS permissions have a holder. Expect 31, BY ROLE — a bare total hides which'
\echo '   role gained a key. owner 8 + admin 8 + staff 5 (no device.enroll, no approval,'
\echo '   no audit) + super_admin 8 (every key, one row each — the seed IS the review)'
\echo '   + developer 2 (catalog.read, audit.read — read-only across every cafe).'
\echo '   This said "expect 21" until 2026-08-02: the platform roles arrived with the'
\echo '   wildcard removal and the count was never updated, so the line asserted a'
\echo '   number the seed could no longer produce.'
select r.key as role, count(*) as pos_grants
  from umi.role_permission rp
  join umi.permission p on p.id = rp.permission_id
  join umi.role r       on r.id = rp.role_id
 where p.key in ('catalog.read','cart.write','checkout.commit','offline.replay',
                 'offline.cash.checkout','device.enroll','offline.recovery.review','audit.read')
 group by r.key order by r.key;

\echo ''
\echo '========== H. STAMPS · magnitude, per card (2026-08-14) =========='
\echo '-- A row is not a magnitude. `loyalty.visit_events` carries `metadata.seals`'
\echo '   1..50 on the bulk catch-up path, and the previous backfill dropped it, then'
\echo '   INVENTED synthetic rows so that count(*) came out right. That balanced the'
\echo '   total and destroyed the history: one card received 15 visits at a single'
\echo '   microsecond. The carry is now sum(stamps), and these checks compare it PER'
\echo '   CARD — an aggregate hides a +X and a -X that cancel.'
\echo ''
\echo '-- H1. Rows carried, not invented. Source visit_events = target rows (expect equal,'
\echo '   and NOTHING with source = migration, which no longer exists):'
select (select count(*) from loyalty.visit_events)                                as src_interactions,
       (select count(*) from merchant.loyalty_visit)                              as dst_interactions,
       (select count(*) from merchant.loyalty_visit where source = 'manual_bulk') as dst_bulk_rows;

\echo ''
\echo '-- H2. Stamps preserved PER CARD. Source stamps = sum of metadata.seals (default 1);'
\echo '   target = sum(stamps). Every row here is a customer whose card got shorter or'
\echo '   longer than it was (expect 0 rows):'
with src as (
  select loyalty_card_id as card_id,
         sum(greatest(coalesce((metadata->>'seals')::int, 1), 1)) as stamps
    from loyalty.visit_events group by 1
), dst as (
  select card_id, sum(stamps) as stamps
    from merchant.loyalty_visit group by 1
)
select coalesce(src.card_id, dst.card_id)              as card_id,
       coalesce(src.stamps, 0)                         as src_stamps,
       coalesce(dst.stamps, 0)                         as dst_stamps,
       coalesce(dst.stamps, 0) - coalesce(src.stamps, 0) as drift
  from src full outer join dst on dst.card_id = src.card_id
 where coalesce(src.stamps, 0) <> coalesce(dst.stamps, 0)
 order by abs(coalesce(dst.stamps, 0) - coalesce(src.stamps, 0)) desc
 limit 50;

\echo ''
\echo '-- H3. The same comparison as ONE number, so a green H2 cannot be read as'
\echo '   "nothing to see" when the query silently returned no rows (expect 0):'
with src as (
  select loyalty_card_id as card_id,
         sum(greatest(coalesce((metadata->>'seals')::int, 1), 1)) as stamps
    from loyalty.visit_events group by 1
), dst as (
  select card_id, sum(stamps) as stamps from merchant.loyalty_visit group by 1
)
select count(*) as cards_with_stamp_drift
  from src full outer join dst on dst.card_id = src.card_id
 where coalesce(src.stamps, 0) <> coalesce(dst.stamps, 0);

\echo ''
\echo '-- H4. The bulk-seal population, named. These are the cards the old backfill'
\echo '   would have shortened; the measurement on 2026-07 was 28 events, 115 stamps,'
\echo '   22 cards, and 18 Kalala customers losing 87 stamps between them:'
select count(*)                                          as bulk_events,
       coalesce(sum((metadata->>'seals')::int), 0)       as bulk_stamps,
       count(distinct loyalty_card_id)                   as cards_affected
  from loyalty.visit_events
 where coalesce((metadata->>'seals')::int, 1) > 1;

\echo ''
\echo '-- H5. No source row exceeded the CHECK. The carry clamps to 1..50, so a source'
\echo '   value outside that range is silently trimmed rather than aborting the cutover'
\echo '   at 04:00. If this is not 0, the clamp changed someone data (expect 0):'
select count(*) as source_rows_outside_check
  from loyalty.visit_events
 where coalesce((metadata->>'seals')::int, 1) not between 1 and 50;
