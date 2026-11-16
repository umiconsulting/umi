import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { MetricsResponse } from '@umi/contract';
import { MetricsInsightService } from './metrics-insight.service';

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
  permissions: ['sale.lifecycle'],
  locationId: null,
};

const stubLlm = (impl?: unknown) => ({ createCompletion: vi.fn(impl as never) }) as never;
const stubUsage = () => ({ record: vi.fn().mockResolvedValue(undefined) }) as never;

function response(orders: number, prior = 43000): MetricsResponse {
  return {
    definitionVersion: '1.0.0',
    scope: {
      merchantId: access.merchantId,
      locationId: null,
      currency: 'MXN',
      timezone: 'America/Mazatlan',
      attribution: { category: 'current' },
    },
    period: {
      range: 'today',
      start: '2026-11-16',
      end: '2026-11-16',
      bucket: 'hour',
      comparison: { start: '2026-11-15', end: '2026-11-15' },
    },
    coverage: {
      sources: [
        'pos_committed_sale',
        'receipt_snapshot',
        'pos_tender_fact',
        'customer_value_tender_allocation',
        'pos_cart_line',
        'product',
        'product_category',
      ],
      committedOnly: true,
      refundsIncluded: false,
    },
    freshness: { capturedAt: '2026-11-16T04:00:00.000Z' },
    truncated: false,
    totals: {
      values: {
        net_sales: 48200,
        orders,
        average_ticket: orders ? Math.round(48200 / orders) : 0,
        tips: 0,
        discounts: 0,
        prior_net_sales: prior,
        payment_mix: {
          items: [{ method: 'cash', amountMinorUnits: 48200 }],
          truncated: false,
          limit: 8,
          totalItems: 1,
          total: { amountMinorUnits: 48200 },
        },
        product_mix: {
          items: [
            {
              productId: null,
              productName: 'Americano',
              category: 'Cafe',
              units: 31,
              merchandiseMinorUnits: 168100,
            },
          ],
          truncated: false,
          limit: 200,
          totalItems: 1,
          total: { units: 31, merchandiseMinorUnits: 168100 },
        },
      },
    },
  };
}

describe('MetricsInsightService', () => {
  it('returns a null narrative and skips the model when there are no sales', async () => {
    const llm = stubLlm(() => ({ text: 'x', inputTokens: 1, outputTokens: 1 }));
    const query = vi.fn().mockResolvedValue(response(0));
    const service = new MetricsInsightService({ query } as never, llm, stubUsage());
    const result = await service.insight(user, access, { range: 'today' });
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
    const query = vi.fn().mockResolvedValue(response(7));
    const usage = stubUsage();
    const service = new MetricsInsightService({ query } as never, llm, usage);
    const first = await service.insight(user, access, { range: 'today' });
    expect(first).toMatchObject({ narrative: 'Vendiste $482 hoy, 12% más.', generated: true });
    const second = await service.insight(user, access, { range: 'today' });
    expect(second).toMatchObject({ narrative: 'Vendiste $482 hoy, 12% más.', generated: false });
    expect(
      (llm as { createCompletion: ReturnType<typeof vi.fn> }).createCompletion,
    ).toHaveBeenCalledTimes(1);
    expect((usage as { record: ReturnType<typeof vi.fn> }).record).toHaveBeenCalledWith({
      merchantId: access.merchantId,
      kind: 'narrative',
      promptTokens: 5,
      completionTokens: 8,
    });
  });

  it('is fail-safe: a model error yields a null narrative, not a throw', async () => {
    const llm = stubLlm(() => {
      throw new Error('boom');
    });
    const service = new MetricsInsightService(
      { query: vi.fn().mockResolvedValue(response(7)) } as never,
      llm,
      stubUsage(),
    );
    const result = await service.insight(user, access, { range: 'today' });
    expect(result).toMatchObject({ narrative: null, generated: false });
  });

  it('does not catch a policy refusal from the metrics read', async () => {
    const service = new MetricsInsightService(
      {
        query: vi.fn().mockRejectedValue(new ForbiddenException({ code: 'PERMISSION_DENIED' })),
      } as never,
      stubLlm(),
      stubUsage(),
    );
    await expect(service.insight(user, access, { range: 'today' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
