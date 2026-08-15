#!/usr/bin/env bash
# ============================================================================
# The DDL freeze — the mechanism, not the promise.
#
# The cutover applies one exact version of the numbered DDL. After that moment a
# production database carries the schema AND the data, so an edit to a numbered
# file changes what a NEW database gets and does nothing to the one that holds
# the customers. The rule is in migrations/README.md; this file enforces it.
#
#   ./freeze.sh check   what CI runs. Silent while FROZEN.sha256 is absent.
#   ./freeze.sh freeze  run ONCE, on cutover day, after the DDL is applied.
#   ./freeze.sh thaw    remove the freeze. It prints who must agree first.
#
# BEFORE the cutover there is no FROZEN.sha256, `check` passes, and the DDL is
# edited freely. That is correct: no database carries this schema yet, CI applies
# it from scratch on every round, and a migration would be ceremony.
#
# AFTER `freeze`, `check` fails on any edit to a numbered file, and names the
# file. The fix is a migration, never an edit.
# ============================================================================
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
STAMP="$DIR/FROZEN.sha256"
FILES=(00_foundation.sql 10_umi.sql 20_merchant.sql 30_runtime.sql
       50_cross_schema_fk.sql 60_triggers.sql 90_rls.sql 99_verify.sql 00_run.sh)

hashes() {
  # Sorted, so the stamp does not depend on the order of the array above.
  for f in "${FILES[@]}"; do
    shasum -a 256 "$DIR/$f" | awk -v n="$f" '{print $1 "  " n}'
  done | sort -k2
}

case "${1:-check}" in
  check)
    if [ ! -f "$STAMP" ]; then
      echo "DDL freeze: NOT FROZEN (pre-cutover). Edit the numbered files freely."
      exit 0
    fi
    if diff -u <(grep -v '^#' "$STAMP") <(hashes) > /tmp/ddl-freeze.diff 2>&1; then
      echo "DDL freeze: OK — every numbered file matches the cutover version."
      exit 0
    fi
    echo "DDL FREEZE VIOLATED. A numbered DDL file changed after the cutover."
    echo
    cat /tmp/ddl-freeze.diff
    echo
    echo "The live database does NOT get this edit. Write a migration instead:"
    echo "  docs/migration/build-v3/migrations/  (see its README)"
    exit 1
    ;;
  freeze)
    {
      echo "# The build-v3 DDL as applied at the cutover. Written by freeze.sh."
      echo "# Do not edit a numbered file after this. Write a migration."
      hashes
    } > "$STAMP"
    echo "Frozen $(( ${#FILES[@]} )) files into $STAMP"
    ;;
  thaw)
    echo "Removing the freeze means an edit to the numbered DDL will not reach"
    echo "production, and CI will stop saying so. The owner must agree."
    echo "To proceed:  rm $STAMP"
    exit 1
    ;;
  *)
    echo "usage: $0 [check|freeze|thaw]" >&2
    exit 2
    ;;
esac
