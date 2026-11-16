import { describe, expect, it } from 'vitest';
import {
  averageTicket,
  dimensionRowCeiling,
  periodWindow,
  shiftDate,
  unitsPerTicket,
} from './metrics.formulas';

describe('periodWindow', () => {
  it('uses one day and an hour bucket for today', () => {
    expect(periodWindow('today', '2026-11-15')).toEqual({
      start: '2026-11-15',
      end: '2026-11-15',
      priorStart: '2026-11-14',
      priorEnd: '2026-11-14',
      bucket: 'hour',
    });
  });

  it('uses the prior day for yesterday and keeps the hour bucket', () => {
    expect(periodWindow('yesterday', '2026-11-15')).toEqual({
      start: '2026-11-14',
      end: '2026-11-14',
      priorStart: '2026-11-13',
      priorEnd: '2026-11-13',
      bucket: 'hour',
    });
  });

  it('uses seven days and the equally sized prior window', () => {
    expect(periodWindow('last_7_days', '2026-11-15')).toEqual({
      start: '2026-11-09',
      end: '2026-11-15',
      priorStart: '2026-11-02',
      priorEnd: '2026-11-08',
      bucket: 'day',
    });
  });

  it('uses thirty days and the equally sized prior window', () => {
    expect(periodWindow('last_30_days', '2026-11-15')).toEqual({
      start: '2026-10-17',
      end: '2026-11-15',
      priorStart: '2026-09-17',
      priorEnd: '2026-10-16',
      bucket: 'day',
    });
  });

  it('crosses a month boundary in UTC', () => {
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(periodWindow('last_7_days', '2026-03-01').start).toBe('2026-02-23');
  });
});

describe('averageTicket', () => {
  it('rounds to the nearest minor unit', () => {
    expect(averageTicket(37500, 3)).toBe(12500);
    expect(averageTicket(49500, 4)).toBe(12375);
    expect(averageTicket(10000, 3)).toBe(3333);
  });

  it('returns the explicit zero when there is no order', () => {
    expect(averageTicket(0, 0)).toBe(0);
    expect(averageTicket(999, 0)).toBe(0);
  });
});

describe('unitsPerTicket', () => {
  it('is null only when there is no order', () => {
    expect(unitsPerTicket(0, 0)).toBeNull();
    expect(unitsPerTicket(0, 5)).toBeNull();
  });

  it('is zero when orders exist and no item does', () => {
    expect(unitsPerTicket(2, 0)).toBe(0);
  });

  it('pins the golden and METRIC fixtures at four decimals', () => {
    expect(unitsPerTicket(3, 4)).toBe(1.3333);
    expect(unitsPerTicket(4, 7)).toBe(1.75);
  });

  it('rounds half up at the fourth decimal', () => {
    expect(unitsPerTicket(100000, 12345)).toBe(0.1235);
    expect(unitsPerTicket(3, 2)).toBe(0.6667);
  });
});

describe('dimensionRowCeiling', () => {
  it('caps each dimension and multiplies two of them', () => {
    expect(dimensionRowCeiling([])).toBe(1);
    expect(dimensionRowCeiling(['day'])).toBe(31);
    expect(dimensionRowCeiling(['product'])).toBe(200);
    expect(dimensionRowCeiling(['day', 'product'])).toBe(6200);
    expect(dimensionRowCeiling(['hour', 'channel'])).toBe(192);
  });
});
