import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { CartLineInput } from '@umi/contract';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import { PosCartRepository } from './pos-cart.repository';

// Use a disposable build-v3 database with forward migrations through 021.
describe('pending second round edits preserve sent commercial and kitchen lines', () => {
  const merchant = randomUUID(),
    location = randomUUID(),
    user = randomUUID(),
    device = randomUUID();
  const durable = randomUUID(),
    operator = randomUUID(),
    product = randomUUID(),
    alternative = randomUUID(),
    station = randomUUID();
  let pg: PgService;
  let repo: PosCartRepository;
  let cartId: string;
  let sentLine: string;
  let orderId: string;
  let kitchenId: string;
  const scoped = <T>(work: (client: PoolClient) => Promise<T>) =>
    runWithRequestContext(
      {
        merchantId: merchant,
        locationId: location,
        deviceId: device,
        userId: user,
        requestId: randomUUID(),
      },
      () => pg.runWithMerchant(merchant, user, work, location),
    );
  const cart = async () => (await repo.readAccount(merchant, location, cartId))!;
  const input = (
    expectedVersion: number,
    productId: string = product,
    quantity = 1,
  ): CartLineInput => ({
    locationId: location,
    operatorSessionId: operator,
    cartId,
    expectedVersion,
    idempotencyKey: randomUUID(),
    productId,
    variantId: null,
    modifierSelections: [],
    note: null,
    quantity,
    courseNumber: 1,
  });
  const add = async (productId = product, key = 'a'.repeat(64)) => {
    const current = await cart();
    const dto = input(current.version, productId);
    await scoped(async (client) => {
      const priced = (await repo.price(client, merchant, location, dto))!;
      expect(
        await repo.addOrMerge(client, merchant, cartId, current.version, key, dto, priced),
      ).toBe(true);
    });
    return (await cart()).items.find((line) => line.fired !== true)!;
  };
  beforeAll(async () => {
    if (
      !process.env.DATABASE_URL_APP ||
      !process.env.DATABASE_URL_WORKER ||
      !new URL(process.env.DATABASE_URL_WORKER).pathname.includes('verify')
    )
      throw new Error('Set both database URLs to a disposable verification database.');
    const values = { ...process.env };
    pg = new PgService({
      get: (key: string) => values[key as keyof typeof values],
    } as unknown as ConfigService<AppConfig, true>);
    await pg.onModuleInit();
    repo = new PosCartRepository(pg);
    await pg.query(
      `INSERT INTO merchant.merchant(id,name,handle) VALUES ($1,'Round edit test',$2)`,
      [merchant, `round-${merchant}`],
    );
    await pg.query(`INSERT INTO merchant.location(id,merchant_id,name) VALUES ($1,$2,'Room')`, [
      location,
      merchant,
    ]);
    await pg.query(`INSERT INTO umi."user"(id,full_name) VALUES ($1,'Operator')`, [user]);
    const staff = randomUUID();
    await pg.query(
      `INSERT INTO merchant.staff(id,merchant_id,user_id,role_id,name)
      SELECT $1,$2,$3,id,'Operator' FROM umi.role WHERE key='admin' AND NOT is_platform`,
      [staff, merchant, user],
    );
    await pg.query(
      `INSERT INTO merchant.device(id,merchant_id,location_id,name,kind) VALUES ($1,$2,$3,'POS','pos_terminal')`,
      [device, merchant, location],
    );
    await pg.query(
      `INSERT INTO runtime.session(id,merchant_id,principal_type,principal_id,token_hash)
      VALUES ($1,$2,'user',$3,$4)`,
      [durable, merchant, user, randomUUID()],
    );
    await pg.query(
      `INSERT INTO runtime.operator_session(id,durable_session_id,user_id,staff_id,device_id,
      merchant_id,location_id,permissions,entitlements,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,ARRAY['cart.write','order.fire'],
        '[{"featureKey":"pos","enabled":true}]',now()+interval '2 hours')`,
      [operator, durable, user, staff, device, merchant, location],
    );
    for (const [id, name, price] of [
      [product, 'Coffee', 50],
      [alternative, 'Cappuccino', 60],
    ] as const)
      await pg.query(
        `INSERT INTO merchant.product(id,merchant_id,name,price,requires_preparation)
        VALUES ($1,$2,$3,$4,true)`,
        [id, merchant, name, price],
      );
    await pg.query(
      `INSERT INTO merchant.station(id,merchant_id,location_id,name,key) VALUES ($1,$2,$3,'Bar','bar')`,
      [station, merchant, location],
    );
    await pg.query(
      `INSERT INTO merchant.kitchen_route(merchant_id,location_id,product_id,station_id) VALUES ($1,$2,$3,$4),($1,$2,$5,$4)`,
      [merchant, location, product, station, alternative],
    );
    cartId = await scoped((client) => repo.create(client, merchant, location, operator));
    await add();
    const first = await cart();
    sentLine = first.items[0].id;
    const result = await scoped((client) =>
      repo.fire(client, merchant, first, first.version, operator),
    );
    expect(result.state).toBe('fired');
    orderId = (await cart()).firedOrderId!;
    kitchenId = (
      await pg.query('SELECT id FROM merchant.kitchen_order WHERE source_order_id=$1', [orderId])
    ).rows[0].id;
  });
  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  it('adds, changes quantity, replaces and removes only the pending second round', async () => {
    const sentBefore = (
      await pg.query('SELECT * FROM merchant.pos_cart_line WHERE id=$1', [sentLine])
    ).rows[0];
    const commercialBefore = (
      await pg.query('SELECT * FROM merchant.order_item WHERE order_id=$1', [orderId])
    ).rows;
    const kitchenBefore = (
      await pg.query('SELECT * FROM merchant.kitchen_order_item WHERE kitchen_order_id=$1', [
        kitchenId,
      ])
    ).rows;
    let pending = await add();
    let current = await cart();
    expect(pending.id).not.toBe(sentLine);
    const quantity = input(current.version, product, 3);
    await scoped(async (client) => {
      const priced = (await repo.price(client, merchant, location, quantity))!;
      expect(
        await repo.replace(
          client,
          merchant,
          cartId,
          pending.id,
          current.version,
          'a'.repeat(64),
          quantity,
          priced,
        ),
      ).toBe(true);
    });
    current = await cart();
    pending = current.items.find((line) => line.fired !== true)!;
    expect(pending.quantity).toBe(3);
    const replacement = input(current.version, alternative, 2);
    await scoped(async (client) => {
      const priced = (await repo.price(client, merchant, location, replacement))!;
      expect(
        await repo.replace(
          client,
          merchant,
          cartId,
          pending.id,
          current.version,
          'b'.repeat(64),
          replacement,
          priced,
        ),
      ).toBe(true);
    });
    current = await cart();
    pending = current.items.find((line) => line.fired !== true)!;
    expect(pending.productId).toBe(alternative);
    expect(pending.quantity).toBe(2);
    expect(
      await scoped((client) =>
        repo.remove(client, merchant, cartId, pending.id, current.version, operator),
      ),
    ).toBe(true);
    current = await cart();
    expect(current.items).toHaveLength(1);
    expect(current.items[0].id).toBe(sentLine);
    expect(current.firedOrderId).toBe(orderId);
    expect(
      (await pg.query('SELECT * FROM merchant.pos_cart_line WHERE id=$1', [sentLine])).rows[0],
    ).toEqual(sentBefore);
    expect(
      (await pg.query('SELECT * FROM merchant.order_item WHERE order_id=$1', [orderId])).rows,
    ).toEqual(commercialBefore);
    expect(
      (
        await pg.query('SELECT * FROM merchant.kitchen_order_item WHERE kitchen_order_id=$1', [
          kitchenId,
        ])
      ).rows,
    ).toEqual(kitchenBefore);
  });

  it('refuses sent, missing and different cart lines without a version change', async () => {
    const before = await cart();
    const otherCart = randomUUID();
    const otherLine = randomUUID();
    await pg.query(
      `INSERT INTO merchant.pos_cart(id,merchant_id,location_id,operator_session_id,
         original_operator_session_id,original_operator_user_id,operator_user_id,lifecycle_state,suspended_at)
       VALUES ($1,$2,$3,$4,$4,$5,$5,'suspended',now())`,
      [otherCart, merchant, location, operator, user],
    );
    await pg.query(
      `INSERT INTO merchant.pos_cart_line(id,merchant_id,cart_id,product_id,identity_key,product_name,
         quantity,base_price,tax_rate_basis_points) VALUES ($1,$2,$3,$4,$5,'Coffee',1,50,0)`,
      [otherLine, merchant, otherCart, product, 'e'.repeat(64)],
    );
    const dto = input(before.version, alternative, 4);
    await scoped(async (client) => {
      const priced = (await repo.price(client, merchant, location, dto))!;
      expect(await repo.remove(client, merchant, cartId, sentLine, before.version, operator)).toBe(
        false,
      );
      expect(
        await repo.replace(
          client,
          merchant,
          cartId,
          sentLine,
          before.version,
          'c'.repeat(64),
          dto,
          priced,
        ),
      ).toBe(false);
      expect(
        await repo.remove(client, merchant, cartId, randomUUID(), before.version, operator),
      ).toBe(false);
      expect(await repo.remove(client, merchant, cartId, otherLine, before.version, operator)).toBe(
        false,
      );
    });
    expect(await cart()).toEqual(before);
    expect(
      (await pg.query('SELECT cart_id FROM merchant.pos_cart_line WHERE id=$1', [otherLine]))
        .rows[0].cart_id,
    ).toBe(otherCart);
  });

  it('retains version and actor guards when a pending second round exists', async () => {
    const pending = await add();
    const before = await cart();
    expect(
      await scoped((client) =>
        repo.remove(client, merchant, cartId, pending.id, before.version - 1, operator),
      ),
    ).toBe(false);
    expect(
      await scoped((client) =>
        repo.remove(client, merchant, cartId, pending.id, before.version, randomUUID()),
      ),
    ).toBe(false);
    expect(
      await scoped((client) =>
        repo.remove(client, randomUUID(), cartId, pending.id, before.version, operator),
      ),
    ).toBe(false);
    expect(await cart()).toEqual(before);
  });

  it('blocks quantity, replacement and removal while a payment outcome is unknown', async () => {
    const before = await cart();
    const pending = before.items.find((line) => line.fired !== true)!;
    await pg.query(
      `INSERT INTO merchant.pos_checkout_draft(merchant_id,location_id,cart_id,operator_session_id,device_id,state,receipt_delivery)
      VALUES ($1,$2,$3,$4,$5,'payment_unknown','{}')`,
      [merchant, location, cartId, operator, device],
    );
    const replace = async (productId: string, quantity: number) =>
      scoped(async (client) => {
        const dto = input(before.version, productId, quantity);
        const priced = (await repo.price(client, merchant, location, dto))!;
        return repo.replace(
          client,
          merchant,
          cartId,
          pending.id,
          before.version,
          'd'.repeat(64),
          dto,
          priced,
        );
      });
    await expect(replace(product, 3)).rejects.toMatchObject({
      response: { code: 'CART_PAYMENT_UNRESOLVED' },
    });
    await expect(replace(alternative, 1)).rejects.toMatchObject({
      response: { code: 'CART_PAYMENT_UNRESOLVED' },
    });
    await expect(
      scoped((client) =>
        repo.remove(client, merchant, cartId, pending.id, before.version, operator),
      ),
    ).rejects.toMatchObject({ response: { code: 'CART_PAYMENT_UNRESOLVED' } });
    expect(await cart()).toEqual(before);
  });
});
