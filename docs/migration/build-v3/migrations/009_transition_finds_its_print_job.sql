-- ============================================================================
-- 009 · A transition finds the print job that belongs to its command
--
-- WHY. `merchant.transition_hardware_command` wrote the print job's own event
-- with `print_job_id = p_command_id`, and only checked that *a* job existed for
-- the command. That works for an ordinary print, because `create_hardware_command`
-- files the job under the command's id (`printJobId` is the command id). It is
-- wrong for a controlled reprint: the reprint has its own job id and dispatches
-- through a second, derived command, so the insert pointed at a job that does not
-- exist and Postgres refused with a foreign key violation (23503).
--
-- The till saw "La copia no se imprimió" and the command sat at `pending`
-- forever. Found on the pilot till, 2026-10-07, after 008 unblocked the reprint
-- at the source.
--
-- WHAT IT DOES. Resolves the job by its command and uses that id, for the
-- attempt count, the sequence and the insert. Behaviour is unchanged when the
-- job and the command share an id.
--
-- RE-RUNNABLE. `create or replace function` against an unchanged signature. No
-- `begin;` — the caller owns the transaction.
-- ============================================================================

create or replace function merchant.transition_hardware_command(
  p_merchant_id uuid,p_location_id uuid,p_operator_session_id uuid,p_command_id uuid,
  p_status text,p_failure_code text,p_safe_result jsonb
) returns bigint language plpgsql security definer
set search_path=pg_catalog,merchant,runtime,umi as $$
declare v_sequence bigint; v_print_sequence bigint; v_current text; v_attempt integer;
  v_dispatch_count integer; v_effective_status text; v_effective_failure text;
  v_print_status text; v_permission text; v_session runtime.operator_session%rowtype;
  v_command merchant.hardware_command%rowtype; v_print_job_id uuid;
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
  select id into v_print_job_id from merchant.hardware_print_job
    where merchant_id=p_merchant_id and command_id=p_command_id
    order by created_at limit 1;
  if v_print_status is not null and v_print_job_id is not null then
    select coalesce(max(attempt),0) into v_attempt
      from merchant.hardware_print_job_event
      where merchant_id=p_merchant_id and print_job_id=v_print_job_id;
    if v_print_status='printing' then v_attempt:=v_attempt+1; end if;
    select coalesce(max(sequence),0)+1 into v_print_sequence
      from merchant.hardware_print_job_event
      where merchant_id=p_merchant_id and print_job_id=v_print_job_id;
    insert into merchant.hardware_print_job_event(
      merchant_id,print_job_id,sequence,status,attempt,failure_code,safe_result
    ) values(
      p_merchant_id,v_print_job_id,v_print_sequence,v_print_status,
      v_attempt,v_effective_failure,
      coalesce(p_safe_result,'{}')
    );
  end if;
  return v_sequence;
end $$;
