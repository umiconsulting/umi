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
