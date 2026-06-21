import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateApplePass, isAppleWalletConfigured } from '@/lib/pass-apple';
import { getActiveRewardConfig, rewardConfigDefaults } from '@/lib/prisma-helpers';
import { getActivePromo } from '@/lib/tenant';
import { DEFAULT_CUSTOMER_NAME } from '@/lib/constants';
import { getTenant } from '@/lib/tenant';

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const user = await requireAuth()(req);
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const tenant = await getTenant(params.slug);
    if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

    if (user.tenantId !== tenant.id) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    if (!isAppleWalletConfigured()) {
      return NextResponse.json({
        error: 'Apple Wallet no está configurado.',
        configured: false,
      }, { status: 503 });
    }

    // CUSTOMER session subject is a core.people id → resolve the card via account.
    const [card, rewardConfig, locations] = await Promise.all([
      prisma.cards.findFirst({
        where: { tenant_id: tenant.id, accounts: { person_id: user.sub } },
        include: { accounts: { include: { people: true } } },
      }),
      getActiveRewardConfig(tenant.id),
      prisma.locations.findMany({ where: { tenant_id: tenant.id, status: 'active', lat: { not: null }, lng: { not: null } } }),
    ]);

    if (!card) return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });

    const { visitsRequired, rewardName } = rewardConfigDefaults(rewardConfig);
    const customerName = card.accounts?.people?.display_name || DEFAULT_CUSTOMER_NAME;
    const cardMeta = (card.metadata as Record<string, unknown>) ?? {};
    const lifecycleMessage = (cardMeta.lifecycle_message as string) ?? null;

    // Apple pass identity lives on loyalty.passes (provider='apple'). Migrated cards
    // already have a row (never regenerate); brand-new passes get fresh values.
    const existingPass = await prisma.passes.findFirst({
      where: { tenant_id: tenant.id, loyalty_card_id: card.id, provider: 'apple' },
    });

    const { buffer, serial, authToken } = await generateApplePass({
      cardId: card.id,
      cardNumber: card.card_number,
      customerName,
      balanceCentavos: card.balance_cents,
      visitsThisCycle: card.visits_this_cycle,
      visitsRequired,
      pendingRewards: card.pending_rewards,
      rewardName,
      totalVisits: card.total_visits,
      serial: existingPass?.serial_number ?? undefined,
      authToken: existingPass?.auth_token ?? undefined,
      tenantName: tenant.name,
      tenantSlug: params.slug,
      primaryColor: tenant.primaryColor,
      secondaryColor: tenant.secondaryColor,
      logoUrl: tenant.logoUrl,
      stripImageUrl: tenant.stripImageUrl,
      passStyle: tenant.passStyle,
      promoMessage: getActivePromo(tenant),
      lifecycleMessage,
      locations: locations.map((l) => ({ latitude: l.lat!, longitude: l.lng!, relevantText: `¡Bienvenido a ${tenant.name}!` })),
      topupEnabled: tenant.topupEnabled,
    });

    if (!existingPass) {
      await prisma.passes.create({
        data: {
          tenant_id: tenant.id,
          loyalty_card_id: card.id,
          provider: 'apple',
          serial_number: serial,
          auth_token: authToken,
        },
      });
    }

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': `inline; filename="${params.slug}.pkpass"`,
        'Cache-Control': 'no-store',
        'Content-Security-Policy': '',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Apple Pass]', msg);
    return NextResponse.json({ error: 'Error generando pase' }, { status: 500 });
  }
}
