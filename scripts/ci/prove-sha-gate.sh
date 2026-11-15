#!/usr/bin/env bash
# Prove the deploy.sh exact-SHA gate: exact SHA deploys, a moved branch aborts,
# and a tag that does not match RELEASE_SHA aborts.
# Usage: bash scripts/ci/prove-sha-gate.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
D="$(mktemp -d)"
trap 'rm -rf "$D"' EXIT
mkdir -p "$D/bin"
printf '#!/bin/sh\nexit 0\n' > "$D/bin/docker"
chmod +x "$D/bin/docker"

git init -q -b staging "$D/up"
cd "$D/up"
git config user.name CI
git config user.email ci@umi.invalid
mkdir -p apps/umi-api
printf '.env\n' > .gitignore
echo '# A' > apps/umi-api/docker-compose.yml
git add .
git commit -qm 'A'
echo '# B' > apps/umi-api/docker-compose.yml
git commit -qam 'B'
B=$(git rev-parse HEAD)
git clone -q "$D/up" "$D/co"
cd "$ROOT"

run() {
  PATH="$D/bin:$PATH" UMI_REPO_DIR="$D/co" UMI_DEPLOY_BRANCH=staging RELEASE_SHA="$1" \
    bash apps/umi-api/deploy/deploy.sh "sha-$2" >"$D/$3.log" 2>&1
}

set +e
run "$B" "$B" ok
rc_ok=$?
echo '# C' > "$D/up/apps/umi-api/docker-compose.yml"
git -C "$D/up" commit -qam 'C'
C=$(git -C "$D/up" rev-parse HEAD)
git -C "$D/co" checkout -q staging
run "$B" "$B" moved
rc_moved=$?
run "$B" "$C" tag
rc_tag=$?
set -e

echo "positive_exact_sha_exit=$rc_ok"
echo "moved_branch_exit=$rc_moved"
echo "tag_sha_mismatch_exit=$rc_tag"
test $rc_ok -eq 0 && test $rc_moved -ne 0 && test $rc_tag -ne 0
