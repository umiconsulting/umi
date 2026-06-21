-- Remove the legacy 5-parameter overload.
-- PostgREST resolves RPCs by named parameters and treats the 5-param and
-- 6-param signatures as ambiguous when callers omit p_cancellation_reason.
-- The 6-param function keeps backward compatibility because the final
-- p_cancellation_reason argument already defaults to NULL.

DROP FUNCTION IF EXISTS kds.transition_ticket(
  UUID,
  kds.ticket_status,
  TEXT,
  TEXT,
  TEXT
);
