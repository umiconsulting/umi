import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderLocationResolver } from './order-location.resolver';

const ROMA = { id: 'loc-roma', name: 'Roma' };
const CONDESA = { id: 'loc-condesa', name: 'Condesa' };

describe('OrderLocationResolver', () => {
  let merchants: { listActiveLocationsWorker: ReturnType<typeof vi.fn> };
  let conversations: { getSelectedLocationWorker: ReturnType<typeof vi.fn> };

  function build() {
    return new OrderLocationResolver(merchants as never, conversations as never);
  }
  const P = (over: Partial<{ channelLocationId: string | null }> = {}) => ({
    merchantId: 't1',
    conversationId: 'c1',
    channelLocationId: null,
    ...over,
  });

  beforeEach(() => {
    merchants = { listActiveLocationsWorker: vi.fn().mockResolvedValue([ROMA, CONDESA]) };
    conversations = { getSelectedLocationWorker: vi.fn().mockResolvedValue(null) };
  });

  it('none: merchant has no active location', async () => {
    merchants.listActiveLocationsWorker.mockResolvedValue([]);
    expect(await build().resolve(P())).toEqual({ kind: 'none' });
  });

  it('BySole: single-location merchant resolves to its one location without asking', async () => {
    merchants.listActiveLocationsWorker.mockResolvedValue([ROMA]);
    const r = await build().resolve(P());
    expect(r).toMatchObject({ kind: 'resolved', locationId: 'loc-roma', source: 'sole' });
  });

  it('ByChannel: a location-bound number wins over selection (even multi-location)', async () => {
    conversations.getSelectedLocationWorker.mockResolvedValue('loc-condesa');
    const r = await build().resolve(P({ channelLocationId: 'loc-roma' }));
    expect(r).toMatchObject({ kind: 'resolved', locationId: 'loc-roma', source: 'channel' });
    // A bound number is authoritative — the durable selection is not consulted.
    expect(conversations.getSelectedLocationWorker).not.toHaveBeenCalled();
  });

  it('ByChannel is ignored when the bound id is not an active location (stale binding)', async () => {
    const r = await build().resolve(P({ channelLocationId: 'loc-archived' }));
    expect(r.kind).toBe('needs_selection'); // falls through to ask
  });

  it('BySelection: multi-location with a valid prior choice resolves to it', async () => {
    conversations.getSelectedLocationWorker.mockResolvedValue('loc-condesa');
    const r = await build().resolve(P());
    expect(r).toMatchObject({ kind: 'resolved', locationId: 'loc-condesa', source: 'selection' });
  });

  it('NeedsSelection: multi-location with no choice returns the location list to ask', async () => {
    const r = await build().resolve(P());
    expect(r).toEqual({ kind: 'needs_selection', locations: [ROMA, CONDESA] });
  });

  it('NeedsSelection: a stale/invalid selection is not honored', async () => {
    conversations.getSelectedLocationWorker.mockResolvedValue('loc-deleted');
    const r = await build().resolve(P());
    expect(r.kind).toBe('needs_selection');
  });
});
