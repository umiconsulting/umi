-- Gate 2E: authoritative online checkout. Reservations do not mutate permanent inventory.
insert into umi.permission (key, description)
values ('checkout.commit', 'Commit a branch-scoped online POS sale')
on conflict (key) do update set description=excluded.description;
insert into umi.role_permission (role_id, permission_id)
select r.id,p.id from umi.role r cross join umi.permission p
where not r.is_platform and p.key='checkout.commit'
on conflict do nothing;

alter table tenant.pos_cart drop constraint pos_cart_status_check;
alter table tenant.pos_cart add constraint pos_cart_status_check
  check (status in ('draft','prepared','committed','abandoned'));

create table tenant.inventory_reservation (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id),
  cart_id uuid not null references tenant.pos_cart(id) on delete restrict,
  status text not null check (status in ('reserved','released','expired','commit_prepared')),
  cart_version integer not null check (cart_version > 0),
  line_snapshot jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(cart_id)
);

create table tenant.pos_payment_attempt (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id),
  cart_id uuid not null references tenant.pos_cart(id) on delete restrict,
  method text not null check (method in ('cash','external_terminal')),
  amount_minor_units bigint not null check (amount_minor_units >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in ('pending','succeeded','declined','cancelled','unknown','timeout')),
  query_only boolean not null default false,
  provider_reference text,
  correlation_id text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique(business_id,cart_id)
);

create table tenant.receipt_snapshot (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id),
  order_id uuid not null references tenant.customer_order(id) on delete restrict,
  payment_attempt_id uuid not null references tenant.pos_payment_attempt(id) on delete restrict,
  receipt_number text not null,
  business_date date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  grand_total bigint not null check (grand_total >= 0),
  snapshot jsonb not null,
  issued_at timestamptz not null default now(),
  unique(business_id,receipt_number),
  unique(order_id)
);

create table tenant.pos_committed_sale (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id),
  cart_id uuid not null references tenant.pos_cart(id) on delete restrict,
  order_id uuid not null references tenant.customer_order(id) on delete restrict,
  payment_attempt_id uuid not null references tenant.pos_payment_attempt(id) on delete restrict,
  receipt_snapshot_id uuid not null references tenant.receipt_snapshot(id) on delete restrict,
  totals_fingerprint text not null check (totals_fingerprint ~ '^[a-f0-9]{64}$'),
  committed_at timestamptz not null default now(),
  unique(cart_id), unique(order_id), unique(payment_attempt_id), unique(receipt_snapshot_id)
);

create trigger receipt_snapshot_append_only before update or delete on tenant.receipt_snapshot
  for each row execute function tenant.tg_append_only();
create trigger committed_sale_append_only before update or delete on tenant.pos_committed_sale
  for each row execute function tenant.tg_append_only();

alter table tenant.inventory_reservation enable row level security;
alter table tenant.inventory_reservation force row level security;
alter table tenant.pos_payment_attempt enable row level security;
alter table tenant.pos_payment_attempt force row level security;
alter table tenant.receipt_snapshot enable row level security;
alter table tenant.receipt_snapshot force row level security;
alter table tenant.pos_committed_sale enable row level security;
alter table tenant.pos_committed_sale force row level security;

create policy tenant_branch_isolation on tenant.inventory_reservation
  using (business_id=umi.current_business() and
    (umi.current_branch() is null or branch_id=umi.current_branch()))
  with check (business_id=umi.current_business() and
    (umi.current_branch() is null or branch_id=umi.current_branch()));
create policy tenant_branch_isolation on tenant.pos_payment_attempt
  using (business_id=umi.current_business() and
    (umi.current_branch() is null or branch_id=umi.current_branch()))
  with check (business_id=umi.current_business() and
    (umi.current_branch() is null or branch_id=umi.current_branch()));
create policy tenant_branch_isolation on tenant.receipt_snapshot
  using (business_id=umi.current_business() and
    (umi.current_branch() is null or branch_id=umi.current_branch()))
  with check (business_id=umi.current_business() and
    (umi.current_branch() is null or branch_id=umi.current_branch()));
create policy tenant_branch_isolation on tenant.pos_committed_sale
  using (business_id=umi.current_business() and
    (umi.current_branch() is null or branch_id=umi.current_branch()))
  with check (business_id=umi.current_business() and
    (umi.current_branch() is null or branch_id=umi.current_branch()));

grant select,insert,update on tenant.inventory_reservation,tenant.pos_payment_attempt to api,worker;
grant select,insert on tenant.receipt_snapshot,tenant.pos_committed_sale to api,worker;
revoke all on tenant.inventory_reservation,tenant.pos_payment_attempt,
  tenant.receipt_snapshot,tenant.pos_committed_sale from public,readonly;

comment on table tenant.inventory_reservation is
  'Checkout reservation semantics only. This table never decrements or synchronizes inventory.';
comment on table tenant.receipt_snapshot is
  'Immutable receipt fact. Reports read this snapshot and never reconstruct historical totals.';
