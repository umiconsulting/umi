# I1-FIN-03 pair semantics record

Date: 2026-11-15, America/Mazatlan.
Status: Resolved by decision. The case remains BLOCKED as an external baseline
limitation. It is not a product failure.
Decision owner: umi-lead (SPEC owner), 2026-11-15. Evidence owner: umi-verifier.
Worktree: `.worktrees/i1-closeout-20261115`.

## Finding

The product matches the section 4.2 anchor. `sale_result.pairs.length` is 1 and
`sale_result.coverage.pairsAvailable` is 1.

The baseline `b4ba45fc7ec111dd02e0a0f86dad324697a4ca48` returns 0 for both
fields.

`I1-FIN-03` requires every listed dimension, including `pairs`, to match the
baseline. `I1-FIN-01` requires the section 4.2 anchor, including `pairs = 1`.
The two pinned expectations conflict at `sale_result.pairs`.

## Decision

Decision (umi-lead, 2026-11-15):

- The SPEC 4.2 anchor and `I1-FIN-01` are correct. A sale with two products and a
  refund of one line has one product pair. A refund removes money, not the
  purchase event.
- The baseline `b4ba45fc` is stale. It removes the refunded line before pair
  counting and returns `pairs=0`.
- The candidate at the head matches the SPEC: `pairs=1` and `pairsAvailable=1`.
- The `I1-FIN-03` baseline pair equality is unsatisfiable at this baseline.
- Do not change the harness or the expected value.
- The regression test in `sales-analysis.spec.ts` pins the chosen semantics.
- The signed SPEC is unchanged and verifies.

The case remains BLOCKED as an external baseline limitation. It is not a product
failure. The acceptance count treats it as a blocked case.

## What this record does not do

- It does not change `SPEC.md`. The signed artifact is unchanged and its
  `SHA256SUMS` verifies.
- It does not change `tools/verification/i1-cases-fin.mjs`. The harness keeps
  the baseline equality. The verifier owns the harness.
- It does not change a product file or a test file.
- It does not mark `I1-FIN-03` PASS.
- It does not present a new case rule as applied.

## Seven-dimension comparison

Baseline `b4ba45fc` against the candidate at the evidence head, at the same
golden range.

| `sale_result` dimension | Baseline  | Candidate | Match |
| ----------------------- | --------- | --------- | ----- |
| `byHour`                | 656 bytes | 656 bytes | Yes   |
| `byDay`                 | 473 bytes | 473 bytes | Yes   |
| `byWeekday`             | 437 bytes | 437 bytes | Yes   |
| `byMonth`               | 235 bytes | 235 bytes | Yes   |
| `byLocation`            | 516 bytes | 516 bytes | Yes   |
| `unitsDistribution`     | 25 bytes  | 25 bytes  | Yes   |
| `selectedGroups`        | 146 bytes | 146 bytes | Yes   |

All seven dimensions match. Array order also matches.

The only difference is the pair field:

| `sale_result` field       | Baseline | Candidate | 4.2 anchor |
| ------------------------- | -------: | --------: | ---------: |
| `coverage.baskets`        |        3 |         3 |          3 |
| `coverage.pairsAvailable` |        0 |         1 |          1 |
| `pairs.length`            |        0 |         1 |          1 |

The candidate pair is Concha and Café americano. It has `baskets=1`,
`support=0.3333`, `confidenceAtoB=0.5`, `confidenceBtoA=0.5`, and `lift=0.75`.

## Cause

`apps/umi-api/src/modules/dashboard-operations/purchase-baskets.ts` counts the
original sale lines for pair counting. A refund removes money, not the purchase
event. The baseline build removes the refunded line before it counts pairs. The
golden fixture has one sale with two products and a refund of one line. The
baseline therefore reports no pair. The candidate reports one pair.

## Basis

- SPEC `I1-FIN-01` (`[A:L274–L286]`) pins the section 4.2 anchor:
  `pairs.length=1` and `coverage.pairsAvailable=1`.
- SPEC `I1-FIN-03` (`[A:L297–L309]`) requires `pairs` to match the baseline.
- The baseline result `baseline-sale-result.json` has `pairs.length=0` and
  `coverage.pairsAvailable=0`.
- The candidate result `candidate-sale-result.json` has `pairs.length=1` and
  `coverage.pairsAvailable=1`.
- The case result `result.json` is BLOCKED with the pair-conflict message.

## Evidence

The cold run at the new head is
`.analytics-i1-closeout-20261115/fin03-cold/cases/I1-FIN-03`. The full run is
`.analytics-i1-closeout-20261115/full-2/cases/I1-FIN-03`. Each case directory
holds these case files:

- `baseline-sale-result.json`
- `baseline-period-movements.json`
- `candidate-sale-result.json`
- `candidate-period-movements.json`
- `result.json`
- `sha256.txt`
- `stdout.txt`
- `stderr.txt`

The four JSON files hold the values above. The case returns before it writes a
comparison file.

`.analytics-i1-closeout-20261115/fin03-cmp.txt` is a derived comparison. A
helper reads the four JSON files after the run and writes it. It is not case
output. The manifest does not list it as a case file.
