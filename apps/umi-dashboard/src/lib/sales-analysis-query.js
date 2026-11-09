import { routes } from '@umi/contract/routes';

const FRESH_MS = 60_000;

export function permissionFingerprint(permissions) {
  if (!Array.isArray(permissions)) return permissions ?? '';
  return [...new Set(permissions)].sort().join(',');
}

export function salesRefreshInterval(query, now = Date.now()) {
  // The summary is valid while the affinity capability is not. Do not poll it.
  if (query.state.data?.basketState?.state === 'unavailable') return false;
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

export function salesReportKeys(merchantId) {
  return {
    options: ['sales-analysis-options', merchantId],
    reports: ['sales-analysis', merchantId],
  };
}

export async function invalidateSalesReports(client, merchantId) {
  const keys = salesReportKeys(merchantId);
  await Promise.all([
    client.cancelQueries({ queryKey: keys.options }),
    client.cancelQueries({ queryKey: keys.reports }),
  ]);
  await client.invalidateQueries({ queryKey: keys.options });
  await client.invalidateQueries({ queryKey: keys.reports });
}

export function clearSalesReports(client, merchantId) {
  const keys = salesReportKeys(merchantId);
  client.removeQueries({ queryKey: keys.options });
  client.removeQueries({ queryKey: keys.reports });
}

export function salesAnalysisQuery(identity, query, fetcher) {
  const [merchantId, locationId, userId, permissions, membershipLocationId] = identity;
  const params = new URLSearchParams(
    Object.entries(query ?? {})
      .filter(([, value]) => value != null && value !== '')
      .sort(([a], [b]) => a.localeCompare(b)),
  ).toString();
  return {
    ...salesCachePolicy,
    queryKey: [
      'sales-analysis',
      merchantId,
      locationId,
      userId,
      permissionFingerprint(permissions),
      membershipLocationId,
      params,
    ],
    queryFn: ({ signal }) =>
      fetcher(`${routes.salesAnalysis.read(merchantId)}?${params}`, { signal }),
  };
}
