# Umi Agent Operating System

## Purpose

Define a workspace-wide operating system for agents that is not tied to any one vendor, assistant, or file naming convention.

This document is the neutral explanation layer.

`AGENTS.md` is the short contract.
`WORKSPACE.md` is the start-here map.
`REPO_CONTEXT.md` files are bounded repo entry contexts.
`CLAUDE.md` and `.claude/` are current adapters used by some agent tooling.

## Neutral model

The Umi agent system has three layers:

1. Neutral contract
2. Operating procedures
3. Tool-specific adapters

### 1. Neutral contract

The neutral contract lives in:

- [AGENTS.md](/Users/juanlopez1/Documents/Repositories/Umi/AGENTS.md:1)
- [WORKSPACE.md](/Users/juanlopez1/Documents/Repositories/Umi/WORKSPACE.md:1)
- [docs/architecture/maps/workspace-map.md](/Users/juanlopez1/Documents/Repositories/Umi/docs/architecture/maps/workspace-map.md:1)
- [docs/architecture/maps/retrieval-map.md](/Users/juanlopez1/Documents/Repositories/Umi/docs/architecture/maps/retrieval-map.md:1)
- [docs/governance/authority.md](/Users/juanlopez1/Documents/Repositories/Umi/docs/governance/authority.md:1)

These are the neutral files any agent should be able to consume without assuming Claude, Codex, or another tool.

### 2. Operating procedures

Repeatable workspace procedures currently live in:

- root `.claude/skills/`
- root `.agents/skills/`

These are implementation artifacts for current tooling, but the intent is generic:

- routing work to the correct owner
- checking workspace boundaries
- validating source-backed technical decisions

### 3. Tool-specific adapters

Current adapters:

- `CLAUDE.md`
- root `.claude/`
- root `.agents/`
- project-local `CLAUDE.md`
- project-local `.claude/`
- project-local `.agents/`

These adapters should stay aligned with `AGENTS.md`, not diverge from it.

**Canonical procedure layer (decided 2026-06-10, plan S1.5):** root `.agents/skills/` is the
single source of truth for skills, the registry, the routing ledger, and skill seeds. Root
`.claude/skills/` is a generated mirror — never hand-edit it. Regenerate and verify with:

```sh
rsync -ac --delete .agents/skills/ .claude/skills/
diff -r .claude/skills .agents/skills   # must be empty
```

Expected non-mirrored deltas: `.claude/settings.local.json` (machine-local) and `.agents/agents/`
(neutral agent specs, no `.claude` equivalent yet).

## Principles

### Ownership first

- keep each change with the narrowest existing owner
- prefer the repo that owns the write model for shared normalization
- prefer the schema that serves the consumer for read models

### Thin clients

- product apps should consume normalized contracts
- product apps should not become the operational source of truth

### Additive evolution

- prefer additive schemas, projections, and contracts
- avoid destructive migrations unless compatibility and rollback are already handled

### Scientific research standard

For meaningful technical decisions:

- start with official docs
- add academic or primary technical research when the decision is structural, benchmark-sensitive, or performance-sensitive
- write down what is fact, what is tradeoff, and what is inference

### Simplicity before sprawl

- do not create a new repo, service, or infrastructure boundary without explicit evidence
- justify any added boundary against simpler options

## Current implementation mapping

### Root procedures

- [task-router](/Users/juanlopez1/Documents/Repositories/Umi/.claude/skills/task-router/SKILL.md:1)
- [workspace-boundary-check](/Users/juanlopez1/Documents/Repositories/Umi/.claude/skills/workspace-boundary-check/SKILL.md:1)
- [scientific-research-check](/Users/juanlopez1/Documents/Repositories/Umi/.claude/skills/scientific-research-check/SKILL.md:1)

### Workspace maps

- [workspace-map](/Users/juanlopez1/Documents/Repositories/Umi/docs/architecture/maps/workspace-map.md:1)
- [retrieval-map](/Users/juanlopez1/Documents/Repositories/Umi/docs/architecture/maps/retrieval-map.md:1)
- [runtime-map](/Users/juanlopez1/Documents/Repositories/Umi/docs/architecture/maps/runtime-map.md:1)

### Governance

- [authority](/Users/juanlopez1/Documents/Repositories/Umi/docs/governance/authority.md:1)
- [ownership](/Users/juanlopez1/Documents/Repositories/Umi/docs/governance/ownership.md:1)
- [agent-safe boundaries](/Users/juanlopez1/Documents/Repositories/Umi/docs/governance/agent-safe-boundaries.md:1)
- [adapter policy](/Users/juanlopez1/Documents/Repositories/Umi/docs/governance/adapter-policy.md:1)
- [cognitive lifecycle](/Users/juanlopez1/Documents/Repositories/Umi/docs/governance/cognitive-lifecycle.md:1)

### Product-local systems

- [apps/umi-kds/CLAUDE.md](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-kds/CLAUDE.md:1)
- [apps/umi-cash/CLAUDE.md](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-cash/CLAUDE.md:1)
- [apps/umi-conversaflow/CLAUDE.md](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/CLAUDE.md:1)
- [apps/umi-conversaflow/REPO_CONTEXT.md](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/REPO_CONTEXT.md:1)
- [apps/umi-kds/REPO_CONTEXT.md](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-kds/REPO_CONTEXT.md:1)
- [apps/umi-cash/REPO_CONTEXT.md](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-cash/REPO_CONTEXT.md:1)
- [apps/umi-logs/REPO_CONTEXT.md](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-logs/REPO_CONTEXT.md:1)
- [apps/umi-dashboard/REPO_CONTEXT.md](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-dashboard/REPO_CONTEXT.md:1)

## Maintenance rule

When a workspace-wide rule changes:

1. Update `AGENTS.md`
2. Update this document if the operating model changed
3. Update maps, governance docs, or repo contexts if retrieval changed
4. Update `CLAUDE.md` only as an adapter or shortcut
5. Update `.agents/skills/` (canonical) only if a procedure changed, then regenerate the
   `.claude/skills/` mirror (`rsync -ac --delete .agents/skills/ .claude/skills/`) and verify
   `diff -r` is empty before finishing the task
