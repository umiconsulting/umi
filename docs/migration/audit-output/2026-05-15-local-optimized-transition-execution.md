# Optimized Database Transition Local Execution - 2026-05-15

## Follow-up Source Note - 2026-05-15

This execution report covers only the local target schema draft in `umi_platform_local`. Later on 2026-05-15, active Cash production was verified as a separate Supabase project and copied locally into `umi_cash_production_local_20260515`.

The target schema execution remains valid, but future import SQL must source Cash rows from `umi_cash_production_local_20260515` or active Cash production, not from the stale Umi Platform `umi_cash` copy.

## Scope

Executed the local-only portion of:

- `docs/migration/2026-05-15-optimized-database-transition-plan.md`
- `docs/migration/2026-05-15-optimized-database-transition-checklist.md`

No production database was connected.
No production migration was applied.
The disposable local database `umi_platform_local` was dropped and recreated.

## Local Database

- PostgreSQL binary: `/opt/homebrew/opt/postgresql@18/bin`
- PostgreSQL version: 18.3 Homebrew
- Local URL: `postgresql://localhost:5432/umi_platform_local`

## Files Updated

- `docs/migration/local-postgres/001_platform_core.sql`
- `docs/migration/local-postgres/010_seed_product_matrix.sql`
- `docs/migration/local-postgres/007_legacy_migration_core.sql`
- `docs/migration/validation/001_core_validation.sql`
- `docs/migration/audit-output/local-platform-schema.sql`

## Schema Changes Applied Locally

Platform refinements:

- Added contact identity verification fields:
  - `normalized_value`
  - `verification_status`
  - `verified_at`
  - `confidence`
  - `metadata`
- Replaced strict contact identity uniqueness with verified-normalized uniqueness only.
- Added unverified duplicate lookup support.
- Added `platform.contact_merge_candidates`.
- Reworked role uniqueness to support tenant roles and future global roles.

Legacy migration layer:

- Added `legacy.import_batches`.
- Added mapping tables for tenants, locations, users, staff, contacts, orders, and KDS tickets.
- Added `legacy.public_compat_imports`.
- Added `legacy.replay_queue` so old jobs/outbox rows are not imported directly into live claimable queues.

Seed refinements:

- Seeded permissions:
  - dashboard
  - cash
  - conversaflow
  - kds
  - observability
  - staff management
  - support access
- Seeded tenant roles:
  - owner
  - admin
  - staff
  - developer
  - tech_assist
- Assigned local owner memberships to the `owner` role.

## Validation Results

Ran:

```bash
/opt/homebrew/opt/postgresql@18/bin/psql \
  postgresql://localhost:5432/umi_platform_local \
  -v ON_ERROR_STOP=1 \
  -f docs/migration/validation/001_core_validation.sql
```

Results:

- Product capability matrix returned both seeded tenants.
- Product tables missing `tenant_id`: `0`.
- Product `tenant_id` columns missing FK to `platform.tenants(id)`: `0`.
- Verified duplicate contact identities: `0`.
- Replay rows requiring operator approval: `0`.
- RLS as `umi_app` with local owner context returned both seeded tenants.
- RLS as `umi_app` with empty user context returned `0` tenants.
- Seeded role permission counts:
  - owner: 10
  - developer: 10
  - admin: 9
  - staff: 4
  - tech_assist: 3

## Not Executed

The following checklist areas require source-data import or product code changes and were not executed in this local schema run:

- Mapping the real ConversaFlow business to one of the real Cash tenants.
- Importing real Cash, ConversaFlow, KDS, or public compatibility rows.
- Dashboard API and UI tenant switching changes.
- Logical replication, CDC, or production cutover.
- Supabase Edge Function replacement.

## Decision Basis

Documented fact:

- PostgreSQL local schema recreation passed from scratch.
- RLS-compatible tenant access worked with local session settings.

Source-backed tradeoff:

- Contact identities now support non-blocking phone verification while still allowing a future uniqueness guarantee for verified normalized identities.
- Old jobs/outbox rows have a replay staging surface instead of direct import into live claimable queues.

Umi-specific inference:

- This local execution is a safe foundation for the next step: real source-data mapping and Dashboard tenant switching.
