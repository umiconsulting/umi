# Gate 3 frozen legacy oracle

Date: 2026-11-16.
Record: `2026-11-16-semantic-api-gate3-legacy-oracle`.
Legacy head: `dfa7a78a94e696eb67fc4606b281268746128ec8`.
After head: `2b08f55ce98c79debb6e0bf5d4c40df6eaedda16`.

## Purpose

The gate-3 migration deletes `GET reports/sales`. The frozen cases keep the
legacy answer. The after test reads static JSON only. The test never calls the
legacy route or the legacy repository.

## Frozen sets

| Set              | Cases | Source                                     |
| ---------------- | ----: | ------------------------------------------ |
| Gate 2 ledger    |    24 | Fixture A on `2026-11-02` and `2026-11-04` |
| Gate 1 fixture A |     4 | Fixture A on `2026-11-04`                  |
| Gate 1 fixture B |     1 | I1 METRIC database                         |
| Route live       |     1 | Gate 3 fixture, `last_30_days`, Centro     |
| Total            |    30 | 29 cases plus route-live                   |

The files are under `apps/umi-api/test/fixtures/semantic-gate3/legacy/`.
`manifest.json` lists each case, its raw SHA-256 and its normalized SHA-256.

## Historical capture command

The harness is `tools/verification/fixtures/semantic-gate3/capture-legacy-oracle.ts`.
It imports the legacy repository. Run it only in a clean worktree at the legacy
head.

```sh
git worktree add --detach /tmp/umi-gate3-before dfa7a78a94e696eb67fc4606b281268746128ec8
cp tools/verification/fixtures/semantic-gate3/capture-legacy-oracle.ts \
  /tmp/umi-gate3-before/apps/umi-api/src/modules/metrics/capture-legacy-oracle.integration.ts
cd /tmp/umi-gate3-before/apps/umi-api
DATABASE_URL_APP=... DATABASE_URL_WORKER=... \
  npx vitest run --config vitest.integration.config.ts \
  src/modules/metrics/capture-legacy-oracle.integration.ts
```

The database must contain the gate-2 fixture A and the gate-3 fixture. The
harness seeds the gate-2 fixture. Run `seed-runner.sh` for the gate-3 fixture.
Set `GATE3_I1_DATABASE_URL` to recapture fixture B. Without it, the harness
keeps the frozen fixture B bytes.

The harness reuses each frozen `capturedAt`, and it maps the new random fixture
product ids back to the frozen ids. The raw bytes therefore stay stable.

## Reproduction check

```sh
cd apps/umi-api/test/fixtures/semantic-gate3/legacy
sha256sum -c SHA256SUMS
```

The file `SHA256SUMS` covers `manifest.json`, every case file and
`gate1/route-live.json`. All 31 lines pass.

## After-head test

`apps/umi-api/src/modules/metrics/metrics.gate3-oracle.integration.ts` runs four
checks:

1. It verifies 30 raw hashes and 30 normalized hashes.
2. It seeds the gate-2 fixture A and matches all 28 fixture-A cases.
3. It asserts 20 non-empty gate-2 cases and 14 fields in each normalized value.
4. It asserts the gate-2 ledger file hash and case-set hash.

The test uses `apps/umi-api/src/modules/metrics/gate3-normalize.ts`. That file
declares the legacy shape locally. It imports no legacy module and no
`ReportsSales` type.

## Gate-2 ledger retention

| Item                                                          | SHA-256                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `docs/verification/2026-11-16-semantic-api-gate2-parity.json` | `8986d5ebdb6deea83da5c0215d91d85c892cc5a5c1a41495119d6ee9d6e5377e` |
| Gate-2 case set                                               | `fe1365f872f364448a05384ffa2e7e63d9977463b4d8bd4753fc45cacd26f4c5` |

The after test recomputes both values. A change is a FAIL.

## Limits

- Fixture B is hash-only. The I1 METRIC database is historical.
- Route-live is hash-only. It records the public route body at the legacy head.
- The after test does not run the legacy code. The frozen JSON is the oracle.
