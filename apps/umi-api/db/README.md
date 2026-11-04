# Database & roles

`umi-api` uses raw SQL via `pg` without an ORM.

## Canonical schema and migrations

- Base PostgreSQL schema definitions live in root `db/`.
- Forward PostgreSQL migrations live in root `db/migrations/`.
- Connection role provisioning scripts live in `apps/umi-api/db/roles/004_login_roles.sql`.

## Connection roles

- `api_login` (member of `api`) — RLS-confined request role.
- `worker_login` (member of `worker`) — `BYPASSRLS` background worker role.
- `readonly` — read-only analytics role.
