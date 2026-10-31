# Inventory initial cost design

The user approved manual initial costs after the existing purchase cost behavior was explained.
Implement this after recipe-sales phase 2, in a separate branch and PR. Keep every new PR open for approval. PR #232 was merged externally on 2026-10-30.

## Behavior

- Add an optional initial cost to the existing item create/edit form. The amount applies to one whole base unit.
- Show the unit in the label, such as `Costo inicial por kg`, and the merchant currency with the amount.
- Use the initial cost when the item has no received purchase lines. Once receipts exist, use their existing quantity-weighted average.
- Distinguish `Costo inicial`, `Calculado con compras`, and `Sin costo`. Never represent an absent amount as zero.
- A deliberate zero is allowed; negative, fractional-cent, and unsafe amounts are refused.
- Existing items start with a null initial cost. Their stock and purchase history remain unchanged.
- Editing a cost uses the existing versioned administrative command and audit history. No purchase or stock movement is fabricated.
- Preserve recipe expansion: an intermediate recipe takes its cost from its ingredients. An initial cost does not override an active subrecipe.
- Current recipe costs, plate costs, inventory values, daily cost reads, and low-stock values must use the same fallback rule.
- Preserve saved historical recipe cost snapshots. Existing reports that revalue history at the current basis retain that documented limitation.

## Storage and contract

Use the existing inventory item owner. Add nullable `initial_unit_cost_minor bigint` with a safe, nonnegative bound.
Use a new forward migration at `supabase/migrations/20261030010000_inventory_initial_cost.sql`.
Do not edit applied numbered SQL. Add this migration to the existing fresh/populated CI application paths, including the second application.
Add optional nullable `initialUnitCostMinor` to item create/update requests and nullable read data.
Missing update fields preserve the stored amount; null explicitly clears it.
Add `manual_initial` to `CostBasisKind`. Retain receipt counts, received quantities, and receipt price ranges as actual receipt facts.
A manual basis has zero receipt counts, zero received quantity, and null receipt price ranges.
Keep `includeWithoutReceipts` semantics explicit: false still filters by actual receipts; true includes manual and missing bases.
Update the authoring `includeItemsWithoutCost` filter to treat a non-null initial amount, including zero, as a known cost.
Bump the contract after phase 2 and regenerate TypeScript, Dart, JSON, and checksum using repository tools.

## UI

Use the current item dialog and Save/Cancel flow. Explain: `Se usa mientras no haya compras registradas.`
When purchases supply the active cost, show their source and explain that they take priority over the saved initial amount.
Keep the saved initial value available for inspection; prevent the UI from suggesting that it overrides purchased costs.
Use exact decimal parsing to integer centavos. Do not use binary floating-point multiplication for money.
Replace touched recipe/costing copy that claims all costs require a purchase. Keep wording short and use `artículo` or `ingrediente`.
Use `Agregar costo` from an uncosted item to open its existing editor when feasible; the full cost report remains available.

## Verification

Backend acceptance must use real administrative commands and PostgreSQL.
An ingredient at 10000 centavos per kg costs 12500 centavos for 1.25 kg.
Changing its initial cost to 12000 updates that current recipe cost to 15000 without changing stock.
Receive 1 kg at 14000 and 3 kg at 10000: the active cost becomes 11000 per kg, regardless of initial cost.
The 1.25 kg recipe then costs 13750. Receipt counts and totals must remain actual facts.
Cover clear/absent/zero, invalid amounts, version conflicts, replay, permissions, and cross-merchant isolation.
Cover source and calculations in item lists, recipe reads, plate/day/value reads, and legacy history fallback.
Apply the migration twice to populated synthetic local data, then verify fresh schema construction and required database checks.
Drive create, edit, clear, cancel, validation, and recipe cost updates with real Chromium clicks.
Capture desktop/mobile layouts and verify both Save and Cancel are reachable.

## Execution boundaries

Planned branch: `feat/inventory-initial-cost`. Worktree: `/private/tmp/umi-inventory-initial-cost-20261030`.
Base it on the reviewed recipe-sales branch after that PR is opened.
Use separate local databases and ports. Preserve phase 1 and phase 2 previews.
Implement backend/contract/migration first, then dashboard. One implementer at a time, review each task.
Run final local PR gates and an independent whole-branch review before publication.
Do not merge, enable auto-merge, deploy production, or send notifications.

## Primary documentation and setup

PostgreSQL 17 documentation states that a new nullable column without a default gives existing rows null.
Source: https://www.postgresql.org/docs/17/ddl-alter.html.
Umi-specific inference: a nullable initial cost preserves existing purchase-based costs and requires no invented price backfill.
The separate worktree and pristine local databases are prepared. See `/private/tmp/umi-inventory-initial-cost-setup.md`.
Before implementation, fast-forward the still-clean branch to the final reviewed phase 2 head.
The initial-cost databases were cloned before the phase 2 approval migration. Apply that final migration before the new cost migration.
