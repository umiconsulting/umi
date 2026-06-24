import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { VoyageAdapter } from './voyage.adapter';

function adapterWith(values: Record<string, unknown>): VoyageAdapter {
  const config = { get: (k: string) => values[k] } as unknown as ConfigService<
    Record<string, unknown>,
    true
  >;
  return new VoyageAdapter(config);
}

const WITH_KEY = { VOYAGE_API_KEY: 'k' };

describe('VoyageAdapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns null without an API key', async () => {
    expect(await adapterWith({}).generateEmbedding('hi')).toBeNull();
  });

  it('returns embeddings sorted by input index', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { index: 1, embedding: [0.2] },
            { index: 0, embedding: [0.1] },
          ],
        }),
      }),
    );
    expect(await adapterWith(WITH_KEY).generateEmbeddings(['a', 'b'])).toEqual([
      [0.1],
      [0.2],
    ]);
  });

  it('returns null on a 4xx without retrying', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 400, text: async () => 'bad' });
    vi.stubGlobal('fetch', fetchMock);

    expect(await adapterWith(WITH_KEY).generateEmbeddings(['a'])).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on a 5xx and then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'overloaded',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ index: 0, embedding: [0.5] }] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    expect(await adapterWith(WITH_KEY).generateEmbeddings(['a'])).toEqual([
      [0.5],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
