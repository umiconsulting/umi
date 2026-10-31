import { afterEach, expect, it, vi } from 'vitest';
import { fetchRecipeTargets } from './data.jsx';
afterEach(() => vi.unstubAllGlobals());
function serve(pages) {
  vi.stubGlobal('document', { cookie: '' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => pages.shift() })),
  );
}
it('loads all target pages and preserves unmapped variants and unknown prices', async () => {
  serve([
    {
      targets: [{ productId: 'a', variantId: null, priceMinor: 500 }],
      page: { hasMore: true, nextCursor: 'next/a' },
    },
    {
      targets: [{ productId: 'a', variantId: 'new-variant', priceMinor: null }],
      page: { hasMore: false, nextCursor: null },
    },
  ]);
  expect((await fetchRecipeTargets('merchant-a')).targets).toEqual([
    { productId: 'a', variantId: null, priceMinor: 500 },
    { productId: 'a', variantId: 'new-variant', priceMinor: null },
  ]);
  const urls = fetch.mock.calls.map(([url]) => new URL(url, 'http://localhost'));
  expect(urls[0].pathname).toBe('/api/merchants/merchant-a/recipe-targets');
  expect(urls[1].searchParams.get('cursor')).toBe('next/a');
});
it('fails visibly on repeated cursors instead of returning a partial picker', async () => {
  serve(
    Array.from({ length: 3 }, () => ({ targets: [], page: { hasMore: true, nextCursor: 'same' } })),
  );
  await expect(fetchRecipeTargets('merchant-a')).rejects.toThrow();
  expect(fetch.mock.calls.length).toBeLessThanOrEqual(3);
});
it('propagates a failed later page instead of hiding missing targets', async () => {
  vi.stubGlobal('document', { cookie: '' });
  let first = true;
  vi.stubGlobal('fetch', async () => {
    if (first) {
      first = false;
      return {
        ok: true,
        json: async () => ({ targets: [], page: { hasMore: true, nextCursor: 'next' } }),
      };
    }
    return {
      ok: false,
      status: 503,
      json: async () => ({ code: 'SERVICE_UNAVAILABLE', message: 'unavailable' }),
    };
  });
  await expect(fetchRecipeTargets('merchant-a')).rejects.toThrow('unavailable');
});
