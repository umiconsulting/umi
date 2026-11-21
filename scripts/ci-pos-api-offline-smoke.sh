#!/usr/bin/env bash
# Tier 3 Real End-to-End Offline-First Smoke Test:
#   Real Dart POS client -> Controllable HTTP proxy -> Real NestJS API -> Real PostgreSQL + Redis.
#
# Requires: PGHOST, PGPORT, PGUSER, PGPASSWORD, REDIS_URL (defaults to localhost),
# built apps/umi-api/dist/main.js, and Flutter on PATH (or FLUTTER_BIN).
set -euo pipefail
unset UMI_PG_CONTAINER UMI_MIGRATE_ALLOW_DRIFT

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FLUTTER_BIN="${FLUTTER_BIN:-$(command -v flutter || echo /home/juan/.local/opt/flutter/bin/flutter)}"
export GATE_DB="${GATE_DB:-umi_ci_offline_e2e_$$}"
[[ "$GATE_DB" =~ ^umi_(ci|p0|e2e)(_[a-zA-Z0-9_]+)?$ ]] || {
  echo 'Use a disposable database name with the umi_ci, umi_p0, or umi_e2e prefix.' >&2
  exit 1
}

API_PID=""
API_LOG="$(mktemp)"
cleanup() {
  if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  rm -f "$API_LOG"
  dropdb --if-exists "$GATE_DB" 2>/dev/null || true
}
trap cleanup EXIT

echo "==> Creating disposable database: $GATE_DB"
createdb "$GATE_DB"
bash db/00_run.sh "$GATE_DB" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -d "$GATE_DB" -v bootstrap_email=ci@umi.invalid -f db/backfill/seed_rbac.sql >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -d "$GATE_DB" -f apps/umi-api/test/integration/harness-roles.sql >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -d "$GATE_DB" -f apps/umi-api/db/roles/004_login_roles.sql >/dev/null
bash db/migrate.sh "$GATE_DB" >/dev/null

API_LOGIN_PASSWORD="${API_LOGIN_PASSWORD:-harness_api}"
WORKER_LOGIN_PASSWORD="${WORKER_LOGIN_PASSWORD:-harness_worker}"
export DATABASE_URL_APP="postgresql://api_login:${API_LOGIN_PASSWORD}@${PGHOST:-localhost}:${PGPORT:-5432}/$GATE_DB"
export DATABASE_URL_WORKER="postgresql://worker_login:${WORKER_LOGIN_PASSWORD}@${PGHOST:-localhost}:${PGPORT:-5432}/$GATE_DB"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 24)}"
export APP_QR_SECRET="${APP_QR_SECRET:-$(openssl rand -hex 24)}"
export NODE_ENV="test"
export UMI_ENVIRONMENT="development"

API_PORT="$(node -e "const net=require('net');const s=net.createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close();});")"
export PORT="$API_PORT"

echo "==> Seeding offline E2E café fixture"
UMI_E2E_FIXTURE_JSON="$(node scripts/seed-offline-e2e-fixture.mjs)"
export UMI_E2E_FIXTURE_JSON
MERCHANT_ID="$(node -e "console.log(JSON.parse(process.env.UMI_E2E_FIXTURE_JSON).merchantId)")"
UNIT_PRICE="$(node -e "console.log(JSON.parse(process.env.UMI_E2E_FIXTURE_JSON).unitPriceMinorUnits)")"
EXPECTED_TOTAL="$((UNIT_PRICE * 2))"

echo "==> Starting real NestJS umi-api on 127.0.0.1:$API_PORT"
node apps/umi-api/dist/main.js >"$API_LOG" 2>&1 &
API_PID=$!

READY=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${API_PORT}/health/live" >/dev/null 2>&1; then
    READY=1
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "umi-api exited prematurely:" >&2
    cat "$API_LOG" >&2
    exit 1
  fi
  sleep 0.5
done
if [ "$READY" -ne 1 ]; then
  echo "umi-api failed to become healthy within 30s:" >&2
  cat "$API_LOG" >&2
  exit 1
fi

export UMI_E2E_API_URL="http://127.0.0.1:${API_PORT}"
echo "==> Running Tier 3 real Dart POS -> HTTP -> NestJS -> Postgres offline-first E2E smoke"
if ! (cd apps/umi-pos && "$FLUTTER_BIN" test --no-pub test/e2e/offline_replay_real_api_smoke_test.dart); then
  echo "=== umi-api tail logs on failure ===" >&2
  tail -n 80 "$API_LOG" >&2
  exit 1
fi

echo "==> Verifying authoritative PostgreSQL rows directly via psql"
query() { psql -X -v ON_ERROR_STOP=1 -At -d "$GATE_DB" -c "$1"; }

SALE_COUNT="$(query "SELECT count(*) FROM merchant.pos_committed_sale WHERE merchant_id = '${MERCHANT_ID}'::uuid")"
SALE_TOTAL="$(query "SELECT coalesce(sum(r.grand_total), 0) FROM merchant.pos_committed_sale s JOIN merchant.receipt_snapshot r ON r.id = s.receipt_snapshot_id WHERE s.merchant_id = '${MERCHANT_ID}'::uuid")"
KITCHEN_COUNT="$(query "SELECT count(*) FROM merchant.kitchen_order WHERE merchant_id = '${MERCHANT_ID}'::uuid")"
STOCK_LEDGER_COUNT="$(query "SELECT count(*) FROM merchant.stock_ledger_entry WHERE merchant_id = '${MERCHANT_ID}'::uuid AND entry_type = 'sale_committed'")"
CANCEL_CONFLICT_COUNT="$(query "SELECT count(*) FROM merchant.offline_replay_conflict WHERE merchant_id = '${MERCHANT_ID}'::uuid AND guidance_code = 'cart_cancelled_after_cash_taken' AND manager_action_required = true")"

echo "  pos_committed_sale count=${SALE_COUNT} (want 1), total=${SALE_TOTAL} (want ${EXPECTED_TOTAL})"
echo "  kitchen_order count=${KITCHEN_COUNT} (want >= 1)"
echo "  stock_ledger_entry(sale_committed) count=${STOCK_LEDGER_COUNT} (want >= 1)"
echo "  offline_replay_conflict(cart_cancelled_after_cash_taken, manager=true) count=${CANCEL_CONFLICT_COUNT} (want 1)"

test "$SALE_COUNT" = "1"
test "$SALE_TOTAL" = "$EXPECTED_TOTAL"
test "$KITCHEN_COUNT" -ge 1
test "$STOCK_LEDGER_COUNT" -ge 1
test "$CANCEL_CONFLICT_COUNT" = "1"

echo "==> Tier 3 real offline-first E2E PASSED!"
