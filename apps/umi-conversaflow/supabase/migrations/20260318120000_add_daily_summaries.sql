CREATE TABLE IF NOT EXISTS public.daily_summaries (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     TEXT        NOT NULL,
  summary_date    DATE        NOT NULL,
  slack_channel   TEXT        NOT NULL,
  slack_message_ts TEXT,
  pinned          BOOLEAN     NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, summary_date)
);

CREATE INDEX IF NOT EXISTS daily_summaries_business_date_idx
  ON public.daily_summaries (business_id, summary_date DESC);
