# Gate 1 verification report — semantic analytics API v1

**Verdict: PASS at `750c9bfee8b6b6809d131af0b1e0a33ad881def7`.**

**Historical verdict: FAIL at `0ec5de713ab79d99a7adcfb90c70adbf36a79190`.** This report keeps that verdict as history. The rework at `750c9bfe` closes all five defects D1–D5. The lead owns the merge. This verification did not merge and did not deploy.

| Field | Value |
| --- | --- |
| Repository | `umiconsulting/umi` |
| Pull request | #293 — `feat(api): semantic analytics metrics query (gate 1)` |
| Branch | `feat/semantic-analytics-api-v1-20261116` |
| Base | `4da41dfd8f60748c761b191caf7dd8eb7e909ace` (`origin/staging`) |
| Reviewed head | `750c9bfee8b6b6809d131af0b1e0a33ad881def7` |
| Historical FAIL head | `0ec5de713ab79d99a7adcfb90c70adbf36a79190` |
| Commit author | `umi-juanlopez <284223172+umi-juanlopez@users.noreply.github.com>` |
| Commit date | 2026-11-15 19:54:44 −0700 |
| Report date | 2026-11-16 UTC (run date 2026-11-15, America/Mazatlan) |
| Report author | `umi-verifier` |
| PR state | OPEN, `MERGEABLE`, not draft |
| Code edits by verifier | none |
| Merge or deploy by verifier | none |

## 1. Independence and method

I am `umi-verifier`. I wrote this report. I ran the checks on the real artifact in a fresh worktree at the reviewed SHA. I did not edit the branch, any tracked file, or any product file. I did not merge and did not deploy.

The method follows the stop hook of the gate contract:

1. Read the gate contract and the rework brief.
2. Reproduce on the real surface: HTTP route, PostgreSQL with RLS, contract parse, SQL preflight, and CI.
3. Run the failing tests at `0ec5de71`. Run the same tests at `750c9bfe`. Run the regression suites.
4. Review the artifact, not the builder summary.
5. Record the evidence and the verdict. If a check fails, name the exact gap and the step that shows it.
6. Turn each production failure into an eval task. D1–D5 are the gate-1 eval set.

## 2. Environment

### 2.1 Worktrees

| Purpose | Path | State |
| --- | --- | --- |
| Reviewed head | `/home/juan/Projects/umiconsulting/umi/.worktrees/verify-293-750c9bfe` | clean at `750c9bfe` |
| Historical head | `/home/juan/Projects/umiconsulting/umi/.worktrees/verify-293-0ec5de71` | clean at `0ec5de71` after the red-to-green test copy was removed |

### 2.2 Databases

| Database | Role in this gate |
| --- | --- |
| `umi_verify_293` | Current-schema clone used for the HTTP route, the seeded fixture A, the parity suite, and the SQL preflight |
| `umi_ci_rework293` | CI database that was cloned to make `umi_verify_293` |
| `umi_sales_analysis` | Seeded fixture A database used for the earlier parity and legacy sales run |
| `umi_i1_exec_2f52a6d5` | Fixture B, the I1 METRIC fixture used for the second golden case and parity |

The SQL preflight passes on `umi_verify_293`. It does not pass on `umi_sales_analysis`, because that database lacks current columns such as `merchant.purchase_days` and `purchase_order.origin`. It does not pass on `umi_i1_exec_2f52a6d5`, because `word_similarity` is in the `extensions` schema and the database `search_path` omits that schema. These are database-state failures, not PR failures.

### 2.3 Environment variable names

The commands below use these names. This report does not write any value.

- `DATABASE_URL_APP` — app role, RLS-confined (`api_login`).
- `DATABASE_URL_WORKER` — worker role, `BYPASSRLS` (`worker_login`).
- `JWT_SECRET` — local test value.
- `REDIS_URL` — local Redis URL.
- `METRICS_I1_APP_DATABASE_URL` — optional override for fixture B.
- `METRICS_I1_WORKER_DATABASE_URL` — optional override for fixture B.

### 2.4 Commands and results

| Command | Result |
| --- | --- |
| `pnpm --filter @umi/contract test` | **143 pass, 0 fail** |
| `pnpm --filter @umi/contract generate:check` | **pass**; `Generated UMI contract 2.57.0 (f97644a71bb6b83391884e88aaffd452f95ed4664d19a9c0a18b4097a80ec14d)` |
| `pnpm --filter @umi/api test` | **226 files pass, 1 skipped; 2,289 tests pass, 29 skipped** |
| `pnpm --filter @umi/api typecheck` | **pass** |
| `pnpm --filter @umi/api lint` | **pass** |
| `vitest run --config vitest.integration.config.ts src/modules/metrics/metrics.integration.ts src/modules/metrics/metrics.parity.integration.ts` | **16 pass** (11 integration, 5 parity) |
| `vitest run --config vitest.integration.config.ts src/modules/dashboard-operations/sales-analysis.integration.ts src/app-graph.integration.ts` | **10 pass** (8 legacy sales, 2 app graph) |
| `vitest run --config vitest.integration.config.ts src/shared/database/sql-preflight.integration.ts` | **3 pass**; 1,257 statements prepared; 137/155 interpolated statements reconstructed; 18 uncovered; 0 unresolved |
| `git diff --name-status 4da41dfd...750c9bfe` | **30 files**, 7,869 insertions, 20 deletions |
| `git diff --shortstat 4da41dfd...750c9bfe` | `30 files changed, 7869 insertions(+), 20 deletions(-)` |

The integration command shape was:

```sh
cd apps/umi-api
DATABASE_URL_APP=<app-role URL for umi_verify_293> \
DATABASE_URL_WORKER=<worker-role URL for umi_verify_293> \
JWT_SECRET=<local test value> \
REDIS_URL=<local Redis URL> \
./node_modules/.bin/vitest run --config vitest.integration.config.ts <test files>
```

The fixture B cross-check uses `METRICS_I1_APP_DATABASE_URL` and `METRICS_I1_WORKER_DATABASE_URL` when set, and otherwise defaults to `umi_i1_exec_2f52a6d5`.

## 3. Raw evidence links

### 3.1 CI

Workflow run: <https://github.com/umiconsulting/umi/actions/runs/43795289578>

All check runs report `head_sha = 750c9bfee8b6b6809d131af0b1e0a33ad881def7`. Final result: 18 pass, 7 skipped, 0 fail. The 7 skipped checks are release and deploy jobs, `cash`, `landing`, and `CodeRabbit`. The `pos / build the iOS target` job completed success after my first read.

| Check | State | Job URL |
| --- | --- | --- |
| `gate` | success | <https://github.com/umiconsulting/umi/actions/runs/43795289428/job/133062617304> |
| `api / gate` | success | <https://github.com/umiconsulting/umi/actions/runs/43795289578/job/133063361880> |
| `build-and-test` | success | <https://github.com/umiconsulting/umi/actions/runs/43795289428/job/133062617073> |
| `api / build-and-test` | success | <https://github.com/umiconsulting/umi/actions/runs/43795289578/job/133063361956> |
| `contract` | success | <https://github.com/umiconsulting/umi/actions/runs/43795289443/job/133062617122> |
| `contract / contract` | success | <https://github.com/umiconsulting/umi/actions/runs/43795289578/job/133062617916> |

The earlier FAIL head `0ec5de71` had `gate` and `api / gate` red. The `gate` log named the exact failure:

```text
NEW uncovered file: modules/metrics/metrics.repository.ts (3) — measure it, or name it in UNCOVERED_EXPECTED
```

`db/check.sh:29` runs `test:integration:schema`, which includes `sql-preflight.integration.ts`.

### 3.2 Test files

| File | Purpose |
| --- | --- |
| [`packages/contract/test/metrics.test.mjs`](https://github.com/umiconsulting/umi/blob/750c9bfee8b6b6809d131af0b1e0a33ad881def7/packages/contract/test/metrics.test.mjs) | Contract: catalogue, matrix, strict body, field errors, route table |
| [`apps/umi-api/src/modules/metrics/metrics.repository.spec.ts`](https://github.com/umiconsulting/umi/blob/750c9bfee8b6b6809d131af0b1e0a33ad881def7/apps/umi-api/src/modules/metrics/metrics.repository.spec.ts) | Formula pins, payment envelope, merged row cut |
| [`apps/umi-api/src/modules/metrics/metrics.integration.ts`](https://github.com/umiconsulting/umi/blob/750c9bfee8b6b6809d131af0b1e0a33ad881def7/apps/umi-api/src/modules/metrics/metrics.integration.ts) | Golden fixture A and B, auth, scope, row cut |
| [`apps/umi-api/src/modules/metrics/metrics.parity.integration.ts`](https://github.com/umiconsulting/umi/blob/750c9bfee8b6b6809d131af0b1e0a33ad881def7/apps/umi-api/src/modules/metrics/metrics.parity.integration.ts) | 14-metric parity and payment multiset |
| [`apps/umi-api/src/modules/metrics/metrics.service.spec.ts`](https://github.com/umiconsulting/umi/blob/750c9bfee8b6b6809d131af0b1e0a33ad881def7/apps/umi-api/src/modules/metrics/metrics.service.spec.ts) | Permission and location scope |
| [`apps/umi-api/src/modules/metrics/metrics.formulas.spec.ts`](https://github.com/umiconsulting/umi/blob/750c9bfee8b6b6809d131af0b1e0a33ad881def7/apps/umi-api/src/modules/metrics/metrics.formulas.spec.ts) | Formula units |
| [`apps/umi-api/src/shared/database/sql-preflight.integration.ts`](https://github.com/umiconsulting/umi/blob/750c9bfee8b6b6809d131af0b1e0a33ad881def7/apps/umi-api/src/shared/database/sql-preflight.integration.ts) | SQL preflight and the accepted uncovered entry |
| [`apps/umi-api/test/integration/sales-analysis-fixture.ts`](https://github.com/umiconsulting/umi/blob/750c9bfee8b6b6809d131af0b1e0a33ad881def7/apps/umi-api/test/integration/sales-analysis-fixture.ts) | Fixture A, including one cash tender and one wallet allocation |
| [`apps/umi-api/src/modules/dashboard-operations/sales-analysis.integration.ts`](https://github.com/umiconsulting/umi/blob/750c9bfee8b6b6809d131af0b1e0a33ad881def7/apps/umi-api/src/modules/dashboard-operations/sales-analysis.integration.ts) | Legacy sales suite with the new tender rows |
| [`apps/umi-api/src/app-graph.integration.ts`](https://github.com/umiconsulting/umi/blob/750c9bfee8b6b6809d131af0b1e0a33ad881def7/apps/umi-api/src/app-graph.integration.ts) | Module graph |

## 4. Defects D1–D5

### D1 — `payment_mix` had no `method`

**Defect.** The query aliased the column as `method`, but the mapper read `row.key`. The item was `{"amountMinorUnits":19500}` with no `method`. `MetricsPaymentDistribution.safeParse` failed. `MetricsResponse.parse` then threw, and the route returned 500 whenever a committed tender existed.

**Observation at `0ec5de71`.** The new integration test observed `method: undefined` and `safeParse=false`. The old-head repository and the new test prove the same defect. I did not re-run the old HTTP 500; the service `MetricsResponse.parse` is the step that produced it.

**Observation at `750c9bfe`.** A real HTTP probe used the real `AppModule` with Fastify, the cookie parser, fixture A in `umi_verify_293`, a signed `umi_access` cookie for `ids.session`, and `umi_csrf` with `x-umi-csrf`.

Request:

```text
POST /api/merchants/<merchantId>/metrics/query
{"metrics":["payment_mix"],"dimensions":[],"range":"last_30_days"}
```

| Scope | Status | Payment value |
| --- | --- | --- |
| All locations | 201 | `cash:19500`, `totalItems:1`, `total:19500` |
| Centro location | 201 | `cash:19500`, `wallet:5000`, `totalItems:2`, `total:24500` |

`MetricsPaymentDistribution.safeParse` returned `true`. `MetricsResponse.safeParse` returned `true`.

**Covering tests.** `metrics.integration.ts:200` (`returns the committed cash tender with its method and a valid envelope`); `metrics.repository.spec.ts:131` (`pins every golden formula and reports one statement per family`); `metrics.parity.integration.ts:238` (`compares a non-empty payment mix as a multiset`).

**Code.** `metrics.repository.ts:48-50` (`PaymentRow.method`), `:489-518` (mapper reads `row.method` at `:510`); `metrics.service.ts:28` (`MetricsResponse.parse`).

### D2 — the row limit was applied per family, then the union was not cut

**Defect.** The SQL applied `LIMIT` to each metric family. The union was not capped or counted. `rowsTotal` used `max` instead of the union size.

**Observation at `0ec5de71`.** The new unit tests failed as expected:

| Test | Old head |
| --- | --- |
| `reports the distinct total before the cut and no synthetic row` | expected 1 row, got 5 |
| `cuts the merged tuple union once across metric families` | expected 1 row, got 2 |

**Observation at `750c9bfe`.**

Request:

```text
{"metrics":["items_sold","refunds"],"dimensions":["day"],"range":"last_30_days","limit":1}
```

| Case | Result |
| --- | --- |
| `limit:1` | 1 row; `truncated:true`; `rowsTotal:2` |
| `limit:5` | 2 rows; `truncated:false`; no `rowsTotal` |
| Same-day merge | `2026-11-02` has `items_sold:3` and `refunds:9000` in one tuple |

The returned row is a real day, `2026-11-02`. There is no synthetic row for a day with no data.

**Covering tests.** `metrics.repository.spec.ts:376`, `:409`, `:444`; `metrics.integration.ts:276` (`cuts rows at the limit and reports the count before the cut`).

**Code.** `metrics.repository.ts:364-426`: merge into one map, sort, `rowsTotal = rows.length`, `truncated = rowsTotal > limit`, one `slice`. No per-family `LIMIT` on this path.

### D3 — the SQL preflight gate was red

**Defect.** The preflight found three new uncovered statements in `modules/metrics/metrics.repository.ts`. The gate refused the new file.

**Observation at `0ec5de71`.** CI `gate` failed with `NEW uncovered file: modules/metrics/metrics.repository.ts (3) — measure it, or name it in UNCOVERED_EXPECTED`. The same three statements were uncovered in the local preflight.

**Observation at `750c9bfe`.** The preflight passed against `umi_verify_293`:

```text
preflight coverage: 1257 statements PREPAREd verbatim · 137/155 interpolated RECONSTRUCTED and checked · 18 could not be rebuilt (still uncovered) · 4 indeterminate param type (not a schema defect)
preflight verdict:  0 UNRESOLVED (measured, broken) · 18 UNCOVERED (never measured — not approved)
still uncovered: modules/kds/kds.repository.ts×5, modules/metrics/metrics.repository.ts×3, ...
```

The new entry is exact:

```text
modules/metrics/metrics.repository.ts, count: 3
why: dimension-driven SELECT and GROUP BY lists; accepted 2026-11-16
```

Negative control: I changed `count: 3` to `count: 4` in the verify worktree and ran the suite. The result was:

```text
modules/metrics/metrics.repository.ts: expected 4 uncovered, found 3
Tests 1 failed | 2 passed
```

I restored the file. The worktree is clean.

**Covering test.** `sql-preflight.integration.ts:244` plus the preflight tests at `:334` and `:369`.

**Code.** `sql-preflight.integration.ts:244-248`.

### D4 — parity compared 13 of the 14 claimed metrics

**Defect.** `MIGRATED` listed 14 metrics, but `expectTotalsParity` never compared `units_per_ticket`. The value was derivable from `itemsSold` and `orders`. The payment mix parity was vacuous because both fixtures had zero tender and zero allocation rows.

**Observation at `0ec5de71`.** The parity suite passed 4 tests. It compared 13 metrics. Both fixtures had empty payment arrays, so the payment comparison proved nothing. A real payment row exposed D1. The old-head non-empty payment case observed `undefined:19500` and `undefined:5000`.

**Observation at `750c9bfe`.** `metrics.parity.integration.ts` passed 5/5 on `umi_verify_293` in the final run, on `umi_sales_analysis` in the earlier run, and on `umi_i1_exec_2f52a6d5`. The `MIGRATED` list has 14 metrics:

`net_sales`, `orders`, `average_ticket`, `items_sold`, `units_per_ticket`, `discounts`, `tips`, `prior_net_sales`, `payment_mix`, `channel_mix`, `product_mix`, `operator_mix`, `hour_mix`, `series`.

The test compares `units_per_ticket` through `legacyUnitsPerTicket(itemsSold, orders)`:

```ts
Math.floor((itemsSold * 20000 + orders) / (2 * orders)) / 10000
```

The non-empty payment test observed 2 fresh items and 2 legacy items with the same multiset: `cash:19500`, `wallet:5000`.

All-locations exclusion: I ran the app role against `umi_verify_293` with the merchant GUC and no location GUC.

| Scope | Allocations visible | Tenders visible |
| --- | --- | --- |
| Merchant only | 0 | 1 |
| Centro location | 1 | 1 |

The legacy `salesSummary` runs the tender query and the allocation query in the same RLS transaction, so it excludes the location-scoped allocation at all-locations scope in the same way.

**Covering tests.** `metrics.parity.integration.ts:206` (all locations, 14 values), `:212` (one location, 14 values), `:218` (day series as rows), `:238` (non-empty payment multiset), `:293` (second fixture, 14 values).

**Code.** `metrics.parity.integration.ts:19-34` (`MIGRATED`), `:68-78` (`expectTotalsParity`).

### D5 — the tests hid D1 and D2

**Defect.** The repository mock returned `key: 'cash'` for the payment query. The real SQL column is `method`. The integration assertion accepted only an empty `payment_mix`. No test covered `items_sold + refunds` with a limit.

**Observation at `0ec5de71`.** I copied the new test files and the new `sales-analysis-fixture.ts` onto a scratch checkout of `0ec5de71`. I edited no branch file.

| Test file | At `0ec5de71` | At `750c9bfe` |
| --- | --- | --- |
| `metrics.repository.spec.ts` | 3 failed, 6 passed | 9 passed |
| `metrics.integration.ts` | 2 failed, 9 passed | 11 passed |
| `metrics.parity.integration.ts` | 2 failed, 3 passed | 5 passed |

Old-head failures:

- `pins every golden formula and reports one statement per family`: payment envelope `safeParse=false`.
- `reports the distinct total before the cut and no synthetic row`: expected 1 row, got 5.
- `cuts the merged tuple union once across metric families`: expected 1 row, got 2.
- `pins all fifteen metrics against the golden fixture`: `method: undefined`.
- `returns the committed cash tender with its method and a valid envelope`: `safeParse=false`.
- All-locations and one-location parity: `undefined:19500`, `undefined:5000`.
- `compares a non-empty payment mix as a multiset`: `undefined:19500`, `undefined:5000`.

**Observation at `750c9bfe`.** All three files pass: 9, 11, and 5. The mock returns `method: 'cash'`, not `key`.

**Covering tests.** The whole set above, plus `metrics.repository.spec.ts:376` and `:409`.

I restored the old-head scratch worktree with `git checkout --`. It is clean at `0ec5de71`. The reviewed worktree is clean at `750c9bfe`.

## 5. Suite results

| Suite | Command | Result |
| --- | --- | --- |
| Contract | `pnpm --filter @umi/contract test` | 143 pass, 0 fail |
| API unit | `pnpm --filter @umi/api test` | 226 files pass, 1 skipped; 2,289 tests pass, 29 skipped |
| Metrics integration | `vitest ... metrics.integration.ts` | 11 pass |
| Metrics parity | `vitest ... metrics.parity.integration.ts` | 5 pass |
| Legacy sales analysis | `vitest ... sales-analysis.integration.ts` | 8 pass |
| App graph | `vitest ... src/app-graph.integration.ts` | 2 pass |
| SQL preflight | `vitest ... sql-preflight.integration.ts` | 3 pass; 1,257 prepared; 137/155 reconstructed; 18 uncovered; 0 unresolved |
| Typecheck | `pnpm --filter @umi/api typecheck` | pass |
| Lint | `pnpm --filter @umi/api lint` | pass |

`generate:check` passes at contract `2.57.0` with generated hash `f97644a71bb6b83391884e88aaffd452f95ed4664d19a9c0a18b4097a80ec14d`.

## 6. Raw SQL recomputation

I recomputed both fixtures with raw SQL outside the repository. The worker role (`BYPASSRLS`) did the raw sums. The app role did the route reads with the merchant GUC. The window is `2026-10-29..2026-11-04` for both fixtures.

### 6.1 Scalars

| Metric | Fixture A | Fixture B (I1 METRIC) |
| --- | ---: | ---: |
| `net_sales` | 37,500 | 49,500 |
| `orders` | 3 | 4 |
| `average_ticket` | 12,500 | 12,375 |
| `items_sold` | 4 | 7 |
| `units_per_ticket` | 1.3333 | 1.75 |
| `discounts` | 4,000 | 3,000 |
| `tips` | 1,500 | 2,500 |
| `prior_net_sales` | 0 | 0 |
| `refunds` | 9,000 | 24,000 |

Refunds use `total_minor_units - tip_minor_units` on the sale business date. The two I1 exceptions on 2026-11-03 and 2026-11-06 map to sale dates 2026-11-02 (17,000) and 2026-11-04 (7,000), for 24,000. `total_minor_units` alone would report 26,000.

### 6.2 Distributions

| Fixture | `payment_mix` | `channel_mix` | `product_mix` | `operator_mix` | `hour_mix` | `series` |
| --- | --- | --- | --- | --- | --- | --- |
| A | cash 19,500 all locations; cash 19,500 + wallet 5,000 at Centro | `walk_in` 37,500 / 3 | bread 2 / 20,000; coffee 2 / 20,000 | `—` 4 / 40,000 | 04: 1 / 10,000; 10: 2 / 20,000; 11: 1 / 10,000 | 11-02: 28,500; 11-04: 9,000 |
| B | empty | `walk_in` 49,500 / 4 | coffee 5 / 40,000; concha 2 / 10,000 | `—` 7 / 50,000 | 02: 1 / 8,000; 09: 2 / 16,000; 11: 3 / 18,000; 12: 1 / 8,000 | 11-02: 27,000; 11-04: 22,500 |

Each cell is `key totalItems / total`. The all-locations route hides the wallet allocation through RLS. The raw worker read sees it; the app-role read does not. This matches the legacy behavior.

Empty-window probe through the real route with `range: "today"`:

```json
{"net_sales":0,"orders":0,"average_ticket":0,"items_sold":0,"units_per_ticket":null,"discounts":0,"tips":0,"prior_net_sales":0,"refunds":0}
```

## 7. Auth, route, and contract checks

| Case | Observed |
| --- | --- |
| No session cookie | 401 `AUTHENTICATION_REQUIRED` |
| Viewer role without `sale.lifecycle` | 403 `PERMISSION_DENIED` |
| Location scope mismatch | 403 `LOCATION_SCOPE_VIOLATION` |
| Unknown body field | 400 `VALIDATION_FAILED` with `fieldErrors` |
| Duplicate metric | 400 with `fieldErrors.metrics` |
| `limit: 0` with a dimension | 400 with `fieldErrors.limit` |
| `locationId: null` | 400 with `fieldErrors.locationId` |
| Missing `range` | 400 with `fieldErrors.range` |
| Totals response | `rows` absent, `totals` present, contract parse true |
| Rows response | `totals` absent, `rows` present, contract parse true |
| Both `rows` and `totals`, or neither | 400 from the response refinement |
| Row cut | `rowsTotal` appears only with `limit:1`; absent with `limit:5` |
| All six distributions | `totalItems` equals `items.length`; `total` equals the item sum |
| Successful POST | 201 |

Route: `POST /api/merchants/:merchantId/metrics/query`, permission `sale.lifecycle`, contract `2.57.0`.

The controller path is `api/merchants/:merchantId/metrics` plus `@Post('query')` (`metrics.controller.ts:10-22`). The contract route table has one entry at `packages/contract/src/route-table.ts:4727-4744`. The route-table drift test passes.

The service uses `access.locationId ?? query.locationId` at `metrics.service.ts:26`. The effective location is the assignment, not the request body. A scoped caller that sends a different `locationId` gets `LOCATION_SCOPE_VIOLATION` before any read.

Two route behaviors are not gate-1 defects:

1. A successful POST returns 201. The contract does not pin 200.
2. A CSRF refusal returns 403, but the public envelope maps the code to `PERMISSION_DENIED`, because `CSRF_VALIDATION_FAILED` is not in `API_ERROR_CODES`. This is pre-existing.

## 8. Scope

`git diff --name-status 4da41dfd...750c9bfe` lists 30 files, 7,869 insertions, 20 deletions.

| Area | Files |
| --- | --- |
| `apps/umi-api` | 15: app module, dashboard `asOf`, 11 metrics files, preflight, fixture |
| `packages/contract` | 10: `metrics.ts`, `index.ts`, `catalog.ts`, route table, generated artifacts, contract test |
| `docs/verification` | 2: gate evidence and perf JSON |
| `scripts/evidence` | 2: recaptured POS checkout packet |
| `tools/verification` | 1: metrics perf script |

No file changed under `apps/umi-dashboard`, `apps/umi-pos`, `apps/umi-cash`, `insight`, `consumer`, `supabase/migrations`, or `db/migrations`. No dependency file and no lockfile changed.

`apps/umi-api/src/modules/dashboard-operations/dashboard-operations.repository.ts` changes only the internal optional `asOf` argument. The controller and service pass four arguments:

```text
controller -> service.salesSummary(user, merchant, query)
service -> repository.salesSummary(user.id, access.merchantId, query, locationId)
```

Only `metrics.parity.integration.ts` passes `asOf`. The argument is test-only. The public route output does not change.

`packages/contract` advances to `2.57.0`. `generate:check` passes. The two changed `scripts/evidence/runs/pos-checkout-partial-guards/*` files are a recaptured evidence packet, because `packages/contract/src/index.ts` changed. They are not POS product code.

## 9. Performance binding

The 19k evidence request uses `dimensions: []` on `umi_i1_exec_2f52a6d5`:

| Fact | Value |
| --- | --- |
| Database | `umi_i1_exec_2f52a6d5` |
| Merchant | `44444444-4444-4444-8444-000000000001` |
| Location | `44444444-4444-4444-8444-000000000011` |
| Committed sales | 19,000 |
| Cart lines | 76,000 |
| Business dates | 2026-10-10..2026-11-08 |
| Request | all 15 metrics, `dimensions: []`, `last_30_days`, `asOf 2026-11-08` |
| Warmups / runs | 5 / 20 |
| p50 | 1,281.593 ms |
| p95 | 1,293.794 ms |
| max | 1,329.740 ms |
| SQL statements | 11 |

The row path on the same fixture:

| Query | Limit 100 | Uncapped |
| --- | ---: | ---: |
| product dimension | 55.23 ms | 50.08 ms |
| hour dimension | 61.52 ms | 61.08 ms |

The fixture has 4 product groups and 1 hour group. The row-path cost is small on this fixture. The row-cut change does not invalidate the totals measurement.

## 10. Residual risks

1. **`payment_mix` does not dedupe the tender and allocation sources.** A sale that uses cash and wallet can count the wallet amount twice. This is intentional for gate 1 because parity governs. Dedupe is out of this migration. Gate 3 owns the overlap correction.
2. **No per-family SQL `LIMIT` on the row path.** A two-dimension `product × hour` read can return up to 4,800 tuples from PostgreSQL before the Node cut. On a large catalogue this raises transfer and memory cost.
3. **A CSRF refusal maps to `PERMISSION_DENIED`.** The route returns 403, but the envelope code is not `CSRF_VALIDATION_FAILED`. This is pre-existing.
4. **A successful POST returns 201.** The contract does not pin a 200 status. Clients must accept 201.
5. **A totals response can carry top-level `truncated: true` when a distribution is cut.** It has no `rowsTotal`. Clients must read the distribution envelope.
6. **`asOf` is an internal test hook.** The route never sends it. A future caller must not pass it.
7. **The all-locations payment exclusion depends on RLS.** The D1 boot guard enforces the app role. A role with `BYPASSRLS` would expose the allocation.

## 11. What I did not verify

- I did not run the full `bash db/check.sh` or every `test:integration:schema` file locally. CI `gate` and `api / gate` passed.
- I did not stress distribution truncation above the fixture cardinality. `payment_mix` has a limit of 8 and `product_mix` a limit of 200. The fixture has 2 payment methods and 2 products. I reviewed the code.
- I did not re-run the old-head HTTP 500. The old-head repository and the new integration tests show the `method: undefined` parse failure that produces it.
- I did not re-run the 19k perf script. I checked the evidence request and measured the row-path SQL directly.
- I did not run the POS iOS build. It completed success in CI after my first read.
- I did not merge and did not deploy. The lead owns those steps.

## 12. Stale claims for the builder

The builder must correct these claims in `docs/verification/2026-11-16-semantic-api-gate1.md` before the copy is final:

1. **Header, line 4: `Verifier verdict: pending`.** Replace it with `PASS at 750c9bfee8b6b6809d131af0b1e0a33ad881def7` and link this report.
2. **Environment table and the `sql-preflight.integration.ts` command row.** The row implies the preflight runs on `umi_sales_analysis`. That database lacks current columns such as `merchant.purchase_days` and `purchase_order.origin`, so the preflight cannot pass there. Name `umi_verify_293` as the current-schema database for the preflight. Keep `umi_sales_analysis` for the seeded fixture only.
3. **Golden fixture A, `payment_mix` row.** The row lists `cash {19,500}, wallet {5,000}` and `match` without a scope. The all-locations route returns cash only. The wallet 5,000 appears only at the Centro location. Split the row by scope.
4. **Parity section: `The units_per_ticket parity check passes at both heads, because the value was correct.`** This is false for `0ec5de71`. The value was correct at both heads, but no comparison existed at `0ec5de71`; that was D4. Say the value was correct and the comparison is new at `750c9bfe`.
5. **Commands table, `bash db/check.sh` and `pnpm check:pr` rows.** These are builder runs, not verifier reproductions. Label them as builder evidence. The verifier ran the suites in section 5 and the CI checks in section 3.

## 13. Signature

| Field | Value |
| --- | --- |
| Author | `umi-verifier` |
| Role | Verification and Eval Lead, independent gate |
| Date | 2026-11-16 UTC (2026-11-15, America/Mazatlan) |
| Pull request | #293 |
| Reviewed head SHA | `750c9bfee8b6b6809d131af0b1e0a33ad881def7` |
| Base SHA | `4da41dfd8f60748c761b191caf7dd8eb7e909ace` |
| Report SHA256 (canonical body, sections 1–12) | `6022c37f0274ba09a90e79e728fc64334ee80594fe0f141b97970173cb7f666b` |
| Delivered file SHA256 | in `2026-11-16-gate1-verifier.sha256` |
| Code edits | none |
| Merge or deploy | none |

The canonical body is every byte before this section. The sidecar file holds the SHA-256 of the complete delivered report, including this block. From `.verify/`, run:

```sh
sha256sum -c 2026-11-16-gate1-verifier.sha256
```

I authored this report independently. I ran the checks on the real artifact. I edited no code and no tracked file. I did not merge and did not deploy.
