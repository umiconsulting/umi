/**
 * #252 · acceptance 1.8 — a bound web/delivery order settles in one POS sale.
 *
 * THE SENTENCE UNDER TEST, in order:
 *
 *   bind a web/delivery order to a POS cart → ring it → fire it → check out.
 *
 * The origin order already owns the kitchen ticket. The POS cart is a settlement
 * surface: fire answers `already_prepared` and writes nothing, and the checkout
 * writes the POS order with `projectKitchen:false` so the origin ticket is the
 * only ticket. The sale links the origin, and the origin closes.
 *
 * WHAT IS ASSERTED WITH ROWS, NOT WITH RETURN VALUES:
 *
 *   · one POS order for the cart;
 *   · one kitchen ticket for the origin, and no ticket for the POS order;
 *   · one `pos_committed_sale`, linked to the origin with channel `web`;
 *   · fire on the bound cart answers `already_prepared`, writes no order and
 *     leaves `fired_order_id` null;
 *   · the checkout calls `writeOrder` with `projectKitchen:false`;
 *   · an origin mismatch is refused before a tender fact exists;
 *   · a partial/unknown terminal payment leaves a financial hold that the
 *     offline replay classifies as `payment_unresolved` and does not resolve.
 *
 * A RETURN VALUE CAN LIE ABOUT A WRITE. `already_prepared` is checked against
 * `merchant.customer_order`, `merchant.kitchen_order` and
 * `merchant.pos_committed_sale` so a service that answered `already_prepared`
 * while writing a second order still fails this file.
 *
 * FIXTURE. The file is self-seeding: it creates its own merchant, branch,
 * product, station, route, tills and orders under a per-run id prefix, so a
 * second run against the same database is green rather than a collision. It
 * needs a DISPOSABLE build-v3 database:
 *
 *     createdb <db> && db/00_run.sh <db> && db/migrate.sh <db>
 *     DATABASE_URL_APP=postgresql://api_login:harness_api@host:port/<db> \
 *     DATABASE_URL_WORKER=postgresql://worker_login:harness_worker@host:port/<db> \
 *       npx vitest run --config vitest.integration.config.ts \
 *       src/modules/pos-checkout/checkout-bound-settlement.integration.ts
 */

import { createHash, randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CheckoutCommand, OfflineCommand } from '@umi/contract';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import { writeOrder } from '../../shared/orders/order-writer';
import type { AuthUser } from '../auth/auth.types';
import { canonicalJson } from '../integrity/canonical-json';
import { IntegrityRepository } from '../integrity/integrity.repository';
import { IntegrityService } from '../integrity/integrity.service';
import type { KdsService } from '../kds/kds.service';
import { PosCartRepository } from '../pos-cart/pos-cart.repository';
import { PosCartService } from '../pos-cart/pos-cart.service';
import { PosOfflineRepository } from '../pos-offline/pos-offline.repository';
import { PosOfflineService } from '../pos-offline/pos-offline.service';
import { PosCheckoutRepository } from './pos-checkout.repository';
import { PosCheckoutService } from './pos-checkout.service';

/**
 * Spy on the ONE order writer, because `projectKitchen:false` is a value the
 * checkout passes, not a row it leaves behind. With the origin's ticket already
 * present, the projector is idempotent — so the flag is invisible in the rows
 * and must be read from the call itself.
 */
vi.mock('../../shared/orders/order-writer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/orders/order-writer')>();
  return { ...actual, writeOrder: vi.fn(actual.writeOrder) };
});

const APP_DSN = process.env.DATABASE_URL_APP;
const WORKER_DSN = process.env.DATABASE_URL_WORKER;

const JWT_SECRET = 'bound-settlement-harness-secret-000000';

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
  `7c${RUN}-0000-4000-8000-${suffix.toString(16).padStart(12, '0')}`;

const MERCHANT = fixtureId(0xa1);
const LOCATION = fixtureId(0xa2);
const PRODUCT = fixtureId(0xb1);
const STATION = fixtureId(0xb2);

/** MXN 45.00, tax-exclusive at 0 basis points, so the money assertion is an amount. */
const UNIT_PRICE = 4_500;

const PERMISSIONS = [
  'cart.write',
  'order.fire',
  'checkout.commit',
  'checkout.terminal.confirm',
  'offline.replay',
];
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

function tillSpec(name: string, base: number): Till {
  const userId = fixtureId(base + 1);
  const sessionId = fixtureId(base + 2);
  const operatorSessionId = fixtureId(base + 3);
  const deviceId = fixtureId(base + 4);
  return {
    name,
    userId,
    staffId: fixtureId(base + 5),
    sessionId,
    operatorSessionId,
    deviceId,
    user: {
      id: userId,
      sessionId,
      deviceId,
      email: `${name.toLowerCase().replace(/\s+/g, '-')}@bound-settlement.test`,
      displayName: name,
    } as AuthUser,
  };
}

const TILL_MAIN = tillSpec('Caja liquidacion', 0x100);
const TILL_MISMATCH = tillSpec('Caja diferencia', 0x200);
const TILL_HOLD = tillSpec('Caja retencion', 0x300);

const TILLS = [TILL_MAIN, TILL_MISMATCH, TILL_HOLD];

const money = (minorUnits: number) => ({ minorUnits, currency: 'MXN' });

describe('bound settlement · acceptance 1.8, bind → ring → fire → checkout', () => {
  let pg: PgService;
  let carts: PosCartService;
  let checkout: PosCheckoutService;
  let offline: PosOfflineService;

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

  const count = async (sql: string, params: unknown[] = []): Promise<number> => {
    const { rows } = await pg.query<{ count: string }>(sql, params);
    return Number(rows[0]?.count ?? 0);
  };

  /**
   * Write a web/delivery order through the product's one order writer. It
   * projects the origin's kitchen ticket because the product routes to an
   * active station, which is the exact state the duplicate-preparation bug
   * started from.
   */
  const webOrder = async (reference: string, quantity: number) => {
    const written = await pg.runWithMerchant(
      MERCHANT,
      null,
      (client) =>
        writeOrder(client, {
          merchantId: MERCHANT,
          locationId: LOCATION,
          source: 'web',
          fulfillmentType: 'delivery',
          externalRef: reference,
          lines: [
            {
              productId: PRODUCT,
              name: 'Cafe Americano',
              variantName: null,
              quantity,
              courseNumber: 1,
              unitPriceCents: UNIT_PRICE,
              modifiers: [],
            },
          ],
        }),
      LOCATION,
    );
    expect(written.created).toBe(true);
    return written.orderId;
  };

  const createCart = async (till: Till) =>
    scoped(till, () =>
      carts.create(till.user, MERCHANT, {
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
        idempotencyKey: randomUUID(),
      }),
    );

  const bind = async (till: Till, cart: { id: string; version: number }, originOrderId: string) => {
    const bound = await scoped(till, () =>
      carts.bindOrigin(till.user, MERCHANT, {
        cartId: cart.id,
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
        originOrderId,
        expectedVersion: cart.version,
        idempotencyKey: randomUUID(),
      }),
    );
    expect(bound).not.toBeNull();
    expect(bound.originOrderId).toBe(originOrderId);
    expect(bound.originChannel).toBe('web');
    return bound;
  };

  const ring = async (till: Till, cart: { id: string; version: number }, quantity = 1) => {
    const added = await scoped(till, () =>
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
    expect(added).not.toBeNull();
    expect(added.items).toHaveLength(1);
    expect(added.items[0]?.quantity).toBe(quantity);
    return added;
  };

  const fire = (till: Till, cart: { id: string; version: number }) =>
    scoped(till, () =>
      carts.fire(till.user, MERCHANT, {
        cartId: cart.id,
        locationId: LOCATION,
        operatorSessionId: till.operatorSessionId,
        expectedVersion: cart.version,
        idempotencyKey: randomUUID(),
      }),
    );

  const command = (
    till: Till,
    cart: { id: string; version: number },
    tender: { id: string; amount: number; status: 'confirmed_success' | 'outcome_unknown' },
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
    tenderDrafts: [
      {
        id: tender.id,
        type: 'manual_terminal',
        amount: money(tender.amount),
        amountReceived: null,
        status: tender.status,
        correlationId: null,
      },
    ],
    tipDraft: null,
    discountDrafts: [],
    approvalIds: [],
    receiptDelivery: { destination: 'display', channel: null, customerContactId: null },
    customerValue: null,
    ...overrides,
  });

  const runCheckout = (till: Till, dto: CheckoutCommand) =>
    scoped(till, () => checkout.checkout(till.user, MERCHANT, dto));

  beforeAll(async () => {
    if (!APP_DSN || !WORKER_DSN) {
      throw new Error(
        'Set DATABASE_URL_APP and DATABASE_URL_WORKER to a DISPOSABLE build-v3 database.',
      );
    }
    pg = new PgService(makeConfig());
    await pg.onModuleInit();

    const integrity = new IntegrityService(new IntegrityRepository(pg));
    const cartRepository = new PosCartRepository(pg);
    carts = new PosCartService(cartRepository, integrity);
    checkout = new PosCheckoutService(new PosCheckoutRepository(pg), cartRepository, integrity);
    offline = new PosOfflineService(new PosOfflineRepository(pg), checkout, carts, {
      commandForReplay: async () => undefined,
    } as unknown as KdsService);

    await pg.query(
      `INSERT INTO merchant.merchant (id,name,handle,currency,timezone)
       VALUES ($1::uuid,'Bound Settlement Harness',$2,'MXN','America/Mexico_City')
       ON CONFLICT (id) DO NOTHING`,
      [MERCHANT, `bound-settlement-${RUN}`],
    );
    await pg.query(
      `INSERT INTO merchant.location (id,merchant_id,name)
       VALUES ($1::uuid,$2::uuid,'Mostrador') ON CONFLICT (id) DO NOTHING`,
      [LOCATION, MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.product
         (id,merchant_id,name,price,tax_rate_basis_points,active,requires_preparation)
       VALUES ($1::uuid,$2::uuid,'Cafe Americano',$3,0,true,true)
       ON CONFLICT (id) DO NOTHING`,
      [PRODUCT, MERCHANT, UNIT_PRICE],
    );
    await pg.query(
      `INSERT INTO merchant.station (id,merchant_id,location_id,key,name,status)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'cocina','Cocina','active')
       ON CONFLICT (id) DO NOTHING`,
      [STATION, MERCHANT, LOCATION],
    );
    await pg.query(
      `INSERT INTO merchant.kitchen_route
         (merchant_id,location_id,station_id,product_id,route_priority,active,
          requires_preparation)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,10,true,true)
       ON CONFLICT DO NOTHING`,
      [MERCHANT, LOCATION, STATION, PRODUCT],
    );
    await pg.query(
      `INSERT INTO merchant.pos_checkout_policy
         (merchant_id,location_id,version,manual_terminal_enabled,mixed_tender_enabled,
          maximum_tender_lines,manual_terminal_approval_threshold,tips_enabled,
          maximum_tip_minor_units,maximum_discount_basis_points,maximum_discount_minor_units,
          cashier_discount_threshold,currency)
       VALUES ($1::uuid,$2::uuid,'bound-settlement',true,true,8,0,false,0,0,0,0,'MXN')
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
           state='active',ended_at=null,expires_at=excluded.expires_at`,
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

  it('settles a bound delivery order with one POS order, one kitchen ticket and one sale', async () => {
    const originOrderId = await webOrder(`WEB-${RUN}-MAIN`, 1);

    // The origin already owns the only kitchen ticket.
    expect(
      await count(
        `SELECT count(*)::text AS count FROM merchant.kitchen_order
          WHERE merchant_id=$1::uuid AND source_order_id=$2::uuid`,
        [MERCHANT, originOrderId],
      ),
    ).toBe(1);

    const cart0 = await createCart(TILL_MAIN);
    const bound = await bind(TILL_MAIN, cart0, originOrderId);
    expect(bound.version).toBeGreaterThan(cart0.version);
    const rung = await ring(TILL_MAIN, bound);
    expect(rung.totals.grandTotal.minorUnits).toBe(UNIT_PRICE);

    const writeOrderMock = vi.mocked(writeOrder);
    writeOrderMock.mockClear();

    const fired = await fire(TILL_MAIN, rung);

    // Fire on a bound cart is a success that writes nothing.
    expect(fired.state).toBe('already_prepared');
    expect(fired.orderId).toBe(originOrderId);
    expect(fired.lineCount).toBe(1);
    expect(writeOrderMock).not.toHaveBeenCalled();
    expect(
      await count(
        `SELECT count(*)::text AS count FROM merchant.customer_order
          WHERE merchant_id=$1::uuid AND external_ref=$2`,
        [MERCHANT, `pos-cart:${rung.id}`],
      ),
    ).toBe(0);
    const firedCart = await pg.query<{ firedOrderId: string | null; originOrderId: string | null }>(
      `SELECT fired_order_id::text AS "firedOrderId",
              origin_order_id::text AS "originOrderId"
         FROM merchant.pos_cart WHERE id=$1::uuid`,
      [rung.id],
    );
    expect(firedCart.rows[0]).toEqual({ firedOrderId: null, originOrderId });

    const tenderId = randomUUID();
    // Fire on a bound cart does not advance the cart version; the checkout
    // command must still name the version the cart carries.
    const settlement = { id: rung.id, version: fired.cartVersion };
    const preview = await runCheckout(
      TILL_MAIN,
      command(TILL_MAIN, settlement, {
        id: tenderId,
        amount: UNIT_PRICE,
        status: 'confirmed_success',
      }),
    );
    expect(preview.status).toBe('confirmation_required');

    writeOrderMock.mockClear();
    const dto = command(
      TILL_MAIN,
      settlement,
      { id: tenderId, amount: UNIT_PRICE, status: 'confirmed_success' },
      {
        totalsFingerprint: preview.confirmation.fingerprint,
        commandId: randomUUID(),
        idempotencyKey: randomUUID(),
      },
    );
    const result = await runCheckout(TILL_MAIN, dto);
    expect(result.status, JSON.stringify(result.failure)).toBe('completed');
    expect(result.sale?.status).toBe('committed');

    // The checkout wrote the POS order once, and passed projectKitchen:false.
    expect(writeOrderMock).toHaveBeenCalledTimes(1);
    expect(writeOrderMock.mock.calls[0]?.[1]).toMatchObject({
      merchantId: MERCHANT,
      source: 'pos',
      externalRef: `pos-cart:${rung.id}`,
      projectKitchen: false,
    });

    const posOrderId = result.sale!.orderId;
    expect(
      await count(
        `SELECT count(*)::text AS count FROM merchant.customer_order
          WHERE merchant_id=$1::uuid AND external_ref=$2`,
        [MERCHANT, `pos-cart:${rung.id}`],
      ),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*)::text AS count FROM merchant.pos_committed_sale
          WHERE merchant_id=$1::uuid AND cart_id=$2::uuid`,
        [MERCHANT, rung.id],
      ),
    ).toBe(1);
    const sale = await pg.query<{
      orderId: string;
      originOrderId: string | null;
      originChannel: string | null;
    }>(
      `SELECT order_id::text AS "orderId",origin_order_id::text AS "originOrderId",
              origin_channel AS "originChannel"
         FROM merchant.pos_committed_sale
        WHERE merchant_id=$1::uuid AND cart_id=$2::uuid`,
      [MERCHANT, rung.id],
    );
    expect(sale.rows[0]).toEqual({
      orderId: posOrderId,
      originOrderId,
      originChannel: 'web',
    });

    // One kitchen ticket exists for this merchant and it belongs to the origin.
    expect(
      await count(
        `SELECT count(*)::text AS count FROM merchant.kitchen_order
          WHERE merchant_id=$1::uuid`,
        [MERCHANT],
      ),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*)::text AS count FROM merchant.kitchen_order
          WHERE merchant_id=$1::uuid AND source_order_id=$2::uuid`,
        [MERCHANT, originOrderId],
      ),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*)::text AS count FROM merchant.kitchen_order
          WHERE merchant_id=$1::uuid AND source_order_id=$2::uuid`,
        [MERCHANT, posOrderId],
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*)::text AS count FROM merchant.kitchen_order_item
          WHERE merchant_id=$1::uuid AND source_order_id=$2::uuid`,
        [MERCHANT, originOrderId],
      ),
    ).toBe(1);

    // The sale closed the origin, and the money rows exist once.
    const origin = await pg.query<{ status: string }>(
      `SELECT status FROM merchant.customer_order WHERE id=$1::uuid`,
      [originOrderId],
    );
    expect(origin.rows[0]?.status).toBe('completed');
    expect(
      await count(`SELECT count(*)::text AS count FROM merchant.payment WHERE order_id=$1::uuid`, [
        posOrderId,
      ]),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*)::text AS count FROM merchant.receipt_snapshot WHERE order_id=$1::uuid`,
        [posOrderId],
      ),
    ).toBe(1);
    const closed = await pg.query<{ status: string }>(
      `SELECT status FROM merchant.pos_cart WHERE id=$1::uuid`,
      [rung.id],
    );
    expect(closed.rows[0]?.status).toBe('committed');
  });

  it('refuses an origin mismatch before any tender fact exists', async () => {
    const originOrderId = await webOrder(`WEB-${RUN}-MISMATCH`, 2);

    const cart0 = await createCart(TILL_MISMATCH);
    const bound = await bind(TILL_MISMATCH, cart0, originOrderId);
    // One line, quantity one: the origin has quantity two, so the settlement
    // no longer matches what the customer ordered.
    const rung = await ring(TILL_MISMATCH, bound, 1);
    await fire(TILL_MISMATCH, rung);

    const tenderId = randomUUID();
    const preview = await runCheckout(
      TILL_MISMATCH,
      command(TILL_MISMATCH, rung, {
        id: tenderId,
        amount: UNIT_PRICE,
        status: 'confirmed_success',
      }),
    );
    expect(preview.status).toBe('confirmation_required');

    const refusal = await runCheckout(
      TILL_MISMATCH,
      command(
        TILL_MISMATCH,
        rung,
        { id: tenderId, amount: UNIT_PRICE, status: 'confirmed_success' },
        {
          totalsFingerprint: preview.confirmation.fingerprint,
          commandId: randomUUID(),
          idempotencyKey: randomUUID(),
        },
      ),
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).getResponse()).toMatchObject({
      code: 'CART_ORIGIN_MISMATCH',
    });
    // Refused before tender: no attempt, no tender fact, no sale.
    expect(
      await count(
        `SELECT count(*)::text AS count FROM merchant.pos_payment_attempt
          WHERE merchant_id=$1::uuid AND cart_id=$2::uuid`,
        [MERCHANT, rung.id],
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*)::text AS count FROM merchant.pos_tender_fact
          WHERE merchant_id=$1::uuid AND cart_id=$2::uuid`,
        [MERCHANT, rung.id],
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*)::text AS count FROM merchant.pos_committed_sale
          WHERE merchant_id=$1::uuid AND cart_id=$2::uuid`,
        [MERCHANT, rung.id],
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*)::text AS count FROM merchant.customer_order
          WHERE merchant_id=$1::uuid AND external_ref=$2`,
        [MERCHANT, `pos-cart:${rung.id}`],
      ),
    ).toBe(0);
  });

  it('holds a partial payment as payment_unresolved and does not auto-resolve it', async () => {
    const originOrderId = await webOrder(`WEB-${RUN}-HOLD`, 1);

    const cart0 = await createCart(TILL_HOLD);
    const bound = await bind(TILL_HOLD, cart0, originOrderId);
    const rung = await ring(TILL_HOLD, bound);
    await fire(TILL_HOLD, rung);

    // The terminal answered nothing: half the amount, outcome unknown. This is
    // the partial/failed payment the operator must resolve by hand.
    const tenderId = randomUUID();
    const partial = await runCheckout(
      TILL_HOLD,
      command(TILL_HOLD, rung, {
        id: tenderId,
        amount: Math.floor(UNIT_PRICE / 2),
        status: 'outcome_unknown',
      }),
    );
    expect(partial.status).toBe('payment_unknown');
    expect(partial.failure?.code).toBe('TERMINAL_OUTCOME_UNKNOWN');
    expect(partial.sale).toBeNull();

    const attempts = await pg.query<{ status: string; amount: string }>(
      `SELECT status,amount_minor_units::text AS amount
         FROM merchant.pos_payment_attempt
        WHERE merchant_id=$1::uuid AND cart_id=$2::uuid`,
      [MERCHANT, rung.id],
    );
    expect(attempts.rows).toHaveLength(1);
    expect(attempts.rows[0]).toMatchObject({ status: 'unknown', amount: '2250' });

    // A financial hold refuses every later cart mutation, through the real
    // service, with the code the offline replay classifies as payment_unresolved.
    const held = await scoped(TILL_HOLD, () =>
      carts.add(TILL_HOLD.user, MERCHANT, {
        cartId: rung.id,
        locationId: LOCATION,
        operatorSessionId: TILL_HOLD.operatorSessionId,
        productId: PRODUCT,
        variantId: null,
        modifierSelections: [],
        quantity: 1,
        courseNumber: 1,
        note: null,
        expectedVersion: rung.version,
        idempotencyKey: randomUUID(),
      }),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(held).toBeInstanceOf(ConflictException);
    expect((held as ConflictException).getResponse()).toMatchObject({
      code: 'CART_PAYMENT_UNRESOLVED',
    });

    // The offline replay must classify that refusal as payment_unresolved and
    // block the account stream, not retry it into a sale.
    const unsigned = {
      commandId: randomUUID(),
      provisionalId: rung.id,
      deviceId: TILL_HOLD.deviceId,
      deviceCredentialVersion: 1,
      deviceSequence: 1,
      merchantId: MERCHANT,
      locationId: LOCATION,
      operatorSessionId: TILL_HOLD.operatorSessionId,
      commandType: 'pos.cart.line.add' as const,
      idempotencyKey: randomUUID(),
      contractVersion: '2.56.0',
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      payload: {
        cartId: rung.id,
        locationId: LOCATION,
        operatorSessionId: TILL_HOLD.operatorSessionId,
        productId: PRODUCT,
        variantId: null,
        modifierSelections: [],
        quantity: 1,
        courseNumber: 1,
        note: null,
      },
    };
    const commandWithFingerprint: OfflineCommand = {
      ...unsigned,
      fingerprint: createHash('sha256').update(canonicalJson(unsigned)).digest('hex'),
    };
    const replay = await scoped(TILL_HOLD, () =>
      offline.batch(TILL_HOLD.user, MERCHANT, {
        replaySessionId: randomUUID(),
        commands: [commandWithFingerprint],
      }),
    );
    expect(replay.results).toHaveLength(1);
    expect(replay.results[0]).toMatchObject({
      status: 'conflict',
      failure: {
        classification: 'payment_unresolved',
        guidanceCode: 'cart_payment_unresolved',
        retryable: false,
      },
    });

    // Nothing auto-resolved: the attempt is still unknown, no sale, no order.
    const after = await pg.query<{ status: string }>(
      `SELECT status FROM merchant.pos_payment_attempt
        WHERE merchant_id=$1::uuid AND cart_id=$2::uuid`,
      [MERCHANT, rung.id],
    );
    expect(after.rows.map((row) => row.status)).toEqual(['unknown']);
    expect(
      await count(
        `SELECT count(*)::text AS count FROM merchant.pos_committed_sale
          WHERE merchant_id=$1::uuid AND cart_id=$2::uuid`,
        [MERCHANT, rung.id],
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*)::text AS count FROM merchant.customer_order
          WHERE merchant_id=$1::uuid AND external_ref=$2`,
        [MERCHANT, `pos-cart:${rung.id}`],
      ),
    ).toBe(0);
  });
});
