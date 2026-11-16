#!/usr/bin/env bash
# Rebuild and seed the gate-3 semantic fixture, then write fixture.json.
#
# Usage (local, disposable database only):
#   PGPASSWORD=... tools/verification/fixtures/semantic-gate3/seed-runner.sh
#
# The database name must start with `umi_gate3_`. The runner drops it, builds the
# base schema and the forward migrations, creates the login roles and the local
# platform administrator, then runs seed.sql with the merchant local date.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
DB="${GATE3_DB:-umi_gate3_2b08f55c}"
CONTAINER="${GATE3_PG_CONTAINER:-umi-buildv3-local-postgres-1}"
export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-4003}"
export PGUSER="${PGUSER:-postgres}"
: "${PGPASSWORD:?set PGPASSWORD for the local postgres role}"

case "$DB" in
  umi_gate3_*) ;;
  *)
    echo "refusing: database must start with umi_gate3_ (got $DB)" >&2
    exit 1
    ;;
esac

D0="$(psql -At -d postgres -c "select (now() at time zone 'America/Mazatlan')::date")"

echo "== recreate $DB =="
psql -d postgres -v ON_ERROR_STOP=1 \
  -c "drop database if exists \"$DB\" with (force)" \
  -c "create database \"$DB\""

echo "== base schema =="
bash "$ROOT/db/00_run.sh" "$DB" >/tmp/gate3-schema.log 2>&1
bash "$ROOT/db/migrate.sh" "$DB" >/tmp/gate3-migrate.log 2>&1

echo "== roles =="
psql -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/apps/umi-api/test/integration/harness-roles.sql" >/tmp/gate3-roles.log 2>&1
psql -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/apps/umi-api/db/roles/004_login_roles.sql" >/tmp/gate3-login-roles.log 2>&1

echo "== platform administrator =="
bash "$ROOT/scripts/umi-local-platform-admin.sh" \
  --email hola@umiconsulting.co --create --password 'Umi2026!' \
  --container "$CONTAINER" --database "$DB" >/tmp/gate3-admin.log 2>&1

echo "== seed D0=$D0 =="
psql -d "$DB" -v ON_ERROR_STOP=1 -v d0="$D0" \
  -f "$HERE/seed.sql" >/tmp/gate3-seed.log 2>&1

SEED_SHA="$(sha256sum "$HERE/seed.sql" | awk '{print $1}')"
FIXTURE="$HERE/fixture.json"
cat >"$FIXTURE" <<JSON
{
  "record": "gate3-semantic-fixture-v1",
  "d0": "$D0",
  "merchantId": "55555555-5555-4555-8555-000000000001",
  "locations": {
    "centro": "55555555-5555-4555-8555-000000000011",
    "norte": "55555555-5555-4555-8555-000000000012"
  },
  "products": {
    "PR1": "55555555-5555-4555-8555-000000000031",
    "PR2": "55555555-5555-4555-8555-000000000032",
    "PR3": "55555555-5555-4555-8555-000000000033"
  },
  "sales": {
    "S1": "55555555-5555-4555-8555-0000000000e1",
    "S2": "55555555-5555-4555-8555-0000000000e2",
    "S3": "55555555-5555-4555-8555-0000000000e3",
    "S4": "55555555-5555-4555-8555-0000000000e4",
    "S5": "55555555-5555-4555-8555-0000000000e5"
  },
  "refund": "55555555-5555-4555-8555-000000000111",
  "accounts": {
    "centro": "gate3.centro@example.test",
    "all": "gate3.all@example.test",
    "bound": "gate3.bound@example.test"
  },
  "seedSha256": "$SEED_SHA"
}
JSON

EVIDENCE_DIR="${GATE3_EVIDENCE_DIR:-$ROOT/../../.gate3/evidence}"
mkdir -p "$EVIDENCE_DIR"
cp "$FIXTURE" "$EVIDENCE_DIR/fixture.json"
echo "wrote $FIXTURE"
echo "wrote $EVIDENCE_DIR/fixture.json"
echo "seedSha256 $SEED_SHA"
