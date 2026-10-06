#!/usr/bin/env bash
set -euo pipefail

# The shared disposable check includes the Gate 3E inventory matrix.
exec bash scripts/umi-pos-db-check.sh
