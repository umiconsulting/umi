import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, generateRandomToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getStaffMemberId } from '@/lib/identity';
import { formatMXN } from '@/lib/currency';
import { getTenant, requireActiveSubscription } from '@/lib/tenant';
import { sendGiftCardEmail } from '@/lib/email';

const CreateSchema = z.object({
  amountCentavos: z.number().int().min(100, 'El monto mínimo es $1.00'),
  senderName: z.string().max(100).optional(),
  message: z.string().max(300).optional(),
  recipientEmail: z.string().email().optional(),
  recipientPhone: z.string().max(20).optional(),
  recipientName: z.string().max(100).optional(),
}).refine((d) => d.recipientEmail || d.recipientPhone, {
  message: 'Se requiere email o teléfono del destinatario',
});

function generateGiftCode(): string {
  // Format: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX (32 hex chars, uppercase) — 16 bytes / 128 bits of entropy
  const hex = generateRandomToken(16).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 24)}-${hex.slice(24, 28)}-${hex.slice(28, 32)}`;
}

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
    const data = CreateSchema.parse(await req.json());

    const staffMemberId = await getStaffMemberId(tenant.id, staff.sub);

    // Generate a unique code (retry on collision — extremely rare)
    let code: string;
    let attempts = 0;
    do {
      code = generateGiftCode();
      const existing = await prisma.gift_cards.findUnique({ where: { code } });
      if (!existing) break;
      attempts++;
    } while (attempts < 5);

    // Create the gift card and seed its balance via the ledger (+amount).
    const giftCard = await prisma.$transaction(async (tx) => {
      const gc = await tx.gift_cards.create({
        data: {
          tenant_id: tenant.id,
          code: code!,
          amount_cents: data.amountCentavos,
          balance_cents: data.amountCentavos,
          created_by_staff_member_id: staffMemberId,
          sender_name: data.senderName || null,
          message: data.message || null,
          recipient_email: data.recipientEmail || null,
          recipient_phone: data.recipientPhone || null,
          recipient_name: data.recipientName || null,
        },
      });
      await tx.gift_card_ledger.create({
        data: {
          tenant_id: tenant.id,
          gift_card_id: gc.id,
          delta: data.amountCentavos,
          reason: 'issue',
          source_type: 'gift_card',
          source_id: gc.id,
          idempotency_key: `giftissue_${gc.id}`,
        },
      });
      return gc;
    });

    // Send notification via email and/or WhatsApp
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? `https://${req.headers.get('host')}`;
    const redeemUrl = `${appUrl}/${params.slug}/gift/${giftCard.code}`;
    const notifyOpts = {
      recipientName: data.recipientName ?? null,
      senderName: data.senderName ?? null,
      tenantName: tenant.name,
      amountMXN: formatMXN(data.amountCentavos),
      message: data.message ?? null,
      redeemUrl,
      brandColor: tenant.primaryColor,
    };

    if (data.recipientEmail) {
      sendGiftCardEmail({ to: data.recipientEmail, ...notifyOpts })
        .catch((err) => console.warn('[GiftCard:email]', err));
    }

    return NextResponse.json({
      success: true,
      giftCard: {
        id: giftCard.id,
        code: giftCard.code,
        amountMXN: formatMXN(giftCard.amount_cents),
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Datos inválidos' }, { status: 400 });
    }
    console.error('[GiftCard:create]', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Error al crear tarjeta de regalo' }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const staff = await requireAuth(['STAFF', 'ADMIN'])(req);
  if (!staff) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  if (staff.tenantId !== tenant.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const url = new URL(req.url);
  // `?? '1'` only guards null; `|| 1` also catches a non-numeric param (parseInt →
  // NaN) so `skip: NaN` can't throw a PrismaClientValidationError (bare 500).
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1') || 1);
  const limit = 20;

  const [giftCards, total] = await Promise.all([
    prisma.gift_cards.findMany({
      where: { tenant_id: tenant.id },
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.gift_cards.count({ where: { tenant_id: tenant.id } }),
  ]);

  return NextResponse.json({
    giftCards: giftCards.map((g) => ({
      id: g.id,
      code: g.code,
      amountMXN: formatMXN(g.amount_cents),
      amountCentavos: g.amount_cents,
      senderName: g.sender_name,
      recipientName: g.recipient_name,
      recipientEmail: g.recipient_email,
      recipientPhone: g.recipient_phone,
      message: g.message,
      // isRedeemed is DERIVED — redeemed_at != null.
      isRedeemed: g.redeemed_at != null,
      redeemedAt: g.redeemed_at?.toISOString() ?? null,
      createdAt: g.created_at.toISOString(),
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
}
