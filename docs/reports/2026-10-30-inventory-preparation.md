# Direct inventory preparation

Date: 2026-10-30. The delivery PR targets `staging` and remains open for approval.
The latest user instruction supersedes the earlier stacked-base plan.
The controller owns a prerequisite integration PR for the previously approved inventory and mobile changes.

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

Commands ran from `/private/tmp/umi-inventory-preparation-20261030` with Node 22 and pnpm 10:

```sh
export PATH="/Users/moon/.npm/_npx/c29883048cd047b6/node_modules/node/bin:/Users/moon/.npm/_npx/c29883048cd047b6/node_modules/.bin:$PATH"
pnpm --filter @umi/dashboard exec vitest run src/screens/inventory-production-model.spec.js
pnpm --filter @umi/dashboard test
pnpm --filter @umi/dashboard lint
pnpm --filter @umi/dashboard build
pnpm --filter @umi/dashboard i18n:extract
pnpm --filter @umi/dashboard i18n:compile
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
