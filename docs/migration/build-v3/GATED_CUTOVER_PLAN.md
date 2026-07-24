# build-v3 Gated Cutover — Roadmap & Status

**Status:** ACTIVE (living) · **Owner:** platform · **Last updated:** 2026-07-23 · **Scope:** internal-only
**Companion docs:** [`SECURITY_GATE.md`](./SECURITY_GATE.md) (the gate) · [`ORDER_MODEL.md`](./ORDER_MODEL.md) · [`backend-convergence-map.md`](./backend-convergence-map.md)

> **What this is.** The tracked roadmap for converging `apps/umi-api` **and** the data-migration
> mechanism onto **build-v3** (3 schemas: `umi` sealed SaaS/identity/entitlement, `tenant` café facts
> under RLS, `runtime` sealed machinery) and driving to a **coordinated production cutover**.
>
> **This is a living document.** Each phase below carries both its Definition of Done **and** its
> current status (merged PRs, the tracked preflight number, what's next). It is internal-only — it is
> _about_ gates, convergence, and the transition. The architecture docs argue from v3 as the finished
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
while **every existing gate reported green**. `schema-parity` matched table _names_ only (blind to
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
> feature rework are the _same job_ for the order / identity / WhatsApp modules. The old numbering is
> retired — do not cross-reference it.

---

## 3 · The gate (three runnable instruments)

| Instrument                         | What it proves                                                                                      | Command                                                                                                | Current                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| **`sql-preflight.integration.ts`** | Every backend SQL statement resolves against live build-v3 (schema validity)                        | `cd apps/umi-api && npm run test:integration`                                                          | **139 unresolved** (as of PR #62+) |
| **`security_gate.sql`**            | RLS+FORCE, least-privilege grants, credential lockdown, data hygiene (24 structural + 3 behavioral) | `PGPORT=5233 psql -v ON_ERROR_STOP=1 -d umi_backfill_v3 -f security_gate.sql` → `SECURITY GATE PASSED` | **PASS**                           |
| **`reconcile_v3.sql`**             | Backfill fidelity — counts + money invariants + **per-order / per-item** field-level equality       | `PGPORT=5233 psql -v ON_ERROR_STOP=1 -d umi_backfill_v3 -f backfill/reconcile_v3.sql`                  | **PASS**                           |

Local DB targets (port `5233`): `umi_prod_snapshot` = source truth · `umi_backfill_v3` = backfill
result (preflight + reconcile run here) · `umi_build_v3` = pristine from-scratch DDL (`99_verify`).

Preflight setup note: `npm run test:integration` needs vitest's native `rollup.darwin-arm64.node`
un-quarantined on macOS (`xattr -dr com.apple.quarantine node_modules`) and
`DATABASE_URL_WORKER=postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_backfill_v3_p4` (the clone carrying the P4 deltas).

---

## 4 · The spine (P0 → P7)

Legend: ✅ done · 🔄 in flight · ⏳ pending · ◑ partial

### P0 — Gate repair ✅ DONE

**Goal.** Make the real baseline measurable before touching anything else.
**Delivered.** `sql-preflight.integration.ts` (`fa9277d`); `security_gate.sql` extended to 24 + 3;
`reconcile_v3.sql` extended from rows+money to **per-order / per-item** field-level checks.
**DoD.** All three instruments run locally and produce a trustworthy number. ✅

### P1 — DDL delta (atomic) 🔄 IN PROGRESS

**Goal.** Reshape the schema so the backend's SQL _can_ resolve — applied as one atomic migration set.
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
- ⏳ **`90_rls.sql` booby-trap** — delete the hard-coded child-list rows in the _same_ commit that adds
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
that _also_ hit a missing table/column, so they clear only when P1/P3/P4 land).
**⚠️ Invariant.** The worker pool is `BYPASSRLS`; dropping one `business_id` predicate = a **silent
cross-tenant read** nothing catches. Every touched query keeps its predicate.

### P3 — Identity / RBAC / WhatsApp / entitlement / POS ✅ DONE (self-contained)

**Goal.** Complete the request-path features on the build-v3 base.
**Delivered.** `PR #54` (`1ad3bbb`), 23 commits.

- ✅ **Entitlement single-source** via `umi.effective_entitlement`; ✅ **POS server seat** (`pos` product
  - contract-seam design). [[project_umipos_nexo_integration_2026_07_14]]
- ✅ **Identity → the FLAT model** (owner decision 2026-07-09, see
  `docs/architecture/2026-07-09-enterprise-conceptual-review.md`). The resolver had been written against
  a federated graph the DDL never built; that code was 3 days stale, not the spec. `umi.e164` +
  `tenant.normalize_identity` added, `contact.normalized_value` made DERIVED (BEFORE trigger) and
  UNFORGEABLE (`REVOKE UPDATE`), repairing the L15 fatal branch.
- ✅ **RBAC** — the access queries read build-v2 `tenant_access`/`login_id` and a nonexistent
  `rp.permission_key`, all INTERPOLATED so preflight never saw them (login would return
  `permissions=[]`). Rewritten onto `umi.user_role` + `seed_rbac.sql`; `super_admin` made real as a
  PLATFORM-WIDE grant (owner decision 2026-07-21 — a deliberate privilege change: the operator goes
  from 4 cafés to all 5).
- ✅ **WhatsApp sender vocabulary** — DB speaks `(customer,bot,staff,system)`, the LLM speaks
  `user/assistant`; bridged at the repository boundary with a red-green-verified regression test.
- ⚠️ **Staff writes → `workerTx`** — NOT done, carried to P4. **Never**
  `grant insert/update on umi.user to api` (no RLS on `umi.user` → cross-tenant write primitive).

**Residuals moved to P4 (they are P4-entangled, not P3 leftovers):** Customer 360
(`customers.repository` mixes `contact_identity` + `tenant."order"` + `customer.contact_id` in single
statements) and the message-pipeline schema (`tenant.message` has no `business_id`/`message_index`/
`twilio_message_sid`/`intent`/`body_embedding`), so end-to-end WhatsApp needs P4 too.

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

## 5 · Current baseline (2026-07-23)

- **`build-v3` HEAD:** `b280802` (PR #60). Merged in order: **#49** order cluster → **#50** mechanical
  sweep → **#51** D1/D11 gate → **#54** P3 (identity/RBAC/WhatsApp/entitlement/POS) → **#55** lint baseline
  → **#56** post-merge CI + lint gate → **#58** required checks → **#59** format pass → **#60** skill audit.
- **In flight:** `chore/umi-api-lint` (PR #61, green) — type-aware lint for umi-api ·
  `feat/p4-order-repos` — P4 order track: DDL delta + catalog + `tquery` + the bot checkout landed,
  **KDS next**.
- **Preflight:** **139** unresolved · 221 PREPAREd verbatim + **32 of 47 interpolated
  RECONSTRUCTED** · **15** still uncovered (named in the coverage line) · **0** `42883`.
  Measured against `umi_backfill_v3_p4`, which carries the P4 DDL deltas.
  ⚠️ **The earlier jump 140 → 171 was not a regression — it was the gate no longer under-reporting.**
  The 46 interpolated statements were "counted, not hidden", but nobody looked inside, and
  `products.repository.ts` was failing every one of its statements in there (it read
  `p.price_cents` + `p.variants`; build-v3 has `price`, and variants are relational). The
  detail report also caps each error code at 40, so with 116 `42703` the printed list was a
  SAMPLE that read like a worklist — there is now an untruncated per-file rollup.
  From 171: the catalog fix retired 13, the checkout rewrite 7 (both files are now gone from
  the rollup entirely), and the reconstruction gained one more statement to check.

- **Units:** 359 · **Gate:** `security_gate.sql` PASS · `reconcile_v3.sql` PASS on the snapshot backfill.
- **Branch protection (2026-07-21):** `build-v3` requires a branch to be UP TO DATE with base before
  merging (`strict: true`), enforced for admins. Closes the stale-base hole: the tree CI tested is the
  tree that lands.
- ✅ **The checks are now REQUIRED** (`lint`, `build-and-test`, `contract`, `tokens`). Until this landed,
  `contexts` was empty: every gate ran, reported, and a red one still merged — instrumentation, not a
  gate. The blocker was real, not an oversight — a required check that gets SKIPPED sits Pending forever
  instead of passing, so requiring a path-filtered check would have made any PR that missed it permanently
  unmergeable, admins included. Resolved by removing the `paths:` filters rather than by working around
  them: the four jobs are 10–36s in parallel, so the filters were buying almost nothing and now cost
  nothing. Measured, per PR: #54 ran 2 of 4 gates, **#55 ran only 1** — the lint-baseline PR itself was
  merged without the lint gate ever running on it.
- ✅ **Post-merge CI now runs** (`chore/post-merge-ci`). Every workflow used to be `pull_request`-only,
  and `umi-api-deploy.yml` is scoped to `main`, so a merge into `build-v3` triggered nothing — the PR was
  tested, the merge result never was. `umi-api-ci`, `contract-ci` and `tokens-ci` gain
  `push: branches: [build-v3]`; `main` stays off the push list because `umi-api-deploy.yml` re-runs the
  same gate before it ships. **pr-gates gate 5 is CLOSED — confirmed, not assumed:** merge commit
  `01e28b8` fired all four workflows on `push` and all four passed (`umi-api CI` 36s, `lint` 29s,
  `contract CI` 25s, `tokens CI` 10s). First checked merge into `build-v3`.
- ⚠️ **The lint gate caught a real defect on its first run**, which is the argument for it. `@umi/landing`
  declared no `eslint-plugin-react-hooks`, so it resolved v7 from pnpm's hoisted store (put there by
  #55's dashboard devDependency) against a config requiring `^5` — #55 changed how another app lints
  without touching it. Local disagreed because a stray pre-pnpm `node_modules` directory from 2026-05-20
  survives `--frozen-lockfile`. Fixed by declaring the plugin; traps recorded in `CONVENTIONS.md`.
  It also surfaced a live data bug: the landing diagnostic quiz never stamped its start time, so every
  recorded `completionTime` measured from page load and is inflated by an unknown amount.
- ✅ **`pnpm lint` now runs in CI** (new `lint.yml`). PR #55 built the ratchet but no workflow ran it, so
  it only caught a violation if someone remembered to run it locally. Red-green verified through
  `turbo run lint`, not just the package script: a new unused variable gives exit 1, removing it gives 0.
- ✅ **`pnpm format:check` now runs in CI, green.** The repo-wide format pass landed (306 tracked files,
  per-package commits, each verified through its own gate: umi-api 359/359 + typecheck, dashboard build,
  contract 18/18, tokens dist byte-identical + 5/5). It runs as a _step_ inside the `lint` job, not as a
  new job — a new job would be an unenforced context, and renaming the existing one would stop the
  required `lint` context from ever reporting. Two rulings came out of it: Markdown is excluded from
  Prettier entirely (formatting `docs/` was 3,758 lines of table padding and `*`→`_`, rendering
  identically), and Prettier is **not idempotent** on some files — 3 specs needed a second pass before
  `--check` agreed. Formatting commits are listed in `.git-blame-ignore-revs`.
  See `docs/reports/2026-07-21-linting-toolchain-research.md`.
- ⚠️ **`apps/umi-landing-page` has a failing test, and NO workflow runs it.** `diagnostic-trigger`
  "Debe respetar emails ya enviados" fails: an already-sent Day-0 welcome email is still queued, i.e. a
  duplicate welcome to a lead. Pre-dates the format pass and PR #56 (fails at `ea7647e`). Not live — the
  sequence engine is dormant behind `LEADS_SEQUENCE_ENABLED` — but it is unowned and invisible, because
  `lint` is the only gate covering that package. Fix or delete the test before the leads cutover.

### The 139 remaining, BY FILE (the real worklist)

This replaces the by-error-code table, which was built from the capped detail report and
therefore under-counted. `npm run test:integration` now prints this rollup untruncated.

| File                                                            | Unresolved | Owning track                        |
| --------------------------------------------------------------- | ---------: | ----------------------------------- |
| `kds/kds.repository.ts`                                         |     **27** | P4 — outbox delta + pairing/session |
| `cash/cash-write.repository.ts`                                 |         11 | cash columns                        |
| `cash/cash.repository.ts`                                       |         11 | cash columns                        |
| `conversations/conversations.repository.ts`                     |         10 | conversation pipeline               |
| `leads/leads.repository.ts`                                     |     **10** | growth — previously invisible       |
| `cash/cash-scan.repository.ts`                                  |          9 | birthday + hours                    |
| `customers/customers.repository.ts`                             |          9 | Customer 360 (identity-entangled)   |
| `jobs/queue.repository.ts`                                      |          8 | outbox exactly-once (P1 DDL)        |
| `conversation-turns` · `memory` · `tenants`                     |     5 each | pipeline / P5                       |
| `hours` · `lifecycle`                                           |     4 each | P4 hours / lifecycle                |
| `cash-register` · `turn-commit` · `ordering-settings` · `staff` |     3 each | —                                   |
| `auth` · `messages` · `voice-settings`                          |     2 each | P5 slug / pipeline                  |
| `customer-session` · `business-config`                          |     1 each | —                                   |

**`42883` remains 0** (`umi.e164` resolved the normalize functions).

> ### ✅ RESOLVED: the product catalog was an untracked cluster
>
> `products.repository.ts` read and wrote **five columns that do not exist** in build-v3:
> `price_cents` (→ `price`), `variants` jsonb (→ relational `product_option_group` +
> `product_modifier`), `is_available` (→ `active`), `synced_at`, `metadata`. Both the bot's
> read path and the **Zettle sync writer** (`jobs/integrations.processor.ts`) were broken.
>
> It was in **no** phase of this spine and it **blocked the P4 order track**: `validateItems`
> gates every checkout and needs variants, and reorder round-trips `variant_name` (set on
> **63 of 73** source lines). It was invisible until the gate learned to reconstruct
> interpolated SQL — the case that put "the gate didn't flag it is not evidence" on the wall.
>
> Fixed on `feat/p4-order-repos`: the jsonb variant shape is rebuilt at the query boundary
> from the relational model, so the tool contract the LLM sees is unchanged. All 13 statements
> retired.

Still uncovered after reconstruction: **15** statements —`lifecycle`×4, `trace.service`×4,
`auth`×2, `kds`×2, `cash`×1, `conversation-turns`×1, `tenants`×1. Named, not just counted.

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
