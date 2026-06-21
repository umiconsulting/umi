-- The anon role was granted EXECUTE on the three KDS RPCs but lacked USAGE
-- on the kds schema itself. PostgREST requires schema USAGE to resolve the
-- Content-Profile: kds routing header; without it, requests return HTTP 401
-- "permission denied for schema kds" even when the function grants are present.
--
-- Applied alongside grant_kds_rpcs_to_anon (20260416071150). Both are required
-- for the KDS iPad app to call the RPCs using only the Supabase anon key.

GRANT USAGE ON SCHEMA kds TO anon;
