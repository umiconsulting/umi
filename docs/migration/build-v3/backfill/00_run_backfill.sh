#!/usr/bin/env bash
# ============================================================================
# build-v3 COEXIST backfill — prod (core/loyalty/ops/grow/comms/observability)
# translated into the new umi/merchant/runtime schemas, on a clone of the prod
# snapshot. Proves the rename is lossless (see reconcile_v3.sql).
#
#   usage: ./00_run_backfill.sh [target_db] [template_db]
#          defaults: umi_backfill_v3   umi_prod_snapshot
#          (local PG is on PORT 5233 — export PGPORT=5233)
#          BOOTSTRAP_EMAIL=<address> names the first platform administrator; it is
#          passed to seed_rbac.sql, which refuses to run without it. Defaults to a
#          LOCAL-ONLY address so a throwaway rehearsal needs no argument — always
#          set it explicitly for anything a real operator will log in to.
#
# ORDER MATTERS. Two ordering rules the hard way:
#   1. The loyalty VERTICAL (backfill_loyalty_v3) runs FIRST — it is the only
#      file that seeds merchant.merchant / customer / contact / loyalty_card /
#      stored_value_ledger / loyalty_visit. The 6 domain files build on top and
#      will FK-fail against an empty merchant.merchant without it.
#   2. Cross-schema FKs (50_cross_schema_fk) + RLS (90_rls) are applied AFTER the
#      data lands — they add umi->merchant FKs (user_role/subscription/invoice ->
#      merchant) that reference rows the backfill creates. 99_verify is pristine-
#      build-only (it asserts the prod schemas do NOT exist) — skip it here.
# ============================================================================
set -euo pipefail
DB="${1:-umi_backfill_v3}"
TEMPLATE="${2:-umi_prod_snapshot}"
BOOTSTRAP_EMAIL="${BOOTSTRAP_EMAIL:-bootstrap@localhost.invalid}"
DDL="$(cd "$(dirname "$0")/.." && pwd)"     # docs/migration/build-v3
BF="$(cd "$(dirname "$0")" && pwd)"         # .../backfill

echo "== (re)create $DB from template $TEMPLATE =="
psql -d postgres -tAc "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('$DB','$TEMPLATE') and pid<>pg_backend_pid()" >/dev/null 2>&1 || true
psql -d postgres -c "drop database if exists $DB"
psql -d postgres -c "create database $DB template $TEMPLATE"

echo "== schema: tables + touch triggers (NO cross-FK yet) =="
for f in 00_foundation 10_umi 20_merchant 30_runtime 60_triggers; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$DDL/$f.sql"
done

echo "== backfill: vertical FIRST, then 6 domains =="
for d in loyalty_v3 identity loyalty commerce comms device growth; do
  echo "   -> $d"
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$BF/backfill_$d.sql"
done

echo "== seed: RBAC role -> permission grants (source had none) =="
psql -v ON_ERROR_STOP=1 -q -d "$DB" -v bootstrap_email="$BOOTSTRAP_EMAIL" -f "$BF/seed_rbac.sql"

# ----------------------------------------------------------------------------
# DID THE MIGRATION PRODUCE AN ADMINISTRATOR? Ask, rather than assume.
#
# `seed_rbac.sql` grants `super_admin` to the address it is handed, and matches it
# against `umi.user` BY EMAIL. An address that matches nobody — the local-only
# default, or a typo at 04:00 — grants nothing, raises nothing, and the run still
# reports success. `umi.user_role` comes out EMPTY, and then every merchant-scoped
# route answers 404 because `MerchantAccessGuard` finds no membership.
#
# Found on 2026-08-18 by the endpoint smoke: 38 routes 404'd against a clone that
# had backfilled without a single SQL error.
#
# An unset BOOTSTRAP_EMAIL is a throwaway rehearsal and only warns. An address
# that WAS given and did not land is a failure: the operator asked for an
# administrator and did not get one.
# ----------------------------------------------------------------------------
GRANTS=$(psql -tAq -d "$DB" -c "select count(*) from umi.user_role where is_platform and revoked_at is null")
if [ "$GRANTS" -eq 0 ]; then
  if [ "${BOOTSTRAP_EMAIL}" = "bootstrap@localhost.invalid" ]; then
    echo "   ⚠ no platform administrator: BOOTSTRAP_EMAIL was not set."
    echo "     Fine for a throwaway. NOT fine for the cutover — nobody can administer this platform."
  else
    echo "   ✗ BOOTSTRAP_EMAIL='$BOOTSTRAP_EMAIL' granted nothing." >&2
    echo "     No umi.user carries that address, so the platform has NO administrator." >&2
    exit 1
  fi
else
  echo "   platform administrator(s): $GRANTS"
fi

echo "== cross-schema FKs + RLS (data now present) =="
for f in 50_cross_schema_fk 90_rls; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$DDL/$f.sql"
done

echo "== reconcile =="
psql -q -d "$DB" -f "$BF/reconcile_v3.sql"
echo "done: $DB"
