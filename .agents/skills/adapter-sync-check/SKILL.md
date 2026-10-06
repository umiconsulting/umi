---
name: adapter-sync-check
description: Verify the tool adapter directories (.claude/skills, plus .cursor/.codex if present) are symlinks into the canonical .agents procedure layer, and restore the link if one was replaced by a copy. Use after cloning, after a tool writes through an adapter path, or during workspace health checks.
---

# Adapter Sync Check

Root `.agents/skills/` is the canonical procedure layer (owner decision, 2026-06-10, plan S1.5).
Each tool reads skills from its own path, so those paths are **symlinks** into the canonical
layer — one source of truth, nothing to regenerate:

- `.claude/skills` → `../.agents/skills`

This skill guards those links. It exists because the layers were once *copied* and drifted
silently twice (2026-06-09 audit §1.2; disjoint ledger histories at S1.5 re-convergence). A
symlink cannot drift, so the only failure mode left is a link being **replaced by a copy** — by a
tool that writes into the adapter path, an editor, or a Windows checkout without `core.symlinks`.

## Procedure

1. **Check the link:** for each adapter path (`.claude/skills`, plus `.cursor`/`.codex` if present),
   confirm it is a symlink resolving to the canonical layer:
   `readlink .claude/skills` → `../.agents/skills`.
2. **If it is a real directory** (someone copied instead of linking): merge any content that exists
   **only** there back into `.agents/skills/` first (union-merge ledgers chronologically; never
   discard either side's history), then replace it with the link —
   `rm -rf .claude/skills && ln -s ../.agents/skills .claude/skills`.
3. **Verify resolution:** `ls .claude/skills/*/SKILL.md` lists the canonical set through the link.
4. **Expected non-linked paths** (do not "fix"): `.claude/settings.local.json` (machine-local),
   `.agents/agents/` (neutral agent specs with no adapter equivalent).

## Rules

- Never hand-edit through an adapter path — write to `.agents/skills/`; the link reflects it instantly.
- A real directory where a symlink belongs is drift: restore the link, don't maintain a copy.
- Symlinked adapters assume macOS/Linux; a Windows checkout needs `git config core.symlinks true`.
- If a new tool adapter appears (e.g. `.cursor`/`.codex` procedures), link it here before populating it.
