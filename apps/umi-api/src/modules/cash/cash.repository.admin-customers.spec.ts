import { describe, expect, it } from 'vitest';
import { CashRepository } from './cash.repository';

/**
 * The search predicate is part of the contact boundary.
 *
 * Masking the response is not enough: if the SQL still matches `phone` or
 * `email`, a caller without `customer.contact.read` can test whether a phone or
 * an email belongs to a member. The page query and the count query must use the
 * same restricted filter, or `total` can disagree with the rows.
 */
function make() {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const pg = {
    withMerchant: async (work: (client: unknown) => Promise<unknown>) =>
      work({
        query: async (text: string, values: unknown[]) => {
          calls.push({ text, values });
          return text.includes('count(*)') ? { rows: [{ n: 0 }] } : { rows: [] };
        },
      }),
  };
  return { repo: new CashRepository(pg as never), calls };
}

const OPTS = { search: '5550001111', sort: 'recent', limit: 20, skip: 0 };

describe('CashRepository.adminCustomers search predicate', () => {
  it('excludes phone and email from the page and the count without contact permission', async () => {
    const h = make();
    await h.repo.adminCustomers('t1', { ...OPTS, includeContact: false });

    expect(h.calls).toHaveLength(2);
    for (const call of h.calls) {
      expect(call.text).toContain('name ILIKE');
      expect(call.text).toContain('card_number ILIKE');
      expect(call.text).not.toContain('phone ILIKE');
      expect(call.text).not.toContain('email ILIKE');
    }
  });

  it('matches phone and email when the caller holds contact permission', async () => {
    const h = make();
    await h.repo.adminCustomers('t1', { ...OPTS, includeContact: true });

    expect(h.calls).toHaveLength(2);
    for (const call of h.calls) {
      expect(call.text).toContain('phone ILIKE');
      expect(call.text).toContain('email ILIKE');
    }
  });

  it('keeps the same term for both queries', async () => {
    const h = make();
    await h.repo.adminCustomers('t1', { ...OPTS, includeContact: false });

    expect(h.calls[0].values[1]).toBe(OPTS.search);
    expect(h.calls[1].values[1]).toBe(OPTS.search);
  });
});
