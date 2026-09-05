import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PasswordService } from '../../shared/auth/password.service';
import { posCardLookupHash, posPinLookupHash } from '../../shared/auth/pos-pin';
import type { AppConfig } from '../../shared/config/config.schema';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
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

  /**
   * The branch an operator session belongs to is a fact about the hardware, not
   * a choice the client makes. A till stands in one branch; if the operator also
   * administers another one and switches the dashboard to it, the drawer, the
   * sales and the Z-report on THIS device must still belong to the branch the
   * device is in. So a pinned device overrides the requested branch, and only a
   * floating device (`location_id IS NULL`) accepts the caller's choice.
   *
   * The response carries the resolved `locationId`, so the client is told which
   * branch it actually got.
   */
  private async anchorLocation(
    merchantId: string,
    deviceId: string,
    requestedLocationId: string,
  ): Promise<string> {
    const deviceLocation = await this.repo.deviceLocation(merchantId, deviceId);
    if (deviceLocation === undefined) {
      throw new ForbiddenException({ code: 'DEVICE_NOT_REGISTERED' });
    }
    return deviceLocation ?? requestedLocationId;
  }

  async start(user: AuthUser, merchantId: string, locationId: string) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    const session = await this.repo.startOperator({
      durableSessionId: user.sessionId,
      userId: user.id,
      deviceId: user.deviceId,
      merchantId,
      locationId: await this.anchorLocation(merchantId, user.deviceId, locationId),
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
    // Anchor here too. `pinRecord` joins `merchant.device`, which narrows by
    // location under RLS: a device pinned to branch A is invisible while the
    // caller claims branch B, and the PIN would fail as though it were wrong.
    const record = await this.repo.pinRecord(
      user.id,
      dto.merchantId,
      await this.anchorLocation(dto.merchantId, user.deviceId, dto.locationId),
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

  /**
   * The manager's credential for an elevation: a typed PIN, or a card token read
   * from a manager card or fob. Exactly one is accepted. The card exists because
   * a PIN is typed in front of whoever asked for the approval, while a card is a
   * possession factor and is faster at a busy counter.
   */
  private managerCredential(dto: { managerPin?: string | null; managerCard?: string | null }): {
    secretValue: string;
    lookup: (secret: string, merchantId: string) => string;
  } {
    const pin = dto.managerPin ?? null;
    const card = dto.managerCard ?? null;
    if ((pin === null) === (card === null)) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Send exactly one of managerPin or managerCard.',
      });
    }
    return pin !== null
      ? {
          secretValue: pin,
          lookup: (secret, merchantId) => posPinLookupHash(secret, merchantId, pin),
        }
      : {
          secretValue: card as string,
          lookup: (secret, merchantId) => posCardLookupHash(secret, merchantId, card as string),
        };
  }

  async approveByManager(
    user: AuthUser,
    dto: {
      operatorSessionId: string;
      managerPin?: string | null;
      managerCard?: string | null;
      permission: string;
      merchantId: string;
      locationId: string;
      commandFingerprint: string | null;
    },
  ) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    const secret = this.config.get('JWT_SECRET', { infer: true });
    if (!secret) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    const credential = this.managerCredential(dto);
    const record = await this.repo.managerPinRecord(
      credential.lookup(secret, dto.merchantId),
      dto.merchantId,
      dto.locationId,
      dto.permission,
      dto.operatorSessionId,
      user.id,
      user.sessionId,
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
    if (!this.passwords.verify(credential.secretValue, record.salt, record.hash)) {
      await this.repo.recordPinFailure(dto.merchantId, dto.locationId, user.deviceId);
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    const method =
      record.credential === 'manager_card'
        ? ('manager_card' as const)
        : ('manager_approval' as const);
    const grant = await this.repo.grantManagerElevation({
      managerUserId: record.userId,
      managerStaffId: record.staffId,
      operatorSessionId: dto.operatorSessionId,
      merchantId: dto.merchantId,
      locationId: dto.locationId,
      permission: dto.permission,
      commandFingerprint: dto.commandFingerprint,
      method,
    });
    if (!grant) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    return {
      elevationId: grant.id,
      permission: dto.permission,
      merchantId: dto.merchantId,
      locationId: dto.locationId,
      method,
      expiresAt: grant.expiresAt.toISOString(),
      commandFingerprint: dto.commandFingerprint,
    };
  }

  async approveAdministrativeByManager(
    user: AuthUser,
    access: MerchantAccess,
    dto: {
      dashboardSessionId: string;
      managerPin: string;
      permission: string;
      locationId: string;
      commandFingerprint: string | null;
    },
  ) {
    const secret = this.config.get('JWT_SECRET', { infer: true });
    if (!secret) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    const record = await this.repo.administrativeManagerPinRecord({
      lookupHash: posPinLookupHash(secret, access.merchantId, dto.managerPin),
      merchantId: access.merchantId,
      locationId: dto.locationId,
      permission: dto.permission,
      actingUserId: user.id,
      dashboardSessionId: dto.dashboardSessionId,
    });
    if ((record?.lockedUntil?.getTime() ?? 0) > Date.now()) {
      throw new ForbiddenException({ code: 'PIN_LOCKED' });
    }
    if (
      !record?.salt ||
      !record.hash ||
      !this.passwords.verify(dto.managerPin, record.salt, record.hash)
    ) {
      await this.repo.recordAdministrativePinFailure(
        access.merchantId,
        dto.locationId,
        dto.dashboardSessionId,
      );
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    const grant = await this.repo.grantAdministrativeManagerElevation({
      managerUserId: record.userId,
      managerStaffId: record.staffId,
      actingUserId: user.id,
      dashboardSessionId: dto.dashboardSessionId,
      merchantId: access.merchantId,
      locationId: dto.locationId,
      permission: dto.permission,
      commandFingerprint: dto.commandFingerprint,
    });
    if (!grant) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    return {
      elevationId: grant.id,
      permission: dto.permission,
      merchantId: access.merchantId,
      locationId: dto.locationId,
      method: 'manager_approval' as const,
      expiresAt: grant.expiresAt.toISOString(),
      commandFingerprint: dto.commandFingerprint,
    };
  }
}
