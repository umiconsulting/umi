#!/usr/bin/env bash
# Apply build-v3 to a local database, in order.
#   usage: ./00_run.sh [dbname]   (default: umi_build_v3)
set -euo pipefail
DB="${1:-umi_build_v3}"
DIR="$(cd "$(dirname "$0")" && pwd)"

for f in 00_foundation 10_umi 20_merchant 30_runtime 30_device_pairing 31_pos_sale 32_pos_checkout 33_pos_cash 34_pos_exception 35_pos_pilot_rbac 36_pos_inventory 37_pos_customer_value 38_pos_customer_value_closeout 39_pos_customer_value_final_closeout 40_pos_hardware_runtime 41_pos_hardware_pilot 42_pos_kitchen 43_dashboard_administrative_commands 44_dashboard_operational_wiring 45_pilot_runtime 46_platform_bootstrap 50_cross_schema_fk 60_triggers 90_rls 47_checkout_kitchen_projection 48_customer_value_worker_scope 49_merchant_roles 51_manager_card_credential 52_platform_elevation 53_location_switch_grants 99_verify; do
  echo "== $f =="
  psql -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/$f.sql"
done
echo "build-v3 applied to $DB"
