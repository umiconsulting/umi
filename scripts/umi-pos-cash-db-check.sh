#!/usr/bin/env bash
set -euo pipefail

name="umi-gate3c-db-$RANDOM"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

command -v docker >/dev/null || {
  echo "Docker is required for the disposable cash database check." >&2
  exit 1
}

docker run --rm -d --name "$name" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=umi_gate3c \
  pgvector/pgvector:pg16 >/dev/null
for _ in $(seq 1 30); do
  docker exec "$name" pg_isready -U postgres -d umi_gate3c >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$name" pg_isready -U postgres -d umi_gate3c >/dev/null

for migration in supabase/migrations/*.sql; do
  if [[ "$(basename "$migration")" == "20260729000300_gate_3a_sale_lifecycle.sql" ]]; then
    docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d umi_gate3c <<'SQL' >/dev/null
insert into umi.role(key,name,is_platform)
values
  ('staff','Staff',false),('cashier','Cashier',false),('supervisor','Supervisor',false),
  ('manager','Manager',false),('viewer','Viewer',false)
on conflict (key) do nothing;
SQL
  fi
  docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d umi_gate3c \
    <"$migration" >/dev/null
done

docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d umi_gate3c <<'SQL'
do $$
declare missing integer;
begin
  select count(*) into missing
  from (values
    ('physical_register'),('cash_shift_policy'),('cash_shift'),('cash_ledger_entry'),
    ('cash_movement'),('cash_shift_handoff'),('cash_count_attempt'),
    ('cash_variance_resolution'),('cash_reconciliation'),('cash_shift_close')
  ) expected(name)
  where not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='tenant' and c.relname=expected.name
      and c.relrowsecurity and c.relforcerowsecurity
  );
  if missing<>0 then raise exception 'Cash RLS and FORCE RLS matrix failed'; end if;
  if exists (
    select 1 from umi.role r
    join umi.role_permission rp on rp.role_id=r.id
    join umi.permission p on p.id=rp.permission_id
    where r.key='viewer' and p.key like 'cash.%' and p.key<>'cash.shift.read'
  ) then raise exception 'Viewer received cash mutation permission'; end if;
end $$;

insert into tenant.business(id,name) values
  ('10000000-0000-4000-8000-000000000001','Tenant A'),
  ('10000000-0000-4000-8000-000000000002','Tenant B');
insert into tenant.branch(id,business_id,name) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','A1'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','A2'),
  ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','B1');
insert into umi.user(id,email,full_name,status) values
  ('30000000-0000-4000-8000-000000000001','cashier@example.test','Cashier','active'),
  ('30000000-0000-4000-8000-000000000002','manager@example.test','Manager','active');
insert into tenant.staff(id,business_id,branch_id,user_id,status) values
  ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','active'),
  ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','active');
insert into tenant.device(id,business_id,branch_id,name,kind,status,lifecycle_state,credential_version)
values
  ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001','POS A1','pos_terminal','active','active',1),
  ('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000002','POS A2','pos_terminal','active','active',1);
insert into runtime.session(id,user_id,device_id,app,token_hash,expires_at) values
  ('60000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001','pos','cash-hash',now()+interval '1 hour');
insert into runtime.operator_session(
  id,durable_session_id,user_id,staff_id,device_id,business_id,branch_id,
  permissions,entitlements,expires_at
) values (
  '70000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',array['cash.shift.open','cash.shift.read'],
  '[]',now()+interval '1 hour'
);
insert into tenant.physical_register(
  id,business_id,branch_id,display_name,public_reference,currency,
  assigned_device_id,status
) values
  ('80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001','Register A1','REG-A1','MXN',
   '50000000-0000-4000-8000-000000000001','assigned'),
  ('80000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000002','Register A2','REG-A2','MXN',
   '50000000-0000-4000-8000-000000000002','assigned');
insert into tenant.cash_shift_policy(
  business_id,branch_id,version,maximum_opening_float,allowed_movement_types,
  movement_approval_threshold,count_method,blind_count_required,handoff_allowed,
  handoff_count_required,variance_tolerance,close_approval_threshold,currency,
  expires_at,fingerprint
) values (
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  'cash-test',100000,array['paid_in','paid_out','safe_drop'],50000,
  'denomination_or_total',true,true,false,100,500,'MXN',now()+interval '1 hour',repeat('a',64)
);
insert into tenant.cash_shift(
  id,business_id,branch_id,register_id,device_id,device_credential_version,
  opening_operator_id,responsible_operator_id,operator_session_id,currency,business_date,
  status,opening_command_id,opening_float_minor_units,ledger_sequence
) values (
  '81000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',1,
  '30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001','MXN',current_date,'open',
  '82000000-0000-4000-8000-000000000001',2000,0
);
update tenant.physical_register set status='in_use',
 current_shift_id='81000000-0000-4000-8000-000000000001'
 where id='80000000-0000-4000-8000-000000000001';
insert into tenant.cash_ledger_entry(
  business_id,branch_id,register_id,shift_id,sequence,entry_type,
  amount_minor_units,currency,command_id,business_date
) values (
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',
  1,'opening_float',2000,'MXN','82000000-0000-4000-8000-000000000001',current_date
);
update tenant.cash_shift set ledger_sequence=1
where id='81000000-0000-4000-8000-000000000001';

do $$
begin
  begin
    insert into tenant.cash_shift(
      business_id,branch_id,register_id,device_id,device_credential_version,
      opening_operator_id,responsible_operator_id,operator_session_id,currency,business_date,
      status,opening_command_id,opening_float_minor_units
    ) values (
      '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',1,
      '30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001','MXN',current_date,'open',
      gen_random_uuid(),0
    );
    raise exception 'duplicate register shift unexpectedly succeeded';
  exception when others then
    if sqlerrm='duplicate register shift unexpectedly succeeded' then raise; end if;
  end;
  begin
    update tenant.cash_ledger_entry set amount_minor_units=1
    where shift_id='81000000-0000-4000-8000-000000000001';
    raise exception 'ledger mutation unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm='ledger mutation unexpectedly succeeded' then raise; end if;
  end;
end $$;

set role api;
select set_config('app.current_business','10000000-0000-4000-8000-000000000001',false);
select set_config('app.current_branch','20000000-0000-4000-8000-000000000001',false);
do $$
begin
  begin
    insert into tenant.physical_register(
      business_id,branch_id,display_name,public_reference,currency,status
    ) values (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'API write probe','REG-PROBE','MXN','available'
    );
    raise exception 'api_write_probe_passed';
  exception when others then
    if sqlerrm<>'api_write_probe_passed' then raise; end if;
  end;
  if (select count(*) from tenant.cash_shift)<>1 then
    raise exception 'authorized branch cannot read its shift';
  end if;
  perform set_config('app.current_branch','20000000-0000-4000-8000-000000000002',false);
  if (select count(*) from tenant.cash_shift)<>0 then
    raise exception 'cross-branch shift read succeeded';
  end if;
  perform set_config('app.current_business','10000000-0000-4000-8000-000000000002',false);
  perform set_config('app.current_branch','20000000-0000-4000-8000-000000000003',false);
  if (select count(*) from tenant.cash_shift)<>0 then
    raise exception 'cross-tenant shift read succeeded';
  end if;
  perform set_config('app.current_business','',false);
  perform set_config('app.current_branch','',false);
  if (select count(*) from tenant.cash_shift)<>0 then
    raise exception 'unscoped shift read succeeded';
  end if;
end $$;
reset role;

do $$
begin
  begin
    insert into tenant.cash_count_attempt(
      business_id,branch_id,register_id,shift_id,attempt_number,state,
      counted_minor_units,currency,operator_id,ledger_sequence,command_id
    ) values (
      '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',
      1,'submitted',2000,'MXN','30000000-0000-4000-8000-000000000001',0,
      '83000000-0000-4000-8000-000000000001'
    );
    raise exception 'stale count unexpectedly succeeded';
  exception when others then
    if sqlerrm='stale count unexpectedly succeeded' then raise; end if;
  end;
  begin
    insert into tenant.cash_count_attempt(
      business_id,branch_id,register_id,shift_id,attempt_number,state,
      counted_minor_units,currency,denominations,operator_id,ledger_sequence,command_id
    ) values (
      '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',
      1,'submitted',2000,'MXN',
      '[{"denomination":{"minorUnits":1000,"currency":"MXN"},"quantity":1,
         "lineTotal":{"minorUnits":1000,"currency":"MXN"}}]'::jsonb,
      '30000000-0000-4000-8000-000000000001',1,
      '83000000-0000-4000-8000-000000000002'
    );
    raise exception 'invalid denomination count unexpectedly succeeded';
  exception when others then
    if sqlerrm='invalid denomination count unexpectedly succeeded' then raise; end if;
  end;
end $$;

insert into tenant.cash_count_attempt(
  id,business_id,branch_id,register_id,shift_id,attempt_number,state,
  counted_minor_units,currency,operator_id,ledger_sequence,command_id
) values (
  '84000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',
  1,'resolved',2000,'MXN','30000000-0000-4000-8000-000000000001',1,
  '83000000-0000-4000-8000-000000000003'
);
do $$
begin
  begin
    update tenant.cash_count_attempt set counted_minor_units=1900
    where id='84000000-0000-4000-8000-000000000001';
    raise exception 'submitted count mutation unexpectedly succeeded';
  exception when others then
    if sqlerrm='submitted count mutation unexpectedly succeeded' then raise; end if;
  end;
end $$;
update tenant.cash_shift set status='reconciliation_required',version=version+1
where id='81000000-0000-4000-8000-000000000001';

do $$
begin
  begin
    insert into tenant.cash_reconciliation(
      business_id,branch_id,shift_id,count_attempt_id,expected_minor_units,
      counted_minor_units,variance_minor_units,tolerance_minor_units,currency,
      outcome,ledger_sequence,command_id
    ) values (
      '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
      '81000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001',
      2000,2000,1,100,'MXN','balanced',1,
      '85000000-0000-4000-8000-000000000001'
    );
    raise exception 'invalid variance reconciliation unexpectedly succeeded';
  exception when others then
    if sqlerrm='invalid variance reconciliation unexpectedly succeeded' then raise; end if;
  end;
end $$;

insert into tenant.cash_reconciliation(
  id,business_id,branch_id,shift_id,count_attempt_id,expected_minor_units,
  counted_minor_units,variance_minor_units,tolerance_minor_units,currency,
  outcome,ledger_sequence,command_id
) values (
  '86000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001',
  2000,2000,0,100,'MXN','balanced',1,'85000000-0000-4000-8000-000000000002'
);

do $$
begin
  begin
    insert into tenant.cash_shift_close(
      business_id,branch_id,register_id,shift_id,reconciliation_id,summary,command_id
    ) values (
      '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',
      '86000000-0000-4000-8000-000000000001','{}',
      '87000000-0000-4000-8000-000000000001'
    );
    raise exception 'close before closing state unexpectedly succeeded';
  exception when others then
    if sqlerrm='close before closing state unexpectedly succeeded' then raise; end if;
  end;
end $$;

update tenant.cash_shift set status='closing',version=version+1
where id='81000000-0000-4000-8000-000000000001';
insert into tenant.cash_shift_close(
  business_id,branch_id,register_id,shift_id,reconciliation_id,summary,command_id
) values (
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001','{}',
  '87000000-0000-4000-8000-000000000002'
);
update tenant.cash_shift set status='closed',closed_at=now(),version=version+1
where id='81000000-0000-4000-8000-000000000001';

do $$
begin
  begin
    insert into tenant.cash_ledger_entry(
      business_id,branch_id,register_id,shift_id,sequence,entry_type,
      amount_minor_units,currency,command_id,business_date
    ) values (
      '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',
      2,'paid_in',100,'MXN',gen_random_uuid(),current_date
    );
    raise exception 'posting into a closed shift unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm='posting into a closed shift unexpectedly succeeded' then raise; end if;
  end;
  begin
    update tenant.cash_shift_close set summary='{"changed":true}'::jsonb
    where shift_id='81000000-0000-4000-8000-000000000001';
    raise exception 'close result mutation unexpectedly succeeded';
  exception when others then
    if sqlerrm='close result mutation unexpectedly succeeded' then raise; end if;
  end;
end $$;
SQL

echo "Gate 3C disposable migration, RLS, immutability, and isolation matrix passed."
