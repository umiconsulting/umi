---
name: adapter-sync-check
description: Verify and restore convergence between the canonical .agents procedure layer and its generated .claude mirror. Use after any write to a root skill, registry, ledger, or seed file, and during workspace health checks or drift investigations.
---

# Adapter Sync Check

Root `.agents/skills/` is the canonical procedure layer (owner decision, 2026-06-10, plan S1.5).
Root `.claude/skills/` is a generated mirror. This skill verifies convergence and regenerates
the mirror; it exists because the two layers drifted silently twice (2026-06-09 audit §1.2;
disjoint ledger histories found during S1.5 re-convergence).

## Procedure

1. **Detect:** `diff -rq .claude/skills .agents/skills` from the workspace root.
2. **Classify any delta:**
   - content exists only in `.claude/skills/` → it was hand-written into the mirror; **merge it
     into `.agents/skills/` first** (union-merge ledgers chronologically; never discard either
     side's history), then regenerate.
   - content exists only in `.agents/skills/` → mirror is stale; regenerate.
3. **Regenerate:** `rsync -ac --delete .agents/skills/ .claude/skills/`
   (`-c` is required — size-and-mtime quick checks have missed real content drift).
4. **Verify:** `diff -r .claude/skills .agents/skills` must return empty.
5. **Expected non-mirrored deltas** (do not "fix"): `.claude/settings.local.json` (machine-local),
   `.agents/agents/` (neutral agent specs with no `.claude` equivalent yet).

## Rules

- Never hand-edit `.claude/skills/` — write to `.agents/skills/` and regenerate.
- Refuse silent dual-writes: a change applied to both layers by hand is a drift seed.
- Ledger and seed entries are written once, to `.agents/`, then mirrored.
- If a third adapter layer appears (e.g. `.cursor` procedures), extend this check before
  populating it.
