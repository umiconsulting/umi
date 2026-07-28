-- Gate 2C: operator-safe, branch-aware catalog read model.
insert into umi.permission (key, description)
values ('catalog.read', 'Read the operator-safe branch catalog')
on conflict (key) do update set description=excluded.description;
insert into umi.role_permission (role_id, permission_id)
select r.id, p.id from umi.role r cross join umi.permission p
where not r.is_platform and p.key='catalog.read'
on conflict do nothing;

alter table tenant.product
  add column sku text,
  add column barcode text,
  add column tax_rate_basis_points integer not null default 0
    check (tax_rate_basis_points between 0 and 10000);
create unique index product_business_sku_uidx
  on tenant.product (business_id, sku) where sku is not null;
create unique index product_business_barcode_uidx
  on tenant.product (business_id, barcode) where barcode is not null;

alter table tenant.product_branch_availability
  add column status text not null default 'enabled'
    check (status in ('enabled','disabled','temporarily_unavailable',
                     'out_of_assortment','future_availability')),
  add column available_from timestamptz;
update tenant.product_branch_availability
set status = case when available then 'enabled' else 'temporarily_unavailable' end;

create table tenant.product_media (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete cascade,
  product_id uuid not null references tenant.product(id) on delete cascade,
  url text not null check (length(url) <= 2048 and url ~ '^https://'),
  alt_text text check (length(alt_text) <= 240),
  width integer check (width between 1 and 8192),
  height integer check (height between 1 and 8192),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (product_id, url)
);
create table tenant.product_variant (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete cascade,
  product_id uuid not null references tenant.product(id) on delete cascade,
  name text not null,
  attributes jsonb not null default '{}'::jsonb,
  price_delta bigint not null default 0,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, name)
);
alter table tenant.product_media enable row level security;
alter table tenant.product_media force row level security;
create policy tenant_isolation on tenant.product_media
  using (business_id = umi.current_business())
  with check (business_id = umi.current_business());
grant select on tenant.product_media to api;
grant select, insert, update, delete on tenant.product_media to worker;
alter table tenant.product_variant enable row level security;
alter table tenant.product_variant force row level security;
create policy tenant_isolation on tenant.product_variant
  using (business_id = umi.current_business())
  with check (business_id = umi.current_business());
grant select on tenant.product_variant to api;
grant select, insert, update, delete on tenant.product_variant to worker;
