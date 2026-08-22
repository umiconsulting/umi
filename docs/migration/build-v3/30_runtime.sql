-- ============================================================================
-- build-v3 · schema: runtime
-- The machine's WORKING MEMORY. Every table here is READ BACK by running code to
-- decide its next action (the read-back test). Nothing here is a merchant fact.
-- SEALED (grants in 90_rls). Built AFTER umi + merchant, so all FKs are inline.
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
-- tables by type: umi.user, merchant.customer, merchant.device. Two live writers
-- already depend on exactly this shape — cash/customer-session.service.ts
-- ('person'/'user') and kds.repository.ts ('device') — so a user_id-only table
-- could represent neither a device nor a customer session. token_hash is UNIQUE:
-- the cash path relies on it to 409 a double-submit instead of 500.
--   Worker-only (90_rls): api gets NO grant, so no RLS policy is needed;
--   every merchant-owned reader still carries an explicit merchant predicate.
create table runtime.session (
  id             uuid primary key default gen_random_uuid(),
  -- NULL only for a dashboard user session. Dashboard login happens before a café
  -- is selected, and a platform operator may have no café employment at all.
  merchant_id    uuid references merchant.merchant(id) on delete cascade,
  principal_type text not null check (principal_type in ('user','device','person')),
  principal_id   uuid not null,                        -- soft ref, resolved by principal_type
  token_hash     text not null,
  station_id     uuid references merchant.station(id),   -- device sessions: current station
  device_name    text,                                 -- device sessions: display name
  is_active      boolean not null default true,
  metadata       jsonb not null default '{}'::jsonb,   -- device sessions park location_id + last ip
  expires_at     timestamptz,                          -- cash sets 30d; a device token does not expire
  last_used_at   timestamptz,                          -- liveness heartbeat (KDS board/command polls)
  -- ---- Refresh family + revocation --------------------------------------------
  -- Every session minted from one login shares a family id. Detecting a replayed
  -- refresh token means killing the FAMILY, not just the one row: a stolen refresh
  -- token that rotates once has already forked the chain, and revoking a single
  -- session leaves the thief holding the other fork.
  refresh_family_id uuid not null default gen_random_uuid(),
  replaced_by_id    uuid references runtime.session(id),
  -- WHY it ended, and WHEN. `is_active` stays the single authority on whether the
  -- session works; these two explain it. The CHECK ties them together so a row can
  -- never claim to be live while carrying a revocation timestamp.
  revoked_at        timestamptz,
  revoked_reason    text,
  created_at     timestamptz not null default now(),
  constraint session_revocation_ck check (is_active = (revoked_at is null)),
  constraint session_merchant_scope_ck check (
    merchant_id is not null or
    (principal_type = 'user' and coalesce(metadata->>'client' = 'dashboard', false))
  )
);
create unique index session_token_hash_uidx on runtime.session (token_hash);
create index session_live_idx on runtime.session (merchant_id, principal_type) where is_active;
-- "Every live session of this device" — what revocation walks when a terminal is lost.
-- Expressed through principal_type/principal_id because that is how this schema models
-- a session's subject; there is no separate device_id column and adding one would put
-- the same fact in two places.
create index session_device_idx on runtime.session (principal_id)
  where principal_type = 'device' and is_active;
create index session_family_idx on runtime.session (refresh_family_id);

create table runtime.otp (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references umi.user(id) on delete cascade,
  -- 'mfa' joined the set with the second-factor work. It reuses this table rather than
  -- adding a near-identical one: a second factor IS a one-time code with an expiry and
  -- a single use, which is exactly what this table already models.
  purpose      text not null check (purpose in ('login','device_pairing','mfa')),
  code_hash    text not null,
  -- A 6-digit code has 10^6 possibilities, so an unthrottled verify endpoint is a
  -- guessing oracle, not a factor. The app refuses the code once this passes its
  -- ceiling and forces a new one to be issued. Counted on the ROW, not on the session,
  -- because the attacker chooses the session.
  attempts     integer not null default 0 check (attempts >= 0),
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);
-- "The live code for this user and purpose" — what verify looks up, and what issue
-- invalidates before it writes a new row.
create index otp_live_idx on runtime.otp (user_id, purpose, expires_at)
  where consumed_at is null;
comment on table runtime.otp is
  'One-time codes for USER auth (staff/operators). Customers do not authenticate (unverified phone only).';
comment on column runtime.otp.attempts is
  'Failed verifications against this code. The app caps it; without a cap a 6-digit '
  'code is guessable in bulk.';

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
-- device WILL live (merchant_id/location_id/station_id/device_name). The device_id
-- is filled in the instant the pairing is claimed, and the CHECK makes that
-- structural: a 'used' pairing HAS produced a device, any other status has not.
create table runtime.pairing (
  id             uuid primary key default gen_random_uuid(),
  merchant_id    uuid not null references merchant.merchant(id) on delete cascade,
  location_id    uuid references merchant.location(id),
  station_id     uuid references merchant.station(id),
  device_id      uuid references merchant.device(id) on delete cascade,   -- the outcome (see CHECK)
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
  merchant_id     uuid not null references merchant.merchant(id) on delete cascade,
  topic           text not null,          -- 'twilio.status_notification', 'twilio.reply', ...
  aggregate_id    uuid,                   -- the row this is about (an order, a conversation)
  -- EXACTLY-ONCE. Deterministic at the call site (e.g. kds:notify:<order>:<status>:<seq>),
  -- so a replayed transaction collides instead of duplicating. Scoped per merchant: one
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
  constraint outbox_event_merchant_key_uq unique (merchant_id, idempotency_key)
);
-- The relay's claim query: ready rows oldest-first, plus stale leases to reclaim.
create index outbox_event_claim_idx on runtime.outbox_event (status, available_at, created_at);

-- The ingress observability gate. RESTORED to the shape the worker actually writes
-- (same class of loss as runtime.outbox_event: the from-scratch DDL simplified past
-- what the live code needs, and the statements resolved against nothing).
--
-- `provider_event_id` was called `external_id` here, which is the same fact under a
-- different name — the code has always written `provider_event_id`.
--
-- The UNIQUE below already existed; it indexed the column under its old name, so the
-- `ON CONFLICT (provider, provider_event_id)` in queue.repository failed on the column
-- name rather than on a missing constraint. Renaming the column makes the existing
-- index the one the code was always addressing.
-- `whatsapp.controller` documents this as observability, NOT authoritative dedup: the
-- durable guards are merchant.message.provider_message_id and the BullMQ jobId.
create table runtime.inbound_event (
  id           uuid primary key default gen_random_uuid(),
  -- Soft ref, and NULLABLE: a webhook is recorded as it arrives, which can be before
  -- (or without) resolving which café it belongs to. Attribution is not a precondition
  -- for observing that something arrived.
  merchant_id  uuid,
  provider     text not null,              -- 'twilio','zettle','google_wallet',...
  provider_event_id text,                  -- the provider's own event id
  event_type   text,
  payload_hash text,                       -- cheap equality check without re-reading payload
  payload      jsonb not null,             -- honest jsonb: the raw webhook envelope
  status       text not null default 'received'
                 check (status in ('received','processed','failed')),
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  created_at   timestamptz not null default now()
);
create unique index inbound_event_provider_ext_uq
  on runtime.inbound_event (provider, provider_event_id) where provider_event_id is not null;

-- Inbound dedup only: "have I already seen this webhook / this provider callback?"
--
-- ⚠️ NOT for business commands. This table records that a key was SEEN; it stores no
-- request fingerprint and no response, so a retry carrying the same key with a
-- DIFFERENT body looks identical to a genuine replay, and a caller that reuses a key
-- gets silence instead of a conflict. For anything that moves money or creates an
-- order, use merchant.business_command, which keeps the fingerprint and the recorded
-- result and answers IDEMPOTENCY_CONFLICT when they disagree.
create table runtime.idempotency_key (
  -- RESTORED to a MERCHANT-SCOPED key. `key` alone as the primary key put every café in
  -- one namespace: two merchants whose upstream hands them the same provider id would
  -- collide, and one café's write could answer another café's "already done?".
  merchant_id  uuid not null references merchant.merchant(id) on delete cascade,
  scope        text not null,
  key          text not null,              -- read BEFORE processing: "already done?"
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  primary key (merchant_id, scope, key)
);

-- The exhausted-job sink. RESTORED: `source text` collapsed four facts the operator
-- surface needs into one concatenated string ('bullmq.turns:turn.process'), and dropped
-- the merchant entirely — a dead letter nobody can attribute to a café is not
-- actionable, it is just a log line.
--
-- merchant_id is NOT NULL and FKs merchant.merchant, which dead-letter.service.ts already
-- states as the reason infra jobs with no merchant are log-only rather than persisted.
create table runtime.dead_letter (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchant.merchant(id) on delete cascade,
  source_schema text,                      -- 'bullmq'
  source_table  text,                      -- 'turns'
  source_id     text,                      -- the job id
  event_type    text,                      -- 'turn.process'
  payload       jsonb,
  error         text,
  attempts      integer not null default 0 check (attempts >= 0),
  failed_at     timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index dead_letter_merchant_time_idx on runtime.dead_letter (merchant_id, failed_at desc);

-- ----------------------------------------------------------------------------
-- LIVE CONVERSATION   → read to resume the bot / prevent double-sends
-- ----------------------------------------------------------------------------

-- The bot's IN-FLIGHT ORDER (was runtime.conversation_state, minus the FSM). One row per
-- conversation, last-write-wins — NO current_state enum, NO version cursors, NO CAS. `cart` is
-- the structured DraftCart (items); `selected_location_id` is which location this order is for (asked
-- at checkout). Both materialize into customer_order + order_item at confirmation, then the row is
-- cleared. The dialog "state" label is DERIVED from cart-presence each turn, never stored here.
create table runtime.conversation_cart (
  conversation_id    uuid primary key references merchant.conversation(id) on delete cascade,
  merchant_id        uuid not null references merchant.merchant(id) on delete cascade,
  cart               jsonb,                                  -- structured DraftCart, or null when empty
  selected_location_id uuid references merchant.location(id) on delete set null,
  updated_at         timestamptz not null default now(),
  created_at         timestamptz not null default now()
);
comment on table runtime.conversation_cart is
  'The bot''s in-flight order (cart + chosen location), last-write-wins. Replaces the deleted '
  'conversation_state FSM; materializes to customer_order at confirmation, then cleared.';

-- The fragment-merge / debounce buffer: WhatsApp customers send an order in pieces ("two coffees"
-- · "make it three" · "add sugar"); the debounce window holds + merges them into one instruction
-- before the bot acts. Slimmed to that job only — NO integrity_decision / base_state_version /
-- reconcile columns (those existed only to reconcile against the deleted FSM).
create table runtime.conversation_turn (
  id                 uuid primary key default gen_random_uuid(),
  merchant_id        uuid not null references merchant.merchant(id) on delete cascade,
  conversation_id    uuid not null references merchant.conversation(id) on delete cascade,
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
  merchant_id   uuid not null references merchant.merchant(id) on delete cascade,
  card_id       uuid not null references merchant.loyalty_card(id) on delete cascade,
  reminder_type text not null
                  check (reminder_type in ('reward_expiring','welcome_no_visit',
                                           'winback_inactive','streak_recognition')),
  sent_at       timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (merchant_id, card_id, reminder_type)
);
comment on table runtime.reminder_sent is
  'Dedup guard read BEFORE a lifecycle nudge (was nudge_sent). The message itself is merchant.message.';

-- ----------------------------------------------------------------------------
-- INTEGRATION   → read to resume a sync / route a wallet push
-- ----------------------------------------------------------------------------

create table runtime.integration_sync (
  integration_id uuid primary key references merchant.integration(id) on delete cascade,
  cursor         text,                       -- read to resume the Zettle/wallet sync
  last_synced_at timestamptz,
  last_error     text,
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create table runtime.pass_device (
  id             uuid primary key default gen_random_uuid(),
  wallet_pass_id uuid not null references merchant.loyalty_wallet_pass(id) on delete cascade,
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
  product_id   uuid primary key references merchant.product(id) on delete cascade,
  embedding    extensions.vector(1024) not null,
  model        text not null,
  created_at   timestamptz not null default now()
);

create table runtime.message_embedding (
  message_id   uuid primary key references merchant.message(id) on delete cascade,
  embedding    extensions.vector(1024) not null,
  model        text not null,
  created_at   timestamptz not null default now()
);

create table runtime.knowledge_embedding (
  chunk_id     uuid primary key references merchant.knowledge_chunk(id) on delete cascade,
  embedding    extensions.vector(1024) not null,
  model        text not null,
  created_at   timestamptz not null default now()
);

-- ============================================================================
-- DEVICE TRUST + OPERATOR PRESENCE
-- Machinery, not merchant fact: a café never reads these, and they are sealed
-- from every merchant role in 90_rls.
-- ============================================================================

-- A one-time, expiring enrolment challenge. The owner generates it in the dashboard,
-- reads a short code to whoever is holding the tablet, and the tablet exchanges it for
-- a credential. Only the HASH is stored: the code is shown once and is unrecoverable.
--
-- `idempotency_key` exists because of a defect our own audit recorded on the location:
-- if a lost response consumes the challenge, the device is stranded with no way back.
-- A retry must return the same challenge, not burn it.
create table runtime.device_enrollment_challenge (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchant.merchant(id) on delete cascade,
  location_id     uuid references merchant.location(id) on delete cascade,
  display_name  text not null,
  device_kind   text not null check (device_kind in ('kds','pos_terminal')),
  platform      text not null
                  check (platform in ('android','ios','linux','macos','windows','web')),
  code_hash     text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key uuid not null,
  expires_at    timestamptz not null,
  attempts      integer not null default 0 check (attempts between 0 and 5),
  consumed_at   timestamptz,
  created_by    uuid not null references umi.user(id),
  replaces_device_id uuid references merchant.device(id),
  created_at    timestamptz not null default now(),
  unique (merchant_id, idempotency_key)
);
create index device_enrollment_active_idx
  on runtime.device_enrollment_challenge (id, expires_at) where consumed_at is null;
comment on table runtime.device_enrollment_challenge is
  'One-time expiring device enrolment challenges. Only hashes are persisted.';

-- WHO IS AT THE TILL RIGHT NOW. Separate from runtime.session, which is durable
-- authentication, because they answer different questions and end at different times:
-- a cashier locks the screen and walks away (operator session ends) while the device
-- stays authenticated (durable session lives on).
--
-- `permissions` and `entitlements` are RESOLVED AT START and frozen for the session, so
-- that a mid-shift role change cannot silently widen what the person at the counter can
-- do. Widening requires a new session; narrowing happens by revocation.
create table runtime.operator_session (
  id            uuid primary key default gen_random_uuid(),
  durable_session_id uuid not null references runtime.session(id) on delete cascade,
  user_id       uuid not null references umi.user(id),
  staff_id      uuid not null references merchant.staff(id),
  device_id     uuid not null references merchant.device(id),
  merchant_id   uuid not null references merchant.merchant(id),
  location_id     uuid not null references merchant.location(id),
  state         text not null default 'active' check (state in ('active','locked','ended')),
  permissions   text[] not null default '{}',
  entitlements  jsonb not null default '[]'::jsonb,
  started_at    timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  expires_at    timestamptz not null,
  ended_at      timestamptz,
  constraint operator_session_end_ck check ((state = 'ended') = (ended_at is not null)),
  constraint operator_session_location_same_merchant_fk
    foreign key (merchant_id, location_id) references merchant.location (merchant_id, id)
);
-- One live operator per authenticated device session.
create unique index operator_session_one_active_per_durable
  on runtime.operator_session (durable_session_id) where state in ('active','locked');
create index operator_session_device_idx
  on runtime.operator_session (device_id) where state <> 'ended';
comment on table runtime.operator_session is
  'Server-authoritative operator presence, separate from durable device authentication.';

-- A short-lived grant to do ONE privileged thing: void a line, refund, discount past a
-- threshold. Consumed on use — an approval that can be replayed is not an approval.
create table runtime.elevation_grant (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references runtime.session(id) on delete cascade,
  merchant_id   uuid not null references merchant.merchant(id) on delete cascade,
  location_id     uuid references merchant.location(id) on delete cascade,
  permission_key text not null,
  method        text not null check (method in ('manager_approval','operator_pin')),
  approved_by   uuid references umi.user(id),
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index elevation_grant_active_idx
  on runtime.elevation_grant (session_id, merchant_id, permission_key, expires_at)
  where consumed_at is null;

-- Internal security decisions: denials, lockouts, credential failures. Deliberately NOT
-- merchant.audit_event — a café must not be able to read the shape of our auth defences,
-- and a failed login attempt on someone else's account is not their merchant fact.
create table runtime.security_audit_event (
  id            uuid primary key default gen_random_uuid(),
  actor_user_id uuid references umi.user(id) on delete set null,
  session_id    uuid references runtime.session(id) on delete set null,
  merchant_id   uuid,   -- soft ref: audit exhaust must outlive the row it describes
  location_id     uuid,   -- soft ref, same reason
  event_type    text not null,
  entity_type   text not null,
  entity_id     uuid,
  outcome       text not null check (outcome in ('success','denied','failure')),
  reason_code   text,
  request_id    text,
  metadata      jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now()
);
create index security_audit_actor_time_idx
  on runtime.security_audit_event (actor_user_id, occurred_at desc);
create index security_audit_merchant_time_idx
  on runtime.security_audit_event (merchant_id, occurred_at desc);
comment on table runtime.security_audit_event is
  'Append-only internal security decisions. No merchant role can read this table.';

-- The unredacted half of a merchant.audit_event. The café reads public_data on the event;
-- everything that must exist for an investigation but must not be shown lives here.
create table runtime.audit_event_internal (
  audit_event_id uuid primary key references merchant.audit_event(id) on delete restrict,
  merchant_id   uuid not null references merchant.merchant(id) on delete restrict,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
