# Inventory phase 2 implementation plan

> **For agentic workers:** Use `subagent-driven-development` to execute each task and its review.

**Goal:** Connect recipes for existing products to inventory consumption during sales.

**Architecture:** Use administrative commands, recipe versions, catalog mappings and the existing ledger. Save recipe and mapping changes in one transaction.

**Tech Stack:** TypeScript, NestJS, PostgreSQL 17, Zod, React, Vitest, pnpm 10.29.3, Node 22.23.3, Playwright Chromium.

**Spec:** `docs/plans/2026-10-30-inventory-phase2-design.md`.

## Global Constraints

- Work only in `/private/tmp/umi-inventory-phase2-20261030`, branch `feat/inventory-phase2-recipes`.
- Preserve the original checkout and phase 1 preview on ports 4022 and 4023.
- Do not merge PRs, enable auto-merge, change production or send notifications.
- Preserve backend authority, exact scaled integers, permissions, merchant isolation, idempotency and version checks.
- Use plain Spanish in UI copy. Verify changed workflows with real Chromium clicks.
- Use local PostgreSQL at 127.0.0.1:55435, database `umi_inventory_phase2`.
- Run contract builds, lint and type checks sequentially.
- Do not modify applied pre-cutover SQL. The proven checkout approval defect uses one forward migration, `supabase/migrations/20261030001000_inventory_sale_approval.sql`.

### Task 1: Recipe mapping lifecycle and recipe target read

**Files:**

- Modify `apps/umi-api/src/modules/inventory-authoring/inventory-authoring.repository.ts`, `.service.ts`, `.controller.ts`.
- Modify `apps/umi-api/src/modules/pos-catalog/pos-catalog.repository.ts` and focused tests.
- Modify `apps/umi-api/src/modules/inventory-authoring/inventory-authoring.integration.ts` and focused unit tests.
- Modify `packages/contract/src/recipes.ts`, contract error and route registries, contract tests, version metadata and generated files.

**Interfaces:**

- Add optional `replaceSalesMapping: { mappingId: string; expectedVersion: number }` to `InventoryRecipeCreateRequest` and `InventoryRecipeUpdateRequest`.
- Add `INVENTORY_RECIPE_MAPPING_CONFLICT`, HTTP 409, with details `mappingId`, `mappingVersion`, `mappingType` for the active conflicting mapping.
- Add `InventoryRecipeTargetQuery` with `cursor` and `limit` (default 100, maximum 100).
- Add `InventoryRecipeTargetList`: `{ targets, page, correlationId }`. Each target has `productId`, `productName`, `productActive`, nullable `variantId`, nullable `variantName`, and `priceMinor`.
- Add GET `/api/merchants/:merchantId/recipe-targets`, under the existing recipe read guards.
- Catalog administrative detail adds nullable `inventoryMappingType`, for the product-level mapping only.
- Bump the contract from 2.47.0 to 2.48.0 and regenerate with the existing tools.

- [ ] Write real database regressions before changing code. Assert missing mapping after create, old mapping mutation after update, active mapping after retire, and price-only catalog update losing the recipe.

```ts
expect(activeMapping).toMatchObject({ mapping_type: 'recipe', recipe_id: created.recipe.id });
expect(previousMapping.recipe_id).toBe(previousRecipeId);
expect(previousMapping.active).toBe(false);
expect(newMapping.version).toBe(previousMapping.version + 1);
expect(afterPriceEdit.recipe_id).toBe(currentRecipeId);
```

- [ ] Run focused tests and record the expected failures. Use the existing administrative command fixture so permissions and retries execute through the real command path.
- [ ] Implement product locking before recipe locking. Read the product identity without a recipe lock, lock the merchant product, then lock and validate the recipe. Serialize exact-target mapping creation and version allocation under this product lock.
- [ ] Create a recipe mapping when none exists. For updates, replace the mapping of the current recipe with a new mapping row. Preserve mapping type `bundle` when updating an owned bundle mapping. Do not mutate historical mapping recipe IDs. Connect legacy unmapped product recipes when saved. Item recipes do not create sales mappings.
- [ ] For another active exact-target mapping, throw the typed conflict unless the supplied replacement token matches that mapping's ID and version. Check stale tokens even if a mapping disappears. Roll back all recipe writes on refusal.

```ts
const confirmationMatches = dto.replaceSalesMapping?.mappingId === current.id &&
  dto.replaceSalesMapping.expectedVersion === current.version;
```

- [ ] Retire only active mappings which point at the retired recipe. Preserve stock and history. Retiring a variant restores existing product fallback behavior.
- [ ] Keep a recipe mapping during catalog edits with a null item field. Reject an explicit non-null direct item while a recipe mapping is active. Include `inventoryMappingType` in administrative detail and select only `variant_id IS NULL` there.
- [ ] Implement paginated targets from active products plus their active variants, without requiring mappings. Use a stable key and validate opaque cursors with the current repository conventions. Preserve merchant isolation. Include product base targets even when variants have mappings.
- [ ] Cover no mapping, direct/non-stock conflicts, confirmation, stale confirmation, duplicate commands, concurrent create/replace, item recipes, variant priority, retirement, and cross-merchant targets. Replace old test fixture inserts that mask the missing mapping.
- [ ] Run focused integration tests, API unit tests, contract tests and type checks. Record red/green commands and output in the report. Commit this task.

### Task 2: Dashboard recipe activation and confirmation

**Files:**

- Modify `apps/umi-dashboard/src/data.jsx` and relevant data tests.
- Modify `apps/umi-dashboard/src/screens/recipe-workspace.jsx`, `recipe-model.js` and `recipe-model.spec.js` as needed.
- Modify `apps/umi-dashboard/src/screens/operations-workspace.jsx` and relevant tests.
- Update affected translation catalogs with the repository tools if required.

**Interfaces:**

- Consume the recipe target endpoint and replacement token from Task 1.
- Consume `catalog.detail.result.inventoryMappingType` from Task 1.
- Keep recipe create/update responses and administrative command identity handling.

- [ ] Write focused behavioral tests for target pagination and replacement state before implementation.
- [ ] Load all target pages using the existing async data patterns. Keep loading failures visible and retain a bounded loop against repeated cursors.
- [ ] Explain product saves with: `Al guardar, las próximas ventas descontarán los ingredientes de esta receta.` Explain that a specific variant takes priority over the product recipe.
- [ ] Catch `INVENTORY_RECIPE_MAPPING_CONFLICT` and show a confirmation with `Usar esta receta` and `Cancelar`. Name the current behavior in everyday words. Cancellation preserves both the recipe draft and existing configuration.
- [ ] Submit the returned ID/version only after the user confirms. Clear the confirmation when target or recipe fields change, or freeze the draft while confirmation is shown. A second conflict requires a fresh confirmation.

```js
parameters.replaceSalesMapping = {
  mappingId: conflict.details.mappingId,
  expectedVersion: conflict.details.mappingVersion,
};
```

- [ ] For product recipe retirement, explain that later sales need another valid inventory configuration. Preserve the existing retire confirmation.
- [ ] In the product editor, show `Descuenta ingredientes de una receta` for recipe/bundle mappings. Omit `inventoryItemId` when unchanged; preserve it for deliberate direct-item edits. Avoid displaying a raw ID input as the way to replace a recipe.
- [ ] Run the dashboard suite and build. Verify actual create, conflict/cancel/confirm, variant selection, update and price-only save with clicks in isolated Chromium. The controller provides separate API/dashboard ports. Commit this task and report evidence.

### Task 3: Complete sale and return verification

**Files:**

- Add `apps/umi-api/src/modules/inventory-authoring/inventory-recipe-sales.integration.ts`.
- Modify `apps/umi-api/package.json` to include the suite in `test:integration:schema`.
- Modify only the recipe/checkout/return paths when the new integration proves a defect within this phase.
- Add `supabase/migrations/20261030001000_inventory_sale_approval.sql` to preserve the consumed negative-stock approval through sale ledger commit.
- Modify `.github/workflows/umi-api-ci.yml` to apply that migration in the existing fresh and populated checks, including the second application. Add focused migration checks.
- Add `docs/reports/2026-10-30-inventory-phase2.md` after validation.

**Interfaces:**

- Use the administrative recipe commands from Task 1.
- Use the real `PosCheckoutService` and return service with real PostgreSQL. Existing `pos-offline.integration.ts` demonstrates checkout construction and cash sale fixtures.
- Read ledger entries and balances as the acceptance evidence. Do not seed a committed sale to substitute for checkout.

**Quantity example:** Use an ingredient in kilograms with scale 2. A recipe uses value 125 per one portion.
Selling two portions consumes value 250. Change the recipe to value 200 per portion; a later sale uses that new amount.
Refunding the original two-portion sale with `restockDecision: 'restock'` restores value 250, regardless of the current recipe.
Assert deltas and historical recipe/mapping IDs. Keep each additional scenario independent from earlier test order.

- [ ] Write a complete sale regression using a product created before its recipe. Create its recipe through the command, sell it through checkout, and assert exact ingredient consumption.
- [ ] Verify checkout replay does not append consumption twice. Verify insufficient stock uses the configured block/approval rules. Also prove `allow_and_flag` permits a negative balance without duplicate consumption.
- [ ] Fix the proven approved checkout failure with the canonical SQL function in an additive migration. Carry the consumed grant bound to the command, merchant, location and permission. Keep ledger authorization checks intact. Apply the migration twice on local test data.
- [ ] Change the recipe; sell again and verify the new quantities. Return the earlier sale and verify reversal of its original quantities, including replay.
- [ ] Test a variant-specific recipe and a variant which inherits the product recipe. Test retirement with and without a fallback. Confirm no silent zero consumption.
- [ ] Test a reservation that exists before a recipe edit. Preserve its captured mapping and recipe identity; report and fix any reproducible stale-reservation defect within this flow.
- [ ] Run focused integration red/green when fixes are needed. Add the suite to the schema command so CI executes it. Run all affected integration suites once and document their coverage limits.

```sh
pnpm --filter @umi/api exec vitest run --config vitest.integration.config.ts src/modules/inventory-authoring/inventory-recipe-sales.integration.ts
```

- [ ] Commit the task with its verification report. The controller then runs the complete PR gates, requests a final branch review and opens the stacked PR. Leave both PRs open for approval.
