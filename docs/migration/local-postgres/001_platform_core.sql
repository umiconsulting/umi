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

do $$
begin
  execute format('grant umi_app to %I', current_user);
  execute format('grant umi_worker to %I', current_user);
  execute format('grant umi_readonly to %I', current_user);
end $$;

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

create table platform.roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references platform.tenants(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create unique index platform_roles_tenant_key_uidx
  on platform.roles (tenant_id, key)
  where tenant_id is not null;

create unique index platform_roles_global_key_uidx
  on platform.roles (key)
  where tenant_id is null;

create table platform.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table platform.role_permissions (
  role_id uuid not null references platform.roles(id) on delete cascade,
  permission_id uuid not null references platform.permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create table platform.membership_roles (
  membership_id uuid not null references platform.tenant_memberships(id) on delete cascade,
  role_id uuid not null references platform.roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (membership_id, role_id)
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

create index platform_staff_members_tenant_status_idx
  on platform.staff_members (tenant_id, status, name);

create unique index platform_staff_members_tenant_email_uidx
  on platform.staff_members (tenant_id, email)
  where email is not null;

create unique index platform_staff_members_tenant_phone_uidx
  on platform.staff_members (tenant_id, phone)
  where phone is not null;

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

create table platform.contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  display_name text,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index platform_contacts_tenant_name_idx
  on platform.contacts (tenant_id, display_name);

create table platform.contact_identities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  contact_id uuid not null references platform.contacts(id) on delete cascade,
  identity_type text not null
    check (identity_type in ('phone', 'email', 'whatsapp', 'wallet_pass', 'external')),
  identity_value text not null,
  normalized_value text,
  provider text,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'failed', 'expired')),
  verified_at timestamptz,
  confidence text not null default 'source_asserted'
    check (confidence in ('source_asserted', 'otp_verified', 'staff_verified', 'candidate')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index platform_contact_identities_contact_idx
  on platform.contact_identities (contact_id);

create index platform_contact_identities_lookup_idx
  on platform.contact_identities (tenant_id, identity_type, normalized_value)
  where normalized_value is not null;

create unique index platform_contact_identities_verified_uidx
  on platform.contact_identities (tenant_id, identity_type, normalized_value)
  where normalized_value is not null
    and verification_status = 'verified';

create table platform.external_refs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references platform.tenants(id) on delete cascade,
  location_id uuid references platform.locations(id) on delete cascade,
  product_key text not null
    check (product_key in ('cash', 'conversaflow', 'kds', 'dashboard', 'observability', 'legacy')),
  external_schema text,
  external_table text,
  external_id text not null,
  external_slug text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (product_key, external_schema, external_table, external_id)
);

create index platform_external_refs_tenant_idx
  on platform.external_refs (tenant_id, product_key);

create table platform.contact_merge_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  left_contact_id uuid not null references platform.contacts(id) on delete cascade,
  right_contact_id uuid not null references platform.contacts(id) on delete cascade,
  match_type text not null
    check (match_type in ('exact_normalized_phone', 'exact_normalized_email', 'last10_phone', 'manual_review')),
  confidence text not null default 'candidate'
    check (confidence in ('candidate', 'high', 'rejected', 'merged')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (left_contact_id <> right_contact_id),
  unique (tenant_id, left_contact_id, right_contact_id, match_type)
);

create index platform_contact_merge_candidates_tenant_confidence_idx
  on platform.contact_merge_candidates (tenant_id, confidence, created_at desc);

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
security definer
set search_path = platform, pg_temp
as $$
  select exists (
    select 1
    from platform.tenant_memberships tm
    where tm.tenant_id = target_tenant_id
      and tm.user_id = platform.current_user_id()
      and tm.status = 'active'
  )
$$;

create or replace view platform.tenant_product_capabilities
with (security_invoker = true)
as
select
  t.id as tenant_id,
  t.slug,
  t.name,
  jsonb_object_agg(
    pi.product_key,
    jsonb_build_object(
      'status', pi.status,
      'location_id', pi.location_id,
      'config', pi.config
    )
    order by pi.product_key
  ) as products
from platform.tenants t
join platform.product_instances pi on pi.tenant_id = t.id
group by t.id, t.slug, t.name;

alter table platform.tenants enable row level security;
alter table platform.locations enable row level security;
alter table platform.tenant_memberships enable row level security;
alter table platform.staff_members enable row level security;
alter table platform.product_instances enable row level security;
alter table platform.contacts enable row level security;
alter table platform.contact_identities enable row level security;
alter table platform.external_refs enable row level security;
alter table platform.contact_merge_candidates enable row level security;

create policy tenant_member_select_tenants
on platform.tenants
for select
using (platform.can_access_tenant(id));

create policy tenant_member_select_locations
on platform.locations
for select
using (platform.can_access_tenant(tenant_id));

create policy tenant_member_select_memberships
on platform.tenant_memberships
for select
using (platform.can_access_tenant(tenant_id));

create policy tenant_member_select_staff
on platform.staff_members
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

create policy tenant_member_select_contact_identities
on platform.contact_identities
for select
using (platform.can_access_tenant(tenant_id));

create policy tenant_member_select_contact_merge_candidates
on platform.contact_merge_candidates
for select
using (platform.can_access_tenant(tenant_id));

create policy tenant_member_select_external_refs
on platform.external_refs
for select
using (tenant_id is null or platform.can_access_tenant(tenant_id));

grant usage on schema platform, commerce, cash, conversaflow, kds, observability, legacy
  to umi_app, umi_worker, umi_readonly;

grant select on all tables in schema platform to umi_app, umi_worker, umi_readonly;
grant execute on function platform.current_user_id() to umi_app, umi_worker, umi_readonly;
grant execute on function platform.can_access_tenant(uuid) to umi_app, umi_worker, umi_readonly;
