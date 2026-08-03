# UmiPOS Product Roadmap

Updated: 2026-07-29

| Gate                                    | Status                     | Dependency             | Next objective                                       | Blocker                                              | Validation                                                                                                               |
| --------------------------------------- | -------------------------- | ---------------------- | ---------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Platform certification                  | Complete                   | Gates 1A–1E            | Maintain certified authority                         | None                                                 | Gate 1F certified                                                                                                        |
| 2A Flutter bootstrap                    | Complete                   | Platform certification | Begin device trust                                   | None                                                 | Analyze, focused tests, contract drift, web debug build                                                                  |
| 2B Device trust and operator experience | Complete                   | 2A                     | Maintain trusted entry                               | None                                                 | Administrator-approved pairing and personal PIN operator entry passed focused API, database, Flutter, and Web validation |
| 2C Read-only catalog                    | Complete                   | 2B, catalog contracts  | Maintain authoritative browsing                      | None                                                 | Contract, API, migration, Flutter, cache and web validation passed                                                       |
| 2D Authoritative cart                   | Complete                   | 2C, cart contracts     | Maintain sale preparation                            | None                                                 | Focused contract, API, Flutter, migration and web validation                                                             |
| 2E Checkout and online sale commit      | Complete                   | 2D, command contracts  | Maintain authoritative online sale                   | None                                                 | Contract, API, migration, Flutter and web validation                                                                     |
| 2F Offline journal and reconciliation   | Complete with observations | 2E, command envelopes  | Preserve certified offline boundary                  | Historical toolchain observation resolved in Gate 3A | Focused contract, API, Flutter, Web, migration and PostgreSQL negative checks passed                                     |
| 3A Sale lifecycle foundation            | Complete                   | 2F                     | Maintain cashier sale lifecycle                      | None                                                 | Focused contract, API, Flutter, accessibility, localization, Linux, and PostgreSQL checks passed                         |
| 3B Advanced checkout and payment        | Complete                   | 3A                     | Maintain the checkout lifecycle                      | None                                                 | Focused contract, API, Flutter, accessibility, localization, Linux, and PostgreSQL checks passed                         |
| 3C Cash shift and register operations   | Complete                   | 3B                     | Approve the next commercial POS Gate                 | None                                                 | Focused contract, API, Flutter, accessibility, localization, Linux, and PostgreSQL checks passed                         |
| Later platform work                     | Planned                    | 3C                     | Inventory, refunds, KDS, customer display, Assistant | Next Gate scope approval                             | Not run                                                                                                                  |

The latest relevant revision is this PR #72 integration commit.
PR #72 keeps Gate 3A, Gate 3B, and Gate 3C complete on current `build-v3`.
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
