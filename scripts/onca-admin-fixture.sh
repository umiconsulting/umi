#!/usr/bin/env bash
# The ONCA administrator, with a local credential AND an operator PIN.
#
# The SQL next to this script carries the person and the employment. The PIN cannot
# live in a .sql file: its lookup is HMAC(JWT_SECRET, `umi-pos-pin:{merchant}:{pin}`)
# (`apps/umi-api/src/shared/auth/pos-pin.ts`), so the same PIN has a different
# lookup in every environment that has a different secret. This computes the three
# columns with the environment's own secret, the way `scripts/umi-pos-demo-seed.sh`
# does for the demo café.
#
# Run it against a DISPOSABLE database:
#
#   DATABASE_URL=postgresql://… JWT_SECRET=… scripts/onca-admin-fixture.sh
#
# `ONCA_ADMIN_PIN` defaults to 1111, the demo till's PIN, so a walk can sign in
# without inventing a number.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${JWT_SECRET:?JWT_SECRET is required — it is the secret the API hashes POS PINs with}"

PIN="${ONCA_ADMIN_PIN:-1111}"
ONCA_MERCHANT="${ONCA_MERCHANT_ID:-e6b14af1-b814-4efe-a6b0-67f5f02f4d53}"
STAFF_ID="40000000-0000-4000-8000-000000000110"
DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to create local PIN hashes." >&2
  exit 1
fi

material=$(PIN="$PIN" SECRET="$JWT_SECRET" MERCHANT="$ONCA_MERCHANT" node <<'NODE'
const crypto = require('crypto');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(process.env.PIN, salt, 64).toString('hex');
const lookup = crypto
  .createHmac('sha256', process.env.SECRET)
  .update(`umi-pos-pin:${process.env.MERCHANT}:${process.env.PIN}`)
  .digest('hex');
process.stdout.write(`${salt}|${hash}|${lookup}`);
NODE
)
IFS='|' read -r salt hash lookup <<<"$material"

psql -X -q -v ON_ERROR_STOP=1 -d "$DATABASE_URL" -f "$DIR/onca-admin-fixture.sql"

psql -X -q -v ON_ERROR_STOP=1 -d "$DATABASE_URL" \
  -v staff_id="$STAFF_ID" -v salt="$salt" -v hash="$hash" -v lookup="$lookup" <<'SQL'
update merchant.staff
   set operator_pin_salt = :'salt',
       operator_pin_hash = :'hash',
       operator_pin_lookup = :'lookup',
       updated_at = now()
 where id = :'staff_id'::uuid;
SQL

echo "ONCA administrator ready: admin@onca.mx (PIN ${PIN}, local credential per the .sql)" >&2
