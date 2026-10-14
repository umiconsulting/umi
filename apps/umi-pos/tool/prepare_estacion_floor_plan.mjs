// Publish a disposable floor through the API that owns floor-plan changes.
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(resolve(root, 'apps/umi-api/package.json'));
const { FloorPlanState, SaveFloorPlanRequest, PublishFloorPlanRequest } = require('@umi/contract');
const env = Object.fromEntries(
  readFileSync(resolve(root, 'apps/umi-api/.env'), 'utf8')
    .split('\n')
    .flatMap((line) => {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      return match ? [[match[1], match[2].trim().replace(/^["']|["']$/g, '')]] : [];
    }),
);
if (new URL(env.DATABASE_URL_WORKER).pathname !== '/umi_pos_estacion_design_20261008') {
  throw new Error('This tool requires the exact disposable design database.');
}
const state = JSON.parse(
  readFileSync(resolve(root, 'apps/umi-pos/.estacion-runtime/enrollment.json'), 'utf8'),
);
const base = 'http://127.0.0.1:4013';
const merchantId = '10000000-0000-4000-8000-000000000101';
const locationId = '20000000-0000-4000-8000-000000000101';
if (state.base !== base || state.merchantId !== merchantId || state.locationId !== locationId) {
  throw new Error('Enrollment must belong to this disposable merchant.');
}
const claims = JSON.parse(Buffer.from(state.token.split('.')[1], 'base64url'));
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const body = [
  b64({ alg: 'HS256', typ: 'JWT' }),
  b64({
    sub: claims.sub,
    email: claims.email,
    sid: state.sessionId,
    typ: 'access',
    iss: 'umi-api',
    aud: 'umi-dashboard',
    iat: now,
    exp: now + 900,
  }),
].join('.');
const token = `${body}.${createHmac('sha256', env.JWT_SECRET).update(body).digest('base64url')}`;
if (process.argv.includes('--grant-fixture-dashboard')) {
  const { Client } = require('pg');
  const db = new Client({ connectionString: env.DATABASE_URL_WORKER });
  await db.connect();
  try {
    await db.query('BEGIN');
    const before = (
      await db.query(
        'SELECT enabled FROM umi.effective_entitlement WHERE merchant_id=$1 AND feature_key=$2',
        [merchantId, 'dashboard'],
      )
    ).rows;
    const seeded = (
      await db.query(
        `INSERT INTO umi.entitlement_override
      (subscription_id,feature_id,enabled,reason,expires_at)
      SELECT s.id,f.id,true,$2,now()+interval '1 day'
      FROM umi.subscription s JOIN umi.feature f ON f.key='dashboard'
      WHERE s.merchant_id=$1 AND s.status IN ('active','trialing')
      ON CONFLICT (subscription_id,feature_id) DO NOTHING RETURNING id`,
        [merchantId, 'Disposable Estación UI fixture; dashboard floor-plan publishing.'],
      )
    ).rows;
    const after = (
      await db.query(
        'SELECT enabled FROM umi.effective_entitlement WHERE merchant_id=$1 AND feature_key=$2',
        [merchantId, 'dashboard'],
      )
    ).rows;
    if (!after.some((r) => r.enabled))
      throw new Error('The fixture needs an active dashboard feature.');
    await db.query('COMMIT');
    writeFileSync(
      resolve(root, 'docs/research/2026-10-08-pos-native-estacion/N8-fixture-dashboard.json'),
      JSON.stringify(
        {
          synthetic: true,
          method: 'Disposable fixture preparation; scoped subscription override, 1 day',
          merchantId,
          before,
          after,
          insertedRows: seeded.length,
        },
        null,
        2,
      ) + '\n',
    );
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
}
const route = `/api/merchants/${merchantId}/floor-plan`;
async function request(path, method = 'GET', input) {
  const response = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: input ? JSON.stringify(input) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      `Floor-plan API ${method}: ${response.status}; ${payload.error?.code ?? payload.code ?? payload.message ?? 'no public code'}`,
    );
  return FloorPlanState.parse(payload);
}
const previous = await request(`${route}?locationId=${locationId}`);
if (previous.published || previous.draft) {
  throw new Error('The fixture already has a floor. Keep it for inspection.');
}
const element = (kind, shape, label, x, y, width, height, capacity = 0) => ({
  id: randomUUID(),
  kind,
  shape,
  label,
  x,
  y,
  width,
  height,
  capacity,
  rotation: 0,
});
const document = {
  schemaVersion: 1,
  areas: [
    {
      id: randomUUID(),
      name: 'Salón',
      width: 640,
      height: 480,
      elements: [
        element('table', 'round', 'Mesa 1', 160, 140, 96, 96, 2),
        element('table', 'rectangle', 'Mesa 2', 340, 140, 128, 88, 4),
        element('table', 'square', 'Mesa 3', 160, 320, 110, 110, 4),
        element('table', 'rectangle', 'Mesa 4', 340, 320, 128, 88, 4),
        element('counter', 'rectangle', 'Barra', 550, 240, 64, 300),
        element('door', 'rectangle', 'Entrada', 320, 450, 100, 30),
      ],
    },
    {
      id: randomUUID(),
      name: 'Terraza',
      width: 640,
      height: 420,
      elements: [
        element('table', 'round', 'Mesa 5', 180, 180, 110, 110, 4),
        element('table', 'round', 'Mesa 6', 440, 180, 110, 110, 4),
      ],
    },
  ],
};
const saved = await request(
  route,
  'PUT',
  SaveFloorPlanRequest.parse({
    locationId,
    expectedVersion: previous.version,
    idempotencyKey: randomUUID(),
    document,
  }),
);
const published = await request(
  `${route}/publish`,
  'POST',
  PublishFloorPlanRequest.parse({
    locationId,
    expectedVersion: saved.version,
    idempotencyKey: randomUUID(),
  }),
);
writeFileSync(
  resolve(root, 'docs/research/2026-10-08-pos-native-estacion/N8-floor-fixture.json'),
  JSON.stringify(
    {
      method: 'Official floor-plan API; disposable merchant only',
      synthetic: true,
      previous,
      published,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Disposable floor published: ${published.publishedVersion}; 2 areas, 6 tables.`);
