# Umi Dashboard Agent Contract

This file is the agent-agnostic operating contract for `apps/umi-dashboard`.

Read with:

- [../../AGENTS.md](/Users/juanlopez1/Documents/Repositories/Umi/AGENTS.md:1)
- [REPO_CONTEXT.md](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-dashboard/REPO_CONTEXT.md:1)

## Repository identity

This repository owns the Umi owner dashboard app shell and live-data UI.

The current implementation reads live product data through the dashboard server/API layer. Its visible screens, functions, and workflows remain the behavior contract for future production hardening.

## Ownership

- Owns owner dashboard screens and interaction model.
- Owns dashboard styling and UI behavior.
- Should preserve the same functions and workflows when production wiring is added.
- Does not own backend operational truth, KDS projections, loyalty schema, or trace schema.

## Engineering rules

- Preserve current visible functions unless the user explicitly changes product behavior.
- Keep live-data contract changes separate from UI/function changes when possible.
- Document data contracts before expanding live service wiring.
- Do not infer backend ownership from dashboard UI fields.

## Agent workflow rule

- Treat the dashboard UI as a behavior reference.
- Use root ownership maps to route future data/API implementation to the owning repo.
