import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../apps/umi-api/package.json', import.meta.url));
const { Client } = require('pg');
export const REVIEW_MERCHANT_ID = 'a1100000-0000-4000-8000-000000000001';
const locationId = 'a1100000-0000-4000-8000-000000000002';
const userId = 'a1100000-0000-4000-8000-000000000003';
const staffId = 'a1100000-0000-4000-8000-000000000004';
const categoryId = 'a1100000-0000-4000-8000-000000000005';
const registerId = 'a1100000-0000-4000-8000-000000000006';
const email = 'play-review@umipos.invalid';

async function main() {
  const {
    DATABASE_URL,
    REVIEW_ADMIN_PASSWORD,
    REVIEW_SETUP_CODE,
    REVIEW_OPERATOR_PIN,
    REVIEW_API_URL,
  } = process.env;
  if (
    process.env.REVIEW_SEED_CONFIRM !== 'isolated-demo' ||
    !DATABASE_URL ||
    !REVIEW_ADMIN_PASSWORD ||
    REVIEW_ADMIN_PASSWORD.length < 20 ||
    !/^[A-Z0-9]{8}$/.test(REVIEW_SETUP_CODE ?? '') ||
    !/^\d{4,6}$/.test(REVIEW_OPERATOR_PIN ?? '') ||
    !REVIEW_API_URL
  ) {
    throw new Error('See docs/pilot/GOOGLE_PLAY_REVIEW_ACCESS.md for required seed variables.');
  }
  const url = new URL(DATABASE_URL);
  const local = (host) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
  const apiUrl = new URL(REVIEW_API_URL);
  if (!local(url.hostname) && !process.env.PGSSLROOTCERT)
    throw new Error('Remote PostgreSQL requires PGSSLROOTCERT.');
  if (apiUrl.protocol !== 'https:' && !(local(apiUrl.hostname) && apiUrl.protocol === 'http:'))
    throw new Error('Remote API requires HTTPS.');
  url.searchParams.delete('sslmode');
  const client = new Client({
    connectionString: url.toString(),
    ...(process.env.PGSSLROOTCERT
      ? { ssl: { ca: readFileSync(process.env.PGSSLROOTCERT, 'utf8'), rejectUnauthorized: true } }
      : {}),
  });
  await client.connect();
  let inTransaction = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('umi-play-review-seed'))");
    await client.query('BEGIN');
    inTransaction = true;
    const existingGrant = await client.query(
      'SELECT setup_code_hash,enabled FROM runtime.app_review_access WHERE merchant_id=$1',
      [REVIEW_MERCHANT_ID],
    );
    const codeHash = createHash('sha256').update(REVIEW_SETUP_CODE).digest('hex');
    if (existingGrant.rows[0]?.enabled && existingGrant.rows[0].setup_code_hash !== codeHash)
      throw new Error('Disable the review grant before rotating its setup code.');
    const conflicts = await client.query(
      `SELECT
      EXISTS(SELECT 1 FROM umi."user" WHERE id=$1 AND email<>$2) OR
      EXISTS(SELECT 1 FROM umi.user_role WHERE user_id=$1) OR
      EXISTS(SELECT 1 FROM merchant.staff WHERE user_id=$1 AND merchant_id<>$3) OR
      EXISTS(SELECT 1 FROM merchant.location WHERE id=$4 AND merchant_id<>$3) OR
      EXISTS(SELECT 1 FROM merchant.staff WHERE id=$5 AND (merchant_id<>$3 OR user_id<>$1)) OR
      EXISTS(SELECT 1 FROM merchant.physical_register WHERE id=$6 AND merchant_id<>$3) OR
      EXISTS(SELECT 1 FROM merchant.integration WHERE merchant_id=$3)
      AS conflict`,
      [userId, email, REVIEW_MERCHANT_ID, locationId, staffId, registerId],
    );
    if (conflicts.rows[0].conflict)
      throw new Error('Reserved fixture ownership or integration isolation check failed.');
    const existing = await client.query('SELECT name FROM merchant.merchant WHERE id=$1', [
      REVIEW_MERCHANT_ID,
    ]);
    if (existing.rows[0] && existing.rows[0].name !== 'UmiPOS Google Play Demo')
      throw new Error('Reserved demo ID already belongs to another merchant.');
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(REVIEW_ADMIN_PASSWORD, salt, 64).toString('hex');
    await client.query(
      `INSERT INTO merchant.merchant(id,name,city,timezone,currency,status)
      VALUES ($1,'UmiPOS Google Play Demo','Demo','America/Mazatlan','MXN','active')
      ON CONFLICT(id) DO NOTHING`,
      [REVIEW_MERCHANT_ID],
    );
    await client.query(
      `INSERT INTO merchant.location(id,merchant_id,name,status)
      VALUES($1,$2,'Demo branch','active') ON CONFLICT(id) DO NOTHING`,
      [locationId, REVIEW_MERCHANT_ID],
    );
    await client.query(
      `INSERT INTO umi."user"(id,email,full_name,password_salt,password_hash,password_algorithm,status)
      VALUES($1,$2,'Google Play Reviewer',$3,$4,'scrypt-sha256-v1','active')
      ON CONFLICT(id) DO NOTHING`,
      [userId, email, salt, hash],
    );
    await client.query(
      `INSERT INTO merchant.staff(id,merchant_id,location_id,user_id,role_id,name,email,status)
      SELECT $1,$2,$3,$4,id,'Google Play Reviewer',$5,'active' FROM umi.role WHERE key='owner' AND NOT is_platform
      ON CONFLICT(id) DO NOTHING`,
      [staffId, REVIEW_MERCHANT_ID, locationId, userId, email],
    );
    const subscription = await client.query(
      `INSERT INTO umi.subscription(merchant_id,plan_id,status)
      SELECT $1,id,'active' FROM umi.plan WHERE key='pro' AND status='active'
      ON CONFLICT(merchant_id) DO UPDATE SET status='active',current_period_end=null RETURNING id`,
      [REVIEW_MERCHANT_ID],
    );
    if (!subscription.rows[0]) throw new Error('The pro plan is missing.');
    await client.query(
      `INSERT INTO umi.entitlement_override(subscription_id,feature_id,enabled,reason)
      SELECT $1,id,true,'Isolated Google Play review fixture' FROM umi.feature WHERE key='pos'
      ON CONFLICT(subscription_id,feature_id) DO UPDATE SET enabled=true,expires_at=null`,
      [subscription.rows[0].id],
    );
    await client.query(
      `INSERT INTO merchant.loyalty_program(merchant_id,card_prefix,self_registration,stamps_per_reward,primary_color)
      VALUES($1,'GPR',false,10,'#246BFD') ON CONFLICT(merchant_id) DO NOTHING`,
      [REVIEW_MERCHANT_ID],
    );
    await client.query(
      `INSERT INTO merchant.product_category(id,merchant_id,name,display_order)
      VALUES($1,$2,'Demo menu',1) ON CONFLICT(id) DO NOTHING`,
      [categoryId, REVIEW_MERCHANT_ID],
    );
    const products = [
      ['Americano', 4500],
      ['Latte', 6500],
      ['Tea', 4000],
      ['Croissant', 5500],
    ];
    await client.query(
      `INSERT INTO merchant.pos_checkout_policy
      (merchant_id,location_id,version,currency,allow_dine_in_without_table)
      VALUES($1,$2,'play-review-1','MXN',true) ON CONFLICT(merchant_id,location_id) DO NOTHING`,
      [REVIEW_MERCHANT_ID, locationId],
    );
    await client.query(
      `INSERT INTO merchant.cash_shift_policy
      (merchant_id,location_id,version,currency,expires_at,fingerprint,cash_shift_required,register_assignment_required,opening_float_required)
      VALUES($1,$2,'play-review-2','MXN','2099-01-01',repeat('a',64),true,true,false)
      ON CONFLICT(merchant_id,location_id) DO UPDATE SET
        version=excluded.version,cash_shift_required=true,register_assignment_required=true,
        opening_float_required=false`,
      [REVIEW_MERCHANT_ID, locationId],
    );
    await client.query(
      `INSERT INTO merchant.physical_register
       (id,merchant_id,location_id,display_name,public_reference,currency,assignment_policy,status)
       VALUES($1,$2,$3,'Google Play Demo','PLAY-REVIEW-01','MXN','operator_selects','available')
       ON CONFLICT(id) DO NOTHING`,
      [registerId, REVIEW_MERCHANT_ID, locationId],
    );
    await client.query(
      `INSERT INTO merchant.pos_exception_policy
      (merchant_id,location_id,version,currency,expires_at,fingerprint,refunds_enabled,voids_enabled)
      VALUES($1,$2,'play-review-1','MXN','2099-01-01',repeat('b',64),true,true)
      ON CONFLICT(merchant_id,location_id,currency) DO NOTHING`,
      [REVIEW_MERCHANT_ID, locationId],
    );
    for (const [index, [name, price]] of products.entries()) {
      const productId = `a1100000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`;
      await client.query(
        `INSERT INTO merchant.product(id,merchant_id,category_id,name,description,price,active,external_ref,tax_rate_basis_points)
        VALUES($1,$2,$3,$4,'Fictional product for app review',$5,true,$6,1600)
        ON CONFLICT(id) DO NOTHING`,
        [productId, REVIEW_MERCHANT_ID, categoryId, name, price, `play-review-${index}`],
      );
    }
    await client.query('COMMIT');
    inTransaction = false;

    // Use the normal API to derive the PIN lookup with the live JWT key.
    // The seeder never needs that signing key or a platform administrator login.
    const login = await fetch(`${REVIEW_API_URL}/api/auth/local/login`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: email, password: REVIEW_ADMIN_PASSWORD }),
    });
    if (!login.ok)
      throw new Error(`Demo login failed (${login.status}); review access remains unchanged.`);
    const cookies = login.headers.getSetCookie().map((v) => v.split(';')[0]);
    const csrf = cookies.find((v) => v.startsWith('umi_csrf='))?.slice('umi_csrf='.length);
    const existingPin = (
      await client.query(
        `SELECT operator_pin_salt AS salt,operator_pin_hash AS hash,operator_pin_lookup AS lookup
       FROM merchant.staff WHERE id=$1 AND merchant_id=$2`,
        [staffId, REVIEW_MERCHANT_ID],
      )
    ).rows[0];
    const expectedPinHash = existingPin?.hash ? Buffer.from(existingPin.hash, 'hex') : null;
    const samePin = Boolean(
      existingPin?.salt &&
      existingPin?.lookup &&
      expectedPinHash?.length === 64 &&
      timingSafeEqual(scryptSync(REVIEW_OPERATOR_PIN, existingPin.salt, 64), expectedPinHash),
    );
    // Reissuing an unchanged PIN revokes POS sessions. Preserve active reviewers.
    if (!samePin) {
      const pin = await fetch(
        `${REVIEW_API_URL}/api/${REVIEW_MERCHANT_ID}/admin/staff/${staffId}`,
        {
          method: 'PATCH',
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
          headers: {
            'content-type': 'application/json',
            cookie: cookies.join('; '),
            ...(csrf ? { 'x-umi-csrf': decodeURIComponent(csrf) } : {}),
          },
          body: JSON.stringify({ operatorPin: REVIEW_OPERATOR_PIN }),
        },
      );
      if (!pin.ok)
        throw new Error(`Demo PIN setup failed (${pin.status}); review access remains unchanged.`);
    }
    await client.query(
      `INSERT INTO runtime.app_review_access(merchant_id,location_id,created_by,setup_code_hash,enabled)
       VALUES($1,$2,$3,$4,true) ON CONFLICT(merchant_id) DO UPDATE SET
       setup_code_hash=excluded.setup_code_hash,enabled=true,updated_at=now()`,
      [REVIEW_MERCHANT_ID, locationId, userId, codeHash],
    );
    console.log(`Review fixture ready: ${REVIEW_MERCHANT_ID}. Credentials were not printed.`);
  } catch (error) {
    if (inTransaction) await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
