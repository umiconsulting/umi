# UmiPOS Fusion and Product Development Plan

**Status:** Decision-complete implementation plan
**Date:** 2026-07-23
**Owners:** Umi platform, POS client, KDS, dashboard, operations
**Pilot:** Kalala, one café branch
**Canonical architecture:** One Umi backend and one Supabase PostgreSQL database

## 1. Executive decision

UmiPOS is an Umi application, not a peer platform.

The final workspace shape is:

```text
Umi/
├── apps/umi-api          # Sole backend and financial writer
├── apps/umi-dashboard    # Back-office and management
├── apps/umi-kds          # Swift through the POS pilot; Flutter replacement later
├── apps/umi-pos          # Flutter Android POS
├── packages/contract     # Sole API contract source
└── supabase              # Sole ordered database migration authority
```

The non-negotiable ownership rules are:

- Umi owns identity, businesses, branches, staff, permissions, entitlements, catalog, orders,
  payments, loyalty, inventory, cash shifts, receipts, refunds, reporting, and kitchen truth.
- The POS Flutter client owns UI, device hardware, printing, encrypted local state, and offline
  command journaling.
- The KDS remains a backend-authoritative thin client. Swift remains in production through the
  Kalala POS pilot. After the pilot and integrated-card increment, Flutter replaces Swift on the
  current iPads first.
- No client receives Supabase credentials or writes tables or financial RPCs directly.
- No NEXO database, API, worker, dashboard, identity system, outbox, or reconciliation bridge
  survives.
- `UMI_NEXO_PLATFORM_CONSOLIDATION_STRATEGY.md` is superseded. Its proposed dual-platform topology
  must not be implemented.
- `build-v3` must be finished, rehearsed, and cut over before POS database or backend work merges.
- Supabase remains the canonical database host through the Kalala pilot.

There is no umiPOS production data to migrate. Fusion is selective code, invariant, and test
extraction—not a schema or row import.

## 2. Critical implementation audit

### 2.1 umiPOS is not production-ready

The repository is a large NEXO SaaS snapshot rather than a POS-only application. It contains a Nest
API, Next.js admin, worker, Prisma database, identity and tenancy model, infrastructure stack, and a
Flutter client. Documentation volume, endpoint count, and migration count overstate operational
maturity.

Release-blocking defects include:

1. **Normal sequential selling is broken.** A completed cart/controller is never replaced, so a
   cashier cannot reliably begin a second independent sale during the same shift.
2. **Cash-open idempotency is permanently reused.** The key is derived from a stable device/branch
   seed, so later shifts replay or conflict with an earlier shift.
3. **Device enrollment is not a financial security boundary.** Sale and cash endpoints authenticate
   the user but do not enforce the enrolled device credential.
4. **Branch binding is discarded.** Flutter reads device status but allows selection outside the
   enrolled branch.
5. **Cash-session lookup is unsafe.** Restart may attach a cashier to another operator’s branch-wide
   session, including suspended, counting, or reconciliation states.
6. **Sale and physical cash can diverge.** Cash ledger posting is asynchronous and inferred later by
   a worker. Closing a shift before the worker runs can strand the posting.
7. **Enrollment is not recoverable.** Losing the successful enrollment response consumes the token
   without a safe way to retrieve or reproduce the device credential.
8. **The Flutter API is not generated.** It is a large handwritten `Map<String, dynamic>` client
   coupled to guessed NEXO paths and response shapes.
9. **Offline operation is mostly scaffolding.** Connectivity, catalog caching, cart recovery,
   replay, exposure limits, and conflict handling are not wired into the production flow.
10. **Local financial recovery data is plaintext.** SQLite is not encrypted.
11. **Hardware support is simulated.** Production uses a test printer adapter and has no certified
    scanner, drawer, printer, or acquiring-terminal integration.
12. **Database authority is internally split.** Physical-cash tables exist outside the apparent
    Prisma source of truth.
13. **Device integration is incomplete.** POS-device outbox rows have no productive consumer and RLS
    coverage omits device relations.
14. **Operational proof is absent.** There is no verified production deployment, backup/restore
    rehearsal, settlement reconciliation, hardware release pipeline, or fiscal integration.

### 2.2 What to preserve from umiPOS

Preserve only reviewed assets that improve the Umi-owned implementation:

- Flutter visual and accessibility components that pass Umi design and licensing review.
- Exact-money, rounding, idempotency, payment-ambiguity, receipt-snapshot, concurrency, and
  failure-injection test vectors.
- The rule that an unknown payment outcome becomes query-only; it must never trigger another charge.
- Catalog variant, barcode, price-history, media, modifier, and inventory concepts.
- Physical register, shift, append-only cash ledger, count, reconciliation, variance, approval, and
  handoff requirements.
- Device enrollment, rotation, revocation, and audit requirements, but not the existing secret
  delivery protocol.
- Relevant Flutter goldens after Umi rebranding and rebaselining.

Do not port NEXO code by directory or migration. Reimplement approved behavior against Umi’s
canonical model.

### 2.3 What to retire

Retire:

- NEXO API, web dashboard, worker, Prisma schema and migrations.
- NEXO identity, organizations, branches, memberships, sessions, refresh tokens, and RBAC.
- NEXO sales, payments, receipts, refunds, inventory, and physical-cash authority.
- NEXO OpenAPI and TypeScript SDK after Umi contract parity.
- Standalone PostgreSQL, Redis, MinIO, and observability infrastructure.
- Fake Umi sinks, unconsumed device outboxes, obsolete certification reports, and contradictory
  documentation.

### 2.4 Umi is authoritative but not yet POS-ready

Umi has the correct platform direction and a substantially better operational base, but the
following are prerequisites:

- `main` and `build-v3` have materially diverged.
- The recorded build-v3 gate still reports unresolved backend SQL. Unmerged P4 work changes the
  measurement and cannot be treated as complete until rerun on the integrated head.
- Database changes are spread across dumps, dated SQL, and build scripts rather than one
  reproducible migration ledger.
- Runtime assumptions about `umi_app`, `umi_worker`, RLS, and BYPASSRLS conflict with repository
  role definitions.
- A privileged contact resolver and a PostgreSQL-owner KDS view can bypass intended tenant
  boundaries.
- Dashboard paths have drifted from API paths and legacy/direct Supabase auth paths remain.
- Local authentication lacks durable refresh-session families, centralized revocation, complete
  CSRF hardening, and distributed rate limiting.
- Production lacks a proper staging promotion, database migration gate, automated off-provider
  backup, and rehearsed restoration path.
- Umi has no complete checkout, physical-cash, inventory, receipt, payment-provider, or refund
  workflow yet.

Current regression floors:

- Umi API: 325 unit tests passing at audit time.
- Umi contract: passing.
- Umi dashboard: production build passing, with a bundle-size warning.
- umiPOS Flutter tests were not executable locally because the installed Flutter/Dart versions are
  below the repository constraint. Pinning the toolchain is the first client task; this is not a
  product-test failure.

## 3. Target architecture

### 3.1 Runtime and data flow

```text
Flutter POS
  ├── Generated Umi API client
  ├── Enrolled device proof + operator session
  ├── Encrypted catalog/cart/command journal
  ├── Scanner, printer, drawer, and payment ports
  └── Direct paired-KDS LAN channel
          │
          ▼
Umi API: modules/pos
  ├── Device + operator + branch + entitlement authorization
  ├── Server-side pricing, tax, business date, and policy
  ├── Atomic checkout/cash/inventory/loyalty/receipt writer
  ├── Payment intent and unknown-outcome state machine
  ├── Idempotent command result store
  └── KDS/order projection
          │
          ▼
Supabase PostgreSQL
  ├── umi       # identity, access, entitlements, enrolled devices
  ├── tenant    # café business facts and immutable ledgers
  └── runtime   # sessions, idempotency, queues, outbox, dead letters
```

Workers may deliver notifications, provider reconciliation, analytics, and other asynchronous side
effects. They must not infer or asynchronously complete the core financial effect of a POS sale.

### 3.2 API contract

`packages/contract` is the only editable definition of routes and schemas.

It emits a deterministic, language-neutral JSON artifact containing:

- Semantic version and content hash.
- JSON schemas generated from Zod.
- Route name, method, `/api/v1/...` path, request and response schemas.
- Authentication mode.
- Success status and stable machine error codes.
- Idempotency requirement.
- Offline eligibility.
- Fresh-PIN and manager-approval requirements.
- Global money, timestamp, pagination, and error-envelope conventions.

`apps/umi-pos` generates immutable Dart models and a typed client from the artifact. The generated
output is committed and CI fails when regeneration produces a diff.

The current Swift KDS consumes generated neutral models for any new or changed contract. The LAN
protocol is also defined as language-neutral schemas and canonical signing test vectors. This avoids
building new Swift-only domain rules before the later Flutter migration.

API majors coexist. A v1 field client never silently receives v2 behavior.

Every mutation carries:

- `Idempotency-Key`
- Persisted `clientCommandId`
- Request fingerprint
- Device ID and device proof
- Operator session when required
- Checkout or shift optimistic version when required

Same command and fingerprint returns the recorded result. Same command with different input returns
`idempotency_conflict`.

### 3.3 Authentication and device trust

- Each POS and KDS generates a non-exportable P-256 key in Android Keystore or Apple
  Keychain/Secure Enclave.
- Dashboard-generated enrollment codes expire after ten minutes.
- Enrollment registers a public key and permanently binds the device to one business and branch.
- Enrollment retries recover the same result; the server never relies on redisclosing a generated
  shared secret.
- Every POS command includes a signed proof over HTTP method, versioned path, body hash, timestamp,
  nonce, device ID, and command ID.
- Operator PINs are Argon2id-hashed server-side and rate-limited through Redis. PINs are never stored
  locally.
- Operator access tokens last 15 minutes and can renew during an active shift only with valid device
  proof.
- Fresh operator PIN approval is valid for five minutes.
- A manager’s second PIN creates a one-use approval token bound to the exact command fingerprint and
  expires after two minutes.
- Device revocation, user suspension, branch reassignment, entitlement removal, and minimum-version
  policy fail the next online command closed.
- Dashboard cookie authentication gains rotating durable refresh-session families, server-side
  revocation, CSRF protection, and Redis-backed rate limiting.
- Operational Supabase Auth modes and direct dashboard database access are removed.

### 3.4 Public POS API

Device and bootstrap:

- `POST /api/v1/pos/enrollments/consume`
- `POST /api/v1/pos/operator-sessions`
- `POST /api/v1/pos/operator-sessions/refresh`
- `DELETE /api/v1/pos/operator-sessions/current`
- `GET /api/v1/pos/bootstrap`
- `GET /api/v1/pos/commands/{clientCommandId}`

Catalog and customer:

- `GET /api/v1/pos/catalog/snapshot`
- `GET /api/v1/pos/catalog/delta`
- `POST /api/v1/pos/customers/resolve`
- `POST /api/v1/pos/loyalty/authorizations`
- `DELETE /api/v1/pos/loyalty/authorizations/{id}`

Checkout:

- `POST /api/v1/pos/checkouts`
- `PATCH /api/v1/pos/checkouts/{id}`
- `POST /api/v1/pos/checkouts/{id}/quote`
- `POST /api/v1/pos/checkouts/{id}/suspend`
- `POST /api/v1/pos/checkouts/{id}/resume`
- `POST /api/v1/pos/checkouts/{id}/commit`
- `POST /api/v1/pos/sync/batches`

Payment and after-sale:

- `POST /api/v1/pos/payment-intents`
- `GET /api/v1/pos/payment-intents/{id}/outcome`
- `POST /api/v1/pos/refunds`
- `GET /api/v1/pos/receipts/{id}`

Physical cash:

- `POST /api/v1/pos/shifts/open`
- `POST /api/v1/pos/shifts/{id}/cash-entries`
- `POST /api/v1/pos/shifts/{id}/count`
- `POST /api/v1/pos/shifts/{id}/handoff`
- `POST /api/v1/pos/shifts/{id}/reconcile`
- `POST /api/v1/pos/shifts/{id}/close`

Stable error codes include:

- `device_revoked`
- `device_branch_mismatch`
- `operator_session_expired`
- `fresh_pin_required`
- `manager_approval_required`
- `entitlement_inactive`
- `catalog_snapshot_stale`
- `checkout_version_conflict`
- `shift_not_open`
- `shift_state_conflict`
- `idempotency_conflict`
- `payment_outcome_unknown`
- `offline_command_rejected`
- `contract_version_unsupported`

### 3.5 Database model and invariants

Keep the build-v3 `umi`, `tenant`, and `runtime` boundaries.

Add or complete:

- Catalog: variants, barcodes, effective prices, media, tax categories, modifier groups/options,
  required-choice constraints, and branch availability.
- POS workflow: checkout, checkout lines/modifiers, suspended carts, register, shift, cash entry,
  count, reconciliation, approval, receipt, and immutable POS audit events.
- Payment: intent, attempt, allocation, manual-external reconciliation, provider reconciliation, and
  compensating refund facts.
- Inventory: location, movement ledger, balance projection, reservations, counts, transfers, and
  optional cost layers.
- Runtime: device/operator sessions, command results, idempotency fingerprints, enrollment
  challenges, and outbox/dead-letter machinery.

Physical cash must not collide with Umi loyalty/stored value:

- `tenant.pos_register`
- `tenant.pos_shift`
- `tenant.pos_cash_entry`
- `tenant.pos_count`
- `tenant.pos_reconciliation`
- `tenant.pos_approval`

`tenant.customer_order.status` remains fulfillment-only. Open, priced, suspended, and
awaiting-payment states belong to `tenant.pos_checkout`. A draft never appears in KDS.

Financial invariants:

- MXN amounts use signed 64-bit integer minor units plus explicit currency.
- The client never authors authoritative totals, tax, change, business date, or loyalty value.
- Tax is inclusive and derived from product, branch, and tax-category configuration.
- Business date derives from server time, branch timezone, and a configurable close cutoff,
  initially 04:00 local.
- Order lines, modifiers, prices, taxes, discounts, tips, and receipt content become immutable
  snapshots at commit.
- Payments, refunds, loyalty ledgers, inventory movements, cash entries, and audit events are
  append-only.
- Corrections use void or compensating records, never deletion or history mutation.
- External provider calls never occur while database locks are held.
- A cash commit atomically creates the order, immutable lines, tender allocations, cash entry,
  inventory movements, loyalty effects, receipt, kitchen event, audit event, and idempotent result.
- A shift cannot close while device commands remain unsynchronized.
- Expected cash equals opening float plus immutable cash movements.
- Blind count is required before expected totals or variance are disclosed.

### 3.6 Supabase and PostgreSQL controls

Establish `Umi/supabase` as the sole migration authority:

1. Recover and checksum the existing remote migration history.
2. Create a reproducible application-schema baseline.
3. Convert build-v3 into ordered, forward-only Supabase migrations.
4. Keep backfill, security, reconciliation, and SQL-preflight scripts separately runnable.
5. Prove clean local reset, staging migration, production-clone rehearsal, and restore.
6. Never edit an applied migration; corrections are new migrations.
7. Keep Sqitch deferred until a separately approved VPS database move.

Security controls:

- `umi`, `tenant`, and `runtime` are not client-exposed Data API schemas.
- Flutter contains no anon key, service key, database password, or direct RPC path.
- Every tenant table has enabled and forced RLS.
- Request POS writes use a NOBYPASSRLS application transaction with business, user, device, and
  branch context set through `SET LOCAL`.
- Worker access never substitutes for request authorization.
- Every RLS predicate and foreign key has supporting indexes.
- Reporting views use `security_invoker`.
- Privileged functions live in sealed schemas, use an empty or fixed `search_path`, validate the
  caller explicitly, and revoke `PUBLIC` execution.
- Application roles receive explicit table and column privileges; no `GRANT ALL`.
- Checkout, shift, loyalty, and inventory locks follow one documented acquisition order.
- Transactions have short statement and lock timeouts and never span network calls.
- CI runs the build-v3 security gate, reconciliation, SQL preflight, missing-FK-index inspection,
  cross-tenant negative tests, and Supabase database advisors.

## 4. Product behavior

### 4.1 Café workflow

The first release supports:

- Spanish operator UI and MXN only.
- Counter pickup and simple dine-in labels.
- Anonymous sale or optional customer attachment through Umi QR or verified phone.
- Variants, required and optional modifiers, notes, quantity changes, removal, suspend, and resume.
- Cash, manually recorded SIM-terminal card payments, cash/card split, loyalty reward, wallet, and
  gift-card allocations.
- POS and terminal tips.
- Fixed or percentage line/order discounts.
- Pre-fulfillment void and partial/full post-payment refund.
- Printed receipt and authenticated digital receipt.
- Full physical-cash operations.
- Availability warnings without a hard block. Any cashier can acknowledge and continue; record the
  snapshot state and operator automatically.

Out of v1:

- Tables/tabs and coursing.
- Delivery.
- Scales and serialized stock.
- Multicurrency.
- CFDI/PAC integration.

Second-manager approval is required for:

- Every post-payment refund.
- Paid-out, safe-drop, deposit, and drawer handoff.
- Shift reopen and variance approval.
- Discounts above tenant-configured thresholds.

Ordinary pre-payment item voids require a reason and fresh operator PIN but no manager.

Digital receipts require a Umi customer account. Anonymous sales receive printed receipts only.

### 4.2 Loyalty

- Resolve the customer through Umi QR or verified phone.
- Support reward redemption, wallet balance, and gift cards.
- Redemption uses authorize, commit, and reverse semantics.
- Checkout reserves loyalty value before external payment work and commits it only with the order.
- Any checkout failure reverses the authorization.
- Earn derives from the committed order.
- Offline sales queue loyalty earn but block all redemption.
- Anonymous sales have no loyalty effect.

### 4.3 Cash-first card handling

Kalala may launch before integrated acquiring.

Manual SIM-terminal records contain only:

- Provider or terminal label.
- Merchant reference.
- Approved amount.
- Card brand and last four digits when available.
- Operator and device.
- `unverified` reconciliation status.

Never capture PAN, track data, CVV, or terminal secrets.

Manual-terminal records can participate in split tender but remain operator assertions until
reconciled against provider data. Refunds are compensating facts and require manager approval.

The later provider-neutral adapter exposes:

- Create intent.
- Send or associate terminal request.
- Query outcome.
- Capture.
- Cancel or void.
- Partial or full refund.
- Verify webhook.
- Import settlement and reconciliation data.

Payment states cover requested, pending-terminal, authorized, captured, declined, unknown, voided,
partially-refunded, and refunded. Unknown outcome is query-only.

### 4.4 Offline POS

A shift must start online. Opening pins a signed snapshot containing:

- Device, branch, register, operator, entitlement, app version, and shift.
- Catalog, modifiers, taxes, prices, discounts, business-date policy, and availability version.
- Offline count/value limits or explicit unlimited-risk acceptance.
- KDS pairing identities and certificates.
- Contract version and expiry.

Supported offline:

- Cash sale and change.
- Manually confirmed SIM-terminal transaction.
- Cash or terminal tip.
- Authorized manual discounts within the pinned policy.
- Provisional printed receipt.
- Local KDS delivery.
- Pending loyalty earn.
- Availability warning.
- Cart suspend and resume.

Blocked offline:

- Shift start or official close.
- Loyalty, wallet, reward, or gift-card redemption.
- Integrated provider commands.
- Refunds.
- Paid-out, deposit, safe-drop, handoff, reconciliation approval, or permission change.
- Catalog or price edits.
- Device enrollment.

Local requirements:

- SQLCipher database with a non-exportable Keystore key.
- Persist carts and command IDs before network or tender interaction.
- Keep synchronized official receipts, redacted command history, and catalog snapshots for 30 days.
- Purge PINs, tokens, authorization secrets, and transient payment details immediately.
- Never store full customer phone, PAN, CVV, or raw provider payloads.
- Provisional receipts use a device/local sequence and state “pendiente de sincronización.”
- Umi assigns official order and receipt numbers after replay.
- Digital receipts become available only after sync and customer ownership validation.
- Sync revalidates device, operator, entitlement, and policy; replays in device sequence; maps
  provisional IDs; applies pending loyalty earn; imports KDS actions; and surfaces every conflict.
- No command is silently dropped or silently repriced.

There is no hidden offline cap. Kalala activation requires either configured per-sale/shift limits or
recorded acceptance of unlimited offline exposure.

### 4.5 POS-to-KDS LAN protocol

The current Swift KDS is extended only as required for the pilot. New domain rules must live in
neutral contracts and test vectors so they transfer directly to Flutter later.

- KDS advertises `_umi-kds._tcp` through Bonjour.
- Devices use Umi-issued, branch-scoped certificates and mutual TLS.
- Application envelopes are signed and include protocol version, sender/receiver IDs, branch,
  provisional order ID, message ID, monotonic sequence, payload hash, and timestamp.
- KDS persists every local ticket and action before acknowledging.
- ACKs are signed and bind message ID and payload hash.
- POS retries three times within five seconds.
- Without an ACK, the sale remains committed locally, the POS shows an operational warning, and the
  certified printer produces one kitchen fallback ticket.
- KDS may advance accepted, preparing, ready, and completed while offline.
- Offline cancellation means kitchen rejection and a pending manager-remediation task. It does not
  change payment, cash, loyalty, or inventory.
- KDS actions replay with expected server version. Stale or invalid transitions become visible
  reconciliation exceptions.
- When a provisional order becomes official, KDS replaces it by `clientCommandId`; it never displays
  a duplicate.
- No branch gateway, local server, elected leader, or alternate database is introduced.

## 5. Implementation sequence

### Gate 0 — Protect current work and settle provenance

- Keep unrelated landing-page changes isolated from reconciliation.
- Verify and push an immutable umiPOS archival tag with lockfiles, license inventory, and checksums.
- Create a clean integration worktree from `origin/build-v3`.
- Merge current `origin/main` into build-v3 through review; do not rewrite shared branch history.
- Review `feat/p4-order-repos` commit-by-commit and retain only changes that preserve build-v3
  ownership and structural tenant scoping.
- Update the architecture ADR and mark federated NEXO documents superseded.

Exit:

- Clean implementation worktree.
- Immutable source snapshots.
- One current build-v3 integration head.
- No unresolved ownership documentation.

### Gate 1 — Finish and cut over build-v3

- Finish conversation, hours, Customer 360, KDS, order-repository, route/slug, entitlement, and role
  convergence.
- Extend SQL preflight to dynamic/interpolated statements or add equivalent executed-path tests.
- Reach zero unresolved backend SQL statements.
- Resolve actual `umi_app`/`umi_worker` role behavior.
- Repair privileged contact resolution, KDS view ownership, broad legacy grants, TLS verification,
  pooler isolation, secret rotation, and log redaction.
- Establish root Supabase migrations and a dedicated long-lived staging project.
- Rehearse build-v3 on a production clone with backfill, security gate, reconciliation, API/worker,
  dashboard, Cash, KDS, and WhatsApp smoke tests.
- Enable and verify Supabase PITR plus nightly encrypted logical backups to separate storage.
- Execute a restore drill.
- Cut over through a write freeze and controlled promotion.

Exit:

- SQL preflight: zero unresolved.
- Security gate: pass.
- Reconciliation: pass.
- API, contract, dashboard, KDS, Cash, and WhatsApp checks: pass.
- Staging and production role/grant fingerprints: match.
- Restore rehearsal: pass.
- Build-v3: production and merged to main.

### Gate 2 — POS platform foundation

- Add the `pos` entitlement, branch-scoped device type, permissions, enrolled device keys, operator
  sessions, and minimum-version policy.
- Add physical-cash, checkout, catalog extension, receipt, audit, inventory-ledger, payment-intent,
  and reconciliation migrations.
- Implement atomic command/idempotency infrastructure and server-derived business date.
- Build the contract emitter, API-major compatibility tests, and generated Dart client.
- Repair dashboard/API route drift and remove operational Supabase auth paths.
- Add backend simulators for printer, scanner, drawer, manual terminal, and acquiring provider.

Exit:

- An enrolled simulated device can authenticate an operator, open a shift, fetch a signed catalog
  snapshot, and create/query an idempotent checkout through typed v1 contracts.

### Gate 3 — Move and rebuild Flutter POS

- Create `apps/umi-pos`.
- Rename NEXO identifiers, packages, strings, storage names, and approved assets to Umi.
- Pin one Flutter/Dart SDK through repository tooling and CI.
- Retain Android production and macOS development/demo targets.
- Replace handwritten maps and cookies with generated models, device proof, and operator sessions.
- Refactor monolithic files into explicit bootstrap, operator, cart, quote, payment, receipt, shift,
  sync, and recovery state machines.
- Implement repeated new-sale lifecycle, suspend/resume, modifier selection, quantity/removal,
  customer attachment, and accessibility.
- Move fake APIs and hardware adapters into test/demo-only targets.
- Add SQLCipher, real connectivity monitoring, command journal, catalog cache, retention, and
  crash-safe recovery.
- Add environment-signed configuration; no placeholder URL can enter a release build.

Exit:

- 100 sequential simulated sales in one shift create 100 independent carts and recover after process
  restarts.

### Gate 4 — Online café vertical slice

Implement:

- Online shift open.
- Catalog, variants, modifiers, inclusive tax, discount, tip, and availability warning.
- Cash, manual-terminal, and split tender.
- Loyalty reward, wallet, and gift-card authorize/commit/reverse plus earn.
- Atomic order, payment, cash, inventory, receipt, and KDS commit.
- Printed and account-bound digital receipts.
- Reprint from authoritative receipt projection.
- Full cash movements, blind count, reconciliation, handoff, variance, and close.
- Voids and partial/full refunds with restock choice and compensating financial facts.
- Dashboard screens for devices, catalog, sales, receipts, refunds, shifts, counts, variances,
  approvals, offline risk, and reconciliation.

Exit:

- One sale appears exactly once across order, payment, cash, inventory, loyalty, receipt, dashboard,
  customer history, and KDS.

### Gate 5 — Offline and LAN resilience

- Implement signed shift snapshot and offline capability enforcement.
- Implement provisional receipts, ordered replay, conflict inbox, risk limits, and official-ID
  mapping.
- Add the Swift KDS Bonjour listener, mutual TLS, durable local inbox/action journal, signed ACKs, and
  provisional ticket UI.
- Implement printer fallback and pending kitchen-remediation workflow.
- Test outages at every checkout, payment, receipt, print, KDS, sync, and shift boundary.

Exit:

- A full disconnected shift can sell within recorded exposure, operate the kitchen, reconnect,
  reconcile without duplicates, and close only after authoritative sync.

### Gate 6 — Kalala certification and pilot

Configure:

- One Kalala branch.
- One Android POS terminal.
- One register and assigned drawer.
- One existing Swift KDS on its current iPad.
- One thermal printer with kitchen fallback.
- One separate SIM payment terminal.
- Spanish/MXN.
- Initial 04:00 business-date cutoff.
- Menu, tax, modifier, loyalty, discount, approval, and offline policies.
- Explicit offline limits or signed unlimited acceptance.
- Managed private Google Play release track.
- OpenTelemetry backend/worker signals and Sentry Flutter/backend crash reporting.

Rollout:

1. Internal simulator and database staging.
2. Actual hardware lab.
3. Kalala staff training and non-financial rehearsal.
4. Cash/manual-terminal live canary on one device.
5. Daily reconciliation of sales, tenders, cash, receipts, inventory, loyalty, KDS, replay, and
   command outcomes.
6. Expand only after seven consecutive trading days with no unexplained financial discrepancy.

Never dual-write to NEXO. After the first Umi POS transaction, rollback means an older compatible
Umi app/API release or disabling POS through entitlement—not restoring NEXO authority.

### Gate 7 — Integrated card

- The product owner selects the acquiring provider and terminal hardware.
- Implement only that provider adapter against the already certified neutral state machine.
- Certify authorization, terminal timeout, decline, capture, unknown outcome, reversal, partial/full
  refund, duplicate webhook, settlement import, split tender, and daily reconciliation.
- Enable by business/device feature flags after provider and hardware certification.
- Keep CFDI deferred while preserving fiscal-reference fields in receipt and payment models.

Exit:

- Provider, terminal, API, database, receipt, refund, and settlement totals reconcile without manual
  interpretation.

### Gate 8 — Replace Swift KDS with Flutter

Start only after the POS pilot is stable and integrated card is certified.

Migration approach:

1. Freeze the Swift KDS behavior contract, backend fixtures, LAN envelopes, signing vectors,
   screenshots, accessibility expectations, and lifecycle traces.
2. Create `apps/umi-kds-next` as Flutter, targeting the existing iPads first.
3. Reuse only stable cross-client Flutter packages:
   - Generated Umi contract models/client.
   - Device identity, proof, certificate, and secure-storage support.
   - Telemetry correlation and redaction.
   - Design tokens.
   - LAN envelope codecs and cryptographic test vectors.
4. Do not share POS cart, payment, cash, or checkout state with KDS.
5. Implement board, ticket detail, pairing, settings, polling/reconciliation, offline journal, LAN
   listener, signed ACK, and kitchen rejection behavior.
6. Run Swift and Flutter against the same read-only fixture streams and compare normalized state,
   transitions, visual hierarchy, accessibility, and reconnect behavior.
7. Canary Flutter on one Kalala iPad while a Swift rollback build remains available.
8. Require seven consecutive operating days without lost, duplicated, or invalid ticket state.
9. Archive the Swift implementation at a release tag.
10. Replace `apps/umi-kds` with the Flutter project and remove the temporary `umi-kds-next` name.
11. Consider Android KDS only as a later hardware-certification increment.

Exit:

- Flutter KDS matches or improves Swift behavior on the current iPads and becomes the sole maintained
  KDS client.

### Gate 9 — Final NEXO retirement

- Verify all approved Flutter assets and tests exist in Umi.
- Delete duplicated NEXO code from the active umiPOS branch.
- Leave a tombstone README that points to Umi and the archival tag.
- Mark umiPOS read-only.
- Remove NEXO dependencies, CI, secrets, deployments, and obsolete documentation from active
  maintenance.
- Publish the current capability matrix, ADRs, contract documentation, hardware matrix, incident
  runbook, restore runbook, and pilot reconciliation record.

## 6. Verification and acceptance

Required automated and integration scenarios:

- 100 sequential sales in one shift and a second shift on the same device.
- Same command/same payload replays; same command/different payload conflicts.
- Response loss at every commit boundary returns the original result without duplicate effects.
- Two registers never see, count, hand off, or close each other’s shifts.
- Cash sale and cash ledger cannot diverge with the worker stopped.
- Shift close waits for every prior device command.
- Device, user, branch, entitlement, and version revocation fail closed online.
- Cross-business and cross-branch access fails at API and database layers.
- Forged tenant/device context and worker-role shortcuts fail.
- RLS views and privileged functions cannot bypass isolation.
- Tax, tip, discount, split tender, loyalty, refund, and change reconcile in integer minor units.
- Unknown provider outcome cannot generate another charge.
- Anonymous sales cannot access digital receipts.
- Authenticated customers can access only their own receipts.
- Printer failure never rolls back a sale.
- KDS sees only committed paid orders, never drafts.
- Unacknowledged LAN delivery prints exactly one fallback kitchen ticket.
- Provisional KDS tickets become official without duplication.
- Offline KDS rejection creates remediation but no unauthorized refund.
- Offline replay preserves original prices, tax, and policy and never silently reprices.
- Offline redemption, refund, cash movement, handoff, and close are rejected.
- Snapshot expiration, clock skew, replay, signature tampering, certificate mismatch, and stolen local
  database tests fail closed.
- Availability override is visible and audited; advisory inventory may go negative only as an
  explicit consequence of the selected policy.
- Local encryption and 30-day purge are verified on Android and macOS.
- Contract regeneration and v1 compatibility block CI.
- Release builds contain no Supabase credentials, test adapters, debug endpoints, or NEXO names.
- Backup restoration and rollback are rehearsed before pilot.
- Flutter KDS parity tests replay the same fixtures and transitions as the archived Swift reference.

Pilot operational targets:

- Zero unexplained order/payment/cash/loyalty discrepancies.
- Zero duplicate provider or manual-terminal references.
- Zero lost or duplicated kitchen tickets.
- POS API commands meet 500 ms p95 excluding provider latency.
- LAN KDS ACK meets 500 ms p95 on the certified network.
- Every failure is traceable by redacted `clientCommandId` across Flutter, API, database audit,
  worker, and KDS.
- Logs and Sentry events exclude PINs, phone numbers, device private material, tokens, receipt-access
  data, and card-sensitive data.

## 7. Fixed assumptions and deferred gates

- No real umiPOS data exists.
- Supabase remains the database host through the pilot.
- Build-v3 finishes before POS backend/database development.
- Flutter POS moves into `Umi/apps/umi-pos`.
- Android is the only production POS platform; macOS is development/demo only.
- Kalala is the first live café with one branch, POS device, drawer, printer, SIM terminal, and Swift
  KDS.
- Live pilot may use cash and manually recorded terminal payments before integrated acquiring.
- Integrated card is the first major increment after the POS pilot.
- Flutter KDS follows integrated card and targets the existing iPads first.
- Spanish/MXN only for v1; contracts remain localization- and currency-safe.
- Inventory availability is advisory in POS; counts, transfers, costs, and policy management live in
  the dashboard.
- One device/register owns one shift; handoff is explicit and manager-approved.
- Online shift start is mandatory; official close is online-only.
- Offline exposure has no hidden cap but requires configured limits or recorded unlimited
  acceptance.
- Account authentication is required for digital receipts; anonymous customers receive print only.
- CFDI, tabs, delivery, coursing, scales, serialized inventory, multicurrency, and additional POS
  platforms are outside v1.
- Hardware models and the acquiring provider remain procurement decisions. Adapter and simulator
  work may proceed, but production enablement waits for certification.
