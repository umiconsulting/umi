#!/usr/bin/env bash
# Exercise the real runner against a disposable database and migration directory.
set -euo pipefail
unset UMI_PG_CONTAINER UMI_MIGRATE_ALLOW_DRIFT
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB="umi_ci_runner_$$"
FIXTURE="$(mktemp -d)"
createdb "$DB"
cleanup() {
  dropdb --if-exists "$DB"
  rm -rf "$FIXTURE"
}
trap cleanup EXIT
mkdir "$FIXTURE/migrations"
cp "$ROOT/db/migrate.sh" "$FIXTURE/migrate.sh"

query() { psql -X -v ON_ERROR_STOP=1 -At -d "$DB" -c "$1"; }
run() { bash "$FIXTURE/migrate.sh" "$DB"; }

# Repeating this INSERT fails. A successful repeat therefore proves the file was skipped.
cat > "$FIXTURE/migrations/001_first.sql" <<'SQL'
create table runtime.migration_probe (id integer primary key);
insert into runtime.migration_probe values (1);
SQL
run
test "$(query 'select count(*) from runtime.migration_probe')" = 1
ledger="$(query 'select filename, checksum, applied_at from runtime.migration_ledger order by filename')"
run
test "$(query 'select filename, checksum, applied_at from runtime.migration_ledger order by filename')" = "$ledger"

echo 'insert into runtime.migration_probe values (2);' > "$FIXTURE/migrations/002_next.sql"
run
test "$(query 'select count(*) from runtime.migration_probe')" = 2
test "$(query 'select count(*) from runtime.migration_ledger')" = 2

cp "$FIXTURE/migrations/001_first.sql" "$FIXTURE/original"
echo '-- changed after application' >> "$FIXTURE/migrations/001_first.sql"
if run > "$FIXTURE/drift.log" 2>&1; then
  echo 'FAIL: the runner accepted a changed migration' >&2
  exit 1
fi
grep -q 'checksum mismatch' "$FIXTURE/drift.log"
test "$(query 'select count(*) from runtime.migration_probe')" = 2
cp "$FIXTURE/original" "$FIXTURE/migrations/001_first.sql"

echo 'select missing_migration_function();' > "$FIXTURE/migrations/003_failure.sql"
if run > "$FIXTURE/failure.log" 2>&1; then
  echo 'FAIL: the runner accepted a SQL error' >&2
  exit 1
fi
test "$(query "select count(*) from runtime.migration_ledger where filename = '003_failure.sql'")" = 0
echo 'Migration runner: apply, skip, pending delta, drift, and SQL failure passed.'
