create schema if not exists dashboard_compat;

create table if not exists dashboard_compat.local_user_credentials (
  user_id uuid primary key references platform.users(id) on delete cascade,
  username text not null unique,
  password_salt text not null,
  password_hash text not null,
  algorithm text not null default 'scrypt-sha256-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop view if exists dashboard_compat."ApplePushToken";
drop view if exists dashboard_compat."BirthdayReward";
drop view if exists dashboard_compat."GiftCard";
drop view if exists dashboard_compat."RewardRedemption";
drop view if exists dashboard_compat."RewardConfig";
drop view if exists dashboard_compat."Transaction";
drop view if exists dashboard_compat."Visit";
drop view if exists dashboard_compat."LoyaltyCard";
drop view if exists dashboard_compat."OtpVerification";
drop view if exists dashboard_compat."Session";
drop view if exists dashboard_compat."User";
drop view if exists dashboard_compat."Location";
drop view if exists dashboard_compat."Tenant";

create view dashboard_compat."Tenant" as
select
  t.id::text as id,
  t.slug,
  t.name,
  null::text as city,
  coalesce(wp.card_prefix, upper(left(t.slug, 3)), 'LYL') as "cardPrefix",
  coalesce(wp.branding->>'primary_color', '#B5605A') as "primaryColor",
  wp.branding->>'secondary_color' as "secondaryColor",
  wp.branding->>'logo_url' as "logoUrl",
  wp.branding->>'strip_image_url' as "stripImageUrl",
  coalesce(wp.pass_style, 'default') as "passStyle",
  wp.branding->>'promo_message' as "promoMessage",
  nullif(wp.branding->>'promo_starts_at', '')::timestamptz as "promoStartsAt",
  nullif(wp.branding->>'promo_ends_at', '')::timestamptz as "promoEndsAt",
  wp.branding->>'promo_days' as "promoDays",
  wp.branding->'business_hours' as "businessHours",
  t.timezone,
  coalesce(wp.topup_enabled, true) as "topupEnabled",
  true as "selfRegistration",
  upper(t.status) as "subscriptionStatus",
  null::timestamptz as "suspendedAt",
  null::timestamptz as "trialEndsAt",
  coalesce((wp.branding->>'birthday_reward_enabled')::boolean, false) as "birthdayRewardEnabled",
  coalesce(wp.branding->>'birthday_reward_name', 'Regalo de cumpleaños') as "birthdayRewardName",
  t.created_at as "createdAt",
  t.updated_at as "updatedAt"
from platform.tenants as t
left join lateral (
  select *
  from cash.wallet_programs as p
  where p.tenant_id = t.id
  order by p.created_at desc
  limit 1
) as wp on true;

create view dashboard_compat."Location" as
select
  l.id::text as id,
  l.tenant_id::text as "tenantId",
  l.name,
  null::text as address,
  null::double precision as latitude,
  null::double precision as longitude,
  (l.status = 'active') as "isActive"
from platform.locations as l;

create view dashboard_compat."User" as
select distinct on (c.id)
  c.id::text as id,
  c.tenant_id::text as "tenantId",
  c.phone,
  c.email,
  c.display_name as name,
  null::date as "birthDate",
  'CUSTOMER'::text as role,
  null::text as "passwordHash",
  null::text as device,
  null::text as os,
  null::timestamptz as "phoneVerifiedAt",
  c.created_at as "createdAt",
  c.updated_at as "updatedAt"
from platform.contacts as c
join cash.loyalty_accounts as la
  on la.contact_id = c.id
union all
select
  sm.id::text as id,
  sm.tenant_id::text as "tenantId",
  sm.phone,
  sm.email,
  sm.name,
  null::date as "birthDate",
  case when lower(sm.name) = 'admin' then 'ADMIN' else 'STAFF' end as role,
  null::text as "passwordHash",
  null::text as device,
  null::text as os,
  null::timestamptz as "phoneVerifiedAt",
  sm.created_at as "createdAt",
  sm.updated_at as "updatedAt"
from platform.staff_members as sm;

create view dashboard_compat."Session" as
select
  null::text as id,
  null::text as "userId",
  null::text as token,
  null::timestamptz as "expiresAt",
  null::timestamptz as "createdAt"
where false;

create view dashboard_compat."OtpVerification" as
select
  id::text,
  identity_value as phone,
  tenant_id::text as "tenantId",
  code_hash as "codeHash",
  expires_at as "expiresAt",
  attempts,
  (verified_at is not null) as verified,
  created_at as "createdAt"
from cash.otp_verifications;

create view dashboard_compat."LoyaltyCard" as
select
  lc.id::text as id,
  lc.tenant_id::text as "tenantId",
  coalesce(la.contact_id::text, lc.loyalty_account_id::text) as "userId",
  lc.card_number as "cardNumber",
  lc.balance_cents as "balanceCentavos",
  lc.total_visits as "totalVisits",
  lc.visits_this_cycle as "visitsThisCycle",
  lc.pending_rewards as "pendingRewards",
  null::text as "applePassSerial",
  null::text as "applePassAuthToken",
  null::text as "googlePassObjectId",
  lc.qr_token as "qrToken",
  lc.qr_issued_at as "qrIssuedAt",
  lc.created_at as "createdAt",
  lc.updated_at as "updatedAt"
from cash.loyalty_cards as lc
left join cash.loyalty_accounts as la
  on la.id = lc.loyalty_account_id;

create view dashboard_compat."Visit" as
select
  id::text,
  loyalty_card_id::text as "cardId",
  coalesce(staff_member_id::text, '00000000-0000-0000-0000-000000000000') as "staffId",
  occurred_at as "scannedAt",
  note
from cash.visit_events;

create view dashboard_compat."Transaction" as
select
  id::text,
  loyalty_card_id::text as "cardId",
  staff_member_id::text as "staffId",
  upper(type) as type,
  amount_cents as "amountCentavos",
  description,
  created_at as "createdAt"
from cash.wallet_transactions;

create view dashboard_compat."RewardConfig" as
select
  id::text,
  tenant_id::text as "tenantId",
  visits_required as "visitsRequired",
  reward_name as "rewardName",
  reward_description as "rewardDescription",
  reward_cost_cents as "rewardCostCentavos",
  is_active as "isActive",
  activated_at as "activatedAt",
  created_at as "createdAt"
from cash.reward_configs;

create view dashboard_compat."RewardRedemption" as
select
  id::text,
  loyalty_card_id::text as "cardId",
  reward_config_id::text as "configId",
  coalesce(staff_member_id::text, '00000000-0000-0000-0000-000000000000') as "staffId",
  redeemed_at as "redeemedAt",
  note
from cash.reward_redemptions;

create view dashboard_compat."GiftCard" as
select
  id::text,
  tenant_id::text as "tenantId",
  code,
  amount_cents as "amountCentavos",
  coalesce(created_by_staff_member_id::text, '00000000-0000-0000-0000-000000000000') as "createdByStaffId",
  sender_name as "senderName",
  message,
  recipient_email as "recipientEmail",
  recipient_phone as "recipientPhone",
  recipient_name as "recipientName",
  (redeemed_at is not null) as "isRedeemed",
  redeemed_at as "redeemedAt",
  redeemed_loyalty_card_id::text as "redeemedCardId",
  expires_at as "expiresAt",
  created_at as "createdAt"
from cash.gift_cards;

create view dashboard_compat."BirthdayReward" as
select
  null::text as id,
  null::text as "tenantId",
  null::text as "loyaltyCardId",
  null::integer as year,
  null::timestamptz as "issuedAt",
  null::timestamptz as "expiresAt",
  null::timestamptz as "redeemedAt",
  null::text as status
where false;

create view dashboard_compat."ApplePushToken" as
select
  null::text as id,
  null::text as "cardId",
  null::text as "deviceToken",
  null::text as "pushToken",
  null::timestamptz as "createdAt"
where false;
