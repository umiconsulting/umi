import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, generateRandomToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getStaffMemberId } from '@/lib/identity';
import { getRewardProfileForCard } from '@/lib/prisma-helpers';
import { resolveScanTarget } from '@/lib/scan-resolve';
import { lockCard } from '@/lib/wallet';
import { DEFAULT_CUSTOMER_NAME, SCAN_ACTIONS } from '@/lib/constants';
import { triggerWalletUpdates, buildCardSummary, readLifecycleMessage, lifecycleMetadata } from '@/lib/scan-helpers';
import { afterResponse } from '@/lib/after-response';
import { getTenant, requireActiveSubscription } from '@/lib/tenant';
import { tenantHour, tenantWeekday, tenantStartOfDay } from '@/lib/timezone';
import { sendRewardEarnedEmail } from '@/lib/email';
import {
  bankedReward,
  isBaseReady,
  momentVars,
  readPendingTier1,
  staffVisitMessage,
  visitMoment,
  type VisitMoment,
} from '@/lib/reward-tiers';

// waitUntil work shares this budget — if the invocation ends, the backgrounded wallet
// push is cancelled with it. The default 15s leaves the push racing the request it was
// just moved off of; the provider hops are bounded well inside 30s.
export const maxDuration = 30;
import { resolveJourneyTemplate, renderTemplate } from '@/lib/lifecycle-copy';

const ActionEnum = z.enum([SCAN_ACTIONS.VISIT, SCAN_ACTIONS.REDEEM, SCAN_ACTIONS.REDEEM_BASE, SCAN_ACTIONS.BIRTHDAY_REDEEM]);

// Accept either single `action` (legacy) or `actions` array (multi).
const ScanSchema = z.object({
  qrPayload: z.string().min(1),
  action: ActionEnum.optional(),
  actions: z.array(ActionEnum).min(1).max(3).optional(),
}).refine((v) => v.action || v.actions, { message: 'action or actions required' });

// Fixed processing order — redemptions consume current state before VISIT may add a new
// reward. The lower-tier cash-out resets the cycle, so a VISIT in the same scan counts
// from zero.
const ACTION_ORDER = [SCAN_ACTIONS.BIRTHDAY_REDEEM, SCAN_ACTIONS.REDEEM, SCAN_ACTIONS.REDEEM_BASE, SCAN_ACTIONS.VISIT] as const;

/** Guard failure raised INSIDE the scan transaction; mapped to an HTTP response. */
class ScanError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ScanError';
  }
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

    // Resolve QR payload / card number / PHONE → hydrated card (shared with the
    // preview endpoint via resolveScanTarget, so a phone that previews also commits).
    const resolved = await resolveScanTarget(tenant.id, parsed.qrPayload);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    const card = resolved.card;

    const includesVisit = actionList.includes(SCAN_ACTIONS.VISIT);
    const includesRedeem = actionList.includes(SCAN_ACTIONS.REDEEM);
    const includesRedeemBase = actionList.includes(SCAN_ACTIONS.REDEEM_BASE);
    const includesBirthday = actionList.includes(SCAN_ACTIONS.BIRTHDAY_REDEEM);

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

    const rewardProfile = await getRewardProfileForCard(tenant.id, card);
    // Cycle-completion values (the TOP tier on a two-tier ladder — see reward-tiers.ts).
    const { visitsRequired, rewardName } = rewardProfile;
    const baseTier = rewardProfile.baseTier;

    // A NULL expires_at means "never expires" — treat it as active (NULL >= now() is
    // NULL in Postgres, so the old `expires_at >= now` filter silently hid it).
    const activeBirthdayReward = await prisma.birthday_rewards.findFirst({
      where: {
        tenant_id: tenant.id,
        loyalty_card_id: card.id,
        status: 'active',
        OR: [{ expires_at: null }, { expires_at: { gte: new Date() } }],
      },
    });

    // Fast pre-transaction validations (the authoritative idempotency re-checks run
    // inside the locked transaction below).
    if (includesBirthday && !activeBirthdayReward) {
      return NextResponse.json({ error: 'No hay regalo de cumpleaños activo' }, { status: 400 });
    }
    if (includesRedeem && !rewardProfile.redemptionConfigId) {
      // A reward config is required to record a redemption (FK to reward_configs).
      return NextResponse.json({ error: 'No hay configuración de recompensa activa' }, { status: 400 });
    }
    if (includesRedeemBase && !baseTier?.configId) {
      return NextResponse.json({ error: 'Esta tarjeta no tiene un primer nivel de recompensa' }, { status: 400 });
    }
    if (includesRedeem && includesRedeemBase) {
      // Two canjes in one scan would trip the 30-second duplicate guard anyway — say why.
      return NextResponse.json({ error: 'Canjea una recompensa a la vez' }, { status: 400 });
    }

    const customerName = card.person?.display_name ?? null;
    const customerEmail = card.person?.normalized_email ?? null;

    // Apply all selected actions atomically in canonical order.
    // Each step mutates the same row; we re-read once at the end for the response.
    const performed: string[] = [];
    const redeemedNames: string[] = [];
    let rewardEarnedThisCall = false;

    const updatedCard = await prisma.$transaction(async (tx) => {
      // Serialize concurrent duplicate scans on this card and re-check every
      // idempotency guard UNDER the lock against fresh state, so a double-tap /
      // retry / two-device race cannot double-count a visit or mint two rewards.
      await lockCard(tx, card.id);
      const fresh = await tx.cards.findUniqueOrThrow({ where: { id: card.id } });

      // The scan's single "moment" — the one lifecycle message this interaction leaves
      // on the card (and pushes to the customer's lock screen). Written on EVERY scan,
      // so a moment cached by a previous visit can never linger — or re-notify — after
      // a redeem-only scan. Priority: reward_earned > base_reward_ready > reward_redeemed
      // > first_visit > milestone_one_left > milestone_halfway > visit_recorded.
      let moment: VisitMoment | null = null;
      // Extra metadata keys this scan writes alongside the moment (pending_tier1).
      const metadataPatch: Record<string, unknown> = {};
      // The in-progress cycle as the VISIT step sees it — a lower-tier cash-out in the
      // same scan resets it first.
      let cycleNow = fresh.visits_this_cycle;

      const rejectDuplicateRedeem = async () => {
        // Idempotency: reject a duplicate canje within 30 seconds (under the lock).
        const recentRedemption = await tx.reward_redemptions.findFirst({
          where: { tenant_id: tenant.id, loyalty_card_id: card.id, redeemed_at: { gte: new Date(Date.now() - 30 * 1000) } },
        });
        if (recentRedemption) {
          throw new ScanError(429, 'Recompensa ya canjeada. Espera un momento si deseas canjear otra.');
        }
      };

      if (includesBirthday) {
        // Atomic claim of the SINGLE previewed reward: only that active row flips; a
        // concurrent scan that already claimed it leaves count 0. Constraining to
        // activeBirthdayReward.id (rather than every active row) caps consumption at
        // one — otherwise a card holding two active birthday rewards would have BOTH
        // silently redeemed while only one redemption is recorded/messaged (made more
        // likely by the null-expiry rows the OR filter above now treats as active).
        // includesBirthday guarantees activeBirthdayReward is non-null (pre-tx guard).
        const claimed = await tx.birthday_rewards.updateMany({
          where: {
            id: activeBirthdayReward!.id,
            tenant_id: tenant.id,
            loyalty_card_id: card.id,
            status: 'active',
            OR: [{ expires_at: null }, { expires_at: { gte: new Date() } }],
          },
          data: { status: 'redeemed', redeemed_at: new Date() },
        });
        if (claimed.count === 0) throw new ScanError(400, 'No hay regalo de cumpleaños activo');
        performed.push(SCAN_ACTIONS.BIRTHDAY_REDEEM);
      }

      if (includesRedeem && rewardProfile.redemptionConfigId) {
        if (fresh.pending_rewards <= 0) {
          throw new ScanError(400, 'No hay recompensas pendientes para canjear');
        }
        await rejectDuplicateRedeem();
        // A banked reward is the top tier — unless it was banked under the old single
        // threshold before the ladder existed (pending_tier1 tag): those are honored as
        // the lower tier, first, and the tag counts down with them.
        const pendingTier1 = readPendingTier1(fresh.metadata);
        const banked = bankedReward(rewardProfile, pendingTier1);
        if (!banked.configId) throw new ScanError(400, 'No hay configuración de recompensa activa');
        await tx.reward_redemptions.create({
          data: {
            tenant_id: tenant.id,
            loyalty_card_id: card.id,
            reward_config_id: banked.configId,
            staff_member_id: staffMemberId,
          },
        });
        await tx.cards.update({
          where: { id: card.id },
          data: { pending_rewards: { decrement: 1 } },
        });
        if (banked.isBase) metadataPatch.pending_tier1 = pendingTier1 - 1;
        performed.push(SCAN_ACTIONS.REDEEM);
        redeemedNames.push(banked.rewardName);
        moment = { journey: 'reward_redeemed', rewardName: banked.rewardName, visitsRequired, visitsThisCycle: cycleNow };
      }

      if (includesRedeemBase && baseTier?.configId) {
        // Early cash-out of the lower tier straight off the running cycle: the card is
        // consumed (visits reset to 0), exactly like tearing off a full punch card.
        if (!isBaseReady(rewardProfile, fresh.visits_this_cycle)) {
          throw new ScanError(400, `Aún no llega a ${baseTier.visitsRequired} visitas para ${baseTier.rewardName}`);
        }
        await rejectDuplicateRedeem();
        await tx.reward_redemptions.create({
          data: {
            tenant_id: tenant.id,
            loyalty_card_id: card.id,
            reward_config_id: baseTier.configId,
            staff_member_id: staffMemberId,
            note: `Canje anticipado con ${fresh.visits_this_cycle}/${visitsRequired} visitas`,
          },
        });
        await tx.cards.update({
          where: { id: card.id },
          data: { visits_this_cycle: 0 },
        });
        cycleNow = 0;
        performed.push(SCAN_ACTIONS.REDEEM_BASE);
        redeemedNames.push(baseTier.rewardName);
        moment = { journey: 'reward_redeemed', rewardName: baseTier.rewardName, visitsRequired, visitsThisCycle: 0 };
      }

      if (includesVisit) {
        // 1 visit per card per calendar day (tenant tz) — re-checked under the lock,
        // so a concurrent duplicate scan sees the just-committed visit and is rejected.
        const recentVisit = await tx.visit_events.findFirst({
          where: { tenant_id: tenant.id, loyalty_card_id: card.id, occurred_at: { gte: tenantStartOfDay(tz) } },
        });
        if (recentVisit) throw new ScanError(429, 'Ya se registró una visita hoy');

        await tx.visit_events.create({
          data: { tenant_id: tenant.id, loyalty_card_id: card.id, staff_member_id: staffMemberId },
        });
        const newVisitsThisCycle = cycleNow + 1;
        const newTotalVisits = fresh.total_visits + 1;
        const earnedReward = newVisitsThisCycle >= visitsRequired;
        rewardEarnedThisCall = earnedReward;

        // A reward earned by this visit — or the lower tier coming within reach — outranks
        // any moment chosen so far (including a redeem in the same scan: the choice ahead
        // is the headline); lesser visit moments only fill an empty slot. A plain
        // mid-cycle visit still gets a moment: the lifecycle field is the pass's ONLY
        // notification channel on Apple (see pass-apple.ts).
        const visitM = visitMoment(rewardProfile, { newVisitsThisCycle, earnedReward, isFirstVisitEver: newTotalVisits === 1 });
        if (earnedReward || visitM.journey === 'base_reward_ready' || moment === null) moment = visitM;

        await tx.cards.update({
          where: { id: card.id },
          data: {
            total_visits: { increment: 1 },
            visits_this_cycle: earnedReward ? 0 : newVisitsThisCycle,
            pending_rewards: earnedReward ? { increment: 1 } : undefined,
          },
        });
        performed.push(SCAN_ACTIONS.VISIT);
      }

      // Render the chosen moment (if any) and persist it with the QR rotation — one
      // write covers every action combination, and a scan with no moment clears the
      // previous one. The message lives in card.metadata.lifecycle_message and fires a
      // lock-screen notification via the pass's changeMessage hook. No lifecycle_sends
      // row — these are responses to the customer's own scan, not cron-driven nudges.
      let momentMessage: string | null = null;
      if (moment) {
        const template = resolveJourneyTemplate(tenant.lifecycleCopy, moment.journey);
        momentMessage = renderTemplate(
          template,
          momentVars(rewardProfile, moment, { name: customerName || DEFAULT_CUSTOMER_NAME, tenant: tenant.name }),
        );
      }
      // Rotate QR token once for any successful interaction
      const rotated = await tx.cards.update({
        where: { id: card.id },
        data: {
          qr_token: generateRandomToken(),
          qr_issued_at: new Date(),
          metadata: lifecycleMetadata({ ...((fresh.metadata ?? {}) as Record<string, unknown>), ...metadataPatch }, momentMessage),
        },
        include: { accounts: true },
      });
      return rotated;
    });

    const updatedLifecycleMessage = readLifecycleMessage(updatedCard.metadata);

    // Send reward-earned email (only when VISIT pushed them over). Fire-and-forget
    // would be dropped when the response returns and the invocation is suspended.
    if (rewardEarnedThisCall && customerEmail) {
      await afterResponse(
        'mail:reward-earned',
        sendRewardEarnedEmail({
          to: customerEmail,
          customerName: customerName ?? 'Cliente',
          tenantName: tenant.name,
          rewardName,
          slug: params.slug,
          appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'https://cash.umiconsulting.co',
          brandColor: tenant.primaryColor,
        }),
      );
    }

    // Compose human message from what was performed
    const messageParts: string[] = [];
    if (performed.includes(SCAN_ACTIONS.BIRTHDAY_REDEEM)) {
      messageParts.push(`🎂 Regalo de cumpleaños canjeado: ${tenant.birthdayRewardName}`);
    }
    if (performed.includes(SCAN_ACTIONS.REDEEM)) {
      messageParts.push(`✓ Recompensa canjeada: ${redeemedNames[0] ?? rewardName}`);
    }
    if (performed.includes(SCAN_ACTIONS.REDEEM_BASE) && baseTier) {
      messageParts.push(`✓ ${baseTier.rewardName} canjeado · tarjeta reiniciada`);
    }
    if (performed.includes(SCAN_ACTIONS.VISIT)) {
      if (rewardEarnedThisCall) {
        messageParts.push(`¡${customerName ?? 'Cliente'} ganó una recompensa! ${rewardName} disponible.`);
      } else {
        messageParts.push(`✓ Visita #${updatedCard.total_visits} registrada. ${staffVisitMessage(rewardProfile, updatedCard.visits_this_cycle)}`);
      }
    }
    const message = messageParts.join(' · ') || 'Sin cambios';

    // Birthday reward should be hidden from the pass if we just redeemed it
    const remainingBirthday = includesBirthday ? null : (activeBirthdayReward ? tenant.birthdayRewardName : null);

    // The visit is already committed — never make the staff wait on Apple/Google to
    // hear about it. A slow wallet hop used to delay this response past the client's
    // patience, surfacing as "Error de conexión" for a scan that had in fact landed.
    await afterResponse(
      'wallet:scan',
      triggerWalletUpdates(card.id, card.card_number, updatedCard, customerName, rewardProfile, card.created_at, tenant.name, params.slug, tenant.primaryColor, remainingBirthday, updatedLifecycleMessage),
    );

    return NextResponse.json({
      success: true,
      actions: performed,
      message,
      rewardEarned: rewardEarnedThisCall,
      afterHours: isAfterHours && includesVisit,
      customer: { name: customerName, cardNumber: updatedCard.card_number },
      card: buildCardSummary(updatedCard, rewardProfile),
      birthdayReward: !includesBirthday && activeBirthdayReward
        ? { id: activeBirthdayReward.id, rewardName: tenant.birthdayRewardName }
        : null,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    if (err instanceof ScanError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[Scan]', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Error al procesar escaneo' }, { status: 500 });
  }
}
