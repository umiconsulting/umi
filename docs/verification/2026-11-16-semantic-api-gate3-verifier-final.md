# Gate 3 final verification report — semantic analytics consumer migration

**Verdict: FAIL at `f931aa8c6d90a35091837c0c3e385fb4968b407b`.**

All product, contract, oracle, matrix and evidence checks pass at this head. The
gate is not signable because one required CI context is still in progress and
`CI ready` is absent at the final read. Do not merge yet. Re-run the verifier
after the POS iOS job and `CI ready` finish. No product change is needed for the
other findings.

| Field | Value |
| --- | --- |
| Repository | `umiconsulting/umi` |
| Pull request | `#294` |
| Branch | `feat/semantic-consumer-migration-20261116` |
| Base | `dfa7a78a94e696eb67fc4606b281268746128ec8` (`origin/staging`) |
| Reviewed head | `f931aa8c6d90a35091837c0c3e385fb4968b407b` |
| Origin branch head | `f931aa8c6d90a35091837c0c3e385fb4968b407b` |
| Merge base | `dfa7a78a94e696eb67fc4606b281268746128ec8` |
| Verification worktree | `.worktrees/semantic-consumer-20261116` |
| Worktree state | clean; 0 status entries before and after this report |
| Code edits by verifier | none |
| Tracked-file edits by verifier | none |
| Merge or deploy by verifier | none |
| PR state | `OPEN`, draft, `MERGEABLE` |
| CI read | 2026-11-16T06:37:46Z, at `f931aa8c` |

## 1. Independence and method

I am `umi-verifier`. I wrote none of the gate-3 files. I ran every check in the
builder worktree at the reviewed head.

Method:

1. Read `.gate3/VERIFY-FINAL-BRIEF.md`, `.gate3/VERIFY-PLAN.md` and
   `.gate3/DECISIONS.md`.
2. Confirmed the head, branch, base and scope.
3. Verified the docs-only delta and the product delta since the capture head.
4. Recomputed the frozen-oracle hashes, the fixture hash and the gate-2 hashes.
5. Read and checked the 25-cell matrix, the 12 API cases and the narrative record.
6. Reran the contract, oracle, matrix, role-surface and dashboard suites.
7. Started the real API and probed the old and new HTTP paths.
8. Read the real screenshots and measured the crop differences.
9. Read CI once at the end.

I did not edit a tracked file. I did not change the branch. I did not merge. I
did not deploy.

## 2. Head and composition

### 2.1 Head and base

| Check | Result |
| --- | --- |
| `git rev-parse HEAD` | `f931aa8c6d90a35091837c0c3e385fb4968b407b` |
| `git rev-parse origin/feat/semantic-consumer-migration-20261116` | `f931aa8c6d90a35091837c0c3e385fb4968b407b` |
| `git rev-parse origin/staging` | `dfa7a78a94e696eb67fc4606b281268746128ec8` |
| `git merge-base HEAD origin/staging` | `dfa7a78a94e696eb67fc4606b281268746128ec8` |
| `git status --porcelain` | empty |
| PR head | `f931aa8c6d90a35091837c0c3e385fb4968b407b` |
| PR base | `staging` |
| PR draft | `true` (expected) |
| PR mergeable | `MERGEABLE` |

The local `refs/heads/staging` is stale at `70b22960`. The PR base is
`origin/staging` at `dfa7a78a`. The merge base confirms it. This is a local ref
hygiene note, not a gate finding.

### 2.2 Docs-only delta

`f931aa8c` has one parent, `85b1abf4`. The delta `85b1abf4..f931aa8c` is two
docs files only, `+153 −51`. The commit subject is
`docs(analytics): accept the 2.58.0 gate-3 interface`.

| File | Recomputed SHA-256 | Expected |
| --- | --- | --- |
| `docs/architecture/2026-11-16-semantic-analytics-api-spec.md` | `64872de9c481120ce1c8f3ef6e8302a7800f403bcd83db1a88e0f5bfed0e4302` | match, v1.2 |
| `docs/architecture/2026-11-16-semantic-analytics-api-adr.md` | `23cb8dcbb7fbf53dd8113dc655c8375b6cde24f0282dfa98ae1a7a7a88648a12` | match |

No third file is in the docs commit.

### 2.3 Product delta since the capture head

The capture head is `2b08f55c`. The only file under `apps/*/src` or
`packages/*/src` that changed between `2b08f55c` and `f931aa8c` is
`apps/umi-api/src/modules/metrics/metrics.gate3-oracle.integration.ts`.

`apps/umi-api/tsconfig.build.json` excludes `**/*.integration.ts` and `test`.
`apps/umi-api/dist` contains no `metrics.gate3-oracle.integration.js` and no
`gate3-normalize.js` after a fresh build. No compiled product module changed
after the capture.

| Delta | Files | Result |
| --- | ---: | --- |
| `dfa7a78a..f931aa8c` | 236 | 6 gate-3 commits; product, contract, tests, evidence and docs |
| `85b1abf4..f931aa8c` | 2 | docs only |
| `2b08f55c..f931aa8c` | 195 | one excluded integration test, test fixtures, tools, evidence and docs |

## 3. Findings from the FAIL at `2b08f55c`

| Id | State | Evidence |
| --- | --- | --- |
| F1 dashboard matrix | **CLOSED** | 25 checks per phase, 25 compare rows, 25 crops, 76 PNGs per phase. 20 cells are 4 ranges × Centro × 5 views. The 5 extras are `E01`, `E02`, `M01`, `M02`, `S00`. Empty period and payment mix are present. |
| F2 CI | **OPEN** | `pos / build the iOS target` is in progress. `CI ready` is absent. All other required contexts pass at `f931aa8c`. |
| F3 oracle reproducibility | **CLOSED** | `capture-legacy-oracle.ts`, the oracle record and `SHA256SUMS` exist. 31 of 31 hashes pass. `manifest.json` lists `route-live.json`; the test hashes it. |
| F4 fixture | **CLOSED** | `seed.sql` hash `1c1b2137…`; `fixture.json` D0 `2026-11-15`; both phases record the same seed hash and D0. Response scope is `America/Mazatlan`. |
| F5 payment mix | **CLOSED** | Centro: cash and wallet in every range. Norte today: `$0.00`, no payment rows. |
| F6 narrative | **CLOSED** | Narrative is present in both captures. Six today/Centro inputs share hash `a82b4f3b…`. The record names the fixed stub. |
| F7 390 crop | **CLOSED** | The two mobile checks have content crops at 390. Both are byte-equal before and after. |
| F8 series bars | **ACCEPTED** | No bars in either phase. The evidence shows no new difference. I did not reopen it. |
| F9 PR body | **CLOSED** | Title matches. Body matches `.scribe/2026-11-16-gate3/PR-body.md` plus one trailing newline. Draft is expected. |
| F10 SQL preflight | **INFO** | Not re-tested in this pass. The previous run needed a `search_path` repair on a clone. No new effect. |
| F11 live role-surface | **CLOSED OFFLINE / ACCEPTED LIMIT** | The live gate did not run. The offline contract spec passes 29 of 29 and resolves both `metrics.query` and `metrics.insight`. |
| F12 Turbo cache | **INFO** | Not applicable to this pass. The local suites ran directly. |

## 4. Gate-3 requirements 1–10

| # | Requirement | Result | Evidence |
| ---: | --- | --- | --- |
| 1 | One gate-3 PR from `dfa7a78a`; no unrelated product change | **PASS** | Six commits. The product diff is the sales consumer migration, the insight service, the contract, the surface rows and the tests. No other product area changed. |
| 2 | Contract `2.58.0`; contract tests and generation check | **PASS** | `CONTRACT_VERSION = '2.58.0'`. Contract suite: 146 pass, 0 fail. `generate:check` exit 0: `Generated UMI contract 2.58.0`. |
| 3 | A = 7 scalars, B = 6 presets, C = 8 metrics; no dimension or limit | **PASS** | After evidence: one `metrics/query` with 7 metrics, one with 6. Insight service uses 8 metrics. All send `dimensions: []`. No request has `limit`. |
| 4 | New routes mapped; old routes 404; same scope | **PASS** | Live probe: old `GET reports/sales` 404, old `GET reports/sales/insight` 404, new `POST metrics/query` 401, new `POST metrics/insight` 401. Both new routes use `sale.lifecycle`. |
| 5 | No old route-table entry at the base | **PASS** | `git show dfa7a78a:packages/contract/src/route-table.ts` has no `reports/sales` or `reports/sales/insight` entry. Only `reports/sales/analysis` exists. The head adds `metrics.insight` and keeps `metrics.query`. |
| 6 | Layout, labels, interactions, formatting and numbers unchanged | **PASS** | `compare.json`: 25 of 25 match. 23 of 25 crops are byte-equal. The two differences are benign: one capture-time text and one 6-pixel anti-aliasing edge. |
| 7 | SPEC and ADR match the migrated interface | **PASS** | SPEC v1.2 and ADR name both routes at `2.58.0`. The remaining `2.57.0` mentions are historical: the superseded ADR and the change log. |
| 8 | Duplicate formulas removed from `dashboard-operations` | **PASS** | No `salesSummary` or `salesInsight` in `dashboard-operations`. `insightInput` exists only in the new `metrics-insight.service.ts`. |
| 9 | No new dependency, chart library, schema or widget redesign | **PASS** | No `package.json`, lockfile, schema or migration change. `git diff` shows only the test fixture `seed.sql`. |
| 10 | Gate-2 artifacts unchanged | **PASS** | Ledger `8986d5eb…`; case set `fe1365f8…`. The oracle test recomputes both. The ledger file has no diff from the base. |

## 5. Recomputed evidence

### 5.1 Frozen oracle and fixture

| Item | Recomputed value |
| --- | --- |
| `SHA256SUMS` entries | 31 of 31 `OK` |
| Manifest cases | 30 (24 gate-2, 4 gate-1 A, 1 gate-1 B, 1 route-live) |
| Manifest SHA-256 | `2c2c090ec38ed34352cda0a00622a48b95a1c0422c7a510b3704391e5e101812` |
| `SHA256SUMS` SHA-256 | `f87766705fb5093fb573286fa8bcdfa7487d87c49c83628b9b5d655648e1551a` |
| `seed.sql` SHA-256 | `1c1b21373b7909ab3e268aece7867ca8d20399eca58aba5d3236aac5fa7e8d08` |
| `seed-runner.sh` SHA-256 | `1938fb7b1ebc23eef612b43e8da003d84ef7c279d97385da95c1b2517abd08fb` |
| `fixture.json` SHA-256 | `75d3c2187871ae3343149e94d657b1a30d09f64ac0c6169063c3bd09590d1d97` |
| `capture-legacy-oracle.ts` SHA-256 | `142eb0cadbe02d9849f352d99fe0ad65b6e9d3bf0d5f40208e038d4aaa0a33c9` |
| Gate-2 ledger SHA-256 | `8986d5ebdb6deea83da5c0215d91d85c892cc5a5c1a41495119d6ee9d6e5377e` |
| Gate-2 case-set SHA-256 | `fe1365f872f364448a05384ffa2e7e63d9977463b4d8bd4753fc45cacd26f4c5` |

### 5.2 Dashboard evidence

| Item | Recomputed value |
| --- | --- |
| `before/evidence.json` | `004a2b38ed4026608df5dc798d533c93845dc8f6dc5c207cf6289dacda388d3d` |
| `after/evidence.json` | `8909bfbb23491e1f22056a0c8e6b4e8cd8e829a61b5c566bc170f689d9370739` |
| `compare.json` | `5cc4839e5092bf3b0153d2c27a951658160ed98eb6178087238c00942802cccb` |
| `api-matrix.json` | `95e4b89d7ca3490eb9548937b5b4df7df367c79fc634a651f678bab6132f7e49` |
| `narrative-inputs.json` | `abd2d93f5b2f18d91a8351cf3b47b5628f7592b57fb7d24263b5c9866c26d5b2` |
| `README.md` | `82e5caca0d2661254fd87755826f9e5b20e1a61fdb3e09b671d1dccdbb58087f` |
| PNG files | 76 before, 76 after (50 screens + 25 crops + 1 narrative each) |
| Crops | 25 before, 25 after (23 at 1440, 2 at 390) |
| Compare rows | 25; 25 match; 0 mismatch; `seedMatch: true` |
| API cases | 12; 12 match; 0 mismatch |
| D0 | `2026-11-15`, `America/Mazatlan` |
| Seed hash in both phases | `1c1b21373b7909ab3e268aece7867ca8d20399eca58aba5d3236aac5fa7e8d08` |

### 5.3 Payment mix and empty period

- Centro today: `Efectivo 85% $285.00`, `wallet 15% $50.00`.
- Centro yesterday: `Efectivo 100% $180.00`.
- Centro last_7_days: `Efectivo 90% $465.00`, `wallet 10% $50.00`.
- Centro last_30_days: `Efectivo 92% $565.00`, `wallet 8% $50.00`.
- Norte today: `$0.00`, 0 orders, ticket `—`, 0 items, `$0.00` discounts and
  tips, no payment rows, no delta, no chart. The channel text and the empty
  pivot render.

### 5.4 Narrative

| Item | Value |
| --- | --- |
| Today/Centro entries | 6 |
| Unique user-message SHA-256 | `a82b4f3b7af50cc8df9b07209ae4216a6113f44abda39cf5f03623a52bb152a1` |
| Fixed text | `Vendiste $285.00 en 2 órdenes; el ticket promedio fue $142.50.` |
| Screenshot SHA-256, both phases | `b3b5631772933e50bfaaea32096cc78d74b1b2b6ee24653f07469fc36116031c` |
| After request | `POST /metrics/insight`, `{ range: "today", locationId: "<Centro>" }` |

The narrative comes from `tools/verification/fixtures/semantic-gate3/narrative-stub.mjs`.
That file is a fixed-response local stub. It is not a live model call. This is a
stated limit of the evidence.

### 5.5 Screenshot differences

23 of 25 crops are byte-equal between before and after. The two differences are:

| Crop | Pixels | Cause |
| --- | ---: | --- |
| `DB-T-CEN-ANALYSIS-1440.png` | 39, in a 6×8 box | The body text shows the capture time: `11:14 p.m.` before, `11:16 p.m.` after. S00 is a smoke check and does not compare numbers. |
| `DB-T-CEN-HOR-1440.png` | 6, maximum channel difference 1 | A rounded-corner anti-aliasing edge at the right side. |

The two 390 crops are byte-equal. The 1440 summary, four pivots, Norte empty and
the other ranges are byte-equal.

### 5.6 API matrix and permissions

| Check | Result |
| --- | --- |
| 4 ranges × 3 scopes | 12 of 12 match |
| Unscoped account | 200, net `55500` |
| Centro-bound account, Centro | 200 |
| Centro-bound account, Norte | 403 `LOCATION_SCOPE_VIOLATION` |
| All-locations payment mix | `cash` only; the wallet allocation stays out through RLS (P4) |

## 6. Tests run at `f931aa8c`

| Suite | Command | Result |
| --- | --- | --- |
| Contract | `pnpm --filter @umi/contract test` | 146 pass, 0 fail, 0 skipped |
| Contract generation | `pnpm --filter @umi/contract generate:check` | exit 0; contract `2.58.0` |
| API build | `pnpm --filter @umi/api build` | exit 0 |
| Gate-3 oracle | `vitest run … metrics.gate3-oracle.integration.ts` | 4 pass |
| Metrics matrix and integration | `metrics.parity-matrix`, `metrics.integration`, `metrics.refunds-oracle` | 43 pass (27 + 11 + 5) |
| Role-surface contract | `vitest run … role-surface-contract.spec.ts` | 29 pass |
| Dashboard adapter | `vitest run src/lib/sales-metrics.spec.js` | 7 pass |
| Dashboard unit | `pnpm --filter @umi/dashboard test` | 54 files, 752 pass |
| Live route probe | API on `127.0.0.1:4011` | old paths 404; new paths 401 |

I did not rerun the full API unit suite (227 files), the dashboard e2e suite or
`check:pr`. CI covers those. The targeted local suites above pass.

## 7. CI at the exact head

I read CI once, last, at 2026-11-16T06:37:46Z. Every check run reports
`head_sha = f931aa8c6d90a35091837c0c3e385fb4968b407b`.

| Required context | State | Run / job |
| --- | --- | --- |
| `CI ready` | **absent** | `CI` `43816497804` is not complete |
| `lint` | pass | `43816497726` |
| `contract` | pass | `43816497700` |
| `tokens` | pass | `43816497707` |
| `build-and-test` | pass | `43816497718` |
| `gate` | pass | `43816497718` |
| `api / gate` | pass | `43816497804` / `133130990767` |
| `api / build-and-test` | pass | `43816497804` / `133130990674` |
| `pos / build the iOS target` | **in progress** | `43816497804` / `133130990642` |

Other contexts at the head: `changes`, `secrets`, `workflows`,
`contract / contract`, `lint / lint`, `tokens / tokens`, `dashboard / build`
and `Vercel Preview Comments` pass. `cash` and `landing` are skipped by
selection. `Vercel` is canceled by its ignored-build step.

A pending required context is not a PASS. F2 stays open. I did not poll.

## 8. Limitations and what I did not test

- I did not re-drive the real dashboard at `f931aa8c` in a browser. I judged the
  committed capture at `2b08f55c` and proved that no compiled product module
  changed after it. The brief allows this record.
- The narrative uses a fixed local stub. It is not a live model call.
- The live role-surface gate did not run. No listener was on 4003, the API env
  is a local file and the rehearsal database is absent. This is an accepted
  environment limitation. I judged the offline contract coverage only.
- I did not rerun the full API unit suite or the sales e2e suite. CI covers them.
- The local API `/health` returned 503 against the reused `umi_verify_294`
  database. The routes, the oracle and the matrix worked. I do not cite health
  as gate evidence.
- The local `staging` ref is stale. `origin/staging` is the base and is correct.
- The manifest `captureCommand` assumes the documented copy of the harness into
  the legacy worktree. The oracle record gives that copy step.

## 9. New findings

| Id | Severity | Finding |
| --- | --- | --- |
| N1 | Low | `docs/verification/2026-11-16-semantic-api-gate3/dashboard/README.md:57` says the content crops contain no clock. The S00 analysis crop contains a body timestamp (`11:14 p.m.` vs `11:16 p.m.`). It causes the 39-pixel difference. It does not change a compared product value. |
| N2 | Info | `apps/umi-api/test/fixtures/semantic-gate3/legacy/manifest.json:4` names `src/modules/metrics/capture-legacy-oracle.integration.ts`. That path exists only after the documented copy step. The record and the harness give the step. |

## 10. Reproduction

```sh
cd /home/juan/Projects/umiconsulting/umi/.worktrees/semantic-consumer-20261116
git rev-parse HEAD
git status --porcelain
git diff --stat 85b1abf4..f931aa8c
sha256sum docs/architecture/2026-11-16-semantic-analytics-api-spec.md \
  docs/architecture/2026-11-16-semantic-analytics-api-adr.md
cd apps/umi-api/test/fixtures/semantic-gate3/legacy && sha256sum -c SHA256SUMS
```

```sh
cd /home/juan/Projects/umiconsulting/umi/.worktrees/semantic-consumer-20261116
pnpm --filter @umi/contract test
pnpm --filter @umi/contract generate:check
pnpm --filter @umi/api build
```

```sh
cd apps/umi-api
export DATABASE_URL_APP='postgresql://api_login:i1_local_api@127.0.0.1:5543/umi_verify_294'
export DATABASE_URL_WORKER='postgresql://worker_login:i1_local_worker@127.0.0.1:5543/umi_verify_294'
export REDIS_URL='redis://127.0.0.1:6386'
export UMI_ENVIRONMENT=test JWT_SECRET='gate3-local-verifier-secret'
./node_modules/.bin/vitest run --config vitest.integration.config.ts \
  src/modules/metrics/metrics.gate3-oracle.integration.ts
./node_modules/.bin/vitest run --config vitest.integration.config.ts \
  src/modules/metrics/metrics.parity-matrix.integration.ts \
  src/modules/metrics/metrics.integration.ts \
  src/modules/metrics/metrics.refunds-oracle.integration.ts
pnpm --filter @umi/api exec vitest run src/modules/auth/role-surface-contract.spec.ts
```

```sh
pnpm --filter @umi/dashboard test
```

CI read:

```sh
gh pr view 294 --repo umiconsulting/umi \
  --json number,title,state,isDraft,mergeable,headRefOid,baseRefName,url
gh pr checks 294 --repo umiconsulting/umi
gh api --paginate \
  "repos/umiconsulting/umi/commits/f931aa8c6d90a35091837c0c3e385fb4968b407b/check-runs?per_page=100"
```

## 11. Sign-off

**FAIL at `f931aa8c6d90a35091837c0c3e385fb4968b407b`.**

The artifact passes the product, contract, oracle, matrix, dashboard, evidence
and offline role-surface checks. F1, F3, F4, F5, F6, F7, F9 and F11 are closed.
F8 stays accepted. F10 and F12 stay informational.

The gate fails on F2 only. At the final read, `pos / build the iOS target` is in
progress in run `43816497804` (job `133130990642`) and `CI ready` is absent.

Do not merge. Re-run the verifier when those contexts finish. No code change is
needed for the other findings.

I did not edit the branch. I did not merge. I did not deploy.

---

## 12. CI sign-off addendum

Read at `2026-11-16T06:51:17Z`, after one bounded watch of run `43816497804`.
Head: `f931aa8c6d90a35091837c0c3e385fb4968b407b`. Base:
`dfa7a78a94e696eb67fc4606b281268746128ec8` (`origin/staging`). The merge base is
the same. PR #294 is `OPEN`, draft and `MERGEABLE`.

| Required context | State | Run / job |
| --- | --- | --- |
| `CI ready` | pass | `43816497804` / `133139173653` |
| `lint` | pass | `43816497726` |
| `contract` | pass | `43816497700` |
| `tokens` | pass | `43816497707` |
| `build-and-test` | pass | `43816497718` |
| `gate` | pass | `43816497718` |
| `api / gate` | pass | `43816497804` / `133130990767` |
| `api / build-and-test` | pass | `43816497804` / `133130990674` |
| `pos / build the iOS target` | pass | `43816497804` / `133130990642` |

The POS job spent 22m21s and passed. `CI ready` passed in 3s. Every check run
reports `head_sha = f931aa8c6d90a35091837c0c3e385fb4968b407b`.

The earlier FAIL came from F2 only. F2 is now **CLOSED**. The 10 gate-3
requirements and findings F1, F3, F4, F5, F6, F7, F9 and F11 stay as recorded in
Sections 3 and 4. F8 stays accepted. F10 and F12 stay informational.

**Verdict: PASS at `f931aa8c6d90a35091837c0c3e385fb4968b407b`.**

The base report before this addendum was 338 lines with SHA-256
`106914b2ad8d7265d131049854154e736d8823f015c8594275dcaf1712c38487`. This
addendum changes the file. The new file SHA-256 is in the companion `.sha256`
file and in the verifier's reply. A file cannot contain its own final hash.

I did not edit the branch, the PR or a tracked file. I did not rerun a suite. I
did not merge. I did not deploy.
