\set ON_ERROR_STOP on

-- An administrator at ONCA, with a local credential.
--
-- WHY THIS EXISTS. `docs/migration/build-v3/migrations/002_onca_onboarding.sql` seeded ONCA
-- with four logins, and every one of them is `staff`: caja, barra, cocina and mesero. That
-- is the right shape for the people who stand at the till and the pass, and it means the
-- café has nobody who can do the two things that need `merchant.manage` — the owner's own
-- settings, and the upload of the café's logo (`PUT
-- /api/merchants/:id/branding/logo`, added with migration 014). Measured on 2026-10-11
-- against the disposable demo database: a staff login is refused with
-- `403 PERMISSION_DENIED`, and a login that is not a member at all with
-- `404 merchant_not_found`.
--
-- WHAT IT WRITES, in order:
--   1  the person      umi."user"       (admin@onca.mx, active, local credential)
--   2  the employment  merchant.staff   (role `admin` at ONCA, scoped to its location)
--
-- The password hash is scrypt(password, salt, 64) for the shared local rehearsal password
-- `Umi2026!` — the same shape, and the same documented password, as
-- `scripts/umipos-role-surface-fixture.sql` and `scripts/umi-pos-gate5a-live-fixture.sql`.
-- A fixture, not an example: this account exists so a person can sign into a DISPOSABLE
-- database. Change the password from the console (or re-run this file with a new salt and
-- hash) before it ever points at a café that is really trading.
--
-- Re-runnable: both statements carry their identity, so applying this twice repairs the
-- pair instead of stacking a second person or a second employment.

begin;

insert into umi."user" (id, email, full_name, status, password_salt, password_hash, password_algorithm)
values (
  '30000000-0000-4000-8000-000000000110',
  'admin@onca.mx',
  'Admin ONCA',
  'active',
  'a8d18172f797b78e49a95fdcf64f15e7',
  'eb20dd9aa0beef2ed26908142463af8c9a4360e9244ae8aacc2c8c4dadad114f057514fb3a383ee97172b51bd23f4b072780b1ec17929168c3e5d478e9d22490',
  'scrypt-sha256-v1'
)
on conflict (id) do update
  set email              = excluded.email,
      full_name          = excluded.full_name,
      status             = 'active',
      password_salt      = excluded.password_salt,
      password_hash      = excluded.password_hash,
      password_algorithm = excluded.password_algorithm;

insert into merchant.staff (id, merchant_id, location_id, user_id, role_id, name, email, position, status)
select '40000000-0000-4000-8000-000000000110',
       m.id,
       (select l.id from merchant.location l where l.merchant_id = m.id order by l.name limit 1),
       u.id,
       r.id,
       'Admin ONCA',
       u.email,
       'Administración',
       'active'
  from merchant.merchant m
  join umi."user" u on lower(u.email) = 'admin@onca.mx'
  join umi.role r on r.key = 'admin'
 where m.handle = 'onca'
on conflict (merchant_id, user_id) do update
  set role_id     = excluded.role_id,
      location_id = excluded.location_id,
      status      = 'active';

select s.id::text as staff_id, u.email, r.key as role, m.name as merchant
  from merchant.staff s
  join umi."user" u on u.id = s.user_id
  join umi.role r on r.id = s.role_id
  join merchant.merchant m on m.id = s.merchant_id
 where u.email = 'admin@onca.mx';

commit;
