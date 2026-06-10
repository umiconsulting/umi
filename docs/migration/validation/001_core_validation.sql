\echo SECTION: product capability matrix
select
  slug,
  name,
  products
from platform.tenant_product_capabilities
order by slug;

\echo SECTION: kalala current product contract
with kalala as (
  select id, slug
  from platform.tenants
  where slug = 'kalalacafe'
),
locations as (
  select tenant_id, count(*) as location_count
  from platform.locations
  where status = 'active'
  group by tenant_id
),
products as (
  select
    tenant_id,
    jsonb_object_agg(product_key, status order by product_key) as product_statuses
  from platform.product_instances
  where location_id is null
  group by tenant_id
)
select
  k.slug,
  coalesce(l.location_count, 0) as location_count,
  coalesce(p.product_statuses, '{}'::jsonb) as product_statuses
from kalala k
left join locations l on l.tenant_id = k.id
left join products p on p.tenant_id = k.id;

\echo SECTION: kalala product contract violations
with kalala as (
  select id, slug
  from platform.tenants
  where slug = 'kalalacafe'
),
locations as (
  select tenant_id, count(*) as location_count
  from platform.locations
  where status = 'active'
  group by tenant_id
),
products as (
  select
    tenant_id,
    jsonb_object_agg(product_key, status order by product_key) as product_statuses
  from platform.product_instances
  where location_id is null
  group by tenant_id
)
select
  k.slug,
  coalesce(l.location_count, 0) as location_count,
  coalesce(p.product_statuses, '{}'::jsonb) as product_statuses
from kalala k
left join locations l on l.tenant_id = k.id
left join products p on p.tenant_id = k.id
where coalesce(l.location_count, 0) <> 2
   or coalesce(p.product_statuses->>'dashboard', '') <> 'active'
   or coalesce(p.product_statuses->>'conversaflow', '') <> 'active'
   or coalesce(p.product_statuses->>'kds', '') <> 'active'
   or coalesce(p.product_statuses->>'cash', '') <> 'missing';

\echo SECTION: product tables missing tenant_id
select
  n.nspname as table_schema,
  c.relname as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r'
  and n.nspname in ('cash', 'commerce', 'conversaflow', 'kds')
  and not exists (
    select 1
    from pg_attribute a
    where a.attrelid = c.oid
      and a.attname = 'tenant_id'
      and not a.attisdropped
  )
order by n.nspname, c.relname;

\echo SECTION: tenant_id columns without platform.tenants foreign key
select
  table_schema,
  table_name,
  column_name
from information_schema.columns col
where col.table_schema in ('cash', 'commerce', 'conversaflow', 'kds', 'observability')
  and col.column_name = 'tenant_id'
  and not exists (
    select 1
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name
     and kcu.constraint_schema = tc.constraint_schema
     and kcu.table_schema = tc.table_schema
     and kcu.table_name = tc.table_name
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name
     and ccu.constraint_schema = tc.constraint_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = col.table_schema
      and tc.table_name = col.table_name
      and kcu.column_name = col.column_name
      and ccu.table_schema = 'platform'
      and ccu.table_name = 'tenants'
      and ccu.column_name = 'id'
  )
order by table_schema, table_name;

\echo SECTION: verified duplicate contact identities
select
  tenant_id,
  identity_type,
  normalized_value,
  count(*) as duplicate_count
from platform.contact_identities
where normalized_value is not null
  and verification_status = 'verified'
group by tenant_id, identity_type, normalized_value
having count(*) > 1
order by duplicate_count desc;

\echo SECTION: unverified duplicate contact identity candidates
select
  tenant_id,
  identity_type,
  normalized_value,
  count(*) as candidate_count
from platform.contact_identities
where normalized_value is not null
  and verification_status <> 'verified'
group by tenant_id, identity_type, normalized_value
having count(*) > 1
order by candidate_count desc;

\echo SECTION: replay rows that would require operator approval
select
  status,
  count(*) as rows
from legacy.replay_queue
group by status
order by status;

\echo SECTION: local owner rls visible tenants
select set_config(
  'app.user_id',
  (select id::text from platform.users where auth_subject = 'local-owner-1'),
  false
);
set role umi_app;
select
  slug,
  name
from platform.tenants
order by slug;
reset role;

\echo SECTION: rls with no user context
select set_config('app.user_id', '', false);
set role umi_app;
select count(*) as visible_tenants_without_user
from platform.tenants;
reset role;

\echo SECTION: seeded role permissions
select
  t.slug,
  r.key as role_key,
  count(rp.permission_id) as permission_count
from platform.roles r
left join platform.tenants t on t.id = r.tenant_id
left join platform.role_permissions rp on rp.role_id = r.id
group by t.slug, r.key
order by t.slug, r.key;
