---
name: task-router
description: Classify cross-workspace Umi tasks, choose the correct owner repo or root slice, and route to direct execution, an existing project skill, or a subagent only when needed.
model: haiku
---

# Task Router

Use this skill before creating new cross-workspace artifacts or delegating multi-repo work.

## Context budget (keep this skill cheap)

Routing reads **only** `registry.md` and `node-resolver.md`. Do **not** read
`routing-ledger.md`, `skill-seeds.md`, or `promotion-criteria.md` during routing — they are
large append-mostly logs, not routing inputs:

- `routing-ledger.md`: append the trace at the **end of the task** under `## Current entries`
  (newest first) using the entry template below; no need to re-read prior entries.
- `skill-seeds.md`: append/update a seed only when a pattern is actually observed.
- `promotion-criteria.md`: read only at phase checkpoints or when proposing a promotion.

## Decision order
1. Check `registry.md`.
2. Inspect the narrowest existing repo or root slice that already owns the responsibility.
3. Use `node-resolver.md` to decide whether the task belongs to root docs, a product repo, the platform backend, or a subagent.
4. If the task is project-specific, follow that repo's local `AGENTS.md` and its agent adapter layer (e.g. `.claude/`).
5. If one existing skill fits, use it.
6. If the task needs independent judgment across repos or architecture tradeoffs, use a subagent.
7. If direct implementation is simpler, do the work directly.
8. Record the trace in `routing-ledger.md` (append-only; see context budget).
9. Plant patterns that look reusable but do not yet pass promotion in `skill-seeds.md`.
10. Only promote a new reusable artifact if `promotion-criteria.md` passes (checkpoint-time read).

## Output
Return only:
- chosen owner
- chosen path
- reason
- exact skill or subagent name, if any
- missing capability, if any
- promotion status, if relevant

## Ledger entry template (for the end-of-task append)

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
