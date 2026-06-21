import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { formatMXN } from '@/lib/currency';
import { getActiveRewardConfig, rewardConfigDefaults } from '@/lib/prisma-helpers';
import { getTenant } from '@/lib/tenant';

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string; id: string } }
) {
  const user = await requireAuth(['STAFF', 'ADMIN'])(req);
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  if (user.tenantId !== tenant.id) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  // The customer id is a core.people id. Reach the card via account → card.
  const [person, rewardConfig] = await Promise.all([
    prisma.people.findFirst({ where: { id: params.id, tenant_id: tenant.id } }),
    getActiveRewardConfig(tenant.id),
  ]);

  if (!person) {
    return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
  }

  const account = await prisma.accounts.findFirst({
    where: { tenant_id: tenant.id, person_id: person.id },
    select: { id: true },
  });
  const card = account
    ? await prisma.cards.findFirst({
        where: { tenant_id: tenant.id, account_id: account.id },
        orderBy: { created_at: 'desc' },
      })
    : null;

  if (!card) {
    return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
  }

  const { visitsRequired } = rewardConfigDefaults(rewardConfig);

  const [recentVisits, recentTransactions, ltvAgg, topupAgg] = await Promise.all([
    prisma.visit_events.findMany({
      where: { tenant_id: tenant.id, loyalty_card_id: card.id },
      orderBy: { occurred_at: 'desc' },
      take: 10,
    }),
    prisma.wallet_transactions.findMany({
      where: { tenant_id: tenant.id, loyalty_card_id: card.id },
      orderBy: { created_at: 'desc' },
      take: 10,
    }),
    // LTV = sum of all purchase transactions (negative amounts = money spent at the store)
    prisma.wallet_transactions.aggregate({
      where: { tenant_id: tenant.id, loyalty_card_id: card.id, type: 'purchase' },
      _sum: { amount_cents: true },
    }),
    // Total topped up = sum of all topup transactions
    prisma.wallet_transactions.aggregate({
      where: { tenant_id: tenant.id, loyalty_card_id: card.id, type: 'topup' },
      _sum: { amount_cents: true },
    }),
  ]);

  const ltvCentavos = Math.abs(ltvAgg._sum.amount_cents ?? 0);
  const totalTopupCentavos = topupAgg._sum.amount_cents ?? 0;
  const meta = (person.metadata ?? {}) as Record<string, unknown>;

  return NextResponse.json({
    id: person.id,
    name: person.display_name,
    phone: person.normalized_phone,
    email: person.normalized_email,
    device: (meta.device as string) ?? null,
    os: (meta.os as string) ?? null,
    birthDate: person.birth_date?.toISOString().split('T')[0] ?? null,
    cardNumber: card.card_number, cardId: card.id,
    balanceMXN: formatMXN(card.balance_cents), balanceCentavos: card.balance_cents,
    totalVisits: card.total_visits, visitsThisCycle: card.visits_this_cycle,
    visitsRequired, pendingRewards: card.pending_rewards,
    lastVisit: recentVisits[0]?.occurred_at?.toISOString() ?? null,
    createdAt: (person.created_at ?? card.created_at).toISOString(),
    ltvCentavos, ltvMXN: formatMXN(ltvCentavos),
    totalTopupCentavos, totalTopupMXN: formatMXN(totalTopupCentavos),
    recentVisits: recentVisits.map((v) => ({ id: v.id, scannedAt: v.occurred_at.toISOString() })),
    recentTransactions: recentTransactions.map((t) => ({
      id: t.id, type: t.type, amountCentavos: t.amount_cents,
      description: t.description, createdAt: t.created_at.toISOString(),
    })),
  });
}
