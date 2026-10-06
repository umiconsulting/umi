/**
 * Time-range plumbing for the admin analytics screen. The API and the page must
 * agree on which ranges exist — this module is that agreement.
 */

export const ANALYTICS_RANGES = [7, 30, 90, 365] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

/** Parse the `?days=` query param; anything unrecognized falls back to 30. */
export function resolveRangeDays(param: string | null): AnalyticsRange {
  const n = Number(param);
  return (ANALYTICS_RANGES as readonly number[]).includes(n) ? (n as AnalyticsRange) : 30;
}

/**
 * Squash a daily series into at most `maxBars` bars for the trend chart —
 * 365 one-pixel bars render as noise. Buckets sum their days, so the chart's
 * total always equals the real visit count; the last bucket may be partial.
 */
export function bucketTrend(values: number[], maxBars: number): number[] {
  if (values.length <= maxBars) return values;
  const size = Math.ceil(values.length / maxBars);
  const out: number[] = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size).reduce((s, v) => s + v, 0));
  }
  return out;
}
