# Phase 2 Dashboard-Backend Port — Preflight & Port Map

**Date:** 2026-06-24
**Status:** Confirmed. Unblocks Phase 2 of `docs/architecture/2026-06-23-umi-api-centralization-spec.md` (Auth + admin/owner domain).
**Method:** Full read of the live source `apps/umi-dashboard/server.js` (2,829 lines), which **already runs against the live platform DB** (`PLATFORM_PROD_DATABASE_URL` → `xbudknbimkgjjgohnjgp`) after the 2026-06-20 dashboard canonical cutover. Its SQL is therefore the **confirmed live-schema binding** — no separate DB introspection needed for the read/write surface (cf. the Phase 1c preflight, which had to introspect because the queue engine had no working source binding).
**Owner direction (2026-06-24):** proceed with Phase 2 (selected the Phase 2 header), reverting the earlier "next = Phase 3" pointer.

---

## 0. Bottom line

`server.js` is the working, post-cutover source of truth. Every Phase-2 route already maps cleanly to the canonical `core/ops/comms/loyalty/observability` schema (§9.1) — the dashboard cutover did the schema mapping for us. The port is therefore **mechanical per route**, with three real changes of substance:

1. **Auth model upgrade (D9):** the dashboard's `X-UMI-User-ID` header "session" (no real token) → **JWT access + refresh in httpOnly cookies** + `AuthGuard`/`EntitlementGuard`/`@Roles`. This is the one place behavior changes, and it ripples to the dashboard frontend (must call `/auth/local/login` for cookies, stop sending the header).
2. **Layering:** `server.js` is one 2,829-line file with inline SQL. It decomposes into `modules/{auth,tenants,staff,hours,customers,cash}` with `controller → service → repository`, per spec §6/§4.
3. **D11 cash split:** cash **reads** go live; customer-facing wallet/ledger **writes** ship built-but-inert (`CASH_WRITE_ENABLED=false`). Admin-config writes (reward-config, settings, staff, hours) are dashboard-owned and stay live — see §4.

---

## 1. Route → module map (Phase 2 scope only)

KDS/devices/orders routes in `server.js` (`/api/kds/*`, `/api/:slug/orders*`, `/api/:slug/admin/devices*`, `/stations`, `/ticker`) are **Phase 4**, not ported here. `/api/:slug/admin/conversations` (list, reads `comms.*`) lands in `customers` per spec §7.2.

| `server.js` route | Module | Notes |
|---|---|---|
| `POST /api/auth/local/login` | `auth` | scrypt verify → issue JWT cookies + return `{user, tenants}` body |
| `POST /api/auth/local/forgot-password` | `auth` | Brevo reset email; always 200 (no enumeration) |
| `POST /api/auth/local/reset-password` | `auth` | token_hash lookup, scrypt rehash |
| `GET /api/me/tenants` | `tenants` | memberships + roles for the JWT user |
| `GET /api/tenants/:id/capabilities` | `tenants` | product_instances + module-registry |
| `GET/PATCH /api/tenants/:id/settings` | `tenants` | core.tenants + loyalty.programs.branding |
| `GET /api/tenants/:id/locations`, `PATCH .../locations/:lid` | `tenants` | core.locations |
| `GET /api/tenants/:id/customers[...]` (detail/timeline/conversations/orders/cash/identity) | `customers` | Customer 360 composite — **decompose** the lateral-join into per-domain loaders |
| `GET /api/tenants/:id/insights/customer-platform` | `customers` | platform customer list (the 120-line lateral join) |
| `GET /api/:slug/admin/settings`, `PATCH` | `cash` (or `tenants`) | reads loyalty.programs branding; gated on `cash` product |
| `GET /api/:slug/admin/stats` | `cash` (read) | loyalty.visit_events / wallet_transactions / cards |
| `GET /api/:slug/admin/analytics` | `cash` (read) | loyalty + core.people aggregates |
| `GET /api/:slug/admin/customers` | `cash` (read) | loyalty card-centric customer list |
| `GET /api/:slug/admin/reward-config`, `PUT/PATCH` | `cash` | **admin-config write** (not the inert customer-facing path) — see §4 |
| `GET /api/:slug/admin/gift-cards` | `cash` (read) | loyalty.gift_cards (read) |
| `GET /api/:slug/admin/staff`, `POST/PATCH/DELETE .../:id` | `staff` | core.staff_members |
| `GET/PATCH /api/:slug/admin/hours` | `hours` | ops.business_hours (per-day rows) |
| `GET /api/:slug/admin/conversations` | `customers` | comms.* list view |

---

## 2. Confirmed live-schema binding (column-exact, from working source)

### Auth (`core`)
- `core.users`: `id`, `email`, `display_name`, `password_salt`, `password_hash` (scrypt, `scryptSync(pw, salt, 64)` hex; nullable → only rows with `password_hash IS NOT NULL` can log in), `updated_at`.
- `core.password_reset_tokens`: `id`, `user_id`, `token_hash` (sha256 hex), `expires_at`, `used_at`.
- `core.tenant_memberships`: `id`, `user_id`, `tenant_id`, `status` (`active`).
- `core.tenants`: `id`, `slug`, `name`, `timezone`, `status` (`active`).
- `core.roles`: `id`, `key`. `core.membership_roles`: `membership_id`, `role_id`.
- `core.role_permissions`: `role_id`, `permission_id`. `core.permissions`: `id`, `key`.
- Role precedence (`normalizeRoleKey`): `super_admin > owner > admin > developer > tech_assist > staff`. `super_admin` ⇒ permissions `['*']`.
- `core.product_instances`: `tenant_id`, `product_key`, `status`, `location_id` (tenant-level rows have `location_id IS NULL`), `config` jsonb. Entitlement = `PRODUCT_ACTIVE_STATUSES` (active/trialing — see `src/lib/module-registry.js`).
- `core.locations`: `id`, `slug`, `name`, `tenant_id`, `status` (`active`), `created_at` (no `timezone` column — fall back to tenant timezone).

### Tenants composite (`getTenant`)
- `loyalty.programs` (LEFT JOIN on `tenant_id`): `id` (programId), `card_prefix`, `pass_style`, `self_registration`, `topup_enabled`, `birthday_reward_enabled`, `birthday_reward_name`, `branding` jsonb (`primary_color`, `secondary_color`, `logo_url`, `strip_image_url`, `promo_message`, `promo_starts_at`, `promo_ends_at`, `promo_days`).
- `ops.businesses` (LEFT JOIN on `tenant_id`): `city`.

### Staff (`core.staff_members`)
- `id`, `tenant_id`, `location_id`, `name`, `phone`, `email`, `status` (`active|invited|disabled`), `created_at`, `updated_at`. Role is **derived** (`lower(name)='admin' → ADMIN else STAFF`); `permissions/invitedAt/disabledAt` are DTO-synthesized (columns are `NULL::jsonb`/`NULL::timestamptz` projections today). Delete = soft (`status='disabled'`).

### Hours (`ops.business_hours`)
- `tenant_id`, `location_id` (nullable; matched `IS NOT DISTINCT FROM`), `day_of_week` (0=Sun..6=Sat), `opens_at`/`closes_at` (`time`), `is_closed`. One row per day; PATCH replaces all rows atomically (DELETE + INSERT in a tx).

### Customer 360 / cash reads (`core` + `loyalty` + `comms` + `ops` + `observability`)
- `core.people`: `id`, `display_name`, `normalized_phone`, `normalized_email`, `tenant_id`, `created_at`, `updated_at`.
- `core.contact_methods`: `id`, `person_id`, `kind` (`phone|whatsapp|email|…`), `display_value`, `normalized_value`, `verified_at`, `created_at`.
- `loyalty.accounts`: `id`, `person_id`, `tenant_id`, `updated_at`. `loyalty.cards`: `id`, `account_id`, `tenant_id`, `card_number`, `balance_cents`, `total_visits`, `visits_this_cycle`, `pending_rewards`, `updated_at`.
- `loyalty.visit_events`: `tenant_id`, `loyalty_card_id`, `occurred_at`.
- `loyalty.wallet_transactions`: `tenant_id`, `loyalty_card_id`, `type` (`TOPUP|PURCHASE`), `amount_cents`, `created_at`.
- `loyalty.reward_configs`: `id`, `tenant_id`, `program_id`, `visits_required`, `reward_name`, `reward_description`, `reward_cost_cents`, `is_active`, `activated_at`, `created_at`.
- `loyalty.reward_redemptions`: `tenant_id`, `redeemed_at`.
- `loyalty.gift_cards`: (read) — confirm columns at bind time of the gift-cards read.
- `comms.conversations`: `id`, `person_id`, `status` (`open|pending|active|…`), `last_message_at`. `comms.memory_items`: `id`, `person_id`, `updated_at`.
- `ops.orders`: `id`, `person_id`, `total_cents`, `placed_at`, `created_at`.
- `observability.data_quality_findings`: `tenant_id`, `subject_id` (text), `resolved_at`, `created_at`.

All money is integer **centavos**; format with `es-MX` MXN, 0 fraction digits (the `fmt()` helper).

---

## 3. Auth model (D9) — the one behavioral change

| Concern | Dashboard today | umi-api (D9) |
|---|---|---|
| Credential | `X-UMI-User-ID` header, frontend-stored | **JWT access + refresh in httpOnly cookies** (`jose`) |
| Password | scrypt(pw, salt, 64) hex + `timingSafeEqual` | **preserve byte-for-byte** in `password.service` (no forced reset; optional upgrade-on-login) |
| Tenant access | `requireTenantAccess` per request (membership join) | `TenantAccessGuard`/service → sets `ctx.tenantId` (RLS context) |
| Entitlement | `requireProduct`/`requireLegacyProduct` → 403 `product_not_active` | `EntitlementGuard` (same 403 shape) |
| Roles/perms | `normalizeRoleKey` + permission array | `@Roles`/`@RequirePermission` + `RolesGuard` (same precedence) |
| CSRF | none (header scheme) | SameSite cookies + double-submit CSRF token on mutations (spec §11.2) |

**Cookie scheme:** `umi_access` (httpOnly, short TTL ~15m), `umi_refresh` (httpOnly, ~30d, used at `POST /auth/local/refresh`), `umi_csrf` (readable, double-submit). Login still returns `{ user, tenants }` in the body so the frontend renders unchanged; the cookies carry auth.

**Frontend ripple (expected, per Phase 2 "Done when"):** point the dashboard at the new API base URL behind a flag; switch from header to cookie credentials (`fetch(..., { credentials: 'include' })`). Rollback = point frontend back at `server.js`.

---

## 4. D11 cash read/write boundary — applied to Phase 2 routes

Per D11 / §11.5, the **customer-facing wallet/loyalty ledger** is the inert surface: wallet topup/purchase, scan/visit, reward **redemption**, gift-card **issue/redeem**, account/card creation. These are built in `cash-write.service.ts`, tested against staging, but the `cash-write.controller` is **unmounted** while `CASH_WRITE_ENABLED=false`, and DB-side `umi_app` gets no `EXECUTE` on the loyalty write RPCs.

**Admin-config writes are NOT the inert path** and stay live (the dashboard already performs them; `umi-cash` does not write these — no dual-writer hazard):
- `PATCH /admin/settings` → `core.tenants.name` + `loyalty.programs.branding`/`card_prefix`/`pass_style`.
- `PUT/PATCH /admin/reward-config` → `loyalty.reward_configs` (deactivate-then-insert in a tx).
- `staff` CRUD → `core.staff_members`. `hours` PATCH → `ops.business_hours`.

⚠️ **One bind-time nuance to confirm with the role-grant work (§5):** §11.5 says pre-activation `umi_app` has "only SELECT (via `v_*` views) on `loyalty.*`." `reward_configs` lives in `loyalty.*` but is admin config, not the wallet ledger. The grant policy must therefore distinguish **loyalty config tables** (`reward_configs`, `programs`) — `umi_app` writable — from **loyalty ledger tables** (`cards`, `points_ledger`, `balances`, `wallet_transactions`, `gift_cards`) — `umi_app` SELECT-only until Phase 7. Documented here so the Phase-2 grant migration encodes it deliberately.

---

## 5. Carry-over decisions surfaced by the Phase 1c preflight (§5/§6)

Two items the queue preflight flagged for Phase 2 / Phase 1b. **Neither requires touching the live prod DB to start Phase 2 code** — both pools currently connect via the `postgres.<ref>` pooler role (owns everything), so the port runs today; these harden it.

1. **Role grants (Phase 2 infra — owner-gated DDL).** Live `umi_app`/`umi_worker`/`umi_readonly` are **NOLOGIN with zero `queue.*` grants**, and `umi_worker` is **not BYPASSRLS** — they don't match committed `db/roles/001_api_roles.sql`. Phase 2 must: reconcile the connection model (connect-as-role vs `SET ROLE` via the pooler) with `pg.service.ts`; grant `umi_app` the read/write surface per the product→schema matrix (incl. the loyalty config-vs-ledger split in §4); grant `umi_worker` `USAGE`+DML on `queue/observability/grow`; and decide BYPASSRLS vs explicit-WHERE for the worker. **This is a reviewed DDL change against prod — not applied unilaterally.** Until it lands, umi-api connects via the pooler role like the dashboard does.
2. **TraceService rebind (Phase 1b reconciliation).** Committed `TraceService` writes `conversaflow.ai_turn_logs/edge_function_logs/security_logs/pipeline_traces` (default `OBSERVABILITY_SCHEMA=conversaflow`) — **none exist on the platform DB**, where observability is canonical (`ai_runs/pipeline_spans/security_events`). Inserts silently no-op today. Decide: repoint `umi-logs` to platform `observability.*` and rebind TraceService, or confirm `umi-logs` still reads the separate conversaflow project DB. Not a Phase-2 blocker (admin reads don't trace turns), but tracked.

---

## 6. Build order (each independently testable)

1. **Auth foundation** (keystone): `shared/auth/{password,jwt}.service`, `modules/auth/*` (controller, service, repository, `auth.guard`, `tenant-access.guard`, `entitlement.guard`, `roles.decorator`+`roles.guard`, DTOs). Add `jose` + `@fastify/cookie`; extend config (`JWT_SECRET` required-in-prod, access/refresh TTLs, cookie domain). Unit tests for password (scrypt vector), jwt (sign/verify/expiry), and the guard/role precedence.
2. **TenantsModule** — `/me/tenants`, capabilities, settings, locations.
3. **StaffModule + HoursModule** — smallest CRUD surfaces; good guard exercise.
4. **CustomersModule** — Customer 360 reads, decomposed loaders + conversations list.
5. **CashModule** — read services (stats/analytics/customers/reward-config/gift-cards) live; write service built-inert behind the flag.
6. Wire all into `app.module.ts`; `npm run typecheck` + `npm test` green. Parity-check against `server.js` route-by-route.

**Done when (spec Phase 2):** full dashboard admin flow (login, tenants, staff, hours, customers, customer-360, cash analytics, entitlement 403s) runs against `umi-api`, parity-checked against `server.js`; cash-write services pass staging tests while unmounted in prod. **Rollback:** point the dashboard frontend back at `server.js`.
