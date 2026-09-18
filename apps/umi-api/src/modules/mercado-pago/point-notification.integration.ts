import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import type { AuthUser } from '../auth/auth.types';
import { IntegrityRepository } from '../integrity/integrity.repository';
import { IntegrityService } from '../integrity/integrity.service';
import { PosCheckoutRepository } from '../pos-checkout/pos-checkout.repository';
import { MercadoPagoPointProvider } from '../tender/providers/mercado-pago-point.provider';
import {
  MercadoPagoPointTransport,
  pointIdempotencyKey,
} from '../tender/providers/mercado-pago-point.transport';
import { TenderProviderRegistry } from '../tender/tender-provider.registry';
import { TenderRepository } from '../tender/tender.repository';
import { TenderService } from '../tender/tender.service';

/**
 * THE TERMINAL'S OWN ANSWER, AGAINST THE REAL SCHEMA — §4 Phase 2's acceptance.
 *
 * "A duplicated notification resolves once. A notification that arrives before the
 * customer finishes does not resolve the attempt." Those two sentences are the whole file,
 * plus the two invariants they lean on: the terminal lock of plan D4, and the documented
 * exception that lets a late `processed` correct a premature decline.
 *
 * WHY THE TRANSPORT IS REAL AND ONLY THE VENDOR IS FAKE. The unit suite beside this file
 * proves the request shape from a captured `fetch`. What it cannot prove is that the shape
 * survives contact with a database: that the order id the vendor returns becomes the row's
 * `provider_order_id`, that the payment id it returns is enough to resolve an attempt, and
 * that a second delivery of the same notification writes nothing. So this file runs the
 * REAL `MercadoPagoPointTransport` against a local HTTP stub that answers the vendor's two
 * documented endpoints, and reads every claim back out of SQL.
 *
 * WHAT IS NOT HERE, and where it is proved instead: the signature check and the 401 for a
 * tampered body are `point-signature.spec.ts` and `point-webhook.controller.spec.ts` — they
 * never reach the database, so there is nothing for a database to witness.
 *
 *   set -a && . apps/umi-api/.env && set +a
 *   DATABASE_URL_APP=$(echo "$DATABASE_URL_APP" | sed 's#/umi_transition_rehearsal_20260901#/umi_build_v3_mp#') \
 *   DATABASE_URL_WORKER=$(echo "$DATABASE_URL_WORKER" | sed 's#/umi_transition_rehearsal_20260901#/umi_build_v3_mp#') \
 *   npx vitest run --config vitest.integration.config.ts \
 *     src/modules/mercado-pago/point-notification.integration.ts
 */

const APP_DSN = process.env.DATABASE_URL_APP;
const WORKER_DSN = process.env.DATABASE_URL_WORKER;

const JWT_SECRET = 'point-notification-harness-0000000';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
    JWT_SECRET,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const MERCHANT = '7e000000-0000-4000-8000-0000000000b1';
const LOCATION = '7e000000-0000-4000-8000-0000000000b2';
const USER = '7e000000-0000-4000-8000-0000000000c1';
const DEVICE = '7e000000-0000-4000-8000-0000000000c2';
const STAFF = '7e000000-0000-4000-8000-0000000000c3';
const SESSION = '7e000000-0000-4000-8000-0000000000c4';
const OPERATOR_SESSION = '7e000000-0000-4000-8000-0000000000c5';
const CART = '7e000000-0000-4000-8000-0000000000d1';

const PERMISSIONS = ['checkout.commit', 'sale.lifecycle', 'checkout.terminal.confirm'];
const ENTITLEMENTS = JSON.stringify([{ featureKey: 'pos', enabled: true }]);

const user: AuthUser = {
  id: USER,
  sessionId: SESSION,
  deviceId: DEVICE,
  email: 'point@harness.test',
  displayName: 'Point Harness',
} as AuthUser;

/** One order as the stub vendor holds it. `status_detail` is what a refund arrives in. */
interface StubOrder {
  id: string;
  paymentId: string | null;
  amount: string;
  externalReference: string | null;
  status: string;
  statusDetail: string | null;
  paymentStatusDetail: string | null;
}

interface RecordedRequest {
  method: string;
  path: string;
  idempotencyKey: string | null;
  body: Record<string, unknown> | null;
}

describe('the Point notification path · §4 Phase 2 acceptance', () => {
  let pg: PgService;
  let server: Server;
  let baseUrl: string;
  let orders: Map<string, StubOrder>;
  let requests: RecordedRequest[];
  let orderSeq: number;
  /** A per-run tag: the D4 lock is per terminal, so a re-run must not inherit a lock. */
  let runTag: string;

  const scoped = <T>(fn: () => Promise<T>) =>
    runWithRequestContext(
      {
        merchantId: MERCHANT,
        locationId: LOCATION,
        userId: USER,
        deviceId: DEVICE,
        requestId: randomUUID(),
      },
      fn,
    );

  /** A terminal no earlier run of this file has ever held an open order on. */
  const terminalFor = (label: string) => `NEWLAND_N950__${runTag}${label}`;

  const buildTender = (terminalId: string) => {
    const transport = new MercadoPagoPointTransport({
      accessToken: 'TEST-ACCESS-TOKEN',
      terminalId,
      baseUrl,
    });
    return new TenderService(
      new TenderRepository(pg, new PosCheckoutRepository(pg)),
      new TenderProviderRegistry([new MercadoPagoPointProvider(transport)]),
      new IntegrityService(new IntegrityRepository(pg)),
    );
  };

  const capture = (
    service: TenderService,
    overrides: { commandIdentity?: string; amountMinorUnits?: number } = {},
  ) =>
    scoped(() =>
      service.capture(user, MERCHANT, {
        cartId: CART,
        tenderId: randomUUID(),
        locationId: LOCATION,
        operatorSessionId: OPERATOR_SESSION,
        commandIdentity: overrides.commandIdentity ?? randomUUID(),
        provider: 'mercado_pago_point',
        amount: { minorUnits: overrides.amountMinorUnits ?? 9_000, currency: 'MXN' },
        idempotencyKey: randomUUID(),
      }),
    );

  /** The row the database actually holds. Every money claim is read from here. */
  const attemptRow = async (commandIdentity: string) => {
    const { rows } = await pg.tquery<{
      id: string;
      status: string;
      query_only: boolean;
      proof_source: string | null;
      provider: string | null;
      provider_order_id: string | null;
      provider_payment_id: string | null;
      provider_status: string | null;
      provider_query_count: number;
      resolved_at: string | null;
      terminal_id: string | null;
    }>(
      MERCHANT,
      `SELECT id::text,status,query_only,proof_source,provider,provider_order_id,
              provider_payment_id,provider_status,provider_query_count,
              resolved_at::text AS resolved_at,terminal_id
         FROM merchant.pos_payment_attempt
        WHERE merchant_id=$1::uuid AND command_identity=$2::uuid`,
      [MERCHANT, commandIdentity],
    );
    return rows[0] ?? null;
  };

  beforeAll(async () => {
    if (!APP_DSN || !WORKER_DSN) {
      throw new Error(
        'Set DATABASE_URL_APP and DATABASE_URL_WORKER to a DISPOSABLE build-v3 database.',
      );
    }
    // The serial carries the run, so the D4 lock is never inherited from an earlier run.
    runTag = `R${Date.now().toString(36).toUpperCase()}`;
    orders = new Map();
    requests = [];
    orderSeq = 0;

    // ── The vendor, as the transport sees it: two documented endpoints and nothing else.
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : null;
        const header = req.headers['x-idempotency-key'];
        requests.push({
          method: req.method ?? '',
          path: req.url ?? '',
          idempotencyKey: Array.isArray(header) ? (header[0] ?? null) : (header ?? null),
          body,
        });
        const json = (status: number, payload: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(payload));
        };
        if (req.method === 'POST' && req.url === '/v1/orders') {
          orderSeq += 1;
          const order: StubOrder = {
            id: `ORDSTUB${String(orderSeq).padStart(18, '0')}`,
            paymentId: `PAYSTUB${String(orderSeq).padStart(18, '0')}`,
            amount: readAmount(body),
            externalReference:
              typeof body?.external_reference === 'string' ? body.external_reference : null,
            status: 'created',
            statusDetail: 'created',
            paymentStatusDetail: 'at_terminal',
          };
          orders.set(order.id, order);
          json(201, orderBody(order));
          return;
        }
        const match = /^\/v1\/orders\/([^/?]+)$/.exec(req.url ?? '');
        if (req.method === 'GET' && match) {
          const order = orders.get(decodeURIComponent(match[1]));
          if (!order) {
            json(404, { errors: [{ code: 'order_not_found', message: 'Order not found.' }] });
            return;
          }
          json(200, orderBody(order));
          return;
        }
        json(404, { errors: [{ code: 'not_found', message: 'no such stub route' }] });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('stub server did not bind');
    baseUrl = `http://127.0.0.1:${address.port}`;

    pg = new PgService(makeConfig());
    await pg.onModuleInit();

    // ── The harness's own tenant, till, operator and cart (mirrors tender.integration).
    await pg.query(
      `INSERT INTO merchant.merchant (id,name,handle) VALUES ($1::uuid,'Point Harness','point-harness')
       ON CONFLICT (id) DO NOTHING`,
      [MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.location (id,merchant_id,name) VALUES ($1::uuid,$2::uuid,'Culiacán')
       ON CONFLICT (id) DO NOTHING`,
      [LOCATION, MERCHANT],
    );
    await pg.query(
      `INSERT INTO umi."user" (id,full_name) VALUES ($1::uuid,'Cajera') ON CONFLICT (id) DO NOTHING`,
      [USER],
    );
    await pg.query(
      `INSERT INTO runtime.session (id,merchant_id,principal_type,principal_id,token_hash,expires_at)
       VALUES ($1::uuid,$2::uuid,'user',$3::uuid,repeat('b',64),now()+interval '1 day')
       ON CONFLICT (id) DO NOTHING`,
      [SESSION, MERCHANT, USER],
    );
    await pg.query(
      `INSERT INTO merchant.device (id,merchant_id,name,status)
       VALUES ($1::uuid,$2::uuid,'Till 1','active') ON CONFLICT (id) DO NOTHING`,
      [DEVICE, MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.staff (id,merchant_id,user_id,role_id,name)
       SELECT $1::uuid,$2::uuid,$3::uuid,(SELECT id FROM umi.role WHERE key='cashier'),'Cajera'
       ON CONFLICT (id) DO NOTHING`,
      [STAFF, MERCHANT, USER],
    );
    await pg.query(
      `INSERT INTO runtime.operator_session
         (id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,
          permissions,entitlements,expires_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,
               $8::text[],$9::jsonb,now()+interval '1 day')
       ON CONFLICT (id) DO UPDATE SET
         permissions=excluded.permissions, entitlements=excluded.entitlements,
         state='active', expires_at=excluded.expires_at`,
      [
        OPERATOR_SESSION,
        SESSION,
        USER,
        STAFF,
        DEVICE,
        MERCHANT,
        LOCATION,
        PERMISSIONS,
        ENTITLEMENTS,
      ],
    );
    await pg.query(
      `INSERT INTO merchant.pos_cart
         (id,merchant_id,location_id,operator_session_id,business_date,
          original_operator_session_id,original_operator_user_id,operator_user_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,current_date,$4::uuid,$5::uuid,$5::uuid)
       ON CONFLICT (id) DO NOTHING`,
      [CART, MERCHANT, LOCATION, OPERATOR_SESSION, USER],
    );
  }, 60_000);

  afterAll(async () => {
    if (pg) await pg.onModuleDestroy();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }, 60_000);

  beforeEach(() => {
    requests.length = 0;
  });

  it('answers the terminal notification once, and a duplicate changes nothing', async () => {
    const terminal = terminalFor('A');
    const service = buildTender(terminal);
    const commandIdentity = randomUUID();

    // The capture the till makes: the vendor accepts the order and the customer has not
    // finished, so the till is told `unknown` and told when to ask again.
    const captured = await capture(service, { commandIdentity });
    expect(captured.outcome.kind).toBe('unknown');
    expect(captured.providerCalled).toBe(true);

    // The vendor's own request, asserted from what it actually received.
    const create = requests.find((request) => request.path === '/v1/orders');
    expect(create).toBeDefined();
    expect(create?.idempotencyKey).toBe(pointIdempotencyKey(commandIdentity, 'create_order'));
    const pointConfig = (create?.body?.config as { point?: Record<string, unknown> } | undefined)
      ?.point;
    expect(pointConfig?.terminal_id).toBe(terminal);
    const payments = (create?.body?.transactions as { payments?: Array<{ amount: string }> })
      ?.payments;
    expect(payments?.[0]?.amount).toBe('90.00');

    const before = await attemptRow(commandIdentity);
    const order = orders.get(before?.provider_order_id as string);
    expect(order).toBeDefined();
    expect(before?.terminal_id).toBe(terminal);
    expect(before?.status).toBe('unknown');

    // The customer pays. The notification is a WAKE-UP, so the first delivery resolves the
    // attempt by re-reading the order — and the second is a duplicate that must not.
    order!.status = 'processed';
    order!.paymentStatusDetail = 'accredited';

    const first = await service.resolveFromNotification({
      providerOrderId: before?.provider_order_id ?? null,
      commandIdentity,
      statusHint: 'processed',
      correlationId: randomUUID(),
    });
    expect(first?.state).toBe('succeeded');
    expect(first?.resolvedNow).toBe(true);

    const resolved = await attemptRow(commandIdentity);
    expect(resolved?.status).toBe('succeeded');
    expect(resolved?.proof_source).toBe('provider');
    expect(resolved?.provider_payment_id).toBe(order!.paymentId);
    expect(resolved?.provider_query_count).toBe(1);

    const second = await service.resolveFromNotification({
      providerOrderId: before?.provider_order_id ?? null,
      commandIdentity,
      statusHint: 'processed',
      correlationId: randomUUID(),
    });
    expect(second?.state).toBe('succeeded');
    expect(second?.providerAsked).toBe(false);
    expect(second?.resolvedNow).toBe(false);

    const unchanged = await attemptRow(commandIdentity);
    // Nothing moved on the duplicate: not the state, not the proof, not the query count,
    // and not the moment it was resolved.
    expect(unchanged?.status).toBe('succeeded');
    expect(unchanged?.provider_query_count).toBe(1);
    expect(unchanged?.resolved_at).toBe(resolved?.resolved_at);
  }, 60_000);

  it('does not resolve an attempt the customer has not finished', async () => {
    const terminal = terminalFor('B');
    const service = buildTender(terminal);
    const commandIdentity = randomUUID();

    const captured = await capture(service, { commandIdentity });
    expect(captured.outcome.kind).toBe('unknown');
    const row = await attemptRow(commandIdentity);

    // The vendor is still holding the order at the terminal — `created` and `at_terminal`
    // are the two statuses that mean "not finished", and neither is an outcome. The
    // notification is answered by asking, and the answer is that there is no answer yet.
    const resolved = await service.resolveFromNotification({
      providerOrderId: row?.provider_order_id ?? null,
      commandIdentity,
      statusHint: 'created',
      correlationId: randomUUID(),
    });
    expect(resolved?.providerAsked).toBe(true);
    expect(resolved?.resolvedNow).toBe(false);
    expect(resolved?.state).toBe('unknown');

    const still = await attemptRow(commandIdentity);
    expect(still?.status).toBe('unknown');
    expect(still?.query_only).toBe(true);
    expect(still?.resolved_at).toBeNull();
  }, 60_000);

  it('refuses a second open order for the same terminal, by name', async () => {
    const terminal = terminalFor('C');
    const service = buildTender(terminal);

    const first = await capture(service, { commandIdentity: randomUUID() });
    expect(first.outcome.kind).toBe('unknown');

    // The vendor documents `409 already_queued_order_for_terminal` and the till must not
    // learn about it from a conflict AFTER the customer has decided. Our own layer is the
    // row: the partial unique index refuses the insert and the refusal is NAMED.
    await expect(capture(service, { commandIdentity: randomUUID() })).rejects.toMatchObject({
      response: { code: 'TERMINAL_BUSY' },
    });

    const { rows } = await pg.tquery<{ count: string }>(
      MERCHANT,
      `SELECT count(*)::text AS count
         FROM merchant.pos_payment_attempt
        WHERE merchant_id=$1::uuid AND terminal_id=$2 AND status IN ('pending','unknown','timeout')`,
      [MERCHANT, terminal],
    );
    expect(rows[0]?.count).toBe('1');
  }, 60_000);

  it('lets a late `processed` correct a decline, and writes nothing else', async () => {
    const terminal = terminalFor('D');
    const service = buildTender(terminal);
    const commandIdentity = randomUUID();

    const captured = await capture(service, { commandIdentity });
    const row = await attemptRow(commandIdentity);
    const order = orders.get(row?.provider_order_id as string)!;
    expect(order).toBeDefined();
    expect(captured.outcome.kind).toBe('unknown');

    // The terminal first reports a refusal, then — the documented case — the payment is
    // actually there. `resolveAttempt` freezes a decline against every rewrite EXCEPT this
    // one: money that moved must be recorded, and freezing the decline would hide a charge.
    order.status = 'failed';
    order.paymentStatusDetail = 'bad_filled_card_data';
    const declined = await service.resolveFromNotification({
      providerOrderId: order.id,
      commandIdentity,
      statusHint: 'failed',
      correlationId: randomUUID(),
    });
    expect(declined?.state).toBe('declined');

    order.status = 'processed';
    order.paymentStatusDetail = 'accredited';
    const corrected = await service.resolveFromNotification({
      providerOrderId: order.id,
      commandIdentity,
      statusHint: 'processed',
      correlationId: randomUUID(),
    });
    expect(corrected?.state).toBe('succeeded');

    const correctedRow = await attemptRow(commandIdentity);
    expect(correctedRow?.status).toBe('succeeded');
    expect(correctedRow?.provider_payment_id).toBe(order.paymentId);
  }, 60_000);

  it('does not invent an attempt for an order it never recorded', async () => {
    const service = buildTender(terminalFor('E'));
    const orphan = await service.resolveFromNotification({
      providerOrderId: `ORDGHOST${Date.now().toString().padStart(18, '0')}`,
      commandIdentity: randomUUID(),
      statusHint: 'processed',
      correlationId: randomUUID(),
    });
    expect(orphan).toBeNull();
  }, 60_000);
});

function readAmount(body: Record<string, unknown> | null): string {
  const payments = (body?.transactions as { payments?: Array<{ amount?: string }> } | undefined)
    ?.payments;
  return payments?.[0]?.amount ?? '0.00';
}

/** The documented 201/200 order body: the fields the transport reads, and no more. */
function orderBody(order: StubOrder): Record<string, unknown> {
  return {
    id: order.id,
    type: 'point',
    status: order.status,
    status_detail: order.statusDetail,
    external_reference: order.externalReference,
    transactions: {
      payments: [
        {
          id: order.paymentId,
          amount: order.amount,
          paid_amount: order.amount,
          status: order.status === 'processed' ? 'processed' : order.status,
          status_detail: order.paymentStatusDetail,
        },
      ],
    },
  };
}
