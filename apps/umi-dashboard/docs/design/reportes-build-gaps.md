# Reportes — Build-Gap Map (CodeGraph, ground-up)

What each item in [`reportes-ia-plan.md`](./reportes-ia-plan.md) actually needs in code
— SQL, backend, contract, frontend — mapped against the current tree with CodeGraph
(index synced 2026-09-13). Legend: **exists** / **new SQL** / **new backend** /
**contract** / **frontend** / **schema**.

Key files: API `apps/umi-api/src/modules/dashboard-operations/{controller,service,repository}.ts`;
contract `packages/contract/src/dashboard-operations.ts`; LLM `apps/umi-api/src/shared/adapters/llm-completion.ts`;
AI pattern `apps/umi-api/src/modules/customers/customers.service.ts`; dashboard hooks
`apps/umi-dashboard/src/data.jsx`; screens `apps/umi-dashboard/src/screens/*.jsx`.

## Corrections CodeGraph surfaced (vs. the plan's assumptions)

1. **Channel tagging already exists in the live pipeline.** `createOrder` sets
   `source:'whatsapp'` (`conversations/orders.repository.ts:129`); `order-location.resolver.ts`
   resolves `location_id` (channel / sole / selection). The untagged Kalala rows are
   **migrated legacy history** (Gap 9), not a pipeline failure. → Decision #4 is
   **backfill legacy + wire into reporting**, not "build tagging."
2. **The channel row is a read-model unification, not a GROUP BY.** `salesSummary`
   reads `FROM merchant.pos_committed_sale` only (`repository.ts:417`); most WhatsApp
   orders never get a `pos_committed_sale` (Gap 9: 68 orders → 10 committed). WhatsApp/
   web revenue is **invisible to Ventas today**. The wedge needs POS
   (`pos_committed_sale`+`receipt_snapshot`) and non-POS (`customer_order`+`order_total`/
   `payment`) unified by channel.
3. **Reuse existing UI primitives:** `NarrativeRow` + `StateDot`
   (`operations-workspace.jsx:1540/1460`) already render tone/subject/meta rows across
   all five operations views — the natural host for the AI narrative and state rows.
4. **A merchant-level LLM precedent exists:** `customers.service.ts:625 insights()`,
   alongside the per-customer `describe()` — check both before cloning.

## AI narrative endpoint — Phase 1 — SMALL (~2–4 days, no data dependency)

- **Exists:** `LLM_COMPLETION` choke (`llm-completion.ts:29`) → `LlmCompletionProvider.createCompletion`,
  DeepSeek adapter bound by `LLM_PROVIDER` (decision #5 = config flip). The clone
  template `describe()` (`customers.service.ts:399`): `@Inject(LLM_COMPLETION)` (`:128`),
  djb2 `fingerprintPortrait` (`:108`), 6h in-memory cache (`:442`), `createCompletion`
  (`:449`), fail-safe (`generated:false`). `salesSummary` (`repository.ts:355`) already
  returns the facts to narrate.
- **Build:** `salesInsight()` in service+repository mirroring `describe()` — feed
  `salesSummary` output as compact JSON → `this.llm.createCompletion` → fingerprint+6h
  cache → fail-safe null. **new backend** only.
- **Contract:** `ReportsSalesInsight` type; **new route** `GET /operations/reports/sales/insight`.
- **Frontend:** `useSalesInsight` hook (`data.jsx`, mirror `useCustomerDescription`);
  render in `NarrativeRow` / a card in `ventas-report.jsx`.
- **SQL:** none new.

## Channel split (POS · WhatsApp · Delivery) — Phase 1 — MEDIUM (the wedge)

- **Exists:** `customer_order.source` is tagged; `salesSummary` is POS-only
  (`repository.ts:417`).
- **New SQL (the lift):** a **unified revenue aggregate** grouped by channel. Decide
  the canonical revenue source per channel — POS via `pos_committed_sale.receipt_snapshot.grand_total`;
  non-POS (WhatsApp/web) via `customer_order` + `merchant.order_total`/`payment`. Either
  a `UNION ALL` in the query or a new unified `merchant`-schema view.
- **Data:** backfill/exclude legacy migrated `customer_order` rows with `location_id IS NULL`.
- **Contract/frontend:** add `channelMix` to `ReportsSalesSummary`; channel row in
  `ventas-report.jsx` (reuse `PaymentMix` stacked-bar shape).
- **Delivery** sub-channel (Rappi/UberEats/DiDi): confirm whether those land as a
  `customer_order.source` value or a separate path → likely Phase 3.

## IVA / impuestos breakdown — Phase 2 — SMALL SQL

- **Exists:** tax is stored (`receipt_snapshot.snapshot->'tax'->>'total'`, `tax.entries[]`,
  `pos_cart_line.tax_rate_basis_points`) but `salesSummary` reads only
  `snapshot->'tip'` (`repository.ts:428`), never tax.
- **New SQL:** aggregate `snapshot->'tax'` over the range (16% / 0% / exento; IEPS).
- **Data:** seed real `tax_rate_basis_points` on products (all 0 today) — until then,
  render the **"needs data"** state, never `$0`.

## Net-of-refunds — Phase 2 — SMALL SQL

- **Exists:** `salesSummary` "net" = `sum(grand_total)` (`repository.ts:426`); refunds
  live append-only in `pos_sale_exception` (`repository.ts:322`).
- **New SQL:** subtract `sum(pos_sale_exception.total_minor_units)` over the range; add a
  true `netOfRefunds` field. Unify the two refund ledgers (`pos_sale_exception` +
  `merchant.refund`) in the read model.

## Reembolsos period aggregate — Phase 2 — SMALL

- **Exists:** `refunds_voids` is a **paginated list** (`repository.ts:136`; generic path
  `LIMIT+OFFSET` `:251`), capped 50; "Por operador" is computed client-side.
- **New SQL + backend:** aggregate over `pos_sale_exception` grouped by operator / type /
  reason across a range; new endpoint (or extend `/reports`). Anomaly flags per cashier.

## Export (CSV / contador) — Phase 2 — MEDIUM

- **Exists:** nothing (no CSV/PDF anywhere).
- **New backend:** server-side CSV endpoint(s) per report; the **contador month-end
  fiscal export** (CFDI/global status + IVA). Stream; respect RLS. PDF later.

## Cross-location roll-up — Phase 2 — SMALL/MEDIUM

- **Exists:** location filter is a single optional param (`repository.ts:416`
  `$4 IS NULL OR s.location_id=$4`); RLS already returns all branches when `locationId`
  is omitted (Gap 8). No `GROUP BY location`.
- **New SQL:** a by-location aggregate (`GROUP BY s.location_id`), rows tagged by
  branch. **No RLS/schema change.** Frontend branch breakdown.

## Menu quadrant — Phase 3 — MEDIUM

- **Exists:** product mix (`repository.ts:477`, `GROUP BY cl.product_id`). **No COGS.**
- **Build:** popularity × **retention** quadrant first (join product sales to
  repeat-customer / Customer-360 data — no COGS needed). CM axis deferred to COGS.

## Delivery consolidation — Phase 3 — LARGE

- Confirm the ingestion path for Rappi/UberEats/DiDi; margin-after-commission needs
  commission fields. Likely new ingestion + schema. (Umi already ingests Rappi at Kalala.)

## COGS / margin — Phase 3 — LARGE (schema)

- **Exists:** no cost columns; inventory tracks quantities only (`36_pos_inventory.sql`).
- **Schema:** add a cost dimension to `inventory_item`/`stock_ledger_entry`; recipe-cost
  rollup; then contribution margin + true prime cost.

## Cross-cutting plumbing (every new endpoint)

- **Contract:** add Zod query/response types in `packages/contract/src/dashboard-operations.ts`.
- **Backend:** `dashboard-operations.{controller,service,repository}.ts`; RLS via
  `runWithMerchant`; run `nest start --watch` (stale `dist/main` 404s new routes).
- **Frontend:** `data.jsx` `_useAsync` hooks; screens; **Lingui** strings (error-gate);
  reuse the shared KPI, `.badge-*`, `.seg`/`.hub-tabs`, `NarrativeRow`/`StateDot`, and
  the `ventas-report.jsx` chart trio (see `reportes-design-system.md`).
- **No materialized views today** — every report is live aggregation; cross-location
  and wide windows may later need a rollup table.

## Effort ladder (grounded)

1. **AI narrative endpoint** — small, no data dep → **start here.**
2. **Net-of-refunds, IVA, cross-location, Reembolsos aggregate** — small SQL additions.
3. **Channel split** — medium: the two-sale-world unification is the real work + legacy backfill.
4. **Export** — medium: new endpoints, no precedent.
5. **Menu quadrant (retention)** — medium.
6. **Delivery consolidation, COGS** — large: ingestion / schema.
