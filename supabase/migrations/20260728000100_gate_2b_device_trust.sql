-- Gate 2B: canonical POS device trust and operator-entry state.
-- API/worker are the only writers. Enrollment secrets and PINs are stored only as hashes.

create unique index if not exists branch_business_id_id_uq
  on tenant.branch (business_id, id);

alter table tenant.device
  add column public_id uuid not null default gen_random_uuid(),
  add column installation_hash text,
  add column credential_hash text,
  add column credential_version integer not null default 1 check (credential_version > 0),
  add column platform text check (platform in ('android','ios','linux','macos','windows','web')),
  add column lifecycle_state text not null default 'active'
    check (lifecycle_state in
      ('enrollment_pending','active','rotation_required','rotated','revoked','replaced')),
  add column last_seen_at timestamptz,
  add column revoked_at timestamptz,
  add column revocation_reason text,
  add column replacement_device_id uuid references tenant.device(id),
  add column updated_at timestamptz not null default now();

alter table tenant.device
  add constraint device_public_id_uq unique (public_id),
  add constraint device_credential_hash_ck
    check (credential_hash is null or credential_hash ~ '^[a-f0-9]{64}$'),
  add constraint device_installation_hash_ck
    check (installation_hash is null or installation_hash ~ '^[a-f0-9]{64}$'),
  add constraint device_branch_same_business_fk
    foreign key (business_id, branch_id) references tenant.branch(business_id, id);

create unique index device_active_installation_uq
  on tenant.device (installation_hash)
  where installation_hash is not null
    and lifecycle_state in ('active','rotation_required');

create table runtime.device_enrollment_challenge (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references tenant.business(id) on delete cascade,
  branch_id         uuid references tenant.branch(id) on delete cascade,
  display_name      text not null,
  device_kind       text not null check (device_kind in ('kds','pos_terminal')),
  platform          text not null
    check (platform in ('android','ios','linux','macos','windows','web')),
  code_hash         text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key   uuid not null,
  expires_at        timestamptz not null,
  attempts          integer not null default 0 check (attempts between 0 and 5),
  consumed_at       timestamptz,
  created_by        uuid not null references umi.user(id),
  replaces_device_id uuid references tenant.device(id),
  created_at        timestamptz not null default now(),
  unique (business_id, idempotency_key)
);

create index device_enrollment_active_idx
  on runtime.device_enrollment_challenge (id, expires_at)
  where consumed_at is null;

create table runtime.operator_session (
  id                uuid primary key default gen_random_uuid(),
  durable_session_id uuid not null references runtime.session(id) on delete cascade,
  user_id           uuid not null references umi.user(id),
  staff_id          uuid not null references tenant.staff(id),
  device_id         uuid not null references tenant.device(id),
  business_id       uuid not null references tenant.business(id),
  branch_id         uuid not null references tenant.branch(id),
  state             text not null default 'active' check (state in ('active','locked','ended')),
  permissions       text[] not null default '{}',
  entitlements      jsonb not null default '[]'::jsonb,
  started_at        timestamptz not null default now(),
  last_activity_at  timestamptz not null default now(),
  expires_at        timestamptz not null,
  ended_at          timestamptz
);

create unique index operator_session_one_active_per_durable
  on runtime.operator_session (durable_session_id)
  where state in ('active','locked');

alter table tenant.staff
  add column operator_pin_salt text,
  add column operator_pin_hash text,
  add column pin_failed_attempts integer not null default 0,
  add column pin_locked_until timestamptz,
  add constraint staff_operator_pin_hash_ck
    check (operator_pin_hash is null or operator_pin_hash ~ '^[a-f0-9]{128}$'),
  add constraint staff_operator_pin_salt_ck
    check (operator_pin_salt is null or operator_pin_salt ~ '^[a-f0-9]{32}$'),
  add constraint staff_operator_pin_pair_ck
    check ((operator_pin_salt is null) = (operator_pin_hash is null)),
  add constraint staff_pin_failed_attempts_ck check (pin_failed_attempts between 0 and 10);

create or replace function runtime.revoke_device_sessions() returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog as $$
begin
  if new.lifecycle_state in ('revoked','replaced','rotated')
     and old.lifecycle_state is distinct from new.lifecycle_state then
    update runtime.session
       set revoked_at = coalesce(revoked_at, now()),
           revoked_reason = 'device_' || new.lifecycle_state
     where device_id = new.id and revoked_at is null;
    update runtime.operator_session
       set state = 'ended', ended_at = now()
     where device_id = new.id and state <> 'ended';
  end if;
  return new;
end $$;

create trigger device_session_revocation
  after update of lifecycle_state on tenant.device
  for each row execute function runtime.revoke_device_sessions();

revoke all on runtime.device_enrollment_challenge, runtime.operator_session from public, api, readonly;
grant select, insert, update on runtime.device_enrollment_challenge, runtime.operator_session to worker;
revoke all on function runtime.revoke_device_sessions() from public;

comment on table runtime.device_enrollment_challenge is
  'One-time, expiring device enrollment challenges. Only hashes are persisted.';
comment on table runtime.operator_session is
  'Server-authoritative operator presence, separate from durable user authentication.';
