# Umi Agent Contract

This file is the agent-agnostic operating contract for the Umi workspace.

Any coding agent working in this repository should treat this file as the neutral source for workspace-wide rules, ownership, and decision standards.

For the full operating model, read:

- [WORKSPACE.md](/Users/juanlopez1/Documents/Repositories/Umi/WORKSPACE.md:1)
- [docs/architecture/agent-operating-system.md](/Users/juanlopez1/Documents/Repositories/Umi/docs/architecture/agent-operating-system.md:1)
- [docs/architecture/maps/retrieval-map.md](/Users/juanlopez1/Documents/Repositories/Umi/docs/architecture/maps/retrieval-map.md:1)

## Workspace identity

Umi is a multi-product organization workspace, not a single-app repository.

## Product boundaries

- `apps/umi-kds` owns the native iPad KDS client.
- `apps/umi-cash` owns loyalty and wallet behavior.
- `apps/umi-conversaflow` owns shared operational backend logic, Supabase contracts, workflow jobs, and cross-channel normalization.
- `apps/umi-logs` owns ConversaFlow ops and logs dashboard UI.
- `apps/umi-dashboard` owns the Umi owner dashboard app shell and live-data UI. Its visible functions and workflows are the behavior contract for future production hardening.
- root `docs/` owns Umi-level architecture, migration, and cross-product planning.

## Database ownership

- `conversaflow` is the operational runtime schema for conversations, orders, workflow jobs, and outbox.
- `kds` is for kitchen read models and projections only.
- `umi_cash` is for loyalty and wallet tables.
- `platform` is reserved for future shared organization data.
- `public` is a temporary compatibility surface and should not gain new product logic unless needed for backward compatibility.

## Architecture rules

- Keep apps thin. Product apps should consume normalized contracts, not raw channel payloads.
- Keep operational truth in the backend. KDS must not become the source of truth for orders.
- Put cross-product normalization close to the operational backend that owns the write model.
- Prefer additive projections over destructive schema changes.
- Prefer the narrowest existing owner before creating a new service, repo, or directory.
- Do not move responsibility into a new repo unless the current repo boundary is clearly failing on latency, ownership, deploy isolation, or operational simplicity.

## Research standard

- For architecture, schema, backend placement, realtime, performance, security, or scaling decisions, prefer primary sources over opinion.
- Check official documentation first.
- If the decision is structural or performance-sensitive, also check academic or primary technical research when it materially improves confidence.
- Record the decision basis explicitly:
  - documented fact
  - source-backed tradeoff
  - Umi-specific inference
- Do not cargo-cult common patterns. Choose the design that best fits measured constraints, operational simplicity, and source-backed tradeoffs.
- If a recommendation would add a new repo, service, or infrastructure boundary, justify it against simpler options with explicit criteria.

## Agent workflow rules

- For workspace-wide work, inspect root instructions and the root agent operating system first.
- For project-specific work, descend into the owning repo and follow its local instructions if they exist.
- Prefer existing artifacts and owners over inventing parallel structures.
- Treat `.claude/` as a current implementation detail of the Umi operating system, not as the only place where rules live.

## Current KDS stance

- KDS should read a backend-owned kitchen projection in schema `kds`.
- The initial `kds` population should come from existing ConversaFlow order data plus customer names and phone numbers already in the database.
- The normalization layer should live in `apps/umi-conversaflow` plus schema-qualified SQL under `kds`, unless future scale or ownership pressure proves that split is necessary.
