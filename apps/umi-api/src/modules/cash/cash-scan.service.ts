import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { IntegrityService } from '../integrity/integrity.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { formatMxn2, iso } from '../../shared/format/money';
import { QrService } from '../../shared/auth/qr.service';
import { WalletPassAdapter } from '../../shared/adapters/wallet-pass.adapter';
import { EmailAdapter } from '../../shared/adapters/email.adapter';
import { CashWriteRepository } from './cash-write.repository';
import {
  CashScanRepository,
  type ScannedCard,
  type LockedScannedCard,
} from './cash-scan.repository';
import { resolveJourneyTemplate, renderTemplate } from './lifecycle-copy';
import {
  cardPolicyFields,
  rewardProfileWithSnapshot,
} from '../../shared/loyalty/reward-policy-presentation';
import { resolveRewardProfile } from '../../shared/loyalty/reward-profile';
import {
  bankedReward,
  cardRewardFields,
  isBaseReady,
  momentVars,
  visitMoment,
  type VisitMoment,
} from '../../shared/loyalty/reward-tiers';

const VISIT = 'VISIT';
const REDEEM = 'REDEEM';
/**
 * The early cash-out of the ladder's LOWER tier. Same bar, same card, different
 * arithmetic: it consumes the cycle (the card is torn off) instead of a banked
 * reward, so the cycle restarts at the customer's current stamp count.
 */
const REDEEM_BASE = 'REDEEM_BASE';
const BIRTHDAY = 'BIRTHDAY_REDEEM';
// umi-cash's order, kept: the birthday claim first, then a banked canje, then an
// early cash-out (which resets the cycle the visit below then lands on), then the
// visit. The order is load-bearing, not cosmetic.
const ACTION_ORDER = [BIRTHDAY, REDEEM, REDEEM_BASE, VISIT] as const;
type ScanAction = (typeof ACTION_ORDER)[number];

const DEFAULT_CUSTOMER_NAME = 'Cliente';
const DEFAULT_TZ = 'America/Mexico_City';

function tooMany(message: string): never {
  throw new HttpException({ error: message }, HttpStatus.TOO_MANY_REQUESTS);
}

export interface PreviewInput {
  qrPayload: string;
}

export interface SealsInput {
  cardId: string;
  seals: number;
  note?: string;
  idempotencyKey?: string;
}

export interface ScanInput {
  qrPayload: string;
  action?: string;
  actions?: string[];
  redeemQuantity?: number;
  externalReceiptNumber?: string;
  idempotencyKey?: string;
}

/**
 * Loyalty scan — visit / reward redeem / birthday redeem. Ported faithfully from
 * umi-cash scan/route.ts: fixed BIRTHDAY→REDEEM→VISIT order, all guards under
 * the card lock, reward-cycle math, lock-screen moment message, and QR-token
 * rotation. Touches loyalty STATE only — never money.
 */
@Injectable()
export class CashScanService {
  constructor(
    private readonly qr: QrService,
    private readonly cards: CashWriteRepository,
    private readonly repo: CashScanRepository,
    private readonly walletPass: WalletPassAdapter,
    private readonly email: EmailAdapter,
    private readonly integrity: IntegrityService,
  ) {}

  async scan(merchantId: string, userId: string, input: ScanInput) {
    let targetId = '';
    let recipientEmail: string | null = null;
    const execute = async (client?: PoolClient, commandId?: string) => {
      const target = await this.resolveScanTarget(merchantId, input.qrPayload, true, client);
      targetId = target.card.id;
      recipientEmail = target.card.normalized_email;
      const userPersonId = client ? userId : await this.cards.getUserPersonId(userId);
      return this.repo.withLockedCard(
        merchantId,
        targetId,
        (c, card) =>
          this.scanLocked(
            merchantId,
            userId,
            input,
            card,
            target.qrData,
            c,
            userPersonId,
            commandId,
          ),
        client,
      );
    };
    let response: Awaited<ReturnType<CashScanService['scanLocked']>>;
    let replayed = false;
    if (input.idempotencyKey) {
      const command = await this.integrity.execute(
        {
          merchantId,
          locationId: null,
          commandId: randomUUID(),
          idempotencyKey: input.idempotencyKey,
          commandType: 'cash.loyalty.scan',
          payload: {
            actorUserId: userId,
            qrPayload: input.qrPayload,
            actions: [...new Set(input.actions ?? (input.action ? [input.action] : []))].sort(),
            redeemQuantity: input.redeemQuantity ?? 1,
            externalReceiptNumber: input.externalReceiptNumber?.trim() ?? null,
          },
        },
        async ({ client, commandId }) => {
          const result = await execute(client, commandId);
          // The command journal redacts cardNumber keys. Use the storage name for this public display field.
          const { cardNumber, ...customer } = result.customer;
          return {
            ok: true,
            value: {
              ...result,
              customer: { ...customer, displayIdentifier: cardNumber },
              targetId,
              recipientEmail,
            },
          };
        },
      );
      if (!command.result)
        throw new ConflictException(command.failureCode ?? 'scan_command_failed');
      const {
        targetId: storedTarget,
        recipientEmail: storedEmail,
        customer: storedCustomer,
        ...storedResponse
      } = command.result;
      const { displayIdentifier, ...customer } = storedCustomer;
      targetId = storedTarget;
      recipientEmail = storedEmail;
      response = { ...storedResponse, customer: { ...customer, cardNumber: displayIdentifier } };
      replayed = command.duplicate;
      if (response.redemption) response.redemption = { ...response.redemption, replayed };
    } else {
      response = await execute();
    }
    if (!replayed) {
      void this.walletPass.refreshCard(targetId);
      if (response.rewardEarned && recipientEmail) {
        const cfg = await this.repo.merchantConfig(merchantId);
        const profileRows = await this.repo.rewardProfileRows(merchantId, targetId);
        const profile = resolveRewardProfile(
          profileRows.defaultConfig,
          profileRows.overrideConfig,
          profileRows.upgradeConfig,
        );
        const earnedName = response.card.availableRewards[0]?.rewardName ?? profile.rewardName;
        void this.email.send({
          to: recipientEmail,
          subject: `¡Ganaste ${earnedName}!`,
          html: `<p>${response.customer.name ?? 'Cliente'}, ganaste <strong>${earnedName}</strong> en ${cfg?.name ?? ''}. Pasa a canjearla.</p>`,
        });
      }
    }
    return response;
  }

  private async scanLocked(
    merchantId: string,
    userId: string,
    input: ScanInput,
    card: LockedScannedCard,
    qrData: Awaited<ReturnType<QrService['verifyQRPayload']>>,
    client: PoolClient,
    userPersonId: string | null,
    commandId?: string,
  ) {
    const requested = new Set<string>(input.actions ?? (input.action ? [input.action] : []));
    if (requested.size === 0) {
      throw new BadRequestException('action or actions required');
    }
    if ([...requested].some((action) => !ACTION_ORDER.includes(action as ScanAction)))
      throw new BadRequestException('Unknown scan action');
    if (
      input.redeemQuantity !== undefined &&
      (!Number.isInteger(input.redeemQuantity) ||
        input.redeemQuantity < 1 ||
        input.redeemQuantity > 50)
    ) {
      throw new BadRequestException('Invalid redemption quantity');
    }
    const actionList = ACTION_ORDER.filter((a) => requested.has(a));
    const includesVisit = actionList.includes(VISIT);
    const includesRedeem = actionList.includes(REDEEM);
    const includesRedeemBase = actionList.includes(REDEEM_BASE);
    const includesBirthday = actionList.includes(BIRTHDAY);

    if (includesRedeem && includesRedeemBase) {
      throw new BadRequestException('Choose one stamp redemption action');
    }
    if (qrData && !qrData.isWalletScan && card.qr_token !== qrData.qrToken) {
      throw new BadRequestException(
        'Código QR ya fue usado. Pídele al cliente que actualice su código.',
      );
    }
    const enabled = card.reward_policy === 'single_cycle';
    if (enabled && includesVisit && (includesRedeem || includesRedeemBase)) {
      throw new BadRequestException('Visit and stamp redemption must be separate');
    }
    if (enabled && (includesRedeem || includesRedeemBase)) {
      if (!input.externalReceiptNumber?.trim() || !input.idempotencyKey?.trim()) {
        throw new BadRequestException('Receipt number and idempotency key required');
      }
      if (includesRedeemBase && (input.redeemQuantity ?? 1) !== 1)
        throw new BadRequestException('Cycle quantity must be one');
      const quantity = input.redeemQuantity ?? 1;
      if (includesRedeem && quantity > 1 && quantity > (card.legacy_pending_rewards ?? 0)) {
        throw new BadRequestException('Quantity exceeds the legacy reward balance');
      }
      if (
        includesRedeem &&
        card.visits_this_cycle < 9 &&
        quantity > (card.legacy_pending_rewards ?? 0)
      ) {
        throw new BadRequestException('Quantity exceeds the legacy reward balance');
      }
      if (includesRedeem && card.visits_this_cycle < 9 && !card.legacy_pending_rewards) {
        throw new BadRequestException('Upper reward requires nine visits');
      }
    }

    if (enabled && includesVisit && (card.visit_blocked_reason || card.visits_this_cycle >= 9)) {
      throw new BadRequestException('Redeem the available reward before another visit');
    }
    // Wallet replay: block a 2nd visit within 60s of a static-barcode scan.
    if (qrData?.isWalletScan && includesVisit) {
      if (await this.repo.recentVisitWithin(merchantId, card.id, 60, client)) {
        tooMany('Visita ya registrada recientemente. Espera un momento.');
      }
    }

    const [staff, cfg] = await Promise.all([
      this.repo.authenticatedStaff(client, merchantId, userId),
      this.repo.merchantConfig(merchantId, client),
    ]);
    const staffMemberId = staff?.id ?? null;
    if (enabled && (includesRedeem || includesRedeemBase) && !staffMemberId) {
      throw new ForbiddenException('Tu usuario no está registrado como personal');
    }
    if (userPersonId && userPersonId === card.person_id) {
      throw new ForbiddenException({ error: 'No puedes escanear tu propia tarjeta' });
    }

    const tz = cfg?.timezone || DEFAULT_TZ;
    const afterHours = includesVisit && (await this.repo.isAfterHours(merchantId, tz, client));

    if (includesVisit) {
      if (await this.repo.visitedToday(merchantId, card.id, tz, client)) {
        tooMany('Ya se registró una visita hoy');
      }
    }

    // The card's reward profile — the café's ladder (standard + optional upgrade)
    // plus any per-card override. `visitsRequired` is the tier the CYCLE runs to,
    // so a café on a 7/9 ladder counts to 9 and offers the 7-tier as an early
    // cash-out, exactly as umi-cash did.
    const profileRows = await this.repo.rewardProfileRows(merchantId, card.id, client);
    const profile = rewardProfileWithSnapshot(
      resolveRewardProfile(
        profileRows.defaultConfig,
        profileRows.overrideConfig,
        profileRows.upgradeConfig,
      ),
      card,
    );
    const visitsRequired = profile.visitsRequired;
    const rewardName = profile.rewardName;

    const activeBirthday = await this.repo.activeBirthdayReward(merchantId, card.id, client);
    if (includesBirthday && !activeBirthday) {
      throw new BadRequestException({ error: 'No hay regalo de cumpleaños activo' });
    }

    if (includesRedeem) {
      if (card.pending_rewards <= 0) {
        throw new BadRequestException({ error: 'No hay recompensas pendientes para canjear' });
      }
      // Which tier this redemption hands over. A banked reward is the top tier —
      // unless the card still carries pre-ladder tags, in which case the older
      // rewards were earned under the single threshold and are the LOWER tier.
      if (!enabled && !bankedReward(profile, card.pending_tier1).configId) {
        throw new BadRequestException({ error: 'No hay configuración de recompensa activa' });
      }
      if (await this.repo.recentRedemptionWithin(merchantId, card.id, 30, client)) {
        tooMany('Recompensa ya canjeada. Espera un momento si deseas canjear otra.');
      }
    }
    const banked = includesRedeem ? bankedReward(profile, card.pending_tier1) : null;

    // The EARLY CASH-OUT. The customer may take the lower tier as soon as she has
    // reached its threshold, instead of stamping on toward the upper one — and the
    // card is torn off, which is what makes this a different write from a banked
    // canje. Refused before that threshold, exactly as umi-cash refused it.
    if (includesRedeemBase) {
      if (enabled && card.base_reward_blocked_by_history)
        throw new BadRequestException('Redeem historical rewards first');
      const base = profile.baseTier;
      if (!base || (!enabled && !base.configId)) {
        throw new BadRequestException({ error: 'Este café no tiene un segundo nivel activo' });
      }
      if (
        !isBaseReady(profile, card.visits_this_cycle) ||
        (enabled && (!card.cycle_reward_available || card.visits_this_cycle >= 9))
      ) {
        throw new BadRequestException({
          error: `Aún no llega a ${base.visitsRequired} visitas para ${base.rewardName}`,
        });
      }
      if (await this.repo.recentRedemptionWithin(merchantId, card.id, 30, client)) {
        tooMany('Recompensa ya canjeada. Espera un momento si deseas canjear otra.');
      }
    }

    const customerName = card.display_name ?? null;

    // Reward-cycle math (only meaningful on visit).
    //
    // ⚠️ WHICH CYCLE THE VISIT LANDS ON. When the barista cashes the lower tier out in
    // the same tap, the card has already been TORN OFF: umi-cash called the position
    // it counted from `cycleNow` and set it to zero in the cash-out step, so the visit
    // that follows is the first stamp of the NEW cycle. Reading the pre-scan position
    // here made a card at 8/9 with an early cash-out announce that the customer had
    // earned the top tier — a reward nobody handed over, printed on her lock screen.
    // (Found by the live rehearsal in REGISTER_FLIP_PARITY.md, not by a test.)
    const cycleBeforeVisit = includesRedeemBase ? 0 : card.visits_this_cycle;
    const newVisitsThisCycle = cycleBeforeVisit + 1;
    const newTotalVisits = card.total_visits + 1;
    const earnedReward = includesVisit && newVisitsThisCycle >= visitsRequired;

    // The scan's single "moment" — the one lifecycle message this interaction
    // leaves on the card, and on Apple the pass's ONLY notification channel. A
    // redeem claims the slot first; a visit then outranks it when the visit is
    // itself the headline (a reward earned, or the lower tier coming within reach)
    // and otherwise only fills an empty slot. That is umi-cash's precedence:
    // reward_earned > base_reward_ready > reward_redeemed > first_visit >
    // milestone_one_left > milestone_halfway > visit_recorded.
    // A banked canje and an early cash-out both leave `reward_redeemed`, naming the
    // tier that left the bar. The early one resets the cycle it was running, so the
    // moment reports the position the customer now holds: zero.
    let moment: VisitMoment | null = null;
    if (banked) {
      moment = {
        journey: 'reward_redeemed',
        rewardName: banked.rewardName,
        visitsRequired,
        visitsThisCycle: card.visits_this_cycle,
      };
    } else if (includesRedeemBase && profile.baseTier) {
      moment = {
        journey: 'reward_redeemed',
        rewardName: profile.baseTier.rewardName,
        visitsRequired: profile.baseTier.visitsRequired,
        visitsThisCycle: 0,
      };
    }
    if (includesVisit) {
      const visitM = visitMoment(profile, {
        newVisitsThisCycle,
        earnedReward,
        isFirstVisitEver: newTotalVisits === 1,
      });
      if (earnedReward || visitM.journey === 'base_reward_ready' || moment === null)
        moment = visitM;
    }
    // Rendered with the same variables umi-cash's copy uses — including the ladder
    // extras, so café copy may name the upper tier.
    const momentMessage = moment
      ? renderTemplate(resolveJourneyTemplate(cfg?.lifecycleCopy, moment.journey), {
          ...momentVars(profile, moment, {
            name: customerName || DEFAULT_CUSTOMER_NAME,
            tenant: cfg?.name ?? '',
          }),
        })
      : null;

    const updated = await this.repo.performScan(
      {
        merchantId,
        cardId: card.id,
        staffMemberId,
        doBirthday: includesBirthday && !!activeBirthday,
        birthdayRewardId: activeBirthday?.id ?? null,
        doRedeem: includesRedeem || includesRedeemBase,
        // A banked canje hands over the tier it is owed; an early cash-out always hands
        // over the LOWER one, which is the whole point of the action.
        rewardConfigId: banked?.configId ?? profile.baseTier?.configId ?? null,
        decrementPendingTier1: !!banked?.isBase,
        // Only one of the two canjes can be in one action list, and only the early one
        // moves the cycle. `rewardConfigId` above carries the tier either way.
        resetCycle: includesRedeemBase,
        doVisit: includesVisit,
        earnedReward,
        newVisitsThisCycle,
        momentMessage,
        newQrToken: this.qr.generateRandomToken(),
        redeemQuantity: input.redeemQuantity ?? 1,
        externalReceiptNumber: input.externalReceiptNumber?.trim(),
        commandId,
      },
      client,
    );

    const performed = actionList as readonly ScanAction[];

    const committedRewardName = updated.redemptionResult
      ? [...new Set(updated.redemptionResult.items.map((item) => item.rewardName))].join(' / ')
      : rewardName;
    if (updated.redemptionResult) {
      const committedMoment: VisitMoment = {
        journey: 'reward_redeemed',
        rewardName: committedRewardName,
        visitsRequired,
        visitsThisCycle: updated.visits_this_cycle,
      };
      await this.repo.writeLifecycleMessage(
        client,
        merchantId,
        card.id,
        renderTemplate(resolveJourneyTemplate(cfg?.lifecycleCopy, committedMoment.journey), {
          ...momentVars(profile, committedMoment, {
            name: customerName || DEFAULT_CUSTOMER_NAME,
            tenant: cfg?.name ?? '',
          }),
        }),
      );
    }
    const message = this.composeMessage(
      performed,
      updated,
      visitsRequired,
      committedRewardName,
      updated.redemptionResult ? committedRewardName : (profile.baseTier?.rewardName ?? null),
      cfg?.birthdayRewardName ?? null,
      customerName,
      earnedReward,
    );

    return {
      success: true,
      actions: performed,
      message,
      rewardEarned: enabled ? updated.pending_rewards > card.pending_rewards : earnedReward,
      afterHours,
      customer: { name: customerName, cardNumber: updated.card_number },
      card: {
        visitsThisCycle: updated.visits_this_cycle,
        visitsRequired,
        pendingRewards: updated.pending_rewards,
        balanceMXN: formatMxn2(updated.balance_cents),
        ...this.policyFields(updated),
      },
      ...(updated.redemptionResult && staff
        ? {
            redemption: {
              operationId: commandId ?? updated.redemptionResult.redemptionIds[0],
              quantity: updated.redemptionResult.quantity,
              remainingRewards: updated.pending_rewards,
              externalReceiptNumber: input.externalReceiptNumber?.trim() ?? null,
              operator: { id: staff.id, name: staff.name },
              redeemedAt: updated.redemptionResult.redeemedAt,
              replayed: false,
              items: Object.values(
                updated.redemptionResult.items.reduce<
                  Record<string, { rewardName: string; quantity: number }>
                >(
                  (groups, item) => {
                    const group = groups[item.rewardName] ?? {
                      rewardName: item.rewardName,
                      quantity: 0,
                    };
                    group.quantity++;
                    groups[item.rewardName] = group;
                    return groups;
                  },
                  Object.create(null) as Record<string, { rewardName: string; quantity: number }>,
                ),
              ),
            },
          }
        : {}),
      birthdayReward:
        !includesBirthday && activeBirthday
          ? { id: activeBirthday.id, rewardName: cfg?.birthdayRewardName ?? null }
          : null,
    };
  }

  /**
   * Resolve what staff captured to a card. Preview and commit both call this, and
   * they must never disagree: umi-cash shipped a bug where a phone number
   * previewed and then failed on commit, because only the commit demanded a
   * signed payload (`scan-resolve.ts`). One resolver makes that impossible.
   *
   * Order: a verified QR payload, else a card number, else a phone. Manual entry
   * carries no token, like a wallet barcode, so `qrData` is null and the
   * freshness rule does not apply to it.
   */
  private async resolveScanTarget(
    merchantId: string,
    qrPayload: string,
    deferFreshness = false,
    client?: PoolClient,
  ) {
    const qrData = await this.qr.verifyQRPayload(qrPayload);
    if (client) {
      const card = await this.repo.findScanTarget(
        client,
        merchantId,
        qrData?.cardId ?? qrPayload.trim(),
        !qrData,
      );
      if (!card) throw new NotFoundException({ error: 'Tarjeta no encontrada' });
      return { card, qrData };
    }

    if (qrData) {
      const card = await this.cards.findCard(merchantId, qrData.cardId);
      if (!card) throw new NotFoundException({ error: 'Tarjeta no encontrada' });
      // Single-use rotating-token check for in-app QR (wallet barcodes skip it).
      if (!deferFreshness && !qrData.isWalletScan && card.qr_token !== qrData.qrToken) {
        throw new BadRequestException({
          error: 'Código QR ya fue usado. Pídele al cliente que actualice su código.',
        });
      }
      return { card, qrData };
    }

    const typed = qrPayload.trim();
    const byNumber = await this.cards.findCard(merchantId, typed);
    if (byNumber) return { card: byNumber, qrData: null };

    const person = await this.cards.findPersonCard(merchantId, { phone: typed });
    if (person) {
      const card = await this.cards.findCard(merchantId, person.cardId);
      if (card) return { card, qrData: null };
    }

    throw new NotFoundException({ error: 'Tarjeta no encontrada' });
  }

  /**
   * Undo a canje — the customer screen's two-tap revert.
   *
   * ADMIN-only, by the café owner's request: staff may redeem, only the owner may
   * un-redeem, so an accidental canje has a supervised undo instead of a support
   * ticket. The button that calls this is hidden from staff by the screen itself
   * (`viewerIsAdmin` on the customer detail), and the API refuses it anyway — the
   * client hides, the API decides.
   *
   * WHICH TIER COMES BACK. On a ladder, undoing a canje of the LOWER tier restores
   * a banked lower-tier reward: that canje consumed the early cash-out, the visits
   * it took are gone, and a banked capuccino is the honest restoration. Anything
   * else comes back as the tier the cycle banks. umi-cash decided this by comparing
   * the redemption's config against the profile's base tier, and so does this.
   */
  async revertRedemption(merchantId: string, userId: string, redemptionId: string) {
    const redemption = await this.repo.findRedemption(merchantId, redemptionId);
    if (!redemption) throw new NotFoundException({ error: 'Canje no encontrado' });

    // Fail closed on attribution: a reversal is value-bearing, so it must name a
    // real staff member — the same stance as the top-up and bulk-seal paths.
    const staffMemberId = await this.cards.getStaffMemberId(merchantId, userId);
    if (!staffMemberId) {
      throw new ForbiddenException({ error: 'Tu usuario no está registrado como personal' });
    }

    const profileRows = await this.repo.rewardProfileRows(merchantId, redemption.cardId);
    const profile = resolveRewardProfile(
      profileRows.defaultConfig,
      profileRows.overrideConfig,
      profileRows.upgradeConfig,
    );
    const revertsBaseTier =
      redemption.isBase ??
      (!!profile.baseTier?.configId && redemption.rewardId === profile.baseTier.configId);
    const rewardName =
      redemption.rewardName ??
      (revertsBaseTier ? profile.baseTier!.rewardName : profile.rewardName);

    const { alreadyReverted, card } = await this.repo.revertRedemption({
      merchantId,
      redemptionId,
      userId,
      cardId: redemption.cardId,
      staffMemberId,
      restoreBaseTier: revertsBaseTier,
      // An early cash-out never consumed a banked reward, so undoing one has to hand
      // a banked reward back explicitly (see CashScanRepository.revertRedemption).
      restoreEarnedReward: redemption.cycleReset,
      message: `Te devolvimos tu ${rewardName} — está lista para canjear de nuevo 🎁`,
    });
    if (!card) {
      throw new ConflictException({ error: 'Este canje ya fue revertido' });
    }

    // The reversal is committed; the wallet refresh must not delay the response.
    if (!alreadyReverted) void this.walletPass.refreshCard(redemption.cardId);

    return {
      success: true,
      message: `Canje revertido — ${rewardName} devuelta al cliente`,
      pendingRewards: card.pending_rewards,
    };
  }

  /**
   * Read a card and change nothing. The register calls this before it commits a
   * visit, so staff see who the customer is and what the scan will do.
   *
   * The identifier is whatever the register captured: a QR payload from the
   * camera, or a card number typed by hand. A payload that fails QR verification
   * is tried as a card number, because an expired code and an unknown card must
   * not look the same to staff.
   */
  async preview(merchantId: string, userId: string, input: PreviewInput) {
    const { card } = await this.resolveScanTarget(merchantId, input.qrPayload);

    const [cfg, profileRows, userPersonId] = await Promise.all([
      this.repo.merchantConfig(merchantId),
      this.repo.rewardProfileRows(merchantId, card.id),
      this.cards.getUserPersonId(userId),
    ]);
    const profile = rewardProfileWithSnapshot(
      resolveRewardProfile(
        profileRows.defaultConfig,
        profileRows.overrideConfig,
        profileRows.upgradeConfig,
      ),
      card,
    );

    // Same refusal as the scan itself. Preview leads straight to the commit
    // button, so letting staff read their own card here only moves the block one
    // tap later.
    if (userPersonId && userPersonId === card.person_id) {
      throw new ForbiddenException({ error: 'No puedes escanear tu propia tarjeta' });
    }

    const tz = cfg?.timezone || DEFAULT_TZ;
    const [lastVisitAt, activeBirthday] = await Promise.all([
      this.repo.lastVisitToday(merchantId, card.id, tz),
      this.repo.activeBirthdayReward(merchantId, card.id),
    ]);

    return {
      cardId: card.id,
      cardNumber: card.card_number,
      customer: { id: card.person_id, name: card.display_name ?? null },
      card: {
        visitsThisCycle: card.visits_this_cycle,
        pendingRewards: card.pending_rewards,
        balanceMXN: formatMxn2(card.balance_cents),
        balanceCentavos: card.balance_cents,
        // visitsRequired / rewardName (cycle values) + baseReward / pendingRewardName
        // (ladder) — the register draws "puede canjear {baseReward.rewardName} ya"
        // from these, which is the button that hands over the lower tier.
        ...cardRewardFields(profile, {
          visitsThisCycle: card.visits_this_cycle,
          pendingTier1: card.pending_tier1,
          rewardPolicy: card.reward_policy,
          cycleRewardAvailable: card.cycle_reward_available,
          availableRewards: card.available_rewards,
          baseRewardBlockedByHistory: card.base_reward_blocked_by_history,
        }),
        ...cardPolicyFields(card),
        visitLimitReached: lastVisitAt !== null || !!card.visit_blocked_reason,
        lastVisitAt: iso(lastVisitAt),
      },
      birthdayReward: activeBirthday
        ? { id: activeBirthday.id, rewardName: cfg?.birthdayRewardName ?? null }
        : null,
    };
  }

  /**
   * "Agregar sellos" — credit several stamps in one action.
   *
   * WHY THIS EXISTS. Kalala migrated from an external loyalty provider whose
   * stamps we cannot import. Staff read the count off the customer's old card on
   * site and enter it here, once. Without it every migrated customer silently
   * restarts at zero, and the customer sees that on her own phone.
   *
   * It is a manual, value-bearing credit, so every guard below is a refusal:
   * the café must have the path enabled, the card must be the café's, and the
   * operator must be a real staff member — an unattributable bulk credit is not
   * written at all.
   *
   * It deliberately does NOT observe the once-per-day visit cap. That cap stops a
   * customer being stamped twice for one coffee; this is a correction for coffees
   * already bought elsewhere, and it is the whole point that it lands today.
   */
  async seals(merchantId: string, userId: string, input: SealsInput) {
    const userPersonId = await this.cards.getUserPersonId(userId);
    const execute = (client?: PoolClient) =>
      this.repo.withLockedCard(
        merchantId,
        input.cardId,
        (c, card) => this.sealsLocked(merchantId, userId, input, card, c, userPersonId),
        client,
      );
    if (input.idempotencyKey) {
      const command = await this.integrity.execute(
        {
          merchantId,
          locationId: null,
          commandId: randomUUID(),
          idempotencyKey: input.idempotencyKey,
          commandType: 'cash.loyalty.credit',
          payload: {
            actorUserId: userId,
            cardId: input.cardId,
            seals: input.seals,
            note: input.note ?? null,
          },
        },
        async ({ client }) => ({ ok: true, value: await execute(client) }),
      );
      if (!command.result)
        throw new ConflictException(command.failureCode ?? 'credit_command_failed');
      if (!command.duplicate) void this.walletPass.refreshCard(input.cardId);
      return command.result;
    }
    const result = await execute();
    void this.walletPass.refreshCard(input.cardId);
    return result;
  }

  private async sealsLocked(
    merchantId: string,
    userId: string,
    input: SealsInput,
    card: LockedScannedCard,
    client: PoolClient,
    userPersonId: string | null,
  ) {
    const cfg = await this.repo.merchantConfig(merchantId, client);
    // Defence in depth — the register already hides the control when it is off.
    if (!cfg?.multiSealEnabled) {
      throw new ForbiddenException({ error: 'Función no habilitada' });
    }

    const staff = await this.repo.authenticatedStaff(client, merchantId, userId);
    const staffMemberId = staff?.id ?? null;
    // Fail closed on attribution: a bulk credit is the most abusable write in the
    // register, so it must name the staff member who made it.
    if (!staffMemberId) {
      throw new ForbiddenException({ error: 'Tu usuario no está registrado como personal' });
    }
    // Same refusal the scan makes, and it matters more here: a scan credits one
    // stamp to yourself, this credits fifty. umi-cash checks it on the scan only.
    if (userPersonId && userPersonId === card.person_id) {
      throw new ForbiddenException({ error: 'No puedes escanear tu propia tarjeta' });
    }

    const enabled = card.reward_policy === 'single_cycle';
    if (enabled && (card.visit_blocked_reason || card.visits_this_cycle + input.seals > 9)) {
      throw new BadRequestException('Credit exceeds the remaining cycle capacity');
    }
    // The moment the credit leaves on the card — the legacy seals route wrote one, and
    // it is the pass's only notification channel. Without it the customer's lock screen
    // keeps whatever the last scan said, and (worse) Apple has nothing to fetch.
    const profileRows = await this.repo.rewardProfileRows(merchantId, card.id, client);
    const profile = rewardProfileWithSnapshot(
      resolveRewardProfile(
        profileRows.defaultConfig,
        profileRows.overrideConfig,
        profileRows.upgradeConfig,
      ),
      card,
    );
    const required = profile.visitsRequired;
    const newVisitsThisCycle = enabled
      ? card.visits_this_cycle + input.seals
      : (card.visits_this_cycle + input.seals) % required;
    const moment = visitMoment(profile, {
      newVisitsThisCycle,
      earnedReward: card.visits_this_cycle + input.seals >= required,
      isFirstVisitEver: card.total_visits + input.seals === input.seals,
    });
    const momentMessage = renderTemplate(
      resolveJourneyTemplate(cfg?.lifecycleCopy, moment.journey),
      momentVars(profile, moment, {
        name: card.display_name ?? DEFAULT_CUSTOMER_NAME,
        tenant: cfg?.name ?? '',
      }),
    );

    const credited = await this.repo.creditSeals(
      {
        merchantId,
        cardId: card.id,
        staffMemberId,
        seals: input.seals,
        note: input.note ?? null,
        // Kept NULL when the register sends none. Minting one here would look like
        // idempotency and provide none — a fresh key can never match a retry.
        idempotencyKey: input.idempotencyKey ?? null,
        momentMessage,
      },
      client,
    );

    // Rewards THIS action minted: how many thresholds the credit crossed from
    // where the cycle stood. No divide-by-zero guard, because there is nothing
    // left to guard — the threshold arrives from the derived-state query, which
    // took the same modulo first and would have raised before returning.
    const creditedRequired = credited.visitsRequired;
    const rewardsEarned = credited.replayed
      ? 0
      : enabled
        ? Number(credited.cycleBefore < 7 && credited.card.cycle_reward_available)
        : Math.floor((credited.cycleBefore + input.seals) / creditedRequired);

    return {
      success: true,
      seals: input.seals,
      rewardsEarned,
      message: this.composeSealsMessage(input.seals, rewardsEarned, credited.replayed),
      card: {
        visitsThisCycle: credited.card.visits_this_cycle,
        visitsRequired: required,
        pendingRewards: credited.card.pending_rewards,
        balanceMXN: formatMxn2(credited.card.balance_cents),
        ...cardPolicyFields(credited.card),
      },
    };
  }

  private policyFields(card: ScannedCard) {
    return cardPolicyFields(card);
  }

  private composeSealsMessage(seals: number, rewardsEarned: number, replayed: boolean): string {
    const one = seals === 1;
    const sealWord = one ? 'sello' : 'sellos';
    // umi-cash says "Estos sello ya se habían registrado" for a credit of one.
    // The determiner and the verb have to agree with the noun, so they do here.
    if (replayed) {
      return one
        ? 'Este sello ya se había registrado'
        : `Estos ${sealWord} ya se habían registrado`;
    }

    let message = `${seals} ${sealWord} agregado${one ? '' : 's'}`;
    if (rewardsEarned > 0) {
      const plural = rewardsEarned === 1 ? '' : 's';
      message += ` · ¡${rewardsEarned} recompensa${plural} ganada${plural}!`;
    }
    return message;
  }

  private composeMessage(
    performed: readonly string[],
    updated: ScannedCard,
    visitsRequired: number,
    rewardName: string,
    baseRewardName: string | null,
    birthdayRewardName: string | null,
    customerName: string | null,
    earnedReward: boolean,
  ): string {
    const parts: string[] = [];
    if (performed.includes(BIRTHDAY)) {
      // Merchants without a configured birthday-reward name would otherwise render
      // the literal string "null" to the customer.
      parts.push(
        birthdayRewardName
          ? `🎂 Regalo de cumpleaños canjeado: ${birthdayRewardName}`
          : '🎂 Regalo de cumpleaños canjeado',
      );
    }
    if (performed.includes(REDEEM)) {
      parts.push(`✓ Recompensa canjeada: ${rewardName}`);
    }
    if (performed.includes(REDEEM_BASE)) {
      // The staff line has to say the card restarted, because that is what the
      // customer is about to see on her pass and the barista is about to be asked
      // about ("¿por qué mi tarjeta quedó en cero?").
      parts.push(`✓ ${baseRewardName ?? rewardName} canjeado en nivel 1 — tarjeta reiniciada`);
    }
    if (performed.includes(VISIT)) {
      const remaining = visitsRequired - updated.visits_this_cycle;
      if (earnedReward) {
        parts.push(`¡${customerName ?? 'Cliente'} ganó una recompensa! ${rewardName} disponible.`);
      } else {
        parts.push(
          `✓ Visita #${updated.total_visits} registrada. ${remaining} visita${remaining !== 1 ? 's' : ''} para ${rewardName}.`,
        );
      }
    }
    return parts.join(' · ') || 'Sin cambios';
  }
}
