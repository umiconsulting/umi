# Gate 1A authority decision

Status: accepted, 2026-07-25.

## Decision

- `supabase/migrations/` is the sole migration authority.
- Supabase PostgreSQL is the sole data authority.
- `umi-api` is the sole business read/write and authentication boundary.
- Dashboard and KDS use UMI API routes only. They receive no Supabase key.
- API requests carry tenant context and an optional validated branch context.
- PostgreSQL RLS is forced and fails closed when tenant context is absent.
- A selected branch narrows every branch-bearing authoritative fact.
- The worker database role remains a bounded service boundary. It may bypass
  RLS only for background/authentication work with explicit tenant predicates.

## Superseded authorities

- SQL under `docs/migration/build-v3/` is historical or validation material.
- Application-local Prisma migrate/push/seed commands are not migration
  authorities.
- Supabase browser authentication and KDS edge-function defaults are removed.

No POS, catalog, checkout, payment, inventory, refund, receipt, or KDS business
functionality is introduced by this decision.
