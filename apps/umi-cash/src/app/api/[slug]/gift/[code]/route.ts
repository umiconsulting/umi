import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { formatMXN } from '@/lib/currency';
import { getTenant } from '@/lib/tenant';
import { getActiveRewardConfig, rewardConfigDefaults } from '@/lib/prisma-helpers';
import { applyWalletDelta } from '@/lib/wallet';
import { findPersonByPhone, findPersonByEmail } from '@/lib/identity';
import { sendApplePushUpdate } from '@/lib/push-apple';
import { updateGoogleWalletObject } from '@/lib/pass-google';
import { DEFAULT_CUSTOMER_NAME } from '@/lib/constants';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

// GET — fetch gift card info (public but minimal — only shows if valid and redeemed status)
export async function GET(req: NextRequest, { params }: { params: { slug: string; code: string } }) {
  // Rate limit lookups to prevent code enumeration — per-IP + per-code
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = rateLimit(`gift-lookup:${ip}`, 10, 15 * 60 * 1000);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);
  const codeRl = rateLimit(`gift-code:${params.code.toUpperCase()}`, 5, 15 * 60 * 1000);
  if (!codeRl.allowed) return rateLimitResponse(codeRl.resetAt);

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  const giftCard = await prisma.gift_cards.findFirst({
    where: { code: params.code.toUpperCase(), tenant_id: tenant.id },
  });

  if (!giftCard) return NextResponse.json({ error: 'Código no válido' }, { status: 404 });

  // Only expose minimal info — don't leak amount/sender to unauthenticated users.
  // isRedeemed is derived from redeemed_at on the canonical schema.
  return NextResponse.json({
    code: giftCard.code,
    isRedeemed: giftCard.redeemed_at !== null,
    tenantName: tenant.name,
    hasMessage: !!giftCard.message,
  });
}

const RedeemSchema = z.object({
  // The customer identifies themselves by phone or email to find their card
  phone: z.string().optional(),
  email: z.string().email().optional(),
}).refine((d) => d.phone || d.email, {
  message: 'Se requiere teléfono o email para identificarte',
});

// POST — redeem gift card
export async function POST(req: NextRequest, { params }: { params: { slug: string; code: string } }) {
  // Rate limit redemption — per-IP + per-code
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = rateLimit(`gift-redeem:${ip}`, 5, 15 * 60 * 1000);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);
  const codeRl = rateLimit(`gift-redeem-code:${params.code.toUpperCase()}`, 3, 15 * 60 * 1000);
  if (!codeRl.allowed) return rateLimitResponse(codeRl.resetAt);

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  try {
    const { phone, email } = RedeemSchema.parse(await req.json());

    const giftCard = await prisma.gift_cards.findFirst({
      where: { code: params.code.toUpperCase(), tenant_id: tenant.id },
    });

    if (!giftCard) return NextResponse.json({ error: 'Código no válido' }, { status: 404 });
    if (giftCard.redeemed_at !== null) {
      return NextResponse.json({ error: 'Esta tarjeta de regalo ya fue canjeada' }, { status: 400 });
    }
    if (giftCard.expires_at && giftCard.expires_at < new Date()) {
      return NextResponse.json({ error: 'Esta tarjeta de regalo ha expirado' }, { status: 400 });
    }

    // Find the customer's person (by normalized phone or email), then their card via account.
    const person = phone
      ? await findPersonByPhone(tenant.id, phone)
      : await findPersonByEmail(tenant.id, email!);

    const card = person
      ? await prisma.cards.findFirst({
          where: { tenant_id: tenant.id, accounts: { person_id: person.id } },
        })
      : null;

    if (!person || !card) {
      return NextResponse.json({
        error: 'No encontramos una tarjeta de lealtad con ese teléfono/email. Regístrate primero.',
        needsRegistration: true,
      }, { status: 404 });
    }

    // Redeem atomically: mark the gift card redeemed, debit its ledger, and credit the
    // wallet via applyWalletDelta (the single money write path).
    const { balanceCents } = await prisma.$transaction(async (tx) => {
      await tx.gift_cards.update({
        where: { id: giftCard.id },
        data: {
          redeemed_at: new Date(),
          redeemed_loyalty_card_id: card.id,
        },
      });

      await tx.gift_card_ledger.create({
        data: {
          tenant_id: tenant.id,
          gift_card_id: giftCard.id,
          delta: -giftCard.amount_cents,
          reason: 'gift_card_redeem',
          source_type: 'loyalty_card',
          source_id: card.id,
          idempotency_key: `giftledger_${giftCard.id}`,
        },
      });

      return applyWalletDelta(tx, {
        tenantId: tenant.id,
        cardId: card.id,
        deltaCents: giftCard.amount_cents,
        type: 'gift_card_redeem',
        description: giftCard.sender_name
          ? `Tarjeta de regalo de ${giftCard.sender_name}`
          : 'Tarjeta de regalo',
        idempotencyKey: `giftredeem_${giftCard.id}`,
        sourceType: 'gift_card',
        sourceId: giftCard.id,
      });
    });

    // Update wallet passes
    const rewardConfig = await getActiveRewardConfig(tenant.id);
    const { visitsRequired, rewardName } = rewardConfigDefaults(rewardConfig);
    // Await push inline — waitUntil + http2 is unreliable on Vercel
    await Promise.all([
      sendApplePushUpdate(card.id),
      updateGoogleWalletObject({
        cardId: card.id,
        cardNumber: card.card_number,
        customerName: person.display_name || DEFAULT_CUSTOMER_NAME,
        balanceCentavos: balanceCents,
        visitsThisCycle: card.visits_this_cycle,
        visitsRequired,
        pendingRewards: card.pending_rewards,
        rewardName,
        totalVisits: card.total_visits,
        memberSince: card.created_at.toISOString(),
        tenantName: tenant.name,
        tenantSlug: params.slug,
        primaryColor: tenant.primaryColor,
      }),
    ]).catch((err) => console.warn('[GiftCard:walletUpdate]', err));

    return NextResponse.json({
      success: true,
      amountMXN: formatMXN(giftCard.amount_cents),
      newBalanceMXN: formatMXN(balanceCents),
      customerName: person.display_name,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Datos inválidos' }, { status: 400 });
    }
    console.error('[GiftCard:redeem]', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Error al canjear' }, { status: 500 });
  }
}
