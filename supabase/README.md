# Database authority

`supabase/migrations/` is the only editable migration authority for UMI.

- Migrations are forward-only and ordered by their timestamp prefix.
- UMI API is the only business write boundary.
- Browser and KDS clients receive no service-role credential and do not write
  authoritative tables directly.
- `docs/migration/` contains validation, backfill, and historical evidence. It
  is not a second migration source.
- Application-local Prisma migrations are historical only. Do not run
  `prisma migrate` or `prisma db push` against UMI databases.

The request API role is RLS-confined. The worker role has `BYPASSRLS` only for
bounded background and authentication work with explicit tenant predicates.
