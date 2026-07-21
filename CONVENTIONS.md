# Conventions

Keep these consistent so tooling stays predictable and the repo stays legible.

## Package naming

- Every workspace member is `@umi/<name>`, where `<name>` is the directory name
  minus the `umi-` prefix: `apps/umi-dashboard` → `@umi/dashboard`,
  `packages/contract` → `@umi/contract`.
- **Always filter by the package name, never the directory:**
  `pnpm --filter @umi/dashboard build` (not `--filter umi-dashboard`).
- Exceptions, documented on purpose:
  - `apps/umi-landing-page` is `@umi/landing`, **not** `@umi/landing-page` — the
    `-page` is dropped. The package name is the concept (`landing`); the directory
    keeps `-page` because the prefix is load-bearing (see below).
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

   | Package | Output | Frontend consumers | API consumes |
   | --- | --- | --- | --- |
   | `@umi/contract` | TypeScript | **dashboard** only — the **source**, via Vite alias `@umi/contract` → `packages/contract/src` (the bundler transpiles it); `dist/` is git-ignored | the **built** `dist` (Node can't `require` `.ts`); built in-workspace during the Docker/CI build |
   | `@umi/tokens` | CSS + a Tailwind JS object | **dashboard + landing** — the **committed** `dist/` (a bundler can't generate CSS from token JSON, and Vercel won't run the generator) via a Vite alias / relative `require` | n/a |

   So: **bundler-transpilable source → consume the source; outputs a consumer can't
   generate itself → commit the built `dist/` and gate its freshness in CI**
   (`tokens-ci.yml` rebuilds and `git diff --exit-code`s the committed `dist/`).

## Docs

`docs/` is dated, newest-wins. Architecture notes under `docs/architecture/`,
migration history under `docs/migration/`. There's no promise old dated files are
current — treat them as history unless linked from `README.md` or `AGENTS.md`.

## Linting & formatting

**Prettier formats; ESLint finds bugs.** They are not competitors here — Prettier owns
style, ESLint owns correctness, and no ESLint stylistic rules are configured.

- **Prettier formats code, not prose.** `.prettierignore` excludes build outputs, the frozen
  `apps/umi-cash`, the Swift app, captured run artifacts, per-developer local files, and
  **all Markdown**. The Markdown rule started as `.agents/skills/` (authored prose, mirrored
  to `.claude/skills` by symlink, 53% of the debt) and was generalised once measured:
  formatting `docs/` + the root `.md` files produced **3,758 changed lines, ~1,847 of them
  table-pipe padding and ~1,618 `*emphasis*` → `_emphasis_`** — which render identically. A
  large conflict-prone diff across the architecture docs, for output no reader can tell apart.
- **Prettier is not always idempotent — `format` then `format:check` can still be red.**
  Three `umi-api` spec files were still reported unformatted *after* `prettier --write` had
  rewritten them; a second pass changed them again and only then did `--check` agree. The
  trigger is method-chain breaking (`vi.fn().mockResolvedValue({ ... })`) that pass 1 explodes
  and pass 2 collapses. If `format:check` fails on a tree you just formatted, run `pnpm format`
  again before assuming CI is wrong. It converged in 2 passes; the 3rd was a no-op.
- **Formatting-only commits belong in `.git-blame-ignore-revs`.** A 306-file reformat would
  otherwise make `git blame` attribute every touched line to whoever ran the formatter.
  GitHub honours the file automatically; locally run
  `git config blame.ignoreRevsFile .git-blame-ignore-revs` once. Only list commits that are
  genuinely formatting-only — listing a behaviour change would hide a real author.
- **ESLint 10, flat config, per package.** Not v9: it reaches EOL 2026-08-06. Config lives in
  each package's `eslint.config.js`; there is no root config, because the packages genuinely
  differ (a NestJS service and a plain-JSX SPA want different rules).
- **Type-aware rules only where there are types.** Everywhere `tsc --noEmit` runs, the
  compiler is the safety net and linting earns its keep mainly through *type-aware* rules
  (floating promises, misused promises). `apps/umi-dashboard` has no TypeScript at all, so
  plain rules carry the whole load there.
- **Adopt with a ratchet, not a big-bang fix.** New surfaces land via
  `eslint . --suppress-all`, which writes `eslint-suppressions.json`. Existing debt is
  recorded **in the repo, reviewable**, the gate goes green immediately, and any NEW
  violation fails. Burn the file down over time; `--prune-suppressions` drops stale entries.
  Suppress **errors**, not warnings — muting warnings just hides the signal.
- **Never blind-`--fix` a hook rule.** `exhaustive-deps` is a heuristic, not a proof. In
  `customers.jsx` the literal fix (adding `params` to an effect that both reads and writes
  params) would have caused an infinite render loop; the correct fix removed the closure via
  a functional updater. Read the finding before applying the machine's answer.
- **Ignore build output in lint too.** The first dashboard run reported 244 errors, 200 of
  them inside `.vercel/` deploy output. A gate that is permanently red on generated code is a
  gate everyone learns to ignore — keep ESLint's `ignores` in step with `.prettierignore`.
- **A gate nobody runs is not a gate.** `.github/workflows/lint.yml` runs `pnpm lint` on every
  PR and on pushes to `build-v3`. It calls `turbo run lint`, not a per-package filter, so a
  package is covered the day it adds a `lint` script. `pnpm format:check` runs in the same job
  as a second step — held back until the format pass landed so it went green on arrival, and
  added as a *step* rather than a job so the required check name `lint` does not change.
- **A required check must never be path-filtered.** GitHub does not treat a required check
  that got skipped as passed — it leaves it Pending, forever, and the PR cannot merge. There
  is no failing check to fix, and with protection enforced for admins there is nobody who can
  click through it. So the four required workflows (`lint`, `build-and-test`, `contract`,
  `tokens`) deliberately carry **no `paths:` filter**: unconditional is what makes "required"
  safe. Do not add one back to buy speed — they run in parallel in well under a minute, and a
  filter on a required check does not make a PR faster, it makes it unmergeable. This also
  fixed a real blind spot: `contract`'s gate proves the route literals still match the
  controllers, and a controller edit lives outside `packages/contract`, so the old filter
  could not see the change most likely to break it.
- **Verify a gate red-green, through the command CI runs.** A ratchet that cannot fail is
  decoration. Add a violation, confirm exit 1, remove it, confirm exit 0 — via `pnpm lint`, not
  just the package script, since the root command adds turbo (caching, exit-code propagation).
- **Declare every ESLint plugin in the package that lints with it.** An undeclared plugin
  resolves through pnpm's hoisted store, so its version is an accident of what some *other*
  package installed. Adding `eslint-plugin-react-hooks@7` to the dashboard silently changed how
  `apps/umi-landing-page` lints — it needs `^5` and got v7's React Compiler rules in CI. A lint
  result you cannot reproduce is not a result.
- **`--frozen-lockfile` does not mean your `node_modules` is right.** It validates the lockfile,
  not the tree: a stray pre-pnpm directory under `apps/*/node_modules` survives it and reports
  "Already up to date" while shadowing the real resolution. When a local lint result disagrees
  with CI, suspect the local tree first — CI installs clean, and it was right both times here.

Rationale and primary sources (ESLint vs Biome vs oxlint, the TypeScript-version squeeze):
`docs/reports/2026-07-21-linting-toolchain-research.md`.
