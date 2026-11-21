#!/usr/bin/env bash
# Verify the schema and API integration against a new, disposable database.
# PGHOST, PGPORT, PGUSER, and PGPASSWORD identify a dedicated local test server.
set -euo pipefail
unset UMI_PG_CONTAINER UMI_MIGRATE_ALLOW_DRIFT
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export GATE_DB="${GATE_DB:-umi_ci_$$}"
[[ "$GATE_DB" =~ ^umi_(ci|p0)(_[a-zA-Z0-9_]+)?$ ]] || {
  echo 'Use a disposable database name with the umi_ci or umi_p0 prefix.' >&2
  exit 1
}
createdb "$GATE_DB"
trap 'dropdb --if-exists "$GATE_DB"' EXIT

bash db/00_run.sh "$GATE_DB"

psql -X -v ON_ERROR_STOP=1 -d "$GATE_DB" -v bootstrap_email=ci@umi.invalid -f db/backfill/seed_rbac.sql
psql -X -v ON_ERROR_STOP=1 -d "$GATE_DB" -f apps/umi-api/test/integration/harness-roles.sql
psql -X -v ON_ERROR_STOP=1 -d "$GATE_DB" -f apps/umi-api/db/roles/004_login_roles.sql
bash db/migrate.sh "$GATE_DB"

API_LOGIN_PASSWORD="${API_LOGIN_PASSWORD:-harness_api}"
WORKER_LOGIN_PASSWORD="${WORKER_LOGIN_PASSWORD:-harness_worker}"
export DATABASE_URL_APP="${DATABASE_URL_APP:-postgresql://api_login:${API_LOGIN_PASSWORD}@${PGHOST:-localhost}:${PGPORT:-5432}/$GATE_DB}"
export DATABASE_URL_WORKER="${DATABASE_URL_WORKER:-postgresql://worker_login:${WORKER_LOGIN_PASSWORD}@${PGHOST:-localhost}:${PGPORT:-5432}/$GATE_DB}"
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

# Stopgap: prove db/90_rls.sql is idempotent inside a rollback. The durable
# checkout grants now live in 90_rls, so a persistent second application keeps
# INSERT/UPDATE on merchant.kitchen_order. This rollback remains only as a
# stopgap until the second-apply proof moves out of check.sh.
policies_before="$(psql -X -qAt -d "$GATE_DB" -c 'select count(*) from pg_policies')"
policies_same="$(psql -X -qAt -v ON_ERROR_STOP=1 -v before="$policies_before" -d "$GATE_DB" <<'SQL'
begin;
\i db/90_rls.sql
select count(*) = :before from pg_policies;
rollback;
SQL
)"
test "$policies_same" = "t"
bash db/migrate.sh "$GATE_DB"
test "$(query 'select filename, checksum, applied_at from runtime.migration_ledger order by filename')" = "$ledger"
test "$(query 'select count(*) from pg_policies')" = "$policies"
psql -X -v ON_ERROR_STOP=1 -d "$GATE_DB" -f db/99_verify.sql
psql -X -v ON_ERROR_STOP=1 -d "$GATE_DB" -f db/security_gate.sql
bash db/test/migrate.sh

# ONCA incident 001. The recovery suite proves the captured attempt. The
# acceptance suite must fail while the product defect remains. Both use the
# disposable database and harness roles above.
pnpm --filter @umi/api test:integration:checkout
pnpm --filter @umi/api test:acceptance:checkout
pnpm --filter @umi/api test:integration:kitchen
pnpm --filter @umi/api test:integration:tables
pnpm --filter @umi/api test:acceptance:bound-settlement
# Note: test:integration:migration's pristine-safe suites (pooler-isolation and
# identity-normalization) run inside test:integration:schema above. The remaining
# two files (rls.integration.ts, smoke.integration.ts) require a backfilled
# production snapshot (umi_backfill_v3) and APP_QR_SECRET.
