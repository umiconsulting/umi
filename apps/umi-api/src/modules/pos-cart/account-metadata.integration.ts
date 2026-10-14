import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Cart } from '@umi/contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import { PosCartRepository } from './pos-cart.repository';
import { PosSaleRepository } from '../pos-sale/pos-sale.repository';

// Use a disposable populated build-v3 copy with forward migrations through 021.
describe('account metadata and later table assignment under real API RLS', () => {
  const merchant = randomUUID(),
    location = randomUUID(),
    product = randomUUID(),
    station = randomUUID();
  const tables = [randomUUID(), randomUUID()];
  const actors = [0, 1, 2].map((index) => ({
    index,
    user: randomUUID(),
    staff: randomUUID(),
    device: randomUUID(),
    session: randomUUID(),
    operator: randomUUID(),
  }));
  let pg: PgService;
  let repo: PosCartRepository;
  let saved: Cart;
  let other: Cart;
  const scoped = <T>(actor: (typeof actors)[number], work: (client: PoolClient) => Promise<T>) =>
    runWithRequestContext(
      {
        merchantId: merchant,
        locationId: location,
        deviceId: actor.device,
        userId: actor.user,
        requestId: randomUUID(),
      },
      () => pg.runWithMerchant(merchant, actor.user, work, location),
    );
  const command = (cart: Cart, actor: (typeof actors)[number]) => ({
    locationId: location,
    operatorSessionId: actor.operator,
    expectedVersion: cart.version,
    idempotencyKey: randomUUID(),
  });
  beforeAll(async () => {
    if (!process.env.DATABASE_URL_APP || !process.env.DATABASE_URL_WORKER)
      throw new Error('Set both database URLs to a disposable verification database.');
    const target = new URL(process.env.DATABASE_URL_WORKER).pathname;
    if (!target.includes('verify')) throw new Error('Use a disposable verification database.');
    const values = { ...process.env, JWT_SECRET: 'account-metadata-test-secret-000000000000' };
    pg = new PgService({
      get: (key: string) => values[key as keyof typeof values],
    } as unknown as ConfigService<AppConfig, true>);
    await pg.onModuleInit();
    repo = new PosCartRepository(pg);
    await pg.query(`INSERT INTO merchant.merchant(id,name,handle) VALUES ($1,'Metadata test',$2)`, [
      merchant,
      `meta-${merchant}`,
    ]);
    await pg.query(`INSERT INTO merchant.location(id,merchant_id,name) VALUES ($1,$2,'Room')`, [
      location,
      merchant,
    ]);
    for (const actor of actors) {
      await pg.query(`INSERT INTO umi."user"(id,full_name) VALUES ($1,$2)`, [
        actor.user,
        `Metadata operator ${actor.index}`,
      ]);
      await pg.query(
        `INSERT INTO merchant.staff(id,merchant_id,location_id,user_id,role_id,name)
        SELECT $1,$2,$3,$4,id,$5 FROM umi.role WHERE NOT is_platform LIMIT 1`,
        [actor.staff, merchant, location, actor.user, `Metadata operator ${actor.index}`],
      );
      await pg.query(
        `INSERT INTO merchant.device(id,merchant_id,location_id,name,kind)
        VALUES ($1,$2,$3,'Tablet','pos_terminal')`,
        [actor.device, merchant, location],
      );
      await pg.query(
        `INSERT INTO runtime.session(id,merchant_id,principal_type,principal_id,token_hash)
        VALUES ($1,$2,'user',$3,$4)`,
        [actor.session, merchant, actor.user, randomUUID()],
      );
      await pg.query(
        `INSERT INTO runtime.operator_session(id,durable_session_id,user_id,staff_id,device_id,
        merchant_id,location_id,permissions,entitlements,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,ARRAY['cart.write','order.fire'],
          '[{"featureKey":"pos","enabled":true}]',now()+interval '2 hours')`,
        [actor.operator, actor.session, actor.user, actor.staff, actor.device, merchant, location],
      );
    }
    await pg.query(
      `INSERT INTO merchant.product(id,merchant_id,name,price,requires_preparation)
      VALUES ($1,$2,'Coffee',100,true)`,
      [product, merchant],
    );
    await pg.query(
      `INSERT INTO merchant.station(id,merchant_id,location_id,name,key)
      VALUES ($1,$2,$3,'Bar','bar')`,
      [station, merchant, location],
    );
    await pg.query(
      `INSERT INTO merchant.kitchen_route(merchant_id,location_id,product_id,station_id)
      VALUES ($1,$2,$3,$4)`,
      [merchant, location, product, station],
    );
    const plan = {
      areas: [
        {
          id: randomUUID(),
          elements: tables.map((id, index) => ({
            id,
            kind: 'table',
            label: `Mesa ${index + 1}`,
            capacity: 4,
          })),
        },
      ],
    };
    await pg.query(
      `INSERT INTO merchant.floor_plan(merchant_id,location_id,version,draft,published_version,published,published_at)
      VALUES ($1,$2,1,$3,1,$3,now())`,
      [merchant, location, JSON.stringify(plan)],
    );
    await pg.query(
      `INSERT INTO merchant.table_state(merchant_id,location_id,table_id,state,seated_at,party_size)
      VALUES ($1,$2,$3,'seated',now(),3)`,
      [merchant, location, tables[0]],
    );
  });
  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  async function addFixtureLine(cartId: string) {
    await pg.query(
      `INSERT INTO merchant.pos_cart_line(merchant_id,cart_id,product_id,identity_key,
      product_name,quantity,base_price,tax_rate_basis_points)
      VALUES ($1,$2,$3,$4,'Coffee',1,100,0)`,
      [merchant, cartId, product, 'a'.repeat(64)],
    );
  }

  it('keeps name, folio, creation time and creator after save, read and another operator resume', async () => {
    const id = await scoped(actors[0], (client) =>
      repo.create(client, merchant, location, actors[0].operator),
    );
    await addFixtureLine(id);
    const first = (await repo.readAccount(merchant, location, id))!;
    expect(first.accountFolio).toMatch(/^Cuenta \d+$/);
    expect(first.createdAt).toBeTruthy();
    expect(first.operatorName).toBe('Metadata operator 0');
    const named = (await scoped(actors[0], (client) =>
      repo.setAccountDetails(client, merchant, id, {
        ...command(first, actors[0]),
        accountName: 'Pedido patio',
      }),
    ))!;
    const suspended = (await scoped(actors[0], (client) =>
      repo.suspendAccount(client, merchant, { ...command(named, actors[0]), cartId: id }),
    ))!;
    saved = (await scoped(actors[1], (client) =>
      repo.claimAccount(client, merchant, location, actors[1].operator, id, suspended.version),
    ))!;
    expect(saved).toMatchObject({
      id,
      accountName: 'Pedido patio',
      accountFolio: first.accountFolio,
      createdAt: first.createdAt,
      operatorName: 'Metadata operator 0',
      operatorSessionId: actors[1].operator,
    });
    expect((await repo.readAccount(merchant, location, id))?.accountName).toBe('Pedido patio');
    expect(await repo.openAccountIds(merchant, location)).toContain(id);
    const otherId = await scoped(actors[0], (client) =>
      repo.create(client, merchant, location, actors[0].operator),
    );
    await addFixtureLine(otherId);
    other = (await repo.readAccount(merchant, location, otherId))!;
    expect(other.accountFolio).not.toBe(first.accountFolio);
  });

  it('assigns a table after sending while it keeps commercial and kitchen identities', async () => {
    await scoped(actors[1], (client) =>
      repo.fire(client, merchant, saved, saved.version, actors[1].operator),
    );
    saved = (await repo.readAccount(merchant, location, saved.id))!;
    const before = await pg.query(
      `SELECT c.fired_order_id,l.id AS cart_line,l.order_item_id,k.id AS kitchen_item,
      k.kitchen_order_id FROM merchant.pos_cart c JOIN merchant.pos_cart_line l ON l.cart_id=c.id
      JOIN merchant.kitchen_order_item k ON k.source_order_item_id=l.order_item_id WHERE c.id=$1`,
      [saved.id],
    );
    const identity = before.rows[0];
    const visit = await pg.query(
      `SELECT visit_id,party_size,seated_at FROM merchant.table_state
      WHERE merchant_id=$1 AND location_id=$2 AND table_id=$3`,
      [merchant, location, tables[0]],
    );
    const assigned = (await scoped(actors[1], (client) =>
      repo.assignAccountTable(client, merchant, saved.id, {
        ...command(saved, actors[1]),
        tableId: tables[0],
      }),
    ))!;
    expect(assigned).toMatchObject({
      id: saved.id,
      tableId: tables[0],
      tableName: 'Mesa 1',
      accountName: saved.accountName,
      accountFolio: saved.accountFolio,
      createdAt: saved.createdAt,
    });
    expect(assigned.tableVisitId).toBeTruthy();
    expect(assigned.tableVisitId).toBe(visit.rows[0].visit_id);
    expect(
      (
        await pg.query(
          `SELECT visit_id,party_size,seated_at FROM merchant.table_state
      WHERE merchant_id=$1 AND location_id=$2 AND table_id=$3`,
          [merchant, location, tables[0]],
        )
      ).rows,
    ).toEqual(visit.rows);
    expect(assigned.items.map((line) => line.id)).toEqual(saved.items.map((line) => line.id));
    const after = await pg.query(
      `SELECT c.fired_order_id,l.id AS cart_line,l.order_item_id,k.id AS kitchen_item,
      k.kitchen_order_id FROM merchant.pos_cart c JOIN merchant.pos_cart_line l ON l.cart_id=c.id
      JOIN merchant.kitchen_order_item k ON k.source_order_item_id=l.order_item_id WHERE c.id=$1`,
      [saved.id],
    );
    expect(after.rows).toEqual(before.rows);
    const contexts = await pg.query(
      `SELECT o.source_context AS commercial,k.source_context AS kitchen
      FROM merchant.customer_order o JOIN merchant.kitchen_order k ON k.source_order_id=o.id WHERE o.id=$1`,
      [identity.fired_order_id],
    );
    const expected = {
      accountFolio: assigned.accountFolio,
      accountName: 'Pedido patio',
      tableId: tables[0],
      tableName: 'Mesa 1',
      tableVisitId: assigned.tableVisitId,
    };
    expect(contexts.rows[0].commercial).toMatchObject(expected);
    expect(contexts.rows[0].kitchen).toMatchObject(expected);
    saved = assigned;
  });

  it('rejects an occupied table and leaves both accounts intact', async () => {
    const beforeSource = await repo.readAccount(merchant, location, other.id);
    const beforeTarget = await repo.readAccount(merchant, location, saved.id);
    await expect(
      scoped(actors[0], (client) =>
        repo.assignAccountTable(client, merchant, other.id, {
          ...command(other, actors[0]),
          tableId: tables[0],
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'CART_TABLE_ACCOUNT_EXISTS' } });
    expect(await repo.readAccount(merchant, location, other.id)).toEqual(beforeSource);
    expect(await repo.readAccount(merchant, location, saved.id)).toEqual(beforeTarget);
  });

  it('syncs a saved sent-account name to KDS and preserves it through legacy suspend', async () => {
    const before = await pg.query(
      `SELECT o.id AS order_id,k.id AS kitchen_id,k.version,
      k.source_context FROM merchant.customer_order o JOIN merchant.kitchen_order k
      ON k.source_order_id=o.id WHERE o.id=(SELECT fired_order_id FROM merchant.pos_cart WHERE id=$1)`,
      [saved.id],
    );
    saved = (await scoped(actors[1], (client) =>
      repo.suspendAccount(client, merchant, {
        ...command(saved, actors[1]),
        cartId: saved.id,
        accountName: 'Patio actualizado',
      }),
    ))!;
    const after = await pg.query(
      `SELECT o.id AS order_id,k.id AS kitchen_id,k.version,
      o.source_context AS commercial,k.source_context FROM merchant.customer_order o
      JOIN merchant.kitchen_order k ON k.source_order_id=o.id WHERE o.id=$1`,
      [before.rows[0].order_id],
    );
    expect(after.rows[0]).toMatchObject({
      order_id: before.rows[0].order_id,
      kitchen_id: before.rows[0].kitchen_id,
      source_context: {
        accountName: 'Patio actualizado',
        accountFolio: saved.accountFolio,
        tableId: tables[0],
      },
      commercial: { accountName: 'Patio actualizado' },
    });
    expect(Number(after.rows[0].version)).toBeGreaterThan(Number(before.rows[0].version));
    saved = (await scoped(actors[1], (client) =>
      repo.claimAccount(client, merchant, location, actors[1].operator, saved.id, saved.version),
    ))!;
    const legacy = new PosSaleRepository(pg, repo);
    expect(
      await scoped(actors[1], (client) =>
        legacy.suspend(client, merchant, saved.id, saved.version, null, actors[1].operator),
      ),
    ).toBeTruthy();
    saved = (await repo.readAccount(merchant, location, saved.id))!;
    expect(saved.accountName).toBe('Patio actualizado');
    expect(saved.operatorName).toBe('Metadata operator 0');
    saved = (await scoped(actors[1], (client) =>
      repo.claimAccount(client, merchant, location, actors[1].operator, saved.id, saved.version),
    ))!;
  });

  it('lists a named account with zero lines', async () => {
    const id = await scoped(actors[2], (client) =>
      repo.create(client, merchant, location, actors[2].operator),
    );
    const cart = (await repo.readAccount(merchant, location, id))!;
    const named = await scoped(actors[2], (client) =>
      repo.setAccountDetails(client, merchant, id, {
        ...command(cart, actors[2]),
        accountName: 'Cliente por llegar',
      }),
    );
    expect(named?.items).toEqual([]);
    expect(await repo.openAccountIds(merchant, location)).toContain(id);
  });

  it('rejects stale, foreign, another operator and unresolved-payment mutations', async () => {
    await expect(
      scoped(actors[0], (client) =>
        repo.setAccountDetails(client, merchant, other.id, {
          ...command(other, actors[0]),
          expectedVersion: other.version + 1,
          accountName: 'Stale',
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      scoped(actors[0], (client) =>
        repo.setAccountDetails(client, randomUUID(), other.id, {
          ...command(other, actors[0]),
          accountName: 'Foreign',
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      scoped(actors[1], (client) =>
        repo.setAccountDetails(client, merchant, other.id, {
          ...command(other, actors[1]),
          accountName: 'Wrong owner',
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      scoped(actors[0], (client) =>
        repo.setAccountDetails(client, merchant, other.id, {
          ...command(other, actors[0]),
          locationId: randomUUID(),
          accountName: 'Wrong location',
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      scoped(actors[1], (client) =>
        repo.assignAccountTable(client, merchant, saved.id, {
          ...command(saved, actors[1]),
          tableId: tables[1],
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'CART_ALREADY_ASSIGNED' } });
    await pg.query(
      `INSERT INTO merchant.pos_payment_attempt(merchant_id,location_id,cart_id,method,
      amount_minor_units,currency,status,query_only,correlation_id)
      VALUES ($1,$2,$3,'external_terminal',100,'MXN','unknown',true,$4)`,
      [merchant, location, other.id, randomUUID()],
    );
    await expect(
      scoped(actors[0], (client) =>
        repo.setAccountDetails(client, merchant, other.id, {
          ...command(other, actors[0]),
          accountName: 'Unsafe',
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'CART_PAYMENT_UNRESOLVED' } });
    await expect(
      scoped(actors[0], (client) =>
        repo.assignAccountTable(client, merchant, other.id, {
          ...command(other, actors[0]),
          tableId: tables[1],
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'CART_PAYMENT_UNRESOLVED' } });
    expect(await repo.readAccount(merchant, location, other.id)).toEqual(other);
  });
});
