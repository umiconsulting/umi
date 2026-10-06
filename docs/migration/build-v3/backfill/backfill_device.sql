-- ============================================================================
-- build-v3 backfill · DOMAIN: Devices, kitchen & queue   (APPROVED)
-- Source DB: umi_backfill_v3  (schemas device.*, kitchen.*, queue.*)
-- Targets:   merchant.station, merchant.device, runtime.session,
--            runtime.outbox_event, runtime.inbound_event, runtime.dead_letter
--
-- Adversarial review verdict: SOUND. All source tables (13) classified; all
-- CHECK remaps cover the present values; no gaps; no redundant tables.
--
-- PREREQUISITE (out of scope of this file, MUST run first):
--   merchant.location <- core.locations  (ID-PRESERVING, like merchant.merchant<-core.tenants).
--   merchant.station.location_id and merchant.device.location_id both reference merchant.location,
--   so location_id -> location_id direct-copy requires location rows with the SAME uuid as
--   core.locations.id. merchant.location is currently EMPTY. (station.location_id is now
--   NULLABLE — NULL means "every location" — but the source row carries a location, so
--   the prerequisite still stands for it.)
--
-- IDs are PRESERVED so FKs resolve (device.id -> merchant.device.id, referenced by
-- runtime.session.principal_id — a soft ref for principal_type='device').
-- DO NOT RUN THE INSERTS until merchant.location is backfilled. SELECT sides read-only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) merchant.station  <-  kitchen.stations   (1 row, status='active')
--    station_key -> key, and status / sort_order / tenant_id are CARRIED. They were
--    dropped here as "no target col", which was true and was the bug: the target
--    columns were missing, and every one of them has a live consumer in
--    kds.repository.ts (lookup by key, soft delete by status, board order by
--    sort_order, and a merchant scope that no longer has to go through location).
--    DROP: metadata ({}) — an empty jsonb junk drawer the naming rules forbid.
-- ----------------------------------------------------------------------------
insert into merchant.station (id, merchant_id, location_id, key, name, status, sort_order,
                            created_at, updated_at)
select s.id,
       s.tenant_id              as merchant_id,  -- merchant id preserved from core.tenants
       s.location_id            as location_id,    -- requires merchant.location(id=location_id)
       s.station_key            as key,
       s.name,
       s.status,
       s.sort_order,
       s.created_at,
       s.updated_at
from kitchen.stations s;

-- ----------------------------------------------------------------------------
-- 2) merchant.device  <-  device.devices   (1 row, device_type='kds', status='active')
--    kind: source device_type 'kds' fits check ('kds','pos_terminal').
--    status: 'active'->'active'; source ('disabled','archived')->'retired' (none present).
--    station_id: CARRIED now that merchant.device has the column (was dropped as "no
--          target col" — the same thin-table bug the station backfill fixed).
--    DROP: device_subtype/manufacturer/model/connection_type (all NULL),
--          metadata ({}), tenant_id (merchant reached via merchant_id).
-- ----------------------------------------------------------------------------
insert into merchant.device (id, merchant_id, location_id, station_id, name, kind, status,
                           registered_at, created_at, updated_at)
select d.id,
       d.tenant_id              as merchant_id,   -- merchant id preserved from core.tenants
       d.location_id            as location_id,     -- requires merchant.location(id=location_id)
       d.station_id,                              -- device's home station
       d.name,
       d.device_type            as kind,          -- 'kds' -> ok
       case d.status
         when 'active' then 'active'
         else 'retired'                           -- disabled/archived -> retired
       end                      as status,
       d.created_at             as registered_at,
       d.created_at,
       d.updated_at
from device.devices d;

-- ----------------------------------------------------------------------------
-- 3) runtime.session (principal_type='device')  <-  device.sessions   (1 row, is_active=true)
--    A device's live credential is a runtime.session row, NOT a separate table
--    (device_session was speculative and had no reader; deleted). The token_hash is
--    CARRIED so the incumbent iPad rides through cutover without re-pairing — the
--    failure this closes was delayed, not absent: it would have gone dark on the next
--    app reinstall. principal_id = device_id (soft ref -> merchant.device.id, preserved).
--    location_id is parked in metadata exactly as kds.repository.ts writes it, so the
--    device list's `metadata->>'location_id'` filter resolves. No source expires_at ->
--    NULL (a device token does not expire; revoke sets is_active=false).
--    DROP: tenant_id (merchant_id is carried explicitly).
-- ----------------------------------------------------------------------------
insert into runtime.session (id, merchant_id, principal_type, principal_id, token_hash,
                             station_id, device_name, is_active, metadata,
                             revoked_at, revoked_reason,
                             last_used_at, created_at)
select se.id,                                     -- preserved: the device_id the iPad already holds
       se.tenant_id             as merchant_id,
       'device'                 as principal_type,
       se.device_id             as principal_id,   -- soft ref -> merchant.device.id (preserved)
       se.token_hash,
       se.station_id,
       se.device_name,
       se.is_active,
       coalesce(se.metadata, '{}'::jsonb) || jsonb_build_object('location_id', d.location_id::text),
       -- `is_active` and `revoked_at` are ONE fact, and session_revocation_ck enforces
       -- it: an inactive session must carry a revocation time. The source has only the
       -- boolean, so last_used_at stands in for "when it stopped being usable" — the
       -- same substitution this backfill already makes for is_cancelled -> voided_at.
       -- The reason names it as a migration artifact rather than pretending we know why.
       case when se.is_active then null
            else coalesce(se.last_used_at, se.created_at) end   as revoked_at,
       case when se.is_active then null
            else 'migrated_inactive' end                        as revoked_reason,
       se.last_used_at,
       se.created_at
from device.sessions se
join device.devices d on d.id = se.device_id;

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
--       pairing scratch, all expired 11 days pre-snapshot. runtime.pairing.device_id
--       is now NULLABLE (the device is the pairing's OUTCOME), so the shape no longer
--       blocks them — they are dropped as TERMINAL, not as un-mappable. Go-forward
--       pairings mint fresh.
--   device.events (0) — device telemetry, write-once, nothing reads back -> OTel.
--   kitchen.station_assignments (0) — product->station routing config; per-order
--       routing lives on merchant.order_item.station_id.
--   kitchen.station_groups (0) — station grouping; no three-schema home.
--   queue.idempotency_keys (0) — would MAP to runtime.idempotency_key if populated.
--   queue.jobs (2860) / queue.job_attempts (2763) — BullMQ job/attempt state
--       (redis-queue): ephemeral, re-queued, not a merchant fact.
-- ============================================================================

-- ============================================================================
-- RECONCILE  (run AFTER inserts)
-- ============================================================================
-- select (select count(*) from kitchen.stations)      as src_station,   (select count(*) from merchant.station)          as tgt_station;   -- 1/1
-- select (select count(*) from device.devices)        as src_device,    (select count(*) from merchant.device)           as tgt_device;    -- 1/1
-- select (select count(*) from device.sessions)       as src_session,   (select count(*) from runtime.device_session)  as tgt_session;   -- 1/1
-- select (select count(*) from queue.outbox_events)   as src_outbox,    (select count(*) from runtime.outbox_event)    as tgt_outbox;    -- 417/417
-- select (select count(*) from queue.inbound_events)  as src_inbound,   (select count(*) from runtime.inbound_event)   as tgt_inbound;   -- 395/395
-- select (select count(*) from queue.dead_letters)    as src_dl,        (select count(*) from runtime.dead_letter)     as tgt_dl;        -- 1/1
-- -- status distribution sanity:
-- select status, count(*) from runtime.outbox_event group by 1;   -- expect sent=415, failed=2
-- select status, count(*) from runtime.inbound_event group by 1;  -- expect received=395
-- No money/stamp sums in this domain.
