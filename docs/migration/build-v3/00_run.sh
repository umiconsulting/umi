#!/usr/bin/env bash
# Apply build-v3 to a local database, in order.
#   usage: ./00_run.sh [dbname]   (default: umi_build_v3)
set -euo pipefail
DB="${1:-umi_build_v3}"
DIR="$(cd "$(dirname "$0")" && pwd)"

for f in 00_foundation 10_umi 20_merchant 30_runtime 30_device_pairing 31_pos_sale 32_pos_checkout 33_pos_cash 34_pos_exception 35_pos_pilot_rbac 36_pos_inventory 37_pos_customer_value 50_cross_schema_fk 60_triggers 90_rls 99_verify; do
  echo "== $f =="
  psql -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/$f.sql"
done
echo "build-v3 applied to $DB"
