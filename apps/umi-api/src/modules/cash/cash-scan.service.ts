import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { formatMxn2 } from '../../shared/format/money';
import { QrService } from '../../shared/auth/qr.service';
import { WalletPassAdapter } from '../../shared/adapters/wallet-pass.adapter';
import { EmailAdapter } from '../../shared/adapters/email.adapter';
import { CashWriteRepository } from './cash-write.repository';
import { CashScanRepository, type ScannedCard } from './cash-scan.repository';
import { resolveJourneyTemplate, renderTemplate, type LifecycleJourneyKey } from './lifecycle-copy';

const VISIT = 'VISIT';
const REDEEM = 'REDEEM';
const BIRTHDAY = 'BIRTHDAY_REDEEM';
const ACTION_ORDER = [BIRTHDAY, REDEEM, VISIT] as const;
type ScanAction = (typeof ACTION_ORDER)[number];

const DEFAULT_VISITS_REQUIRED = 10;
const DEFAULT_REWARD_NAME = 'Recompensa de temporada';
const DEFAULT_CUSTOMER_NAME = 'Cliente';
const DEFAULT_TZ = 'America/Mexico_City';

function tooMany(message: string): never {
  throw new HttpException({ error: message }, HttpStatus.TOO_MANY_REQUESTS);
}

export interface ScanInput {
  qrPayload: string;
  action?: string;
  actions?: string[];
}

/**
 * Loyalty scan — visit / reward redeem / birthday redeem. Ported faithfully from
 * umi-cash scan/route.ts: fixed BIRTHDAY→REDEEM→VISIT order, all guards before
 * the transaction, reward-cycle math, lock-screen moment message, and QR-token
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
  ) {}

  async scan(tenantId: string, userId: string, input: ScanInput) {
    const requested = new Set<string>(input.actions ?? (input.action ? [input.action] : []));
    if (requested.size === 0) {
      throw new BadRequestException('action or actions required');
    }
    const actionList = ACTION_ORDER.filter((a) => requested.has(a));
    const includesVisit = actionList.includes(VISIT);
    const includesRedeem = actionList.includes(REDEEM);
    const includesBirthday = actionList.includes(BIRTHDAY);

    const qrData = await this.qr.verifyQRPayload(input.qrPayload);
    if (!qrData) {
      throw new BadRequestException({ error: 'Código QR inválido o expirado' });
    }

    const card = await this.cards.findCard(tenantId, qrData.cardId);
    if (!card) throw new NotFoundException({ error: 'Tarjeta no encontrada' });

    // Single-use rotating-token check for in-app QR (wallet barcodes skip it).
    if (!qrData.isWalletScan && card.qr_token !== qrData.qrToken) {
      throw new BadRequestException({
        error: 'Código QR ya fue usado. Pídele al cliente que actualice su código.',
      });
    }

    // Wallet replay: block a 2nd visit within 60s of a static-barcode scan.
    if (qrData.isWalletScan && includesVisit) {
      if (await this.repo.recentVisitWithin(tenantId, card.id, 60)) {
        tooMany('Visita ya registrada recientemente. Espera un momento.');
      }
    }

    const [staffMemberId, userPersonId, cfg] = await Promise.all([
      this.cards.getStaffMemberId(tenantId, userId),
      this.cards.getUserPersonId(userId),
      this.repo.tenantConfig(tenantId),
    ]);
    if (userPersonId && userPersonId === card.person_id) {
      throw new ForbiddenException({ error: 'No puedes escanear tu propia tarjeta' });
    }

    const tz = cfg?.timezone || DEFAULT_TZ;
    const afterHours = includesVisit && (await this.repo.isAfterHours(tenantId, tz));

    if (includesVisit) {
      if (await this.repo.visitedToday(tenantId, card.id, tz)) {
        tooMany('Ya se registró una visita hoy');
      }
    }

    const rewardConfig = await this.repo.activeRewardConfig(tenantId);
    const visitsRequired = rewardConfig?.visits_required ?? DEFAULT_VISITS_REQUIRED;
    const rewardName = rewardConfig?.reward_name ?? DEFAULT_REWARD_NAME;

    const activeBirthday = await this.repo.activeBirthdayReward(tenantId, card.id);
    if (includesBirthday && !activeBirthday) {
      throw new BadRequestException({ error: 'No hay regalo de cumpleaños activo' });
    }

    if (includesRedeem) {
      if (card.pending_rewards <= 0) {
        throw new BadRequestException({ error: 'No hay recompensas pendientes para canjear' });
      }
      if (!rewardConfig) {
        throw new BadRequestException({ error: 'No hay configuración de recompensa activa' });
      }
      if (await this.repo.recentRedemptionWithin(tenantId, card.id, 30)) {
        tooMany('Recompensa ya canjeada. Espera un momento si deseas canjear otra.');
      }
    }

    const customerName = card.display_name ?? null;

    // Reward-cycle math (only meaningful on visit).
    const newVisitsThisCycle = card.visits_this_cycle + 1;
    const newTotalVisits = card.total_visits + 1;
    const earnedReward = includesVisit && newVisitsThisCycle >= visitsRequired;

    let momentMessage: string | null = null;
    if (includesVisit) {
      let journey: LifecycleJourneyKey | null = null;
      if (earnedReward) journey = 'reward_earned';
      else if (newTotalVisits === 1) journey = 'first_visit';
      else if (newVisitsThisCycle === visitsRequired - 1) journey = 'milestone_one_left';
      else if (visitsRequired >= 4 && newVisitsThisCycle === Math.floor(visitsRequired / 2)) {
        journey = 'milestone_halfway';
      }
      if (journey) {
        momentMessage = renderTemplate(resolveJourneyTemplate(cfg?.lifecycleCopy, journey), {
          name: customerName || DEFAULT_CUSTOMER_NAME,
          tenant: cfg?.name ?? '',
          rewardName,
          visitsThisCycle: earnedReward ? visitsRequired : newVisitsThisCycle,
          visitsRequired,
        });
      }
    }

    const updated = await this.repo.performScan({
      tenantId,
      cardId: card.id,
      staffMemberId,
      doBirthday: includesBirthday && !!activeBirthday,
      birthdayRewardId: activeBirthday?.id ?? null,
      doRedeem: includesRedeem,
      rewardConfigId: rewardConfig?.id ?? null,
      doVisit: includesVisit,
      earnedReward,
      newVisitsThisCycle,
      momentMessage,
      newQrToken: this.qr.generateRandomToken(),
    });

    const performed = actionList as readonly ScanAction[];

    // Reward-earned email — fire-and-forget, never blocks/fails the scan.
    if (earnedReward && card.normalized_email) {
      void this.email.send({
        to: card.normalized_email,
        subject: `¡Ganaste ${rewardName}!`,
        html: `<p>${customerName ?? 'Cliente'}, ganaste <strong>${rewardName}</strong> en ${cfg?.name ?? ''}. Pasa a canjearla.</p>`,
      });
    }
    void this.walletPass.refreshCard(card.id);

    const message = this.composeMessage(
      performed,
      updated,
      visitsRequired,
      rewardName,
      cfg?.birthdayRewardName ?? null,
      customerName,
      earnedReward,
    );

    return {
      success: true,
      actions: performed,
      message,
      rewardEarned: earnedReward,
      afterHours,
      customer: { name: customerName, cardNumber: updated.card_number },
      card: {
        visitsThisCycle: updated.visits_this_cycle,
        visitsRequired,
        pendingRewards: updated.pending_rewards,
        balanceMXN: formatMxn2(updated.balance_cents),
      },
      birthdayReward:
        !includesBirthday && activeBirthday
          ? { id: activeBirthday.id, rewardName: cfg?.birthdayRewardName ?? null }
          : null,
    };
  }

  private composeMessage(
    performed: readonly string[],
    updated: ScannedCard,
    visitsRequired: number,
    rewardName: string,
    birthdayRewardName: string | null,
    customerName: string | null,
    earnedReward: boolean,
  ): string {
    const parts: string[] = [];
    if (performed.includes(BIRTHDAY)) {
      // Tenants without a configured birthday-reward name would otherwise render
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
