# Umi Platform Cutover Plan — 2026-04-15

## Objective

Move the shared Supabase project into the UMI platform role without destroying existing production data.

Target state:

- project display name: `Umi Platform`
- schema ownership:
  - `conversaflow` — conversation, order, workflow runtime
  - `kds` — kitchen projections/read models
  - `umi_cash` — loyalty/wallet runtime
  - `platform` — future master data
- `public` remains as a temporary compatibility surface until manual cleanup

## Execution sequence

1. ~~Rename the Supabase project display name to `Umi Platform`~~ **done**
2. ~~Copy current live ConversaFlow `public` tables into `conversaflow`~~ **done** — 21 tables, row counts verified
3. ~~Mirror required RLS/grants for authenticated dashboard reads~~ **done**
4. Point shared ConversaFlow clients at `conversaflow` — **done** (`DB_SCHEMA=conversaflow` in env; `_shared/supabase.ts` reads `DB_SCHEMA` with `'conversaflow'` fallback; legacy `SUPABASE_DB_SCHEMA` still accepted locally only)
5. Point `umi-cash` at `umi_cash` — **done** (`DATABASE_URL` with `schema=umi_cash` on Umi Platform; `next build` passes)
6. Run validation builds/tests — **done** (umi-cash build ✅, schema row counts verified ✅, critical edge functions healthy ✅)
7. Defer destructive cleanup of `public` to a separate manual operation after verification

## Safety constraints

- no destructive changes to live `public` tables in this pass
- all copies are additive
- row counts must be checked before and after copy
- `public.transactions` count is the minimum preservation sentinel
- browser/dashboard access must still work after schema cutover

## ConversaFlow cutover method

Use `conversaflow` as the PostgREST/runtime schema.

Implementation details:

- clone table structure under `conversaflow`
- copy data from `public`
- add foreign keys for integrity
- enable RLS
- recreate the existing public select policies in `conversaflow`
- grant schema/table access for `authenticated` and `service_role`
- change shared clients to default to `conversaflow`

## umi-cash cutover method

`umi_cash` is already bootstrapped and imported on Umi Platform.

Remaining alignment:

- ~~create `OtpVerification` table in `umi_cash`~~ **done**
- ~~full data re-sync from live project — all 11 tables match live row counts~~ **done**
- ensure Prisma URLs point to `schema=umi_cash` on Umi Platform
- ~~confirm app build still passes with the shared database config~~ **done** (`next build` ✅)
- deprecate the separate `umi-cash` Supabase project (`rrkzhisnadfrgnhntkiz`) after cutover — **deferred (manual step)**

## Validation gates

- schema exists: `conversaflow`, `kds`, `umi_cash`, `platform`
- row counts in `conversaflow` match source `public`
- `public.transactions` unchanged from source baseline
- `umi_cash` row counts match live umi-cash baseline ✅
- `umi-cash` build passes ✅ (`next build` clean, 14 static + 37 dynamic routes)
- ConversaFlow backend client initialization still compiles/tests where available ✅ (whatsapp-handler, job-worker ACTIVE; `slack-actions` removed in favor of KDS `apps/umi-kds`, no errors in logs)
- `embed-backfill` 500s were pre-existing Voyage configuration/runtime issues at the time of the cutover investigation — not migration-related

## Cleanup deferred to manual step

After validation and a stable soak period, manual cleanup may remove or archive duplicated `public` tables.
That deletion is intentionally out of scope for this pass.
