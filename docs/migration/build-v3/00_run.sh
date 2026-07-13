#!/usr/bin/env bash
# Apply build-v3 to a local database, in order.
#   usage: ./00_run.sh [dbname]   (default: umi_build_v3)
set -euo pipefail
DB="${1:-umi_build_v3}"
DIR="$(cd "$(dirname "$0")" && pwd)"

for f in 00_foundation 10_umi 20_tenant 30_runtime 50_cross_schema_fk 60_triggers 90_rls 99_verify; do
  echo "== $f =="
  psql -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/$f.sql"
done
echo "build-v3 applied to $DB"
