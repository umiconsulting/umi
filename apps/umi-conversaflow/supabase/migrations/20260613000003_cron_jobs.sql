-- S4.4: pg_cron schedules for cash cron jobs.
-- The workflow_jobs table already exists (created in 20260613000000).
-- These schedules insert into the existing table with the correct schema.
-- The job-worker picks them up via the existing claim infrastructure.

-- ============================================================================
-- 1. RPC helpers — cross-schema queries for cash cron processors
-- ============================================================================

-- Birthday-eligible cards: users whose birth month matches, no reward this year.
CREATE OR REPLACE FUNCTION conversaflow.get_birthday_eligible_cards(
  p_tenant_id TEXT,
  p_month INT,
  p_year INT
)
RETURNS TABLE(card_id TEXT)
LANGUAGE sql STABLE AS $$
  SELECT lc.id AS card_id
  FROM umi_cash."User" u
  JOIN umi_cash."LoyaltyCard" lc ON lc."userId" = u.id
  WHERE u."tenantId" = p_tenant_id
    AND u."birthDate" IS NOT NULL
    AND u.role = 'CUSTOMER'
    AND EXTRACT(MONTH FROM u."birthDate") = p_month
    AND NOT EXISTS (
      SELECT 1 FROM umi_cash."BirthdayReward" br
      WHERE br."loyaltyCardId" = lc.id
        AND br."tenantId" = p_tenant_id
        AND br.year = p_year
    );
$$;

-- Streak cards: cards with visits in each of the last N ISO weeks.
CREATE OR REPLACE FUNCTION conversaflow.get_streak_cards(p_weeks INT)
RETURNS TABLE(card_id TEXT)
LANGUAGE sql STABLE AS $$
  SELECT lc.id AS card_id
  FROM umi_cash."LoyaltyCard" lc
  JOIN umi_cash."Tenant" t ON t.id = lc."tenantId"
  WHERE t."subscriptionStatus" = 'ACTIVE'
    AND p_weeks = (
      SELECT COUNT(DISTINCT DATE_TRUNC('week', v."scannedAt"))
      FROM umi_cash."Visit" v
      WHERE v."cardId" = lc.id
        AND v."scannedAt" >= DATE_TRUNC('week', NOW()) - ((p_weeks - 1) || ' weeks')::interval
    );
$$;

-- Winback cards: most recent visit in the target day window, no later visits.
CREATE OR REPLACE FUNCTION conversaflow.get_winback_cards(p_days INT)
RETURNS TABLE(card_id TEXT)
LANGUAGE sql STABLE AS $$
  SELECT lc.id AS card_id
  FROM umi_cash."LoyaltyCard" lc
  JOIN umi_cash."Tenant" t ON t.id = lc."tenantId"
  WHERE t."subscriptionStatus" = 'ACTIVE'
    AND lc."totalVisits" > 0
    AND EXISTS (
      SELECT 1 FROM umi_cash."Visit" v
      WHERE v."cardId" = lc.id
        AND v."scannedAt" >= NOW() - ((p_days + 1) || ' days')::interval
        AND v."scannedAt" < NOW() - (p_days || ' days')::interval
    )
    AND NOT EXISTS (
      SELECT 1 FROM umi_cash."Visit" v2
      WHERE v2."cardId" = lc.id
        AND v2."scannedAt" >= NOW() - (p_days || ' days')::interval
    );
$$;

-- ============================================================================
-- 2. pg_cron schedules — mirror vercel.json cron frequencies
-- ============================================================================
-- Using the Kalala tenant UUID from platform.tenants since cash cron
-- jobs span tenants and need a valid tenant_id FK.

-- cleanup-sessions — daily at 04:00 UTC (pure SQL, no worker)
SELECT cron.schedule(
  'cash-cleanup-sessions',
  '0 4 * * *',
  $$ DELETE FROM umi_cash."Session" WHERE "expiresAt" < now(); $$
);

-- birthday-rewards — daily at 13:00 UTC
SELECT cron.schedule('cash-birthday-rewards', '0 13 * * *', $$
  INSERT INTO conversaflow.workflow_jobs (tenant_id, job_type, aggregate_type, payload, state)
  SELECT id, 'birthday_rewards', 'cash_cron', '{}', 'pending'
  FROM platform.tenants WHERE status = 'active';
$$);

-- expire-birthday-rewards — daily at 06:00 UTC
SELECT cron.schedule('cash-expire-birthday-rewards', '0 6 * * *', $$
  INSERT INTO conversaflow.workflow_jobs (tenant_id, job_type, aggregate_type, payload, state)
  SELECT id, 'expire_birthday_rewards', 'cash_cron', '{}', 'pending'
  FROM platform.tenants WHERE status = 'active';
$$);

-- goal-proximity — daily at 16:00 UTC
SELECT cron.schedule('cash-goal-proximity', '0 16 * * *', $$
  INSERT INTO conversaflow.workflow_jobs (tenant_id, job_type, aggregate_type, payload, state)
  SELECT id, 'goal_proximity', 'cash_cron', '{}', 'pending'
  FROM platform.tenants WHERE status = 'active';
$$);

-- reward-expiring — daily at 14:00 UTC
SELECT cron.schedule('cash-reward-expiring', '0 14 * * *', $$
  INSERT INTO conversaflow.workflow_jobs (tenant_id, job_type, aggregate_type, payload, state)
  SELECT id, 'reward_expiring', 'cash_cron', '{}', 'pending'
  FROM platform.tenants WHERE status = 'active';
$$);

-- streak-recognition — weekly Monday at 18:00 UTC
SELECT cron.schedule('cash-streak-recognition', '0 18 * * 1', $$
  INSERT INTO conversaflow.workflow_jobs (tenant_id, job_type, aggregate_type, payload, state)
  SELECT id, 'streak_recognition', 'cash_cron', '{}', 'pending'
  FROM platform.tenants WHERE status = 'active';
$$);

-- welcome-no-visit — daily at 17:00 UTC
SELECT cron.schedule('cash-welcome-no-visit', '0 17 * * *', $$
  INSERT INTO conversaflow.workflow_jobs (tenant_id, job_type, aggregate_type, payload, state)
  SELECT id, 'welcome_no_visit', 'cash_cron', '{}', 'pending'
  FROM platform.tenants WHERE status = 'active';
$$);

-- winback-inactive — daily at 17:30 UTC
SELECT cron.schedule('cash-winback-inactive', '30 17 * * *', $$
  INSERT INTO conversaflow.workflow_jobs (tenant_id, job_type, aggregate_type, payload, state)
  SELECT id, 'winback_inactive', 'cash_cron', '{}', 'pending'
  FROM platform.tenants WHERE status = 'active';
$$);

-- ============================================================================
-- 3. Claim function — worker uses this to pick up workflow jobs
-- ============================================================================

CREATE OR REPLACE FUNCTION conversaflow.claim_next_workflow_job(p_worker_id TEXT)
RETURNS SETOF conversaflow.workflow_jobs
LANGUAGE sql
AS $$
  UPDATE conversaflow.workflow_jobs
  SET    state = 'running',
         locked_at = now(),
         locked_by = p_worker_id
  WHERE  id = (
    SELECT id
    FROM conversaflow.workflow_jobs
    WHERE state = 'pending'
    ORDER BY priority DESC, next_run_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;
