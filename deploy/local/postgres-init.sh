#!/usr/bin/env bash
# Runs once, on the first start of an empty volume (docker-entrypoint-initdb.d).
# Restores the roles and the single local database from ./seed.
set -euo pipefail

SEED=/seed
DB="${POSTGRES_DB}"

if [ ! -s "$SEED/roles.sql" ] || [ ! -s "$SEED/$DB.dump" ]; then
  echo "umi-local: seed files missing in $SEED (roles.sql, $DB.dump)" >&2
  exit 1
fi

echo "umi-local: restoring roles"
psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f "$SEED/roles.sql"

echo "umi-local: restoring $DB"
pg_restore -U postgres -d "$DB" --exit-on-error --no-password "$SEED/$DB.dump"

echo "umi-local: seed complete"
