\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- build-v3 · 79_cycle_anchor — the two facts a stamp cycle needs and the event
-- log cannot carry.
--
-- WHY THIS EXISTS. build-v3 stores no counters on `merchant.loyalty_card`, so the
-- scan DERIVES the customer's progress from her lifetime stamps:
--
--   visits_this_cycle = SUM(stamps) % threshold
--   pending_rewards   = SUM(stamps) / threshold − COUNT(redemptions)
--
-- That is only true when every cycle ran 0 → 1 → … → threshold → 0 in a clean loop,
-- at a threshold that never moved. Two things break the loop, and both have
-- happened in production:
--
--   1. AN EARLY CASH-OUT. umi-cash's scan accepts REDEEM_BASE: at 7 of 9 stamps the
--      barista hands over the lower tier and the card is TORN OFF — the cycle
--      restarts at the customer's current stamp count, which is not a multiple of
--      the threshold. The formula then reads 7/9 where the till reads 0/9, and
--      `SUM / threshold − redemptions` goes NEGATIVE: it charges the customer for a
--      reward she already took.
--
--   2. A THRESHOLD THAT MOVED. El Gran Ribera's standard went 10 → 7 and then grew
--      a 9-visit upper tier. A cycle already in flight finishes under the threshold
--      it was running when it moved; the formula measures every card against today's
--      threshold, so cards that were mid-cycle at the change read a different
--      position through the API than through the till.
--
-- HOW FAR OFF, measured on production 2026-10-06: at El Gran Ribera 23 of 592 cards
-- read a different cycle position than the till, and 120 of Kalalacafe's 440. The
-- other two cafés, 0 of 21. Exactly one card in production has ever taken an early
-- cash-out (`EGR-6659949340`, note `Canje anticipado con 8/9 visitas`), so the moved
-- threshold is the common cause and the cash-out is the one that corrupts the
-- arithmetic rather than only the display.
--
-- WHY ANCHORS AND NOT A CACHE. The obvious repair is to carry umi-cash's
-- `visits_this_cycle` and `pending_rewards` columns back. That reproduces the till
-- exactly and then rots the same way the cache did: a number nobody can recompute,
-- moved by five writers, wrong after the first missed write. What is stored here is
-- the two facts the EVENT LOG cannot express, and every number a screen shows is
-- still derived from them plus the events.
--
--   cycle_anchor    the lifetime stamp count at which the CURRENT cycle began.
--                   Non-zero only where the clean modulo would lie.
--   rewards_earned  how many cycles this card has completed in its life (monotone).
--                   The events cannot count these: an earned reward wrote no row in
--                   umi-cash, only a cache increment, and `floor(total/threshold)`
--                   breaks as soon as a threshold moves or a cycle is cut short.
--
--   visits_this_cycle = (SUM(stamps) − cycle_anchor) % threshold
--   pending_rewards   = rewards_earned − COUNT(canjes that stand)
--
-- AND IT ROUND-TRIPS. The carry below derives both anchors from umi-cash's own cache,
-- so the derived numbers reproduce the till for every card on the day it is applied.
-- Checked before this file was written: 1053 of 1053 cards, 0 mismatches. The
-- database stops disagreeing with the till at the cutover, and the writers keep the
-- anchors honest afterwards.
--
-- WHY the redemption marker. An early cash-out writes a canje row — the bitácora has
-- to show the drink that left the bar — but it consumes the CYCLE, not a banked
-- reward, so it must not count against `pending_rewards`. `cycle_reset` states that
-- rather than inferring it from a note string.
-- ============================================================================

alter table merchant.loyalty_card
  add column if not exists cycle_anchor integer not null default 0,
  add column if not exists rewards_earned integer not null default 0;

alter table merchant.loyalty_card
  drop constraint if exists loyalty_card_cycle_anchor_non_negative;
alter table merchant.loyalty_card
  add constraint loyalty_card_cycle_anchor_non_negative check (cycle_anchor >= 0);
alter table merchant.loyalty_card
  drop constraint if exists loyalty_card_rewards_earned_non_negative;
alter table merchant.loyalty_card
  add constraint loyalty_card_rewards_earned_non_negative check (rewards_earned >= 0);

comment on column merchant.loyalty_card.cycle_anchor is
  'The lifetime stamp count at which the CURRENT cycle began. Non-zero only where '
  'the clean modulo would lie: an early cash-out, or a threshold that moved under a '
  'cycle already in flight. visits_this_cycle = (SUM(stamps) - cycle_anchor) % threshold.';
comment on column merchant.loyalty_card.rewards_earned is
  'How many cycles this card has completed in its life (monotone). The event log '
  'cannot count these: earning a reward wrote no row, and floor(total/threshold) '
  'breaks as soon as the threshold moves or a cycle is cut short. '
  'pending_rewards = rewards_earned - COUNT(canjes that stand).';

alter table merchant.loyalty_redemption
  add column if not exists cycle_reset boolean not null default false;
comment on column merchant.loyalty_redemption.cycle_reset is
  'An early cash-out: the lower tier was handed over before the cycle completed and '
  'the card was torn off. The row exists (the drink left the bar, and the bitácora '
  'has to show it) but it consumes the CYCLE, not a banked reward, so it is excluded '
  'from the pending_rewards count. Its counterpart is the card cycle_anchor moving '
  'to that moment.';

-- ----------------------------------------------------------------------------
-- Carry. Guarded on the legacy schema existing, the same way 78 is: the pristine
-- chain (00_run.sh) creates no legacy schemas, applies the DDL and carries nothing.
--
-- The closed form, and why it is exact:
--
--   want (total − anchor) % T = cache.visits_this_cycle   →  anchor = (total − v) % T
--   want rewards_earned − r   = cache.pending_rewards     →  rewards_earned = p + r
--
-- `total` comes from the new schema's SUM(stamps) rather than the old cache's
-- `total_visits`. They agree card for card (checked before this was written), and
-- taking it from the events keeps the database self-consistent even where a cache
-- would not have been.
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'loyalty') then
    -- THE MARKER FIRST, and the order is load-bearing. `rewards_earned` is derived as
    -- `pending_rewards + canjes that stand`, and an early-cash-out canje does NOT
    -- stand for that purpose — it consumed the cycle, not a reward. Marking them
    -- after the anchors left the one card in production that ever took an early
    -- cash-out carrying one reward too many (caught by this file's fixture).
    update merchant.loyalty_redemption r
       set cycle_reset = true
      from loyalty.reward_redemptions lr
     where lr.id = r.id and lr.note like 'Canje anticipado%';

    with threshold as (
      select t.id as merchant_id,
             greatest(
               coalesce(
                 case when up.stamps_required > std.stamps_required
                      then up.stamps_required end,
                 std.stamps_required,
                 10
               ),
               1
             ) as t
        from merchant.merchant t
        left join lateral (
          select r.stamps_required from merchant.loyalty_reward r
           where r.merchant_id = t.id and r.active and r.type = 'stamps_free_item'
             and r.kind = 'upgrade'
           order by r.created_at desc nulls last limit 1
        ) up on true
        left join lateral (
          select r.stamps_required from merchant.loyalty_reward r
           where r.merchant_id = t.id and r.active and r.type = 'stamps_free_item'
             and r.kind = 'standard'
           order by r.created_at desc nulls last limit 1
        ) std on true
    ),
    derived as (
      select c.id,
             th.t,
             coalesce(l.visits_this_cycle, 0) as cached_cycle,
             coalesce(l.pending_rewards, 0)   as cached_pending,
             coalesce((select sum(v.stamps) from merchant.loyalty_visit v
                        where v.merchant_id = c.merchant_id and v.card_id = c.id), 0)::int as total,
             (select count(*) from merchant.loyalty_redemption r
               where r.merchant_id = c.merchant_id and r.card_id = c.id
                 and r.reverted_at is null and not r.cycle_reset)::int as standing_canjes
        from merchant.loyalty_card c
        join loyalty.cards l on l.id = c.id
        join threshold th on th.merchant_id = c.merchant_id
    )
    update merchant.loyalty_card c
       set cycle_anchor   = mod(greatest(0, d.total - d.cached_cycle), d.t),
           rewards_earned = greatest(0, d.cached_pending + d.standing_canjes),
           updated_at     = now()
     from derived d
     where d.id = c.id;
  end if;
end;
$$;

insert into runtime.schema_migration(version, status)
values ('build-v3-79', 'applied')
on conflict (version) do nothing;

commit;
