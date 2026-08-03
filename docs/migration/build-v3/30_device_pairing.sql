-- UmiPOS device pairing with administrator approval.
-- Store only hashes for setup codes, polling credentials, installation identifiers,
-- and device credentials.

create table runtime.device_enrollment_request (
  id                    uuid primary key,
  merchant_id           uuid not null references merchant.merchant(id) on delete cascade,
  location_id             uuid references merchant.location(id) on delete cascade,
  display_name          text not null check (char_length(display_name) between 1 and 120),
  device_kind           text not null check (device_kind in ('kds', 'pos_terminal')),
  platform              text not null
    check (platform in ('android', 'ios', 'linux', 'macos', 'windows', 'web')),
  requested_platform    text
    check (requested_platform in ('android', 'ios', 'linux', 'macos', 'windows', 'web')),
  setup_code_hash       text not null unique check (setup_code_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key       uuid not null,
  state                 text not null default 'created'
    check (state in (
      'created', 'awaiting_approval', 'approved', 'denied', 'credential_ready',
      'credential_delivered', 'completed', 'expired', 'cancelled'
    )),
  attempts              integer not null default 0 check (attempts between 0 and 5),
  installation_hash     text check (installation_hash is null or installation_hash ~ '^[a-f0-9]{64}$'),
  installation_reference text
    check (installation_reference is null or installation_reference ~ '^[a-f0-9]{16}$'),
  ephemeral_public_key  text check (
    ephemeral_public_key is null
    or char_length(ephemeral_public_key) between 32 and 2048
  ),
  expires_at            timestamptz not null,
  claimed_at            timestamptz,
  decided_at            timestamptz,
  completed_at          timestamptz,
  created_by            uuid not null references umi.user(id),
  decided_by            uuid references umi.user(id),
  decision_idempotency_key uuid,
  replaces_device_id    uuid references merchant.device(id),
  device_id             uuid references merchant.device(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (merchant_id, idempotency_key),
  unique (merchant_id, decision_idempotency_key),
  constraint device_enrollment_request_location_scope_fk
    foreign key (merchant_id, location_id) references merchant.location(merchant_id, id)
);

create table runtime.device_pairing_session (
  id                    uuid primary key,
  enrollment_request_id uuid not null unique
    references runtime.device_enrollment_request(id) on delete cascade,
  polling_credential_hash text not null unique
    check (polling_credential_hash ~ '^[a-f0-9]{64}$'),
  polling_attempts      integer not null default 0 check (polling_attempts between 0 and 240),
  last_polled_at        timestamptz,
  credential_delivered_at timestamptz,
  acknowledged_at      timestamptz,
  created_at            timestamptz not null default now()
);

create index device_enrollment_request_active_idx
  on runtime.device_enrollment_request (merchant_id, location_id, state, expires_at);

create index device_enrollment_request_installation_idx
  on runtime.device_enrollment_request (installation_hash, state)
  where installation_hash is not null;

create index device_pairing_session_poll_idx
  on runtime.device_pairing_session (id, polling_credential_hash);

revoke all on runtime.device_enrollment_request, runtime.device_pairing_session
  from public, api, readonly;
grant select, insert, update on runtime.device_enrollment_request, runtime.device_pairing_session
  to worker;

comment on table runtime.device_enrollment_request is
  'One-time UmiPOS pairing requests. Setup codes and installation identifiers remain hashed.';
comment on table runtime.device_pairing_session is
  'Opaque pairing sessions. Only polling credential hashes are persisted.';
