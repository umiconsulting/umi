import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DashboardOperationsService } from './dashboard-operations.service';

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'owner@example.test',
  sessionId: '00000000-0000-4000-8000-000000000002',
  deviceId: null,
};
const access = {
  merchantId: '00000000-0000-4000-8000-000000000003',
  handle: null,
  name: 'Pilot',
  timezone: 'America/Mazatlan',
  membershipId: '00000000-0000-4000-8000-000000000004',
  role: 'owner',
  roles: ['owner'],
  permissions: ['merchant.manage', 'audit.read'],
  locationId: null,
};
const query = { domain: 'organization' as const, cursor: 0, limit: 20 };

// A completion provider stub. Default: returns null (the fail-safe path).
const stubLlm = (impl?: unknown) => ({ createCompletion: vi.fn(impl as never) }) as never;

describe('DashboardOperationsService', () => {
  it('returns exactly 20 permission-filtered domains', async () => {
    const repository = { list: vi.fn().mockResolvedValue([]) };
    const service = new DashboardOperationsService(repository as never, stubLlm());
    const result = await service.snapshot(user, access, query);
    expect(result.domains).toHaveLength(20);
    expect(result.domains.find((item) => item.domain === 'organization')?.available).toBe(true);
    expect(result.domains.find((item) => item.domain === 'inventory')?.available).toBe(false);
  });

  it('denies an unavailable deep link', async () => {
    const service = new DashboardOperationsService({ list: vi.fn() } as never, stubLlm());
    await expect(
      service.snapshot(user, access, { ...query, domain: 'inventory' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a location outside the membership assignment', async () => {
    const service = new DashboardOperationsService({ list: vi.fn() } as never, stubLlm());
    await expect(
      service.snapshot(
        user,
        { ...access, locationId: '00000000-0000-4000-8000-000000000005' },
        { ...query, locationId: '00000000-0000-4000-8000-000000000006' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('uses bounded cursor pagination', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({ id: String(index) }));
    const service = new DashboardOperationsService(
      { list: vi.fn().mockResolvedValue(rows) } as never,
      stubLlm(),
    );
    const result = await service.snapshot(user, access, query);
    expect(result.items).toHaveLength(20);
    expect(result.page).toMatchObject({ hasMore: true, nextCursor: '20' });
  });
});

// The AI sales narrative. Gated by the `sales` permission; grounded only in the summary;
// cached; and fail-safe (a null narrative, never a throw, when the model is skipped/fails).
describe('DashboardOperationsService.salesInsight', () => {
  const salesAccess = { ...access, permissions: ['sale.lifecycle'] };
  const insightQuery = { range: 'today' as const };
  const summary = (orders: number) => ({
    merchantId: access.merchantId,
    locationId: null,
    range: 'today' as const,
    currency: 'MXN',
    bucket: 'hour' as const,
    totals: {
      netSalesMinorUnits: 48200,
      orders,
      averageTicketMinorUnits: orders ? Math.round(48200 / orders) : 0,
      itemsSold: 12,
      discountMinorUnits: 0,
      tipsMinorUnits: 0,
      priorNetSalesMinorUnits: 43000,
    },
    paymentMix: [{ method: 'cash' as const, amountMinorUnits: 48200 }],
    productMix: [
      {
        productId: null,
        productName: 'Americano',
        category: 'Cafe',
        units: 31,
        netMinorUnits: 168100,
      },
    ],
    byOperator: [],
    byHour: [],
    series: [],
    capturedAt: new Date().toISOString(),
  });

  it('returns a null narrative and skips the model when there are no sales', async () => {
    const llm = stubLlm(() => ({ text: 'x', inputTokens: 1, outputTokens: 1 }));
    const service = new DashboardOperationsService(
      { salesSummary: vi.fn().mockResolvedValue(summary(0)) } as never,
      llm,
    );
    const result = await service.salesInsight(user, salesAccess, insightQuery);
    expect(result).toMatchObject({ narrative: null, generated: false });
    expect(
      (llm as { createCompletion: ReturnType<typeof vi.fn> }).createCompletion,
    ).not.toHaveBeenCalled();
  });

  it('generates a narrative once and serves the repeat from cache', async () => {
    const llm = stubLlm(() => ({
      text: '  Vendiste $482 hoy, 12% más. ',
      inputTokens: 5,
      outputTokens: 8,
    }));
    const service = new DashboardOperationsService(
      { salesSummary: vi.fn().mockResolvedValue(summary(7)) } as never,
      llm,
    );
    const first = await service.salesInsight(user, salesAccess, insightQuery);
    expect(first).toMatchObject({ narrative: 'Vendiste $482 hoy, 12% más.', generated: true });
    const second = await service.salesInsight(user, salesAccess, insightQuery);
    expect(second).toMatchObject({ narrative: 'Vendiste $482 hoy, 12% más.', generated: false });
    expect(
      (llm as { createCompletion: ReturnType<typeof vi.fn> }).createCompletion,
    ).toHaveBeenCalledTimes(1);
  });

  it('is fail-safe: a model error yields a null narrative, not a throw', async () => {
    const llm = stubLlm(() => {
      throw new Error('boom');
    });
    const service = new DashboardOperationsService(
      { salesSummary: vi.fn().mockResolvedValue(summary(7)) } as never,
      llm,
    );
    const result = await service.salesInsight(user, salesAccess, insightQuery);
    expect(result).toMatchObject({ narrative: null, generated: false });
  });

  it('denies without the sales permission', async () => {
    const service = new DashboardOperationsService({ salesSummary: vi.fn() } as never, stubLlm());
    await expect(service.salesInsight(user, access, insightQuery)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
