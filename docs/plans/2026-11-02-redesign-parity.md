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
- POS presentation follows the chosen Rediseño 2: products left, categories above the catalogue, account right, and the physical table map. Product names lead category colors and restrained tags. The POS has no product photos. The customer digital menu keeps clear photos.
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

- [x] Read the existing shell, login, sales, settings, cash, floor editor, and inventory screens. Compare them to the approved prototype screenshots. Record every retained control that the prototype omitted.
- [x] Add browser cases for the real screens. Start with sales: narrative returned, narrative absent, period change, and branch change. Verify the requested `range` and `locationId`, the visible narrative, and the associated totals. The fixture must return different data for each scope.

```js
await expect(page.getByText('Resumen del periodo', { exact: true })).toBeVisible();
await expect(page.getByText('La venta de hoy pertenece a Centro.', { exact: true })).toBeVisible();
// Select the existing period control with a real click. Assert the new request and text.
```

- [x] Cover the original theme and locale controls, the login password reveal and remember-email control, and the reset/MFA views. Keep the full fish background and all login text.
- [x] Verify the sales summary, pivot and receipts remain reachable at desktop and phone widths. Verify drawer navigation and tablet rotation preserve the current view.
- [x] Reuse the existing floor editor and inventory browser suites for those functions. Do not reproduce their domain logic.
- [x] Run baseline browser cases before style edits. Correct only observed layout defects that prevent access or match the already approved presentation. Do not replace a working original screen with new cards.
- [x] Run the focused browser suite, the dashboard unit suite, lint for changed files, and the production build. Read screenshots from desktop and phone. Record exact results, skipped cases, and any real-service checks still pending.

```sh
pnpm --filter @umi/dashboard test
pnpm --filter @umi/dashboard exec playwright test --config playwright.config.js e2e/redesign-parity.pw.js
pnpm --filter @umi/dashboard build
```

- [x] Commit the implementation and evidence. Include no fixtures with real credentials.

## Task 2: Gate the staging integration on actual client checks

**Files:**

- Modify: `.github/workflows/deploy-dashboard.yml`
- Modify: `.github/workflows/umi-pos-ios.yml`
- Modify: `.github/workflows/umi-pos-testflight.yml`
- Modify: `apps/umi-pos/pubspec.lock` to reflect the existing local contract package version `2.50.0`.
- Create: `docs/reports/2026-11-02-redesign-release-gates.md`

**Interfaces:** Consume Task 1's browser suite and the existing native POS tests. Produce checks that must finish before the corresponding build deploys. Read the contract version from `packages/contract/src/catalog.ts`.

- [x] Add the dashboard unit suite and the self-contained browser cases before preview deployment. Live fixture tests must remain separately identified, never silently counted as passed.
- [x] Replace the fixed `UMIPOS_CONTRACT_VERSION=2.23.0` in both iOS workflows with the checked contract version. Fail when the source value is empty.

Local setup already ran `flutter pub get --offline`. It changed only `umi_contract` from `2.47.0` to `2.50.0` in the lockfile. Include that generated change. The 289 selected Flutter tests passed with Flutter 3.47.5 and Dart 3.13.4. Keep the existing CI SDK pin unless direct evidence requires a separate correction.

```sh
CONTRACT_VERSION=$(sed -n "s/^export const CONTRACT_VERSION = '\\(.*\\)';$/\\1/p" packages/contract/src/catalog.ts)
test -n "$CONTRACT_VERSION"
printf 'CONTRACT_VERSION=%s\n' "$CONTRACT_VERSION" >> "$GITHUB_ENV"
```

- [x] Add or reuse native test jobs for catalog, checkout, partial checkout, Point outcomes, cash, incoming orders, operator permissions, and kitchen behavior. Preserve the current SDK pins and signing behavior.
- [x] Validate workflow syntax and run the selected Flutter tests locally. Record SDK/version and baseline failures separately from regressions.
- [x] Commit the changes. Do not merge or start a TestFlight release.

## Task 3: Port the approved POS presentation onto existing controllers

**Files:**

- Modify within presentation: `apps/umi-pos/lib/features/catalog/catalog_surface.dart`, `features/checkout/checkout_surface.dart`, `features/checkout/partial_checkout_surface.dart`, `features/kitchen/kitchen_board_surface.dart`.
- Extend corresponding existing tests under `apps/umi-pos/test/`.
- Create: `docs/reports/2026-11-02-pos-redesign-parity.md`.

**Interfaces:** Consume existing catalog, order, checkout, cash and kitchen controllers. Keep their commands, immutable sent lines, permission checks and persistent state unchanged.

- [x] Map each approved visual change to its existing widget and callback before editing. Record the mapping in the report.
- [x] Keep all existing product options and extras. Apply the approved category/product distinction and the account position through native responsive layout.
- [x] Retain all payment methods, split/partial payment states, tips and uncertain provider states. Preserve scrolling and fixed confirmation access at narrow widths.
- [x] Improve service tags in KDS while preserving station filtering and preparation actions. Keep payment absent from station-only surfaces.
- [x] Exercise the existing native test cases and add only assertions for new layout/accessibility behavior. Test both tablet orientations and phone geometry.
- [x] Build the native app and inspect it with real input. Record unavailable hardware separately. Preserve the complete original cash and table editor surfaces unless a measured layout defect requires a local change.
- [x] Commit the presentation change with its evidence.

## Task 3B: Match the approved Stageshow presentation across the native POS

User clarification, 2026-11-02: the Android app must represent the Stageshow design. The first presentation commit is partial and is not visual acceptance.

- [x] Capture and compare the native app and approved Stageshow at the same logical phone and tablet sizes.
- [x] Port the approved shell, persistent UMI brand, navigation, typography, category/product styling, modifier presentation, PIN entry, cash and checkout surfaces.
- [x] Preserve every real control, state, role, command, and permission. Keep real data and native execution.
- [x] Match station-only preparation screens, incoming orders and physical floor map presentation. Keep original floor editor capabilities.
- [x] Run targeted behavior and layout checks, then install the amended native build in the visible Android emulator.
- [x] Judge actual native screenshots beside the approved reference. Review the code and visual evidence separately.

## Task 3C: Preserve sibling KDS station cards

- [x] Correct the observed local projection removal after a station completes.
- [x] Preserve sibling station work, shared versions, command scope and all offline/retry guards.
- [x] Add a focused two-station regression and verify through native input.

## Task 3D: Use umi for native launch and app icons

User instruction, 2026-11-02: use umi on app startup and as the UmiPOS app icon.

- [x] Replace remaining Flutter launcher placeholders with the approved lowercase umi wordmark.
- [x] Apply the same mark to Android and iOS native launch screens.
- [x] Preserve native identifiers, signing, security and startup behavior.
- [ ] Validate generated resources and inspect the actual Android cold start and launcher.

## Task 3E: Add Stageshow Rediseño 2

User direction, 2026-11-02: use UNSLOP and Zavo as the main operational design reference, while preserving UMI branding.
The user requests this as a second alternative in Stageshow. Keep the first redesign available for comparison.

- [x] Add Rediseño 1 / Rediseño 2 selection with a direct share URL and shared flow state.
- [x] Apply a compact working composition across POS screens, preserving current functions and device support.
- [x] Preserve dashboard, digital customer menu, original-design view and first-redesign presentation.
- [x] Compare actual browser captures and exercise all three order flows and role boundaries.
- [x] Publish the verified alternative to the existing authorized Pages project.

## Task 3N: Apply the chosen Rediseño 2 to native Android

User instruction, 2026-11-03: apply the chosen design to Android and continue functional tests against current UmiPOS.

- [x] Merge the current staging baseline and preserve the paid-occupied table correction and contract 2.51.0.
- [x] Port every native POS surface to the final Rediseño 2 composition. Use real controllers, permissions, data and persistence.
- [x] Preserve the current native functions, including functions that the prototype does not illustrate.
- [x] Use the real native frequency signal honestly. Do not copy sample sales or invented business summaries.
- [x] Keep station-only views, the physical map, all payment modes, cash denominations and hardware settings.
- [x] Add hide/show ready work to the native KDS as a display filter with the actual station-ready count.
- [x] Run focused native tests, the full native suite and the native analyzer. Preserve legitimate platform skips.
- [x] Install the reviewed commit on visible Android phone and tablet emulators. Verify tablet portrait and landscape.
- [x] Repeat real native order, preparation, cash, tables and payment flows against the isolated local API.
- [x] Reconcile the resulting orders, station items, payments and table state. Record contract and hardware limits explicitly.
- [x] Compare native captures with the chosen prototype. Review source changes separately from visual acceptance.

The task brief is `.superpowers/sdd/2026-11-02-redesign-parity/task-3n-native-design2.md`.
Final source `2fd267ed` passed 1,292 tests with five existing skips. Both Android AVDs have the same APK.
Source review and bounded native comparison passed. Two-station completion and the full count/reconcile/close sequence passed.
The [native runtime report](../reports/2026-11-03-pos-design2-native-runtime.md) distinguishes each checkpoint and unverified case.
Two baseline failures remain: duplicate digital preparation and optimistic account state after a refused account switch.
Task completion records execution. It does not approve these failed workflows or authorize production promotion.
Hardware, provider, variance/handoff and final native table grouping checks remain explicit limits.

## Task 4: Review and deliver

**Files:**

- Update this plan's checkboxes and both parity reports.
- Update the staging acceptance matrix in the prototype documentation with links to the real implementation.

- [x] Request a separate review of each task and a final branch review. Address behavior loss before opening the PR.
- [x] Verify the same commit that will be sent for review. Record test commands, branch base, screenshots and remaining external checks.
- [ ] Push the feature branch and open a draft PR against `staging`. Link the existing Azure work item if one exists.
- [ ] Give the user the Pages URL, draft PR, verified scope, and the exact staging/hardware access still required.
