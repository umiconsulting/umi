import { describe, expect, it, vi } from 'vitest';
import type { MetricsQueryInput } from '@umi/contract';
import { MetricsService } from './metrics.service';

const base: MetricsQueryInput = {
  metrics: ['net_sales'],
  dimensions: [],
  range: 'last_7_days',
};

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    if (response) return response;
    throw error;
  }
  throw new Error('expected a refusal');
}

const merchantId = '55555555-5555-4555-8555-000000000001';
const locationOne = '55555555-5555-4555-8555-000000000011';
const locationTwo = '55555555-5555-4555-8555-000000000012';

const response = {
  definitionVersion: '1.0.0',
  scope: {
    merchantId,
    locationId: null,
    currency: 'MXN',
    timezone: 'America/Mexico_City',
    attribution: { category: 'current' },
  },
  period: {
    range: 'last_7_days',
    start: '2026-11-09',
    end: '2026-11-15',
    bucket: 'day',
    comparison: { start: '2026-11-02', end: '2026-11-08' },
  },
  coverage: {
    sources: ['pos_committed_sale', 'receipt_snapshot'],
    committedOnly: true,
    refundsIncluded: false,
  },
  freshness: { capturedAt: '2026-11-16T01:30:00.000Z' },
  truncated: false,
  totals: { values: { net_sales: 0 } },
};

function make() {
  const read = vi.fn().mockResolvedValue(response);
  const service = new MetricsService({ read } as never);
  return { service, read };
}

const user = { id: 'user-1', email: null, sessionId: 'session-1', deviceId: null };
const access = {
  merchantId,
  handle: null,
  name: 'Café',
  timezone: 'America/Mexico_City',
  membershipId: 'staff-1',
  role: 'owner',
  roles: ['owner'],
  permissions: ['sale.lifecycle'],
  locationId: null,
};

describe('MetricsService', () => {
  it('refuses a caller without the sales permission', async () => {
    const { service, read } = make();
    expect(await refusal(service.query(user, { ...access, permissions: [] }, base))).toEqual({
      code: 'PERMISSION_DENIED',
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('refuses a location outside the caller scope', async () => {
    const { service, read } = make();
    expect(
      await refusal(
        service.query(
          user,
          { ...access, locationId: 'location-1' },
          { ...base, locationId: 'location-2' },
        ),
      ),
    ).toEqual({ code: 'LOCATION_SCOPE_VIOLATION' });
    expect(read).not.toHaveBeenCalled();
  });

  it('passes the effective location: the assignment wins over the request', async () => {
    const { service, read } = make();
    await service.query(
      user,
      { ...access, locationId: locationOne },
      { ...base, locationId: undefined },
    );
    expect(read).toHaveBeenCalledWith(user.id, access.merchantId, locationOne, {
      ...base,
      locationId: undefined,
    });
  });

  it('passes a selected location when the caller has merchant scope', async () => {
    const { service, read } = make();
    await service.query(user, access, { ...base, locationId: locationTwo });
    expect(read).toHaveBeenCalledWith(
      user.id,
      access.merchantId,
      locationTwo,
      expect.objectContaining({ locationId: locationTwo }),
    );
  });
});
