-- ============================================================================
-- build-v3 · schema: runtime
-- The machine's WORKING MEMORY. Every table here is READ BACK by running code to
-- decide its next action (the read-back test). Nothing here is a business fact.
-- SEALED (grants in 90_rls). Built AFTER umi + tenant, so all FKs are inline.
--
-- NOT here (deliberately): device_event, conversation_turn, traces/spans/costs
--   -> those are write-once TELEMETRY nothing reads back -> external OTel, not the DB.
-- Requires: extensions.vector (pgvector) for the semantic index.
-- ============================================================================

create schema if not exists runtime;

-- ----------------------------------------------------------------------------
-- AUTH & SESSION   → read to authenticate/authorize the NEXT request
-- ----------------------------------------------------------------------------

create table runtime.session (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references umi.user(id) on delete cascade,
  device_id    uuid references tenant.device(id),        -- a KDS login = a user acting THROUGH a device
  app          text not null check (app in ('kds','dashboard','pos')),
  token_hash   text not null,
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz,
  revoked_at   timestamptz,
  ip           text,
  user_agent   text,
  created_at   timestamptz not null default now()
);
create index session_user_idx on runtime.session (user_id) where revoked_at is null;

create table runtime.otp (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references umi.user(id) on delete cascade,
  purpose      text not null check (purpose in ('login','device_pairing')),
  code_hash    text not null,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);
comment on table runtime.otp is
  'One-time codes for USER auth (staff/operators). Customers do not authenticate (unverified phone only).';

create table runtime.password_reset_token (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references umi.user(id) on delete cascade,
  token_hash   text not null,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- DEVICE CONNECTIVITY   → read to authorize a device / complete pairing
-- ----------------------------------------------------------------------------

create table runtime.device_session (
  id           uuid primary key default gen_random_uuid(),
  device_id    uuid not null references tenant.device(id) on delete cascade,
  token_hash   text not null,
  paired_at    timestamptz not null default now(),
  expires_at   timestamptz,
  last_seen_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create table runtime.pairing (
  id           uuid primary key default gen_random_uuid(),
  device_id    uuid not null references tenant.device(id) on delete cascade,
  code         text not null,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- WORK QUEUE & DELIVERY   → read by the WORKER to deliver / dedup / retry
-- ----------------------------------------------------------------------------

create table runtime.outbox_event (
  id              uuid primary key default gen_random_uuid(),
  topic           text not null,
  payload         jsonb not null,          -- honest jsonb: the message to deliver
  status          text not null default 'pending'
                    check (status in ('pending','sent','failed')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index outbox_event_pending_idx on runtime.outbox_event (next_attempt_at)
  where status = 'pending';

create table runtime.inbound_event (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,              -- 'twilio','zettle','google_wallet',...
  external_id  text,                        -- provider's event id (for dedup)
  payload      jsonb not null,             -- honest jsonb: the raw webhook envelope
  status       text not null default 'received'
                 check (status in ('received','processed','failed')),
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  created_at   timestamptz not null default now()
);
create unique index inbound_event_provider_ext_uq
  on runtime.inbound_event (provider, external_id) where external_id is not null;

create table runtime.idempotency_key (
  key          text primary key,           -- read BEFORE processing: "already done?"
  scope        text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz
);

create table runtime.dead_letter (
  id           uuid primary key default gen_random_uuid(),
  source       text not null,
  payload      jsonb,
  error        text,
  failed_at    timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- LIVE CONVERSATION   → read to resume the bot / prevent double-sends
-- ----------------------------------------------------------------------------

create table runtime.conversation_state (
  conversation_id uuid primary key references tenant.conversation(id) on delete cascade,
  state           jsonb not null default '{}'::jsonb,   -- honest jsonb: live FSM position + slots
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
comment on table runtime.conversation_state is
  'The bot''s live position in a flow — read to resume. Working memory, not history (that is tenant.message).';

create table runtime.reminder_sent (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references tenant.business(id) on delete cascade,
  card_id       uuid not null references tenant.loyalty_card(id) on delete cascade,
  reminder_type text not null
                  check (reminder_type in ('reward_expiring','welcome_no_visit',
                                           'winback_inactive','streak_recognition')),
  sent_at       timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (business_id, card_id, reminder_type)
);
comment on table runtime.reminder_sent is
  'Dedup guard read BEFORE a lifecycle nudge (was nudge_sent). The message itself is tenant.message.';

-- ----------------------------------------------------------------------------
-- INTEGRATION   → read to resume a sync / route a wallet push
-- ----------------------------------------------------------------------------

create table runtime.integration_sync (
  integration_id uuid primary key references tenant.integration(id) on delete cascade,
  cursor         text,                       -- read to resume the Zettle/wallet sync
  last_synced_at timestamptz,
  last_error     text,
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create table runtime.pass_device (
  id             uuid primary key default gen_random_uuid(),
  wallet_pass_id uuid not null references tenant.loyalty_wallet_pass(id) on delete cascade,
  device_identifier text not null,           -- Apple/Google device id
  push_token     text,                        -- read to push a pass update to the device
  registered_at  timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (wallet_pass_id, device_identifier)
);

-- ----------------------------------------------------------------------------
-- SEMANTIC INDEX   → read at QUERY time for search / RAG (derived from facts)
-- vector dims = Voyage model (voyage-3 = 1024); adjust if the model changes.
-- ----------------------------------------------------------------------------

create table runtime.product_embedding (
  product_id   uuid primary key references tenant.product(id) on delete cascade,
  embedding    extensions.vector(1024) not null,
  model        text not null,
  created_at   timestamptz not null default now()
);

create table runtime.message_embedding (
  message_id   uuid primary key references tenant.message(id) on delete cascade,
  embedding    extensions.vector(1024) not null,
  model        text not null,
  created_at   timestamptz not null default now()
);

create table runtime.knowledge_embedding (
  chunk_id     uuid primary key references tenant.knowledge_chunk(id) on delete cascade,
  embedding    extensions.vector(1024) not null,
  model        text not null,
  created_at   timestamptz not null default now()
);
