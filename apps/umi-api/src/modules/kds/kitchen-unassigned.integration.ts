import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KdsRepository } from './kds.repository';
import { KdsService } from './kds.service';
import { IntegrityRepository } from '../integrity/integrity.repository';
import { IntegrityService } from '../integrity/integrity.service';
import { KitchenBoardEvents } from '../realtime/kitchen-board.events';
import type { PgService } from '../../shared/database/pg.service';

// Los datos y la auditoría de cada caso terminan con ROLLBACK en la base local.
describe('unassigned kitchen work in PostgreSQL', () => {
  let pool: Pool, client: PoolClient, service: KdsService, repo: KdsRepository;
  let merchant: string, location: string, operator: string, station: string, category: string;
  let products: string[], source: string, order: string, items: string[];
  let user: { id: string; sessionId: string; deviceId: string; email: null };
  beforeAll(() => {
    const url = process.env.DATABASE_URL_TEST_SUPERUSER ?? process.env.DATABASE_URL_WORKER;
    if (!url) throw new Error('DATABASE_URL_WORKER is required');
    pool = new Pool({ connectionString: url });
  });
  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    merchant = randomUUID();
    location = randomUUID();
    operator = randomUUID();
    station = randomUUID();
    category = randomUUID();
    source = randomUUID();
    order = randomUUID();
    products = [randomUUID(), randomUUID()];
    items = [randomUUID(), randomUUID()];
    user = { id: randomUUID(), sessionId: randomUUID(), deviceId: randomUUID(), email: null };
    const staff = randomUUID();
    await client.query(`INSERT INTO umi."user"(id,full_name) VALUES ($1,'Routing test')`, [
      user.id,
    ]);
    await client.query(
      `INSERT INTO merchant.merchant(id,name,handle) VALUES ($1::uuid,'Routing test',$1::text)`,
      [merchant],
    );
    await client.query(`INSERT INTO merchant.location(id,merchant_id,name) VALUES ($1,$2,'Room')`, [
      location,
      merchant,
    ]);
    await client.query(
      `INSERT INTO merchant.staff(id,merchant_id,location_id,user_id,role_id,name)
      SELECT $1,$2,$3,$4,id,'Routing test' FROM umi.role WHERE NOT is_platform LIMIT 1`,
      [staff, merchant, location, user.id],
    );
    await client.query(
      `INSERT INTO merchant.device(id,merchant_id,location_id,name,kind) VALUES ($1,$2,$3,'Test','pos_terminal')`,
      [user.deviceId, merchant, location],
    );
    await client.query(
      `INSERT INTO runtime.session(id,merchant_id,principal_type,principal_id,token_hash)
      VALUES ($1,$2,'user',$3,$4)`,
      [user.sessionId, merchant, user.id, randomUUID()],
    );
    await client.query(
      `INSERT INTO runtime.operator_session(id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,permissions,entitlements,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,ARRAY['kitchen.read','kitchen.station.manage','kitchen.cancel_ack'],
      '[{"featureKey":"pos","enabled":true}]',now()+interval '1 hour')`,
      [operator, user.sessionId, user.id, staff, user.deviceId, merchant, location],
    );
    await client.query(
      `INSERT INTO merchant.station(id,merchant_id,location_id,key,name) VALUES ($1,$2,$3,'bar','Barra')`,
      [station, merchant, location],
    );
    await client.query(
      `INSERT INTO merchant.product_category(id,merchant_id,name) VALUES ($1,$2,'Drinks')`,
      [category, merchant],
    );
    for (const [index, product] of products.entries())
      await client.query(
        `INSERT INTO merchant.product
      (id,merchant_id,category_id,name,price,requires_preparation) VALUES ($1,$2,$3,$4,100,true)`,
        [product, merchant, category, `Drink ${index}`],
      );
    await client.query(
      `INSERT INTO merchant.customer_order(id,merchant_id,location_id,source,fulfillment_type,status,business_date,external_ref)
      VALUES ($1,$2,$3,'pos','dine_in','completed',current_date-4,'Cuenta test')`,
      [source, merchant, location],
    );
    await client.query(
      `INSERT INTO merchant.kitchen_order(id,merchant_id,location_id,source_order_id,public_reference,source,fulfillment_type,business_date,status,queued_at)
      VALUES ($1,$2,$3,$4,'Cuenta test','pos','dine_in',current_date-4,'exception',now()-interval '4 days')`,
      [order, merchant, location, source],
    );
    for (const [index, item] of items.entries()) {
      const line = randomUUID();
      await client.query(
        `INSERT INTO merchant.order_item(id,order_id,product_id,name,quantity,unit_price,display_order)
        VALUES ($1,$2,$3,$4,1,100,$5)`,
        [line, source, products[index], `Drink ${index}`, index],
      );
      await client.query(
        `INSERT INTO merchant.kitchen_order_item(id,merchant_id,location_id,kitchen_order_id,source_order_id,source_order_item_id,status,product_id,product_name,quantity,display_order,route_reason)
        VALUES ($1,$2,$3,$4,$5,$6,'exception',$7,$8,1,$9,'missing_route')`,
        [item, merchant, location, order, source, line, products[index], `Drink ${index}`, index],
      );
    }
    let transaction = 0;
    const pg = {
      query: client.query.bind(client),
      runWithMerchant: (_m: string, _u: string, work: (c: PoolClient) => Promise<unknown>) =>
        work(client),
      withMerchant: async (work: (c: PoolClient) => Promise<unknown>) => {
        const savepoint = `command_${transaction++}`;
        await client.query(`SAVEPOINT ${savepoint}`);
        try {
          const value = await work(client);
          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
          return value;
        } catch (error) {
          await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          throw error;
        }
      },
    } as unknown as PgService;
    repo = new KdsRepository(pg);
    service = new KdsService(
      repo,
      {} as never,
      {} as never,
      new KitchenBoardEvents(),
      new IntegrityService(new IntegrityRepository(pg)),
    );
  });
  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });
  afterAll(async () => pool.end());
  const query = () => ({ locationId: location, operatorSessionId: operator });
  const read = () => service.unassignedForPos(user, merchant, query());
  async function request() {
    const board = await read();
    return {
      ...query(),
      kitchenOrderId: order,
      expectedVersion: board.data[0]?.version ?? 1,
      idempotencyKey: randomUUID(),
      routingFingerprint: board.data[0]?.routingFingerprint,
    };
  }
  async function route(productId: string | null = products[0], target = 120) {
    const id = randomUUID();
    await client.query(
      `INSERT INTO merchant.kitchen_route(id,merchant_id,location_id,station_id,product_id,target_seconds)
      VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, merchant, location, station, productId, target],
    );
    return id;
  }
  async function cancel() {
    await client.query(`UPDATE merchant.customer_order SET status='canceled' WHERE id=$1`, [
      source,
    ]);
  }
  async function states() {
    return (
      await client.query(
        `SELECT id,status,station_id,version,station_completed_at,target_seconds
    FROM merchant.kitchen_order_item WHERE kitchen_order_id=$1 ORDER BY display_order`,
        [order],
      )
    ).rows;
  }

  it('shows work from earlier days, previews actual routes, and resolves only matching exceptions once', async () => {
    await route();
    const before = await read();
    expect(before.data[0]).toMatchObject({
      stationId: null,
      status: 'exception',
      proposedRoutes: [
        { itemId: items[0], stationId: station, stationName: 'Barra' },
        { itemId: items[1], stationId: null },
      ],
    });
    expect(before.data[0].businessDate).not.toBe(new Date().toISOString().slice(0, 10));
    const cmd = await request();
    const result = await service.changeUnassignedForPos(user, merchant, cmd, 'resolve_routes');
    expect(result).toMatchObject({
      resolvedItems: 1,
      remainingItems: 1,
      discardedItems: 0,
      version: 2,
      status: 'exception',
    });
    expect(await service.changeUnassignedForPos(user, merchant, cmd, 'resolve_routes')).toEqual(
      result,
    );
    expect(await states()).toMatchObject([
      { status: 'queued', station_id: station, target_seconds: 120 },
      { status: 'exception', station_id: null },
    ]);
    expect(
      (await client.query(`SELECT status FROM merchant.customer_order WHERE id=$1`, [source]))
        .rows[0].status,
    ).toBe('completed');
    expect(
      (await client.query(`SELECT 1 FROM merchant.audit_event WHERE merchant_id=$1`, [merchant]))
        .rowCount,
    ).toBe(1);
    expect(
      (await client.query(`SELECT 1 FROM merchant.kitchen_event WHERE merchant_id=$1`, [merchant]))
        .rowCount,
    ).toBe(1);
  });
  it('keeps unresolved work visible and reports zero assignments when no route exists', async () => {
    expect(
      await service.changeUnassignedForPos(user, merchant, await request(), 'resolve_routes'),
    ).toMatchObject({ resolvedItems: 0, remainingItems: 2, version: 1 });
    expect((await read()).data[0].items).toHaveLength(2);
  });
  it('uses the same product, category, default precedence and route time as normal projection', async () => {
    await route(null, 600);
    await route(products[0], 75);
    await client.query(
      `INSERT INTO merchant.kitchen_route(merchant_id,location_id,station_id,category_id,target_seconds)
      VALUES ($1,$2,$3,$4,240)`,
      [merchant, location, station, category],
    );
    expect(
      await service.changeUnassignedForPos(user, merchant, await request(), 'resolve_routes'),
    ).toMatchObject({ resolvedItems: 2, remainingItems: 0 });
    expect((await states()).map((row) => row.target_seconds)).toEqual([75, 240]);
    expect((await read()).data).toHaveLength(0);
  });
  it('leaves completed station work and held courses unchanged while routing pending items', async () => {
    await route(null);
    await client.query(
      `UPDATE merchant.kitchen_order_item SET status='ready',station_id=$2,station_completed_at=now() WHERE id=$1`,
      [items[0], station],
    );
    await client.query(`UPDATE merchant.kitchen_order_item SET course_number=3 WHERE id=$1`, [
      items[1],
    ]);
    const before = (await states())[0];
    expect(
      await service.changeUnassignedForPos(user, merchant, await request(), 'resolve_routes'),
    ).toMatchObject({ resolvedItems: 1, remainingItems: 0 });
    expect((await states())[0]).toEqual(before);
    expect(
      (
        await client.query(
          `SELECT course_number,status FROM merchant.kitchen_order_item WHERE id=$1`,
          [items[1]],
        )
      ).rows[0],
    ).toMatchObject({ course_number: 3, status: 'queued' });
  });
  it('refuses a changed version, a changed routing preview and a changed idempotency payload', async () => {
    const id = await route();
    const cmd = await request();
    await expect(
      service.changeUnassignedForPos(
        user,
        merchant,
        { ...cmd, expectedVersion: 7 },
        'resolve_routes',
      ),
    ).rejects.toMatchObject({ response: { code: 'OPTIMISTIC_VERSION_CONFLICT' } });
    await client.query(`UPDATE merchant.kitchen_route SET target_seconds=300 WHERE id=$1`, [id]);
    await expect(
      service.changeUnassignedForPos(user, merchant, cmd, 'resolve_routes'),
    ).rejects.toMatchObject({ response: { code: 'OPTIMISTIC_VERSION_CONFLICT' } });
    const current = await request();
    await service.changeUnassignedForPos(user, merchant, current, 'resolve_routes');
    await expect(
      service.changeUnassignedForPos(
        user,
        merchant,
        { ...current, expectedVersion: 99 },
        'resolve_routes',
      ),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
  });
  it('never routes cancelled orders; discard acknowledges only unassigned work', async () => {
    await route(null);
    await cancel();
    await client.query(
      `UPDATE merchant.kitchen_order_item SET status='queued',station_id=$2 WHERE id=$1`,
      [items[0], station],
    );
    const cmd = await request();
    expect((await read()).data[0]).toMatchObject({ status: 'cancelled', proposedRoutes: [] });
    await expect(
      service.changeUnassignedForPos(user, merchant, cmd, 'resolve_routes'),
    ).rejects.toMatchObject({ response: { code: 'KITCHEN_INVALID_TRANSITION' } });
    const discard = { ...cmd, idempotencyKey: randomUUID() };
    const result = await service.changeUnassignedForPos(user, merchant, discard, 'discard');
    expect(await service.changeUnassignedForPos(user, merchant, discard, 'discard')).toEqual(
      result,
    );
    expect(result).toMatchObject({
      resolvedItems: 0,
      remainingItems: 0,
      discardedItems: 1,
      status: 'cancelled',
    });
    expect(await states()).toMatchObject([
      { status: 'queued', station_id: station, station_completed_at: null },
      { status: 'cancelled', station_id: null, station_completed_at: expect.any(Date) },
    ]);
    expect((await read()).data).toHaveLength(0);
  });
  it('hides individually cancelled unrouted items in an otherwise active ticket', async () => {
    await client.query(`UPDATE merchant.kitchen_order_item SET status='cancelled' WHERE id=$1`, [
      items[0],
    ]);
    await client.query(
      `UPDATE merchant.kitchen_order_item SET status='queued',station_id=$2 WHERE id=$1`,
      [items[1], station],
    );
    await client.query(`UPDATE merchant.kitchen_order SET status='queued' WHERE id=$1`, [order]);
    expect((await read()).data).toHaveLength(0);
  });
  it('does not discard active work or revive completed kitchen orders', async () => {
    await expect(
      service.changeUnassignedForPos(user, merchant, await request(), 'discard'),
    ).rejects.toMatchObject({ response: { code: 'KITCHEN_INVALID_TRANSITION' } });
    const cmd = await request();
    await client.query(`UPDATE merchant.kitchen_order SET status='completed' WHERE id=$1`, [order]);
    expect((await read()).data).toHaveLength(0);
    await expect(
      service.changeUnassignedForPos(user, merchant, cmd, 'resolve_routes'),
    ).rejects.toMatchObject({ response: { code: 'KITCHEN_INVALID_TRANSITION' } });
  });
  it('requires the enrolled session, merchant, location and separate management permission', async () => {
    const cmd = await request();
    for (const identity of [
      { ...user, id: randomUUID() },
      { ...user, sessionId: randomUUID() },
      { ...user, deviceId: randomUUID() },
    ])
      await expect(
        service.changeUnassignedForPos(identity, merchant, cmd, 'resolve_routes'),
      ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
    await expect(
      service.changeUnassignedForPos(user, randomUUID(), cmd, 'resolve_routes'),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
    await expect(
      service.changeUnassignedForPos(
        user,
        merchant,
        { ...cmd, locationId: randomUUID() },
        'resolve_routes',
      ),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
    await client.query(
      `UPDATE runtime.operator_session SET permissions=ARRAY['kitchen.read','kitchen.prepare'] WHERE id=$1`,
      [operator],
    );
    expect((await read()).data).toHaveLength(1);
    await expect(
      service.changeUnassignedForPos(user, merchant, cmd, 'resolve_routes'),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
    await expect(
      service.changeUnassignedForPos(user, merchant, cmd, 'discard'),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
    await client.query(
      `UPDATE runtime.operator_session SET state='ended',ended_at=now() WHERE id=$1`,
      [operator],
    );
    await expect(read()).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
  });
  it('does not resolve inactive stations or routes from another location', async () => {
    await route(null);
    await client.query(`UPDATE merchant.station SET status='archived' WHERE id=$1`, [station]);
    const otherLocation = randomUUID(),
      otherStation = randomUUID();
    await client.query(
      `INSERT INTO merchant.location(id,merchant_id,name) VALUES ($1,$2,'Other')`,
      [otherLocation, merchant],
    );
    await client.query(
      `INSERT INTO merchant.station(id,merchant_id,location_id,key,name) VALUES ($1,$2,$3,'other','Other')`,
      [otherStation, merchant, otherLocation],
    );
    await client.query(
      `INSERT INTO merchant.kitchen_route(merchant_id,location_id,station_id)
      VALUES ($1,$2,$3)`,
      [merchant, otherLocation, otherStation],
    );
    expect(
      await service.changeUnassignedForPos(user, merchant, await request(), 'resolve_routes'),
    ).toMatchObject({ resolvedItems: 0, remainingItems: 2 });
  });
  it.skipIf(!process.env.DATABASE_URL_TEST_SUPERUSER).each(['resolve_routes', 'discard'] as const)(
    'executes %s under the API role with merchant and location RLS',
    async (action) => {
      await route(null);
      if (action === 'discard') await cancel();
      await client.query(
        `SELECT set_config('app.current_merchant',$1,true),set_config('app.current_location',$2,true),
      set_config('app.current_device',$3,true),set_config('app.user_id',$4,true)`,
        [merchant, location, user.deviceId, user.id],
      );
      await client.query('SET LOCAL ROLE api');
      expect((await client.query('SELECT current_user')).rows[0].current_user).toBe('api');
      expect(
        await service.changeUnassignedForPos(user, merchant, await request(), action),
      ).toMatchObject({
        resolvedItems: action === 'resolve_routes' ? 2 : 0,
        discardedItems: action === 'discard' ? 2 : 0,
        remainingItems: 0,
      });
      await client.query('RESET ROLE');
    },
  );
});
