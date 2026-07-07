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
 * CONCURRENCY / IDEMPOTENCY (bug-fix 2026-07): every apply runs under a per-card
 * transaction-scoped advisory lock, so concurrent operations on the same card
 * serialize. Idempotency is enforced by looking up `idempotency_key` UNDER THAT
 * LOCK before inserting — a retried request (same client-supplied key) finds the
 * prior ledger row and returns the current balance WITHOUT double-applying. (We
 * cannot rely on catching the UNIQUE-violation, because a constraint error aborts
 * the whole Postgres transaction and no further query can run in it.)
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
  /** STABLE per-operation key so retries cannot double-apply (client-supplied). */
  idempotencyKey: string;
  staffMemberId?: string | null;
  description?: string | null;
  /** soft cross-domain provenance (no FK), e.g. ('gift_card', giftCardId) */
  sourceType?: string | null;
  sourceId?: string | null;
};

/**
 * Serialize concurrent wallet operations on ONE card for the life of the
 * transaction (auto-released at COMMIT/ROLLBACK). All wallet writes take this lock
 * so limit checks, balance checks and idempotency lookups are race-free.
 */
export async function lockCard(tx: Prisma.TransactionClient, cardId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet:card:${cardId}`})::bigint)`;
}

/**
 * Core apply — ASSUMES the caller already holds the card advisory lock (via
 * {@link lockCard}). Idempotent: if a ledger row with this idempotency_key already
 * exists, it returns the current balance without writing anything.
 */
async function applyWalletDeltaLocked(
  tx: Prisma.TransactionClient,
  d: WalletDelta,
): Promise<{ balanceCents: number; alreadyApplied: boolean }> {
  // Idempotency (under the card lock): a prior committed apply with this key already
  // moved the money. Return the current derived balance and DO NOT write again.
  const prior = await tx.points_ledger.findUnique({
    where: { idempotency_key: d.idempotencyKey },
    select: { id: true },
  });
  if (prior) {
    const agg = await tx.points_ledger.aggregate({
      _sum: { delta: true },
      where: { tenant_id: d.tenantId, loyalty_card_id: d.cardId },
    });
    return { balanceCents: agg._sum.delta ?? 0, alreadyApplied: true };
  }

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

  return { balanceCents: balance, alreadyApplied: false };
}

/**
 * Apply a wallet delta inside an existing transaction (e.g. gift-card redemption
 * updates the gift card + credits the wallet atomically). Takes the per-card lock
 * itself, so it is race-safe and idempotent for these callers too.
 */
export async function applyWalletDelta(
  tx: Prisma.TransactionClient,
  d: WalletDelta,
): Promise<{ balanceCents: number }> {
  await lockCard(tx, d.cardId);
  const { balanceCents } = await applyWalletDeltaLocked(tx, d);
  return { balanceCents };
}

/**
 * Apply a wallet delta in its own transaction (single-write callers: topup/purchase).
 * The card is locked FIRST, then the optional `preflight` runs (limit/balance checks
 * that must see committed state and be re-evaluated atomically under the lock — it may
 * throw to abort), then the delta is applied idempotently.
 */
export function creditWallet(
  d: WalletDelta,
  preflight?: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<{ balanceCents: number }> {
  return prisma.$transaction(async (tx) => {
    await lockCard(tx, d.cardId);
    // Idempotent short-circuit UNDER the lock: a prior apply with this key already
    // ran, so skip the preflight (limit/balance checks would otherwise spuriously
    // reject a legitimate retry) and return the current balance without writing.
    const prior = await tx.points_ledger.findUnique({
      where: { idempotency_key: d.idempotencyKey },
      select: { id: true },
    });
    if (prior) {
      const agg = await tx.points_ledger.aggregate({
        _sum: { delta: true },
        where: { tenant_id: d.tenantId, loyalty_card_id: d.cardId },
      });
      return { balanceCents: agg._sum.delta ?? 0 };
    }
    if (preflight) await preflight(tx);
    const { balanceCents } = await applyWalletDeltaLocked(tx, d);
    return { balanceCents };
  });
}

/** Current wallet balance (centavos) from the derived cache. */
export async function getWalletBalance(tenantId: string, cardId: string): Promise<number> {
  const row = await prisma.balances.findUnique({ where: { loyalty_card_id: cardId } });
  return row?.balance ?? 0;
}
