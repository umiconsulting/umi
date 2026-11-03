begin;

create table runtime.platform_bootstrap_command (
  command_id uuid primary key,
  idempotency_key text not null unique check(length(idempotency_key) between 8 and 128),
  fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  result jsonb not null check(jsonb_typeof(result)='object'),
  completed_at timestamptz not null default clock_timestamp()
);

revoke all on runtime.platform_bootstrap_command from public,api,readonly;
grant select,insert on runtime.platform_bootstrap_command to worker;

insert into umi.feature(id,key,module,name,description,kind)
values
  ('e0000000-0000-4000-8000-000000000201','dashboard','dashboard','Dashboard','Pilot owner operations','flag'),
  ('e0000000-0000-4000-8000-000000000202','pos','pos','POS','Pilot point of sale','flag'),
  ('e0000000-0000-4000-8000-000000000203','kds','kds','KDS','Pilot kitchen display','flag')
on conflict(key) do nothing;

insert into umi.plan(id,key,name,description,is_public,status)
values(
  'e1000000-0000-4000-8000-000000000201','pilot-foundation','Pilot Foundation',
  'Minimum capabilities for an approved pilot merchant',false,'active'
)
on conflict(key) do nothing;

insert into umi.plan_feature(plan_id,feature_id)
select 'e1000000-0000-4000-8000-000000000201'::uuid,id
from umi.feature where key in ('dashboard','pos','kds')
on conflict do nothing;

-- super_admin holds every permission key — security_gate.sql's first structural check.
-- Files 31–35, 42 and 44 seed the POS permission keys and map them onto the POS roles;
-- nothing maps them onto super_admin, and backfill/seed_rbac.sql's sweep runs only at
-- backfill time. A pristine build must pass the gate on its own, so the same sweep lives
-- here, after the last permission seed. Idempotent; a no-op on a backfilled target.
insert into umi.role_permission (role_id, permission_id)
select r.id, p.id
  from umi.role r
 cross join umi.permission p
 where r.key = 'super_admin'
on conflict do nothing;

insert into runtime.schema_migration(version,status)
values('build-v3-46','applied') on conflict(version) do nothing;

commit;
