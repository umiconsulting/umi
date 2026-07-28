-- Gate 2F closeout: branch and device scoped cash policy, conflicts, and mappings.
insert into umi.permission (key, description)
values ('offline.cash.checkout', 'Create a policy-authorized provisional cash sale')
on conflict (key) do update set description=excluded.description;

insert into umi.feature (key, module, name, description, kind)
values ('pos.offline_cash', 'pos', 'POS offline cash',
  'Policy-controlled provisional cash checkout', 'flag')
on conflict (key) do nothing;

create table tenant.pos_offline_cash_policy (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id) on delete restrict,
  enabled boolean not null default false,
  version text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  max_policy_age_seconds integer not null check (max_policy_age_seconds between 60 and 86400),
  max_single_sale_minor_units bigint not null
    check (max_single_sale_minor_units between 1 and 9007199254740991),
  max_accumulated_minor_units bigint not null
    check (max_accumulated_minor_units between 1 and 9007199254740991),
  max_offline_sale_count integer not null check (max_offline_sale_count between 1 and 1000),
  max_active_queue_depth integer not null check (max_active_queue_depth between 1 and 1000),
  max_command_age_seconds integer not null check (max_command_age_seconds between 60 and 604800),
  max_catalog_age_seconds integer not null check (max_catalog_age_seconds between 60 and 604800),
  max_pricing_age_seconds integer not null check (max_pricing_age_seconds between 60 and 604800),
  max_tax_age_seconds integer not null check (max_tax_age_seconds between 60 and 604800),
  manager_approval_threshold_minor_units bigint
    check (manager_approval_threshold_minor_units is null or
      manager_approval_threshold_minor_units between 1 and 9007199254740991),
  allowed_device_classes text[] not null default array['pos_terminal'],
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  unique (business_id, branch_id),
  check (expires_at > issued_at)
);

create table tenant.offline_replay_conflict (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id) on delete restrict,
  device_id uuid not null references tenant.device(id) on delete restrict,
  command_id uuid not null,
  device_sequence bigint not null check (device_sequence > 0),
  classification text not null,
  blocks_following boolean not null,
  operator_action_required boolean not null,
  manager_action_required boolean not null,
  guidance_code text not null,
  correlation_id text not null,
  provisional_id uuid,
  official_id uuid,
  first_observed_at timestamptz not null default clock_timestamp(),
  last_observed_at timestamptz not null default clock_timestamp(),
  resolution_state text not null default 'open'
    check (resolution_state in ('open','acknowledged','resolved')),
  resolution_acknowledged_at timestamptz,
  unique (business_id, device_id, command_id)
);

create table tenant.offline_provisional_mapping (
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id) on delete restrict,
  device_id uuid not null references tenant.device(id) on delete restrict,
  command_id uuid not null references tenant.offline_replay_command(command_id) on delete restrict,
  provisional_id uuid not null,
  official_sale_id uuid not null references tenant.pos_committed_sale(id) on delete restrict,
  official_receipt_id uuid not null references tenant.receipt_snapshot(id) on delete restrict,
  official_receipt_number text not null,
  reconciliation_reference uuid not null,
  mapped_at timestamptz not null default clock_timestamp(),
  primary key (business_id, provisional_id),
  unique (business_id, official_sale_id),
  unique (business_id, official_receipt_id),
  unique (command_id)
);

alter table tenant.offline_replay_command
  drop constraint offline_replay_command_command_type_check;
alter table tenant.offline_replay_command
  add constraint offline_replay_command_command_type_check
  check (command_type in ('operational.ack','pos.checkout.cash'));
alter table tenant.offline_replay_command add column payload jsonb;
update tenant.offline_replay_command set payload='{}'::jsonb where payload is null;
alter table tenant.offline_replay_command alter column payload set not null;

alter table tenant.pos_offline_policy force row level security;
alter table tenant.device_replay_cursor force row level security;
alter table tenant.offline_replay_command force row level security;
alter table tenant.offline_reconciliation force row level security;
alter table tenant.pos_offline_cash_policy enable row level security;
alter table tenant.pos_offline_cash_policy force row level security;
alter table tenant.offline_replay_conflict enable row level security;
alter table tenant.offline_replay_conflict force row level security;
alter table tenant.offline_provisional_mapping enable row level security;
alter table tenant.offline_provisional_mapping force row level security;

create policy tenant_branch_isolation on tenant.pos_offline_cash_policy
  using (business_id=umi.current_business() and
    umi.current_branch() is not null and branch_id=umi.current_branch())
  with check (business_id=umi.current_business() and
    umi.current_branch() is not null and branch_id=umi.current_branch());
create policy tenant_branch_isolation on tenant.offline_replay_conflict
  using (business_id=umi.current_business() and
    umi.current_branch() is not null and branch_id=umi.current_branch() and
    umi.current_device() is not null and device_id=umi.current_device())
  with check (business_id=umi.current_business() and
    umi.current_branch() is not null and branch_id=umi.current_branch() and
    umi.current_device() is not null and device_id=umi.current_device());
create policy tenant_branch_isolation on tenant.offline_provisional_mapping
  using (business_id=umi.current_business() and
    umi.current_branch() is not null and branch_id=umi.current_branch() and
    umi.current_device() is not null and device_id=umi.current_device())
  with check (business_id=umi.current_business() and
    umi.current_branch() is not null and branch_id=umi.current_branch() and
    umi.current_device() is not null and device_id=umi.current_device());

create trigger offline_mapping_append_only
before update or delete on tenant.offline_provisional_mapping
for each row execute function tenant.tg_append_only();

grant select on tenant.pos_offline_cash_policy to api,worker;
grant select,insert on tenant.offline_replay_conflict to api,worker;
grant update (last_observed_at,resolution_state,resolution_acknowledged_at)
  on tenant.offline_replay_conflict to api,worker;
grant select,insert on tenant.offline_provisional_mapping to api,worker;
revoke all on tenant.pos_offline_cash_policy,tenant.offline_replay_conflict,
  tenant.offline_provisional_mapping from public,readonly;
