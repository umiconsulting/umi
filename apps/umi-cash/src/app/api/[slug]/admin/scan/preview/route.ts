import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, verifyQRPayload } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getActiveRewardConfig, rewardConfigDefaults, findCardByIdentifier } from '@/lib/prisma-helpers';
import { findPersonByPhone } from '@/lib/identity';
import { formatMXN } from '@/lib/currency';
import { getTenant, requireActiveSubscription } from '@/lib/tenant';
import { tenantStartOfDay } from '@/lib/timezone';

const PreviewSchema = z.object({
  qrPayload: z.string().min(1),
});

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
    const { qrPayload } = PreviewSchema.parse(await req.json());

    // Try QR payload first; if it fails, try as card number or phone number
    const qrData = await verifyQRPayload(qrPayload);
    let card: Awaited<ReturnType<typeof findCardByIdentifier>> = null;

    if (qrData) {
      card = await findCardByIdentifier(qrData.cardId, tenant.id, { person: true });

      if (!card) return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });

      if (!qrData.isWalletScan && card.qr_token !== qrData.qrToken) {
        return NextResponse.json({
          error: 'Código QR ya fue usado. Pídele al cliente que actualice su código.',
        }, { status: 400 });
      }
    } else {
      // Manual lookup: card number first, then phone number.
      const input = qrPayload.trim();
      card = await findCardByIdentifier(input, tenant.id, { person: true });

      if (!card) {
        // Phone lookup: person → account → card.
        const person = await findPersonByPhone(tenant.id, input);
        if (person) {
          const acct = await prisma.accounts.findFirst({
            where: { tenant_id: tenant.id, person_id: person.id },
            select: { id: true },
          });
          if (acct) {
            const found = await prisma.cards.findFirst({
              where: { tenant_id: tenant.id, account_id: acct.id },
              orderBy: { created_at: 'desc' },
              select: { id: true },
            });
            if (found) {
              // Re-resolve through the helper so the card shape (accounts + balances +
              // person) matches the rest of this handler.
              card = await findCardByIdentifier(found.id, tenant.id, { person: true });
            }
          }
        }
      }

      if (!card) return NextResponse.json({ error: 'Tarjeta no encontrada. Verifica el número o teléfono.' }, { status: 404 });
    }

    // Staff cannot preview a card linked to their own person identity.
    const staffUser = await prisma.users.findUnique({ where: { id: staff.sub }, select: { person_id: true } });
    if (staffUser?.person_id && staffUser.person_id === card.accounts?.person_id) {
      return NextResponse.json({ error: 'No puedes escanear tu propia tarjeta' }, { status: 403 });
    }

    const [rewardConfig, activeBirthdayReward] = await Promise.all([
      getActiveRewardConfig(tenant.id),
      prisma.birthday_rewards.findFirst({
        where: { tenant_id: tenant.id, loyalty_card_id: card.id, status: 'active', expires_at: { gte: new Date() } },
      }),
    ]);
    const { visitsRequired, rewardName } = rewardConfigDefaults(rewardConfig);

    // Check if already visited today (calendar day in tenant timezone)
    const recentVisit = await prisma.visit_events.findFirst({
      where: { tenant_id: tenant.id, loyalty_card_id: card.id, occurred_at: { gte: tenantStartOfDay(tenant.timezone) } },
      orderBy: { occurred_at: 'desc' },
    });

    return NextResponse.json({
      cardId: card.id,
      cardNumber: card.card_number,
      customer: { name: card.person?.display_name ?? null },
      card: {
        visitsThisCycle: card.visits_this_cycle,
        visitsRequired,
        pendingRewards: card.pending_rewards,
        balanceMXN: formatMXN(card.balance_cents),
        balanceCentavos: card.balance_cents,
        rewardName,
        visitLimitReached: !!recentVisit,
        lastVisitAt: recentVisit?.occurred_at ?? null,
      },
      birthdayReward: activeBirthdayReward
        ? { id: activeBirthdayReward.id, rewardName: tenant.birthdayRewardName }
        : null,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    console.error('[Preview]', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Error al leer la tarjeta' }, { status: 500 });
  }
}
