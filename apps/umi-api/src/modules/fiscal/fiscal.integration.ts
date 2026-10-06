import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { FiscalDocumentQuery, FiscalReceptor, FiscalStampSaleRequest } from '@umi/contract';
import type { PoolClient } from 'pg';
import type { AppConfig } from '../../shared/config/config.schema';
import type { FacturapiAdapter } from '../../shared/adapters/facturapi.adapter';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import type { MerchantAccess } from '../auth/auth.types';
import {
  PacUnavailableError,
  type PacStampRequest,
  type PacStampResponse,
} from './fiscal-pac.port';
import { FiscalRepository } from './fiscal.repository';
import { FiscalService, type FiscalCancellationRequest } from './fiscal.service';
import { FacturapiPacProvider } from './providers/facturapi-pac.provider';
import { ScriptedPacProvider, deterministicFolio } from './providers/scripted-pac.provider';

/**
 * WORKSTREAM G, STEP 5, §8G'S THIRD ACCEPTANCE SENTENCE, AGAINST THE REAL SCHEMA.
 *
 * The sentence is "a cancelled sale cancels its fiscal document". The way to prove it
 * is not to read the service: it is to open the SALE's own transaction, call
 * `cancelForSale` inside it, and read `merchant.fiscal_document` back from inside that
 * same transaction and after it commits — then roll one back and show that the
 * document is still stamped. A rollback that leaves the document cancelled is the
 * half-done state the sentence exists to forbid.
 *
 * WHY THE SCRIPTED PAC IS THE INSTRUMENT AND NOT A SHORTCUT. A live Facturapi account
 * cannot be made to refuse on demand, cannot be asked to fail twice in a row, and would
 * spend a timbre per assertion. The fake can, and it COUNTS what it was asked — which is
 * how "the PAC was asked exactly once" is a fact (`stampCalls.length === 1`) rather than
 * a reading of the source. `FacturapiAdapter` is never reached from this file.
 *
 * WHAT IS ASSERTED WHERE. Every claim about a document is read back from SQL, not from
 * the service's return value: a service that returns the right object while writing the
 * wrong row is exactly the failure a mocked test cannot see.
 *
 *     set -a && . apps/umi-api/.env && set +a
 *     export DATABASE_URL_APP=$(echo "$DATABASE_URL_APP" | sed 's#/umi_transition_rehearsal_20260901#/umi_tender_verify2#')
 *     export DATABASE_URL_WORKER=$(echo "$DATABASE_URL_WORKER" | sed 's#/umi_transition_rehearsal_20260901#/umi_tender_verify2#')
 *     npx vitest run --config vitest.integration.config.ts src/modules/fiscal/fiscal.integration.ts
 *
 * SELF-SEEDING, AND WHAT CANNOT BE CLEANED UP. The tenant, the till, the operator and
 * every sale in this file are the suite's own (`7e0…` ids), created with
 * `ON CONFLICT DO NOTHING` so a re-run is clean. Each sale gets FRESH random ids, so a
 * re-run never inherits a stamped document from the previous one.
 * `merchant.fiscal_document` is deleted at the end of the run — the worker role holds
 * delete on it — but the sale FACTS cannot be: `pos_committed_sale` and
 * `receipt_snapshot` are append-only by trigger (`committed_sale_append_only`,
 * `receipt_snapshot_append_only`), and deleting them is exactly what the schema
 * refuses. They are facts rather than state, and this database is disposable.
 */

const APP_DSN = process.env.DATABASE_URL_APP;
const WORKER_DSN = process.env.DATABASE_URL_WORKER;

const JWT_SECRET = 'fiscal-harness-secret-000000000000';

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
const NEIGHBOUR = '7e000000-0000-4000-8000-0000000000b3';
const NEIGHBOUR_LOCATION = '7e000000-0000-4000-8000-0000000000b4';

const USER = '7e000000-0000-4000-8000-0000000000c1';
const DEVICE = '7e000000-0000-4000-8000-0000000000c2';
const STAFF = '7e000000-0000-4000-8000-0000000000c3';
const SESSION = '7e000000-0000-4000-8000-0000000000c4';
const OPERATOR_SESSION = '7e000000-0000-4000-8000-0000000000c5';
const NEIGHBOUR_USER = '7e000000-0000-4000-8000-0000000000c6';
const NEIGHBOUR_DEVICE = '7e000000-0000-4000-8000-0000000000c7';
const NEIGHBOUR_STAFF = '7e000000-0000-4000-8000-0000000000c8';
const NEIGHBOUR_SESSION = '7e000000-0000-4000-8000-0000000000c9';
const NEIGHBOUR_OPERATOR_SESSION = '7e000000-0000-4000-8000-0000000000ca';

/** Público en general, the receptor an over-the-counter CFDI actually carries. */
const RECEPTOR: FiscalReceptor = {
  rfc: 'XAXX010101000',
  name: 'Público en general',
  postalCode: '06000',
  regimen: '601',
  uso: 'G03',
};

const HOUR_MS = 60 * 60 * 1000;

const access: MerchantAccess = {
  merchantId: MERCHANT,
  locationId: LOCATION,
  name: 'Fiscal Harness',
  handle: null,
  timezone: 'America/Mexico_City',
  membershipId: null,
  role: 'owner',
  roles: ['owner'],
  permissions: ['merchant.manage'],
};

/** The document, joined to the sale it belongs to. Read from SQL, never from a return value. */
const DOCUMENT_BY_CART = `
  SELECT f.id::text AS id,f.status,f.uuid_folio::text AS uuid_folio,f.stamped_at,
         f.cancelled_at,f.cancellation_motive,f.cancellation_reason,f.error_message,
         f.deadline_at,f.deadline_kind,f.payment_form,f.payment_method,f.provider_document_id,
         f.receptor_rfc,f.total_minor_units::text AS total_minor_units,f.currency,f.created_at
    FROM merchant.fiscal_document f
    JOIN merchant.pos_committed_sale s
      ON s.merchant_id=f.merchant_id AND s.order_id=f.order_id
   WHERE f.merchant_id=$1::uuid AND s.cart_id=$2::uuid`;

interface DocumentRow {
  id: string;
  status: string;
  uuid_folio: string | null;
  stamped_at: Date | null;
  cancelled_at: Date | null;
  cancellation_motive: string | null;
  cancellation_reason: string | null;
  error_message: string | null;
  deadline_at: Date;
  deadline_kind: string;
  payment_form: string | null;
  payment_method: string | null;
  provider_document_id: string | null;
  receptor_rfc: string | null;
  total_minor_units: string;
  currency: string;
  created_at: Date;
}

/**
 * The scripted PAC with one extra hook: it reads the database at the moment it is
 * asked to stamp. That is how "the pending row is COMMITTED BEFORE the PAC is called"
 * is proved rather than asserted — a service that called the PAC first would fail here,
 * because the row it wrote would not be visible yet.
 */
class ObservingPac extends ScriptedPacProvider {
  beforeStamp: (() => Promise<void>) | null = null;

  override async stamp(request: PacStampRequest, apiKey: string | null): Promise<PacStampResponse> {
    if (this.beforeStamp) await this.beforeStamp();
    return super.stamp(request, apiKey);
  }
}

describe('the fiscal record · §8G step 5 and the cancellation sentence', () => {
  let pg: PgService;
  let fiscal: FiscalService;
  let repo: FiscalRepository;
  let pac: ObservingPac;
  /** What the PAC saw in the database when it was asked to stamp. */
  let observedByPac: DocumentRow | null;

  const scoped = <T>(
    fn: () => Promise<T>,
    merchant = MERCHANT,
    location = LOCATION,
    userId: string | null = USER,
  ) =>
    runWithRequestContext(
      { merchantId: merchant, locationId: location, userId, requestId: randomUUID() },
      fn,
    );

  /** A refusal as plain fields: a Nest HttpException keeps its code inside getResponse(). */
  async function refusal(work: () => Promise<unknown>): Promise<{ status: number; code: string }> {
    try {
      await work();
    } catch (thrown) {
      const error = thrown as { status?: number; getResponse?: () => unknown };
      const body = (typeof error.getResponse === 'function' ? error.getResponse() : {}) as {
        code?: unknown;
      };
      return {
        status: error.status ?? 0,
        code: typeof body.code === 'string' ? body.code : '(no code)',
      };
    }
    throw new Error('the API ACCEPTED a command it was supposed to refuse');
  }

  // ── Fixtures ────────────────────────────────────────────────────────────

  /**
   * A committed sale: cart -> attempt -> order -> receipt -> the join that makes it a
   * sale. Every id is fresh, so two runs never share a document.
   */
  async function seedCommittedSale(
    input: {
      merchantId?: string;
      locationId?: string;
      operatorSessionId?: string;
      operatorUserId?: string;
      totalMinorUnits?: number;
      currency?: string;
    } = {},
  ): Promise<{
    cartId: string;
    orderId: string;
    receiptSnapshotId: string;
    receiptNumber: string;
  }> {
    const merchantId = input.merchantId ?? MERCHANT;
    const locationId = input.locationId ?? LOCATION;
    const operatorSessionId = input.operatorSessionId ?? OPERATOR_SESSION;
    const operatorUserId = input.operatorUserId ?? USER;
    const total = input.totalMinorUnits ?? 9_000;
    const currency = input.currency ?? 'MXN';

    const cartId = randomUUID();
    const attemptId = randomUUID();
    const orderId = randomUUID();
    const receiptId = randomUUID();
    const receiptNumber = `F-${receiptId.slice(0, 12)}`;

    await pg.query(
      `INSERT INTO merchant.pos_cart
         (id,merchant_id,location_id,operator_session_id,status,lifecycle_state,version,
          original_operator_session_id,original_operator_user_id,operator_user_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'committed','committed',1,
               $4::uuid,$5::uuid,$5::uuid)`,
      [cartId, merchantId, locationId, operatorSessionId, operatorUserId],
    );
    await pg.query(
      `INSERT INTO merchant.pos_payment_attempt
         (id,merchant_id,location_id,cart_id,method,amount_minor_units,currency,status,
          query_only,correlation_id,proof_source)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'cash',$5::bigint,$6,'succeeded',
               false,$7,'cash')`,
      [attemptId, merchantId, locationId, cartId, total, currency, randomUUID()],
    );
    await pg.query(
      `INSERT INTO merchant.customer_order (id,merchant_id,location_id,source,status)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'pos','completed')`,
      [orderId, merchantId, locationId],
    );
    await pg.query(
      `INSERT INTO merchant.receipt_snapshot
         (id,merchant_id,location_id,order_id,payment_attempt_id,receipt_number,
          business_date,currency,grand_total,snapshot)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,current_date,$7,$8::bigint,
               '{}'::jsonb)`,
      [receiptId, merchantId, locationId, orderId, attemptId, receiptNumber, currency, total],
    );
    await pg.query(
      `INSERT INTO merchant.pos_committed_sale
         (merchant_id,location_id,cart_id,order_id,payment_attempt_id,receipt_snapshot_id,
          totals_fingerprint)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,repeat('a',64))`,
      [merchantId, locationId, cartId, orderId, attemptId, receiptId],
    );

    return { cartId, orderId, receiptSnapshotId: receiptId, receiptNumber };
  }

  const stampDto = (
    saleId: string,
    overrides: Partial<FiscalStampSaleRequest> = {},
  ): FiscalStampSaleRequest => ({
    saleId,
    receptor: RECEPTOR,
    locationId: LOCATION,
    operatorSessionId: OPERATOR_SESSION,
    paymentForm: '04',
    paymentMethod: 'PUE',
    deadlineKind: 'operation',
    idempotencyKey: randomUUID(),
    ...overrides,
  });

  const stamp = (saleId: string, overrides: Partial<FiscalStampSaleRequest> = {}) =>
    scoped(() => fiscal.stampSale(access, MERCHANT, stampDto(saleId, overrides)));

  const cancellation = (
    saleId: string,
    overrides: Partial<FiscalCancellationRequest> = {},
  ): FiscalCancellationRequest => ({
    merchantId: MERCHANT,
    saleId,
    locationId: LOCATION,
    motive: '02',
    reason: 'Venta cancelada en caja.',
    actorUserId: USER,
    correlationId: randomUUID(),
    ...overrides,
  });

  /** The sale-cancel command's own transaction: the caller owns the client. */
  const cancelInCommandTransaction = <T>(
    work: (client: PoolClient) => Promise<T>,
    locationId = LOCATION,
  ) => pg.runWithMerchant(MERCHANT, USER, work, locationId);

  const rowByCart = async (cartId: string): Promise<DocumentRow | null> => {
    const { rows } = await pg.tquery<DocumentRow>(MERCHANT, DOCUMENT_BY_CART, [MERCHANT, cartId]);
    return rows[0] ?? null;
  };

  const rowByCartIn = async (client: PoolClient, cartId: string): Promise<DocumentRow | null> => {
    const { rows } = await client.query<DocumentRow>(DOCUMENT_BY_CART, [MERCHANT, cartId]);
    return rows[0] ?? null;
  };

  /** A document the suite writes directly, for the states stamping cannot produce. */
  const seedPendingDocument = (
    sale: { orderId: string; receiptSnapshotId: string },
    options: { deadlineAt: Date; deadlineKind?: 'operation' | 'period_close'; total?: number },
  ) =>
    pg.runWithMerchant(
      MERCHANT,
      USER,
      (client) =>
        repo.insertPending(client, {
          merchantId: MERCHANT,
          locationId: LOCATION,
          orderId: sale.orderId,
          receiptSnapshotId: sale.receiptSnapshotId,
          kind: 'nominative',
          totalMinorUnits: options.total ?? 9_000,
          currency: 'MXN',
          receptorRfc: RECEPTOR.rfc,
          receptorName: RECEPTOR.name,
          receptorPostalCode: RECEPTOR.postalCode,
          regimenFiscal: RECEPTOR.regimen,
          usoCfdi: RECEPTOR.uso,
          paymentForm: '01',
          paymentMethod: 'PUE',
          deadlineAt: options.deadlineAt,
          deadlineKind: options.deadlineKind ?? 'operation',
          commandId: null,
          idempotencyKey: null,
        }),
      LOCATION,
    );

  const list = (query: Partial<FiscalDocumentQuery> = {}) =>
    scoped(() =>
      fiscal.documents(access, MERCHANT, {
        locationId: LOCATION,
        operatorSessionId: OPERATOR_SESSION,
        limit: 200,
        ...query,
      }),
    );

  const counts = () => list().then((view) => view.counts);

  beforeAll(async () => {
    if (!APP_DSN || !WORKER_DSN) {
      throw new Error(
        'Set DATABASE_URL_APP and DATABASE_URL_WORKER to a DISPOSABLE build-v3 database.',
      );
    }
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    repo = new FiscalRepository(pg);
    pac = new ObservingPac(['accept']);
    fiscal = new FiscalService(repo, pac);

    // The tenant, the till and the operator: the same fixture the tender suite builds,
    // because a committed sale needs a real operator session behind its cart.
    await pg.query(
      `INSERT INTO merchant.merchant (id,name,handle,timezone,business_day_start,currency)
       VALUES ($1::uuid,'Fiscal Harness','fiscal-harness','America/Mexico_City','04:00','MXN'),
              ($2::uuid,'Vecino Fiscal','vecino-fiscal','America/Mexico_City','04:00','MXN')
       ON CONFLICT (id) DO NOTHING`,
      [MERCHANT, NEIGHBOUR],
    );
    await pg.query(
      `INSERT INTO merchant.location (id,merchant_id,name)
       VALUES ($1::uuid,$3::uuid,'Congreso'),($2::uuid,$4::uuid,'Vecino')
       ON CONFLICT (id) DO NOTHING`,
      [LOCATION, NEIGHBOUR_LOCATION, MERCHANT, NEIGHBOUR],
    );
    await pg.query(
      `INSERT INTO umi."user" (id,full_name)
       VALUES ($1::uuid,'Cajera'),($2::uuid,'Vecina')
       ON CONFLICT (id) DO NOTHING`,
      [USER, NEIGHBOUR_USER],
    );
    await pg.query(
      `INSERT INTO merchant.device (id,merchant_id,name,status)
       VALUES ($1::uuid,$3::uuid,'Till 1','active'),($2::uuid,$4::uuid,'Till vecino','active')
       ON CONFLICT (id) DO NOTHING`,
      [DEVICE, NEIGHBOUR_DEVICE, MERCHANT, NEIGHBOUR],
    );
    await pg.query(
      `INSERT INTO runtime.session
         (id,merchant_id,principal_type,principal_id,token_hash,expires_at)
       VALUES ($1::uuid,$3::uuid,'user',$5::uuid,repeat('b',64),now()+interval '1 day'),
              ($2::uuid,$4::uuid,'user',$6::uuid,repeat('c',64),now()+interval '1 day')
       ON CONFLICT (id) DO NOTHING`,
      [SESSION, NEIGHBOUR_SESSION, MERCHANT, NEIGHBOUR, USER, NEIGHBOUR_USER],
    );
    await pg.query(
      `INSERT INTO merchant.staff (id,merchant_id,user_id,role_id,name)
       SELECT $1::uuid,$3::uuid,$5::uuid,(SELECT id FROM umi.role WHERE key='cashier'),'Cajera'
       UNION ALL
       SELECT $2::uuid,$4::uuid,$6::uuid,(SELECT id FROM umi.role WHERE key='cashier'),'Vecina'
       ON CONFLICT (id) DO NOTHING`,
      [STAFF, NEIGHBOUR_STAFF, MERCHANT, NEIGHBOUR, USER, NEIGHBOUR_USER],
    );
    await pg.query(
      `INSERT INTO runtime.operator_session
         (id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,
          permissions,entitlements,expires_at)
       VALUES ($1::uuid,$3::uuid,$5::uuid,$7::uuid,$9::uuid,$11::uuid,$13::uuid,
               $15::text[],$16::jsonb,now()+interval '1 day'),
              ($2::uuid,$4::uuid,$6::uuid,$8::uuid,$10::uuid,$12::uuid,$14::uuid,
               $15::text[],$16::jsonb,now()+interval '1 day')
       ON CONFLICT (id) DO NOTHING`,
      [
        OPERATOR_SESSION,
        NEIGHBOUR_OPERATOR_SESSION,
        SESSION,
        NEIGHBOUR_SESSION,
        USER,
        NEIGHBOUR_USER,
        STAFF,
        NEIGHBOUR_STAFF,
        DEVICE,
        NEIGHBOUR_DEVICE,
        MERCHANT,
        NEIGHBOUR,
        LOCATION,
        NEIGHBOUR_LOCATION,
        ['checkout.commit', 'sale.lifecycle'],
        JSON.stringify([{ featureKey: 'pos', enabled: true }]),
      ],
    );
  }, 60_000);

  afterAll(async () => {
    // The state machine's rows are this module's output and are cleaned up. The sale
    // facts are append-only by trigger and cannot be deleted; they are the suite's own
    // and this database is disposable.
    if (pg) {
      await pg.query('DELETE FROM merchant.fiscal_document WHERE merchant_id = ANY($1::uuid[])', [
        [MERCHANT, NEIGHBOUR],
      ]);
      await pg.onModuleDestroy();
    }
  }, 60_000);

  beforeEach(() => {
    pac.reset();
    pac.script(['accept']);
    pac.beforeStamp = null;
    observedByPac = null;
  });

  // ── Stamping ────────────────────────────────────────────────────────────

  it('stamping a committed sale writes the pending row, asks the PAC once and stamps it', async () => {
    const sale = await seedCommittedSale({ totalMinorUnits: 9_000 });
    pac.beforeStamp = async () => {
      observedByPac = await rowByCart(sale.cartId);
    };

    const result = await stamp(sale.cartId, { paymentForm: '04', paymentMethod: 'PUE' });

    expect(result.idempotentReplay).toBe(false);
    expect(result.document.status).toBe('stamped');
    expect(result.document.uuid).toBe(deterministicFolio(sale.cartId));

    // The state the PAC saw: the row existed, was committed, and had no folio yet.
    expect(observedByPac?.status).toBe('pending_self_invoice');
    expect(observedByPac?.uuid_folio).toBeNull();

    expect(pac.stampCalls).toHaveLength(1);
    expect(pac.stampCalls[0]?.saleId).toBe(sale.cartId);
    expect(pac.stampCalls[0]?.totalMinorUnits).toBe(9_000);
    expect(pac.stampCalls[0]?.currency).toBe('MXN');

    const row = await rowByCart(sale.cartId);
    if (!row) throw new Error('the stamped document was not found');
    expect(row.status).toBe('stamped');
    expect(row.uuid_folio).toBe(deterministicFolio(sale.cartId));
    expect(row.stamped_at).not.toBeNull();
    expect(row.error_message).toBeNull();
    expect(row.payment_form).toBe('04');
    expect(row.payment_method).toBe('PUE');
    expect(row.receptor_rfc).toBe(RECEPTOR.rfc);
    expect(row.provider_document_id).toBe(`pac_doc_${sale.cartId.slice(0, 8)}`);

    // THE CLOCK. `deadline_at` is exactly 24 hours after the operation, and the row's
    // own `created_at` IS the operation: both come from the same transaction's now().
    expect(row.deadline_kind).toBe('operation');
    expect(new Date(row.deadline_at).getTime() - new Date(row.created_at).getTime()).toBe(
      24 * HOUR_MS,
    );
  });

  it('stamping the same sale twice asks the PAC ONCE and replays the first document', async () => {
    const sale = await seedCommittedSale();

    const first = await stamp(sale.cartId);
    const second = await stamp(sale.cartId, { idempotencyKey: randomUUID() });

    expect(pac.stampCalls).toHaveLength(1);
    expect(second.idempotentReplay).toBe(true);
    expect(second.document.id).toBe(first.document.id);
    expect(second.document.uuid).toBe(first.document.uuid);
  });

  it('a PAC refusal leaves the document in error with the PAC sentence and NO folio', async () => {
    const sale = await seedCommittedSale();
    pac.script(['refuse']);

    const refused = await refusal(() => stamp(sale.cartId));
    expect(refused.status).toBe(409);
    expect(refused.code).toBe('FISCAL_STAMP_REFUSED');

    const row = await rowByCart(sale.cartId);
    expect(row?.status).toBe('error');
    expect(row?.uuid_folio).toBeNull();
    expect(row?.stamped_at).toBeNull();
    expect(row?.error_message).toContain('refused');
    expect(pac.stampCalls).toHaveLength(1);
  });

  it('an unreachable PAC leaves an ERROR row rather than a pending one with no clock', async () => {
    const sale = await seedCommittedSale();
    const offline = new FiscalService(repo, {
      id: 'unavailable',
      available: false,
      unavailableReason: 'FACTURAPI_USER_KEY is not set, so this deployment cannot stamp a CFDI.',
      stamp: () => Promise.reject(new Error('the PAC is not reachable')),
      cancel: () => Promise.reject(new Error('the PAC is not reachable')),
    });

    const refused = await refusal(() =>
      scoped(() => offline.stampSale(access, MERCHANT, stampDto(sale.cartId))),
    );
    expect(refused.status).toBe(409);
    expect(refused.code).toBe('FISCAL_PAC_UNAVAILABLE');

    const row = await rowByCart(sale.cartId);
    expect(row?.status).toBe('error');
    expect(row?.error_message).toContain('FACTURAPI_USER_KEY');
    expect(row?.uuid_folio).toBeNull();
    // The configured PAC was never asked: nothing could have been stamped.
    expect(pac.stampCalls).toHaveLength(0);
  });

  // ── The acceptance sentence: a cancelled sale cancels its fiscal document ──

  it('cancelling a committed sale cancels its fiscal document in the same transaction', async () => {
    const sale = await seedCommittedSale();
    const stamped = await stamp(sale.cartId);
    pac.reset();

    const result = await cancelInCommandTransaction(async (client) => {
      const cancelled = await fiscal.cancelForSale(client, cancellation(sale.cartId));
      // INSIDE the caller's transaction, before it commits.
      const inside = await rowByCartIn(client, sale.cartId);
      expect(inside?.status).toBe('cancelled');
      expect(inside?.cancellation_motive).toBe('02');
      expect(inside?.cancelled_at).not.toBeNull();
      return cancelled;
    });

    expect(result).toEqual({
      documentFound: true,
      documentId: stamped.document.id,
      status: 'cancelled',
    });
    expect(pac.cancelCalls).toHaveLength(1);
    expect(pac.cancelCalls[0]?.providerDocumentId).toBe(stamped.document.providerDocumentId);

    // AND AFTER COMMIT, read back from SQL rather than from the return value.
    const after = await rowByCart(sale.cartId);
    expect(after?.status).toBe('cancelled');
    expect(after?.cancellation_motive).toBe('02');
    expect(after?.cancellation_reason).toBe('Venta cancelada en caja.');
    expect(after?.cancelled_at).not.toBeNull();
    // THE FOLIO IS KEPT, and it is the point of the constraint's corrected shape. The UUID
    // is the SAT's folio fiscal: it identifies WHICH document was cancelled, and an auditor,
    // a credit note and any later reference to that cancellation all cite it. The first
    // draft of `fiscal_document_stamped_shape` made "stamped" a biconditional, which forced
    // a writer cancelling a stamped document to NULL the folio — erasing exactly the fact
    // the cancellation is about. Clearing it would answer "which document did we cancel?"
    // with silence, so the shape now says a cancelled document MAY carry the pair.
    expect(after?.uuid_folio).toBe(stamped.document.uuid);
    expect(after?.stamped_at).not.toBeNull();
    expect(after?.provider_document_id).toBe(stamped.document.providerDocumentId);
  });

  it('a ROLLBACK of the sale-cancel leaves the document stamped, so no half-done state exists', async () => {
    const sale = await seedCommittedSale();
    await stamp(sale.cartId);
    pac.reset();

    class RollbackProbe extends Error {}

    await expect(
      cancelInCommandTransaction(async (client) => {
        await fiscal.cancelForSale(client, cancellation(sale.cartId));
        const inside = await rowByCartIn(client, sale.cartId);
        expect(inside?.status).toBe('cancelled');
        throw new RollbackProbe();
      }),
    ).rejects.toBeInstanceOf(RollbackProbe);

    expect(pac.cancelCalls).toHaveLength(1);
    const after = await rowByCart(sale.cartId);
    expect(after?.status).toBe('stamped');
    expect(after?.uuid_folio).not.toBeNull();
    expect(after?.cancelled_at).toBeNull();
    expect(after?.cancellation_motive).toBeNull();
  });

  it('a PAC refusal on cancellation THROWS and leaves the document stamped', async () => {
    const sale = await seedCommittedSale();
    await stamp(sale.cartId);
    pac.reset();
    pac.script(['refuse']);

    const refused = await refusal(() =>
      cancelInCommandTransaction((client) =>
        fiscal.cancelForSale(client, cancellation(sale.cartId)),
      ),
    );
    expect(refused.status).toBe(409);
    expect(refused.code).toBe('FISCAL_CANCELLATION_REFUSED');
    expect(pac.cancelCalls).toHaveLength(1);

    const after = await rowByCart(sale.cartId);
    expect(after?.status).toBe('stamped');
  });

  it('a sale with no fiscal document cancels cleanly and writes nothing', async () => {
    const sale = await seedCommittedSale();

    const result = await cancelInCommandTransaction((client) =>
      fiscal.cancelForSale(client, cancellation(sale.cartId)),
    );

    expect(result).toEqual({ documentFound: false, documentId: null, status: null });
    expect(pac.cancelCalls).toHaveLength(0);
    const { rows } = await pg.tquery<{ n: number }>(
      MERCHANT,
      `SELECT count(*)::int AS n FROM merchant.fiscal_document
        WHERE merchant_id=$1::uuid AND order_id=$2::uuid`,
      [MERCHANT, sale.orderId],
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('a pending document cancels LOCALLY, with no PAC call', async () => {
    const sale = await seedCommittedSale();
    await seedPendingDocument(sale, { deadlineAt: new Date(Date.now() + 2 * HOUR_MS) });

    const result = await cancelInCommandTransaction((client) =>
      fiscal.cancelForSale(client, cancellation(sale.cartId, { motive: '03' })),
    );

    expect(result.status).toBe('cancelled');
    expect(pac.cancelCalls).toHaveLength(0);
    const after = await rowByCart(sale.cartId);
    expect(after?.status).toBe('cancelled');
    expect(after?.cancellation_motive).toBe('03');
    expect(after?.cancelled_at).not.toBeNull();
  });

  it('an already-cancelled document is returned unchanged and the PAC is not asked again', async () => {
    const sale = await seedCommittedSale();
    await stamp(sale.cartId);
    await cancelInCommandTransaction((client) =>
      fiscal.cancelForSale(client, cancellation(sale.cartId)),
    );
    const cancelsAfterFirst = pac.cancelCalls.length;

    const again = await cancelInCommandTransaction((client) =>
      fiscal.cancelForSale(client, cancellation(sale.cartId)),
    );

    expect(cancelsAfterFirst).toBe(1);
    expect(again.status).toBe('cancelled');
    expect(pac.cancelCalls).toHaveLength(cancelsAfterFirst);
  });

  // ── The owner's deadline view ───────────────────────────────────────────

  it('the deadline view counts a document past its deadline, and period_close runs from the period close', async () => {
    const before = await counts();

    // (a) A document whose clock has already run out.
    const overdue = await seedCommittedSale();
    await seedPendingDocument(overdue, { deadlineAt: new Date(Date.now() - HOUR_MS) });

    // (b) A document still inside its clock, so the two halves of the split are both
    // observed rather than inferred from a zero.
    const open = await seedCommittedSale();
    await seedPendingDocument(open, { deadlineAt: new Date(Date.now() + 2 * HOUR_MS) });

    // (c) A factura-global document: its deadline is measured from the PERIOD CLOSE,
    // not from the operation.
    const globalSale = await seedCommittedSale();
    const stamped = await stamp(globalSale.cartId, { deadlineKind: 'period_close' });
    const row = await rowByCart(globalSale.cartId);
    if (!row) throw new Error('the period-close document was not found');
    expect(row.deadline_kind).toBe('period_close');

    const after = await counts();
    expect(after.pastDeadline).toBe(before.pastDeadline + 1);
    expect(after.withinDeadline).toBe(before.withinDeadline + 1);
    // The STAMPED period_close document is NOT in either deadline count: it is filed,
    // so it has no clock left to run. The three documents move the four statuses
    // exactly as the counts model says they must.
    expect(after.total).toBe(before.total + 3);
    expect(after.stamped).toBe(before.stamped + 1);
    expect(after.pending).toBe(before.pending + 2);
    expect(stamped.document.deadlineKind).toBe('period_close');

    const deadline = new Date(row.deadline_at).getTime();
    const created = new Date(row.created_at).getTime();
    // Measured from the period close, so it is strictly LATER than operation + 24h.
    expect(deadline - created).toBeGreaterThan(24 * HOUR_MS);

    const periodClose = await pg.tquery<{ period_close_at: Date }>(
      MERCHANT,
      `SELECT (((((now() at time zone m.timezone) - m.business_day_start::interval)::date + 1)::timestamp
                 + m.business_day_start::interval) at time zone m.timezone) AS period_close_at
         FROM merchant.merchant m WHERE m.id=$1::uuid`,
      [MERCHANT],
    );
    const close = new Date(periodClose.rows[0].period_close_at).getTime();
    expect(deadline - close).toBe(24 * HOUR_MS);
    expect(close).toBeGreaterThan(created);
  });

  it('the owner sees whether a cancellation needs the customer acceptance', async () => {
    // A café ticket: cancelling it needs no acceptance from the customer.
    const small = await seedCommittedSale({ totalMinorUnits: 9_000 });
    await stamp(small.cartId);
    // Over $1,000 MXN: the issuer needs the receiver's acceptance to cancel it.
    const large = await seedCommittedSale({ totalMinorUnits: 150_000 });
    await stamp(large.cartId);

    const view = await list({ status: 'stamped' });
    const smallDocument = view.documents.find((document) => document.saleId === small.cartId);
    const largeDocument = view.documents.find((document) => document.saleId === large.cartId);

    expect(smallDocument?.needsReceiverAcceptance).toBe(false);
    expect(largeDocument?.needsReceiverAcceptance).toBe(true);
    expect(view.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(view.counts.total).toBeGreaterThanOrEqual(2);
  });

  // ── Tenant isolation ────────────────────────────────────────────────────

  it('another merchant document is not visible through either read', async () => {
    const neighbourSale = await seedCommittedSale({
      merchantId: NEIGHBOUR,
      locationId: NEIGHBOUR_LOCATION,
      operatorSessionId: NEIGHBOUR_OPERATOR_SESSION,
      operatorUserId: NEIGHBOUR_USER,
    });
    const theirsDocument = await pg.runWithMerchant(
      NEIGHBOUR,
      NEIGHBOUR_USER,
      (client) =>
        repo.insertPending(client, {
          merchantId: NEIGHBOUR,
          locationId: NEIGHBOUR_LOCATION,
          orderId: neighbourSale.orderId,
          receiptSnapshotId: neighbourSale.receiptSnapshotId,
          kind: 'nominative',
          totalMinorUnits: 4_500,
          currency: 'MXN',
          receptorRfc: null,
          receptorName: null,
          receptorPostalCode: null,
          regimenFiscal: null,
          usoCfdi: null,
          paymentForm: null,
          paymentMethod: null,
          deadlineAt: new Date(Date.now() + 3 * HOUR_MS),
          deadlineKind: 'operation',
          commandId: null,
          idempotencyKey: null,
        }),
      NEIGHBOUR_LOCATION,
    );

    // The neighbour CAN read it: the row exists, so the nulls below are isolation
    // rather than absence.
    const theirs = await pg.runWithMerchant(
      NEIGHBOUR,
      NEIGHBOUR_USER,
      (client) => repo.readForSale(client, NEIGHBOUR, neighbourSale.cartId),
      NEIGHBOUR_LOCATION,
    );
    expect(theirs?.saleId).toBe(neighbourSale.cartId);
    expect(theirs?.id).toBe(theirsDocument.id);

    const theirsFromMerchant = await pg.runWithMerchant(
      MERCHANT,
      USER,
      async (client) => ({
        bySale: await repo.readForSale(client, MERCHANT, neighbourSale.cartId),
        byId: await repo.readById(client, MERCHANT, theirsDocument.id),
      }),
      LOCATION,
    );
    expect(theirsFromMerchant.bySale).toBeNull();
    expect(theirsFromMerchant.byId).toBeNull();

    const view = await list();
    expect(view.documents.some((document) => document.id === theirsDocument.id)).toBe(false);
  });
});

/**
 * The real PAC's availability CONTRACT, asserted without a database and without a
 * network: the shipped adapter is the first credentialled PAC, and a deployment that
 * holds none must say WHICH variable is missing rather than pretend to stamp.
 */
describe('the Facturapi PAC, before any call reaches it', () => {
  const configFor = (env: Record<string, string | undefined>) =>
    ({ get: (key: string) => env[key] }) as unknown as ConfigService<AppConfig, true>;

  const request: PacStampRequest = {
    saleId: '7e000000-0000-4000-8000-0000000000ff',
    receptor: RECEPTOR,
    uso: 'G03',
    paymentForm: '01',
    paymentMethod: 'PUE',
    totalMinorUnits: 9_000,
    currency: 'MXN',
    description: 'Venta F-000001',
  };

  const adapter = {} as unknown as FacturapiAdapter;

  it('names the missing variable and refuses both calls instead of pretending', async () => {
    const unconfigured = new FacturapiPacProvider(configFor({}), adapter);
    expect(unconfigured.available).toBe(false);
    expect(unconfigured.unavailableReason).toContain('FACTURAPI_USER_KEY');
    await expect(unconfigured.stamp(request, null)).rejects.toBeInstanceOf(PacUnavailableError);
    await expect(
      unconfigured.cancel({ providerDocumentId: 'x', motive: '02', substitutionUuid: null }, null),
    ).rejects.toBeInstanceOf(PacUnavailableError);

    // The OTHER half of "either one": a user key without the Organization secret is
    // still unable to stamp, and the sentence names the second variable.
    const halfConfigured = new FacturapiPacProvider(
      configFor({ FACTURAPI_USER_KEY: 'uk_test' }),
      adapter,
    );
    expect(halfConfigured.available).toBe(false);
    expect(halfConfigured.unavailableReason).toContain('FACTURAPI_ORGANIZATION_SECRET');
    await expect(halfConfigured.stamp(request, null)).rejects.toBeInstanceOf(PacUnavailableError);
  });
});
