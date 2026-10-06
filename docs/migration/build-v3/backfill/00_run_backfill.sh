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
#   IN-PLACE MODE (managed targets — Supabase, RDS, anything with ONE database):
#          UMI_BACKFILL_IN_PLACE=<target_db> ./00_run_backfill.sh <target_db>
#          Skips the drop/create-from-template step and runs the same file list
#          against the database that already exists. The rehearsal builds an
#          isolated target out of a snapshot, which a managed target cannot do.
#          Everything else — the DDL order, the data order, seed_rbac, reconcile —
#          is IDENTICAL, because every backfill statement is an INSERT … SELECT
#          inside one database.
#          Two guards, both deliberate: the name must match the positional target
#          (a typo cannot silently hit the wrong database), and the run refuses if
#          the target already carries build-v3 objects unless
#          UMI_BACKFILL_ALLOW_REAPPLY=1 is set on purpose.
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

if [ -n "${UMI_BACKFILL_IN_PLACE:-}" ]; then
  # ---- IN PLACE: the database already exists and is the target itself. -------
  if [ "$UMI_BACKFILL_IN_PLACE" != "$DB" ]; then
    echo "REFUSING: UMI_BACKFILL_IN_PLACE='$UMI_BACKFILL_IN_PLACE' but the target is '$DB'." >&2
    echo "          They must match; the guard exists so a typo cannot hit the wrong database." >&2
    exit 2
  fi
  if [ "${UMI_BACKFILL_ALLOW_REAPPLY:-}" != "1" ]; then
    applied="$(psql -d "$DB" -tAc \
      "select (to_regclass('merchant.merchant') is not null)::int + (to_regclass('umi.user') is not null)::int")"
    if [ "${applied:-0}" != "0" ]; then
      echo "REFUSING: '$DB' already carries build-v3 objects (merchant.merchant / umi.user)." >&2
      echo "          Re-running the DDL over an applied database is not idempotent." >&2
      echo "          If that is genuinely what you want, set UMI_BACKFILL_ALLOW_REAPPLY=1." >&2
      exit 3
    fi
  fi
  cat <<BANNER
############################################################
# IN-PLACE BACKFILL against '$DB'
# No drop, no template, no clone. This database is the target.
# The legacy schemas are READ (and left intact); the new
# schemas umi/merchant/runtime are CREATED alongside them.
############################################################
BANNER
  # The source must hold still while it is read. In the rehearsal the snapshot is
  # static by construction; here it is not, and a writer mid-run produces a target
  # that disagrees with its source for reasons no gate can see.
  echo "== writers currently connected (they must be stopped first) =="
  psql -d "$DB" -tAc "
    select coalesce(string_agg(distinct usename, ', '), '(none)')
      from pg_stat_activity
     where datname = current_database()
       and pid <> pg_backend_pid()
       and state <> 'idle'
       and usename <> 'postgres'"
else
  echo "== (re)create $DB from template $TEMPLATE =="
  psql -d postgres -tAc "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('$DB','$TEMPLATE') and pid<>pg_backend_pid()" >/dev/null 2>&1 || true
  psql -d postgres -c "drop database if exists $DB"
  psql -d postgres -c "create database $DB template $TEMPLATE"
fi

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

echo "== UmiPOS schema: migrates the rows the backfill just landed =="
# The UmiPOS files (architectureUMIposIntegration-v2) are written as migrations
# over EXISTING rows — ALTER, then a one-time UPDATE backfill, then SET NOT NULL —
# so they run after the data phase, and before the cross-schema FKs and RLS that
# reference the tables they create (90_rls scopes cash_shift, pos_exception_*,
# inventory_count, revokes DML on the value ledgers, …). Same relative order as
# 00_run.sh. 47 and 48 follow 90_rls there too, and do here.
for f in 30_device_pairing 31_pos_sale 32_pos_checkout 33_pos_cash 34_pos_exception \
         35_pos_pilot_rbac 36_pos_inventory 37_pos_customer_value \
         38_pos_customer_value_closeout 39_pos_customer_value_final_closeout \
         40_pos_hardware_runtime 41_pos_hardware_pilot 42_pos_kitchen \
         43_dashboard_administrative_commands 44_dashboard_operational_wiring \
         45_pilot_runtime 46_platform_bootstrap; do
  echo "   -> $f"
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$DDL/$f.sql"
done

echo "== carry: per-card reward override (needs 37_pos_customer_value's column) =="
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$BF/backfill_loyalty_override.sql"

echo "== cross-schema FKs + RLS (data now present) =="
for f in 50_cross_schema_fk 90_rls 47_checkout_kitchen_projection 48_customer_value_worker_scope \
         49_merchant_roles 51_manager_card_credential 52_platform_elevation \
         53_location_switch_grants; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$DDL/$f.sql"
done

echo "== reconcile =="
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$BF/reconcile_v3.sql"
echo "done: $DB"
