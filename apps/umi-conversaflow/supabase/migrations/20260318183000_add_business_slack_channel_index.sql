CREATE UNIQUE INDEX IF NOT EXISTS businesses_slack_channel_id_unique_idx
  ON public.businesses ((config->>'slack_channel_id'))
  WHERE coalesce(config->>'slack_channel_id', '') <> '';

COMMENT ON INDEX public.businesses_slack_channel_id_unique_idx IS
'Ensures each Slack channel maps to at most one business tenant.';
