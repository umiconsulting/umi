# build-v3 Database Security Gate

**Status:** ACTIVE · **Owner:** platform · **Last audit:** 2026-07-12 · **DB:** Postgres (Supabase-managed) + self-hosted VPS backend

> **This gate BLOCKS production.** No build-v3 schema, backfill, or backend change reaches prod
> until (a) the automated DB gate `security_gate.sql` passes with zero FAILs, **and** (b) every
> BLOCKING row in the Deployment Gate below is checked with recorded evidence. "Nothing goes to
> prod" is enforced here, not assumed.

The gate has two halves:

| Half | What it covers | How it runs | Blocks |
|---|---|---|---|
| **A · Automated DB gate** | RLS, grants, credential exposure, data hygiene — everything provable from the DB | `psql -v ON_ERROR_STOP=1 -f security_gate.sql` (24 structural + 3 behavioral checks) | the build / CI |
| **B · Deployment gate** | TLS, SCRAM, pg_hba, role wiring, secrets, pooler contract — the instance & backend | manual/CI checklist below, evidence recorded | the cutover |

---

## 1 · How this gate was built

A 19-agent adversarial audit (`security-audit-2026-07-12.raw.json`) reviewed the DDL + backfill + live
DB across six dimensions and **empirically reproduced** the critical issues (minted a `password_reset_token`
as `api` with no tenant context; read all 8 password hashes as both `api` and `readonly`; pulled 11
cross-tenant rows out of `conversation_analytics`). It produced **50 confirmed findings** (6 critical, 16
high, 14 medium, 10 low, 4 info), then a red-team pass corrected contradictory fixes and defined the gate
sections below. Everything locally fixable has been fixed and is now asserted by `security_gate.sql`.

**Re-run the audit** whenever the schema, grants, or backfill change materially, and at minimum before each
cutover rehearsal.

---

## 2 · Data-cleaning decisions (reasoned)

The audit's "data-at-rest" dimension drove deliberate cleaning of the backfill. Each decision and its
reasoning:

| Data | Decision | Reasoning |
|---|---|---|
| **Password credentials** (9 users) | Add `umi.user.password_salt` (was a **schema bug** — scrypt is unverifiable without its salt); carry `hash+salt+algorithm` **only** for *unique* `scrypt-sha256-v1` users; **force-reset** (`invited`, null creds) the 2 `legacy-sha256` and any **shared-hash** (seed-password) accounts; **suspend** the emailless ghost. | The source *did* have the salt — the audit's "salt gone" premise was a backfill omission. Keep strong working logins; eliminate crackable/shared credential material rather than carrying it. Reset friction is trivial for ~9 internal users. |
| **Historical webhook envelopes** (`outbox` 417, `inbound` 395, `dead_letter` 1) | **Dropped** from the backfill. | Past delivered/processed events are nothing the machine reads back to act → telemetry, not runtime state (the model's own read-back rule) → and their payloads carry raw customer phone/message **PII** into a sealed, unscoped schema. Runtime starts clean; queues regenerate. |
| **Slack channel id/name** in `tenant.audit_log` | **Redacted** (`- 'slack_channel_id' - 'slack_channel_name'`). | `tenant.audit_log` is café-readable (RLS); a Umi-internal Slack id must not leak into it. |
| **Credential columns** on `umi.user` | Kept, but **column-locked** from `api`/`readonly`. | Verified only via the worker pool / a SECURITY DEFINER auth function — never on the request path. |
| DOB, raw+normalized phone duplication | **Kept** (documented). | Low-sensitivity CRM attributes; the raw/normalized pair is the model's deliberate "raw truth + derived companion," not a leak. |

---

## 3 · Automated DB gate — `security_gate.sql`

Run: `PGPORT=5233 psql -v ON_ERROR_STOP=1 -d <db> -f security_gate.sql` → must end `SECURITY GATE PASSED`.
All rows below are **enforced by that script** and currently **PASS**.

### Isolation & RLS
- **Every `tenant` base table has RLS *and* FORCE.** (`relrowsecurity AND relforcerowsecurity` on all 33; FORCE closes the owner-bypass path.)
- **`umi` per-café tables RLS+FORCE:** `subscription, subscription_item, invoice, entitlement_override, user_role` scoped to `app.current_business`; global catalogs (`role/permission/channel_type/feature/plan/plan_feature`) stay readable.
- **`runtime` request-path tables RLS+FORCE:** `conversation_state` (via `conversation`), `reminder_sent` (business_id).
- **Views run `security_invoker`** (`conversation_analytics`, `effective_entitlement`) and `api` holds **no DML** on any view — the confirmed cross-tenant view leak is closed.
- **Fail-closed GUC:** `umi.current_business()` returns NULL on unset/empty context → 0 rows, never an error. Behavioral test proves EGR sees 0 foreign rows; Kalala sees exactly its own.

### Least privilege & credentials
- **`api` cannot read** `umi.user.password_hash` / `password_salt`; **`readonly` cannot** either. `api` keeps identity columns (`email` etc).
- **`api`/`readonly` have zero privilege on the auth substrate** (`runtime.session/otp/password_reset_token/device_session/pairing`).
- **`api` cannot read** `umi.prospect` (Umi sales) or `umi.audit_log` (sealed).
- **`api` is not superuser / not BYPASSRLS**; `worker` is BYPASSRLS (machinery).
- **No default-privilege leak arms `api`** on future tables (explicit grants only).
- **`PUBLIC` cannot CREATE in schema `public`** (CVE-2018-1058 enabler removed); trigger functions have **pinned `search_path`**.
- **Append-only audit:** no role holds UPDATE/DELETE on either `audit_log`.

### Data hygiene
- 0 active users with a NULL hash · 0 `legacy-sha256` retained · ≥1 strong scrypt login survives · ghost `@umi.invalid` not active · no Slack ids in café-readable audit · 0 historical webhook rows in runtime.

---

## 4 · Deployment gate (BLOCKING at cutover — record evidence)

These cannot be asserted from the DDL alone; they are checked at cutover against the running instance/backend.

| # | Gate | Pass criterion | Notes |
|---|---|---|---|
| D1 | **Connection role reconciliation** | App pools connect as a role that is `pg_has_role(current_user,'api','member')`, **not** `postgres`/`service_role`; `rolsuper=f, rolbypassrls=f` on the app+readonly pools; only the worker pool is BYPASSRLS. Boot guard aborts otherwise. | ✅ **Names decided: `api`/`worker` (canonical).** The role is embedded in `DATABASE_URL_APP`/`_WORKER` (env), so cutover points those at LOGIN roles that INHERIT `api`/`worker` (e.g. `api_login`/`worker_login` — `api`/`worker` themselves are NOLOGIN groups you cannot connect as) — an **env change, not code**. ✅ **Boot guard implemented** — `PgService.onModuleInit` → `assertPoolRoles` refuses to boot unless app = non-super/non-BYPASSRLS member of `api` and worker = BYPASSRLS/non-super member of `worker` (attributes read off `current_user`; membership via `pg_has_role(...,'USAGE')`, which passes only when the login role actually **inherits** the group's privileges — a NOINHERIT member is rejected at boot, not silently broken at first query). Unit-tested (`pg.service.spec.ts`). The H1 harness login roles (`api_login`/`worker_login`, `harness-roles.sql`) satisfy it by construction. |
| D2 | **GUC-name contract** | The backend sets the policy GUC `app.current_business` for every request-path transaction. | ✅ **Resolved (expand-contract):** `pg.service.ts:runWithTenant` now sets **both** `app.tenant_id` (current prod) **and** `app.current_business` (build-v3), transaction-scoped — correct against either schema, zero risk to live prod. **Contract:** drop `app.tenant_id` after cutover. |
| D3 | **Pooler / SET LOCAL isolation** | `app.current_business` is set via `set_config(..., true)` **inside the same transaction** as the query (never a session `SET`); an integration test proves tenant A's pooled connection cannot read tenant B after reuse. | Supabase fronts with Supavisor (transaction pooling). Also: **no tenant-scoped request read may run on the BYPASSRLS worker pool.** |
| D4 | **TLS verify-full (VPS→Supabase)** | Both pools use `ssl:{ca, rejectUnauthorized:true}` (or `sslmode=verify-full&sslrootcert=…`); `pg_stat_ssl` shows `ssl=t` per pool; a wrong CA **fails** the connection; Supabase "Enforce SSL" ON. | Backend currently has no `ssl` option. |
| D5 | **SCRAM on login roles** | `password_encryption=scram-sha-256` (✓ confirmed) **and** every app LOGIN role's `pg_shadow.passwdtype` is `SCRAM-SHA-256` (0 md5). Login roles use `INHERIT` membership of `api`/`worker` (**not** `NOINHERIT` — that breaks all access). | `api`/`worker` are NOLOGIN groups; the real login roles carry the verifiers. |
| D6 | **pg_hba / network** | Supabase network restrictions limit connections to the VPS egress IP; pg_hba is Supabase-managed (no `trust`/`0.0.0.0` reachable). | Managed side — record the setting. |
| D7 | **Extensions** | Installed set = `{plpgsql, vector, pg_trgm}`, none outside `pg_catalog`/`extensions`; `api`/`worker` have USAGE (not CREATE) on `extensions`; unqualified `vector`/`pg_trgm` ops resolve for `api`. | `search_path` = `"$user", public, extensions` (extensions **after** public). |
| D8 | **No FDW/dblink remnants** | Target DB has **zero** foreign servers / user mappings and no `dblink` credentials carried from the snapshot template. | The snapshot template can carry a `postgres_fdw` server embedding the source password. |
| D9 | **Secret rotation & history** | Recorded evidence the Supabase JWT secret + Twilio auth token were **rotated** after the leak; `gitleaks`/`trufflehog` over full history returns 0 live secrets. | Standing item — see `cred_exposure` memory. |
| D10 | **Request-path log redaction** | `log_statement='none'` and no parameter logging for the request role — tokens/OTP hashes/business ids flow as bound params and must not land in logs. | Else logs become a credential sink that survives every grant lockdown. |
| D11 | **Auth issuance path** | Session/OTP/reset-token **issuance** runs only via the worker pool or a SECURITY DEFINER auth function (allowlisted, pinned `search_path`, EXECUTE revoked from PUBLIC); single-use + expiry enforced transactionally (no TOCTOU). | ✅ **Satisfied today** — every substrate touch (`umi.user` credentials, `runtime.{session,password_reset_token,pairing}`) runs on the **worker** pool (`AuthRepository`, `CustomerSessionService`, `KdsRepository` use `pg.query`/`pg.workerTx`, never `withTenant`). ✅ **Statically enforced** — `auth-substrate.d11.spec.ts` walks production source (TS AST) and fails CI if any `withTenant`/`runWithTenant`/`.app` call site references the substrate; `api` also has no DML on the auth tables (A-gate). No request-path issuance flow exists, so no SECURITY DEFINER function is needed yet — add one (with the transactional single-use guard) only if one appears. |

---

## 5 · Accepted / residual risks (documented, not blocking)

- **Outbound-message enqueue** — `api` currently has no `runtime.outbox_event` DML (revoked). Legitimate request-path sends must route through the worker or a definer that stamps the origin `business_id`. Until the backend does so, outbound send is worker-only (accepted; documented so it's not silently re-granted).
- **RBAC scope not DB-enforced** — `umi.user_role.business_id/branch_id` is stored; RLS trusts `app.current_business`. The single choke-point is the backend setting the GUC from the authenticated grant. A per-policy `session_can_access_business()` was considered and **rejected as over-engineering** for a 5-café system (planner cost on every row); revisit if tenant count or role complexity grows.
- **`umi.user` row enumeration** — credentials are column-locked, but `api` can still read identity columns cross-tenant unless routed through the scoped staff join. Low sensitivity; revisit if it becomes a vector.
- **FK existence oracle** — confirmed LOW (random UUIDs; `WITH CHECK` blocks cross-tenant grafts). No action.

---

## 6 · Re-run cadence

- **Every schema/grant/backfill change:** `security_gate.sql` in CI (blocks merge).
- **Before every cutover rehearsal:** full 19-agent audit + Deployment Gate evidence refresh.
- **Raw audit archive:** `security-audit-2026-07-12.raw.json`.
