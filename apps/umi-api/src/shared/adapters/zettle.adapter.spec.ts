import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ZettleAdapter } from './zettle.adapter';

function adapterWith(values: Record<string, unknown>): ZettleAdapter {
  const config = { get: (k: string) => values[k] } as unknown as ConfigService<
    Record<string, unknown>,
    true
  >;
  return new ZettleAdapter(config);
}

const WITH_KEY = { ZETTLE_API_KEY: 'zk' };

describe('ZettleAdapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('skips (returns null) without an API key and makes no call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await adapterWith({}).fetchProducts()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches the catalog with a bearer token on success', async () => {
    const products = [{ uuid: 'u1', name: 'Latte' }];
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => products,
    });
    vi.stubGlobal('fetch', fetchSpy);

    expect(await adapterWith(WITH_KEY).fetchProducts()).toEqual(products);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://products.izettle.com/organizations/self/products/v2',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer zk' }),
      }),
    );
  });

  it('throws on a non-ok response (so BullMQ retries, like the source)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'unavailable',
      }),
    );
    await expect(adapterWith(WITH_KEY).fetchProducts()).rejects.toThrow(/Zettle API error: 503/);
  });

  it('propagates a network error (retryable)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    await expect(adapterWith(WITH_KEY).fetchProducts()).rejects.toThrow('ECONNRESET');
  });
});
