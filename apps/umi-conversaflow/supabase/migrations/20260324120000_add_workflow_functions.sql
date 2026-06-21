-- ── Job & Outbox claim functions for job-worker ─────────────────────────────
-- These PL/pgSQL functions use FOR UPDATE SKIP LOCKED, which is not available
-- through the Supabase JS client's query builder. Called via supabase.rpc().

-- Claim the next pending job. Returns 0 or 1 rows.
CREATE OR REPLACE FUNCTION public.claim_next_job(p_worker_id TEXT)
RETURNS SETOF public.jobs
LANGUAGE sql
AS $$
  UPDATE public.jobs
  SET    state = 'claimed',
         locked_at = now(),
         locked_by = p_worker_id
  WHERE  id = (
    SELECT id FROM public.jobs
    WHERE  state = 'pending'
    AND    next_run_at <= now()
    ORDER BY priority DESC, next_run_at ASC
    LIMIT  1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

-- Claim a batch of deliverable outbox rows. Returns 0..p_limit rows.
CREATE OR REPLACE FUNCTION public.claim_outbox_batch(p_worker_id TEXT, p_limit INT DEFAULT 5)
RETURNS SETOF public.outbox
LANGUAGE sql
AS $$
  UPDATE public.outbox
  SET    state = 'delivering',
         attempts = attempts + 1
  WHERE  id IN (
    SELECT id FROM public.outbox
    WHERE  state = 'pending'
    AND    next_run_at <= now()
    ORDER BY next_run_at ASC
    LIMIT  p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

-- Reclaim jobs stuck in 'claimed' state for >2 minutes (worker crash recovery).
-- Returns the number of reclaimed jobs.
CREATE OR REPLACE FUNCTION public.reclaim_stale_jobs()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  reclaimed INT;
BEGIN
  UPDATE public.jobs
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
-- Returns the number of reclaimed rows.
CREATE OR REPLACE FUNCTION public.reclaim_stale_outbox()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  reclaimed INT;
BEGIN
  UPDATE public.outbox
  SET    state = 'pending'
  WHERE  state = 'delivering'
  AND    next_run_at < now() - INTERVAL '2 minutes';

  GET DIAGNOSTICS reclaimed = ROW_COUNT;
  RETURN reclaimed;
END;
$$;
