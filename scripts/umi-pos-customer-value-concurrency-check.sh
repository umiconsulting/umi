#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="umi_pos_value_race_$$"

if ! command -v psql >/dev/null 2>&1; then
  command -v docker >/dev/null 2>&1 || { echo "PostgreSQL or Docker is required." >&2; exit 1; }
  CONTAINER="umi-pos-value-race-$RANDOM"
  trap 'docker rm -f "$CONTAINER" >/dev/null 2>&1 || true' EXIT
  docker run --rm -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres \
    -v "$ROOT:$ROOT" -w "$ROOT" pgvector/pgvector:pg16 >/dev/null
  for _ in $(seq 1 30); do
    docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec -e PGHOST=/var/run/postgresql -e PGUSER=postgres "$CONTAINER" \
    bash "$ROOT/scripts/umi-pos-customer-value-concurrency-check.sh"
  exit $?
fi

cleanup() { psql -q -c "drop database if exists $DB;" >/dev/null 2>&1 || true; }
trap cleanup EXIT
UMI_POS_DB_NAME="$DB" UMI_POS_DB_KEEP=1 bash "$ROOT/scripts/umi-pos-db-check.sh" >/dev/null

psql -X -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
create schema gate3f_race;
create table gate3f_race.result(
  scenario integer not null,
  actor integer not null,
  outcome text not null,
  detail text,
  primary key(scenario,actor)
);
create function gate3f_race.id(k text,s integer) returns uuid
language sql immutable as $$select md5(k||':'||s)::uuid$$;

create function gate3f_race.prepare(s integer) returns void language plpgsql as $$
declare
  m uuid:='a0000000-0000-4000-8000-000000000001';
  l uuid:='a1000000-0000-4000-8000-000000000001';
  os uuid:='a8000000-0000-4000-8000-000000000001';
  u uuid:='a5000000-0000-4000-8000-000000000001';
  d uuid:='ad000000-0000-4000-8000-000000000001';
  c uuid:=gate3f_race.id('customer',s); p uuid:=gate3f_race.id('points',s);
  w uuid:=gate3f_race.id('wallet',s); g uuid:=gate3f_race.id('gift',s);
  cart uuid:=gate3f_race.id('cart',s); reward uuid:=gate3f_race.id('reward',s);
  auth uuid:=gate3f_race.id('auth',s); kind text; account uuid;
begin
  update runtime.operator_session set
    permissions=array['offline.replay','customer.history.read','customer.history.global',
      'customer.history.admin','customer.consent.read'],
    entitlements='[{"featureKey":"pos","enabled":true}]'
  where id=os;
  insert into merchant.customer(id,merchant_id,name,public_reference,status)
    values(c,m,'Race '||s,'CUS-RACE-'||s,'active');
  insert into merchant.loyalty_points_account(id,merchant_id,customer_id,program_reference,public_reference,status)
    values(p,m,c,'pilot','LOY-RACE-'||s,'active');
  insert into merchant.loyalty_card(id,merchant_id,customer_id,public_reference,currency,status)
    values(w,m,c,'WAL-RACE-'||s,'MXN','active');
  insert into merchant.loyalty_gift_card(id,merchant_id,location_id,code,status,public_reference,
    code_hash,masked_code,currency,amount_cents,customer_id)
    values(g,m,l,'RACE-SECRET-'||s,case when s=15 then 'inactive' else 'active' end,'GFT-RACE-'||s,
      extensions.digest('RACE-SECRET-'||s,'sha256'),'••••-RACE','MXN',100,c);
  insert into merchant.pos_cart(id,merchant_id,location_id,operator_session_id,customer_id,
    status,lifecycle_state,version,business_date,original_operator_session_id,
    original_operator_user_id,operator_user_id)
    values(cart,m,l,os,c,'committed','committed',1,current_date,os,u,u);
  if s in (15,23,24) then
    if s=15 then
      insert into merchant.pos_cart_line(id,merchant_id,cart_id,product_id,identity_key,
        product_name,quantity,base_price,tax_rate_basis_points)
      values(gate3f_race.id('line',s),m,cart,'d3000000-0000-4000-8000-000000000001',
        repeat('7',64),'Race gift card',1,100,0);
    end if;
    insert into merchant.customer_order(id,merchant_id,location_id,customer_id,source,
      fulfillment_type,status,business_date,external_ref)
    values(gate3f_race.id('order',s),m,l,c,'pos','dine_in','completed',current_date,
      'gate3f-race-'||s);
    insert into merchant.pos_payment_attempt(id,merchant_id,location_id,cart_id,method,
      amount_minor_units,currency,status,query_only,correlation_id)
    values(gate3f_race.id('payment',s),m,l,cart,'cash',100,'MXN','succeeded',false,
      'gate3f-race-'||s);
    insert into merchant.receipt_snapshot(id,merchant_id,location_id,order_id,payment_attempt_id,
      receipt_number,business_date,currency,grand_total,snapshot)
    values(gate3f_race.id('receipt',s),m,l,gate3f_race.id('order',s),
      gate3f_race.id('payment',s),'RACE-'||s,current_date,'MXN',100,'{}');
    insert into merchant.pos_committed_sale(id,merchant_id,location_id,cart_id,order_id,
      payment_attempt_id,receipt_snapshot_id,totals_fingerprint)
    values(gate3f_race.id('sale',s),m,l,cart,gate3f_race.id('order',s),
      gate3f_race.id('payment',s),gate3f_race.id('receipt',s),repeat('3',64));
  end if;
  insert into merchant.loyalty_reward(id,merchant_id,name,type,value,points_cost,public_reference)
    values(reward,m,'Race reward '||s,'manual',100,100,'REW-RACE-'||s);
  perform merchant.append_loyalty_points(m,c,p,'points_earn_committed','credit',100,
    'race_seed',gate3f_race.id('ps',s),null,null,null,null,u,d,
    gate3f_race.id('pc',s),gate3f_race.id('pk',s),repeat('a',64),current_date);
  perform merchant.append_stored_value_fact(m,w,jsonb_build_object(
    'delta',100,'amountMinorUnits',100,'reason','loaded','entryType','loaded','currency','MXN',
    'direction','credit','commandId',gate3f_race.id('wc',s)::text,
    'idempotencyKey',gate3f_race.id('wk',s)::text,'fingerprint',repeat('b',64),
    'operatorId',u::text,'deviceId',d::text,'businessDate',current_date,
    'sourceType','race_seed','sourceId',s::text));
  if s<>15 then
    perform merchant.append_gift_card_fact(m,g,jsonb_build_object(
      'delta',100,'amountMinorUnits',100,'reason','issued','entryType','issued','currency','MXN',
      'direction','credit','commandId',gate3f_race.id('gc',s)::text,
      'idempotencyKey',gate3f_race.id('gk',s)::text,'fingerprint',repeat('c',64),
      'operatorId',u::text,'deviceId',d::text,'businessDate',current_date,
      'sourceType','race_seed','sourceId',s::text));
  end if;
  if s=15 then
    update merchant.loyalty_gift_card set issuance_source='sale',
      pending_funding_cart_id=cart,pending_funding_minor_units=100,
      pending_funding_assignment_id=gate3f_race.id('assignment',s),
      pending_funding_line_id=gate3f_race.id('line',s),pending_funding_fingerprint=repeat('9',64),
      issuance_command_id=gate3f_race.id('issuance-command',s),
      issuance_fingerprint=repeat('8',64),issuance_policy_version='pilot-v1',
      issuer_operator_id=u,issuer_device_id=d
    where id=g;
  end if;
  if s in (23,24) then
    insert into merchant.loyalty_earn_preview(
      merchant_id,location_id,cart_id,customer_id,account_id,checkout_version,
      customer_attachment_version,loyalty_program_id,loyalty_policy_version,
      loyalty_policy_fingerprint,checkout_fingerprint,preview_fingerprint,input_fingerprint,
      gross_eligible_minor_units,excluded_minor_units,final_eligible_minor_units,expected_points,
      earn_status,explanation_codes,effective_rules,business_date,expires_at)
    select m,l,cart,c,p,1,1,program.merchant_id,'pilot-v1',repeat('7',64),repeat('3',64),
      encode(extensions.digest('preview:'||s,'sha256'),'hex'),repeat('2',64),
      100,0,100,10,'immediate',array['eligible_sale'],
      jsonb_build_object('pointsPerUnit',1,'moneyUnitMinorUnits',10,'rounding','floor'),
      current_date,clock_timestamp()+interval '5 minutes'
    from merchant.loyalty_program program where program.merchant_id=m;
    insert into merchant.pos_exception_preview(
      id,merchant_id,location_id,sale_id,original_receipt_id,operator_session_id,device_id,
      exception_type,reason_code,selection,line_allocations,tender_allocations,allocation_policy,
      restock_intents,merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,
      total_minor_units,remaining_after_minor_units,currency,approval_required,sale_version,
      exception_version,preview_fingerprint,correlation_id,expires_at)
    values(gate3f_race.id('exception-preview',s),m,l,gate3f_race.id('sale',s),
      gate3f_race.id('receipt',s),os,d,'partial_refund','customer_request','[]','[]','[]',
      'proportional','[]',50,0,0,0,50,50,'MXN',false,1,0,repeat('5',64),
      'race-refund-'||s,clock_timestamp()+interval '5 minutes');
  end if;
  if s in (4,5,6,24) then kind:='loyalty_reward'; account:=p;
  elsif s in (10,11,12) then kind:='wallet'; account:=w;
  elsif s in (16,17) then kind:='gift_card'; account:=g;
  else return; end if;
  insert into merchant.customer_value_authorization(id,merchant_id,location_id,account_type,
    account_id,customer_id,reward_id,sale_id,checkout_version,points,benefit_minor_units,
    amount_minor_units,currency,checkout_fingerprint,policy_version,reward_version,command_id,
    idempotency_key,command_fingerprint,status,expires_at,correlation_id,operator_id,device_id,
    credential_version)
  values(auth,m,l,kind,account,c,case when kind='loyalty_reward' then reward end,cart,1,
    case when kind='loyalty_reward' then 100 end,case when kind='loyalty_reward' then 100 end,
    case when kind<>'loyalty_reward' then 100 end,case when kind<>'loyalty_reward' then 'MXN' end,
    case when s=24 then encode(extensions.digest('preview:'||s,'sha256'),'hex')
      else repeat('d',64) end,'pilot-v1',
    case when kind='loyalty_reward' then 1 end,
    gate3f_race.id('ac',s),gate3f_race.id('ak',s),repeat('e',64),'authorized',
    case when s in (4,5,10,11,16) then clock_timestamp()-interval '1 second'
      else clock_timestamp()+interval '5 minutes' end,'race-'||s,u,d,1);
  if kind='loyalty_reward' then
    perform merchant.append_loyalty_points(m,c,p,'points_authorized','hold',100,
      'reward_authorization',auth,null,null,reward,auth,u,d,
      gate3f_race.id('hc',s),gate3f_race.id('hk',s),repeat('f',64),current_date);
  elsif kind='wallet' then
    perform merchant.append_stored_value_fact(m,w,jsonb_build_object(
      'delta',0,'amountMinorUnits',100,'reason','authorized','entryType','authorized',
      'currency','MXN','direction','hold','authorizationId',auth::text,
      'commandId',gate3f_race.id('hc',s)::text,'idempotencyKey',gate3f_race.id('hk',s)::text,
      'fingerprint',repeat('f',64),'operatorId',u::text,'deviceId',d::text,
      'businessDate',current_date,'sourceType','race_auth','sourceId',auth::text));
  else
    perform merchant.append_gift_card_fact(m,g,jsonb_build_object(
      'delta',0,'amountMinorUnits',100,'reason','authorized','entryType','authorized',
      'currency','MXN','direction','hold','authorizationId',auth::text,
      'commandId',gate3f_race.id('hc',s)::text,'idempotencyKey',gate3f_race.id('hk',s)::text,
      'fingerprint',repeat('f',64),'operatorId',u::text,'deviceId',d::text,
      'businessDate',current_date,'sourceType','race_auth','sourceId',auth::text));
  end if;
end$$;

create function gate3f_race.points(s integer,a integer,e text,direction text) returns uuid
language sql as $$select merchant.append_loyalty_points(
  'a0000000-0000-4000-8000-000000000001',gate3f_race.id('customer',s),
  gate3f_race.id('points',s),e,direction,100,'race',gate3f_race.id('src-'||a,s),
  null,null,gate3f_race.id('reward',s),
  case when e in ('points_redeemed','points_released') then gate3f_race.id('auth',s) end,
  'a5000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000001',
  gate3f_race.id('cmd-'||a,s),gate3f_race.id('key-'||a,s),
  repeat(case when a=1 then '1' else '2' end,64),current_date)$$;

create function gate3f_race.value(s integer,a integer,kind text,e text,direction text,
  delta integer,uses_auth boolean default false) returns uuid language plpgsql as $$
declare account uuid:=gate3f_race.id(case when kind='wallet' then 'wallet' else 'gift' end,s);
  fact jsonb:=jsonb_build_object('delta',delta,'amountMinorUnits',100,'reason',e,'entryType',e,
    'currency','MXN','direction',direction,'authorizationId',
    case when uses_auth then gate3f_race.id('auth',s)::text else '' end,
    'commandId',gate3f_race.id('cmd-'||a,s)::text,'idempotencyKey',gate3f_race.id('key-'||a,s)::text,
    'fingerprint',repeat(case when a=1 then '3' else '4' end,64),
    'operatorId','a5000000-0000-4000-8000-000000000001',
    'deviceId','ad000000-0000-4000-8000-000000000001','businessDate',current_date,
    'sourceType','race','sourceId',s::text);
begin
  if kind='wallet' then return merchant.append_stored_value_fact(
    'a0000000-0000-4000-8000-000000000001',account,fact); end if;
  return merchant.append_gift_card_fact('a0000000-0000-4000-8000-000000000001',account,fact);
end$$;

create function gate3f_race.finish(s integer,a integer,terminal text,e text,direction text)
returns text language plpgsql as $$
declare auth merchant.customer_value_authorization%rowtype;
begin
  select * into auth from merchant.customer_value_authorization
    where id=gate3f_race.id('auth',s) for update;
  if auth.status<>'authorized' then
    return case when auth.status='committed' then 'AlreadyCommitted' else initcap(auth.status) end;
  end if;
  if terminal='committed' and auth.expires_at<=clock_timestamp() then return 'AuthorizationExpired'; end if;
  if auth.account_type='loyalty_reward' then perform gate3f_race.points(s,a,e,direction);
  else perform gate3f_race.value(s,a,auth.account_type,e,direction,0,true); end if;
  update merchant.customer_value_authorization set status=terminal,
    committed_at=case when terminal='committed' then clock_timestamp() end,
    released_at=case when terminal in ('released','expired') then clock_timestamp() end
    where id=auth.id and status='authorized';
  return initcap(terminal);
end$$;

create function gate3f_race.checkout_customer_value(s integer) returns text language plpgsql as $$
declare result jsonb; selection jsonb;
begin
  selection:=jsonb_build_object(
    'previewFingerprint',encode(extensions.digest('preview:'||s,'sha256'),'hex'),
    'storedValueFingerprint',repeat('4',64),
    'rewardAuthorizationId',case when s=24 then gate3f_race.id('auth',s)::text end,
    'rewardApprovalId',null,'storedValueAuthorizationIds','[]'::jsonb,
    'fundedGiftCards','[]'::jsonb);
  result:=merchant.commit_customer_value_closeout(
    'a0000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',gate3f_race.id('cart',s),
    gate3f_race.id('sale',s),gate3f_race.id('order',s),gate3f_race.id('customer',s),
    gate3f_race.id('checkout-command',s),gate3f_race.id('checkout-key',s),
    encode(extensions.digest('preview:'||s,'sha256'),'hex'),1,
    repeat('3',64),current_date,'a5000000-0000-4000-8000-000000000001',
    'ad000000-0000-4000-8000-000000000001',repeat('4',64),selection);
  return case when s=24 then 'CommittedReward' else 'CommittedEarn' end;
end$$;

create function gate3f_race.refund_customer_value(s integer) returns text language plpgsql as $$
declare result jsonb;
begin
  insert into merchant.pos_sale_exception(
    id,merchant_id,location_id,sale_id,original_receipt_id,preview_id,exception_type,status,
    reason_code,operator_id,operator_session_id,device_id,device_credential_version,
    command_id,idempotency_key,command_fingerprint,preview_fingerprint,
    merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,total_minor_units,
    currency,business_date,correlation_id)
  values(gate3f_race.id('exception',s),'a0000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',gate3f_race.id('sale',s),
    gate3f_race.id('receipt',s),gate3f_race.id('exception-preview',s),'partial_refund','committed',
    'customer_request','a5000000-0000-4000-8000-000000000001',
    'a8000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000001',1,
    gate3f_race.id('refund-command',s),gate3f_race.id('refund-key',s),repeat('4',64),
    repeat('5',64),50,0,0,0,50,'MXN',current_date,'race-refund-'||s);
  result:=merchant.reverse_customer_value(
    'a0000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',gate3f_race.id('sale',s),
    gate3f_race.id('exception',s),gate3f_race.id('reverse-command',s),
    gate3f_race.id('reverse-key',s),repeat('5',64),current_date,
    'a5000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000001');
  return 'PartialRefund';
end$$;

create function gate3f_race.action(s integer,a integer) returns text language plpgsql as $$
declare o text:='Committed'; state text; fact uuid; cursor_at timestamptz;
  cursor_type text; cursor_id uuid; next_id uuid;
begin
  set local lock_timeout='3s';
  perform set_config('app.current_merchant','a0000000-0000-4000-8000-000000000001',true);
  perform set_config('app.current_location','a1000000-0000-4000-8000-000000000001',true);
  perform set_config('app.current_device','ad000000-0000-4000-8000-000000000001',true);
  perform set_config('app.user_id','a5000000-0000-4000-8000-000000000001',true);
  if s=1 then perform gate3f_race.points(s,a,'points_authorized','hold'); o:='Authorized';
  elsif s in (2,3) then
    if a=1 then perform gate3f_race.points(s,a,'points_authorized','hold'); o:='Authorized';
    else perform gate3f_race.points(s,a,case when s=2 then 'manual_points_adjustment' else 'points_reversed' end,'debit'); end if;
  elsif s=4 then o:=gate3f_race.finish(s,a,case when a=1 then 'expired' else 'committed' end,
    case when a=1 then 'points_released' else 'points_redeemed' end,case when a=1 then 'release' else 'debit' end);
  elsif s=5 then o:=gate3f_race.finish(s,a,case when a=1 then 'released' else 'expired' end,'points_released','release');
  elsif s=6 then o:=gate3f_race.finish(s,a,'committed','points_redeemed','debit');
  elsif s in (7,13) then perform gate3f_race.value(s,a,case when s=7 then 'wallet' else 'gift_card' end,'authorized','hold',0); o:='Authorized';
  elsif s in (8,9) then
    if a=1 then perform gate3f_race.value(s,a,'wallet','authorized','hold',0); o:='Authorized';
    else perform gate3f_race.value(s,a,'wallet',case when s=8 then 'refunded' else 'adjustment_decrease' end,
      case when s=8 then 'credit' else 'debit' end,case when s=8 then 100 else -100 end); end if;
  elsif s=10 then o:=gate3f_race.finish(s,a,case when a=1 then 'expired' else 'committed' end,
    case when a=1 then 'authorization_released' else 'redeemed' end,case when a=1 then 'release' else 'debit' end);
  elsif s=11 then o:=gate3f_race.finish(s,a,case when a=1 then 'released' else 'expired' end,'authorization_released','release');
  elsif s=12 then o:=gate3f_race.finish(s,a,'committed','redeemed','debit');
  elsif s=14 then
    perform 1 from merchant.loyalty_gift_card where id=gate3f_race.id('gift',s) for update;
    select status into state from merchant.loyalty_gift_card where id=gate3f_race.id('gift',s);
    if a=1 then
      if state<>'active' then raise exception 'ACCOUNT_SUSPENDED'; end if;
      perform gate3f_race.value(s,a,'gift_card','authorized','hold',0); o:='Authorized';
    else update merchant.loyalty_gift_card set status='suspended' where id=gate3f_race.id('gift',s); o:='AccountSuspended'; end if;
  elsif s=15 then
    perform 1 from merchant.loyalty_gift_card where id=gate3f_race.id('gift',s) for update;
    select status into state from merchant.loyalty_gift_card where id=gate3f_race.id('gift',s);
    if a=1 then
      perform merchant.activate_sale_funded_gift_card(
        'a0000000-0000-4000-8000-000000000001',
        'a1000000-0000-4000-8000-000000000001',gate3f_race.id('cart',s),
        gate3f_race.id('sale',s),gate3f_race.id('fund-command',s),
        gate3f_race.id('fund-key',s),'a5000000-0000-4000-8000-000000000001',
        'ad000000-0000-4000-8000-000000000001',current_date,
        jsonb_build_object('assignmentId',gate3f_race.id('assignment',s),'giftCardId',
          gate3f_race.id('gift',s),'saleLineId',gate3f_race.id('line',s),'purchasedValue',
          jsonb_build_object('minorUnits',100,'currency','MXN'),'policyId',
          'gift-card-sale-funding','policyVersion','pilot-v1','fingerprint',repeat('9',64)));
      o:='Activated';
    elsif state<>'active' then raise exception 'ACCOUNT_SUSPENDED';
    else perform gate3f_race.value(s,a,'gift_card','redeemed','debit',-100); end if;
  elsif s=16 then o:=gate3f_race.finish(s,a,case when a=1 then 'expired' else 'committed' end,
    case when a=1 then 'authorization_released' else 'redeemed' end,case when a=1 then 'release' else 'debit' end);
  elsif s=17 then o:=gate3f_race.finish(s,a,'committed','redeemed','debit');
  elsif s=18 then perform gate3f_race.value(s,a,'gift_card',case when a=1 then 'refunded' else 'redeemed' end,
    case when a=1 then 'credit' else 'debit' end,case when a=1 then 100 else -100 end);
  elsif s between 19 and 22 then
    perform 1 from merchant.customer where id=gate3f_race.id('customer',s) for update;
    select status into state from merchant.customer where id=gate3f_race.id('customer',s);
    if a=1 then
      if exists(select 1 from merchant.customer_value_authorization
        where customer_id=gate3f_race.id('customer',s) and status='authorized')
        or (s=20 and exists(select 1 from merchant.loyalty_card
          where customer_id=gate3f_race.id('customer',s) and status<>'closed'))
        or (s=21 and exists(select 1 from merchant.loyalty_gift_card
          where customer_id=gate3f_race.id('customer',s) and status<>'closed'))
      then raise exception 'CUSTOMER_MERGE_CONFLICT'; end if;
      update merchant.customer set status='merged',version=version+1
        where id=gate3f_race.id('customer',s); o:='Merged';
    elsif state<>'active' then raise exception 'CUSTOMER_MERGE_CONFLICT';
    elsif s=19 then
      insert into merchant.customer_value_authorization(id,merchant_id,location_id,account_type,
        account_id,customer_id,reward_id,sale_id,checkout_version,points,benefit_minor_units,
        checkout_fingerprint,policy_version,reward_version,command_id,idempotency_key,
        command_fingerprint,status,expires_at,correlation_id)
      values(gate3f_race.id('merge-auth',s),'a0000000-0000-4000-8000-000000000001',
        'a1000000-0000-4000-8000-000000000001','loyalty_reward',gate3f_race.id('points',s),
        gate3f_race.id('customer',s),gate3f_race.id('reward',s),gate3f_race.id('cart',s),1,
        100,100,repeat('8',64),'pilot-v1',1,gate3f_race.id('merge-auth-command',s),
        gate3f_race.id('merge-auth-key',s),repeat('9',64),'authorized',
        clock_timestamp()+interval '5 minutes','merge-race');
      perform gate3f_race.points(s,a,'points_authorized','hold'); o:='Authorized';
    elsif s=20 then perform gate3f_race.value(s,a,'wallet','adjustment_increase','credit',100);
    elsif s=21 then perform gate3f_race.value(s,a,'gift_card','loaded','credit',100);
    else insert into merchant.customer_consent_history(merchant_id,customer_id,consent_type,status,source,policy_version,command_id)
      values('a0000000-0000-4000-8000-000000000001',gate3f_race.id('customer',s),'receipt_delivery','denied','pos_operator','race-v1',gate3f_race.id('consent',s)); o:='ConsentRecorded'; end if;
  elsif s=23 then
    if a=1 then o:=gate3f_race.checkout_customer_value(s);
    else o:=gate3f_race.refund_customer_value(s); end if;
  elsif s=24 then
    if a=1 then o:=gate3f_race.checkout_customer_value(s);
    else o:=gate3f_race.refund_customer_value(s); end if;
  elsif s=25 then
    fact:=merchant.append_stored_value_fact('a0000000-0000-4000-8000-000000000001',gate3f_race.id('wallet',s),
      jsonb_build_object('delta',-100,'amountMinorUnits',100,'reason','redeemed','entryType','redeemed','currency','MXN','direction','debit',
      'commandId',gate3f_race.id('lost-command',s)::text,'idempotencyKey',gate3f_race.id('lost-key',s)::text,'fingerprint',repeat('9',64),
      'operatorId','a5000000-0000-4000-8000-000000000001','deviceId','ad000000-0000-4000-8000-000000000001',
      'businessDate',current_date,'sourceType','lost_response','sourceId',s::text)); o:='AlreadyCommitted:'||fact::text;
  else
    if a=1 then
      select occurred_at,event_type,event_id into cursor_at,cursor_type,cursor_id
        from merchant.read_customer_history_event_scoped(
          'a0000000-0000-4000-8000-000000000001',gate3f_race.id('customer',s),
          'a8000000-0000-4000-8000-000000000001')
        where customer_id=gate3f_race.id('customer',s)
        order by occurred_at desc,event_type desc,event_id desc limit 1;
      perform pg_sleep(0.15);
      select event_id into next_id from merchant.read_customer_history_event_scoped(
        'a0000000-0000-4000-8000-000000000001',gate3f_race.id('customer',s),
        'a8000000-0000-4000-8000-000000000001')
        where customer_id=gate3f_race.id('customer',s)
          and (occurred_at,event_type,event_id)<(cursor_at,cursor_type,cursor_id)
        order by occurred_at desc,event_type desc,event_id desc limit 1;
      if next_id=cursor_id then raise exception 'CURSOR_DUPLICATE'; end if;
      o:='StableCursor';
    else perform gate3f_race.points(s,a,'manual_points_adjustment','credit'); o:='Appended'; end if;
  end if;
  insert into gate3f_race.result values(s,a,o,fact::text); return o;
exception when others then
  o:=case when sqlerrm like '%INSUFFICIENT%' or sqlerrm like '%check constraint%' then 'BalanceChanged'
    when sqlerrm like '%EXPIRED%' then 'AuthorizationExpired'
    when sqlerrm like '%MERGE%' then 'CustomerMergeConflict'
    when sqlerrm like '%SUSPENDED%' then 'AccountSuspended'
    when sqlerrm like '%duplicate key%' then 'AuthorizationConflict'
    else 'TerminalConflict:'||sqlstate end;
  insert into gate3f_race.result values(s,a,o,sqlerrm); return o;
end$$;
SQL

SCENARIOS=(two_reward_authorizations reward_authorization_vs_points_decrease
  reward_authorization_vs_points_reversal reward_expiry_vs_commit reward_release_vs_expiry
  two_reward_commits two_wallet_authorizations wallet_authorization_vs_refund
  wallet_authorization_vs_adjustment wallet_expiry_vs_commit wallet_release_vs_expiry
  two_wallet_commits two_gift_authorizations gift_authorization_vs_suspension
  gift_activation_vs_redemption gift_expiry_vs_commit two_gift_commits
  gift_refund_vs_redemption merge_vs_reward_authorization merge_vs_wallet_mutation
  merge_vs_gift_mutation consent_vs_merge points_earn_vs_refund_reversal
  reward_redemption_vs_partial_refund lost_response_retries history_page_vs_append)

fail=0
for scenario in $(seq 1 26); do
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -c "select gate3f_race.prepare($scenario);" >/dev/null
  gate=$((930000 + scenario))
  psql -X -q -d "$DB" -c "select pg_advisory_lock($gate); select pg_sleep(.20); select pg_advisory_unlock($gate);" >/dev/null 2>&1 & coordinator=$!
  sleep .03
  for actor in 1 2; do
    psql -X -q -t -A -d "$DB" -c "select pg_advisory_lock($gate); select pg_advisory_unlock($gate); select gate3f_race.action($scenario,$actor);" >/tmp/umi-g3f-$scenario-$actor-$$ 2>&1 &
    eval "pid_$actor=$!"
  done
  wait "$coordinator"; wait "$pid_1" || true; wait "$pid_2" || true
  result=$(psql -X -q -t -A -F '|' -d "$DB" -c "with ok as (select
    (select count(*)=2 from gate3f_race.result where scenario=$scenario) terminal,
    not exists(select 1 from merchant.loyalty_points_balance where account_id=gate3f_race.id('points',$scenario) and (available<0 or authorized<0)) points,
    not exists(select 1 from merchant.loyalty_stored_value_balance where card_id=gate3f_race.id('wallet',$scenario) and (available<0 or authorized<0)) wallet,
    not exists(select 1 from merchant.loyalty_gift_card_balance where gift_card_id=gate3f_race.id('gift',$scenario) and (available<0 or authorized<0)) gift,
    not exists(select 1 from merchant.loyalty_points_ledger where account_id=gate3f_race.id('points',$scenario) group by sequence having count(*)>1) ps,
    not exists(select 1 from merchant.loyalty_stored_value_ledger where card_id=gate3f_race.id('wallet',$scenario) group by sequence having count(*)>1) ws,
    not exists(select 1 from merchant.loyalty_gift_card_ledger where gift_card_id=gate3f_race.id('gift',$scenario) group by sequence having count(*)>1) gs)
    select string_agg(actor||':'||outcome,',' order by actor),bool_and(terminal and points and wallet and gift and ps and ws and gs
      and coalesce((select (b.pending,b.available,b.authorized,b.redeemed,b.reversed,b.adjusted)=
        (coalesce(sum(case when l.entry_type='points_earn_pending' then l.points when l.entry_type='points_earn_cancelled' then -l.points else 0 end),0),
         coalesce(sum(case when l.entry_type in ('points_earn_pending','points_earn_cancelled') then 0 when l.entry_type='points_redeemed' and l.authorization_id is not null then 0 when l.direction='credit' then l.points when l.direction in ('debit','hold') then -l.points when l.direction='release' then l.points else 0 end),0),
         coalesce(sum(case when l.direction='hold' then l.points when l.direction in ('release','debit') and l.authorization_id is not null then -l.points else 0 end),0),
         coalesce(sum(l.points) filter(where l.entry_type='points_redeemed'),0),
         coalesce(sum(l.points) filter(where l.entry_type='points_reversed'),0),
         coalesce(sum(case when l.entry_type='manual_points_adjustment' and l.direction='credit' then l.points when l.entry_type='manual_points_adjustment' then -l.points else 0 end),0))
        from merchant.loyalty_points_balance b join merchant.loyalty_points_ledger l on l.account_id=b.account_id
        where b.account_id=gate3f_race.id('points',$scenario) group by b.account_id),true)
      and coalesce((select (b.available,b.authorized,b.redeemed,b.refunded,b.ledger_sequence)=
        (coalesce(sum(case when l.entry_type='authorized' then -l.amount_minor_units when l.entry_type='authorization_released' then l.amount_minor_units when l.entry_type='redeemed' and l.authorization_id is not null then 0 else l.delta end),0),
         coalesce(sum(case when l.entry_type='authorized' then l.amount_minor_units when l.entry_type in ('authorization_released','redeemed') and l.authorization_id is not null then -l.amount_minor_units else 0 end),0),
         coalesce(sum(l.amount_minor_units) filter(where l.entry_type='redeemed'),0),
         coalesce(sum(l.amount_minor_units) filter(where l.entry_type='refunded'),0),max(l.sequence))
        from merchant.loyalty_stored_value_balance b join merchant.loyalty_stored_value_ledger l on l.card_id=b.card_id
        where b.card_id=gate3f_race.id('wallet',$scenario) group by b.card_id),true)
      and coalesce((select (b.available,b.authorized,b.redeemed,b.refunded,b.ledger_sequence)=
        (coalesce(sum(case when l.entry_type='authorized' then -l.amount_minor_units when l.entry_type='authorization_released' then l.amount_minor_units when l.entry_type='redeemed' and l.authorization_id is not null then 0 else l.delta end),0),
         coalesce(sum(case when l.entry_type='authorized' then l.amount_minor_units when l.entry_type in ('authorization_released','redeemed') and l.authorization_id is not null then -l.amount_minor_units else 0 end),0),
         coalesce(sum(l.amount_minor_units) filter(where l.entry_type='redeemed'),0),
         coalesce(sum(l.amount_minor_units) filter(where l.entry_type='refunded'),0),max(l.sequence))
        from merchant.loyalty_gift_card_balance b join merchant.loyalty_gift_card_ledger l on l.gift_card_id=b.gift_card_id
        where b.gift_card_id=gate3f_race.id('gift',$scenario) group by b.gift_card_id),true)
      and ($scenario<>15 or (select count(*)=1 from merchant.gift_card_funding_assignment where gift_card_id=gate3f_race.id('gift',$scenario)))
      and ($scenario not in (23,24) or ((select count(*)=1 from merchant.pos_committed_sale where id=gate3f_race.id('sale',$scenario)) and (select count(*)=1 from merchant.pos_sale_exception where sale_id=gate3f_race.id('sale',$scenario))))
      and coalesce((select ledger_sequence=(select coalesce(max(sequence),0) from merchant.loyalty_points_ledger where account_id=gate3f_race.id('points',$scenario)) from merchant.loyalty_points_balance where account_id=gate3f_race.id('points',$scenario)),true)
      and coalesce((select ledger_sequence=(select coalesce(max(sequence),0) from merchant.loyalty_stored_value_ledger where card_id=gate3f_race.id('wallet',$scenario)) from merchant.loyalty_stored_value_balance where card_id=gate3f_race.id('wallet',$scenario)),true)
      and coalesce((select ledger_sequence=(select coalesce(max(sequence),0) from merchant.loyalty_gift_card_ledger where gift_card_id=gate3f_race.id('gift',$scenario)) from merchant.loyalty_gift_card_balance where gift_card_id=gate3f_race.id('gift',$scenario)),true))
    from gate3f_race.result cross join ok where scenario=$scenario;")
  rm -f /tmp/umi-g3f-$scenario-1-$$ /tmp/umi-g3f-$scenario-2-$$
  if [ "${result##*|}" = t ]; then printf 'PASS %02d %-43s %s\n' "$scenario" "${SCENARIOS[$((scenario-1))]}" "${result%|*}";
  else printf 'FAIL %02d %-43s %s\n' "$scenario" "${SCENARIOS[$((scenario-1))]}" "$result"; fail=1; fi
done
summary=$(psql -X -q -t -A -d "$DB" -c "select count(distinct scenario)||' scenarios, '||count(*)||' terminal results' from gate3f_race.result;")
echo "Gate 3F real PostgreSQL concurrency: $summary"
exit "$fail"
