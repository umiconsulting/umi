-- Gate 2D: mutable sale preparation only. These tables never represent an order.
insert into umi.permission (key, description)
values ('cart.write', 'Prepare a branch-scoped POS cart')
on conflict (key) do update set description=excluded.description;
insert into umi.role_permission (role_id, permission_id)
select r.id,p.id from umi.role r cross join umi.permission p
where not r.is_platform and p.key='cart.write'
on conflict do nothing;

create table tenant.pos_cart (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete cascade,
  branch_id uuid not null references tenant.branch(id),
  operator_session_id uuid not null references runtime.operator_session(id),
  status text not null default 'draft' check (status in ('draft','prepared','abandoned')),
  version integer not null default 1 check (version > 0),
  business_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index pos_cart_active_operator_uidx
  on tenant.pos_cart(operator_session_id) where status in ('draft','prepared');

create table tenant.pos_cart_line (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete cascade,
  cart_id uuid not null references tenant.pos_cart(id) on delete cascade,
  product_id uuid not null references tenant.product(id),
  variant_id uuid references tenant.product_variant(id),
  identity_key text not null check (identity_key ~ '^[a-f0-9]{64}$'),
  product_name text not null,
  variant_name text,
  variant_attributes jsonb not null default '{}'::jsonb,
  quantity integer not null check (quantity between 1 and 999),
  note text check (length(note) <= 500 and note !~ '[<>]'),
  base_price bigint not null check (base_price >= 0),
  variant_delta bigint not null default 0,
  modifier_total bigint not null default 0,
  tax_rate_basis_points integer not null check (tax_rate_basis_points between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(cart_id,identity_key)
);

create table tenant.pos_cart_line_modifier (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete cascade,
  line_id uuid not null references tenant.pos_cart_line(id) on delete cascade,
  group_id uuid not null references tenant.product_option_group(id),
  modifier_id uuid not null references tenant.product_modifier(id),
  name text not null,
  quantity integer not null check (quantity between 1 and 99),
  price_delta bigint not null,
  unique(line_id,modifier_id)
);

create index pos_cart_line_cart_idx on tenant.pos_cart_line(cart_id);
create index pos_cart_modifier_line_idx on tenant.pos_cart_line_modifier(line_id);

alter table tenant.pos_cart enable row level security;
alter table tenant.pos_cart force row level security;
create policy tenant_branch_isolation on tenant.pos_cart
  using (business_id=umi.current_business()
    and (umi.current_branch() is null or branch_id=umi.current_branch()))
  with check (business_id=umi.current_business()
    and (umi.current_branch() is null or branch_id=umi.current_branch()));
alter table tenant.pos_cart_line enable row level security;
alter table tenant.pos_cart_line force row level security;
create policy tenant_branch_isolation on tenant.pos_cart_line
  using (business_id=umi.current_business() and exists(
    select 1 from tenant.pos_cart c where c.id=cart_id
      and (umi.current_branch() is null or c.branch_id=umi.current_branch())))
  with check (business_id=umi.current_business() and exists(
    select 1 from tenant.pos_cart c where c.id=cart_id
      and (umi.current_branch() is null or c.branch_id=umi.current_branch())));
alter table tenant.pos_cart_line_modifier enable row level security;
alter table tenant.pos_cart_line_modifier force row level security;
create policy tenant_branch_isolation on tenant.pos_cart_line_modifier
  using (business_id=umi.current_business() and exists(
    select 1 from tenant.pos_cart_line l join tenant.pos_cart c on c.id=l.cart_id
    where l.id=line_id and (umi.current_branch() is null or c.branch_id=umi.current_branch())))
  with check (business_id=umi.current_business() and exists(
    select 1 from tenant.pos_cart_line l join tenant.pos_cart c on c.id=l.cart_id
    where l.id=line_id and (umi.current_branch() is null or c.branch_id=umi.current_branch())));

grant select,insert,update,delete on tenant.pos_cart,tenant.pos_cart_line,
  tenant.pos_cart_line_modifier to api,worker;
revoke all on tenant.pos_cart,tenant.pos_cart_line,tenant.pos_cart_line_modifier from public,readonly;

comment on table tenant.pos_cart is
  'Mutable POS preparation state. Never payment, receipt, inventory, KDS, or committed order truth.';
