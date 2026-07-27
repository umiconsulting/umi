-- Gate 1C: durable identity, authorization overrides, and security audit.
-- The API owns all writes to these sealed platform and runtime tables.

alter table runtime.session
  add column refresh_family_id uuid not null default gen_random_uuid(),
  add column replaced_by_id uuid references runtime.session(id),
  add column revoked_reason text;

create unique index session_token_hash_uq on runtime.session (token_hash);
create index session_device_idx on runtime.session (device_id) where revoked_at is null;
create index session_family_idx on runtime.session (refresh_family_id);

create table runtime.elevation_grant (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references runtime.session(id) on delete cascade,
  business_id      uuid not null references tenant.business(id) on delete cascade,
  branch_id        uuid references tenant.branch(id) on delete cascade,
  permission_key   text not null,
  method           text not null check (method in ('manager_approval', 'operator_pin')),
  approved_by      uuid references umi.user(id),
  expires_at       timestamptz not null,
  consumed_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index elevation_grant_active_idx
  on runtime.elevation_grant (session_id, business_id, permission_key, expires_at)
  where consumed_at is null;

create table runtime.security_audit_event (
  id              uuid primary key default gen_random_uuid(),
  actor_user_id   uuid references umi.user(id) on delete set null,
  session_id      uuid references runtime.session(id) on delete set null,
  business_id     uuid,
  branch_id       uuid,
  event_type      text not null,
  entity_type     text not null,
  entity_id       uuid,
  outcome         text not null check (outcome in ('success', 'denied', 'failure')),
  reason_code     text,
  request_id      text,
  metadata        jsonb not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now()
);
create index security_audit_actor_time_idx
  on runtime.security_audit_event (actor_user_id, occurred_at desc);
create index security_audit_business_time_idx
  on runtime.security_audit_event (business_id, occurred_at desc);

comment on table runtime.security_audit_event is
  'Append-only internal security decisions. Public clients cannot read this table.';

create table umi.user_permission_override (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references umi.user(id) on delete cascade,
  permission_id  uuid not null references umi.permission(id) on delete cascade,
  business_id    uuid references tenant.business(id) on delete cascade,
  branch_id      uuid references tenant.branch(id) on delete cascade,
  effect         text not null check (effect in ('allow', 'deny')),
  expires_at     timestamptz,
  granted_by     uuid references umi.user(id),
  created_at     timestamptz not null default now()
);
create unique index user_permission_override_scope_uq
  on umi.user_permission_override
  (user_id, permission_id, coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

comment on table umi.user_permission_override is
  'Temporary or explicit permission result. A deny always overrides role grants and allows.';

alter table umi.user_permission_override
  add constraint permission_override_branch_scope_ck
  check (branch_id is null or business_id is not null);

revoke all on runtime.session, runtime.elevation_grant, runtime.security_audit_event,
  umi.user_permission_override
  from public, api, readonly;
grant select, insert, update on runtime.session to worker;
grant select, insert, update on runtime.elevation_grant to worker;
grant select, insert on runtime.security_audit_event to worker;
grant select, insert, update, delete on umi.user_permission_override to worker;

revoke update, delete on runtime.security_audit_event from worker;
