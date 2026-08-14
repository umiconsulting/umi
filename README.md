# Umi

Platform for cafés and restaurants: a single backend (`@umi/api`) owns all data and
secrets; everything else is a thin client. This is a pnpm + Turborepo monorepo.

## What's here

### `apps/` — independently deployed units

| Directory               | Package          | What it is                                                                                                                                                         | Deploys to                              |
| ----------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `apps/umi-api`          | `@umi/api`       | The backend. NestJS + Fastify, one image / two processes (web + BullMQ worker). **The only thing that touches the database or secrets.**                           | VPS (Docker, via GitHub Actions → GHCR) |
| `apps/umi-dashboard`    | `@umi/dashboard` | Operator / owner console (Vite + React SPA).                                                                                                                       | Vercel                                  |
| `apps/umi-landing-page` | `@umi/landing`   | Marketing site (Next.js).                                                                                                                                          | Vercel                                  |
| `apps/umi-cash`         | `umi-cash`       | Customer wallet / loyalty. **FROZEN** — being absorbed into the dashboard; excluded from the workspace, keeps its own npm lockfile. Don't touch until the cutover. | Vercel                                  |
| `apps/umi-kds`          | —                | Kitchen Display System — a native iPad app (Swift). Not a JS workspace member.                                                                                     | App Store                               |

### `packages/` — shared code

| Directory           | Package         | What it is                                                                            | Consumed by                       |
| ------------------- | --------------- | ------------------------------------------------------------------------------------- | --------------------------------- |
| `packages/contract` | `@umi/contract` | Typed HTTP contract (route paths + zod schemas + inferred types) for the API surface. | `@umi/api` + `@umi/dashboard`     |
| `packages/tokens`   | `@umi/tokens`   | Design tokens → CSS variables + a Tailwind theme.                                     | `@umi/dashboard` + `@umi/landing` |

## Quick start

```bash
pnpm install                          # install the whole workspace
pnpm --filter @umi/dashboard dev      # run the console locally
pnpm --filter @umi/api dev            # run the backend (needs apps/umi-api/.env)
pnpm --filter @umi/api test           # backend tests
pnpm turbo run build                  # build everything, in dependency order
```

Filter by the **package name** (`@umi/dashboard`), not the directory — see
[CONVENTIONS.md](./CONVENTIONS.md).

## Project tracking (Plane)

Work items and PRDs live in self-hosted **Plane** at
**https://plane.umiconsulting.co** — workspace `umi`, project **`UMI`**, so
identifiers read `UMI-42`. Trello is retired.

One project holds the whole monorepo, with **modules** for the area (`umi-api`,
`dashboard`, `landing`, `kds`, `infra`). Plane scopes a cycle to one project, so
splitting the repo across projects would force parallel sprints that five people
cannot plan across, and cross-cutting work would have no home. A separate repo
gets its own project. See
[docs/agents/issue-tracker.md](./docs/agents/issue-tracker.md) for the triage
states, the PR↔item link, and how the agent skills use it.

`.mcp.json` wires Plane into Claude Code, so agents raise work items as issues
surface instead of waiting for someone to file them. The token is **per-person**,
so each dev supplies their own:

1. In Plane: avatar → **Settings → Personal Access Tokens → Add**. Copy it once;
   it is not shown again. Name it something you can revoke in isolation.
2. Export it where your shell will pick it up (`~/.zshrc`, direnv, 1Password CLI —
   wherever the other `.mcp.json` secrets already come from):

   ```bash
   export PLANE_API_KEY=plane_api_...
   ```

3. Verify before wiring anything up — a 200 means the token and the base URL are
   both right:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -H "X-API-Key: $PLANE_API_KEY" \
     https://plane.umiconsulting.co/api/v1/workspaces/umi/projects/
   ```

Never put the token in `.mcp.json`. Every server in that file reads its secrets
through `${VAR}` expansion for this reason.

The instance runs on the same VPS as `@umi/api`, behind the same Caddy — see
[apps/umi-api/docs/vps-setup.md](./apps/umi-api/docs/vps-setup.md) for how it is
wired and what to check after a Plane upgrade.

## How it deploys

- **`@umi/api`** ships on merge to `main` touching `apps/umi-api/**` (or the
  workspace manifests): GitHub Actions builds the Docker image, pushes it to GHCR,
  and the VPS pulls it — the VPS never builds. Health: `https://api.umiconsulting.co/health`.
- **Frontends** deploy on Vercel from `main`, each with its own project + app-scoped
  `npm install` (they do **not** run the monorepo build — see why shared packages
  commit their build output in [CONVENTIONS.md](./CONVENTIONS.md)).

## Conventions & docs

- [CONVENTIONS.md](./CONVENTIONS.md) — naming, package layout, how shared packages
  are built and consumed.
- [AGENTS.md](./AGENTS.md) — rules for AI agents working in this repo.
- `docs/` — architecture notes and migration history (dated; newest wins).
