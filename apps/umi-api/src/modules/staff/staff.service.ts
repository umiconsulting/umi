import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { iso } from '../../shared/format/money';
import { TenantsRepository } from '../tenants/tenants.repository';
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
}

@Injectable()
export class StaffService {
  constructor(
    private readonly repo: StaffRepository,
    private readonly tenants: TenantsRepository,
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

  async list(tenantId: string): Promise<StaffDto[]> {
    const rows = await this.repo.list(tenantId);
    return rows.map((r) => this.toDto(r));
  }

  async create(
    tenantId: string,
    requestedLocationId: string | null,
    body: StaffInput,
  ): Promise<StaffDto> {
    const name = String(body.name ?? '').trim();
    const phone = String(body.phone ?? '').trim() || null;
    const email = String(body.email ?? '').trim() || null;
    const status = body.status === 'active' ? 'active' : 'invited';
    if (!name) throw new BadRequestException('name is required');
    if (!phone && !email) {
      throw new BadRequestException('phone or email is required');
    }

    const locationId = await this.tenants.resolveLocationId(tenantId, requestedLocationId);
    try {
      const row = await this.repo.insert(tenantId, locationId, {
        name,
        phone,
        email,
        status,
      });
      return this.toDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Staff member already exists for this business');
      }
      throw err;
    }
  }

  async update(tenantId: string, staffId: string, body: StaffInput): Promise<StaffDto> {
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
      patch.status = ['active', 'invited', 'disabled'].includes(body.status as string)
        ? (body.status as string)
        : null;
    }
    const row = await this.repo.update(tenantId, staffId, patch);
    if (!row) throw new NotFoundException('Staff member not found');
    return this.toDto(row);
  }

  async remove(tenantId: string, staffId: string): Promise<void> {
    const ok = await this.repo.softDelete(tenantId, staffId);
    if (!ok) throw new NotFoundException('Staff member not found');
  }
}

function has(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === '23505' || /unique/i.test(String((err as Error)?.message));
}
