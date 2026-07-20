-- ============================================================================
-- build-v3 seed · RBAC role -> permission grants   [runs AFTER backfill_identity]
-- core.role_permissions was EMPTY in the source (see backfill_identity.sql), so
-- the role<->permission wiring is (re)seeded here from the build-v3 policy, not
-- migrated. Catalog roles (admin/owner/staff/viewer) + permissions
-- (insights.read/loyalty.operate/orders.operate/tenant.manage) come from
-- backfill_identity; this file only adds the super_admin platform role and the
-- role->permission edges. Keyed by KEY (id-agnostic) and guarded (idempotent).
--
-- Mapping (owner-confirmed 2026-07-20):
--   owner, admin -> ALL four permissions
--   staff        -> loyalty.operate + orders.operate  (front-of-house ops)
--   viewer       -> insights.read                      (read-only)
--   super_admin  -> ['*'] wildcard, resolved CODE-SIDE (auth/roles.ts
--                   effectivePermissions) — no explicit rows needed here.
-- ============================================================================

-- super_admin: a platform-wide role (is_platform) the source never had. Dormant
-- until explicitly granted (umi.user_role); its authority is the ['*'] wildcard.
insert into umi.role (key, name, description, is_platform)
select 'super_admin',
       'Super Admin',
       'Cross-tenant Umi operator; all permissions (wildcard resolved code-side).',
       true
where not exists (select 1 from umi.role where key = 'super_admin');

-- role -> permission grants.
insert into umi.role_permission (role_id, permission_id)
select r.id, p.id
from (values
  ('owner',  'insights.read'), ('owner',  'loyalty.operate'),
  ('owner',  'orders.operate'), ('owner',  'tenant.manage'),
  ('admin',  'insights.read'), ('admin',  'loyalty.operate'),
  ('admin',  'orders.operate'), ('admin',  'tenant.manage'),
  ('staff',  'loyalty.operate'), ('staff',  'orders.operate'),
  ('viewer', 'insights.read')
) as m(role_key, perm_key)
join umi.role r       on r.key = m.role_key
join umi.permission p on p.key = m.perm_key
where not exists (
  select 1 from umi.role_permission x
  where x.role_id = r.id and x.permission_id = p.id
);
