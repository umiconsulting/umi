-- S4.5: Auth consolidation — move local auth credentials from
-- dashboard_compat.local_user_credentials into platform.users.
-- Enables DROP SCHEMA dashboard_compat after server.js cutover.
--
-- Migration 20260613000005_platform_auth_credentials.sql

-- ---------------------------------------------------------------------------
-- 1. Add password columns to platform.users
-- ---------------------------------------------------------------------------
ALTER TABLE platform.users
  ADD COLUMN IF NOT EXISTS password_salt      text,
  ADD COLUMN IF NOT EXISTS password_hash      text,
  ADD COLUMN IF NOT EXISTS password_algorithm text NOT NULL DEFAULT 'scrypt-sha256-v1';

-- ---------------------------------------------------------------------------
-- 2. platform.password_reset_tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.password_reset_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_password_reset_tokens_token_hash
  ON platform.password_reset_tokens (token_hash);

-- ---------------------------------------------------------------------------
-- 3. Migrate seed credential (hola@umiconsulting.co)
-- ---------------------------------------------------------------------------
UPDATE platform.users AS u
SET
  password_salt = c.password_salt,
  password_hash = c.password_hash
FROM dashboard_compat.local_user_credentials AS c
WHERE u.id = c.user_id;

-- ---------------------------------------------------------------------------
-- 4. Grants — expose to service_role and authenticated
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.password_reset_tokens TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.password_reset_tokens TO authenticated;
