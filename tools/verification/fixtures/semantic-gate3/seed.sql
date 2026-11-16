-- Gate 3 semantic fixture, record gate3-semantic-fixture-v1.
--
-- The database is dropped and recreated before this file runs. Run as a role
-- that bypasses row level security (the local "postgres" role):
--
--   psql "$DATABASE_URL" -v d0=2026-11-16 \
--     -f tools/verification/fixtures/semantic-gate3/seed.sql
--
-- `d0` is the merchant local date at seed time. Section 3 of the verification
-- plan fixes every amount and every offset. Do not reseed between phases.

\set ON_ERROR_STOP on
\if :{?d0}
\else
  \echo 'missing -v d0=YYYY-MM-DD'
  \quit 1
\endif

BEGIN;

INSERT INTO merchant.merchant
  (id, name, legal_name, handle, city, timezone, currency, locale, status)
VALUES
  ('55555555-5555-4555-8555-000000000001', 'Gate 3 semantic fixture',
   'Gate 3 semantic fixture SA', 'gate3-semantic-fixture', 'Mazatlán',
   'America/Mazatlan', 'MXN', 'es-MX', 'active');

-- Centro is first, so the default location is Centro.
INSERT INTO merchant.location
  (id, merchant_id, name, address, payment_methods, timezone, status)
VALUES
  ('55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-000000000001',
   'Centro', 'Centro', '{cash,wallet}', 'America/Mazatlan', 'active'),
  ('55555555-5555-4555-8555-000000000012', '55555555-5555-4555-8555-000000000001',
   'Norte', 'Norte', '{cash}', 'America/Mazatlan', 'active');

INSERT INTO merchant.product_category (id, merchant_id, name, display_order, color)
VALUES
  ('55555555-5555-4555-8555-000000000021', '55555555-5555-4555-8555-000000000001',
   'Pan', 0, '#f58231'),
  ('55555555-5555-4555-8555-000000000022', '55555555-5555-4555-8555-000000000001',
   'Café', 1, '#4363d8');

INSERT INTO merchant.product
  (id, merchant_id, category_id, name, price, tax_rate_basis_points, sale_action)
VALUES
  ('55555555-5555-4555-8555-000000000031', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000021', 'Concha', 10000, 0, 'merchandise'),
  ('55555555-5555-4555-8555-000000000032', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000022', 'Café americano', 10000, 0, 'merchandise'),
  ('55555555-5555-4555-8555-000000000033', '55555555-5555-4555-8555-000000000001',
   NULL, 'Producto sin categoría', 10000, 0, 'merchandise');

-- Three accounts. The password material is copied from the local platform
-- administrator that scripts/umi-local-platform-admin.sh creates.
INSERT INTO umi."user"
  (id, email, password_hash, password_salt, password_algorithm, full_name, status)
SELECT v.id::uuid, v.email, u.password_hash, u.password_salt, u.password_algorithm,
       v.full_name, 'active'
FROM (VALUES
  ('55555555-5555-4555-8555-000000000041', 'gate3.centro@example.test', 'Administración'),
  ('55555555-5555-4555-8555-000000000042', 'gate3.all@example.test', 'Gate 3 all'),
  ('55555555-5555-4555-8555-000000000043', 'gate3.bound@example.test', 'Gate 3 bound'),
  ('55555555-5555-4555-8555-000000000044', 'gate3.norte@example.test', 'Administración')
) AS v(id, email, full_name)
CROSS JOIN umi."user" AS u
WHERE u.email = 'hola@umiconsulting.co';

INSERT INTO umi.role (id, key, name, description, is_platform)
VALUES
  ('55555555-5555-4555-8555-0000000000a1', 'gate3_read_all', 'Gate 3 read all',
   'API account with no location scope', false),
  ('55555555-5555-4555-8555-0000000000a2', 'gate3_bound', 'Gate 3 bound',
   'API account bound to Centro', false);

INSERT INTO umi.role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM umi.role AS r
JOIN umi.permission AS p ON p.key = 'sale.lifecycle'
WHERE r.key IN ('gate3_read_all', 'gate3_bound');

INSERT INTO merchant.staff
  (id, merchant_id, location_id, user_id, role_id, name, status)
SELECT v.id::uuid, '55555555-5555-4555-8555-000000000001', v.location_id::uuid,
       v.user_id::uuid, r.id, v.name, 'active'
FROM (VALUES
  ('55555555-5555-4555-8555-000000000051', NULL, '55555555-5555-4555-8555-000000000041', 'owner', 'Administración'),
  ('55555555-5555-4555-8555-000000000052', NULL, '55555555-5555-4555-8555-000000000042', 'gate3_read_all', 'Gate 3 all'),
  ('55555555-5555-4555-8555-000000000053', '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-000000000043', 'gate3_bound', 'Gate 3 bound'),
  ('55555555-5555-4555-8555-000000000054', '55555555-5555-4555-8555-000000000012', '55555555-5555-4555-8555-000000000044', 'owner', 'Administración')
) AS v(id, location_id, user_id, role_key, name)
JOIN umi.role AS r ON r.key = v.role_key;

INSERT INTO umi.subscription
  (id, merchant_id, plan_id, status, current_period_start, current_period_end, started_at)
SELECT '55555555-5555-4555-8555-0000000000f1', '55555555-5555-4555-8555-000000000001',
       p.id, 'active', now() - interval '1 day', now() + interval '364 days',
       now() - interval '1 day'
FROM umi.plan AS p WHERE p.key = 'pro';

INSERT INTO merchant.device
  (id, merchant_id, location_id, name, kind, platform, status)
VALUES
  ('55555555-5555-4555-8555-000000000061', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', 'Fixture Centro', 'pos_terminal', 'linux', 'active'),
  ('55555555-5555-4555-8555-000000000062', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000012', 'Fixture Norte', 'pos_terminal', 'linux', 'active');

INSERT INTO runtime.session
  (id, merchant_id, principal_type, principal_id, token_hash, expires_at)
VALUES
  ('55555555-5555-4555-8555-000000000071', '55555555-5555-4555-8555-000000000001',
   'user', '55555555-5555-4555-8555-000000000041', repeat('7', 64), now() + interval '1 day'),
  ('55555555-5555-4555-8555-000000000072', '55555555-5555-4555-8555-000000000001',
   'user', '55555555-5555-4555-8555-000000000044', repeat('8', 64), now() + interval '1 day');

INSERT INTO runtime.operator_session
  (id, durable_session_id, user_id, staff_id, device_id, merchant_id, location_id,
   state, permissions, entitlements, expires_at)
VALUES
  ('55555555-5555-4555-8555-000000000073', '55555555-5555-4555-8555-000000000071',
   '55555555-5555-4555-8555-000000000041', '55555555-5555-4555-8555-000000000051',
   '55555555-5555-4555-8555-000000000061', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', 'active', '{sale.lifecycle}', '[]',
   now() + interval '1 day'),
  ('55555555-5555-4555-8555-000000000074', '55555555-5555-4555-8555-000000000072',
   '55555555-5555-4555-8555-000000000044', '55555555-5555-4555-8555-000000000054',
   '55555555-5555-4555-8555-000000000062', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000012', 'active', '{sale.lifecycle}', '[]',
   now() + interval '1 day');

INSERT INTO merchant.physical_register
  (id, merchant_id, location_id, display_name, public_reference, currency,
   assigned_device_id, status)
VALUES
  ('55555555-5555-4555-8555-000000000081', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', 'Caja Centro', 'GATE3-CENTRO', 'MXN',
   '55555555-5555-4555-8555-000000000061', 'assigned'),
  ('55555555-5555-4555-8555-000000000082', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000012', 'Caja Norte', 'GATE3-NORTE', 'MXN',
   '55555555-5555-4555-8555-000000000062', 'assigned');

INSERT INTO merchant.cash_shift
  (id, merchant_id, location_id, register_id, device_id, device_credential_version,
   holding_device_id, holding_device_credential_version, opening_operator_id,
   responsible_operator_id, operator_session_id, currency, business_date, status,
   opening_command_id, opening_float_minor_units, ledger_sequence)
VALUES
  ('55555555-5555-4555-8555-000000000083', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-000000000081',
   '55555555-5555-4555-8555-000000000061', 1, '55555555-5555-4555-8555-000000000061', 1,
   '55555555-5555-4555-8555-000000000041', '55555555-5555-4555-8555-000000000041',
   '55555555-5555-4555-8555-000000000073', 'MXN', :'d0'::date, 'open',
   '55555555-5555-4555-8555-000000000084', 0, 0),
  ('55555555-5555-4555-8555-000000000085', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000012', '55555555-5555-4555-8555-000000000082',
   '55555555-5555-4555-8555-000000000062', 1, '55555555-5555-4555-8555-000000000062', 1,
   '55555555-5555-4555-8555-000000000044', '55555555-5555-4555-8555-000000000044',
   '55555555-5555-4555-8555-000000000074', 'MXN', :'d0'::date, 'open',
   '55555555-5555-4555-8555-000000000086', 0, 0);

UPDATE merchant.physical_register SET current_shift_id = '55555555-5555-4555-8555-000000000083'
WHERE id = '55555555-5555-4555-8555-000000000081';
UPDATE merchant.physical_register SET current_shift_id = '55555555-5555-4555-8555-000000000085'
WHERE id = '55555555-5555-4555-8555-000000000082';

INSERT INTO merchant.pos_cart
  (id, merchant_id, location_id, operator_session_id, status, version, business_date,
   lifecycle_state, original_operator_session_id, original_operator_user_id,
   operator_user_id, origin_channel, fulfillment_type)
VALUES
  ('55555555-5555-4555-8555-0000000000a1', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-000000000073',
   'committed', 1, :'d0'::date, 'committed', '55555555-5555-4555-8555-000000000073',
   '55555555-5555-4555-8555-000000000041', '55555555-5555-4555-8555-000000000041',
   'walk_in', 'dine_in'),
  ('55555555-5555-4555-8555-0000000000a2', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-000000000073',
   'committed', 1, :'d0'::date, 'committed', '55555555-5555-4555-8555-000000000073',
   '55555555-5555-4555-8555-000000000041', '55555555-5555-4555-8555-000000000041',
   'walk_in', 'dine_in'),
  ('55555555-5555-4555-8555-0000000000a3', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-000000000073',
   'committed', 1, :'d0'::date - 1, 'committed', '55555555-5555-4555-8555-000000000073',
   '55555555-5555-4555-8555-000000000041', '55555555-5555-4555-8555-000000000041',
   'walk_in', 'dine_in'),
  ('55555555-5555-4555-8555-0000000000a4', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000012', '55555555-5555-4555-8555-000000000074',
   'committed', 1, :'d0'::date - 3, 'committed', '55555555-5555-4555-8555-000000000074',
   '55555555-5555-4555-8555-000000000044', '55555555-5555-4555-8555-000000000044',
   'whatsapp', 'takeout'),
  ('55555555-5555-4555-8555-0000000000a5', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-000000000073',
   'committed', 1, :'d0'::date - 8, 'committed', '55555555-5555-4555-8555-000000000073',
   '55555555-5555-4555-8555-000000000041', '55555555-5555-4555-8555-000000000041',
   'walk_in', 'takeout');

INSERT INTO merchant.customer_order
  (id, merchant_id, location_id, source, fulfillment_type, status, business_date, placed_at)
VALUES
  ('55555555-5555-4555-8555-0000000000b1', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', 'pos', 'dine_in', 'completed', :'d0'::date,
   ((:'d0'::date)::timestamp + time '09:15') AT TIME ZONE 'America/Mazatlan'),
  ('55555555-5555-4555-8555-0000000000b2', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', 'pos', 'dine_in', 'completed', :'d0'::date,
   ((:'d0'::date)::timestamp + time '17:40') AT TIME ZONE 'America/Mazatlan'),
  ('55555555-5555-4555-8555-0000000000b3', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', 'pos', 'dine_in', 'completed', :'d0'::date - 1,
   ((:'d0'::date - 1)::timestamp + time '12:05') AT TIME ZONE 'America/Mazatlan'),
  ('55555555-5555-4555-8555-0000000000b4', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000012', 'pos', 'pickup', 'completed', :'d0'::date - 3,
   ((:'d0'::date - 3)::timestamp + time '10:30') AT TIME ZONE 'America/Mazatlan'),
  ('55555555-5555-4555-8555-0000000000b5', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', 'pos', 'pickup', 'completed', :'d0'::date - 8,
   ((:'d0'::date - 8)::timestamp + time '19:20') AT TIME ZONE 'America/Mazatlan');

INSERT INTO merchant.pos_payment_attempt
  (id, merchant_id, location_id, cart_id, method, amount_minor_units, currency, status,
   correlation_id, proof_source)
VALUES
  ('55555555-5555-4555-8555-0000000000c1', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000a1',
   'cash', 19500, 'MXN', 'succeeded', 'gate3-s1', 'cash'),
  ('55555555-5555-4555-8555-0000000000c2', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000a2',
   'cash', 9000, 'MXN', 'succeeded', 'gate3-s2', 'cash'),
  ('55555555-5555-4555-8555-0000000000c3', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000a3',
   'cash', 18000, 'MXN', 'succeeded', 'gate3-s3', 'cash'),
  ('55555555-5555-4555-8555-0000000000c4', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000012', '55555555-5555-4555-8555-0000000000a4',
   'cash', 9000, 'MXN', 'succeeded', 'gate3-s4', 'cash'),
  ('55555555-5555-4555-8555-0000000000c5', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000a5',
   'cash', 10000, 'MXN', 'succeeded', 'gate3-s5', 'cash');

INSERT INTO merchant.pos_checkout_draft
  (id, merchant_id, location_id, cart_id, operator_session_id, device_id, state, version,
   receipt_delivery)
VALUES
  ('55555555-5555-4555-8555-0000000000f1', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000a1',
   '55555555-5555-4555-8555-000000000073', '55555555-5555-4555-8555-000000000061',
   'completed', 1, '{"destination":"display"}'),
  ('55555555-5555-4555-8555-0000000000f2', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000a2',
   '55555555-5555-4555-8555-000000000073', '55555555-5555-4555-8555-000000000061',
   'completed', 1, '{"destination":"display"}'),
  ('55555555-5555-4555-8555-0000000000f3', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000a3',
   '55555555-5555-4555-8555-000000000073', '55555555-5555-4555-8555-000000000061',
   'completed', 1, '{"destination":"display"}'),
  ('55555555-5555-4555-8555-0000000000f4', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000012', '55555555-5555-4555-8555-0000000000a4',
   '55555555-5555-4555-8555-000000000074', '55555555-5555-4555-8555-000000000062',
   'completed', 1, '{"destination":"display"}'),
  ('55555555-5555-4555-8555-0000000000f5', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000a5',
   '55555555-5555-4555-8555-000000000073', '55555555-5555-4555-8555-000000000061',
   'completed', 1, '{"destination":"display"}');

INSERT INTO merchant.pos_cart_line
  (id, merchant_id, cart_id, product_id, identity_key, product_name, quantity, base_price,
   tax_rate_basis_points)
VALUES
  ('55555555-5555-4555-8555-000000000131', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-0000000000a1', '55555555-5555-4555-8555-000000000031',
   repeat('1', 64), 'Concha', 1, 10000, 0),
  ('55555555-5555-4555-8555-000000000132', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-0000000000a1', '55555555-5555-4555-8555-000000000032',
   repeat('2', 64), 'Café americano', 1, 10000, 0),
  ('55555555-5555-4555-8555-000000000133', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-0000000000a2', '55555555-5555-4555-8555-000000000031',
   repeat('3', 64), 'Concha', 1, 10000, 0),
  ('55555555-5555-4555-8555-000000000134', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-0000000000a3', '55555555-5555-4555-8555-000000000031',
   repeat('4', 64), 'Concha', 1, 10000, 0),
  ('55555555-5555-4555-8555-000000000135', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-0000000000a3', '55555555-5555-4555-8555-000000000032',
   repeat('5', 64), 'Café americano', 1, 10000, 0),
  ('55555555-5555-4555-8555-000000000136', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-0000000000a4', '55555555-5555-4555-8555-000000000032',
   repeat('6', 64), 'Café americano', 1, 10000, 0),
  ('55555555-5555-4555-8555-000000000137', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-0000000000a5', '55555555-5555-4555-8555-000000000033',
   repeat('7', 64), 'Producto sin categoría', 1, 10000, 0);

INSERT INTO merchant.receipt_snapshot
  (id, merchant_id, location_id, order_id, payment_attempt_id, receipt_number,
   business_date, currency, grand_total, snapshot)
VALUES
  ('55555555-5555-4555-8555-0000000000d1', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000b1',
   '55555555-5555-4555-8555-0000000000c1', 'GATE3-S1', :'d0'::date, 'MXN', 19500,
   jsonb_build_object('currency','MXN',
     'grandTotal', jsonb_build_object('currency','MXN','minorUnits',19500),
     'discountTotal', jsonb_build_object('currency','MXN','minorUnits',2000),
     'tip', jsonb_build_object('currency','MXN','minorUnits',1500),
     'lines', jsonb_build_array(
       jsonb_build_object('lineRef','55555555-5555-4555-8555-000000000131','description','Concha','quantity',1,
         'lineTotal', jsonb_build_object('currency','MXN','minorUnits',10000),
         'discount', jsonb_build_object('currency','MXN','minorUnits',1000),
         'tip', jsonb_build_object('currency','MXN','minorUnits',0)),
       jsonb_build_object('lineRef','55555555-5555-4555-8555-000000000132','description','Café americano','quantity',1,
         'lineTotal', jsonb_build_object('currency','MXN','minorUnits',10000),
         'discount', jsonb_build_object('currency','MXN','minorUnits',1000),
         'tip', jsonb_build_object('currency','MXN','minorUnits',1500))))),
  ('55555555-5555-4555-8555-0000000000d2', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000b2',
   '55555555-5555-4555-8555-0000000000c2', 'GATE3-S2', :'d0'::date, 'MXN', 9000,
   jsonb_build_object('currency','MXN',
     'grandTotal', jsonb_build_object('currency','MXN','minorUnits',9000),
     'discountTotal', jsonb_build_object('currency','MXN','minorUnits',1000),
     'tip', jsonb_build_object('currency','MXN','minorUnits',0),
     'lines', jsonb_build_array(
       jsonb_build_object('lineRef','55555555-5555-4555-8555-000000000133','description','Concha','quantity',1,
         'lineTotal', jsonb_build_object('currency','MXN','minorUnits',10000),
         'discount', jsonb_build_object('currency','MXN','minorUnits',1000),
         'tip', jsonb_build_object('currency','MXN','minorUnits',0))))),
  ('55555555-5555-4555-8555-0000000000d3', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000b3',
   '55555555-5555-4555-8555-0000000000c3', 'GATE3-S3', :'d0'::date - 1, 'MXN', 18000,
   jsonb_build_object('currency','MXN',
     'grandTotal', jsonb_build_object('currency','MXN','minorUnits',18000),
     'discountTotal', jsonb_build_object('currency','MXN','minorUnits',2000),
     'tip', jsonb_build_object('currency','MXN','minorUnits',0),
     'lines', jsonb_build_array(
       jsonb_build_object('lineRef','55555555-5555-4555-8555-000000000134','description','Concha','quantity',1,
         'lineTotal', jsonb_build_object('currency','MXN','minorUnits',10000),
         'discount', jsonb_build_object('currency','MXN','minorUnits',1000),
         'tip', jsonb_build_object('currency','MXN','minorUnits',0)),
       jsonb_build_object('lineRef','55555555-5555-4555-8555-000000000135','description','Café americano','quantity',1,
         'lineTotal', jsonb_build_object('currency','MXN','minorUnits',10000),
         'discount', jsonb_build_object('currency','MXN','minorUnits',1000),
         'tip', jsonb_build_object('currency','MXN','minorUnits',0)))));

INSERT INTO merchant.receipt_snapshot
  (id, merchant_id, location_id, order_id, payment_attempt_id, receipt_number,
   business_date, currency, grand_total, snapshot)
VALUES
  ('55555555-5555-4555-8555-0000000000d4', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000012', '55555555-5555-4555-8555-0000000000b4',
   '55555555-5555-4555-8555-0000000000c4', 'GATE3-S4', :'d0'::date - 3, 'MXN', 9000,
   jsonb_build_object('currency','MXN',
     'grandTotal', jsonb_build_object('currency','MXN','minorUnits',9000),
     'discountTotal', jsonb_build_object('currency','MXN','minorUnits',1000),
     'tip', jsonb_build_object('currency','MXN','minorUnits',0),
     'lines', jsonb_build_array(
       jsonb_build_object('lineRef','55555555-5555-4555-8555-000000000136','description','Café americano','quantity',1,
         'lineTotal', jsonb_build_object('currency','MXN','minorUnits',10000),
         'discount', jsonb_build_object('currency','MXN','minorUnits',1000),
         'tip', jsonb_build_object('currency','MXN','minorUnits',0))))),
  ('55555555-5555-4555-8555-0000000000d5', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000b5',
   '55555555-5555-4555-8555-0000000000c5', 'GATE3-S5', :'d0'::date - 8, 'MXN', 10000,
   jsonb_build_object('currency','MXN',
     'grandTotal', jsonb_build_object('currency','MXN','minorUnits',10000),
     'discountTotal', jsonb_build_object('currency','MXN','minorUnits',0),
     'tip', jsonb_build_object('currency','MXN','minorUnits',0),
     'lines', jsonb_build_array(
       jsonb_build_object('lineRef','55555555-5555-4555-8555-000000000137','description','Producto sin categoría','quantity',1,
         'lineTotal', jsonb_build_object('currency','MXN','minorUnits',10000),
         'discount', jsonb_build_object('currency','MXN','minorUnits',0),
         'tip', jsonb_build_object('currency','MXN','minorUnits',0)))));

INSERT INTO merchant.pos_committed_sale
  (id, merchant_id, location_id, cart_id, order_id, payment_attempt_id,
   receipt_snapshot_id, totals_fingerprint, committed_at, cash_shift_id, origin_channel)
VALUES
  ('55555555-5555-4555-8555-0000000000e1', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000a1',
   '55555555-5555-4555-8555-0000000000b1', '55555555-5555-4555-8555-0000000000c1',
   '55555555-5555-4555-8555-0000000000d1', repeat('1', 64),
   ((:'d0'::date)::timestamp + time '09:15') AT TIME ZONE 'America/Mazatlan',
   '55555555-5555-4555-8555-000000000083', 'walk_in'),
  ('55555555-5555-4555-8555-0000000000e2', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000a2',
   '55555555-5555-4555-8555-0000000000b2', '55555555-5555-4555-8555-0000000000c2',
   '55555555-5555-4555-8555-0000000000d2', repeat('2', 64),
   ((:'d0'::date)::timestamp + time '17:40') AT TIME ZONE 'America/Mazatlan',
   '55555555-5555-4555-8555-000000000083', 'walk_in'),
  ('55555555-5555-4555-8555-0000000000e3', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000a3',
   '55555555-5555-4555-8555-0000000000b3', '55555555-5555-4555-8555-0000000000c3',
   '55555555-5555-4555-8555-0000000000d3', repeat('3', 64),
   ((:'d0'::date - 1)::timestamp + time '12:05') AT TIME ZONE 'America/Mazatlan',
   '55555555-5555-4555-8555-000000000083', 'walk_in'),
  ('55555555-5555-4555-8555-0000000000e4', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000012', '55555555-5555-4555-8555-0000000000a4',
   '55555555-5555-4555-8555-0000000000b4', '55555555-5555-4555-8555-0000000000c4',
   '55555555-5555-4555-8555-0000000000d4', repeat('4', 64),
   ((:'d0'::date - 3)::timestamp + time '10:30') AT TIME ZONE 'America/Mazatlan',
   '55555555-5555-4555-8555-000000000085', 'whatsapp'),
  ('55555555-5555-4555-8555-0000000000e5', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000a5',
   '55555555-5555-4555-8555-0000000000b5', '55555555-5555-4555-8555-0000000000c5',
   '55555555-5555-4555-8555-0000000000d5', repeat('5', 64),
   ((:'d0'::date - 8)::timestamp + time '19:20') AT TIME ZONE 'America/Mazatlan',
   '55555555-5555-4555-8555-000000000083', 'walk_in');

INSERT INTO merchant.pos_tender_fact
  (id, merchant_id, location_id, checkout_id, cart_id, position, tender_type, status,
   amount_minor_units, received_minor_units, change_minor_units, currency, committed_at)
VALUES
  ('55555555-5555-4555-8555-000000000101', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000f1',
   '55555555-5555-4555-8555-0000000000a1', 0, 'cash', 'committed', 19500, 19500, 0, 'MXN',
   ((:'d0'::date)::timestamp + time '09:15') AT TIME ZONE 'America/Mazatlan'),
  ('55555555-5555-4555-8555-000000000102', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000f2',
   '55555555-5555-4555-8555-0000000000a2', 0, 'cash', 'committed', 9000, 9000, 0, 'MXN',
   ((:'d0'::date)::timestamp + time '17:40') AT TIME ZONE 'America/Mazatlan'),
  ('55555555-5555-4555-8555-000000000103', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000f3',
   '55555555-5555-4555-8555-0000000000a3', 0, 'cash', 'committed', 18000, 18000, 0, 'MXN',
   ((:'d0'::date - 1)::timestamp + time '12:05') AT TIME ZONE 'America/Mazatlan'),
  ('55555555-5555-4555-8555-000000000104', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000012', '55555555-5555-4555-8555-0000000000f4',
   '55555555-5555-4555-8555-0000000000a4', 0, 'cash', 'committed', 9000, 9000, 0, 'MXN',
   ((:'d0'::date - 3)::timestamp + time '10:30') AT TIME ZONE 'America/Mazatlan'),
  ('55555555-5555-4555-8555-000000000105', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000f5',
   '55555555-5555-4555-8555-0000000000a5', 0, 'cash', 'committed', 10000, 10000, 0, 'MXN',
   ((:'d0'::date - 8)::timestamp + time '19:20') AT TIME ZONE 'America/Mazatlan');

-- The S1 wallet allocation is a second payment row. It is location-scoped, so
-- all-locations cases exclude it through RLS. It does not change the grand total.
INSERT INTO merchant.customer_value_authorization
  (id, merchant_id, location_id, account_type, account_id, sale_id, checkout_version,
   amount_minor_units, currency, checkout_fingerprint, policy_version, command_id,
   idempotency_key, command_fingerprint, status, expires_at, committed_at, correlation_id)
VALUES
  ('55555555-5555-4555-8555-000000000120', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', 'wallet',
   '55555555-5555-4555-8555-000000000122', '55555555-5555-4555-8555-0000000000a1', 1,
   5000, 'MXN', repeat('a', 64), 'wallet-pilot',
   '55555555-5555-4555-8555-000000000120', '55555555-5555-4555-8555-000000000120',
   repeat('b', 64), 'committed', now() + interval '1 day',
   ((:'d0'::date)::timestamp + time '09:15') AT TIME ZONE 'America/Mazatlan', 'gate3-s1-wallet');

INSERT INTO merchant.customer_value_tender_allocation
  (merchant_id, location_id, sale_id, checkout_id, checkout_version, allocation_id,
   tender_type, account_id, account_public_reference, authorization_id, currency,
   requested_minor_units, authorized_minor_units, committed_minor_units,
   remaining_balance_minor_units, allocation_order, cash_allocation_minor_units,
   manual_terminal_allocation_minor_units, wallet_allocation_ids, gift_card_allocation_ids,
   policy_id, policy_version, authorization_expires_at, command_id, idempotency_key,
   optimistic_version, fingerprint, committed_at)
VALUES
  ('55555555-5555-4555-8555-000000000001', '55555555-5555-4555-8555-000000000011',
   '55555555-5555-4555-8555-0000000000e1', '55555555-5555-4555-8555-0000000000f1', 1,
   '55555555-5555-4555-8555-000000000121', 'wallet', '55555555-5555-4555-8555-000000000122',
   'GATE3-WALLET', '55555555-5555-4555-8555-000000000120', 'MXN', 5000, 5000, 5000, 0, 0,
   19500, 0, ARRAY['55555555-5555-4555-8555-000000000120']::uuid[], '{}'::uuid[],
   'wallet-pilot', 'wallet-pilot-v1', now() + interval '1 day',
   '55555555-5555-4555-8555-000000000120', '55555555-5555-4555-8555-000000000120', 1,
   repeat('c', 64), ((:'d0'::date)::timestamp + time '09:15') AT TIME ZONE 'America/Mazatlan');

-- R1: one partial refund of S1. Its exception date is D0-1. The metric
-- attributes it to the S1 sale date, D0.
INSERT INTO merchant.pos_exception_preview
  (id, merchant_id, location_id, sale_id, original_receipt_id, operator_session_id,
   device_id, exception_type, reason_code, selection, line_allocations, tender_allocations,
   allocation_policy, restock_intents, merchandise_minor_units, tax_minor_units,
   discount_minor_units, tip_minor_units, total_minor_units, remaining_after_minor_units,
   currency, approval_required, sale_version, exception_version, preview_fingerprint,
   correlation_id, expires_at)
VALUES
  ('55555555-5555-4555-8555-000000000110', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000e1',
   '55555555-5555-4555-8555-0000000000d1', '55555555-5555-4555-8555-000000000073',
   '55555555-5555-4555-8555-000000000061', 'partial_refund', 'customer_return', '[]', '[]',
   '[]', 'proportional', '[]', 10000, 0, 1000, 0, 9000, 10500, 'MXN', false, 1, 0,
   repeat('d', 64), 'gate3-refund', now() + interval '1 hour');

INSERT INTO merchant.pos_sale_exception
  (id, merchant_id, location_id, sale_id, original_receipt_id, preview_id,
   exception_type, status, reason_code, operator_id, operator_session_id, device_id,
   device_credential_version, command_id, idempotency_key, command_fingerprint,
   preview_fingerprint, merchandise_minor_units, tax_minor_units, discount_minor_units,
   tip_minor_units, total_minor_units, currency, business_date, correlation_id, committed_at)
VALUES
  ('55555555-5555-4555-8555-000000000111', '55555555-5555-4555-8555-000000000001',
   '55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-0000000000e1',
   '55555555-5555-4555-8555-0000000000d1', '55555555-5555-4555-8555-000000000110',
   'partial_refund', 'committed', 'customer_return',
   '55555555-5555-4555-8555-000000000041', '55555555-5555-4555-8555-000000000073',
   '55555555-5555-4555-8555-000000000061', 1, '55555555-5555-4555-8555-000000000111',
   '55555555-5555-4555-8555-000000000111', repeat('e', 64), repeat('d', 64),
   10000, 0, 1000, 0, 9000, 'MXN', :'d0'::date - 1, 'gate3-refund',
   ((:'d0'::date - 1)::timestamp + time '13:00') AT TIME ZONE 'America/Mazatlan');

COMMIT;
