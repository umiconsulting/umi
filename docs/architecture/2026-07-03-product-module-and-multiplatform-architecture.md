# Product-Module & Multi-Platform Architecture (Dashboard + Packages)

Date: 2026-07-03 · Status: **DESIGN — for review/critique, not yet implemented** ·
Owner decision pending.

This is a target-architecture doc. Priority order, per the owner: **enterprise truth
first, operational continuity second, everything else after.** So each section states
the *ideal* plainly, then the operational concessions the live system forces.

It was produced by mapping the real code and running primary-source research
(foundational modularity, monorepo build systems, feature-module/entitlement patterns,
context engineering, multi-platform design tokens) and then an adversarial critique of
the result. Following the `scientific-research-check` discipline, claims are tagged:
**[FACT]** documented in a primary/official source · **[TRADE]** source-backed but a
judgment call · **[UMI]** project-specific inference (my reasoning, not a source).
Sources are listed in §10.

---

## 0. TL;DR

- **The dashboard should become a thin shell that composes self-registering *product*
  modules.** A folder `products/<key>/` is one entitlement product: it owns its nav,
  routes, screens, and data. Adding a product = **one folder + one manifest** (plus a
  DB entitlement row — see the honest caveat in §3.5).
- **The strongest justification is not the one that first comes to mind.** The literature
  reason usually given (Parnas: decompose by independent-change locus) is a **backend**
  fact and is *weak* for this frontend (§2.3). The real, concrete wins are: **killing a
  five-place drift hazard**, **navigability** (Screaming Architecture), and **context
  economics** for humans + AI agents. State that honestly; don't oversell DDD.
- **No Module Federation.** One repo, one design system, one pipeline → a compile-time
  registry is correct; runtime federation would be cargo-cult (§4). **[FACT]**-backed.
- **Keep Turborepo. Do *not* adopt Nx/moon/Bazel.** Add a *file-level* import-boundary
  linter (dependency-cruiser). The boundary Umi needs is *intra-package* (folders inside
  one app); every orchestrator enforces boundaries only *between packages* — the wrong
  granularity (§5). This is the sharpest, least-obvious call in the doc.
- **Design the packages layer as neutral SOURCE → platform OUTPUTS**, because the device
  apps (POS, time-logger, KDS) are a *different platform* (plausibly Flutter). Cheap,
  reversible moves now (author tokens in DTCG shape; let `@umi/contract` emit a CI-gated
  OpenAPI doc); defer everything Flutter-specific until Flutter is actually chosen (§6).
- **Cut payroll/observability from what *drives* the structure.** Build for the 3 real
  products (cash, kds, conversaflow) + the always-on core; the "new product = one folder"
  proof waits for a real fourth product (§8, §9).

---

## 1. How it works today (exact map)

### 1.1 Dashboard control + data flow
`main.jsx` → `BrowserRouter` → `AuthProvider` → `App`. `App` (`app.jsx`) has a flat
top-level `<Routes>`: `/login`, `/reset-password`, and `/*` guarded by
`RequireAuth → TenantProvider → DashboardLayout`. `DashboardLayout` **hardcodes** the
inner `<Routes>` (one `<Route>` literal per screen), wraps product-gated screens in
`<GuardedScreen>`, derives the active screen by parsing `location.pathname`, and renders
`Sidebar` + `Topbar` + `TweaksPanel`. There is **no route table object** — routes exist
only as JSX children.

### 1.2 The product/entitlement substrate (the "feature flag")
Backend `GET /api/tenants/:id/capabilities` returns
`capabilities.products = { dashboard | kds | cash | conversaflow | observability: { status } }`
plus `membership.role`, `locations`. Source of truth: the row
`core.product_instances(tenant_id, product_key, location_id IS NULL).status`;
`status ∈ {active,trialing}` = enabled (`PRODUCT_ACTIVE_STATUSES`). It is **read twice,
independently**: enforcement (`AuthRepository.productStatus` behind
`EntitlementGuard`/`@RequireProduct`, worker pool) and display
(`TenantsRepository.loadProducts` → `capabilities.products`, RLS app pool). The client
gates in **three redundant layers**: nav visibility (`getVisibleModules`), route access
(`<GuardedScreen>` → `ProductUnavailable`), and data (`data.jsx` loaders early-return
`EMPTY_*` when `!isProductActive`). Server `@RequireProduct` is the **real** boundary;
client gating is advisory defense-in-depth. **This substrate is correct and stays.**
**[FACT]** it matches LaunchDarkly's documented "entitlements are permanent, subscription-
derived, driven from a system of record" shape.

### 1.3 The coupling smells (verified against the code)
1. **The five-place drift.** Adding/renaming a module requires manually converging:
   (1) `module-registry.js` `MODULES`, (2) `MODULE_ORDER`, (3) `app.jsx` inner
   `<Routes>` + `GuardedScreen` literals, (4) `shell.jsx` Topbar `titles` map, (5) the
   `shell.jsx` `NAV` fallback — **and a 6th**, `apps/umi-api/.../tenants/module-registry.ts`,
   a *verbatim hand-ported* TS copy ("keys/sections/reasons must match exactly"). Nothing
   enforces convergence; forget one and a module silently 404s / mis-titles / renders
   ungated. This is the concrete problem worth solving.
2. **`data.jsx` is a 647-line god-module**: fetch core + auth-refresh retry + path
   builders + product gating + a generic async hook + ~36 read/mutation fns for *every*
   domain, interleaved. Some mutations read `localStorage` tenant/location directly,
   bypassing `TenantProvider` (a hidden global dep, duplicated ~15×).
3. **The entitlement rule lives twice** (dashboard `.js` + api `.ts`) kept in sync by
   hand — the **#1** thing to hoist. The `Capabilities`/`ProductInstance` shapes are
   **not** in `@umi/contract`; server and client agree by convention only.
4. **Vocabulary is triplicated and can drift**: the DB `CHECK`
   (`cash|conversaflow|kds|dashboard|observability`), the `MODULES` product refs, and
   `@RequireProduct` string literals. `observability` is a legal key with **no** module.
5. **`styles.css`** is one 1,904-line global sheet in **14 banner-commented sections**
   (`@import`s `@umi/tokens`). Per the earlier discussion this is a *legitimate* global
   design-system index; only genuinely product-specific rules should co-locate.
   `tweaks-panel.jsx` (prototype postMessage host protocol) is dead weight in the bundle.

---

## 2. First principles — and where they honestly apply

### 2.1 What the sources establish
- **[FACT]** **Parnas (1972):** decompose by the design decisions that **change
  independently**, not by processing steps — hide each behind a stable interface.
- **[FACT]** **Coupling & cohesion** (Stevens/Myers/Constantine 1974): minimize coupling,
  maximize cohesion; functional cohesion is strongest.
- **[FACT]** **Screaming Architecture** (Martin 2011): top-level structure should announce
  the *domain* (Cash, KDS), not the framework (`screens/`, `lib/`).
- **[FACT]** **Vertical Slice** (Bogard 2018): organize by feature slice so new work mostly
  *adds* code; accept some duplication to keep slices independent.
- **[FACT]** **Ousterhout (APoSD):** prefer **deep** modules (narrow interface / rich
  implementation); watch for **change amplification** and **cognitive load** — but also
  for the opposite failure, **"classitis"** (too many shallow modules).
- **[FACT]** **Evans (DDD):** cross-cutting concepts shared by many contexts belong in a
  **Shared Kernel**, *not* inside one product.

### 2.2 Evidence quality — stated plainly (per the skill)
Parnas, Constantine, Conway, Evans are **canonical primary works**. Screaming Architecture
and Vertical Slice are **practitioner blogs**, not peer-reviewed — experienced-consensus,
not measured results. There is **little rigorous evidence** that feature-folders reduce
defects vs layer-folders. "Package by feature not layer" is folklore with no single
primary origin. The *direction* of all sources agrees; the *strength* behind
"folder = product = entitlement = ownership" as a hard rule rests on convergent expert
judgment, not experiment.

### 2.3 The honest correction (this matters)
The tempting argument — "cash/kds/conversaflow *change independently* (different schedules,
different DB schemas `loyalty.*`/`ops.*`/`comms.*`), so Parnas demands separate folders" —
is a **backend fact misapplied to the frontend**. **[UMI]** The dashboard is **one SPA,
one design system, one atomic Vercel deploy.** Its *dominant* coupling is the **shared
shell + design system**, which changes **all** product screens together. By Parnas's own
criterion, that shared shell is the real independent-change locus — which argues for a
strong `platform/` kernel and only *moderate* product isolation, **not** for treating each
product as a mini bounded-context.

So the defensible frontend justification for product folders is **not** "independent
change." It is three concrete, lower-grandiosity wins:
1. **Kill the five-place drift** (§1.3.1) — a real change-amplification smell (Ousterhout).
2. **Navigability** — a folder named `payroll` *screams* payroll (Martin). **[TRADE]**
3. **Context economics** for humans and AI agents — fewer files to load per change (§6).
   Directionally supported, **under-measured** — say so.

Treat "each product is a Parnas/Evans bounded context" as **[UMI] inference, tempered**,
not documented fact — and resist splitting a single product into sub-contexts
(`cash → register/wallet/gift`) until they demonstrably move apart (premature bounded
contexts create the exact change-amplification we're removing).

---

## 3. The target: product-module dashboard

### 3.1 Folder layout (ideal end-state)
```
apps/umi-dashboard/src/
  main.jsx                      # unchanged
  app.jsx                       # SHRINKS: renders registry-composed <Routes>/<GuardedScreen> generically
  screens/  login.jsx  reset-password.jsx      # pre-tenant auth only
  platform/                     # SHARED KERNEL — products depend inward; nothing here imports a product
    shell/       Sidebar, Topbar, NetIndicator (nav groups + titles DERIVED from the registry)
    auth/        auth.jsx  config.js  supabase.js
    tenant/      tenant-context.jsx
    data-core/   fetch.js (_apiFetch, 401→refresh→retry)  paths.js  use-async.js
    entitlement/ registry.js  guarded-screen.jsx  product-unavailable.jsx
    identity/    customer-identity.js           # Shared Kernel, NOT a product (Evans)
  core/                         # ALWAYS-ON base console — product:'dashboard'
    module.manifest.js          # overview, staff, customers, settings, products-billing
    data.js  screens/…  AGENTS.md
  products/                     # ENTITLEMENT-GATED — folder = product = subscription key
    cash/          manifest + data.js + screens/(members, gift-cards) + AGENTS.md
    kds/           manifest + data.js + screens/(orders, devices)     + AGENTS.md
    conversaflow/  manifest + data.js + screens/(hours, conversations)+ AGENTS.md
  styles.css                    # stays the global design-system index (§ earlier discussion)
```
**No `payroll/` folder in this design.** It appears only when a real payroll product is
funded (§9).

### 3.2 The module manifest (the deep-module interface)
Each product exports **one** default manifest — its entire public surface:
```js
// products/cash/module.manifest.js
import { CreditCard, Gift } from '@/platform/shell/icons'
export default {
  product: 'cash',                       // MUST be a legal ProductKey (contract-typed)
  modules: [
    { id: 'members', order: 50, label: 'Loyalty', icon: CreditCard, section: 'GROWTH',
      route: 'members', title: /* full existing shape, see §8 risk R2 */,
      load: () => import('./screens/members.jsx') },
    { id: 'gift-cards', order: 55, label: 'Gift Cards', icon: Gift, section: 'GROWTH',
      route: 'gift-cards', title: …, load: () => import('./screens/gift-cards.jsx') },
  ],
}
```
A build-time registry composes them (no central edit to add a product):
```js
// platform/entitlement/registry.js
import { getModuleAvailability } from '@umi/contract/entitlements'
const manifests = import.meta.glob('@/{core,products}/*/module.manifest.js',
                                   { eager: true, import: 'default' })
export const CATALOG = Object.values(manifests)
  .flatMap(m => m.modules.map(mod => ({ ...mod, product: m.product })))
  .sort((a, b) => a.order - b.order)      // ← explicit order (see §8 risk R1)
export const getVisibleModules = caps => CATALOG.filter(m => getModuleAvailability(m, caps).available)
```

**Invariants (machine-checked):** (1) `manifest.product` is a legal `ProductKey`;
(2) a product imports **only** from `platform/*` and `@umi/contract`, **never** a sibling
product (Evans context-map: no direct cross-context reach); (3) screens are lazy `load()`
thunks. Invariant (2) is *the* architecture; it must be enforced by a linter (§5).

### 3.3 Hoist the entitlement rule into `@umi/contract` (the #1 move)
Create a **zero-dependency** entry `@umi/contract/entitlements` holding `PRODUCT_KEYS`,
`PRODUCT_ACTIVE_STATUSES`, the `ModuleManifest`/`ModuleConfig`/`ModuleAvailability` types,
and `getModuleAvailability`/`isProductActive`. The dashboard imports it from source (Vite
alias, no zod in the bundle); the api imports built dist. The **two hand-ported registry
twins collapse into one shared rule** — the proven `routes.ts` model. The server keeps
enforcing **per product** (`@RequireProduct`) and stops owning a *module* catalog; the
client becomes sole owner of the module catalog via its manifests.

### 3.4 Entitlement wiring (reuses today's substrate verbatim)
Nothing new is invented. `capabilities.products[key].status` stays the source of truth
(**[FACT]** the documented-correct shape for subscription entitlements). A manifest
declares `product: 'cash'`; the registry composes the catalog; `TenantProvider` loads
capabilities; the three client layers each read the **single** manifest instead of
restating the product→module mapping inline. Enable/disable a product for a tenant = flip
`core.product_instances.status` server-side; nav + routes + fetches react on next
capabilities load — **no code change.**

### 3.5 The honest caveat: "one folder + one line" is not the whole truth
Adding a genuinely **new** product key is **not purely additive**: `product_key` is
`CHECK`-constrained, so entitling `payroll` needs (a) a migration relaxing the `CHECK`
(or a catalog lookup table), and (b) a `product_instances` row per pilot tenant, and (c)
`@RequireProduct('payroll')` on its routes. The **folder + manifest** is the code change;
the **DB vocabulary + row** is an ops change. Say this out loud — don't sell false
additivity.

---

## 4. Why NOT Module Federation / micro-frontends
**[FACT]** (Fowler/Jackson 2019; MF 2.0 / InfoQ 2026): Module Federation is a **runtime**
mechanism whose payoff is **independent deployment + autonomous per-product teams**, at the
cost of **bundle duplication, environment drift, and multiplied ops**. **[UMI]** Umi is one
repo, one design system (`@umi/tokens`), one Vercel pipeline, and is deliberately
*consolidating* products into one console — the exact opposite of team decomposition. A
**compile-time registry** (`import.meta.glob`, tree-shaken, route-level lazy-loaded)
delivers the modularity with none of the runtime-loading risk. Revisit MF only if a product
needs its own deploy cadence or a separate team owns it end-to-end — **the native KDS client
is the only plausible future candidate, and it is already out of the SPA.**

---

## 5. Stack decision — **keep Turborepo; add a file-level boundary linter**

**Decision:** Keep **Turborepo** (config-only, as-is). Do **not** adopt Nx, moon, or Bazel.
Add **one** standalone intra-package import-boundary linter (**dependency-cruiser** or
`eslint-plugin-boundaries`) as the real architecture gate — at **warning/CI-check** level,
not a hard merge-blocker (see below).

**The decisive, non-popularity insight** **[FACT+UMI]:** the boundary Umi must enforce —
*"`products/cash` must not import `products/kds`"*, *"`products/*` may import only
`platform/*` and `@umi/contract`"* — is **intra-package** (folders inside the single
`apps/umi-dashboard`). The tooling research confirms **[FACT]** that Nx
(`@nx/enforce-module-boundaries`), moon (project-graph constraints), and Turborepo
Boundaries all operate at **workspace/project-graph** granularity — *between packages*, not
between folders inside one package. **So none of the orchestrators enforce the boundary Umi
has at the granularity Umi has it.** Adopting Nx to get boundary enforcement would be a heavy
migration for a capability that doesn't even address the problem. The correct tool for
file-level import rules is a **file-graph linter**, which is cheap and runs on plain
pnpm + Turborepo. Nx's other edge — AST "new module" generators — is neutralized too: a
product folder is a template copy a 12-line script or `turbo gen` satisfies.

**Corrected premise (critique caught this):** an earlier draft justified this partly with
"the frontends have *no coherent workspace*." That's **stale** — `pnpm-workspace.yaml` now
includes `apps/*` and `umi-api` joined it. The accurate constraint is narrower: *only the
Vercel **build** is app-scoped npm.* The conclusion (keep Turborepo + a boundary linter)
**survives**, but on the correct premise, not a false one.

**Right-sizing the gate (critique):** a **hard merge-blocking** "no cross-product import"
rule for **3 products and one committer** is enforcement theater — the autonomy rationale
for hard boundaries explicitly doesn't hold here. Ship it as a **CI check/warning** now;
promote to a blocker if/when multiple people own products.

**Also reject** Bazel outright (multi-week adoption for 3 projects). And **first fix** the
`pnpm`-declared / build-actually-npm convention drift — every tool assumes a coherent
workspace.

---

## 6. The multi-platform packages layer (the device-app future)

The web dashboard uses CSS **because it is the web surface.** The device apps — POS,
time-logger, KDS — are a **different platform** (plausibly **Flutter**) and need the same
brand as a **Dart theme**, and the same API as a **Dart client**. This is why the token
JSON is *not* a clone of the CSS — it's the **platform-neutral source**; CSS is one output.

**Principle: split every shared package into a neutral SOURCE and platform-specific
GENERATED outputs.** **[FACT]** Style Dictionary is exactly "a build system for creating
cross-platform styles" (ships `flutter/class.dart`, `ios-swift`, `android`, `css/variables`);
**[FACT]** DTCG reached its **first stable spec (2025.10) on 2025-10-28** (a W3C *Community
Group* spec, not a formal Recommendation).

| Package | Neutral SOURCE (author once) | Web outputs (today) | Flutter outputs (later) |
| --- | --- | --- | --- |
| `@umi/tokens` | token JSON in **DTCG shape** | CSS vars + Tailwind object | `ThemeData`/`ColorScheme` Dart |
| `@umi/contract` | zod (TS) **+ emitted OpenAPI** | TS types + route builders | `dart-dio` client + models |

**Cheap, reversible moves NOW (help the web side regardless of Flutter):** **[UMI]**
1. Author `@umi/tokens` JSON in **DTCG-compliant shape** — a formatting choice; makes a
   future Style Dictionary adoption a *config* change, not a re-authoring.
2. Let `@umi/contract` **emit a CI-gated OpenAPI document** from the zod source — that doc
   is exactly a future `dart-dio` client's input, and it's a contract-test win today.
3. Keep the **source ≠ output** discipline: everything generated, nothing hand-maintained.

**YAGNI-defer until Flutter is actually chosen** **[UMI+FACT]:** do **not** adopt Style
Dictionary yet (the bespoke generator is correct for one platform; it becomes a liability
at the *second*); do **not** re-tool the monorepo; do **not** switch the contract to
proto/gRPC. **[FACT]** Turborepo is JS/TS-only; the polyglot options are **community-risk**
(Nx's Flutter plugins aren't Nrwl-maintained) or **heavy/unmaintained** (Bazel's Dart rules
are archived; moon has no Dart). **When Flutter lands, it goes in a *separate* Dart
workspace (Melos / pub workspaces) that consumes the generated artifacts** — web and Flutter
share *generated outputs*, not a task graph.

---

## 7. Context engineering (why this also helps agents + juniors)
**[FACT]** *Context rot* (Chroma 2025, 18 models) is measured: accuracy degrades as input
tokens grow; a focused ~300-token input beats the same needle in ~113k. **[FACT]** Anthropic
(2025) frames context as a finite "attention budget" and prescribes just-in-time retrieval
via file paths/glob. **[FACT]** The `AGENTS.md` spec (open standard, 2025) explicitly favors
**nested per-package files, nearest-file-wins** (the OpenAI monorepo carries 88).

**[UMI]** A product-module layout + a short **`AGENTS.md` per module** (what it owns, its DB
schemas, its neighbors, its entry point) directly shrinks the correct-context set for a
change — for a human junior *and* an AI agent. Umi already nests `CLAUDE.md` at the app
level; extending it to the module level is the **highest-leverage, lowest-risk** context
move. **Honest caveat:** this area is **emerging and under-measured** — the token/attention
economics are real, but *no controlled study* ties folder layout to measured agent success.
Do it because it's cheap and reversible, not because the productivity delta is proven.

---

## 8. Migration plan (behaviour-preserving) + the must-fix risks

Sequenced so the riskiest verification comes early and each phase is independently
shippable. **The critique found concrete bugs an implementation must fix — they are folded
in as R1–R6 and are not optional.**

- **Phase 0 — Hoist the contract rule** (zero behaviour change): add
  `packages/contract/src/entitlements.ts`; **also add it to `tsup.config.ts` entry AND the
  `package.json` `exports` map** *(R5 — the api consumes built dist; without this the
  NestJS build won't resolve it)*. Point `entitlement.guard.ts` and both registry twins at
  it. CI stays green; dashboard byte-identical.
- **Phase 1 — Registry over a single central manifest** (behaviour-preserving): build
  `platform/entitlement/registry.js`; regenerate `app.jsx` routes, Sidebar nav, and Topbar
  titles from the `CATALOG`; delete `MODULE_ORDER`, the `NAV` fallback, and the `titles`
  literals.
  - **R1 — ordering:** `import.meta.glob` returns filesystem order, **not** the semantic
    `MODULE_ORDER` (today KDS `orders/devices` sort *before* cash `members`). Add an
    explicit `order` field per module and sort by it, or nav visibly reorders.
  - **R2 — titles are client-visible:** today's `titles` use position-dependent ordinal
    eyebrows (`01 / OPERACIONES` … `10 / CONFIGURACIÓN`), **Spanish** headings, and a
    bilingual `en:` field. Carry the **full** existing shape in the manifest (or compute
    ordinals from composed order); the lossy `{eyebrow:'Growth',heading:'Loyalty'}` sample
    would change the rendered topbar. Not "behaviour-preserving" until resolved.
  - **R3 — non-module routes:** the `customers/*` splat, the `insights → /customers` and
    `conversations → /customers?filter=whatsapp` redirects, and the `DashboardLayout`
    screen-remap are **not** modules. Model them explicitly (a `redirects`/`aliases` field
    or keep them hand-written in `app.jsx`) or the generic `<Routes>` drops them.
  - **R6 — glob vs layout:** `{core,products}/*/module.manifest.js` does **not** match
    `core/module.manifest.js` (no subdir). Fix the pattern or the base console vanishes.
- **Phase 2 — Extract ONE exemplar (`cash`)**: create `products/cash/` (manifest + moved
  screens + `data.js` split out of `data.jsx`, leaving the fetch core in
  `platform/data-core`); switch the registry to glob the folder; add the dependency-cruiser
  rule and prove `cash` is clean. Validates the whole mechanism on one product.
- **Phase 3 — Migrate the rest + dissolve the god module**: `kds`, `conversaflow`, and the
  always-on `core/`; finish carving `data.jsx`; move auth/config/tenant/shell/identity into
  `platform/*`; add a per-module `AGENTS.md`.
  - **R4 — `products-billing` decision:** today it is nav-hidden for non-super-admins but
    **not route-guarded** (direct URL works). Generic `GuardedScreen` wrapping would
    **block** direct navigation — a behaviour **change**. Decide it deliberately (a security
    fix) or preserve current behaviour; do not smuggle it in.
- **Phase 4 — Server drops its module catalog**: `buildCapabilities` ships
  products + membership + locations only; keep a *deprecated derived* `modules` map through
  the migration for back-compat, remove it once the client is proven sole owner; delete
  `apps/umi-api/.../module-registry.ts`. `@RequireProduct` enforcement and the 403 envelope
  unchanged.
- **Phase 5 — DEFERRED (not part of this migration):** the `payroll` scaffold, the
  `turbo gen` template, and the `CHECK`-relax migration wait for a **real** funded product.

**Frozen client-visible contracts (do not restate, only relocate):** the 403 envelope
`{error,product,status}`, the reason literals `product_missing`/`role_required`,
`PRODUCT_ACTIVE_STATUSES = {active,trialing}`, and the localStorage keys
`umi-dashboard-selected-tenant`/`-location`.

---

## 9. Open decisions (owner's call)
1. **Payroll/observability:** confirm they are **not** roadmap-real, so we build for 3
   products + core and defer the scaffold/`CHECK`-relax (recommended).
2. **Boundary gate strength:** CI warning now vs hard merge-blocker (recommend warning at
   this team size).
3. **`product_key`:** keep the `CHECK` (correct for a small stable enum) vs a catalog
   lookup table (premature for ~5 keys changing yearly — recommend keep `CHECK`).
4. **In-app entitlement provisioning:** build a write-path so `products-billing` can
   grant/revoke, vs keep out-of-band SQL. The architecture doesn't depend on it — defer
   unless prioritized.
5. **Reverse the dashboard JS→TS deferral?** The single biggest lever on manifest safety
   (compile-checked manifests + contract). Staying JS forces runtime manifest validation +
   the linter. Independent, larger change.
6. **Sunset timing** for the server's derived `modules` map (client-visible; sequence it).
7. **Route-level code-splitting** now vs later — asserted "payload win" is **unmeasured**;
   baseline the ~10-screen bundle before claiming a benefit.
8. **`platform/` granularity** — the 5-subdir split is a reasonable end-state, not a
   mandate; collapse where it's thin (avoid Ousterhout's "classitis").

---

## 10. Sources (verified; layered fact / tradeoff / inference)
**Foundational modularity:** Parnas, *On the Criteria…Decomposing Systems into Modules*,
CACM 1972 — dl.acm.org/doi/10.1145/361598.361623 · Stevens/Myers/Constantine, *Structured
Design*, IBM Sys. J. 1974 · Conway, *How Do Committees Invent?*, 1968 —
melconway.com/research/committees.html · Inverse Conway Maneuver, ThoughtWorks 2010 ·
Evans, *DDD* / Fowler *BoundedContext* — martinfowler.com/bliki/BoundedContext.html ·
Martin, *Screaming Architecture*, 2011 —
blog.cleancoder.com/uncle-bob/2011/09/30/Screaming-Architecture.html · Bogard, *Vertical
Slice Architecture*, 2018 — jimmybogard.com/vertical-slice-architecture/ · Ousterhout,
*A Philosophy of Software Design* — web.stanford.edu/~ouster/cgi-bin/aposd.php.
**Micro-frontends / flags:** Fowler/Jackson, *Micro Frontends*, 2019 —
martinfowler.com/articles/micro-frontends.html · MF 2.0 stable, InfoQ 2026 · *You probably
don't need a micro-frontend*, Scott Logic 2021 · LaunchDarkly *Entitlements* —
launchdarkly.com/docs/guides/flags/entitlements · OpenFeature — openfeature.dev/specification.
**Monorepo tooling:** Turborepo *Boundaries* — turborepo.dev/docs/reference/boundaries ·
Nx *Enforce Module Boundaries* — nx.dev/docs/features/enforce-module-boundaries · moon
*Project constraints* (v1.0) — moonrepo.dev/blog/moon-v1.0 · pnpm *Filtering* ·
aspect-build/rules_js. (Nx-vs-Turborepo perf numbers are **vendor marketing — unverified**.)
**Context engineering:** Anthropic, *Effective context engineering for AI agents*, 2025 —
anthropic.com/engineering/effective-context-engineering-for-ai-agents · Chroma, *Context
Rot*, 2025 — trychroma.com/research/context-rot · `AGENTS.md` — agents.md ·
Karpathy, 2025 (term popularization).
**Multi-platform:** Style Dictionary — styledictionary.com · DTCG 2025.10 —
designtokens.org/tr/2025.10/format · Flutter theming — docs.flutter.dev/cookbook/design/themes ·
OpenAPI Generator `dart-dio` — openapi-generator.tech/docs/generators/dart-dio ·
Melos — melos.invertase.dev · zod JSON Schema — zod.dev/json-schema.

**Explicitly labeled inference (not documented fact):** "gating a whole product by
entitlement is a Parnas boundary" is a **synthesis** of LaunchDarkly (flag guidance) +
Parnas (module theory) — neither source states it. Treat as **[UMI]**. And the frontend
justification for product folders is navigability + drift-elimination + context economics,
**not** backend independent-change (§2.3).
