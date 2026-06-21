# 375

This file is the Claude-oriented adapter for the neutral repo contract.

Read first:

- [AGENTS.md](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-kds/AGENTS.md:1)
- [../../AGENTS.md](/Users/juanlopez1/Documents/Repositories/Umi/AGENTS.md:1)

## Claude adapter rules
- Use `AGENTS.md` as the neutral source of repo-wide rules.
- Use `.claude/skills/` as the generated mirror of the local `.agents/skills/` procedures when they match the task.
- Use the root workspace `task-router` for cross-workspace routing and ledger entries.
- Keep this file aligned with `AGENTS.md`; do not let it drift into a separate architecture.
