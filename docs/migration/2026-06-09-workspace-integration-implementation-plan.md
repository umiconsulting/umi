# Workspace Integration Implementation Plan

**Date:** 2026-06-09
**Class:** Active program driver (orchestrator)
**Source audit:** `docs/reports/workspace-integration-audit.md` (2026-06-09)
**Relationship to existing docs:** This plan sequences and gates the work. The database-track execution detail stays in `docs/migration/2026-05-23-api-backend-centralization-execution-checklist.md` (referenced below as "the 05-23 checklist"); this plan does not duplicate its checkboxes, it wraps them in phases, three-lens validation, and skill-lifecycle discipline.

---

## Decision basis

Per the workspace research standard (`AGENTS.md` §Research standard):

- **Documented fact:** the audit's findings are evidence-cited (root unversioned; migration parked at Phase 4F; `.claude`/`.agents` adapter drift; Cash triple data surface; `VOYAGE_API_KEY` unset). The 05-23 checklist's two blocking human decisions are resolved.
- **Source-backed tradeoff:** database consolidation before API consolidation, and backend consolidation before monorepo migration (05-23 centralization audit; reaffirmed by the 2026-06-09 audit's sequencing rule).
- **Umi-specific inference:** at current scale (one operator, one production tenant), per-step validation effort is cheaper than any production rollback; therefore every step below carries an explicit three-lens check even when it looks like overhead.
- **Invalidation criteria** (per the `scientific-research-check` output contract — revisit this plan's sequencing if any of these become true):
  - a second tenant must onboard before Phase 4 completes (would force pulling S6.3 ingress work forward);
  - Cash production drift makes the 2026-05-15 snapshot unusable for mapping (would force an early re-dump and possibly re-running parts of Phase 4E locally);
  - the dashboard backend's chosen host cannot meet the heaviest read paths (would reopen the S3.2 shape decision);
  - the three-lens protocol degenerates into checkbox theater across two consecutive steps (would trigger pruning `three-lens-release-review` and slimming the protocol to customer-facing steps only).

---

## Per-step iteration protocol (mandatory)

Every step in this plan iterates through `scientific-research-check` at **three levels** before the step's exit criterion is declared met. A step is not done when the code works; it is done when all three lenses have recorded evidence.

### Lens definitions

| Lens | Question | Who the "customer" is per surface | Evidence types |
|---|---|---|---|
| **Customer** | Does the end user's experience stay intact or improve? | ConversaFlow/Cash/KDS-tickets: Café Kalala's diners and loyalty members. Dashboard/Logs: the tenant owner/operator. Landing: prospective business clients. | Production traces, soak comparisons, replayed conversation flows, wallet pass round-trips, screen walkthroughs |
| **Company/brand** | Does this advance Umi's position as a connected restaurant-operations suite and protect tenant trust? | Umi the business + the tenant's brand voice (see `feedback_no_hardcoded_user_messages`: all customer-visible text in business voice). | Positioning docs, owner-workflow review, multi-tenant readiness check, data-integrity claims that marketing can stand behind |
| **Code** | Is the implementation correct per primary sources, and does it pass the workspace's validation gates? | Future maintainers and agents. | Official platform docs, validation SQL, builds/tests, schema diffs, the research-check output format (documented fact / source-backed tradeoff / Umi-specific inference) |

### Iteration loop per step

1. **Before:** run `task-router` (owner + path), then `scientific-research-check` on any structural choice inside the step. Record the three-layer decision basis.
2. **During:** keep changes additive where the migration policy requires it (no destructive schema changes before validated cutover).
3. **After:** walk the three lenses with real evidence; if any lens fails, iterate the step — do not advance the phase.
4. **Record:** append a `routing-ledger.md` entry (written identically to `.claude` and `.agents` mirrors until the canonical-layer decision in S1.5 is executed).
5. **Harvest:** evaluate `promotion-criteria.md`; if a pattern recurs across traces, promote a skill. If it is promising but not yet recurring, plant it in `skill-seeds.md` (the observation ledger created with this plan).

### Skill lifecycle rules for this program

- **Promote** when the promotion gate passes (≥2 successful ledger traces, stable procedure, stable owner, no project-local duplicate).
- **Seed** when a pattern is observed once or is anticipated by upcoming phases. Seeds live in `.claude/skills/task-router/skill-seeds.md` (mirrored in `.agents/`).
- **Review checkpoint** at the end of every phase: re-read the ledger entries written during the phase, promote what now qualifies, prune seeds that turned out to be one-offs, and record the review itself as a ledger entry.

---

## Phase 1 — Stabilization (target: ≈1–2 weeks)

Goal: stop knowledge and data bleeding. All steps additive, low risk.

### S1.1 Version-control the workspace root (audit C1)
- Actions: `git init` at `/Umi`; `.gitignore` for `.DS_Store`, `apps/*` (six independent repos for now), `backups/`, `prod-db-handoff-2026-05-13/`, `artifacts/` screenshots, build outputs; initial commit of root docs, skills, migration SQL; private remote under the single org chosen in S2.1 (remote push can wait for S2.1).
- Research check (code lens): confirm ignore-vs-exclude strategy for nested repos against official git docs; decide nothing about subtrees yet (that is Phase 5).
- Customer lens: indirect — institutional memory that explains production behavior becomes loss-proof.
- Brand lens: the migration evidence trail (synthetic-data quarantine, validation results) becomes citable and durable.
- Exit: `git log` shows the initial commit; encrypted dumps and app repos excluded; no decrypted data tracked.

### S1.2 Execute migration Phase 4F + core validation (audit C2)
- Actions: run Phase 4F as the audit/no-import gate per the 05-23 checklist Phase 1, using `docs/migration/audit-output/2026-05-16-public-compatibility-legacy-audit.md` as the source checklist; run `docs/migration/validation/001_core_validation.sql`; record final local row counts.
- Customer lens: confirms zero synthetic rows can surface in customer-facing loyalty/order data.
- Brand lens: "production-verified data only" becomes a defensible claim for the platform.
- Code lens: zero blocking validation violations; counts recorded inline in the 05-23 checklist.
- Exit: 05-23 checklist Phase 1 boxes checked; local transition DB ready to reproduce in staging.

### S1.3 Restore semantic search (audit C5)
- Actions: set `VOYAGE_API_KEY` in the Supabase dashboard (manual); verify `embed-backfill`; confirm the semantic stage executes in a real product-search trace.
- Customer lens: a diner asking ConversaFlow for "algo dulce sin gluten" gets semantic matches over 136 embedded products instead of degraded lexical fallback. Validate with a real WhatsApp query trace before/after.
- Brand lens: the AI-assistant quality promise is the core of the suite's positioning; silent degradation contradicts it.
- Code lens: secret present, stage enabled, no errors in `observability` traces.
- Exit: one production trace showing the semantic stage active.

### S1.4 Cron-vault key rotation (audit H8)
- Actions: execute the manual key rotation noted in workspace memory; verify the assumptions of `20260512220000_replace_cron_vault_auth.sql`.
- Customer lens: kitchen command surface stays authenticated → order flow reliability.
- Brand lens: closes the last open item of the KDS security refactor story.
- Code lens: old credentials invalid; scheduled functions still authenticate.
- Exit: rotation done; one scheduled invocation verified post-rotation.

### S1.5 Adapter re-convergence (audit H1) — **requires owner decision**
- Decision needed: canonical procedure layer — `.claude/` (named by `CLAUDE.md`) vs `.agents/` (newer content: 15 ledger entries, 6 registered skills). Recommendation: declare `.agents/` (neutral, multi-vendor) the source and make `.claude/` a generated mirror, then fix `CLAUDE.md` wording; reverse is also workable — what matters is one source plus a sync check.
- Actions: copy the newer registry/ledger/skills into the lagging layer; fix the phantom `.Codex/` reference in the `.agents` task-router; add a sync step to the maintenance rule in `agent-operating-system.md`.
- Customer/brand lens: indirect — agents acting on consistent rules stop re-deriving context and mis-routing customer-affecting work.
- Code lens: `diff -r` of the two skill trees is empty (or generated-mirror delta only).
- Exit: one source declared in writing; mirrors verified identical; sync rule documented.

### S1.6 Cheap uncertainty burn-down (audit §Uncertainties)
- Actions: set `UMI_CURRENT_DATABASE_URL` and run the Phase-3 inventory queries against live production (uncertainty 1); trace one dashboard pairing action to learn which path executes (uncertainty 2); check the landing page's Vercel project state (uncertainty 4); check whether `umi-conversaflow` pre-reset history exists on the remote (uncertainty 5).
- Exit: each answer recorded in the audit doc or a dated addendum; surprises become new debt-register items before Phase 3 locks scope.

**Phase 1 skill checkpoint:** ledger review; expected promotion candidate: *adapter-sync-check* (drift observed twice: audit + this program setup). Expected new seeds: see initial seed list in `skill-seeds.md`.

---

## Phase 2 — Standardization (target: ≈2–3 weeks)

### S2.1 One GitHub identity
- Actions: pick one org (recommend `umiconsulting`); normalize the six remotes and ssh aliases; document the push matrix in root docs.
- Brand lens: one public-facing engineering identity.
- Code lens: every repo pushes/pulls with the same credentials; documented.
- Exit: `git remote -v` across all repos shows one org, one alias scheme.

### S2.2 Index hygiene and historical marking
- Actions: update `docs/reports/latest.md` to point at this plan as the active driver; mark 2026-04-15 and 2026-05-14 migration plans historical per `cognitive-lifecycle.md`; add "superseded" annotations to stale ledger references (`umi-landing-page-1`, `platform/conversaflow/docs`) (audit M3, M5).
- Customer lens: n/a. Brand lens: n/a (internal).
- Code lens: a fresh agent loading `latest.md` lands on current truth in one hop.
- Exit: no index points at a dead path.

### S2.3 Skill deduplication
- Actions: collapse the three `task-router` copies to one canonical + generated mirrors (root, per S1.5 decision; evaluate whether the KDS-local copy should become a thin pointer to root); deduplicate KDS `.claude`/`.agents` skill sets the same way.
- Code lens: one routing rule edit propagates everywhere.
- Exit: zero divergent copies of any skill.

**Phase 2 skill checkpoint:** ledger review; evaluate seed *ledger-mirroring* for promotion (it will have ≥2 traces by now if S1.5 and S2.3 both exercised it).

---

## Phase 3 — Shared Foundations (target: ≈3–4 weeks)

### S3.1 Staging 7-schema database (05-23 checklist Phase 2)
- Actions: create staging PostgreSQL (Supabase staging or standalone — run `scientific-research-check` on this choice against current Supabase branching/staging docs before committing); apply `001`–`007` schema scripts, `010`–`044` backfills; apply the Phase 4F exclusion; run validation; compare counts to local.
- Customer lens: none yet (staging) — but this is the gate that protects every later customer-facing cutover.
- Brand lens: staging discipline is what makes the Cash cutover (S4.3) defensible to the tenant.
- Code lens: staging matches local transition DB and passes validation.
- Exit: 05-23 checklist Phase 2 boxes checked.

### S3.2 Dashboard backend deployable (05-23 checklist Phase 3; audit C3)
- Actions: choose the deployment shape — audit recommendation: API routes co-located with the dashboard app on Vercel-class hosting. Run `scientific-research-check` (official Vercel/Express/Next docs) on: Express-in-serverless constraints, function duration limits for the heaviest dashboard reads, env/secret handling outside local (the audit's named risk). Then add deploy config, build check, and frontend API base URL config.
- Customer lens (= tenant owner): the owner can finally reach their dashboard from outside the developer's machine.
- Brand lens: an undeployable owner product is the suite's biggest credibility gap; this closes it.
- Code lens: backend reachable in a non-local environment; secrets verified.
- Exit: 05-23 checklist Phase 3 boxes checked.

### S3.3 Tenant/capability API (first shared contract)
- Actions: implement `GET /api/me/tenants` and `GET /api/tenants/:id/capabilities` against staging (transition plan Phase 5); consume from the dashboard.
- Customer lens (= tenant owner): tenant switching resolved by membership, not env vars.
- Brand lens: first concrete multi-tenant artifact — the suite stops being single-tenant in shape.
- Code lens: contract documented; dashboard consumes it in `PLATFORM_TRANSITION_SCHEMA=true` mode.
- Exit: both endpoints live against staging with the dashboard as consumer.

**Phase 3 skill checkpoint:** expected seed maturation: *staging-validation-runner* (validation procedure now run twice: local + staging). Promote if the procedure held stable.

---

## Phase 4 — Backend Consolidation (target: ≈4–8 weeks; highest risk)

Order within this phase is deliberate: dashboard (internal-facing) cuts over before Cash (customer-facing), so the cutover procedure is rehearsed where the blast radius is small.

### S4.1 Dashboard schema cutover + dual-path deletion (05-23 checklist Phase 4; audit H2)
- Actions: point the deployed backend at staging; verify all 13 screen flows in `PLATFORM_TRANSITION_SCHEMA=true`; delete `false` branches route-group-by-route-group **after** verification; remove the duplicate Cash Prisma schema (audit C4 partial).
- Customer lens (= tenant owner): every screen walkthrough recorded — orders, members, customers, conversations, devices, staff, hours, gift cards.
- Brand lens: owner sees live platform truth, not a stale `umi_cash` copy.
- Code lens: zero `PLATFORM_TRANSITION_SCHEMA` references remain; duplicate schema deleted; the 3,561-line `server.js` shrinks measurably.
- Exit: 05-23 checklist Phase 4 boxes checked.

### S4.2 KDS pairing deduplication (05-23 checklist Phase 5; audit H3)
- Actions: remove `callKdsPairingLocal`; route pairing through canonical `kds-pairing`; local dev via `supabase functions serve`.
- Customer lens: kitchen iPad pairing still works end-to-end (PIN, approval, token, session) — verify on the physical device.
- Code lens: one implementation; security fixes propagate.
- Exit: 05-23 checklist Phase 5 boxes checked.

### S4.3 Cash schema cutover with soak (05-23 checklist Phase 6; audit C4) — **highest customer risk in the program**
- Actions: per the 05-23 checklist Phase 6 mapping table; run all API routes against staging; verify card lookup, points, redemption, gift cards, QR, Apple/Google Wallet, push, auth; **re-dump production before cutover** (audit uncertainty 6 — the 2026-05-15 snapshot is stale); soak-compare old vs new responses; deprecate `rrkzhisnadfrgnhntkiz` to read-only only after counts and core operations match.
- Customer lens: loyalty members' balances, passes, and gift cards are the most tangible thing customers hold; the soak comparison is the customer lens, executed as engineering.
- Brand lens: a wrong loyalty balance is a direct tenant-brand injury; do not rush the soak window.
- Code lens: row counts match; core operation parity; old project read-only.
- Exit: 05-23 checklist Phase 6 boxes checked.

### S4.4 Crons → observable job queue (05-23 checklist Phase 7; audit H4)
- Actions: `job-worker` processors for birthday/expiry/goal-proximity; `pg_cron` schedules into `conversaflow.workflow_jobs`; per-tenant timezone via `AT TIME ZONE`; delete Vercel cron routes.
- Customer lens: birthday rewards arrive on the customer's birthday in their timezone — test the timezone path explicitly.
- Brand lens: a missed or duplicated birthday reward is a visible brand failure; retryability fixes the failure mode.
- Code lens: jobs visible in `umi-logs`; retryable; Vercel crons gone.
- Exit: 05-23 checklist Phase 7 boxes checked.

### S4.5 Adapter cleanup + legacy removal (05-23 checklist Phase 8; audit H7)
- Actions: per the 05-23 checklist Phase 8 — canonical email/Twilio adapters, synthetic row-family deletion (only where cleanly identifiable end-to-end), `legacy.*` deletion after soak, `public.*` removal after confirming no reads.
- Customer lens: message delivery paths unchanged from the customer's view (verify one gift-card WhatsApp delivery through the canonical adapter).
- Code lens: no duplicate write paths; compatibility schemas gone.
- Exit: 05-23 checklist Phase 8 boxes checked.

### S4.6 Landing leads → PostgreSQL (05-23 checklist Phase 9; audit H5)
- Actions: `platform.leads` + `lead_events` per the checklist's field list; migrate from SQLite before any production deploy of the landing app.
- Customer lens (= prospective client): a submitted diagnostic/contact form is never silently lost to an ephemeral serverless disk.
- Brand lens: losing a sales lead at first contact is the worst possible first impression for a company selling operational reliability.
- Code lens: SQLite is local/test only; attribution fields durable.
- Exit: 05-23 checklist Phase 9 boxes checked.

**Phase 4 skill checkpoint:** expected promotion candidate: *cutover-soak-comparison* (executed for dashboard and Cash). Review whether `customer-identity-resolution` needs updates after the Cash `User` → `platform.contacts`/`platform.users` mapping (audit M4).

---

## Phase 5 — Monorepo Migration (target: ≈1–2 weeks; only after Phase 4)

### S5.1 Workspace tooling
- Actions: pnpm workspaces + Turborepo at root (audit §7.2); run `scientific-research-check` against current pnpm/Turborepo docs at execution time (the audit's tool recommendation is dated 2026-06-09 — re-verify before acting).
### S5.2 History-preserving imports
- Actions: subtree/filter-repo imports of all six repos (Cash's 218 commits are the ones worth the care); preserve `umi-conversaflow` pre-reset history if S1.6 found it.
### S5.3 Renames and CI/deploy repointing
- Actions: `375` → umi-kds, `supabase-edge-functions` → umi-conversaflow, package `umi-consultoria` → umi-landing (audit M2); repoint Vercel `rootDirectory` per app; Supabase `--workdir` deploys already monorepo-friendly.
- Customer lens: zero production behavior change — deploys verified per app post-move.
- Brand lens: repo names finally match product names.
- Code lens: every app deploys from the monorepo; history preserved.
- Exit: one repo, one org, all deploys green.

---

## Phase 6 — Platform Integration (ongoing)

- S6.1 Extract `packages/{db,contracts,adapters}` (audit §2.3 register drives what moves first). Code lens: each extraction must remove a duplication-register item, not add an abstraction speculatively.
- S6.2 `umi-logs` reads `observability.*` (audit M7). Customer lens (= operator): trace/jobs/outbox browsing parity verified screen by screen before the old reads are removed.
- S6.3 Multi-tenant ingress: retire `DEFAULT_BUSINESS_ID` via `conversaflow.channel_accounts` number→tenant resolution (audit H6). **Customer lens is critical here:** a wrong number→tenant resolution sends a diner's order — and the business-voice reply — to the wrong tenant. Exit requires negative tests (unknown number, ambiguous number, tenant with no channel account) before any second tenant goes live. Brand lens: cross-tenant leakage is the single worst trust failure a multi-tenant platform can have.
- S6.4 **Second tenant onboarded end-to-end** — this is the program's true exit test across all three lenses at once: a new business's customers order via WhatsApp (customer), the suite demonstrably serves more than Kalala (brand), and no single-tenant shortcuts remain (code).

---

## Phase 7 — Optimization (ongoing, gated)

- Framework convergence (audit M1), auth provider decision execution, optional Supabase exit steps only as they pay for themselves, eval substrate from `observability` traces.
- Every item here must pass `scientific-research-check` before scoping — this phase is where scope creep lives (audit Phase-7 risk note).

---

## Program-level rules

1. **Sequencing invariant:** database consolidation → backend consolidation → monorepo. Never reorder (audit §8; 05-23 audit).
2. **No phase advances with a failed lens.** Iterate the step instead.
3. **Ledger discipline:** every step writes a routing-ledger entry; every phase ends with a promotion/seed review; observations land in `skill-seeds.md` the moment they occur, not at phase end.
4. **Decisions pending owner input:** canonical adapter layer (S1.5), GitHub org (S2.1), staging host (S3.1), auth provider (Phase 7). Each blocks only its own step.

## Status

- [ ] Phase 1 — Stabilization — **executed 2026-06-10**; S1.1/S1.2/S1.3/S1.5/S1.6 complete with three-lens evidence (see ledger entry "Phase 1 stabilization execution"); S1.4 remains open on one owner-manual action: roll the service_role key in the Supabase dashboard, then `select vault.update_secret(id, new_secret := '<new-jwt>')` for `service_role_key` and update dependent app `.env` files — all three cron jobs that need service_role now read it from Vault, so no SQL changes are needed post-roll. Phase 1 closes when one scheduled invocation succeeds after rotation.
- [x] Phase 2 — Standardization — **executed 2026-06-10**; S2.1/S2.2/S2.3 complete for the six app repos and procedure layers: all app remotes use `git@github.com-umi:umiconsulting/...`; push matrix recorded in `docs/governance/github-push-matrix.md`; `latest.md` and historical migration docs updated; stale ledger path references annotated; KDS local task-router reduced to a root-router pointer; `.agents` canonical layers mirrored into `.claude` with empty diffs. Root workspace GitHub remote remains intentionally unset because no existing `umiconsulting` root repo was found under `Umi`, `umi`, or `umi-workspace`.
- [ ] Phase 3 — Shared Foundations — **executed 2026-06-10, not fully closed**; S3.1 standalone PostgreSQL staging rehearsal passed core validation with documented synthetic-family count deltas; S3.3 tenant/capability endpoints validated against staging; S3.2 deployability config/build complete but the non-local reachability exit gate remains open because no Vercel project/staging database secrets exist yet. See `docs/migration/audit-output/2026-06-10-phase-3-execution.md`.
- [ ] Phase 4 — Backend Consolidation
- [ ] Phase 5 — Monorepo Migration
- [ ] Phase 6 — Platform Integration
- [ ] Phase 7 — Optimization
