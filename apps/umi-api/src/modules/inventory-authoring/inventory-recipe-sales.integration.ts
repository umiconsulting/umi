import { createHash, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryQuery, RestockCommand, type CheckoutCommand } from '@umi/contract';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import { MetricsService } from '../../shared/operations/metrics.service';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { AdministrativeCommandContextService } from '../administrative-commands/administrative-command-context.service';
import { AdministrativeCommandExecutionService } from '../administrative-commands/administrative-command-execution.service';
import { AdministrativeCommandRepository } from '../administrative-commands/administrative-command.repository';
import { IntegrityRepository } from '../integrity/integrity.repository';
import { IntegrityService } from '../integrity/integrity.service';
import { InventoryCostingRepository } from '../inventory-costing/inventory-costing.repository';
import { InventoryCostingService } from '../inventory-costing/inventory-costing.service';
import { PosCartRepository } from '../pos-cart/pos-cart.repository';
import { PosCartService } from '../pos-cart/pos-cart.service';
import { PosCashRepository } from '../pos-cash/pos-cash.repository';
import { PosCashService } from '../pos-cash/pos-cash.service';
import { PosCheckoutRepository } from '../pos-checkout/pos-checkout.repository';
import { PosCheckoutService } from '../pos-checkout/pos-checkout.service';
import { PosExceptionRepository } from '../pos-exception/pos-exception.repository';
import {
  exceptionCommandFingerprint,
  PosExceptionService,
} from '../pos-exception/pos-exception.service';
import { inventoryOperationFingerprint } from '../pos-inventory/inventory-errors';
import { PosInventoryRepository } from '../pos-inventory/pos-inventory.repository';
import { PosInventoryService } from '../pos-inventory/pos-inventory.service';
import { InventoryAuthoringRepository } from './inventory-authoring.repository';
import { InventoryAuthoringService } from './inventory-authoring.service';

// Each scenario creates its own product, ingredient, recipe, and stock history.
// Only infrastructure is shared. Sales always pass through the real checkout service.
const APP_DSN = process.env.DATABASE_URL_APP;
const WORKER_DSN = process.env.DATABASE_URL_WORKER;
const RUN = randomUUID().slice(0, 8);
let MERCHANT = randomUUID();
let LOCATION = randomUUID();
let USER = randomUUID();
let STAFF = randomUUID();
let DEVICE = randomUUID();
let SESSION = randomUUID();
let OPERATOR = randomUUID();
let DASHBOARD = randomUUID();
let ROOM = randomUUID();
let REGISTER = randomUUID();
const POLICY = 'a'.repeat(64);
const money = (minorUnits: number) => ({ minorUnits, currency: 'MXN' });
const kg = (value: number) => ({ value, scale: 2, unit: 'kilogram' as const });
const till: AuthUser = { id: USER, sessionId: SESSION, deviceId: DEVICE, email: null };
const owner: AuthUser = {
  id: USER,
  sessionId: DASHBOARD,
  deviceId: null,
  email: null,
  commandContextType: 'dashboard_administrative',
};
const access: MerchantAccess = {
  merchantId: MERCHANT,
  locationId: LOCATION,
  membershipId: STAFF,
  name: 'Recipe sales',
  handle: null,
  timezone: 'America/Mazatlan',
  role: 'owner',
  roles: ['owner'],
  permissions: ['inventory.item.manage', 'inventory.recipe.manage'],
};
type Operation = Parameters<AdministrativeCommandExecutionService['execute']>[2]['operation'];
type RecipeResult = { recipe: { id: string; version: number } };

describe('authored recipes through checkout and confirmed return restock', () => {
  let pg: PgService;
  let commands: AdministrativeCommandExecutionService;
  let checkout: PosCheckoutService;
  let checkoutRepo: PosCheckoutRepository;
  let carts: PosCartService;
  let returns: PosExceptionService;
  let inventory: PosInventoryService;
  let shiftId: string;
  let businessDate: string;

  const scoped = <T>(work: () => Promise<T>) =>
    runWithRequestContext(
      {
        merchantId: MERCHANT,
        locationId: LOCATION,
        userId: USER,
        deviceId: DEVICE,
        requestId: randomUUID(),
      },
      work,
    );
  const send = (
    operation: Operation,
    targetAggregateId: string,
    parameters: Record<string, unknown> = {},
    targetVersion: number | null = null,
  ) =>
    scoped(() =>
      commands.execute(owner, access, {
        operation,
        targetAggregateId,
        parameters,
        targetVersion,
        locationId: LOCATION,
        commandId: randomUUID(),
        idempotencyKey: randomUUID(),
        approvalId: null,
      }),
    );

  beforeAll(async () => {
    if (!APP_DSN || !WORKER_DSN)
      throw new Error('Set both database URLs to a disposable build-v3 database.');
    const env: Record<string, string | undefined> = {
      DATABASE_URL_APP: APP_DSN,
      DATABASE_URL_WORKER: WORKER_DSN,
      JWT_SECRET: 'recipe-sales-harness-secret-00000000',
    };
    pg = new PgService({ get: (key: string) => env[key] } as unknown as ConfigService<
      AppConfig,
      true
    >);
    await pg.onModuleInit();
    const integrity = new IntegrityService(new IntegrityRepository(pg));
    const costing = new InventoryCostingService(
      new InventoryCostingRepository(pg),
      new MetricsService(),
    );
    const authoring = new InventoryAuthoringService(
      new InventoryAuthoringRepository(pg),
      integrity,
      costing,
    );
    inventory = new PosInventoryService(
      new PosInventoryRepository(pg),
      integrity,
      costing,
      new MetricsService(),
      authoring,
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
      authoring,
    );
    const cartRepo = new PosCartRepository(pg);
    carts = new PosCartService(cartRepo, integrity);
    checkoutRepo = new PosCheckoutRepository(pg);
    checkout = new PosCheckoutService(checkoutRepo, cartRepo, integrity);
    // Cash refunds need no terminal, fiscal cancellation, or manager-login adapter.
    returns = new PosExceptionService(
      new PosExceptionRepository(pg),
      integrity,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  beforeEach(async () => {
    MERCHANT = randomUUID();
    LOCATION = randomUUID();
    USER = randomUUID();
    STAFF = randomUUID();
    DEVICE = randomUUID();
    SESSION = randomUUID();
    OPERATOR = randomUUID();
    DASHBOARD = randomUUID();
    ROOM = randomUUID();
    REGISTER = randomUUID();
    Object.assign(till, { id: USER, sessionId: SESSION, deviceId: DEVICE });
    Object.assign(owner, { id: USER, sessionId: DASHBOARD });
    Object.assign(access, { merchantId: MERCHANT, locationId: LOCATION, membershipId: STAFF });
    await pg.query(
      `INSERT INTO merchant.merchant(id,name,handle,currency,timezone)
      VALUES($1,'Recipe sales',$2,'MXN','America/Mazatlan')`,
      [MERCHANT, `recipe-sales-${RUN}-${MERCHANT}`],
    );
    await pg.query(`INSERT INTO merchant.location(id,merchant_id,name) VALUES($1,$2,'Centro')`, [
      LOCATION,
      MERCHANT,
    ]);
    await pg.query(`INSERT INTO umi."user"(id,full_name) VALUES($1,'Recipe operator')`, [USER]);
    await pg.query(
      `INSERT INTO merchant.staff(id,merchant_id,location_id,user_id,role_id,name)
      SELECT $1,$2,$3,$4,id,'Recipe operator' FROM umi.role WHERE key='cashier'`,
      [STAFF, MERCHANT, LOCATION, USER],
    );
    await pg.query(
      `INSERT INTO merchant.device(id,merchant_id,location_id,name,kind,status)
      VALUES($1,$2,$3,'Recipe till','pos_terminal','active')`,
      [DEVICE, MERCHANT, LOCATION],
    );
    await pg.query(
      `INSERT INTO runtime.dashboard_session(id,user_id,token_hash,expires_at)
      VALUES($1,$2,$3,now()+interval '2 hours')`,
      [DASHBOARD, USER, createHash('sha256').update(DASHBOARD).digest('hex')],
    );
    await pg.query(
      `INSERT INTO runtime.session(id,merchant_id,principal_type,principal_id,token_hash,expires_at)
      VALUES($1,$2,'user',$3,$4,now()+interval '2 hours')`,
      [SESSION, MERCHANT, USER, createHash('sha256').update(SESSION).digest('hex')],
    );
    await pg.query(
      `INSERT INTO runtime.operator_session
      (id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,permissions,entitlements,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '2 hours')`,
      [
        OPERATOR,
        SESSION,
        USER,
        STAFF,
        DEVICE,
        MERCHANT,
        LOCATION,
        [
          'cart.write',
          'checkout.commit',
          'cash.shift.open',
          'sale.exception.read',
          'sale.refund.full',
          'sale.refund.cash',
          'inventory.read',
          'inventory.restock.resolve',
        ],
        JSON.stringify([{ featureKey: 'pos', enabled: true }]),
      ],
    );
    await pg.query(
      `INSERT INTO merchant.inventory_location
      (id,merchant_id,location_id,public_reference,display_name,location_type)
      VALUES($1,$2,$3,'ROOM','Recipe stock','stock_room')`,
      [ROOM, MERCHANT, LOCATION],
    );
    await pg.query(
      `INSERT INTO merchant.inventory_policy
      (merchant_id,location_id,inventory_location_id,version,tracking_enabled,maximum_reservation_lines,expires_at,fingerprint)
      VALUES($1,$2,$3,'recipe-sales',true,50,now()+interval '1 day',$4)`,
      [MERCHANT, LOCATION, ROOM, POLICY],
    );
    await pg.query(
      `INSERT INTO merchant.cash_shift_policy
      (merchant_id,location_id,currency,version,maximum_opening_float,allowed_movement_types,
       variance_tolerance,expires_at,fingerprint,denominations,count_method)
      VALUES($1,$2,'MXN','recipe-sales',1000000,'{}',0,now()+interval '1 day',$3,'[]','total_only')`,
      [MERCHANT, LOCATION, POLICY],
    );
    await pg.query(
      `INSERT INTO merchant.physical_register
      (id,merchant_id,location_id,display_name,public_reference,currency,active,assignment_policy,
       assigned_device_id,allowed_device_classes,status)
      VALUES($1,$2,$3,'Recipe register','RECIPES','MXN',true,'device_required',$4,ARRAY['pos_terminal'],'available')`,
      [REGISTER, MERCHANT, LOCATION, DEVICE],
    );
    await pg.query(
      `INSERT INTO merchant.pos_exception_policy
      (merchant_id,location_id,currency,version,refunds_enabled,voids_enabled,refund_window_minutes,
       void_window_minutes,cashier_refund_threshold,cash_refund_threshold,cash_refund_requires_shift,
       require_different_approver,tender_allocation_policy,tip_refund_policy,maximum_lines,expires_at,fingerprint)
      VALUES($1,$2,'MXN','recipe-sales',true,false,1440,60,1000000,1000000,true,false,
       'proportional','non_refundable',50,now()+interval '1 day',$3)`,
      [MERCHANT, LOCATION, POLICY],
    );
    businessDate = (
      await pg.query<{ value: string }>(
        `SELECT
      ((now() at time zone timezone)-business_day_start::interval)::date::text AS value
      FROM merchant.merchant WHERE id=$1`,
        [MERCHANT],
      )
    ).rows[0].value;
    const opened = await scoped(() =>
      new PosCashService(
        new PosCashRepository(pg),
        new IntegrityService(new IntegrityRepository(pg)),
      ).open(till, MERCHANT, {
        commandId: randomUUID(),
        idempotencyKey: randomUUID(),
        locationId: LOCATION,
        operatorSessionId: OPERATOR,
        registerId: REGISTER,
        openingFloat: money(100000),
        denominations: [],
        businessDate,
        note: null,
        expectedRegisterVersion: 1,
      }),
    );
    shiftId = opened.shift.id;
  }, 120_000);

  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  async function fixture(stock = 1000, negativeStockPolicy = 'block') {
    const productId = randomUUID();
    const itemId = randomUUID();
    const recipeId = randomUUID();
    await pg.query(
      `INSERT INTO merchant.product(id,merchant_id,name,price,tax_rate_basis_points,active)
      VALUES($1,$2,'Recipe plate',1000,0,true)`,
      [productId, MERCHANT],
    );
    expect(
      (
        await pg.query(`SELECT id FROM merchant.inventory_catalog_mapping WHERE product_id=$1`, [
          productId,
        ])
      ).rowCount,
    ).toBe(0);
    await send('inventory.item.create', itemId, {
      publicReference: `ING-${itemId}`,
      displayName: 'Recipe ingredient',
      itemType: 'ingredient',
      baseUnit: 'kilogram',
      quantityScale: 2,
      trackingPolicy: 'tracked',
      negativeStockPolicy,
    });
    await scoped(() =>
      pg.runWithMerchant(
        MERCHANT,
        USER,
        (client) =>
          client.query(
            `SELECT merchant.append_stock_ledger($1,$2,$3,$4,'opening_balance',$5,$6,$7,$8,
       'inventory_opening',$6,$9,$10,1,$11::date,$12,null,null,null,null,'{}')`,
            [
              MERCHANT,
              LOCATION,
              ROOM,
              itemId,
              stock,
              randomUUID(),
              randomUUID(),
              POLICY,
              USER,
              DEVICE,
              businessDate,
              randomUUID(),
            ],
          ),
        LOCATION,
      ),
    );
    await createRecipe(recipeId, productId, itemId, 125);
    return { productId, itemId, recipeId, mapping: await mappingFor(productId) };
  }

  const components = (itemId: string, quantity: number) => [
    { inventoryItemId: itemId, quantity: kg(quantity) },
  ];
  const createRecipe = (
    id: string,
    productId: string,
    itemId: string,
    quantity: number,
    variantId?: string,
  ) =>
    send('inventory.recipe.create', id, {
      targetKind: 'product',
      productId,
      ...(variantId ? { variantId } : {}),
      yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
      components: components(itemId, quantity),
    });
  async function mappingFor(productId: string, variantId: string | null = null) {
    return (
      await pg.query<{ id: string; version: number; recipe_id: string }>(
        `SELECT id::text,version,recipe_id::text
      FROM merchant.inventory_catalog_mapping WHERE product_id=$1 AND variant_id IS NOT DISTINCT FROM $2::uuid AND active`,
        [productId, variantId],
      )
    ).rows[0];
  }
  async function balance(itemId: string) {
    return (
      await pg.query(
        `SELECT on_hand::integer,reserved::integer,available::integer
      FROM merchant.stock_balance WHERE inventory_location_id=$1 AND inventory_item_id=$2`,
        [ROOM, itemId],
      )
    ).rows[0];
  }
  async function ledger(itemId: string, entryType: string) {
    return (
      await pg.query(
        `SELECT quantity::integer,quantity_scale,unit,sale_id::text,sale_line_id::text,public_data
      FROM merchant.stock_ledger_entry WHERE merchant_id=$1 AND inventory_item_id=$2 AND entry_type=$3
      ORDER BY sequence`,
        [MERCHANT, itemId, entryType],
      )
    ).rows;
  }
  async function prepare(productId: string, quantity = 1, variantId: string | null = null) {
    const cart = await scoped(() =>
      carts.create(till, MERCHANT, {
        locationId: LOCATION,
        operatorSessionId: OPERATOR,
        idempotencyKey: randomUUID(),
      }),
    );
    const filled = await scoped(() =>
      carts.add(till, MERCHANT, {
        cartId: cart.id,
        locationId: LOCATION,
        operatorSessionId: OPERATOR,
        productId,
        variantId,
        modifierSelections: [],
        quantity,
        courseNumber: 1,
        note: null,
        expectedVersion: cart.version,
        idempotencyKey: randomUUID(),
      }),
    );
    const dto: CheckoutCommand = {
      commandId: randomUUID(),
      idempotencyKey: randomUUID(),
      cartId: filled.id,
      locationId: LOCATION,
      operatorSessionId: OPERATOR,
      cashShiftId: shiftId,
      expectedCartVersion: filled.version,
      paymentMethod: 'cash',
      totalsFingerprint: null,
      tenderDrafts: [
        {
          id: randomUUID(),
          type: 'cash',
          amount: money(1000 * quantity),
          amountReceived: money(1000 * quantity),
          status: 'draft',
          correlationId: null,
        },
      ],
      tipDraft: null,
      discountDrafts: [],
      approvalIds: [],
      receiptDelivery: { destination: 'display', channel: null, customerContactId: null },
      customerValue: null,
    };
    const preview = await scoped(() =>
      checkout.checkout(till, MERCHANT, {
        ...dto,
        commandId: randomUUID(),
        idempotencyKey: randomUUID(),
      }),
    );
    expect(preview.status).toBe('confirmation_required');
    if (preview.status !== 'confirmation_required') throw new Error(JSON.stringify(preview));
    dto.totalsFingerprint = preview.confirmation.fingerprint;
    return { cart: filled, dto };
  }
  const commit = (dto: CheckoutCommand) => scoped(() => checkout.checkout(till, MERCHANT, dto));
  async function sale(dto: CheckoutCommand) {
    const result = await commit(dto);
    expect(result.status, result.failure?.code).toBe('completed');
    if (result.status !== 'completed') throw new Error(JSON.stringify(result));
    return result;
  }
  async function approve(permission: string, fingerprint: string) {
    const id = randomUUID();
    await pg.query(
      `INSERT INTO runtime.elevation_grant
      (id,session_id,merchant_id,location_id,permission_key,method,approved_by,expires_at,command_fingerprint)
      VALUES($1,$2,$3,$4,$5,'manager_approval',$6,now()+interval '1 hour',$7)`,
      [id, SESSION, MERCHANT, LOCATION, permission, USER, fingerprint],
    );
    return id;
  }

  it('consumes an authored recipe once and restores the original quantities after a recipe edit', async () => {
    const f = await fixture();
    const original = await prepare(f.productId, 2);
    const first = await sale(original.dto);
    expect(await balance(f.itemId)).toEqual({ on_hand: 750, reserved: 0, available: 750 });
    expect(await commit(original.dto)).toEqual(first);
    expect(await ledger(f.itemId, 'sale_committed')).toEqual([
      expect.objectContaining({
        quantity: 250,
        quantity_scale: 2,
        unit: 'kilogram',
        sale_line_id: original.cart.items[0].id,
        public_data: {
          mappingId: f.mapping.id,
          mappingVersion: 1,
          recipeId: f.recipeId,
          recipeVersion: 1,
        },
      }),
    ]);
    const updated = (await send(
      'inventory.recipe.update',
      f.recipeId,
      { components: components(f.itemId, 200) },
      1,
    )) as RecipeResult;
    const current = await mappingFor(f.productId);
    expect(current.id).not.toBe(f.mapping.id);
    const later = await prepare(f.productId);
    await sale(later.dto);
    expect((await ledger(f.itemId, 'sale_committed'))[1]).toMatchObject({
      quantity: 200,
      public_data: {
        mappingId: current.id,
        mappingVersion: 2,
        recipeId: updated.recipe.id,
        recipeVersion: 2,
      },
    });
    expect(await balance(f.itemId)).toEqual({ on_hand: 550, reserved: 0, available: 550 });
    const saleId = (
      await pg.query<{ id: string }>(
        `SELECT id::text FROM merchant.pos_committed_sale WHERE cart_id=$1`,
        [original.cart.id],
      )
    ).rows[0].id;
    const eligibility = await scoped(() =>
      returns.eligibility(till, MERCHANT, saleId, {
        locationId: LOCATION,
        operatorSessionId: OPERATOR,
      }),
    );
    const preview = await scoped(() =>
      returns.preview(till, MERCHANT, saleId, {
        locationId: LOCATION,
        operatorSessionId: OPERATOR,
        exceptionType: 'full_refund',
        reason: 'customer_changed_mind',
        note: null,
        lines: [{ saleLineId: original.cart.items[0].id, quantity: 2, restockDecision: 'restock' }],
        expectedSaleVersion: eligibility.sale.version,
      }),
    );
    const refund = {
      locationId: LOCATION,
      operatorSessionId: OPERATOR,
      previewId: preview.previewId,
      previewFingerprint: preview.previewFingerprint,
      approvalId: null,
      expectedSaleVersion: preview.saleVersion,
      commandId: randomUUID(),
      idempotencyKey: randomUUID(),
      offline: false as const,
      fiscalMotive: '02' as const,
    };
    const approvedRefund = {
      ...refund,
      approvalId: await approve(
        'sale.refund.approve',
        exceptionCommandFingerprint(
          saleId,
          refund.previewId,
          refund.previewFingerprint,
          refund.commandId,
        ),
      ),
    };
    const refunded = await scoped(() => returns.commit(till, MERCHANT, saleId, approvedRefund));
    expect(await scoped(() => returns.commit(till, MERCHANT, saleId, approvedRefund))).toEqual(
      refunded,
    );
    expect(await balance(f.itemId)).toEqual({ on_hand: 550, reserved: 0, available: 550 });
    expect(await ledger(f.itemId, 'refund_restocked')).toHaveLength(0);
    const overview = await scoped(() =>
      inventory.overview(
        till,
        MERCHANT,
        InventoryQuery.parse({
          locationId: LOCATION,
          operatorSessionId: OPERATOR,
          inventoryLocationId: ROOM,
        }),
      ),
    );
    const review = overview.restockReviews.find(
      (row) => row.saleLineId === original.cart.items[0].id,
    );
    expect(review).toMatchObject({
      decision: 'restock',
      quantity: 2,
      components: [
        {
          inventoryItemId: f.itemId,
          maximum: kg(250),
          recipeEffect: true,
        },
      ],
    });
    if (!review) throw new Error('The original sale has no restock review.');
    const restock = RestockCommand.parse({
      locationId: LOCATION,
      operatorSessionId: OPERATOR,
      inventoryLocationId: ROOM,
      restockIntentId: review.restockIntentId,
      expectedVersion: review.version,
      policyFingerprint: POLICY,
      commandId: randomUUID(),
      idempotencyKey: randomUUID(),
      businessDate,
      componentDecisions: review.components.map((component) => ({
        inventoryItemId: component.inventoryItemId,
        outcome: 'restocked',
        quantity: component.maximum,
      })),
    });
    restock.approvalFingerprint = inventoryOperationFingerprint('pos.inventory.restock', restock);
    restock.approvalId = await approve('inventory.restock.approve', restock.approvalFingerprint);
    const restored = await scoped(() => inventory.restock(till, MERCHANT, restock));
    expect(restored.entries).toHaveLength(1);
    expect(restored.entries[0].quantity).toEqual(kg(250));
    expect(await scoped(() => inventory.restock(till, MERCHANT, restock))).toEqual(restored);
    expect(await balance(f.itemId)).toEqual({ on_hand: 800, reserved: 0, available: 800 });
    expect(await ledger(f.itemId, 'refund_restocked')).toEqual([
      expect.objectContaining({
        quantity: 250,
        sale_id: saleId,
        sale_line_id: original.cart.items[0].id,
      }),
    ]);
    expect((await ledger(f.itemId, 'sale_committed'))[0].public_data).toEqual({
      mappingId: f.mapping.id,
      mappingVersion: 1,
      recipeId: f.recipeId,
      recipeVersion: 1,
    });
  });

  it('blocks insufficient stock without a sale or stock movement', async () => {
    const f = await fixture(100);
    const prepared = await prepare(f.productId);
    await expect(commit(prepared.dto)).rejects.toMatchObject({
      response: { code: 'NEGATIVE_STOCK_BLOCKED' },
    });
    expect(await balance(f.itemId)).toEqual({ on_hand: 100, reserved: 0, available: 100 });
    expect(await ledger(f.itemId, 'sale_committed')).toHaveLength(0);
    expect(await ledger(f.itemId, 'reservation_created')).toHaveLength(0);
    expect(
      (
        await pg.query(`SELECT id FROM merchant.pos_committed_sale WHERE cart_id=$1`, [
          prepared.cart.id,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it('requires manager approval when the recipe would exceed stock', async () => {
    const f = await fixture(100, 'manager_override');
    const prepared = await prepare(f.productId);
    const refused = await commit(prepared.dto);
    expect(refused.status).toBe('payment_pending');
    expect(refused.failure?.code).toBe('APPROVAL_REQUIRED');
    expect(await balance(f.itemId)).toEqual({ on_hand: 100, reserved: 0, available: 100 });
    expect(await ledger(f.itemId, 'sale_committed')).toHaveLength(0);
    const approvalId = await approve(
      'inventory.negative_stock.override',
      prepared.dto.totalsFingerprint!,
    );
    const approved = {
      ...prepared.dto,
      commandId: randomUUID(),
      idempotencyKey: randomUUID(),
      approvalIds: [approvalId],
    };
    const completed = await sale(approved);
    expect(await commit(approved)).toEqual(completed);
    expect(await balance(f.itemId)).toEqual({ on_hand: -25, reserved: 0, available: -25 });
    expect((await ledger(f.itemId, 'sale_committed')).map((row) => row.quantity)).toEqual([125]);
    expect((await ledger(f.itemId, 'sale_committed'))[0].public_data).toMatchObject({
      negativeStockApprovalId: approvalId,
    });
    expect(
      (
        await pg.query(
          `SELECT consumed_by_command_id::text,command_fingerprint
      FROM runtime.elevation_grant WHERE id=$1`,
          [approvalId],
        )
      ).rows,
    ).toEqual([
      {
        consumed_by_command_id: approved.commandId,
        command_fingerprint: prepared.dto.totalsFingerprint,
      },
    ]);
  });

  it('allows a sale below zero under allow_and_flag and replays consumption once', async () => {
    const f = await fixture(100, 'allow_and_flag');
    const prepared = await prepare(f.productId);
    const completed = await sale(prepared.dto);
    expect(await commit(prepared.dto)).toEqual(completed);
    expect(await balance(f.itemId)).toEqual({ on_hand: -25, reserved: 0, available: -25 });
    expect(await ledger(f.itemId, 'sale_committed')).toEqual([
      expect.objectContaining({
        quantity: 125,
        public_data: {
          mappingId: f.mapping.id,
          mappingVersion: 1,
          recipeId: f.recipeId,
          recipeVersion: 1,
        },
      }),
    ]);
    expect((await ledger(f.itemId, 'reservation_created')).map((row) => row.quantity)).toEqual([
      125,
    ]);
  });

  it('uses the exact variant recipe and the product fallback after retirement', async () => {
    const f = await fixture();
    const exact = randomUUID();
    const inherited = randomUUID();
    for (const id of [exact, inherited])
      await pg.query(
        `INSERT INTO merchant.product_variant
      (id,merchant_id,product_id,name,price_delta) VALUES($1,$2,$3,$4,0)`,
        [id, MERCHANT, f.productId, id],
      );
    const variantRecipe = randomUUID();
    await createRecipe(variantRecipe, f.productId, f.itemId, 200, exact);
    const exactMapping = await mappingFor(f.productId, exact);
    const first = await prepare(f.productId, 1, exact);
    await sale(first.dto);
    const second = await prepare(f.productId, 1, inherited);
    await sale(second.dto);
    await send('inventory.recipe.retire', variantRecipe, {}, 1);
    const third = await prepare(f.productId, 1, exact);
    await sale(third.dto);
    expect(
      (await ledger(f.itemId, 'sale_committed')).map((row) => ({
        quantity: row.quantity,
        mappingId: row.public_data.mappingId,
        recipeId: row.public_data.recipeId,
      })),
    ).toEqual([
      { quantity: 200, mappingId: exactMapping.id, recipeId: variantRecipe },
      { quantity: 125, mappingId: f.mapping.id, recipeId: f.recipeId },
      { quantity: 125, mappingId: f.mapping.id, recipeId: f.recipeId },
    ]);
    expect(await balance(f.itemId)).toEqual({ on_hand: 550, reserved: 0, available: 550 });
  });

  it('refuses checkout after retirement leaves no fallback mapping', async () => {
    const f = await fixture();
    const prepared = await prepare(f.productId);
    await send('inventory.recipe.retire', f.recipeId, {}, 1);
    await expect(commit(prepared.dto)).rejects.toMatchObject({
      response: { code: 'INVENTORY_MAPPING_REQUIRED' },
    });
    expect(await balance(f.itemId)).toEqual({ on_hand: 1000, reserved: 0, available: 1000 });
    expect(await ledger(f.itemId, 'sale_committed')).toHaveLength(0);
  });

  it('consumes captured ingredients once when retirement starts after mapping coverage', async () => {
    const f = await fixture();
    const prepared = await prepare(f.productId);
    let resumeCheckout!: () => void;
    const checkoutBarrier = new Promise<void>((resolve) => {
      resumeCheckout = resolve;
    });
    let coverageReached!: () => void;
    const coverageBarrier = new Promise<void>((resolve) => {
      coverageReached = resolve;
    });
    let checkoutPid = 0;
    const reserve = checkoutRepo.reserve.bind(checkoutRepo);
    // Pause after the real coverage query. All service and SQL effects stay real.
    const interceptor = vi.spyOn(checkoutRepo, 'reserve').mockImplementation((client, ...args) => {
      const controlled = new Proxy(client, {
        get(target, key, receiver) {
          if (key !== 'query') return Reflect.get(target, key, receiver);
          return async (sql: string, params?: unknown[]) => {
            const result = await target.query(sql, params);
            if (sql.includes('SELECT count(*)::integer AS mapped')) {
              checkoutPid = (await target.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
                .rows[0].pid;
              coverageReached();
              await checkoutBarrier;
            }
            return result;
          };
        },
      });
      return reserve(controlled, ...args);
    });
    const checkoutOutcome = commit(prepared.dto).then(
      (result) => ({ result, error: null }),
      (error: unknown) => ({ result: null, error }),
    );
    let retirement: Promise<unknown> | undefined;
    let retirementFinished = false;
    let retirementBlocked = false;
    try {
      await Promise.race([
        coverageBarrier,
        checkoutOutcome.then(() => {
          throw new Error('Checkout stopped before the coverage barrier.');
        }),
      ]);
      // A second reader can hold the same product while checkout remains paused.
      await scoped(() =>
        pg.runWithMerchant(
          MERCHANT,
          USER,
          async (client) => {
            await client.query('SELECT id FROM merchant.product WHERE id=$1 FOR SHARE NOWAIT', [
              f.productId,
            ]);
          },
          LOCATION,
        ),
      );
      retirement = send('inventory.recipe.retire', f.recipeId, {}, 1).then((result) => {
        retirementFinished = true;
        return result;
      });
      // Observe a durable database wait or a committed retirement. No timing race
      // chooses the schedule: checkout remains at its coverage barrier throughout.
      await vi.waitFor(
        async () => {
          retirementBlocked = (
            await pg.query<{ waiting: boolean }>(
              `SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
            AND $1=ANY(pg_blocking_pids(pid))
        ) AS waiting`,
              [checkoutPid],
            )
          ).rows[0].waiting;
          expect(retirementFinished || retirementBlocked).toBe(true);
        },
        { timeout: 5000, interval: 10 },
      );
      resumeCheckout();
      const outcome = await checkoutOutcome;
      if (outcome.error) {
        throw outcome.error instanceof Error
          ? outcome.error
          : new Error('Checkout failed.', { cause: outcome.error });
      }
      expect(outcome.result?.status).toBe('completed');
      await retirement;
      expect(await ledger(f.itemId, 'sale_committed')).toEqual([
        expect.objectContaining({
          quantity: 125,
          sale_line_id: prepared.cart.items[0].id,
          public_data: {
            mappingId: f.mapping.id,
            mappingVersion: 1,
            recipeId: f.recipeId,
            recipeVersion: 1,
          },
        }),
      ]);
      expect(retirementBlocked).toBe(true);
      expect(await commit(prepared.dto)).toEqual(outcome.result);
      expect((await ledger(f.itemId, 'sale_committed')).map((row) => row.quantity)).toEqual([125]);
      expect(await balance(f.itemId)).toEqual({ on_hand: 875, reserved: 0, available: 875 });
      expect(
        (
          await pg.query(
            `SELECT s.id FROM merchant.pos_committed_sale s
        WHERE s.cart_id=$1 AND NOT EXISTS (SELECT 1 FROM merchant.stock_ledger_entry e
          WHERE e.sale_id=s.id AND e.entry_type='sale_committed')`,
            [prepared.cart.id],
          )
        ).rows,
      ).toEqual([]);
    } finally {
      resumeCheckout();
      await Promise.allSettled([checkoutOutcome, ...(retirement ? [retirement] : [])]);
      interceptor.mockRestore();
    }
  });

  it('preserves the captured recipe without counting its reserved stock twice for approval', async () => {
    const f = await fixture(300, 'manager_override');
    const prepared = await prepare(f.productId, 2);
    // The public checkout reserves and commits atomically. Capture its repository boundary
    // first to reproduce a reservation that predates the administrative recipe edit.
    const authorization = await scoped(() =>
      checkoutRepo.authorize(USER, SESSION, DEVICE, MERCHANT, LOCATION, OPERATOR),
    );
    if (!authorization) throw new Error('The till has no checkout authorization.');
    const reservation = await scoped(() =>
      pg.runWithMerchant(
        MERCHANT,
        USER,
        async (client) => {
          const cart = await checkoutRepo.lockCart(
            client,
            MERCHANT,
            LOCATION,
            OPERATOR,
            prepared.cart.id,
            prepared.cart.version,
            authorization.operatorName,
          );
          if (!cart) throw new Error('The fixture cart cannot be locked.');
          return checkoutRepo.reserve(
            client,
            cart,
            cart.lines,
            authorization,
            randomUUID(),
            randomUUID(),
            prepared.dto.totalsFingerprint!,
            randomUUID(),
            null,
          );
        },
        LOCATION,
      ),
    );
    expect(await balance(f.itemId)).toEqual({ on_hand: 300, reserved: 250, available: 50 });
    await send('inventory.recipe.update', f.recipeId, { components: components(f.itemId, 200) }, 1);
    await sale(prepared.dto);
    const captured = await pg.query(
      `SELECT mapping_id::text,recipe_id::text,recipe_version,required_quantity::integer
      FROM merchant.inventory_reservation_line WHERE reservation_id=$1`,
      [reservation.id],
    );
    expect(captured.rows).toEqual([
      {
        mapping_id: f.mapping.id,
        recipe_id: f.recipeId,
        recipe_version: 1,
        required_quantity: 250,
      },
    ]);
    expect((await ledger(f.itemId, 'reservation_created')).map((row) => row.quantity)).toEqual([
      250,
    ]);
    expect(await ledger(f.itemId, 'sale_committed')).toEqual([
      expect.objectContaining({
        quantity: 250,
        public_data: {
          mappingId: f.mapping.id,
          mappingVersion: 1,
          recipeId: f.recipeId,
          recipeVersion: 1,
        },
      }),
    ]);
    expect(await balance(f.itemId)).toEqual({ on_hand: 50, reserved: 0, available: 50 });
  });

  it('uses current checkout approval after a tender changes without replacing reservation provenance', async () => {
    const f = await fixture(100, 'manager_override');
    const prepared = await prepare(f.productId);
    const originalFingerprint = prepared.dto.totalsFingerprint!;
    const originalApproval = await approve(
      'inventory.negative_stock.override',
      originalFingerprint,
    );
    const reservationCommand = randomUUID();
    const authorization = await scoped(() =>
      checkoutRepo.authorize(USER, SESSION, DEVICE, MERCHANT, LOCATION, OPERATOR),
    );
    if (!authorization) throw new Error('The till has no checkout authorization.');
    const reservation = await scoped(() =>
      pg.runWithMerchant(
        MERCHANT,
        USER,
        async (client) => {
          const cart = await checkoutRepo.lockCart(
            client,
            MERCHANT,
            LOCATION,
            OPERATOR,
            prepared.cart.id,
            prepared.cart.version,
            authorization.operatorName,
          );
          if (!cart) throw new Error('The fixture cart cannot be locked.');
          const consumed = await checkoutRepo.consumeApprovals(client, [originalApproval], {
            sessionId: SESSION,
            merchantId: MERCHANT,
            locationId: LOCATION,
            permissions: ['inventory.negative_stock.override'],
            fingerprint: originalFingerprint,
            commandId: reservationCommand,
          });
          expect(consumed.approved).toBe(true);
          return checkoutRepo.reserve(
            client,
            cart,
            cart.lines,
            authorization,
            reservationCommand,
            randomUUID(),
            originalFingerprint,
            randomUUID(),
            originalApproval,
          );
        },
        LOCATION,
      ),
    );
    expect(await balance(f.itemId)).toEqual({ on_hand: 100, reserved: 125, available: -25 });

    const changedTender = {
      ...prepared.dto,
      tenderDrafts: prepared.dto.tenderDrafts.map((tender) => ({ ...tender, id: randomUUID() })),
    };
    const preview = await scoped(() =>
      checkout.checkout(till, MERCHANT, {
        ...changedTender,
        commandId: randomUUID(),
        idempotencyKey: randomUUID(),
        totalsFingerprint: null,
      }),
    );
    expect(preview.status).toBe('confirmation_required');
    if (preview.status !== 'confirmation_required')
      throw new Error('The changed tender has no confirmation.');
    const currentFingerprint = preview.confirmation.fingerprint;
    expect(currentFingerprint).not.toBe(originalFingerprint);
    expect(preview.confirmation.cartVersion).toBe(prepared.cart.version);
    const currentApproval = await approve('inventory.negative_stock.override', currentFingerprint);
    const current = {
      ...changedTender,
      totalsFingerprint: currentFingerprint,
      approvalIds: [currentApproval],
      commandId: randomUUID(),
      idempotencyKey: randomUUID(),
    };
    const completed = await sale(current);
    expect(await commit(current)).toEqual(completed);
    expect(await balance(f.itemId)).toEqual({ on_hand: -25, reserved: 0, available: -25 });
    expect(
      (
        await pg.query(
          `SELECT command_id::text,command_fingerprint,status
      FROM merchant.inventory_reservation WHERE id=$1`,
          [reservation.id],
        )
      ).rows,
    ).toEqual([
      {
        command_id: reservationCommand,
        command_fingerprint: originalFingerprint,
        status: 'committed',
      },
    ]);
    expect(
      (
        await pg.query(
          `SELECT mapping_id::text,recipe_id::text,recipe_version,required_quantity::integer
      FROM merchant.inventory_reservation_line WHERE reservation_id=$1`,
          [reservation.id],
        )
      ).rows,
    ).toEqual([
      {
        mapping_id: f.mapping.id,
        recipe_id: f.recipeId,
        recipe_version: 1,
        required_quantity: 125,
      },
    ]);
    expect((await ledger(f.itemId, 'reservation_created')).map((row) => row.quantity)).toEqual([
      125,
    ]);
    expect(await ledger(f.itemId, 'sale_committed')).toEqual([
      expect.objectContaining({
        quantity: 125,
        public_data: {
          mappingId: f.mapping.id,
          mappingVersion: 1,
          recipeId: f.recipeId,
          recipeVersion: 1,
          negativeStockApprovalId: currentApproval,
        },
      }),
    ]);
    expect(
      (
        await pg.query(
          `SELECT command_id::text,command_fingerprint
      FROM merchant.stock_ledger_entry WHERE inventory_item_id=$1 AND entry_type='sale_committed'`,
          [f.itemId],
        )
      ).rows,
    ).toEqual([
      {
        command_id: current.commandId,
        command_fingerprint: currentFingerprint,
      },
    ]);
    expect(
      (
        await pg.query(
          `SELECT consumed_by_command_id::text FROM runtime.elevation_grant WHERE id=$1`,
          [currentApproval],
        )
      ).rows,
    ).toEqual([{ consumed_by_command_id: current.commandId }]);
  });
});
