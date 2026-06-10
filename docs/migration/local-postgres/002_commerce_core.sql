create schema if not exists commerce;

create table commerce.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  location_id uuid references platform.locations(id),
  contact_id uuid references platform.contacts(id),
  order_number text,
  source_product text not null
    check (source_product in ('cash', 'conversaflow', 'kds', 'dashboard', 'external')),
  source_ref text,
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'accepted', 'in_progress', 'ready', 'completed', 'cancelled', 'refunded')),
  channel text,
  currency text not null default 'MXN',
  subtotal_cents integer not null default 0,
  tax_cents integer not null default 0,
  discount_cents integer not null default 0,
  total_cents integer not null default 0,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  placed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index commerce_orders_tenant_status_idx
  on commerce.orders (tenant_id, status, created_at desc);

create index commerce_orders_location_status_idx
  on commerce.orders (location_id, status, created_at desc)
  where location_id is not null;

create table commerce.order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  order_id uuid not null references commerce.orders(id) on delete cascade,
  product_ref text,
  name text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null default 0,
  total_cents integer not null default 0,
  variant_name text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index commerce_order_items_order_idx
  on commerce.order_items (order_id, id);

create table commerce.order_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  order_id uuid not null references commerce.orders(id) on delete cascade,
  event_type text not null,
  previous_status text,
  next_status text,
  actor_user_id uuid references platform.users(id),
  actor_staff_member_id uuid references platform.staff_members(id),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index commerce_order_events_order_idx
  on commerce.order_events (order_id, occurred_at desc);

create table commerce.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  order_id uuid references commerce.orders(id) on delete set null,
  contact_id uuid references platform.contacts(id),
  provider text,
  provider_payment_id text,
  status text not null default 'pending'
    check (status in ('pending', 'authorized', 'paid', 'failed', 'refunded', 'cancelled')),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'MXN',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index commerce_payments_tenant_status_idx
  on commerce.payments (tenant_id, status, created_at desc);

create table commerce.refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  payment_id uuid not null references commerce.payments(id) on delete cascade,
  provider_refund_id text,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'cancelled')),
  amount_cents integer not null check (amount_cents > 0),
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index commerce_refunds_payment_idx
  on commerce.refunds (payment_id, created_at desc);

create table commerce.business_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  location_id uuid references platform.locations(id),
  timezone text not null,
  weekly_hours jsonb not null default '{}'::jsonb,
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index commerce_business_hours_tenant_location_idx
  on commerce.business_hours (tenant_id, location_id);

create table commerce.service_windows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  location_id uuid references platform.locations(id),
  service_key text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer,
  status text not null default 'open'
    check (status in ('open', 'limited', 'closed', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index commerce_service_windows_tenant_time_idx
  on commerce.service_windows (tenant_id, starts_at, ends_at);

grant select on all tables in schema commerce to umi_app, umi_worker, umi_readonly;
