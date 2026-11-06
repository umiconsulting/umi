#!/usr/bin/env bash
set -euo pipefail
PREVIEW_PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
export BRAINSTORM_DIR="$PREVIEW_PROJECT_DIR/.superpowers/brainstorm/18629-1793487079"
export BRAINSTORM_HOST=127.0.0.1
export BRAINSTORM_URL_HOST=localhost
export BRAINSTORM_PORT_FILE="$PREVIEW_PROJECT_DIR/.superpowers/brainstorm/.last-port"
export BRAINSTORM_TOKEN_FILE="$PREVIEW_PROJECT_DIR/.superpowers/brainstorm/.last-token"
export BRAINSTORM_OPEN=1
export BRAINSTORM_IDLE_TIMEOUT_MS=86400000
exec node /Users/moon/.codex/skills/brainstorming/scripts/server.cjs
