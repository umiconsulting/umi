/**
 * Work a real kitchen ticket from the till, over HTTP, against the running API.
 *
 * Defect D33 (§8H step 3) was found live and must be answered live: the POS board
 * could not be worked, not because the command shape was missing but because the
 * route the till was calling cannot serve a station-less device. This tool mints
 * the operator session a till would hold, picks a REAL ticket the board is showing,
 * and then walks the command path twice:
 *
 *   1. the board read the same device performs            → it can SEE the ticket
 *   2. `POST /api/kds/command` (the iPad device route)    → the before-state
 *   3. `POST .../kitchen/command` (the POS route)         → start, bump, replay,
 *                                                            recall, complete
 *   4. the database afterwards: the journal rows (actor, not device), the events
 *      and the item states
 *
 * It writes, and it writes through the product's own routes except for the operator
 * session itself (a session is what a sign-in mints; no route mints one for a
 * script). The ticket it works is left COMPLETED, which is the point: D33's symptom
 * was tickets that could never leave the board.
 *
 * Run:
 *   node tools/ux-sweep/kitchen-command-probe.mjs
 *   node tools/ux-sweep/kitchen-command-probe.mjs --base http://127.0.0.1:4013
 *   node tools/ux-sweep/kitchen-command-probe.mjs --ticket <kitchenOrderId>
 *   node tools/ux-sweep/kitchen-command-probe.mjs --plan   # pick and print, no writes
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(`${ROOT}/apps/umi-api/package.json`);
const { Client } = require('pg');

/** Fixed ids, so a re-run repairs its own furniture instead of stacking rows. */
const SEED = {
  user: '9e000000-0000-4000-8000-0000000000b1',
  staff: '9e000000-0000-4000-8000-0000000000a1',
  device: '9e000000-0000-4000-8000-0000000000d1',
  session: '9e000000-0000-4000-8000-0000000000e1',
  deviceSession: '9e000000-0000-4000-8000-0000000000c1',
  operator: '9e000000-0000-4000-8000-0000000000f1',
};
const NAME = 'kitchen command probe';
const FULL_PERMISSIONS = [
  'kitchen.read',
  'kitchen.prepare',
  'kitchen.ready',
  'kitchen.complete',
  'kitchen.recall',
];

function dotenv(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * The access token a till holds. Same algorithm, issuer, audience and claims as
 * `shared/auth/jwt.service.ts` — the guard verifies this with the product's own
 * code, so it is only "a token a till could hold" if it is built to the same rules.
 * `device_id` is what makes the request a till request.
 */
function accessToken(secret, { userId, sessionId, deviceId }) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = [
    b64({ alg: 'HS256', typ: 'JWT' }),
    b64({
      sub: userId,
      email: 'kitchen-command-probe@local',
      sid: sessionId,
      device_id: deviceId,
      typ: 'access',
      iss: 'umi-api',
      aud: 'umi-dashboard',
      iat: now,
      exp: now + 3600,
    }),
  ].join('.');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

/** One HTTP call. Never throws on a refusal: a refusal is the result. */
async function call({ base, method = 'POST', path, token, headers = {}, body }) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

/** The machine code a client reads, whether the body is the envelope or legacy. */
const codeOf = (payload) =>
  payload?.error?.code ??
  (typeof payload?.error === 'string' ? payload.error : null) ??
  payload?.data?.code ??
  null;

function report(label, { status, payload }) {
  const code = codeOf(payload);
  const mark = status < 300 ? 'ok ' : 'ERR';
  console.log(`${mark} ${String(status)} ${label}${code ? `  ${code}` : ''}`);
  return { status, payload, code };
}

/** A kitchen command body for the POS route, with the POS context the DTO requires. */
const posCommand = ({
  locationId,
  operatorSessionId,
  kitchenOrderId,
  expectedVersion,
  commandType,
  itemIds = [],
  reasonCode = null,
  priority = null,
}) => ({
  action: 'command',
  commandId: randomUUID(),
  idempotencyKey: `probe-${randomUUID()}`,
  correlationId: `probe-${randomUUID()}`,
  expectedVersion,
  kitchenOrderId,
  commandType,
  itemIds,
  reasonCode,
  reasonNote: null,
  priority,
  locationId,
  operatorSessionId,
});

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name, fallback = null) => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? fallback : argv[index + 1];
  };
  const planOnly = argv.includes('--plan');

  const env = dotenv(`${ROOT}/apps/umi-api/.env`);
  const dsn = env.DATABASE_URL_WORKER ?? env.DATABASE_URL_APP;
  const secret = env.JWT_SECRET;
  if (!dsn || !secret) {
    throw new Error('apps/umi-api/.env must define DATABASE_URL_WORKER and JWT_SECRET');
  }
  const base = flag('base', 'http://127.0.0.1:4001').replace(/\/+$/, '');

  const db = new Client({ connectionString: dsn });
  await db.connect();
  try {
    // Which build answers? A process running pre-change code says so in /health, and
    // that is worth printing: a green probe against the wrong build proves nothing.
    const health = await call({ base, method: 'GET', path: '/health' });
    console.log(
      `api ${base} — ${health.payload?.status ?? 'unknown'}, contract ${health.payload?.release?.contractVersion ?? '?'}\n`,
    );

    const merchantId = flag('merchant') ?? (await pickMerchant(db));
    const locationId = flag('location') ?? (await pickLocation(db, merchantId));
    const ticket = await pickTicket(db, merchantId, locationId, flag('ticket'));
    console.log(
      `merchant ${merchantId}\nlocation ${locationId}\nticket   ${ticket.id} (${ticket.publicReference}, ${ticket.status}, seated/api ${ticket.queuedAt})\nitems    ${ticket.items.map((i) => `${i.id.slice(0, 8)}:${i.status}`).join(' ')}\n`,
    );
    if (planOnly) return;

    const user = await arrangeFurniture(db, { merchantId, locationId });
    const token = accessToken(secret, {
      userId: user.userId,
      sessionId: SEED.session,
      deviceId: SEED.device,
    });
    // The iPad route authenticates a DEVICE by token hash. This session carries the
    // till's own metadata shape (`locationId`, the key the till writes) and a copy
    // under `location_id`, so the refusal that follows cannot be blamed on a missing
    // location: the station is the only thing left.
    await upsertDeviceSession(db, { merchantId, locationId, token });

    const context = { locationId, operatorSessionId: SEED.operator };

    // ── 1. the board read: the same device can see the ticket ────────────────────
    const query = new URLSearchParams(context).toString();
    const board = report(
      'GET  board (the till reads the room)',
      await call({
        base,
        method: 'GET',
        path: `/api/v1/pos/merchants/${merchantId}/kitchen/board?${query}`,
        token,
      }),
    );
    const onBoard = Array.isArray(board.payload?.data)
      ? board.payload.data.find((row) => row.id === ticket.id)
      : null;
    console.log(
      `     board lists ${Array.isArray(board.payload?.data) ? board.payload.data.length : 0} ticket(s); this one: ${onBoard ? `${onBoard.status}, version ${onBoard.version}` : 'NOT LISTED'}\n`,
    );

    // ── 2. the before-state: the iPad device route on the same ticket ────────────
    const before = report(
      'POST /api/kds/command  (device route, x-kds-device-token)',
      await call({
        base,
        path: '/api/kds/command',
        headers: { 'x-kds-device-token': token },
        body: {
          action: 'command',
          commandId: randomUUID(),
          idempotencyKey: `probe-${randomUUID()}`,
          correlationId: `probe-${randomUUID()}`,
          expectedVersion: ticket.version,
          kitchenOrderId: ticket.id,
          commandType: 'start_preparation',
          itemIds: [],
          reasonCode: null,
          reasonNote: null,
          priority: null,
        },
      }),
    );
    console.log(
      `     ${before.status === 404 ? 'the device route cannot serve a station-less till — this is D33' : 'UNEXPECTED: the device route answered'}\n`,
    );

    const pos = (body) =>
      call({
        base,
        path: `/api/v1/pos/merchants/${merchantId}/kitchen/command`,
        token,
        body: { ...body, ...context },
      });

    // ── 3. the route the fix adds ───────────────────────────────────────────────
    let version = Number(onBoard?.version ?? ticket.version);
    const results = [];
    // The ticket's own state decides the first verb: the state machine refuses
    // `start_preparation` on a ticket that is already ready (kitchen-domain
    // TRANSITIONS), and the picker prefers a queued ticket so this default run walks
    // the whole cook's path.
    if (ticket.status !== 'ready') {
      const started = report(
        'POST start_preparation    (POS route)',
        await pos(
          posCommand({
            ...context,
            kitchenOrderId: ticket.id,
            expectedVersion: version,
            commandType: 'start_preparation',
          }),
        ),
      );
      results.push(started);
      version = Number(started.payload?.data?.version ?? version + 1);
    }

    const firstItem = onBoard?.items?.[0]?.id ?? ticket.items[0]?.id;
    const bump = posCommand({
      ...context,
      kitchenOrderId: ticket.id,
      expectedVersion: version,
      commandType: 'mark_item_ready',
      itemIds: [firstItem],
    });
    const bumped = report(
      `POST mark_item_ready       (POS route, item ${String(firstItem).slice(0, 8)})`,
      await pos(bump),
    );
    results.push(bumped);
    version = Number(bumped.payload?.data?.version ?? version + 1);

    // The same identity twice. A retry after a lost response must replay the recorded
    // outcome, not bump the same dish twice (the journal is keyed on merchant +
    // idempotency key, and the fingerprint covers the payload).
    const replay = report('POST mark_item_ready       (replay, same identity)', await pos(bump));
    results.push(replay);
    console.log(
      `     replay returned ${JSON.stringify(replay.payload?.data ?? replay.payload)} — ${replay.status === bumped.status ? 'same outcome' : 'DIFFERENT OUTCOME'}\n`,
    );

    // ── recall: refused by name without the permission, allowed with it ──────────
    await setOperatorPermissions(db, [
      'kitchen.read',
      'kitchen.prepare',
      'kitchen.ready',
      'kitchen.complete',
    ]);
    const recalledWithout = report(
      'POST recall                (POS route, no kitchen.recall)',
      await pos(
        posCommand({
          ...context,
          kitchenOrderId: ticket.id,
          expectedVersion: version,
          commandType: 'recall',
          reasonCode: 'probe',
        }),
      ),
    );
    console.log(
      `     refusal names: ${JSON.stringify(recalledWithout.payload?.error?.details ?? null)} / ${recalledWithout.payload?.error?.message ?? ''}\n`,
    );
    results.push(recalledWithout);

    await setOperatorPermissions(db, FULL_PERMISSIONS);
    const recalled = report(
      'POST recall                (POS route, kitchen.recall granted)',
      await pos(
        posCommand({
          ...context,
          kitchenOrderId: ticket.id,
          expectedVersion: version,
          commandType: 'recall',
          reasonCode: 'probe',
        }),
      ),
    );
    results.push(recalled);
    version = Number(recalled.payload?.data?.version ?? version + 1);

    // Recall puts every ready line back to preparing, so the cook's next act is to
    // bump whatever is still open — read from the board, exactly as the surface does.
    const reopened = await call({
      base,
      method: 'GET',
      path: `/api/v1/pos/merchants/${merchantId}/kitchen/board?${query}`,
      token,
    });
    const reopenedTicket = Array.isArray(reopened.payload?.data)
      ? reopened.payload.data.find((row) => row.id === ticket.id)
      : null;
    const pending = (reopenedTicket?.items ?? []).filter(
      (item) => item.status === 'queued' || item.status === 'preparing',
    );
    if (pending.length) {
      const readied = report(
        `POST mark_item_ready       (POS route, remaining ${pending.length} item(s))`,
        await pos(
          posCommand({
            ...context,
            kitchenOrderId: ticket.id,
            expectedVersion: version,
            commandType: 'mark_item_ready',
            itemIds: pending.map((item) => item.id),
          }),
        ),
      );
      results.push(readied);
      version = Number(readied.payload?.data?.version ?? version + 1);
    }

    const completed = report(
      'POST complete              (POS route)',
      await pos(
        posCommand({
          ...context,
          kitchenOrderId: ticket.id,
          expectedVersion: version,
          commandType: 'complete',
        }),
      ),
    );
    results.push(completed);

    // ── 4. the board afterwards, and the row the command left behind ─────────────
    const after = await call({
      base,
      method: 'GET',
      path: `/api/v1/pos/merchants/${merchantId}/kitchen/board?${query}`,
      token,
    });
    const stillOnBoard = Array.isArray(after.payload?.data)
      ? after.payload.data.some((row) => row.id === ticket.id)
      : null;
    console.log(
      `\nboard lists ${Array.isArray(after.payload?.data) ? after.payload.data.length : '?'} ticket(s); this one ${stillOnBoard === null ? 'unknown' : stillOnBoard ? 'STILL LISTED' : 'is gone (completed)'}\n`,
    );

    console.log('journal (merchant.kitchen_command):');
    console.table(await journal(db, merchantId, ticket.id));
    console.log('items:');
    console.table(await items(db, merchantId, ticket.id));
    console.log('events:');
    console.table(await events(db, merchantId, ticket.id));
    console.log('ticket:', await ticketRow(db, merchantId, ticket.id));

    // The one refusal this run EXPECTS is recall without kitchen.recall: it must fail,
    // and it must name the permission. Every other command must have succeeded.
    const failed = results.filter((r) => r !== recalledWithout && r.status >= 300);
    if (failed.length) {
      console.error(
        `\n${failed.length} command(s) refused. The path is NOT the one this tool promises.`,
      );
      process.exitCode = 1;
    }
    if (recalledWithout.payload?.error?.code !== 'KITCHEN_PERMISSION_REQUIRED') {
      console.error('\nrecall without kitchen.recall did not name the permission.');
      process.exitCode = 1;
    }
  } finally {
    await db.end();
  }
}

/** The merchant with a location that has active stations — the only kind that has a board. */
async function pickMerchant(db) {
  const { rows } = await db.query(
    `SELECT s.merchant_id FROM merchant.station s WHERE s.status='active'
     GROUP BY s.merchant_id ORDER BY count(*) DESC LIMIT 1`,
  );
  if (!rows[0]) throw new Error('No merchant has an active station; nothing to work.');
  return rows[0].merchant_id;
}

async function pickLocation(db, merchantId) {
  const { rows } = await db.query(
    `SELECT location_id FROM merchant.station
     WHERE merchant_id=$1::uuid AND status='active' AND location_id IS NOT NULL
     GROUP BY location_id ORDER BY count(*) DESC LIMIT 1`,
    [merchantId],
  );
  if (!rows[0]) throw new Error('That merchant has no location with active stations.');
  return rows[0].location_id;
}

/**
 * The oldest QUEUED ticket, because that is the one a cook starts from and the whole
 * lifecycle is walkable from it. A sweep that picked a `ready` ticket would hit the
 * state machine's refusal of `start_preparation` and report it as a defect of the route.
 */
async function pickTicket(db, merchantId, locationId, requested) {
  const requestedId = requested ?? null;
  const { rows } = await db.query(
    `SELECT ko.id::text,ko.public_reference,ko.status,ko.version::text,ko.queued_at::text
       FROM merchant.kitchen_order ko
      WHERE ko.merchant_id=$1::uuid AND ko.location_id=$2::uuid
        AND ko.status IN ('queued','in_preparation','partially_ready','ready','exception')
        AND ($3::uuid IS NULL OR ko.id=$3::uuid)
      ORDER BY (ko.status <> 'queued'), ko.queued_at ASC LIMIT 1`,
    [merchantId, locationId, requestedId],
  );
  const row = rows[0];
  if (!row) throw new Error('No active kitchen ticket at that location.');
  const { rows: items } = await db.query(
    `SELECT id::text,status,station_id::text,display_order FROM merchant.kitchen_order_item
      WHERE merchant_id=$1::uuid AND kitchen_order_id=$2::uuid ORDER BY display_order,id`,
    [merchantId, row.id],
  );
  return {
    id: row.id,
    publicReference: row.public_reference,
    status: row.status,
    version: Number(row.version),
    queuedAt: row.queued_at,
    items,
  };
}

/** A user, a POS device with NO station, a durable session and a live operator session. */
async function arrangeFurniture(db, { merchantId, locationId }) {
  const role = await db.query(`SELECT id FROM umi.role WHERE NOT is_platform LIMIT 1`);
  const roleId = role.rows[0]?.id;
  if (!roleId) throw new Error('No non-platform role exists to attach the probe staff row to.');

  await db.query(
    `INSERT INTO umi.user (id,email,full_name,status)
     VALUES ($1::uuid,'kitchen-command-probe@local',$2,'active')
     ON CONFLICT (id) DO UPDATE SET status='active', full_name=excluded.full_name`,
    [SEED.user, NAME],
  );
  await db.query(
    `INSERT INTO merchant.staff (id,merchant_id,location_id,user_id,role_id,name)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6)
     ON CONFLICT (id) DO UPDATE
       SET merchant_id=excluded.merchant_id, location_id=excluded.location_id,
           user_id=excluded.user_id, role_id=excluded.role_id, status='active'`,
    [SEED.staff, merchantId, locationId, SEED.user, roleId, NAME],
  );
  // The enrolled device: `station_id` is NULL, which is the whole point of D33.
  await db.query(
    `INSERT INTO merchant.device (id,merchant_id,location_id,station_id,name,kind,status,credential_version)
     VALUES ($1::uuid,$2::uuid,$3::uuid,NULL,$4,'pos_terminal','active',1)
     ON CONFLICT (id) DO UPDATE
       SET merchant_id=excluded.merchant_id, location_id=excluded.location_id, station_id=NULL,
           status='active', revoked_at=NULL, revocation_reason=NULL`,
    [SEED.device, merchantId, locationId, NAME],
  );
  await db.query(
    `INSERT INTO runtime.session (id,merchant_id,principal_type,principal_id,token_hash)
     VALUES ($1::uuid,$2::uuid,'user',$3::uuid,$4)
     ON CONFLICT (id) DO UPDATE SET merchant_id=excluded.merchant_id, is_active=true, revoked_at=NULL`,
    [SEED.session, merchantId, SEED.user, randomUUID()],
  );
  await upsertOperator(db, { merchantId, locationId, permissions: FULL_PERMISSIONS });
  return { userId: SEED.user };
}

async function upsertOperator(db, { merchantId, locationId, permissions }) {
  await db.query(
    `INSERT INTO runtime.operator_session
       (id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,
        permissions,entitlements,expires_at)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,
             $8::text[],'[{"featureKey":"pos","enabled":true}]',now()+interval '2 hours')
     ON CONFLICT (id) DO UPDATE
       SET durable_session_id=excluded.durable_session_id, user_id=excluded.user_id,
           staff_id=excluded.staff_id, device_id=excluded.device_id,
           merchant_id=excluded.merchant_id, location_id=excluded.location_id,
           permissions=excluded.permissions, entitlements=excluded.entitlements,
           state='active', ended_at=NULL, expires_at=excluded.expires_at`,
    [
      SEED.operator,
      SEED.session,
      SEED.user,
      SEED.staff,
      SEED.device,
      merchantId,
      locationId,
      permissions,
    ],
  );
}

async function setOperatorPermissions(db, permissions) {
  await db.query(`UPDATE runtime.operator_session SET permissions=$2::text[] WHERE id=$1::uuid`, [
    SEED.operator,
    permissions,
  ]);
}

/**
 * The device session the iPad route authenticates against, with the till's own
 * metadata shape. `locationId` is what the till writes and `location_id` is what
 * `verifyDevice` reads; both are set here so the refusal that follows is about the
 * STATION and nothing else.
 */
async function upsertDeviceSession(db, { merchantId, locationId, token }) {
  await db.query(
    `INSERT INTO runtime.session
       (id,merchant_id,principal_type,principal_id,station_id,device_name,token_hash,is_active,metadata)
     VALUES ($1::uuid,$2::uuid,'device',$3::uuid,NULL,$4,$5,true,
             jsonb_build_object('locationId',$6::text,'location_id',$6::text))
     ON CONFLICT (id) DO UPDATE
       SET token_hash=excluded.token_hash, is_active=true, metadata=excluded.metadata`,
    [
      SEED.deviceSession,
      merchantId,
      SEED.device,
      NAME,
      createHash('sha256').update(token).digest('hex'),
      locationId,
    ],
  );
}

async function journal(db, merchantId, kitchenOrderId) {
  const { rows } = await db.query(
    `SELECT command_type,status,device_id::text AS device,actor_user_id::text AS actor,
            expected_version::text AS expected,idempotency_key
       FROM merchant.kitchen_command
      WHERE merchant_id=$1::uuid AND kitchen_order_id=$2::uuid ORDER BY created_at`,
    [merchantId, kitchenOrderId],
  );
  return rows;
}

async function items(db, merchantId, kitchenOrderId) {
  const { rows } = await db.query(
    `SELECT id::text AS item,status,version::text,station_id::text AS station
       FROM merchant.kitchen_order_item
      WHERE merchant_id=$1::uuid AND kitchen_order_id=$2::uuid ORDER BY display_order,id`,
    [merchantId, kitchenOrderId],
  );
  return rows;
}

async function events(db, merchantId, kitchenOrderId) {
  const { rows } = await db.query(
    `SELECT sequence::text,kind,status,station_id::text AS station
       FROM merchant.kitchen_event
      WHERE merchant_id=$1::uuid AND kitchen_order_id=$2::uuid ORDER BY sequence`,
    [merchantId, kitchenOrderId],
  );
  return rows;
}

async function ticketRow(db, merchantId, kitchenOrderId) {
  const { rows } = await db.query(
    `SELECT status,version::text,updated_at::text FROM merchant.kitchen_order
      WHERE merchant_id=$1::uuid AND id=$2::uuid`,
    [merchantId, kitchenOrderId],
  );
  return rows[0];
}

await main();
