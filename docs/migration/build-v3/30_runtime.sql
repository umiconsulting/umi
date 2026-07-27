-- ============================================================================
-- build-v3 · schema: runtime
-- The machine's WORKING MEMORY. Every table here is READ BACK by running code to
-- decide its next action (the read-back test). Nothing here is a business fact.
-- SEALED (grants in 90_rls). Built AFTER umi + tenant, so all FKs are inline.
--
-- NOT here (deliberately): device_event, traces/spans/costs
--   -> those are write-once TELEMETRY nothing reads back -> external OTel, not the DB.
-- Requires: extensions.vector (pgvector) for the semantic index.
-- ============================================================================

create schema if not exists runtime;

-- ----------------------------------------------------------------------------
-- AUTH & SESSION   → read to authenticate/authorize the NEXT request
-- ----------------------------------------------------------------------------

-- ONE session table for every principal that holds a token: a STAFF user
-- (dashboard/POS login), a CUSTOMER 'person' (umi-cash refresh token), and a
-- DEVICE (a KDS iPad). The principal is (principal_type, principal_id) — a SOFT
-- ref, deliberately no FK, because principal_id points into three different
-- tables by type: umi.user, tenant.customer, tenant.device. Two live writers
-- already depend on exactly this shape — cash/customer-session.service.ts
-- ('person'/'user') and kds.repository.ts ('device') — so a user_id-only table
-- could represent neither a device nor a customer session. token_hash is UNIQUE:
-- the cash path relies on it to 409 a double-submit instead of 500.
--   Worker-only (90_rls): api gets NO grant, so no RLS policy is needed;
--   business_id is still carried, to scope the worker's own reads.
create table runtime.session (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references tenant.business(id) on delete cascade,
  principal_type text not null check (principal_type in ('user','device','person')),
  principal_id   uuid not null,                        -- soft ref, resolved by principal_type
  token_hash     text not null,
  station_id     uuid references tenant.station(id),   -- device sessions: current station
  device_name    text,                                 -- device sessions: display name
  is_active      boolean not null default true,
  metadata       jsonb not null default '{}'::jsonb,   -- device sessions park location_id + last ip
  expires_at     timestamptz,                          -- cash sets 30d; a device token does not expire
  last_used_at   timestamptz,                          -- liveness heartbeat (KDS board/command polls)
  created_at     timestamptz not null default now()
);
create unique index session_token_hash_uidx on runtime.session (token_hash);
create index session_live_idx on runtime.session (business_id, principal_type) where is_active;

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
-- DEVICE PAIRING   → read to complete pairing. A device's LIVE credential is a
-- runtime.session row (principal_type='device'); this table is the REQUEST that
-- mints it. There is no separate device-session table — the earlier
-- runtime.device_session was speculative, had no code reader, and is deleted.
-- ----------------------------------------------------------------------------

-- A KDS device asks to be paired: it presents a salted-hashed PIN, an operator
-- approves it from the dashboard, and only THEN is a device + session provisioned.
-- The PIN is never stored in the clear (pin_hash/pin_salt — the source table's
-- plaintext `code` was the only unhashed secret in this schema); attempt_count/
-- max_attempts bound brute force. A device_id would be premature at request time —
-- the device row does not exist until approval — so the request carries where the
-- device WILL live (business_id/location_id/station_id/device_name). The device_id
-- is filled in the instant the pairing is claimed, and the CHECK makes that
-- structural: a 'used' pairing HAS produced a device, any other status has not.
create table runtime.pairing (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references tenant.business(id) on delete cascade,
  location_id    uuid references tenant.branch(id),
  station_id     uuid references tenant.station(id),
  device_id      uuid references tenant.device(id) on delete cascade,   -- the outcome (see CHECK)
  device_name    text not null,
  requested_name text,
  pin_hash       text not null,
  pin_salt       text not null,
  status         text not null default 'pending'
                   check (status in ('pending','approved','denied','expired','used')),
  attempt_count  integer not null default 0,
  max_attempts   integer not null default 5,
  expires_at     timestamptz not null,
  approved_by    uuid references umi.user(id),
  approved_at    timestamptz,
  denied_at      timestamptz,
  used_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint pairing_device_is_outcome check ((status = 'used') = (device_id is not null))
);
create index pairing_pending_idx on runtime.pairing (status, expires_at) where status = 'pending';

-- ----------------------------------------------------------------------------
-- WORK QUEUE & DELIVERY   → read by the WORKER to deliver / dedup / retry
-- ----------------------------------------------------------------------------

-- The TRANSACTIONAL OUTBOX. A status change must both commit and be announced, and
-- those cannot be made atomic across two systems: deliver after the commit and a crash
-- loses the message; deliver before and you may announce something that never happened.
-- So the message is written HERE, in the same transaction as the business change, and a
-- relay drains it. The table is the atomicity.
--
-- The rename to build-v3 had shrunk this table and, with it, dropped EXACTLY-ONCE
-- delivery: idempotency_key and its unique index were gone, so a retried relay could
-- send a customer the same "tu pedido está listo" twice. It is restored here as a
-- constraint, not a convention — the writer does ON CONFLICT DO NOTHING and the database
-- decides, so no code path can opt out of it.
--
-- Free to be shaped correctly because it carries NO data across the cutover: the 417
-- historical rows are deliberately dropped (security audit 2026-07-12 — past work whose
-- payloads carry raw customer phone/message PII into a sealed schema). Runtime starts
-- clean; the live queue regenerates.
create table runtime.outbox_event (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references tenant.business(id) on delete cascade,
  topic           text not null,          -- 'twilio.status_notification', 'twilio.reply', ...
  aggregate_id    uuid,                   -- the row this is about (an order, a conversation)
  -- EXACTLY-ONCE. Deterministic at the call site (e.g. kds:notify:<order>:<status>:<seq>),
  -- so a replayed transaction collides instead of duplicating. Scoped per business: one
  -- café's key space cannot collide with another's.
  idempotency_key text not null,
  payload         jsonb not null,         -- the message to deliver
  status          text not null default 'pending'
                    check (status in ('pending','delivering','delivered','dead')),
  attempts        integer not null default 0,
  max_attempts    integer not null default 5,
  -- TWO times, not one. The relay used a single `run_at` for both "not before this" and
  -- "the lease started here", so claiming a row overwrote its backoff schedule with the
  -- lease start. They are different facts with different lifetimes.
  available_at    timestamptz not null default now(),  -- do not deliver before this
  leased_at       timestamptz,                         -- when a relay claimed it
  delivered_at    timestamptz,
  error           text,                   -- last failure, so a 'dead' row is debuggable
  created_at      timestamptz not null default now(),
  constraint outbox_event_business_key_uq unique (business_id, idempotency_key)
);
-- The relay's claim query: ready rows oldest-first, plus stale leases to reclaim.
create index outbox_event_claim_idx on runtime.outbox_event (status, available_at, created_at);

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

-- The bot's IN-FLIGHT ORDER (was runtime.conversation_state, minus the FSM). One row per
-- conversation, last-write-wins — NO current_state enum, NO version cursors, NO CAS. `cart` is
-- the structured DraftCart (items); `selected_branch_id` is which branch this order is for (asked
-- at checkout). Both materialize into customer_order + order_item at confirmation, then the row is
-- cleared. The dialog "state" label is DERIVED from cart-presence each turn, never stored here.
create table runtime.conversation_cart (
  conversation_id    uuid primary key references tenant.conversation(id) on delete cascade,
  business_id        uuid not null references tenant.business(id) on delete cascade,
  cart               jsonb,                                  -- structured DraftCart, or null when empty
  selected_branch_id uuid references tenant.branch(id) on delete set null,
  updated_at         timestamptz not null default now(),
  created_at         timestamptz not null default now()
);
comment on table runtime.conversation_cart is
  'The bot''s in-flight order (cart + chosen branch), last-write-wins. Replaces the deleted '
  'conversation_state FSM; materializes to customer_order at confirmation, then cleared.';

-- The fragment-merge / debounce buffer: WhatsApp customers send an order in pieces ("two coffees"
-- · "make it three" · "add sugar"); the debounce window holds + merges them into one instruction
-- before the bot acts. Slimmed to that job only — NO integrity_decision / base_state_version /
-- reconcile columns (those existed only to reconcile against the deleted FSM).
create table runtime.conversation_turn (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references tenant.business(id) on delete cascade,
  conversation_id    uuid not null references tenant.conversation(id) on delete cascade,
  status             text not null default 'pending'
                       check (status in ('pending','processing','completed','failed','superseded')),
  source_message_ids uuid[] not null default '{}',           -- the fragments merged into this turn
  merged_user_text   text,                                   -- the one coherent instruction
  first_message_at   timestamptz,
  last_message_at    timestamptz,
  hold_until         timestamptz,                            -- debounce: process after this
  released_at        timestamptz,                            -- when the debounce fired
  superseded_at      timestamptz,                            -- re-merged: a fragment landed mid-flight
  created_at         timestamptz not null default now()
);
create index conversation_turn_active_idx on runtime.conversation_turn (conversation_id)
  where status in ('pending','processing');
comment on table runtime.conversation_turn is
  'The fragment-merge / debounce buffer for a WhatsApp turn. NOT an FSM — merges message fragments '
  'into one instruction before the bot acts.';

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
