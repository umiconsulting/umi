-- Replace the 1-minute cron heartbeat with a DB trigger that fires the
-- job-worker the instant an interactive job is inserted.
--
-- The cron approach was a polling fallback. For a conversational bot the
-- 0-60s wait before a worker tick was the dominant latency source.
-- A trigger on INSERT fires synchronously inside the same transaction via
-- pg_net's async queue — guaranteed, no waitUntil, no edge runtime teardown.
--
-- The cron stays as a safety net for stale/stuck jobs (crash recovery),
-- but is no longer in the critical path for new messages.

-- ── 1. Trigger function ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION conversaflow.wake_job_worker_on_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://xbudknbimkgjjgohnjgp.supabase.co/functions/v1/job-worker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'service_role_key'
        LIMIT 1
      ),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  );
  RETURN NEW;
END;
$$;

-- ── 2. Trigger — interactive jobs only (turn.integrity, turn.process) ───────
-- priority >= 100 keeps background enrichment jobs (priority = -10) from
-- spawning unnecessary worker invocations on every embed or summarize insert.

DROP TRIGGER IF EXISTS trg_wake_job_worker ON conversaflow.jobs;

CREATE TRIGGER trg_wake_job_worker
  AFTER INSERT ON conversaflow.jobs
  FOR EACH ROW
  WHEN (NEW.state = 'pending' AND NEW.priority >= 100)
  EXECUTE FUNCTION conversaflow.wake_job_worker_on_insert();

-- ── 3. Keep cron as crash-recovery safety net only ─────────────────────────
-- The cron now exists only to reclaim stale locks from crashed workers,
-- not to drive normal message flow. Reduce noise by keeping it at 1 minute.
-- (No change needed — existing job-worker-heartbeat schedule is fine as a net.)
