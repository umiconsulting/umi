# PostgreSQL Platform Integration Audit and Local Schema Plan - 2026-05-14

## Purpose

Design the Umi ecosystem as a PostgreSQL-first platform database, independent of the current hosting layer.

This plan intentionally treats Supabase as temporary infrastructure. The target design is plain PostgreSQL: schemas, tables, constraints, functions, policies, roles, migrations, and local test data that can run anywhere PostgreSQL runs.

## Scope

This document covers:

- how to audit the current codebase, databases, and documentation
- the target PostgreSQL ownership model for the full Umi ecosystem
- a local-only schema creation workflow for testing the new model
- validation gates before any production migration is drafted

This document does not:

- deploy any migration
- mutate production data
- assume Supabase Auth, Supabase Edge Functions, or PostgREST
- preserve the current database shape as the desired final shape
- define the final application implementation plan in every file

## Decision Basis

Documented PostgreSQL facts:

- PostgreSQL schemas are namespaces inside one database and let the same object names exist in different schemas without conflict.
- Adding writable schemas to `search_path` is a trust boundary because unqualified names can resolve there.
- PostgreSQL row security policies are native database policies and can use row values plus session settings such as `current_setting(...)`.
- PostgreSQL has native UUID support and `gen_random_uuid()` for UUID generation.

Primary references:

- PostgreSQL schemas: https://www.postgresql.org/docs/current/ddl-schemas.html
- PostgreSQL row security policies: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- PostgreSQL UUID functions: https://www.postgresql.org/docs/current/functions-uuid.html
- PostgreSQL `CREATE SCHEMA`: https://www.postgresql.org/docs/current/sql-createschema.html

Umi-specific inference:

- Tenant identity should not live in Cash, ConversaFlow, KDS, or Dashboard.
- Product tables should store product behavior, not tenant identity.
- A tenant can have one product, many products, or no active products.
- Dashboard module availability should be derived from product activation rows, not from missing joins or hardcoded slugs.

## Target Principle

One PostgreSQL database. Multiple schemas. One canonical tenant model.

```txt
platform      canonical identity, tenancy, memberships, staff, contacts, product activation
commerce      normalized operational orders and service hours
cash          Umi Cash wallet, loyalty, gift cards, pass state
conversaflow  conversations, messages, workflow jobs, outbox, AI memory/traces
kds           kitchen projections, device sessions, station state
observability logs, audits, traces, runtime diagnostics
legacy        temporary imported identifiers and old compatibility views
```

The `platform` schema owns who the tenant is. Product schemas own what that product does for that tenant.

## Target Tenant Model

The canonical tenant graph:

```txt
platform.users
platform.tenants
platform.locations
platform.tenant_memberships
platform.staff_members
platform.roles
platform.permissions
platform.role_permissions
platform.membership_roles
platform.product_instances
platform.external_refs
platform.contacts
platform.contact_identities
```

Important rules:

- `platform.tenants.id` is the canonical business id.
- `platform.locations.id` is the canonical branch/location id.
- Every tenant-scoped table in every schema has `tenant_id uuid not null references platform.tenants(id)`.
- Every location-scoped table has `location_id uuid null references platform.locations(id)`.
- Product availability is modeled by `platform.product_instances`.
- External ids from current systems go in `platform.external_refs`, not in product tables as canonical keys.
- Staff lives in `platform.staff_members`, not in Cash.
- Customers/guests live in `platform.contacts`; product-specific customer state links to that contact.

## Product Activation Model

`platform.product_instances` decides what each dashboard module can display.

Required product keys:

```txt
cash
conversaflow
kds
dashboard
observability
```

Required statuses:

```txt
active
trialing
disabled
missing
archived
```

Dashboard behavior:

- Cash active: wallet, members, rewards, wallet design, gift cards show real Cash data.
- Cash missing/disabled: Cash modules show a product-unavailable state.
- KDS active: KDS orders, stations, devices show real KDS data.
- KDS missing/disabled: KDS modules show a product-unavailable state.
- ConversaFlow active: conversations, workflow, hours, automation show real data.
- ConversaFlow missing/disabled: ConversaFlow modules show a product-unavailable state.

There should be no global `VITE_BUSINESS_SLUG` tenant lock in the final dashboard. Login resolves accessible tenants from `platform.tenant_memberships`; tenant switching changes the active `tenant_id`.

## Greenfield Schema Outline

### `platform`

Canonical shared objects:

- `users`: application user profile linked to whichever auth provider exists at runtime
- `tenants`: businesses/accounts
- `locations`: physical or operational branches
- `tenant_memberships`: dashboard/application access
- `staff_members`: staff roster for operations, KDS, dashboard, and future products
- `roles`, `permissions`, `role_permissions`, `membership_roles`: access model
- `product_instances`: product availability and product-local config
- `external_refs`: old ids, imported ids, provider ids
- `contacts`: customer/guest/person records scoped to a tenant
- `contact_identities`: phone, WhatsApp, email, wallet pass, external channel ids

### `commerce`

Operational objects that should not belong only to a conversation product:

- `orders`
- `order_items`
- `order_events`
- `payments`
- `refunds`
- `business_hours`
- `service_windows`

ConversaFlow may create orders. Cash may later create orders. KDS consumes kitchen-relevant order state. `commerce` owns the normalized operational truth.

### `cash`

Umi Cash objects:

- `wallet_programs`
- `loyalty_accounts`
- `loyalty_cards`
- `wallet_transactions`
- `reward_configs`
- `reward_redemptions`
- `gift_cards`
- `passes`
- `pass_devices`
- `otp_verifications`

Cash tables reference `platform.tenants`, `platform.locations`, and `platform.contacts`.

### `conversaflow`

Conversation and workflow objects:

- `channels`
- `channel_accounts`
- `conversations`
- `messages`
- `conversation_turns`
- `workflow_jobs`
- `job_attempts`
- `outbox`
- `memory_items`
- `tool_calls`
- `conversation_outcomes`

ConversaFlow tables reference `platform.tenants`, `platform.locations`, `platform.contacts`, and `commerce.orders` when a conversation creates or modifies an order.

### `kds`

Kitchen read models and device/session state:

- `tickets`
- `ticket_items`
- `ticket_events`
- `stations`
- `device_sessions`
- `device_events`

KDS tables reference `platform.tenants`, `platform.locations`, and `commerce.orders`.

KDS should not become source of truth for orders.

### `observability`

Operational diagnostics:

- `audit_events`
- `runtime_logs`
- `pipeline_traces`
- `integration_checks`
- `data_quality_findings`

Audit and trace tables must be append-only unless a retention job explicitly archives them.

### `legacy`

Temporary migration compatibility:

- imported old Cash tenant ids
- imported ConversaFlow business ids
- imported KDS projection ids
- old slug mappings
- compatibility views if needed

The `legacy` schema is not a product schema. It exists only to migrate and verify.

## Audit Plan

### Phase 0 - Safety Setup

1. Confirm no production migration is being applied.
2. Stop or ignore the pending dashboard `business_external_refs` migration until this plan is reviewed.
3. Create an audit branch or workspace checkpoint.
4. Capture current app env names without copying secrets into docs.
5. Define these temporary environment variables locally:

```bash
export UMI_AUDIT_ROOT="/Users/juanlopez1/Documents/Repositories/Umi"
export UMI_LOCAL_DATABASE_URL="postgresql://localhost:5432/umi_platform_local"
```

### Phase 1 - Documentation Audit

Read and summarize:

- root `AGENTS.md`
- root `WORKSPACE.md`
- `docs/architecture/maps/workspace-map.md`
- `docs/architecture/maps/retrieval-map.md`
- `docs/architecture/maps/runtime-map.md`
- `docs/governance/ownership.md`
- `docs/migration/2026-04-15-supabase-multischema-state.md`
- `docs/migration/2026-04-15-umi-platform-cutover-plan.md`
- each app's `AGENTS.md`
- each app's `REPO_CONTEXT.md`
- dashboard `docs/audit-connectivity.md`

Audit output:

- current ownership claims
- stale claims
- data ownership conflicts
- product boundaries that the new platform schema should preserve

### Phase 2 - Codebase Audit

Search every app for tenant, auth, and product boundary assumptions.

Commands:

```bash
cd "$UMI_AUDIT_ROOT"

rg -n "Tenant|tenantId|tenant_id|business_id|businessId|slug|VITE_BUSINESS_SLUG|DB_SCHEMA|schema=" apps docs -S \
  --glob '!**/node_modules/**' \
  --glob '!**/dist/**' \
  --glob '!**/.next/**'

rg -n "User|staff|role|permission|auth|session|membership|customer|phone|email" apps -S \
  --glob '!**/node_modules/**' \
  --glob '!**/dist/**' \
  --glob '!**/.next/**'
```

Audit each repo:

- `apps/umi-cash`: Prisma schema, route handlers, wallet/pass APIs, tenant settings, reward config, gift cards
- `apps/umi-conversaflow`: PostgreSQL migrations, workflow jobs, conversations, messages, order creation, outbox, traces
- `apps/umi-kds`: API assumptions, ticket snapshot/transition contracts, device sessions
- `apps/umi-dashboard`: tenant selection, module gating, dashboard server adapters, Cash/KDS/ConversaFlow route boundaries
- `apps/umi-logs`: trace/log table assumptions and tenant filters

Code audit output:

- all places where tenant identity is product-local
- all places where slug is used as a durable join key
- all places where staff is product-local
- all places where customer/contact identity is duplicated
- all places where product availability should replace a hard failure

### Phase 3 - Current Database Audit

Use PostgreSQL tools only. Do not use host-specific CLIs.

Required inputs:

```bash
export UMI_CURRENT_DATABASE_URL="postgresql://..."
export UMI_LOCAL_DATABASE_URL="postgresql://localhost:5432/umi_platform_local"
```

Schema inventory:

```bash
psql "$UMI_CURRENT_DATABASE_URL" -v ON_ERROR_STOP=1 -c "
select table_schema, table_name
from information_schema.tables
where table_schema not in ('pg_catalog', 'information_schema')
order by table_schema, table_name;
"
```

Column inventory:

```bash
psql "$UMI_CURRENT_DATABASE_URL" -v ON_ERROR_STOP=1 -c "
select table_schema, table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema not in ('pg_catalog', 'information_schema')
order by table_schema, table_name, ordinal_position;
"
```

Foreign key inventory:

```bash
psql "$UMI_CURRENT_DATABASE_URL" -v ON_ERROR_STOP=1 -c "
select
  tc.table_schema,
  tc.table_name,
  kcu.column_name,
  ccu.table_schema as foreign_table_schema,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
 and ccu.table_schema = tc.table_schema
where tc.constraint_type = 'FOREIGN KEY'
order by tc.table_schema, tc.table_name, kcu.column_name;
"
```

Row count inventory:

```bash
psql "$UMI_CURRENT_DATABASE_URL" -v ON_ERROR_STOP=1 -c "
select schemaname, relname, n_live_tup
from pg_stat_user_tables
order by schemaname, relname;
"
```

Schema-only export:

```bash
mkdir -p docs/migration/audit-output
pg_dump "$UMI_CURRENT_DATABASE_URL" --schema-only --no-owner --no-privileges \
  > docs/migration/audit-output/current-schema.sql
```

Database audit output:

- current schemas and tables
- row count summary
- duplicate tenant identities
- duplicate customer/contact identities
- missing foreign keys
- tables without tenant scope
- tables that should move to `platform`, `commerce`, `cash`, `conversaflow`, `kds`, or `observability`

### Phase 4 - Target Schema Draft

Create a local-only SQL draft under:

```txt
docs/migration/local-postgres/001_platform_core.sql
docs/migration/local-postgres/002_commerce_core.sql
docs/migration/local-postgres/003_cash_core.sql
docs/migration/local-postgres/004_conversaflow_core.sql
docs/migration/local-postgres/005_kds_core.sql
docs/migration/local-postgres/006_observability_core.sql
docs/migration/local-postgres/010_seed_product_matrix.sql
```

Rules:

- No destructive SQL.
- No production connection strings.
- No host-specific functions.
- Use `gen_random_uuid()`.
- Use fully qualified table names in foreign keys.
- Do not rely on `search_path`.
- Keep tenant foreign keys explicit.
- Make product availability queryable before product module data exists.

### Phase 5 - Local Schema Creation

Install and confirm PostgreSQL locally:

```bash
psql --version
dropdb --if-exists umi_platform_local
createdb umi_platform_local
psql "$UMI_LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -c "select version();"
```

Create baseline database objects:

```bash
psql "$UMI_LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
create extension if not exists pgcrypto;

create schema if not exists platform;
create schema if not exists commerce;
create schema if not exists cash;
create schema if not exists conversaflow;
create schema if not exists kds;
create schema if not exists observability;
create schema if not exists legacy;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'umi_app') then
    create role umi_app noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'umi_worker') then
    create role umi_worker noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'umi_readonly') then
    create role umi_readonly noinherit;
  end if;
end $$;
SQL
```

Create the first platform core draft:

```sql
create table platform.users (
  id uuid primary key default gen_random_uuid(),
  auth_subject text unique,
  email text,
  phone text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table platform.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  status text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  timezone text not null default 'America/Mazatlan',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table platform.locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  slug text not null,
  name text not null,
  timezone text,
  status text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table platform.product_instances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  location_id uuid references platform.locations(id) on delete cascade,
  product_key text not null
    check (product_key in ('cash', 'conversaflow', 'kds', 'dashboard', 'observability')),
  status text not null
    check (status in ('active', 'trialing', 'disabled', 'missing', 'archived')),
  config jsonb not null default '{}'::jsonb,
  enabled_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index product_instances_tenant_product_global_key
on platform.product_instances (tenant_id, product_key)
where location_id is null;

create unique index product_instances_tenant_location_product_key
on platform.product_instances (tenant_id, location_id, product_key)
where location_id is not null;

create table platform.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  user_id uuid not null references platform.users(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'invited', 'disabled', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create table platform.staff_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  location_id uuid references platform.locations(id) on delete set null,
  user_id uuid references platform.users(id) on delete set null,
  name text not null,
  email text,
  phone text,
  status text not null default 'active'
    check (status in ('active', 'invited', 'disabled', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table platform.contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  display_name text,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table platform.contact_identities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  contact_id uuid not null references platform.contacts(id) on delete cascade,
  identity_type text not null
    check (identity_type in ('phone', 'email', 'whatsapp', 'wallet_pass', 'external')),
  identity_value text not null,
  provider text,
  created_at timestamptz not null default now(),
  unique (tenant_id, identity_type, identity_value)
);

create table platform.external_refs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references platform.tenants(id) on delete cascade,
  location_id uuid references platform.locations(id) on delete cascade,
  product_key text not null,
  external_schema text,
  external_table text,
  external_id text not null,
  external_slug text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (product_key, external_schema, external_table, external_id)
);
```

Create an auth-neutral RLS pattern for local tests:

```sql
create or replace function platform.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function platform.can_access_tenant(target_tenant_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from platform.tenant_memberships tm
    where tm.tenant_id = target_tenant_id
      and tm.user_id = platform.current_user_id()
      and tm.status = 'active'
  )
$$;

alter table platform.tenants enable row level security;
alter table platform.locations enable row level security;
alter table platform.product_instances enable row level security;
alter table platform.contacts enable row level security;

create policy tenant_member_select_tenants
on platform.tenants
for select
using (platform.can_access_tenant(id));

create policy tenant_member_select_locations
on platform.locations
for select
using (platform.can_access_tenant(tenant_id));

create policy tenant_member_select_products
on platform.product_instances
for select
using (platform.can_access_tenant(tenant_id));

create policy tenant_member_select_contacts
on platform.contacts
for select
using (platform.can_access_tenant(tenant_id));
```

Seed the minimum local product matrix:

```sql
with
  u as (
    insert into platform.users (auth_subject, email, display_name)
    values ('local-owner-1', 'owner@example.local', 'Local Owner')
    returning id
  ),
  full_tenant as (
    insert into platform.tenants (slug, name)
    values ('full-stack-cafe', 'Full Stack Cafe')
    returning id
  ),
  cash_only as (
    insert into platform.tenants (slug, name)
    values ('cash-only-cafe', 'Cash Only Cafe')
    returning id
  ),
  full_location as (
    insert into platform.locations (tenant_id, slug, name)
    select id, 'main', 'Main' from full_tenant
    returning id, tenant_id
  ),
  cash_location as (
    insert into platform.locations (tenant_id, slug, name)
    select id, 'main', 'Main' from cash_only
    returning id, tenant_id
  )
insert into platform.tenant_memberships (tenant_id, user_id)
select full_tenant.id, u.id from full_tenant, u
union all
select cash_only.id, u.id from cash_only, u;

insert into platform.product_instances (tenant_id, product_key, status, enabled_at)
select id, 'cash', 'active', now() from platform.tenants where slug in ('full-stack-cafe', 'cash-only-cafe')
union all
select id, 'conversaflow', 'active', now() from platform.tenants where slug = 'full-stack-cafe'
union all
select id, 'kds', 'active', now() from platform.tenants where slug = 'full-stack-cafe'
union all
select id, 'dashboard', 'active', now() from platform.tenants where slug in ('full-stack-cafe', 'cash-only-cafe')
union all
select id, 'conversaflow', 'missing', null from platform.tenants where slug = 'cash-only-cafe'
union all
select id, 'kds', 'missing', null from platform.tenants where slug = 'cash-only-cafe';
```

Test tenant switching locally:

```bash
LOCAL_USER_ID="$(
  psql "$UMI_LOCAL_DATABASE_URL" -At -c "select id from platform.users where auth_subject = 'local-owner-1'"
)"

psql "$UMI_LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -c "
set app.user_id = '$LOCAL_USER_ID';
select t.slug, t.name, jsonb_object_agg(pi.product_key, pi.status order by pi.product_key) as products
from platform.tenants t
join platform.product_instances pi on pi.tenant_id = t.id
where platform.can_access_tenant(t.id)
group by t.id, t.slug, t.name
order by t.slug;
"
```

Expected local result:

```txt
cash-only-cafe   Cash Only Cafe    cash=active, conversaflow=missing, dashboard=active, kds=missing
full-stack-cafe  Full Stack Cafe   cash=active, conversaflow=active, dashboard=active, kds=active
```

### Phase 6 - Product Schema Drafts

After `platform` passes local tests, add product schemas in this order:

1. `commerce`: normalized order truth
2. `cash`: wallet and loyalty linked to `platform.contacts`
3. `conversaflow`: messages/workflows linked to `platform.contacts` and `commerce.orders`
4. `kds`: tickets linked to `commerce.orders`
5. `observability`: audit and trace data
6. `legacy`: current id mappings and compatibility views

Minimum rule for every product table:

```sql
tenant_id uuid not null references platform.tenants(id)
```

Use `location_id` whenever behavior differs per branch.

### Phase 7 - Application Integration Plan

Integration order:

1. Dashboard reads `platform.tenant_memberships` after login and lists accessible tenants.
2. Dashboard stores selected `tenant_id` in client state, not env.
3. Dashboard calls `/api/tenants/:tenantId/capabilities`.
4. Each module gates itself from `platform.product_instances`.
5. Cash routes accept canonical `tenant_id`, then query `cash.*`.
6. ConversaFlow routes accept canonical `tenant_id`, then query `conversaflow.*`.
7. KDS routes accept canonical `tenant_id`, then query `kds.*`.
8. Legacy ids are resolved only through `platform.external_refs`.

Final API shape:

```json
{
  "tenant": {
    "id": "uuid",
    "slug": "cash-only-cafe",
    "name": "Cash Only Cafe"
  },
  "products": {
    "cash": { "status": "active" },
    "conversaflow": { "status": "missing" },
    "kds": { "status": "missing" },
    "dashboard": { "status": "active" }
  }
}
```

### Phase 8 - Migration Design After Local Validation

Only after the local PostgreSQL model passes:

1. Create old-to-new mapping tables in `legacy`.
2. Import current tenants into `platform.tenants`.
3. Import current locations into `platform.locations`.
4. Import current Cash customers into `platform.contacts`.
5. Import current ConversaFlow customers into `platform.contacts`.
6. Reconcile duplicate contacts by tenant + normalized phone/email.
7. Populate `platform.product_instances`.
8. Move product state into product schemas using canonical `tenant_id`.
9. Add compatibility views for old table names if needed.
10. Cut over one product module at a time.

Do not delete old tables until:

- row counts match
- referential integrity checks pass
- dashboard module behavior passes for full-stack and Cash-only tenants
- product owners approve the compatibility window ending

## Validation Gates

### Database Gates

- All tenant-scoped tables have `tenant_id`.
- All product module data joins to `platform.tenants`.
- No product schema has its own tenant source-of-truth table.
- Product availability query works for Cash-only and full-stack tenants.
- RLS-compatible policy functions work using local `app.user_id`.
- Schema can be recreated from scratch on local PostgreSQL.

### Code Gates

- No dashboard module requires a global business slug.
- No module assumes Cash exists before showing the dashboard.
- No KDS route treats KDS as order source-of-truth.
- No staff write goes to Cash.
- No customer/contact write creates duplicate identity without checking `platform.contact_identities`.

### Product Behavior Gates

- Cash-only tenant can log in and see real Cash modules.
- Cash-only tenant sees unavailable states for KDS and ConversaFlow modules.
- Full-stack tenant sees all active modules.
- Tenant switching changes module data without rebuild or env changes.
- Missing product state is explicit, not a 404 from a failed join.

## Open Questions

- Should orders live in `commerce` or `operations`? Current recommendation is `commerce` because orders and payments are commercial facts, while KDS and ConversaFlow are consumers/producers.
- Should staff permissions be platform-global or product-scoped? Current recommendation is platform-global roles with product-scoped permission keys.
- Should contacts be tenant-scoped only, or should there be an optional global person identity later? Current recommendation is tenant-scoped contacts first to avoid cross-tenant privacy risk.
- Should analytics be a schema now or derived later? Current recommendation is derived later from canonical product tables and observability events.

## Immediate Next Actions

1. Do not deploy the pending dashboard staff/external-ref migration.
2. Create the local PostgreSQL database `umi_platform_local`.
3. Draft `docs/migration/local-postgres/001_platform_core.sql` from this plan.
4. Apply it locally with `psql`.
5. Seed `full-stack-cafe` and `cash-only-cafe`.
6. Verify product availability queries.
7. Audit code against the checklist above.
8. Only then draft the product schema SQL files.
