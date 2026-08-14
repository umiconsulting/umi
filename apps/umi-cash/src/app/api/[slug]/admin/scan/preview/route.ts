import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getActiveRewardConfig, rewardConfigDefaults } from '@/lib/prisma-helpers';
import { resolveScanTarget } from '@/lib/scan-resolve';
import { formatMXN } from '@/lib/currency';
import { getTenant, requireActiveSubscription } from '@/lib/tenant';
import { tenantStartOfDay } from '@/lib/timezone';

const PreviewSchema = z.object({
  qrPayload: z.string().min(1),
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
    const { qrPayload } = PreviewSchema.parse(await req.json());

    // QR payload / card number / phone → card (shared with the commit endpoint so
    // anything that previews here also commits on /scan).
    const resolved = await resolveScanTarget(tenant.id, qrPayload);
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    const card = resolved.card;

    // Staff cannot preview a card linked to their own person identity.
    const staffUser = await prisma.users.findUnique({ where: { id: staff.sub }, select: { person_id: true } });
    if (staffUser?.person_id && staffUser.person_id === card.accounts?.person_id) {
      return NextResponse.json({ error: 'No puedes escanear tu propia tarjeta' }, { status: 403 });
    }

    const [rewardConfig, activeBirthdayReward] = await Promise.all([
      getActiveRewardConfig(tenant.id),
      prisma.birthday_rewards.findFirst({
        // NULL expires_at = never expires (Postgres NULL >= now() is NULL, not true).
        where: {
          tenant_id: tenant.id,
          loyalty_card_id: card.id,
          status: 'active',
          OR: [{ expires_at: null }, { expires_at: { gte: new Date() } }],
        },
      }),
    ]);
    const { visitsRequired, rewardName } = rewardConfigDefaults(rewardConfig);

    // Check if already visited today (calendar day in tenant timezone)
    const recentVisit = await prisma.visit_events.findFirst({
      where: { tenant_id: tenant.id, loyalty_card_id: card.id, occurred_at: { gte: tenantStartOfDay(tenant.timezone) } },
      orderBy: { occurred_at: 'desc' },
    });

    return NextResponse.json({
      cardId: card.id,
      cardNumber: card.card_number,
      customer: { name: card.person?.display_name ?? null },
      card: {
        visitsThisCycle: card.visits_this_cycle,
        visitsRequired,
        pendingRewards: card.pending_rewards,
        balanceMXN: formatMXN(card.balance_cents),
        balanceCentavos: card.balance_cents,
        rewardName,
        visitLimitReached: !!recentVisit,
        lastVisitAt: recentVisit?.occurred_at ?? null,
      },
      birthdayReward: activeBirthdayReward
        ? { id: activeBirthdayReward.id, rewardName: tenant.birthdayRewardName }
        : null,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    console.error('[Preview]', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Error al leer la tarjeta' }, { status: 500 });
  }
}
