-- build-v3 loyalty vertical backfill: prod (core/loyalty) -> new tenant.* names.
-- Run inside umi_backfill_v3 (prod data + build-v3 schema coexisting).
-- Superuser owner bypasses RLS, so no app.current_business needed.
begin;

-- 1. business <- core.tenants
insert into tenant.business (id, name, timezone, status, created_at, updated_at)
select t.id, t.name, coalesce(t.timezone,'America/Mexico_City'),
       case when t.status='suspended' then 'suspended' else 'active' end,
       t.created_at, coalesce(t.updated_at, t.created_at)
from core.tenants t;

-- 2. customer <- core.people  (id reused; birth_date -> birthday)
insert into tenant.customer (id, business_id, name, birthday, loyalty_status, created_at, updated_at)
select p.id, p.tenant_id, p.display_name, p.birth_date, 'active',
       p.created_at, coalesce(p.updated_at, p.created_at)
from core.people p;

-- 3. contact <- core.contact_methods  (raw truth; normalized is DERIVED, never carried)
--    normalized_value is deliberately NOT inserted: tenant.tg_contact_normalize derives
--    it from the raw value via umi.e164 (BACKFILL_METHODOLOGY L15). Carrying the source
--    column would import prod's corruption verbatim — the fatal country-code-1 branch
--    rewrote real +1 numbers into Mexican numbers belonging to nobody. Letting the
--    trigger derive repairs those rows in place, with no UPDATE pass.
insert into tenant.contact (id, business_id, customer_id, channel_id,
                            raw_phone_number, is_primary,
                            verified, verified_via, created_at)
select cm.id, cm.tenant_id, cm.person_id, ch.id,
       cm.display_value, coalesce(cm.is_primary,false),
       (cm.verified_at is not null),
       case when cm.verified_at is not null then 'whatsapp_inbound' else 'self_asserted' end,
       cm.created_at
from core.contact_methods cm
join umi.channel_type ch on ch.key = cm.kind;

-- 4. loyalty_card <- loyalty.cards  (identity only; customer via account->person)
insert into tenant.loyalty_card (id, business_id, customer_id, card_number, status, issued_at, created_at)
select c.id, c.tenant_id, a.person_id, c.card_number,
       case when c.status='blocked' then 'blocked' else 'active' end,
       coalesce(c.qr_issued_at, c.created_at), c.created_at
from loyalty.cards c
join loyalty.accounts a on a.id = c.account_id;

-- 5. stored_value_ledger (MONEY) <- loyalty.points_ledger
insert into tenant.loyalty_stored_value_ledger
       (id, business_id, card_id, delta, reason, idempotency_key, external_ref, occurred_at, created_at)
select pl.id, pl.tenant_id, pl.loyalty_card_id, pl.delta, pl.reason,
       pl.idempotency_key, pl.source_id, pl.created_at, pl.created_at
from loyalty.points_ledger pl;

-- 6a. loyalty_visit (real stamps) <- loyalty.visit_events
insert into tenant.loyalty_visit (id, business_id, card_id, staff_id, source, occurred_at, created_at)
select ve.id, ve.tenant_id, ve.loyalty_card_id, null, 'scan', ve.occurred_at, ve.occurred_at
from loyalty.visit_events ve;

-- 6b. loyalty_visit (synthetic) — fill total_visits gap per card
insert into tenant.loyalty_visit (business_id, card_id, source, occurred_at)
select c.tenant_id, c.id, 'migration', c.created_at
from loyalty.cards c
left join (select loyalty_card_id, count(*) cnt from loyalty.visit_events group by 1) v
       on v.loyalty_card_id = c.id
cross join lateral generate_series(1, greatest(c.total_visits - coalesce(v.cnt,0), 0)) g;

commit;
