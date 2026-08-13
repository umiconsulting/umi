# UMI POS Pilot RC Certification

Updated: 2026-08-13

## Decision

Gate 9B is `COMPLETE WITH OBSERVATIONS`.
`UMI POS Pilot RC1` is ready for Gate 9C with observations.
Gate 9C has not started.

The artifact source is `9ea8560b6c0e7304834eae0cd960804132acac89`.
The starting Gate 9A commit is `3c9b5a01fdfab6406047d112096da88445d2d778`.

## Evidence summary

| Area                                      | Result      | Evidence class                      |
| ----------------------------------------- | ----------- | ----------------------------------- |
| Release images and Linux POS              | PASS        | VERIFIED IN BUILD                   |
| Clean migration through build-v3-48       | PASS        | VERIFIED VIA LOCAL RUNTIME          |
| Clean bootstrap and business path         | PASS        | VERIFIED VIA LOCAL RUNTIME          |
| API, worker, Dashboard, PostgreSQL, Redis | PASS        | VERIFIED VIA LOCAL RUNTIME          |
| Dashboard tests and build                 | PASS        | VERIFIED IN AUTOMATION and BUILD    |
| KDS lifecycle and reconnect               | PASS        | VERIFIED VIA SIMULATION             |
| KDS Apple artifact                        | OBSERVATION | NOT PHYSICALLY VERIFIED             |
| Configuration contract                    | PASS        | STATICALLY VERIFIED and AUTOMATION  |
| Object storage                            | OBSERVATION | PROVIDER-DEPENDENT; disabled in RC1 |
| External payment provider                 | OBSERVATION | PROVIDER-DEPENDENT                  |
| Physical peripherals                      | OBSERVATION | NOT PHYSICALLY VERIFIED             |
| NEXO legacy runtime dependency            | NONE        | STATICALLY VERIFIED                 |

## Build and migration results

`pnpm umipos:pilot:build` produced immutable API, worker, Dashboard, and Linux POS artifacts.
The release manifest verification passed. The migration digest matched the source tree.

`pnpm umipos:pilot:certify-clean` used fresh disposable volumes.
The chain applied through `build-v3-48`. The API, worker, and Dashboard became ready.
The clean smoke check passed in 22 seconds.

The first business certification attempt stopped before migration because PostgreSQL was not ready.
The bounded retry passed. No partial business fact existed from the first attempt.

## Business authority results

The clean business run created one merchant and the required operational roles.
It committed one sale, one receipt, one refund, and 19 inventory facts.
It closed two shifts. It completed the KDS lifecycle and reconnect path.

Financial reconciliation produced gross `9000`, refunds `4499`, and net `4501` minor units.
Inventory reconciliation covered 16 projections with drift `0`.
Wallet projected `50000` from `50000`. Gift card projected `25000` from `25000`.
Loyalty net points were `1010`. Recovery contained 21 cases and 0 unresolved cases.

Authorization checks returned safe denials for Manager location crossing, Viewer mutation, and KDS financial access.
The forced RLS check covered 137 tables. The raw gift-card secret count was zero.

## Configuration and release security

The pilot template lists runtime values, release identity, secure cookies, trusted proxies, and protected secrets.
The API schema rejects invalid types and unsafe required settings.
Object-storage credentials become required only when storage is enabled.

No generated release manifest contains password, cookie, authorization, private key, or secret key fields.
No standalone NEXO source, build, database, script, or network dependency exists in the RC path.

## Worker, retry, and health

The worker started its RLS guard, PostgreSQL pools, outbox relay, expiry schedule, and BullMQ processors.
The smoke and readiness tools verified PostgreSQL, Redis, API, Dashboard, migration, RLS, and business readiness.
The final readiness result was `READY WITH WARNINGS`. The only warning was the disabled object-storage policy.

## Backup and recovery

The backup at `backups/pilot/20260813T171856Z/umipos_pilot.dump` passed its SHA-256 check.
The file is local evidence and remains outside Git. The deployment guide defines safe rollback and restore steps.

## Defect ledger

| ID     | Severity | Result                                                                    |
| ------ | -------- | ------------------------------------------------------------------------- |
| G9B-01 | P2       | Closed. The legacy closing runner now requires an explicit fixture count. |

P0 found: 0. P0 open: 0. P1 found: 0. P1 open: 0.

## Validation commands

- `python3 scripts/umipos-gate6b-final-certification.spec.py` — 3 passed.
- `pnpm umipos:pilot:precheck` — PASS.
- `pnpm umipos:pilot:build` — PASS.
- `pnpm umipos:pilot:certify-clean` — PASS.
- `pnpm umipos:pilot:certify-business` — PASS after one bounded infrastructure retry.
- API Vitest run — 118 files passed, 1 skipped; 857 tests passed, 14 skipped.
- Dashboard Vitest — 5 files and 12 tests passed.
- Dashboard lint — PASS with the accepted 49-warning baseline.
- Dashboard production build with the RC contract — PASS.
- Release manifest verification — PASS with Node 22.23.2.
- Backup SHA-256 verification — PASS.
- Gate 7A reconciliation functions — PASS.
- `PR_BASE_REF=origin/build-v3 pnpm check:pr` — PASS.

## Observations

Physical iPad, Apple signing, physical peripherals, provider payment, and provider object storage remain outside this environment.
Owner preferences remain pilot-dependent. These items do not change code-controlled RC authority.
