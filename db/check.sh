#!/usr/bin/env bash
# Verify the schema and API integration against a new, disposable database.
# PGHOST, PGPORT, PGUSER, and PGPASSWORD identify a dedicated local test server.
set -euo pipefail
unset UMI_PG_CONTAINER UMI_MIGRATE_ALLOW_DRIFT
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export GATE_DB="${GATE_DB:-umi_ci_$$}"
[[ "$GATE_DB" =~ ^umi_ci(_[a-zA-Z0-9_]+)?$ ]] || {
  echo 'Use a disposable database name with the umi_ci prefix.' >&2
  exit 1
}
createdb "$GATE_DB"
trap 'dropdb --if-exists "$GATE_DB"' EXIT

bash db/00_run.sh "$GATE_DB"
psql -X -v ON_ERROR_STOP=1 -d "$GATE_DB" -v bootstrap_email=ci@umi.invalid -f db/backfill/seed_rbac.sql
psql -X -v ON_ERROR_STOP=1 -d "$GATE_DB" -f apps/umi-api/test/integration/harness-roles.sql
psql -X -v ON_ERROR_STOP=1 -d "$GATE_DB" -f apps/umi-api/db/roles/004_login_roles.sql
bash db/migrate.sh "$GATE_DB"

export DATABASE_URL_APP="postgresql://api_login:harness_api@${PGHOST:-localhost}:${PGPORT:-5432}/$GATE_DB"
export DATABASE_URL_WORKER="postgresql://worker_login:harness_worker@${PGHOST:-localhost}:${PGPORT:-5432}/$GATE_DB"
export DATABASE_URL_ADMIN="postgresql://${PGUSER:-postgres}:${PGPASSWORD:?Set the disposable server password}@${PGHOST:-localhost}:${PGPORT:-5432}/$GATE_DB"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
JWT_SECRET="$(openssl rand -hex 24)"
export JWT_SECRET
pnpm --filter @umi/api test:integration:schema
pnpm --filter @umi/api test:integration:realtime
bash db/freeze.sh check

query() { psql -X -v ON_ERROR_STOP=1 -At -d "$GATE_DB" -c "$1"; }
policies="$(query 'select count(*) from pg_policies')"
ledger="$(query 'select filename, checksum, applied_at from runtime.migration_ledger order by filename')"
psql -X -v ON_ERROR_STOP=1 -d "$GATE_DB" -f db/test/ledger-seed.sql
psql -X -v ON_ERROR_STOP=1 -d "$GATE_DB" -f db/90_rls.sql
bash db/migrate.sh "$GATE_DB"
test "$(query 'select filename, checksum, applied_at from runtime.migration_ledger order by filename')" = "$ledger"
test "$(query 'select count(*) from pg_policies')" = "$policies"
psql -X -v ON_ERROR_STOP=1 -d "$GATE_DB" -f db/99_verify.sql
psql -X -v ON_ERROR_STOP=1 -d "$GATE_DB" -f db/security_gate.sql
bash db/test/migrate.sh
