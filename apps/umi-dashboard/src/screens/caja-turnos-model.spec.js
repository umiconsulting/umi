import { describe, expect, it } from 'vitest';
import {
  buildVarianceSeries,
  businessDayOf,
  countBuckets,
  filterShifts,
  sortShifts,
  varianceOf,
} from './caja-turnos-model.js';

const shift = (id, status, facts) => ({ id, status, currency: 'MXN', facts });

const open = shift('s1', 'open', {
  register: 'CAJA-01',
  operator: 'Luis M.',
  businessDate: '2026-09-29',
  openingFloatMinorUnits: 150000,
  expectedCashMinorUnits: 343000,
  countedCashMinorUnits: null,
});
const closedShort = shift('s2', 'closed', {
  register: 'CAJA-02',
  operator: 'Ana R.',
  businessDate: '2026-09-28',
  expectedCashMinorUnits: 200000,
  countedCashMinorUnits: 198500,
});
const closedOver = shift('s3', 'closed', {
  register: 'CAJA-02',
  operator: 'Ana R.',
  businessDate: '2026-09-29',
  expectedCashMinorUnits: 100000,
  countedCashMinorUnits: 100050,
});
const attention = shift('s4', 'reconciliation_required', {
  register: 'CAJA-03',
  operator: 'Sofía T.',
  businessDate: '2026-09-29',
  expectedCashMinorUnits: 50000,
  countedCashMinorUnits: 49900,
});

const items = [open, closedShort, closedOver, attention];

describe('variance', () => {
  it('is counted minus expected', () => {
    expect(varianceOf(closedShort.facts)).toBe(-1500);
    expect(varianceOf(closedOver.facts)).toBe(50);
  });

  it('is null before the drawer is counted, not zero', () => {
    // Zero would read as "balanced" on a drawer nobody has counted yet.
    expect(varianceOf(open.facts)).toBeNull();
    expect(varianceOf({ expectedCashMinorUnits: 100 })).toBeNull();
  });
});

describe('buckets and filter', () => {
  it('counts each triage bucket', () => {
    expect(countBuckets(items)).toEqual({ all: 4, open: 1, attention: 1, closed: 2 });
  });

  it('filters by bucket', () => {
    expect(filterShifts(items, { bucket: 'closed' }).map((s) => s.id)).toEqual(['s2', 's3']);
    expect(filterShifts(items, { bucket: 'attention' }).map((s) => s.id)).toEqual(['s4']);
    expect(filterShifts(items, { bucket: 'open' }).map((s) => s.id)).toEqual(['s1']);
  });

  it('searches the drawer, the operator, and the business day', () => {
    expect(filterShifts(items, { query: 'caja-02' }).map((s) => s.id)).toEqual(['s2', 's3']);
    expect(filterShifts(items, { query: 'sofía' }).map((s) => s.id)).toEqual(['s4']);
    expect(filterShifts(items, { query: '2026-09-28' }).map((s) => s.id)).toEqual(['s2']);
    expect(filterShifts(items, { query: 'nadie' })).toEqual([]);
  });
});

describe('sort', () => {
  it('sorts by variance, worst first, then best first', () => {
    expect(sortShifts(items, { key: 'variance', dir: 'asc' }).map((s) => s.id)).toEqual([
      's2',
      's4',
      's3',
      's1',
    ]);
    expect(sortShifts(items, { key: 'variance', dir: 'desc' }).map((s) => s.id)).toEqual([
      's3',
      's4',
      's2',
      's1',
    ]);
  });

  it('keeps an uncounted drawer last in both directions', () => {
    // A drawer nobody has counted has no variance. Sorting it as zero would put it
    // between a shortage and an overage, which reads as "balanced".
    const descIds = sortShifts(items, { key: 'variance', dir: 'desc' }).map((s) => s.id);
    const ascIds = sortShifts(items, { key: 'variance', dir: 'asc' }).map((s) => s.id);
    expect(descIds.at(-1)).toBe('s1');
    expect(ascIds.at(-1)).toBe('s1');
  });

  it('sorts by business day, newest first by default', () => {
    expect(sortShifts(items, { key: 'date', dir: 'desc' }).map((s) => s.id)).toEqual([
      's1',
      's3',
      's4',
      's2',
    ]);
  });

  it('does not mutate the input', () => {
    const before = items.map((s) => s.id);
    sortShifts(items, { key: 'variance', dir: 'asc' });
    expect(items.map((s) => s.id)).toEqual(before);
  });
});

describe('the business-day series', () => {
  it('sums the closed shifts of each business day, oldest first', () => {
    expect(buildVarianceSeries(items)).toEqual([
      { businessDate: '2026-09-28', varianceMinorUnits: -1500 },
      { businessDate: '2026-09-29', varianceMinorUnits: 50 },
    ]);
  });

  it('ignores a shift that has not closed, because it has no variance yet', () => {
    const series = buildVarianceSeries([open, attention]);
    expect(series).toEqual([]);
  });

  it('keeps only the last N business days', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      shift(`d${i}`, 'closed', {
        businessDate: `2026-09-${String(i + 1).padStart(2, '0')}`,
        expectedCashMinorUnits: 1000,
        countedCashMinorUnits: 1000 + i,
      }),
    );
    const series = buildVarianceSeries(many, 3);
    expect(series.map((d) => d.businessDate)).toEqual(['2026-09-08', '2026-09-09', '2026-09-10']);
  });

  it('groups two closes of the same day into one point', () => {
    const series = buildVarianceSeries([closedShort, { ...closedShort, id: 's9' }]);
    expect(series).toEqual([{ businessDate: '2026-09-28', varianceMinorUnits: -3000 }]);
  });

  it('never uses the calendar day of the timestamp when the business day is present', () => {
    // A café that closes at 02:00: the timestamp says the 30th, the trading day is the 29th.
    const lateShift = shift('late', 'closed', {
      businessDate: '2026-09-29',
      expectedCashMinorUnits: 100000,
      countedCashMinorUnits: 100000,
    });
    lateShift.occurredAt = '2026-09-30 08:12:00+00';
    expect(businessDayOf(lateShift)).toBe('2026-09-29');
    expect(buildVarianceSeries([lateShift])).toEqual([
      { businessDate: '2026-09-29', varianceMinorUnits: 0 },
    ]);
  });
});
