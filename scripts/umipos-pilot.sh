#!/usr/bin/env bash
set -euo pipefail
trap 'echo "pilot command failed: ${FUNCNAME[0]:-main} line $LINENO" >&2' ERR

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT/deploy/pilot/compose.yml"
ENV_FILE="${UMIPOS_PILOT_ENV_FILE:-$ROOT/deploy/pilot/pilot.env}"

[ -f "$ENV_FILE" ] || { echo "Pilot environment file is missing: $ENV_FILE" >&2; exit 1; }
ENV_FILE="$(realpath "$ENV_FILE")"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
export PILOT_ENV_FILE="$ENV_FILE"
NODE_BIN="${PILOT_NODE_BIN:-node}"
export PATH="$(dirname "$NODE_BIN"):$PATH"
SMOKE_HARDWARE_ID=68000000-0000-4000-8000-000000000101

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

image_matches_release() {
  local image="$1"
  [ "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.version"}}' 2>/dev/null || true)" = "$RELEASE_VERSION" ] &&
    [ "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)" = "$RELEASE_GIT_COMMIT" ] &&
    [ "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.created"}}' 2>/dev/null || true)" = "$RELEASE_BUILD_TIMESTAMP" ]
}

build_image() {
  local image="$1"
  shift
  if image_matches_release "$image"; then
    echo "release image available: $image"
    return
  fi
  docker build --provenance=false -t "$image" "$@" &
  local build_pid=$!
  for _ in $(seq 1 600); do
    if image_matches_release "$image"; then
      if kill -0 "$build_pid" 2>/dev/null; then kill -INT "$build_pid" 2>/dev/null || true; fi
      wait "$build_pid" 2>/dev/null || true
      echo "release image built: $image"
      return
    fi
    if ! kill -0 "$build_pid" 2>/dev/null; then
      wait "$build_pid"
      image_matches_release "$image" || { echo "Built image has an invalid release identity: $image" >&2; exit 1; }
      return
    fi
    sleep 1
  done
  kill -INT "$build_pid" 2>/dev/null || true
  wait "$build_pid" 2>/dev/null || true
  echo "Image build exceeded 600 seconds: $image" >&2
  exit 1
}

pos_artifact_matches_release() {
  local release_dir="$ROOT/artifacts/releases/$RELEASE_VERSION"
  local manifest="$release_dir/release-manifest.json"
  local artifact="$release_dir/umipos-linux-$RELEASE_VERSION.tar.gz"
  [ -s "$artifact" ] && [ -s "$manifest" ] &&
    "$NODE_BIN" -e '
      const fs = require("node:fs");
      const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const expected = process.argv.slice(2);
      process.exit(
        manifest.releaseVersion === expected[0] &&
        manifest.gitCommit === expected[1] &&
        manifest.buildTimestamp === expected[2] ? 0 : 1,
      );
    ' "$manifest" "$RELEASE_VERSION" "$RELEASE_GIT_COMMIT" "$RELEASE_BUILD_TIMESTAMP"
}

require_value() {
  local name="$1" value="${!1:-}"
  if [ -z "$value" ] || [[ "$value" == *CHANGE_ME* ]]; then
    echo "$name must contain a non-template value." >&2
    exit 1
  fi
}

precheck() {
  local required=(
    COMPOSE_PROJECT_NAME UMI_ENVIRONMENT NODE_ENV PILOT_DOMAIN PUBLIC_API_URL
    PUBLIC_DASHBOARD_URL CORS_ORIGINS TRUSTED_PROXY_CIDRS RELEASE_VERSION
    RELEASE_GIT_COMMIT RELEASE_BUILD_TIMESTAMP CONTRACT_VERSION EXPECTED_SCHEMA_VERSION
    CONFIG_SCHEMA_VERSION POSTGRES_DB POSTGRES_PASSWORD UMIPOS_DB_APP_PASSWORD
    UMIPOS_DB_WORKER_PASSWORD DATABASE_URL_APP DATABASE_URL_WORKER REDIS_PASSWORD REDIS_URL
    JWT_SECRET APP_QR_SECRET JWT_ACCESS_SECRET JWT_REFRESH_SECRET MFA_OTP_PEPPER
    CUSTOMER_VALUE_SECRET OPERATIONS_TOKEN OTEL_EXPORTER_OTLP_ENDPOINT
    PILOT_BOOTSTRAP_TOKEN PILOT_BOOTSTRAP_EXPIRES_AT
  )
  for name in "${required[@]}"; do require_value "$name"; done
  [ "$UMI_ENVIRONMENT" = pilot ] || { echo "UMI_ENVIRONMENT must be pilot." >&2; exit 1; }
  [ "$NODE_ENV" = production ] || { echo "NODE_ENV must be production." >&2; exit 1; }
  [[ "$PUBLIC_API_URL" == https://* ]] || { echo "PUBLIC_API_URL must use HTTPS." >&2; exit 1; }
  [[ "$PUBLIC_DASHBOARD_URL" == https://* ]] || { echo "PUBLIC_DASHBOARD_URL must use HTTPS." >&2; exit 1; }
  [[ "$RELEASE_GIT_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "RELEASE_GIT_COMMIT is invalid." >&2; exit 1; }
  [ "$RELEASE_GIT_COMMIT" = "$(git -C "$ROOT" rev-parse HEAD)" ] || {
    echo "RELEASE_GIT_COMMIT does not match HEAD." >&2
    exit 1
  }
  for name in POSTGRES_PASSWORD UMIPOS_DB_APP_PASSWORD UMIPOS_DB_WORKER_PASSWORD REDIS_PASSWORD; do
    [[ "${!name}" =~ ^[A-Za-z0-9._~-]{24,}$ ]] || {
      echo "$name must use at least 24 URL-safe characters." >&2
      exit 1
    }
  done
  local mode free_kb minimum_free_kb
  mode="$(stat -c '%a' "$ENV_FILE")"
  [ "$mode" = 600 ] || [ "$mode" = 640 ] || {
    echo "Pilot environment file mode must be 0600 or 0640." >&2
    exit 1
  }
  docker version >/dev/null
  docker compose version >/dev/null
  [ "$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0]) >= 22')" = true ] || {
    echo "PILOT_NODE_BIN must use Node.js 22 or newer." >&2
    exit 1
  }
  compose config --quiet
  mkdir -p "$ROOT/artifacts/releases" "$ROOT/backups/$UMI_ENVIRONMENT"
  [ -w "$ROOT/artifacts/releases" ] && [ -w "$ROOT/backups/$UMI_ENVIRONMENT" ] || {
    echo "Artifact or backup storage is not writable." >&2
    exit 1
  }
  if [ -f "$ROOT/artifacts/releases/$RELEASE_VERSION/release-manifest.json" ]; then
    "$NODE_BIN" "$ROOT/scripts/verify-release-manifest.mjs" \
      "$ROOT/artifacts/releases/$RELEASE_VERSION/release-manifest.json"
  fi
  if [ -n "$(compose ps -q postgres 2>/dev/null)" ]; then
    compose exec -T postgres pg_isready -U postgres -d "$POSTGRES_DB" >/dev/null
  fi
  if [ -n "$(compose ps -q redis 2>/dev/null)" ]; then
    compose exec -T redis sh -ec 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping' | grep -q PONG
  fi
  free_kb="$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')"
  minimum_free_kb="${MIN_FREE_DISK_KB:-5242880}"
  [[ "$minimum_free_kb" =~ ^[0-9]+$ ]] || { echo "MIN_FREE_DISK_KB is invalid." >&2; exit 1; }
  [ "$free_kb" -ge "$minimum_free_kb" ] || {
    echo "Free disk is below the required ${minimum_free_kb} KiB." >&2
    exit 1
  }
  echo "pilot precheck passed"
}

build_release() {
  precheck
  git -C "$ROOT" diff --quiet && git -C "$ROOT" diff --cached --quiet || {
    echo "Release builds require a clean tracked worktree." >&2
    exit 1
  }
  local release_dir="$ROOT/artifacts/releases/$RELEASE_VERSION"
  local pos_artifact="$release_dir/umipos-linux-$RELEASE_VERSION.tar.gz"
  mkdir -p "$release_dir"
  build_image "umipos-api:$RELEASE_VERSION" \
    --build-arg "RELEASE_VERSION=$RELEASE_VERSION" \
    --build-arg "RELEASE_GIT_COMMIT=$RELEASE_GIT_COMMIT" \
    --build-arg "RELEASE_BUILD_TIMESTAMP=$RELEASE_BUILD_TIMESTAMP" \
    -f "$ROOT/apps/umi-api/Dockerfile" "$ROOT"
  build_image "umipos-dashboard:$RELEASE_VERSION" \
    --build-arg "UMI_ENVIRONMENT=$UMI_ENVIRONMENT" \
    --build-arg "PUBLIC_URL=$PUBLIC_DASHBOARD_URL" \
    --build-arg API_BASE= \
    --build-arg "RELEASE_VERSION=$RELEASE_VERSION" \
    --build-arg "RELEASE_GIT_COMMIT=$RELEASE_GIT_COMMIT" \
    --build-arg "RELEASE_BUILD_TIMESTAMP=$RELEASE_BUILD_TIMESTAMP" \
    --build-arg "CONTRACT_VERSION=$CONTRACT_VERSION" \
    --build-arg "CONFIG_SCHEMA_VERSION=$CONFIG_SCHEMA_VERSION" \
    -f "$ROOT/apps/umi-dashboard/Dockerfile" "$ROOT"
  if pos_artifact_matches_release; then
    echo "release artifact available: $pos_artifact"
  else
    (
      cd "$ROOT/apps/umi-pos"
      flutter build linux --release \
        --dart-define="UMIPOS_ENVIRONMENT=$UMI_ENVIRONMENT" \
        --dart-define="UMIPOS_API_BASE_URL=$PUBLIC_API_URL" \
        --dart-define=UMIPOS_TELEMETRY_ENABLED=true \
        --dart-define=UMIPOS_DEVELOPMENT_DIAGNOSTICS=false \
        --dart-define=UMIPOS_FEATURE_BOOTSTRAP=disabled \
        --dart-define=UMIPOS_HARDWARE_SIMULATOR_ENABLED=false \
        --dart-define="UMIPOS_RELEASE_VERSION=$RELEASE_VERSION" \
        --dart-define="UMIPOS_RELEASE_GIT_COMMIT=$RELEASE_GIT_COMMIT" \
        --dart-define="UMIPOS_RELEASE_BUILD_TIMESTAMP=$RELEASE_BUILD_TIMESTAMP" \
        --dart-define="UMIPOS_CONTRACT_VERSION=$CONTRACT_VERSION" \
        --dart-define="UMIPOS_CONFIG_SCHEMA_VERSION=$CONFIG_SCHEMA_VERSION"
    )
    tar -C "$ROOT/apps/umi-pos/build/linux/x64/release/bundle" -czf "$pos_artifact" .
  fi
  "$NODE_BIN" "$ROOT/scripts/generate-release-manifest.mjs" "$release_dir" "$pos_artifact"
  "$NODE_BIN" "$ROOT/scripts/verify-release-manifest.mjs" "$release_dir/release-manifest.json"
}

backup_database() {
  precheck
  compose up -d postgres
  local timestamp directory dump
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  directory="$ROOT/backups/$UMI_ENVIRONMENT/$timestamp"
  dump="$directory/${POSTGRES_DB}.dump"
  mkdir -p "$directory"
  chmod 700 "$directory"
  umask 077
  compose exec -T postgres pg_dump -U postgres -d "$POSTGRES_DB" -Fc >"$dump"
  sha256sum "$dump" >"$dump.sha256"
  printf '{"schemaVersion":1,"environment":"%s","database":"%s","createdAt":"%s","release":"%s"}\n' \
    "$UMI_ENVIRONMENT" "$POSTGRES_DB" "$timestamp" "$RELEASE_VERSION" >"$directory/metadata.json"
  echo "$dump"
}

apply_migrations() {
  compose up -d postgres
  compose run --rm migrate
}

curl_options() {
  if [ "${PILOT_CURL_INSECURE:-false}" = true ]; then printf '%s\n' -k; fi
  printf '%s\n' --fail-with-body --silent --show-error
}

wait_ready() {
  local -a curl_args
  mapfile -t curl_args < <(curl_options)
  for _ in $(seq 1 45); do
    if curl "${curl_args[@]}" "$PUBLIC_API_URL/health/ready" >/dev/null 2>&1 &&
      curl "${curl_args[@]}" "$PUBLIC_DASHBOARD_URL/health" >/dev/null 2>&1 &&
      compose exec -T umi-worker test -s /tmp/umi-worker-ready; then
      echo "pilot services ready"
      return
    fi
    sleep 2
  done
  compose ps
  compose logs --tail=80 umi-api umi-worker umi-dashboard caddy >&2
  echo "Pilot services did not become ready." >&2
  exit 1
}

assert_non_server_error() {
  local method="$1" url="$2" body="${3:-}"
  local -a args=(-k -sS -o /dev/null -w '%{http_code}' -X "$method")
  if [ -n "$body" ]; then args+=(-H 'content-type: application/json' -d "$body"); fi
  local status
  status="$(curl "${args[@]}" "$url")"
  [[ "$status" != 5* ]] || { echo "Smoke request returned $status: $url" >&2; exit 1; }
}

smoke() {
  require_value SMOKE_DASHBOARD_USERNAME
  require_value SMOKE_DASHBOARD_PASSWORD
  require_value SMOKE_MERCHANT_ID
  require_value SMOKE_LOCATION_ID
  require_value SMOKE_DEVICE_ID
  require_value SMOKE_INSTALLATION_ID
  require_value SMOKE_DEVICE_CREDENTIAL
  require_value SMOKE_POS_PIN
  local smoke_dir cookie login_body pos_body pos_token operator_session_id kds_status
  local -a curl_args
  smoke_dir="$(mktemp -d)"
  trap 'find "$smoke_dir" -depth -delete' RETURN
  cookie="$smoke_dir/cookie"
  login_body="$("$NODE_BIN" -e 'process.stdout.write(JSON.stringify({username:process.argv[1],password:process.argv[2]}))' \
    "$SMOKE_DASHBOARD_USERNAME" "$SMOKE_DASHBOARD_PASSWORD")"
  mapfile -t curl_args < <(curl_options)
  curl "${curl_args[@]}" "$PUBLIC_API_URL/health/live" | grep -q "$RELEASE_VERSION"
  curl "${curl_args[@]}" "$PUBLIC_API_URL/health/ready" | grep -q '"state":"Healthy"'
  curl "${curl_args[@]}" "$PUBLIC_DASHBOARD_URL/" | grep -q '<div id="root">'
  curl "${curl_args[@]}" "$PUBLIC_DASHBOARD_URL/release.json" | grep -q "$RELEASE_VERSION"
  curl "${curl_args[@]}" -c "$cookie" -H 'content-type: application/json' \
    -d "$login_body" "$PUBLIC_API_URL/api/auth/local/login" | grep -q '"session"'
  curl "${curl_args[@]}" -b "$cookie" "$PUBLIC_API_URL/api/auth/me" | grep -q '"session"'
  curl "${curl_args[@]}" -b "$cookie" "$PUBLIC_API_URL/api/me/merchants" | grep -q "$SMOKE_MERCHANT_ID"
  pos_body="$("$NODE_BIN" -e '
    process.stdout.write(JSON.stringify({
      pin: process.argv[1], merchantId: process.argv[2],
      locationId: process.argv[3], installationId: process.argv[4],
    }));
  ' "$SMOKE_POS_PIN" "$SMOKE_MERCHANT_ID" "$SMOKE_LOCATION_ID" "$SMOKE_INSTALLATION_ID")"
  curl "${curl_args[@]}" \
    -H 'content-type: application/json' \
    -H "x-umi-device-id: $SMOKE_DEVICE_ID" \
    -H "x-umi-device-credential: $SMOKE_DEVICE_CREDENTIAL" \
    -d "$pos_body" "$PUBLIC_API_URL/api/v1/auth/pos/pin-login" >"$smoke_dir/pos-session.json"
  pos_token="$("$NODE_BIN" -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (typeof value.tokens?.accessToken !== "string" || value.session?.deviceId !== process.argv[2]) process.exit(1);
    process.stdout.write(value.tokens.accessToken);
  ' "$smoke_dir/pos-session.json" "$SMOKE_DEVICE_ID")"
  local -a pos_headers=(
    -H "authorization: Bearer $pos_token"
    -H "x-umi-device-id: $SMOKE_DEVICE_ID"
    -H "x-umi-device-credential: $SMOKE_DEVICE_CREDENTIAL"
  )
  curl "${curl_args[@]}" "${pos_headers[@]}" "$PUBLIC_API_URL/api/v1/pos/entry-context" \
    | grep -q "$SMOKE_MERCHANT_ID"
  curl "${curl_args[@]}" "${pos_headers[@]}" -H 'content-type: application/json' \
    -d "{\"merchantId\":\"$SMOKE_MERCHANT_ID\",\"locationId\":\"$SMOKE_LOCATION_ID\"}" \
    "$PUBLIC_API_URL/api/v1/pos/operator-sessions" >"$smoke_dir/operator-session.json"
  operator_session_id="$("$NODE_BIN" -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (typeof value.id !== "string" || value.state !== "active") process.exit(1);
    process.stdout.write(value.id);
  ' "$smoke_dir/operator-session.json")"
  curl "${curl_args[@]}" "${pos_headers[@]}" \
    "$PUBLIC_API_URL/api/v1/pos/merchants/$SMOKE_MERCHANT_ID/catalog/products?locationId=$SMOKE_LOCATION_ID" \
    | grep -q '"items"'
  curl "${curl_args[@]}" "${pos_headers[@]}" \
    "$PUBLIC_API_URL/api/v1/pos/merchants/$SMOKE_MERCHANT_ID/hardware/recovery?locationId=$SMOKE_LOCATION_ID&operatorSessionId=$operator_session_id" \
    | grep -q '"recoveryStates"'
  local hardware_version command_id idempotency_key claimed_id csrf_token
  hardware_version="$(compose exec -T postgres psql -X -At -U postgres -d "$POSTGRES_DB" \
    -c "select configuration_version from merchant.hardware_device where id='$SMOKE_HARDWARE_ID'")"
  command_id="$(cat /proc/sys/kernel/random/uuid)"
  idempotency_key="$(cat /proc/sys/kernel/random/uuid)"
  csrf_token="$(awk '$6=="umi_csrf" {print $7}' "$cookie" | tail -n 1)"
  [ -n "$csrf_token" ]
  curl "${curl_args[@]}" -b "$cookie" -H 'content-type: application/json' \
    -H "x-umi-csrf: $csrf_token" \
    -d "{\"operation\":\"hardware.printer.test\",\"locationId\":\"$SMOKE_LOCATION_ID\",\"targetAggregateId\":\"$SMOKE_HARDWARE_ID\",\"targetVersion\":$hardware_version,\"commandId\":\"$command_id\",\"idempotencyKey\":\"$idempotency_key\",\"parameters\":{\"hardwareId\":\"$SMOKE_HARDWARE_ID\",\"expectedConfigurationVersion\":$hardware_version,\"sourceAggregateType\":\"pilot_smoke\",\"sourceAggregateId\":\"PILOT-SMOKE\"},\"approvalId\":null}" \
    "$PUBLIC_API_URL/api/merchants/$SMOKE_MERCHANT_ID/administrative-commands" \
    | grep -q "$command_id"
  curl "${curl_args[@]}" "${pos_headers[@]}" \
    "$PUBLIC_API_URL/api/v1/pos/merchants/$SMOKE_MERCHANT_ID/hardware/commands/remote/claim?locationId=$SMOKE_LOCATION_ID&operatorSessionId=$operator_session_id" \
    >"$smoke_dir/hardware-claim.json"
  claimed_id="$("$NODE_BIN" -e '
    const value=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));
    const command=value.command?.command ?? value.command;
    if (!command?.commandId) process.exit(1);
    process.stdout.write(command.commandId);
  ' "$smoke_dir/hardware-claim.json")"
  curl "${curl_args[@]}" "${pos_headers[@]}" -H 'content-type: application/json' \
    -d "{\"locationId\":\"$SMOKE_LOCATION_ID\",\"operatorSessionId\":\"$operator_session_id\",\"status\":\"succeeded\",\"failureCode\":null,\"safeResultMetadata\":{\"statusMessage\":\"pilot_smoke_simulator\",\"acknowledged\":true}}" \
    "$PUBLIC_API_URL/api/v1/pos/merchants/$SMOKE_MERCHANT_ID/hardware/commands/$claimed_id/transition" \
    | grep -q '"succeeded"'
  compose exec -T redis sh -ec 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping' | grep -q PONG
  compose exec -T postgres psql -X -At -U postgres -d "$POSTGRES_DB" \
    -c "select count(*) from merchant.merchant where id='$SMOKE_MERCHANT_ID'" | grep -qx 1
  compose exec -T postgres psql -X -At -U postgres -d "$POSTGRES_DB" \
    -c "select count(*) > 100 from pg_class where relkind='r' and relrowsecurity and relforcerowsecurity" | grep -qx t
  compose exec -T postgres psql -X -At -U postgres -d "$POSTGRES_DB" \
    -c "select count(*) > 0 from merchant.hardware_command where merchant_id='$SMOKE_MERCHANT_ID'" | grep -qx t
  compose exec -T postgres psql -X -At -U postgres -d "$POSTGRES_DB" \
    -c "select count(*) > 0 from merchant.business_command where merchant_id='$SMOKE_MERCHANT_ID'" | grep -qx t
  compose exec -T postgres psql -X -At -U postgres -d "$POSTGRES_DB" \
    -c "select count(*) > 0 from runtime.security_audit_event" | grep -qx t
  curl "${curl_args[@]}" -H 'content-type: application/json' \
    -H 'x-kds-device-token: gate6a-pilot-kds-token' -d '{"action":"snapshot"}' \
    "$PUBLIC_API_URL/api/kds/board" | grep -q '"ok":true'
  kds_status="$(compose exec -T postgres psql -X -At -U postgres -d "$POSTGRES_DB" \
    -c "select count(*) > 0 from merchant.station where merchant_id='$SMOKE_MERCHANT_ID'")"
  [ "$kds_status" = t ]
  find "$smoke_dir" -depth -delete
  trap - RETURN
  echo "pilot smoke passed"
}

seed_certification() {
  local postgres_container
  postgres_container="$(compose ps -q postgres)"
  UMI_POS_DEV_DB_CONTAINER="$postgres_container" \
    UMI_POS_DEV_DB_NAME="$POSTGRES_DB" \
    UMI_POS_DEV_SEED_CONFIRM=disposable \
    UMI_POS_DEV_JWT_SECRET="$JWT_SECRET" \
    bash "$ROOT/scripts/umi-pos-demo-seed.sh"
  UMI_POS_DEV_DB_CONTAINER="$postgres_container" \
    UMI_POS_DEV_DB_NAME="$POSTGRES_DB" \
    UMI_POS_DEV_SEED_CONFIRM=disposable \
    bash "$ROOT/scripts/umi-pos-local-access-seed.sh"
  compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d "$POSTGRES_DB" \
    <"$ROOT/scripts/umi-pos-gate5a-live-fixture.sql"
  echo "disposable pilot fixture seeded"
}

certify_clean() {
  precheck
  [ "${PILOT_CERTIFICATION_CONFIRM:-}" = disposable ] || {
    echo "Set PILOT_CERTIFICATION_CONFIRM=disposable." >&2
    exit 1
  }
  local started
  started="$(date +%s)"
  compose down --volumes --remove-orphans
  compose up -d postgres redis otel-collector
  apply_migrations
  seed_certification
  compose up -d umi-api umi-worker umi-dashboard caddy
  wait_ready
  smoke
  echo "clean deployment certified: STARTUP_SECONDS=$(( $(date +%s) - started ))"
}

certify_business() {
  precheck
  [ "${PILOT_CERTIFICATION_CONFIRM:-}" = disposable ] || {
    echo "Set PILOT_CERTIFICATION_CONFIRM=disposable." >&2
    exit 1
  }
  local started evidence_dir bootstrap_retry
  started="$(date +%s)"
  evidence_dir="$ROOT/artifacts/certification"
  mkdir -p "$evidence_dir"
  compose down --volumes --remove-orphans
  compose up -d postgres redis otel-collector
  apply_migrations
  compose exec -T postgres psql -X -At -U postgres -d "$POSTGRES_DB" \
    -c 'select count(*) from merchant.merchant' | grep -qx 0
  compose up -d umi-api umi-worker umi-dashboard caddy
  wait_ready
  UMIPOS_BUSINESS_PROFILE="$ROOT/config/umipos-pilot-business-profile.certification.json" \
    bash "$ROOT/scripts/umipos-pilot-bootstrap.sh" | tee "$evidence_dir/bootstrap.json"
  bootstrap_retry="$(UMIPOS_BUSINESS_PROFILE="$ROOT/config/umipos-pilot-business-profile.certification.json" \
    bash "$ROOT/scripts/umipos-pilot-bootstrap.sh")"
  "$NODE_BIN" -e 'const v=JSON.parse(process.argv[1]);if(v.replayed!==true)process.exit(1)' "$bootstrap_retry"
  printf '%s\n' "$bootstrap_retry" >"$evidence_dir/bootstrap-retry.json"
  (
    cd "$ROOT"
    GATE6B_CERT_PHASE=bootstrap python3 scripts/umipos-gate6b-final-certification.py
  )
  seed_certification
  smoke
  GATE5A_DASHBOARD_URL="$PUBLIC_DASHBOARD_URL" \
    GATE5A_API_URL="$PUBLIC_API_URL" \
    GATE5A_PG_CONTAINER="$(compose ps -q postgres)" \
    GATE5A_PG_DATABASE="$POSTGRES_DB" \
    GATE5A_APP_DATABASE_ROLE=umi_api_login \
    GATE5A_DISPOSABLE_PILOT_CONFIRM=disposable \
    GATE5A_CERT_PHASE=walkthrough \
    python3 "$ROOT/scripts/umi-pos-gate5a-live-certification.py" \
    | tee "$evidence_dir/business-walkthrough.log"
  (
    cd "$ROOT"
    GATE6B_CERT_PHASE=roles python3 scripts/umipos-gate6b-final-certification.py \
      | tee "$evidence_dir/role-walkthrough.log"
    GATE6B_CERT_PHASE=evidence python3 scripts/umipos-gate6b-final-certification.py \
      | tee "$evidence_dir/persistence.log"
  )
  UMIPOS_BUSINESS_PROFILE="$ROOT/config/umipos-pilot-business-profile.certification.json" \
    "$NODE_BIN" "$ROOT/scripts/umipos-pilot-readiness.mjs" --json \
    | tee "$evidence_dir/readiness.json"
  echo "Gate 6B business certification passed: RUNTIME_SECONDS=$(( $(date +%s) - started ))"
}

deploy_release() {
  precheck
  local manifest="$ROOT/artifacts/releases/$RELEASE_VERSION/release-manifest.json"
  "$NODE_BIN" "$ROOT/scripts/verify-release-manifest.mjs" "$manifest"
  compose up -d postgres redis otel-collector
  if compose exec -T postgres psql -X -At -U postgres -d "$POSTGRES_DB" \
    -c "select to_regclass('runtime.schema_migration')" | grep -q schema_migration; then
    backup_database >/dev/null
  fi
  apply_migrations
  compose up -d umi-api umi-worker umi-dashboard caddy
  wait_ready
  smoke
  mkdir -p "$ROOT/artifacts/releases/active"
  cp "$manifest" "$ROOT/artifacts/releases/active/release-manifest.json"
  echo "pilot release active: $RELEASE_VERSION"
}

restore_database() {
  local dump="${1:?Backup dump path is required.}"
  local target="${2:-umipos_restore_$(date -u +%Y%m%d%H%M%S)}"
  [[ "$target" =~ ^umipos_restore_[A-Za-z0-9_]+$ ]] || {
    echo "Restore database name must start with umipos_restore_." >&2
    exit 1
  }
  [ -f "$dump" ] && [ -f "$dump.sha256" ] || { echo "Backup or checksum is missing." >&2; exit 1; }
  (cd "$(dirname "$dump")" && sha256sum -c "$(basename "$dump").sha256")
  compose up -d postgres redis
  local started api_container worker_container
  started="$(date +%s)"
  compose exec -T postgres dropdb -U postgres --if-exists "$target"
  compose exec -T postgres createdb -U postgres "$target"
  compose exec -T postgres pg_restore -U postgres -d "$target" --exit-on-error <"$dump"
  compose exec -T postgres psql -X -At -U postgres -d "$target" \
    -c "select version from runtime.schema_migration order by applied_at desc limit 1" | grep -qx "$EXPECTED_SCHEMA_VERSION"
  compose exec -T postgres psql -X -At -U postgres -d "$target" \
    -c "select count(*) > 100 from pg_class where relkind='r' and relrowsecurity and relforcerowsecurity" | grep -qx t
  compose exec -T postgres psql -X -At -U postgres -d "$target" \
    -c "select count(*)=1 from merchant.merchant where id='$SMOKE_MERCHANT_ID'" | grep -qx t
  compose exec -T postgres psql -X -At -U postgres -d "$target" \
    -c "select count(*)>0 from merchant.hardware_command where merchant_id='$SMOKE_MERCHANT_ID'" | grep -qx t
  compose exec -T postgres psql -X -At -U postgres -d "$target" \
    -c "select count(*)>0 from merchant.business_command where merchant_id='$SMOKE_MERCHANT_ID'" | grep -qx t
  api_container="${COMPOSE_PROJECT_NAME}-restore-api"
  worker_container="${COMPOSE_PROJECT_NAME}-restore-worker"
  docker rm -f "$api_container" "$worker_container" >/dev/null 2>&1 || true
  docker run -d --name "$api_container" \
    --network "${COMPOSE_PROJECT_NAME}_pilot-internal" \
    --env-file "$ENV_FILE" \
    -e "DATABASE_URL_APP=postgresql://umi_api_login:$UMIPOS_DB_APP_PASSWORD@postgres:5432/$target" \
    -e "DATABASE_URL_WORKER=postgresql://umi_worker_login:$UMIPOS_DB_WORKER_PASSWORD@postgres:5432/$target" \
    -e OTEL_SERVICE_NAME=umi-api-restore \
    "umipos-api:$RELEASE_VERSION" >/dev/null
  docker run -d --name "$worker_container" \
    --network "${COMPOSE_PROJECT_NAME}_pilot-internal" \
    --env-file "$ENV_FILE" \
    -e "DATABASE_URL_APP=postgresql://umi_api_login:$UMIPOS_DB_APP_PASSWORD@postgres:5432/$target" \
    -e "DATABASE_URL_WORKER=postgresql://umi_worker_login:$UMIPOS_DB_WORKER_PASSWORD@postgres:5432/$target" \
    -e OTEL_SERVICE_NAME=umi-worker-restore \
    "umipos-api:$RELEASE_VERSION" node --require @opentelemetry/auto-instrumentations-node/register dist/worker.js >/dev/null
  for _ in $(seq 1 25); do
    if docker exec "$api_container" node -e \
      "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then break; fi
    sleep 2
  done
  docker exec "$api_container" node -e \
    "fetch('http://127.0.0.1:3000/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
  docker exec "$api_container" node -e \
    "fetch('http://127.0.0.1:3000/api/kds/board',{method:'POST',headers:{'content-type':'application/json','x-kds-device-token':'gate6a-pilot-kds-token'},body:JSON.stringify({action:'snapshot'})}).then(async r=>{const v=await r.json();if(!r.ok||v.ok!==true)process.exit(1)}).catch(()=>process.exit(1))"
  docker exec "$worker_container" test -s /tmp/umi-worker-ready
  docker rm -f "$api_container" "$worker_container" >/dev/null
  echo "restore certified: $target RTO_SECONDS=$(( $(date +%s) - started ))"
}

rollback_application() {
  local target="${1:?Target release is required.}"
  local manifest="$ROOT/artifacts/releases/$target/release-manifest.json"
  [ -f "$manifest" ] || { echo "Target manifest is missing." >&2; exit 1; }
  local target_schema
  target_schema="$("$NODE_BIN" -e "const m=require(process.argv[1]);process.stdout.write(m.compatibility.schemaVersion)" "$manifest")"
  [ "$target_schema" = "$EXPECTED_SCHEMA_VERSION" ] || {
    echo "Application rollback is incompatible with the active schema." >&2
    exit 1
  }
  RELEASE_VERSION="$target" compose up -d umi-api umi-worker umi-dashboard
  wait_ready
  curl $(curl_options) "$PUBLIC_API_URL/health/release" | grep -q "$target"
  curl $(curl_options) "$PUBLIC_DASHBOARD_URL/release.json" | grep -q "$target"
  echo "application rollback passed: $target"
}

case "${1:-}" in
  precheck) precheck ;;
  build) build_release ;;
  backup) backup_database ;;
  migrate) precheck; apply_migrations ;;
  deploy) deploy_release ;;
  smoke) smoke ;;
  seed-certification) seed_certification ;;
  certify-clean) certify_clean ;;
  certify-business) certify_business ;;
  restore) restore_database "${2:-}" "${3:-}" ;;
  rollback) rollback_application "${2:-}" ;;
  status) compose ps ;;
  *) echo "Usage: $0 {precheck|build|backup|migrate|deploy|smoke|seed-certification|certify-clean|certify-business|restore DUMP [TARGET]|rollback VERSION|status}" >&2; exit 2 ;;
esac
