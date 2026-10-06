# Phase 0C — Dependency Matrix

The JSON manifest is the complete record:
[`phase-0c-dependency-matrix.json`](./phase-0c-dependency-matrix.json).

## Summary

| ID      | Capability                                  | Status                 | POS app | First slice | Pilot |
| ------- | ------------------------------------------- | ---------------------- | :-----: | :---------: | :---: |
| DEP-001 | Workspace ownership                         | READY                  |   No    |     No      |  No   |
| DEP-002 | Supabase migration authority                | CONTRADICTORY          |   Yes   |     Yes     |  Yes  |
| DEP-003 | Tenant schema and RLS context               | PARTIAL                |   Yes   |     Yes     |  Yes  |
| DEP-004 | Staff identity and auth                     | PARTIAL                |   No    |     Yes     |  Yes  |
| DEP-005 | Durable sessions and revocation             | UNSAFE                 |   No    |     Yes     |  Yes  |
| DEP-006 | Business, branch, staff, permissions        | PARTIAL                |   No    |     Yes     |  Yes  |
| DEP-007 | Contract authority                          | PARTIAL                |   Yes   |     Yes     |  Yes  |
| DEP-008 | Generated Dart client and POS app           | MISSING                |   Yes   |     Yes     |  Yes  |
| DEP-009 | Device trust, PIN, and approval             | MISSING                |   No    |     Yes     |  Yes  |
| DEP-010 | Catalog, pricing, tax, and availability     | PARTIAL                |   No    |     Yes     |  Yes  |
| DEP-011 | Customers and loyalty                       | CONTRADICTORY          |   No    |     No      |  Yes  |
| DEP-012 | Checkout and atomic commit                  | MISSING                |   No    |     Yes     |  Yes  |
| DEP-013 | Payment intents and reconciliation          | MISSING                |   No    |     Yes     |  Yes  |
| DEP-014 | Receipts and refunds                        | MISSING                |   No    |     Yes     |  Yes  |
| DEP-015 | Inventory ledger                            | MISSING                |   No    |     Yes     |  Yes  |
| DEP-016 | Physical cash                               | MISSING                |   No    |     Yes     |  Yes  |
| DEP-017 | KDS projection and device flow              | PARTIAL                |   No    |     No      |  Yes  |
| DEP-018 | Queues, outbox, retry, and dead letter      | PARTIAL                |   No    |     No      |  Yes  |
| DEP-019 | Audit, telemetry, health, and redaction     | PARTIAL                |   No    |     Yes     |  Yes  |
| DEP-020 | Distributed rate limits                     | UNSAFE                 |   No    |     Yes     |  Yes  |
| DEP-021 | Removal of direct Supabase client authority | UNSAFE                 |   Yes   |     Yes     |  Yes  |
| DEP-022 | Reporting read models                       | PARTIAL                |   No    |     No      |  Yes  |
| DEP-023 | Offline command and reconciliation          | MISSING                |   No    |     No      |  Yes  |
| DEP-024 | Backup, restore, deployment, and rollback   | BLOCKED                |   No    |     No      |  Yes  |
| DEP-025 | Safe Umi Assistant platform                 | PARTIAL                |   No    |     No      |  No   |
| DEP-026 | Integrated acquiring                        | NOT_REQUIRED_FOR_ENTRY |   No    |     No      |  No   |
| DEP-027 | Flutter KDS replacement                     | NOT_REQUIRED_FOR_ENTRY |   No    |     No      |  No   |
| DEP-028 | Deferred v1 scope                           | OUT_OF_SCOPE           |   No    |     No      |  No   |

## Interpretation

`READY` means that current code and evidence can support POS. A route or table alone does not meet
this standard. Each JSON record contains all readiness dimensions, evidence, dependencies,
acceptance criteria, validation, gate, complexity, and risk.
