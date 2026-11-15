import { routes } from '@umi/contract/routes';

const FRESH_MS = 60_000;
export const SALES_AUTO_REFRESH_MS = 59_000;

export function permissionFingerprint(permissions) {
  if (!Array.isArray(permissions)) return permissions ?? '';
  return [...new Set(permissions)].sort().join(',');
}

const isStale = (query) => Date.now() - (query.state.dataUpdatedAt || 0) >= FRESH_MS;

export function salesRefreshInterval(query, now = Date.now()) {
  // The summary is valid while the affinity capability is not. Do not poll it.
  if (query.state.data?.basketState?.state === 'unavailable') return false;
  const lastAttempt = Math.max(query.state.dataUpdatedAt, query.state.errorUpdatedAt || 0);
  return Math.max(1000, FRESH_MS - (now - lastAttempt));
}

export const salesCachePolicy = {
  staleTime: FRESH_MS,
  gcTime: 5 * 60_000,
  // A focus or mount refetch is useful only after the report is stale. The page
  // owns the auto-refresh cadence so a manual refresh does not move the timer.
  refetchOnWindowFocus: isStale,
  refetchOnMount: isStale,
  refetchInterval: false,
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

export function salesDenied(result) {
  // A final 401 is a refused session. A transient refresh becomes 503 in _apiFetch.
  return Boolean(
    result.error &&
    (result.error.status === 401 ||
      result.error.status === 403 ||
      result.error.code === 'PERMISSION_DENIED'),
  );
}

export function shouldClearDeniedSales(result, lastSuccessAt, clearedSuccessAt) {
  return salesDenied(result) && clearedSuccessAt !== lastSuccessAt;
}

export function salesResult(result) {
  const denied = salesDenied(result);
  return {
    data: denied ? null : result.data,
    loading: denied ? false : !result.data && result.isFetching,
    refreshing: denied ? false : Boolean(result.data && result.isFetching),
    error: denied ? result.error?.message : result.data ? undefined : result.error?.message,
    errorCode: denied ? 'PERMISSION_DENIED' : result.error?.code,
    refreshError: denied ? false : Boolean(result.data && result.error),
    refreshErrorStatus: denied ? null : (result.error?.status ?? null),
    dataUpdatedAt: denied ? 0 : result.dataUpdatedAt,
    refetch: result.refetch,
  };
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
