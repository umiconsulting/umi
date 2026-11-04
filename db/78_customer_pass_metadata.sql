\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- build-v3 · 78_customer_pass_metadata — the two facts build-v3 dropped, put
-- back, because the register cannot flip without them.
--
-- WHY THIS EXISTS. On 2026-10-06 the register's port turned out to be blocked:
-- four of the six screens the cafés use answer a different shape than the frozen
-- umi-cash client reads. Two of the missing fields are missing for the same
-- reason — build-v3 did not carry the `metadata` columns they lived in:
--
--   core.people.metadata.device / .os    the customer's phone, from the
--                                        User-Agent at self-registration.
--                                        Present on 1019 of 1048 customers.
--
--   loyalty.cards.metadata.pending_tier1 how many of the rewards this card holds
--                                        were earned under the OLD single
--                                        threshold, and must therefore be handed
--                                        over as the LOWER tier. Present on 7
--                                        cards — few, and load-bearing.
--
-- Leaving them behind was defensible while the register read the old schemas. It
-- stops being defensible the moment it flips: `pending_tier1` is not decoration,
-- it decides which drink the barista hands over. Without it a card holding a
-- banked reward reads as holding the top tier instead of the lower one.
--
-- THE COLUMNS ARE NOT THE FEATURE. `pending_tier1` is a COUNTER, moved by three
-- writers in umi-cash: the reward-config save tags every card that already holds
-- a banked reward, a scan that cashes one of those out decrements it, and a
-- redemption revert increments it. Adding the column without porting those three
-- writes leaves the counter permanently out of step with the rewards it counts.
-- That work is tracked in REGISTER_FLIP_PARITY.md, not here.
--
-- WHY TYPED COLUMNS AND NOT A metadata JSONB. Two named facts with two named
-- readers, and nothing waiting behind them: the only other keys the old blobs
-- held are `source_systems` and `synthetic`, which the register never reads, and
-- `lifecycle_message` / `lifecycle_message_updated_at`, which already have typed
-- homes on merchant.loyalty_card. A JSONB here would recreate the shape that let
-- this go unnoticed.
--
-- WHY THE CARRY LIVES IN THIS FILE. It is guarded on the legacy schema existing.
-- The pristine chain (00_run.sh) creates no legacy schemas, so it applies the DDL
-- and carries nothing; a backfilled database gets both in one step and can never
-- end up with the columns and no data. Re-running is harmless in either case.
-- ============================================================================

alter table merchant.customer
  add column if not exists device text,
  add column if not exists os     text;

comment on column merchant.customer.device is
  'The phone the customer self-registered from, read off the User-Agent. Display only: '
  'nothing branches on it. Null for a customer a barista enrolled by hand.';
comment on column merchant.customer.os is
  'The operating system behind merchant.customer.device. Display only.';

alter table merchant.loyalty_card
  add column if not exists pending_tier1 integer not null default 0;

alter table merchant.loyalty_card
  drop constraint if exists loyalty_card_pending_tier1_non_negative;
alter table merchant.loyalty_card
  add constraint loyalty_card_pending_tier1_non_negative check (pending_tier1 >= 0);

comment on column merchant.loyalty_card.pending_tier1 is
  'How many of this card''s banked rewards were earned under the pre-ladder single '
  'threshold and must be handed over as the LOWER tier. A counter, not a flag: the '
  'reward-config save that turns a ladder on seeds it with pending_rewards, redeeming '
  'a base reward decrements it, and reverting that redemption increments it.';

-- ----------------------------------------------------------------------------
-- Carry. Both joins are on the primary key, verified before this file was
-- written: the backfill preserved ids 1:1 in both directions (1048/1048 people →
-- customer, 1053/1053 cards), so no card_number or phone matching is needed and
-- none is attempted.
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'loyalty') then
    update merchant.customer c
       set device = p.metadata ->> 'device',
           os     = p.metadata ->> 'os'
      from core.people p
     where p.id = c.id
       and coalesce(p.metadata, '{}'::jsonb) ?| array['device', 'os'];

    update merchant.loyalty_card c
       set pending_tier1 = greatest(0, coalesce((l.metadata ->> 'pending_tier1')::int, 0))
      from loyalty.cards l
     where l.id = c.id
       and coalesce(l.metadata, '{}'::jsonb) ? 'pending_tier1';
  end if;
end;
$$;

insert into runtime.schema_migration(version, status)
values ('build-v3-78', 'applied')
on conflict (version) do nothing;

commit;
