---
name: workspace-boundary-check
description: Verify which Umi repo, schema, and documentation layer should own a change before implementation. Use for cross-product placement questions and backend-vs-app ownership decisions.
---

# Workspace Boundary Check

## Rules
- Start from the current filesystem, not an imagined architecture.
- Put write-model and normalization logic where the operational backend already lives.
- Put read-model tables in the schema that serves the consumer.
- Keep root docs for organization-wide rules and plans.
- Keep product apps thin and focused on consumption, not cross-channel normalization.

## Default ownership map
- Umi-wide architecture and planning: root `docs/` and root `AGENTS.md`
- KDS app UI and client code: `apps/umi-kds`
- Shared Supabase schema work, jobs, and normalization: `apps/umi-conversaflow`
- ConversaFlow ops/logs UI: `apps/umi-logs`
- Static Umi owner dashboard prototype: `apps/umi-dashboard`
- Loyalty-only work: `apps/umi-cash`

## Decision test
1. Which repo owns the current write model?
2. Which consumer needs the read model?
3. Can the current backend expose the contract without introducing another service?
4. If yes, keep the logic there and add only the consumer-side adapter needed.
