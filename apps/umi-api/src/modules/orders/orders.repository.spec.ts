import { describe, expect, it } from 'vitest';
import { buildStatusClause } from './orders.repository';

// Regression: the dashboard sends a single status id (placed | preparing | ready |
// completed | canceled) for the per-status chips. Before the fix only 'active',
// 'completed' and the misspelled 'cancelled' were handled, so the other chips fell
// through to an empty clause and returned EVERY order instead of narrowing.
describe('buildStatusClause', () => {
  it('narrows to each single commercial status', () => {
    for (const status of ['placed', 'preparing', 'ready', 'completed', 'canceled']) {
      const params: unknown[] = ['merchant-1'];
      const sql = buildStatusClause(status, params);
      expect(sql).toBe('AND o.status = $2');
      expect(params[1]).toBe(status);
    }
  });

  it('expands the active shortcut to the three running statuses', () => {
    const params: unknown[] = ['merchant-1'];
    const sql = buildStatusClause('active', params);
    expect(sql).toBe('AND o.status = ANY($2::text[])');
    expect(params[1]).toEqual(['placed', 'preparing', 'ready']);
  });

  it('accepts the legacy "cancelled" spelling as the enum value "canceled"', () => {
    const params: unknown[] = ['merchant-1'];
    const sql = buildStatusClause('cancelled', params);
    expect(sql).toBe('AND o.status = $2');
    expect(params[1]).toBe('canceled');
  });

  it('applies no status predicate for "all" or an unknown filter', () => {
    for (const filter of ['all', 'bogus', '']) {
      const params: unknown[] = ['merchant-1'];
      expect(buildStatusClause(filter, params)).toBe('');
      expect(params).toHaveLength(1);
    }
  });
});
