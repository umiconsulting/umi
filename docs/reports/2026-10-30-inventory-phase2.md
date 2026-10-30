# Inventory phase 2: recipe sales and confirmed return restock

Date: 2026-10-30. All checks used a disposable local PostgreSQL database.
Phase 1 PR #232 merged externally. The phase 2 PR must stay open for approval.

## Result

The new integration suite proves authored recipes through the real cart, cash, checkout, refund, and inventory services.
Each scenario creates a separate merchant, device, operator session, product, ingredient, and recipe.
Administrative commands create, update, and retire the recipes.
The fixtures create products before their recipes and assert that no prior catalog mapping exists.
The fixtures use the stock ledger function for opening stock. They never insert a committed sale.

The tests exposed three checkout defects:

- An active reservation acquired a second mapping after a recipe edit.
- The approval check used current recipe quantities and counted the reservation's own stock hold twice.
- The sale commit function omitted the consumed approval proof for negative stock.

The checkout repository now reuses the quantities and identities of an active reservation with the same cart version.
Its approval query uses those captured quantities and excludes their existing stock hold from the shortage calculation.
The forward migration preserves the existing SQL interface and passes the consumed approval proof to the ledger.
The grant must match the command, merchant, location, permission, method, and reservation fingerprint.
The ledger keeps its existing approval checks.

## Measured quantities

All ingredient quantities use kilograms with scale 2. Values below are scaled integers.

| Scenario                    | Ledger and balance evidence                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original sale               | Recipe value 125 per portion. Two portions consume 250. Opening 1000 becomes 750.                                                                   |
| Recipe edit                 | Recipe value becomes 200. A later one-portion sale consumes 200. Balance becomes 550.                                                               |
| Original refund             | Refund replay creates one compensation. The stock balance stays 550 until approved physical disposition.                                            |
| Confirmed restock           | The inventory review exposes the original component maximum of 250. The test submits those returned identities and quantities. Balance becomes 800. |
| History                     | Original sale ledger keeps its original mapping and recipe IDs at version 1. The later sale uses new IDs at version 2.                              |
| Checkout and restock replay | Each original command returns its prior result. No second consumption or restock entry appears.                                                     |
| Block policy                | Stock 100 cannot satisfy 125. Checkout returns `NEGATIVE_STOCK_BLOCKED`. No reservation or sale ledger row remains.                                 |
| Manager policy              | Stock 100 requires approval for 125. A valid consumed grant permits one sale and leaves balance -25. Replay adds no consumption.                    |
| Allow policy                | `allow_and_flag` permits the same sale without approval and leaves balance -25. Replay adds no consumption.                                         |
| Variant selection           | An exact variant consumes 200. An inherited variant consumes 125. After exact recipe retirement, that variant consumes the product fallback of 125. |
| Retirement without fallback | Checkout returns `INVENTORY_MAPPING_REQUIRED`. Stock stays 1000. No zero-consumption sale occurs.                                                   |
| Captured reservation        | Stock 300 holds 250. After the recipe changes to 200 per portion, checkout still consumes the captured 250 once. Final stock is 50.                 |

## Verification

Tools: Node 22.23.3, pnpm 10.29.3, Vitest 2.1.9, PostgreSQL 17, TypeScript, ESLint, and Prettier.
The existing integration configuration and `pos-offline.integration.ts` supplied the fixture pattern.
The local verification playbook supplied the verification rules.

- Focused recipe suite: 7/7 passed.
- Affected integration suites: 93/93 passed across six files in 2.84 seconds.
- API `tsc --noEmit`: exit 0.
- ESLint for the new suite and checkout repository: exit 0, zero warnings.
- Prettier for changed TypeScript, JSON, and workflow files: passed.
- Forward migration: applied twice to the local phase 2 database, both times with exit 0.

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

These checks exercise real backend services and PostgreSQL. They do not prove native POS or dashboard interactions.
Refund money compensation and physical restock are separate operations. Recipe components require explicit approved disposition.
The reservation regression covers active, unexpired reservations. It does not cover recreation after release or expiry.
The tests do not repair reservations that already contain duplicate historical mappings.
The migration preserves the ledger's existing guards; this suite does not test every forged grant combination.
The controller owns fresh-schema verification, complete build and unit gates, and final review.
No production migration, deployment, push, merge, or notification occurred in this task.
