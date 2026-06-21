CREATE TABLE IF NOT EXISTS conversaflow.conversation_state (
  conversation_id UUID PRIMARY KEY,
  business_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  active_intent TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'collecting', 'ready', 'waiting_user', 'tool_executed', 'closed', 'escalated')),
  known_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  missing_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_user_goal TEXT,
  last_bot_action JSONB,
  task_stage TEXT,
  confidence NUMERIC CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_state_business_updated_idx
  ON conversaflow.conversation_state (business_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS conversation_state_customer_updated_idx
  ON conversaflow.conversation_state (customer_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS conversation_state_active_intent_idx
  ON conversaflow.conversation_state (active_intent)
  WHERE active_intent IS NOT NULL;

COMMENT ON TABLE conversaflow.conversation_state IS
'Legacy structured conversation state. Superseded by the mini-harness runtime, which keeps only conversation.current_state, draft_cart, and one pending clarification on the live path.';

COMMENT ON COLUMN conversaflow.conversation_state.known_fields IS
'Structured fields already known for the current task, e.g. query, quantity, size, temp, milk, pickup_person, reason, confirmation.';

COMMENT ON COLUMN conversaflow.conversation_state.missing_fields IS
'Structured missing-field map keyed by field name with source/reason metadata.';

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE conversaflow.conversation_state TO service_role;
