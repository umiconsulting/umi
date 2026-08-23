-- Gate 3F closeout: historical policy, expiry, operations, abuse controls, and history.
set search_path = merchant, umi, runtime, extensions, pg_catalog;

alter table merchant.device
  add constraint device_merchant_id_uk unique (merchant_id,id);

alter table merchant.loyalty_program
  add column include_tax boolean not null default false,
  add column include_tip boolean not null default false,
  add column discount_interaction text not null default 'subtract'
    check (discount_interaction in ('ignore','subtract')),
  add column reward_interaction text not null default 'subtract'
    check (reward_interaction in ('ignore','subtract')),
  add column excluded_product_ids uuid[] not null default '{}',
  add column excluded_category_ids uuid[] not null default '{}',
  add column excluded_tender_types text[] not null default '{}',
  add column pending_days integer not null default 0 check (pending_days between 0 and 3650),
  add column expiration_days integer check (expiration_days between 1 and 36500),
  add column authorization_ttl_seconds integer not null default 300
    check (authorization_ttl_seconds between 30 and 1800),
  add column policy_issued_at timestamptz not null default clock_timestamp();

alter table merchant.loyalty_reward
  add column location_ids uuid[] not null default '{}',
  add column product_ids uuid[] not null default '{}',
  add column category_ids uuid[] not null default '{}',
  add column variant_ids uuid[] not null default '{}',
  add column modifier_ids uuid[] not null default '{}',
  add column minimum_spend_minor_units bigint not null default 0
    check (minimum_spend_minor_units between 0 and 9007199254740991),
  add column maximum_benefit_minor_units bigint
    check (maximum_benefit_minor_units between 1 and 9007199254740991),
  add column allowed_tender_types text[] not null default '{}',
  add column combinable_with_discounts boolean not null default false,
  add column combinable_with_rewards boolean not null default false,
  add column combinable_with_tips boolean not null default true,
  add column usage_per_sale integer not null default 1 check (usage_per_sale between 1 and 100),
  add column usage_per_customer integer check (usage_per_customer between 1 and 1000000),
  add column usage_per_business_date integer check (usage_per_business_date between 1 and 1000000),
  add column approval_permission text check (length(approval_permission)<=100),
  add column policy_fingerprint text not null default repeat('0',64)
    check (policy_fingerprint ~ '^[a-f0-9]{64}$');

create table merchant.loyalty_earn_preview (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null,
  cart_id uuid not null,
  customer_id uuid not null,
  account_id uuid not null,
  checkout_version integer not null check (checkout_version>0),
  customer_attachment_version integer not null check (customer_attachment_version>0),
  loyalty_program_id uuid not null,
  loyalty_policy_version text not null check (length(loyalty_policy_version) between 1 and 80),
  loyalty_policy_fingerprint text not null check (loyalty_policy_fingerprint ~ '^[a-f0-9]{64}$'),
  checkout_fingerprint text not null check (checkout_fingerprint ~ '^[a-f0-9]{64}$'),
  preview_fingerprint text not null check (preview_fingerprint ~ '^[a-f0-9]{64}$'),
  input_fingerprint text not null check (input_fingerprint ~ '^[a-f0-9]{64}$'),
  gross_eligible_minor_units bigint not null check (gross_eligible_minor_units>=0),
  excluded_minor_units bigint not null check (excluded_minor_units>=0),
  final_eligible_minor_units bigint not null check (final_eligible_minor_units>=0),
  expected_points bigint not null check (expected_points>=0),
  earn_status text not null check (earn_status in ('pending','immediate')),
  explanation_codes text[] not null,
  effective_rules jsonb not null,
  business_date date not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id,customer_id)
    references merchant.customer(merchant_id,id) on delete restrict,
  foreign key (merchant_id,account_id)
     references merchant.loyalty_points_account(merchant_id,id) on delete restrict,
  foreign key (merchant_id,location_id)
    references merchant.location(merchant_id,id) on delete restrict,
  foreign key (merchant_id,cart_id)
    references merchant.pos_cart(merchant_id,id) on delete restrict,
   check (loyalty_program_id=merchant_id),
  unique (merchant_id,id),
  unique (merchant_id,preview_fingerprint),
  unique (merchant_id,cart_id,checkout_version,customer_id,loyalty_policy_version)
);
create index loyalty_earn_preview_expiry_idx
  on merchant.loyalty_earn_preview(merchant_id,expires_at);
create trigger loyalty_earn_preview_append_only
  before update or delete on merchant.loyalty_earn_preview
  for each row execute function merchant.tg_append_only();

create table merchant.loyalty_sale_policy_snapshot (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null,
  sale_id uuid not null,
  customer_id uuid not null,
  account_id uuid not null,
  earn_preview_id uuid not null,
  loyalty_program_id uuid not null,
  loyalty_policy_version text not null,
  loyalty_policy_fingerprint text not null check (loyalty_policy_fingerprint ~ '^[a-f0-9]{64}$'),
  reward_policy_version integer,
  reward_policy_fingerprint text check (reward_policy_fingerprint ~ '^[a-f0-9]{64}$'),
  effective_earn_rules jsonb not null,
  gross_eligible_minor_units bigint not null check (gross_eligible_minor_units>=0),
  excluded_minor_units bigint not null check (excluded_minor_units>=0),
  final_eligible_minor_units bigint not null check (final_eligible_minor_units>=0),
  earned_points bigint not null check (earned_points>=0),
  preview_fingerprint text not null check (preview_fingerprint ~ '^[a-f0-9]{64}$'),
  business_date date not null,
  committed_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id,sale_id)
    references merchant.pos_committed_sale(merchant_id,id) on delete restrict,
  foreign key (merchant_id,customer_id)
    references merchant.customer(merchant_id,id) on delete restrict,
  foreign key (merchant_id,account_id)
    references merchant.loyalty_points_account(merchant_id,id) on delete restrict,
  foreign key (merchant_id,location_id)
    references merchant.location(merchant_id,id) on delete restrict,
  foreign key (merchant_id,earn_preview_id)
    references merchant.loyalty_earn_preview(merchant_id,id) on delete restrict,
  check (loyalty_program_id=merchant_id),
  unique (merchant_id,sale_id)
);
create trigger loyalty_sale_policy_snapshot_append_only
  before update or delete on merchant.loyalty_sale_policy_snapshot
  for each row execute function merchant.tg_append_only();

create or replace function merchant.assert_loyalty_earn_preview(
  p_merchant_id uuid,
  p_location_id uuid,
  p_cart_id uuid,
  p_customer_id uuid,
  p_checkout_version integer,
  p_checkout_fingerprint text,
  p_preview_fingerprint text
) returns merchant.loyalty_earn_preview
language plpgsql security invoker set search_path=merchant,umi,pg_catalog as $$
declare v_preview merchant.loyalty_earn_preview;
begin
  select * into v_preview
    from merchant.loyalty_earn_preview
   where merchant_id=p_merchant_id and location_id=p_location_id and cart_id=p_cart_id
     and customer_id=p_customer_id and preview_fingerprint=p_preview_fingerprint
   for share;
  if v_preview.id is null
     or v_preview.checkout_version<>p_checkout_version
     or v_preview.checkout_fingerprint<>p_checkout_fingerprint
     or v_preview.expires_at<=clock_timestamp()
  then
    raise exception 'LOYALTY_PREVIEW_STALE';
  end if;
  return v_preview;
end $$;

alter table merchant.customer_value_authorization
  add column policy_fingerprint text not null default repeat('0',64)
    check (policy_fingerprint ~ '^[a-f0-9]{64}$'),
  add column reward_policy_snapshot jsonb,
  add column operator_id uuid references umi.user(id) on delete restrict,
  add column device_id uuid,
  add column credential_version integer check (credential_version>0),
  add column expiry_command_id uuid,
  add column expiry_fingerprint text check (expiry_fingerprint ~ '^[a-f0-9]{64}$'),
  add constraint customer_value_authorization_location_scope_fk
    foreign key (merchant_id,location_id) references merchant.location(merchant_id,id) on delete restrict,
  add constraint customer_value_authorization_device_scope_fk
    foreign key (merchant_id,device_id) references merchant.device(merchant_id,id) on delete restrict;

create table merchant.gift_card_secret_delivery (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null,
  gift_card_id uuid not null,
  issuance_command_id uuid not null,
  token_hash bytea not null,
  ciphertext bytea not null,
  nonce bytea not null check (octet_length(nonce)=12),
  auth_tag bytea not null check (octet_length(auth_tag)=16),
  operator_id uuid not null references umi.user(id) on delete restrict,
  device_id uuid not null,
  reveal_attempts integer not null default 0 check (reveal_attempts between 0 and 3),
  reveal_session_id uuid,
  revealed_at timestamptz,
  acknowledged_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id,gift_card_id)
    references merchant.loyalty_gift_card(merchant_id,id) on delete restrict,
  foreign key (merchant_id,location_id)
    references merchant.location(merchant_id,id) on delete restrict,
  foreign key (merchant_id,device_id)
    references merchant.device(merchant_id,id) on delete restrict,
  unique (merchant_id,issuance_command_id),
  unique (merchant_id,token_hash)
);
create index gift_card_secret_delivery_expiry_idx
  on merchant.gift_card_secret_delivery(merchant_id,expires_at)
  where acknowledged_at is null;

create or replace function merchant.store_gift_card_secret_delivery(
  p_merchant_id uuid,p_location_id uuid,p_gift_card_id uuid,p_issuance_command_id uuid,
  p_token_hash bytea,p_ciphertext bytea,p_nonce bytea,p_auth_tag bytea,
  p_operator_id uuid,p_device_id uuid,p_expires_at timestamptz
) returns void language plpgsql security definer
set search_path=pg_catalog,merchant,umi as $$
begin
  perform merchant.assert_customer_value_write_scope(p_merchant_id,p_device_id);
  insert into merchant.gift_card_secret_delivery(
    merchant_id,location_id,gift_card_id,issuance_command_id,token_hash,ciphertext,nonce,auth_tag,
    operator_id,device_id,expires_at)
  values(p_merchant_id,p_location_id,p_gift_card_id,p_issuance_command_id,p_token_hash,p_ciphertext,
    p_nonce,p_auth_tag,p_operator_id,p_device_id,p_expires_at);
end $$;

create or replace function merchant.reveal_gift_card_secret_delivery(
  p_merchant_id uuid,p_location_id uuid,p_token_hash bytea,p_operator_id uuid,
  p_device_id uuid,p_reveal_session_id uuid
) returns table(public_reference text,ciphertext bytea,nonce bytea,auth_tag bytea,expires_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,merchant,umi as $$
begin
  perform merchant.assert_customer_value_write_scope(p_merchant_id,p_device_id);
  return query
    update merchant.gift_card_secret_delivery d set reveal_attempts=d.reveal_attempts+1,
      reveal_session_id=p_reveal_session_id,revealed_at=clock_timestamp()
    from merchant.loyalty_gift_card g
    where d.merchant_id=p_merchant_id and d.location_id=p_location_id
      and d.token_hash=p_token_hash and d.operator_id=p_operator_id and d.device_id=p_device_id
      and d.gift_card_id=g.id and g.merchant_id=d.merchant_id
      and g.status='active'
      and (g.issuance_source<>'sale' or g.activated_by_sale_id is not null)
      and d.acknowledged_at is null and d.expires_at>clock_timestamp() and d.reveal_attempts<3
    returning g.public_reference,d.ciphertext,d.nonce,d.auth_tag,d.expires_at;
end $$;
alter table merchant.loyalty_gift_card
  add column location_id uuid,
  add column issuance_command_id uuid,
  add column issuance_fingerprint text check (issuance_fingerprint ~ '^[a-f0-9]{64}$'),
  add column issuance_policy_version text,
  add column issuance_source text not null default 'legacy'
    check (issuance_source in ('legacy','sale','promotion','development')),
  add column issuer_operator_id uuid references umi.user(id) on delete restrict,
  add column issuer_device_id uuid,
  add column activated_by_sale_id uuid,
  add constraint gift_card_location_scope_fk foreign key (merchant_id,location_id)
    references merchant.location(merchant_id,id) on delete restrict,
  add constraint gift_card_issuer_device_scope_fk foreign key (merchant_id,issuer_device_id)
    references merchant.device(merchant_id,id) on delete restrict,
  add constraint gift_card_activation_sale_scope_fk foreign key (merchant_id,activated_by_sale_id)
    references merchant.pos_committed_sale(merchant_id,id) on delete restrict;
create unique index gift_card_issuance_command_uidx
  on merchant.loyalty_gift_card(merchant_id,issuance_command_id)
  where issuance_command_id is not null;

create table merchant.gift_card_lookup_attempt (
  merchant_id uuid not null references merchant.merchant(id) on delete cascade,
  location_id uuid not null,
  bucket_hash bytea not null,
  window_started_at timestamptz not null,
  attempts integer not null check (attempts between 1 and 100),
  blocked_until timestamptz,
  last_attempt_at timestamptz not null,
  primary key (merchant_id,bucket_hash,window_started_at),
  foreign key (merchant_id,location_id)
    references merchant.location(merchant_id,id) on delete cascade
);
create index gift_card_lookup_block_idx
  on merchant.gift_card_lookup_attempt(merchant_id,blocked_until)
  where blocked_until is not null;

create or replace function merchant.consume_gift_card_lookup_budget(
  p_merchant_id uuid,p_location_id uuid,p_bucket_hash bytea,p_now timestamptz default clock_timestamp()
) returns table(allowed boolean,retry_after_seconds integer)
language plpgsql security definer set search_path=pg_catalog,merchant,umi as $$
declare v_window timestamptz:=date_trunc('minute',p_now)-
  make_interval(mins=>mod(extract(minute from p_now)::integer,5));
  v_attempts integer; v_blocked timestamptz;
begin
  perform merchant.assert_customer_value_write_scope(p_merchant_id,null);
  if octet_length(p_bucket_hash)<>32 then raise exception 'GIFT_CARD_LOOKUP_KEY_INVALID'; end if;
  delete from merchant.gift_card_lookup_attempt
   where ctid in (select ctid from merchant.gift_card_lookup_attempt
     where merchant_id=p_merchant_id and window_started_at<p_now-interval '1 day'
     order by window_started_at limit 200);
  insert into merchant.gift_card_lookup_attempt(
    merchant_id,location_id,bucket_hash,window_started_at,attempts,last_attempt_at)
  values(p_merchant_id,p_location_id,p_bucket_hash,v_window,1,p_now)
  on conflict(merchant_id,bucket_hash,window_started_at) do update set
    attempts=least(100,merchant.gift_card_lookup_attempt.attempts+1),
    last_attempt_at=p_now,
    blocked_until=case when merchant.gift_card_lookup_attempt.attempts+1>8
      then greatest(coalesce(merchant.gift_card_lookup_attempt.blocked_until,p_now),
        p_now+make_interval(secs=>least(900,30*(merchant.gift_card_lookup_attempt.attempts-7))))
      else merchant.gift_card_lookup_attempt.blocked_until end
  returning attempts,blocked_until into v_attempts,v_blocked;
  allowed:=v_attempts<=8 and (v_blocked is null or v_blocked<=p_now);
  retry_after_seconds:=case when allowed then 0 else greatest(1,ceil(extract(epoch from v_blocked-p_now)))::integer end;
  return next;
end $$;

create or replace function merchant.preview_points_adjustment(
  p_merchant_id uuid,p_customer_id uuid,p_account_id uuid,p_direction text,p_points bigint,
  p_reason text,p_command_fingerprint text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,merchant,umi as $$
declare v_available bigint;
begin
  perform merchant.assert_customer_value_write_scope(p_merchant_id,null);
  if p_direction not in ('increase','decrease') or p_points<=0
  then raise exception 'LOYALTY_ADJUSTMENT_INVALID'; end if;
  if p_reason not in ('customer_service_correction','migration_correction','fraud_correction',
    'operational_correction','expired_reward_correction','authorized_other')
  then raise exception 'LOYALTY_ADJUSTMENT_REASON_INVALID'; end if;
  select b.available into v_available from merchant.loyalty_points_account a
    join merchant.loyalty_points_balance b on b.account_id=a.id
   where a.id=p_account_id and a.merchant_id=p_merchant_id and a.customer_id=p_customer_id
     and a.status='active';
  if v_available is null then raise exception 'LOYALTY_ACCOUNT_UNAVAILABLE'; end if;
  if p_direction='decrease' and v_available<p_points
  then raise exception 'LOYALTY_INSUFFICIENT_POINTS'; end if;
  return jsonb_build_object('currentPoints',v_available,'projectedPoints',
    v_available+case when p_direction='increase' then p_points else -p_points end,
    'approvalRequired',p_points>500,'fingerprint',p_command_fingerprint);
end $$;

create or replace function merchant.commit_points_adjustment(
  p_merchant_id uuid,p_customer_id uuid,p_account_id uuid,p_direction text,p_points bigint,
  p_reason text,p_operator_id uuid,p_device_id uuid,p_command_id uuid,p_idempotency_key uuid,
  p_fingerprint text,p_business_date date
) returns uuid language plpgsql security definer
set search_path=pg_catalog,merchant,umi as $$
begin
  perform merchant.preview_points_adjustment(p_merchant_id,p_customer_id,p_account_id,
    p_direction,p_points,p_reason,p_fingerprint);
  return merchant.append_loyalty_points(p_merchant_id,p_customer_id,p_account_id,
    'manual_points_adjustment',case when p_direction='increase' then 'credit' else 'debit' end,
    p_points,'manual_points_adjustment',p_command_id,null,null,null,null,p_operator_id,p_device_id,
    p_command_id,p_idempotency_key,p_fingerprint,p_business_date);
end $$;

create or replace function merchant.expire_customer_value_authorizations(
  p_merchant_id uuid,p_batch_size integer default 100
) returns integer language plpgsql security definer
set search_path=pg_catalog,merchant,umi,extensions as $$
declare r merchant.customer_value_authorization%rowtype; v_count integer:=0;
  v_command uuid; v_key uuid; v_fingerprint text;
begin
  perform merchant.assert_customer_value_write_scope(p_merchant_id,null);
  if p_batch_size<1 or p_batch_size>500 then raise exception 'EXPIRY_BATCH_INVALID'; end if;
  for r in select * from merchant.customer_value_authorization
    where merchant_id=p_merchant_id and status='authorized' and expires_at<=clock_timestamp()
    order by expires_at,id for update skip locked limit p_batch_size
  loop
    v_command:=md5(r.id::text||':expiry-command')::uuid;
    v_key:=md5(r.id::text||':expiry-key')::uuid;
    v_fingerprint:=encode(extensions.digest(r.id::text||':expired','sha256'),'hex');
    if r.account_type='loyalty_reward' then
      perform merchant.append_loyalty_points(r.merchant_id,r.customer_id,r.account_id,
        'points_released','release',r.points,'reward_authorization',r.id,null,null,r.reward_id,r.id,
        r.operator_id,r.device_id,v_command,v_key,v_fingerprint,current_date);
    elsif r.account_type='wallet' then
      perform merchant.append_stored_value_fact(r.merchant_id,r.account_id,jsonb_build_object(
        'delta',0,'amountMinorUnits',r.amount_minor_units,'reason','authorization_released',
        'idempotencyKey',v_key::text,'entryType','authorization_released','currency',r.currency,
        'direction','release','authorizationId',r.id::text,'commandId',v_command::text,
        'fingerprint',v_fingerprint,'operatorId',r.operator_id::text,'deviceId',r.device_id::text,
        'businessDate',current_date,'sourceType','authorization_expiry','sourceId',r.id::text));
    else
      perform merchant.append_gift_card_fact(r.merchant_id,r.account_id,jsonb_build_object(
        'delta',0,'amountMinorUnits',r.amount_minor_units,'reason','authorization_released',
        'entryType','authorization_released','currency',r.currency,'direction','release',
        'authorizationId',r.id::text,'commandId',v_command::text,'idempotencyKey',v_key::text,
        'fingerprint',v_fingerprint,'operatorId',r.operator_id::text,'deviceId',r.device_id::text,
        'businessDate',current_date,'sourceType','authorization_expiry','sourceId',r.id::text));
    end if;
    update merchant.customer_value_authorization set status='expired',released_at=clock_timestamp(),
      expiry_command_id=v_command,expiry_fingerprint=v_fingerprint
      where id=r.id and status='authorized';
    if found then v_count:=v_count+1; end if;
  end loop;
  return v_count;
end $$;

create or replace function merchant.commit_customer_value_closeout(
  p_merchant_id uuid,p_location_id uuid,p_cart_id uuid,p_sale_id uuid,p_order_id uuid,
  p_customer_id uuid,p_command_id uuid,p_idempotency_key uuid,p_preview_fingerprint text,
  p_checkout_version integer,p_checkout_fingerprint text,p_business_date date,
  p_operator_id uuid,p_device_id uuid,p_selection jsonb
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,merchant,umi as $$
declare v_account merchant.loyalty_points_account%rowtype;
  v_policy merchant.loyalty_program%rowtype; v_preview merchant.loyalty_earn_preview%rowtype;
  v_auth merchant.customer_value_authorization%rowtype; v_ledger record; v_balance record;
  v_entry uuid; v_currency text; v_remaining bigint; v_committed_at timestamptz;
  v_result jsonb:='{"earn":null,"reward":null,"storedValue":[]}'::jsonb;
begin
  perform merchant.assert_customer_value_write_scope(p_merchant_id,p_device_id);
  select r.currency into v_currency from merchant.pos_committed_sale s
    join merchant.receipt_snapshot r on r.id=s.receipt_snapshot_id
   where s.id=p_sale_id and s.merchant_id=p_merchant_id and s.location_id=p_location_id;
  if v_currency is null then raise exception 'CUSTOMER_VALUE_SALE_REQUIRED'; end if;
  if p_customer_id is not null then
    perform 1 from merchant.customer where id=p_customer_id and merchant_id=p_merchant_id
    and status='active' and merged_into_id is null for update;
    if not found then raise exception 'CUSTOMER_MERCHANT_SCOPE'; end if;
    select * into v_account from merchant.loyalty_points_account
   where merchant_id=p_merchant_id and customer_id=p_customer_id and status='active'
   order by id limit 1 for update;
    select * into v_policy from merchant.loyalty_program
   where merchant_id=p_merchant_id for share;
    if v_account.id is not null and v_policy.enabled then
      v_preview:=merchant.assert_loyalty_earn_preview(
        p_merchant_id,p_location_id,p_cart_id,p_customer_id,p_checkout_version,
        p_checkout_fingerprint,p_preview_fingerprint);
      if v_preview.account_id<>v_account.id
        or v_preview.business_date<>p_business_date
        or v_preview.loyalty_policy_version<>v_policy.policy_version
        or v_preview.loyalty_policy_fingerprint<>v_policy.policy_fingerprint
      then raise exception 'LOYALTY_PREVIEW_STALE'; end if;
      insert into merchant.loyalty_sale_policy_snapshot(
        merchant_id,location_id,sale_id,customer_id,account_id,earn_preview_id,
        loyalty_program_id,loyalty_policy_version,loyalty_policy_fingerprint,
        reward_policy_version,reward_policy_fingerprint,effective_earn_rules,
        gross_eligible_minor_units,excluded_minor_units,final_eligible_minor_units,
        earned_points,preview_fingerprint,business_date)
      values(p_merchant_id,p_location_id,p_sale_id,p_customer_id,v_account.id,v_preview.id,
        v_preview.loyalty_program_id,v_preview.loyalty_policy_version,
        v_preview.loyalty_policy_fingerprint,
        (select reward_version from merchant.customer_value_authorization
          where id=nullif(p_selection->>'rewardAuthorizationId','')::uuid),
        (select policy_fingerprint from merchant.customer_value_authorization
          where id=nullif(p_selection->>'rewardAuthorizationId','')::uuid),
        v_preview.effective_rules,v_preview.gross_eligible_minor_units,v_preview.excluded_minor_units,
        v_preview.final_eligible_minor_units,v_preview.expected_points,v_preview.preview_fingerprint,
        p_business_date);
      if v_preview.expected_points>0 then
        v_entry:=merchant.append_loyalty_points(p_merchant_id,p_customer_id,v_account.id,
          case when v_preview.earn_status='pending' then 'points_earn_pending' else 'points_earn_committed' end,
          case when v_preview.earn_status='pending' then 'hold' else 'credit' end,
          v_preview.expected_points,'pos_sale',p_sale_id,p_sale_id,null,null,null,p_operator_id,p_device_id,
          p_command_id,p_idempotency_key,p_preview_fingerprint,p_business_date);
        select * into v_ledger from merchant.loyalty_points_ledger where id=v_entry;
        select * into v_balance from merchant.loyalty_points_balance where account_id=v_account.id;
        v_result:=jsonb_set(v_result,'{earn}',jsonb_build_object(
          'ledgerEntry',jsonb_build_object('id',v_ledger.id,'accountId',v_ledger.account_id,
            'customerId',v_ledger.customer_id,'sequence',v_ledger.sequence,'type',v_ledger.entry_type,
            'points',v_ledger.points,'direction',v_ledger.direction,'saleId',v_ledger.sale_id,
            'refundId',v_ledger.refund_id,'rewardId',v_ledger.reward_id,'commandId',v_ledger.command_id,
            'businessDate',v_ledger.business_date,'occurredAt',v_ledger.occurred_at),
          'balance',jsonb_build_object('accountId',v_account.id,
            'earned',v_balance.available+v_balance.redeemed,'pending',v_balance.pending,
            'available',v_balance.available,'authorized',v_balance.authorized,
            'redeemed',v_balance.redeemed,'reversed',v_balance.reversed,'expired',v_balance.expired,
            'adjusted',v_balance.adjusted,'ledgerSequence',v_balance.ledger_sequence,
            'projectionVersion',v_balance.projection_version,'calculatedAt',v_balance.calculated_at),
          'policyVersion',v_preview.loyalty_policy_version));
      end if;
    end if;
    if nullif(p_selection->>'rewardAuthorizationId','') is not null then
    select * into v_auth from merchant.customer_value_authorization
     where id=(p_selection->>'rewardAuthorizationId')::uuid and merchant_id=p_merchant_id
       and location_id=p_location_id and customer_id=p_customer_id and account_type='loyalty_reward'
       and status='authorized' and expires_at>clock_timestamp()
       and checkout_fingerprint=p_preview_fingerprint for update;
    if v_auth.id is null then raise exception 'REWARD_AUTHORIZATION_EXPIRED'; end if;
    v_entry:=merchant.append_loyalty_points(p_merchant_id,p_customer_id,v_auth.account_id,
      'points_redeemed','debit',v_auth.points,'reward_authorization',v_auth.id,p_sale_id,null,
      v_auth.reward_id,v_auth.id,p_operator_id,p_device_id,p_command_id,p_idempotency_key,
      p_preview_fingerprint,p_business_date);
    update merchant.customer_value_authorization set status='committed',committed_at=clock_timestamp()
     where id=v_auth.id and status='authorized';
    select committed_at into v_committed_at from merchant.customer_value_authorization where id=v_auth.id;
    v_result:=jsonb_set(v_result,'{reward}',jsonb_build_object('authorizationId',v_auth.id,
      'ledgerEntryId',v_entry,'points',v_auth.points,
      'benefit',jsonb_build_object('minorUnits',v_auth.benefit_minor_units,'currency',v_currency),
      'committedAt',v_committed_at));
    end if;
  end if;
  for v_auth in select a.* from merchant.customer_value_authorization a
    where a.id=any(array(select jsonb_array_elements_text(
      coalesce(p_selection->'storedValueAuthorizationIds','[]'::jsonb))::uuid))
      and a.merchant_id=p_merchant_id and a.location_id=p_location_id and a.status='authorized'
      and a.expires_at>clock_timestamp() and a.checkout_fingerprint=p_preview_fingerprint
    order by a.account_type,a.account_id for update
  loop
    if v_auth.currency<>v_currency then raise exception 'STORED_VALUE_CURRENCY_MISMATCH'; end if;
    if v_auth.account_type='wallet' then
      if p_customer_id is null or v_auth.customer_id is distinct from p_customer_id
      then raise exception 'WALLET_CUSTOMER_REQUIRED'; end if;
      perform merchant.append_stored_value_fact(p_merchant_id,v_auth.account_id,jsonb_build_object(
        'delta',-v_auth.amount_minor_units,'amountMinorUnits',v_auth.amount_minor_units,
        'reason','redeemed','idempotencyKey',p_idempotency_key::text,'entryType','redeemed',
        'currency',v_auth.currency,'direction','debit','authorizationId',v_auth.id::text,
        'commandId',p_command_id::text,'fingerprint',p_preview_fingerprint,
        'operatorId',p_operator_id::text,'deviceId',p_device_id::text,'businessDate',p_business_date,
        'sourceType','pos_sale','sourceId',p_sale_id::text,'orderId',p_order_id::text));
      select available into v_remaining from merchant.loyalty_stored_value_balance
       where card_id=v_auth.account_id;
    else
      raise exception 'GIFT_CARD_CODE_INVALID';
    end if;
    update merchant.customer_value_authorization set status='committed',committed_at=clock_timestamp()
     where id=v_auth.id and status='authorized';
    select committed_at into v_committed_at from merchant.customer_value_authorization where id=v_auth.id;
    v_result:=jsonb_set(v_result,'{storedValue}',(v_result->'storedValue')||jsonb_build_array(
      jsonb_build_object('authorization',jsonb_build_object('id',v_auth.id,
        'accountType',v_auth.account_type,'accountId',v_auth.account_id,'customerId',v_auth.customer_id,
        'currency',v_auth.currency,'saleId',v_auth.sale_id,'checkoutVersion',v_auth.checkout_version,
        'amountMinorUnits',v_auth.amount_minor_units,'fingerprint',v_auth.command_fingerprint,
        'status','committed','remainingBalanceMinorUnits',v_remaining,'createdAt',v_auth.created_at,
        'expiresAt',v_auth.expires_at,'correlationId',v_auth.correlation_id),
        'ledgerEntryId',(select id from merchant.loyalty_stored_value_ledger
          where command_id=p_command_id and card_id=v_auth.account_id limit 1),
        'committedAt',v_committed_at)));
  end loop;
  return v_result;
end $$;

create or replace view merchant.customer_history_event with (security_invoker=true) as
select o.merchant_id,o.customer_id,o.location_id,o.id event_id,'sale' event_type,
  coalesce(o.external_ref,o.id::text) public_reference,o.placed_at occurred_at,o.business_date,
  jsonb_build_object('status',o.status,'saleId',o.id,'amountMinorUnits',coalesce(r.grand_total,0),
    'currency',coalesce(r.currency,'MXN')) safe_data
from merchant.customer_order o left join merchant.receipt_snapshot r on r.order_id=o.id
where o.customer_id is not null
union all
select o.merchant_id,o.customer_id,r.location_id,r.id,'receipt',r.receipt_number,r.issued_at,
  r.business_date,jsonb_build_object('status','issued','saleId',s.id,'receiptId',r.id,
    'amountMinorUnits',r.grand_total,'currency',r.currency)
from merchant.receipt_snapshot r join merchant.customer_order o on o.id=r.order_id
join merchant.pos_committed_sale s on s.receipt_snapshot_id=r.id where o.customer_id is not null
union all
select e.merchant_id,o.customer_id,e.location_id,e.id,
  case when e.exception_type='void' then 'void' else 'refund' end,
  e.id::text,e.committed_at,e.business_date,jsonb_build_object('status',e.status,'saleId',e.sale_id,
    'refundId',e.id,'amountMinorUnits',e.total_minor_units,'currency',e.currency)
from merchant.pos_sale_exception e join merchant.pos_committed_sale s on s.id=e.sale_id
join merchant.customer_order o on o.id=s.order_id where o.customer_id is not null
union all
select l.merchant_id,l.customer_id,s.location_id,l.id,l.entry_type,l.id::text,l.occurred_at,
  l.business_date,jsonb_build_object('status','committed','saleId',l.sale_id,'refundId',l.refund_id,
    'rewardId',l.reward_id,'points',l.points,'direction',l.direction)
from merchant.loyalty_points_ledger l left join merchant.pos_committed_sale s on s.id=l.sale_id
union all
select a.merchant_id,a.customer_id,a.location_id,a.id,
  case when a.account_type='loyalty_reward' then 'reward_authorization'
    when a.account_type='wallet' then 'wallet_authorization' else 'gift_card_authorization' end,
  a.id::text,a.created_at,c.business_date,jsonb_build_object('status',a.status,'saleId',a.sale_id,
    'points',a.points,'amountMinorUnits',a.amount_minor_units,'currency',a.currency)
from merchant.customer_value_authorization a join merchant.pos_cart c on c.id=a.sale_id
where a.customer_id is not null
union all
select l.merchant_id,c.customer_id,coalesce(a.location_id,s.location_id),l.id,l.entry_type,
  l.id::text,l.occurred_at,
  l.business_date,jsonb_build_object('status','committed','saleId',l.order_id,
    'refundId',l.refund_id,'amountMinorUnits',l.amount_minor_units,'currency',l.currency,
    'direction',l.direction)
from merchant.loyalty_stored_value_ledger l join merchant.loyalty_card c on c.id=l.card_id
left join merchant.customer_value_authorization a on a.id=l.authorization_id
left join merchant.pos_committed_sale s on s.order_id=l.order_id
union all
select l.merchant_id,g.customer_id,g.location_id,l.id,
  'gift_card_'||l.entry_type,l.id::text,l.occurred_at,l.business_date,
  jsonb_build_object('status',g.status,'saleId',l.sale_id,'refundId',l.refund_id,
    'amountMinorUnits',l.amount_minor_units,'currency',l.currency,'direction',l.direction,
    'giftCardReference',g.public_reference)
from merchant.loyalty_gift_card_ledger l join merchant.loyalty_gift_card g on g.id=l.gift_card_id
where g.customer_id is not null
union all
select e.merchant_id,o.customer_id,e.location_id,r.id,'compensating_receipt',r.receipt_number,
  r.issued_at,r.business_date,jsonb_build_object('status','issued','saleId',e.sale_id,
    'refundId',e.id,'amountMinorUnits',r.total_minor_units,'currency',r.currency)
from merchant.pos_exception_receipt r join merchant.pos_sale_exception e on e.id=r.exception_id
join merchant.pos_committed_sale s on s.id=e.sale_id
join merchant.customer_order o on o.id=s.order_id where o.customer_id is not null
union all
select m.merchant_id,o.customer_id,m.location_id,m.provisional_id,'provisional_receipt_mapped',
  m.official_receipt_number,m.mapped_at,o.business_date,
  jsonb_build_object('status','mapped','saleId',m.official_sale_id,
    'receiptId',m.official_receipt_id,'correlationReference',m.reconciliation_reference)
from merchant.offline_provisional_mapping m
join merchant.pos_committed_sale s on s.id=m.official_sale_id
join merchant.customer_order o on o.id=s.order_id where o.customer_id is not null
union all
select m.merchant_id,c.customer_id,null::uuid,m.id,'customer_merge',m.id::text,m.created_at,
  m.created_at::date,jsonb_build_object('status',m.status,'sourceCustomerId',m.source_customer_id,
    'targetCustomerId',m.target_customer_id)
from merchant.customer_merge_mapping m
cross join lateral (values(m.source_customer_id),(m.target_customer_id)) c(customer_id)
union all
select h.merchant_id,h.customer_id,null::uuid,h.id,'consent_'||h.status,h.id::text,h.occurred_at,
  h.occurred_at::date,jsonb_build_object('status',h.status,'consentType',h.consent_type)
from merchant.customer_consent_history h;

comment on view merchant.customer_history_event is
  'Server-side composite customer history. API applies permission redaction and stable cursor validation.';

create or replace function merchant.validate_customer_history_cursor(
  p_merchant_id uuid,p_customer_id uuid,p_cursor_merchant uuid,p_cursor_customer uuid
) returns void language plpgsql immutable set search_path=pg_catalog as $$
begin
  if p_merchant_id is distinct from p_cursor_merchant or p_customer_id is distinct from p_cursor_customer
  then raise exception 'CUSTOMER_HISTORY_CURSOR_INVALID'; end if;
end $$;

grant select,insert on merchant.loyalty_earn_preview to api,worker;
grant select on merchant.loyalty_sale_policy_snapshot,merchant.customer_history_event to api,worker;
revoke all on merchant.gift_card_secret_delivery,merchant.gift_card_lookup_attempt from api,worker,readonly;
revoke update,delete on merchant.loyalty_earn_preview,merchant.loyalty_sale_policy_snapshot from api,worker;
grant execute on function merchant.consume_gift_card_lookup_budget(uuid,uuid,bytea,timestamptz),
  merchant.assert_loyalty_earn_preview(uuid,uuid,uuid,uuid,integer,text,text),
  merchant.preview_points_adjustment(uuid,uuid,uuid,text,bigint,text,text),
  merchant.commit_points_adjustment(uuid,uuid,uuid,text,bigint,text,uuid,uuid,uuid,uuid,text,date),
  merchant.expire_customer_value_authorizations(uuid,integer),
  merchant.commit_customer_value_closeout(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,text,date,uuid,uuid,jsonb),
  merchant.validate_customer_history_cursor(uuid,uuid,uuid,uuid) to api,worker;
grant execute on function merchant.store_gift_card_secret_delivery(uuid,uuid,uuid,uuid,bytea,bytea,bytea,bytea,uuid,uuid,timestamptz),
  merchant.reveal_gift_card_secret_delivery(uuid,uuid,bytea,uuid,uuid,uuid) to api;
revoke all on function merchant.consume_gift_card_lookup_budget(uuid,uuid,bytea,timestamptz),
  merchant.assert_loyalty_earn_preview(uuid,uuid,uuid,uuid,integer,text,text),
  merchant.preview_points_adjustment(uuid,uuid,uuid,text,bigint,text,text),
  merchant.commit_points_adjustment(uuid,uuid,uuid,text,bigint,text,uuid,uuid,uuid,uuid,text,date),
  merchant.expire_customer_value_authorizations(uuid,integer),
  merchant.commit_customer_value_closeout(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,text,date,uuid,uuid,jsonb),
  merchant.validate_customer_history_cursor(uuid,uuid,uuid,uuid) from public,readonly;
revoke all on function merchant.store_gift_card_secret_delivery(uuid,uuid,uuid,uuid,bytea,bytea,bytea,bytea,uuid,uuid,timestamptz),
  merchant.reveal_gift_card_secret_delivery(uuid,uuid,bytea,uuid,uuid,uuid) from public,worker,readonly;

do $$
declare t text;
begin
  foreach t in array array[
    'loyalty_earn_preview','loyalty_sale_policy_snapshot','gift_card_secret_delivery',
    'gift_card_lookup_attempt'
  ] loop
    execute format('alter table merchant.%I enable row level security',t);
    execute format('alter table merchant.%I force row level security',t);
    execute format('create policy %I on merchant.%I using '
      '(merchant_id=umi.current_merchant()) with check (merchant_id=umi.current_merchant())',
      t||'_scope',t);
  end loop;
end $$;

create policy customer_value_location_scope on merchant.loyalty_earn_preview as restrictive
  using (umi.current_location() is null or location_id=umi.current_location())
  with check (umi.current_location() is null or location_id=umi.current_location());
create policy customer_value_location_scope on merchant.loyalty_sale_policy_snapshot as restrictive
  using (umi.current_location() is null or location_id=umi.current_location())
  with check (umi.current_location() is null or location_id=umi.current_location());
create policy customer_value_location_scope on merchant.gift_card_secret_delivery as restrictive
  using (umi.current_location() is null or location_id=umi.current_location())
  with check (umi.current_location() is null or location_id=umi.current_location());
create policy customer_value_location_scope on merchant.gift_card_lookup_attempt as restrictive
  using (umi.current_location() is null or location_id=umi.current_location())
  with check (umi.current_location() is null or location_id=umi.current_location());

create policy device_scoping on merchant.customer_value_authorization as restrictive
  using (device_id=umi.current_device())
  with check (device_id=umi.current_device());
create policy device_scoping on merchant.gift_card_secret_delivery as restrictive
  using (device_id=umi.current_device())
  with check (device_id=umi.current_device());
