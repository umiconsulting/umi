import { afterEach, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { salesAnalysisQuery, salesRefreshInterval } from './sales-analysis-query.js';
const clients = [];
afterEach(() => {
  for (const client of clients) client.clear();
  clients.length = 0;
});
const identity = ['merchant', 'branch', 'user', ['sale.lifecycle'], null];
const query = {
  from: '2026-11-01',
  to: '2026-11-07',
  refundView: 'sale_result',
  basketUnit: 'ticket',
};
const client = () => {
  const result = new QueryClient();
  clients.push(result);
  return result;
};
describe('shared sales report cache', () => {
  it('reuses a fresh report between home and detail despite filter property order and empty groups', async () => {
    const cache = client();
    let calls = 0;
    const fetcher = async () => ({ total: ++calls });
    const home = salesAnalysisQuery(identity, query, fetcher);
    const detail = salesAnalysisQuery(
      identity,
      {
        groupA: '',
        basketUnit: 'ticket',
        to: query.to,
        refundView: 'sale_result',
        from: query.from,
      },
      fetcher,
    );
    expect(await cache.fetchQuery(home)).toEqual({ total: 1 });
    expect(await cache.fetchQuery(detail)).toEqual({ total: 1 });
    expect(calls).toBe(1);
  });
  it('separates users, merchants, permissions, branches and refund criteria', async () => {
    const cache = client();
    let calls = 0;
    const fetcher = async () => ++calls;
    for (const scope of [
      identity,
      ['other', ...identity.slice(1)],
      ['merchant', 'other', ...identity.slice(2)],
      ['merchant', 'branch', 'other', ...identity.slice(3)],
      ['merchant', 'branch', 'user', [], null],
    ])
      await cache.fetchQuery(salesAnalysisQuery(scope, query, fetcher));
    await cache.fetchQuery(
      salesAnalysisQuery(identity, { ...query, refundView: 'period_movements' }, fetcher),
    );
    expect(calls).toBe(6);
  });
  it('refreshes the same entry and forwards query cancellation to the request', async () => {
    const cache = client();
    let signal;
    let calls = 0;
    const options = salesAnalysisQuery(identity, query, async (_path, opts) => {
      signal = opts.signal;
      return ++calls;
    });
    await cache.fetchQuery(options);
    await cache.refetchQueries({ queryKey: options.queryKey });
    expect(calls).toBe(2);
    expect(cache.getQueryCache().getAll()).toHaveLength(1);
    expect(signal).toBeInstanceOf(AbortSignal);
  });
  it('expires at sixty seconds and schedules the next refresh from the actual cache age', () => {
    const options = salesAnalysisQuery(identity, query, async () => null);
    expect(options.staleTime).toBe(60000);
    expect(salesRefreshInterval({ state: { dataUpdatedAt: 10000 } }, 55000)).toBe(15000);
    expect(salesRefreshInterval({ state: { dataUpdatedAt: 10000 } }, 80000)).toBe(1000);
  });
});
