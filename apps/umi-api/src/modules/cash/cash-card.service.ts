import { Injectable, NotFoundException } from '@nestjs/common';
import QRCode from 'qrcode';
import { formatMxn2 } from '../../shared/format/money';
import { QrService } from '../../shared/auth/qr.service';
import { CashCardRepository } from './cash-card.repository';
import { CashScanRepository } from './cash-scan.repository';

const DEFAULT_VISITS_REQUIRED = 10;
const DEFAULT_REWARD_NAME = 'Recompensa de temporada';
const RECENT_LIMIT = 5;
/** The QR is signed for five minutes; the page counts down against this. */
const QR_TTL_MS = 5 * 60 * 1000;

/**
 * The customer's own card — what she sees on her phone.
 *
 * Two routes, one subject. `card()` is the page; `qr()` is the code she holds up
 * at the counter, refetched every five minutes because the token expires.
 */
@Injectable()
export class CashCardService {
  constructor(
    private readonly repo: CashCardRepository,
    private readonly scan: CashScanRepository,
    private readonly qrService: QrService,
  ) {}

  async card(merchantId: string, customerId: string, merchantName: string) {
    const card = await this.repo.cardForCustomer(merchantId, customerId);
    if (!card) throw new NotFoundException({ error: 'Tarjeta no encontrada' });

    const [state, rewardConfig, recentVisits, recentLedger] = await Promise.all([
      this.repo.cardState(merchantId, card.id),
      this.scan.activeRewardConfig(merchantId),
      this.repo.recentVisits(merchantId, card.id, RECENT_LIMIT),
      this.repo.recentLedger(merchantId, card.id, RECENT_LIMIT),
    ]);
    // The card exists and its state does not: only a delete between the two
    // reads. Answer the same way as a missing card rather than render zeroes.
    if (!state) throw new NotFoundException({ error: 'Tarjeta no encontrada' });

    const visitsRequired = rewardConfig?.visits_required ?? DEFAULT_VISITS_REQUIRED;

    return {
      cardId: card.id,
      cardNumber: state.card_number,
      customerName: card.customer_name,
      tenantName: merchantName,
      balanceCentavos: state.balance_cents,
      balanceMXN: formatMxn2(state.balance_cents),
      totalVisits: state.total_visits,
      visitsThisCycle: state.visits_this_cycle,
      visitsRequired,
      pendingRewards: state.pending_rewards,
      rewardName: rewardConfig?.reward_name ?? DEFAULT_REWARD_NAME,
      rewardDescription: rewardConfig?.reward_description ?? null,
      // Capped, because a cycle can overshoot its threshold between the visit
      // that crossed it and the redemption that clears it.
      progressPercent: Math.min(Math.round((state.visits_this_cycle / visitsRequired) * 100), 100),
      recentVisits: recentVisits.map((v) => ({ id: v.id, scannedAt: v.occurred_at.toISOString() })),
      recentTransactions: recentLedger.map((t) => ({
        id: t.id,
        // umi-cash called this `type` and build-v3 calls it `reason`. The name on
        // the wire is the one the card page already reads, so it stays `type`.
        type: t.reason,
        amountCentavos: t.delta,
        description: t.note,
        createdAt: t.created_at.toISOString(),
      })),
    };
  }

  /**
   * The rotating in-app QR.
   *
   * It carries the card id and the card's CURRENT nonce, and the register checks
   * that nonce against the row — so a screenshot stops working as soon as the
   * card is scanned once, on top of the token's own five-minute expiry.
   *
   * A card with no nonce signs an empty one, exactly as umi-cash does. That code
   * will not pass the register's freshness check, and minting a token here would
   * be a write on a read — the backfill carries `qr_token`, so a card without one
   * is a data question, not something this route should paper over.
   */
  async qr(merchantId: string, customerId: string) {
    const card = await this.repo.cardForCustomer(merchantId, customerId);
    if (!card) throw new NotFoundException({ error: 'Tarjeta no encontrada' });

    const payload = await this.qrService.signQRPayload(card.id, card.qr_token ?? '');
    const dataUrl = await QRCode.toDataURL(payload, {
      width: 300,
      margin: 2,
      color: { dark: '#1F1410', light: '#FFFFFF' },
      errorCorrectionLevel: 'M',
    });

    return {
      payload,
      dataUrl,
      expiresAt: new Date(Date.now() + QR_TTL_MS).toISOString(),
    };
  }
}
