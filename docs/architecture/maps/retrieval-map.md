# Retrieval Map

This file defines how agents should load Umi context without turning the workspace into one giant prompt.

## Default loading order

1. Root `AGENTS.md`.
2. `WORKSPACE.md`.
3. `docs/architecture/agent-operating-system.md`.
4. `docs/architecture/maps/workspace-map.md`.
5. This file.
6. The owning app's `AGENTS.md`, if present.
7. The owning app's `REPO_CONTEXT.md`, if present.
8. Task-specific code, schema, tests, evals, diagnostics, or reports.

## Route by task

- Backend, jobs, prompts, traces, WhatsApp, outbox, passes, projections, and business writes: `apps/umi-api`.
- UmiPOS client, checkout, device hardware, offline replay, and shifts: `apps/umi-pos`.
- Native iPad KDS UI, Swift client behavior, KDS board interactions: `apps/umi-kds`.
- Cash compatibility site, Prisma behavior, and Cash Vercel jobs: `apps/umi-cash`.
- Owner dashboard live-data UI behavior: `apps/umi-dashboard`.
- Public marketing pages and lead capture: `apps/umi-landing-page`.
- Shared API and UmiPOS contract changes: `packages/contract` and both consumers.
- Cross-product ownership, retrieval policy, governance, report/eval indexing: root docs.

## Authority classes

- High authority: runtime code, migrations, schemas, tests/evals, `AGENTS.md`, active ADRs, `REPO_CONTEXT.md`.
- Medium authority: current runbooks, current reports, diagnostic READMEs, deployment notes.
- Low authority: old audits, superseded prompts, exploratory reports, default scaffolding READMEs, unlinked notes.
- Historical only: dated reports that are superseded by a newer report or explicitly marked historical.

## Default exclusions

Do not load these by default:

- `node_modules/`, build outputs, derived data, coverage, `.next/`, `.vercel/`.
- Generated types, generated bundles, trace exports, screenshots, binary assets, and lockfiles unless directly relevant.
- Local secrets and settings: `.env*`, `.mcp.json`, `.claude/settings.local.json`, cert/key files.
- Old reports unless `docs/reports/latest.md` or a repo report index points to them.

## Summarize before loading

Summarize these before reading deeply:

- Long architecture reports.
- Historical audits.
- Large SQL migrations.
- Trace dumps and log exports.
- Generated or copied prompt transcripts.

## Retrieval principle

Use bounded progressive disclosure: load the minimum authoritative context that can answer the task, then expand only along explicit ownership and runtime paths.
