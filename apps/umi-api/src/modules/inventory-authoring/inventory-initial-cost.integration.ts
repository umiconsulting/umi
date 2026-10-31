import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MetricsService } from '../../shared/operations/metrics.service';
import { createHash, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InventoryAuthoringItemQuery,
  InventoryAuthoringItemUpdateRequest,
  InventoryRecipeQuery,
  type CreatePurchaseOrderRequest,
} from '@umi/contract';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { writeOrder } from '../../shared/orders/order-writer';
import { runWithRequestContext } from '../../shared/database/request-context';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { AdministrativeCommandContextService } from '../administrative-commands/administrative-command-context.service';
import { AdministrativeCommandExecutionService } from '../administrative-commands/administrative-command-execution.service';
import { AdministrativeCommandRepository } from '../administrative-commands/administrative-command.repository';
import { IntegrityRepository } from '../integrity/integrity.repository';
import { IntegrityService } from '../integrity/integrity.service';
import { InventoryCostingRepository } from '../inventory-costing/inventory-costing.repository';
import { InventoryCostingService } from '../inventory-costing/inventory-costing.service';
import { PosInventoryRepository } from '../pos-inventory/pos-inventory.repository';
import { PosInventoryService } from '../pos-inventory/pos-inventory.service';
import { ProcurementRepository } from '../procurement/procurement.repository';
import { ProcurementService } from '../procurement/procurement.service';
import { InventoryAuthoringRepository } from './inventory-authoring.repository';
import { InventoryAuthoringService } from './inventory-authoring.service';

const APP_DSN = process.env.DATABASE_URL_APP;
const WORKER_DSN = process.env.DATABASE_URL_WORKER;

const JWT_SECRET = 'inventory-authoring-harness-secret-000000';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
    JWT_SECRET,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

/** Six hex digits of this run, so two runs cannot collide on a reference. */
const RUN = randomUUID().replace(/-/g, '').slice(0, 6);
const fixtureId = (suffix: number): string =>
  `7f${RUN}-0000-4000-8000-${suffix.toString(16).padStart(12, '0')}`;

const MERCHANT = fixtureId(0xa1);
const LOCATION = fixtureId(0xa2);
const USER = fixtureId(0xc1);
const STAFF = fixtureId(0xc2);
const DASHBOARD_SESSION = fixtureId(0xc3);
const DEVICE = fixtureId(0xc4);
const DURABLE_SESSION = fixtureId(0xc5);
const OPERATOR_SESSION = fixtureId(0xc6);
const STOCK_ROOM = fixtureId(0xd1);

const PRODUCT_PLATE = fixtureId(0xee);
const SUPPLIER = fixtureId(0xbc);
const PLATE_PRICE_MINOR = 45000;

const user: AuthUser = {
  id: USER,
  email: null,
  sessionId: DASHBOARD_SESSION,
  deviceId: null,
  commandContextType: 'dashboard_administrative',
};

const access: MerchantAccess = {
  merchantId: MERCHANT,
  locationId: LOCATION,
  name: 'Inventory Authoring Harness',
  handle: null,
  timezone: 'America/Mazatlan',
  membershipId: STAFF,
  role: 'owner',
  roles: ['owner'],
  permissions: [
    'inventory.item.manage',
    'inventory.conversion.manage',
    'inventory.recipe.manage',
    // The kitchen's own key (migration 76, plan §11 phase 3).
    'inventory.production.produce',
    'inventory.adjust.decrease',
    'inventory.adjust.increase',
  ],
};

describe('initial inventory cost through administrative commands', () => {
  let pg: PgService;
  let authoring: InventoryAuthoringService;
  let inventory: PosInventoryService;
  let commands: AdministrativeCommandExecutionService;
  let procurement: ProcurementService;
  let costing: InventoryCostingService;
  const scoped = <T>(fn: () => Promise<T>) =>
    runWithRequestContext(
      { merchantId: MERCHANT, locationId: LOCATION, userId: USER, requestId: randomUUID() },
      fn,
    );

  type CommandInput = {
    targetAggregateId: string;
    targetVersion?: number | null;
    parameters?: Record<string, unknown>;
    commandId?: string;
    idempotencyKey?: string;
  };

  /** The operation names the contract's own command model accepts. */
  type Operation = Parameters<AdministrativeCommandExecutionService['execute']>[2]['operation'];

  /** One administrative command, exactly as the console posts it. */
  const send = (operation: Operation, input: CommandInput) =>
    scoped(() =>
      commands.execute(user, access, {
        operation,
        locationId: LOCATION,
        targetAggregateId: input.targetAggregateId,
        targetVersion: input.targetVersion ?? null,
        commandId: input.commandId ?? randomUUID(),
        idempotencyKey: input.idempotencyKey ?? randomUUID(),
        parameters: input.parameters ?? {},
        approvalId: null,
      }),
    );

  const receive = async (input: {
    inventoryItemId: string;
    quantity: { value: number; scale: number; unit: string };
    unitCostMinor: number;
  }): Promise<void> => {
    const lineTotalMinor = Math.round(
      (input.quantity.value * input.unitCostMinor) / 10 ** input.quantity.scale,
    );
    const quantity = input.quantity as CreatePurchaseOrderRequest['lines'][0]['quantity'];
    const created = await scoped(() =>
      procurement.createPurchaseOrder(access, {
        locationId: LOCATION,
        idempotencyKey: randomUUID(),
        inventoryLocationId: STOCK_ROOM,
        supplierId: SUPPLIER,
        currency: 'MXN',
        expectedOn: null,
        note: null,
        lines: [
          {
            inventoryItemId: input.inventoryItemId,
            supplierSku: null,
            description: null,
            quantity,
            unitCostMinor: input.unitCostMinor,
            lineTotalMinor,
          },
        ],
      }),
    );
    const sent = await scoped(() =>
      procurement.sendPurchaseOrder(access, {
        locationId: LOCATION,
        idempotencyKey: randomUUID(),
        purchaseOrderId: created.purchaseOrder.id,
        expectedVersion: created.purchaseOrder.version,
      }),
    );
    await scoped(() =>
      procurement.receivePurchaseOrder(access, {
        locationId: LOCATION,
        idempotencyKey: randomUUID(),
        purchaseOrderId: sent.purchaseOrder.id,
        expectedVersion: sent.purchaseOrder.version,
        note: null,
        lines: [
          {
            purchaseOrderLineId: sent.purchaseOrder.lines[0].id,
            quantity,
            actualUnitCostMinor: input.unitCostMinor,
            lineTotalMinor,
          },
        ],
      }),
    );
  };

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

  beforeAll(async () => {
    if (!APP_DSN || !WORKER_DSN) {
      throw new Error(
        'Set DATABASE_URL_APP and DATABASE_URL_WORKER to a disposable build-v3-76 database.',
      );
    }
    pg = new PgService(makeConfig());
    await pg.onModuleInit();

    costing = new InventoryCostingService(new InventoryCostingRepository(pg), new MetricsService());
    const integrity = new IntegrityService(new IntegrityRepository(pg));
    authoring = new InventoryAuthoringService(
      new InventoryAuthoringRepository(pg),
      integrity,
      // The recipe cost reuses the costing module's own basis read; this is the same
      // wiring the Nest module does, so the suite exercises the real dependency.
      new InventoryCostingService(new InventoryCostingRepository(pg), new MetricsService()),
    );
    // The till's own surface, wired exactly as `PosInventoryModule` does, so the
    // production case below drives the SAME service method the POS route calls.
    inventory = new PosInventoryService(
      new PosInventoryRepository(pg),
      integrity,
      new InventoryCostingService(new InventoryCostingRepository(pg), new MetricsService()),
      new MetricsService(),
      new InventoryAuthoringService(
        new InventoryAuthoringRepository(pg),
        integrity,
        new InventoryCostingService(new InventoryCostingRepository(pg), new MetricsService()),
      ),
    );
    procurement = new ProcurementService(
      new ProcurementRepository(pg),
      integrity,
      new MetricsService(),
    );
    const contexts = new AdministrativeCommandContextService(
      new AdministrativeCommandRepository(pg),
    );
    // Only the context service and the inventory-authoring service are reachable
    // from these six operations; the other dispatchers are not exercised here.
    commands = new AdministrativeCommandExecutionService(
      contexts,
      {} as never,
      inventory,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      authoring,
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
        ['inventory.read', 'inventory.production.produce'],
        JSON.stringify([{ featureKey: 'pos', enabled: true }]),
      ],
    );
    // The recipe fixtures need a supplier to receive from and a product to price: the
    // cost basis is the weighted average of RECEIPTS, so a plate's cost cannot be
    // asserted without a real purchase order behind it.
    await pg.query(
      `INSERT INTO merchant.supplier (id,merchant_id,public_reference,display_name)
       VALUES ($1::uuid,$2::uuid,'PROVEEDOR-RECETAS','Proveedor de recetas')
       ON CONFLICT (id) DO NOTHING`,
      [SUPPLIER, MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.product (id,merchant_id,name,price,active)
       VALUES ($1::uuid,$2::uuid,'Plato de prueba',$3,true)
       ON CONFLICT (id) DO NOTHING`,
      [PRODUCT_PLATE, MERCHANT, PLATE_PRICE_MINOR],
    );
  });

  afterAll(async () => {
    await pg?.onModuleDestroy?.();
  });

  it('uses the initial amount until real receipts take priority', async () => {
    const initialUnitCostMinor = 10000;
    const ingredientQuantity = { value: 125, scale: 2, unit: 'kilogram' };
    const id = randomUUID();
    const recipeId = randomUUID();
    const create = {
      targetAggregateId: id,
      commandId: randomUUID(),
      idempotencyKey: randomUUID(),
      parameters: {
        publicReference: `INITIAL-${RUN}`,
        displayName: 'Harina inicial',
        itemType: 'ingredient',
        baseUnit: 'kilogram',
        quantityScale: 2,
        trackingPolicy: 'tracked',
        negativeStockPolicy: 'block',
        initialUnitCostMinor,
      },
    };
    const created = (await send('inventory.item.create', create)) as {
      item: { initialUnitCostMinor: number; version: number };
    };
    expect(created.item.initialUnitCostMinor).toBe(initialUnitCostMinor);
    expect(await send('inventory.item.create', create)).toEqual(created);
    await send('inventory.recipe.create', {
      targetAggregateId: recipeId,
      parameters: {
        targetKind: 'product',
        productId: PRODUCT_PLATE,
        yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
        components: [{ inventoryItemId: id, quantity: ingredientQuantity }],
      },
    });
    const readRecipe = async () =>
      (await scoped(() => authoring.recipes(access, InventoryRecipeQuery.parse({})))).recipes.find(
        (r) => r.id === recipeId,
      )!;
    const readBasis = async () =>
      (await scoped(() => costing.costBasis(access, { includeWithoutReceipts: true }))).items.find(
        (i) => i.inventoryItemId === id,
      )!;
    const recipe = await readRecipe();
    expect(recipe.costMinor).toBe(12500);
    const basis = await readBasis();
    expect(basis).toMatchObject({
      basis: 'manual_initial',
      unitCostMinor: 10000,
      receiptCount: 0,
      receiptLineCount: 0,
      lowestUnitCostMinor: null,
      highestUnitCostMinor: null,
    });
    expect(basis.receivedQuantity.value).toBe(0);
    expect(
      (await scoped(() => costing.costBasis(access, { includeWithoutReceipts: false }))).items,
    ).toHaveLength(0);
    const today = await new InventoryCostingRepository(pg).currentBusinessDate(MERCHANT);
    await pg.runWithMerchant(
      MERCHANT,
      USER,
      async (client) => {
        await client.query(
          `SELECT merchant.append_stock_ledger(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid,'opening_balance',500,$5::uuid,$5::uuid,
        repeat('a',64),'pos_sale',$6::uuid,$7::uuid,$8::uuid,1,$9::date,
        'initial-cost-fixture',null,null,null,null,'{}'::jsonb,null)`,
          [MERCHANT, LOCATION, STOCK_ROOM, id, randomUUID(), randomUUID(), USER, DEVICE, today],
        );
      },
      LOCATION,
    );
    await seedCommittedSale({
      businessDate: today,
      productId: PRODUCT_PLATE,
      productName: 'Plato de prueba',
      inventoryItemId: id,
      quantity: 125,
    });
    const expectReads = async (
      costMinor: number,
      unitCostMinor: number,
      onHandValueMinor: number,
    ) => {
      const plates = await scoped(() =>
        costing.plates(access, { productId: PRODUCT_PLATE, includeUnmapped: false, limit: 200 }),
      );
      expect(plates.plates[0].costMinor).toBe(costMinor);
      const days = await scoped(() => costing.days(access, { from: today, to: today }));
      expect(days.days[0].costMinor).toBe(costMinor);
      const lowStock = await scoped(() =>
        costing.lowStock(access, { windowDays: 28, belowThresholdOnly: false }),
      );
      expect(lowStock.items.find((i) => i.inventoryItemId === id)).toMatchObject({
        unitCostMinor,
        onHandValueMinor,
      });
    };
    await expectReads(12500, 10000, 37500);
    const stock = async () =>
      (await pg.query(`SELECT * FROM merchant.stock_balance WHERE merchant_id=$1`, [MERCHANT]))
        .rows;
    const ledger = async () =>
      (
        await pg.query(
          `SELECT count(*)::int AS count FROM merchant.stock_ledger_entry WHERE merchant_id=$1`,
          [MERCHANT],
        )
      ).rows;
    const before = { stock: await stock(), ledger: await ledger() };
    let version = created.item.version;
    const update = async (parameters: Record<string, unknown>) => {
      const input = {
        targetAggregateId: id,
        targetVersion: version,
        parameters,
        commandId: randomUUID(),
        idempotencyKey: randomUUID(),
      };
      const result = (await send('inventory.item.update', input)) as {
        item: { version: number; initialUnitCostMinor: number | null };
      };
      expect(await send('inventory.item.update', input)).toEqual(result);
      version = result.item.version;
      return result.item;
    };
    expect((await update({ initialUnitCostMinor: 12000 })).initialUnitCostMinor).toBe(12000);
    expect((await readRecipe()).costMinor).toBe(15000);
    await expectReads(15000, 12000, 45000);
    expect({ stock: await stock(), ledger: await ledger() }).toEqual(before);
    expect((await update({ displayName: 'Harina editada' })).initialUnitCostMinor).toBe(12000);
    expect((await update({ initialUnitCostMinor: null })).initialUnitCostMinor).toBeNull();
    expect((await readRecipe()).costMinor).toBeNull();
    expect((await update({ initialUnitCostMinor: 0 })).initialUnitCostMinor).toBe(0);
    expect((await readRecipe()).costMinor).toBe(0);
    expect((await readBasis()).basis).toBe('manual_initial');
    const items = await scoped(() =>
      authoring.items(access, InventoryAuthoringItemQuery.parse({})),
    );
    expect(items.items.some((item) => item.id === id)).toBe(true);
    await update({ initialUnitCostMinor: 12000 });
    const rejected = async (work: () => Promise<unknown>, status: number) => {
      let caught: unknown;
      try {
        await work();
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ status });
    };
    for (const initialUnitCostMinor of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '10000']) {
      await rejected(
        () =>
          send('inventory.item.update', {
            targetAggregateId: id,
            targetVersion: version,
            parameters: { initialUnitCostMinor },
          }),
        400,
      );
    }
    await rejected(
      () =>
        send('inventory.item.update', {
          targetAggregateId: id,
          targetVersion: version - 1,
          parameters: { initialUnitCostMinor: 123 },
        }),
      409,
    );
    const unauthorized = { ...access, permissions: [] };
    await rejected(
      () =>
        scoped(() =>
          commands.execute(user, unauthorized, {
            operation: 'inventory.item.update',
            locationId: LOCATION,
            targetAggregateId: id,
            targetVersion: version,
            commandId: randomUUID(),
            idempotencyKey: randomUUID(),
            parameters: { initialUnitCostMinor: 123 },
            approvalId: null,
          }),
        ),
      403,
    );
    const otherMerchant = randomUUID();
    const otherLocation = randomUUID();
    await pg.query(
      `INSERT INTO merchant.merchant(id,name,handle) VALUES ($1,'Other initial cost',$2)`,
      [otherMerchant, `other-${RUN}`],
    );
    await pg.query(`INSERT INTO merchant.location(id,merchant_id,name) VALUES ($1,$2,'Other')`, [
      otherLocation,
      otherMerchant,
    ]);
    const otherAccess = { ...access, merchantId: otherMerchant, locationId: otherLocation };
    await rejected(
      () =>
        runWithRequestContext(
          {
            merchantId: otherMerchant,
            locationId: otherLocation,
            userId: USER,
            requestId: randomUUID(),
          },
          () =>
            commands.execute(user, otherAccess, {
              operation: 'inventory.item.update',
              locationId: otherLocation,
              targetAggregateId: id,
              targetVersion: version,
              commandId: randomUUID(),
              idempotencyKey: randomUUID(),
              parameters: { initialUnitCostMinor: 123 },
              approvalId: null,
            }),
        ),
      404,
    );
    const foreignBasis = await runWithRequestContext(
      { merchantId: otherMerchant, userId: USER, requestId: randomUUID() },
      () => costing.costBasis(otherAccess, { includeWithoutReceipts: true }),
    );
    expect(foreignBasis.items).toHaveLength(0);
    expect((await readBasis()).unitCostMinor).toBe(12000);
    await receive({
      inventoryItemId: id,
      quantity: { value: 1, scale: 0, unit: 'kilogram' },
      unitCostMinor: 14000,
    });
    await receive({
      inventoryItemId: id,
      quantity: { value: 3, scale: 0, unit: 'kilogram' },
      unitCostMinor: 10000,
    });
    expect(await readBasis()).toMatchObject({
      basis: 'weighted_average_of_receipts',
      unitCostMinor: 11000,
      receiptCount: 2,
      receiptLineCount: 2,
      receivedQuantity: { value: 400, scale: 2 },
      lowestUnitCostMinor: 10000,
      highestUnitCostMinor: 14000,
    });
    expect((await readRecipe()).costMinor).toBe(13750);
    await expectReads(13750, 11000, 85250);
    await update({ initialUnitCostMinor: 1 });
    expect((await readRecipe()).costMinor).toBe(13750);
    const history = await scoped(() =>
      costing.recipeCostHistory(access, { productId: PRODUCT_PLATE }),
    );
    expect(history.recipes[0].points[0].costMinor).toBe(12500);
    await pg.runWithMerchant(MERCHANT, USER, async (client) => {
      await client.query(
        `UPDATE merchant.inventory_recipe SET computed_at=null,computed_cost_minor=null WHERE id=$1`,
        [recipeId],
      );
    });
    const legacy = await scoped(() =>
      costing.recipeCostHistory(access, { productId: PRODUCT_PLATE }),
    );
    expect(legacy.recipes[0].points[0].costMinor).toBe(13750);
    const audit = await pg.query<{ public_data: Record<string, unknown> }>(
      `SELECT public_data FROM merchant.audit_event WHERE entity_id=$1 AND event_type='inventory_item_updated' ORDER BY occurred_at`,
      [id],
    );
    expect(
      audit.rows.some(
        (row) =>
          row.public_data.actorUserId === USER && row.public_data.initialUnitCostMinor === 12000,
      ),
    ).toBe(true);
  });

  it('distinguishes missing, explicit zero, and a zero receipt; expands nested recipes', async () => {
    const createItem = async (
      initialUnitCostMinor: number | null | undefined,
      itemType = 'ingredient',
      baseUnit = 'kilogram',
    ) => {
      const id = randomUUID();
      const result = (await send('inventory.item.create', {
        targetAggregateId: id,
        parameters: {
          publicReference: `EDGE-${id}`,
          displayName: 'Edge ingredient',
          itemType,
          baseUnit,
          quantityScale: 2,
          trackingPolicy: 'tracked',
          negativeStockPolicy: 'block',
          ...(initialUnitCostMinor === undefined ? {} : { initialUnitCostMinor }),
        },
      })) as { item: { initialUnitCostMinor: number | null } };
      expect(result.item.initialUnitCostMinor).toBe(initialUnitCostMinor ?? null);
      return id;
    };
    const missing = await createItem(undefined);
    const cleared = await createItem(null);
    const zero = await createItem(0);
    const raw = await createItem(10000);
    const prep = await createItem(999999, 'composite_component', 'portion');
    const all = await scoped(() =>
      authoring.items(access, InventoryAuthoringItemQuery.parse({ includeItemsWithoutCost: true })),
    );
    expect(
      all.items
        .filter((item) => item.id === missing || item.id === cleared)
        .every((item) => item.initialUnitCostMinor === null),
    ).toBe(true);
    const known = await scoped(() =>
      authoring.items(access, InventoryAuthoringItemQuery.parse({})),
    );
    expect(known.items.some((item) => item.id === zero)).toBe(true);
    expect(known.items.some((item) => item.id === missing || item.id === cleared)).toBe(false);
    const nested = randomUUID();
    await send('inventory.recipe.create', {
      targetAggregateId: nested,
      parameters: {
        targetKind: 'item',
        targetItemId: prep,
        yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
        components: [
          { inventoryItemId: raw, quantity: { value: 125, scale: 2, unit: 'kilogram' } },
        ],
      },
    });
    const productId = randomUUID();
    await pg.query(
      `INSERT INTO merchant.product(id,merchant_id,name,price,active) VALUES ($1,$2,'Nested initial cost',50000,true)`,
      [productId, MERCHANT],
    );
    const recipeId = randomUUID();
    await send('inventory.recipe.create', {
      targetAggregateId: recipeId,
      parameters: {
        targetKind: 'product',
        productId,
        yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
        components: [{ inventoryItemId: prep, quantity: { value: 1, scale: 0, unit: 'portion' } }],
      },
    });
    const recipes = await scoped(() =>
      authoring.recipes(access, InventoryRecipeQuery.parse({ productId })),
    );
    expect(recipes.recipes[0].costMinor).toBe(12500);
    const plates = await scoped(() =>
      costing.plates(access, { productId, includeUnmapped: false, limit: 200 }),
    );
    expect(plates.plates[0].costMinor).toBe(12500);
    await pg.runWithMerchant(MERCHANT, USER, async (client) => {
      await client.query(
        `UPDATE merchant.inventory_recipe SET computed_at=null,computed_cost_minor=null WHERE id=$1`,
        [recipeId],
      );
    });
    const legacy = await scoped(() => costing.recipeCostHistory(access, { productId }));
    expect(legacy.recipes[0].points[0].costMinor).toBe(12500);
    await receive({
      inventoryItemId: raw,
      quantity: { value: 1, scale: 0, unit: 'kilogram' },
      unitCostMinor: 0,
    });
    const basis = await scoped(() => costing.costBasis(access, { includeWithoutReceipts: true }));
    expect(basis.items.find((item) => item.inventoryItemId === raw)).toMatchObject({
      basis: 'weighted_average_of_receipts',
      unitCostMinor: 0,
      receiptCount: 1,
    });
    expect(
      (await scoped(() => authoring.recipes(access, InventoryRecipeQuery.parse({ productId }))))
        .recipes[0].costMinor,
    ).toBe(0);
  });
  it('preserves Dart payload presence through the real administrative command', async () => {
    const fixtures = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          '../../../../../packages/contract/test/fixtures/initial-cost-dart-updates.json',
        ),
        'utf8',
      ),
    ) as Record<string, Record<string, unknown>>;
    const id = randomUUID();
    await send('inventory.item.create', {
      targetAggregateId: id,
      parameters: {
        publicReference: `DART-${id}`,
        displayName: 'Dart initial cost',
        itemType: 'ingredient',
        baseUnit: 'kilogram',
        quantityScale: 2,
        trackingPolicy: 'tracked',
        negativeStockPolicy: 'block',
        initialUnitCostMinor: 10000,
      },
    });
    let version = 1;
    for (const [name, fixture] of Object.entries(fixtures)) {
      const payload = InventoryAuthoringItemUpdateRequest.parse({
        ...fixture,
        commandId: randomUUID(),
        idempotencyKey: randomUUID(),
        inventoryItemId: id,
        expectedVersion: version,
      });
      const { commandId, idempotencyKey, inventoryItemId, expectedVersion, ...parameters } =
        payload;
      expect(Object.hasOwn(parameters, 'initialUnitCostMinor')).toBe(name !== 'omitted');
      const result = (await send('inventory.item.update', {
        commandId,
        idempotencyKey,
        targetAggregateId: inventoryItemId,
        targetVersion: expectedVersion,
        parameters,
      })) as { item: { version: number; initialUnitCostMinor: number | null } };
      expect(result.item.initialUnitCostMinor).toBe(
        name === 'omitted' ? 10000 : fixture.initialUnitCostMinor,
      );
      version = result.item.version;
    }
  });
});
