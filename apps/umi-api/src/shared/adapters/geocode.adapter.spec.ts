import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeocodeAdapter } from './geocode.adapter';

/**
 * A geocode is a convenience. Every failure mode below must return null rather than
 * throw, because the operator can always type the coordinates themselves and a
 * lookup that 500s would stop them saving a branch that is otherwise complete.
 */
describe('GeocodeAdapter.lookup', () => {
  let adapter: GeocodeAdapter;
  const fetchMock = vi.fn();

  beforeEach(() => {
    adapter = new GeocodeAdapter();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  function respond(body: unknown, ok = true, status = 200) {
    fetchMock.mockResolvedValue({ ok, status, json: async () => body });
  }

  it('returns the first hit as numbers, not the strings Nominatim sends', async () => {
    respond([{ lat: '20.673600', lon: '-103.344000', display_name: 'Av. Chapultepec 1' }]);
    await expect(adapter.lookup('Av. Chapultepec 1')).resolves.toEqual({
      latitude: 20.6736,
      longitude: -103.344,
      formattedAddress: 'Av. Chapultepec 1',
    });
  });

  it('identifies itself and scopes the country, as the usage policy requires', async () => {
    respond([{ lat: '1', lon: '2', display_name: 'x' }]);
    await adapter.lookup('Av. Chapultepec 1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('countrycodes=mx');
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/UmiConsulting/);
    expect(init.signal).toBeDefined();
  });

  it('asks nothing at all for a query too short to mean anything', async () => {
    await expect(adapter.lookup('av')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['no match', [] as unknown],
    ['a hit with no coordinates', [{ display_name: 'somewhere' }]],
    ['a coordinate that is not a number', [{ lat: 'norte', lon: '-103.3' }]],
    ['a latitude off the planet', [{ lat: '120', lon: '-103.3' }]],
    ['a body that is not a list', { error: 'nope' }],
  ])('returns null for %s', async (_label, body) => {
    respond(body);
    await expect(adapter.lookup('Av. Chapultepec 1')).resolves.toBeNull();
  });

  it('returns null when Nominatim refuses, rather than raising', async () => {
    respond([], false, 429);
    await expect(adapter.lookup('Av. Chapultepec 1')).resolves.toBeNull();
  });

  it('returns null when the lookup times out, rather than raising', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    await expect(adapter.lookup('Av. Chapultepec 1')).resolves.toBeNull();
  });
});
