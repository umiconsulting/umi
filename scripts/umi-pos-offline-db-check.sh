#!/usr/bin/env bash
set -euo pipefail

name="umi-gate2f-db-$RANDOM"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

command -v docker >/dev/null || {
  echo "Docker is required for the disposable offline database check." >&2
  exit 1
}

docker run --rm -d --name "$name" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=umi_gate2f \
  pgvector/pgvector:pg16 >/dev/null
for _ in $(seq 1 30); do
  docker exec "$name" pg_isready -U postgres -d umi_gate2f >/dev/null 2>&1 &&
    break
  sleep 1
done
docker exec "$name" pg_isready -U postgres -d umi_gate2f >/dev/null

for migration in supabase/migrations/*.sql; do
  docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d umi_gate2f \
    <"$migration" >/dev/null
done

docker exec "$name" psql -v ON_ERROR_STOP=1 -U postgres -d umi_gate2f <<'SQL'
do $$
declare missing integer;
begin
  select count(*) into missing
  from (values
    ('pos_offline_policy'),('pos_offline_cash_policy'),('device_replay_cursor'),
    ('offline_replay_command'),('offline_reconciliation'),
    ('offline_replay_conflict'),('offline_provisional_mapping')
  ) expected(name)
  where not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='tenant' and c.relname=expected.name
      and c.relrowsecurity and c.relforcerowsecurity
  );
  if missing <> 0 then raise exception 'Gate 2F RLS/FORCE RLS check failed'; end if;
  if pg_get_constraintdef((
    select oid from pg_constraint
    where conrelid='tenant.offline_replay_command'::regclass
      and conname='offline_replay_command_command_type_check'
  )) not like '%pos.checkout.cash%' then
    raise exception 'Offline cash command constraint missing';
  end if;
  if exists (
    select 1
    from (values
      ('device_replay_cursor'),('offline_replay_command'),
      ('offline_reconciliation'),('offline_replay_conflict'),
      ('offline_provisional_mapping')
    ) expected(name)
    where not exists (
      select 1 from pg_policies p
      where p.schemaname='tenant' and p.tablename=expected.name
        and p.qual like '%current_branch%' and p.qual like '%current_device%'
        and p.qual not like '%current_branch() IS NULL%'
        and p.qual not like '%current_device() IS NULL%'
    )
  ) then
    raise exception 'Fail-closed branch/device RLS predicate missing';
  end if;
end $$;
SQL

docker exec "$name" psql -v ON_ERROR_STOP=1 -U postgres -d umi_gate2f <<'SQL'
insert into tenant.business(id,name) values
  ('10000000-0000-4000-8000-000000000001','Tenant A'),
  ('10000000-0000-4000-8000-000000000002','Tenant B');
insert into tenant.branch(id,business_id,name) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','A1'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','A2'),
  ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','B1');
insert into umi.user(id,email,full_name,status) values
  ('30000000-0000-4000-8000-000000000001','operator@example.test','Operator','active');
insert into tenant.staff(id,business_id,branch_id,user_id,status) values
  ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','active');
insert into tenant.device(id,business_id,branch_id,name,kind,status,lifecycle_state,credential_version) values
  ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001','POS A1','pos_terminal','active','active',1),
  ('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000002','POS A2','pos_terminal','active','active',1),
  ('50000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000003','POS B1','pos_terminal','active','active',1);
insert into runtime.session(id,user_id,device_id,app,token_hash,expires_at) values
  ('60000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001','pos','hash',now()+interval '1 hour');
insert into runtime.operator_session(
  id,durable_session_id,user_id,staff_id,device_id,business_id,branch_id,
  permissions,entitlements,expires_at
) values (
  '70000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',array['offline.replay'],
  '["pos.offline_cash"]',now()+interval '1 hour'
);
insert into tenant.pos_offline_cash_policy(
  business_id,branch_id,enabled,version,currency,max_policy_age_seconds,
  max_single_sale_minor_units,max_accumulated_minor_units,max_offline_sale_count,
  max_active_queue_depth,max_command_age_seconds,max_catalog_age_seconds,
  max_pricing_age_seconds,max_tax_age_seconds,expires_at
) values (
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  true,'test','MXN',600,10000,30000,3,10,3600,900,600,600,now()+interval '10 minutes'
);

set role api;
select set_config('app.current_business','10000000-0000-4000-8000-000000000001',false);
select set_config('app.current_branch','20000000-0000-4000-8000-000000000001',false);
select set_config('app.current_device','50000000-0000-4000-8000-000000000001',false);

insert into tenant.offline_replay_command(
  business_id,branch_id,device_id,credential_version,device_sequence,command_id,
  operator_session_id,idempotency_key,command_type,fingerprint,contract_version,
  schema_version,client_created_at,result,payload
) values (
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',1,1,
  '80000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001','operational.ack',
  repeat('a',64),'1.6.0',1,now(),'{}','{}'
);
insert into tenant.device_replay_cursor(
  business_id,branch_id,device_id,credential_version,last_accepted_sequence
) values (
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',1,1
);
insert into tenant.offline_reconciliation(
  id,business_id,branch_id,device_id,credential_version,summary
) values (
  '81000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',1,'{}'
);
insert into tenant.offline_replay_conflict(
  id,business_id,branch_id,device_id,command_id,device_sequence,classification,
  blocks_following,operator_action_required,manager_action_required,guidance_code,
  correlation_id
) values (
  '82000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',1,'sequence_gap',
  true,true,false,'sequence_gap','correlation-safe'
);

do $$
declare visible integer;
begin
  select count(*) into visible from tenant.offline_replay_command;
  if visible <> 1 then raise exception 'authorized replay command not visible'; end if;
  if (select count(*) from tenant.device_replay_cursor) <> 1
     or (select count(*) from tenant.offline_reconciliation) <> 1
     or (select count(*) from tenant.offline_replay_conflict) <> 1
     or (select count(*) from tenant.pos_offline_cash_policy) <> 1 then
    raise exception 'authorized replay support state not visible';
  end if;
  perform set_config('app.current_branch','20000000-0000-4000-8000-000000000002',false);
  select count(*) into visible from tenant.offline_replay_command;
  if visible <> 0 then raise exception 'branch replay isolation failed'; end if;
  if (select count(*) from tenant.device_replay_cursor) <> 0
     or (select count(*) from tenant.offline_reconciliation) <> 0
     or (select count(*) from tenant.offline_replay_conflict) <> 0
     or (select count(*) from tenant.pos_offline_cash_policy) <> 0 then
    raise exception 'branch replay support isolation failed';
  end if;
  perform set_config('app.current_branch','20000000-0000-4000-8000-000000000001',false);
  perform set_config('app.current_device','50000000-0000-4000-8000-000000000002',false);
  select count(*) into visible from tenant.offline_replay_command;
  if visible <> 0 then raise exception 'device replay isolation failed'; end if;
  perform set_config('app.current_device','50000000-0000-4000-8000-000000000001',false);
  perform set_config('app.current_business','10000000-0000-4000-8000-000000000002',false);
  perform set_config('app.current_branch','20000000-0000-4000-8000-000000000003',false);
  perform set_config('app.current_device','50000000-0000-4000-8000-000000000003',false);
  select count(*) into visible from tenant.offline_replay_command;
  if visible <> 0 then raise exception 'tenant replay isolation failed'; end if;
  perform set_config('app.current_business','',false);
  perform set_config('app.current_branch','',false);
  perform set_config('app.current_device','',false);
  if (select count(*) from tenant.offline_replay_command) <> 0
     or (select count(*) from tenant.device_replay_cursor) <> 0
     or (select count(*) from tenant.offline_reconciliation) <> 0
     or (select count(*) from tenant.offline_replay_conflict) <> 0 then
    raise exception 'unscoped replay access failed closed';
  end if;
end $$;

reset role;
do $$
begin
  begin update tenant.offline_replay_command set fingerprint=repeat('b',64)
    where command_id='80000000-0000-4000-8000-000000000001';
    raise exception 'immutable fingerprint update unexpectedly succeeded';
  exception when others then if sqlerrm='immutable fingerprint update unexpectedly succeeded' then raise; end if; end;
  begin update tenant.offline_replay_command set command_id=gen_random_uuid()
    where command_id='80000000-0000-4000-8000-000000000001';
    raise exception 'immutable command identity update unexpectedly succeeded';
  exception when others then if sqlerrm='immutable command identity update unexpectedly succeeded' then raise; end if; end;
  begin update tenant.offline_replay_command set device_sequence=99
    where command_id='80000000-0000-4000-8000-000000000001';
    raise exception 'immutable sequence update unexpectedly succeeded';
  exception when others then if sqlerrm='immutable sequence update unexpectedly succeeded' then raise; end if; end;
  begin update tenant.offline_replay_command set payload='{"changed":true}'
    where command_id='80000000-0000-4000-8000-000000000001';
    raise exception 'immutable payload update unexpectedly succeeded';
  exception when others then if sqlerrm='immutable payload update unexpectedly succeeded' then raise; end if; end;
  if not exists (
    select 1 from pg_trigger where tgrelid='tenant.offline_provisional_mapping'::regclass
      and tgname='offline_mapping_append_only' and tgenabled='O'
  ) then raise exception 'mapping append-only trigger missing'; end if;
  if (select count(*) from pg_constraint
      where conrelid='tenant.offline_provisional_mapping'::regclass
        and contype in ('p','u')) < 4 then
    raise exception 'mapping uniqueness matrix incomplete';
  end if;
end $$;

set session_replication_role=replica;
insert into tenant.offline_provisional_mapping(
  business_id,branch_id,device_id,command_id,provisional_id,official_sale_id,
  official_receipt_id,official_receipt_number,reconciliation_reference
) values (
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001','OFFICIAL-1',
  '81000000-0000-4000-8000-000000000001'
);
do $$
begin
  begin
    insert into tenant.offline_provisional_mapping(
      business_id,branch_id,device_id,command_id,provisional_id,official_sale_id,
      official_receipt_id,official_receipt_number,reconciliation_reference
    ) values (
      '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000002',
      '85000000-0000-4000-8000-000000000002','OFFICIAL-2',
      '81000000-0000-4000-8000-000000000001'
    );
    raise exception 'conflicting provisional mapping unexpectedly succeeded';
  exception when unique_violation then null; end;
end $$;
set session_replication_role=origin;
do $$
begin
  begin
    update tenant.offline_provisional_mapping set official_receipt_number='CHANGED'
     where provisional_id='83000000-0000-4000-8000-000000000001';
    raise exception 'immutable mapping update unexpectedly succeeded';
  exception when others then
    if sqlerrm='immutable mapping update unexpectedly succeeded' then raise; end if;
  end;
end $$;

update runtime.operator_session set permissions='{}'
 where id='70000000-0000-4000-8000-000000000001';
do $$
begin
  begin
    insert into tenant.offline_replay_command(
      business_id,branch_id,device_id,credential_version,device_sequence,command_id,
      operator_session_id,idempotency_key,command_type,fingerprint,contract_version,
      schema_version,client_created_at,result,payload
    ) values (
      '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',1,2,
      '80000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000004','operational.ack',
      repeat('a',64),'1.6.1',1,now(),'{}','{}'
    );
    raise exception 'operator without replay permission unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
update runtime.operator_session set permissions=array['*']
 where id='70000000-0000-4000-8000-000000000001';
insert into tenant.offline_replay_command(
  business_id,branch_id,device_id,credential_version,device_sequence,command_id,
  operator_session_id,idempotency_key,command_type,fingerprint,contract_version,
  schema_version,client_created_at,result,payload
) values (
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',1,2,
  '80000000-0000-4000-8000-000000000005','70000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000005','operational.ack',
  repeat('a',64),'1.6.1',1,now(),'{}','{}'
);
update runtime.operator_session set permissions=array['offline.replay']
 where id='70000000-0000-4000-8000-000000000001';
do $$
declare scenario text;
begin
  foreach scenario in array array['duplicate_changed_fingerprint','wrong_branch','wrong_tenant']
  loop
    begin
      insert into tenant.offline_replay_command(
        business_id,branch_id,device_id,credential_version,device_sequence,command_id,
        operator_session_id,idempotency_key,command_type,fingerprint,contract_version,
        schema_version,client_created_at,result,payload
      ) values (
        case when scenario='wrong_tenant' then '10000000-0000-4000-8000-000000000002'::uuid
             else '10000000-0000-4000-8000-000000000001'::uuid end,
        case when scenario='wrong_tenant' then '20000000-0000-4000-8000-000000000003'::uuid
             when scenario='wrong_branch' then '20000000-0000-4000-8000-000000000002'::uuid
             else '20000000-0000-4000-8000-000000000001'::uuid end,
        '50000000-0000-4000-8000-000000000001',1,3,
        case when scenario='duplicate_changed_fingerprint'
             then '80000000-0000-4000-8000-000000000001'::uuid
             else gen_random_uuid() end,
        '70000000-0000-4000-8000-000000000001',gen_random_uuid(),'operational.ack',
        repeat('b',64),'1.6.1',1,now(),'{}','{}'
      );
      raise exception '% unexpectedly succeeded',scenario;
    exception
      when unique_violation or insufficient_privilege then null;
    end;
  end loop;
end $$;

update tenant.device set lifecycle_state='revoked', revoked_at=now()
 where id='50000000-0000-4000-8000-000000000001';
do $$
begin
  begin
    insert into tenant.offline_replay_command(
      business_id,branch_id,device_id,credential_version,device_sequence,command_id,
      operator_session_id,idempotency_key,command_type,fingerprint,contract_version,
      schema_version,client_created_at,result,payload
    ) values (
      '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',1,3,
      '80000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000002','operational.ack',
      repeat('a',64),'1.6.0',1,now(),'{}','{}'
    );
    raise exception 'revoked device replay unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
update tenant.device set lifecycle_state='active', revoked_at=null, credential_version=2
 where id='50000000-0000-4000-8000-000000000001';
do $$
begin
  begin
    insert into tenant.offline_replay_command(
      business_id,branch_id,device_id,credential_version,device_sequence,command_id,
      operator_session_id,idempotency_key,command_type,fingerprint,contract_version,
      schema_version,client_created_at,result,payload
    ) values (
      '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',1,3,
      '80000000-0000-4000-8000-000000000003','70000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000003','operational.ack',
      repeat('a',64),'1.6.0',1,now(),'{}','{}'
    );
    raise exception 'rotated credential replay unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
SQL

echo "Gate 2F disposable migration, RLS, immutability, revocation, and credential negative matrix passed."
