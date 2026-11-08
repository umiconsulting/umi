import { describe, expect, it } from 'vitest';
import { allocateHexagons, categorySalesState } from './category-sales-model.js';
const row = (key, netMinorUnits) => ({ key, netMinorUnits });
describe('Category revenue mosaic', () => {
  it('distributes every cell without inflating small categories', () => {
    expect(allocateHexagons([row('a', 51), row('b', 28), row('c', 12), row('d', 9)], 100)).toEqual([
      51, 28, 12, 9,
    ]);
    expect(allocateHexagons([row('a', 9999), row('b', 1)], 100)).toEqual([100, 0]);
  });
  it('resolves equal remainders by stable category identity', () => {
    expect(allocateHexagons([row('b', 1), row('a', 1), row('c', 1)], 10)).toEqual([3, 4, 3]);
  });
  it('keeps negative refunds out of a positive share chart', () => {
    expect(categorySalesState([row('a', 200), row('b', -100)], 100)).toBe('signed');
    expect(allocateHexagons([row('a', 200), row('b', -100)], 100)).toEqual([]);
  });
  it('distinguishes unavailable data, zero revenue and a reconciled report', () => {
    expect(categorySalesState(undefined, 0)).toBe('unavailable');
    expect(categorySalesState([], 0)).toBe('empty');
    expect(categorySalesState([row('a', 50)], 100)).toBe('unavailable');
    expect(categorySalesState([row('a', 100)], 100)).toBe('ready');
  });
  it('does not lose cents near the supported money limit', () => {
    expect(allocateHexagons([row('a', Number.MAX_SAFE_INTEGER - 1), row('b', 1)], 200)).toEqual([
      200, 0,
    ]);
  });
});
