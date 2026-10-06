#!/usr/bin/env bash
set -euo pipefail

# The shared disposable check applies Gate 3F and verifies platform RLS invariants.
exec bash scripts/umi-pos-db-check.sh
