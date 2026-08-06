# UMI × UmiPOS — Canonical Project State

Updated: 2026-08-05

## Product authority

UmiPOS is an application of UMI. UMI owns all business and data authority.
Future clients use `packages/contract` and controlled UMI APIs.

## Completed platform gates

- Gate 1A established one Supabase migration authority, API authority, RLS, and merchant and location isolation.
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
  server-intersected merchant/location context, operator sessions, scoped elevation, and the honest
  ready shell.
- Gate 2C established a server-authoritative, branch-aware, read-only catalog with bounded cursor
  pagination, search, operator-safe product details, media, variants, modifiers, and Flutter cache
  partitions.
- Gate 2D established a server-authoritative, merchant/location/operator-partitioned cart with
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
- Gate 3B established one checkout lifecycle. It supports cash, manual terminal, mixed tender,
  policy-controlled tips and discounts, one-use manager approval, recovery, and receipt intent.
- Gate 3C established the physical register and cash shift lifecycle. It supports opening float,
  append-only cash facts, movements, handoff, blind count, variance, reconciliation, and close.
- Gate 3D established the post-sale exception lifecycle. It supports narrow voids, full and
  partial refunds, immutable compensation, exception receipts, approval, and recovery.
- Gate 3D.1 established the pilot RBAC profiles. The canonical matrix gives each café role
  explicit merchant or location grants. Sensitive approvals require a different actor.
- Gate 3E established the inventory authority. UMI API commits stock effects to an immutable,
  location-scoped PostgreSQL ledger.

## Current implementation state

- `docs/migration/build-v3/` is the pre-cutover DDL authority.
- `supabase/migrations/` opens only for approved post-cutover changes.
- `apps/umi-api` is the only authoritative business write boundary.
- `packages/contract` generates neutral JSON, TypeScript, and Dart artifacts.
- `umi.user` owns login identity.
- `merchant.staff` owns the employment fact.
- `umi.user_role` and `umi.user_permission_override` own access grants.
- `runtime.session` owns durable application sessions.
- The API request role remains RLS-confined.
- Internal session, elevation, and security audit tables are not readable by clients.
- `merchant.business_command` owns command idempotency, fingerprint conflict detection, safe
  retry classification, and stored results.
- `merchant.aggregate_version` owns generic optimistic concurrency claims.
- `merchant.audit_event` is the append-only, hash-linked business audit authority.
- `runtime.audit_event_internal` separates internal metadata from client-visible audit data.
- `merchant.financial_event` provides the neutral append-only financial-event foundation.
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
- `merchant.device` is the device authority. Approval-based requests live in
  `runtime.device_enrollment_request`, and polling state lives in
  `runtime.device_pairing_session`.
- UmiPOS device pairing uses one eight-character code, one polling credential, administrator
  approval, secure credential storage, and transition audit.
- UmiPOS uses a personal merchant-unique PIN after device trust. The API resolves the staff identity
  and current role without an email or client role selector.
- `runtime.operator_session` separates operator presence from PIN authentication.
- UmiPOS consumes contract version `2.3.0`. The generated checksum is the content-hash authority.
- Original sale, payment, receipt, and cash facts remain immutable after an exception.
- `merchant.pos_sale_exception` and related tables own append-only compensation history.
- Refund amounts use original receipt, discount, tax, tip, and tender snapshots.
- Cash refunds post atomically to the current eligible shift. They never rewrite the source shift.
- Manual terminal refunds record an operator assertion. They do not claim provider proof.
- An unknown terminal refund stays query-only and blocks a replacement refund.
- Restock data is an immutable intent. Gate 3E consumes it through one inventory outcome.
- Post-sale exception commands require online server authority.
- Native UmiPOS journal schema version 1 uses AES-256-GCM with platform-secure key storage and
  separate ciphertext persistence. Replay is ordered per device credential version; Web sensitive
  journaling is unsupported.
- `merchant.pos_cart` is mutable sale preparation only. The API owns pricing, availability,
  inclusive-tax rounding, modifier validation, line merging, and totals previews.
- `merchant.pos_cart.lifecycle_state` is the Gate 3A sale state authority. One merchant, location,
  and operator identity can own only one editable sale. Terminal sales are immutable.
- `merchant.pos_committed_sale` and `merchant.receipt_snapshot` are immutable checkout facts.
  `merchant.inventory_reservation` is a time-bounded preparation record and never decrements stock.
- `merchant.stock_ledger_entry` owns immutable stock effects. `merchant.stock_balance` is a
  rebuildable projection and is not a second mutation authority.
- Inventory quantities use an integer value, an explicit scale, and an explicit unit.
- Catalog mappings and recipes are explicit and versioned. Historical consumption keeps the
  mapping and recipe version used during commit.
- A required reservation and its sale stock effect commit with the sale, tender, cash, receipt,
  and order facts.
- A committed refund consumes its immutable restock intent. Recipe components require an explicit
  disposition and do not return prepared ingredients by default.
- Adjustments, waste, damage, quarantine, and count reconciliation append compensating stock facts.
- Inventory mutations are online-only. An approved offline cash sale reuses the Gate 2F replay.
- Checkout commits atomically through `merchant.business_command`. Cash and manual-terminal
  tender facts use integer minor units. Mixed payment requires full server-confirmed coverage.
- A manual-terminal result is an operator assertion. An unknown result remains query-only.
  It does not create an order, a receipt, or a financial event.
- Tips and discounts use a branch policy. Each sensitive permission requires a separate,
  short, one-use manager approval bound to the full tender fingerprint.
- Recovery returns the immutable committed result and receipt after response loss or restart.
- `merchant.physical_register` owns the physical cash location. One unresolved shift can use one
  register.
- `merchant.cash_shift` owns the register, device, operator, currency, and business date context.
- The server derives the shift business date. The client cannot select this financial context.
- `merchant.cash_ledger_entry` owns each immutable physical cash effect. Expected cash is a
  reproducible projection.
- Cash checkout posts the net cash effect in the same database transaction as the sale.
- Blind counts remain separate from expected cash. Reconciliation uses one fixed ledger sequence.
- Shift close is atomic and immutable. Closed shifts reject later cash facts.
- Cash command recovery stores only command identifiers in secure storage. The API queries the
  original command before a retry.
- A close threshold requires a short, one-use manager approval bound to the selected count.
- Advanced cash operations require online server authority. Offline cash sales keep the Gate 2F
  policy and provisional receipt boundary.
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
- This PR #72 integration commit synchronizes the UmiPOS branch with current `build-v3`.
- GitHub is the authority for the current push, check, review, and mergeability state.
- Gate 2F: complete with the external native-toolchain observation. The full disposable PostgreSQL
  migration chain and negative authorization matrix passed. Linux debug compilation cannot start
  because the runner lacks CMake, Ninja, Clang, and GTK development headers; no code defect is
  demonstrated.
- Gate 3A: complete. Sale lifecycle state version 1 supports deterministic recovery and
  automatic next-sale creation.
- Gate 3A produced a successful Linux debug build. This resolves the earlier runner toolchain
  observation for the current workspace.
- Gate 3B: complete. Checkout state version 1 supports cash, manual terminal, mixed tender,
  tips, discounts, recovery, and receipt intent.
- Gate 3B produced successful Linux debug and Web compatibility builds.
- Gate 3C: complete. Cash shift state version 1 supports register assignment, immutable cash
  facts, handoff, blind count, variance approval, reconciliation, close, and restart recovery.
- Gate 3C produced a successful Linux debug build and disposable PostgreSQL negative matrix.
- Gate 3D: complete. Exception state version 1 supports refund eligibility, narrow voids, full and
  partial refunds, tender compensation, approval, exception receipts, and restart recovery.
- Gate 3D produced successful Linux debug and Web builds. Its disposable PostgreSQL matrix passed.
- Gate 3D.1: complete. Owner, Admin, Manager, Supervisor, Cashier, Staff, and Viewer use the
  deterministic matrix in `config/umipos-pilot-role-grants.json`.
- Gate 3D.1 keeps `super_admin` outside the café journey. Entitlement, device, session, merchant,
  location, permission, policy, and approval checks remain server-authoritative.
- Gate 3E: complete. The ledger, projection, reservations, atomic sale synchronization, refund
  outcomes, inventory operations, blind counts, and reconciliation use server authority.
- Gate 3F: incomplete. Merchant customers, immutable ledgers, stored-value authorization,
  atomic checkout foundations, refund compensation, and scoped RLS exist.
- Gate 3F still needs policy-complete reward eligibility, earn-preview binding, authorization
  expiry, rate limits, consent updates, enrollment, adjustments, issuance, and full concurrency tests.
- Gate 3F contract: version `2.4.0`, content hash
  `02b1dd57987050865fa5b81f7a588cc74bb3f9def08be44a3bd225066ce83fe0`.
- Gate 3F keeps rewards and stored value online-only. Cash replay can keep a bounded customer reference.
- `stash@{0}: pre-gate-3d1-unpublished-pos-runtime-fixes` remains preserved and excluded.
- Gate 3G is not authorized while Gate 3F remains incomplete.

## Gate 3C decision basis

- Documented fact: the UMI API owns checkout, cash facts, command idempotency, and audit.
- Source-backed tradeoff: immutable ledger facts produce expected cash without a mutable authority.
- Umi-specific inference: a software count records an operator observation, not physical custody.

## Gate 3D decision basis

- Documented fact: the UMI API owns sale, payment, receipt, cash, and command authority.
- Source-backed tradeoff: append-only compensation preserves the original financial evidence.
- Umi-specific inference: manual terminal outcomes remain operator assertions until provider integration exists.
- Umi-specific inference: restock intent does not prove that stock returned to inventory.

## Gate 3E decision basis

- Documented fact: UMI API and the build-v3 PostgreSQL chain own merchant mutations.
- Source-backed tradeoff: an append-only ledger makes each balance reproducible and auditable.
- Umi-specific inference: a physical count records an observation and does not prove custody.
- Umi-specific inference: a prepared-product refund does not prove that each ingredient returned.

## Gate 3F decision basis

- Documented fact: the UMI API owns customer-value commands and the build-v3 migration chain.
- Umi-specific inference: append-only points and money facts make each balance reproducible.
- Umi-specific inference: receipt delivery and loyalty enrollment do not grant marketing consent.
- Umi-specific inference: possession of a gift-card code remains a bearer risk.
