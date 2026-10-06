#!/usr/bin/env bash
# Is the API of record serving the code on disk?
#
# `nest start --watch` compiles on save and then respawns its child. It does not
# always respawn: a failing compile wedges it (plan defect D9), and the API keeps
# answering /health 200 while serving the previous build. That has now cost three
# separate sessions ten minutes each, every one of them spent debugging a route
# that was already correct on disk and absent from the process.
#
# This compares the running child's start time with the newest file under `dist/`
# and says which it is. With `--restart` it does the only thing that clears a
# wedged watch: kill it and start it again.
#
#   usage: ./scripts/api-freshness.sh              report
#          ./scripts/api-freshness.sh --restart    restart a wedged watch
set -euo pipefail

WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_ROOT="$WORKSPACE_ROOT/apps/umi-api"
# Overridable so the stale path can be tested without touching a live build.
DIST="${UMI_API_DIST:-$API_ROOT/dist}"
HEALTH="${UMI_API_HEALTH:-http://127.0.0.1:4001/health}"
LOG="${UMI_API_LOG:-/tmp/umi-api.log}"

api_pid() { pgrep -f 'enable-source-maps' | head -1 || true; }
watch_pid() { pgrep -f 'nest\.js start' | head -1 || true; }

# The newest build output, as an epoch.
newest_dist_epoch() {
  # `head` in a pipeline would close it early, and `pipefail` turns the sort's
  # SIGPIPE into a script failure. Read the whole list, then take the first line.
  local stamps first
  stamps="$(find "$DIST" -name '*.js' -printf '%T@\n' 2>/dev/null | sort -rn)"
  first="${stamps%%$'\n'*}"
  [ -n "$first" ] || return 1
  printf '%s' "${first%%.*}"
}

# The running child's start, as an epoch.
process_epoch() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  date -d "$(ps -o lstart= -p "$pid" 2>/dev/null)" +%s 2>/dev/null || return 1
}

report() {
  local pid watch started built
  pid="$(api_pid)"
  watch="$(watch_pid)"
  if [ -z "$pid" ]; then
    echo "api-freshness: NO API PROCESS — nothing is listening for the tests to talk to"
    return 2
  fi
  started="$(process_epoch "$pid")" || { echo "api-freshness: cannot read the start time"; return 2; }
  built="$(newest_dist_epoch)"
  [ -n "$built" ] || { echo "api-freshness: no build output under $DIST"; return 2; }

  printf 'api-freshness: api pid %s started %s\n' "$pid" "$(date -d "@$started" '+%H:%M:%S')"
  printf 'api-freshness: newest build %s\n' "$(date -d "@$built" '+%H:%M:%S')"
  if [ "$started" -lt "$built" ]; then
    printf 'api-freshness: STALE by %ss — the process predates the build it is meant to be serving\n' \
      "$((built - started))"
    printf 'api-freshness: the watch (pid %s) has not respawned; judge the code by the plan D9 rule\n' \
      "${watch:-gone}"
    return 1
  fi
  printf 'api-freshness: FRESH — the process is newer than the build\n'
  return 0
}

if [ "${1:-}" != "--restart" ]; then
  report
  exit $?
fi

echo "api-freshness: stopping the watch and the child, then starting again"
watch="$(watch_pid)"
[ -n "$watch" ] && kill "$watch" 2>/dev/null || true
pid="$(api_pid)"
[ -n "$pid" ] && kill "$pid" 2>/dev/null || true
sleep 3

cd "$API_ROOT"
setsid nohup npx nest start --watch >>"$LOG" 2>&1 </dev/null &
for _ in $(seq 1 60); do
  if curl -sf -m 2 "$HEALTH" >/dev/null 2>&1; then
    report || true
    exit 0
  fi
  sleep 2
done
echo "api-freshness: the API did not answer $HEALTH after the restart; see $LOG" >&2
exit 1
