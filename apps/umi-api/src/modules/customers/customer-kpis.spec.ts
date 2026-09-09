import { describe, expect, it } from 'vitest';
import {
  averageTicketCents,
  classifyCustomerSegment,
  daysBetween,
  visitsPerMonth,
  type SegmentInput,
} from './customer-kpis';

// A currently-active repeat buyer, used as the base to mutate per case.
const REGULAR: SegmentInput = {
  orders: 6,
  visits: 6,
  totalSpendCents: 60_000,
  recencyDays: 5,
  tenureDays: 120,
};

describe('classifyCustomerSegment', () => {
  it('is a prospect with no orders (a contact/loyalty lead, not a buyer)', () => {
    expect(
      classifyCustomerSegment({
        orders: 0,
        visits: 0,
        totalSpendCents: 0,
        recencyDays: null,
        tenureDays: null,
      }),
    ).toBe('prospect');
  });

  it('is lapsed after 180 days with no order, whatever the history', () => {
    expect(classifyCustomerSegment({ ...REGULAR, recencyDays: 200 })).toBe('lapsed');
    // Even a former VIP goes lapsed once recency crosses the mark.
    expect(
      classifyCustomerSegment({
        orders: 40,
        visits: 40,
        totalSpendCents: 500_000,
        recencyDays: 210,
        tenureDays: 700,
      }),
    ).toBe('lapsed');
  });

  it('flags a repeat buyer as at-risk when overdue vs their own rhythm', () => {
    // 6 visits over 120 days → ~20-day typical gap; 70 days out is > 3× that.
    expect(classifyCustomerSegment({ ...REGULAR, recencyDays: 70 })).toBe('at_risk');
  });

  it('does NOT flag at-risk while still within the personal rhythm', () => {
    // 18 days out is < 3× the ~20-day gap and inside the active window → still regular.
    expect(classifyCustomerSegment({ ...REGULAR, recencyDays: 18 })).toBe('regular');
  });

  it('is VIP when visits and spend are both high and the buyer is current', () => {
    expect(
      classifyCustomerSegment({
        orders: 12,
        visits: 12,
        totalSpendCents: 180_000,
        recencyDays: 6,
        tenureDays: 150,
      }),
    ).toBe('vip');
  });

  it('a high-visit but low-spend current buyer is regular, not VIP', () => {
    expect(
      classifyCustomerSegment({
        orders: 12,
        visits: 12,
        totalSpendCents: 40_000, // below the VIP spend floor
        recencyDays: 6,
        tenureDays: 150,
      }),
    ).toBe('regular');
  });

  it('is new when it has ordered but has no habit yet', () => {
    expect(
      classifyCustomerSegment({
        orders: 1,
        visits: 1,
        totalSpendCents: 8_000,
        recencyDays: 3,
        tenureDays: 3,
      }),
    ).toBe('new');
  });

  it('treats visits below the regular floor as new even when current', () => {
    expect(classifyCustomerSegment({ ...REGULAR, visits: 2, orders: 2, recencyDays: 4 })).toBe(
      'new',
    );
  });
});

describe('averageTicketCents', () => {
  it('divides spend by orders and rounds to whole centavos', () => {
    expect(averageTicketCents(60_000, 6)).toBe(10_000);
    expect(averageTicketCents(10_000, 3)).toBe(3_333);
  });
  it('is 0 with no orders (no divide-by-zero)', () => {
    expect(averageTicketCents(0, 0)).toBe(0);
    expect(averageTicketCents(5_000, 0)).toBe(0);
  });
});

describe('visitsPerMonth', () => {
  it('spreads visits over 30-day months', () => {
    expect(visitsPerMonth(6, 90)).toBe(2); // 6 visits / 3 months
    expect(visitsPerMonth(6, 120)).toBe(1.5);
  });
  it('caps the tenure floor at one month so a fresh customer is not inflated', () => {
    expect(visitsPerMonth(3, 10)).toBe(3); // months floored at 1
  });
  it('is 0 with no visits', () => {
    expect(visitsPerMonth(0, 90)).toBe(0);
  });
});

describe('daysBetween', () => {
  it('counts whole days between two ISO instants', () => {
    expect(daysBetween('2026-01-01T00:00:00Z', '2026-01-11T00:00:00Z')).toBe(10);
  });
  it('never returns a negative span', () => {
    expect(daysBetween('2026-01-11T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(0);
  });
  it('is null when either side is missing or unparseable', () => {
    expect(daysBetween(null, '2026-01-01T00:00:00Z')).toBeNull();
    expect(daysBetween('2026-01-01T00:00:00Z', undefined)).toBeNull();
    expect(daysBetween('not-a-date', '2026-01-01T00:00:00Z')).toBeNull();
  });
});
