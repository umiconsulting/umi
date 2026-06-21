CREATE TABLE IF NOT EXISTS conversaflow.eval_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  turn_id UUID,
  business_id UUID,
  turn_sequence INTEGER,
  authoritative_decision JSONB,
  harness_decision JSONB,
  agreement BOOLEAN,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eval_traces_conversation_created_at_idx
  ON conversaflow.eval_traces (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS eval_traces_turn_id_idx
  ON conversaflow.eval_traces (turn_id)
  WHERE turn_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS eval_traces_agreement_idx
  ON conversaflow.eval_traces (agreement, created_at DESC);

GRANT SELECT, INSERT ON TABLE conversaflow.eval_traces TO service_role;
