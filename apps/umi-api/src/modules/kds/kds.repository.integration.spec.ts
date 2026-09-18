import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KitchenOrderItem, KitchenOrderProjection } from '@umi/contract';
import { KdsRepository, type OrderScopeRow } from './kds.repository';
import { KdsService } from './kds.service';
import { projectKitchenOrder } from './kitchen-projector';
import { KitchenBoardEvents } from '../realtime/kitchen-board.events';
import { writeOrder } from '../../shared/orders/order-writer';

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

  /**
   * One kitchen order with one item per named station.
   *
   * `courses` (§8H step 4) is optional and positional: `courses[i]` is the course of
   * the item routed to `stations[i]`, defaulting to 1 — the column's own default, which
   * is what every line written before courses existed means.
   */
  async function seedOrder(
    stations: string[],
    courses: number[] = [],
  ): Promise<{
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
      const courseNumber = courses[index] ?? 1;
      itemIds.push(itemId);
      await pool.query(
        `INSERT INTO merchant.order_item
           (id,order_id,product_id,name,quantity,unit_price,display_order,course_number)
         VALUES ($1,$2,'a3000000-0000-4000-8000-000000000001','Hot Item',1,100,$3,$4)`,
        [sourceItemId, sourceOrderId, index + 1, courseNumber],
      );
      await pool.query(
        `INSERT INTO merchant.kitchen_order_item
           (id,merchant_id,location_id,kitchen_order_id,source_order_id,source_order_item_id,
            station_id,status,product_id,product_name,quantity,display_order,route_reason,
            course_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'queued','a3000000-0000-4000-8000-000000000001',
                 'Hot Item',1,$8,'product',$9)`,
        [
          itemId,
          merchantId,
          locationId,
          kitchenOrderId,
          sourceOrderId,
          sourceItemId,
          stationId,
          index + 1,
          courseNumber,
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
        | 'change_priority'
        | 'fire_course';
      itemIds?: string[];
      targetStatus?: 'queued' | 'in_preparation' | 'ready' | 'completed' | 'cancelled' | null;
      courseNumber?: number | null;
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
      courseNumber: input.courseNumber ?? null,
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

  // ── §8H step 4: courses and staging ───────────────────────────────────────

  /** The board read's own view of a ticket: through `boardSnapshot`, never a bespoke SELECT. */
  async function boardItems(ticketId: string) {
    const snapshot = await repository.boardSnapshot(merchantId, locationId, [stationOne]);
    const row = snapshot.find((ticket) => ticket.ticket_id === ticketId);
    return {
      firedThroughCourse: Number(row?.fired_through_course ?? 1),
      items: (row?.items ?? []) as Array<{ courseNumber: number; fired: boolean }>,
    };
  }

  it('reads a held course as fired=false and a fired course as fired=true', async () => {
    // Course 1 (the column default) and course 2 on one ticket, so the pair that decides
    // `fired` — course_number and the ticket's watermark — is visible in one read.
    const seeded = await seedOrder([stationOne, stationOne], [1, 2]);

    const before = await boardItems(seeded.order.id);
    expect(before.firedThroughCourse).toBe(1);
    expect(before.items.map((item) => [item.courseNumber, item.fired])).toEqual([
      [1, true],
      [2, false],
    ]);

    // Firing through course 2 turns the held item onto the rail, and nothing is filtered
    // out of the view: both items are still returned.
    expect(
      (await command(seeded.order, { commandType: 'fire_course', courseNumber: 2 })).status,
    ).toBe('succeeded');
    const after = await boardItems(seeded.order.id);
    expect(after.firedThroughCourse).toBe(2);
    expect(after.items.map((item) => [item.courseNumber, item.fired])).toEqual([
      [1, true],
      [2, true],
    ]);
  });

  it('advances a course, replays as a no-op, and never rewinds the watermark', async () => {
    const seeded = await seedOrder([stationOne]);
    const commandId = randomUUID();
    const advanced = await command(seeded.order, {
      commandId,
      commandType: 'fire_course',
      courseNumber: 2,
    });
    expect(advanced.status).toBe('succeeded');
    // The ticket is bumped exactly once and its STATUS is untouched: firing a course is
    // not a move, so `deriveKitchenOrderStatus` must not have recomputed `queued`.
    expect(advanced.result).toMatchObject({ status: 'queued', version: 2 });
    const afterAdvance = await pool.query<{ fired: string; status: string; version: string }>(
      `SELECT fired_through_course::text AS fired,status,version::text AS version
         FROM merchant.kitchen_order WHERE id=$1::uuid`,
      [seeded.order.id],
    );
    expect(Number(afterAdvance.rows[0]?.fired)).toBe(2);
    expect(afterAdvance.rows[0]?.status).toBe('queued');
    expect(Number(afterAdvance.rows[0]?.version)).toBe(2);
    const events = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT safe_payload AS payload FROM merchant.kitchen_event
        WHERE kitchen_order_id=$1::uuid AND kind='order_updated'
        ORDER BY sequence`,
      [seeded.order.id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]?.payload).toMatchObject({ firedThroughCourse: 2 });

    // The same command identity is a REPLAY: the same result, no second bump, no second
    // event.
    const replay = await command(seeded.order, {
      commandId,
      commandType: 'fire_course',
      courseNumber: 2,
    });
    expect(replay).toEqual(advanced);
    const afterReplay = await pool.query<{ version: string; events: string }>(
      `SELECT ko.version::text AS version,
              (SELECT count(*)::text FROM merchant.kitchen_event e
                WHERE e.kitchen_order_id=ko.id) AS events
         FROM merchant.kitchen_order ko WHERE ko.id=$1::uuid`,
      [seeded.order.id],
    );
    expect(Number(afterReplay.rows[0]?.version)).toBe(2);
    expect(Number(afterReplay.rows[0]?.events)).toBe(1);

    // A LOWER course — a stale till, or two cooks racing — is a no-op that answers with
    // the ticket's CURRENT state. It is not an invalid transition, it does not rewind the
    // watermark and it does not light up the board again. The `expectedVersion` is
    // deliberately STALE: nothing is written, so "you asked late" is answered with the
    // current state rather than with a version conflict.
    const lower = await command(
      { ...seeded.order, version: 2 },
      { commandType: 'fire_course', courseNumber: 1, expectedVersion: 1 },
    );
    expect(lower.status).toBe('succeeded');
    expect(lower.result).toMatchObject({
      status: 'queued',
      version: 2,
      sequence: (advanced.result as { sequence: number }).sequence,
    });
    const afterLower = await pool.query<{ fired: string; version: string; events: string }>(
      `SELECT ko.fired_through_course::text AS fired,ko.version::text AS version,
              (SELECT count(*)::text FROM merchant.kitchen_event e
                WHERE e.kitchen_order_id=ko.id) AS events
         FROM merchant.kitchen_order ko WHERE ko.id=$1::uuid`,
      [seeded.order.id],
    );
    expect(Number(afterLower.rows[0]?.fired)).toBe(2);
    expect(Number(afterLower.rows[0]?.version)).toBe(2);
    expect(Number(afterLower.rows[0]?.events)).toBe(1);
  });

  it('refuses a course outside 1..20 at the database, not only in the API', async () => {
    const seeded = await seedOrder([stationOne]);
    const source = await pool.query<{ id: string }>(
      `SELECT oi.id::text AS id FROM merchant.order_item oi
         JOIN merchant.kitchen_order ko ON ko.source_order_id=oi.order_id
        WHERE ko.id=$1::uuid`,
      [seeded.order.id],
    );
    const sourceItemId = source.rows[0]?.id ?? '';
    // Raw SQL, bypassing the contract, the service and every zod schema: a writer that is
    // not this API must still be refused, and the refusal must name the guard it broke.
    await expect(
      pool.query(`UPDATE merchant.order_item SET course_number=0 WHERE id=$1::uuid`, [
        sourceItemId,
      ]),
    ).rejects.toThrow(/order_item_course_number_ck/);
    await expect(
      pool.query(`UPDATE merchant.order_item SET course_number=21 WHERE id=$1::uuid`, [
        sourceItemId,
      ]),
    ).rejects.toThrow(/order_item_course_number_ck/);
    // The bound is inclusive at the top: 20 must be accepted, so the rejection above is
    // the bound and not a broken statement.
    await pool.query(`UPDATE merchant.order_item SET course_number=20 WHERE id=$1::uuid`, [
      sourceItemId,
    ]);
    const stored = await pool.query<{ course: number }>(
      `SELECT course_number AS course FROM merchant.order_item WHERE id=$1::uuid`,
      [sourceItemId],
    );
    expect(Number(stored.rows[0]?.course)).toBe(20);
    await expect(
      pool.query(`UPDATE merchant.kitchen_order_item SET course_number=0 WHERE id=$1::uuid`, [
        seeded.itemIds[0],
      ]),
    ).rejects.toThrow(/kitchen_order_item_course_number_ck/);
    // The watermark is guarded too: it can never be pushed below course 1.
    await expect(
      pool.query(`UPDATE merchant.kitchen_order SET fired_through_course=0 WHERE id=$1::uuid`, [
        seeded.order.id,
      ]),
    ).rejects.toThrow(/kitchen_order_fired_through_course_ck/);
  });
});

/**
 * Defect D33: the POS board could not be worked.
 *
 * The iPad device route refuses a till because `ticketBelongsToDevice` needs the
 * session's station and a POS device has none. This suite drives the POS command route
 * against real rows, because the two things that made the defect hard to see are both
 * database facts: the session's station IS null, and the ticket's items ARE routed to a
 * station of the location. A fake repository would assert my own suspicion back at me.
 */
const posUser = 'a6000000-0000-4000-8000-000000000001';
const posStaff = 'a6000000-0000-4000-8000-000000000002';
const posDevice = 'a6000000-0000-4000-8000-000000000003';
const posDurableSession = 'a6000000-0000-4000-8000-000000000004';
const posOperator = 'a6000000-0000-4000-8000-000000000005';
const secondLocation = 'a1000000-0000-4000-8000-000000000002';
const secondLocationStation = 'a2000000-0000-4000-8000-000000000003';
const otherMerchant = 'a0000000-0000-4000-8000-000000000002';
const otherMerchantLocation = 'a1000000-0000-4000-8000-000000000003';

const posAuthUser = {
  id: posUser,
  email: null,
  sessionId: posDurableSession,
  deviceId: posDevice,
} as const;

describeDatabase('Gate 4A POS kitchen command', () => {
  let pool: Pool;
  let repository: KdsRepository;
  let service: KdsService;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
    const database = {
      query: <T>(text: string, values?: unknown[]) =>
        pool.query<T & Record<string, unknown>>(text, values),
      runWithMerchant: async <T>(
        tenantId: string,
        userId: string | null,
        work: (client: PoolClient) => Promise<T>,
      ): Promise<T> => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SELECT set_config('app.current_merchant', $1, true)", [tenantId]);
          await client.query("SELECT set_config('app.user_id', $1, true)", [userId ?? '']);
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
    service = new KdsService(
      repository,
      { hit: () => ({ allowed: true, remaining: 9, resetAt: 0 }) } as never,
      { emitDevicesChanged: () => undefined } as never,
      // The board's wake-up bus (§8H step 8). Its `waitForChange` is not exercised from here —
      // the watch route has its own test — but the service cannot be constructed without it.
      new KitchenBoardEvents(),
    );

    const role = await pool.query<{ id: string }>(
      `SELECT id FROM umi.role WHERE NOT is_platform LIMIT 1`,
    );
    const roleId = role.rows[0]?.id;
    if (!roleId) throw new Error('the pristine build must seed a non-platform role');
    // Idempotent, because this suite is also run against a database a previous run
    // left standing (`UMI_POS_KDS_DB_KEEP=1`): a fixture that only works on a virgin
    // database fails the second time for a reason that has nothing to do with the code.
    await pool.query(
      `INSERT INTO merchant.location (id,merchant_id,name) VALUES ($1,$2,'Patio')
       ON CONFLICT (id) DO NOTHING`,
      [secondLocation, merchantId],
    );
    await pool.query(
      `INSERT INTO merchant.merchant (id,name) VALUES ($1,'Other Cafe')
       ON CONFLICT (id) DO NOTHING`,
      [otherMerchant],
    );
    await pool.query(
      `INSERT INTO merchant.location (id,merchant_id,name) VALUES ($1,$2,'Other room')
       ON CONFLICT (id) DO NOTHING`,
      [otherMerchantLocation, otherMerchant],
    );
    await pool.query(
      `INSERT INTO merchant.product (id,merchant_id,name,price,requires_preparation)
       VALUES ('a3000000-0000-4000-8000-000000000002',$1,'Hot Item',100,true)
       ON CONFLICT (id) DO NOTHING`,
      [otherMerchant],
    );
    // The other room has its own oven, so a ticket there is genuinely ROUTED and still
    // out of this operator's scope — which is the point of that refusal: the ticket is
    // real, it is just not this location's work.
    await pool.query(
      `INSERT INTO merchant.station (id,merchant_id,location_id,key,name)
       VALUES ($1,$2,$3,'patio_hot','Patio Hot')
       ON CONFLICT (id) DO NOTHING`,
      [secondLocationStation, merchantId, secondLocation],
    );
    await pool.query(
      `INSERT INTO umi.user (id,email,full_name,status)
       VALUES ($1,'pos-kitchen@example.test','POS Cook','active')
       ON CONFLICT (id) DO NOTHING`,
      [posUser],
    );
    await pool.query(
      `INSERT INTO merchant.staff (id,merchant_id,location_id,user_id,role_id,name)
       VALUES ($1,$2,$3,$4,$5,'POS Cook')
       ON CONFLICT (id) DO NOTHING`,
      [posStaff, merchantId, locationId, posUser, roleId],
    );
    // The till: a POS device with NO station, which is the defect's whole premise.
    await pool.query(
      `INSERT INTO merchant.device (id,merchant_id,location_id,station_id,name,kind,status,credential_version)
       VALUES ($1,$2,$3,NULL,'Till','pos_terminal','active',1)
       ON CONFLICT (id) DO UPDATE SET station_id=NULL, status='active'`,
      [posDevice, merchantId, locationId],
    );
    await pool.query(
      `INSERT INTO runtime.session (id,merchant_id,principal_type,principal_id,token_hash)
       VALUES ($1,$2,'user',$3,'pos-kitchen-probe')
       ON CONFLICT (id) DO UPDATE SET is_active=true, revoked_at=NULL`,
      [posDurableSession, merchantId, posUser],
    );
  });

  afterAll(async () => pool.end());

  const grantOperator = (permissions: string[]) =>
    pool.query(
      `INSERT INTO runtime.operator_session
         (id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,
          permissions,entitlements,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],
               '[{"featureKey":"pos","enabled":true}]',now()+interval '1 hour')
       ON CONFLICT (id) DO UPDATE
         SET permissions=excluded.permissions, state='active', ended_at=NULL,
             expires_at=excluded.expires_at`,
      [
        posOperator,
        posDurableSession,
        posUser,
        posStaff,
        posDevice,
        merchantId,
        locationId,
        permissions,
      ],
    );

  /** A kitchen order with one item per named station, at any merchant/location. */
  async function seedTicket(
    merchant: string,
    location: string,
    stations: (string | null)[],
    productId = 'a3000000-0000-4000-8000-000000000001',
  ): Promise<{ kitchenOrderId: string; version: number; itemIds: string[] }> {
    const sourceOrderId = randomUUID();
    const kitchenOrderId = randomUUID();
    await pool.query(
      `INSERT INTO merchant.customer_order
         (id,merchant_id,location_id,source,fulfillment_type,status,business_date,external_ref)
       VALUES ($1,$2,$3,'pos','dine_in','completed',current_date,$4)`,
      [sourceOrderId, merchant, location, `pos-kitchen-${sourceOrderId}`],
    );
    await pool.query(
      `INSERT INTO merchant.kitchen_order
         (id,merchant_id,location_id,source_order_id,public_reference,source,
          fulfillment_type,business_date,status,queued_at)
       VALUES ($1,$2,$3,$4,$5,'pos','dine_in',current_date,'queued',clock_timestamp())`,
      [kitchenOrderId, merchant, location, sourceOrderId, kitchenOrderId],
    );
    const itemIds: string[] = [];
    for (const [index, station] of stations.entries()) {
      const itemId = randomUUID();
      const sourceItemId = randomUUID();
      itemIds.push(itemId);
      // The kitchen item points at the commercial line it was projected from, so the
      // fixture has to create that line too — the FK is the reason a kitchen ticket
      // can never be about a sale that does not exist.
      await pool.query(
        `INSERT INTO merchant.order_item
           (id,order_id,product_id,name,quantity,unit_price,display_order)
         VALUES ($1,$2,$3,'Hot Item',1,100,$4)`,
        [sourceItemId, sourceOrderId, productId, index + 1],
      );
      await pool.query(
        `INSERT INTO merchant.kitchen_order_item
           (id,merchant_id,location_id,kitchen_order_id,source_order_id,source_order_item_id,
            station_id,status,product_id,product_name,quantity,display_order,route_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Hot Item',1,$10,'product')`,
        [
          itemId,
          merchant,
          location,
          kitchenOrderId,
          sourceOrderId,
          sourceItemId,
          station,
          // `kitchen_item_routing_ck`: an item with no station is an EXCEPTION, never
          // ordinary queued work. That is how the unrouted case is reachable at all.
          station === null ? 'exception' : 'queued',
          productId,
          index + 1,
        ],
      );
    }
    return { kitchenOrderId, version: 1, itemIds };
  }

  const commandForPos = (
    ticket: string,
    input: {
      commandType:
        | 'start_preparation'
        | 'mark_item_ready'
        | 'complete'
        | 'recall'
        | 'change_priority'
        | 'fire_course';
      expectedVersion?: number;
      itemIds?: string[];
      reasonCode?: string | null;
      priority?: 'normal' | 'high' | 'urgent' | null;
      courseNumber?: number | null;
      locationId?: string;
      commandId?: string;
      idempotencyKey?: string;
    },
  ) => {
    const commandId = input.commandId ?? randomUUID();
    return service.commandForPos(posAuthUser, merchantId, {
      action: 'command',
      commandId,
      idempotencyKey: input.idempotencyKey ?? commandId,
      correlationId: `pos-${commandId}`,
      expectedVersion: input.expectedVersion ?? 1,
      kitchenOrderId: ticket,
      commandType: input.commandType,
      itemIds: input.itemIds ?? [],
      reasonCode: input.reasonCode ?? null,
      reasonNote: null,
      priority: input.priority ?? null,
      courseNumber: input.courseNumber ?? null,
      locationId: input.locationId ?? locationId,
      operatorSessionId: posOperator,
    });
  };

  it('lets a station-less POS session work a ticket at its own location', async () => {
    await grantOperator(['kitchen.read', 'kitchen.prepare', 'kitchen.ready']);
    const ticket = await seedTicket(merchantId, locationId, [stationOne, stationTwo]);

    const started = await commandForPos(ticket.kitchenOrderId, {
      commandType: 'start_preparation',
    });
    expect(started.ok).toBe(true);

    const bumped = await commandForPos(ticket.kitchenOrderId, {
      commandType: 'mark_item_ready',
      expectedVersion: 2,
      itemIds: [ticket.itemIds[0]],
    });
    expect(bumped.ok).toBe(true);
    expect(bumped.data).toMatchObject({ status: 'partially_ready', version: 3 });

    const items = await pool.query<{ status: string }>(
      `SELECT status FROM merchant.kitchen_order_item WHERE id=$1`,
      [ticket.itemIds[0]],
    );
    expect(items.rows[0]?.status).toBe('ready');

    // The journal records the PERSON, not the box: `kitchen_command` permits exactly
    // one of device_id / actor_user_id, and a till command is attributable to the
    // operator session that authorised it.
    const journal = await pool.query<{ device_id: string | null; actor_user_id: string | null }>(
      `SELECT device_id::text,actor_user_id::text FROM merchant.kitchen_command
        WHERE merchant_id=$1 AND kitchen_order_id=$2 ORDER BY created_at`,
      [merchantId, ticket.kitchenOrderId],
    );
    expect(journal.rows).toHaveLength(2);
    for (const row of journal.rows) {
      expect(row.device_id).toBeNull();
      expect(row.actor_user_id).toBe(posUser);
    }
  });

  it('replays a repeated POS command identity instead of bumping twice', async () => {
    await grantOperator(['kitchen.read', 'kitchen.prepare', 'kitchen.ready']);
    const ticket = await seedTicket(merchantId, locationId, [stationOne]);
    const commandId = randomUUID();

    const first = await commandForPos(ticket.kitchenOrderId, {
      commandType: 'mark_item_ready',
      itemIds: ticket.itemIds,
      commandId,
    });
    const replay = await commandForPos(ticket.kitchenOrderId, {
      commandType: 'mark_item_ready',
      itemIds: ticket.itemIds,
      commandId,
    });
    expect(replay).toEqual(first);

    const rows = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM merchant.kitchen_command WHERE id=$1`,
      [commandId],
    );
    expect(Number(rows.rows[0]?.count)).toBe(1);
    const version = await pool.query<{ version: string }>(
      `SELECT version::text FROM merchant.kitchen_order_item WHERE id=$1`,
      [ticket.itemIds[0]],
    );
    expect(Number(version.rows[0]?.version)).toBe(2);
  });

  it('refuses a ticket at another location with its own code', async () => {
    await grantOperator(['kitchen.read', 'kitchen.prepare', 'kitchen.ready']);
    const ticket = await seedTicket(merchantId, secondLocation, [secondLocationStation]);
    await expect(
      commandForPos(ticket.kitchenOrderId, { commandType: 'start_preparation' }),
    ).rejects.toMatchObject({
      response: { code: 'KITCHEN_ORDER_OUT_OF_SCOPE' },
    });
  });

  it('refuses a ticket at another merchant as not found', async () => {
    await grantOperator(['kitchen.read', 'kitchen.prepare', 'kitchen.ready']);
    const ticket = await seedTicket(
      otherMerchant,
      otherMerchantLocation,
      [null],
      'a3000000-0000-4000-8000-000000000002',
    );
    await expect(
      commandForPos(ticket.kitchenOrderId, { commandType: 'start_preparation' }),
    ).rejects.toMatchObject({ response: { code: 'KITCHEN_ORDER_NOT_FOUND' } });
  });

  it('names the permission a command needs when the operator lacks it', async () => {
    // `kitchen.read` opens the board — the session is live and may look. It is
    // `kitchen.ready` that a bump needs, and the refusal must say so.
    await grantOperator(['kitchen.read', 'kitchen.prepare']);
    const ticket = await seedTicket(merchantId, locationId, [stationOne]);
    await expect(
      commandForPos(ticket.kitchenOrderId, {
        commandType: 'mark_item_ready',
        itemIds: ticket.itemIds,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'KITCHEN_PERMISSION_REQUIRED',
        details: { requiredPermission: 'kitchen.ready' },
      },
    });
  });

  it('refuses a session that is not authorised at all', async () => {
    await grantOperator(['kitchen.prepare']);
    const ticket = await seedTicket(merchantId, locationId, [stationOne]);
    await expect(
      commandForPos(ticket.kitchenOrderId, { commandType: 'start_preparation' }),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
  });

  it('refuses a ticket no active station of the location holds', async () => {
    await grantOperator(['kitchen.read', 'kitchen.prepare']);
    const ticket = await seedTicket(merchantId, locationId, [null]);
    await expect(
      commandForPos(ticket.kitchenOrderId, { commandType: 'start_preparation' }),
    ).rejects.toMatchObject({ response: { code: 'KITCHEN_ORDER_NOT_ROUTED' } });
  });

  it('lets recall through once the operator holds kitchen.recall, and demands a reason', async () => {
    await grantOperator(['kitchen.read', 'kitchen.prepare', 'kitchen.recall']);
    const ticket = await seedTicket(merchantId, locationId, [stationOne]);
    await expect(
      commandForPos(ticket.kitchenOrderId, { commandType: 'recall' }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });

    const recalled = await commandForPos(ticket.kitchenOrderId, {
      commandType: 'recall',
      reasonCode: 'too_early',
    });
    expect(recalled.ok).toBe(true);
    expect(recalled.data).toMatchObject({ status: 'in_preparation' });
  });

  /**
   * §8H step 4 through the till's own route: `fire_course` is the same command as the
   * iPad's, and the existing `pos.kitchenCommand` route carries it — no new route.
   */
  it('fires a course through the POS route, and refuses one outside 1..20', async () => {
    await grantOperator(['kitchen.read', 'kitchen.prepare']);
    const ticket = await seedTicket(merchantId, locationId, [stationOne]);

    const fired = await commandForPos(ticket.kitchenOrderId, {
      commandType: 'fire_course',
      courseNumber: 2,
    });
    expect(fired.ok).toBe(true);
    expect(fired.data).toMatchObject({ status: 'queued', version: 2 });
    const row = await pool.query<{ fired: number; status: string }>(
      `SELECT fired_through_course AS fired,status FROM merchant.kitchen_order
        WHERE id=$1::uuid`,
      [ticket.kitchenOrderId],
    );
    expect(Number(row.rows[0]?.fired)).toBe(2);
    // The status is the ticket's own: a course never moves it.
    expect(row.rows[0]?.status).toBe('queued');

    // The board read the till actually draws must satisfy the STRICT projection — the
    // course and the derived flag included. A `safeParse` that fails prints the zod
    // issues, so a missing field names itself instead of surfacing as a blank board.
    const board = await service.boardForPos(posAuthUser, merchantId, {
      locationId,
      operatorSessionId: posOperator,
    });
    const snapshot = board.data.find((entry) => entry.id === ticket.kitchenOrderId);
    expect(snapshot).toBeDefined();
    const parsed = KitchenOrderProjection.safeParse(snapshot);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    expect(KitchenOrderItem.safeParse((snapshot as { items: unknown[] }).items[0]).success).toBe(
      true,
    );

    // Out of range is a 400 that NAMES the field, not a database constraint violation.
    const other = await seedTicket(merchantId, locationId, [stationOne]);
    await expect(
      commandForPos(other.kitchenOrderId, { commandType: 'fire_course', courseNumber: 21 }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
    await expect(
      commandForPos(other.kitchenOrderId, { commandType: 'fire_course', courseNumber: null }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
  });

  it('counts the day per item, and the count follows what was ordered', async () => {
    // Asserted as a DELTA, not as an absolute: this suite shares one merchant and
    // location across its cases, so an absolute number would depend on the order
    // vitest ran them in. The delta is what this is about — three more of the same
    // dish means the all-day count moves by three.
    const day = await repository.allDayBusinessDate(merchantId, locationId, null);
    expect(day).toBeTruthy();
    const before = await repository.allDayCounts(merchantId, locationId, day!);
    const beforeHot = before.find((row) => row.productName === 'Hot Item')?.ordered ?? 0;

    // Three lines of the same dish, so the aggregate has to SUM and not count rows.
    await seedTicket(merchantId, locationId, [stationOne, stationOne, stationOne]);

    const after = await repository.allDayCounts(merchantId, locationId, day!);
    const hot = after.find((row) => row.productName === 'Hot Item');
    expect(hot?.ordered).toBe(beforeHot + 3);
    // Everything just seeded is still on the rail, so it is all outstanding too.
    expect(hot?.outstanding).toBeGreaterThanOrEqual(3);
  });

  /**
   * §8H step 4, behaviour 1: a course the cashier set on a CART line survives all the
   * way to `merchant.kitchen_order_item.course_number`.
   *
   * Driven through real rows at every hop — `merchant.pos_cart` + `merchant.pos_cart_line`,
   * then `writeOrder` (which projects the kitchen itself) — because the whole point of the
   * migration is that the fact is expressible end to end. A cart-shaped mock would assert
   * that the column exists in my head, not in the database.
   */
  it('carries a cart line course through writeOrder to the kitchen line', async () => {
    await grantOperator(['kitchen.read', 'kitchen.prepare']);
    // Fixed ids, because this suite is also run against a database a previous run left
    // standing (UMI_POS_KDS_DB_KEEP=1) and a cart that only works on a virgin database
    // fails the second time for a reason that has nothing to do with courses.
    const cartId = 'ac000000-0000-4000-8000-000000000001';
    const cartLineId = 'ac000000-0000-4000-8000-000000000002';
    // A terminal cart, so it stays out of the one-live-cart-per-operator index; the rows
    // themselves are ordinary cart rows, which is all this test reads.
    await pool.query(
      `INSERT INTO merchant.pos_cart
         (id,merchant_id,location_id,operator_session_id,original_operator_session_id,
          original_operator_user_id,operator_user_id,status,version,lifecycle_state)
       VALUES ($1,$2,$3,$4,$4,$5,$5,'draft',1,'committed')
       ON CONFLICT (id) DO NOTHING`,
      [cartId, merchantId, locationId, posOperator, posUser],
    );
    await pool.query(
      `INSERT INTO merchant.pos_cart_line
         (id,merchant_id,cart_id,product_id,identity_key,product_name,quantity,base_price,
          tax_rate_basis_points,course_number)
       VALUES ($1,$2,$3,'a3000000-0000-4000-8000-000000000001',$4,'Hot Item',1,100,1600,2)
       ON CONFLICT (id) DO UPDATE SET course_number=excluded.course_number`,
      [
        cartLineId,
        merchantId,
        cartId,
        createHash('sha256').update('gate4a-cart-line-course').digest('hex'),
      ],
    );
    // The cart half: the till's intent is a fact on the line before any sale exists.
    const cartLine = await pool.query<{ course: number }>(
      `SELECT course_number AS course FROM merchant.pos_cart_line WHERE id=$1::uuid`,
      [cartLineId],
    );
    expect(Number(cartLine.rows[0]?.course)).toBe(2);
    // …and the guard that makes it a course rather than an arbitrary number, from raw SQL.
    await expect(
      pool.query(`UPDATE merchant.pos_cart_line SET course_number=21 WHERE id=$1::uuid`, [
        cartLineId,
      ]),
    ).rejects.toThrow(/pos_cart_line_course_number_ck/);

    // `writeOrder` takes a client, not a pool, so it composes into the caller's
    // transaction — the same shape the POS checkout gives it.
    const orderId = await (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const written = await writeOrder(client, {
          merchantId,
          locationId,
          source: 'pos',
          fulfillmentType: 'dine_in',
          // A fresh order each run, so the assertion reads THIS run's projection rather
          // than a row a previous run left behind.
          externalRef: `gate4a-course-${randomUUID()}`,
          lines: [
            {
              productId: 'a3000000-0000-4000-8000-000000000001',
              name: 'Hot Item',
              quantity: 1,
              unitPriceCents: 100,
              courseNumber: 2,
            },
          ],
        });
        await client.query('COMMIT');
        return written.orderId;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    })();

    // The commercial record of the sale keeps the course…
    const sourceLine = await pool.query<{ course: number }>(
      `SELECT course_number AS course FROM merchant.order_item WHERE order_id=$1::uuid`,
      [orderId],
    );
    expect(sourceLine.rows.map((row) => Number(row.course))).toEqual([2]);
    // …and so does the kitchen's own copy, written by the projector inside writeOrder.
    const kitchenLine = await pool.query<{ course: number }>(
      `SELECT i.course_number AS course FROM merchant.kitchen_order_item i
         JOIN merchant.kitchen_order ko
           ON ko.id=i.kitchen_order_id AND ko.merchant_id=i.merchant_id
        WHERE ko.source_order_id=$1::uuid`,
      [orderId],
    );
    expect(kitchenLine.rows.map((row) => Number(row.course))).toEqual([2]);
  });

  /**
   * §8.5 and D8: the ticket's allergen list is DERIVED from the product's recipe.
   *
   * The fixture attaches the label to the INGREDIENT and maps the seeded product to a
   * recipe that consumes that ingredient, and the assertion reads the label back off the
   * board. Retiring the recipe and its mapping must then remove the label from a FRESH
   * read — a list stored on `kitchen_order_item` would pass the first half and fail the
   * second, which is exactly the staleness D8 refuses.
   */
  it('derives a ticket item allergen from the recipe, and drops it when the recipe retires', async () => {
    const product = 'a3000000-0000-4000-8000-000000000001';
    const allergenId = '8a000000-0000-4000-8000-000000000001';
    const ingredientId = '8a000000-0000-4000-8000-000000000002';
    const recipeId = '8a000000-0000-4000-8000-000000000003';
    const mappingId = '8a000000-0000-4000-8000-000000000004';
    const code = 'sesame';
    const label = 'Ajonjoli';

    // The ingredient, its label, the recipe that consumes it and the product's mapping
    // to that recipe, all written as rows: the explosion has real rows to walk.
    await pool.query(
      `INSERT INTO merchant.inventory_item
         (id,merchant_id,public_reference,display_name,item_type,base_unit)
       VALUES ($1::uuid,$2::uuid,$3,'Ajonjoli','ingredient','gram')
       ON CONFLICT (id) DO UPDATE SET active=true,archived_at=null`,
      [ingredientId, merchantId, `gate4a-sesame-${ingredientId.slice(0, 8)}`],
    );
    await pool.query(
      `INSERT INTO merchant.inventory_allergen (id,merchant_id,code,label)
       VALUES ($1::uuid,$2::uuid,$3,$4)
       ON CONFLICT (id) DO UPDATE SET active=true,archived_at=null`,
      [allergenId, merchantId, code, label],
    );
    await pool.query(
      `INSERT INTO merchant.inventory_item_allergen
         (merchant_id,inventory_item_id,inventory_allergen_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid)
       ON CONFLICT (merchant_id,inventory_item_id,inventory_allergen_id) DO NOTHING`,
      [merchantId, ingredientId, allergenId],
    );
    await pool.query(
      `INSERT INTO merchant.inventory_recipe
         (id,merchant_id,product_id,version,yield_quantity,yield_scale,yield_unit,active)
       VALUES ($1::uuid,$2::uuid,$3::uuid,1,1,0,'portion',true)
       ON CONFLICT (id) DO UPDATE SET active=true,retired_at=null`,
      [recipeId, merchantId, product],
    );
    await pool.query(
      `INSERT INTO merchant.inventory_recipe_component
         (merchant_id,recipe_id,inventory_item_id,quantity,unit,quantity_scale)
       VALUES ($1::uuid,$2::uuid,$3::uuid,1,'gram',0)
       ON CONFLICT (recipe_id,inventory_item_id,modifier_id) DO NOTHING`,
      [merchantId, recipeId, ingredientId],
    );
    await pool.query(
      `INSERT INTO merchant.inventory_catalog_mapping
         (id,merchant_id,product_id,mapping_type,recipe_id,version,active)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'recipe',$4::uuid,1,true)
       ON CONFLICT (id) DO UPDATE SET active=true,retired_at=null`,
      [mappingId, merchantId, product, recipeId],
    );

    const seeded = await seedTicket(merchantId, locationId, [stationOne]);
    const snapshot = await repository.boardSnapshot(merchantId, locationId, [stationOne]);
    const ticket = snapshot.find((row) => row.ticket_id === seeded.kitchenOrderId);
    const items = (ticket?.items ?? []) as Array<{
      allergens: Array<{ code: string; label: string }>;
    }>;
    expect(items[0]?.allergens).toEqual([{ code, label }]);

    // Retire the recipe AND the mapping that points at it: the catalog-side statement
    // "this product no longer maps to that recipe" is `inventory_catalog_mapping.active`,
    // and the explosion is keyed on it (`product_allergen_labels`).
    await pool.query(
      `UPDATE merchant.inventory_recipe
          SET active=false,retired_at=clock_timestamp() WHERE id=$1::uuid`,
      [recipeId],
    );
    await pool.query(
      `UPDATE merchant.inventory_catalog_mapping
          SET active=false,retired_at=clock_timestamp() WHERE id=$1::uuid`,
      [mappingId],
    );

    const after = await repository.boardSnapshot(merchantId, locationId, [stationOne]);
    const afterItems = (after.find((row) => row.ticket_id === seeded.kitchenOrderId)?.items ??
      []) as Array<{
      allergens: unknown[];
    }>;
    expect(afterItems[0]?.allergens).toEqual([]);

    // And the line itself never stored a list: the fact lives in the recipe, not here.
    const stored = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.columns
        WHERE table_schema='merchant' AND table_name='kitchen_order_item'
          AND column_name LIKE '%allergen%'`,
    );
    expect(stored.rows[0]?.count).toBe('0');
  });
});
