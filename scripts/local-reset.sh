#!/usr/bin/env bash
# One command to rebuild the LOCAL database, from the migration chain up.
#
# WHY THIS EXISTS. The plan's L row asks for a contributor path of "install,
# start, verify", and the only piece missing was this one: NEW_MACHINE_SETUP.md
# tells a new machine how to install the tools, how to fill in the `.env` files
# and which gates to run, and says nothing about the database all of that needs.
# The sequence existed only as four scripts a person had to know about, in an
# order nobody had written down.
#
# IT IS DESTRUCTIVE, AND IT SAYS SO BEFORE IT DOES ANYTHING. It drops the
# database named by `DATABASE_URL_APP` in `apps/umi-api/.env`. On this
# workstation that database is shared: two API servers (4001 and 4014) and a till
# can be pointed at it, which is exactly the setup the owner runs while working a
# second session. So the default is a DRY RUN that prints what it would destroy,
# `--yes` is what actually does it, and the script REFUSES while an API is
# listening on the ports this repo uses — rebuilding the schema under a running
# server leaves a session that half-works, and that is harder to explain than a
# refusal.
#
# Usage:
#   scripts/local-reset.sh                      # dry run against the .env database
#   scripts/local-reset.sh --yes                # do it
#   scripts/local-reset.sh --database scratch --yes
#   scripts/local-reset.sh --no-seed --yes      # schema only
#
# Options:
#   --database NAME   reset NAME instead of the database in DATABASE_URL_APP
#   --container NAME  the postgres container, if it cannot be found by port
#   --no-seed         skip the local access seed
#   --yes             actually drop and rebuild
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/apps/umi-api/.env"

confirm=false
seed=true
force=false
database=""
container=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) confirm=true ;;
    --force) force=true ;;
    --no-seed) seed=false ;;
    --database) database="${2:?--database needs a name}"; shift ;;
    --container) container="${2:?--container needs a name}"; shift ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      exit 2
      ;;
  esac
  shift
done

command -v docker >/dev/null || { echo "docker is required." >&2; exit 1; }

# The database, its host and its port come from the file the API itself reads, so
# this resets what the running system actually uses rather than a guess.
if [[ -z "$database" ]]; then
  [[ -f "$ENV_FILE" ]] || {
    echo "no $ENV_FILE; pass --database NAME to reset a database anyway." >&2
    exit 1
  }
  url="$(grep -E '^DATABASE_URL_APP=' "$ENV_FILE" | head -n 1 | cut -d= -f2-)"
  [[ -n "$url" ]] || { echo "DATABASE_URL_APP is not set in $ENV_FILE." >&2; exit 1; }
  read -r host port database <<<"$(node -e '
    const url = new URL(process.argv[1]);
    process.stdout.write([url.hostname, url.port || "5432", url.pathname.replace(/^\//, "")].join(" "));
  ' "$url")"
else
  host="127.0.0.1"
  port="$(grep -E '^DATABASE_URL_APP=' "$ENV_FILE" 2>/dev/null | head -n 1 |
    sed -E 's#.*@[^:]+:([0-9]+)/.*#\1#' || true)"
  port="${port:-4003}"
fi

if [[ -z "$container" ]]; then
  container="$(docker ps --format '{{.Names}} {{.Ports}}' |
    awk -v p=":${port}->" 'index($0, p) {print $1; exit}')"
fi
[[ -n "$container" ]] || {
  echo "no postgres container publishes port $port; pass --container NAME." >&2
  exit 1
}
docker inspect "$container" >/dev/null 2>&1 || {
  echo "the container does not exist: $container" >&2
  exit 1
}

# A live server on the database this is about to drop.
if [[ "$force" != true ]]; then
  # 4000 is the dashboard's dev server and holds no database connection of its
  # own, so it is not a reason to refuse; 4001 and 4014 are API servers and are.
  for api_port in 4001 4014; do
    if ss -ltn 2>/dev/null | grep -q ":${api_port} "; then
      echo "refusing: something is listening on ${api_port} (an API is running)." >&2
      echo "Stop it first — a schema rebuilt under a running server half-works." >&2
      echo "Pass --force if you mean it." >&2
      exit 1
    fi
  done
fi

psql_in() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

# The chain shells out to the host's `psql` (that is how it is written and how
# every local run of it works), and the host `psql` has to authenticate. The
# password is read from the container's own configuration — the same place the
# container got it — rather than copied into a file here.
pg_password="$(docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' |
  sed -n 's/^POSTGRES_PASSWORD=//p' | head -n 1)"
[[ -n "$pg_password" ]] || {
  echo "could not read POSTGRES_PASSWORD from $container; cannot run the chain." >&2
  exit 1
}

echo "container   $container"
echo "database    $database  ($host:$port)"
echo "chain       docs/migration/build-v3/00_run.sh $database"
echo "seed        $([[ "$seed" == true ]] && echo "scripts/umi-pos-local-access-seed.sh" || echo "skipped")"
echo "contract    pnpm --filter @umi/contract generate"

existing="$(psql_in -A -t -c "select count(*) from pg_database where datname='$database'" 2>/dev/null || echo 0)"
if [[ "${existing// /}" != "0" ]]; then
  echo
  echo "DESTRUCTIVE: this will DROP the database '$database'."
  psql_in -d "$database" -A -t \
    -c "select '  merchant rows: '||count(*) from merchant.merchant" 2>/dev/null || true
fi

if [[ "$confirm" != true ]]; then
  echo
  echo "Dry run. Nothing was changed. Re-run with --yes to do it."
  exit 0
fi

echo
echo "== dropping and creating $database =="
# `with (force)` disconnects whoever is still on it, which is the point: without
# it a pooled connection from a test run left behind makes the whole reset fail.
psql_in -c "drop database if exists \"$database\" with (force)"
psql_in -c "create database \"$database\""

echo "== applying the build-v3 chain =="
PGHOST="$host" PGPORT="$port" PGUSER=postgres PGPASSWORD="$pg_password" \
  bash "$ROOT/docs/migration/build-v3/00_run.sh" "$database"

if [[ "$seed" == true ]]; then
  # Demo data FIRST, access second: the access seed writes roles, PINs and a
  # subscription for the merchant, and the merchant comes from the demo seed.
  # `pnpm umi-pos:seed-pilot-roles` runs them the other way round and only works
  # on a database that already has the merchant — which is why the first run of
  # this script against an empty schema found a foreign key instead of a till.
  echo "== seeding demo data (merchant, location, catalogue) =="
  # The demo seed mints PIN hashes with the API's own JWT secret. It will hunt
  # for a running API process to copy it from; during a reset there is usually
  # none, so hand it the secret the API will actually start with.
  demo_jwt_secret="$(grep -E '^JWT_SECRET=' "$ENV_FILE" 2>/dev/null | head -n 1 | cut -d= -f2- || true)"
  UMI_POS_DEV_SEED_CONFIRM=disposable \
    UMI_POS_DEV_DB_CONTAINER="$container" \
    UMI_POS_DEV_DB_NAME="$database" \
    UMI_POS_DEV_JWT_SECRET="$demo_jwt_secret" \
    bash "$ROOT/scripts/umi-pos-demo-seed.sh"
  echo "== seeding local access (roles, PINs) =="
  UMI_POS_DEV_SEED_CONFIRM=disposable \
    UMI_POS_DEV_DB_CONTAINER="$container" \
    UMI_POS_DEV_DB_NAME="$database" \
    bash "$ROOT/scripts/umi-pos-local-access-seed.sh"
fi

echo "== regenerating the contract =="
(cd "$ROOT" && pnpm --filter @umi/contract generate)

echo
echo "== what the database says about itself =="
psql_in -d "$database" -A -t \
  -c "select version||' ('||status||')' from runtime.schema_migration order by applied_at desc limit 1"
echo "Start the API against it, then run: pnpm ux:verify"
