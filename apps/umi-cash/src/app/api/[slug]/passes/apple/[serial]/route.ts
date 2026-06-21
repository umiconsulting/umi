import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateApplePass, isAppleWalletConfigured } from '@/lib/pass-apple';
import { getActiveRewardConfig, rewardConfigDefaults } from '@/lib/prisma-helpers';
import { DEFAULT_CUSTOMER_NAME } from '@/lib/constants';
import { getTenant, getActivePromo } from '@/lib/tenant';

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string; serial: string } }
) {
  if (!isAppleWalletConfigured()) return new NextResponse(null, { status: 503 });

  const authToken = req.headers.get('authorization')?.replace('ApplePass ', '');
  if (!authToken) return new NextResponse(null, { status: 401 });

  // Pass identity is on loyalty.passes (provider='apple'); load the card via relation.
  const pass = await prisma.passes.findFirst({
    where: { provider: 'apple', serial_number: params.serial, auth_token: authToken },
    include: { cards: { include: { accounts: { include: { people: { select: { display_name: true } } } } } } },
  });
  if (!pass || !pass.cards) return new NextResponse(null, { status: 401 });
  const card = pass.cards;

  const ifModifiedSince = req.headers.get('if-modified-since');
  if (ifModifiedSince && card.updated_at <= new Date(ifModifiedSince)) {
    return new NextResponse(null, { status: 304 });
  }

  const tenant = await getTenant(params.slug);
  if (!tenant) return new NextResponse(null, { status: 404 });

  const [rewardConfig, locations, activeBirthdayReward] = await Promise.all([
    getActiveRewardConfig(card.tenant_id),
    prisma.locations.findMany({ where: { tenant_id: tenant.id, status: 'active', lat: { not: null }, lng: { not: null } } }),
    prisma.birthday_rewards.findFirst({
      where: { loyalty_card_id: card.id, status: 'active', expires_at: { gte: new Date() } },
    }),
  ]);
  const { visitsRequired, rewardName } = rewardConfigDefaults(rewardConfig);
  const customerName = card.accounts?.people?.display_name || DEFAULT_CUSTOMER_NAME;
  const cardMeta = (card.metadata as Record<string, unknown>) ?? {};
  const lifecycleMessage = (cardMeta.lifecycle_message as string) ?? null;

  try {
    const { buffer } = await generateApplePass({
      cardId: card.id,
      cardNumber: card.card_number,
      customerName,
      balanceCentavos: card.balance_cents,
      visitsThisCycle: card.visits_this_cycle,
      visitsRequired,
      pendingRewards: card.pending_rewards,
      rewardName,
      totalVisits: card.total_visits,
      serial: pass.serial_number ?? undefined,
      authToken: pass.auth_token ?? undefined,
      tenantName: tenant.name,
      tenantSlug: params.slug,
      primaryColor: tenant.primaryColor,
      secondaryColor: tenant.secondaryColor,
      logoUrl: tenant.logoUrl,
      stripImageUrl: tenant.stripImageUrl,
      passStyle: tenant.passStyle,
      promoMessage: getActivePromo(tenant),
      lifecycleMessage,
      birthdayRewardName: activeBirthdayReward ? tenant.birthdayRewardName : null,
      locations: locations.map((l) => ({ latitude: l.lat!, longitude: l.lng!, relevantText: `¡Bienvenido a ${tenant.name}!` })),
      topupEnabled: tenant.topupEnabled,
    });

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.apple.pkpass',
        'Last-Modified': card.updated_at.toUTCString(),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[Apple Pass Update]', err instanceof Error ? err.message : String(err));
    return new NextResponse(null, { status: 500 });
  }
}
