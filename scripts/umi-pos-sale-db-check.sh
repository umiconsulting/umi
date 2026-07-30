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

insert into runtime.elevation_grant(
  id,session_id,business_id,branch_id,permission_key,method,approved_by,
  expires_at,command_fingerprint,consumed_at,consumed_by_command_id
) values (
  '83000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'checkout.discount.approve','manager_approval',
  '30000000-0000-4000-8000-000000000002',
  now()+interval '5 minutes',repeat('b',64),now(),
  '84000000-0000-4000-8000-000000000001'
);

do $$
begin
  begin
    insert into runtime.elevation_grant(
      session_id,business_id,branch_id,permission_key,method,approved_by,
      expires_at,command_fingerprint
    ) values (
      '60000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'checkout.discount.approve','manager_approval',
      '30000000-0000-4000-8000-000000000002',
      now()+interval '5 minutes','invalid'
    );
    raise exception 'invalid approval fingerprint unexpectedly succeeded';
  exception when check_violation then null; end;
  insert into runtime.elevation_grant(
    session_id,business_id,branch_id,permission_key,method,approved_by,
    expires_at,command_fingerprint,consumed_at,consumed_by_command_id
  ) values (
    '60000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'checkout.terminal.approve','manager_approval',
    '30000000-0000-4000-8000-000000000002',
    now()+interval '5 minutes',repeat('c',64),now(),
    '84000000-0000-4000-8000-000000000001'
  );
end $$;

do $$
begin
  if exists (
    select 1
    from umi.role r
    join umi.role_permission rp on rp.role_id=r.id
    join umi.permission p on p.id=rp.permission_id
    where r.key in ('cashier','staff') and p.key='checkout.terminal.approve'
  ) then
    raise exception 'cashier received terminal approval authority';
  end if;
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

do $$
declare missing integer;
begin
  select count(*) into missing
  from (values ('pos_checkout_policy'),('pos_checkout_draft'),('pos_tender_fact')) expected(name)
  where not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='tenant' and c.relname=expected.name
      and c.relrowsecurity and c.relforcerowsecurity
  );
  if missing <> 0 then raise exception 'Gate 3B RLS and FORCE RLS check failed'; end if;
end $$;

insert into tenant.pos_checkout_policy(
  business_id,branch_id,version,manual_terminal_enabled,mixed_tender_enabled,
  maximum_tender_lines,manual_terminal_approval_threshold,tips_enabled,
  maximum_tip_minor_units,discounts_enabled,maximum_discount_basis_points,
  maximum_discount_minor_units,cashier_discount_threshold,currency
) values (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  'test-1',true,true,8,50000,true,5000,true,3000,10000,1000,'MXN'
);

insert into tenant.pos_checkout_draft(
  id,business_id,branch_id,cart_id,operator_session_id,device_id,state,
  command_fingerprint,receipt_delivery
) values (
  '81000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '80000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000002',
  'collecting_payment',repeat('a',64),'{"destination":"display","channel":null,"customerContactId":null}'
);

insert into tenant.pos_tender_fact(
  id,business_id,branch_id,checkout_id,cart_id,position,tender_type,status,
  amount_minor_units,received_minor_units,change_minor_units,currency
) values (
  '82000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000002',
  0,'cash','draft',1000,2000,1000,'MXN'
);

do $$
begin
  begin
    insert into tenant.pos_checkout_draft(
      business_id,branch_id,cart_id,operator_session_id,device_id,state,receipt_delivery
    ) values (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      '80000000-0000-4000-8000-000000000002',
      '70000000-0000-4000-8000-000000000002',
      '50000000-0000-4000-8000-000000000002',
      'ready','{"destination":"display","channel":null,"customerContactId":null}'
    );
    raise exception 'duplicate checkout unexpectedly succeeded';
  exception when unique_violation then null; end;
  begin
    insert into tenant.pos_tender_fact(
      id,business_id,branch_id,checkout_id,cart_id,position,tender_type,status,
      amount_minor_units,change_minor_units,currency
    ) values (
      gen_random_uuid(),'10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      '81000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002',1,'cash','draft',0,0,'MXN'
    );
    raise exception 'zero tender unexpectedly succeeded';
  exception when check_violation then null; end;
end $$;

set role api;
select set_config('app.current_business','10000000-0000-4000-8000-000000000001',false);
select set_config('app.current_branch','20000000-0000-4000-8000-000000000001',false);
do $$
begin
  if (select count(*) from tenant.pos_checkout_draft) <> 0
    or (select count(*) from tenant.pos_tender_fact) <> 0
    or (select count(*) from tenant.pos_checkout_policy) <> 0 then
    raise exception 'cross-branch checkout state was visible';
  end if;
  perform set_config('app.current_branch','20000000-0000-4000-8000-000000000002',false);
  if (select count(*) from tenant.pos_checkout_draft) <> 1
    or (select count(*) from tenant.pos_tender_fact) <> 1
    or (select count(*) from tenant.pos_checkout_policy) <> 1 then
    raise exception 'authorized checkout state was not visible';
  end if;
  perform set_config('app.current_business','10000000-0000-4000-8000-000000000002',false);
  perform set_config('app.current_branch','20000000-0000-4000-8000-000000000003',false);
  if (select count(*) from tenant.pos_checkout_draft) <> 0 then
    raise exception 'cross-tenant checkout state was visible';
  end if;
end $$;
reset role;

update tenant.pos_tender_fact set status='committed',committed_at=now()
where id='82000000-0000-4000-8000-000000000001';
do $$
begin
  begin
    update tenant.pos_tender_fact set amount_minor_units=2000
    where id='82000000-0000-4000-8000-000000000001';
    raise exception 'committed tender unexpectedly changed';
  exception when raise_exception then
    if sqlerrm='committed tender unexpectedly changed' then raise; end if;
  end;
  update tenant.pos_checkout_draft set state='completed'
  where id='81000000-0000-4000-8000-000000000001';
  begin
    update tenant.pos_checkout_draft set recovery_state='checkout_conflict'
    where id='81000000-0000-4000-8000-000000000001';
    raise exception 'completed checkout unexpectedly changed';
  exception when raise_exception then
    if sqlerrm='completed checkout unexpectedly changed' then raise; end if;
  end;
end $$;
SQL

echo "Gate 3A and Gate 3B disposable migration, lifecycle, tender, and RLS checks passed."
