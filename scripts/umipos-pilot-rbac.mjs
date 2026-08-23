#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const matrixPath = resolve(root, 'config/umipos-pilot-role-grants.json');
const inventoryPath = resolve(root, 'config/umipos-permission-inventory.json');
const approvalPath = resolve(root, 'config/umipos-pilot-approval-boundaries.json');
const sqlPath = resolve(root, 'docs/migration/build-v3/35_pos_pilot_rbac.sql');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const matrix = readJson(matrixPath);
const inventory = readJson(inventoryPath);
const approvals = readJson(approvalPath);

function fail(message) {
  throw new Error(`Pilot RBAC validation failed: ${message}`);
}

function assertSortedUnique(values, label) {
  if (new Set(values).size !== values.length) fail(`${label} contains a duplicate.`);
  if (JSON.stringify(values) !== JSON.stringify([...values].sort())) {
    fail(`${label} must use deterministic ordering.`);
  }
}

function validate() {
  if (
    matrix.schemaVersion !== 1 ||
    inventory.schemaVersion !== 1 ||
    approvals.schemaVersion !== 1
  ) {
    fail('unsupported schema version.');
  }
  if (matrix.entitlement !== 'pos') fail('the POS entitlement key must be pos.');

  const known = inventory.permissions.map((permission) => permission.key);
  assertSortedUnique(known, 'permission inventory');
  const roles = matrix.profiles.map((profile) => profile.role);
  assertSortedUnique(roles, 'profile list');

  for (const [actor, assignableRoles] of Object.entries(matrix.roleAssignmentPolicy)) {
    if (!roles.includes(actor)) fail(`${actor} is not a known role assignment actor.`);
    assertSortedUnique(assignableRoles, `${actor} assignable roles`);
    for (const role of assignableRoles) {
      if (!roles.includes(role)) fail(`${actor} assigns unknown role ${role}.`);
      if (role === 'super_admin' || role === 'owner') {
        fail(`${actor} cannot assign protected role ${role}.`);
      }
    }
  }

  for (const profile of matrix.profiles) {
    assertSortedUnique(profile.permissions, `${profile.role} permissions`);
    for (const key of profile.permissions) {
      if (!known.includes(key)) fail(`${profile.role} uses unknown permission ${key}.`);
      if (key === '*') fail(`${profile.role} uses a wildcard grant.`);
    }
    for (const key of [
      ...profile.approvalPermissions,
      ...profile.crossOperatorPermissions,
      ...profile.crossLocationPermissions,
    ]) {
      if (!profile.permissions.includes(key)) {
        fail(`${profile.role} metadata refers to ungranted permission ${key}.`);
      }
    }
    if (profile.platformOnly && profile.permissions.length > 0) {
      fail(`${profile.role} must remain outside the café matrix.`);
    }
  }

  for (const permission of inventory.permissions) {
    const expectedProfiles = matrix.profiles
      .filter((profile) => !profile.platformOnly && profile.permissions.includes(permission.key))
      .map((profile) => profile.role)
      .sort();
    if (JSON.stringify(permission.profiles) !== JSON.stringify(expectedProfiles)) {
      fail(`${permission.key} has stale profile metadata.`);
    }
    if (permission.seedGap) {
      fail(`${permission.key} still reports an unresolved pilot seed gap.`);
    }
  }

  const actions = approvals.boundaries.map((boundary) => boundary.action);
  assertSortedUnique(actions, 'approval boundary list');
  for (const boundary of approvals.boundaries) {
    if (!known.includes(boundary.actingPermission)) {
      fail(`${boundary.action} uses unknown acting permission.`);
    }
    if (!known.includes(boundary.approvalPermission)) {
      fail(`${boundary.action} uses unknown approval permission.`);
    }
    if (boundary.selfApproval || !boundary.actorSeparation) {
      fail(`${boundary.action} must deny self-approval.`);
    }
    if (boundary.actingPermission === boundary.approvalPermission) {
      fail(`${boundary.action} must use a separate approval permission.`);
    }
    if (!boundary.oneUse || !boundary.fingerprintBound || !boundary.auditRequired) {
      fail(`${boundary.action} must be one-use, fingerprint-bound, and audited.`);
    }
  }
}

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

function generatedSql() {
  const profiles = matrix.profiles.filter((profile) => !profile.platformOnly);
  const roleRows = matrix.profiles
    .map(
      (profile) =>
        `  (${quote(profile.role)},${quote(roleName(profile.role))},${quote(profile.justification)},${profile.platformOnly})`,
    )
    .join(',\n');
  const grants = profiles
    .flatMap((profile) =>
      profile.permissions.map((permission) => `  (${quote(profile.role)},${quote(permission)})`),
    )
    .join(',\n');
  const roleKeys = profiles.map((profile) => quote(profile.role)).join(',');
  const permissionKeys = inventory.permissions.map((permission) => quote(permission.key)).join(',');
  const bootstrapPermissions = inventory.permissions
    .filter(
      (permission) =>
        permission.source.includes('35_pos_pilot_rbac.sql') ||
        permission.source.includes('37_pos_customer_value.sql') ||
        permission.source.includes('38_pos_customer_value_closeout.sql') ||
        permission.source.includes('39_pos_customer_value_final_closeout.sql') ||
        permission.source.includes('40_pos_hardware_runtime.sql') ||
        permission.source.includes('42_pos_kitchen.sql') ||
        permission.key.startsWith('inventory.'),
    )
    .map(
      (permission) =>
        `  (${quote(permission.key)},${quote(permission.description ?? `UmiPOS permission ${permission.key}`)})`,
    )
    .join(',\n');

  return `-- GENERATED FROM config/umipos-pilot-role-grants.json.
-- Run: pnpm umi-pos:generate-pilot-rbac
-- Do not edit this file by hand.
\\set ON_ERROR_STOP on

begin;

-- A clean build-v3 has no legacy backfill. Seed the reviewed business permissions used here.
insert into umi.permission(key,description)
values
  ('insights.read','Read merchant operational insights'),
  ('merchant.manage','Manage one merchant business profile'),
${bootstrapPermissions}
on conflict(key) do update set description=excluded.description;

insert into umi.role(key,name,description,is_platform)
values
${roleRows}
on conflict(key) do update set
  name=excluded.name,
  description=excluded.description,
  is_platform=excluded.is_platform;

-- Reconcile only the reviewed UmiPOS permission vocabulary.
delete from umi.role_permission rp
using umi.role r, umi.permission p
where rp.role_id=r.id
  and rp.permission_id=p.id
  and r.key in (${roleKeys})
  and p.key in (${permissionKeys});

with grants(role_key,permission_key) as (
  values
${grants}
)
insert into umi.role_permission(role_id,permission_id)
select r.id,p.id
from grants g
join umi.role r on r.key=g.role_key and not r.is_platform
join umi.permission p on p.key=g.permission_key
on conflict do nothing;

create or replace function umi.resolve_staff_permissions(p_staff_id uuid)
returns text[]
language sql
stable
security definer
set search_path=umi,merchant,pg_temp
as $$
  select coalesce(array_agg(effective.key order by effective.key),'{}'::text[])
  from (
    select p.key
    from merchant.staff s
    join umi.role_permission rp on rp.role_id=s.role_id
    join umi.permission p on p.id=rp.permission_id
    where s.id=p_staff_id and s.status='active'
      and not exists (
        select 1
        from merchant.staff_permission_override denied
        where denied.staff_id=s.id and denied.permission_id=p.id and denied.effect='deny'
          and (denied.expires_at is null or denied.expires_at>now())
      )
    union
    select p.key
    from merchant.staff_permission_override allowed
    join merchant.staff s on s.id=allowed.staff_id and s.status='active'
    join umi.permission p on p.id=allowed.permission_id
    where allowed.staff_id=p_staff_id and allowed.effect='allow'
      and (allowed.expires_at is null or allowed.expires_at>now())
      and not exists (
        select 1
        from merchant.staff_permission_override denied
        where denied.staff_id=allowed.staff_id
          and denied.permission_id=allowed.permission_id and denied.effect='deny'
          and (denied.expires_at is null or denied.expires_at>now())
      )
  ) effective;
$$;
revoke all on function umi.resolve_staff_permissions(uuid) from public;
grant execute on function umi.resolve_staff_permissions(uuid) to api,worker;

create or replace function runtime.invalidate_operator_sessions_for_rbac()
returns trigger
language plpgsql
security definer
set search_path=runtime,merchant,umi,pg_temp
as $$
begin
  if tg_table_schema='umi' and tg_table_name='role_permission' then
    update runtime.operator_session os
    set state='ended',ended_at=coalesce(ended_at,now()),last_activity_at=now()
    from merchant.staff s
    where os.staff_id=s.id
      and s.role_id=coalesce(new.role_id,old.role_id)
      and os.state in ('active','locked');
  elsif tg_table_schema='merchant' and tg_table_name='staff_permission_override' then
    update runtime.operator_session
    set state='ended',ended_at=coalesce(ended_at,now()),last_activity_at=now()
    where staff_id=coalesce(new.staff_id,old.staff_id)
      and state in ('active','locked');
  else
    update runtime.operator_session
    set state='ended',ended_at=coalesce(ended_at,now()),last_activity_at=now()
    where staff_id=coalesce(new.id,old.id)
      and state in ('active','locked');
  end if;
  return coalesce(new,old);
end $$;

drop trigger if exists role_permission_operator_session_invalidation on umi.role_permission;
create trigger role_permission_operator_session_invalidation
after insert or update or delete on umi.role_permission
for each row execute function runtime.invalidate_operator_sessions_for_rbac();

drop trigger if exists staff_authority_operator_session_invalidation on merchant.staff;
create trigger staff_authority_operator_session_invalidation
after update of role_id,location_id,status on merchant.staff
for each row
when (
  old.role_id is distinct from new.role_id
  or old.location_id is distinct from new.location_id
  or old.status is distinct from new.status
)
execute function runtime.invalidate_operator_sessions_for_rbac();

drop trigger if exists staff_override_operator_session_invalidation
on merchant.staff_permission_override;
create trigger staff_override_operator_session_invalidation
after insert or update or delete on merchant.staff_permission_override
for each row execute function runtime.invalidate_operator_sessions_for_rbac();

-- super_admin stays outside the café matrix. Platform grants use their own authority.

do $$
begin
  if exists (
    select 1
    from (values
${grants}
    ) expected(role_key,permission_key)
    left join umi.role r on r.key=expected.role_key
    left join umi.permission p on p.key=expected.permission_key
    left join umi.role_permission rp on rp.role_id=r.id and rp.permission_id=p.id
    where rp.role_id is null
  ) then
    raise exception 'pilot RBAC grant reconciliation failed';
  end if;
end $$;

commit;
`;
}

function roleName(role) {
  return {
    admin: 'Administrator',
    cashier: 'Cashier',
    manager: 'Manager',
    owner: 'Owner',
    staff: 'Staff',
    super_admin: 'Super Admin',
    supervisor: 'Supervisor',
    viewer: 'Viewer',
  }[role];
}

function printMatrix() {
  for (const profile of matrix.profiles) {
    const scope = profile.platformOnly ? 'platform-only' : profile.scopeType;
    console.log(`${profile.role.padEnd(12)} ${scope.padEnd(13)} ${profile.permissions.length}`);
  }
}

validate();
const command = process.argv[2] ?? 'validate';
const sql = generatedSql();

if (command === 'generate') {
  writeFileSync(sqlPath, sql);
  console.log(`Generated ${sqlPath.slice(root.length + 1)}.`);
} else if (command === 'check') {
  if (readFileSync(sqlPath, 'utf8') !== sql) fail('generated SQL has drift.');
  console.log('Pilot RBAC matrix and generated SQL are valid.');
} else if (command === 'print') {
  printMatrix();
} else if (command === 'validate') {
  console.log('Pilot RBAC matrix is valid.');
} else {
  fail(`unknown command ${command}.`);
}
