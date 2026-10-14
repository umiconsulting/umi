-- ============================================================================
-- 008 · A controlled reprint can find its printer
--
-- WHY. `merchant.create_controlled_reprint` never ran. Its `hardware_command`
-- insert selected `register_id` and `printer_id` with no table qualifier, while
-- the only table in scope was `merchant.hardware_device` — which has no
-- `printer_id` column. Postgres answered `42703 column "printer_id" does not
-- exist`, the API mapped the unknown error to `HARDWARE_COMMAND_FAILED`, and the
-- till showed "La copia no se imprimió" for every receipt.
--
-- The two values belong to the print job being copied, not to the device, so the
-- insert now names them on `v_original`. The device row stays in the FROM: its
-- `configuration_version` is the version the reprint must match.
--
-- FOUND ON THE PILOT TILL, 2026-10-07: "Reimpresión controlada" on a paid
-- receipt refused with 409 `HARDWARE_COMMAND_FAILED`.
--
-- RE-RUNNABLE. `create or replace function` against a signature that does not
-- change. No `begin;` — the caller owns the transaction.
-- ============================================================================

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
  ) select p_command_id,p_merchant_id,p_location_id,v_original.register_id,
    v_original.printer_id,v_session.device_id,
    v_session.user_id,v_session.id,'controlled_reprint',v_original.source_aggregate_type,
    v_original.source_aggregate_id,
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
