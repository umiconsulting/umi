-- Device-scoped authentication for the KDS command surface.
--
-- Tokens are provisioned by an admin (service_role) and shipped to each kitchen
-- display in its Info.plist. The kds-command edge function calls verify_device_token()
-- before executing any mutation. Anon callers cannot reach mutation RPCs directly.

CREATE TABLE IF NOT EXISTS kds.device_sessions (
  device_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID        NOT NULL REFERENCES conversaflow.businesses(id) ON DELETE CASCADE,
  device_name   TEXT        NOT NULL,
  station_id    TEXT,
  token_hash    TEXT        NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE kds.device_sessions IS
'One row per provisioned KDS device. Tokens are stored as sha256 hex hashes. The kds-command edge function verifies the plaintext token before executing mutations.';

CREATE INDEX IF NOT EXISTS kds_device_sessions_business_active_idx
  ON kds.device_sessions (business_id, is_active);

-- ── Admin: provision a new device token ────────────────────────────────────
-- Returns the plaintext token exactly once. It cannot be recovered afterward.
-- Called by ops/admin tooling; never exposed to anon or authenticated clients.

CREATE OR REPLACE FUNCTION kds.provision_device_token(
  p_business_id UUID,
  p_device_name TEXT,
  p_station_id  TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = kds, conversaflow, public
AS $$
DECLARE
  v_token TEXT;
  v_hash  TEXT;
BEGIN
  v_token := encode(gen_random_bytes(32), 'hex');
  v_hash  := encode(sha256(v_token::bytea), 'hex');

  INSERT INTO kds.device_sessions (business_id, device_name, station_id, token_hash)
  VALUES (p_business_id, p_device_name, p_station_id, v_hash);

  RETURN v_token;
END;
$$;

-- ── Internal: verify token for edge function use ────────────────────────────
-- Returns (device_id, business_id, station_id) if the token is valid and active.
-- Returns no rows if the token is unknown or inactive.

CREATE OR REPLACE FUNCTION kds.verify_device_token(p_token TEXT)
RETURNS TABLE (device_id UUID, business_id UUID, station_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = kds, conversaflow, public
AS $$
DECLARE
  v_hash TEXT;
  v_row  kds.device_sessions%ROWTYPE;
BEGIN
  v_hash := encode(sha256(p_token::bytea), 'hex');

  SELECT *
  INTO v_row
  FROM kds.device_sessions AS ds
  WHERE ds.token_hash = v_hash
    AND ds.is_active = TRUE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE kds.device_sessions
  SET last_used_at = now()
  WHERE kds.device_sessions.device_id = v_row.device_id;

  RETURN QUERY SELECT v_row.device_id, v_row.business_id, v_row.station_id;
END;
$$;

-- Both functions are for admin/internal use only. Revoke public default grants.
REVOKE EXECUTE ON FUNCTION kds.provision_device_token(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION kds.verify_device_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kds.provision_device_token(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION kds.verify_device_token(TEXT) TO service_role;
