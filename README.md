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
