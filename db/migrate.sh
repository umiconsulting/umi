#!/usr/bin/env bash
# ============================================================================
# Apply unapplied PostgreSQL forward migrations from db/migrations/ in order.
#
# State is tracked in `runtime.migration_ledger` (filename, checksum, applied_at).
# Already-applied migrations with matching SHA-256 checksums are skipped so
# deployments execute only the unapplied delta.
#
# Usage:
#   bash db/migrate.sh [dbname_or_url]
#   bash db/migrate.sh [dbname_or_url] --baseline-through <filename>
#
# Environment overrides:
#   UMI_PG_CONTAINER               Run psql inside this Docker container via `docker exec -i`
#   UMI_MIGRATE_ALLOW_DRIFT=1      Warn instead of failing if an applied file's checksum changed
# ============================================================================
set -euo pipefail

DB_TARGET="${1:-umi_local}"
BASELINE_THROUGH=""
if [[ "${2:-}" == "--baseline-through" ]]; then
  BASELINE_THROUGH="${3:?--baseline-through requires a migration filename}"
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS_DIR="$DIR/migrations"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

run_psql() {
  if [[ -n "${UMI_PG_CONTAINER:-}" ]]; then
    docker exec -i "$UMI_PG_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "${PGUSER:-postgres}" -d "$DB_TARGET" "$@"
  elif command -v psql >/dev/null 2>&1; then
    psql -X -v ON_ERROR_STOP=1 "$DB_TARGET" "$@"
  else
    docker run --rm -i --network host \
      ${PGSSLROOTCERT:+-v "$(dirname "$PGSSLROOTCERT"):/certs:ro" -e "PGSSLROOTCERT=/certs/$(basename "$PGSSLROOTCERT")"} \
      pgvector/pgvector:0.8.5-pg17-bookworm \
      psql -X -v ON_ERROR_STOP=1 "$DB_TARGET" "$@"
  fi
}

# 1) Ensure runtime.migration_ledger exists with least-privilege grants.
run_psql -q <<'SQL'
create schema if not exists runtime;

create table if not exists runtime.migration_ledger (
  filename text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'api') then
    revoke all on runtime.migration_ledger from public, api;
  end if;
  if exists (select 1 from pg_roles where rolname = 'readonly') then
    revoke all on runtime.migration_ledger from readonly;
  end if;
  if exists (select 1 from pg_roles where rolname = 'worker') then
    grant select on runtime.migration_ledger to worker;
  end if;
end $$;
SQL

# 2) Load already-applied migrations from runtime.migration_ledger.
declare -A APPLIED_CHECKSUMS=()
while IFS='|' read -r fname fsum; do
  [[ -n "$fname" ]] || continue
  APPLIED_CHECKSUMS["$fname"]="$fsum"
done < <(run_psql -At -F '|' -c "select filename, checksum from runtime.migration_ledger order by filename")

applied_count=0
skipped_count=0

# 3) Walk db/migrations/*.sql in lexical order and apply only unapplied files.
for f in "$MIGRATIONS_DIR"/*.sql; do
  [[ -e "$f" ]] || break
  base="$(basename "$f")"
  checksum="$(sha256_file "$f")"

  if [[ -n "${APPLIED_CHECKSUMS[$base]+_}" ]]; then
    recorded="${APPLIED_CHECKSUMS[$base]}"
    if [[ "$recorded" != "$checksum" ]]; then
      if [[ "${UMI_MIGRATE_ALLOW_DRIFT:-0}" == "1" ]]; then
        echo "WARN: checksum drift on applied migration $base (ledger=$recorded, file=$checksum)" >&2
      else
        echo "ERROR: checksum mismatch for already-applied migration $base" >&2
        echo "  recorded in runtime.migration_ledger: $recorded" >&2
        echo "  current file on disk:                 $checksum" >&2
        exit 1
      fi
    fi
    skipped_count=$((skipped_count + 1))
    continue
  fi

  if [[ -n "$BASELINE_THROUGH" && ! "$base" > "$BASELINE_THROUGH" ]]; then
    echo "baseline $base"
    run_psql -q -c "insert into runtime.migration_ledger (filename, checksum) values ('$base', '$checksum') on conflict (filename) do update set checksum = excluded.checksum;"
    applied_count=$((applied_count + 1))
    continue
  fi

  echo "== applying $base =="
  psql_flags=()
  case "$base" in
    038_*) psql_flags=(--single-transaction) ;;
  esac
  run_psql -q "${psql_flags[@]}" < "$f"
  run_psql -q -c "insert into runtime.migration_ledger (filename, checksum) values ('$base', '$checksum') on conflict (filename) do update set checksum = excluded.checksum, applied_at = now();"
  applied_count=$((applied_count + 1))
done

echo "migrations complete: $applied_count applied, $skipped_count skipped (tracked in runtime.migration_ledger)"
