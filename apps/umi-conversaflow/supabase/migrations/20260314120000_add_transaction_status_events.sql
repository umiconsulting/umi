-- Phase-2 instrumentation table for order lifecycle analytics.
-- NOT used in MVP. Populate this via a trigger or explicit inserts once
-- the App Home workflow is validated and latency metrics are needed.

CREATE TABLE IF NOT EXISTS public.transaction_status_events (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id       UUID        NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  old_status           TEXT,
  new_status           TEXT        NOT NULL,
  acted_by_slack_user  TEXT,       -- Slack user_id of the staff member who triggered the change
  acted_in_channel     TEXT,       -- Slack channel_id where the button was clicked (if available)
  acted_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transaction_status_events_txn_idx
  ON public.transaction_status_events (transaction_id, acted_at DESC);

CREATE INDEX IF NOT EXISTS transaction_status_events_acted_at_idx
  ON public.transaction_status_events (acted_at DESC);

COMMENT ON TABLE public.transaction_status_events IS
'Phase-2 event log for order status transitions. Used to compute accept latency, prep latency, and per-staff performance once the App Home workflow is validated.';

COMMENT ON COLUMN public.transaction_status_events.acted_by_slack_user IS
'Slack user_id from the payload.user.id field in the block_actions or view_submission payload.';

COMMENT ON COLUMN public.transaction_status_events.acted_in_channel IS
'Slack channel_id from payload.channel.id. Only available for button actions in channel messages, not from App Home views.';
