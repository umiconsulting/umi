# Registry

Current at 2026-11-15. The live selection rules are below. Historical entries stay in
`routing-ledger.md`. Do not route work to a retired tracker.

## Skills

- `task-router`
  - scope: route work to the correct Umi owner slice, then to direct execution, an existing project skill, or a subagent.
  - trigger patterns: multi-repo tasks, root-level docs, cross-product planning, ownership uncertainty.
  - placement hints: start in root `.agents/skills/task-router/` (canonical source; `.claude/skills/` is a symlink into it), then descend into the owning repo if the task becomes local.
  - confidence: high
  - provenance: root workspace scaffold for Umi.
- `scientific-research-check`
  - scope: validate architecture and system decisions against official docs and, when useful, academic or primary technical research.
  - trigger patterns: backend-vs-app placement, schema strategy, realtime design, performance claims, scaling decisions, benchmark-sensitive tradeoffs.
  - placement hints: use before committing to structural decisions or documenting strong technical recommendations.
  - confidence: high
  - provenance: Umi research standard for source-backed technical decisions.
- `workspace-boundary-check`
  - scope: verify which repo, schema, and documentation layer should own a cross-product change.
  - trigger patterns: backend vs app placement questions, new docs at root, schema ownership questions, "where should this live?" requests.
  - placement hints: use before creating new files outside an existing project slice.
  - confidence: medium
  - provenance: created for Umi multi-product ownership decisions.
- `customer-identity-resolution`
  - scope: resolve tenant-scoped customer identity across Dashboard, Cash, POS, and platform contacts with safe phone and WhatsApp matching.
  - trigger patterns: customer unification, phone normalization, Customer 360, contact identity, merge candidates, Cash and WhatsApp matching, `platform.contacts`, `platform.contact_identities`.
  - placement hints: use with `workspace-boundary-check`; keep canonical identity in `platform`, normalization and write ownership in `apps/umi-api`, Cash as a compatibility client, and Dashboard as a consumer.
  - confidence: medium
  - provenance: promoted from the Dashboard customer and conversations migration plan gaps.
- `owner-insights-migration`
  - scope: adapt internal customer, conversation, memory, Voyage, WhatsApp, and integration health surfaces into owner-facing Dashboard views.
  - trigger patterns: moving internal diagnostics into Dashboard, owner-facing insights, WhatsApp health, Voyage embedding health, memory health, conversation triage.
  - placement hints: classify each surface as owner-facing, admin-gated, or internal-only before moving it; keep raw traces and service-role diagnostics out of Dashboard.
  - confidence: medium
  - provenance: promoted from the Dashboard customer and conversations migration plan gaps.
- `dashboard-customer-ux-validation`
  - scope: validate Dashboard customer platform UX across Customers navigation, customer profile, conversations, Insights, entitlement gating, and responsive layout.
  - trigger patterns: Customers sidebar UX, customer profile tabs, customer timeline, Dashboard conversation detail, responsive owner admin UI validation.
  - placement hints: use after Dashboard customer UI changes and before signoff; verify desktop and mobile layouts when a runnable app exists.
  - confidence: medium
  - provenance: promoted from the Dashboard customer and conversations migration plan gaps.
- `postgresql-best-practices`
  - scope: PostgreSQL table design, indexing, normalization, and migration safety reference.
  - trigger patterns: new tables, schema design review, index planning, migration SQL authoring.
  - placement hints: reference during schema work in any repo; pairs with `scientific-research-check` for version-sensitive claims.
  - confidence: medium
  - provenance: imported reference distilled from official PostgreSQL guidance.
- `code-review`
  - scope: two-axis code review (Standards + Spec) of a diff against a fixed point, from Matt Pocock's engineering skill set; runs the axes as parallel sub-agents.
  - trigger patterns: explicit review requests; pre-merge quality, security, or bug-hunt passes on changed code.
  - placement hints: run from the repo whose diff is under review.
  - confidence: medium
  - provenance: replaced the CodeRabbit-based adapter skill with Matt Pocock's engineering `code-review` during the engineering-skills install.
- `adapter-sync-check`
  - scope: verify the tool adapter paths (`.claude/skills`, plus `.cursor` and `.codex` if present) are symlinks into canonical `.agents/skills/`, and restore any link replaced by a copy.
  - trigger patterns: after clone or checkout; any write through an adapter path; workspace health checks; suspected adapter drift.
  - placement hints: run from the workspace root; canonical writes go to `.agents/`, the links reflect them.
  - confidence: high
  - provenance: promoted at the Phase 1 checkpoint (2026-06-10) from the `adapter-sync-check` seed. Traces: 2026-06-09 audit drift diff, 2026-06-10 S1.5 re-convergence.
- `staging-validation-runner`
  - scope: reproduce the seven-schema platform transition database in a staging target, apply public-compat exclusion, validate, and compare row counts.
  - trigger patterns: database environment promotion, staging rehearsal, production cutover rehearsal, row-count validation gates.
  - placement hints: run from the workspace root with `docs/migration/local-postgres/**`, `docs/migration/validation/**`, and `docs/migration/audit-output/**`.
  - confidence: high
  - provenance: promoted at the Phase 3 checkpoint (2026-06-10) from traces in S1.2 local validation and S3.1 standalone staging replay.
- `repository-cartographer`
  - scope: build a factual architectural metadata graph of a codebase (business modules, DDD roles, data ownership, dependency cycles, coupling and centrality, transaction boundaries, bounded-context map) and report it as architectural knowledge. Deterministic first and zero-install.
  - trigger patterns: "map/analyze/understand/reverse-engineer this repo", onboarding onto an unfamiliar codebase, architecture or DDD review, dependency cycles, coupling hotspots, layering violations, aggregate roots, data ownership, transaction boundaries, bounded contexts, context map, dead code.
  - placement hints: run from the workspace root (whole repo) so the ownership layer sees the schema DDL under `docs/migration/**`; scripts are zero-install (Node plus the repo's own TypeScript). Embeddings and LLM only narrate the already-factual `catalog.json`.
  - confidence: high
  - provenance: authored 2026-07-02; every structural claim primary-source-backed (`references/research-basis.md`); engine validated against ground truth and adversarially reviewed against the live monorepo (18 findings fixed). Registered 2026-07-29. The skill shipped but its registry, seed, and ledger entries stayed in a stash, so nothing routed to it for four weeks.

## Selection rules

- Workspace-level rules and planning: root `AGENTS.md`, root `docs/`, and the named run record.
- Current requirements and pending work: the user's current instruction, the active task brief, and the run record. Do not route to Azure Boards, Trello, Plane, or a CodeGraph work-item triage.
- Source-sensitive technical decisions: `scientific-research-check` before locking the recommendation.
- Codebase architecture mapping, dependency cycles, data ownership, DDD and aggregate analysis, or bounded-context and context-map questions: `repository-cartographer` (run from the repo root).
- Database staging, promotion, and cutover validation: `staging-validation-runner`.
- Customer identity, phone normalization, and cross-product Customer 360 matching: `customer-identity-resolution`.
- Internal diagnostics to Dashboard owner insight migration: `owner-insights-migration`.
- Dashboard customer UX validation and responsive owner-admin checks: `dashboard-customer-ux-validation`.
- Product app changes: descend into the owning app directory.
- Shared backend, normalization, projections, jobs, contracts, and backend orchestration: `apps/umi-api`. It is the canonical backend.
- Owner dashboard app shell and live-data UI: `apps/umi-dashboard`.
- POS operator flows, offline replay, KDS board, and device-role mode: `apps/umi-pos`.
- Cash compatibility client and its separate Prisma: `apps/umi-cash`. It forwards the frozen wallet-pass URL to `apps/umi-api`.
- Public landing and lead capture: `apps/umi-landing-page`.
- Root artifact first, new repo last.

## Retired selection rules

Keep this section for history. Do not select these rules.

- Work-item triage, backlog validation, and stale-ticket detection: `triage-work-items-with-codegraph` is retired for Umi routing on 2026-11-15. It assumes Azure Boards, which Umi retired on 2026-11-08. Historical provenance: authored 2026-08-13 on the CodeGraph pilot in `docs/reports/2026-08-13-codegraph-evaluation.md` (CLI `1.5.0`, 689 files, 9,677 nodes); forward-tested on work items 93, 21, 19, and 13.
- Shared Supabase contracts, normalization, and backend orchestration in `apps/umi-conversaflow`: historical. That path is not in the current tree. Current owner: `apps/umi-api`.
- ConversaFlow operations and logs UI in `apps/umi-logs`: historical. That path is not in the current tree. Current owner for owner-facing views: `apps/umi-dashboard`.
- Static Umi owner dashboard prototype: historical. The current app is the owner dashboard app shell with live-data UI in `apps/umi-dashboard`.
