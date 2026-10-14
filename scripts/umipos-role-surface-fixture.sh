#!/usr/bin/env bash
# Build the database that `pnpm check:role-surfaces` needs, and say how to run it.
#
# WHY THIS EXISTS
# The role-surface gate talks to a running API and refuses to pass a row it could
# not test. On this workstation the API it must talk to serves a database that is
# missing three rows (the POS entitlement, the manager login, the owner
# membership), so two of the four roles cannot sign in and the pos-gated surfaces
# are refused for everybody. The gate then reports 45 mismatches that are all
# fixture, not product — and the same wall meets the next person.
#
# The rehearsal copy is the right place to take the roles from; it is not the right
# place to test them in. This script copies it into a disposable database, applies
# `scripts/umipos-role-surface-fixture.sql`, and prints the two commands that
# finish the job. Re-runnable: the fixture is idempotent, and the copy is rebuilt
# from the source each time.
#
# Usage:
#   scripts/umipos-role-surface-fixture.sh
#   scripts/umipos-role-surface-fixture.sh --yes          # rebuild over an existing copy
#   scripts/umipos-role-surface-fixture.sh --serve        # also start the API over the copy
#   scripts/umipos-role-surface-fixture.sh --source umi_rehearsal_20261006 --database umi_role_surfaces_gate
#
# The copy is DESTRUCTIVE only to a database whose name starts with
# `umi_role_surfaces`, and only with --yes. Anything else is refused by name.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/apps/umi-api/.env"
FIXTURE="$ROOT/scripts/umipos-role-surface-fixture.sql"

database="umi_role_surfaces_gate"
source_db="umi_rehearsal_20261006"
api_port="4015"
yes=false
serve=false
container=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --database) database="${2:?--database needs a name}"; shift ;;
    --source) source_db="${2:?--source needs a name}"; shift ;;
    --api-port) api_port="${2:?--api-port needs a port}"; shift ;;
    --container) container="${2:?--container needs a name}"; shift ;;
    --yes) yes=true ;;
    --serve) serve=true ;;
    -h|--help) sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

[[ "$database" == umi_role_surfaces* ]] ||
  { echo "refusing to touch '$database': the name must start with umi_role_surfaces." >&2; exit 1; }
[[ "$database" != "$source_db" ]] ||
  { echo "the copy and the source are the same database; nothing to do." >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "no $ENV_FILE to read the connection from." >&2; exit 1; }
[[ -f "$FIXTURE" ]] || { echo "no fixture at $FIXTURE." >&2; exit 1; }
command -v docker >/dev/null || { echo "docker is required." >&2; exit 1; }

app_url="$(grep -E '^DATABASE_URL_APP=' "$ENV_FILE" | head -n 1 | cut -d= -f2-)"
worker_url="$(grep -E '^DATABASE_URL_WORKER=' "$ENV_FILE" | head -n 1 | cut -d= -f2-)"
[[ -n "$app_url" ]] || { echo "DATABASE_URL_APP is not set in $ENV_FILE." >&2; exit 1; }

read -r port <<<"$(node -e '
  const url = new URL(process.argv[1]);
  process.stdout.write(url.port || "5432");
' "$app_url")"

if [[ -z "$container" ]]; then
  container="$(docker ps --format '{{.Names}} {{.Ports}}' |
    awk -v p=":${port}->" 'index($0, p) {print $1; exit}')"
fi
[[ -n "$container" ]] || { echo "no postgres container publishes port $port; pass --container NAME." >&2; exit 1; }

psql_super() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }
psql_db() { psql_super -d "$1" "${@:2}"; }

echo "container   $container"
echo "source      $source_db"
echo "copy        $database"

psql_super -d postgres -A -t -c \
  "select 1 from pg_database where datname = '$source_db'" | grep -q 1 ||
  { echo "the source database '$source_db' does not exist in $container." >&2; exit 1; }

if psql_super -d postgres -A -t -c "select 1 from pg_database where datname = '$database'" | grep -q 1; then
  if [[ "$yes" == true ]]; then
    echo "== dropping the previous copy =="
    psql_super -d postgres -c "drop database if exists \"$database\"" >/dev/null
  else
    echo "== keeping the existing copy (pass --yes to copy the source again) =="
  fi
fi

if ! psql_super -d postgres -A -t -c "select 1 from pg_database where datname = '$database'" | grep -q 1; then
  echo "== copying the rehearsal data =="
  psql_super -d postgres -c "create database \"$database\"" >/dev/null
  # The dump carries the table privileges the API's two roles need; without them
  # every request fails with "permission denied for schema merchant".
  docker exec "$container" pg_dump -U postgres "$source_db" |
    psql_db "$database" -q -f - >/dev/null
fi

echo "== applying the fixture =="
psql_db "$database" -q -f - <"$FIXTURE" >/dev/null

echo "== checking the fixture =="
psql_db "$database" -A -F'|' -c "
  select 'logins' as check, count(*)::text as value, '4 expected' as note
    from umi.\"user\"
   where lower(email) in ('barista@kalalacafe.mx','ux-sweep@kalalacafe.mx','admin@kalalacafe.mx','hola@umiconsulting.co')
     and password_hash is not null and status = 'active'
  union all
  select 'pos entitlement', count(*)::text, '1 expected'
    from umi.effective_entitlement
   where merchant_id = '1860305f-e864-d745-29e6-fb8830926cc6'::uuid and feature_key = 'pos' and enabled
  union all
  select 'kalalacafe staff', count(*)::text, '4 expected'
    from merchant.staff
   where merchant_id = '1860305f-e864-d745-29e6-fb8830926cc6'::uuid
  union all
  select 'manager + owner memberships', count(*)::text, '2 expected'
    from merchant.staff s
    join umi.role r on r.id = s.role_id
   where s.merchant_id = '1860305f-e864-d745-29e6-fb8830926cc6'::uuid and r.key in ('manager','owner');"

copy_app="${app_url%/*}/$database"
copy_worker="${worker_url%/*}/$database"

# The two connection strings carry a password. Show them masked and let --serve use
# the real ones, so the terminal and the shell history hold no credential.
mask() { sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#' <<<"$1"; }

if [[ "$serve" == true ]]; then
  if [[ "$app_url" == *"/$database" ]]; then
    echo "DATABASE_URL_APP already names the copy; start the API yourself." >&2
    exit 1
  fi
  echo "== starting an API over the copy on :$api_port =="
  (
    cd "$ROOT/apps/umi-api"
    PORT="$api_port" \
    DATABASE_URL_APP="$copy_app" \
    DATABASE_URL_WORKER="$copy_worker" \
    EXPECTED_SCHEMA_VERSION="${EXPECTED_SCHEMA_VERSION:-build-v3-79}" \
    setsid node dist/main.js >/tmp/umi-role-surface-gate-api.log 2>&1 </dev/null &
  )
  deadline=$((SECONDS + 60))
  while ((SECONDS < deadline)); do
    (exec 3<>"/dev/tcp/127.0.0.1/$api_port") 2>/dev/null && { exec 3>&- 2>/dev/null || true; break; }
    sleep 1
  done
  if ! (exec 3<>"/dev/tcp/127.0.0.1/$api_port") 2>/dev/null; then
    echo "the API did not listen on $api_port; see /tmp/umi-role-surface-gate-api.log." >&2
    exit 1
  fi
  exec 3>&- 2>/dev/null || true
  cat <<EOF

The API is up over the copy (log: /tmp/umi-role-surface-gate-api.log).
Run the gate:

  UMIPOS_API_BASE_URL=http://127.0.0.1:$api_port UMIPOS_ROLE_PASSWORD='Umi2026!' pnpm check:role-surfaces

Stop it when you are done:

  kill \$(lsof -ti :$api_port -sTCP:LISTEN)
EOF
  exit 0
fi

cat <<EOF

Now, in two shells:

  # 1 · an API over the copy. BOTH strings matter — the second one is where the
  #     login reads its row from. A run with only DATABASE_URL_APP overridden
  #     signs in as the wrong database's owner and refuses every role of the copy.
  cd apps/umi-api
  PORT=$api_port \\
  DATABASE_URL_APP='$(mask "$copy_app")' \\
  DATABASE_URL_WORKER='$(mask "$copy_worker")' \\
  EXPECTED_SCHEMA_VERSION=build-v3-79 \\
  node dist/main.js

  #     The passwords are masked here on purpose. Take the two real strings from
  #     $ENV_FILE, changing only the database name to '$database'.

  # 2 · the gate itself
  UMIPOS_API_BASE_URL=http://127.0.0.1:$api_port \\
  UMIPOS_ROLE_PASSWORD='Umi2026!' \\
  pnpm check:role-surfaces
EOF
