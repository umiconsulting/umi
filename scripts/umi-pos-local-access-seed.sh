#!/usr/bin/env bash
set -euo pipefail

container="${UMI_POS_DEV_DB_CONTAINER:-umi-gate2f-postgres}"
database="${UMI_POS_DEV_DB_NAME:-umi_gate2f}"
tenant_id="${UMI_POS_DEV_TENANT_ID:-10000000-0000-4000-8000-000000000101}"

if [[ "${UMI_POS_DEV_SEED_CONFIRM:-}" != "disposable" ]]; then
  echo "Set UMI_POS_DEV_SEED_CONFIRM=disposable for a disposable local database." >&2
  exit 1
fi

command -v docker >/dev/null || {
  echo "Docker is required for the disposable UmiPOS access seed." >&2
  exit 1
}

docker inspect "$container" >/dev/null 2>&1 || {
  echo "The disposable PostgreSQL container does not exist: $container" >&2
  exit 1
}

docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" \
  -v tenant_id="$tenant_id" <<'SQL'
begin;

insert into umi.feature(id, key, module, name, description, kind)
values (
  '91000000-0000-4000-8000-000000000001',
  'pos',
  'pos',
  'UmiPOS',
  'Local development access for UmiPOS.',
  'flag'
)
on conflict (key) do update
set module = excluded.module,
    name = excluded.name,
    description = excluded.description,
    kind = excluded.kind;

insert into umi.plan(id, key, name, description, is_public, status)
values (
  '92000000-0000-4000-8000-000000000001',
  'umipos-local',
  'UmiPOS local',
  'Disposable local development plan.',
  false,
  'active'
)
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    is_public = excluded.is_public,
    status = excluded.status;

insert into umi.plan_feature(plan_id, feature_id)
select p.id, f.id
from umi.plan p
join umi.feature f on f.key = 'pos'
where p.key = 'umipos-local'
on conflict (plan_id, feature_id) do nothing;

insert into umi.subscription(business_id, plan_id, status)
select :'tenant_id'::uuid, p.id, 'active'
from umi.plan p
where p.key = 'umipos-local'
on conflict (business_id) do update
set plan_id = excluded.plan_id,
    status = excluded.status,
    canceled_at = null,
    updated_at = now();

commit;
SQL

echo "Disposable UmiPOS POS entitlement seed completed."
