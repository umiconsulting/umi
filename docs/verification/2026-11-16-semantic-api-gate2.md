# Gate 2 evidence — semantic analytics API v1

Date: 2026-11-16, America/Mazatlan.
Builder: umi-builder. Verifier: umi-verifier.
Branch: `feat/semantic-analytics-api-v1-20261116`.
Base: `origin/staging` `4da41dfd`.
Gate-1 head: `750c9bfe`.
PR: #293. State: open. No merge. No deploy. No `main`.

## Scope

Gate 2 adds four items:

1. The signed gate-1 verifier report, copied byte for byte.
2. Corrected gate-1 records.
3. A 24-case parity matrix with a committed ledger.
4. A refunds oracle on an isolated fixture.

Gate 2 changes no consumer and no old endpoint.
It changes no sales number and no contract response.
It does not deduplicate payments. Gate 3 owns that change.

## Gate-1 record corrections

| Item                  | Before                                 | After                                                |
| --------------------- | -------------------------------------- | ---------------------------------------------------- |
| Verdict in the header | `pending`                              | PASS at `750c9bfe`, with a link to the signed report |
| Parity count          | Not stated                             | 5 cases, with a pointer to the gate-2 matrix         |
| Verifier checklist    | A list of eight tasks for the verifier | The verdict and the report link                      |
| FAIL history          | At `0ec5de71`                          | Kept                                                 |
| D1-D5 table           | Present                                | Kept                                                 |
| Merge rule            | "Do not merge. The Chief merges."      | Kept                                                 |

The verifier report is at `docs/verification/2026-11-16-semantic-api-gate1-verifier.md`.
Source: `/home/juan/Projects/umiconsulting/umi/.verify/2026-11-16-gate1-verifier.md`.
Source SHA-256: `4d40f1bd29d161762a3e227be298e1e95c387933b1e83456a6e24b4507954d6d`.
Copied SHA-256: the same value. `cmp` reports no difference.

The report states **PASS at `750c9bfe`** and keeps the **FAIL at `0ec5de71`**.
This document does not edit the report text.

## Files

| File                                                                     | Change                                              |
| ------------------------------------------------------------------------ | --------------------------------------------------- |
| `apps/umi-api/src/modules/metrics/metrics.parity-matrix.integration.ts`  | New 24-case matrix and ledger check                 |
| `apps/umi-api/test/integration/metrics-parity-normalize.ts`              | New canonical shape and hash rules                  |
| `apps/umi-api/src/modules/metrics/metrics.refunds-oracle.integration.ts` | New refunds oracle test                             |
| `apps/umi-api/test/integration/refunds-oracle-fixture.ts`                | New isolated refunds fixture                        |
| `docs/verification/2026-11-16-semantic-api-gate2-parity.json`            | New committed ledger                                |
| `docs/verification/2026-11-16-semantic-api-gate1-verifier.md`            | Verbatim verifier report                            |
| `docs/verification/2026-11-16-semantic-api-gate1.md`                     | Corrected gate-1 records                            |
| `.prettierignore`                                                        | Exempt the verbatim report and the generated ledger |

## Parity matrix

Test: `metrics.parity-matrix.integration.ts`.
Fixture: A. The fixture has two Centro sales on 2026-11-02 and one Norte sale on 2026-11-04.
Each case asks the new read and the legacy `salesSummary` read the same question.
The test compares all 14 migrated metrics: eight scalars and six presets.
The test asserts one row of `rows` or `totals`, no row cut, and no truncated mix.
The test asserts a case count of 20 or more and an id that is unique.
It asserts one non-empty case for every range and scope, at least four empty cells, and the three boundary kinds.

| Case | asOf       | Range          | Scope  | Boundary        | Fresh SHA-256 (12) | Result |
| ---- | ---------- | -------------- | ------ | --------------- | ------------------ | ------ |
| T01  | 2026-11-02 | `today`        | all    | single-day      | `98f8712bbb1f`     | match  |
| T02  | 2026-11-02 | `today`        | centro | single-day      | `b9e4cc47eb6b`     | match  |
| T03  | 2026-11-04 | `today`        | norte  | single-day      | `8d7f3d37a2f0`     | match  |
| T04  | 2026-11-05 | `today`        | all    | empty-cell      | `4e13a758ef3d`     | match  |
| T05  | 2026-11-04 | `today`        | all    | single-day      | `8d7f3d37a2f0`     | match  |
| Y01  | 2026-11-03 | `yesterday`    | all    | single-day      | `98f8712bbb1f`     | match  |
| Y02  | 2026-11-03 | `yesterday`    | centro | single-day      | `b9e4cc47eb6b`     | match  |
| Y03  | 2026-11-05 | `yesterday`    | norte  | single-day      | `8d7f3d37a2f0`     | match  |
| Y04  | 2026-11-02 | `yesterday`    | all    | empty-cell      | `9a226278cb22`     | match  |
| Y05  | 2026-11-05 | `yesterday`    | all    | single-day      | `8d7f3d37a2f0`     | match  |
| W01  | 2026-11-04 | `last_7_days`  | all    | end-inclusive   | `70f758d5cd6a`     | match  |
| W02  | 2026-11-04 | `last_7_days`  | centro | end-inclusive   | `5981227d6f23`     | match  |
| W03  | 2026-11-04 | `last_7_days`  | norte  | end-inclusive   | `06ce23f8b255`     | match  |
| W04  | 2026-11-08 | `last_7_days`  | all    | start-inclusive | `70f758d5cd6a`     | match  |
| W05  | 2026-11-09 | `last_7_days`  | all    | start-exclusive | `291890a6b71e`     | match  |
| W06  | 2026-11-01 | `last_7_days`  | all    | empty-cell      | `9a226278cb22`     | match  |
| W07  | 2026-11-08 | `last_7_days`  | centro | start-inclusive | `5981227d6f23`     | match  |
| M01  | 2026-11-04 | `last_30_days` | all    | end-inclusive   | `70f758d5cd6a`     | match  |
| M02  | 2026-11-04 | `last_30_days` | centro | end-inclusive   | `5981227d6f23`     | match  |
| M03  | 2026-11-04 | `last_30_days` | norte  | end-inclusive   | `06ce23f8b255`     | match  |
| M04  | 2026-11-03 | `last_30_days` | all    | end-exclusive   | `59b044a49fba`     | match  |
| M05  | 2026-11-02 | `last_30_days` | all    | end-inclusive   | `59b044a49fba`     | match  |
| M06  | 2026-10-05 | `last_30_days` | all    | empty-cell      | `9a226278cb22`     | match  |
| M07  | 2026-11-08 | `last_30_days` | all    | end-inclusive   | `70f758d5cd6a`     | match  |

Every case records the fresh hash and the legacy hash in the ledger.
The two hashes are equal in every case.

### Coverage

| Range          | all | centro | norte | Cases | Non-empty cases |
| -------------- | --- | ------ | ----- | ----- | --------------- |
| `today`        | 2   | 1      | 1     | 5     | 4               |
| `yesterday`    | 2   | 1      | 1     | 5     | 4               |
| `last_7_days`  | 3   | 2      | 1     | 7     | 6               |
| `last_30_days` | 4   | 1      | 1     | 7     | 6               |
| Total          | 11  | 5      | 4     | 24    | 20              |

The table cells hold the count of non-empty cases.
The matrix has one empty cell in each range: T04, Y04, W06 and M06.
These cells also prove that `units_per_ticket` is null at zero orders.
The boundary cells are W04 start-inclusive, W05 start-exclusive, M04 end-exclusive and M05 end-inclusive.
The payment multiset has two cases:

- Centro returns `cash:19500` and `wallet:5000` as two rows.
- All locations return `cash:19500` only, because the wallet allocation has a location scope.

### Ledger

Path: `docs/verification/2026-11-16-semantic-api-gate2-parity.json`.
File SHA-256: `293231552a1092f17ff9cd023e209691ba2c89f347c2e2ac99d26a7644718a32`.
Case set SHA-256: `fe1365f872f364448a05384ffa2e7e63d9977463b4d8bd4753fc45cacd26f4c5`.
The test writes the ledger only with `METRICS_GATE2_LEDGER_WRITE=1`.
A rerun without the flag reads the file and compares the parsed object.
Two reruns produced the same bytes.

## Normalization

The test applies these rules to both reads. The code is in `metrics-parity-normalize.ts`.

1. Sort every list by its dimension tuple. The ranks are absent key, then JSON null, then text.
2. `payment_mix` is a multiset. Sort by method and amount. Keep duplicate rows. Never deduplicate tenders and wallet allocations.
3. `product_mix` sorts by `productId`, `productName` and `category`. The measure is `netMinorUnits`.
4. `operator_mix` sorts by `operator`. `hour_mix` sorts by `hour`. The measure is `netMinorUnits`.
5. `channel_mix` sorts by `channel`. `series` sorts by `label`.
6. `units_per_ticket` keeps four decimals, half-up. The value is null at zero orders.
7. A null field stays null. An absent field stays absent. A row copies a key only when the source has it.
8. The compared form excludes the envelope fields: `truncated`, `limit`, `totalItems`, `total`, `capturedAt`, `scope` and `period`.

The ledger hash replaces the random product UUIDs with their fixture role: `bread`, `coffee` and `foreign`.
The comparison uses the raw ids. The alias only keeps the ledger stable across runs.

## Refunds oracle

Test: `metrics.refunds-oracle.integration.ts`.
Fixture: `refunds-oracle-fixture.ts`. The fixture uses a separate merchant, location and product.
Fixture A is unchanged. Its parity suite still passes.

| Sale                  | Sale date  | Type             | Status          | `total` | `tip` | `total - tip` | In `today` |
| --------------------- | ---------- | ---------------- | --------------- | ------- | ----- | ------------- | ---------- |
| `void_sale`           | 2026-11-03 | `void`           | committed       | 9,000   | 0     | 9,000         | yes        |
| `full_refund_sale`    | 2026-11-03 | `full_refund`    | committed       | 11,000  | 2,000 | 9,000         | yes        |
| `partial_refund_sale` | 2026-11-03 | `partial_refund` | committed       | 4,500   | 500   | 4,000         | yes        |
| `uncommitted_sale`    | 2026-11-03 | `partial_refund` | outcome_unknown | 1,000   | 0     | excluded      | no         |
| `outside_sale`        | 2026-11-01 | `full_refund`    | committed       | 10,000  | 1,000 | 9,000         | no         |

The pinned total for `today` at `2026-11-03` is **22,000**.
The test asserts five facts:

- The total is positive: 22,000.
- The status filter holds: all statuses sum to 23,000.
- The sale date holds: the exception date sums to 31,000.
- The tip rule holds: the committed gross total is 24,500, and the tips are 2,500.
- The refunds are separate from `net_sales`: `refunds` is 22,000 and `net_sales` is 38,500.

For `last_7_days` at `2026-11-07`, `refunds` is 31,000 and `net_sales` is 48,500.

## Commands and results

Environment: `umi_sales_analysis` on `127.0.0.1:5543`, roles `api_login` and `worker_login`.
The SQL preflight uses `umi_verify_293`, the current-schema clone.

| Command                                                                                                                     | Result                                                                   |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `npx vitest run --config vitest.integration.config.ts src/modules/metrics/metrics.parity-matrix.integration.ts`             | 27 tests pass: 24 cases, 1 count guard, 1 coverage guard, 1 ledger check |
| `npx vitest run --config vitest.integration.config.ts src/modules/metrics/metrics.refunds-oracle.integration.ts`            | 5 tests pass                                                             |
| `npx vitest run --config vitest.integration.config.ts src/modules/metrics/metrics.parity.integration.ts`                    | 5 tests pass                                                             |
| `npx vitest run --config vitest.integration.config.ts src/modules/metrics/metrics.integration.ts`                           | 11 tests pass                                                            |
| `npx vitest run --config vitest.integration.config.ts src/app-graph.integration.ts`                                         | 2 tests pass                                                             |
| `npx vitest run --config vitest.integration.config.ts src/shared/database/sql-preflight.integration.ts` on `umi_verify_293` | 3 tests pass; 1,257 statements; 18 uncovered; 0 unresolved               |
| `pnpm test`                                                                                                                 | 226 files pass, 1 skipped; 2,289 tests pass, 29 skipped                  |
| `pnpm typecheck`                                                                                                            | pass                                                                     |
| `pnpm lint`                                                                                                                 | pass                                                                     |
| `npx prettier --check` on the changed files                                                                                 | pass                                                                     |
| `pnpm evidence:check`                                                                                                       | 2 packets pass                                                           |
| `pnpm --filter @umi/contract generate:check`                                                                                | `Generated UMI contract 2.57.0 (f97644a7...)`                            |

The SQL preflight does not pass on `umi_sales_analysis`.
That database lacks six current columns, such as `merchant.purchase_days` and `purchase_order.origin`.
The verifier report records the same database-state limit.
The PR adds no production SQL statement.

## Residual risks

- `payment_mix` still concatenates `pos_tender_fact` and `customer_value_tender_allocation`. It does not deduplicate. A mixed payment can count twice. Gate 3 owns the fix.
- The matrix uses the repository read, not the HTTP route. The gate-1 integration and verifier runs cover the route contract.
- The matrix uses fixture A only. The I1 METRIC fixture case stays in gate 1.
- Four empty cells are structural. They prove the empty response, not a data path.
- The ledger hash aliases product UUIDs. A new fixture product needs a new alias.
- The verbatim verifier report is not Prettier-formatted. `.prettierignore` holds the exact path.

## FAIL history

The verifier returned FAIL at `0ec5de71`.
The five defects D1-D5 stay in `2026-11-16-semantic-api-gate1.md`.
The signed report keeps the same FAIL history.
Gate 2 does not delete that history.

## Status

Do not merge. The Chief merges.
The verifier owns the verdict.
This builder makes no PASS claim.
