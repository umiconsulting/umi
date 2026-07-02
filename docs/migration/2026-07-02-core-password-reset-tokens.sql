-- ============================================================================
-- core.password_reset_tokens — backs umi-api local-auth forgot/reset-password.
--
-- umi-api (apps/umi-api/src/modules/auth/auth.repository.ts) reads/writes
-- `core.password_reset_tokens`, but the only DDL in the repo created it under
-- the `dashboard_compat` schema (docs/migration/local-postgres/008 — an ad-hoc
-- capture). This is the canonical `core` table the running code expects.
--
-- Apply to the platform DB (Supabase xbudknbimkgjjgohnjgp). Idempotent — safe to
-- re-run. Run via: supabase db query --linked -f <this file>  (or psql).
--
-- Prod state (verified 2026-07-02): the table, columns, and umi_app grants
-- already existed there; the token_hash-unique and expires_at indexes were
-- applied from this script. The user index already existed as
-- `core_password_reset_tokens_user_idx` (name matched below, so IF NOT EXISTS is
-- a no-op on prod). This file reproduces the full canonical shape on a fresh DB.
-- ============================================================================

CREATE TABLE IF NOT EXISTS core.password_reset_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES core.users (id) ON DELETE CASCADE,
  token_hash  text        NOT NULL,   -- sha256(hex) of the emailed token; the raw token is never stored
  expires_at  timestamptz NOT NULL,   -- 15 min after issue (RESET_TOKEN_TTL_MS)
  used_at     timestamptz,            -- set once redeemed; single-use
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- findResetToken() looks up by token_hash; one row per issued token.
CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_token_hash_key
  ON core.password_reset_tokens (token_hash);

-- Support per-user invalidation and expiry sweeps. Name matches the index that
-- already exists on prod, so this is a no-op there and avoids a duplicate.
CREATE INDEX IF NOT EXISTS core_password_reset_tokens_user_idx
  ON core.password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at_idx
  ON core.password_reset_tokens (expires_at);

-- Grant to the web role (forgot/reset are public routes run via umi-api's
-- non-RLS pool). The worker/bypass role already has full access. No tenant_id ⇒
-- no RLS on this table.
GRANT SELECT, INSERT, UPDATE ON core.password_reset_tokens TO umi_app;
