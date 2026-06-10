# Routing Ledger

Record current cross-workspace traces here before proposing new reusable artifacts.

## Entry template

```md
### <date> - <task label>
- task type:
- request summary:
- filesystem slice inspected:
- chosen owner:
- chosen path:
- skill or subagent used:
- files touched:
- tools used:
- outcome:
- reusable pattern observed:
- promotion follow-up:
```

## Current entries

### 2026-06-09 - Workspace integration implementation plan + skill-seeds ledger
- task type: cross-workspace program planning + agent-operating-system extension
- request summary: turn the 2026-06-09 integration audit into a step-by-step implementation plan with per-step three-lens (customer / company-brand / code) scientific-research iteration, wire the routing ledger into a continuous promote-or-seed loop, and create a dedicated observation ledger for potential future skills
- filesystem slice inspected: audit report, root `AGENTS.md`, both task-router skill trees (`.claude` + `.agents`), `scientific-research-check` skill, `docs/migration/2026-05-23-api-backend-centralization-execution-checklist.md`, `docs/migration/` inventory, `docs/reports/latest.md`
- chosen owner: root `docs/migration` for the program plan; root `.claude/skills/task-router/` (mirrored to `.agents/`) for ledger artifacts
- chosen path: direct execution inline; no subagent
- skill or subagent used: `task-router`, `scientific-research-check` (protocol embedded per plan step)
- files touched: `docs/migration/2026-06-09-workspace-integration-implementation-plan.md` (new), `.claude/skills/task-router/skill-seeds.md` (new) + `.agents` mirror, both task-router `SKILL.md` files (seed step added to decision order), both routing ledgers, `docs/reports/latest.md`
- tools used: file reads, directory listing, patch edits, mirror copy
- outcome: 7-phase plan active as the program driver, wrapping the 05-23 checklist; every step carries a customer/brand/code lens with named evidence; 8 seeds planted with explicit promotion gates and prune expectations
- reusable pattern observed: plan steps that name who the "customer" is per surface (diner vs tenant-owner vs prospect) produce concrete validation evidence instead of generic QA; candidate seeded as `three-lens-release-review`
- promotion follow-up: none yet — `adapter-sync-check` is near-promotable but blocked on the canonical-layer decision (plan S1.5); review at the Phase 1 checkpoint

### 2026-06-09 - Workspace deep integration audit
- task type: workspace-wide architectural audit + report
- request summary: full audit of the Umi workspace (docs, agent layers, all six app repos, migration state) producing an integration-readiness report and consolidation roadmap
- filesystem slice inspected: root contracts/governance/maps, all `docs/migration` and dated architecture docs, root and per-repo `.claude`/`.agents`/`.cursor` layers, each app's structure/manifests/git state, `artifacts/`, `backups/`, `prod-db-handoff-2026-05-13/`
- chosen owner: root `docs/reports`
- chosen path: direct execution inline; no subagent
- skill or subagent used: `task-router`
- files touched: `docs/reports/workspace-integration-audit.md` (new), `docs/reports/latest.md`, both task-router routing ledgers
- tools used: file reads, repo listing, git inspection, diff comparison of adapter layers
- outcome: report delivered with debt register (5 critical items), integration/monorepo/backend scores, and 7-phase roadmap; key findings: root workspace unversioned, migration parked at Phase 4F since 2026-05-28, `.claude` vs `.agents` skill-layer drift, Cash triple data surface
- reusable pattern observed: routing ledgers and adapter registries themselves drift; ledger entries should be written to the neutral source and mirrored, not written per-adapter
- promotion follow-up: none

### 2026-05-21 - Umi landing product-suite repositioning
- task type: product frontend redesign + brand/message repositioning
- request summary: transform Umi landing from data-consulting positioning into a product-suite landing faithful to ConversaFlow, KDS, Cash, Dashboard, Logs, and the original corporate manual
- filesystem slice inspected: root workspace docs, routing maps, `apps/umi-landing-page-1`, legacy `apps/umi-landing-page`, manual corporativo PDF, product repo contexts for ConversaFlow, KDS, Cash, Dashboard, and Logs
- chosen owner: `apps/umi-landing-page-1`
- chosen path: direct implementation in the functional Next landing app, preserving contact and diagnostic routes
- skill or subagent used: `task-router`, `workspace-boundary-check`, `frontend-design`
- files touched: landing page sections/components, diagnostic copy and scoring, contact route templates, email templates, layout metadata, global styles
- tools used: repo search, PDF text extraction, source-backed UX research, patch edits, Next build, Jest, Brave DevTools visual checks
- outcome: landing now presents Umi as a connected restaurant operations suite with responsive product mockups and product-aligned diagnostic/contact flows
- reusable pattern observed: when brand positioning changes but a functional landing shell already exists, preserve the app/runtime owner and replace message/visual system in place
- promotion follow-up: none

### 2026-05-21 - Landing page redesign transplant
- task type: product frontend redesign + backend form wiring
- request summary: adapt `apps/umi-landing-page-1` to the newer `apps/umi-landing-page` design while keeping the older app functional and connected to backend routes
- filesystem slice inspected: root workspace routing docs, `apps/umi-landing-page`, `apps/umi-landing-page-1`, Next app routes, landing components, diagnostic API, email sequence integration
- chosen owner: `apps/umi-landing-page-1`
- chosen path: direct implementation in the functional Next app, using the newer landing design as source material
- skill or subagent used: `task-router`, `workspace-boundary-check`, `frontend-design`
- files touched: `apps/umi-landing-page-1/src/app/**`, landing page components, diagnostic backend route, email sequence integration, Next config, Tailwind config
- tools used: repo search, patch edits, npm install for local dependencies, Next build, Jest, Brave DevTools browser check
- outcome: redesigned landing page renders in the functional app; contact form remains wired to `/api/contact`; diagnostic quiz now posts the API-compatible shape to `/api/diagnostic`; email sequence tests pass
- reusable pattern observed: when a redesign artifact has no backend/runtime shell, transplant it into the existing functional product app rather than moving API ownership
- promotion follow-up: none

### 2026-05-14 - PostgreSQL platform local schema execution
- task type: workspace-wide migration execution + local database validation
- request summary: execute `docs/migration/2026-05-14-postgresql-platform-integration-plan.md`
- filesystem slice inspected: root `AGENTS.md`, `WORKSPACE.md`, architecture maps, governance ownership docs, migration docs, each app `AGENTS.md` / `REPO_CONTEXT.md`, relevant schemas and route surfaces
- chosen owner: root `docs/migration` for local platform draft; future runtime migrations route to owning product repos
- chosen path: direct local SQL draft and validation
- skill or subagent used: `task-router`, `workspace-boundary-check`, `scientific-research-check`
- files touched:
  - `docs/migration/local-postgres/001_platform_core.sql`
  - `docs/migration/local-postgres/002_commerce_core.sql`
  - `docs/migration/local-postgres/003_cash_core.sql`
  - `docs/migration/local-postgres/004_conversaflow_core.sql`
  - `docs/migration/local-postgres/005_kds_core.sql`
  - `docs/migration/local-postgres/006_observability_core.sql`
  - `docs/migration/local-postgres/010_seed_product_matrix.sql`
  - `docs/migration/local-postgres/README.md`
  - `docs/migration/audit-output/2026-05-14-platform-local-execution.md`
  - `docs/migration/audit-output/local-platform-schema.sql`
  - `.claude/skills/task-router/routing-ledger.md`
- tools used: repo search, PostgreSQL 18 local server, psql, pg_dump, patch edits
- outcome: local schema applied to `umi_platform_local`; product capability and tenant-scope validation passed; current production DB audit blocked because `UMI_CURRENT_DATABASE_URL` was unset
- reusable pattern observed: root migration plans can produce local-only SQL drafts under root docs while runtime cutover remains product-owned
- promotion follow-up: none

### 2026-05-14 - Supabase production dump local restore and translation inventory
- task type: local production dump restore + migration planning
- request summary: decrypt the local Supabase dump, restore it locally, and start planning translation into the PostgreSQL platform model
- filesystem slice inspected: root dump handoff directory, Desktop passphrase path by filename only, root migration audit output, local PostgreSQL server state
- chosen owner: root `docs/migration/audit-output` for inventory and planning; future import SQL should remain local-only until validated
- chosen path: direct local restore into `umi_supabase_dump_local`
- skill or subagent used: `workspace-boundary-check`, `scientific-research-check`
- files touched:
  - `docs/migration/audit-output/supabase-local-schema.sql`
  - `docs/migration/audit-output/supabase-local-tables.csv`
  - `docs/migration/audit-output/supabase-local-columns.csv`
  - `docs/migration/audit-output/supabase-local-foreign-keys.csv`
  - `docs/migration/audit-output/supabase-local-row-counts.csv`
  - `docs/migration/audit-output/2026-05-14-supabase-dump-local-restore-and-translation.md`
  - `.claude/skills/task-router/routing-ledger.md`
- tools used: OpenSSL, tar, Homebrew PostgreSQL 18, pgvector, pg_restore, psql, pg_dump
- outcome: encrypted dump restored locally with application schemas/data; remaining restore gaps are unavailable hosted Supabase extensions (`pg_cron`, `pg_net`, `supabase_vault`); no decrypted dump was left under docs
- reusable pattern observed: keep decrypted data in `/tmp`, commit only schema/count inventories, and separate local restore fidelity from canonical platform translation planning
- promotion follow-up: none

### 2026-05-11 - ConversaFlow canonical mini-harness cleanup
- task type: architecture cleanup + forward implementation planning
- request summary: remove obsolete architecture documentation and make the branch point to a single clean mini-harness direction with customer memory, deep tools, minimal state, and extensive testing
- filesystem slice inspected: `platform/conversaflow/docs/**`, `apps/umi-conversaflow/*.md`, `apps/umi-conversaflow/reports/**`, root routing docs
- chosen owner: `apps/umi-conversaflow` for implementation; `platform/conversaflow/docs/architecture/reviews/` for canonical architecture docs
- chosen path: direct documentation cleanup and replacement
- skill or subagent used: `task-router`, `workspace-boundary-check`, `scientific-research-check` procedure applied manually
- files touched:
  - `platform/conversaflow/docs/architecture/reviews/mini-harness-architecture.md` (new canonical architecture)
  - `platform/conversaflow/docs/architecture/reviews/mini-harness-implementation-plan.md`
  - `platform/conversaflow/docs/README.md`
  - `platform/conversaflow/docs/architecture/ARCHITECTURE_TARGET.md`
  - removed obsolete review docs, runbooks, baseline docs, and stale generated reports
  - `.claude/skills/task-router/routing-ledger.md`
- tools used: repo search, patch edits
- outcome: branch documentation now points to one forward architecture: a mini harness with deep backend tools, first-class customer memory, backend-owned operational truth, minimal resumable state, and an extensive test campaign
- reusable pattern observed: when replacing an overgrown architecture, keep only the canonical forward path in docs; historical reports belong outside the active branch if they keep steering implementation back to discarded patterns
- promotion follow-up: none
