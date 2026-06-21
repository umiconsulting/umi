---
name: filesystem-structure-check
description: Use when a task depends on placing files correctly in this repository, or when you need to verify that a proposed change matches the existing on-disk structure.
---

# Filesystem Structure Check

## Goal
- Keep code placement aligned with the existing filesystem structure before creating or moving files.

## Steps
1. Inspect the relevant folders and nearby files before deciding where a change belongs.
2. Place new code in the narrowest existing slice that already matches the responsibility.
3. Only create new folders or parallel structure when the current tree clearly does not fit the task.
4. If the change alters structure, state why the new placement is better than extending the current layout.

Read `notes.md`.
