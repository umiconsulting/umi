import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KdsRepository, type OrderScopeRow } from './kds.repository';

// Cada caso usa datos aislados y ROLLBACK; no modifica las cuentas del café local.
describe('kitchen station actions with real PostgreSQL', () => {
  let pool: Pool;
  let client: PoolClient;
  let repo: KdsRepository;
  let merchant: string;
  let location: string;
  let stations: string[];
  let actor: string;

  beforeAll(() => {
    if (!process.env.DATABASE_URL_WORKER) throw new Error('DATABASE_URL_WORKER is required');
    pool = new Pool({ connectionString: process.env.DATABASE_URL_WORKER });
  });
  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    merchant = randomUUID();
    location = randomUUID();
    stations = [randomUUID(), randomUUID()];
    actor = randomUUID();
    await client.query(`INSERT INTO umi."user"(id,full_name) VALUES ($1,'KDS test operator')`, [
      actor,
    ]);
    await client.query(
      `INSERT INTO merchant.merchant(id,name,handle) VALUES ($1::uuid,'KDS test',$1::text)`,
      [merchant],
    );
    await client.query(`INSERT INTO merchant.location(id,merchant_id,name) VALUES ($1,$2,'Test')`, [
      location,
      merchant,
    ]);
    for (const [index, station] of stations.entries()) {
      await client.query(
        `INSERT INTO merchant.station(id,merchant_id,location_id,key,name) VALUES ($1,$2,$3,$4,$4)`,
        [station, merchant, location, `station-${index}`],
      );
    }
    repo = new KdsRepository({
      query: client.query.bind(client),
      workerTx: (work: (db: PoolClient) => Promise<unknown>) => work(client),
    } as never);
  });
  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });
  afterAll(async () => pool.end());

  async function seed(status = 'exception', course = 1) {
    const source = randomUUID(),
      id = randomUUID();
    await client.query(
      `INSERT INTO merchant.customer_order(id,merchant_id,location_id,source,fulfillment_type,status,business_date,external_ref)
      VALUES ($1::uuid,$2,$3,'pos','dine_in','completed',current_date,$1::text)`,
      [source, merchant, location],
    );
    await client.query(
      `INSERT INTO merchant.kitchen_order(id,merchant_id,location_id,source_order_id,public_reference,source,fulfillment_type,business_date,status,queued_at)
      VALUES ($1,$2,$3,$4,'Cuenta test','pos','dine_in',current_date,$5,clock_timestamp())`,
      [id, merchant, location, source, status],
    );
    const items: string[] = [];
    for (let index = 0; index < 3; index++) {
      const sourceItem = randomUUID(),
        item = randomUUID();
      items.push(item);
      await client.query(
        `INSERT INTO merchant.order_item(id,order_id,name,quantity,unit_price,display_order) VALUES ($1,$2,$3,1,100,$4)`,
        [sourceItem, source, `Dish ${index}`, index],
      );
      await client.query(
        `INSERT INTO merchant.kitchen_order_item(id,merchant_id,location_id,kitchen_order_id,source_order_id,source_order_item_id,station_id,status,product_name,quantity,display_order,route_reason,course_number)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11,$12)`,
        [
          item,
          merchant,
          location,
          id,
          source,
          sourceItem,
          stations[index] ?? null,
          index === 2 ? 'exception' : 'queued',
          `Dish ${index}`,
          index,
          index === 2 ? 'missing_route' : 'product',
          course,
        ],
      );
    }
    const order: OrderScopeRow = {
      id,
      merchant_id: merchant,
      source_order_id: source,
      location_id: location,
      station_id: stations[0],
      kitchen_status: 'new',
      kitchen_order_status: status as OrderScopeRow['kitchen_order_status'],
      version: 1,
      person_id: null,
      source_transaction_id: source,
    };
    return { order, items, source };
  }

  function command(
    order: OrderScopeRow,
    type: Parameters<KdsRepository['executeKitchenCommand']>[0]['commandType'],
    itemIds: string[],
    version = 1,
    key = randomUUID(),
    station = stations[0],
  ) {
    return repo.executeKitchenCommand({
      session: {
        deviceId: null,
        merchantId: merchant,
        locationId: location,
        stationId: station,
        deviceName: 'Test',
        permissions: ['kitchen.ready', 'kitchen.complete', 'kitchen.cancel_ack'],
      },
      order,
      actorUserId: actor,
      commandId: key,
      idempotencyKey: key,
      payloadFingerprint: createHash('sha256')
        .update(`${type}:${itemIds.join()}:${version}`)
        .digest('hex'),
      correlationId: key,
      expectedVersion: version,
      commandType: type,
      targetStatus: null,
      itemIds,
      reasonCode: null,
      reasonNote: null,
      priority: null,
    });
  }

  it('can prepare, ready and finish its item despite an unrouted item in a commercially closed order', async () => {
    const { order, items, source } = await seed();
    expect((await command(order, 'start_preparation', [items[0]])).status).toBe('succeeded');
    expect((await command(order, 'mark_item_ready', [items[0]], 2)).result).toMatchObject({
      status: 'exception',
      version: 3,
    });
    expect((await command(order, 'complete', [items[0]], 3)).status).toBe('succeeded');
    expect(await repo.boardSnapshot(merchant, location, [stations[0]])).toHaveLength(0);
    expect(await repo.boardSnapshot(merchant, location, [stations[1]])).toHaveLength(1);
    const rows = await client.query(
      `SELECT status,station_completed_at FROM merchant.kitchen_order_item WHERE id=ANY($1::uuid[]) ORDER BY display_order`,
      [items],
    );
    expect(rows.rows[0]).toMatchObject({ status: 'ready', station_completed_at: expect.any(Date) });
    expect(rows.rows[1]).toMatchObject({ status: 'queued', station_completed_at: null });
    expect(rows.rows[2]).toMatchObject({ status: 'exception', station_completed_at: null });
    expect(
      (await client.query(`SELECT status FROM merchant.customer_order WHERE id=$1`, [source]))
        .rows[0].status,
    ).toBe('completed');
  });

  it('writes one durable push event for a ready item and none for an idempotent replay', async () => {
    const priorProject = process.env.FCM_PROJECT_ID;
    const priorEnvironment = process.env.UMI_ENVIRONMENT;
    process.env.FCM_PROJECT_ID = 'umiconsulting-pos-dev';
    process.env.UMI_ENVIRONMENT = 'development';
    try {
      const { order, items } = await seed();
      const key = randomUUID();
      expect((await command(order, 'mark_item_ready', [items[0]], 1, key)).status).toBe(
        'succeeded',
      );
      expect((await command(order, 'mark_item_ready', [items[0]], 1, key)).status).toBe(
        'succeeded',
      );
      const outbox = await client.query<{ topic: string; payload: Record<string, string> }>(
        `SELECT topic,payload FROM runtime.outbox_event
          WHERE merchant_id=$1::uuid AND aggregate_id=$2::uuid`,
        [merchant, order.id],
      );
      expect(outbox.rows).toHaveLength(1);
      expect(outbox.rows[0]).toMatchObject({
        topic: 'pos.kitchen_item_ready',
        payload: {
          type: 'kitchen_item_ready',
          itemId: items[0],
          projectId: 'umiconsulting-pos-dev',
        },
      });
    } finally {
      if (priorProject === undefined) delete process.env.FCM_PROJECT_ID;
      else process.env.FCM_PROJECT_ID = priorProject;
      if (priorEnvironment === undefined) delete process.env.UMI_ENVIRONMENT;
      else process.env.UMI_ENVIRONMENT = priorEnvironment;
    }
  });

  it.each(['cancelled', 'completed'])(
    'refuses ready and complete for a terminal %s ticket',
    async (status) => {
      const { order, items } = await seed(status);
      expect((await command(order, 'mark_item_ready', [items[0]])).status).toBe('conflict');
      expect((await command(order, 'complete', [items[0]])).status).toBe('conflict');
    },
  );

  it('refuses another station, an unrouted item, a stale version and a held course', async () => {
    const { order, items } = await seed('exception', 2);
    for (const item of items)
      expect((await command(order, 'mark_item_ready', [item])).status).toBe('conflict');
    expect((await command(order, 'mark_item_ready', [items[0]], 9)).result.code).toBe(
      'KITCHEN_VERSION_CONFLICT',
    );
    expect((await command(order, 'mark_order_ready', [])).status).toBe('conflict');
    expect((await command(order, 'complete', [items[0]])).status).toBe('conflict');
  });

  it('shows cancelled work, refuses preparation, and discards only the acknowledged station', async () => {
    const { order, items, source } = await seed();
    await client.query(`UPDATE merchant.customer_order SET status='canceled' WHERE id=$1`, [
      source,
    ]);
    const before = await repo.boardSnapshot(merchant, location, stations);
    expect(before).toHaveLength(2);
    expect(before.every((row) => row.status === 'cancelled')).toBe(true);
    expect(before[0].items).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'cancelled' })]),
    );
    expect((await command(order, 'start_preparation', [items[0]])).status).toBe('conflict');
    expect((await command(order, 'mark_item_ready', [items[0]])).status).toBe('conflict');
    const key = randomUUID();
    const ack = await command(order, 'cancel_ack', [items[0]], 1, key);
    expect(ack.status).toBe('succeeded');
    expect(await command(order, 'cancel_ack', [items[0]], 1, key)).toEqual(ack);
    expect(await repo.boardSnapshot(merchant, location, [stations[0]])).toHaveLength(0);
    expect(await repo.boardSnapshot(merchant, location, [stations[1]])).toHaveLength(1);
    expect(
      (await command(order, 'cancel_ack', [items[1]], 2, randomUUID(), stations[1])).status,
    ).toBe('succeeded');
    expect(await repo.boardSnapshot(merchant, location, stations)).toHaveLength(0);
    const counts = await repo.allDayCounts(
      merchant,
      location,
      new Date().toISOString().slice(0, 10),
    );
    expect(counts.every((row) => Number(row.ordered) === 0 && Number(row.outstanding) === 0)).toBe(
      true,
    );
  });

  it('recognizes a cancelled POS account even when the source order retains its old status', async () => {
    const { order, items, source } = await seed();
    const staff = randomUUID(),
      device = randomUUID(),
      session = randomUUID(),
      operator = randomUUID();
    await client.query(
      `INSERT INTO merchant.staff(id,merchant_id,location_id,user_id,role_id,name)
      SELECT $1,$2,$3,$4,id,'Test cook' FROM umi.role WHERE NOT is_platform LIMIT 1`,
      [staff, merchant, location, actor],
    );
    await client.query(
      `INSERT INTO merchant.device(id,merchant_id,location_id,name,kind) VALUES ($1,$2,$3,'Test tablet','pos_terminal')`,
      [device, merchant, location],
    );
    await client.query(
      `INSERT INTO runtime.session(id,merchant_id,principal_type,principal_id,token_hash) VALUES ($1,$2,'user',$3,$4)`,
      [session, merchant, actor, randomUUID()],
    );
    await client.query(
      `INSERT INTO runtime.operator_session(id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,permissions,entitlements,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,ARRAY['kitchen.read'],'[]',now()+interval '1 hour')`,
      [operator, session, actor, staff, device, merchant, location],
    );
    await client.query(
      `INSERT INTO merchant.pos_cart(merchant_id,location_id,operator_session_id,original_operator_session_id,operator_user_id,original_operator_user_id,status,lifecycle_state,business_date,fired_order_id)
      VALUES ($1,$2,$3,$3,$4,$4,'abandoned','cancelled',current_date,$5)`,
      [merchant, location, operator, actor, source],
    );
    const board = await repo.boardSnapshot(merchant, location, stations);
    expect(board).toHaveLength(2);
    expect(board.every((row) => row.status === 'cancelled')).toBe(true);
    expect((await command(order, 'mark_item_ready', [items[0]])).status).toBe('conflict');
    expect((await command(order, 'cancel_ack', [items[0]])).status).toBe('succeeded');
    expect(
      (await client.query(`SELECT status FROM merchant.customer_order WHERE id=$1`, [source]))
        .rows[0].status,
    ).toBe('completed');
  });
});
