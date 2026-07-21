# Skill Seeds

Observation ledger for **potential** skills. A seed is a pattern observed too few times to pass `promotion-criteria.md`, recorded so the signal is not lost. This file is the staging area between "reusable pattern observed" in `routing-ledger.md` and a promoted skill in `registry.md`.

## Rules

- Plant a seed the moment a pattern is observed, not at phase end.
- A seed needs evidence: cite the ledger entry, audit section, or plan step where it appeared.
- At every phase checkpoint of the active program plan, review all seeds: promote what now passes the gate, update counts, and **prune seeds that turned out to be one-offs** — a pruned seed is recorded as pruned, not deleted, so the negative result is kept.
- Seeds are written to `.agents/` (canonical source, per the S1.5 decision of 2026-06-10); `.claude/skills/` is a symlink into `.agents/skills/` — write only under `.agents/`.

## Entry template

```md
### <seed-name>
- status: seed | promoted | pruned
- observed: <evidence citations with dates>
- trigger pattern: <when an agent would reach for this>
- procedure sketch: <2-4 lines of what the skill would do>
- promotion gate: <what recurrence/stability is still missing>
- expected maturation: <which plan step/phase will produce the next trace>
```

## Current seeds

### adapter-sync-check
- status: **promoted** (Phase 1 checkpoint, 2026-06-10 → `.agents/skills/adapter-sync-check/`)
- observed: 2026-06-09 audit §1.2 verified `.claude`/`.agents` drift by diff (6 vs 15 ledger entries, 3 vs 6 registered skills, phantom `.Codex/` reference); 2026-06-10 S1.5 re-convergence executed the full procedure (union ledger merge, `.Codex` fix, checksum mirror regeneration — and caught that `rsync -a` quick-check silently skips real drift, hence `-c`).
- trigger pattern: any write to a root skill, registry, or ledger; periodic workspace health checks.
- procedure sketch: diff the adapter trees, classify deltas by side, union-merge into `.agents/`, regenerate mirror with `rsync -ac --delete`, verify empty `diff -r`.
- promotion gate: passed — 2 successful traces, stable procedure, stable owner (workspace root), no project-local duplicate.
- expected maturation: done; S2.3 will exercise it again for project-local skill trees.

### ledger-mirroring
- status: pruned into `adapter-sync-check` (Phase 2 checkpoint, 2026-06-10)
- observed: 2026-06-09 audit ledger entry ("ledger entries should be written to the neutral source and mirrored, not written per-adapter"); same pattern re-executed for this plan's ledger writes.
- trigger pattern: recording any cross-workspace trace while two adapter layers exist.
- procedure sketch: write once to the declared neutral source, generate mirrors, verify identical content.
- promotion gate: failed as a standalone skill because the procedure is a subset of `adapter-sync-check` after S1.5 and S2.3.
- expected maturation: done; keep using `adapter-sync-check` for write-once/mirror/verify work.
- 2026-06-10 update: Phase 2 exercised ledger mirroring and KDS adapter mirroring; both used the same canonical-source/generated-mirror procedure. No separate skill promoted.

### staging-validation-runner
- status: **promoted** (Phase 3 checkpoint, 2026-06-10 → `.agents/skills/staging-validation-runner/`)
- observed: `001_core_validation.sql` + row-count comparison will run at least three times with the same shape: local (plan S1.2), staging (S3.1), production cutovers (S4.1/S4.3). One historical trace exists (2026-05-15 plan inline results).
- trigger pattern: any environment promotion of the 7-schema database.
- procedure sketch: apply schema/backfill scripts in order, run validation SQL, diff row counts against the previous environment, record counts inline in the active checklist.
- promotion gate: passed — S1.2 local validation and S3.1 staging replay used the same apply/validate/count-diff procedure, and S3.1 caught two replay defects before the target was accepted.
- expected maturation: done; use the promoted skill for S4.1/S4.3 cutover rehearsals.
- 2026-06-10 update: S1.2 trace recorded — validation SQL + per-schema row-count export ran cleanly against the local transition DB (`audit-output/2026-06-10-phase-4f-execution.md`); one wrinkle worth keeping: FDW server ports had drifted (5432→5233) and needed `ALTER SERVER` before the gate could run. Awaiting the S3.1 staging trace.
- 2026-06-10 update: S3.1 trace recorded — standalone staging replay caught the `010`/`030` Kalala slug conflict and missing local-owner Kalala membership; both were fixed in replay scripts before validation. Row-count diff now records an intentional synthetic-family cleanup delta against the older local transition target.

### cutover-soak-comparison
- status: seed
- observed: written as mitigation in the 05-23 checklist Phase 6; the plan deliberately rehearses it on the dashboard cutover (S4.1) before Cash (S4.3).
- trigger pattern: switching any production read/write surface from an old datastore to the platform database.
- procedure sketch: dual-read old vs new for a soak window, compare responses and row counts, define match criteria before starting, cut over only on sustained parity, demote old store to read-only.
- promotion gate: zero executed traces yet — do not promote from plan text alone; needs S4.1 then S4.3.
- expected maturation: Phase 4 checkpoint.

### three-lens-release-review
- status: seed
- observed: created by the 2026-06-09 implementation plan (customer / company-brand / code lens walk per step); no executed trace yet.
- trigger pattern: declaring any plan step or release "done"; reviewing customer-affecting changes.
- procedure sketch: walk the three lenses with named evidence types per surface (diner vs tenant-owner vs prospect as "customer"), refuse exit until each lens has recorded evidence, file findings back into the routing ledger.
- promotion gate: needs ≥2 plan steps completed with the lens walk actually catching or confirming something; if it degenerates into checkbox theater, prune it and keep the lens table in the plan only.
- expected maturation: Phase 1 checkpoint (S1.2 and S1.3 are the first real exercises).
- 2026-06-10 update: 2 real traces, and the lens walk changed decisions both times — S1.2's customer lens forced the anti-join recheck that proved the 78 public-only rows stay excluded; S1.3's customer lens surfaced that the 1,449 unembedded messages are almost all synthetic `+1555` rows, flipping the call from "run backfill" to "defer backfill until S4.5 synthetic deletion." Not checkbox theater so far. Hold for one more phase before promoting (S3 steps are the next exercise); promote at the Phase 3 checkpoint if the pattern holds.

### secrets-environment-promotion
- status: seed
- observed: `VOYAGE_API_KEY` silently missing in production (audit C5); env/secret handling outside local flagged as the named risk of the centralization audit; recurs at S1.3, S3.1, S3.2, S5.3 (Vercel repointing).
- trigger pattern: any step that introduces or moves an environment variable or secret across local/staging/production.
- procedure sketch: enumerate required keys per environment from code references, verify presence (not value) in each target, verify the dependent feature executes post-deploy, record the check.
- promotion gate: needs two executed traces (S1.3 is the first).
- expected maturation: Phase 3 checkpoint.
- 2026-06-10 update: first executed trace (S1.3) — enumerated the key from code references (`tools.ts`, `embed-backfill.ts`, `turn-process.ts`), verified presence via `supabase secrets list` (digest only), verified the dependent feature executes post-set via a production `semantic_stats` trace (2026-06-08) against a pre-set `null` control (2026-06-01). Procedure held; needs the S3.1/S3.2 trace to promote.

### repo-history-preserving-import
- status: seed
- observed: first real trace 2026-06-10 — six-repo rehearsal import in `/tmp/umi-phase5-rehearsal` (evidence: `docs/migration/audit-output/2026-06-10-phase-5-execution.md`). Procedure stabilized: `git clone --no-local` (filter-repo refuses hardlinked local clones), `git-filter-repo --to-subdirectory-filter apps/<name>` (beats subtree: paths rewritten, so per-path log/blame work without `--follow`), `merge --allow-unrelated-histories`, verify by exact commit-count conservation (Cash 218/218; total 279 = 7+266+6). New mandatory pre-step: repo hygiene scan — dirty trees and a full commit-message profanity scan (caught uncommitted S2.3 work in umi-kds and slur commit `9df2c40` pushed in umi-conversaflow → `--replace-message` at import).
- trigger pattern: consolidating an external repo into the monorepo.
- procedure sketch: hygiene scan (dirty trees, offensive messages) → `--no-local` clone → filter-repo subdirectory rewrite (+ `--replace-message` if needed) → unrelated-histories merge → commit-count conservation check → repoint remotes/CI.
- promotion gate: likely a **one-shot batch**, not a recurring skill — six imports in one phase, then never again. Default expectation: prune after Phase 5 and keep the procedure in the plan/runbook instead (the cutover runbook in the 2026-06-10 evidence doc now holds it).
- expected maturation: Phase 5 cutover (blocked on ST-1…ST-5); prune-or-promote decision at that checkpoint.

### timezone-correct-scheduling
- status: seed (weak)
- observed: birthday-reward timezone risk (audit H4); single step (S4.4).
- trigger pattern: any per-tenant scheduled business action.
- procedure sketch: store tenant timezone, schedule in UTC, evaluate `AT TIME ZONE` at execution, test across a DST boundary and a UTC-day boundary.
- promotion gate: probably a one-off inside S4.4 — recorded mainly so the DST/day-boundary test cases are not forgotten. Expect prune into the job-worker docs.
- expected maturation: Phase 4 checkpoint.
