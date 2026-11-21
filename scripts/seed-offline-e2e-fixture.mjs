#!/usr/bin/env node
/**
 * Seeds a self-contained disposable café fixture into PostgreSQL for the
 * Tier 3 real Dart -> HTTP -> NestJS -> PostgreSQL offline-first E2E smoke test.
 *
 * Prints a single JSON manifest to stdout describing the seeded IDs, PIN, and
 * device credentials so the Dart E2E harness can drive the real HTTP API.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiPkgPath = path.resolve(__dirname, '../apps/umi-api/package.json');
const apiRequire = createRequire(apiPkgPath);
const { Client } = apiRequire('pg');
const { PasswordService } = apiRequire('./dist/shared/auth/password.service.js');
const { posPinLookupHash } = apiRequire('./dist/shared/auth/pos-pin.js');

const workerDsn = process.env.DATABASE_URL_WORKER;
const jwtSecret = process.env.JWT_SECRET;
if (!workerDsn || !jwtSecret) {
  console.error('DATABASE_URL_WORKER and JWT_SECRET are required');
  process.exit(1);
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const MERCHANT_ID = randomUUID();
const LOCATION_ID = randomUUID();
const SUBSCRIPTION_ID = randomUUID();
const FLOOR_AREA_ID = randomUUID();
const TABLE_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const INVENTORY_LOCATION_ID = randomUUID();
const STOCK_ITEM_ID = randomUUID();
const STATION_ID = randomUUID();
const USER_ID = randomUUID();
const STAFF_ID = randomUUID();
const DEVICE_ID = randomUUID();
const DEVICE_PUBLIC_ID = randomUUID();
const INSTALLATION_ID = randomUUID();
const DEVICE_CREDENTIAL = `e2e-cred-${randomBytes(24).toString('hex')}`;
const REGISTER_ID = randomUUID();
const CANCELLED_CART_ID = randomUUID();
const SEED_DURABLE_SESSION_ID = randomUUID();
const SEED_OPERATOR_SESSION_ID = randomUUID();
const PIN = '2468';
const UNIT_PRICE = 5500;

const DENOMINATIONS = [
  { code: 'MXN-500', label: '$500', minorUnits: 50000 },
  { code: 'MXN-200', label: '$200', minorUnits: 20000 },
  { code: 'MXN-100', label: '$100', minorUnits: 10000 },
  { code: 'MXN-50', label: '$50', minorUnits: 5000 },
];

const client = new Client({ connectionString: workerDsn });
await client.connect();

try {
  await client.query('BEGIN');

  await client.query(
    `INSERT INTO merchant.merchant (id, name, handle, currency, timezone, status)
     VALUES ($1::uuid, 'ONCA E2E Offline Smoke', $2, 'MXN', 'America/Mexico_City', 'active')`,
    [MERCHANT_ID, `onca-e2e-${MERCHANT_ID.slice(0, 8)}`],
  );

  await client.query(
    `INSERT INTO merchant.location (id, merchant_id, name, status)
     VALUES ($1::uuid, $2::uuid, 'Barra E2E', 'active')`,
    [LOCATION_ID, MERCHANT_ID],
  );

  // Active subscription + explicit POS & offline-cash entitlements.
  await client.query(
    `INSERT INTO umi.subscription (id, merchant_id, plan_id, status, current_period_start, current_period_end)
     SELECT $1::uuid, $2::uuid, p.id, 'active', now() - interval '1 day', now() + interval '30 days'
     FROM umi.plan p WHERE p.key = 'pro'`,
    [SUBSCRIPTION_ID, MERCHANT_ID],
  );
  for (const featureKey of ['pos', 'pos.offline_cash', 'kds']) {
    await client.query(
      `INSERT INTO umi.entitlement_override (subscription_id, feature_id, enabled, reason)
       SELECT $1::uuid, f.id, true, 'offline-e2e-smoke'
       FROM umi.feature f WHERE f.key = $2`,
      [SUBSCRIPTION_ID, featureKey],
    );
  }

  // Floor plan with Table 1.
  const floorPlan = {
    schemaVersion: 1,
    areas: [
      {
        id: FLOOR_AREA_ID,
        name: 'Salon',
        width: 720,
        height: 480,
        elements: [
          {
            id: TABLE_ID,
            label: 'Mesa 1',
            kind: 'table',
            shape: 'square',
            capacity: 4,
            x: 80,
            y: 80,
            width: 100,
            height: 100,
            rotation: 0,
          },
        ],
      },
    ],
  };
  await client.query(
    `INSERT INTO merchant.floor_plan
       (merchant_id, location_id, version, draft, published_version, published, published_at)
     VALUES ($1::uuid, $2::uuid, 1, $3::jsonb, 1, $3::jsonb, now())`,
    [MERCHANT_ID, LOCATION_ID, JSON.stringify(floorPlan)],
  );

  const businessDate = (
    await client.query(
      `SELECT (((now() at time zone b.timezone) - b.business_day_start::interval))::date::text AS value
       FROM merchant.merchant b WHERE b.id = $1::uuid`,
      [MERCHANT_ID],
    )
  ).rows[0].value;

  // Product + 1:1 tracked inventory + kitchen station + kitchen route.
  await client.query(
    `INSERT INTO merchant.product
       (id, merchant_id, name, price, tax_rate_basis_points, requires_preparation, active)
     VALUES ($1::uuid, $2::uuid, 'Cafe Americano', $3, 0, true, true)`,
    [PRODUCT_ID, MERCHANT_ID, UNIT_PRICE],
  );
  await client.query(
    `INSERT INTO merchant.inventory_location
       (id, merchant_id, location_id, public_reference, display_name, location_type, active)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'BODEGA', 'Bodega', 'stock_room', true)`,
    [INVENTORY_LOCATION_ID, MERCHANT_ID, LOCATION_ID],
  );
  await client.query(
    `INSERT INTO merchant.inventory_item
       (id, merchant_id, public_reference, display_name, item_type, base_unit, quantity_scale,
        tracking_policy, negative_stock_policy, reservation_required, active)
     VALUES ($1::uuid, $2::uuid, 'CAFE', 'Cafe en grano', 'ingredient', 'unit', 0,
             'tracked', 'allow_and_flag', true, true)`,
    [STOCK_ITEM_ID, MERCHANT_ID],
  );
  await client.query(
    `INSERT INTO merchant.inventory_catalog_mapping
       (merchant_id, product_id, mapping_type, inventory_item_id, conversion_numerator,
        conversion_denominator, version, active)
     VALUES ($1::uuid, $2::uuid, 'direct', $3::uuid, 1, 1, 1, true)`,
    [MERCHANT_ID, PRODUCT_ID, STOCK_ITEM_ID],
  );
  await client.query(
    `INSERT INTO merchant.inventory_policy
       (merchant_id, location_id, inventory_location_id, version, tracking_enabled,
        maximum_reservation_lines, expires_at, fingerprint)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'offline-e2e-inv', true, 50,
             now() + interval '1 day', repeat('b', 64))`,
    [MERCHANT_ID, LOCATION_ID, INVENTORY_LOCATION_ID],
  );
  await client.query(
    `INSERT INTO merchant.station (id, merchant_id, location_id, key, name)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'barra', 'Barra')`,
    [STATION_ID, MERCHANT_ID, LOCATION_ID],
  );
  await client.query(
    `INSERT INTO merchant.kitchen_route
       (merchant_id, location_id, product_id, station_id, requires_preparation, route_priority, active)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, true, 10, true)`,
    [MERCHANT_ID, LOCATION_ID, PRODUCT_ID, STATION_ID],
  );

  // Policies: offline cash enabled + cash shift policy.
  await client.query(
    `INSERT INTO merchant.pos_offline_cash_policy
       (merchant_id, location_id, enabled, version, currency, max_policy_age_seconds,
        max_single_sale_minor_units, max_accumulated_minor_units, max_offline_sale_count,
        max_active_queue_depth, max_command_age_seconds, max_catalog_age_seconds,
        max_pricing_age_seconds, max_tax_age_seconds, allowed_device_classes,
        issued_at, expires_at)
     VALUES ($1::uuid, $2::uuid, true, 'offline-e2e-1', 'MXN', 3600,
             500000, 5000000, 50, 50, 3600, 3600, 3600, 3600, ARRAY['pos_terminal'],
             now(), now() + interval '1 day')`,
    [MERCHANT_ID, LOCATION_ID],
  );
  await client.query(
    `INSERT INTO merchant.cash_shift_policy
       (merchant_id, location_id, currency, version, maximum_opening_float,
        allowed_movement_types, variance_tolerance, expires_at, fingerprint,
        denominations, count_method)
     VALUES ($1::uuid, $2::uuid, 'MXN', 'offline-e2e-cash', 1000000, '{}', 0,
             now() + interval '1 day', repeat('c', 64), $3::jsonb, 'total_only')`,
    [MERCHANT_ID, LOCATION_ID, JSON.stringify(DENOMINATIONS)],
  );

  // Operator user + staff with PIN + enrolled POS terminal device + register.
  const passwords = new PasswordService();
  const pinSalt = randomBytes(16).toString('hex');
  const pinHashed = passwords.hash(PIN, pinSalt);
  const pinLookup = posPinLookupHash(jwtSecret, MERCHANT_ID, PIN);

  await client.query(
    `INSERT INTO umi."user" (id, full_name, email, status)
     VALUES ($1::uuid, 'Barista E2E', $2, 'active')`,
    [USER_ID, `barista-${USER_ID.slice(0, 8)}@e2e.umi.test`],
  );
  await client.query(
    `INSERT INTO merchant.staff
       (id, merchant_id, location_id, user_id, role_id, name, email, status,
        operator_pin_salt, operator_pin_hash, operator_pin_lookup)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
             (SELECT id FROM umi.role WHERE key = 'admin'),
             'Barista E2E', $5, 'active', $6, $7, $8)`,
    [
      STAFF_ID,
      MERCHANT_ID,
      LOCATION_ID,
      USER_ID,
      `barista-${USER_ID.slice(0, 8)}@e2e.umi.test`,
      pinHashed.salt,
      pinHashed.hash,
      pinLookup,
    ],
  );
  await client.query(
    `INSERT INTO merchant.device
       (id, public_id, merchant_id, location_id, name, kind, status,
        installation_hash, credential_hash, credential_version, platform, mobility)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Caja Principal E2E', 'pos_terminal', 'active',
             $5, $6, 1, 'linux', 'static')`,
    [
      DEVICE_ID,
      DEVICE_PUBLIC_ID,
      MERCHANT_ID,
      LOCATION_ID,
      sha256(INSTALLATION_ID),
      sha256(DEVICE_CREDENTIAL),
    ],
  );
  await client.query(
    `INSERT INTO merchant.physical_register
       (id, merchant_id, location_id, display_name, public_reference, currency, active,
        assignment_policy, assigned_device_id, allowed_device_classes, status)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'Caja Principal', $4, 'MXN', true,
             'device_required', $5::uuid, ARRAY['pos_terminal'], 'available')`,
    [REGISTER_ID, MERCHANT_ID, LOCATION_ID, `E2E-${REGISTER_ID.slice(0, 6)}`, DEVICE_ID],
  );

  // Seed opening inventory balance of 50 units (under merchant/location context).
  await client.query(`SELECT set_config('app.current_merchant', $1, true)`, [MERCHANT_ID]);
  await client.query(`SELECT set_config('app.current_location', $1, true)`, [LOCATION_ID]);
  await client.query(`SELECT set_config('app.current_user', $1, true)`, [USER_ID]);
  const openingCmdId = randomUUID();
  await client.query(
    `SELECT merchant.append_stock_ledger(
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'opening_balance', 50,
       $5::uuid, $6::uuid, $7, 'inventory_opening', $5::uuid,
       $8::uuid, $9::uuid, 1, $10::date, $11,
       null, null, null, null, '{}'::jsonb
     )`,
    [
      MERCHANT_ID,
      LOCATION_ID,
      INVENTORY_LOCATION_ID,
      STOCK_ITEM_ID,
      openingCmdId,
      randomUUID(),
      sha256(`opening:${MERCHANT_ID}`),
      USER_ID,
      DEVICE_ID,
      businessDate,
      `e2e-opening-${MERCHANT_ID.slice(0, 8)}`,
    ],
  );

  // Seed a pre-cancelled cart to prove P0's cancelled-cart cash conflict over real HTTP.
  await client.query(
    `INSERT INTO runtime.session (id, merchant_id, principal_type, principal_id, token_hash, expires_at)
     VALUES ($1::uuid, $2::uuid, 'user', $3::uuid, $4, now() + interval '2 hours')`,
    [SEED_DURABLE_SESSION_ID, MERCHANT_ID, USER_ID, sha256(SEED_DURABLE_SESSION_ID)],
  );
  await client.query(
    `INSERT INTO runtime.operator_session
       (id, durable_session_id, user_id, staff_id, device_id, merchant_id, location_id,
        permissions, entitlements, expires_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid,
             ARRAY['cart.write','checkout.commit','offline.cash.checkout','offline.replay'],
             '[]'::jsonb, now() + interval '2 hours')`,
    [
      SEED_OPERATOR_SESSION_ID,
      SEED_DURABLE_SESSION_ID,
      USER_ID,
      STAFF_ID,
      DEVICE_ID,
      MERCHANT_ID,
      LOCATION_ID,
    ],
  );
  await client.query(
    `INSERT INTO merchant.pos_cart
       (id, merchant_id, location_id, operator_session_id, original_operator_session_id,
        operator_user_id, original_operator_user_id, status, lifecycle_state, business_date, version)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $4::uuid, $5::uuid, $5::uuid,
             'abandoned', 'cancelled', $6::date, 2)`,
    [CANCELLED_CART_ID, MERCHANT_ID, LOCATION_ID, SEED_OPERATOR_SESSION_ID, USER_ID, businessDate],
  );

  await client.query('COMMIT');

  process.stdout.write(
    `${JSON.stringify({
      merchantId: MERCHANT_ID,
      locationId: LOCATION_ID,
      deviceId: DEVICE_ID,
      devicePublicId: DEVICE_PUBLIC_ID,
      installationId: INSTALLATION_ID,
      deviceCredential: DEVICE_CREDENTIAL,
      pin: PIN,
      registerId: REGISTER_ID,
      productId: PRODUCT_ID,
      unitPriceMinorUnits: UNIT_PRICE,
      tableId: TABLE_ID,
      cancelledCartId: CANCELLED_CART_ID,
      businessDate,
    })}\n`,
  );
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error);
  process.exit(1);
} finally {
  await client.end();
}
