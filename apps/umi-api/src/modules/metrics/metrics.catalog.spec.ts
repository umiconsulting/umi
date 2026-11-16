import { describe, expect, it } from 'vitest';
import { METRIC_IDS } from '@umi/contract';
import { FACT_POLICIES, METRIC_CATALOG } from './metrics.catalog';

const byId = new Map(METRIC_CATALOG.map((metric) => [metric.id, metric]));
const WINDOW_POLICIES = ['business_date_window', 'prior_business_date_window'] as const;

describe('metric catalogue metadata', () => {
  it('has one definition for each contract id, in contract order', () => {
    expect(METRIC_CATALOG.map((metric) => metric.id)).toEqual([...METRIC_IDS]);
  });

  it('uses only tokens from the closed policy union', () => {
    const allowed = new Set<string>(FACT_POLICIES);
    for (const metric of METRIC_CATALOG) {
      for (const token of [...metric.includes, ...metric.excludes]) {
        expect(allowed.has(token), `${metric.id} names ${token}`).toBe(true);
      }
    }
  });

  it('has no duplicate token and no token in both lists', () => {
    for (const metric of METRIC_CATALOG) {
      expect(new Set(metric.includes).size, metric.id).toBe(metric.includes.length);
      expect(new Set(metric.excludes).size, metric.id).toBe(metric.excludes.length);
      const overlap = metric.includes.filter((token) => metric.excludes.includes(token));
      expect(overlap, metric.id).toEqual([]);
    }
  });

  it('states at least one included and one excluded fact policy', () => {
    for (const metric of METRIC_CATALOG) {
      expect(metric.includes.length, metric.id).toBeGreaterThan(0);
      expect(metric.excludes.length, metric.id).toBeGreaterThan(0);
    }
  });

  it('includes a committed sale and the location scope for every metric', () => {
    for (const metric of METRIC_CATALOG) {
      expect(metric.includes, metric.id).toContain('committed_sale');
      expect(metric.includes, metric.id).toContain('location_scope');
    }
  });

  it('names exactly one window policy per metric', () => {
    for (const metric of METRIC_CATALOG) {
      const windows = metric.includes.filter((token) =>
        WINDOW_POLICIES.includes(token as (typeof WINDOW_POLICIES)[number]),
      );
      expect(windows, metric.id).toHaveLength(1);
    }
    expect(byId.get('prior_net_sales')?.includes).toContain('prior_business_date_window');
  });

  it('names a denominator only for a quotient formula', () => {
    for (const metric of METRIC_CATALOG) {
      const quotient = metric.formula.includes('/');
      expect(metric.denominator.kind, metric.id).toBe(quotient ? 'metric' : 'not_applicable');
    }
  });

  it('names an existing metric without a denominator as the denominator', () => {
    for (const metric of METRIC_CATALOG) {
      if (metric.denominator.kind !== 'metric') continue;
      expect(metric.denominator.metric, metric.id).not.toBe(metric.id);
      const denominator = byId.get(metric.denominator.metric);
      expect(denominator, `${metric.id} -> ${metric.denominator.metric}`).toBeDefined();
      expect(denominator?.denominator.kind, metric.id).toBe('not_applicable');
    }
  });

  it('gives average_ticket and units_per_ticket the orders denominator', () => {
    expect(byId.get('average_ticket')?.denominator).toEqual({ kind: 'metric', metric: 'orders' });
    expect(byId.get('units_per_ticket')?.denominator).toEqual({ kind: 'metric', metric: 'orders' });
  });

  it('keeps refunds separate from the sale metrics', () => {
    for (const metric of METRIC_CATALOG) {
      if (metric.id === 'refunds') {
        expect(metric.includes, metric.id).toContain('void_adjustment');
        expect(metric.includes, metric.id).toContain('refund_adjustment');
      } else {
        expect(metric.excludes, metric.id).toContain('void_adjustment');
        expect(metric.excludes, metric.id).toContain('refund_adjustment');
      }
    }
  });

  it('keeps the payment mix as two sources without dedupe', () => {
    const payment = byId.get('payment_mix');
    expect(payment?.includes).toContain('committed_tender');
    expect(payment?.includes).toContain('customer_value_allocation');
    expect(payment?.excludes).toContain('tender_dedupe');
  });

  it('excludes an uncommitted sale from every metric', () => {
    for (const metric of METRIC_CATALOG) {
      expect(metric.excludes, metric.id).toContain('uncommitted_sale');
    }
  });
});
