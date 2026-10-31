import { MetricsService } from '../../shared/operations/metrics.service';
import { createHash, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProductionPreview, ProductionResult, UnitOfMeasure } from '@umi/contract';
import type { z } from 'zod';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
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
import { InventoryAuthoringRepository } from '../inventory-authoring/inventory-authoring.repository';
import { InventoryAuthoringService } from '../inventory-authoring/inventory-authoring.service';

type ProductionResponse = z.infer<typeof ProductionResult>;

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

describe('exact inventory preparation through administrative commands', () => {
  let pg: PgService;
  let authoring: InventoryAuthoringService;
  let inventory: PosInventoryService;
  let commands: AdministrativeCommandExecutionService;
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
  });

  afterAll(async () => {
    await pg?.onModuleDestroy?.();
  });

  const quantity = (value: number, unit: UnitOfMeasure = 'unit', scale = 0) => ({
    value,
    scale,
    unit,
  });
  const fixture = async (
    options: {
      flour?: number;
      outputScale?: number;
      ingredientAmount?: number;
      flourReferencePrefix?: string;
    } = {},
  ) => {
    const flour = randomUUID();
    const output = randomUUID();
    const recipe = randomUUID();
    for (const [id, itemType, baseUnit, quantityScale] of [
      [flour, 'ingredient', 'gram', 0],
      [output, 'composite_component', 'unit', options.outputScale ?? 0],
    ] as const) {
      await send('inventory.item.create', {
        targetAggregateId: id,
        parameters: {
          publicReference: `${id === flour ? (options.flourReferencePrefix ?? 'PREP') : 'PREP'}-${id}`,
          displayName: id === flour ? 'Flour' : 'Prepared food',
          itemType,
          baseUnit,
          quantityScale,
          trackingPolicy: 'tracked',
          negativeStockPolicy: 'block',
          initialUnitCostMinor: 2,
        },
      });
    }
    await send('inventory.recipe.create', {
      targetAggregateId: recipe,
      parameters: {
        targetKind: 'item',
        targetItemId: output,
        yieldQuantity: quantity(10),
        components: [
          { inventoryItemId: flour, quantity: quantity(options.ingredientAmount ?? 1000, 'gram') },
        ],
      },
    });
    const today = await inventory.currentBusinessDate(MERCHANT);
    await pg.runWithMerchant(
      MERCHANT,
      USER,
      async (client) => {
        await client.query(
          `SELECT merchant.append_stock_ledger(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid,'opening_balance',$5,$6::uuid,$6::uuid,
        repeat('a',64),'pos_sale',$7::uuid,$8::uuid,$9::uuid,1,$10::date,
        'preparation-fixture',null,null,null,null,'{}'::jsonb,null)`,
          [
            MERCHANT,
            LOCATION,
            STOCK_ROOM,
            flour,
            options.flour ?? 10000,
            randomUUID(),
            randomUUID(),
            USER,
            DEVICE,
            today,
          ],
        );
      },
      LOCATION,
    );
    return { flour, output, recipe };
  };
  const preview = (
    output: string,
    amount: ReturnType<typeof quantity>,
    inventoryLocationId = STOCK_ROOM,
  ) =>
    send('inventory.production.preview', {
      targetAggregateId: output,
      parameters: { inventoryLocationId, quantity: amount },
    }) as Promise<ProductionPreview>;
  const commitInput = (
    plan: ProductionPreview,
    overrides: Record<string, unknown> = {},
  ): CommandInput => ({
    targetAggregateId: plan.outputItemId,
    commandId: randomUUID(),
    idempotencyKey: randomUUID(),
    parameters: {
      inventoryLocationId: plan.inventoryLocationId,
      quantity: plan.plannedQuantity,
      plannedQuantity: plan.plannedQuantity,
      recipeFingerprint: plan.recipeFingerprint,
      ...overrides,
    },
  });
  const state = async () => ({
    balances: (
      await pg.query(
        `SELECT inventory_item_id,inventory_location_id,on_hand::text
      FROM merchant.stock_balance WHERE merchant_id=$1 ORDER BY inventory_item_id,inventory_location_id`,
        [MERCHANT],
      )
    ).rows,
    lots: (
      await pg.query(`SELECT id FROM merchant.stock_lot WHERE merchant_id=$1 ORDER BY id`, [
        MERCHANT,
      ])
    ).rows,
    ledger: (
      await pg.query(
        `SELECT id FROM merchant.stock_ledger_entry WHERE merchant_id=$1 ORDER BY id`,
        [MERCHANT],
      )
    ).rows,
  });
  const balance = async (item: string) =>
    Number(
      (
        await pg.query<{ onHand: string }>(
          `SELECT on_hand::text AS "onHand" FROM merchant.stock_balance WHERE merchant_id=$1
      AND inventory_location_id=$2 AND inventory_item_id=$3`,
          [MERCHANT, STOCK_ROOM, item],
        )
      ).rows[0]?.onHand ?? 0,
    );
  const rejectsCode = async (work: () => Promise<unknown>, code: string) => {
    await expect(work()).rejects.toMatchObject({ response: expect.objectContaining({ code }) });
  };

  it.each([5, 20])(
    'previews and commits %i units with exact stock and response-loss retry',
    async (amount) => {
      const { flour, output } = await fixture();
      const before = await state();
      const plan = await preview(output, quantity(amount));
      expect(plan.plannedQuantity).toEqual(quantity(amount));
      expect(plan.consumed[0].quantity).toEqual(quantity(amount * 100, 'gram'));
      expect(plan.recipeFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(await state()).toEqual(before);
      const beforeOutput = await balance(output);
      const beforeFlour = await balance(flour);
      const command = commitInput(plan);
      const result = (await send('inventory.production.produce', command)) as ProductionResponse;
      expect((await balance(output)) - beforeOutput).toBe(amount);
      expect(beforeFlour - (await balance(flour))).toBe(amount * 100);
      expect(result.declaredQuantity).toEqual(quantity(amount));
      expect(result.yieldLossQuantity.value).toBe(0);
      const committed = await state();
      expect(committed.lots.length - before.lots.length).toBe(1);
      expect(committed.ledger.length - before.ledger.length).toBe(2);
      expect(await send('inventory.production.produce', command)).toEqual(result);
      expect(await state()).toEqual(committed);
    },
  );

  it('supports fractional output and preserves the legacy recipe-yield shortfall', async () => {
    const { output } = await fixture({ outputScale: 1 });
    const plan = await preview(output, quantity(25, 'unit', 1));
    expect(plan.plannedQuantity).toEqual(quantity(25, 'unit', 1));
    expect(plan.consumed[0].quantity).toEqual(quantity(250, 'gram'));
    await send('inventory.production.produce', commitInput(plan));
    const legacy = (await send('inventory.production.produce', {
      targetAggregateId: output,
      parameters: { inventoryLocationId: STOCK_ROOM, quantity: quantity(8) },
    })) as ProductionResponse;
    expect(legacy.declaredQuantity).toEqual(quantity(100, 'unit', 1));
    expect(legacy.yieldLossQuantity).toEqual(quantity(20, 'unit', 1));
    expect(legacy.consumed[0].quantity).toEqual(quantity(1000, 'gram'));
    expect(legacy.totalCostMinor).toBe(1600);
  });

  it('normalizes output quantities and recipe yields across exact unit conversions', async () => {
    const { output, recipe, flour } = await fixture();
    await send('inventory.conversion.set', {
      targetAggregateId: output,
      parameters: {
        fromUnit: 'package',
        toUnit: 'unit',
        numerator: 10,
        denominator: 1,
        targetScale: 0,
        roundingPolicy: 'exact',
      },
    });
    const updated = (await send('inventory.recipe.update', {
      targetAggregateId: recipe,
      targetVersion: 1,
      parameters: {
        yieldQuantity: quantity(1, 'package'),
        components: [{ inventoryItemId: flour, quantity: quantity(1000, 'gram') }],
      },
    })) as { recipe: { id: string } };
    const plan = await preview(output, quantity(2, 'package'));
    expect(plan.recipeId).toBe(updated.recipe.id);
    expect(plan.plannedQuantity).toEqual(quantity(20));
    expect(plan.consumed[0].quantity).toEqual(quantity(2000, 'gram'));
    const result = (await send(
      'inventory.production.produce',
      commitInput(plan),
    )) as ProductionResponse;
    expect(result.consumed[0].quantity).toEqual(quantity(2000, 'gram'));
    expect(await balance(output)).toBe(20);
  });

  it('refuses root recipe changes after preview without stock or lot writes', async () => {
    const { output, recipe, flour } = await fixture();
    const plan = await preview(output, quantity(5));
    await send('inventory.recipe.update', {
      targetAggregateId: recipe,
      targetVersion: 1,
      parameters: {
        components: [{ inventoryItemId: flour, quantity: quantity(1200, 'gram') }],
      },
    });
    const before = await state();
    await rejectsCode(
      () => send('inventory.production.produce', commitInput(plan)),
      'INVENTORY_PREPARATION_CHANGED',
    );
    expect(await state()).toEqual(before);
  });

  it('aggregates nested ingredients and refuses changed nested consumption', async () => {
    const { output, recipe, flour } = await fixture();
    const nested = await fixture();
    const nestedUpdate = (await send('inventory.recipe.update', {
      targetAggregateId: nested.recipe,
      targetVersion: 1,
      parameters: {
        components: [{ inventoryItemId: flour, quantity: quantity(2000, 'gram') }],
      },
    })) as { recipe: { id: string } };
    await send('inventory.recipe.update', {
      targetAggregateId: recipe,
      targetVersion: 1,
      parameters: {
        components: [
          { inventoryItemId: nested.output, quantity: quantity(5) },
          { inventoryItemId: flour, quantity: quantity(1000, 'gram') },
        ],
      },
    });
    const plan = await preview(output, quantity(5));
    expect(plan.consumed).toHaveLength(1);
    expect(plan.consumed[0].quantity).toEqual(quantity(1000, 'gram'));
    await send('inventory.recipe.update', {
      targetAggregateId: nestedUpdate.recipe.id,
      targetVersion: 2,
      parameters: {
        components: [{ inventoryItemId: flour, quantity: quantity(3000, 'gram') }],
      },
    });
    const before = await state();
    await rejectsCode(
      () => send('inventory.production.produce', commitInput(plan)),
      'INVENTORY_PREPARATION_CHANGED',
    );
    expect(await state()).toEqual(before);
  });

  it('normalizes a nested recipe yield before it aggregates leaf consumption', async () => {
    const { output, recipe, flour } = await fixture();
    const nested = await fixture();
    await send('inventory.conversion.set', {
      targetAggregateId: nested.output,
      parameters: {
        fromUnit: 'package',
        toUnit: 'unit',
        numerator: 10,
        denominator: 1,
        targetScale: 0,
        roundingPolicy: 'exact',
      },
    });
    await send('inventory.recipe.update', {
      targetAggregateId: nested.recipe,
      targetVersion: 1,
      parameters: {
        yieldQuantity: quantity(1, 'package'),
        components: [{ inventoryItemId: flour, quantity: quantity(1000, 'gram') }],
      },
    });
    await send('inventory.recipe.update', {
      targetAggregateId: recipe,
      targetVersion: 1,
      parameters: {
        components: [
          { inventoryItemId: nested.output, quantity: quantity(5) },
          { inventoryItemId: flour, quantity: quantity(1000, 'gram') },
        ],
      },
    });
    const plan = await preview(output, quantity(5));
    expect(plan.consumed).toHaveLength(1);
    expect(plan.consumed[0].quantity).toEqual(quantity(750, 'gram'));
    const before = await balance(flour);
    await send('inventory.production.produce', commitInput(plan));
    expect(before - (await balance(flour))).toBe(750);
  });

  it('reads an exact plan when a nested recipe appears during the plan read', async () => {
    const { output, recipe, flour } = await fixture();
    const nestedOutput = randomUUID();
    await send('inventory.item.create', {
      targetAggregateId: nestedOutput,
      parameters: {
        publicReference: `NEW-${nestedOutput}`,
        displayName: 'New nested item',
        itemType: 'composite_component',
        baseUnit: 'unit',
        quantityScale: 0,
        trackingPolicy: 'tracked',
        negativeStockPolicy: 'block',
      },
    });
    await send('inventory.conversion.set', {
      targetAggregateId: nestedOutput,
      parameters: {
        fromUnit: 'package',
        toUnit: 'unit',
        numerator: 10,
        denominator: 1,
        targetScale: 0,
        roundingPolicy: 'exact',
      },
    });
    await send('inventory.recipe.update', {
      targetAggregateId: recipe,
      targetVersion: 1,
      parameters: {
        components: [
          { inventoryItemId: nestedOutput, quantity: quantity(5) },
          { inventoryItemId: flour, quantity: quantity(1000, 'gram') },
        ],
      },
    });
    let insertRecipe = true;
    const observedPg = Object.create(pg) as PgService;
    observedPg.runWithMerchant = (merchantId, userId, work, locationId) =>
      pg.runWithMerchant(
        merchantId,
        userId,
        (client) =>
          work(
            new Proxy(client, {
              get(target, key, receiver) {
                if (key !== 'query') return Reflect.get(target, key, receiver);
                return async (text: string, values?: unknown[]) => {
                  if (insertRecipe && text.includes('e.numerator::text AS numerator')) {
                    insertRecipe = false;
                    await send('inventory.recipe.create', {
                      targetAggregateId: randomUUID(),
                      parameters: {
                        targetKind: 'item',
                        targetItemId: nestedOutput,
                        yieldQuantity: quantity(1, 'package'),
                        components: [{ inventoryItemId: flour, quantity: quantity(1000, 'gram') }],
                      },
                    });
                  }
                  return target.query(text, values);
                };
              },
            }),
          ),
        locationId,
      );
    const plan = await new PosInventoryRepository(observedPg).productionPreview(
      USER,
      MERCHANT,
      {
        outputItemId: output,
        inventoryLocationId: STOCK_ROOM,
        locationId: LOCATION,
        quantity: quantity(5),
      },
      new Map(),
    );
    expect(plan.consumed[0].quantity).toEqual(quantity(750, 'gram'));
    const before = await balance(flour);
    await send('inventory.production.produce', commitInput(plan));
    expect(before - (await balance(flour))).toBe(750);
  });

  it('rolls back every ingredient and the lot when one ingredient has insufficient stock', async () => {
    const { output, recipe, flour } = await fixture({ flourReferencePrefix: 'A' });
    const scarce = await fixture({ flour: 1, flourReferencePrefix: 'Z' });
    await send('inventory.recipe.update', {
      targetAggregateId: recipe,
      targetVersion: 1,
      parameters: {
        components: [
          { inventoryItemId: flour, quantity: quantity(1000, 'gram') },
          { inventoryItemId: scarce.flour, quantity: quantity(1000, 'gram') },
        ],
      },
    });
    const plan = await preview(output, quantity(5));
    const before = await state();
    await rejectsCode(
      () => send('inventory.production.produce', commitInput(plan)),
      'NEGATIVE_STOCK_BLOCKED',
    );
    expect(await state()).toEqual(before);
  });

  it('refuses non-exact quantities, precision, units, and actual output above its explicit plan', async () => {
    const { output } = await fixture({ ingredientAmount: 1 });
    await rejectsCode(() => preview(output, quantity(5)), 'INVENTORY_QUANTITY_NOT_EXACT');
    await rejectsCode(
      () => preview(output, quantity(1, 'unit', 1)),
      'INVENTORY_QUANTITY_NOT_EXACT',
    );
    await rejectsCode(
      () => preview(output, quantity(10, 'gram')),
      'INVENTORY_UNIT_CONVERSION_REQUIRED',
    );
    await expect(preview(output, quantity(1, 'unit', 7))).rejects.toMatchObject({ status: 400 });
    const plan = await preview(output, quantity(10));
    const before = await state();
    await rejectsCode(
      () => send('inventory.production.produce', commitInput(plan, { quantity: quantity(20) })),
      'INVENTORY_PRODUCTION_QUANTITY_INVALID',
    );
    expect(await state()).toEqual(before);
  });

  it('requires exact conversion even when a conversion allows rounded quantities', async () => {
    const { output } = await fixture();
    await send('inventory.conversion.set', {
      targetAggregateId: output,
      parameters: {
        fromUnit: 'portion',
        toUnit: 'unit',
        numerator: 1,
        denominator: 2,
        targetScale: 0,
        roundingPolicy: 'ceiling',
      },
    });
    const before = await state();
    await rejectsCode(
      () => preview(output, quantity(1, 'portion')),
      'INVENTORY_QUANTITY_NOT_EXACT',
    );
    await rejectsCode(
      () =>
        send('inventory.production.produce', {
          targetAggregateId: output,
          parameters: {
            inventoryLocationId: STOCK_ROOM,
            quantity: quantity(1, 'portion'),
            plannedQuantity: quantity(1, 'portion'),
          },
        }),
      'INVENTORY_QUANTITY_NOT_EXACT',
    );
    expect(await state()).toEqual(before);
  });

  it('preserves stock approval policy and leaves balances and lots unchanged', async () => {
    const { output, flour } = await fixture({ flour: 1 });
    await send('inventory.item.update', {
      targetAggregateId: flour,
      targetVersion: 1,
      parameters: { negativeStockPolicy: 'manager_override' },
    });
    const plan = await preview(output, quantity(5));
    const before = await state();
    await rejectsCode(
      () => send('inventory.production.produce', commitInput(plan)),
      'NEGATIVE_STOCK_APPROVAL_REQUIRED',
    );
    expect(await state()).toEqual(before);
  });

  it('excludes costs from the recipe fingerprint and preserves optional plan fields', async () => {
    const { output, flour } = await fixture();
    const plan = await preview(output, quantity(5));
    await send('inventory.item.update', {
      targetAggregateId: flour,
      targetVersion: 1,
      parameters: { initialUnitCostMinor: 7 },
    });
    const current = await preview(output, quantity(5));
    expect(current.recipeFingerprint).toBe(plan.recipeFingerprint);
    const result = (await send(
      'inventory.production.produce',
      commitInput(plan, { recipeFingerprint: undefined }),
    )) as ProductionResponse;
    expect(result.declaredQuantity).toEqual(quantity(5));
    expect(result.totalCostMinor).toBe(3500);
  });

  it('treats null plan fields as legacy omission', async () => {
    const { output } = await fixture();
    const command = {
      targetAggregateId: output,
      parameters: {
        inventoryLocationId: STOCK_ROOM,
        quantity: quantity(8),
        plannedQuantity: null,
        recipeFingerprint: null,
      },
    };
    const result = (await send('inventory.production.produce', command)) as ProductionResponse;
    expect(result.declaredQuantity).toEqual(quantity(10));
    expect(result.producedQuantity).toEqual(quantity(8));
    expect(result.yieldLossQuantity).toEqual(quantity(2));
    expect(result.consumed[0].quantity).toEqual(quantity(1000, 'gram'));
  });

  it('requires permission and an authorized active stock location', async () => {
    const { output } = await fixture();
    const request = {
      operation: 'inventory.production.preview' as const,
      locationId: LOCATION,
      targetAggregateId: output,
      targetVersion: null,
      commandId: randomUUID(),
      idempotencyKey: randomUUID(),
      parameters: { inventoryLocationId: STOCK_ROOM, quantity: quantity(5) },
      approvalId: null,
    };
    await expect(
      scoped(() => commands.execute(user, { ...access, permissions: [] }, request)),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      scoped(() =>
        commands.execute(
          user,
          { ...access, permissions: [] },
          { ...request, operation: 'inventory.production.produce' },
        ),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      scoped(() => commands.execute(user, access, { ...request, locationId: null })),
    ).rejects.toMatchObject({ status: 403 });
    const foreignLocation = randomUUID();
    await pg.query(
      `INSERT INTO merchant.location(id,merchant_id,name) VALUES ($1,$2,'Other branch')`,
      [foreignLocation, MERCHANT],
    );
    const foreignStock = randomUUID();
    await pg.query(
      `INSERT INTO merchant.inventory_location(id,merchant_id,location_id,public_reference,display_name,location_type)
      VALUES ($1::uuid,$2::uuid,$3::uuid,$1::text,'Other stock','stock_room')`,
      [foreignStock, MERCHANT, foreignLocation],
    );
    const ownInactive = randomUUID();
    await pg.query(
      `INSERT INTO merchant.inventory_location(id,merchant_id,location_id,public_reference,display_name,location_type,active,archived_at)
      VALUES ($1::uuid,$2::uuid,$3::uuid,$1::text,'Archived stock','stock_room',false,now())`,
      [ownInactive, MERCHANT, LOCATION],
    );
    await rejectsCode(
      () => preview(output, quantity(5), ownInactive),
      'INVENTORY_LOCATION_INVALID',
    );
    await rejectsCode(
      () => preview(output, quantity(5), foreignStock),
      'INVENTORY_LOCATION_INVALID',
    );
    await rejectsCode(
      () => preview(output, quantity(5), randomUUID()),
      'INVENTORY_LOCATION_INVALID',
    );
    await pg.query(
      `UPDATE merchant.inventory_location SET active=false,archived_at=now() WHERE id=$1`,
      [foreignStock],
    );
    await rejectsCode(
      () => preview(output, quantity(5), foreignStock),
      'INVENTORY_LOCATION_INVALID',
    );
  });

  it('refuses archived output, retired recipes, and output from another tenant', async () => {
    const { output, recipe } = await fixture();
    const plan = await preview(output, quantity(5));
    const before = await state();
    await pg.query(
      `UPDATE merchant.inventory_recipe SET active=false,retired_at=now() WHERE id=$1`,
      [recipe],
    );
    await rejectsCode(() => preview(output, quantity(5)), 'INVENTORY_RECIPE_REQUIRED');
    await rejectsCode(
      () => send('inventory.production.produce', commitInput(plan)),
      'INVENTORY_RECIPE_REQUIRED',
    );
    await pg.query(
      `UPDATE merchant.inventory_item SET active=false,archived_at=now() WHERE id=$1`,
      [output],
    );
    await rejectsCode(() => preview(output, quantity(5)), 'INVENTORY_ITEM_ARCHIVED');
    await rejectsCode(
      () => send('inventory.production.produce', commitInput(plan)),
      'INVENTORY_ITEM_ARCHIVED',
    );
    expect(await state()).toEqual(before);
    await rejectsCode(() => preview(randomUUID(), quantity(5)), 'INVENTORY_ITEM_ARCHIVED');
    const otherMerchant = randomUUID();
    const otherItem = randomUUID();
    await pg.query(
      `INSERT INTO merchant.merchant(id,name,handle) VALUES ($1::uuid,'Foreign tenant',$1::text)`,
      [otherMerchant],
    );
    await pg.query(
      `INSERT INTO merchant.inventory_item(id,merchant_id,public_reference,display_name,item_type,base_unit,quantity_scale)
      VALUES ($1,$2,'FOREIGN','Foreign','composite_component','unit',0)`,
      [otherItem, otherMerchant],
    );
    await rejectsCode(() => preview(otherItem, quantity(5)), 'INVENTORY_ITEM_ARCHIVED');
  });
});
