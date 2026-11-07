import { routes } from '@umi/contract/routes';

const FRESH_MS = 60_000;

export function salesRefreshInterval(query, now = Date.now()) {
  return Math.max(1000, FRESH_MS - (now - query.state.dataUpdatedAt));
}

export const salesCachePolicy = {
  staleTime: FRESH_MS,
  gcTime: 5 * 60_000,
  refetchOnWindowFocus: true,
  refetchInterval: salesRefreshInterval,
  retry: false,
};

export function salesAnalysisQuery(identity, query, fetcher) {
  const params = new URLSearchParams(
    Object.entries(query ?? {})
      .filter(([, value]) => value != null && value !== '')
      .sort(([a], [b]) => a.localeCompare(b)),
  ).toString();
  return {
    ...salesCachePolicy,
    queryKey: ['sales-analysis', ...identity, params],
    queryFn: ({ signal }) =>
      fetcher(`${routes.salesAnalysis.read(identity[0])}?${params}`, { signal }),
  };
}
