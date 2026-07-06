#!/usr/bin/env bash
# =============================================================================
# 00_run.sh — canonical rebuild v2 P0/P1 SMOKE RUNNER.
#
# Drops + recreates a scratch DB `umi_rebuild_smoke` on port 5233 and runs the
# new canonical DDL + RLS gate IN ORDER (one tx per file, ON_ERROR_STOP), then
# the structural verify. NO FDW / NO backfill — proves the P0/P1 schema assembles
# clean and the RLS/seal/append-only gates pass on an empty build.
#
# Usage:  bash 00_run.sh            # full build + verify
#         KEEP_DB=1 bash 00_run.sh  # leave the scratch DB up for inspection
# Requires: PostgreSQL 18 at /opt/homebrew/opt/postgresql@18/bin, port 5233.
# =============================================================================
set -uo pipefail

PGBIN="/opt/homebrew/opt/postgresql@18/bin"
PSQL="${PGBIN}/psql"
PORT="5233"
ADMIN_DB="postgres"
DB="${TARGET_DB:-umi_rebuild_smoke}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${HERE}/.build_logs"
mkdir -p "${LOG_DIR}"

FILES=(
  00_foundation
  11_tenant_core
  12_tenant_commerce
  13_tenant_loyalty
  14_tenant_comms
  15_tenant_ops
  16_runtime
  17_observability
  18_umi
  90_rls
)

echo "============================================================"
echo " Umi canonical rebuild v2 smoke  ->  db=${DB}  port=${PORT}"
echo " psql: $(${PSQL} --version 2>/dev/null || echo 'NOT FOUND')"
echo "============================================================"

"${PSQL}" -p "${PORT}" -d "${ADMIN_DB}" -v ON_ERROR_STOP=1 -q <<SQL || { echo "FATAL: cannot reach cluster on ${PORT}"; exit 2; }
select pg_terminate_backend(pid) from pg_stat_activity
 where datname = '${DB}' and pid <> pg_backend_pid();
SQL
"${PSQL}" -p "${PORT}" -d "${ADMIN_DB}" -v ON_ERROR_STOP=1 -q \
  -c "drop database if exists ${DB};" -c "create database ${DB};" \
  || { echo "FATAL: could not (re)create ${DB}"; exit 2; }

OVERALL_OK=1
for name in "${FILES[@]}"; do
  path="${HERE}/${name}.sql"
  log="${LOG_DIR}/${name}.log"
  if [[ ! -f "${path}" ]]; then
    echo "  [MISS] ${name}.sql not found"; OVERALL_OK=0; break
  fi
  if "${PSQL}" -p "${PORT}" -d "${DB}" -v ON_ERROR_STOP=1 --single-transaction \
       -f "${path}" >"${log}" 2>&1; then
    echo "  [ OK ] ${name}"
  else
    echo "  [FAIL] ${name}  -> ${log}"
    echo "  ---- first error ----"
    grep -m3 -iE "ERROR|FATAL|exception" "${log}" | sed 's/^/    /'
    OVERALL_OK=0; break
  fi
done

if [[ "${OVERALL_OK}" -eq 1 ]]; then
  echo "------------------------------------------------------------"
  echo " Running structural verify (99_verify) ..."
  if "${PSQL}" -p "${PORT}" -d "${DB}" -v ON_ERROR_STOP=1 \
       -f "${HERE}/99_verify.sql" >"${LOG_DIR}/99_verify.log" 2>&1; then
    grep -E "CHECK|GATE PASSED|notice" "${LOG_DIR}/99_verify.log" | sed 's/^/    /'
    echo " ✅ BUILD + VERIFY GREEN"
  else
    echo " ❌ VERIFY FAILED -> ${LOG_DIR}/99_verify.log"
    grep -m5 -iE "ERROR|exception|FAILED" "${LOG_DIR}/99_verify.log" | sed 's/^/    /'
    OVERALL_OK=0
  fi
fi

if [[ "${KEEP_DB:-0}" != "1" && "${OVERALL_OK}" -eq 1 ]]; then
  "${PSQL}" -p "${PORT}" -d "${ADMIN_DB}" -q -c "drop database if exists ${DB};" >/dev/null 2>&1
fi

[[ "${OVERALL_OK}" -eq 1 ]] && exit 0 || exit 1
