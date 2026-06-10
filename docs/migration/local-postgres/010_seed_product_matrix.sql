insert into platform.users (auth_subject, email, display_name)
values ('local-owner-1', 'owner@example.local', 'Local Owner')
on conflict (auth_subject) do nothing;

insert into platform.tenants (slug, name)
values
  ('kalalacafe', 'Kalala'),
  ('full-stack-cafe', 'Full Stack Cafe'),
  ('cash-only-cafe', 'Cash Only Cafe')
on conflict (slug) do nothing;

insert into platform.locations (tenant_id, slug, name)
select id, 'main', 'Main'
from platform.tenants
where slug in ('full-stack-cafe', 'cash-only-cafe')
on conflict (tenant_id, slug) do nothing;

insert into platform.locations (tenant_id, slug, name)
select t.id, v.slug, v.name
from platform.tenants t
cross join (
  values
    ('chapultepec', 'Chapultepec'),
    ('branch-2', 'Branch 2')
) as v(slug, name)
where t.slug = 'kalalacafe'
on conflict (tenant_id, slug) do nothing;

insert into platform.tenant_memberships (tenant_id, user_id)
select t.id, u.id
from platform.tenants t
cross join platform.users u
where t.slug in ('kalalacafe', 'full-stack-cafe', 'cash-only-cafe')
  and u.auth_subject = 'local-owner-1'
on conflict (tenant_id, user_id) do nothing;

insert into platform.permissions (key, description)
values
  ('dashboard.view', 'View dashboard shell and tenant modules'),
  ('cash.view', 'View Cash loyalty and wallet data'),
  ('cash.manage', 'Manage Cash loyalty, wallet, rewards, and gift cards'),
  ('conversaflow.view', 'View ConversaFlow conversations and operational state'),
  ('conversaflow.manage', 'Manage ConversaFlow configuration and workflows'),
  ('kds.view', 'View KDS tickets, stations, and devices'),
  ('kds.manage', 'Manage KDS devices, stations, and order transitions'),
  ('observability.view', 'View operational logs, traces, and diagnostics'),
  ('staff.manage', 'Manage tenant staff and permissions'),
  ('support.access', 'Access support surfaces for troubleshooting')
on conflict (key) do nothing;

insert into platform.roles (tenant_id, key, name, description)
select id, role_key, role_name, role_description
from platform.tenants
cross join (
  values
    ('super_admin', 'Super Admin', 'Temporary all-action tenant admin; product entitlements still apply'),
    ('owner', 'Owner', 'Tenant owner with all tenant permissions'),
    ('admin', 'Admin', 'Business admin with operational management permissions'),
    ('staff', 'Staff', 'Business staff with day-to-day operating permissions'),
    ('developer', 'Developer', 'Umi developer support role'),
    ('tech_assist', 'Tech Assist', 'Limited technical assistance role')
) as role_seed(role_key, role_name, role_description)
where slug in ('kalalacafe', 'full-stack-cafe', 'cash-only-cafe')
on conflict do nothing;

insert into platform.role_permissions (role_id, permission_id)
select r.id, p.id
from platform.roles r
join platform.permissions p on (
  r.key in ('super_admin', 'owner', 'developer')
  or (r.key = 'admin' and p.key in (
    'dashboard.view',
    'cash.view',
    'cash.manage',
    'conversaflow.view',
    'conversaflow.manage',
    'kds.view',
    'kds.manage',
    'observability.view',
    'staff.manage'
  ))
  or (r.key = 'staff' and p.key in (
    'dashboard.view',
    'cash.view',
    'kds.view',
    'kds.manage'
  ))
  or (r.key = 'tech_assist' and p.key in (
    'dashboard.view',
    'observability.view',
    'support.access'
  ))
)
on conflict (role_id, permission_id) do nothing;

insert into platform.membership_roles (membership_id, role_id)
select tm.id, r.id
from platform.tenant_memberships tm
join platform.users u on u.id = tm.user_id
join platform.roles r on r.tenant_id = tm.tenant_id and r.key = 'super_admin'
where u.auth_subject = 'local-owner-1'
on conflict (membership_id, role_id) do nothing;

insert into platform.product_instances (tenant_id, product_key, status, enabled_at)
select t.id, v.product_key, v.status, case when v.status = 'active' then now() else null end
from platform.tenants t
join (
  values
    ('kalalacafe', 'dashboard', 'active'),
    ('kalalacafe', 'conversaflow', 'active'),
    ('kalalacafe', 'kds', 'active'),
    ('kalalacafe', 'cash', 'missing'),
    ('kalalacafe', 'observability', 'missing'),
    ('full-stack-cafe', 'cash', 'active'),
    ('full-stack-cafe', 'conversaflow', 'active'),
    ('full-stack-cafe', 'kds', 'active'),
    ('full-stack-cafe', 'dashboard', 'active'),
    ('full-stack-cafe', 'observability', 'active'),
    ('cash-only-cafe', 'cash', 'active'),
    ('cash-only-cafe', 'dashboard', 'active'),
    ('cash-only-cafe', 'conversaflow', 'missing'),
    ('cash-only-cafe', 'kds', 'missing'),
    ('cash-only-cafe', 'observability', 'missing')
) as v(tenant_slug, product_key, status)
  on v.tenant_slug = t.slug
on conflict (tenant_id, product_key) where location_id is null do update
set
  status = excluded.status,
  enabled_at = case when excluded.status = 'active' then coalesce(platform.product_instances.enabled_at, excluded.enabled_at) else null end,
  disabled_at = case when excluded.status in ('disabled', 'missing', 'archived') then coalesce(platform.product_instances.disabled_at, now()) else null end,
  updated_at = now();

insert into platform.contacts (tenant_id, display_name, phone, email)
select id, 'Local Customer', '+520000000000', 'customer@example.local'
from platform.tenants
where slug = 'full-stack-cafe';

insert into platform.contact_identities (
  tenant_id,
  contact_id,
  identity_type,
  identity_value,
  normalized_value,
  provider,
  verification_status,
  confidence
)
select tenant_id, id, 'phone', '+520000000000', '+520000000000', 'local', 'unverified', 'source_asserted'
from platform.contacts
where email = 'customer@example.local';
