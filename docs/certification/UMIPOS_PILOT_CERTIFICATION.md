# UMI POS Controlled Pilot Certification

Updated: 2026-08-13

## Decision

Gate 9C verdict: `CERTIFIED FOR CONTROLLED PILOT WITH CONDITIONS`.

Controlled Pilot: `GO WITH CONDITIONS`.

Certified release: `UMI POS Pilot RC2`, version `6.0.0-pilot.rc2`.
Artifact source: `50b26713dfc074a00510256afaf22d691f847d1b`.
RC1 is superseded and must not be deployed.

Gate 9A completed the pilot rehearsal. Gate 9B produced RC1 and release procedures.
Gate 9C found one clean-database startup race. RC2 closes that P1 defect.

## Evidence classes

| Evidence                | Result                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| AUTOMATED               | Business, authority, idempotency, RLS, smoke, and reconciliation passed.                          |
| RUNTIME VERIFIED        | Fresh deployment, API, worker, Dashboard, PostgreSQL, Redis, restart, backup, and restore passed. |
| BROWSER VERIFIED        | Authenticated Dashboard end-of-day views passed.                                                  |
| SIMULATED               | KDS and hardware command paths passed through canonical simulators.                               |
| STATICALLY VERIFIED     | Configuration, privacy, provider boundaries, and NEXO dependency passed.                          |
| PHYSICALLY VERIFIED     | None in this environment.                                                                         |
| NOT PHYSICALLY VERIFIED | iPad, printer, drawer, scanner, and customer display.                                             |
| PROVIDER-DEPENDENT      | Real payment authorization and enabled object storage.                                            |
| PILOT-DEPENDENT         | Final Owner density and aesthetic preferences.                                                    |

## Go/no-go rehearsal

| Check                                      | Result                | Evidence                               |
| ------------------------------------------ | --------------------- | -------------------------------------- |
| Certified source and artifacts             | PASS                  | RC2 manifest and checksums             |
| Configuration and secrets                  | PASS                  | Precheck; secrets remained outside Git |
| Clean migration and bootstrap              | PASS                  | Fresh disposable runtime               |
| Merchant, location, Owner, and Manager     | PASS                  | Bootstrap and role walkthrough         |
| Device, register, catalog, and inventory   | PASS                  | Smoke, fixture, and readiness          |
| API, worker, Dashboard, and KDS            | PASS                  | Runtime health and lifecycle checks    |
| Transaction, receipt, refund, and recovery | PASS                  | Persisted facts and idempotent retries |
| Rollback and support procedures            | PASS                  | Deployment and support runbooks        |
| Backup and isolated restore                | PASS                  | Checked backup; restore in 25 seconds  |
| Physical devices                           | PASS WITH OBSERVATION | On-site validation required before use |
| Payment provider                           | PASS WITH OBSERVATION | Keep integrated provider disabled      |
| Object storage                             | NOT APPLICABLE        | Disabled and not required by RC2       |

## Deployment and smoke

RC2 passed the documented clean deployment flow. PostgreSQL initialization completed before readiness.
Migrations ended at `build-v3-48`. The API, worker, Dashboard, Caddy, PostgreSQL, Redis, and telemetry started.

Smoke verified authentication, Owner access, merchant and location context, Manager scope, device, register, catalog, inventory, KDS, transaction, receipt, history, diagnostics, and duplicate protection.

## Business truth

- Sales: one immutable committed sale remained terminal.
- Receipts: one receipt fact remained separate from print and copy jobs.
- Refunds: one `4499` minor-unit refund remained a separate immutable fact.
- Financials: gross `9000`, refund `4499`, net `4501`; unexplained drift `0`.
- Inventory: 16 projections reconciled with drift `0`.
- Customer value: wallet `50000|50000`, gift card `25000|25000`, loyalty net `1010`.
- Recovery: 21 cases existed; unresolved cases were `0`.

## Failure, recovery, and rollback

API and worker restart preserved sale, refund, and receipt counts at `1|1|1`.
Idempotent refund, inventory, waste, and loyalty retries created no duplicate fact.
KDS reconnect passed. Unauthorized KDS financial access returned `401`.

Application rollback keeps the forward-compatible schema and immutable facts.
Do not reverse migrations after business facts use them. Pause workers before an incompatible rollback.
The checked backup restored into `umipos_restore_gate9c_rc2` in 25 seconds.

## Support and observability

The pilot runbook and support runbook cover authentication, location, devices, registers, KDS, connectivity, transaction uncertainty, duplicates, refunds, inventory, workers, service degradation, and escalation.
Diagnostics expose release identity, health, correlation references, audit, recovery, and background state to support roles.
Normal operators do not receive secrets or unnecessary technical payloads.

## Operating boundary

Certified for controlled pilot use:

- UMI authentication, merchant and location scope, roles, devices, and registers.
- Catalog, inventory, cash shifts, sales, manual terminal assertions, receipts, refunds, and reconciliation.
- Customer, loyalty, wallet, gift-card facts, KDS lifecycle, audit, diagnostics, and recovery.

Not physically or provider certified:

- Apple/iPad runtime and signing.
- Physical printer, drawer, scanner, and customer display.
- Real integrated payment-provider authorization.
- Enabled provider object storage.

Manual terminal payment records an operator assertion. It does not claim provider authorization.
Object storage remains disabled. No required RC2 workflow uses it.

## Device and hardware matrix

| Item             | Built           | Simulated/static | Physical | First-pilot rule                   |
| ---------------- | --------------- | ---------------- | -------- | ---------------------------------- |
| Linux POS        | Yes             | Yes              | No       | Allowed after on-site device check |
| iPad/iOS POS     | No              | Static only      | No       | Do not use                         |
| KDS target       | Source verified | Yes              | No       | Use only after physical iPad check |
| Receipt printer  | No              | Yes              | No       | Validate before required use       |
| Cash drawer      | No              | Yes              | No       | Validate before cash custody       |
| Barcode scanner  | No              | Yes              | No       | Manual lookup is fallback          |
| Customer display | No              | Yes              | No       | Optional unless pilot requires it  |

## On-site prerequisites

1. Verify RC2 commit and manifest.
2. Confirm migrations, backup, health, and monitoring.
3. Confirm merchant, location, Owner, Manager, register, and enrolled devices.
4. Confirm catalog and inventory baseline.
5. Confirm provider mode remains manual unless separately certified.
6. Test each required physical device before opening.
7. Connect and reconcile KDS before use.
8. Confirm support contacts and issue escalation.
9. Complete the post-deploy smoke plan.

## Continue and stop criteria

Continue while authority is correct, reconciliation has no drift, retries create no duplicates, KDS remains coherent, and support can resolve normal failures.

Stop immediately for an incorrect financial effect, duplicate irreversible fact, tenant crossing, data loss, unresolved transaction ambiguity, broad authority bypass, secret exposure, unsafe recovery, or material reconciliation drift.

## Defect ledger

| ID     | Severity | Status | Result                                            |
| ------ | -------- | ------ | ------------------------------------------------- |
| G9C-01 | P1       | CLOSED | RC2 waits for complete PostgreSQL initialization. |

P0 found: `0`. P0 open: `0`. P1 found: `1`. P1 closed: `1`. P1 open: `0`.
No code-controlled P2 remains.

## Final conditions

- Deploy RC2 only. Do not deploy RC1.
- Complete physical checks for each device used by the pilot.
- Keep real integrated payment authorization disabled until provider certification passes.
- Keep object storage disabled unless its provider contract passes.
- Review Owner preferences during controlled pilot operation.
