# Gate 3 dashboard evidence

Date: 2026-11-16.
Fixture: `gate3-semantic-fixture-v1`.
D0: 2026-11-15 (America/Mazatlan).
Seed SHA-256: `1c1b21373b7909ab3e268aece7867ca8d20399eca58aba5d3236aac5fa7e8d08`.

| Item | Before | After |
| --- | --- | --- |
| Head | `dfa7a78a94e696eb67fc4606b281268746128ec8` | `2b08f55ce98c79debb6e0bf5d4c40df6eaedda16` |
| API | `GET reports/sales` | `POST metrics/query` |
| Narrative | `GET reports/sales/insight` | `POST metrics/insight` |
| Viewport | 1440x900 | 1440x900 |
| Mobile | 390x844 | 390x844 |

The before and after phases read the same database. They use the same D0 and the
same seed hash. The fixture was not reseeded between phases.

## Results

- Dashboard checks: 25 of 25. The 20 named-location cells and the five extra
  checks (`E01`, `E02`, `M01`, `M02`, `S00`).
- Display comparison: 25 of 25 match. See `compare.json`.
- API cases: 12 of 12 match. See `api-matrix.json`.
- Payment mix at Centro: cash and wallet in every range. Norte: cash only or no
  rows for the empty period.
- Narrative: present for the non-empty Centro periods. The exact text for
  today/Centro is `Vendiste $285.00 en 2 órdenes; el ticket promedio fue $142.50.`
  The six today/Centro stub inputs have one SHA-256. See `narrative-inputs.json`.
- Permissions: the unscoped account reads all locations. The Centro-bound
  account gets 403 for Norte and 200 for Centro.

## Lead values

| Range | Centro lead | Orders |
| --- | --- | ---: |
| today | $285.00 | 2 |
| yesterday | $180.00 | 1 |
| last_7_days | $465.00 | 3 |
| last_30_days | $565.00 | 4 |
| today/Norte | $0.00 | 0 |

## Files

| Path | Content |
| --- | --- |
| `before/evidence.json` | 25 checks, request bodies, displayed values, errors, hashes |
| `after/evidence.json` | 25 checks, request bodies, displayed values, errors, hashes |
| `before/screens/<id>.png` | viewport screenshot at 1440x900 or 390x844 |
| `before/screens/<id>-full.png` | full-page screenshot |
| `before/crops/<id>-<width>.png` | content crop at 1440 or 390 |
| `after/...` | same files for the after head |
| `before/narrative.png` | focused narrative card |
| `compare.json` | per-cell display comparison |
| `api-matrix.json` | 12 API cases and the permission checks |

The full screenshots mask only the clock element. Each screenshot and crop
carries a SHA-256 in its evidence JSON.

23 of the 25 content crops are byte-equal between the before and after phases.
Two 1440 crops differ:

- `DB-T-CEN-ANALYSIS-1440.png` differs at 39 pixels in a 6×8 box. The body text
  shows the capture time: `11:14 p.m.` before and `11:16 p.m.` after. `S00` is
  a smoke check; it compares no numbers.
- A rounded-corner edge on the right side causes the difference in
  `DB-T-CEN-HOR-1440.png`. A direct RGB recount at this head gives 9 differing
  positions, at x 1392-1396 and y 100-101. Five positions differ in two or
  three channels; four differ in one channel. The maximum channel difference
  is 1. The signed report summarises the difference as 6.

Both 390 crops are byte-equal.

## Reproduce

```sh
# Fixture and database
PGPASSWORD=... tools/verification/fixtures/semantic-gate3/seed-runner.sh

# Before head at 4001 and 4000, with the narrative stub
node tools/verification/fixtures/semantic-gate3/narrative-stub.mjs
GATE3_HEAD=dfa7a78a94e696eb67fc4606b281268746128ec8 \
  node tools/verification/gate3-dashboard-capture.mjs --phase before

# After head at 4001 and 4000
GATE3_HEAD=2b08f55ce98c79debb6e0bf5d4c40df6eaedda16 \
  node tools/verification/gate3-dashboard-capture.mjs --phase after

node tools/verification/compare-display.mjs
node tools/verification/gate3-api-matrix.mjs
```

## Limits

- The screenshots are evidence, not a pixel baseline. The check compares the
  displayed values, not the pixels.
- `S00` proves the default `Análisis de compras` view renders. It does not
  compare its numbers.
- The all-locations scope is API-only. The dashboard has no all-locations
  control (P2).
