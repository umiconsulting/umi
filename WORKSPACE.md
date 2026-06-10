# Umi Workspace

This directory is a federated cognitive workspace, not an application repository.

Root files and root `docs/` coordinate multiple independent product repos, shared architecture, retrieval rules, agent behavior, reports, evals, traces, and memory policy. Runtime ownership stays inside the narrowest repo that already owns the system.

## Start here

1. Read `AGENTS.md` for the workspace-wide operating contract.
2. Read `docs/architecture/agent-operating-system.md` for the agent operating model.
3. Read `docs/architecture/maps/workspace-map.md` to choose the owning repo.
4. Read `docs/architecture/maps/retrieval-map.md` before loading broad context.
5. Enter the selected repo and read its `AGENTS.md` and `REPO_CONTEXT.md` if present.

## Repos

- `apps/umi-conversaflow` owns shared Supabase backend, workflow jobs, prompts, memory, traces, schema contracts, and cross-channel normalization.
- `apps/umi-kds` owns the native iPad Kitchen Display System client.
- `apps/umi-cash` owns loyalty, wallet, passes, and Cash-specific Prisma behavior.
- `apps/umi-logs` owns ConversaFlow operational logs and trace UI.
- `apps/umi-dashboard` owns the Umi owner dashboard app shell and live-data UI. Its visible functions and workflows should be preserved as the behavior contract for future production hardening.

## Cognitive layers

- Workspace cognition: root `AGENTS.md`, `WORKSPACE.md`, root docs, ownership, governance, retrieval, and routing.
- Repo cognition: local `AGENTS.md`, `REPO_CONTEXT.md`, repo docs, runbooks, eval maps, and diagnostics.
- Runtime cognition: prompts, tools, workflow processors, memory shaping, outbox delivery, projections, and app state.
- Operational cognition: scripts, diagnostics, dashboards, traces, signoff suites, and deployment procedures.
- Historical cognition: dated reports, audits, migration plans, and superseded design prompts.

## Rule of thumb

Centralize cognition contracts and retrieval maps. Do not centralize runtime ownership unless the existing repo boundary is failing on latency, ownership, deploy isolation, or operational simplicity.
