# Inventory initial cost implementation plan

> **For agentic workers:** Use `subagent-driven-development` to execute one implementation task and its review at a time.

**Goal:** Let owners set an initial item cost before purchases supply the active cost.

**Architecture:** Extend the existing item commands and cost resolver. Keep one nullable amount on the item and preserve receipt facts.

**Tech Stack:** TypeScript, NestJS, PostgreSQL 17, Zod, React, Lingui, Vitest, Chromium, pnpm 10.29.3, Node 22.23.3.

**Spec:** `docs/plans/2026-10-30-inventory-initial-cost-design.md`.

## Global Constraints

- Work only in `/private/tmp/umi-inventory-initial-cost-20261030`, branch `feat/inventory-initial-cost`.
- Base this branch on the reviewed phase 2 recipe-sales branch. Keep a separate PR and leave all PRs pending approval.
- Preserve the original checkout, both existing worktrees, and their preview services.
- Use local database `umi_inventory_initial_cost`, fresh schema database `umi_inventory_initial_cost_verify`, and ports 4042/4043. Use an isolated Chromium context or profile.
- Do not merge, enable auto-merge, change production, or send notifications.
- Preserve merchant isolation, owner permissions, optimistic versions, command identity, and audit history.
- Use integer centavos and the item's whole base unit. Null means unknown; explicit zero remains a known cost.
- Receipts take priority over initial costs. Do not fabricate receipt rows or stock entries.
- Use plain Spanish and real Chromium input for UI acceptance.
- Add a forward migration; do not edit applied numbered SQL. Test it twice on populated synthetic data.
- Run contract builds/tests sequentially with checks that depend on contract dist.

### Task 1: Item initial cost and consistent cost reads

**Files:**

- Add `supabase/migrations/20261030010000_inventory_initial_cost.sql`.
- Modify `.github/workflows/umi-api-ci.yml` to apply the migration in the existing fresh and populated checks.
- Modify `packages/contract/src/recipes.ts`, `inventory-costing.ts`, contract tests, version metadata, and generated artifacts.
- Modify `apps/umi-api/src/modules/inventory-authoring/inventory-authoring.repository.ts`, `.service.ts`, and focused tests.
- Modify `apps/umi-api/src/modules/inventory-costing/inventory-costing.repository.ts`, `.service.ts`, and `.integration.ts`.
- Add `apps/umi-api/src/modules/inventory-authoring/inventory-initial-cost.integration.ts` and include it in `apps/umi-api/package.json` schema tests.
- Add or update focused migration-shape tests under `apps/umi-api/src/shared/database/`.

**Interfaces:**

- `InventoryAuthoringItem` returns `initialUnitCostMinor: number | null`.
- Create/update requests accept optional nullable `initialUnitCostMinor` with safe nonnegative integer validation.
- `CostBasisKind` adds `manual_initial`.
- The existing cost basis endpoint retains its fields. Manual amounts do not change receipt counts, received quantities, or receipt price ranges.
- `includeWithoutReceipts: false` continues to filter on actual receipts. `true` includes manual and missing bases.
- Item `includeItemsWithoutCost: false` includes a non-null initial amount, including zero.
- Bump contract 2.48.0 to 2.49.0 and regenerate through repository tools.

- [ ] Write contract and real administrative-command regressions before implementation. Use these amounts verbatim:

```ts
const initialUnitCostMinor = 10000;
const ingredientQuantity = { value: 125, scale: 2, unit: 'kilogram' };
expect(recipe.costMinor).toBe(12500);
expect(basis).toMatchObject({
  basis: 'manual_initial', unitCostMinor: 10000,
  receiptCount: 0, receiptLineCount: 0,
  lowestUnitCostMinor: null, highestUnitCostMinor: null,
});
expect(basis.receivedQuantity.value).toBe(0);
```

- [ ] Run the focused tests and record expected failures. New fields should be rejected or absent, and manual costs must not yet appear.
- [ ] Add the nullable column with a rerunnable constraint inside a transaction:

```sql
alter table merchant.inventory_item
  add column if not exists initial_unit_cost_minor bigint;
do $$
begin
  if not exists (select 1 from pg_constraint
      where conrelid='merchant.inventory_item'::regclass
        and conname='inventory_item_initial_unit_cost_ck') then
    alter table merchant.inventory_item
      add constraint inventory_item_initial_unit_cost_ck
      check (initial_unit_cost_minor is null or
        initial_unit_cost_minor between 0 and 9007199254740991);
  end if;
end;
$$;
```

- [ ] Apply the new migration twice to a populated synthetic database. Confirm old rows retain null and stock balances do not change. Add it to both existing CI migration application paths.
- [ ] Extend existing create/update commands atomically. Preserve omitted update values and clear only explicit null. Use existing version and ownership checks. Audit the actor and the changed initial amount in the same transaction. Correct the touched private item update DTO annotation if needed; do not refactor unrelated commands.
- [ ] Extend item selects/hydration and the costed item filter. Preserve safe numeric conversion and server authority.
- [ ] Add initial amounts to the existing cost repository item rows. Use one consistent precedence rule across cost basis, plates, days, low-stock values, and legacy recipe cost fallback:

```ts
const unitCostMinor = receiptAverage?.unitCostMinor ?? initialUnitCostMinor;
// A zero receipt average takes priority. Check null/undefined, not truthiness.
```

- [ ] Preserve actual receipt facts. Never make a manual amount into a synthetic bucket with invented quantity. `manual_initial` has zero receipt counts/quantity and null receipt min/max.
- [ ] Verify a changed initial amount of 12000 makes the current recipe cost 15000. Stock entries and balances remain unchanged. Existing recipe history snapshots remain unchanged.
- [ ] Receive 1 kg at 14000 and 3 kg at 10000 through real procurement service calls. Assert active basis 11000 and recipe cost 13750, regardless of the saved initial amount. Assert real receipt counts and quantities.
- [ ] Cover absent/null/zero updates, invalid money, stale versions, replay, permissions, cross-merchant reads/writes, and nested recipe precedence. Prove stored explicit zero differs from missing cost.
- [ ] Assert the same cost in item filters, authoring recipes, plate/day/value reads, and the legacy history path. Existing cost integration can provide service/receipt fixtures; do not duplicate arithmetic in expected values.
- [ ] Add the new integration to the schema allowlist. Run focused integration, affected unit/contract checks, lint/type checks, and generator drift. Validate generated TypeScript and Dart. Record red/green and migration evidence. Commit the task.

### Task 2: Initial cost field and visible cost source

**Files:**

- Modify `apps/umi-dashboard/src/screens/inventory-item-editor.jsx`, `inventory-item-editor-model.js`, and its tests.
- Modify `apps/umi-dashboard/src/screens/inventory-workspace.jsx`, `inventory-item-panel.jsx`, and touched tests.
- Modify `apps/umi-dashboard/src/screens/inventory-costing.jsx` and `recipe-workspace.jsx` for accurate source copy.
- Reuse `useInventoryCostBasis` from `apps/umi-dashboard/src/data.jsx`; change the data layer only if the existing hook needs a scoped adjustment.
- Update English/Spanish catalogs with Lingui tools.
- Add a focused browser regression under `apps/umi-dashboard/e2e/` and a verification report at `docs/reports/2026-10-30-inventory-initial-cost.md`.

**Interfaces:**

- Consume item `initialUnitCostMinor` and cost basis `manual_initial` from Task 1.
- `parseInitialCost(text)` returns `{ valid: boolean, value: number | null }`. Empty is valid null; invalid input is false/null.
- Keep item create/update under the existing administrative command hook.
- Use `useInventoryCostBasis(refresh)` to show the actual active source. It already requests `includeWithoutReceipts=true`.

- [ ] Write exact money input and submission regressions before implementation:

```js
expect(parseInitialCost('100.25')).toEqual({ valid: true, value: 10025 });
expect(parseInitialCost('100,25')).toEqual({ valid: true, value: 10025 });
expect(parseInitialCost('')).toEqual({ valid: true, value: null });
expect(parseInitialCost('0')).toEqual({ valid: true, value: 0 });
for (const text of ['-1', '1e3', '1.001', '90071992547409.92']) {
  expect(parseInitialCost(text)).toEqual({ valid: false, value: null });
}
```

- [ ] Run the focused tests and record expected failures. Then implement decimal-string-to-centavos parsing with BigInt bounds or an existing exact helper. Do not use `parseFloat(text) * 100`.
- [ ] Add the optional field to the current item dialog. Show `Costo inicial por {unidad}` and the currency. Use `Se usa mientras no haya compras registradas.` as the hint. Saving a new/edit item sends the amount; cancel does not write. Empty input sends null only when clearing or creating.
- [ ] Preserve unchanged initial values on unrelated edits. Keep validation and API errors visible. Preserve draft and command identity for retries; do not suppress existing command recovery.
- [ ] Load actual source data through the existing cost basis hook. Show `Costo inicial`, `Calculado con compras`, or `Sin costo` in the item panel and cost report. When receipts take priority, show the active purchase amount and explain that the saved initial amount does not override it. A loading failure is not evidence of missing cost.
- [ ] Route an uncosted item's `Agregar costo` action to its existing editor. Keep the full cost report available through its existing navigation.
- [ ] Update touched recipe guidance to allow either an initial cost or a purchase. Use `artículo` for inventory records and `ingrediente` in recipes. Remove claims that a purchase is always required for a cost.
- [ ] Run real Chromium flows on isolated initial-cost services. Create an item with 100.00 per kg, edit to 120.00, cancel another edit, clear the cost, and verify explicit zero. Reject invalid values visibly. Verify unchanged saves preserve costs.
- [ ] Use real persisted reads after clicks. Verify a recipe with 1.25 kg changes from 125.00 to 150.00. Seed received purchases via real service/API fixtures, reload, and verify the source switches to purchases at 110.00 per kg and recipe 137.50. Do not replace these claims with intercepted-only responses.
- [ ] Inspect desktop and mobile screenshots. Confirm aligned controls, visible unit/source, and reachable Save/Cancel. Run dashboard suite/build/lint once after final changes and commit with evidence.
- [ ] The controller runs final PR gates, fresh schema tests, final branch review, and opens the separate stacked PR. Leave approval pending.
