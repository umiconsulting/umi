-- ============================================================================
-- build-v3 backfill · DOMAIN: Identity & principals   [APPROVED — adversarial review]
-- Source DB: umi_backfill_v3 (legacy core.* / auth.*)  ->  target umi.* / merchant.* / runtime.*
-- READ-ONLY verified: every SELECT side resolves. Do NOT run the INSERTs until cutover.
-- FK/insert order: umi.user, umi.role, umi.permission
--                  (merchant.merchant already backfilled) -> merchant.location -> merchant.staff
--                  merchant.staff is where the memberships land now; see step 4/6.
--
-- IDs are PRESERVED from source where a target row is a 1:1 carry (users, roles,
-- permissions, locations, staff) so downstream FKs (grants, visits, ledger) line up.
--
-- Review notes (verified against live source umi_backfill_v3):
--   * 9 users, 4 roles (all tenant_id NULL), 4 permissions, 0 role_permissions,
--     12 memberships (all 'active'), 12 membership_roles = 12 distinct grants,
--     4 locations (all 'active', lat/lng populated), 11 staff (8 with user_id).
--   * (SUPERSEDED) umi.user.email is nullable now, so an empty source email carries as
--     NULL. An address is synthesized ONLY where the credential is kept, because
--     user_login_ck refuses a password with no address beside it.
--   * CF dashboard user 2973fcd6 has EMPTY email but HOLDS an admin grant
--     (1 membership) -> it MUST be carried (dropping it orphans a umi.user_role row);
--     email is synthesized to satisfy NOT NULL + unique(lower(email)).
--   * hola@umiconsulting.co holds admin on 4 merchants (NOT 5) -> 4 grant rows.
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
       -- umi.user.email is NULLABLE now, so an empty source email carries as NULL —
       -- no invented address in the identity table. The synthesis survives for ONE
       -- case: a user whose credential we keep CAN log in, and user_login_ck requires
       -- an address beside a password. That is the CF dashboard user 2973fcd6.
       case when keep_cred
            then coalesce(nullif(email,''), 'migrated+'||id::text||'@umi.invalid')
            else nullif(email,'') end,
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
--   is_platform=false (no platform/superadmin role in source; the cross-merchant
--   superadmin is modeled as admin-on-every-merchant grants, not a role flag).
--   DROP column: tenant_id (target umi.role is a global catalog).
-- ----------------------------------------------------------------------------
insert into umi.role (id, key, name, description, is_platform, created_at)
select r.id, r.key, r.name, r.description, false, r.created_at
from core.roles r;

-- ----------------------------------------------------------------------------
-- 3. umi.permission  <- core.permissions  (MAP, 4 rows)
--   keys: insights.read, loyalty.operate, orders.operate, merchant.manage (no CHECK).
-- ----------------------------------------------------------------------------
insert into umi.permission (id, key, description, created_at)
select p.id, p.key, p.description, p.created_at
from core.permissions p;

-- core.role_permissions (0 rows) -> umi.role_permission : EMPTY.
--   role<->permission wiring is (re)seeded by the RBAC seed, not migrated.

-- ----------------------------------------------------------------------------
-- 4. (REMOVED) umi.user_role no longer receives the memberships.
--
--   umi.user_role became a PLATFORM-only grant: an Umi operator's cross-merchant role,
--   with no merchant_id. A café's role now lives on merchant.staff.role_id, so a
--   membership IS an employment and the two source tables fuse into ONE target row.
--   That fusion is step 6 below.
--
--   hola@umiconsulting.co's 4 admin grants are NOT carried. The owner decision of
--   2026-07-21 (see seed_rbac.sql) replaced admin-on-every-merchant with one real
--   platform-wide super_admin row, which the seed inserts.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 5. merchant.location  <- core.locations   (MAP, 4 rows)
--   id/merchant_id preserved. status: active->active, else->closed (all 4 active).
--   timezone NULL (inherit merchant).
--   DROP columns: slug (naming/derived), aliases (empty), descriptor (null),
--     metadata (legacy {source_system,source_location_id} linkage),
--     search_text (generated).
--   KEEP lat/lng: all 4 locations have real captured coordinates (owner: preserve).
-- ----------------------------------------------------------------------------
insert into merchant.location (id, merchant_id, name, address, lat, lng, timezone, status, created_at, updated_at)
select l.id, l.tenant_id, l.name, l.address, l.lat, l.lng, null::text,
       case l.status when 'active' then 'active' else 'closed' end,
       l.created_at, l.updated_at
from core.locations l;

-- ----------------------------------------------------------------------------
-- 6. merchant.staff  <- core.staff_members  FUSED WITH  core.tenant_memberships
--
--   The membership and the employment are now ONE row. A membership is what gives a
--   person a role at a café, and merchant.staff is where a café's role lives, so
--   carrying them separately would put the same fact in two tables.
--
--   Two source populations, one target:
--     6a. staff_members with a user_id (8 of 11) — the employment is the base row, and
--         it takes the role from that user's membership at the same merchant.
--     6b. membership holders with NO staff_members row — they are still real people
--         with real authority (a dashboard-only owner), so they need an employment.
--         name comes from umi.user.full_name, because there is no employment record
--         to take it from.
--
--   role_id: from core.membership_roles. Where a staff row has no membership at that
--   merchant, it falls back to the 'staff' catalog role — the least authority we can
--   give a person who demonstrably worked there. role_id is NOT NULL, so there is no
--   third option.
--
--   name/phone/email are now CARRIED, not dropped. The target holds the merchant's own
--   record of the employee; the review note "phone all empty" still applies, so those
--   land NULL from a NULLIF.
--
--   status: source active->active, else->disabled ('inactive' left the CHECK).
--   user_id is NOT NULL in the target, so the 3 synthetic staff below stay dropped. A
--   PIN-only operator also carries a user_id — their umi.user simply has no email and
--   no password — but the source predates the POS and has none to carry.
--
--   DROPPED ROWS: 3 'System (migration)' synthetic staff (user_id NULL) — not real
--     employees, no login; existed only for legacy FK defaults. Migrated
--     loyalty_visit/ledger already carry staff_id NULL for these.
--   DROPPED: hola@umiconsulting.co's 4 admin memberships (platform super_admin instead,
--     per seed_rbac.sql). The NOT EXISTS below is what excludes them.
--
--   ⚠ VERIFY AT CUTOVER, against live umi_backfill_v3 — these counts are NOT confirmed:
--     * how many of the 12 memberships belong to users who already have a staff_members
--       row at that same tenant (6a) and how many do not (6b);
--     * that no user holds TWO membership_roles at one merchant, which would make the
--       role_id pick ambiguous. If any does, the order by below decides it silently —
--       replace it with an explicit precedence before running.
-- ----------------------------------------------------------------------------
with grant_role as (
  -- One role per (user, merchant). `distinct on` is deterministic only because of the
  -- order by; see the verification note above.
  select distinct on (tm.user_id, tm.tenant_id)
         tm.user_id, tm.tenant_id, mr.role_id
  from core.membership_roles mr
  join core.tenant_memberships tm on tm.id = mr.membership_id
  join umi.user u on u.id = tm.user_id
  where u.email <> 'hola@umiconsulting.co'
  order by tm.user_id, tm.tenant_id, mr.role_id
)
-- 6a. the employments
insert into merchant.staff (id, merchant_id, location_id, user_id, role_id,
                            name, phone, email, position, hired_at, status,
                            created_at, updated_at)
select s.id, s.tenant_id, s.location_id, s.user_id,
       coalesce(g.role_id, (select id from umi.role where key = 'staff')),
       s.name, nullif(s.phone, ''), nullif(s.email, ''), null::text, null::date,
       case s.status when 'active' then 'active' else 'disabled' end,
       s.created_at, s.updated_at
from core.staff_members s
left join grant_role g on g.user_id = s.user_id and g.tenant_id = s.tenant_id
where s.user_id is not null;

-- 6b. the memberships with no employment record
insert into merchant.staff (merchant_id, location_id, user_id, role_id,
                            name, phone, email, position, hired_at, status)
select g.tenant_id, null::uuid, g.user_id, g.role_id,
       u.full_name, null::text, nullif(u.email, ''), null::text, null::date, 'active'
from (
  select distinct on (tm.user_id, tm.tenant_id)
         tm.user_id, tm.tenant_id, mr.role_id
  from core.membership_roles mr
  join core.tenant_memberships tm on tm.id = mr.membership_id
  join umi.user uu on uu.id = tm.user_id
  where uu.email <> 'hola@umiconsulting.co'
  order by tm.user_id, tm.tenant_id, mr.role_id
) g
join umi.user u on u.id = g.user_id
where not exists (
  select 1 from core.staff_members s
   where s.user_id = g.user_id and s.tenant_id = g.tenant_id and s.user_id is not null
);

-- ============================================================================
-- RECONCILE (run AFTER the inserts)
-- ============================================================================
-- select 'umi.user'        t, count(*) from umi.user        -- expect 9
-- union all select 'umi.role',        count(*) from umi.role         -- expect 4
-- union all select 'umi.permission',  count(*) from umi.permission   -- expect 4
-- union all select 'umi.user_role',   count(*) from umi.user_role    -- expect 0 here; the
--                                        RBAC seed adds 1 (hola@, platform super_admin)
-- union all select 'merchant.location',   count(*) from merchant.location    -- expect 4
-- union all select 'merchant.staff',    count(*) from merchant.staff;    -- expect 8 + step 6b
--                                        ⚠ 6b is unmeasured; see the VERIFY note on step 6
--
-- select count(*) orphan_user  from merchant.staff s left join umi.user u on u.id=s.user_id where s.user_id is not null and u.id is null;   -- expect 0
-- select count(*) orphan_role  from merchant.staff s left join umi.role r on r.id=s.role_id where r.id is null;                             -- expect 0
-- select count(*) orphan_biz   from merchant.staff s left join merchant.merchant b on b.id=s.merchant_id where b.id is null;                -- expect 0
-- Every carried membership must have become exactly one employment:
-- select count(*) lost_grant from (
--   select distinct tm.user_id, tm.tenant_id from core.membership_roles mr
--     join core.tenant_memberships tm on tm.id = mr.membership_id
--     join umi.user u on u.id = tm.user_id where u.email <> 'hola@umiconsulting.co') g
--   left join merchant.staff s on s.user_id = g.user_id and s.merchant_id = g.tenant_id
--   where s.id is null;                                                                     -- expect 0
-- No money/stamp sums in this domain.
