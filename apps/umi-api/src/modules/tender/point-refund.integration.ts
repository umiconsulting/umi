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
import { MercadoPagoPointProvider } from './providers/mercado-pago-point.provider';
import {
  MercadoPagoPointTransport,
  pointIdempotencyKey,
} from './providers/mercado-pago-point.transport';
import { TenderProviderRegistry } from './tender-provider.registry';
import { TenderRepository } from './tender.repository';
import { TenderService } from './tender.service';

/**
 * THE REFUND COMMAND AGAINST THE REAL SCHEMA — §4 Phase 4's acceptance, as rows.
 *
 * "A partial refund moves money and the sale records the refunded amount." What that
 * means in this platform is three facts, and every one of them is read back from SQL
 * rather than from a return value:
 *
 *   1. the vendor was ASKED, in the shape the vendor documents (a partial refund names
 *      the payment and the amount; a total refund carries no body at all);
 *   2. the giving-back is its OWN attempt, linked to the capture it gives back, with
 *      the vendor's refund id as its proof (`73_mp_refund.sql` refuses anything else);
 *   3. the ceiling is what the customer PAID, so a tip the terminal added does not make
 *      a legal refund illegal — and a refund that would exceed it never reaches the
 *      vendor.
 *
 * Run it against a DISPOSABLE build-v3 database, the way the notification suite is run:
 *
 *   set -a && . apps/umi-api/.env && set +a
 *   DATABASE_URL_APP=$(echo "$DATABASE_URL_APP" | sed 's#/umi_transition_rehearsal_20260901#/umi_build_v3_mp#') \
 *   DATABASE_URL_WORKER=$(echo "$DATABASE_URL_WORKER" | sed 's#/umi_transition_rehearsal_20260901#/umi_build_v3_mp#') \
 *   npx vitest run --config vitest.integration.config.ts src/modules/tender/point-refund.integration.ts
 */

const APP_DSN = process.env.DATABASE_URL_APP;
const WORKER_DSN = process.env.DATABASE_URL_WORKER;

const JWT_SECRET = 'point-refund-harness-secret-0000';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
    JWT_SECRET,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const MERCHANT = '7f000000-0000-4000-8000-0000000000b1';
const LOCATION = '7f000000-0000-4000-8000-0000000000b2';
const USER = '7f000000-0000-4000-8000-0000000000c1';
const DEVICE = '7f000000-0000-4000-8000-0000000000c2';
const STAFF = '7f000000-0000-4000-8000-0000000000c3';
const SESSION = '7f000000-0000-4000-8000-0000000000c4';
const OPERATOR_SESSION = '7f000000-0000-4000-8000-0000000000c5';
const CART = '7f000000-0000-4000-8000-0000000000d1';

const PERMISSIONS = ['checkout.commit', 'sale.lifecycle', 'sale.refund.manual_terminal'];
/** The same session WITHOUT the refund permission: taking money is not giving it back. */
const PERMISSIONS_WITHOUT_REFUND = ['checkout.commit', 'sale.lifecycle'];
const ENTITLEMENTS = JSON.stringify([{ featureKey: 'pos', enabled: true }]);

const user: AuthUser = {
  id: USER,
  sessionId: SESSION,
  deviceId: DEVICE,
  email: 'refund@harness.test',
  displayName: 'Refund Harness',
} as AuthUser;

interface RecordedCall {
  method: string;
  path: string;
  idempotencyKey: string | null;
  body: Record<string, unknown> | null;
}

describe('the Point refund command · §4 Phase 4', () => {
  let pg: PgService;
  /**
   * ONE TERMINAL PER CAPTURE, and that is the D4 rule rather than a test convenience: an
   * attempt that has not resolved still HOLDS its terminal (`pos_payment_attempt_open_terminal_uq`),
   * so two captures on one terminal legitimately refuse the second one. Each case here
   * takes its own terminal for the same reason the notification suite does.
   */
  let terminalSeq = 0;
  const freshTender = () => buildTender(`NEWLAND_N950__${runTag}T${++terminalSeq}`);
  let server: Server;
  let baseUrl: string;
  let calls: RecordedCall[];
  /** What the vendor answers on the next order read: "120", "120.50", or absent. */
  let paidAmount: string | null;
  let tipAmount: string | null;
  /** What the vendor answers to a refund: the status and whether it names a refund id. */
  let refundStatus: string;
  let refundStatusDetail: string;
  let refundId: string | null;
  let refundHttpStatus: number;
  let refundErrorCode: string | null;
  /**
   * What the ORDER read reports about its refunds. Separate from the refund POST's own answer
   * because that is exactly the distinction this instrument exists to exercise: an order can say
   * `processing` when the refund was asked for and `refunded` when the money actually moved.
   */
  let orderRefunds: unknown[];
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

  /** A capture the provider proved, which is the only thing a terminal refund can give back. */
  const captureOnce = async (service: TenderService, amountMinorUnits = 5_500) => {
    const commandIdentity = randomUUID();
    const result = await scoped(() =>
      service.capture(user, MERCHANT, {
        cartId: CART,
        tenderId: randomUUID(),
        locationId: LOCATION,
        operatorSessionId: OPERATOR_SESSION,
        commandIdentity,
        provider: 'mercado_pago_point',
        amount: { minorUnits: amountMinorUnits, currency: 'MXN' },
        idempotencyKey: randomUUID(),
      }),
    );
    const row = await attemptRow(commandIdentity);
    return { commandIdentity, result, row };
  };

  const attemptRow = async (commandIdentity: string) => {
    const { rows } = await pg.tquery<{
      id: string;
      status: string;
      proof_source: string | null;
      provider_order_id: string | null;
      provider_payment_id: string | null;
      provider_refund_id: string | null;
      refund_of_attempt_id: string | null;
      provider_paid_minor_units: string | null;
      provider_tip_minor_units: string | null;
      amount_minor_units: string;
    }>(
      MERCHANT,
      `SELECT id::text,status,proof_source,provider_order_id,provider_payment_id,
              provider_refund_id,refund_of_attempt_id::text AS refund_of_attempt_id,
              provider_paid_minor_units::text AS provider_paid_minor_units,
              provider_tip_minor_units::text AS provider_tip_minor_units,
              amount_minor_units::text AS amount_minor_units
         FROM merchant.pos_payment_attempt
        WHERE merchant_id=$1::uuid AND command_identity=$2::uuid`,
      [MERCHANT, commandIdentity],
    );
    return rows[0] ?? null;
  };

  const setPermissions = (permissions: readonly string[]) =>
    pg.query(`UPDATE runtime.operator_session SET permissions=$2::text[] WHERE id=$1::uuid`, [
      OPERATOR_SESSION,
      permissions,
    ]);

  const refund = (service: TenderService, attemptId: string, amountMinorUnits: number) =>
    scoped(() =>
      service.refund(user, MERCHANT, attemptId, {
        locationId: LOCATION,
        operatorSessionId: OPERATOR_SESSION,
        attemptId,
        commandIdentity: randomUUID(),
        amount: { minorUnits: amountMinorUnits, currency: 'MXN' },
        idempotencyKey: randomUUID(),
      }),
    );

  const refundRows = async (captureId: string) => {
    const { rows } = await pg.tquery<{
      id: string;
      status: string;
      proof_source: string | null;
      provider_refund_id: string | null;
      provider_payment_id: string | null;
      amount_minor_units: string;
    }>(
      MERCHANT,
      `SELECT id::text,status,proof_source,provider_refund_id,provider_payment_id,
              amount_minor_units::text AS amount_minor_units
         FROM merchant.pos_payment_attempt
        WHERE merchant_id=$1::uuid AND refund_of_attempt_id=$2::uuid
        ORDER BY created_at ASC`,
      [MERCHANT, captureId],
    );
    return rows;
  };

  beforeAll(async () => {
    if (!APP_DSN || !WORKER_DSN) {
      throw new Error(
        'Set DATABASE_URL_APP and DATABASE_URL_WORKER to a DISPOSABLE build-v3 database.',
      );
    }
    runTag = `R${Date.now().toString(36).toUpperCase()}`;
    calls = [];
    paidAmount = null;
    tipAmount = null;
    refundStatus = 'refunded';
    refundStatusDetail = 'refunded';
    refundId = 'REFUND-STUB-1';
    refundHttpStatus = 201;
    refundErrorCode = null;
    orderRefunds = [];

    // ── The vendor: the two order routes and the refund route, nothing else.
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : null;
        const header = req.headers['x-idempotency-key'];
        calls.push({
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
          // THE CARD WAS TAKEN IN THIS ONE ANSWER. A refund can only be asked of a
          // capture the provider PROVED, so the stub's create answers `processed` with a
          // payment id, a paid amount and a tip — the shape an approved Point order has.
          json(201, {
            id: `ORDRF${runTag}`,
            type: 'point',
            status: 'processed',
            status_detail: 'accredited',
            external_reference:
              typeof body?.external_reference === 'string' ? body.external_reference : null,
            transactions: {
              payments: [
                {
                  id: `PAYRF${runTag}`,
                  amount: '55.00',
                  ...(paidAmount === null ? {} : { paid_amount: paidAmount }),
                  ...(tipAmount === null ? {} : { tip_amount: tipAmount }),
                  status: 'processed',
                  status_detail: 'accredited',
                },
              ],
            },
          });
          return;
        }
        if (req.method === 'POST' && /^\/v1\/orders\/[^/]+\/refund$/.test(req.url ?? '')) {
          if (refundHttpStatus !== 201) {
            json(refundHttpStatus, {
              errors: [{ code: refundErrorCode, message: 'stub refusal' }],
            });
            return;
          }
          json(201, {
            id: `ORDRF${runTag}`,
            status: refundStatus,
            status_detail: refundStatusDetail,
            transactions: {
              refunds:
                refundId === null
                  ? []
                  : [
                      {
                        id: refundId,
                        transaction_id: `PAYRF${runTag}`,
                        amount: '20.00',
                        status: 'processed',
                      },
                    ],
            },
          });
          return;
        }
        const order = /^\/v1\/orders\/([^/?]+)$/.exec(req.url ?? '');
        if (req.method === 'GET' && order) {
          json(200, {
            id: order[1],
            type: 'point',
            status: 'processed',
            status_detail: 'accredited',
            transactions: {
              refunds: orderRefunds,
              payments: [
                {
                  id: `PAYRF${runTag}`,
                  amount: '55.00',
                  ...(paidAmount === null ? {} : { paid_amount: paidAmount }),
                  ...(tipAmount === null ? {} : { tip_amount: tipAmount }),
                  status: 'processed',
                  status_detail: 'accredited',
                },
              ],
            },
          });
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

    await pg.query(
      `INSERT INTO merchant.merchant (id,name,handle) VALUES ($1::uuid,'Refund Harness','refund-harness')
       ON CONFLICT (id) DO NOTHING`,
      [MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.location (id,merchant_id,name) VALUES ($1::uuid,$2::uuid,'Refunds')
       ON CONFLICT (id) DO NOTHING`,
      [LOCATION, MERCHANT],
    );
    await pg.query(
      `INSERT INTO umi."user" (id,full_name) VALUES ($1::uuid,'Cajera') ON CONFLICT (id) DO NOTHING`,
      [USER],
    );
    await pg.query(
      `INSERT INTO runtime.session (id,merchant_id,principal_type,principal_id,token_hash,expires_at)
       VALUES ($1::uuid,$2::uuid,'user',$3::uuid,repeat('c',64),now()+interval '1 day')
       ON CONFLICT (id) DO NOTHING`,
      [SESSION, MERCHANT, USER],
    );
    await pg.query(
      `INSERT INTO merchant.device (id,merchant_id,name,status)
       VALUES ($1::uuid,$2::uuid,'Till R','active') ON CONFLICT (id) DO NOTHING`,
      [DEVICE, MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.staff (id,merchant_id,user_id,role_id,name)
       SELECT $1::uuid,$2::uuid,$3::uuid,(SELECT id FROM umi.role WHERE key='cashier'),'Cajera'
       ON CONFLICT (id) DO NOTHING`,
      [STAFF, MERCHANT, USER],
    );
    // ONE operator session: the platform allows one ACTIVE session per durable session
    // (`operator_session_one_active_per_durable`), so the permission case below narrows
    // THIS session's permissions and puts them back, rather than seeding a second one.
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
    calls.length = 0;
    paidAmount = '60.00';
    tipAmount = '5.00';
    refundStatus = 'refunded';
    refundStatusDetail = 'refunded';
    refundId = `REFUND-${randomUUID()}`;
    refundHttpStatus = 201;
    refundErrorCode = null;
  });

  it('gives part of a capture back, as its own attempt, and asks the vendor the way it documents', async () => {
    const service = freshTender();
    const { row: capture } = await captureOnce(service);
    expect(capture?.status).toBe('succeeded');
    // WHAT THE CUSTOMER PAID is recorded, tip and all: 60.00 paid on a 55.00 sale.
    expect(capture?.provider_paid_minor_units).toBe('6000');
    expect(capture?.provider_tip_minor_units).toBe('500');

    calls.length = 0;
    const result = await refund(service, capture.id, 2_000);
    expect(result.outcome.kind).toBe('succeeded');
    expect(result.providerRefundId).toBe(refundId);
    expect(result.paidAmountMinorUnits).toBe(6_000);
    expect(result.idempotentReplay).toBe(false);

    // The vendor's request: the payment id, the amount as a two-decimal string, and
    // an idempotency key derived from OUR refund identity.
    const asked = calls.find((call) => call.path.endsWith('/refund'));
    expect(asked).toBeDefined();
    // The key is DERIVED from our refund identity, so a retry of this refund reuses it
    // and reaches the same refund at the vendor (plan D3).
    expect(asked?.idempotencyKey).toBe(
      pointIdempotencyKey(result.refundAttempt.commandIdentity!, 'refund_order'),
    );
    expect(JSON.stringify(asked?.body)).toBe(
      JSON.stringify({ transactions: [{ id: `PAYRF${runTag}`, amount: '20.00' }] }),
    );

    // The giving-back is its own row, linked to the capture, with the vendor's refund
    // id as its proof — which is exactly what `73_mp_refund.sql` refuses to do without.
    const rows = await refundRows(capture.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('succeeded');
    expect(rows[0].proof_source).toBe('provider');
    expect(rows[0].provider_refund_id).toBe(refundId);
    expect(rows[0].provider_payment_id).toBe(`PAYRF${runTag}`);
    expect(rows[0].amount_minor_units).toBe('2000');
  }, 60_000);

  it('sends NO body when the refund gives back everything that is left', async () => {
    const service = freshTender();
    const { row: capture } = await captureOnce(service);
    calls.length = 0;
    // The paid amount is the ceiling, so the tip is refundable too: 60.00 on a 55.00 sale.
    const result = await refund(service, capture.id, 6_000);
    expect(result.outcome.kind).toBe('succeeded');
    const asked = calls.find((call) => call.path.endsWith('/refund'));
    expect(asked).toBeDefined();
    expect(asked?.body).toBeNull();
  }, 60_000);

  it('refuses a refund that would exceed what the customer paid, and never calls the vendor', async () => {
    const service = freshTender();
    const { row: capture } = await captureOnce(service);
    calls.length = 0;
    // 60.00 paid; 55.00 asked for and refused... 60.01 is one cent too much.
    await expect(refund(service, capture.id, 6_001)).rejects.toMatchObject({
      response: { code: 'PAID_AMOUNT_EXCEEDED' },
    });
    // Refused BEFORE anything was written and before the vendor was told anything: a
    // refund that cannot happen is not an attempt, exactly as a capture refused by the
    // cart's own guards is not one.
    expect(calls.filter((call) => call.path.endsWith('/refund'))).toHaveLength(0);
    expect(await refundRows(capture.id)).toHaveLength(0);
  }, 60_000);

  it('counts the refunds that already happened, and only the ones that succeeded', async () => {
    const service = freshTender();
    const { row: capture } = await captureOnce(service);
    const first = await refund(service, capture.id, 3_000);
    expect(first.outcome.kind).toBe('succeeded');

    // A second refund of 30.00 would make 60.00 — exactly the ceiling, so it is legal.
    const second = await refund(service, capture.id, 3_000);
    expect(second.outcome.kind).toBe('succeeded');

    // A third has nothing left.
    await expect(refund(service, capture.id, 1)).rejects.toMatchObject({
      response: { code: 'PAID_AMOUNT_EXCEEDED' },
    });

    // A FAILED refund did not give anything back, so it must not consume the ceiling.
    // A second terminal, because the first one is still held by the capture above.
    const sold = await captureOnce(freshTender());
    refundHttpStatus = 403;
    refundErrorCode = 'partial_refund_forbidden_with_tips';
    const refused = await refund(service, sold.row.id, 2_000);
    expect(refused.outcome.kind).toBe('declined');
    expect(refused.outcome.code).toBe('partial_refund_forbidden_with_tips');
    refundHttpStatus = 201;
    refundErrorCode = null;
    const afterFailure = await refund(service, sold.row.id, 2_000);
    expect(afterFailure.outcome.kind).toBe('succeeded');
  }, 60_000);

  it('refuses to refund what a provider did not prove, and refuses without the permission', async () => {
    const service = freshTender();
    const { row: capture } = await captureOnce(service);

    // The permission: the same operator, with `sale.refund.manual_terminal` taken away.
    await setPermissions(PERMISSIONS_WITHOUT_REFUND);
    try {
      await expect(refund(service, capture.id, 1_000)).rejects.toMatchObject({
        response: { code: 'PERMISSION_DENIED' },
      });
      expect(await refundRows(capture.id)).toHaveLength(0);
    } finally {
      await setPermissions(PERMISSIONS);
    }

    // A REFUND OF A REFUND is not a thing: the capture is what carries the payment id.
    const first = await refund(service, capture.id, 1_000);
    await expect(refund(service, first.refundAttempt.id, 1_000)).rejects.toMatchObject({
      response: { code: 'TENDER_REFUND_NOT_REFUNDABLE' },
    });
  }, 60_000);

  it('never reads a refund in flight as money that moved', async () => {
    const service = freshTender();
    const { row: capture } = await captureOnce(service);
    refundStatus = 'processing';
    refundStatusDetail = 'processing';
    // The vendor answered, but it has not finished: the attempt is a QUESTION.
    const processing = await refund(service, capture.id, 2_000);
    expect(processing.outcome.kind).toBe('unknown');
    const rows = await refundRows(capture.id);
    expect(rows[0].status).toBe('unknown');

    // And a provider that answers a refund with no refund id has not proved anything:
    // the schema would refuse to record it, so the attempt stays unresolved instead.
    refundId = null;
    refundStatus = 'refunded';
    const withoutId = await refund(service, capture.id, 2_000);
    expect(withoutId.outcome.kind).toBe('unknown');
  }, 60_000);

  it('CLOSES a refund the vendor left processing, on the notification that names the order', async () => {
    const service = freshTender();
    const { commandIdentity, row: capture } = await captureOnce(service);

    // The vendor accepts the refund and has not finished. It names the refund — which is the
    // thing this pass started keeping, and the reason the state is no longer permanent (§14.2 D34).
    refundStatus = 'processing';
    refundStatusDetail = 'processing';
    refundId = `REFPROC${runTag}`;
    orderRefunds = [];
    const asked = await refund(service, capture.id, 2_000);
    expect(asked.outcome.kind).toBe('unknown');

    const before = await refundRows(capture.id);
    expect(before[0].status).toBe('unknown');
    // THE ROW HOLDS BOTH IDS THE LATER READ NEEDS, which is what makes an attribution possible at
    // all: the order to read and the refund to look for inside it.
    expect(before[0].provider_refund_id).toBe(refundId);
    expect(capture.provider_order_id).not.toBeNull();

    // …and now the order says the money moved, and the notification for that order arrives.
    orderRefunds = [
      { id: refundId, transaction_id: `PAYRF${runTag}`, amount: '20.00', status: 'refunded' },
    ];
    const resolution = await service.resolveFromNotification({
      providerOrderId: capture.provider_order_id,
      commandIdentity: null,
      statusHint: 'order.processed',
      correlationId: randomUUID(),
    });
    expect(resolution).not.toBeNull();

    const after = await refundRows(capture.id);
    expect(after[0].status).toBe('succeeded');
    // PROOF, not a word: the refund carries the vendor's id and says who asserted the money moved.
    expect(after[0].proof_source).toBe('provider');
    expect(after[0].provider_refund_id).toBe(refundId);
    // …and the CAPTURE was not disturbed by it: the refund resolved, and the thing that paid for
    // the sale still says what it always said.
    expect((await attemptRow(commandIdentity))?.status).toBe('succeeded');
  }, 60_000);
});
