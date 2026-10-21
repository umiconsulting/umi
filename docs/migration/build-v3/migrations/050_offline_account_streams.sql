\set ON_ERROR_STOP on

-- A refused command is processed, but it is not accepted. Keep both facts.
alter table merchant.device_replay_cursor
  add column if not exists last_processed_sequence bigint not null default 0
  check (last_processed_sequence >= 0);

alter table merchant.offline_replay_command
  add column if not exists stream_key text;

alter table merchant.offline_replay_conflict
  add column if not exists credential_version integer;

alter table merchant.offline_replay_conflict
  add column if not exists stream_key text;

alter table merchant.offline_replay_conflict
  add column if not exists retryable boolean not null default false;

update merchant.offline_replay_conflict c
set credential_version=coalesce(
  (
    select r.credential_version
    from merchant.offline_replay_command r
    where r.command_id=c.command_id
  ),
  (
    select max(cur.credential_version)
    from merchant.device_replay_cursor cur
    where cur.device_id=c.device_id
  ),
  1
)
where c.credential_version is null;

alter table merchant.offline_replay_conflict
  alter column credential_version set not null;

update merchant.device_replay_cursor c
set last_processed_sequence=greatest(
  c.last_accepted_sequence,
  coalesce(
    (
      select max(r.device_sequence)
      from merchant.offline_replay_command r
      where r.device_id=c.device_id
        and r.credential_version=c.credential_version
    ),
    0
  ),
  coalesce(
    (
      select max(f.device_sequence)
      from merchant.offline_replay_conflict f
      where f.device_id=c.device_id
        and f.credential_version=c.credential_version
    ),
    0
  )
);

grant update (last_processed_sequence)
  on merchant.device_replay_cursor to api;

create or replace function merchant.record_offline_replay_conflict(
  p_merchant_id uuid,
  p_location_id uuid,
  p_device_id uuid,
  p_credential_version integer,
  p_command_id uuid,
  p_device_sequence bigint,
  p_classification text,
  p_blocks_following boolean,
  p_guidance_code text,
  p_provisional_id uuid,
  p_command_type text,
  p_stream_key text,
  p_retryable boolean,
  p_advance_processed boolean
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, merchant, umi
as $$
declare
  v_id uuid;
begin
  if umi.current_merchant() is distinct from p_merchant_id
     or umi.current_location() is distinct from p_location_id
     or umi.current_device() is distinct from p_device_id then
    raise exception using
      errcode = '42501',
      message = 'offline conflict scope invalid';
  end if;

  insert into merchant.offline_replay_conflict
    (merchant_id,location_id,device_id,credential_version,command_id,
     device_sequence,classification,blocks_following,
     operator_action_required,manager_action_required,guidance_code,
     correlation_id,provisional_id,command_type,stream_key,retryable)
  values
    (p_merchant_id,p_location_id,p_device_id,p_credential_version,p_command_id,
     p_device_sequence,p_classification,p_blocks_following,
     true,false,p_guidance_code,p_command_id::text,p_provisional_id,
     p_command_type,p_stream_key,p_retryable)
  on conflict (merchant_id,device_id,command_id) do update
   set last_observed_at=clock_timestamp(),
       credential_version=excluded.credential_version,
       classification=excluded.classification,
       guidance_code=excluded.guidance_code,
       blocks_following=excluded.blocks_following,
       command_type=excluded.command_type,
       stream_key=excluded.stream_key,
       retryable=excluded.retryable
  returning id into v_id;

  if p_advance_processed then
    insert into merchant.device_replay_cursor
      (merchant_id,location_id,device_id,credential_version,last_processed_sequence)
    values
      (p_merchant_id,p_location_id,p_device_id,p_credential_version,p_device_sequence)
    on conflict (device_id,credential_version) do update
     set last_processed_sequence=greatest(
           merchant.device_replay_cursor.last_processed_sequence,
           excluded.last_processed_sequence
         ),
         updated_at=clock_timestamp();
  end if;

  return v_id;
end $$;

revoke all on function merchant.record_offline_replay_conflict(
  uuid,uuid,uuid,integer,uuid,bigint,text,boolean,text,uuid,text,text,boolean,boolean
) from public,readonly;

grant execute on function merchant.record_offline_replay_conflict(
  uuid,uuid,uuid,integer,uuid,bigint,text,boolean,text,uuid,text,text,boolean,boolean
) to api;

create index if not exists offline_replay_conflict_stream_open_idx
  on merchant.offline_replay_conflict
    (merchant_id, device_id, credential_version, stream_key)
  where resolution_state <> 'resolved' and stream_key is not null;
