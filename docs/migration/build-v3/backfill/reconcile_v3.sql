\pset footer off
\echo '========== A. COUNTS: source vs target =========='
select 'business'  t, (select count(*) from core.tenants)          src, (select count(*) from tenant.business) dst
union all select 'customer', (select count(*) from core.people),            (select count(*) from tenant.customer)
union all select 'contact',  (select count(*) from core.contact_methods),   (select count(*) from tenant.contact)
union all select 'loyalty_card', (select count(*) from loyalty.cards),      (select count(*) from tenant.loyalty_card)
union all select 'stored_value_ledger', (select count(*) from loyalty.points_ledger), (select count(*) from tenant.loyalty_stored_value_ledger)
union all select 'subscription', (select count(*) from grow.subscriptions), (select count(*) from umi.subscription)
union all select 'conversation', (select count(*) from comms.conversations),(select count(*) from tenant.conversation)
union all select 'message',   (select count(*) from comms.messages),        (select count(*) from tenant.message)
union all select 'audit_log(tenant)', (select count(*) from observability.audit_log), (select count(*) from tenant.audit_log)
union all select 'customer_order', (select count(*) from ops.orders),        (select count(*) from tenant.customer_order)
union all select 'order_item', (select count(*) from ops.order_items),       (select count(*) from tenant.order_item)
union all select 'order_event', (select count(*) from ops.order_events where event_kind='status_changed'), (select count(*) from tenant.order_event)
order by 1;

\echo ''
\echo '========== B. MONEY INVARIANTS (centavos) =========='
select 'stored_value Σdelta' k,
       (select coalesce(sum(delta),0) from loyalty.points_ledger) src,
       (select coalesce(sum(delta),0) from tenant.loyalty_stored_value_ledger) dst
union all
select 'gift_card balance',
       (select coalesce(sum(balance_cents),0) from loyalty.gift_cards),
       (select coalesce(sum(delta),0) from tenant.loyalty_gift_card_ledger)
union all
-- every line carried, voided included (all-lines sum): proves no line was dropped
select 'order lines Σ(all)',
       (select coalesce(sum(unit_price_cents*quantity),0) from ops.order_items),
       (select coalesce(sum(unit_price*quantity),0) from tenant.order_item)
union all
-- DERIVED order total (Σ live lines) reproduces the stored source total: proves
-- dropping the stored column + carrying is_cancelled->cancelled_at is lossless
select 'order total Σ(derived live)',
       (select coalesce(sum(total_cents),0) from ops.orders),
       (select coalesce(sum(total),0) from tenant.order_total);

\echo ''
\echo '-- order voids carried as tombstones (expect src is_cancelled = dst voided_at = 3):'
select (select count(*) from ops.order_items where is_cancelled) src,
       (select count(*) from tenant.order_item where voided_at is not null) dst;
\echo '-- PER-ORDER: derived total = source total for EVERY order (aggregate can hide'
\echo '   a compensating +X/-X; this cannot) — expect 0:'
select count(*) as orders_total_mismatch
from ops.orders o
join tenant.order_total t on t.order_id = o.id
where o.total_cents is distinct from t.total;
\echo '-- PER-ITEM: is_cancelled <-> voided_at agree for EVERY line (by id, NULL-safe) — expect 0:'
select count(*) as items_void_flag_mismatch
from ops.order_items s
join tenant.order_item d on d.id = s.id
where s.is_cancelled is distinct from (d.voided_at is not null);
\echo '-- no NULL status leaked (expect 0, 0):'
select (select count(*) from tenant.customer_order where status is null) customer_order_null_status,
       (select count(*) from tenant.order_event where status is null)    order_event_null_status;

\echo ''
\echo '========== C. GAP CARRIES (new) =========='
\echo '-- password_algorithm carried onto umi.user (expect scrypt=6, legacy=2, null=1):'
select coalesce(password_algorithm,'(null)') scheme, count(*) from umi.user group by 1 order by 1;
\echo '-- branch lat/lng carried (expect 4 with coords):'
select count(*) filter (where lat is not null and lng is not null) as branches_with_coords, count(*) total from tenant.branch;

\echo ''
\echo '========== D. ENTITLEMENT: effective vs product_instances =========='
\echo '-- NEW model effective access (canceled subs intentionally empty = honor billing status):'
select b.name, s.status,
       coalesce(string_agg(ee.feature_key, ',' order by ee.feature_key),'(none)') as effective_access
from tenant.business b
join umi.subscription s on s.business_id=b.id
left join umi.effective_entitlement ee on ee.business_id=b.id
group by b.name, s.status order by b.name;
\echo '-- SOURCE provisioned modules (product_instances):'
select t.name, string_agg(pi.product_key,',' order by pi.product_key) as provisioned
from core.tenants t join core.product_instances pi on pi.tenant_id=t.id
group by t.name order by t.name;
\echo '-- packaging seed (expect feature=4, plan=3, plan_feature=7):'
select (select count(*) from umi.feature) feature, (select count(*) from umi.plan) plan, (select count(*) from umi.plan_feature) plan_feature;

\echo ''
\echo '========== E. ORPHAN FK SWEEP (expect all 0) =========='
select 'user_role.business' k, count(*) n from umi.user_role ur where ur.business_id is not null and not exists (select 1 from tenant.business b where b.id=ur.business_id)
union all select 'subscription.business', count(*) from umi.subscription s where not exists (select 1 from tenant.business b where b.id=s.business_id)
union all select 'branch.business', count(*) from tenant.branch x where not exists (select 1 from tenant.business b where b.id=x.business_id)
union all select 'contact.channel', count(*) from tenant.contact c where not exists (select 1 from umi.channel_type ct where ct.id=c.channel_id)
union all select 'conversation.channel', count(*) from tenant.conversation cv where not exists (select 1 from umi.channel_type ct where ct.id=cv.channel_id)
union all select 'plan_feature.feature', count(*) from umi.plan_feature pf where not exists (select 1 from umi.feature f where f.id=pf.feature_id)
order by 1;
