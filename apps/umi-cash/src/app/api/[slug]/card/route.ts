import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { formatMXN } from '@/lib/currency';
import { getActiveRewardConfig, rewardConfigDefaults } from '@/lib/prisma-helpers';
import { getTenant } from '@/lib/tenant';

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const user = await requireAuth()(req);
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  // Verify token's tenantId matches this slug
  if (user.tenantId !== tenant.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  // CUSTOMER session subject is the person id. Reach the card via person → account → card.
  const [card, rewardConfig, person] = await Promise.all([
    prisma.cards.findFirst({
      where: { tenant_id: tenant.id, accounts: { person_id: user.sub } },
      include: {
        visit_events: { orderBy: { occurred_at: 'desc' }, take: 5 },
        wallet_transactions: { orderBy: { created_at: 'desc' }, take: 5 },
      },
    }),
    getActiveRewardConfig(tenant.id),
    prisma.people.findUnique({ where: { id: user.sub } }),
  ]);

  if (!card) return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });

  const { visitsRequired, rewardName, rewardDescription } = rewardConfigDefaults(rewardConfig);
  const progressPercent = Math.min(Math.round((card.visits_this_cycle / visitsRequired) * 100), 100);

  return NextResponse.json({
    cardId: card.id,
    cardNumber: card.card_number,
    customerName: person?.display_name ?? null,
    tenantName: tenant.name,
    balanceCentavos: card.balance_cents,
    balanceMXN: formatMXN(card.balance_cents),
    totalVisits: card.total_visits,
    visitsThisCycle: card.visits_this_cycle,
    visitsRequired,
    pendingRewards: card.pending_rewards,
    rewardName,
    rewardDescription,
    progressPercent,
    recentVisits: card.visit_events.map((v) => ({ id: v.id, scannedAt: v.occurred_at.toISOString() })),
    recentTransactions: card.wallet_transactions.map((t) => ({
      id: t.id, type: t.type, amountCentavos: t.amount_cents,
      description: t.description, createdAt: t.created_at.toISOString(),
    })),
  });
}
