import { describe, expect, it, vi } from 'vitest';
import { InventoryPlanningService } from './inventory-planning.service';
import { shiftDate } from './inventory-planning-domain';
import { InventoryPlan } from '@umi/contract';
const merchantId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const productId = '33333333-3333-4333-8333-333333333333';
const mappingId = '44444444-4444-4444-8444-444444444444';
function setup(
  options: {
    noHistory?: boolean;
    incomplete?: boolean;
    inactiveIngredient?: boolean;
    noCost?: boolean;
    negative?: boolean;
    days?: number[];
  } = {},
) {
  const today = '2026-11-10';
  const sales = options.noHistory
    ? []
    : Array.from({ length: 63 }, (_, i) => ({
        productId,
        variantId: null,
        day: shiftDate(today, -i - 1),
        quantity: '2',
        trainingQuantity: '2',
        firstDay: '2026-08-01',
      }));
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('purchase_days'))
      return {
        rows: [
          {
            today,
            timezone: 'America/Mazatlan',
            purchaseDays: options.days ?? [4],
            emailOptIn: false,
          },
        ],
      };
    if (sql.includes('WITH lines')) return { rows: sales };
    if (sql.includes('recipe_sources'))
      return {
        rows: options.incomplete
          ? []
          : [{ mappingId, parentId: null, itemId, numerator: '3', denominator: '1' }],
      };
    if (sql.includes('AS tracked'))
      return {
        rows: options.inactiveIngredient ? [] : [{ itemId, tracked: true, hasRecipe: false }],
      };
    if (sql.includes('stock_balance'))
      return { rows: [{ itemId, available: options.negative ? '-1' : '1' }] };
    if (sql.includes('inventory_planning_delivery')) return { rows: [] };
    throw new Error('Unexpected query');
  });
  const pg = {
    runWithMerchant: vi.fn(
      async (_merchant: string, _user: string | null, fn: (client: unknown) => unknown) =>
        fn({ query }),
    ),
  };
  const repo = {
    readPlates: vi.fn(async () => ({
      mappings: [
        {
          mappingId,
          productId,
          variantId: null,
          productName: 'Coffee',
          productActive: true,
          mappingType: 'recipe',
        },
      ],
      components: options.incomplete
        ? []
        : [{ mappingId, inventoryItemId: itemId, quantity: '3', quantityScale: 0 }],
    })),
    items: vi.fn(async () => [
      {
        inventoryItemId: itemId,
        displayName: 'Beans',
        baseUnit: 'gram',
        quantityScale: 0,
        active: true,
        lowStockThreshold: '2',
      },
    ]),
  };
  const costing = {
    costBasis: vi.fn(async () => ({
      items: [{ inventoryItemId: itemId, unitCostMinor: options.noCost ? null : 10 }],
    })),
  };
  const config = { get: () => false };
  const service = new InventoryPlanningService(
    pg as never,
    repo as never,
    costing as never,
    config as never,
  );
  const access = { merchantId, locationId: null, permissions: ['location.switch'] };
  return { service, access, query, pg };
}
describe('purchase plan', () => {
  it('uses sales, recipe quantities, available stock and minimum with exact arithmetic', async () => {
    const { service, access, query } = setup();
    const plan = await service.plan(access as never, {});
    expect(InventoryPlan.parse(plan)).toMatchObject({
      complete: true,
      nextPurchaseDate: '2026-11-12',
      products: [{ expectedUnits: 4, validation: { mae: 0, baselineMae: 0 } }],
      items: [
        { available: 1, expectedConsumption: 12, suggestedQuantity: 13, estimatedCostMinor: 130 },
      ],
    });
    expect(query.mock.calls.every(([sql]) => !/INSERT|UPDATE|DELETE/.test(sql))).toBe(true);
  });
  it.each([{ noHistory: true }, { incomplete: true }, { days: [] }])(
    'withholds amounts when evidence is incomplete: %j',
    async (options) => {
      const { service, access } = setup(options);
      const plan = await service.plan(access as never, {});
      expect(plan.complete).toBe(false);
      expect(plan.items[0].suggestedQuantity).toBeNull();
      expect(plan.items[0].expectedConsumption).toBeNull();
    },
  );
  it('withholds the plan when a recipe references an inactive ingredient', async () => {
    const { service, access } = setup({ inactiveIngredient: true });
    const plan = await service.plan(access as never, {});
    expect(plan.complete).toBe(false);
    expect(plan.warnings).toContain('incomplete_recipes');
    expect(plan.products[0].mapped).toBe(false);
  });
  it('keeps negative balances and unknown cost', async () => {
    const { service, access } = setup({ negative: true, noCost: true });
    const plan = await service.plan(access as never, {});
    expect(plan.items[0]).toMatchObject({
      available: -1,
      suggestedQuantity: 15,
      estimatedCostMinor: null,
    });
  });
  it('refuses a different location before reading data', async () => {
    const { service, access, pg } = setup();
    await expect(
      service.plan({ ...access, permissions: [], locationId: 'a' } as never, { locationId: 'b' }),
    ).rejects.toThrow();
    expect(pg.runWithMerchant).not.toHaveBeenCalled();
  });
});
