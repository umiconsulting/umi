# Linting toolchain for the Umi monorepo — 2026 research

**Date:** 2026-07-21
**Status:** Research + recommendation. Nothing is adopted yet.
**Scope:** `pnpm` + `turbo` workspace at the repo root — `apps/umi-api`, `apps/umi-dashboard`,
`apps/umi-landing-page`, `packages/contract`, `packages/tokens`. `apps/umi-cash` (frozen, own npm
lockfile, outside the pnpm workspace) and `apps/umi-kds` (Swift) are out of scope.

**Why this file lives in `docs/reports/`:** `docs/reports/index.md` defines reports as "dated
evidence artifacts. They are not automatically current architecture." That is exactly what this is —
evidence gathered against primary sources, plus a proposal that the owner has not yet accepted. The
dated `YYYY-MM-DD-topic.md` filename follows the convention in `docs/architecture/` and
`docs/migration/`, and `CONVENTIONS.md` ("`docs/` is dated, newest-wins"). If the recommendation is
accepted, the accepted parts belong in `CONVENTIONS.md` or `AGENTS.md`, not here.

**Source rule used:** only first-party sources — the tool's own documentation, its own release
notes, its own issue tracker, and the npm registry (publisher metadata). No blog posts or
third-party write-ups are cited as evidence. Every version number below was read from the npm
registry on 2026-07-21 with `npm view <pkg> version dist-tags peerDependencies`.

---

## 0. What is actually true in this repo (verified 2026-07-21)

I verified each of these before relying on it. Three items correct the brief that started this
research; they change the answer, so they are listed first.

### 0.1 Corrections to the starting assumptions

**Correction 1 — `apps/umi-landing-page` already lints.** The brief said no package implements a
`lint` script. That is wrong. `apps/umi-landing-page/package.json` has `"lint": "next lint"`, and
`apps/umi-landing-page/eslint.config.mjs` is a real ESLint flat config that uses `FlatCompat` to
load `next/core-web-vitals` and `next/typescript`. Its devDependencies include `eslint ^9`,
`eslint-config-next 15.3.0`, `@eslint/eslintrc ^3`, `eslint-config-prettier ^10.1.1`, `prettier
^3.5.3` and `prettier-plugin-tailwindcss ^0.6.11`. So this is a **partial-adoption** story, not a
greenfield one. One app already made the ESLint choice; the question is whether to extend it or
overturn it.

**Correction 2 — the Prettier debt is 648 files, not ~706, and it is mostly Markdown.** Measured
with `npx prettier --list-different .` from the repo root:

| Slice                                 | Files   |
| ------------------------------------- | ------- |
| **Total unformatted**                 | **648** |
| Markdown (`.md`)                      | 276     |
| Code (`.ts .tsx .js .jsx .mjs .cjs`)  | 333     |
| Other (`.yaml .yml .json .html .css`) | 39      |

By directory (all file types):

| Directory               | Files | Of which code |
| ----------------------- | ----- | ------------- |
| `.agents/skills`        | 343   | 103           |
| `apps/umi-api`          | 155   | 153           |
| `apps/umi-landing-page` | 50    | 48            |
| `apps/umi-dashboard`    | 30    | 25            |
| `docs/migration`        | 27    | 0             |
| `docs/architecture`     | 22    | 0             |
| `.github/workflows`     | 5     | 0             |
| `packages/contract`     | 4     | 3             |
| `packages/tokens`       | 2     | 0             |
| root files + misc       | ~10   | 1             |

This matters. **More than half of the "giant diff" is the `.agents/skills` procedure layer and
`docs/`, not product code.** `.agents/skills` is the canonical procedure layer that `.claude/skills`
symlinks into (`CLAUDE.md`); it is prose for agents, and reformatting it produces churn with no
engineering value. The real code debt is **333 files**, and **153 of those are `apps/umi-api`**. A
code-only, one-app-at-a-time reformat is a small, reviewable change — not a 700-file bomb.

`.prettierignore` already excludes `apps/umi-cash/` (frozen) and `apps/umi-kds/` (Swift), plus
`node_modules`, `dist`, `.next`, `build`, `coverage`, `.turbo`, `.vercel`, lockfiles and
`*.tsbuildinfo`.

**Correction 3 — `apps/umi-dashboard` has no TypeScript at all.** `apps/umi-dashboard/src` contains
21 `.jsx`, 3 `.js` and 1 `.css` file. There is no `tsconfig.json` — only a `jsconfig.json` that
declares path aliases (`@/*`, `@umi/contract`). `package.json` has `dev`, `build` and `preview`
only: **no `typecheck`, no `test`, no `lint`.**

This inverts the premise of the question. The brief assumed "we lean on `tsc`, so a linter only adds
value where it is type-aware." That is true for `apps/umi-api` and `packages/contract`. It is
**false for `apps/umi-dashboard`, which today has zero static analysis of any kind** — no type
checker, no linter, no tests. There, an ordinary non-type-aware linter (undefined variables, unused
code, React Hooks rules, `no-unsafe-optional-chaining`, accessibility) has the highest marginal
value in the whole repo, and it does not need type information to deliver it.

**The two front-end apps therefore need different answers from the backend.** See §8.

### 0.2 Everything else, as verified

- Root `package.json`: `"lint": "turbo run lint"`, `"format": "prettier --write ."`,
  `"format:check": "prettier --check ."`. `packageManager: pnpm@10.29.3`, `turbo ^2.8.8`,
  `prettier ^3.4.2`.
- `turbo.json`: the `lint` task is declared as `"lint": {}` — no `dependsOn`, no `inputs`, no
  `outputs`. With only `apps/umi-landing-page` implementing `lint`, `pnpm lint` currently runs
  exactly one package's `next lint` and reports success for everything else.
- `apps/umi-api`: NestJS 11 + Fastify, `typecheck: tsc --noEmit`, `test: vitest run`, plus
  `test:integration` on a separate vitest config. 234 `.ts` files under `src`, 47 `*.spec.ts` files,
  352 `it(`/`test(` call sites, and 4 `*.integration.ts` suites
  (`sql-preflight`, `rls`, `schema-parity`, `identity-normalization`). `tsconfig.json` is
  `strict: true` with `strictNullChecks`, `noImplicitAny`, `noFallthroughCasesInSwitch`,
  `experimentalDecorators` + `emitDecoratorMetadata`, `module: commonjs`, `target: ES2023`.
- `apps/umi-api/src/shared/database/auth-substrate.d11.spec.ts` is a real custom static-analysis
  rule written as a vitest test. It imports `typescript`, walks production source with the compiler
  API, and fails if an RLS app-pool call site (`withTenant` / `runWithTenant` / `.app.query`)
  mentions the auth substrate (`runtime.session`, `password_hash`, …). It is the only file in
  `apps/umi-api/src` or `packages/` that imports the TypeScript compiler API. **The team is already
  writing custom lint rules — just in the test runner instead of a linter.**
- `packages/contract`: `typecheck: tsc --noEmit`, `test: node --test test/*.test.mjs`, strict
  tsconfig with `moduleResolution: bundler`.
- `packages/tokens`: `build` + `test: node --test`. Pure `.mjs`, no TypeScript.
- CI: `contract-ci.yml`, `tokens-ci.yml` and `umi-api-ci.yml` are **`pull_request`-only with `paths`
  filters**. The only `push` trigger in the repo is `umi-api-deploy.yml` (`push: branches: [main]`),
  which calls the reusable `deploy-backend.yml` (typecheck + build + test, then GHCR + SSH deploy).
  `umi-api-ci.yml` documents this on purpose: "PR gate only. Pushes to main are checked + built +
  deployed by umi-api-deploy.yml." The consequence is real, though: **an integration branch such as
  `build-v3` gets no CI at all**, because merges into it are pushes, not pull requests, unless each
  merge goes through its own PR.
- `AGENTS.md:162` already promises `pnpm run lint` as a workspace command. Today that promise is
  effectively empty.

### 0.3 TypeScript versions actually pinned here

| Package                                 | Declared range | Resolved in `pnpm-lock.yaml` |
| --------------------------------------- | -------------- | ---------------------------- |
| `apps/umi-api`                          | `^5.7.2`       | **5.9.3**                    |
| `packages/contract`                     | `^5.7.2`       | **5.9.3**                    |
| `apps/umi-landing-page`                 | `^5.8.3`       | **5.9.3**                    |
| `apps/umi-dashboard`                    | none           | n/a (JSX, no TypeScript)     |
| `apps/umi-cash` (outside the workspace) | `^5.5.4`       | its own npm lockfile         |

Every workspace member resolves to a single hoisted `typescript@5.9.3`. This number is decisive —
see §2.

---

## 1. ESLint 9/10 vs Biome vs oxlint, as of 2026-07-21

### 1.1 Current stable versions (npm registry, read 2026-07-21)

| Package                     | `latest` | Published  | Notes                                                             |
| --------------------------- | -------- | ---------- | ----------------------------------------------------------------- |
| `eslint`                    | 10.7.0   | 2026-07-10 | `maintenance` dist-tag = 9.39.5                                   |
| `typescript-eslint`         | 8.65.0   | 2026-07-20 | peer `eslint ^8.57 \|\| ^9 \|\| ^10`, `typescript >=4.8.4 <6.1.0` |
| `@eslint/js`                | 10.0.1   | —          | peer `eslint ^10.0.0`                                             |
| `@biomejs/biome`            | 2.5.5    | 2026-07-21 | `beta` dist-tag still 2.0.0-beta.6                                |
| `oxlint`                    | 1.74.0   | 2026-07-14 | —                                                                 |
| `oxlint-tsgolint`           | 0.25.0   | —          | the type-aware backend for oxlint                                 |
| `prettier`                  | 3.9.6    | 2026-07-21 | —                                                                 |
| `eslint-plugin-react-hooks` | 7.1.1    | 2026-04-17 | peer includes `eslint ^10.0.0`                                    |
| `eslint-config-next`        | 16.2.10  | —          | peer `eslint >=9.0.0`                                             |
| `eslint-plugin-import-x`    | 4.17.1   | 2026-06-28 | peer `eslint ^8.57 \|\| ^9 \|\| ^10`                              |
| `typescript`                | 7.0.2    | 2026-07-08 | `latest`; `next` = 7.1.0-dev                                      |

Sources: npm registry metadata for each package (the publisher's own record).

### 1.2 ESLint

ESLint **v10.0.0 shipped 2026-02-06**. The breaking changes that matter here: the eslintrc config
system is **completely removed** (`.eslintrc.*`, `.eslintignore`, `ESLINT_USE_FLAT_CONFIG`,
`--no-eslintrc`, `--env`, `--ignore-path`, `--rulesdir`, `--resolve-plugins-relative-to` are all
gone; `/* eslint-env */` comments are now errors); Node.js < 20.19.0, 21.x and 23.x are dropped; and
ESLint now "locates `eslint.config.*` by starting from the directory of each linted file rather than
the current working directory."
([ESLint v10.0.0 released](https://eslint.org/blog/2026/02/eslint-v10.0.0-released/) — official
release announcement.)

The current release is **v10.7.0 (2026-07-10)**, and **ESLint v9.x reaches end of life on
2026-08-06** — 16 days from today. ([ESLint blog index](https://eslint.org/blog/) — official release
announcements; the v9 EOL date is also stated in the v10.0.0 post.)

Flat config resolution is monorepo-friendly by design: ESLint "searches for configuration files
starting in the directory containing the target file, then progresses upward," so a subdirectory can
own its own `eslint.config.*`. A single root config can also target subtrees, because a config object
may carry `basePath`, which makes its `files`/`ignores` globs resolve relative to that subdirectory.
([Configuration Files](https://eslint.org/docs/latest/use/configure/configuration-files) — official
docs.) `basePath` was added in **ESLint v9.30.0 (2025-06-27)**
([v9.30.0 release announcement](https://eslint.org/blog/2025/06/eslint-v9.30.0-released/)).

**What ESLint does not do:** it is not a formatter (its own stylistic rules were moved out of core
years ago and it pairs with Prettier via `eslint-config-prettier`), and it is slow relative to the
Rust/Go entrants — typed linting in particular "incur[s] the performance penalty of asking TypeScript
to do a build of your project before ESLint can do its linting"
([Typed Linting](https://typescript-eslint.io/getting-started/typed-linting) — official
typescript-eslint docs).

**Type-aware linting** is typescript-eslint's core differentiator. Setting
`parserOptions.projectService: true` gives rules access to TypeScript's type checker; the shared
configs `recommendedTypeChecked`, `strictTypeChecked` and `stylisticTypeChecked` turn on the rules
that need it. The maintainers "strongly recommend you do use type-aware linting" despite the cost.
(Same source.)

### 1.3 Biome

Biome **2.5.5** is a single binary that formats and lints. The linter ships **510 rules** across
eight groups (Accessibility, Complexity, Correctness, Nursery, Performance, Security, Style,
Suspicious). Biome v2 introduced a **Scanner** that enables type-aware rules — the docs name
`noFloatingPromises`, `noUnresolvedImports` and `noImportCycles` as rules for which type/project
information "**is needed** … which can't function otherwise." The Scanner reads `.d.ts` files in
`node_modules` including transitive dependencies. Biome publishes its own cost table: about 800 ms →
2 s at ~2k files, and about 1 s → 8 s at ~5k files, with the Scanner on
([Biome Linter](https://biomejs.dev/linter/) — official docs).

Rules are grouped into 13 **domains** — Drizzle, Next, Playwright, **Project**, Qwik, React,
ReactNative, Solid, Svelte, Test, **Turborepo**, **Types**, Vue. The `project` domain does module-graph
analysis (11 rules including `noImportCycles`, `noUnresolvedImports`, `noUndeclaredDependencies`,
`noPrivateImports`); the `types` domain "enable[s] the inference engine." The docs state plainly that
"the scanning phase will have a performance impact on the linting process."
([Linter Domains](https://biomejs.dev/linter/domains/) — official docs.)

**What Biome does not do, concretely, today:** the two rules that would matter most to
`apps/umi-api` are **not production-ready**. On Biome's own rules index,
`noFloatingPromises` is in **Nursery** and **not recommended**, and `noMisusedPromises` is in
**Nursery** and **not recommended**; `noImportCycles` is in Suspicious but not recommended, and
`noUnresolvedImports` is in Correctness but not recommended. Nursery contains 71 rules
([Biome JavaScript rules index](https://biomejs.dev/linter/javascript/rules/) — official docs). The
`noFloatingPromises` rule page confirms it belongs to the `types` domain and that Nursery rules are
"experimental and the behavior can change at any time"
([noFloatingPromises](https://biomejs.dev/linter/rules/no-floating-promises/) — official docs).

Biome also has no plugin ecosystem comparable to ESLint's, which matters because
`eslint-config-next` and `eslint-plugin-react-hooks` (including the React Compiler diagnostics) exist
only for ESLint.

### 1.4 oxlint

oxlint **1.74.0** is a Rust linter on the Oxc stack with "more than 840 rules" ported from ESLint
core, typescript-eslint, React, Jest, Vitest, Import, Unicorn and jsx-a11y. It positions itself as a
"direct replacement for ESLint" for most projects, and tells you to "stay on ESLint only if you still
depend on unsupported edge-case plugin behavior." **Custom JS plugins are in alpha.**
([oxlint guide](https://oxc.rs/docs/guide/usage/linter.html) — official Oxc docs.)

Its **type-aware** mode is the interesting part, and also the trap. It is enabled with
`oxlint --type-aware` or `options.typeAware: true` in `.oxlintrc.json` / `oxlint.config.ts`, and it
covers **59 of 61** typescript-eslint type-aware rules. Architecturally, oxlint (Rust) does traversal
and config, and **`tsgolint` (Go) builds the TypeScript programs and runs the type-aware rules using
`typescript-go`**. The documented requirements and limits: **TypeScript 7.0+ required**;
`oxlint-tsgolint` must be installed as a devDependency; **monorepos need built `.d.ts` files before
running**; some legacy `tsconfig` options are unsupported; and very large codebases "may encounter
high memory usage." The status is described as "incomplete (but very close)."
([oxlint type-aware linting](https://oxc.rs/docs/guide/usage/linter/type-aware.html) — official Oxc
docs.)

### 1.5 tsgolint — the shared dependency underneath the fast type-aware story

`tsgolint` is typescript-eslint's own experiment: "an experimental proof-of-concept typescript-go
powered JS/TS linter written in Go." It implements **40 type-aware rules** and reports **20–40×**
speedups. Its own README says: "**tsgolint is a prototype in the early stages of development. It is
not actively being worked on, nor is it expected to be production ready.**" It has no non-type-aware
rules, no JS plugin support, no editor extensions, no configuration file and no plugin system. The
maintainers state they have "no plans to take significant development budget away from
typescript-eslint" for it. ([typescript-eslint/tsgolint](https://github.com/typescript-eslint/tsgolint)
— the project's own repository.)

oxlint's type-aware path rides on `oxlint-tsgolint` (0.25.0), a fork/derivative of that prototype.
That is the single most important risk factor in choosing oxlint for type-aware rules today.

### 1.6 Side-by-side on the thing that matters: type-aware rules

| Capability                                    | ESLint + typescript-eslint 8.65      | Biome 2.5.5                                       | oxlint 1.74 (`--type-aware`)                       |
| --------------------------------------------- | ------------------------------------ | ------------------------------------------------- | -------------------------------------------------- |
| Type-aware rules available                    | Full set, stable, documented         | `types` + `project` domains; key rules in Nursery | 59/61 typescript-eslint rules                      |
| `no-floating-promises` production-ready       | **Yes** (`recommended-type-checked`) | **No** — Nursery, not recommended                 | Ported; gated on the requirements below            |
| `no-misused-promises` production-ready        | **Yes** (`recommended-type-checked`) | **No** — Nursery, not recommended                 | Ported; same gate                                  |
| Import-cycle detection                        | via `eslint-plugin-import-x`         | `noImportCycles` (Suspicious, not recommended)    | ported `import/*` rules                            |
| TypeScript version required                   | `>=4.8.4 <6.1.0`                     | none (own inference engine)                       | **TypeScript 7.0+**                                |
| Type engine maturity                          | TypeScript itself                    | Biome's own inference engine                      | `tsgolint`, a self-declared unmaintained prototype |
| Plugin ecosystem (Next, React Hooks/Compiler) | **Yes**                              | No equivalent                                     | Ports, but custom JS plugins are alpha             |
| Formatter included                            | No (pairs with Prettier)             | **Yes**                                           | No                                                 |
| Speed                                         | Slowest                              | Fast; Scanner adds cost                           | Fastest                                            |

---

## 2. The TypeScript-version tension (this is decisive)

This section is separated because it constrains the whole decision.

**Fact 1 — TypeScript 7 is now the default install.** The npm `latest` dist-tag for `typescript` is
**7.0.2**, published 2026-07-08. (`typescript` npm registry metadata.) Anyone running
`pnpm add -D typescript` today gets TypeScript 7.

**Fact 2 — this repo is on TypeScript 5.9.3.** Declared ranges are `^5.7.2` / `^5.8.3`; the lockfile
resolves every workspace member to `typescript@5.9.3` (see §0.3).

**Fact 3 — typescript-eslint does not support TypeScript 7, and it is not planned.**
`typescript-eslint@8.65.0` declares `peerDependencies.typescript: ">=4.8.4 <6.1.0"` (npm registry
metadata; the same range appears seven times in this repo's own `pnpm-lock.yaml` for the transitively
installed `@typescript-eslint/*` packages that `eslint-config-next` pulls in). The published support
window is confirmed in the docs: "TypeScript: >=4.8.4 <6.1.0"
([Dependency Versions](https://typescript-eslint.io/users/dependency-versions/) — official docs).
Issue **#12518 "TypeScript 7.0.2 Support"** (filed 2026-07-08, against TypeScript 7.0.2 /
typescript-eslint 8.63.0 / ESLint 10.6.0) was **closed as "not planned."** The reported failure modes
are a hard `npm ci` peer-range failure, and — if forced — a runtime crash inside
`@typescript-eslint/typescript-estree` ("Cannot read properties of undefined (reading 'Cjs')").
([typescript-eslint#12518](https://github.com/typescript-eslint/typescript-eslint/issues/12518) — the
project's own issue tracker.)

The longer-term enhancement issue **#10940** ("Use TS 7 / tsgo for type information") is still
**open**, with the maintainer position that "it will take a lot of design exploration and work," and
three named blockers: ESLint has no async parser support (tsgo is async via WASM/native bindings);
tsgo "won't likely be the primary stable TypeScript version for approximately 1–2 major
typescript-eslint releases"; and there is an unsolved design problem in passing AST nodes and type
information between Go/WASM and JavaScript.
([typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940) — the
project's own issue tracker.)

**Fact 4 — oxlint's type-aware mode requires the opposite.** Its docs state **TypeScript 7.0+ is
required** for `--type-aware`, because the work is done by `tsgolint`/`typescript-go`
([oxlint type-aware](https://oxc.rs/docs/guide/usage/linter/type-aware.html)).

### What this forces

- **The two type-aware options are mutually exclusive on TypeScript version.** typescript-eslint
  needs TypeScript < 6.1. oxlint's type-aware mode needs TypeScript ≥ 7.0. There is no version of
  TypeScript on which both work.
- **Choosing ESLint + typescript-eslint means pinning TypeScript below 6.1 for now.** The repo is
  already there (5.9.3) and the range `^5.7.2` cannot drift to 7.x, so nothing breaks today. But the
  `typecheck` gate and the lint gate become coupled: a future TypeScript 7 upgrade would break
  linting until typescript-eslint catches up, and the maintainers have given no date.
- **Choosing oxlint type-aware means moving `apps/umi-api` to TypeScript 7 now**, and betting the
  correctness gate on `tsgolint`, whose own authors say it "is not actively being worked on, nor is
  it expected to be production ready." For a NestJS app with `experimentalDecorators` +
  `emitDecoratorMetadata`, a TypeScript major upgrade is a project in itself, not a lint chore.
- **Biome sidesteps the tension entirely** — it has its own inference engine and no TypeScript peer
  dependency — but pays for it by having the two rules we most want still in Nursery.
- **ESLint v9 vs v10:** v9 goes end-of-life **2026-08-06**. There is no reason to adopt v9 now.
  Everything needed is already ESLint-10-ready: `typescript-eslint@8.65.0` (`eslint ^8.57 || ^9 ||
^10`), `@eslint/js@10.0.1`, `eslint-plugin-react-hooks@7.1.1` (peer includes `^10.0.0`),
  `eslint-plugin-import-x@4.17.1` (`^8.57 || ^9 || ^10`), and `eslint-config-next@16.2.10`
  (`eslint >=9.0.0`). Adopt **ESLint 10** directly. Note that `apps/umi-landing-page` currently pins
  `eslint ^9` with `eslint-config-next 15.3.0`, so it needs a bump — and its config uses
  `FlatCompat`, which is a shim over the eslintrc format that ESLint 10 removed from core.
  `@eslint/eslintrc` still provides `FlatCompat`, but relying on it is now legacy surface; moving to
  `eslint-config-next`'s native flat export is the durable path.

---

## 3. What linting actually buys over `tsc --noEmit`

`tsc` answers "do the types line up?" A linter answers "is this a shape of code that is known to
produce bugs?" These are different questions. The rule classes below are the ones with real marginal
value here, each with its own documentation.

### 3.1 Rules that need type information (value in `apps/umi-api`, `packages/contract`)

- **`@typescript-eslint/no-floating-promises`** — flags Promises created without handling: not
  `await`ed, not `return`ed, no `.catch()`, not `void`ed, and arrays of Promises that should go
  through `Promise.all`/`allSettled`/`any`/`race`. It "requires type information to run" and ships in
  `recommended-type-checked`.
  ([rule docs](https://typescript-eslint.io/rules/no-floating-promises/)). `tsc` cannot catch this:
  an unhandled Promise is perfectly well-typed. In a NestJS + BullMQ + `pg` service, a dropped
  `await` on a transaction, a queue `add`, or an outbox write is a silent data-loss bug — which is
  precisely the failure class this repo has been fighting (`docs/migration/build-v3`).
- **`@typescript-eslint/no-misused-promises`** — flags Promises in conditionals
  (`if (promise)` is always truthy), async callbacks passed where a `void` return is expected
  (`[1,2,3].forEach(async v => …)` — the classic "the loop finished before the work did"), and
  spreads of unawaited Promises. Also type-aware, also in `recommended-type-checked`.
  ([rule docs](https://typescript-eslint.io/rules/no-misused-promises/))
- The rest of `recommended-type-checked` / `strictTypeChecked` — `no-unsafe-*`, `await-thenable`,
  `require-await`, `switch-exhaustiveness-check`, `no-unnecessary-condition`. These are the rules the
  team is implicitly asking for by leaning on `tsc`: they extend the same type information into
  control-flow and API-misuse questions the compiler does not ask.
  ([Typed Linting](https://typescript-eslint.io/getting-started/typed-linting))

### 3.2 Rules that need no type information (value in `apps/umi-dashboard` — where `tsc` runs at all)

- **`react-hooks/exhaustive-deps`** — "validates that dependency arrays for React hooks contain all
  necessary dependencies," preventing stale closures. **`react-hooks/rules-of-hooks`** validates the
  Rules of Hooks. `eslint-plugin-react-hooks` v7's `recommended` preset now also carries React
  Compiler diagnostics (`set-state-in-effect`, `set-state-in-render`, `purity`, `immutability`,
  `preserve-manual-memoization`, `refs`, `error-boundaries`, and others — 17 rules total).
  ([react.dev — eslint-plugin-react-hooks](https://react.dev/reference/eslint-plugin-react-hooks) —
  official React docs.) No type checker of any kind finds these. `apps/umi-dashboard` is 21 React
  `.jsx` files with **no analysis at all** today.
- **Import cycles** — `import-x/no-cycle` reports modules reachable from themselves through the
  import graph; options `maxDepth`, `ignoreExternal`, `allowUnsafeDynamicCyclicDependency`. The docs
  warn it is "comparatively computationally expensive."
  ([no-cycle docs](https://github.com/un-ts/eslint-plugin-import-x/blob/master/docs/rules/no-cycle.md)
  — the plugin's own documentation.) TypeScript compiles cyclic imports without complaint; the
  failure appears at runtime as an undefined import. Biome's equivalent is `noImportCycles`
  ([Biome rules index](https://biomejs.dev/linter/javascript/rules/)).
- Ordinary correctness rules — unused variables, unreachable code, `no-unsafe-optional-chaining`,
  shadowed declarations, accidental globals. In a JSX app with no `tsconfig`, these are the _entire_
  static-analysis budget.

### 3.3 The rule class this repo has already invented

`auth-substrate.d11.spec.ts` is a hand-written, compiler-API-driven architectural rule expressed as a
vitest test. That pattern works, and it should not be thrown away — it encodes a security invariant
that no off-the-shelf rule knows about. But it does show the team already needs custom static
analysis. ESLint is the only one of the three candidates with a mature custom-rule story today
(oxlint's JS plugins are alpha, per its own docs; Biome has no comparable plugin system). That is a
second, independent reason to prefer ESLint for `apps/umi-api`, beyond type-aware rules.

---

## 4. Migration cost, monorepo layout and Turborepo integration

### 4.1 Config layout

**ESLint.** Flat config supports both shapes. A root `eslint.config.mjs` can cover the whole
workspace using `basePath` per config object (added v9.30.0), or each package can own its own
`eslint.config.*` — ESLint "searches for configuration files starting in the directory containing the
target file, then progresses upward," and the docs explicitly note this "naturally supports
monorepos." ESLint 10 strengthened this: config lookup now starts from each linted file's directory,
not the CWD. ([Configuration Files](https://eslint.org/docs/latest/use/configure/configuration-files);
[v10.0.0 announcement](https://eslint.org/blog/2026/02/eslint-v10.0.0-released/))

Recommended for this repo: **per-package configs**, because the three packages need genuinely
different rule sets (typed Node/NestJS; React JSX with no types; Next.js) and because per-package
configs let each package own a `lint` script that Turborepo can schedule and cache independently.

**Biome.** v2 supports monorepos natively: a root `biome.json`, and nested `biome.json` files with
`"root": false` that use `"extends": "//"` to inherit from the repo root regardless of depth. Configs
resolve by walking up from the CWD. ([Big Projects](https://biomejs.dev/guides/big-projects/) —
official docs.)

### 4.2 Turborepo

`turbo.json` currently declares `"lint": {}`. The docs' example lint task is:

```json
{ "tasks": { "lint": { "dependsOn": ["^lint"], "inputs": ["$TURBO_DEFAULT$", "!README.md"] } } }
```

Key points from the official docs: `inputs` defines the cache hash, and "by default, Turborepo will
include all files in the package that are tracked by Git"; `$TURBO_DEFAULT$` is a microsyntax to
"fine-tune the default `inputs` behavior"; and for outputs, "without this key defined, Turborepo will
not cache any files."
([Configuring Tasks](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks) —
official Turborepo docs.)

For lint specifically: the task produces no artifacts, so `outputs` stays empty; caching still works,
because Turborepo caches the _exit status and logs_ keyed on the input hash. Do **not** set
`"cache": false` — that throws away the main benefit (skipping lint on untouched packages).
`dependsOn: ["^lint"]` is unnecessary for a linter unless a package's lint needs a dependency's build
output; here `packages/contract` builds `dist/` that `apps/umi-api` consumes, so
`dependsOn: ["^build"]` is the honest dependency if type-aware linting must see built `.d.ts` files.
Note this same constraint appears in oxlint's docs ("monorepos need built `.d.ts` files before
running").

### 4.3 Incremental adoption

All three support it, but by different mechanisms:

- **ESLint** — per-package configs mean a package that has no `eslint.config.*` is simply not linted.
  Within a package, rules can be `"warn"` first, and **bulk suppressions** (§5) let a rule be
  `"error"` immediately with existing violations frozen.
- **Biome** — nested configs with `"root": false` let one package opt in at a time; rules can be set
  to `"warn"`; `--error-on-warnings` decides whether warnings fail CI
  ([CLI reference](https://biomejs.dev/reference/cli/)).
- **oxlint** — `.oxlintrc.json` per directory; type-aware is opt-in via one flag.

Migration tooling: `biome migrate eslint --write` reads flat or legacy ESLint config, follows
`extends`, and handles `.eslintignore`; `biome migrate prettier --write` ports Prettier settings. Both
carry explicit warnings: "you are unlikely to get exactly the same behavior as ESLint because Biome
has chosen not to implement some rule options or to deviate slightly"; Node.js is required to load
plugins; YAML configs are not supported; and both commands overwrite the existing Biome config.
([Migrate from ESLint & Prettier](https://biomejs.dev/guides/migrate-eslint-prettier/) — official
docs.)

---

## 5. Adopting without a 648-file reformat diff

There is first-party support for every part of this. Ranked by how well it fits here.

### 5.1 ESLint bulk suppressions — the real ratchet

Shipped in **ESLint v9.24.0 (2025-04-04)**: "This feature allows for enabling new lint rules as
`"error"` without fixing all violations upfront. While the rule will be enforced for new code, the
existing violations will not be reported."
([v9.24.0 release announcement](https://eslint.org/blog/2025/04/eslint-v9.24.0-released/))

The mechanics, from the official docs
([Suppressions](https://eslint.org/docs/latest/use/suppressions)):

| Flag                              | Effect                                                   |
| --------------------------------- | -------------------------------------------------------- |
| `--suppress-all`                  | Suppress violations of all rules configured as `"error"` |
| `--suppress-rule <name>`          | Suppress one rule; repeatable                            |
| `--prune-suppressions`            | Drop suppressions no longer needed                       |
| `--pass-on-unpruned-suppressions` | Exit 0 even if some suppressions are now unused          |
| `--suppressions-location <path>`  | Move the suppressions file                               |

Suppressions land in `eslint-suppressions.json`, which **should be committed** so the whole team
shares one baseline. The docs' recommended workflow is `eslint --fix --suppress-all`: autofix what
can be autofixed, freeze the rest, then burn the file down over time. The count in that file is a
visible debt number that can only go down.

This is the right primitive for `apps/umi-api`: turn on `recommended-type-checked` as `error` on day
one, generate a baseline, and every new floating Promise fails CI immediately.

### 5.2 Biome's changed-files flags

Per the official [CLI reference](https://biomejs.dev/reference/cli/):

- `--changed` — "only the files that have been changed compared to your `defaultBranch`
  configuration will be linted."
- `--since` — "specify the base branch to compare against when you're using the `--changed` flag and
  the `defaultBranch` is not set in your `biome.json`."
- `--staged` — "only the files that have been staged (the ones prepared to be committed) will be
  linted."
- `--error-on-warnings` — "exit with an error code if some diagnostics emit warnings."
- `--reporter github` — annotations in GitHub Actions; `--max-diagnostics` caps output (default 20).

These are genuinely first-party and better than anything ESLint or Prettier ship for changed-file
scoping. If the repo picks Biome, this is the migration lever.

### 5.3 Prettier has no changed-files flag

Prettier's CLI has `--check`, `--list-different` ("prints the filenames of files that are different
from Prettier formatting … useful in a CI scenario"), `--write`, `--cache` and `--ignore-unknown`,
but **no `--changed` or `--since`**
([Prettier CLI docs](https://prettier.io/docs/cli)). For changed-file formatting, Prettier's own
documentation points to a pre-commit hook, recommending **lint-staged** (+ husky) as the primary
option — "useful for when you want to use other code quality tools along with Prettier … or if you
need support for partially staged files" — with `pretty-quick`, `git-format-staged` and a manual
shell hook using `git diff --cached --name-only --diff-filter=ACMR` as documented alternatives
([Pre-commit Hook](https://prettier.io/docs/precommit)). `lint-staged` is currently at 17.1.0
(npm, 2026-07-18).

### 5.4 The tactic that actually fits this repo

Because §0.1 showed the debt is mostly Markdown in a procedure layer, the cheapest correct move is
**not** a ratchet at all — it is **scoping**:

1. Add `.agents/skills/` to `.prettierignore`. It is the agent procedure layer, mirrored into
   `.claude/skills` by symlink, and it is prose. Formatting it is churn. This removes **343 of 648
   files (53%)** from the diff with a one-line change.
2. Reformat the remainder **per package, in its own commit**, following the packages' own CI paths:
   `packages/contract` (4 files) → `packages/tokens` (2) → `apps/umi-dashboard` (30) →
   `apps/umi-landing-page` (50) → `apps/umi-api` (155) → `docs/` + root (~60). Every one of those is
   a reviewable commit. Only `apps/umi-api` is large, and it is 100% mechanical.
3. Turn on `format:check` in CI only after the last of those lands.

---

## 6. CI enforcement

### 6.1 The `push` trigger question — yes, add one

Today `contract-ci.yml`, `tokens-ci.yml` and `umi-api-ci.yml` are `pull_request`-only. GitHub's own
documentation confirms the consequence: the `push` event "triggers when you push a commit or tag,"
while `pull_request` "does NOT run on direct pushes to a branch — only on PR-related activity."
It also notes that for `pull_request`, `GITHUB_REF` points at `refs/pull/N/merge`, so "your CI tests
run against the merged result, not just the head branch alone."
([Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
— official GitHub docs.)

`umi-api-ci.yml`'s own comment justifies the PR-only design for `main`: pushes to `main` are covered
by `umi-api-deploy.yml`, which re-runs typecheck + build + test before shipping. That reasoning is
sound **for `main` only**. It does not hold for a long-lived integration branch such as `build-v3`,
which receives merges and has no deploy workflow — so it currently has **no post-merge signal at
all**. Since `pull_request` validates the _merge result_ rather than the branch's actual post-merge
state, and since integration branches accumulate semantic conflicts that no individual PR sees, the
gap is real.

Recommendation: add a `push` trigger for the integration branches only, keeping the existing `paths`
filters:

```yaml
on:
  pull_request:
    paths: [...]
  push:
    branches: [build-v3] # long-lived integration branches; main is covered by umi-api-deploy.yml
    paths: [...]
```

### 6.2 Gating strategy for lint

- Add a `lint` job to `umi-api-ci.yml` (and to the contract/tokens workflows if those packages adopt
  lint), running after install/build so `packages/contract/dist` exists for type-aware linting.
- Run it as `pnpm --filter <pkg> lint` to match the existing per-package `--filter` convention in
  these workflows, not `turbo run lint` — the workflows already install with
  `--filter @umi/api...`, so a workspace-wide turbo run would fail on missing dependencies.
- Fail the build on `error`, allow `warn`. Bulk suppressions (§5.1) make "fail on error" safe from
  day one.
- Add `format:check` as a separate, later job — only after the reformat commits land — so a
  formatting failure is never confused with a correctness failure.
- `apps/umi-dashboard` and `apps/umi-landing-page` currently have **no CI workflow of their own**
  (they deploy on Vercel). If linting is meant to gate them, they need one. That is a separate,
  small piece of work and should be stated as such rather than assumed.

---

## 7. Prettier's future here

**Keep Prettier.** Reasons, in order of weight:

1. **Prettier already formats the whole repo's file mix**, including 276 Markdown files, YAML
   workflows and JSON. Biome's formatter "does not yet support formatting for all languages and
   frameworks" ([Differences with Prettier](https://biomejs.dev/formatter/differences-with-prettier/)).
   Swapping formatters would mean either losing coverage or running both.
2. **Switching formatters is itself a whole-repo reformat.** Biome documents deliberate divergences
   from Prettier: it unquotes all valid ES2015+ identifiers where "Prettier unquotes only valid ES5
   identifiers"; it omits parentheses in computed-key assignments consistently where Prettier is
   inconsistent between objects and classes; it avoids unnecessary trailing commas in arrow-function
   type parameters; it normalises parentheses around non-null assertions on optional chains; and its
   stricter parser refuses to format syntactically invalid code (duplicate modifiers, assignment to
   optional chains, top-level `return`), rendering it as unformatted "bogus nodes" where Prettier's
   Babel-based parser formats it anyway. (Same source.) Biome also defaults to **tabs** where
   Prettier defaults to spaces, which `biome migrate prettier` reconciles
   ([Migrate guide](https://biomejs.dev/guides/migrate-eslint-prettier/)). Biome's own docs state **no
   compatibility percentage**.
3. **The repo's Prettier config is already settled** (`.prettierrc.json`: semi, single quotes,
   trailing commas `all`, printWidth 100, tabWidth 2, `endOfLine: lf`) and matches `.editorconfig`.
   `apps/umi-landing-page` additionally depends on `prettier-plugin-tailwindcss`, which has no Biome
   equivalent.
4. Prettier 3.9.6 is actively released (2026-07-21).

The honest counter-argument: adopting Biome for _formatting only_ would collapse two tools into one
binary and give `--changed`/`--staged` for free. If the debt were being paid anyway, that is a
defensible moment to switch. But given that the formatting debt turns out to be mostly Markdown in a
directory that should simply be ignored, the cost of the switch now outweighs the benefit. **This is
a reversible decision — revisit it if Biome's Markdown formatting matures and the Tailwind class
sorting problem is solved.**

---

## 8. RECOMMENDATION

**Headline: adopt ESLint 10 flat config, per package, with typescript-eslint's type-aware rules on
`apps/umi-api` and `packages/contract`, and non-type-aware React rules on the two front ends. Keep
Prettier. Do not adopt Biome or oxlint as the primary linter yet.**

The reasoning in one paragraph: the two rules with the highest value here
(`no-floating-promises`, `no-misused-promises`) are **stable and recommended in typescript-eslint,
and still Nursery in Biome**; oxlint's equivalents are behind `tsgolint`, whose authors describe it
as an unmaintained prototype and which requires a TypeScript 7 upgrade this repo is nowhere near.
`apps/umi-landing-page` is already on ESLint, so ESLint is also the lower-change path. And ESLint is
the only candidate with a mature custom-rule story — which this team demonstrably needs, given
`auth-substrate.d11.spec.ts`.

### Sequenced plan

**Step 0 — cut the Prettier debt by scoping (1 commit, ~5 minutes).**
Add `.agents/skills/` to `.prettierignore` with a comment explaining it is the agent procedure layer,
not source. Debt drops from **648 → ~305 files**. Verify with `npx prettier --list-different . | wc -l`.

**Step 1 — pay the remaining format debt per package (6 commits, mechanical).**
`packages/contract` (4) → `packages/tokens` (2) → `apps/umi-dashboard` (30) →
`apps/umi-landing-page` (50) → `apps/umi-api` (155) → `docs/` + root files (~60). Each commit is
`npx prettier --write <path>` and nothing else — no logic changes, easy to review, easy to revert.
Then add `format:check` to CI. Optionally add `lint-staged` + a pre-commit hook so the debt never
returns ([Prettier pre-commit docs](https://prettier.io/docs/precommit)).

**Step 2 — `apps/umi-dashboard` first, because it has zero analysis today.**
Add `eslint@^10`, `@eslint/js@^10`, `eslint-plugin-react-hooks@^7`, and a package-local
`eslint.config.mjs` with `js.configs.recommended` + `reactHooks.configs.recommended` over
`src/**/*.jsx`. Add `"lint": "eslint ."`. This is the single highest-value change in the plan: 21
React files that currently have no type checker, no linter and no tests. **No type information is
needed**, so there is no TypeScript-version entanglement and no performance cost. If it is noisy on
day one, use `eslint --fix --suppress-all` to baseline it.

**Step 3 — `apps/umi-api`, with type-aware rules and a suppression baseline.**
Add `eslint@^10`, `typescript-eslint@^8.65`, `@eslint/js@^10`, `@vitest/eslint-plugin`. Config:
`tseslint.configs.recommendedTypeChecked` with `parserOptions.projectService: true`
([Typed Linting](https://typescript-eslint.io/getting-started/typed-linting)). Set
`no-floating-promises` and `no-misused-promises` to `error` **immediately**, then run
`eslint --fix --suppress-all` once and commit `eslint-suppressions.json`
([Suppressions](https://eslint.org/docs/latest/use/suppressions)). From that moment, every _new_
floating Promise fails CI, and the suppression count is a debt number that only decreases. Do **not**
start with `strictTypeChecked` — the `no-unsafe-*` family will be loud against `pg` result rows and
should be a second pass. Keep TypeScript pinned at `^5.x`; add a comment in
`apps/umi-api/package.json` recording _why_ (typescript-eslint peer `<6.1.0`, and TS 7 support closed
not planned — issue #12518).

**Step 4 — `apps/umi-landing-page`: modernise what already exists.**
Bump `eslint ^9 → ^10` and `eslint-config-next 15.3.0 → 16.x` (peer `eslint >=9.0.0`), replace
`next lint` with a direct `eslint .` invocation, and drop the `FlatCompat` shim in favour of the
config's native flat export if available. Note the `next lint` deprecation status is **unverified** —
see §9.

**Step 5 — wire Turborepo and CI.**
Change `turbo.json`'s `lint` task from `{}` to something with real inputs, for example
`{"dependsOn": ["^build"], "inputs": ["$TURBO_DEFAULT$", "!**/*.md"]}` — `^build` because type-aware
linting of `apps/umi-api` needs `packages/contract/dist`
([Configuring Tasks](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks)). Leave
caching **on** (no `outputs`, no `"cache": false`). In `umi-api-ci.yml`, add a `Lint` step after
`Build`, using `pnpm --filter @umi/api lint` to match the workflow's existing filter convention. Add
a `push: branches: [build-v3]` trigger to `umi-api-ci.yml`, `contract-ci.yml` and `tokens-ci.yml`,
keeping the existing `paths` filters, so integration branches stop merging blind. Leave `main` alone —
`umi-api-deploy.yml` already re-runs the checks there.

**Step 6 — keep `auth-substrate.d11.spec.ts` as it is.**
It is a working architectural gate. Once ESLint is in place, _new_ project-specific invariants can be
written as ESLint rules instead (better error locations, editor feedback, `--fix` support), but do
not port the existing one without a reason.

**Explicitly not now:**

- **Biome as linter** — revisit when `noFloatingPromises` and `noMisusedPromises` leave Nursery.
  Track [the rules index](https://biomejs.dev/linter/javascript/rules/).
- **Biome as formatter** — revisit if the Markdown/Tailwind gaps close.
- **oxlint** — worth adding later as a _fast pre-commit pass_ alongside ESLint (its non-type-aware
  rules are near-instant), but not as the type-aware gate until `tsgolint` has a maintenance
  commitment and this repo is on TypeScript 7. Both conditions are currently false.

---

## 9. What I could not verify

Listed honestly, with the reason.

1. **Turborepo `--affected` semantics and flags** — I intended to cite
   `https://turborepo.dev/docs/reference/run` for `--affected`, `TURBO_SCM_BASE` / `TURBO_SCM_HEAD`,
   `--filter` and `--continue`, so that CI could lint only affected packages. **The fetch was blocked
   in this environment and could not be retried.** Everything in §4.2 and Step 5 relies only on
   `https://turborepo.dev/docs/crafting-your-repository/configuring-tasks`, which I did fetch. Do not
   act on `--affected` until someone reads the reference page; the plan above does not depend on it.
2. **`next lint` deprecation status** — I intended to cite Next.js's official ESLint configuration
   page to confirm whether `next lint` is deprecated or removed, and in which version, plus the
   migration codemod. **The fetch was blocked and could not be retried.** What I _can_ state from the
   npm registry is that `eslint-config-next@latest` is 16.2.10 with peer `eslint >=9.0.0`, while
   `apps/umi-landing-page` pins 15.3.0 with `eslint ^9`. Step 4 should be confirmed against the
   Next.js docs before execution. This affects only `apps/umi-landing-page`.
3. **Biome's Prettier compatibility percentage** — Biome's own formatter and differences pages state
   **no** percentage. Any figure quoted elsewhere is not first-party, so none is quoted here.
4. **Whether `apps/umi-cash` should be linted** — it is frozen, outside the pnpm workspace, on its
   own npm lockfile, and already excluded from `.prettierignore`. I did not evaluate it. It has 0
   files in the Prettier diff for that reason.
5. **Actual runtime cost of type-aware linting on `apps/umi-api`** — I did not install ESLint and
   measure it. typescript-eslint documents the cost qualitatively (a TypeScript build before
   linting); Biome publishes a table (~2 s at 2k files, ~8 s at 5k files with the Scanner). With 234
   `.ts` files, the expected cost is small, but this is an inference from published figures, not a
   measurement of this repo.
6. **Whether ESLint 10 works with `experimentalDecorators` + `emitDecoratorMetadata` NestJS code at
   scale** — no primary source contradicts it (typescript-eslint parses via TypeScript itself, which
   handles decorators), but I did not run it here.
7. **The tsgolint README's own version/date** — the repository documentation carries no version
   numbers or dates, so the "not actively being worked on" statement is quoted without a date. The
   npm package `tsgolint` is at 0.0.1 and `oxlint-tsgolint` at 0.25.0 (npm registry, 2026-07-21).

---

## Source list

All links are first-party: the tool's own documentation, its own release notes, its own repository,
or the npm registry.

**ESLint** — [blog index / release announcements](https://eslint.org/blog/) ·
[v10.0.0 released (2026-02-06)](https://eslint.org/blog/2026/02/eslint-v10.0.0-released/) ·
[v9.30.0 released — `basePath`](https://eslint.org/blog/2025/06/eslint-v9.30.0-released/) ·
[v9.24.0 released — bulk suppressions](https://eslint.org/blog/2025/04/eslint-v9.24.0-released/) ·
[Suppressions docs](https://eslint.org/docs/latest/use/suppressions) ·
[Configuration Files docs](https://eslint.org/docs/latest/use/configure/configuration-files)

**typescript-eslint** — [Typed Linting](https://typescript-eslint.io/getting-started/typed-linting) ·
[Dependency Versions](https://typescript-eslint.io/users/dependency-versions/) ·
[no-floating-promises](https://typescript-eslint.io/rules/no-floating-promises/) ·
[no-misused-promises](https://typescript-eslint.io/rules/no-misused-promises/) ·
[issue #12518 — TypeScript 7.0.2 support, closed not planned](https://github.com/typescript-eslint/typescript-eslint/issues/12518) ·
[issue #10940 — use TS 7 / tsgo for type information, open](https://github.com/typescript-eslint/typescript-eslint/issues/10940) ·
[tsgolint repository](https://github.com/typescript-eslint/tsgolint)

**Biome** — [Linter](https://biomejs.dev/linter/) · [Domains](https://biomejs.dev/linter/domains/) ·
[JavaScript rules index](https://biomejs.dev/linter/javascript/rules/) ·
[noFloatingPromises](https://biomejs.dev/linter/rules/no-floating-promises/) ·
[CLI reference](https://biomejs.dev/reference/cli/) ·
[Formatter](https://biomejs.dev/formatter/) ·
[Differences with Prettier](https://biomejs.dev/formatter/differences-with-prettier/) ·
[Big Projects / monorepos](https://biomejs.dev/guides/big-projects/) ·
[Migrate from ESLint & Prettier](https://biomejs.dev/guides/migrate-eslint-prettier/)

**oxlint / Oxc** — [Linter guide](https://oxc.rs/docs/guide/usage/linter.html) ·
[Type-aware linting](https://oxc.rs/docs/guide/usage/linter/type-aware.html)

**Prettier** — [CLI](https://prettier.io/docs/cli) · [Pre-commit Hook](https://prettier.io/docs/precommit)

**React** — [eslint-plugin-react-hooks reference](https://react.dev/reference/eslint-plugin-react-hooks)

**import-x** — [no-cycle rule docs](https://github.com/un-ts/eslint-plugin-import-x/blob/master/docs/rules/no-cycle.md)

**Turborepo** — [Configuring Tasks](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks)

**GitHub** — [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

**npm registry** — publisher metadata for `eslint`, `typescript-eslint`, `@eslint/js`,
`@biomejs/biome`, `oxlint`, `oxlint-tsgolint`, `tsgolint`, `prettier`, `typescript`,
`eslint-plugin-react-hooks`, `eslint-config-next`, `eslint-plugin-import-x`, `lint-staged`,
`@vitest/eslint-plugin`, `eslint-plugin-n`, read 2026-07-21 via
`npm view <pkg> version dist-tags peerDependencies`.
