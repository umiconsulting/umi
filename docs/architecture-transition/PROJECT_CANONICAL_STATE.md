# UMI × UmiPOS — Canonical Project State

Updated: 2026-07-29

## Product authority

UmiPOS is an application of UMI. UMI owns all business and data authority.
Future clients use `packages/contract` and controlled UMI APIs.

## Completed platform gates

- Gate 1A established one Supabase migration authority, API authority, RLS, and tenant and branch isolation.
- Gate 1B established `packages/contract` as the only editable public contract authority.
- Gate 1C established durable identity, staff, session, permission, entitlement, and elevation foundations.
- Gate 1D established canonical idempotent business commands, optimistic aggregate versions,
  append-only audit and financial events, compensation references, correlation propagation,
  and tenant-visible redacted audit search.
- Gate 1E established bounded structured telemetry, safe operational diagnostics, layered abuse
  limits, dependency readiness, queue protection, deadlines, circuit breakers, and backpressure.
- Gate 1F certified the build-v3 entry platform and authorized `apps/umi-pos` creation with
  documented, non-blocking operational observations.
- Gate 2A created the Flutter application foundation at `apps/umi-pos`, consuming the generated
  Dart contract SDK and stopping at a guarded ready-for-authentication boundary.
- Gate 2B established canonical POS device trust, credential-bound durable authentication,
  server-intersected tenant/branch context, operator sessions, scoped elevation, and the honest
  ready shell.
- Gate 2C established a server-authoritative, branch-aware, read-only catalog with bounded cursor
  pagination, search, operator-safe product details, media, variants, modifiers, and Flutter cache
  partitions.
- Gate 2D established a server-authoritative, tenant/branch/operator-partitioned cart with
  validated variants, modifiers, notes, optimistic versioning, and tax/total previews. It does
  not commit an order, mutate inventory, take payment, or issue a receipt.
- Gate 2E established the first authoritative online sale: immediate repricing, explicit totals
  reconfirmation, idempotent cash completion, query-only external-terminal ambiguity, reservation
  semantics without permanent inventory mutation, immutable receipt snapshots, and append-only
  financial/audit facts.
- Gate 2F completed native AES-256-GCM journaling, one serialized mutation authority,
  restart-safe provisional checkout deduplication, default-deny server-issued offline cash
  policy, generated-SDK replay, response-loss recovery, immutable official mapping, typed
  recovery actions, reconciliation, and Recovery Center. Sensitive Web journaling remains
  disabled.
- Gate 3A established one server-authoritative sale lifecycle. It supports start, suspend,
  resume, cancel, customer attachment, sale navigation, receipt navigation, and automatic
  next-sale creation.

## Current implementation state

- `supabase/migrations/` is the only editable migration source.
- `apps/umi-api` is the only authoritative business write boundary.
- `packages/contract` generates neutral JSON, TypeScript, and Dart artifacts.
- `umi.user` owns login identity.
- `tenant.staff` owns the employment fact.
- `umi.user_role` and `umi.user_permission_override` own access grants.
- `runtime.session` owns durable application sessions.
- The API request role remains RLS-confined.
- Internal session, elevation, and security audit tables are not readable by clients.
- `tenant.business_command` owns command idempotency, fingerprint conflict detection, safe
  retry classification, and stored results.
- `tenant.aggregate_version` owns generic optimistic concurrency claims.
- `tenant.audit_event` is the append-only, hash-linked business audit authority.
- `runtime.audit_event_internal` separates internal metadata from client-visible audit data.
- `tenant.financial_event` provides the neutral append-only financial-event foundation.
- Financial corrections are new compensating events; existing financial events are never
  updated or deleted.
- Request and correlation identifiers are validated at the HTTP boundary and propagated
  through logs, commands, audit events, and public error envelopes.
- Logs, traces, and dead letters redact sensitive content and retain safe error categories.
- `/health/live` reports process liveness; `/health/ready` reports PostgreSQL and Redis readiness.
- `/health/diagnostics` requires an operations token and returns bounded aggregate telemetry.
- HTTP requests have bounded bodies, connection/request deadlines, and per-IP limits before route
  authorization.
- Authenticated traffic has independent user, device, tenant, and branch budgets.
- Queue admission rejects work at the bounded depth instead of allowing unbounded growth.
- Platform resilience utilities provide explicit deadlines, circuit state, and bounded concurrency.
- UmiPOS uses Flutter 3.44.6 / Dart 3.12.2, built-in `ChangeNotifier` composition, centralized
  route guards, typed fail-closed configuration, bounded HTTP behavior, platform secure storage,
  redacted telemetry, localized Spanish/English bootstrap UI, and explicit unsupported hardware
  adapters.
- `tenant.device` is the device authority. Approval-based requests live in
  `runtime.device_enrollment_request`, and polling state lives in
  `runtime.device_pairing_session`.
- UmiPOS device pairing uses one eight-character code, one polling credential, administrator
  approval, secure credential storage, and transition audit.
- UmiPOS uses a personal tenant-unique PIN after device trust. The API resolves the staff identity
  and current role without an email or client role selector.
- `runtime.operator_session` separates operator presence from PIN authentication.
- UmiPOS consumes contract version `1.9.0`, content hash
  `13db86bce50686813f3f8a58e522653a8cabe26c5e598e085da8562f2ca6edb9`.
- Native UmiPOS journal schema version 1 uses AES-256-GCM with platform-secure key storage and
  separate ciphertext persistence. Replay is ordered per device credential version; Web sensitive
  journaling is unsupported.
- `tenant.pos_cart` is mutable sale preparation only. The API owns pricing, availability,
  inclusive-tax rounding, modifier validation, line merging, and totals previews.
- `tenant.pos_cart.lifecycle_state` is the Gate 3A sale state authority. One tenant, branch,
  and operator identity can own only one editable sale. Terminal sales are immutable.
- `tenant.pos_committed_sale` and `tenant.receipt_snapshot` are immutable checkout facts.
  `tenant.inventory_reservation` is a time-bounded preparation record and never decrements stock.
- Cash checkout commits atomically through `tenant.business_command`; an external-terminal
  unknown outcome is query-only and does not create an order, receipt, or financial event.
- POS refresh sessions require the active server device plus its installation and credential
  hashes. Revocation/replacement ends durable and operator sessions.

## Prohibitions

- Do not create an independent UmiPOS backend or database.
- Do not give service-role credentials to a client.
- Do not write authoritative tables from Dashboard, KDS, Flutter, or Assistant clients.
- Do not add a second contract or migration authority.
- Do not update or delete audit or financial events.
- Do not reuse an idempotency key with a different canonical command fingerprint.
- Do not expose `runtime.audit_event_internal` through a public API or generated contract.
- Do not log raw credentials, authorization data, payment-sensitive values, customer message
  content, or raw phone numbers.
- Do not claim DDoS immunity; production requires provider mitigation, CDN/WAF controls, and a
  distributed limiter before horizontal scaling.

## Current local baseline

- Branch: `architectureUMIposIntegration`
- Build-v3 certification source commit: `a1e794d8fe0e9883f5677147ab81c4342f1a3980`
- Certification date: `2026-07-27`
- `BUILD_V3_CERTIFIED`: `true`
- UmiPOS application creation: `YES WITH OBSERVATIONS`
- Remote publication: Gate 3A publication follows the local commit through the PR gate.
- Gate 2F: complete with the external native-toolchain observation. The full disposable PostgreSQL
  migration chain and negative authorization matrix passed. Linux debug compilation cannot start
  because the runner lacks CMake, Ninja, Clang, and GTK development headers; no code defect is
  demonstrated.
- Gate 3A: complete. Sale lifecycle state version 1 supports deterministic recovery and
  automatic next-sale creation.
- Gate 3A produced a successful Linux debug build. This resolves the earlier runner toolchain
  observation for the current workspace.
- Next gate: 3B, Advanced Checkout and Payment Experience.

## Gate 3A decision basis

- Documented fact: the UMI API already owns `tenant.pos_cart`, checkout, customers, and operator
  sessions in this transition branch.
- Source-backed tradeoff: the existing transaction, RLS, and generated-contract boundaries keep
  sale authority in one service and one migration chain.
- Umi-specific inference: tenant, branch, and operator identity form the active-sale uniqueness
  key. An operator session can change after a restart.
