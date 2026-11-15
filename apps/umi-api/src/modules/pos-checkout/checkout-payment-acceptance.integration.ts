/**
 * ONCA incident 001 · checkout payment acceptance, against real PostgreSQL.
 *
 * This file is the release acceptance gate. Each `it` states one DESIRED behavior in
 * ordinary assertions, so a failure fails this command by name. There is no inverted
 * expected failure, no skip, and no exit conversion.
 *
 * WHY IT IS RED TODAY. `recovery()` selects only `unknown` and `timeout` attempts. A
 * `succeeded` attempt with no sale is therefore invisible. A stale `POST /checkout`
 * returns a bare 409 with no attempt id and no operator guidance.
 *
 * ERROR-ENVELOPE DECISION. The stale response is the existing conflict envelope
 * `{ code, details }`. It is not `CheckoutResult.failure`. `details.operatorGuidance`
 * uses the `operatorGuidance` enum on the contract's `CheckoutFailure` shape, reached
 * as `NonNullable<CheckoutResult['failure']>['operatorGuidance']` because
 * `CheckoutFailure` is exported as a schema value, not as a type. `details.attemptId`
 * follows the existing `PAYMENT_UNKNOWN` detail. This file changes no product source
 * and no contract.
 *
 * WHAT THE FAKE PROVES. The scripted provider counts capture calls. That count is
 * evidence about the API's retry guard only. It does not prove a real acquirer settled.
 *
 * NO PRODUCT FAULT. This file installs no trigger and edits no product source. It
 * drives only the existing checkout, tender and recovery paths.
 *
 *   DATABASE_URL_APP and DATABASE_URL_WORKER point at a DISPOSABLE build-v3 database
 *   created by `docs/migration/build-v3/00_run.sh`.
 */

import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CheckoutCommand, CheckoutResult } from '@umi/contract';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import type { AuthUser } from '../auth/auth.types';
import { IntegrityRepository } from '../integrity/integrity.repository';
import { IntegrityService } from '../integrity/integrity.service';
import { PosCartRepository } from '../pos-cart/pos-cart.repository';
import { PosCartService } from '../pos-cart/pos-cart.service';
import { ScriptedTerminalProvider } from '../tender/providers/scripted-terminal.provider';
import { TenderProviderRegistry } from '../tender/tender-provider.registry';
import { TenderRepository } from '../tender/tender.repository';
import { TenderService } from '../tender/tender.service';
import { PosCheckoutRepository } from './pos-checkout.repository';
import { PosCheckoutService } from './pos-checkout.service';

const APP_DSN = process.env.DATABASE_URL_APP;
const WORKER_DSN = process.env.DATABASE_URL_WORKER;

const JWT_SECRET = 'onca-recovery-harness-secret-000000';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
    JWT_SECRET,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const RUN = randomUUID().replace(/-/g, '').slice(0, 6);
const fixtureId = (suffix: number): string =>
  `9e${RUN}-0000-4000-8000-${suffix.toString(16).padStart(12, '0')}`;

const MERCHANT = fixtureId(0xa1);
const LOCATION = fixtureId(0xa2);
const PRODUCT = fixtureId(0xb1);

/** MXN 45.00 × 5 = MXN 225.00, the amount the ONCA terminal charged. */
const UNIT_PRICE = 4_500;
const QUANTITY = 5;
const AMOUNT_DUE = UNIT_PRICE * QUANTITY;

const PERMISSIONS = ['checkout.commit', 'checkout.terminal.confirm', 'cart.write'];
const ENTITLEMENTS = JSON.stringify([{ featureKey: 'pos', enabled: true }]);

type Till = {
  name: string;
  userId: string;
  staffId: string;
  sessionId: string;
  operatorSessionId: string;
  deviceId: string;
  user: AuthUser;
};

function tillSpec(index: number): Till {
  const base = 0x100 + index * 0x10;
  const name = `Caja ONCA ${index + 1}`;
  const userId = fixtureId(base + 1);
  return {
    name,
    userId,
    staffId: fixtureId(base + 2),
    sessionId: fixtureId(base + 3),
    operatorSessionId: fixtureId(base + 4),
    deviceId: fixtureId(base + 5),
    user: {
      id: userId,
      sessionId: fixtureId(base + 3),
      deviceId: fixtureId(base + 5),
      email: `onca-${index + 1}@recovery-harness.test`,
      displayName: name,
    } as AuthUser,
  };
}

const TILLS = [
  tillSpec(0),
  tillSpec(1),
  tillSpec(2),
  tillSpec(3),
  tillSpec(4),
  tillSpec(5),
  tillSpec(6),
];

describe('ONCA incident 001 · checkout payment acceptance', () => {
  let pg: PgService;
  let checkout: PosCheckoutService;
  let carts: PosCartService;
  let tender: TenderService;
  let terminal: ScriptedTerminalProvider;

  const scoped = <T>(till: Till, work: () => Promise<T>): Promise<T> =>
    runWithRequestContext(
      {
        merchantId: MERCHANT,
        locationId: LOCATION,
        deviceId: till.deviceId,
        userId: till.userId,
        requestId: randomUUID(),
      },
      work,
    );

  const money = (minorUnits: number) => ({ minorUnits, currency: 'MXN' });

  const newCart = async (till: Till, quantity = QUANTITY) => {
    const cart = await scoped(till, () =>
      carts.create(till.user, MERCHANT, {
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
        idempotencyKey: randomUUID(),
      }),
    );
    return scoped(till, () =>
      carts.add(till.user, MERCHANT, {
        cartId: cart.id,
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
        productId: PRODUCT,
        variantId: null,
        modifierSelections: [],
        quantity,
        courseNumber: 1,
        note: null,
        expectedVersion: cart.version,
        idempotencyKey: randomUUID(),
      }),
    );
  };

  const command = (
    till: Till,
    cart: { id: string; version: number },
    tenders: Array<{ id: string; amount: number }>,
    overrides: Partial<CheckoutCommand> = {},
  ): CheckoutCommand => ({
    commandId: randomUUID(),
    cartId: cart.id,
    locationId: LOCATION,
    operatorSessionId: till.operatorSessionId,
    cashShiftId: null,
    expectedCartVersion: cart.version,
    paymentMethod: 'external_terminal',
    totalsFingerprint: null,
    idempotencyKey: randomUUID(),
    tenderDrafts: tenders.map((entry) => ({
      id: entry.id,
      type: 'manual_terminal' as const,
      amount: money(entry.amount),
      amountReceived: null,
      status: 'confirmed_success' as const,
      correlationId: null,
    })),
    tipDraft: null,
    discountDrafts: [],
    approvalIds: [],
    receiptDelivery: { destination: 'display', channel: null, customerContactId: null },
    customerValue: null,
    ...overrides,
  });

  /** A preview is the product's own way to learn the totals fingerprint. */
  const preview = async (
    till: Till,
    cart: { id: string; version: number },
    tenders: Array<{ id: string; amount: number }>,
  ) => {
    const dto = command(till, cart, tenders);
    const result = await scoped(till, () => checkout.checkout(till.user, MERCHANT, dto));
    if (result.status !== 'confirmation_required') {
      throw new Error(
        `preview did not ask for confirmation: ${result.status} ` +
          `(${result.failure?.code ?? 'no failure code'})`,
      );
    }
    return { dto, result, fingerprint: result.confirmation.fingerprint };
  };

  const capture = (
    till: Till,
    cartId: string,
    tenderId: string,
    amount: number,
    commandIdentity = randomUUID(),
  ) =>
    scoped(till, () =>
      tender.capture(till.user, MERCHANT, {
        cartId,
        tenderId,
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
        commandIdentity,
        provider: 'scripted_card_terminal',
        amount: money(amount),
        idempotencyKey: randomUUID(),
      }),
    );

  /**
   * The commit is a NEW command, not the preview. The preview already occupies its
   * own command identity with a payload whose `totalsFingerprint` is null; reusing
   * that identity for the confirmed payload is an idempotency conflict by design.
   */
  const commitCommand = (
    dto: CheckoutCommand,
    fingerprint: string,
    overrides: Partial<CheckoutCommand> = {},
  ): CheckoutCommand => ({
    ...dto,
    totalsFingerprint: fingerprint,
    commandId: randomUUID(),
    idempotencyKey: randomUUID(),
    ...overrides,
  });

  const runCheckout = (till: Till, dto: CheckoutCommand) =>
    scoped(till, () => checkout.checkout(till.user, MERCHANT, dto));

  const attempts = async (cartId: string) => {
    const { rows } = await pg.query<{
      id: string;
      status: string;
      tenderId: string | null;
      tenderDraftId: string | null;
      providerPaymentId: string | null;
      provider: string | null;
    }>(
      `SELECT id::text AS id,status,tender_id::text AS "tenderId",
              tender_draft_id::text AS "tenderDraftId",
              provider_payment_id AS "providerPaymentId",provider
         FROM merchant.pos_payment_attempt
        WHERE merchant_id=$1::uuid AND cart_id=$2::uuid
        ORDER BY created_at`,
      [MERCHANT, cartId],
    );
    return rows;
  };

  const sales = async (cartId: string) => {
    const { rows } = await pg.query<{
      id: string;
      receiptId: string;
      receiptNumber: string;
      grandTotal: string;
    }>(
      `SELECT s.id::text AS id,s.receipt_snapshot_id::text AS "receiptId",
              r.receipt_number AS "receiptNumber",r.grand_total::text AS "grandTotal"
         FROM merchant.pos_committed_sale s
         JOIN merchant.receipt_snapshot r ON r.id=s.receipt_snapshot_id
        WHERE s.merchant_id=$1::uuid AND s.cart_id=$2::uuid
        ORDER BY s.committed_at`,
      [MERCHANT, cartId],
    );
    return rows;
  };

  const payments = async (cartId: string) => {
    const { rows } = await pg.query<{
      id: string;
      amount: string;
      status: string;
      method: string;
    }>(
      `SELECT p.id::text AS id,p.amount::text AS amount,p.status,p.method
         FROM merchant.payment p
         JOIN merchant.pos_committed_sale s ON s.order_id=p.order_id
        WHERE s.merchant_id=$1::uuid AND s.cart_id=$2::uuid
        ORDER BY p.paid_at`,
      [MERCHANT, cartId],
    );
    return rows;
  };

  const tenderFacts = async (cartId: string) => {
    const { rows } = await pg.query<{
      id: string;
      tenderType: string;
      status: string;
      amount: string;
    }>(
      `SELECT id::text AS id,tender_type AS "tenderType",status,
              amount_minor_units::text AS amount
         FROM merchant.pos_tender_fact
        WHERE merchant_id=$1::uuid AND cart_id=$2::uuid
        ORDER BY position`,
      [MERCHANT, cartId],
    );
    return rows;
  };

  const receiptCount = async (cartId: string) => {
    const { rows } = await pg.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM merchant.receipt_snapshot r
         JOIN merchant.pos_committed_sale s ON s.receipt_snapshot_id=r.id
        WHERE s.merchant_id=$1::uuid AND s.cart_id=$2::uuid`,
      [MERCHANT, cartId],
    );
    return Number(rows[0]?.count ?? 0);
  };

  beforeAll(async () => {
    if (!APP_DSN || !WORKER_DSN) {
      throw new Error('Set DATABASE_URL_APP and DATABASE_URL_WORKER to a disposable build-v3 DB.');
    }
    pg = new PgService(makeConfig());
    await pg.onModuleInit();

    const integrity = new IntegrityService(new IntegrityRepository(pg));
    const cartRepository = new PosCartRepository(pg);
    checkout = new PosCheckoutService(new PosCheckoutRepository(pg), cartRepository, integrity);
    carts = new PosCartService(cartRepository, integrity);
    terminal = new ScriptedTerminalProvider('scripted_card_terminal', ['succeed']);
    tender = new TenderService(
      new TenderRepository(pg, new PosCheckoutRepository(pg)),
      new TenderProviderRegistry([terminal]),
      integrity,
    );

    await pg.query(
      `INSERT INTO merchant.merchant (id,name,handle,currency,timezone)
       VALUES ($1::uuid,'ONCA Recovery Harness',$2,'MXN','America/Mexico_City')
       ON CONFLICT (id) DO NOTHING`,
      [MERCHANT, `onca-recovery-${RUN}`],
    );
    await pg.query(
      `INSERT INTO merchant.location (id,merchant_id,name)
       VALUES ($1::uuid,$2::uuid,'Caja principal') ON CONFLICT (id) DO NOTHING`,
      [LOCATION, MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.product (id,merchant_id,name,price,tax_rate_basis_points,active)
       VALUES ($1::uuid,$2::uuid,'Concha', $3,0,true) ON CONFLICT (id) DO NOTHING`,
      [PRODUCT, MERCHANT, UNIT_PRICE],
    );
    // The terminal tender is a policy choice, not a default. This row is the same
    // shape the dashboard writes; without it the calculator refuses the tender.
    await pg.query(
      `INSERT INTO merchant.pos_checkout_policy
         (merchant_id,location_id,version,manual_terminal_enabled,mixed_tender_enabled,
          maximum_tender_lines,manual_terminal_approval_threshold,tips_enabled,
          maximum_tip_minor_units,maximum_discount_basis_points,maximum_discount_minor_units,
          cashier_discount_threshold,currency)
       VALUES ($1::uuid,$2::uuid,'onca-recovery',true,true,8,0,false,0,0,0,0,'MXN')
       ON CONFLICT (merchant_id,location_id) DO UPDATE SET
         manual_terminal_enabled=true,mixed_tender_enabled=true,maximum_tender_lines=8`,
      [MERCHANT, LOCATION],
    );

    for (const till of TILLS) {
      await pg.query(
        `INSERT INTO umi."user" (id,full_name) VALUES ($1::uuid,$2)
                      ON CONFLICT (id) DO NOTHING`,
        [till.userId, till.name],
      );
      await pg.query(
        `INSERT INTO merchant.staff (id,merchant_id,location_id,user_id,role_id,name)
         SELECT $1::uuid,$2::uuid,$3::uuid,$4::uuid,
                (SELECT id FROM umi.role WHERE key='cashier'),$5
         ON CONFLICT (id) DO NOTHING`,
        [till.staffId, MERCHANT, LOCATION, till.userId, till.name],
      );
      await pg.query(
        `INSERT INTO merchant.device (id,merchant_id,location_id,name,kind,status)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'pos_terminal','active')
         ON CONFLICT (id) DO UPDATE SET status='active',revoked_at=null`,
        [till.deviceId, MERCHANT, LOCATION, till.name],
      );
      await pg.query(
        `INSERT INTO runtime.session
           (id,merchant_id,principal_type,principal_id,token_hash,expires_at)
         VALUES ($1::uuid,$2::uuid,'user',$3::uuid,md5($1::text)||md5($1::text),
                 now()+interval '2 hours')
         ON CONFLICT (id) DO NOTHING`,
        [till.sessionId, MERCHANT, till.userId],
      );
      await pg.query(
        `INSERT INTO runtime.operator_session
           (id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,
            permissions,entitlements,expires_at)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,
                 $8::text[],$9::jsonb,now()+interval '2 hours')
         ON CONFLICT (id) DO UPDATE SET
           permissions=excluded.permissions,entitlements=excluded.entitlements,
           state='active',expires_at=excluded.expires_at`,
        [
          till.operatorSessionId,
          till.sessionId,
          till.userId,
          till.staffId,
          till.deviceId,
          MERCHANT,
          LOCATION,
          PERMISSIONS,
          ENTITLEMENTS,
        ],
      );
    }
  }, 120_000);

  afterAll(async () => {
    if (pg) await pg.onModuleDestroy();
  }, 60_000);

  beforeEach(() => {
    terminal.reset();
  });

  /**
   * The real incident 001 state, through the support correction.
   *
   * This helper drives the acceptance tests below. It performs the exact path:
   * 3 conchas / 13500 / version 8, capture 22500, `TENDER_OVERALLOCATION`, support
   * 3 → 5 / 13500 → 22500 / version 8 → 9 with an `adjust` audit row.
   */
  const prepareCorrectedIncident = async (till: Till) => {
    const cart3 = await newCart(till, 3);
    expect(cart3.totals.grandTotal.minorUnits).toBe(13_500);

    // The production account was at version 8 when the terminal charged. The value is
    // data, not a product edit; the cart row accepts it and the checkout reads it.
    await pg.query(
      `UPDATE merchant.pos_cart SET version=8,updated_at=now()
        WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [MERCHANT, cart3.id],
    );
    const cart = await scoped(till, () =>
      carts.read(till.user, MERCHANT, LOCATION, till.operatorSessionId),
    );
    expect(cart.version).toBe(8);
    expect(cart.totals.grandTotal.minorUnits).toBe(13_500);
    expect(cart.items[0].quantity).toBe(3);

    const tenderId = randomUUID();
    // The POS previewed the 22500 the operator entered against the 13500 cart. The
    // calculator marks it overpaid, but the preview still returns the confirmation
    // fingerprint over that exact tender set — which is the value the commit must carry.
    const previewed = await preview(till, cart, [{ id: tenderId, amount: AMOUNT_DUE }]);
    expect(previewed.result.confirmation.totals.grandTotal.minorUnits).toBe(13_500);

    // The capture path does not compare the terminal amount to the cart due. The
    // terminal therefore records 22500 while the account still says 13500. This is
    // the first half of the incident.
    const captured = await capture(till, cart.id, tenderId, AMOUNT_DUE);
    expect(captured.attempt.state).toBe('succeeded');
    expect(captured.attempt.amount.minorUnits).toBe(AMOUNT_DUE);
    expect(terminal.captureCalls).toHaveLength(1);

    // A commit with the captured 22500 tender on the 13500 cart is refused by the
    // amount guard before any sale row. This is the exact pre-adjustment behavior.
    const committedTooMuch = commitCommand(previewed.dto, previewed.fingerprint, {
      tenderDrafts: [
        {
          id: tenderId,
          type: 'manual_terminal',
          amount: money(AMOUNT_DUE),
          amountReceived: null,
          status: 'confirmed_success',
          correlationId: null,
        },
      ],
    });
    const refused = await runCheckout(till, committedTooMuch);
    expect(refused.status).toBe('payment_pending');
    expect(refused.failure?.code).toBe('TENDER_OVERALLOCATION');
    expect(refused.sale).toBeNull();
    expect(refused.payment).toBeNull();

    const beforeAdjust = await attempts(cart.id);
    expect(beforeAdjust).toHaveLength(1);
    expect(beforeAdjust[0]).toMatchObject({
      id: captured.attempt.id,
      status: 'succeeded',
      tenderId: null,
      tenderDraftId: tenderId,
    });
    expect(await sales(cart.id)).toHaveLength(0);
    expect(await receiptCount(cart.id)).toBe(0);
    expect(await payments(cart.id)).toHaveLength(0);
    expect(await tenderFacts(cart.id)).toHaveLength(0);

    // The ordinary cart route REFUSES to change an account that holds a captured
    // payment. That guard is correct, and it is why the 3 → 5 correction needed the
    // support transaction below, not an operator action.
    await expect(
      scoped(till, () =>
        carts.update(till.user, MERCHANT, cart.items[0].id, {
          cartId: cart.id,
          locationId: LOCATION,
          operatorSessionId: till.operatorSessionId,
          productId: PRODUCT,
          variantId: null,
          modifierSelections: [],
          quantity: 4,
          courseNumber: 1,
          note: null,
          expectedVersion: 8,
          idempotencyKey: randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'CART_PAYMENT_UNRESOLVED' },
    });

    // The support correction from the incident, in ONE transaction: 3 → 5 units,
    // 13500 → 22500, version 8 → 9, and an `adjust` audit row with before/after.
    await pg.runWithMerchant(
      MERCHANT,
      till.userId,
      async (client) => {
        const current = await client.query<{ quantity: number; version: number }>(
          `SELECT l.quantity,c.version
             FROM merchant.pos_cart c
             JOIN merchant.pos_cart_line l ON l.cart_id=c.id
            WHERE c.merchant_id=$1::uuid AND c.id=$2::uuid
            FOR UPDATE OF c,l`,
          [MERCHANT, cart.id],
        );
        expect(current.rows[0]).toMatchObject({ quantity: 3, version: 8 });
        await client.query(
          `UPDATE merchant.pos_cart_line
              SET quantity=5,updated_at=now()
            WHERE merchant_id=$1::uuid AND cart_id=$2::uuid`,
          [MERCHANT, cart.id],
        );
        await client.query(
          `UPDATE merchant.pos_cart
              SET version=9,updated_at=now()
            WHERE merchant_id=$1::uuid AND id=$2::uuid`,
          [MERCHANT, cart.id],
        );
        await client.query(
          `INSERT INTO merchant.audit_log
             (merchant_id,actor_user_id,action,entity,entity_id,outcome,request_id,before,after)
           VALUES ($1::uuid,$2::uuid,'adjust','pos_cart',$3::uuid,'success',
                   'onca-test-adjust',$4::jsonb,$5::jsonb)`,
          [
            MERCHANT,
            till.userId,
            cart.id,
            JSON.stringify({ quantity: 3, totalMinorUnits: 13_500, version: 8 }),
            JSON.stringify({ quantity: 5, totalMinorUnits: 22_500, version: 9 }),
          ],
        );
      },
      LOCATION,
    );

    const adjusted = await scoped(till, () =>
      carts.read(till.user, MERCHANT, LOCATION, till.operatorSessionId),
    );
    expect(adjusted.version).toBe(9);
    expect(adjusted.totals.grandTotal.minorUnits).toBe(AMOUNT_DUE);
    expect(adjusted.items[0].quantity).toBe(5);

    const audit = await pg.query<{
      action: string;
      before: Record<string, number>;
      after: Record<string, number>;
    }>(
      `SELECT action,before,after
         FROM merchant.audit_log
        WHERE merchant_id=$1::uuid AND entity='pos_cart' AND entity_id=$2::uuid
          AND request_id='onca-test-adjust'`,
      [MERCHANT, cart.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].action).toBe('adjust');
    expect(audit.rows[0].before).toMatchObject({
      quantity: 3,
      totalMinorUnits: 13_500,
      version: 8,
    });
    expect(audit.rows[0].after).toMatchObject({ quantity: 5, totalMinorUnits: 22_500, version: 9 });

    // The money did not change: the SAME attempt remains succeeded and unlinked.
    const afterAdjust = await attempts(cart.id);
    expect(afterAdjust).toHaveLength(1);
    expect(afterAdjust[0]).toMatchObject({
      id: captured.attempt.id,
      status: 'succeeded',
      tenderId: null,
      tenderDraftId: tenderId,
    });
    expect(await sales(cart.id)).toHaveLength(0);
    expect(await receiptCount(cart.id)).toBe(0);
    expect(await payments(cart.id)).toHaveLength(0);
    expect(await tenderFacts(cart.id)).toHaveLength(0);

    return { cart, tenderId, captured, previewed };
  };

  // ── Acceptance · the desired incident outcome, in ordinary assertions ──────
  //
  // The 409s in production happened BEFORE the support correction. The stale-v8 retry
  // below is a synthetic probe of the desired response, not the production sequence.

  it('returns the succeeded unlinked attempt as the recovery payment outcome', async () => {
    const till = TILLS[4];
    const { cart, captured } = await prepareCorrectedIncident(till);

    const snapshot = await scoped(till, () =>
      checkout.recovery(till.user, MERCHANT, cart.id, {
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
      }),
    );

    expect(snapshot.paymentOutcome).not.toBeNull();
    expect(snapshot.paymentOutcome).toMatchObject({
      attempt: {
        id: captured.attempt.id,
        status: 'succeeded',
      },
    });
  }, 60_000);

  it('answers a stale checkout with 409 OPTIMISTIC_VERSION_CONFLICT, the attempt id and operatorGuidance query_payment', async () => {
    const till = TILLS[5];
    const { tenderId, captured, previewed } = await prepareCorrectedIncident(till);
    const staleRetry = commitCommand(previewed.dto, previewed.fingerprint, {
      tenderDrafts: [
        {
          id: tenderId,
          type: 'manual_terminal',
          amount: money(AMOUNT_DUE),
          amountReceived: null,
          status: 'confirmed_success',
          correlationId: null,
        },
      ],
    });

    const expectedGuidance: NonNullable<CheckoutResult['failure']>['operatorGuidance'] =
      'query_payment';
    const staleError = await runCheckout(till, staleRetry).then(
      () => null,
      (error: unknown) => error,
    );

    expect(staleError).not.toBeNull();
    expect(staleError).toMatchObject({
      status: 409,
      response: {
        code: 'OPTIMISTIC_VERSION_CONFLICT',
        details: {
          attemptId: captured.attempt.id,
          operatorGuidance: expectedGuidance,
        },
      },
    });
    // Envelope decision: the 409 is the existing conflict shape, `code` plus
    // `details`. It is not `CheckoutResult.failure`. `operatorGuidance` is the
    // contract enum, and `attemptId` follows the `PAYMENT_UNKNOWN` detail. This file
    // changes no product source and no contract.
    expect(staleError).not.toMatchObject({
      response: { details: { recoveryAction: expect.anything() } },
    });
  }, 60_000);

  it('leaves one attempt and no sale, receipt, payment or tender fact after the stale retry', async () => {
    const till = TILLS[6];
    const { cart, tenderId, captured, previewed } = await prepareCorrectedIncident(till);
    const staleRetry = commitCommand(previewed.dto, previewed.fingerprint, {
      tenderDrafts: [
        {
          id: tenderId,
          type: 'manual_terminal',
          amount: money(AMOUNT_DUE),
          amountReceived: null,
          status: 'confirmed_success',
          correlationId: null,
        },
      ],
    });

    // The stale retry must reach the conflict path before this test reads rows.
    // Test 2 owns the `details` envelope. This test stops at the 409 code.
    const staleError = await runCheckout(till, staleRetry).then(
      () => null,
      (error: unknown) => error,
    );
    expect(staleError).not.toBeNull();
    expect(staleError).toMatchObject({
      status: 409,
      response: { code: 'OPTIMISTIC_VERSION_CONFLICT' },
    });

    const left = await attempts(cart.id);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({
      id: captured.attempt.id,
      status: 'succeeded',
      tenderId: null,
      tenderDraftId: tenderId,
    });
    expect(await sales(cart.id)).toHaveLength(0);
    expect(await receiptCount(cart.id)).toBe(0);
    expect(await payments(cart.id)).toHaveLength(0);
    expect(await tenderFacts(cart.id)).toHaveLength(0);
    expect(terminal.captureCalls).toHaveLength(1);
  }, 60_000);
});
