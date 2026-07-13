#!/usr/bin/env bash
# ============================================================================
# build-v3 COEXIST backfill — prod (core/loyalty/ops/grow/comms/observability)
# translated into the new umi/tenant/runtime schemas, on a clone of the prod
# snapshot. Proves the rename is lossless (see reconcile_v3.sql).
#
#   usage: ./00_run_backfill.sh [target_db] [template_db]
#          defaults: umi_backfill_v3   umi_prod_snapshot
#          (local PG is on PORT 5233 — export PGPORT=5233)
#
# ORDER MATTERS. Two ordering rules the hard way:
#   1. The loyalty VERTICAL (backfill_loyalty_v3) runs FIRST — it is the only
#      file that seeds tenant.business / customer / contact / loyalty_card /
#      stored_value_ledger / loyalty_visit. The 6 domain files build on top and
#      will FK-fail against an empty tenant.business without it.
#   2. Cross-schema FKs (50_cross_schema_fk) + RLS (90_rls) are applied AFTER the
#      data lands — they add umi->tenant FKs (user_role/subscription/invoice ->
#      business) that reference rows the backfill creates. 99_verify is pristine-
#      build-only (it asserts the prod schemas do NOT exist) — skip it here.
# ============================================================================
set -euo pipefail
DB="${1:-umi_backfill_v3}"
TEMPLATE="${2:-umi_prod_snapshot}"
DDL="$(cd "$(dirname "$0")/.." && pwd)"     # docs/migration/build-v3
BF="$(cd "$(dirname "$0")" && pwd)"         # .../backfill

echo "== (re)create $DB from template $TEMPLATE =="
psql -d postgres -tAc "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('$DB','$TEMPLATE') and pid<>pg_backend_pid()" >/dev/null 2>&1 || true
psql -d postgres -c "drop database if exists $DB"
psql -d postgres -c "create database $DB template $TEMPLATE"

echo "== schema: tables + touch triggers (NO cross-FK yet) =="
for f in 00_foundation 10_umi 20_tenant 30_runtime 60_triggers; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$DDL/$f.sql"
done

echo "== backfill: vertical FIRST, then 6 domains =="
for d in loyalty_v3 identity loyalty commerce comms device growth; do
  echo "   -> $d"
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$BF/backfill_$d.sql"
done

echo "== cross-schema FKs + RLS (data now present) =="
for f in 50_cross_schema_fk 90_rls; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$DDL/$f.sql"
done

echo "== reconcile =="
psql -q -d "$DB" -f "$BF/reconcile_v3.sql"
echo "done: $DB"
