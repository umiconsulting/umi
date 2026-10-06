# Umi

This file is the Claude-oriented adapter for the neutral Umi agent contract.

Read first:

- [AGENTS.md](/Users/juanlopez1/Documents/Repositories/Umi/AGENTS.md:1)
- [docs/architecture/agent-operating-system.md](/Users/juanlopez1/Documents/Repositories/Umi/docs/architecture/agent-operating-system.md:1)

## Claude adapter rules

- Use `AGENTS.md` as the neutral source of workspace-wide rules.
- Always follow the [Writing standard](/Users/juanlopez1/Documents/Repositories/Umi/AGENTS.md:61)
  section of `AGENTS.md`. Answer in the language that the user writes:
  - English → ASD-STE100 Simplified Technical English.
  - Spanish, technical content → Español Técnico Simplificado (ETS).
  - Spanish, all other content → Lenguaje claro (Red de Lenguaje Claro).
  - This applies to chat replies, commits, pull requests, comments, and docs.
- Root `.agents/skills/` is the canonical procedure layer; root `.claude/skills/` is a **symlink** into it (`.claude/skills -> ../.agents/skills`), so there is one source of truth. Read and write skills under `.agents/skills/`; Claude Code loads them through the link — no sync step. `adapter-sync-check` guards the link (symlinks assume macOS/Linux; Windows needs `git config core.symlinks true`).
- For project-specific work, descend into the owning repo and follow its local `CLAUDE.md` and `.claude/`.
- Keep this file aligned with `AGENTS.md`; do not let it drift into a separate architecture.
