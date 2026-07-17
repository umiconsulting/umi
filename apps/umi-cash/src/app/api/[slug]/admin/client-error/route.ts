import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { getTenant } from '@/lib/tenant';

/**
 * Sink for failures that only the client can see.
 *
 * A scan that commits and then loses its response leaves nothing on the server to
 * find — the request succeeded there. The staff's screen is the only place that
 * knows it went wrong, so it reports here and the line lands in the platform logs
 * next to the request it belongs to.
 *
 * Staff-authenticated on purpose: an open log endpoint is an unmetered write to our
 * logs, and there is no rate limiter in front of it yet.
 */
const ReportSchema = z.object({
  action: z.string().max(40),
  kind: z.enum(['offline', 'unreachable', 'malformed']),
  detail: z.string().max(300),
  online: z.boolean().nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const staff = await requireAuth(['STAFF', 'ADMIN'])(req);
  if (!staff) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });
  if (staff.tenantId !== tenant.id) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const parsed = ReportSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });

  const { action, kind, detail, online } = parsed.data;
  // error level so it surfaces in `vercel logs --level error` without a query.
  console.error('[ClientError]', JSON.stringify({ tenant: params.slug, staff: staff.sub, action, kind, online, detail }));

  return new NextResponse(null, { status: 204 });
}
