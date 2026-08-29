import type { Prisma } from '@prisma/client';
import { formatMXN } from '@/lib/currency';
import { DEFAULT_CUSTOMER_NAME } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { sendApplePushUpdate } from '@/lib/push-apple';
import { isGoogleWalletConfigured, updateGoogleWalletObject } from '@/lib/pass-google';

/** Read the cached lifecycle nudge message off the card's metadata jsonb. */
export function readLifecycleMessage(metadata: unknown): string | null {
  const m = (metadata ?? {}) as Record<string, unknown>;
  return (m.lifecycle_message as string) ?? null;
}

/**
 * The wallet object the customer actually saved (recorded at save time in
 * loyalty.passes) — a card re-import mints a new uuid, so the id derived from the
 * card can name an object nobody holds while the saved pass silently freezes.
 * Null means "derive from cardId". On a lookup failure we log and fall back to
 * the derived id — a possibly-stale target beats dropping the update.
 */
export async function findSavedGoogleObjectId(tenantId: string, cardId: string): Promise<string | null> {
  if (!isGoogleWalletConfigured()) return null;
  const pass = await prisma.passes
    .findFirst({
      where: { tenant_id: tenantId, loyalty_card_id: cardId, provider: 'google', status: 'active' },
      select: { provider_object_id: true },
    })
    .catch((err) => {
      console.warn('[Wallet Update] google pass lookup failed, falling back to derived object id:', err);
      return null;
    });
  return pass?.provider_object_id ?? null;
}

/**
 * Canonical shape of the cached moment on cards.metadata — the jsonb key names live
 * here and nowhere else, so the scan and seals writers can't drift apart.
 */
export function lifecycleMetadata(existing: unknown, message: string | null): Prisma.InputJsonObject {
  return {
    ...((existing ?? {}) as Record<string, unknown>),
    lifecycle_message: message,
    lifecycle_message_updated_at: message ? new Date().toISOString() : null,
  } as Prisma.InputJsonObject;
}

export function buildCardSummary(
  card: { visits_this_cycle: number; pending_rewards: number; balance_cents: number },
  visitsRequired: number,
) {
  return {
    visitsThisCycle: card.visits_this_cycle,
    visitsRequired,
    pendingRewards: card.pending_rewards,
    balanceMXN: formatMXN(card.balance_cents),
  };
}

/**
 * Push the current card state to both wallet providers. Shared by the scan and
 * bulk-seal endpoints so a seal credit refreshes the customer's pass exactly like
 * a normal visit does.
 *
 * Callers hand this to `afterResponse` rather than awaiting it on the response path —
 * the write is already committed, and a slow provider must not turn a successful scan
 * into "Error de conexión" on the staff's screen.
 *
 * Run both wallet pushes to completion INDEPENDENTLY. Promise.all is fail-fast: if the
 * Google push rejects (e.g. a bad service-account key), the returned promise settles at
 * once and the invocation can be suspended before the in-flight Apple http2 push
 * finishes → the pass silently never updates (works locally only because the process
 * stays alive). allSettled awaits BOTH, so the Apple push always completes regardless
 * of Google. That still holds under waitUntil: the platform only keeps the function
 * alive as long as the promise we hand it is pending.
 */
export async function triggerWalletUpdates(
  cardId: string,
  cardNumber: string,
  card: { tenant_id: string; visits_this_cycle: number; pending_rewards: number; balance_cents: number; total_visits: number },
  customerName: string | null,
  visitsRequired: number,
  rewardName: string,
  createdAt: Date,
  tenantName: string,
  tenantSlug: string,
  primaryColor: string,
  birthdayRewardName: string | null,
  lifecycleMessage: string | null,
) {
  const savedObjectId = await findSavedGoogleObjectId(card.tenant_id, cardId);

  const _wallet = await Promise.allSettled([
    sendApplePushUpdate(cardId),
    updateGoogleWalletObject({
      cardId, cardNumber,
      objectId: savedObjectId,
      customerName: customerName || DEFAULT_CUSTOMER_NAME,
      balanceCentavos: card.balance_cents,
      visitsThisCycle: card.visits_this_cycle,
      visitsRequired,
      pendingRewards: card.pending_rewards,
      rewardName,
      totalVisits: card.total_visits,
      memberSince: createdAt.toISOString(),
      tenantName,
      tenantSlug,
      primaryColor,
      birthdayRewardName,
      lifecycleMessage,
    }),
  ]);
  if (_wallet[0].status === 'rejected') console.warn('[Wallet Update] Apple push failed:', _wallet[0].reason);
  if (_wallet[1].status === 'rejected') console.warn('[Wallet Update] Google push failed:', _wallet[1].reason);
}
