---
name: pr-gates
description: The validation gates that run every time a pull request is published — before it exists (local), during review (CI), and after merge (post-merge). Delegates judgment gates to the engineering skills (tdd, code-review, diagnosing-bugs) and mechanical gates to turbo/pnpm and the repo's GitHub Actions CI. Use when opening, updating, or completing a PR, or when the user says "ship", "publish", "open a PR", "merge this".
---

# PR Gates

A pull request is not publishable until the **Before** gates pass, not mergeable until the **During** gate is green, and not done until the **After** gate confirms it. Gates are ordered; a failing gate stops the flow — fix on the branch, never wave it through.

Fixed point for every diff and affected filter: the merge-base with `main`.

```
BASE=$(git merge-base origin/main HEAD)
```

## Before — local, before the PR exists

1. **Tests-first** (`tdd` skill) — new behavior ships with tests written test-first; the full affected suite is green, and every regression test is red-green verified (revert the fix → test fails → restore → passes). No test, no code.
2. **Review** (`code-review` skill) — review `git diff $BASE...HEAD` for **Standards** (repo conventions); resolve every finding. If the PR links a Trello card (see `docs/agents/issue-tracker.md`), the **Spec** axis also checks the code against that card — resolve or consciously accept each Spec finding. An unlinked PR is normal; Standards gates on its own.
3. **Mechanical green** — all return **0 errors, 0 warnings**, read from real output (never "should pass"):
   ```
   pnpm turbo run build lint test --filter=...[origin/main]
   pnpm --filter <affected-pkg> typecheck      # per package, e.g. @umi/api
   pnpm format:check
   ```

Open the PR only when 1–3 are green.

## During — automatically on the PR (GitHub Actions)

4. **CI gate** — opening or updating the PR triggers the affected workflow(s) in `.github/workflows/*` (`umi-api-ci.yml`, `contract-ci.yml`, `tokens-ci.yml`, …) in a clean environment. That run is authoritative — **review** it, never launch a duplicate. If it is red, push a fix commit; the same trigger re-runs it. If a changed package has no CI workflow, say so on the PR and treat the local mechanical gate (step 3) as the standing gate for that surface.

## After — post-merge

5. **Verify & diagnose** — after merge, confirm the **merge commit's** CI (and any deploy workflow, e.g. `umi-api-deploy.yml`) is green with fresh evidence — the merge run, not the PR run. If anything is red, invoke the `diagnosing-bugs` skill to build a tight pass/fail signal and root-cause before any re-attempt. Only then is the PR done.

## Failure Handling

- A gate that cannot run (missing tool, no CI for the affected surface) is **blocked**, not passed — stop and report, do not assume green.
- Never soften a review finding to unblock a merge; classify by severity and either fix it or accept it explicitly with a reason on the PR.
- Never relaunch CI to force a fresh run when the PR already triggered one; the PR trigger is the single source of runs.
