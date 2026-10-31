# Direct inventory preparation

Date: 2026-10-30. [PR #242](https://github.com/umiconsulting/umi/pull/242) targets `staging` and remains open for approval.
The latest user instruction requires one PR for this delivery, with atomic commits.
It includes the approved cost, stock-policy, and mobile changes that are absent from `staging`, plus direct preparation.
This replaces the earlier plan for PRs with intermediate target branches.

## Delivered behavior

Active item recipes show **Preparar** in Recetas.
Product and variant recipes retain their sales purpose.
**Nueva preparación** in Preparación offers all active item recipes, including items without a target quantity.
Both entry points open the same dialog.
Recipe and item reads load every page, including the cost-status read for items.
A failed or incomplete page read remains an error.

The owner selects a stock location when the branch has several locations.
The dialog reads valid locations through `inventory.overview`.
It accepts a positive quantity at the item's exact decimal scale and shows its base unit.
**Revisar ingredientes** requests the server's exact preview.
The dialog displays the returned ingredient quantities without local recipe scaling.

A change to the item, quantity, or stock location clears the preview.
**Confirmar preparación** sends equal actual and planned quantities with the server recipe fingerprint.
A changed recipe requires a new preview.
Pending submission prevents duplicate clicks.
A lost response locks the submitted values and permits only a retry of the same command.
The existing `useAdministrativeCommand` hook retains its command and idempotency identities.
The success state shows the produced quantity and lot reference.
The originating list refreshes, and stock refreshes after navigation to Artículos.

Spanish and English messages explain missing locations, permissions, recipes, exact quantities, stock refusals, and unavailable service.
The dialog uses a portal above the other panels.
Keyboard focus stays inside the dialog and returns to the prior control after closure.
The existing mobile editor fix remains intact.

## Verification

The local stack used API 4072, dashboard 4073, and Chromium over CDP 9225.
The browser used a separate context and preserved the other browser contexts.
The fixture contains 108 active item recipes and a sales recipe.
`Pan de prueba 105` lies after the first 100 recipes and items.
The original preparation recipes also lie after that page boundary.
All preparation fixture items have no target quantity.

| Check                                     | Result                                                          | Local log                                        |
| ----------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| Focused model tests                       | 18 passed                                                       | `/private/tmp/umi-preparation-ui-green.log`      |
| Dashboard tests                           | 470 passed, 37 files                                            | `/private/tmp/umi-preparation-ui-tests.log`      |
| Dashboard lint                            | Exit 0, no errors, 68 existing warnings                         | `/private/tmp/umi-preparation-ui-lint.log`       |
| Dashboard build                           | Exit 0                                                          | `/private/tmp/umi-preparation-ui-build.log`      |
| Catalog extraction and strict compilation | No drift; 2345 messages per locale; no missing English messages | `/private/tmp/umi-preparation-ui-i18n-check.log` |
| Real browser acceptance                   | 1 passed in 9.9 seconds                                         | `/private/tmp/umi-preparation-browser.log`       |

Verification uses `/private/tmp/umi-inventory-preparation-20261030`, Node 22, and pnpm 10.
The browser command below now removes the color-environment conflict:

```sh
export PATH="/Users/moon/.npm/_npx/c29883048cd047b6/node_modules/node/bin:/Users/moon/.npm/_npx/c29883048cd047b6/node_modules/.bin:$PATH"
pnpm --filter @umi/dashboard exec vitest run src/screens/inventory-production-model.spec.js
pnpm --filter @umi/dashboard test
pnpm --filter @umi/dashboard lint
pnpm --filter @umi/dashboard build
pnpm --filter @umi/dashboard i18n:extract
pnpm --filter @umi/dashboard i18n:compile
env -u NO_COLOR \
UMI_PREPARATION_FIXTURE=/private/tmp/umi-inventory-preparation-ui-fixture.json \
UMI_PREPARATION_EVIDENCE_DIR=/private/tmp/umi-preparation-evidence \
pnpm exec playwright test --config /private/tmp/umi-inventory-preparation-playwright.config.mjs
```

The extraction check compared both catalog SHA-256 hashes before and after extraction.
The hashes remained equal.
The existing build chunk-size warning remains.
The existing authentication test prints its cross-tab lock fallback message.

## Browser and stock evidence

The final browser scenario used real clicks for:

- Both entry points, recipes without targets, and selection after the first 100 rows.
- A sales recipe without a preparation action.
- Explicit stock-location selection and cancellation without balance changes.
- Five units with 500 grams consumed, and twenty units with 2000 grams consumed.
- Nested preparation of five units with 50 grams of leaf ingredients consumed.
- Preview invalidation after item, quantity, and stock-location changes.
- A real recipe change, a stale-plan refusal, and a new preview with 1000 grams.
- A real stock refusal in the empty secondary stock location.
- A real refusal of a non-exact half-gram ingredient quantity.
- An injected HTTP 503 preview failure that exposes no confirmation.
- A real committed response lost before the UI receives it, followed by an identical request retry.
- Reachable controls at 320px and 390px, then refreshed stock in Artículos.

The final run read balances through the real API and read each resulting lot through the recall API.

| Item              |       Before |        After |      Change |
| ----------------- | -----------: | -----------: | ----------: |
| Pan preparado     |     95 units |    125 units |   +30 units |
| Harina conversión | 991350 grams | 988300 grams | -3050 grams |
| Pan con mezcla    |     25 units |     30 units |    +5 units |

The retry used command `92cd8476-ee1b-41b8-aa7e-7518a27df4f3` twice with identical complete request bodies.
Both attempts resolved to lot `437c8d96-ee3b-4bd3-aaa4-db6808d76672`.
The controller independently compared the database snapshots before and after the final run.
The audit confirmed four new lots, eight movements, and two rejected commands without writes.
The retry created no duplicate, and ledger sums matched the balances.
[Database audit](evidence/2026-10-30-inventory-preparation/controller-db-audit.json) records the per-command checks.
[API evidence](evidence/2026-10-30-inventory-preparation/api-evidence.json) contains the exact commands, results, and balance reads.

| Screenshot                | Evidence                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Recipe half-batch review  | [Preview](evidence/2026-10-30-inventory-preparation/recipe-half-preview.png)                                                         |
| Produced quantity and lot | [Success](evidence/2026-10-30-inventory-preparation/recipe-half-success.png)                                                         |
| Stale recipe              | [Refusal](evidence/2026-10-30-inventory-preparation/stale-recipe.png)                                                                |
| Failed server preview     | [Error](evidence/2026-10-30-inventory-preparation/preview-error.png)                                                                 |
| Lost response             | [Retry state](evidence/2026-10-30-inventory-preparation/response-loss.png)                                                           |
| Mobile controls           | [320px](evidence/2026-10-30-inventory-preparation/mobile-320.png), [390px](evidence/2026-10-30-inventory-preparation/mobile-390.png) |
| Stock after navigation    | [Stock](evidence/2026-10-30-inventory-preparation/stock-after.png)                                                                   |

## Test-first record and limits

The first model run failed five assertions before implementation; thirteen rejection assertions already passed against the empty stubs.
The failure covered decimal parsing, retained preview, active recipes, pagination, and page failure handling.
An additional archived-item regression failed before the model checked `archivedAt`.
The final model run passed all 18 cases.
Logs: `/private/tmp/umi-preparation-ui-red.log` and `/private/tmp/umi-preparation-ui-archived-red.log`.

Exploratory browser runs exposed a fixture request with extra read fields, the existing local rate limit, and an incorrect tab locator.
The final scenario uses input-only recipe fields and the app's tabs without repeated full-page reloads.
It passed without a rate-limit bypass.
Earlier successful synthetic preparations remain in the local database.
The final run has a separate database start snapshot at `/private/tmp/umi-preparation-evidence/db-before-successful-run.json`.
The stale-recipe scenario restores the original ingredients through the real recipe command.
The retained recipe history and resulting synthetic production lots form part of the local test evidence.

No production data, push, merge, deployment, notification, backend rebuild, or contract edit occurred in this dashboard task.
The controller owns final whole-schema checks, affected checks, `check:pr`, independent review, and PR publication.

## Review correction: pending keyboard focus

Review finding I1 identified a focus escape while every dialog control was disabled.
Chromium moved focus to the page body during pending preview and production requests.
The original key handler could not capture the next Tab from the body.

The preparation sheet now uses the native modal dialog and `showModal()`.
The browser makes the background inert while the dialog stays open.
A layout effect focuses the dialog when a command becomes pending.
The Tab handler keeps focus on the dialog when no controls are enabled.
The native cancel event stays blocked, so a pending command cannot be dismissed.
The existing ambiguous command body and identity remain unchanged.

Two focused Chromium regressions failed before the fix and passed after it:

| Check                    | Result                   | Log                                                                                          |
| ------------------------ | ------------------------ | -------------------------------------------------------------------------------------------- |
| Pending preview focus    | RED failed; GREEN passed | `/private/tmp/umi-preparation-focus-red.log`, `/private/tmp/umi-preparation-focus-green.log` |
| Pending production focus | RED failed; GREEN passed | Same logs                                                                                    |

The GREEN run passed both tests in 4.9 seconds.
The tests hold the command response while all form controls are disabled.
They check focus before and after Tab and Shift+Tab.
They also verify that a background tab rejects programmatic focus.
Cancellation stays disabled during pending commands and ambiguous production results.
A retry uses the identical complete request body.
After ordinary cancellation, the background becomes usable again.
These focused regressions send no production write to the server.

```sh
env -u NO_COLOR \
UMI_PREPARATION_FIXTURE=/private/tmp/umi-inventory-preparation-ui-fixture.json \
UMI_PREPARATION_EVIDENCE_DIR=/private/tmp/umi-preparation-evidence \
pnpm exec playwright test \
  --config /private/tmp/umi-inventory-preparation-playwright.config.mjs \
  --grep 'pending .* keeps keyboard focus'
```

The command removes the conflicting `NO_COLOR` variable and retains the existing color setting.
The focused RED and GREEN logs contain no color-environment warning.
The original full acceptance and stock evidence remain applicable.
The focused correction did not repeat the full acceptance or package suites.
The controller owns the final gates and review.

Screenshots: [pending preview](evidence/2026-10-30-inventory-preparation/pending-preview-focus.png) and
[pending production](evidence/2026-10-30-inventory-preparation/pending-produce-focus.png).

Changed dialog and browser test files passed targeted ESLint with no warnings.
Changed source and report files passed Prettier and `git diff --check`.
