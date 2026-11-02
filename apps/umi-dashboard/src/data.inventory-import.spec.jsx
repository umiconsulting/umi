import { afterEach, expect, it, vi } from 'vitest';
import * as data from './data.jsx';
afterEach(() => vi.unstubAllGlobals());
it('loads complete merchant references including archived article collisions', async () => {
  const seen = [];
  vi.stubGlobal('document', { cookie: '' });
  vi.stubGlobal('fetch', async (url) => {
    const parsed = new URL(url, 'http://localhost');
    seen.push(parsed);
    const field = parsed.pathname.endsWith('/items')
      ? 'items'
      : parsed.pathname.endsWith('/recipes')
        ? 'recipes'
        : 'targets';
    const second = parsed.searchParams.has('cursor');
    return {
      ok: true,
      json: async () => ({
        [field]: [{ id: `${field}-${second ? 2 : 1}` }],
        page: { hasMore: !second, nextCursor: second ? null : 'page/2' },
      }),
    };
  });
  const snapshot = await data.fetchInventoryImportSnapshot('merchant-a');
  expect(snapshot.merchantId).toBe('merchant-a');
  for (const field of ['items', 'recipes', 'targets']) expect(snapshot[field]).toHaveLength(2);
  expect(seen).toHaveLength(6);
  expect(seen.every((url) => url.pathname.startsWith('/api/merchants/merchant-a/'))).toBe(true);
  expect(
    seen
      .filter((url) => url.pathname.endsWith('/items'))
      .every(
        (url) =>
          url.searchParams.get('includeArchived') === 'true' &&
          url.searchParams.get('includeItemsWithoutCost') === 'true',
      ),
  ).toBe(true);
});
it('binds commands to the original merchant and persisted location and fixed null approval', async () => {
  vi.stubGlobal('document', { cookie: '' });
  vi.stubGlobal('window', { localStorage: { getItem: () => 'another-merchant-or-location' } });
  const requests = [];
  vi.stubGlobal('fetch', async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ item: { id: 'created', version: 1 } }) };
  });
  const options = {
    commandId: 'command',
    idempotencyKey: 'key',
    targetVersion: 2,
    parameters: { displayName: 'Changed' },
    locationId: 'wrong',
    approvalId: 'wrong',
  };
  expect(
    (
      await data.executeInventoryImportCommand(
        'original',
        'inventory.item.update',
        'target',
        options,
      )
    ).result.item.version,
  ).toBe(1);
  expect(requests[0].url).toContain('/merchants/original/administrative-commands');
  expect(requests[0].body).toEqual({
    operation: 'inventory.item.update',
    targetAggregateId: 'target',
    targetVersion: 2,
    commandId: 'command',
    idempotencyKey: 'key',
    parameters: { displayName: 'Changed' },
    locationId: 'wrong',
    approvalId: null,
  });
});
