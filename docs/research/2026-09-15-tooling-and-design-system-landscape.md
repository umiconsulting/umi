# Umi tooling and design system landscape

Date: 2026-09-15. Time zone: America/Mazatlan.

Scope: tools that raise three bars at the same time. The bars are user
experience, agent experience, and developer experience. An agent must be able to
drive, inspect, and verify the product.

Method: every project in this document is checked against the GitHub API, the
npm registry, the pub.dev API, or an HTTP request to its documentation page. Star
counts and dates are read on 2026-09-15. GitHub reports UTC, so some GitHub dates
show 2026-09-16. A claim is marked UNVERIFIED when no source confirms it.

Style: this document follows ASD-STE100 Simplified Technical English.

## Facts about this repository

These facts come from the workspace files. Later sections use them for the cost
estimate.

- The root `package.json` pins `@playwright/test` 1.62.1, `@playwright/mcp`
  0.0.80, and `@playwright/cli` 0.1.18.
- `apps/umi-dashboard` uses React 18, Vite 5, Lingui 6, TanStack Query 5,
  react-virtuoso 4, and socket.io-client 4. No component library is present.
- `apps/umi-dashboard/src/styles.css` has 4,514 lines. The `src/components`
  directory holds three shared components: `select.jsx`, `menu.jsx`, and
  `customer-transcript.jsx`. `select.jsx` is a hand-written listbox. Its comment
  says the native `<select>` highlight cannot be themed.
- Dashboard tests are Vitest files next to the source. No browser test directory
  exists. The root dependency on Playwright is not used by a dashboard test yet.
- `apps/umi-api` uses NestJS 11, Fastify 5, the `pg` 8 client, BullMQ 5,
  socket.io 4, and Zod 3. The source holds 497 `query(` calls.
- `packages/contract` holds Zod schemas. It generates TypeScript and Dart.
- `packages/tokens` holds a DTCG subset in `tokens/core.json`,
  `tokens/dashboard.json`, and `tokens/landing.json`. A custom script writes CSS
  custom properties and a Tailwind theme object.
- `apps/umi-pos` uses Flutter SDK >= 3.44.0, `integration_test`,
  `flutter_driver`, and `socket_io_client` 3.1.6. The `test` directory holds 38
  Dart test files. The `integration_test` directory holds one file.
- The Flutter stable release is 3.47.4 on 2026-09-11 with Dart 3.13.3.
  Source: https://storage.googleapis.com/flutter_infra_release/releases/releases_linux.json

## 1. Clickable-action inventory and end-to-end coverage

**Recommendation.** Use `@playwright/test` 1.63.0 as the browser test runner.
Use ARIA snapshots for element handles. Use `@playwright/cli` 0.1.20 for agent
work, and `@playwright/mcp` 0.0.81 for long interactive sessions.

**Runner-up.** Cypress 16.1.0. It gives a human author a fast and friendly loop.
It gives an agent less useful information than Playwright.

**Why.** Playwright gives every interactive element a deterministic handle. ARIA
snapshots capture the accessibility tree as text. The agent can compare two
snapshots and see one changed line. The trace viewer records DOM changes,
console messages, network calls, and screenshots in one file. The official
README for `@playwright/cli` states that coding agents work better with a CLI
because a CLI does not load large tool schemas into the model context. The same
README states that MCP stays useful for long sessions that need persistent state
and page introspection.

**Tradeoffs.** Playwright controls its own patched Firefox build, not the
installed branded Firefox. The MCP extension supports Chrome and Edge only. The
`docs/reports/2026-08-31-playwright-agent-testing.md` note in this repository
already records this limit. The Cypress trade-offs page states that Cypress
cannot control more than one open browser at a time. WebdriverIO carries more
setup for a plain React dashboard.

**Flutter and web support.** Playwright drives the DOM and the accessibility
tree of a page. A Flutter web build draws its own widget tree. The browser view
of that tree depends on the active renderer and the semantics setting. UNVERIFIED:
the exact DOM output of the current Flutter web renderer in this repository.
Test the POS web build before you plan browser tests for it.

**Cost to adopt here.** Low. The root `package.json` already pins Playwright
1.62.1 and `@playwright/cli` 0.1.18. An upgrade to 1.63.0 and 0.1.20 is a version
bump. Add a `playwright.config.ts` and an `e2e` directory to `apps/umi-dashboard`.
The dashboard has no browser test today, so this work adds coverage and does not
replace anything. Install only the Firefox browser in CI to keep the job small.

The Cypress trade-offs page is at https://docs.cypress.io/app/references/trade-offs.

Verified facts:

| Project             | Package                          | Stars   | License    | Latest release                       | Source                                                   |
| ------------------- | -------------------------------- | ------- | ---------- | ------------------------------------ | -------------------------------------------------------- |
| Playwright          | `@playwright/test` 1.63.0        | 96,197  | Apache-2.0 | v1.63.0 (2026-09-04)                 | https://github.com/microsoft/playwright                  |
| Playwright MCP      | `@playwright/mcp` 0.0.81         | 37,152  | Apache-2.0 | v0.0.81 (2026-09-14)                 | https://github.com/microsoft/playwright-mcp              |
| Playwright CLI      | `@playwright/cli` 0.1.20         | 13,327  | Apache-2.0 | 0.1.20 (2026-09-14)                  | https://github.com/microsoft/playwright-cli              |
| Cypress             | `cypress` 16.1.0                 | 51,019  | MIT        | v16.1.0 (2026-09-15)                 | https://github.com/cypress-io/cypress                    |
| WebdriverIO         | `webdriverio` 9.31.9             | 9,834   | MIT        | v9.31.9 (2026-09-13)                 | https://github.com/webdriverio/webdriverio               |
| Testing Library     | `@testing-library/react` 16.3.3  | 19,652  | MIT        | v16.3.3 (2026-08-27)                 | https://github.com/testing-library/react-testing-library |
| browser-use         | Python package                   | 114,753 | MIT        | 0.13.10 (2026-09-04)                 | https://github.com/browser-use/browser-use               |
| Stagehand           | `@browserbasehq/stagehand` 4.1.0 | 24,296  | MIT        | npm 4.1.0 (2026-09-09)               | https://github.com/browserbase/stagehand                 |
| Midscene            | `@midscene/web` 1.12.8           | 14,910  | MIT        | v1.12.8 (2026-09-16)                 | https://github.com/web-infra-dev/midscene                |
| Skyvern             | Python package                   | 23,010  | AGPL-3.0   | v1.0.53 (2026-09-09)                 | https://github.com/Skyvern-AI/skyvern                    |
| Chrome DevTools MCP | `chrome-devtools-mcp`            | 52,078  | Apache-2.0 | v1.9.0 (2026-09-08)                  | https://github.com/ChromeDevTools/chrome-devtools-mcp    |
| Puppeteer           | `puppeteer` 25.11.0              | 95,581  | Apache-2.0 | puppeteer-core-v25.11.0 (2026-09-14) | https://github.com/puppeteer/puppeteer                   |

Notes on the agent-oriented tools:

- `browser-use` and `Skyvern` drive a browser from natural language. They need a
  model call for each step. That cost and that variability are a poor fit for a
  checkout test that must run on every commit. `Skyvern` also uses AGPL-3.0.
- `Stagehand` 4.1.0 mixes code with model calls. Its GitHub release list shows
  `@browserbasehq/stagehand@3.7.3` (2026-08-28) while npm shows 4.1.0
  (2026-09-09). Read the npm registry as the newer source.
- `Midscene` 1.12.8 releases on the same day as this note. Its JavaScript API
  runs inside a Playwright test, so a team can keep Playwright assertions and add
  model steps where the DOM is unclear.
- `executeautomation/mcp-playwright` has 5,644 stars but no release and no push
  since 2025-12-13. Prefer the Microsoft MCP server.

Sources:

- https://playwright.dev/docs/aria-snapshots
- https://playwright.dev/docs/trace-viewer
- https://github.com/microsoft/playwright-mcp
- https://github.com/ChromeDevTools/chrome-devtools-mcp
- https://github.com/web-infra-dev/midscene
- https://github.com/executeautomation/mcp-playwright
- https://docs.cypress.io/app/references/trade-offs

## 2. Flutter testing and automation

**Recommendation.** Use `integration_test` plus `patrol` 4.10.0 for the POS
flows. Use `flutter test` widget tests for logic. Use `alchemist` 0.14.0 for
golden images on Linux desktop.

**Runner-up.** `maestro` 2.10.0 for smoke flows that a non-developer writes.

**Why.** `integration_test` is part of the Flutter SDK. It runs the real app on
a device or emulator, and `flutter drive` collects the result. Patrol adds
native automation on top of `integration_test`. The Patrol README lists native
interactions, for example the permission dialog. Patrol finds a widget by key, by
text, or by semantic label. Patrol published 4.10.0 on 2026-09-15, so the project
is current. `maestro` runs YAML flows against a built app. It needs no Dart code.
It suits a smoke test of the login, order, and payment path. UNVERIFIED: the
screenshot API name in the current `integration_test` release.

**Linux desktop and Flutter web.** `flutter test` runs widget and golden tests
without a display. `integration_test` on Linux desktop needs a display server.
Use `xvfb-run` in CI when no display
exists. For Flutter web, run `flutter drive --device-id chrome` or use
`patrol` with the `chrome` device. Playwright cannot call a Dart method in the
POS. Use a Dart test for widget-level assertions and keep browser tools for the
dashboard.

**Tradeoffs.** `flutter_driver` still exists in `apps/umi-pos` and is used by
`test_driver/driver_main.dart`. Its API is older and it cannot make widget-level
assertions. `patrol` needs a native build step for every platform it drives.
`maestro` cannot read a Flutter widget tree. It finds a control by text or by
identifier, so the important controls need a label or a key. `golden_toolkit` is stale.
Its last pub.dev release is 0.15.0 on 2023-02-21. `alchemist` replaced it and
still releases.

**Cost to adopt here.** Medium. `apps/umi-pos` already declares
`integration_test` and `flutter_driver` and holds one integration test. Add
`patrol`, `patrol_cli`, and a `patrol_test` directory. Mark the important POS
controls with `Semantics` labels or keys. This work also improves the
accessibility of the POS. Add `alchemist` to `dev_dependencies` and create one
golden test per screen.

Verified facts:

| Project          | Package                 | Stars           | License      | Latest release          | Source                                             |
| ---------------- | ----------------------- | --------------- | ------------ | ----------------------- | -------------------------------------------------- |
| Flutter          | SDK 3.47.4 stable       | 178,961         | BSD-3-Clause | 3.47.4 (2026-09-11)     | https://github.com/flutter/flutter                 |
| integration_test | SDK package             | part of Flutter | BSD-3-Clause | with the SDK            | https://docs.flutter.dev/testing/integration-tests |
| Patrol           | `patrol` 4.10.0         | 1,427           | Apache-2.0   | 4.10.0 (2026-09-15)     | https://github.com/leancodepl/patrol               |
| Patrol docs      |                         |                 |              |                         | https://patrol.leancode.co/                        |
| Maestro          | CLI 2.10.0              | 15,640          | Apache-2.0   | cli-2.10.0 (2026-08-31) | https://github.com/mobile-dev-inc/maestro          |
| Appium           | server                  | 21,969          | Apache-2.0   | monorepo tag 2026-08-24 | https://github.com/appium/appium                   |
| flutter_driver   | SDK package             | part of Flutter | BSD-3-Clause | with the SDK            | https://api.flutter.dev/flutter/flutter_test/      |
| Alchemist        | `alchemist` 0.14.0      | 300             | MIT          | v0.14.0 (2026-03-13)    | https://github.com/Betterment/alchemist            |
| golden_toolkit   | `golden_toolkit` 0.15.0 | stale           | MIT          | 0.15.0 (2023-02-21)     | https://pub.dev/packages/golden_toolkit            |
| Flutter DevTools | `devtools`              | 1,730           | BSD-3-Clause | ships with the SDK      | https://github.com/flutter/devtools                |

Appium drives the POS through a platform driver. It is the slowest option in
this group and the heaviest to maintain. Keep it for a native platform surface
that Patrol cannot reach. UNVERIFIED: the current Appium server version. The
GitHub release list shows a monorepo tag for `@appium/docutils`, not the server.

Sources:

- https://docs.flutter.dev/testing/integration-tests
- https://docs.flutter.dev/ui/accessibility-and-internationalization/accessibility
- https://maestro.mobile.dev/
- https://pub.dev/packages/patrol
- https://pub.dev/packages/alchemist
- https://github.com/leancodepl/patrol

## 3. Visual regression and design QA

**Recommendation.** Use `expect(page).toHaveScreenshot()` from Playwright 1.63.0
for the dashboard. Use `alchemist` for Flutter goldens. Run the comparisons in
the same CI job as the functional tests.

**Runner-up.** Argos (`@argos-ci/cli` 6.9.4) when the team wants a hosted
review UI for image changes.

**Why.** Playwright stores a reference image and compares it with tolerance. The
`toHaveScreenshot` API also writes a diff image on failure. The trace viewer
shows the same run. This costs nothing and needs no account. Argos adds a
review page where a person accepts or rejects an image change. The Argos client
is MIT. UNVERIFIED: the current self-hosting option.

**Tradeoffs.** `lost-pixel` is now ARCHIVED on GitHub. Its last release is
v3.22.0 from 2024-11-14. Do not adopt it. `BackstopJS` has a GitHub release from
2019 and its npm package `backstopjs` 6.3.25 dates from 2024-09-07. Prefer
Playwright. `Chromatic` 18.9.0 is well maintained but its value depends on
Storybook. This repository has no Storybook. `reg-suit` v0.14.6 (2026-03-16) is
maintained and self-hosted, but its workflow is older than the Playwright
snapshot flow. `pixelmatch` 7.2.0 and `odiff` 4.5.0 are comparison engines, not
test runners. `odiff` is faster on large images.

**Flutter support.** Playwright cannot capture a Flutter golden image.
`alchemist` renders a widget in a test and compares the result with a reference
image. That is the correct tool for the POS. UNVERIFIED: Argos support for
Flutter. The Argos product page mentions a Flutter SDK; this note did not confirm
the current package.

**Cost to adopt here.** Low for Playwright, medium for Argos. Playwright snapshot
tests need reference images and a stable viewport. Font rendering and the
browser build must match between the local machine and CI. Run the image work in
one container image. Argos adds an account and a network call unless the team
self-hosts it.

Verified facts:

| Project              | Package                      | Stars  | License    | Latest release                 | Source                                     |
| -------------------- | ---------------------------- | ------ | ---------- | ------------------------------ | ------------------------------------------ |
| Playwright snapshots | in `@playwright/test` 1.63.0 | 96,197 | Apache-2.0 | 1.63.0 (2026-09-04)            | https://playwright.dev/docs/test-snapshots |
| reg-suit             | `reg-suit`                   | 1,294  | MIT        | v0.14.6 (2026-03-16)           | https://github.com/reg-viz/reg-suit        |
| Argos                | `@argos-ci/cli` 6.9.4        | 626    | MIT        | 6.9.4 (2026-09-13)             | https://github.com/argos-ci/argos          |
| lost-pixel           | `lost-pixel` 3.22.0          | 1,684  | MIT        | ARCHIVED, v3.22.0 (2024-11-14) | https://github.com/lost-pixel/lost-pixel   |
| Chromatic            | `chromatic` 18.9.0           | 337    | MIT        | v18.9.0 (2026-09-15)           | https://github.com/chromaui/chromatic-cli  |
| odiff                | `odiff`                      | 3,194  | MIT        | v4.5.0 (2026-07-23)            | https://github.com/dmtrKovalenko/odiff     |
| pixelmatch           | `pixelmatch` 7.2.0           | 6,947  | ISC        | v7.2.0 (2026-04-29)            | https://github.com/mapbox/pixelmatch       |
| BackstopJS           | `backstopjs` 6.3.25          | 7,181  | MIT        | 6.3.25 (2024-09-07)            | https://github.com/garris/BackstopJS       |
| Loki                 | `loki`                       | 1,910  | MIT        | v0.35.1 (2024-08-27)           | https://github.com/oblador/loki            |
| Alchemist            | `alchemist` 0.14.0           | 300    | MIT        | v0.14.0 (2026-03-13)           | https://github.com/Betterment/alchemist    |
| Storybook            | `@storybook/react` 10.6.0    | 91,068 | MIT        | v10.6.0 (2026-09-02)           | https://github.com/storybookjs/storybook   |

Cost comparison: Playwright snapshots are free and self-hosted. Argos has a free
tier for open projects and a paid plan for private projects; self-hosting is
possible. Chromatic has a free tier with a monthly snapshot limit and a paid
plan above it. UNVERIFIED: exact current prices and limits for Argos and
Chromatic. Check the vendor price page before a purchase.

Sources:

- https://playwright.dev/docs/test-snapshots
- https://argos-ci.com/docs
- https://github.com/chromaui/chromatic-cli
- https://github.com/reg-viz/reg-suit

## 4. Accessibility and ergonomics auditing

**Recommendation.** Add `@axe-core/playwright` 4.13.0 to the Playwright suite.
Run one scan on each dashboard screen. Add `accessibility_tools` 3.0.0 to the
Flutter POS in debug builds.

**Runner-up.** `pa11y` 10.0.0 as a separate command for a quick report on a
public page.

**Why.** `@axe-core/playwright` runs the axe-core rules inside the browser page.
It returns a list of rule failures with the element path. It needs no extra
browser and no service. `pa11y` wraps the same engine in a command line tool and
adds a simple report. `accessibility_tools` shows a panel in the running Flutter
app. The panel lists contrast problems, small touch targets, and missing
semantic labels. The POS runs on a touch screen, so target size matters.

**Tradeoffs.** `axe-core` finds many common problems, but it does not find all of
them. It cannot judge whether a flow is understandable. A person must still
review the flows.
`Lighthouse CI` (`@lhci/cli` 0.15.1) audits accessibility, performance, and
best practice in one run. Its last release is v0.15.1 from June 2025, and its
last push is 2026-03-27, so it moves slower than Playwright. `IBM Equal Access` 4.0.34
(2026-09-08) gives a different rule set and good reporting. Its audience and its
API are smaller than axe-core. Flutter also has `SemanticsTester` and
`meetsGuideline` in `flutter_test`. Those checks run inside a widget test.

**Cost to adopt here.** Low. The dashboard already uses 213 `aria-*` attributes,
so the team already works on accessibility. The scan will report real failures
in a 4,514-line hand-written style sheet. Budget one repair pass before the gate
becomes blocking. `accessibility_tools` is a debug-only dependency.

Verified facts:

| Project             | Package                        | Stars           | License      | Latest release       | Source                                                |
| ------------------- | ------------------------------ | --------------- | ------------ | -------------------- | ----------------------------------------------------- |
| axe-core            | `axe-core` 4.13.0              | 7,512           | MPL-2.0      | v4.13.0 (2026-08-05) | https://github.com/dequelabs/axe-core                 |
| axe for Playwright  | `@axe-core/playwright` 4.13.0  | in the same org | MPL-2.0      | 4.13.0 (2026-08-11)  | https://github.com/dequelabs/axe-core-npm             |
| pa11y               | `pa11y` 10.0.0                 | 4,528           | LGPL-3.0     | 10.0.0 (2026-08-28)  | https://github.com/pa11y/pa11y                        |
| Lighthouse CI       | `@lhci/cli` 0.15.1             | 7,083           | Apache-2.0   | v0.15.1 (2025-06-26) | https://github.com/GoogleChrome/lighthouse-ci         |
| IBM Equal Access    | `accessibility-checker` 4.0.34 | 776             | Apache-2.0   | 4.0.34 (2026-09-08)  | https://github.com/IBMa/equal-access                  |
| accessibility_tools | `accessibility_tools` 3.0.0    | 79              | MIT          | 3.0.0 (2026-09-11)   | https://github.com/rebelappstudio/accessibility_tools |
| Flutter semantics   | `flutter_test`                 | part of Flutter | BSD-3-Clause | with the SDK         | https://api.flutter.dev/flutter/flutter_test/         |

Sources:

- https://github.com/dequelabs/axe-core-npm
- https://www.deque.com/axe/core-documentation/
- https://docs.flutter.dev/ui/accessibility-and-internationalization/accessibility

## 5. Performance

**Recommendation.** Use Lighthouse CI for the dashboard and Flutter DevTools for
the POS. Set a small budget and fail the build when the budget breaks.

**Runner-up.** `web-vitals` 6.2.2 for field data from real owner sessions.

**Why.** Lighthouse CI runs Lighthouse in a headless browser and compares the
result with a budget file. One budget file can limit script size, image size, and
the largest contentful paint. `web-vitals` reports the field values that real
users get. The library sends the values to any endpoint.

**POS budgets for modest hardware.** These are recommendations, not measurements:

- Cold start to a usable sale screen: less than 3 seconds.
- Frame build and raster time: less than 16.7 milliseconds at 60 frames per
  second. Flutter DevTools shows both values.
- First meaningful paint after login: less than 1 second.
- Steady-state memory on the sale screen: less than 400 megabytes.

UNVERIFIED: the current measured values in this repository. Measure with
`flutter run --profile` and the DevTools timeline before you set a gate. Build
in profile mode to get the true numbers.

**Tradeoffs.** Lighthouse CI last released on 2025-06-25, so it is less current
than Playwright. Lighthouse also measures a cold page load. A dashboard behind a
login needs a signed-in state, and that needs extra setup. Flutter Desktop has
no Lighthouse equivalent. Flutter DevTools is a manual tool, so a budget gate
needs a custom test. `flutter test --profile` and the integration test binding
can record frame timings. UNVERIFIED: the exact API name in the current Flutter
release.

**Cost to adopt here.** Low for the dashboard and medium for the POS. The
dashboard is a Vite build, so Lighthouse CI points at the preview server. A
signed-in state needs a stored cookie or a seeded account. The POS needs one new
performance test harness and a stored baseline.

Verified facts:

| Project          | Package            | Stars | License      | Latest release       | Source                                        |
| ---------------- | ------------------ | ----- | ------------ | -------------------- | --------------------------------------------- |
| Lighthouse CI    | `@lhci/cli` 0.15.1 | 7,083 | Apache-2.0   | v0.15.1 (2025-06-26) | https://github.com/GoogleChrome/lighthouse-ci |
| Web Vitals       | `web-vitals` 6.2.2 | 8,609 | Apache-2.0   | 6.2.2 (2026-09-14)   | https://github.com/GoogleChrome/web-vitals    |
| Flutter DevTools | `devtools`         | 1,730 | BSD-3-Clause | ships with the SDK   | https://github.com/flutter/devtools           |

Sources:

- https://docs.flutter.dev/tools/devtools/performance
- https://github.com/GoogleChrome/lighthouse-ci

## 6. Design system and component foundations

The target look is a refined Apple-like aesthetic. That is a specification, not
a theme. Apple publishes the rules in the Human Interface Guidelines. This
repository already owns a design token package. The correct move is to keep the
tokens and add unstyled, accessible behavior. Do not adopt the default shadcn
visual style.

**Recommendation.** Use Radix UI primitives for behavior in the dashboard. Keep
`@umi/tokens` as the only source of color, spacing, radius, and type. Use
`sonner` 2.0.8 for toasts and `motion` 13.3.0 for transitions. The matching
packages are `@radix-ui/react-select` 2.3.7 and
`@radix-ui/react-dropdown-menu` 2.1.24, both released on 2026-07-24.

**Runner-up.** React Aria Components 1.21.1. It has stronger keyboard and
internationalization behavior and good documentation. Its API surface is larger
and less familiar than Radix.

**Why.** Radix primitives are unstyled. The component gives correct focus
handling, keyboard support, and ARIA attributes. The team writes all the visual
style. That combination protects the Apple-like look. The dashboard already has
a hand-written `select.jsx` and a hand-written `menu.jsx`. Radix Select and
Radix DropdownMenu replace both and remove maintenance work.

**Tradeoffs.** Base UI is the successor project from the same community as
Radix. The npm tag for `@base-ui-components/react` is `1.0.0-rc.0`
(2025-12-04), which is a release candidate. The repository `mui/base-ui`
published v1.8.0 on 2026-09-04. Read the two facts together: the project is
active, but the npm channel the team would install is a candidate. Ark UI 5.39.2
is a strong alternative with a state-machine design, but its React bindings are
newer than Radix. Vaul 1.1.2 last released on 2024-12-14 and last changed on
2025-10-03, so treat it as slow-moving. `auto-animate` 0.10.0 is a small library
for list changes and pairs well with Radix.

**Token pipeline.** `style-dictionary` 5.5.3 is the standard token builder. The
repository now uses a small custom script for the same job. Style Dictionary
adds many output formats and a community. Adopt it when the token set needs more
than two outputs or more than one brand. `Tokens Studio` 2.12.0 is a Figma plugin
that writes DTCG JSON. Adopt it only if a designer works in Figma. UNVERIFIED:
whether this team uses Figma.

**Apple specification.** Apple publishes the Human Interface Guidelines and the
design resources page. Apple has no official GitHub repository for these pages.
UNVERIFIED: a repository named `apple/design-resources-for-apple-platforms`. The
GitHub API returns 404 for that name.

**Flutter equivalents.** Keep Material 3 as the base. Use `flex_color_scheme`
9.0.0 to generate a controlled color scheme, and `google_fonts` 8.2.1 for type.
Use `forui` 0.26.0 or `shadcn_flutter` 0.0.54 only for new surfaces.
`shadcn_flutter` is at version 0.0.54, so API changes are likely.
`flutter_animate` 4.5.2 is stable but its last release is 2024-11-25.
Use `rive` 0.14.11 or `lottie` 3.5.1 for asset animation.

Verified facts:

| Project             | Package                         | Stars  | License        | Latest release                              | Source                                                 |
| ------------------- | ------------------------------- | ------ | -------------- | ------------------------------------------- | ------------------------------------------------------ |
| Radix UI primitives | `@radix-ui/react-dialog` 1.1.23 | 19,273 | MIT            | npm 1.1.23 (2026-07-24)                     | https://github.com/radix-ui/primitives                 |
| React Aria          | `react-aria-components` 1.21.1  | 15,869 | Apache-2.0     | 1.21.0 (2026-09-04)                         | https://github.com/adobe/react-spectrum                |
| Base UI             | `@base-ui-components/react`     | 10,910 | MIT            | repo v1.8.0 (2026-09-04), npm rc 2025-12-04 | https://github.com/mui/base-ui                         |
| Ark UI              | `@ark-ui/react` 5.39.2          | 5,393  | MIT            | 5.39.2 (2026-09-13)                         | https://github.com/chakra-ui/ark                       |
| Vaul                | `vaul` 1.1.2                    | 8,611  | MIT            | v1.1.2 (2024-12-14)                         | https://github.com/emilkowalski/vaul                   |
| Sonner              | `sonner` 2.0.8                  | 12,976 | MIT            | v2.0.8 (2026-08-09)                         | https://github.com/emilkowalski/sonner                 |
| Motion              | `motion` 13.3.0                 | 33,617 | MIT            | npm 13.3.0 (2026-09-14)                     | https://github.com/motiondivision/motion               |
| AutoAnimate         | `@formkit/auto-animate` 0.10.0  | 13,919 | MIT            | v0.10.0 (2026-07-10)                        | https://github.com/formkit/auto-animate                |
| Tailwind CSS        | `tailwindcss` 4.3.3             | 97,571 | MIT            | v4.3.3 (2026-07-16)                         | https://github.com/tailwindlabs/tailwindcss            |
| vanilla-extract     | `@vanilla-extract/css` 1.21.2   | 10,423 | MIT            | 1.21.2 (2026-07-27)                         | https://github.com/vanilla-extract-css/vanilla-extract |
| Panda CSS           | `@pandacss/postcss` 1.12.1      | 6,192  | MIT            | 1.12.1 (2026-09-04)                         | https://github.com/chakra-ui/panda                     |
| Style Dictionary    | `style-dictionary` 5.5.3        | 4,807  | Apache-2.0     | v5.5.3 (2026-09-06)                         | https://github.com/style-dictionary/style-dictionary   |
| Tokens Studio       | Figma plugin 2.12.0             | 1,606  | MIT            | 2.12.0 (2026-09-10)                         | https://github.com/tokens-studio/figma-plugin          |
| forui               | `forui` 0.26.0                  | 2,346  | UNVERIFIED     | 0.26.0 (2026-08-24)                         | https://github.com/duobaseio/forui                     |
| shadcn_flutter      | `shadcn_flutter` 0.0.54         | 942    | BSD-3-Clause   | v0.0.54 (2026-08-27)                        | https://github.com/sunarya-thito/shadcn_flutter        |
| flex_color_scheme   | `flex_color_scheme` 9.0.0       | 1,196  | see repository | 9.0.0 (2026-09-15)                          | https://github.com/rydmike/flex_color_scheme           |
| google_fonts        | `google_fonts` 8.2.1            | 5,310  | BSD-3-Clause   | 8.2.1 (2026-07-31)                          | https://github.com/flutter/packages                    |
| flutter_animate     | `flutter_animate` 4.5.2         | 1,111  | BSD-3-Clause   | v4.5.2 (2024-11-25)                         | https://github.com/gskinner/flutter_animate            |
| Rive                | `rive` 0.14.11                  | 1,512  | MIT            | 0.14.11 (2026-08-03)                        | https://github.com/rive-app/rive-flutter               |
| Lottie              | `lottie` 3.5.1                  | 1,295  | MIT            | v3.5.1 (2026-07-08)                         | https://github.com/xvrh/lottie-flutter                 |

**Cost to adopt here.** Medium. The dashboard has no component library. Radix
adds one dependency and replaces two hand-written components. Keep the existing
CSS and token pipeline, so the visual change stays under the team's control. A
Tailwind migration is a separate and larger decision. This repository writes
plain CSS, so Tailwind, vanilla-extract, and Panda CSS are alternatives, not
requirements.

Sources:

- https://developer.apple.com/design/human-interface-guidelines
- https://developer.apple.com/design/resources/
- https://react-spectrum.adobe.com/react-aria/
- https://base-ui.com/
- https://ark-ui.com/
- https://github.com/radix-ui/primitives

## 7. Domain building blocks

### 7.1 Floor plan editor

**Recommendation.** Keep Konva 10.5.0, as selected on 2026-09-13. The
`docs/research/2026-09-13-floor-plan-editor-alternatives.md` note records that
decision. Do not reopen it.

**Runner-up.** fabric.js 7.4.0 for a canvas without React bindings.

**Why.** The earlier note compares tldraw, Excalidraw, fabric.js, and an SVG
route. Konva has a React binding, an MIT license, and active releases. tldraw
5.4.2 needs a commercial license for production, and the license terms have
changed over time. Excalidraw 0.18.1 is free but its editor is a sketch tool, not
a constrained table editor.

**Tradeoffs.** `@dnd-kit/core` 6.3.1 last released on 2024-12-05. The repository
also publishes `@dnd-kit/collision` 0.5.0 (2026-06-11) under a different version
line. Check a new dependency against both lines before you adopt it.
`@xyflow/react` 12.11.6 fits a node graph, not a floor plan. Flutter
`InteractiveViewer` handles pan and zoom only. It does not edit shapes.

**Cost to adopt here.** None. The decision is made.

### 7.2 Table reservation

**Recommendation.** Build the reservation model in PostgreSQL. Do not buy or
adopt an open-source reservation engine.

**Runner-up.** TastyIgniter, as a reference product.

**Why.** This research found no maintained, general-purpose open-source table
reservation engine. A GitHub search by stars returns only course projects and
demos. TastyIgniter 4.4.2 (2026-09-14, MIT, 3,758 stars) is a restaurant
platform with a reservation extension. It is a PHP application, so it is a
reference for the model and the screens, not a library for this stack.

**PostgreSQL pattern.** Use a range type and an exclusion constraint. A
reservation holds `table_id`, a party size, and a `tstzrange` column named
`period`. The exclusion constraint
`EXCLUDE USING gist (table_id WITH =, period WITH &&)` prevents two overlapping
reservations on one table in the database itself. This protects the rule under
concurrency. The `btree_gist` extension supplies the integer operator class.

**Tradeoffs.** The rule set around reservations is larger than the overlap rule.
Turn time, table joining, waitlist order, and timezone handling each need an
explicit decision. Commercial systems supply reports and guest history.
UNVERIFIED: prices and features of OpenTable, SevenRooms, and Resy. This note
did not check them.

**Cost to adopt here.** Medium. The API uses `pg` and raw SQL, so a migration
and a repository module fit the current pattern. The POS needs a read model for
the host view.

### 7.3 Offline-first sync

**Recommendation.** Keep the existing POS offline journal. Add ElectricSQL only
when the owner dashboard needs live read shapes from PostgreSQL.

**Runner-up.** PowerSync for a full offline-first client store.

**Why.** `apps/umi-pos` already implements an offline journal and an offline
policy with tests. ElectricSQL (`@electric-sql/client` 1.5.28, 2026-09-09)
streams query results from PostgreSQL and matches the current database.
PowerSync `@powersync/web` 2.3.1 (2026-09-10) gives a fuller client database with
uploads. Zero (`@rocicorp/zero` 1.9.0, 2026-08-14) gives fast client queries and
permissions, and its source lives in `rocicorp/mono`. TinyBase 9.7.1 and Yjs
13.6.32 are local-first stores, not PostgreSQL mirrors.

**Tradeoffs.** RxDB 17.5.0 and WatermelonDB 0.28.0 target mobile JavaScript.
The POS is Flutter, so a Dart client matters more. WatermelonDB last released on
2025-04-07 and last changed on 2025-08-11, so it is slowing. cr-sqlite v0.16.3
dates from 2024-01-17 and is stale. Triplit `@triplit/client` 1.0.50 dates from
2025-07-31 with a last push on 2026-01-19. `@rocicorp/reflect` 0.39 (2024-02-23)
is legacy; Zero replaced it. UNVERIFIED: the maturity of the ElectricSQL Dart
client for Flutter.

**Cost to adopt here.** High. Any sync engine changes the write path, the
conflict rules, and the test plan. Keep the current journal until a concrete
requirement appears.

### 7.4 Background jobs

**Recommendation.** Keep BullMQ, and upgrade to 6.3.6.

**Runner-up.** pg-boss 12.32.0 if the team wants to remove Redis.

**Why.** The API already runs BullMQ 5 with `@nestjs/bullmq`. BullMQ 6.3.6
released on 2026-09-14, so the project is current. pg-boss stores jobs in
PostgreSQL and needs no second data store. Graphile Worker 0.18.0 does the same
job in the PostgreSQL process. Temporal 1.24.0 and Hatchet 0.107.0 give durable
workflows, and Trigger.dev 4.6.1 is a hosted product.

**Tradeoffs.** A move to pg-boss or Graphile Worker removes the Redis operation.
That saving matters only if Redis exists for no other reason. It also costs a
rewrite of every queue and worker. Temporal and Hatchet add a new service.

**Cost to adopt here.** Low for the BullMQ upgrade. High for a store change.

### 7.5 Realtime at scale

**Recommendation.** Keep socket.io 4.8.3. Add Centrifugo only when one Node
process can no longer hold the connections.

**Runner-up.** Centrifugo v6.9.6 as a separate realtime server.

**Why.** The API, the dashboard, and the POS client all use socket.io today. A
change of protocol touches three applications. Centrifugo is a standalone
server with channels and a Go core. It handles many connections per process.
`ws` 8.21.3 is the plain WebSocket library and is the correct choice only if the
team drops the socket.io protocol.

**Tradeoffs.** `soketi` 1.6.1 dates from 2024-03-25 and its last push is
2025-03-03, so it is stale. `@microsoft/fetch-event-source` 2.0.1 dates from
2021-04-25 and is stale. For server-sent events, use the browser `EventSource`
interface with the API's own parser. SSE fits one-way feeds such as the kitchen
display. It does not fit the two-way device handshake that the POS uses.

**Cost to adopt here.** High for Centrifugo, none for the current design.

Verified facts:

| Project                   | Package                         | Stars           | License               | Latest release        | Source                                                               |
| ------------------------- | ------------------------------- | --------------- | --------------------- | --------------------- | -------------------------------------------------------------------- |
| Konva                     | `konva` 10.5.0                  | 14,794          | MIT on npm            | 10.5.0 (2026-09-08)   | https://github.com/konvajs/konva                                     |
| fabric.js                 | `fabric` 7.4.0                  | 31,442          | MIT                   | v7.4.0 (2026-05-18)   | https://github.com/fabricjs/fabric.js                                |
| tldraw                    | `tldraw` 5.4.2                  | 50,381          | commercial key needed | v5.4.2 (2026-09-10)   | https://github.com/tldraw/tldraw                                     |
| Excalidraw                | `@excalidraw/excalidraw` 0.18.1 | 132,071         | MIT                   | v0.18.1 (2026-04-20)  | https://github.com/excalidraw/excalidraw                             |
| dnd-kit                   | `@dnd-kit/core` 6.3.1           | 17,637          | MIT                   | 6.3.1 (2024-12-05)    | https://github.com/clauderic/dnd-kit                                 |
| React Flow                | `@xyflow/react` 12.11.6         | 38,389          | MIT                   | 12.11.6 (2026-09-01)  | https://github.com/xyflow/xyflow                                     |
| TastyIgniter              | application 4.4.2               | 3,758           | MIT                   | v4.4.2 (2026-09-14)   | https://github.com/tastyigniter/TastyIgniter                         |
| ElectricSQL               | `@electric-sql/client` 1.5.28   | 10,363          | Apache-2.0            | 1.5.28 (2026-09-09)   | https://github.com/electric-sql/electric                             |
| PowerSync                 | `@powersync/web` 2.3.1          | 723             | Apache-2.0            | 2.3.1 (2026-09-10)    | https://github.com/powersync-ja/powersync-js                         |
| Zero                      | `@rocicorp/zero` 1.9.0          | 3,383           | Apache-2.0            | 1.9.0 (2026-08-14)    | https://github.com/rocicorp/mono                                     |
| TinyBase                  | `tinybase` 9.7.1                | 5,174           | MIT                   | v9.7.0 (2026-09-03)   | https://github.com/tinyplex/tinybase                                 |
| Yjs                       | `yjs` 13.6.32                   | 22,799          | MIT                   | v13.6.32 (2026-08-04) | https://github.com/yjs/yjs                                           |
| RxDB                      | `rxdb` 17.5.0                   | 23,379          | Apache-2.0            | 17.5.0 (2026-08-20)   | https://github.com/pubkey/rxdb                                       |
| WatermelonDB              | `@nozbe/watermelondb` 0.28.0    | 11,785          | MIT                   | 0.28.0 (2025-04-07)   | https://github.com/Nozbe/WatermelonDB                                |
| cr-sqlite                 | `@vlcn.io/crsqlite`             | 3,792           | MIT                   | v0.16.3 (2024-01-17)  | https://github.com/vlcn-io/cr-sqlite                                 |
| Automerge                 | `@automerge/automerge` 3.4.1    | 6,610           | MIT                   | 3.4.1 (2026-08-12)    | https://github.com/automerge/automerge                               |
| Triplit                   | `@triplit/client` 1.0.50        | 3,115           | AGPL-3.0              | 1.0.50 (2025-07-31)   | https://github.com/aspen-cloud/triplit                               |
| BullMQ                    | `bullmq` 6.3.6                  | 9,403           | MIT                   | v6.3.6 (2026-09-14)   | https://github.com/taskforcesh/bullmq                                |
| pg-boss                   | `pg-boss` 12.32.0               | 3,954           | MIT                   | 12.32.0 (2026-09-14)  | https://github.com/timgit/pg-boss                                    |
| Graphile Worker           | `graphile-worker` 0.18.0        | 2,392           | MIT                   | v0.18.0 (2026-09-08)  | https://github.com/graphile/worker                                   |
| Temporal TS SDK           | `@temporalio/client` 1.24.0     | 914             | MIT                   | v1.24.0 (2026-09-15)  | https://github.com/temporalio/sdk-typescript                         |
| Trigger.dev               | `@trigger.dev/sdk` 4.6.1        | 16,288          | Apache-2.0            | v4.6.1 (2026-09-15)   | https://github.com/triggerdotdev/trigger.dev                         |
| Hatchet                   | `@hatchet-dev/typescript-sdk`   | 7,948           | MIT                   | v0.107.0 (2026-09-15) | https://github.com/hatchet-dev/hatchet                               |
| Socket.IO                 | `socket.io` 4.8.3               | 63,197          | MIT                   | 4.8.3                 | https://github.com/socketio/socket.io                                |
| ws                        | `ws` 8.21.3                     | 22,801          | MIT                   | 8.21.3 (2026-08-06)   | https://github.com/websockets/ws                                     |
| Centrifugo                | server v6.9.6                   | 10,755          | Apache-2.0            | v6.9.6 (2026-09-14)   | https://github.com/centrifugal/centrifugo                            |
| soketi                    | server 1.6.1                    | 5,637           | AGPL-3.0              | 1.6.1 (2024-03-25)    | https://github.com/soketi/soketi                                     |
| Flutter InteractiveViewer | SDK widget                      | part of Flutter | BSD-3-Clause          | with the SDK          | https://api.flutter.dev/flutter/widgets/InteractiveViewer-class.html |

Sources:

- https://www.postgresql.org/docs/current/sql-createtable.html
- https://www.postgresql.org/docs/current/btree-gist.html
- https://www.postgresql.org/docs/current/rangetypes.html
- https://tastyigniter.com/marketplace/item/igniter-reservation/
- https://electric-sql.com/
- https://www.powersync.com/
- https://zero.rocicorp.dev/

## 8. Data and charts for owner analytics

**Recommendation.** Use `lightweight-charts` 5.2.1 for dense time series. Use
`@visx/*` 4.0.0 for a custom composed chart.

**Runner-up.** `recharts` 3.10.1 for a fast first version.

**Why.** `lightweight-charts` draws on a canvas and stays fast with a large
number of points. It also handles pan and zoom without extra code. The owner
report screen shows sales over time, so point count and repaint cost matter. The
POS runs on modest hardware, and the owner often opens the dashboard on a small
laptop. `visx` gives low-level primitives. The team composes the axes, the
scales, and the marks. That control matches a refined, dense design. `recharts`
3.10.1 gives the quickest path to a standard chart.

**Tradeoffs.** `lightweight-charts` is a canvas library, so the style controls
are narrower than an SVG library. `visx` needs more code for each chart.
`recharts` is slower with very large series. `nivo` 0.99.0 last released on
2025-05-23. `uPlot` 1.6.32 is very fast but its last release is 2025-03-14, and
its API is low-level. `Observable Plot` 0.6.17 last released on 2025-02-14.
`echarts` 6.1.0 is feature-rich and heavy. `@mui/x-charts` 9.13.0 has free and
commercial parts; read the license before a Pro feature. UNVERIFIED: the exact
split between the free and the commercial parts.

**Cost to adopt here.** Low. `recharts`, `visx`, or `lightweight-charts` are
additive dependencies. The dashboard already uses `react-virtuoso` for long
lists, so the team is comfortable with performance work.

Verified facts:

| Project            | Package                     | Stars  | License             | Latest release       | Source                                            |
| ------------------ | --------------------------- | ------ | ------------------- | -------------------- | ------------------------------------------------- |
| visx               | `@visx/shape` 4.0.0         | 21,051 | MIT                 | v4.0.0 (2026-06-11)  | https://github.com/airbnb/visx                    |
| Recharts           | `recharts` 3.10.1           | 27,559 | MIT                 | v3.10.1 (2026-07-25) | https://github.com/recharts/recharts              |
| Nivo               | `@nivo/core` 0.99.0         | 14,097 | MIT                 | v0.99.0 (2025-05-23) | https://github.com/plouc/nivo                     |
| ECharts            | `echarts` 6.1.0             | 67,332 | Apache-2.0          | 6.1.0 (2026-05-19)   | https://github.com/apache/echarts                 |
| Observable Plot    | `@observablehq/plot` 0.6.17 | 5,378  | ISC                 | v0.6.17 (2025-02-14) | https://github.com/observablehq/plot              |
| uPlot              | `uplot` 1.6.32              | 10,494 | MIT                 | 1.6.32 (2025-03-14)  | https://github.com/leeoniya/uPlot                 |
| Lightweight Charts | `lightweight-charts` 5.2.1  | 17,277 | Apache-2.0          | v5.2.1 (2026-08-12)  | https://github.com/tradingview/lightweight-charts |
| MUI X Charts       | `@mui/x-charts` 9.13.0      | 5,848  | MIT plus commercial | v9.13.0 (2026-09-04) | https://github.com/mui/mui-x                      |

Sources:

- https://github.com/tradingview/lightweight-charts
- https://github.com/airbnb/visx
- https://github.com/recharts/recharts

## 9. Agent and developer workflow for this repository

### 9.1 CodeGraph CLI

CodeGraph is installed at `/home/jc/.local/bin/codegraph`. The index is at
`/home/jc/umi/.codegraph`. Version 1.6.0 reports these statistics for this
repository:

- Files: 1,183
- Nodes: 22,844
- Edges: 58,978
- Database size: 82.38 MB
- Backend: `node:sqlite`
- Route nodes: 332

The command set includes `init`, `index`, `sync`, `status`, `query`, `explore`,
`context`, `node`, `callers`, `callees`, and `impact`. The `explore` and `node`
commands return the same output as the matching MCP tools. An agent can find
the callers of a function before it changes that function.

UNVERIFIED: a public repository, a license, and a star count for CodeGraph. This
research found no public source page. Treat the tool as a local, closed tool
until a source appears.

**Recommendation.** Keep CodeGraph as the default navigation tool for agents on
this repository. Run `codegraph sync` after a large change.

### 9.2 Browser and code tooling

**Recommendation.** Use `@playwright/cli` 0.1.20 for agent browser work and
`@playwright/mcp` 0.0.81 for long sessions. Use `typescript-eslint` 8.70.0 with
the strict TypeScript rules. Use `knip` 6.35.1 for dead code and unused
dependencies.

**Runner-up.** `madge` 8.0.0 for a dependency graph and circular imports.

**Why.** `knip` finds unused files, unused exports, and unused dependencies in a
monorepo. It reads the workspace layout. `depcheck` is ARCHIVED on GitHub, and
`ts-prune` last released on 2021-12-12. Both are poor choices for new work.
`madge` 8.0.0 released on 2024-08-05 and last changed on 2026-01-21, so it
moves slowly but still works. On strictness, `microsoft/TypeScript` 7.0.2
released on 2026-08-20. UNVERIFIED: the size of the compiler change in
TypeScript 7. Test the build before an upgrade. `ts-reset` 0.4.2 last released
on 2023-03-08; treat it as optional.

**Cost to adopt here.** Low for `knip` and `typescript-eslint`. A `knip` run on
three apps and two packages will report findings that need review before the
gate becomes blocking.

### 9.3 API contract tooling

**Recommendation.** Keep the Zod contract. Add
`@asteasolutions/zod-to-openapi` 9.1.0 and `@scalar/api-reference` 1.68.0 to
publish a human and agent readable API reference.

**Runner-up.** `@fastify/swagger` 9.8.1 with `openapi-typescript` 7.13.0.

**Why.** `packages/contract` already holds Zod schemas and generates TypeScript
and Dart. `zod-to-openapi` turns those same schemas into an OpenAPI document.
No second schema source appears. Scalar renders that document as an interactive
reference. An agent can read the reference and call the API without guessing.
`@fastify/swagger` 9.8.1 fits the Fastify server directly.
`openapi-typescript` 7.13.0 makes typed clients from an OpenAPI file. `orval`
8.33.0 generates client code and query hooks, and released on 2026-09-13.
`ts-rest` 3.52.1 gives an end-to-end typed REST contract, and its last release
is 2025-03-04. `tRPC` 11.18.0 is excellent inside one TypeScript codebase, but
the POS is Dart, so tRPC cannot serve the whole product.

**Cost to adopt here.** Low. The contract exists. The work is a generator script
and a static reference page. A Dart client for a REST contract already exists in
`packages/contract/generated/dart`.

### 9.4 Database type safety

**Recommendation.** Add `kysely` 0.29.6 for new query code. Keep the 497
existing `pg` calls.

**Runner-up.** `pgtyped` 2.4.3 when the team wants types from SQL files with
little rewrite.

**Why.** `kysely` builds typed queries in TypeScript and stays close to SQL. It
has a strong release cadence; version 0.29.6 released on 2026-09-16. `pgtyped`
writes TypeScript types from SQL files, so it changes less code, but its last
release is 2025-03-15. `slonik` 49.10.9 gives safe tagged SQL with runtime
validation, under a BSD-3-Clause license. `drizzle-orm` 0.45.2 is a full ORM
with migrations. `postgres` 3.4.9 is a fast client with tagged templates.
`sqlc` v1.31.1 generates typed code from SQL, and it now targets TypeScript as
well as Go. `supabase` holds 109,348 stars but is a platform, not a client.

**Tradeoffs.** An ORM or query builder adds a layer between the code and the SQL.
This repository writes detailed SQL today, and that SQL carries business rules.
A rewrite of 497 call sites is not worth the risk. Add types to new code and
migrate one module at a time.

**Cost to adopt here.** Low for new code, high for a full migration.

Verified facts:

| Project            | Package                                | Stars   | License      | Latest release        | Source                                                 |
| ------------------ | -------------------------------------- | ------- | ------------ | --------------------- | ------------------------------------------------------ |
| TypeScript         | `typescript` 7.0.2                     | 111,067 | Apache-2.0   | v7.0.2 (2026-08-20)   | https://github.com/microsoft/TypeScript                |
| typescript-eslint  | `typescript-eslint` 8.70.0             | 16,391  | MIT          | v8.70.0 (2026-09-07)  | https://github.com/typescript-eslint/typescript-eslint |
| ts-reset           | `@total-typescript/ts-reset` 0.4.2     | 8,608   | MIT          | v0.4.2 (2023-03-08)   | https://github.com/total-typescript/ts-reset           |
| Knip               | `knip` 6.35.1                          | 12,271  | ISC          | 6.35.1 (2026-09-09)   | https://github.com/webpro-nl/knip                      |
| ts-prune           | `ts-prune` 0.10.3                      | 2,066   | MIT          | stale, 2021-12-12     | https://github.com/nadeesha/ts-prune                   |
| depcheck           | `depcheck` 1.4.7                       | 4,920   | MIT          | ARCHIVED (2025-02-27) | https://github.com/depcheck/depcheck                   |
| Madge              | `madge` 8.0.0                          | 10,162  | MIT          | 8.0.0 (2024-08-05)    | https://github.com/pahen/madge                         |
| ts-rest            | `@ts-rest/core` 3.52.1                 | 3,339   | MIT          | v3.52.1 (2025-03-04)  | https://github.com/ts-rest/ts-rest                     |
| openapi-typescript | `openapi-typescript` 7.13.0            | 8,366   | MIT          | 7.13.0 (2026-02-11)   | https://github.com/openapi-ts/openapi-typescript       |
| Orval              | `orval` 8.33.0                         | 6,457   | MIT          | v8.33.0 (2026-09-13)  | https://github.com/orval-labs/orval                    |
| zod-to-openapi     | `@asteasolutions/zod-to-openapi` 9.1.0 | 1,619   | MIT          | v9.1.0 (2026-07-19)   | https://github.com/asteasolutions/zod-to-openapi       |
| fastify-swagger    | `@fastify/swagger` 9.8.1               | 1,095   | MIT          | v9.8.1 (2026-07-13)   | https://github.com/fastify/fastify-swagger             |
| Scalar             | `@scalar/api-reference` 1.68.0         | 16,119  | MIT          | 1.68.0 (2026-09-07)   | https://github.com/scalar/scalar                       |
| tRPC               | `@trpc/server` 11.18.0                 | 40,609  | MIT          | v11.18.0 (2026-06-18) | https://github.com/trpc/trpc                           |
| pgtyped            | `@pgtyped/cli` 2.4.3                   | 3,280   | MIT          | v2.4.3 (2025-03-15)   | https://github.com/adelsz/pgtyped                      |
| Kysely             | `kysely` 0.29.6                        | 14,228  | MIT          | v0.29.6 (2026-09-16)  | https://github.com/kysely-org/kysely                   |
| Slonik             | `slonik` 49.10.9                       | 4,940   | BSD-3-Clause | 49.10.9 (2026-07-26)  | https://github.com/gajus/slonik                        |
| Drizzle ORM        | `drizzle-orm` 0.45.2                   | 35,780  | Apache-2.0   | 0.45.2 (2026-03-27)   | https://github.com/drizzle-team/drizzle-orm            |
| postgres.js        | `postgres` 3.4.9                       | 8,728   | Unlicense    | v3.4.9 (2026-04-05)   | https://github.com/porsager/postgres                   |
| sqlc               | CLI v1.31.1                            | 18,295  | MIT          | v1.31.1 (2026-04-22)  | https://github.com/sqlc-dev/sqlc                       |

Sources:

- https://knip.dev/
- https://kysely.dev/
- https://github.com/scalar/scalar
- https://github.com/asteasolutions/zod-to-openapi

## 10. Testing strategy for money code

**Recommendation.** Add `fast-check` 4.10.1 to the Vitest suites for the
checkout, cash, and exception modules. Add `@stryker-mutator/core` 10.0.0 for the
same modules.

**Runner-up.** `testcontainers` 12.1.0 for a real PostgreSQL instance in a
concurrency test.

**Why.** The repository holds calculators for checkout, refunds, cash, and
customer value. Each one has pure logic and a small input space. `fast-check`
generates many inputs and shrinks a failure to a small example. A property test
finds the rounding case and the boundary case that an example test misses.
`Stryker` changes the code in small ways and checks whether a test fails. A high
mutation score means the money tests are real. The package
`@fast-check/vitest` 0.5.0 (2026-09-11) runs property checks inside the current
test command.

**Concurrency.** The repository already holds concurrency check scripts for
customer value and the kitchen display. `testcontainers` 12.1.0 starts a real
PostgreSQL container in a test, so the test can run two transactions at the same
time. `@electric-sql/pglite` 0.5.8 runs PostgreSQL in the process, which is
faster but not identical to the server. `pgTAP` v1.3.4 tests the database
functions and constraints inside PostgreSQL. UNVERIFIED: the current behavior of
the existing gate scripts under a parallel test runner.

**Tradeoffs.** `fast-check` needs properties, not examples. A wrong property
test gives false confidence. `Stryker` is slow; run it on a schedule or on one
module, not on every commit. `testcontainers` needs a container runtime in CI.
Windows and Docker Desktop add setup cost. The Dart property test library
`glados` 1.1.7 last released on 2023-12-04, so the POS has no current
property-based library.

**Cost to adopt here.** Medium. `fast-check` is a small addition to the existing
Vitest setup. `Stryker` needs a configuration file and a separate CI job.
`testcontainers` needs a CI service container.

Verified facts:

| Project        | Package                        | Stars  | License        | Latest release       | Source                                                |
| -------------- | ------------------------------ | ------ | -------------- | -------------------- | ----------------------------------------------------- |
| fast-check     | `fast-check` 4.10.1            | 5,144  | MIT            | v4.10.1 (2026-09-15) | https://github.com/dubzzz/fast-check                  |
| StrykerJS      | `@stryker-mutator/core` 10.0.0 | 3,125  | Apache-2.0     | v10.0.0 (2026-08-14) | https://github.com/stryker-mutator/stryker-js         |
| Testcontainers | `testcontainers` 12.1.0        | 2,612  | MIT            | v12.1.0 (2026-08-04) | https://github.com/testcontainers/testcontainers-node |
| PGlite         | `@electric-sql/pglite` 0.5.8   | 16,032 | Apache-2.0     | 0.5.8 (2026-08-26)   | https://github.com/electric-sql/pglite                |
| pgTAP          | extension v1.3.4               | 1,165  | see repository | v1.3.4 (2025-10-04)  | https://github.com/theory/pgtap                       |
| Vitest         | `vitest` 5.0.1                 | 17,103 | MIT            | v5.0.1 (2026-09-15)  | https://github.com/vitest-dev/vitest                  |
| glados         | `glados` 1.1.7                 | Dart   | MIT            | 1.1.7 (2023-12-04)   | https://pub.dev/packages/glados                       |

Sources:

- https://fast-check.dev/
- https://stryker-mutator.io/
- https://github.com/testcontainers/testcontainers-node
- https://github.com/electric-sql/pglite

## Migration notes for this repository

| Area               | Current state                                      | Proposed change                                                                      | Cost                        | Worth it         |
| ------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------- | ---------------- |
| Browser tests      | Root Playwright 1.62.1, no dashboard browser test  | Add `playwright.config.ts` and an `e2e` directory; upgrade to 1.63.0                 | Low                         | Yes              |
| Agent browser work | `@playwright/cli` 0.1.18, `@playwright/mcp` 0.0.80 | Upgrade to 0.1.20 and 0.0.81                                                         | Low                         | Yes              |
| Component behavior | Hand-written `select.jsx` and `menu.jsx`           | Replace with Radix primitives                                                        | Medium                      | Yes              |
| Visual style       | 4,514-line hand-written CSS plus `@umi/tokens`     | Keep. Do not adopt the shadcn default theme                                          | None                        | Yes              |
| Token build        | Custom script in `packages/tokens/build`           | Keep for now; move to Style Dictionary when a third output or a second brand appears | Low later                   | Later            |
| Dead code          | No dead-code gate                                  | Add `knip` 6.35.1                                                                    | Low                         | Yes              |
| SQL types          | 497 `query(` calls on `pg`                         | Add `kysely` for new code                                                            | Low now, high for a rewrite | Yes for new code |
| API reference      | Zod contract plus generators                       | Add `zod-to-openapi` and Scalar                                                      | Low                         | Yes              |
| Flutter end-to-end | One `integration_test`, `flutter_driver` driver    | Add Patrol 4.10.0                                                                    | Medium                      | Yes              |
| Flutter visuals    | No golden tests                                    | Add Alchemist 0.14.0                                                                 | Medium                      | Yes              |
| Money tests        | Example-based Vitest tests                         | Add `fast-check` and Stryker                                                         | Medium                      | Yes              |
| Offline data       | POS offline journal with tests                     | Keep. Evaluate ElectricSQL only for the dashboard                                    | High                        | Not now          |
| Job queue          | BullMQ 5 on Redis                                  | Upgrade to 6.3.6                                                                     | Low                         | Yes              |
| Realtime           | socket.io in three applications                    | Keep. Add Centrifugo only for connection scale                                       | High                        | Not now          |
| Floor plan         | Konva, selected on 2026-09-13                      | Keep the decision                                                                    | None                        | Decided          |

## Ranked shortlist: ten tools

1. `@playwright/test` 1.63.0. The dashboard has no browser test today, and this
   one tool adds traces, screenshots, and a stable accessibility tree for every
   control. Source: https://github.com/microsoft/playwright
2. `@axe-core/playwright` 4.13.0. Two lines inside the Playwright run turn
   accessibility from a review comment into a build gate. Source:
   https://github.com/dequelabs/axe-core-npm
3. Radix UI primitives, for example `@radix-ui/react-select` 2.3.7. The
   unstyled primitives replace the hand-written select and menu and keep the
   team's own Apple-like style. Source: https://github.com/radix-ui/primitives
4. `patrol` 4.10.0. An agent gains real control of the Flutter POS on Linux
   desktop and on Chrome, with screenshots. Source:
   https://github.com/leancodepl/patrol
5. `alchemist` 0.14.0. Flutter golden tests catch widget changes that no
   browser tool can see, and `golden_toolkit` is stale. Source:
   https://github.com/Betterment/alchemist
6. `fast-check` 4.10.1. Property tests find the rounding and boundary errors
   that a money calculator hides from example tests. Source:
   https://github.com/dubzzz/fast-check
7. `knip` 6.35.1. One command reports dead code and unused dependencies across
   three apps and two packages, and `depcheck` is archived. Source:
   https://github.com/webpro-nl/knip
8. `kysely` 0.29.6. New queries get full types without a risky rewrite of the
   497 existing raw SQL calls. Source: https://github.com/kysely-org/kysely
9. `sonner` 2.0.8 with `motion` 13.3.0. Toast feedback and short transitions
   give the largest visible quality gain for a small change. Sources:
   https://github.com/emilkowalski/sonner and
   https://github.com/motiondivision/motion
10. `lightweight-charts` 5.2.1. Dense owner time series stay smooth on a modest
    laptop. Source: https://github.com/tradingview/lightweight-charts

Just outside the ten: `@scalar/api-reference` 1.68.0 with
`@asteasolutions/zod-to-openapi` 9.1.0, `@stryker-mutator/core` 10.0.0, the
installed CodeGraph CLI 1.6.0, `pg-boss` 12.32.0, and `style-dictionary` 5.5.3.

## Limits of this document

- Star counts, version numbers, and release dates are a snapshot of 2026-09-15.
- The document records published facts and repository evidence. It records no
  benchmark of this product.
- Several items are marked UNVERIFIED. Read the matching source before a
  purchase or a large change.
- The document does not cover prices for commercial products in detail.
