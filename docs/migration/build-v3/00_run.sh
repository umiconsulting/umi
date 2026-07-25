#!/usr/bin/env bash
# Apply build-v3 to a local database, in order.
#   usage: ./00_run.sh [dbname]   (default: umi_build_v3)
set -euo pipefail
DB="${1:-umi_build_v3}"
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../../.." && pwd)"

for f in \
  20260725000100_build_v3_foundation \
  20260725000200_build_v3_umi \
  20260725000300_build_v3_tenant \
  20260725000400_build_v3_runtime \
  20260725000500_build_v3_cross_schema_fk \
  20260725000600_build_v3_triggers \
  20260725000700_build_v3_rls; do
  echo "== $f =="
  psql -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/supabase/migrations/$f.sql"
done
echo "== 99_verify =="
psql -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/99_verify.sql"
echo "build-v3 applied to $DB"
