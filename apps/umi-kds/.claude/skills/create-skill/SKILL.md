---
name: create-skill
description: Create or revise a small Anthropic-style skill only after task-router confirms a recurring, stable, well-placed procedure worth reusing.
---

# Create Skill

Keep the skill small.

## Rules
- One skill, one job.
- Put stable facts in `AGENTS.md`, not in the skill.
- Put long examples or checklists in referenced files.
- Keep `SKILL.md` short enough to scan quickly.
- Prefer updating an existing skill over creating a near-duplicate.
- Do not create or extend a skill until `promotion-criteria.md` has been checked.

## Procedure
1. Confirm the promotion gate in `/Users/juanlopez1/Documents/Repositories/Umi/.agents/skills/task-router/promotion-criteria.md` passes.
2. Review `/Users/juanlopez1/Documents/Repositories/Umi/.agents/skills/task-router/routing-ledger.md` for the successful traces that justify promotion.
3. Check whether the cleaner move is to extend an existing skill instead of creating a new one.
4. Name the task precisely.
5. Write one sentence for when the skill should be used.
6. Write only the minimum steps needed for reliable execution.
7. Move bulky detail to a sibling file.
8. Add or update the entry in the root task-router registry with scope, trigger patterns, placement hints, confidence, and provenance.
9. If the task needs judgment more than procedure, stop and define a subagent instead.

Use `template.md`.
