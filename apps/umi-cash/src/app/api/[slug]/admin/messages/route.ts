import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getTenant } from '@/lib/tenant';
import type { Prisma } from '@prisma/client';

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const user = await requireAuth(['ADMIN'])(req);
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });
  if (user.tenantId !== tenant.id) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const url = req.nextUrl;
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1') || 1);
  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '50') || 50, 200));
  const journey = url.searchParams.get('journey')?.trim() || null;
  const skip = (page - 1) * limit;

  // lifecycle_sends carry tenant_id directly; scope on it.
  const where: Prisma.lifecycle_sendsWhereInput = {
    tenant_id: tenant.id,
    ...(journey ? { journey } : {}),
  };

  const [events, total, journeyCounts] = await Promise.all([
    prisma.lifecycle_sends.findMany({
      where,
      orderBy: { sent_at: 'desc' },
      skip,
      take: limit,
      include: {
        cards: {
          select: {
            id: true,
            card_number: true,
            accounts: { include: { people: { select: { display_name: true, normalized_phone: true } } } },
          },
        },
      },
    }),
    prisma.lifecycle_sends.count({ where }),
    prisma.lifecycle_sends.groupBy({
      by: ['journey'],
      where: { tenant_id: tenant.id },
      _count: { _all: true },
    }),
  ]);

  return NextResponse.json({
    page,
    limit,
    total,
    counts: Object.fromEntries(journeyCounts.map((g) => [g.journey, g._count._all])),
    events: events.map((e) => {
      const person = e.cards?.accounts?.people ?? null;
      return {
        id: e.id,
        journey: e.journey,
        body: e.body,
        sentAt: e.sent_at.toISOString(),
        customer: {
          cardId: e.cards.id,
          cardNumber: e.cards.card_number,
          name: person?.display_name ?? null,
          phone: person?.normalized_phone ?? null,
        },
      };
    }),
  });
}
