# build-v3 Gated Cutover — Roadmap & Status

**Status:** ACTIVE (living) · **Owner:** platform · **Last updated:** 2026-08-22 · **Scope:** internal-only
**Companion docs:** [`SECURITY_GATE.md`](./SECURITY_GATE.md) (the gate) · [`ORDER_MODEL.md`](./ORDER_MODEL.md) · [`backend-convergence-map.md`](./backend-convergence-map.md)

> **What this is.** The tracked roadmap for converging `apps/umi-api` **and** the data-migration
> mechanism onto **build-v3** (3 schemas: `umi` sealed SaaS/identity/entitlement, `merchant` café facts
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
   schema with zero `tenant_id` columns** (everything is `merchant_id`). This was in no prior phase and
   invisible to every gate.
2. The spine is ordered by **DDL truth**, not by code tidiness. We fix the schema deltas the backend
   depends on, then sweep code onto them, then complete features by domain. Progress is counted in
   preflight failures retired, not tests passed.

> **Supersedes.** This DDL-first spine replaces the earlier code-convergence-first plan, which framed
> "Phase 1" as a pure rename sweep. The audit proved that framing false: the name convergence and the
> feature rework are the _same job_ for the order / identity / WhatsApp modules. The old numbering is
> retired — do not cross-reference it.

---

## 3 · The gate (four runnable instruments)

| Instrument                         | What it proves                                                                  | Command                                                                                                | Current                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| **`sql-preflight.integration.ts`** | Every backend SQL statement resolves against live build-v3 (schema validity)    | `cd apps/umi-api && pnpm run test:integration:schema`                                                  | **0 unresolved**                                         |
| **`check-values.integration.ts`**  | Every compared or inserted literal is a value the column's CHECK admits         | same command (runs in the same suite)                                                                  | **PASS** (302 stmts, 98 comparisons, 27 INSERT literals) |
| **`security_gate.sql`**            | RLS+FORCE, least-privilege grants, credential lockdown, data hygiene            | `PGPORT=5233 psql -v ON_ERROR_STOP=1 -d umi_backfill_v3 -f security_gate.sql` → `SECURITY GATE PASSED` | **PASS** (49 structural + 3 behavioral)                  |
| **`reconcile_v3.sql`**             | Backfill fidelity — counts + money invariants + per-record field-level equality | `PGPORT=5233 psql -v ON_ERROR_STOP=1 -d umi_backfill_v3 -f backfill/reconcile_v3.sql`                  | **PASS** (gift-card per-card drift 0)                    |

> **Why the fourth instrument exists (added 2026-08-02).** Preflight PREPAREs, so it catches every
> NAME the schema lacks. It cannot catch a VALUE the schema forbids — Postgres tests a CHECK at RUN
> time (23514), never at parse time. A query comparing a column to a string no CHECK allows PREPAREs
> perfectly and then matches zero rows forever, raising nothing. **That class has now cost us twice:**
> the hours comparison where `01:00 >= closes_at` held for every window so every late-night scan read
> as after-hours, and `listLocationProfiles` filtering `status <> 'archived'` after build-v3 narrowed
> location statuses to `('active','closed')` — a predicate that read as a filter and behaved as a
> no-op. Both were found by a person reading a statement, which does not scale.
>
> The gate reads every enumerated CHECK from the live database (the schema is the authority, not a
> list kept by hand) and resolves the allowed values **per table**. That scoping is the whole
> difficulty: `merchant.station.status` does admit `'archived'`, so a union across every `status`
> column in the schema calls the location bug legal. It is deliberately conservative — a statement
> whose table cannot be resolved is skipped and counted, never failed. Red-green verified: restoring
> the predicate turns it red with the file, line and the values the table actually admits.

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

- ✅ **Order cluster** — `PR #49` (`fed8c08`). `merchant.customer_order` / `order_item` / `order_event`
  (+ `payment`), **derived** order total (no stored `total`), void model (`voided_at`/`void_reason` +
  immutability trigger), `order_total` / `order_ticket` views. See `ORDER_MODEL.md`.
- ✅ **DB functions** `merchant.normalize_phone` / `normalize_identity` — **DONE.** Both live in
  `00_foundation.sql` beside `umi.e164`. `42883` has been 0 since P3.
- ⏳ **`merchant.contact` unique constraint** — **no longer a preflight failure, still an open
  integrity question.** The `42P10` went away because the resolver stopped upserting, not because
  the constraint arrived: `identity.resolver.ts:405` now does a plain `INSERT` after a separate
  `SELECT`, and `contact_lookup_idx` is a plain index. Two concurrent inbound messages from one
  new number can therefore each see no contact and each create one. The gate cannot see this —
  it is a race, not a parse error.
- ✅ **`runtime.outbox_event` exactly-once RESTORED** — `merchant_id`/`topic`/`aggregate_id`/
  `idempotency_key` + `UNIQUE (merchant_id, idempotency_key)`, and `available_at`/`leased_at`
  split apart (one column was serving as both backoff and lease).
- ✅ **`runtime.conversation_turn` RESTORE** — **DONE (PR #68).** Restored as the merge buffer
  `CONVERSATION_MODEL.md` specifies, not as the integrity ledger the old shape implied.
- ✅ **customer-session home** — **RESOLVED.** This line described the old `app`-CHECK session
  shape. Current build-v3 `runtime.session` is keyed by `(principal_type, principal_id)` with
  `principal_type in ('user','device','person')`, and its own comment names the umi-cash
  customer case as the `'person'` principal. Nothing to build. (Confirmed 2026-07-28 while
  reading this plan against the UmiPOS integration; `runtime.operator_session` follows the
  same discipline — a distinct presence table rather than another overload of `session`.)
- ✅ **hours** — **DONE 2026-07-29.** 8 preflight failures cleared; `merchant.open_hours` and
  `merchant.config` have no readers left. Not the shape this line originally predicted: there is
  no `merchant.business_hours` table. Hours are the jsonb COLUMN build-v3 already chose, with a
  location override.
  - **Shape.** `merchant.merchant.open_hours` + `merchant.location.open_hours` (NULL = inherit),
    mirroring `location.timezone` one line above it. Derived from use: every reader wants the whole
    week for one place and evaluates it in app code, and nothing filters on hours in SQL — so the
    unit of read equals the unit of write, which is a document. The row table also could not
    express a split shift (its UNIQUE index on `(merchant, location, day)` FORBADE the second
    window), a date exception, or a window past midnight — the last one contradicting
    `business_day_start`, which exists because merchants run past midnight.
  - **`merchant.config` dissolved** into typed `merchant.whatsapp_*` columns per
    CONVERSATION_MODEL §2c. Named for the channel deliberately: a neutral `ordering_enabled`
    would eventually be wired to pause the POS too, and a café that stops taking WhatsApp orders
    is still selling at the counter.
  - **One evaluator.** `modules/business-hours/open-hours.ts` owns the document's meaning; the bot, the
    dashboard and `cash-scan.isAfterHours` all call it. The register used to compare times in SQL,
    which could not represent a café open past midnight — `01:00 >= closes_at` holds for every
    window, so every late scan read as after-hours.
  - **`ordering-settings.repository` was dead, not merely stale.** It looked up
    `merchant.merchant WHERE merchant_id = $1 ORDER BY created_at LIMIT 1` and upserted
    `ON CONFLICT (merchant_id)` — the shape of `ops.businesses`, a CHILD of `core.tenants`. In
    build-v3 the merchant IS the merchant, so every part of that (the column, the ordering, the
    LIMIT, the create-if-missing) answered a question that no longer exists.
  - **The backfill was losing locations.** §3's fold grouped by `tenant_id` alone over a source
    keyed by `(merchant, LOCATION, day)`, so a café with hours at two locations produced duplicate
    day keys and `jsonb_object_agg` kept one arbitrarily, with no error. Demonstrated on a fixture:
    two locations at 07:00–19:00 and 11:00–21:00 folded to 11:00–21:00 alone. Production had
    already made that distinction — part 2b-bis of the 2026-06-26 migration exists because of it.
    Now one document per location, and 4 reconcile invariants that count cafés and distinct
    schedules rather than rows, because the loss was invisible in a row count.
  - **The client half exists now.** `updateOrdering` had no caller: the dashboard's
    `saveBusinessHours` took two arguments. It takes three, the pause persists on its own confirm,
    and the screen no longer ships a hardcoded cutoff, notice, three real `+52` numbers, or a
    permanent `badge: 'PAUSED'` in `shell.jsx` that told every café ordering was paused.
  - ⏳ Left open: no dashboard affordance yet CREATES a location override — the backfill is its only
    writer, and `write()` deliberately saves where the value already lives so a routine save can
    never silently fork a location off the café's hours. `cash-scan.isAfterHours` reads café-level
    hours because a staff scan carries no location; revisit when the register carries its device's.
- ✅ **identity dissolution** — **DONE.** `contact_identity` / `channel` / `whatsapp_number` survive
  only in comments that explain what the flat model replaced. No statement reads them.
- ⏳ **`90_rls.sql` booby-trap** — delete the hard-coded child-list rows in the _same_ commit that adds
  `merchant_id` to `station`/`order_event` (else `42710` aborts the whole RLS rebuild).
  ⚠️ **The same species bit again 2026-07-28**: the POS location-narrowing policies were written as
  an opt-IN list of table names, so a new merchant table with a `location_id` got no narrowing,
  silently, failing OPEN. Now swept with a recorded opt-out (`staff`, `loyalty_visit`), which
  also picked up four tables that had none — `customer_order`, `device`, `station`,
  `product_location_availability`. **Rule: in this file, sweep and exclude; never list and include.**
- ✅ **Queue cluster RESTORED (2026-07-29)** — `runtime.inbound_event` / `dead_letter` /
  `idempotency_key`, the three siblings of the `outbox_event` restore above. Same loss, same
  cause: the from-scratch DDL simplified past what the live worker writes, and nothing noticed
  because the statements resolved against nothing. `inbound_event.external_id` → the
  `provider_event_id` the code has always written (so the existing UNIQUE is the one
  `ON CONFLICT` was addressing) plus `merchant_id`/`event_type`/`payload_hash`;
  `dead_letter` gets back `merchant_id` (NOT NULL, which `dead-letter.service.ts` already cites
  as why unmerchanted jobs are log-only) and the four facts `source text` had concatenated;
  `idempotency_key` becomes merchant-scoped `(merchant_id, scope, key)` — a global `key` PK put
  every café in one namespace. **This cluster was not on this list**; it was found by running
  the preflight rather than reading the plan. Zero backfill impact: all three tables' rows are
  dropped by the 2026-07-12 security decision.
- ✅ **`merchant.staff.name`** — **DONE 2026-08-01 (PR #76).** 3 preflight failures cleared. The
  fix went the OTHER way from this line's prediction: the columns did not move back to
  `merchant.staff` as a convenience — `merchant.staff` was made **the café's principal**, and a
  principal has a name. `umi.user` keeps the platform identity (the login address, the credential,
  the platform grant); the employment keeps the employment facts (`name`, `phone`, `email`,
  `role_id`, `status`, the PIN triple). Every staff row still carries a `user_id`, because
  `runtime.operator_session` requires both ids and a PIN that names nobody has no audit actor.
- ⏳ **Backfill rewrite to PRESERVE** — extend the reconcile to field-level for each new carry.

> **Why P1 is "in progress" while P2 already shipped:** the order cluster was the cleanly-separable
> slice and landed first; the mechanical name sweep (P2) was independently safe and ran ahead. The
> remaining P1 deltas are entangled with P3/P4 by module and land alongside them — this spine is a
> dependency map, not a strict serial gate.

**DoD.** Pristine `umi_build_v3` builds from scratch (`99_verify: OK`); the P1 deltas each retire their
preflight failures; `security_gate.sql` + `reconcile_v3.sql` stay PASS.

### P2 — Mechanical name sweep ✅ DONE

**Goal.** `tenant_id` → `merchant_id` across the backend (488 refs; the single largest preflight cause).
**Delivered.** `PR #50` (`f843e2e` / `b83c5c3`) — 387 renames across 37 files. **Preserved:** the
`app.tenant_id` GUC (`pg.service.ts` dual-sets it with `app.current_merchant`) and the **frozen iPad
`device_session.tenant_id` wire key** (now sourced from the renamed column). tsc clean, 325 tests pass.
**Result.** Preflight **191 → 160** (only 31 retired directly — most `tenant_id` refs sit in statements
that _also_ hit a missing table/column, so they clear only when P1/P3/P4 land).
**⚠️ Invariant.** The worker pool is `BYPASSRLS`; dropping one `merchant_id` predicate = a **silent
cross-merchant read** nothing catches. Every touched query keeps its predicate.

### P3 — Identity / RBAC / WhatsApp / entitlement / POS ✅ DONE (self-contained)

**Goal.** Complete the request-path features on the build-v3 base.
**Delivered.** `PR #54` (`1ad3bbb`), 23 commits — then reopened twice, by `PR #73` (the UmiPOS
schema and contract fold) and `PR #76` (the principal, and what it may do). Both are recorded below
under the lines they change.

- ✅ **Entitlement single-source** via `umi.effective_entitlement`; ✅ **POS server seat** (`pos` product
  - contract-seam design). [[project_umipos_nexo_integration_2026_07_14]]
- ✅ **Identity → the FLAT model** (owner decision 2026-07-09, see
  `docs/architecture/2026-07-09-enterprise-conceptual-review.md`). The resolver had been written against
  a federated graph the DDL never built; that code was 3 days stale, not the spec. `umi.e164` +
  `merchant.normalize_identity` added, `contact.normalized_value` made DERIVED (BEFORE trigger) and
  UNFORGEABLE (`REVOKE UPDATE`), repairing the L15 fatal branch.
- ✅ **RBAC** — the access queries read build-v2 `merchant_access`/`login_id` and a nonexistent
  `rp.permission_key`, all INTERPOLATED so preflight never saw them (login would return
  `permissions=[]`). Rewritten onto `umi.user_role` + `seed_rbac.sql`; `super_admin` made real as a
  PLATFORM-WIDE grant (owner decision 2026-07-21 — a deliberate privilege change: the operator goes
  from 4 cafés to all 5).
- ✅ **Platform authority BOUNDED (PR #76, 2026-08-01).** The grant above was real but unbounded, so
  this closed it. Research: `docs/reports/2026-08-01-platform-admin-and-support-access.md`.
  - **The wildcard is gone.** `super_admin` resolved to `['*']` in `roles.ts`, which the database
    could not see, so neither RLS nor the permission catalog could bound it. **It had already failed
    here:** the 8 POS permission keys seeded in July 2026 all reached `super_admin` the moment they
    existed, with no review, because a wildcard grants keys written after it. Kubernetes documents
    this exact defect. `seed_rbac.sql` now grants every key as a real row, so a new key reaches
    nobody until somebody re-runs the seed on purpose. That re-run IS the review step.
  - **The grant can end.** `umi.user_role` gained `expires_at`, `revoked_at`, `revoked_reason`,
    `justification` and `approved_by`. **PostgreSQL will not enforce the expiry** — `VALID UNTIL`
    applies to a password, not a role — so the predicate lives in `PLATFORM_GRANT_CTE`
    (`rbac.sql.ts`), the one place all three access queries share. Without that line the columns are
    decoration.
  - **`is_platform` is enforced, not commented.** A composite FK
    (`role_id, is_platform` → `umi.role (id, is_platform)`) refuses to grant a café role
    platform-wide. NIST AC-6(5) written as DDL.
  - **`developer` is a real role**: cross-merchant REACH, read-only AUTHORITY. Reach and authority
    are separate axes, and only reach needs to be wide to debug a café. `tech_assist` was removed —
    it sat above `staff` in the precedence list with no `umi.role` row behind it, so it outranked
    `staff` and granted nothing.
  - **The bootstrap address is a parameter**, not a committed constant: the repository was briefly
    public, and a committed administrator address is an enumeration target.
  - **Reach did NOT change**, deliberately. A super-admin still sees every active merchant in the
    picker. Hopping between cafés is what makes debugging and testing quick.
- ✅ **WhatsApp sender vocabulary** — DB speaks `(customer,bot,staff,system)`, the LLM speaks
  `user/assistant`; bridged at the repository boundary with a red-green-verified regression test.
- ✅ **Staff writes** — **RESOLVED 2026-08-01 (PR #76), but not by moving them to `workerTx`.**
  Adding a staff member creates the person who will hold the till PIN, so the request path must
  mint an identity. It does that under a **column-scoped** grant:
  `grant insert (email, full_name, status) on umi.user to api` (`90_rls.sql:171`). `api` holds no
  table-level INSERT there, so the column list is the whole permission — a forged row can carry no
  `password_hash`, `password_salt` or `password_algorithm`, and therefore authenticates nothing.
  The warning this line carried still stands for `update`: **never**
  `grant insert/update on umi.user to api` unscoped.
  The add-staff CTE also **never links an existing account**. If the address is already taken it
  mints a fresh login-less row instead, so typing the platform administrator's address into the
  staff form cannot attach a café employment to that administrator's identity.

- ✅ **POS folded into the schema (PR #73, 2026-08-01).** UmiPOS is a CLIENT of `umi-api`, not a
  second platform — no second database, no event bus, no sync, no reconciliation. Because build-v3
  has never been applied, the POS tables were folded into the `CREATE` statements rather than added
  as `ALTER`s. **That choice expires at P7 cutover:** after the flip, every one of these becomes a
  forward-only migration.

**Residuals that were moved to P4 are now closed there:** Customer 360 (#70) and the message
pipeline (#68). Both were genuinely P4-entangled, not P3 leftovers.

**DoD.** Entitlement returns the same set as `product_instances` for the seeded cafés; login yields real
permissions; the bot replies (add it to the smoke test — its failure is silent); preflight retires the
identity/entitlement failures; gate stays green.

### P4 — Conversation pipeline / hours / birthday / KDS / order repos ✅ DONE IN PR CANDIDATE

**Goal.** The remaining domain rewrites onto the new shapes.
**Scope.** **Conversation pipeline** — a deliberate retreat from the agentic-AI over-engineering,
recorded in [`CONVERSATION_MODEL.md`](./CONVERSATION_MODEL.md): **delete `conversation_state`** (no FSM —
a cheap-but-capable LLM + recent messages _is_ the state), **slim `conversation_turn` to a merge buffer**
(the fragmented-WhatsApp-message problem is real; the integrity/reconcile machinery is not), **dissolve
`merchant.config`** into the typed `merchant.bot_*` / `open_hours` columns it already became, point
message embeddings at `runtime.message_embedding`, and elevate customer facts into the CDP (read as
Customer 360). `GET /hours` off `merchant.open_hours` jsonb; **order repos** rewritten to
`merchant.customer_order`.
**Delivered.**

- ✅ **KDS** (#63 / #65) · ✅ **cash** (#66 vocabulary / card / branding, #67 birthday grant — cash 34 → 9).
- ✅ **conversation pipeline** (#68, `cb6ed88`) — the slim state model of `CONVERSATION_MODEL.md`.
- ✅ **lifecycle + customers read residue** (#69, `10482f3`) — the cash-rename tail.
- ✅ **Customer 360** (#70, `b2e9da3`) — `customers.repository` off the federated graph.
- ✅ **growth / leads** (#71, `9d182ff`) — the landing-page funnel onto `umi.prospect`. This bucket
  was **10 statements nobody had counted** until the rollup stopped truncating.
- ✅ **hours** (#74) — see the P1 entry above for the shape and for what the fold was losing.

✅ **Gift cards (2026-08-20, PR #127, merge `c773d62`).** The model decision is now explicit. A
gift card is a one-use bearer value. The clear code is returned at issue time and is never stored.
The database keeps its SHA-256 hash and a masked suffix. `amount_cents` is the face value. The
current value is always `SUM(loyalty_gift_card_ledger.delta)`. The ledger is append-only. Redemption
claims `redeemed_at` only when it is NULL. It then appends both money movements in one transaction.

**Decision basis.** PostgreSQL documents that `digest(data, type)` returns a binary message digest
and supports `sha256` ([pgcrypto](https://www.postgresql.org/docs/current/pgcrypto.html)). A digest
supports indexed lookup without retaining the bearer code. Deterministic hashing would expose
repeated inputs. Umi generates each code from 16 random bytes, so repeated inputs are not expected.
This is a Umi-specific inference from the issue path and its 128-bit random input.

This takes the narrow gift-card slice from UmiPOS PR #94's design, not that PR's full POS schema.
The wider projection set is outside this blocker. The DDL, source backfill, per-card reconciliation,
Cash API repositories, public/admin proxy routes, and a real-database race test now agree on the
same model. The preflight moved **7 → 0**. A runtime `INSERT reason='load'` succeeds, and two
simultaneous redemption attempts produce one success and one already-redeemed result.

**DoD.** Preflight → **0 unresolved**; conversation/hours/order behavioral checks green; gate green.

### P5 — route by id, `slug` → `handle` ✅ DONE 2026-08-01

**Goal.** Route merchants **by id**; drop `slug`, keeping one published URL key so already-issued
wallet passes keep resolving.

**Delivered.** Preflight **15 → 7**; every remaining statement is a gift card. The slug bucket is
closed and took two hidden bugs with it (below).

- **`merchant.merchant.handle`** — nullable, `UNIQUE`, CHECKed `^[a-z0-9][a-z0-9-]{1,62}$`. NOT
  auto-assigned, which is the whole difference from `slug`: a café created after cutover gets none
  and is reached by id. The column is designed to **stop growing**.
- **Why it had to exist.** Four things already published a café's name inside a URL and cannot be
  recalled: **350 Apple Wallet passes** installed on customers' phones (a `.pkpass` is a SIGNED
  bundle and its `webServiceURL` is frozen at generation — `pass-apple.ts:126`), umi-cash's whole
  customer site under `/{handle}/`, the brand asset files `/logos/{handle}-*.png`, and the
  `umi.app/{handle}` address the dashboard prints. Apple does **not** require the café in that path
  — the serial identifies the card — so the dependency is self-inflicted and NEW passes need not
  repeat it. It is still permanent for the passes already issued.
- **Routing.** `merchantIdForSlug`/`merchantBySlug` → `merchantIdForHandle`/`merchantByHandle`, and
  both guards now accept **id OR handle, id first**. The order is load-bearing: the handle CHECK
  admits a lowercase uuid, so testing the uuid form first is what stops the two competing.
- **Contract (MAJOR).** `MerchantMembership.slug` → `handle`, nullable. Route family
  `cash.slug.*` → `cash.byRef.*` and the path param `:slug` → `:merchantRef` across 9 controllers.
  The **URL is unchanged** — a path parameter's name is positional — so umi-cash, which does not
  import `@umi/contract`, is untouched.
- **Location `slug` was NOT carried.** Nothing routes by a location, and the values were derived
  and already wrong: the row named "Chapultepec" carried `kalalacafe-sucursal-centro`, and
  "Congreso" carried `kalalacafe-sucursal-norte`. Carrying that preserves a mislabel, not an address.

**Two bugs the interim was hiding.** Returning the merchant ID under the name `slug` was worse than
it looked — the dashboard **printed that uuid as the café's public address** and built
`/logos/{uuid}-wallet-logo.png` from it. Both were wrong on every screen and neither failed loudly.

**And two the gate could not see, because a statement reports only its FIRST unresolved name:**

- `cash.repository.branding` self-joined `merchant.merchant` to itself on `ob.merchant_id`, a column
  that never existed. It was `ops.businesses` — the CHILD row build-v3 dissolved into the merchant —
  and the rename sweep turned the dead join into a self-join. Now reads `t.city`.
- Behind it, the same statement still addressed `p.branding->>'primary_color'`, a **jsonb blob that
  PR #66 replaced with typed columns**. The reader was never updated. Eight branding fields were
  unresolvable and invisible. Fixing the join is what surfaced them.

**Also fixed: `00_run_backfill.sh` was broken.** It never passed `-v bootstrap_email`, so every
rehearsal died at `seed_rbac.sql` — while that file's own comment claimed the pipeline passed the
flag. The guard was right; the caller was never updated. Now takes `$BOOTSTRAP_EMAIL`.

**One more defect, and a new gate for its whole class.** `listLocationProfiles` filtered
`status <> 'archived'` — a value build-v3 no longer admits, so the filter could never exclude
anything. It now returns every location, which the write path already required: `updateLocation`
deliberately does not filter on status so a closed location can be REOPENED, and a read that hid
them would leave the row you need to reopen invisible to the screen that reopens it. The new
**`check-values.integration.ts`** gate (§3) catches this class; it found exactly this one across
256 statements, and nothing else.

**The handle was only HALF the wallet guarantee.** Asserting it is what exposed the other half.
A pass authenticates with **two** frozen values, and the backfill was carrying one of them:

- The **handle** gets Apple's call to the right café — `/api/{handle}/passes/apple`, signed in.
- The **`authenticationToken`** gets it past the door. It is signed into the `.pkpass`
  (`pass-apple.ts:117`), replayed on every callback as `Authorization: ApplePass <token>`, and
  matched **exactly** by the web service (`v1/[...path]/route.ts:55`).

`backfill_loyalty.sql` dropped it, annotated _"Apple web-service secret, regenerated"_. A pass on a
customer's phone is **immutable** — it cannot be re-signed — so a regenerated token matches nothing
and every callback 401s. For all 350, permanently. Nothing would have failed at cutover: the gates
would stay green, the reconcile would balance, and the passes would simply stop updating. The
column now exists as `merchant.loyalty_wallet_pass.web_service_token` and carries **verbatim**
(§G asserts src = dst = 350 and 0 string mismatches).

It is a **bearer secret** — holding it is enough to read a customer's card and re-download their
pass — so it is column-locked off `api`/`readonly` in `90_rls`, the same posture as
`umi.user.password_hash`. Apple's callback carries no session and no merchant, so it is a worker
read by construction. Proven red-green on the disposable PG: `api` is refused the column, the star
select, and a forged insert; `api` still reads every other column; `worker` reads the token.

**Proven, not assumed.** Full backfill run end to end, then `reconcile_v3.sql` section G: handle =
source slug for all 5 cafés (0 mismatches), 0 merchants-with-passes missing a handle, 0 duplicates,
**350/350 Apple tokens carried with 0 string mismatches**, aliases/descriptor carried, `search_text`
derived on every location. `security_gate.sql` 36 structural + 3 behavioral PASS. 441/441 unit
tests, contract 33/33, dashboard builds.

**DoD.** ✅ All consumers build against the new contract. ✅ Every value a wallet pass needs to keep
working survives the cutover — handle, serial, `web_service_token`, push token, and the card's
`qr_token`. Zero `slug` references remain in the DDL, the contract, umi-api or the dashboard.

**What P5 deliberately did NOT own.** P5 preserved the frozen pass identity but did not port the
wallet service. That work is now complete on `build-v3`. Commit `ee99a4e` moved Apple and Google pass
serving into umi-api. Commit `4672652` added production render checks. Commit `a069aa3` carried the
reward name. Commit `652c51d` added pass-health reporting and push. These modules consume the values
that P5 preserved.

### P6 — Deployment-gate provisioning (`SECURITY_GATE.md §4`) ◑ PARTIAL

**Done:** D1 (boot-guard role reconciliation, `PR #51`) · D2 (dual-GUC expand/contract) · D3
(pooler SET-LOCAL isolation, 5/5 on the current rehearsal) · D4 (TLS verify-full VPS→Supabase,
LIVE 2026-08-07) · D5 (SCRAM verifiers confirmed on the login roles, 2026-08-07) · D10
(request-path log redaction closed on both pools, 2026-08-07) · D11 (auth substrate worker-only +
static AST gate, `PR #51`).
**Pending:** D6 pg_hba/network — **blocked**: umi-cash egresses from Vercel, which has no fixed
IP, so the Supabase network restriction cannot be turned on without cutting the register off ·
D7 extensions and D8 no-FDW-remnants — evidence lands with the rehearsal/cutover replay (D8 is
"zero foreign servers after replay" by construction) · D9 secret rotation + history scrub
([[project_cred_exposure_2026_06_20]]; gitleaks already in CI).
**Residual on D1:** the prod worker pool still connects as `postgres`; the flip to the `worker`
login role is the cutover-day env change, recorded in P7.
**DoD.** Every §4 row checked with recorded evidence.

### P7 — Cutover rehearsal → production cutover 🔄 IN PROGRESS

**Goal.** The coordinated one-shot flip (downtime OK, same DB, no split-brain).
**Mechanism — FDW replay.** Port the 7-file backfill from local `INSERT…SELECT` to `postgres_fdw`
replay against prod source `xbudk`, preserving run order (vertical → 6 domains → cross-FK/RLS) and
reusing `reconcile_v3.sql` unchanged. **D8**: zero foreign servers/user-mappings remain after replay.
**Rehearsal.** On a throwaway prod clone: apply build-v3 → FDW backfill → gate → reconcile → browser
smoke both clients (umi-cash register→scan→topup→redeem; dashboard; **and the WhatsApp bot**).
**Cutover.** Gate + reconcile run **against prod** and pass **before** the flip; the app repoints
`DATABASE_URL_APP/_WORKER` at the `api`/`worker` login roles (env change) and drops `app.tenant_id` from
`runWithMerchant`.

#### ✅ Wallet layer ported; local real-device proof complete

The wallet layer now has a build-v3 home in umi-api. Apple registration, change lists, pass
download, pass generation, APNs push, Google issuance, health reporting, and push orchestration
landed in commits `ee99a4e`, `4672652`, `a069aa3`, and `652c51d`. Umi Cash keeps the frozen
`cash.umiconsulting.co` routes and forwards seven wallet surfaces to the new owner.

**Measured on the local production-snapshot clone (2026-08-20).** The backfill carried 417/417
wallet-pass rows. It carried 350/350 Apple rows, 67/67 Google rows, and 398/398 device rows. Identity
and value mismatches are zero. All 350 Apple tokens and 398 push tokens are present. There are zero
orphan pass cards or devices. The compiled repository authenticated a migrated Apple pass and
rejected a wrong token. It resolved the frozen handle, push target, barcode identity, and change-list
serial. `wallet-carry.integration.ts` passed 12/12. Wallet tests passed 44/44. All seven Umi Cash
routes forwarded to the expected frozen paths.

**Real-iPhone proof on the local production-snapshot clone (2026-08-20).** A newly issued,
synthetic Apple pass was signed with the production Pass Type identity exported temporarily from
Keychain and installed on a physical iPhone through a temporary HTTPS tunnel. The phone registered
the pass (**201**), polled the change list (**200**), and downloaded the pass (**200**). After the
test card changed, the Build v3 push path reported **1 card / 1 APNs send**; the phone polled and
downloaded the changed pass, and the notification arrived on the device. The synthetic customer,
card, pass, and device registration were then removed. Counts returned to **417 wallet passes** and
**398 device registrations**, so no migrated row was changed. This proves the local signer,
registration, APNs, change-list, and download mechanics for a new rehearsal pass. It does **not**
prove the frozen production host or continuity for a pass issued before cutover.

**Current full rehearsal (2026-08-21).** The backfill runner rebuilt a clean target from
`umi_prod_snapshot_20260818`. It selected the actual bootstrap holder. Reconciliation passes for
all five merchants. It reports 794/794 contacts and 783/783 customers. The one gift card and its
ledger have zero drift.

The larger set of wallet rows also carries exactly:

- **751 passes**: 637 Apple passes and 114 Google passes.
- **637/637 Apple web-service tokens**.
- **733/733 device push tokens**.

The migration family passes 24/24. RLS passes 9/9, pooler isolation passes 5/5, identity
normalization passes 8/8, and endpoint smoke passes 2/2. **Since the UmiPOS merge (2026-08-22)
the smoke exercises 100 GET routes** (the integration added 44). Fifty-five answer below 400 and
45 are declared exceptions: the six local signer/input ones, plus the POS routes, which answer
403 because no rehearsal café holds the `pos` product (the snapshot predates UmiPOS), the two
device routes, which answer 401 without an enrolled-device credential, `health/diagnostics`
(403 without the operations token) and `kds/routes` (400 without a location). Each is a PIN
that fails the day its reason stops being true. The customer QR route answers 200 when the
command supplies `APP_QR_SECRET`.

**The rehearsal command grew with the merge.** The runtime now refuses to boot without an
explicit `UMI_ENVIRONMENT` (the integration harness sets `test` itself), and `/health` answers
503 until `EXPECTED_SCHEMA_VERSION` names the applied schema (`build-v3-48` today) — a new
deployment input, alongside `RELEASE_VERSION` / `RELEASE_GIT_COMMIT` / `CONTRACT_VERSION`. The
migration family also needs `REDIS_URL` and the three JWT secrets because the smoke boots the
whole module. After every `00_run_backfill.sh`, re-apply
`apps/umi-api/test/integration/harness-roles.sql` to the new target (schema grants live inside
the database) or identity-normalization refuses to run, by design.

The rehearsal command now names `APP_QR_SECRET`. It fails early if the value is absent.

The current security gate passes **48 structural and 3 behavioral checks** and reports one
acknowledged gap. The holder of the bootstrap role has no enrolled MFA. This check now measures an
active holder. AB#115 was the register-side half of this; it is DECIDED (below). The
bootstrap-holder enrolment itself is the D12 row, and it is not blocked on anything.

**What remains for P7:**

1. Move and validate the APNs, WWDR, Apple signer, and Google service-account secrets under D9.
2. ✅ **AB#115 DECIDED 2026-08-22 — option 2, measured first.** On the rehearsal: 9 users,
   **0** enrolled, 8 active staff, 0 enrolled staff. The register bypass is latent, so the
   work item's own rule applied. `CashAuthService` now **refuses an MFA-enrolled account** at
   login (after the password verifies — not an enumeration oracle) and at refresh (so an
   open till does not outlive enrolment). Refuses nobody today. Branch
   `fix/ab115-register-refuses-mfa-enrolled`.
   **Consequence, recorded so it is not discovered later:** a real-café manager who enrols
   loses the till until the PIN door exists → **AB#118** (PIN login, MFA-rollout blocker) and
   **AB#119** (`elevation_grant` wiring, depends on #118). **D12 is NOT blocked on them:**
   `hola@umiconsulting.co`'s only staff membership is at the empty "Umi Cafe" demo merchant
   (0 customers), so enrolling the bootstrap holder costs it nothing real. The remaining D12
   step is therefore just: enrol `hola@` (email_otp is the only shipped method; the gate row
   will read PASS but the `totp` criterion stays unmet — see SECURITY_GATE D12).
3. Exercise the frozen `cash.umiconsulting.co` host through the production routing layer.
4. Update a pass issued **before** cutover on a real phone after the production flip.

**The formal rehearsal repeats this proof through production routing.** A green suite proves the row
moved; the local phone run proves Apple accepted a newly generated token and notification. The
remaining continuity gate is a pass issued **before** cutover — that is the one carrying the old
token and frozen URL, and it is the only case that can prove the flip preserved existing devices.

#### ✅ UmiPOS integration merged into build-v3 (2026-08-22)

`architectureUMIposIntegration-v2` (PR #94, 731 files, forked at `9e43c3c` on 2026-08-13) is
merged. Rule applied: **umi-api keeps build-v3's architecture where build-v3 had moved on; the
POS client (`apps/umi-pos`, Flutter) is the branch's, verbatim.** 41 files conflicted; the
decisions that were not mechanical, recorded so nobody re-litigates them from the diff:

- **Gift cards — schema union on build-v3's model.** Both sides reshaped `loyalty_gift_card`
  after the fork. build-v3's (#127/#128: no clear code, `code_hash bytea`, delta ledger) is the
  authority; `37_pos_customer_value.sql` is now additive on top of it (status, public_reference,
  currency, projection columns; the ledger's POS fact columns; the balance projection and the
  authorize/release functions). The `reason` CHECKs are supersets that keep `gift_card_redeem`
  (the frozen source's replay value). The POS issuer computes `code_hash`/`masked_code` in SQL as
  the register does. Four `public_reference NOT NULL` columns and `contact.contact_type` get
  BEFORE INSERT defaults, because build-v3's writers predate them.
- **Value ledgers — one write boundary.** `90_rls` (branch) revokes `api`'s and `worker`'s DML on
  the four value ledgers; every write goes through the SECURITY DEFINER fact functions. The Cash
  register's one ledger insert now goes through `append_gift_card_fact` with identical semantics.
  Parameters inside `jsonb_build_object` are cast — Postgres cannot infer a bare one.
- **Dashboard session — build-v3's `runtime.session` (AB#114) is the authority; the branch's
  `runtime.dashboard_session` survives as a projection of the refresh FAMILY.** Its `id` is the
  family id, signed into every token as `sid`, which is what the POS binds administrative
  commands, elevation grants and gift-card secret delivery to — and what survives the dashboard's
  own refresh cycle. One signer (`issueTokens`) serves dashboard and POS sessions. The guard
  accepts the same access JWT as `Authorization: Bearer` (the POS holds tokens in the app);
  the register-token opt-in path is tried first, as before. No per-request session lookup: an
  access token lives for its TTL and revocation lands at refresh, as #130 decided. Password reset
  now revokes every live dashboard session (the branch's improvement, kept).
- **Staff screen stays a dashboard capability.** The branch had re-gated `admin/staff` behind
  `@RequireProduct('pos')`; restored to build-v3's guards. The operator PIN it issues is the
  till's credential for Cash cafés too (AB#118), so the product gate belongs on the POS routes.
- **`ClassValidationPipe`.** Nest's global `ValidationPipe` handed zod-typed parameters to
  class-transformer under SWC (vitest) and every POS route 500'd in the suites while the tsc
  build answered correctly. The global pipe now validates classes only.
- **`super_admin` holds every permission key on a pristine build**: the POS files seed 132 keys
  onto the POS roles; `46_platform_bootstrap.sql` now sweeps them onto `super_admin` too, so the
  gate does not depend on the backfill's `seed_rbac.sql` having run.
- **`00_run_backfill.sh` applies the 17 POS DDL files** after the data phase and before
  `50`/`90` (they are written as migrations over existing rows), then `47`/`48` after `90`.
  Proven on the clone: reconcile 0 drift, 751 passes / 794 contacts / 783 customers / gift card
  1/1 unchanged, all 783 customers and 794 contacts carry the POS columns, 135 permission keys,
  `super_admin` missing 0, security gate 48 structural + behavioral, one acknowledged gap (MFA).
- **Generated artifacts are regenerated, never merged**: `@umi/contract` 2.12.0, `pnpm-lock`.
- **Dashboard**: build-v3's #119–#125 redesign wins (labels, platform-grant model, RegionHead);
  the branch's `operations` screen, devices "Registrar UmiPOS", and `hasRequiredPermission` are
  added beside it. The legacy Supabase login path is gone with its dependency. The dashboard build
  now requires `VITE_UMI_ENVIRONMENT` (the branch's vite config; `test` mode is exempt, so
  vitest is unaffected) — set it in the Vercel project env before the next dashboard deploy.
  CI builds only `@umi/api...`, so no workflow change.

**Flutter client verified (2026-08-23), closing the merge's one unverified flag.** On
Flutter 3.44.6, the README's toolchain: `dart format` clean (two test files the branch left
unformatted are formatted here), `flutter analyze` 0 issues, **178/178 tests**, and
`flutter build web --debug` builds — all against the regenerated `umi_contract` 2.12.0. CI
still has no Flutter job; physical-iOS signing stays a Gate 13 item. The deploy pipeline now
bakes `RELEASE_*`/`CONTRACT_VERSION` into the image (`deploy-backend.yml`), while
`UMI_ENVIRONMENT` and `EXPECTED_SCHEMA_VERSION` are VPS `.env` state — see
`apps/umi-api/docs/deploy-pipeline.md`.

AB#118 is largely delivered by the merge for the POS (`POST /api/v1/auth/pos/pin-login`, device
enrolment, `merchant.staff.operator_pin_*` issued from the staff screen); the register's own PIN
door is still to wire. AB#119's elevation grant is wired for the POS (`pos-entry`,
`manager_approval` / `operator_pin`); the Cash register path remains.

#### ✅ Dashboard refresh rotation and logout revocation complete

AB#114 now gives dashboard refresh tokens a durable server-side session. Login stores only a
SHA-256 token hash. Refresh rotates the token inside one family. Reuse of an old token revokes the
live family, and logout revokes the family before it clears the cookie. `runtime.session` permits a
NULL `merchant_id` only for a `user` row whose metadata identifies the dashboard.

This is necessary because dashboard login happens before café selection. A platform operator can
have no café membership. Cash customer, staff, and device sessions stay merchant-scoped.

The behavior follows [RFC 9700 section 4.14.2](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2)
for rotation and replay detection and [RFC 7009 section 2](https://www.rfc-editor.org/rfc/rfc7009.html#section-2)
for revocation. A five-merchant production-shaped clone passes reconciliation and the full security
gate. A fresh Build v3 database passes all 77 schema integration tests. Existing dashboard refresh
cookies have no durable session row, so the deployment will require one new dashboard login. An
access token already issued at logout can live until its 15-minute expiry; logout prevents any new
access token from that refresh family.

**DoD.** Prod `security_gate.sql` PASS; both clients live on build-v3; **a pre-cutover Apple pass
updates on a real device after the flip.**

---

## 5 · Current baseline (2026-08-21)

> **Next, in order.**
>
> 1. **P6 production deployment evidence D4–D10.** D3 now passes 5/5 on the current rehearsal.
> 2. **Finish P7**, including the bootstrap-holder MFA decision, production routing, signer
>    credentials, APNs, Google, and the pre-cutover-pass update on a real phone.
>
> Two cross-cutover items must not be lost:
>
> - The production bootstrap holder needs recorded **MFA evidence**. The current rehearsal has one
>   active platform holder and zero enrolled holders, so the gate reports an acknowledged gap.
> - **Ask the acquirer in writing which PCI questionnaire applies to UmiPOS.** SAQ P2PE would drop
>   Requirements 7, 8 and 10 from scope entirely, so the answer changes how much of the access work
>   above is obligatory rather than merely correct. Ask at contract time, not after.

- **Evaluated base:** `origin/build-v3` at `c9d4f6d4c1e796bfda1c4d6e1546f6c362f6d5af`,
  which merged dashboard-session PR **#130**. PR **#128** closed Gift Card convergence. PR **#129**
  enforced the customer-token audience. PR **#130** added dashboard refresh rotation, replay
  detection, and logout revocation. Azure Boards marks #9–#13 as closed with dated evidence.
- **Earlier merge sequence:** PR **#66** added Cash loyalty convergence. PR **#67** added birthday
  grants. PR **#68** added the conversation pipeline. PR **#69** removed residue from the Cash
  rename. PR **#70** added Customer 360. PR **#71** moved leads to `umi.prospect`.
- **The last four PRs came in from a different direction.** #73 to #76 were not planned on this
  spine; they arrived with the UmiPOS integration and then with a design question the owner asked
  about it ("a staff member is not a user but still holds a PIN"). They land here because they moved
  the same numbers. #75 in particular renamed the model — `tenant` → `merchant`, `branch` →
  `location` — throughout this document and everything it points at.
- **Preflight: 0 unresolved · 0 `42883` · 3 explicitly uncovered.** Measured on a PRISTINE build — `00→90` into a throwaway
  database — so the number reproduces on any machine with a Postgres and needs no prod snapshot. It
  is NOT comparable to the 81 recorded below, which was measured against `umi_backfill_v3` with the
  source schemas still present. Track: **26** (2026-07-29 pristine) → **18** (hours closed) →
  **15** (staff closed) → **7** (slug closed) → **0** (gift cards closed). The last bucket is now closed:

  | bucket         | n     | cause                                                                                                                | owner |
  | -------------- | ----- | -------------------------------------------------------------------------------------------------------------------- | ----- |
  | ~~gift cards~~ | ~~7~~ | ~~`loyalty_gift_card.amount_cents` / `redeemed_at`, `loyalty_gift_card_ledger.source_type`~~ — **closed 2026-08-19** | P4 ✅ |
  | ~~slug~~       | ~~8~~ | ~~`merchant.slug`, `location.slug` / `aliases`~~ — **closed 2026-08-01**                                             | P5 ✅ |
  | ~~staff~~      | ~~3~~ | ~~`staff.name` → `umi.user`~~ — **closed 2026-08-01 (#76)**                                                          | P1 ✅ |
  | ~~hours~~      | ~~8~~ | ~~`merchant.open_hours` missing, `merchant.config`~~ — **closed 2026-07-29 (#74)**                                   | P1 ✅ |

  No measured backend statement now addresses a missing relation, column, function, or conflict
  target. Three interpolated statements remain explicitly uncovered by the reconstruction gate:
  two in `kds.repository.ts` and one in `cash.repository.ts`. They are unmeasured coverage debt,
  not known schema failures.

- **The current local gate has one acknowledged gap, and its platform-MFA row is no longer
  vacuous.** The clean rehearsal selected `hola@umiconsulting.co` as the bootstrap holder. The
  target has one active platform holder and zero enrolled holders. Across all nine users, zero have
  a non-null `mfa_method`; zero active staff memberships belong to an MFA-enrolled user. The Cash
  bypass in AB#115 is therefore latent in this snapshot — and now CLOSED by refusal (see P7
  item 2) — while bootstrap-holder enrollment remains
  a real P7 blocker. `umi.user` carries `mfa_method` and `mfa_enrolled_at`, and the dashboard
  understands the MFA challenge contract; production still needs the factor enrolled or an explicit
  owner-approved disposition.

  ⚠️ **The gate was over-reporting.** It scanned backtick spans over raw file text, so a doc
  comment that QUOTES SQL counted as a statement: `kds.repository.ts` explains a rewrite with
  "Replaces the old \`SELECT kitchen_status FROM ops.orders FOR UPDATE\`" and the gate reported it
  as unresolved against a table that is supposed to be gone. Comments are now blanked before
  scanning, preserving offsets so line numbers stay true. This matters because P1's DoD is
  **0 unresolved**, and a false positive makes that unreachable except by deleting a correct
  comment — a gate that cannot reach zero is one people learn to read past.

- **Preflight (2026-07-25, historical):** **81** unresolved · **0** `42883`. Measured against
  `umi_backfill_v3` rebuilt with the device- and loyalty-cluster deltas.
  ⚠️ **The earlier jump 140 → 171 was the gate no longer under-reporting, not a regression** — the 46
  interpolated statements were counted but unlooked-at, and `products.repository.ts` was failing every
  one (it read `p.price_cents`/`p.variants` where build-v3 has `price` and relational variants); the
  detail report also caps each error code at 40, so a sample read like a worklist. From 171: catalog
  −13, checkout −7 (both files gone from the rollup), then **#63 retired the KDS read/write half and
  #65 the auth half — `kds/kds.repository.ts` is now absent from the rollup entirely (40 → 0).**

- **Units:** 749/749. **Schema integration:** 77/77. **Migration integration:** 24/24.
  **Typecheck/lint:** PASS. On the current bootstrap-holder rehearsal, `security_gate.sql` passes 48
  structural and 3 behavioral checks and reports the one MFA gap above. Snapshot reconciliation
  passes exact card rows, exact ledger rows, and per-card balances with zero mismatches.
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
  required `lint` context from ever reporting. One ruling from it still holds: Prettier is **not
  idempotent** on some files — 3 specs needed a second pass before `--check` agreed. Formatting
  commits are listed in `.git-blame-ignore-revs`.
  See `docs/reports/2026-07-21-linting-toolchain-research.md`.
  ⚠️ **The other ruling was REVERSED and this line said otherwise until 2026-08-01.** It read
  "Markdown is excluded from Prettier entirely". `.prettierignore:48` now states the opposite in
  as many words: `docs/` and the root `.md` files ARE formatted, and the single carve-out is
  `.agents/skills/`, excluded to protect the `.claude/skills` symlink invariant rather than for
  being prose. A stale ruling in a living document is worse than no ruling — somebody reads it and
  skips the gate.
- ⚠️ **`apps/umi-landing-page` has a failing test, and NO workflow runs it.** `diagnostic-trigger`
  "Debe respetar emails ya enviados" fails: an already-sent Day-0 welcome email is still queued, i.e. a
  duplicate welcome to a lead. Pre-dates the format pass and PR #56 (fails at `ea7647e`). Not live — the
  sequence engine is dormant behind `LEADS_SEQUENCE_ENABLED` — but it is unowned and invisible, because
  `lint` is the only gate covering that package. Fix or delete the test before the leads cutover.

### The former 7, now closed

`pnpm run test:integration:schema` prints this rollup untruncated. It replaced an earlier by-error-code
table that was built from the capped detail report and therefore under-counted.

| File                            | Before | Now | Owning track     |
| ------------------------------- | -----: | --: | ---------------- |
| `cash/cash-write.repository.ts` |      6 |   0 | gift cards P4 ✅ |
| `cash/cash.repository.ts`       |      1 |   0 | gift cards P4 ✅ |

The slug bucket was **8, not the 7 the table above used to claim**. The eighth was
`cash.repository.branding`, filed under gift cards because that file is mostly gift cards. It was
neither: a dead join plus a jsonb column that no longer exists. Counting by FILE hid it, and the
bucket owner stayed wrong until somebody read the statement.

**Everything else is off the list.** The tracks that emptied, with the PR that emptied them: KDS
(#63 / #65, 40 → 0) · catalog and checkout (#62) · cash vocabulary, card and branding (#66 / #67,
34 → 9) · conversation pipeline, `conversation-turns`, `memory`, `messages`, `turn-commit`,
`voice-settings` (#68) · `lifecycle` (#69) · `customers` (#70) · `leads` (#71, and that bucket of 10
had been invisible until the rollup stopped truncating) · `hours`, `ordering-settings`,
`merchant-config` (#74) · `staff` (#76).

**`42883` remains 0** (`umi.e164` and the two `merchant.normalize_*` functions resolved it), and
`42P01` is 0 as well — no statement now names a missing table.

> ### ✅ RESOLVED: the KDS auth substrate was three thin tables, not a rename
>
> The pairing/session/device cluster looked like a column rename but was the same "built to the
> wrong guess" defect as `merchant.station`, on the sealed auth substrate:
>
> - **`runtime.session`** shipped `user_id NOT NULL` + `app` — a login model NOTHING uses. The
>   live writers (`kds.repository.ts` `'device'`, `cash/customer-session.service.ts` `'person'`/`'user'`)
>   need a polymorphic `(principal_type, principal_id)` session with a UNIQUE `token_hash`. Reshaped.
> - **`runtime.pairing`** shipped `(device_id NOT NULL, code text)` — plaintext, and structurally
>   backwards (the device is the pairing's OUTCOME, created on approval). Rebuilt with `pin_hash`/`pin_salt`,
>   the approval workflow, and `device_id` NULLABLE under `CHECK ((status='used') = (device_id IS NOT NULL))`.
> - **`runtime.device_session`** had zero code readers — a speculative device home the code never used
>   (device sessions live in `runtime.session`). Dropped, and removed from the `90_rls`/`security_gate` seal.
> - **`merchant.device`** lacked `station_id`/`updated_at` its writers set, and used `kind`/`retired`
>   where the code said `device_type`/`archived` — adapted at the query boundary (backend, not schema).
>
> The auth substrate stayed sealed throughout (`security_gate.sql` 25+3 PASS: `api` has zero privilege
> on the runtime auth tables). The backfill now carries the incumbent iPad's `token_hash` into
> `runtime.session`, so Kalala's live device rides through cutover instead of going dark on next reinstall.

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

**A separate number, and do not read it as the one above.** 15 statements are still UNCOVERED —
the gate cannot reconstruct them, so it can neither pass nor fail them: `lifecycle`×4,
`trace.service`×4, `auth`×2, `kds`×2, `cash`×1, `conversation-turns`×1, `merchants`×1. Named, not
just counted. That this equals today's 15 unresolved is a coincidence of arithmetic. An uncovered
statement is an unmeasured one, and history says those are where the schema surprises hide — the
product catalog was uncovered until the gate learned to reconstruct interpolated SQL, and it was
13 broken statements sitting in the P4 order track's path.

---

## 6 · Out of scope / accepted residuals

- **Per-policy `session_can_access_merchant()`** — rejected as over-engineering for 5 cafés; the GUC
  choke-point suffices. Revisit if merchant count / role complexity grows.
- **`runtime.otp`** — stays as an unused future table (WhatsApp-OTP).
- **Outbound-message enqueue** — worker-only until a SECURITY DEFINER stamps origin `merchant_id`
  (`api` has no `runtime.outbox_event` DML by design).
- **`umi.user` row enumeration** — credentials column-locked; identity columns readable cross-merchant
  unless routed through the scoped staff join. Low sensitivity.

---

## 6b · The DDL freeze — two regimes, and the cutover between them

**The cutover date is the boundary.** Before it, the schema changes by editing the
numbered DDL files. After it, the schema changes by adding a forward migration.
Nothing else changes about how the schema is built.

| Regime                 | How the schema changes                                           | Why                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BEFORE the cutover** | Edit `00_foundation.sql` … `90_rls.sql`.                         | No production database carries this schema. CI applies the DDL from scratch to an empty database on every round, so an edit is free and a migration is ceremony.  |
| **AFTER the cutover**  | Add a file to `migrations/`. **Never edit a numbered DDL file.** | A production database carries the schema AND the data. An edit to the DDL changes what a NEW database gets, and does nothing to the one that holds the customers. |

⚠️ Do not edit a numbered DDL file after the cutover, even to correct a mistake.
The correction must reach the live database, and only a migration does that. The
numbered files become a record of what was applied on cutover day, not a
description of production.

**The rules a migration must satisfy** are in
[`migrations/README.md`](migrations/README.md). Two are enforced, and both were
written after the file that broke them:

1. **The same file applies twice.** `90_rls.sql` carried 21 `create policy` and
   zero `drop policy`, so a second apply died with `policy "merchant_isolation"
for table "merchant" already exists`. Every policy is now guarded, and CI
   applies `90_rls.sql` and every migration **twice** on each round.
2. **The append-only tables stay closed.** NINE tables refuse every UPDATE and
   DELETE, and two of them hold money. A migration that must rewrite a row calls
   `merchant.with_append_only_writable`, which restores the previous trigger state
   on every path — including the path where the caller traps the error and
   commits. A bare `alter table … disable trigger` leaves the table open when the
   next statement fails, and `balance = SUM(delta)`, so a rewritten ledger row
   changes a customer balance and leaves no record of the change.
   `migration-shape.spec.ts` fails a migration that writes the bare form, or that
   sets `session_replication_role`.

**What is NOT proven by CI.** Each migration applies to the gate database, which
holds the DDL and the RBAC seed and no customer rows. A migration that adds a
`not null` column meets no rows there and passes. **Rehearse every migration
against a populated copy** — the command list is in the README.

---

## 7 · Re-run cadence

- **Every schema / grant / backfill change:** `security_gate.sql` + `sql-preflight` + `check-values`
  in CI (blocks merge). The last two run in the same `npm run test:integration` suite; a CHECK that
  narrows its allowed values is exactly when the fourth instrument earns its place.
- **Every phase:** rebuild `umi_backfill_v3` via `backfill/00_run_backfill.sh`, then gate + reconcile +
  preflight; record the new preflight number in §5.
- **Before every cutover rehearsal:** full 19-agent audit + Deployment-Gate evidence refresh.
