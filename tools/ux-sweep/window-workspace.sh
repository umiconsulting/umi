#!/usr/bin/env bash
# Give a window a workspace of its own, and make it fullscreen.
#
# House rule for testing, asked for by the owner: a window under test never
# shares a workspace with anything else, and it runs fullscreen. Two apps on one
# workspace means one covers the other, and a covered window is one whose pointer
# events, screenshots and window geometry belong to whatever is on top — the
# driver would then report "the click missed" about a press that landed on the
# right pixels of the wrong window.
#
# Usage:
#   tools/ux-sweep/window-workspace.sh <window-name-regex> [workspace]
#
# Prints the workspace it used, or exits non-zero when no window matches.
# The workspace argument pins the destination; without it the first workspace
# with no visible window on it is chosen, and if every workspace is taken a new
# one is created.
set -euo pipefail
export DISPLAY="${DISPLAY:-:0}"

pattern="${1:?usage: window-workspace.sh <window-name-regex> [workspace]}"
pinned="${2:-}"

window_id="$(xdotool search --name "$pattern" 2>/dev/null | head -n 1 || true)"
if [[ -z "$window_id" ]]; then
  echo "no window matches $pattern" >&2
  exit 1
fi

if [[ -n "$pinned" ]]; then
  target="$pinned"
else
  occupied="$(
    for id in $(xdotool search --onlyvisible --name '.*' 2>/dev/null || true); do
      [[ "$id" == "$window_id" ]] && continue
      xdotool get_desktop_for_window "$id" 2>/dev/null || true
    done | sort -n -u
  )"
  target=""
  for candidate in $(seq 0 9); do
    if ! printf '%s\n' "$occupied" | grep -qx "$candidate"; then
      target="$candidate"
      break
    fi
  done
  if [[ -z "$target" ]]; then
    target="$(wmctrl -d | wc -l)"
    wmctrl -n "$((target + 1))" >/dev/null 2>&1 || true
  fi
fi

# The window manager has to have managed the window before it has a desktop to
# be moved to, and the launcher calls this the moment the X window exists — so
# the move is retried rather than assumed.
moved=false
for _ in $(seq 1 60); do
  if xdotool get_desktop_for_window "$window_id" >/dev/null 2>&1 &&
    xdotool set_desktop_for_window "$window_id" "$target" >/dev/null 2>&1; then
    moved=true
    break
  fi
  sleep 0.5
done
if [[ "$moved" != true ]]; then
  echo "window $window_id exists but the window manager never took it" >&2
  exit 1
fi

# MAXIMISED, not EWMH fullscreen, and that is not a preference.
#
# Asking this window to be fullscreen KILLS the till: the request resizes it to
# the full 1920x1080 display, the compositor hands Flutter a 1920x1004 surface
# instead, and the GTK embedder gives up waiting for a frame of the size it
# asked for —
#
#   WARNING: Timed out waiting for OpenGL frame of size 1920x1080 (have 1920x1004)
#   Lost connection to device.
#
# The app then exits and `flutter run` reports a lost device. Maximised fills the
# work area (1920x1051 here, the display minus the top bar) and survives, so the
# rule "fullscreen while testing" is met with the largest window the client
# actually runs in. Fixing the crash is its own work; until then a testing rule
# that kills the app under test is not a rule that can be followed.
xdotool windowactivate --sync "$window_id" >/dev/null 2>&1 || true
wmctrl -i -r "$(printf '0x%08x' "$window_id")" -b add,maximized_vert,maximized_horz \
  >/dev/null 2>&1 || true
echo "$target"
