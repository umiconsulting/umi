/**
 * Lifecycle messaging — sends one-off automated nudges to a single customer's
 * wallet pass (welcome, winback, reward-expiring). Each (cardId, journey) pair
 * fires at most once, enforced by the loyalty.lifecycle_sends unique constraint
 * (tenant_id, card_id, journey).
 */

import { prisma } from './prisma';
import { sendApplePushUpdate } from './push-apple';
import { updateGoogleWalletObject } from './pass-google';
import { getActiveRewardConfig, rewardConfigDefaults } from './prisma-helpers';
import { getTenantConfig } from './tenant';
import { DEFAULT_CUSTOMER_NAME } from './constants';

// Known journey identifiers. `reward_expiring` is year-suffixed (e.g.
// "reward_expiring_2026") so each year's birthday reward can re-nudge.
export type LifecycleJourney =
  | 'welcome_no_visit'
  | 'winback_14'
  | 'winback_30'
  | 'winback_60'
  | 'streak_3w'
  | 'streak_6w'
  | 'streak_12w'
  | `reward_expiring_${number}`;

/**
 * Attempts to send a lifecycle message. Returns true if delivered, false if
 * this (card, journey) pair was already sent before (unique-violation skip).
 *
 * The lifecycle_sends insert is the dedupe primitive — checking-then-inserting
 * would race under concurrent cron retries. Always insert first; only on
 * success do we mutate the card and push.
 */
export async function sendLifecycleMessage(
  cardId: string,
  journey: LifecycleJourney,
  message: string,
): Promise<boolean> {
  // The card supplies the tenant scope; lifecycle_sends is tenant-scoped and the
  // uniqueness guard is (tenant_id, card_id, journey).
  const cardForTenant = await prisma.cards.findUnique({
    where: { id: cardId },
    select: { tenant_id: true },
  });
  if (!cardForTenant) return false;
  const tenantId = cardForTenant.tenant_id;

  try {
    await prisma.lifecycle_sends.create({
      data: { tenant_id: tenantId, card_id: cardId, journey, body: message },
    });
  } catch (err: any) {
    // P2002 = unique constraint violation = already sent this journey
    if (err?.code === 'P2002') return false;
    throw err;
  }

  const now = new Date();
  // lifecycleMessage / lifecycleMessageUpdatedAt now live in cards.metadata
  // (last nudge cache). Read-modify-write the metadata blob so we don't clobber
  // other keys.
  const existing = await prisma.cards.findUnique({
    where: { id: cardId },
    select: { metadata: true, card_number: true, balance_cents: true, visits_this_cycle: true, pending_rewards: true, total_visits: true, created_at: true, account_id: true },
  });
  if (!existing) return false;

  const metadata = {
    ...((existing.metadata as Record<string, unknown>) ?? {}),
    lifecycle_message: message,
    lifecycle_message_updated_at: now.toISOString(),
  };

  await prisma.cards.update({
    where: { id: cardId },
    data: { metadata, updated_at: now },
  });

  // Resolve the customer (card → account → person) and the tenant config so the
  // Google wallet object carries the same fields the Apple pass shows.
  const account = await prisma.accounts.findUnique({
    where: { id: existing.account_id },
    select: { person_id: true },
  });
  const person = account
    ? await prisma.people.findUnique({ where: { id: account.person_id }, select: { display_name: true } })
    : null;

  const tenantRow = await prisma.tenants.findUnique({ where: { id: tenantId }, select: { slug: true } });
  const tenant = tenantRow ? await getTenantConfig(tenantRow.slug) : null;

  // Fire both wallet pushes in parallel — failures are logged inside each
  // helper and must not roll back the lifecycle_sends row (it would re-send forever).
  const rewardConfig = await getActiveRewardConfig(tenantId);
  const { visitsRequired, rewardName } = rewardConfigDefaults(rewardConfig);

  await Promise.allSettled([
    sendApplePushUpdate(cardId),
    tenant &&
      updateGoogleWalletObject({
        cardId,
        cardNumber: existing.card_number,
        customerName: person?.display_name || DEFAULT_CUSTOMER_NAME,
        balanceCentavos: existing.balance_cents,
        visitsThisCycle: existing.visits_this_cycle,
        visitsRequired,
        pendingRewards: existing.pending_rewards,
        rewardName,
        totalVisits: existing.total_visits,
        memberSince: existing.created_at.toISOString(),
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        primaryColor: tenant.primaryColor,
        topupEnabled: tenant.topupEnabled,
        lifecycleMessage: message,
      }),
  ]);

  return true;
}
