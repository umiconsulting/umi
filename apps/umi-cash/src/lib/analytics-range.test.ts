import { describe, it, expect } from 'vitest';
import { resolveRangeDays, bucketTrend } from './analytics-range';

describe('resolveRangeDays', () => {
  it('accepts exactly the four supported ranges', () => {
    expect(resolveRangeDays('7')).toBe(7);
    expect(resolveRangeDays('30')).toBe(30);
    expect(resolveRangeDays('90')).toBe(90);
    expect(resolveRangeDays('365')).toBe(365);
  });

  it('falls back to 30 for anything else', () => {
    expect(resolveRangeDays(null)).toBe(30);
    expect(resolveRangeDays('')).toBe(30);
    expect(resolveRangeDays('12')).toBe(30);
    expect(resolveRangeDays('abc')).toBe(30);
    expect(resolveRangeDays('-7')).toBe(30);
  });
});

describe('bucketTrend', () => {
  it('returns daily values untouched when they fit', () => {
    const values = [1, 2, 3];
    expect(bucketTrend(values, 60)).toEqual(values);
  });

  it('groups long ranges into buckets without losing visits', () => {
    const values = Array.from({ length: 90 }, (_, i) => i % 3); // 90 days of 0,1,2...
    const bucketed = bucketTrend(values, 60);
    expect(bucketed.length).toBeLessThanOrEqual(60);
    const total = (a: number[]) => a.reduce((s, v) => s + v, 0);
    expect(total(bucketed)).toBe(total(values)); // no visit disappears in the chart
  });

  it('keeps a year of days under the bar budget', () => {
    const year = Array.from({ length: 365 }, () => 1);
    const bucketed = bucketTrend(year, 60);
    expect(bucketed.length).toBeLessThanOrEqual(60);
    expect(bucketed.reduce((s, v) => s + v, 0)).toBe(365);
  });
});
