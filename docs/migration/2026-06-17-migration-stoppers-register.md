# Umi Migration — Stoppers Register (full-plan sweep)

**Date:** 2026-06-17
**Purpose:** One punch-list of every stopper / confusion found sweeping the whole
migration doc set, so execution proceeds with no mid-flight ambiguity. Each item
has a precise location, the resolution, and whether it's already **DECIDED**
(just needs applying) or **NEEDS A CALL**. This is a _tracker_, not a plan — it
closes out and is deleted once every item is ✅.

**Scope swept:** `2026-06-16-migration-plan.md` (the executor), the runbook,
the integrity spec, the canonical note, both architecture docs, and the two
`2026-06-15-*` Cash-migration docs.

**Headline:** the SQL was never reconciled to the decisions. D1–D5 and the
integrity spec are correct, but the executable plan still contains old source
qualifiers, inline regex, per-card grain, an "optional" append-only section, and
a different role model. Fixing the executor to match the decisions clears the
path.

---

## Severity 1 — Blockers (an agent would do the wrong thing or stall)

### S1 — Source schema qualifier is ambiguous (3 conventions) · DECIDED

- **Where:** `2026-06-16-migration-plan.md` reads `umi_cash."…"` throughout
  (§3 lines 131–167, §4 lines 269–311, §6). `2026-06-15-cash-to-platform-migration.md`
  reads `cash.public."LoyaltyCard"` (307, 556, 846) **and** bare `public."LoyaltyCard"`
  (824, 826). Guardrail #3 says _"never the stale `umi_cash.*` copy — use a FRESH dump."_
- **Conflict:** the executor reads `umi_cash.*`, but the guardrail forbids the stale
  `umi_cash.*`. They're only consistent if `umi_cash` **is** the fresh import.
- **Resolution (one rule, everywhere):** Phase A **re-imports today's fresh dump of
  `rrkzhisnadfrgnhntkiz` into schema `umi_cash`, replacing any prior copy.** All
  source reads use `umi_cash.*`. Add this as an explicit Phase A step; delete the
  `cash.public.*` / bare `public.*` forms. One qualifier, stated once.

### S2 — App role model split: `authenticated` vs `umi_app` · ✅ RESOLVED (D6 = `umi_app`) + APPLIED

- **Where:** plan §5.1 (line 334) and §5.7 (1483–1487) `grant … to authenticated`;
  `001_platform_core.sql` + `050_rls_tenant_isolation.sql` use
  `umi_app` / `umi_worker` / `umi_readonly`.
- **Why it matters:** `authenticated` is a Supabase/PostgREST role. The stated
  direction is Postgres-first → VPS, **not** Supabase auth. RLS, grants, and the
  `050` policy `TO`/bypass model all hinge on which role the app actually connects as.
- **Resolution (D6, locked 2026-06-17):** `umi_app`/`umi_worker`/`umi_readonly`
  are canonical. **Applied:** plan §5.1 + §5.7 now grant to `umi_app`/`umi_worker`,
  `anon` dropped; canonical note §2.1 + runbook D6 record it. `pg_roles` =
  connection identity only; user authz stays in data + backend.

### S3 — Two divergent "architecture" docs · ✅ APPLIED (archived 2026-06-17)

- **Where:** `docs/architecture/platform-database-architecture.md` ("Target
  architecture specification — designed from first principles") vs
  `docs/migration/2026-06-16-platform-database-architecture.md` ("Definitive —
  grounded in live database inspection / Architecture & **Migration Plan**").
  1,122 differing lines.
- **Resolution (applied):** `docs/architecture/platform-database-architecture.md`
  is the **sole north star**; the divergent migration-dir copy moved to
  `docs/migration/archive/2026-06-16-platform-database-architecture.md`. Only the
  register referenced it; no live link broke.

### S4 — Identity D2 violation still in the 06-15 doc body · ✅ APPLIED (archived 2026-06-17)

- **Where:** `2026-06-15-cash-to-platform-migration.md` lines 105, 109 map
  `role` and `passwordHash` → `core.people.metadata`. The "superseded" banner is on
  top, but the **mapping table still instructs the wrong thing.**
- **Resolution:** rewrite those rows (role → `tenant_memberships`/`staff_members`;
  `passwordHash` → `core.users`) **or** hard-archive the doc (see S10). A banner over
  a still-wrong table is not enough.

### S8 — `LIMIT 1` in tenant/program mapping · ✅ APPLIED (archived 2026-06-17)

- **Where:** `2026-06-15-cash-to-platform-migration.md` 530, 687, 745, 763;
  `2026-06-15-platform-schema-migration.md` 427, 463, 520, 539. Violates guardrail #7
  (picks an arbitrary tenant/program). The 06-16 executor already forbids it (58, 2449).
- **Resolution:** these live only in the superseded 06-15 docs → archive them (S10).
  No `LIMIT 1` exists in the canonical executor.

---

## Severity 2 — Integrity gaps located in the executor (G3–G5)

### S5 — Inline phone regex instead of `normalize_phone()` (G4) · DECIDED

- **Where (MAIN executor):** `2026-06-16-migration-plan.md` lines 1847, 2217–2218,
  2521, 2544, 2568 — `regexp_replace(<phone>, '[^0-9+]', '', 'g')`. Also 06-15 line 480.
  (Line 1798 is a slug, not a phone — leave it.)
- **Resolution (D4):** replace each phone `regexp_replace` with
  `core.normalize_phone(<phone>)`; ensure `normalize_phone()` is installed in Phase B
  before its first use in Phase C/D. Same function as runtime `resolve_contact()`.

### S6 — Loyalty account grain is per-card (G5) · DECIDED

- **Where:** `2026-06-15-cash-to-platform-migration.md` 121 ("one account per card"),
  524 ("one per card per tenant"); `2026-06-16-migration-plan.md` 156 ("one account per
  migrated `LoyaltyCard`/person" — ambiguous).
- **Resolution (D5):** one `loyalty.accounts` **per person per program**; cards attach
  to the account. Rewrite §6.3 account creation to group by person; preflight asserts
  cards-per-person and dedupes accounts where a person holds >1 card.

### S7 — Append-only ledger protection labeled "Optional" (G3) · DECIDED

- **Where:** `2026-06-16-migration-plan.md` §5.4, line 775: _"### 5.4 Optional cash
  append-only support."_ The triggers (838–875) are correct but framed optional.
- **Resolution:** retitle **"5.4 Append-only ledger protection (MANDATORY)."** Add a
  Phase B gate asserting all three triggers exist (integrity-gate check 4); fail if absent.

---

## Severity 3 — Hygiene / navigation (confusion, not yet wrong output)

### S9 — Plan §5.7 RLS block superseded by `050` · ✅ APPLIED

- **Where:** `2026-06-16-migration-plan.md` §5.7 (1455–1497) enabled RLS with **no
  policy, no FORCE**, grants `authenticated`. `050_rls_tenant_isolation.sql` now owns
  RLS (enable + FORCE + `tenant_isolation` policy, all six schemas).
- **Resolution (applied):** §5.7's RLS-enable loop replaced with a pointer to `050`;
  indexes kept; grants reconciled to `umi_app` (+ `delete`).

### S10 — Doc sprawl · ✅ PARTIALLY DONE; scope corrected 2026-06-17

- **Original (wrong) recommendation:** "archive _every_ pre-2026-06-16 plan."
- **What the reference scan revealed:** that scope was unsafe. The `2026-05-23`
  API checklist and the `2026-06-09-workspace-integration-implementation-plan.md`
  are cited as **active/historical drivers** in `docs/reports/latest.md`,
  `docs/reports/workspace-integration-audit.md`, and `docs/migration/audit-output/*`
  (~10 inbound links). A blanket archive broke links and contradicted their status.
- **Done (safe subset):** archived only the **3 genuinely-superseded _conflicting_**
  docs → `docs/migration/archive/` (with a README): both `2026-06-15-*` and the
  divergent `2026-06-16-platform-database-architecture.md`. Fixed the 3 live inbound
  links (runbook §0, canonical note ×2). The 9 broadly-referenced docs were
  **reversed back** to `docs/migration/`.
- **Deferred → see S11.**

### S11 — Two parallel migration "tracks" · **NEEDS A CALL (new finding)**

- **What:** the doc set actually contains **two program lineages** for the same
  database work: (a) the **2026-06-16 set** we've been hardening (executor +
  runbook + integrity spec + canonical note), and (b) an earlier
  **2026-05-14 → 2026-06-09 program** (`postgresql-platform-integration-plan` →
  `optimized-database-transition-plan` → `api-backend-centralization-execution-checklist`
  → `workspace-integration-implementation-plan`) that `docs/reports/latest.md` still
  labels the _"Active program driver."_ The 06-16 runbook even cites "the workspace
  plan" for its sequencing invariant — so (a) builds on (b) but never formally
  supersedes it.
- **Why it matters:** until one is declared the single driver, "which plan is live?"
  is ambiguous to anyone outside this thread — the exact confusion this sweep exists
  to kill.
- **Recommendation:** declare the **2026-06-16 runbook the single live driver** and
  add a one-line "superseded-as-driver-by → 2026-06-16-execution-runbook" banner to
  the 06-09 plan + 05-23 checklist (leave them in place, links intact, as the
  historical program record). **Needs your confirmation** — it touches the
  reports/audit lineage, not just the migration plan.

---

## Already closed (for completeness)

- **G1 / G2** — tenant-isolation RLS policies + `core` coverage → ✅ `050_rls_tenant_isolation.sql`.
- **D1** — schema naming `core`/`loyalty`/`ops` (physical → Phase G rename) → ✅ locked.

---

## Open decisions blocking the clean-up

1. ~~**D6 — app role model**~~ ✅ RESOLVED 2026-06-17 = `umi_app`/`umi_worker`/`umi_readonly`. S2/S9 applied.
2. ~~**Doc archival**~~ ✅ DONE (narrowed) — 3 conflicting docs archived (S3/S4/S8); over-broad scope corrected (S10).
3. **S11 — single migration driver:** confirm the 2026-06-16 runbook is the sole
   live driver, and banner the 06-09 plan + 05-23 checklist as superseded-as-driver.
   **← open call** (touches the reports/audit lineage).

## Order to clear (then re-sweep → zero hits → Phase A)

1. ✅ **D6** settled; **S2/S9** applied to the executor.
2. ✅ Archival done (narrowed): S3/S4/S8 cleared; S10 corrected; **S11 raised**.
3. ⏳ Apply to the 06-16 executor: **S1** (source rule), **S5** (normalizer), **S6**
   (account grain), **S7** (append-only mandatory).
4. ⏳ (Optional) S11 banners once you confirm the single driver.
5. ⏳ Re-run the sweep greps; confirm zero hits. Then Phase A (fresh dump → staging).
