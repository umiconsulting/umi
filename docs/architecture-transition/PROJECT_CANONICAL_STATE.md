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
- UmiPOS consumes contract version `2.9.0`. The generated checksum is the content-hash authority.
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
- Gate 3F: complete. Historical policy snapshots bind one integer-safe earn engine to checkout and refunds.
- Gate 3F uses one canonical allocation and fingerprint for wallet, gift-card, cash, and terminal tenders.
- Gate 3F supports exact reward approval, wallet and gift-card payment, and funded gift-card activation.
- Gate 3F history uses explicit global visibility and a permission-bound signed cursor version `2`.
- Gate 3F passed all 26 races through two independent PostgreSQL sessions.
- Gate 3F contract: version `2.6.0`, content hash
  `cfe933a00f07b8972d28fad536001d1260cc259c2d3bed56efec5a2c9a0278c9`.
- Gate 3F keeps rewards and stored value online-only. Cash replay can keep a bounded customer reference.
- `stash@{0}: pre-gate-3d1-unpublished-pos-runtime-fixes` remains preserved and excluded.
- Gate 3F passed focused privacy, security, contract, API, Flutter, PostgreSQL, RLS, Linux, and Web checks.
- Gate 3G-A: complete. One registry, coordinator, adapter, and transport path owns hardware access.
- Gate 3G-A persists scoped commands, print jobs, assignments, diagnostics, and append-only event history.
- Gate 3G-A provides deterministic printer, drawer, scanner, and customer display simulators.
- Gate 3G-A keeps payment terminal and scale support as disabled foundations.
- Gate 3G-A contract: version `2.7.0`, content hash
  `7223f72894a444d32735ba8e1a325a160bc09a394bca222d12a8bb2545da6323`.
- Gate 3G-A passed focused contract, API, Flutter, simulator, recovery, PostgreSQL, and RLS checks.
- Gate 3G-B: complete with observations. Generic TCP printing, printer-attached drawers, and keyboard-wedge scanning are code-controlled ready.
- Gate 3G-B uses deterministic thermal rendering, bounded reconnect, exact replay identity, and server-owned pilot configuration.
- Gate 3G-B keeps the customer display simulator ready. Physical secondary-display support remains device-dependent.
- Gate 3G-B contract: version `2.8.0`, content hash
  `acacbd59b0691a0a351691e2b161cf0ac7ee433280ad363cf2a86238bdb85abe`.
- Gate 3G-B passed focused contract, API, Flutter, simulator, PostgreSQL, RLS, Linux, Web, and PR checks.
- Physical validation was unavailable in the current runner. This result is not hardware certification.
- Gate 4A: complete with observations. The UMI API owns one kitchen projection for each committed sale.
- Gate 4A uses deterministic station routes, historical route snapshots, ordered events, stable commands, and exact device scope.
- Gate 4A adapts the existing SwiftUI KDS. It does not create a replacement Flutter KDS.
- Gate 4A reconnects through an authoritative station snapshot and ignores duplicate or stale events.
- Gate 4A keeps disconnected mutations fail closed and exposes a safe read-only kitchen status to UmiPOS.
- Gate 4A passed all 10 focused races through two independent PostgreSQL sessions.
- Gate 4A contract: version `2.9.0`, content hash
  `ac23d09d92f252f8e770e84fef90ab4c42c30afb85d8e08a0c0a15df2376ff6f`.
- Gate 4A passed focused contract, API, Flutter, PostgreSQL, RLS, security, and PR checks.
- The Linux runner had no Xcode toolchain. Static KDS reviews passed, but the iPad build remains an observation.
- Gate 5A: complete. The Dashboard has permission-scoped read and command execution for pilot operations.
- Gate 5A uses contract version `2.12.0`, with content hash
  `5aafd2d554267c27c523686d95b44474d9783971223b63e95f25696d13fb67ba`.
- Gate 5A limits each location membership to its assigned location.
- Gate 5A uses effective permissions for navigation and direct API access.
- Gate 5A uses a distinct `dashboard_administrative` context for operational commands.
- Dashboard sessions are server-side, revocable, and separate from device sessions.
- Cookie mutations use a double-submit CSRF check.
- The operation policy is an explicit allowlist. POS checkout and KDS preparation remain excluded.
- Refund, inventory, loyalty, gift-card, catalog, register, kitchen, and recovery commands use existing domain authority.
- Physical commands use a persistent relay to the assigned enrolled POS runtime.
- Cash movement remains POS-only. Wallet funding remains unavailable by product policy.
- Gate 5A does not create a false POS device or operator session.
- The continuous P0 walkthrough passed through the real Dashboard, API, domain services, and PostgreSQL.
- The 24-case authority matrix passed through real sessions, CSRF, authorization, services, and persistence.
- Exact refund, inventory adjustment, inventory waste, loyalty, and hardware retries returned the original result without a new fact.
- The disposable database reported 137 tables with forced RLS and no duplicate domain fact.
- The hardware relay used the canonical simulator. No other P0 domain used a test double.
- Gate 6A: complete with observations. The pilot has a production-shaped deployment runtime.
- The runtime supports `development`, `test`, `staging`, `pilot`, and `production` environments.
- Pilot startup validates the configuration and fails when a required secret or safe setting is absent.
- Each artifact has an immutable release identity and a generated release manifest with checksums.
- Docker Compose deploys PostgreSQL 16, Redis 7.4, the API, the worker, the Dashboard, Caddy, and OpenTelemetry.
- A clean deployment reached readiness and passed the real pilot smoke suite.
- A real PostgreSQL backup and isolated restore passed with measured recovery times.
- The compatible application rollback and the A-to-B upgrade simulation passed.
- Production DNS, TLS certificates, provider backups, signing tools, and physical devices remain external observations.
- Gate 6B: complete with observations. The pilot has a certified operations and training kit.
- The business profile is machine-readable and contains no secret values.
- `pnpm pilot:readiness` reports `READY`, `READY WITH WARNINGS`, or `NOT READY`.
- The clean fixture includes the café, roles, POS, printer, scanner, KDS, catalog, inventory, customer value, and policies.
- The operator runbooks cover onboarding, daily opening, selling, kitchen work, closing, recovery, support, backup, and release.
- The Owner decision register contains all unresolved commercial and physical choices.
- The protected platform bootstrap creates the first merchant, location, and Owner atomically.
- The first Owner then uses a normal Dashboard session and merchant authority.
- A clean disposable deployment passed bootstrap, Dashboard operations, KDS, role, smoke, RLS, and readiness evidence.
- The KDS walkthrough passed prepare, item ready, order ready, recall, completion, cancellation, and reconnect reconciliation.
- Owner, Manager, Cashier, KDS, Viewer, and location-scope checks used real sessions and persisted authority.
- `pnpm pilot:readiness` returned `READY WITH WARNINGS` only for deferred object storage policy.
- Physical hardware, iPad, public infrastructure, provider integrations, and final UX remain external observations.
- Gate 7A: complete with observations. The integrated operating journey passed.
- Wallet, gift-card, mixed-tender, native offline replay, full refund, and shift close passed with real persistence.
- Financial, inventory, loyalty, wallet, and gift-card projections matched their immutable facts.
- The authenticated Dashboard loaded all end-of-day operational views.
- Recovery reported zero unresolved commands. Audit continuity reported no secret leak.
- Physical hardware, iPad, public infrastructure, provider integration, and final UX remain external observations.
- Gate 7B: complete with observations. Resilience, security, and financial pressure passed.
- API, worker, PostgreSQL, Redis, network, KDS, and client restart scenarios failed safely.
- A bounded sequence added 100 sales through real API and PostgreSQL authority.
- Financial, inventory, wallet, gift-card, and loyalty facts reconciled with zero drift.
- The customer-value matrix passed 26 real PostgreSQL races and 52 terminal results.
- RLS and FORCE RLS covered 133 scoped tables. The API login cannot bypass RLS.
- Backup and isolated restore matched 103 sales, 105 tenders, 230 inventory facts, and 317 audit events.
- Recovery reported zero unresolved commands. Audit data reported zero secret matches.
- Gate 8A: complete with observations. The pilot POS operator experience passed.
- Design Language V1 freezes the pilot rules for type, space, controls, money, states, accessibility, responsive layouts, and motion.
- Enrollment, PIN, sales, payments, customer value, refunds, shifts, inventory, KDS, hardware, offline, and recovery passed focused UX review.
- The theme now defines shared touch targets, focus, typography, surfaces, sheets, dialogs, and status feedback.
- Normal operator errors use business language instead of internal command codes.
- Physical touch hardware, physical peripherals, Xcode/iPad, Owner aesthetics, and provider payment remain observations.
- Gate 8B: complete with observations. Dashboard and KDS pilot UX passed.
- Dashboard navigation, compact layouts, terminology, and development controls passed focused review.
- KDS cards, state labels, modifiers, actions, degraded state, and accessibility passed code review.
- Browser checks passed at 1440, 1024, and 390 CSS pixels without global overflow.
- Physical iPad, physical peripherals, Owner aesthetics, and provider payment remain observations.
- Gate 9A: complete with observations. The first pilot rehearsal passed.
- Clean bootstrap, roles, catalog, inventory, sale, refund, hardware, KDS, recovery, and readiness passed.
- API restart preserved one sale and one refund. Inventory drift and unresolved recovery were zero.
- Physical iPad, peripherals, object storage, provider payment, and Owner preferences remain observations.
- Gate 9B: complete with observations. `UMI POS Pilot RC1` is frozen at source commit `9ea8560b6c0e7304834eae0cd960804132acac89`.
- Release images, the Linux POS archive, clean migrations, bootstrap, readiness, backup, and reconciliation passed.
- NEXO legacy runtime dependency is none. The legacy closing runner P2 is closed.
- Physical iPad, peripherals, enabled object storage, provider payment, and Owner preferences remain observations.
- Gate 9C is authorized with observations. It has not started.

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

## Gate 3G-A decision basis

- Documented fact: the UMI API owns the hardware registry and persistent command history.
- Umi-specific inference: an unknown physical result cannot authorize an automatic second side effect.
- Umi-specific inference: a hardware failure cannot change a committed financial fact.
- Umi-specific inference: future vendor adapters must implement the canonical adapter interfaces.

## Gate 3G-B decision basis

- Documented fact: the existing Hardware Runtime is the only hardware access path.
- Umi-specific inference: generic protocol adapters enable a pilot without vendor business logic.
- Umi-specific inference: only a known pre-write failure permits automatic reconnect.
- Umi-specific inference: physical certification requires actual supported hardware.

## Gate 4A decision basis

- Documented fact: the UMI API owns the commercial order and the kitchen write model.
- Source-backed tradeoff: an ordered event feed needs an authoritative snapshot for gap recovery.
- Umi-specific inference: a KDS disconnect must preserve visibility and block state changes.
- Umi-specific inference: a prepared item cannot be reversed by a financial void or refund.
