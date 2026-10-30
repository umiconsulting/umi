# Inventory phase 2: recipe sales and confirmed return restock

Date: 2026-10-30. Backend integration checks used disposable local PostgreSQL databases.
Phase 1 PR #232 merged externally. The phase 2 PR must stay open for approval.

## Result

The new integration suite proves authored recipes through the real cart, cash, checkout, refund, and inventory services.
Each scenario creates a separate merchant, device, operator session, product, ingredient, and recipe.
Administrative commands create, update, and retire the recipes.
The fixtures create products before their recipes and assert that no prior catalog mapping exists.
The fixtures use the stock ledger function for opening stock. They never insert a committed sale.

The tests exposed four checkout defects:

- An active reservation acquired a second mapping after a recipe edit.
- The approval check used current recipe quantities and counted the reservation's own stock hold twice.
- The sale commit function omitted the consumed approval proof for negative stock.
- A changed tender produced a new valid approval that failed against the reservation's original fingerprint.

The checkout repository now reuses the quantities and identities of an active reservation with the same cart version.
Its approval query uses those captured quantities and excludes their existing stock hold from the shortage calculation.
The forward migration preserves the existing SQL interface and passes the consumed approval proof to the ledger.
The grant must match the current command, merchant, location, permission, method, and sale confirmation fingerprint.
The sale must match the reservation's merchant, location, and cart.
The reservation keeps its original command and fingerprint for release provenance.
The ledger keeps its existing approval checks.

## Measured quantities

All ingredient quantities use kilograms with scale 2. Values below are scaled integers.

| Scenario                      | Ledger and balance evidence                                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original sale                 | Recipe value 125 per portion. Two portions consume 250. Opening 1000 becomes 750.                                                                        |
| Recipe edit                   | Recipe value becomes 200. A later one-portion sale consumes 200. Balance becomes 550.                                                                    |
| Original refund               | Refund replay creates one compensation. The stock balance stays 550 until approved physical disposition.                                                 |
| Confirmed restock             | The inventory review exposes the original component maximum of 250. The test submits those returned identities and quantities. Balance becomes 800.      |
| History                       | Original sale ledger keeps its original mapping and recipe IDs at version 1. The later sale uses new IDs at version 2.                                   |
| Checkout and restock replay   | Each original command returns its prior result. No second consumption or restock entry appears.                                                          |
| Block policy                  | Stock 100 cannot satisfy 125. Checkout returns `NEGATIVE_STOCK_BLOCKED`. No reservation or sale ledger row remains.                                      |
| Manager policy                | Stock 100 requires approval for 125. A valid consumed grant permits one sale and leaves balance -25. Replay adds no consumption.                         |
| Allow policy                  | `allow_and_flag` permits the same sale without approval and leaves balance -25. Replay adds no consumption.                                              |
| Variant selection             | An exact variant consumes 200. An inherited variant consumes 125. After exact recipe retirement, that variant consumes the product fallback of 125.      |
| Retirement without fallback   | Checkout returns `INVENTORY_MAPPING_REQUIRED`. Stock stays 1000. No zero-consumption sale occurs.                                                        |
| Captured reservation          | Stock 300 holds 250. After the recipe changes to 200 per portion, checkout still consumes the captured 250 once. Final stock is 50.                      |
| Changed checkout confirmation | Stock 100 holds 125 with approval F1. Changing only the tender ID produces F2. Approval F2 permits one sale and replay. Reservation provenance stays F1. |

## Verification

Tools: Node 22.23.3, pnpm 10.29.3, Vitest 2.1.9, PostgreSQL 17, TypeScript, ESLint, and Prettier.
The existing integration configuration and `pos-offline.integration.ts` supplied the fixture pattern.
The local verification playbook supplied the verification rules.

- Focused recipe suite: 8/8 passed after review fix I1.
- Affected integration suites: 94/94 passed across six files in 3.27 seconds.
- API `tsc --noEmit`: exit 0.
- ESLint for the new suite and checkout repository: exit 0, zero warnings.
- Prettier for changed TypeScript, JSON, and workflow files: passed.
- Forward migration: applied twice to the local phase 2 database, both times with exit 0.

The integration runner emits the existing Vite CJS API deprecation warning.
Review fix I1 first failed with `NEGATIVE_STOCK_APPROVAL_REQUIRED`, then passed after the SQL proof binding changed.
The separate schema suite passed 342 tests, with two existing skips, after the corrected migration was applied twice.

Affected integration command, with the disposable database environment supplied separately:

```sh
pnpm --filter @umi/api exec vitest run --config vitest.integration.config.ts \
  src/modules/inventory-authoring/inventory-authoring.integration.ts \
  src/modules/inventory-authoring/inventory-recipe-sales.integration.ts \
  src/modules/pos-inventory/pos-inventory.integration.ts \
  src/modules/pos-offline/pos-offline.integration.ts \
  src/modules/pos-exception/point-card-refund.integration.ts \
  src/modules/procurement/procurement.integration.ts
```

The focused wrapper is `bash /private/tmp/umi-inventory-phase2-tests.sh sales`.
The suite is included in `test:integration:schema`.
CI applies the new migration before the schema suite and repeats it twice after fixtures exist.

## Limits

The backend checks exercise real services and PostgreSQL. They do not prove native POS interactions.
Dashboard interaction evidence is recorded below.
Refund money compensation and physical restock are separate operations. Recipe components require explicit approved disposition.
The reservation regression covers active, unexpired reservations. It does not cover recreation after release or expiry.
The tests do not repair reservations that already contain duplicate historical mappings.
The migration preserves the ledger's existing guards; this suite does not test every forged grant combination.
Final branch review is separate from these execution results.
Production migration and merge require the normal PR approval.
A hosted dashboard preview can use a shared API, so it does not prove this branch’s backend.

## Dashboard acceptance

Visible Chromium used a separate local dashboard on port 4033 and API on port 4032.
Real controls covered a previously unmapped variant, recipe create/update, conflict cancellation and confirmation, and a price-only product edit.
Persisted reads confirmed recipe version 2, the updated quantity, and a retained recipe mapping after the price edit.
Retirement notice and cancellation worked. Desktop and mobile confirmation controls remained reachable without horizontal overflow.
The form uses plain ingredient wording and preserves the draft when a mapping replacement is cancelled.

Three committed browser regressions cover identical retry after an ambiguous failure, stale-version reload, and Spanish permission errors.
They run the real UI and command hook with intercepted error responses.
A separate real-API run discarded a successful HTTP 201 response, then retried through the UI.
The retry sent the same command identity and body, recovered the same recipe ID, and left one active recipe.

Local artifacts:

- `/private/tmp/umi-inventory-phase2-task2-acceptance.json`.
- `/private/tmp/umi-inventory-phase2-task2-fix1-regressions.json`.
- `/private/tmp/umi-inventory-phase2-task2-conflict-mobile.png`.
- `/private/tmp/umi-inventory-phase2-task2-response-loss.png`.
- `/private/tmp/umi-inventory-phase2-browser.cjs`.

Committed browser tests: `apps/umi-dashboard/e2e/recipe-sales-recovery.pw.js`.
Full-page reload can discard the in-memory pending request. The shared command hook persists its identity only.
This inherited cross-reload recovery limit remains; the editor prevents dismissal while a save outcome is uncertain.

## Whole-branch checks

- `PR_BASE_REF=origin/main pnpm check:pr`: passed. The lint baseline remains 68 warnings, with no new category.
- Affected build, lint, and tests ran with `--concurrency=1`: eight tasks passed.
- API unit tests: 2,118 passed, 29 existing skips. Dashboard: 427 passed. Contract: 102 passed.
- API and contract type checks passed. Generated TypeScript and Dart checks passed after the contract change.
- Full schema integration: 33 files passed, 342 tests passed, two existing skips.
- SQL preflight: zero unresolved statements; 15 statements remain outside that instrument's coverage.
- The migration passed repeated application on populated fixtures and on the separate schema target.

The first schema run omitted the local administrative connection. Three unrelated reward/cash fixture checks failed.
Adding `DATABASE_URL_ADMIN` to the external test runner corrected that environment issue; no product code changed.
The final approval correction changes SQL and its integration regression. Focused, affected, and full schema checks passed afterward.
Existing Vite CJS, bundle-size, and expected test-fixture diagnostics remain known output noise.

The PR targets `main`. Phase 1 merged externally as `5ac984e5668970f3990b486f7bb690046c0b39a7`.
That commit's tree matches this branch's original base, `d508bb1684b37f1de7730ac56e034380afafb03a`.
Manual initial costs and the new-item negative-stock default are separate changes.
