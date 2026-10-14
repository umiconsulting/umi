#!/usr/bin/env bash
# Move ONE process's windows to an empty workspace, and do not touch the screen.
#
# House rule, asked for by the owner on 2026-10-10 while a game was running: a window under test
# never shares a workspace with anything else, and a run never switches what the person in front
# of the machine is looking at. `window-workspace.sh` enforces the first half by NAME and, on this
# compositor, by acting on the ACTIVE window — which is fine for the till (it takes focus when it
# maps) and wrong for a background Chromium: the active window is then the operator's own, and the
# move either fails or lands on the wrong window. The first patched launch of the browser proved
# it: the harness window opened on workspace 2, on top of the running game.
#
# This one takes a PID, matches the windows Hyprland reports for it, and moves them to a workspace
# with no windows on it. `follow` is never set, so the visible workspace does not change.
#
# Usage:
#   tools/ux-sweep/window-empty-workspace.sh <pid> [--prefer <workspace>]
#   tools/ux-sweep/window-empty-workspace.sh --next-free        # just print a free workspace
# Prints the workspace it used, or exits non-zero when it could not place the window.
set -euo pipefail

pid="${1:?usage: window-empty-workspace.sh <pid> [--prefer <workspace>]}"
shift || true
prefer=""
if [[ "${1:-}" == "--prefer" ]]; then
  prefer="${2:?--prefer needs a workspace id}"
fi

# ONE CALLER NEEDS THE NUMBER BEFORE THERE IS A WINDOW: a launcher installs a window rule that
# places the app on that workspace as it maps, which is the only way to keep a new window from
# appearing on the workspace the operator is using (moving it afterwards is a flicker, and a
# flicker on a fullscreen game is an interruption).
if [[ "$pid" == "--next-free" ]]; then
  command -v hyprctl >/dev/null 2>&1 || { echo "window-empty-workspace: needs hyprctl." >&2; exit 1; }
  python3 -c '
import json, subprocess
workspaces = json.loads(subprocess.check_output(["hyprctl", "-j", "workspaces"], text=True))
used = {w["id"] for w in workspaces if (w.get("windows") or 0) > 0}
print(next((n for n in range(1, 40) if n not in used), ""))
'
  exit 0
fi

if ! command -v hyprctl >/dev/null 2>&1; then
  echo "window-empty-workspace: this script needs hyprctl (Hyprland)." >&2
  exit 1
fi

# The windows of that pid, and a workspace nobody is using. Both come from Hyprland's own state:
# a workspace with `windows == 0` is empty, and the active one always has a window when a person is
# looking at it.
read -r target <<<"$(HYPR_PID="$pid" HYPR_PREFER="$prefer" python3 -c '
import json, os, subprocess

def hypr(*args):
    return json.loads(subprocess.check_output(["hyprctl", "-j", *args], text=True))

pid = int(os.environ["HYPR_PID"])
prefer = os.environ.get("HYPR_PREFER") or ""
workspaces = hypr("workspaces")
used = {w["id"] for w in workspaces if (w.get("windows") or 0) > 0}
clients = hypr("clients")
if not any(c.get("pid") == pid for c in clients):
    raise SystemExit("no window for pid %d" % pid)
if prefer and int(prefer) not in used:
    print(prefer)
else:
    print(next((n for n in range(1, 40) if n not in used), ""))
')"

if [[ -z "$target" ]]; then
  echo "window-empty-workspace: every workspace up to 40 has a window on it." >&2
  exit 1
fi

hyprctl eval "
local target = '${target}'
local moved = 0
for _, w in ipairs(hl.get_windows()) do
  if w.pid == ${pid} then
    -- follow = false, EXPLICITLY. Hyprland's `movetoworkspace` follows the window it moves, and
    -- the first version of this script left the operator looking at the harness workspace instead
    -- of their game. The silent variant is what a background move is for.
    hl.dispatch(hl.dsp.window.move({ window = w, workspace = target, follow = false }))
    moved = moved + 1
  end
end
print('moved ' .. moved .. ' window(s) of pid ${pid} to workspace ' .. target)
" >/dev/null

echo "$target"
