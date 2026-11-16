# Gate 2 verification report — semantic analytics API v1

**Verdict: PASS at `ac6988ce3338297d8be83e0984eea48fde87f371`.**

| Field | Value |
| --- | --- |
| Repository | `umiconsulting/umi` |
| Pull request | #293 |
| Branch | `feat/semantic-analytics-api-v1-20261116` |
| Base | `4da41dfd8f60748c761b191caf7dd8eb7e909ace` (`origin/staging`) |
| Gate-1 head | `750c9bfee8b6b6809d131af0b1e0a33ad881def7` |
| Reviewed head | `ac6988ce3338297d8be83e0984eea48fde87f371` |
| Origin branch head | `ac6988ce3338297d8be83e0984eea48fde87f371` |
| Verification worktree | `.worktrees/verify-293-ac6988ce` |
| Worktree state | clean; 0 status entries |
| Code edits by verifier | none |
| Tracked-file edits by verifier | none |
| Merge or deploy by verifier | none |
| Report date | 2026-11-15, America/Mazatlan (2026-11-16 UTC) |

## 1. Independence and method

I am `umi-verifier`. I wrote none of the gate-2 files. I ran every check on the real artifact in a fresh worktree at the reviewed head.

The method follows the stop hook of the gate contract:

1. Read the contract and the gate-2 brief.
2. Confirm the head, the branch, and the scope.
3. Read the ledger and reproduce its hashes.
4. Rerun every requested suite on PostgreSQL with RLS.
5. Read CI and the PR state.
6. Record the evidence and the verdict.

I did not edit a tracked file. I did not change the branch. I did not merge and did not deploy.

A fresh detached worktree held the reviewed head:

```sh
git worktree add --detach .worktrees/verify-293-ac6988ce ac6988ce3338297d8be83e0984eea48fde87f371
```

The builder worktree was not used for a check.

## 2. Head and scope

### 2.1 Head

| Check | Result |
| --- | --- |
| `git rev-parse HEAD` | `ac6988ce3338297d8be83e0984eea48fde87f371` |
| `git rev-parse origin/feat/semantic-analytics-api-v1-20261116` | `ac6988ce3338297d8be83e0984eea48fde87f371` |
| `git status --porcelain` | empty |
| `git rev-parse origin/staging` | `4da41dfd8f60748c761b191caf7dd8eb7e909ace` |

The head commit is `docs(api): clarify the gate-2 prior net sales rule`, dated 2026-11-15 20:48:56 −0700.

### 2.2 Scope control

`git diff --name-status 750c9bfe..ac6988ce` returns 9 files:

| Change | File |
| --- | --- |
| M | `.prettierignore` |
| A | `apps/umi-api/src/modules/metrics/metrics.parity-matrix.integration.ts` |
| A | `apps/umi-api/src/modules/metrics/metrics.refunds-oracle.integration.ts` |
| A | `apps/umi-api/test/integration/metrics-parity-normalize.ts` |
| A | `apps/umi-api/test/integration/refunds-oracle-fixture.ts` |
| A | `docs/verification/2026-11-16-semantic-api-gate1-verifier.md` |
| M | `docs/verification/2026-11-16-semantic-api-gate1.md` |
| A | `docs/verification/2026-11-16-semantic-api-gate2-parity.json` |
| A | `docs/verification/2026-11-16-semantic-api-gate2.md` |

`git diff --shortstat 750c9bfe..ac6988ce` reports 9 files changed, 2,236 insertions, 11 deletions.

The diff holds four test files, four files under `docs/verification`, and `.prettierignore`. It holds no product code, no contract file, no route, and no consumer file.

One test file changed at `ac6988ce`. The change is one rule string: `legacy value` becomes `source value` in `NORMALIZATION`. The test count, the cases, and every assertion are the same. This is a wording change only.

The `.prettierignore` change exempts the signed gate-1 report and the generated ledger from Prettier. Both reasons are in the file comments.

The committed gate-1 verifier report is byte-identical to the signed source at `.verify/2026-11-16-gate1-verifier.md`:

| Item | Value |
| --- | --- |
| Committed SHA-256 | `4d40f1bd29d161762a3e227be298e1e95c387933b1e83456a6e24b4507954d6d` |
| Source SHA-256 | `4d40f1bd29d161762a3e227be298e1e95c387933b1e83456a6e24b4507954d6d` |
| `cmp` | no difference |
| Lines | 471 |

## 3. Parity ledger

Path: `docs/verification/2026-11-16-semantic-api-gate2-parity.json`.

| Check | Result |
| --- | --- |
| File SHA-256 | `8986d5ebdb6deea83da5c0215d91d85c892cc5a5c1a41495119d6ee9d6e5377e` |
| Size | 13,824 bytes, 432 lines |
| Record and gate | `2026-11-16-semantic-api-gate2-parity`, gate 2 |
| Fixture | A |
| Metric definition version | `1.0.0` |
| Case count | 24 |
| Case ids | T01–T05, Y01–Y05, W01–W07, M01–M07 |
| Metrics per case | 14 in 24 of 24 cases |
| Fixed `asOf` per case | 24 of 24 |
| Range and scope per case | 24 of 24 |
| Two SHA-256 values per case | 24 of 24 |
| Equal hash pairs | 24 of 24 |
| `result = match` | 24 of 24 |
| Normalization rules | 13 |
| `caseSetSha256` | `fe1365f872f364448a05384ffa2e7e63d9977463b4d8bd4753fc45cacd26f4c5` |

I recomputed the case-set hash outside the test:

```sh
node -e "const fs=require('fs'),c=require('crypto');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(c.createHash('sha256').update(JSON.stringify(j.cases)).digest('hex'))" docs/verification/2026-11-16-semantic-api-gate2-parity.json
```

The command returns `fe1365f872f364448a05384ffa2e7e63d9977463b4d8bd4753fc45cacd26f4c5`. This equals the ledger value.

### 3.1 Coverage

I counted non-empty cases from the case rows, not from the ledger summary.

| Range | all | centro | norte | Non-empty total |
| --- | --- | --- | --- | --- |
| `today` | 2 | 1 | 1 | 4 |
| `yesterday` | 2 | 1 | 1 | 4 |
| `last_7_days` | 3 | 2 | 1 | 6 |
| `last_30_days` | 4 | 1 | 1 | 6 |
| Total | 11 | 5 | 4 | 20 |

All 12 range × scope cells are non-empty. The matrix has four empty cells: T04, Y04, W06, M06. The ledger reports `emptyCells = 4` and 12 boundary cells.

### 3.2 Comparison with the ledger at `4b9510a6`

`git show 4b9510a6:docs/verification/2026-11-16-semantic-api-gate2-parity.json` has file SHA-256 `293231552a1092f17ff9cd023e209691ba2c89f347c2e2ac99d26a7644718a32`.

The comparison result is:

| Field | Equal between `4b9510a6` and head |
| --- | --- |
| `cases` | yes |
| `metrics` | yes |
| `coverage` | yes |
| `caseSetSha256` | yes |
| Normalization prefix | yes |

The diff has 7 changed lines. It adds five normalization rules and one comma. The rule count moves from 8 to 13. No expected value changed. No case value changed. No coverage value changed.

This is the "no concealed difference" check. It passes.

## 4. Test reruns

### 4.1 Environment

| Item | Value |
| --- | --- |
| PostgreSQL | container `umi-sales-analysis-pg`, `127.0.0.1:5543` |
| Database for the matrix and integration suites | `umi_verify_293` |
| Database for fixture B | `umi_i1_exec_2f52a6d5` |
| Roles | `api_login` (RLS-confined), `worker_login` (`BYPASSRLS`) |
| Redis | `redis://127.0.0.1:6379` |
| Test mode | `UMI_ENVIRONMENT=test` |

The local test roles use the passwords that `metrics.parity.integration.ts:273-276` already records for fixture B. This report does not write them.

The fresh worktree needed two setup steps. The global pnpm store is read-only here, so the install used a store under `.verify/`. The install skipped lifecycle scripts because `sharp` writes to the read-only npm cache. These tests do not use `sharp`. I built the contract runtime before the tests:

```sh
pnpm install --frozen-lockfile --prefer-offline --ignore-scripts \
  --package-import-method=hardlink \
  --store-dir /home/juan/Projects/umiconsulting/umi/.verify/pnpm-store
pnpm --filter @umi/contract build:runtime
```

The worktree stayed clean after both steps.

### 4.2 Integration suites

Command shape:

```sh
cd apps/umi-api
set -a; . /home/juan/Projects/umiconsulting/umi/.verify/umi-verify-293.env; set +a
export UMI_ENVIRONMENT=test REDIS_URL=redis://127.0.0.1:6379 JWT_SECRET=<local test value>
./node_modules/.bin/vitest run --config vitest.integration.config.ts <test file>
```

| Test file | Required count | Result |
| --- | --- | --- |
| `src/modules/metrics/metrics.parity-matrix.integration.ts` | 27 | **27 passed** |
| `src/modules/metrics/metrics.refunds-oracle.integration.ts` | 5 | **5 passed** |
| `src/modules/metrics/metrics.parity.integration.ts` | 5 | **5 passed** |
| `src/modules/metrics/metrics.integration.ts` | 11 | **11 passed** |
| `src/app-graph.integration.ts` | 2 | **2 passed** |
| `src/shared/database/sql-preflight.integration.ts` | 3 | **3 passed** |

The matrix count is 24 case tests, one count guard, one coverage guard, and one ledger-reproduction test. The ledger test reads the committed file and compares the parsed object with the object that the run builds. It passed. This proves the file bytes and the case-set hash.

I ran the matrix a second time after the refunds oracle had seeded its fixture. It passed again with 27 tests. The ledger file SHA-256 stayed `8986d5ebdb6deea83da5c0215d91d85c892cc5a5c1a41495119d6ee9d6e5377e`.

### 4.3 Contract, typecheck, and lint

| Command | Result |
| --- | --- |
| `pnpm --filter @umi/contract test` | **143 pass, 0 fail, 0 skipped** |
| `pnpm --filter @umi/api typecheck` | exit 0, no diagnostics |
| `pnpm --filter @umi/api lint` | exit 0, no warnings |

`git status --porcelain` was empty before and after the contract test. The contract `pretest` build did not change a tracked file.

### 4.4 SQL preflight on `umi_verify_293`

```text
preflight coverage: 1257 statements PREPAREd verbatim · 137/155 interpolated RECONSTRUCTED and checked · 18 could not be rebuilt (still uncovered) · 4 indeterminate param type (not a schema defect)
preflight verdict:  0 UNRESOLVED (measured, broken) · 18 UNCOVERED (never measured — not approved)
```

The uncovered set is the same as the gate-1 run. It includes `modules/metrics/metrics.repository.ts×3`, which the gate-1 accepted list already names. The preflight test passed with 3 tests.

## 5. Refunds oracle

The test passed 5 of 5. I also read the fixture rows directly with SQL, filtered to the merchant that this run created (`Devoluciones de prueba`).

| Check | Expected | Measured |
| --- | --- | --- |
| `refunds`, `today` at 2026-11-03 | 22,000 | 22,000 (test) |
| `net_sales`, `today` at 2026-11-03 | 38,500 | 38,500 (test) |
| Committed gross | 24,500 | 24,500 (SQL) |
| Committed tips | 2,500 | 2,500 (SQL) |
| Committed gross minus tips | 22,000 | 22,000 (SQL) |
| All statuses, sale date 2026-11-03 | 23,000 | 23,000 (SQL) |
| Exception-date attribution | 31,000 | 31,000 (SQL) |
| `refunds`, `last_7_days` at 2026-11-07 | 31,000 | 31,000 (test) |
| `net_sales`, `last_7_days` at 2026-11-07 | 48,500 | 48,500 (test) |

The by-type SQL rows are:

| Type | Gross | Tips | Net |
| --- | --- | --- | --- |
| `full_refund` | 11,000 | 2,000 | 9,000 |
| `partial_refund` | 4,500 | 500 | 4,000 |
| `void` | 9,000 | 0 | 9,000 |

### 5.1 Fixture isolation

The refunds fixture creates a random merchant, a random location, a random user, and a random product. The seed has no `DELETE`, `TRUNCATE`, or `UPDATE` statement. It does not touch fixture A.

Fixture A is unchanged. The matrix uses fixture A. It passed twice, before and after the refunds seed, with the same ledger hash.

## 6. CI at the reviewed head

All check runs report `head_sha = ac6988ce3338297d8be83e0984eea48fde87f371`. The read has one distinct `head_sha`.

| State | Count |
| --- | --- |
| Success | 15 |
| Skipped | 3 |
| In progress | 1 |
| Failed, timed out, cancelled, or action required | 0 |
| Total | 19 |

### 6.1 Required contexts

| Required context | State | Conclusion |
| --- | --- | --- |
| `lint` | completed | success |
| `contract` | completed | success |
| `tokens` | completed | success |
| `build-and-test` | completed | success |
| `gate` | completed | success |
| `api / gate` | completed | success |
| `api / build-and-test` | completed | success |

GitHub names the two API contexts with spaces around the slash. They are the contexts in the brief.

### 6.2 Other check runs

| Check | Conclusion |
| --- | --- |
| `changes` | success |
| `contract / contract` | success |
| `dashboard / build` | success |
| `lint / lint` | success |
| `secrets` | success |
| `tokens / tokens` | success |
| `Vercel Preview Comments` | success |
| `workflows` | success |
| `cash` | skipped |
| `landing` | skipped |
| `CodeRabbit` | skipped |
| `pos / build the iOS target` | in progress at read time |

`pos / build the iOS target` is not a required context. It was still in progress at 20:59 America/Mazatlan. It has no failed conclusion.

### 6.3 Workflow run ids

| Workflow | Run id | State |
| --- | --- | --- |
| CI | `43800387414` | in progress |
| API validation | `43800387208` | success |
| Code quality | `43800387213` | success |
| Contract validation | `43800387193` | success |
| Token validation | `43800387337` | success |

## 7. Pull request state

| Field | Value |
| --- | --- |
| State | OPEN |
| Mergeable | `MERGEABLE` |
| Draft | no |
| Head | `ac6988ce3338297d8be83e0984eea48fde87f371` |
| Base | `staging` |
| Title | `feat(api): semantic analytics metrics query (gate 1)` |

The body is stale. It still says:

- Line 1: `## Gate 1 — semantic analytics API v1`.
- Line 27: parity with `GET reports/sales`, 4 pass. The gate-2 count is 5.
- Line 67: `Independent verifier: pending, in a fresh thread.`
- Line 68: `CI: pending.`

This is a record item. It does not change the code verdict.

## 8. Findings

| Id | Finding | Severity | Effect on the verdict |
| --- | --- | --- | --- |
| F1 | The PR title and body still say gate 1 and pending. The body also says a parity count of 4, but the suite now has 5. | Documentation lag | None. The lead should update the PR text before merge. |
| F2 | The builder document says the matrix and refunds oracle run on `umi_sales_analysis`. I ran them on `umi_verify_293`, the current-schema clone. | Environment difference | None. Both databases have the current schema. The counts and the ledger bytes match. |
| F3 | `pos / build the iOS target` was in progress at read time. | Not required | None. It is not a required context and has no failed conclusion. |
| F4 | The legacy side has no `units_per_ticket` field. The test derives it with the same half-up formula as the route. | Documented residual | None. The gate-2 document names this rule. Parity for this one field is a formula check, not a two-source check. |
| F5 | The matrix uses the repository read, not the HTTP route. | Documented residual | None for gate 2. The gate-1 integration and verifier runs cover the route. |

No expected value changed between the ledger at `4b9510a6` and the ledger at the head. The only ledger change is the normalization list, from 8 to 13 rules.

## 9. Coverage and limits

Checks that ran:

- Head, origin branch, and worktree state.
- Scope between the gate-1 head and the head.
- Ledger file hash, structure, pairs, rules, case-set hash, and coverage.
- Ledger comparison with `4b9510a6`.
- Matrix, refunds oracle, gate-1 parity, metrics integration, and app-graph on PostgreSQL with RLS.
- Refunds values by SQL.
- Contract tests, API typecheck, API lint, and SQL preflight.
- CI check runs and workflow runs.
- PR state and body.

Checks that did not run:

- The full API unit suite (`pnpm test`, 226 files). The brief did not request it. The contract suite, the five integration files, typecheck, and lint ran.
- The HTTP route for the 14 metrics in gate 2. Gate 1 covered the route. Gate 2 covers the repository read.
- A staging deploy. This gate authorizes staging only. No deploy ran.
- Cash, dashboard, landing, and POS app behavior. They are outside this scope and did not change.

## 10. Reproduction

```sh
cd /home/juan/Projects/umiconsulting/umi
git fetch origin feat/semantic-analytics-api-v1-20261116
git worktree add --detach .worktrees/verify-293-ac6988ce ac6988ce3338297d8be83e0984eea48fde87f371
cd .worktrees/verify-293-ac6988ce
git rev-parse HEAD
git status --porcelain
git diff --name-status 750c9bfe..ac6988ce
git diff --shortstat 750c9bfe..ac6988ce
shasum -a 256 docs/verification/2026-11-16-semantic-api-gate2-parity.json
```

```sh
pnpm install --frozen-lockfile --prefer-offline --ignore-scripts \
  --package-import-method=hardlink \
  --store-dir /home/juan/Projects/umiconsulting/umi/.verify/pnpm-store
pnpm --filter @umi/contract build:runtime
```

```sh
cd apps/umi-api
set -a; . /home/juan/Projects/umiconsulting/umi/.verify/umi-verify-293.env; set +a
export UMI_ENVIRONMENT=test REDIS_URL=redis://127.0.0.1:6379 JWT_SECRET=<local test value>
./node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/metrics/metrics.parity-matrix.integration.ts
./node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/metrics/metrics.refunds-oracle.integration.ts
./node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/metrics/metrics.parity.integration.ts
./node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/metrics/metrics.integration.ts
./node_modules/.bin/vitest run --config vitest.integration.config.ts src/app-graph.integration.ts
./node_modules/.bin/vitest run --config vitest.integration.config.ts src/shared/database/sql-preflight.integration.ts
```

```sh
cd /home/juan/Projects/umiconsulting/umi/.worktrees/verify-293-ac6988ce
pnpm --filter @umi/contract test
pnpm --filter @umi/api typecheck
pnpm --filter @umi/api lint
```

```sh
gh pr view 293 --repo umiconsulting/umi --json number,title,state,isDraft,mergeable,headRefOid,baseRefName,url,body
gh api --paginate "repos/umiconsulting/umi/commits/ac6988ce3338297d8be83e0984eea48fde87f371/check-runs?per_page=100"
gh api --paginate "repos/umiconsulting/umi/actions/runs?head_sha=ac6988ce3338297d8be83e0984eea48fde87f371&per_page=100"
```

## 11. Sign-off

**PASS at `ac6988ce3338297d8be83e0984eea48fde87f371`.**

The bar is met:

- The head is exact and the branch matches.
- The worktree is clean.
- The scope is test and documentation only.
- The ledger hash, the case set, the pairs, the rules, and the coverage match.
- No expected value changed from `4b9510a6`.
- Every requested suite passes at the required count.
- The refunds oracle pins the numbers and the fixture is isolated.
- Every required CI context passes at the head.

I did not edit the branch. I did not merge. I did not deploy.

The lead owns the merge. The lead should correct the PR title and body first (F1).
