# Umi's current purchase-order state, with a line number for every claim

- Date: 2026-09-18
- Tool: CodeGraph 0.x at `/home/jc/.local/bin/codegraph` (`codegraph context`,
  `codegraph query`), plus `rg` over `apps/`, `packages/` and `tools/`.
- Branch read: `feat/inventory-workbench-and-design-system` at `2031476`.

This section does not restate
[2026-09-18-purchase-orders-gap.md](../../2026-09-18-purchase-orders-gap.md). It
confirms that file against the current branch, adds the parts it did not cover,
and states the shape of the product surface as it stands today.

## 1. The data model is complete, and it is deeper than "an order"

**Documented fact.** `docs/migration/build-v3/69_procurement.sql` creates five
tables: `merchant.supplier`, `merchant.purchase_order`,
`merchant.purchase_order_line`, `merchant.purchase_order_receipt`, and
`merchant.purchase_order_receipt_line`.

**Documented fact.** The file states the stock consequence of each transition in
its own header:

| Transition | Ledger entry type          | Stock effect                                  |
| ---------- | -------------------------- | --------------------------------------------- |
| send       | `purchase_ordered`         | `in_transit` + ordered                        |
| receive    | `purchase_received`        | `on_hand` + received, `in_transit` − received |
| cancel     | `purchase_order_cancelled` | `in_transit` − outstanding                    |

Source: `docs/migration/build-v3/69_procurement.sql:20` to `:24`.

**Documented fact.** The invariant `received_quantity <= ordered_quantity` is a
SQL `CHECK`, not only an API rule. Source: `69_procurement.sql:37`.

**Documented fact.** The supplier invoice is a separate pair of tables,
`merchant.supplier_invoice` and `merchant.supplier_invoice_line`, created in
`docs/migration/build-v3/76_recipes_inventory.sql:510` and `:592`. The invoice
carries a `cfdi_uuid` with a unique index per merchant —
`76_recipes_inventory.sql:572` — so a Mexican CFDI cannot be captured twice.

**Inference.** Umi therefore already holds the three documents a three-way match
needs: the order, the receipt, and the invoice. The match itself is not named
anywhere in the repo.

## 2. The API is complete, and it is console-only

**Documented fact.** Nine routes exist: `supplierList`, `supplierCreate`,
`supplierUpdate`, `purchaseOrderList`, `purchaseOrderGet`, `purchaseOrderCreate`,
`purchaseOrderSend`, `purchaseOrderReceive`, `purchaseOrderCancel`. Sources:
`packages/contract/src/route-table.ts:353`, `:373`, `:398`, `:424`, `:444`,
`:464`, `:492`, `:519`, `:549`.

**Documented fact.** Every one carries `permission: 'merchant.manage'` and
`auth: 'session'`. Every one carries `dart: null`, so no route here is bound for
the native POS client. Same lines.

**Source-backed tradeoff.** The single `merchant.manage` gate is a real
placement decision, stated in the same file at `:680`: the READ routes stay on
`merchant.manage` because "an `inventory.*` key is carried only by POS operator
sessions", which would make the console unreachable. The cost is that raising a
purchase order cannot be given to a store manager who does not hold full
`merchant.manage`.

**Documented fact.** The domain rules are real, not placeholders:
`procurement-domain.ts:116` refuses an over-receipt, and `:72` refuses a line
total that disagrees with unit cost × quantity beyond a rounding step.

**Documented fact.** `procurement.service.ts:529` commits a supplier invoice
through the same receipt path, so the invoice and the receipt are one mechanism.

## 3. The product surface does not exist

**Documented fact.** A repository-wide search finds no caller for
`purchaseOrderCreate`, `purchaseOrderSend`, `purchaseOrderCancel`,
`supplierCreate`, or `supplierUpdate` outside `packages/contract` itself. The
only non-contract references are in the prior research file. Verified on this
branch with `rg` across `apps/`, `packages/`, and `tools/`.

**Documented fact.** The dashboard calls exactly one procurement route:
`procurement.purchaseOrderList` at `apps/umi-dashboard/src/data.jsx:2489`. It
filters the answer to the two still-open statuses at `:2496`.

**Documented fact.** The `Compras` tab exists and holds only the invoice inbox.
The tab list reads `{ id: 'purchases', route: 'compras', label: msg\`Compras\` }`at`apps/umi-dashboard/src/screens/inventory-hub.jsx:43`, and the body renders
`<InvoiceInbox />`at`:67`.

**Inference, and it is the sharpest naming defect.** A tab named "Compras"
(purchases) that contains no purchase order is a label that promises a screen
that is not there.

## 4. The invoice inbox has a dead end

**Documented fact.** `apps/umi-dashboard/src/screens/invoice-model.js:190`
returns `state: 'no_order'` when no purchase order is attached.

**Documented fact.** `apps/umi-dashboard/src/screens/invoice-inbox.jsx:312`
builds the commit command with `purchaseOrderId: order.id`, and the commit is
disabled while the state is not `ready`.

**Inference.** On a shop that has never raised a purchase order, a supplier
invoice uploads, matches its lines, and stops. Nothing in the product can move it
forward.

## 5. The inputs for a shortage-driven order already exist

**Documented fact.** The contract carries `parQuantity` on an item at
`packages/contract/src/recipes.ts:261` and
`packages/contract/src/inventory-costing.ts:527`.

**Documented fact.** The contract carries `lowStockThreshold` at
`packages/contract/src/recipes.ts:256` and
`packages/contract/src/inventory-costing.ts:346`.

**Documented fact.** A read route computes the shortage directly:
`inventoryCosting.lowStock` at `packages/contract/src/route-table.ts:643`, and
its item model carries `belowThreshold`, `dailyRateQuantity` and `daysOfCover`
at `packages/contract/src/inventory-costing.ts:346`, `:350`, `:352`.

**Inference.** Umi can already answer "what will run out, and when" before a
person asks. The purchase-order screen can be built on a signal the platform
already computes, and it does not need new inventory math.

## 6. What the seeded rehearsal data says

**Documented fact.** The prior pass measured 102 suppliers, 688 purchase orders,
721 order lines, and 477 receipts in the rehearsal branch
`umi_transition_rehearsal_20260901`, across all five statuses. Source:
[2026-09-18-purchase-orders-gap.md](../../2026-09-18-purchase-orders-gap.md),
section "What the research says the screen must do".

## 7. The gap, in one sentence

**Inference.** Umi carries the whole purchase-order model and the supplier
invoice behind it, and exposes neither as a workflow: a merchant can upload a
supplier invoice, but cannot raise the order it belongs to.
