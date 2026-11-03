-- ============================================================================
-- 011 · A hardware command without an open shift names no register
--
-- WHY. `merchant.create_hardware_command` demanded
-- `v_device.register_id is not distinct from the command's register`, which threw
-- `HARDWARE_REGISTER_SCOPE` when the command named NO register at all: `null is
-- distinct from <the printer's register>` is true. The till names a register only
-- while a shift is OPEN — `CashController.activeRegisterId` reads the current
-- shift and answers null for every other state — so every hardware command died
-- the moment the drawer was counted.
--
-- ON THE PILOT TILL, 2026-10-08: the shift was in `counting`, "Ejecutar prueba"
-- in the hardware centre answered `REGISTER_SCOPE_VIOLATION`, and the app showed
-- "La prueba no llegó al dispositivo". A test page never entered the print queue.
-- That is the worst possible moment for the button to fail: testing the printer
-- is the thing an operator does while opening or closing the drawer.
--
-- WHAT IT DOES. A command that NAMES a register must still name THIS device's
-- register. A command that names none is scoped by the device assignment, which
-- is the same rule the dashboard path has always applied
-- (`if (input.registerId && input.registerId !== target.registerId)`).
--
-- The drawer stays strict — `open_drawer` and `test_drawer` still demand a named
-- register, and `open_drawer` passes only by matching the register the cash
-- ledger row belongs to, which it checks again below. Nothing about money moves:
-- an unnamed register can now print a test page, run a scanner session or drive a
-- customer display, and nothing else.
--
-- RE-RUNNABLE. `create or replace function` against an unchanged signature. No
-- `begin;` — the caller owns the transaction.
-- ============================================================================

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
  if nullif(p_command->>'registerId','') is not null
    and v_device.register_id is distinct from (p_command->>'registerId')::uuid
  then raise exception 'HARDWARE_REGISTER_SCOPE'; end if;
  if nullif(p_command->>'registerId','') is null
    and p_command->>'commandType' in ('open_drawer','test_drawer')
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
