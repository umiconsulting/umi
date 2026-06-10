# Latest Reports

This file is the default report entrypoint for agents. Load individual reports only after checking this index.

## Workspace

- **Active program driver (2026-06-09):** `docs/migration/2026-06-09-workspace-integration-implementation-plan.md` — 7-phase implementation plan from the integration audit, with per-step three-lens validation and skill-lifecycle checkpoints; wraps the 2026-05-23 execution checklist.
- Current workspace integration audit (2026-06-09): `docs/reports/workspace-integration-audit.md` — full-state audit, debt register, integration scores, and consolidation roadmap.
- Current operating model: `docs/architecture/agent-operating-system.md`.
- Current GitHub push matrix: `docs/governance/github-push-matrix.md`.
- Current restructuring direction: Model B federated cognitive workspace with a future path to Model C agent runtime mesh.
- Historical PostgreSQL-first platform integration plan (superseded as driver by the 2026-06-09 implementation plan): `docs/migration/2026-05-14-postgresql-platform-integration-plan.md`.
- Historical April platform cutover state: `docs/migration/2026-04-15-supabase-multischema-state.md` and `docs/migration/2026-04-15-umi-platform-cutover-plan.md`.

## ConversaFlow

- Current mini-harness/signoff evidence lives in `apps/umi-conversaflow/reports/mini-harness-signoff/signoff-review.md`.
- Historical ConversaFlow audits under root `docs/architecture/` and repo `docs/` should be treated as historical unless they explicitly say current.

## KDS

- Current local KDS architecture context lives in `apps/umi-kds/Sources/Docs/KDSArchitecture.md`.
- Root KDS audit and migration docs are useful background, but should be checked against current code and migrations.

## Cash

- No current root report is indexed. Use local repo context, Prisma schema, package scripts, and Vercel config first.

## Logs

- No current root report is indexed. Use local repo context and trace parser/runtime files first.

## Dashboard

- Current tenant/membership/branch implementation plan: `docs/migration/2026-05-17-dashboard-tenant-membership-implementation-plan.md`.
- Current customer/conversations/embedding insights plan: `docs/migration/2026-05-24-dashboard-customer-conversations-plan.md`.
- Treat the live dashboard UI files as the behavior reference and check `apps/umi-dashboard/docs/audit-connectivity.md` for current data wiring.
