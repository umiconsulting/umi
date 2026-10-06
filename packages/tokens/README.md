# @umi/tokens

Canonical Umi design tokens. One DTCG-subset source (`tokens/*.json`) is generated
into the two shapes the frontends actually consume:

| Output               | Consumed by        | How                                                                                  |
| -------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| `dist/dashboard.css` | `umi-dashboard`    | `@import '@umi/tokens/dashboard.css'` in `src/styles.css` (Vite `@umi/tokens` alias) |
| `dist/landing.cjs`   | `umi-landing-page` | `require('../../packages/tokens/dist/landing.cjs')` in `tailwind.config.js`          |
| `dist/landing.mjs`   | (ESM mirror)       | future ESM consumers                                                                 |
| `dist/tokens.json`   | tooling / docs     | fully-resolved flat token set                                                        |

## Why `dist/` is committed to git

Each frontend deploys as its **own Vercel project** with an app-scoped
`npm install` + `npm run build` (`vite build` / `next build`). Vercel never runs a
root `pnpm`/`turbo` build, so the monorepo token generator does **not** execute at
deploy time, and `workspace:*` dependencies are unresolvable (the repo has no npm
`workspaces` field). Consequently:

- the generated `dist/` is **checked in** and consumed via a Vite alias / relative
  `require` — no package-manager resolution is involved, so it works identically
  under `npm` (Vercel) and `pnpm` (local);
- `.github/workflows/tokens-ci.yml` rebuilds and `git diff --exit-code`s `dist/` on
  every PR, so a stale commit can't silently drift from source.

Regenerate after editing any token: `pnpm --filter @umi/tokens build` (or
`node build/build.mjs`) and commit the updated `dist/`.

## Layering: `core` vs per-app

- `core.json` — only the values that are **genuinely identical** across both apps
  today: `navy #223979`, `blue #7692CB`. App tokens alias these via `{color.navy}`,
  so the shared brand has a single source and cannot drift.
- `dashboard.json` / `landing.json` — everything else, captured **verbatim** from
  each app's current source. Adopting this package is a pure refactor: it changes
  **zero rendered pixels**.

## Drift register (deliberate divergences — convergence is an owner taste-call)

These pairs differ between the console and the marketing site today. They are kept
app-scoped on purpose; converging any of them repaints a live site, so each is a
separate, explicit follow-up commit (move the chosen value into `core.json` and
delete the per-app override) — never a side effect of centralizing.

| Concept      | dashboard                                      | landing                         | note                                |
| ------------ | ---------------------------------------------- | ------------------------------- | ----------------------------------- |
| soft blue    | `--umi-blue-soft #a8bbde`                      | `umi-light-blue.soft #BFD1F2`   | landing is airier                   |
| warm paper   | `--surface-warm #FAF4EC`                       | `umi-paper #FBF7EF`             | **landing's whole page background** |
| warm border  | `--surface-warm-border #EAE0D3`                | `umi-paper-warm #EDE7DA`        | low impact                          |
| deepest navy | `--umi-navy-ink #131f44`                       | `umi-blue.deep #0A1430`         | different roles                     |
| primary ink  | `--ink-1 #131f44`                              | (globals) `--ink #142142`       | near-identical                      |
| warm accent  | `--warning #B5812A` / `--tenant-brand #B5605A` | `umi-accent #E7A85B`            | likely stay distinct                |
| type system  | Source Sans 3 / JetBrains Mono                 | Nunito / Fraunces / Source Code | product-distinct by design          |

## Not yet covered (Phase 2)

`umi-landing-page/src/app/globals.css` has a **second** `:root` block
(`--color-umi-blue-*`, `--ink`, `--stroke`, `--surface`) plus recurring inline hex
literals. Sourcing those from this package (subject to `@tailwind` `@import`-ordering
constraints) closes the last drift surface. Deferred; no pixel change today.
