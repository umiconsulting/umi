#!/usr/bin/env bash
set -euo pipefail

# The build-v3 chain is the only pre-cutover migration authority.
exec bash scripts/umi-pos-db-check.sh
