# umi-logs — RESERVED SLOT (app deleted 2026-07-02)

The previous `umi-logs` implementation was **deleted**, not refactored. It was an internal
observability viewer that had drifted into three liabilities:

1. It queried Supabase **directly from the shipped app** using `SUPABASE_SERVICE_ROLE_KEY`
   (RLS bypass) and a `SUPABASE_MANAGEMENT_TOKEN` (project-admin) — both strictly server-only
   secrets.
2. It read the **dead `conversaflow` schema** and legacy tables (`inbound_events`, `jobs`,
   `outbox`, `dashboard_users`) that were superseded by the canonical schema and removed when
   the conversaflow backend was deleted (PR #17).
3. It bypassed `umi-api` entirely, violating the "only umi-api owns data and secrets" boundary.

Deleting the app was the cleanest security remediation (it removes the credential surface
outright). This directory is kept as a **reserved slot** so a future rebuild has a home and a spec.

> **Ops follow-up (not code):** if the deleted app's `service_role` key or Management token were
> ever real values in a live deployment, **deprovision that deployment and rotate both tokens.**

## Ideal future observability tool (build to this, not the old one)

- **Audience:** internal Umi staff only — traces, invocations, token accounting, queue/outbox
  health. Never a tenant surface. Access-gated (super-admin / SSO), on its own subdomain.
- **Data access:** **no direct DB from the browser, ever.** Read _only_ through **umi-api
  observability endpoints** (a `modules/observability` surface / `TraceService` rebind) against
  the **canonical schema** (`observability.*`, `queue.*`, `comms.*`). No `service_role`, no
  Management token in the app — it is a typed client of umi-api like every other frontend.
- **Structure:** the shared monorepo blueprint — `src/{app,components,lib}`, `@/* → ./src/*`,
  consumes `packages/{contract,tokens,eslint-config,tsconfig}`, Model-B file naming.

Full rationale + the whole-monorepo boundary audit:
[`docs/architecture/2026-07-02-monorepo-standardization-blueprint.md`](../../docs/architecture/2026-07-02-monorepo-standardization-blueprint.md) (§9.3).
