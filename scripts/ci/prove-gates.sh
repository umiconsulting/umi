#!/usr/bin/env bash
# Prove four CI gate behaviors with the jq programs that ci.yml runs.
# Usage: bash scripts/ci/prove-gates.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT

python3 - "$W" <<'PY'
import re, sys
w = sys.argv[1]
s = open('.github/workflows/ci.yml').read()
ready = re.search(r"jq -e --arg redeploy \"\$REDEPLOY\" '\n(.*?)\n          ' <<< \"\$RESULTS\"", s, re.S).group(1)
rel = re.search(r"jq -e --arg branch \"\$RELEASE_BRANCH\" '\n(.*?)\n          ' <<< \"\$RESULTS\"", s, re.S).group(1)
open(f'{w}/ready.jq', 'w').write(ready + '\n')
open(f'{w}/release.jq', 'w').write(rel + '\n')
PY

cat > "$W/ready-docs-only.json" <<'JSON'
{"changes":{"result":"success","outputs":{"api":"false","dashboard":"false","landing":"false","cash":"false","pos":"false"}},"workflows":{"result":"success"},"secrets":{"result":"success"},"lint":{"result":"success"},"contract":{"result":"success"},"tokens":{"result":"success"},"api":{"result":"skipped"},"dashboard":{"result":"skipped"},"landing":{"result":"skipped"},"cash":{"result":"skipped"},"pos":{"result":"skipped"}}
JSON
cat > "$W/ready-failing.json" <<'JSON'
{"changes":{"result":"success","outputs":{"api":"false","dashboard":"false","landing":"false","cash":"false","pos":"false"}},"workflows":{"result":"success"},"secrets":{"result":"success"},"lint":{"result":"failure"},"contract":{"result":"success"},"tokens":{"result":"success"},"api":{"result":"skipped"},"dashboard":{"result":"skipped"},"landing":{"result":"skipped"},"cash":{"result":"skipped"},"pos":{"result":"skipped"}}
JSON
cat > "$W/ready-cancelled.json" <<'JSON'
{"changes":{"result":"success","outputs":{"api":"true","dashboard":"false","landing":"false","cash":"false","pos":"false"}},"workflows":{"result":"success"},"secrets":{"result":"success"},"lint":{"result":"success"},"contract":{"result":"success"},"tokens":{"result":"success"},"api":{"result":"cancelled"},"dashboard":{"result":"skipped"},"landing":{"result":"skipped"},"cash":{"result":"skipped"},"pos":{"result":"skipped"}}
JSON
cat > "$W/release-complete.json" <<'JSON'
{"ready":{"result":"success"},"changes":{"result":"success","outputs":{"api":"true","dashboard":"true","landing":"true"}},"deploy-api-staging":{"result":"success"},"deploy-api-production":{"result":"skipped"},"deploy-dashboard":{"result":"success"},"deploy-landing":{"result":"success"}}
JSON
cat > "$W/release-incomplete.json" <<'JSON'
{"ready":{"result":"success"},"changes":{"result":"success","outputs":{"api":"true","dashboard":"true","landing":"true"}},"deploy-api-staging":{"result":"success"},"deploy-api-production":{"result":"skipped"},"deploy-dashboard":{"result":"cancelled"},"deploy-landing":{"result":"success"}}
JSON

fail=0
run() {
  local name=$1 program=$2 fixture=$3 want=$4 arg=$5 rc
  if [ "$program" = ready ]; then
    jq -e --arg redeploy "$arg" -f "$W/ready.jq" < "$W/$fixture" >/dev/null 2>&1
  else
    jq -e --arg branch "$arg" -f "$W/release.jq" < "$W/$fixture" >/dev/null 2>&1
  fi
  rc=$?
  if { [ "$want" = pass ] && [ $rc -eq 0 ]; } || { [ "$want" = fail ] && [ $rc -ne 0 ]; }; then
    echo "PASS  $name  exit=$rc"
  else
    echo "FAIL  $name  exit=$rc"
    fail=1
  fi
}

run "failing-job-blocks-ready" ready ready-failing.json fail false
run "cancelled-job-blocks-ready" ready ready-cancelled.json fail false
run "docs-only-change-passes-ready" ready ready-docs-only.json pass false
run "incomplete-release-not-recorded" release release-incomplete.json fail staging
run "complete-release-recorded" release release-complete.json pass staging
exit $fail
