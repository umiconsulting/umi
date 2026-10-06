#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${UMI_POS_KDS_DB_NAME:-umi_pos_kds_race_$$}"

if ! command -v psql >/dev/null 2>&1; then
  command -v docker >/dev/null 2>&1 || {
    echo "PostgreSQL or Docker is required." >&2
    exit 1
  }
  CONTAINER="umi-pos-kds-race-$RANDOM"
  trap 'docker rm -f "$CONTAINER" >/dev/null 2>&1 || true' EXIT
  docker run --rm -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres \
    -p 127.0.0.1::5432 -v "$ROOT:$ROOT" -w "$ROOT" pgvector/pgvector:pg16 >/dev/null
  for _ in $(seq 1 30); do
    docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec -e PGHOST=/var/run/postgresql -e PGUSER=postgres \
    -e UMI_POS_KDS_DB_NAME=umi_pos_kds_race_app -e UMI_POS_KDS_DB_KEEP=1 \
    -e UMI_POS_KDS_SETUP_ONLY=1 "$CONTAINER" \
    bash "$ROOT/scripts/umi-pos-kds-concurrency-check.sh"
  PORT="$(docker port "$CONTAINER" 5432/tcp | sed 's/.*://')"
  GATE4A_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:$PORT/umi_pos_kds_race_app" \
    pnpm --filter @umi/api exec vitest run src/modules/kds/kds.repository.integration.spec.ts
  exit $?
fi

cleanup() {
  if [ "${UMI_POS_KDS_DB_KEEP:-0}" != "1" ]; then
    psql -q -c "drop database if exists $DB;" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
psql -q -c "create database $DB;" >/dev/null
bash "$ROOT/docs/migration/build-v3/00_run.sh" "$DB" >/dev/null

psql -X -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
insert into merchant.merchant(id,name)
values('a0000000-0000-4000-8000-000000000001','Gate 4A Cafe');
insert into merchant.location(id,merchant_id,name)
values('a1000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Kitchen');
insert into merchant.station(id,merchant_id,location_id,key,name)
values
  ('a2000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','hot','Hot'),
  ('a2000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','expo','Expo');
insert into merchant.device(id,merchant_id,location_id,station_id,name,kind,status,credential_version)
values('ad000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',
  'Kitchen iPad','kds','active',1);
insert into runtime.session(id,merchant_id,principal_type,principal_id,station_id,device_name,token_hash,is_active,metadata)
values('ae000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','device',
  'ad000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',
  'Kitchen iPad','gate4a',true,jsonb_build_object('location_id','a1000000-0000-4000-8000-000000000001'));
insert into umi.user(id,email,full_name,status)
values('a5000000-0000-4000-8000-000000000001','kitchen@example.test','Kitchen Worker','active');
insert into merchant.product(id,merchant_id,name,price,requires_preparation)
values('a3000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Hot Item',100,true);
insert into merchant.kitchen_route
  (merchant_id,location_id,station_id,product_id,requires_preparation,route_priority)
values('a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',true,10);
insert into merchant.kitchen_device_station(merchant_id,location_id,device_id,station_id)
values('a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  'ad000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001');
SQL

if [ "${UMI_POS_KDS_SETUP_ONLY:-0}" = "1" ]; then
  trap - EXIT
  exit 0
fi

GATE4A_DATABASE_URL="${GATE4A_DATABASE_URL:-postgresql:///$DB}" \
  pnpm --filter @umi/api exec vitest run src/modules/kds/kds.repository.integration.spec.ts
