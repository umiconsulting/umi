-- Gate 1D: canonical command, audit, concurrency, and financial event controls.

create extension if not exists pgcrypto schema extensions;

create table tenant.business_command (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references tenant.business(id) on delete restrict,
  branch_id          uuid references tenant.branch(id),
  command_id         uuid not null,
  idempotency_key    text not null,
  command_type       text not null,
  fingerprint        text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  status             text not null check (status in ('processing', 'succeeded', 'failed')),
  expected_version   bigint check (expected_version is null or expected_version >= 0),
  response_data      jsonb,
  failure_code       text,
  retryable          boolean not null default false,
  correlation_id     text not null,
  started_at         timestamptz not null default now(),
  completed_at       timestamptz,
  expires_at         timestamptz,
  unique (business_id, command_id),
  unique (business_id, idempotency_key),
  check (
    (status = 'processing' and completed_at is null)
    or (status <> 'processing' and completed_at is not null)
  )
);
create index business_command_lookup_idx
  on tenant.business_command (business_id, command_type, started_at desc);
create index business_command_expiry_idx
  on tenant.business_command (expires_at)
  where expires_at is not null;

create table tenant.aggregate_version (
  business_id     uuid not null references tenant.business(id) on delete restrict,
  aggregate_type  text not null,
  aggregate_id    uuid not null,
  version         bigint not null default 0 check (version >= 0),
  updated_at      timestamptz not null default now(),
  primary key (business_id, aggregate_type, aggregate_id)
);

create table tenant.audit_event (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references tenant.business(id) on delete restrict,
  branch_id         uuid references tenant.branch(id),
  actor_user_id     uuid references umi.user(id) on delete set null,
  command_id        uuid,
  event_type        text not null,
  entity_type       text not null,
  entity_id         uuid,
  outcome           text not null check (outcome in ('success', 'denied', 'failure')),
  reason_code       text,
  public_data       jsonb not null default '{}'::jsonb,
  correlation_id    text not null,
  previous_hash     text,
  event_hash        text not null,
  occurred_at       timestamptz not null default now()
);
create index audit_event_search_idx
  on tenant.audit_event (business_id, occurred_at desc, event_type);
create index audit_event_entity_idx
  on tenant.audit_event (business_id, entity_type, entity_id, occurred_at desc);
create index audit_event_correlation_idx
  on tenant.audit_event (business_id, correlation_id);

create table runtime.audit_event_internal (
  audit_event_id  uuid primary key references tenant.audit_event(id) on delete restrict,
  business_id     uuid not null references tenant.business(id) on delete restrict,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create table tenant.financial_event (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references tenant.business(id) on delete restrict,
  branch_id             uuid references tenant.branch(id),
  command_id            uuid not null,
  aggregate_type        text not null,
  aggregate_id          uuid not null,
  aggregate_version     bigint not null check (aggregate_version > 0),
  event_type            text not null,
  amount_minor_units    bigint not null,
  currency              text not null check (currency ~ '^[A-Z]{3}$'),
  compensates_event_id  uuid references tenant.financial_event(id),
  public_data           jsonb not null default '{}'::jsonb,
  correlation_id        text not null,
  occurred_at           timestamptz not null default now(),
  unique (business_id, aggregate_type, aggregate_id, aggregate_version),
  check (compensates_event_id is null or compensates_event_id <> id)
);
create index financial_event_command_idx
  on tenant.financial_event (business_id, command_id);
create index financial_event_time_idx
  on tenant.financial_event (business_id, occurred_at desc);

create table umi.audit_retention_policy (
  id                 uuid primary key default gen_random_uuid(),
  event_class        text not null unique,
  minimum_days       integer not null check (minimum_days >= 365),
  archive_required   boolean not null default true,
  created_at         timestamptz not null default now()
);
insert into umi.audit_retention_policy (event_class, minimum_days)
values ('security', 2555), ('financial', 3650), ('business', 2555);

insert into umi.permission (key, description)
values ('audit.read', 'Read tenant-visible, redacted audit events')
on conflict (key) do update set description = excluded.description;

create or replace function tenant.tg_integrity_scope() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, tenant as $$
begin
  if new.branch_id is not null and not exists (
    select 1 from tenant.branch
    where id = new.branch_id and business_id = new.business_id
  ) then
    raise exception 'branch_tenant_mismatch' using errcode = '23514';
  end if;
  if tg_table_name = 'financial_event' then
    if new.compensates_event_id is not null and not exists (
      select 1 from tenant.financial_event
      where id = new.compensates_event_id and business_id = new.business_id
    ) then
      raise exception 'compensation_tenant_mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger business_command_scope
  before insert on tenant.business_command
  for each row execute function tenant.tg_integrity_scope();
create trigger audit_event_scope
  before insert on tenant.audit_event
  for each row execute function tenant.tg_integrity_scope();
create trigger financial_event_scope
  before insert on tenant.financial_event
  for each row execute function tenant.tg_integrity_scope();

create or replace function tenant.tg_audit_event_hash() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, extensions as $$
declare
  prior text;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.business_id::text, 0));
  select event_hash into prior
  from tenant.audit_event
  where business_id = new.business_id
  order by occurred_at desc, id desc
  limit 1;
  new.previous_hash := prior;
  new.occurred_at := clock_timestamp();
  new.event_hash := encode(extensions.digest(
    concat_ws('|', new.id, new.business_id, coalesce(new.branch_id::text, ''),
      coalesce(new.actor_user_id::text, ''), coalesce(new.command_id::text, ''),
      new.event_type, new.entity_type, coalesce(new.entity_id::text, ''),
      new.outcome, coalesce(new.reason_code, ''), new.public_data::text,
      new.correlation_id, coalesce(prior, ''), new.occurred_at::text),
    'sha256'), 'hex');
  return new;
end $$;

create trigger audit_event_hash
  before insert on tenant.audit_event
  for each row execute function tenant.tg_audit_event_hash();

create trigger audit_event_append_only
  before update or delete on tenant.audit_event
  for each row execute function tenant.tg_append_only();
create trigger audit_internal_append_only
  before update or delete on runtime.audit_event_internal
  for each row execute function tenant.tg_append_only();
create trigger financial_event_append_only
  before update or delete on tenant.financial_event
  for each row execute function tenant.tg_append_only();

alter table tenant.business_command enable row level security;
alter table tenant.business_command force row level security;
create policy tenant_isolation on tenant.business_command
  using (
    business_id = umi.current_business()
    and (umi.current_branch() is null or branch_id is null or branch_id = umi.current_branch())
  )
  with check (
    business_id = umi.current_business()
    and (umi.current_branch() is null or branch_id is null or branch_id = umi.current_branch())
  );

alter table tenant.aggregate_version enable row level security;
alter table tenant.aggregate_version force row level security;
create policy tenant_isolation on tenant.aggregate_version
  using (business_id = umi.current_business())
  with check (business_id = umi.current_business());

alter table tenant.audit_event enable row level security;
alter table tenant.audit_event force row level security;
create policy tenant_isolation on tenant.audit_event
  using (
    business_id = umi.current_business()
    and (umi.current_branch() is null or branch_id is null or branch_id = umi.current_branch())
  )
  with check (
    business_id = umi.current_business()
    and (umi.current_branch() is null or branch_id is null or branch_id = umi.current_branch())
  );

alter table tenant.financial_event enable row level security;
alter table tenant.financial_event force row level security;
create policy tenant_isolation on tenant.financial_event
  using (
    business_id = umi.current_business()
    and (umi.current_branch() is null or branch_id is null or branch_id = umi.current_branch())
  )
  with check (
    business_id = umi.current_business()
    and (umi.current_branch() is null or branch_id is null or branch_id = umi.current_branch())
  );

revoke insert, update, delete on tenant.audit_log from api, worker, readonly;
revoke update, delete on tenant.audit_event, tenant.financial_event
  from api, worker, readonly;
revoke all on runtime.audit_event_internal, umi.audit_retention_policy
  from public, api, readonly;

grant select, insert, update on tenant.business_command to api;
grant select, insert, update on tenant.aggregate_version to api;
grant select, insert on tenant.audit_event, tenant.financial_event to api;
grant insert on runtime.audit_event_internal to api;
grant select, insert on runtime.audit_event_internal to worker;
grant select on umi.audit_retention_policy to worker;

revoke select, update, delete on runtime.audit_event_internal from api;
revoke update, delete on runtime.audit_event_internal from worker;

comment on table tenant.business_command is
  'Canonical idempotency record. A matching fingerprint returns the stored result; a different fingerprint conflicts.';
comment on table tenant.financial_event is
  'Neutral immutable financial history. Product ledgers remain authoritative for their domains.';
comment on table tenant.audit_event is
  'Tenant audit chain with redacted public data and server timestamps.';
comment on table runtime.idempotency_key is
  'Legacy dedup key. Do not use for new business commands; use tenant.business_command.';
