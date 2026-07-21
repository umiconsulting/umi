# Umi Unification — Master Execution Runbook

**Date:** 2026-06-16
**Status:** Execution-ready. Hand this to a single agent.
**Scope:** Database merge (2 DBs → 1) · identity unification · auth consolidation ·
backend/API build · domain cutover.

---

## 0. How to use this runbook

This is the **orchestration layer**. It decides the order, the gates, and the
corrections. It does **not** reproduce the detailed migration SQL — that lives in
the referenced plans. Read these three as the source of truth, in this order:

1. `docs/architecture/platform-database-architecture.md` — the target design (north star).
2. `docs/architecture/2026-06-16-canonical-schema-and-identity.md` — canonical names + identity mapping + Cash data-safety rules.
3. **This runbook** — the sequence, gates, and the new auth/domain/API work.

**Conflict rule:** on schema/table names and identity placement, the canonical
note wins. On sequence, gates, and rollback, this runbook wins. The detailed SQL
lives in `2026-06-16-migration-plan.md` (the executor). The earlier
`2026-06-15-cash-to-platform-migration.md` is **superseded and archived**
(`docs/migration/archive/`); its corrections are folded into the executor + this runbook.

**Do not improvise** schema names, table names, or identity placement. They are decided.

---

## 1. Decisions locked here

### D1 — Schema naming (✅ LOCKED — owner-confirmed 2026-06-16: `core`/`loyalty`/`ops`)

The architecture spec mandates domain names (`core`/`loyalty`/`ops`). The
migration plan deliberately kept the existing physical names
(`platform`/`cash`/`commerce`, _"Do not create core"_) to avoid churning live
Supabase dependencies. **Resolution (confirmed): rename to the spec names.**

> Migrate data into the **existing physical names** (`platform`/`cash`/`commerce`)
> using the plan's verified SQL, then run **one atomic catalog rename** to the
> canonical names (`core`/`loyalty`/`ops` + `contact_identities`→`contact_methods`)
> in **Phase G — after data is verified, before any consumer is repointed.**
> `ALTER SCHEMA … RENAME` is instant and atomic; this gets the spec's clean names
> with zero re-churn of the migration SQL.

**Fallback (rejected unless forced):** only if the Phase G staging dry-run uncovers
a hard live dependency that makes the rename unsafe, keep physical names + canonical
**compatibility views**. Default path is the rename.

### D2 — Identity placement (locked)

Roles are edges. `password_hash` → `core.users` only. No `role`/`password_hash`
in `core.people.metadata`. `CUSTOMER` → `people` (+contact_methods, +loyalty
account). `ADMIN`/`STAFF` → `people` **+ `core.users` + `tenant_membership` (role) + `staff_members`**.

### D3 — Identifier table shape (locked)

The identifier table is `core.contact_methods` with the **spec's columns**
(`kind`, `normalized_value`, `display_value`, `is_primary`, `verified_at`) — not
the old `contact_identities` shape. The `2026-06-16` plan's `contact_identities`
inserts must be adapted to this shape.

### D4 — One phone normalizer (locked)

`core.normalize_phone()` (E.164, MX `+52 1` handling) is the only normalizer.
Both migration dedup and runtime `resolve_contact()` call it. No inline
`regexp_replace` anywhere.

### D5 — Loyalty account grain (locked)

One `loyalty.accounts` row **per person per program**, never per card. Preflight
asserts cards-per-user; dedupe accounts by person where a user holds >1 card.

### D6 — Connection role model (✅ LOCKED — owner-confirmed 2026-06-17)

`pg_roles` carries **connection identity** only, fixed at three: `umi_app`
(RLS-enforced request role, non-superuser/non-`BYPASSRLS`), `umi_worker`
(`BYPASSRLS` service/background), `umi_readonly` (analytics). The backend connects
as `umi_app` and sets `app.user_id` + `app.tenant_id` per request. **User
authorization** (owner/admin/staff/cashier) is data (`core.membership_roles` +
`permissions`) + backend checks — never a Postgres role per tenant/user/business
role. All Supabase `authenticated` grants → `umi_app`, `service_role` →
`umi_worker`, `anon` dropped. See `2026-06-16-canonical-schema-and-identity.md` §2.1.

---

## 2. Non-negotiable guardrails (every phase)

1. Physical backup before each phase; run each phase on a restored **staging** copy first.
2. Session preamble: `lock_timeout=5s`, `statement_timeout=5min`, `idle_in_transaction_session_timeout=5min`.
3. **Source of truth = a FRESH dump (<24h) of the live Cash project `rrkzhisnadfrgnhntkiz`.** Never the stale `umi_cash.*` copy or the 2026-05-15 snapshot. One unambiguous source qualifier everywhere.
4. No destructive cleanup in data phases. Rollback deletes only rows tagged by `_migration` maps.
5. Each data phase writes to `_migration.phase_runs`. Money inserts carry idempotency keys.
6. **A phase's verification gate must return zero mismatches before the next phase.**
7. No `LIMIT 1` in any mapping (including `program_id` selection).
8. **Tenant isolation = RLS enabled + FORCE + a `tenant_isolation` policy**, on
   every tenant-scoped table, all six schemas. Implemented by
   `local-postgres/050_rls_tenant_isolation.sql` (closes G1/G2). Model: app sets
   `app.user_id` **and** `app.tenant_id` per request (`set local`); the policy
   predicate `core.rls_tenant_check()` requires the row's tenant == active tenant
   **and** an active membership. `umi_app` must be non-`SUPERUSER`/non-`BYPASSRLS`;
   `umi_worker` is `BYPASSRLS`. See `2026-06-16-database-integrity-spec.md` — the
   hard acceptance bar for this whole migration.

---

## 3. Phase sequence

> Sequencing invariant (from the workspace plan): **database consolidation →
> backend consolidation → domain cutover.** Each phase: Goal · Actions · Gate · Rollback.

### Phase A — Preflight & reconciliation

- **Goal:** clean inputs and aligned plans.
- **Actions:** take today's fresh Cash dump; restore to staging; apply the canonical
  note's §4 conformance edits to both migration plans (names per D1, identity per
  D2/D3, normalizer per D4); run preflight uniqueness + row/total-cents snapshot
  (`migration-plan §4`).
- **Gate:** preflight queries return 0 ambiguous rows; `_migration.preflight_counts` captured.
- **Rollback:** n/a (read-only).

### Phase B — DDL only

- **Goal:** schemas, tables, constraints, indexes, triggers, grants. No data.
- **Actions:** `migration-plan §5`. Create `core.contact_methods` with the **D3** shape.
  Install `core.normalize_phone()` + `resolve_contact()` (SECURITY DEFINER,
  `REVOKE EXECUTE FROM public`, grant `service_role`). Append-only ledger triggers on `loyalty.points_ledger`.
  Run **`local-postgres/050_rls_tenant_isolation.sql`** last (closes G1/G2): it
  enables RLS + FORCE + the `tenant_isolation` policy on every tenant-scoped table,
  the self-access policy on `users`, and self-verifies. ⚠️ SECURITY DEFINER service
  functions that run cross-tenant (`resolve_contact`, `award_points`, workers) **must
  be owned by a BYPASSRLS role** (e.g. `umi_worker`) or FORCE starves them of rows —
  set ownership when creating them.
- **Gate:** `migration-plan §5.8` verification; all target tables exist; `050`'s
  inline gate passes (every tenant-scoped table has RLS + FORCE + a policy).
- **Rollback:** `migration-plan §5.9` (drop new objects; no data touched).

### Phase C — Cash → loyalty + core

- **Goal:** move loyalty money + Cash identities, safely.
- **Actions:** `cash-to-platform-migration` Steps 1–13 / `migration-plan §6`, **with corrections**:
  D2 (staff → users+membership+staff_members, not people.metadata), D4 (normalizer),
  D5 (account grain). Mutable `balanceCentavos` → single append-only ledger entry
  per card with `idempotency_key='migrate_cash_card_'||old_id`.
- **Gate (financial — hard stop):** `SUM(source balanceCentavos)` == `SUM(points_ledger.delta WHERE reason='migration_initial_balance')` == `SUM(balances)`; row counts match (`migration-plan §6.6`).
- **Rollback:** `migration-plan §6.7` (`TRUNCATE` tagged target rows; Cash keeps running on the old project).

### Phase D — Identity unification

- **Goal:** merge ConversaFlow customers into `people`; link conversations to `person_id`.
- **Actions:** `migration-plan §7`, but dedup via `resolve_contact()` (D4), and
  route `dashboard_users → tenant_memberships`, staff → `staff_members` (D2). Guard
  the people-insert by `old_customer_id` for re-run idempotency (phone-less rows).
- **Gate:** `migration-plan §7.3`; every `conversaflow.businesses` mapped; 0 unmapped customers.
- **Rollback:** `migration-plan §7.4`.

### Phase E — Split ConversaFlow → ops / comms / queue / observability

- **Actions/Gate/Rollback:** `migration-plan §8` (memory_items keyed on `person_id`; outbox → `queue`).

### Phase F — KDS → device / kitchen / ops

- **Actions/Gate/Rollback:** `migration-plan §9` (tickets are a projection of `ops.order_items`, not a source of truth).

### Phase G — Canonicalization rename (per D1, owner-confirmed)

- **Goal:** physical names → spec names, atomically, before consumers repoint.
- **Actions (catalog-only, one transaction):**
  ```sql
  BEGIN;
  ALTER SCHEMA platform RENAME TO core;
  ALTER SCHEMA cash     RENAME TO loyalty;
  ALTER SCHEMA commerce RENAME TO ops;
  ALTER TABLE core.contact_identities RENAME TO contact_methods;  -- if D3 not already applied at DDL
  ALTER TABLE loyalty.loyalty_accounts RENAME TO accounts;
  ALTER TABLE loyalty.loyalty_cards    RENAME TO cards;
  COMMIT;
  ```
  **Then recreate** any function/view whose body hard-codes old schema names
  (`resolve_contact`, `v_customer_360`, etc.) and re-grant — `RENAME` does not
  rewrite function bodies or `search_path`.
- **Gate:** all consumers still build against the new names in staging; no dangling references (`pg_get_functiondef` scan for `platform.`/`cash.`/`commerce.`).
- **Rollback:** reverse renames (same transaction shape).

### Phase H — Auth consolidation (Cash logins → `core.users`)

- **Goal:** one login authority; **no password resets**.
- **Actions:** Cash and dashboard both use Node `scryptSync(pw,salt,64)` — hashes are
  byte-compatible. Split Cash's `scrypt:salt:hash` → `core.users.(password_salt,
password_hash, password_algorithm='scrypt-sha256-v1')`. Tag legacy `salt:hash`
  rows `sha256-legacy-v0`; dashboard verifies both formats and **rehashes to scrypt
  on next successful login**. Only `ADMIN`/`STAFF` get `core.users` rows.
- **Gate:** sample 5 Cash admins log into the new dashboard with their existing passwords on staging.
- **Rollback:** old Cash admin auth still live; remove `core.users` credential rows.

### Phase I — Backend / API build

- **Goal:** the three-tier API (see §5). Build **tier 1 first**.
- **Actions:** DB RPCs (tier 1) → deployed dashboard backend over the platform
  schema (tier 2: `/api/me/tenants`, `/api/tenants/:id/capabilities`, customer-360,
  admin CRUD) → keep edge functions narrow (tier 3). **No new Supabase edge admin API**
  (per `2026-05-23-api-backend-centralization-audit`). Delete `PLATFORM_TRANSITION_SCHEMA=false` branches per route after verification.
- **Gate:** all 13 dashboard screen flows pass against staging in `=true` mode; membership/capability endpoints return correct shapes.
- **Rollback:** per-route revert; old paths remain until each route is verified.

### Phase J — Domain cutover (Cash admin → `dashboard.umiconsulting.co`) — ⏸ DEFERRED

- **Status:** Deferred by owner (2026-06-16). Not on the critical path; tackle after
  database integrity is locked. Steps preserved below for when it's scheduled.
- **Goal:** fold the Cash **admin** surface into the unified dashboard; **keep the customer wallet on `cash.`**.
- **Actions:** attach `dashboard.umiconsulting.co` as a Vercel custom domain (alias
  `umi-dashboard.vercel.app`); after Phase H soak, redirect Cash **admin/login routes
  only** → `dashboard.umiconsulting.co/login?from=cash&tenant=<slug>` with a brief
  "Umi Cash is now part of your Umi Dashboard" interstitial; do **not** redirect
  customer-wallet routes. (Optional: parent-domain `.umiconsulting.co` cookie for
  cross-subdomain SSO later.)
- **Gate:** staff reach the new dashboard from the old URL; wallet routes unaffected; bookmarks resolve.
- **Rollback:** remove the redirect (old Cash admin login still functional).

### Phase K — Final verification

- **Actions:** `migration-plan §10` — every source table accounted for; source→target
  financial totals (re-run on the **fresh** dump); tenant-isolation (`tenant_id` + RLS) on every tenant-scoped table.
- **Gate:** 0 mismatches across §10.1–10.3.

### Phase L — Cleanup & cutover finalization

- **Actions:** deprecate live Cash project `rrkzhisnadfrgnhntkiz` to **read-only** only
  after counts + core operations match through soak; drop `legacy.*`/`public.*` after
  confirming no reads; crons → `queue` job-worker; remove duplicate Prisma + dual paths.
- **Gate:** no consumer references the old project or legacy schemas.

---

## 4. Identity & knowledge-base contract (cross-product)

- **One person per tenant** (`core.people`), resolved by **normalized phone** in
  `core.contact_methods`. Every product writes through `resolve_contact()` — one door.
- **Memory is keyed on `person_id`** (`comms.memory_items`), never on channel — so a
  WhatsApp customer (ConversaFlow) and the same phone at the POS (Cash) share one
  profile with **no ETL** (same DB, same `person_id`).
- **Voyage embeddings:** one model platform-wide (store `embedding_model`); recall
  filters `tenant_id` + `person_id` before/with the `<=>` vector search.
  **Prerequisite:** set `VOYAGE_API_KEY` and regenerate embeddings (currently 136
  products are local-only). The knowledge-base pillar is blocked until this is done.
- Per-tenant only; cross-tenant CDP is a separate **consented** `identity_subjects` layer, never an OLTP join.

## 5. API contract (the functions → where they live)

| Tier | Runtime                                                    | What                        | Examples                                                                                |
| ---- | ---------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------- |
| 1    | DB, `SECURITY DEFINER`, `service_role` only                | identity & money primitives | `resolve_contact()`, `normalize_phone()`, `award_points()`, ledger writes               |
| 2    | Deployed dashboard backend (Node) over the platform schema | admin API & reads           | `GET /api/me/tenants`, `GET /api/tenants/:id/capabilities`, customer-360, admin CRUD    |
| 3    | Edge functions (narrow)                                    | ingress / jobs / device     | `whatsapp-handler` (calls `resolve_contact`), `job-worker`, `kds-command`/`kds-pairing` |

`GET /api/me/tenants` = the active-membership query (user → active
`tenant_memberships` + roles, filtered by `status='active'` and tenant status).

## 6. Acceptance criteria (definition of done)

- [ ] Financial totals reconcile to 0 on the fresh dump (Phase C + K).
- [ ] Every source table accounted for (Phase K / §10.1).
- [ ] Schema names match the spec (D1 applied) or canonical views exist (override).
- [ ] No `role`/`password_hash` in `core.people.metadata`; password hashes only in `core.users`.
- [ ] One normalizer used by migration **and** runtime.
- [ ] Cash admins log into `dashboard.umiconsulting.co` with existing passwords; wallet routes unchanged.
- [ ] All 13 dashboard flows pass on the platform schema; no `PLATFORM_TRANSITION_SCHEMA=false` branches remain.
- [ ] Old Cash project read-only; legacy/public schemas dropped.

## 7. Status & open items

1. **D1 — schema naming:** ✅ LOCKED — `core`/`loyalty`/`ops` (Phase G atomic rename).
2. **Phase J (domain redirect) + parent-domain SSO:** ⏸ deferred — revisit when scheduling the cutover.
3. **Current focus: database integrity.** Acceptance bar = `2026-06-16-database-integrity-spec.md`; every check returns its expected result before any data is served. **G1** (tenant-isolation policies) and **G2** (`core` RLS) ✅ **closed** by `local-postgres/050_rls_tenant_isolation.sql`. Remaining: **G3** (append-only mandatory), **G4** (one normalizer), **G5** (account grain), **G6** (PII/GDPR reachability).
4. **Full-plan sweep (2026-06-17):** all stoppers catalogued in `2026-06-17-migration-stoppers-register.md`. **D6 ✅ locked**; **S2/S9** (role model → `umi_app`) ✅ applied to the executor §5.1/§5.7. Remaining executor edits before Phase A: **S1** (single source qualifier = fresh dump into `umi_cash`), **S5** (normalizer = `core.normalize_phone()`), **S6** (account grain), **S7** (append-only mandatory). Doc archival (S3/S10) pending owner call.
