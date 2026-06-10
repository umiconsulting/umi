# PostgreSQL Platform Local Execution - 2026-05-14

## Scope Executed

- Confirmed this run was local-only.
- Did not deploy or apply any production migration.
- Held the pending dashboard `conversaflow.business_external_refs` / `conversaflow.staff_members` migration.
- Installed local PostgreSQL server package `postgresql@18` with Homebrew because only `libpq` client tools were present.
- Created local database `umi_platform_local`.
- Applied local schema drafts from `docs/migration/local-postgres/`.
- Seeded `full-stack-cafe` and `cash-only-cafe`.
- Exported local schema-only dump to `docs/migration/audit-output/local-platform-schema.sql`.

## Local Database

- Server: PostgreSQL 18.3 Homebrew
- Data directory: `/opt/homebrew/var/postgresql@18`
- Local URL used: `postgresql://localhost:5432/umi_platform_local`
- Local schema-only dump lines: `3067`

## Files Created

- `docs/migration/local-postgres/001_platform_core.sql`
- `docs/migration/local-postgres/002_commerce_core.sql`
- `docs/migration/local-postgres/003_cash_core.sql`
- `docs/migration/local-postgres/004_conversaflow_core.sql`
- `docs/migration/local-postgres/005_kds_core.sql`
- `docs/migration/local-postgres/006_observability_core.sql`
- `docs/migration/local-postgres/010_seed_product_matrix.sql`
- `docs/migration/local-postgres/README.md`
- `docs/migration/audit-output/local-platform-schema.sql`

## Validation Results

Product availability query:

```txt
cash-only-cafe   Cash Only Cafe    cash=active, conversaflow=missing, dashboard=active, kds=missing, observability=missing
full-stack-cafe  Full Stack Cafe   cash=active, conversaflow=active, dashboard=active, kds=active, observability=active
```

RLS-compatible query:

- `SET ROLE umi_app`
- `SET app.user_id = '<local-owner-1 uuid>'`
- Base-table tenant/product join returned both seeded tenants.
- `platform.tenant_product_capabilities` is `security_invoker` and returned both seeded tenants.
- With `app.user_id = ''`, `platform.tenants` returned `0` rows.

Tenant-scope checks:

- Product tables checked: `commerce`, `cash`, `conversaflow`, `kds`
- Product tables missing `tenant_id`: none
- Product `tenant_id` columns missing FK to `platform.tenants(id)`: none

Table inventory:

```txt
platform: 13 tables
commerce: 7 tables
cash: 10 tables
conversaflow: 11 tables
kds: 6 tables
observability: 5 tables
legacy: schema created, no tables yet
```

## Documentation Audit Summary

Current ownership claims preserved:

- Root `docs/` owns workspace-wide migration planning and governance.
- `apps/umi-conversaflow` owns shared backend logic, operational schema contracts, workflow jobs, outbox, and KDS projection SQL.
- `apps/umi-cash` owns Cash loyalty, wallet, passes, and current Cash Prisma behavior.
- `apps/umi-kds` owns the native iPad KDS client and consumes backend-owned projections.
- `apps/umi-dashboard` owns owner-dashboard screens and live-data UI behavior, not backend truth.
- `apps/umi-logs` owns ConversaFlow logs and trace UI, not trace-writing schema.

Stale or superseded claims found:

- `apps/umi-dashboard/docs/audit-connectivity.md` dated 2026-05-13 recommends applying `20260513190000_dashboard_staff_and_external_refs.sql`.
- The newer 2026-05-14 platform plan supersedes that for now and says not to deploy the pending dashboard staff/external-ref migration.

Data ownership conflicts found:

- Dashboard currently depends on `VITE_BUSINESS_SLUG` and `/api/:slug/...` routes.
- Dashboard server maps Cash tenant slugs to ConversaFlow `business_id` through `conversaflow.business_external_refs`.
- Cash currently owns `Tenant`, `Location`, `User`, and staff/customer role rows in Prisma.
- ConversaFlow currently owns `businesses`, `customers`, operational conversations, orders, workflow jobs, and KDS source projections by `business_id`.
- KDS contracts still use `business_id` in RPCs and client models.
- Logs reads ConversaFlow trace/log tables through schema configuration.

Product boundaries to preserve:

- Keep operational order truth out of KDS.
- Keep Cash loyalty/wallet behavior in Cash until canonical `platform` and `cash` schemas are ready.
- Keep dashboard as a consumer of capabilities and product APIs, not as a tenant or product-data authority.
- Keep observability append-oriented and operationally separate from product write models.

## Code Audit Summary

Tenant/product boundary assumptions found:

- `apps/umi-dashboard/src/lib/config.js` uses `VITE_BUSINESS_ID` and `VITE_BUSINESS_SLUG`.
- `apps/umi-dashboard/src/data.jsx` throws if `VITE_BUSINESS_SLUG` is missing.
- `apps/umi-dashboard/server.js` routes are slug-based and resolve Cash `Tenant` first.
- `apps/umi-dashboard/server.js` writes staff to `conversaflow.staff_members` through `business_external_refs`.
- `apps/umi-cash/prisma/schema.prisma` has product-local `Tenant`, `Location`, and `User` as current Cash authority.
- `apps/umi-cash/src/app/api/[slug]/**` uses URL slug plus Cash `tenantId` checks.
- `apps/umi-conversaflow` migrations and functions use `business_id` for operational tenancy.
- `apps/umi-kds` client models and RPC calls use `business_id`.
- `apps/umi-logs` reads configured ConversaFlow schema values and assumes ConversaFlow-owned trace shape.

Environment variable names captured without values:

- `apps/umi-cash`: `DATABASE_URL`, `DIRECT_DATABASE_URL`, wallet/pass credentials, JWT secrets, admin bootstrap credentials, email/provider keys.
- `apps/umi-conversaflow`: `DB_SCHEMA`, `SUPABASE_DB_SCHEMA`, Supabase URL/key variables, Twilio, Voyage, Anthropic, signoff runner variables.
- `apps/umi-dashboard`: `DATABASE_URL`, `DIRECT_DATABASE_URL`, `PORT`, `VITE_BUSINESS_ID`, `VITE_BUSINESS_SLUG`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optional service-role variables.
- `apps/umi-logs`: Supabase URL/key/schema variables, Anthropic, Twilio, management/project variables.

## Current Database Audit

Not executed.

Reason: `UMI_CURRENT_DATABASE_URL` was not set in the shell. Per the plan, no production connection string was inferred from local `.env` files and no secret values were copied into docs.

## Decision Basis

Documented fact:

- PostgreSQL schemas, row-level security, UUID generation, and `CREATE SCHEMA` behavior are the basis for this draft. The primary references are already listed in the May 14 migration plan.

Source-backed tradeoff:

- A single PostgreSQL database with multiple schemas keeps tenant identity canonical while preserving product ownership boundaries.

Umi-specific inference:

- `platform` should own canonical tenant/contact/staff/membership identity.
- Product schemas should reference canonical platform rows instead of carrying tenant identity as product-local truth.
- Dashboard module availability should come from `platform.product_instances`, not from slug joins or missing product rows.
