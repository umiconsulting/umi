#!/usr/bin/env bash
set -euo pipefail

name="umi-gate3a-db-$RANDOM"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

command -v docker >/dev/null || {
  echo "Docker is required for the disposable sale database check." >&2
  exit 1
}

docker run --rm -d --name "$name" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=umi_gate3a \
  pgvector/pgvector:pg16 >/dev/null
for _ in $(seq 1 30); do
  docker exec "$name" pg_isready -U postgres -d umi_gate3a >/dev/null 2>&1 &&
    break
  sleep 1
done
docker exec "$name" pg_isready -U postgres -d umi_gate3a >/dev/null

for migration in supabase/migrations/*.sql; do
  if [[ "$(basename "$migration")" == "20260729000300_gate_3a_sale_lifecycle.sql" ]]; then
    docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d umi_gate3a <<'SQL' >/dev/null
insert into umi.role(key,name,is_platform)
values
  ('staff','Staff',false),
  ('cashier','Cashier',false),
  ('supervisor','Supervisor',false),
  ('manager','Manager',false),
  ('viewer','Viewer',false)
on conflict (key) do nothing;
SQL
  fi
  docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d umi_gate3a \
    <"$migration" >/dev/null
done

docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d umi_gate3a <<'SQL'
do $$
begin
  if not exists (
    select 1
    from pg_class table_record
    join pg_namespace schema_record on schema_record.oid=table_record.relnamespace
    where schema_record.nspname='tenant'
      and table_record.relname='pos_cart'
      and table_record.relrowsecurity
      and table_record.relforcerowsecurity
  ) then
    raise exception 'POS cart RLS and FORCE RLS are required';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid='tenant.pos_cart'::regclass
      and tgname='pos_cart_lifecycle_guard'
  ) then
    raise exception 'Sale lifecycle guard is missing';
  end if;
  if exists (
    select 1
    from umi.role role_record
    join umi.role_permission grant_record on grant_record.role_id=role_record.id
    join umi.permission permission_record on permission_record.id=grant_record.permission_id
    where role_record.key='viewer' and permission_record.key='sale.lifecycle'
  ) then
    raise exception 'Viewer received sale lifecycle permission';
  end if;
  if not exists (
    select 1
    from umi.role role_record
    join umi.role_permission grant_record on grant_record.role_id=role_record.id
    join umi.permission permission_record on permission_record.id=grant_record.permission_id
    where role_record.key='staff' and permission_record.key='sale.lifecycle'
  ) then
    raise exception 'Staff did not receive sale lifecycle permission';
  end if;
  if exists (
    select 1
    from umi.role role_record
    join umi.role_permission grant_record on grant_record.role_id=role_record.id
    join umi.permission permission_record on permission_record.id=grant_record.permission_id
    where role_record.key in ('staff','cashier')
      and permission_record.key='sale.resume.any'
  ) then
    raise exception 'Cashier-level role received elevated resume permission';
  end if;
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
  ('30000000-0000-4000-8000-000000000002','cashier-two@example.test','Cashier Two','active');
insert into tenant.staff(id,business_id,branch_id,user_id,status) values
  ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','active'),
  ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','active');
insert into tenant.device(id,business_id,branch_id,name,kind,status,lifecycle_state) values
  ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001','POS A1','pos_terminal','active','active'),
  ('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000002','POS A2','pos_terminal','active','active');
insert into runtime.session(id,user_id,device_id,app,token_hash,expires_at) values
  ('60000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001','pos','hash-one',now()+interval '1 hour'),
  ('60000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002',
   '50000000-0000-4000-8000-000000000002','pos','hash-two',now()+interval '1 hour'),
  ('60000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001','pos','hash-three',now()+interval '1 hour');
insert into runtime.operator_session(
  id,durable_session_id,user_id,staff_id,device_id,business_id,branch_id,
  permissions,entitlements,expires_at
) values
  ('70000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001',array['sale.lifecycle'],'[]',now()+interval '1 hour'),
  ('70000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002',
   '30000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002',
   '50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000002',array['sale.lifecycle'],'[]',now()+interval '1 hour'),
  ('70000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000003',
   '30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001',array['sale.lifecycle'],'[]',now()+interval '1 hour');

insert into tenant.pos_cart(
  id,business_id,branch_id,operator_session_id,original_operator_session_id,
  original_operator_user_id,operator_user_id,business_date
) values
  ('80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',
   '70000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001',current_date),
  ('80000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000002',
   '70000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002',
   '30000000-0000-4000-8000-000000000002',current_date);

do $$
begin
  begin
    insert into tenant.pos_cart(
      business_id,branch_id,operator_session_id,original_operator_session_id,
      original_operator_user_id,operator_user_id,business_date
    ) values (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000003',
      '70000000-0000-4000-8000-000000000003',
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',current_date
    );
    raise exception 'A second active sale for one operator unexpectedly succeeded';
  exception when unique_violation then null; end;

  insert into tenant.pos_cart(
    business_id,branch_id,operator_session_id,original_operator_session_id,
    original_operator_user_id,operator_user_id,business_date
  ) values (
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000003',
    '70000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',current_date
  )
  on conflict (business_id,branch_id,operator_user_id)
    where lifecycle_state in ('building_cart','ready_for_checkout','recovered')
  do update
    set operator_session_id=excluded.operator_session_id,
        lifecycle_state='recovered',
        updated_at=now();
  if not exists (
    select 1 from tenant.pos_cart
    where id='80000000-0000-4000-8000-000000000001'
      and operator_session_id='70000000-0000-4000-8000-000000000003'
      and lifecycle_state='recovered'
  ) then
    raise exception 'Restart recovery did not reuse the active sale';
  end if;

  update tenant.pos_cart
  set lifecycle_state='committed',status='committed'
  where id='80000000-0000-4000-8000-000000000001';
  begin
    update tenant.pos_cart
    set display_label='Changed'
    where id='80000000-0000-4000-8000-000000000001';
    raise exception 'A committed sale unexpectedly changed';
  exception when raise_exception then
    if sqlerrm='A committed sale unexpectedly changed' then raise; end if;
  end;
end $$;

set role api;
select set_config('app.current_business','10000000-0000-4000-8000-000000000001',false);
select set_config('app.current_branch','20000000-0000-4000-8000-000000000001',false);
do $$
declare visible integer;
declare changed integer;
begin
  select count(*) into visible from tenant.pos_cart;
  if visible <> 1 then raise exception 'Branch RLS exposed % carts', visible; end if;
  update tenant.pos_cart set display_label='Cross branch'
  where id='80000000-0000-4000-8000-000000000002';
  get diagnostics changed=row_count;
  if changed <> 0 then raise exception 'Cross-branch update succeeded'; end if;
end $$;
reset role;
SQL

echo "Gate 3A disposable migration, lifecycle, uniqueness, and RLS checks passed."
