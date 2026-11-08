import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { SalesAnalysisQuery } from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';
import type { AppConfig } from '../../shared/config/config.schema';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { seedSalesAnalysis } from '../../../test/integration/sales-analysis-fixture';
import { SalesAnalysisRepository } from './sales-analysis.repository';
import { SalesAnalysisService } from './sales-analysis.service';

describe('purchase analysis against PostgreSQL with RLS', () => {
  let pg: PgService, service: SalesAnalysisService, repository: SalesAnalysisRepository;
  let ids: Awaited<ReturnType<typeof seedSalesAnalysis>>, user: AuthUser, access: MerchantAccess;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL_APP || !process.env.DATABASE_URL_WORKER)
      throw new Error('Both database URLs are required');
    const config = { get: (key: string) => process.env[key] } as unknown as ConfigService<
      AppConfig,
      true
    >;
    pg = new PgService(config);
    await pg.onModuleInit();
    ids = await seedSalesAnalysis(pg.worker);
    repository = new SalesAnalysisRepository(pg);
    service = new SalesAnalysisService(repository);
    user = { id: ids.user, email: null, sessionId: ids.session, deviceId: null };
    access = {
      merchantId: ids.merchant,
      locationId: null,
      name: 'Test',
      handle: null,
      timezone: 'America/Mazatlan',
      membershipId: ids.staff,
      role: 'owner',
      roles: ['owner'],
      permissions: ['sale.lifecycle', 'merchant.manage', 'location.switch'],
    };
  });
  afterAll(async () => {
    await pg?.onModuleDestroy();
  });
  const query = (overrides = {}) =>
    SalesAnalysisQuery.parse({ from: '2026-11-02', to: '2026-11-02', ...overrides });

  it('uses frozen discounted money, original order hour and operational day across branches', async () => {
    const report = await service.read(user, access, query({ to: '2026-11-04' }));
    expect(report.totals).toMatchObject({
      tickets: 3,
      merchandiseMinorUnits: 36000,
      refundsMinorUnits: 9000,
      netMinorUnits: 27000,
      averageTicketMinorUnits: 9000,
      tipsMinorUnits: 1500,
      units: 3,
    });
    expect(report.byHour.map((row) => row.key)).toEqual(['03', '09', '10']);
    expect(report.byLocation.map((row) => row.tickets).sort()).toEqual([1, 2]);
    expect(report.byDay.map((row) => row.key)).toEqual(['2026-11-02', '2026-11-04']);
  });

  it('includes a later refund without its sale in period movements', async () => {
    const report = await service.read(
      user,
      access,
      query({ from: '2026-11-03', to: '2026-11-03', refundView: 'period_movements' }),
    );
    expect(report.totals).toMatchObject({
      tickets: 0,
      netMinorUnits: -9000,
      refundsMinorUnits: 9000,
      averageTicketMinorUnits: null,
      units: -1,
    });
    expect(report.byHour[0].key).toBe('12');
    expect(report.coverage.baskets).toBe(0);
    expect(report.coverage.refundedUnits).toBe(1);
  });

  it('reconciles category sales with frozen discounts, refunds and saved colors', async () => {
    const report = await service.read(user, access, query({ to: '2026-11-04' }));
    expect(report.byCategory).toEqual([
      expect.objectContaining({
        categoryId: ids.coffeeCategory,
        merchandiseMinorUnits: 18000,
        refundsMinorUnits: 0,
        netMinorUnits: 18000,
        color: expect.stringMatching(/^#[0-9a-fA-F]{6}$/),
      }),
      expect.objectContaining({
        categoryId: ids.breadCategory,
        merchandiseMinorUnits: 18000,
        refundsMinorUnits: 9000,
        netMinorUnits: 9000,
        color: expect.stringMatching(/^#[0-9a-fA-F]{6}$/),
      }),
    ]);
  });

  it('keeps category presence distinct from quantities and respects the selected refund view', async () => {
    const report = await service.read(
      user,
      access,
      query({
        to: '2026-11-04',
        groupA: `category:${ids.breadCategory}`,
        groupB: `category:${ids.coffeeCategory}`,
        refundView: 'period_movements',
      }),
    );
    expect(report.selectedGroups).toMatchObject({
      basketsWithBoth: 1,
      support: 1 / 3,
      confidenceAtoB: 1 / 2,
    });
    expect(report.pairs[0].baskets).toBe(1);
  });

  it('forces assigned location scope and denies attempts to widen it', async () => {
    const assigned = {
      ...access,
      locationId: ids.location,
      permissions: ['sale.lifecycle', 'merchant.manage'],
    };
    const report = await service.read(user, assigned, query());
    expect(report.locationId).toBe(ids.location);
    expect(report.totals.tickets).toBe(2);
    await expect(
      service.read(user, assigned, query({ locationId: ids.branch })),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.read(user, { ...access, permissions: [] }, query())).rejects.toMatchObject(
      { status: 403 },
    );
    await expect(
      service.read(user, { ...assigned, locationId: null }, query()),
    ).rejects.toMatchObject({ status: 403 });
    expect(() =>
      service.saveGroup(user, assigned, randomUUID(), {
        name: 'Denied',
        productIds: [ids.bread],
        expectedVersion: 0,
      }),
    ).toThrow();
  });

  it('persists reusable groups and refuses stale writes and products from another merchant', async () => {
    const id = randomUUID();
    const input = { name: 'Desayuno', productIds: [ids.bread, ids.coffee], expectedVersion: 0 };
    const saved = await service.saveGroup(user, access, id, input);
    expect(saved.version).toBe(1);
    expect(await service.saveGroup(user, access, id, input)).toMatchObject({ id, version: 1 });
    expect((await service.options(user, access)).groups).toContainEqual(
      expect.objectContaining({ id, name: 'Desayuno' }),
    );
    expect((await repository.options(ids.user, ids.neighbour, null)).groups).toEqual([]);
    const hidden = await pg.runWithMerchant(ids.neighbour, ids.user, (client) =>
      client.query('select id from merchant.sales_analysis_group where id = $1::uuid', [id]),
    );
    expect(hidden.rows).toEqual([]);
    await expect(
      pg.runWithMerchant(ids.merchant, ids.user, (client) =>
        client.query(
          'insert into merchant.sales_analysis_group_product(merchant_id, group_id, product_id) values ($1,$2,$3)',
          [ids.merchant, id, ids.foreignProduct],
        ),
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      service.saveGroup(user, access, id, { ...input, name: 'Stale' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.saveGroup(user, access, randomUUID(), { ...input, productIds: [ids.foreignProduct] }),
    ).rejects.toMatchObject({ status: 422 });
    const report = await service.read(
      user,
      access,
      query({
        groupA: `group:${id}`,
        groupB: `category:${ids.coffeeCategory}`,
        refundView: 'period_movements',
      }),
    );
    expect(report.selectedGroups.basketsWithBoth).toBe(1);
    await service.deleteGroup(user, access, id, saved.version);
    expect((await service.options(user, access)).groups).toEqual([]);
  });

  it('keeps the receipt date when an order crosses the operational cutoff before payment', async () => {
    const before = await service.read(
      user,
      access,
      query({ from: '2026-11-03', to: '2026-11-03' }),
    );
    const after = await service.read(
      user,
      access,
      query({ from: '2026-11-04', to: '2026-11-04', refundView: 'period_movements' }),
    );
    expect(before.totals.tickets).toBe(0);
    expect(after.totals.tickets).toBe(1);
    expect(after.byHour[0].key).toBe('03');
    expect(after.byDay[0].key).toBe('2026-11-04');
  });

  it('accepts one of two concurrent edits with the same group version', async () => {
    const id = randomUUID();
    await service.saveGroup(user, access, id, {
      name: 'Concurrent',
      productIds: [ids.bread],
      expectedVersion: 0,
    });
    const attempts = await Promise.allSettled(
      ['First', 'Second'].map((name) =>
        service.saveGroup(user, access, id, { name, productIds: [ids.bread], expectedVersion: 1 }),
      ),
    );
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const stored = (await service.options(user, access)).groups.find((group) => group.id === id)!;
    expect(stored.version).toBe(2);
    await service.deleteGroup(user, access, id, stored.version);
  });
});
