import type { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { generateCardNumber } from './qr';

/**
 * Find-or-create the account's active loyalty card, inside a transaction.
 *
 * Registration must never mint a second card for an account that already has one.
 * The phone short-circuit in the register route (findPersonByPhone) relies on
 * core.people.normalized_phone, which resolve_contact does not always populate,
 * so a returning customer can reach card creation with a card already on file.
 * Guarding on the account's active card is the reliable stop for the duplicate-
 * registration bug. The oldest active card wins so the choice is deterministic
 * (matches the canonical card the wallet pass + QR point at).
 */
export async function findOrCreateActiveCard(
  tx: Prisma.TransactionClient,
  args: { tenantId: string; accountId: string; cardPrefix?: string | null },
) {
  const existing = await tx.cards.findFirst({
    where: { tenant_id: args.tenantId, account_id: args.accountId, status: 'active' },
    orderBy: { created_at: 'asc' },
  });
  if (existing) return existing;

  return tx.cards.create({
    data: {
      tenant_id: args.tenantId,
      account_id: args.accountId,
      card_number: generateCardNumber(args.cardPrefix ?? undefined),
      qr_token: randomBytes(16).toString('hex'),
      qr_issued_at: new Date(),
      status: 'active',
      visits_this_cycle: 0,
      total_visits: 0,
    },
  });
}
