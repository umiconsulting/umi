import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getStaffMemberId } from '@/lib/identity';
import { creditWallet } from '@/lib/wallet';
import { findCardByIdentifier, getActiveRewardConfig, rewardConfigDefaults } from '@/lib/prisma-helpers';
import { formatMXN, MAX_TOPUP_CENTAVOS } from '@/lib/currency';
import { DEFAULT_CUSTOMER_NAME } from '@/lib/constants';
import { sendApplePushUpdate } from '@/lib/push-apple';
import { updateGoogleWalletObject } from '@/lib/pass-google';
import { getTenant, requireActiveSubscription } from '@/lib/tenant';

// Staff top-up limit: $5,000 MXN per day per staff member
const STAFF_DAILY_TOPUP_LIMIT = 500_000;
// Per-card top-up limit: $5,000 MXN per day (prevents coordinated staff abuse)
const CARD_DAILY_TOPUP_LIMIT = 500_000;

class LimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LimitError';
  }
}

const TopUpSchema = z.object({
  cardId: z.string().min(1),
  amountCentavos: z.number().int().positive().min(100).max(MAX_TOPUP_CENTAVOS),
  note: z.string().max(200).optional(),
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
    const body = await req.json();
    const { cardId, amountCentavos, note } = TopUpSchema.parse(body);

    const card = await findCardByIdentifier(cardId, tenant.id, { person: true });
    if (!card) return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });

    const staffMemberId = await getStaffMemberId(tenant.id, staff.sub);

    // Staff cannot top up a card linked to their own person identity (requires admin approval)
    const staffUser = await prisma.users.findUnique({ where: { id: staff.sub }, select: { person_id: true } });
    if (staffUser?.person_id && staffUser.person_id === card.accounts?.person_id) {
      return NextResponse.json({ error: 'No puedes recargar tu propia tarjeta' }, { status: 403 });
    }

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    // Limit checks read the wallet_transactions history (topup rows, signed cents).
    // Daily top-up limit per staff member (prevents embezzlement/abuse)
    if (staffMemberId) {
      const staffTodayTotal = await prisma.wallet_transactions.aggregate({
        _sum: { amount_cents: true },
        where: { tenant_id: tenant.id, staff_member_id: staffMemberId, type: 'topup', created_at: { gte: dayStart } },
      });
      const todaySum = staffTodayTotal._sum.amount_cents ?? 0;
      if (todaySum + amountCentavos > STAFF_DAILY_TOPUP_LIMIT) {
        throw new LimitError(`Límite diario de recargas alcanzado (máx. ${formatMXN(STAFF_DAILY_TOPUP_LIMIT)} por día). Contacta al administrador.`);
      }
    }

    // Per-card daily amount limit (prevents coordinated staff abuse on a single card)
    const cardTodayTotal = await prisma.wallet_transactions.aggregate({
      _sum: { amount_cents: true },
      where: { tenant_id: tenant.id, loyalty_card_id: card.id, type: 'topup', created_at: { gte: dayStart } },
    });
    const cardTodaySum = cardTodayTotal._sum.amount_cents ?? 0;
    if (cardTodaySum + amountCentavos > CARD_DAILY_TOPUP_LIMIT) {
      throw new LimitError(`Esta tarjeta ya alcanzó su límite diario de recarga (máx. ${formatMXN(CARD_DAILY_TOPUP_LIMIT)}). Contacta al administrador.`);
    }

    // Same card cannot receive more than 3 top-ups per day (anti-fraud)
    const cardTopupsToday = await prisma.wallet_transactions.count({
      where: { tenant_id: tenant.id, loyalty_card_id: card.id, type: 'topup', created_at: { gte: dayStart } },
    });
    if (cardTopupsToday >= 3) {
      throw new LimitError('Esta tarjeta ya recibió el máximo de recargas por hoy (3). Contacta al administrador.');
    }

    // Apply the credit through the single wallet write path (ledger + history + cache).
    const { balanceCents } = await creditWallet({
      tenantId: tenant.id,
      cardId: card.id,
      deltaCents: amountCentavos,
      type: 'topup',
      idempotencyKey: `topup_${card.id}_${Date.now()}`,
      staffMemberId,
      description: note ?? 'Recarga en tienda',
    });

    const customerName = card.person?.display_name ?? null;
    const rewardConfig = await getActiveRewardConfig(tenant.id);
    const { visitsRequired, rewardName } = rewardConfigDefaults(rewardConfig);

    // Await push inline — waitUntil + http2 is unreliable on Vercel
    await Promise.all([
      sendApplePushUpdate(card.id),
      updateGoogleWalletObject({
        cardId: card.id, cardNumber: card.card_number,
        customerName: customerName || DEFAULT_CUSTOMER_NAME,
        balanceCentavos: balanceCents,
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
      newBalanceCentavos: balanceCents,
      newBalanceMXN: formatMXN(balanceCents),
      amountMXN: formatMXN(amountCentavos),
      customer: customerName,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    if (err instanceof LimitError) return NextResponse.json({ error: err.message }, { status: 429 });
    console.error('[TopUp]', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Error al recargar' }, { status: 500 });
  }
}
