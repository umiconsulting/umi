import { afterEach, expect, it, vi } from 'vitest';
import { fetchFloorPlan, changeFloorPlan } from './data.jsx';

afterEach(() => vi.unstubAllGlobals());
it('uses explicit merchant and location scope for reads, saves, and publication', async () => {
  vi.stubGlobal('document', { cookie: '' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  );
  const merchantId = '11111111-1111-4111-8111-111111111111';
  const locationId = '22222222-2222-4222-8222-222222222222';
  const payload = { locationId, expectedVersion: 1, idempotencyKey: crypto.randomUUID() };
  await fetchFloorPlan(merchantId, locationId);
  await changeFloorPlan(merchantId, { ...payload, document: {} });
  await changeFloorPlan(merchantId, payload, true);
  const requests = fetch.mock.calls;
  const read = new URL(requests[0][0], 'http://localhost');
  expect(read.pathname).toBe(`/api/merchants/${merchantId}/floor-plan`);
  expect(read.searchParams.get('locationId')).toBe(locationId);
  expect(new URL(requests[1][0], 'http://localhost').pathname).toBe(read.pathname);
  expect(requests[1][1].method).toBe('PUT');
  expect(new URL(requests[2][0], 'http://localhost').pathname).toBe(`${read.pathname}/publish`);
  expect(requests[2][1].method).toBe('POST');
  expect(JSON.parse(requests[2][1].body)).toEqual(payload);
});
