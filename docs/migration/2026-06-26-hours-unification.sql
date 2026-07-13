-- =============================================================================
-- Hours unification — DB layer (Phase 3, ConversaFlow bot)
-- Date: 2026-06-26
-- Status: APPLIED to the LIVE platform DB (Supabase xbudknbimkgjjgohnjgp) on
--         2026-06-27 via the Supabase CLI (owner-authorized), after a read-only
--         preflight. Result: Part 1 index created; 2a no-op (no differing tz —
--         Kalala already America/Mazatlan); 2b seeded Kalala Café (7 rows at the
--         oldest-active location "Congreso"); 2b-bis no-op (table was empty).
--         NOTE: db query uses the extended protocol (one command per call), so
--         2b was run as the single INSERT statement; the BEGIN..COMMIT wrapper is
--         for psql/SQL-editor use. Re-running is safe (index IF NOT EXISTS; 2b
--         only seeds zero-row tenants).
-- -----------------------------------------------------------------------------
-- This is the DB third of a DB + app + api refactor that makes business hours
-- (and the ordering-window settings the WhatsApp bot needs) tenant-configurable
-- from the dashboard, with ONE canonical source feeding both the dashboard and
-- the bot:
--   * weekly hours -> ops.business_hours          (per-day rows; already live)
--   * timezone     -> core.tenants.timezone        (already live)
--   * ordering     -> ops.businesses.config jsonb  (already live)
-- No new columns are required. This script adds (1) a one-row-per-day integrity
-- index that makes ops.business_hours a TRUE single source of truth, and (2) the
-- one-time data backfill so tenants configured only via the legacy
-- ops.businesses.config blob don't read as "closed" / tz-shifted the moment the
-- bot stops reading the legacy fields.
--
-- ⚠️ TARGETS THE LIVE CANONICAL SHAPE: ops.business_hours is per-day rows
--    (tenant_id, location_id, day_of_week 0=Sun..6=Sat, opens_at time,
--    closes_at time, is_closed) — confirmed by the working HoursRepository and
--    the live dashboard. The local-replica script
--    docs/migration/local-postgres/002_commerce_core.sql defines a DIFFERENT,
--    pre-rename shape (commerce.business_hours with a weekly_hours jsonb) and is
--    STALE for this table — do not use it as the reference.
-- =============================================================================


-- ── PART 1 — schema integrity (run FIRST, standalone, NOT in a transaction) ─────
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block. It also fails
-- if duplicate (tenant, location, day) rows already exist, so pre-check:
--
--   SELECT tenant_id, location_id, day_of_week, count(*)
--     FROM ops.business_hours
--    GROUP BY 1,2,3 HAVING count(*) > 1;   -- must return 0 rows
--
-- location_id is nullable and NULLs are distinct in a plain unique index, so use
-- an expression index over COALESCE(location_id, zero-uuid) to guarantee one row
-- per day even for location-less (tenant-wide) hours.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ops_business_hours_tenant_loc_dow_uniq
  ON ops.business_hours
     (tenant_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid), day_of_week);


-- ── PART 2 — one-time data backfill (run in a transaction, then verify) ─────────
BEGIN;

-- 2a. Timezone: copy config.timezone -> core.tenants.timezone where it differs.
UPDATE core.tenants t
   SET timezone   = b.config->>'timezone',
       updated_at = now()
  FROM ops.businesses b
 WHERE b.tenant_id = t.id
   AND COALESCE(b.config->>'timezone', '') <> ''
   AND b.config->>'timezone' IS DISTINCT FROM t.timezone;

-- 2b. Weekly hours: legacy config.hours (weekday-name blob) -> ops.business_hours.
--     Seeds at the SAME location the dashboard + bot resolve — the OLDEST active
--     location (created_at, then id), tenant-neutral (no hardcoded branch name);
--     NULL when the tenant has no active location. Only seeds tenants with NO
--     existing rows (never clobbers dashboard-set hours).
WITH default_loc AS (
  SELECT DISTINCT ON (tenant_id) tenant_id, id AS location_id
    FROM core.locations
   WHERE status = 'active'
   ORDER BY tenant_id, created_at ASC, id ASC
),
src AS (
  SELECT b.tenant_id,
         dl.location_id,
         b.config->'hours' AS hours
    FROM ops.businesses b
    LEFT JOIN default_loc dl ON dl.tenant_id = b.tenant_id
   WHERE b.config ? 'hours'
     AND jsonb_typeof(b.config->'hours') = 'object'
     AND NOT EXISTS (
       SELECT 1 FROM ops.business_hours bh WHERE bh.tenant_id = b.tenant_id
     )
),
days(name, dow) AS (
  VALUES ('sunday', 0), ('monday', 1), ('tuesday', 2), ('wednesday', 3),
         ('thursday', 4), ('friday', 5), ('saturday', 6)
)
INSERT INTO ops.business_hours
  (tenant_id, location_id, day_of_week, opens_at, closes_at, is_closed)
SELECT s.tenant_id,
       s.location_id,
       d.dow,
       NULLIF(s.hours->d.name->>'open',  '')::time,
       NULLIF(s.hours->d.name->>'close', '')::time,
       COALESCE((s.hours->d.name->>'closed')::boolean, false)
         OR (s.hours->d.name) IS NULL
         OR NULLIF(s.hours->d.name->>'open', '') IS NULL
  FROM src s
 CROSS JOIN days d;

-- 2b-bis. EXISTING tenants whose rows live at a location OTHER than the
--     now-canonical OLDEST-active location. Resolution moved from the legacy
--     Chapultepec-first pick to oldest-active, so such a tenant has rows — and so
--     2b skips it — yet the bot now resolves a location with NO rows and would
--     read "closed". Project the legacy rows onto the resolved location.
--     ADDITIVE ONLY: inserts a (tenant, resolved-location, day) row only when that
--     day isn't already present at the resolved location, so dashboard-set hours
--     are never overwritten. DISTINCT ON guarantees one source row per day.
WITH default_loc AS (
  SELECT DISTINCT ON (tenant_id) tenant_id, id AS location_id
    FROM core.locations
   WHERE status = 'active'
   ORDER BY tenant_id, created_at ASC, id ASC
),
source_rows AS (
  SELECT DISTINCT ON (bh.tenant_id, bh.day_of_week)
         bh.tenant_id,
         dl.location_id AS target_location,
         bh.day_of_week, bh.opens_at, bh.closes_at, bh.is_closed
    FROM ops.business_hours bh
    JOIN default_loc dl ON dl.tenant_id = bh.tenant_id
   WHERE bh.location_id IS DISTINCT FROM dl.location_id
   ORDER BY bh.tenant_id, bh.day_of_week, bh.location_id
)
INSERT INTO ops.business_hours
  (tenant_id, location_id, day_of_week, opens_at, closes_at, is_closed)
SELECT sr.tenant_id, sr.target_location, sr.day_of_week, sr.opens_at, sr.closes_at, sr.is_closed
  FROM source_rows sr
 WHERE NOT EXISTS (
   SELECT 1 FROM ops.business_hours bh2
    WHERE bh2.tenant_id = sr.tenant_id
      AND bh2.location_id IS NOT DISTINCT FROM sr.target_location
      AND bh2.day_of_week = sr.day_of_week
 );

-- 2c. VERIFY before COMMIT (run, eyeball against the conversaflow tenant):
--   SELECT id, name, timezone FROM core.tenants WHERE id = '<conversaflow-tenant>';
--   SELECT day_of_week, opens_at, closes_at, is_closed FROM ops.business_hours
--    WHERE tenant_id = '<conversaflow-tenant>' ORDER BY day_of_week;
--   SELECT config->'hours' FROM ops.businesses WHERE tenant_id = '<conversaflow-tenant>';
--   -- the seeded location should equal the oldest active location:
--   SELECT id, name, created_at FROM core.locations
--    WHERE tenant_id = '<conversaflow-tenant>' AND status = 'active'
--    ORDER BY created_at ASC, id ASC LIMIT 1;

-- COMMIT;    -- uncomment once verified
-- ROLLBACK;  -- otherwise
