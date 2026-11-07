import { afterEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import {
  salesAnalysisQuery,
  salesRefreshInterval,
  invalidateSalesReports,
} from './sales-analysis-query.js';
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
  it('invalidates reports and inactive group options across branch contexts after a group write', async () => {
    const cache = client();
    const keys = [
      ['sales-analysis-options', 'merchant', 'branch-a'],
      ['sales-analysis-options', 'merchant', 'branch-b'],
      ['sales-analysis', 'merchant', 'branch-a'],
    ];
    for (const key of keys) cache.setQueryData(key, { groups: ['removed'] });
    cache.setQueryData(['sales-analysis-options', 'other'], { groups: ['keep'] });
    await invalidateSalesReports(cache, 'merchant');
    for (const key of keys) expect(cache.getQueryState(key).isInvalidated).toBe(true);
    expect(cache.getQueryState(['sales-analysis-options', 'other']).isInvalidated).toBe(false);
  });
  it.each([
    ['sales-analysis', true],
    ['sales-analysis', false],
    ['sales-analysis-options', true],
    ['sales-analysis-options', false],
  ])('replaces an in-flight pre-write %s with cached data: %s', async (prefix, cached) => {
    const cache = client();
    let resolveOld;
    let calls = 0;
    const oldResult = new Promise((resolve) => {
      resolveOld = resolve;
    });
    const options = salesAnalysisQuery(identity, query, () =>
      ++calls === 1 ? oldResult : Promise.resolve({ revision: 'after' }),
    );
    options.queryKey[0] = prefix;
    if (cached) cache.setQueryData(options.queryKey, { revision: 'cached' });
    const observer = new QueryObserver(cache, options);
    const unsubscribe = observer.subscribe(() => {});
    const oldFetch = cache.refetchQueries({ queryKey: options.queryKey });
    const invalidation = invalidateSalesReports(cache, 'merchant');
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveOld({ revision: 'before' });
    await Promise.all([oldFetch, invalidation]);
    expect(cache.getQueryData(options.queryKey)).toEqual({ revision: 'after' });
    expect(calls).toBe(2);
    unsubscribe();
  });
  it('waits a full interval after a failed fetch instead of repeatedly polling an expired report', () => {
    expect(
      salesRefreshInterval({ state: { dataUpdatedAt: 10000, errorUpdatedAt: 80000 } }, 85000),
    ).toBe(55000);
    expect(
      salesRefreshInterval({ state: { dataUpdatedAt: 0, errorUpdatedAt: 80000 } }, 85000),
    ).toBe(55000);
  });
});
