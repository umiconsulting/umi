import { prisma } from './prisma';
import { DEFAULT_VISITS_REQUIRED, DEFAULT_REWARD_NAME } from './constants';

export async function getActiveRewardConfig(tenantId: string) {
  return prisma.reward_configs.findFirst({
    where: { tenant_id: tenantId, is_active: true },
    orderBy: { activated_at: 'desc' },
  });
}

export function rewardConfigDefaults(config: Awaited<ReturnType<typeof getActiveRewardConfig>>) {
  return {
    visitsRequired: config?.visits_required ?? DEFAULT_VISITS_REQUIRED,
    rewardName: config?.reward_name ?? DEFAULT_REWARD_NAME,
    rewardDescription: config?.reward_description ?? null,
  };
}

/**
 * Find a loyalty card by its uuid id or PREFIX-XXXXXXXXX card number, scoped to a
 * tenant. On the canonical schema the customer is reached via account → person;
 * pass `{ person: true }` to hydrate it. Always includes the derived balance.
 */
export async function findCardByIdentifier(
  identifier: string,
  tenantId: string,
  opts?: { person?: boolean },
) {
  // `id` is a uuid column; only match it when the identifier is actually a uuid,
  // otherwise Postgres errors coercing a card number (e.g. "EGR-123") to uuid.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
  const card = await prisma.cards.findFirst({
    where: {
      tenant_id: tenantId,
      OR: isUuid ? [{ card_number: identifier }, { id: identifier }] : [{ card_number: identifier }],
    },
    include: { accounts: true, balances: true },
  });
  if (!card) return null;
  if (opts?.person && card.accounts?.person_id) {
    const person = await prisma.people.findUnique({
      where: { id: card.accounts.person_id },
    });
    return { ...card, person };
  }
  return { ...card, person: null };
}
