#!/usr/bin/env bash
# Secure-storage preflight for UmiPOS on Linux.
#
# UmiPOS fails closed when no Secret Service provider answers on the session bus. The
# symptom hides the cause: the till reports apiUnavailable, so it stops on the recovery
# card while the API is healthy and no request reaches :4001. The decision and its
# evidence are in docs/architecture/2026-09-28-linux-secret-service-provider.md.
#
# Usage:
#   scripts/local-secure-storage.sh            # check only, change nothing
#   scripts/local-secure-storage.sh --install  # install GNOME Keyring, start it, unlock it
set -euo pipefail

install=false
if [[ "${1:-}" == "--install" ]]; then install=true; fi

check() {
  local listing pid
  # A failed query is not the same answer as "no provider", and `set -e` would
  # otherwise abort here without saying which one happened.
  if ! listing="$(busctl --user list 2>&1)"; then
    echo "FAIL: cannot read the session bus: ${listing}" >&2
    return 1
  fi
  # An activatable but unowned name carries "-" in the pid column, so an owner
  # must be a real pid.
  pid="$(awk '$1 == "org.freedesktop.secrets" && $2 ~ /^[0-9]+$/ { print $2; exit }' <<<"$listing")"
  if [[ -z "$pid" ]]; then
    echo "FAIL: nothing owns org.freedesktop.secrets on the session bus." >&2
    echo "      The till will stop on 'No pudimos terminar la preparación'." >&2
    return 1
  fi
  local value
  printf 'probe\n' | secret-tool store --label=umi-probe app umi-probe
  value="$(secret-tool lookup app umi-probe || true)"
  secret-tool clear app umi-probe
  if [[ "$value" != "probe" ]]; then
    echo "FAIL: the store/lookup round trip returned '$value'." >&2
    return 1
  fi
  echo "OK: secure storage answers (provider pid $pid)."
}

if [[ "$install" != true ]]; then
  check
  exit $?
fi

# A second provider must not be left running: only one process may own the bus name.
if pgrep -x ksecretd >/dev/null 2>&1; then
  cat >&2 <<'EOF'
KWallet (ksecretd) is running and competes for the same bus name.
Stop it, and confirm KWallet is off:
  pkill ksecretd
  sed -i 's/^Enabled=true/Enabled=false/' ~/.config/kwalletrc
EOF
  exit 1
fi

if ! command -v gnome-keyring-daemon >/dev/null 2>&1; then
  if command -v pacman >/dev/null 2>&1; then
    sudo pacman -S --needed --noconfirm gnome-keyring libsecret
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get install -y gnome-keyring libsecret-tools
  else
    echo "FAIL: install gnome-keyring with your package manager, then rerun." >&2
    exit 1
  fi
fi

# An empty password means no prompter ever appears. That protects the credential by file
# permissions alone: right for a disposable workstation, wrong for a pilot till, where the
# login password plus PAM unlock is the supported path.
printf '\n' | gnome-keyring-daemon --unlock --components=secrets >/dev/null

for _ in $(seq 1 20); do
  if check >/dev/null 2>&1; then break; fi
  sleep 0.5
done
check
