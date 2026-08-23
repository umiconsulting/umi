-- Gate 3G-A: vendor-neutral hardware registry, commands, queue, diagnostics, and recovery.
begin;
set search_path = merchant, runtime, umi, extensions, pg_catalog;

insert into umi.permission(key,description) values
  ('hardware.command.execute','Execute and report a scoped hardware command'),
  ('hardware.read','Read assigned hardware and recovery state'),
  ('hardware.manage','Register, enable, disable, and archive hardware'),
  ('hardware.assign','Assign hardware to a location, register, and POS device'),
  ('hardware.diagnostics','Read and run safe hardware diagnostics'),
  ('hardware.printer.print','Print an authoritative receipt or approved document'),
  ('hardware.printer.reprint','Create a controlled receipt copy'),
  ('hardware.printer.test','Print a diagnostic test page'),
  ('hardware.drawer.open','Open a drawer for an eligible committed cash action'),
  ('hardware.drawer.test','Run an approved drawer test'),
  ('hardware.scanner.use','Use an assigned barcode scanner'),
  ('hardware.scanner.test','Run a scanner test session'),
  ('hardware.customer_display.use','Use an assigned customer display'),
  ('hardware.customer_display.test','Run a customer display test')
on conflict(key) do update set description=excluded.description;

alter table merchant.no_sale_drawer_event alter column approval_id set not null;

alter table merchant.physical_register
  add constraint physical_register_merchant_location_id_uk unique(merchant_id,location_id,id);
alter table merchant.device
  add constraint device_merchant_location_id_uk unique(merchant_id,location_id,id);

create table merchant.hardware_device (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null,
  register_id uuid,
  assigned_pos_device_id uuid,
  device_type text not null check(device_type in (
    'printer','cash_drawer','barcode_scanner','customer_display',
    'payment_terminal_foundation','scale_foundation'
  )),
  manufacturer text not null check(length(manufacturer) between 1 and 120),
  model text not null check(length(model) between 1 and 120),
  public_reference text not null check(public_reference ~ '^[A-Za-z0-9._:-]{1,160}$'),
  physical_identity_hash text check(
    physical_identity_hash is null or physical_identity_hash ~ '^[a-f0-9]{64}$'
  ),
  transport text not null check(transport in (
    'simulator','usb_foundation','bluetooth_foundation','network_foundation',
    'serial_foundation','platform_channel_foundation'
  )),
  capabilities text[] not null check(cardinality(capabilities) between 1 and 32),
  enabled boolean not null default true,
  configuration_version bigint not null default 1 check(configuration_version>0),
  connection_state text not null default 'unknown' check(connection_state in (
    'connected','disconnected','connecting','busy','error','unknown'
  )),
  firmware_version text check(firmware_version is null or length(firmware_version)<=120),
  last_heartbeat_at timestamptz,
  last_diagnostic_at timestamptz,
  created_by uuid not null references umi.user(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  optimistic_version bigint not null default 1 check(optimistic_version>0),
  foreign key(merchant_id,location_id) references merchant.location(merchant_id,id),
  foreign key(merchant_id,location_id,register_id)
    references merchant.physical_register(merchant_id,location_id,id) on delete restrict,
  foreign key(merchant_id,location_id,assigned_pos_device_id)
    references merchant.device(merchant_id,location_id,id) on delete restrict,
  unique(merchant_id,id),
  unique(merchant_id,public_reference),
  check((archived_at is null) or not enabled),
  constraint hardware_foundation_execution_block check(
    device_type not in ('payment_terminal_foundation','scale_foundation') or not enabled
  ),
  constraint hardware_capability_compatibility check(
    case device_type
      when 'printer' then capabilities <@ array[
        'printer.receipt','printer.image','printer.qr','printer.cut','printer.test_page',
        'printer.kitchen_ticket_foundation'
      ]::text[]
      when 'cash_drawer' then capabilities <@ array['drawer.open','drawer.status']::text[]
      when 'barcode_scanner' then capabilities <@ array[
        'scanner.barcode','scanner.qr','scanner.continuous','scanner.single'
      ]::text[]
      when 'customer_display' then capabilities <@ array[
        'customer_display.text','customer_display.totals','customer_display.qr'
      ]::text[]
      when 'payment_terminal_foundation' then capabilities <@ array[
        'terminal.connect_foundation','terminal.payment_foundation','terminal.refund_foundation'
      ]::text[]
      when 'scale_foundation' then capabilities <@ array[
        'scale.read_weight_foundation','scale.tare_foundation'
      ]::text[]
      else false
    end
  )
);
create unique index hardware_device_physical_identity_uidx
  on merchant.hardware_device(merchant_id,physical_identity_hash)
  where physical_identity_hash is not null and archived_at is null;
create index hardware_device_scope_idx
  on merchant.hardware_device(merchant_id,location_id,register_id,enabled,device_type);
create index hardware_device_pos_assignment_idx
  on merchant.hardware_device(merchant_id,assigned_pos_device_id,enabled)
  where assigned_pos_device_id is not null;

create table merchant.hardware_assignment (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null,
  hardware_id uuid not null,
  location_id uuid not null,
  register_id uuid,
  assigned_pos_device_id uuid,
  primary_device boolean not null default false,
  configuration_version bigint not null check(configuration_version>0),
  assigned_by uuid not null references umi.user(id) on delete restrict,
  assigned_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  release_reason text check(release_reason is null or length(release_reason)<=160),
  foreign key(merchant_id,hardware_id)
    references merchant.hardware_device(merchant_id,id) on delete restrict,
  foreign key(merchant_id,location_id) references merchant.location(merchant_id,id),
  foreign key(merchant_id,location_id,register_id)
    references merchant.physical_register(merchant_id,location_id,id) on delete restrict,
  foreign key(merchant_id,location_id,assigned_pos_device_id)
    references merchant.device(merchant_id,location_id,id) on delete restrict,
  check((released_at is null)=(release_reason is null))
);
create unique index hardware_assignment_one_active_uidx
  on merchant.hardware_assignment(merchant_id,hardware_id) where released_at is null;
create unique index primary_receipt_printer_uidx
  on merchant.hardware_assignment(merchant_id,location_id,register_id)
  where primary_device and released_at is null;
create index hardware_assignment_scope_idx
  on merchant.hardware_assignment(merchant_id,location_id,register_id,released_at);

create table merchant.hardware_command (
  id uuid primary key,
  merchant_id uuid not null,
  location_id uuid not null,
  register_id uuid,
  hardware_id uuid not null,
  originating_pos_device_id uuid not null references merchant.device(id) on delete restrict,
  operator_id uuid not null references umi.user(id) on delete restrict,
  operator_session_id uuid not null references runtime.operator_session(id) on delete restrict,
  command_type text not null check(command_type in (
    'print_receipt','print_kitchen_ticket_foundation','print_test_page','controlled_reprint',
    'cancel_pending_print','query_printer_status','open_drawer','query_drawer_status',
    'test_drawer','begin_scanner_session','end_scanner_session','update_customer_display',
    'clear_customer_display','run_diagnostic','terminal_connect_foundation',
    'terminal_disconnect_foundation','scale_read_foundation'
  )),
  source_aggregate_type text not null check(length(source_aggregate_type) between 1 and 80),
  source_aggregate_id text not null check(length(source_aggregate_id) between 1 and 160),
  payload_fingerprint text not null check(payload_fingerprint ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  correlation_id text not null check(correlation_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  expected_configuration_version bigint not null check(expected_configuration_version>0),
  initial_status text not null default 'pending' check(initial_status='pending'),
  safe_payload jsonb not null default '{}'::jsonb check(jsonb_typeof(safe_payload)='object'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(merchant_id,hardware_id)
    references merchant.hardware_device(merchant_id,id) on delete restrict,
  foreign key(merchant_id,location_id) references merchant.location(merchant_id,id),
  unique(merchant_id,id),
  unique(merchant_id,idempotency_key)
);
create index hardware_command_queue_idx
  on merchant.hardware_command(merchant_id,location_id,created_at,id);
create index hardware_command_source_idx
  on merchant.hardware_command(merchant_id,source_aggregate_type,source_aggregate_id);

create table merchant.hardware_command_event (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null,
  command_id uuid not null,
  sequence bigint not null check(sequence>0),
  status text not null check(status in (
    'pending','dispatching','succeeded','failed','retryable','cancelled','unknown'
  )),
  failure_code text check(failure_code is null or failure_code in (
    'hardware_not_found','hardware_disabled','hardware_not_assigned',
    'capability_unsupported','disconnected','busy','paper_out','cover_open_foundation',
    'transport_unavailable','command_timeout','unknown_outcome','permission_denied',
    'location_mismatch','register_mismatch','configuration_stale',
    'retryable_transport_failure','terminal_hardware_failure'
  )),
  safe_result jsonb not null default '{}'::jsonb check(jsonb_typeof(safe_result)='object'),
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key(merchant_id,command_id)
    references merchant.hardware_command(merchant_id,id) on delete restrict,
  unique(merchant_id,command_id,sequence),
  check((status in ('failed','retryable','unknown')) or failure_code is null)
);

create unique index hardware_drawer_source_once_uidx
  on merchant.hardware_command(
    merchant_id,hardware_id,source_aggregate_type,source_aggregate_id
  ) where command_type='open_drawer';
create index hardware_command_event_latest_idx
  on merchant.hardware_command_event(merchant_id,command_id,sequence desc);

create table merchant.hardware_print_job (
  id uuid primary key,
  merchant_id uuid not null,
  location_id uuid not null,
  register_id uuid,
  printer_id uuid not null,
  command_id uuid not null,
  job_type text not null check(job_type in (
    'official_receipt','receipt_copy','test_page','kitchen_ticket_foundation',
    'diagnostic_page_foundation'
  )),
  source_aggregate_type text not null check(length(source_aggregate_type) between 1 and 80),
  source_aggregate_id text not null check(length(source_aggregate_id) between 1 and 160),
  original_job_id uuid,
  correlation_id text not null check(correlation_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  payload_fingerprint text not null check(payload_fingerprint ~ '^[a-f0-9]{64}$'),
  copies smallint not null default 1 check(copies between 1 and 10),
  maximum_attempts smallint not null default 3 check(maximum_attempts between 1 and 5),
  safe_document jsonb not null check(jsonb_typeof(safe_document)='object'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(merchant_id,printer_id)
    references merchant.hardware_device(merchant_id,id) on delete restrict,
  foreign key(merchant_id,command_id)
    references merchant.hardware_command(merchant_id,id) on delete restrict,
  foreign key(original_job_id) references merchant.hardware_print_job(id) on delete restrict,
  unique(merchant_id,id),
  unique(merchant_id,idempotency_key),
  check(job_type='receipt_copy' or original_job_id is null),
  check(job_type<>'receipt_copy' or original_job_id is not null)
);
create unique index hardware_print_job_identity_uidx
  on merchant.hardware_print_job(merchant_id,printer_id,source_aggregate_type,source_aggregate_id)
  where job_type='official_receipt';
create index hardware_print_job_queue_idx
  on merchant.hardware_print_job(merchant_id,location_id,created_at,id);

create table merchant.hardware_print_job_event (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null,
  print_job_id uuid not null,
  sequence bigint not null check(sequence>0),
  status text not null check(status in (
    'queued','printing','printed','retryable_failure','terminal_failure','cancelled',
    'unknown_outcome'
  )),
  attempt smallint not null check(attempt between 0 and 5),
  failure_code text,
  safe_result jsonb not null default '{}'::jsonb check(jsonb_typeof(safe_result)='object'),
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key(merchant_id,print_job_id)
    references merchant.hardware_print_job(merchant_id,id) on delete restrict,
  unique(merchant_id,print_job_id,sequence)
);
create index hardware_print_event_latest_idx
  on merchant.hardware_print_job_event(merchant_id,print_job_id,sequence desc);

create table merchant.hardware_diagnostic (
  id uuid primary key,
  merchant_id uuid not null,
  location_id uuid not null,
  hardware_id uuid not null,
  operator_id uuid not null references umi.user(id) on delete restrict,
  diagnostic_type text not null check(diagnostic_type in (
    'query_status','connection_test','capability_report','printer_test_page','drawer_test',
    'scanner_test_session','customer_display_test','runtime_snapshot'
  )),
  health text not null check(health in ('healthy','degraded','unavailable','unknown')),
  connection_state text not null check(connection_state in (
    'connected','disconnected','connecting','busy','error','unknown'
  )),
  capability_snapshot text[] not null,
  latency_ms integer check(latency_ms between 0 and 120000),
  failure_code text,
  correlation_id text not null check(correlation_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  safe_result jsonb not null default '{}'::jsonb check(jsonb_typeof(safe_result)='object'),
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key(merchant_id,hardware_id)
    references merchant.hardware_device(merchant_id,id) on delete restrict,
  foreign key(merchant_id,location_id) references merchant.location(merchant_id,id)
);
create index hardware_diagnostic_history_idx
  on merchant.hardware_diagnostic(merchant_id,hardware_id,occurred_at desc);

create or replace function merchant.assert_hardware_scope(
  p_merchant_id uuid,p_location_id uuid,p_operator_session_id uuid,p_permission text
) returns runtime.operator_session language plpgsql security definer
set search_path=pg_catalog,merchant,runtime,umi as $$
declare v_session runtime.operator_session%rowtype;
begin
  if p_merchant_id is distinct from umi.current_merchant()
    or p_location_id is distinct from umi.current_location()
  then raise exception 'HARDWARE_LOCATION_SCOPE'; end if;
  select * into v_session from runtime.operator_session
  where id=p_operator_session_id and merchant_id=p_merchant_id and location_id=p_location_id
    and device_id=umi.current_device()
    and user_id=nullif(current_setting('app.user_id',true),'')::uuid
    and state='active' and expires_at>clock_timestamp() for update;
  if not found then raise exception 'HARDWARE_OPERATOR_SESSION_REQUIRED'; end if;
  if not ('*'=any(v_session.permissions) or p_permission=any(v_session.permissions))
  then raise exception 'HARDWARE_PERMISSION_DENIED'; end if;
  if not exists(select 1 from jsonb_array_elements(v_session.entitlements) e
    where e->>'featureKey'='pos' and coalesce((e->>'enabled')::boolean,false))
  then raise exception 'HARDWARE_ENTITLEMENT_DISABLED'; end if;
  return v_session;
end $$;

create or replace function merchant.create_hardware_command(p_command jsonb)
returns uuid language plpgsql security definer
set search_path=pg_catalog,merchant,runtime,umi as $$
declare v_session runtime.operator_session%rowtype; v_device merchant.hardware_device%rowtype;
  v_existing uuid; v_existing_fingerprint text; v_permission text; v_capability text; v_reason text;
  v_source_register uuid;
begin
  v_permission:=case p_command->>'commandType'
    when 'print_receipt' then 'hardware.printer.print'
    when 'controlled_reprint' then 'hardware.printer.reprint'
    when 'print_test_page' then 'hardware.printer.test'
    when 'open_drawer' then 'hardware.drawer.open'
    when 'test_drawer' then 'hardware.drawer.test'
    when 'begin_scanner_session' then 'hardware.scanner.use'
    when 'update_customer_display' then 'hardware.customer_display.use'
    else 'hardware.diagnostics' end;
  v_session:=merchant.assert_hardware_scope(
    (p_command->>'merchantId')::uuid,(p_command->>'locationId')::uuid,
    (p_command->>'operatorSessionId')::uuid,v_permission
  );
  if not ('*'=any(v_session.permissions)
    or 'hardware.command.execute'=any(v_session.permissions))
  then raise exception 'HARDWARE_PERMISSION_DENIED'; end if;
  select id,payload_fingerprint into v_existing,v_existing_fingerprint from merchant.hardware_command
    where merchant_id=(p_command->>'merchantId')::uuid
      and idempotency_key=p_command->>'idempotencyKey';
  if v_existing is not null then
    if v_existing<>(p_command->>'commandId')::uuid
      or v_existing_fingerprint<>p_command->>'payloadFingerprint'
    then raise exception 'HARDWARE_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing;
  end if;
  select * into v_device from merchant.hardware_device
    where id=(p_command->>'hardwareId')::uuid
      and merchant_id=(p_command->>'merchantId')::uuid for update;
  if not found then raise exception 'HARDWARE_NOT_FOUND'; end if;
  if not v_device.enabled or v_device.archived_at is not null then raise exception 'HARDWARE_DISABLED'; end if;
  if v_device.location_id<>(p_command->>'locationId')::uuid then raise exception 'HARDWARE_LOCATION_SCOPE'; end if;
  if v_device.assigned_pos_device_id is distinct from v_session.device_id
  then raise exception 'HARDWARE_NOT_ASSIGNED'; end if;
  if v_device.register_id is distinct from nullif(p_command->>'registerId','')::uuid
  then raise exception 'HARDWARE_REGISTER_SCOPE'; end if;
  if v_device.configuration_version<>(p_command->>'configurationVersion')::bigint
  then raise exception 'HARDWARE_CONFIGURATION_STALE'; end if;
  if v_device.device_type in ('payment_terminal_foundation','scale_foundation')
  then raise exception 'HARDWARE_FOUNDATION_ONLY'; end if;
  v_capability:=case p_command->>'commandType'
    when 'print_receipt' then 'printer.receipt'
    when 'controlled_reprint' then 'printer.receipt'
    when 'print_test_page' then 'printer.test_page'
    when 'open_drawer' then 'drawer.open'
    when 'test_drawer' then 'drawer.open'
    when 'begin_scanner_session' then 'scanner.barcode'
    when 'update_customer_display' then 'customer_display.totals'
    else null end;
  if v_capability is not null and not v_capability=any(v_device.capabilities)
  then raise exception 'HARDWARE_CAPABILITY_UNSUPPORTED'; end if;
  if p_command->>'commandType'='print_receipt' and not exists(
    select 1 from merchant.receipt_snapshot r
      where r.id=(p_command->>'sourceAggregateId')::uuid
        and r.merchant_id=(p_command->>'merchantId')::uuid
        and r.location_id=(p_command->>'locationId')::uuid
    union all
    select 1 from merchant.pos_exception_receipt r
      where r.id=(p_command->>'sourceAggregateId')::uuid
        and r.merchant_id=(p_command->>'merchantId')::uuid
        and r.location_id=(p_command->>'locationId')::uuid
  ) then raise exception 'HARDWARE_RECEIPT_NOT_FOUND'; end if;
  if p_command->>'commandType'='open_drawer' then
    v_reason:=p_command->'safePayload'->'drawer'->>'reason';
    v_source_register:=case v_reason
      when 'cash_sale' then (select register_id from merchant.cash_ledger_entry
        where merchant_id=(p_command->>'merchantId')::uuid
          and location_id=(p_command->>'locationId')::uuid
          and sale_id=(p_command->>'sourceAggregateId')::uuid and entry_type='cash_sale')
      when 'cash_refund' then (select register_id from merchant.cash_ledger_entry
        where merchant_id=(p_command->>'merchantId')::uuid
          and location_id=(p_command->>'locationId')::uuid
          and sale_exception_id=(p_command->>'sourceAggregateId')::uuid
          and entry_type='cash_refund')
      when 'paid_in' then (select register_id from merchant.cash_ledger_entry
        where merchant_id=(p_command->>'merchantId')::uuid
          and location_id=(p_command->>'locationId')::uuid
          and command_id=(p_command->>'sourceAggregateId')::uuid and entry_type='paid_in')
      when 'paid_out' then (select register_id from merchant.cash_ledger_entry
        where merchant_id=(p_command->>'merchantId')::uuid
          and location_id=(p_command->>'locationId')::uuid
          and command_id=(p_command->>'sourceAggregateId')::uuid and entry_type='paid_out')
      when 'safe_drop' then (select register_id from merchant.cash_ledger_entry
        where merchant_id=(p_command->>'merchantId')::uuid
          and location_id=(p_command->>'locationId')::uuid
          and command_id=(p_command->>'sourceAggregateId')::uuid and entry_type='safe_drop')
      when 'register_open' then (select register_id from merchant.cash_ledger_entry
        where merchant_id=(p_command->>'merchantId')::uuid
          and location_id=(p_command->>'locationId')::uuid
          and command_id=(p_command->>'sourceAggregateId')::uuid and entry_type='opening_float')
      when 'register_close_foundation' then (select s.register_id
        from merchant.cash_shift_close c join merchant.cash_shift s on s.id=c.shift_id
        where c.merchant_id=(p_command->>'merchantId')::uuid
          and c.location_id=(p_command->>'locationId')::uuid
          and c.command_id=(p_command->>'sourceAggregateId')::uuid)
      when 'no_sale' then (select register_id from merchant.no_sale_drawer_event
        where merchant_id=(p_command->>'merchantId')::uuid
          and location_id=(p_command->>'locationId')::uuid
          and command_id=(p_command->>'sourceAggregateId')::uuid)
      else null end;
    if v_source_register is null then raise exception 'HARDWARE_CASH_FACT_REQUIRED'; end if;
    if v_source_register is distinct from v_device.register_id
      or v_source_register is distinct from nullif(p_command->>'registerId','')::uuid
    then raise exception 'HARDWARE_REGISTER_SCOPE'; end if;
  end if;
  insert into merchant.hardware_command(
    id,merchant_id,location_id,register_id,hardware_id,originating_pos_device_id,
    operator_id,operator_session_id,command_type,source_aggregate_type,source_aggregate_id,
    payload_fingerprint,idempotency_key,correlation_id,expected_configuration_version,safe_payload
  ) values (
    (p_command->>'commandId')::uuid,(p_command->>'merchantId')::uuid,
    (p_command->>'locationId')::uuid,nullif(p_command->>'registerId','')::uuid,
    v_device.id,v_session.device_id,v_session.user_id,v_session.id,p_command->>'commandType',
    p_command->>'sourceAggregateType',p_command->>'sourceAggregateId',
    p_command->>'payloadFingerprint',p_command->>'idempotencyKey',p_command->>'correlationId',
    (p_command->>'configurationVersion')::bigint,coalesce(p_command->'safePayload','{}'::jsonb)
  );
  insert into merchant.hardware_command_event(merchant_id,command_id,sequence,status)
    values((p_command->>'merchantId')::uuid,(p_command->>'commandId')::uuid,1,'pending');
  if p_command->>'commandType' in ('print_receipt','print_test_page') then
    insert into merchant.hardware_print_job(
      id,merchant_id,location_id,register_id,printer_id,command_id,job_type,
      source_aggregate_type,source_aggregate_id,correlation_id,idempotency_key,
      payload_fingerprint,safe_document
    ) values(
      coalesce(nullif(p_command->>'printJobId','')::uuid,gen_random_uuid()),
      (p_command->>'merchantId')::uuid,(p_command->>'locationId')::uuid,
      nullif(p_command->>'registerId','')::uuid,v_device.id,(p_command->>'commandId')::uuid,
      case when p_command->>'commandType'='print_receipt' then 'official_receipt' else 'test_page' end,
      p_command->>'sourceAggregateType',p_command->>'sourceAggregateId',p_command->>'correlationId',
      p_command->>'idempotencyKey',p_command->>'payloadFingerprint',
      coalesce(p_command->'safePayload','{}'::jsonb)
    );
  end if;
  return (p_command->>'commandId')::uuid;
end $$;

create or replace function merchant.register_hardware_device(p_device jsonb)
returns uuid language plpgsql security definer
set search_path=pg_catalog,merchant,runtime,umi as $$
declare v_session runtime.operator_session%rowtype; v_id uuid; v_foundation boolean;
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
  v_foundation:=(p_device->>'deviceType') in (
    'payment_terminal_foundation','scale_foundation'
  );
  insert into merchant.hardware_device(
    merchant_id,location_id,register_id,assigned_pos_device_id,device_type,manufacturer,
    model,public_reference,physical_identity_hash,transport,capabilities,enabled,created_by
  ) values(
    (p_device->>'merchantId')::uuid,(p_device->>'locationId')::uuid,
    nullif(p_device->>'registerId','')::uuid,nullif(p_device->>'assignedPosDeviceId','')::uuid,
    p_device->>'deviceType',p_device->>'manufacturer',p_device->>'model',
    p_device->>'publicReference',nullif(p_device->>'physicalIdentityHash',''),
    p_device->>'transport',array(select jsonb_array_elements_text(p_device->'capabilities')),
    not v_foundation,v_session.user_id
  ) returning id into v_id;
  return v_id;
end $$;

create or replace function merchant.update_hardware_device(p_device jsonb)
returns uuid language plpgsql security definer
set search_path=pg_catalog,merchant,runtime,umi as $$
declare v_session runtime.operator_session%rowtype; v_row merchant.hardware_device%rowtype;
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
  update merchant.hardware_device set enabled=(p_device->>'enabled')::boolean,
    configuration_version=configuration_version+1,optimistic_version=optimistic_version+1,
    updated_at=clock_timestamp()
  where id=v_row.id;
  return v_row.id;
end $$;

create or replace function merchant.assign_hardware_device(p_assignment jsonb)
returns uuid language plpgsql security definer
set search_path=pg_catalog,merchant,runtime,umi as $$
declare v_session runtime.operator_session%rowtype; v_row merchant.hardware_device%rowtype;
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

create or replace function merchant.record_hardware_diagnostic(p_diagnostic jsonb)
returns uuid language plpgsql security definer
set search_path=pg_catalog,merchant,runtime,umi as $$
declare v_session runtime.operator_session%rowtype; v_id uuid; v_permission text;
begin
  v_permission:=case p_diagnostic->>'diagnostic'
    when 'printer_test_page' then 'hardware.printer.test'
    when 'drawer_test' then 'hardware.drawer.test'
    when 'scanner_test_session' then 'hardware.scanner.test'
    when 'customer_display_test' then 'hardware.customer_display.test'
    else 'hardware.diagnostics' end;
  v_session:=merchant.assert_hardware_scope(
    (p_diagnostic->>'merchantId')::uuid,(p_diagnostic->>'locationId')::uuid,
    (p_diagnostic->>'operatorSessionId')::uuid,v_permission
  );
  v_id:=(p_diagnostic->>'diagnosticId')::uuid;
  insert into merchant.hardware_diagnostic(
    id,merchant_id,location_id,hardware_id,operator_id,diagnostic_type,health,
    connection_state,capability_snapshot,latency_ms,failure_code,correlation_id,safe_result
  ) select v_id,(p_diagnostic->>'merchantId')::uuid,(p_diagnostic->>'locationId')::uuid,
    d.id,v_session.user_id,p_diagnostic->>'diagnostic',p_diagnostic->>'health',
    p_diagnostic->>'connectionState',d.capabilities,
    nullif(p_diagnostic->>'latencyMs','')::integer,nullif(p_diagnostic->>'failureCode',''),
    p_diagnostic->>'correlationId',coalesce(p_diagnostic->'safeResult','{}'::jsonb)
  from merchant.hardware_device d where d.id=(p_diagnostic->>'hardwareId')::uuid
    and d.merchant_id=(p_diagnostic->>'merchantId')::uuid
    and d.location_id=(p_diagnostic->>'locationId')::uuid;
  if not found then raise exception 'HARDWARE_NOT_FOUND'; end if;
  update merchant.hardware_device set last_diagnostic_at=clock_timestamp(),
    connection_state=p_diagnostic->>'connectionState',updated_at=clock_timestamp()
    where id=(p_diagnostic->>'hardwareId')::uuid;
  return v_id;
end $$;

create or replace function merchant.transition_hardware_command(
  p_merchant_id uuid,p_location_id uuid,p_operator_session_id uuid,p_command_id uuid,
  p_status text,p_failure_code text,p_safe_result jsonb
) returns bigint language plpgsql security definer
set search_path=pg_catalog,merchant,runtime,umi as $$
declare v_sequence bigint; v_print_sequence bigint; v_current text; v_attempt integer;
  v_dispatch_count integer; v_effective_status text; v_effective_failure text;
  v_print_status text; v_permission text; v_session runtime.operator_session%rowtype;
  v_command merchant.hardware_command%rowtype;
begin
  select * into v_command from merchant.hardware_command
    where merchant_id=p_merchant_id and location_id=p_location_id and id=p_command_id
    for update;
  if not found then raise exception 'HARDWARE_NOT_FOUND'; end if;
  v_session:=merchant.assert_hardware_scope(
    p_merchant_id,p_location_id,p_operator_session_id,'hardware.command.execute'
  );
  if v_command.originating_pos_device_id<>v_session.device_id
    or v_command.operator_session_id<>v_session.id
  then raise exception 'HARDWARE_NOT_ASSIGNED'; end if;
  v_permission:=case v_command.command_type
    when 'print_receipt' then 'hardware.printer.print'
    when 'controlled_reprint' then 'hardware.printer.reprint'
    when 'print_test_page' then 'hardware.printer.test'
    when 'open_drawer' then 'hardware.drawer.open'
    when 'test_drawer' then 'hardware.drawer.test'
    when 'begin_scanner_session' then 'hardware.scanner.use'
    when 'update_customer_display' then 'hardware.customer_display.use'
    else 'hardware.diagnostics' end;
  if not ('*'=any(v_session.permissions) or v_permission=any(v_session.permissions))
  then raise exception 'HARDWARE_PERMISSION_DENIED'; end if;
  select status into v_current from merchant.hardware_command_event
    where merchant_id=p_merchant_id and command_id=p_command_id order by sequence desc limit 1;
  if v_current in ('succeeded','failed','cancelled','unknown') then return (
    select max(sequence) from merchant.hardware_command_event
    where merchant_id=p_merchant_id and command_id=p_command_id
  ); end if;
  if not (
    (v_current='pending' and p_status in ('dispatching','cancelled'))
    or (v_current='dispatching' and p_status in ('succeeded','failed','retryable','unknown'))
    or (v_current='retryable' and p_status in ('dispatching','cancelled'))
  ) then raise exception 'HARDWARE_TRANSITION_CONFLICT'; end if;
  v_effective_status:=p_status;
  v_effective_failure:=p_failure_code;
  select count(*)::integer into v_dispatch_count
    from merchant.hardware_command_event
    where merchant_id=p_merchant_id and command_id=p_command_id and status='dispatching';
  if p_status='retryable' and v_dispatch_count>=3 then
    v_effective_status:='failed';
    v_effective_failure:='terminal_hardware_failure';
  end if;
  select coalesce(max(sequence),0)+1 into v_sequence from merchant.hardware_command_event
    where merchant_id=p_merchant_id and command_id=p_command_id;
  insert into merchant.hardware_command_event(
    merchant_id,command_id,sequence,status,failure_code,safe_result
  ) values(
    p_merchant_id,p_command_id,v_sequence,v_effective_status,v_effective_failure,
    coalesce(p_safe_result,'{}')
  );
  v_print_status:=case v_effective_status
    when 'dispatching' then 'printing'
    when 'succeeded' then 'printed'
    when 'retryable' then 'retryable_failure'
    when 'failed' then 'terminal_failure'
    when 'cancelled' then 'cancelled'
    when 'unknown' then 'unknown_outcome'
    else null end;
  if v_print_status is not null and exists(
    select 1 from merchant.hardware_print_job
    where merchant_id=p_merchant_id and command_id=p_command_id
  ) then
    select coalesce(max(attempt),0) into v_attempt
      from merchant.hardware_print_job_event
      where merchant_id=p_merchant_id and print_job_id=p_command_id;
    if v_print_status='printing' then v_attempt:=v_attempt+1; end if;
    select coalesce(max(sequence),0)+1 into v_print_sequence
      from merchant.hardware_print_job_event
      where merchant_id=p_merchant_id and print_job_id=p_command_id;
    insert into merchant.hardware_print_job_event(
      merchant_id,print_job_id,sequence,status,attempt,failure_code,safe_result
    ) values(
      p_merchant_id,p_command_id,v_print_sequence,v_print_status,
      v_attempt,v_effective_failure,
      coalesce(p_safe_result,'{}')
    );
  end if;
  return v_sequence;
end $$;

create or replace function merchant.create_controlled_reprint(
  p_merchant_id uuid,p_location_id uuid,p_operator_session_id uuid,p_original_job_id uuid,
  p_job_id uuid,p_command_id uuid,p_idempotency_key text,p_reason text,p_correlation_id text,
  p_payload_fingerprint text
) returns uuid language plpgsql security definer
set search_path=pg_catalog,merchant,runtime,umi as $$
declare v_session runtime.operator_session%rowtype; v_original merchant.hardware_print_job%rowtype;
  v_existing_job uuid; v_existing_command uuid; v_existing_fingerprint text;
begin
  v_session:=merchant.assert_hardware_scope(
    p_merchant_id,p_location_id,p_operator_session_id,'hardware.printer.reprint'
  );
  select id,command_id,payload_fingerprint
    into v_existing_job,v_existing_command,v_existing_fingerprint
    from merchant.hardware_print_job
    where merchant_id=p_merchant_id and idempotency_key=p_idempotency_key;
  if v_existing_job is not null then
    if v_existing_job<>p_job_id or v_existing_command<>p_command_id
      or v_existing_fingerprint<>p_payload_fingerprint
    then raise exception 'HARDWARE_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing_job;
  end if;
  select * into v_original from merchant.hardware_print_job
    where merchant_id=p_merchant_id and location_id=p_location_id
      and id=p_original_job_id for update;
  if not found then raise exception 'HARDWARE_PRINT_JOB_NOT_FOUND'; end if;
  if not exists(select 1 from merchant.hardware_device d
    where d.id=v_original.printer_id and d.merchant_id=p_merchant_id
      and d.location_id=p_location_id and d.enabled and d.archived_at is null
      and d.assigned_pos_device_id=v_session.device_id
      and d.register_id is not distinct from v_original.register_id)
  then raise exception 'HARDWARE_NOT_ASSIGNED'; end if;
  insert into merchant.hardware_command(
    id,merchant_id,location_id,register_id,hardware_id,originating_pos_device_id,
    operator_id,operator_session_id,command_type,source_aggregate_type,source_aggregate_id,
    payload_fingerprint,idempotency_key,correlation_id,expected_configuration_version,safe_payload
  ) select p_command_id,p_merchant_id,p_location_id,register_id,printer_id,v_session.device_id,
    v_session.user_id,v_session.id,'controlled_reprint',source_aggregate_type,source_aggregate_id,
    p_payload_fingerprint,p_idempotency_key,p_correlation_id,d.configuration_version,
    v_original.safe_document||jsonb_build_object('reason',p_reason,'copy',true)
  from merchant.hardware_device d where d.id=v_original.printer_id;
  insert into merchant.hardware_command_event(merchant_id,command_id,sequence,status)
    values(p_merchant_id,p_command_id,1,'pending');
  insert into merchant.hardware_print_job(
    id,merchant_id,location_id,register_id,printer_id,command_id,job_type,
    source_aggregate_type,source_aggregate_id,original_job_id,correlation_id,idempotency_key,
    payload_fingerprint,copies,maximum_attempts,safe_document
  ) values(
    p_job_id,p_merchant_id,p_location_id,v_original.register_id,v_original.printer_id,p_command_id,
    'receipt_copy',v_original.source_aggregate_type,v_original.source_aggregate_id,v_original.id,
    p_correlation_id,p_idempotency_key,p_payload_fingerprint,1,3,
    v_original.safe_document||jsonb_build_object('copy',true)
  );
  return p_job_id;
exception when unique_violation then
  select id,command_id,payload_fingerprint
    into v_existing_job,v_existing_command,v_existing_fingerprint
    from merchant.hardware_print_job
    where merchant_id=p_merchant_id and idempotency_key=p_idempotency_key;
  if v_existing_job is null or v_existing_job<>p_job_id
    or v_existing_command<>p_command_id or v_existing_fingerprint<>p_payload_fingerprint
  then raise exception 'HARDWARE_IDEMPOTENCY_CONFLICT'; end if;
  return v_existing_job;
end $$;

create or replace function merchant.read_hardware_runtime(
  p_merchant_id uuid,p_location_id uuid,p_operator_session_id uuid,p_register_id uuid default null
) returns table(
  hardware_id uuid,device_type text,manufacturer text,model text,public_reference text,
  transport text,capabilities text[],enabled boolean,configuration_version bigint,
  connection_state text,firmware_version text,last_heartbeat_at timestamptz,
  last_diagnostic_at timestamptz,register_id uuid,assigned_pos_device_id uuid,
  latest_command_status text,pending_print_jobs bigint
) language sql volatile security definer
set search_path=pg_catalog,merchant,runtime,umi as $$
  with allowed as (
    select merchant.assert_hardware_scope(
      p_merchant_id,p_location_id,p_operator_session_id,'hardware.read'
    ) session_row
  )
  select d.id,d.device_type,d.manufacturer,d.model,d.public_reference,d.transport,
    d.capabilities,d.enabled,d.configuration_version,d.connection_state,d.firmware_version,
    d.last_heartbeat_at,d.last_diagnostic_at,d.register_id,d.assigned_pos_device_id,
    (select e.status from merchant.hardware_command c
      join merchant.hardware_command_event e on e.merchant_id=c.merchant_id and e.command_id=c.id
      where c.hardware_id=d.id order by c.created_at desc,e.sequence desc limit 1),
    (select count(*) from merchant.hardware_print_job j
      where j.printer_id=d.id and not exists(
        select 1 from merchant.hardware_print_job_event pe where pe.print_job_id=j.id
          and pe.status in ('printed','terminal_failure','cancelled','unknown_outcome')
      ))
  from merchant.hardware_device d cross join allowed
  where d.merchant_id=p_merchant_id and d.location_id=p_location_id
    and (p_register_id is null or d.register_id=p_register_id)
    and d.archived_at is null order by d.device_type,d.public_reference
$$;

create or replace function merchant.hardware_immutable() returns trigger language plpgsql as $$
begin raise exception 'HARDWARE_FACT_IMMUTABLE'; end $$;
create trigger hardware_command_immutable before update or delete on merchant.hardware_command
  for each row execute function merchant.hardware_immutable();
create trigger hardware_command_event_immutable before update or delete on merchant.hardware_command_event
  for each row execute function merchant.hardware_immutable();
create trigger hardware_print_job_immutable before update or delete on merchant.hardware_print_job
  for each row execute function merchant.hardware_immutable();
create trigger hardware_print_job_event_immutable before update or delete on merchant.hardware_print_job_event
  for each row execute function merchant.hardware_immutable();
create trigger hardware_diagnostic_immutable before update or delete on merchant.hardware_diagnostic
  for each row execute function merchant.hardware_immutable();

do $$ declare t text; begin foreach t in array array[
  'hardware_device','hardware_assignment','hardware_command','hardware_command_event',
  'hardware_print_job','hardware_print_job_event','hardware_diagnostic'
] loop
  execute format('alter table merchant.%I enable row level security',t);
  execute format('alter table merchant.%I force row level security',t);
  execute format(
    'create policy %I on merchant.%I using (merchant_id=umi.current_merchant()) '
    'with check (merchant_id=umi.current_merchant())',t||'_merchant_scope',t
  );
end loop; end $$;

create policy hardware_device_location_scope on merchant.hardware_device as restrictive
  using(location_id=umi.current_location()) with check(location_id=umi.current_location());
create policy hardware_assignment_location_scope on merchant.hardware_assignment as restrictive
  using(location_id=umi.current_location()) with check(location_id=umi.current_location());
create policy hardware_command_location_scope on merchant.hardware_command as restrictive
  using(location_id=umi.current_location()) with check(location_id=umi.current_location());
create policy hardware_command_event_location_scope on merchant.hardware_command_event as restrictive
  using(exists(select 1 from merchant.hardware_command c
    where c.merchant_id=hardware_command_event.merchant_id
      and c.id=hardware_command_event.command_id
      and c.location_id=umi.current_location()))
  with check(exists(select 1 from merchant.hardware_command c
    where c.merchant_id=hardware_command_event.merchant_id
      and c.id=hardware_command_event.command_id
      and c.location_id=umi.current_location()));
create policy hardware_print_job_location_scope on merchant.hardware_print_job as restrictive
  using(location_id=umi.current_location()) with check(location_id=umi.current_location());
create policy hardware_print_job_event_location_scope on merchant.hardware_print_job_event as restrictive
  using(exists(select 1 from merchant.hardware_print_job j
    where j.merchant_id=hardware_print_job_event.merchant_id
      and j.id=hardware_print_job_event.print_job_id
      and j.location_id=umi.current_location()))
  with check(exists(select 1 from merchant.hardware_print_job j
    where j.merchant_id=hardware_print_job_event.merchant_id
      and j.id=hardware_print_job_event.print_job_id
      and j.location_id=umi.current_location()));
create policy hardware_diagnostic_location_scope on merchant.hardware_diagnostic as restrictive
  using(location_id=umi.current_location()) with check(location_id=umi.current_location());

revoke all on merchant.hardware_device,merchant.hardware_assignment,merchant.hardware_command,
  merchant.hardware_command_event,merchant.hardware_print_job,merchant.hardware_print_job_event,
  merchant.hardware_diagnostic from public,api,worker,readonly;
grant select on merchant.hardware_device,merchant.hardware_assignment,merchant.hardware_command,
  merchant.hardware_command_event,merchant.hardware_print_job,merchant.hardware_print_job_event,
  merchant.hardware_diagnostic to api;
grant execute on function merchant.create_hardware_command(jsonb),
  merchant.register_hardware_device(jsonb),merchant.update_hardware_device(jsonb),
  merchant.assign_hardware_device(jsonb),merchant.record_hardware_diagnostic(jsonb),
  merchant.transition_hardware_command(uuid,uuid,uuid,uuid,text,text,jsonb),
  merchant.create_controlled_reprint(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text),
  merchant.read_hardware_runtime(uuid,uuid,uuid,uuid) to api;
revoke all on function merchant.create_hardware_command(jsonb),
  merchant.register_hardware_device(jsonb),merchant.update_hardware_device(jsonb),
  merchant.assign_hardware_device(jsonb),merchant.record_hardware_diagnostic(jsonb),
  merchant.transition_hardware_command(uuid,uuid,uuid,uuid,text,text,jsonb),
  merchant.create_controlled_reprint(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text),
  merchant.read_hardware_runtime(uuid,uuid,uuid,uuid) from public,worker,readonly;

commit;
