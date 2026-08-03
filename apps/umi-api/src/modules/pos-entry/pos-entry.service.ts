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
    return this.repo.entryContext(user.id, user.deviceId).then((merchants) => ({ merchants }));
  }

  async start(user: AuthUser, merchantId: string, locationId: string) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    const session = await this.repo.startOperator({
      durableSessionId: user.sessionId,
      userId: user.id,
      deviceId: user.deviceId,
      merchantId,
      locationId,
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
    dto: { pin: string; merchantId: string; locationId: string; permission: string },
  ) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    const record = await this.repo.pinRecord(
      user.id,
      dto.merchantId,
      dto.locationId,
      user.deviceId,
    );
    if (
      !record ||
      !record.salt ||
      !record.hash ||
      (record.lockedUntil?.getTime() ?? 0) > Date.now()
    ) {
      throw new ForbiddenException({ code: 'PIN_LOCKED' });
    }
    if (!this.passwords.verify(dto.pin, record.salt, record.hash)) {
      await this.repo.recordPinFailure(dto.merchantId, dto.locationId, user.deviceId);
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    const grant = await this.repo.grantPinElevation({
      staffId: record.staffId,
      sessionId: user.sessionId,
      merchantId: dto.merchantId,
      locationId: dto.locationId,
      permission: dto.permission,
      userId: user.id,
      deviceId: user.deviceId,
    });
    return {
      elevationId: grant.id,
      permission: dto.permission,
      merchantId: dto.merchantId,
      locationId: dto.locationId,
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
      merchantId: string;
      locationId: string;
      commandFingerprint: string | null;
    },
  ) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    const secret = this.config.get('JWT_SECRET', { infer: true });
    if (!secret) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    const record = await this.repo.managerPinRecord(
      posPinLookupHash(secret, dto.merchantId, dto.managerPin),
      dto.merchantId,
      dto.locationId,
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
      await this.repo.recordPinFailure(dto.merchantId, dto.locationId, user.deviceId);
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    const grant = await this.repo.grantManagerElevation({
      managerUserId: record.userId,
      managerStaffId: record.staffId,
      operatorSessionId: dto.operatorSessionId,
      merchantId: dto.merchantId,
      locationId: dto.locationId,
      permission: dto.permission,
      commandFingerprint: dto.commandFingerprint,
    });
    if (!grant) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    return {
      elevationId: grant.id,
      permission: dto.permission,
      merchantId: dto.merchantId,
      locationId: dto.locationId,
      method: 'manager_approval' as const,
      expiresAt: grant.expiresAt.toISOString(),
      commandFingerprint: dto.commandFingerprint,
    };
  }
}
