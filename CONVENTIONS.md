# Conventions

Keep these consistent so tooling stays predictable and the repo stays legible.

## Package naming

- Every workspace member is `@umi/<name>`, where `<name>` is the directory name
  minus the `umi-` prefix: `apps/umi-dashboard` → `@umi/dashboard`,
  `packages/contract` → `@umi/contract`.
- **Always filter by the package name, never the directory:**
  `pnpm --filter @umi/dashboard build` (not `--filter umi-dashboard`).
- Exceptions, documented on purpose:
  - `apps/umi-cash` keeps the unscoped `umi-cash` — it's **frozen** and excluded
    from the workspace; it gets renamed at its cutover, not before.
  - `apps/umi-kds` is a native Swift app with no `package.json`.

## Directory naming — the `umi-` prefix stays

The `umi-` prefix on `apps/*` is redundant *as a name* but is **load-bearing**:
it's wired into CI trigger paths, Vercel root directories, the GHCR image name,
`apps/$APP_NAME` on the VPS, and `deploy.sh`. Renaming a directory is a
coordinated, prod-touching migration — **not** a cleanup. Don't do it casually.
Package names (above) carry the harmony cheaply; directories are left alone.

## Shared packages — how they're built and consumed

Two things constrain this and explain why the two packages differ (it's principled,
not arbitrary):

1. **Frontends deploy on Vercel** with an app-scoped `npm install` + `npm run build`.
   They do **not** run the monorepo `pnpm`/`turbo` build, and the repo has no npm
   `workspaces` field — so a `workspace:*` dependency is unresolvable and would break
   the Vercel build. Shared code must therefore be reachable **without** package-manager
   resolution: a build-time Vite alias or a relative `require` of a real file in the
   checkout.
2. **The output type decides source-vs-prebuilt:**

   | Package | Output | Dashboard/landing consume | API consumes |
   | --- | --- | --- | --- |
   | `@umi/contract` | TypeScript | **source** — Vite alias `@umi/contract` → `packages/contract/src` (the bundler transpiles it); `dist/` is git-ignored | the **built** `dist` (Node can't `require` `.ts`); built in-workspace during the Docker/CI build |
   | `@umi/tokens` | CSS + a Tailwind JS object | the **committed** `dist/` (a bundler can't generate CSS from token JSON, and Vercel won't run the generator) via a Vite alias / relative `require` | n/a |

   So: **bundler-transpilable source → consume the source; outputs a consumer can't
   generate itself → commit the built `dist/` and gate its freshness in CI**
   (`tokens-ci.yml` rebuilds and `git diff --exit-code`s the committed `dist/`).

## Docs

`docs/` is dated, newest-wins. Architecture notes under `docs/architecture/`,
migration history under `docs/migration/`. There's no promise old dated files are
current — treat them as history unless linked from `README.md` or `AGENTS.md`.
