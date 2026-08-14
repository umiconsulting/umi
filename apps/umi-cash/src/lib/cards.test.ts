import { describe, it, expect, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { findOrCreateActiveCard } from './cards';

/**
 * Regression test for the duplicate-card bug (El Gran Ribera / Oscar, 2026-07):
 * a returning customer who slips past the phone short-circuit must REUSE their
 * existing active card, never get a second one minted.
 */
function mockTx(findFirstResult: unknown, createResult: unknown = { id: 'created' }) {
  const cards = {
    findFirst: vi.fn().mockResolvedValue(findFirstResult),
    create: vi.fn().mockResolvedValue(createResult),
  };
  return { tx: { cards } as unknown as Prisma.TransactionClient, cards };
}

describe('findOrCreateActiveCard', () => {
  it('reuses the existing active card and does NOT create a duplicate', async () => {
    const existing = { id: 'card-1', card_number: 'EGR-1', status: 'active' };
    const { tx, cards } = mockTx(existing);

    const result = await findOrCreateActiveCard(tx, {
      tenantId: 't1',
      accountId: 'a1',
      cardPrefix: 'EGR',
    });

    expect(result).toBe(existing);
    expect(cards.create).not.toHaveBeenCalled();
  });

  it('creates a card only when the account has no active card', async () => {
    const created = { id: 'card-2', card_number: 'EGR-2', status: 'active' };
    const { tx, cards } = mockTx(null, created);

    const result = await findOrCreateActiveCard(tx, {
      tenantId: 't1',
      accountId: 'a1',
      cardPrefix: 'EGR',
    });

    expect(result).toBe(created);
    expect(cards.create).toHaveBeenCalledOnce();
    expect(cards.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenant_id: 't1',
          account_id: 'a1',
          status: 'active',
          total_visits: 0,
          visits_this_cycle: 0,
        }),
      }),
    );
  });

  it('looks up only ACTIVE cards for the account, oldest first (deterministic)', async () => {
    const { tx, cards } = mockTx(null);

    await findOrCreateActiveCard(tx, { tenantId: 't1', accountId: 'a1' });

    expect(cards.findFirst).toHaveBeenCalledWith({
      where: { tenant_id: 't1', account_id: 'a1', status: 'active' },
      orderBy: { created_at: 'asc' },
    });
  });

  it('applies the tenant card prefix on new cards', async () => {
    const { tx, cards } = mockTx(null);

    await findOrCreateActiveCard(tx, { tenantId: 't1', accountId: 'a1', cardPrefix: 'EGR' });

    const cardNumber = cards.create.mock.calls[0][0].data.card_number as string;
    expect(cardNumber.startsWith('EGR-')).toBe(true);
  });
});
