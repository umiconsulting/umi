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
      -- Service-role key is read from Vault — never hardcode it here.
      -- Provision once with:
      --   select vault.create_secret('<service-role-key>', 'service_role_key');
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
