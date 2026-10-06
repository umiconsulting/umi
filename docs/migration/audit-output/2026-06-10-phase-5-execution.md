# Phase 5 — Monorepo Migration: Execution Evidence and Stopper Register

**Date:** 2026-06-10
**Driver:** `docs/migration/2026-06-09-workspace-integration-implementation-plan.md` (Phase 5)
**Mode:** S5.1 executed; S5.2 executed as an isolated rehearsal (full import gated); S5.3 assessed, not executed. All stoppers below.

Program rule 1 (sequencing invariant: database → backend → monorepo) gates the _cutover_ of Phase 5, not its rehearsal. Everything executed here is additive at the workspace root or isolated in `/tmp`; no app repo behavior, deploy, or remote layout changed (one exception: umi-kds received the commit of already-executed S2.3 work — see F2).

---

## S5.1 — Workspace tooling: EXECUTED

Research check (per the S5.1 mandate to re-verify the 2026-06-09 recommendation at execution time):

- **Documented fact:** Turborepo supports pnpm/npm/yarn/bun; requires a root `packageManager` field; tasks defined in `turbo.json` (turborepo.dev "Add to existing repository", fetched 2026-06-10 — note the docs moved from turborepo.com to turborepo.dev). pnpm workspaces default to one shared root lockfile (`sharedWorkspaceLockfile: true`, pnpm.io/workspaces). Vercel deploys multiple projects from one repo via per-project Root Directory; skip-unaffected builds require GitHub, JS workspace conventions, and unique package names (vercel.com/docs/monorepos, last updated 2026-03-17).
- **Source-backed tradeoff:** directories without `package.json` (umi-kds Swift app, umi-conversaflow Supabase functions) are simply not workspace members — no stub packages added speculatively.
- **Umi-specific inference:** tooling files at root are inert for the apps' current npm workflows (npm ignores `pnpm-workspace.yaml`; apps' own `package.json` files carry no `packageManager` field), so committing them before Phase 4 closes is safe.

Delivered (root commit `0eae9e7`): `package.json` (private, `pnpm@10.29.3`, `turbo ^2.8.8`), `pnpm-workspace.yaml` (`apps/*`), `turbo.json` (build/lint/test/dev), `.turbo/` gitignored.

Validation (run against the rehearsal monorepo, not the live root — see S5.2): `pnpm install --lockfile-only` resolved **1,543 packages** into one shared lockfile with no resolution errors; `turbo run build --dry` discovered all four JS packages (`umi-cash`, `umi-dashboard`, `umi-consultoria`, `conversaflow-logs`) and built the task graph; conversaflow and KDS correctly excluded.

**Deliberately not done at the live root:** no `pnpm install` (would create root `node_modules`/lockfile while apps still run npm dev workflows mid-Phase-4), no per-app lockfile conversion. Activation belongs to the import cutover.

## S5.2 — History-preserving imports: REHEARSED, full import gated

Mechanic proven in `/tmp/umi-phase5-rehearsal` (clone of the root repo): per app, `git clone --no-local` → `git-filter-repo --to-subdirectory-filter apps/<name>` → `git merge --allow-unrelated-histories`.

Evidence:

| Repo             | Branch imported | Commits preserved           |
| ---------------- | --------------- | --------------------------- |
| umi-cash         | main            | 218/218                     |
| umi-conversaflow | architecture-v2 | 7/7                         |
| umi-dashboard    | main            | 4/4                         |
| umi-kds          | main            | 11/11 (incl. new `789bae5`) |
| umi-landing-page | staging         | 21/21                       |
| umi-logs         | main            | 5/5                         |

Rehearsal total: 279 commits = 7 root + 266 imported + 6 merge commits — exact. History appears natively under `apps/<name>` (no `--follow` needed) because filter-repo rewrites paths; this is why filter-repo beats `git subtree` here (subtree keeps original root paths in old commits, so per-path log/blame degrade).

Two mechanics lessons captured for the final run:

1. `git clone` of a local path uses hardlinks and **filter-repo refuses to run on it** — the first rehearsal attempt merged _unrewritten_ trees and collided at root paths (`AGENTS.md`, `CLAUDE.md`, `package.json`). Always `--no-local`.
2. `git-filter-repo` is not preinstalled; installed via Homebrew (pip is PEP-668-blocked on this machine).

## S5.3 — Renames + deploy repointing: ASSESSED, blocked

- GitHub repo renames pending: `supabase-edge-functions` → umi-conversaflow, `conversaflow-logs` → umi-logs. `gh` is authenticated as `umi-juanlopez` (repo scope); renames need org-admin on `umiconsulting` and should land together with the push-matrix update (`docs/governance/github-push-matrix.md`). GitHub auto-redirects old names, so risk is low — but it is an owner/org action.
- Package renames pending: `umi-consultoria` → umi-landing, `conversaflow-logs` → umi-logs (both visible as stale names in the rehearsal turbo graph). Deferred to import cutover so no push to a standalone repo triggers a deploy without owner approval.
- `375.xcodeproj` → umi-kds rename: local Xcode work at cutover; KDS has no CI to repoint.
- Vercel repointing: **nothing to repoint** — see ST-3.

---

## Stopper register

### Hard stoppers (block Phase 5 cutover)

- **ST-1 — Sequencing invariant: Phase 4 incomplete.** S4.2 (KDS pairing dedup), S4.3 (Cash cutover — owner-gated), S4.4 (crons → job queue — owner approval for Vercel cron deletion), S4.5, S4.6 all open. Program rule 1 says monorepo comes last; cutting over now would split development between standalone repos (where Phase 4 work and deploys live) and the monorepo — dual-source drift with no compensating benefit.
- **ST-2 — No root/monorepo GitHub remote.** No `umiconsulting` repo exists for the workspace (confirmed in Phase 2 under `Umi`, `umi`, `umi-workspace`). The monorepo has nowhere to push. Owner decision needed: monorepo repo name; then org-side creation.
- **ST-3 — No Vercel deploy targets under the consolidated identity.** Vercel account `juanclpzq` (sole scope `juans-projects-1d7e9ef2`) has **zero projects** (re-confirmed 2026-06-10, consistent with the S1.6 addendum). Dashboard has no Vercel project (S3.2 exit gate still open); landing has never been deployed (and S4.6 leads→PostgreSQL must land before its first production deploy — H5); Cash's crons, if deployed, live under a different/unknown Vercel identity. S5.3 "repoint rootDirectory per app" is unexecutable until these projects exist under one identity.
- **ST-4 — Offensive commit message in pushed history.** `umi-conversaflow` commit `9df2c40` has a racial slur as its commit message. It is an **ancestor of `architecture-v2`** — the import branch — and is already on `origin/architecture-v2` (github.com `umiconsulting/supabase-edge-functions`); local `main` carries it too (`origin/main` does not). Any unfiltered import makes it permanent monorepo history. A full-text scan of all six repos' commit subjects found **no other** offensive messages. Remediation at import time: add `--replace-message` to the filter-repo step (e.g. `nigga==>wip: edge function debugging`); separately, owner should approve rewriting the standalone repo (`git-filter-repo --replace-message` + force-push of `architecture-v2`/`main`) so the slur leaves GitHub history — destructive force-push, **owner go-ahead required**.
- **ST-5 — Phase 1 still not closed (S1.4).** The manual service_role key rotation remains pending (owner action in the Supabase dashboard + `vault.update_secret`). The plan orders it before S4.2, which precedes any Phase 5 cutover.

### Soft stoppers / decisions to record before cutover

- **ST-6 — Landing import/deploy branch.** Remote default branch is `staging` (10 commits ahead of `main`, 0 behind). Rehearsal imported `staging`. Decide: merge `staging` → `main` pre-import, or import `staging` and retire `main`.
- **ST-7 — Conversaflow branch topology.** Real history lives on `architecture-v2`; `origin/main` is only the initial commit; local `main` additionally carries `9df2c40` (see ST-4). Decide: fast-forward/merge `architecture-v2` → `main` (post-rewrite) before import, or import `architecture-v2` directly.
- **ST-8 — npm → pnpm conversion per app.** All four JS apps use `package-lock.json`. Lockfile-only resolution is proven; real `pnpm install` + per-app builds + Vercel install/build command settings remain to be validated at cutover. Vercel skip-unaffected additionally requires unique package names — satisfied once ST-9 renames land.
- **ST-9 — Renames batch (S5.3).** GitHub repo renames (org-admin), package.json renames, `375.xcodeproj` rename, push-matrix update — one batch at cutover.
- **ST-10 — umi-kds had uncommitted S2.3 work** (task-router dedup, recorded as executed in Phase 2 but never committed). **Resolved today:** committed and pushed as `789bae5`. Residual lesson: "executed" phase steps must end with clean trees in every touched repo — added to the phase-checkpoint habit.

### Resolved non-stoppers

- umi-conversaflow pre-reset history: does not exist (S1.6 addendum) — nothing to recover.
- Tooling versions: pnpm 10.29.3 / turbo 2.8.8 / git 2.52.0 current as of today; `git-filter-repo` now installed via Homebrew.

---

## Three-lens record

- **Customer:** zero production behavior change — no app deploy, remote, or runtime touched; rehearsal fully isolated in `/tmp`. (The umi-kds push contained only agent-procedure files; KDS has no CI.)
- **Brand:** ST-4 is the brand-lens find of the phase — a slur in org-visible GitHub history contradicts everything the suite claims about professionalism; flagged with a concrete remediation instead of silently importing it. Repo/package renames (brand-name alignment) staged behind owner-gated stoppers.
- **Code:** import mechanic proven with exact commit-count conservation (279 = 7+266+6); workspace tooling validated by lockfile resolution (1,543 packages) and turbo task-graph discovery; all claims above cite the rehearsal or live command output from 2026-06-10.

## Phase 5 cutover runbook (when ST-1…ST-5 clear)

1. Rotate service_role (ST-5), finish S4.2–S4.6 (ST-1).
2. Owner: create monorepo repo (ST-2), approve conversaflow history rewrite (ST-4), pick landing branch (ST-6).
3. Re-run the rehearsal script against fresh clones **with** `--replace-message` for conversaflow; stop ignoring `apps/` in root `.gitignore`; verify counts (expect 279+ commits).
4. Convert lockfiles (`pnpm install`), run real `turbo run build` per app, commit shared lockfile.
5. Renames batch (ST-9); push monorepo; create/repoint Vercel projects with per-app `rootDirectory` (ST-3); Supabase deploys via `--workdir` unchanged.
6. Per-app deploy verification (customer lens: zero behavior change), then archive standalone repos read-only.
