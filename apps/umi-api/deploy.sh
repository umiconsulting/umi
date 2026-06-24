#!/usr/bin/env bash
# Redeploy umi-api to the VPS: sync this folder up, then rebuild the Docker stack.
#
# Usage (from apps/umi-api/):
#   UMI_API_VPS=user@host ./deploy.sh
#
# Optional env:
#   UMI_API_DEST   path under the remote home dir (default: umi-api)
#
# The host is intentionally NOT hardcoded (this repo is public) — pass it in.
set -euo pipefail

VPS="${UMI_API_VPS:?set UMI_API_VPS, e.g. UMI_API_VPS=user@1.2.3.4}"
DEST="${UMI_API_DEST:-umi-api}"

# DEST is interpolated into the remote shell command below, so restrict it to a
# safe path charset to avoid breaking `cd` or injecting shell tokens.
if [[ ! "${DEST}" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "Invalid UMI_API_DEST: ${DEST}" >&2
  exit 1
fi

echo "→ syncing $(pwd) to ${VPS}:~/${DEST}/"
# --delete keeps the remote matching local (no stale artifacts); the excludes
# also protect remote .env / node_modules / dist from deletion.
rsync -av --delete \
  --exclude node_modules --exclude dist --exclude .env \
  ./ "${VPS}:${DEST}/"

echo "→ rebuilding the stack on ${VPS}"
ssh "${VPS}" "cd ${DEST} && docker compose up -d --build && docker compose ps"

echo "✓ deployed — verify with: ssh ${VPS} 'curl -s http://localhost/health'"
