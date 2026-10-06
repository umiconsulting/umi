# UmiPOS branch reconciliation — `architectureUMIposIntegration` against build-v3

**Date:** 2026-07-28
**Status:** current. This is the entry point for UmiPOS work.
**Base of record:** everything stems from `build-v3`. Integration branch `feat/pos-integration`
is cut from `build-v3` tip `d8567bc` ("Merge pull request #71 from umiconsulting/feat/p4-leads").
**Subject:** `origin/architectureUMIposIntegration` @ `1e8b2f0`, archived as tag
`archive/umipos-integration-1e8b2f0`.
**Method:** every claim below is verified in the branch content with `git show`/`git grep`,
not inferred from documents.

---

## 1. Why this document exists

Another developer (HectorCeja) built a UmiPOS integration branch in four days: 15 commits,
2026-07-25 to 2026-07-28. It contains a working Flutter POS client, seven backend modules, a
Dart contract generator, and 16 SQL migrations. We must decide what to do with it.

The branch **cannot be merged**, for one reason that has nothing to do with its quality:

| Fact                                     | Value                                                       |
| ---------------------------------------- | ----------------------------------------------------------- |
| Fork point of the branch                 | `d5f399c8` (2026-07-23, "Merge PR #62 feat/p4-order-repos") |
| Is `build-v3` an ancestor of the branch? | **No**                                                      |
| Commits `build-v3` gained since the fork | 31                                                          |
| Commits the branch gained since the fork | 15                                                          |

The branch copied our whole build-v3 DDL into `supabase/migrations/` at the fork point and then
stood still. Merging it would revert 31 commits of platform work: the landing-page leads funnel
onto `umi.prospect`, `customer_order.version` + `tg_customer_order_version`, the station reshape,
`runtime.outbox_event` exactly-once delivery, `tenant.customer_fact`, `runtime.conversation_turn`,
and `tenant.business.assistant_name`.

The work is therefore **salvaged forward**, not merged. The tag is the only provenance for the
original authorship. Do not delete it.

---

## 2. What the branch got right

This is not a rejection. The branch honors the settled architecture on every load-bearing point.

- **Option B holds.** The POS is a client of `umi-api`. No second database, no event bus between
  planes, no sync, no reconciliation bridge.
- **The client writes no SQL and holds no database credential.** Its entire server surface is the
  30 paths declared in the generated Dart route table, all HTTP against `umi-api`. The Dart source
  contains zero inline URL strings.
- **`business_id` everywhere.** Zero `tenant_id` columns. This was the single largest defect of the
  earlier convergence work and the branch does not repeat it.
- **The RLS core is ours, unchanged.** Same `app.current_business` GUC, same `umi.current_business()`
  fail-closed NULL semantics, same `api` / `worker` / `readonly` roles, same FORCE RLS posture.
  The branch adds a `branch` axis on top, additively.
- **The offline queue is a queue.** A bounded (≤250 entry) AES-GCM-256 journal that drains and
  empties. It never answers questions and no other system reads it. That is Option C inside
  Option B, exactly as specified.
- **The contract seam exists.** `packages/contract/scripts/generate.mjs` emits a Dart SDK and a
  JSON manifest with a content hash. CI runs `generate:check` and `dart analyze`.
- **The idempotency substrate is industry-correct.** `tenant.business_command` carries
  `idempotency_key`, a sha256 `fingerprint`, `response_data`, `failure_code` and `expires_at`,
  and treats the same key with a different body as a conflict rather than a replay. This matches
  the IETF `Idempotency-Key` draft and Stripe's implementation.
- **The textual git conflict surface is one file** across `apps/umi-api` and `packages/`:
  `apps/umi-api/src/modules/cash/cash-register.service.ts`. The divergence is semantic, not textual.

The Flutter client is substantial: a 13-phase entry state machine, cursor-paginated branch-scoped
catalog with an LRU cache, server-authoritative cart with `expectedVersion` optimistic locking,
two-step preview→confirm checkout, and an ordered replay engine with canonical-JSON fingerprints,
provisional-ID mapping and conflict classification. 43 tests. No hardcoded tenant, no fake API
client in production wiring, no TODO in `lib/`.

---

## 3. Eight findings that block adoption

> **Path convention for this section.** Unless a line says otherwise, every file path in §3 refers
> to content **on the archived branch**, readable with
> `git show archive/umipos-integration-1e8b2f0:<path>`. Those files do not exist in `build-v3`.
> Paths that refer to `build-v3` are marked _(build-v3)_.

### F1 — POS sales are invisible to the kitchen

`apps/umi-api/src/modules/pos-checkout/pos-checkout.repository.ts` writes
`tenant.customer_order`, `tenant.order_item`, `tenant.payment`, `tenant.receipt_snapshot`,
`tenant.pos_committed_sale`, `tenant.inventory_reservation` and `tenant.pos_payment_attempt` —
and never `tenant.order_event`. `git grep order_event` across all POS modules returns nothing.

The KDS board reads `tenant.order_ticket`, whose cursor column is
`coalesce((select max(e.sequence) from tenant.order_event e where e.order_id = o.id), 0)`, and
polls the event stream at `apps/umi-api/src/modules/kds/kds.repository.ts:751` _(build-v3 —
the same reader exists on both)_. With no event row the cursor stays 0 and the sale never emits.

Our own analysis named this trap: _"si insertas la orden y olvidas el `order_event` de apertura,
la orden … es invisible en la cocina y en el dashboard. Silenciosamente."_ It breaks the milestone
we declared first: a POS order reaching the kitchen with no integration code.

### F2 — No loyalty hook

Zero loyalty references in any POS module. `order_id` never reaches `tenant.loyalty_visit` or
`tenant.loyalty_stored_value_ledger`, and `'pos'` is not in the `loyalty_visit.source` CHECK.
Our records call this _"la pieza de mayor valor del proyecto."_

### F3 — The POS request path bypasses RLS

| Module         | `pg.worker` (BYPASSRLS) call sites | Tenant-scoped call sites |
| -------------- | ---------------------------------- | ------------------------ |
| `pos-offline`  | 13                                 | 0                        |
| `pos-entry`    | 11                                 | 0                        |
| `devices`      | 3                                  | 0                        |
| `pos-cart`     | 1                                  | 2                        |
| `pos-checkout` | 1                                  | 1                        |
| `pos-catalog`  | 1                                  | 0                        |

Offline replay — where offline cash sales actually commit — runs entirely outside RLS. Online
checkout is better: its commit transaction does use `runWithTenant`. Our rule is _"El POS corre
bajo RLS. Tiene principal; no hay excusa."_

### F4 — `app.current_device` is never set

`apps/umi-api/src/shared/database/pg.service.ts:278` sets `app.current_branch` and nothing else;
`git grep current_device` over the branch's `apps/umi-api` and `packages` returns no match outside
SQL. Five gate-2f policies require `umi.current_device() is not null`. Under the `api` role those
tables would be permanently empty. The RLS is unexercised — which is exactly why F3 goes
unnoticed. _(build-v3's `pg.service.ts` sets neither GUC; both are branch additions and both must
be carried forward.)_

### F5 — No entitlement guard

No POS controller carries `@RequireProduct('pos')`. `pos-entry` and `pos-catalog` carry only
`AuthGuard` — not even `TenantAccessGuard`. Meanwhile `pos` **is** already a product key on
build-v3 (`packages/contract/src/entitlements.ts:22`) and is already in the `umi.feature.module`
CHECK (`docs/migration/build-v3/10_umi.sql:113`). The door exists and nothing walks through it.
Without the guard the product cannot be contracted, activated or billed.

### F6 — Three route lists, none generated from the others

1. `packages/contract/src/routes.ts`
2. `packages/contract/src/catalog.ts` → `routeCatalog`
3. a hand-typed Dart literal inside `packages/contract/scripts/generate.mjs:194`

Models are generated from Zod. Routes are typed by hand in a third place. The three already
disagree: `/api/auth/local/global-logout` is in (2) and (3) but not (1); `/api/auth/pos/logout`
is in (1) but not (2); two admin staff routes are in (2) but not (1). Our rule is
_"un tipo, un autor."_

### F7 — No version segment

Every route is `/api/pos/...`, `/api/auth/pos/...`, `/api/devices/...`. Our contract-seam document
makes the major in the path a hard rule and the fusion plan specifies `/api/v1/...`. The POS is
the one client that lives in the field on old versions.

### F8 — The Flutter production wiring is a stub shell

`apps/umi-pos/lib/bootstrap/composition_root.dart:55-56` ships, in production:

- `UnsupportedLocalDatabase` — `schemaVersion => 0`, `healthCheck` always
  `available: false, category: 'not_configured'`.
- `PlatformAdapters.unsupported()` — `UnsupportedReceiptPrinter`, `UnsupportedBarcodeScanner`,
  `UnsupportedCashDrawer`, `UnsupportedConnectivity`, `UnsupportedDeviceIdentity`,
  `UnsupportedAppLifecycle`. Online/offline state is inferred only from API call outcomes.
- `NoopTelemetryExporter` — telemetry is computed, sanitized, then discarded.

Also: no 401→refresh interceptor, so a 15-minute access token expiring mid-shift fails every
request until app restart; `flutter test` is red at the tip
(`apps/umi-pos/test/contract_and_widget_test.dart:10` asserts `'1.2.0'`, the generated constant is
`'1.6.1'`); release builds are signed with debug keys
(`apps/umi-pos/android/app/build.gradle.kts:30`); no CI job runs Flutter at all; and
`apps/umi-pos` has no `package.json`, so pnpm and turbo cannot see it.

Dead code to resolve: `EntryGateway.verifyPin` is implemented and never called;
`ApiReplayGateway.cursor` / `.conflicts` / `.diagnostics` are wired and never called;
`OrderedReplayEngine` is used only by tests; the localization key `catalogNotImplemented`
survives.

---

## 4. Three migration collisions

The gate migrations ALTER the frozen 2026-07-23 schema. Against build-v3 tip they fail:

| Migration              | Statement                                                                                 | Why it fails on build-v3                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `gate_2b_device_trust` | `alter table tenant.device add column updated_at …`                                       | build-v3 already has `tenant.device.updated_at`                                                                          |
| `gate_1c_identity`     | `create index session_device_idx on runtime.session (device_id) where revoked_at is null` | build-v3 has neither `device_id` nor `revoked_at`; it models sessions as `principal_type` / `principal_id` / `is_active` |
| `gate_1c_identity`     | `create unique index session_token_hash_uq on runtime.session (token_hash)`               | duplicates build-v3's `session_token_hash_uidx`                                                                          |

Everything else the gates touch is additive and clean: `tenant.staff` PIN columns,
`tenant.product` sku/barcode/tax, `product_branch_availability` status, and 25 new tables.

This is the whole reason for the schema decision in §5.

---

## 5. Decisions

| #   | Decision         | Choice                                                                                                                                                                                                                                                     |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Scope            | Everything through the Kalala pilot (fusion plan Gate 6)                                                                                                                                                                                                   |
| D2  | Schema authority | Fold POS DDL into `docs/migration/build-v3/*.sql`. build-v3 has not cut over, so nothing is applied — edit the CREATE statements instead of ALTERing them. Discard the branch's `supabase/` tree. Open `supabase/migrations/` only for post-cutover deltas |
| D3  | API versioning   | `/api/v1/...` for POS, device and POS-auth routes only. Other routes unchanged                                                                                                                                                                             |
| D4  | Device trust     | Signed per-command device proof (P-256), TEE-backed not StrongBox, not bound to user authentication, with a named key-loss recovery flow                                                                                                                   |
| D5  | Branch handling  | Never merge. Archive tag `archive/umipos-integration-1e8b2f0`, then salvage forward                                                                                                                                                                        |

**D2 is conditional.** Folding rather than altering is valid only while build-v3 is unapplied. If
the P7 cutover lands first, every folded column becomes a forward-only migration. Check this
before starting the schema work.

**D3 rationale.** Path versioning is the dominant public-API pattern (GitHub, Stripe, Twilio,
Google, Microsoft). Header versioning has a small latency edge and more testing friction. For a
field-deployed client with one major version, path wins on debuggability.

**D4 rationale and hazard.** Android Keystore keys are permanently and irreversibly invalidated
when the secure lock screen is disabled or reset, and auth-bound keys die when a new fingerprint
is enrolled. Field reports show Samsung devices losing keys after routine security patches. A POS
that stops charging because a manager changed the screen lock is a worse outage than the fraud the
key prevents. Therefore: TEE not StrongBox (StrongBox is documented as slower and more
constrained, and the pilot budget is 500 ms p95); no user-authentication binding; detect
`KeyPermanentlyInvalidatedException` / `UnrecoverableKeyException` and re-enroll through the
existing `runtime.device_enrollment_challenge` + `tenant.device.replacement_device_id` path with
manager approval, preserving the offline journal across the rebind.

---

## 6. The business model

The fusion plan schedules integrated card (Gate 7) **after** the pilot. The POS therefore records
payments it does not process, and captures no interchange. For reference, Toast's FY2025 results
put subscription ARR at $1,061M against payments ARR of $986M, at a 48 basis-point payments take
rate on $195B of volume — payments are roughly half of that business.

Deferring card is defensible only under a stated model. Choose one before Gate 4:

- **(A) Defensive attach.** The POS is a cheap or bundled seat. Its job is to make the loyalty and
  WhatsApp subscription un-churnable and to put `order_id` on every stamp. Success is measured as
  retention and expansion on existing products, never as POS revenue. Gate order stands.
- **(B) Payments business.** The POS exists to capture volume. Gate 7 moves ahead of Gate 6 and the
  pilot runs on integrated card from day one.

Three numbers are missing and are an exit criterion of Gate 2: monthly price per POS seat, hardware
bill of materials per branch (Android device, printer, drawer, terminal), and payback period.

---

## 7. Contradictions in our own records, resolved

The branch was judged against documents that disagree with each other. Judging work against a
moving target is unfair and creates rework. These are settled here.

### C1 — The live 11-schema model vs `umi` / `tenant` / `runtime`

`2026-07-22-umipos-resolucion-arquitectura.md` §2.2–2.3 says production is 11 schemas / 96 tables
and that _"El backend tiene 0 referencias a los esquemas `umi/tenant/runtime`. El modelo vivo es
el de 11 esquemas."_

**Measured on build-v3 tip, `apps/umi-api/src`:**

| Vocabulary                                       | SQL references                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `tenant.*`                                       | 299                                                                                                           |
| `runtime.*`                                      | 63                                                                                                            |
| `umi.*`                                          | 57                                                                                                            |
| `core.*`                                         | 2 — both in `shared/database/identity-normalization.integration.ts`, a pre-cutover helper against the live DB |
| `ops.*`                                          | 1 — a comment in `modules/kds/kds.repository.ts:861`, not SQL                                                 |
| `loyalty.` `comms.` `kitchen.` `device.` `grow.` | 0                                                                                                             |

**Resolution.** The statement was true of `main` on 2026-07-22 and is **false of build-v3 today**.
`umi` / `tenant` / `runtime` is the vocabulary. The 11-schema model is production-as-of-today and
ends at the P7 cutover. All POS work targets build-v3 and nothing else.

### C2 — "No webhooks, sync or reconciliation" vs Gate 7

`2026-07-22-umipos-resolucion-arquitectura.md` §5 principle 7 forbids all three outright. The
fusion plan Gate 7 requires provider webhook handling, settlement import and daily reconciliation.

**Resolution.** The prohibition is about **cross-plane integration between two Umi-owned
authorities** — that is the Option A signature. A payment acquirer is an external third party, not
a plane of our platform, and settlement reconciliation against an external ledger is unavoidable
in any card business. The rule is amended to read: _no webhook, sync or reconciliation between Umi
components_. Provider-facing integration is out of its scope.

### C3 — Employee PIN: audit or authorization?

`2026-07-14-umipos-analisis-integracion.md` §12.1 says _"El PIN del empleado es para auditoría, no
para autorización. El dispositivo autoriza; el PIN identifica."_ The fusion plan §3.3/§4.1 makes
the PIN authorize: fresh-PIN windows, an `fresh_pin_required` error code, a manager second PIN
issuing a one-use approval token bound to the command fingerprint.

**Resolution.** Both hold, at different layers, and the older sentence predates elevation grants.

- The **device** authorizes the _channel_: whether this terminal may transact at all, at this
  branch. It is not delegable and no PIN substitutes for it.
- The **PIN** authorizes the _privileged action_ — void, refund, discount over threshold, drawer
  open, offline sale over limit — and identifies the actor for audit.

The fusion-plan semantics are adopted. The branch already implements the substrate:
`runtime.elevation_grant` with `method in ('manager_approval','operator_pin')`.

### C4 — Offline card: undecided or decided?

`analisis` Q-01 leaves offline card open. The fusion plan §4.4 decides it.

**Resolution.** Two different questions were conflated.

- _May the POS record a manually confirmed SIM-terminal transaction while offline?_ **Decided:
  yes.** Integrated provider commands, refunds and all redemption stay blocked offline.
- _Does the POS process payments or only record them?_ **Still open.** This is not an engineering
  question. It is the business-model decision in §6 and it is an exit criterion of Gate 2.

### C5 — Does `pos` exist as a product key?

`2026-07-20-umipos-contract-seam.md` §7 says it landed. `2026-07-22-umipos-resolucion-arquitectura.md`
§2.5 says _"`pos` no existe todavía"_. Neither names a branch.

**Resolution, in code.** `packages/contract/src/entitlements.ts:22` reads
`export const PRODUCT_KEYS = ['cash', 'conversaflow', 'kds', 'dashboard', 'pos'] as const;` and
`docs/migration/build-v3/10_umi.sql:113` admits `'pos'` in the `umi.feature.module` CHECK. Both
are present on `build-v3` and absent on `main` (landed in `4b0e6e2`, 2026-07-20). The
contract-seam claim is correct for build-v3; the resolución sentence describes `main`. Since
everything stems from build-v3, **`pos` exists**. What is missing is the guard that uses it (F5).

---

## 8. Ownership

Re-authoring another engineer's work without saying so is how contributors are lost. The split:

| Work                                                           | Owner                                  | Why                                                                                  |
| -------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| `apps/umi-pos` Flutter client (Gate 3)                         | Original branch author                 | It is their design and their state machines. Gate 3 is a continuation, not a rewrite |
| Schema fold into build-v3 DDL (Gate 2.2)                       | Umi platform                           | Requires build-v3 history the branch does not have                                   |
| RLS, entitlement guard, `order_event`, loyalty hook (Gate 2.3) | Umi platform                           | Corrections against our invariants                                                   |
| Contract single-source and `/api/v1` (Gate 2.1)                | Umi platform, reviewed by client owner | It changes the client's generated surface                                            |

The archive tag preserves attribution for everything salvaged. Commits that port branch work
should say so in the message.

---

## 9. Where to go next

Reading order is in
[`2026-07-22-nexo-document-index.md`](2026-07-22-nexo-document-index.md). The execution sequence
is [`2026-07-23-umipos-fusion-implementation-plan.md`](2026-07-23-umipos-fusion-implementation-plan.md)
§5, Gates 0 through 6, amended by the decisions in §5 and §6 above.
