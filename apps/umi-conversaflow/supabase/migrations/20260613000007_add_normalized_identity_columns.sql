-- Migration 20260613000007_add_normalized_identity_columns.sql
-- Adds normalized_phone + normalized_email to platform.people
-- These are maintained projections set by resolve_person.
-- Authoritative multi-value truth stays in contact_identities.

-- 1. Add normalized columns to platform.people
ALTER TABLE platform.people
  ADD COLUMN IF NOT EXISTS normalized_phone text,
  ADD COLUMN IF NOT EXISTS normalized_email text;

-- 2. Add normalization confidence for audit trail
ALTER TABLE platform.people
  ADD COLUMN IF NOT EXISTS normalization_confidence text
    CHECK (normalization_confidence IN ('exact', 'inferred_region', 'last10_candidate', 'unparseable'));

-- 3. Backfill: best-effort from raw phone using E.164 with MX default
-- Keep it conservative — only set when we can confidently parse
-- No last10_candidate or unparseable rows get normalized_phone set
UPDATE platform.people
SET normalized_phone = CASE
  -- US/CA numbers: already in +1XXXXXXXXXX format
  WHEN phone ~ '^\+1[0-9]{10}$' THEN phone
  -- MX numbers with +52 prefix, optional 1 after country code
  WHEN phone ~ '^\+52[0-9]{10,11}$' THEN regexp_replace(phone, '^(\+52)1?([0-9]{10})$', '\1\2')
  -- MX 10-digit local (assume +52)
  WHEN phone ~ '^[0-9]{10}$' AND phone LIKE '6%' THEN '+52' || phone
  -- US 10-digit (assume +1)
  WHEN phone ~ '^[0-9]{10}$' AND phone NOT LIKE '6%' THEN '+1' || phone
END,
normalization_confidence = CASE
  WHEN phone ~ '^\+1[0-9]{10}$' THEN 'exact'
  WHEN phone ~ '^\+52[0-9]{10,11}$' THEN 'exact'
  WHEN phone ~ '^[0-9]{10}$' THEN 'inferred_region'
END
WHERE normalized_phone IS NULL
  AND phone IS NOT NULL;

-- 4. Backfill normalized_email from raw email
UPDATE platform.people
SET normalized_email = lower(trim(email))
WHERE normalized_email IS NULL
  AND email IS NOT NULL;
