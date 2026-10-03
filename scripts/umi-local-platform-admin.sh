#!/usr/bin/env bash
# Grant the build-v3 platform role to a local account.
#
# WHY THIS EXISTS
# A platform role is the only way to reach every cafe from the Dashboard.
# The role is a row in `umi.user_role`, and only `seed_rbac.sql` writes it.
# That seed runs inside the backfill script, and it fails in silence:
# an address that matches no user grants nothing and raises nothing.
# A local database then has no platform administrator, and the merchant
# picker shows one cafe. This script closes that gap.
#
# The script is idempotent. Run it as often as you like.
#
# Usage:
#   scripts/umi-local-platform-admin.sh
#   scripts/umi-local-platform-admin.sh --email someone@example.com --create --password secret
#   scripts/umi-local-platform-admin.sh --dry-run
#
# Options:
#   --email ADDRESS     the account to grant. Default: hola@umiconsulting.co
#   --password VALUE    set the password of the account. Local use only.
#   --create            create the account when it does not exist. Needs --password.
#   --database NAME     reset this database, not the one in DATABASE_URL_APP
#   --container NAME    the postgres container, if the script cannot find it
#   --dry-run           print the plan and change nothing
#   -h, --help          print this text
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/apps/umi-api/.env"
SEED="$ROOT/docs/migration/build-v3/backfill/seed_rbac.sql"

email="hola@umiconsulting.co"
password=""
create=false
dry_run=false
database=""
container=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email) email="${2:?--email needs an address}"; shift ;;
    --password) password="${2:?--password needs a value}"; shift ;;
    --create) create=true ;;
    --database) database="${2:?--database needs a name}"; shift ;;
    --container) container="${2:?--container needs a name}"; shift ;;
    --dry-run) dry_run=true ;;
    -h|--help) sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

[[ -n "$email" ]] || { echo "--email must not be empty." >&2; exit 2; }
[[ -f "$SEED" ]] || { echo "no seed file at $SEED." >&2; exit 1; }
command -v docker >/dev/null || { echo "docker is required." >&2; exit 1; }

# The database, its host, and its port come from the file the API reads.
# That way this script grants the role in the database the API uses.
if [[ -z "$database" ]]; then
  [[ -f "$ENV_FILE" ]] || { echo "no $ENV_FILE; pass --database NAME." >&2; exit 1; }
  url="$(grep -E '^DATABASE_URL_APP=' "$ENV_FILE" | head -n 1 | cut -d= -f2-)"
  [[ -n "$url" ]] || { echo "DATABASE_URL_APP is not set in $ENV_FILE." >&2; exit 1; }
  read -r host port database <<<"$(node -e '
    const url = new URL(process.argv[1]);
    process.stdout.write([url.hostname, url.port || "5432", url.pathname.replace(/^\//, "")].join(" "));
  ' "$url")"
else
  port="$(grep -E '^DATABASE_URL_APP=' "$ENV_FILE" 2>/dev/null | head -n 1 |
    sed -E 's#.*@[^:]+:([0-9]+)/.*#\1#' || true)"
  port="${port:-4003}"
fi

if [[ -z "$container" ]]; then
  container="$(docker ps --format '{{.Names}} {{.Ports}}' |
    awk -v p=":${port}->" 'index($0, p) {print $1; exit}')"
fi
[[ -n "$container" ]] || { echo "no postgres container publishes port $port; pass --container NAME." >&2; exit 1; }
docker inspect "$container" >/dev/null 2>&1 || { echo "the container does not exist: $container" >&2; exit 1; }

psql_in() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -d "$database" "$@"; }

echo "container   $container"
echo "database    $database"
echo "account     $email"
echo "grant       super_admin (platform)"

found="$(psql_in -A -t -c "select count(*) from umi.\"user\" where lower(email)=lower('$email')")"
found="${found// /}"

if [[ "$found" == "0" && "$create" != true ]]; then
  cat >&2 <<EOF
no umi.user carries the address '$email'.
Nothing was changed. This is the silent failure the backfill script warns about.
Pass --create --password VALUE to make the account, or pass --email for an account that exists.
EOF
  exit 1
fi

if [[ "$dry_run" == true ]]; then
  echo
  echo "Dry run. Nothing was changed."
  exit 0
fi

if [[ "$found" == "0" ]]; then
  [[ -n "$password" ]] || { echo "--create needs --password." >&2; exit 2; }
  echo "== creating the account =="
  # The unique index is on lower(email), not on email, so the conflict target is
  # the expression. `on conflict (email)` fails with "no unique constraint".
  psql_in -q -c "insert into umi.\"user\"(email, full_name, status) values (lower('$email'), 'Platform Admin', 'active') on conflict (lower(email)) do nothing"
fi

# A local account needs a Dashboard password. A platform grant alone is not enough.
if [[ -n "$password" ]]; then
  echo "== setting the password =="
  IFS='|' read -r salt hash <<<"$(SEED_PASSWORD="$password" node <<'NODE'
const crypto = require('crypto');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(process.env.SEED_PASSWORD, salt, 64).toString('hex');
process.stdout.write(`${salt}|${hash}`);
NODE
)"
  psql_in -q -c "update umi.\"user\"
                    set password_salt='$salt',
                        password_hash='$hash',
                        password_algorithm='scrypt-sha256-v1',
                        status='active',
                        updated_at=now()
                  where lower(email)=lower('$email')"
fi

echo "== granting super_admin (seed_rbac.sql) =="
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -d "$database" \
  -v bootstrap_email="$email" <"$SEED" >/dev/null

echo
echo "== result =="
psql_in -P pager=off -c "select u.email, r.key as role, u.status,
       case when u.password_hash is null then 'no' else 'yes' end as can_sign_in,
       coalesce(ur.expires_at::text, 'never') as expires
  from umi.\"user\" u
  join umi.user_role ur on ur.user_id = u.id
  join umi.role r on r.id = ur.role_id
 where r.is_platform and ur.revoked_at is null and lower(u.email)=lower('$email')"

grants="$(psql_in -A -t -c "select count(*) from umi.user_role ur
  join umi.role r on r.id = ur.role_id
  join umi.\"user\" u on u.id = ur.user_id
 where r.is_platform and ur.revoked_at is null and lower(u.email)=lower('$email')")"
grants="${grants// /}"

if [[ "$grants" == "0" ]]; then
  echo "the grant did not land." >&2
  exit 1
fi

echo
echo "Done. Start the API, open the Dashboard, and sign in as $email."
