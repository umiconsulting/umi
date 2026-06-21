CREATE TABLE IF NOT EXISTS public.business_config_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT NOT NULL,
  slack_user_id TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  previous_config JSONB,
  new_config JSONB
);

CREATE INDEX IF NOT EXISTS business_config_changes_business_id_idx
  ON public.business_config_changes (business_id, changed_at DESC);

COMMENT ON TABLE public.business_config_changes IS
'Audit trail for business config changes made via Slack settings modal.';
