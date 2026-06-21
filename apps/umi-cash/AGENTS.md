# Umi Cash Agent Contract

This file is the agent-agnostic operating contract for `apps/umi-cash`.

Read with:

- [../../AGENTS.md](/Users/juanlopez1/Documents/Repositories/Umi/AGENTS.md:1)
- [REPO_CONTEXT.md](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-cash/REPO_CONTEXT.md:1)

## Repository identity

This repository owns Umi Cash loyalty, wallet, pass, user/session, and Cash-specific web behavior.

## Ownership

- Owns Cash application code and UI.
- Owns Cash Prisma schema and migrations/workflows.
- Owns Apple/Google wallet pass integration surfaces.
- Owns Cash Vercel cron jobs and scheduled app workflows.
- Does not own ConversaFlow operational order truth, KDS projections, or workspace-wide governance.

## Engineering rules

- Treat `prisma/schema.prisma` as the primary data model authority for Cash behavior.
- Treat wallet certificates, keys, and pass credentials as sensitive.
- Do not print or commit secret values.
- Validate Prisma, build, and runtime changes with repo-local scripts when possible.
- Keep Cash-specific cognition local unless it affects cross-product governance.

## Agent workflow rule

- Use this file as the neutral repo contract.
- Treat `CLAUDE.md` as a tool adapter, not the canonical source of architecture.
