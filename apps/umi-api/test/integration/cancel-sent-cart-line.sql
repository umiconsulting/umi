-- Run on a populated disposable copy after migrations 018 and 019.
-- Example: psql -v ON_ERROR_STOP=1 -d umi_cancel_line_verify_20261012 -f this_file
begin;
do $$
declare
  s runtime.operator_session%rowtype;
  template merchant.pos_cart_line%rowtype;
  cart uuid:=gen_random_uuid();
  ord uuid:=gen_random_uuid();
  item_a uuid:=gen_random_uuid();
  item_b uuid:=gen_random_uuid();
  line_a uuid:=gen_random_uuid();
  line_b uuid:=gen_random_uuid();
  ticket uuid:=gen_random_uuid();
  station uuid;
begin
  if current_database() not like '%verify%' then
    raise exception 'Use a disposable verification database';
  end if;
  select os.* into s from runtime.operator_session os
    join merchant.device d on d.id=os.device_id and d.status='active'
    join merchant.pos_cart_line l on l.merchant_id=os.merchant_id limit 1;
  if s.id is null then raise exception 'Fixture needs an operator and a product'; end if;
  select * into template from merchant.pos_cart_line where merchant_id=s.merchant_id limit 1;
  select id into station from merchant.station where merchant_id=s.merchant_id and location_id=s.location_id limit 1;
  if station is null then raise exception 'Fixture needs a kitchen station'; end if;
  update runtime.operator_session set state='active',ended_at=null,expires_at=now()+interval '1 hour',
    permissions=array['cart.write','order.fire'],
    entitlements=entitlements || '[{"featureKey":"pos","enabled":true}]'::jsonb where id=s.id;
  perform set_config('app.current_merchant',s.merchant_id::text,true);
  perform set_config('app.current_location',s.location_id::text,true);
  perform set_config('app.current_device',s.device_id::text,true);
  perform set_config('app.user_id',s.user_id::text,true);
  perform set_config('test.cart',cart::text,true);
  perform set_config('test.line_a',line_a::text,true);
  perform set_config('test.line_b',line_b::text,true);
  perform set_config('test.item_a',item_a::text,true);
  perform set_config('test.item_b',item_b::text,true);
  perform set_config('test.ticket',ticket::text,true);
  perform set_config('test.operator',s.id::text,true);
  insert into merchant.customer_order(id,merchant_id,location_id,source,fulfillment_type,business_date)
    values(ord,s.merchant_id,s.location_id,'pos','dine_in',current_date);
  insert into merchant.order_item(id,order_id,product_id,name,variant_name,quantity,unit_price,display_order,course_number)
    values(item_a,ord,template.product_id,'Same product','Small',1,100,0,1),
          (item_b,ord,template.product_id,'Same product','Large',1,200,1,2);
  insert into merchant.order_event(order_id,kind,status) values(ord,'status_changed','placed');
  update merchant.pos_cart set lifecycle_state='suspended',suspended_at=now()
    where merchant_id=s.merchant_id and location_id=s.location_id and operator_user_id=s.user_id
      and lifecycle_state in ('building_cart','ready_for_checkout','recovered');
  insert into merchant.pos_cart(id,merchant_id,location_id,operator_session_id,
    original_operator_session_id,original_operator_user_id,operator_user_id,business_date,fired_order_id)
    values(cart,s.merchant_id,s.location_id,s.id,s.id,s.user_id,s.user_id,current_date,ord);
  insert into merchant.pos_cart_line(id,merchant_id,cart_id,product_id,identity_key,product_name,
    variant_name,quantity,base_price,tax_rate_basis_points,course_number,fired_at,order_item_id)
    values(line_a,s.merchant_id,cart,template.product_id,repeat('a',64),'Same product','Small',1,100,0,1,now(),item_a),
          (line_b,s.merchant_id,cart,template.product_id,repeat('b',64),'Same product','Large',1,200,0,2,now(),item_b);
  insert into merchant.kitchen_order(id,merchant_id,location_id,source_order_id,public_reference,
    source,fulfillment_type,business_date,queued_at)
    values(ticket,s.merchant_id,s.location_id,ord,'TEST','pos','dine_in',current_date,now());
  insert into merchant.kitchen_order_item(merchant_id,location_id,kitchen_order_id,source_order_id,
    source_order_item_id,station_id,status,product_id,product_name,variant_name,quantity,display_order,route_reason,course_number)
    values(s.merchant_id,s.location_id,ticket,ord,item_a,station,'queued',template.product_id,'Same product','Small',1,0,'configured_route',1),
          (s.merchant_id,s.location_id,ticket,ord,item_b,station,'queued',template.product_id,'Same product','Large',1,1,'configured_route',2);
end $$;

-- Exercise the narrow definer as the RLS-bound application role.
insert into merchant.pos_payment_attempt
  (merchant_id,location_id,cart_id,method,amount_minor_units,currency,status,query_only,correlation_id)
  values(umi.current_merchant(),umi.current_location(),current_setting('test.cart')::uuid,
    'external_terminal',300,'MXN','unknown',true,'test-ambiguous-payment');
set local role api;
do $$
declare result text;
begin
  result:=merchant.cancel_sent_cart_line(umi.current_merchant(),umi.current_location(),
    current_setting('test.cart')::uuid,current_setting('test.line_a')::uuid,
    current_setting('test.operator')::uuid,2,'operator_mistake','test-stale');
  if result<>'rejected' then raise exception 'Stale version was accepted'; end if;
  result:=merchant.cancel_sent_cart_line(gen_random_uuid(),umi.current_location(),
    current_setting('test.cart')::uuid,current_setting('test.line_a')::uuid,
    current_setting('test.operator')::uuid,1,'operator_mistake','test-scope');
  if result<>'rejected' then raise exception 'Foreign merchant was accepted'; end if;
  result:=merchant.cancel_sent_cart_line(umi.current_merchant(),umi.current_location(),
    current_setting('test.cart')::uuid,current_setting('test.line_a')::uuid,
    current_setting('test.operator')::uuid,1,'','test-reason');
  if result<>'rejected' then raise exception 'Empty reason was accepted'; end if;
  result:=merchant.cancel_sent_cart_line(umi.current_merchant(),umi.current_location(),
    current_setting('test.cart')::uuid,current_setting('test.line_a')::uuid,
    current_setting('test.operator')::uuid,1,'operator_mistake','test-ambiguous');
  if result<>'rejected' then raise exception 'An ambiguous payment allowed cancellation'; end if;
end $$;
reset role;
delete from merchant.pos_payment_attempt where cart_id=current_setting('test.cart')::uuid;
set local role api;
do $$
declare result text;
begin
  result:=merchant.cancel_sent_cart_line(umi.current_merchant(),umi.current_location(),
    current_setting('test.cart')::uuid,current_setting('test.line_a')::uuid,
    current_setting('test.operator')::uuid,1,'operator_mistake','test-exact');
  if result<>'cancelled' then raise exception 'Queued line cancellation failed: %',result; end if;
end $$;
reset role;

do $$
begin
  if not exists(select 1 from merchant.order_item where id=current_setting('test.item_a')::uuid
    and voided_at is not null and void_reason='operator_mistake')
    then raise exception 'Commercial void and reason missing'; end if;
  if not exists(select 1 from merchant.kitchen_order_item where source_order_item_id=current_setting('test.item_a')::uuid
    and status='cancelled') then raise exception 'Exact kitchen line was not cancelled'; end if;
  if not exists(select 1 from merchant.kitchen_order_item where source_order_item_id=current_setting('test.item_b')::uuid
    and status='queued' and variant_name='Large' and course_number=2)
    then raise exception 'Another variant/course was modified'; end if;
  if not exists(select 1 from merchant.order_item where id=current_setting('test.item_b')::uuid and voided_at is null)
    then raise exception 'Another commercial line was voided'; end if;
  if not exists(select 1 from merchant.kitchen_event where correlation_id='test-exact'
    and safe_payload->>'reasonCode'='operator_mistake')
    then raise exception 'Kitchen event missing'; end if;
  update merchant.kitchen_order_item set status='preparing'
    where source_order_item_id=current_setting('test.item_b')::uuid;
end $$;
set local role api;
do $$
declare result text;
begin
  result:=merchant.cancel_sent_cart_line(umi.current_merchant(),umi.current_location(),
    current_setting('test.cart')::uuid,current_setting('test.line_b')::uuid,
    current_setting('test.operator')::uuid,1,'customer_changed','test-started');
  if result<>'preparation_started' then raise exception 'Prepared line was accepted: %',result; end if;
end $$;
reset role;
do $$
begin
  if not exists(select 1 from merchant.order_item where id=current_setting('test.item_b')::uuid and voided_at is null)
    then raise exception 'Refusal changed the commercial line'; end if;
  if exists(select 1 from merchant.kitchen_event where correlation_id='test-started')
    then raise exception 'Refusal emitted a cancellation'; end if;
end $$;
-- A routing exception has no station. Its cancellation preserves that fact.
update merchant.kitchen_order_item set status='exception',station_id=null
  where source_order_item_id=current_setting('test.item_b')::uuid;
set local role api;
do $$
declare result text;
begin
  result:=merchant.cancel_sent_cart_line(umi.current_merchant(),umi.current_location(),
    current_setting('test.cart')::uuid,current_setting('test.line_b')::uuid,
    current_setting('test.operator')::uuid,1,'customer_changed','test-unrouted');
  if result<>'cancelled' then raise exception 'Unrouted exception was refused: %',result; end if;
end $$;
reset role;
do $$
begin
  if not exists(select 1 from merchant.kitchen_order_item
    where source_order_item_id=current_setting('test.item_b')::uuid and status='cancelled' and station_id is null)
    then raise exception 'Unrouted cancellation lost its station fact'; end if;
end $$;
rollback;
