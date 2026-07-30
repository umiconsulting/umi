-- Gate 3B: branch policy, recoverable checkout drafts, and immutable tender facts.

insert into umi.permission (key, description)
values
  ('checkout.discount.apply', 'Apply a checkout discount within branch policy'),
  ('checkout.discount.approve', 'Approve a sensitive checkout discount'),
  ('checkout.terminal.confirm', 'Confirm a manual terminal outcome'),
  ('checkout.terminal.approve', 'Approve a sensitive manual terminal outcome'),
  ('checkout.recover.any', 'Recover another operator checkout')
on conflict (key) do update set description=excluded.description;

insert into umi.role_permission (role_id, permission_id)
select r.id,p.id
from umi.role r
cross join umi.permission p
where not r.is_platform
  and r.key in ('owner','admin','manager','supervisor','cashier','staff')
  and p.key in ('checkout.discount.apply','checkout.terminal.confirm')
on conflict do nothing;

insert into umi.role_permission (role_id, permission_id)
select r.id,p.id
from umi.role r
cross join umi.permission p
where not r.is_platform
  and r.key in ('owner','admin','manager','supervisor')
  and p.key in (
    'checkout.discount.approve',
    'checkout.terminal.approve',
    'checkout.recover.any'
  )
on conflict do nothing;

alter table runtime.elevation_grant
  add column command_fingerprint text,
  add column consumed_by_command_id uuid;
alter table runtime.elevation_grant
  add constraint elevation_grant_command_fingerprint_ck
  check (command_fingerprint is null or command_fingerprint ~ '^[a-f0-9]{64}$');
create index elevation_grant_command_use_idx
  on runtime.elevation_grant(consumed_by_command_id)
  where consumed_by_command_id is not null;

create table tenant.pos_checkout_policy (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id) on delete restrict,
  version text not null,
  manual_terminal_enabled boolean not null default false,
  mixed_tender_enabled boolean not null default false,
  maximum_tender_lines integer not null default 1 check (maximum_tender_lines between 1 and 8),
  manual_terminal_approval_threshold bigint not null default 0
    check (manual_terminal_approval_threshold between 0 and 9007199254740991),
  tips_enabled boolean not null default false,
  tip_preset_basis_points integer[] not null default '{}',
  custom_tip_percentage_enabled boolean not null default false,
  custom_tip_fixed_enabled boolean not null default false,
  maximum_tip_minor_units bigint not null default 0
    check (maximum_tip_minor_units between 0 and 9007199254740991),
  tip_required_permission text,
  discounts_enabled boolean not null default false,
  maximum_discount_basis_points integer not null default 0
    check (maximum_discount_basis_points between 0 and 10000),
  maximum_discount_minor_units bigint not null default 0
    check (maximum_discount_minor_units between 0 and 9007199254740991),
  cashier_discount_threshold bigint not null default 0
    check (cashier_discount_threshold between 0 and 9007199254740991),
  custom_discount_requires_approval boolean not null default true,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  updated_at timestamptz not null default now(),
  unique(business_id,branch_id)
);

create table tenant.pos_checkout_draft (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id) on delete restrict,
  cart_id uuid not null references tenant.pos_cart(id) on delete restrict,
  operator_session_id uuid not null references runtime.operator_session(id) on delete restrict,
  device_id uuid not null references tenant.device(id) on delete restrict,
  state text not null check (state in (
    'ready','selecting_tender','collecting_payment','awaiting_authorization',
    'payment_accepted','payment_rejected','payment_unknown','receipt_available',
    'completed','recovered'
  )),
  version integer not null default 1 check (version > 0),
  command_fingerprint text check (
    command_fingerprint is null or command_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  tender_drafts jsonb not null default '[]'::jsonb,
  tip_draft jsonb,
  discount_drafts jsonb not null default '[]'::jsonb,
  receipt_delivery jsonb not null,
  payment_summary jsonb,
  checkout_result jsonb,
  recovery_state text not null default 'none',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,cart_id)
);

create table tenant.pos_tender_fact (
  id uuid primary key,
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id) on delete restrict,
  checkout_id uuid not null references tenant.pos_checkout_draft(id) on delete restrict,
  cart_id uuid not null references tenant.pos_cart(id) on delete restrict,
  position integer not null check (position between 0 and 7),
  tender_type text not null check (tender_type in ('cash','manual_terminal')),
  status text not null check (status in (
    'draft','operator_processing_externally','awaiting_operator_confirmation',
    'confirmed_success','operator_reported_failure','outcome_unknown',
    'cancelled_before_confirmation','committed'
  )),
  amount_minor_units bigint not null
    check (amount_minor_units between 1 and 9007199254740991),
  received_minor_units bigint
    check (received_minor_units is null or received_minor_units between 1 and 9007199254740991),
  change_minor_units bigint not null default 0
    check (change_minor_units between 0 and 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  correlation_id text,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(checkout_id,position),
  unique(business_id,cart_id,id)
);

alter table tenant.pos_payment_attempt
  add column tender_id uuid;
alter table tenant.pos_payment_attempt
  add constraint pos_payment_attempt_tender_fk
  foreign key (tender_id) references tenant.pos_tender_fact(id) deferrable initially deferred;
alter table tenant.pos_payment_attempt drop constraint pos_payment_attempt_business_id_cart_id_key;
alter table tenant.pos_payment_attempt
  add constraint pos_payment_attempt_cart_tender_uq unique(business_id,cart_id,tender_id);

alter table tenant.receipt_snapshot
  add column receipt_destination text not null default 'display'
    check (receipt_destination in ('display','print_later','digital','none')),
  add column delivery_intent jsonb;

create function tenant.tg_pos_checkout_terminal_immutable()
returns trigger language plpgsql as $$
begin
  if old.state in ('completed','receipt_available') then
    raise exception 'committed checkout is immutable';
  end if;
  return new;
end $$;

create trigger pos_checkout_terminal_immutable
  before update or delete on tenant.pos_checkout_draft
  for each row execute function tenant.tg_pos_checkout_terminal_immutable();

create function tenant.tg_pos_tender_committed_immutable()
returns trigger language plpgsql as $$
begin
  if old.status='committed' then
    raise exception 'committed tender is immutable';
  end if;
  return new;
end $$;

create trigger pos_tender_committed_immutable
  before update or delete on tenant.pos_tender_fact
  for each row execute function tenant.tg_pos_tender_committed_immutable();

alter table tenant.pos_checkout_policy enable row level security;
alter table tenant.pos_checkout_policy force row level security;
alter table tenant.pos_checkout_draft enable row level security;
alter table tenant.pos_checkout_draft force row level security;
alter table tenant.pos_tender_fact enable row level security;
alter table tenant.pos_tender_fact force row level security;

create policy tenant_branch_isolation on tenant.pos_checkout_policy
  using (business_id=umi.current_business() and branch_id=umi.current_branch())
  with check (business_id=umi.current_business() and branch_id=umi.current_branch());
create policy tenant_branch_isolation on tenant.pos_checkout_draft
  using (business_id=umi.current_business() and branch_id=umi.current_branch())
  with check (business_id=umi.current_business() and branch_id=umi.current_branch());
create policy tenant_branch_isolation on tenant.pos_tender_fact
  using (business_id=umi.current_business() and branch_id=umi.current_branch())
  with check (business_id=umi.current_business() and branch_id=umi.current_branch());

grant select on tenant.pos_checkout_policy to api,worker;
grant select on tenant.pos_checkout_draft,tenant.pos_tender_fact to api,worker;
grant insert,update on tenant.pos_checkout_draft,tenant.pos_tender_fact to worker;
grant delete on tenant.pos_tender_fact to worker;
revoke all on tenant.pos_checkout_policy,tenant.pos_checkout_draft,tenant.pos_tender_fact
  from public,readonly;

comment on table tenant.pos_checkout_policy is
  'Server-issued branch policy for Gate 3B checkout behavior. Missing policy means default deny.';
comment on table tenant.pos_checkout_draft is
  'Recoverable draft state. A terminal checkout is immutable.';
comment on table tenant.pos_tender_fact is
  'Draft tender allocations become append-only financial facts at checkout commit.';
