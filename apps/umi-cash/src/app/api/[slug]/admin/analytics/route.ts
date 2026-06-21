import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getTenant } from '@/lib/tenant';
import { formatMXN } from '@/lib/currency';
import { getActiveRewardConfig, rewardConfigDefaults } from '@/lib/prisma-helpers';

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const staff = await requireAuth(['STAFF', 'ADMIN'])(req);
  if (!staff) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  if (staff.tenantId !== tenant.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const now = new Date();

  // 30 days ago
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  thirtyDaysAgo.setHours(0, 0, 0, 0);

  // 8 weeks ago
  const eightWeeksAgo = new Date(now);
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);
  eightWeeksAgo.setHours(0, 0, 0, 0);

  // Start of this month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    recentVisits,
    topCards,
    recentPeople,
    allCards,
    topupsThisMonth,
    rewardsThisMonth,
    activeCustomersLast30,
    totalCustomers,
    totalPurchasesAgg,
    totalVisitsAgg,
    activeRewardConfig,
  ] = await Promise.all([
    // All visits in last 30 days
    prisma.visit_events.findMany({
      where: { tenant_id: tenant.id, occurred_at: { gte: thirtyDaysAgo } },
      select: { occurred_at: true },
    }),

    // Top 10 cards by total_visits
    prisma.cards.findMany({
      where: { tenant_id: tenant.id },
      orderBy: { total_visits: 'desc' },
      take: 10,
      include: { accounts: { include: { people: { select: { id: true, display_name: true } } } } },
    }),

    // Customers created in last 8 weeks
    prisma.people.findMany({
      where: { tenant_id: tenant.id, created_at: { gte: eightWeeksAgo } },
      select: { created_at: true },
    }),

    // All cards for balance sum
    prisma.cards.findMany({
      where: { tenant_id: tenant.id },
      select: { balance_cents: true },
    }),

    // Topups this month
    prisma.wallet_transactions.aggregate({
      where: {
        tenant_id: tenant.id,
        type: 'topup',
        created_at: { gte: monthStart },
      },
      _sum: { amount_cents: true },
    }),

    // Reward redemptions this month
    prisma.reward_redemptions.count({
      where: { tenant_id: tenant.id, redeemed_at: { gte: monthStart } },
    }),

    // Distinct customers who had a visit in last 30 days
    prisma.visit_events.findMany({
      where: { tenant_id: tenant.id, occurred_at: { gte: thirtyDaysAgo } },
      select: { loyalty_card_id: true },
      distinct: ['loyalty_card_id'],
    }),

    // Total customer count
    prisma.people.count({ where: { tenant_id: tenant.id } }),

    // Total purchase amount (all time) for LTV / avg ticket
    prisma.wallet_transactions.aggregate({
      where: { tenant_id: tenant.id, type: 'purchase' },
      _sum: { amount_cents: true },
    }),

    // Total visits (all time) for avg ticket calculation
    prisma.cards.aggregate({
      where: { tenant_id: tenant.id },
      _sum: { total_visits: true },
    }),

    // Active reward config for cost
    getActiveRewardConfig(tenant.id),
  ]);

  // --- visitsByDay: group by date string ---
  const visitCountByDay: Record<string, number> = {};
  for (const v of recentVisits) {
    const dateStr = v.occurred_at.toISOString().slice(0, 10);
    visitCountByDay[dateStr] = (visitCountByDay[dateStr] ?? 0) + 1;
  }

  // Fill in all 30 days (including zero-count days)
  const visitsByDay: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    visitsByDay.push({ date: dateStr, count: visitCountByDay[dateStr] ?? 0 });
  }

  // --- topCustomers ---
  const topCustomers = topCards.map((card) => ({
    id: card.accounts?.people?.id ?? '',
    name: card.accounts?.people?.display_name ?? 'Sin nombre',
    cardNumber: card.card_number,
    totalVisits: card.total_visits,
    balanceMXN: formatMXN(card.balance_cents),
  }));

  // --- newCustomersByWeek: group by ISO week start (Monday) ---
  const SPANISH_MONTH_ABBR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  // Build week buckets: last 8 weeks, each week starts on Monday
  // Find the Monday of the current week
  const todayDow = now.getDay(); // 0=Sun,1=Mon,...,6=Sat
  const daysToMonday = todayDow === 0 ? 6 : todayDow - 1;
  const thisWeekMonday = new Date(now);
  thisWeekMonday.setDate(now.getDate() - daysToMonday);
  thisWeekMonday.setHours(0, 0, 0, 0);

  const weekBuckets: { weekStart: Date; label: string }[] = [];
  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(thisWeekMonday);
    weekStart.setDate(thisWeekMonday.getDate() - i * 7);
    const label = `${SPANISH_MONTH_ABBR[weekStart.getMonth()]} ${weekStart.getDate()}`;
    weekBuckets.push({ weekStart, label });
  }

  const newCustomersByWeek: { week: string; count: number }[] = weekBuckets.map(({ weekStart, label }, idx) => {
    const nextWeekStart = idx < weekBuckets.length - 1 ? weekBuckets[idx + 1].weekStart : new Date(now.getTime() + 86400000);
    const count = recentPeople.filter(
      (u) => u.created_at >= weekStart && u.created_at < nextWeekStart
    ).length;
    return { week: label, count };
  });

  // --- totalBalance ---
  const totalBalanceCentavos = allCards.reduce((sum, c) => sum + c.balance_cents, 0);

  // For avg we need all cards' total_visits — query separately
  const allVisitsSums = await prisma.cards.aggregate({
    where: { tenant_id: tenant.id },
    _sum: { total_visits: true },
  });
  const trueAvg =
    totalCustomers > 0
      ? Math.round(((allVisitsSums._sum.total_visits ?? 0) / totalCustomers) * 10) / 10
      : 0;

  // --- retentionRate ---
  const retentionRate =
    totalCustomers > 0
      ? Math.round((activeCustomersLast30.length / totalCustomers) * 100)
      : 0;

  // --- profitability ---
  const totalRevenueCentavos = Math.abs(totalPurchasesAgg._sum.amount_cents ?? 0);
  const totalAllTimeVisits = totalVisitsAgg._sum.total_visits ?? 0;
  const avgTicketCentavos = totalAllTimeVisits > 0 ? Math.round(totalRevenueCentavos / totalAllTimeVisits) : 0;
  const { visitsRequired } = rewardConfigDefaults(activeRewardConfig);
  const rewardCostCentavos = activeRewardConfig?.reward_cost_cents ?? 0;
  const revenuePerCycleCentavos = avgTicketCentavos * visitsRequired;
  const marginPerCycleCentavos = revenuePerCycleCentavos - rewardCostCentavos;
  const marginPercent = revenuePerCycleCentavos > 0 ? Math.round((marginPerCycleCentavos / revenuePerCycleCentavos) * 100) : null;

  return NextResponse.json({
    visitsByDay,
    topCustomers,
    newCustomersByWeek,
    totalBalance: formatMXN(totalBalanceCentavos),
    topupsThisMonth: formatMXN(topupsThisMonth._sum.amount_cents ?? 0),
    rewardsRedeemedThisMonth: rewardsThisMonth,
    avgVisitsPerCustomer: trueAvg,
    retentionRate,
    profitability: {
      avgTicketMXN: formatMXN(avgTicketCentavos),
      revenuePerCycleMXN: formatMXN(revenuePerCycleCentavos),
      rewardCostMXN: formatMXN(rewardCostCentavos),
      marginPerCycleMXN: formatMXN(marginPerCycleCentavos),
      marginPercent,
      visitsRequired,
      rewardCostConfigured: rewardCostCentavos > 0,
    },
  });
}
