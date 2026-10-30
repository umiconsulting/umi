import { createHash, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InventoryCountResult } from '@umi/contract';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import { writeOrder } from '../../shared/orders/order-writer';
import { MetricsService } from '../../shared/operations/metrics.service';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { AdministrativeCommandContextService } from '../administrative-commands/administrative-command-context.service';
import { AdministrativeCommandExecutionService } from '../administrative-commands/administrative-command-execution.service';
import { AdministrativeCommandRepository } from '../administrative-commands/administrative-command.repository';
import { IntegrityRepository } from '../integrity/integrity.repository';
import { IntegrityService } from '../integrity/integrity.service';
import { PosInventoryRepository } from './pos-inventory.repository';
import { PosInventoryService } from './pos-inventory.service';
const RUN = randomUUID().replaceAll('-', '').slice(0, 6);
const fixtureId = (suffix: number) =>
  `7e${RUN}-0000-4000-8000-${suffix.toString(16).padStart(12, '0')}`;
const [
  MERCHANT,
  LOCATION,
  USER,
  STAFF,
  DASHBOARD_SESSION,
  DEVICE,
  DURABLE_SESSION,
  OPERATOR_SESSION,
  STOCK_ROOM,
  ITEM,
  ITEM2,
] = Array.from({ length: 11 }, (_, i) => fixtureId(i + 1));
const permissions = [
  'inventory.read',
  'inventory.count.create',
  'inventory.count.submit',
  'inventory.count.reconcile',
];
const user: AuthUser = {
  id: USER,
  email: null,
  sessionId: DASHBOARD_SESSION,
  deviceId: null,
  commandContextType: 'dashboard_administrative',
};
const access = {
  merchantId: MERCHANT,
  locationId: LOCATION,
  name: 'Count recovery',
  handle: null,
  timezone: 'America/Mazatlan',
  membershipId: STAFF,
  role: 'owner',
  roles: ['owner'],
  permissions,
} as MerchantAccess;
describe('inventory count recovery with real PostgreSQL', () => {
  let pg: PgService;
  let inventory: PosInventoryService;
  let repo: PosInventoryRepository;
  let commands: AdministrativeCommandExecutionService;
  const scoped = <T>(fn: () => Promise<T>) =>
    runWithRequestContext(
      { merchantId: MERCHANT, locationId: LOCATION, userId: USER, requestId: randomUUID() },
      fn,
    );
  type Operation = Parameters<AdministrativeCommandExecutionService['execute']>[2]['operation'];
  const send = (
    operation: string,
    targetAggregateId: string,
    parameters: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) =>
    scoped(() =>
      commands.execute(user, access, {
        operation: operation as Operation,
        locationId: LOCATION,
        targetAggregateId,
        targetVersion: null,
        commandId: randomUUID(),
        idempotencyKey: randomUUID(),
        approvalId: null,
        parameters,
        ...extra,
      }),
    );
  const PRODUCT = fixtureId(12);
  const seedCommittedSale = async (input: {
    businessDate: string;
    productId: string;
    productName: string;
    inventoryItemId: string;
    quantity: number;
  }): Promise<{ saleId: string }> =>
    pg.runWithMerchant(
      MERCHANT,
      USER,
      async (client) => {
        const cartId = (
          await client.query<{ id: string }>(
            `INSERT INTO merchant.pos_cart
               (merchant_id,location_id,operator_session_id,original_operator_session_id,
                original_operator_user_id,operator_user_id,status,lifecycle_state,created_at)
             VALUES ($1::uuid,$2::uuid,$3::uuid,$3::uuid,$4::uuid,$4::uuid,
                     'committed','committed',clock_timestamp())
             RETURNING id::text AS id`,
            [MERCHANT, LOCATION, OPERATOR_SESSION, USER],
          )
        ).rows[0].id;
        const lineId = (
          await client.query<{ id: string }>(
            `INSERT INTO merchant.pos_cart_line
               (merchant_id,cart_id,product_id,identity_key,product_name,quantity,base_price,
                tax_rate_basis_points)
             VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,1,1000,1600)
             RETURNING id::text AS id`,
            [
              MERCHANT,
              cartId,
              input.productId,
              createHash('sha256').update(randomUUID()).digest('hex'),
              input.productName,
            ],
          )
        ).rows[0].id;
        const written = await writeOrder(client, {
          merchantId: MERCHANT,
          locationId: LOCATION,
          source: 'pos',
          fulfillmentType: 'dine_in',
          lines: [
            {
              productId: input.productId,
              name: input.productName,
              quantity: 1,
              unitPriceCents: 1000,
            },
          ],
        });
        const attemptId = randomUUID();
        await client.query(
          `INSERT INTO merchant.pos_payment_attempt
             (id,merchant_id,location_id,cart_id,method,amount_minor_units,currency,status,
              proof_source,correlation_id,resolved_at)
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'cash',1000,'MXN','succeeded','cash',
                   $5,clock_timestamp())`,
          [attemptId, MERCHANT, LOCATION, cartId, `recall-${attemptId}`],
        );
        const receiptId = (
          await client.query<{ id: string }>(
            `INSERT INTO merchant.receipt_snapshot
               (merchant_id,location_id,order_id,payment_attempt_id,receipt_number,
                business_date,currency,grand_total,snapshot)
             VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::date,'MXN',1000,$7::jsonb)
             RETURNING id::text AS id`,
            [
              MERCHANT,
              LOCATION,
              written.orderId,
              attemptId,
              `RECALL-${randomUUID().slice(0, 8)}`,
              input.businessDate,
              JSON.stringify({ subtotal: { minorUnits: 1000, currency: 'MXN' } }),
            ],
          )
        ).rows[0].id;
        const saleId = (
          await client.query<{ id: string }>(
            `INSERT INTO merchant.pos_committed_sale
               (merchant_id,location_id,cart_id,order_id,payment_attempt_id,
                receipt_snapshot_id,totals_fingerprint,committed_at)
             VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,
                     clock_timestamp())
             RETURNING id::text AS id`,
            [
              MERCHANT,
              LOCATION,
              cartId,
              written.orderId,
              attemptId,
              receiptId,
              createHash('sha256').update(cartId).digest('hex'),
            ],
          )
        ).rows[0].id;

        const ledger = async (
          entryType: string,
          sale: string | null,
          line: string | null,
        ): Promise<void> => {
          await client.query(
            `SELECT merchant.append_stock_ledger(
               $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::bigint,$7::uuid,$7::uuid,
               repeat('d',64),'pos_sale',$8::uuid,$9::uuid,$10::uuid,1,$11::date,
               'inventory-authoring-harness',$12::uuid,$13::uuid,null,null,'{}'::jsonb,null)`,
            [
              MERCHANT,
              LOCATION,
              STOCK_ROOM,
              input.inventoryItemId,
              entryType,
              input.quantity,
              randomUUID(),
              saleId,
              USER,
              DEVICE,
              input.businessDate,
              sale,
              line,
            ],
          );
        };
        // The sale path reserves first and commits after; `append_stock_ledger` refuses a
        // `sale_committed` that would release more than is reserved.
        await ledger('reservation_created', null, null);
        await ledger('sale_committed', saleId, lineId);
        return { saleId };
      },
      LOCATION,
    );

  const params = {
    inventoryLocationId: STOCK_ROOM,
    expectedVersion: 1,
    policyFingerprint: 'a'.repeat(64),
    approvalFingerprint: null,
    businessDate: '2026-10-30',
  };
  const start = async () =>
    (await send('inventory.count.create', STOCK_ROOM, {
      ...params,
      scope: 'full_location',
      itemIds: [],
    })) as InventoryCountResult;
  const submit = async (count: InventoryCountResult['count'], values = [9, 10]) =>
    (await send('inventory.count.submit', count.id, {
      ...params,
      countId: count.id,
      attempt: count.attempt,
      snapshotLedgerSequence: count.snapshotLedgerSequence,
      lines: [ITEM, ITEM2].map((inventoryItemId, i) => ({
        inventoryItemId,
        counted: { value: values[i], scale: 0, unit: 'unit' },
        note: null,
      })),
    })) as InventoryCountResult;
  const cancel = (count: InventoryCountResult['count'], extra: Record<string, unknown> = {}) =>
    send('inventory.count.cancel', count.id, {
      ...params,
      countId: count.id,
      expectedVersion: count.version,
      attempt: count.attempt,
      ...extra,
    });
  const reconcile = (count: InventoryCountResult['count']) =>
    send('inventory.count.reconcile', count.id, {
      ...params,
      countId: count.id,
      countAttempt: count.attempt,
      snapshotLedgerSequence: count.snapshotLedgerSequence,
      reasons: { [ITEM]: 'physical_count', [ITEM2]: 'physical_count' },
    });
  async function movement(itemId = ITEM, type = 'adjustment_decrease', quantity = 1) {
    await pg.runWithMerchant(
      MERCHANT,
      USER,
      async (client) => {
        await client.query(
          `SELECT merchant.append_stock_ledger($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::bigint,$7::uuid,$7::uuid,repeat('b',64),'count_test',$4::uuid,$8::uuid,null,null,current_date,'count-test',null,null,null,null,$9::jsonb)`,
          [
            MERCHANT,
            LOCATION,
            STOCK_ROOM,
            itemId,
            type,
            quantity,
            randomUUID(),
            USER,
            JSON.stringify({ direction: 'decrease', reason: 'operational_correction' }),
          ],
        );
      },
      LOCATION,
    );
  }
  async function balances() {
    return pg.runWithMerchant(
      MERCHANT,
      USER,
      async (client) =>
        (
          await client.query<{ onHand: string }>(
            `SELECT on_hand::text AS "onHand" FROM merchant.stock_balance WHERE inventory_location_id=$1 ORDER BY inventory_item_id`,
            [STOCK_ROOM],
          )
        ).rows.map((r) => Number(r.onHand)),
      LOCATION,
    );
  }
  beforeAll(async () => {
    const env = {
      DATABASE_URL_APP: process.env.DATABASE_URL_APP,
      DATABASE_URL_WORKER: process.env.DATABASE_URL_WORKER,
      JWT_SECRET: 'inventory-count-test-secret-00000000',
    };
    pg = new PgService({
      get: (key: string) => env[key as keyof typeof env],
    } as unknown as ConfigService<AppConfig, true>);
    await pg.onModuleInit();
    const integrity = new IntegrityService(new IntegrityRepository(pg));
    repo = new PosInventoryRepository(pg);
    inventory = new PosInventoryService(
      repo,
      integrity,
      {} as never,
      new MetricsService(),
      {} as never,
    );
    commands = new AdministrativeCommandExecutionService(
      new AdministrativeCommandContextService(new AdministrativeCommandRepository(pg)),
      {} as never,
      inventory,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await pg.query(
      `INSERT INTO merchant.merchant (id,name,handle) VALUES ($1::uuid,'Inventory Authoring',$2)
       ON CONFLICT (id) DO NOTHING`,
      [MERCHANT, `inventory-authoring-${RUN}`],
    );
    await pg.query(
      `INSERT INTO merchant.location (id,merchant_id,name) VALUES ($1::uuid,$2::uuid,'Centro')
       ON CONFLICT (id) DO NOTHING`,
      [LOCATION, MERCHANT],
    );
    await pg.query(
      `INSERT INTO umi."user" (id,full_name) VALUES ($1::uuid,'Gerente Inventario')
       ON CONFLICT (id) DO NOTHING`,
      [USER],
    );
    const role = await pg.query<{ id: string }>(
      `SELECT id FROM umi.role WHERE NOT is_platform LIMIT 1`,
    );
    await pg.query(
      `INSERT INTO merchant.staff (id,merchant_id,location_id,user_id,role_id,name)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'Gerente Inventario')
       ON CONFLICT (id) DO NOTHING`,
      [STAFF, MERCHANT, LOCATION, USER, role.rows[0]?.id ?? null],
    );
    await pg.query(
      `INSERT INTO runtime.dashboard_session (id,user_id,token_hash,expires_at)
       VALUES ($1::uuid,$2::uuid,$3,now()+interval '1 hour')
       -- REFRESH on conflict: a fixture that only inserts is a fixture that expires.
       ON CONFLICT (id) DO UPDATE SET expires_at=now()+interval '1 hour'`,
      [DASHBOARD_SESSION, USER, createHash('sha256').update(DASHBOARD_SESSION).digest('hex')],
    );
    await pg.query(
      `INSERT INTO merchant.inventory_location
         (id,merchant_id,location_id,public_reference,display_name,location_type)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'ALMACEN','Almacén','stock_room')
       ON CONFLICT (id) DO NOTHING`,
      [STOCK_ROOM, MERCHANT, LOCATION],
    );
    await pg.query(
      `INSERT INTO merchant.device (id,merchant_id,location_id,name,kind,status)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'Inventario','pos_terminal','active')
       ON CONFLICT (id) DO NOTHING`,
      [DEVICE, MERCHANT, LOCATION],
    );
    // The till's identity rows: a production batch posted from the POS names an operator
    // session and a device, exactly as every other till movement does.
    await pg.query(
      `INSERT INTO runtime.session
         (id,merchant_id,principal_type,principal_id,token_hash,expires_at)
       VALUES ($1::uuid,$2::uuid,'user',$3::uuid,md5($1::text||clock_timestamp()::text),
               now()+interval '2 hours')
       ON CONFLICT (id) DO NOTHING`,
      [DURABLE_SESSION, MERCHANT, USER],
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
        OPERATOR_SESSION,
        DURABLE_SESSION,
        USER,
        STAFF,
        DEVICE,
        MERCHANT,
        LOCATION,
        permissions,
        JSON.stringify([{ featureKey: 'pos', enabled: true }]),
      ],
    );

    await pg.query(
      `INSERT INTO merchant.product(id,merchant_id,name,price) VALUES($1,$2,'Count sale',1000)`,
      [PRODUCT, MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.inventory_policy(merchant_id,location_id,inventory_location_id,version,fingerprint,count_variance_tolerance) VALUES($1,$2,$3,'count-test',$4,100000)`,
      [MERCHANT, LOCATION, STOCK_ROOM, params.policyFingerprint],
    );
    for (const itemId of [ITEM, ITEM2]) {
      await pg.query(
        `INSERT INTO merchant.inventory_item(id,merchant_id,public_reference,display_name,item_type,base_unit,quantity_scale) VALUES($1,$2,$3,'Count item','ingredient','unit',0)`,
        [itemId, MERCHANT, itemId],
      );
      await movement(itemId, 'opening_balance', 10);
    }
  });
  afterAll(async () => {
    await pg?.onModuleDestroy();
  });
  it('cancels an obsolete submitted count and recounts without replacing a later movement', async () => {
    const initial = await start();
    const submitted = await submit(initial.count);
    await seedCommittedSale({
      businessDate: '2026-10-30',
      productId: PRODUCT,
      productName: 'Count sale',
      inventoryItemId: ITEM,
      quantity: 1,
    });
    await expect(reconcile(submitted.count)).rejects.toMatchObject({
      response: { code: 'STALE_INVENTORY_COUNT' },
    });
    expect(await balances()).toEqual([9, 10]);
    const cancelled = InventoryCountResult.parse(await cancel(submitted.count));
    expect(cancelled.count.status).toBe('cancelled');
    expect(cancelled.count.lines).toHaveLength(2);
    expect(cancelled.entries).toEqual([]);
    const replacement = await start();
    expect(replacement.count.id).not.toBe(initial.count.id);
    const recounted = await submit(replacement.count);
    expect(InventoryCountResult.parse(await reconcile(recounted.count)).count.status).toBe(
      'committed',
    );
    expect(await balances()).toEqual([9, 10]);
  });

  it('keeps a counting snapshot obsolete after a movement, then cancels with its current version', async () => {
    const initial = await start();
    await movement(ITEM2);
    await expect(submit(initial.count, [9, 9])).rejects.toMatchObject({
      response: { code: 'STALE_INVENTORY_COUNT' },
    });
    const cancelled = InventoryCountResult.parse(await cancel(initial.count));
    expect(cancelled.count.lines).toEqual([]);
    expect(await balances()).toEqual([9, 9]);
  });
  it('rejects stale cancellation versions, attempts, and inventory locations', async () => {
    const initial = await start();
    for (const extra of [
      { expectedVersion: 99 },
      { attempt: 99 },
      { inventoryLocationId: fixtureId(99) },
    ]) {
      await expect(cancel(initial.count, extra)).rejects.toMatchObject({
        response: { code: 'STALE_INVENTORY_COUNT' },
      });
    }
    const cancelled = InventoryCountResult.parse(await cancel(initial.count));
    expect(cancelled.count.version).toBe(initial.count.version + 1);
  });
  it('replays one cancellation and writes one cancellation audit event', async () => {
    const initial = await start();
    const ids = { commandId: randomUUID(), idempotencyKey: randomUUID() };
    const input = {
      ...params,
      countId: initial.count.id,
      expectedVersion: initial.count.version,
      attempt: initial.count.attempt,
    };
    const first = await send('inventory.count.cancel', initial.count.id, input, ids);
    expect(await send('inventory.count.cancel', initial.count.id, input, ids)).toEqual(first);
    const rows = await pg.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM merchant.audit_event WHERE entity_id=$1 AND event_type='inventory.count_cancelled'`,
      [initial.count.id],
    );
    expect(rows.rows[0].total).toBe('1');
  });
  it('lets another authorized operator find and cancel the active count', async () => {
    const initial = await start();
    const other = fixtureId(21),
      session = fixtureId(22);
    await pg.query(`INSERT INTO umi."user"(id,full_name) VALUES($1,'Second counter')`, [other]);
    await pg.query(
      `INSERT INTO merchant.staff(id,merchant_id,location_id,user_id,role_id,name) SELECT $1,$2,$3,$4,role_id,'Second counter' FROM merchant.staff WHERE id=$5`,
      [fixtureId(23), MERCHANT, LOCATION, other, STAFF],
    );
    await pg.query(
      `INSERT INTO runtime.dashboard_session(id,user_id,token_hash,expires_at) VALUES($1::uuid,$2::uuid,$3,now()+interval '1 hour')`,
      [session, other, createHash('sha256').update(session).digest('hex')],
    );
    const secondUser = { ...user, id: other, sessionId: session };
    const overview = await runWithRequestContext(
      { merchantId: MERCHANT, locationId: LOCATION, userId: other, requestId: randomUUID() },
      () =>
        repo.overview(other, MERCHANT, {
          locationId: LOCATION,
          operatorSessionId: session,
          limit: 100,
        }),
    );
    expect(overview.activeCount?.count.id).toBe(initial.count.id);
    const outsideArea = await repo.overview(other, MERCHANT, {
      locationId: LOCATION,
      operatorSessionId: session,
      inventoryLocationId: fixtureId(93),
      limit: 100,
    });
    expect(outsideArea.activeCount).toBeNull();

    for (const [merchantId, locationId] of [
      [fixtureId(91), LOCATION],
      [MERCHANT, fixtureId(92)],
    ]) {
      const rows = await pg.runWithMerchant(
        merchantId,
        other,
        async (client) =>
          (
            await client.query(`SELECT id FROM merchant.inventory_count WHERE id=$1`, [
              initial.count.id,
            ])
          ).rows,
        locationId,
      );
      expect(rows).toEqual([]);
    }
    const unauthorized = await pg.runWithMerchant(
      MERCHANT,
      other,
      async (client) => {
        const original = await pg.query<{ administrative_command_id: string }>(
          `SELECT administrative_command_id FROM merchant.inventory_count WHERE id=$1`,
          [initial.count.id],
        );
        await client.query(`SELECT set_config('app.inventory_count_cancel_command_id',$1,true)`, [
          original.rows[0].administrative_command_id,
        ]);
        const authorized = await client.query<{ allowed: boolean }>(
          `SELECT merchant.inventory_count_cancel_authorized($1,$2,$3) AS allowed`,
          [initial.count.id, MERCHANT, LOCATION],
        );
        const updated = await client.query(
          `UPDATE merchant.inventory_count SET status='cancelled' WHERE id=$1`,
          [initial.count.id],
        );
        return { allowed: authorized.rows[0].allowed, updated: updated.rowCount };
      },
      LOCATION,
    );
    expect(unauthorized).toEqual({ allowed: false, updated: 0 });

    const submitted = await submit(initial.count, [8, 10]);
    await expect(
      runWithRequestContext(
        { merchantId: MERCHANT, locationId: LOCATION, userId: other, requestId: randomUUID() },
        () =>
          commands.execute(secondUser, access, {
            operation: 'inventory.count.reconcile',
            locationId: LOCATION,
            targetAggregateId: initial.count.id,
            targetVersion: null,
            commandId: randomUUID(),
            idempotencyKey: randomUUID(),
            approvalId: null,
            parameters: {
              ...params,
              countId: initial.count.id,
              countAttempt: initial.count.attempt,
              snapshotLedgerSequence: initial.count.snapshotLedgerSequence,
              reasons: {},
            },
          }),
      ),
    ).rejects.toMatchObject({ response: { code: 'STALE_INVENTORY_COUNT' } });
    const result = await runWithRequestContext(
      { merchantId: MERCHANT, locationId: LOCATION, userId: other, requestId: randomUUID() },
      () =>
        commands.execute(
          secondUser,
          { ...access, membershipId: fixtureId(23) },
          {
            operation: 'inventory.count.cancel',
            locationId: LOCATION,
            targetAggregateId: initial.count.id,
            targetVersion: submitted.count.version,
            commandId: randomUUID(),
            idempotencyKey: randomUUID(),
            approvalId: null,
            parameters: {
              ...params,
              countId: initial.count.id,
              expectedVersion: submitted.count.version,
              attempt: initial.count.attempt,
            },
          },
        ),
    );
    expect(InventoryCountResult.parse(result).count.status).toBe('cancelled');
  });
  it('refuses cancellation without count creation permission', async () => {
    const initial = await start();
    await expect(
      scoped(() =>
        commands.execute(
          user,
          { ...access, permissions: ['inventory.read'] },
          {
            operation: 'inventory.count.cancel',
            locationId: LOCATION,
            targetAggregateId: initial.count.id,
            targetVersion: initial.count.version,
            commandId: randomUUID(),
            idempotencyKey: randomUUID(),
            approvalId: null,
            parameters: {
              ...params,
              countId: initial.count.id,
              expectedVersion: initial.count.version,
              attempt: initial.count.attempt,
            },
          },
        ),
      ),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
    await cancel(initial.count);
  });
  it('serializes cancellation and reconciliation with one terminal result', async () => {
    const before = await balances();
    const submitted = await submit((await start()).count, before);
    const results = await Promise.allSettled([cancel(submitted.count), reconcile(submitted.count)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ response: { code: 'STALE_INVENTORY_COUNT' } });
    expect(await balances()).toEqual(before);
  });
  it('locks every item before sequence validation and refuses a concurrent change to a zero-variance item', async () => {
    const before = await balances();
    const submitted = await submit((await start()).count, [before[0] - 1, before[1]]);
    let unlock!: () => void;
    const gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = pg.runWithMerchant(
      MERCHANT,
      USER,
      async (client) => {
        await client.query(`SELECT id FROM merchant.inventory_item WHERE id=$1 FOR UPDATE`, [
          ITEM2,
        ]);
        locked();
        await gate;
        await client.query(
          `SELECT merchant.append_stock_ledger($1::uuid,$2::uuid,$3::uuid,$4::uuid,'adjustment_decrease',1,$5::uuid,$5::uuid,repeat('c',64),'count_test',$4::uuid,$6::uuid,null,null,current_date,'concurrent-count')`,
          [MERCHANT, LOCATION, STOCK_ROOM, ITEM2, randomUUID(), USER],
        );
      },
      LOCATION,
    );
    await ready;
    let settled = false;
    const pending = reconcile(submitted.count).finally(() => {
      settled = true;
    });
    // Observe the database wait before the holder commits. This is a concurrency barrier.
    let waits = false;
    try {
      for (let i = 0; i < 100; i++) {
        const result = await pg.query<{ waiting: boolean }>(
          `SELECT exists(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0) AS waiting`,
        );
        if (result.rows[0].waiting) {
          waits = true;
          break;
        }
        if (settled) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waits).toBe(true);
      expect(settled).toBe(false);
    } finally {
      unlock();
    }
    await holder;
    await expect(pending).rejects.toMatchObject({ response: { code: 'STALE_INVENTORY_COUNT' } });
    expect(await balances()).toEqual([before[0], before[1] - 1]);
    await cancel(submitted.count);
  });

  it('requires an authenticated cancel context even for the original count operator', async () => {
    const initial = await start();
    await expect(
      pg.runWithMerchant(
        MERCHANT,
        USER,
        async (client) =>
          client.query(`UPDATE merchant.inventory_count SET status='cancelled' WHERE id=$1`, [
            initial.count.id,
          ]),
        LOCATION,
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await cancel(initial.count);
  });
  it('authorizes a POS cancellation for a different operator with count creation permission', async () => {
    const initial = await start();
    const other = fixtureId(21),
      durable = fixtureId(25),
      session = fixtureId(26);
    await pg.query(
      `INSERT INTO runtime.session(id,merchant_id,principal_type,principal_id,token_hash,expires_at) VALUES($1,$2,'user',$3,$4,now()+interval '1 hour')`,
      [durable, MERCHANT, other, createHash('sha256').update(durable).digest('hex')],
    );
    await pg.query(
      `INSERT INTO runtime.operator_session(id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,permissions,entitlements,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '1 hour')`,
      [
        session,
        durable,
        other,
        fixtureId(23),
        DEVICE,
        MERCHANT,
        LOCATION,
        ['inventory.read'],
        JSON.stringify([{ featureKey: 'pos', enabled: true }]),
      ],
    );
    const posUser = { id: other, email: null, sessionId: durable, deviceId: DEVICE };
    const input = {
      ...params,
      locationId: LOCATION,
      operatorSessionId: session,
      commandId: randomUUID(),
      idempotencyKey: randomUUID(),
      approvalId: null,
      countId: initial.count.id,
      expectedVersion: initial.count.version,
      attempt: initial.count.attempt,
    };
    const work = () =>
      runWithRequestContext(
        {
          merchantId: MERCHANT,
          locationId: LOCATION,
          userId: other,
          deviceId: DEVICE,
          requestId: randomUUID(),
        },
        () => inventory.cancelCount(posUser, MERCHANT, initial.count.id, input),
      );
    await expect(work()).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
    await pg.query(`UPDATE runtime.operator_session SET permissions=$2 WHERE id=$1`, [
      session,
      ['inventory.read', 'inventory.count.create'],
    ]);
    expect(InventoryCountResult.parse(await work()).count.status).toBe('cancelled');
  });
});
