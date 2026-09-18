import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  InventoryAllergenList,
  InventoryAllergenQuery,
  InventoryAuthoringItemCreateRequest,
  InventoryAuthoringItemList,
  InventoryAuthoringItemQuery,
  InventoryRecipeCreateRequest,
  InventoryRecipeList,
  InventoryRecipeQuery,
} from '@umi/contract';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import type { PersistedDashboardAdministrativeCommandContext } from '../administrative-commands/administrative-command-context.service';
import type { AuditAppend, TransactionContext } from '../integrity/integrity.types';
import type { InventoryCostingService } from '../inventory-costing/inventory-costing.service';
import type {
  InventoryAuthoringRepository,
  RecipeExplosionRow,
  RecipeRow,
  StoredRecipe,
} from './inventory-authoring.repository';
import { InventoryAuthoringService } from './inventory-authoring.service';

/**
 * The unit half of the phase 1 authoring surface.
 *
 * WHAT IT CAN PROVE WITHOUT A DATABASE, and what it deliberately does not: the
 * version checks, the SQLSTATE translation and the unique keys are the DATABASE's
 * answers, and `inventory-authoring.integration.ts` is where those are asserted. Here
 * the subject is the layer above them — that a command reaches the repository with
 * the id the console sent, that the audit row is appended, that the three reads
 * answer shapes the contract accepts, and that a cursor this module did not write is
 * a caller error rather than a 500.
 */

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

const user: AuthUser = {
  id: id(1),
  email: null,
  sessionId: id(2),
  deviceId: null,
  commandContextType: 'dashboard_administrative',
};

const access: MerchantAccess = {
  merchantId: id(3),
  handle: null,
  name: 'Pilot',
  timezone: 'America/Mazatlan',
  membershipId: id(4),
  role: 'owner',
  roles: ['owner'],
  permissions: ['inventory.item.manage'],
  locationId: id(5),
};

const context: PersistedDashboardAdministrativeCommandContext = {
  type: 'dashboard_administrative',
  actorUserId: user.id,
  membershipId: id(4),
  merchantId: id(3),
  locationId: id(5),
  sessionId: id(2),
  permission: 'inventory.item.manage',
  operation: 'inventory.item.create',
  targetAggregateId: id(6),
  targetVersion: null,
  commandId: id(7),
  idempotencyKey: id(8),
  fingerprint: 'a'.repeat(64),
  approvalId: null,
  origin: 'dashboard',
  issuedAt: '2026-09-17T00:00:00.000Z',
  expiresAt: '2026-09-17T00:05:00.000Z',
  commandRecordId: id(9),
  correlationId: 'spec',
};

const item = {
  id: id(6),
  publicReference: 'HARINA',
  displayName: 'Harina de trigo',
  itemType: 'ingredient' as const,
  baseUnit: 'kilogram' as const,
  quantityScale: 3,
  trackingPolicy: 'tracked' as const,
  negativeStockPolicy: 'block' as const,
  lowStockThreshold: null,
  parQuantity: null,
  shelfLifeDays: null,
  active: true,
  version: 1,
  allergens: [],
  conversions: [],
  onHand: [],
};

/** A dummy operation context for a test whose assertions are above the database. */
function serviceFixture(
  options: { basis?: { inventoryItemId: string; unitCostMinor: number | null }[] } = {},
) {
  const audits: AuditAppend[] = [];
  const repository = {
    createItem: vi.fn().mockResolvedValue(item),
    listItems: vi.fn().mockResolvedValue({ rows: [item], hasMore: false }),
    listAllergens: vi.fn().mockResolvedValue({ rows: [], hasMore: false }),
    listRecipes: vi.fn().mockResolvedValue({ rows: [], hasMore: false }),
    readRecipeHeader: vi.fn().mockResolvedValue(null),
    explodeRecipe: vi.fn().mockResolvedValue([]),
    createRecipe: vi.fn(),
    updateRecipe: vi.fn(),
    retireRecipe: vi.fn(),
    // A version records the cost it computed when it was written (D3). The double
    // answers it so the service can call it unconditionally: a runtime probe for the
    // method would let a real wiring gap pass this suite.
    storeRecipeCost: vi.fn().mockResolvedValue(undefined),
  } as unknown as InventoryAuthoringRepository;
  // The cost basis is the costing module's, and this stub answers with the ONE field
  // the arithmetic reads. A null `unitCostMinor` is an item with no receipt.
  const costing = {
    costBasis: vi.fn(async () => ({
      items: (options.basis ?? []).map((row) => ({
        inventoryItemId: row.inventoryItemId,
        unitCostMinor: row.unitCostMinor,
      })),
      receiptLocations: [],
      asOf: '2026-09-17T00:00:00.000Z',
      correlationId: 'spec',
    })),
  } as unknown as InventoryCostingService;
  const integrity = {
    execute: vi.fn(
      async (
        input: { commandId: string },
        operation: (transaction: TransactionContext) => Promise<{ ok: true; value: unknown }>,
      ) => {
        const transaction = {
          client: {},
          commandId: input.commandId,
          correlationId: 'spec',
          claimVersion: vi.fn(),
          appendAudit: vi.fn(async (event: AuditAppend) => {
            audits.push(event);
            return id(10);
          }),
          appendFinancial: vi.fn(),
        } as unknown as TransactionContext;
        const outcome = await operation(transaction);
        return {
          commandId: input.commandId,
          status: 'succeeded',
          duplicate: false,
          retryable: false,
          result: outcome.value,
          failureCode: null,
          failureClass: null,
          correlationId: 'spec',
        };
      },
    ),
  };
  return {
    service: new InventoryAuthoringService(repository, integrity as never, costing),
    repository,
    costing,
    audits,
  };
}

describe('inventory authoring service', () => {
  it('creates the item under the id the command named, and appends its audit row', async () => {
    const { service, repository, audits } = serviceFixture();
    const dto = InventoryAuthoringItemCreateRequest.parse({
      commandId: id(7),
      idempotencyKey: id(8),
      publicReference: 'HARINA',
      displayName: 'Harina de trigo',
      itemType: 'ingredient',
      baseUnit: 'kilogram',
      quantityScale: 3,
      trackingPolicy: 'tracked',
      negativeStockPolicy: 'block',
    });

    const result = (await service.executeAdministrative(
      user,
      access,
      context,
      'inventory.item.create',
      dto,
    )) as { commandId: string; item: { id: string } };

    expect(result.commandId).toBe(id(7));
    expect(result.item.id).toBe(id(6));
    expect(repository.createItem).toHaveBeenCalledWith(expect.anything(), id(3), id(6), dto);
    expect(audits.map((event) => event.eventType)).toEqual(['inventory_item_created']);
  });

  it('refuses a cursor this module did not write, as a validation failure', async () => {
    const { service } = serviceFixture();
    await expect(
      service.items(access, InventoryAuthoringItemQuery.parse({ cursor: 'not-a-cursor' })),
    ).rejects.toBeInstanceOf(BadRequestException);

    // A cursor that IS this module's encoding, but whose key is not a uuid, would
    // reach SQL as an invalid `::uuid` cast — that is a caller error too.
    const forged = Buffer.from(JSON.stringify({ reference: 'HARINA', id: 'not-a-uuid' })).toString(
      'base64url',
    );
    await expect(
      service.items(access, InventoryAuthoringItemQuery.parse({ cursor: forged })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('answers the item list as a contract-shaped page', async () => {
    const { service } = serviceFixture();
    const page = InventoryAuthoringItemList.parse(
      await service.items(access, InventoryAuthoringItemQuery.parse({})),
    );
    expect(page.items).toHaveLength(1);
    expect(page.page).toEqual({ limit: 50, hasMore: false, nextCursor: null });
  });

  it('continues a page from the cursor it issued', async () => {
    const { service, repository } = serviceFixture();
    (repository.listItems as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [item],
      hasMore: true,
    });
    const first = await service.items(access, InventoryAuthoringItemQuery.parse({}));
    expect(first.page.hasMore).toBe(true);
    expect(first.page.nextCursor).toBeTruthy();

    await service.items(
      access,
      InventoryAuthoringItemQuery.parse({ cursor: first.page.nextCursor }),
    );
    expect(repository.listItems).toHaveBeenLastCalledWith(id(3), expect.anything(), {
      reference: 'HARINA',
      id: id(6),
    });
  });

  it('agrees with the response model about the page cap', async () => {
    const { service, repository } = serviceFixture();
    // THE QUERY AND THE RESPONSE NAME THE SAME CAP. `PageInfo` refuses a limit above
    // 100, so the query refuses one too. A request that cannot be answered must not be
    // accepted and then quietly narrowed: the caller would read `page.limit` and never
    // learn that it asked for something impossible.
    expect(InventoryAllergenQuery.safeParse({ limit: 200 }).success).toBe(false);
    const page = InventoryAllergenList.parse(
      await service.allergens(access, InventoryAllergenQuery.parse({ limit: 100 })),
    );
    expect(page.page.limit).toBe(100);
    expect(repository.listAllergens).toHaveBeenCalledWith(
      id(3),
      expect.objectContaining({ limit: 100 }),
      null,
    );
  });

  it('refuses an operation it does not implement', async () => {
    const { service } = serviceFixture();
    await expect(
      service.executeAdministrative(
        user,
        access,
        context,
        'inventory.item.overview' as never,
        {} as never,
      ),
    ).rejects.toThrow('unsupported_inventory_authoring_operation');
  });

  // ── Recipes ───────────────────────────────────────────────────────────────

  it('prices a plate from the raw items it reaches, and never from the prep it names', async () => {
    // prep is an item WITH its own recipe, and it DELIBERATELY has a basis here: if the
    // cost used it, the plate would be charged for the prep AND for the prep's beans.
    const prep = id(30);
    const beans = id(31);
    const stored = storedRecipe({
      explosion: [
        explosionRow(prep, '1', '1', 1, true),
        explosionRow(beans, '12', '1000', 2, false),
      ],
    });
    const { service, repository } = serviceFixture({
      basis: [
        { inventoryItemId: prep, unitCostMinor: 9999 },
        { inventoryItemId: beans, unitCostMinor: 11700 },
      ],
    });
    (repository.listRecipes as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [stored],
      hasMore: false,
    });

    const page = InventoryRecipeList.parse(
      await service.recipes(access, InventoryRecipeQuery.parse({})),
    );
    const recipe = page.recipes[0];
    // 12 / 1000 kg of beans at 11700 minor units per kg: 12 × 11700 / 1000 = 140.4,
    // rounded half-up ONCE at the end → 140. Price 4500 → margin 4360. Had the prep's
    // own 9999 been priced as well, the cost would be 10139.
    expect(recipe.costMinor).toBe(140);
    expect(recipe.marginMinor).toBe(4360);
  });

  it('leaves the cost null when a line does not divide at the item scale', async () => {
    const raw = id(32);
    const stored = storedRecipe({ explosion: [explosionRow(raw, '1', '3', 1, false)] });
    const { service, repository } = serviceFixture({
      basis: [{ inventoryItemId: raw, unitCostMinor: 1000 }],
    });
    (repository.listRecipes as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [stored],
      hasMore: false,
    });
    (repository.readRecipeHeader as ReturnType<typeof vi.fn>).mockResolvedValue(stored.recipe);
    (repository.explodeRecipe as ReturnType<typeof vi.fn>).mockResolvedValue(stored.explosion);

    const page = InventoryRecipeList.parse(
      await service.recipes(access, InventoryRecipeQuery.parse({})),
    );
    // A THIRD of a kilogram at scale 3 does not divide: 1000 / 3 leaves a remainder. The
    // quantity floors to 333, the line says it is not exact, and the recipe refuses to
    // print a cost built on a rounded quantity.
    expect(page.recipes[0].costMinor).toBeNull();
    expect(page.recipes[0].marginMinor).toBeNull();
    const exploded = await service.explosion(
      access,
      stored.recipe.id,
      InventoryRecipeQuery.parse({}),
    );
    expect(exploded.items[0]).toMatchObject({
      exact: false,
      quantity: { value: 333, scale: 3, unit: 'kilogram' },
      unitCostMinor: null,
      lineCostMinor: null,
    });
  });

  it('answers no cost — never zero — for an item no receipt has priced', async () => {
    const raw = id(33);
    const stored = storedRecipe({ explosion: [explosionRow(raw, '12', '1000', 1, false)] });
    const { service, repository } = serviceFixture({ basis: [] });
    (repository.listRecipes as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [stored],
      hasMore: false,
    });

    const page = InventoryRecipeList.parse(
      await service.recipes(access, InventoryRecipeQuery.parse({})),
    );
    expect(page.recipes[0].costMinor).toBeNull();
  });

  it('serves an explosion with names, paths and the deepest level it reached', async () => {
    const raw = id(34);
    const stored = storedRecipe({ explosion: [explosionRow(raw, '12', '1000', 3, false)] });
    const { service, repository } = serviceFixture({
      basis: [{ inventoryItemId: raw, unitCostMinor: 11700 }],
    });
    (repository.readRecipeHeader as ReturnType<typeof vi.fn>).mockResolvedValue(stored.recipe);
    (repository.explodeRecipe as ReturnType<typeof vi.fn>).mockResolvedValue(stored.explosion);

    const exploded = await service.explosion(
      access,
      stored.recipe.id,
      InventoryRecipeQuery.parse({}),
    );
    expect(exploded.depth).toBe(3);
    expect(exploded.items[0]).toMatchObject({
      inventoryItemId: raw,
      displayName: 'Harina de trigo',
      exact: true,
      unitCostMinor: 11700,
      lineCostMinor: 140,
      depth: 3,
      path: [raw],
      quantity: { value: 12, scale: 3, unit: 'kilogram' },
    });
  });

  it('refuses a recipe id that is not a uuid, as a validation failure', async () => {
    const { service } = serviceFixture();
    await expect(
      service.explosion(access, 'not-a-uuid', InventoryRecipeQuery.parse({})),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a page key this module did not write', async () => {
    const { service } = serviceFixture();
    const forged = Buffer.from(JSON.stringify({ createdAt: 'yesterday', id: id(20) })).toString(
      'base64url',
    );
    await expect(
      service.recipes(access, InventoryRecipeQuery.parse({ cursor: forged })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a recipe under the id the command named and appends its audit row', async () => {
    const stored = storedRecipe({ explosion: [explosionRow(id(31), '1', '1', 1, false)] });
    const { service, repository, audits } = serviceFixture({
      basis: [{ inventoryItemId: id(31), unitCostMinor: 100 }],
    });
    (repository.createRecipe as ReturnType<typeof vi.fn>).mockResolvedValue(stored);
    const dto = InventoryRecipeCreateRequest.parse({
      commandId: id(7),
      idempotencyKey: id(8),
      targetKind: 'product',
      productId: id(21),
      yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
      components: [
        {
          inventoryItemId: id(31),
          quantity: { value: 1, scale: 0, unit: 'unit' },
        },
      ],
    });

    const result = (await service.executeAdministrative(
      user,
      access,
      context,
      'inventory.recipe.create',
      dto,
    )) as { recipe: { id: string; version: number } };

    // The recipe id is the COMMAND's target aggregate, not a value in `parameters`.
    expect(repository.createRecipe).toHaveBeenCalledWith(expect.anything(), id(3), id(6), dto);
    expect(result.recipe).toMatchObject({ id: id(20), version: 1 });
    expect(audits.map((event) => event.eventType)).toEqual(['inventory_recipe_created']);
  });
});

// ── Recipe fixtures ─────────────────────────────────────────────────────────

function storedRecipe(overrides: Partial<StoredRecipe> = {}): StoredRecipe {
  const recipe: RecipeRow = {
    id: id(20),
    targetKind: 'product',
    productId: id(21),
    variantId: null,
    targetItemId: null,
    targetName: 'Latte',
    version: 1,
    yieldQuantity: '1',
    yieldScale: 0,
    yieldUnit: 'portion',
    shelfLifeDays: null,
    active: true,
    effectiveAt: '2026-09-17T00:00:00.000Z',
    retiredAt: null,
    createdAt: '2026-09-17 00:00:00.000001+00',
    priceMinor: '4500',
    usedInRecipeCount: '0',
  };
  return { recipe, components: [], explosion: [], ...overrides };
}

/** One row of the explosion, with the item's own name and scale. */
function explosionRow(
  inventoryItemId: string,
  numerator: string,
  denominator: string,
  depth: number,
  hasRecipe: boolean,
): RecipeExplosionRow {
  return {
    recipeId: id(20),
    inventoryItemId,
    numerator,
    denominator,
    depth,
    path: [inventoryItemId],
    hasRecipe,
    publicReference: 'HARINA',
    displayName: 'Harina de trigo',
    baseUnit: hasRecipe ? 'portion' : 'kilogram',
    quantityScale: hasRecipe ? 0 : 3,
  };
}
