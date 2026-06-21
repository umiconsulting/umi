import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getTenant } from '@/lib/tenant';
import { formatMXN } from '@/lib/currency';

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const staff = await requireAuth(['STAFF', 'ADMIN'])(req);
  if (!staff) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  if (staff.tenantId !== tenant.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const [visitsToday, topupsToday, pendingRewards] = await Promise.all([
    prisma.visit_events.count({
      where: { tenant_id: tenant.id, occurred_at: { gte: dayStart } },
    }),
    prisma.wallet_transactions.aggregate({
      where: {
        tenant_id: tenant.id,
        type: 'topup',
        created_at: { gte: dayStart },
      },
      _sum: { amount_cents: true },
      _count: true,
    }),
    prisma.cards.aggregate({
      where: { tenant_id: tenant.id, pending_rewards: { gt: 0 } },
      _sum: { pending_rewards: true },
    }),
  ]);

  return NextResponse.json({
    role: staff.role,
    visitsToday,
    topupsTodayCount: topupsToday._count,
    topupsTodayMXN: formatMXN(topupsToday._sum.amount_cents ?? 0),
    pendingRewards: pendingRewards._sum.pending_rewards ?? 0,
  });
}
