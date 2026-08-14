import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KdsRepository, type OrderScopeRow } from './kds.repository';
import { projectKitchenOrder } from './kitchen-projector';

const databaseUrl = process.env.GATE4A_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const merchantId = 'a0000000-0000-4000-8000-000000000001';
const locationId = 'a1000000-0000-4000-8000-000000000001';
const stationOne = 'a2000000-0000-4000-8000-000000000001';
const stationTwo = 'a2000000-0000-4000-8000-000000000002';
const sessionOne = 'ae000000-0000-4000-8000-000000000001';

describeDatabase('Gate 4A repository concurrency', () => {
  let pool: Pool;
  let repository: KdsRepository;
  let sessionTwo: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 6 });
    sessionTwo = randomUUID();
    const deviceTwo = randomUUID();
    await pool.query(
      `INSERT INTO merchant.device
         (id,merchant_id,location_id,station_id,name,kind,status,credential_version)
       VALUES ($1,$2,$3,$4,'Expo iPad','kds','active',1)`,
      [deviceTwo, merchantId, locationId, stationTwo],
    );
    await pool.query(
      `INSERT INTO runtime.session
         (id,merchant_id,principal_type,principal_id,station_id,device_name,token_hash,is_active,metadata)
       VALUES ($1::uuid,$2::uuid,'device',$3::uuid,$4::uuid,'Expo iPad',$6,true,
               jsonb_build_object('location_id',$5::text))`,
      [sessionTwo, merchantId, deviceTwo, stationTwo, locationId, `gate4a-${sessionTwo}`],
    );
    await pool.query(
      `INSERT INTO merchant.kitchen_device_station
         (merchant_id,location_id,device_id,station_id)
       VALUES ($1,$2,$3,$4)`,
      [merchantId, locationId, deviceTwo, stationTwo],
    );
    const database = {
      query: <T>(text: string, values?: unknown[]) =>
        pool.query<T & Record<string, unknown>>(text, values),
      workerTx: async <T>(work: (client: PoolClient) => Promise<T>): Promise<T> => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await work(client);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
    };
    repository = new KdsRepository(database as never);
  });

  afterAll(async () => pool.end());

  async function seedOrder(stations: string[]): Promise<{
    order: OrderScopeRow;
    itemIds: string[];
  }> {
    const sourceOrderId = randomUUID();
    const kitchenOrderId = randomUUID();
    await pool.query(
      `INSERT INTO merchant.customer_order
         (id,merchant_id,location_id,source,fulfillment_type,status,business_date,external_ref)
       VALUES ($1,$2,$3,'pos','dine_in','completed',current_date,$4)`,
      [sourceOrderId, merchantId, locationId, sourceOrderId],
    );
    await pool.query(
      `INSERT INTO merchant.kitchen_order
         (id,merchant_id,location_id,source_order_id,public_reference,source,
          fulfillment_type,business_date,status,queued_at)
       VALUES ($1,$2,$3,$4,$5,'pos','dine_in',current_date,'queued',clock_timestamp())`,
      [kitchenOrderId, merchantId, locationId, sourceOrderId, kitchenOrderId],
    );
    const itemIds: string[] = [];
    for (const [index, stationId] of stations.entries()) {
      const itemId = randomUUID();
      const sourceItemId = randomUUID();
      itemIds.push(itemId);
      await pool.query(
        `INSERT INTO merchant.order_item
           (id,order_id,product_id,name,quantity,unit_price,display_order)
         VALUES ($1,$2,'a3000000-0000-4000-8000-000000000001','Hot Item',1,100,$3)`,
        [sourceItemId, sourceOrderId, index + 1],
      );
      await pool.query(
        `INSERT INTO merchant.kitchen_order_item
           (id,merchant_id,location_id,kitchen_order_id,source_order_id,source_order_item_id,
            station_id,status,product_id,product_name,quantity,display_order,route_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'queued','a3000000-0000-4000-8000-000000000001',
                 'Hot Item',1,$8,'product')`,
        [
          itemId,
          merchantId,
          locationId,
          kitchenOrderId,
          sourceOrderId,
          sourceItemId,
          stationId,
          index + 1,
        ],
      );
    }
    return {
      order: {
        id: kitchenOrderId,
        merchant_id: merchantId,
        location_id: locationId,
        station_id: stations[0] ?? null,
        kitchen_status: 'new',
        kitchen_order_status: 'queued',
        version: 1,
        person_id: null,
        source_transaction_id: sourceOrderId,
      },
      itemIds,
    };
  }

  function command(
    order: OrderScopeRow,
    input: {
      commandId?: string;
      idempotencyKey?: string;
      expectedVersion?: number;
      stationId?: string;
      deviceId?: string;
      commandType?:
        | 'start_preparation'
        | 'mark_item_ready'
        | 'mark_order_ready'
        | 'complete'
        | 'recall'
        | 'cancel_ack'
        | 'change_priority';
      itemIds?: string[];
      targetStatus?: 'queued' | 'in_preparation' | 'ready' | 'completed' | 'cancelled' | null;
    } = {},
  ) {
    const commandId = input.commandId ?? randomUUID();
    return repository.executeKitchenCommand({
      session: {
        deviceId: input.deviceId ?? sessionOne,
        merchantId,
        locationId,
        stationId: input.stationId ?? stationOne,
        deviceName: 'KDS',
        permissions: ['kitchen.read', 'kitchen.prepare', 'kitchen.ready'],
      },
      order,
      commandId,
      idempotencyKey: input.idempotencyKey ?? commandId,
      correlationId: `gate4a-${commandId}`,
      expectedVersion: input.expectedVersion ?? 1,
      commandType: input.commandType ?? 'start_preparation',
      targetStatus: input.targetStatus ?? null,
      itemIds: input.itemIds ?? [],
      reasonCode: null,
      reasonNote: null,
      priority: null,
      payloadFingerprint: createHash('sha256').update(commandId).digest('hex'),
    });
  }

  it('returns one winner result to two identical concurrent retries', async () => {
    const { order } = await seedOrder([stationOne]);
    const commandId = randomUUID();
    const [first, second] = await Promise.all([
      command(order, { commandId, idempotencyKey: commandId }),
      command(order, { commandId, idempotencyKey: commandId }),
    ]);
    expect(first).toEqual(second);
    expect(first.status).toBe('succeeded');
  });

  it('returns a typed conflict for one command ID with two keys', async () => {
    const { order } = await seedOrder([stationOne]);
    const commandId = randomUUID();
    const [first, second] = await Promise.all([
      command(order, { commandId, idempotencyKey: randomUUID() }),
      command(order, { commandId, idempotencyKey: randomUUID() }),
    ]);
    expect([first.status, second.status].sort()).toEqual(['conflict', 'succeeded']);
    const conflict = first.status === 'conflict' ? first : second;
    expect(conflict.result).toEqual({ code: 'KITCHEN_FINGERPRINT_CONFLICT' });
  });

  it('lets a second assigned station start without aggregate regression', async () => {
    const { order } = await seedOrder([stationOne, stationTwo]);
    expect((await command(order)).status).toBe('succeeded');
    expect(
      (
        await command(
          { ...order, version: 2, kitchen_order_status: 'in_preparation' },
          {
            expectedVersion: 2,
            stationId: stationTwo,
            deviceId: sessionTwo,
          },
        )
      ).status,
    ).toBe('succeeded');
  });

  it('does not mutate a valid subset when one item is outside scope', async () => {
    const first = await seedOrder([stationOne]);
    const second = await seedOrder([stationTwo]);
    const result = await command(first.order, {
      commandType: 'mark_item_ready',
      itemIds: [first.itemIds[0], second.itemIds[0]],
    });
    expect(result.status).toBe('conflict');
    const state = await pool.query<{ status: string }>(
      `SELECT status FROM merchant.kitchen_order_item WHERE id=$1`,
      [first.itemIds[0]],
    );
    expect(state.rows[0]?.status).toBe('queued');
  });

  it('resolves two KDS devices that start the same order', async () => {
    const { order } = await seedOrder([stationOne]);
    const results = await Promise.all([command(order), command(order)]);
    expect(results.filter((result) => result.status === 'succeeded')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'conflict')).toHaveLength(1);
  });

  it('resolves two devices that mark the same item ready', async () => {
    const seeded = await seedOrder([stationOne]);
    expect((await command(seeded.order)).status).toBe('succeeded');
    const order = { ...seeded.order, version: 2, kitchen_order_status: 'in_preparation' as const };
    const results = await Promise.all([
      command(order, {
        expectedVersion: 2,
        commandType: 'mark_item_ready',
        itemIds: seeded.itemIds,
      }),
      command(order, {
        expectedVersion: 2,
        commandType: 'mark_item_ready',
        itemIds: seeded.itemIds,
      }),
    ]);
    expect(results.filter((result) => result.status === 'succeeded')).toHaveLength(1);
  });

  it('resolves ready versus cancel without duplicate transitions', async () => {
    const seeded = await seedOrder([stationOne]);
    expect((await command(seeded.order)).status).toBe('succeeded');
    const order = { ...seeded.order, version: 2, kitchen_order_status: 'in_preparation' as const };
    const results = await Promise.all([
      command(order, { expectedVersion: 2, commandType: 'mark_order_ready' }),
      command(order, { expectedVersion: 2, commandType: 'cancel_ack' }),
    ]);
    expect(results.filter((result) => result.status === 'succeeded')).toHaveLength(1);
  });

  it('resolves ready versus recall with a stable version conflict', async () => {
    const seeded = await seedOrder([stationOne]);
    expect((await command(seeded.order)).status).toBe('succeeded');
    const order = { ...seeded.order, version: 2, kitchen_order_status: 'in_preparation' as const };
    const results = await Promise.all([
      command(order, { expectedVersion: 2, commandType: 'mark_order_ready' }),
      command(order, { expectedVersion: 2, commandType: 'recall' }),
    ]);
    expect(results.filter((result) => result.status === 'succeeded')).toHaveLength(1);
  });

  it('resolves complete versus recall', async () => {
    const seeded = await seedOrder([stationOne]);
    expect((await command(seeded.order)).status).toBe('succeeded');
    expect(
      (
        await command(
          { ...seeded.order, version: 2, kitchen_order_status: 'in_preparation' },
          { expectedVersion: 2, commandType: 'mark_order_ready' },
        )
      ).status,
    ).toBe('succeeded');
    const ready = { ...seeded.order, version: 3, kitchen_order_status: 'ready' as const };
    const results = await Promise.all([
      command(ready, { expectedVersion: 3, commandType: 'complete' }),
      command(ready, { expectedVersion: 3, commandType: 'recall' }),
    ]);
    expect(results.filter((result) => result.status === 'succeeded')).toHaveLength(1);
  });

  it('reconciles a snapshot while the status changes', async () => {
    const seeded = await seedOrder([stationOne]);
    await Promise.all([
      repository.boardSnapshot(merchantId, locationId, [stationOne]),
      command(seeded.order),
    ]);
    const snapshot = await repository.boardSnapshot(merchantId, locationId, [stationOne]);
    expect(snapshot.find((row) => row.ticket_id === seeded.order.id)?.status).toBe(
      'in_preparation',
    );
  });

  it('deduplicates a repeated event through command recovery', async () => {
    const seeded = await seedOrder([stationOne]);
    const commandId = randomUUID();
    await Promise.all([command(seeded.order, { commandId }), command(seeded.order, { commandId })]);
    const events = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM merchant.kitchen_event
        WHERE kitchen_order_id=$1::uuid AND correlation_id=$2`,
      [seeded.order.id, `gate4a-${commandId}`],
    );
    expect(Number(events.rows[0]?.count)).toBe(1);
  });

  it('deduplicates a concurrent sale projection retry', async () => {
    const sourceOrderId = randomUUID();
    const sourceItemId = randomUUID();
    await pool.query(
      `INSERT INTO merchant.customer_order
         (id,merchant_id,location_id,source,fulfillment_type,status,business_date,external_ref)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'pos','dine_in','completed',current_date,$1::text)`,
      [sourceOrderId, merchantId, locationId],
    );
    await pool.query(
      `INSERT INTO merchant.order_item
         (id,order_id,product_id,name,quantity,unit_price,display_order)
       VALUES ($1,$2,'a3000000-0000-4000-8000-000000000001','Hot Item',1,100,1)`,
      [sourceItemId, sourceOrderId],
    );
    const project = () =>
      pool.connect().then(async (client) => {
        try {
          await client.query('BEGIN');
          const result = await projectKitchenOrder(client, merchantId, sourceOrderId);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      });
    const results = await Promise.all([project(), project()]);
    expect(new Set(results.map((result) => result?.kitchenOrderId)).size).toBe(1);
    const count = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM merchant.kitchen_order
        WHERE merchant_id=$1 AND source_order_id=$2`,
      [merchantId, sourceOrderId],
    );
    expect(Number(count.rows[0]?.count)).toBe(1);
  });

  it('keeps active work during station reassignment', async () => {
    const seeded = await seedOrder([stationOne]);
    await Promise.all([
      command(seeded.order),
      repository.updateSession(merchantId, sessionOne, { stationId: stationTwo }),
    ]);
    const state = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM merchant.kitchen_order WHERE id=$1`,
      [seeded.order.id],
    );
    expect(Number(state.rows[0]?.count)).toBe(1);
    await repository.updateSession(merchantId, sessionOne, { stationId: stationOne });
  });

  it('resolves cancellation during preparation', async () => {
    const seeded = await seedOrder([stationOne]);
    expect((await command(seeded.order)).status).toBe('succeeded');
    const order = { ...seeded.order, version: 2, kitchen_order_status: 'in_preparation' as const };
    const results = await Promise.all([
      command(order, { expectedVersion: 2, commandType: 'cancel_ack' }),
      command(order, {
        expectedVersion: 2,
        commandType: 'mark_item_ready',
        itemIds: seeded.itemIds,
      }),
    ]);
    expect(results.filter((result) => result.status === 'succeeded')).toHaveLength(1);
  });
});
