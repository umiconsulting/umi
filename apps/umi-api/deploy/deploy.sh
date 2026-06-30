#!/usr/bin/env bash
# VPS-side deploy for a umi backend service. Pulls a prebuilt GHCR image and
# rolls the containers — it never builds on the box.
#
# Invoked over SSH by .github/workflows/deploy-backend.yml, e.g.:
#   ssh vps "APP_NAME='umi-api' bash -s 'sha-<gitsha>'" < apps/umi-api/deploy/deploy.sh
#
# Args:   $1  image tag to deploy (default: latest)
# Env:    APP_NAME       service / apps-subdir name      (default: umi-api)
#         UMI_REPO_DIR   repo checkout on the VPS        (default: $HOME/umi)
#
# Prereq (one-time, see docs/deploy-pipeline.md): the VPS has run
#   `docker login ghcr.io` with a token that can read the image, and
#   $UMI_REPO_DIR is a git checkout of umiconsulting/umi tracking main.
set -euo pipefail

TAG="${1:-latest}"
APP_NAME="${APP_NAME:-umi-api}"
REPO_DIR="${UMI_REPO_DIR:-$HOME/umi}"
APP_DIR="$REPO_DIR/apps/$APP_NAME"
# umi-api -> UMI_API_TAG (the var docker-compose.yml interpolates)
TAG_VAR="$(printf '%s' "$APP_NAME" | tr '[:lower:]-' '[:upper:]_')_TAG"

echo "==> Deploying $APP_NAME  tag=$TAG  ($TAG_VAR)"

# 1) Sync the checkout to main so compose/Caddyfile match the shipped code.
#    .env is gitignored, so the reset never touches local secrets/config.
cd "$REPO_DIR"
git fetch --depth=1 origin main
git reset --hard FETCH_HEAD

# 2) Pin the exact tag in .env -> deterministic restarts + one-line rollback.
cd "$APP_DIR"
touch .env
if grep -q "^${TAG_VAR}=" .env; then
  sed -i "s|^${TAG_VAR}=.*|${TAG_VAR}=${TAG}|" .env
else
  printf '%s=%s\n' "$TAG_VAR" "$TAG" >> .env
fi

# 3) Pull the prebuilt image(s) and roll the services. No build on the VPS.
docker compose pull
docker compose up -d --remove-orphans

# 4) Reclaim disk from superseded images.
docker image prune -f

echo "==> $APP_NAME @ $TAG is live:"
docker compose ps
