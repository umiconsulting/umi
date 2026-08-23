# Phase 0C — Authority Audit

## Target authority

| Concern                             | Sole target owner            | Current result   | Required action                                                 |
| ----------------------------------- | ---------------------------- | ---------------- | --------------------------------------------------------------- |
| Identity and sessions               | UMI API                      | PARTIAL / UNSAFE | Add durable revocation. Remove direct Supabase Auth.            |
| Business, branch, staff, permission | UMI API                      | PARTIAL          | Complete branch grants and POS permissions.                     |
| Entitlements                        | UMI API                      | PARTIAL          | Wire the shared vocabulary and add POS grants.                  |
| Contract                            | `packages/contract`          | PARTIAL          | Remove DTO duplication. Emit neutral artifacts.                 |
| Migrations                          | UMI Supabase                 | CONTRADICTORY    | Replace build scripts and app Prisma authority with one ledger. |
| Catalog, pricing, tax               | UMI API                      | PARTIAL          | Complete effective branch catalog authority.                    |
| Customer and loyalty                | UMI API                      | CONTRADICTORY    | Retire the app-local Prisma authority after cutover.            |
| Checkout and orders                 | UMI API                      | MISSING          | Keep priced checkout separate from fulfillment status.          |
| Payments, refunds, receipts         | UMI API                      | MISSING          | Add immutable financial authorities.                            |
| Inventory and physical cash         | UMI API                      | MISSING          | Add separate append-only ledgers.                               |
| Reporting                           | UMI API                      | PARTIAL          | Use reconciled security-invoker projections.                    |
| KDS truth                           | UMI API                      | PARTIAL          | Remove direct edge-function authority.                          |
| Audit and telemetry                 | UMI API                      | PARTIAL          | Add POS event taxonomy and redaction proof.                     |
| Device trust and offline commands   | UMI API plus POS key/journal | MISSING          | Add signed proof and ordered replay.                            |

## Conflicts

- `docs/migration/build-v3` and `apps/umi-cash/prisma` both describe database authority.
- `apps/umi-dashboard/src/lib/supabase.js` retains a direct Auth client.
- KDS documents retain anon-key edge-function command paths.
- `packages/contract` and server class-validator DTOs both define request shapes.
- The `apps/umi-cash` name means loyalty and wallet. It does not mean physical cash.
- API role names differ across build-v3, `.env.example`, and deployment documents.
- Worker BYPASSRLS reads depend on perfect explicit predicates. They are not a request authority.

## Prohibited POS authority

UmiPOS must not contain:

- a Supabase credential or direct table/RPC path;
- handwritten API payload maps or guessed routes;
- authoritative price, tax, total, business-date, loyalty, cash, or inventory calculations;
- a second identity, role, entitlement, audit, or reconciliation model;
- mutable financial history;
- a local command result that claims server authority before sync.

## NEXO status

NEXO provides rules, vectors, and design evidence only. It supplies no runtime dependency.
