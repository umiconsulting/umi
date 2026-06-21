/**
 * Wallet money — the SINGLE write path for stored-value balance on the canonical
 * schema. Balance is NEVER mutated directly: every credit/debit appends a
 * `loyalty.points_ledger` row (append-only, enforced by a DB trigger) and a
 * `loyalty.wallet_transactions` history row, then refreshes the derived caches
 * `loyalty.balances` + `loyalty.cards.balance_cents` from `SUM(points_ledger.delta)`.
 *
 * Recomputing the cache as an absolute SUM (not an increment) makes this safe and
 * idempotent regardless of whether a DB trigger also maintains balances.
 *
 * Amounts are centavos (already minor units — no ×100). Debits pass a negative delta.
 */
import { prisma } from './prisma';
import type { Prisma } from '@prisma/client';

export type WalletTxnType = 'topup' | 'purchase' | 'adjustment' | 'gift_card_redeem';

export type WalletDelta = {
  tenantId: string;
  cardId: string;
  /** signed centavos: positive = credit, negative = debit */
  deltaCents: number;
  type: WalletTxnType;
  /** ledger reason; defaults to `type` */
  reason?: string;
  /** unique key so retries cannot double-apply (points_ledger.idempotency_key is UNIQUE) */
  idempotencyKey: string;
  staffMemberId?: string | null;
  description?: string | null;
  /** soft cross-domain provenance (no FK), e.g. ('gift_card', giftCardId) */
  sourceType?: string | null;
  sourceId?: string | null;
};

/**
 * Apply a wallet delta inside an existing transaction. Use this when the caller
 * already owns a `prisma.$transaction` (e.g. gift-card redemption updates the gift
 * card + credits the wallet atomically).
 */
export async function applyWalletDelta(
  tx: Prisma.TransactionClient,
  d: WalletDelta,
): Promise<{ balanceCents: number }> {
  // 1. append-only ledger (the source of truth)
  await tx.points_ledger.create({
    data: {
      tenant_id: d.tenantId,
      loyalty_card_id: d.cardId,
      delta: d.deltaCents,
      reason: d.reason ?? d.type,
      source_type: d.sourceType ?? d.type,
      source_id: d.sourceId ?? null,
      idempotency_key: d.idempotencyKey,
    },
  });

  // 2. human-facing history (append-only)
  await tx.wallet_transactions.create({
    data: {
      tenant_id: d.tenantId,
      loyalty_card_id: d.cardId,
      staff_member_id: d.staffMemberId ?? null,
      type: d.type,
      amount_cents: d.deltaCents,
      description: d.description ?? null,
    },
  });

  // 3. derive the balance from the ledger (absolute SUM → idempotent vs any trigger)
  const agg = await tx.points_ledger.aggregate({
    _sum: { delta: true },
    where: { tenant_id: d.tenantId, loyalty_card_id: d.cardId },
  });
  const balance = agg._sum.delta ?? 0;

  // 4. refresh the caches
  await tx.balances.upsert({
    where: { loyalty_card_id: d.cardId },
    create: { tenant_id: d.tenantId, loyalty_card_id: d.cardId, balance },
    update: { balance, updated_at: new Date() },
  });
  await tx.cards.update({
    where: { id: d.cardId },
    data: { balance_cents: balance, updated_at: new Date() },
  });

  return { balanceCents: balance };
}

/** Apply a wallet delta in its own transaction (single-write callers: topup/purchase). */
export function creditWallet(d: WalletDelta): Promise<{ balanceCents: number }> {
  return prisma.$transaction((tx) => applyWalletDelta(tx, d));
}

/** Current wallet balance (centavos) from the derived cache. */
export async function getWalletBalance(tenantId: string, cardId: string): Promise<number> {
  const row = await prisma.balances.findUnique({ where: { loyalty_card_id: cardId } });
  return row?.balance ?? 0;
}
