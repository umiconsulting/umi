/**
 * Put a room on the floor so the console can be looked at.
 *
 * The Dashboard's floor-plan screen draws the LIVE state of the room
 * (`GET /api/merchants/:merchantId/table-state`, workstream D step 3). A room
 * that nobody is sitting in proves nothing about that screen: every table draws
 * the same and a broken reader looks exactly like an idle café. This tool fills
 * one, so a person or a harness can see the six states on the map.
 *
 * It writes through the REAL POS command routes (`/api/v1/pos/.../table-state/*`),
 * not by inserting rows. That is deliberate. The seat, clear and service
 * transitions then run the same transaction, the same command journal and the
 * same database triggers the till runs, so what the console reads is a room the
 * product could actually have produced. The one thing it does by hand is the
 * operator session, because a session is what a sign-in mints and there is no
 * route that mints one for a script.
 *
 * The default room is one table per contract state:
 *
 *   T1 seated · T2 ordered · T3 served · T4 awaiting payment · T5 dirty
 *   T6, T7 open (never touched — a table with no row IS open)
 *
 * Run:
 *   node tools/ux-sweep/table-state-seed.mjs            # build the room
 *   node tools/ux-sweep/table-state-seed.mjs --reset    # empty it again
 *   node tools/ux-sweep/table-state-seed.mjs --location <uuid> --base <url>
 *
 * One command at a time, to drive a room by hand while a screen is open:
 *   node tools/ux-sweep/table-state-seed.mjs --seat T6 --party 2
 *   node tools/ux-sweep/table-state-seed.mjs --ordered T6
 *   node tools/ux-sweep/table-state-seed.mjs --clear T5
 *   node tools/ux-sweep/table-state-seed.mjs --open T5
 *   node tools/ux-sweep/table-state-seed.mjs --merge T6,T7 --party 6
 *   node tools/ux-sweep/table-state-seed.mjs --split T6
 *
 * It reads `apps/umi-api/.env` for the database, the JWT secret and the ports,
 * so it needs no arguments on this workstation.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(`${ROOT}/apps/umi-api/package.json`);
const { Client } = require('pg');

/**
 * Fixed ids for the harness furniture, so a second run updates the same rows
 * instead of stacking a new device and session on every invocation. The prefix
 * is this tool's own; nothing else in the seed data uses it.
 */
const SEED = {
  device: '9d000000-0000-4000-8000-0000000000d1',
  staff: '9d000000-0000-4000-8000-0000000000a1',
  session: '9d000000-0000-4000-8000-0000000000e1',
  operator: '9d000000-0000-4000-8000-0000000000f1',
};
const SEED_NAME = 'UX sweep room';

function dotenv(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * Sign the access token the POS sends. Same algorithm, issuer, audience and
 * claims as `shared/auth/jwt.service.ts`: the guard verifies this token with the
 * product's own code, so it is only "a token a till could hold" if it is built
 * to the same rules. `device_id` is what makes the request a till request
 * (`commandContextType: 'pos_device'`) and what the operator check matches on.
 */
function accessToken(secret, { userId, sessionId, deviceId }) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = [
    b64({ alg: 'HS256', typ: 'JWT' }),
    b64({
      sub: userId,
      email: 'ux-sweep@local',
      sid: sessionId,
      device_id: deviceId,
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

/** One POS command. Returns the parsed body, and never throws on a refusal. */
async function command({ base, token, merchantId, operation, body }) {
  const url = `${base}/api/v1/pos/merchants/${merchantId}/table-state/${operation}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...body, idempotencyKey: randomUUID() }),
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
  const reset = argv.includes('--reset');

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
    const locationId = flag('location', null) ?? (await pickLocation(db, merchantId));
    const plan = await roomPlan(db, merchantId, locationId);

    if (reset) {
      const { rowCount } = await db.query(
        `DELETE FROM merchant.table_state WHERE merchant_id=$1::uuid AND location_id=$2::uuid`,
        [merchantId, locationId],
      );
      console.log(`reset: removed ${rowCount} state row(s) at ${locationId}`);
      return;
    }

    // One command, when the caller named one. Driving a room a step at a time is
    // how a person watches a turn timer start, or a merged party appear, on a
    // screen that is already open.
    const single = singleCommand(argv, plan);
    if (single) {
      const userId = await pickUser(db);
      await arrangeFurniture(db, { merchantId, locationId, userId });
      const token = accessToken(secret, {
        userId,
        sessionId: SEED.session,
        deviceId: SEED.device,
      });
      const { status, payload } = await command({
        base,
        token,
        merchantId,
        operation: single.operation,
        body: { locationId, operatorSessionId: SEED.operator, ...single.body },
      });
      console.log(
        `${status < 300 ? 'ok ' : 'ERR'} ${status} ${single.operation} ${payload?.error?.code ?? ''}`,
      );
      console.log('\nroom now:');
      console.log(JSON.stringify(await readRoom(db, merchantId, locationId), null, 1));
      if (status >= 300) process.exitCode = 1;
      return;
    }

    const userId = await pickUser(db);
    await arrangeFurniture(db, { merchantId, locationId, userId });
    const token = accessToken(secret, {
      userId,
      sessionId: SEED.session,
      deviceId: SEED.device,
    });

    // The sequence is what a front of house would do, in order. Each step names
    // the state it is meant to reach, so a refusal is reported against the step
    // that caused it rather than as a pile of state at the end.
    const steps = [
      ['T1 seated', 'seat', plan.T1, { partySize: 2 }],
      ['T2 ordered', 'seat', plan.T2, { partySize: 4 }],
      ['T2 ordered', 'ordered', plan.T2, {}],
      ['T3 served', 'seat', plan.T3, { partySize: 3 }],
      ['T3 served', 'served', plan.T3, {}],
      ['T4 awaiting payment', 'seat', plan.T4, { partySize: 2 }],
      ['T4 awaiting payment', 'awaiting-payment', plan.T4, {}],
      ['T5 dirty', 'seat', plan.T5, { partySize: 2 }],
      ['T5 dirty', 'clear', plan.T5, {}],
    ];

    const results = [];
    for (const [label, operation, tableId, extra] of steps) {
      const { status, payload } = await command({
        base,
        token,
        merchantId,
        operation,
        body: { locationId, operatorSessionId: SEED.operator, tableId, ...extra },
      });
      results.push({ label, operation, status, code: payload?.error?.code ?? null });
    }

    const failed = results.filter((item) => item.status >= 300);
    for (const item of results) {
      const mark = item.status < 300 ? 'ok ' : 'ERR';
      console.log(
        `${mark} ${String(item.status)} ${item.label.padEnd(20)} ${item.operation} ${item.code ?? ''}`,
      );
    }
    if (failed.length) {
      console.error(
        `\n${failed.length} step(s) refused. The room is NOT the one this tool promises.`,
      );
      process.exitCode = 1;
      return;
    }

    console.log('\nroom now:');
    console.log(JSON.stringify(await readRoom(db, merchantId, locationId), null, 1));
  } finally {
    await db.end();
  }
}

/**
 * The one command the caller asked for, or null when they asked for the whole
 * room. Every verb names one table by its label except `--merge`, which names a
 * comma-separated list.
 *
 * Only `seat` and `merge` carry a party size. The contract is strict, so a
 * `partySize` on `clear` would be refused as an unknown field rather than
 * ignored — a small thing that decides whether this tool works at all.
 */
function singleCommand(argv, plan) {
  const flag = (name) => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? null : argv[index + 1];
  };
  const tableId = (label) => {
    const id = plan[label];
    if (!id) throw new Error(`The plan has no table ${label || '(none named)'}.`);
    return id;
  };
  const partySize = Number(flag('party') ?? 2);

  if (flag('seat'))
    return { operation: 'seat', body: { tableId: tableId(flag('seat')), partySize } };
  if (flag('merge')) {
    return {
      operation: 'merge',
      body: {
        tableIds: flag('merge')
          .split(',')
          .map((label) => tableId(label.trim())),
        partySize,
      },
    };
  }
  for (const operation of ['ordered', 'served', 'awaiting-payment', 'split', 'clear', 'open']) {
    if (flag(operation)) return { operation, body: { tableId: tableId(flag(operation)) } };
  }
  return null;
}

/** The newest active merchant, so the tool needs no ids on this workstation. */
async function pickMerchant(db) {
  const { rows } = await db.query(
    `SELECT m.id FROM merchant.merchant m
     JOIN merchant.location l ON l.merchant_id = m.id AND l.status = 'active'
     JOIN merchant.floor_plan p ON p.merchant_id = m.id AND p.location_id = l.id
     ORDER BY p.updated_at DESC LIMIT 1`,
  );
  if (!rows[0]) throw new Error('No merchant has a floor plan; nothing to seed.');
  return rows[0].id;
}

/**
 * The location whose plan has the most tables. The seed wants one table per
 * state, so the richest room is the useful default; ties go to the plan that
 * changed most recently, because that is the one someone is working on.
 */
async function pickLocation(db, merchantId) {
  const { rows } = await db.query(
    `SELECT p.location_id,
            (SELECT count(*) FROM jsonb_array_elements(coalesce(p.published, p.draft)->'areas') area,
                   jsonb_array_elements(area->'elements') element
             WHERE element->>'kind' = 'table') AS tables
     FROM merchant.floor_plan p WHERE p.merchant_id=$1::uuid
     ORDER BY tables DESC, p.updated_at DESC LIMIT 1`,
    [merchantId],
  );
  if (!rows[0]) throw new Error('That merchant has no floor plan.');
  return rows[0].location_id;
}

/** A user to sign the operator session as. Any member of the merchant will do. */
async function pickUser(db) {
  const { rows } = await db.query(
    `SELECT user_id FROM merchant.staff WHERE user_id IS NOT NULL
     ORDER BY created_at LIMIT 1`,
  );
  if (!rows[0]) throw new Error('No staff user to open an operator session as.');
  return rows[0].user_id;
}

/** The server's own plan for the location, so the seed names real tables. */
async function roomPlan(db, merchantId, locationId) {
  const { rows } = await db.query(
    `SELECT coalesce(published, draft) AS plan FROM merchant.floor_plan
     WHERE merchant_id=$1::uuid AND location_id=$2::uuid`,
    [merchantId, locationId],
  );
  const elements = (rows[0]?.plan?.areas ?? []).flatMap((area) => area.elements ?? []);
  const tables = elements.filter((element) => element.kind === 'table');
  if (tables.length < 5)
    throw new Error(`The plan has ${tables.length} table(s); the seed needs at least 5.`);
  const byLabel = {};
  for (const table of tables) byLabel[table.label] = table.id;
  const wanted = ['T1', 'T2', 'T3', 'T4', 'T5'];
  const missing = wanted.filter((label) => !byLabel[label]);
  if (missing.length) throw new Error(`The plan has no table ${missing.join(', ')}.`);
  return byLabel;
}

/**
 * The device, staff, durable session and operator session a POS command needs.
 * Idempotent: a re-run repairs the session rather than opening a second one,
 * because `operator_session_one_active_per_durable` allows one active session
 * per durable session and a stale row would refuse the next run.
 */
async function arrangeFurniture(db, { merchantId, locationId, userId }) {
  const role = await db.query(`SELECT id FROM umi.role WHERE NOT is_platform LIMIT 1`);
  const roleId = role.rows[0]?.id;

  await db.query(
    `INSERT INTO merchant.device (id, merchant_id, location_id, name, kind, status)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'pos_terminal','active')
     ON CONFLICT (id) DO UPDATE
       SET merchant_id=excluded.merchant_id, location_id=excluded.location_id,
           status='active', revoked_at=NULL, revocation_reason=NULL`,
    [SEED.device, merchantId, locationId, SEED_NAME],
  );
  await db.query(
    `INSERT INTO merchant.staff (id, merchant_id, location_id, user_id, role_id, name)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6)
     ON CONFLICT (id) DO UPDATE
       SET merchant_id=excluded.merchant_id, location_id=excluded.location_id,
           user_id=excluded.user_id, role_id=excluded.role_id`,
    [SEED.staff, merchantId, locationId, userId, roleId, SEED_NAME],
  );
  await db.query(
    `INSERT INTO runtime.session (id, merchant_id, principal_type, principal_id, token_hash)
     VALUES ($1::uuid,$2::uuid,'user',$3::uuid,$4)
     ON CONFLICT (id) DO UPDATE
       SET merchant_id=excluded.merchant_id, is_active=true, revoked_at=NULL`,
    [SEED.session, merchantId, userId, randomUUID()],
  );
  await db.query(
    `INSERT INTO runtime.operator_session
       (id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,
        permissions,entitlements,expires_at)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,
             ARRAY['sale.lifecycle'],'[{"featureKey":"pos","enabled":true}]',now()+interval '2 hours')
     ON CONFLICT (id) DO UPDATE
       SET durable_session_id=excluded.durable_session_id, user_id=excluded.user_id,
           staff_id=excluded.staff_id, device_id=excluded.device_id,
           merchant_id=excluded.merchant_id, location_id=excluded.location_id,
           permissions=excluded.permissions, entitlements=excluded.entitlements,
           state='active', ended_at=NULL, expires_at=excluded.expires_at`,
    [SEED.operator, SEED.session, userId, SEED.staff, SEED.device, merchantId, locationId],
  );
}

/** The room as the console's own read route serves it. */
async function readRoom(db, merchantId, locationId) {
  const { rows } = await db.query(
    `SELECT table_id::text AS "tableId", state, seated_at AS "seatedAt",
            party_size AS "partySize", group_id::text AS "groupId"
     FROM merchant.table_state
     WHERE merchant_id=$1::uuid AND location_id=$2::uuid ORDER BY table_id`,
    [merchantId, locationId],
  );
  return { locationId, states: rows };
}

await main();
