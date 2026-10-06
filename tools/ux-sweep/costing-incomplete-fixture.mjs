/**
 * Make ONE plate that cannot be costed — and put everything back afterwards.
 *
 * WHY THIS EXISTS. The costing screen's central promise is the D47 rule: a number the
 * server did not fully price is shown as a NAMED STATE, never as a zero. The rehearsal
 * café cannot demonstrate the sharpest case of that on its own, because every ingredient
 * it has was received by `inventory-costing-live.mjs`, so every mapped plate is
 * `complete`. The state that matters — a plate whose recipe EXISTS and whose ingredient
 * has NO price, because it was never received — needs an ingredient that has never been
 * ordered, and there is no route that creates one: a cost is not something a person
 * types, and a recipe has no console surface yet.
 *
 * SO THIS IS A FIXTURE, and a reversible one. It adds a product nobody sells, a mapping,
 * and an ingredient with no receipts — all keyed to fixed ids — and `--revert` deletes
 * exactly those rows and nothing else. It touches no existing product, so the day reads
 * and the unmapped-product list the rest of the work depends on are unchanged while it
 * is applied.
 *
 * Run:
 *   node tools/ux-sweep/costing-incomplete-fixture.mjs --apply
 *   node tools/ux-sweep/costing-incomplete-fixture.mjs --revert
 *   node tools/ux-sweep/costing-incomplete-fixture.mjs --status
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(`${ROOT}/apps/umi-api/package.json`);
const { Client } = require('pg');

/** Fixed ids, so a second run repairs rather than stacks and `--revert` is exact. */
const FIXTURE = {
  product: 'd1f00000-0000-4000-8000-000000000001',
  item: 'd1f00000-0000-4000-8000-000000000011',
  recipe: 'd1f00000-0000-4000-8000-000000000021',
  mapping: 'd1f00000-0000-4000-8000-000000000031',
  productName: 'Prueba de costo — sin precio de insumo',
  reference: 'JARABE-VAINILLA',
  displayName: 'Jarabe de vainilla (nunca recibido)',
};

function dotenv(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

async function merchantIdOf(db, flag) {
  if (flag) return flag;
  // The same merchant `inventory-costing-live.mjs` picks — the one with the most
  // committed sales — so both tools act on the café whose numbers a person is looking at,
  // rather than on whichever café happens to sort first by name.
  const { rows } = await db.query(
    `SELECT m.id::text AS id
       FROM merchant.merchant m
       LEFT JOIN merchant.pos_committed_sale s ON s.merchant_id = m.id
      WHERE m.status = 'active' AND m.handle IS NOT NULL
      GROUP BY m.id, m.name
      ORDER BY count(s.id) DESC, m.name
      LIMIT 1`,
  );
  if (!rows[0]) throw new Error('no merchant with an active location');
  return rows[0].id;
}

async function status(db, merchantId) {
  const { rows } = await db.query(
    `SELECT
       (SELECT count(*) FROM merchant.product p
         WHERE p.id = $1::uuid AND p.merchant_id = $5::uuid) AS product,
       (SELECT count(*) FROM merchant.inventory_item i
         WHERE i.id = $2::uuid AND i.merchant_id = $5::uuid) AS item,
       (SELECT count(*) FROM merchant.inventory_item i
         WHERE i.id = $2::uuid AND NOT EXISTS (
           SELECT 1 FROM merchant.purchase_order_receipt_line r
            WHERE r.inventory_item_id = i.id)) AS item_without_receipt,
       (SELECT count(*) FROM merchant.inventory_recipe r
         WHERE r.id = $3::uuid AND r.merchant_id = $5::uuid) AS recipe,
       (SELECT count(*) FROM merchant.inventory_catalog_mapping m
         WHERE m.id = $4::uuid AND m.merchant_id = $5::uuid) AS mapping`,
    [FIXTURE.product, FIXTURE.item, FIXTURE.recipe, FIXTURE.mapping, merchantId],
  );
  return rows[0];
}

async function apply(db, merchantId) {
  await db.query(
    `INSERT INTO merchant.product (id, merchant_id, name, price, active, sku)
     VALUES ($1::uuid, $2::uuid, $3, 5000, true, 'COSTING-PROBE')
     ON CONFLICT (id) DO UPDATE
       SET merchant_id = excluded.merchant_id, name = excluded.name, active = true`,
    [FIXTURE.product, merchantId, FIXTURE.productName],
  );
  // `tracking_policy` stays 'tracked' and `reservation_required` false: the platform's
  // own CHECK refuses a not-tracked item that reserves, and this one is deliberately
  // tracked-but-never-received, which is the state under test.
  await db.query(
    `INSERT INTO merchant.inventory_item
       (id, merchant_id, public_reference, display_name, item_type, base_unit, quantity_scale,
        tracking_policy, reservation_required, active)
     VALUES ($1::uuid, $2::uuid, $3, $4, 'ingredient', 'milliliter', 3,
             'tracked', false, true)
     ON CONFLICT (id) DO UPDATE
       SET merchant_id = excluded.merchant_id, public_reference = excluded.public_reference,
           display_name = excluded.display_name, active = true, archived_at = null`,
    [FIXTURE.item, merchantId, FIXTURE.reference, FIXTURE.displayName],
  );
  await db.query(
    `INSERT INTO merchant.inventory_recipe
       (id, merchant_id, product_id, version, yield_quantity, yield_scale, yield_unit, active)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 1, 0, 'portion', true)
     ON CONFLICT (id) DO UPDATE
       SET merchant_id = excluded.merchant_id, product_id = excluded.product_id,
           active = true, retired_at = null`,
    [FIXTURE.recipe, merchantId, FIXTURE.product],
  );
  await db.query(
    // REPLACE, never upsert. `inventory_recipe_component` is unique on
    // `(recipe_id, inventory_item_id, modifier_id)` and this fixture's modifier is NULL —
    // and Postgres treats NULLs as distinct in a unique index, so `ON CONFLICT` never
    // fires here and a second `--apply` inserted a SECOND component. The plate then
    // showed its ingredient twice, which is how this was found. Deleting first is the
    // only idempotent form for a NULL-valued key.
    `DELETE FROM merchant.inventory_recipe_component
       WHERE recipe_id = $1::uuid AND merchant_id = $2::uuid`,
    [FIXTURE.recipe, merchantId],
  );
  await db.query(
    `INSERT INTO merchant.inventory_recipe_component
       (merchant_id, recipe_id, inventory_item_id, modifier_id, quantity, unit, quantity_scale,
        conversion_numerator, conversion_denominator)
     VALUES ($1::uuid, $2::uuid, $3::uuid, null, 30000, 'milliliter', 3, 1, 1)`,
    [merchantId, FIXTURE.recipe, FIXTURE.item],
  );
  await db.query(
    `INSERT INTO merchant.inventory_catalog_mapping
       (id, merchant_id, product_id, mapping_type, inventory_item_id, recipe_id,
        conversion_numerator, conversion_denominator, version, active)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'recipe', null, $4::uuid, 1, 1, 1, true)
     ON CONFLICT (id) DO UPDATE
       SET merchant_id = excluded.merchant_id, product_id = excluded.product_id,
           recipe_id = excluded.recipe_id, active = true`,
    [FIXTURE.mapping, merchantId, FIXTURE.product, FIXTURE.recipe],
  );
}

/** Deletes exactly this fixture's rows, in foreign-key order, and nothing else. */
async function revert(db, merchantId) {
  const queries = [
    `DELETE FROM merchant.inventory_catalog_mapping WHERE id = $1::uuid AND merchant_id = $2::uuid`,
    `DELETE FROM merchant.inventory_recipe_component WHERE recipe_id = $1::uuid AND merchant_id = $2::uuid`,
    `DELETE FROM merchant.inventory_recipe WHERE id = $1::uuid AND merchant_id = $2::uuid`,
    `DELETE FROM merchant.product WHERE id = $1::uuid AND merchant_id = $2::uuid`,
    `DELETE FROM merchant.inventory_item WHERE id = $1::uuid AND merchant_id = $2::uuid`,
  ];
  const ids = [FIXTURE.mapping, FIXTURE.recipe, FIXTURE.recipe, FIXTURE.product, FIXTURE.item];
  for (let index = 0; index < queries.length; index += 1) {
    await db.query(queries[index], [ids[index], merchantId]);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => argv.includes(`--${name}`);
  const value = (name, fallback) => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? fallback : argv[index + 1];
  };
  const env = dotenv(`${ROOT}/apps/umi-api/.env`);
  const dsn = env.DATABASE_URL_WORKER ?? env.DATABASE_URL_APP;
  if (!dsn) throw new Error('apps/umi-api/.env must define DATABASE_URL_WORKER');

  const db = new Client({ connectionString: dsn });
  await db.connect();
  try {
    const merchantId = await merchantIdOf(db, value('merchant', null));
    if (flag('revert')) {
      await revert(db, merchantId);
      console.log(`reverted the fixture for merchant ${merchantId}`);
    } else if (!flag('status')) {
      await apply(db, merchantId);
      console.log(`applied the fixture for merchant ${merchantId}`);
    }
    const after = await status(db, merchantId);
    console.log(JSON.stringify({ merchantId, ...after }, null, 2));
  } finally {
    await db.end();
  }
}

await main();
