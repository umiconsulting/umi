-- =============================================================================
-- 10_umi.sql  (canonical rebuild v2 — schema `umi`, SEALED from umi_app)
--
-- Umi's OWN business / control-plane: the prospect funnel that sits OUTSIDE any
-- customer tenant, the per-tenant billing subscription + its line items, and
-- invoices. This is NOT a tenant-facing product schema — it is umi_worker-only.
--
-- Sources -> canonical:
--   build/17_grow.sql grow.leads          -> umi.prospect        (pre-tenant, no tenant_id)
--   build/17_grow.sql grow.lead_events    -> umi.prospect_event  (child of prospect)
--   build/17_grow.sql grow.subscriptions  -> umi.subscription    (tenant billing ledger)
--   build/10_core.sql core.product_instances -> umi.subscription_item (billing line item)
--   (new)                                 -> umi.invoice         (table only, no writer yet)
--   DROPPED: grow.feature_flags (not authored in the rebuild).
--
-- Depends on: 00_foundation.sql (schemas, roles, `umi` USAGE granted to
--   umi_worker/umi_readonly ONLY — umi_app has NO usage), 11_tenant_core.sql
--   (tenant.tenant — the cross-seam FK target).
--
-- TENANCY: umi is NOT an RLS schema. Isolation here is the schema-USAGE seal
--   (00_foundation withheld umi_app USAGE) + the REVOKE ALL below. Cross-seam FKs
--   into tenant.tenant(id) are PLAIN (not composite) — umi carries no tenant RLS
--   context. prospect/prospect_event are TENANT-LESS (a prospect is pre-tenant).
--
-- Idempotent: create ... if not exists. No kernel fn bodies referenced.
-- =============================================================================

begin;

set search_path = umi, tenant, public, extensions;

-- ===========================================================================
-- umi.prospect  <- grow.leads (TENANT-LESS Umi prospect funnel). Every source
--   lead column carried (no silent drop). No tenant_id (a prospect has not
--   become a tenant yet). PK (id). Partial-unique active-email reproduced.
-- ===========================================================================
create table if not exists umi.prospect (
  id                     uuid not null default gen_random_uuid(),
  email                  text not null,
  name                   text not null,
  phone                  text,
  company                text,
  role_title             text,
  consent_state          text,
  lifecycle_status       text not null default 'new',
  diagnostic_data        jsonb,
  diagnostic_date        timestamptz not null,
  first_contact_channel  text,
  first_contact_campaign text,
  utm_source             text,
  utm_medium             text,
  utm_campaign           text,
  utm_content            text,
  utm_term               text,
  referrer               text,
  landing_path           text,
  submitted_form         text,
  source_app             text not null default 'umi-landing-page',
  first_contact_at       timestamptz not null default now(),
  sequence_paused        boolean not null default false,
  pause_reason           text,
  emails_sent            text[] not null default '{}'::text[],
  last_email_sent_at     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  primary key (id)
);

-- At most one ACTIVE prospect per email (an email may recur once its prior
-- prospect has exited the active funnel).
create unique index if not exists umi_prospect_email_active_uidx
  on umi.prospect (email)
  where lifecycle_status in ('new', 'nurturing', 'qualified');

create index if not exists umi_prospect_lifecycle_idx
  on umi.prospect (lifecycle_status);
create index if not exists umi_prospect_created_at_idx
  on umi.prospect (created_at desc);
create index if not exists umi_prospect_email_idx
  on umi.prospect (email);
create index if not exists umi_prospect_diagnostic_date_idx
  on umi.prospect (diagnostic_date desc);
create index if not exists umi_prospect_utm_campaign_idx
  on umi.prospect (utm_campaign) where utm_campaign is not null;

-- ===========================================================================
-- umi.prospect_event  <- grow.lead_events. Child business-event timeline of a
--   prospect (form_submitted, email_sent, opened, replied, …). TENANT-LESS.
--   prospect_id -> umi.prospect(id) ON DELETE CASCADE (source FK preserved).
--   Append-only-ish by convention but NO trigger (only the two financial
--   ledgers get the append-only trigger).
-- ===========================================================================
create table if not exists umi.prospect_event (
  id          uuid not null default gen_random_uuid(),
  prospect_id uuid not null references umi.prospect(id) on delete cascade,
  event_type  text not null,
  event_data  jsonb,
  created_at  timestamptz not null default now(),
  primary key (id)
);

create index if not exists umi_prospect_event_prospect_id_idx
  on umi.prospect_event (prospect_id, created_at desc);
create index if not exists umi_prospect_event_type_idx
  on umi.prospect_event (event_type);
create index if not exists umi_prospect_event_created_at_idx
  on umi.prospect_event (created_at desc);

-- ===========================================================================
-- umi.subscription  <- grow.subscriptions. The per-tenant BILLING ledger — one
--   subscription per tenant. Cross-seam PLAIN FK tenant_id -> tenant.tenant(id)
--   (umi is not RLS, so composite tenant isolation does not apply). `status`
--   renamed billing_status (billing lifecycle, distinct from tenant.status which
--   is org lifecycle). trial_ends_at / suspended_at carried from source.
-- ===========================================================================
create table if not exists umi.subscription (
  id             uuid not null default gen_random_uuid(),
  tenant_id      uuid not null references tenant.tenant(id) on delete cascade,
  plan           text not null default 'standard',
  billing_status text not null default 'active'
    check (billing_status in ('active', 'trialing', 'disabled', 'missing', 'archived')),
  trial_ends_at  timestamptz,
  suspended_at   timestamptz,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (id),
  unique (tenant_id)                             -- one billing record per tenant
);

create index if not exists umi_subscription_status_idx
  on umi.subscription (billing_status);
create index if not exists umi_subscription_trial_ends_idx
  on umi.subscription (trial_ends_at) where trial_ends_at is not null;

-- ===========================================================================
-- umi.subscription_item  <- core.product_instances. Per-tenant product
--   enablement, reframed as billing line items on the tenant's subscription.
--   product_key CHECK drops the 'observability'/'landing' enum values and adds
--   'pos'. Cross-seam PLAIN FK tenant_id -> tenant.tenant(id).
--   NOTE (judgment call): source `location_id` + its composite FK into
--   core.locations is DROPPED — Umi billing is at TENANT granularity (a line
--   item, not per-branch), and a sealed umi table should not carry a composite
--   FK into the RLS tenant.branch. Per-branch enablement is an operational
--   concern that stays in the tenant schema. UNIQUE collapses to (tenant_id,
--   product_key). config / enabled_at / disabled_at carried faithfully.
-- ===========================================================================
create table if not exists umi.subscription_item (
  id           uuid not null default gen_random_uuid(),
  tenant_id    uuid not null references tenant.tenant(id) on delete cascade,
  product_key  text not null
    check (product_key in ('cash', 'conversaflow', 'kds', 'dashboard', 'pos')),
  status       text not null
    check (status in ('active', 'trialing', 'disabled', 'missing', 'archived')),
  config       jsonb not null default '{}'::jsonb,
  enabled_at   timestamptz,
  disabled_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, product_key)                -- one line item per tenant+product
);

create index if not exists umi_subscription_item_tenant_idx
  on umi.subscription_item (tenant_id);
create index if not exists umi_subscription_item_product_idx
  on umi.subscription_item (product_key, status);

-- ===========================================================================
-- umi.invoice  (NEW). A billed period for a tenant. Table only — no writer yet.
--   cents bigint (integer money in centavos), currency default 'MXN', a billing
--   period, a status, and a unique idempotency_key so a billing run is safe to
--   retry. Cross-seam PLAIN FK tenant_id -> tenant.tenant(id).
-- ===========================================================================
create table if not exists umi.invoice (
  id              uuid not null default gen_random_uuid(),
  tenant_id       uuid not null references tenant.tenant(id) on delete cascade,
  cents           bigint not null default 0,
  currency        text not null default 'MXN',
  period_start    date,
  period_end      date,
  status          text not null default 'draft'
    check (status in ('draft', 'open', 'paid', 'void', 'uncollectible')),
  idempotency_key text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (id),
  unique (idempotency_key)
);

create index if not exists umi_invoice_tenant_time_idx
  on umi.invoice (tenant_id, created_at desc);
create index if not exists umi_invoice_status_idx
  on umi.invoice (status);
create index if not exists umi_invoice_period_idx
  on umi.invoice (period_start, period_end);

-- ===========================================================================
-- GRANTS — SEALED SCHEMA: umi_worker ONLY (never umi_app). 00_foundation already
--   withheld umi_app USAGE on `umi`; we do not re-grant it. umi_worker owns the
--   read+write path; umi_readonly may SELECT for internal analytics. Then a hard
--   REVOKE so no later blanket grant loop can leak prospect PII / billing to the
--   request role.
-- ===========================================================================
grant select on all tables in schema umi to umi_worker, umi_readonly;
grant insert, update, delete on all tables in schema umi to umi_worker;

alter default privileges in schema umi
  grant select on tables to umi_worker, umi_readonly;
alter default privileges in schema umi
  grant insert, update, delete on tables to umi_worker;

-- Hard seal: umi_app + public must never touch umi (Umi-internal only).
revoke all on all tables in schema umi from umi_app, public;

commit;
