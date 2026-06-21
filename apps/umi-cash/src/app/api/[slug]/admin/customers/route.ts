import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { formatMXN } from '@/lib/currency';
import { getTenant } from '@/lib/tenant';
import type { Prisma } from '@prisma/client';

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const user = await requireAuth(['STAFF', 'ADMIN'])(req);
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  if (user.tenantId !== tenant.id) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const url = req.nextUrl;
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1') || 1);
  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '20') || 20, 100));
  const search = (url.searchParams.get('search') || '').trim().slice(0, 50);
  const sort = url.searchParams.get('sort') || 'recent';
  const skip = (page - 1) * limit;

  // Customers are reached card-first: cards → account → person. Each card is a customer row.
  const where: Prisma.cardsWhereInput = {
    tenant_id: tenant.id,
    ...(search
      ? {
          OR: [
            { card_number: { contains: search } },
            { accounts: { people: { display_name: { contains: search, mode: 'insensitive' } } } },
            { accounts: { people: { normalized_phone: { contains: search } } } },
            { accounts: { people: { normalized_email: { contains: search } } } },
          ],
        }
      : {}),
  };

  const cardInclude = {
    accounts: { include: { people: true } },
    visit_events: { orderBy: { occurred_at: 'desc' as const }, take: 1 },
    wallet_transactions: { where: { type: 'purchase' as const }, select: { amount_cents: true } },
  };

  type CardRow = Prisma.cardsGetPayload<{ include: typeof cardInclude }>;

  function toCustomer(c: CardRow) {
    const person = c.accounts?.people ?? null;
    const ltvCentavos = (c.wallet_transactions ?? []).reduce((sum, t) => sum + Math.abs(t.amount_cents), 0);
    return {
      id: person?.id ?? '',
      name: person?.display_name ?? null,
      phone: person?.normalized_phone ?? null,
      email: person?.normalized_email ?? null,
      device: (person?.metadata as Record<string, unknown> | null)?.device ?? null,
      os: (person?.metadata as Record<string, unknown> | null)?.os ?? null,
      cardNumber: c.card_number,
      cardId: c.id,
      balanceMXN: formatMXN(c.balance_cents),
      balanceCentavos: c.balance_cents,
      totalVisits: c.total_visits,
      visitsThisCycle: c.visits_this_cycle,
      pendingRewards: c.pending_rewards,
      lastVisit: c.visit_events[0]?.occurred_at?.toISOString() ?? null,
      createdAt: (person?.created_at ?? c.created_at).toISOString(),
      ltvCentavos,
      ltvMXN: formatMXN(ltvCentavos),
    };
  }

  // Sorts that require fetching all records and sorting in JS
  if (sort === 'inactive' || sort === 'ltv') {
    const [allCards, total] = await Promise.all([
      prisma.cards.findMany({ where, include: cardInclude }),
      prisma.cards.count({ where }),
    ]);

    if (sort === 'inactive') {
      allCards.sort((a, b) => {
        const aDate = a.visit_events[0]?.occurred_at ?? null;
        const bDate = b.visit_events[0]?.occurred_at ?? null;
        if (!aDate && !bDate) return 0;
        if (!aDate) return -1;
        if (!bDate) return 1;
        return aDate.getTime() - bDate.getTime();
      });
    } else {
      // ltv: highest spenders first
      allCards.sort((a, b) => {
        const aLtv = (a.wallet_transactions ?? []).reduce((s, t) => s + Math.abs(t.amount_cents), 0);
        const bLtv = (b.wallet_transactions ?? []).reduce((s, t) => s + Math.abs(t.amount_cents), 0);
        return bLtv - aLtv;
      });
    }

    const customers = allCards.slice(skip, skip + limit).map(toCustomer);
    return NextResponse.json({ customers, total, page, totalPages: Math.ceil(total / limit) });
  }

  const orderBy: Prisma.cardsOrderByWithRelationInput =
    sort === 'visits' ? { total_visits: 'desc' }
    : sort === 'balance' ? { balance_cents: 'desc' }
    : { created_at: 'desc' };

  const [cards, total] = await Promise.all([
    prisma.cards.findMany({ where, include: cardInclude, orderBy, skip, take: limit }),
    prisma.cards.count({ where }),
  ]);

  return NextResponse.json({ customers: cards.map(toCustomer), total, page, totalPages: Math.ceil(total / limit) });
}
