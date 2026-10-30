# Dashboard preparation implementation plan

> **For agentic workers:** Use subagent-driven-development to implement each task, with a review between tasks.

**Goal:** Let an owner record preparation directly from an inventory recipe, with exact ingredients and stock movements.
**Architecture:** Extend the existing administrative production path. Share one backend plan between preview and commit, and use that plan in the dashboard.
**Tech Stack:** NestJS, PostgreSQL 17, Zod contract, React, Lingui, Vitest, Playwright.
**Spec:** `docs/plans/2026-10-30-inventory-preparation-design.md`.

## Global Constraints

- Work only in `/private/tmp/umi-inventory-preparation-20261030`, branch `feat/inventory-dashboard-preparation`.
- Keep PRs open for approval. Do not merge, deploy production, enable auto-merge, or send notifications.
- Preserve previous clients: omitted new fields keep the existing one-recipe-batch behavior.
- Use exact scaled quantities, existing authorization, command identity, transaction boundaries, and stock ledger.
- Do not edit applied migrations or the SDK generator. Regenerate artifacts from the canonical contract.
- Test against local isolated PostgreSQL and a real browser. Never print fixture credentials.

### Task 1: Exact backend preparation preview and commit

Read `docs/plans/2026-10-30-inventory-preparation-design.md` first. This task owns API and contract only.
Use the current worktree and preserve all dashboard sources for Task 2. No subagents, pushes, or merges.

**Files:**
- Modify `packages/contract/src/pos-inventory.ts`, `dashboard-operations.ts`, `catalog.ts`, package version and generated artifacts.
- Modify `apps/umi-api/src/modules/administrative-commands/administrative-command-execution.service.ts`, `administrative-command.policy.ts`, and relevant tests.
- Modify `apps/umi-api/src/modules/pos-inventory/pos-inventory.service.ts`, `pos-inventory.repository.ts`, and focused tests.
- Create `apps/umi-api/src/modules/pos-inventory/inventory-preparation.integration.ts` for real PostgreSQL assertions.
- Modify `apps/umi-api/src/modules/inventory-authoring/inventory-authoring.service.ts` and its existing prep-list tests.
- Add a small pure planning helper next to the production repository only if it removes duplicate calculations.
- Include the new integration in the schema test command if the current command lists files explicitly.

**Interfaces produced:**

```ts
// New operation uses the existing administrative command envelope.
// targetAggregateId: output item ID; context locationId is required.
operation: 'inventory.production.preview'
parameters: {
  inventoryLocationId: string;
  quantity: { value: number; scale: number; unit: UnitOfMeasure };
}
// result, exported as ProductionPreview in the contract:
{
  outputItemId: string;
  inventoryLocationId: string;
  recipeId: string;
  recipeVersion: number;
  plannedQuantity: ScaledQuantity; // normalized to output item
  consumed: ProductionConsumedLine[]; // exact aggregated leaf inputs
  recipeFingerprint: string; // server fingerprint of the reviewed plan
}
// Existing produce operation accepts two new OPTIONAL fields:
plannedQuantity?: PositiveScaledQuantity;
recipeFingerprint?: string;
// The new dashboard sends quantity === plannedQuantity and the preview fingerprint.
// Existing clients omit both and retain recipe-yield/actual-yield semantics.
```

Use existing `ProductionRecord` parsing and command enrichment where possible. Do not create a second public write route.
Both preview and produce require the existing `inventory.production.produce` permission and valid tenant/location authorization.
Preview must reject a foreign or inactive stock location rather than merely echoing its ID.
Use the same normalized inputs and fingerprint function for preview and commit. Include the root recipe ID/version, planned output, and exact leaf ingredients.
The fingerprint must detect nested-recipe changes that alter consumption. Do not use receipt costs as an authorization token.
Read the commit plan under the existing transaction and recipe/item locks; the stock entries must use that same plan.
An absent fingerprint preserves old clients. A supplied stale fingerprint returns `INVENTORY_PREPARATION_CHANGED` with no writes.
An explicit planned quantity below the actual quantity returns `INVENTORY_PRODUCTION_QUANTITY_INVALID` with no writes.
The new UI sends equal planned/actual quantities. Preserve existing shortfall semantics for callers without the new plan.
Reject a retired or missing recipe, archived output, non-exact quantities, invalid precision, and invalid units before stock writes.
Keep blocking and authorization stock policies effective. Map known conflicts to their existing application codes.
Preview contains no lot or ledger writes. Commit preserves idempotency and the same output/result shape, with declaredQuantity reflecting the selected plan.
Use one coherent contract minor-version bump from 2.49.0 and regenerate SDK artifacts.

- [ ] Write real integration regressions first, using existing schema harness and authoring helpers from initial-cost/production tests.

```ts
// Recipe: 10 units from 1000 grams. These are business assertions, not implementation assertions.
expect(preview.plannedQuantity).toEqual({ value: 5, scale: 0, unit: 'unit' });
expect(preview.consumed[0].quantity).toEqual({ value: 500, scale: 0, unit: 'gram' });
expect(afterOutput - beforeOutput).toBe(5);
expect(beforeFlour - afterFlour).toBe(500);
expect(retried.lotId).toBe(first.lotId);
// Also prepare20 -> consume2000, with one produced lot and exact balances.
```

- [ ] Run and record the expected failure before implementation.
- [ ] Implement the shared plan, preview dispatch, optional commit fields, and contract artifacts.
- [ ] Test fractional and multiple yields, subrecipes, exact conversion rejection, permissions, cross-tenant/location refusal, and archived/retired recipes.
- [ ] Change the root recipe and a nested recipe between preview and commit. Assert `INVENTORY_PREPARATION_CHANGED` and no stock/lot changes.
- [ ] Retry one successful command after simulated response loss; assert one lot and one set of ledger movements.
- [ ] Force one ingredient stock rejection; assert full rollback for all ingredients and output.
- [ ] Preserve existing no-new-fields production tests, including yield loss and costing.
- [ ] Add a prep-list regression: objective10, stock3, forecast0 =>7; forecast4 =>11. Change subtraction to addition and update misleading formula comments.
- [ ] Run focused integration, API tests/types, contract tests/types, generated TS/Dart analysis and drift; record exact commands and counts.
- [ ] Commit in atomic units: production preview/quantity support, and prep-suggestion correction can use separate commits.

Local setup is `/private/tmp/umi-inventory-preparation-setup.md`. Ask the controller if a required connection or service is absent.
Node/pnpm PATH starts `/Users/moon/.npm/_npx/c29883048cd047b6/node_modules/node/bin:/Users/moon/.npm/_npx/c29883048cd047b6/node_modules/.bin`.
`product-feature-review` is absent from installed skills/repo; use the repository verification and review rules.
Write your report to the task report path supplied by the controller; do not track internal reports.

### Task 2: Dashboard preparation flow and real browser acceptance

Read the design and Task 1 report for exact accepted types. Own dashboard, browser scenarios, and public verification report.
No backend/contract edits without first reporting the issue to the controller. No subagents or pushes.

**Files:**
- Create `apps/umi-dashboard/src/screens/inventory-production.jsx`, `inventory-production-model.js`, and its model tests.
- Modify `apps/umi-dashboard/src/screens/recipe-workspace.jsx` and `prep-list.jsx` to open the shared production dialog.
- Update the English and Spanish Lingui catalogs using the existing extraction/compile tools.
- Add fixture-gated real browser test and scenario under `apps/umi-dashboard/e2e/`.
- Create `docs/reports/2026-10-30-inventory-preparation.md` with evidence and limits.

**Interfaces consumed:** Task 1 administrative preview and produce contracts.
**UI interface:** a shared dialog receives an output recipe/item and selected location; on success it refreshes the originating list.
Use `inventory.overview` to read valid stock locations. Require an explicit selection if more than one location is available.
Use the existing `useAdministrativeCommand` identity recovery for writes; keep the same payload/identity after an ambiguous response.

- [ ] Add model tests before code for parsing positive exact quantities and stale-preview invalidation.

```js
expect(preparationQuantity('2,5', { quantityScale: 2, baseUnit: 'kilogram' }))
  .toEqual({ value: 250, scale: 2, unit: 'kilogram' });
expect(preparationQuantity('0', { quantityScale: 2, baseUnit: 'kilogram' })).toBeNull();
expect(preparationQuantity('0.001', { quantityScale: 2, baseUnit: 'kilogram' })).toBeNull();
```

- [ ] Add «Preparar» beside active item recipes. Keep product/variant recipes as sales recipes.
- [ ] Add «Nueva preparación» to Preparación, with all active item recipes selectable even without par or current suggestions.
- [ ] Ensure all recipe pages are available to selection, or explicitly load further pages. Do not silently omit recipes beyond the first100.
- [ ] Let the owner choose quantity, see normalized output unit, then request «Revisar ingredientes».
- [ ] Show the server's exact ingredient quantities. Do not scale the existing floored recipe explosion in JavaScript.
- [ ] Provide «Confirmar preparación» and «Cancelar». Disable duplicate submissions. A quantity/item/stock-location change invalidates the preview.
- [ ] A stale recipe requires a new preview. A failed read must remain an error rather than an empty ingredient list.
- [ ] After success, show prepared quantity and lot. Refresh recipe/prep data and stock on subsequent navigation.
- [ ] Explain lack of location, permissions, no preparable recipes, stock block/approval, non-exact quantities, and unavailable service in simple Spanish.
- [ ] Render the dialog above other panels with usable controls at320/390px. Preserve the mobile fix.
- [ ] Remove formula comments that still say demand reduces suggested preparation.
- [ ] Run real Chromium against the prepared local API. Cover both entry points, a recipe without par, cancellation, half/double batch, nested ingredients, stale recipe, server error, and response-loss retry.
- [ ] Read real API/database balances and lots to prove deductions and output. Preserve existing browser contexts.
- [ ] Run dashboard build/lint/tests, format and Lingui checks. Record screenshots and exact evidence in the public report.
- [ ] Commit one cohesive dashboard feature with its tests and report.

The controller owns schema-wide tests, final PR gates, final review and publication. The PR remains open for approval.
