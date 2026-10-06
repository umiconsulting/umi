#!/usr/bin/env bash
set -euo pipefail

workspace_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pos_root="$workspace_root/apps/umi-pos"
api_base="${UMIPOS_API_BASE_URL:-http://127.0.0.1:4001}"
web_host="${UMIPOS_WEB_HOST:-127.0.0.1}"
web_port="${UMIPOS_WEB_PORT:-4002}"
contract_version="$(node -e "const c=require('$workspace_root/packages/contract/generated/contract.json');process.stdout.write(c.contractVersion)")"
release_version="$(sed -n 's/^version: \([^+]*\).*/\1/p' "$pos_root/pubspec.yaml" | head -n 1)"

cd "$pos_root"
exec flutter run --release -d web-server \
  --web-hostname "$web_host" \
  --web-port "$web_port" \
  --dart-define=UMIPOS_ENVIRONMENT=development \
  --dart-define=UMIPOS_API_BASE_URL="$api_base" \
  --dart-define=UMIPOS_DEVELOPMENT_DIAGNOSTICS=true \
  --dart-define=UMIPOS_FEATURE_BOOTSTRAP=disabled \
  --dart-define=UMIPOS_HARDWARE_SIMULATOR_ENABLED=true \
  --dart-define=UMIPOS_RELEASE_VERSION="$release_version" \
  --dart-define=UMIPOS_CONTRACT_VERSION="$contract_version" \
  --dart-define=UMIPOS_CONFIG_SCHEMA_VERSION=1
