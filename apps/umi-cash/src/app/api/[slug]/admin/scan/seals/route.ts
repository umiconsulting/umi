import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getStaffMemberId } from '@/lib/identity';
import { getActiveRewardConfig, rewardConfigDefaults, findCardByIdentifier } from '@/lib/prisma-helpers';
import { lockCard } from '@/lib/wallet';
import { getTenant, requireActiveSubscription } from '@/lib/tenant';
import { triggerWalletUpdates, buildCardSummary, readLifecycleMessage } from '@/lib/scan-helpers';

// Safety cap on a single manual credit — a migrating customer might carry a couple
// of full cards' worth of stamps, but this bounds a fat-fingered entry.
const MAX_BULK_SEALS = 50;

const SealsSchema = z.object({
  cardId: z.string().uuid(),
  seals: z.number().int().min(1).max(MAX_BULK_SEALS),
  note: z.string().max(200).optional(),
  idempotencyKey: z.string().min(8).max(200).optional(),
});

/** Guard failure raised INSIDE the transaction; mapped to an HTTP response. */
class SealError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'SealError';
  }
}

/**
 * Credit N loyalty seals to a card in one action (Kalala-only, gated by
 * tenant.multiSealEnabled). Purpose: catch up stamps a customer earned on Kalala's
 * previous wallet provider, which we can't import — staff reads the count off the
 * customer's old wallet on-site and enters it here.
 *
 * Behaves like N normal visits: crosses the reward threshold and mints reward(s)
 * accordingly. Bypasses the once-per-day visit cap (it's an intentional manual
 * credit), but stays card-locked + idempotent so a double-tap can't double-credit.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const staff = await requireAuth(['STAFF', 'ADMIN'])(req);
  if (!staff) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  if (staff.tenantId !== tenant.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  // Feature gate (defense in depth — the UI already hides the control when off).
  if (!tenant.multiSealEnabled) {
    return NextResponse.json({ error: 'Función no habilitada' }, { status: 403 });
  }

  const suspended = await requireActiveSubscription(tenant);
  if (suspended) return suspended;

  try {
    const { cardId, seals, note, idempotencyKey } = SealsSchema.parse(await req.json());
    const opKey = idempotencyKey ?? `seals_${randomUUID()}`;

    // Card must belong to this tenant.
    const card = await findCardByIdentifier(cardId, tenant.id, { person: true });
    if (!card) return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });

    const staffMemberId = await getStaffMemberId(tenant.id, staff.sub);
    const rewardConfig = await getActiveRewardConfig(tenant.id);
    const { visitsRequired, rewardName } = rewardConfigDefaults(rewardConfig);
    const required = Math.max(1, visitsRequired); // guard divide-by-zero on a mis-set config

    // Keep the pass's birthday reward visible if one is still active (this action
    // never touches it — we just don't want the wallet push to hide it).
    const activeBirthdayReward = await prisma.birthday_rewards.findFirst({
      where: {
        tenant_id: tenant.id,
        loyalty_card_id: cardId,
        status: 'active',
        OR: [{ expires_at: null }, { expires_at: { gte: new Date() } }],
      },
      select: { id: true },
    });
    const birthdayRewardName = activeBirthdayReward ? tenant.birthdayRewardName : null;

    const result = await prisma.$transaction(async (tx) => {
      // Serialize concurrent credits on this card and re-check idempotency under the
      // lock, so a double-tap / retry can't apply the seals twice.
      await lockCard(tx, cardId);
      const fresh = await tx.cards.findUniqueOrThrow({ where: { id: cardId } });
      if (fresh.tenant_id !== tenant.id) throw new SealError(404, 'Tarjeta no encontrada');

      const prior = await tx.visit_events.findFirst({
        where: {
          tenant_id: tenant.id,
          loyalty_card_id: cardId,
          metadata: { path: ['idempotency_key'], equals: opKey },
        },
        select: { id: true },
      });
      if (prior) return { card: fresh, rewardsEarned: 0, replayed: true };

      const total = fresh.visits_this_cycle + seals;
      const rewardsEarned = Math.floor(total / required);
      const newCycle = total % required;

      await tx.visit_events.create({
        data: {
          tenant_id: tenant.id,
          loyalty_card_id: cardId,
          staff_member_id: staffMemberId,
          note: note ?? `${seals} ${seals === 1 ? 'sello' : 'sellos'} (registro manual)`,
          metadata: { idempotency_key: opKey, seals, source: 'manual_bulk' },
        },
      });

      const updated = await tx.cards.update({
        where: { id: cardId },
        data: {
          total_visits: { increment: seals },
          visits_this_cycle: newCycle,
          pending_rewards: { increment: rewardsEarned },
        },
      });

      return { card: updated, rewardsEarned, replayed: false };
    });

    const customerName = card.person?.display_name ?? null;
    await triggerWalletUpdates(
      cardId,
      card.card_number,
      result.card,
      customerName,
      visitsRequired,
      rewardName,
      card.created_at,
      tenant.name,
      params.slug,
      tenant.primaryColor,
      birthdayRewardName,
      readLifecycleMessage(result.card.metadata),
    );

    const sealWord = seals === 1 ? 'sello' : 'sellos';
    let message = result.replayed
      ? `Estos ${sealWord} ya se habían registrado`
      : `${seals} ${sealWord} agregado${seals === 1 ? '' : 's'}`;
    const earned = result.replayed ? 0 : result.rewardsEarned;
    if (earned > 0) {
      message += ` · ¡${earned} recompensa${earned === 1 ? '' : 's'} ganada${earned === 1 ? '' : 's'}!`;
    }

    return NextResponse.json({
      success: true,
      seals,
      rewardsEarned: earned,
      message,
      card: buildCardSummary(result.card, visitsRequired),
    });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    if (err instanceof SealError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[Scan:seals]', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Error al agregar sellos' }, { status: 500 });
  }
}
