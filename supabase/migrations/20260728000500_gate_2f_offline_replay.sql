-- Gate 2F: authoritative ordered replay. Offline cash remains disabled.
create table tenant.pos_offline_policy (
  business_id uuid primary key references tenant.business(id),
  version text not null default '1',
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '24 hours'),
  allowed_command_types text[] not null default array['operational.ack'],
  cash_sale_enabled boolean not null default false check (cash_sale_enabled = false),
  max_queue_depth integer not null default 250 check (max_queue_depth between 1 and 1000),
  max_batch_size integer not null default 20 check (max_batch_size between 1 and 50),
  max_command_age_seconds integer not null default 86400 check (max_command_age_seconds between 60 and 604800),
  updated_at timestamptz not null default clock_timestamp()
);

create table tenant.device_replay_cursor (
  business_id uuid not null references tenant.business(id),
  branch_id uuid not null references tenant.branch(id),
  device_id uuid not null references tenant.device(id),
  credential_version integer not null check (credential_version > 0),
  last_accepted_sequence bigint not null default 0 check (last_accepted_sequence >= 0),
  reconciliation_required boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (device_id, credential_version)
);

create table tenant.offline_replay_command (
  business_id uuid not null references tenant.business(id),
  branch_id uuid not null references tenant.branch(id),
  device_id uuid not null references tenant.device(id),
  credential_version integer not null,
  device_sequence bigint not null check (device_sequence > 0),
  command_id uuid primary key,
  operator_session_id uuid not null references tenant.operator_session(id),
  idempotency_key uuid not null,
  command_type text not null check (command_type = 'operational.ack'),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  contract_version text not null,
  schema_version integer not null check (schema_version > 0),
  client_created_at timestamptz not null,
  accepted_at timestamptz not null default clock_timestamp(),
  result jsonb not null,
  provisional_id uuid,
  official_id uuid,
  unique (device_id, credential_version, device_sequence),
  unique (business_id, idempotency_key)
);

create table tenant.offline_reconciliation (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id),
  branch_id uuid not null references tenant.branch(id),
  device_id uuid not null references tenant.device(id),
  credential_version integer not null,
  summary jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  acknowledged_at timestamptz
);

create or replace function tenant.prevent_offline_command_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'offline replay commands are immutable';
end $$;
create trigger offline_replay_command_immutable
before update or delete on tenant.offline_replay_command
for each row execute function tenant.prevent_offline_command_mutation();

alter table tenant.pos_offline_policy enable row level security;
alter table tenant.device_replay_cursor enable row level security;
alter table tenant.offline_replay_command enable row level security;
alter table tenant.offline_reconciliation enable row level security;

create policy offline_policy_scope on tenant.pos_offline_policy
  using (business_id = runtime.current_business_id());
create policy replay_cursor_scope on tenant.device_replay_cursor
  using (business_id = runtime.current_business_id())
  with check (business_id = runtime.current_business_id());
create policy replay_command_scope on tenant.offline_replay_command
  using (business_id = runtime.current_business_id())
  with check (business_id = runtime.current_business_id());
create policy reconciliation_scope on tenant.offline_reconciliation
  using (business_id = runtime.current_business_id())
  with check (business_id = runtime.current_business_id());

grant select on tenant.pos_offline_policy to api;
grant select, insert, update on tenant.device_replay_cursor to api;
grant select, insert on tenant.offline_replay_command to api;
grant select, insert, update (acknowledged_at) on tenant.offline_reconciliation to api;

insert into umi.permission (key, description)
values ('offline.replay', 'Replay and reconcile device-authenticated offline commands')
on conflict (key) do nothing;
