-- ============================================================================
-- build-v3 backfill · DOMAIN: Identity & principals   [APPROVED — adversarial review]
-- Source DB: umi_backfill_v3 (legacy core.* / auth.*)  ->  target umi.* / tenant.* / runtime.*
-- READ-ONLY verified: every SELECT side resolves. Do NOT run the INSERTs until cutover.
-- FK/insert order: umi.user, umi.role, umi.permission -> umi.user_role
--                  (tenant.business already backfilled) -> tenant.branch -> tenant.staff
--
-- IDs are PRESERVED from source where a target row is a 1:1 carry (users, roles,
-- permissions, branches, staff) so downstream FKs (grants, visits, ledger) line up.
--
-- Review notes (verified against live source umi_backfill_v3):
--   * 9 users, 4 roles (all tenant_id NULL), 4 permissions, 0 role_permissions,
--     12 memberships (all 'active'), 12 membership_roles = 12 distinct grants,
--     4 locations (all 'active', lat/lng populated), 11 staff (8 with user_id).
--   * CF dashboard user 2973fcd6 has EMPTY email but HOLDS an admin grant
--     (1 membership) -> it MUST be carried (dropping it orphans a umi.user_role row);
--     email is synthesized to satisfy NOT NULL + unique(lower(email)).
--   * hola@umiconsulting.co holds admin on 4 tenants (NOT 5) -> 4 grant rows.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. umi.user  <- core.users            (MAP, 9 rows)
--   DROP columns: auth_subject (legacy cash/CF login subject — login is email+hash
--     phone (all empty; no target col), person_id (all null).
--   CREDENTIAL HYGIENE (security audit 2026-07-12) — reasoned per row:
--     * carry password_salt (source HAS it; scrypt is unverifiable without it — the
--       original backfill dropping it was a bug, and umi.user now has the column).
--     * carry hash+salt+algorithm ONLY for UNIQUE strong scrypt-sha256-v1 creds ->
--       those staff keep working logins, and the columns are unreadable by api/readonly
--       (column-locked in 90_rls.sql).
--     * FORCE-RESET (null creds, status='invited') weak legacy-sha256-v1 hashes AND any
--       hash SHARED across accounts (a seed/default password) -> eliminates the crackable
--       + shared-secret material rather than carrying it into prod.
--     * no-login / ghost accounts (null hash, e.g. the emailless CF user 2973fcd6 that
--       also holds a stale admin grant) -> status='suspended' so the account is inert.
-- ----------------------------------------------------------------------------
with src as (
  select u.*,
         count(*) filter (where u.password_hash is not null)
           over (partition by u.password_hash) as hash_shared_by
  from core.users u
), classified as (
  select *, (password_algorithm='scrypt-sha256-v1' and hash_shared_by <= 1) as keep_cred
  from src
)
insert into umi.user (id, email, password_hash, password_salt, password_algorithm,
                      full_name, status, created_at, updated_at)
select id,
       coalesce(nullif(email,''), 'migrated+'||id::text||'@umi.invalid'),
       case when keep_cred then password_hash      end,
       case when keep_cred then password_salt       end,
       case when keep_cred then password_algorithm  end,
       coalesce(nullif(display_name,''), 'Unknown'),
       case when password_hash is null then 'suspended'      -- ghost / no-login
            when not keep_cred          then 'invited'        -- weak or shared -> reset
            when status='active'        then 'active'
            when status='invited'       then 'invited'
            else 'suspended' end,
       created_at, coalesce(updated_at, created_at)
from classified;

-- ----------------------------------------------------------------------------
-- 2. umi.role  <- core.roles            (MAP, 4 rows)
--   All source roles are GLOBAL (tenant_id NULL) café roles: admin/owner/staff/viewer.
--   is_platform=false (no platform/superadmin role in source; the cross-tenant
--   superadmin is modeled as admin-on-every-tenant grants, not a role flag).
--   DROP column: tenant_id (target umi.role is a global catalog).
-- ----------------------------------------------------------------------------
insert into umi.role (id, key, name, description, is_platform, created_at)
select r.id, r.key, r.name, r.description, false, r.created_at
from core.roles r;

-- ----------------------------------------------------------------------------
-- 3. umi.permission  <- core.permissions  (MAP, 4 rows)
--   keys: insights.read, loyalty.operate, orders.operate, tenant.manage (no CHECK).
-- ----------------------------------------------------------------------------
insert into umi.permission (id, key, description, created_at)
select p.id, p.key, p.description, p.created_at
from core.permissions p;

-- core.role_permissions (0 rows) -> umi.role_permission : EMPTY.
--   role<->permission wiring is (re)seeded by the RBAC seed, not migrated.

-- ----------------------------------------------------------------------------
-- 4. umi.user_role  <- core.membership_roles JOIN core.tenant_memberships (MAP, 12)
--   Flatten the membership->role join into direct (user, role, business) grants.
--   business_id = tenant_id (== tenant.business.id, ids preserved; xfk, FK deferred to
--   50_cross_schema_fk). branch_id NULL (all-branches). granted_by NULL.
--   DROP membership.status (all 'active'; target user_role has no status).
--   12 membership_roles = 12 DISTINCT (user,role,business) grants (verified);
--   unique(user_id,role_id,business_id,branch_id) holds.
-- ----------------------------------------------------------------------------
insert into umi.user_role (user_id, role_id, business_id, branch_id, granted_by)
select distinct tm.user_id, mr.role_id, tm.tenant_id, null::uuid, null::uuid
from core.membership_roles mr
join core.tenant_memberships tm on tm.id = mr.membership_id;

-- ----------------------------------------------------------------------------
-- 5. tenant.branch  <- core.locations   (MAP, 4 rows)
--   id/business_id preserved. status: active->active, else->closed (all 4 active).
--   timezone NULL (inherit business).
--   DROP columns: slug (naming/derived), aliases (empty), descriptor (null),
--     metadata (legacy {source_system,source_location_id} linkage),
--     search_text (generated).
--   KEEP lat/lng: all 4 locations have real captured coordinates (owner: preserve).
-- ----------------------------------------------------------------------------
insert into tenant.branch (id, business_id, name, address, lat, lng, timezone, status, created_at, updated_at)
select l.id, l.tenant_id, l.name, l.address, l.lat, l.lng, null::text,
       case l.status when 'active' then 'active' else 'closed' end,
       l.created_at, l.updated_at
from core.locations l;

-- ----------------------------------------------------------------------------
-- 6. tenant.staff  <- core.staff_members  (MAP, 8 of 11 rows)
--   ONLY rows with a real user_id (login lives on umi.user; user_id is NOT NULL).
--   id preserved. business_id=tenant_id, branch_id=location_id (all NULL here).
--   position NULL, hired_at NULL. status: active->active, else->inactive (all active).
--   unique(business_id,user_id) holds (verified: no dup tenant/user).
--   DROP columns: name/email (live on umi.user via user_id), phone (all empty),
--     metadata (legacy source linkage).
--   DROPPED ROWS: 3 'System (migration)' synthetic staff (user_id NULL) — not real
--     employees, no login; existed only for legacy FK defaults. Migrated
--     loyalty_visit/ledger already carry staff_id NULL for these.
-- ----------------------------------------------------------------------------
insert into tenant.staff (id, business_id, branch_id, user_id, position, hired_at, status, created_at, updated_at)
select s.id, s.tenant_id, s.location_id, s.user_id, null::text, null::date,
       case s.status when 'active' then 'active' else 'inactive' end,
       s.created_at, s.updated_at
from core.staff_members s
where s.user_id is not null;

-- ============================================================================
-- RECONCILE (run AFTER the inserts)
-- ============================================================================
-- select 'umi.user'        t, count(*) from umi.user        -- expect 9
-- union all select 'umi.role',        count(*) from umi.role         -- expect 4
-- union all select 'umi.permission',  count(*) from umi.permission   -- expect 4
-- union all select 'umi.user_role',   count(*) from umi.user_role    -- expect 12
-- union all select 'tenant.branch',   count(*) from tenant.branch    -- expect 4
-- union all select 'tenant.staff',    count(*) from tenant.staff;    -- expect 8
--
-- select count(*) orphan_user from umi.user_role ur left join umi.user u on u.id=ur.user_id where u.id is null;                     -- expect 0
-- select count(*) orphan_role from umi.user_role ur left join umi.role r on r.id=ur.role_id where r.id is null;                     -- expect 0
-- select count(*) orphan_biz  from umi.user_role ur left join tenant.business b on b.id=ur.business_id where b.id is null;          -- expect 0
-- select count(*) orphan_staff from tenant.staff s left join umi.user u on u.id=s.user_id where u.id is null;                       -- expect 0
-- No money/stamp sums in this domain.
