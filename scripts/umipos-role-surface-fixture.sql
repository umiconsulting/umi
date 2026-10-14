\set ON_ERROR_STOP on

-- Role-surface gate fixture.
--
-- WHY THIS EXISTS. `scripts/umipos-role-surface-gate.mjs` answers one question:
-- does the API refuse every role the Dashboard hides, and allow every role it
-- shows? It reads the merchant and the four logins from
-- `config/umipos-surface-permissions.json`, and it refuses to pass a row it could
-- not test — "a role that cannot sign in is a failure, not a skip".
--
-- The rehearsal copy cannot answer that question on its own. Three rows are
-- missing, and each one turns a measurement into a false verdict:
--
--   1 · THE POS ENTITLEMENT. UmiPOS is sold, not bundled into a public plan
--       (`docs/migration/build-v3/migrations/002_onca_onboarding.sql` writes the
--       same override for ONCA, and its comment is the authority on this). Every
--       `@RequireProduct('pos')` route then answers 403 `product_not_active` for
--       EVERY role. A `refused` verdict would pass there for the wrong reason, and
--       an `allowed` verdict could never pass at all.
--   2 · THE MANAGER LOGIN. The contract names `ux-sweep@kalalacafe.mx` and says
--       the row does not exist out of the box. Without it, every manager row is
--       "not tested".
--   3 · THE OWNER MEMBERSHIP. `hola@umiconsulting.co` holds the platform role and
--       a membership of a different café in that copy, so the owner verdicts would
--       be measured at a door this contract does not describe.
--
-- Run it only in the disposable database the runner creates from the rehearsal
-- copy: `scripts/umipos-role-surface-fixture.sh`.
--
-- The two password hashes are scrypt(password, salt, 64) for the shared local
-- rehearsal password `Umi2026!` — the same shape and the same documented password
-- as `scripts/umi-pos-gate5a-live-fixture.sql`. A fixture, not an example.

begin;

-- 1 · The POS entitlement this café bought.
insert into umi.entitlement_override (subscription_id, feature_id, enabled, reason)
select s.id, f.id, true,
       'role-surface gate fixture (2026-10-10): UmiPOS granted so the pos-gated surfaces can be measured'
  from merchant.merchant m
  join umi.subscription s on s.merchant_id = m.id
  join umi.feature f on f.key = 'pos'
 where m.id = '1860305f-e864-d745-29e6-fb8830926cc6'::uuid
   and not exists (
     select 1 from umi.entitlement_override o
      where o.subscription_id = s.id and o.feature_id = f.id
   );

-- 2 · The manager login the contract names.
insert into umi."user" (email, full_name, status, password_hash, password_salt, password_algorithm)
select 'ux-sweep@kalalacafe.mx', 'UX Sweep (manager)', 'active',
       '75e549f9765f2b7d21670dd01cd93ea5fab74b5bc59dc4ad31b9f1f7ccf383c730e5ed8ac7acf8981e3afaf393fed15a32d5d73648e59b7479d1d020b923c600',
       '612a709da0aed0ed0d33b0912a25eb11', 'scrypt-sha256-v1'
 where not exists (
   select 1 from umi."user" u where lower(u.email) = 'ux-sweep@kalalacafe.mx'
 );

-- `role_id` is the sealed catalogue row the API's fallback reads; `merchant_role_id`
-- is the café's own role, which is where the 128 manager permissions live.
insert into merchant.staff (merchant_id, user_id, role_id, merchant_role_id, name, email, status)
select m.id, u.id, ur.id, mr.id, 'UX Sweep (manager)', u.email, 'active'
  from merchant.merchant m
  join umi."user" u on lower(u.email) = 'ux-sweep@kalalacafe.mx'
  join umi.role ur on ur.key = 'manager'
  join merchant.role mr on mr.merchant_id = m.id and mr.key = 'manager'
 where m.id = '1860305f-e864-d745-29e6-fb8830926cc6'::uuid
   and not exists (
     select 1 from merchant.staff s where s.merchant_id = m.id and s.user_id = u.id
   );

-- 3 · The owner membership, and the local rehearsal password on that account.
update umi."user"
   set password_hash = 'e514b830de5067c1847d8028e002fa53054946c06de3942a94ab060971361815392b7362a7c9f3dcb8dcdc0c55f64eebb49363438f3dbf74b9931b7a4b41044c',
       password_salt = 'bc5847b3184062f8a9f75fa3f5c123d2',
       password_algorithm = 'scrypt-sha256-v1',
       status = 'active'
 where lower(email) = 'hola@umiconsulting.co';

insert into merchant.staff (merchant_id, user_id, role_id, merchant_role_id, name, email, status)
select m.id, u.id, ur.id, mr.id, 'Umi (owner)', u.email, 'active'
  from merchant.merchant m
  join umi."user" u on lower(u.email) = 'hola@umiconsulting.co'
  join umi.role ur on ur.key = 'owner'
  join merchant.role mr on mr.merchant_id = m.id and mr.key = 'owner'
 where m.id = '1860305f-e864-d745-29e6-fb8830926cc6'::uuid
   and not exists (
     select 1 from merchant.staff s where s.merchant_id = m.id and s.user_id = u.id
   );

commit;
