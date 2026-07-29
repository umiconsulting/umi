-- Gate 2F final closeout: defense-in-depth replay authority validation.
insert into umi.permission (key, description)
values ('offline.recovery.review', 'Approve one scoped offline recovery action')
on conflict (key) do update set description=excluded.description;

create or replace function tenant.validate_offline_replay_authority()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  device_record record;
  operator_record record;
begin
  select business_id, branch_id, credential_version, lifecycle_state
    into device_record
    from tenant.device
   where id = new.device_id;
  if not found
     or device_record.business_id <> new.business_id
     or device_record.branch_id is distinct from new.branch_id
     or device_record.credential_version <> new.credential_version
     or device_record.lifecycle_state <> 'active' then
    raise exception using
      errcode = '42501',
      message = 'offline replay authority invalid';
  end if;

  select business_id, branch_id, device_id, state, expires_at, permissions
    into operator_record
    from runtime.operator_session
   where id = new.operator_session_id;
  if not found
     or operator_record.business_id <> new.business_id
     or operator_record.branch_id <> new.branch_id
     or operator_record.device_id <> new.device_id
     or operator_record.state <> 'active'
     or operator_record.expires_at <= clock_timestamp()
     or not (
       'offline.replay' = any(operator_record.permissions)
       or '*' = any(operator_record.permissions)
     ) then
    raise exception using
      errcode = '42501',
      message = 'offline replay operator authority invalid';
  end if;
  return new;
end
$$;

create trigger offline_replay_authority_guard
before insert on tenant.offline_replay_command
for each row execute function tenant.validate_offline_replay_authority();

revoke all on function tenant.validate_offline_replay_authority() from public;
