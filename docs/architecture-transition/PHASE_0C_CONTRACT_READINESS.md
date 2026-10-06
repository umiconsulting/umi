# Phase 0C — Contract Readiness

## Result

`packages/contract` is the correct owner. Its maturity is PARTIAL.

## Existing

- Typed route constants for auth, tenant, and selected loyalty Cash routes.
- Zod schemas for login, session, tenant summaries, and selected loyalty requests.
- A shared entitlement vocabulary with `pos`.
- CJS, ESM, and type output.
- Route literal and schema tests.

## Incomplete or duplicated

- Server request DTOs still use class-validator as a second authority.
- The dashboard reads some contract source and some direct Supabase surfaces.
- KDS maintains separate DTO and edge-function contracts.
- There is no language-neutral JSON artifact or Dart generator.
- There is no stable global error envelope with business codes and retry guidance.
- Version, content hash, API-major compatibility, and deprecation policy are absent.

## Missing POS contract

- Money in minor units and explicit currency.
- Business date and timestamp rules.
- Device ID, signed proof, nonce, operator session, and branch.
- Idempotency key, command ID, fingerprint, and result query.
- Optimistic checkout and shift versions.
- Catalog snapshot/delta, modifiers, barcode, media, tax, and availability.
- Checkout quote, suspend, resume, commit, and sync batch.
- Payment intent and query-only unknown outcome.
- Receipt snapshot, refund, inventory, cash shift, count, approval, and reconciliation.
- Offline eligibility and policy snapshot.
- Audit metadata and redacted correlation.
- KDS committed-order events, LAN envelopes, ACKs, and provisional mapping.
- Pagination, payload, upload, export, and tool resource limits.

## Entry acceptance

1. One editable schema emits deterministic neutral JSON.
2. The server and Dart client derive from the same schema.
3. CI detects generation drift and incompatible v1 changes.
4. Each route declares auth, permission, idempotency, offline, PIN, approval, and stable errors.
5. Every source and destination validates the same bounded schema.
