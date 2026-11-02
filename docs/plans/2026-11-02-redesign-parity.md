# Redesign parity implementation plan

> **For agentic workers:** Use `subagent-driven-development` to implement these tasks. Each task requires a separate review.

**Goal:** Apply the approved presentation to the existing UMI clients and preserve their current functions before a staging merge.

**Architecture:** The real dashboard screens and Flutter surfaces remain the implementation. The API, controllers, permissions, and persistence remain authoritative. Stageshow remains a separate public design demonstration.

**Tech Stack:** React 18, Vite 5, Lingui 6, Vitest 2, Playwright 1.62, Flutter, GitHub Actions, Cloudflare Pages. Use Node 22.23.3 and pnpm 10.29.3.

**Spec:** User requirements recorded below; prototype reference at `/Users/moon/Documents/umipos-redesign`. Current code reference: staging commit `b3e5bf882372eeb14c3c1b2658a6947df83c5051`.

## Global constraints

- The dashboard stays almost identical to the current product. Preserve its navy navigation, typography, labels, forms, routes, and business context.
- Preserve the full fish background and this login copy: `Tu operación, en tiempo real. Supervisa la operación de tu negocio al momento, desde un solo panel.`
- Preserve the sales narrative from `useSalesInsight`, period controls, series, mixes, pivot, and receipt views.
- Preserve every existing function. Never replace real data, permissions, or writes with the prototype's example state.
- Preserve configuration of printers and cash drawers, cash denominations, table editor controls, theme, locale, and inventory operations.
- POS roles stay separate. Cocina and Barra see preparation work. Caja owns payment.
- POS presentation follows the approved prototype: products left, categories middle, account right; physical table map; legible category colors and photos.
- Test at 402×874, 412×915, 820×1180, 800×1340, 1340×800, and desktop 1440×1000. Native POS checks require Flutter.
- Keep backend, schema, live merchants, and production deployments unchanged in this branch. Publish a draft PR to `staging` after verification.
- Record unverified backend and hardware cases. A fixture test proves client behavior only.

## Evidence and tools

- Wrangler 4.156.0 published the separate `umi-stageshow` Pages project. The first create required `--force` because current Wrangler otherwise delegates new projects to Workers.
- Native managed worktree creation failed because the task root was not a Git repository. Git created `/private/tmp/umi-redesign-parity-20261102` from `origin/staging` instead.
- Node and pnpm are cached under `/Users/moon/.npm/_npx/c29883048cd047b6/node_modules/`. Prepend its `node/bin` and `.bin` to PATH.
- The clean dashboard baseline passes 43 Vitest files and 631 tests.
- Root `AGENTS.md` names `product-feature-review`. It is absent from the repository, staging tree, and installed skill directories. Apply the repository's preservation and verification rules directly.
- Reuse existing Vitest and Playwright infrastructure. It already targets the real dashboard. Do not add another UI test framework.

## Task 1: Preserve real dashboard screens and prove parity

**Files:**
- Create: `apps/umi-dashboard/e2e/redesign-parity.pw.js`
- Create if needed: `apps/umi-dashboard/e2e/redesign-parity-fixture.js`
- Modify only for measured layout issues: `apps/umi-dashboard/src/styles.css`, `src/shell.jsx`, `src/screens/ventas-report.jsx`, `src/screens/login.jsx`.
- Create: `docs/reports/2026-11-02-dashboard-redesign-parity.md`.

**Interfaces:** Consume the existing app routes, auth context, API hooks, and component handlers unchanged. Produce a browser suite that runs through the existing Playwright configuration. A synthetic route fixture must state that it never writes business data.

- [ ] Read the existing shell, login, sales, settings, cash, floor editor, and inventory screens. Compare them to the approved prototype screenshots. Record every retained control that the prototype omitted.
- [ ] Add browser cases for the real screens. Start with sales: narrative returned, narrative absent, period change, and branch change. Verify the requested `range` and `locationId`, the visible narrative, and the associated totals. The fixture must return different data for each scope.

```js
await expect(page.getByText('Resumen del periodo', { exact: true })).toBeVisible();
await expect(page.getByText('La venta de hoy pertenece a Centro.', { exact: true })).toBeVisible();
// Select the existing period control with a real click. Assert the new request and text.
```

- [ ] Cover the original theme and locale controls, the login password reveal and remember-email control, and the reset/MFA views. Keep the full fish background and all login text.
- [ ] Verify the sales summary, pivot and receipts remain reachable at desktop and phone widths. Verify drawer navigation and tablet rotation preserve the current view.
- [ ] Reuse the existing floor editor and inventory browser suites for those functions. Do not reproduce their domain logic.
- [ ] Run baseline browser cases before style edits. Correct only observed layout defects that prevent access or match the already approved presentation. Do not replace a working original screen with new cards.
- [ ] Run the focused browser suite, the dashboard unit suite, lint for changed files, and the production build. Read screenshots from desktop and phone. Record exact results, skipped cases, and any real-service checks still pending.

```sh
pnpm --filter @umi/dashboard test
pnpm --filter @umi/dashboard exec playwright test --config playwright.config.js e2e/redesign-parity.pw.js
pnpm --filter @umi/dashboard build
```

- [ ] Commit the implementation and evidence. Include no fixtures with real credentials.

## Task 2: Gate the staging integration on actual client checks

**Files:**
- Modify: `.github/workflows/deploy-dashboard.yml`
- Modify: `.github/workflows/umi-pos-ios.yml`
- Modify: `.github/workflows/umi-pos-testflight.yml`
- Create: `docs/reports/2026-11-02-redesign-release-gates.md`

**Interfaces:** Consume Task 1's browser suite and the existing native POS tests. Produce checks that must finish before the corresponding build deploys. Read the contract version from `packages/contract/src/catalog.ts`.

- [ ] Add the dashboard unit suite and the self-contained browser cases before preview deployment. Live fixture tests must remain separately identified, never silently counted as passed.
- [ ] Replace the fixed `UMIPOS_CONTRACT_VERSION=2.23.0` in both iOS workflows with the checked contract version. Fail when the source value is empty.

```sh
CONTRACT_VERSION=$(sed -n "s/^export const CONTRACT_VERSION = '\\(.*\\)';$/\\1/p" packages/contract/src/catalog.ts)
test -n "$CONTRACT_VERSION"
printf 'CONTRACT_VERSION=%s\n' "$CONTRACT_VERSION" >> "$GITHUB_ENV"
```

- [ ] Add or reuse native test jobs for catalog, checkout, partial checkout, Point outcomes, cash, incoming orders, operator permissions, and kitchen behavior. Preserve the current SDK pins and signing behavior.
- [ ] Validate workflow syntax and run the selected Flutter tests locally. Record SDK/version and baseline failures separately from regressions.
- [ ] Commit the changes. Do not merge or start a TestFlight release.

## Task 3: Port the approved POS presentation onto existing controllers

**Files:**
- Modify within presentation: `apps/umi-pos/lib/features/catalog/catalog_surface.dart`, `features/checkout/checkout_surface.dart`, `features/checkout/partial_checkout_surface.dart`, `features/kitchen/kitchen_board_surface.dart`.
- Extend corresponding existing tests under `apps/umi-pos/test/`.
- Create: `docs/reports/2026-11-02-pos-redesign-parity.md`.

**Interfaces:** Consume existing catalog, order, checkout, cash and kitchen controllers. Keep their commands, immutable sent lines, permission checks and persistent state unchanged.

- [ ] Map each approved visual change to its existing widget and callback before editing. Record the mapping in the report.
- [ ] Keep all existing product options and extras. Apply the approved category/product distinction and the account position through native responsive layout.
- [ ] Retain all payment methods, split/partial payment states, tips and uncertain provider states. Preserve scrolling and fixed confirmation access at narrow widths.
- [ ] Improve service tags in KDS while preserving station filtering and preparation actions. Keep payment absent from station-only surfaces.
- [ ] Exercise the existing native test cases and add only assertions for new layout/accessibility behavior. Test both tablet orientations and phone geometry.
- [ ] Build the native app and inspect it with real input. Record unavailable hardware separately. Preserve the complete original cash and table editor surfaces unless a measured layout defect requires a local change.
- [ ] Commit the presentation change with its evidence.

## Task 4: Review and deliver

**Files:**
- Update this plan's checkboxes and both parity reports.
- Update the staging acceptance matrix in the prototype documentation with links to the real implementation.

- [ ] Request a separate review of each task and a final branch review. Address behavior loss before opening the PR.
- [ ] Verify the same commit that will be sent for review. Record test commands, branch base, screenshots and remaining external checks.
- [ ] Push the feature branch and open a draft PR against `staging`. Link the existing Azure work item if one exists.
- [ ] Give the user the Pages URL, draft PR, verified scope, and the exact staging/hardware access still required.
