# Phase 3 Execution — Shared Foundations (2026-06-10)

Program driver: `docs/migration/2026-06-09-workspace-integration-implementation-plan.md`.
Wrapped checklist: `docs/migration/2026-05-23-api-backend-centralization-execution-checklist.md`.

## Research Check

Question decided: staging database shape and Dashboard backend deployment shape.

Primary sources checked:

- Supabase official docs: database branching (`https://supabase.com/docs/guides/deployment/branching`) and CLI migration workflow (`https://supabase.com/docs/guides/deployment/database-migrations`).
- Vercel official docs: Express on Vercel (`https://vercel.com/docs/frameworks/backend/express`) and environment variables (`https://vercel.com/docs/environment-variables`).

Documented facts:

- Supabase supports isolated branching/preview-style database environments, but this workspace currently has only the production Umi Platform and legacy Cash projects linked.
- Vercel can route an Express app through a Node function and supports environment-scoped variables.

Source-backed tradeoff:

- A remote Supabase staging branch/project is the production-like target, but creating one is an external infrastructure action. The plan also allows standalone PostgreSQL, so Phase 3 used a disposable local PostgreSQL staging rehearsal and recorded the remote project gap separately.
- Co-locating Dashboard API routes with the Dashboard app on Vercel is simpler than adding a new backend service before the platform schema cutover proves it is necessary.

Umi-specific inference:

- At current scale, a standalone PostgreSQL staging rehearsal is enough to test script replay, validation, Dashboard tenant contracts, and deployability configuration. It is not enough to close the non-local reachability gate.

Invalidation criteria:

- If a second tenant must onboard before Phase 4, create a real Supabase staging/preview project and rerun this validation there before cutting traffic.
- If Dashboard read paths exceed Vercel function constraints, reopen the deployment shape and consider a dedicated Node service.

## S3.1 Staging 7-Schema Database

Target used: `umi_platform_staging_phase3_20260610` on local PostgreSQL 18, port 5233.

Applied:

- `001_platform_core.sql` through `007_legacy_migration_core.sql`
- `010_seed_product_matrix.sql`
- `020_local_source_fdw.sql` streamed with local FDW port adjusted from 5432 to 5233
- `030_platform_identity_backfill.sql` through `044_observability_history_backfill.sql`
- Phase 4F public-compat no-import archive: 78 rows recorded as `archived_only`

Replay defects found and fixed:

- `010_seed_product_matrix.sql` seeded placeholder `kalalacafe`, then `030_platform_identity_backfill.sql` imported the real Cash tenant with the same slug. Fix: `010` now seeds only synthetic demo tenants and lets `030` own production-imported tenants.
- Local owner membership was created before imported Kalala existed. Fix: `030` now grants `local-owner-1` `super_admin` access to imported Kalala after roles are created.

Validation:

- Output: `docs/migration/audit-output/2026-06-10-phase-3-staging-validation.txt`
- Blocking findings: 0
- Non-blocking finding retained: 1 unverified duplicate phone candidate, same policy class as Phase 1.
- Phase 4F public-only rows imported into production-facing tables: 0

Row-count artifacts:

- Staging counts: `docs/migration/audit-output/2026-06-10-phase-3-umi_platform_staging_phase3_20260610-row-counts.csv`
- Phase 1 transition counts: `docs/migration/audit-output/2026-06-10-phase-3-umi_platform_transition_exec_v2_20260515-row-counts.csv`
- Diff: `docs/migration/audit-output/2026-06-10-phase-3-row-count-diff.csv`

Count-diff decision:

- Staging is not byte-for-byte equal to the older local transition DB.
- The main production-facing delta is five clearly synthetic `+1555` conversation families: staging excludes them from `conversaflow.*` and keeps them in evaluation/audit surfaces, which is consistent with the Phase 4F/S4.5 policy direction.
- Local-only Dashboard/KDS fixtures in the old transition DB (`dashboard_compat`, pairing requests, device sessions) are not part of the production schema replay target.

## S3.2 Dashboard Backend Deployability

Chosen shape: Vite static frontend plus Express API exposed as Vercel Functions.

Implemented:

- `apps/umi-dashboard/api/index.js` exports the Express app for Vercel.
- `apps/umi-dashboard/server.js` now exports `app`/`prisma` and only calls `listen()` outside Vercel/serverless import mode.
- `apps/umi-dashboard/vercel.json` maps `/api/*` to the API function and all other routes to the Vite SPA.
- `apps/umi-dashboard/.env.example` documents platform-transition and deployed-origin variables.
- `apps/umi-dashboard/docs/deployment.md` records required Vercel environment variables and checks.

Checks:

- `npm run api:check` passed.
- `npm run build` passed.

Open external gate:

- `npx vercel` is authenticated as `juanclpzq`, but no Vercel project exists under the available team/account.
- No remote staging database secret is configured.
- Therefore non-local preview reachability is not closed in this run.

## S3.3 Tenant/Capability API

Existing endpoints validated against staging:

- `GET /api/health`
- `GET /api/me/tenants`
- `GET /api/tenants/:id/capabilities`

Evidence:

- API ran locally against `umi_platform_staging_phase3_20260610` on port 4213.
- `GET /api/health` returned `{"ok":true,...}`.
- `GET /api/me/tenants` with `X-UMI-User-ID` returned `cash-only-cafe`, `full-stack-cafe`, and `kalalacafe`.
- Kalala capabilities returned Dashboard, ConversaFlow, and KDS active; Cash and Observability missing; two active Kalala locations.

## Three-Lens Review

Customer lens:

- Tenant owner can resolve tenant membership and Kalala capability state from the Dashboard API.
- Synthetic conversation families are kept out of production-facing `conversaflow.*` in staging, reducing the chance that fake customer history appears in owner/customer views.

Company/brand lens:

- GitHub and docs standardization from Phase 2 now carries into a reproducible database/deploy evidence trail.
- Dashboard deployability is materially closer, but no public owner-facing preview should be promised until a real Vercel project and staging database secrets exist.

Code lens:

- Staging replay passes core validation with zero blocking findings.
- Dashboard API syntax and build checks pass.
- The non-local deployment reachability gate remains open.

## Status

- S3.1: executed as standalone PostgreSQL staging rehearsal; validation passed with documented intentional count deltas.
- S3.2: deployability config/build complete; external Vercel preview reachability blocked by missing project and staging secrets.
- S3.3: tenant/capability API validated against staging.
