# Umi Workspace

Umi is a multi-product organization workspace, not a single-app repository.
This file is the workspace-wide contract — product boundaries, ownership,
architecture rules, and the research standard. Hermes provides the generic
agent operating model; the `codex-claude-pipeline` skill handles worker
routing. What lives here is what no agent can infer.

## Start here

- `WORKSPACE.md` — workspace map and cognitive layers
- `docs/architecture/agent-operating-system.md` — neutral agent OS
- `docs/architecture/maps/retrieval-map.md` — bounded progressive disclosure
- `docs/migration/2026-06-09-workspace-integration-implementation-plan.md` — active program driver

## Product boundaries

| Path | Owns |
|------|------|
| `apps/umi-kds` | Native iPad Kitchen Display System client |
| `apps/umi-cash` | Loyalty, wallet, passes, Cash-specific Prisma |
| `apps/umi-conversaflow` | Shared Supabase backend, workflow jobs, prompts, traces, cross-channel normalization |
| `apps/umi-logs` | ConversaFlow operational logs and trace UI |
| `apps/umi-dashboard` | Owner dashboard app shell and live-data UI |
| `apps/umi-landing-page` | Public landing and lead capture |
| root `docs/` | Architecture, migration, governance, cross-product planning |

## Database ownership

- `conversaflow` — operational runtime: conversations, orders, workflow jobs, outbox
- `kds` — kitchen read models and projections only
- `umi_cash` — loyalty and wallet tables
- `platform` — shared organization data (contacts, users, tenants, leads)
- `public` — temporary compatibility surface; do not add new product logic

## Architecture rules

- Keep apps thin. Product apps consume normalized contracts, not raw channel payloads.
- Keep operational truth in the backend. KDS must not become the source of truth for orders.
- Put cross-product normalization close to the operational backend that owns the write model.
- Prefer additive projections over destructive schema changes.
- Prefer the narrowest existing owner before creating a new service, repo, or directory.
- Do not move responsibility into a new repo unless the current boundary is clearly
  failing on latency, ownership, deploy isolation, or operational simplicity.

## Research standard

For architecture, schema, backend placement, realtime, performance, security, or scaling
decisions, prefer primary sources over opinion. Check official documentation first. If
structural or performance-sensitive, consult academic or primary technical research when
it materially improves confidence. Record the decision basis explicitly:

- documented fact
- source-backed tradeoff
- Umi-specific inference

Do not cargo-cult common patterns. Choose the design that best fits measured constraints,
operational simplicity, and source-backed tradeoffs. If a recommendation adds a new repo,
service, or infrastructure boundary, justify it against simpler options with explicit criteria.

## Agent layer

Hermes is the local orchestrator. DeepSeek v4 Pro is the reasoning engine. The
`codex-claude-pipeline` skill (loaded by Hermes) governs when to delegate to Codex
or Claude Code. Agent procedures live under `.agents/skills/` (canonical per the
2026-06-10 S1.5 decision); `.claude/skills/` is a generated mirror. Sync with:

```sh
rsync -ac --delete .agents/skills/ .claude/skills/
diff -r .claude/skills .agents/skills   # must be empty
```

For workspace-wide work, inspect root instructions first. For project-specific work,
descend into the owning repo and follow its `AGENTS.md` / `REPO_CONTEXT.md` if present.
Prefer existing artifacts and owners over inventing parallel structures.

## Current stance

- KDS reads a backend-owned kitchen projection in schema `kds`. The normalization
  layer lives in `apps/umi-conversaflow` plus schema-qualified SQL under `kds`.
- Dashboard has cut over to the single platform schema path (S4.1, 2026-06-10).
- All app remotes use `git@github.com-umi:umiconsulting/<repo>.git`. The push matrix
  is documented in `docs/governance/github-push-matrix.md`.
- Root pnpm workspaces + Turborepo are additive and inert for app npm workflows
  until the Phase 5 monorepo cutover (gated by ST-1…ST-5 in the implementation plan).
- The active program driver is the 2026-06-09 implementation plan. Sequencing
  invariant: database consolidation → backend consolidation → monorepo.

## Commands

Root monorepo (pnpm + Turborepo, additive at this phase):

- Install: `pnpm install`
- Build: `pnpm run build` (or `turbo run build`)
- Lint: `pnpm run lint` (or `turbo run lint`)
- Test: `pnpm run test` (or `turbo run test`)
- Dev: `pnpm run dev` (or `turbo run dev`)

Per-app (current npm workflows):

```sh
cd apps/<app> && npm install && npm run dev
```
