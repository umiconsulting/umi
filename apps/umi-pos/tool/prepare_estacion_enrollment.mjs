// Prepara el registro en la base desechable del fork. La UI nativa usa el código.
// Sigue el método de sesión de tools/ux-sweep/inventory-costing-live.mjs.
import { createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const privateDir = resolve(root, 'apps/umi-pos/.estacion-runtime');
const stateFile = resolve(privateDir, 'enrollment.json');
const env = {};
for (const line of readFileSync(resolve(root, 'apps/umi-api/.env'), 'utf8').split('\n')) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
}
const dsn = env.DATABASE_URL_WORKER ?? env.DATABASE_URL_APP;
if (!new URL(dsn).pathname.startsWith('/umi_pos_estacion_')) {
  throw new Error('Este instrumento exige la base desechable del fork');
}
const base = 'http://127.0.0.1:4013';
const merchantId = '10000000-0000-4000-8000-000000000101';
const locationId = '20000000-0000-4000-8000-000000000101';

async function post(path, body, token) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(payload.error)}`);
  return payload;
}

if (process.argv[2] === 'approve') {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  if (state.base !== base) throw new Error('El registro no pertenece a la API del fork');
  await post(
    `/api/v1/merchants/${merchantId}/devices/enrollment-requests/${state.enrollmentRequestId}/approve`,
    { idempotencyKey: randomUUID() },
    state.token,
  );
  console.log('Terminal de demostración aprobado por la ruta oficial.');
} else {
  const { Client } = createRequire(resolve(root, 'apps/umi-api/package.json'))('pg');
  const db = new Client({ connectionString: dsn });
  await db.connect();
  try {
    const { rows } = await db.query(
      `SELECT s.user_id::text AS id FROM merchant.staff s JOIN umi.role r ON r.id=s.role_id WHERE s.merchant_id=$1::uuid AND s.status='active' AND r.key='owner' LIMIT 1`,
      [merchantId],
    );
    if (!rows[0]) throw new Error('Ejecuta la semilla de demostración del fork');
    const sessionId = randomUUID();
    await db.query(
      `INSERT INTO runtime.session (id,merchant_id,principal_type,principal_id,token_hash) VALUES ($1::uuid,$2::uuid,'user',$3::uuid,$4)`,
      [sessionId, merchantId, rows[0].id, randomUUID()],
    );
    const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const body = [
      b64({ alg: 'HS256', typ: 'JWT' }),
      b64({
        sub: rows[0].id,
        email: 'estacion-ui@local',
        sid: sessionId,
        typ: 'access',
        iss: 'umi-api',
        aud: 'umi-dashboard',
        iat: now,
        exp: now + 3600,
      }),
    ].join('.');
    const token = `${body}.${createHmac('sha256', env.JWT_SECRET).update(body).digest('base64url')}`;
    const created = await post(
      `/api/v1/merchants/${merchantId}/devices/enrollment`,
      {
        locationId,
        displayName: 'Estación · revisión nativa aislada',
        type: 'pos_terminal',
        platform: 'linux',
        mobility: 'static',
        idempotencyKey: randomUUID(),
      },
      token,
    );
    mkdirSync(privateDir, { recursive: true });
    writeFileSync(
      stateFile,
      JSON.stringify({ ...created, base, merchantId, locationId, sessionId, token }),
      { mode: 0o600 },
    );
    console.log(
      'Registro preparado en la base desechable; código conservado en el directorio privado.',
    );
  } finally {
    await db.end();
  }
}
