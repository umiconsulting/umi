#!/usr/bin/env bash
# Build the dashboard with public release configuration.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
BRANCH="${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-staging}}"
COMMIT="${GITHUB_SHA:-$(git rev-parse HEAD)}"
CONTRACT_VERSION="$(sed -n "s/^export const CONTRACT_VERSION = '\(.*\)';$/\1/p" packages/contract/src/catalog.ts)"
test -n "$CONTRACT_VERSION"
if [[ "$BRANCH" == main ]]; then
  ENVIRONMENT=production
  API_BASE=https://api.umiconsulting.co
  PUBLIC_URL=https://dashboard.umiconsulting.co
else
  ENVIRONMENT=staging
  API_BASE=
  PUBLIC_URL=https://staging.umi-dashboard.pages.dev
fi
cat > apps/umi-dashboard/.env.production.local <<EOF
VITE_UMI_ENVIRONMENT=$ENVIRONMENT
VITE_AUTH_MODE=cookie
VITE_API_BASE=$API_BASE
VITE_PUBLIC_URL=$PUBLIC_URL
VITE_BUSINESS_SLUG=elgranribera
VITE_CONTRACT_VERSION=$CONTRACT_VERSION
VITE_SUPABASE_URL=https://xbudknbimkgjjgohnjgp.supabase.co
VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY:-}
VITE_CONFIG_SCHEMA_VERSION=1
VITE_RELEASE_VERSION=$BRANCH
VITE_RELEASE_GIT_COMMIT=$COMMIT
VITE_RELEASE_BUILD_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
pnpm --filter @umi/dashboard build
