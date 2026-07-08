import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { QrService } from '../../shared/auth/qr.service';
import { CashRegisterRepository } from './cash-register.repository';
import { CustomerSessionService } from './customer-session.service';

/** generateCardNumber — ported verbatim from umi-cash qr.ts (default prefix LYL). */
function generateCardNumber(prefix: string | null | undefined): string {
  const p = prefix || 'LYL';
  const num = Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000; // 10 digits
  return `${p}-${num}`;
}

export interface RegisterInput {
  name: string;
  phone: string;
  birthDate: string; // YYYY-MM-DD
}

/**
 * Customer self-registration → resolves the customer (identity resolver),
 * mints a loyalty card, and a CUSTOMER session. Ported from umi-cash
 * customers/route.ts including the "already registered" 409-with-session path.
 */
@Injectable()
export class CashRegisterService {
  constructor(
    private readonly repo: CashRegisterRepository,
    private readonly session: CustomerSessionService,
    private readonly qr: QrService,
  ) {}

  async register(tenantId: string, tenantName: string, input: RegisterInput, userAgent: string | null) {
    const cfg = await this.repo.tenantConfig(tenantId);
    if (!cfg) throw new NotFoundException({ error: 'Tenant no encontrado' });
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

    const existing = await this.repo.findExisting(tenantId, normalized);
    if (existing && existing.hasCard) {
      const { accessToken } = await this.session.createSession(
        existing.personId,
        'CUSTOMER',
        tenantId,
      );
      // Already registered, but hand back a session so the page shows wallet
      // buttons (same UX as umi-cash). Carried in the exception body.
      throw new ConflictException({
        error: 'Este teléfono ya está registrado',
        accessToken,
        user: { id: existing.personId, name: existing.displayName, role: 'CUSTOMER' },
      });
    }

    const personId = await this.repo.resolveContact(tenantId, input.phone, input.name);
    await this.repo.updatePerson(personId, input.name, input.birthDate, {
      ua: userAgent ?? null,
    });

    let created: { cardId: string; cardNumber: string } | null = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      try {
        created = await this.repo.createCard({
          tenantId,
          personId,
          cardNumber: generateCardNumber(cfg.cardPrefix),
          qrToken: this.qr.generateRandomToken(),
        });
      } catch (err) {
        if ((err as { code?: string })?.code === '23505') continue; // card_number collision
        throw err;
      }
    }
    if (!created) throw new HttpException({ error: 'Error al registrar' }, 500);

    const { accessToken } = await this.session.createSession(personId, 'CUSTOMER', tenantId);
    return {
      userId: personId,
      cardId: created.cardId,
      cardNumber: created.cardNumber,
      accessToken,
      user: { id: personId, name: input.name, role: 'CUSTOMER' },
      message: `¡Bienvenido a ${tenantName}!`,
    };
  }
}
