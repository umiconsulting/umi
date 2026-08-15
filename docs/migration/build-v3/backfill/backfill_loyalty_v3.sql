-- build-v3 loyalty vertical backfill: prod (core/loyalty) -> new merchant.* names.
-- Run inside umi_backfill_v3 (prod data + build-v3 schema coexisting).
-- Superuser owner bypasses RLS, so no app.current_merchant needed.
begin;

-- 1. merchant <- core.tenants
--   slug -> handle, and this carry is NOT cosmetic. Every one of the 350 Apple Wallet
--   passes installed on a customer's phone has /api/{slug}/passes/apple SIGNED into it
--   and cannot be re-pointed; umi-cash serves its customer site under /{slug}/; the
--   logo files are named /logos/{slug}-*.png. A handle that does not match its source
--   slug EXACTLY is a café whose wallet passes stop updating, silently, forever.
--   reconcile_v3 asserts that equality rather than trusting this line.
insert into merchant.merchant (id, handle, name, timezone, status, created_at, updated_at)
select t.id, t.slug, t.name, coalesce(t.timezone,'America/Mexico_City'),
       case when t.status='suspended' then 'suspended' else 'active' end,
       t.created_at, coalesce(t.updated_at, t.created_at)
from core.tenants t;

-- 2. customer <- core.people  (id reused; birth_date -> birthday)
insert into merchant.customer (id, merchant_id, name, birthday, loyalty_status, created_at, updated_at)
select p.id, p.tenant_id, p.display_name, p.birth_date, 'active',
       p.created_at, coalesce(p.updated_at, p.created_at)
from core.people p;

-- 3. contact <- core.contact_methods  (raw truth; normalized is DERIVED, never carried)
--    normalized_value is deliberately NOT inserted: merchant.tg_contact_normalize derives
--    it from the raw value via umi.e164 (BACKFILL_METHODOLOGY L15). Carrying the source
--    column would import prod's corruption verbatim — the fatal country-code-1 location
--    rewrote real +1 numbers into Mexican numbers belonging to nobody. Letting the
--    trigger derive repairs those rows in place, with no UPDATE pass.
insert into merchant.contact (id, merchant_id, customer_id, channel_id,
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
insert into merchant.loyalty_card
  (id, merchant_id, customer_id, card_number, qr_token, qr_issued_at,
   lifecycle_message, lifecycle_message_at, status, issued_at, created_at, updated_at)
select c.id, c.tenant_id, a.person_id, c.card_number,
       c.qr_token,                                                    -- CARRIED: the incumbent card's scan secret
       c.qr_issued_at,
       c.metadata->>'lifecycle_message'                              as lifecycle_message,
       (c.metadata->>'lifecycle_message_updated_at')::timestamptz    as lifecycle_message_at,
       case when c.status='blocked' then 'blocked' else 'active' end as status,
       coalesce(c.qr_issued_at, c.created_at)                        as issued_at,
       c.created_at,
       c.updated_at
from loyalty.cards c
join loyalty.accounts a on a.id = c.account_id;

-- 5. stored_value_ledger (MONEY) <- loyalty.points_ledger
insert into merchant.loyalty_stored_value_ledger
       (id, merchant_id, card_id, delta, reason, idempotency_key, external_ref, occurred_at, created_at)
select pl.id, pl.tenant_id, pl.loyalty_card_id, pl.delta, pl.reason,
       pl.idempotency_key, pl.source_id, pl.created_at, pl.created_at
from loyalty.points_ledger pl;

-- 6. loyalty_visit <- loyalty.visit_events, CARRYING THE MAGNITUDE.
--
-- The source has always held the magnitude and this backfill always dropped it.
-- `metadata->>'seals'` is 1..50 on 28 of the 537 rows — the "Agregar sellos"
-- catch-up path — and carrying only the row collapsed each of those to a single
-- stamp. 537 rows carrying 624 stamps became 537 stamps, and 87 went missing.
--
-- The previous version papered over that with a §6b that INVENTED the difference:
-- `generate_series` minted one synthetic row per missing stamp, stamped
-- `source='migration'` at `card.created_at`. It balanced the total and destroyed
-- the history — one card received 15 visits at a single microsecond, and every
-- "when did she come in" read was a lie from that point on.
--
-- Now: carry 537 rows and 624 stamps. Both numbers are true, and 445/445 cards
-- reconcile on sum(stamps) rather than on an invented count.
insert into merchant.loyalty_visit
       (id, merchant_id, card_id, staff_id, source, stamps, note, occurred_at, created_at)
select ve.id,
       ve.tenant_id,
       ve.loyalty_card_id,
       null,
       -- A row carrying more than one stamp came from the bulk catch-up, by
       -- definition — that endpoint is the only writer that can mint one.
       case when coalesce((ve.metadata->>'seals')::int, 1) > 1
            then 'manual_bulk' else 'scan' end,
       -- Clamped to the CHECK. A source row outside 1..50 is corrupt, not a
       -- reason to abort the cutover at 04:00; reconcile section H reports it.
       least(greatest(coalesce((ve.metadata->>'seals')::int, 1), 1), 50),
       ve.note,
       ve.occurred_at,
       ve.occurred_at
from loyalty.visit_events ve;

commit;
