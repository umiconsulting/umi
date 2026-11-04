-- Gate 3F final closeout: tender fingerprints, funded cards, approvals, and history scope.
set search_path = merchant, umi, runtime, extensions, pg_catalog;

alter table merchant.product
  add column sale_action text not null default 'merchandise'
    check (sale_action in ('merchandise','gift_card'));

alter table merchant.customer_value_authorization
  add column allocation_id uuid,
  add column allocation_order integer,
  add column allocation_fingerprint text,
  add column remaining_balance_minor_units bigint,
  add column optimistic_version integer,
  add column approval_id uuid,
  add column approval_fingerprint text,
  add column approval_tender_fingerprint text,
  add column stored_value_fingerprint text,
  add column committed_value_fingerprint text;

update merchant.customer_value_authorization set
  allocation_id=id,
  allocation_order=0,
  allocation_fingerprint=command_fingerprint,
  remaining_balance_minor_units=0,
  optimistic_version=1
where allocation_id is null;

alter table merchant.customer_value_authorization
  alter column allocation_id set default gen_random_uuid(),
  alter column allocation_id set not null,
  alter column allocation_order set default 0,
  alter column allocation_order set not null,
  alter column allocation_fingerprint set default repeat('0',64),
  alter column allocation_fingerprint set not null,
  alter column remaining_balance_minor_units set default 0,
  alter column remaining_balance_minor_units set not null,
  alter column optimistic_version set default 1,
  alter column optimistic_version set not null,
  add constraint customer_value_allocation_order_ck check (allocation_order between 0 and 7),
  add constraint customer_value_allocation_fingerprint_ck
    check (allocation_fingerprint ~ '^[a-f0-9]{64}$'),
  add constraint customer_value_remaining_balance_ck check (remaining_balance_minor_units>=0),
  add constraint customer_value_optimistic_version_ck check (optimistic_version>0),
  add constraint customer_value_approval_fingerprint_ck
    check (approval_fingerprint is null or approval_fingerprint ~ '^[a-f0-9]{64}$'),
  add constraint customer_value_approval_tender_fingerprint_ck
    check (approval_tender_fingerprint is null or approval_tender_fingerprint ~ '^[a-f0-9]{64}$'),
  add constraint customer_value_stored_fingerprint_ck
    check (stored_value_fingerprint is null or stored_value_fingerprint ~ '^[a-f0-9]{64}$'),
  add constraint customer_value_committed_fingerprint_ck
    check (committed_value_fingerprint is null or committed_value_fingerprint ~ '^[a-f0-9]{64}$');

create unique index customer_value_allocation_uidx
  on merchant.customer_value_authorization(merchant_id,sale_id,allocation_id)
  where account_type in ('wallet','gift_card');
alter table merchant.customer_value_authorization
  add constraint customer_value_authorization_merchant_id_uk unique (merchant_id,id);
create index customer_value_commit_lock_idx
  on merchant.customer_value_authorization(merchant_id,account_type,account_id,status,expires_at);
create unique index customer_value_one_live_account_allocation_uidx
  on merchant.customer_value_authorization(merchant_id,sale_id,account_type,account_id)
  where account_type in ('wallet','gift_card') and status='authorized';

alter table merchant.loyalty_gift_card
  add column pending_funding_cart_id uuid,
  add column pending_funding_minor_units bigint
    check (pending_funding_minor_units is null or pending_funding_minor_units>0),
  add column pending_funding_assignment_id uuid,
  add column pending_funding_line_id uuid,
  add column pending_funding_fingerprint text
    check (pending_funding_fingerprint is null or pending_funding_fingerprint ~ '^[a-f0-9]{64}$'),
  add constraint gift_card_pending_cart_scope_fk foreign key (merchant_id,pending_funding_cart_id)
    references merchant.pos_cart(merchant_id,id) on delete restrict;
create index gift_card_pending_funding_idx
  on merchant.loyalty_gift_card(merchant_id,pending_funding_cart_id,status)
  where pending_funding_cart_id is not null;

create table merchant.customer_value_tender_allocation (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null,
  customer_id uuid,
  sale_id uuid not null,
  checkout_id uuid not null,
  checkout_version integer not null check (checkout_version>0),
  allocation_id uuid not null,
  tender_type text not null check (tender_type in ('wallet','gift_card')),
  account_id uuid not null,
  account_public_reference text not null check (length(account_public_reference) between 1 and 80),
  authorization_id uuid not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  requested_minor_units bigint not null check (requested_minor_units>0),
  authorized_minor_units bigint not null check (authorized_minor_units>0),
  committed_minor_units bigint not null check (committed_minor_units>0),
  remaining_balance_minor_units bigint not null check (remaining_balance_minor_units>=0),
  allocation_order integer not null check (allocation_order between 0 and 7),
  cash_allocation_minor_units bigint not null check (cash_allocation_minor_units>=0),
  manual_terminal_allocation_minor_units bigint not null
    check (manual_terminal_allocation_minor_units>=0),
  wallet_allocation_ids uuid[] not null,
  gift_card_allocation_ids uuid[] not null,
  policy_id text not null,
  policy_version text not null,
  authorization_expires_at timestamptz not null,
  command_id uuid not null,
  idempotency_key uuid not null,
  optimistic_version integer not null check (optimistic_version>0),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  committed_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id,location_id)
    references merchant.location(merchant_id,id) on delete restrict,
  foreign key (merchant_id,sale_id)
    references merchant.pos_committed_sale(merchant_id,id) on delete restrict,
  foreign key (merchant_id,authorization_id)
    references merchant.customer_value_authorization(merchant_id,id) on delete restrict,
  unique (merchant_id,sale_id,allocation_id),
  unique (merchant_id,authorization_id)
);
create index customer_value_tender_history_idx
  on merchant.customer_value_tender_allocation(merchant_id,customer_id,committed_at desc,id desc);
create trigger customer_value_tender_allocation_append_only
  before update or delete on merchant.customer_value_tender_allocation
  for each row execute function merchant.tg_append_only();

create table merchant.gift_card_funding_assignment (
  id uuid primary key,
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null,
  gift_card_id uuid not null,
  cart_id uuid not null,
  cart_line_id uuid not null,
  sale_id uuid not null,
  purchased_value_minor_units bigint not null check (purchased_value_minor_units>0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  policy_id text not null,
  policy_version text not null,
  funding_fingerprint text not null check (funding_fingerprint ~ '^[a-f0-9]{64}$'),
  command_id uuid not null,
  funded_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id,location_id)
    references merchant.location(merchant_id,id) on delete restrict,
  foreign key (merchant_id,gift_card_id)
    references merchant.loyalty_gift_card(merchant_id,id) on delete restrict,
  foreign key (merchant_id,cart_id)
    references merchant.pos_cart(merchant_id,id) on delete restrict,
  foreign key (merchant_id,sale_id)
    references merchant.pos_committed_sale(merchant_id,id) on delete restrict,
  unique (merchant_id,gift_card_id),
  unique (merchant_id,command_id,gift_card_id)
);
create index gift_card_funding_sale_idx
  on merchant.gift_card_funding_assignment(merchant_id,sale_id);
create trigger gift_card_funding_assignment_append_only
  before update or delete on merchant.gift_card_funding_assignment
  for each row execute function merchant.tg_append_only();

create or replace view merchant.customer_history_event_scoped with (security_invoker=true) as
with normalized as (
  select e.*,
    case when e.event_type in ('issued','loaded','authorized','authorization_released',
      'redeemed','refunded','reversed','expired_foundation','adjustment_increase',
      'adjustment_decrease') then 'wallet_'||e.event_type else e.event_type end scoped_event_type
  from merchant.customer_history_event e
)
select e.merchant_id,e.customer_id,e.location_id,e.event_id,e.scoped_event_type event_type,
  e.public_reference,e.occurred_at,e.business_date,e.safe_data,
  case
    when e.location_id is not null then 'location_attributed'
    when e.event_type like 'consent_%' or e.event_type='customer_merge'
      then 'restricted_administrative'
    when e.event_type in ('manual_points_adjustment','points_adjustment_increase',
      'points_adjustment_decrease') then 'merchant_global'
    else 'restricted_administrative'
  end::text visibility,
  e.location_id origin_location_id,
  case
    when e.event_type like 'consent_%' or e.event_type='customer_merge'
      then 'customer.history.admin'
    when e.location_id is null and e.event_type in ('manual_points_adjustment',
      'points_adjustment_increase','points_adjustment_decrease') then 'customer.history.global'
    when e.location_id is null then 'customer.history.admin'
    else 'customer.history.read'
  end::text permission_class
from normalized e;

comment on view merchant.customer_history_event_scoped is
  'Explicit Gate 3F visibility. A null location never acts as a location wildcard.';

revoke all on merchant.customer_history_event from api,worker,readonly;
revoke all on merchant.customer_history_event_scoped from api,worker,readonly;

create or replace function merchant.read_customer_history_event_scoped(
  p_merchant_id uuid,p_customer_id uuid,p_operator_session_id uuid
) returns table(
  merchant_id uuid,customer_id uuid,location_id uuid,event_id uuid,event_type text,
  public_reference text,occurred_at timestamptz,business_date date,safe_data jsonb,
  visibility text,origin_location_id uuid,permission_class text
) language sql stable security definer
set search_path=pg_catalog,merchant,runtime,umi as $$
  select e.merchant_id,e.customer_id,e.location_id,e.event_id,e.event_type,
    e.public_reference,e.occurred_at,e.business_date,e.safe_data,e.visibility,
    e.origin_location_id,e.permission_class
  from merchant.customer_history_event_scoped e
  join runtime.operator_session os on os.id=p_operator_session_id
  where p_merchant_id=umi.current_merchant()
    and e.merchant_id=p_merchant_id and e.customer_id=p_customer_id
    and os.merchant_id=p_merchant_id and os.location_id=umi.current_location()
    and os.device_id=umi.current_device()
    and os.user_id=nullif(current_setting('app.user_id',true),'')::uuid
    and os.state='active' and os.expires_at>clock_timestamp()
    and ('*'=any(os.permissions) or 'customer.history.read'=any(os.permissions))
    and exists(select 1 from jsonb_array_elements(os.entitlements) entitlement
      where entitlement->>'featureKey'='pos'
        and coalesce((entitlement->>'enabled')::boolean,false))
    and (
      (e.visibility in ('location_attributed','origin_location')
        and e.location_id=os.location_id)
      or e.visibility='customer_visible_foundation'
      or (('*'=any(os.permissions) or 'customer.history.global'=any(os.permissions))
        and e.visibility='merchant_global')
      or (('*'=any(os.permissions) or 'customer.history.admin'=any(os.permissions))
        and e.visibility='restricted_administrative')
    )
    and ('*'=any(os.permissions) or 'customer.consent.read'=any(os.permissions)
      or e.event_type not like 'consent_%')
$$;
revoke all on function merchant.read_customer_history_event_scoped(uuid,uuid,uuid)
  from public,readonly;
grant execute on function merchant.read_customer_history_event_scoped(uuid,uuid,uuid) to api;
do $$ begin
  if to_regprocedure('merchant.read_customer_history_event_scoped(uuid,uuid,uuid,boolean,boolean,boolean)') is not null then
    execute 'revoke all on function merchant.read_customer_history_event_scoped(uuid,uuid,uuid,boolean,boolean,boolean) '
      'from public,api,worker,readonly';
  end if;
end $$;
do $$ begin
  if to_regprocedure('merchant.read_customer_history_event_scoped(uuid,uuid)') is not null then
    execute 'revoke all on function merchant.read_customer_history_event_scoped(uuid,uuid) '
      'from public,api,worker,readonly';
  end if;
end $$;

create or replace function merchant.activate_sale_funded_gift_card(
  p_merchant_id uuid,p_location_id uuid,p_cart_id uuid,p_sale_id uuid,
  p_command_id uuid,p_idempotency_key uuid,p_operator_id uuid,p_device_id uuid,
  p_business_date date,p_funded jsonb
) returns uuid language plpgsql security definer
set search_path=pg_catalog,merchant,umi as $$
declare v_card merchant.loyalty_gift_card%rowtype; v_existing uuid;
begin
  perform merchant.assert_customer_value_write_scope(p_merchant_id,p_device_id);
  select gift_card_id into v_existing from merchant.gift_card_funding_assignment
  where merchant_id=p_merchant_id and id=(p_funded->>'assignmentId')::uuid
    and funding_fingerprint=p_funded->>'fingerprint';
  if v_existing is not null then return v_existing; end if;
  perform 1 from merchant.pos_committed_sale
    where id=p_sale_id and merchant_id=p_merchant_id and location_id=p_location_id
      and cart_id=p_cart_id for update;
  if not found then raise exception 'GIFT_CARD_FUNDING_REQUIRED'; end if;
  select g.* into v_card from merchant.loyalty_gift_card g
  where g.id=(p_funded->>'giftCardId')::uuid and g.merchant_id=p_merchant_id
    and g.location_id=p_location_id and g.issuance_source='sale' and g.status='inactive'
    and g.pending_funding_cart_id=p_cart_id
    and g.pending_funding_minor_units=(p_funded->'purchasedValue'->>'minorUnits')::bigint
    and g.pending_funding_assignment_id=(p_funded->>'assignmentId')::uuid
    and g.pending_funding_line_id=(p_funded->>'saleLineId')::uuid
    and g.pending_funding_fingerprint=p_funded->>'fingerprint'
    and p_funded->>'policyId'='gift-card-sale-funding'
    and p_funded->>'policyVersion'='pilot-v1'
    and g.currency=p_funded->'purchasedValue'->>'currency' for update;
  if v_card.id is null then raise exception 'GIFT_CARD_FUNDING_REQUIRED'; end if;
  perform 1 from merchant.pos_cart_line l
    join merchant.product product on product.id=l.product_id
      and product.merchant_id=p_merchant_id and product.active
      and product.sale_action='gift_card'
    where l.id=(p_funded->>'saleLineId')::uuid and l.cart_id=p_cart_id
      and l.quantity*(l.base_price+l.variant_delta+l.modifier_total)=v_card.pending_funding_minor_units;
  if not found then raise exception 'GIFT_CARD_FUNDING_AMOUNT_MISMATCH'; end if;
  perform merchant.append_gift_card_fact(p_merchant_id,v_card.id,jsonb_build_object(
    'delta',v_card.pending_funding_minor_units,'amountMinorUnits',v_card.pending_funding_minor_units,
    'reason','issued','entryType','issued','currency',v_card.currency,'direction','credit',
    'commandId',p_command_id::text,'idempotencyKey',p_idempotency_key::text,
    'fingerprint',p_funded->>'fingerprint','operatorId',p_operator_id::text,
    'deviceId',p_device_id::text,'businessDate',p_business_date,
    'sourceType','sale_funded_gift_card','sourceId',p_sale_id::text,'saleId',p_sale_id::text));
  update merchant.loyalty_gift_card set status='active',activated_at=clock_timestamp(),
    activated_by_sale_id=p_sale_id,version=version+1
  where id=v_card.id and status='inactive';
  if not found then raise exception 'GIFT_CARD_ACTIVATION_CONFLICT'; end if;
  insert into merchant.gift_card_funding_assignment(
    id,merchant_id,location_id,gift_card_id,cart_id,cart_line_id,sale_id,
    purchased_value_minor_units,currency,policy_id,policy_version,funding_fingerprint,command_id)
  values((p_funded->>'assignmentId')::uuid,p_merchant_id,p_location_id,v_card.id,p_cart_id,
    (p_funded->>'saleLineId')::uuid,p_sale_id,v_card.pending_funding_minor_units,v_card.currency,
    'gift-card-sale-funding','pilot-v1',p_funded->>'fingerprint',p_command_id);
  return v_card.id;
end $$;

create or replace function merchant.commit_customer_value_closeout(
  p_merchant_id uuid,p_location_id uuid,p_cart_id uuid,p_sale_id uuid,p_order_id uuid,
  p_customer_id uuid,p_command_id uuid,p_idempotency_key uuid,p_preview_fingerprint text,
  p_checkout_version integer,p_checkout_fingerprint text,p_business_date date,
  p_operator_id uuid,p_device_id uuid,p_stored_value_fingerprint text,p_selection jsonb
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,merchant,umi,extensions as $$
declare v_result jsonb; v_wallet_selection jsonb; v_auth merchant.customer_value_authorization%rowtype;
  v_entry uuid; v_remaining bigint; v_committed_at timestamptz; v_funded jsonb;
  v_account_reference text; v_selected_count integer; v_tender_count integer;
begin
  perform merchant.assert_customer_value_write_scope(p_merchant_id,p_device_id);
  perform 1 from merchant.pos_committed_sale
    where id=p_sale_id and merchant_id=p_merchant_id and location_id=p_location_id
      and cart_id=p_cart_id for update;
  if not found then raise exception 'SALE_NOT_COMMITTED'; end if;
  if p_stored_value_fingerprint is not null
    and p_stored_value_fingerprint !~ '^[a-f0-9]{64}$'
  then raise exception 'STORED_VALUE_FINGERPRINT_CONFLICT'; end if;
  if nullif(p_selection->>'storedValueFingerprint','') is distinct from p_stored_value_fingerprint
  then raise exception 'STORED_VALUE_FINGERPRINT_CONFLICT'; end if;

  select count(*) into v_selected_count
  from merchant.customer_value_authorization a
  where a.id=any(array(select jsonb_array_elements_text(
    coalesce(p_selection->'storedValueAuthorizationIds','[]'::jsonb))::uuid))
    and a.merchant_id=p_merchant_id and a.location_id=p_location_id
    and a.sale_id=p_cart_id and a.checkout_version=p_checkout_version
    and a.account_type in ('wallet','gift_card') and a.status='authorized'
    and a.expires_at>clock_timestamp()
    and (a.account_type='wallet' or exists(select 1 from merchant.loyalty_gift_card g
      where g.id=a.account_id and g.merchant_id=a.merchant_id and g.status='active'));
  if v_selected_count>0 and p_stored_value_fingerprint is null
  then raise exception 'STORED_VALUE_FINGERPRINT_CONFLICT'; end if;
  if v_selected_count<>jsonb_array_length(
    coalesce(p_selection->'storedValueAuthorizationIds','[]'::jsonb))
  then raise exception 'STORED_VALUE_AUTHORIZATION_EXPIRED'; end if;

  select count(*) into v_tender_count from merchant.pos_tender_fact t
  where t.checkout_id in (select id from merchant.pos_checkout_draft
    where cart_id=p_cart_id and merchant_id=p_merchant_id and location_id=p_location_id)
    and t.tender_type in ('wallet','gift_card')
    and t.id=any(array(select a.allocation_id from merchant.customer_value_authorization a
      where a.id=any(array(select jsonb_array_elements_text(
        coalesce(p_selection->'storedValueAuthorizationIds','[]'::jsonb))::uuid))));
  if v_tender_count<>v_selected_count then raise exception 'STORED_VALUE_ALLOCATION_MISMATCH'; end if;

  if nullif(p_selection->>'rewardAuthorizationId','') is not null then
    perform 1 from merchant.customer_value_authorization a
    where a.id=(p_selection->>'rewardAuthorizationId')::uuid
      and (a.stored_value_fingerprint is null
        or a.stored_value_fingerprint=p_stored_value_fingerprint)
      and (a.approval_id is null or a.approval_id=nullif(p_selection->>'rewardApprovalId','')::uuid)
    for update;
    if not found then raise exception 'APPROVAL_INVALID'; end if;
  end if;

  v_wallet_selection:=jsonb_set(p_selection,'{storedValueAuthorizationIds}',coalesce((
    select jsonb_agg(a.id::text order by a.allocation_order,a.id)
    from merchant.customer_value_authorization a
    where a.id=any(array(select jsonb_array_elements_text(
      coalesce(p_selection->'storedValueAuthorizationIds','[]'::jsonb))::uuid))
      and a.account_type='wallet'),'[]'::jsonb));
  v_result:=merchant.commit_customer_value_closeout(
    p_merchant_id,p_location_id,p_cart_id,p_sale_id,p_order_id,p_customer_id,p_command_id,
    p_idempotency_key,p_preview_fingerprint,p_checkout_version,p_checkout_fingerprint,
    p_business_date,p_operator_id,p_device_id,v_wallet_selection);

  for v_auth in select a.* from merchant.customer_value_authorization a
    join merchant.loyalty_gift_card g on g.id=a.account_id
      and g.merchant_id=a.merchant_id and g.status='active'
    where a.id=any(array(select jsonb_array_elements_text(
      coalesce(p_selection->'storedValueAuthorizationIds','[]'::jsonb))::uuid))
      and a.account_type='gift_card' and a.merchant_id=p_merchant_id
      and a.location_id=p_location_id and a.status='authorized'
      and a.expires_at>clock_timestamp()
    order by a.account_id,a.allocation_order,a.id for update of g,a
  loop
    perform merchant.append_gift_card_fact(p_merchant_id,v_auth.account_id,jsonb_build_object(
      'delta',-v_auth.amount_minor_units,'amountMinorUnits',v_auth.amount_minor_units,
      'reason','redeemed','entryType','redeemed','currency',v_auth.currency,'direction','debit',
      'authorizationId',v_auth.id::text,'commandId',p_command_id::text,
      'idempotencyKey',p_idempotency_key::text,'fingerprint',p_stored_value_fingerprint,
      'operatorId',p_operator_id::text,'deviceId',p_device_id::text,
      'businessDate',p_business_date,'sourceType','pos_sale','sourceId',p_sale_id::text,
      'saleId',p_sale_id::text));
    update merchant.customer_value_authorization set status='committed',committed_at=clock_timestamp(),
      committed_value_fingerprint=p_stored_value_fingerprint,
      allocation_fingerprint=p_stored_value_fingerprint
    where id=v_auth.id and status='authorized';
    if not found then raise exception 'AUTHORIZATION_ALREADY_USED'; end if;
  end loop;

  update merchant.customer_value_authorization set
    committed_value_fingerprint=p_stored_value_fingerprint,
    allocation_fingerprint=coalesce(p_stored_value_fingerprint,allocation_fingerprint)
  where id=any(array(select jsonb_array_elements_text(
    coalesce(p_selection->'storedValueAuthorizationIds','[]'::jsonb))::uuid))
    and merchant_id=p_merchant_id and status='committed';

  insert into merchant.customer_value_tender_allocation(
    merchant_id,location_id,customer_id,sale_id,checkout_id,checkout_version,allocation_id,
    tender_type,account_id,account_public_reference,authorization_id,currency,
    requested_minor_units,authorized_minor_units,committed_minor_units,
    remaining_balance_minor_units,allocation_order,policy_id,policy_version,
    cash_allocation_minor_units,manual_terminal_allocation_minor_units,
    wallet_allocation_ids,gift_card_allocation_ids,
    authorization_expires_at,command_id,idempotency_key,optimistic_version,fingerprint)
  select a.merchant_id,a.location_id,a.customer_id,p_sale_id,d.id,a.checkout_version,a.allocation_id,
    a.account_type,a.account_id,coalesce(w.public_reference,g.public_reference),a.id,a.currency,
    a.amount_minor_units,a.amount_minor_units,a.amount_minor_units,
    case when a.account_type='wallet' then wb.available else gb.available end,
    a.allocation_order,a.account_type||'-pilot',a.policy_version,
    coalesce((select sum(t.amount_minor_units) from merchant.pos_tender_fact t
      where t.checkout_id=d.id and t.tender_type='cash'),0),
    coalesce((select sum(t.amount_minor_units) from merchant.pos_tender_fact t
      where t.checkout_id=d.id and t.tender_type='manual_terminal'),0),
    array(select selected.allocation_id from merchant.customer_value_authorization selected
      where selected.id=any(array(select jsonb_array_elements_text(
        coalesce(p_selection->'storedValueAuthorizationIds','[]'::jsonb))::uuid))
        and selected.account_type='wallet' order by selected.allocation_order,selected.id),
    array(select selected.allocation_id from merchant.customer_value_authorization selected
      where selected.id=any(array(select jsonb_array_elements_text(
        coalesce(p_selection->'storedValueAuthorizationIds','[]'::jsonb))::uuid))
        and selected.account_type='gift_card' order by selected.allocation_order,selected.id),
    a.expires_at,p_command_id,
    p_idempotency_key,a.optimistic_version,p_stored_value_fingerprint
  from merchant.customer_value_authorization a
  join merchant.pos_checkout_draft d on d.cart_id=a.sale_id and d.merchant_id=a.merchant_id
    and d.location_id=a.location_id
  left join merchant.loyalty_card w on a.account_type='wallet' and w.id=a.account_id
  left join merchant.loyalty_gift_card g on a.account_type='gift_card' and g.id=a.account_id
  left join merchant.loyalty_stored_value_balance wb on wb.card_id=a.account_id
  left join merchant.loyalty_gift_card_balance gb on gb.gift_card_id=a.account_id
  where a.id=any(array(select jsonb_array_elements_text(
    coalesce(p_selection->'storedValueAuthorizationIds','[]'::jsonb))::uuid))
  on conflict (merchant_id,sale_id,allocation_id) do nothing;

  v_result:=jsonb_set(v_result,'{storedValue}',coalesce((select jsonb_agg(jsonb_build_object(
    'authorization',jsonb_build_object('id',a.id,'accountType',a.account_type,
      'accountId',a.account_id,'customerId',a.customer_id,'currency',a.currency,
      'saleId',a.sale_id,'checkoutVersion',a.checkout_version,'amountMinorUnits',a.amount_minor_units,
      'fingerprint',a.command_fingerprint,'status',a.status,
      'remainingBalanceMinorUnits',coalesce(wb.available,gb.available,0),
      'allocationId',a.allocation_id,'allocationOrder',a.allocation_order,
      'allocationFingerprint',a.allocation_fingerprint,'createdAt',a.created_at,
      'expiresAt',a.expires_at,'correlationId',a.correlation_id),
    'ledgerEntryId',coalesce(wl.id,gl.id),'committedAt',a.committed_at)
    order by a.allocation_order,a.id)
    from merchant.customer_value_authorization a
    left join merchant.loyalty_stored_value_balance wb on a.account_type='wallet' and wb.card_id=a.account_id
    left join merchant.loyalty_gift_card_balance gb on a.account_type='gift_card' and gb.gift_card_id=a.account_id
    left join merchant.loyalty_stored_value_ledger wl on a.account_type='wallet'
      and wl.authorization_id=a.id and wl.entry_type='redeemed'
    left join merchant.loyalty_gift_card_ledger gl on a.account_type='gift_card'
      and gl.authorization_id=a.id and gl.entry_type='redeemed'
    where a.id=any(array(select jsonb_array_elements_text(
      coalesce(p_selection->'storedValueAuthorizationIds','[]'::jsonb))::uuid))),'[]'::jsonb));

  for v_funded in select value from jsonb_array_elements(
    coalesce(p_selection->'fundedGiftCards','[]'::jsonb))
  loop
    perform merchant.activate_sale_funded_gift_card(
      p_merchant_id,p_location_id,p_cart_id,p_sale_id,p_command_id,p_idempotency_key,
      p_operator_id,p_device_id,p_business_date,v_funded);
  end loop;
  return v_result;
end $$;

insert into umi.permission(key,description) values
  ('loyalty.reward.approve','Approve one exact reward preview'),
  ('customer.history.global','Read approved merchant-global customer history'),
  ('customer.history.admin','Read restricted customer administration history')
on conflict(key) do update set description=excluded.description;

grant select on merchant.customer_value_tender_allocation,merchant.gift_card_funding_assignment
  to api,worker;
grant execute on function merchant.commit_customer_value_closeout(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,text,date,uuid,uuid,text,jsonb
) to api,worker;
revoke all on function merchant.activate_sale_funded_gift_card(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,date,jsonb
) from public,api,worker,readonly;
revoke all on function merchant.commit_customer_value_closeout(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,text,date,uuid,uuid,jsonb
) from public,api,worker,readonly;
revoke all on function merchant.commit_customer_value_closeout(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,text,date,uuid,uuid,text,jsonb
) from public,readonly;

do $$
declare t text;
begin
  foreach t in array array['customer_value_tender_allocation','gift_card_funding_assignment'] loop
    execute format('alter table merchant.%I enable row level security',t);
    execute format('alter table merchant.%I force row level security',t);
    execute format('create policy %I on merchant.%I using '
      '(merchant_id=umi.current_merchant()) with check (merchant_id=umi.current_merchant())',
      t||'_merchant_scope',t);
  end loop;
end $$;

create policy customer_value_tender_location_scope
  on merchant.customer_value_tender_allocation as restrictive
  using (location_id=umi.current_location()) with check (location_id=umi.current_location());
create policy gift_card_funding_location_scope
  on merchant.gift_card_funding_assignment as restrictive
  using (location_id=umi.current_location()) with check (location_id=umi.current_location());
