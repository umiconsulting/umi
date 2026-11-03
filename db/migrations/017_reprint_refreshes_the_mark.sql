-- ============================================================================
-- 017 · A reprint carries a mark the till can still reach
--
-- WHY. A controlled reprint is a copy of the ORIGINAL job's payload, which is
-- right for everything that is content: the items, the totals, the taxes and the
-- receipt number are the document the customer already has, and a copy that
-- recomputed them would be a second document. The café's MARK is not content. It
-- is a URL, and a URL is a fact about the environment that wrote it: the payload
-- stored on 2026-10-11 says `http://127.0.0.1:4013/logos/…`, and after the local
-- environment was consolidated onto one API on `:4001` that address answers
-- nothing — so the till fetched nothing, and the copy printed without the mark
-- while the SAME receipt drew it on screen. Measured on the iMin D3-504: an
-- `official_receipt` job and its `receipt_copy` both carried `:4013`, and the
-- paper came out with the café's name and no jaguar.
--
-- WHAT IT DOES. The function stops deciding the copy's payload and takes it from
-- the caller, which is the shape every other hardware command already has
-- (`merchant.create_hardware_command` receives `safePayload`). The API resolves the
-- mark against `merchant.logo_url` — the café's mark AS IT IS NOW — before it
-- fingerprints the command, so the payload that is stored, the payload the till is
-- handed and the payload the fingerprint covers are ONE object.
--
-- WHY NOT IN SQL, which is where the payload used to be assembled. Because the
-- fingerprint is computed in JavaScript over the command the API returns, and a
-- rewrite here happens after that: the stored payload stopped matching its own
-- fingerprint, and the reprint answered `409 HARDWARE_COMMAND_FAILED` — measured,
-- 2026-10-11, the first time this migration ran. A rule that changes a document has
-- to live where the document's identity is computed.
--
-- WHEN THE ORIGINAL HAD NO MARK, the copy has none either: nothing is invented,
-- and a café without a logo keeps printing without one. A caller that passes no
-- payload at all (an older client, or a console that only names the job) falls back
-- to the original's document — the behaviour this function had before.
--
-- Idempotent and re-runnable: two `create or replace function`.
-- ============================================================================

-- The 10-argument version is dropped rather than shadowed: a defaulted parameter
-- would leave both callable and make every 10-argument call ambiguous.
--
-- The body below is the definition that is RUNNING, taken from the deployed
-- function rather than from `40_pos_hardware_runtime.sql`, which still carries the
-- `printer_id`-unqualified SELECT that `008_controlled_reprint_printer_id.sql`
-- corrected. Re-creating a function from a stale DDL file is how a fix becomes a
-- regression: the first version of this migration did exactly that and answered
-- `column "printer_id" does not exist` at the first reprint.
drop function if exists merchant.create_controlled_reprint(
  uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text
);
create or replace function merchant.create_controlled_reprint(
  p_merchant_id uuid,p_location_id uuid,p_operator_session_id uuid,p_original_job_id uuid,
  p_job_id uuid,p_command_id uuid,p_idempotency_key text,p_reason text,p_correlation_id text,
  p_payload_fingerprint text,
  -- The copy's payload, resolved by the caller. NULL means "the original's".
  p_payload jsonb default null
) returns uuid language plpgsql security definer
set search_path=pg_catalog,merchant,runtime,umi as $$
declare v_session runtime.operator_session%rowtype; v_original merchant.hardware_print_job%rowtype;
  v_existing_job uuid; v_existing_command uuid; v_existing_fingerprint text; v_payload jsonb;
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
  -- The copy's payload, as the caller resolved it — or the original's when the
  -- caller did not name one. See the note at the head of this file.
  v_payload := coalesce(p_payload, v_original.safe_document);
  insert into merchant.hardware_command(
    id,merchant_id,location_id,register_id,hardware_id,originating_pos_device_id,
    operator_id,operator_session_id,command_type,source_aggregate_type,source_aggregate_id,
    payload_fingerprint,idempotency_key,correlation_id,expected_configuration_version,safe_payload
  ) select p_command_id,p_merchant_id,p_location_id,v_original.register_id,
    v_original.printer_id,v_session.device_id,
    v_session.user_id,v_session.id,'controlled_reprint',v_original.source_aggregate_type,
    v_original.source_aggregate_id,
    p_payload_fingerprint,p_idempotency_key,p_correlation_id,d.configuration_version,
    v_payload||jsonb_build_object('reason',p_reason,'copy',true)
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
    v_payload||jsonb_build_object('copy',true)
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
