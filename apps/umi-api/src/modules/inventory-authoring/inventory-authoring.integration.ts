import { MetricsService } from '../../shared/operations/metrics.service';
import { createHash, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  InventoryAllergenList,
  InventoryAllergenQuery,
  InventoryAuthoringItemList,
  InventoryAuthoringItemQuery,
  InventoryRecipeExplosion,
  InventoryRecipeList,
  InventoryRecipeQuery,
  InventoryUnitConversionList,
  LotRecall,
  PrepList,
  PrepListQuery,
  ProductionRecord,
  ProductionResult,
  type CreatePurchaseOrderRequest,
} from '@umi/contract';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import { writeOrder } from '../../shared/orders/order-writer';
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

/**
 * WORKSTREAM E, PHASE 1 — items, unit conversions and allergen labels, against the
 * REAL schema (`recipes76_final`).
 *
 * WHAT THIS SPEC PROVES, and each one is asserted from the DATABASE's answer rather
 * than from a shape the API happened to return:
 *
 *   · an owner creates an ingredient, and the row is there with its own version;
 *   · the SAME public reference is refused with `INVENTORY_ITEM_REFERENCE_TAKEN`, and
 *     the refusal is the contract's code rather than a leaked SQLSTATE 23505;
 *   · a conversion that does not divide is refused with
 *     `INVENTORY_UNIT_CONVERSION_INVALID`, and an exact one is accepted;
 *   · setting a label a second time without naming the version it read is refused,
 *     because the first set has no version to expect and the second one has;
 *   · an allergen label is set and attached to the item, and the attachment cannot
 *     be made twice from the same read;
 *   · the three READS answer payloads that parse against their contract models;
 *   · every write left an audit row, which is what D15 buys.
 *
 * WHY IT DRIVES THE REAL COMMAND DOOR. These six operations have no route: D15 makes
 * them administrative commands, so the only honest way to call them is the way the
 * console does — through `AdministrativeCommandContextService` (policy, permission,
 * dashboard session, fingerprint) and then the execution service's own switch (the
 * id injection, the zod parse, the dispatch). A spec that called
 * `InventoryAuthoringService` directly would prove none of that.
 *
 * SELF-SEEDING, and every id is minted per run: the database is a persistent
 * build-v3 instance and `INVENTORY_ITEM_REFERENCE_TAKEN` is only meaningful against
 * a reference that exists.
 *
 *   DATABASE_URL_APP=... DATABASE_URL_WORKER=... \
 *   npx vitest run --config vitest.integration.config.ts \
 *     src/modules/inventory-authoring/inventory-authoring.integration.ts
 */

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

/** The ledger's own identity columns: a stock movement names who and where. */
const LEDGER_COMMAND = fixtureId(0x91);
const LEDGER_SOURCE = fixtureId(0x92);

const ITEM_INGREDIENT = fixtureId(0xe1);
const ITEM_DUPLICATE = fixtureId(0xe2);
const ITEM_MALFORMED = fixtureId(0xe3);
const ALLERGEN_GLUTEN = fixtureId(0xf1);

/**
 * The recipe fixture (phase 2): a receipt-priced raw item, a chain of two preps, and a
 * plate, plus the pair of items a cycle is built from.
 */
const ITEM_RAW = fixtureId(0xe4);
const ITEM_PREP_ONE = fixtureId(0xe5);
const ITEM_PREP_TWO = fixtureId(0xe6);
const ITEM_CYCLE_A = fixtureId(0xe7);
const ITEM_CYCLE_B = fixtureId(0xe8);
const RECIPE_PREP_ONE = fixtureId(0xe9);
const RECIPE_PREP_TWO = fixtureId(0xea);
const RECIPE_PLATE = fixtureId(0xeb);
const RECIPE_CYCLE_A = fixtureId(0xec);
const RECIPE_CYCLE_B = fixtureId(0xed);
const PRODUCT_PLATE = fixtureId(0xee);
const MAPPING_PLATE = fixtureId(0xef);
const SUPPLIER = fixtureId(0xbc);

const RAW_REFERENCE = `HARINA-RAW-${RUN}`;
const PREP_ONE_REFERENCE = `MASA-${RUN}`;
const PREP_TWO_REFERENCE = `SALSA-${RUN}`;
const CYCLE_A_REFERENCE = `CICLO-A-${RUN}`;
const CYCLE_B_REFERENCE = `CICLO-B-${RUN}`;

/**
 * THE ARITHMETIC, WRITTEN OUT SO EVERY ASSERTION BELOW IS A NUMBER.
 *
 *   raw        10.000 kg received at $120.50 a kilogram → 12050 minor units per kg.
 *   prep one   one portion makes 0.500 kg of raw.
 *   prep two   one portion makes 2 portions of prep one.
 *   the plate  one portion makes 3 portions of prep two.
 *
 *   per plate: 3 × 2 × 0.500 kg = 3.000 kg of raw
 *              cost = 3000 × 12050 / 1000 = 36150 minor units
 */
const RAW_UNIT_COST_MINOR = 12050;
const PLATE_RAW_QUANTITY = { value: 3000, scale: 3, unit: 'kilogram' as const };
const PLATE_PRICE_MINOR = 45000;
const PLATE_COST_MINOR = Number((3000n * BigInt(RAW_UNIT_COST_MINOR)) / 1000n);

const REFERENCE = `HARINA-${RUN}`;

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
  ],
};

describe('inventory authoring · items, conversions and allergens', () => {
  let pg: PgService;
  let authoring: InventoryAuthoringService;
  /** The till's own service, wired as `PosInventoryModule` wires it. */
  let inventory: PosInventoryService;
  let commands: AdministrativeCommandExecutionService;
  let procurement: ProcurementService;
  /** The version the last successful item write left behind. */
  let itemVersion = 0;
  /** The first batch's own answer, reused by the lot and recall cases below. */
  let firstBatch: z.infer<typeof ProductionResult>;

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

  /**
   * A refusal as plain fields. Nest keeps the typed `code` inside `getResponse()`,
   * so `rejects.toMatchObject({ code })` would silently match nothing.
   */
  async function refusal(work: () => Promise<unknown>): Promise<{
    status: number;
    code: string;
    fieldErrors: Record<string, string[]> | undefined;
  }> {
    try {
      await work();
    } catch (thrown) {
      const error = thrown as { status?: number; getResponse?: () => unknown };
      const body = (typeof error.getResponse === 'function' ? error.getResponse() : {}) as {
        code?: unknown;
        fieldErrors?: Record<string, string[]>;
      };
      return {
        status: error.status ?? 0,
        code: typeof body.code === 'string' ? body.code : '(no code)',
        fieldErrors: body.fieldErrors,
      };
    }
    throw new Error('the API ACCEPTED a command it was supposed to refuse');
  }

  const itemRow = async (itemId: string) => {
    const { rows } = await pg.query<{
      public_reference: string;
      display_name: string;
      low_stock_threshold: string | null;
      active: boolean;
      archived_at: Date | null;
      version: number;
    }>(
      `SELECT public_reference,display_name,low_stock_threshold::text AS low_stock_threshold,
              active,archived_at,version
         FROM merchant.inventory_item WHERE id=$1::uuid`,
      [itemId],
    );
    return rows[0];
  };

  const auditEvents = async (entityId: string) => {
    const { rows } = await pg.query<{ event_type: string }>(
      `SELECT event_type FROM merchant.audit_event
        WHERE entity_id=$1::uuid ORDER BY occurred_at`,
      [entityId],
    );
    return rows.map((row) => row.event_type);
  };

  // ── The recipe fixture's own doors ─────────────────────────────────────────

  /** One item, through the console's command door rather than an INSERT. */
  const createItem = (
    itemId: string,
    parameters: {
      publicReference: string;
      displayName: string;
      itemType: string;
      baseUnit: string;
      quantityScale: number;
    },
  ) =>
    send('inventory.item.create', {
      targetAggregateId: itemId,
      parameters: {
        ...parameters,
        trackingPolicy: 'tracked',
        negativeStockPolicy: 'block',
      },
    });

  /** One recipe, through the console's command door. */
  const createRecipe = (recipeId: string, parameters: Record<string, unknown>) =>
    send('inventory.recipe.create', { targetAggregateId: recipeId, parameters });

  /**
   * One purchase order, sent and received through the product's own routes. The cost
   * basis is the weighted average of RECEIPTS, so a plate's cost cannot be asserted
   * against a fixture that never received anything.
   */
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

  /** The recipe rows as the DATABASE holds them, not as the API answered. */
  const recipeRows = async (): Promise<
    {
      id: string;
      product_id: string | null;
      target_item_id: string | null;
      version: number;
      active: boolean;
      retired_at: Date | null;
    }[]
  > => {
    const { rows } = await pg.query<{
      id: string;
      product_id: string | null;
      target_item_id: string | null;
      version: number;
      active: boolean;
      retired_at: Date | null;
    }>(
      `SELECT id::text AS id,product_id::text AS product_id,target_item_id::text AS target_item_id,
              version,active,retired_at
         FROM merchant.inventory_recipe
        WHERE merchant_id=$1::uuid
        ORDER BY version,id`,
      [MERCHANT],
    );
    return rows;
  };

  /**
   * A committed sale of one item, written through the product's own writers, with the two
   * ledger rows a sale leaves: the reservation, then the `sale_committed` consumption the
   * recall reads.
   */
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

  it('creates an ingredient, replays the same command once, and refuses the same reference again', async () => {
    const commandId = randomUUID();
    const idempotencyKey = randomUUID();
    const created = (await send('inventory.item.create', {
      targetAggregateId: ITEM_INGREDIENT,
      commandId,
      idempotencyKey,
      parameters: {
        publicReference: REFERENCE,
        displayName: 'Harina de trigo',
        itemType: 'ingredient',
        baseUnit: 'kilogram',
        quantityScale: 3,
        trackingPolicy: 'tracked',
        negativeStockPolicy: 'block',
      },
    })) as { commandId: string; item: { id: string; publicReference: string; version: number } };

    expect(created.item.id).toBe(ITEM_INGREDIENT);
    expect(created.item.publicReference).toBe(REFERENCE);
    expect(created.item.version).toBe(1);
    itemVersion = created.item.version;

    const row = await itemRow(ITEM_INGREDIENT);
    expect(row).toMatchObject({
      public_reference: REFERENCE,
      display_name: 'Harina de trigo',
      active: true,
      archived_at: null,
      version: 1,
    });

    // THE SAME COMMAND, TWICE. The claim in `merchant.business_command` answers the
    // second call with the first attempt's own result, so no second row appears.
    const replay = (await send('inventory.item.create', {
      targetAggregateId: ITEM_INGREDIENT,
      commandId,
      idempotencyKey,
      parameters: {
        publicReference: REFERENCE,
        displayName: 'Harina de trigo',
        itemType: 'ingredient',
        baseUnit: 'kilogram',
        quantityScale: 3,
        trackingPolicy: 'tracked',
        negativeStockPolicy: 'block',
      },
    })) as { item: { id: string; version: number } };
    expect(replay.item).toEqual(created.item);
    const count = await pg.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM merchant.inventory_item WHERE merchant_id=$1::uuid`,
      [MERCHANT],
    );
    expect(count.rows[0].total).toBe('1');

    // A SECOND ITEM WITH THE SAME REFERENCE. The contract has one code for it, and
    // the caller must get that code rather than a raw unique-violation.
    const duplicate = await refusal(() =>
      send('inventory.item.create', {
        targetAggregateId: ITEM_DUPLICATE,
        parameters: {
          publicReference: REFERENCE,
          displayName: 'Harina duplicada',
          itemType: 'ingredient',
          baseUnit: 'kilogram',
          quantityScale: 3,
          trackingPolicy: 'tracked',
          negativeStockPolicy: 'block',
        },
      }),
    );
    expect(duplicate).toMatchObject({
      status: 409,
      code: 'INVENTORY_ITEM_REFERENCE_TAKEN',
    });
    expect(await itemRow(ITEM_DUPLICATE)).toBeUndefined();

    // A PARAMETER THE CONTRACT DOES NOT ACCEPT is the caller's mistake, not a 500.
    const malformed = await refusal(() =>
      send('inventory.item.create', {
        targetAggregateId: ITEM_MALFORMED,
        parameters: {
          publicReference: REFERENCE,
          displayName: '',
          itemType: 'ingredient',
          baseUnit: 'kilogram',
          quantityScale: 3,
          trackingPolicy: 'tracked',
          negativeStockPolicy: 'block',
        },
      }),
    );
    expect(malformed.status).toBe(400);
    expect(malformed.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(malformed.fieldErrors ?? {})).toContain('displayName');
  });

  it('amends the item, clears a nullable field, and refuses a stale version', async () => {
    const updated = (await send('inventory.item.update', {
      targetAggregateId: ITEM_INGREDIENT,
      targetVersion: itemVersion,
      parameters: { displayName: 'Harina de trigo integral', lowStockThreshold: 750 },
    })) as { item: { version: number; displayName: string; lowStockThreshold: number | null } };
    expect(updated.item.version).toBe(itemVersion + 1);
    expect(updated.item.displayName).toBe('Harina de trigo integral');
    expect(updated.item.lowStockThreshold).toBe(750);
    itemVersion = updated.item.version;

    // null CLEARS the field, and an absent key leaves it: the two are not the same
    // input, so `coalesce` would be the wrong expression.
    const cleared = (await send('inventory.item.update', {
      targetAggregateId: ITEM_INGREDIENT,
      targetVersion: itemVersion,
      parameters: { lowStockThreshold: null },
    })) as { item: { version: number; displayName: string; lowStockThreshold: number | null } };
    expect(cleared.item.lowStockThreshold).toBeNull();
    expect(cleared.item.displayName).toBe('Harina de trigo integral');
    itemVersion = cleared.item.version;

    const stale = await refusal(() =>
      send('inventory.item.update', {
        targetAggregateId: ITEM_INGREDIENT,
        targetVersion: 1,
        parameters: { displayName: 'Harina vieja' },
      }),
    );
    expect(stale).toMatchObject({ status: 409, code: 'OPTIMISTIC_VERSION_CONFLICT' });
  });

  it('refuses a conversion that loses a unit, and accepts one that does not', async () => {
    // 1 portion = 1/3 kilogram cannot be held at scale 3 without a remainder:
    // 1 * 10^3 is not divisible by 3.
    const lossy = await refusal(() =>
      send('inventory.conversion.set', {
        targetAggregateId: ITEM_INGREDIENT,
        targetVersion: null,
        parameters: {
          fromUnit: 'portion',
          toUnit: 'kilogram',
          numerator: 1,
          denominator: 3,
          targetScale: 3,
          roundingPolicy: 'exact',
        },
      }),
    );
    expect(lossy).toMatchObject({ status: 409, code: 'INVENTORY_UNIT_CONVERSION_INVALID' });
    const none = await pg.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM merchant.inventory_unit_conversion
        WHERE merchant_id=$1::uuid AND inventory_item_id=$2::uuid`,
      [MERCHANT, ITEM_INGREDIENT],
    );
    expect(none.rows[0].total).toBe('0');

    // A scale that is not the item's own is refused for the same reason; the till
    // would otherwise divide by a scale nothing else on the item uses.
    const wrongScale = await refusal(() =>
      send('inventory.conversion.set', {
        targetAggregateId: ITEM_INGREDIENT,
        targetVersion: null,
        parameters: {
          fromUnit: 'gram',
          toUnit: 'kilogram',
          numerator: 1,
          denominator: 1000,
          targetScale: 2,
          roundingPolicy: 'exact',
        },
      }),
    );
    expect(wrongScale.code).toBe('INVENTORY_UNIT_CONVERSION_INVALID');

    // 1 gram = 1/1000 kilogram divides exactly at scale 3. This is the FIRST set,
    // so there is no version to name.
    const set = (await send('inventory.conversion.set', {
      targetAggregateId: ITEM_INGREDIENT,
      targetVersion: null,
      parameters: {
        fromUnit: 'gram',
        toUnit: 'kilogram',
        numerator: 1,
        denominator: 1000,
        targetScale: 3,
        roundingPolicy: 'exact',
      },
    })) as { conversion: { id: string; version: number; active: boolean } };
    expect(set.conversion).toMatchObject({ version: 1, active: true });

    // THE FIRST SET IS OVER, so a second one must name the version it read.
    const staleFirstSet = await refusal(() =>
      send('inventory.conversion.set', {
        targetAggregateId: ITEM_INGREDIENT,
        targetVersion: null,
        parameters: {
          fromUnit: 'gram',
          toUnit: 'kilogram',
          numerator: 1,
          denominator: 1000,
          targetScale: 3,
          roundingPolicy: 'exact',
        },
      }),
    );
    expect(staleFirstSet).toMatchObject({
      status: 409,
      code: 'OPTIMISTIC_VERSION_CONFLICT',
    });

    const second = (await send('inventory.conversion.set', {
      targetAggregateId: ITEM_INGREDIENT,
      targetVersion: 1,
      parameters: {
        fromUnit: 'gram',
        toUnit: 'kilogram',
        numerator: 5,
        denominator: 1000,
        targetScale: 3,
        roundingPolicy: 'exact',
      },
    })) as { conversion: { version: number; active: boolean } };
    expect(second.conversion).toMatchObject({ version: 2, active: true });
    const rows = await pg.query<{ version: number; active: boolean }>(
      `SELECT version,active FROM merchant.inventory_unit_conversion
        WHERE merchant_id=$1::uuid AND inventory_item_id=$2::uuid
        ORDER BY version`,
      [MERCHANT, ITEM_INGREDIENT],
    );
    expect(rows.rows).toEqual([
      { version: 1, active: false },
      { version: 2, active: true },
    ]);
  });

  it('sets an allergen label and attaches it to the item', async () => {
    const created = (await send('inventory.allergen.set', {
      targetAggregateId: ALLERGEN_GLUTEN,
      targetVersion: null,
      parameters: { code: 'gluten', label: 'Gluten' },
    })) as { allergen: { id: string; code: string; active: boolean; version: number } };
    expect(created.allergen).toMatchObject({
      id: ALLERGEN_GLUTEN,
      code: 'gluten',
      active: true,
      version: 1,
    });

    const stale = await refusal(() =>
      send('inventory.allergen.set', {
        targetAggregateId: ALLERGEN_GLUTEN,
        targetVersion: null,
        parameters: { code: 'gluten', label: 'Gluten (trigo)' },
      }),
    );
    expect(stale).toMatchObject({ status: 409, code: 'OPTIMISTIC_VERSION_CONFLICT' });

    const renamed = (await send('inventory.allergen.set', {
      targetAggregateId: ALLERGEN_GLUTEN,
      targetVersion: 1,
      parameters: { code: 'gluten', label: 'Gluten (trigo)' },
    })) as { allergen: { label: string; version: number } };
    expect(renamed.allergen).toMatchObject({ label: 'Gluten (trigo)', version: 2 });

    const attached = (await send('inventory.item_allergen.set', {
      targetAggregateId: ITEM_INGREDIENT,
      targetVersion: itemVersion,
      parameters: { allergenIds: [ALLERGEN_GLUTEN] },
    })) as { item: { version: number; allergens: { code: string }[] } };
    expect(attached.item.allergens.map((entry) => entry.code)).toEqual(['gluten']);
    expect(attached.item.version).toBe(itemVersion + 1);

    // TWO EDITORS ON ONE ITEM REFUSE. The attachment moved the item's version, so
    // the other editor's read is stale.
    const secondEditor = await refusal(() =>
      send('inventory.item_allergen.set', {
        targetAggregateId: ITEM_INGREDIENT,
        targetVersion: itemVersion,
        parameters: { allergenIds: [] },
      }),
    );
    expect(secondEditor).toMatchObject({ status: 409, code: 'OPTIMISTIC_VERSION_CONFLICT' });
    itemVersion = attached.item.version;

    expect(await auditEvents(ITEM_INGREDIENT)).toContain('inventory_item_allergen_set');
    expect(await auditEvents(ALLERGEN_GLUTEN)).toContain('inventory_allergen_set');
  });

  it('serves the three reads as contract-shaped payloads', async () => {
    // ON-HAND IS READ FROM THE LEDGER'S PROJECTION, so the fixture posts through the
    // ledger's one door (`append_stock_ledger`) rather than writing `stock_balance`,
    // which the application roles cannot insert into at all.
    await pg.runWithMerchant(
      MERCHANT,
      USER,
      (client) =>
        client.query(
          `SELECT merchant.append_stock_ledger(
             $1::uuid,$2::uuid,$3::uuid,$4::uuid,'opening_balance',2500::bigint,
             $5::uuid,$5::uuid,repeat('b',64),'inventory_authoring_harness',$6::uuid,
             $7::uuid,$8::uuid,1,current_date,'inventory-authoring-harness',
             null,null,null,null,'{}'::jsonb)`,
          [
            MERCHANT,
            LOCATION,
            STOCK_ROOM,
            ITEM_INGREDIENT,
            LEDGER_COMMAND,
            LEDGER_SOURCE,
            USER,
            DEVICE,
          ],
        ),
      LOCATION,
    );

    const items = InventoryAuthoringItemList.parse(
      await scoped(() =>
        authoring.items(
          access,
          InventoryAuthoringItemQuery.parse({ includeItemsWithoutCost: true }),
        ),
      ),
    );
    const item = items.items.find((entry) => entry.id === ITEM_INGREDIENT);
    expect(item?.publicReference).toBe(REFERENCE);
    expect(item?.displayName).toBe('Harina de trigo integral');
    expect(item?.active).toBe(true);
    expect(item?.allergens.map((entry) => entry.code)).toEqual(['gluten']);
    expect(item?.conversions).toHaveLength(1);
    expect(item?.conversions[0]).toMatchObject({
      fromUnit: 'gram',
      toUnit: 'kilogram',
      version: 2,
    });
    expect(item?.onHand).toEqual([
      { locationId: LOCATION, inventoryLocationId: STOCK_ROOM, onHand: 2500 },
    ]);

    // NO RECEIPT HAS PRICED THIS ITEM, so the DEFAULT list is the narrow one and the
    // item is absent. The console passes `includeItemsWithoutCost=true` because a
    // freshly authored ingredient must be visible there.
    const narrow = InventoryAuthoringItemList.parse(
      await scoped(() => authoring.items(access, InventoryAuthoringItemQuery.parse({}))),
    );
    expect(narrow.items.some((entry) => entry.id === ITEM_INGREDIENT)).toBe(false);

    // AND THE WIDER LIST NAMES IT, which is the answer the console reads.
    const wide = InventoryAuthoringItemList.parse(
      await scoped(() =>
        authoring.items(
          access,
          InventoryAuthoringItemQuery.parse({ includeItemsWithoutCost: true }),
        ),
      ),
    );
    expect(wide.items.some((entry) => entry.id === ITEM_INGREDIENT)).toBe(true);

    const conversions = InventoryUnitConversionList.parse(
      await scoped(() => authoring.unitConversions(access, InventoryAuthoringItemQuery.parse({}))),
    );
    const conversion = conversions.items.find((entry) => entry.inventoryItemId === ITEM_INGREDIENT);
    expect(conversion).toMatchObject({
      fromUnit: 'gram',
      toUnit: 'kilogram',
      numerator: 5,
      denominator: 1000,
      targetScale: 3,
      roundingPolicy: 'exact',
      active: true,
      version: 2,
    });

    const allergens = InventoryAllergenList.parse(
      await scoped(() => authoring.allergens(access, InventoryAllergenQuery.parse({}))),
    );
    expect(allergens.allergens).toEqual([
      { id: ALLERGEN_GLUTEN, code: 'gluten', label: 'Gluten (trigo)', active: true, version: 2 },
    ]);
  });

  it('archives the item and refuses a stale version', async () => {
    const stale = await refusal(() =>
      send('inventory.item.archive', {
        targetAggregateId: ITEM_INGREDIENT,
        targetVersion: 1,
        parameters: {},
      }),
    );
    expect(stale).toMatchObject({ status: 409, code: 'OPTIMISTIC_VERSION_CONFLICT' });
    expect((await itemRow(ITEM_INGREDIENT))?.active).toBe(true);

    const archived = (await send('inventory.item.archive', {
      targetAggregateId: ITEM_INGREDIENT,
      targetVersion: itemVersion,
      parameters: {},
    })) as { item: { active: boolean; version: number } };
    expect(archived.item.active).toBe(false);

    const row = await itemRow(ITEM_INGREDIENT);
    expect(row?.active).toBe(false);
    expect(row?.archived_at).not.toBeNull();
    expect(await auditEvents(ITEM_INGREDIENT)).toContain('inventory_item_archived');

    // ARCHIVED IS NOT DELETED: the row is still there, and the archived read shows it.
    const archivedRead = InventoryAuthoringItemList.parse(
      await scoped(() =>
        authoring.items(
          access,
          InventoryAuthoringItemQuery.parse({
            includeArchived: true,
            includeItemsWithoutCost: true,
          }),
        ),
      ),
    );
    expect(archivedRead.items.some((entry) => entry.id === ITEM_INGREDIENT)).toBe(true);
  });

  // ── Recipes ────────────────────────────────────────────────────────────────

  it('explodes a raw → prep → prep → plate chain and prices the plate from the receipt', async () => {
    await createItem(ITEM_RAW, {
      publicReference: RAW_REFERENCE,
      displayName: 'Harina cruda',
      itemType: 'ingredient',
      baseUnit: 'kilogram',
      quantityScale: 3,
    });
    await createItem(ITEM_PREP_ONE, {
      publicReference: PREP_ONE_REFERENCE,
      displayName: 'Masa madre',
      itemType: 'composite_component',
      baseUnit: 'portion',
      quantityScale: 0,
    });
    await createItem(ITEM_PREP_TWO, {
      publicReference: PREP_TWO_REFERENCE,
      displayName: 'Salsa de la casa',
      itemType: 'composite_component',
      baseUnit: 'portion',
      quantityScale: 0,
    });

    // 10.000 kg at $120.50 a kilogram: the basis is 12050 minor units per WHOLE kg.
    await receive({
      inventoryItemId: ITEM_RAW,
      quantity: { value: 10000, scale: 3, unit: 'kilogram' },
      unitCostMinor: RAW_UNIT_COST_MINOR,
    });

    // prep one: 0.500 kg of raw per portion.
    await createRecipe(RECIPE_PREP_ONE, {
      targetKind: 'item',
      targetItemId: ITEM_PREP_ONE,
      yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
      components: [
        { inventoryItemId: ITEM_RAW, quantity: { value: 500, scale: 3, unit: 'kilogram' } },
      ],
    });
    // prep two: 2 portions of prep one per portion.
    await createRecipe(RECIPE_PREP_TWO, {
      targetKind: 'item',
      targetItemId: ITEM_PREP_TWO,
      yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
      components: [
        { inventoryItemId: ITEM_PREP_ONE, quantity: { value: 2, scale: 0, unit: 'portion' } },
      ],
    });
    // the plate: 3 portions of prep two per plate.
    await createRecipe(RECIPE_PLATE, {
      targetKind: 'product',
      productId: PRODUCT_PLATE,
      yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
      components: [
        { inventoryItemId: ITEM_PREP_TWO, quantity: { value: 3, scale: 0, unit: 'portion' } },
      ],
    });
    await pg.query(
      `INSERT INTO merchant.inventory_catalog_mapping
         (id,merchant_id,product_id,mapping_type,recipe_id,conversion_numerator,
          conversion_denominator,version,active)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'recipe',$4::uuid,1,1,1,true)
       ON CONFLICT (id) DO NOTHING`,
      [MAPPING_PLATE, MERCHANT, PRODUCT_PLATE, RECIPE_PLATE],
    );

    const list = InventoryRecipeList.parse(
      await scoped(() => authoring.recipes(access, InventoryRecipeQuery.parse({}))),
    );
    const plate = list.recipes.find((recipe) => recipe.id === RECIPE_PLATE);
    expect(plate?.targetName).toBe('Plato de prueba');
    expect(plate?.version).toBe(1);
    expect(plate?.active).toBe(true);
    // A PLATE NAMES A PRODUCT, so nothing names it as a component.
    expect(plate?.usedInRecipeCount).toBe(0);
    // 3 kg of raw at 12050 minor units a kilogram: computed HERE from the receipt, by
    // hand, rather than read back from the answer the API happened to give.
    expect(plate?.costMinor).toBe(PLATE_COST_MINOR);
    expect(plate?.costMinor).toBe(
      Number(
        (BigInt(PLATE_RAW_QUANTITY.value) * BigInt(RAW_UNIT_COST_MINOR)) /
          10n ** BigInt(PLATE_RAW_QUANTITY.scale),
      ),
    );
    expect(plate?.marginMinor).toBe(PLATE_PRICE_MINOR - PLATE_COST_MINOR);

    const explosion = InventoryRecipeExplosion.parse(
      await scoped(() => authoring.explosion(access, RECIPE_PLATE, InventoryRecipeQuery.parse({}))),
    );
    expect(explosion.depth).toBe(3);
    // One row per level: the two preps and the raw item they are made of.
    expect(explosion.items.map((item) => item.depth)).toEqual([1, 2, 3]);

    const raw = explosion.items.find((item) => item.inventoryItemId === ITEM_RAW);
    expect(raw).toMatchObject({
      displayName: 'Harina cruda',
      quantity: PLATE_RAW_QUANTITY,
      exact: true,
      unitCostMinor: RAW_UNIT_COST_MINOR,
      lineCostMinor: PLATE_COST_MINOR,
      depth: 3,
    });
    expect(raw?.path).toHaveLength(3);

    // AN INTERMEDIATE PREP CARRIES NO COST: its cost IS its ingredients' cost, and the
    // plate is already charged for those.
    for (const item of explosion.items.filter((entry) => entry.depth < 3)) {
      expect(item.unitCostMinor).toBeNull();
      expect(item.lineCostMinor).toBeNull();
    }
  });

  it('refuses a component chain that revisits an item, and writes no row', async () => {
    await createItem(ITEM_CYCLE_A, {
      publicReference: CYCLE_A_REFERENCE,
      displayName: 'Ciclo A',
      itemType: 'composite_component',
      baseUnit: 'kilogram',
      quantityScale: 3,
    });
    await createItem(ITEM_CYCLE_B, {
      publicReference: CYCLE_B_REFERENCE,
      displayName: 'Ciclo B',
      itemType: 'composite_component',
      baseUnit: 'kilogram',
      quantityScale: 3,
    });
    await createRecipe(RECIPE_CYCLE_A, {
      targetKind: 'item',
      targetItemId: ITEM_CYCLE_A,
      yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
      components: [
        { inventoryItemId: ITEM_CYCLE_B, quantity: { value: 1, scale: 3, unit: 'kilogram' } },
      ],
    });

    // B consumes A, and A already consumes B. The write is refused BY THE TRIGGER, and
    // the caller reads the contract's own code rather than a leaked SQLSTATE.
    const cycle = await refusal(() =>
      createRecipe(RECIPE_CYCLE_B, {
        targetKind: 'item',
        targetItemId: ITEM_CYCLE_B,
        yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
        components: [
          { inventoryItemId: ITEM_CYCLE_A, quantity: { value: 1, scale: 3, unit: 'kilogram' } },
        ],
      }),
    );
    expect(cycle).toMatchObject({ status: 409, code: 'INVENTORY_RECIPE_CYCLE' });

    // REFUSED MEANS NOTHING WAS WRITTEN: the recipe row went in inside the same
    // transaction as the component that closed the loop.
    const rows = await recipeRows();
    expect(rows.some((row) => row.target_item_id === ITEM_CYCLE_B)).toBe(false);
    expect(rows.some((row) => row.target_item_id === ITEM_CYCLE_A)).toBe(true);
  });

  it('refuses a target and a component the database does not know, in the contract words', async () => {
    // A product id nothing matches: the foreign key refuses it, and the caller must read
    // the target code rather than a SQLSTATE.
    const unknownTarget = await refusal(() =>
      createRecipe(fixtureId(0xfa), {
        targetKind: 'product',
        productId: fixtureId(0xfb),
        yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
        components: [
          {
            inventoryItemId: ITEM_RAW,
            quantity: { value: 1, scale: 3, unit: 'kilogram' },
          },
        ],
      }),
    );
    expect(unknownTarget).toMatchObject({
      status: 409,
      code: 'INVENTORY_RECIPE_TARGET_INVALID',
    });

    // A COMPONENT names an item nothing matches. That is a different mistake, and it has
    // its own code: the owner has to fix the line, not the recipe's target.
    const unknownComponent = await refusal(() =>
      createRecipe(fixtureId(0xfc), {
        targetKind: 'item',
        // A fresh target: ITEM_RAW is consumed by a recipe but has none of its own.
        targetItemId: ITEM_RAW,
        yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
        components: [
          {
            inventoryItemId: fixtureId(0xfd),
            quantity: { value: 1, scale: 3, unit: 'kilogram' },
          },
        ],
      }),
    );
    expect(unknownComponent).toMatchObject({
      status: 404,
      code: 'INVENTORY_ITEM_NOT_FOUND',
    });
  });

  it('retires the version the caller read, writes the next one, and repoints the mapping', async () => {
    const updated = (await send('inventory.recipe.update', {
      targetAggregateId: RECIPE_PLATE,
      targetVersion: 1,
      parameters: { yieldQuantity: { value: 2, scale: 0, unit: 'portion' } },
    })) as { recipe: { id: string; version: number; active: boolean; costMinor: number | null } };

    expect(updated.recipe.id).not.toBe(RECIPE_PLATE);
    expect(updated.recipe.version).toBe(2);
    expect(updated.recipe.active).toBe(true);
    // TWO portions of yield from the same inputs: the cost of ONE yields halves.
    // 36150 / 2 = 18075 exactly, so nothing here depends on a rounding.
    expect(updated.recipe.costMinor).toBe(PLATE_COST_MINOR / 2);

    const rows = await recipeRows();
    const retired = rows.find((row) => row.id === RECIPE_PLATE);
    expect(retired).toMatchObject({ version: 1, active: false });
    expect(retired?.retired_at).not.toBeNull();
    const current = rows.find((row) => row.id === updated.recipe.id);
    expect(current).toMatchObject({
      version: 2,
      active: true,
      product_id: PRODUCT_PLATE,
      retired_at: null,
    });

    // THE MAPPING FOLLOWS. Left on the retired row it would silently stop costing and
    // stop consuming, and the plate would read as free.
    const mapping = await pg.query<{ recipe_id: string }>(
      `SELECT recipe_id::text AS recipe_id FROM merchant.inventory_catalog_mapping
        WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [MERCHANT, MAPPING_PLATE],
    );
    expect(mapping.rows[0].recipe_id).toBe(updated.recipe.id);

    // The retired version stays readable, with the components it was written with.
    const retiredComponents = await pg.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM merchant.inventory_recipe_component
        WHERE merchant_id=$1::uuid AND recipe_id=$2::uuid`,
      [MERCHANT, RECIPE_PLATE],
    );
    expect(retiredComponents.rows[0].total).toBe('1');
  });

  it('answers targetName and usedInRecipeCount, and refuses a stale retire', async () => {
    const list = InventoryRecipeList.parse(
      await scoped(() => authoring.recipes(access, InventoryRecipeQuery.parse({}))),
    );
    const prepOne = list.recipes.find((recipe) => recipe.targetItemId === ITEM_PREP_ONE);
    const prepTwo = list.recipes.find((recipe) => recipe.targetItemId === ITEM_PREP_TWO);
    const plate = list.recipes.find((recipe) => recipe.productId === PRODUCT_PLATE);

    // The name is the ITEM's, derived rather than stored on the recipe.
    expect(prepOne?.targetName).toBe('Masa madre');
    expect(prepTwo?.targetName).toBe('Salsa de la casa');
    // prep two is named by the plate; prep one is named by prep two.
    expect(prepOne?.usedInRecipeCount).toBe(1);
    expect(prepTwo?.usedInRecipeCount).toBe(1);
    expect(plate?.usedInRecipeCount).toBe(0);
    // A sub-recipe is not sold, so there is no price to subtract.
    expect(prepOne?.marginMinor).toBeNull();

    const stale = await refusal(() =>
      send('inventory.recipe.retire', {
        targetAggregateId: plate!.id,
        targetVersion: 1,
        parameters: {},
      }),
    );
    expect(stale).toMatchObject({ status: 409, code: 'OPTIMISTIC_VERSION_CONFLICT' });

    const retired = (await send('inventory.recipe.retire', {
      targetAggregateId: plate!.id,
      targetVersion: 2,
      parameters: {},
    })) as { recipe: { active: boolean; version: number } };
    expect(retired.recipe).toMatchObject({ active: false, version: 2 });
    const row = (await recipeRows()).find((entry) => entry.id === plate!.id);
    expect(row).toMatchObject({ active: false, version: 2 });
    expect(row?.retired_at).not.toBeNull();
  });

  // ── Production, yield, lots, prep and recall (phase 3) ─────────────────────

  it('produces a prep, consumes its inputs and costs the batch from the receipt', async () => {
    // A PAR level and a shelf life on the prep, set through the item's own command so the
    // prep list and the label have something to work from.
    const prepItem = await pg.query<{ version: number }>(
      `SELECT version FROM merchant.inventory_item WHERE id=$1::uuid`,
      [ITEM_PREP_ONE],
    );
    await send('inventory.item.update', {
      targetAggregateId: ITEM_PREP_ONE,
      targetVersion: prepItem.rows[0].version,
      parameters: { parQuantity: 20, shelfLifeDays: 3 },
    });

    firstBatch = ProductionResult.parse(
      await send('inventory.production.produce', {
        targetAggregateId: ITEM_PREP_ONE,
        parameters: {
          inventoryLocationId: STOCK_ROOM,
          quantity: { value: 1, scale: 0, unit: 'portion' },
        },
      }),
    );

    expect(firstBatch.outputItemId).toBe(ITEM_PREP_ONE);
    expect(firstBatch.declaredQuantity).toMatchObject({ value: 1, scale: 0, unit: 'portion' });
    expect(firstBatch.producedQuantity).toMatchObject({ value: 1, scale: 0, unit: 'portion' });
    // A full batch beats nothing: no shortfall, so no loss row.
    expect(firstBatch.yieldLossQuantity).toMatchObject({ value: 0, scale: 0 });
    // 0.500 kg of raw at 12050 minor units a whole kilogram, computed HERE from the
    // receipt rather than read back from the answer.
    expect(firstBatch.unitCostMinor).toBe(6025);
    expect(firstBatch.totalCostMinor).toBe(6025);
    expect(firstBatch.incompleteCost).toBe(false);
    expect(firstBatch.consumed).toEqual([
      {
        inventoryItemId: ITEM_RAW,
        publicReference: RAW_REFERENCE,
        displayName: 'Harina cruda',
        quantity: { value: 500, scale: 3, unit: 'kilogram' },
        unitCostMinor: RAW_UNIT_COST_MINOR,
        lineCostMinor: 6025,
      },
    ]);

    // FROM THE DATABASE, not from the answer: the rows the batch actually wrote. The
    // batch id IS the lot id, and every entry names it as its source aggregate.
    const entries = await pg.query<{
      entry_type: string;
      inventory_item_id: string;
      quantity: string;
      quantity_scale: number;
      lot_id: string | null;
      source_aggregate_type: string;
      source_aggregate_id: string;
      public_data: Record<string, unknown>;
    }>(
      `SELECT entry_type,inventory_item_id::text AS inventory_item_id,quantity::text AS quantity,
              quantity_scale,lot_id::text AS lot_id,source_aggregate_type,
              source_aggregate_id::text AS source_aggregate_id,public_data
         FROM merchant.stock_ledger_entry
        WHERE merchant_id=$1::uuid AND source_aggregate_id=$2::uuid
        ORDER BY entry_type`,
      [MERCHANT, firstBatch.lotId],
    );
    expect(entries.rows.map((entry) => entry.entry_type)).toEqual([
      'production_consumed',
      'production_produced',
    ]);
    const consumedEntry = entries.rows.find((entry) => entry.entry_type === 'production_consumed');
    expect(consumedEntry).toMatchObject({
      inventory_item_id: ITEM_RAW,
      quantity: '500',
      quantity_scale: 3,
      lot_id: null,
      source_aggregate_type: 'production_batch',
      source_aggregate_id: firstBatch.lotId,
    });
    const producedEntry = entries.rows.find((entry) => entry.entry_type === 'production_produced');
    expect(producedEntry).toMatchObject({
      inventory_item_id: ITEM_PREP_ONE,
      quantity: '1',
      quantity_scale: 0,
      lot_id: firstBatch.lotId,
      source_aggregate_type: 'production_batch',
    });
    expect(producedEntry?.public_data).toMatchObject({
      productionBatchId: firstBatch.lotId,
      unitCostMinor: 6025,
      incompleteCost: false,
    });

    // THE LOT NAMES THE RECIPE, and the batch id is the lot id.
    const lot = await pg.query<{
      public_reference: string;
      origin: string;
      recipe_id: string;
      inventory_item_id: string;
      shelf_life_days: number;
    }>(
      `SELECT public_reference,origin,recipe_id::text AS recipe_id,
              inventory_item_id::text AS inventory_item_id,shelf_life_days
         FROM merchant.stock_lot WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [MERCHANT, firstBatch.lotId],
    );
    expect(lot.rows[0]).toMatchObject({
      public_reference: firstBatch.lotReference,
      origin: 'production',
      recipe_id: RECIPE_PREP_ONE,
      inventory_item_id: ITEM_PREP_ONE,
      shelf_life_days: 3,
    });

    // THE TILL'S OWN DOOR reaches the SAME service method. One batch, authored once,
    // whichever surface asked for it.
    const businessDate = await scoped(() => inventory.currentBusinessDate(MERCHANT));
    const tillBatch = ProductionResult.parse(
      await scoped(() =>
        inventory.production(
          {
            id: USER,
            email: null,
            sessionId: DURABLE_SESSION,
            deviceId: DEVICE,
            commandContextType: 'pos_device',
          },
          MERCHANT,
          ProductionRecord.parse({
            locationId: LOCATION,
            inventoryLocationId: STOCK_ROOM,
            operatorSessionId: OPERATOR_SESSION,
            commandId: randomUUID(),
            idempotencyKey: randomUUID(),
            expectedVersion: 1,
            policyFingerprint: 'd'.repeat(64),
            approvalId: null,
            approvalFingerprint: null,
            businessDate,
            outputItemId: ITEM_PREP_ONE,
            quantity: { value: 1, scale: 0, unit: 'portion' },
            lotCode: null,
            expiresOn: null,
            note: null,
          }),
        ),
      ),
    );
    expect(tillBatch.lotId).not.toBe(firstBatch.lotId);
    expect(tillBatch.unitCostMinor).toBe(6025);

    // THE AUDIT ROW names the lot, which is what a batch leaves behind.
    const audit = await pg.query<{ event_type: string }>(
      `SELECT event_type FROM merchant.audit_event
        WHERE merchant_id=$1::uuid AND entity_id=$2::uuid`,
      [MERCHANT, firstBatch.lotId],
    );
    expect(audit.rows.map((entry) => entry.event_type)).toContain('inventory_production_committed');
  });

  it('names a yield shortfall as a named loss, and writes no loss for a full batch', async () => {
    // A recipe that declares TWO portions of yield. Producing one leaves a shortfall of
    // one, which is the drift D4 makes visible instead of silent.
    const preps = InventoryRecipeList.parse(
      await scoped(() => authoring.recipes(access, InventoryRecipeQuery.parse({}))),
    );
    const prepOne = preps.recipes.find((recipe) => recipe.targetItemId === ITEM_PREP_ONE);
    const amended = (await send('inventory.recipe.update', {
      targetAggregateId: prepOne!.id,
      targetVersion: prepOne!.version,
      parameters: { yieldQuantity: { value: 2, scale: 0, unit: 'portion' } },
    })) as { recipe: { version: number; costMinor: number | null } };
    expect(amended.recipe.version).toBe(prepOne!.version + 1);

    const shortBatch = ProductionResult.parse(
      await send('inventory.production.produce', {
        targetAggregateId: ITEM_PREP_ONE,
        parameters: {
          inventoryLocationId: STOCK_ROOM,
          quantity: { value: 1, scale: 0, unit: 'portion' },
          expiresOn: '2026-12-31',
        },
      }),
    );
    expect(shortBatch.declaredQuantity).toMatchObject({ value: 2, scale: 0 });
    expect(shortBatch.producedQuantity).toMatchObject({ value: 1, scale: 0 });
    expect(shortBatch.yieldLossQuantity).toMatchObject({ value: 1, scale: 0 });
    // THE BATCH IS THE RECIPE'S OWN: the declared yield of 2 portions is what the recipe
    // says this batch makes, and its components are what the server consumes. 0.500 kg of
    // raw at 12050 a kilogram is 6025 for the batch, spread over the two declared portions.
    expect(shortBatch.consumed[0].quantity).toMatchObject({ value: 500, scale: 3 });
    expect(shortBatch.unitCostMinor).toBe(3013);
    expect(shortBatch.totalCostMinor).toBe(3013);
    // THE RECIPE'S OWN COST AGREES: one portion of this recipe costs what production says.
    expect(shortBatch.unitCostMinor).toBe(amended.recipe.costMinor);
    expect(shortBatch.expiresOn).toBe('2026-12-31');

    const entries = await pg.query<{
      entry_type: string;
      quantity: string;
      inventory_item_id: string;
      effect_waste: string;
    }>(
      `SELECT entry_type,quantity::text AS quantity,inventory_item_id::text AS inventory_item_id,
              effect_waste::text AS effect_waste
         FROM merchant.stock_ledger_entry
        WHERE merchant_id=$1::uuid AND source_aggregate_id=$2::uuid
        ORDER BY entry_type`,
      [MERCHANT, shortBatch.lotId],
    );
    expect(entries.rows.map((entry) => entry.entry_type)).toEqual([
      'production_consumed',
      'production_produced',
      'production_yield_loss',
    ]);
    const loss = entries.rows.find((entry) => entry.entry_type === 'production_yield_loss');
    expect(loss).toMatchObject({
      quantity: '1',
      inventory_item_id: ITEM_PREP_ONE,
      // A REAL MOVEMENT, PAIRED WITH THE CREDIT ABOVE IT. The batch is credited at its
      // declared yield and the missing portion is written off, so the net is what the
      // cook got and the variance report can name the loss against it.
      effect_waste: '1',
    });
    const produced = entries.rows.find((entry) => entry.entry_type === 'production_produced');
    expect(produced?.quantity).toBe('2');
  });

  it('names a below-par item on the prep list and renders its labels as a PNG sheet', async () => {
    const list = PrepList.parse(
      await scoped(() => authoring.prepList(access, PrepListQuery.parse({}))),
    );
    const row = list.items.find((item) => item.inventoryItemId === ITEM_PREP_ONE);
    expect(row).toBeDefined();
    expect(row?.publicReference).toBe(PREP_ONE_REFERENCE);
    expect(row?.unit).toBe('portion');
    expect(row?.shelfLifeDays).toBe(3);
    // PAR minus on-hand minus forecast usage, floored at zero. No sale has consumed the
    // prep yet, so the forecast is zero and the shortfall is par minus on-hand.
    expect(row?.parQuantity).toMatchObject({ value: 20, scale: 0 });
    expect(row?.forecastUsageQuantity.value).toBe(0);
    expect(row?.prepQuantity.value).toBe(20 - (row?.onHandQuantity.value ?? 0));
    expect(row?.prepQuantity.value).toBeGreaterThan(0);
    expect(row?.expiresOn).toBe(
      new Date(Date.parse(`${list.to}T00:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10),
    );
    // The window is stated rather than implied.
    expect(list.to >= list.from).toBe(true);

    const png = await scoped(() => authoring.prepLabelSheet(access, PrepListQuery.parse({})));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.byteLength).toBeGreaterThan(1000);
  });

  it('answers the recall with the sales of the lot item inside its life window', async () => {
    const businessDate = await scoped(() => inventory.currentBusinessDate(MERCHANT));
    const sale = await seedCommittedSale({
      businessDate,
      productId: PRODUCT_PLATE,
      productName: 'Masa madre',
      inventoryItemId: ITEM_PREP_ONE,
      quantity: 1,
    });
    expect(sale.saleId).toBeTruthy();

    const recall = LotRecall.parse(await scoped(() => authoring.recall(access, firstBatch.lotId)));
    expect(recall).toMatchObject({
      lotId: firstBatch.lotId,
      lotReference: firstBatch.lotReference,
      inventoryItemId: ITEM_PREP_ONE,
      inventoryItemName: 'Masa madre',
      origin: 'production',
      basis: 'item_and_window',
    });
    expect(recall.sales).toHaveLength(1);
    expect(recall.sales[0]).toMatchObject({
      saleId: sale.saleId,
      productName: 'Masa madre',
      quantity: { value: 1, scale: 0, unit: 'portion' },
      businessDate,
    });
    expect(recall.saleCount).toBe(1);
    // The window is stated, and it is the LOT's own life.
    expect(recall.windowFrom < recall.windowTo).toBe(true);

    // AN UNKNOWN LOT is a not-found rather than an empty set of sales.
    const unknown = await refusal(() => scoped(() => authoring.recall(access, fixtureId(0xfe))));
    expect(unknown).toMatchObject({ status: 404, code: 'RESOURCE_NOT_FOUND' });
  });
});
