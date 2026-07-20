# build-v3 Gated Cutover — Roadmap & Status

**Status:** ACTIVE (living) · **Owner:** platform · **Last updated:** 2026-07-20 · **Scope:** internal-only
**Companion docs:** [`SECURITY_GATE.md`](./SECURITY_GATE.md) (the gate) · [`ORDER_MODEL.md`](./ORDER_MODEL.md) · [`backend-convergence-map.md`](./backend-convergence-map.md)

> **What this is.** The tracked roadmap for converging `apps/umi-api` **and** the data-migration
> mechanism onto **build-v3** (3 schemas: `umi` sealed SaaS/identity/entitlement, `tenant` café facts
> under RLS, `runtime` sealed machinery) and driving to a **coordinated production cutover**.
>
> **This is a living document.** Each phase below carries both its Definition of Done **and** its
> current status (merged PRs, the tracked preflight number, what's next). It is internal-only — it is
> *about* gates, convergence, and the transition. The architecture docs argue from v3 as the finished
> system; this one tracks the road there.

---

## 1 · The one invariant (Definition of Done — every phase)

> **`security_gate.sql` PASS · `reconcile_v3.sql` PASS (wherever data moves) · that phase's
> Deployment-Gate rows (`SECURITY_GATE.md §4`) green with recorded evidence.**
> **No phase advances on a red gate.**

And the measurable arbiter that ranks progress across all of it:

> **`sql-preflight.integration.ts` — 0 unresolved statements is the terminal target.**
> It `PREPARE`s every backend SQL statement against a live build-v3 DB; Postgres resolves every
> relation / column / function / `ON CONFLICT` at parse time. A statement that does not resolve is a
> statement that will 500 in production. This number, not a green test suite, measures how far the
> backend actually is from the schema.

---

## 2 · Why the spine is DDL-first (the lesson that reorders everything)

A 20-agent adversarial audit (2026-07-12) proved the backend↔schema convergence was **~89% broken**
while **every existing gate reported green**. `schema-parity` matched table *names* only (blind to
columns, quoted idents, functions); `security_gate.sql` checked structure, not content;
`reconcile_v3.sql` checked rows and money. All three were GREEN on a DB where the WhatsApp bot never
replied, every login returned `permissions=[]`, and umi-cash could not persist a customer session.

**Rule, on the wall: "the gate didn't flag it" is _not_ evidence that it's fine.**

Two consequences shape this roadmap:

1. The **`sql-preflight` gate** (`fa9277d`) was built as the real baseline. It found **191 of 215**
   backend statements did not resolve — the largest single cause being **488 `tenant_id` refs against a
   schema with zero `tenant_id` columns** (everything is `business_id`). This was in no prior phase and
   invisible to every gate.
2. The spine is ordered by **DDL truth**, not by code tidiness. We fix the schema deltas the backend
   depends on, then sweep code onto them, then complete features by domain. Progress is counted in
   preflight failures retired, not tests passed.

> **Supersedes.** This DDL-first spine replaces the earlier code-convergence-first plan, which framed
> "Phase 1" as a pure rename sweep. The audit proved that framing false: the name convergence and the
> feature rework are the *same job* for the order / identity / WhatsApp modules. The old numbering is
> retired — do not cross-reference it.

---

## 3 · The gate (three runnable instruments)

| Instrument | What it proves | Command | Current |
|---|---|---|---|
| **`sql-preflight.integration.ts`** | Every backend SQL statement resolves against live build-v3 (schema validity) | `cd apps/umi-api && npm run test:integration` | **160 / 215 unresolved** (as of PR #50) |
| **`security_gate.sql`** | RLS+FORCE, least-privilege grants, credential lockdown, data hygiene (24 structural + 3 behavioral) | `PGPORT=5233 psql -v ON_ERROR_STOP=1 -d umi_backfill_v3 -f security_gate.sql` → `SECURITY GATE PASSED` | **PASS** |
| **`reconcile_v3.sql`** | Backfill fidelity — counts + money invariants + **per-order / per-item** field-level equality | `PGPORT=5233 psql -v ON_ERROR_STOP=1 -d umi_backfill_v3 -f backfill/reconcile_v3.sql` | **PASS** |

Local DB targets (port `5233`): `umi_prod_snapshot` = source truth · `umi_backfill_v3` = backfill
result (preflight + reconcile run here) · `umi_build_v3` = pristine from-scratch DDL (`99_verify`).

Preflight setup note: `npm run test:integration` needs vitest's native `rollup.darwin-arm64.node`
un-quarantined on macOS (`xattr -dr com.apple.quarantine node_modules`) and
`DATABASE_URL_WORKER=postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_backfill_v3`.

---

## 4 · The spine (P0 → P7)

Legend: ✅ done · 🔄 in flight · ⏳ pending · ◑ partial

### P0 — Gate repair ✅ DONE
**Goal.** Make the real baseline measurable before touching anything else.
**Delivered.** `sql-preflight.integration.ts` (`fa9277d`); `security_gate.sql` extended to 24 + 3;
`reconcile_v3.sql` extended from rows+money to **per-order / per-item** field-level checks.
**DoD.** All three instruments run locally and produce a trustworthy number. ✅

### P1 — DDL delta (atomic) 🔄 IN PROGRESS
**Goal.** Reshape the schema so the backend's SQL *can* resolve — applied as one atomic migration set.
**Scope.**
- ✅ **Order cluster** — `PR #49` (`fed8c08`). `tenant.customer_order` / `order_item` / `order_event`
  (+ `payment`), **derived** order total (no stored `total`), void model (`voided_at`/`void_reason` +
  immutability trigger), `order_total` / `order_ticket` views. See `ORDER_MODEL.md`.
- ⏳ **DB functions** `tenant.normalize_phone` / `normalize_identity` (3 × `42883` today).
- ⏳ **`tenant.contact` unique constraint** (resolver `ON CONFLICT` = `42P10`; 0 data violations).
- ⏳ **`runtime.outbox_event` exactly-once columns** (`event_type`/`aggregate_id`/`idempotency_key` +
  unique index — the rename dropped exactly-once delivery).
- ⏳ **`runtime.conversation_turn` RESTORE** (5 live read paths; it is load-bearing, not telemetry).
- ⏳ **customer-session home** (`runtime.session` has no place for a `tenant.customer`; `app` CHECK
  excludes `'cash'`).
- ⏳ **hours** — typed `tenant.business_hours` + fold `open_hours`; drop the `business.config` read.
- ⏳ **identity dissolution** — `contact_identity` / `channel` / `whatsapp_number` → the build-v3 model.
- ⏳ **`90_rls.sql` booby-trap** — delete the hard-coded child-list rows in the *same* commit that adds
  `business_id` to `station`/`order_event` (else `42710` aborts the whole RLS rebuild).
- ⏳ **Backfill rewrite to PRESERVE** — extend the reconcile to field-level for each new carry.

> **Why P1 is "in progress" while P2 already shipped:** the order cluster was the cleanly-separable
> slice and landed first; the mechanical name sweep (P2) was independently safe and ran ahead. The
> remaining P1 deltas are entangled with P3/P4 by module and land alongside them — this spine is a
> dependency map, not a strict serial gate.

**DoD.** Pristine `umi_build_v3` builds from scratch (`99_verify: OK`); the P1 deltas each retire their
preflight failures; `security_gate.sql` + `reconcile_v3.sql` stay PASS.

### P2 — Mechanical name sweep ✅ DONE
**Goal.** `tenant_id` → `business_id` across the backend (488 refs; the single largest preflight cause).
**Delivered.** `PR #50` (`f843e2e` / `b83c5c3`) — 387 renames across 37 files. **Preserved:** the
`app.tenant_id` GUC (`pg.service.ts` dual-sets it with `app.current_business`) and the **frozen iPad
`device_session.tenant_id` wire key** (now sourced from the renamed column). tsc clean, 325 tests pass.
**Result.** Preflight **191 → 160** (only 31 retired directly — most `tenant_id` refs sit in statements
that *also* hit a missing table/column, so they clear only when P1/P3/P4 land).
**⚠️ Invariant.** The worker pool is `BYPASSRLS`; dropping one `business_id` predicate = a **silent
cross-tenant read** nothing catches. Every touched query keeps its predicate.

### P3 — Identity / RBAC / WhatsApp / entitlement / POS 🔄 IN FLIGHT
**Goal.** Complete the request-path features on the build-v3 base.
**Scope & status.**
- 🔄 **Entitlement single-source** — read `umi.effective_entitlement` (security_invoker, RLS-scoped)
  instead of raw `subscription_item`; keep `@RequireProduct` + `isProductStatusActive` from
  `@umi/contract`. In flight on `feat/phase3-entitlement-pos` (`e700f95`).
- 🔄 **POS server seat** — `pos` product + write endpoints, entitlement-guarded, zod-validated
  (`4b0e6e2`; contract-seam design). [[project_umipos_nexo_integration_2026_07_14]]
- ⏳ **Identity resolver** — `provider='twilio'` (the channel-type CHECK excludes `'whatsapp'`);
  `identity.resolver.ts` replaces the dropped `resolve_contact` RPC.
- ⏳ **RBAC seed** — `super_admin` never existed in `umi.role`; the map is 0-row with no seed → every
  login `permissions=[]`. Seed **after** `backfill_identity`.
- ⏳ **WhatsApp sender fix** — code filters `sender='user'` but the CHECK is
  `(customer,bot,staff,system)` → the bot is silently dead. Plus `conversation_state` seeding (0 rows
  vs 11 open conversations → infinite requeue).
- ⚠️ **Staff writes** — route to `workerTx` with an explicit `business_id` predicate. **Never**
  `grant insert/update on umi.user to api` (no RLS on `umi.user` → cross-tenant write primitive).

**DoD.** Entitlement returns the same set as `product_instances` for the seeded cafés; login yields real
permissions; the bot replies (add it to the smoke test — its failure is silent); preflight retires the
identity/entitlement failures; gate stays green.

### P4 — Conversation pipeline / hours / birthday / KDS / order repos ⏳ PENDING
**Goal.** The remaining domain rewrites onto the new shapes.
**Scope.** `conversation_turn` read paths (replay/crash guard, `merged_user_text`, debounce, supersede);
`GET /hours` off typed `business_hours`; birthday_reward as a per-card **entitlement**, not a
per-business rule; **KDS** reproduce the frozen iPad JSON over the redesigned ops tables (+ pairing
`code` → `pin_hash`/`pin_salt`); **order repos** (`kds`/`orders`/`customers`) rewritten to
`tenant.customer_order` (retires the 11 `tenant.order` failures).
**DoD.** Preflight → **0 unresolved**; conversation/hours/KDS/order behavioral checks green; gate green.

### P5 — 4-repo lockstep slug release ⏳ PENDING
**Goal.** Route businesses **by id**; drop `slug` — but **keep `tenant.business.handle`** (the `.pkpass`
files already on customers' phones bake `/api/{handle}/passes/apple`; dropping the URL kills wallet-pass
updates forever). Requires a coordinated `@umi/contract` **MAJOR** release across the 4 consumers.
**DoD.** All 4 repos build against the new contract; wallet-pass URLs still resolve.

### P6 — Deployment-gate provisioning (`SECURITY_GATE.md §4`) ◑ PARTIAL
**Done:** D1 (boot-guard role reconciliation, `PR #51`) · D2 (dual-GUC expand/contract) · D11 (auth
substrate worker-only + static AST gate, `PR #51`).
**Pending:** D3 pooler SET-LOCAL isolation · D4 TLS verify-full (VPS→Supabase) · D5 SCRAM verifiers on
login roles · D6 pg_hba/network · D7 extensions · D8 no FDW remnants · D9 secret rotation + history scrub
([[project_cred_exposure_2026_06_20]]) · D10 request-path log redaction.
**DoD.** Every §4 row checked with recorded evidence.

### P7 — Cutover rehearsal → production cutover ⏳ PENDING
**Goal.** The coordinated one-shot flip (downtime OK, same DB, no split-brain).
**Mechanism — FDW replay.** Port the 7-file backfill from local `INSERT…SELECT` to `postgres_fdw`
replay against prod source `xbudk`, preserving run order (vertical → 6 domains → cross-FK/RLS) and
reusing `reconcile_v3.sql` unchanged. **D8**: zero foreign servers/user-mappings remain after replay.
**Rehearsal.** On a throwaway prod clone: apply build-v3 → FDW backfill → gate → reconcile → browser
smoke both clients (umi-cash register→scan→topup→redeem; dashboard; **and the WhatsApp bot**).
**Cutover.** Gate + reconcile run **against prod** and pass **before** the flip; the app repoints
`DATABASE_URL_APP/_WORKER` at the `api`/`worker` login roles (env change) and drops `app.tenant_id` from
`runWithTenant`.
**DoD.** Prod `security_gate.sql` PASS; both clients live on build-v3.

---

## 5 · Current baseline (2026-07-20)

- **`build-v3` HEAD:** `8be72ed` (PR #51). Merged in order: **#49** order cluster → **#50** mechanical
  sweep → **#51** D1/D11 gate.
- **In flight:** `feat/phase3-entitlement-pos` (5 commits ahead) — entitlement single-source + POS seat
  (P3), not yet merged.
- **Preflight:** **160 / 215** unresolved (as of PR #50).
- **Gate:** `security_gate.sql` PASS · `reconcile_v3.sql` PASS on the snapshot backfill.

### The 160 remaining, mapped to phases

| Error | Count | What | Owning phase |
|---|---:|---|---|
| `42P01` undefined_table | 11 | `tenant.order` → `customer_order` | P4 (order repos) |
| | 16 | `contact_identity` / `channel` / `whatsapp_number` dissolved | P3 (identity) |
| | 5 | `open_hours` → `business_hours` | P4 (hours) |
| | ~4 | `birthday_reward` (2), `conversation_turn` (1), `outbox_event` (1) | P1 / P4 |
| `42703` undefined_column | 121 | non-`tenant_id` drift: `slug`, `visits_required`, `total_cents`/`details`, outbox `run_at`/`published_at`/`max_attempts`, `born_at`, `contact_id`, `subscription_item.status` | P1 / P3 / P4 |
| `42883` undefined_function | 3 | `normalize_phone` ×2, `normalize_identity` | P1 (DB functions) |

Plus **47 interpolated statements** that preflight cannot cover (counted, not hidden — they need
manual/live-path validation). Exact splits live in the `npm run test:integration` output.

---

## 6 · Out of scope / accepted residuals

- **Per-policy `session_can_access_business()`** — rejected as over-engineering for 5 cafés; the GUC
  choke-point suffices. Revisit if tenant count / role complexity grows.
- **`runtime.otp`** — stays as an unused future table (WhatsApp-OTP).
- **Outbound-message enqueue** — worker-only until a SECURITY DEFINER stamps origin `business_id`
  (`api` has no `runtime.outbox_event` DML by design).
- **`umi.user` row enumeration** — credentials column-locked; identity columns readable cross-tenant
  unless routed through the scoped staff join. Low sensitivity.

---

## 7 · Re-run cadence

- **Every schema / grant / backfill change:** `security_gate.sql` + `sql-preflight` in CI (blocks merge).
- **Every phase:** rebuild `umi_backfill_v3` via `backfill/00_run_backfill.sh`, then gate + reconcile +
  preflight; record the new preflight number in §5.
- **Before every cutover rehearsal:** full 19-agent audit + Deployment-Gate evidence refresh.
