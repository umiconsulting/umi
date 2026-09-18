import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import { PosExceptionRepository, type ExceptionAuthorization } from './pos-exception.repository';
import { exceptionCommandFingerprint } from './pos-exception.service';

/**
 * THE GUARD'S OWN SQL, AGAINST ROWS INSTEAD OF MOCKS — plan §13.4 item 4.
 *
 * §13.4 named this as the one thing the refund caller's pass left unwritten: "that a
 * provider-backed tender is refused without a verified refund attempt, and accepted with one, is
 * asserted through the service's unit cases and written in `commit`; what is NOT yet written is an
 * integration case that seeds a committed sale, a preview and a refund attempt and drives `commit`
 * against the real schema."
 *
 * WHY IT NEEDED ITS OWN FILE. `point-card-refund.spec.ts` drives the SERVICE with a mocked
 * repository, so the guard's two queries — the one that verifies a handed-in attempt and the one
 * that decides whether a tender is provider-backed — were never executed against real rows. A
 * predicate that matches nothing is indistinguishable from a refusal that works, and that is the
 * failure this file exists to make impossible.
 *
 * WHAT IT SEEDS, AND WHY THAT IS THE WHOLE DIFFICULTY. `commit` reads a committed sale through the
 * receipt, the cart, the order, the payment attempt and the exception policy, so the fixture is: a
 * merchant, a branch, an operator session, a cart with one line, a checkout draft, a
 * `manual_terminal` tender with a provider-proofed capture on it, a receipt snapshot whose line
 * refs are the cart's, the committed sale itself, and a policy that allows a refund. The preview
 * is then created by the REAL `preview` method, because its fingerprint is what `commit` checks.
 */

const APP_DSN = process.env.DATABASE_URL_APP;
const WORKER_DSN = process.env.DATABASE_URL_WORKER;
const JWT_SECRET = 'point-card-refund-harness-secret-0000';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
    JWT_SECRET,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const MERCHANT = '7f000000-0000-4000-8000-0000000000d1';
const LOCATION = '7f000000-0000-4000-8000-0000000000d2';
const USER = '7f000000-0000-4000-8000-0000000000d3';
const SESSION = '7f000000-0000-4000-8000-0000000000d4';
const DEVICE = '7f000000-0000-4000-8000-0000000000d5';
const STAFF = '7f000000-0000-4000-8000-0000000000e1';
const OPERATOR_SESSION = '7f000000-0000-4000-8000-0000000000d6';
/**
 * THE SALE CHAIN IS PER RUN, AND THAT IS FORCED BY THE SCHEMA RATHER THAN CHOSEN.
 *
 * A committed sale and its exception are APPEND-ONLY — an exception is a fact, not a draft — so a
 * fixture that reuses one sale id can be refunded exactly once and every later run finds nothing
 * left to refund. The café, the branch, the operator and the product are stable and upserted; the
 * SALE and everything that hangs off it is new each time.
 */
let CART = '';
let CHECKOUT = '';
let TENDER = '';
let SALE_ATTEMPT = '';
let CAPTURE_ATTEMPT = '';
let REFUND_ATTEMPT = '';
let RECEIPT = '';
let SALE = '';
let LINE = '';
let ORDER = '';
const PRODUCT = '7f000000-0000-4000-8000-0000000000e2';

const CURRENCY = 'MXN';
/** 100.00 + 16.00 tax = 116.00, on one line, paid at the terminal. */
const MERCHANDISE = 10_000;
const TAX = 1_600;
const TOTAL = MERCHANDISE + TAX;
const PROVIDER_REFUND = 'REFEXCEPTION000000000000000001';

const money = (minorUnits: number) => ({ minorUnits, currency: CURRENCY });

describe('the provider-refund guard · §13.4 item 4', () => {
  let pg: PgService;
  let repo: PosExceptionRepository;
  let authorization: ExceptionAuthorization;

  /**
   * THE DEVICE SCOPE IS PART OF THE POLICY, NOT DECORATION. `pos_exception_preview` carries a
   * RESTRICTIVE `device_scoping` policy that requires the row's `device_id` to equal
   * `umi.current_device()` — the setting `runWithMerchant` fills from the request context — so a
   * preview written without one is refused by the DATABASE. That is the schema insisting an
   * exception belongs to the register that raised it, and this harness has to say which register
   * it is, exactly as the till does.
   */
  const inDeviceContext = <T>(fn: () => Promise<T>) =>
    runWithRequestContext(
      {
        merchantId: MERCHANT,
        locationId: LOCATION,
        deviceId: DEVICE,
        userId: USER,
        requestId: randomUUID(),
      },
      fn,
    );

  const scoped = <T>(fn: () => Promise<T>) =>
    inDeviceContext(() => pg.runWithMerchant(MERCHANT, USER, fn, LOCATION));

  const previewOf = () =>
    scoped(() =>
      repo.preview(USER, MERCHANT, SALE, authorization, {
        locationId: LOCATION,
        operatorSessionId: OPERATOR_SESSION,
        exceptionType: 'partial_refund',
        reason: 'customer_request',
        note: null,
        lines: [{ saleLineId: LINE, quantity: 1, restockDecision: 'restock' }],
        expectedSaleVersion: 1,
      } as never),
    );

  /**
   * `commit` runs inside the caller's transaction, so this is the shape the service uses — minus
   * the vendor call, which is the SERVICE's half and is proven in `point-refund.integration.ts`.
   * What is under test here is the guard: given a set of handed-in attempts, does the DATABASE's
   * answer match the caller's claim?
   */
  const commitWith = (
    previewId: string,
    previewFingerprint: string,
    providerRefunds: Array<{ tenderId: string; attemptId: string }>,
    /**
     * A manual-terminal refund ALWAYS needs a manager's approval (`refundApprovalRequired` says
     * so: "hasManualTerminal"), so a case that expects the command to complete must hand in a
     * grant whose `command_fingerprint` is the one this exact command computes.
     */
    approval?: { readonly approvalId: string; readonly commandId: string },
  ) => {
    const commandId = approval?.commandId ?? randomUUID();
    const dto = {
      locationId: LOCATION,
      operatorSessionId: OPERATOR_SESSION,
      previewId,
      previewFingerprint,
      approvalId: approval?.approvalId ?? null,
      expectedSaleVersion: 1,
      commandId,
      idempotencyKey: randomUUID(),
      offline: false as const,
      fiscalMotive: '02' as const,
    };
    return inDeviceContext(() =>
      pg.runWithMerchant(
        MERCHANT,
        USER,
        (client) =>
          repo.commit(
            client,
            MERCHANT,
            SALE,
            authorization,
            dto as never,
            exceptionCommandFingerprint(SALE, previewId, previewFingerprint, commandId),
            randomUUID(),
            providerRefunds,
          ),
        LOCATION,
      ),
    );
  };

  beforeAll(async () => {
    if (!APP_DSN || !WORKER_DSN) {
      throw new Error(
        'Set DATABASE_URL_APP and DATABASE_URL_WORKER to a DISPOSABLE build-v3 database.',
      );
    }
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    repo = new PosExceptionRepository(pg);

    CART = randomUUID();
    CHECKOUT = randomUUID();
    TENDER = randomUUID();
    SALE_ATTEMPT = randomUUID();
    CAPTURE_ATTEMPT = randomUUID();
    REFUND_ATTEMPT = randomUUID();
    RECEIPT = randomUUID();
    SALE = randomUUID();
    LINE = randomUUID();
    ORDER = randomUUID();

    await pg.query(
      `INSERT INTO merchant.merchant (id,name,handle,currency) VALUES ($1::uuid,'Refund Guard','refund-guard','MXN')
       ON CONFLICT (id) DO NOTHING`,
      [MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.location (id,merchant_id,name) VALUES ($1::uuid,$2::uuid,'Mostrador')
       ON CONFLICT (id) DO NOTHING`,
      [LOCATION, MERCHANT],
    );
    await pg.query(
      `INSERT INTO umi."user" (id,full_name) VALUES ($1::uuid,'Cajera') ON CONFLICT (id) DO NOTHING`,
      [USER],
    );
    await pg.query(
      `INSERT INTO runtime.session (id,merchant_id,principal_type,principal_id,token_hash,expires_at)
       VALUES ($1::uuid,$2::uuid,'user',$3::uuid,repeat('d',64),now()+interval '1 day')
       ON CONFLICT (id) DO NOTHING`,
      [SESSION, MERCHANT, USER],
    );
    await pg.query(
      `INSERT INTO merchant.device (id,merchant_id,location_id,name,kind,status,credential_version)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'Caja 1','pos_terminal','active',1)
       ON CONFLICT (id) DO NOTHING`,
      [DEVICE, MERCHANT, LOCATION],
    );
    await pg.query(
      `INSERT INTO merchant.staff (id,merchant_id,user_id,role_id,name)
       SELECT $1::uuid,$2::uuid,$3::uuid,(SELECT id FROM umi.role WHERE key='cashier'),'Cajera'
       ON CONFLICT (id) DO NOTHING`,
      [STAFF, MERCHANT, USER],
    );
    await pg.query(
      `INSERT INTO runtime.operator_session
         (id,merchant_id,location_id,device_id,user_id,durable_session_id,staff_id,state,expires_at,
          permissions,entitlements)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,'active',
               now()+interval '1 day',
               ARRAY['sale.exception.read','sale.refund.partial','sale.refund.manual_terminal'],
               '[{"featureKey":"pos","enabled":true}]'::jsonb)
       ON CONFLICT (id) DO UPDATE SET state='active', expires_at=now()+interval '1 day',
         permissions=ARRAY['sale.exception.read','sale.refund.partial','sale.refund.manual_terminal'],
         entitlements='[{"featureKey":"pos","enabled":true}]'::jsonb`,
      [OPERATOR_SESSION, MERCHANT, LOCATION, DEVICE, USER, SESSION, STAFF],
    );

    // ── The sale's own rows. Written by hand because the point is the GUARD, not checkout. ──
    await pg.query(
      `INSERT INTO merchant.pos_cart
         (id,merchant_id,location_id,operator_session_id,original_operator_session_id,
          original_operator_user_id,operator_user_id,status,lifecycle_state)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$4::uuid,$5::uuid,$5::uuid,'committed','committed')
       ON CONFLICT (id) DO NOTHING`,
      [CART, MERCHANT, LOCATION, OPERATOR_SESSION, USER],
    );
    await pg.query(
      `INSERT INTO merchant.product (id,merchant_id,name,price,sku,tax_rate_basis_points)
       VALUES ($1::uuid,$2::uuid,'Cafe americano',$3,'CAFE-AME',1600)
       ON CONFLICT (id) DO NOTHING`,
      [PRODUCT, MERCHANT, MERCHANDISE],
    );
    await pg.query(
      `INSERT INTO merchant.pos_cart_line
         (id,merchant_id,cart_id,product_id,identity_key,product_name,quantity,base_price,tax_rate_basis_points)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'Cafe americano',1,$6,1600)
       ON CONFLICT (id) DO NOTHING`,
      [LINE, MERCHANT, CART, PRODUCT, 'a'.repeat(64), MERCHANDISE],
    );
    await pg.query(
      `INSERT INTO merchant.customer_order (id,merchant_id,location_id,source,status,version)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'pos','completed',1)
       ON CONFLICT (id) DO NOTHING`,
      [ORDER, MERCHANT, LOCATION],
    );
    await pg.query(
      `INSERT INTO merchant.pos_checkout_draft
         (id,merchant_id,location_id,cart_id,operator_session_id,device_id,state,receipt_delivery,version)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,'receipt_available','{"destination":"display"}'::jsonb,1)
       ON CONFLICT (id) DO NOTHING`,
      [CHECKOUT, MERCHANT, LOCATION, CART, OPERATOR_SESSION, DEVICE],
    );
    await pg.query(
      `INSERT INTO merchant.pos_tender_fact
         (id,merchant_id,location_id,checkout_id,cart_id,position,tender_type,status,
          amount_minor_units,change_minor_units,currency,committed_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,0,'manual_terminal','committed',$6,0,'MXN',now())
       -- NOTHING, NOT AN UPDATE: a committed tender is IMMUTABLE by trigger, which is the schema
       -- saying that what a sale took is a fact rather than a draft. A re-run finds the row and
       -- leaves it alone.
       ON CONFLICT (id) DO NOTHING`,
      [TENDER, MERCHANT, LOCATION, CHECKOUT, CART, TOTAL],
    );

    // The attempt that PAID for the sale (what the receipt names), and the provider capture on the
    // tender — two different rows, which is exactly the distinction the guard's join walks.
    await pg.query(
      `INSERT INTO merchant.pos_payment_attempt
         (id,merchant_id,location_id,cart_id,tender_id,method,provider,amount_minor_units,currency,
          status,proof_source,provider_order_id,provider_payment_id,correlation_id,resolved_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,NULL,'cash',NULL,$5,'MXN','succeeded','cash',
               NULL,NULL,$6,now()),
              ($7::uuid,$2::uuid,$3::uuid,$4::uuid,$8::uuid,'external_terminal','mercado_pago_point',
               $5,'MXN','succeeded','provider','ORDGUARD1','PAYGUARD1',$9,now())
       ON CONFLICT (id) DO NOTHING`,
      [
        SALE_ATTEMPT,
        MERCHANT,
        LOCATION,
        CART,
        TOTAL,
        `guard-cash-${SALE_ATTEMPT}`,
        CAPTURE_ATTEMPT,
        TENDER,
        `guard-capture-${CAPTURE_ATTEMPT}`,
      ],
    );

    // The receipt NUMBER is unique per merchant in the schema, so a per-run receipt carries a
    // per-run reference — the same reason the sale chain is per run.
    const receiptNumber = `GUARD-${SALE.slice(0, 8)}`;
    const snapshot = {
      receiptRef: receiptNumber,
      merchantId: MERCHANT,
      locationId: LOCATION,
      issuedAt: new Date().toISOString(),
      businessDate: new Date().toISOString().slice(0, 10),
      lines: [
        {
          lineRef: LINE,
          description: 'Cafe americano',
          quantity: 1,
          unitPrice: money(MERCHANDISE),
          lineTotal: money(TOTAL),
          tax: money(TAX),
          discount: money(0),
          tip: money(0),
        },
      ],
      subtotal: money(MERCHANDISE),
      taxTotal: money(TAX),
      grandTotal: money(TOTAL),
      currency: CURRENCY,
      version: 1,
    };
    await pg.query(
      `INSERT INTO merchant.receipt_snapshot
         (id,merchant_id,location_id,order_id,payment_attempt_id,receipt_number,business_date,
          currency,grand_total,snapshot)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$8,current_date,'MXN',$6,$7::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        RECEIPT,
        MERCHANT,
        LOCATION,
        ORDER,
        SALE_ATTEMPT,
        TOTAL,
        JSON.stringify(snapshot),
        receiptNumber,
      ],
    );
    await pg.query(
      `INSERT INTO merchant.pos_committed_sale
         (id,merchant_id,location_id,cart_id,order_id,payment_attempt_id,receipt_snapshot_id,
          totals_fingerprint,committed_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8,now())
       ON CONFLICT (id) DO NOTHING`,
      [SALE, MERCHANT, LOCATION, CART, ORDER, SALE_ATTEMPT, RECEIPT, 'b'.repeat(64)],
    );

    // The policy the preview reads. Default-deny without it, so this row is not optional.
    await pg.query(
      `INSERT INTO merchant.pos_exception_policy
         (merchant_id,location_id,currency,version,refunds_enabled,voids_enabled,
          refund_window_minutes,void_window_minutes,cashier_refund_threshold,cash_refund_threshold,
          cash_refund_requires_shift,require_different_approver,tender_allocation_policy,
          tip_refund_policy,maximum_lines,expires_at,fingerprint)
       VALUES ($1::uuid,$2::uuid,'MXN','guard-1',true,false,1440,60,$3,0,false,false,
               'proportional','non_refundable',10,now()+interval '1 day',$4)
       ON CONFLICT (merchant_id,location_id,currency) DO UPDATE SET
         refunds_enabled=true, refund_window_minutes=1440,
         cashier_refund_threshold=$3, maximum_lines=10, expires_at=now()+interval '1 day'`,
      [MERCHANT, LOCATION, TOTAL + 1, 'c'.repeat(64)],
    );

    const authorized = await repo.authorize(
      USER,
      SESSION,
      DEVICE,
      MERCHANT,
      LOCATION,
      OPERATOR_SESSION,
    );
    if (!authorized) throw new Error('the harness could not authorize its own operator session');
    authorization = authorized;
  }, 120_000);

  afterAll(async () => {
    if (pg) await pg.onModuleDestroy();
  }, 60_000);

  it('REFUSES a handout that does not verify, so no refund is recorded on a stranger’s word', async () => {
    const preview = await previewOf();

    // THE CALLER CLAIMS a refund of this tender. The row it names is a CAPTURE, not a refund of it:
    // it has no `refund_of_attempt_id` and no vendor refund id, so the guard's join finds nothing.
    const error = await commitWith(preview.previewId, preview.previewFingerprint, [
      { tenderId: TENDER, attemptId: CAPTURE_ATTEMPT },
    ]).catch((caught: unknown) => caught);

    expect(error).toBeDefined();
    expect((error as { response?: { code?: string } }).response?.code).toBe(
      'TERMINAL_REFUND_CONFIRMATION_REQUIRED',
    );
    // …AND NOTHING WAS WRITTEN: the refusal is the guard's, and it happens before the exception row.
    const { rows } = await inDeviceContext(() =>
      pg.runWithMerchant(
        MERCHANT,
        USER,
        (client) =>
          client.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM merchant.pos_sale_exception WHERE sale_id=$1::uuid`,
            [SALE],
          ),
        LOCATION,
      ),
    );
    expect(rows[0]?.count).toBe('0');
  }, 60_000);

  it('REFUSES an operator’s word for a tender a provider took, with no handout at all', async () => {
    const preview = await previewOf();

    // The operator declared the terminal outcome by hand. For a register we integrated with that
    // is NOT an answer — the vendor is the only thing that can say whether the money came back.
    const error = await commitWith(preview.previewId, preview.previewFingerprint, []).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeDefined();
    const denied = error as { response?: { code?: string; providerBacked?: string[] } };
    expect(['TERMINAL_REFUND_CONFIRMATION_REQUIRED', 'PAYMENT_OUTCOME_UNKNOWN']).toContain(
      denied.response?.code,
    );
  }, 60_000);

  it('ACCEPTS a refund attempt the vendor actually proved', async () => {
    // A REAL refund row: succeeded, provider-proofed, linked to the capture that paid this tender,
    // carrying the vendor's refund id. This is the shape `TenderService.refund` writes, and the
    // shape `73_mp_refund.sql`'s CHECK insists on.
    await pg.query(
      `INSERT INTO merchant.pos_payment_attempt
         (id,merchant_id,location_id,cart_id,tender_id,method,provider,amount_minor_units,currency,
          status,proof_source,provider_order_id,provider_payment_id,provider_refund_id,
          refund_of_attempt_id,correlation_id,resolved_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,NULL,'external_terminal','mercado_pago_point',
               $5,'MXN','succeeded','provider','ORDGUARD1','PAYGUARD1',$6,$7::uuid,$8,now())
       ON CONFLICT (id) DO UPDATE SET status='succeeded', proof_source='provider',
         provider_refund_id=EXCLUDED.provider_refund_id,
         refund_of_attempt_id=EXCLUDED.refund_of_attempt_id`,
      [
        REFUND_ATTEMPT,
        MERCHANT,
        LOCATION,
        CART,
        TOTAL,
        PROVIDER_REFUND,
        CAPTURE_ATTEMPT,
        `guard-refund-${REFUND_ATTEMPT}`,
      ],
    );
    const preview = await previewOf();

    // A manual-terminal refund is approval-gated by `refundApprovalRequired`, so the grant has to
    // exist and has to name THIS command: the guard reads the fingerprint, the session and the
    // location out of the row, and a grant for a different command is not an approval.
    const commandId = randomUUID();
    const approvalId = randomUUID();
    await pg.query(
      `INSERT INTO runtime.elevation_grant
         (id,session_id,merchant_id,location_id,permission_key,method,approved_by,expires_at,
          command_fingerprint)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'sale.refund.approve','manager_approval',
               $5::uuid,now()+interval '10 minutes',$6)
       ON CONFLICT (id) DO NOTHING`,
      [
        approvalId,
        SESSION,
        MERCHANT,
        LOCATION,
        USER,
        exceptionCommandFingerprint(SALE, preview.previewId, preview.previewFingerprint, commandId),
      ],
    );

    const result = await commitWith(
      preview.previewId,
      preview.previewFingerprint,
      [{ tenderId: TENDER, attemptId: REFUND_ATTEMPT }],
      { approvalId, commandId },
    ).catch((caught: unknown) => caught);

    if (result instanceof Error) {
      // The refusal's own code, in the failure message: a named rejection is the whole point of
      // this flow, and a bare "409" would leave the reader guessing which one it was.
      throw new Error(
        `commit refused with ${String((result as { response?: { code?: string } }).response?.code)}: ${JSON.stringify((result as { response?: unknown }).response)}`,
      );
    }

    // THE WHOLE COMMAND, not just the guard's silence: the exception is recorded, on the strength
    // of a refund the vendor proved and the database verified for itself.
    expect(result).toMatchObject({ exceptionType: 'partial_refund', status: 'committed' });

    // …and the row is the witness, read back rather than taken from the return value.
    const { rows } = await inDeviceContext(() =>
      pg.runWithMerchant(
        MERCHANT,
        USER,
        (client) =>
          client.query<{ status: string; total: string }>(
            `SELECT status, total_minor_units::text AS total
               FROM merchant.pos_sale_exception WHERE sale_id=$1::uuid ORDER BY committed_at DESC LIMIT 1`,
            [SALE],
          ),
        LOCATION,
      ),
    );
    expect(rows[0]?.status).toBe('committed');
  }, 60_000);
});
