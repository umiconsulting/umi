# Umi Workspace

This directory is an active monorepo and a shared cognitive workspace.

Root files and `docs/` coordinate the products, architecture, retrieval rules, reports, evaluations, traces, and memory policy.
Runtime ownership stays inside the narrowest existing app.

## Start here

1. Read `AGENTS.md` for the workspace-wide operating contract.
2. Read `docs/architecture/agent-operating-system.md` for the agent operating model.
3. Read `docs/architecture/maps/workspace-map.md` to choose the owning repo.
4. Read `docs/architecture/maps/retrieval-map.md` before loading broad context.
5. Enter the selected app and read its `AGENTS.md` and `REPO_CONTEXT.md` if present.

## Apps

- `apps/umi-api` owns canonical business writes, workflows, normalization, and backend contracts.
- `apps/umi-pos` owns the Flutter UmiPOS client and native device workflows.
- `apps/umi-kds` owns the native iPad Kitchen Display System client.
- `apps/umi-cash` owns the Cash compatibility client and Cash-specific Prisma behavior.
- `apps/umi-dashboard` owns the owner dashboard shell and live-data UI.
- `apps/umi-landing-page` owns the public landing site and lead capture.

## Cognitive layers

- Workspace cognition: root `AGENTS.md`, `WORKSPACE.md`, root docs, ownership, governance, retrieval, and routing.
- App cognition: local `AGENTS.md`, `REPO_CONTEXT.md`, app docs, runbooks, evaluation maps, and diagnostics.
- Runtime cognition: prompts, tools, workflow processors, memory shaping, outbox delivery, projections, and app state.
- Operational cognition: scripts, diagnostics, dashboards, traces, signoff suites, and deployment procedures.
- Historical cognition: dated reports, audits, migration plans, and superseded design prompts.

## Rule of thumb

Centralize cognition contracts and retrieval maps.
Keep runtime ownership in the current app unless measured constraints require a new boundary.
