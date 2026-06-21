import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, signQRPayload } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateQRDataURL, generateQRBuffer } from '@/lib/qr';
import { getTenant } from '@/lib/tenant';

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  if (user.tenantId !== tenant.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  // CUSTOMER session subject is the person id. Reach the card via person → account → card.
  const card = await prisma.cards.findFirst({
    where: { tenant_id: tenant.id, accounts: { person_id: user.sub } },
  });
  if (!card) return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });

  const format = req.nextUrl.searchParams.get('format') || 'json';
  const qrPayload = await signQRPayload(card.id, card.qr_token ?? '');

  if (format === 'png') {
    const buffer = await generateQRBuffer(qrPayload);
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    });
  }

  const dataUrl = await generateQRDataURL(qrPayload);
  return NextResponse.json({
    payload: qrPayload,
    dataUrl,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
