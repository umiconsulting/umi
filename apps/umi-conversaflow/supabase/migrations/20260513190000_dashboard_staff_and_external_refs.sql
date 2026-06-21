-- Dashboard-owned tenant routing and operational staff source of truth.
--
-- Cash remains the source for loyalty/wallet configuration. ConversaFlow owns
-- operational staff because KDS and future unified admin surfaces need the same
-- tenant-scoped roster.

CREATE TABLE IF NOT EXISTS conversaflow.business_external_refs (
  business_id      UUID        PRIMARY KEY REFERENCES conversaflow.businesses(id) ON DELETE CASCADE,
  cash_tenant_id   TEXT        UNIQUE,
  cash_slug        TEXT        UNIQUE,
  metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE conversaflow.business_external_refs IS
'Maps a ConversaFlow business tenant to product-local identifiers such as umi_cash.Tenant. Used by dashboard adapters while databases remain schema-separated.';

CREATE TABLE IF NOT EXISTS conversaflow.staff_members (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID        NOT NULL REFERENCES conversaflow.businesses(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  phone           TEXT,
  email           TEXT,
  role            TEXT        NOT NULL DEFAULT 'STAFF' CHECK (role IN ('ADMIN', 'STAFF')),
  status          TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'disabled')),
  permissions     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  source_system   TEXT,
  source_user_id  TEXT,
  invited_at      TIMESTAMPTZ,
  disabled_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE conversaflow.staff_members IS
'Tenant-scoped operational staff roster shared by dashboard and KDS. This is intentionally separate from umi_cash.User customer/member rows.';

CREATE INDEX IF NOT EXISTS conversaflow_staff_members_business_status_idx
  ON conversaflow.staff_members (business_id, status, role, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS conversaflow_staff_members_business_phone_uidx
  ON conversaflow.staff_members (business_id, phone)
  WHERE phone IS NOT NULL AND phone <> '';

CREATE UNIQUE INDEX IF NOT EXISTS conversaflow_staff_members_business_email_uidx
  ON conversaflow.staff_members (business_id, email)
  WHERE email IS NOT NULL AND email <> '';

CREATE UNIQUE INDEX IF NOT EXISTS conversaflow_staff_members_source_uidx
  ON conversaflow.staff_members (source_system, source_user_id)
  WHERE source_system IS NOT NULL AND source_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION conversaflow.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS business_external_refs_touch_updated_at
  ON conversaflow.business_external_refs;
CREATE TRIGGER business_external_refs_touch_updated_at
BEFORE UPDATE ON conversaflow.business_external_refs
FOR EACH ROW
EXECUTE FUNCTION conversaflow.touch_updated_at();

DROP TRIGGER IF EXISTS staff_members_touch_updated_at
  ON conversaflow.staff_members;
CREATE TRIGGER staff_members_touch_updated_at
BEFORE UPDATE ON conversaflow.staff_members
FOR EACH ROW
EXECUTE FUNCTION conversaflow.touch_updated_at();

-- Known live tenant bridge at the time this dashboard adapter was introduced.
-- This replaces dashboard hardcoded slug -> business_id maps with data.
INSERT INTO conversaflow.business_external_refs (
  business_id,
  cash_tenant_id,
  cash_slug,
  metadata
)
SELECT
  'ef9005a2-efe1-45bf-9da0-313b5902d9b4'::uuid,
  t.id,
  t.slug,
  jsonb_build_object('seeded_by', '20260513190000_dashboard_staff_and_external_refs')
FROM umi_cash."Tenant" AS t
WHERE t.slug = 'kalalacafe'
ON CONFLICT (business_id) DO UPDATE
SET
  cash_tenant_id = EXCLUDED.cash_tenant_id,
  cash_slug = EXCLUDED.cash_slug,
  metadata = conversaflow.business_external_refs.metadata || EXCLUDED.metadata;

-- One-time staff bootstrap from Cash admin/staff users. Cash rows are kept for
-- compatibility with existing loyalty admin auth and transaction audit fields.
WITH cash_staff AS (
  SELECT
    refs.business_id,
    u.id,
    u.name,
    NULLIF(u.phone, '') AS phone,
    NULLIF(u.email, '') AS email,
    u.role,
    u.createdAt,
    u.updatedAt,
    row_number() OVER (
      PARTITION BY refs.business_id, NULLIF(u.phone, '')
      ORDER BY u.createdAt ASC, u.id ASC
    ) AS phone_rank,
    row_number() OVER (
      PARTITION BY refs.business_id, NULLIF(u.email, '')
      ORDER BY u.createdAt ASC, u.id ASC
    ) AS email_rank
  FROM umi_cash."User" AS u
  JOIN conversaflow.business_external_refs AS refs
    ON refs.cash_tenant_id = u.tenantId
  WHERE u.role IN ('ADMIN', 'STAFF')
)
INSERT INTO conversaflow.staff_members (
  business_id,
  name,
  phone,
  email,
  role,
  status,
  permissions,
  source_system,
  source_user_id,
  created_at,
  updated_at
)
SELECT
  business_id,
  COALESCE(NULLIF(name, ''), email, phone, 'Unnamed staff member'),
  CASE WHEN phone_rank = 1 THEN phone ELSE NULL END,
  CASE WHEN email_rank = 1 THEN email ELSE NULL END,
  CASE WHEN role = 'ADMIN' THEN 'ADMIN' ELSE 'STAFF' END,
  'active',
  CASE
    WHEN role = 'ADMIN' THEN '{"scan":true,"topup":true,"analytics":true,"settings":true,"staff":true,"giftcards":true,"kds":true}'::jsonb
    ELSE '{"scan":true,"topup":true,"analytics":false,"settings":false,"staff":false,"giftcards":false,"kds":true}'::jsonb
  END,
  'umi_cash',
  id,
  createdAt,
  updatedAt
FROM cash_staff
ON CONFLICT (source_system, source_user_id) DO UPDATE
SET
  business_id = EXCLUDED.business_id,
  name = EXCLUDED.name,
  phone = EXCLUDED.phone,
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  status = EXCLUDED.status,
  permissions = EXCLUDED.permissions,
  updated_at = now();

GRANT USAGE ON SCHEMA conversaflow TO authenticated, service_role;
GRANT SELECT ON conversaflow.business_external_refs TO authenticated, service_role;
GRANT SELECT ON conversaflow.staff_members TO authenticated, service_role;
GRANT INSERT, UPDATE ON conversaflow.staff_members TO service_role;
GRANT ALL ON conversaflow.business_external_refs TO service_role;
GRANT ALL ON conversaflow.staff_members TO service_role;
GRANT EXECUTE ON FUNCTION conversaflow.touch_updated_at() TO service_role;

ALTER TABLE conversaflow.business_external_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversaflow.staff_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "business_external_refs_member_select"
  ON conversaflow.business_external_refs;
CREATE POLICY "business_external_refs_member_select"
ON conversaflow.business_external_refs
FOR SELECT
TO authenticated
USING (public.user_has_business_access(business_id));

DROP POLICY IF EXISTS "staff_members_member_select"
  ON conversaflow.staff_members;
CREATE POLICY "staff_members_member_select"
ON conversaflow.staff_members
FOR SELECT
TO authenticated
USING (public.user_has_business_access(business_id));
