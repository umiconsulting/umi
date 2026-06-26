import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { formatMxn2 } from '../../shared/format/money';
import { WalletPassAdapter } from '../../shared/adapters/wallet-pass.adapter';
import {
  CashWriteRepository,
  CardNotFoundError,
  GiftCardAlreadyRedeemedError,
  InsufficientBalanceError,
} from './cash-write.repository';

// Ported limits from umi-cash (centavos).
const MAX_TOPUP_CENTAVOS = 1_000_000; // $10,000
const STAFF_DAILY_TOPUP_LIMIT = 500_000; // $5,000 / staff / day
const CARD_DAILY_TOPUP_LIMIT = 500_000; // $5,000 / card / day
const MAX_TOPUPS_PER_CARD_PER_DAY = 3;

function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('hex');
}

function generateGiftCode(): string {
  const hex = randomToken(16).toUpperCase(); // 32 hex chars
  return hex.match(/.{1,4}/g)!.join('-');
}

function tooMany(message: string): never {
  throw new HttpException({ error: message }, HttpStatus.TOO_MANY_REQUESTS);
}

/**
 * Customer-facing cash writes (live). Ports the umi-cash route logic onto the
 * canonical loyalty schema via CashWriteRepository (the single wallet write path).
 * After each money write the wallet pass is refreshed best-effort (never blocks
 * or fails the write).
 */
@Injectable()
export class CashWriteService {
  constructor(
    private readonly repo: CashWriteRepository,
    private readonly walletPass: WalletPassAdapter,
  ) {}

  async topup(
    tenantId: string,
    userId: string,
    input: { cardId: string; amountCentavos: number; note?: string; idempotencyKey?: string },
  ) {
    if (input.amountCentavos < 100 || input.amountCentavos > MAX_TOPUP_CENTAVOS) {
      throw new BadRequestException('Monto inválido');
    }
    const card = await this.repo.findCard(tenantId, input.cardId);
    if (!card) throw new NotFoundException({ error: 'Tarjeta no encontrada' });

    const [staffMemberId, userPersonId] = await Promise.all([
      this.repo.getStaffMemberId(tenantId, userId),
      this.repo.getUserPersonId(userId),
    ]);
    if (userPersonId && userPersonId === card.person_id) {
      throw new ForbiddenException({ error: 'No puedes recargar tu propia tarjeta' });
    }

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const g = await this.repo.topupGuards(tenantId, card.id, staffMemberId, dayStart);
    if (staffMemberId && g.staffSum + input.amountCentavos > STAFF_DAILY_TOPUP_LIMIT) {
      tooMany(`Límite diario de recargas alcanzado (máx. ${formatMxn2(STAFF_DAILY_TOPUP_LIMIT)} por día). Contacta al administrador.`);
    }
    if (g.cardSum + input.amountCentavos > CARD_DAILY_TOPUP_LIMIT) {
      tooMany(`Esta tarjeta ya alcanzó su límite diario de recarga (máx. ${formatMxn2(CARD_DAILY_TOPUP_LIMIT)}). Contacta al administrador.`);
    }
    if (g.cardCount >= MAX_TOPUPS_PER_CARD_PER_DAY) {
      tooMany('Esta tarjeta ya recibió el máximo de recargas por hoy (3). Contacta al administrador.');
    }

    const balanceCents = await this.repo.creditWallet({
      tenantId,
      cardId: card.id,
      deltaCents: input.amountCentavos,
      type: 'topup',
      // Prefer the client's stable key (retry-safe); fall back to a generated one.
      idempotencyKey: input.idempotencyKey?.trim() || `topup_${card.id}_${Date.now()}`,
      staffMemberId,
      description: input.note ?? 'Recarga en tienda',
    });

    await this.walletPass.refreshCard(card.id);
    return {
      success: true,
      newBalanceCentavos: balanceCents,
      newBalanceMXN: formatMxn2(balanceCents),
      amountMXN: formatMxn2(input.amountCentavos),
      customer: card.display_name,
    };
  }

  async purchase(
    tenantId: string,
    userId: string,
    input: { cardId: string; amountCentavos: number; note?: string; idempotencyKey?: string },
  ) {
    const card = await this.repo.findCard(tenantId, input.cardId);
    if (!card) throw new NotFoundException({ error: 'Tarjeta no encontrada' });
    const staffMemberId = await this.repo.getStaffMemberId(tenantId, userId);

    let balanceCents: number;
    try {
      balanceCents = await this.repo.purchase({
        tenantId,
        cardId: card.id,
        deltaCents: -input.amountCentavos,
        amountCents: input.amountCentavos,
        type: 'purchase',
        idempotencyKey: input.idempotencyKey?.trim() || `purchase_${card.id}_${Date.now()}`,
        staffMemberId,
        description: input.note || 'Pago con saldo',
        newQrToken: randomToken(),
      });
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        throw new BadRequestException({
          error: `Saldo insuficiente. Disponible: ${formatMxn2(err.availableCents)}`,
        });
      }
      if (err instanceof CardNotFoundError) {
        throw new NotFoundException({ error: 'Tarjeta no encontrada' });
      }
      throw err;
    }

    await this.walletPass.refreshCard(card.id);
    return {
      success: true,
      amountMXN: formatMxn2(input.amountCentavos),
      newBalanceMXN: formatMxn2(balanceCents),
      customer: card.display_name,
    };
  }

  async issueGiftCard(
    tenantId: string,
    userId: string,
    input: {
      amountCentavos: number;
      senderName?: string;
      message?: string;
      recipientEmail?: string;
      recipientPhone?: string;
      recipientName?: string;
    },
  ) {
    const staffMemberId = await this.repo.getStaffMemberId(tenantId, userId);
    let gc: { id: string; code: string; amount_cents: number } | null = null;
    for (let attempt = 0; attempt < 5 && !gc; attempt++) {
      try {
        gc = await this.repo.insertGiftCard({
          tenantId,
          code: generateGiftCode(),
          amountCents: input.amountCentavos,
          staffMemberId,
          senderName: input.senderName || null,
          message: input.message || null,
          recipientEmail: input.recipientEmail || null,
          recipientPhone: input.recipientPhone || null,
          recipientName: input.recipientName || null,
        });
      } catch (err) {
        if ((err as { code?: string })?.code === '23505') continue; // code collision
        throw err;
      }
    }
    if (!gc) throw new HttpException({ error: 'Error al crear tarjeta de regalo' }, 500);
    return {
      success: true,
      giftCard: { id: gc.id, code: gc.code, amountMXN: formatMxn2(gc.amount_cents) },
    };
  }

  async redeemGiftCard(
    tenantId: string,
    code: string,
    by: { phone?: string; email?: string },
  ) {
    const normalizedCode = code.toUpperCase();
    const gift = await this.repo.findGiftCardByCode(tenantId, normalizedCode);
    if (!gift) throw new NotFoundException({ error: 'Código no válido' });
    if (gift.redeemed_at !== null) {
      throw new BadRequestException({ error: 'Esta tarjeta de regalo ya fue canjeada' });
    }
    if (gift.expires_at && new Date(gift.expires_at) < new Date()) {
      throw new BadRequestException({ error: 'Esta tarjeta de regalo ha expirado' });
    }

    const found = await this.repo.findPersonCard(tenantId, by);
    if (!found) {
      throw new NotFoundException({
        error: 'No encontramos una tarjeta de lealtad con ese teléfono/email. Regístrate primero.',
        needsRegistration: true,
      });
    }

    let balanceCents: number;
    try {
      balanceCents = await this.repo.redeemGiftCard({
        tenantId,
        giftCardId: gift.id,
        cardId: found.cardId,
        amountCents: gift.amount_cents,
        senderName: gift.sender_name ?? null,
      });
    } catch (err) {
      if (err instanceof GiftCardAlreadyRedeemedError) {
        throw new BadRequestException({ error: 'Esta tarjeta de regalo ya fue canjeada' });
      }
      throw err;
    }

    await this.walletPass.refreshCard(found.cardId);
    return {
      success: true,
      amountMXN: formatMxn2(gift.amount_cents),
      newBalanceMXN: formatMxn2(balanceCents),
      customerName: found.displayName,
    };
  }
}
