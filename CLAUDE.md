# Umi

This file is the Claude-oriented adapter for the neutral Umi agent contract.

Read first:

- [AGENTS.md](/Users/juanlopez1/Documents/Repositories/Umi/AGENTS.md:1)
- [docs/architecture/agent-operating-system.md](/Users/juanlopez1/Documents/Repositories/Umi/docs/architecture/agent-operating-system.md:1)

## Claude adapter rules

- Use `AGENTS.md` as the neutral source of workspace-wide rules.
- Use root `.claude/skills/` as the current procedure layer when they match the task.
- For project-specific work, descend into the owning repo and follow its local `CLAUDE.md` and `.claude/`.
- Keep this file aligned with `AGENTS.md`; do not let it drift into a separate architecture.
