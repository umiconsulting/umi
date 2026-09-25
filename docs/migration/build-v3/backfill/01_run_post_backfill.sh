#!/usr/bin/env bash
# ============================================================================
# build-v3 — carry a BACKFILLED database to the head of the DDL chain.
#
#   usage: ./01_run_post_backfill.sh <db>
#
# WHY THIS EXISTS. 00_run_backfill.sh deliberately stops at 53_location_switch_
# grants, so its output lands on ledger `build-v3-48` (48 is simply the highest
# file in ITS list that inserts a ledger row — 49–53 and 60/61 never do). The
# files after it were then applied by hand, which is how the QA database and the
# workstation database ended up at different points with nobody able to say
# which. This script is that missing step, written down.
#
# WHY 61 IS HERE AND NOT IN 00_run_backfill.sh. 61_customer_activity is an
# UPDATE over merchant.customer, merchant.message, merchant.customer_order and
# friends — it computes each customer's last_activity_at from rows that must
# already exist. In the pristine chain it runs against an empty database and
# sets nothing; after a backfill it does the real work. Order matters: it must
# follow the data, which is why it lives on this side of the split even though
# its number sorts before 62.
#
# TRANSACTIONS. Each file is applied exactly as 00_run.sh and
# 00_run_backfill.sh apply it — one psql per file, ON_ERROR_STOP, no outer
# wrapper. Several of these files carry their own begin;/commit; and the ones
# that do not are unchanged from the pristine chain; adding a wrapper here would
# make this runner behave differently from the chain it is completing.
#
# 77_ai_usage IS NOT IN THIS REPOSITORY YET. It is the per-call LLM billing
# fact reserved by BACKFILL_METHODOLOGY decision L20, and it currently lives
# only on the unmerged `wip/ai-usage-and-research` branch. The loop tolerates
# its absence rather than failing, and says so out loud, so this script is
# honest in a checkout that has it and in one that does not.
# ============================================================================
set -euo pipefail

DB="${1:?usage: $0 <db>}"
DDL="$(cd "$(dirname "$0")/.." && pwd)"

FILES=(
  61_customer_activity
  62_floor_plan
  63_channel_attribution
  64_pos_cart_recovery
  65_table_reservation
  66_pos_cart_recovery_rollback
  67_table_state
  68_cash_shift_orphan_reclaim
  69_procurement
  70_tender
  71_immutable_delete_fix
  72_mp_point
  73_mp_refund
  74_kitchen_courses
  75_table_order_credential
  76_recipes_inventory
  77_ai_usage
)

echo "== post-backfill migrations -> $DB =="
for f in "${FILES[@]}"; do
  if [ ! -f "$DDL/$f.sql" ]; then
    if [ "$f" = "77_ai_usage" ]; then
      echo "   -- $f is not in this checkout (unmerged branch) — head stays at 76"
      continue
    fi
    echo "FATAL: $DDL/$f.sql is missing" >&2
    exit 1
  fi
  echo "   -> $f"
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$DDL/$f.sql"
done

echo "== head =="
psql -tAq -d "$DB" -c "select max(version) from runtime.schema_migration"
