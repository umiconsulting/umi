import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CheckoutCommand } from '@umi/contract';
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

/**
 * ONCA incident 001 · checkout payment recovery · characterization, not acceptance.
 *
 * This file records what the product DOES today, against real PostgreSQL. All six
 * tests below are passing controls. They are not a release gate.
 * `checkout-payment-acceptance.integration.ts` asserts the DESIRED behavior and
 * fails while the known defect remains.
 *
 * The production incident is one sentence: the terminal showed MXN 225.00 paid, the
 * API held a `succeeded` payment attempt, and no sale or receipt existed. This suite
 * drives the real checkout and tender services through that boundary with a scripted
 * terminal, and reads every money claim back from SQL.
 *
 * WHAT THE FAKE PROVES. The scripted provider counts the capture calls it receives.
 * That count is evidence about the API's own retry guard — one identity must reach the
 * provider once — and it is the only thing it proves. It does not prove that a real
 * acquirer settled, that a card was present, or that the terminal's own record agrees.
 * The row counts and amounts prove what the API wrote, not what the bank did.
 *
 * SCENARIOS
 *   1. Lost reply: capture once, commit, repeat the same checkout command. One sale,
 *      one receipt, one payment, one tender fact, one attempt, one capture.
 *   2. Failed commit then recovery: the commit fails after the attempt succeeded. The
 *      attempt is left unlinked and no sale exists. The product's recovery read and
 *      payment-status read are measured, then the same checkout command is retried.
 *   3. Re-capture against the same tender draft: a new command identity must not call
 *      the provider twice.
 *   4. Split tenders: two manual-terminal tenders produce two facts and two payments,
 *      and a recovered split commit does not duplicate either.
 *   5. Incident 001: 3 conchas / 13500, capture 22500, support 3 → 5 / 13500 → 22500 /
 *      version 8 → 9. The amount guard refuses `TENDER_OVERALLOCATION` before the sale.
 *      The stale retry after the support correction is `OPTIMISTIC_VERSION_CONFLICT`.
 *   6. Fresh object graph: dispose the first graph and recover the same attempt from a
 *      new `PgService`, repositories, services and scripted provider.
 *
 * THE FAULT IS TEST-SIDE AND DISPOSABLE. A trigger on `merchant.pos_committed_sale`
 * raises only while the test's marker table names the cart. The product source is not
 * edited. The trigger, function and table are removed in `afterAll`.
 *
 *   DATABASE_URL_APP, DATABASE_URL_WORKER, DATABASE_URL_ADMIN point at a DISPOSABLE
 *   build-v3 database created by `docs/migration/build-v3/00_run.sh`.
 */

const APP_DSN = process.env.DATABASE_URL_APP;
const WORKER_DSN = process.env.DATABASE_URL_WORKER;
const ADMIN_DSN = process.env.DATABASE_URL_ADMIN;

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

type Graph = {
  pg: PgService;
  checkout: PosCheckoutService;
  carts: PosCartService;
  tender: TenderService;
  provider: ScriptedTerminalProvider;
};

/** A complete service graph. The fresh-instance control builds TWO of these. */
async function buildGraph(provider: ScriptedTerminalProvider): Promise<Graph> {
  const pg = new PgService(makeConfig());
  await pg.onModuleInit();
  const integrity = new IntegrityService(new IntegrityRepository(pg));
  const cartRepository = new PosCartRepository(pg);
  const checkout = new PosCheckoutService(new PosCheckoutRepository(pg), cartRepository, integrity);
  const carts = new PosCartService(cartRepository, integrity);
  const tender = new TenderService(
    new TenderRepository(pg, new PosCheckoutRepository(pg)),
    new TenderProviderRegistry([provider]),
    integrity,
  );
  return { pg, checkout, carts, tender, provider };
}

describe('ONCA incident 001 · checkout payment recovery', () => {
  let pg: PgService;
  let checkout: PosCheckoutService;
  let carts: PosCartService;
  let tender: TenderService;
  let terminal: ScriptedTerminalProvider;
  let admin: Pool;

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

  const armFault = (cartId: string) =>
    admin.query(`INSERT INTO public.umi_test_commit_fault(cart_id) VALUES ($1::uuid)`, [cartId]);

  const disarmFault = (cartId: string) =>
    admin.query(`DELETE FROM public.umi_test_commit_fault WHERE cart_id=$1::uuid`, [cartId]);

  beforeAll(async () => {
    if (!APP_DSN || !WORKER_DSN) {
      throw new Error('Set DATABASE_URL_APP and DATABASE_URL_WORKER to a disposable build-v3 DB.');
    }
    if (!ADMIN_DSN) {
      throw new Error(
        'Set DATABASE_URL_ADMIN to the same disposable database. The failed-commit scenario ' +
          'installs its own trigger; it does not edit product source.',
      );
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

    // ── The disposable fault fixture ─────────────────────────────────────────
    admin = new Pool({ connectionString: ADMIN_DSN });
    await admin.query(
      `CREATE TABLE IF NOT EXISTS public.umi_test_commit_fault (
         cart_id uuid PRIMARY KEY
       )`,
    );
    await admin.query(`GRANT SELECT ON public.umi_test_commit_fault TO api,worker`);
    await admin.query(
      `CREATE OR REPLACE FUNCTION public.umi_test_fail_sale_commit()
       RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF EXISTS (SELECT 1 FROM public.umi_test_commit_fault WHERE cart_id=NEW.cart_id) THEN
           RAISE EXCEPTION 'ONCA_TEST_COMMIT_FAILURE' USING ERRCODE='P0001';
         END IF;
         RETURN NEW;
       END $$`,
    );
    await admin.query(
      `DROP TRIGGER IF EXISTS umi_test_fail_sale_commit ON merchant.pos_committed_sale`,
    );
    await admin.query(
      `CREATE TRIGGER umi_test_fail_sale_commit
         BEFORE INSERT ON merchant.pos_committed_sale
         FOR EACH ROW EXECUTE FUNCTION public.umi_test_fail_sale_commit()`,
    );
  }, 120_000);

  afterAll(async () => {
    if (admin) {
      await admin.query(
        `DROP TRIGGER IF EXISTS umi_test_fail_sale_commit ON merchant.pos_committed_sale`,
      );
      await admin.query(`DROP FUNCTION IF EXISTS public.umi_test_fail_sale_commit()`);
      await admin.query(`DROP TABLE IF EXISTS public.umi_test_commit_fault`);
      await admin.end();
    }
    if (pg) await pg.onModuleDestroy();
  }, 60_000);

  beforeEach(() => {
    terminal.reset();
  });

  // ── Scenario 1 · the lost reply ────────────────────────────────────────────

  it('replays one checkout command into one sale, one receipt, one payment and one capture', async () => {
    const till = TILLS[0];
    const cart = await newCart(till);
    const tenderId = randomUUID();
    const previewed = await preview(till, cart, [{ id: tenderId, amount: AMOUNT_DUE }]);
    expect(previewed.result.confirmation.totals.grandTotal.minorUnits).toBe(AMOUNT_DUE);

    const firstCapture = await capture(till, cart.id, tenderId, AMOUNT_DUE);
    expect(firstCapture.providerCalled).toBe(true);
    expect(firstCapture.attempt.state).toBe('succeeded');
    expect(terminal.captureCalls).toHaveLength(1);

    const committedDto = commitCommand(previewed.dto, previewed.fingerprint);
    const first = await runCheckout(till, committedDto);
    expect(first.status).toBe('completed');
    expect(first.sale).not.toBeNull();
    expect(first.receipt).not.toBeNull();

    const attemptAfterCommit = await attempts(cart.id);
    expect(attemptAfterCommit).toHaveLength(1);
    expect(attemptAfterCommit[0]).toMatchObject({
      id: firstCapture.attempt.id,
      status: 'succeeded',
      tenderId,
      tenderDraftId: tenderId,
      providerPaymentId: firstCapture.attempt.providerPaymentId,
    });
    expect(await sales(cart.id)).toHaveLength(1);
    expect(await receiptCount(cart.id)).toBe(1);
    expect(await payments(cart.id)).toHaveLength(1);
    expect(await tenderFacts(cart.id)).toHaveLength(1);
    expect(await tenderFacts(cart.id)).toMatchObject([
      {
        id: tenderId,
        tenderType: 'manual_terminal',
        status: 'committed',
        amount: String(AMOUNT_DUE),
      },
    ]);

    // The SAME command identity and the SAME payload. The integrity log answers with
    // the stored result; the provider is not asked again, and nothing is written twice.
    const replay = await runCheckout(till, committedDto);
    expect(replay.status).toBe('completed');
    expect(replay.sale?.id).toBe(first.sale?.id);
    expect(replay.receipt?.receiptRef).toBe(first.receipt?.receiptRef);
    expect(terminal.captureCalls).toHaveLength(1);
    expect(await attempts(cart.id)).toHaveLength(1);
    expect(await sales(cart.id)).toHaveLength(1);
    expect(await receiptCount(cart.id)).toBe(1);
    expect(await payments(cart.id)).toHaveLength(1);
    expect(await tenderFacts(cart.id)).toHaveLength(1);
  }, 60_000);

  // ── Scenario 2 · failed commit, then the product's recovery paths ──────────

  it('recovers a succeeded attempt after the commit fails, without a second capture', async () => {
    const till = TILLS[1];
    const cart = await newCart(till);
    const tenderId = randomUUID();
    const previewed = await preview(till, cart, [{ id: tenderId, amount: AMOUNT_DUE }]);

    const captured = await capture(till, cart.id, tenderId, AMOUNT_DUE);
    expect(captured.providerCalled).toBe(true);
    expect(captured.attempt.state).toBe('succeeded');
    expect(terminal.captureCalls).toHaveLength(1);

    const failed = commitCommand(previewed.dto, previewed.fingerprint);
    await armFault(cart.id);
    await expect(runCheckout(till, failed)).rejects.toThrow(/ONCA_TEST_COMMIT_FAILURE/);
    await disarmFault(cart.id);

    // The money moved; the sale did not. The attempt is still succeeded and, because
    // the failed transaction rolled back the link, its `tender_id` is still null.
    const afterFailure = await attempts(cart.id);
    expect(afterFailure).toHaveLength(1);
    expect(afterFailure[0]).toMatchObject({
      id: captured.attempt.id,
      status: 'succeeded',
      tenderDraftId: tenderId,
      tenderId: null,
    });
    expect(await sales(cart.id)).toHaveLength(0);
    expect(await receiptCount(cart.id)).toBe(0);
    expect(await payments(cart.id)).toHaveLength(0);
    expect(await tenderFacts(cart.id)).toHaveLength(0);
    expect(terminal.captureCalls).toHaveLength(1);

    // The recovery read the till already has. It names the draft and the tender, and
    // it now returns the succeeded unlinked attempt as `paymentOutcome`, with no
    // ambiguity. The same attempt id is what the operator uses to reconcile.
    const snapshot = await scoped(till, () =>
      checkout.recovery(till.user, MERCHANT, cart.id, {
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
      }),
    );
    // The failed commit rolled the whole transaction back, including the write that
    // would have moved the draft to `payment_accepted`. The draft still says what the
    // preview wrote: `selecting_tender`, even though the attempt already succeeded.
    expect(snapshot.state).toBe('selecting_tender');
    expect(snapshot.tenderDrafts.map((entry) => entry.id)).toContain(tenderId);
    expect(snapshot.paymentOutcome).toMatchObject({
      attempt: { id: captured.attempt.id, status: 'succeeded' },
    });
    expect(snapshot.paymentOutcome?.ambiguity).toBeNull();

    // The attempt-level read does find it. This is the route that can answer "did the
    // card move?" for a client that kept the attempt id.
    const status = await scoped(till, () =>
      checkout.paymentStatus(till.user, MERCHANT, captured.attempt.id, {
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
      }),
    );
    expect(status?.attempt.status).toBe('succeeded');
    expect(status?.ambiguity).toBeNull();

    // The real recovery action the product offers today: repeat the same checkout
    // command. The failed transaction left no command row, the cart version did not
    // move, and the captured attempt is still linked by its tender draft. The retry
    // links it instead of writing a second attempt.
    const recovered = await runCheckout(till, failed);
    expect(recovered.status).toBe('completed');
    expect(recovered.sale).not.toBeNull();

    const attemptAfterRecovery = await attempts(cart.id);
    expect(attemptAfterRecovery).toHaveLength(1);
    expect(attemptAfterRecovery[0]).toMatchObject({
      id: captured.attempt.id,
      status: 'succeeded',
      tenderId,
      tenderDraftId: tenderId,
      providerPaymentId: captured.attempt.providerPaymentId,
    });
    const saleRows = await sales(cart.id);
    expect(saleRows).toHaveLength(1);
    expect(await receiptCount(cart.id)).toBe(1);
    const paymentRows = await payments(cart.id);
    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0]).toMatchObject({ id: captured.attempt.id, amount: String(AMOUNT_DUE) });
    expect(await tenderFacts(cart.id)).toHaveLength(1);
    expect(terminal.captureCalls).toHaveLength(1);
  }, 60_000);

  // ── Scenario 3 · the same draft, a new identity ────────────────────────────

  it('answers a second capture for the same tender draft from the first attempt', async () => {
    const till = TILLS[2];
    const cart = await newCart(till);
    const tenderId = randomUUID();
    const previewed = await preview(till, cart, [{ id: tenderId, amount: AMOUNT_DUE }]);

    const first = await capture(till, cart.id, tenderId, AMOUNT_DUE);
    const second = await capture(till, cart.id, tenderId, AMOUNT_DUE);

    expect(second.attempt.id).toBe(first.attempt.id);
    expect(second.providerCalled).toBe(false);
    expect(second.idempotentReplay).toBe(true);
    expect(terminal.captureCalls).toHaveLength(1);
    expect(await attempts(cart.id)).toHaveLength(1);

    const committed = await runCheckout(till, commitCommand(previewed.dto, previewed.fingerprint));
    expect(committed.status).toBe('completed');
    expect(await attempts(cart.id)).toHaveLength(1);
    expect(await sales(cart.id)).toHaveLength(1);
  }, 60_000);

  // ── Scenario 4 · split tenders ─────────────────────────────────────────────

  it('keeps one fact and one payment per split tender across a recovered commit', async () => {
    const till = TILLS[3];
    const cart = await newCart(till);
    const firstTender = randomUUID();
    const secondTender = randomUUID();
    const firstAmount = 10_000;
    const secondAmount = AMOUNT_DUE - firstAmount;

    const previewed = await preview(till, cart, [
      { id: firstTender, amount: firstAmount },
      { id: secondTender, amount: secondAmount },
    ]);

    const firstCapture = await capture(till, cart.id, firstTender, firstAmount);
    const secondCapture = await capture(till, cart.id, secondTender, secondAmount);
    expect(firstCapture.attempt.state).toBe('succeeded');
    expect(secondCapture.attempt.state).toBe('succeeded');
    expect(terminal.captureCalls).toHaveLength(2);

    const failed = commitCommand(previewed.dto, previewed.fingerprint);
    await armFault(cart.id);
    await expect(runCheckout(till, failed)).rejects.toThrow(/ONCA_TEST_COMMIT_FAILURE/);
    await disarmFault(cart.id);

    expect(await sales(cart.id)).toHaveLength(0);
    expect(await payments(cart.id)).toHaveLength(0);
    expect(await tenderFacts(cart.id)).toHaveLength(0);

    const recovered = await runCheckout(till, failed);
    expect(recovered.status).toBe('completed');
    expect(recovered.payments).toHaveLength(2);

    const attemptRows = await attempts(cart.id);
    expect(attemptRows).toHaveLength(2);
    expect(new Set(attemptRows.map((row) => row.tenderId))).toEqual(
      new Set([firstTender, secondTender]),
    );
    expect(await sales(cart.id)).toHaveLength(1);
    expect(await receiptCount(cart.id)).toBe(1);
    const paymentRows = await payments(cart.id);
    expect(paymentRows).toHaveLength(2);
    expect(paymentRows.map((row) => row.amount).sort()).toEqual(
      [String(firstAmount), String(secondAmount)].sort(),
    );
    const facts = await tenderFacts(cart.id);
    expect(facts).toHaveLength(2);
    expect(facts.map((row) => row.id).sort()).toEqual([firstTender, secondTender].sort());
    expect(facts.every((row) => row.status === 'committed')).toBe(true);
    expect(terminal.captureCalls).toHaveLength(2);
  }, 60_000);

  // ── Characterization · the 409s were BEFORE the correction ────────────────
  //
  // Production history: the four 409s happened BEFORE the support correction, while
  // the cart version was still 8. After the correction the POS made no new API
  // request. The stale-v8 retry below is a synthetic probe, not the production
  // sequence. A v9 POST /checkout links the same attempt and sells with zero captures.

  /**
   * The real incident 001 state, through the support correction.
   *
   * This helper drives the characterization control below. It performs the exact
   * path: 3 conchas / 13500 / version 8, capture
   * 22500, `TENDER_OVERALLOCATION`, support 3 → 5 / 13500 → 22500 / version 8 → 9
   * with an `adjust` audit row.
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

  it('characterizes the synthetic stale-v8 retry after the incident correction', async () => {
    const till = TILLS[4];
    const { cart, tenderId, captured, previewed } = await prepareCorrectedIncident(till);

    const snapshot = await scoped(till, () =>
      checkout.recovery(till.user, MERCHANT, cart.id, {
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
      }),
    );
    expect(snapshot.state).toBe('collecting_payment');
    expect(snapshot.tenderDrafts.map((entry) => entry.id)).toContain(tenderId);
    expect(snapshot.paymentOutcome).toMatchObject({
      attempt: { id: captured.attempt.id, status: 'succeeded' },
    });
    expect(snapshot.paymentOutcome?.ambiguity).toBeNull();

    const status = await scoped(till, () =>
      checkout.paymentStatus(till.user, MERCHANT, captured.attempt.id, {
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
      }),
    );
    expect(status?.attempt.status).toBe('succeeded');
    expect(status?.ambiguity).toBeNull();

    // SYNTHETIC: this is not the production sequence. The four production 409s were
    // before the support correction, not after it. A v9 POST /checkout links the
    // attempt and sells with zero captures.
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
    await expect(runCheckout(till, staleRetry)).rejects.toMatchObject({
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

  // ── Fresh object graph · recovery is not a warm-cache effect ───────────────

  it('recovers the same attempt from a NEW service graph, with one capture on the original provider', async () => {
    const till = TILLS[5];
    const providerA = new ScriptedTerminalProvider('scripted_card_terminal', ['succeed']);
    const graphA = await buildGraph(providerA);
    let graphB: Graph | null = null;
    let disposedA = false;
    try {
      const cart = await scoped(till, () =>
        graphA.carts.create(till.user, MERCHANT, {
          locationId: LOCATION,
          operatorSessionId: till.operatorSessionId,
          idempotencyKey: randomUUID(),
        }),
      );
      const filled = await scoped(till, () =>
        graphA.carts.add(till.user, MERCHANT, {
          cartId: cart.id,
          locationId: LOCATION,
          operatorSessionId: till.operatorSessionId,
          productId: PRODUCT,
          variantId: null,
          modifierSelections: [],
          quantity: QUANTITY,
          courseNumber: 1,
          note: null,
          expectedVersion: cart.version,
          idempotencyKey: randomUUID(),
        }),
      );
      const tenderId = randomUUID();
      const previewed = await (async () => {
        const dto = command(till, filled, [{ id: tenderId, amount: AMOUNT_DUE }]);
        const result = await scoped(till, () => graphA.checkout.checkout(till.user, MERCHANT, dto));
        if (result.status !== 'confirmation_required') {
          throw new Error(`fresh-graph preview did not ask for confirmation: ${result.status}`);
        }
        return { dto, fingerprint: result.confirmation.fingerprint };
      })();
      const capturedA = await scoped(till, () =>
        graphA.tender.capture(till.user, MERCHANT, {
          cartId: filled.id,
          tenderId,
          locationId: LOCATION,
          operatorSessionId: till.operatorSessionId,
          commandIdentity: randomUUID(),
          provider: 'scripted_card_terminal',
          amount: money(AMOUNT_DUE),
          idempotencyKey: randomUUID(),
        }),
      );
      expect(capturedA.attempt.state).toBe('succeeded');
      expect(providerA.captureCalls).toHaveLength(1);

      const failed = commitCommand(previewed.dto, previewed.fingerprint);
      await armFault(filled.id);
      await expect(
        scoped(till, () => graphA.checkout.checkout(till.user, MERCHANT, failed)),
      ).rejects.toThrow(/ONCA_TEST_COMMIT_FAILURE/);
      await disarmFault(filled.id);

      expect(await attempts(filled.id)).toHaveLength(1);
      expect(await sales(filled.id)).toHaveLength(0);

      // Dispose the whole first graph. The database rows stay; the objects do not.
      await graphA.pg.onModuleDestroy();
      disposedA = true;

      const providerB = new ScriptedTerminalProvider('scripted_card_terminal', ['succeed']);
      graphB = await buildGraph(providerB);

      const snapshotB = await scoped(till, () =>
        graphB!.checkout.recovery(till.user, MERCHANT, filled.id, {
          locationId: LOCATION,
          operatorSessionId: till.operatorSessionId,
        }),
      );
      expect(snapshotB.state).toBe('selecting_tender');
      expect(snapshotB.paymentOutcome).toMatchObject({
        attempt: { id: capturedA.attempt.id, status: 'succeeded' },
      });
      expect(snapshotB.paymentOutcome?.ambiguity).toBeNull();

      const recovered = await scoped(till, () =>
        graphB!.checkout.checkout(till.user, MERCHANT, failed),
      );
      expect(recovered.status).toBe('completed');
      expect(recovered.sale).not.toBeNull();

      const finalAttempts = await attempts(filled.id);
      expect(finalAttempts).toHaveLength(1);
      expect(finalAttempts[0]).toMatchObject({
        id: capturedA.attempt.id,
        status: 'succeeded',
        tenderId,
        tenderDraftId: tenderId,
        providerPaymentId: capturedA.attempt.providerPaymentId,
      });
      expect(await sales(filled.id)).toHaveLength(1);
      expect(await receiptCount(filled.id)).toBe(1);
      expect(await payments(filled.id)).toHaveLength(1);
      expect(await tenderFacts(filled.id)).toHaveLength(1);

      // The capture belongs to graph A's provider. Graph B never reached a provider.
      expect(providerA.captureCalls).toHaveLength(1);
      expect(providerB.captureCalls).toHaveLength(0);
    } finally {
      if (!disposedA) await graphA.pg.onModuleDestroy();
      if (graphB) await graphB.pg.onModuleDestroy();
    }
  }, 60_000);
});
