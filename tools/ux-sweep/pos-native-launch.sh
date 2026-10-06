#!/usr/bin/env bash
# Launch the POS as the product ships it: the native Linux build.
#
# This is the desktop twin of `scripts/umi-pos-firefox.sh`. That script runs the
# Flutter **web** build because it is easy to attach a browser to; the POS is a
# native application (docs/architecture/2026-09-16-pos-is-a-native-app.md), so
# the runtime of record is this one.
#
# `--debug` is deliberate: a debug build publishes the Dart VM service, which is
# the only driver that exists for the Linux target (`patrol` has no linux
# platform). Without it there is no semantics tree to read and no way to click.
#
# Usage:
#   tools/ux-sweep/pos-native-launch.sh [logfile]
#
# The launcher prints the VM service URL, waits for the window to appear, and
# leaves the app running in the background. Stop it with
# `tools/ux-sweep/pos-native-launch.sh --stop`.
set -euo pipefail

workspace_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pos_root="$workspace_root/apps/umi-pos"
api_base="${UMIPOS_API_BASE_URL:-http://127.0.0.1:4001}"
flutter_bin="${FLUTTER_BIN:-$HOME/.local/opt/flutter/bin/flutter}"

if [[ "${1:-}" == "--stop" ]]; then
  pkill -f 'bundle/umi_pos' || true
  pkill -f 'flutter_tools.snapshot run -d linux' || true
  echo "stopped"
  exit 0
fi

# Single instance only, and now it REFUSES instead of replacing.
#
# Two copies means two X windows with the same title, and `xdotool search` would
# hand the driver whichever it finds last - so the coordinates it computes could
# belong to a window it never clicked. This used to `pkill` whatever was there,
# which is fine when the instance is yours and rude when it is not: it killed
# another session's till mid-test (an instance launched against a different API
# port, which is how a second session works on the terminal path). Ask for
# `--force` to replace one deliberately.
running_pids="$(pgrep -f 'bundle/umi_pos' 2>/dev/null | tr '\n' ' ' || true)"
force=false
if [[ "${1:-}" == "--force" ]]; then
  force=true
  shift
fi
# `log_file` is read AFTER the `--force` shift, deliberately: taken before it,
# `--force` itself became the log path and every `grep "$log_file"` in the wait
# loop below failed with "unrecognized option" — which reads as a launcher that
# hangs rather than as an argument that was consumed in the wrong order.
log_file="${1:-/tmp/umi-pos-linux.log}"
if [[ -n "${running_pids// /}" && "$force" != true ]]; then
  cat >&2 <<EOF
A till is already running (pid ${running_pids}).
Nothing was killed. Attach to it instead:
  node tools/ux-sweep/pos-native-flows.mjs --no-restart
or replace it deliberately:
  tools/ux-sweep/pos-native-launch.sh --force
EOF
  exit 2
fi
pkill -f 'bundle/umi_pos' >/dev/null 2>&1 || true
pkill -f 'flutter_tools.snapshot run -d linux' >/dev/null 2>&1 || true
for _ in $(seq 1 40); do
  if ! DISPLAY="${DISPLAY:-:0}" xdotool search --name '^UmiPOS$' >/dev/null 2>&1; then break; fi
  sleep 0.5
done

contract_version="$(node -e "const c=require('$workspace_root/packages/contract/generated/contract.json');process.stdout.write(c.contractVersion)")"
release_version="$(sed -n 's/^version: \([^+]*\).*/\1/p' "$pos_root/pubspec.yaml" | head -n 1)"

cd "$pos_root"
: > "$log_file"
# The till runs fullscreen: the owner's standing rule for testing, and what a
# counter terminal actually is. The flag is read by the Linux runner, which goes
# fullscreen BEFORE the window is mapped — asking a mapped window to do it kills
# the client on this compositor. See linux/runner/my_application.cc.
export UMIPOS_FULLSCREEN=1
setsid nohup "$flutter_bin" run -d linux --debug \
  --dart-define=UMIPOS_ENVIRONMENT=development \
  --dart-define=UMIPOS_API_BASE_URL="$api_base" \
  --dart-define=UMIPOS_DEVELOPMENT_DIAGNOSTICS=true \
  --dart-define=UMIPOS_FEATURE_BOOTSTRAP=disabled \
  --dart-define=UMIPOS_HARDWARE_SIMULATOR_ENABLED=true \
  --dart-define=UMIPOS_RELEASE_VERSION="$release_version" \
  --dart-define=UMIPOS_CONTRACT_VERSION="$contract_version" \
  --dart-define=UMIPOS_CONFIG_SCHEMA_VERSION=1 \
  >>"$log_file" 2>&1 &

for _ in $(seq 1 300); do
  window_count="$(DISPLAY="${DISPLAY:-:0}" xdotool search --name '^UmiPOS$' 2>/dev/null | grep -c . || true)"
  vm_url="$(grep -oE 'http://127\.0\.0\.1:[0-9]+/[A-Za-z0-9_=-]+/' "$log_file" | head -n 1 || true)"
  if [[ -n "$vm_url" && "$window_count" == "1" ]]; then
    # House rules for testing, asked for by the owner: the till gets a workspace
    # of its own - never shared with whatever else is open - and the largest
    # window this client survives. See window-workspace.sh for why that is
    # "maximised" and not EWMH fullscreen: fullscreen kills the Flutter GTK
    # client on this compositor.
    target="$(bash "$workspace_root/tools/ux-sweep/window-workspace.sh" '^UmiPOS$' || echo '?')"
    echo "vm_service=$vm_url"
    echo "log=$log_file"
    echo "workspace=$target"
    exit 0
  fi
  sleep 1
done

echo "timed out waiting for the POS window; see $log_file" >&2
exit 1
