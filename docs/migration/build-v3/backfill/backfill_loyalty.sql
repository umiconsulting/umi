-- ============================================================================
-- build-v3 backfill · DOMAIN: Loyalty remainder   [ADVERSARIALLY REVIEWED · APPROVED]
-- Source DB: umi_backfill_v3 (loyalty.*)  →  target: merchant.* / runtime.*
-- Every SELECT side + every FK/CHECK/UNIQUE verified read-only against the live DB.
-- Do NOT run INSERTs until the coordinated cutover. FK/insert order is load-bearing.
--
-- VERDICTS (source → decision):
--   accounts            DROP  redundant-duplicate (440/440 have a loyalty_card; 0 orphans;
--                             program 1:1 w/ merchant; enrollment = the card itself)
--   programs            MAP   → merchant.loyalty_program  (1 program/merchant verified → no PK clash)
--   balances            DROP  derived-cache (balance = SUM(stored_value_ledger.delta))
--   reward_configs      MAP   → merchant.loyalty_reward
--   reward_redemptions  MAP   → merchant.loyalty_redemption
--   birthday_rewards    EMPTY (0 rows) → would be merchant.loyalty_redemption reason='birthday'
--   gift_cards          MAP   → merchant.loyalty_gift_card
--   gift_card_ledger    MAP   → merchant.loyalty_gift_card_ledger
--   passes              MAP   → merchant.loyalty_wallet_pass
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
--   [C3] gift_card_ledger.reason now carries exactly. The target admits the source
--        vocabulary plus the runtime writers (`load` and `redeem`).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. programs → merchant.loyalty_program   (PK = merchant_id; 1 program per merchant)
--    DROP: name (=merchant.name), self_registration (uniform true, no home),
--    pass_style (wallet template, externally managed by patch-classes scripts),
--    birthday_reward_name (disabled), branding jsonb (logo/colors/hours already on
--    merchant.merchant + open_hours), status (all 'active').
--    stamps_per_reward: DERIVED from the program's active reward_config.
-- ----------------------------------------------------------------------------
insert into merchant.loyalty_program
  (merchant_id, card_prefix, topup_enabled, stamps_per_reward, multi_seal_enabled,
   birthday_reward_enabled, birthday_reward_name, self_registration, pass_style,
   primary_color, secondary_color, logo_url, strip_image_url,
   promo_message, promo_starts_at, promo_ends_at, promo_days, lifecycle_copy,
   created_at, updated_at)
select
  p.tenant_id,
  p.card_prefix,
  p.topup_enabled,
  (select rc.visits_required
     from loyalty.reward_configs rc
    where rc.program_id = p.id and rc.is_active
    order by rc.created_at
    limit 1)                                    as stamps_per_reward,
  -- Carry the flag from the branding jsonb.
  -- A cafe that had the flag ON must not arrive with it OFF.
  -- That cafe loses the catch-up path for its migrated cards.
  coalesce((p.branding ->> 'multi_seal_enabled')::boolean, false) as multi_seal_enabled,
  p.birthday_reward_enabled,
  p.birthday_reward_name,
  coalesce(p.self_registration, false)          as self_registration,
  p.pass_style,
  -- flat presentation fields lifted out of the source branding jsonb into typed columns.
  -- business_hours (hours track) and lifecycle_copy (deferred) are deliberately NOT carried.
  p.branding->>'primary_color'                  as primary_color,
  p.branding->>'secondary_color'                as secondary_color,
  p.branding->>'logo_url'                       as logo_url,
  p.branding->>'strip_image_url'                as strip_image_url,
  p.branding->>'promo_message'                  as promo_message,
  (p.branding->>'promo_starts_at')::timestamptz as promo_starts_at,
  (p.branding->>'promo_ends_at')::timestamptz   as promo_ends_at,
  p.branding->>'promo_days'                     as promo_days,
  p.branding->'lifecycle_copy'                  as lifecycle_copy,   -- nested copy templates (jsonb)
  p.created_at,
  p.updated_at
from loyalty.programs p;

-- ----------------------------------------------------------------------------
-- 2. reward_configs → merchant.loyalty_reward   (PRESERVE id; redemptions FK to it)
--    type: all are visit/stamp rewards → 'stamps_free_item'.
--    value <- reward_cost_cents (centavos). merchant <- program.tenant_id.
--    DROP: reward_description (no column; name-dupe/empty).
-- ----------------------------------------------------------------------------
insert into merchant.loyalty_reward
  (id, merchant_id, name, description, type, stamps_required, spend_required, value,
   active, created_at, updated_at)
select
  rc.id,
  p.tenant_id                                  as merchant_id,
  rc.reward_name                               as name,
  rc.reward_description                         as description,
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
-- 3. reward_redemptions → merchant.loyalty_redemption
--    reason: source has none; all are stamp redemptions → 'stamps'.
--    staff_id: merchant.staff is empty → NULL (source staff_member_id cannot resolve).
--    value: granted centavos from the reward_config. note: source empty → drop.
-- ----------------------------------------------------------------------------
insert into merchant.loyalty_redemption
  (id, merchant_id, card_id, reward_id, reason, value, staff_id, occurred_at, created_at)
select
  r.id,
  r.tenant_id                                  as merchant_id,
  r.loyalty_card_id                            as card_id,
  r.reward_config_id                           as reward_id,
  'stamps'                                     as reason,
  rc.reward_cost_cents::bigint                 as value,
  null::uuid                                   as staff_id,
  r.redeemed_at                                as occurred_at,
  r.redeemed_at                                as created_at
from loyalty.reward_redemptions r
join loyalty.reward_configs rc on rc.id = r.reward_config_id;   -- reward_config_id NOT NULL, 23/23 resolve

-- birthday_rewards → merchant.loyalty_birthday_grant (per-card birthday entitlement).
--   loyalty_card_id → card_id, tenant_id → merchant_id, year/issued_at/expires_at/redeemed_at carried.
--   status defensively mapped onto ('active','redeemed','expired'). ISSUANCE (the cron that
--   reads the birthday) is NOT ported — it stays in legacy umi-cash; this only carries grants.
insert into merchant.loyalty_birthday_grant
  (id, merchant_id, card_id, year, status, issued_at, expires_at, redeemed_at, created_at)
select
  b.id,
  b.tenant_id                                  as merchant_id,
  b.loyalty_card_id                            as card_id,
  b.year,
  case b.status when 'redeemed' then 'redeemed' when 'active' then 'active' else 'expired' end as status,
  b.issued_at,
  b.expires_at,
  b.redeemed_at,
  b.created_at
from loyalty.birthday_rewards b;

-- ----------------------------------------------------------------------------
-- 4. gift_cards → merchant.loyalty_gift_card   (PRESERVE id; ledger FKs to it)
--    The clear code is bearer value. Carry only its digest and display-safe suffix.
--    amount_cents is face value. Current value remains SUM(ledger.delta).
-- ----------------------------------------------------------------------------
insert into merchant.loyalty_gift_card
  (id, merchant_id, code_hash, masked_code, amount_cents,
   created_by_staff_id, sender_name, message,
   recipient_email, recipient_phone, recipient_name,
   redeemed_at, redeemed_card_id, expires_at, issued_at, created_at)
select
  g.id,
  g.tenant_id                                  as merchant_id,
  extensions.digest(g.code, 'sha256')          as code_hash,
  '••••-' || right(g.code, 4)                  as masked_code,
  g.amount_cents,
  g.created_by_staff_member_id,
  g.sender_name,
  g.message,
  g.recipient_email,
  g.recipient_phone,
  g.recipient_name,
  g.redeemed_at,
  g.redeemed_loyalty_card_id,
  g.expires_at,
  g.created_at                                 as issued_at,
  g.created_at
from loyalty.gift_cards g;

-- ----------------------------------------------------------------------------
-- 5. gift_card_ledger → merchant.loyalty_gift_card_ledger
--    Preserve each audit field. The target CHECK admits the source and Build v3 writers.
--    DROP: metadata {source_amount_centavos == delta, redundant}.
-- ----------------------------------------------------------------------------
insert into merchant.loyalty_gift_card_ledger
  (id, merchant_id, gift_card_id, delta, reason,
   source_type, source_id, idempotency_key, occurred_at, created_at)
select
  gl.id,
  gl.tenant_id                                 as merchant_id,
  gl.gift_card_id,
  gl.delta::bigint,
  gl.reason,
  gl.source_type,
  gl.source_id,
  gl.idempotency_key,
  gl.created_at                                as occurred_at,
  gl.created_at
from loyalty.gift_card_ledger gl;

-- ----------------------------------------------------------------------------
-- 6. passes → merchant.loyalty_wallet_pass   (PRESERVE id; pass_devices FK to it)
--    platform <- provider (apple/google). external_object_id: apple=serial_number,
--    google=provider_object_id (verified: no nulls either side).
--    status [C2]: active→active, disabled/archived→removed.
--    CARRY: auth_token → web_service_token, VERBATIM.
--      [C4] This column was previously dropped as "regenerated". That was wrong, and it
--      would have silently bricked every installed Apple pass. The token is signed INTO
--      the .pkpass and replayed by Apple as `Authorization: ApplePass <token>`; the web
--      service matches it exactly. A pass already on a customer's phone is immutable, so
--      a new token matches nothing and every callback returns 401 — for all 350 of them,
--      forever. Nothing would fail at cutover: the passes simply stop updating.
--    DROP: serial_number (folded into external_object_id), metadata (all '{}').
--    Verified: no dup (card_id, platform); 417/417 card_ids resolve;
--      350/350 apple rows carry an auth_token and 350 distinct serials.
-- ----------------------------------------------------------------------------
insert into merchant.loyalty_wallet_pass
  (id, card_id, platform, external_object_id, web_service_token, status, created_at, updated_at)
select
  p.id,
  p.loyalty_card_id                            as card_id,
  p.provider                                   as platform,
  case when p.provider = 'apple'
       then nullif(p.serial_number, '')
       else nullif(p.provider_object_id, '') end as external_object_id,
  nullif(p.auth_token, '')                     as web_service_token,
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
--    All 6 source journeys map (no NULL / no data loss). UNIQUE(merchant_id,card_id,
--    reminder_type): [C1] DISTINCT ON keeps the LATEST send (sent_at DESC) so the
--    guard reflects the most recent nudge. 170 raw → 147 rows.
--    DROP: body (message content = merchant.message), metadata {source_lifecycle_event_id}.
-- ----------------------------------------------------------------------------
insert into runtime.reminder_sent
  (merchant_id, card_id, reminder_type, sent_at, created_at)
select distinct on (l.tenant_id, l.card_id, rt.reminder_type)
  l.tenant_id                                  as merchant_id,
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
-- select 'loyalty_program',        count(*) from merchant.loyalty_program;          -- expect 5
-- select 'loyalty_reward',         count(*) from merchant.loyalty_reward;           -- expect 17
-- select 'loyalty_redemption',     count(*) from merchant.loyalty_redemption;       -- expect 23
-- select 'loyalty_gift_card',      count(*) from merchant.loyalty_gift_card;        -- expect 1
-- select 'loyalty_gift_card_ledger',count(*) from merchant.loyalty_gift_card_ledger;-- expect 1
-- select 'loyalty_wallet_pass',    count(*) from merchant.loyalty_wallet_pass;      -- expect 417 (350 apple + 67 google)
-- select 'pass_device',            count(*) from runtime.pass_device;             -- expect 398
-- select 'reminder_sent',          count(*) from runtime.reminder_sent;           -- expect 147 (170 raw, winback/streak collapse)
-- Money: gift-card ledger must equal source.
-- select sum(delta) from merchant.loyalty_gift_card_ledger;                         -- expect 10000
-- Sanity: DROPPED caches/dupes NOT reintroduced (accounts, balances, wallet_transactions, otp).
