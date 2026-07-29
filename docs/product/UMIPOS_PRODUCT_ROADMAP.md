# UmiPOS Product Roadmap

Updated: 2026-07-29

| Gate                                    | Status                     | Dependency             | Next objective                                             | Blocker                                                 | Validation                                                                                                               |
| --------------------------------------- | -------------------------- | ---------------------- | ---------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Platform certification                  | Complete                   | Gates 1A–1E            | Maintain certified authority                               | None                                                    | Gate 1F certified                                                                                                        |
| 2A Flutter bootstrap                    | Complete                   | Platform certification | Begin device trust                                         | None                                                    | Analyze, focused tests, contract drift, web debug build                                                                  |
| 2B Device trust and operator experience | Complete                   | 2A                     | Maintain trusted entry                                     | None                                                    | Administrator-approved pairing and personal PIN operator entry passed focused API, database, Flutter, and Web validation |
| 2C Read-only catalog                    | Complete                   | 2B, catalog contracts  | Maintain authoritative browsing                            | None                                                    | Contract, API, migration, Flutter, cache and web validation passed                                                       |
| 2D Authoritative cart                   | Complete                   | 2C, cart contracts     | Maintain sale preparation                                  | None                                                    | Focused contract, API, Flutter, migration and web validation                                                             |
| 2E Checkout and online sale commit      | Complete                   | 2D, command contracts  | Maintain authoritative online sale                         | None                                                    | Contract, API, migration, Flutter and web validation                                                                     |
| 2F Offline journal and reconciliation   | Complete with observations | 2E, command envelopes  | Preserve certified offline boundary                        | Linux CMake, Ninja, Clang, and GTK prerequisites absent | Focused contract, API, Flutter, Web, migration and PostgreSQL negative checks passed                                     |
| Later platform work                     | Planned                    | 2F                     | Cash, inventory, refunds, KDS, customer display, Assistant | Domain gates                                            | Not run                                                                                                                  |

The latest relevant revision for Gate 2F is the final closeout commit containing this document.
Native encrypted offline support covers the explicit allowlist and server-policy-authorized cash;
Web sensitive journaling remains disabled. UMI remains the
sole business authority; Flutter owns presentation, hardware integration, encrypted local state,
and controlled future synchronization.
