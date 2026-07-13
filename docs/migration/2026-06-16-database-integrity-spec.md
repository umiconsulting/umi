# Umi Database Integrity Spec

**Date:** 2026-06-16
**Status:** The hard acceptance bar. **The database has integrity iff every check
below returns its expected result.** Grounded in an audit of the `2026-06-16`
migration plan DDL — affirms what is implemented and names what is not.

> Companion to `2026-06-16-execution-runbook.md`. Names are canonical (`core`/
> `loyalty`/`ops`, post-Phase-G). Before Phase G the physical names are
> `platform`/`cash`/`commerce`.

---

## Integrity scorecard (audit of current DDL)

| Class | Mechanism | Status |
|---|---|---|
| Referential / cross-tenant write | `UNIQUE(tenant_id,id)` + composite FK `(tenant_id,ref_id)` | ✅ **Implemented** (plan §5.5) |
| Financial — append-only | `block_append_only_mutation()` trigger on `points_ledger`, `gift_card_ledger`, `wallet_transactions` | ⚠️ Implemented but **marked "optional"** (§5.4) — **G3** |
| Financial — conservation | `SUM(source) == SUM(ledger.delta) == SUM(balances)` gates | ✅ Implemented (§6.6, §10.2) |
| Financial — idempotency | `idempotency_key text unique` on ledgers | ✅ Implemented |
| Tenant isolation — flag | `tenant_id NOT NULL` on tenant-scoped tables | ✅ Implemented |
| Tenant isolation — RLS on | `ENABLE` + `FORCE` on every tenant-scoped table, all six schemas incl. `core` | ✅ **Closed — `050_rls_tenant_isolation.sql` (was G2)** |
| Tenant isolation — **policies** | `tenant_isolation` `FOR ALL` policy (USING + WITH CHECK) per table | ✅ **Closed — `050_rls_tenant_isolation.sql` (was G1)** |
| Identity — uniqueness | partial unique on **verified** `(tenant,kind,normalized_value)` | ⚠️ Verified-only; dedup of unverified relies on `resolve_contact()` — **G4** |
| Identity — account grain | one `loyalty.accounts` per person per program | ⚠️ Plan creates per **card** — **G5** |
| Deletion / GDPR | ledger deletes blocked; people anonymizable | ⚠️ PII partly in opaque JSONB — **G6** |

---

## Must-close gaps (priority order)

### G1 — Tenant-isolation policies — ✅ CLOSED by `050_rls_tenant_isolation.sql`
**Was:** §5.7 ran `ENABLE ROW LEVEL SECURITY` but defined **no policies**, and
`001_platform_core.sql` defined only `FOR SELECT` membership policies with no
`FORCE`. Result: zero write-side isolation, owner bypass, and deny-all (or no
isolation) on `cash/commerce/comms/device/kitchen`.

**Reconciliation that mattered:** the repo already had a tenant-context
convention in shipped SQL — `app.user_id` + `platform.can_access_tenant()`
(a `SECURITY DEFINER` membership lookup) — which is *stronger* than the raw
`app.current_tenant` GUC this spec originally proposed: the app asserts **who**,
the database derives **which tenants**, so the app cannot scope itself into a
tenant the principal does not belong to. The fix standardizes on that and adds
the missing request-scoping layer.

**Tenant-context contract (the app sets BOTH, per request, with `set local`):**
- `app.user_id`   — the authenticated principal (`core.users.id`)
- `app.tenant_id` — the single active tenant for this request

The canonical predicate `core.rls_tenant_check(tenant_id)` =
`tenant_id = app.tenant_id` **AND** principal is an active member of that tenant.
Both layers required; omitting either GUC ⇒ zero rows (default-deny). Applied as
a single `tenant_isolation` `FOR ALL` policy (USING + WITH CHECK) on **every**
tenant-scoped table in all six schemas, with `FORCE ROW LEVEL SECURITY` so the
table owner is subject too. Nullable-`tenant_id` (global catalog) rows stay
readable but writes remain confined to the active tenant.

**Service-role concern resolved, not waved away:** `umi_app` (the request role)
is asserted to be non-`SUPERUSER`/non-`BYPASSRLS` (migration raises otherwise);
`umi_worker` is explicitly `BYPASSRLS` for cross-tenant jobs. ⚠️ `SECURITY
DEFINER` service functions that run cross-tenant (`resolve_contact`,
`award_points`, workers) **must be owned by a BYPASSRLS role** or `FORCE` will
starve them of rows — verify function ownership after creating them.

### G2 — `core` excluded from RLS — ✅ CLOSED by `050_rls_tenant_isolation.sql`
`core`/`platform` is now in scope. `core.people`, `core.contact_methods`,
`staff_members`, etc. get the tenant policy; `core.tenants` keys on `id`;
`core.tenant_memberships` additionally lets a principal read their **own**
memberships (tenant discovery) before an active tenant is chosen; `core.users`
(no `tenant_id`) gets a **self-access** policy (`id = app.user_id`), not a
tenant-wide one. The migration self-verifies (gate checks 2 & 3 run inline and
`RAISE EXCEPTION` if any tenant-scoped table lacks RLS + FORCE + policy).

### G3 — Append-only must be mandatory, not "optional"
§5.4 adds ledger triggers only "if live cash does not already have ledger
protections." For financial integrity this must be a **verified invariant**:
assert the trigger exists on all three ledger tables; fail the gate if absent.

### G4 — One normalizer (identity integrity)
Migration dedup and runtime `resolve_contact()` must both call
`core.normalize_phone()`. Inline `regexp_replace` produces different keys → split
people → split loyalty/memory. (Runbook D4.)

### G5 — Account grain
One `loyalty.accounts` per **person per program**, not per card. Preflight asserts
cards-per-user; dedupe accounts where a user holds >1 card. (Runbook D5.)

### G6 — PII reachable for GDPR
Gift-card recipient phone/email and any PII must live in typed columns or a
documented JSONB path the anonymization routine explicitly covers. Ledger rows are
never deleted (financial audit) — only anonymize the person + contact_methods.

---

## Integrity gate (run as the final acceptance bundle — all must pass)

```sql
-- 1. No tenant-scoped table missing tenant_id.  Expect 0 rows.
select table_schema, table_name
from information_schema.columns
where table_schema in ('core','loyalty','ops','comms','device','kitchen')
  and table_name not like 'v_%'
group by table_schema, table_name
having count(*) filter (where column_name='tenant_id') = 0;

-- 2. No tenant-scoped table without RLS.  Expect 0 rows.
select n.nspname, c.relname
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind='r' and n.nspname in ('core','loyalty','ops','comms','device','kitchen')
  and not c.relrowsecurity;

-- 3. (G1) No tenant-scoped table without a policy.  Expect 0 rows.
select n.nspname, c.relname
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind='r' and c.relrowsecurity
  and n.nspname in ('core','loyalty','ops','comms','device','kitchen')
  and not exists (select 1 from pg_policies p
                  where p.schemaname=n.nspname and p.tablename=c.relname);

-- 4. (G3) All three ledgers carry the append-only trigger.  Expect 3 rows.
select tgrelid::regclass as ledger
from pg_trigger
where tgname like '%append_only%' and not tgisinternal;

-- 5. Financial conservation (re-run on the FRESH dump).  Expect source=target.
select (select coalesce(sum("balanceCentavos"),0) from <fresh_source>."LoyaltyCard") as source_cents,
       (select coalesce(sum(delta),0) from loyalty.points_ledger
        where reason='migration_initial_balance') as ledger_cents,
       (select coalesce(sum(balance),0) from loyalty.balances) as balances_cents;

-- 6. (G5) Account grain: no duplicate accounts per person per program.  Expect 0.
select tenant_id, person_id, program_id, count(*)
from loyalty.accounts group by 1,2,3 having count(*) > 1;

-- 7. (G4) Identity: no two people in a tenant share a normalized phone.  Expect 0.
select cm.tenant_id, cm.normalized_value, count(distinct cm.person_id)
from core.contact_methods cm where cm.kind='phone'
group by 1,2 having count(distinct cm.person_id) > 1;

-- 8. Orphans: every loyalty account points to a real person.  Expect 0.
select a.id from loyalty.accounts a
left join core.people p on p.tenant_id=a.tenant_id and p.id=a.person_id
where p.id is null;

-- 9. Every source table accounted for — migration-plan §10.1.  Expect full coverage.
-- 10. Append-only actually blocks: in a throwaway tx, UPDATE a ledger row → must RAISE.
```

**Definition of done for "database integrity":** checks 1–9 return their expected
results on the post-migration DB built from the fresh dump, and check 10 raises
the append-only exception. Then — and only then — is the data safe to serve from.

---

Related: `platform-database-architecture.md` (§1 tenancy invariants),
`2026-06-16-canonical-schema-and-identity.md`, `2026-06-16-migration-plan.md` §10.
