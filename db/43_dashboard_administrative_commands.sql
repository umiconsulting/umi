-- Gate 5A closeout: a browser session and command record for administrative work.
-- These rows never represent an enrolled POS or a physical device.

create table runtime.dashboard_session (
  id uuid primary key,
  user_id uuid not null references umi.user(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  is_active boolean not null default true,
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or length(revoked_reason) between 1 and 80),
  constraint dashboard_session_expiry_ck check (expires_at > issued_at),
  constraint dashboard_session_revocation_ck check (is_active = (revoked_at is null))
);
create index dashboard_session_user_live_idx
  on runtime.dashboard_session(user_id,expires_at) where is_active;

create table merchant.administrative_command (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid references merchant.location(id) on delete restrict,
  command_id uuid not null,
  idempotency_key uuid not null,
  operation text not null check (operation ~ '^[a-z][a-z0-9_.]{2,79}$'),
  actor_user_id uuid not null references umi.user(id) on delete restrict,
  membership_id uuid not null references merchant.staff(id) on delete restrict,
  dashboard_session_id uuid not null references runtime.dashboard_session(id) on delete restrict,
  target_aggregate_id uuid,
  target_version bigint,
  permission text not null check (permission ~ '^[a-z][a-z0-9_.]{2,79}$'),
  approval_id uuid references runtime.elevation_grant(id) on delete restrict,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('pending','succeeded','failed','unknown')),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result)='object'),
  failure_code text,
  correlation_id text not null check (length(correlation_id) between 1 and 128),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (merchant_id,command_id),
  unique (merchant_id,idempotency_key),
  foreign key (merchant_id,location_id)
    references merchant.location(merchant_id,id) on delete restrict
);
create index administrative_command_recovery_idx
  on merchant.administrative_command(merchant_id,location_id,status,created_at desc);

alter table merchant.administrative_command enable row level security;
alter table merchant.administrative_command force row level security;
create policy administrative_command_tenant_isolation on merchant.administrative_command
  using (merchant_id=umi.current_merchant())
  with check (
    merchant_id=umi.current_merchant()
    and actor_user_id=nullif(current_setting('app.user_id',true),'')::uuid
    and (location_id is null or umi.current_location() is null or location_id=umi.current_location())
  );

revoke all on runtime.dashboard_session from api,readonly;
grant select,insert,update on runtime.dashboard_session to worker;
grant select,insert,update on merchant.administrative_command to api;
revoke all on merchant.administrative_command from readonly;
