# UmiPOS Product Completion

Updated: 2026-08-13

## Decision

Gate 10 verdict: `SOFTWARE PRODUCT COMPLETE WITH P2`.

Gate 11 authorization: `YES WITH P2`.

Current release: `UMI POS Pilot RC2`, version `6.0.0-pilot.rc2`.
Artifact source: `1e885022b654dcecf943377ea2e1e3b739a9027a`.
RC1 is `SUPERSEDED — DO NOT DEPLOY`.

Gate 10 changed documentation only. RC2 executable code, artifacts, checksums, schema, and configuration remain unchanged.

## Architecture boundary

- UMI API and PostgreSQL own business authority.
- Flutter owns POS presentation, enrolled-device behavior, encrypted local state, and controlled replay.
- Dashboard owns merchant administration and operational review.
- KDS owns kitchen presentation and commands within the backend policy.
- Redis supports sessions, rate limits, queues, and transient coordination. It is not financial authority.
- Workers process bounded schedules, outbox delivery, retries, and expiry. They do not invent business facts.
- Object storage and integrated payment providers are optional external boundaries.
- `NEXO LEGACY RUNTIME DEPENDENCY: NONE`.

## Product inventory

| Area                         | Status                              | Current v1 boundary                                                                                                                                     |
| ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                          | COMPLETE                            | Merchant commands, business reads, auth, devices, POS, KDS, Dashboard, recovery, audit, and health                                                      |
| Dashboard                    | COMPLETE                            | Merchant administration, operations, history, recovery, audit, and diagnostics                                                                          |
| Worker                       | COMPLETE                            | Queues, outbox, bounded retry, dead-letter visibility, lifecycle, and customer-value expiry                                                             |
| PostgreSQL                   | COMPLETE                            | `build-v3-48`, deterministic migration, FORCE RLS, immutable business facts, and projections                                                            |
| Redis                        | COMPLETE WITH DOCUMENTED LIMITATION | Required transient infrastructure; PostgreSQL remains authority during Redis failure                                                                    |
| Observability                | COMPLETE                            | Release identity, health, readiness, correlation, audit, recovery, support bundles, and redaction                                                       |
| Object storage               | NOT IN V1 SCOPE                     | Disabled. No RC2 primary workflow requires it                                                                                                           |
| Deployment and configuration | COMPLETE                            | RC2 manifest, checked configuration, clean build, deployment, backup, restore, rollback, and smoke                                                      |
| Authentication and sessions  | COMPLETE                            | Password flows, session refresh and revocation, operator PIN, expiry, rate limits, and CSRF protections                                                 |
| Roles and permissions        | COMPLETE                            | Owner, Admin, Manager, Supervisor, Cashier, Staff, Viewer, effective permission, and approval separation                                                |
| Tenant and location scope    | COMPLETE                            | Server authorization, RLS, explicit location grants, no null wildcard, and denial after revocation                                                      |
| Device identity              | COMPLETE                            | Enrollment, trust, assignment, rotation, revocation, replay policy, and re-enrollment                                                                   |
| Merchant and locations       | COMPLETE                            | Business settings, locations, regional and receipt policy, feature policy, and scope projection                                                         |
| Users and memberships        | COMPLETE                            | Creation, invitation where exposed, roles, locations, status, revocation, and last-Owner protection                                                     |
| Registers                    | COMPLETE                            | Configuration, location and device assignment, hardware assignment, and shift distinction                                                               |
| Catalog                      | COMPLETE                            | Products, categories, types, variants, options, pricing, barcodes, media policy, availability, and location scope                                       |
| Inventory                    | COMPLETE                            | Ledger, projections, stock states, recipes, reservations, adjustments, counts, transfer states, and reconciliation. Advanced costing is not in v1 scope |
| Sales                        | COMPLETE                            | Cart, totals, cash, manual terminal, wallet, gift card, mixed tender, suspend, cancel, commit, history, and idempotency                                 |
| Receipts                     | COMPLETE                            | Immutable receipt facts, official and compensation receipts, print jobs, COPY, and traceability                                                         |
| Refunds and voids            | COMPLETE                            | Eligibility, approval, immutable compensation, tender effects, restock intent, and reconciliation                                                       |
| Shifts and cash              | COMPLETE                            | Open, float, movements, handoff, blind count, variance, approval, reconciliation, close, and history                                                    |
| Customers                    | COMPLETE                            | Search, minimal creation, attach, consent, privacy, merge protection, and history                                                                       |
| Loyalty                      | COMPLETE                            | Policy snapshots, earn, reward authorization, redemption, reversal, expiry, adjustment, and reconciliation                                              |
| Wallet                       | COMPLETE                            | Account facts, authorization, debit, release, refund, privacy, history, and reconciliation                                                              |
| Gift cards                   | COMPLETE                            | Secure issuance, masked lookup, authorization, activation, debit, refund, limits, and reconciliation                                                    |
| KDS                          | COMPLETE WITH DOCUMENTED LIMITATION | Board, routing, lifecycle, recall, cancellation, degraded state, reconnect, deduplication, and accessibility; physical iPad is Gate 13                  |
| Recovery and diagnostics     | COMPLETE                            | Command lookup, safe retry, response loss, offline conflicts, hardware uncertainty, audit, and support detail                                           |
| Flutter POS                  | COMPLETE WITH DOCUMENTED LIMITATION | Linux v1 client is complete. Web is compatibility-only for sensitive offline state. Apple and hardware evidence are Gate 13                             |
| Hardware adapters            | DEFERRED TO HARDWARE CERTIFICATION  | Software command, simulator, generic printer, drawer, scanner, and display contracts are complete                                                       |
| Integrated payment provider  | NOT IN V1 SCOPE                     | Manual external-terminal assertion is supported. Real integrated authorization remains disabled                                                         |

## Flutter POS completion

The Flutter client contains these complete software flows:

- Configuration, bootstrap, secure storage, release compatibility, and recovery.
- Device enrollment, trust, authentication, operator PIN, merchant, location, register, and operator context.
- Catalog categories, search, barcode input, availability, variants, options, and product configuration.
- Authoritative cart, quantity, modifiers, customer attachment, discount, tip, reward, and totals.
- Cash, manual terminal, wallet, gift card, mixed tender, receipt intent, commit, and next sale.
- Suspend, resume, cancel, history, receipt navigation, refund, void, inventory, shift, and cash operations.
- Native encrypted offline cash journal, provisional receipt, ordered replay, conflict, and Recovery Center.
- Hardware coordination, scanner-sensitive input protection, printer and drawer recovery, KDS status, and diagnostics.
- Spanish and English localization, keyboard navigation, semantic labels, responsive layouts, text scaling, and reduced motion.

The generated `_ReadyShell` fallback and old `catalogNotImplemented` key are not the routed ready state. The typed navigation guard routes a trusted ready operator to `CatalogSurface`. Their removal is a P2 cleanup because no certified workflow reaches a dead end.

## Dashboard completion

The Dashboard contains complete v1 administration for merchant operations. It includes settings, staff, devices, catalog, inventory, sales, and customer value.

It also includes receipts, refunds, shifts, KDS operations, recovery, audit, and diagnostics.

Server authorization remains the final control for hidden actions and deep links. Empty, loading, denial, conflict, recovery, and service error states passed Gate 8B and Gate 9A browser checks.

## KDS completion

The SwiftUI KDS contains these complete software functions:

- Pairing, environment configuration, device session, and station context.
- Snapshot and realtime clients with a cached board state.
- Item quantities, modifiers, priority, preparation, ready, complete, recall, and cancel actions.
- Heartbeat, degraded mode, reconnect, reconciliation, deduplication, and terminal states.
- Accessibility labels and adaptive columns.

Xcode, Apple signing, and physical iPad evidence belong to Gate 13. They do not hide a missing KDS software state.

## Business-rule authority

| Rule                  | Authoritative answer                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| Refund authority      | Current permission, scope, device, session, policy, object, and one-use approval are checked at commit |
| Cancellation          | An editable sale can cancel; a committed sale requires the server exception policy                     |
| Terminal sale         | Commit creates immutable sale, tender, receipt, inventory, cash, and customer-value facts atomically   |
| Inventory on sale     | Versioned mappings and reservations create append-only stock facts inside the sale transaction         |
| Inventory on refund   | Refund records intent; one idempotent inventory outcome records restock or disposition                 |
| Receipt copy          | COPY is a print fact. It does not create or replace a receipt or sale                                  |
| Owner assignment      | Merchant authority and last-Owner protection apply                                                     |
| User revocation       | Current membership and location authority are checked at each protected commit                         |
| Device management     | Permission, merchant, location, device trust, and current credential apply                             |
| Shift close           | Blind count, expected cash, variance, policy, approval, and immutable close facts apply                |
| Customer value refund | Historical policy and allocation create proportional append-only reversals                             |
| Retry safety          | Stable command identity and fingerprint return the original result or a typed conflict                 |
| Connectivity recovery | Query the original command before any new mutation; offline replay uses ordered native journal records |

## Error and first-use states

The API returns typed validation, authentication, permission, missing, conflict, semantic validation, rate-limit, and server failures. Dashboard and POS map normal failures to operator language and keep correlation detail secondary.

First-use states exist for products, searches, suspended sales, customers, rewards, recovery, inventory alerts, hardware, shifts, KDS orders, devices, sales, and audit filters. A missing required configuration fails startup or presents a bounded setup state.

## Security completion

Previous authoritative gates certified authentication and session revocation. They certified CSRF, CORS, secure cookies, device trust, and rate limits.

They also certified approval binding, tenant isolation, location isolation, FORCE RLS, immutable audit, privacy, redaction, and gift-card masking.

Gate 10 found no later executable change and no new exploitable gap. The API login is not a superuser and does not bypass RLS. The limited worker role retains its documented cross-merchant machinery boundary.

## Data and worker completion

Clean migration ends at `build-v3-48`. No manual data edit, development migration, seed dependency, or NEXO schema is required.

Worker responsibilities include turn processing, enrichment, outbound delivery, integrations, lifecycle schedules, lead schedules, customer-value expiry, outbox relay, bounded retry, and dead-letter recording. Queue defaults limit attempts, backoff, retention, and stalled work. Worker readiness records the release identity.

The `StubToolsService` and phase comments are retained compatibility and historical code. `RealToolsService` is the active dependency injection binding. Stale phase wording is P2 source-comment debt, not a runtime stub.

## Test inventory

| Subsystem                                    | Evidence                                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Authentication, RBAC, approval, and tenancy  | API unit matrices, PostgreSQL RLS checks, pilot role generator, revocation, BOLA, and Gate 7B security evidence |
| Merchant, locations, users, and devices      | API tests, device pairing tests, clean bootstrap, Dashboard operational tests, and role walkthroughs            |
| Catalog, cart, checkout, sales, and receipts | API tests, 28-file Flutter suite, browser tests, database certification, and 100-sale stress sequence           |
| Cash, shifts, refunds, and recovery          | Domain tests, Flutter tests, database checks, response-loss checks, close runner, and reconciliation            |
| Inventory                                    | Domain, migration, Flutter, PostgreSQL, concurrency, projection, and reconciliation checks                      |
| Customer, loyalty, wallet, and gift cards    | Domain, Flutter, privacy, 26 PostgreSQL races, expiry, refund, and reconciliation checks                        |
| KDS                                          | API tests, 14 PostgreSQL races, Swift repository tests, static checks, lifecycle, and reconnect simulation      |
| Hardware                                     | API, Flutter, simulator, command recovery, and PostgreSQL checks                                                |
| Workers and outbox                           | Scheduler, enqueue, options, dead-letter, relay, processor, restart, and backlog checks                         |
| Migrations and release                       | Schema parity, clean migration, RC manifest, clean build, smoke, backup, restore, and rollback evidence         |
| Dashboard                                    | Component and operation tests, lint, production build, browser, responsive, role, and accessibility checks      |

The skip audit used `rg -n "\\b(describe|it|test)\\.(skip|todo)|@Skip|skipTest|XCTSkip" apps packages scripts`.
One database integration suite uses `describe.skip` when `DATABASE_URL` is absent. Real PostgreSQL certification ran the same KDS behavior.
Apple and physical tests remain deferred. No software-controlled skipped test hides a P0 or P1 defect.

## Gate 10 validation

- API tests: 118 files passed; 857 tests passed; one 14-case PostgreSQL KDS file skipped without `DATABASE_URL`.
- API typecheck and production build: PASS.
- Flutter analyze: PASS with no issue.
- Flutter tests: 178 passed.
- Flutter Linux release build with RC2 configuration: PASS.
- Dashboard tests: 5 files and 12 tests passed.
- Dashboard lint: 0 errors; 49 warnings matched the approved baseline.
- Dashboard production build with the explicit pilot contract: PASS.
- Pilot runtime support-bundle test: PASS.
- Pilot readiness and fixture tests: 6 passed.
- Migration behavior: static migration suites passed inside the API suite. Gate 9C clean `build-v3-48` evidence remains authoritative.
- KDS: software source, API tests, PostgreSQL concurrency, lifecycle, reconnect, and Gate 8B static evidence remain authoritative. Xcode is deferred.
- Canonical PR check and GitHub checks are recorded in the publication result for this gate.

## Performance and dependencies

Gate 7B measured 100 representative sales with a 133 ms mean and 178 ms maximum in the certification environment. No later executable change affects these paths.

Lockfiles are authoritative. RC2 built without undeclared global runtime dependencies. Gate 10 does not mass-upgrade packages. Existing lint warnings remain at the approved baseline and have no new category.

## Documentation closure

- `docs/product/UMIPOS_DOCUMENTATION_INDEX.md` identifies current, historical, and superseded documents.
- `docs/product/UMIPOS_GLOSSARY.md` defines the canonical business and technical terms.
- `docs/pilot/UMIPOS_SUPPORT_RUNBOOK.md` provides the troubleshooting baseline and role boundaries.
- `docs/certification/UMIPOS_DEFERRED_HARDWARE_VALIDATION.md` moves physical and provider evidence to Gate 13.
- `apps/umi-pos/README.md` now describes the complete client instead of the old gated foundation.

## Scope decisions

| Capability                          | Decision                          | Reason                                                                       |
| ----------------------------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| Linux Flutter POS                   | Included in v1                    | Built and certified as the RC2 POS artifact                                  |
| Web Flutter POS                     | Compatibility target              | Sensitive offline journal is native-only by design                           |
| iPad or iOS POS                     | Deferred to Gate 13               | Software is shared; Apple build, signing, and physical evidence are external |
| Android Flutter POS                 | Not in v1 scope                   | RC2 has no certified Android release artifact                                |
| Windows Flutter POS                 | Not in v1 scope                   | RC2 has no certified Windows release artifact                                |
| macOS Flutter POS                   | Not in v1 scope                   | RC2 has no certified macOS release artifact                                  |
| SwiftUI KDS                         | Included in v1 software           | Software lifecycle is complete; physical target evidence is Gate 13          |
| Cash and manual terminal            | Included in v1                    | Financial facts and operator assertion are certified                         |
| Wallet, gift card, and mixed tender | Included in v1                    | Online authority, atomic effects, privacy, and reconciliation are certified  |
| Integrated payment provider         | Excluded from v1 enablement       | No real provider certification exists                                        |
| Object storage                      | Excluded from v1 enablement       | RC2 primary workflows do not require it                                      |
| Physical peripherals                | Software-ready; deferred evidence | Each required device must pass Gate 13 before use                            |
| Advanced inventory costing          | Not in v1 scope                   | v1 certifies quantity facts and projections; it makes no costing claim       |
| Advanced enterprise reports         | Not in v1 scope                   | Current Dashboard operational views meet the certified pilot scope           |
| Standalone NEXO services            | Excluded                          | UMI is the only runtime authority                                            |

## Completion findings

| ID     | Class            | Finding                                                                                    | Disposition                                                                                          |
| ------ | ---------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| G10-01 | P1 documentation | Flutter README stated that completed features were unavailable                             | CLOSED: README now reflects the current client                                                       |
| G10-02 | P1 documentation | Canonical roadmap data marked certified native offline support incomplete                  | CLOSED: Gate 7A evidence confirms native replay; canonical status now states the native/Web boundary |
| G10-03 | P1 documentation | Dashboard deployment instructions described a removed Express, database, and Supabase path | CLOSED: instructions and environment example now describe the static UMI API client                  |
| G10-07 | P1 documentation | Flutter release targets were ambiguous and Android retained development signing defaults   | CLOSED: v1 release targets now exclude uncertified Android, Windows, and macOS artifacts             |
| G10-08 | P1 documentation | The inventory scope did not state whether advanced costing was implemented                 | CLOSED: advanced costing is now explicitly outside v1 scope                                          |
| G10-09 | P1 documentation | The documentation inventory did not classify every required baseline area                  | CLOSED: the documentation index now has a complete area and status matrix                            |
| G10-04 | P2               | Dead ready-shell fallback retains old catalog placeholder copy                             | OPEN: unreachable in the typed ready route; remove with a later executable release if useful         |
| G10-05 | P2               | Historical Phase 3c comments still describe the inactive tool stub as pending              | OPEN: active DI uses `RealToolsService`; no runtime impact                                           |
| G10-06 | DEFERRED-G13     | Physical devices, real site, providers, and Apple tooling are unavailable                  | REGISTERED: Gate 13 owns this evidence                                                               |

P0 found: `0`. P0 open: `0`.
P1 found: `6`. P1 closed: `6`. P1 open: `0`.
P2 open: `2`.

## Final decision

All intended v1 software modules are implemented. Current architecture, migration, deployment, recovery, authority, and business truth are coherent. Baseline technical and operational documentation is complete.

Remaining P2 items do not create a user dead end or business-risk ambiguity. Physical and provider evidence is isolated to Gate 13.

`SOFTWARE PRODUCT COMPLETE WITH P2`

`Gate 11 — Owner Knowledge Base & Operational Handoff: YES WITH P2`
