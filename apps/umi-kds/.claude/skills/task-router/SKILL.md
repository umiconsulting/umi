---
name: task-router
description: Thin pointer to the root Umi task-router. Use the workspace root router for cross-workspace and KDS-local routing decisions, then apply KDS-local skills selected by that route.
---

# Task Router Pointer

This repo no longer owns a standalone task-router implementation.

Use the canonical workspace router at:

`/Users/juanlopez1/Documents/Repositories/Umi/.agents/skills/task-router/SKILL.md`

After routing into `apps/umi-kds`, use the local KDS skills in this repo when they fit:

- `swiftui-kds-standards`
- `filesystem-structure-check`
- `create-skill` only after the root promotion gate passes

Record cross-workspace routing traces in the root ledger, not in this repo.
