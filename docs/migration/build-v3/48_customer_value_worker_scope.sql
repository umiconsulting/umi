\set ON_ERROR_STOP on
begin;

create or replace function merchant.assert_customer_value_write_scope(
  p_merchant_id uuid,p_device_id uuid default null
) returns void language plpgsql security definer set search_path=pg_catalog,umi as $$
declare v_api boolean; v_worker boolean; v_scoped_role boolean;
begin
  v_worker:=current_user='worker' or session_user='worker'
    or current_setting('role',true)='worker' or (
    not coalesce((select rolsuper from pg_roles where rolname=session_user),false)
    and pg_has_role(session_user,'worker','USAGE')
  );
  v_api:=not v_worker and (current_user='api' or session_user='api'
    or current_setting('role',true)='api' or (
    not coalesce((select rolsuper from pg_roles where rolname=session_user),false)
    and pg_has_role(session_user,'api','USAGE')
  ));
  v_scoped_role:=v_api or v_worker;
  if v_scoped_role and umi.current_merchant() is null
  then raise exception 'CUSTOMER_VALUE_CONTEXT_REQUIRED'; end if;
  if umi.current_merchant() is not null
     and p_merchant_id is distinct from umi.current_merchant()
  then raise exception 'CUSTOMER_VALUE_MERCHANT_SCOPE'; end if;
  if v_api and p_device_id is not null and umi.current_device() is null
  then raise exception 'CUSTOMER_VALUE_DEVICE_CONTEXT_REQUIRED'; end if;
  if umi.current_device() is not null and p_device_id is not null
     and p_device_id is distinct from umi.current_device()
  then raise exception 'CUSTOMER_VALUE_DEVICE_SCOPE'; end if;
end $$;

create or replace function merchant.expire_customer_value_authorizations_worker(
  p_merchant_id uuid,p_batch_size integer default 100
) returns integer language plpgsql security definer
set search_path=pg_catalog,merchant,umi as $$
begin
  if not (session_user='umi_worker_login' or pg_has_role(session_user,'worker','USAGE'))
  then raise exception 'CUSTOMER_VALUE_WORKER_REQUIRED'; end if;
  perform set_config('app.current_merchant',p_merchant_id::text,true);
  return merchant.expire_customer_value_authorizations(p_merchant_id,p_batch_size);
end $$;
revoke all on function merchant.expire_customer_value_authorizations_worker(uuid,integer) from public,api,readonly;
grant execute on function merchant.expire_customer_value_authorizations_worker(uuid,integer) to worker;

grant select,insert on merchant.offline_replay_command,
  merchant.offline_provisional_mapping,merchant.offline_replay_conflict,
  merchant.device_replay_cursor to api;
grant update (last_accepted_sequence,reconciliation_required,updated_at)
  on merchant.device_replay_cursor to api;

insert into runtime.schema_migration(version,status)
values('build-v3-48','applied') on conflict(version) do nothing;

commit;
