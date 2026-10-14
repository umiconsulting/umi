#!/usr/bin/env bash
# Start the CDP browser the UX harnesses attach to, and leave it running.
#
# The sweep tools (`tools/ux-sweep/*.mjs`, `pnpm ux:verify`, `pnpm ux:flows`,
# `pnpm ux:a11y`) do not launch a browser — they borrow one over the DevTools
# Protocol and drive the **real** dashboard with real clicks. That is deliberate:
# a harness that launches its own browser can quietly measure a different profile,
# a different session, or no session at all.
#
# It used to sit running all day, which cost ~700 MB of RSS on a 7.7 GB box that is
# already swapping. Start it when you are about to sweep and stop it with
# `pkill -f remote-debugging-port=9222` when you are done; the profile on disk keeps
# the signed-in dashboard session either way.
#
# IT OPENS A REAL WINDOW. The owner's standing instruction: dashboard front-end
# work is verified in the real browser, with real clicks — a headless run is not
# evidence about what the operator sees, and a pane nobody can look at is how a
# dead control survives a green suite. It needs DISPLAY; on this workstation that
# is `:0`. `UX_HEADLESS=1` forces the old headless path back for a constrained
# run, and using it means the result is not a dashboard verification.
#
#   usage: ./ux-browser.sh            start if absent, print the CDP endpoint
#          ./ux-browser.sh --stop     stop it
set -euo pipefail

export DISPLAY="${DISPLAY:-:0}"

PORT="${UX_CDP_PORT:-9222}"
PROFILE="${UX_CHROME_PROFILE:-/tmp/ux/chrome-profile}"

if [ "${1:-}" = "--stop" ]; then
  pkill -f "remote-debugging-port=${PORT}" || true
  echo "ux-browser: stopped (port ${PORT})"
  exit 0
fi

if curl -sf -m 2 "http://127.0.0.1:${PORT}/json/version" >/dev/null; then
  echo "ux-browser: already running on ${PORT}"
  exit 0
fi

CHROME="${UX_CHROME_BIN:-$HOME/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome}"
[ -x "$CHROME" ] || {
  echo "ux-browser: no Chromium at ${CHROME}; set UX_CHROME_BIN (pnpm exec playwright install chromium)" >&2
  exit 1
}

mkdir -p "$PROFILE" /tmp/ux

if [ "${UX_HEADLESS:-0}" = "1" ]; then
  WINDOW_ARGS=(--headless=new --disable-gpu --ozone-platform=headless \
    --ozone-override-screen-size=800,600)
  echo "ux-browser: UX_HEADLESS=1 — no window; this run is NOT a dashboard verification" >&2
else
  # A real window at the reference viewport, placed where the sweep's
  # screenshots and pointer gestures expect it.
  WINDOW_ARGS=(--window-size=1280,800 --window-position=0,0)
fi

setsid nohup "$CHROME" \
  "${WINDOW_ARGS[@]}" --no-sandbox --disable-dev-shm-usage \
  --remote-debugging-port="${PORT}" --user-data-dir="$PROFILE" \
  --noerrdialogs --no-first-run --use-angle=swiftshader-webgl \
  about:blank >/tmp/ux/chrome.log 2>&1 < /dev/null &
chrome_pid=$!

for _ in $(seq 1 30); do
  if curl -sf -m 2 "http://127.0.0.1:${PORT}/json/version" >/dev/null; then
    # A WORKSPACE OF ITS OWN, AND WITHOUT TAKING THE SCREEN.
    #
    # House rule, asked for by the owner: a window under test never shares a workspace with
    # anything else, so a run cannot interrupt what the person in front of the machine is doing.
    #
    # BY PID, and it never follows the window. The first patched launch of this script used the
    # name-based `window-workspace.sh`, that script acted on the ACTIVE window on this compositor,
    # and the harness window therefore opened on top of a running game on workspace 2. The
    # pid-based mover cannot pick the wrong window, and `follow = false` keeps the operator's
    # screen where they left it. The same rule is why the POS driver captures with
    # `magick import -window <id>` rather than a screen grab: the window is rarely the visible one.
    if [ "${UX_HEADLESS:-0}" != "1" ]; then
      mover="$(dirname "${BASH_SOURCE[0]}")/../tools/ux-sweep/window-empty-workspace.sh"
      workspace=""
      for _ in $(seq 1 20); do
        workspace="$(bash "$mover" "$chrome_pid" 2>/dev/null || true)"
        [ -n "$workspace" ] && break
        sleep 0.5
      done
      if [ -n "$workspace" ]; then
        echo "ux-browser: window placed on workspace ${workspace} (your screen was not switched)"
      else
        echo "ux-browser: could not place the window on a workspace of its own; it is on your screen" >&2
      fi
    fi
    echo "ux-browser: CDP ready at http://127.0.0.1:${PORT}"
    exit 0
  fi
  sleep 1
done

echo "ux-browser: Chromium did not answer on ${PORT}; see /tmp/ux/chrome.log" >&2
exit 1
