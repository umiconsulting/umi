import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { QrService } from '../../shared/auth/qr.service';
import type { RegisterMemberRequest } from '@umi/contract';
import { CashRegisterRepository } from './cash-register.repository';

/** generateCardNumber — ported verbatim from umi-cash qr.ts (default prefix LYL). */
function generateCardNumber(prefix: string | null | undefined): string {
  const p = prefix || 'LYL';
  const num = Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000; // 10 digits
  return `${p}-${num}`;
}

export type RegisterInput = RegisterMemberRequest;

/**
 * The public registration answer.
 *
 * It carries no credential and no customer identifier. The same body is returned
 * for a new phone and a known phone, so the caller cannot learn whether the
 * merchant already knows the number.
 */
export interface RegisterResult {
  verificationRequired: true;
  message: string;
}

/**
 * Customer self-registration.
 *
 * It resolves the customer, mints a loyalty card when the customer has none, and
 * returns a proof-required answer. It does NOT mint a session: a phone typed into
 * a public form proves that the caller knows the number, not that the caller owns
 * it. Registration used to return a CUSTOMER token for an existing phone, which
 * let any caller who knew a phone open that customer's card session.
 *
 * A later slice must add a real proof transport (OTP or WhatsApp challenge). Until
 * that transport exists, the card is enrolled but no card session can open.
 */
@Injectable()
export class CashRegisterService {
  constructor(
    private readonly repo: CashRegisterRepository,
    private readonly qr: QrService,
  ) {}

  async register(
    merchantId: string,
    merchantName: string,
    input: RegisterInput,
    _userAgent: string | null,
  ): Promise<RegisterResult> {
    const cfg = await this.repo.merchantConfig(merchantId);
    if (!cfg) throw new NotFoundException({ error: 'Merchant no encontrado' });
    if (!cfg.selfRegistration) {
      throw new ForbiddenException({ error: 'El registro no está disponible' });
    }
    if (!cfg.loyaltyConfigured) {
      throw new HttpException({ error: 'Programa de lealtad no configurado' }, 500);
    }

    const normalized = await this.repo.normalizePhone(input.phone);
    if (!normalized) {
      throw new BadRequestException({ error: 'Número de teléfono no válido' });
    }

    const existing = await this.repo.findExisting(merchantId, normalized);
    if (existing) {
      // The caller supplied no proof of ownership. Create a card only when the
      // customer has none, and never rewrite the existing profile from this
      // unauthenticated request.
      if (!existing.hasCard) {
        await this.createCard(merchantId, existing.personId, cfg.cardPrefix);
      }
      return this.verificationRequired(merchantName);
    }

    const personId = await this.repo.resolveContact(merchantId, input.phone, input.name);
    await this.repo.updatePerson(personId, input.name, input.birthDate);
    await this.createCard(merchantId, personId, cfg.cardPrefix);
    return this.verificationRequired(merchantName);
  }

  private verificationRequired(merchantName: string): RegisterResult {
    return {
      verificationRequired: true,
      message: `Solicitud recibida. Verifica tu teléfono para usar tu tarjeta en ${merchantName}.`,
    };
  }

  private async createCard(
    merchantId: string,
    personId: string,
    cardPrefix: string | null,
  ): Promise<{ cardId: string; cardNumber: string }> {
    let created: { cardId: string; cardNumber: string } | null = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      try {
        created = await this.repo.createCard({
          merchantId,
          personId,
          cardNumber: generateCardNumber(cardPrefix),
          qrToken: this.qr.generateRandomToken(),
        });
      } catch (err) {
        if ((err as { code?: string })?.code === '23505') continue; // card_number collision
        throw err;
      }
    }
    if (!created) throw new HttpException({ error: 'Error al registrar' }, 500);
    return created;
  }
}
