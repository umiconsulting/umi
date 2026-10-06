/**
 * Tenant-wide wallet refresh — re-render every customer's pass from current state.
 *
 * A rewards-settings change (new reward name, a second tier switched on) must reach
 * passes that nobody scans for weeks. Apple gets there via APNs + the device's own
 * re-fetch (push-apple.ts); Google objects only change when WE patch them, so this
 * walks every active Google pass of the tenant and PATCHes the object with a fresh
 * render — silently: no addMessage, so nobody's phone buzzes for a settings change.
 */
import { prisma } from './prisma';
import { DEFAULT_CUSTOMER_NAME } from './constants';
import { getRewardProfileForCard } from './prisma-helpers';
import { isGoogleWalletConfigured, updateGoogleWalletObject } from './pass-google';
import { readLifecycleMessage } from './scan-helpers';
import { walletRewardFields } from './reward-tiers';
import type { TenantConfig } from './tenant';

// Google's p99 per PATCH is well under a second; a small pool keeps a 100-pass tenant
// inside a minute without hammering the API.
const CONCURRENCY = 4;

export type GoogleRefreshResult = { total: number; refreshed: number; failed: number };

export async function refreshGoogleWalletObjectsForTenant(tenant: TenantConfig): Promise<GoogleRefreshResult> {
  if (!isGoogleWalletConfigured()) return { total: 0, refreshed: 0, failed: 0 };

  // The object the customer actually saved (see findSavedGoogleObjectId) — one row per
  // card is enough; a re-imported card's older rows are already inactive.
  const passes = await prisma.passes.findMany({
    where: { tenant_id: tenant.id, provider: 'google', status: 'active' },
    select: { loyalty_card_id: true, provider_object_id: true },
  });
  const objectIdByCard = new Map<string, string | null>();
  for (const p of passes) {
    if (!objectIdByCard.has(p.loyalty_card_id)) objectIdByCard.set(p.loyalty_card_id, p.provider_object_id);
  }
  const cardIds = Array.from(objectIdByCard.keys());
  if (cardIds.length === 0) return { total: 0, refreshed: 0, failed: 0 };

  const [cards, birthdays] = await Promise.all([
    prisma.cards.findMany({
      where: { id: { in: cardIds }, tenant_id: tenant.id },
      include: { accounts: { include: { people: { select: { display_name: true } } } } },
    }),
    prisma.birthday_rewards.findMany({
      where: {
        tenant_id: tenant.id,
        loyalty_card_id: { in: cardIds },
        status: 'active',
        OR: [{ expires_at: null }, { expires_at: { gte: new Date() } }],
      },
      select: { loyalty_card_id: true },
    }),
  ]);
  const hasBirthday = new Set(birthdays.map((b) => b.loyalty_card_id));

  let refreshed = 0;
  let failed = 0;
  const queue = [...cards];
  const worker = async () => {
    for (let card = queue.shift(); card; card = queue.shift()) {
      try {
        const profile = await getRewardProfileForCard(tenant.id, card);
        const ok = await updateGoogleWalletObject({
          cardId: card.id,
          objectId: objectIdByCard.get(card.id) ?? null,
          cardNumber: card.card_number,
          customerName: card.accounts?.people?.display_name || DEFAULT_CUSTOMER_NAME,
          balanceCentavos: card.balance_cents,
          visitsThisCycle: card.visits_this_cycle,
          pendingRewards: card.pending_rewards,
          ...walletRewardFields(profile, card.metadata),
          totalVisits: card.total_visits,
          memberSince: card.created_at.toISOString(),
          tenantName: tenant.name,
          tenantSlug: tenant.slug,
          primaryColor: tenant.primaryColor,
          logoUrl: tenant.logoUrl,
          topupEnabled: tenant.topupEnabled,
          birthdayRewardName: hasBirthday.has(card.id) ? tenant.birthdayRewardName : null,
          // Keep whatever moment the card last cached on the pass face, but never
          // re-notify it — this is a settings refresh, not a new message.
          lifecycleMessage: readLifecycleMessage(card.metadata),
          silent: true,
        });
        if (ok) refreshed++;
        else failed++;
      } catch (err) {
        failed++;
        console.warn(`[Wallet Refresh] google refresh failed for ${card.id}:`, err instanceof Error ? err.message : String(err));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, cards.length) }, worker));

  console.log(`[Wallet Refresh] ${tenant.slug}: google ${refreshed}/${cards.length} refreshed, ${failed} failed`);
  return { total: cards.length, refreshed, failed };
}
