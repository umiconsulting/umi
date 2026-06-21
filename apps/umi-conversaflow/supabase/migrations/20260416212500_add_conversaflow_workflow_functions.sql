-- Align workflow RPCs with the runtime schema used by edge functions.
-- The edge runtime now uses DB_SCHEMA=conversaflow, so job-worker
-- must claim jobs/outbox from conversaflow.* instead of public.*.

-- Claim the next pending job. Returns 0 or 1 rows.
CREATE OR REPLACE FUNCTION conversaflow.claim_next_job(p_worker_id TEXT)
RETURNS SETOF conversaflow.jobs
LANGUAGE sql
AS $$
  UPDATE conversaflow.jobs
  SET    state = 'claimed',
         locked_at = now(),
         locked_by = p_worker_id
  WHERE  id = (
    SELECT j.id
    FROM conversaflow.jobs j
    WHERE j.state = 'pending'
      AND j.next_run_at <= now()
      AND NOT EXISTS (
        SELECT 1
        FROM conversaflow.jobs active
        WHERE active.id <> j.id
          AND active.aggregate_type = j.aggregate_type
          AND active.aggregate_id = j.aggregate_id
          AND active.state IN ('claimed', 'running')
          AND j.aggregate_type = 'conversation'
      )
    ORDER BY j.priority DESC, j.next_run_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

-- Claim a batch of deliverable outbox rows. Returns 0..p_limit rows.
CREATE OR REPLACE FUNCTION conversaflow.claim_outbox_batch(p_worker_id TEXT, p_limit INT DEFAULT 5)
RETURNS SETOF conversaflow.outbox
LANGUAGE sql
AS $$
  UPDATE conversaflow.outbox
  SET    state = 'delivering',
         attempts = attempts + 1
  WHERE  id IN (
    SELECT id FROM conversaflow.outbox
    WHERE  state = 'pending'
    AND    next_run_at <= now()
    ORDER BY next_run_at ASC
    LIMIT  p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

-- Reclaim jobs stuck in 'claimed' state for >2 minutes (worker crash recovery).
CREATE OR REPLACE FUNCTION conversaflow.reclaim_stale_jobs()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  reclaimed INT;
BEGIN
  UPDATE conversaflow.jobs
  SET    state = 'pending',
         locked_at = NULL,
         locked_by = NULL
  WHERE  state = 'claimed'
  AND    locked_at < now() - INTERVAL '2 minutes';

  GET DIAGNOSTICS reclaimed = ROW_COUNT;
  RETURN reclaimed;
END;
$$;

-- Reclaim outbox rows stuck in 'delivering' state for >2 minutes.
CREATE OR REPLACE FUNCTION conversaflow.reclaim_stale_outbox()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  reclaimed INT;
BEGIN
  UPDATE conversaflow.outbox
  SET    state = 'pending'
  WHERE  state = 'delivering'
  AND    next_run_at < now() - INTERVAL '2 minutes';

  GET DIAGNOSTICS reclaimed = ROW_COUNT;
  RETURN reclaimed;
END;
$$;
