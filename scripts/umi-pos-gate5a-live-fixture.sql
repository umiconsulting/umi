\set ON_ERROR_STOP on

-- Gate 5A live certification fixture.
-- Run this file only in the disposable database that the certification script creates.

begin;

insert into umi.feature(id,key,module,name,description,kind) values
  ('e0000000-0000-4000-8000-000000000101','dashboard','dashboard','Dashboard','Live certification dashboard','flag'),
  ('e0000000-0000-4000-8000-000000000102','pos','pos','POS','Live certification POS','flag'),
  ('e0000000-0000-4000-8000-000000000103','kds','kds','KDS','Live certification KDS','flag')
on conflict(key) do nothing;

insert into umi.plan(id,key,name,description,is_public,status) values
  ('e1000000-0000-4000-8000-000000000101','live-cert','Live Certification',
   'Disposable certification plan',false,'active')
on conflict(key) do nothing;

insert into umi.plan_feature(plan_id,feature_id)
select 'e1000000-0000-4000-8000-000000000101'::uuid,id
from umi.feature where key in ('dashboard','pos','kds','pos.offline_cash')
on conflict do nothing;

insert into umi.subscription(
  id,merchant_id,plan_id,status,current_period_start,current_period_end
) values(
  'e2000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000101',
  'e1000000-0000-4000-8000-000000000101','active',now(),now()+interval '30 days'
)
on conflict(merchant_id) do update set
  plan_id=excluded.plan_id,status='active',current_period_end=excluded.current_period_end;

update umi.user set
  password_algorithm='scrypt-sha256-v1',
  password_salt=case email
    when 'owner@umipos.local' then '00112233445566778899aabbccddeeff'
    when 'admin@umipos.local' then '30112233445566778899aabbccddeeff'
    when 'manager@umipos.local' then '10112233445566778899aabbccddeeff'
    when 'viewer@umipos.local' then '20112233445566778899aabbccddeeff'
  end,
  password_hash=case email
    when 'owner@umipos.local' then 'a44571d6daf933e5aba65848fa054703a7c0d11fbfab1a3b82846c95a7c31b37f09403a7a413cf31a67eb62478e0b2b7248523dd85ad285478eab7b2a9a3056d'
    when 'admin@umipos.local' then 'bd605419345763f6da9d8aabaae31e6f8d9d6414973b5abd4596885a6cad95845e647208cbe266da4a0d5bc24c2fdb697bc768a88aba0715acda0ecac123a364'
    when 'manager@umipos.local' then '8901270e6f79c46bad9e9d194754cb132f79e513d4e1e623f4df8bf496df1a14ad58a8804adbc59de60ca1d8ed9804a3140934f30a6939dfde614a0acf186fb0'
    when 'viewer@umipos.local' then '776b4847118e1d6d68d6697881ca0cc451ed0b425e954c6b1690621549edbcb4a301ae8d8cbb650365b37c899efa8ad7f39bc39c819fe0fd5c22abee2af20334'
  end
where email in (
  'owner@umipos.local','admin@umipos.local','manager@umipos.local','viewer@umipos.local'
);

do $$
begin
  if not exists (
    select 1 from merchant.loyalty_points_balance
     where account_id='71000000-0000-4000-8000-000000000102'::uuid
  ) then
    perform merchant.append_loyalty_points(
      '10000000-0000-4000-8000-000000000101',
      '71000000-0000-4000-8000-000000000101',
      '71000000-0000-4000-8000-000000000102',
      'manual_points_adjustment','credit',1000,'live_cert_fixture',
      '71000000-0000-4000-8000-000000000120',null,null,null,null,
      '30000000-0000-4000-8000-000000000200',null,
      '71000000-0000-4000-8000-000000000121',
      '71000000-0000-4000-8000-000000000122',repeat('a',64),current_date
    );
  end if;
end $$;

insert into merchant.location(id,merchant_id,name,address,timezone,status) values(
  '20000000-0000-4000-8000-000000000102',
  '10000000-0000-4000-8000-000000000101',
  'Sucursal B','Fixture aislada','America/Mexico_City','active'
)
on conflict(id) do update set name=excluded.name,status='active';

update merchant.device set
  name='POS Simulado Gate 5A',status='active',kind='pos_terminal',
  installation_hash=encode(extensions.digest(
    '67000000-0000-4000-8000-000000000102','sha256'
  ),'hex'),
  credential_hash=encode(extensions.digest('gate5a-live-device-credential','sha256'),'hex'),
  credential_version=1,revoked_at=null,revocation_reason=null,last_seen_at=now()
where id='67000000-0000-4000-8000-000000000101';

insert into runtime.session(
  id,merchant_id,principal_type,principal_id,token_hash,is_active,expires_at,device_name
) values(
  '81000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000101','user',
  '30000000-0000-4000-8000-000000000200',repeat('8',64),true,
  now()+interval '30 days','Fixture sale session'
);

insert into runtime.operator_session(
  id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,
  state,permissions,entitlements,expires_at
) values(
  '82000000-0000-4000-8000-000000000101',
  '81000000-0000-4000-8000-000000000101',
  '30000000-0000-4000-8000-000000000200',
  '40000000-0000-4000-8000-000000000200',
  '67000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101','active',array['*'],
  '[{"featureKey":"pos","enabled":true}]',now()+interval '30 days'
);

insert into merchant.cash_shift(
  id,merchant_id,location_id,register_id,device_id,device_credential_version,
  opening_operator_id,responsible_operator_id,operator_session_id,currency,
  business_date,status,opening_command_id,opening_float_minor_units,ledger_sequence,version
) values(
  '83000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '57000000-0000-4000-8000-000000000101',
  '67000000-0000-4000-8000-000000000101',1,
  '30000000-0000-4000-8000-000000000200',
  '30000000-0000-4000-8000-000000000200',
  '82000000-0000-4000-8000-000000000101','MXN',
  (now() at time zone 'America/Mazatlan')::date,'open',
  '83000000-0000-4000-8000-000000000102',100000,0,1
);

insert into merchant.cash_ledger_entry(
  id,merchant_id,location_id,register_id,shift_id,sequence,entry_type,
  amount_minor_units,currency,command_id,business_date
) values(
  '83000000-0000-4000-8000-000000000103',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '57000000-0000-4000-8000-000000000101',
  '83000000-0000-4000-8000-000000000101',1,'opening_float',100000,'MXN',
  '83000000-0000-4000-8000-000000000102',
  (now() at time zone 'America/Mazatlan')::date
);

update merchant.cash_shift set ledger_sequence=1
where id='83000000-0000-4000-8000-000000000101';
update merchant.physical_register set
  current_shift_id='83000000-0000-4000-8000-000000000101'
where id='57000000-0000-4000-8000-000000000101';

insert into merchant.pos_cart(
  id,merchant_id,location_id,operator_session_id,status,version,business_date,
  lifecycle_state,original_operator_session_id,original_operator_user_id,
  operator_user_id,customer_id
) values(
  '84000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '82000000-0000-4000-8000-000000000101','committed',1,current_date,'committed',
  '82000000-0000-4000-8000-000000000101',
  '30000000-0000-4000-8000-000000000200',
  '30000000-0000-4000-8000-000000000200',
  '71000000-0000-4000-8000-000000000101'
);

insert into merchant.pos_cart_line(
  id,merchant_id,cart_id,product_id,identity_key,product_name,quantity,
  base_price,tax_rate_basis_points
) values(
  '84000000-0000-4000-8000-000000000102',
  '10000000-0000-4000-8000-000000000101',
  '84000000-0000-4000-8000-000000000101',
  '52000000-0000-4000-8000-000000000101',repeat('d',64),'Americano',2,4500,1600
);

insert into merchant.customer_order(
  id,merchant_id,location_id,customer_id,source,fulfillment_type,status,version,
  external_ref,business_date
) values(
  '84000000-0000-4000-8000-000000000103',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '71000000-0000-4000-8000-000000000101','pos','dine_in','completed',1,
  'gate5a-live-sale',current_date
);

insert into merchant.pos_checkout_draft(
  id,merchant_id,location_id,cart_id,operator_session_id,device_id,state,version,
  receipt_delivery,payment_summary,cash_shift_id
) values(
  '84000000-0000-4000-8000-000000000104',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '84000000-0000-4000-8000-000000000101',
  '82000000-0000-4000-8000-000000000101',
  '67000000-0000-4000-8000-000000000101','receipt_available',1,
  '{"destination":"display"}','{"discounts":{"entries":[]}}',
  '83000000-0000-4000-8000-000000000101'
);

set constraints all deferred;

insert into merchant.pos_tender_fact(
  id,merchant_id,location_id,checkout_id,cart_id,position,tender_type,status,
  amount_minor_units,received_minor_units,change_minor_units,currency,
  correlation_id,committed_at
) values(
  '84000000-0000-4000-8000-000000000105',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '84000000-0000-4000-8000-000000000104',
  '84000000-0000-4000-8000-000000000101',0,'cash','committed',9000,10000,1000,
  'MXN','gate5a-live-sale',now()
);

insert into merchant.pos_payment_attempt(
  id,merchant_id,location_id,cart_id,method,amount_minor_units,currency,status,
  query_only,correlation_id,resolved_at,tender_id
) values(
  '84000000-0000-4000-8000-000000000106',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '84000000-0000-4000-8000-000000000101','cash',9000,'MXN','succeeded',false,
  'gate5a-live-sale',now(),'84000000-0000-4000-8000-000000000105'
);

insert into merchant.receipt_snapshot(
  id,merchant_id,location_id,order_id,payment_attempt_id,receipt_number,
  business_date,currency,grand_total,snapshot,receipt_destination
) values(
  '84000000-0000-4000-8000-000000000107',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '84000000-0000-4000-8000-000000000103',
  '84000000-0000-4000-8000-000000000106','LIVE-0001',current_date,'MXN',9000,
  jsonb_build_object(
    'receiptRef','LIVE-0001',
    'merchantId','10000000-0000-4000-8000-000000000101',
    'locationId','20000000-0000-4000-8000-000000000101',
    'issuedAt',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'businessDate',current_date::text,
    'lines',jsonb_build_array(jsonb_build_object(
      'lineRef','84000000-0000-4000-8000-000000000102',
      'description','Americano','quantity',2,
      'unitPrice',jsonb_build_object('minorUnits',4500,'currency','MXN'),
      'lineTotal',jsonb_build_object('minorUnits',9000,'currency','MXN'),
      'tax',jsonb_build_object('minorUnits',1241,'currency','MXN'),
      'discount',jsonb_build_object('minorUnits',0,'currency','MXN'),
      'tip',jsonb_build_object('minorUnits',0,'currency','MXN')
    )),
    'subtotal',jsonb_build_object('minorUnits',7759,'currency','MXN'),
    'taxTotal',jsonb_build_object('minorUnits',1241,'currency','MXN'),
    'grandTotal',jsonb_build_object('minorUnits',9000,'currency','MXN'),
    'currency','MXN','version',1,'merchantName','UmiPOS Local',
    'locationName','Sucursal Local','operatorName','Propietaria UmiPOS',
    'payments',jsonb_build_array(jsonb_build_object(
      'tenderId','84000000-0000-4000-8000-000000000105','method','cash',
      'amount',jsonb_build_object('minorUnits',9000,'currency','MXN'),
      'received',jsonb_build_object('minorUnits',10000,'currency','MXN'),
      'change',jsonb_build_object('minorUnits',1000,'currency','MXN')
    )),
    'receiptDestination','display',
    'discountTotal',jsonb_build_object('minorUnits',0,'currency','MXN'),
    'tip',jsonb_build_object('minorUnits',0,'currency','MXN')
  ),'display'
);

insert into merchant.pos_committed_sale(
  id,merchant_id,location_id,cart_id,order_id,payment_attempt_id,
  receipt_snapshot_id,totals_fingerprint,cash_shift_id
) values(
  '84000000-0000-4000-8000-000000000108',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '84000000-0000-4000-8000-000000000101',
  '84000000-0000-4000-8000-000000000103',
  '84000000-0000-4000-8000-000000000106',
  '84000000-0000-4000-8000-000000000107',repeat('a',64),
  '83000000-0000-4000-8000-000000000101'
);

insert into merchant.pos_exception_policy(
  id,merchant_id,location_id,version,currency,refunds_enabled,voids_enabled,
  refund_window_minutes,void_window_minutes,cashier_refund_threshold,
  cash_refund_threshold,cash_refund_requires_shift,require_different_approver,
  tender_allocation_policy,tip_refund_policy,maximum_lines,expires_at,fingerprint
) values(
  '84000000-0000-4000-8000-000000000109',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101','live-cert-1','MXN',true,true,
  10080,60,0,0,true,true,'proportional','proportional',100,
  now()+interval '30 days',repeat('b',64)
)
on conflict(merchant_id,location_id,currency) do update set
  version=excluded.version,refunds_enabled=true,voids_enabled=true,
  refund_window_minutes=excluded.refund_window_minutes,
  void_window_minutes=excluded.void_window_minutes,
  cashier_refund_threshold=0,cash_refund_threshold=0,
  cash_refund_requires_shift=true,require_different_approver=true,
  tender_allocation_policy='proportional',tip_refund_policy='proportional',
  maximum_lines=100,expires_at=excluded.expires_at,fingerprint=excluded.fingerprint;

insert into merchant.hardware_device(
  id,merchant_id,location_id,register_id,assigned_pos_device_id,device_type,
  manufacturer,model,public_reference,transport,capabilities,enabled,
  configuration_version,connection_state,created_by,optimistic_version
) values(
  '68000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '57000000-0000-4000-8000-000000000101',
  '67000000-0000-4000-8000-000000000101','printer','Umi',
  'Deterministic Simulator','PRN-LIVE-01','simulator',
  array['printer.receipt','printer.test_page','printer.qr','printer.cut'],true,1,
  'connected','30000000-0000-4000-8000-000000000200',1
);

insert into merchant.hardware_assignment(
  id,merchant_id,hardware_id,location_id,register_id,assigned_pos_device_id,
  primary_device,configuration_version,assigned_by
) values(
  '68000000-0000-4000-8000-000000000102',
  '10000000-0000-4000-8000-000000000101',
  '68000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '57000000-0000-4000-8000-000000000101',
  '67000000-0000-4000-8000-000000000101',true,1,
  '30000000-0000-4000-8000-000000000200'
);

insert into merchant.hardware_command(
  id,merchant_id,location_id,register_id,hardware_id,originating_pos_device_id,
  operator_id,operator_session_id,command_type,source_aggregate_type,
  source_aggregate_id,payload_fingerprint,idempotency_key,correlation_id,
  expected_configuration_version,safe_payload
) values(
  '68000000-0000-4000-8000-000000000103',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '57000000-0000-4000-8000-000000000101',
  '68000000-0000-4000-8000-000000000101',
  '67000000-0000-4000-8000-000000000101',
  '30000000-0000-4000-8000-000000000200',
  '82000000-0000-4000-8000-000000000101','print_receipt','receipt',
  '84000000-0000-4000-8000-000000000107',repeat('c',64),'live-cert-official-print',
  'gate5a-live-official-print',1,
  jsonb_build_object('printPayload',jsonb_build_object('receiptRef','LIVE-0001'))
);

insert into merchant.hardware_command_event(merchant_id,command_id,sequence,status)
values(
  '10000000-0000-4000-8000-000000000101',
  '68000000-0000-4000-8000-000000000103',1,'succeeded'
);

insert into merchant.hardware_print_job(
  id,merchant_id,location_id,register_id,printer_id,command_id,job_type,
  source_aggregate_type,source_aggregate_id,correlation_id,idempotency_key,
  payload_fingerprint,safe_document
) values(
  '68000000-0000-4000-8000-000000000103',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '57000000-0000-4000-8000-000000000101',
  '68000000-0000-4000-8000-000000000101',
  '68000000-0000-4000-8000-000000000103','official_receipt','receipt',
  '84000000-0000-4000-8000-000000000107','gate5a-live-official-print',
  'live-cert-official-print',repeat('c',64),
  jsonb_build_object('printPayload',jsonb_build_object('receiptRef','LIVE-0001'))
);

insert into merchant.hardware_print_job_event(
  merchant_id,print_job_id,sequence,status,attempt
) values(
  '10000000-0000-4000-8000-000000000101',
  '68000000-0000-4000-8000-000000000103',1,'printed',1
);

insert into merchant.station(
  id,merchant_id,location_id,key,name,status,sort_order,capabilities,version
) values(
  '85000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101','gate5a-coffee','Café Gate 5A','active',10,
  array['prepare','ready'],1
);

insert into merchant.device(
  id,merchant_id,location_id,station_id,name,kind,public_id,status,platform,last_seen_at
) values(
  '85000000-0000-4000-8000-000000000102',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '85000000-0000-4000-8000-000000000101',
  'KDS Simulado Gate 6A','kds','85000000-0000-4000-8000-000000000103',
  'active','ios',clock_timestamp()
);

insert into merchant.kitchen_device_station(
  merchant_id,location_id,device_id,station_id,active,configuration_version
) values(
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '85000000-0000-4000-8000-000000000102',
  '85000000-0000-4000-8000-000000000101',true,1
);

insert into merchant.kitchen_route(
  id,merchant_id,location_id,category_id,station_id,requires_preparation,
  route_priority,target_seconds,active,version
) values(
  '85000000-0000-4000-8000-000000000105',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '51000000-0000-4000-8000-000000000101',
  '85000000-0000-4000-8000-000000000101',true,100,480,true,1
);

insert into merchant.order_item(
  id,order_id,product_id,name,quantity,unit_price,display_order,station_id
) values(
  '85000000-0000-4000-8000-000000000106',
  '84000000-0000-4000-8000-000000000103',
  '52000000-0000-4000-8000-000000000101','Americano KDS',1,4500,1,
  '85000000-0000-4000-8000-000000000101'
);

insert into merchant.kitchen_order(
  id,merchant_id,location_id,source_order_id,public_reference,source,
  fulfillment_type,business_date,status,priority,version,route_snapshot,queued_at
) values(
  '85000000-0000-4000-8000-000000000107',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '84000000-0000-4000-8000-000000000103','KDS-CERT-0001','pos',
  'dine_in',current_date,'queued','normal',1,'[]',clock_timestamp()
);

insert into merchant.kitchen_order_item(
  id,merchant_id,location_id,kitchen_order_id,source_order_id,source_order_item_id,
  station_id,status,product_id,product_name,modifiers,quantity,display_order,route_reason,
  target_seconds,version
) values(
  '85000000-0000-4000-8000-000000000108',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '85000000-0000-4000-8000-000000000107',
  '84000000-0000-4000-8000-000000000103',
  '85000000-0000-4000-8000-000000000106',
  '85000000-0000-4000-8000-000000000101','queued',
  '52000000-0000-4000-8000-000000000101','Americano KDS','[]',1,1,
  'category_route',480,1
);

insert into merchant.customer_order(
  id,merchant_id,location_id,customer_id,source,fulfillment_type,status,version,
  external_ref,business_date
) values(
  '84000000-0000-4000-8000-000000000113',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '71000000-0000-4000-8000-000000000101','pos','pickup','completed',1,
  'gate6b-kds-cancel',current_date
);

insert into merchant.order_item(
  id,order_id,product_id,name,quantity,unit_price,display_order,station_id
) values(
  '85000000-0000-4000-8000-000000000116',
  '84000000-0000-4000-8000-000000000113',
  '52000000-0000-4000-8000-000000000101','Americano KDS Cancel',1,4500,1,
  '85000000-0000-4000-8000-000000000101'
);

insert into merchant.kitchen_order(
  id,merchant_id,location_id,source_order_id,public_reference,source,
  fulfillment_type,business_date,status,priority,version,route_snapshot,queued_at
) values(
  '85000000-0000-4000-8000-000000000117',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '84000000-0000-4000-8000-000000000113','KDS-CERT-CANCEL','pos',
  'pickup',current_date,'queued','normal',1,'[]',clock_timestamp()
);

insert into merchant.kitchen_order_item(
  id,merchant_id,location_id,kitchen_order_id,source_order_id,source_order_item_id,
  station_id,status,product_id,product_name,modifiers,quantity,display_order,route_reason,
  target_seconds,version
) values(
  '85000000-0000-4000-8000-000000000118',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '85000000-0000-4000-8000-000000000117',
  '84000000-0000-4000-8000-000000000113',
  '85000000-0000-4000-8000-000000000116',
  '85000000-0000-4000-8000-000000000101','queued',
  '52000000-0000-4000-8000-000000000101','Americano KDS Cancel','[]',1,1,
  'category_route',480,1
);

insert into merchant.hardware_device(
  id,merchant_id,location_id,register_id,assigned_pos_device_id,device_type,
  manufacturer,model,public_reference,transport,capabilities,enabled,
  configuration_version,connection_state,created_by,optimistic_version
) values(
  '68000000-0000-4000-8000-000000000110',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '57000000-0000-4000-8000-000000000101',
  '67000000-0000-4000-8000-000000000101','barcode_scanner','Umi',
  'Deterministic Scanner','SCN-LIVE-01','simulator',
  array['scanner.barcode','scanner.single'],true,1,'connected',
  '30000000-0000-4000-8000-000000000200',1
);

insert into merchant.hardware_assignment(
  id,merchant_id,hardware_id,location_id,register_id,assigned_pos_device_id,
  primary_device,configuration_version,assigned_by
) values(
  '68000000-0000-4000-8000-000000000111',
  '10000000-0000-4000-8000-000000000101',
  '68000000-0000-4000-8000-000000000110',
  '20000000-0000-4000-8000-000000000101',
  '57000000-0000-4000-8000-000000000101',
  '67000000-0000-4000-8000-000000000101',false,1,
  '30000000-0000-4000-8000-000000000200'
);

insert into merchant.pos_offline_policy(
  merchant_id,version,expires_at,allowed_command_types,cash_sale_enabled,
  max_queue_depth,max_batch_size,max_command_age_seconds
) values(
  '10000000-0000-4000-8000-000000000101','gate6b-training-1',
  clock_timestamp()+interval '30 days',
  array['operational.ack','sale.cash.commit'],true,250,20,86400
);

insert into merchant.pos_offline_cash_policy(
  merchant_id,location_id,enabled,version,currency,max_policy_age_seconds,
  max_single_sale_minor_units,max_accumulated_minor_units,max_offline_sale_count,
  max_active_queue_depth,max_command_age_seconds,max_catalog_age_seconds,
  max_pricing_age_seconds,max_tax_age_seconds,manager_approval_threshold_minor_units,
  allowed_device_classes,expires_at
) values(
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',true,'gate7a-native-1','MXN',86400,
  100000,300000,10,250,86400,86400,86400,86400,null,array['pos_terminal'],
  clock_timestamp()+interval '30 days'
);

insert into runtime.session(
  id,merchant_id,principal_type,principal_id,token_hash,station_id,device_name,
  is_active,metadata,last_used_at
) values(
  '85000000-0000-4000-8000-000000000104',
  '10000000-0000-4000-8000-000000000101','device',
  '85000000-0000-4000-8000-000000000102',
  encode(extensions.digest('gate6a-pilot-kds-token','sha256'),'hex'),
  '85000000-0000-4000-8000-000000000101','KDS Simulado Gate 6A',true,
  jsonb_build_object(
    'location_id','20000000-0000-4000-8000-000000000101',
    'permissions',jsonb_build_array(
      'kitchen.read','kitchen.prepare','kitchen.ready','kitchen.complete',
      'kitchen.recall','kitchen.cancel_ack'
    )
  ),clock_timestamp()
);

-- A failed, query-first inventory command proves the real Recovery Center path.
insert into merchant.business_command(
  id,merchant_id,location_id,command_id,idempotency_key,command_type,fingerprint,
  status,response_data,failure_code,retryable,correlation_id,completed_at,expires_at
) values(
  '86000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000101',
  '86000000-0000-4000-8000-000000000102',
  'gate5a-live-inventory-recovery',
  'pos.inventory.adjustment',repeat('d',64),'failed',
  jsonb_build_object('state','query_required'),'DEVICE_UNAVAILABLE',true,
  'gate5a-live-inventory-recovery',clock_timestamp(),clock_timestamp()+interval '72 hours'
);

commit;
