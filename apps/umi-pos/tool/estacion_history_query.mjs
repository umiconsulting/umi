import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

// Comprueba el repositorio compilado. Usa sólo la base desechable de Estación.
const root = path.resolve(import.meta.dirname, '../../..');
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')),
);
if (!/^\d+$/.test(args.pid ?? '') || !['before', 'after'].includes(args.expect)) {
  throw Error('Use --pid=PID --expect=before|after --output=FILE');
}
const api = path.join(root, 'apps/umi-api');
if (fs.realpathSync(`/proc/${args.pid}/cwd`) !== api) throw Error('API distinta');
if (!fs.readFileSync(`/proc/${args.pid}/cmdline`, 'utf8').split('\0').includes('dist/main.js')) {
  throw Error('Entrada de API distinta');
}
const processEnv = Object.fromEntries(
  fs
    .readFileSync(`/proc/${args.pid}/environ`, 'utf8')
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const i = entry.indexOf('=');
      return [entry.slice(0, i), entry.slice(i + 1)];
    }),
);
const require = createRequire(path.join(api, 'package.json'));
const env = {
  ...require('node:util').parseEnv(fs.readFileSync(path.join(api, '.env'), 'utf8')),
  ...processEnv,
};
if (env.PORT !== '4013') throw Error('Puerto distinto');
for (const key of ['DATABASE_URL_APP', 'DATABASE_URL_WORKER']) {
  const url = new URL(env[key]);
  if (
    url.pathname !== '/umi_pos_estacion_design_20261008' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname)
  ) {
    throw Error('Base desechable requerida');
  }
  url.searchParams.set('options', '-c default_transaction_read_only=on');
  env[key] = url.toString();
}
require('reflect-metadata');
const { PgService } = require(path.join(api, 'dist/shared/database/pg.service.js'));
const { PosCartRepository } = require(
  path.join(api, 'dist/modules/pos-cart/pos-cart.repository.js'),
);
const { PosSaleRepository } = require(
  path.join(api, 'dist/modules/pos-sale/pos-sale.repository.js'),
);
const pg = new PgService({ get: (key) => env[key] });
const repository = new PosSaleRepository(pg, new PosCartRepository(pg));
const merchantId = '10000000-0000-4000-8000-000000000101';
const locationId = '20000000-0000-4000-8000-000000000101';
const observations = [];
try {
  await pg.onModuleInit();
  const posture = (
    await pg.app.query(`SELECT current_database() AS database,
    current_user AS role,current_setting('transaction_read_only') AS read_only,
    current_setting('transaction_isolation') AS isolation`)
  ).rows[0];
  if (posture.database !== 'umi_pos_estacion_design_20261008' || posture.read_only !== 'on') {
    throw Error('Lectura protegida requerida');
  }
  async function query(name, overrides = {}, merchant = merchantId, cursor = null) {
    const request = {
      locationId,
      operatorSessionId: '00000000-0000-4000-8000-000000000001',
      state: undefined,
      search: '',
      sort: 'newest',
      limit: 50,
      ...overrides,
    };
    const page = await repository.history(merchant, request, cursor);
    const record = {
      name,
      request,
      merchantId: merchant,
      cursor,
      ids: page.items.map((x) => x.id),
      products: page.items.map((x) => x.cart.items.map((line) => line.productName)),
      nextKey: page.nextKey,
    };
    observations.push(record);
    return page;
  }
  const croissant = await query('product', { state: 'suspended', search: 'croissant' });
  const upper = await query('case', { state: 'suspended', search: 'CROISSANT' });
  const latte = await query('committed-product', { state: 'committed', search: 'latte' });
  const absent = await query('no-match', { search: 'no-existe-N17' });
  const wrongLocation = await query('location-boundary', {
    locationId: '00000000-0000-4000-8000-000000000002',
    search: 'croissant',
  });
  const wrongMerchant = await query(
    'merchant-boundary',
    { search: 'croissant' },
    '00000000-0000-4000-8000-000000000002',
  );
  const first = await query('page-one', { state: 'suspended', limit: 1, sort: 'oldest' });
  const second = await query(
    'page-two',
    { state: 'suspended', limit: 1, sort: 'oldest' },
    merchantId,
    first.nextKey,
  );
  if (absent.items.length || wrongLocation.items.length || wrongMerchant.items.length)
    throw Error('Ámbito o ausencia difiere');
  if (
    first.items.length !== 1 ||
    !first.nextKey ||
    second.items.length !== 1 ||
    second.nextKey ||
    first.items[0].id === second.items[0].id
  ) {
    throw Error('Páginas diferentes requeridas');
  }
  if (
    args.expect === 'before' &&
    (croissant.items.length || latte.items.length || upper.items.length)
  )
    throw Error('Brecha inicial distinta');
  if (
    args.expect === 'after' &&
    (croissant.items.length !== 1 ||
      latte.items.length !== 1 ||
      upper.items[0]?.id !== croissant.items[0]?.id)
  ) {
    throw Error('Búsqueda de producto difiere');
  }
  const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const source = path.join(api, 'src/modules/pos-sale/pos-sale.repository.ts');
  const compiled = path.join(api, 'dist/modules/pos-sale/pos-sale.repository.js');
  fs.writeFileSync(
    args.output,
    JSON.stringify(
      {
        candidate: 'N17',
        phase: args.expect,
        method:
          'Actual compiled PosSaleRepository; PgService with API role; read-only disposable fixture',
        posture,
        working_tree_source_sha256: sha(source),
        source_binding: 'Current working tree; compiled SHA identifies the executed implementation',
        compiled_sha256: sha(compiled),
        observations,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Lectura del repositorio comprobada: ' + args.expect);
} finally {
  await pg.onModuleDestroy();
}
