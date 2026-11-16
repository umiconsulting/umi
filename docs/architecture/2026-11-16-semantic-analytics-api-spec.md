# Semantic analytics API — specification v1.3

**Status:** ACCEPTED at `dd46278d` (2026-11-16). Gate 3 merged at this base. This version adds the typed fact and denominator metadata. Do not append an addendum.
**Date:** 2026-11-16, America/Mazatlan.
**Owners:** Juan Lopez (decision). umi-lead (delivery). umi-builder (implementation). umi-verifier (verdict). umi-scribe (contract text).
**Versions:** document `1.3`. API contract `2.58.0`. Metric definition `1.0.0`.
**Supersedes:** the accepted v1.2 at `dd46278d` (632 lines, SHA-256 `64872de9c481120ce1c8f3ef6e8302a7800f403bcd83db1a88e0f5bfed0e4302`), the accepted v1.1 at `f81d983a` (562 lines, SHA-256 `f7918b4c7b3777db40064ed966c1079bdfb5792608e8467f261ce252e744a399`), the 2026-11-15 draft at the read-only task path (146 lines, SHA-256 `46d10680c189f24f83a2fd3521efc3594c670de8b76ced5240060a93d468665f`), and the gate-1 amended copy at `.scribe/2026-11-16-semantic-api-gate1/SPEC.md` (371 lines, SHA-256 `fab82df818302ef0eeb4d6bb6f4d54ebf51e61ae8cbc25bbc6e257b3d5e62a19`).
**Sources:** `CHIEF-REVIEW.md` (2026-11-16, 03:22 UTC); `.gate1-contract.md` at head `750c9bfe`; `docs/verification/2026-11-16-semantic-api-gate1.md`; `docs/architecture/2026-11-16-semantic-analytics-api-spec.md` at `f81d983a`; `packages/contract/src/metrics.ts`; `packages/contract/src/route-table.ts`; `apps/umi-api/src/modules/metrics/*`.

---

## 1. Purpose

This document defines one contract for the semantic analytics read. It replaces the proposal and its addendum with one text. It has no section that overrides another section.

A reader must find one answer for each rule. The rules cover the route, the permission, and the metric set. They also cover the dimensions, the formulas, and the zero and null cases. The refunds, the truncation, and the parity bar are in the same list. Section 21 records each old conflict and the reason for its resolution.

## 2. Problem

The sales definitions live as duplicate SQL in `apps/umi-api/src/modules/dashboard-operations/dashboard-operations.repository.ts`. The summary (`salesSummary`) and the fact list (`QUERIES.sales`) compute discounts, tips, and merchandise with different joins. The same concept appears again in Cash, in the purchase analysis, and in the exports. No metric catalogue exists. No definition has a version.

The consequence is not theoretical. `I1-MET-06` reported a zero discount because one query read an empty table and the other read the receipt.

## 3. Principles

1. One definition for each metric. The definition has a version and a test.
2. The client names metrics and dimensions. The server names the SQL. There is no parser and no optimizer.
3. The first definition is the number that the current code calculates. The catalogue documents it. It does not reinvent it.
4. Every response declares its context: period, location, currency, coverage, freshness, and definition version.

## 4. Versions

| Version | Owner | Value | Scope |
| --- | --- | --- | --- |
| Document | this file | `1.3` | The acceptance text |
| API contract | `packages/contract/src/catalog.ts` | `2.58.0` | The `CONTRACT_VERSION` constant and the generated contract |
| Metric definition | `metrics.catalog.ts`, `metrics.ts` | `1.0.0` | The formula text and the `definitionVersion` field |

A change to a formula needs a new definition version. A change to a schema or a contract shape needs a new contract version. A change to a rule in this document needs a new document version.

## 5. Route

```
POST /api/merchants/:merchantId/metrics/query
POST /api/merchants/:merchantId/metrics/insight
```

- The controller is `@Controller('api/merchants/:merchantId/metrics')` in `apps/umi-api/src/modules/metrics/metrics.controller.ts`.
- `@Post('query')` serves the metric query. `@Post('insight')` serves the narrative.
- There is no `/v1` segment. The `/api` prefix is the controller convention.
- The route table has two entries: `metrics.query` and `metrics.insight`. Do not add a third entry.

### 5.1 Query route

| Field | Value |
| --- | --- |
| `id` | `metrics.query` |
| `method` | `POST` |
| `path` | `/api/merchants/:merchantId/metrics/query` |
| `params` | `['merchantId']` |
| `dart` | `null` |
| `contract.request` | `MetricsQuery` |
| `contract.response` | `MetricsResponse` |
| `contract.auth` | `session` |
| `contract.permission` | `sale.lifecycle` |
| `contract.idempotent` | `false` |
| `contract.merchantContext` | `true` |
| `contract.locationContext` | `true` |
| `contract.offline` | `false` |
| `contract.pin` | `false` |
| `contract.approval` | `false` |
| `contract.errors` | `['VALIDATION_FAILED', 'PERMISSION_DENIED', 'LOCATION_SCOPE_VIOLATION']` |

`MetricsQuery` and `MetricsResponse` are registered in `modelCatalog`.

### 5.2 Insight route

| Field | Value |
| --- | --- |
| `id` | `metrics.insight` |
| `method` | `POST` |
| `path` | `/api/merchants/:merchantId/metrics/insight` |
| `params` | `['merchantId']` |
| `dart` | `null` |
| `contract.request` | `MetricsInsightQuery` |
| `contract.response` | `MetricsInsightResponse` |
| `contract.auth` | `session` |
| `contract.permission` | `sale.lifecycle` |
| `contract.idempotent` | `false` |
| `contract.merchantContext` | `true` |
| `contract.locationContext` | `true` |
| `contract.offline` | `false` |
| `contract.pin` | `false` |
| `contract.approval` | `false` |
| `contract.errors` | `['VALIDATION_FAILED', 'PERMISSION_DENIED', 'LOCATION_SCOPE_VIOLATION']` |

`MetricsInsightQuery` and `MetricsInsightResponse` are registered in `modelCatalog`. The generated contract matches `2.58.0`.

## 6. Request

### 6.1 Query request

```json
{
  "metrics": ["net_sales", "orders", "average_ticket"],
  "dimensions": ["day"],
  "range": "last_7_days",
  "locationId": "uuid-opcional",
  "limit": 100
}
```

| Field | Type | Rule |
| --- | --- | --- |
| `metrics` | string[] | 1 to 10 unique ids from the catalogue. Required. |
| `dimensions` | string[] | 0 to 2 unique ids from the six dimensions. Omitted means `[]`. |
| `range` | string | One of `today`, `yesterday`, `last_7_days`, `last_30_days`. Required. |
| `locationId` | uuid | Optional. A null value is a 400, because it is not a uuid. |
| `limit` | integer | 1 to 1000. Default 100. Valid only with at least one dimension. |

The object is strict. An unknown key is a 400.

All validation failures return `VALIDATION_FAILED` with `fieldErrors`. The route adds no error code for validation.

| Condition | `fieldErrors` path |
| --- | --- |
| Unknown or duplicate metric, or length 0 or more than 10 | `metrics` |
| Unknown or duplicate dimension, or length more than 2 | `dimensions` |
| A preset with any dimension | `dimensions` |
| A metric at a dimension that its kind forbids | `dimensions` |
| `limit` with zero dimensions | `limit` |
| `limit` is not an integer, or is outside 1 to 1000 | `limit` |
| `range` is outside the four values, or absent | `range` |
| `locationId` is not a uuid | `locationId` |
| Unknown body key | `$` |

### 6.2 Insight request

```json
{
  "range": "last_7_days",
  "locationId": "uuid-opcional"
}
```

| Field | Type | Rule |
| --- | --- | --- |
| `range` | string | One of `today`, `yesterday`, `last_7_days`, `last_30_days`. Required. |
| `locationId` | uuid | Optional. A null value is a 400, because it is not a uuid. |

The object is strict. It has no `metrics`, no `dimensions`, and no `limit`. An unknown key is a 400. All validation failures return `VALIDATION_FAILED` with `fieldErrors`.

## 7. Authorization and location scope

- Both routes use `sale.lifecycle`. Each service reads the `sales` entry of `DASHBOARD_DOMAIN_POLICY` and calls `hasDashboardPermission` in `apps/umi-api/src/modules/metrics/metrics.service.ts`.
- Do not use `merchant.manage`. Do not add a permission.
- The effective location is `access.locationId ?? query.locationId ?? null`.
- If the scoped location and `query.locationId` differ, return 403 `LOCATION_SCOPE_VIOLATION`.
- Pass the effective location to `runWithMerchant`. The row-level security policy then confines every read.
- Neither endpoint accepts SQL, a table name, or an expression.

## 8. Catalogue

The catalogue has 15 metrics: 9 scalars or derived values, and 6 presets.

### 8.1 The 15 metrics

| id | Kind | Unit | Additive | Accepted dimensions |
| --- | --- | --- | --- | --- |
| `net_sales` | sale | minor units | yes | `day`, `hour`, `channel`, `operator` |
| `orders` | sale | count | yes | `day`, `hour`, `channel`, `operator` |
| `average_ticket` | derived | minor units | no | `day`, `hour`, `channel`, `operator` |
| `items_sold` | line | count | yes | `day`, `hour`, `channel`, `operator`, `category`, `product` |
| `units_per_ticket` | derived | ratio | no | `day`, `hour`, `channel`, `operator` |
| `discounts` | sale | minor units | yes | `day`, `hour`, `channel`, `operator` |
| `tips` | sale | minor units | yes | `day`, `hour`, `channel`, `operator` |
| `prior_net_sales` | period | minor units | yes | none |
| `refunds` | sale | minor units | yes | `day`, `hour`, `channel`, `operator` |
| `payment_mix` | preset | distribution | yes | none |
| `channel_mix` | preset | distribution | yes | none |
| `product_mix` | preset | distribution | yes | none |
| `operator_mix` | preset | distribution | yes | none |
| `hour_mix` | preset | distribution | yes | none |
| `series` | preset | distribution | yes | none |

### 8.2 Compatibility matrix

| Metric | `day` | `hour` | `channel` | `operator` | `category` | `product` |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| `net_sales` | yes | yes | yes | yes | no | no |
| `orders` | yes | yes | yes | yes | no | no |
| `average_ticket` | yes | yes | yes | yes | no | no |
| `items_sold` | yes | yes | yes | yes | yes | yes |
| `units_per_ticket` | yes | yes | yes | yes | no | no |
| `discounts` | yes | yes | yes | yes | no | no |
| `tips` | yes | yes | yes | yes | no | no |
| `prior_net_sales` | no | no | no | no | no | no |
| `refunds` | yes | yes | yes | yes | no | no |
| the 6 presets | no | no | no | no | no | no |

### 8.3 The six presets

A preset accepts no dimension. It appears in `totals.values` only. It never appears in `rows.values`.

| Preset | Item | Total | Cap |
| --- | --- | --- | ---: |
| `payment_mix` | `{ method, amountMinorUnits }` | `{ amountMinorUnits }` | 8 |
| `channel_mix` | `{ channel, netSalesMinorUnits, orders }` | `{ netSalesMinorUnits, orders }` | 8 |
| `product_mix` | `{ productId, productName, category, units, merchandiseMinorUnits }` | `{ units, merchandiseMinorUnits }` | 200 |
| `operator_mix` | `{ operator, units, merchandiseMinorUnits }` | `{ units, merchandiseMinorUnits }` | 100 |
| `hour_mix` | `{ hour, units, merchandiseMinorUnits }` | `{ units, merchandiseMinorUnits }` | 24 |
| `series` | `{ label, netSalesMinorUnits }` | `{ netSalesMinorUnits }` | 31 by day, 24 by hour |

`product_mix` reports merchandise. Merchandise is not net sales. It excludes tips, ticket-level discounts, and taxes, so it does not reconcile with `net_sales`.

### 8.4 Typed fact and denominator metadata

Each of the 15 definitions has three required fields: `includes`, `excludes`, and `denominator`. The fields are typed data. They are not prose.

The policy tokens are one closed `FactPolicy` union of 15 tokens. A definition names only tokens from this union. The tokens are:

`committed_sale`, `uncommitted_sale`, `void_adjustment`, `refund_adjustment`, `uncommitted_exception`, `committed_tender`, `uncommitted_tender`, `customer_value_allocation`, `business_date_window`, `prior_business_date_window`, `captured_at_cutoff`, `location_scope`, `sale_business_date`, `refund_tip`, and `tender_dedupe`.

An excluded adjustment means that the metric does not apply the fact. It does not mean that the sale row is absent. For example, `net_sales` excludes `refund_adjustment`. The sale row is present in `net_sales`. The refund amount is not subtracted.

`average_ticket` and `units_per_ticket` name `orders` as the denominator. The other 13 definitions state `not_applicable`. A denominator names an existing metric. The named metric has no denominator.

The metadata is internal type data. It is not in the response. It does not change SQL, formula, rounding, or the null policy. There is no DSL, interpreter, optimizer, or rule engine.

## 9. Dimensions and caps

### 9.1 The six dimensions

| Dimension | Value |
| --- | --- |
| `day` | `receipt_snapshot.business_date` as `YYYY-MM-DD`. |
| `hour` | The local clock hour of `pos_committed_sale.committed_at` in `merchant.timezone`, as `HH24`. |
| `channel` | `coalesce(pos_committed_sale.origin_channel, 'walk_in')`. |
| `operator` | `coalesce(staff.name, '—')` through `cash_shift`. |
| `category` | The current `product_category.name`. `coalesce(..., '—')` when the product has no category. |
| `product` | `pos_cart_line.product_id` as text. `'—'` when the product id is null. The preset gives the product name. |

Do not derive `day` from `hour`. Do not derive `hour` from `day`.

`payment_method` is not a request dimension. Section 15 is the only path to a payment method.

### 9.2 Caps

| Dimension | Cap |
| --- | ---: |
| `day` | 31 |
| `hour` | 24 |
| `channel` | 8 |
| `operator` | 100 |
| `category` | 100 |
| `product` | 200 |

A dimension query has a row ceiling. The ceiling is the product of the caps of the requested dimensions. One dimension gives its own cap. Two dimensions give the product of the two caps.

The effective row limit is `min(limit, ceiling)`. The default `limit` is 100.

Example: `product` alone has ceiling 200. A request with `limit: 1000` returns at most 200 rows. `day` and `category` have ceiling 3,100, so the same request returns at most 1,000 rows.

The endpoint declares every cap. A cap is not a silent cut: Section 13 gives the fields that report it.

## 10. Formulas

Base set for every sale metric: `merchant.pos_committed_sale s` joined to `merchant.receipt_snapshot r` on `r.id = s.receipt_snapshot_id`. The filter is `s.merchant_id = $1`, `r.business_date BETWEEN $2 AND $3`, and `($4::uuid IS NULL OR s.location_id = $4::uuid)`.

| Metric | Formula |
| --- | --- |
| `net_sales` | `coalesce(sum(r.grand_total), 0)::bigint`. Never `order_total`. |
| `orders` | `count(*)::bigint` over the same committed sales. |
| `average_ticket` | `orders = 0 ? 0 : Math.round(net_sales / orders)`. |
| `items_sold` | `coalesce(sum(cl.quantity), 0)::bigint` with `pos_cart_line cl` on `cl.cart_id = s.cart_id`. |
| `units_per_ticket` | `orders = 0 ? null : items = 0 ? 0 : roundHalfUp(items / orders, 4)`. |
| `discounts` | `coalesce(sum((r.snapshot->'discountTotal'->>'minorUnits')::bigint), 0)`. |
| `tips` | `coalesce(sum((r.snapshot->'tip'->>'minorUnits')::bigint), 0)`. |
| `prior_net_sales` | `net_sales` over the prior window of the same size. |
| `refunds` | See 10.3. |
| `channel_mix` | Group by `coalesce(s.origin_channel, 'walk_in')`. Net is `sum(r.grand_total)`. Orders is `count(*)`. |
| `product_mix` | Group by `cl.product_id`. Name is `min(cl.product_name)`, else `'—'`. Category is `min(pc.name)`, else `null`. Units is `sum(cl.quantity)`. Merchandise is `sum(cl.quantity * (cl.base_price + cl.variant_delta + cl.modifier_total))`. |
| `operator_mix` | Group by `coalesce(st.name, '—')` through `cash_shift` and `staff`. Units and merchandise as in `product_mix`. |
| `hour_mix` | Group by `to_char((s.committed_at AT TIME ZONE merchant.timezone), 'HH24')`. Units and merchandise as in `product_mix`. |
| `series` | A day range groups by `r.business_date`. An hour range groups by the local hour. Net is `sum(r.grand_total)`. |

### 10.1 Windows

Let `d` be the merchant local date. `asOf` is an internal hook for tests. The route never sends it.

| Range | Start | End | Bucket | Prior window |
| --- | --- | --- | --- | --- |
| `today` | `d` | `d` | hour | `d-1` |
| `yesterday` | `d-1` | `d-1` | hour | `d-2` |
| `last_7_days` | `d-6` | `d` | day | `d-13` to `d-7` |
| `last_30_days` | `d-29` | `d` | day | `d-59` to `d-30` |

The prior window has the same size as the current window. The response declares it in `period.comparison`.

### 10.2 Ratio rounding

Round each ratio to 4 decimals, half-up. Use the integer form to avoid binary drift: `floor((items * 20000 + orders) / (2 * orders)) / 10000`.

### 10.3 Refunds

```sql
coalesce(sum(x.total_minor_units - x.tip_minor_units), 0)
FROM merchant.pos_sale_exception x
JOIN merchant.pos_committed_sale s ON s.id = x.sale_id
JOIN merchant.receipt_snapshot r ON r.id = s.receipt_snapshot_id
WHERE x.status = 'committed'
  AND s.merchant_id = $1
  AND r.business_date BETWEEN $2 AND $3
  AND ($4::uuid IS NULL OR s.location_id = $4::uuid)
  AND x.committed_at <= $capturedAt
```

- Include all committed exception types: `void`, `full_refund`, `partial_refund`. The CHECK constraint on `merchant.pos_sale_exception.exception_type` has exactly these three values.
- The amount is `total_minor_units - tip_minor_units`. The tip is not merchandise, so the metric does not return it.
- Attribute the refund to the sale business date `r.business_date`. Do not use the exception date.
- Report the amount as a positive number.
- Keep `refunds` separate from `net_sales`. Do not subtract it. The reader can compare the two numbers.
- `coverage.refundsIncluded` is `true` only when the request names `refunds`.

Gate-1 golden values:

| Fixture | Refunds | Composition |
| --- | ---: | --- |
| A, `sales-analysis-fixture.ts`, window 2026-10-29 to 2026-11-04 | 9,000 | One partial refund on the first sale |
| B, I1 METRIC, same window | 24,000 | 17,000 on 2026-11-02 and 7,000 on 2026-11-04, by sale date |

`total_minor_units` alone returns 26,000 on fixture B. It is not the metric.

Gate 2 uses a separate refunds oracle fixture. It has a void, a full refund, a partial refund, and one refund with a tip above zero. It also has one `outcome_unknown` row and one committed row with a sale date before the window. Both rows stay out of the total. The oracle test pins the amount and the parity report records it. This document does not restate that amount.

`refunds` is a v1 policy. The architecture report leaves refund attribution open in §14. This version fixes the rule and declares it. The rule matches `sales-analysis.repository.ts` line 80, which reads `x.total_minor_units - x.tip_minor_units`.

## 11. Zero and null

| Metric | Empty set | Rule |
| --- | --- | --- |
| `net_sales` | `0` | Sum |
| `orders` | `0` | Count |
| `items_sold` | `0` | Sum |
| `discounts` | `0` | Sum |
| `tips` | `0` | Sum |
| `refunds` | `0` | Sum |
| `prior_net_sales` | `0` | Sum over the prior window |
| `average_ticket` | `0` | `0` when `orders = 0`. Explicit exception to the null rule. |
| `units_per_ticket` | `null` | `null` only when `orders = 0`. `0` when `items = 0` and `orders > 0`. Else 4 decimals, half-up. |

- A preset with no rows returns an empty `items` list and a zero `total`. Its `limit` is the cap, and `totalItems` is 0. `truncated` is `false`.
- No other metric returns `null`. The schema permits `null` for the union type. The policy permits it only for `units_per_ticket`.
- A null is "not defined". A zero is "counted as zero". Do not replace one with the other.

## 12. Response

### 12.1 Query response

```json
{
  "definitionVersion": "1.0.0",
  "scope": {
    "merchantId": "...",
    "locationId": null,
    "currency": "MXN",
    "timezone": "America/Mexico_City",
    "attribution": { "category": "current" }
  },
  "period": {
    "range": "last_7_days",
    "start": "2026-11-09",
    "end": "2026-11-15",
    "bucket": "day",
    "comparison": { "start": "2026-11-02", "end": "2026-11-08" }
  },
  "coverage": {
    "sources": ["pos_committed_sale", "receipt_snapshot"],
    "committedOnly": true,
    "refundsIncluded": false
  },
  "freshness": { "capturedAt": "2026-11-16T01:30:00.000Z" },
  "truncated": false,
  "rows": [
    {
      "dimensions": { "day": "2026-11-09" },
      "values": { "net_sales": 1234500, "orders": 84, "average_ticket": 14696 }
    }
  ]
}
```

| Field | Rule |
| --- | --- |
| `definitionVersion` | `1.0.0`. |
| `scope.merchantId` | The effective merchant. |
| `scope.locationId` | The effective location, or `null` for all locations. |
| `scope.currency` | The merchant currency, or `null`. |
| `scope.timezone` | The merchant time zone. |
| `scope.attribution.category` | `"current"`. Section 14. |
| `period.range` | The request range. |
| `period.start`, `period.end` | The business-date window, `YYYY-MM-DD`. |
| `period.bucket` | `hour` for `today` and `yesterday`. `day` for the two longer ranges. |
| `period.comparison` | The prior window of the same size. |
| `coverage.sources` | The ordered, deduplicated union of the source tables of the requested metrics. |
| `coverage.committedOnly` | Always `true`. |
| `coverage.refundsIncluded` | `true` only when `refunds` is requested. |
| `freshness.capturedAt` | The transaction timestamp as an ISO instant. |
| `truncated` | The OR of the row cut and every distribution cut. |
| `rows` | Present when `dimensions` is not empty. |
| `totals` | Present when `dimensions` is empty. |
| `rowsTotal` | Present only when the rows are cut. The count before the cut. |

- Exactly one of `rows` or `totals` is present.
- A row is `{ dimensions: Record<string, string>, values: Record<string, MetricsValue> }`.
- A value is a number, a null, or a Distribution.
- `rows` holds at most 1,000 rows.
- Do not add a synthetic row.

### 12.2 Insight response

```json
{
  "narrative": "Las ventas subieron ...",
  "generated": true,
  "capturedAt": "2026-11-16T01:30:00.000Z"
}
```

| Field | Rule |
| --- | --- |
| `narrative` | A string of at most 600 characters, or `null`. Null when `orders = 0` or when the model call fails. |
| `generated` | `true` when the service generated a new narrative. `false` on a cache hit. |
| `capturedAt` | The transaction timestamp as an ISO instant. |

The insight route uses the same eight metrics as the narrative input: `net_sales`, `orders`, `average_ticket`, `tips`, `discounts`, `prior_net_sales`, `payment_mix`, and `product_mix`. It adds no metric. It does not block the summary. A null narrative hides only the narrative card.

## 13. Truncation

Every list has a cap. A cut reports the full set. A cut never hides the total.

### 13.1 Rows

- Cut the rows at `min(limit, ceiling)`.
- If the cut removes rows, set `truncated: true` and add `rowsTotal` with the count before the cut.
- If the cut removes no rows, set `truncated: false` and omit `rowsTotal`.
- The order is the dimension tuple ascending. Apply the cut after the order.

### 13.2 Distributions

A Distribution is `{ items, truncated, limit, totalItems, total }`.

| Field | Rule |
| --- | --- |
| `items` | The items after the cut. |
| `truncated` | `true` when `totalItems` is more than `items.length`. |
| `limit` | The fixed cap of the preset. |
| `totalItems` | The number of items before the cut. |
| `total` | The sum over the full set, not over `items`. |

- `totalItems` counts items, not distinct names. For `payment_mix`, one method can produce two items, one per source. Section 15.
- A preset cut also sets the top-level `truncated` to `true`.
- The item order is: `payment_mix`, `channel_mix`, `product_mix`, and `operator_mix` by measure descending, then key ascending. `hour_mix` and `series` by key ascending. A null product id sorts last in `product_mix`.

### 13.3 Caps

| List | Cap | Cut field |
| --- | ---: | --- |
| `rows` | `min(limit, ceiling)` | `rowsTotal` |
| `payment_mix` | 8 | `truncated`, `totalItems` |
| `channel_mix` | 8 | `truncated`, `totalItems` |
| `product_mix` | 200 | `truncated`, `totalItems` |
| `operator_mix` | 100 | `truncated`, `totalItems` |
| `hour_mix` | 24 | `truncated`, `totalItems` |
| `series` by day | 31 | `truncated`, `totalItems` |
| `series` by hour | 24 | `truncated`, `totalItems` |

The caps in Section 9.2 bound the row ceiling. The caps in this table bound the fixed preset lists.

## 14. Category attribution

- `product_mix` reads the current `product_category.name` through `product.category_id`.
- The metric does not read the category at the time of the sale. A product that moved category reports all its units under the current category.
- The response declares `scope.attribution.category: "current"`.
- This is a v1 limitation, and the field makes it part of the contract. Do not read the field as a guarantee of at-sale attribution.

## 15. Payment mix and the deferred defect

`payment_mix` concatenates two sources and does not deduplicate them:

1. `merchant.pos_tender_fact` with `status = 'committed'`, grouped by `tender_type`.
2. `merchant.customer_value_tender_allocation`, grouped by `tender_type`.

Each source sums its own amount. A `UNION ALL` joins the two lists. The result is sorted by amount descending, then method ascending, and cut at 8.

A sale that uses cash and stored value can appear in both sources. The stored-value amount can then count twice in the total. The legacy `salesSummary` has the same behavior.

**v1 decision:** preserve the legacy concatenated multiset. Do not deduplicate in gates 1, 2, or 3. Compare the multiset in every parity case. File the overlap as a separate defect.

The defect record must state the affected merchant, sale, and amount, and the two source rows. Do not change the comparison to hide it.

## 16. Gate-2 parity

Gate 2 compares `GET reports/sales` (`salesSummary`) with `POST metrics/query` on the same fixture and the same explicit window. Gate 2 changes no consumer and no published output.

### 16.1 Coverage

| Requirement | Value |
| --- | --- |
| Cases | At least 20 |
| Ranges | All four: `today`, `yesterday`, `last_7_days`, `last_30_days` |
| Locations | All locations and each individual location |
| Data | Non-empty cases and boundary cases |
| Dates | Fixed `asOf` dates or fixtures |
| Fixture | Fixture A for the matrix. An isolated fixture for the refunds oracle. |
| Duplicate cases | None. Do not pad the matrix with empty duplicates. |

Each case names the fixture, the range, the location scope, and the number of metrics compared. Each case is reproducible from the report.

A boundary case is one of six. A single day. The first day of the window. The day before the window. The last day of the window. The day after the window. An empty window.

### 16.2 Comparison

- Compare all 14 migrated metrics in each totals case.
- In a dimension case, compare each requested metric that accepts the requested dimensions.
- `refunds` is compared only against its golden oracle. Section 10.3.
- Compare integers exactly. Do not use a tolerance.
- Compare null with null. A null never equals a zero and never equals an absent key.
- Compare `payment_mix` as a multiset. Keep a duplicate method.
- Compare `channel_mix`, `product_mix`, `operator_mix`, `hour_mix`, and `series` after key and order normalization.
- If the legacy response cannot represent a result, compare the overlapping values and record the limitation in the case row.

### 16.3 Normalization

Apply these rules to both documents before the comparison and before the hash:

1. Sort every list by its dimension tuple. The ranks are absent key, then JSON null, then text.
2. payment_mix is a multiset. Sort by method and amount. Keep duplicate rows. Never deduplicate tenders and wallet allocations.
3. product_mix sorts by productId, productName and category. The measure is netMinorUnits.
4. operator_mix sorts by operator and hour_mix sorts by hour. The measure is netMinorUnits.
5. channel_mix sorts by channel and series sorts by label.
6. units_per_ticket keeps four decimals, half-up, and stays null at zero orders.
7. A null field stays null. An absent field stays absent. The canonical row copies only keys that the source has.
8. Exclude the envelope fields. The compared form has no truncated, limit, totalItems, total, capturedAt, scope or period.
9. The canonical object has the 14 fields in this fixed order: net_sales, orders, average_ticket, items_sold, units_per_ticket, discounts, tips, prior_net_sales, payment_mix, channel_mix, product_mix, operator_mix, hour_mix, series.
10. prior_net_sales maps an absent or null source value to 0.
11. Minor units stay integers. The normal form does not scale, round or convert them.
12. series labels are YYYY-MM-DD for a day bucket and HH24 for an hour bucket.
13. The ledger hash replaces each random fixture product UUID with its fixture role: bread, coffee and foreign.

### 16.4 Hashes

Write both documents to the report. Hash each one:

- the normalized `metrics/query` JSON;
- the normalized `reports/sales` JSON.

Serialize the canonical object with `JSON.stringify`. The normalizer writes the keys in one fixed order, so the bytes are stable. Hash the UTF-8 bytes with SHA-256. Record the two hashes and the case id in one table.

A case passes only when the two normalized objects are equal and the two hashes are equal. A rerun that changes a hash is a finding. The report is signed by umi-verifier.

### 16.5 Test hooks

`salesSummary` takes an internal optional `asOf` parameter. Its default is the current day, and the public route never sends it. Its published output does not change. The parity harness uses this hook to set the same window on both methods.

## 17. Delivery gates

| Gate | Content | Exit condition |
| ---: | --- | --- |
| 1 | Catalogue, route, unit tests, gate-1 evidence | Code at `750c9bfe` in PR #293. Accepted. |
| 2 | Parity harness, 20 or more cases, refunds oracle, signed report | Accepted at `ac6988ce`. Signed hashes. |
| 3 | The dashboard summary, pivot, and narrative consume the new layer. `metrics.insight` replaces the narrative route. Delete `reports/sales`, `reports/sales/insight`, and the duplicate SQL in the same PR. | Gate 2 signed. Displayed numbers and layout unchanged. |
| 4 | `check:pr`, lint, contract, API tests, `CI ready` on the staging push | All green. |
| 5 | Verifier verdict, documentation merged, zero open PRs | Signed verdict. |

- Do not merge or deploy the gate-3 PR.
- Do not touch `main` or production.
- The Chief merges. The verifier owns the verdict.
- Gate 3 does not deduplicate payments. Section 15.

## 18. Acceptance

1. All 15 catalogue metrics are implemented. One test pins each formula against the golden fixture.
2. Gate 2 has 20 or more cases. The four ranges, all locations, and each location are present. Each case is non-empty or a declared boundary case.
3. Both JSON documents of each case have a recorded SHA-256. The normalization rules of Section 16.3 are recorded.
4. `refunds` matches the gate-2 oracle. The gate-1 values stay 9,000 on fixture A and 24,000 on fixture B.
5. The response declares `attribution.category`, the definition version, the coverage sources, and every cut.
6. `check:pr`, lint, the contract check, the API tests, and `CI ready` are green on the staging push.
7. The dashboard keeps its layout, labels, interactions, formatting, and displayed numbers. The old routes are deleted only after the gate-2 signature.
8. The documentation is merged and no PR of this run stays open.
9. `metrics.insight` returns a null narrative when `orders = 0` or when the model call fails. The summary stays complete.
10. The old sales types are removed. The cash-shift types stay.

## 19. Risks

| Risk | Treatment |
| --- | --- |
| Two different "net" numbers: net sales and merchandise | Separate names in the catalogue. The spec prohibits the word "net" for merchandise. |
| Refunds with no earlier policy | Explicit v1 rule in 10.3. A golden fixture with a void, a full refund, and a partial refund. |
| A time zone or bucket error | `hour` uses the merchant time zone. `day` uses `business_date`. The bucket follows the range. |
| A truncated mix hides its total | Distribution `total` and `totalItems` cover the full set. |
| A different prior window | Same size as the current window. Declared in `period.comparison`. |
| A number changes during migration | Gate 2 signs both JSON documents before gate 3 deletes the old endpoint. |
| A request cannot hold all 14 metrics | The summary sends A (7 scalars) and B (6 presets). The narrative sends C (8 metrics). No request exceeds 10. |
| An insight failure hides the summary | The summary and narrative are separate requests. A null narrative hides only the card. |
| A duplicate payment method drops a row | Keep the multiset. The adapter uses a composite key for the method and the index. |
| A duplicate payment amount | Out of scope. Section 15. A separate defect records it. |

## 20. Out of scope

A separate engine (StarRocks, SQLMesh), CDC, published metric versions, peer analysis, UI changes, POS changes, `main`, production, and payment deduplication.

`SalesPurchaseAnalysis` stays on the ticket-level `sales-analysis` shape. No production sales export exists at the gate-3 base. The customer CSV is out of scope.

## 21. Conflict register

Each row names the old text, the conflict, the resolution, and the reason. This section is the audit trail. It does not add a rule.

| # | Source | Conflict | Resolution | Why |
| ---: | --- | --- | --- | --- |
| 1 | SPEC §4; gate-1 §1 | The path had no `/api` prefix and no route-table step. | Use `/api/merchants/:merchantId/metrics/query` and the route-table entry in Section 5. | The controller prefix is `api`. One client prefix. |
| 2 | SPEC §5; gate-1 §2 | The text named `merchant.manage`; the sales policy is `sale.lifecycle`. | Use `sale.lifecycle` through the sales domain policy. | The sales read already uses this policy. A new permission would widen access. |
| 3 | SPEC §3.3; gate-1 §3 | Seven dimensions included `payment_method`; the contract has six. | Remove `payment_method`. `payment_mix` is the only path. | A sale can carry more than one tender. One sale row cannot hold one method. |
| 4 | SPEC §4; gate-1 §6 | "A null is never a zero" conflicted with `average_ticket`. | `average_ticket` is 0 when `orders = 0`. | The legacy summary and the code return 0. Parity needs the same number. |
| 5 | Gate-1 cap table | One column mixed dimension caps and preset caps. | Section 9.2 gives the row ceiling. Section 13.3 gives the preset caps. | A dimension row cut uses `limit` under a ceiling. A preset has a fixed cap. |
| 6 | SPEC §4; gate-1 §5 | One `truncated` boolean and no full total. | Each Distribution has `totalItems` and `total`. A row cut adds `rowsTotal`. | A cut must not hide the full sum. |
| 7 | SPEC §4; gate-1 §5 | `coverage.source` was one string; `refundsIncluded` was fixed `false`. | `coverage.sources[]` is the ordered union. `refundsIncluded` follows the request. | The source set depends on the requested metrics. |
| 8 | SPEC §3.2; gate-1 §7 | `sum(total_minor_units)` included the tip. | Use `total_minor_units - tip_minor_units`. | A tip is not merchandise. Fixture B proves 24,000, not 26,000. |
| 9 | SPEC §3.2; gate-1 §7 | "Tipo devolución" was ambiguous. | Include `void`, `full_refund`, and `partial_refund`. | The CHECK constraint has exactly these three. A void reverses a committed sale. |
| 10 | SPEC §4; gate-1 §8 | The response had no attribution field. | Add `scope.attribution.category: "current"`. | The reader must know that the category is not at-sale. |
| 11 | Gate-1 evidence, "Payment overlap risk" | It said that gate 3 owns the dedupe. | Dedupe is out of this migration. Gate 3 must not change it. File a separate defect. | CHIEF-REVIEW (2026-11-16, 03:22 UTC) forbids the correction in gate 3 and forbids a weaker comparison. |
| 12 | Gate-1 evidence, `payment_mix.totalItems` | "Distinct keys" conflicted with the no-dedupe rule. | `totalItems` counts items before the cut. One method can give two items. | The legacy multiset must stay comparable. |
| 13 | Gate-1 evidence header; PR body | "Verification pending" stayed after the PASS. | Replace the pending header with the signed verdict. Keep the earlier FAIL result as history. | A stale status must not read as the current state, and the FAIL record is still evidence. |
| 14 | Parity test | Legacy `prior_net_sales` can be absent; the catalogue returns 0. | Normalize an absent legacy value to 0. | A sum over an empty window is 0. |
| 15 | SPEC §4; gate-1 §4 | `limit` had no rule at zero dimensions. | `limit` is valid only with at least one dimension. Otherwise the error path is `limit`. | A totals response has no row list to cut. |
| 16 | Gate 3 requirement 2; PLAN §0.1 | The gate says remove the old route-table entry. No entry exists at `f81d983a`. | Remove the controller methods, service methods, repository method, and old contract models. Replace the `operations.sales` surface entry. | A claim that removes a non-existent entry is false. |
| 17 | Gate 3 requirement 1; P3 | The gate says relevant exports use the layer. No production sales export exists. | Ship a disposition table for every remaining formula copy. The customer CSV is out of scope. | Do not invent an export. |
| 18 | Gate 3 real-dashboard matrix; P2 | The dashboard has no all-locations control. | The all-locations cell is `N/A`. All-locations coverage is at API and adapter level. | The gate keeps the UI unchanged. |
| 19 | SPEC §5; gate 3 plan | The accepted contract has one route at `2.57.0`. Gate 3 adds `metrics.insight` and removes the old sales types. | Add the insight route and bump the contract to `2.58.0`. | The narrative needs a separate request and a separate failure path. |
| 20 | SPEC §6; gate 3 plan | The 10-metric limit cannot hold the 14 legacy metrics in one request. | Split the summary into A (7) and B (6). The narrative uses C (8). | No request exceeds the public limit. |

## 22. Publication

This version is published at `docs/architecture/2026-11-16-semantic-analytics-api-spec.md`. Do not edit the accepted v1.1 at `f81d983a`. The gate-2 ledger and signed reports stay unchanged.

The PR body and the evidence record name the final head. This document names no final head.
