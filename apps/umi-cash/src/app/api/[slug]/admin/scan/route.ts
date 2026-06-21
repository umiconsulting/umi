import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, verifyQRPayload, generateRandomToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getStaffMemberId } from '@/lib/identity';
import { getActiveRewardConfig, rewardConfigDefaults, findCardByIdentifier } from '@/lib/prisma-helpers';
import { formatMXN } from '@/lib/currency';
import { DEFAULT_CUSTOMER_NAME, SCAN_ACTIONS } from '@/lib/constants';
import { sendApplePushUpdate } from '@/lib/push-apple';
import { updateGoogleWalletObject } from '@/lib/pass-google';
import { getTenant, requireActiveSubscription } from '@/lib/tenant';
import { tenantHour, tenantWeekday, tenantStartOfDay } from '@/lib/timezone';
import { sendRewardEarnedEmail } from '@/lib/email';
import { resolveJourneyTemplate, renderTemplate, type LifecycleJourneyKey } from '@/lib/lifecycle-copy';

const ActionEnum = z.enum([SCAN_ACTIONS.VISIT, SCAN_ACTIONS.REDEEM, SCAN_ACTIONS.BIRTHDAY_REDEEM]);

// Accept either single `action` (legacy) or `actions` array (multi).
const ScanSchema = z.object({
  qrPayload: z.string().min(1),
  action: ActionEnum.optional(),
  actions: z.array(ActionEnum).min(1).max(3).optional(),
}).refine((v) => v.action || v.actions, { message: 'action or actions required' });

// Fixed processing order — redemptions consume current state before VISIT may add a new reward.
const ACTION_ORDER = [SCAN_ACTIONS.BIRTHDAY_REDEEM, SCAN_ACTIONS.REDEEM, SCAN_ACTIONS.VISIT] as const;

/** Read the cached lifecycle nudge message off the card's metadata jsonb. */
function readLifecycleMessage(metadata: unknown): string | null {
  const m = (metadata ?? {}) as Record<string, unknown>;
  return (m.lifecycle_message as string) ?? null;
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
    const body = await req.json();
    const parsed = ScanSchema.parse(body);
    const requested = new Set<string>(parsed.actions ?? (parsed.action ? [parsed.action] : []));
    // Sort into canonical order so callers can't accidentally reorder semantics.
    const actionList = ACTION_ORDER.filter((a) => requested.has(a));

    const qrData = await verifyQRPayload(parsed.qrPayload);
    if (!qrData) {
      return NextResponse.json({ error: 'Código QR inválido o expirado' }, { status: 400 });
    }

    // findCardByIdentifier matches by card_number OR id, scoped to the tenant, and
    // hydrates the customer via account → person.
    const card = await findCardByIdentifier(qrData.cardId, tenant.id, { person: true });

    if (!card) return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });

    if (!qrData.isWalletScan && card.qr_token !== qrData.qrToken) {
      return NextResponse.json({
        error: 'Código QR ya fue usado. Pídele al cliente que actualice su código.',
      }, { status: 400 });
    }

    const includesVisit = actionList.includes(SCAN_ACTIONS.VISIT);
    const includesRedeem = actionList.includes(SCAN_ACTIONS.REDEEM);
    const includesBirthday = actionList.includes(SCAN_ACTIONS.BIRTHDAY_REDEEM);

    // Wallet scan replay protection: block if a visit was recorded in the last 60 seconds
    if (qrData.isWalletScan && includesVisit) {
      const recentVisit = await prisma.visit_events.findFirst({
        where: {
          tenant_id: tenant.id,
          loyalty_card_id: card.id,
          occurred_at: { gte: new Date(Date.now() - 60 * 1000) },
        },
      });
      if (recentVisit) {
        return NextResponse.json({
          error: 'Visita ya registrada recientemente. Espera un momento.',
        }, { status: 429 });
      }
    }

    // Staff cannot scan a card linked to their own person identity.
    const staffMemberId = await getStaffMemberId(tenant.id, staff.sub);
    const staffUser = await prisma.users.findUnique({ where: { id: staff.sub }, select: { person_id: true } });
    if (staffUser?.person_id && staffUser.person_id === card.accounts?.person_id) {
      return NextResponse.json({ error: 'No puedes escanear tu propia tarjeta' }, { status: 403 });
    }

    // Warn on out-of-hours scans based on tenant per-day business hours
    const tz = tenant.timezone;
    const localHour = tenantHour(tz);
    const localDay = String(tenantWeekday(tz));
    const hours = tenant.businessHours as Record<string, [number, number] | null> | null;
    let isAfterHours = false;
    if (hours) {
      const dayHours = hours[localDay];
      if (!dayHours) {
        isAfterHours = true; // closed today
      } else {
        isAfterHours = localHour < dayHours[0] || localHour >= dayHours[1];
      }
    }
    if (isAfterHours) {
      const dayHours = hours?.[localDay];
      console.warn(`[Scan] After-hours scan by staff ${staff.sub} for card ${card.id} at hour ${localHour} day ${localDay} (hours: ${dayHours ? dayHours.join('-') : 'closed'})`);
    }

    // 1 visit per card per calendar day in tenant timezone
    if (includesVisit) {
      const recentVisit = await prisma.visit_events.findFirst({
        where: { tenant_id: tenant.id, loyalty_card_id: card.id, occurred_at: { gte: tenantStartOfDay(tz) } },
      });
      if (recentVisit) {
        return NextResponse.json({
          error: 'Ya se registró una visita hoy',
        }, { status: 429 });
      }
    }

    const rewardConfig = await getActiveRewardConfig(tenant.id);
    const { visitsRequired, rewardName } = rewardConfigDefaults(rewardConfig);

    const activeBirthdayReward = await prisma.birthday_rewards.findFirst({
      where: { tenant_id: tenant.id, loyalty_card_id: card.id, status: 'active', expires_at: { gte: new Date() } },
    });

    if (includesBirthday && !activeBirthdayReward) {
      return NextResponse.json({ error: 'No hay regalo de cumpleaños activo' }, { status: 400 });
    }

    if (includesRedeem) {
      if (card.pending_rewards <= 0) {
        return NextResponse.json({ error: 'No hay recompensas pendientes para canjear' }, { status: 400 });
      }
      // A reward config is required to record a redemption (FK to reward_configs).
      if (!rewardConfig) {
        return NextResponse.json({ error: 'No hay configuración de recompensa activa' }, { status: 400 });
      }
      // Idempotency: reject duplicate REDEEM within 30 seconds
      const recentRedemption = await prisma.reward_redemptions.findFirst({
        where: { tenant_id: tenant.id, loyalty_card_id: card.id, redeemed_at: { gte: new Date(Date.now() - 30 * 1000) } },
      });
      if (recentRedemption) {
        return NextResponse.json({ error: 'Recompensa ya canjeada. Espera un momento si deseas canjear otra.' }, { status: 429 });
      }
    }

    const customerName = card.person?.display_name ?? null;
    const customerEmail = card.person?.normalized_email ?? null;

    // Apply all selected actions atomically in canonical order.
    // Each step mutates the same row; we re-read once at the end for the response.
    const performed: string[] = [];
    let rewardEarnedThisCall = false;

    const updatedCard = await prisma.$transaction(async (tx) => {
      if (includesBirthday && activeBirthdayReward) {
        await tx.birthday_rewards.update({
          where: { id: activeBirthdayReward.id },
          data: { status: 'redeemed', redeemed_at: new Date() },
        });
        performed.push(SCAN_ACTIONS.BIRTHDAY_REDEEM);
      }

      if (includesRedeem && rewardConfig) {
        await tx.reward_redemptions.create({
          data: {
            tenant_id: tenant.id,
            loyalty_card_id: card.id,
            reward_config_id: rewardConfig.id,
            staff_member_id: staffMemberId,
          },
        });
        await tx.cards.update({
          where: { id: card.id },
          data: { pending_rewards: { decrement: 1 } },
        });
        performed.push(SCAN_ACTIONS.REDEEM);
      }

      let momentMessage: string | null = null;
      if (includesVisit) {
        await tx.visit_events.create({
          data: { tenant_id: tenant.id, loyalty_card_id: card.id, staff_member_id: staffMemberId },
        });
        const newVisitsThisCycle = card.visits_this_cycle + 1;
        const newTotalVisits = card.total_visits + 1;
        const earnedReward = newVisitsThisCycle >= visitsRequired;
        rewardEarnedThisCall = earnedReward;

        // Pick the "moment" message based on what just happened. Priority:
        //   reward_earned > first_visit > milestone_one_left > milestone_halfway
        // The chosen message lives in card.metadata.lifecycle_message and fires a lock-screen
        // notification via the pass's changeMessage hook. No lifecycle_sends row —
        // these are responses to the customer's own scan, not cron-driven nudges.
        let momentJourney: LifecycleJourneyKey | null = null;
        if (earnedReward) momentJourney = 'reward_earned';
        else if (newTotalVisits === 1) momentJourney = 'first_visit';
        else if (newVisitsThisCycle === visitsRequired - 1) momentJourney = 'milestone_one_left';
        else if (visitsRequired >= 4 && newVisitsThisCycle === Math.floor(visitsRequired / 2)) momentJourney = 'milestone_halfway';

        if (momentJourney) {
          const template = resolveJourneyTemplate(tenant.lifecycleCopy, momentJourney);
          momentMessage = renderTemplate(template, {
            name: customerName || DEFAULT_CUSTOMER_NAME,
            tenant: tenant.name,
            rewardName,
            visitsThisCycle: earnedReward ? visitsRequired : newVisitsThisCycle,
            visitsRequired,
          });
        }

        const existingMeta = (card.metadata ?? {}) as Record<string, unknown>;
        await tx.cards.update({
          where: { id: card.id },
          data: {
            total_visits: { increment: 1 },
            visits_this_cycle: earnedReward ? 0 : newVisitsThisCycle,
            pending_rewards: earnedReward ? { increment: 1 } : undefined,
            // Set the moment message (or null if none fires — also clears any stale lifecycle nudge).
            metadata: {
              ...existingMeta,
              lifecycle_message: momentMessage,
              lifecycle_message_updated_at: momentMessage ? new Date().toISOString() : null,
            },
          },
        });
        performed.push(SCAN_ACTIONS.VISIT);
      }

      // Rotate QR token once for any successful interaction
      const rotated = await tx.cards.update({
        where: { id: card.id },
        data: { qr_token: generateRandomToken(), qr_issued_at: new Date() },
        include: { accounts: true },
      });
      return rotated;
    });

    const updatedLifecycleMessage = readLifecycleMessage(updatedCard.metadata);

    // Send reward-earned email (only when VISIT pushed them over)
    if (rewardEarnedThisCall && customerEmail) {
      sendRewardEarnedEmail({
        to: customerEmail,
        customerName: customerName ?? 'Cliente',
        tenantName: tenant.name,
        rewardName,
        slug: params.slug,
        appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'https://cash.umiconsulting.co',
        brandColor: tenant.primaryColor,
      }).catch(() => {});
    }

    // Compose human message from what was performed
    const messageParts: string[] = [];
    if (performed.includes(SCAN_ACTIONS.BIRTHDAY_REDEEM)) {
      messageParts.push(`🎂 Regalo de cumpleaños canjeado: ${tenant.birthdayRewardName}`);
    }
    if (performed.includes(SCAN_ACTIONS.REDEEM)) {
      messageParts.push(`✓ Recompensa canjeada: ${rewardName}`);
    }
    if (performed.includes(SCAN_ACTIONS.VISIT)) {
      const remaining = visitsRequired - updatedCard.visits_this_cycle;
      if (rewardEarnedThisCall) {
        messageParts.push(`¡${customerName ?? 'Cliente'} ganó una recompensa! ${rewardName} disponible.`);
      } else {
        messageParts.push(`✓ Visita #${updatedCard.total_visits} registrada. ${remaining} visita${remaining !== 1 ? 's' : ''} para ${rewardName}.`);
      }
    }
    const message = messageParts.join(' · ') || 'Sin cambios';

    // Birthday reward should be hidden from the pass if we just redeemed it
    const remainingBirthday = includesBirthday ? null : (activeBirthdayReward ? tenant.birthdayRewardName : null);

    await triggerWalletUpdates(card.id, card.card_number, updatedCard, customerName, visitsRequired, rewardName, card.created_at, tenant.name, params.slug, tenant.primaryColor, remainingBirthday, updatedLifecycleMessage);

    return NextResponse.json({
      success: true,
      actions: performed,
      message,
      rewardEarned: rewardEarnedThisCall,
      afterHours: isAfterHours && includesVisit,
      customer: { name: customerName, cardNumber: updatedCard.card_number },
      card: buildCardSummary(updatedCard, visitsRequired),
      birthdayReward: !includesBirthday && activeBirthdayReward
        ? { id: activeBirthdayReward.id, rewardName: tenant.birthdayRewardName }
        : null,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    console.error('[Scan]', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Error al procesar escaneo' }, { status: 500 });
  }
}

function buildCardSummary(
  card: { visits_this_cycle: number; pending_rewards: number; balance_cents: number },
  visitsRequired: number
) {
  return { visitsThisCycle: card.visits_this_cycle, visitsRequired, pendingRewards: card.pending_rewards, balanceMXN: formatMXN(card.balance_cents) };
}

async function triggerWalletUpdates(
  cardId: string,
  cardNumber: string,
  card: { visits_this_cycle: number; pending_rewards: number; balance_cents: number; total_visits: number },
  customerName: string | null,
  visitsRequired: number,
  rewardName: string,
  createdAt: Date,
  tenantName: string,
  tenantSlug: string,
  primaryColor: string,
  birthdayRewardName: string | null,
  lifecycleMessage: string | null,
) {
  // Run both wallet pushes to completion INDEPENDENTLY. Promise.all is fail-fast: if the
  // Google push rejects (e.g. a bad service-account key), the await returns at once and
  // Vercel suspends the function before the in-flight Apple http2 push can finish → the
  // pass silently never updates (works locally only because the process stays alive).
  // allSettled awaits BOTH, so the Apple push always completes regardless of Google.
  const _wallet = await Promise.allSettled([
    sendApplePushUpdate(cardId),
    updateGoogleWalletObject({
      cardId, cardNumber,
      customerName: customerName || DEFAULT_CUSTOMER_NAME,
      balanceCentavos: card.balance_cents,
      visitsThisCycle: card.visits_this_cycle,
      visitsRequired,
      pendingRewards: card.pending_rewards,
      rewardName,
      totalVisits: card.total_visits,
      memberSince: createdAt.toISOString(),
      tenantName,
      tenantSlug,
      primaryColor,
      birthdayRewardName,
      lifecycleMessage,
    }),
  ]);
  if (_wallet[0].status === 'rejected') console.warn('[Wallet Update] Apple push failed:', _wallet[0].reason);
  if (_wallet[1].status === 'rejected') console.warn('[Wallet Update] Google push failed:', _wallet[1].reason);
}
