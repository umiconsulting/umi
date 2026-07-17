# Preview database

The database Vercel preview deployments talk to. Supabase project
`rrkzhisnadfrgnhntkiz` — schema-identical to the live platform DB
(`xbudknbimkgjjgohnjgp`), with **synthetic data only**.

Previews had pointed at this project since it was `umi-cash`'s production DB. After the
June cutover moved production to the platform project, this one was left paused, holding
the pre-cutover schema — so previews had no working database for months and nothing that
touched data could be tested on one. It now serves that purpose deliberately.

## Rebuilding it

Order matters. `002_schema.sql` grants to `umi_app` / `umi_worker` / `umi_readonly` on
almost every table; without `001_roles.sql` first, each of those ~270 grants fails.

```bash
psql "$PREVIEW_DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$PREVIEW_DATABASE_URL" -f db/preview/001_roles.sql
psql "$PREVIEW_DATABASE_URL" -f db/preview/002_schema.sql
cd apps/umi-cash && DATABASE_URL="$PREVIEW_DATABASE_URL" npm run db:seed
```

The seed (`apps/umi-cash/prisma/seed.ts`) creates three tenants — `kalalacafe`,
`elgranribera`, `nectarcafe` — each with an admin, a staff login and a demo card. Real
slugs so preview routes match production; invented people so nothing here is a customer.

## Why a dump and not `docs/migration/local-postgres/*.sql`

Those scripts are the hand-written record of what we meant to build. These two files are
`pg_dump` of what is actually running. For a database whose whole job is to be identical
to production, only the second kind can promise that — anything the live schema picked up
outside those scripts is in here, and drift between the two cannot hide.

That cuts both ways: this is a **snapshot**, not a migration history. It says nothing
about how the schema got here and cannot be replayed incrementally. `local-postgres/`
remains the place where schema changes are authored.

## Refreshing after a schema change

Both files are regenerated from live, never hand-edited:

```bash
cd apps/umi-cash                       # where the Supabase CLI is linked to the platform project
supabase db dump --linked --role-only -f ../../db/preview/001_roles.sql
supabase db dump --linked -f ../../db/preview/002_schema.sql
```

Neither carries secrets — the role dump has no passwords, and the schema dump has no
rows. Both are verified on the way in; keep it that way.

## Connecting

`DATABASE_URL` / `DIRECT_DATABASE_URL` are set on Vercel for Preview and Development, and
`PREVIEW_DATABASE_URL` in a local `.env.local` for psql. `DATABASE_URL` must be the
**transaction** pooler (`:6543`, `?pgbouncer=true`) — serverless opens far more connections
than session mode (`:5432`) survives. `:5432` is for `DIRECT_DATABASE_URL` only.

## What lives here vs. production

Only production is `xbudknbimkgjjgohnjgp`. Anything pointing at `rrkz...` is talking to
this database, whatever the variable is called — it will connect happily and be wrong.
