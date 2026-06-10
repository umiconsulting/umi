create schema if not exists legacy;

create table legacy.import_batches (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_started_at timestamptz,
  source_finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'abandoned')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table legacy.tenant_mappings (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references legacy.import_batches(id) on delete set null,
  source_product text not null,
  source_schema text,
  source_table text not null,
  source_id text not null,
  source_slug text,
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  mapping_confidence text not null default 'manual'
    check (mapping_confidence in ('manual', 'exact', 'candidate', 'unresolved')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_product, source_schema, source_table, source_id)
);

create index legacy_tenant_mappings_tenant_idx
  on legacy.tenant_mappings (tenant_id, source_product);

create table legacy.location_mappings (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references legacy.import_batches(id) on delete set null,
  source_product text not null,
  source_schema text,
  source_table text not null,
  source_id text not null,
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  location_id uuid not null references platform.locations(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_product, source_schema, source_table, source_id)
);

create index legacy_location_mappings_location_idx
  on legacy.location_mappings (tenant_id, location_id);

create table legacy.user_mappings (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references legacy.import_batches(id) on delete set null,
  source_product text not null,
  source_schema text,
  source_table text not null,
  source_id text not null,
  tenant_id uuid references platform.tenants(id) on delete cascade,
  user_id uuid references platform.users(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_product, source_schema, source_table, source_id)
);

create index legacy_user_mappings_user_idx
  on legacy.user_mappings (user_id)
  where user_id is not null;

create table legacy.staff_mappings (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references legacy.import_batches(id) on delete set null,
  source_product text not null,
  source_schema text,
  source_table text not null,
  source_id text not null,
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  staff_member_id uuid not null references platform.staff_members(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_product, source_schema, source_table, source_id)
);

create index legacy_staff_mappings_staff_idx
  on legacy.staff_mappings (tenant_id, staff_member_id);

create table legacy.contact_mappings (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references legacy.import_batches(id) on delete set null,
  source_product text not null,
  source_schema text,
  source_table text not null,
  source_id text not null,
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  contact_id uuid not null references platform.contacts(id) on delete cascade,
  mapping_confidence text not null default 'source_asserted'
    check (mapping_confidence in ('source_asserted', 'exact', 'candidate', 'manual')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_product, source_schema, source_table, source_id)
);

create index legacy_contact_mappings_contact_idx
  on legacy.contact_mappings (tenant_id, contact_id);

create table legacy.order_mappings (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references legacy.import_batches(id) on delete set null,
  source_product text not null,
  source_schema text,
  source_table text not null,
  source_id text not null,
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  order_id uuid not null references commerce.orders(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_product, source_schema, source_table, source_id)
);

create index legacy_order_mappings_order_idx
  on legacy.order_mappings (tenant_id, order_id);

create table legacy.kds_ticket_mappings (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references legacy.import_batches(id) on delete set null,
  source_schema text not null default 'kds',
  source_table text not null default 'tickets',
  source_ticket_id text not null,
  source_transaction_id text,
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  ticket_id uuid not null references kds.tickets(id) on delete cascade,
  order_id uuid references commerce.orders(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_schema, source_table, source_ticket_id)
);

create index legacy_kds_ticket_mappings_ticket_idx
  on legacy.kds_ticket_mappings (tenant_id, ticket_id);

create table legacy.public_compat_imports (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references legacy.import_batches(id) on delete set null,
  source_schema text not null default 'public',
  source_table text not null,
  source_id text not null,
  target_schema text,
  target_table text,
  target_id text,
  action text not null
    check (action in ('ignored_duplicate', 'imported_public_only', 'archived_only', 'manual_review')),
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_schema, source_table, source_id, action)
);

create index legacy_public_compat_imports_table_idx
  on legacy.public_compat_imports (source_table, action);

create table legacy.replay_queue (
  id uuid primary key default gen_random_uuid(),
  source_product text not null,
  source_schema text,
  source_table text not null,
  source_id text not null,
  tenant_id uuid references platform.tenants(id) on delete cascade,
  replay_kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'staged'
    check (status in ('staged', 'approved', 'enqueued', 'skipped', 'failed')),
  approved_by_user_id uuid references platform.users(id) on delete set null,
  approved_at timestamptz,
  enqueued_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_product, source_schema, source_table, source_id, replay_kind)
);

create index legacy_replay_queue_status_idx
  on legacy.replay_queue (status, created_at);

grant select on all tables in schema legacy to umi_app, umi_worker, umi_readonly;
grant insert, update on all tables in schema legacy to umi_worker;
