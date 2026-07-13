# Routing Ledger

Record successful and failed cross-workspace traces here before proposing new reusable artifacts.

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

### 2026-07-02 - repository-cartographer skill authored (deterministic architecture mapper)
- task type: root workspace skill authoring (new reusable procedure + bundled engine)
- request summary: build a "Repository Cartographer" that maps a codebase as a factual metadata graph (PostgreSQL system-catalog analogy) across 7 layers, deterministic-first with embeddings only to narrate; back every claim with research; review/critique/fix each phase (ultracode)
- filesystem slice inspected: whole repo for grounding (`apps/*`, `apps/umi-api/src/**`, `docs/migration/build/*.sql`, both `schema.prisma`, `apps/umi-kds` Swift, `apps/umi-conversaflow/supabase/functions`); existing skill conventions (`.agents/skills/*`, `AGENTS.md`, `adapter-sync-check`)
- chosen owner: root `.agents/skills/repository-cartographer/` (canonical); `.claude/skills/` generated mirror
- chosen path: direct authorship + right-sized subagent fan-out (ultracode) for research and adversarial review
- skill or subagent used: `scientific-research-check` (4-agent primary-source research + skeptic audit), `skill-creator` (installed this session), `task-router`, `adapter-sync-check`; 3-agent engine review + 1 doc reviewer
- files touched: `.agents/skills/repository-cartographer/**` (SKILL.md, scripts/{cartograph.mjs, lib/*.mjs, adapters/nestjs.mjs}, references/*.md, agents/openai.yaml); `.agents/skills/task-router/{registry,skill-seeds,routing-ledger}.md`; generated `.claude` mirror
- tools used: Node + TypeScript Compiler API (zero-install), Workflow (2 research/review workflows), Agent (Explore + reviewers), Bash (engine runs against the live repo + synthetic graphs)
- outcome: zero-install engine validated against ground truth (21 NestJS modules, 0 forwardRef, 111/32 cascade/set-null, loyalty.cards aggregate root owning its ledger, 3 append-only ledgers) + synthetic Tarjan/Johnson check; Phase-1 research audited (2 clusters), Phase-2 engine adversarially reviewed (18 findings, all fixed), Phase-3 docs reviewed (8 drift items, all fixed); full report renders 9 sections in ~0.8s
- reusable pattern observed: deterministic-first repo cartography (AST+SQL+FK ownership+Tarjan/Johnson+DDD context-map) is a general, reusable capability; edge-kind classification (type/test/dynamic) must precede any cycle verdict, and dumps/migration-history SQL must be segregated from authoritative DDL to avoid conflating schema generations
- promotion follow-up: promoted on authorship (see skill-seeds.md); exercise on future onboarding/architecture-review tasks; extend language adapters per references/language-adapters.md

### 2026-06-10 - Phase 5 monorepo migration: S5.1 executed, S5.2 rehearsed, stoppers registered
- task type: cross-workspace program execution (monorepo track) under an active sequencing gate
- request summary: continue with Phase 5 of the integration plan; document all stoppers
- filesystem slice inspected: workspace root (tooling, .gitignore), all six `apps/*` repos (remotes, branches, lockfiles, dirty state, full commit-message scan), `/tmp/umi-phase5-rehearsal`, S1.6 addendum, gh/vercel CLI auth state
- chosen owner: workspace root (`docs/migration`, root tooling files); rehearsal isolated in `/tmp`
- chosen path: direct execution; cutover-blocked work documented instead of forced
- skill or subagent used: `task-router`, `scientific-research-check` (pnpm/Turborepo/Vercel-monorepo docs re-verified at execution time per S5.1), `adapter-sync-check` (post-write)
- files touched: root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.gitignore`, `docs/migration/audit-output/2026-06-10-phase-5-execution.md`, plan Status; `apps/umi-kds` commit `789bae5` (uncommitted S2.3 work)
- tools used: git, git-filter-repo (Homebrew-installed), pnpm 10.29.3, turbo 2.8.8, gh, vercel CLI, WebFetch
- outcome: S5.1 done (validated against rehearsal: 1,543-package lockfile resolution + turbo task graph); S5.2 mechanic proven with exact commit conservation (Cash 218/218; total 279); S5.3 assessed-blocked; 10-entry stopper register written (hard: Phase 4 incomplete, no monorepo remote, zero Vercel projects, offensive commit `9df2c40` in pushed conversaflow history, service_role rotation pending)
- reusable pattern observed: pre-import repo hygiene scan (dirty trees + offensive/unprofessional commit messages across all repos) caught two real issues; filter-repo requires `--no-local` clones — first rehearsal attempt failed exactly as a rehearsal should
- promotion follow-up: `repo-history-preserving-import` seed updated with its first real trace (was anticipated-only); prune-or-promote stays at the Phase 5 cutover checkpoint per the seed's own gate

### 2026-06-10 - Phase 4 S4.1 dashboard schema cutover
- task type: cross-workspace program execution (backend consolidation, dashboard track)
- request summary: continue with Phase 4; owner constraint recorded — umi-cash Supabase project `rrkzhisnadfrgnhntkiz` is the only real production DB and is untouchable until S4.3 readiness
- filesystem slice inspected: `apps/umi-dashboard` (server.js, prisma, env files, api/, vercel.json), `docs/migration/local-postgres/**`, staging DB `umi_platform_staging_phase3_20260610`, transition DB `dashboard_compat`/`kds` schemas
- chosen owner: `apps/umi-dashboard` for the cutover; root `docs/migration` for replay scripts and evidence
- chosen path: direct execution; no subagent
- skill or subagent used: `task-router`, `staging-validation-runner` (replay-gap handling), three-lens walk
- files touched: `apps/umi-dashboard/{server.js,prisma/schema.prisma,.env.example,docs/deployment.md}` (commits 4aba926, 5e49777), `docs/migration/local-postgres/008_dashboard_compat_core.sql` (new), `005_kds_core.sql` (pairing table appended), 05-23 checklist Phase 4, plan status, `audit-output/2026-06-10-phase-4-1-dashboard-cutover.md`
- tools used: psql, pg_dump, node --check, prisma validate/generate, curl API matrix, puppeteer browser walkthrough, npm build
- outcome: zero `PLATFORM_TRANSITION_SCHEMA` references; legacy branches and dead helpers deleted (server.js 3,570 → 2,952); Prisma schema remapped to compat views and trimmed; 28 API checks + write flows + browser walkthrough green against staging; two staging replay gaps found live and scripted additively; Cash production untouched (verified zero repo references before starting)
- reusable pattern observed: before deleting dual-path branches, walk the route surface on the surviving path with entitlement-positive AND entitlement-negative tenants — the 403s are evidence the gating works, not failures; also, replay-gap discovery (ad-hoc schemas missing from numbered scripts) recurs every environment promotion — fold "diff live schema vs scripts" into `staging-validation-runner`
- promotion follow-up: update `staging-validation-runner` with the schema-vs-scripts diff step at the Phase 4 checkpoint; `three-lens-release-review` gained its third decision-changing trace (the credential-orphan and pairing-table finds came from the lens walk)


### 2026-06-10 - Phase 3 shared foundations execution (S3.1-S3.3)
- task type: cross-workspace program execution (shared foundations phase)
- request summary: execute Phase 3 of the 2026-06-09 workspace integration implementation plan
- filesystem slice inspected: root migration scripts/checklists/audit output, `apps/umi-dashboard` API/server/deploy config/env docs, local PostgreSQL 18 databases, Supabase project list, Vercel CLI project/team state
- chosen owner: root `docs/migration` for staging database evidence and checklist status; `apps/umi-dashboard` for dashboard deployability and tenant/capability API validation; root `.agents/skills/` for phase checkpoint/promotion records
- chosen path: direct execution; no subagent
- skill or subagent used: `task-router`, `workspace-boundary-check`, `scientific-research-check`, `staging-validation-runner` (promoted at checkpoint)
- files touched: `docs/migration/local-postgres/010_seed_product_matrix.sql`, `030_platform_identity_backfill.sql`, `docs/migration/audit-output/2026-06-10-phase-3-*`, 05-23 checklist, 06-09 plan status, Dashboard `server.js`, `api/index.js`, `vercel.json`, `.env.example`, `docs/deployment.md`, root skill registry/seeds/new skill, generated `.claude` mirror
- tools used: official-doc research, `psql`, local PostgreSQL staging replay, `curl`, `npm run api:check`, `npm run build`, `npx vercel`, `rsync -ac --delete`, recursive diff
- outcome: S3.1 executed as standalone PostgreSQL staging rehearsal with zero blocking validation findings and Phase 4F no-import rows archived; replay defects fixed in scripts; exact count equality intentionally not met because staging excludes five synthetic `+1555` conversation families that remain in the older transition DB. S3.2 deploy config/build complete but non-local Vercel reachability remains open because no Vercel project/staging DB secrets exist. S3.3 tenant/capability endpoints validated against staging (`health`, `me/tenants`, `tenants/:id/capabilities`).
- reusable pattern observed: staging replay must stop on script defects and classify count deltas before exit; count equality is not enough when the older target contains synthetic production-facing rows.
- promotion follow-up: promoted `staging-validation-runner`; held `three-lens-release-review` for another phase because Phase 3 produced useful evidence but still depends on external deploy closure.

### 2026-06-10 - Phase 3 skill checkpoint review
- task type: skill lifecycle review (per program plan Phase 3 checkpoint)
- request summary: review Phase 3 routing evidence and evaluate `staging-validation-runner`, `three-lens-release-review`, and `secrets-environment-promotion`
- filesystem slice inspected: `.agents/skills/task-router/{routing-ledger,skill-seeds,registry,promotion-criteria}.md`, Phase 1 and Phase 3 audit outputs, Dashboard deployment docs
- chosen owner: root `.agents/skills/` (canonical layer)
- chosen path: direct execution
- skill or subagent used: `task-router`, `skill-creator`, `adapter-sync-check`
- files touched: `.agents/skills/staging-validation-runner/SKILL.md`, `.agents/skills/task-router/{registry,skill-seeds,routing-ledger}.md`, generated `.claude` mirror
- tools used: file edits, `rsync -ac --delete`, recursive diff verification
- outcome: promoted `staging-validation-runner` after S1.2 and S3.1 traces; did not promote `three-lens-release-review` yet because Phase 3 is not fully closed externally; did not promote `secrets-environment-promotion` because actual Vercel env promotion did not happen.
- reusable pattern observed: a promoted validation skill should include failure handling for script-order bugs and intentional count deltas, not just happy-path commands.
- promotion follow-up: revisit `three-lens-release-review` and `secrets-environment-promotion` after non-local Dashboard preview and S4.1.

### 2026-06-10 - Phase 2 standardization execution (S2.1-S2.3)
- task type: cross-workspace program execution (standardization phase)
- request summary: execute Phase 2 of the 2026-06-09 workspace integration implementation plan
- filesystem slice inspected: workspace root docs, `docs/reports/latest.md`, `docs/README.md`, root and KDS adapter skill trees, all six app git remotes, GitHub org repository list, SSH host aliases
- chosen owner: root docs for index/push-matrix/history state; root `.agents/skills/` for routing ledger and checkpoint records; app repos only for local git remote URL normalization; `apps/umi-kds` for local adapter hygiene
- chosen path: direct execution; no subagent
- skill or subagent used: `task-router`, `workspace-boundary-check`, `adapter-sync-check`
- files touched: `docs/governance/github-push-matrix.md`, `docs/reports/latest.md`, `docs/README.md`, three historical migration docs, `.agents/skills/task-router/{routing-ledger,skill-seeds}.md`, `docs/migration/2026-06-09-workspace-integration-implementation-plan.md`, KDS `AGENTS.md`/`CLAUDE.md`/local skill pointers, generated `.claude` mirrors
- tools used: git remote inspection/set-url, `git ls-remote`, `gh repo list`, `rg`, `sed`, `diff`, `rsync -ac --delete`
- outcome: S2.1 complete for the six app repos — all remotes now use `git@github.com-umi:umiconsulting/...`; S2.2 complete — `latest.md` points to the active driver, historical migration plans are marked, and stale ledger path references are annotated; S2.3 complete — root `.agents` is canonical with `.claude` mirror, KDS local `.agents` is canonical with `.claude` mirror, and the KDS task-router copy is reduced to a root-router pointer.
- reusable pattern observed: `ledger-mirroring` is fully covered by `adapter-sync-check`; a separate skill would duplicate the same write-once/regenerate/verify procedure.
- promotion follow-up: Phase 2 checkpoint merged `ledger-mirroring` into `adapter-sync-check`; no new skill promoted.

### 2026-06-10 - Phase 2 skill checkpoint review
- task type: skill lifecycle review (per program plan Phase 2 checkpoint)
- request summary: review Phase 2 routing evidence and evaluate the `ledger-mirroring` seed for promotion
- filesystem slice inspected: `.agents/skills/task-router/{routing-ledger,skill-seeds,registry,promotion-criteria}.md`, root `.claude/skills`, KDS `.agents/skills`, KDS `.claude/skills`
- chosen owner: root `.agents/skills/` for skill lifecycle records; KDS `.agents/skills/` for product-local procedure source
- chosen path: direct execution
- skill or subagent used: `task-router`, `adapter-sync-check`
- files touched: `.agents/skills/task-router/skill-seeds.md`, `.agents/skills/task-router/routing-ledger.md`, generated `.claude` mirror
- tools used: file edits, `rsync -ac --delete`, recursive diff verification
- outcome: `ledger-mirroring` was not promoted as a separate skill because its stable procedure and trigger are now a strict subset of `adapter-sync-check`; KDS local adapter mirroring exercised the same pattern without creating another root skill.
- reusable pattern observed: product-local adapters can use the same canonical-source/generated-mirror policy as root without needing their own root-level skill.
- promotion follow-up: no new promotion; keep using `adapter-sync-check` for root skill/registry/ledger/seed writes and mirror verification.

### 2026-06-10 - Phase 1 stabilization execution (S1.1–S1.6)
- task type: cross-workspace program execution (stabilization phase)
- request summary: execute Phase 1 of the 2026-06-09 workspace integration implementation plan
- filesystem slice inspected: workspace root, `docs/migration/**`, both adapter layers, `apps/umi-conversaflow` (supabase config/functions/migrations/.env), `apps/umi-dashboard` (server.js, env files), `apps/umi-landing-page`, local PostgreSQL 18 (port 5233), production Supabase (pooler)
- chosen owner: workspace root for git/docs/skills; production DB state inspected via ConversaFlow's linked project
- chosen path: direct execution; no subagent
- skill or subagent used: `task-router`, three-lens protocol per step; `adapter-sync-check` procedure (promoted this phase)
- files touched: `.gitignore` (new) + initial root commit; `legacy.public_compat_imports` (78 archive rows) + 05-23 checklist Phase 1 boxes + `audit-output/2026-06-10-phase-4f-execution.md` + `-final-local-row-counts.csv`; production `cron.job` (embed-backfill-scheduler → vault auth); `.agents` ledger/registry/seeds/SKILL fixes + `.claude` mirror regeneration; `CLAUDE.md`, `agent-operating-system.md`; `docs/reports/2026-06-10-audit-uncertainty-addendum.md`, `audit-output/2026-06-10-production-row-counts.csv`
- tools used: git, psql (local 5233 + production pooler), supabase CLI (secrets/functions list), vercel CLI (npx), rsync/diff, SQL anti-joins, JWT payload decode (role/exp only)
- outcome: S1.1 ✓ (root versioned, no payloads tracked); S1.2 ✓ (4F no-import gate recorded, validation zero-blocking); S1.3 ✓ (VOYAGE_API_KEY present, semantic stage proven live in production trace 2026-06-08 vs null control 2026-06-01; backfill of 30 real-customer messages deferred until synthetic deletion); S1.4 partial (embed-backfill cron converted to vault auth; **service_role rotation still pending — hardcoded cron JWT proven identical to current vault key, so the git-leaked credential remains valid**); S1.5 ✓ (.agents canonical, mirrors byte-identical, sync rule documented); S1.6 ✓ (all four uncertainties resolved, 3 new debt items recorded in the addendum)
- reusable pattern observed: comparing a hardcoded credential against the vault copy by equality (never printing either) is the fastest way to prove whether a rotation actually happened
- promotion follow-up: `adapter-sync-check` promoted; `three-lens-release-review`, `secrets-environment-promotion`, `staging-validation-runner` seeds updated with first traces

### 2026-06-10 - Phase 1 skill checkpoint review
- task type: skill lifecycle review (per program plan §Iteration loop step 5)
- request summary: end-of-phase ledger review, promote/seed/prune pass
- filesystem slice inspected: `.agents/skills/task-router/{routing-ledger,skill-seeds,registry,promotion-criteria}.md`
- chosen owner: root `.agents/skills/` (canonical layer per S1.5 decision)
- chosen path: direct execution
- skill or subagent used: `task-router`
- files touched: `skill-seeds.md` (4 seed updates), `registry.md` (+`postgresql-best-practices`, +`code-review`, +`adapter-sync-check`), `.agents/skills/adapter-sync-check/SKILL.md` (new), `.claude` mirror
- tools used: file edits, rsync mirror regeneration
- outcome: promoted `adapter-sync-check` (2 traces, gate passed); held `three-lens-release-review` despite 2 decision-changing traces (re-evaluate at Phase 3 — guard against premature promotion from a single phase); recorded first traces for `secrets-environment-promotion` and `staging-validation-runner`; no prunes yet (no seed has proven one-off)
- reusable pattern observed: a phase checkpoint that re-reads its own phase's ledger entries catches promotion evidence that step-level work forgets to claim
- promotion follow-up: next checkpoint at Phase 2 (evaluate `ledger-mirroring` merge into `adapter-sync-check`)

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

### 2026-05-26 - Dashboard Customers execution slice
- task type: cross-workspace dashboard implementation
- request summary: execute the Dashboard customer/conversation migration plan using the new skills, with conversations inside Customers rather than as a top-level sidebar item.
- filesystem slice inspected: root Umi operating docs, migration plan, Dashboard/Logs/ConversaFlow/Cash repo contexts, local PostgreSQL schema docs, Dashboard server/data/shell/screens/styles, Logs customer/conversation/memory/integration pages.
- chosen owner: `apps/umi-dashboard` for owner-facing API consumption and UI; root `docs/migration` for plan status; ConversaFlow remains write-model owner for WhatsApp/memory runtime.
- chosen path: direct implementation.
- skill or subagent used: `task-router`, `workspace-boundary-check`, `customer-identity-resolution`, `owner-insights-migration`, `dashboard-customer-ux-validation`, `frontend-design`.
- files touched: `apps/umi-dashboard/server.js`, `src/data.jsx`, `src/app.jsx`, `src/shell.jsx`, `src/lib/module-registry.js`, `src/screens/customers.jsx`, `src/styles.css`, `apps/umi-dashboard/docs/audit-connectivity.md`, `docs/migration/2026-05-24-dashboard-customer-conversations-plan.md`.
- tools used: `rg`, `sed`, `apply_patch`, `node --check`, `npm run build`, local `npm run dev:local`, local API `curl`, Brave DevTools browser validation.
- outcome: Dashboard now has a first-class Customers route/profile backed by tenant-first APIs, customer signal counts inside Customers, nested WhatsApp conversation access, and `/conversations/*` plus `/insights` compatibility redirects into Customers.
- reusable pattern observed: customer-facing Dashboard migrations should route product-specific activity into a canonical customer profile while keeping raw operational diagnostics in Logs and write ownership in product backends.
- promotion follow-up: no new skill; this validated the three customer platform skills created earlier.

### 2026-05-26 - Customer platform skill promotion
- task type: workspace procedure promotion + migration plan wiring
- request summary: create three focused `.agents/skills` for customer identity resolution, owner insights migration, and Dashboard customer UX validation, then reference them from the dashboard customer/conversations migration plan.
- filesystem slice inspected: root Umi operating docs, task-router registry and ledger, skill-creator workflow, existing dashboard customer/conversations migration plan.
- chosen owner: root `.agents/skills` for reusable workspace procedures; root `docs/migration` for the implementation plan reference.
- chosen path: direct implementation.
- skill or subagent used: `task-router`, `skill-creator`.
- files touched: `.agents/skills/customer-identity-resolution/**`, `.agents/skills/owner-insights-migration/**`, `.agents/skills/dashboard-customer-ux-validation/**`, `.agents/skills/task-router/registry.md`, `.agents/skills/task-router/routing-ledger.md`, `docs/migration/2026-05-24-dashboard-customer-conversations-plan.md`.
- tools used: `sed`, `find`, `rg`, `init_skill.py`, `quick_validate.py`, temporary Python venv with PyYAML for validator dependency, `apply_patch`.
- outcome: created and validated three reusable Umi customer platform skills; updated migration phases to call the skills at the relevant implementation gates; updated task-router registry trigger patterns.
- reusable pattern observed: customer platform implementation needs separate repeatable procedures for identity safety, Logs-to-Dashboard insight filtering, and Dashboard customer UX verification.
- promotion follow-up: none; validator passed for all three skills.

### 2026-05-24 - Dashboard customer, conversations, and embedding insights plan
- task type: cross-workspace architecture + owner UX planning
- request summary: plan moving owner-facing WhatsApp conversations and Voyage AI embedding visibility from Logs into Dashboard, with Customers as a sidebar tab and phone number as the first unifying customer datapoint.
- filesystem slice inspected: root workspace docs and maps, task-router/workspace-boundary/scientific-research skills, Dashboard/Logs/ConversaFlow repo contexts, Dashboard shell/screens/server routes, Logs customer/conversation/memory/integration pages, local PostgreSQL platform/cash/conversaflow/commerce/observability schema drafts.
- chosen owner: root `docs/migration` for the cross-product plan; future implementation split between `apps/umi-dashboard` for owner UI/API consumption and `apps/umi-conversaflow` for WhatsApp/memory/embedding write ownership.
- chosen path: direct documentation artifact, no subagent.
- skill or subagent used: `task-router`, `workspace-boundary-check`, `scientific-research-check`, `frontend-design`.
- files touched: `docs/migration/2026-05-24-dashboard-customer-conversations-plan.md`, `docs/reports/latest.md`, `.agents/skills/task-router/routing-ledger.md`.
- tools used: `rg`, `sed`, official/product documentation and academic web research, `apply_patch`.
- outcome: created a source-backed phased plan covering customer table ownership, logs and insights surfaces, Customers sidebar UX, customer detail tabs, WhatsApp conversations, Voyage embedding health, phone identity normalization, APIs, validation queries, and production single-database cutover.
- reusable pattern observed: owner-facing product aggregation should start from `platform.contacts`/identity resolution and expose product sections by capability, while product repos continue owning write models and runtime normalization.
- promotion follow-up: no new skill; reinforces existing workspace-boundary and scientific-research standards.

### 2026-05-23 - Dashboard KDS heartbeat status stabilization
- task type: cross-workspace local integration bug fix
- request summary: fix the dashboard device status flicker while the KDS simulator sends local heartbeats to the dashboard backend.
- filesystem slice inspected: root Umi agent contract, `apps/umi-dashboard` local API/data/devices screen, `apps/umi-kds` heartbeat configuration.
- chosen owner: `apps/umi-dashboard` for local heartbeat status thresholds and device status display; `apps/umi-kds` already owns the 5-second simulator heartbeat cadence.
- chosen path: direct implementation
- skill or subagent used: `task-router`, `workspace-boundary-check`, `browser`
- files touched: `apps/umi-dashboard/server.js`, `apps/umi-dashboard/src/data.jsx`, `apps/umi-dashboard/src/screens/devices.jsx`
- tools used: `rg`, `sed`, `apply_patch`, `npm run build`, `xcodebuild`, `simctl`, local API `curl`, browser verification, CodeRabbit CLI
- outcome: local heartbeat status now uses live under 10 seconds, slow from 10 to 20 seconds, and offline after 20 seconds; dashboard Devices view stayed live for the simulator.
- reusable pattern observed: local KDS liveness should be treated as a dashboard-local heartbeat overlay, not as `last_used_at` from the durable device session row.
- promotion follow-up: no new skill; this is a product-local stabilization pattern.

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
- superseded note (2026-06-10 S2.2): `apps/umi-landing-page-1` no longer exists; current landing owner is `apps/umi-landing-page`. This entry is retained as historical evidence only.

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
- superseded note (2026-06-10 S2.2): `apps/umi-landing-page-1` no longer exists; current landing owner is `apps/umi-landing-page`. This entry is retained as historical evidence only.

### 2026-05-17 - Dashboard tenant, membership, branch, and entitlement implementation
- task type: cross-workspace dashboard/platform implementation
- request summary: execute all phases of the tenant/membership/branch/product entitlement plan for Kalala, keep the implementation simple, and review/fix each phase critically
- filesystem slice inspected: root workspace docs, local Postgres migration SQL, dashboard server/API, dashboard app shell/data/settings screens
- chosen owner: `apps/umi-dashboard` for owner dashboard UI and API compatibility layer; root `docs/migration` for platform transition SQL and validation artifacts
- chosen path: direct implementation
- skill or subagent used: `task-router`, `workspace-boundary-check`, `scientific-research-check`, `frontend-design`
- files touched: dashboard server, dashboard data/auth/tenant context, app shell, Settings, Products & Billing, platform seed/backfill/validation SQL, migration checklist and plan
- tools used: `rg`, `sed`, `apply_patch`, `npm run build`, `node --check`, `psql`, local API curl checks
- outcome: Kalala now resolves as one tenant with two active locations, active Dashboard/ConversaFlow/KDS, missing Cash/Observability, and a local-owner `super_admin`; dashboard modules and APIs gate Cash as inactive
- reusable pattern observed: keep product entitlements as shared tenant capabilities and let roles decide actions inside active modules; do not let elevated roles activate missing products
- promotion follow-up: candidate rule for future dashboard/product work: legacy slug routes need product entitlement guards while compatibility wrappers remain

### 2026-05-17 - Dashboard tenant, membership, branch, and entitlement implementation plan
- task type: cross-workspace dashboard architecture + implementation planning
- request summary: create an implementation plan for owner memberships, tenant selection, branch selection, product entitlement gating, and the Kalala current-state hierarchy with one super-admin path and active ConversaFlow/KDS only
- filesystem slice inspected: root docs and maps, task-router skill docs, `docs/migration/local-postgres/**`, `docs/migration/2026-05-15-optimized-database-transition-plan.md`, `apps/umi-dashboard/{server.js,src/lib,src/data.jsx,src/screens/settings.jsx,docs/audit-connectivity.md}`, `apps/umi-dashboard/prisma/schema.prisma`
- chosen owner: root `docs/migration` for the cross-product implementation plan; first implementation owner is `apps/umi-dashboard`; platform schema changes remain in `docs/migration/local-postgres` and later owning backend migrations
- chosen path: direct documentation artifact, no subagent
- skill or subagent used: `task-router`, `workspace-boundary-check`, `scientific-research-check`
- files touched: `docs/migration/2026-05-17-dashboard-tenant-membership-implementation-plan.md`, `docs/reports/latest.md`, `docs/migration/2026-05-15-optimized-database-transition-checklist.md`, `.agents/skills/task-router/routing-ledger.md`
- tools used: `sed`, `rg`, official PostgreSQL/Supabase/Stripe/OpenFeature documentation lookup, `apply_patch`
- outcome: created a concrete phased plan for capability contract, module registry, tenant-first APIs, frontend providers, settings decomposition, branch-scoped screens, product billing upsell path, and validation gates
- reusable pattern observed: dashboard access should be modeled as user membership + selected tenant + optional selected location + product entitlement + module registry; role privileges should not bypass product availability
- promotion follow-up: no new skill yet; this reinforces existing boundary-check and scientific-research procedures

### 2026-05-14 - PostgreSQL-first platform integration plan
- task type: cross-workspace architecture + local database planning
- request summary: disregard the current database shape and write a PostgreSQL-only plan to audit code/docs/databases, define the full ecosystem integration model, and create a local schema for testing
- filesystem slice inspected: root docs, migration docs, app AGENTS/REPO_CONTEXT inventory, app package/schema/migration inventory, task-router registry
- chosen owner: root `docs/migration`
- chosen path: direct documentation artifact
- skill or subagent used: `task-router`, `workspace-boundary-check`, `scientific-research-check`
- files touched: `docs/migration/2026-05-14-postgresql-platform-integration-plan.md`, `docs/reports/latest.md`, `.agents/skills/task-router/routing-ledger.md`
- tools used: `find`, `sed`, `rg`, official PostgreSQL documentation lookup, `apply_patch`
- outcome: created a PostgreSQL-first audit and local schema plan with canonical `platform` tenant ownership, product activation, local `psql` setup, seed matrix, and validation gates
- reusable pattern observed: greenfield cross-product database planning should define canonical tenant/product activation first, then product schemas, then app module gating
- promotion follow-up: none; the pattern is architecture guidance, not a new reusable skill yet

### 2026-05-14 - Dashboard live data ownership and staff migration
- task type: cross-workspace schema + dashboard implementation
- request summary: make the owner dashboard use real data, move staff out of Cash into tenant-scoped ConversaFlow data, keep Cash for loyalty/wallet configuration, and wire KDS/dashboard operational surfaces
- filesystem slice inspected: root operating docs, `apps/umi-dashboard/**`, `apps/umi-conversaflow/supabase/migrations/**`, `apps/umi-cash/prisma/schema.prisma`, Cash gift-card API route, KDS command function
- chosen owner: `apps/umi-conversaflow` for staff/source-of-truth SQL; `apps/umi-dashboard` for dashboard API and UI consumption; `apps/umi-cash` remains loyalty-only and was not edited
- chosen path: direct implementation
- skill or subagent used: `task-router`, `workspace-boundary-check`, `scientific-research-check`, `frontend-design`
- files touched: `apps/umi-conversaflow/supabase/migrations/20260513190000_dashboard_staff_and_external_refs.sql`, `apps/umi-dashboard/server.js`, `apps/umi-dashboard/src/data.jsx`, dashboard screens/nav, `apps/umi-dashboard/.env.example`, `apps/umi-dashboard/docs/audit-connectivity.md`
- tools used: `rg`, `sed`, `find`, `apply_patch`, `npm run build`, `node --check`
- outcome: dashboard has tenant link resolution, ConversaFlow staff CRUD, KDS order detail/actions, device provisioning/deactivation, real ticker route, Gift Cards screen, and Conversations screen
- reusable pattern observed: dashboard-facing cross-product data should resolve a product slug to both the product-local tenant and the backend business before choosing the owning schema for each route
- promotion follow-up: none; this extends existing boundary-check guidance but does not require a new skill

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

### 2026-05-13 - Platform and output folder consolidation
- task type: cross-workspace cleanup and ownership consolidation
- request summary: move useful files out of `output` and `platform`, then delete those folders
- filesystem slice inspected: `output/**`, `platform/conversaflow/**`, `apps/umi-conversaflow/**`, root docs references
- chosen owner: `apps/umi-conversaflow` for ConversaFlow docs, config, diagnostics, workflow, agent/context support files, and generated product images
- chosen path: direct implementation
- skill or subagent used: `task-router`, `workspace-boundary-check`
- files touched: moved platform ConversaFlow docs/config/scripts/.agents/.context/.github/img into `apps/umi-conversaflow`; updated app `.gitignore`, app agent contract, moved workflow paths, stale root doc reference
- tools used: `find`, `rg`, `mv`, `rm`, `apply_patch`
- outcome: `platform` and `output` removed; useful ConversaFlow artifacts now live under the owning backend repo
- reusable pattern observed: umbrella folders should be dissolved by moving artifacts to the narrowest owning app repo before deleting the umbrella root
- promotion follow-up: none

### 2026-05-13 - Workspace stale-doc and generated-artifact cleanup
- task type: cross-workspace cleanup
- request summary: remove old documentation, unused collateral, and generated files from the Umi workspace
- filesystem slice inspected: root docs, app repo git status, generated build/cache directories, Umi Cash collateral/docs, ConversaFlow moved docs
- chosen owner: root workspace for generated/root docs; `apps/umi-cash` for loyalty collateral/docs; `apps/umi-conversaflow` for moved memory-doc stub
- chosen path: direct implementation
- skill or subagent used: `task-router`
- files touched: root stale plans, root KDS spec source link, `apps/umi-cash` stale docs/collateral, `apps/umi-cash/.gitignore`, `apps/umi-conversaflow/MEMORY_ARCHITECTURE.md`
- tools used: repo inspection, `rg`, `find`, `du`, direct cleanup commands, `apply_patch`
- outcome: removed ignored generated artifacts and stale tracked docs/collateral while preserving active agent contracts, env files, dependencies, and pre-existing modified source files
- reusable pattern observed: cleanup should first separate ignored/generated artifacts from tracked source/docs, then patch references before deleting tracked docs
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
- superseded note (2026-06-10 S2.2): `platform/conversaflow/docs/**` was consolidated into `apps/umi-conversaflow/docs/**`; this entry is retained as historical evidence only.

### 2026-04-15 - Umi KDS schema and organization architecture plan
- task type: cross-workspace architecture analysis + documentation design
- request summary: inspect Umi with focus on `apps/umi-kds`, the shared Supabase multi-schema setup, and create a root Anthropic-style architecture plus a spec for `kds` population and backend ownership
- filesystem slice inspected: root docs, `apps/umi-kds/**`, `apps/umi-conversaflow/**`, migration docs
- chosen owner: root docs for architecture and plan; platform backend for future `kds` implementation
- chosen path: direct implementation at root, explorer subagents for repo-specific analysis, official-doc and primary-source research for architecture validation
- skill or subagent used: root task-router classification; two explorer subagents
- files touched:
- tools used: repo inspection, subagents, web research on Supabase/Postgres/CQRS
- outcome: successful analysis; root workspace artifacts and spec prepared
- reusable pattern observed: for cross-product schema work, inspect the owning write-model repo, the consuming app repo, live migration docs, and primary sources before placing logic
- promotion follow-up: promoted into `scientific-research-check` plus root research standard

### 2026-04-16 - ConversaFlow natural-conversation tool-routing spec
- task type: backend orchestration spec for the WhatsApp tool loop (`turn-process.ts`, `prompts.ts`, `tools.ts`, `intent-extractor.ts`)
- request summary: spec-driven plan to make the WhatsApp conversation feel natural while reliably triggering the right tools; find real bottlenecks; use Supabase MCP for DB confirmations; produce a single .md plan
- filesystem slice inspected: `apps/umi-conversaflow/supabase/functions/{whatsapp-handler,job-worker,_shared}/**`, `platform/conversaflow/docs/architecture/{reviews,memory}/**`, root `AGENTS.md`, repo `AGENTS.md`
- chosen owner: `apps/umi-conversaflow` (write-model + prompt + tools); spec doc placed under umbrella `platform/conversaflow/docs/architecture/reviews/`
- chosen path: direct planning at the umbrella docs layer, no subagent — task scope fits one repo's backend orchestration
- skill or subagent used: `task-router` (this entry), `workspace-boundary-check` (boundary trace in spec §Procedure trace), `scientific-research-check` (Anthropic primary sources cited in spec §Procedure trace)
- files touched:
  - `platform/conversaflow/docs/architecture/reviews/natural-conversation-tool-routing-spec.md` (new)
  - `.claude/skills/task-router/routing-ledger.md` (this entry)
- tools used: Read/Glob/Grep on the conversaflow tree, Supabase MCP (`list_tables`, `execute_sql` against project `xbudknbimkgjjgohnjgp`) for `ai_turn_logs`, `conversation_turns`, `conversations` schema confirmation, WebFetch on Anthropic tool-use and "Building Effective Agents" docs
- outcome: spec-driven plan written; identified the orphaned `intent-extractor.ts` and unused `extracted_intent`/`pending_clarification` columns as the highest-leverage missing seams; phased rollout aligned with prior P0/P1/P3 recommendations from `tool-loop-failure-modes.md` and `responsibility-split-llm-vs-backend.md`
- reusable pattern observed: when a planning task spans an existing review-doc cluster, place the new spec alongside the cluster (`docs/architecture/reviews/`), reference prior reviews explicitly, and keep ownership in the same repo as the write model — do not lift to root docs
- promotion follow-up: none — this is a one-off architecture spec, not a reusable cross-workspace procedure (fails the `promotion-criteria.md` "pattern recurs across more than one trace" gate)
- superseded note (2026-06-10 S2.2): `platform/conversaflow/docs/**` was consolidated into `apps/umi-conversaflow/docs/**`; this entry is retained as historical evidence only.

### 2026-04-21 - Intent Router with LLM Reasoning (Option B — Strict Tool Use)
- task type: backend feature — new routing pipeline for `turn-process.ts`
- request summary: replace the two-step `extractIntent` (Haiku JSON) + `buildToolPlan` (pure TypeScript rules) pipeline with a single LLM call that uses all four memory tiers, emits free-form reasoning, and returns a guaranteed-valid JSON routing decision via Anthropic's Strict Tool Use (`route_conversation` tool, `strict: true`). Three rollout modes: `off` (legacy), `observe` (shadow log), `authoritative` (router drives the turn).
- filesystem slice inspected: `supabase/functions/{job-worker/processors,whatsapp-handler,_shared}/**`, `conversaflow/docs/architecture/reviews/natural-conversation-tool-routing-spec.md`, Anthropic Structured Outputs + Strict Tool Use docs, academic research (DialRouter, MLMF, RASA 3.x, DSPy)
- chosen owner: `apps/umi-conversaflow` (write-model; all changes within `supabase/functions/`)
- chosen path: direct implementation — single-repo, no subagent; plan reviewed and scored before coding
- skill or subagent used: `task-router` (this entry), `workspace-boundary-check`, `scientific-research-check` (Anthropic primary docs for Structured Outputs / Strict Tool Use compatibility matrix)
- files touched:
  - `supabase/functions/_shared/adapters/anthropic.ts` (added `toolChoice` param to `createMessage`)
  - `supabase/functions/whatsapp-handler/intent-extractor.ts` (exported `isAffirmativeConfirmation`, `isNegativeConfirmation`, `shouldTreatAsConfirmationContext`, `applyClarificationHeuristics`)
  - `supabase/functions/job-worker/processors/planner.ts` (exported `buildEntityInput`; added `validateAndCoercePlan`)
  - `supabase/functions/job-worker/processors/router.ts` (new — `RouterInput`, `RouterDecision`, `ROUTE_CONVERSATION_TOOL`, `routeIntent`)
  - `supabase/functions/job-worker/processors/turn-process.ts` (wired `CONVERSAFLOW_ROUTER_MODE`; `observe` runs router concurrently and logs comparison; `authoritative` replaces both legacy calls with fallback)
- tools used: Read/Write/StrReplace, web research on Anthropic Structured Outputs docs, scientific-research-check for compatibility validation
- outcome: full implementation shipped; feature-flagged behind `CONVERSAFLOW_ROUTER_MODE` env var (default `off`); observe mode enables zero-risk A/B logging; authoritative mode engages the new pipeline
- reusable pattern observed: Anthropic Strict Tool Use (`strict: true` + `tool_choice: { type: "tool", name }`) is the correct pattern to combine LLM reasoning with guaranteed JSON output — `output_config.format` (JSON Schema mode) is incompatible with message prefilling/scratchpad; Strict Tool Use allows a text reasoning block before the forced tool call
- promotion follow-up: the "Strict Tool Use for guaranteed JSON + reasoning" pattern is cross-workspace reusable — candidate for a new `scientific-research-check` annotation on Anthropic structured output options

### 2026-04-18 - Fuzzy product search / typo tolerance (horchata cafe → Horchata Kafe)
- task type: bug fix + backend search improvement
- request summary: conversational bot returning "not found" for "horchata cafe" when product is "Horchata Kafe" (c→k one-char substitution). Three-stage search pipeline (ILIKE → client token scorer → semantic embedding) failed all three stages. Root causes: (1) VOYAGE_API_KEY not set as Supabase edge function secret, silently disabling semantic stage; (2) client-side `scoreProductMatch` had no fuzzy tier, dropping pg_trgm-matched SQL results to score 0.
- filesystem slice inspected: `apps/umi-conversaflow/supabase/functions/whatsapp-handler/tools.ts`, `supabase/migrations/`, `supabase/functions/job-worker/processors/planner.ts`, `supabase/functions/job-worker/processors/turn-process.ts`, `conversaflow.messages` and `conversaflow.products` via Supabase MCP
- chosen owner: `apps/umi-conversaflow` (owns search_products_text SQL, tools.ts, and migrations)
- chosen path: direct implementation — single-repo fix, no subagent needed
- skill or subagent used: `scientific-research-check` (pg_trgm vs Levenshtein vs semantic tradeoffs), `task-router` (this entry), `workspace-boundary-check` (confirmed all three changes belong to conversaflow-functions)
- files touched:
  - `supabase/migrations/20260422000000_fuzzy_product_search.sql` (new — pg_trgm extension + GIN index + search_products_text rewrite)
  - `supabase/functions/whatsapp-handler/tools.ts` (added `levenshteinDistance` + fuzzy tier in `scoreProductMatch`)
- tools used: Supabase MCP (`execute_sql`, `apply_migration`), Read/Edit/Write, scientific-research-check, workspace-boundary-check
- outcome: SQL migration applied live. `search_products_text('horchata cafe')` now returns "Horchata Kafe" with word_similarity score 0.647. Client ranker now gives fuzzy matches score 90 (≥ band threshold). Remaining action: user must set VOYAGE_API_KEY in Supabase edge function secrets to re-enable the semantic stage for synonym-level misses.
- reusable pattern observed: when a multi-stage search pipeline silently degrades (missing external API key), the intermediate stage (client-side scorer) must also handle fuzzy matching independently — don't assume the SQL and semantic layers are always healthy
- promotion follow-up: none — fix is localized to conversaflow-functions; the pattern (missing Supabase secret disabling a search tier) is not yet recurrent enough to warrant a new skill
