-- Durable KDS device revocation audit fields.
-- is_active remains the authorization gate; revoked_* columns explain why a
-- session stopped being usable.

ALTER TABLE kds.device_sessions
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by uuid,
  ADD COLUMN IF NOT EXISTS revocation_reason text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'kds'
      AND table_name = 'device_sessions'
      AND column_name = 'tenant_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS kds_device_sessions_revoked_idx
      ON kds.device_sessions (tenant_id, location_id, revoked_at DESC)
      WHERE is_active = false;
  ELSE
    CREATE INDEX IF NOT EXISTS kds_device_sessions_business_revoked_idx
      ON kds.device_sessions (business_id, revoked_at DESC)
      WHERE is_active = false;
  END IF;
END $$;
