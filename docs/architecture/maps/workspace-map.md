# Workspace Map

This map routes work to the narrowest current owner. It is a retrieval aid, not a replacement for code, migrations, tests, or local contracts.

## Root

- Purpose: workspace governance, architecture, migration planning, retrieval policy, report indexes, eval indexes, memory policy, and agent operating-system design.
- High-authority entrypoints: `AGENTS.md`, `WORKSPACE.md`, `docs/README.md`, `docs/architecture/agent-operating-system.md`, `docs/governance/authority.md`.
- Do not put product runtime logic here.

## `apps/umi-conversaflow`

- Purpose: shared Supabase edge/backend logic, workflow jobs, queue/outbox, prompts, memory, traces, KDS backend contracts, schema migrations, and cross-channel normalization.
- Runtime surfaces: `supabase/functions/`, `supabase/migrations/`, `sql/`, `scripts/diagnostics/`, runtime prompt files.
- Schemas: owns operational `conversaflow`; owns schema-qualified migrations that create/update `kds` projections when the backend write model is the source.
- Load first: `AGENTS.md`, `REPO_CONTEXT.md`, `supabase/functions/job-worker/processors/index.ts`, relevant migrations.

## `apps/umi-kds`

- Purpose: native SwiftUI iPad KDS client.
- Runtime surfaces: `Sources/`, KDS API client, repository state, SwiftUI views, local app docs.
- Schemas: consumes `kds` projections; does not own operational order truth.
- Load first: `AGENTS.md`, `REPO_CONTEXT.md`, `Sources/Docs/KDSArchitecture.md`, relevant Swift source.

## `apps/umi-cash`

- Purpose: loyalty, wallet, passes, tenant/user/session behavior, Vercel cron behavior, and Cash-specific Prisma schema.
- Runtime surfaces: `src/`, `prisma/`, `passes/`, `vercel.json`.
- Schemas: owns Cash Prisma schema and loyalty/wallet tables.
- Load first: `AGENTS.md`, `REPO_CONTEXT.md`, `package.json`, `prisma/schema.prisma`.

## `apps/umi-logs`

- Purpose: operational logs, trace browsing, and observability UI for ConversaFlow.
- Runtime surfaces: Next.js app, Supabase trace client, trace parsers, trace types.
- Schemas: consumes ConversaFlow logs/traces using configured service credentials; does not own the underlying trace tables.
- Load first: `AGENTS.md`, `REPO_CONTEXT.md`, `lib/supabase.ts`, `lib/parsers/traceAssembler.ts`, `types/trace.ts`.

## `apps/umi-dashboard`

- Purpose: Umi owner dashboard app shell with live product data.
- Runtime surfaces: dashboard server/API, `src/` screens, shell, styles, icons, and legacy `Umi Dash.html` reference shell.
- Behavior contract: preserve the visible functions and flows when hardening the production app.
- Load first: `AGENTS.md`, `REPO_CONTEXT.md`, `Umi Dash.html`, `src/app.jsx`, `src/shell.jsx`, relevant screen file.
