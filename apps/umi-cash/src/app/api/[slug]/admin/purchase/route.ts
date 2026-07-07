import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, generateRandomToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getStaffMemberId } from '@/lib/identity';
import { applyWalletDelta, lockCard } from '@/lib/wallet';
import { findCardByIdentifier, getActiveRewardConfig, rewardConfigDefaults } from '@/lib/prisma-helpers';
import { formatMXN } from '@/lib/currency';
import { DEFAULT_CUSTOMER_NAME } from '@/lib/constants';
import { getTenant, requireActiveSubscription } from '@/lib/tenant';
import { sendApplePushUpdate } from '@/lib/push-apple';
import { updateGoogleWalletObject } from '@/lib/pass-google';

class InsufficientBalanceError extends Error {
  constructor(public availableCentavos: number) {
    super(`Saldo insuficiente. Disponible: ${formatMXN(availableCentavos)}`);
    this.name = 'InsufficientBalanceError';
  }
}

const PurchaseSchema = z.object({
  cardId: z.string().min(1),
  amountCentavos: z.number().int().min(1, 'El monto mínimo es $0.01'),
  note: z.string().max(200).optional(),
  // Stable per-attempt token so a retry/lost-response resubmit cannot double-charge.
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const staff = await requireAuth(['STAFF', 'ADMIN'])(req);
  if (!staff) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  if (staff.tenantId !== tenant.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const suspended = await requireActiveSubscription(tenant);
  if (suspended) return suspended;

  try {
    const { cardId, amountCentavos, note, idempotencyKey } = PurchaseSchema.parse(await req.json());
    const opKey = idempotencyKey ?? `purchase_${randomUUID()}`;

    const card = await findCardByIdentifier(cardId, tenant.id, { person: true });
    if (!card) return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });

    const staffMemberId = await getStaffMemberId(tenant.id, staff.sub);

    // Balance check + debit + QR rotate inside a single transaction, under a per-card
    // advisory lock, so concurrent charges serialize (prevents overdraw) and a
    // retried request (same key) is a no-op instead of a second debit.
    const result = await prisma.$transaction(async (tx) => {
      await lockCard(tx, card.id);
      // Idempotent replay: this op already committed — return its balance without
      // re-debiting or re-rotating the QR.
      const prior = await tx.points_ledger.findUnique({
        where: { idempotency_key: opKey },
        select: { id: true },
      });
      if (prior) {
        const agg = await tx.points_ledger.aggregate({
          _sum: { delta: true },
          where: { tenant_id: tenant.id, loyalty_card_id: card.id },
        });
        return { balanceCents: agg._sum.delta ?? 0 };
      }
      // Balance = SUM(ledger) read UNDER the lock (source of truth, not the cache),
      // so a concurrent purchase cannot pass the check against stale state.
      const bal = await tx.points_ledger.aggregate({
        _sum: { delta: true },
        where: { tenant_id: tenant.id, loyalty_card_id: card.id },
      });
      const available = bal._sum.delta ?? 0;
      if (available < amountCentavos) {
        throw new InsufficientBalanceError(available);
      }
      const { balanceCents } = await applyWalletDelta(tx, {
        tenantId: tenant.id,
        cardId: card.id,
        deltaCents: -amountCentavos,
        type: 'purchase',
        idempotencyKey: opKey,
        staffMemberId,
        description: note || 'Pago con saldo',
      });
      // Rotate the QR token after a purchase (applyWalletDelta already refreshed balance_cents).
      await tx.cards.update({
        where: { id: card.id },
        data: { qr_token: generateRandomToken(), qr_issued_at: new Date() },
      });
      return { balanceCents };
    });

    const customerName = card.person?.display_name ?? null;
    const rewardConfig = await getActiveRewardConfig(tenant.id);
    const { visitsRequired, rewardName } = rewardConfigDefaults(rewardConfig);

    // Await push inline — waitUntil + http2 is unreliable on Vercel
    await Promise.all([
      sendApplePushUpdate(card.id),
      updateGoogleWalletObject({
        cardId: card.id,
        cardNumber: card.card_number,
        customerName: customerName || DEFAULT_CUSTOMER_NAME,
        balanceCentavos: result.balanceCents,
        visitsThisCycle: card.visits_this_cycle,
        visitsRequired,
        pendingRewards: card.pending_rewards,
        rewardName,
        totalVisits: card.total_visits,
        memberSince: card.created_at.toISOString(),
        tenantName: tenant.name,
        tenantSlug: params.slug,
        primaryColor: tenant.primaryColor,
      }),
    ]).catch((err) => console.warn('[Wallet Update]', err));

    return NextResponse.json({
      success: true,
      amountMXN: formatMXN(amountCentavos),
      newBalanceMXN: formatMXN(result.balanceCents),
      customer: customerName,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    if (err instanceof InsufficientBalanceError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('[Purchase]', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Error al procesar pago' }, { status: 500 });
  }
}
