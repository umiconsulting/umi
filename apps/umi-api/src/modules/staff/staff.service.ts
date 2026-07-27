import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateStaffRequest, UpdateStaffRequest } from '@umi/contract';
import { iso } from '../../shared/format/money';
import { TenantsRepository } from '../tenants/tenants.repository';
import { AuthRepository } from '../auth/auth.repository';
import { StaffRepository, type StaffRow } from './staff.repository';

export interface StaffDto {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string;
  status: string;
  permissions: Record<string, boolean>;
  createdAt: string | null;
  updatedAt: string | null;
  invitedAt: string | null;
  disabledAt: string | null;
}

@Injectable()
export class StaffService {
  constructor(
    private readonly repo: StaffRepository,
    private readonly tenants: TenantsRepository,
    private readonly auth: AuthRepository,
  ) {}

  private toDto(row: StaffRow): StaffDto {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      role: row.role,
      status: row.status,
      permissions: row.permissions ?? {},
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
    body: CreateStaffRequest,
    actorUserId: string,
    sessionId: string,
  ): Promise<StaffDto> {
    const locationId = await this.tenants.resolveLocationId(
      tenantId,
      body.branchId ?? requestedLocationId,
    );
    try {
      const row = await this.repo.insert(tenantId, locationId, {
        name: body.name,
        email: body.email,
        role: body.role,
        position: body.position ?? null,
        actorUserId,
      });
      await this.auth.writeSecurityAudit({
        actorUserId,
        sessionId,
        businessId: tenantId,
        branchId: locationId,
        eventType: 'staff.created',
        entityType: 'staff',
        entityId: row.id,
        outcome: 'success',
        metadata: { role: body.role },
      });
      return this.toDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Staff member already exists for this business');
      }
      throw err;
    }
  }

  async update(
    tenantId: string,
    staffId: string,
    body: UpdateStaffRequest,
    actorUserId: string,
    sessionId: string,
  ): Promise<StaffDto> {
    const patch: {
      status?: string | null;
    } = {};
    if (has(body, 'status')) patch.status = body.status;
    let row = await this.repo.update(tenantId, staffId, patch);
    if (!row) throw new NotFoundException('Staff member not found');
    if (body.role !== undefined || body.branchId !== undefined || body.position !== undefined) {
      const branchId =
        body.branchId === undefined
          ? undefined
          : await this.tenants.resolveLocationId(tenantId, body.branchId);
      const updated = await this.repo.updateAuthorization(tenantId, staffId, {
        role: body.role,
        branchId,
        position: body.position,
        actorUserId,
      });
      if (!updated) throw new NotFoundException('Staff member not found');
      row = await this.repo.findById(tenantId, staffId);
      if (!row) throw new NotFoundException('Staff member not found');
    }
    await this.auth.writeSecurityAudit({
      actorUserId,
      sessionId,
      businessId: tenantId,
      branchId: body.branchId,
      eventType: 'staff.updated',
      entityType: 'staff',
      entityId: staffId,
      outcome: 'success',
      metadata: { fields: Object.keys(body) },
    });
    return this.toDto(row);
  }

  async remove(
    tenantId: string,
    staffId: string,
    actorUserId: string,
    sessionId: string,
  ): Promise<void> {
    const ok = await this.repo.softDelete(tenantId, staffId);
    if (!ok) throw new NotFoundException('Staff member not found');
    await this.auth.writeSecurityAudit({
      actorUserId,
      sessionId,
      businessId: tenantId,
      eventType: 'staff.disabled',
      entityType: 'staff',
      entityId: staffId,
      outcome: 'success',
    });
  }
}

function has(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === '23505' || /unique/i.test(String((err as Error)?.message));
}
