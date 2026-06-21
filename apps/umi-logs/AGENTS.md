# Umi Logs Agent Contract

This file is the agent-agnostic operating contract for `apps/umi-logs`.

Read with:

- [../../AGENTS.md](/Users/juanlopez1/Documents/Repositories/Umi/AGENTS.md:1)
- [REPO_CONTEXT.md](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-logs/REPO_CONTEXT.md:1)

## Repository identity

This repository owns the ConversaFlow logs and trace dashboard UI.

## Ownership

- Owns human-facing trace/log browsing UI.
- Owns trace assembly and display logic.
- Consumes ConversaFlow operational trace/log data.
- Does not own ConversaFlow runtime jobs, trace table schema, prompts, memory writes, or production workflow behavior.

## Engineering rules

- Treat Supabase service-role configuration as sensitive.
- Keep trace schema assumptions explicit in parser/types files.
- Prefer parser-level tests for trace assembly changes.
- Do not turn Logs into the operational source of truth.

## Agent workflow rule

- Load this contract and `REPO_CONTEXT.md` before editing app code.
- Route backend trace schema changes to `apps/umi-conversaflow`.
