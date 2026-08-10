# UmiPOS Product Roadmap

Updated: 2026-08-10

| Gate                                    | Status                     | Dependency             | Next objective                            | Blocker                                              | Validation                                                                                                               |
| --------------------------------------- | -------------------------- | ---------------------- | ----------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Platform certification                  | Complete                   | Gates 1A–1E            | Maintain certified authority              | None                                                 | Gate 1F certified                                                                                                        |
| 2A Flutter bootstrap                    | Complete                   | Platform certification | Begin device trust                        | None                                                 | Analyze, focused tests, contract drift, web debug build                                                                  |
| 2B Device trust and operator experience | Complete                   | 2A                     | Maintain trusted entry                    | None                                                 | Administrator-approved pairing and personal PIN operator entry passed focused API, database, Flutter, and Web validation |
| 2C Read-only catalog                    | Complete                   | 2B, catalog contracts  | Maintain authoritative browsing           | None                                                 | Contract, API, migration, Flutter, cache and web validation passed                                                       |
| 2D Authoritative cart                   | Complete                   | 2C, cart contracts     | Maintain sale preparation                 | None                                                 | Focused contract, API, Flutter, migration and web validation                                                             |
| 2E Checkout and online sale commit      | Complete                   | 2D, command contracts  | Maintain authoritative online sale        | None                                                 | Contract, API, migration, Flutter and web validation                                                                     |
| 2F Offline journal and reconciliation   | Complete with observations | 2E, command envelopes  | Preserve certified offline boundary       | Historical toolchain observation resolved in Gate 3A | Focused contract, API, Flutter, Web, migration and PostgreSQL negative checks passed                                     |
| 3A Sale lifecycle foundation            | Complete                   | 2F                     | Maintain cashier sale lifecycle           | None                                                 | Focused contract, API, Flutter, accessibility, localization, Linux, and PostgreSQL checks passed                         |
| 3B Advanced checkout and payment        | Complete                   | 3A                     | Maintain the checkout lifecycle           | None                                                 | Focused contract, API, Flutter, accessibility, localization, Linux, and PostgreSQL checks passed                         |
| 3C Cash shift and register operations   | Complete                   | 3B                     | Maintain cash custody controls            | None                                                 | Focused contract, API, Flutter, accessibility, localization, Linux, and PostgreSQL checks passed                         |
| 3D Refunds, voids, and exceptions       | Complete                   | 3C                     | Maintain immutable post-sale compensation | None                                                 | Focused contract, API, Flutter, accessibility, localization, Linux, Web, and PostgreSQL checks passed                    |
| 3D.1 Pilot RBAC alignment               | Complete                   | 3D                     | Maintain least-privilege pilot grants     | Production thresholds require Owner approval         | Matrix, seed, API, Flutter, authorization, PostgreSQL, RLS, and deterministic PR checks passed                           |
| 3E Inventory synchronization            | Complete                   | 3D.1                   | Maintain the inventory authority          | Production policy requires Owner review              | Contract, API, Flutter, inventory, concurrency, PostgreSQL, RLS, Linux, Web, and deterministic PR checks passed          |
| 3F Customers, loyalty, and stored value | Complete                   | 3E                     | Authorize Gate 3G hardware foundations    | Owner production limits and legal review remain      | Contract, API, Flutter, 26 real races, PostgreSQL, RLS, Linux, Web, and deterministic PR checks passed                   |
| 3G-A Pilot hardware runtime foundation  | Complete                   | 3F                     | Authorize Gate 3G-B pilot hardware        | Physical hardware and vendor adapters remain         | Contract, API, Flutter, simulator, recovery, PostgreSQL, RLS, Linux, Web, and PR checks passed                           |
| 3G-B Pilot hardware integration         | Complete with observations | 3G-A                   | Authorize Gate 4A KDS integration         | Physical hardware validation remains                 | Generic printer, drawer, scanner, simulator, API, PostgreSQL, RLS, Flutter, Linux, Web, and PR checks passed             |
| 4A KDS operational integration          | Complete with observations | 3G-B                   | Authorize Gate 5A Dashboard completion    | Xcode validation was unavailable in the Linux runner | Existing KDS static review, API, contracts, POS status, 10 real races, PostgreSQL, RLS, reconnect, and PR checks passed  |
| 5A Dashboard operational completion     | Complete                   | 4A                     | Authorize Gate 6A pilot deployment        | None                                                 | Live Dashboard, session, CSRF, API, domains, PostgreSQL, RLS, 24-case matrix, and P0 walkthrough passed                  |

The latest relevant revision is the Gate 5A live certification commit in PR #72.
PR #72 keeps Gates 3A through 5A complete.
Native encrypted offline support covers the explicit allowlist and server-policy-authorized cash;
Web sensitive journaling remains disabled. UMI remains the
sole business authority; Flutter owns presentation, hardware integration, encrypted local state,
and controlled future synchronization.

Gate 3A adds one active cashier sale, suspend/resume, cancellation, restart recovery, customer
attachment, paginated sale navigation, receipt navigation, and automatic next-sale creation.
Its Linux debug build passed with the current workspace toolchain.

Gate 3B adds cash, manual terminal, mixed tender, tips, discounts, bound manager approval,
payment recovery, receipt intent, and atomic sale, payment, and receipt commit.

Gate 3C adds the physical register, cash shift, opening float, append-only cash ledger,
cash movements, handoff, blind count, variance approval, reconciliation, and atomic close.
Advanced cash operations remain online-only. A cash sale can use the Gate 2F offline policy.

Gate 3D adds server-authorized void and refund eligibility, full and partial refunds, historical
tax and discount allocation, tender and cash compensation, manager approval, restock intent,
immutable compensation receipts, history, and recovery. It does not change inventory. Manual
terminal refund success remains an operator assertion. All exception mutations require online authority.

Gate 3D.1 adds deterministic pilot profiles for Owner, Admin, Manager, Supervisor, Cashier,
Staff, and Viewer. It keeps `super_admin` outside the café journey. The API combines permission,
scope, entitlement, device trust, operator session, policy, and command-bound approval.

Gate 3E adds merchant and location scoped inventory. It uses explicit units, mappings, recipes,
reservations, an immutable stock ledger, and a reproducible balance projection. A sale commits its
stock effect with its financial facts. A refund consumes its immutable restock intent. Adjustments,
waste, quarantine, counts, and reconciliation create new facts. Direct inventory mutations remain
online-only.

Gate 3F adds scoped customers, immutable ledgers, historical policy, one earn engine, and rewards.
It adds one stored-value allocation and fingerprint, wallet and gift-card payment, and funded activation.
It adds exact manager approval, explicit global history visibility, signed cursors, and exact recovery.
All 26 races passed with real PostgreSQL sessions.

Gate 3G-A adds one hardware registry, command runtime, persistent print queue, and safe recovery path.
It adds deterministic printer, drawer, scanner, and customer display simulators. Payment terminal and scale stay as foundations.
Gate 3G-B adds generic TCP printing, a printer-attached drawer, and keyboard-wedge scanning.
It adds server-owned pilot configuration, bounded reconnect, deterministic rendering, and a simulated cashier walkthrough.
Physical validation was unavailable. This status does not certify a device or vendor.
Gate 4A adds one authoritative kitchen projection and deterministic station routing.
It adapts the existing SwiftUI KDS to safe snapshots, ordered events, stable commands, and fail-closed reconnect.
It adds safe POS kitchen status and runs all 10 focused races with independent PostgreSQL sessions.
Gate 5A adds a safe and paginated read model for all 21 operational domains.
It connects refund, inventory, hardware, reprint, loyalty, gift-card, catalog, register, kitchen, and recovery commands.
The Dashboard uses the same domain authority, approvals, fingerprints, and recovery as each operational client.
Physical commands use a typed relay to an assigned enrolled POS runtime.
Cash movement remains POS-only. Wallet funding remains read-only by product policy.
Gate 5A passed one authenticated browser walkthrough and the 24-case authority matrix.
Both tests used the real API, domain services, PostgreSQL, RLS, approvals, idempotency, and audit.
Exact retries for refund, inventory, loyalty, and hardware added no duplicate fact.
Gate 6A is authorized and has not started.
