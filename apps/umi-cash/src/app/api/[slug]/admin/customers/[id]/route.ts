import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { formatMXN } from '@/lib/currency';
import { getActiveRewardConfig, rewardConfigDefaults, getRewardProfileForCard } from '@/lib/prisma-helpers';
import { triggerWalletUpdates, readLifecycleMessage } from '@/lib/scan-helpers';
import { afterResponse } from '@/lib/after-response';
import { getTenant } from '@/lib/tenant';

export const maxDuration = 30;

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string; id: string } }
) {
  const user = await requireAuth(['STAFF', 'ADMIN'])(req);
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  if (user.tenantId !== tenant.id) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  // The customer id is a core.people id. Reach the card via account → card.
  const person = await prisma.people.findFirst({ where: { id: params.id, tenant_id: tenant.id } });

  if (!person) {
    return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
  }

  const account = await prisma.accounts.findFirst({
    where: { tenant_id: tenant.id, person_id: person.id },
    select: { id: true },
  });
  const card = account
    ? await prisma.cards.findFirst({
        where: { tenant_id: tenant.id, account_id: account.id },
        orderBy: { created_at: 'desc' },
      })
    : null;

  if (!card) {
    return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
  }

  const rewardProfile = await getRewardProfileForCard(tenant.id, card);
  const { visitsRequired, rewardName } = rewardProfile;
  const overrideConfig = card.reward_config_id
    ? await prisma.reward_configs.findFirst({ where: { tenant_id: tenant.id, id: card.reward_config_id } })
    : null;
  const cardScope = { tenant_id: tenant.id, loyalty_card_id: card.id };

  const [recentVisits, recentTransactions, ltvAgg, topupAgg, rewardsRedeemed, recentRedemptions] = await Promise.all([
    prisma.visit_events.findMany({
      where: cardScope,
      orderBy: { occurred_at: 'desc' },
      take: 10,
    }),
    prisma.wallet_transactions.findMany({
      where: cardScope,
      orderBy: { created_at: 'desc' },
      take: 10,
    }),
    // LTV = sum of all purchase transactions (negative amounts = money spent at the store)
    prisma.wallet_transactions.aggregate({
      where: { ...cardScope, type: 'purchase' },
      _sum: { amount_cents: true },
    }),
    // Total topped up = sum of all topup transactions
    prisma.wallet_transactions.aggregate({
      where: { ...cardScope, type: 'topup' },
      _sum: { amount_cents: true },
    }),
    // Count every reward this card redeemed. This reads the loyalty ledger.
    // Birthday gifts are in a different table, so they stay out of the count.
    // The number covers one card. The visit and balance numbers above use the
    // same card scope, so the screen stays consistent.
    prisma.reward_redemptions.count({ where: cardScope }),
    // Read the most recent redemptions from that same ledger. The list stops at
    // 10 rows, but the count above has no limit. The page shows a footer when
    // the two numbers differ.
    prisma.reward_redemptions.findMany({
      where: cardScope,
      orderBy: { redeemed_at: 'desc' },
      take: 10,
    }),
  ]);

  const ltvCentavos = Math.abs(ltvAgg._sum.amount_cents ?? 0);
  const totalTopupCentavos = topupAgg._sum.amount_cents ?? 0;
  const meta = (person.metadata ?? {}) as Record<string, unknown>;

  return NextResponse.json({
    id: person.id,
    name: person.display_name,
    phone: person.normalized_phone,
    email: person.normalized_email,
    device: (meta.device as string) ?? null,
    os: (meta.os as string) ?? null,
    birthDate: person.birth_date?.toISOString().split('T')[0] ?? null,
    cardNumber: card.card_number, cardId: card.id,
    balanceMXN: formatMXN(card.balance_cents), balanceCentavos: card.balance_cents,
    totalVisits: card.total_visits, visitsThisCycle: card.visits_this_cycle,
    visitsRequired, pendingRewards: card.pending_rewards, rewardsRedeemed,
    rewardName,
    customReward: overrideConfig
      ? { name: overrideConfig.reward_name, description: overrideConfig.reward_description }
      : null,
    lastVisit: recentVisits[0]?.occurred_at?.toISOString() ?? null,
    createdAt: (person.created_at ?? card.created_at).toISOString(),
    ltvCentavos, ltvMXN: formatMXN(ltvCentavos),
    totalTopupCentavos, totalTopupMXN: formatMXN(totalTopupCentavos),
    recentVisits: recentVisits.map((v) => ({ id: v.id, scannedAt: v.occurred_at.toISOString() })),
    recentRedemptions: recentRedemptions.map((r) => ({
      id: r.id, redeemedAt: r.redeemed_at.toISOString(), note: r.note,
      revertedAt: r.reverted_at?.toISOString() ?? null,
    })),
    // The revert button is ADMIN-only ("solo a mi"); the page needs to know who's looking.
    viewerIsAdmin: user.role === 'ADMIN',
    recentTransactions: recentTransactions.map((t) => ({
      id: t.id, type: t.type, amountCentavos: t.amount_cents,
      description: t.description, createdAt: t.created_at.toISOString(),
    })),
  });
}

const RewardOverrideSchema = z.object({
  customReward: z.union([
    z.object({
      name: z.string().trim().min(1).max(80),
      description: z.string().trim().max(200).nullish(),
    }),
    z.null(),
  ]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { slug: string; id: string } }
) {
  // Setting a client's reward is an owner decision — same ADMIN-only stance as
  // the redemption revert endpoint.
  const user = await requireAuth(['ADMIN'])(req);
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });
  if (user.tenantId !== tenant.id) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  try {
    const { customReward } = RewardOverrideSchema.parse(await req.json());

    const person = await prisma.people.findFirst({ where: { id: params.id, tenant_id: tenant.id } });
    if (!person) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
    const account = await prisma.accounts.findFirst({
      where: { tenant_id: tenant.id, person_id: person.id },
      select: { id: true },
    });
    const card = account
      ? await prisma.cards.findFirst({
          where: { tenant_id: tenant.id, account_id: account.id },
          orderBy: { created_at: 'desc' },
        })
      : null;
    if (!card) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });

    let overrideId: string | null = null;
    if (customReward) {
      const description = customReward.description?.trim() || null;
      // Reuse an identical override config (several VIPs sharing "Postre gratis"
      // share one row). kind:'override' + is_active:false keeps these rows out of
      // getActiveRewardConfig and out of the rewards settings history list, and
      // means an override can never alias a retired tenant default.
      const existing = await prisma.reward_configs.findFirst({
        where: {
          tenant_id: tenant.id,
          kind: 'override',
          is_active: false,
          reward_name: customReward.name,
          reward_description: description,
        },
      });
      if (existing) {
        overrideId = existing.id;
      } else {
        const defaults = rewardConfigDefaults(await getActiveRewardConfig(tenant.id));
        const created = await prisma.reward_configs.create({
          data: {
            tenant_id: tenant.id,
            kind: 'override',
            reward_name: customReward.name,
            reward_description: description,
            // Informational filler — resolution always takes visits from the
            // tenant default (reward-only override, decision 2026-09-01).
            visits_required: defaults.visitsRequired,
            is_active: false,
          },
        });
        overrideId = created.id;
      }
    }

    const updatedCard = await prisma.cards.update({
      where: { id: card.id },
      data: { reward_config_id: overrideId },
    });

    // The pass shows the reward name — push the new identity to the wallet.
    const rewardProfile = await getRewardProfileForCard(tenant.id, updatedCard);
    const activeBirthdayReward = await prisma.birthday_rewards.findFirst({
      where: {
        tenant_id: tenant.id,
        loyalty_card_id: card.id,
        status: 'active',
        OR: [{ expires_at: null }, { expires_at: { gte: new Date() } }],
      },
      select: { id: true },
    });
    await afterResponse(
      'wallet:reward-override',
      triggerWalletUpdates(
        card.id, card.card_number, updatedCard, person.display_name,
        rewardProfile.visitsRequired, rewardProfile.rewardName, card.created_at,
        tenant.name, params.slug, tenant.primaryColor,
        activeBirthdayReward ? tenant.birthdayRewardName : null,
        readLifecycleMessage(updatedCard.metadata),
      ),
    );

    return NextResponse.json({
      success: true,
      customReward: customReward
        ? { name: customReward.name, description: customReward.description?.trim() || null }
        : null,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    console.error('[CustomerReward]', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Error al actualizar la recompensa' }, { status: 500 });
  }
}
