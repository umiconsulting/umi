-- Gate 3G-B: generic pilot transports, safe connection configuration, and runtime policy.
begin;
set search_path = merchant, runtime, umi, extensions, pg_catalog;

alter table merchant.hardware_device
  drop constraint hardware_device_transport_check,
  add constraint hardware_device_transport_check check(transport in (
    'simulator','network_tcp','printer_attached','keyboard_wedge',
    'usb_foundation','bluetooth_foundation','network_foundation',
    'serial_foundation','platform_channel_foundation'
  )),
  drop constraint hardware_device_connection_state_check,
  add constraint hardware_device_connection_state_check check(connection_state in (
    'connected','disconnected','connecting','busy','recovering','failed',
    'disabled','error','unknown'
  )),
  add column connection_configuration jsonb not null default jsonb_build_object(
    'networkHost',null,'networkPort',null,'connectTimeoutMs',2000,
    'commandTimeoutMs',5000,'characterEncoding','cp850','receiptWidthColumns',42,
    'drawerPulsePin',0,'drawerPulseOnMs',50,'scannerTerminator','enter',
    'scannerBurstWindowMs',80
  );

alter table merchant.hardware_device add constraint hardware_transport_device_compatibility check(
  (transport<>'network_tcp' or device_type='printer') and
  (transport<>'printer_attached' or device_type='cash_drawer') and
  (transport<>'keyboard_wedge' or device_type='barcode_scanner')
);

drop index merchant.primary_receipt_printer_uidx;
create unique index primary_receipt_printer_uidx
  on merchant.hardware_assignment(merchant_id,location_id,register_id) nulls not distinct
  where primary_device and released_at is null;

create or replace function merchant.validate_hardware_connection(
  p_transport text,p_device_type text,p_configuration jsonb
) returns void language plpgsql immutable
set search_path=pg_catalog as $$
begin
  if jsonb_typeof(p_configuration)<>'object'
    or p_configuration - array[
      'networkHost','networkPort','connectTimeoutMs','commandTimeoutMs',
      'characterEncoding','receiptWidthColumns','drawerPulsePin','drawerPulseOnMs',
      'scannerTerminator','scannerBurstWindowMs'
    ]::text[]<>'{}'::jsonb
  then raise exception 'HARDWARE_CONFIGURATION_INVALID'; end if;
  if p_transport in ('network_tcp','printer_attached') and (
    coalesce(p_configuration->>'networkHost','')!~'^[A-Za-z0-9.-]{1,253}$'
    or coalesce((p_configuration->>'networkPort')::integer,0) not between 1 and 65535
  ) then raise exception 'HARDWARE_NETWORK_ENDPOINT_INVALID'; end if;
  if p_transport='printer_attached' and p_device_type<>'cash_drawer'
  then raise exception 'HARDWARE_CAPABILITY_UNSUPPORTED'; end if;
  if p_transport='keyboard_wedge' and p_device_type<>'barcode_scanner'
  then raise exception 'HARDWARE_CAPABILITY_UNSUPPORTED'; end if;
  if coalesce((p_configuration->>'connectTimeoutMs')::integer,0) not between 250 and 10000
    or coalesce((p_configuration->>'commandTimeoutMs')::integer,0) not between 500 and 30000
    or coalesce((p_configuration->>'receiptWidthColumns')::integer,0) not between 20 and 120
    or coalesce((p_configuration->>'drawerPulsePin')::integer,-1) not between 0 and 1
    or coalesce((p_configuration->>'drawerPulseOnMs')::integer,0) not between 2 and 510
    or coalesce((p_configuration->>'scannerBurstWindowMs')::integer,0) not between 20 and 500
    or p_configuration->>'characterEncoding' not in ('cp850','utf8')
    or p_configuration->>'scannerTerminator' not in ('enter','tab')
  then raise exception 'HARDWARE_CONFIGURATION_INVALID'; end if;
end $$;

create table merchant.hardware_pilot_policy (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null,
  register_id uuid,
  policy jsonb not null,
  version bigint not null default 1 check(version>0),
  updated_by uuid not null references umi.user(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key(merchant_id,location_id) references merchant.location(merchant_id,id),
  foreign key(merchant_id,location_id,register_id)
    references merchant.physical_register(merchant_id,location_id,id) on delete restrict,
  constraint hardware_pilot_policy_shape check(
    jsonb_typeof(policy)='object' and
    policy - array[
      'autoPrintReceipt','openDrawerOnCashSale','openDrawerOnCashRefund','allowNoSale',
      'receiptCopiesDefault','hardwareRetryLimit','hardwareHealthIntervalSeconds',
      'scannerEnabled','customerDisplayEnabled'
    ]::text[]='{}'::jsonb and
    jsonb_typeof(policy->'autoPrintReceipt')='boolean' and
    jsonb_typeof(policy->'openDrawerOnCashSale')='boolean' and
    jsonb_typeof(policy->'openDrawerOnCashRefund')='boolean' and
    jsonb_typeof(policy->'allowNoSale')='boolean' and
    jsonb_typeof(policy->'scannerEnabled')='boolean' and
    jsonb_typeof(policy->'customerDisplayEnabled')='boolean' and
    (policy->>'receiptCopiesDefault')::integer between 1 and 3 and
    (policy->>'hardwareRetryLimit')::integer between 1 and 3 and
    (policy->>'hardwareHealthIntervalSeconds')::integer between 15 and 300
  )
);
create unique index hardware_pilot_policy_scope_uidx
  on merchant.hardware_pilot_policy(merchant_id,location_id,register_id) nulls not distinct;
create index hardware_pilot_policy_scope_idx
  on merchant.hardware_pilot_policy(merchant_id,location_id,register_id,version);

alter table merchant.hardware_pilot_policy enable row level security;
alter table merchant.hardware_pilot_policy force row level security;
create policy hardware_pilot_policy_merchant_scope on merchant.hardware_pilot_policy
  using(merchant_id=umi.current_merchant()) with check(merchant_id=umi.current_merchant());
create policy hardware_pilot_policy_location_scope on merchant.hardware_pilot_policy as restrictive
  using(location_id=umi.current_location()) with check(location_id=umi.current_location());

create or replace function merchant.register_hardware_device(p_device jsonb)
returns uuid language plpgsql security definer
set search_path=pg_catalog,merchant,runtime,umi as $$
declare v_session runtime.operator_session%rowtype; v_id uuid; v_foundation boolean;
  v_configuration jsonb; v_identity_hash text;
begin
  v_session:=merchant.assert_hardware_scope(
    (p_device->>'merchantId')::uuid,(p_device->>'locationId')::uuid,
    (p_device->>'operatorSessionId')::uuid,'hardware.manage'
  );
  select id into v_id from merchant.hardware_device
    where merchant_id=(p_device->>'merchantId')::uuid
      and public_reference=p_device->>'publicReference';
  if v_id is not null then return v_id; end if;
  if nullif(p_device->>'registerId','') is not null and not exists(
    select 1 from merchant.physical_register r
    where r.id=(p_device->>'registerId')::uuid
      and r.merchant_id=(p_device->>'merchantId')::uuid
      and r.location_id=(p_device->>'locationId')::uuid and r.active
      and r.archived_at is null and r.status<>'archived'
  ) then raise exception 'HARDWARE_REGISTER_SCOPE'; end if;
  if nullif(p_device->>'assignedPosDeviceId','') is not null and not exists(
    select 1 from merchant.device d
    where d.id=(p_device->>'assignedPosDeviceId')::uuid
      and d.merchant_id=(p_device->>'merchantId')::uuid
      and d.location_id=(p_device->>'locationId')::uuid
      and d.kind='pos_terminal' and d.status='active'
  ) then raise exception 'HARDWARE_POS_DEVICE_SCOPE'; end if;
  v_configuration:=coalesce(p_device->'connectionConfiguration',jsonb_build_object(
    'networkHost',null,'networkPort',null,'connectTimeoutMs',2000,
    'commandTimeoutMs',5000,'characterEncoding','cp850','receiptWidthColumns',42,
    'drawerPulsePin',0,'drawerPulseOnMs',50,'scannerTerminator','enter',
    'scannerBurstWindowMs',80
  ));
  perform merchant.validate_hardware_connection(
    p_device->>'transport',p_device->>'deviceType',v_configuration
  );
  v_identity_hash:=case when p_device->>'transport' in ('network_tcp','printer_attached')
    then encode(extensions.digest(
      concat_ws('|',p_device->>'deviceType',p_device->>'transport',
        lower(v_configuration->>'networkHost'),v_configuration->>'networkPort'),
      'sha256'),'hex') else null end;
  if v_identity_hash is not null and exists(
    select 1 from merchant.hardware_device d
      where d.merchant_id=(p_device->>'merchantId')::uuid
        and d.physical_identity_hash=v_identity_hash and d.archived_at is null
  ) then raise exception 'HARDWARE_PHYSICAL_IDENTITY_CONFLICT'; end if;
  v_foundation:=(p_device->>'deviceType') in (
    'payment_terminal_foundation','scale_foundation'
  );
  insert into merchant.hardware_device(
    merchant_id,location_id,register_id,assigned_pos_device_id,device_type,manufacturer,
    model,public_reference,physical_identity_hash,transport,connection_configuration,
    capabilities,enabled,connection_state,created_by
  ) values(
    (p_device->>'merchantId')::uuid,(p_device->>'locationId')::uuid,
    nullif(p_device->>'registerId','')::uuid,nullif(p_device->>'assignedPosDeviceId','')::uuid,
    p_device->>'deviceType',p_device->>'manufacturer',p_device->>'model',
    p_device->>'publicReference',v_identity_hash,
    p_device->>'transport',v_configuration,
    array(select jsonb_array_elements_text(p_device->'capabilities')),
    not v_foundation,case when v_foundation then 'disabled' else 'disconnected' end,
    v_session.user_id
  ) returning id into v_id;
  return v_id;
end $$;

create or replace function merchant.update_hardware_device(p_device jsonb)
returns uuid language plpgsql security definer
set search_path=pg_catalog,merchant,runtime,umi as $$
declare v_session runtime.operator_session%rowtype; v_row merchant.hardware_device%rowtype;
  v_configuration jsonb; v_identity_hash text;
begin
  v_session:=merchant.assert_hardware_scope(
    (p_device->>'merchantId')::uuid,(p_device->>'locationId')::uuid,
    (p_device->>'operatorSessionId')::uuid,'hardware.manage'
  );
  select * into v_row from merchant.hardware_device
    where merchant_id=(p_device->>'merchantId')::uuid
      and id=(p_device->>'hardwareId')::uuid for update;
  if not found then raise exception 'HARDWARE_NOT_FOUND'; end if;
  if v_row.location_id<>(p_device->>'locationId')::uuid
  then raise exception 'HARDWARE_LOCATION_SCOPE'; end if;
  if v_row.optimistic_version<>(p_device->>'expectedVersion')::bigint
  then raise exception 'HARDWARE_CONFIGURATION_STALE'; end if;
  if v_row.device_type in ('payment_terminal_foundation','scale_foundation')
    and coalesce((p_device->>'enabled')::boolean,false)
  then raise exception 'HARDWARE_FOUNDATION_ONLY'; end if;
  v_configuration:=case
    when p_device->'connectionConfiguration' is null
      or jsonb_typeof(p_device->'connectionConfiguration')='null'
    then v_row.connection_configuration else p_device->'connectionConfiguration' end;
  perform merchant.validate_hardware_connection(v_row.transport,v_row.device_type,v_configuration);
  v_identity_hash:=case when v_row.transport in ('network_tcp','printer_attached')
    then encode(extensions.digest(
      concat_ws('|',v_row.device_type,v_row.transport,
        lower(v_configuration->>'networkHost'),v_configuration->>'networkPort'),
      'sha256'),'hex') else null end;
  if v_identity_hash is not null and exists(
    select 1 from merchant.hardware_device d where d.merchant_id=v_row.merchant_id
      and d.id<>v_row.id and d.physical_identity_hash=v_identity_hash and d.archived_at is null
  ) then raise exception 'HARDWARE_PHYSICAL_IDENTITY_CONFLICT'; end if;
  update merchant.hardware_device set enabled=(p_device->>'enabled')::boolean,
    connection_configuration=v_configuration,
    physical_identity_hash=v_identity_hash,
    connection_state=case when (p_device->>'enabled')::boolean
      then case when connection_state='disabled' then 'disconnected' else connection_state end
      else 'disabled' end,
    configuration_version=configuration_version+1,optimistic_version=optimistic_version+1,
    updated_at=clock_timestamp()
  where id=v_row.id;
  return v_row.id;
end $$;

create or replace function merchant.assign_hardware_device(p_assignment jsonb)
returns uuid language plpgsql security definer
set search_path=pg_catalog,merchant,runtime,umi as $$
declare v_session runtime.operator_session%rowtype; v_row merchant.hardware_device%rowtype;
  v_prior record;
begin
  v_session:=merchant.assert_hardware_scope(
    (p_assignment->>'merchantId')::uuid,(p_assignment->>'locationId')::uuid,
    (p_assignment->>'operatorSessionId')::uuid,'hardware.assign'
  );
  select * into v_row from merchant.hardware_device
    where merchant_id=(p_assignment->>'merchantId')::uuid
      and id=(p_assignment->>'hardwareId')::uuid for update;
  if not found then raise exception 'HARDWARE_NOT_FOUND'; end if;
  if v_row.optimistic_version<>(p_assignment->>'expectedVersion')::bigint
  then raise exception 'HARDWARE_CONFIGURATION_STALE'; end if;
  if v_row.location_id<>(p_assignment->>'locationId')::uuid
  then raise exception 'HARDWARE_LOCATION_SCOPE'; end if;
  if coalesce((p_assignment->>'primary')::boolean,false) and v_row.device_type<>'printer'
  then raise exception 'HARDWARE_CAPABILITY_UNSUPPORTED'; end if;
  if nullif(p_assignment->>'registerId','') is not null and not exists(
    select 1 from merchant.physical_register r where r.id=(p_assignment->>'registerId')::uuid
      and r.merchant_id=v_row.merchant_id and r.location_id=v_row.location_id and r.active
      and r.archived_at is null and r.status<>'archived'
  ) then raise exception 'HARDWARE_REGISTER_SCOPE'; end if;
  if nullif(p_assignment->>'assignedPosDeviceId','') is not null and not exists(
    select 1 from merchant.device d where d.id=(p_assignment->>'assignedPosDeviceId')::uuid
      and d.merchant_id=v_row.merchant_id and d.location_id=v_row.location_id
      and d.kind='pos_terminal' and d.status='active'
  ) then raise exception 'HARDWARE_POS_DEVICE_SCOPE'; end if;

  if coalesce((p_assignment->>'primary')::boolean,false) then
    for v_prior in
      select a.*,d.configuration_version as device_configuration_version
      from merchant.hardware_assignment a
      join merchant.hardware_device d on d.merchant_id=a.merchant_id and d.id=a.hardware_id
      where a.merchant_id=v_row.merchant_id and a.location_id=v_row.location_id
        and a.register_id is not distinct from nullif(p_assignment->>'registerId','')::uuid
        and a.primary_device and a.released_at is null and a.hardware_id<>v_row.id
      for update of a,d
    loop
      update merchant.hardware_assignment set released_at=clock_timestamp(),
        release_reason='primary_replaced' where id=v_prior.id;
      insert into merchant.hardware_assignment(
        merchant_id,hardware_id,location_id,register_id,assigned_pos_device_id,
        primary_device,configuration_version,assigned_by
      ) values(
        v_prior.merchant_id,v_prior.hardware_id,v_prior.location_id,v_prior.register_id,
        v_prior.assigned_pos_device_id,false,v_prior.device_configuration_version+1,
        v_session.user_id
      );
      update merchant.hardware_device set configuration_version=configuration_version+1,
        optimistic_version=optimistic_version+1,updated_at=clock_timestamp()
        where id=v_prior.hardware_id;
    end loop;
  end if;

  update merchant.hardware_assignment set released_at=clock_timestamp(),
    release_reason='reassigned' where merchant_id=v_row.merchant_id
      and hardware_id=v_row.id and released_at is null;
  insert into merchant.hardware_assignment(
    merchant_id,hardware_id,location_id,register_id,assigned_pos_device_id,
    primary_device,configuration_version,assigned_by
  ) values(
    v_row.merchant_id,v_row.id,v_row.location_id,nullif(p_assignment->>'registerId','')::uuid,
    nullif(p_assignment->>'assignedPosDeviceId','')::uuid,
    coalesce((p_assignment->>'primary')::boolean,false),v_row.configuration_version+1,
    v_session.user_id
  );
  update merchant.hardware_device set register_id=nullif(p_assignment->>'registerId','')::uuid,
    assigned_pos_device_id=nullif(p_assignment->>'assignedPosDeviceId','')::uuid,
    configuration_version=configuration_version+1,optimistic_version=optimistic_version+1,
    updated_at=clock_timestamp() where id=v_row.id;
  return v_row.id;
end $$;

create or replace function merchant.update_hardware_pilot_policy(p_input jsonb)
returns bigint language plpgsql security definer
set search_path=pg_catalog,merchant,runtime,umi as $$
declare v_session runtime.operator_session%rowtype; v_row merchant.hardware_pilot_policy%rowtype;
  v_policy jsonb; v_version bigint;
begin
  v_session:=merchant.assert_hardware_scope(
    (p_input->>'merchantId')::uuid,(p_input->>'locationId')::uuid,
    (p_input->>'operatorSessionId')::uuid,'hardware.manage'
  );
  v_policy:=p_input->'policy';
  v_version:=(p_input->>'expectedVersion')::bigint;
  select * into v_row from merchant.hardware_pilot_policy
    where merchant_id=(p_input->>'merchantId')::uuid
      and location_id=(p_input->>'locationId')::uuid
      and register_id is not distinct from nullif(p_input->>'registerId','')::uuid
    for update;
  if found then
    if v_row.version<>v_version then raise exception 'HARDWARE_CONFIGURATION_STALE'; end if;
    update merchant.hardware_pilot_policy set policy=v_policy,version=version+1,
      updated_by=v_session.user_id,updated_at=clock_timestamp() where id=v_row.id
      returning version into v_version;
  else
    if v_version<>1 then raise exception 'HARDWARE_CONFIGURATION_STALE'; end if;
    insert into merchant.hardware_pilot_policy(
      merchant_id,location_id,register_id,policy,version,updated_by
    ) values(
      (p_input->>'merchantId')::uuid,(p_input->>'locationId')::uuid,
      nullif(p_input->>'registerId','')::uuid,v_policy,2,v_session.user_id
    ) returning version into v_version;
  end if;
  return v_version;
end $$;

revoke all on merchant.hardware_pilot_policy from public,api,worker,readonly;
grant select on merchant.hardware_pilot_policy to api;
revoke all on function merchant.validate_hardware_connection(text,text,jsonb),
  merchant.update_hardware_pilot_policy(jsonb) from public,worker,readonly;
grant execute on function merchant.validate_hardware_connection(text,text,jsonb),
  merchant.update_hardware_pilot_policy(jsonb) to api;

commit;
