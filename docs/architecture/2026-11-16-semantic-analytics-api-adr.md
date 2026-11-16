# One definition per metric — the semantic analytics query

_ADR · build-v3 · `merchant` schema · semantic analytics API v1 · 2026-11-16_

**Status:** ACCEPTED (2026-11-16). API contract `2.57.0`. Metric definition `1.0.0`.
**Supersedes:** the 2026-11-15 draft `SPEC.md` and its gate-1 amendments. The reconciled text is `docs/architecture/2026-11-16-semantic-analytics-api-spec.md` v1.1.
**Relates to:** `docs/reports/2026-11-08-umi-product-and-data-architecture.md` §7-§8 and `docs/reports/2026-11-07-dashboard-disruptive-architecture.md` §6. These two files are not in this checkout. The gate-1 contract records their location.
**Code:** `apps/umi-api/src/modules/metrics/`; `packages/contract/src/metrics.ts`; `packages/contract/src/route-table.ts` (entry `metrics.query`); `apps/umi-api/src/modules/dashboard-operations/dashboard-operations.repository.ts`; `apps/umi-api/src/modules/dashboard-operations/sales-analysis.repository.ts`.

---

## 1. Context — the same number, computed twice

The owner dashboard asks for sales in four shapes: a summary, a fact list, a product mix, and a series. The SQL for these shapes lives in `dashboard-operations.repository.ts`. The summary and the fact list repeat the same concepts with different joins. These are the places:

- `salesSummary` sums `receipt_snapshot.grand_total` and reads discounts and tips from the frozen receipt.
- `QUERIES.sales` reads the same values with a different join order.
- The product mix reads `pos_cart_line` and the current product category.
- Cash and the exports repeat parts of the same logic again.

No catalogue names these definitions. No version marks a change. A reader cannot tell which query is the definition, and a consumer cannot cite one.

The failure is recorded. `I1-MET-06` reported a discount of zero. One query read an empty table and the other read the receipt. Both were "the dashboard". Only one was right.

Gate 1 added a typed catalogue and one read route at `750c9bfe`. The route returns every current number with exact parity on the golden fixtures. This ADR records the contract that the route now carries, and the reason for each choice that the old draft left open or contradicted.

## 2. Decision

**There is one catalogue. There is one read route. The client names metrics and dimensions. The server names the SQL.**

The route is `POST /api/merchants/:merchantId/metrics/query`. The contract is `2.57.0`. The metric definitions are version `1.0.0`.

The decision has seven parts:

1. The route uses the existing `/api` prefix and one route-table entry. There is no `/v1` segment.
2. The permission is `sale.lifecycle` through the sales domain policy, with the user location scope.
3. The request has six dimensions. A payment method is not a dimension.
4. The catalogue has 15 metrics: 9 scalars or derived values, and 6 presets.
5. Each formula has one zero rule and one null rule.
6. `refunds` is a committed sale exception, net of tips, on the sale business date, positive, and separate from `net_sales`.
7. Payment deduplication stays out of this migration. The legacy concatenated multiset remains.

## 3. Why these resolutions

### 3.1 Why `sale.lifecycle`

The read is a sales read. The dashboard already guards its sales views with `DASHBOARD_DOMAIN_POLICY`, domain `sales`, through `hasDashboardPermission`. That policy resolves to `sale.lifecycle`.

A new permission would do two bad things. It would add a second way to authorize the same read. It would also let a role see the dashboard sales summary but not the metrics route, or the reverse. The same number must need the same permission.

`merchant.manage` is wider than the read. A user who may read sales does not always manage the merchant. The old draft named `merchant.manage` as an example, not as a decision. This ADR removes the example.

The location scope is part of the same decision. The effective location is `access.locationId ?? query.locationId ?? null`. A scoped user who asks for another location gets 403 `LOCATION_SCOPE_VIOLATION`, not a silent widening. The value then passes to `runWithMerchant`, so the row-level security policy applies to every statement.

### 3.2 Why 15 metrics and 6 presets

The 14 migrated metrics are the numbers that `GET reports/sales` publishes today. They are the parity set. `refunds` is the fifteenth metric, and it has no legacy parity.

A preset is a metric whose value is a list, not a scalar. The list has its own cut and its own total. `payment_mix`, `channel_mix`, `product_mix`, `operator_mix`, `hour_mix`, and `series` are presets for three reasons:

1. A list cannot share a row with a scalar. If `product_mix` were a dimension, a query for `net_sales` and `product_mix` would need two grains in one row.
2. The cut belongs to the list. A distribution carries `totalItems` and `total` over the full set, so a cut never hides the sum.
3. The item shape differs for each preset. A typed envelope per preset is clearer than a generic map.

The price is that a preset cannot be combined with a dimension. That is a limit, and the contract states it. A caller who needs a mix by day needs a new contract shape in a later version. Gate 1 does not build that shape.

### 3.3 Why six dimensions, and no `payment_method`

The six dimensions are `day`, `hour`, `channel`, `operator`, `category`, and `product`. Each one is a column or a stable key on the sale, the cart line, or the product.

`payment_method` is not one of them. A sale can carry more than one tender: part cash, part stored value. A dimension gives one value for each row of the sale set. A split tender has no single value to give. The old draft listed `payment_method` and `payment_mix` together, and the two rules disagreed.

`payment_mix` is the only path to a payment method. It reports the amount for each method and keeps the two sources apart. The alternative is a computed allocation of a split tender to one method. It would invent a rule that the current code does not have and that no merchant has agreed to.

The dimension values are fixed. `day` is `receipt_snapshot.business_date`. `hour` is the local clock hour of `committed_at` in the merchant time zone. A reader cannot derive one from the other, and the contract forbids the attempt.

### 3.4 Why current category attribution

`product_mix` reports the current `product_category.name` of the product. It does not report the category at the time of the sale.

The reason is the data. The sale carries a frozen receipt, and the cart line carries a product id. The product row carries the current category. There is no at-sale category column on `pos_cart_line`. A true at-sale attribution needs a new column and a backfill. That is a schema change, and gate 1 changes no schema.

A silent current attribution would be worse than a declared one. A product that moves from "pan dulce" to "temporada" would move its whole history, and a reader would see a number that no receipt supports. So the response declares `scope.attribution.category: "current"`, and the contract records the limit. The field is part of the contract, not a comment.

### 3.5 Why refunds exclude tips

A refund reverses merchandise. A tip is not merchandise. Example: a sale of 24,000 includes a 2,000 tip. The guest cancels, so the shop returns 26,000 and loses 24,000 of merchandise. The tip was never revenue for the shop.

`total_minor_units - tip_minor_units` is the merchandise amount. `sales-analysis.repository.ts` line 80 already reads that expression, so the catalogue and the analysis agree.

The metric includes `void`, `full_refund`, and `partial_refund`. The CHECK constraint on `merchant.pos_sale_exception.exception_type` has exactly these three values, so the set is closed. A void belongs in the set because it reverses a committed sale. If the query dropped a void, the original sale would stay in `net_sales` with no offset. The shop would then read revenue that it did not keep.

The attribution is the sale business date, not the exception date. A refund on 2026-11-06 for a sale on 2026-11-02 belongs to 2026-11-02. The gate-1 fixture proves this. The exception dates are 2026-11-03 and 2026-11-06. The sale dates are 2026-11-02 and 2026-11-04. The result reports 17,000 and 7,000 on the sale dates. The total is 24,000. `total_minor_units` alone would report 26,000.

`refunds` stays positive and separate from `net_sales`. A reader can compare gross sales and refunds. A netted number would hide both.

### 3.6 Why payment deduplication is out

`payment_mix` concatenates `merchant.pos_tender_fact` with `merchant.customer_value_tender_allocation`. It does not deduplicate them. A sale that pays part cash and part stored value can appear in both sources, and the stored-value amount can count twice.

The legacy `salesSummary` does the same. Gate 2 compares the new route with the legacy method, case by case, with exact hashes. A deduplication in gate 1 or gate 2 would break that comparison. The team could no longer tell a real regression from the intended fix.

The Chief review of 2026-11-16 fixes the boundary. Deduplication is outside this migration. Do not correct it during gate 3. Do not weaken the comparison. File the overlap as a separate defect with the merchant, the sale, the amount, and the two source rows.

The defect is real and is not hidden. Section 15 of the reconciled SPEC states it in the contract, and `metrics.catalog.ts` states "no dedupe" in the `payment_mix` formula text.

## 4. The v1 contract

1. **Route.** `POST /api/merchants/:merchantId/metrics/query`. Controller `@Controller('api/merchants/:merchantId/metrics')`, `@Post('query')`. One route-table entry, id `metrics.query`. No `/v1`.
2. **Authorization.** `sale.lifecycle` through `DASHBOARD_DOMAIN_POLICY`, domain `sales`, with `hasDashboardPermission`. Effective location `access.locationId ?? query.locationId ?? null`. A different scoped location returns 403 `LOCATION_SCOPE_VIOLATION`.
3. **Request.** 1 to 10 metrics. 0 to 2 dimensions. One of four ranges. Optional uuid location. `limit` 1 to 1000, default 100, only with a dimension. Strict object. All failures are `VALIDATION_FAILED` with `fieldErrors`.
4. **Catalogue.** 15 metrics. The matrix in Section 8 of the SPEC gives the accepted dimensions of each. A preset accepts none. `prior_net_sales` accepts none.
5. **Zero and null.** The sums are 0. `average_ticket` is 0 when `orders = 0`. `units_per_ticket` is null only when `orders = 0`, else 4 decimals, half-up. No other metric is null.
6. **Refunds.** Committed exceptions of type `void`, `full_refund`, or `partial_refund`. Amount `total_minor_units - tip_minor_units`. Sale business date. Positive. Separate from `net_sales`.
7. **Category.** Current `product_category`, declared as `scope.attribution.category: "current"`.
8. **Truncation.** A row cut sets `truncated` and `rowsTotal`. A distribution cut sets `truncated`, `limit`, `totalItems`, and `total` over the full set. Limits: product 200, operator 100, channel 8, hour 24, day 31, category 100, payment 8, series 31 by day and 24 by hour.
9. **Payment.** The concatenated multiset. No dedupe.

A change to any of these rules needs a new document version. A change to a formula needs a new definition version. A change to a shape needs a new contract version.

## 5. Alternatives considered

**A `/v1` segment.** Rejected. The controller convention puts `/api` at the front, and no other route in `route-table.ts` carries `/v1`. A second prefix would split the client base for no gain.

**A new `analytics.read` permission.** Rejected. The same sales number would need two permissions. A role change would then produce a dashboard that shows a summary and a metrics route that refuses it.

**A generic query language.** Rejected. It moves the definition from the catalogue into the caller, and it reopens the duplicate-SQL problem at a higher layer. The request names ids. The server names the SQL. The endpoint never accepts SQL, a table name, or an expression.

**`payment_method` as a seventh dimension.** Rejected in 3.3. A split tender has no single method. `payment_mix` is the honest shape.

**A computed split-tender allocation.** Rejected. No current rule exists, and any rule would change a published number. The legacy multiset stays.

**At-sale category.** Rejected for v1. It needs a column and a backfill. The response declares the current attribution instead, so the reader is not misled.

**Refunds including tips, or netted into `net_sales`.** Rejected in 3.5. A tip is not merchandise, and a netted number hides both sides.

**A dedupe in gate 2.** Rejected in 3.6. It would break the parity signature, and the Chief review forbids it.

**A separate analytics service.** Rejected for v1. The data is in `merchant`, the read is one transaction, and the API already owns the policy and the location scope. A new service would add a boundary with no measured need.

## 6. Consequences

**Positive**

- One definition for each metric, with a version and a test.
- One permission for every sales read. The location scope is enforced once.
- The dashboard, the narrative, and the exports can move to one layer in gate 3 and delete the duplicate SQL.
- Every response declares its period, coverage, attribution, and cuts.
- Refunds now have an explicit rule and an oracle.

**Negative**

- A preset cannot be combined with a dimension. A mix by day has no shape in v1.
- The category is current, not at-sale. A product that moves category moves its history.
- `payment_mix` can double-count a split tender. The defect is known and deferred.
- The catalogue is a second place to change when a formula changes. A test pins each formula, but the discipline is new.

**Cost**

- Gate 2 needs at least 20 reproducible cases and two hashes for each case.
- Gate 3 must delete `reports/sales` and the duplicate SQL in one PR, after the gate-2 signature.
- A later definition change needs a version bump and a migration note.

**Follow-up**

- File the payment overlap defect. Do not fix it in this migration.
- Define the at-sale category when the schema can carry it.
- Decide the split-tender allocation rule, if the business needs one, in a separate ADR.

## 7. What this ADR does not decide

- The consumer migration. Gate 3 owns the dashboard, `salesInsight`, the exports, and the deletion of `reports/sales`.
- The payment deduplication design. A separate defect and a separate decision own it.
- The at-sale category. It needs a schema change and a backfill.
- A mix by dimension. It needs a new contract shape.
- The dashboard layout or the narrative text. This ADR changes no number that the owner sees.
