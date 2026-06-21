-- Keep WhatsApp turn processing ahead of background enrichment work.
--
-- The previous claim policy used only priority/next_run_at and all jobs were
-- inserted at priority 0. A burst of post-response background jobs could
-- therefore make a new turn.integrity job sit pending behind older work.

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
          AND j.job_type IN ('turn.integrity', 'turn.process')
          AND active.job_type IN ('turn.integrity', 'turn.process')
      )
    ORDER BY j.priority DESC, j.next_run_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

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
  WHERE  state IN ('claimed', 'running')
  AND    locked_at < now() - INTERVAL '2 minutes';

  GET DIAGNOSTICS reclaimed = ROW_COUNT;
  RETURN reclaimed;
END;
$$;
