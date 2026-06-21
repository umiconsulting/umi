-- The KDS iPad app authenticates with the Supabase anon key (no user session JWT),
-- which maps to the `anon` Postgres role. The initial projection migration granted
-- EXECUTE only to `authenticated` and `service_role`. This migration extends access
-- to `anon` so the app can call the three public RPC contracts.
--
-- The RPCs use SECURITY DEFINER and bypass RLS, so granting to anon does not expose
-- any additional data beyond what the function itself returns for the given business_id.

GRANT EXECUTE ON FUNCTION kds.get_board_snapshot(UUID, TEXT)                              TO anon;
GRANT EXECUTE ON FUNCTION kds.get_ticket_events(UUID, BIGINT, INTEGER)                    TO anon;
GRANT EXECUTE ON FUNCTION kds.transition_ticket(UUID, kds.ticket_status, TEXT, TEXT, TEXT) TO anon;
