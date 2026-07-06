-- =============================================================================
-- 16_runtime.sql  (canonical rebuild v2 — schema `runtime`, SEALED machinery)
--
-- The `runtime` schema is Umi's async + session + turn machinery: the
-- transactional outbox, inbound-webhook idempotent gate, generic idempotency
-- store, dead-letter parking lot, principal sessions (person/user/device),
-- device pairing handshake, OTP verification, lifecycle-nudge dedup guard, the
-- AI turn/debounce engine, the live cart/CAS conversation state, and Apple/Google
-- push-device plumbing. "Active infrastructure — if you truncate this, the system
-- stops working."
--
-- Aggregated + transformed from the current build/ sources:
--   build/15_queue.sql          -> runtime.outbox_events, inbound_events,
--                                   idempotency_keys, dead_letters
--                                   (DROP queue.jobs + queue.job_attempts — 0 writers)
--   build/16_device_kitchen.sql -> runtime.session (merged w/ core.sessions),
--                                   runtime.pairing (from device.pairing_requests)
--   build/10_core.sql           -> runtime.session (merged w/ device.sessions)
--   build/11_loyalty.sql        -> runtime.otp (from loyalty.otp_verifications),
--                                   runtime.nudge_sent (from lifecycle_sends),
--                                   runtime.pass_device (from pass_devices)
--   build/13_comms.sql          -> runtime.conversation_turn (from conversation_turns),
--                                   runtime.conversation_state (NEW — cart/CAS split
--                                   out of comms.conversations)
--
-- POSTURE (manifest FILE 16 + GLOBAL RULES):
--   * SEALED: 00_foundation grants USAGE on `runtime` to umi_worker + umi_readonly
--     ONLY (never umi_app). DML is granted to umi_worker ONLY here; umi_readonly
--     gets SELECT; umi_app gets NOTHING.
--   * NO RLS: 90_rls.sql deliberately skips `runtime` (out of the tenant-isolation
--     loop). Isolation is the schema-USAGE seal + REVOKE ALL below. Every table
--     still carries `tenant_id uuid NOT NULL` for worker-side filtering.
--   * NO append-only triggers here (those attach ONLY to tenant.card_ledger +
--     tenant.gift_card_ledger). NO composite (tenant_id, id) tenant-FKs — runtime
--     is not RLS-enrolled; cross-seam parents are referenced as SOFT uuids, and
--     tenant_id carries a plain FK to the tenant root for referential integrity.
--
-- Idempotent + re-runnable: CREATE ... IF NOT EXISTS; guarded index creation.
-- Depends on: 00_foundation.sql (schemas, roles), 11_tenant_core.sql
--   (tenant.tenant, tenant.login). Target: PostgreSQL 18, local build, port 5233.
-- =============================================================================

begin;

set search_path = runtime, tenant, public, extensions;

-- ===========================================================================
-- runtime.inbound_events  <- queue.inbound_events (kept)
--   Raw webhook ingress — the idempotent gate at the system boundary.
--   UNIQUE(provider, provider_event_id) so the same upstream delivery can never
--   be processed twice. tenant_id retargeted core.tenants -> tenant.tenant.
-- ===========================================================================
create table if not exists runtime.inbound_events (
  id                 uuid not null default gen_random_uuid(),
  tenant_id          uuid not null references tenant.tenant(id) on delete cascade,
  provider           text not null,
  provider_event_id  text,
  event_type         text not null,
  payload_hash       text,
  payload            jsonb not null default '{}'::jsonb,
  status             text not null default 'accepted'
    check (status in ('accepted', 'processing', 'completed', 'failed', 'duplicate')),
  request_id         uuid not null default gen_random_uuid(),
  received_at        timestamptz not null default now(),
  completed_at       timestamptz,
  error              text,
  primary key (id),
  unique (tenant_id, id),
  constraint runtime_inbound_events_provider_event_uq
    unique (provider, provider_event_id)
);

create index if not exists runtime_inbound_events_tenant_received_idx
  on runtime.inbound_events (tenant_id, received_at desc);
create index if not exists runtime_inbound_events_inflight_idx
  on runtime.inbound_events (status)
  where status in ('accepted', 'processing');

-- ===========================================================================
-- runtime.outbox_events  <- queue.outbox_events (kept)
--   The transactional outbox — the sanctioned cross-product connective tissue.
--   Written in the SAME transaction as the state change; a publisher later
--   delivers each row and stamps published_at.
--   DEVIATION: source `job_id` was an FK into queue.jobs, which is DROPPED (0
--   writers). Retained as a plain SOFT uuid (NO FK) to preserve emitter trace.
--   tenant_id retargeted -> tenant.tenant. idempotency_key kept (producer dedup).
-- ===========================================================================
create table if not exists runtime.outbox_events (
  id               uuid not null default gen_random_uuid(),
  tenant_id        uuid not null references tenant.tenant(id) on delete cascade,
  job_id           uuid,                              -- SOFT ref (queue.jobs dropped); NO FK
  event_type       text not null,
  aggregate_id     uuid,
  idempotency_key  text not null,
  payload          jsonb not null default '{}'::jsonb,
  status           text not null default 'pending'
    check (status in ('pending', 'delivering', 'delivered', 'failed', 'dead')),
  attempts         smallint not null default 0,
  max_attempts     smallint not null default 5,
  run_at           timestamptz not null default now(),
  published_at     timestamptz,
  error            text,
  created_at       timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  constraint runtime_outbox_events_idempotency_uq unique (idempotency_key)
);

create index if not exists runtime_outbox_events_deliverable_idx
  on runtime.outbox_events (run_at)
  where status = 'pending';
create index if not exists runtime_outbox_events_tenant_created_idx
  on runtime.outbox_events (tenant_id, created_at desc);
create index if not exists runtime_outbox_events_job_idx
  on runtime.outbox_events (job_id)
  where job_id is not null;
create index if not exists runtime_outbox_events_type_idx
  on runtime.outbox_events (event_type, created_at desc);

-- ===========================================================================
-- runtime.idempotency_keys  <- queue.idempotency_keys (kept)
--   Generic deduplication store. A worker checks-and-claims a (tenant, scope,
--   key) before doing non-idempotent work; the cached result short-circuits a
--   retry. tenant_id retargeted -> tenant.tenant.
-- ===========================================================================
create table if not exists runtime.idempotency_keys (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null references tenant.tenant(id) on delete cascade,
  scope       text not null,
  key         text not null,
  result      jsonb,
  locked_at   timestamptz,
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  constraint runtime_idempotency_keys_scope_key_uq unique (tenant_id, scope, key)
);

create index if not exists runtime_idempotency_keys_expires_idx
  on runtime.idempotency_keys (expires_at)
  where expires_at is not null;

-- ===========================================================================
-- runtime.dead_letters  <- queue.dead_letters (kept)
--   Failed events parked for manual inspection. Origin recorded as SOFT pointers
--   (source_schema/table/id) — NO FK (may outlive / point at any schema).
--   tenant_id retargeted -> tenant.tenant.
-- ===========================================================================
create table if not exists runtime.dead_letters (
  id             uuid not null default gen_random_uuid(),
  tenant_id      uuid not null references tenant.tenant(id) on delete cascade,
  source_schema  text,
  source_table   text,
  source_id      uuid,
  event_type     text,
  payload        jsonb not null default '{}'::jsonb,
  error          text,
  attempts       smallint not null default 0,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id)
);

create index if not exists runtime_dead_letters_tenant_unresolved_idx
  on runtime.dead_letters (tenant_id, created_at desc)
  where resolved_at is null;
create index if not exists runtime_dead_letters_source_idx
  on runtime.dead_letters (source_schema, source_table, source_id)
  where source_id is not null;

-- ===========================================================================
-- runtime.session  <- MERGE core.sessions (10_core) + device.sessions (16)
--   One session table for every principal. `principal_type` discriminates the
--   merged sources:
--     'person' | 'user'  <- core.sessions (person_id XOR user_id; token)
--     'device'           <- device.sessions (device_id; token_hash)
--   The polymorphic owner collapses to (principal_type, principal_id). The auth
--   secret is stored HASHED (manifest: "hash the token") in `token_hash` — this
--   unifies core.sessions.token (was plaintext-carried) + device.sessions.token_hash.
--   Device-only cols preserved: device_name, station_id (SOFT), is_active,
--   last_used_at. core-only col preserved: expires_at (nullable — device sessions
--   had none). tenant_id retargeted -> tenant.tenant. Sealed: worker validates.
-- ===========================================================================
create table if not exists runtime.session (
  id             uuid not null default gen_random_uuid(),
  tenant_id      uuid not null references tenant.tenant(id) on delete cascade,
  principal_type text not null
    check (principal_type in ('person', 'user', 'device')),
  principal_id   uuid not null,     -- person / user / device id (SOFT ref)
  token_hash     text not null,     -- hashed session/auth token (was token | token_hash)
  device_name    text,              -- device sessions only
  station_id     uuid,              -- SOFT ref to tenant.station; device sessions only
  is_active      boolean not null default true,
  expires_at     timestamptz,       -- core sessions (refresh JWT continuity); nullable
  last_used_at   timestamptz,       -- device sessions
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  unique (token_hash)
);

create index if not exists runtime_session_principal_idx
  on runtime.session (tenant_id, principal_type, principal_id);
create index if not exists runtime_session_active_idx
  on runtime.session (tenant_id, is_active) where is_active;
create index if not exists runtime_session_expires_idx
  on runtime.session (expires_at) where expires_at is not null;

-- ===========================================================================
-- runtime.pairing  <- device.pairing_requests (16)
--   PIN-based device pairing handshake. tenant_id retargeted -> tenant.tenant.
--   DEVIATION (sealed schema, no composite tenant FKs): location_id + station_id
--   demoted to SOFT uuids (NO FK). `approved_by` retargeted core.users ->
--   tenant.login (plain FK — login is the RLS-exception principal table).
--   pin_hash/pin_salt are secrets but runtime is worker-only, so no column
--   REVOKE dance is needed (umi_app has no USAGE on `runtime` at all).
-- ===========================================================================
create table if not exists runtime.pairing (
  id             uuid not null default gen_random_uuid(),
  tenant_id      uuid not null references tenant.tenant(id) on delete cascade,
  location_id    uuid,              -- SOFT ref to tenant.branch; NO FK
  station_id     uuid,              -- SOFT ref to tenant.station; NO FK
  device_name    text not null,
  requested_name text,
  pin_hash       text not null,     -- secret (worker-only)
  pin_salt       text not null,     -- secret (worker-only)
  status         text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'expired', 'used')),
  attempt_count  integer not null default 0,
  max_attempts   integer not null default 5,
  expires_at     timestamptz not null,
  approved_by    uuid references tenant.login(id) on delete set null,
  approved_at    timestamptz,
  used_at        timestamptz,
  denied_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  constraint runtime_pairing_attempts_chk
    check (attempt_count >= 0 and max_attempts > 0)
);

create index if not exists runtime_pairing_pending_idx
  on runtime.pairing (status, expires_at) where status = 'pending';
create index if not exists runtime_pairing_tenant_status_idx
  on runtime.pairing (tenant_id, location_id, status, expires_at desc);

-- ===========================================================================
-- runtime.otp  <- loyalty.otp_verifications (11)
--   OTP verification codes. tenant_id retargeted -> tenant.tenant. person_id
--   demoted to a SOFT uuid (NO FK — sealed schema). identity_value is the
--   normalized phone/email; code_hash is worker-only. verified_at nullable.
-- ===========================================================================
create table if not exists runtime.otp (
  id              uuid not null default gen_random_uuid(),
  tenant_id       uuid not null references tenant.tenant(id) on delete cascade,
  person_id       uuid,             -- SOFT ref to tenant.customer; NO FK
  identity_type   text not null default 'phone'
    check (identity_type in ('phone', 'email')),
  identity_value  text not null,
  code_hash       text not null,    -- secret (worker-only)
  expires_at      timestamptz not null,
  attempts        integer not null default 0,
  verified_at     timestamptz,
  created_at      timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id)
);

create index if not exists runtime_otp_identity_idx
  on runtime.otp (tenant_id, identity_type, identity_value, created_at desc);
create index if not exists runtime_otp_expires_idx
  on runtime.otp (expires_at);

-- ===========================================================================
-- runtime.nudge_sent  <- loyalty.lifecycle_sends (11)
--   The at-most-once dedup guard for the lifecycle-nudge cron. tenant_id
--   retargeted -> tenant.tenant. card_id demoted to SOFT uuid (NO FK — sealed).
--   UNIQUE(tenant_id, card_id, journey) — if this guard is lost the cron re-spams.
-- ===========================================================================
create table if not exists runtime.nudge_sent (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null references tenant.tenant(id) on delete cascade,
  card_id     uuid not null,        -- SOFT ref to tenant.card; NO FK
  journey     text not null,
  sent_at     timestamptz not null default now(),
  body        text,
  metadata    jsonb not null default '{}'::jsonb,
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, card_id, journey)
);

create index if not exists runtime_nudge_sent_card_idx
  on runtime.nudge_sent (tenant_id, card_id, sent_at desc);

-- ===========================================================================
-- runtime.conversation_turn  <- comms.conversation_turns (13)
--   The AI turn/debounce machinery (merge window, hold-until, integrity gate,
--   state versioning). tenant_id retargeted -> tenant.tenant. DEVIATION (sealed
--   schema): conversation_id / person_id / assistant_message_id demoted to SOFT
--   uuids (NO FK) — the durable thread lives in tenant.conversation. Turn
--   reasoning columns preserved verbatim; source_message_ids array kept + GIN.
-- ===========================================================================
create table if not exists runtime.conversation_turn (
  id                   uuid not null default gen_random_uuid(),
  tenant_id            uuid not null references tenant.tenant(id) on delete cascade,
  conversation_id      uuid not null,                             -- SOFT ref to tenant.conversation
  person_id            uuid,                                      -- SOFT ref to tenant.customer
  status               text not null,
  source_message_ids   uuid[] not null default array[]::uuid[],   -- SOFT refs to tenant.message
  assistant_message_id uuid,                                      -- SOFT ref to tenant.message
  merged_user_text     text,
  integrity_decision   text,
  integrity_reason     text,
  base_state_version   bigint,
  extracted_intent     jsonb,
  reconciled_action    jsonb,
  first_message_at     timestamptz,
  last_message_at      timestamptz,
  hold_until           timestamptz,
  released_at          timestamptz,
  processed_at         timestamptz,
  superseded_at        timestamptz,
  created_at           timestamptz not null default now(),
  metadata             jsonb not null default '{}'::jsonb,
  primary key (id),
  unique (tenant_id, id)
);

create index if not exists runtime_conversation_turn_conv_created_idx
  on runtime.conversation_turn (conversation_id, created_at desc);
create index if not exists runtime_conversation_turn_status_hold_idx
  on runtime.conversation_turn (status, hold_until);
create index if not exists runtime_conversation_turn_source_msgs_gin
  on runtime.conversation_turn using gin (source_message_ids);

-- ===========================================================================
-- runtime.conversation_state  (NEW — the live cart/CAS state split out of
--   tenant.conversation, per manifest FILE 14 + FILE 16). One live-state row per
--   conversation, worker-managed with optimistic concurrency (state_version /
--   draft_cart_version) and the debounce hold. Keyed by (tenant_id,
--   conversation_id). conversation_id is a SOFT uuid (the durable thread lives in
--   tenant.conversation). These columns were formerly inline on comms.conversations.
-- ===========================================================================
create table if not exists runtime.conversation_state (
  id                    uuid not null default gen_random_uuid(),
  tenant_id             uuid not null references tenant.tenant(id) on delete cascade,
  conversation_id       uuid not null,                            -- SOFT ref to tenant.conversation
  current_state         text not null default 'initial',
  draft_cart            jsonb,                                    -- live cart (preserved)
  state_data            jsonb not null default '{}'::jsonb,       -- CAS state (preserved)
  conversation_history  jsonb not null default '[]'::jsonb,       -- rolling history (preserved)
  pending_clarification jsonb,                                    -- open question (preserved)
  state_version         bigint not null default 0,                -- optimistic concurrency
  draft_cart_version    bigint not null default 0,                -- optimistic concurrency
  base_state_version    bigint,                                   -- turn base snapshot
  hold_until            timestamptz,                              -- debounce window
  updated_at            timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  -- one live-state row per conversation (the CAS key).
  unique (tenant_id, conversation_id)
);

create index if not exists runtime_conversation_state_hold_idx
  on runtime.conversation_state (hold_until) where hold_until is not null;

-- ===========================================================================
-- runtime.pass_device  <- loyalty.pass_devices (11)
--   Apple/Google push-device delivery plumbing — the ONLY path for wallet-pass
--   updates. tenant_id retargeted -> tenant.tenant. pass_id demoted to SOFT uuid
--   (NO FK — the pass lives in tenant.wallet_pass). UNIQUE(pass_id, device_token)
--   keeps re-registration idempotent.
-- ===========================================================================
create table if not exists runtime.pass_device (
  id            uuid not null default gen_random_uuid(),
  tenant_id     uuid not null references tenant.tenant(id) on delete cascade,
  pass_id       uuid not null,      -- SOFT ref to tenant.wallet_pass; NO FK
  device_token  text not null,      -- APNs device library identifier
  push_token    text,               -- APNs push token (worker-only)
  created_at    timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  unique (pass_id, device_token)
);

create index if not exists runtime_pass_device_pass_idx
  on runtime.pass_device (tenant_id, pass_id);

-- ===========================================================================
-- GRANTS — `runtime` is SEALED service-role machinery.
--   umi_worker  : full DML (the runtime is its working set).
--   umi_readonly: SELECT (analytics / operators).
--   umi_app     : NOTHING — 00_foundation withholds schema USAGE from umi_app for
--                 `runtime`; this REVOKE is belt-and-suspenders. NO RLS is
--                 authored here or in 90_rls.sql — runtime is out of the loop.
-- ===========================================================================
-- runtime.device_event <- device.events (device lifecycle audit: paired/unpaired/
--   offline/online/firmware). Operational audit, not a business fact — worker-only.
create table if not exists runtime.device_event (
  id           uuid not null default gen_random_uuid() primary key,
  tenant_id    uuid,                                       -- soft (device is tenant-scoped)
  device_id    uuid,                                       -- soft ref (no cross-schema FK)
  session_id   uuid,
  event_type   text not null,
  payload      jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now()
);
create index if not exists runtime_device_event_device_idx
  on runtime.device_event (device_id, occurred_at desc);

grant select on all tables in schema runtime to umi_worker, umi_readonly;
grant insert, update, delete on all tables in schema runtime to umi_worker;

alter default privileges in schema runtime
  grant select on tables to umi_worker, umi_readonly;
alter default privileges in schema runtime
  grant insert, update, delete on tables to umi_worker;

-- Belt-and-suspenders: ensure nothing leaked to the request role / public.
revoke all on all tables in schema runtime from umi_app, public;

commit;

-- =============================================================================
-- RUNTIME CONTRACT (returned to backfill + 90_rls authors)
-- -----------------------------------------------------------------------------
-- POSTURE: SEALED. umi_worker DML / umi_readonly SELECT / umi_app NOTHING. NO
--   RLS (90_rls skips `runtime`). NO append-only triggers. NO composite tenant
--   FKs. Every table carries tenant_id uuid NOT NULL references tenant.tenant(id)
--   (plain cross-seam FK) + UNIQUE(tenant_id, id) for worker-side filtering.
--
-- TABLES:
--   runtime.inbound_events    (kept from queue; UNIQUE(provider, provider_event_id))
--   runtime.outbox_events     (kept from queue; job_id now SOFT uuid — jobs dropped;
--                              UNIQUE(idempotency_key))
--   runtime.idempotency_keys  (kept from queue; UNIQUE(tenant_id, scope, key))
--   runtime.dead_letters      (kept from queue; SOFT source pointers)
--   runtime.session           (MERGE core.sessions + device.sessions; principal_type
--                              [person|user|device] + principal_id + token_hash;
--                              UNIQUE(token_hash))
--   runtime.pairing           (from device.pairing_requests; location/station SOFT;
--                              approved_by -> tenant.login FK)
--   runtime.otp               (from loyalty.otp_verifications; person_id SOFT)
--   runtime.nudge_sent        (from loyalty.lifecycle_sends; card_id SOFT;
--                              UNIQUE(tenant_id, card_id, journey))
--   runtime.conversation_turn (from comms.conversation_turns; conversation/person/
--                              assistant_message SOFT; source_message_ids[] + GIN)
--   runtime.conversation_state(NEW — cart/CAS split out of comms.conversations;
--                              UNIQUE(tenant_id, conversation_id))
--   runtime.pass_device       (from loyalty.pass_devices; pass_id SOFT;
--                              UNIQUE(pass_id, device_token))
--
-- DROPPED vs source: queue.jobs, queue.job_attempts (0 writers).
-- =============================================================================
