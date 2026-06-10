# Adapter Policy

Tool-specific agent adapters are implementation details. Neutral contracts are canonical.

## Canonical first

- Root `AGENTS.md` is the workspace-wide neutral contract.
- Local `AGENTS.md` is the repo-level neutral contract.
- `WORKSPACE.md` and `REPO_CONTEXT.md` provide retrieval and orientation, not separate authority.

## Adapters

Adapters include `CLAUDE.md`, `.claude/`, `.codex/`, `.agents/skills/`, and any future tool-specific instruction file.

Adapters may:

- Restate neutral contracts in tool-specific language.
- Expose skills or workflows for a tool.
- Provide command conventions for a runtime.

Adapters must not:

- Override neutral ownership rules.
- Become the only place where durable architecture decisions live.
- Drift from root or local `AGENTS.md`.

## Synchronization rule

When durable behavior changes:

1. Update the neutral contract or repo context.
2. Update maps/indexes if retrieval changes.
3. Update adapters only after the neutral source is correct.
4. Mark stale adapters when they cannot be synchronized immediately.
