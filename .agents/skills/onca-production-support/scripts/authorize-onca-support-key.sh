#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: sudo authorize-onca-support-key.sh PUBLIC_KEY_FILE [--dry-run]

Adds one public key to root's SSH authorized_keys.
The key is accepted only from a Tailscale source address.
EOF
}

if (( $# < 1 || $# > 2 )); then
  usage >&2
  exit 2
fi
key_file="$1"
dry_run="${2:-}"
if [[ "$dry_run" != "" && "$dry_run" != "--dry-run" ]]; then
  usage >&2
  exit 2
fi
if (( EUID != 0 )); then
  printf 'Run this command as root.\n' >&2
  exit 2
fi
if [[ ! -r "$key_file" ]]; then
  printf 'Public key is not readable: %s\n' "$key_file" >&2
  exit 2
fi

key_line="$(tr -d '\r\n' < "$key_file")"
key_count="$(
  grep -Eo '(^| )(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)) ' \
    <<<"$key_line" | wc -l
)"
if [[ "$key_count" != "1" ]]; then
  printf 'The file must contain exactly one public key.\n' >&2
  exit 2
fi
if ! ssh-keygen -lf - >/dev/null 2>&1 <<<"$key_line"; then
  printf 'The public key is invalid.\n' >&2
  exit 2
fi

auth_dir=/root/.ssh
auth_file="$auth_dir/authorized_keys"
install -d -m 0700 -o root -g root "$auth_dir"
touch "$auth_file"
chown root:root "$auth_file"
chmod 0600 "$auth_file"

fingerprint="$(ssh-keygen -lf - <<<"$key_line" | awk '{print $2}')"
if ssh-keygen -lf "$auth_file" 2>/dev/null | awk '{print $2}' | grep -Fxq "$fingerprint"; then
  printf 'This key is already authorized: %s\n' "$fingerprint"
  exit 0
fi

restriction='from="100.64.0.0/10,fd7a:115c:a1e0::/48",no-agent-forwarding,no-X11-forwarding'
authorized_line="$restriction $key_line"
if [[ "$dry_run" == "--dry-run" ]]; then
  printf 'Validated key: %s\n' "$fingerprint"
  printf 'Would append: %s\n' "$authorized_line"
  exit 0
fi

printf '%s\n' "$authorized_line" >>"$auth_file"
sync
printf 'Authorized key: %s\n' "$fingerprint"
printf 'Test with: ssh root@100.109.51.39\n'
