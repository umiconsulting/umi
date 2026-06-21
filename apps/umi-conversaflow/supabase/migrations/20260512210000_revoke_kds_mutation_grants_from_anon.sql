-- Remove anonymous execute access from all KDS mutation RPCs.
--
-- Mutations now route through the kds-command edge function, which authenticates
-- callers via kds.device_sessions before executing functions using the service role.
--
-- Read-only RPCs (get_board_snapshot, get_ticket_events) remain anon-accessible
-- because they are SECURITY DEFINER functions scoped to the caller-supplied
-- business_id; they expose no more data than the anon client configuration already
-- contains.

-- transition_ticket — 6-param legacy compatibility overload
REVOKE EXECUTE ON FUNCTION kds.transition_ticket(
  UUID,
  kds.ticket_status,
  TEXT,
  TEXT,
  TEXT,
  TEXT
) FROM anon;

-- transition_ticket — 7-param current overload with typed reason code
REVOKE EXECUTE ON FUNCTION kds.transition_ticket(
  UUID,
  kds.ticket_status,
  TEXT,
  TEXT,
  TEXT,
  kds.cancel_reason_code,
  TEXT
) FROM anon;

-- partial_cancel_items — 6-param legacy compatibility overload
REVOKE EXECUTE ON FUNCTION kds.partial_cancel_items(
  UUID,
  UUID[],
  TEXT,
  TEXT,
  TEXT,
  TEXT
) FROM anon;

-- partial_cancel_items — 7-param current overload with typed reason code
REVOKE EXECUTE ON FUNCTION kds.partial_cancel_items(
  UUID,
  UUID[],
  kds.cancel_reason_code,
  TEXT,
  TEXT,
  TEXT,
  TEXT
) FROM anon;
