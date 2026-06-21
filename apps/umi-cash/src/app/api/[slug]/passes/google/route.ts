import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateGoogleWalletURL, isGoogleWalletConfigured } from '@/lib/pass-google';
import { getActiveRewardConfig, rewardConfigDefaults } from '@/lib/prisma-helpers';
import { logError } from '@/lib/log';
import { DEFAULT_CUSTOMER_NAME } from '@/lib/constants';
import { getTenant } from '@/lib/tenant';

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const user = await requireAuth()(req);
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  if (user.tenantId !== tenant.id) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  if (!isGoogleWalletConfigured()) {
    return NextResponse.json({
      error: 'Google Wallet no está configurado.',
      configured: false,
    }, { status: 503 });
  }

  // CUSTOMER session subject is a core.people id → resolve the card via account.
  const card = await prisma.cards.findFirst({
    where: { tenant_id: tenant.id, accounts: { person_id: user.sub } },
    include: { accounts: { include: { people: { select: { display_name: true } } } } },
  });
  if (!card) return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });

  const [rewardConfig, activeBirthdayReward, existingPass] = await Promise.all([
    getActiveRewardConfig(tenant.id),
    prisma.birthday_rewards.findFirst({
      where: { loyalty_card_id: card.id, status: 'active', expires_at: { gte: new Date() } },
    }),
    prisma.passes.findFirst({
      where: { tenant_id: tenant.id, loyalty_card_id: card.id, provider: 'google' },
    }),
  ]);

  const { visitsRequired, rewardName } = rewardConfigDefaults(rewardConfig);
  const customerName = card.accounts?.people?.display_name || DEFAULT_CUSTOMER_NAME;
  const cardMeta = (card.metadata as Record<string, unknown>) ?? {};
  const lifecycleMessage = (cardMeta.lifecycle_message as string) ?? null;

  try {
    const saveUrl = await generateGoogleWalletURL({
      cardId: card.id,
      cardNumber: card.card_number,
      customerName,
      balanceCentavos: card.balance_cents,
      visitsThisCycle: card.visits_this_cycle,
      visitsRequired,
      pendingRewards: card.pending_rewards,
      rewardName,
      totalVisits: card.total_visits,
      memberSince: card.created_at.toISOString(),
      tenantName: tenant.name,
      tenantSlug: params.slug,
      primaryColor: tenant.primaryColor,
      logoUrl: tenant.logoUrl,
      topupEnabled: tenant.topupEnabled,
      birthdayRewardName: activeBirthdayReward ? tenant.birthdayRewardName : null,
      lifecycleMessage,
    });

    // Google pass identity lives on loyalty.passes (provider='google'). Migrated
    // cards already have a row with provider_object_id — never regenerate; only a
    // brand-new pass records a fresh object id.
    if (!existingPass) {
      const objectId = `${process.env.GOOGLE_WALLET_ISSUER_ID}.card_${card.id}`;
      await prisma.passes.create({
        data: {
          tenant_id: tenant.id,
          loyalty_card_id: card.id,
          provider: 'google',
          provider_object_id: objectId,
        },
      });
    }

    return NextResponse.json({ saveUrl });
  } catch (err) {
    logError('Google Pass', err);
    return NextResponse.json({ error: 'Error generando pase. Intenta de nuevo.' }, { status: 500 });
  }
}
