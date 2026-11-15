# I1-FIN-03 pair semantics record

Date: 2026-11-15, America/Mazatlan.
Status: Open. SPEC owner decision required.
Decision owner: umi-lead (SPEC owner). Evidence owner: umi-verifier.
Worktree: `.worktrees/i1-closeout-20261115`.

## Finding

The product matches the section 4.2 anchor. `sale_result.pairs.length` is 1 and
`sale_result.coverage.pairsAvailable` is 1.

The baseline `b4ba45fc7ec111dd02e0a0f86dad324697a4ca48` returns 0 for both
fields.

`I1-FIN-03` requires every listed dimension, including `pairs`, to match the
baseline. `I1-FIN-01` requires the section 4.2 anchor, including `pairs = 1`.
The two pinned expectations conflict at `sale_result.pairs`.

## Decision required

The SPEC owner must choose one option:

1. Keep the `I1-FIN-03` baseline equality. Then `I1-FIN-01` and `I1-FIN-03`
   cannot both pass at this baseline.
2. Change `I1-FIN-03` to compare the seven dimensions to the baseline and the
   pair fields to the section 4.2 anchor. This option changes the SPEC and the
   harness.

This record does not decide the case. `I1-FIN-03` stays BLOCKED until the SPEC
owner decides.

## What this record does not do

- It does not change `SPEC.md`. The signed artifact is unchanged and its
  `SHA256SUMS` verifies.
- It does not change `tools/verification/i1-cases-fin.mjs`. The harness keeps
  the baseline equality. The verifier owns the harness.
- It does not mark `I1-FIN-03` PASS.
- It does not present a new case rule as applied.

## Seven-dimension comparison

Baseline `b4ba45fc` against the final candidate in the evidence package at the
same golden range.

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
baseline therefore reports no pair. The candidate reports one pair. The 4.2
anchor and the product agree that the pair exists.

## Evidence

The cold run at the final candidate is
`.analytics-i1-closeout-20261115/final/cases/I1-FIN-03`. It holds these files:

- `baseline-sale-result.json`
- `baseline-period-movements.json`
- `candidate-sale-result.json`
- `candidate-period-movements.json`
- `cmp.txt` (the seven-dimension comparison)
- `result.json`
- `sha256.txt`

The run result is BLOCKED with the pair-conflict message. The four JSON files
hold the values above.

The governance record is the register block "Architecture decision status,
2026-11-15" at
`.release-evidence-9917f361-20261115/records/register.md`.
