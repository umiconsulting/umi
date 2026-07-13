# Canonical Schema Names & Identity Mapping — Reconciliation

**Date:** 2026-06-16
**Status:** Normative. Supersedes conflicting names/mappings in any migration doc.
**Why this exists:** `platform-database-architecture.md`, `2026-06-16-migration-plan.md`,
and the two `2026-06-15-*` migration docs disagree on schema names and on how
Cash `User` rows map into identity. This note pins one answer. Both migration
plans must be edited to conform before any backend/API code is written.

---

## 1. Canonical schema names (the spec wins)

`platform-database-architecture.md` is the source of truth. Domain names, not
product names. Any migration doc still using the "supersedes" column is wrong.

| Canonical | Holds | Supersedes (do not use) |
|---|---|---|
| `core` | identity & tenancy | `platform` |
| `ops` | orders, catalog, payments | `commerce` |
| `comms` | conversations, memory, knowledge | (conversaflow conversation/memory tables) |
| `loyalty` | points, rewards, wallet, passes | `cash` |
| `device` | hardware pairing, sessions | (kds device tables) |
| `kitchen` | station config | (kds station tables) |
| `queue` | jobs, outbox, webhooks, idempotency | `pipe`, conversaflow job/outbox tables |
| `observability` | traces, audit, logs | (kept) |
| `grow` | leads, subscriptions, feature flags | platform.leads/product_instances |

Column-name reconciliation: identifiers table is **`core.contact_methods`**
(not `contact_identities`). The async schema is **`queue`** (not `pipe`).

If the migration physically lands data in interim schemas, that is allowed ONLY
if the final phase renames them to the canonical names **before** app code binds
to any schema. Preferred: migrate straight into canonical names.

---

## 2. Canonical identity mapping (roles are edges)

Per `argument-against-type-column.md`: a human's role is a relationship, never a
column or a metadata tag.

- **`core.people`** — one row per human per tenant (customer, staff, owner). NO
  `role`, NO `type`, NO `password_hash` in this table or its `metadata`.
  `metadata` carries only non-sensitive migration provenance (`legacy_id`).
- **`core.users`** — the login / auth principal. **`password_hash` lives here**
  (or a dedicated `core.auth_credentials`), with `REVOKE ... FROM umi_app` (the
  request role; see D6 in §2.1). Optional `users.person_id` links a staff login
  to its person.
- **`core.contact_methods`** — phone/email/whatsapp, normalized via the shared
  `core.normalize_phone()` → E.164. Same function the runtime uses.
- **`core.tenant_memberships` + `roles` + `membership_roles` + `permissions`** —
  RBAC. Roles attach to the membership, not the human.
- **`core.staff_members`** — tenant-scoped operational roster.

### Cash `User` row mapping (canonical)

| Source `role` | Maps to |
|---|---|
| `CUSTOMER` | `core.people` + `core.contact_methods` (+ `loyalty.accounts`) |
| `ADMIN` / `STAFF` | `core.people` (they are humans) **+ `core.users` (holds password_hash) + `core.tenant_memberships` (role) + `core.staff_members`** |

**Forbidden:** writing `role` or `password_hash` into `core.people.metadata`
(the original `2026-06-15-cash-to-platform-migration.md` Step 5 pattern — now
**archived** in `docs/migration/archive/`). Use the `2026-06-16` §7.2 approach
(`dashboard_users → tenant_memberships`, staff → `staff_members`) everywhere.

---

## 2.1 Connection roles vs. user authorization (D6 — locked 2026-06-17)

Two different layers; never conflated:

- **Connection identity → `pg_roles`, fixed at three.** `umi_app` (RLS-enforced
  request role; non-superuser, non-`BYPASSRLS`), `umi_worker` (`BYPASSRLS`
  service/background), `umi_readonly` (analytics). The backend connects as
  `umi_app` and sets `app.user_id` + `app.tenant_id` per request (`set local`).
  These roles never grow with tenants or users. RLS is only real because
  `umi_app` cannot bypass it — a real restricted login role is therefore
  mandatory; this enforcement cannot live "in the backend."
- **User authorization → data + backend.** Owner/admin/staff/cashier are rows in
  `core.membership_roles` + `permissions` (roles as edges, per §2). The backend
  gates endpoints; tier-1 `SECURITY DEFINER` RPCs re-check the sensitive writes.
  **Never** a Postgres role per tenant, per user, or per business role.

Consequence for the migration SQL: every Supabase `authenticated` grant →
`umi_app`; `service_role` → `umi_worker`; `anon` dropped. Applied in
`2026-06-16-migration-plan.md` §5.1/§5.7 and `local-postgres/050_rls_tenant_isolation.sql`.

---

## 3. Data-safety rules for the Cash absorption (production)

The migration mechanics are sound (read-only source, per-phase backups,
financial reconciliation, append-only ledger, idempotency keys, per-phase
rollback). These rules close the remaining production-data risks:

1. **Source of truth = the LIVE Cash project `rrkzhisnadfrgnhntkiz`, dumped
   fresh (<24h) immediately before cutover.** The copied `umi_cash.*` schema and
   the 2026-05-15 transition snapshot are STALE — never migrate balances from
   them. Use one unambiguous source qualifier everywhere (`umi_cash."LoyaltyCard"`
   vs `cash.public."LoyaltyCard"` vs `public."LoyaltyCard"` must be unified).
2. **Zero-downtime posture (keep).** Cash keeps serving on the old project
   through a 7-day soak; cutover only flips `DATABASE_URL`; rollback = `TRUNCATE`
   target rows tagged by `_migration` maps. Production source is never mutated.
3. **Financial conservation gate (hard stop).**
   `SUM(source balanceCentavos)` == `SUM(loyalty.points_ledger.delta WHERE reason='migration_initial_balance')` == `SUM(loyalty.balances)`.
   Any mismatch halts the phase. Re-run this on the FRESH dump, not the snapshot.
4. **Idempotency (keep).** Initial-balance ledger insert keyed by
   `idempotency_key = 'migrate_cash_card_' || old_id`. Re-runs cannot double-credit.
5. **Password hashes → `core.users` only**, with grants revoked from `umi_app`
   (the request role; D6). They must never land in a person row surfaced by
   customer-360 or the dashboard API.
6. **One phone normalizer.** Migration dedup calls `core.normalize_phone()` /
   `resolve_person()` — never an inline `regexp_replace`. Migration and runtime
   must agree or migrated rows split into duplicate people.
7. **One `loyalty.accounts` per person per program**, not per card. Preflight:
   assert cards-per-user; dedupe accounts by person where a user holds >1 card.
8. **No `LIMIT 1` in any mapping**, including `program_id` selection. Map
   deterministically or fail loudly.
9. **PII placement.** Gift-card recipient phone/email and any PII must be in
   typed columns or a documented metadata path that GDPR anonymization (§10.4)
   explicitly covers. PII buried in arbitrary JSONB is a deletion blind spot.

---

## 4. Conformance checklist (do before backend code)

- [ ] `2026-06-16-migration-plan.md` re-pointed to canonical schema names (or a
      final rename phase added) and `contact_identities` → `contact_methods`.
- [x] `2026-06-15-cash-to-platform-migration.md` **archived** (its
      role/password-in-metadata mapping is out of the live set; canonical staff
      routing — `users` + `memberships` + `staff_members` — is §2 above).
- [ ] Migration calls `core.normalize_phone()` instead of inline regex.
- [ ] Single, unambiguous Cash source reference; fresh-dump gate enforced.
- [ ] Financial conservation gate re-run on the fresh dump passes with 0 mismatch.

Related: `platform-database-architecture.md`, `argument-against-type-column.md`,
`2026-05-23-api-backend-centralization-audit.md`.
