# Database & migrations

`umi-api` uses **raw SQL via `pg`** — no ORM (spec §9, D8). This folder holds
schema migrations.

## Where the schema lives now

The platform database is the consolidated Supabase Postgres project
(`xbudknbimkgjjgohnjgp`) using the **canonical** domain schemas:

```
core  ops  comms  loyalty  device  kitchen  queue  observability  grow
```

(See `docs/architecture/platform-database-architecture.md` — source of truth —
and `docs/architecture/2026-06-16-canonical-schema-and-identity.md`.)

## Migration mechanism

- **Now (DB on Supabase):** schema changes go through the existing **Supabase
  migrations** + the canonical `docs/migration/local-postgres/*.sql` scripts.
  `umi-api` ships **no ORM migrate**.
- **Later (DB lifted onto PostgreSQL on the VPS):** migrations become a
  **Sqitch** plan of hand-written PostgreSQL SQL under `migrations/`.

Application queries are raw SQL throughout, so moving the database off Supabase
changes only the migration tool — not the data-access code.

## Connection roles (spec §11.2)

- `umi_app` — RLS request role (web). Per-request `SET LOCAL app.tenant_id/user_id`.
- `umi_worker` — BYPASSRLS service role (worker; owns `queue`/`observability`/`grow`).
- `umi_readonly` — analytics.
