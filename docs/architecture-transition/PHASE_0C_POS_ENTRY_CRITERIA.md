# Phase 0C — POS Entry Criteria

## A. Before application scaffolding

- EC-A01: One ordered Supabase migration ledger creates the canonical schemas from an empty project.
- EC-A02: The deployed app role is NOBYPASSRLS. The deployed worker role is scoped and audited.
- EC-A03: A pooled connection test proves no tenant context leaks.
- EC-A04: Direct client authority has an approved removal plan and no POS exception.
- EC-A05: `packages/contract` emits a deterministic, versioned, language-neutral artifact.
- EC-A06: Contract regeneration and compatibility checks fail on drift.
- EC-A07: The root authority map assigns all POS business truth to UMI.
- EC-A08: Gate 1F records green lightweight and security evidence on one commit.

## B. Before the first authenticated screen

- EC-B01: Local identity reads only canonical `umi.user` and current role data.
- EC-B02: Durable refresh families support rotation, reuse detection, logout, and revocation.
- EC-B03: Business and branch selection comes from current membership.
- EC-B04: POS entitlement is a named, effective, audited capability.
- EC-B05: Public-key device enrollment has a versioned contract.
- EC-B06: A device binds permanently to one business and branch.
- EC-B07: Operator PIN verification stays server-side and has distributed abuse limits.
- EC-B08: The client receives environment-signed API configuration. It receives no Supabase key.

## C. Before catalog browsing

- EC-C01: The catalog contract includes variant, modifiers, barcode, media, tax, price, and branch
  availability.
- EC-C02: Snapshot and delta responses have version, expiry, pagination, and payload limits.
- EC-C03: Effective prices and inclusive tax come from the server.
- EC-C04: Cross-business and cross-branch catalog reads fail at API and RLS layers.
- EC-C05: Media access validates type, size, ownership, and bounded delivery.

## D. Before the first checkout slice

- EC-D01: Checkout has explicit state and optimistic version.
- EC-D02: Every mutation has a persisted command ID, idempotency key, and request fingerprint.
- EC-D03: Same fingerprint replays. A different fingerprint conflicts.
- EC-D04: The server derives money, tax, change, business date, and policy.
- EC-D05: Device, operator, branch, permission, and entitlement bind every command.
- EC-D06: Cash and manual-terminal payment intents preserve ambiguity.
- EC-D07: One cash commit writes order, payment, cash, inventory, receipt, KDS, audit, and result
  atomically.
- EC-D08: Receipt content is immutable and has an integrity hash.
- EC-D09: Inventory uses append-only movements and an explicit advisory policy.
- EC-D10: Physical cash has one owned open shift and append-only entries.
- EC-D11: Failure injection proves no partial financial success.

## E. Before offline support

- EC-E01: The online command contract and query endpoint are stable.
- EC-E02: A signed shift snapshot pins contract, policy, catalog, device, branch, and limits.
- EC-E03: SQLCipher uses a non-exportable platform key.
- EC-E04: The client persists a command before network or tender interaction.
- EC-E05: Replay preserves device sequence and maps provisional IDs.
- EC-E06: Conflicts are explicit. Sync never drops or reprices a command.
- EC-E07: Enrollment, close, redemption, refund, approval, and privileged cash remain online-only.
- EC-E08: Shift close blocks all unsynchronized commands.

## F. Before a pilot

- EC-F01: Refund, cash count, reconciliation, handoff, and manager approval pass.
- EC-F02: KDS receives committed orders once and prints one fallback after a missing ACK.
- EC-F03: Redacted command correlation works across client, API, database, worker, and KDS.
- EC-F04: Distributed rate limits protect auth, PIN, enrollment, receipt, payment, refund, and sync.
- EC-F05: CDN, WAF, provider DDoS controls, bounded payloads, and queue limits are active.
- EC-F06: A staging promotion and production-clone rehearsal pass.
- EC-F07: An off-provider backup and measured restore drill pass.
- EC-F08: Certified hardware tests cover printer, scanner, drawer, and manual terminal.
- EC-F09: A compatible UMI rollback procedure is rehearsed. It never restores NEXO authority.
- EC-F10: Support, incident, reconciliation, and offline recovery runbooks are approved.
