-- KDS partial item cancellation — schema additions only.
-- ALTER TYPE ADD VALUE must commit before functions can reference the new enum value.
-- All functions live in 20260422200000_kds_partial_cancellation_functions.sql.

ALTER TYPE kds.ticket_status ADD VALUE IF NOT EXISTS 'partial_cancelled';

ALTER TABLE kds.tickets
  ADD COLUMN IF NOT EXISTS partial_cancellation_reason TEXT;

COMMENT ON COLUMN kds.tickets.partial_cancellation_reason IS
'Operator-supplied reason for partial item cancellation while the customer decides whether to accept the remaining order.';
