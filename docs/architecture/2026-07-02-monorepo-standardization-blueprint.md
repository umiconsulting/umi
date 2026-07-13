# Monorepo Standardization Blueprint

**Date:** 2026-07-02
**Status:** DRAFT — awaiting scope/decision sign-off before implementation
**Method:** repository-cartographer (factual graph) + scientific-research-check (official-source validation)
**Scope:** the JS/TS apps under `apps/*`. `umi-kds` (Swift) is out of scope for tooling.
**`umi-cash` is FROZEN** (2026-07-02 owner directive): the front-end has not been cut over to
the dashboard yet and needs more testing — do **not** apply any standardization to it. Its
*absorption into the dashboard* is designed here (§8), but the app itself is left untouched
until cutover.

---

## 0. Why this doc exists

The repo grew app-by-app, so every app re-invented its own conventions. There is no
single source of truth for folder topology, file naming/casing, path aliases, TS
strictness, linting, or formatting. This blueprint (a) models what the apps actually
share, (b) proposes ONE target architecture, (c) argues against that target, and (d)
lands a revised, phased, low-risk plan.

The governing tension: the user's directive is **"the same format everywhere — casing,
folders, imports, contracts."** Taken literally that means one global rule. Taken as a
senior engineer would, it means *one coherent rule-set*, applied idiomatically per
framework where the framework's own tooling dictates a convention. §5 is where that
tension is resolved.

---

## 1. Model — what the apps actually share (the factual layer)

From the cartographer graph (580 files, 59 modules) + a convention survey:

### 1.1 Shared shape

| App | Framework | Source root | Lang | Path alias | Component files | Non-component files | tsconfig | Lint | Format |
|-----|-----------|-------------|------|-----------|-----------------|---------------------|----------|------|--------|
| umi-api | NestJS + Fastify (VPS/Docker) | `src/{modules,shared,jobs}` | TS | none — relative `./ ../` | n/a | **dotted-kebab** `x.service.ts`, `x.controller.ts`, `x.dto.ts`, `x.module.ts`, `x.spec.ts`, `x.guard.ts` | `strict:true` (+ explicit null/any) | none | none |
| umi-cash | Next 14 / React 18 (Vercel) | `src/{app,components,context,lib,types}` | TS/TSX | `@/* → ./src/*` | PascalCase `Button.tsx`, `KPICard.tsx` | **MIXED** kebab (`authed-fetch.ts`, `pass-apple.ts`) + camel (`tenantAssets.ts`) | `strict:true` | none | none |
| umi-dashboard | Vite SPA (Vercel) | `src/{lib,screens}` | **JS/JSX — no TS** | none | kebab `.jsx` (`tenant-context.jsx`) | kebab `.js` | **no tsconfig at all** | none | none |
| umi-landing-page | Next 15 / React 19 (Vercel) | `src/{app,components,lib}` | TS/TSX | `@/* → ./src/*` | PascalCase `ContactForm.tsx` | **camelCase** `diagnosticTrigger.ts`, `emailService.ts` | **hyper-strict** (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, …) | ESLint flat (`next/core-web-vitals` + `next/typescript`) | none |
| umi-logs | Next 16 / React 19 (Vercel) | **root** `{app,components,lib,types,design-system}` — **no `src/`** | TS/TSX | `@/* → ./*` | PascalCase `MetricCard.tsx` | **camelCase** `logsApi.ts`, `traceAssembler.ts` (+ kebab outliers) | `strict:true` | none (has `components.json` shadcn) | none |

### 1.2 Shared concerns (recurring modules, candidate for extraction later)

- **Supabase client** — cash, dashboard, landing, logs each hand-roll one.
- **API fetch layer** — `api.ts` / `authed-fetch.ts` / `logsApi.ts` in four apps.
- **Formatting helpers** — `iso()` (umi-api `shared/format/money`), `currency.ts`/`intl.ts`
  (cash), scattered date/money formatting elsewhere. Already partially deduped in PR #17.
- **`components/ui` primitives** — cash, landing, logs each keep a barrel of shadcn-ish UI.
- **Env/config module** — every app reads env differently.

Cross-app *code* extraction (a real `packages/ui`, `packages/api-client`) is a larger,
riskier program and is **explicitly deferred**; this blueprint standardizes *conventions*
first so a future extraction has a consistent surface to pull from.

### 1.3 Monorepo tooling — the self-contradiction

- Root declares **pnpm 10.29.3** (`packageManager`) + **Turborepo 2.8** (`turbo run build/dev/lint/test`).
- BUT every app ships its own **`package-lock.json` (npm)**; there is **no root `pnpm-lock.yaml`**.
- Only `umi-landing-page` defines a `lint` script; only landing + api define `test`. So
  `turbo run lint` and `turbo run test` are near-no-ops today.
- History (memory): Vercel's dashboard project was forced to `npm install` to dodge the
  pnpm workspace. So the repo *says* pnpm and *does* npm. This must be resolved one way.

### 1.4 Non-conventional debris found (delete regardless of scope)

- `apps/umi-dashboard/server.js.pre-remap.bak` — leftover from the PR #17 server.js deletion.
- `apps/umi-logs/.claude/settings.local.json` — stray per-app agent settings (belongs in root or gitignored).
- `apps/umi-cash/prisma/**` + `db:*` scripts + `@prisma/client` — cash still carries a
  Prisma layer although the canonical DB is Supabase/Postgres via umi-api. **Flag only** —
  removing it is a behavior change, not a naming change (out of scope; see §7 follow-ups).

---

## 2. Blueprint — the target architecture (the proposal)

### 2.1 Monorepo tooling → pnpm + Turborepo, single lockfile

> **RATIFIED (engineering, not preference):** **pnpm workspaces + one root lockfile.** Reasoned
> by dominance, not vote: per-app lockfiles are *architecturally disqualified* (no workspace ⇒ no
> shared `packages/*` ⇒ the contract/token/config sharing this whole plan depends on is
> impossible). npm-workspaces reaches the same capability but is *strictly worse* — pnpm's
> content-addressable store is more disk/CI-efficient, its non-flat `node_modules` prevents
> phantom dependencies (a correctness property npm hoisting lacks), and the root **already
> declares** `pnpm@10` + turbo (choosing npm means tearing out the declared toolchain for a
> weaker model). npm's only edge — Vercel defaults to `npm install` — is a one-time Install-
> Command flip, not an engineering trade. Only an *external* constraint (a Vercel policy
> forbidding the install-command change) could override this; none exists.
> **Shipping is PR-per-phase** (small batch size ⇒ lower change-failure rate + faster recovery;
> CodeRabbit skips >150-file PRs so a stacked mega-PR gets *zero* review; per-phase = independent
> revert + bisect).

- **One package manager: pnpm** (the root already commits to it). One **`pnpm-lock.yaml`
  at the root**; delete all five per-app `package-lock.json`. *(pnpm workspaces exist
  precisely to give a single lockfile; Turborepo reads the pnpm workspace graph.)*
- Every app defines the **same four scripts** where applicable: `dev`, `build`, `lint`,
  `test` (+ `typecheck`). Turbo's `lint`/`test` tasks become real.
- Vercel projects set **Install Command = `pnpm install`** and **Root Directory =
  `apps/<app>`** (Turbo's remote cache optional, not required).

### 2.2 Directory topology → identical skeleton

Every app roots its code at **`src/`**:

```text
apps/<app>/
  src/
    app/            # Next apps: App Router (page.tsx, layout.tsx, route.ts — framework-fixed names)
    components/     # React apps: PascalCase components; components/ui = primitives
    lib/            # framework-agnostic helpers, clients, config
    server/ | modules/  # umi-api only: NestJS feature modules + shared
  <framework config at app root>
```

- **Fix `umi-logs`**: move root-level `app/ components/ lib/ types/ design-system/` under `src/`.
- `design-system/` in logs is renamed/folded into `src/components/ui` + `src/lib/theme` (it is app-specific, not a shared kernel).

### 2.3 Path aliases → one rule

- **`@/*` → `./src/*`** in every TS app (cash + landing already match; logs changes from
  `./*` after its `src/` move; api adopts it too).
- Ban deep relative climbs (`../../../`): ESLint `no-restricted-imports` nudges toward `@/`.
- umi-api (Nest) currently uses relative-only; it adopts `@/*` for cross-module imports so
  the *whole repo* shares one alias (§5 debates whether Nest is exempt).

### 2.4 TypeScript → shared base config

- New internal package **`packages/tsconfig`** exposing `base.json`, `next.json`,
  `react-spa.json`, `nest.json`. Each app's `tsconfig.json` becomes ~5 lines: `extends` +
  `paths` + `include`.
- Base pins the strict floor: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `noImplicitReturns`, `forceConsistentCasingInFileNames`, `verbatimModuleSyntax`. (Adopts
  landing's hyper-strict settings as the shared standard — it's the strictest, so it's the
  safe convergence target; the others tighten toward it.)
- **umi-dashboard migrates JS/JSX → TS/TSX** so it stops being the untyped outlier. (This
  is the single largest optional lift; §5 argues it may be deferred.)

### 2.5 Linting + formatting → shared, enforced, one formatter

- New internal package **`packages/eslint-config`** (flat config): `base.js`,
  `next.js`, `react.js`, `nest.js`. Generalizes landing's `next/core-web-vitals +
  next/typescript` to all apps and adds `import/order` + `no-restricted-imports`.
- **Prettier at the root** (single `.prettierrc` + `.prettierignore`) — currently NObody
  formats. Prettier owns whitespace/quotes/semicolons; ESLint owns correctness. One
  `.editorconfig` at root (LF, UTF-8, final newline).
- Import ordering standardized by `eslint-plugin-import` / built-in sort: external →
  `@/` alias → relative, alphabetized, blank-line-separated groups.

### 2.6 File naming → §5 decides between two coherent models

Two internally-consistent target models; they differ only for **React component files**:

- **Model A — global kebab-case.** *Every* file in the repo is kebab-case, including React
  components (`kpi-card.tsx`, `contact-form.tsx`). Nest is already compliant; Next's
  framework files (`page.tsx`, `layout.tsx`) are already compliant; dashboard already
  compliant. Only the PascalCase component files in cash/landing/logs get renamed.
  - Pro: literally "one format everywhere"; URL/case-insensitive-FS safe; no casing debate ever again.
  - Con: fights every React/Next scaffolder and the ecosystem habit (`<KpiCard/>` living in `kpi-card.tsx`).

- **Model B — framework-idiomatic (one rule-set).** File name always kebab-case **except**
  a file whose *default export is a React component* is PascalCase (matching the component
  name). Nest keeps its dotted-kebab (`x.service.ts`). This is the documented Next/React norm.
  - Pro: matches each tool's generators + official examples; smallest churn (only fix the
    camelCase `lib` files in cash/landing/logs, e.g. `emailService.ts → email-service.ts`).
  - Con: two casings coexist (PascalCase components alongside kebab everything-else) — though
    that pairing *is* the documented React convention, not an inconsistency.

Non-negotiable in **both** models (fixes today's real mess):
- No **camelCase file names** for non-component modules (`tenantAssets.ts`,
  `diagnosticTrigger.ts`, `logsApi.ts`, `traceAssembler.ts` → kebab).
- No **underscore-prefixed** module files (`_shared.ts`, `_header.tsx` in cash) except where
  a framework mandates it.
- Folders: always **kebab-case, lowercase** (already true; enforce).
- Type/interface names PascalCase; functions/vars camelCase; constants SCREAMING_SNAKE;
  React components PascalCase (identifier rules are ecosystem-universal — not in dispute).

---

## 3. Review (does the blueprint hold together?)

- **Topology + alias + tsconfig base + lint/format** are low-controversy, high-value, and
  mostly additive (new `packages/*`, thin per-app configs). They do not move product code.
- **Single lockfile / pnpm** removes a genuine correctness hazard (five drifting lockfiles;
  `npm ci` vs pnpm ambiguity) and makes the already-declared toolchain true.
- **File naming (§2.6/§5)** is the only part that rewrites large numbers of import
  statements and churns git blame. It is separable and must be sequenced last.
- **dashboard JS→TS** and **logs `src/` move** are structural but self-contained per app.

## 4. Critique — the argument *against* this blueprint

1. **"Same format everywhere" can become dogma that fights the tools.** Model A's global
   kebab renames every React component and contradicts `create-next-app`, shadcn, and the
   Next docs' own examples. Uniformity you have to fight your generators to maintain decays
   the moment someone runs a scaffolder. → *Model B is the senior default; adopt A only if
   the owner explicitly values absolute uniformity over ecosystem fit.*
2. **Big-bang renames are pure risk with near-zero product value.** Renaming 100+ files
   rewrites imports across Vercel- and Docker-deployed apps; one missed reference or a
   case-only rename on a case-insensitive macOS FS pushed to a case-sensitive Linux build =
   a broken prod deploy. → *Naming is the LAST phase, per-app, each behind its own green
   build + CI, never bundled with config changes.*
3. **Forcing umi-api onto `@/*` fights NestJS.** The Nest CLI, docs, and every generator
   emit relative imports and dotted-kebab names. Dragging it to `@/*` yields marginal
   cross-repo tidiness for real friction with the framework. → *Let Nest keep relative
   imports + dotted-kebab; "consistency" means "idiomatic within each stack," which §5
   Model B already encodes.*
4. **pnpm consolidation has a known Vercel scar.** The dashboard was moved to `npm install`
   specifically to dodge the pnpm workspace on Vercel. Re-committing to pnpm means fixing
   Install Command + Root Directory on 4 Vercel projects; get it wrong and deploys break.
   → *Resolved (§2.1): pnpm, done properly — root lockfile + Vercel Install Command per
   project. The half-state (declares pnpm, ships npm lockfiles) was the actual bug.*
5. **hyper-strict tsconfig as the floor may surface latent type errors** in cash/logs/api
   that currently compile. → *Land the base config in "loose-compatible" mode, then ratchet
   each strict flag per app behind its own green `typecheck`.*
6. **dashboard JS→TS is a real migration, not a rename.** It can regress a live app for
   cosmetic gain. → *Defer; treat as its own project, not part of standardization.*
7. **Formatter adoption reflows every file = one giant noisy diff.** → *Land Prettier in a
   single isolated "format-all" commit with `.git-blame-ignore-revs`, separate from any
   logic change.*

## 5. Resolution — the fixed plan (post-critique)

- **Naming: recommend Model B** (framework-idiomatic; one rule-set). Model A is available
  if the owner prioritizes literal uniformity — this is the one question that changes the
  whole naming phase, so it is asked before any rename runs. **Both models still fix the
  camelCase/underscore lib-file mess**, which is the actual inconsistency.
- **umi-api stays relative + dotted-kebab** (idiomatic); it does not adopt `@/*`. It is
  already the most consistent app; it needs only lint/format/base-tsconfig wiring.
- **Package manager: ratified pnpm + single root lockfile** (§2.1) — decided on engineering
  merit, not left open. The half-state (root declares pnpm, apps ship npm lockfiles) is fixed
  by consolidating on the toolchain the root already declares.
- **Sequencing is strictly risk-ascending, each phase independently shippable + CI-green:**

| Phase | Content | Risk | Moves product code? |
|-------|---------|------|---------------------|
| **0 — Debris** | Delete `server.js.pre-remap.bak`, stray `apps/umi-logs/.claude`, dead scratch; flag Prisma-in-cash | none | no |
| **1 — Tooling truth** | Resolve pnpm-vs-npm; single lockfile OR honest per-app; make `turbo lint/test` real; uniform scripts | med (deploy config) | no |
| **2 — Shared config** | `packages/tsconfig` + `packages/eslint-config` + root Prettier + `.editorconfig`; apps extend; format-all commit w/ blame-ignore | low | no (whitespace only) |
| **3 — Topology + alias** | logs → `src/`; `@/* → ./src/*` everywhere (except Nest); enforce kebab folders | med (imports) | moves files |
| **4 — File naming** | Apply Model A or B; fix camelCase/underscore; per-app, one at a time | **high** | renames + import rewrites |
| **5 — (deferred)** | `packages/ui`+`packages/api-client` extraction; cash Prisma removal _(dashboard JS→TS is elevated to P3 — §8.2/§9.8, not parked here)_ | high | yes |

Each phase = its own PR, its own green build/test, never bundled.

---

## 6. Scientific-research-check (source-backed)

**Question decided:** what naming / topology / tooling conventions to standardize on, and
whether "the same everywhere" should be literal-global or framework-idiomatic.

**Primary/official sources checked:**
- Turborepo — *Structuring a repository* & *Managing dependencies* (turborepo.dev): `apps/`
  for deployables, `packages/` for shared libs/tooling; Turbo reads the package manager's
  workspace graph.
- pnpm workspaces (official): a workspace has **one lockfile** at the root — the stated
  reason to use it.
- Next.js — *File-system conventions* (nextjs.org): special files (`page`, `layout`,
  `route`, `error`) are fixed lowercase; folder = route segment (kebab/lowercase).
- NestJS docs + Nest CLI generator behavior: files are kebab-case with a `.role.ts` suffix
  (`x.service.ts`, `x.module.ts`) — the generator default.
- ESLint flat config + Turborepo linting handbook: share config via an internal
  `packages/eslint-config`; Prettier owns formatting, ESLint owns correctness.

**Facts established by sources (documented fact):**
- pnpm workspaces are designed around a *single* root lockfile; five per-app npm lockfiles
  contradict the root's own `packageManager: pnpm`.
- Turborepo's canonical layout is `apps/` + `packages/`, config shared via internal packages.
- Next.js mandates specific lowercase file names for routing; component *file* casing is
  NOT mandated by Next — PascalCase-component-in-kebab-or-PascalCase-file is convention, not spec.
- NestJS's own tooling produces kebab + dotted-role names → umi-api is already compliant.

**Source-backed tradeoffs:**
- Global-kebab (Model A) maximizes uniformity but diverges from React/Next scaffolders;
  framework-idiomatic (Model B) matches the tools at the cost of two coexisting casings
  (which the React ecosystem already treats as normal, not inconsistent).
- Single pnpm lockfile improves reproducibility but requires correct Vercel install-command
  wiring (a documented friction point when a project's root is inside a pnpm workspace).

**Umi-specific conclusion (inference, labeled):**
- Adopt Model B (idiomatic) unless the owner explicitly values literal uniformity.
- Consolidate on pnpm + one lockfile (the root already declares it) — ratified in §2.1. The
  Vercel projects must set Install Command = `pnpm install`; the prior half-state (declares
  pnpm, ships npm lockfiles) was the real defect.
- umi-api is exempt from `@/*` and stays framework-idiomatic.

**What would invalidate this later:**
- Vercel proves unable to build an app from inside the pnpm workspace even with the install
  command set → keep that app on npm and document the exception.
- A future `packages/ui` extraction changes component-file ergonomics enough to revisit A vs B.
- A Next/React major changes the documented file-naming guidance.

---

## 7. Deferred / flagged (NOT in this program)

- **cash Prisma layer** — `prisma/`, `db:*` scripts, `@prisma/client`. Canonical DB is
  Supabase via umi-api; investigate whether cash still needs Prisma or it's dead weight.
- **Framework-version drift** — Next 14 (cash) / 15 (landing) / 16 (logs); React 18 vs 19.
  Real, but a dependency-upgrade program, not naming standardization.
- **Cross-app code extraction** — `packages/ui`, `packages/api-client`, `packages/supabase`.
- **dashboard JS→TS** migration — *elevated to P3 (§8.2/§9.8) by the product direction; kept here only as a pointer*.

---

## 8. Product topology — api ⇄ dashboard coupling, and where cash goes

> **⛳ SUPERSEDED in part (2026-07-05, owner):** the "**umi-cash is PERMANENT**" call below is reversed. **umi-cash is not permanent — the repo retires and everything folds into the dashboard.** The operator half → RBAC- + product-gated dashboard modules (§8.3, still valid); the customer half shrinks to **register-for-wallet + download the pass**, folded into the dashboard as a **public** surface. **The QR-code constraint (§8.6) is NOT superseded — it carries forward:** printed codes point at `cash.umiconsulting.co/{slug}/customer`, so that URL keeps working — **for now it just redirects to the new route (keep the original URL if possible).** Interim: umi-cash + dashboard both call umi-api endpoints (env on the VPS). See the 2026-07-05 platform-restructure implementation plan.

> **Decisions (2026-07-02):**
> - **RESOLVED (owner):** cash's **customer-facing surface is PERMANENTLY `umi-cash`** at
>   `cash.umiconsulting.co/{slug}` (tenant login / customer wallet creation), with the physical
>   **QR deep-linking to `cash.umiconsulting.co/{slug}/customer`** for wallet creation. umi-cash
>   does not retire — it *slims to its customer/wallet half*; only its operator/admin half
>   migrates to the dashboard.
> - **PENDING (asked, not yet answered):** bind api⇄dashboard via **`packages/contract`, keep
>   separate deployables** (recommended; no folder merge). No implementation has started.

### 8.1 The real product boundaries (not the current folder layout)

The folder layout (`apps/umi-*`) is flat and treats all six as peers. The *product* reality
is three tiers:

- **Core platform (one product, two deployables):** `umi-api` (the backend + contract
  source-of-truth) + `umi-dashboard` (its operator console). The dashboard is a **pure HTTP
  client of umi-api** — cookie auth, `VITE_API_BASE=api.umiconsulting.co`, every screen maps
  to an umi-api route. They release together whenever the contract changes.
- **Native client:** `umi-kds` (Swift/iPad). HTTP-only client of umi-api; shares *no* code
  with the TS stack; App Store distribution + Xcode toolchain. Genuinely separate.
- **Satellites:** `umi-landing-page` (public marketing + lead capture) and `umi-logs`
  (internal observability). Separate audiences, separate deploys, light api coupling.
  `umi-cash` is **not** a retiring satellite — it becomes the **permanent customer/wallet
  app** at `cash.umiconsulting.co/{slug}` (printed QR codes point there — a hard stability
  constraint). Only its operator/admin half migrates into the console (§8.3); the customer
  half stays (§8.4). Domain/URL topology in §8.6.

So the owner's instinct — "once cash folds in, is KDS the only other app?" — is right *for the
operator surface*: the platform becomes api+dashboard, and **KDS is the one remaining
first-class client that isn't part of the web console.** Landing + logs still exist, but as
peripheral satellites, not part of the core operator loop.

### 8.2 Should api + dashboard live in the same folder? — recommendation: **NO merge, YES contract**

They are contract-coupled, not code-coupled. Merging them into one package fuses two build
systems (`nest build` vs `vite build`), two runtimes (Node server vs browser SPA), and two
deploy targets (VPS/Docker/GHCR vs Vercel static) into one `package.json` — that fights both
toolchains for cosmetic proximity.

The monorepo-native way to encode "intertwined" is a **shared contract package**, not a
folder:

- **`packages/contract`** — the API's request/response DTOs + route paths as TypeScript types,
  **owned by umi-api** (source of truth) and **imported by umi-dashboard** (client). Change a
  route shape → both sides fail `typecheck` in the same PR → the coupling is enforced by the
  compiler, which is *stronger* than living in the same directory. Today the dashboard is JS
  with hand-typed `fetch` in `data.jsx` — there is **zero** contract enforcement; that is the
  actual fragility, and a folder move wouldn't fix it.
- KDS can later consume the same contract via OpenAPI→Swift codegen; it never shares TS code.

**Folder grouping** (`apps/platform/{api,dashboard}`) is *optional and deferred*: it would make
the filesystem mirror the product boundary, but it rewrites every deploy path — Vercel Root
Directory, the Dockerfile build context, and the CI trigger `apps/umi-api/**` in
`umi-api-deploy.yml`. High blast-radius for an organizational nicety. Do it only if/when the
contract package has already made the coupling real; not now.

**Consequence:** because the dashboard is becoming *the* product front-end (and will host a
loyalty/payments POS), its JS-only, untyped state is no longer acceptable. The **dashboard
JS→TS** migration is therefore **elevated to P3** (§9.8), tied to `packages/contract` — it is
**no longer a §5 'Phase 5' item**. This is the one place the earlier "defer JS→TS" call
(§4/§7) is reversed by the new product direction.

### 8.3 The dashboard's new form — absorbing cash's *operator* half

The dashboard is already a **product-gated module console** (`src/lib/module-registry.js`):
`MODULES[key].product ∈ {dashboard, kds, cash, conversaflow}`, shown when
`capabilities.products[product].status ∈ {active, trialing}` and the role check passes. Cash
already appears here as `members` (Loyalty) + `gift-cards`. Absorption = **extend this
registry**, not a new architecture:

| New/promoted dashboard module | `product` | Backs onto (umi-api, already live) | Source cash surface |
|---|---|---|---|
| `register` (POS: scan → visit/redeem/birthday, topup, purchase) | `cash` | `POST cash/{scan,topup,purchase}` | cash `admin/{scan,topup,purchase}` |
| `members` (Loyalty) — promote to full ops | `cash` | `GET/POST cash/customers`, `stats`, `analytics` | cash `admin/{customers,analytics}` |
| `gift-cards` — issue/redeem | `cash` | `GET/POST cash/gift-cards`, `gift/:code` | cash `admin/gift-cards` |
| loyalty settings (rewards, birthday, promotion) | `cash` | `GET/PATCH/PUT cash/reward-config`, `settings` | cash `admin/settings/*`, `rewards` |

The backend is **already ported** (umi-api `modules/cash/*`: stats, customers, gift-cards,
purchase, topup, scan, reward-config, settings, analytics) and the dashboard already calls
`/api/tenants/:tenantId/cash/*` via `data.jsx`. So the absorption is **mostly building the SPA
screens** (`src/screens/register.jsx` etc.) against routes that already exist — not new
backend work. Cash's tenant `settings/*` pages fold into the existing dashboard `settings`
module as sub-tabs.

### 8.4 What the dashboard does NOT absorb — the customer-facing surface

Cash is really **two products wearing one repo**:

1. an **operator POS/loyalty console** → folds into the dashboard (§8.3);
2. a **customer-facing surface** → the wallet pass (`card`, Apple/Google `passes/*`), public
   gift redemption (`gift/[code]`), customer self-registration (`register`), privacy/terms
   pages.

The customer-facing half is a **different audience** (end customers, public, unauthenticated)
and must NOT be jammed into the owner console. **RESOLVED:** it stays in `umi-cash` as the
**permanent customer/wallet app** at `cash.umiconsulting.co/{slug}`, with the physical QR
deep-linking to `cash.umiconsulting.co/{slug}/customer`. The console takes only the operator
half. Full domain/URL topology + the cookie landmine are in §8.6; the adversarial review of
this whole decision is §8.7.

### 8.5 Revised topology summary

```text
packages/
  contract/          # api DTOs + route types — owned by api, consumed by dashboard  (NEW, priority)
  tsconfig/          # shared base configs                                            (§2.4)
  eslint-config/     # shared flat config                                             (§2.5)
apps/
  umi-api/           # backend + contract source of truth
  umi-dashboard/     # operator console for ALL products (JS→TS, consumes contract)   (absorbs cash operator half)
  umi-kds/           # native iPad client (Swift) — separate
  umi-landing-page/  # public marketing + leads — satellite
  umi-logs/          # internal observability — satellite
  umi-cash/          # FROZEN now; PERMANENT customer/wallet app @ cash.umiconsulting.co/{slug} (QR target); operator half → console (§8.6)
```

### 8.6 Domain / URL topology

One backend, two front-ends for two audiences:

```text
api.umiconsulting.co        # single backend (umi-api) for BOTH front-ends below
<console>                   # operator console (Vite SPA). TODAY: dashboard.umiconsulting.co
                            #   TARGET (optional): app.umiconsulting.co, dashboard.* 301→app.*
   <console>/cash           #   cash operator surface = a NAV SECTION, not a monolith:
   <console>/cash/register  #     Register/POS (scan · topup · purchase)
   <console>/cash/members   #     Loyalty members
   <console>/cash/gift-cards#     Gift cards
   <console>/cash/settings  #     Loyalty settings (rewards · birthday · promotion)
cash.umiconsulting.co       # customer/wallet app (umi-cash, Next) — PERMANENT
   /{slug}                  #   customer login / wallet creation entry
   /{slug}/customer         #   ← physical QR deep-links here (wallet creation)
   /{slug}/gift/{code}      #   public gift redemption
   /{slug}/card             #   the wallet pass
```

- **Why cash.* is frozen by physics:** printed, in-store QR codes point at
  `cash.umiconsulting.co`. Moving that domain orphans every tenant's printed materials. The
  customer domain is therefore fixed regardless of any tidiness argument.
- **Operator paths on cash.*** (`/{slug}/admin/*`, staff login) → **301 → `<console>/cash`**,
  done at the **edge (Vercel `redirects`)**, not in app code, so umi-cash keeps no operator logic.
- **Cookie landmine (the one real hazard):** the auth cookie is `Domain=.umiconsulting.co`, so
  it is sent to *every* subdomain. The operator session and the customer-wallet session must
  therefore use **distinct cookie names**, and the operator cookie should be **scoped to the
  console host** (not `.umiconsulting.co`) so it is never even transmitted to `cash.*`. `api.*`
  distinguishes which token it honors per route. Get this wrong and a customer login can clobber
  or be confused with an operator session — privilege/identity bleed across subdomains.

### 8.7 Adversarial review of §8 (for · against · iterate · polish · reason)

**Arguments FOR the split (app.* console + cash.* customer, cash-as-section):**
- The two surfaces are genuinely different products — different auth, audience, UX, and deploy
  cadence. umi-cash today *conflates* them; the split fixes an existing smell, it doesn't invent one.
- The customer domain is **forced** by printed QR codes (external, near-irreversible). This isn't a
  preference to defend — it's a constraint to design around.
- Separate subdomains shrink security blast radius (a public-surface XSS can't reach operator
  cookies if cookie scoping is done per §8.6).
- `<console>/cash` as a section slots straight into the **existing** product-gated module registry;
  no new architecture, minimal churn.

**Arguments AGAINST / risks (and the fix):**
1. **Shared-cookie collision** — the genuine landmine. → distinct cookie names + host-scoped
   operator cookie (§8.6). Elevated to a MUST, not a footnote.
2. **`dashboard.` → `app.` rename is churn coupled to nothing.** The cash-as-module decision holds
   whether the console lives at `dashboard.*` or `app.*`. → **Decouple them.** Rename is optional,
   low-urgency, cosmetic; do it later behind a 301. Don't gate the cash migration on it.
3. **"the whole module" as one monolithic `/cash` screen** would lose deep-linking + per-module role
   gating. → make it a **section with sub-routes**, not a mega-component.
4. **Redirect logic living in umi-cash** re-introduces operator concerns into the customer app. →
   push redirects to **edge config**, keep umi-cash operator-free.
5. **Loyalty UI now spans two codebases** (operator screens in the console, customer screens in
   umi-cash) → brand/card/pass drift over time. → accept for now; flag a future
   `packages/loyalty-ui` shared kernel. Not urgent, but named so it isn't forgotten.

**Iterate → polished position:**
- Cash operator surface = a **console section with sub-routes** — YES, and independent of domain name.
- `dashboard.→app.` rename — **decoupled**, optional, later, with 301.
- `cash.umiconsulting.co` = customer/wallet **permanent** (QR-forced); operator paths 301 at the edge.
- **Cookie discipline is the actual engineering work** here — treat it as the acceptance criterion.
- Flag `packages/loyalty-ui` as the drift mitigation, deferred.

**Reason (the through-line):** we are not *imposing* a split — we are *separating two products that
were wrongly merged*, under one constraint that removes the main degree of freedom (the QR-pinned
customer domain). Everything else follows mechanically. The only place real judgment is required is
the shared cookie domain; that is where the care goes.

---

## 9. Whole-monorepo product-boundary audit (extremely critical)

Same lens as §8, applied to *every* app. Axes: **audience**, **does it own data/secrets**
(only umi-api may), **domain**, **verdict**. The evidence below is grep-verified, not inferred.
The recurring disease is **boundary leakage**, not "too many apps."

### 9.1 The apps by audience — 1 backend, 1 native client, and 3 web audiences

| App | Audience | Owns data/secrets today? | Verdict |
|-----|----------|--------------------------|---------|
| umi-api | (backend) | **YES — and it's the only one allowed to** | keep; sole owner of data + secrets |
| umi-dashboard | tenant operators | no data, but **no types/contract/design-system** | → console (§8); JS→TS + contract + tokens |
| umi-cash | end customers **+** operators (conflated) | **Prisma ORM still present** | split (§8); strip operator half; investigate Prisma |
| umi-landing-page | public prospects | **YES — own sqlite + postgres + node-cron** ⚠ | keep as marketing; **delete its DB/cron engine** |
| umi-logs | **internal Umi staff** | **YES — service_role + Management token in the browser bundle** ⚠⚠ | **DELETE now** (owner 2026-07-02); reserve ideal future spec (§9.3) |
| umi-kds | tenant operators (native) | no (HTTP client) | keep separate; consume api contract via codegen |

### 9.2 umi-landing-page — a marketing site that owns a database (delete the DB)

Grep-verified: `src/lib/database/sqlite.ts` (`better-sqlite3`), `postgres.ts`, a
`DATABASE_TYPE` env switch, `email/sequenceManager.ts` calling `getActiveLeads()`, and
`app/api/cron/emailCron.ts` running **`node-cron`**. That is a full lead-persistence +
drip-email engine living inside a **public marketing front-end**.

But the same app *also* calls umi-api: `apiUrl("/api/contact")` and `apiUrl("/api/diagnostic")`
via `NEXT_PUBLIC_UMI_API_BASE`. And the leads engine was **already ported** to umi-api
(`grow.leads` live on prod, Phase 5). So this is a **live duplication**: two lead engines, one
of them a DB+cron a static site has no business owning (cartographer §5 already flagged the
`sqlite.ts` layering violation).

**Verdict:** keep umi-landing as a pure static/SSR marketing surface; **delete
`lib/database/**`, `email/sequenceManager`, `cron/emailCron`, `better-sqlite3`, `node-cron`,
`DATABASE_TYPE`** once the api `/leads` path is confirmed (it is already wired). Marketing
front-ends emit leads; they do not persist or schedule them.

### 9.3 umi-logs — the sharpest finding: god-credentials in a shipped frontend, against a dead schema

Grep-verified, and it is bad on three axes:
1. **Bypasses umi-api entirely** — `lib/supabase.ts` does `createClient(url,
   SUPABASE_SERVICE_ROLE_KEY)` and `lib/logsApi.ts` reads `SUPABASE_MANAGEMENT_TOKEN`. A
   **service-role key bypasses RLS** and a **Management token can administer the whole Supabase
   project** — both are strictly server-only secrets, sitting in a deployed app.
2. **Targets the DEAD schema** — `DB_SCHEMA || 'conversaflow'` and queries
   `.from('inbound_events' | 'jobs' | 'outbox' | 'dashboard_users')`. The conversaflow backend
   was **deleted in PR #17** and superseded by canonical `queue.*` / `comms.*` / `observability.*`.
   So logs is reading a schema/tables that no longer exist as its source of truth → it is
   almost certainly broken or showing ghost data.
3. **Wrong audience for a merge** — logs is **internal Umi-staff** observability, not a tenant
   surface. By the same audience-separation logic as operator-vs-customer (§8), it must **not**
   become a tenant-console module.

**Verdict (owner, 2026-07-02): DELETE umi-logs now** — "it can be utterly destroyed, it doesn't
matter for now." This is the *cleanest* security remediation: removing the app removes the
`service_role` + Management-token surface entirely, so there is no "extract the secrets" step and
no rebind of a dead-schema reader. **Ops follow-up (not code):** deprovision any live umi-logs
deployment (Vercel project / subdomain) and **rotate the Supabase `service_role` + Management
token if they were ever real** — the app reads them from env (`process.env.*`), so nothing is
hardcoded to scrub, but a live deployment may still hold them.

**Reserve the ideal future structure** (per owner "keep an ideal structure for future
implementation") — a thin `apps/umi-logs/README.md` placeholder pointing here, so the slot is
reserved without shipping the dangerous app:

*Ideal future observability tool (when rebuilt):*
- **Audience:** internal Umi staff only — traces, invocations, token accounting, queue/outbox
  health. Never a tenant surface; access-gated (super_admin / SSO), on its own subdomain.
- **Data access:** **NO direct DB from the browser, ever.** Reads *only* through **umi-api
  observability endpoints** (a `modules/observability` surface / TraceService rebind) against the
  **canonical schema** (`observability.*`, `queue.*`, `comms.*`) — **no `service_role`, no
  Management token in the app**. The app is a typed client of api like every other frontend.
- **Structure:** the shared blueprint — `src/{app,components,lib}`, `@/* → ./src/*`, consumes
  `packages/{contract,tokens,eslint-config,tsconfig}`, Model-B naming. Built to the standard, not
  a bespoke outlier.

### 9.4 umi-cash Prisma — a second ORM against an unclear target

Cash still carries `prisma/` + `db:*` scripts + `@prisma/client`, while the canonical DB is
Postgres/Supabase owned by umi-api. Either cash's customer surface genuinely needs a local
data path (justify it) or this is dead weight duplicating api ownership. **Flag for
investigation** — but cash is frozen (§0), so this is post-cutover.

### 9.5 umi-kds — correctly separate

Swift/native, HTTP-only client of umi-api, App Store distribution. No TS conventions apply. The
only cross-repo tie is the **API contract**: generate a Swift client from `packages/contract`
(OpenAPI→Swift) so the iPad and the web console bind to the same source of truth. Otherwise
leave it alone.

### 9.6 The design-harmony gap — four frontends, four styling stacks, zero shared tokens

Grep-verified stacks: **cash** = Tailwind + forms; **dashboard** = **no UI deps at all**
(hand-rolled `styles.css` + inline style objects); **landing** = Tailwind + framer-motion +
lucide + tailwind-merge; **logs** = Tailwind + shadcn + a stray `design-system/conversaflow`
dir. There is **no shared token or UI package** anywhere. Four brands drifting — and the
flagship console is the *least*-engineered visually (no design system while it's about to host
a POS).

This is exactly what the login-research dossier's thesis targets: **the token layer as the
harmony contract.** The fix is `packages/tokens` (DTCG 2025.10 format) → emitted as
**framework-neutral CSS custom properties** (so the token layer does *not* force Tailwind onto
the no-Tailwind dashboard) + an optional Tailwind preset for the apps that use it, plus a later
`packages/ui` for shared primitives.

**scientific-research-check correction (honesty over hype):** DTCG **2025.10 is stable**
(2025-10-28), vendor-neutral, and supported by Figma / Style Dictionary / Tokens Studio / etc.
— *documented fact*. But it is **NOT a ratified W3C Standard nor on the W3C Standards Track**;
it is a Community Group Candidate Recommendation. The dossier's "ratified W3C standard" is an
**overclaim**. Adopt the format for **tooling interop** (its real, source-backed value), not
for a standards badge it does not hold.

### 9.7 Through-line + repo-wide target

With umi-logs deleted, the repo settles to **five apps, each with a distinct audience** (api
backend · dashboard/console for operators · cash for customers · landing for prospects · kds
native), plus a reserved future observability slot. The repo never had too many apps — the debt
is **every frontend reaching past the api into data and secrets it shouldn't touch**:

- landing owns a DB + cron (§9.2), logs holds god-credentials against a dead schema (§9.3),
  cash carries a second ORM (§9.4) and conflates two audiences (§8), the flagship console has
  no types / contract / design system (§9.1/§8.2), and brand is unshared (§9.6).

**One rule fixes most of it:** *only umi-api owns data and secrets; every frontend is a **typed
client of the api** and a **consumer of shared tokens**.* Target packages:

```text
packages/
  contract/        # api DTOs + route types (also → Swift client for KDS)
  tokens/          # DTCG design tokens → CSS vars (+ optional Tailwind preset)
  ui/              # shared primitives (later)
  tsconfig/  eslint-config/
```

### 9.8 Adversarial review of §9 (for · against · iterate · polish · reason)

**FOR:** boundary surgery is *lower*-risk than restructuring — every app keeps its audience; it
removes real security liabilities (logs creds, a public site with a DB) and real dead code
(conversaflow schema, the duplicate lead engine); shared tokens/contract stop drift at the
source, not per-review.

**AGAINST / risk (+ fix):**
1. *The logs rebind needs api observability endpoints that may not exist yet* → could balloon.
   **Fix:** decouple — **P0 is only pulling the secrets out of the browser**; the full rebind is
   a separate, later phase. Security can't wait on the redesign.
2. *Shared packages add build-graph + turbo wiring complexity.* **Fix:** that is precisely what
   the already-declared pnpm+turbo exist for (§2.1); this is paying down, not adding, debt.
3. *Deleting landing's lead engine could break a dormant sequence.* **Fix:** it's dormant AND
   duplicated AND api already owns it AND landing already calls the api path — delete after a
   one-shot verification, not blind.
4. *"Don't merge apps" may under-reach — should logs be a super-admin console route?* **Fix:**
   no — internal-vs-tenant is an audience boundary, same as operator-vs-customer; keep separate.
5. *Adopting DTCG on a hand-CSS dashboard is friction.* **Fix:** emit **CSS variables**, not a
   Tailwind dependency, so the token layer is framework-neutral and the dashboard consumes it
   as-is.

**ITERATE → POLISH (ordering by risk × urgency):**
- **P0 (security, now):** **delete umi-logs entirely** (removes the `service_role` + Management-
  token surface at a stroke; leave a README placeholder + rotate/deprovision out-of-band); delete
  landing's DB/cron engine after verifying the api leads path. These are liabilities, not tidiness.
- **P1:** the §5 phased standardization (debris → tooling → shared config/prettier → topology → naming).
- **P2:** `packages/contract` (types both web front-ends + KDS) and `packages/tokens` (CSS-var harmony).
- **P3:** logs full rebind to api/canonical schema; `packages/ui`; dashboard JS→TS; cash Prisma call.

**REASON:** standardizing naming and formatting is table-stakes and low-value on its own. The
extremely-critical finding is that the **boundaries are broken** — frontends own data and
secrets. Fix the boundaries first (and the logs credential leak *first of all*); the cosmetic
standardization rides along behind it.
