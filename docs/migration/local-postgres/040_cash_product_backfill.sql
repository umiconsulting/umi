insert into cash.wallet_programs (
  id,
  tenant_id,
  name,
  card_prefix,
  topup_enabled,
  pass_style,
  branding,
  status,
  created_at,
  updated_at
)
select
  legacy.stable_uuid('cash:wallet_program:' || t.id),
  tm.tenant_id,
  t.name,
  t."cardPrefix",
  t."topupEnabled",
  t."passStyle",
  jsonb_build_object(
    'primary_color', t."primaryColor",
    'secondary_color', t."secondaryColor",
    'logo_url', t."logoUrl",
    'strip_image_url', t."stripImageUrl",
    'promo_message', t."promoMessage",
    'promo_starts_at', t."promoStartsAt",
    'promo_ends_at', t."promoEndsAt",
    'promo_days', t."promoDays",
    'business_hours', t."businessHours",
    'birthday_reward_enabled', t."birthdayRewardEnabled",
    'birthday_reward_name', t."birthdayRewardName"
  ),
  case when t."subscriptionStatus" = 'ACTIVE' then 'active' else 'disabled' end,
  coalesce(t."createdAt"::timestamptz, now()),
  coalesce(t."updatedAt"::timestamptz, now())
from src_cash_public."Tenant" t
join legacy.tenant_mappings tm
  on tm.source_product = 'cash'
 and tm.source_schema = 'public'
 and tm.source_table = 'Tenant'
 and tm.source_id = t.id
on conflict (id) do nothing;

insert into cash.loyalty_accounts (
  id,
  tenant_id,
  contact_id,
  program_id,
  status,
  created_at,
  updated_at
)
select
  legacy.stable_uuid('cash:loyalty_account:' || u.id),
  cm.tenant_id,
  cm.contact_id,
  legacy.stable_uuid('cash:wallet_program:' || u."tenantId"),
  'active',
  coalesce(u."createdAt"::timestamptz, now()),
  coalesce(u."updatedAt"::timestamptz, now())
from src_cash_public."User" u
join legacy.contact_mappings cm
  on cm.source_product = 'cash'
 and cm.source_schema = 'public'
 and cm.source_table = 'User'
 and cm.source_id = u.id
where u.role = 'CUSTOMER'
on conflict (id) do nothing;

insert into cash.loyalty_cards (
  id,
  tenant_id,
  loyalty_account_id,
  card_number,
  balance_cents,
  total_visits,
  visits_this_cycle,
  pending_rewards,
  qr_token,
  qr_issued_at,
  status,
  created_at,
  updated_at
)
select
  legacy.stable_uuid('cash:loyalty_card:' || lc.id),
  tm.tenant_id,
  legacy.stable_uuid('cash:loyalty_account:' || lc."userId"),
  lc."cardNumber",
  lc."balanceCentavos",
  lc."totalVisits",
  lc."visitsThisCycle",
  lc."pendingRewards",
  lc."qrToken",
  lc."qrIssuedAt"::timestamptz,
  'active',
  coalesce(lc."createdAt"::timestamptz, now()),
  coalesce(lc."updatedAt"::timestamptz, now())
from src_cash_public."LoyaltyCard" lc
join legacy.tenant_mappings tm
  on tm.source_product = 'cash'
 and tm.source_schema = 'public'
 and tm.source_table = 'Tenant'
 and tm.source_id = lc."tenantId"
on conflict (id) do nothing;

insert into cash.visit_events (
  id,
  tenant_id,
  loyalty_card_id,
  staff_member_id,
  note,
  metadata,
  occurred_at
)
select
  legacy.stable_uuid('cash:visit:' || v.id),
  lc.tenant_id,
  legacy.stable_uuid('cash:loyalty_card:' || v."cardId"),
  sm.staff_member_id,
  v.note,
  jsonb_build_object('source_visit_id', v.id),
  v."scannedAt"::timestamptz
from src_cash_public."Visit" v
join cash.loyalty_cards lc on lc.id = legacy.stable_uuid('cash:loyalty_card:' || v."cardId")
join legacy.staff_mappings sm
  on sm.source_product = 'cash'
 and sm.source_schema = 'public'
 and sm.source_table = 'User'
 and sm.source_id = v."staffId"
on conflict (id) do nothing;

insert into cash.wallet_transactions (
  id,
  tenant_id,
  loyalty_card_id,
  staff_member_id,
  type,
  amount_cents,
  description,
  metadata,
  created_at
)
select
  legacy.stable_uuid('cash:transaction:' || tx.id),
  lc.tenant_id,
  legacy.stable_uuid('cash:loyalty_card:' || tx."cardId"),
  sm.staff_member_id,
  case tx.type
    when 'TOPUP' then 'topup'
    when 'PURCHASE' then 'purchase'
    else 'adjustment'
  end,
  tx."amountCentavos",
  tx.description,
  jsonb_build_object('source_transaction_id', tx.id, 'source_type', tx.type),
  tx."createdAt"::timestamptz
from src_cash_public."Transaction" tx
join cash.loyalty_cards lc on lc.id = legacy.stable_uuid('cash:loyalty_card:' || tx."cardId")
left join legacy.staff_mappings sm
  on sm.source_product = 'cash'
 and sm.source_schema = 'public'
 and sm.source_table = 'User'
 and sm.source_id = tx."staffId"
on conflict (id) do nothing;

insert into cash.reward_configs (
  id,
  tenant_id,
  program_id,
  visits_required,
  reward_name,
  reward_description,
  reward_cost_cents,
  is_active,
  activated_at,
  created_at
)
select
  legacy.stable_uuid('cash:reward_config:' || rc.id),
  tm.tenant_id,
  legacy.stable_uuid('cash:wallet_program:' || rc."tenantId"),
  rc."visitsRequired",
  rc."rewardName",
  rc."rewardDescription",
  rc."rewardCostCentavos",
  rc."isActive",
  rc."activatedAt"::timestamptz,
  rc."createdAt"::timestamptz
from src_cash_public."RewardConfig" rc
join legacy.tenant_mappings tm
  on tm.source_product = 'cash'
 and tm.source_schema = 'public'
 and tm.source_table = 'Tenant'
 and tm.source_id = rc."tenantId"
on conflict (id) do nothing;

insert into cash.reward_redemptions (
  id,
  tenant_id,
  loyalty_card_id,
  reward_config_id,
  staff_member_id,
  note,
  redeemed_at
)
select
  legacy.stable_uuid('cash:reward_redemption:' || rr.id),
  lc.tenant_id,
  legacy.stable_uuid('cash:loyalty_card:' || rr."cardId"),
  legacy.stable_uuid('cash:reward_config:' || rr."configId"),
  sm.staff_member_id,
  rr.note,
  rr."redeemedAt"::timestamptz
from src_cash_public."RewardRedemption" rr
join cash.loyalty_cards lc on lc.id = legacy.stable_uuid('cash:loyalty_card:' || rr."cardId")
join legacy.staff_mappings sm
  on sm.source_product = 'cash'
 and sm.source_schema = 'public'
 and sm.source_table = 'User'
 and sm.source_id = rr."staffId"
on conflict (id) do nothing;

insert into cash.gift_cards (
  id,
  tenant_id,
  code,
  amount_cents,
  created_by_staff_member_id,
  sender_name,
  message,
  recipient_email,
  recipient_phone,
  recipient_name,
  redeemed_at,
  redeemed_loyalty_card_id,
  expires_at,
  created_at
)
select
  legacy.stable_uuid('cash:gift_card:' || gc.id),
  tm.tenant_id,
  gc.code,
  gc."amountCentavos",
  sm.staff_member_id,
  gc."senderName",
  gc.message,
  gc."recipientEmail",
  gc."recipientPhone",
  gc."recipientName",
  gc."redeemedAt"::timestamptz,
  case when gc."redeemedCardId" is not null then legacy.stable_uuid('cash:loyalty_card:' || gc."redeemedCardId") end,
  gc."expiresAt"::timestamptz,
  gc."createdAt"::timestamptz
from src_cash_public."GiftCard" gc
join legacy.tenant_mappings tm
  on tm.source_product = 'cash'
 and tm.source_schema = 'public'
 and tm.source_table = 'Tenant'
 and tm.source_id = gc."tenantId"
join legacy.staff_mappings sm
  on sm.source_product = 'cash'
 and sm.source_schema = 'public'
 and sm.source_table = 'User'
 and sm.source_id = gc."createdByStaffId"
on conflict (id) do nothing;

insert into cash.passes (
  id,
  tenant_id,
  loyalty_card_id,
  provider,
  provider_object_id,
  serial_number,
  auth_token,
  status,
  created_at,
  updated_at
)
select
  legacy.stable_uuid('cash:pass:apple:' || lc.id),
  tm.tenant_id,
  legacy.stable_uuid('cash:loyalty_card:' || lc.id),
  'apple',
  lc."applePassSerial",
  lc."applePassSerial",
  lc."applePassAuthToken",
  'active',
  lc."createdAt"::timestamptz,
  lc."updatedAt"::timestamptz
from src_cash_public."LoyaltyCard" lc
join legacy.tenant_mappings tm
  on tm.source_product = 'cash'
 and tm.source_schema = 'public'
 and tm.source_table = 'Tenant'
 and tm.source_id = lc."tenantId"
where nullif(trim(lc."applePassSerial"), '') is not null
on conflict (id) do nothing;

insert into cash.passes (
  id,
  tenant_id,
  loyalty_card_id,
  provider,
  provider_object_id,
  status,
  created_at,
  updated_at
)
select
  legacy.stable_uuid('cash:pass:google:' || lc.id),
  tm.tenant_id,
  legacy.stable_uuid('cash:loyalty_card:' || lc.id),
  'google',
  lc."googlePassObjectId",
  'active',
  lc."createdAt"::timestamptz,
  lc."updatedAt"::timestamptz
from src_cash_public."LoyaltyCard" lc
join legacy.tenant_mappings tm
  on tm.source_product = 'cash'
 and tm.source_schema = 'public'
 and tm.source_table = 'Tenant'
 and tm.source_id = lc."tenantId"
where nullif(trim(lc."googlePassObjectId"), '') is not null
on conflict (id) do nothing;

insert into cash.pass_devices (
  id,
  tenant_id,
  pass_id,
  device_token,
  push_token,
  created_at
)
select
  legacy.stable_uuid('cash:pass_device:' || apt.id),
  p.tenant_id,
  p.id,
  apt."deviceToken",
  apt."pushToken",
  apt."createdAt"::timestamptz
from src_cash_public."ApplePushToken" apt
join cash.passes p
  on p.id = legacy.stable_uuid('cash:pass:apple:' || apt."cardId")
on conflict (id) do nothing;

insert into platform.external_refs (
  tenant_id,
  product_key,
  external_schema,
  external_table,
  external_id,
  metadata
)
select lc.tenant_id, 'cash', 'public', 'LoyaltyCard', src.id, jsonb_build_object('target_table', 'cash.loyalty_cards')
from src_cash_public."LoyaltyCard" src
join cash.loyalty_cards lc on lc.id = legacy.stable_uuid('cash:loyalty_card:' || src.id)
on conflict (product_key, external_schema, external_table, external_id) do nothing;

insert into platform.external_refs (
  tenant_id,
  product_key,
  external_schema,
  external_table,
  external_id,
  metadata
)
select wp.tenant_id, 'cash', 'public', 'RewardConfig', src.id, jsonb_build_object('target_table', 'cash.reward_configs')
from src_cash_public."RewardConfig" src
join cash.wallet_programs wp on wp.id = legacy.stable_uuid('cash:wallet_program:' || src."tenantId")
on conflict (product_key, external_schema, external_table, external_id) do nothing;

insert into observability.data_quality_findings (
  tenant_id,
  product_key,
  severity,
  finding_key,
  subject_schema,
  subject_table,
  subject_id,
  detail,
  status
)
select
  tm.tenant_id,
  'cash',
  'info',
  'cash_otp_verification_archived_not_imported',
  'public',
  'OtpVerification',
  null,
  jsonb_build_object('source_rows', count(*), 'reason', 'short-window auth artifact excluded from durable product import'),
  'open'
from src_cash_public."OtpVerification" otp
join legacy.tenant_mappings tm
  on tm.source_product = 'cash'
 and tm.source_schema = 'public'
 and tm.source_table = 'Tenant'
 and tm.source_id = otp."tenantId"
where not exists (
  select 1
  from observability.data_quality_findings existing
  where existing.tenant_id = tm.tenant_id
    and existing.product_key = 'cash'
    and existing.finding_key = 'cash_otp_verification_archived_not_imported'
    and existing.subject_schema = 'public'
    and existing.subject_table = 'OtpVerification'
    and existing.subject_id is null
)
group by tm.tenant_id
having count(*) > 0;

insert into observability.data_quality_findings (
  tenant_id,
  product_key,
  severity,
  finding_key,
  subject_schema,
  subject_table,
  subject_id,
  detail,
  status
)
select
  tm.tenant_id,
  'cash',
  'info',
  'cash_session_archived_not_imported',
  'public',
  'Session',
  null,
  jsonb_build_object('source_rows', count(*), 'reason', 'session rows excluded from durable product import'),
  'open'
from src_cash_public."Session" s
join src_cash_public."User" u on u.id = s."userId"
join legacy.tenant_mappings tm
  on tm.source_product = 'cash'
 and tm.source_schema = 'public'
 and tm.source_table = 'Tenant'
 and tm.source_id = u."tenantId"
where not exists (
  select 1
  from observability.data_quality_findings existing
  where existing.tenant_id = tm.tenant_id
    and existing.product_key = 'cash'
    and existing.finding_key = 'cash_session_archived_not_imported'
    and existing.subject_schema = 'public'
    and existing.subject_table = 'Session'
    and existing.subject_id is null
)
group by tm.tenant_id
having count(*) > 0;
