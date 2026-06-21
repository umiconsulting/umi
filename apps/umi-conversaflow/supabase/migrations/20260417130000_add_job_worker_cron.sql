-- Heartbeat cron that polls job-worker every minute.
-- This is the reliable safety net when triggerJobWorker() from inside
-- EdgeRuntime.waitUntil doesn't complete (runtime timeout / cold start).

SELECT cron.schedule(
  'job-worker-heartbeat',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://xbudknbimkgjjgohnjgp.supabase.co/functions/v1/job-worker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ***REMOVED***',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
