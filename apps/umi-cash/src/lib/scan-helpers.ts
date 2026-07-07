import { formatMXN } from '@/lib/currency';
import { DEFAULT_CUSTOMER_NAME } from '@/lib/constants';
import { sendApplePushUpdate } from '@/lib/push-apple';
import { updateGoogleWalletObject } from '@/lib/pass-google';

/** Read the cached lifecycle nudge message off the card's metadata jsonb. */
export function readLifecycleMessage(metadata: unknown): string | null {
  const m = (metadata ?? {}) as Record<string, unknown>;
  return (m.lifecycle_message as string) ?? null;
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
 * Run both wallet pushes to completion INDEPENDENTLY. Promise.all is fail-fast: if the
 * Google push rejects (e.g. a bad service-account key), the await returns at once and
 * Vercel suspends the function before the in-flight Apple http2 push can finish → the
 * pass silently never updates (works locally only because the process stays alive).
 * allSettled awaits BOTH, so the Apple push always completes regardless of Google.
 */
export async function triggerWalletUpdates(
  cardId: string,
  cardNumber: string,
  card: { visits_this_cycle: number; pending_rewards: number; balance_cents: number; total_visits: number },
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
  const _wallet = await Promise.allSettled([
    sendApplePushUpdate(cardId),
    updateGoogleWalletObject({
      cardId, cardNumber,
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
