import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PasswordService } from '../../shared/auth/password.service';
import { posPinLookupHash } from '../../shared/auth/pos-pin';
import type { AppConfig } from '../../shared/config/config.schema';
import type { AuthUser } from '../auth/auth.types';
import { PosEntryRepository } from './pos-entry.repository';

@Injectable()
export class PosEntryService {
  constructor(
    private readonly repo: PosEntryRepository,
    private readonly passwords: PasswordService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  entryContext(user: AuthUser) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    return this.repo.entryContext(user.id, user.deviceId).then((tenants) => ({ tenants }));
  }

  async start(user: AuthUser, tenantId: string, branchId: string) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    const session = await this.repo.startOperator({
      durableSessionId: user.sessionId,
      userId: user.id,
      deviceId: user.deviceId,
      tenantId,
      branchId,
      expiresAt: new Date(Date.now() + 12 * 60 * 60_000),
    });
    if (!session) throw new ForbiddenException({ code: 'BRANCH_NOT_FOUND' });
    return session;
  }

  async transition(user: AuthUser, id: string, state: 'locked' | 'ended') {
    if (!(await this.repo.transition(id, user.sessionId, state))) {
      throw new ForbiddenException({ code: 'OPERATOR_SESSION_REQUIRED' });
    }
    return { ok: true as const };
  }

  async verifyPin(
    user: AuthUser,
    dto: { pin: string; tenantId: string; branchId: string; permission: string },
  ) {
    const record = await this.repo.pinRecord(user.id, dto.tenantId);
    if (
      !record ||
      !record.salt ||
      !record.hash ||
      (record.lockedUntil?.getTime() ?? 0) > Date.now()
    ) {
      throw new ForbiddenException({ code: 'PIN_LOCKED' });
    }
    if (!this.passwords.verify(dto.pin, record.salt, record.hash)) {
      await this.repo.recordPinFailure(record.staffId);
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    const grant = await this.repo.grantPinElevation({
      staffId: record.staffId,
      sessionId: user.sessionId,
      tenantId: dto.tenantId,
      branchId: dto.branchId,
      permission: dto.permission,
      userId: user.id,
    });
    return {
      elevationId: grant.id,
      permission: dto.permission,
      tenantId: dto.tenantId,
      branchId: dto.branchId,
      method: 'operator_pin' as const,
      expiresAt: grant.expiresAt.toISOString(),
      commandFingerprint: null,
    };
  }

  async approveByManager(
    user: AuthUser,
    dto: {
      operatorSessionId: string;
      managerPin: string;
      permission: string;
      tenantId: string;
      branchId: string;
      commandFingerprint: string | null;
    },
  ) {
    const secret = this.config.get('JWT_SECRET', { infer: true });
    if (!secret) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    const record = await this.repo.managerPinRecord(
      posPinLookupHash(secret, dto.tenantId, dto.managerPin),
      dto.tenantId,
      dto.branchId,
      dto.permission,
      dto.operatorSessionId,
    );
    if (
      !record ||
      !record.salt ||
      !record.hash ||
      (record.lockedUntil?.getTime() ?? 0) > Date.now()
    ) {
      throw new ForbiddenException({ code: 'PIN_LOCKED' });
    }
    if (!this.passwords.verify(dto.managerPin, record.salt, record.hash)) {
      await this.repo.recordPinFailure(record.staffId);
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    const grant = await this.repo.grantManagerElevation({
      managerUserId: record.userId,
      managerStaffId: record.staffId,
      operatorSessionId: dto.operatorSessionId,
      tenantId: dto.tenantId,
      branchId: dto.branchId,
      permission: dto.permission,
      commandFingerprint: dto.commandFingerprint,
    });
    if (!grant) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    return {
      elevationId: grant.id,
      permission: dto.permission,
      tenantId: dto.tenantId,
      branchId: dto.branchId,
      method: 'manager_approval' as const,
      expiresAt: grant.expiresAt.toISOString(),
      commandFingerprint: dto.commandFingerprint,
    };
  }
}
