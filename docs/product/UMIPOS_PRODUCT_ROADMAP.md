# UmiPOS Product Roadmap

Updated: 2026-07-27

| Gate | Status | Dependency | Next objective | Blocker | Validation |
| --- | --- | --- | --- | --- | --- |
| Platform certification | Complete | Gates 1A–1E | Maintain certified authority | None | Gate 1F certified |
| 2A Flutter bootstrap | Complete | Platform certification | Begin device trust | None | Analyze, focused tests, contract drift, web debug build |
| 2B Device trust and operator experience | Next | 2A | Enrollment and authenticated operator boundary | Server device workflows | Not run |
| 2C Read-only catalog | Planned | 2B, catalog contracts | Branch-aware browsing | Catalog readiness | Not run |
| 2D Online sale command | Planned | 2C, command contracts | First authoritative online sale | Order/payment boundaries | Not run |
| 2E Encrypted offline journal | Planned | 2D, reconciliation contracts | Ordered encrypted journal and recovery | Conflict/replay model | Not run |
| Later platform work | Planned | 2E | Cash, inventory, refunds, KDS, customer display, Assistant | Domain gates | Not run |

The latest relevant revision for Gate 2A is the commit containing this document. UMI remains the
sole business authority; Flutter owns presentation, hardware integration, encrypted local state,
and controlled future synchronization.
