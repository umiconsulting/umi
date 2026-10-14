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
# The client must be an X11 window, and this line is what makes it one.
#
# Both this script's own readiness check and every click the driver sends go
# through `xdotool`, which speaks X11: on a Wayland compositor a GTK app defaults
# to the Wayland backend, `xdotool search` then finds NOTHING, this loop times out
# as "the POS did not start", and the driver has no window to aim at. Forcing the
# X11 backend (XWayland) keeps the launcher's check honest and the harness able to
# click the real till.
export GDK_BACKEND=x11
# A WORKSPACE OF ITS OWN, BEFORE THE WINDOW EXISTS, AND WITHOUT TAKING FOCUS.
#
# House rule, asked for by the owner: a window under test never lands on the workspace the person
# in front of the machine is using. Moving a window afterwards is a flicker on that workspace and
# a flicker on a fullscreen game is an interruption, so the rule is installed FIRST and the window
# maps straight onto an empty workspace. `no_initial_focus` is what keeps it from pulling the
# screen across; it is a field this compositor's rule API accepts (probed, not assumed — the
# legacy name `noinitialfocus` is rejected).
# And where the operator's screen was, so it can be put back: a freshly mapped window can still ask
# for focus, and a compositor that follows focus then takes the view with it.
before_workspace="$(hyprctl monitors -j 2>/dev/null | python3 -c '
import json, sys
try:
    monitors = json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
focused = next((m for m in monitors if m.get("focused")), None)
print((focused or {}).get("activeWorkspace", {}).get("id", ""))
' 2>/dev/null || true)"
pos_workspace=""
if command -v hyprctl >/dev/null 2>&1; then
  pos_workspace="$(bash "$workspace_root/tools/ux-sweep/window-empty-workspace.sh" --next-free || true)"
  if [[ -n "$pos_workspace" ]]; then
    hyprctl eval "
if umi_pos_workspace_rule then umi_pos_workspace_rule:set_enabled(false) end
umi_pos_workspace_rule = hl.window_rule({
  name='umi-pos-empty-workspace',
  -- `[Cc]`: the app's id is `co.umiconsulting.umi_pos` and this compositor reports the class as
  -- `Co.umiconsulting.umi_pos`. A case-sensitive pattern silently matches nothing, the rule does
  -- nothing, and the window lands on whatever workspace the operator is using — the exact
  -- interruption this rule exists to prevent.
  match={class='[Cc]o[.]umiconsulting[.]umi_pos$'},
  workspace='${pos_workspace}',
  no_initial_focus=true,
  no_focus=true,
})" >/dev/null 2>&1 || true
  fi
fi

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

# The rule places it; this makes sure. The app process is the `bundle/umi_pos` child, not the
# `flutter run` wrapper this script started, so the pid is resolved from the process table.
if [[ -n "$pos_workspace" ]]; then
  for _ in $(seq 1 40); do
    pos_pid="$(pgrep -f 'bundle/umi_pos' | head -n 1 || true)"
    if [[ -n "$pos_pid" ]] &&
      bash "$workspace_root/tools/ux-sweep/window-empty-workspace.sh" "$pos_pid" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
fi

# PUT THE OPERATOR'S SCREEN BACK. `no_focus` above should make this unnecessary, and it is kept
# because "should" is not a guarantee: the app asks for focus itself when it maps, and the cost of
# being wrong is the owner's screen disappearing behind a till they did not ask to see. Measured
# on 2026-10-10: a launch left the visible workspace on the till's.
if [[ -n "${before_workspace:-}" ]]; then
  hyprctl dispatch "hl.dsp.focus({workspace=\"${before_workspace}\"})" >/dev/null 2>&1 || true
fi

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
