import type { MetricsRange } from '@umi/contract';

/** A business-date window and the equally sized window before it. */
export interface PeriodWindow {
  readonly start: string;
  readonly end: string;
  readonly priorStart: string;
  readonly priorEnd: string;
  readonly bucket: 'day' | 'hour';
}

/** Shift an ISO date by whole days in UTC, as the current sales summary does. */
export function shiftDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The window the range names. `asOf` is an internal replay hook for tests: the
 * route never sends it, so a request always uses the merchant's current day.
 */
export function periodWindow(range: MetricsRange, asOf: string): PeriodWindow {
  if (range === 'today') {
    const prior = shiftDate(asOf, -1);
    return { start: asOf, end: asOf, priorStart: prior, priorEnd: prior, bucket: 'hour' };
  }
  if (range === 'yesterday') {
    const day = shiftDate(asOf, -1);
    const prior = shiftDate(asOf, -2);
    return { start: day, end: day, priorStart: prior, priorEnd: prior, bucket: 'hour' };
  }
  if (range === 'last_7_days')
    return {
      start: shiftDate(asOf, -6),
      end: asOf,
      priorStart: shiftDate(asOf, -13),
      priorEnd: shiftDate(asOf, -7),
      bucket: 'day',
    };
  return {
    start: shiftDate(asOf, -29),
    end: asOf,
    priorStart: shiftDate(asOf, -59),
    priorEnd: shiftDate(asOf, -30),
    bucket: 'day',
  };
}

/** The current average ticket rule: an explicit 0 when there is no ticket. */
export function averageTicket(netSales: number, orders: number): number {
  return orders ? Math.round(netSales / orders) : 0;
}

/**
 * Units per ticket at 4 decimals, half-up. The integer form avoids the binary
 * drift of `Math.round((items / orders) * 10000)`.
 */
export function unitsPerTicket(orders: number, items: number): number | null {
  if (orders === 0) return null;
  if (items === 0) return 0;
  return Math.floor((items * 20000 + orders) / (2 * orders)) / 10000;
}

/** The cap on the number of distinct values of each request dimension. */
export const DIMENSION_CAPS = {
  day: 31,
  hour: 24,
  channel: 8,
  operator: 100,
  category: 100,
  product: 200,
} as const;

/**
 * The largest row set the request can legally return. A cap limits one
 * dimension's cardinality, so two dimensions allow at most the product of their
 * caps. The caller's `limit` cuts below that ceiling.
 */
export function dimensionRowCeiling(dimensions: readonly (keyof typeof DIMENSION_CAPS)[]): number {
  if (dimensions.length === 0) return 1;
  return dimensions.reduce((product, dimension) => product * DIMENSION_CAPS[dimension], 1);
}
