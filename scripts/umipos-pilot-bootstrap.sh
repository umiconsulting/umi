#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${UMIPOS_PILOT_ENV_FILE:-$ROOT/deploy/pilot/pilot.env}"
PROFILE_FILE="${UMIPOS_BUSINESS_PROFILE:-$ROOT/config/umipos-pilot-business-profile.json}"
COMPOSE_FILE="$ROOT/deploy/pilot/compose.yml"
NODE_BIN="${PILOT_NODE_BIN:-node}"

[ -f "$ENV_FILE" ] || { echo "Falta el archivo del entorno pilot." >&2; exit 1; }
[ -f "$PROFILE_FILE" ] || { echo "Falta el perfil comercial." >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
: "${PILOT_BOOTSTRAP_OWNER_EMAIL:?PILOT_BOOTSTRAP_OWNER_EMAIL is required}"
: "${PILOT_BOOTSTRAP_OWNER_NAME:?PILOT_BOOTSTRAP_OWNER_NAME is required}"
: "${PILOT_BOOTSTRAP_OWNER_PASSWORD:?PILOT_BOOTSTRAP_OWNER_PASSWORD is required}"
: "${PILOT_BOOTSTRAP_OWNER_USER_ID:?PILOT_BOOTSTRAP_OWNER_USER_ID is required}"
: "${PILOT_BOOTSTRAP_OWNER_STAFF_ID:?PILOT_BOOTSTRAP_OWNER_STAFF_ID is required}"
: "${PILOT_BOOTSTRAP_COMMAND_ID:?PILOT_BOOTSTRAP_COMMAND_ID is required}"
: "${PILOT_BOOTSTRAP_IDEMPOTENCY_KEY:?PILOT_BOOTSTRAP_IDEMPOTENCY_KEY is required}"
[ "${UMI_ENVIRONMENT:-}" = pilot ] || { echo "El bootstrap requiere UMI_ENVIRONMENT=pilot." >&2; exit 1; }

"$NODE_BIN" - "$PROFILE_FILE" <<'NODE' |
const fs = require('node:fs');
const profile = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (profile.profileType !== 'pilot') throw new Error('El perfil debe usar profileType=pilot.');
const location = profile.locations?.[0];
process.stdout.write(JSON.stringify({
  commandId: process.env.PILOT_BOOTSTRAP_COMMAND_ID,
  idempotencyKey: process.env.PILOT_BOOTSTRAP_IDEMPOTENCY_KEY,
  merchant: {
    id: profile.merchant.id,
    name: profile.merchant.name,
    timezone: profile.merchant.timezone,
    currency: profile.merchant.currency,
    locale: profile.merchant.locale,
  },
  location: { id: location?.id, name: location?.name },
  owner: {
    id: process.env.PILOT_BOOTSTRAP_OWNER_USER_ID,
    staffId: process.env.PILOT_BOOTSTRAP_OWNER_STAFF_ID,
    email: process.env.PILOT_BOOTSTRAP_OWNER_EMAIL,
    fullName: process.env.PILOT_BOOTSTRAP_OWNER_NAME,
    password: process.env.PILOT_BOOTSTRAP_OWNER_PASSWORD,
  },
}));
NODE
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T umi-api node -e '
let body="";
process.stdin.setEncoding("utf8");
process.stdin.on("data",chunk=>body+=chunk);
process.stdin.on("error",error=>{process.stderr.write(error.message+"\n");process.exit(1);});
process.stdin.on("end",()=>void (async()=>{
  try {
    const response=await fetch("http://127.0.0.1:3000/api/platform/bootstrap/initial-merchant",{
      method:"POST",
      headers:{"content-type":"application/json","x-umi-bootstrap-token":process.env.PILOT_BOOTSTRAP_TOKEN},
      body,
    });
    const text=await response.text();
    if(!response.ok){process.stderr.write(text+"\n");process.exit(1);}
    process.stdout.write(text+"\n");
  } catch(error) {
    process.stderr.write(error.message+"\n");
    process.exit(1);
  }
})());
'
