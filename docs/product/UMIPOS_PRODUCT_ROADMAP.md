# UmiPOS Product Roadmap

Updated: 2026-08-06

| Gate                                    | Status                     | Dependency             | Next objective                            | Blocker                                                                                                                     | Validation                                                                                                                |
| --------------------------------------- | -------------------------- | ---------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Platform certification                  | Complete                   | Gates 1A–1E            | Maintain certified authority              | None                                                                                                                        | Gate 1F certified                                                                                                         |
| 2A Flutter bootstrap                    | Complete                   | Platform certification | Begin device trust                        | None                                                                                                                        | Analyze, focused tests, contract drift, web debug build                                                                   |
| 2B Device trust and operator experience | Complete                   | 2A                     | Maintain trusted entry                    | None                                                                                                                        | Administrator-approved pairing and personal PIN operator entry passed focused API, database, Flutter, and Web validation  |
| 2C Read-only catalog                    | Complete                   | 2B, catalog contracts  | Maintain authoritative browsing           | None                                                                                                                        | Contract, API, migration, Flutter, cache and web validation passed                                                        |
| 2D Authoritative cart                   | Complete                   | 2C, cart contracts     | Maintain sale preparation                 | None                                                                                                                        | Focused contract, API, Flutter, migration and web validation                                                              |
| 2E Checkout and online sale commit      | Complete                   | 2D, command contracts  | Maintain authoritative online sale        | None                                                                                                                        | Contract, API, migration, Flutter and web validation                                                                      |
| 2F Offline journal and reconciliation   | Complete with observations | 2E, command envelopes  | Preserve certified offline boundary       | Historical toolchain observation resolved in Gate 3A                                                                        | Focused contract, API, Flutter, Web, migration and PostgreSQL negative checks passed                                      |
| 3A Sale lifecycle foundation            | Complete                   | 2F                     | Maintain cashier sale lifecycle           | None                                                                                                                        | Focused contract, API, Flutter, accessibility, localization, Linux, and PostgreSQL checks passed                          |
| 3B Advanced checkout and payment        | Complete                   | 3A                     | Maintain the checkout lifecycle           | None                                                                                                                        | Focused contract, API, Flutter, accessibility, localization, Linux, and PostgreSQL checks passed                          |
| 3C Cash shift and register operations   | Complete                   | 3B                     | Maintain cash custody controls            | None                                                                                                                        | Focused contract, API, Flutter, accessibility, localization, Linux, and PostgreSQL checks passed                          |
| 3D Refunds, voids, and exceptions       | Complete                   | 3C                     | Maintain immutable post-sale compensation | None                                                                                                                        | Focused contract, API, Flutter, accessibility, localization, Linux, Web, and PostgreSQL checks passed                     |
| 3D.1 Pilot RBAC alignment               | Complete                   | 3D                     | Maintain least-privilege pilot grants     | Production thresholds require Owner approval                                                                                | Matrix, seed, API, Flutter, authorization, PostgreSQL, RLS, and deterministic PR checks passed                            |
| 3E Inventory synchronization            | Complete                   | 3D.1                   | Maintain the inventory authority          | Production policy requires Owner review                                                                                     | Contract, API, Flutter, inventory, concurrency, PostgreSQL, RLS, Linux, Web, and deterministic PR checks passed           |
| 3F Customers, loyalty, and stored value | Incomplete                 | 3E                     | Close the remaining Gate 3F invariants    | Concurrency, consent, reward approval, stored-value tender binding, gift-card proof, and sale-funded activation remain open | Focused contract, API, Flutter, expiry, PostgreSQL, RLS, Linux, Web, and deterministic PR checks pass for the safe subset |

The latest relevant revision is the Gate 3F closeout commit in PR #72.
PR #72 keeps Gates 3A through 3E complete. Gate 3F remains incomplete.
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

Gate 3F adds scoped customers, immutable ledgers, historical policy, one earn engine, rewards,
stored-value authorization, exact expiry, adjustments, protected promotional issuance, composite
history, refund compensation, RLS, rate limits, and recovery. The full executable concurrency
matrix remains open. Consent reconciliation, reward approval, gift-card proof, and sale-funded activation remain
fail-closed. Gate 3G is not authorized and has not started.
