#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${EXPECTED_SCHEMA_VERSION:?EXPECTED_SCHEMA_VERSION is required}"

export PGPASSWORD="$POSTGRES_PASSWORD"
export PGHOST=postgres
export PGUSER=postgres
mkdir -p /state/migrations
log="/state/migrations/${RELEASE_VERSION:-unknown}-$(date -u +%Y%m%dT%H%M%SZ).log"

# The PostgreSQL image uses a temporary server while it applies init scripts.
# Wait for the final TCP listener because Compose can observe that temporary server.
database_ready=false
for _ in $(seq 1 30); do
  if psql -X -At -v ON_ERROR_STOP=1 -d "$POSTGRES_DB" -c 'select 1' >/dev/null 2>&1; then
    database_ready=true
    break
  fi
  sleep 1
done
[ "$database_ready" = true ] || {
  echo "PostgreSQL did not become ready for migration." >&2
  exit 1
}

schema_exists="$(psql -X -At -v ON_ERROR_STOP=1 -d "$POSTGRES_DB" \
  -c "select to_regclass('merchant.merchant') is not null")"
current_version="$(psql -X -At -v ON_ERROR_STOP=1 -d "$POSTGRES_DB" \
  -c "select case when to_regclass('runtime.schema_migration') is null then '' else coalesce((select version from runtime.schema_migration order by applied_at desc limit 1),'') end")"

if [ "$schema_exists" = f ]; then
  echo "migration path: empty database -> $EXPECTED_SCHEMA_VERSION" | tee "$log"
  bash /workspace/docs/migration/build-v3/00_run.sh "$POSTGRES_DB" 2>&1 | tee -a "$log"
elif [ "$current_version" = "$EXPECTED_SCHEMA_VERSION" ]; then
  echo "migration path: $current_version -> verification" | tee "$log"
  psql -X -v ON_ERROR_STOP=1 -d "$POSTGRES_DB" \
    -f /workspace/docs/migration/build-v3/99_verify.sql 2>&1 | tee -a "$log"
elif [ "$current_version" = "build-v3-45" ]; then
  echo "migration path: build-v3-45 -> $EXPECTED_SCHEMA_VERSION" | tee "$log"
  psql -X -v ON_ERROR_STOP=1 -d "$POSTGRES_DB" \
    -f /workspace/docs/migration/build-v3/46_platform_bootstrap.sql 2>&1 | tee -a "$log"
  psql -X -v ON_ERROR_STOP=1 -d "$POSTGRES_DB" \
    -f /workspace/docs/migration/build-v3/99_verify.sql 2>&1 | tee -a "$log"
elif [ -z "$current_version" ] && \
  [ "$(psql -X -At -v ON_ERROR_STOP=1 -d "$POSTGRES_DB" -c "select to_regclass('merchant.administrative_command') is not null")" = t ]; then
  echo "migration path: certified build-v3-44 -> $EXPECTED_SCHEMA_VERSION" | tee "$log"
  psql -X -v ON_ERROR_STOP=1 -d "$POSTGRES_DB" \
    -f /workspace/docs/migration/build-v3/45_pilot_runtime.sql 2>&1 | tee -a "$log"
  psql -X -v ON_ERROR_STOP=1 -d "$POSTGRES_DB" \
    -f /workspace/docs/migration/build-v3/46_platform_bootstrap.sql 2>&1 | tee -a "$log"
  psql -X -v ON_ERROR_STOP=1 -d "$POSTGRES_DB" \
    -f /workspace/docs/migration/build-v3/99_verify.sql 2>&1 | tee -a "$log"
else
  echo "Unsupported migration range: ${current_version:-unknown} -> $EXPECTED_SCHEMA_VERSION" >&2
  exit 1
fi
psql -X -v ON_ERROR_STOP=1 -h postgres -U postgres -d "$POSTGRES_DB" \
  -c "select version,status from runtime.schema_migration order by applied_at desc;" \
  -c "select count(*) as forced_rls_tables from pg_class where relkind='r' and relrowsecurity and relforcerowsecurity;" \
  >>"$log"
