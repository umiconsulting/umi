-- Pipeline trace table: one row per stage event, indexed by trace_id (= request_id).
-- Query pattern: SELECT * FROM pipeline_traces WHERE conversation_id = '<id>' ORDER BY ts;
-- Replaces the debugLog-to-security_logs hack in turn-integrity.ts.

CREATE TABLE IF NOT EXISTS public.pipeline_traces (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id        TEXT        NOT NULL,
  conversation_id UUID,
  turn_id         UUID,
  business_id     TEXT,
  stage           TEXT        NOT NULL,
  event           TEXT        NOT NULL,
  detail          JSONB,
  error           TEXT,
  ts              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary lookup: "what happened to this request?"
CREATE INDEX IF NOT EXISTS pipeline_traces_trace_id_idx
  ON public.pipeline_traces (trace_id);

-- Dashboard lookup: "show me the lifecycle for this conversation turn"
CREATE INDEX IF NOT EXISTS pipeline_traces_conversation_ts_idx
  ON public.pipeline_traces (conversation_id, ts DESC)
  WHERE conversation_id IS NOT NULL;

-- Link from turn record to its trace events
CREATE INDEX IF NOT EXISTS pipeline_traces_turn_id_idx
  ON public.pipeline_traces (turn_id)
  WHERE turn_id IS NOT NULL;

-- Alert surface: "show me all delivery failures in the last hour"
CREATE INDEX IF NOT EXISTS pipeline_traces_failures_idx
  ON public.pipeline_traces (ts DESC)
  WHERE event IN ('failed', 'dead');

COMMENT ON TABLE public.pipeline_traces IS
'Lifecycle trace for each inbound message through the pipeline stages: inbound → integrity → process → dispatch. One row per stage event. trace_id = request_id from whatsapp-handler, propagated through job payloads and outbox payload so every stage is correlatable.';

COMMENT ON COLUMN public.pipeline_traces.trace_id IS
'Correlation key = request_id assigned at whatsapp-handler ingress. Propagated through turn.integrity payload → turn.process payload → twilio.reply outbox payload → dispatcher.';

COMMENT ON COLUMN public.pipeline_traces.stage IS
'Pipeline stage: inbound | integrity | process | dispatch';

COMMENT ON COLUMN public.pipeline_traces.event IS
'Stage event: enqueued | skipped | failed | started | decision | completed | superseded | delivered | dead';
