# Gate 1 evidence — semantic analytics API v1

Date: 2026-11-16, America/Mazatlan.
Builder: umi-builder. Verifier: umi-verifier. Verifier verdict: pending.
Branch: `feat/semantic-analytics-api-v1-20261116`.
Base: `origin/staging` `4da41dfd`.
Authorization: staging only. No merge. No deploy. No `main`.

## Scope

Gate 1 adds a typed metric catalogue and one read route.
It does not change the dashboard, `salesInsight`, `GET reports/sales`, any consumer, any existing number, any schema, or any dependency.
It does not delete `reports/sales` or the duplicated SQL.

## Environment

| Item                                 | Value                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------ |
| Worktree                             | `/home/juan/Projects/umiconsulting/umi/.worktrees/semantic-api-20261116` |
| Fixture database                     | `umi_i1_exec_2f52a6d5` on `127.0.0.1:5543`                               |
| App role                             | `api_login` (RLS-confined)                                               |
| Worker role                          | `worker_login` (BYPASSRLS)                                               |
| Test database for the seeded fixture | `umi_sales_analysis` on `127.0.0.1:5543`                                 |
| Contract                             | `2.57.0`                                                                 |
| Metric definition version            | `1.0.0`                                                                  |

The local database clock reads 2026-11-08 21:26 UTC.
The merchant timezone is `America/Mazatlan`.
Therefore the current `last_30_days` window of the old method equals the 19k fixture window.
The performance comparison can use that window without a change to the old method.

The performance script only reads the fixture database.
The integration test seeds its own fixture into `umi_sales_analysis`.
No gate-1 command writes to `umi_i1_exec_2f52a6d5`.

## Golden fixture A

Source: `apps/umi-api/test/integration/sales-analysis-fixture.ts`.
Window: `asOf 2026-11-04`, `last_7_days` (2026-10-29..2026-11-04).
Test: `metrics.integration.ts`.

| Metric             | Expected                                             | Observed            |
| ------------------ | ---------------------------------------------------- | ------------------- |
| `net_sales`        | 37,500                                               | 37,500              |
| `orders`           | 3                                                    | 3                   |
| `average_ticket`   | 12,500                                               | 12,500              |
| `items_sold`       | 4                                                    | 4                   |
| `units_per_ticket` | 1.3333                                               | 1.3333              |
| `discounts`        | 4,000                                                | 4,000               |
| `tips`             | 1,500                                                | 1,500               |
| `prior_net_sales`  | 0                                                    | 0                   |
| `refunds`          | 9,000                                                | 9,000               |
| `channel_mix`      | `walk_in` {37,500; 3}                                | match               |
| `product_mix`      | bread {2; 20,000}, coffee {2; 20,000}                | match by product id |
| `operator_mix`     | `—` {4; 40,000}                                      | match               |
| `hour_mix`         | `04` {1; 10,000}, `10` {2; 20,000}, `11` {1; 10,000} | match               |
| `series`           | 2026-11-02 28,500; 2026-11-04 9,000                  | match               |
| `payment_mix`      | `cash` {19,500}, `wallet` {5,000}                    | match               |

The hourly bucket uses `pos_committed_sale.committed_at` in `America/Mazatlan`.
The day uses `receipt_snapshot.business_date`.
The fixture has one committed cash tender of 19,500 and one wallet allocation of 5,000.
The all-locations read returns the cash tender only, because the allocation has a location scope.
The one-location read returns both rows.

## Golden fixture B

Source: the I1 METRIC fixture in `umi_i1_exec_2f52a6d5`.
Merchant: `55555555-5555-4555-8555-000000000001`.
Window: `asOf 2026-11-04`, `last_7_days`.
Test: `metrics.integration.ts`.

| Metric             | Expected                                                             | Observed |
| ------------------ | -------------------------------------------------------------------- | -------- |
| `net_sales`        | 49,500                                                               | 49,500   |
| `orders`           | 4                                                                    | 4        |
| `average_ticket`   | 12,375                                                               | 12,375   |
| `items_sold`       | 7                                                                    | 7        |
| `units_per_ticket` | 1.75                                                                 | 1.75     |
| `discounts`        | 3,000                                                                | 3,000    |
| `tips`             | 2,500                                                                | 2,500    |
| `prior_net_sales`  | 0                                                                    | 0        |
| `refunds`          | 24,000                                                               | 24,000   |
| `channel_mix`      | `walk_in` {49,500; 4}                                                | match    |
| `product_mix`      | coffee {5; 40,000}, concha {2; 10,000}                               | match    |
| `operator_mix`     | `—` {7; 50,000}                                                      | match    |
| `hour_mix`         | `02` {1; 8,000}, `09` {2; 16,000}, `11` {3; 18,000}, `12` {1; 8,000} | match    |
| `series`           | 2026-11-02 27,000; 2026-11-04 22,500                                 | match    |
| `payment_mix`      | empty                                                                | empty    |

The two refunds have exception dates 2026-11-03 and 2026-11-06.
The sale dates are 2026-11-02 and 2026-11-04.
The result attributes the refund to the sale date.
The refund total is 24,000.
`total_minor_units` alone would report 26,000.

## Parity with `GET reports/sales`

Test: `metrics.parity.integration.ts`.
The old repository method takes an internal optional `asOf`.
The route never sends it, so the published output does not change.
Both methods use the same explicit window.

| Fixture       | Location scope | Metrics               | Result         |
| ------------- | -------------- | --------------------- | -------------- |
| A             | all locations  | 14 migrated           | exact match    |
| A             | one location   | 14 migrated           | exact match    |
| A             | all locations  | day series as rows    | exact match    |
| A             | one location   | non-empty payment mix | multiset match |
| B (I1 METRIC) | all locations  | 14 migrated           | exact match    |

The test compares:

- `net_sales`, `orders`, `average_ticket`, `items_sold`, `units_per_ticket`, `discounts`, `tips`, `prior_net_sales`;
- `payment_mix` as a multiset, including one tender and one allocation;
- `channel_mix`, `product_mix`, `operator_mix`, `hour_mix`, `series` after key and order normalization.

The `units_per_ticket` legacy value comes from `itemsSold` and `orders` at 4 decimals, half-up.
The test returns null when `orders` is 0.

## Performance on the 19k fixture

Command:

```sh
node tools/verification/metrics-perf.mjs
```

Raw output: `docs/verification/2026-11-16-semantic-api-gate1-perf.json`.

Dataset binding, asserted before the measurement:

| Fact                             | Value                                         |
| -------------------------------- | --------------------------------------------- |
| Database                         | `umi_i1_exec_2f52a6d5`                        |
| Merchant                         | `44444444-4444-4444-8444-000000000001`        |
| Location                         | `44444444-4444-4444-8444-000000000011`        |
| Committed sales                  | 19,000                                        |
| Cart lines                       | 76,000                                        |
| Business dates                   | 2026-10-10..2026-11-08                        |
| Sales at the location            | 19,000                                        |
| Sales with null `origin_channel` | 19,000 (the catalogue maps them to `walk_in`) |

Request: all 15 metrics, `dimensions: []`, `last_30_days`, `asOf 2026-11-08`.
The window is 2026-10-10..2026-11-08.
Warmups: 5. Measured runs: 20.

| Measure                    | Value        |
| -------------------------- | ------------ |
| p50                        | 1,281.593 ms |
| p95                        | 1,293.794 ms |
| max                        | 1,329.740 ms |
| SQL statements per request | 11           |

The result of the measured request:

| Metric             | Value      |
| ------------------ | ---------- |
| `net_sales`        | 76,000,000 |
| `orders`           | 19,000     |
| `average_ticket`   | 4,000      |
| `items_sold`       | 76,000     |
| `units_per_ticket` | 4          |
| `prior_net_sales`  | 0          |
| `refunds`          | 0          |

Comparison with the current `salesSummary` on the same window:

| Method          | Time         | `net_sales` | `orders` | `average_ticket` | `items_sold` | `discounts` | `tips` |
| --------------- | ------------ | ----------- | -------- | ---------------- | ------------ | ----------- | ------ |
| `metrics/query` | 1,282.405 ms | 76,000,000  | 19,000   | 4,000            | 76,000       | 0           | 0      |
| `salesSummary`  | 1,266.411 ms | 76,000,000  | 19,000   | 4,000            | 76,000       | 0           | 0      |

The five compared totals are equal.
The new method is 16 ms slower on this run.
The new method runs 11 SQL statements.
The old method runs 11 statements by code inspection.

## Rework after the verifier FAIL at `0ec5de71`

The verifier returned FAIL at `0ec5de71`.
This section records the five defects and the correction.

| Defect | Cause                                                                   | Correction                                                                                      |
| ------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| D1     | The payment mapper read `row.key`. The SQL aliases the column `method`. | Read `row.method`. Add `PaymentRow` to the row type.                                            |
| D2     | The SQL applied `LIMIT` to each metric family. `rowsTotal` used `max`.  | Remove the per-family `LIMIT`. Merge the tuples, sort, cut once. `rowsTotal` is the union size. |
| D3     | SQL preflight counted three new uncovered statements.                   | Name the three dimension-driven statements in `UNCOVERED_EXPECTED` with the reason.             |
| D4     | Parity did not compare `units_per_ticket`. Payment mix was empty.       | Compare the derived value. Add one tender and one allocation to the fixture.                    |
| D5     | The mock returned `key`. The mock hid D1.                               | Return `method`. Add the D1, D2 and D4 regression tests.                                        |

Red-to-green evidence:

| Test                                                       | At `0ec5de71`                                                   | At the new head |
| ---------------------------------------------------------- | --------------------------------------------------------------- | --------------- |
| `metrics.repository.spec.ts` payment envelope              | `safeParse` false; method `undefined`                           | pass            |
| `metrics.repository.spec.ts` disjoint-day cut              | 2 rows; `truncated` false; no `rowsTotal`                       | pass            |
| `metrics.integration.ts` cash tender envelope              | `safeParse` false; method `undefined`                           | pass            |
| `metrics.parity.integration.ts` non-empty payment multiset | `undefined:19500`, `undefined:5000`                             | pass            |
| `sql-preflight.integration.ts` uncovered remainder         | `NEW uncovered file: modules/metrics/metrics.repository.ts (3)` | pass            |

The `units_per_ticket` parity check passes at both heads, because the value was correct.
The new check closes the coverage gap. The new non-empty payment case is the red case for D4.

### Payment overlap risk

`payment_mix` concatenates `merchant.pos_tender_fact` with
`merchant.customer_value_tender_allocation`.
It does not dedupe the two sources.
A sale that uses cash and wallet can appear in both sources.
The wallet amount can therefore count twice in the method totals.
The legacy `salesSummary` has the same behavior.
A dedupe would break parity in this gate.
Gate 3 owns the dedupe and the overlap correction.
The contract decision table records this limit.

## Commands and results

| Command                                                                                                  | Result                                                                                             |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm --filter @umi/contract test`                                                                       | 143 tests pass, 0 fail                                                                             |
| `pnpm --filter @umi/contract generate:check`                                                             | `Generated UMI contract 2.57.0 (f97644a71bb6b83391884e88aaffd452f95ed4664d19a9c0a18b4097a80ec14d)` |
| `pnpm --filter @umi/api test`                                                                            | 226 files pass, 1 skipped; 2,289 tests pass, 29 skipped                                            |
| `pnpm --filter @umi/api typecheck`                                                                       | pass                                                                                               |
| `pnpm --filter @umi/api lint`                                                                            | pass                                                                                               |
| `npx vitest run --config vitest.integration.config.ts src/modules/metrics/metrics.integration.ts`        | 11 tests pass                                                                                      |
| `npx vitest run --config vitest.integration.config.ts src/modules/metrics/metrics.parity.integration.ts` | 5 tests pass                                                                                       |
| `npx vitest run --config vitest.integration.config.ts src/app-graph.integration.ts`                      | 2 tests pass                                                                                       |
| `npx vitest run --config vitest.integration.config.ts src/shared/database/sql-preflight.integration.ts`  | 3 tests pass; 18 uncovered statements are named                                                    |
| `bash db/check.sh`                                                                                       | pass; schema, realtime, checkout and acceptance suites                                             |
| `node tools/verification/metrics-perf.mjs`                                                               | p50 1,281.593 ms, p95 1,293.794 ms                                                                 |
| `pnpm evidence:check`                                                                                    | 2 packets pass                                                                                     |
| `pnpm check:pr`                                                                                          | see the pull request checks                                                                        |

The integration and app-graph commands use:

```sh
DATABASE_URL_APP=postgresql://api_login:i1_local_api@127.0.0.1:5543/umi_sales_analysis
DATABASE_URL_WORKER=postgresql://worker_login:i1_local_worker@127.0.0.1:5543/umi_sales_analysis
JWT_SECRET=<local test value>
REDIS_URL=redis://localhost:6379
```

The `I1 METRIC` cross-check uses the fixture database through the default local connection.

## Decisions and SPEC conflicts

| Topic                      | SPEC                                   | Contract                                             | Decision                                                                                       |
| -------------------------- | -------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Route path                 | `/merchants/:merchantId/metrics/query` | `/api/merchants/:merchantId/metrics/query`, no `/v1` | The contract wins. The route is `/api/...`.                                                    |
| `coverage`                 | `{ source }`                           | `{ sources: [] }`                                    | The contract wins. The response uses the ordered union of source tables.                       |
| `payment_method` dimension | Listed                                 | Not a dimension                                      | The contract wins. `payment_mix` is the only path to a payment method.                         |
| `location` policy          | `merchant.manage` or equivalent        | `DASHBOARD_DOMAIN_POLICY` domain `sales`             | The contract wins. The policy is `sale.lifecycle`.                                             |
| `refunds` amount           | `sum(total_minor_units)`               | `sum(total_minor_units - tip_minor_units)`           | The contract wins. The fixture proves 24,000, not 26,000.                                      |
| `range` default            | Not stated                             | Not stated                                           | The request requires `range`. A missing value is a 400 on `range`.                             |
| `product` dimension value  | Not stated                             | Not stated                                           | The value is the product id as text. `—` means no product. The preset gives the name.          |
| `locationId: null`         | Optional uuid                          | Optional uuid                                        | A null value is a 400 on `locationId`, because it is not a uuid.                               |
| `payment_mix.totalItems`   | "distinct keys before the cut"         | No dedupe of methods                                 | The count is the number of concatenated rows, including a method that appears in both sources. |

No other conflict needs a different answer.

## Files

API:

- `apps/umi-api/src/modules/metrics/metrics.module.ts`
- `apps/umi-api/src/modules/metrics/metrics.controller.ts`
- `apps/umi-api/src/modules/metrics/metrics.service.ts`
- `apps/umi-api/src/modules/metrics/metrics.repository.ts`
- `apps/umi-api/src/modules/metrics/metrics.catalog.ts`
- `apps/umi-api/src/modules/metrics/metrics.formulas.ts`
- `apps/umi-api/src/app.module.ts`

Contract:

- `packages/contract/src/metrics.ts`
- `packages/contract/src/index.ts`
- `packages/contract/src/catalog.ts`
- `packages/contract/src/route-table.ts`
- `packages/contract/generated/*`

Tests and evidence:

- `packages/contract/test/metrics.test.mjs`
- `apps/umi-api/src/modules/metrics/metrics.formulas.spec.ts`
- `apps/umi-api/src/modules/metrics/metrics.repository.spec.ts`
- `apps/umi-api/src/modules/metrics/metrics.service.spec.ts`
- `apps/umi-api/src/modules/metrics/metrics.integration.ts`
- `apps/umi-api/src/modules/metrics/metrics.parity.integration.ts`
- `apps/umi-api/src/modules/dashboard-operations/dashboard-operations.repository.ts` (internal `asOf` only)
- `tools/verification/metrics-perf.mjs`
- `docs/verification/2026-11-16-semantic-api-gate1.md`
- `docs/verification/2026-11-16-semantic-api-gate1-perf.json`
- `scripts/evidence/runs/pos-checkout-partial-guards/*` (recaptured: the packet records `packages/contract/src/index.ts`)

## What the verifier must check independently

1. Run the four test commands and the two integration files. Do not trust this file.
2. Re-run the perf script on the same database, and confirm the fixture binding.
3. Confirm no consumer file changed.
4. Confirm the generated contract matches `CONTRACT_VERSION` `2.57.0`.
5. Confirm the route table entry, the permission, the location scope, and the 400 matrix.
6. Confirm the two golden fixtures, including the refund attribution by sale date.
7. Confirm `salesSummary` output did not change. The only change is the optional internal `asOf`.
8. Confirm the response envelope rules: one of `rows` or `totals`, no synthetic row, total before the cut, top-level `truncated`.

## Status

Do not merge. The Chief merges.
The verifier owns the verdict.
This builder makes no PASS claim.
