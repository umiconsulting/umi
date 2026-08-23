# UmiPOS Pilot Dry Run

Date: 2026-08-13

Gate: 9A

Starting commit: `cf756b0ff55e3a405a1f5555101fdc6857269719`

Verdict: COMPLETE WITH OBSERVATIONS

## Environment

The rehearsal used the disposable pilot Docker runtime. It used PostgreSQL, Redis, API, worker, Dashboard, Caddy, hardware simulator, and KDS API.

The clean database used migration head `build-v3-48`. Bootstrap created the first business, location, and Owner before the fixture ran.

## Evidence categories

- VERIFIED IN AUTOMATION: API, PostgreSQL, RLS, reconciliation, readiness, and focused tests.
- VERIFIED IN BROWSER: Owner, Manager, Viewer, Dashboard operations, and responsive Dashboard.
- VERIFIED STATICALLY: SwiftUI KDS accessibility and layout rules.
- SIMULATED: hardware, KDS device, connectivity loss, and API restart.
- NOT PHYSICALLY VERIFIED: iPad, printer, drawer, scanner, and customer display.
- PROVIDER-DEPENDENT: external payment and object storage.
- DEFERRED TO PILOT: Owner density and aesthetic preferences.

## Scenario ledger

| Scenario           | Persona         | Context          | Prerequisite               | Expected                          | Actual                                  | Evidence                            | Result                        | Defect |
| ------------------ | --------------- | ---------------- | -------------------------- | --------------------------------- | --------------------------------------- | ----------------------------------- | ----------------------------- | ------ |
| Initial bootstrap  | Technical Admin | New business     | Empty database             | Business, location, Owner         | Created atomically                      | Bootstrap result and audit          | PASS                          | —      |
| Owner handoff      | Owner           | Pilot business   | Bootstrap complete         | Normal Dashboard access           | Business visible through normal session | Browser login                       | PASS                          | —      |
| Location scope     | Manager         | Location A and B | Scoped membership          | A allowed; B denied               | Scope remained enforced                 | Live role request                   | PASS                          | —      |
| Viewer authority   | Viewer          | Pilot business   | Read-only membership       | Read allowed; mutation denied     | Mutation returned denial                | Live role request                   | PASS                          | —      |
| Catalog readiness  | Owner, Cashier  | Location A       | Fixture loaded             | Sellable catalog is clear         | 12 products and routes available        | PostgreSQL and Dashboard            | PASS                          | —      |
| Inventory          | Manager         | Location A       | Opening facts loaded       | Ledger and projection agree       | Drift count 0                           | Gate 7A reconciliation              | PASS                          | —      |
| Sale and receipt   | Cashier         | Register A       | Device and shift available | One terminal sale fact            | One cash sale persisted                 | Live walkthrough                    | PASS                          | —      |
| Refund             | Manager         | Location A       | Eligible sale              | Compensation remains separate     | One refund; net 4501 minor units        | Live walkthrough and reconciliation | PASS                          | —      |
| Hardware           | Manager         | Register A       | Simulator assigned         | Commands reach terminal state     | 4 of 4 commands terminal                | Smoke and PostgreSQL                | PASS                          | —      |
| KDS lifecycle      | Kitchen         | Station A        | Two queued orders          | Prepare, recall, complete, cancel | All actions returned success            | Real KDS API and PostgreSQL         | PASS                          | —      |
| KDS reconnect      | Kitchen         | Station A        | Terminal orders            | Snapshot removes terminal work    | 0 active cards after snapshot           | KDS snapshot                        | PASS                          | —      |
| KDS authority      | Kitchen         | Pilot business   | KDS credential             | Financial mutation denied         | Returned 401                            | KDS negative request                | PASS                          | —      |
| API restart        | Support         | Pilot runtime    | Sale and refund persisted  | Service returns with same facts   | `1                                      | 1` before and after                 | Docker restart and PostgreSQL | PASS   | —   |
| Unauthorized admin | Anonymous       | Pilot business   | No session                 | Mutation denied                   | Returned 401                            | API request                         | PASS                          | —      |
| Recovery backlog   | Manager         | Pilot business   | Rehearsal complete         | No unresolved command             | 13 total; 0 unresolved                  | Gate 7A recovery query              | PASS                          | —      |
| Readiness          | Owner, Support  | Pilot runtime    | Configuration complete     | Ready or bounded warnings         | READY WITH WARNINGS                     | `pilot:readiness`                   | OBSERVATION                   | G9A-O1 |

## Reconciliation

| Area      | Result | Evidence                                                     |
| --------- | ------ | ------------------------------------------------------------ |
| Financial | PASS   | Gross 9000, refund 4499, net 4501 minor units.               |
| Inventory | PASS   | Sixteen item projections matched ledgers. Drift count was 0. |
| Loyalty   | PASS   | Net points were 1010.                                        |
| Wallet    | PASS   | Ledger and projection both reported 50000 minor units.       |
| Gift card | PASS   | Ledger and projection both reported 25000 minor units.       |
| Recovery  | PASS   | No unresolved code-controlled command remained.              |

## Operational results

Owner could inspect business context, users, devices, registers, catalog, inventory, sales, refunds, customers, stored value, recovery, audit, and diagnostics.

Manager scope remained location-bound. Viewer mutation remained denied. KDS credentials did not gain financial authority.

Dashboard and API used business terms. Normal onboarding did not require SQL, Supabase, raw identifiers, or developer-only fields.

## Failure and recovery

API restart returned to ready state. Persisted sale and refund counts did not change.

KDS snapshot reconciliation removed completed and cancelled work. It did not create a duplicate card.

An unsupported old release worktree could not migrate from `build-v3-46` to `build-v3-48`. The current migration chain then restored the disposable environment safely.

The Gate 6B close runner used a fixed cash count. It failed safely when current expected cash differed. It did not create an invalid reconciliation.

## Defect ledger

| ID       | Severity    | Area                  | Issue                                                  | Impact                                                                             | Status        |
| -------- | ----------- | --------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------- |
| G9A-O1   | Observation | Storage               | Object-storage provider policy remains deferred.       | No financial authority impact.                                                     | OPEN, bounded |
| G9A-P2-1 | P2          | Certification tooling | Gate 6B close runner uses one fixed count.             | A changed fixture needs a current expected value. Product rejects mismatch safely. | OPEN          |
| G9A-P2-2 | P2          | Release rehearsal     | Gate 6A manifest predates later certification commits. | Gate 9B must create the Pilot RC manifest.                                         | OPEN          |

Open P0 defects: 0.

Open P1 defects: 0.

## Physical and provider observations

- Physical iPad and touch distance remain unverified.
- Printer, drawer, scanner, and customer display used the simulator.
- External payment behavior remains provider-dependent.
- Object-storage policy remains unresolved.
- Owner visual preferences remain pilot-dependent.

## Decision

The product can enter Pilot RC preparation. Gate 9B is authorized with observations. Gate 9B has not started.
