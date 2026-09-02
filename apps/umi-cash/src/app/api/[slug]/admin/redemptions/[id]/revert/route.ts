import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getStaffMemberId } from '@/lib/identity';
import { getRewardProfileForCard } from '@/lib/prisma-helpers';
import { lockCard } from '@/lib/wallet';
import { getTenant, requireActiveSubscription } from '@/lib/tenant';
import { triggerWalletUpdates, readLifecycleMessage, lifecycleMetadata } from '@/lib/scan-helpers';
import { afterResponse } from '@/lib/after-response';

// waitUntil work shares this budget — see the scan route; the backgrounded wallet push
// is cancelled if the invocation ends first.
export const maxDuration = 30;

/** Guard failure raised INSIDE the transaction; mapped to an HTTP response. */
class RevertError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'RevertError';
  }
}

/**
 * Revert a reward redemption: the canje stays in the ledger (marked reverted, with
 * who did it) and the customer gets the pending reward back — pass included.
 *
 * ADMIN-only by request of the tenant owner: staff can redeem, only the owner can
 * un-redeem, so an accidental canje has a supervised undo instead of a support ticket.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string; id: string } }
) {
  const staff = await requireAuth(['ADMIN'])(req);
  if (!staff) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  if (staff.tenantId !== tenant.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const suspended = await requireActiveSubscription(tenant);
  if (suspended) return suspended;

  // Fail closed: the reversal is value-bearing, so it must be attributed to a real
  // staff member — same stance as the top-up and bulk-seal paths.
  const staffMemberId = await getStaffMemberId(tenant.id, staff.sub);
  if (!staffMemberId) {
    return NextResponse.json({ error: 'Tu usuario no está registrado como personal' }, { status: 403 });
  }

  try {
    const redemption = await prisma.reward_redemptions.findFirst({
      where: { id: params.id, tenant_id: tenant.id },
    });
    if (!redemption) return NextResponse.json({ error: 'Canje no encontrado' }, { status: 404 });

    const cardForReward = await prisma.cards.findUnique({
      where: { id: redemption.loyalty_card_id },
      select: { reward_config_id: true },
    });
    const { visitsRequired, rewardName } = await getRewardProfileForCard(tenant.id, cardForReward ?? { reward_config_id: null });

    const card = await prisma.$transaction(async (tx) => {
      // Serialize against concurrent scans/redeems on this card and re-check the
      // reverted flag under the lock, so a double-tap can't credit two rewards.
      await lockCard(tx, redemption.loyalty_card_id);
      const fresh = await tx.reward_redemptions.findUniqueOrThrow({ where: { id: redemption.id } });
      if (fresh.reverted_at) throw new RevertError(409, 'Este canje ya fue revertido');

      await tx.reward_redemptions.update({
        where: { id: redemption.id },
        data: { reverted_at: new Date(), reverted_by_staff_member_id: staffMemberId },
      });

      const freshCard = await tx.cards.findUniqueOrThrow({ where: { id: redemption.loyalty_card_id } });
      return tx.cards.update({
        where: { id: redemption.loyalty_card_id },
        data: {
          pending_rewards: { increment: 1 },
          // The customer should see (and be notified) that the reward is back.
          metadata: lifecycleMetadata(
            freshCard.metadata,
            `Te devolvimos tu ${rewardName} — está lista para canjear de nuevo 🎁`,
          ),
        },
        include: { accounts: { include: { people: { select: { display_name: true } } } } },
      });
    });

    // Keep the pass's birthday reward visible if one is active (this action never touches it).
    const activeBirthdayReward = await prisma.birthday_rewards.findFirst({
      where: {
        tenant_id: tenant.id,
        loyalty_card_id: card.id,
        status: 'active',
        OR: [{ expires_at: null }, { expires_at: { gte: new Date() } }],
      },
      select: { id: true },
    });

    // The reversal is committed — the wallet refresh must not delay the response.
    await afterResponse(
      'wallet:revert',
      triggerWalletUpdates(
        card.id,
        card.card_number,
        card,
        card.accounts?.people?.display_name ?? null,
        visitsRequired,
        rewardName,
        card.created_at,
        tenant.name,
        params.slug,
        tenant.primaryColor,
        activeBirthdayReward ? tenant.birthdayRewardName : null,
        readLifecycleMessage(card.metadata),
      ),
    );

    return NextResponse.json({
      success: true,
      message: `Canje revertido — ${rewardName} devuelta al cliente`,
      pendingRewards: card.pending_rewards,
    });
  } catch (err) {
    if (err instanceof RevertError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[Revert]', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Error al revertir el canje' }, { status: 500 });
  }
}
