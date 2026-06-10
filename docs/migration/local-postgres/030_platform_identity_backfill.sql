create or replace function legacy.stable_uuid(p_seed text)
returns uuid
language sql
immutable
as $$
  select (
    substr(md5(p_seed), 1, 8) || '-' ||
    substr(md5(p_seed), 9, 4) || '-' ||
    substr(md5(p_seed), 13, 4) || '-' ||
    substr(md5(p_seed), 17, 4) || '-' ||
    substr(md5(p_seed), 21, 12)
  )::uuid;
$$;

create or replace function legacy.normalize_mx_phone(p_phone text)
returns text
language sql
immutable
as $$
  with digits as (
    select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d
  )
  select case
    when d = '' then null
    when length(d) = 10 then '+52' || d
    when length(d) = 11 and left(d, 1) = '1' then '+52' || right(d, 10)
    when length(d) = 12 and left(d, 2) = '52' then '+' || d
    when length(d) = 13 and left(d, 3) = '521' then '+52' || right(d, 10)
    when left(d, 1) = '0' and length(d) > 10 then '+52' || right(d, 10)
    else '+' || d
  end
  from digits;
$$;

insert into legacy.import_batches (
  id,
  source_name,
  source_started_at,
  source_finished_at,
  status,
  metadata,
  finished_at
)
values (
  legacy.stable_uuid('import:2026-05-15-platform-identity-backfill'),
  '2026-05-15 platform identity local backfill',
  now(),
  now(),
  'completed',
  jsonb_build_object(
    'cash_source', 'umi_cash_production_local_20260515.public',
    'platform_source', 'umi_platform_production_local_20260515.conversaflow/kds/public',
    'cash_is_active_source', true,
    'platform_umi_cash_copy_is_stale', true
  ),
  now()
)
on conflict (id) do nothing;

insert into platform.tenants (id, slug, name, status, timezone, created_at, updated_at)
select
  legacy.stable_uuid('cash:tenant:' || t.id),
  t.slug,
  t.name,
  case when t."subscriptionStatus" = 'ACTIVE' then 'active' else 'disabled' end,
  coalesce(nullif(t.timezone, ''), 'America/Mazatlan'),
  coalesce(t."createdAt"::timestamptz, now()),
  coalesce(t."updatedAt"::timestamptz, now())
from src_cash_public."Tenant" t
on conflict (id) do nothing;

insert into legacy.tenant_mappings (
  import_batch_id,
  source_product,
  source_schema,
  source_table,
  source_id,
  source_slug,
  tenant_id,
  mapping_confidence,
  metadata
)
select
  legacy.stable_uuid('import:2026-05-15-platform-identity-backfill'),
  'cash',
  'public',
  'Tenant',
  t.id,
  t.slug,
  legacy.stable_uuid('cash:tenant:' || t.id),
  'exact',
  jsonb_build_object('source_name', t.name, 'source_city', t.city)
from src_cash_public."Tenant" t
on conflict (source_product, source_schema, source_table, source_id) do nothing;

insert into platform.external_refs (
  tenant_id,
  product_key,
  external_schema,
  external_table,
  external_id,
  external_slug,
  metadata
)
select
  legacy.stable_uuid('cash:tenant:' || t.id),
  'cash',
  'public',
  'Tenant',
  t.id,
  t.slug,
  jsonb_build_object('source_name', t.name)
from src_cash_public."Tenant" t
on conflict (product_key, external_schema, external_table, external_id) do nothing;

insert into platform.locations (id, tenant_id, slug, name, timezone, status)
select
  legacy.stable_uuid('cash:location:' || l.id),
  legacy.stable_uuid('cash:tenant:' || l."tenantId"),
  l.id,
  l.name,
  t.timezone,
  case when l."isActive" then 'active' else 'disabled' end
from src_cash_public."Location" l
join src_cash_public."Tenant" t on t.id = l."tenantId"
on conflict (id) do nothing;

insert into legacy.location_mappings (
  import_batch_id,
  source_product,
  source_schema,
  source_table,
  source_id,
  tenant_id,
  location_id,
  metadata
)
select
  legacy.stable_uuid('import:2026-05-15-platform-identity-backfill'),
  'cash',
  'public',
  'Location',
  l.id,
  legacy.stable_uuid('cash:tenant:' || l."tenantId"),
  legacy.stable_uuid('cash:location:' || l.id),
  jsonb_build_object('source_name', l.name, 'source_address_present', l.address is not null)
from src_cash_public."Location" l
on conflict (source_product, source_schema, source_table, source_id) do nothing;

insert into platform.external_refs (
  tenant_id,
  location_id,
  product_key,
  external_schema,
  external_table,
  external_id,
  external_slug,
  metadata
)
select
  legacy.stable_uuid('cash:tenant:' || l."tenantId"),
  legacy.stable_uuid('cash:location:' || l.id),
  'cash',
  'public',
  'Location',
  l.id,
  l.id,
  jsonb_build_object('source_name', l.name)
from src_cash_public."Location" l
on conflict (product_key, external_schema, external_table, external_id) do nothing;

-- Candidate mapping: ConversaFlow/KDS business is Café Kalala Chapule and maps to Cash tenant Kalala Café, location Chapultepec.
insert into legacy.tenant_mappings (
  import_batch_id,
  source_product,
  source_schema,
  source_table,
  source_id,
  source_slug,
  tenant_id,
  mapping_confidence,
  metadata
)
select
  legacy.stable_uuid('import:2026-05-15-platform-identity-backfill'),
  'conversaflow',
  'conversaflow',
  'businesses',
  b.id::text,
  'cafe-kalala-chapule',
  legacy.stable_uuid('cash:tenant:' || t.id),
  'candidate',
  jsonb_build_object(
    'source_name', b.name,
    'matched_cash_tenant_slug', t.slug,
    'reason', 'name/address similarity; requires human confirmation'
  )
from src_platform_conversaflow.businesses b
join src_cash_public."Tenant" t on t.slug = 'kalalacafe'
on conflict (source_product, source_schema, source_table, source_id) do nothing;

insert into legacy.location_mappings (
  import_batch_id,
  source_product,
  source_schema,
  source_table,
  source_id,
  tenant_id,
  location_id,
  metadata
)
select
  legacy.stable_uuid('import:2026-05-15-platform-identity-backfill'),
  'conversaflow',
  'conversaflow',
  'businesses.default_location',
  b.id::text,
  legacy.stable_uuid('cash:tenant:' || t.id),
  legacy.stable_uuid('cash:location:' || l.id),
  jsonb_build_object(
    'source_name', b.name,
    'matched_cash_location_name', l.name,
    'reason', 'Café Kalala Chapule maps to Cash location Chapultepec; requires human confirmation'
  )
from src_platform_conversaflow.businesses b
join src_cash_public."Tenant" t on t.slug = 'kalalacafe'
join src_cash_public."Location" l on l."tenantId" = t.id and l.id = 'kalalacafe-sucursal-centro'
on conflict (source_product, source_schema, source_table, source_id) do nothing;

insert into platform.external_refs (
  tenant_id,
  product_key,
  external_schema,
  external_table,
  external_id,
  external_slug,
  metadata
)
select
  tm.tenant_id,
  'conversaflow',
  'conversaflow',
  'businesses',
  tm.source_id,
  tm.source_slug,
  tm.metadata
from legacy.tenant_mappings tm
where tm.source_product = 'conversaflow'
  and tm.source_schema = 'conversaflow'
  and tm.source_table = 'businesses'
on conflict (product_key, external_schema, external_table, external_id) do nothing;

insert into platform.roles (tenant_id, key, name, description)
select t.id, role_key, role_name, role_description
from platform.tenants t
join legacy.tenant_mappings tm on tm.tenant_id = t.id and tm.source_product = 'cash'
cross join (
  values
    ('super_admin', 'Super Admin', 'Temporary all-action tenant admin; product entitlements still apply'),
    ('owner', 'Owner', 'Tenant owner with all tenant permissions'),
    ('admin', 'Admin', 'Business admin with operational management permissions'),
    ('staff', 'Staff', 'Business staff with day-to-day operating permissions'),
    ('developer', 'Developer', 'Umi developer support role'),
    ('tech_assist', 'Tech Assist', 'Limited technical assistance role')
) as role_seed(role_key, role_name, role_description)
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

insert into platform.tenant_memberships (tenant_id, user_id, status)
select t.id, u.id, 'active'
from platform.tenants t
join platform.users u on u.auth_subject = 'local-owner-1'
where t.slug = 'kalalacafe'
on conflict (tenant_id, user_id) do nothing;

insert into platform.membership_roles (membership_id, role_id)
select tm.id, r.id
from platform.tenant_memberships tm
join platform.tenants t on t.id = tm.tenant_id
join platform.users u on u.id = tm.user_id
join platform.roles r on r.tenant_id = tm.tenant_id and r.key = 'super_admin'
where t.slug = 'kalalacafe'
  and u.auth_subject = 'local-owner-1'
on conflict (membership_id, role_id) do nothing;

insert into platform.product_instances (tenant_id, product_key, status, enabled_at)
select tenant_id, product_key, status, case when status = 'active' then now() else null end
from (
  select
    legacy.stable_uuid('cash:tenant:' || t.id) as tenant_id,
    'cash' as product_key,
    case when t.slug = 'kalalacafe' then 'missing' else 'active' end as status
  from src_cash_public."Tenant" t
  union all
  select legacy.stable_uuid('cash:tenant:' || t.id), 'dashboard', 'active'
  from src_cash_public."Tenant" t
  union all
  select legacy.stable_uuid('cash:tenant:' || t.id), 'conversaflow', case when t.slug = 'kalalacafe' then 'active' else 'missing' end
  from src_cash_public."Tenant" t
  union all
  select legacy.stable_uuid('cash:tenant:' || t.id), 'kds', case when t.slug = 'kalalacafe' then 'active' else 'missing' end
  from src_cash_public."Tenant" t
  union all
  select legacy.stable_uuid('cash:tenant:' || t.id), 'observability', 'missing'
  from src_cash_public."Tenant" t
) product_seed
on conflict (tenant_id, product_key) where location_id is null do update
set
  status = excluded.status,
  enabled_at = case when excluded.status = 'active' then coalesce(platform.product_instances.enabled_at, excluded.enabled_at) else null end,
  disabled_at = case when excluded.status in ('disabled', 'missing', 'archived') then coalesce(platform.product_instances.disabled_at, now()) else null end,
  updated_at = now();

insert into platform.users (id, auth_subject, email, phone, display_name, created_at, updated_at)
select
  legacy.stable_uuid('cash:user:' || u.id),
  'cash:user:' || u.id,
  u.email,
  u.phone,
  coalesce(u.name, u.email, u.phone, u.id),
  coalesce(u."createdAt"::timestamptz, now()),
  coalesce(u."updatedAt"::timestamptz, now())
from src_cash_public."User" u
where u.role in ('STAFF', 'ADMIN')
on conflict (id) do nothing;

insert into legacy.user_mappings (
  import_batch_id,
  source_product,
  source_schema,
  source_table,
  source_id,
  tenant_id,
  user_id,
  metadata
)
select
  legacy.stable_uuid('import:2026-05-15-platform-identity-backfill'),
  'cash',
  'public',
  'User',
  u.id,
  legacy.stable_uuid('cash:tenant:' || u."tenantId"),
  legacy.stable_uuid('cash:user:' || u.id),
  jsonb_build_object('source_role', u.role)
from src_cash_public."User" u
where u.role in ('STAFF', 'ADMIN')
on conflict (source_product, source_schema, source_table, source_id) do nothing;

insert into platform.tenant_memberships (tenant_id, user_id, status)
select
  legacy.stable_uuid('cash:tenant:' || u."tenantId"),
  legacy.stable_uuid('cash:user:' || u.id),
  'active'
from src_cash_public."User" u
where u.role in ('STAFF', 'ADMIN')
on conflict (tenant_id, user_id) do nothing;

insert into platform.membership_roles (membership_id, role_id)
select tm.id, r.id
from platform.tenant_memberships tm
join legacy.user_mappings um on um.tenant_id = tm.tenant_id and um.user_id = tm.user_id
join src_cash_public."User" u on u.id = um.source_id
join platform.roles r on r.tenant_id = tm.tenant_id and r.key = case when u.role = 'ADMIN' then 'admin' else 'staff' end
on conflict (membership_id, role_id) do nothing;

insert into platform.staff_members (id, tenant_id, user_id, name, email, phone, status, created_at, updated_at)
select
  legacy.stable_uuid('cash:staff:' || u.id),
  legacy.stable_uuid('cash:tenant:' || u."tenantId"),
  legacy.stable_uuid('cash:user:' || u.id),
  coalesce(u.name, u.email, u.phone, u.id),
  u.email,
  u.phone,
  'active',
  coalesce(u."createdAt"::timestamptz, now()),
  coalesce(u."updatedAt"::timestamptz, now())
from src_cash_public."User" u
where u.role in ('STAFF', 'ADMIN')
on conflict (id) do nothing;

insert into legacy.staff_mappings (
  import_batch_id,
  source_product,
  source_schema,
  source_table,
  source_id,
  tenant_id,
  staff_member_id,
  metadata
)
select
  legacy.stable_uuid('import:2026-05-15-platform-identity-backfill'),
  'cash',
  'public',
  'User',
  u.id,
  legacy.stable_uuid('cash:tenant:' || u."tenantId"),
  legacy.stable_uuid('cash:staff:' || u.id),
  jsonb_build_object('source_role', u.role)
from src_cash_public."User" u
where u.role in ('STAFF', 'ADMIN')
on conflict (source_product, source_schema, source_table, source_id) do nothing;

insert into platform.contacts (id, tenant_id, display_name, phone, email, created_at, updated_at)
select
  legacy.stable_uuid('cash:contact:' || u.id),
  legacy.stable_uuid('cash:tenant:' || u."tenantId"),
  u.name,
  u.phone,
  u.email,
  coalesce(u."createdAt"::timestamptz, now()),
  coalesce(u."updatedAt"::timestamptz, now())
from src_cash_public."User" u
where u.role = 'CUSTOMER'
on conflict (id) do nothing;

insert into legacy.contact_mappings (
  import_batch_id,
  source_product,
  source_schema,
  source_table,
  source_id,
  tenant_id,
  contact_id,
  mapping_confidence,
  metadata
)
select
  legacy.stable_uuid('import:2026-05-15-platform-identity-backfill'),
  'cash',
  'public',
  'User',
  u.id,
  legacy.stable_uuid('cash:tenant:' || u."tenantId"),
  legacy.stable_uuid('cash:contact:' || u.id),
  'source_asserted',
  jsonb_build_object('source_role', u.role, 'phone_verified_at_present', u."phoneVerifiedAt" is not null)
from src_cash_public."User" u
where u.role = 'CUSTOMER'
on conflict (source_product, source_schema, source_table, source_id) do nothing;

insert into platform.contact_identities (
  id,
  tenant_id,
  contact_id,
  identity_type,
  identity_value,
  normalized_value,
  provider,
  verification_status,
  verified_at,
  confidence,
  metadata
)
select
  legacy.stable_uuid('cash:contact_identity:phone:' || u.id),
  legacy.stable_uuid('cash:tenant:' || u."tenantId"),
  legacy.stable_uuid('cash:contact:' || u.id),
  'phone',
  u.phone,
  legacy.normalize_mx_phone(u.phone),
  'cash',
  case when u."phoneVerifiedAt" is not null then 'verified' else 'unverified' end,
  u."phoneVerifiedAt"::timestamptz,
  case when u."phoneVerifiedAt" is not null then 'otp_verified' else 'source_asserted' end,
  jsonb_build_object('source_user_id', u.id)
from src_cash_public."User" u
where u.role = 'CUSTOMER'
  and nullif(trim(u.phone), '') is not null
on conflict (id) do nothing;

insert into platform.contact_identities (
  id,
  tenant_id,
  contact_id,
  identity_type,
  identity_value,
  normalized_value,
  provider,
  verification_status,
  confidence,
  metadata
)
select
  legacy.stable_uuid('cash:contact_identity:email:' || u.id),
  legacy.stable_uuid('cash:tenant:' || u."tenantId"),
  legacy.stable_uuid('cash:contact:' || u.id),
  'email',
  u.email,
  lower(trim(u.email)),
  'cash',
  'unverified',
  'source_asserted',
  jsonb_build_object('source_user_id', u.id)
from src_cash_public."User" u
where u.role = 'CUSTOMER'
  and nullif(trim(u.email), '') is not null
on conflict (id) do nothing;

with customer_signals as (
  select
    c.id,
    c.business_id,
    c.phone,
    c.name,
    c.created_at,
    coalesce(bool_or(m.role = 'user' and nullif(trim(m.twilio_message_sid), '') is not null), false) as has_user_twilio_sid,
    coalesce(bool_or(e.id is not null), false) as has_eval_trace,
    coalesce(bool_or(m.role = 'user' and m.created_at >= '2026-05-07'::timestamptz and nullif(trim(m.twilio_message_sid), '') is null and m.embedding_model = 'voyage-4-lite'), false) as has_recent_no_twilio_voyage_user_msg,
    c.name ilike '%synthetic eval%'
      or c.name ilike '%smoke%'
      or c.name ilike '%kds e2e test%' as has_synthetic_name_marker
  from src_platform_conversaflow.customers c
  left join src_platform_conversaflow.conversations v on v.customer_id = c.id
  left join src_platform_conversaflow.messages m on m.conversation_id = v.id
  left join src_platform_conversaflow.eval_traces e on e.conversation_id = v.id
  group by c.id, c.business_id, c.phone, c.name, c.created_at
),
classified as (
  select
    *,
    case
      when has_eval_trace
        or has_recent_no_twilio_voyage_user_msg
        or has_synthetic_name_marker
        or not has_user_twilio_sid
        then 'synthetic_eval'
      when has_user_twilio_sid then 'production_verified'
      else 'unknown'
    end as classification
  from customer_signals
),
tenant_map as (
  select source_id::uuid as business_id, tenant_id
  from legacy.tenant_mappings
  where source_product = 'conversaflow'
    and source_schema = 'conversaflow'
    and source_table = 'businesses'
)
insert into platform.contacts (id, tenant_id, display_name, phone, created_at, updated_at)
select
  legacy.stable_uuid('conversaflow:contact:' || c.id::text),
  tm.tenant_id,
  c.name,
  c.phone,
  coalesce(c.created_at, now()),
  coalesce(c.created_at, now())
from classified c
join tenant_map tm on tm.business_id = c.business_id
where c.classification = 'production_verified'
on conflict (id) do nothing;

with customer_signals as (
  select
    c.id,
    c.business_id,
    c.phone,
    c.name,
    coalesce(bool_or(m.role = 'user' and nullif(trim(m.twilio_message_sid), '') is not null), false) as has_user_twilio_sid,
    coalesce(bool_or(e.id is not null), false) as has_eval_trace,
    coalesce(bool_or(m.role = 'user' and m.created_at >= '2026-05-07'::timestamptz and nullif(trim(m.twilio_message_sid), '') is null and m.embedding_model = 'voyage-4-lite'), false) as has_recent_no_twilio_voyage_user_msg,
    c.name ilike '%synthetic eval%'
      or c.name ilike '%smoke%'
      or c.name ilike '%kds e2e test%' as has_synthetic_name_marker
  from src_platform_conversaflow.customers c
  left join src_platform_conversaflow.conversations v on v.customer_id = c.id
  left join src_platform_conversaflow.messages m on m.conversation_id = v.id
  left join src_platform_conversaflow.eval_traces e on e.conversation_id = v.id
  group by c.id, c.business_id, c.phone, c.name
),
classified as (
  select
    *,
    case
      when has_eval_trace
        or has_recent_no_twilio_voyage_user_msg
        or has_synthetic_name_marker
        or not has_user_twilio_sid
        then 'synthetic_eval'
      when has_user_twilio_sid then 'production_verified'
      else 'unknown'
    end as classification
  from customer_signals
),
tenant_map as (
  select source_id::uuid as business_id, tenant_id
  from legacy.tenant_mappings
  where source_product = 'conversaflow'
    and source_schema = 'conversaflow'
    and source_table = 'businesses'
)
insert into legacy.contact_mappings (
  import_batch_id,
  source_product,
  source_schema,
  source_table,
  source_id,
  tenant_id,
  contact_id,
  mapping_confidence,
  metadata
)
select
  legacy.stable_uuid('import:2026-05-15-platform-identity-backfill'),
  'conversaflow',
  'conversaflow',
  'customers',
  c.id::text,
  tm.tenant_id,
  legacy.stable_uuid('conversaflow:contact:' || c.id::text),
  'source_asserted',
  jsonb_build_object('classification', c.classification, 'provider_evidence', 'twilio_message_sid')
from classified c
join tenant_map tm on tm.business_id = c.business_id
where c.classification = 'production_verified'
on conflict (source_product, source_schema, source_table, source_id) do nothing;

insert into platform.contact_identities (
  id,
  tenant_id,
  contact_id,
  identity_type,
  identity_value,
  normalized_value,
  provider,
  verification_status,
  confidence,
  metadata
)
select
  legacy.stable_uuid('conversaflow:contact_identity:phone:' || cm.source_id),
  cm.tenant_id,
  cm.contact_id,
  'phone',
  c.phone,
  legacy.normalize_mx_phone(c.phone),
  'conversaflow',
  'unverified',
  'source_asserted',
  jsonb_build_object('source_customer_id', c.id)
from legacy.contact_mappings cm
join src_platform_conversaflow.customers c on c.id::text = cm.source_id
where cm.source_product = 'conversaflow'
  and cm.source_schema = 'conversaflow'
  and cm.source_table = 'customers'
  and nullif(trim(c.phone), '') is not null
on conflict (id) do nothing;

insert into platform.contact_identities (
  id,
  tenant_id,
  contact_id,
  identity_type,
  identity_value,
  normalized_value,
  provider,
  verification_status,
  confidence,
  metadata
)
select
  legacy.stable_uuid('conversaflow:contact_identity:whatsapp:' || cm.source_id),
  cm.tenant_id,
  cm.contact_id,
  'whatsapp',
  c.phone,
  legacy.normalize_mx_phone(c.phone),
  'twilio',
  'unverified',
  'source_asserted',
  jsonb_build_object('source_customer_id', c.id)
from legacy.contact_mappings cm
join src_platform_conversaflow.customers c on c.id::text = cm.source_id
where cm.source_product = 'conversaflow'
  and cm.source_schema = 'conversaflow'
  and cm.source_table = 'customers'
  and nullif(trim(c.phone), '') is not null
on conflict (id) do nothing;

with customer_signals as (
  select
    c.id,
    c.business_id,
    c.name,
    coalesce(bool_or(m.role = 'user' and nullif(trim(m.twilio_message_sid), '') is not null), false) as has_user_twilio_sid,
    coalesce(bool_or(e.id is not null), false) as has_eval_trace,
    coalesce(bool_or(m.role = 'user' and m.created_at >= '2026-05-07'::timestamptz and nullif(trim(m.twilio_message_sid), '') is null and m.embedding_model = 'voyage-4-lite'), false) as has_recent_no_twilio_voyage_user_msg,
    c.name ilike '%synthetic eval%'
      or c.name ilike '%smoke%'
      or c.name ilike '%kds e2e test%' as has_synthetic_name_marker
  from src_platform_conversaflow.customers c
  left join src_platform_conversaflow.conversations v on v.customer_id = c.id
  left join src_platform_conversaflow.messages m on m.conversation_id = v.id
  left join src_platform_conversaflow.eval_traces e on e.conversation_id = v.id
  group by c.id, c.business_id, c.name
),
classified as (
  select
    *,
    case
      when has_eval_trace
        or has_recent_no_twilio_voyage_user_msg
        or has_synthetic_name_marker
        or not has_user_twilio_sid
        then 'synthetic_eval'
      when has_user_twilio_sid then 'production_verified'
      else 'unknown'
    end as classification
  from customer_signals
),
tenant_map as (
  select source_id::uuid as business_id, tenant_id
  from legacy.tenant_mappings
  where source_product = 'conversaflow'
    and source_schema = 'conversaflow'
    and source_table = 'businesses'
)
insert into observability.data_quality_findings (
  tenant_id,
  product_key,
  severity,
  finding_key,
  subject_schema,
  subject_table,
  subject_id,
  detail,
  status
)
select
  tm.tenant_id,
  'conversaflow',
  case when c.classification = 'synthetic_eval' then 'info' else 'warning' end,
  'conversaflow_contact_' || c.classification,
  'conversaflow',
  'customers',
  c.id::text,
  jsonb_build_object(
    'classification', c.classification,
    'has_eval_trace', c.has_eval_trace,
    'has_recent_no_twilio_voyage_user_msg', c.has_recent_no_twilio_voyage_user_msg,
    'has_synthetic_name_marker', c.has_synthetic_name_marker,
    'human_override', '2026-05-16: previously unknown no-Twilio customers confirmed by operator as synthetic workflow/evaluation data',
    'reason', 'not imported into production contacts in this phase'
  ),
  'open'
from classified c
join tenant_map tm on tm.business_id = c.business_id
where c.classification in ('synthetic_eval', 'unknown');

insert into observability.data_quality_findings (
  tenant_id,
  product_key,
  severity,
  finding_key,
  subject_schema,
  subject_table,
  subject_id,
  detail,
  status
)
select
  tm.tenant_id,
  'conversaflow',
  'warning',
  'conversaflow_business_cash_tenant_candidate_match',
  'conversaflow',
  'businesses',
  tm.source_id,
  tm.metadata,
  'open'
from legacy.tenant_mappings tm
where tm.source_product = 'conversaflow'
  and tm.source_table = 'businesses'
  and tm.mapping_confidence = 'candidate';
