---
name: staging-validation-runner
description: Reproduce the Umi platform transition database in a staging PostgreSQL target, apply the public-compat no-import gate, run core validation, compare row counts, and record promotion evidence.
---

# Staging Validation Runner

Use this when promoting or rehearsing the seven-schema Umi platform database across local, staging, preview, or production-cutover targets.

## Procedure

1. Confirm the target is disposable or explicitly approved for migration rehearsal.
2. Apply `docs/migration/local-postgres/001_platform_core.sql` through `007_legacy_migration_core.sql`.
3. Apply `010_seed_product_matrix.sql`, then the FDW/source link step, then `030` through `044`.
4. If local source FDW ports differ, stream `020_local_source_fdw.sql` with only the port adjusted; do not edit secrets or source URLs into docs.
5. Apply the Phase 4F public-compat decision: public-only runtime rows are `archived_only` in `legacy.public_compat_imports`, never imported into production-facing tables.
6. Run `docs/migration/validation/001_core_validation.sql`.
7. Export row counts for `platform`, `commerce`, `cash`, `conversaflow`, `kds`, `observability`, `legacy`, and any local compatibility schema.
8. Compare against the previous accepted target and record any intentional deltas with customer/brand/code impact.

## Failure Handling

- Stop on any SQL error; fix the replay script instead of hand-mutating the target.
- A count mismatch is not automatically acceptable. Classify it as a script bug, local-only fixture, or intentional cleanup before declaring the gate met.
- Do not advance a customer-facing cutover if validation has blocking rows or unexplained production-facing count loss.
