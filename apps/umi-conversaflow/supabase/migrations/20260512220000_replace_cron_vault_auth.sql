-- Replace the cron heartbeat that embedded a hardcoded service_role JWT with a
-- Vault-backed version that reads the token at execution time.
--
-- PREREQUISITES — complete these manually BEFORE applying this migration:
--
--   1. Rotate the service_role key:
--        Supabase Dashboard → Project Settings → API → Roll service_role key
--
--   2. Store the new key in Vault:
--        SELECT vault.create_secret(
--          '<new-service-role-jwt>',
--          'service_role_key',
--          'KDS cron auth token'
--        );
--
--   3. Confirm storage (value is encrypted at rest):
--        SELECT name, created_at FROM vault.secrets WHERE name = 'service_role_key';
--
-- After applying, no recoverable privileged credential exists in migration SQL.

SELECT cron.unschedule('job-worker-heartbeat');

SELECT cron.schedule(
  'job-worker-heartbeat',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://xbudknbimkgjjgohnjgp.supabase.co/functions/v1/job-worker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'service_role_key'
      ),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);
