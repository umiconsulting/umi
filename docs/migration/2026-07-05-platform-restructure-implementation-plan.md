# Umi Platform Restructure — Implementation Plan (DB + Backend)

**Date:** 2026-07-05
**Status:** Accepted plan. Companion to the domain model in [`docs/architecture/2026-07-05-platform-domain-model-synthesis.md`](../architecture/2026-07-05-platform-domain-model-synthesis.md) — that doc is the *what/why*; this is the *how*.
**Framing (owner-confirmed):** the platform DB is a **total free rebuild** — no live-data-preservation requirement, downtime is fine, **loyalty included** (no frozen tables). The **one** thing that must hold at the end: umi-api exposes stable **product write endpoints** (`@umi/contract`) that **both** the umi-cash frontend repo **and** the dashboard write through. Everything below is engineered against that single success criterion.
**Provenance:** synthesized from a 6-agent workflow (target-schema+delta · backend coupling · migration mechanics · DDL plan · backend PR plan · principal-architect red-team). The red-team's fixes are baked into the phases below, not appended.

**Progress (updated 2026-07-05):** **PR0 (#35)** contract product-write schemas · **PR1 (#36)** entitlement hoist · **P0/P1 DDL rebuild (#37)** — **all MERGED.** The rebuild was authored into **`docs/migration/build-v2/`** (the current untracked `build/*.sql` is left as the *old* canonical until cutover) and driven **GREEN on the local smoke DB** (`umi_rebuild_smoke`, PG18:5233), then reviewed (4-agent DDL critique) + fixed + merged. **Next code phase: PR2** (backend rename sweep). The **live-apply** — running `build-v2` on the platform DB `xbudk` (drops the old 9 schemas) — remains a **gated go/no-go, not yet done**.

---

## 0. Success criterion (the invariant)

At the end, **umi-api owns the data; the dashboard and the umi-cash frontend are both thin clients** writing through one contract-typed endpoint surface (cash/loyalty ops + catalog/menu + orders). The stable boundary is `@umi/contract`, **not** any DB shape — which is why the DB underneath is a free rebuild.

**✅ Both hinge-facts verified (2026-07-05):**
1. **umi-cash reads *and* writes the platform DB** (`xbudknbimkgjjgohnjgp`). Empirical: `loyalty.cards` latest write 2026-07-05 20:16 UTC; cash DB `rrkzhisnadfrgnhntkiz` is **INACTIVE/paused** (Supabase CLI); local `.env` → platform; real prod env is **VPS-managed** (the committed `.env.vercel.production` → rrkz is a stale snapshot). Prisma `datasource.schemas = [core, grow, loyalty, ops]`. → **No split-brain; PR7 = direct-Prisma-to-platform → umi-api-endpoints-to-platform, same DB.**
2. **umi-cash consumes `@umi/contract` "the api one"** — built dist, server-side, `import type` (its write paths are server-side Next.js API routes, so zod-at-runtime is fine; the dashboard's source-alias / zero-dep-`routes` gymnastics don't apply). umi-cash is Vercel/npm, **outside** the pnpm workspace → can't use `workspace:*`, so **commit contract's dist** (the `@umi/tokens` pattern + a CI freshness gate) and reference it `file:../../packages/contract`. *(If umi-cash later moves onto the VPS/Docker/pnpm pipeline like the api, it joins the workspace and uses `workspace:*` verbatim.)*

**End-state trajectory (supersedes blueprint §8's "umi-cash is permanent"):** the success criterion above is the **interim** — both clients on umi-api endpoints (env on the VPS). **Eventually** the umi-cash *repo* retires, everything folding into the dashboard: the **operator** half becomes RBAC- + product-gated dashboard modules (register/POS · members · gift-cards · loyalty settings — backend already live in umi-api `modules/cash/*`, per blueprint §8.3); the **customer** half shrinks to **register-for-wallet + download the pass**, served as a public route. **Hard physics constraint (blueprint §8.6):** printed in-store QR codes point at `cash.umiconsulting.co/{slug}/customer` — that URL must keep working even after the repo is gone, or every tenant's printed QR breaks. **For now it just redirects to the new register-wallet route** (keep the original URL if possible); the final shape of the endpoint can change behind that redirect. **Cookie landmine:** operator vs customer sessions need distinct cookie names, with the operator cookie scoped to the console host (not `.umiconsulting.co`).

---

## 1. Strategy — rebuild, not incremental

Author the target directly into a new `docs/migration/build/*.sql` set and cut over. The incremental Phase-A–L ceremony in the 2026-06-16 runbook (`_migration.*` id-maps, `SUM(balance)` reconciliation stops, per-phase rollback tags, the Phase-G `platform→core` rename) exists **entirely** to preserve/reconcile live money while the old DB keeps serving. With downtime fine and data preservation optional, all of it is dead weight. **Author the final schema names up front → no Phase-G rename; drop the old 9 schemas; rebuild loyalty in the same pass.**

---

## 2. Target — 4 schemas, `build-v2/*.sql` layout (✅ authored + green in #37)

Schemas realize **authorship** (synthesis §7), not domain: `umi` (sealed) · `tenant` (RLS, `login`/`channel` exceptions) · `runtime` (sealed machinery) · `observability` (sealed, until OTel → 3) · `_migration` (P2 only). *(`vault` deferred — secrets sealed via table-level REVOKE inside `tenant` for now.)*

| `build-v2/` file | Owns |
|---|---|
| `00_foundation.sql` | `drop schema … cascade` (old 9, no-op on a fresh DB); `create schema umi/tenant/runtime/observability`; roles (`umi_app` nosuperuser/nobypassrls, `umi_worker` bypassrls, `umi_readonly`); helpers in `tenant.*` (`rls_tenant_check`, `current_tenant_id/person_id`, `can_access_tenant`, `block_append_only_mutation`); **per-channel `normalize_identity(channel,value)`** (not one `normalize_phone`); **inline composite FKs** (no `add_composite_fk` helper); **No `SECURITY DEFINER` RPCs**; `_migration` id-maps. |
| `18_umi.sql` *(runs after `11_tenant_core` — umi FKs `tenant.tenant`)* | `subscription`, `subscription_item` (`product_key ∈ {cash,conversaflow,kds,dashboard,pos}`), `invoice` (new, `idempotency_key NOT NULL`, writers off until billing decision), `prospect`, `prospect_event` |
| `11_tenant_core.sql` | org tree `tenant`→`business`(`menu_source`)→`branch`; identity graph `contact` + `contact_identity`(`UNIQUE(tenant_id,channel_id,normalized_value)` + partial `UNIQUE(…,external_id)` — review fix) + `channel`(global ref); `customer`(absorbs `loyalty.accounts`), `customer_note`; principals `login`(RLS exception) + `tenant_access`(role enum, collapses 5 RBAC tables) + `staff`; `password_reset_token`, `integration_token`(sealed) |
| `12_tenant_commerce.sql` | `product`(+`source`), `product_category`, **`product_option_group` + `product_modifier` (TWO relations)**, `order`(`channel_id`), `order_item`(+per-line `kitchen_status` — review restored), `order_event`(absorbs order-level kitchen_status+cancellation; **NOT a ledger — no trigger**; `event_kind` CHECK), `payment`/`refund`(+`currency`, now load-bearing) |
| `13_tenant_loyalty.sql` | `card`(identity-only), `card_ledger`(append-only,`idempotency_key`), `visit`, `reward_rule`, `reward_redemption`, `birthday_reward`(kept distinct), `gift_card`/`gift_card_ledger`, `wallet_pass`, **`loyalty_settings`**(review add: `card_prefix`/`birthday_reward_enabled`/… ← `loyalty.programs`). **Dropped:** `balances`, `wallet_transactions`, `automation_rules` |
| `14_tenant_comms.sql` | `conversation`(durable thread only), `message`, `knowledge_document`/`knowledge_chunk`. Dropped: `memory_items`, `tool_calls`, `daily_summaries` |
| `15_tenant_ops.sql` | `open_hours`/`hours_override`, `device`, `station`(folds groups/assignments), `whatsapp_number`(collapses channels+channel_accounts) |
| `16_runtime.sql` | `outbox_events`, `inbound_events`, `idempotency_keys`, `dead_letters`; `session`(merge core+device, hash token, `principal_type`); `pairing`, `otp`; `nudge_sent`; `conversation_turn` + **`conversation_state`** (cart/CAS split out of `conversation`); `pass_device`; **`device_event`**(review add ← `device.events`). Dropped: `jobs`/`job_attempts` |
| `17_observability.sql` | `config_change`(from audit_log, real `login_id` actor + kept `actor_slack_id`), `conversation_outcome`(analytical). Rest → OTel/delete |
| `90_rls.sql` | seals + FORCE RLS + append-only triggers + fail-closed gate (**XOR-allowlist** + **`channel` SELECT-only** — review security fix) |
| `99_verify.sql` | structural gate (tenant_id · RLS+FORCE+policy · **2** append-only triggers · composite PK) — data checks deferred to P2 |

Run order (encoded in `00_run.sh`, filename = dependency order): `00_foundation → 11_tenant_core → 12 → 13 → 14 → 15 → 16 → 17 → 18_umi → 90_rls`, then `99_verify`. Every `tenant.*` table keeps the structural-isolation invariant: surrogate `id`, composite **PK `(tenant_id, id)`**, every FK inline `(tenant_id, fk)→(tenant_id, id)`.

---

## 3. Current → target delta (the moves)

~70 tables across 8 schemas → the set above. Headline transforms: `core.people`→`tenant.customer` (staff/login split out); `core.contact_methods`→`tenant.contact_identity` (+ new `contact` node, folds `contact_merge_candidates`+`external_refs`); `core.locations`→`tenant.branch`; `ops.businesses`→`tenant.business`; `loyalty.accounts`→`tenant.customer`; `loyalty.points_ledger`→`tenant.card_ledger`; `loyalty.cards`→`tenant.card` (drop balance/visit caches); `comms.conversations`→ split `tenant.conversation` + `runtime` cart/CAS; the 5 RBAC tables → `tenant.tenant_access`+enum; `grow.*`→`umi.*`; `queue.*`→`runtime.*`; `device`+`kitchen`→`tenant.*`. **Deletes:** `balances`, `wallet_transactions`, `automation_rules`, `memory_items`, `tool_calls`, `jobs`/`job_attempts`, `feature_flags`, `programs`(folded). Full per-table table in the workflow journal.

---

## 4. DDL rebuild — phases (with red-team fixes baked in)

Each phase edits the `build/*.sql` set, runs locally via `00_run.sh` against the smoke DB (PG18:5233) until `99_verify`+`90_rls` are green, then applies to the live project via `supabase db query --db-url "$DIRECT_DATABASE_URL" -f build/NN.sql`.

**P0 — ✅ DONE (#37), green on the smoke DB.** Author the 4-schema set, drop the old 9. Files `build-v2/00_foundation` → `17_observability` + `18_umi`. Fixes folded in (all verified):
- **`product_option`→ TWO relations** (`product_option_group` = choice constraint, `product_modifier` = name/price) — the reality-first single-table fold contradicts synthesis §8 ("keep option-group vs modifier distinct"). *(Or adopt the Zettle `variants` mirror form; do not author the fold.)*
- **Per-`channel` normalizer dispatch**, not one `normalize_phone` — `normalization_rule` lives on `channel` (E.164 for phone, lowercased for email). A single phone normalizer silently fails to dedup email/IG `normalized_value`, breaking the `UNIQUE(tenant_id,channel_id,normalized_value)` key.
- **No `SECURITY DEFINER` `resolve_contact`/`award_points` RPCs.** They're bypass-RLS holes, and PR4 replaces them with a TS resolver anyway — don't author dead, unsafe code. Build the resolver first.
- **Optionally set role `search_path = tenant, runtime, observability, umi`** so the PR2 sweep touches only genuinely cross-schema identifiers (collapses ~463 edit sites to a handful). Trade-off: reverses the "fully-qualified everywhere" stance — safe here (no cross-schema table-name collisions in the target), and it de-risks the one-shot cutover. Recommended.

**P1 — ✅ DONE (#37), green on the smoke DB.** Seals + FORCE RLS + append-only triggers + the gate. `90_rls.sql` retargeted to `tenant.*`; `REVOKE ALL ON SCHEMA umi/runtime/observability FROM umi_app,public`, `USAGE` to `umi_worker` only; recreate the `self_access` (`tenant.login`) and `global_catalog_read` (`tenant.channel`) exceptions; column-REVOKE `login` secrets after the blanket grant; append-only triggers on `card_ledger`+`gift_card_ledger` (**exactly 2**).
- **Gate fix (H2):** phrase check #2 as **"every `tenant.*` table is EITHER (`tenant_id` present AND `tenant_isolation` FORCE) OR in the explicit `{login, channel}` allowlist — else FAIL."** The naive "every table *with* `tenant_id` has FORCE" lets a tenant-data table that's *missing* its `tenant_id` escape both arms → cross-tenant-open with a green gate.
- `99_verify` CHECK 4 asserts the append-only trigger count **against the authored ledger set**, not a hand-maintained `3→2` literal. Re-running `90_rls` against the live project is the **go/no-go**.

**Review fixes landed (#37, 4-agent DDL critique + CodeRabbit — model verdict FAITHFUL, RLS strong):** contact_identity partial `UNIQUE(…,external_id)` (dedup hole where NULL `normalized_value` escaped, **proven**); `channel` policy → SELECT-only + write REVOKE (`for all using(true)` let `umi_app` DELETE the global catalog, **proven fixed**); added `runtime.device_event` + `tenant.loyalty_settings` (dropped facts); restored `order_item.kitchen_status`; `10_umi`→`18_umi` rename (filename = dep order); `event_kind` CHECK; `invoice.idempotency_key NOT NULL`; `login.contact_id` grant; tenant-scoped ledger indexes. *(Carry the `channel` DELETE fix to the old `build/90_rls.sql` too if it's ever reused.)*

**P2 — optional continuity backfill.** Only if the one live tenant's data is worth carrying. Adds `20_fdw` + `30–3x_backfill_*` before `90_rls`: federate `contact_methods`→`contact`+`contact_identity`; `people`→`contact`+`customer`+`staff`; replay `points_ledger`+`wallet_transactions` into **one** `card_ledger` (dedup by `idempotency_key`, never materialize a running total). Skipped for a clean cutover.

---

## 5. Backend — sequenced PRs (corrected order)

### Per-PR execution loop (test-locally-first is a hard gate)

Every phase/PR runs this loop — **local verification must pass before the branch is pushed**, never "push and let CI find it":

1. **Author** on an isolated branch (`feat/<phase>`), staging only that phase's paths.
2. **🧪 Test locally first (GATE — do not push until green):**
   - `pnpm --filter <pkg> typecheck && build && test` for every package/app the diff touches;
   - build the affected frontend(s) (`pnpm --filter @umi/dashboard build`) and assert invariants (e.g. **zod-free bundle**);
   - for DB phases: rebuild the canonical schema on the local smoke DB (`build/00_run.sh`) and run the **RLS gate** (`90_rls`) + `99_verify` — both fail-closed;
   - for behaviour changes: drive the flow with the `verify` skill (and `staging-validation-runner` for DB-touching PRs). **PR2 specifically:** full umi-api vitest (~295) + dashboard build + local canonical rebuild + RLS gate, all green locally, before push.
3. **Push + open PR.**
4. **Review** — ultracode adversarial review (**saved as a PR comment**) + CodeRabbit auto-review.
5. **Fix → re-run the step-2 local gate → commit.**
6. **Merge** once local gate + CI + reviews are all green; delete the branch; sync `main`.

*(Applied to PR0 (#35) and PR1 (#36): contract typecheck/build/tests, umi-api typecheck + specs, dashboard build + zod-free check — all locally before push.)*

**Cutover model:** one coordinated rename deploy (PR2, downtime OK, loyalty included, no dual-read); reshape + new writers land on the renamed base; both frontends repoint onto the stable contract last.

- **PR0′ ✅ MERGED (#35) — contract from reality.** *(#35 landed the schemas/routes/entitlements source; the **dist-commit + `file:` dep are deferred to PR7** when umi-cash actually consumes them — no artifacts before a consumer.)* Enumerate the **27 umi-cash Prisma write payloads** and derive the `@umi/contract` write schemas from them (not guessed): `ScanCardRequest`, `TopupRequest`, `RedeemRequest`, `PurchaseRequest`, `IssueGiftCardRequest`, `RecordVisitRequest`, `UpsertProductRequest`, `CreateOrderRequest`, plus read models (`Contact`/`ContactIdentity`/`Channel`/`Customer`/`Product`/`Order`/`Payment`/ledgers). **umi-cash consumes it "the api one"** — server-side built dist, `import type`: commit `@umi/contract`'s dist (`@umi/tokens` pattern + CI freshness gate) and reference it `file:../../packages/contract` (umi-cash is outside the workspace → no `workspace:*`); zod-at-runtime is fine server-side. Files: `packages/contract/src/{schemas,routes,entitlements}.ts`, root `.gitignore` (un-ignore `packages/contract/dist`), a `contract-dist-ci` freshness gate.
- **PR1 ✅ MERGED (#36) — entitlement hoist.** Move `ProductKey`(+`pos`)/`PRODUCT_ACTIVE_STATUSES` into `@umi/contract/entitlements`; `auth/entitlement.guard.ts`, `auth/require-product.decorator.ts`, `tenants/module-registry.ts`, `umi-dashboard/src/lib/module-registry.js` (+ `products-billing.jsx`, review-found 4th copy) import from it. Small, safe, pre-rename.
- **P0 + P1 ✅ MERGED (#37)** (DDL, §4) — authored in `build-v2/`, green on the smoke DB, reviewed + fixed. **Live-apply gated.**
- **PR2 — ⏭ NEXT — the coordinated rename sweep + pool reassignment.** Rewrite the ~463 schema-qualified identifiers (55 files) to the 4-schema target via a **reviewed per-relation mapping** (not blind find/replace; `queue.`→`runtime.` uses a 5-table allowlist to avoid BullMQ `queue.add`/`.register` false positives). Forced real changes riding along: delete the `cash-write.repository.ts` double-cache writes (`wallet_transactions`/`balances`/`cards.balance_cents`), balance = `SUM(card_ledger)`, add `idempotency_key` to every ledger insert; absorb kitchen_status/cancellation into `order_event`.
  - **Critical fix (H1):** the rename does **not** switch connection pools. `runtime.sessions`/`otp`/`pairing` and `observability.config_change` are **sealed from `umi_app`**, but session validation, KDS pairing, and owner-console audit run on the `umi_app` pool today → `permission denied for schema runtime` at runtime, invisible to mocked vitest. **Reassign those repos to the worker pool (`workerTx`) in this PR.**
- **PR3 — module reshaping** (on the renamed base, no query changes): split `conversations`→`messaging`+`ordering`; `OrderLocationResolver`→`tenants`; `hours`+`voice`→`tenant-settings`; `lifecycle`→`cash`; `customers`→`insights`; cart/`conversation_turns` repos re-labeled `runtime`.
- **PR4 — new writers.** identity-graph TS resolver (`contact`/`contact_identity`/`channel`, deterministic-first, replaces `resolve_contact`; spec = `customer-identity-resolution` skill); menu `source` authoring (promote from `metadata` to a column; `markUnavailableExcept` becomes `menu_source`-conditional); POS `payment`/`refund`/channel-stamped-order writers.
- **PR5 — expose the product write endpoints.** Wire PR0′ contracts to handlers in `modules/cash`+`modules/ordering`: `/cash/{scan,topup,redeem,purchase,gift-cards,visits,rewards}`, `/catalog/products`, `/orders` — each zod-validated + entitlement-guarded.
- **PR6 — dashboard repoint** onto the endpoints (already contract-wired; lower risk).
- **PR7 — umi-cash repoint (the decommission).** Replace the ~27 Prisma writes with `authed-fetch` to PR5 endpoints (types from `@umi/contract`). umi-cash already reads **and** writes the platform DB (verified §0), so this is a same-DB Prisma→endpoint swap — **no split-brain**. Keep only the `wallet_pass` mirror writes (umi-cash is its sole writer). Grep-assert no residual `prisma.` in write routes. **This completes the interim (both clients on the API).** The *eventual* step retires the repo: operator half → RBAC- + product-gated dashboard modules (blueprint §8.3); customer half → a public **register-wallet + download** route kept reachable at `cash.umiconsulting.co/{slug}/customer` for printed-QR physics (blueprint §8.6). Blueprint §8's "umi-cash is permanent" is superseded.

---

## 6. Risk register + go/no-go (from the red-team)

| Sev | Phase | Risk | Fix (baked into the plan) |
|---|---|---|---|
| **H1** | PR2 | `runtime`/`observability` reads (sessions/otp/pairing/audit) sealed from `umi_app` → login/pairing/audit throw at runtime; mocked vitest won't catch it | Route those repos through the **worker pool**; add a live `umi_app`-pool auth + KDS-pairing `verify` before merge |
| ~~H2~~ **✅ #37** | P1 | `tenant.*` missing `tenant_id` → cross-tenant-open, gate green | **Done + proven:** XOR-allowlist gate in `build-v2/90_rls.sql` (injected orphan caught) |
| ~~H3~~ **resolved** | PR7 | ~~split-brain / contract unresolved~~ | **Verified away (§0):** umi-cash already reads+writes the platform (same DB), consumes `@umi/contract` "the api one". |
| ~~M~~ **✅ #37** | P0 | `product_option` fold contradicts synthesis §8 | **Done:** `product_option_group` + `product_modifier` (two relations) |
| ~~M~~ **✅ #37** | P0 | single `normalize_phone` can't normalize email/IG | **Done:** `normalize_identity(channel,value)` per-channel dispatch |
| ~~M~~ **✅ #37** | P0 | bypass-RLS `SECURITY DEFINER` RPCs | **Done:** not authored (TS resolver → PR4) |
| **M** | PR2 | 463 hand-qualified identifiers, fragile | Set role `search_path`; shrink edit surface *(decide before PR2, §7.6)* |
| ~~M~~ **✅ #35** | PR0′ | contract schemas guessed vs real payloads | **Done:** derived from the real cash DTOs |
| **M** *(new #37)* | PR2 | sessions/otp/audit moved to sealed `runtime`/`observability` — the **umi-cash + umi-api session validators must hash-on-lookup** (token now hashed) and run on the worker pool | Fold into the PR2 pool-reassignment (H1) |

**Go/no-go per phase:** **P0** — `00_run.sh` assembles clean, every `tenant.*` has composite PK, all FKs resolve, no old-schema identifier survives, option/modifier are two relations. **P1** — `90_rls` exits 0 with the XOR-allowlist check, `99_verify` `INTEGRITY GATE PASSED`, exactly 2 append-only triggers, secret-col REVOKE re-applied after grant. **PR2** — full vitest green **and** live `/auth/login` + KDS pairing succeed on the `umi_app` pool against the sealed schemas; `SUM(card_ledger)` == balance read. **PR4/5** — unknown-phone scan → contact created, second scan resolves same contact, `idempotency_key` replay = no double-write. **PR6/7** — dashboard build + browser topup hits `/cash/topup`; umi-cash end-to-end register→scan→topup→redeem with no residual Prisma write import and reads+writes on the **same** DB.

---

## 7. Open decisions (carried from the synthesis §10 — none block P0)

1. In-house billing vs external processor → shapes `umi.invoice` (ship the table, writers off until decided).
2. `vault` schema vs table-level `REVOKE` for secrets.
3. Tenant roles authored or fixed → `tenant_access`+enum is the provisional verdict.
4. `tenant` vs `restaurant` schema name.
5. Menu `source` **sync-conflict direction** (Zettle vs dashboard wins) — PR4 needs a per-tenant rule.
6. Set role `search_path` (recommended) — reverses the fully-qualified stance; decide before PR2.
7. Adopt Umi-as-tenant-zero (bold; pressure-test).

---

*This plan is a local working doc (companion to the synthesis) — not committed. The **code** it drives is on git: `@umi/contract` (#35/#36) and the `build-v2/` rebuild (#37) are merged to `main`. Next: PR2 (backend rename sweep); then the gated live-apply.*
