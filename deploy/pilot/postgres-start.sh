#!/usr/bin/env bash
set -euo pipefail

marker=/var/lib/postgresql/data/.umipos-init-complete
if [ -s /var/lib/postgresql/data/PG_VERSION ] && [ ! -f "$marker" ]; then
  touch "$marker"
fi

exec docker-entrypoint.sh "$@"
