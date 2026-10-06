-- ============================================================================
-- build-v3 seed · RBAC role -> permission grants   [runs AFTER backfill_identity]
-- core.role_permissions was EMPTY in the source (see backfill_identity.sql), so
-- the role<->permission wiring is (re)seeded here from the build-v3 policy, not
-- migrated. Catalog roles (admin/owner/staff/viewer) + permissions
-- (insights.read/loyalty.operate/orders.operate/merchant.manage) come from
-- backfill_identity; this file only adds the super_admin platform role and the
-- role->permission edges. Keyed by KEY (id-agnostic) and guarded (idempotent).
--
-- Mapping (owner-confirmed 2026-07-20, amended 2026-08-01):
--   owner, admin -> ALL four café permissions
--   staff        -> loyalty.operate + orders.operate  (front-of-house ops)
--   viewer       -> insights.read                      (read-only)
--   super_admin  -> every permission key, LISTED ONE BY ONE below
--   developer    -> read-only across every café
--
-- The super_admin change is the point of the 2026-08-01 amendment. Its authority used
-- to be the ['*'] wildcard, resolved in auth/roles.ts. A wildcard grants permission
-- keys written after it: the eight POS keys seeded in July 2026 all reached super_admin
-- the moment they existed, with no review. The list below costs one row per new key,
-- and that cost is the control.
--
-- ---------------------------------------------------------------------------
-- HOW TO RUN. The bootstrap address is a parameter, never a committed constant:
--   psql -v bootstrap_email=someone@example.com -f seed_rbac.sql
-- ---------------------------------------------------------------------------
-- BOOTSTRAP, AND ITS RETIREMENT. This file is the out-of-band path that Vault,
-- Kubernetes, Keycloak, GitLab and PostgreSQL all use: an operator runs it by hand, and
-- no API can do what it does. Do NOT build a request path that creates a platform
-- administrator. Every one of those systems also documents a RETIREMENT step, and this
-- is ours:
--   1. The bootstrap grant below is permanent (expires_at NULL). It is the only one
--      that may be. It exists to create the second administrator, not to be used daily.
--   2. Once a second platform grant exists, revoke or time-box this one:
--        update umi.user_role set expires_at = now() + interval '90 days'
--         where user_id = (select id from umi.user where lower(email) = lower(:'bootstrap_email'));
--   3. security_gate.sql asserts that at most ONE unbounded platform grant exists.
-- ============================================================================

-- Set INSIDE the file, the way security_gate.sql does, and not left to the caller.
-- Without it psql PRINTS an exception and then carries on to the next statement, exiting
-- 0 — so the guard below would report a missing address and seed the roles anyway.
--
-- 00_run_backfill.sh passes the flag from $BOOTSTRAP_EMAIL. It did NOT when this guard
-- first landed, which broke the whole rehearsal pipeline at this step; the guard was
-- right and the caller was never updated.
\set ON_ERROR_STOP on

-- `\quit` always exits 0, so it cannot fail this script on its own. The \if prints a
-- readable message; the DO block below is what stops the run with a non-zero status.
\if :{?bootstrap_email}
\else
\echo ''
\echo 'ERROR: seed_rbac.sql needs the bootstrap address.'
\echo '       psql -v bootstrap_email=<address> -f seed_rbac.sql'
\echo ''
\set bootstrap_email ''
\endif

-- The address moves into a SETTING first, because psql does NOT substitute :'variables'
-- inside a dollar-quoted body — the DO block below would see the literal text and fail
-- with a confusing syntax error instead of the message it is here to print.
select set_config('umi.bootstrap_email', :'bootstrap_email', false);
do $$
begin
  if nullif(current_setting('umi.bootstrap_email', true), '') is null then
    raise exception 'seed_rbac.sql: missing -v bootstrap_email=<address>';
  end if;
end $$;

-- super_admin: a platform-wide role (is_platform) the source never had. Dormant until
-- explicitly granted in umi.user_role.
insert into umi.role (key, name, description, is_platform)
select 'super_admin',
       'Super Admin',
       'Cross-merchant Umi operator. Holds every permission, each granted explicitly.',
       true
where not exists (select 1 from umi.role where key = 'super_admin');

-- developer: the answer to "how does a developer debug a café's data". Cross-merchant
-- REACH, like super_admin — the merchant picker lists every café, which is what makes
-- debugging quick. Read-only AUTHORITY, unlike super_admin. Reach and authority are two
-- axes, and only one of them needs to be wide to debug something.
-- (`tech_assist` was removed from ROLE_PRECEDENCE in the same change. It had no row
-- here, so it outranked `staff` and granted nothing.)
insert into umi.role (key, name, description, is_platform)
select 'developer',
       'Developer',
       'Cross-merchant read-only access for debugging. Changes nothing.',
       true
where not exists (select 1 from umi.role where key = 'developer');

-- Cross-merchant operator (owner decision 2026-07-21). backfill_identity notes the source
-- modelled this as admin-on-every-merchant, which left hola@ without access to Northwest
-- Café and made the super-admin CTE dead code (nobody held the role, in v2 or v3). Make
-- the concept REAL instead: a PLATFORM grant, which is now the only thing umi.user_role
-- holds. The 4 admin memberships are not carried; this row replaces them.
-- NOTE: umi.user_role is ungranted to the `api` pool (90_rls.sql seals it, security_gate
-- asserts it), so this row is invisible to the request path; the auth queries that read
-- it run on the worker pool.
insert into umi.user_role (user_id, role_id, justification)
select u.id, r.id, 'bootstrap: the first platform administrator (seed_rbac.sql)'
from umi.user u
cross join umi.role r
where lower(u.email) = lower(:'bootstrap_email')
  and r.key = 'super_admin'
  and not exists (
    select 1 from umi.user_role x
     where x.user_id = u.id and x.role_id = r.id
  );

-- The grant IS an auditable event, and this file is the only thing that performs one.
-- umi.audit_log.action has admitted 'grant' and 'revoke' since build-v3 and nothing has
-- ever written either. actor_user_id is NULL on purpose: an operator ran psql, and no
-- authenticated request took this action.
insert into umi.audit_log (actor_user_id, action, entity, entity_id, merchant_id, after)
select null, 'grant', 'user_role', ur.id, null,
       jsonb_build_object('role', 'super_admin', 'user_id', ur.user_id,
                          'source', 'seed_rbac.sql', 'justification', ur.justification)
from umi.user_role ur
join umi.user u on u.id = ur.user_id
join umi.role r on r.id = ur.role_id
where lower(u.email) = lower(:'bootstrap_email')
  and r.key = 'super_admin'
  and not exists (
    select 1 from umi.audit_log a
     where a.entity = 'user_role' and a.entity_id = ur.id and a.action = 'grant'
  );

-- ---------------------------------------------------------------------------
-- THE CAFÉ CATALOGUE. Roles and permissions a café needs, seeded here rather
-- than inherited from the database we are leaving.
--
-- ⚠️ ADDED 2026-08-19, and the reason is that build-v3 was only ever a MIGRATION
-- TARGET. `backfill_identity.sql` copies `core.roles` and `core.permissions`
-- across, so a migrated platform has these four roles because production had
-- them. A platform built from `00_run.sh` alone has NONE — and `merchant.staff.
-- role_id` is NOT NULL against `umi.role`, so on a fresh install no user can be
-- a member of any café, and no café can be created at all. The wiring below
-- inner-joins `umi.role`, so it silently granted nothing there too.
--
-- Guarded by KEY, so a migrated platform is untouched: the backfill runs first
-- and its rows keep the source ids. Only a fresh build reaches these inserts.
--
-- Keys, not names, are the contract: `cash-roles.ts` maps owner/admin → ADMIN
-- and staff/cashier → STAFF, and `roles.ts` orders them by precedence.
-- ---------------------------------------------------------------------------
insert into umi.role (key, name, description, is_platform)
select v.key, v.name, v.description, false
from (values
  ('owner',  'Owner',  'Full merchant administration'),
  ('admin',  'Admin',  'Merchant administration'),
  ('staff',  'Staff',  'Operational staff'),
  ('viewer', 'Viewer', 'Read-only dashboard access')
) as v(key, name, description)
where not exists (select 1 from umi.role r where r.key = v.key);

insert into umi.permission (key, description)
select v.key, v.description
from (values
  ('insights.read',   'Read merchant insights and reports'),
  ('loyalty.operate', 'Operate the loyalty register'),
  ('orders.operate',  'Operate orders and the kitchen board'),
  ('tenant.manage',   'Change merchant settings, staff and locations')
) as v(key, description)
where not exists (select 1 from umi.permission p where p.key = v.key);

-- role -> permission grants.
insert into umi.role_permission (role_id, permission_id)
select r.id, p.id
from (values
  ('owner',  'insights.read'), ('owner',  'loyalty.operate'),
  -- `tenant.manage`, NOT `merchant.manage`. This list said the latter from the
  -- day it was written and `umi.permission` has only ever held the former, so
  -- these two rows joined nothing and granted nothing: no café role held any
  -- merchant-management permission, only the platform super_admin did. Latent
  -- rather than live — no route carries `@RequirePermission` yet — which is
  -- exactly how it survived. Measured on the 2026-08-18 snapshot: `tenant.manage`
  -- was held by one role out of six.
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

-- Gate 3 cashier workflow. `staff` is the current front-of-house role.
insert into umi.role_permission (role_id, permission_id)
select r.id, p.id
from (values
  ('owner','sale.lifecycle'), ('owner','sale.resume.any'),
  ('owner','checkout.discount.apply'), ('owner','checkout.discount.approve'),
  ('owner','checkout.terminal.confirm'), ('owner','checkout.terminal.approve'),
  ('owner','checkout.recover.any'),
  ('admin','sale.lifecycle'), ('admin','sale.resume.any'),
  ('admin','checkout.discount.apply'), ('admin','checkout.discount.approve'),
  ('admin','checkout.terminal.confirm'), ('admin','checkout.terminal.approve'),
  ('admin','checkout.recover.any'),
  ('staff','sale.lifecycle'), ('staff','checkout.discount.apply'),
  ('staff','checkout.terminal.confirm'),
  ('owner','cash.register.use'), ('owner','cash.shift.open'),
  ('owner','cash.shift.suspend'), ('owner','cash.shift.resume'),
  ('owner','cash.shift.handoff'), ('owner','cash.movement.paid_in'),
  ('owner','cash.movement.paid_out'), ('owner','cash.movement.safe_drop'),
  ('owner','cash.drawer.no_sale'), ('owner','cash.count.submit'),
  ('owner','cash.count.recount'), ('owner','cash.variance.approve'),
  ('owner','cash.reconcile'), ('owner','cash.shift.close'), ('owner','cash.shift.read'),
  ('admin','cash.register.use'), ('admin','cash.shift.open'),
  ('admin','cash.shift.suspend'), ('admin','cash.shift.resume'),
  ('admin','cash.shift.handoff'), ('admin','cash.movement.paid_in'),
  ('admin','cash.movement.paid_out'), ('admin','cash.movement.safe_drop'),
  ('admin','cash.drawer.no_sale'), ('admin','cash.count.submit'),
  ('admin','cash.count.recount'), ('admin','cash.variance.approve'),
  ('admin','cash.reconcile'), ('admin','cash.shift.close'), ('admin','cash.shift.read'),
  ('staff','cash.register.use'), ('staff','cash.shift.open'),
  ('staff','cash.shift.suspend'), ('staff','cash.shift.resume'),
  ('staff','cash.movement.paid_in'), ('staff','cash.movement.paid_out'),
  ('staff','cash.movement.safe_drop'), ('staff','cash.count.submit'),
  ('staff','cash.reconcile'), ('staff','cash.shift.close'), ('staff','cash.shift.read')
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

-- ---------------------------------------------------------------------------
-- PLATFORM role -> permission grants (2026-08-01).
--
-- super_admin: EVERY permission key, and this is deliberately a `select … from
-- umi.permission` rather than a hand-written list. A hand list would go stale on the
-- next key and reintroduce the failure quietly; a set-based insert stays complete.
--
-- ⚠ THIS IS NOT A WILDCARD. The rows are real, and re-running this file is what grants
-- a NEW key to super_admin. That re-run is the review step the ['*'] wildcard never
-- had: a key added to umi.permission does NOT reach any operator until somebody runs
-- this seed again, on purpose.
-- ---------------------------------------------------------------------------
insert into umi.role_permission (role_id, permission_id)
select r.id, p.id
from umi.role r
cross join umi.permission p
where r.key = 'super_admin'
  and not exists (
    select 1 from umi.role_permission x
    where x.role_id = r.id and x.permission_id = p.id
  );

-- developer: read-only across every café. The whole set, listed by hand ON PURPOSE —
-- the opposite choice from super_admin above. A new permission key must NOT reach a
-- debugging account by default; somebody has to decide it is a read.
insert into umi.role_permission (role_id, permission_id)
select r.id, p.id
from (values
  ('developer', 'insights.read'),   -- the dashboards
  ('developer', 'audit.read'),      -- the redacted audit trail
  ('developer', 'catalog.read')     -- the menu a POS device would see
) as m(role_key, perm_key)
join umi.role r       on r.key = m.role_key
join umi.permission p on p.key = m.perm_key
where not exists (
  select 1 from umi.role_permission x
  where x.role_id = r.id and x.permission_id = p.id
);
