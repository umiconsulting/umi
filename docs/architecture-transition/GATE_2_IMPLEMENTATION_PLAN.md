# Gate 2 Implementation Plan

Build-v3 certification authorizes the following bounded sequence. Each gate targets 60–120 minutes
and must end with one coherent local commit.

## Gate 2A — UmiPOS application foundation

Create the Flutter shell under `apps/umi-pos`; consume the generated Dart contract; establish secure
configuration, localization, accessibility, navigation, and focused CI. Do not add business
behavior.

## Gate 2B — Device trust and authenticated context

Add UMI API device enrollment, rotation/revocation, encrypted credential storage, operator session,
tenant selection, and branch binding. Prove cross-tenant and cross-branch denial.

## Gate 2C — Read-only catalog vertical

Complete only the canonical catalog contracts and server read model needed for branch-scoped
browsing. Add generated client integration and accessible Flutter catalog presentation. No cart or
checkout.

## Gate 2D — Authoritative sale command vertical

Implement one online sale flow on the Gate 1D command boundary. Require server-authoritative money,
idempotency, optimistic versions, atomic writes, audit, immutable receipt snapshot, and an explicit
payment ambiguity state. Do not add broad POS features.

## Gate 2E — Offline journal and recovery

Add encrypted local command journaling, monotonic ordering, bounded synchronization, replay
resistance, provisional-to-official identifiers, reconciliation, and operator-visible recovery.
Device revocation and unresolved payment outcomes must fail closed.

Machine-readable scope and validation are in
[`gate-2-roadmap.json`](./gate-2-roadmap.json).
