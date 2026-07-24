-- ============================================================================
-- build-v3 backfill · DOMAIN: Devices, kitchen & queue   (APPROVED)
-- Source DB: umi_backfill_v3  (schemas device.*, kitchen.*, queue.*)
-- Targets:   tenant.station, tenant.device, runtime.device_session,
--            runtime.outbox_event, runtime.inbound_event, runtime.dead_letter
--
-- Adversarial review verdict: SOUND. All source tables (13) classified; all
-- CHECK remaps cover the present values; no gaps; no redundant tables.
--
-- PREREQUISITE (out of scope of this file, MUST run first):
--   tenant.branch <- core.locations  (ID-PRESERVING, like tenant.business<-core.tenants).
--   tenant.station.branch_id and tenant.device.branch_id both reference tenant.branch,
--   so location_id -> branch_id direct-copy requires branch rows with the SAME uuid as
--   core.locations.id. tenant.branch is currently EMPTY. (station.branch_id is now
--   NULLABLE — NULL means "every branch" — but the source row carries a location, so
--   the prerequisite still stands for it.)
--
-- IDs are PRESERVED so FKs resolve (device.id -> tenant.device.id, referenced by
-- runtime.device_session.device_id).
-- DO NOT RUN THE INSERTS until tenant.branch is backfilled. SELECT sides read-only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) tenant.station  <-  kitchen.stations   (1 row, status='active')
--    station_key -> key, and status / sort_order / tenant_id are CARRIED. They were
--    dropped here as "no target col", which was true and was the bug: the target
--    columns were missing, and every one of them has a live consumer in
--    kds.repository.ts (lookup by key, soft delete by status, board order by
--    sort_order, and a tenant scope that no longer has to go through branch).
--    DROP: metadata ({}) — an empty jsonb junk drawer the naming rules forbid.
-- ----------------------------------------------------------------------------
insert into tenant.station (id, business_id, branch_id, key, name, status, sort_order,
                            created_at, updated_at)
select s.id,
       s.tenant_id              as business_id,  -- business id preserved from core.tenants
       s.location_id            as branch_id,    -- requires tenant.branch(id=location_id)
       s.station_key            as key,
       s.name,
       s.status,
       s.sort_order,
       s.created_at,
       s.updated_at
from kitchen.stations s;

-- ----------------------------------------------------------------------------
-- 2) tenant.device  <-  device.devices   (1 row, device_type='kds', status='active')
--    kind: source device_type 'kds' fits check ('kds','pos_terminal').
--    status: 'active'->'active'; source ('disabled','archived')->'retired' (none present).
--    DROP: station_id (single station, re-selected at KDS login; no target col),
--          device_subtype/manufacturer/model/connection_type (all NULL),
--          metadata ({}), tenant_id (business reached via business_id).
-- ----------------------------------------------------------------------------
insert into tenant.device (id, business_id, branch_id, name, kind, status,
                           registered_at, created_at)
select d.id,
       d.tenant_id              as business_id,   -- business id preserved from core.tenants
       d.location_id            as branch_id,     -- requires tenant.branch(id=location_id)
       d.name,
       d.device_type            as kind,          -- 'kds' -> ok
       case d.status
         when 'active' then 'active'
         else 'retired'                           -- disabled/archived -> retired
       end                      as status,
       d.created_at             as registered_at,
       d.created_at
from device.devices d;

-- ----------------------------------------------------------------------------
-- 3) runtime.device_session  <-  device.sessions   (1 row, is_active=true)
--    Read-back: worker reads to authorize a live device -> runtime, not tenant.
--    is_active=true -> revoked_at NULL.  No source expires_at -> NULL.
--    DROP: tenant_id (runtime is not tenant-scoped), station_id, device_name,
--          metadata (redundant location_id, already on device.branch).
-- ----------------------------------------------------------------------------
insert into runtime.device_session (id, device_id, token_hash, paired_at,
                                    expires_at, last_seen_at, revoked_at, created_at)
select se.id,
       se.device_id,                              -- FK -> tenant.device.id (preserved)
       se.token_hash,
       se.created_at            as paired_at,
       null::timestamptz        as expires_at,
       se.last_used_at,
       case when se.is_active then null else se.created_at end as revoked_at,
       se.created_at
from device.sessions se;

-- ----------------------------------------------------------------------------
-- 4) runtime.outbox_event  <-  queue.outbox_events   (417 rows: delivered=415, dead=2)
--    status remap: delivered->sent, dead->failed, delivering->pending,
--                  pending->pending, failed->failed.
--    next_attempt_at only meaningful while pending (none pending here -> NULL).
--    DROP: tenant_id, job_id (BullMQ, dropped), aggregate_id, idempotency_key,
--          max_attempts, error (target has no col; failure detail is telemetry).
-- ----------------------------------------------------------------------------
-- DROPPED (security audit 2026-07-12): 417 historical outbox events (415 delivered,
--   2 dead) are PAST work — nothing reads them back to act, so by the read-back
--   principle they are telemetry, not runtime state — and their payloads carry raw
--   customer phone/message PII into a sealed, unscoped schema. Runtime starts clean at
--   cutover; the live queue regenerates. (was: insert into runtime.outbox_event ...)

-- ----------------------------------------------------------------------------
-- 5) runtime.inbound_event  <-  queue.inbound_events   (395 rows, all 'accepted')
--    Read-back: worker reads (provider, external_id) to dedup re-delivered webhooks.
--    status remap: accepted->received, processing->received,
--                  completed->processed, duplicate->processed, failed->failed.
--    external_id <- provider_event_id (all 395 present, distinct -> unique index safe).
--    created_at <- received_at (source has no created_at).
--    DROP: tenant_id, event_type (re-derivable from payload), payload_hash,
--          request_id, error.
-- ----------------------------------------------------------------------------
-- DROPPED (security audit 2026-07-12): 395 historical inbound webhooks, all already
--   processed. The only read-back use is (provider, external_id) dedup of RE-delivered
--   webhooks — providers never re-deliver months-old events, so the value is nil while
--   the full payloads carry raw customer PII into unscoped runtime. Dedup starts fresh
--   at cutover. (was: insert into runtime.inbound_event ...)

-- ----------------------------------------------------------------------------
-- 6) runtime.dead_letter  <-  queue.dead_letters   (1 row, unresolved)
--    Read-back: surfaced as an unresolved-failure to operators. Row unresolved.
--    source <- 'source_schema.source_table:event_type' (e.g. 'bullmq.turns:turn.process').
--    DROP: tenant_id, source_id, attempts, resolved_at (row is unresolved -> NULL).
-- ----------------------------------------------------------------------------
-- DROPPED (security audit 2026-07-12): 1 stale unresolved dead-letter from the OLD
--   BullMQ pipeline; its payload carries PII and it is not actionable in the new
--   runtime. Operators track live failures post-cutover. (was: insert into runtime.dead_letter ...)

-- ============================================================================
-- DROPPED (no insert; recorded for the ledger):
--   device.pairing_requests (6 terminal rows: used/expired/denied) — consumed
--       pairing scratch; runtime.pairing.device_id is NOT NULL but source has no
--       device_id (device is created AFTER approval) -> structurally un-mappable.
--   device.events (0) — device telemetry, write-once, nothing reads back -> OTel.
--   kitchen.station_assignments (0) — product->station routing config; per-order
--       routing lives on tenant.order_item.station_id.
--   kitchen.station_groups (0) — station grouping; no three-schema home.
--   queue.idempotency_keys (0) — would MAP to runtime.idempotency_key if populated.
--   queue.jobs (2860) / queue.job_attempts (2763) — BullMQ job/attempt state
--       (redis-queue): ephemeral, re-queued, not a business fact.
-- ============================================================================

-- ============================================================================
-- RECONCILE  (run AFTER inserts)
-- ============================================================================
-- select (select count(*) from kitchen.stations)      as src_station,   (select count(*) from tenant.station)          as tgt_station;   -- 1/1
-- select (select count(*) from device.devices)        as src_device,    (select count(*) from tenant.device)           as tgt_device;    -- 1/1
-- select (select count(*) from device.sessions)       as src_session,   (select count(*) from runtime.device_session)  as tgt_session;   -- 1/1
-- select (select count(*) from queue.outbox_events)   as src_outbox,    (select count(*) from runtime.outbox_event)    as tgt_outbox;    -- 417/417
-- select (select count(*) from queue.inbound_events)  as src_inbound,   (select count(*) from runtime.inbound_event)   as tgt_inbound;   -- 395/395
-- select (select count(*) from queue.dead_letters)    as src_dl,        (select count(*) from runtime.dead_letter)     as tgt_dl;        -- 1/1
-- -- status distribution sanity:
-- select status, count(*) from runtime.outbox_event group by 1;   -- expect sent=415, failed=2
-- select status, count(*) from runtime.inbound_event group by 1;  -- expect received=395
-- No money/stamp sums in this domain.
