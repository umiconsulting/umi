-- Short-lived KDS first-pairing PIN requests for the platform schema.
-- The PIN is only a bootstrap secret. Durable device identity remains in
-- kds.device_sessions as a hashed token.

CREATE TABLE IF NOT EXISTS kds.device_pairing_requests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  location_id     UUID        REFERENCES platform.locations(id) ON DELETE CASCADE,
  station_id      UUID        NOT NULL REFERENCES kds.stations(id) ON DELETE RESTRICT,
  device_name     TEXT        NOT NULL,
  requested_name  TEXT,
  pin_hash        TEXT        NOT NULL,
  pin_salt        TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending',
  attempt_count   INTEGER     NOT NULL DEFAULT 0,
  max_attempts    INTEGER     NOT NULL DEFAULT 5,
  expires_at      TIMESTAMPTZ NOT NULL,
  approved_by     UUID        REFERENCES platform.users(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  used_at         TIMESTAMPTZ,
  denied_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT device_pairing_requests_status_check
    CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'used')),
  CONSTRAINT device_pairing_requests_attempts_check
    CHECK (attempt_count >= 0 AND max_attempts > 0)
);

COMMENT ON TABLE kds.device_pairing_requests IS
'Short-lived admin-approved KDS first-pairing requests. PINs are salted and hashed; durable sessions live in kds.device_sessions.';

CREATE INDEX IF NOT EXISTS kds_device_pairing_tenant_status_idx
  ON kds.device_pairing_requests (tenant_id, location_id, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS kds_device_pairing_pending_hash_idx
  ON kds.device_pairing_requests (status, expires_at)
  WHERE status = 'pending';
