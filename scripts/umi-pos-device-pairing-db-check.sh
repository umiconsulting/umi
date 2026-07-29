#!/usr/bin/env bash
set -euo pipefail

name="umi-device-pairing-db-$RANDOM"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

command -v docker >/dev/null || {
  echo "Docker is required for the disposable device pairing database check." >&2
  exit 1
}

docker run --rm -d --name "$name" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=umi_pairing \
  pgvector/pgvector:pg16 >/dev/null
for _ in $(seq 1 30); do
  docker exec "$name" pg_isready -U postgres -d umi_pairing >/dev/null 2>&1 &&
    break
  sleep 1
done
docker exec "$name" pg_isready -U postgres -d umi_pairing >/dev/null

for migration in supabase/migrations/*.sql; do
  docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d umi_pairing \
    <"$migration" >/dev/null
done

docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d umi_pairing <<'SQL'
insert into tenant.business(id,name) values
  ('10000000-0000-4000-8000-000000000001','Tenant A'),
  ('10000000-0000-4000-8000-000000000002','Tenant B');
insert into tenant.branch(id,business_id,name) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','A1'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','B1');
insert into umi.user(id,email,full_name,status) values
  ('30000000-0000-4000-8000-000000000001','admin@example.test','Admin','active'),
  ('30000000-0000-4000-8000-000000000002','cashier@example.test','Cashier','active');
insert into tenant.staff(
  id,business_id,branch_id,user_id,status,operator_pin_lookup_hash
) values (
  '31000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'active',repeat('e',64)
);

insert into runtime.device_enrollment_request(
  id,business_id,branch_id,display_name,device_kind,platform,setup_code_hash,
  idempotency_key,expires_at,created_by
) values (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'Front register','pos_terminal','linux',repeat('a',64),
  '50000000-0000-4000-8000-000000000001',now()+interval '5 minutes',
  '30000000-0000-4000-8000-000000000001'
);
insert into runtime.device_pairing_session(
  id,enrollment_request_id,polling_credential_hash
) values (
  '60000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',repeat('b',64)
);

do $$
begin
  if has_table_privilege('api','runtime.device_enrollment_request','select')
     or has_table_privilege('api','runtime.device_pairing_session','select')
     or has_table_privilege('public','runtime.device_enrollment_request','select') then
    raise exception 'Public pairing table access is available';
  end if;
  if not has_table_privilege('worker','runtime.device_enrollment_request','select,insert,update')
     or not has_table_privilege('worker','runtime.device_pairing_session','select,insert,update') then
    raise exception 'Worker pairing access is missing';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='runtime'
      and table_name in ('device_enrollment_request','device_pairing_session')
      and column_name in ('setup_code','polling_credential','device_credential')
  ) then
    raise exception 'A plaintext pairing secret column exists';
  end if;

  begin
    insert into runtime.device_enrollment_request(
      id,business_id,branch_id,display_name,device_kind,platform,setup_code_hash,
      idempotency_key,expires_at,created_by
    ) values (
      gen_random_uuid(),'10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002','Wrong branch',
      'pos_terminal','linux',repeat('c',64),gen_random_uuid(),
      now()+interval '5 minutes','30000000-0000-4000-8000-000000000001'
    );
    raise exception 'Cross-tenant branch binding unexpectedly succeeded';
  exception when foreign_key_violation then null; end;

  begin
    insert into runtime.device_enrollment_request(
      id,business_id,branch_id,display_name,device_kind,platform,setup_code_hash,
      idempotency_key,expires_at,created_by
    ) values (
      gen_random_uuid(),'10000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000002','Duplicate code',
      'pos_terminal','linux',repeat('a',64),gen_random_uuid(),
      now()+interval '5 minutes','30000000-0000-4000-8000-000000000001'
    );
    raise exception 'Duplicate setup code hash unexpectedly succeeded';
  exception when unique_violation then null; end;

  begin
    insert into tenant.staff(
      id,business_id,branch_id,user_id,status,operator_pin_lookup_hash
    ) values (
      gen_random_uuid(),'10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002','active',repeat('e',64)
    );
    raise exception 'Duplicate tenant operator PIN unexpectedly succeeded';
  exception when unique_violation then null; end;

  begin
    update runtime.device_enrollment_request set attempts=6
    where id='40000000-0000-4000-8000-000000000001';
    raise exception 'Unbounded claim attempts unexpectedly succeeded';
  exception when check_violation then null; end;

  begin
    insert into runtime.device_pairing_session(
      id,enrollment_request_id,polling_credential_hash
    ) values (
      gen_random_uuid(),'40000000-0000-4000-8000-000000000001',repeat('d',64)
    );
    raise exception 'Second pairing session unexpectedly succeeded';
  exception when unique_violation then null; end;
end $$;
SQL

echo "Device pairing PostgreSQL validation passed."
