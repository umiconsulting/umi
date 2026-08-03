import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { iso } from '../../shared/format/money';
import { PasswordService } from '../../shared/auth/password.service';
import { posPinLookupHash } from '../../shared/auth/pos-pin';
import type { AppConfig } from '../../shared/config/config.schema';
import { MerchantsRepository } from '../merchants/merchants.repository';
import { StaffRepository, type StaffRow } from './staff.repository';

// Ported from server.js DEFAULT_PERMISSIONS — synthesized per role (not stored).
const DEFAULT_PERMISSIONS: Record<string, Record<string, boolean>> = {
  ADMIN: {
    scan: true,
    topup: true,
    analytics: true,
    settings: true,
    staff: true,
    giftcards: true,
    kds: true,
  },
  STAFF: {
    scan: true,
    topup: true,
    analytics: false,
    settings: false,
    staff: false,
    giftcards: false,
    kds: true,
  },
};

export interface StaffDto {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: 'ADMIN' | 'STAFF';
  status: string;
  permissions: Record<string, boolean>;
  createdAt: string | null;
  updatedAt: string | null;
  invitedAt: string | null;
  disabledAt: string | null;
}

export interface StaffInput {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  role?: unknown;
  status?: unknown;
  permissions?: unknown;
  operatorPin?: unknown;
}

@Injectable()
export class StaffService {
  constructor(
    private readonly repo: StaffRepository,
    private readonly merchants: MerchantsRepository,
    private readonly passwords: PasswordService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private toDto(row: StaffRow): StaffDto {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      role: row.role,
      status: row.status,
      permissions: row.permissions ?? DEFAULT_PERMISSIONS[row.role] ?? DEFAULT_PERMISSIONS.STAFF,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      invitedAt: iso(row.invitedAt),
      disabledAt: iso(row.disabledAt),
    };
  }

  async list(merchantId: string): Promise<StaffDto[]> {
    const rows = await this.repo.list(merchantId);
    return rows.map((r) => this.toDto(r));
  }

  async create(
    merchantId: string,
    requestedLocationId: string | null,
    body: StaffInput,
  ): Promise<StaffDto> {
    const name = String(body.name ?? '').trim();
    const phone = String(body.phone ?? '').trim() || null;
    const email = String(body.email ?? '').trim() || null;
    // 'invited' is a state of the LOGIN (umi.user.status), not of the employment, and
    // merchant.staff's CHECK now says so. A staff member the merchant just recorded is
    // an active employee; whether they ever accept a dashboard invitation is a separate
    // question, asked of a separate table. Postgres tests a CHECK at RUN time (23514),
    // so sql-preflight could not have caught the old value.
    const status = body.status === 'disabled' ? 'disabled' : 'active';
    if (!name) throw new BadRequestException('name is required');
    if (!phone && !email) {
      throw new BadRequestException('phone or email is required');
    }

    const locationId = await this.merchants.resolveLocationId(merchantId, requestedLocationId);
    const operatorPin = String(body.operatorPin ?? '');
    if (operatorPin && !/^\d{4,8}$/.test(operatorPin)) {
      throw new BadRequestException('operatorPin must contain four to eight digits');
    }
    const pin = operatorPin ? this.pinMaterial(merchantId, operatorPin) : null;
    try {
      const row = await this.repo.insert(merchantId, locationId, {
        name,
        phone,
        email,
        status,
        pinSalt: pin?.salt ?? null,
        pinHash: pin?.hash ?? null,
        pinLookup: pin?.lookupHash ?? null,
      });
      return this.toDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Staff member already exists for this merchant');
      }
      throw err;
    }
  }

  async update(merchantId: string, staffId: string, body: StaffInput): Promise<StaffDto> {
    const patch: {
      name?: string;
      phone?: string | null;
      email?: string | null;
      status?: string | null;
    } = {};
    if (has(body, 'name')) patch.name = String(body.name ?? '').trim();
    if (has(body, 'phone')) patch.phone = String(body.phone ?? '').trim() || null;
    if (has(body, 'email')) patch.email = String(body.email ?? '').trim() || null;
    if (has(body, 'status')) {
      // Two states, matching the CHECK. 'invited' is gone for the reason in create().
      patch.status = ['active', 'disabled'].includes(body.status as string)
        ? (body.status as string)
        : null;
    }
    const row = await this.repo.update(merchantId, staffId, patch);
    if (!row) throw new NotFoundException('Staff member not found');
    return this.toDto(row);
  }

  async remove(merchantId: string, staffId: string): Promise<void> {
    const ok = await this.repo.softDelete(merchantId, staffId);
    if (!ok) throw new NotFoundException('Staff member not found');
  }

  private pinMaterial(merchantId: string, pin: string): {
    salt: string;
    hash: string;
    lookupHash: string;
  } {
    const secret = this.config.get('JWT_SECRET', { infer: true });
    if (!secret) throw new Error('JWT_SECRET is required for POS PIN management');
    return {
      ...this.passwords.hash(pin),
      lookupHash: posPinLookupHash(secret, merchantId, pin),
    };
  }
}

function has(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === '23505' || /unique/i.test(String((err as Error)?.message));
}
