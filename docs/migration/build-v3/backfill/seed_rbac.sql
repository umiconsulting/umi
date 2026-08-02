-- ============================================================================
-- build-v3 seed · RBAC role -> permission grants   [runs AFTER backfill_identity]
-- core.role_permissions was EMPTY in the source (see backfill_identity.sql), so
-- the role<->permission wiring is (re)seeded here from the build-v3 policy, not
-- migrated. Catalog roles (admin/owner/staff/viewer) + permissions
-- (insights.read/loyalty.operate/orders.operate/merchant.manage) come from
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
       'Cross-merchant Umi operator; all permissions (wildcard resolved code-side).',
       true
where not exists (select 1 from umi.role where key = 'super_admin');

-- Cross-merchant operator (owner decision 2026-07-21). backfill_identity notes the source
-- modelled this as admin-on-every-merchant, which left hola@ without access to Northwest
-- Café and made SUPER_ADMIN_SA_CTE dead code (nobody held the role, in v2 or v3). Make
-- the concept REAL instead: a PLATFORM-WIDE grant — merchant_id NULL, exactly what
-- umi.user_role documents as 'NULL = platform-wide grant (superadmin)'.
-- NOTE: umi.user_role's RLS policy is merchant_id = umi.current_merchant(), which a NULL
-- can never satisfy, so this row is deliberately invisible to the `api` pool; the auth
-- queries that read it run on the worker pool.
insert into umi.user_role (user_id, role_id, merchant_id, location_id)
select u.id, r.id, null, null
from umi.user u
cross join umi.role r
where u.email = 'hola@umiconsulting.co'
  and r.key = 'super_admin'
  and not exists (
    select 1 from umi.user_role x
     where x.user_id = u.id and x.role_id = r.id
       and x.merchant_id is null and x.location_id is null
  );

-- role -> permission grants.
insert into umi.role_permission (role_id, permission_id)
select r.id, p.id
from (values
  ('owner',  'insights.read'), ('owner',  'loyalty.operate'),
  ('owner',  'orders.operate'), ('owner',  'merchant.manage'),
  ('admin',  'insights.read'), ('admin',  'loyalty.operate'),
  ('admin',  'orders.operate'), ('admin',  'merchant.manage'),
  ('staff',  'loyalty.operate'), ('staff',  'orders.operate'),
  ('viewer', 'insights.read')
) as m(role_key, perm_key)
join umi.role r       on r.key = m.role_key
join umi.permission p on p.key = m.perm_key
where not exists (
  select 1 from umi.role_permission x
  where x.role_id = r.id and x.permission_id = p.id
);

-- ---------------------------------------------------------------------------
-- POS role -> permission grants (added 2026-07-28 with the UmiPOS integration).
--
-- These were briefly written into 10_umi.sql, which runs BEFORE any role exists, so
-- they joined an empty umi.role and granted nothing. Permissions without a holder look
-- exactly like permissions with one until somebody tries to sell something.
--
-- The split follows the existing one — `staff` is front-of-house ops:
--   catalog.read / cart.write / checkout.commit  owner, admin, staff
--       A cashier who cannot see the menu cannot sell, and taking money at the counter
--       IS the front-of-house job.
--   offline.replay / offline.cash.checkout       owner, admin, staff
--       A till drains its own queue; the operator does not fetch a manager to reconnect.
--       Offline CASH is additionally gated by the pos.offline_cash entitlement and by
--       merchant.pos_offline_cash_policy, so this grant alone does not enable it.
--   device.enroll / offline.recovery.review      owner, admin
--       Enrolling a terminal and approving a recovery action are management decisions.
--   audit.read                                   owner, admin
--       The audit chain names who did what; it is not a shift-worker surface.
--   viewer                                        none — read-only has no till.
-- ---------------------------------------------------------------------------
insert into umi.role_permission (role_id, permission_id)
select r.id, p.id
from (values
  ('owner','catalog.read'),  ('owner','cart.write'),  ('owner','checkout.commit'),
  ('owner','offline.replay'),('owner','offline.cash.checkout'),
  ('owner','device.enroll'), ('owner','offline.recovery.review'), ('owner','audit.read'),
  ('admin','catalog.read'),  ('admin','cart.write'),  ('admin','checkout.commit'),
  ('admin','offline.replay'),('admin','offline.cash.checkout'),
  ('admin','device.enroll'), ('admin','offline.recovery.review'), ('admin','audit.read'),
  ('staff','catalog.read'),  ('staff','cart.write'),  ('staff','checkout.commit'),
  ('staff','offline.replay'),('staff','offline.cash.checkout')
) as m(role_key, perm_key)
join umi.role r       on r.key = m.role_key
join umi.permission p on p.key = m.perm_key
where not exists (
  select 1 from umi.role_permission x
  where x.role_id = r.id and x.permission_id = p.id
);
