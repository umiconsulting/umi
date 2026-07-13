-- ============================================================================
-- build-v3 backfill · DOMAIN: Loyalty remainder   [ADVERSARIALLY REVIEWED · APPROVED]
-- Source DB: umi_backfill_v3 (loyalty.*)  →  target: tenant.* / runtime.*
-- Every SELECT side + every FK/CHECK/UNIQUE verified read-only against the live DB.
-- Do NOT run INSERTs until the coordinated cutover. FK/insert order is load-bearing.
--
-- VERDICTS (source → decision):
--   accounts            DROP  redundant-duplicate (440/440 have a loyalty_card; 0 orphans;
--                             program 1:1 w/ business; enrollment = the card itself)
--   programs            MAP   → tenant.loyalty_program  (1 program/tenant verified → no PK clash)
--   balances            DROP  derived-cache (balance = SUM(stored_value_ledger.delta))
--   reward_configs      MAP   → tenant.loyalty_reward
--   reward_redemptions  MAP   → tenant.loyalty_redemption
--   birthday_rewards    EMPTY (0 rows) → would be tenant.loyalty_redemption reason='birthday'
--   gift_cards          MAP   → tenant.loyalty_gift_card
--   gift_card_ledger    MAP   → tenant.loyalty_gift_card_ledger
--   passes              MAP   → tenant.loyalty_wallet_pass
--   pass_devices        MAP   → runtime.pass_device
--   wallet_transactions DROP  redundant-duplicate of points_ledger. VERIFIED per-card:
--                             SUM(wallet_tx)==SUM(points_ledger) for 5/6 cards (1 off by 101,
--                             a pre-existing source discrepancy — NOT new money). Balance is
--                             authoritative in loyalty_stored_value_ledger (already backfilled);
--                             carrying wallet_transactions would double-count.
--   lifecycle_sends     MAP   → runtime.reminder_sent   (dedup guard)
--   otp_verifications   DROP  customer OTP, disabled-feature (customers do not authenticate)
--   automation_rules    EMPTY disabled-feature, 0 rows, no honest home
--
-- REVIEW CORRECTIONS vs draft:
--   [C1] reminder_sent DISTINCT ON now keeps the LATEST send (sent_at DESC), not the earliest —
--        a "was it sent / how recently" guard must not understate recency post-cutover.
--   [C2] passes.status mapped defensively (disabled/archived → 'removed'); data is 100% 'active'
--        today, but the raw copy would violate the target CHECK if that ever changes.
--   [C3] gift_card_ledger.reason else-branch mapped defensively onto the target CHECK
--        (load→issue, expire→adjustment); only 'migration_initial_load' exists today.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. programs → tenant.loyalty_program   (PK = business_id; 1 program per tenant)
--    DROP: name (=business.name), self_registration (uniform true, no home),
--    pass_style (wallet template, externally managed by patch-classes scripts),
--    birthday_reward_name (disabled), branding jsonb (logo/colors/hours already on
--    tenant.business + open_hours), status (all 'active').
--    stamps_per_reward: DERIVED from the program's active reward_config.
-- ----------------------------------------------------------------------------
insert into tenant.loyalty_program
  (business_id, card_prefix, topup_enabled, stamps_per_reward,
   birthday_reward_enabled, created_at, updated_at)
select
  p.tenant_id,
  p.card_prefix,
  p.topup_enabled,
  (select rc.visits_required
     from loyalty.reward_configs rc
    where rc.program_id = p.id and rc.is_active
    order by rc.created_at
    limit 1)                                   as stamps_per_reward,
  p.birthday_reward_enabled,
  p.created_at,
  p.updated_at
from loyalty.programs p;

-- ----------------------------------------------------------------------------
-- 2. reward_configs → tenant.loyalty_reward   (PRESERVE id; redemptions FK to it)
--    type: all are visit/stamp rewards → 'stamps_free_item'.
--    value <- reward_cost_cents (centavos). business <- program.tenant_id.
--    DROP: reward_description (no column; name-dupe/empty).
-- ----------------------------------------------------------------------------
insert into tenant.loyalty_reward
  (id, business_id, name, type, stamps_required, spend_required, value,
   active, created_at, updated_at)
select
  rc.id,
  p.tenant_id                                  as business_id,
  rc.reward_name                               as name,
  'stamps_free_item'                           as type,
  rc.visits_required                           as stamps_required,
  null::bigint                                 as spend_required,
  rc.reward_cost_cents::bigint                 as value,
  rc.is_active                                 as active,
  rc.created_at,
  rc.created_at                                as updated_at
from loyalty.reward_configs rc
join loyalty.programs p on p.id = rc.program_id;

-- ----------------------------------------------------------------------------
-- 3. reward_redemptions → tenant.loyalty_redemption
--    reason: source has none; all are stamp redemptions → 'stamps'.
--    staff_id: tenant.staff is empty → NULL (source staff_member_id cannot resolve).
--    value: granted centavos from the reward_config. note: source empty → drop.
-- ----------------------------------------------------------------------------
insert into tenant.loyalty_redemption
  (id, business_id, card_id, reward_id, reason, value, staff_id, occurred_at, created_at)
select
  r.id,
  r.tenant_id                                  as business_id,
  r.loyalty_card_id                            as card_id,
  r.reward_config_id                           as reward_id,
  'stamps'                                     as reason,
  rc.reward_cost_cents::bigint                 as value,
  null::uuid                                   as staff_id,
  r.redeemed_at                                as occurred_at,
  r.redeemed_at                                as created_at
from loyalty.reward_redemptions r
join loyalty.reward_configs rc on rc.id = r.reward_config_id;   -- reward_config_id NOT NULL, 23/23 resolve

-- ----------------------------------------------------------------------------
-- 4. gift_cards → tenant.loyalty_gift_card   (PRESERVE id; ledger FKs to it)
--    status: derived (redeemed_at null → 'active', else 'redeemed').
--    DROP: amount_cents/balance_cents (money → ledger; balance = SUM(delta)),
--    sender_name/message/recipient_* (1-row personalization, no build-v3 column),
--    expires_at/redeemed_loyalty_card_id (no column, all null).
-- ----------------------------------------------------------------------------
insert into tenant.loyalty_gift_card
  (id, business_id, code, status, issued_at, created_at)
select
  g.id,
  g.tenant_id                                  as business_id,
  g.code,
  case when g.redeemed_at is not null then 'redeemed' else 'active' end as status,
  g.created_at                                 as issued_at,
  g.created_at
from loyalty.gift_cards g;

-- ----------------------------------------------------------------------------
-- 5. gift_card_ledger → tenant.loyalty_gift_card_ledger
--    reason CHECK: source (migration_initial_load,load,redeem,adjustment,expire)
--    → target (issue,redeem,adjustment). [C3] defensive full mapping.
--    DROP: source_type/source_id/idempotency_key (no columns),
--    metadata {source_amount_centavos == delta, redundant}.
-- ----------------------------------------------------------------------------
insert into tenant.loyalty_gift_card_ledger
  (id, business_id, gift_card_id, delta, reason, occurred_at, created_at)
select
  gl.id,
  gl.tenant_id                                 as business_id,
  gl.gift_card_id,
  gl.delta::bigint,
  case gl.reason
    when 'migration_initial_load' then 'issue'
    when 'load'                   then 'issue'
    when 'redeem'                 then 'redeem'
    when 'expire'                 then 'adjustment'
    else 'adjustment'
  end                                          as reason,
  gl.created_at                                as occurred_at,
  gl.created_at
from loyalty.gift_card_ledger gl;

-- ----------------------------------------------------------------------------
-- 6. passes → tenant.loyalty_wallet_pass   (PRESERVE id; pass_devices FK to it)
--    platform <- provider (apple/google). external_object_id: apple=serial_number,
--    google=provider_object_id (verified: no nulls either side).
--    status [C2]: active→active, disabled/archived→removed.
--    DROP: auth_token (Apple web-service secret, regenerated), serial_number
--    (folded into external_object_id), metadata (all '{}').
--    Verified: no dup (card_id, platform); 417/417 card_ids resolve.
-- ----------------------------------------------------------------------------
insert into tenant.loyalty_wallet_pass
  (id, card_id, platform, external_object_id, status, created_at, updated_at)
select
  p.id,
  p.loyalty_card_id                            as card_id,
  p.provider                                   as platform,
  case when p.provider = 'apple'
       then nullif(p.serial_number, '')
       else nullif(p.provider_object_id, '') end as external_object_id,
  case when p.status = 'active' then 'active' else 'removed' end as status,
  p.created_at,
  p.updated_at
from loyalty.passes p;

-- ----------------------------------------------------------------------------
-- 7. pass_devices → runtime.pass_device
--    device_identifier <- device_token; push_token <- push_token.
--    Verified: 398/398 pass_id resolve; no dup (pass_id, device_token).
-- ----------------------------------------------------------------------------
insert into runtime.pass_device
  (id, wallet_pass_id, device_identifier, push_token, registered_at, created_at)
select
  d.id,
  d.pass_id                                    as wallet_pass_id,
  d.device_token                               as device_identifier,
  d.push_token,
  d.created_at                                 as registered_at,
  d.created_at
from loyalty.pass_devices d;

-- ----------------------------------------------------------------------------
-- 8. lifecycle_sends → runtime.reminder_sent   (dedup guard)
--    journey → reminder_type:
--       welcome_no_visit        → welcome_no_visit   (1:1, no collision)
--       winback_14/30/60        → winback_inactive   (collapses per card)
--       streak_3w/6w            → streak_recognition (collapses per card)
--    All 6 source journeys map (no NULL / no data loss). UNIQUE(business_id,card_id,
--    reminder_type): [C1] DISTINCT ON keeps the LATEST send (sent_at DESC) so the
--    guard reflects the most recent nudge. 170 raw → 147 rows.
--    DROP: body (message content = tenant.message), metadata {source_lifecycle_event_id}.
-- ----------------------------------------------------------------------------
insert into runtime.reminder_sent
  (business_id, card_id, reminder_type, sent_at, created_at)
select distinct on (l.tenant_id, l.card_id, rt.reminder_type)
  l.tenant_id                                  as business_id,
  l.card_id,
  rt.reminder_type,
  l.sent_at,
  l.sent_at                                    as created_at
from loyalty.lifecycle_sends l
cross join lateral (
  select case
    when l.journey = 'welcome_no_visit' then 'welcome_no_visit'
    when l.journey like 'winback%'      then 'winback_inactive'
    when l.journey like 'streak%'       then 'streak_recognition'
  end as reminder_type
) rt
where rt.reminder_type is not null
order by l.tenant_id, l.card_id, rt.reminder_type, l.sent_at desc;

-- ============================================================================
-- RECONCILE (run AFTER backfill)
-- ============================================================================
-- select 'loyalty_program',        count(*) from tenant.loyalty_program;          -- expect 5
-- select 'loyalty_reward',         count(*) from tenant.loyalty_reward;           -- expect 17
-- select 'loyalty_redemption',     count(*) from tenant.loyalty_redemption;       -- expect 23
-- select 'loyalty_gift_card',      count(*) from tenant.loyalty_gift_card;        -- expect 1
-- select 'loyalty_gift_card_ledger',count(*) from tenant.loyalty_gift_card_ledger;-- expect 1
-- select 'loyalty_wallet_pass',    count(*) from tenant.loyalty_wallet_pass;      -- expect 417 (350 apple + 67 google)
-- select 'pass_device',            count(*) from runtime.pass_device;             -- expect 398
-- select 'reminder_sent',          count(*) from runtime.reminder_sent;           -- expect 147 (170 raw, winback/streak collapse)
-- Money: gift-card ledger must equal source.
-- select sum(delta) from tenant.loyalty_gift_card_ledger;                         -- expect 10000
-- Sanity: DROPPED caches/dupes NOT reintroduced (accounts, balances, wallet_transactions, otp).
