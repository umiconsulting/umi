# Umi

This file is the Claude-oriented adapter for the neutral Umi agent contract.

Read first:

- [AGENTS.md](/Users/juanlopez1/Documents/Repositories/Umi/AGENTS.md:1)
- [docs/architecture/agent-operating-system.md](/Users/juanlopez1/Documents/Repositories/Umi/docs/architecture/agent-operating-system.md:1)

## Claude adapter rules

- Use `AGENTS.md` as the neutral source of workspace-wide rules.
- Root `.agents/skills/` is the canonical procedure layer; root `.claude/skills/` is a generated mirror of it. Read skills from `.claude/skills/`, but write changes to `.agents/skills/` and regenerate the mirror (`rsync -ac --delete .agents/skills/ .claude/skills/`; `diff -r` must come back empty).
- For project-specific work, descend into the owning repo and follow its local `CLAUDE.md` and `.claude/`.
- Keep this file aligned with `AGENTS.md`; do not let it drift into a separate architecture.
