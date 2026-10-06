# UMI POS Controlled Pilot Activation

Date: 2026-08-13

## Decision

Gate 10A status: `BLOCKED — REAL PILOT ENVIRONMENT REQUIRED`.

Pilot activation status: `BLOCKED — PILOT NOT ACTIVATED`.

Gate 10B eligibility: `NO`.

This execution environment has no pilot endpoint, deployment credential, site credential, or physical device connection. Therefore, this gate contains no on-site claim.

## Release identity

| Item                 | Value                                      | Result               |
| -------------------- | ------------------------------------------ | -------------------- |
| Release              | `UMI POS Pilot RC2`                        | PASS                 |
| Version              | `6.0.0-pilot.rc2`                          | PASS                 |
| Artifact source      | `1e885022b654dcecf943377ea2e1e3b739a9027a` | PASS                 |
| Certification commit | `4d95cf78bf1bdce8430fa1feb5032c56327c61a5` | PASS                 |
| Migration head       | `build-v3-48`                              | CERTIFIED PREVIOUSLY |
| RC1 status           | Superseded; deployment prohibited          | PASS                 |
| PR                   | `#72`, base `build-v3`, open and unmerged  | PASS                 |

The RC2 machine manifest passed verification at the exact artifact source commit. This check verified image identities, migration checksum, and Linux POS checksum.

## Evidence classification

| Evidence class                | Gate 10A result                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| CERTIFIED PREVIOUSLY          | RC2 release, clean deployment, migrations, business truth, reconciliation, recovery, and simulated KDS |
| VERIFIED ON SITE              | None                                                                                                   |
| VERIFIED ON PHYSICAL HARDWARE | None                                                                                                   |
| VERIFIED IN REAL NETWORK      | None                                                                                                   |
| VERIFIED IN REAL OPERATION    | None                                                                                                   |
| NOT USED                      | Not yet known; pilot scope is unavailable                                                              |
| NOT VERIFIED                  | Site, network, accounts, devices, registers, peripherals, and first transaction                        |
| DEFERRED                      | All on-site checks until the pilot environment is available                                            |
| BLOCKED                       | Pilot activation and Gate 10B authorization                                                            |

## Pilot site identity

| Field                   | State                                               |
| ----------------------- | --------------------------------------------------- |
| Pilot identifier        | NOT PROVIDED                                        |
| Merchant identifier     | NOT PROVIDED                                        |
| Location identifier     | NOT PROVIDED                                        |
| Environment             | NOT ACCESSIBLE                                      |
| Deployment timestamp    | NOT APPLICABLE                                      |
| Devices and registers   | NOT PROVIDED                                        |
| KDS use                 | NOT CONFIRMED                                       |
| Required peripherals    | NOT CONFIRMED                                       |
| Payment mode            | NOT CONFIRMED                                       |
| Object-storage mode     | RC2 default is disabled; site state is NOT VERIFIED |
| Support contact or role | NOT PROVIDED                                        |

Do not add credentials, tokens, payment secrets, gift-card secrets, or unnecessary customer data to this document.

## Pre-opening checklist

Run this checklist at the actual site. Activate operations only when each required item passes.

| Check                  | Current result        | Required evidence                                                     |
| ---------------------- | --------------------- | --------------------------------------------------------------------- |
| RC2 identity           | PASS                  | Exact manifest and artifact source                                    |
| API ready              | BLOCKED               | Pilot readiness response                                              |
| Worker ready           | BLOCKED               | Pilot worker health                                                   |
| Dashboard ready        | BLOCKED               | Pilot HTTPS session                                                   |
| Database ready         | BLOCKED               | Migration head and readiness                                          |
| Correct merchant       | BLOCKED               | Safe merchant reference                                               |
| Correct location       | BLOCKED               | Safe location reference                                               |
| Owner account          | BLOCKED               | Successful site authentication                                        |
| Manager account        | BLOCKED               | Successful scoped authorization                                       |
| Cashier account        | BLOCKED               | Successful POS authentication                                         |
| Register configuration | BLOCKED               | Site register assignment                                              |
| Device enrollment      | BLOCKED               | Trusted physical device                                               |
| KDS connectivity       | BLOCKED               | Required only if KDS is in scope                                      |
| Catalog loaded         | BLOCKED               | Site catalog view                                                     |
| Inventory baseline     | BLOCKED               | Site reconciliation with zero drift                                   |
| Payment mode           | BLOCKED               | Explicit cash, manual terminal, or separately certified provider mode |
| Object storage         | PASS WITH OBSERVATION | Keep disabled unless separately validated                             |
| Required hardware      | BLOCKED               | Physical checks for each required device                              |
| Diagnostics            | BLOCKED               | Pilot support access                                                  |
| Backup and recovery    | BLOCKED               | Site backup owner and current evidence                                |
| Support escalation     | BLOCKED               | Named role and contact path                                           |

## Hardware matrix

Pilot staff must replace each `UNKNOWN` value before activation.

| Device           | Required | Present | Physically tested | Result       | Evidence                   |
| ---------------- | -------- | ------- | ----------------- | ------------ | -------------------------- |
| Linux POS        | UNKNOWN  | UNKNOWN | NO                | NOT VERIFIED | Site test required         |
| iPad or iOS POS  | UNKNOWN  | UNKNOWN | NO                | NOT VERIFIED | Site test required if used |
| KDS target       | UNKNOWN  | UNKNOWN | NO                | NOT VERIFIED | Site test required if used |
| Receipt printer  | UNKNOWN  | UNKNOWN | NO                | NOT VERIFIED | Site test required if used |
| Cash drawer      | UNKNOWN  | UNKNOWN | NO                | NOT VERIFIED | Site test required if used |
| Barcode scanner  | UNKNOWN  | UNKNOWN | NO                | NOT VERIFIED | Site test required if used |
| Customer display | UNKNOWN  | UNKNOWN | NO                | NOT VERIFIED | Site test required if used |

## Activation procedure

1. Confirm the pilot identifier, merchant, location, and support role.
2. Define enabled payment, KDS, storage, device, and peripheral scope.
3. Deploy only `6.0.0-pilot.rc2` with the certified deployment procedure.
4. Verify the release identity before any business operation.
5. Verify `build-v3-48` without manual database edits.
6. Complete every required pre-opening check.
7. Complete each required physical device test.
8. Test a controlled network interruption before normal operation.
9. Complete one low-risk transaction within certified payment scope.
10. Query the authoritative command before any retry after an uncertain response.
11. Confirm one sale, one receipt, and expected inventory effects.
12. Complete the KDS lifecycle when KDS is enabled.
13. Run the financial and inventory reconciliations.
14. Complete one safe recovery drill.
15. Confirm that another support operator can use the runbook.

## Required on-site evidence

- Exact deployed release identity and deployment timestamp.
- Safe merchant, location, register, device, and operator references.
- API, worker, database, Redis, and Dashboard readiness.
- Physical device results for all enabled pilot hardware.
- Real network and controlled reconnect results.
- First transaction, receipt, inventory, KDS, and audit references.
- Financial and inventory reconciliation with zero unexplained drift.
- Recovery drill and support handoff results.
- Current backup evidence and escalation ownership.
- Pilot issue ledger entries or an explicit statement that no issue occurred.

## Operating boundaries

- Cash and manual external-terminal records are within certified RC2 scope.
- Integrated payment-provider processing is disabled until separate real-provider validation passes.
- Object storage remains disabled unless the pilot needs it and provider validation passes.
- Use KDS and each peripheral only after its physical site check passes.
- Use iPad or iOS only after install, signing, layout, network, and restart checks pass.
- RC1 must never be deployed.
- `NEXO LEGACY RUNTIME DEPENDENCY: NONE`.

## Stop conditions

Stop the affected operation for any of these conditions:

- Incorrect merchant or location attribution.
- Incorrect financial effect or unexplained monetary drift.
- Duplicate irreversible transaction.
- Data loss or corruption.
- Authority or tenant isolation failure.
- Secret exposure.
- Unrecoverable transaction uncertainty.
- Business-significant inventory drift.
- KDS lost or duplicate work.
- Failed required hardware without a safe scope reduction.
- Missing support ability to determine transaction state.

## Issue recording

Use `docs/pilot/UMIPOS_PILOT_ISSUE_LOG_TEMPLATE.md` for each site issue. Separate a product defect from an operational defect, observation, or preference.

No Gate 10A product defect exists from this environment. Missing site access is an operational blocker, not a product defect.

## Defect ledger

| Class          | Found | Closed | Open | Detail                                                       |
| -------------- | ----: | -----: | ---: | ------------------------------------------------------------ |
| P0             |     0 |      0 |    0 | No product execution occurred                                |
| P1 product     |     0 |      0 |    0 | No product execution occurred                                |
| P1 operational |     1 |      0 |    1 | Real pilot environment and physical evidence are unavailable |
| P2             |     0 |      0 |    0 | Capture site observations after access exists                |

## Final activation decision

`BLOCKED — PILOT NOT ACTIVATED`

Reason: Gate 10A requires real pilot-environment evidence. This execution had no access to that environment or its physical devices.

`Gate 10B — Controlled Pilot Observation: NO`
