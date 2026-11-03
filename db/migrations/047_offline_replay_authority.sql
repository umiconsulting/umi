\set ON_ERROR_STOP on

-- The command keeps its original operator for attribution. The row also keeps
-- the live operator session that authorized the replay after a lock or restart.
alter table merchant.offline_replay_command
  add column if not exists replay_operator_session_id uuid;

select merchant.with_append_only_writable(
  'merchant.offline_replay_command',
  $sql$
    update merchant.offline_replay_command
    set replay_operator_session_id = operator_session_id
    where replay_operator_session_id is null
  $sql$
);

alter table merchant.offline_replay_command
  alter column replay_operator_session_id set not null;

alter table merchant.offline_replay_command
  drop constraint if exists offline_replay_command_replay_session_fk;

alter table merchant.offline_replay_command
  add constraint offline_replay_command_replay_session_fk
  foreign key (replay_operator_session_id)
  references runtime.operator_session(id) on delete restrict;

create or replace function merchant.validate_offline_replay_authority() returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog as $$
declare
  device_record   record;
  operator_record record;
begin
  select merchant_id, location_id, credential_version, status
    into device_record
    from merchant.device where id = new.device_id;
  if not found
     or device_record.merchant_id <> new.merchant_id
     or device_record.location_id is distinct from new.location_id
     or device_record.credential_version <> new.credential_version
     or device_record.status <> 'active' then
    raise exception using errcode = '42501', message = 'offline replay authority invalid';
  end if;

  select merchant_id, location_id, device_id, state, expires_at, permissions
    into operator_record
    from runtime.operator_session where id = new.replay_operator_session_id;
  if not found
     or operator_record.merchant_id <> new.merchant_id
     or operator_record.location_id <> new.location_id
     or operator_record.device_id <> new.device_id
     or operator_record.state <> 'active'
     or operator_record.expires_at <= clock_timestamp()
     or not ('offline.replay' = any(operator_record.permissions)
             or '*' = any(operator_record.permissions)) then
    raise exception using errcode = '42501',
      message = 'offline replay operator authority invalid';
  end if;
  return new;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'merchant'
       and table_name = 'offline_replay_command'
       and column_name = 'replay_operator_session_id'
       and is_nullable = 'NO'
  ) then
    raise exception 'offline replay authority: replay_operator_session_id is missing';
  end if;
  if position(
    'new.replay_operator_session_id'
    in pg_get_functiondef('merchant.validate_offline_replay_authority()'::regprocedure)
  ) = 0 then
    raise exception 'offline replay authority: the trigger still reads the original session';
  end if;
end $$;
