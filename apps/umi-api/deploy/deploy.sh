#!/usr/bin/env bash
# VPS-side deploy for a umi backend service. Pulls a prebuilt GHCR image and
# rolls the containers — it never builds on the box.
#
# Invoked over SSH by .github/workflows/deploy-backend.yml, e.g.:
#   ssh vps "APP_NAME='umi-api' bash -s 'sha-<gitsha>'" < apps/umi-api/deploy/deploy.sh
#
# Args:   $1  image tag to deploy (default: latest)
# Env:    APP_NAME          service / apps-subdir name      (default: umi-api)
#         UMI_REPO_DIR      repo checkout on the VPS        (default: $HOME/umi)
#         UMI_DEPLOY_BRANCH branch that checkout tracks     (default: main)
#         UMI_COMPOSE_FILE  compose file to roll, absolute or relative to
#                           $UMI_REPO_DIR   (default: $APP_DIR/docker-compose.yml)
#         UMI_PROJECT_DIR   compose project directory — where `.env`, certs and
#                           secrets resolve, and the default project name comes
#                           from        (default: dirname of the compose file)
#
# Prereq (one-time, see docs/deploy-pipeline.md): the VPS has run
#   `docker login ghcr.io` with a token that can read the image, and
#   $UMI_REPO_DIR is a git checkout of umiconsulting/umi tracking
#   $UMI_DEPLOY_BRANCH (a second checkout — e.g. ~/umi-staging tracking
#   `staging` — is how an isolated non-prod environment shares this same
#   script and docker-compose.yml on one box).
set -euo pipefail

TAG="${1:-latest}"
APP_NAME="${APP_NAME:-umi-api}"
REPO_DIR="${UMI_REPO_DIR:-$HOME/umi}"
BRANCH="${UMI_DEPLOY_BRANCH:-main}"
APP_DIR="$REPO_DIR/apps/$APP_NAME"
# umi-api -> UMI_API_TAG (the var docker-compose.yml interpolates)
TAG_VAR="$(printf '%s' "$APP_NAME" | tr '[:lower:]-' '[:upper:]_')_TAG"

# Compose file + project directory. Prod keeps both inside $APP_DIR, which is
# why they default to it. A second environment on the same box (the build-v3 QA
# stack) keeps its compose file in the repo at deploy/<env>/compose.yml while
# its `.env`, certs and secrets stay in a state directory outside git — so the
# project directory has to be nameable separately from the compose file.
# Compose resolves `env_file` and relative bind mounts against the PROJECT
# directory (verified), which is what leaves that state where it is.
if [ -n "${UMI_COMPOSE_FILE:-}" ]; then
  case "$UMI_COMPOSE_FILE" in
    /*) COMPOSE_FILE="$UMI_COMPOSE_FILE" ;;
    *) COMPOSE_FILE="$REPO_DIR/$UMI_COMPOSE_FILE" ;;
  esac
else
  COMPOSE_FILE="$APP_DIR/docker-compose.yml"
fi
PROJECT_DIR="${UMI_PROJECT_DIR:-$(dirname "$COMPOSE_FILE")}"

compose() {
  docker compose --project-directory "$PROJECT_DIR" -f "$COMPOSE_FILE" "$@"
}

echo "==> Deploying $APP_NAME  tag=$TAG  ($TAG_VAR)  branch=$BRANCH"
echo "    compose=$COMPOSE_FILE  project_dir=$PROJECT_DIR"

# 1) Sync the checkout to $BRANCH so compose/Caddyfile match the shipped code.
#    .env is gitignored, so the reset never touches local secrets/config.
cd "$REPO_DIR"
git fetch --depth=1 origin "$BRANCH"
git reset --hard FETCH_HEAD

# 1b) Make sure the compose file is actually on disk.
#
#     A checkout can be a SPARSE worktree — the QA checkout on this box is
#     cone-mode over apps/* + packages/* — and then `git reset --hard` moves
#     HEAD without ever writing deploy/<env>/compose.yml. The roll then fails
#     reading a file that plainly exists in the commit it just checked out.
#     Measured on 2026-09-25: HEAD at the merge commit, `deploy/` absent,
#     `docker compose` reporting "no such file or directory".
#
#     Widening the cone is persistent, so this is a no-op from the second run
#     on. It only ever runs when the file is missing AND the worktree is
#     genuinely sparse, so a non-sparse checkout with a typo'd UMI_COMPOSE_FILE
#     still fails loudly at the check below rather than silently "fixing" it.
if [ ! -f "$COMPOSE_FILE" ] &&
  [ "$(git -C "$REPO_DIR" config --get core.sparseCheckout || true)" = "true" ]; then
  case "$COMPOSE_FILE" in
    "$REPO_DIR"/*)
      SPARSE_DIR="$(dirname "${COMPOSE_FILE#"$REPO_DIR"/}")"
      echo "    $SPARSE_DIR is outside the sparse cone — adding it"
      git -C "$REPO_DIR" sparse-checkout add "$SPARSE_DIR"
      ;;
  esac
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "FATAL: compose file not found after checkout: $COMPOSE_FILE" >&2
  exit 1
fi

# 2) Pin the exact tag in .env -> deterministic restarts + one-line rollback.
#    The `.env` lives in the PROJECT directory (prod: $APP_DIR; a second
#    environment: its own state dir), never in the checkout.
cd "$PROJECT_DIR"
touch .env
if grep -q "^${TAG_VAR}=" .env; then
  sed -i "s|^${TAG_VAR}=.*|${TAG_VAR}=${TAG}|" .env
else
  printf '%s=%s\n' "$TAG_VAR" "$TAG" >> .env
fi

# 3) Pull the prebuilt image(s) and roll the services. No build on the VPS.
compose pull
compose up -d --remove-orphans

# 4) Reclaim disk from superseded images.
docker image prune -f

echo "==> $APP_NAME @ $TAG is live:"
compose ps
