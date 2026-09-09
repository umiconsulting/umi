# Umi POS + KDS + Kitchen — Completeness Audit

Date: 2026-09-06. Branch: `chore/build-v3-checkpoint`.
Evidence-based (file:line). Legend: ✅ finished · 🟡 partial · 🔴 missing/unfinished.

Scope: `apps/umi-pos` (Flutter POS), `apps/umi-kds` (legacy SwiftUI KDS),
`apps/umi-api/src/modules/kds` + `orders`, `apps/umi-dashboard/src/screens/cocina.jsx`.

Method: CodeGraph CLI + Read; grep only for SQL/string literals. Surface-level
inventories for checkout/cash/catalog/offline/device gathered by parallel Explore
sub-agents; kitchen/KDS/exception/theme/printing/docs read directly.

---

## Executive summary

The POS **transaction core is mature and, in the sale/checkout/cash/refund path,
essentially feature-complete** — the certification doc calls it
`UMI POS SOFTWARE COMPLETE WITH P2` with hardware deferred to Gate 13
(`docs/product/UMIPOS_SOFTWARE_STATUS.md:7-9`, dated 2026-08-13, predates this branch).

The **KDS/kitchen story is the opposite**: the backend kitchen domain is complete
and rich, but the **Flutter KDS client is a ~5% read-only preview** (per the ADR).
The full kitchen client still lives only in the legacy SwiftUI `umi-kds`
(2,617 lines, still present, not retired).

Biggest unfinished areas: (1) KDS unification Phases 2–5, (2) device-role model,
(3) customer-display app mode, (4) offline auto-replay-on-reconnect, (5) order-type
pills not persisted.

---

## 1. Sale surface / order entry — ✅ (one 🟡: order-type not persisted)

- Three-pane wide layout present: `catalog_surface.dart:796-858` — order is
  **cart | category-rail | products** (left→right), not the "categories|products|cart"
  order sometimes described; narrow (<900px) collapses to one column + cart FAB
  (`catalog_surface.dart:379-409, 755-793`).
- Cart: add/remove/qty/edit/clear with idempotency + optimistic `expectedVersion`
  (`cart/cart_controller.dart:71-222`); per-line variant + modifiers + note in the
  line subtitle; inline detail in the right pane on wide tills
  (`catalog_surface.dart:1200-1206, 834-857`). Line notes maxLength 500
  (`catalog_surface.dart:1964-1968`).
- Sale lifecycle: suspend / cancel / resume / rename / customer attach-detach /
  sale history with filters + pagination + reprint + kitchen-status +
  exception entry (`sale/sale_surface.dart:11-113, 355-514`).
- 🟡 **Order-type pills (dine-in / takeout)**: UI works
  (`catalog_surface.dart:416-437`, chip echoed at `:2302-2323`) but the value is
  **never persisted** to the sale/checkout/cart payload — grep shows `dine_in`/`takeout`
  appear only in `catalog_surface.dart`. Code comments at `:95, :411-412` overstate it
  as "carried onto the sale note"; it is display-only. Also only two types (no delivery).

## 2. Catalog surface — ✅ (minor edges)

- PoloTab vertical colour-bar category rail: `_CategoryRail`
  (`catalog_surface.dart:1391-1421`), `_CategoryTile` with 4px bottom colour bar
  (`:1486`). Colour source = explicit `category.color` hex else deterministic djb2
  hash→HSL (`:1681-1706`), mirrored by the dashboard so previews match.
- Product tiles: real photo via `primaryMedia.url` with `broken_image` fallback,
  else initials colour placeholder (`:1590, 1602-1614, 1659-1730`).
- Search: 280ms debounced (`:714-736`) → `catalog_controller.dart:102-108`, with
  `noResults`/`empty` phases; barcode scan lookup path (`:232-258`,
  `catalog_controller.dart:110-139`).
- Modifiers/option groups: single/multi select, required/min, per-cap disable,
  price deltas rendered (`catalog_surface.dart:1838-1924`); Add disabled until
  required satisfied (`:1985-1990`).
- Variants: single-select chips (`:1938-1956`). 🟡 minor: variant **price delta not
  shown** in the picker (unlike modifiers) (`:1947-1953`).
- Frequent products: device-local SharedPreferences top-6 per merchant+location
  (`frequent_products.dart:53-122`), rail at `:1527-1577`; a global "most-sold" from
  sales history is an acknowledged future backend item (`frequent_products.dart:50-51`).
- Zero-price products filtered out of the sale grid (`:1145-1150`). 🟡 edge: the
  barcode fast-path adds an exact match without the price check (`:237-241`), so a
  zero-price item could enter the cart by scan.

## 3. Checkout / tender — ✅ (🔴 no integrated card by design; 🟡 quick-cash + offline split)

- Cash: default-on, method tile + numpad + change (`checkout_surface.dart:369-375,
462-468, 473-524`); numpad `_Numpad` (`:2182-2230`), one-decimal / 2dp guard
  (`:1447-1465`).
- Manual card terminal: policy-gated (`policy.manualTerminalEnabled`,
  `:376-386`), emitted as `manual_terminal`/`external_terminal`; four outcome chips
  processing/success/failure/unknown (`:555-578`) with full `payment_unknown` →
  `queryUnknownPayment` polling + recovery (`checkout_controller.dart:283-337, 449,
472-474`). 🔴 **No integrated/PSP card reader** anywhere — "card" = operator-driven
  manual terminal only. (Consistent with the manual-terminal model, not necessarily a defect.)
- Colour-coded change: errorContainer (owes) vs primaryContainer (change due)
  (`:473-524`).
- One-tap checkout: exact-total, non-dirty preview auto-confirms in the same tap
  (`:1635-1652`); pay button reads `Cobrar · <amount>` (`:742-759`).
- Completed/receipt screen: `_receipt` (`:1881-1979`) + itemised detail dialog
  (`:1981-2027`); distinct offline provisional receipt (`:1764-1845`).
- Stored-value (wallet / gift card / loyalty reward): wired via `CustomerValueController`,
  merged as `storedValueTenders` (`:1302-1329, 1544`), permission-gated.
- 🟡 **Split**: only fixed cash + manual-terminal split (50/50 preseed,
  `:1420-1436`); no arbitrary N-way builder. Offline split explicitly blocked —
  single cash tender only (`checkout_controller.dart:501-517`,
  `OFFLINE_ADVANCED_TENDER_BLOCKED`).
- 🟡 **Quick-cash denominations hardcoded** `const [10000,20000,50000]`
  (`:447-458`), not currency/locale-derived.
- Tender IDs derived from cart id for idempotent retries (`tender_identity.dart:20-31`).
- No TODO/stub markers (one user-facing "Temporary authorization" string only).

## 4. Cash management — ✅ (complete)

- Open shift (register + opening float + denomination count):
  `cash_surface.dart:336-443`; controller `cash_controller.dart:130-174` (idempotent).
- Close shift 4-step pipeline count → variance → reconcile → close
  (`cash_surface.dart:526-673`); counted-vs-expected + tolerance `_VarianceCard`
  (`:835-867`); post-close summary (`:184-220`). Manager-approval sub-paths present.
- Cash movements paid-in / paid-out / safe-drop / no-sale (`:468-497, 918-1035`),
  each permission-gated + optional manager approval; hardware post-commit hooks fired.
- Cash center / status card + "open for" elapsed + adopt (takeover interrupted shift)
  (`:27-182, 222-289, 294-334`).
- Denomination counter complete (`denomination_counter.dart:54-186`), policy-driven set
  with MXN fallback.
- Idempotency + crash recovery: every mutation via `_commandIds`/`_completeCommand`
  (`cash_controller.dart:725-791`), `SecureCashRecoveryStore` schemaVersion 2
  (`cash_recovery_store.dart`), startup `_recoverPendingCommand` (`:799-830`).
- No TODO/stub markers. Non-blocking: unused `closeShift()` wrapper (`:487-489`);
  movement field skips `cashAmountFormatters` (cosmetic).

## 5. Refunds / voids / exceptions — ✅ (the 4 known blockers verified fixed)

Full flow in `apps/umi-pos/lib/features/exception/` + API `apps/umi-api/src/modules/pos-exception/`
(NOT the `kds` module).

- Controller `exception_controller.dart:52-522`: eligibility → preview → (manual
  terminal outcome) → (manager approval) → commit, with idempotency
  (commandId/idempotencyKey), recovery store + offline recovery, terminal
  confirmed/failure/unknown outcomes.
- Surface `exception_surface.dart:191-773`: void / full-refund / partial-refund type
  chips, per-line quantity + restock decision, manager-PIN approval, block-code and
  error-code specific guidance, compensating receipt.

Known 4 blockers — VERIFIED:

1. **Missing exception policy** → FIXED. Server policy exists:
   `pos-exception.repository.ts:46-47` (`refundsEnabled`/`voidsEnabled`),
   `:1508` reads `refunds_enabled`/`voids_enabled`, `:1655-1656` emits `policy_disabled`
   block code; surface renders it (`exception_surface.dart:674-677`).
2. **saleId cart-vs-committed bug** → FIXED. Exception opens with
   `sale.committedSaleId ?? sale.id` (`sale/sale_surface.dart:446`).
3. **Reason-dropdown crash** → FIXED. Dropdown keyed on void-vs-refund
   (`key: ValueKey(_exceptionType == 'void')`) and `initialValue` guarded to a member
   of the current reason set (`exception_surface.dart:253-258`), so switching type
   can't leave a stale value that asserts.
4. **pos_sale_exception RLS** → present. `merchant.pos_sale_exception` has RLS enabled
   - restrictive `device_scoping` + `merchant_location_isolation`
     (`docs/migration/build-v3/90_rls.sql:631-632`,
     `docs/migration/build-v3/44_dashboard_operational_wiring.sql:58`,
     `docs/migration/build-v3/34_pos_exception.sql:539`). Refund runs end-to-end from the
     POS operator (device-scoped) session. (Note: the RESTRICTIVE `device_scoping` class
     is the same pattern that hides device-less owner sessions in the dashboard cash-shift
     bug from memory — fine for the device-bound POS, worth watching for any owner surface.)

## 6. Offline / sync / reliability — 🟡 (mature data path, connectivity wiring gaps)

- Offline cash checkout: `offline_checkout_service.dart:60-140` (immutable snapshot
  capturing catalog/pricing/tax versions, provisional receipt `pending_sync`).
- Durable journal: AES-GCM-256 encrypted, versioned, bounded depth 250, serialized
  writes, SHA-256 fingerprint, 30-day compaction (`offline_journal.dart`); web
  intentionally unsupported (`:605-609`).
- Policy engine: cash-only, trusted-time/clock-tamper guards, permission/entitlement,
  stale-catalog/pricing/tax, queue/accumulation limits (`offline_policy.dart:71-241`);
  command allowlist = `operational.ack` + `pos.checkout.cash` only
  (`offline_journal.dart:255-258`).
- Replay: ordered by `deviceSequence`, monotonic ack of contiguous prefix,
  query-before-resend on unknown, conflict `blocksFollowing` → reconciliation,
  cursor "server ahead" recovery, device-revocation block (`replay_engine.dart:164-551`).
- Recovery center: 14 actions with permission/severity/audit, manager-credential
  prompt, offline-hardware retry with "unknown physical result" handling
  (`recovery_center.dart`, `recovery_actions.dart:35-252`).
- 🟡 **Gap A — no OS-level connectivity source.** `ConnectivityAdapter.isOnline()` has
  only `UnsupportedConnectivity` returning unavailable (`platform_adapters.dart:27-32`);
  `isOnline()` is never called. Offline is inferred only from API call
  success/failure fed from the catalog screen + replay (`connectivity_controller.dart:16-55`).
- 🟡 **Gap B — no automatic replay-on-reconnect.** The connectivity listener only
  rebuilds the widget (`catalog_surface.dart:105`); the queue drains on catalog
  `_loadInitial` or manual Recovery Center action, not on an `offline→online` transition.
- 🟡 Gap C — `degraded`/`recovering` states are produced but drive no distinct behaviour.

## 7. Device roles / identity — 🟡 enrollment+identity complete; roles NOT modelled

Enrollment, pairing, operator sessions, and the device-key seam are **complete and
real**; the **device-role model does not exist**.

- App is a single guarded shell: bootstrap → auth/enroll/tenant/branch/operator →
  `mainShell = CatalogSurface` (`app/umi_pos_app.dart:154-190`). **No app-level
  device-role selection.**
- ✅ Enrollment: 8-char setup-code state machine end to end — UI
  `entry_surface.dart:35-170`, controller `enroll`/`_pollPairing`/`_acceptCredential`
  (`entry_controller.dart:171-359`), gateway claim/poll/acknowledge
  (`entry_gateway.dart:74-137`); revoked/rotation phases modelled
  (`entry_controller.dart:12-29, 141-149`).
- ✅ Pairing: PIN setup code + optional realtime Socket.IO **nudge-only** channel
  (`pairing_socket_client.dart:16-90`, carries no credential; poll stays the sole
  credential gate), gated by `realtimeEnrollmentEnabled`, off by default
  (`composition_root.dart:161-164`, `app_config.dart:45-48`).
- ✅ Operator PIN session: `loginWithPin` (`entry_controller.dart:380-417`), touch
  keypad (`entry_surface.dart:179-438`), lock/logout/global-logout, 5-min silent
  restore, 30-min idle auto-lock (`entry_controller.dart:419-761`), manager PIN
  step-up (`entry_gateway.dart:270-310`).
- 🟡 Device key / hardware binding: seam is real, not a stub — software Ed25519 default
  (seed in secure storage, **explicitly not a hardware boundary**,
  `device_key.dart:34-77`); **real** TPM backend driving `tpm2-tools`
  (`tpm_backend_io.dart:22-91`, persistent handle `0x81018801`); mobile keystore Dart
  side complete (`keystore_device_key.dart`, native Android StrongBox / iOS Secure
  Enclave handlers) **but the native path is unverified** — `DeviceKeySigner.kt:26-28`
  carries "REVIEW STATUS: NOT compiled or run … must be built and exercised on a device
  before it is trusted." Hardware keys are opt-in via `UMIPOS_DEVICE_KEY`; default build
  ships the software key (`composition_root.dart:104-123`, `app_config.dart:52-96`).
- 🔴 **No device-role attribute** (`pos | kds | customer_display`) anywhere: not on the
  persisted identity (`credential_vault.dart:6-27` — no role field) nor the contract
  (`umi_contract.dart:5499-5513` `DeviceSummary` has type/platform/mobility/state, no
  role). `type` is hardcoded `'pos_terminal'` at claim (`entry_gateway.dart:87`) and not
  even persisted. KDS "mode" reuses the POS operator session
  (`kitchen_board_surface.dart:60-72`, `catalog_surface.dart:603-655`); matches ADR
  Phase 1 (`docs/architecture/2026-09-06-...-adr.md:184-211`).
- 🟡 `FeatureFlags` enum (`feature_flags.dart:3-41`) is effectively dead — only
  `diagnostics` is wired; real gating is `AppConfig` env booleans. Web build refused as
  a real POS (`WEB_POS_UNSUPPORTED`, `app_config.dart:103-171`).

## 8. KDS board (Flutter) — 🟡 read-only flat grid; no columns, no per-item state

- `kitchen_board_surface.dart` renders a single `Wrap` of `_TicketCard`
  (`:135-146`) — **no status columns** (legacy `umi-kds` has BoardColumnView per
  status). Cards show public ref, elapsed minutes, status pill, priority pill, and
  item rows (qty, name, variant · modifiers, prep note in error colour) (`:152-299`).
- Data via `GET /api/v1/pos/merchants/:merchantId/kitchen/board`
  (`kitchen_board_controller.dart:15-39`), **read-only**, polled every 8s
  (`kitchen_board_surface.dart:44-47`). No commands, no per-item status display, no
  targetSeconds timers, no column counts, no master-detail. Controller comment states
  read-only "until the unified device identity lands"
  (`kitchen_board_controller.dart:55-57`).
- Entry is a first-class bottom-nav item "Cocina/Kitchen"
  (`catalog_surface.dart:646-655`) — the ADR Phase-1 pending item ("move from Ajustes
  menu to bottom bar") is DONE.
- Backend contract is far richer than the client consumes: multi-channel source
  (whatsapp/pos/web/dashboard), item states, targetSeconds, priority, event sequence,
  all command types (`packages/contract/src/pos-kitchen.ts:7-150`). The gap is entirely
  client-side.

## 9. Kitchen status-advance flow — ✅ verified: device-token only; POS + dashboard read-only

- **Advance commands are device-session only.** `KdsController` command/board/heartbeat
  all require `verifyDevice(deviceToken)` (`kds.controller.ts:76-108`); the command
  handler executes `transition_ticket` / `partial_cancel_items` / canonical commands
  against a `KdsDeviceSession` with per-command kitchen permissions
  (`kds.service.ts:241-367`).
- **POS path is read-only.** `KdsPosController` exposes only `orders/:id` (status) and
  `board` (`kds-pos.controller.ts:18-36`) → `statusForPos`/`boardForPos`. No POS
  command route.
- **Dashboard is read-only for the kitchen.** `cocina.jsx` renders
  `DomainWorkspace domain="kitchen"` — routing/station **setup**, not a live board
  ("Live cook status stays on the KDS", `cocina.jsx:1-12`).
- **Commercial advance does NOT reach the KDS.** The dashboard orders surface advances
  only `merchant.customer_order` status via its own flow and is "deliberately NOT the
  kitchen projection" (`orders/orders.service.ts:5-9, 14-68`). One-way separation
  confirmed. (The reverse — a committed void creating an authoritative kitchen
  consequence in the same transaction — is by design, per
  `docs/product/UMIPOS_KDS_OPERATIONAL_MODEL.md:89-96`.)

## 10. Customer-facing display mode — 🔴 peripheral only, no app mode

- `customer_display` exists only as a **hardware peripheral**: capabilities/simulator in
  `features/hardware/hardware_runtime.dart:30, 327-332, 517`; push totals via
  `hardware_service.dart:804-805, 982-984`; test path in `hardware_surface.dart:337, 353`.
- Output is **simulator-only** today: only `CustomerDisplaySimulatorAdapter` exists;
  `pilot_hardware_adapters.dart` ships printer/cash-drawer/scanner adapters but no
  physical customer-display adapter.
- 🔴 There is **no customer-display app render mode** (no route, no surface). ADR lists it
  as a Phase-2+ device role not yet built
  (`docs/architecture/2026-09-06-...-adr.md:157-161, 190-194`).

## 11. Printing — ✅ receipts; 🔴 kitchen tickets absent (deliberately deferred)

- Receipt printing complete: `thermal_printer_adapter.dart` (539 lines) renders
  merchant/location/register header, items, subtotal/discount/tax/tip/total, tenders,
  change, QR, cut (`:68-217`); `network_tcp` byte transport interface (`:381-407`) plus
  a simulator lab (`pilot_hardware_adapters.dart:190-225`). Real-hardware validation is
  **deferred to Gate 13** (`docs/product/UMIPOS_SOFTWARE_STATUS.md:9, 34`).
- 🔴 **No kitchen-ticket printing.** No prep-ticket rendering exists; kitchen tickets are
  digital on the board. This is explicit: "Gate 4A does not require kitchen ticket
  printing… the print contract can use this projection later"
  (`docs/product/UMIPOS_KDS_OPERATIONAL_MODEL.md:166-170`).

## 12. Theme / PoloTab redesign — ✅ complete

- `core/theme/umi_theme.dart`: PoloTab palette — vivid blue primary `0xFF2E7DFF`
  (`:30`) on near-black `0xFF121317` ground with `0xFF23252B` panels (`:33-34`),
  Material-3, large 48/52px touch targets, tabular-figure money token
  (`UmiOperatorTokens.money`, `:156-160`). Both dark() and light() themes; app follows
  platform brightness (`umi_pos_app.dart:120-124`).
- 3-pane sales screen, colour-bar category rail, bottom nav, inline detail, modifier
  cards, full-screen checkout + completed screen, order-type pills — all present
  (see §1–3). PoloTab redesign is effectively done for the POS surface.

## 13. Legacy umi-kds vs unified umi-pos — 🟡 only ~5% ported; SwiftUI still the real KDS

- `apps/umi-kds` (SwiftUI) still present: 27 files, **2,617 lines**, last touched
  2026-08-13 (`a949193`); not retired.
- Only the **read-only board preview** is ported to Flutter (§8). Per the ADR this is
  ~5% of `umi-kds` (`docs/architecture/2026-09-06-...-adr.md:281-283`).
- Still SwiftUI-only (not yet in Flutter):
  - Multi-column-by-status board + master-detail ticket view
    (`umi-kds/Sources/Features/Board/BoardColumnView.swift`, `.../TicketDetail/*`).
  - Ticket commands start/ready/complete/recall/cancel from the client.
  - Sequence event stream + snapshot reconciliation (`KDSRealtimeClient.swift`,
    `OrderRepository.swift`) — Flutter polls 8s instead.
  - Idempotent/optimistic command identity persisted across restart.
  - Connection state machine that fails-closed on commands.
  - Heartbeat with `X-KDS-Device-Token` (`KDSHeartbeatClient.swift`).
  - KDS device pairing/identity with `station_id` + revocation
    (`KDSAPIClient.swift`, `AppEnvironment.swift`).
  - Per-item state + per-item time targets in the UI.

---

## Known items — verified status

| Known item             | Claim                                                                | Verified                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| KDS+POS unification    | ADR accepted, Phase 1 shipped, retiring umi-kds                      | ✅ ADR accepted; Phase 1 (read-only board) shipped and promoted to bottom nav; Phases 2–5 NOT started; umi-kds NOT retired (2,617 lines live).   |
| Refund/void 4 blockers | missing policy, saleId cart-vs-committed, reason-dropdown crash, RLS | ✅ All four verified fixed (see §5).                                                                                                             |
| Status-advance         | advance only via device token; commercial advance doesn't reach KDS  | ✅ Confirmed. Device-token-only commands; POS + dashboard read-only; commercial (`customer_order`) advance is a separate, non-kitchen flow (§9). |

---

## Prioritized unfinished list

**P0 — blocks a real KDS deployment (ADR Phases 2–5)**

1. Device-role model (`pos | kds | customer_display`) + unattended KDS station session
   (no operator PIN). Today KDS mode reuses the POS operator session — ADR flags this as
   an open escalation risk (`...-adr.md:127-150, 203-211`). §7.
2. Flutter KDS ticket commands (start/ready/complete/recall/cancel) with idempotency +
   optimistic concurrency — currently device-token/SwiftUI only. §8, §13.
3. Sequence event stream + snapshot reconciliation to replace the 8s poll; connection
   state machine that fails-closed on commands. §8, §13.
4. KDS heartbeat + device pairing/identity/revocation ported to Flutter. §13.

**P1 — parity + correctness** 5. Multi-column-by-status board + master-detail + per-item state + time targets in
Flutter (backend contract already supports all of it). §8. 6. Order-type (dine-in/takeout) not persisted to the sale/comanda — wire it through
checkout/note or remove the misleading UI+comments. §1. 7. Offline auto-replay-on-reconnect + a real OS-level connectivity source
(`connectivity_plus` or ping); today draining is coupled to the catalog screen. §6. 8. Verify the mobile hardware-key native path on device — `DeviceKeySigner.kt:26-28`
is flagged "NOT compiled or run … must be exercised on a device before trusted"; the
default build ships the software key whose seed is readable from secure storage. §7.

**P2 — polish / by-design gaps to confirm as intended** 9. Customer-display app mode (only a simulator peripheral exists today). §10. 10. Kitchen-ticket printing (explicitly deferred; confirm whether pilots need it). §11. 11. Retire `umi-kds` once Flutter reaches the ADR §5 parity gate. §13. 12. Quick-cash denominations hardcoded; variant price-delta hidden in picker;
zero-price product addable via barcode scan. §2–3. 13. Accepted P2s: unreachable `_ReadyShell` catalog placeholder
(`entry_surface.dart:581-625`, `catalogNotImplemented`) and a `StubToolsService`
historical comment (`UMIPOS_FINAL_SOFTWARE_CERTIFICATION.md:118-119`). 14. Integrated/PSP card processing absent (manual terminal only) — confirm this matches
product intent. §3.
