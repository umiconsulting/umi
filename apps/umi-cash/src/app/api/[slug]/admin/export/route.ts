import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { formatMXN } from '@/lib/currency';
import { getTenant } from '@/lib/tenant';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const staff = await requireAuth(['STAFF', 'ADMIN'])(req);
  if (!staff) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  // Rate limit: 10 exports per hour per staff member
  const rl = rateLimit(`export:${staff.sub}`, 10, 60 * 60 * 1000);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  if (staff.tenantId !== tenant.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  // One row per card; the customer is reached via account → person.
  const cards = await prisma.cards.findMany({
    where: { tenant_id: tenant.id },
    include: {
      accounts: { include: { people: true } },
      _count: { select: { visit_events: true } },
    },
    orderBy: { created_at: 'desc' },
  });

  const headers = ['Nombre', 'Teléfono', 'Email', 'Tarjeta', 'Saldo MXN', 'Visitas totales', 'Visitas ciclo', 'Recompensas pendientes', 'Registrado'];

  function escapeCsv(value: string | null | undefined): string {
    const str = value ?? '';
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  const rows = cards.map((c) => {
    const person = c.accounts?.people ?? null;
    return [
      escapeCsv(person?.display_name),
      escapeCsv(person?.normalized_phone),
      escapeCsv(person?.normalized_email),
      escapeCsv(c.card_number),
      escapeCsv(formatMXN(c.balance_cents)),
      String(c._count?.visit_events ?? 0),
      String(c.visits_this_cycle ?? 0),
      String(c.pending_rewards ?? 0),
      escapeCsv((person?.created_at ?? c.created_at).toLocaleDateString('es-MX')),
    ].join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');

  const date = new Date().toISOString().slice(0, 10);
  const filename = `clientes-${params.slug}-${date}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
