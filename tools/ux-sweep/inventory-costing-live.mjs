/**
 * Show a real plate's cost, a real day's totals and a real forecast, from the real
 * database, over the real HTTP routes.
 *
 * WHY THIS TOOL EXISTS. `inventory-costing.integration.ts` proves the arithmetic against
 * a database it seeds itself. What a person cannot see there is whether the CONSOLE can
 * reach the numbers: the gate, the merchant scope, the RLS context, the serialisation of
 * a `bigint` into JSON. This script answers that by doing what a screen does — mint a
 * dashboard session, call the four routes over HTTP, print what came back.
 *
 * WHAT IT SEEDS, AND WHY IT REFUSES TO DOUBLE-SEED. The rehearsal café (Kalala) sells a
 * menu but has no ingredients, so there is nothing to cost. This creates the smallest
 * coherent set: three ingredients, one stock room, one supplier, and ONE real purchase
 * order per ingredient that is sent and received through the console's own routes — so
 * the cost basis comes from the receiving path, exactly as a café's would.
 *
 * Every fixture is keyed by a fixed id and gated on `purchase_order_receipt_line`: if the
 * ingredient has already been received, the receipt is NOT repeated. That matters more
 * here than anywhere else, because the cost basis is a weighted average — receiving the
 * same delivery twice would silently change the price of every plate.
 *
 * Run:
 *   node tools/ux-sweep/inventory-costing-live.mjs
 *   node tools/ux-sweep/inventory-costing-live.mjs --base http://127.0.0.1:4001
 *   node tools/ux-sweep/inventory-costing-live.mjs --merchant <uuid> --product <uuid>
 */
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(`${ROOT}/apps/umi-api/package.json`);
const { Client } = require('pg');

/** This tool's own ids, so a second run repairs rather than stacks. */
const SEED = {
  supplier: '9f000000-0000-4000-8000-0000000000f1',
  stockRoom: '9f000000-0000-4000-8000-0000000000d1',
  staff: '9f000000-0000-4000-8000-0000000000a1',
  session: '9f000000-0000-4000-8000-0000000000e1',
  beans: '9f000000-0000-4000-8000-000000000101',
  milk: '9f000000-0000-4000-8000-000000000102',
  cup: '9f000000-0000-4000-8000-000000000103',
  recipe: '9f000000-0000-4000-8000-000000000301',
  mapping: '9f000000-0000-4000-8000-000000000501',
};

function dotenv(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * Sign the access token a dashboard holds. Same algorithm, issuer, audience and claims
 * as `shared/auth/jwt.service.ts` — and NO `device_id`, which is what makes the request
 * a console session rather than a till's.
 */
function accessToken(secret, { userId, sessionId }) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = [
    b64({ alg: 'HS256', typ: 'JWT' }),
    b64({
      sub: userId,
      email: 'inventory-costing@local',
      sid: sessionId,
      typ: 'access',
      iss: 'umi-api',
      aud: 'umi-dashboard',
      iat: now,
      exp: now + 3600,
    }),
  ].join('.');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

/** One console call. Returns the parsed body and never throws on a refusal. */
async function read({ base, token, merchantId, path, query = {} }) {
  const url = new URL(`${base}/api/merchants/${merchantId}/inventory-costing/${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, url: url.pathname + url.search, payload };
}

/** One console WRITE — purchasing, through the routes the console itself uses. */
async function post({ base, token, merchantId, path, body }) {
  const response = await fetch(`${base}/api/merchants/${merchantId}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? fallback : argv[index + 1];
  };

  const env = dotenv(`${ROOT}/apps/umi-api/.env`);
  const dsn = env.DATABASE_URL_WORKER ?? env.DATABASE_URL_APP;
  const secret = env.JWT_SECRET;
  if (!dsn || !secret)
    throw new Error('apps/umi-api/.env must define DATABASE_URL_WORKER and JWT_SECRET');
  const base = flag('base', 'http://127.0.0.1:4001').replace(/\/+$/, '');

  const db = new Client({ connectionString: dsn });
  await db.connect();
  try {
    const merchantId = flag('merchant', null) ?? (await pickMerchant(db));
    const merchant = (
      await db.query(
        `SELECT id::text, name, handle, timezone FROM merchant.merchant WHERE id=$1::uuid`,
        [merchantId],
      )
    ).rows[0];
    if (!merchant) throw new Error(`no merchant ${merchantId}`);
    const location = (
      await db.query(
        `SELECT id::text FROM merchant.location
          WHERE merchant_id=$1::uuid AND status='active' ORDER BY name LIMIT 1`,
        [merchantId],
      )
    ).rows[0];
    if (!location) throw new Error(`merchant ${merchant.name} has no active location`);
    const admin = await pickAdminUser(db, merchantId);
    const userId = admin.userId;

    await arrangeFurniture(db, {
      merchantId,
      locationId: location.id,
      userId,
      staffId: admin.staffId,
    });
    const token = accessToken(secret, { userId, sessionId: SEED.session });

    const plan = await seedIngredients(db, { merchantId, locationId: location.id });
    console.log(
      `\n# ${merchant.name} (${merchant.handle ?? merchant.id}) · ${merchant.timezone}` +
        `\n# session: user ${userId} · one dashboard access token, no device\n` +
        `# ingredients: ${plan
          .map((item) => `${item.reference}${item.alreadyReceived ? ' (already received)' : ''}`)
          .join(', ')}`,
    );

    // Receive, through the console's own routes, anything not already received.
    const stockRoomId = SEED.stockRoom;
    for (const item of plan) {
      if (item.alreadyReceived) continue;
      const created = await post({
        base,
        token,
        merchantId,
        path: 'purchase-orders',
        body: {
          locationId: location.id,
          inventoryLocationId: stockRoomId,
          supplierId: SEED.supplier,
          currency: 'MXN',
          idempotencyKey: randomUUID(),
          lines: [
            {
              inventoryItemId: item.id,
              supplierSku: null,
              description: item.reference,
              quantity: item.quantity,
              unitCostMinor: item.unitCostMinor,
              lineTotalMinor: item.lineTotalMinor,
            },
          ],
        },
      });
      if (created.status !== 201) {
        throw new Error(
          `purchase order refused: ${created.status} ${JSON.stringify(created.payload)}`,
        );
      }
      const sent = await post({
        base,
        token,
        merchantId,
        path: `purchase-orders/${created.payload.purchaseOrder.id}/send`,
        body: {
          locationId: location.id,
          purchaseOrderId: created.payload.purchaseOrder.id,
          expectedVersion: created.payload.purchaseOrder.version,
          idempotencyKey: randomUUID(),
        },
      });
      if (sent.status !== 201) {
        throw new Error(`send refused: ${sent.status} ${JSON.stringify(sent.payload)}`);
      }
      const received = await post({
        base,
        token,
        merchantId,
        path: `purchase-orders/${sent.payload.purchaseOrder.id}/receipts`,
        body: {
          locationId: location.id,
          purchaseOrderId: sent.payload.purchaseOrder.id,
          expectedVersion: sent.payload.purchaseOrder.version,
          idempotencyKey: randomUUID(),
          lines: [
            {
              purchaseOrderLineId: sent.payload.purchaseOrder.lines[0].id,
              quantity: item.quantity,
              actualUnitCostMinor: item.unitCostMinor,
              lineTotalMinor: item.lineTotalMinor,
            },
          ],
        },
      });
      console.log(
        `# received ${item.reference}: PO ${created.payload.purchaseOrder.publicReference}` +
          ` → send ${sent.status} → receive ${received.status}`,
      );
      if (received.status !== 201) {
        throw new Error(`receipt refused: ${received.status} ${JSON.stringify(received.payload)}`);
      }
    }

    // ── the four reads, exactly as a screen makes them ──────────────────────
    const menu = await pickMenu(db, merchantId);
    const productId = flag('product', menu.productId);
    const mapping = await seedMappings(db, { merchantId, productId });
    if (mapping) {
      console.log(
        `# recipe for ${menu.name}: ${mapping.created ? 'created (12 g café, 200 ml leche per plate)' : 'already mapped — left alone'}`,
      );
    }
    const today = (
      await db.query(
        `SELECT ((now() AT TIME ZONE timezone) - business_day_start::interval)::date::text AS d
           FROM merchant.merchant WHERE id=$1::uuid`,
        [merchantId],
      )
    ).rows[0].d;

    const basis = await read({ base, token, merchantId, path: 'cost-basis' });
    console.log(`\n## GET ${basis.url} → ${basis.status}`);
    for (const item of basis.payload.items ?? []) {
      console.log(
        `   ${item.displayName.padEnd(22)} ${item.basis.padEnd(28)}` +
          ` ${item.unitCostMinor === null ? 'NO COST BASIS' : `${item.unitCostMinor} minor / ${item.baseUnit}`}` +
          `  (${item.receiptCount} receipt${item.receiptCount === 1 ? '' : 's'})`,
      );
    }

    const plates = await read({
      base,
      token,
      merchantId,
      path: 'plates',
      query: { productId, limit: 5 },
    });
    console.log(`\n## GET ${plates.url} → ${plates.status}`);
    for (const plate of plates.payload.plates ?? []) {
      console.log(
        `   ${plate.productName.padEnd(22)} price ${String(plate.priceMinor).padStart(6)}` +
          ` cost ${String(plate.costMinor ?? '—').padStart(6)}` +
          ` margin ${String(plate.marginMinor ?? '—').padStart(6)}` +
          ` (${plate.marginBasisPoints ?? '—'} bps) [${plate.state}]`,
      );
      for (const component of plate.components ?? []) {
        console.log(
          `      · ${component.displayName.padEnd(20)} ${String(component.quantity.value).padStart(5)}` +
            ` @ ${String(component.unitCostMinor ?? '—').padStart(5)} = ${String(component.lineCostMinor ?? '—').padStart(5)}` +
            `   consumed ${component.consumedQuantity.value}  (${component.source})`,
        );
      }
      for (const defect of plate.uncostedItems ?? []) {
        console.log(`      ! ${defect.displayName}: ${defect.defect}`);
      }
    }

    const days = await read({
      base,
      token,
      merchantId,
      path: 'days',
      query: { from: shift(today, -27), to: today },
    });
    console.log(`\n## GET ${days.url} → ${days.status}`);
    for (const day of days.payload.days ?? []) {
      console.log(
        `   ${day.businessDate}  revenue ${String(day.revenueMinor).padStart(7)}` +
          `  cost ${String(day.costMinor ?? '—').padStart(7)}` +
          `  margin ${String(day.marginMinor ?? '—').padStart(7)} (${day.marginBasisPoints ?? '—'} bps)` +
          `  ${day.salesCount} sales / ${day.platesSold} plates  [${day.state}]`,
      );
    }
    if ((days.payload.days ?? []).length === 0) {
      console.log('   (no committed sales in the window: nothing to cost)');
    }

    const low = await read({
      base,
      token,
      merchantId,
      path: 'low-stock',
      query: { windowDays: 28 },
    });
    console.log(
      `\n## GET ${low.url} → ${low.status}   window ${low.payload.from} .. ${low.payload.to}`,
    );
    for (const item of (low.payload.items ?? []).slice(0, 6)) {
      console.log(
        `   ${item.displayName.padEnd(22)} on hand ${String(item.onHand.value).padStart(6)}` +
          `  used ${String(item.consumedQuantity.value).padStart(5)}` +
          `  rate ${String(item.dailyRateQuantity?.value ?? '—').padStart(5)}/day` +
          `  cover ${String(item.daysOfCover ?? '—').padStart(6)} d` +
          `  observed ${item.observedDays}/28` +
          `${item.belowThreshold ? '  BELOW THRESHOLD' : ''}` +
          `${item.hasCostBasis ? `  value ${item.onHandValueMinor}` : '  (no cost basis)'}`,
      );
    }
  } finally {
    await db.end();
  }
}

/** The café with the most committed sales, so the day view has something real in it. */
async function pickMerchant(db) {
  const { rows } = await db.query(
    `SELECT m.id::text AS id, count(s.id) AS sales
       FROM merchant.merchant m
       LEFT JOIN merchant.pos_committed_sale s ON s.merchant_id = m.id
      WHERE m.status='active' AND m.handle IS NOT NULL
      GROUP BY m.id, m.name ORDER BY count(s.id) DESC, m.name LIMIT 1`,
  );
  if (!rows[0]) throw new Error('no active merchant with a handle');
  return rows[0].id;
}

/** A merchant-level admin: the role that holds `merchant.manage`, as the gate requires. */
async function pickAdminUser(db, merchantId) {
  const { rows } = await db.query(
    `SELECT s.user_id::text AS "userId", s.id::text AS "staffId"
       FROM merchant.staff s
       LEFT JOIN merchant.role mr ON mr.id = s.merchant_role_id
       LEFT JOIN umi.role r ON r.id = s.role_id
      WHERE s.merchant_id=$1::uuid AND s.status='active'
        AND coalesce(mr.key, r.key) IN ('owner','admin')
      ORDER BY (coalesce(mr.key, r.key) = 'owner') DESC, s.created_at
      LIMIT 1`,
    [merchantId],
  );
  if (!rows[0]) throw new Error(`merchant ${merchantId} has no owner or admin on staff`);
  return rows[0];
}

/**
 * The supplier, the stock room, the staff row and the durable session, repaired in place.
 * A session is what a sign-in mints and there is no route that mints one for a script,
 * which is the same concession `table-state-seed.mjs` records.
 */
async function arrangeFurniture(db, { merchantId, locationId, userId, staffId }) {
  await db.query(
    `INSERT INTO merchant.supplier (id, merchant_id, public_reference, display_name)
     VALUES ($1::uuid,$2::uuid,'COSTEO-PROVEEDOR','Proveedor de costeo')
     ON CONFLICT (id) DO UPDATE SET merchant_id=excluded.merchant_id, active=true, archived_at=null`,
    [SEED.supplier, merchantId],
  );
  await db.query(
    `INSERT INTO merchant.inventory_location
       (id,merchant_id,location_id,public_reference,display_name,location_type)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'COSTEO-ALMACEN','Almacén de costeo','stock_room')
     ON CONFLICT (id) DO UPDATE
       SET merchant_id=excluded.merchant_id, location_id=excluded.location_id,
           active=true, archived_at=null`,
    [SEED.stockRoom, merchantId, locationId],
  );
  await db.query(
    `INSERT INTO merchant.inventory_item
       (id,merchant_id,public_reference,display_name,item_type,base_unit,quantity_scale)
     VALUES ($1::uuid,$4::uuid,'CAFE-GRANO','Café en grano','ingredient','kilogram',3),
            ($2::uuid,$4::uuid,'LECHE','Leche entera','ingredient','liter',3),
            ($3::uuid,$4::uuid,'VASO-12OZ','Vaso 12 oz','packaging','unit',0)
     ON CONFLICT (id) DO UPDATE SET merchant_id=excluded.merchant_id, active=true, archived_at=null`,
    [SEED.beans, SEED.milk, SEED.cup, merchantId],
  );
  /*
   * NO NEW STAFF ROW. The person this script signs in as is already on the café's staff —
   * that is how `pickAdminUser` found them — and `staff_merchant_id_user_id_key` refuses a
   * second employment for the same person. Not touching their row is also the honest
   * choice: this tool's job is to make an ingredient costable, not to change who works
   * here.
   */
  await db.query(
    `INSERT INTO runtime.session (id, merchant_id, principal_type, principal_id, token_hash)
     VALUES ($1::uuid,$2::uuid,'user',$3::uuid,$4)
     ON CONFLICT (id) DO UPDATE
       SET merchant_id=excluded.merchant_id, principal_id=excluded.principal_id,
           is_active=true, revoked_at=null`,
    [SEED.session, merchantId, userId, randomUUID()],
  );
}

/**
 * What each ingredient cost, and whether it has already been received.
 *
 * The `alreadyReceived` flag is the guard that matters: the basis is a weighted average
 * over receipts, so receiving the same delivery twice would quietly move the price of
 * every plate that uses it. A re-run reports what is there instead of moving the number.
 */
async function seedIngredients(db, { merchantId, locationId }) {
  const wanted = [
    {
      id: SEED.beans,
      reference: 'CAFE-GRANO',
      quantity: { value: 12000, scale: 3, unit: 'kilogram' },
      unitCostMinor: 21500,
    },
    {
      id: SEED.milk,
      reference: 'LECHE',
      quantity: { value: 24000, scale: 3, unit: 'liter' },
      unitCostMinor: 2450,
    },
    {
      id: SEED.cup,
      reference: 'VASO-12OZ',
      quantity: { value: 400, scale: 0, unit: 'unit' },
      unitCostMinor: 165,
    },
  ];
  const plan = [];
  for (const item of wanted) {
    const { rows } = await db.query(
      `SELECT
         (SELECT count(*) FROM merchant.purchase_order_receipt_line
           WHERE merchant_id=$1::uuid AND inventory_item_id=$2::uuid) AS receipts,
         (SELECT b.on_hand FROM merchant.stock_balance b
           WHERE b.inventory_location_id=$3::uuid AND b.inventory_item_id=$2::uuid) AS on_hand`,
      [merchantId, item.id, SEED.stockRoom],
    );
    plan.push({
      ...item,
      lineTotalMinor: Math.round(
        (item.quantity.value * item.unitCostMinor) / 10 ** item.quantity.scale,
      ),
      alreadyReceived: Number(rows[0].receipts) > 0,
      onHand: rows[0].on_hand === null ? null : Number(rows[0].on_hand),
    });
  }
  void locationId;
  return plan;
}

/** A product with a price, for the plate read. Prefers one whose name suggests coffee. */
async function pickMenu(db, merchantId) {
  const { rows } = await db.query(
    `SELECT id::text AS "productId", name, price::text AS price
       FROM merchant.product
      WHERE merchant_id=$1::uuid AND active AND price > 0
      ORDER BY (name ILIKE '%latte%' OR name ILIKE '%café%' OR name ILIKE '%cafe%') DESC, price DESC
      LIMIT 1`,
    [merchantId],
  );
  return rows[0] ?? { productId: null, name: null, price: null };
}

/**
 * A recipe for one real menu item, and a direct mapping for another, so the plate read has
 * something to cost.
 *
 * The quantities are what a café would write: a 12 g dose of coffee, 200 ml of milk, and a
 * cup that is used one-for-one. Like the receipts, this is gated on there being no active
 * mapping for the product already, so a re-run repairs the fixtures it owns and never
 * rewrites a mapping somebody else created.
 */
async function seedMappings(db, { merchantId, productId }) {
  if (!productId) return null;
  const existing = await db.query(
    `SELECT count(*)::int AS n FROM merchant.inventory_catalog_mapping
      WHERE merchant_id=$1::uuid AND product_id=$2::uuid AND active`,
    [merchantId, productId],
  );
  if (existing.rows[0].n > 0) return { created: false, productId };

  await db.query(
    `INSERT INTO merchant.inventory_recipe
       (id,merchant_id,product_id,version,yield_quantity,yield_scale,yield_unit,active)
     VALUES ($1::uuid,$2::uuid,$3::uuid,1,1,0,'portion',true)
     ON CONFLICT (id) DO UPDATE SET product_id=excluded.product_id, active=true, retired_at=null`,
    [SEED.recipe, merchantId, productId],
  );
  await db.query(
    `INSERT INTO merchant.inventory_recipe_component
       (merchant_id,recipe_id,inventory_item_id,modifier_id,quantity,unit,quantity_scale,
        conversion_numerator,conversion_denominator)
     VALUES ($1::uuid,$2::uuid,$3::uuid,null,12,'gram',3,1,1),
            ($1::uuid,$2::uuid,$4::uuid,null,200,'milliliter',3,1,1)
     ON CONFLICT (recipe_id,inventory_item_id,modifier_id) DO UPDATE
       SET quantity=excluded.quantity, unit=excluded.unit, quantity_scale=excluded.quantity_scale`,
    [merchantId, SEED.recipe, SEED.beans, SEED.milk],
  );
  await db.query(
    `INSERT INTO merchant.inventory_catalog_mapping
       (id,merchant_id,product_id,mapping_type,inventory_item_id,recipe_id,
        conversion_numerator,conversion_denominator,version,active)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'recipe',null,$4::uuid,1,1,1,true)
     ON CONFLICT (id) DO UPDATE SET product_id=excluded.product_id, recipe_id=excluded.recipe_id`,
    [SEED.mapping, merchantId, productId, SEED.recipe],
  );
  return { created: true, productId };
}

function shift(date, days) {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

await main();
