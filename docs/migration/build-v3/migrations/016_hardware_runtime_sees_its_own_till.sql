-- ============================================================================
-- 016 · The runtime a till reads includes the hardware attached to IT
--
-- WHY. `read_hardware_runtime` and `PosHardwareRepository.devices` both narrow
-- the register's hardware with `d.register_id = p_register_id`. A device that was
-- assigned to the PO'S TERMINAL rather than to a register — which is what the
-- hardware centre's assign action writes when the operator picks the till, and
-- what a USB printer physically plugged into the iMin is — has `register_id`
-- NULL and is therefore INVISIBLE to the till that owns it.
--
-- MEASURED, iMin D3-504, 2026-10-11. `merchant.hardware_device` holds the Epson
-- TM-T20IIIL, enabled, `printer.receipt`, `connection_state='connected'`, with an
-- open assignment to the till (`assigned_pos_device_id` = the iMin). Pressing
-- `Imprimir recibo` on a sale in Ventas raised, in the till's own words:
--
--   Unhandled Exception: Bad state: HARDWARE_RECEIPT_PRINTER_UNAVAILABLE
--
-- and nothing at all happened on the screen: no paper, no message, no recovery.
-- The reprint the owner asked about was dead because the query could not see a
-- printer that was plugged into exactly the terminal asking.
--
-- WHAT CHANGES. The function takes the calling POS device and admits a device
-- whose assignment points at it, in addition to the register's. Nothing is
-- widened beyond that: the same merchant, the same location, the same
-- `assert_hardware_scope` session check, and `archived_at is null`. A device with
-- no assignment of either kind still does not appear.
--
-- The 4-argument signature is DROPPED, not shadowed. A `create or replace` with a
-- fifth defaulted parameter would leave both signatures callable and make every
-- 4-argument call ambiguous; the API is the only caller.
--
-- Idempotent and re-runnable: the function is dropped and created again.
-- ============================================================================

-- BOTH signatures, so a second apply is clean: the 5-argument version this file
-- creates is a different function to Postgres, and `create function` refuses to
-- replace it (`already exists with same argument types`).
drop function if exists merchant.read_hardware_runtime(uuid, uuid, uuid, uuid);
drop function if exists merchant.read_hardware_runtime(uuid, uuid, uuid, uuid, uuid);

create function merchant.read_hardware_runtime(
  p_merchant_id uuid,
  p_location_id uuid,
  p_operator_session_id uuid,
  p_register_id uuid default null,
  p_pos_device_id uuid default null
)
returns table(
  hardware_id uuid,
  device_type text,
  manufacturer text,
  model text,
  public_reference text,
  transport text,
  capabilities text[],
  enabled boolean,
  configuration_version bigint,
  connection_state text,
  firmware_version text,
  last_heartbeat_at timestamp with time zone,
  last_diagnostic_at timestamp with time zone,
  register_id uuid,
  assigned_pos_device_id uuid,
  latest_command_status text,
  pending_print_jobs bigint
)
language sql
security definer
set search_path to 'pg_catalog', 'merchant', 'runtime', 'umi'
as $function$
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
    -- The register's hardware, OR the hardware attached to the terminal that is
    -- asking. A USB printer plugged into this till belongs to this till whether
    -- or not somebody also filed it against a register.
    and (
      p_register_id is null
      or d.register_id=p_register_id
      or (p_pos_device_id is not null and d.assigned_pos_device_id=p_pos_device_id)
    )
    and d.archived_at is null
  order by d.device_type,d.public_reference
$function$;

-- The runtime route is the only caller, and it now passes the device. The grant
-- follows the recreated function: `api` may execute it, nobody else may — the
-- same pair of statements 40_pos_hardware_runtime.sql wrote for the 4-argument
-- version (`revoke ... from public,worker,readonly` is what keeps a SECURITY
-- DEFINER function from becoming a way around RLS for the worker role).
grant execute on function merchant.read_hardware_runtime(uuid, uuid, uuid, uuid, uuid) to api;
revoke all on function merchant.read_hardware_runtime(uuid, uuid, uuid, uuid, uuid)
  from public, worker, readonly;
