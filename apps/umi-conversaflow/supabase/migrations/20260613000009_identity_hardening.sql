-- Migration 20260613000009_identity_hardening.sql
-- Fixes #7, #8, #11, #14 from the identity resolution hazard register.

-- ===========================================================================
-- #7: source[] column — append-only provenance, NOT reconcilable from joins
-- ===========================================================================
ALTER TABLE platform.people
  ADD COLUMN IF NOT EXISTS source text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN platform.people.source IS
  'Append-only provenance tags. Non-authoritative read model. Tags never removed.';

-- ===========================================================================
-- #8: Fix reversed duplicate pairs in contact_merge_candidates
-- ===========================================================================
ALTER TABLE platform.contact_merge_candidates
  ADD COLUMN IF NOT EXISTS person_id_least uuid
    GENERATED ALWAYS AS (LEAST(left_person_id, right_person_id)) STORED,
  ADD COLUMN IF NOT EXISTS person_id_greatest uuid
    GENERATED ALWAYS AS (GREATEST(left_person_id, right_person_id)) STORED;

ALTER TABLE platform.contact_merge_candidates
  DROP CONSTRAINT IF EXISTS contact_merge_candidates_tenant_id_left_contact_id_right_co_key;

CREATE UNIQUE INDEX IF NOT EXISTS platform_contact_merge_candidates_canonical_uidx
  ON platform.contact_merge_candidates (tenant_id, person_id_least, person_id_greatest, match_type);

-- ===========================================================================
-- #11: Fix phone vs whatsapp identity_type duplication
-- Same phone number via 'phone' and 'whatsapp' creates two identities.
-- ===========================================================================
DROP INDEX IF EXISTS platform_contact_identities_verified_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS platform_contact_identities_strong_uidx
  ON platform.contact_identities (tenant_id, normalized_value)
  WHERE normalized_value IS NOT NULL
    AND identity_type IN ('phone', 'whatsapp');

CREATE UNIQUE INDEX IF NOT EXISTS platform_contact_identities_verified_email_uidx
  ON platform.contact_identities (tenant_id, identity_type, normalized_value)
  WHERE verification_status = 'verified'
    AND identity_type = 'email';

-- ===========================================================================
-- #14: Leads global email uniqueness is too aggressive
-- One consultant can submit multiple restaurants; re-submit after conversion.
-- ===========================================================================
ALTER TABLE platform.leads DROP CONSTRAINT IF EXISTS leads_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS platform_leads_email_active_uidx
  ON platform.leads (email)
  WHERE lifecycle_status IN ('new', 'nurturing', 'qualified');
