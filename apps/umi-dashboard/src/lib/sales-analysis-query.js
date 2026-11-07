import { routes } from '@umi/contract/routes';

const FRESH_MS = 60_000;

export function salesRefreshInterval(query, now = Date.now()) {
  const lastAttempt = Math.max(query.state.dataUpdatedAt, query.state.errorUpdatedAt || 0);
  return Math.max(1000, FRESH_MS - (now - lastAttempt));
}

export const salesCachePolicy = {
  staleTime: FRESH_MS,
  gcTime: 5 * 60_000,
  refetchOnWindowFocus: true,
  refetchInterval: salesRefreshInterval,
  retry: false,
};

export async function invalidateSalesReports(client, merchantId) {
  const options = { queryKey: ['sales-analysis-options', merchantId] };
  const reports = { queryKey: ['sales-analysis', merchantId] };
  await Promise.all([client.cancelQueries(options), client.cancelQueries(reports)]);
  await client.invalidateQueries(options);
  await client.invalidateQueries(reports);
}

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
