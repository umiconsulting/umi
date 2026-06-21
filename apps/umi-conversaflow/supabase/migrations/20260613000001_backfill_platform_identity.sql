CREATE OR REPLACE FUNCTION legacy.stable_uuid(p_seed text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (
    substr(md5(p_seed), 1, 8) || '-' ||
    substr(md5(p_seed), 9, 4) || '-' ||
    substr(md5(p_seed), 13, 4) || '-' ||
    substr(md5(p_seed), 17, 4) || '-' ||
    substr(md5(p_seed), 21, 12)
  )::uuid;
$$;

INSERT INTO platform.tenants (id, slug, name, status, timezone, created_at, updated_at)
SELECT
  id,
  lower(regexp_replace(regexp_replace(name, '[^a-zA-Z0-9]', '-', 'g'), '-+', '-', 'g')),
  name,
  'active',
  coalesce(config->>'timezone', open_times->>'timezone', 'America/Mazatlan'),
  now(),
  now()
FROM conversaflow.businesses
ON CONFLICT (id) DO NOTHING;

INSERT INTO platform.tenants (id, slug, name, status, timezone, created_at, updated_at)
SELECT
  legacy.stable_uuid('cash:tenant:' || id),
  slug,
  name,
  case when "subscriptionStatus" = 'ACTIVE' then 'active' else 'disabled' end,
  'America/Mazatlan',
  coalesce("createdAt"::timestamptz, now()),
  coalesce("updatedAt"::timestamptz, now())
FROM umi_cash."Tenant"
ON CONFLICT (id) DO NOTHING;

INSERT INTO platform.contacts (id, tenant_id, display_name, phone, created_at, updated_at)
SELECT
  c.id,
  c.business_id,
  coalesce(c.name, c.phone),
  c.phone,
  coalesce(c.created_at, now()),
  now()
FROM conversaflow.customers c
WHERE EXISTS (SELECT 1 FROM platform.tenants t WHERE t.id = c.business_id)
ON CONFLICT (id) DO NOTHING;

INSERT INTO platform.contact_identities (tenant_id, contact_id, identity_type, identity_value, normalized_value, provider, verification_status, confidence)
SELECT
  c.business_id,
  c.id,
  'phone',
  c.phone,
  regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'),
  'whatsapp',
  'unverified',
  'source_asserted'
FROM conversaflow.customers c
WHERE c.phone IS NOT NULL AND c.phone != ''
  AND EXISTS (SELECT 1 FROM platform.tenants t WHERE t.id = c.business_id);

INSERT INTO platform.users (id, display_name, created_at, updated_at)
SELECT
  du.id,
  coalesce(du.role, 'viewer'),
  du.created_at,
  du.created_at
FROM conversaflow.dashboard_users du
ON CONFLICT (id) DO NOTHING;

INSERT INTO platform.tenant_memberships (tenant_id, user_id, status)
SELECT
  du.business_id,
  du.id,
  'active'
FROM conversaflow.dashboard_users du
WHERE EXISTS (SELECT 1 FROM platform.tenants t WHERE t.id = du.business_id)
ON CONFLICT (tenant_id, user_id) DO NOTHING;
