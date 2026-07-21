# Umi Workspace Deep Integration Audit

**Date:** 2026-06-09
**Class:** Current investigation (per `docs/reports/index.md` report classes)
**Scope:** Entire `Umi/` workspace — root cognition layer, all six product repos, agent context layers, migration state
**Method:** Evidence-driven file inspection. No live database was queried; all row counts and production-state claims are cited from dated workspace documents and carry that date's authority. Where uncertainty exists it is stated explicitly.

---

## Phase 9 first — Executive Summary

_(Placed first for leadership readability; full evidence follows in Phases 1–8.)_

### What Umi is

Umi is a multi-product restaurant-operations platform for small businesses (first production tenant: Café Kalala, Culiacán):

- **ConversaFlow** — WhatsApp AI ordering assistant (Supabase Edge Functions, "mini-harness" LLM architecture)
- **KDS** — native SwiftUI iPad Kitchen Display System
- **Cash** — loyalty/wallet/passes app (Next.js + Prisma on Vercel)
- **Dashboard** — owner admin shell (Vite/React + Express)
- **Logs** — internal observability/trace UI (Next.js)
- **Landing page** — acquisition site (Next.js)

### Current maturity level

**"Federated cognitive workspace, mid-migration."** The workspace has an unusually mature _knowledge architecture_ (neutral agent contracts, governance docs, retrieval maps, routing ledgers — see `AGENTS.md`, `docs/governance/`) and a well-designed _target data architecture_ (7-schema PostgreSQL-first platform, executed locally through migration Phase 4E). What it does not yet have is **production convergence**: the migration stalled at the final local gate (Phase 4F) around 2026-05-28, the dashboard backend has no deployment target, and Cash still runs production from a separate legacy Supabase project.

### Scores (evidence-based, 0–10)

| Dimension                 | Score    | Basis                                                                                                                                                                                                                                                                          |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Integration readiness** | **5/10** | Target model designed, validated locally through Phase 4E, both blocking human decisions resolved (2026-05-23); but zero production cutover, no staging environment, 12 days of inactivity since 2026-05-28                                                                    |
| **Backend consolidation** | **6/10** | One shared Supabase project hosts conversaflow/kds schemas; canonical edge-function runtime exists; but Cash production is still a separate project, dashboard duplicates backend logic in a 3,561-line undeployed `server.js`, and 8 scheduled jobs run outside the job queue |
| **Monorepo readiness**    | **4/10** | Physical layout is already monorepo-shaped (`apps/` + root docs), all JS apps use npm; but the **workspace root is not a git repository**, the six apps are six separate repos across three GitHub identities, and there is no shared tooling/workspace manifest               |

### Major risks (top 5)

1. **The root workspace is not version-controlled.** All governance docs, migration plans, migration SQL (`docs/migration/local-postgres/*.sql`), and skills live outside git. A disk failure loses the institutional memory this audit reconstructs. (Evidence: environment reports `Is a git repository: false`; no `.git` at root.)
2. **Cash data has three divergent surfaces**: live project `rrkzhisnadfrgnhntkiz`, the stale `umi_cash` schema copy inside Umi Platform, and a _drifted_ duplicate Prisma schema in the dashboard (13 models vs Cash's 14 — `LifecycleEvent` missing; `apps/umi-dashboard/prisma/schema.prisma` vs `apps/umi-cash/prisma/schema.prisma`).
3. **Migration momentum loss.** Phases 4A–4E executed locally; Phase 4F (an audit/no-import gate whose source analysis is already done) and `docs/migration/validation/001_core_validation.sql` have not been run; the entire `2026-05-23` execution checklist is unchecked.
4. **Agent-knowledge drift between adapter layers.** Root `.agents/skills/` is 9 ledger entries and 3 skills ahead of root `.claude/skills/` (15 vs 6 routing-ledger entries; `customer-identity-resolution`, `owner-insights-migration`, `dashboard-customer-ux-validation` exist only in `.agents/`), directly violating `docs/governance/adapter-policy.md` ("Adapters must not drift").
5. **Semantic search silently disabled in production** — `VOYAGE_API_KEY` missing from Supabase secrets; 136 products have local-only embeddings (`2026-05-23` audit §7, workspace memory).

### Major opportunities

- The hard intellectual work is **done**: tenant model, contact identity policy, jobs/outbox retention policy, money policy, synthetic-data classification (443 synthetic vs 93 production-verified customers) are all decided and documented.
- The workspace already behaves like a modular monolith conceptually; formalizing it (one git monorepo + one deployed backend) is mostly mechanical.
- Phase 4F is cheap: its source audit (`docs/migration/audit-output/2026-05-16-public-compatibility-legacy-audit.md`) found only 78 public-only rows, all synthetic.

### Recommended next 30 days

1. `git init` the workspace root (or create `umiconsulting/umi-workspace`) covering root docs, skills, and migration SQL; add submodule/subtree policy for apps later. **Cost: hours. Removes the single largest knowledge-loss risk.**
2. Execute migration Phase 4F + `001_core_validation.sql` locally; record final counts. (Checklist Phase 1, `docs/migration/2026-05-23-api-backend-centralization-execution-checklist.md`.)
3. Set `VOYAGE_API_KEY` in the Supabase dashboard.
4. Re-converge `.claude/` and `.agents/` skill layers (copy the newer `.agents` registry/ledger/skills into `.claude` or make one a generated mirror of the other, per adapter policy).
5. Choose the dashboard backend deployment shape (checklist Phase 3) — recommendation below: API routes co-located with the dashboard app, deployed on the same host class as Cash (Vercel/Node).

### Recommended next 90 days

1. Stage the 7-schema database (checklist Phase 2) and run dashboard `PLATFORM_TRANSITION_SCHEMA=true` flows against it (Phase 4).
2. Delete the dashboard's duplicate Cash Prisma schema and `callKdsPairingLocal` (Phases 4–5).
3. Cash schema cutover with soak comparison; deprecate `rrkzhisnadfrgnhntkiz` to read-only (Phase 6 — highest-risk step, has a written mitigation plan).
4. Move the 8 Vercel cron jobs into `pg_cron` + `job-worker` (Phase 7).
5. Migrate landing-page leads from SQLite to PostgreSQL (`platform.leads` / `lead_events`, checklist Phase 9).

### Recommended next 12 months

1. Complete production cutover of all products to the platform database; remove `public.*`, `legacy.*`, and the stale `umi_cash` copy (checklist Phase 8).
2. Consolidate the six repos into one monorepo (pnpm workspaces + Turborepo for the five JS apps; KDS as a native directory outside the JS task graph) under one GitHub org — **after** backend consolidation, not before.
3. Extract the first shared packages: `@umi/db` (schema types + SQL contracts), `@umi/contracts` (tenant/capability API types), `@umi/adapters` (Twilio/email write paths).
4. Execute the Supabase exit sequence only as far as it pays for itself (transition plan Phase 8 explicitly sets no exit date — keep that stance).
5. Normalize repo/product naming (`375` → umi-kds, `supabase-edge-functions` → umi-conversaflow, package `umi-consultoria` → umi-landing) during the monorepo move, when renames are free.

---

## Phase 1 — Context Absorption

### 1.1 Documentation inventory

The root cognition layer is complete and internally consistent in design:

| Layer              | Files                                                                                               | Role                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Neutral contract   | `AGENTS.md`, `WORKSPACE.md`                                                                         | Workspace-wide rules, product boundaries, database ownership, research standard                               |
| Operating model    | `docs/architecture/agent-operating-system.md`                                                       | 3-layer model: neutral contract → procedures → tool adapters                                                  |
| Maps               | `docs/architecture/maps/{workspace,retrieval,runtime}-map.md`                                       | Routing, bounded context loading, execution chains                                                            |
| Governance         | `docs/governance/{authority,ownership,adapter-policy,cognitive-lifecycle,agent-safe-boundaries}.md` | Authority hierarchy, federated ownership, adapter sync rules, artifact promotion lifecycle, edit-safety tiers |
| Indexes            | `docs/reports/{latest,index}.md`, `docs/evals/`, `docs/memory/`, `docs/traces/`                     | Default retrieval entrypoints                                                                                 |
| Migration          | `docs/migration/` (8 plans + `local-postgres/` SQL + `audit-output/` evidence + `validation/`)      | The active platform integration program                                                                       |
| Dated architecture | `docs/architecture/2026-*.md` (7 docs)                                                              | KDS audits/specs, ConversaFlow audit prompt, refactor brief, backend centralization audit                     |
| Updates            | `docs/updates/2026-04-15-kds-program-update.md`                                                     | Program snapshot with 2026-04-16 execution log                                                                |

No ADR directory exists; dated plans + the routing ledger serve that function de facto. **Gap:** decisions are recorded in plans, but there is no single decision log; the authority hierarchy (`docs/governance/authority.md`) compensates by ranking artifacts.

### 1.2 Agent context layers

Three adapter families exist at root, plus per-repo layers:

| Layer                                | Contents                                                                                                                                                                           | State                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| root `.claude/`                      | skills: `task-router`, `workspace-boundary-check`, `scientific-research-check`, `code-review`; `settings.local.json`                                                               | **Stale** — routing ledger last entry 2026-05-21 (6 entries); registry lists 3 skills                                                    |
| root `.agents/`                      | same 3 core skills **plus** `customer-identity-resolution`, `owner-insights-migration`, `dashboard-customer-ux-validation`, `postgresql-best-practices`; `agents/agent-creator.md` | **Current** — ledger has 15 entries through 2026-05-26; registry lists 6 skills; skills carry `agents/openai.yaml` (multi-vendor intent) |
| root `.cursor/`                      | `settings.json` only                                                                                                                                                               | Minimal                                                                                                                                  |
| `apps/umi-kds/.claude` + `.agents`   | duplicated skill sets: local `task-router` copy, `create-skill`, `filesystem-structure-check`, `swiftui-kds-standards`; agents `ios-architect`, `skill-curator`                    | Duplicated across both adapter dirs                                                                                                      |
| `apps/umi-conversaflow/.agents`      | role agents: `turn-integrity-agent`, `software-designer`, `problem-diagnostician`, `architect-software`, `umi-conversaflow-agent`, `agent-creator`                                 | Repo-local judgment layer                                                                                                                |
| `apps/{cash,dashboard,logs}/.claude` | `settings.local.json` only                                                                                                                                                         | Settings only                                                                                                                            |

**Drift evidence (verified by diff):**

- `.claude/skills/task-router/SKILL.md` line 4 says "follow that repo's local `CLAUDE.md` and `.claude/`"; the `.agents` copy says "`AGENTS.md` and `.Codex/`" — a third adapter name that exists nowhere in the tree.
- `.claude` routing ledger: 6 entries (template + 5, latest 2026-05-21). `.agents` ledger: 15 entries (latest 2026-05-26), including entries the `.claude` layer never received ("Dashboard Customers execution slice", "Customer platform skill promotion", "Platform and output folder consolidation").
- `.agents/skills/task-router/registry.md` registers three customer-platform skills absent from `.claude`'s registry.

This violates `docs/governance/adapter-policy.md` §"Adapters must not… drift from root or local `AGENTS.md`" and the maintenance rule in `agent-operating-system.md`. The practical effect: which procedures an agent sees depends on which vendor tool opened the workspace.

**Stale references inside ledgers:** the `.claude` ledger's two 2026-05-21 entries cite `apps/umi-landing-page-1` as the chosen owner — that directory no longer exists (only `apps/umi-landing-page` does). The 2026-05-11 entry cites `platform/conversaflow/docs/**`, also gone (consolidated into `apps/umi-conversaflow/docs/` per the `.agents` ledger's 2026-05-13 "Platform and output folder consolidation" entry). Historical entries are allowed to age, but nothing marks them superseded.

### 1.3 Skill dependency map

```text
task-router (root)                          [maturity: high, used in ≥15 traces]
 ├─ reads → registry.md, node-resolver.md, routing-ledger.md, promotion-criteria.md
 ├─ delegates placement → workspace-boundary-check   [high, cross-cutting]
 ├─ delegates evidence  → scientific-research-check  [high, used in migration plans]
 └─ promoted children (in .agents only):
     ├─ customer-identity-resolution      [medium; platform.contacts / contact_identities]
     ├─ owner-insights-migration          [medium; Logs→Dashboard surface moves]
     └─ dashboard-customer-ux-validation  [medium; post-edit UX checks]
postgresql-best-practices (.agents only)   [reference card, no deps]
code-review (.claude only; CodeRabbit)     [generic, not Umi-specific]
apps/umi-kds local: task-router(copy) ─ create-skill ─ filesystem-structure-check ─ swiftui-kds-standards
apps/umi-conversaflow/.agents: role agents (turn-integrity, diagnostician, designer, architect)
```

**Consolidation relevance:** `task-router`, `workspace-boundary-check`, and `customer-identity-resolution` directly serve platform consolidation. The KDS-local `task-router` copy and the dual `.claude`/`.agents` mirrors are overhead — three copies of the same procedure that already disagree. `scientific-research-check` is the workspace's quality gate and demonstrably shaped the migration plans (every plan has a "Decision Basis" section with primary sources).

---

## Phase 2 — Product & Repository Inventory

### 2.1 Products

| Product      | Repo                    | Stack                                                                      | Status                                                                                                                                                                             | Business role                                                                                                                               |
| ------------ | ----------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| ConversaFlow | `apps/umi-conversaflow` | Deno / Supabase Edge Functions, 9 functions, 52 SQL migrations             | **Production** (project `xbudknbimkgjjgohnjgp`); mini-harness signed off 2026-05-11 (`reports/mini-harness-signoff/`)                                                              | WhatsApp AI order-taking; owns operational truth (orders, jobs, outbox, memory, traces)                                                     |
| KDS          | `apps/umi-kds`          | SwiftUI iPad, 24 Swift files, Xcode project `375.xcodeproj`                | **Production on device**; live since 2026-04-16; PIN pairing (2026-05-22) and device revocation (2026-05-23) implemented per plans + migrations `20260522180000`, `20260523130000` | Kitchen ticket board; thin client over `kds` schema projections                                                                             |
| Cash         | `apps/umi-cash`         | Next.js 14, React 18, Prisma 5 (14 models), Vercel + 8 crons               | **Production**, on _legacy separate_ Supabase project `rrkzhisnadfrgnhntkiz`                                                                                                       | Loyalty, wallet passes (Apple/Google), gift cards, OTP                                                                                      |
| Dashboard    | `apps/umi-dashboard`    | Vite/React 18 + Express `server.js` (3,561 lines), duplicate Prisma schema | **Local-only** — no deployment target (centralization audit §2: "Not deployed")                                                                                                    | Owner admin: 13 screens (`src/screens/`: overview, orders, members, customers, conversations, devices, staff, hours, gift-cards, settings…) |
| Logs         | `apps/umi-logs`         | Next.js 16, React 19, Supabase reads                                       | Internal tool                                                                                                                                                                      | Trace/ops browsing: 16 route groups (`app/(dashboard)/…`: trace, jobs, outbox, memory, twilio, slack, security…)                            |
| Landing      | `apps/umi-landing-page` | Next.js 15, React 19, **better-sqlite3**                                   | Staging branch; repositioned 2026-05-21 from consulting to product-suite                                                                                                           | Lead acquisition + diagnostic quiz + email sequences                                                                                        |

### 2.2 Repository boundaries and coupling

Each app is an independent git repo; the root is **not** a repository:

| Repo             | Remote                                                 | Branch              | Commits | Naming note                                                    |
| ---------------- | ------------------------------------------------------ | ------------------- | ------- | -------------------------------------------------------------- |
| umi-cash         | `umiconsulting/umi-cash` (alias `github.com-personal`) | main                | 218     | —                                                              |
| umi-conversaflow | `umiconsulting/supabase-edge-functions`                | **architecture-v2** | **7**   | repo name ≠ product name; tiny history suggests a reset/squash |
| umi-dashboard    | `umiconsulting/umi-dashboard` (alias `github.com-umi`) | main                | 2       | nearly no history                                              |
| umi-kds          | `umi-juanlopez/375`                                    | main                | 10      | product named "375"                                            |
| umi-landing-page | `umiconsulting/umi-landing-page` (https)               | staging             | 21      | package.json name `umi-consultoria` (stale)                    |
| umi-logs         | `juanclpzq/conversaflow-logs`                          | main                | 5       | personal account, old product name                             |

Three GitHub identities (`umiconsulting`, `umi-juanlopez`, `juanclpzq`) and two ssh host aliases. All six repos' last commit is **2026-05-28** (a coordinated checkpoint sweep), 12 days before this audit.

**Coupling map (data-level):**

```text
Twilio/WhatsApp → whatsapp-handler ─→ conversaflow.* (write model)
                                   └→ jobs → job-worker → outbox → Twilio/Slack
conversaflow.transactions ──trigger──→ kds.* projections ←─ KDS iPad (RPCs + kds-command/kds-pairing)
umi-logs  ──reads──→ conversaflow traces/logs (service creds)
umi-dashboard/server.js ──reads──→ umi_cash schema (stale copy!), conversaflow.*, kds.*
                        ──duplicates──→ Cash Prisma schema, KDS pairing logic
umi-cash  ──reads/writes──→ SEPARATE project rrkzhisnadfrgnhntkiz (live truth)
umi-landing-page ──writes──→ local SQLite (leads)
```

### 2.3 Duplicated functionality (verified)

1. **Cash Prisma schema** duplicated in dashboard, and drifted: `apps/umi-cash/prisma/schema.prisma` has 14 models incl. `LifecycleEvent`; `apps/umi-dashboard/prisma/schema.prisma` has 13 (no `LifecycleEvent`).
2. **KDS pairing**: canonical `apps/umi-conversaflow/supabase/functions/kds-pairing/` + local reimplementation `callKdsPairingLocal` at `apps/umi-dashboard/server.js:1276` (an edge-function call path also exists at `server.js:1175` — both paths live simultaneously; which executes depends on env, uncertainty noted below).
3. **Migration dual paths**: 41 references to `PLATFORM_TRANSITION_SCHEMA` in `server.js` (was ~2,483 lines at the 2026-05-23 audit; now 3,561 — the file grew ~43% _after_ the audit that flagged it).
4. **Twilio/email write paths** duplicated across conversaflow `_shared/` adapters, `umi-cash/src/lib/whatsapp.ts`, dashboard `nodemailer`, landing `nodemailer` (audit §2 item 6; dependency manifests confirm nodemailer in dashboard and landing, resend in cash).
5. **Scheduled jobs**: 8 Vercel crons in `apps/umi-cash/vercel.json` outside the observable `workflow_jobs` queue.
6. **Skills**: 3 copies of `task-router` (root ×2 + KDS), duplicated KDS skills across `.claude`/`.agents`.

---

## Phase 3 — Architecture Reconstruction

### 3.1 Evolution narrative (from dated artifacts)

**Era 1 — Product islands (pre-2026-04).** ConversaFlow began as a single-business Supabase backend in `public` with `business_id` everywhere (`DEFAULT_BUSINESS_ID` still enforced at `apps/umi-conversaflow/supabase/functions/_shared/cors.ts:7`). Cash grew separately on its own Supabase project with its own tenant model (Prisma `Tenant`/`User` mixing customers, staff, and admins). Slack was the kitchen surface (`slack-actions`, since removed — see the update note atop `apps/umi-conversaflow/docs/architecture/ARCHITECTURE_TARGET.md`).

**Era 2 — Workspace formation + multi-schema (2026-04-15/16).** The `Umi/` root was created as a "federated cognitive workspace" (`WORKSPACE.md`). The shared Supabase project was renamed "Umi Platform" and expanded to schemas `conversaflow`, `kds`, `umi_cash`, `platform` with `public` left as compatibility (`docs/migration/2026-04-15-umi-platform-cutover-plan.md`, all steps marked done except deferred cleanup). KDS projections went live 2026-04-16: 23 tickets backfilled, 3 RPCs validated, iPad wired to live data, polling chosen over realtime at measured volume (`docs/updates/2026-04-15-kds-program-update.md`).

**Era 3 — Quality reckoning (2026-04-19 → 2026-05-12).** A production incident (contradictory accept/cancel notifications, unfiltered operator slur sent to a customer — timeline in `docs/architecture/2026-04-19-partial-cancellation-completion-plan.md`) and the KDS system audit (`2026-05-11-kds-system-audit.md`: "the public KDS command surface is effectively unauthenticated") triggered the KDS security/lifecycle refactor (device sessions, anon-mutation revocation, cron-vault auth — migrations `20260512200000`–`20260512250000`). In parallel, ConversaFlow's planner/router experiments were explicitly abandoned in favor of the **mini-harness** ("We do not revive the old planner/router architecture" — `docs/architecture/2026-05-12-overall-refactor-final-prompt.md`, locked decision #1), with obsolete architecture docs deleted (routing ledger 2026-05-11).

**Era 4 — Platform integration program (2026-05-13 → 2026-05-28).** Production dumps were taken (`prod-db-handoff-2026-05-13/`), restored locally, and the PostgreSQL-first 7-schema target was designed (`2026-05-14-postgresql-platform-integration-plan.md`) and refined into a transition plan (`2026-05-15-optimized-database-transition-plan.md`). Local execution database `umi_platform_transition_exec_v2_20260515` was populated through Phase 4E (platform identity, Cash, commerce, KDS, ConversaFlow runtime, observability — counts in §4.1 below). The two blocking human decisions (tenant mapping, order location) were resolved 2026-05-23. The API/backend centralization audit reversed an earlier "centralize in edge functions" direction. Dashboard gained tenant/membership and customer-platform plans (05-17, 05-24); customer skills were promoted (05-26, `.agents` ledger). All repos were checkpoint-committed 2026-05-28, and the local exec DB was dumped to `backups/`.

**Era 5 — Pause (2026-05-28 → today).** No file in the workspace is newer than 2026-05-28 except agent session settings. The program is parked exactly at checklist Phase 1 (run 4F + validation).

### 3.2 Design goals, abandoned vs. successful directions

| Direction                                                         | Status                                                                                     | Evidence                                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Slack as kitchen/ops surface                                      | **Abandoned** → native KDS app                                                             | `ARCHITECTURE_TARGET.md` update note; cutover plan §validation ("slack-actions removed in favor of KDS")            |
| Deterministic planner/router conversation architecture            | **Abandoned** → mini-harness (LLM owns flow, deterministic guards on irreversible actions) | `2026-05-12-overall-refactor-final-prompt.md` locked decision 1; `mini-harness-architecture.md` (canonical)         |
| Supabase Edge Functions as permanent admin API                    | **Abandoned** (explicit reversal)                                                          | `2026-05-23-api-backend-centralization-audit.md`: "The previous version of this audit recommended… That was wrong." |
| Hardcoded assistant messages                                      | **Abandoned** → all user-visible text from LLM in business voice                           | workspace memory `feedback_no_hardcoded_user_messages`                                                              |
| Slug/env-based tenant lock (`VITE_BUSINESS_SLUG`)                 | **Being retired** → membership-resolved tenant switching                                   | `2026-05-14` plan §Product Activation; `2026-05-17` dashboard plan                                                  |
| KDS as projection + thin client                                   | **Successful, stable**                                                                     | KDS audit remediation; `kds-command`/`kds-pairing`; revocation plan implemented                                     |
| Additive, evidence-gated migration with synthetic-data quarantine | **Successful** (locally)                                                                   | Phases 4A–4E results recorded inline in `2026-05-15` plan                                                           |
| Federated agent operating system with neutral contracts           | **Successful in design, drifting in practice**                                             | governance docs vs. the `.claude`/`.agents` divergence (§1.2)                                                       |

### 3.3 Boundaries (current intended state)

- **Write-model ownership:** ConversaFlow owns operational truth; KDS is read-model only; Cash owns loyalty; Dashboard owns no data ("Do not make Dashboard a tenant, staff, contact, order, or product-data authority" — transition checklist §0).
- **Target data ownership:** `platform` (identity/tenancy) → `commerce` (orders) → product schemas (`cash`, `conversaflow`, `kds`) → `observability` → `legacy` (transition-only).
- **Bias:** "one repo plus one database over introducing another repo or service" (`node-resolver.md`); modular-monolith-first is already the workspace's stated default.

---

## Phase 4 — Integration Readiness Assessment

### 4.1 Backend consolidation state

**Done (locally validated, per `2026-05-15` plan inline results and `2026-05-23` audit §1.2):**

- Platform identity: 6 tenants, 5 locations, 8 users, 15 memberships, 302 contacts, 395 contact identities, 12,507 external refs
- Cash: 208 loyalty accounts/cards, 193 passes, 188 pass devices
- Commerce: 50 orders, 73 items, 57 events
- ConversaFlow: 93 production-verified conversations, 2,146 messages, 813 turns, 3,357 inert historical jobs, 136 products
- KDS: 50 tickets, 73 items, 164 events
- Observability: 2,646 production traces, 2,584 evaluation traces, 980 data-quality findings
- Validation invariants held: zero claimable jobs, zero deliverable outbox rows, zero eval rows in production traces

**Not done:** Phase 4F gate; staging; any production cutover; dashboard deployment; Cash cutover; cron migration; adapter consolidation; legacy/public cleanup. The entire execution checklist (`2026-05-23-…-execution-checklist.md`) has zero checked boxes below the decisions section.

**Duplication register:** see §2.3. The root cause is correctly diagnosed in the centralization audit: backend logic fragmented because database ownership was fragmented; consolidation must follow the schema migration rather than create a new API boundary.

### 4.2 Shared domain opportunities (ranked)

1. **Shared schema contracts** — the 7-schema SQL (`docs/migration/local-postgres/001–044`) is already the shared domain model; it needs to move from docs into a versioned, owned package once the root is under git.
2. **Shared tenant/capability API** — `GET /api/me/tenants`, `GET /api/tenants/:id/capabilities` (transition plan Phase 5) is the first cross-product contract; Dashboard, Cash, and Logs all need it.
3. **Shared identity resolution** — `platform.contacts`/`contact_identities` + the `customer-identity-resolution` skill encode the policy (no name-merge, no auto last-10-digit merge, non-blocking verification).
4. **Shared event/job system** — `conversaflow.workflow_jobs` + outbox is the proven pattern; Cash crons are the next consumers (checklist Phase 7).
5. **Shared write adapters** — one Twilio adapter, one email adapter in the `_shared/` layer (checklist Phase 8).
6. **Shared observability** — `observability.*` consumed by Logs; production/evaluation classification already enforced.
7. **Shared auth** — decided direction: `platform.users` canonical with `auth_subject` linkage, OIDC-capable provider medium-term (transition plan §Auth). Not yet chosen — flagged as an open decision.
8. **Shared billing** — explicitly deferred ("Billing tables come after subscription activation," centralization audit §7). Correct to keep deferred.

### 4.3 Monorepo readiness

**Blockers:**

1. Root not a git repo — nothing to migrate _into_ yet (also blocks history-preserving subtree imports).
2. Three GitHub identities / inconsistent remotes — pick one org first.
3. Repo-name/product-name mismatches (`375`, `supabase-edge-functions`, `conversaflow-logs`, package `umi-consultoria`).
4. Tooling heterogeneity: Next 14/15/16, React 18/19, npm everywhere (no workspaces), Deno (conversaflow), Xcode (KDS). None fatal: pnpm workspaces tolerate divergent Next/React versions per app; Deno and Xcode projects can sit in the monorepo outside the Node task graph.
5. Deployment coupling: Vercel projects (cash, landing, presumably logs) need `rootDirectory` repointing; Supabase functions deploy via `--workdir` (already path-based, monorepo-friendly — `apps/umi-conversaflow/AGENTS.md` §Deployment).
6. Git history: cash has 218 commits worth preserving (use `git subtree add`/`git filemerge` import, not copy).

**Effort estimate:** consolidation itself ~1–2 focused weeks (low risk if done after backend consolidation); the risky surface is CI/deploy rewiring, not code. **Risk if done now:** medium — it would freeze the tree during the migration's most delicate phase. **Recommendation:** Phase 5 of the roadmap, not earlier.

---

## Phase 5 — Technical Debt Register

### Critical (actively blocking integration)

| #   | Item                                                                                                    | Impact                                                                                              | Affected                | Remediation                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| C1  | Workspace root unversioned (no `.git` at `/Umi`)                                                        | Total loss exposure for governance, migration SQL, skills; no audit trail; blocks monorepo path     | Everything at root      | `git init` + initial commit; private remote under one org                                                                      |
| C2  | Migration parked at Phase 4F since 2026-05-28                                                           | Staging and every downstream checklist phase blocked                                                | Whole program           | Run 4F + `validation/001_core_validation.sql` (source analysis already complete; expected effort: hours)                       |
| C3  | Dashboard backend undeployable (`server.js`, local Express, no host)                                    | Owner-facing product cannot ship; forces continued local-only operation                             | umi-dashboard           | Checklist Phase 3: choose shape; recommend Next/Node API routes co-located with the dashboard frontend on Vercel-class hosting |
| C4  | Cash triple-surface data (live `rrkzhisnadfrgnhntkiz`, stale `umi_cash` copy, drifted dashboard Prisma) | Reads from stale copy show wrong loyalty data; schema drift already real (missing `LifecycleEvent`) | umi-cash, umi-dashboard | Checklist Phases 4+6; until cutover, mark stale copy read-only and delete dashboard schema reads where possible                |
| C5  | `VOYAGE_API_KEY` missing in Supabase secrets                                                            | Production semantic product search silently degraded; 136 products' embeddings unused               | ConversaFlow runtime    | Set the secret (minutes); verify `embed-backfill`                                                                              |

### High (future migration risk)

| #   | Item                                                                                               | Impact                                                                                                   | Affected                 | Remediation                                                                                       |
| --- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------- |
| H1  | `.claude`/`.agents` adapter drift (§1.2)                                                           | Agents act on different rules per tool; promoted skills invisible in Claude sessions                     | Agent operating system   | Re-converge; declare one source and generate the other; add sync check to the maintenance rule    |
| H2  | `PLATFORM_TRANSITION_SCHEMA` dual paths ×41, file grew to 3,561 lines post-audit                   | Undocumented business rules may hide in `false` branches (risk register item in 05-23 audit)             | umi-dashboard            | Delete `false` branches route-group-by-route-group after staging verification (checklist Phase 4) |
| H3  | KDS pairing duplicate `callKdsPairingLocal` (`server.js:1276`)                                     | Security-sensitive logic forked; fixes won't propagate                                                   | dashboard ↔ conversaflow | Checklist Phase 5: route all pairing through canonical edge function                              |
| H4  | 8 Vercel crons outside job queue (`apps/umi-cash/vercel.json`)                                     | Invisible, non-retryable scheduled business actions (incl. birthday rewards w/ timezone risk)            | umi-cash                 | Checklist Phase 7: `pg_cron` → `workflow_jobs` → `job-worker`                                     |
| H5  | Landing leads in `better-sqlite3` (`src/lib/database/sqlite.ts`)                                   | Real lead/attribution data on ephemeral serverless disk if deployed                                      | umi-landing-page         | Checklist Phase 9: `platform.leads` + `lead_events`                                               |
| H6  | `DEFAULT_BUSINESS_ID` single-tenant ingress (`_shared/cors.ts:7`)                                  | Blocks second tenant onboarding to ConversaFlow                                                          | umi-conversaflow         | `conversaflow.channel_accounts` number→tenant resolution (transition plan §Ingress)               |
| H7  | `public.*` legacy schema + stale `umi_cash` copy still in production project                       | Confusion risk; accidental reads (dashboard connectivity audit shows dashboard _was_ reading `umi_cash`) | Umi Platform DB          | Post-cutover manual cleanup window (checklist Phase 8); until then, document as read-only         |
| H8  | Cron-vault key rotation pending (workspace memory: KDS refactor "needs manual key rotation first") | Old credentials potentially still valid                                                                  | Supabase project         | Execute rotation; verify `20260512220000_replace_cron_vault_auth.sql` assumptions                 |

### Medium (maintainability)

| #   | Item                                                                                                     | Remediation                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| M1  | Framework sprawl: Next 14 (cash) / 15 (landing) / 16 (logs); React 18/19; Prisma 5                       | Converge during monorepo adoption; not before                                                     |
| M2  | Repo/product naming drift (`375`, `supabase-edge-functions`, `conversaflow-logs`, pkg `umi-consultoria`) | Rename during monorepo import                                                                     |
| M3  | Stale ledger references (`umi-landing-page-1`, `platform/conversaflow/docs`)                             | Add "superseded" annotations per `cognitive-lifecycle.md` retention rule                          |
| M4  | Cash `User` model conflates customers/staff/admins/auth                                                  | Resolved by Phase 6 cutover mapping (User → `platform.contacts`/`platform.users`/`staff_members`) |
| M5  | ConversaFlow `ARCHITECTURE_TARGET.md` self-declares stale sections (slack-actions)                       | Prune or mark historical; `mini-harness-architecture.md` is canonical                             |
| M6  | Dashboard `Umi Dash.html` static shell as "behavior contract"                                            | Acceptable transitional spec; replace with screen-level acceptance checklist when hardening       |
| M7  | `umi-logs` should read `observability.*` post-migration, currently reads conversaflow tables             | Planned (centralization audit §2); sequence after staging                                         |

### Low (deferrable)

- `.DS_Store` at root; `apps/umi-kds/build/` output and `Manual Corporativo - UMI.pdf` (15 MB-class binary) in repo; generated Gemini images under `apps/umi-conversaflow/docs/assets/generated/`; unindexed `artifacts/` screenshots — add ignore rules when root goes under git.
- Encrypted prod dump (`prod-db-handoff-2026-05-13/…tar.gz.enc`) and local exec dump (`backups/…20260528_1004.dump`) at root — fine, but exclude from any future remote unless encrypted-at-rest policy is confirmed.
- KDS early-order UUID-as-item-name anomaly (program update §Anomaly) — cosmetic.

---

## Phase 6 — Coordination Analysis

The workspace is effectively operated by **one person** (git authors and `settings.local.json` paths all point to `juanlopez1`; the "business owner" in migration decisions is the operator of Kalala). Coordination friction is therefore _agent-coordination_ and _future-team_ friction, not interpersonal:

1. **Adapter drift = knowledge silo by tool.** Sessions in Codex-style tooling accrued ledger entries and skills that Claude sessions cannot see (§1.2). Delivery effect: agents re-derive context, mis-route work, or recreate skills that already exist. _This is the workspace's #1 self-inflicted coordination tax._
2. **Duplicated procedures** (3× task-router) mean three places to update one routing rule.
3. **Plan/checklist sprawl in `docs/migration/`** — 8 overlapping plans where the 05-23 checklist is the real driver. The `latest.md` index mitigates this well; keep it the single entrypoint and mark 04-15/05-14 docs historical.
4. **Three GitHub identities + two ssh aliases** — onboarding any second human (or CI) requires tribal knowledge of which alias pushes where.
5. **Documentation duplication is mostly _managed_** (root vs repo docs have explicit ownership rules), which is unusual and good — the governance layer (`authority.md` conflict rules) is the right mechanism; it just isn't being enforced on adapters.
6. **Knowledge fragility:** the richest institutional memory (routing ledgers, migration evidence, this audit's sources) lives in the unversioned root — C1 again.

---

## Phase 7 — Future State Architecture

### 7.1 Recommended platform structure (modular monolith first)

This follows the workspace's own bias ("Prefer one repo plus one database over introducing another repo or service" — `node-resolver.md`) and the user-stated default direction. **No new microservices are warranted by current scale** (tens of tickets, thousands of messages).

```text
One PostgreSQL database (7 schemas: platform/commerce/cash/conversaflow/kds/observability/+legacy until cutover)
│
├── Ingress & async runtime (KEEP as-is): umi-conversaflow edge functions
│     whatsapp-handler · job-worker · kds-command · kds-pairing · zettle-oauth-setup
│     — already the canonical event/job boundary; do not grow into admin CRUD
│
├── Admin/owner backend (CONSOLIDATE): one deployed Node API
│     = today's server.js, ported to deployable API routes co-located with umi-dashboard
│     serves platform.* identity, capabilities, tenant switching, admin reads
│     absorbs dashboard auth; calls kds-pairing instead of reimplementing it
│
├── Customer-facing product runtimes (KEEP separate deploys, shared DB):
│     umi-cash (wallet/pass/cert handling is legitimately app-local — audit §4)
│     umi-landing-page (writes platform.leads)
│
├── Clients: umi-kds (native, thin) · umi-dashboard UI · umi-logs (reads observability.*)
│
└── Scheduling: pg_cron → conversaflow.workflow_jobs → job-worker (replaces Vercel crons)
```

**Boundaries that should remain separate:** the edge-function ingress/job runtime (latency + deploy isolation justify it); umi-cash's wallet/cert runtime; the native KDS client. Everything else converges on the platform database + one admin backend.

### 7.2 Monorepo proposal

**Recommendation: pnpm workspaces + Turborepo**, adopted in roadmap Phase 5 (after backend consolidation):

- pnpm workspaces because all five JS apps already use npm-compatible manifests and divergent framework versions need per-app isolation with cheap hoisting control.
- Turborepo over Nx: this is a small-team, convention-light workspace; Turborepo's task-graph + remote-cache covers the need without Nx's generator/plugin weight. Nx becomes worth revisiting only if code-sharing across apps grows heavily typed and generated.
- Layout: keep `apps/*` as-is; add `packages/{db,contracts,adapters}`; `umi-kds/` stays in-tree but outside the JS pipeline (Xcode/CI handled separately); conversaflow's Deno functions keep their own deploy command (already `--workdir`-based).
- Import each repo with history (`git subtree add` or `git filter-repo` merges); retire the three-identity remote situation into one org.

**Tradeoff acknowledged:** a single repo couples deploy cadence visibility (everything sees everything) — acceptable and desirable at this team size; the federated-repo model's isolation benefits are not being used (all six repos were committed in one sweep anyway).

### 7.3 Backend strategy

Follow the 2026-05-23 centralization audit — it is correct and already research-backed:

1. Database consolidation leads; API consolidation follows.
2. Edge functions stay for ingress/async/device commands only.
3. One deployed admin backend (ported `server.js`), Prisma-or-SQL over `platform.*`.
4. `pg_cron` + `job-worker` for all scheduled business work.
5. One Twilio adapter, one email adapter in `_shared/`.
6. Supabase exit remains an _option_, not a project — keep contracts host-agnostic, set no date (matching the plan's stance).

---

## Phase 8 — Migration Roadmap

| Phase                                   | Objective                                   | Key deliverables                                                                                                                                                                                                               | Depends on                    | Risks                                                                               | Complexity  |
| --------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------- | ----------- |
| **1. Stabilization** (≈1–2 wks)         | Stop knowledge/data bleeding                | Root git repo (C1); Phase 4F + validation run (C2); `VOYAGE_API_KEY` set (C5); cron-vault key rotation (H8); adapter re-convergence (H1)                                                                                       | none                          | minimal — all additive                                                              | Low         |
| **2. Standardization** (≈2–3 wks)       | One identity, one index                     | Single GitHub org + remotes normalized; `docs/reports/latest.md` updated; stale plans marked historical (M3, M5); skills deduplicated to one canonical set + generated mirrors                                                 | 1                             | low                                                                                 | Low         |
| **3. Shared Foundations** (≈3–4 wks)    | Staging platform DB + first shared contract | Staged 7-schema DB (checklist Ph 2); dashboard backend deployable (Ph 3); tenant/capability API live against staging                                                                                                           | 1                             | env/secret handling outside local (audit risk register)                             | Medium      |
| **4. Backend Consolidation** (≈4–8 wks) | One data platform in production             | Dashboard schema cutover + dual-path deletion (Ph 4); KDS pairing dedup (Ph 5); **Cash cutover with soak** (Ph 6); crons → job queue (Ph 7); adapter cleanup + legacy/public removal (Ph 8); landing → PostgreSQL leads (Ph 9) | 3                             | Cash cutover is highest-risk (customer-facing loyalty); mitigations already written | High        |
| **5. Monorepo Migration** (≈1–2 wks)    | One repo, preserved history                 | pnpm+Turborepo workspace; subtree imports; CI/deploy repointing; renames (M2)                                                                                                                                                  | 4 (recommended), 2 (required) | deploy rewiring                                                                     | Medium      |
| **6. Platform Integration** (ongoing)   | Unified product ecosystem                   | `packages/{db,contracts,adapters}`; Logs on `observability.*` (M7); multi-tenant ingress via `channel_accounts` (H6); second tenant onboarded end-to-end                                                                       | 4–5                           | multi-tenant edge cases                                                             | Medium-High |
| **7. Optimization** (ongoing)           | Reduce cost/cognitive load                  | Framework convergence (M1); auth provider decision executed; optional Supabase exit steps as they pay off; eval substrate from traces (`docs/traces/index.md` future-use list)                                                 | 6                             | scope creep — gate via `scientific-research-check`                                  | Variable    |

The single most important sequencing rule, already encoded in the workspace and re-affirmed here: **finish backend/database consolidation before the monorepo move.** The monorepo is a packaging decision; the database is the product decision.

---

## Uncertainties and validation steps

1. **Live production state unverified.** All row counts/schema states cite documents dated 2026-04-15 → 2026-05-28. _Validate:_ run the Phase-3 inventory queries from `2026-05-14-postgresql-platform-integration-plan.md` against `UMI_CURRENT_DATABASE_URL` (note: a prior attempt was blocked because that env var was unset — `.claude` ledger 2026-05-14).
2. **Which KDS pairing path the dashboard actually executes** (edge call at `server.js:1175` vs local at `:1276`) depends on runtime env not inspected here. _Validate:_ trace one pairing action locally.
3. **Canonical adapter layer intent** (`.claude` vs `.agents`) — the `.agents` layer is newer but `CLAUDE.md` names `.claude/skills/` as "the current procedure layer." _Validate:_ owner decision; then enforce via the adapter-policy sync rule.
4. **Landing page production deployment status** (branch `staging`, no `vercel.json` in repo) — unclear whether SQLite risk H5 is latent or live. _Validate:_ check Vercel project settings.
5. **Why `umi-conversaflow` history is 7 commits on `architecture-v2`** — likely an intentional reset; if the old history exists on the remote, preserve it before monorepo import.
6. **Cash production drift since 2026-05-15 snapshot** (counts like 214 users will have moved). _Validate:_ re-dump before Phase 4 cutover; the soak-comparison step already covers this.

---

## Appendix — Primary evidence index

- Contracts: `AGENTS.md`, `WORKSPACE.md`, `docs/architecture/agent-operating-system.md`, `docs/governance/*`
- Migration program: `docs/migration/2026-05-15-optimized-database-transition-plan.md` (master), `docs/migration/2026-05-23-api-backend-centralization-execution-checklist.md` (active driver), `docs/architecture/2026-05-23-api-backend-centralization-audit.md` (ownership decisions), `docs/migration/local-postgres/*.sql`, `docs/migration/audit-output/*`
- History anchors: `docs/migration/2026-04-15-*.md`, `docs/updates/2026-04-15-kds-program-update.md`, `docs/architecture/2026-04-19-partial-cancellation-completion-plan.md`, `docs/architecture/2026-05-11-kds-system-audit.md`, `docs/architecture/2026-05-12-overall-refactor-final-prompt.md`
- Duplication evidence: `apps/umi-dashboard/server.js` (3,561 lines; `PLATFORM_TRANSITION_SCHEMA` ×41; `callKdsPairingLocal` :1276), `apps/umi-dashboard/prisma/schema.prisma` vs `apps/umi-cash/prisma/schema.prisma`, `apps/umi-cash/vercel.json` (8 crons), `apps/umi-landing-page/src/lib/database/sqlite.ts`
- Drift evidence: `diff .claude/skills/task-router/* .agents/skills/task-router/*`; ledger entry counts 6 vs 15; registry skill counts 3 vs 6
- Repo states: per-app `git log`/`git remote` captured 2026-06-09 (all HEADs dated 2026-05-28)
